// DX Cluster dashboard (TABS-REDESIGN-PLAN.md Phase C). The table answers
// "what was spotted"; the analytics rail answers "which band is hot and can
// I work it": per-band activity bars, a band×time heatmap over the trailing
// 2 h (fed by the Dexie spot-history window), and a most-spotted list.
// Repeat spots of the same station+frequency collapse into one row with a
// spotter count; rows fade with age.

import { useMemo, useState } from 'react';
import { useLiveQuery } from 'dexie-react-hooks';
import { Panel } from './Panel';
import { useNow, type ApiState } from '../hooks/useApi';
import type { Spot, SpotsPayload } from '../lib/api';
import {
  db,
  DEFAULT_FILTERS,
  SPOT_HISTORY_WINDOW_S,
  type SpotHistoryRow,
} from '../lib/db';
import {
  BAND_EDGES,
  BAND_GROUP_COLORS,
  bandGroup,
  bandOf,
} from '../lib/bands';
import { callToLatLon } from '../lib/prefixes';
import { distanceKm, latLonToGrid, midpoint, type LatLon } from '../lib/geo';
import { solarElevation } from '../lib/solar';
import { estimateReliability } from '../lib/propagation/estimator';

const MODES = ['CW', 'SSB', 'FT8', 'FT4', 'RTTY'];
const MAX_ROWS = 200;
/** Below this estimated reliability a band is treated as closed from DE. */
const WORKABLE_MIN = 0.1;

function modeOf(spot: { comment: string }): string | null {
  const c = spot.comment.toUpperCase();
  return MODES.find((m) => c.includes(m)) ?? null;
}

/** Age → row fade class; fresh spots pop, hour-old ones recede. */
function ageClass(ageS: number): string {
  if (ageS < 5 * 60) return 'spot-age-fresh';
  if (ageS < 20 * 60) return 'spot-age-recent';
  if (ageS < 60 * 60) return 'spot-age-old';
  return 'spot-age-stale';
}

function ageText(ageS: number): string {
  if (ageS < 60) return 'now';
  if (ageS < 3600) return `${Math.floor(ageS / 60)}m`;
  return `${Math.floor(ageS / 3600)}h${Math.floor((ageS % 3600) / 60)}m`;
}

interface DedupRow {
  spot: Spot; // most recent representative
  count: number; // distinct spotters
  band: string | null;
  mode: string | null;
  loc: LatLon | null;
}

