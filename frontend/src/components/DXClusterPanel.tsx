// DX cluster spot list with band/mode filtering (§8). Filters persist in
// IndexedDB via Dexie.

import { useMemo } from 'react';
import { useLiveQuery } from 'dexie-react-hooks';
import { Panel } from './Panel';
import type { ApiState } from '../hooks/useApi';
import type { SpotsPayload, Spot } from '../lib/api';
import { db, DEFAULT_FILTERS } from '../lib/db';
import { BAND_EDGES, bandOf } from '../lib/bands';

const MODES = ['CW', 'SSB', 'FT8', 'FT4', 'RTTY'];

function modeOf(spot: Spot): string | null {
  const c = spot.comment.toUpperCase();
  return MODES.find((m) => c.includes(m)) ?? null;
}

export function DXClusterPanel(props: { spots: ApiState<SpotsPayload> }) {
  const { data, fetchedAt, stale } = props.spots;
  const filters = useLiveQuery(() => db.filters.get('filters')) ?? DEFAULT_FILTERS;

  const filtered = useMemo(() => {
    const spots = data?.spots ?? [];
    return spots
      .filter((s) => {
        const band = bandOf(s.freq_khz);
        if (filters.bands.length && (!band || !filters.bands.includes(band)))
          return false;
        if (filters.modes.length) {
          const mode = modeOf(s);
          if (!mode || !filters.modes.includes(mode)) return false;
        }
        return true;
      })
      .slice(0, 30);
  }, [data, filters]);

  const toggle = (kind: 'bands' | 'modes', value: string) => {
    const cur = filters[kind];
    const next = cur.includes(value)
      ? cur.filter((v) => v !== value)
      : [...cur, value];
    db.filters.put({ ...filters, id: 'filters', [kind]: next });
  };

  const connBadge = data && (
    <span className={`badge ${data.status.connected ? 'badge-ok' : 'badge-warn'}`}>
      {data.status.connected ? (data.status.node ?? 'connected') : 'disconnected'}
    </span>
  );

  return (
    <Panel title="DX Cluster" fetchedAt={fetchedAt} stale={stale} badge={connBadge}>
      <div className="filter-row">
        {BAND_EDGES.map((b) => (
          <button
            key={b.name}
            className={`chip ${filters.bands.includes(b.name) ? 'chip-on' : ''}`}
            onClick={() => toggle('bands', b.name)}
          >
            {b.name}
          </button>
        ))}
      </div>
      <div className="filter-row">
        {MODES.map((m) => (
          <button
            key={m}
            className={`chip ${filters.modes.includes(m) ? 'chip-on' : ''}`}
            onClick={() => toggle('modes', m)}
          >
            {m}
          </button>
        ))}
      </div>
      {filtered.length === 0 ? (
        <p className="empty">no spots{filters.bands.length || filters.modes.length ? ' matching filters' : ''}</p>
      ) : (
        <table className="spot-table">
          <thead>
            <tr>
              <th>freq</th>
              <th>DX</th>
              <th>spotter</th>
              <th>info</th>
              <th>time</th>
            </tr>
          </thead>
          <tbody>
            {filtered.map((s, i) => (
              <tr key={`${s.dx_call}-${s.freq_khz}-${i}`}>
                <td className="mono">{s.freq_khz.toFixed(1)}</td>
                <td className="mono strong">{s.dx_call}</td>
                <td className="mono dim">{s.spotter}</td>
                <td className="dim">{s.comment.slice(0, 24)}</td>
                <td className="dim">{s.spot_time ?? ''}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </Panel>
  );
}
