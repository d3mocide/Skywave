// Space weather panel (§8): SFI / Kp / SSN with a Kp history sparkline.
// Shows smoothed SSN12 explicitly — it's the P533 model input (§4).

import { Panel } from './Panel';
import type { ApiState } from '../hooks/useApi';
import type { SpaceWeather } from '../lib/api';

function Sparkline(props: { values: number[]; max: number }) {
  const { values, max } = props;
  if (values.length < 2) return null;
  const w = 120;
  const h = 28;
  const pts = values
    .map(
      (v, i) =>
        `${(i / (values.length - 1)) * w},${h - (Math.min(v, max) / max) * h}`,
    )
    .join(' ');
  return (
    <svg width={w} height={h} className="sparkline" aria-label="Kp history">
      <polyline points={pts} fill="none" stroke="currentColor" strokeWidth="1.5" />
    </svg>
  );
}

export function SpaceWeatherPanel(props: { sw: ApiState<SpaceWeather> }) {
  const { data, fetchedAt, stale } = props.sw;
  const kpSeries = data?.kp_series ?? [];
  const latestKp = kpSeries.length ? kpSeries[kpSeries.length - 1].kp : null;
  const cycle = data?.solar_cycle ?? [];
  const latestCycle = cycle.length ? cycle[cycle.length - 1] : null;
  // Walk back to the newest month that actually has a smoothed value —
  // SSN12 lags by ~6 months by construction.
  const smoothed = [...cycle].reverse().find((c) => c.smoothed_ssn != null);

  return (
    <Panel title="Space Weather" fetchedAt={fetchedAt} stale={stale}>
      {data ? (
        <div className="stat-row">
          <div className="stat">
            <span className="stat-label">SFI</span>
            <span className="stat-value">{data.sfi?.Flux ?? '—'}</span>
          </div>
          <div className="stat">
            <span className="stat-label">Kp</span>
            <span
              className={`stat-value ${latestKp != null && latestKp >= 5 ? 'alert' : ''}`}
            >
              {latestKp?.toFixed(1) ?? '—'}
            </span>
            <Sparkline values={kpSeries.slice(-48).map((k) => k.kp)} max={9} />
          </div>
          <div className="stat">
            <span className="stat-label">SSN</span>
            <span className="stat-value">{latestCycle?.ssn ?? '—'}</span>
          </div>
          <div className="stat">
            <span className="stat-label" title="smoothed SSN12 — model input">
              SSN12
            </span>
            <span className="stat-value">
              {smoothed?.smoothed_ssn != null
                ? Math.round(smoothed.smoothed_ssn)
                : '—'}
            </span>
          </div>
        </div>
      ) : (
        <p className="empty">waiting for data…</p>
      )}
    </Panel>
  );
}