export function DXClusterView(props: {
  spots: ApiState<SpotsPayload>;
  onSelectDx: (grid: string) => void;
  de: LatLon | null;
  ssn12: number | null;
}) {
  const { data, fetchedAt, stale } = props.spots;
  const now = useNow(30_000);
  const filters = useLiveQuery(() => db.filters.get('filters')) ?? DEFAULT_FILTERS;
  const [search, setSearch] = useState('');
  const history =
    useLiveQuery(() =>
      db.spotHistory
        .where('received_at')
        .above(Date.now() / 1000 - SPOT_HISTORY_WINDOW_S)
        .toArray(),
    ) ?? [];

  const canEstimate = props.de != null && props.ssn12 != null;

  // Estimated band reliability from DE toward each spot's prefix location.
  // Closed-form estimator, memoized per call+band — deliberately NOT the
  // P533 engine (200 wasm calls per poll would stall the table).
  const workable = useMemo(() => {
    const cache = new Map<string, boolean>();
    return (row: DedupRow): boolean | null => {
      if (!canEstimate || !row.band || !row.loc) return null;
      const key = `${row.spot.dx_call}|${row.band}`;
      const hit = cache.get(key);
      if (hit !== undefined) return hit;
      const r = estimateReliability({
        mhz: row.spot.freq_khz / 1000,
        distanceKm: distanceKm(props.de!, row.loc),
        ssn12: props.ssn12!,
        midpathSolarElev: solarElevation(midpoint(props.de!, row.loc), now),
      });
      const ok = r >= WORKABLE_MIN;
      cache.set(key, ok);
      return ok;
    };
  }, [canEstimate, props.de, props.ssn12, now]);

  const rows = useMemo<DedupRow[]>(() => {
    const spots = data?.spots ?? [];
    const byKey = new Map<string, { spot: Spot; spotters: Set<string> }>();
    for (const s of spots) {
      const key = `${s.dx_call}|${Math.round(s.freq_khz)}`;
      const cur = byKey.get(key);
      if (cur) {
        cur.spotters.add(s.spotter);
        if (s.received_at > cur.spot.received_at) cur.spot = s;
      } else {
        byKey.set(key, { spot: s, spotters: new Set([s.spotter]) });
      }
    }
    const q = search.trim().toUpperCase();
    return [...byKey.values()]
      .map(({ spot, spotters }) => ({
        spot,
        count: spotters.size,
        band: bandOf(spot.freq_khz),
        mode: modeOf(spot),
        loc: callToLatLon(spot.dx_call),
      }))
      .filter((r) => {
        if (filters.bands.length && (!r.band || !filters.bands.includes(r.band)))
          return false;
        if (filters.modes.length && (!r.mode || !filters.modes.includes(r.mode)))
          return false;
        if (q && !r.spot.dx_call.toUpperCase().includes(q)) return false;
        if (filters.workableOnly && workable(r) === false) return false;
        return true;
      })
      .sort((a, b) => b.spot.received_at - a.spot.received_at)
      .slice(0, MAX_ROWS);
  }, [data, filters, search, workable]);

  const toggle = (kind: 'bands' | 'modes', value: string) => {
    const cur = filters[kind];
    const next = cur.includes(value)
      ? cur.filter((v) => v !== value)
      : [...cur, value];
    db.filters.put({ ...DEFAULT_FILTERS, ...filters, id: 'filters', [kind]: next });
  };

  // ── Analytics over the trailing history window ──────────────────────────
  const nowS = now.getTime() / 1000;

  const bandCounts = useMemo(() => {
    const cutoff = nowS - 3600;
    const counts = new Map<string, number>();
    for (const s of history) {
      if (s.received_at < cutoff) continue;
      const b = bandOf(s.freq_khz);
      if (b) counts.set(b, (counts.get(b) ?? 0) + 1);
    }
    return counts;
  }, [history, nowS]);
  const maxBandCount = Math.max(1, ...bandCounts.values());

  const BIN_MIN = 15;
  const N_BINS = SPOT_HISTORY_WINDOW_S / 60 / BIN_MIN; // 8
  const heatmap = useMemo(() => {
    const grid = new Map<string, number[]>();
    for (const s of history) {
      const b = bandOf(s.freq_khz);
      if (!b) continue;
      const ageBins = Math.floor((nowS - s.received_at) / (BIN_MIN * 60));
      if (ageBins < 0 || ageBins >= N_BINS) continue;
      const rowArr = grid.get(b) ?? new Array(N_BINS).fill(0);
      rowArr[N_BINS - 1 - ageBins] += 1;
      grid.set(b, rowArr);
    }
    const bands = BAND_EDGES.map((b) => b.name).filter((b) => grid.has(b));
    const max = Math.max(1, ...[...grid.values()].flat());
    return { grid, bands, max };
  }, [history, nowS, N_BINS]);

  const topDx = useMemo(() => {
    const byCall = new Map<
      string,
      { count: number; bands: Set<string>; latest: SpotHistoryRow }
    >();
    for (const s of history) {
      const cur = byCall.get(s.dx_call);
      if (cur) {
        cur.count += 1;
        const b = bandOf(s.freq_khz);
        if (b) cur.bands.add(b);
        if (s.received_at > cur.latest.received_at) cur.latest = s;
      } else {
        const b = bandOf(s.freq_khz);
        byCall.set(s.dx_call, {
          count: 1,
          bands: new Set(b ? [b] : []),
          latest: s,
        });
      }
    }
    return [...byCall.entries()]
      .sort((a, b) => b[1].count - a[1].count)
      .slice(0, 8);
  }, [history]);

  const connBadge = data && (
    <span className={`badge ${data.status.connected ? 'badge-ok' : 'badge-warn'}`}>
      {data.status.connected ? (data.status.node ?? 'connected') : 'disconnected'}
    </span>
  );

  const selectCall = (call: string) => {
    const loc = callToLatLon(call);
    if (loc) props.onSelectDx(latLonToGrid(loc, 4));
  };

  return (
    <div className="view-dash">
      <section className="span-8">
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
            <input
              className="spot-search mono"
              type="search"
              placeholder="call / prefix…"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              aria-label="filter by DX call or prefix"
            />
            <button
              className={`chip ${filters.workableOnly ? 'chip-on' : ''}`}
              disabled={!canEstimate}
              title={
                canEstimate
                  ? 'hide spots on bands the estimator gives ~0% reliability from your DE (coarse climatological estimate, not P.533)'
                  : 'set your DE grid on Overview to enable'
              }
              onClick={() =>
                db.filters.put({
                  ...DEFAULT_FILTERS,
                  ...filters,
                  id: 'filters',
                  workableOnly: !filters.workableOnly,
                })
              }
            >
              workable (est.)
            </button>
          </div>
          {rows.length === 0 ? (
            <p className="empty">
              no spots
              {filters.bands.length || filters.modes.length || search || filters.workableOnly
                ? ' matching filters'
                : ''}
            </p>
          ) : (
            <div className="spot-scroll">
              <table className="spot-table">
                <thead>
                  <tr>
                    <th>freq</th>
                    <th>DX</th>
                    <th>spotter</th>
                    <th>info</th>
                    <th className="spot-age-col">age</th>
                  </tr>
                </thead>
                <tbody>
                  {rows.map((r) => {
                    const s = r.spot;
                    const age = Math.max(0, nowS - s.received_at);
                    const grp = r.band ? bandGroup(r.band) : null;
                    return (
                      <tr
                        key={`${s.dx_call}-${Math.round(s.freq_khz)}`}
                        className={`${r.loc ? 'spot-clickable' : ''} ${ageClass(age)}`}
                        title={
                          r.loc
                            ? `set ${s.dx_call} as DX target (approx. by prefix)${r.band ? ` · ${r.band}` : ''}`
                            : undefined
                        }
                        onClick={r.loc ? () => selectCall(s.dx_call) : undefined}
                      >
                        <td className="mono">
                          {grp && (
                            <span
                              className="band-dot"
                              style={{ background: BAND_GROUP_COLORS[grp] }}
                              aria-hidden="true"
                            />
                          )}
                          {s.freq_khz.toFixed(1)}
                        </td>
                        <td className="mono strong">{s.dx_call}</td>
                        <td className="mono dim">
                          {s.spotter}
                          {r.count > 1 && (
                            <span className="spot-count" title={`${r.count} spotters`}>
                              {' '}
                              ×{r.count}
                            </span>
                          )}
                        </td>
                        <td className="dim">{s.comment.slice(0, 28)}</td>
                        <td className="mono dim spot-age-col">{ageText(age)}</td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
        </Panel>
      </section>

      <section className="span-4">
        <Panel title="Band Activity" fetchedAt={fetchedAt} stale={stale}>
          {bandCounts.size === 0 ? (
            <p className="empty">no spots in the last hour</p>
          ) : (
            <ul className="band-list">
              {BAND_EDGES.filter((b) => bandCounts.has(b.name)).map((b) => {
                const n = bandCounts.get(b.name)!;
                return (
                  <li key={b.name} className="band-row">
                    <span className="band-name">{b.name}</span>
                    <div className="band-bar">
                      <div
                        className="band-bar-fill"
                        style={{
                          width: `${(n / maxBandCount) * 100}%`,
                          background: BAND_GROUP_COLORS[bandGroup(b.name)],
                        }}
                      />
                    </div>
                    <span className="band-pct mono">{n}</span>
                  </li>
                );
              })}
            </ul>
          )}
          <p className="footnote">spots per band · trailing 60 min</p>
        </Panel>

        <Panel title="Activity Heatmap" fetchedAt={fetchedAt} stale={stale}>
          {heatmap.bands.length === 0 ? (
            <p className="empty">accumulating spot history…</p>
          ) : (
            <div className="heat">
              {heatmap.bands.map((b) => (
                <div key={b} className="heat-row">
                  <span className="band-name">{b}</span>
                  {heatmap.grid.get(b)!.map((n, i) => (
                    <span
                      key={i}
                      className="heat-cell"
                      title={`${b} · ${n} spot${n === 1 ? '' : 's'}`}
                      style={{
                        background:
                          n === 0
                            ? undefined
                            : `color-mix(in srgb, ${BAND_GROUP_COLORS[bandGroup(b)]} ${Math.round(
                                20 + (n / heatmap.max) * 80,
                              )}%, transparent)`,
                      }}
                    />
                  ))}
                </div>
              ))}
            </div>
          )}
          <p className="footnote">
            15-min bins · trailing 2 h (accumulated locally) · newest right
          </p>
        </Panel>

        <Panel title="Most Spotted" fetchedAt={fetchedAt} stale={stale}>
          {topDx.length === 0 ? (
            <p className="empty">accumulating spot history…</p>
          ) : (
            <table className="spot-table">
              <tbody>
                {topDx.map(([call, info]) => {
                  const loc = callToLatLon(call);
                  return (
                    <tr
                      key={call}
                      className={loc ? 'spot-clickable' : ''}
                      onClick={loc ? () => selectCall(call) : undefined}
                      title={loc ? 'set as DX target (approx. by prefix)' : undefined}
                    >
                      <td className="mono strong">{call}</td>
                      <td className="mono">{info.count}×</td>
                      <td className="dim">{[...info.bands].join(' ')}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          )}
          <p className="footnote">pileup detector — spot count · trailing 2 h</p>
        </Panel>
      </section>
    </div>
  );
}
