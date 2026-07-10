// PSKReporter live reception reports (DESIGN.md §7): every FT8/FT4/WSPR/…
// decode uploaded to pskreporter.info is republished on a public MQTT
// broker; browsers subscribe over WebSocket directly — no backend proxy.
//
// Topic scheme (mqtt.pskreporter.info):
//   pskr/filter/v2/{band}/{mode}/{txcall}/{rxcall}/{txgrid4}/{rxgrid4}/{txdxcc}/{rxdxcc}
// One JSON spot per message. We subscribe twice, keyed on the operator's
// own callsign: once as sender ("who hears me" — TX) and once as receiver
// ("who I hear" — RX; only fires if the station uploads its own decodes).

import { bandOf } from './bands';

export interface PskReport {
  /** Feed sequence number (or a synthesized key) — dedupe id. */
  id: string;
  /** 'tx' = my signal heard by `call`; 'rx' = I decoded `call`. */
  dir: 'tx' | 'rx';
  /** Unix seconds of the decode. */
  t: number;
  band: string | null;
  mode: string;
  freqHz: number;
  /** SNR in dB as reported by the decoder, when present. */
  snr: number | null;
  /** The other station (receiver for dir 'tx', sender for dir 'rx'). */
  call: string;
  /** The other station's Maidenhead grid, when present. */
  grid: string | null;
}

export type PskDirection = 'tx' | 'rx';

/** Rolling window of reports kept in memory / Dexie. */
export const PSK_WINDOW_S = 30 * 60;
/** Hard cap so a contest-weekend firehose can't grow state unbounded. */
export const PSK_MAX_REPORTS = 800;

/**
 * Base callsign for topic matching: portable prefixes/suffixes (EA8/M0LTE/P)
 * would read as extra topic levels, and the feed keys spots on the bare
 * call anyway. Longest slash-segment wins — that's the call itself.
 */
export function baseCall(callsign: string): string {
  const segs = callsign.trim().toUpperCase().split('/').filter(Boolean);
  if (!segs.length) return '';
  const call = segs.reduce((a, b) => (b.length > a.length ? b : a));
  return /^[A-Z0-9]{3,}$/.test(call) ? call : '';
}

export function pskTopics(call: string): string[] {
  return [
    `pskr/filter/v2/+/+/${call}/+/+/+/+/+`, // I'm the sender → who hears me
    `pskr/filter/v2/+/+/+/${call}/+/+/+/+`, // I'm the receiver → who I hear
  ];
}

/**
 * Broker WebSocket endpoints: 1885 = plain WS (http origins), 1886 = WSS
 * (https origins — browsers block mixed content the other way around).
 * Listed twice, with and without the conventional /mqtt path, because the
 * client rotates through candidates across reconnect attempts.
 */
export function pskBrokerUrls(): string[] {
  // Escape hatch for self-hosted brokers and local testing.
  try {
    const override = localStorage.getItem('skywave-psk-broker');
    if (override) return [override];
  } catch {
    /* no localStorage (SSR/tests) — use the public broker */
  }
  const secure = typeof location !== 'undefined' && location.protocol === 'https:';
  const base = secure ? 'wss://mqtt.pskreporter.info:1886' : 'ws://mqtt.pskreporter.info:1885';
  return [`${base}/mqtt`, `${base}/`];
}

const textDecoder = new TextDecoder();

/** Feed payload — field names are the broker's, kept terse on the wire. */
interface PskWire {
  sq?: number; // sequence
  t?: number; // unix seconds
  f?: number; // Hz
  md?: string; // mode
  rp?: number; // SNR dB
  sc?: string; // sender call
  sl?: string; // sender grid
  rc?: string; // receiver call
  rl?: string; // receiver grid
  b?: string; // band ("20m")
}

export function parsePskPayload(payload: Uint8Array, myCall: string): PskReport | null {
  let w: PskWire;
  try {
    w = JSON.parse(textDecoder.decode(payload));
  } catch {
    return null;
  }
  if (!w || typeof w.sc !== 'string' || typeof w.rc !== 'string') return null;

  const sender = w.sc.toUpperCase();
  const receiver = w.rc.toUpperCase();
  // Both subscriptions land in the same handler; the payload says which
  // side we are. (Self-decodes — sc === rc === myCall — count as RX.)
  const dir: PskDirection = sender === myCall && receiver !== myCall ? 'tx' : 'rx';
  if (dir === 'rx' && receiver !== myCall) return null;

  const other = dir === 'tx' ? receiver : sender;
  const grid = normalizeGrid(dir === 'tx' ? w.rl : w.sl);
  const freqHz = typeof w.f === 'number' && isFinite(w.f) ? w.f : 0;
  const t = typeof w.t === 'number' && isFinite(w.t) ? w.t : Date.now() / 1000;

  return {
    id: w.sq != null ? String(w.sq) : `${sender}|${receiver}|${t}|${freqHz}`,
    dir,
    t,
    band: w.b ?? (freqHz > 0 ? bandOf(freqHz / 1000) : null),
    mode: w.md ?? '?',
    freqHz,
    snr: typeof w.rp === 'number' && isFinite(w.rp) ? w.rp : null,
    call: other,
    grid,
  };
}

/** Feed grids come in 4/6/8-char flavors and mixed case; keep the valid
 * 4- or 6-char Maidenhead prefix (what gridToLatLon accepts) or drop it. */
function normalizeGrid(raw: unknown): string | null {
  if (typeof raw !== 'string') return null;
  const m = raw.toUpperCase().match(/^[A-R]{2}[0-9]{2}([A-X]{2})?/);
  return m ? m[0] : null;
}

/** Merge a batch into the window: dedupe by id, newest first, prune + cap. */
export function mergeReports(prev: PskReport[], batch: PskReport[]): PskReport[] {
  const cutoff = Date.now() / 1000 - PSK_WINDOW_S;
  const byId = new Map<string, PskReport>();
  for (const r of prev) byId.set(r.id, r);
  for (const r of batch) byId.set(r.id, r);
  return [...byId.values()]
    .filter((r) => r.t >= cutoff)
    .sort((a, b) => b.t - a.t)
    .slice(0, PSK_MAX_REPORTS);
}

const PSK_DIR_KEY = 'skywave-psk-dir';

export function loadPskDir(): PskDirection {
  return localStorage.getItem(PSK_DIR_KEY) === 'rx' ? 'rx' : 'tx';
}

export function savePskDir(dir: PskDirection): void {
  localStorage.setItem(PSK_DIR_KEY, dir);
}
