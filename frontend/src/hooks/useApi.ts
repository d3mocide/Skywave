// Polling data hook. Keeps the last good response when a refresh fails
// (per-panel degradation, §9) and exposes fetched_at/stale for the
// staleness badge every panel must show.

import { useEffect, useRef, useState } from 'react';
import type { ApiEnvelope } from '../lib/api';

export interface ApiState<T> {
  data: T | null;
  fetchedAt: number | null;
  stale: boolean;
  error: string | null;
}

export function useApi<T>(
  fetcher: () => Promise<ApiEnvelope<T>>,
  intervalMs: number,
): ApiState<T> {
  const [state, setState] = useState<ApiState<T>>({
    data: null,
    fetchedAt: null,
    stale: false,
    error: null,
  });
  const fetcherRef = useRef(fetcher);
  fetcherRef.current = fetcher;

  useEffect(() => {
    let cancelled = false;
    const tick = async () => {
      try {
        const env = await fetcherRef.current();
        if (!cancelled) {
          setState({
            data: env.data,
            fetchedAt: env.fetched_at * 1000,
            stale: env.stale,
            error: null,
          });
        }
      } catch (e) {
        // Keep last-known data; flag it stale rather than blanking the panel.
        if (!cancelled) {
          setState((prev) => ({
            ...prev,
            stale: prev.data !== null,
            error: e instanceof Error ? e.message : String(e),
          }));
        }
      }
    };
    tick();
    const id = setInterval(tick, intervalMs);
    return () => {
      cancelled = true;
      clearInterval(id);
    };
  }, [intervalMs]);

  return state;
}

/** A clock that ticks every `ms` — drives terminator redraw and UTC clock. */
export function useNow(ms: number): Date {
  const [now, setNow] = useState(() => new Date());
  useEffect(() => {
    const id = setInterval(() => setNow(new Date()), ms);
    return () => clearInterval(id);
  }, [ms]);
  return now;
}
