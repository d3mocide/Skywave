// CME tracker (§8): DONKI catalog with client-side drag-based arrival
// estimates. Earth-directed events sorted first.

import { useMemo } from 'react';
import { Panel } from './Panel';
import type { ApiState } from '../hooks/useApi';
import type { CmeAnalysis } from '../lib/api';
import { estimateArrival, type ArrivalEstimate } from '../lib/cme';

interface Row {
  cme: CmeAnalysis;
  est: ArrivalEstimate | null;
}

export function CMEPanel(props: { cmes: ApiState<CmeAnalysis[]>; now: Date }) {
  const { data, fetchedAt, stale } = props.cmes;
  const now = props.now;

  const rows = useMemo<Row[]>(() => {
    if (!data) return [];
    return data
      .map((cme) => ({ cme, est: estimateArrival(cme) }))
      .sort((a, b) => {
        const ad = a.est?.earthDirected ? 0 : 1;
        const bd = b.est?.earthDirected ? 0 : 1;
        if (ad !== bd) return ad - bd;
        return (
          new Date(b.cme.time21_5).getTime() - new Date(a.cme.time21_5).getTime()
        );
      })
      .slice(0, 12);
  }, [data]);

  return (
    <Panel title="CME Tracker" fetchedAt={fetchedAt} stale={stale}>
      {rows.length === 0 ? (
        <p className="empty">no CME analyses in the last 30 days</p>
      ) : (
        <ul className="cme-list">
          {rows.map(({ cme, est }) => {
            const arrived = est && est.arrival.getTime() < now.getTime();
            return (
              <li key={cme.associatedCMEID + cme.time21_5} className="cme-row">
                <div className="cme-head">
                  <span
                    className={`badge ${est?.earthDirected ? 'badge-alert' : 'badge-dim'}`}
                  >
                    {est?.earthDirected ? 'Earth-directed' : 'off-axis'}
                  </span>
                  <span className="cme-speed">{cme.speed ?? '?'} km/s</span>
                  <span className="cme-time">
                    {cme.time21_5?.slice(0, 16)}Z
                  </span>
                </div>
                {est && (
                  <div className="cme-arrival">
                    {arrived ? 'est. arrived ' : 'est. arrival '}
                    {est.arrival.toISOString().slice(0, 16)}Z (
                    {est.transitHours.toFixed(0)} h transit,{' '}
                    {Math.round(est.speedAtEarthKms)} km/s at 1 AU)
                  </div>
                )}
              </li>
            );
          })}
        </ul>
      )}
    </Panel>
  );
}
