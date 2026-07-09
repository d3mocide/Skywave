// CME tracker (§8): DONKI catalog with client-side drag-based arrival
// estimates. Earth-directed events sorted first, the next expected impact
// gets a live countdown, and in-flight events show their Sun→Earth position
// from the same DBM integration that produced the arrival time.

import { useMemo, useState } from 'react';
import { Panel } from './Panel';
import { HelioView } from './HelioView';
import type { ApiState } from '../hooks/useApi';
import type { CmeAnalysis } from '../lib/api';
import {
  estimateArrival,
  sunEarthFraction,
  stormPotential,
  type ArrivalEstimate,
} from '../lib/cme';

interface Row {
  cme: CmeAnalysis;
  est: ArrivalEstimate | null;
}

function countdown(ms: number): string {
  const h = Math.floor(ms / 3600_000);
  const m = Math.floor((ms % 3600_000) / 60_000);
  return `T−${h}h ${m.toString().padStart(2, '0')}m`;
}

export function CMEPanel(props: { cmes: ApiState<CmeAnalysis[]>; now: Date }) {
  const { data, fetchedAt, stale } = props.cmes;
  const now = props.now;
  const [selected, setSelected] = useState<string | null>(null);
  const [earthOnly, setEarthOnly] = useState(false);

  const rows = useMemo<Row[]>(() => {
    if (!data) return [];
    return data
      .map((cme) => ({ cme, est: estimateArrival(cme) }))
      .filter((r) => !earthOnly || r.est?.earthDirected)
      .sort((a, b) => {
        const ad = a.est?.earthDirected ? 0 : 1;
        const bd = b.est?.earthDirected ? 0 : 1;
        if (ad !== bd) return ad - bd;
        return (
          new Date(b.cme.time21_5).getTime() - new Date(a.cme.time21_5).getTime()
        );
      })
      .slice(0, 12);
  }, [data, earthOnly]);

  // Next impact: the earliest earth-directed arrival still in the future.
  const next = useMemo(() => {
    const inbound = rows.filter(
      (r) => r.est?.earthDirected && r.est.arrival.getTime() > now.getTime(),
    );
    if (!inbound.length) return null;
    return inbound.reduce((a, b) =>
      a.est!.arrival.getTime() <= b.est!.arrival.getTime() ? a : b,
    );
  }, [rows, now]);

  return (
    <Panel
      title="CME Tracker"
      fetchedAt={fetchedAt}
      stale={stale}
      badge={
        <button
          className={`chip ${earthOnly ? 'chip-on' : ''}`}
          onClick={() => setEarthOnly((v) => !v)}
          title="show only earth-directed analyses"
        >
          earth-directed
        </button>
      }
    >
      {next && next.est && (
        <div className="cme-next">
          <div className="cme-next-head">
            <span className="cme-next-count mono">
              {countdown(next.est.arrival.getTime() - now.getTime())}
            </span>
            <span className="dim">to next est. impact</span>
          </div>
          <div className="cme-arrival">
            {Math.round(next.est.speedAtEarthKms)} km/s at 1 AU ·{' '}
            {(() => {
              const p = stormPotential(next.est.speedAtEarthKms);
              return (
                <span className={p.severe ? 'cme-potential-severe' : ''}>
                  Kp ~{p.kpEst.toFixed(1)} ({p.label})
                </span>
              );
            })()}
          </div>
        </div>
      )}
      <HelioView rows={rows} now={now} selected={selected} onSelect={setSelected} />
      {rows.length === 0 ? (
        <p className="empty">no CME analyses in the last 30 days</p>
      ) : (
        <ul className="cme-list">
          {rows.map(({ cme, est }) => {
            const arrived = est && est.arrival.getTime() < now.getTime();
            const inFlight = est?.earthDirected && !arrived;
            const frac = inFlight ? sunEarthFraction(cme, now) : null;
            const id = cme.associatedCMEID + cme.time21_5;
            return (
              <li
                key={id}
                className={`cme-row cme-selectable ${selected === id ? 'row-selected' : ''} ${arrived ? 'cme-arrived' : ''}`}
                onClick={() => setSelected((s) => (s === id ? null : id))}
              >
                <div className="cme-head">
                  <span
                    className={`badge ${est?.earthDirected ? 'badge-alert' : 'badge-dim'}`}
                  >
                    {est?.earthDirected ? 'Earth-directed' : 'off-axis'}
                  </span>
                  <span className="cme-speed">{cme.speed ?? '?'} km/s</span>
                  {cme.halfAngle != null && (
                    <span className="dim" title="angular width (2 × half-angle)">
                      {Math.round(cme.halfAngle * 2)}° wide
                    </span>
                  )}
                  {cme.link ? (
                    <a
                      className="cme-time"
                      href={cme.link}
                      target="_blank"
                      rel="noopener noreferrer"
                      title="open in NASA DONKI"
                      onClick={(e) => e.stopPropagation()}
                    >
                      {cme.time21_5?.slice(0, 16)}Z ↗
                    </a>
                  ) : (
                    <span className="cme-time">{cme.time21_5?.slice(0, 16)}Z</span>
                  )}
                </div>
                {est && (
                  <div className="cme-arrival">
                    {arrived ? 'est. arrived ' : 'est. arrival '}
                    {est.arrival.toISOString().slice(0, 16)}Z (
                    {est.transitHours.toFixed(0)} h transit,{' '}
                    {Math.round(est.speedAtEarthKms)} km/s at 1 AU)
                  </div>
                )}
                {frac != null && frac > 0 && (
                  <div
                    className="cme-track"
                    title={`~${Math.round(frac * 100)}% of Sun→Earth distance`}
                  >
                    <span className="cme-track-sun">☉</span>
                    <span className="cme-track-bar">
                      <span
                        className="cme-track-fill"
                        style={{ width: `${Math.round(frac * 100)}%` }}
                      />
                    </span>
                    <span className="cme-track-earth">⊕</span>
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
