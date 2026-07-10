// Minimal MQTT 3.1.1 client over WebSocket, for the PSKReporter live feed
// (DESIGN.md §7: "direct browser MQTT-over-WebSocket, no backend needed").
//
// Hand-rolled rather than mqtt.js because the need is tiny and fixed:
// anonymous CONNECT, a couple of QoS-0 SUBSCRIBEs, receive PUBLISHes, ping.
// That's five packet types — a full client library is ~150KB of bundle for
// an app that otherwise ships its own globe renderer.
//
// Packet encode/decode is kept in pure functions/classes (no sockets) so it
// can be exercised without a broker.

const CONNECT = 1;
const CONNACK = 2;
const PUBLISH = 3;
const SUBSCRIBE = 8;
const SUBACK = 9;
const PINGREQ = 12;
const PINGRESP = 13;
const DISCONNECT = 14;

const textEncoder = new TextEncoder();
const textDecoder = new TextDecoder();

/** MQTT variable-length "remaining length": 7 bits per byte, MSB = more. */
export function encodeVarint(n: number): number[] {
  const out: number[] = [];
  do {
    let b = n % 128;
    n = Math.floor(n / 128);
    if (n > 0) b |= 0x80;
    out.push(b);
  } while (n > 0);
  return out;
}

/** UTF-8 string with a 2-byte big-endian length prefix. */
function str16(s: string): number[] {
  const bytes = textEncoder.encode(s);
  return [bytes.length >> 8, bytes.length & 0xff, ...bytes];
}

function packet(typeAndFlags: number, body: number[]): Uint8Array {
  return Uint8Array.from([typeAndFlags, ...encodeVarint(body.length), ...body]);
}

/** CONNECT: protocol MQTT 3.1.1, clean session, anonymous. */
export function encodeConnect(clientId: string, keepaliveSec: number): Uint8Array {
  const body = [
    ...str16('MQTT'),
    4, // protocol level 4 = 3.1.1
    0x02, // flags: clean session, no will, no auth
    keepaliveSec >> 8,
    keepaliveSec & 0xff,
    ...str16(clientId),
  ];
  return packet(CONNECT << 4, body);
}

/** SUBSCRIBE, QoS 0 on every topic. */
export function encodeSubscribe(packetId: number, topics: string[]): Uint8Array {
  const body = [packetId >> 8, packetId & 0xff];
  for (const t of topics) body.push(...str16(t), 0 /* QoS 0 */);
  // SUBSCRIBE requires fixed-header flags 0b0010.
  return packet((SUBSCRIBE << 4) | 0x02, body);
}

export const PINGREQ_PACKET = Uint8Array.from([PINGREQ << 4, 0]);
export const DISCONNECT_PACKET = Uint8Array.from([DISCONNECT << 4, 0]);

export type MqttPacket =
  | { type: 'connack'; code: number }
  | { type: 'suback' }
  | { type: 'pingresp' }
  | { type: 'publish'; topic: string; payload: Uint8Array }
  | { type: 'other'; packetType: number };

/**
 * Streaming decoder. WebSocket frames usually carry exactly one MQTT packet,
 * but the spec doesn't promise it — packets can be split across frames or
 * batched into one — so this buffers bytes and yields complete packets.
 */
export class MqttDecoder {
  private buf: Uint8Array = new Uint8Array(0);

  push(chunk: Uint8Array): MqttPacket[] {
    if (this.buf.length === 0) {
      this.buf = chunk;
    } else {
      const merged = new Uint8Array(this.buf.length + chunk.length);
      merged.set(this.buf);
      merged.set(chunk, this.buf.length);
      this.buf = merged;
    }

    const packets: MqttPacket[] = [];
    for (;;) {
      const parsed = this.tryParseOne();
      if (!parsed) break;
      packets.push(parsed);
    }
    return packets;
  }

  private tryParseOne(): MqttPacket | null {
    const buf = this.buf;
    if (buf.length < 2) return null;

    // Fixed header: type/flags byte + varint remaining length (≤4 bytes).
    let len = 0;
    let mult = 1;
    let i = 1;
    for (;;) {
      if (i >= buf.length) return null; // varint incomplete
      const b = buf[i++];
      len += (b & 0x7f) * mult;
      if ((b & 0x80) === 0) break;
      mult *= 128;
      if (i > 4) throw new Error('malformed MQTT length');
    }
    if (buf.length < i + len) return null; // body incomplete

    const first = buf[0];
    const body = buf.subarray(i, i + len);
    this.buf = buf.subarray(i + len);

    const type = first >> 4;
    switch (type) {
      case CONNACK:
        return { type: 'connack', code: body[1] ?? 255 };
      case SUBACK:
        return { type: 'suback' };
      case PINGRESP:
        return { type: 'pingresp' };
      case PUBLISH: {
        const qos = (first >> 1) & 0x03;
        const topicLen = (body[0] << 8) | body[1];
        const topic = textDecoder.decode(body.subarray(2, 2 + topicLen));
        // QoS >0 carries a 2-byte packet id before the payload. The PSKR
        // feed publishes QoS 0, but decode correctly regardless (we simply
        // never ack — fine for a read-only firehose).
        const payloadStart = 2 + topicLen + (qos > 0 ? 2 : 0);
        return { type: 'publish', topic, payload: body.slice(payloadStart) };
      }
      default:
        return { type: 'other', packetType: type };
    }
  }
}

