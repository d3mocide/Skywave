// Reception panel — live PSKReporter reception reports for the operator's
// own signal (DESIGN.md §7). Answers the question the coverage heatmap can
// only model: "who is *actually* hearing me right now, and how well?"
// Direction flips to "who I hear" for stations that upload their own
// decodes. Rows are per-station (latest report wins); clicking a call sets
// it as the DX target — these come with real grids, not prefix guesses.

import { useMemo } from 'react';
import { Panel } from './Panel';
import type { PskState } from '../hooks/usePskReports';
import type { PskDirection, PskReport } from '../lib/pskreporter';
import { BAND_GROUP_COLORS, bandGroup } from '../lib/bands';
import { distanceKm, gridToLatLon, type LatLon } from '../lib/geo';

const MAX_ROWS = 12;

interface StationRow {
  report: PskReport;
  pos: LatLon | null;
  km: number | null;
}

function ageLabel(t: number, nowMs: number): string {
  const s = Math.max(0, nowMs / 1000 - t);
  if (s < 90) return `${Math.round(s)}s`;
  return `${Math.round(s / 60)}m`;
}

export function ReceptionPanel(props: {
  state: PskState;
  dir: PskDirection;
  onDir: (dir: PskDirection) => void;
  de: LatLon | null;
  now: Date;
  onSelectDx: (grid: string) => void;
}) {
  const { state, dir, de } = props;

  const counts = useMemo(() => {
    const tx = new Set<string>();
    const rx = new Set<string>();
    for (const r of state.reports) (r.dir === 'tx' ? tx : rx).add(r.call);
    return { tx: tx.size, rx: rx.size };
  }, [state.reports]);

  // One row per station, newest report first (reports are kept sorted).
  const rows = useMemo<StationRow[]>(() => {
    const seen = new Set<string>();
    const out: StationRow[] = [];
    for (const report of state.reports) {
      if (report.dir !== dir || seen.has(report.call)) continue;
      seen.add(report.call);
      const pos = report.grid ? gridToLatLon(report.grid) : null;
      out.push({
        report,
        pos,
        km: pos && de ? distanceKm(de, pos) : null,
      });
    }
    return out;
  }, [state.reports, dir, de]);

  // Per-band summary across the whole window: station count + best DX.
  const bands = useMemo(() => {
    const by = new Map<string, { calls: Set<string>; bestKm: number }>();
    for (const row of rows) {
      const band = row.report.band ?? '?';
      let e = by.get(band);
      if (!e) by.set(band, (e = { calls: new Set(), bestKm: 0 }));
      e.calls.add(row.report.call);
      if (row.km != null && row.km > e.bestKm) e.bestKm = row.km;
    }
    return [...by.entries()].sort((a, b) => b[1].calls.size - a[1].calls.size);
  }, [rows]);

  const badge =
    state.status === 'live' ? (
      <span className="badge badge-ok">live</span>
    ) : state.status === 'connecting' ? (
      <span className="badge badge-dim">connecting</span>
    ) : null;

  return (
    <Panel
      title="Reception"
      badge={badge}
      stale={state.status === 'down' && state.reports.length > 0}
      fetchedAt={state.lastAt}
    >
      {state.status === 'off' ? (
        <p className="empty">
          set your callsign in the Station panel — live PSKReporter reports of
          who hears your signal appear here
        </p>
      ) : (
        <>
          <div className="psk-dir-row">
            <button
              className={`chip ${dir === 'tx' ? 'chip-on' : ''}`}
              onClick={() => props.onDir('tx')}
              title="stations that decoded your transmissions"
            >
              Heard by {counts.tx}
            </button>
            <button
              className={`chip ${dir === 'rx' ? 'chip-on' : ''}`}
              onClick={() => props.onDir('rx')}
              title="stations your receiver decoded (needs your station uploading to pskreporter.info)"
            >
              Hearing {counts.rx}
            </button>
          </div>
          {bands.length > 0 && (
            <div className="psk-bands">
              {bands.map(([band, e]) => (
                <span key={band} className="psk-band mono">
                  <span
                    className="map-legend-dot"
                    style={{ background: BAND_GROUP_COLORS[bandGroup(band)] }}
                  />
                  {band} ×{e.calls.size}
                  {e.bestKm > 0 && <> · {Math.round(e.bestKm).toLocaleString()} km</>}
                </span>
              ))}
            </div>
          )}
          {rows.length === 0 ? (
            <p className="empty">
              {state.status !== 'live'
                ? 'PSKReporter feed unreachable — reports resume when it reconnects'
                : dir === 'tx'
                  ? 'no reports in the last 30 min — call CQ on FT8/FT4/WSPR and stations report within seconds'
                  : 'no decodes uploaded by your station in the last 30 min'}
            </p>
          ) : (
            <table className="spot-table psk-table">
              <thead>
                <tr>
                  <th>Age</th>
                  <th>Band</th>
                  <th>Call</th>
                  <th>Grid</th>
                  <th title="signal-to-noise as decoded">dB</th>
                  <th>km</th>
                </tr>
              </thead>
              <tbody>
                {rows.slice(0, MAX_ROWS).map(({ report: r, km }) => (
                  <tr
                    key={r.call}
                    className={r.grid ? 'spot-clickable' : ''}
                    title={r.grid ? `set ${r.call} as DX target (reported grid)` : undefined}
                    onClick={r.grid ? () => props.onSelectDx(r.grid as string) : undefined}
                  >
                    <td className="dim mono">{ageLabel(r.t, props.now.getTime())}</td>
                    <td className="mono">
                      {r.band && (
                        <span
                          className="band-dot"
                          style={{ background: BAND_GROUP_COLORS[bandGroup(r.band)] }}
                          aria-hidden="true"
                        />
                      )}
                      {r.band ?? '?'}
                    </td>
                    <td className="mono strong">{r.call}</td>
                    <td className="mono dim">{r.grid ?? '—'}</td>
                    <td className="mono">{r.snr != null ? (r.snr > 0 ? `+${r.snr}` : r.snr) : '—'}</td>
                    <td className="mono">{km != null ? Math.round(km).toLocaleString() : '—'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
          {rows.length > MAX_ROWS && (
            <p className="footnote">
              +{rows.length - MAX_ROWS} more stations in the last 30 min — all are on the map
              layer
            </p>
          )}
        </>
      )}
    </Panel>
  );
}
