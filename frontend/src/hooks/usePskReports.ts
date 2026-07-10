// Live PSKReporter reception reports for the operator's own callsign,
// streamed over MQTT/WebSocket (lib/mqtt.ts + lib/pskreporter.ts).
//
// Incoming spots are buffered and flushed to React state on a 2 s cadence —
// a contest-weekend firehose can deliver many messages per second, and
// re-rendering the map per decode would melt the UI for no informational
// gain (FT8 cycles are 15 s anyway). Recent reports also persist to Dexie
// so a reload or broker outage degrades to last-known-with-staleness, the
// same contract every other live panel honors (DESIGN.md §9).

import { useEffect, useRef, useState } from 'react';
import { MqttClient, type MqttStatus } from '../lib/mqtt';
import {
  baseCall,
  mergeReports,
  parsePskPayload,
  pskBrokerUrls,
  pskTopics,
  PSK_WINDOW_S,
  type PskReport,
} from '../lib/pskreporter';
import { db, type PskHistoryRow } from '../lib/db';

/** 'off' = no callsign configured; the rest mirror the MQTT client. */
export type PskStatus = 'off' | MqttStatus;

export interface PskState {
  /** Rolling window, newest first, both directions mixed (each row is
   * tagged 'tx'/'rx'). */
  reports: PskReport[];
  status: PskStatus;
  /** Wall-clock ms of the last received report (null until one arrives). */
  lastAt: number | null;
}

const FLUSH_MS = 2_000;
const PRUNE_MS = 60_000;

async function loadCached(myCall: string): Promise<PskReport[]> {
  const cutoff = Date.now() / 1000 - PSK_WINDOW_S;
  const rows = await db.pskHistory.where('t').above(cutoff).toArray();
  return rows
    .filter((r) => r.myCall === myCall)
    .map(({ myCall: _own, ...report }) => report)
    .sort((a, b) => b.t - a.t);
}

async function persistBatch(myCall: string, batch: PskReport[]): Promise<void> {
  const rows: PskHistoryRow[] = batch.map((r) => ({ ...r, myCall }));
  const cutoff = Date.now() / 1000 - PSK_WINDOW_S;
  await db.transaction('rw', db.pskHistory, async () => {
    await db.pskHistory.bulkPut(rows);
    await db.pskHistory.where('t').below(cutoff).delete();
  });
}

export function usePskReports(callsign: string): PskState {
  const myCall = baseCall(callsign);
  const [reports, setReports] = useState<PskReport[]>([]);
  const [status, setStatus] = useState<PskStatus>('off');
  const [lastAt, setLastAt] = useState<number | null>(null);
  // Live buffer between flushes — a ref so onMessage never re-renders.
  const pendingRef = useRef<PskReport[]>([]);

  useEffect(() => {
    if (!myCall) {
      setStatus('off');
      setReports([]);
      setLastAt(null);
      return;
    }

    let disposed = false;
    pendingRef.current = [];
    setReports([]);
    setLastAt(null);

    // Seed from the Dexie cache so the pane isn't blank while connecting
    // (and shows last-known if the broker turns out to be unreachable).
    loadCached(myCall)
      .then((cached) => {
        if (disposed || !cached.length) return;
        setReports((prev) => (prev.length ? mergeReports(cached, prev) : cached));
        setLastAt((prev) => prev ?? cached[0].t * 1000);
      })
      .catch(() => {});

    const client = new MqttClient({
      urls: pskBrokerUrls(),
      topics: pskTopics(myCall),
      clientIdPrefix: 'skywave',
      onMessage: (_topic, payload) => {
        const r = parsePskPayload(payload, myCall);
        if (r) pendingRef.current.push(r);
      },
      onStatus: (s) => {
        if (!disposed) setStatus(s);
      },
    });
    client.start();

    const flush = setInterval(() => {
      if (!pendingRef.current.length) return;
      const batch = pendingRef.current.splice(0);
      setLastAt(Date.now());
      setReports((prev) => mergeReports(prev, batch));
      persistBatch(myCall, batch).catch(() => {});
    }, FLUSH_MS);

    // Window pruning independent of traffic, so old reports age out even
    // when nothing new arrives.
    const prune = setInterval(() => {
      setReports((prev) => (prev.length ? mergeReports(prev, []) : prev));
    }, PRUNE_MS);

    return () => {
      disposed = true;
      clearInterval(flush);
      clearInterval(prune);
      client.stop();
    };
  }, [myCall]);

  return { reports, status, lastAt };
}