export type MqttStatus = 'connecting' | 'live' | 'down';

export interface MqttClientOptions {
  /** Candidate broker URLs, rotated across reconnect attempts — covers
   * brokers that want a /mqtt path vs. those that ignore the path. */
  urls: string[];
  topics: string[];
  clientIdPrefix: string;
  keepaliveSec?: number;
  onMessage: (topic: string, payload: Uint8Array) => void;
  onStatus: (status: MqttStatus) => void;
}

const RECONNECT_MIN_MS = 2_000;
const RECONNECT_MAX_MS = 60_000;

/**
 * Connection lifecycle: connect → CONNACK → SUBSCRIBE → stream PUBLISHes,
 * with keepalive pings and exponential-backoff reconnect. stop() is final.
 */
export class MqttClient {
  private ws: WebSocket | null = null;
  private decoder = new MqttDecoder();
  private stopped = false;
  private attempt = 0;
  private pingTimer: ReturnType<typeof setInterval> | null = null;
  private reconnectTimer: ReturnType<typeof setTimeout> | null = null;
  private lastRx = 0;
  private readonly keepaliveMs: number;

  constructor(private opts: MqttClientOptions) {
    this.keepaliveMs = (opts.keepaliveSec ?? 60) * 1000;
  }

  start(): void {
    this.connect();
  }

  stop(): void {
    this.stopped = true;
    if (this.reconnectTimer) clearTimeout(this.reconnectTimer);
    this.teardown(true);
  }

  private connect(): void {
    if (this.stopped) return;
    this.opts.onStatus(this.attempt === 0 ? 'connecting' : 'down');
    const url = this.opts.urls[this.attempt % this.opts.urls.length];
    let ws: WebSocket;
    try {
      ws = new WebSocket(url, 'mqtt');
    } catch {
      this.scheduleReconnect();
      return;
    }
    ws.binaryType = 'arraybuffer';
    this.ws = ws;
    this.decoder = new MqttDecoder();

    ws.onopen = () => {
      const id = `${this.opts.clientIdPrefix}-${Math.random().toString(36).slice(2, 10)}`;
      ws.send(encodeConnect(id, this.keepaliveMs / 1000));
    };

    ws.onmessage = (ev) => {
      this.lastRx = Date.now();
      let packets: MqttPacket[];
      try {
        packets = this.decoder.push(new Uint8Array(ev.data as ArrayBuffer));
      } catch {
        ws.close();
        return;
      }
      for (const p of packets) {
        if (p.type === 'connack') {
          if (p.code === 0) {
            this.attempt = 0;
            ws.send(encodeSubscribe(1, this.opts.topics));
            this.opts.onStatus('live');
            this.startPing();
          } else {
            ws.close();
          }
        } else if (p.type === 'publish') {
          this.opts.onMessage(p.topic, p.payload);
        }
      }
    };

    ws.onclose = () => {
      if (this.ws !== ws) return; // superseded by a newer connection
      this.teardown(false);
      this.scheduleReconnect();
    };
    ws.onerror = () => ws.close();
  }

  private startPing(): void {
    if (this.pingTimer) clearInterval(this.pingTimer);
    this.lastRx = Date.now();
    this.pingTimer = setInterval(() => {
      const ws = this.ws;
      if (!ws || ws.readyState !== WebSocket.OPEN) return;
      // Watchdog: a silent broker past 1.5× keepalive means the connection
      // is dead even though TCP hasn't noticed — force the reconnect path.
      if (Date.now() - this.lastRx > this.keepaliveMs * 1.5) {
        ws.close();
        return;
      }
      ws.send(PINGREQ_PACKET);
    }, this.keepaliveMs / 2);
  }

  private teardown(sendDisconnect: boolean): void {
    if (this.pingTimer) {
      clearInterval(this.pingTimer);
      this.pingTimer = null;
    }
    const ws = this.ws;
    this.ws = null;
    if (ws) {
      ws.onopen = ws.onmessage = ws.onclose = ws.onerror = null;
      if (sendDisconnect && ws.readyState === WebSocket.OPEN) {
        try {
          ws.send(DISCONNECT_PACKET);
        } catch {
          /* closing anyway */
        }
      }
      if (ws.readyState === WebSocket.OPEN || ws.readyState === WebSocket.CONNECTING) {
        ws.close();
      }
    }
  }

  private scheduleReconnect(): void {
    if (this.stopped) return;
    this.opts.onStatus('down');
    const backoff = Math.min(RECONNECT_MAX_MS, RECONNECT_MIN_MS * 2 ** this.attempt);
    const jitter = backoff * 0.25 * Math.random();
    this.attempt++;
    this.reconnectTimer = setTimeout(() => this.connect(), backoff + jitter);
  }
}
