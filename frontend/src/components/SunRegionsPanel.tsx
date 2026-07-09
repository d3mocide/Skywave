// Active regions panel (TABS-REDESIGN-PLAN.md Phase E): a detail card for
// the selected region — including the 24 h per-region flare counts the API
// always carried but the UI never showed — above the sortable region table.
// Selection is shared with the disk overlay via SunCMEView.

import { Panel } from './Panel';
import type { ApiState } from '../hooks/useApi';
import type { SolarActivity, SolarRegion } from '../lib/api';
import { flareHistory, magClassNote, magRisk } from '../lib/solarRegions';

function riskClass(risk: 'high' | 'elevated' | 'low'): string {
  return risk === 'high' ? 'stat-bad strong' : risk === 'elevated' ? 'stat-warn' : '';
}

export function SunRegionsPanel(props: {
  activity: ApiState<SolarActivity>;
  regions: SolarRegion[];
  selected: number | null;
  onSelect: (region: number | null) => void;
}) {
  const { data, fetchedAt, stale } = props.activity;
  const sel = props.regions.find((r) => r.region === props.selected) ?? null;

  return (
    <Panel title="Active Regions" fetchedAt={fetchedAt} stale={stale}>
      {sel ? (
        <div className="region-detail">
          <div className="region-detail-head">
            <span className="strong">AR{sel.region}</span>
            <span className="mono dim">{sel.location ?? ''}</span>
            {flareHistory(sel) && (
              <span
                className="badge badge-warn"
                title="X-ray flares from this region, last 24 h"
              >
                {flareHistory(sel)} / 24 h
              </span>
            )}
          </div>
          <dl className="region-detail-grid">
            <dt>magnetic</dt>
            <dd>
              <span className={riskClass(magRisk(sel.mag_class))}>
                {sel.mag_class ?? '—'}
              </span>
              <span className="dim"> — {magClassNote(sel.mag_class)}</span>
            </dd>
            <dt>McIntosh</dt>
            <dd className="mono">{sel.spot_class ?? '—'}</dd>
            <dt>area</dt>
            <dd className="mono">
              {sel.area != null ? `${sel.area} μhem` : '—'}
            </dd>
            <dt>spots</dt>
            <dd className="mono">{sel.number_spots ?? '—'}</dd>
          </dl>
        </div>
      ) : (
        <p className="empty">select a region on the disk or in the table</p>
      )}

      {props.regions.length > 0 ? (
        <div className="region-scroll">
          <table className="spot-table">
            <thead>
              <tr>
                <th>region</th>
                <th>mag</th>
                <th>area</th>
                <th title="X-ray flares in the last 24 h">flares</th>
              </tr>
            </thead>
            <tbody>
              {props.regions.map((r) => {
                const risk = magRisk(r.mag_class);
                return (
                  <tr
                    key={r.region}
                    className={`spot-clickable ${props.selected === r.region ? 'row-selected' : ''}`}
                    onClick={() =>
                      props.onSelect(props.selected === r.region ? null : r.region)
                    }
                  >
                    <td className="strong">
                      AR{r.region}{' '}
                      <span className="dim">{r.location ?? ''}</span>
                    </td>
                    <td
                      className={riskClass(risk)}
                      title="Mount Wilson magnetic class — delta = highest flare risk"
                    >
                      {r.mag_class ?? '—'}
                    </td>
                    <td className="mono">{r.area ?? '—'}</td>
                    <td className="mono">{flareHistory(r) ?? '—'}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      ) : (
        data && <p className="empty">no numbered active regions — blank Sun</p>
      )}
    </Panel>
  );
}
