// Space weather panel (§8): SFI / Kp / SSN, GOES X-ray flux with flare
// class, DSCOVR solar wind (the ~1 h storm early-warning), and the NOAA
// 3-day Kp forecast. Shows smoothed SSN12 explicitly — it's the P533
// model input (§4).

import { useMemo } from 'react';
import { Panel } from './Panel';
import type { ApiState } from '../hooks/useApi';
import type {
  KpForecastPoint,
  SolarWind,
  SpaceWeather,
  XraySample,
} from '../lib/api';
import { xrayNow } from '../lib/xray';

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

/** Log-scale GOES X-ray flux over 6 h with the C/M/X decade gridlines that
 * make a flare readable at a glance. */
function XrayChart(props: { series: XraySample[] }) {
  const { series } = props;
  const w = 250;
  const h = 60;
  const LOG_MIN = -8; // A-class floor
  const LOG_MAX = -3; // above X10
  const y = (flux: number) =>
    h - ((Math.log10(Math.max(flux, 1e-9)) - LOG_MIN) / (LOG_MAX - LOG_MIN)) * h;
  const pts = series
    .map((s, i) => `${((i / (series.length - 1)) * w).toFixed(1)},${y(s.flux).toFixed(1)}`)
    .join(' ');
  const decades: { flux: number; label: string }[] = [
    { flux: 1e-6, label: 'C' },
    { flux: 1e-5, label: 'M' },
    { flux: 1e-4, label: 'X' },
  ];
  return (
    <svg
      width="100%"
      viewBox={`0 0 ${w} ${h}`}
      className="xray-chart"
      aria-label="GOES X-ray flux, last 6 hours"
    >
      {decades.map((d) => (
        <g key={d.label}>
          <line
            x1={0}
            x2={w}
            y1={y(d.flux)}
            y2={y(d.flux)}
            className="xray-grid"
          />
          <text x={2} y={y(d.flux) - 2} className="xray-grid-label">
            {d.label}
          </text>
        </g>
      ))}
      <polyline points={pts} fill="none" className="xray-line" strokeWidth="1.5" />
    </svg>
  );
}

/** 3-day Kp forecast as 3-hour bars colored by storm level. */
function KpForecastStrip(props: { forecast: KpForecastPoint[]; now: Date }) {
  const bins = useMemo(() => {
    const cutoff = props.now.getTime() - 3 * 3600_000;
    return props.forecast
      .filter(
        (p) => new Date(p.time.replace(' ', 'T') + 'Z').getTime() >= cutoff,
      )
      .slice(0, 24);
  }, [props.forecast, props.now]);
  if (!bins.length) return null;
  return (
    <div className="kpf">
      <div className="kpf-bars">
        {bins.map((b) => (
          <div
            key={b.time}
            className={`kpf-bar ${b.kp >= 5 ? 'kpf-storm' : b.kp >= 4 ? 'kpf-active' : ''} ${
              b.state === 'observed' ? 'kpf-observed' : ''
            }`}
            style={{ height: `${Math.max(8, (b.kp / 9) * 100)}%` }}
            title={`${b.time}Z · Kp ${b.kp.toFixed(2)} (${b.state})`}
          />
        ))}
      </div>
      <div className="kpf-caption">
        <span>Kp forecast — next {Math.round((bins.length * 3) / 24)} days</span>
        {bins.some((b) => b.kp >= 5) && (
          <span className="stat-bad">storm periods ahead</span>
        )}
      </div>
    </div>
  );
}

export function SpaceWeatherPanel(props: {
  sw: ApiState<SpaceWeather>;
  xray: ApiState<XraySample[]>;
  solarWind: ApiState<SolarWind>;
  kpForecast: ApiState<KpForecastPoint[]>;
  now: Date;
}) {
  const { data, fetchedAt, stale } = props.sw;
  const kpSeries = data?.kp_series ?? [];
  const latestKp = kpSeries.length ? kpSeries[kpSeries.length - 1].kp : null;
  const cycle = data?.solar_cycle ?? [];
  const latestCycle = cycle.length ? cycle[cycle.length - 1] : null;
  // Walk back to the newest month that actually has a smoothed value —
  // SSN12 lags by ~6 months by construction.
  const smoothed = [...cycle].reverse().find((c) => c.smoothed_ssn != null);

  const xn = useMemo(() => xrayNow(props.xray.data), [props.xray.data]);

  const wind = useMemo(() => {
    const plasma = props.solarWind.data?.plasma;
    const mag = props.solarWind.data?.mag;
    const lastOf = <T extends { [k: string]: unknown }>(
      arr: T[] | null | undefined,
      key: string,
    ) => {
      if (!arr) return null;
      for (let i = arr.length - 1; i >= 0; i--) {
        const v = arr[i][key];
        if (v != null) return v as number;
      }
      return null;
    };
    return {
      speed: lastOf(plasma, 'speed'),
      density: lastOf(plasma, 'density'),
      bz: lastOf(mag, 'bz'),
      bt: lastOf(mag, 'bt'),
    };
  }, [props.solarWind.data]);

  const anyStale =
    stale || props.xray.stale || props.solarWind.stale || props.kpForecast.stale;

  return (
    <Panel
      title="Space Weather"
      fetchedAt={fetchedAt}
      stale={anyStale}
      badge={
        xn?.r ? (
          <span className="badge badge-alert" title="NOAA radio blackout scale">
            {xn.r.label}
          </span>
        ) : xn?.rising ? (
          <span className="badge badge-warn">flare rising</span>
        ) : null
      }
    >
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
          {xn && (
            <div className="stat">
              <span className="stat-label" title="GOES 0.1–0.8 nm X-ray flux">
                X-ray
              </span>
              <span
                className={`stat-value ${
                  xn.cls.letter === 'X'
                    ? 'alert'
                    : xn.cls.letter === 'M'
                      ? 'warn'
                      : ''
                }`}
              >
                {xn.cls.label}
              </span>
            </div>
          )}
        </div>
      ) : (
        <p className="empty">waiting for data…</p>
      )}

      {props.xray.data && props.xray.data.length > 1 && (
        <XrayChart series={props.xray.data} />
      )}

      {(wind.speed != null || wind.bz != null) && (
        <div className="sw-wind" title="DSCOVR/ACE at L1 — arrives ~30–60 min before Earth">
          <span className="stat-label">solar wind</span>
          <span className="mono">
            {wind.speed != null ? `${Math.round(wind.speed)} km/s` : '—'}
          </span>
          <span className="mono dim">
            {wind.density != null ? `${wind.density.toFixed(1)} p/cm³` : ''}
          </span>
          <span
            className={`mono ${
              wind.bz != null && wind.bz <= -10
                ? 'stat-bad strong'
                : wind.bz != null && wind.bz <= -5
                  ? 'stat-warn'
                  : ''
            }`}
            title="IMF Bz — sustained south (negative) opens the magnetosphere"
          >
            Bz {wind.bz != null ? `${wind.bz > 0 ? '+' : ''}${wind.bz.toFixed(1)}` : '—'} nT
          </span>
          {wind.bz != null && wind.bz <= -5 && (
            <span className="badge badge-warn">Bz south</span>
          )}
        </div>
      )}

      {props.kpForecast.data && (
        <KpForecastStrip forecast={props.kpForecast.data} now={props.now} />
      )}
    </Panel>
  );
}
