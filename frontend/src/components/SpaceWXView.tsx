// Space WX dashboard (TABS-REDESIGN-PLAN.md Phase B). Replaces the single
// SpaceWeatherPanel with a grid that shows the *trend* behind every number:
// stat tiles with sparklines, the GOES X-ray chart with labeled flare peaks,
// full DSCOVR solar-wind and IMF time series (previously reduced to one
// latest-value line), Kp observed→forecast, the solar-cycle tail, and a
// plain-language "HF impact" translation panel.

import { useMemo, useState } from 'react';
import { Panel } from './Panel';
import { StatTile, type Tone } from './StatTile';
import { TimeSeriesChart, type TsMarker, type TsSeries } from './TimeSeriesChart';
import { useApi, type ApiState } from '../hooks/useApi';
import {
  api,
  type Fof2Station,
  type KpForecastPoint,
  type SolarWind,
  type SpaceWeather,
  type XrayRange,
  type XraySample,
} from '../lib/api';
import { classifyFlux, flarePeaks, highestAffectedFreq, xrayNow } from '../lib/xray';

const HOUR = 3600_000;

function toPoints(
  rows: { time: string }[] | null | undefined,
  key: string,
): { t: number; v: number }[] {
  if (!rows) return [];
  const out: { t: number; v: number }[] = [];
  for (const row of rows) {
    const v = (row as Record<string, unknown>)[key];
    const t = new Date(row.time.includes('T') ? row.time : row.time.replace(' ', 'T') + 'Z').getTime();
    if (typeof v === 'number' && !isNaN(t)) out.push({ t, v });
  }
  return out;
}

function lastV(pts: { v: number }[]): number | null {
  return pts.length ? pts[pts.length - 1].v : null;
}

/** Value ~`backMs` before the latest sample, for trend deltas. */
function valueAgo(pts: { t: number; v: number }[], backMs: number): number | null {
  if (pts.length < 2) return null;
  const target = pts[pts.length - 1].t - backMs;
  let best = pts[0];
  for (const p of pts) {
    if (Math.abs(p.t - target) < Math.abs(best.t - target)) best = p;
  }
  return best === pts[pts.length - 1] ? null : best.v;
}

function deltaText(cur: number | null, ago: number | null, label: string, digits = 0): { text: string; tone?: Tone } | null {
  if (cur == null || ago == null) return null;
  const d = cur - ago;
  if (Math.abs(d) < 0.5 * Math.pow(10, -digits)) return { text: `— steady ${label}` };
  return { text: `${d > 0 ? '▲' : '▼'} ${Math.abs(d).toFixed(digits)} ${label}` };
}

/** Kp observed→forecast bars: trailing 24 h of observations flowing into
 * the 3-day NOAA forecast, with G-scale gridlines. */
function KpStrip(props: { forecast: KpForecastPoint[]; now: Date }) {
  const bins = useMemo(() => {
    const cutoff = props.now.getTime() - 24 * HOUR;
    return props.forecast.filter(
      (p) => new Date(p.time.replace(' ', 'T') + 'Z').getTime() >= cutoff,
    );
  }, [props.forecast, props.now]);
  if (!bins.length) return null;
  const nowIdx = bins.findIndex((b) => b.state !== 'observed');
  return (
    <div className="kpf kpf-tall">
      <div className="kpf-plot">
        <div className="kpf-bars">
          {bins.map((b, i) => (
            <div
              key={b.time}
              className={`kpf-bar ${b.kp >= 5 ? 'kpf-storm' : b.kp >= 4 ? 'kpf-active' : ''} ${
                b.state === 'observed' ? 'kpf-observed' : ''
              } ${i === nowIdx ? 'kpf-now' : ''}`}
              style={{ height: `${Math.max(6, (b.kp / 9) * 100)}%` }}
              title={`${b.time}Z · Kp ${b.kp.toFixed(2)} (${b.state})`}
            />
          ))}
        </div>
        <div className="kpf-scale">
          <span style={{ bottom: `${(5 / 9) * 100}%` }} className="kpf-gline">
            <em>G1</em>
          </span>
          <span style={{ bottom: `${(7 / 9) * 100}%` }} className="kpf-gline">
            <em>G3</em>
          </span>
        </div>
      </div>
      <div className="kpf-caption">
        <span>
          Past 24 h (dim) → 3-day forecast · 3 h bins · G1 storm at Kp 5
        </span>
        {bins.some((b) => b.kp >= 5 && b.state !== 'observed') && (
          <span className="stat-bad">Storm periods ahead</span>
        )}
      </div>
    </div>
  );
}

// X-ray trailing windows (TABS plan Phase F): 6 h is the live product the
// overview already polls; the wider windows are separate backend-cached
// products, so each gets its own poll cadence.
const XRAY_RANGES: { key: XrayRange; label: string; poll: number; note: string }[] = [
  { key: '6h', label: '6 h', poll: 2 * 60_000, note: 'trailing 6 h · 1-min cadence' },
  { key: '1d', label: '24 h', poll: 5 * 60_000, note: 'trailing 24 h · 2-min max bins' },
  { key: '3d', label: '3 d', poll: 10 * 60_000, note: 'trailing 3 d · 5-min max bins' },
];

/** The X-ray chart panel body, shared by every range. */
function XrayFluxPanel(props: {
  state: ApiState<XraySample[]>;
  range: XrayRange;
  onRange: (r: XrayRange) => void;
  nowMs: number;
}) {
  const pts = useMemo(() => toPoints(props.state.data, 'flux'), [props.state.data]);
  const peaks = useMemo(() => flarePeaks(props.state.data), [props.state.data]);
  const note = XRAY_RANGES.find((d) => d.key === props.range)?.note ?? '';
  const markers: TsMarker[] = peaks.map((p) => ({ t: p.time, v: p.flux, label: p.cls.label }));
  return (
    <Panel title="GOES X-ray Flux" fetchedAt={props.state.fetchedAt} stale={props.state.stale}>
      <div className="filter-row">
        {XRAY_RANGES.map((d) => (
          <button
            key={d.key}
            className={`chip ${props.range === d.key ? 'chip-on' : ''}`}
            onClick={() => props.onRange(d.key)}
          >
            {d.label}
          </button>
        ))}
      </div>
      {pts.length > 1 ? (
        <>
          <TimeSeriesChart
            ariaLabel={`GOES X-ray flux, ${note}, log scale`}
            series={[{ points: pts, className: 'tsc-fair', label: 'flux' }]}
            height={190}
            yScale="log"
            yDomain={[1e-8, 1e-3]}
            yTicks={[
              { v: 1e-7, label: 'B' },
              { v: 1e-6, label: 'C' },
              { v: 1e-5, label: 'M' },
              { v: 1e-4, label: 'X' },
            ]}
            bands={[{ from: 1e-5, to: 1e-3, className: 'tsc-band-bad' }]}
            markers={markers}
            now={props.nowMs}
            format={(v) => classifyFlux(v).label}
          />
          <p className="footnote">
            0.1–0.8 nm · {note} · labeled peaks are flare maxima ≥ C1 · shaded
            zone = R-scale radio blackouts (M1+)
          </p>
        </>
      ) : (
        <p className="empty">waiting for data…</p>
      )}
    </Panel>
  );
}

/** Fetches a non-default X-ray window. Mounted keyed on the range so
 * switching ranges starts a fresh fetch state instead of briefly showing
 * the previous window's samples under the new label. */
function XrayRangeLoader(props: {
  range: XrayRange;
  onRange: (r: XrayRange) => void;
  nowMs: number;
}) {
  const def = XRAY_RANGES.find((d) => d.key === props.range)!;
  const state = useApi(() => api.xray(props.range), def.poll);
  return <XrayFluxPanel state={state} range={props.range} onRange={props.onRange} nowMs={props.nowMs} />;
}

/** One derived plain-language condition line with a status dot. */
function Impact(props: { tone: Tone | 'quiet'; children: React.ReactNode }) {
  return (
    <li className={`impact impact-${props.tone}`}>
      <span className="impact-dot" aria-hidden="true" />
      <span>{props.children}</span>
    </li>
  );
}

export function SpaceWXView(props: {
  sw: ApiState<SpaceWeather>;
  xray: ApiState<XraySample[]>;
  solarWind: ApiState<SolarWind>;
  kpForecast: ApiState<KpForecastPoint[]>;
  fof2: ApiState<Fof2Station[]>;
  now: Date;
}) {
  const { sw, xray, solarWind, kpForecast, fof2, now } = props;
  const data = sw.data;

  // Non-default X-ray windows and the hemispheric power stat are fetched
  // here, not in App — they only matter while this view is open.
  const [xrayRange, setXrayRange] = useState<XrayRange>('6h');
  const hemi = useApi(api.hemiPower, 10 * 60_000);

  const kpPts = useMemo(() => toPoints(data?.kp_series, 'kp'), [data]);
  const sfiPts = useMemo(() => toPoints(data?.sfi_history, 'flux'), [data]);
  const hemiPts = useMemo(() => toPoints(hemi.data?.series, 'north'), [hemi.data]);
  const xrayPts = useMemo(() => toPoints(xray.data, 'flux'), [xray.data]);
  const speedPts = useMemo(() => toPoints(solarWind.data?.plasma, 'speed'), [solarWind.data]);
  const densityPts = useMemo(() => toPoints(solarWind.data?.plasma, 'density'), [solarWind.data]);
  const bzPts = useMemo(() => toPoints(solarWind.data?.mag, 'bz'), [solarWind.data]);
  const btPts = useMemo(() => toPoints(solarWind.data?.mag, 'bt'), [solarWind.data]);

  const xn = useMemo(() => xrayNow(xray.data), [xray.data]);

  const kp = lastV(kpPts);
  const sfiTrend = lastV(sfiPts);
  const hemiPower = lastV(hemiPts);
  const speed = lastV(speedPts);
  const bz = lastV(bzPts);
  const cycle = data?.solar_cycle ?? [];
  const latestCycle = cycle.length ? cycle[cycle.length - 1] : null;
  const smoothed = [...cycle].reverse().find((c) => c.smoothed_ssn != null);

  const cyclePts = useMemo(() => {
    const ssn: { t: number; v: number }[] = [];
    const ssn12: { t: number; v: number }[] = [];
    for (const c of cycle) {
      const t = new Date(`${c.time_tag}-01T00:00:00Z`).getTime();
      if (isNaN(t)) continue;
      if (c.ssn != null) ssn.push({ t, v: c.ssn });
      if (c.smoothed_ssn != null) ssn12.push({ t, v: c.smoothed_ssn });
    }
    return { ssn, ssn12 };
  }, [cycle]);

  // Median MUF(3000) across confident ionosonde readings — the "what can the
  // ionosphere actually refract right now" number for the impact panel.
  const medianMuf = useMemo(() => {
    const vals = (fof2.data ?? [])
      .filter((s) => s.mufd != null && s.cs >= 25)
      .map((s) => s.mufd as number)
      .sort((a, b) => a - b);
    if (!vals.length) return null;
    return { muf: vals[Math.floor(vals.length / 2)], n: vals.length };
  }, [fof2.data]);

  const nowMs = now.getTime();
  const anyStale =
    sw.stale || xray.stale || solarWind.stale || kpForecast.stale || hemi.stale;

  const imfDomain = useMemo<[number, number]>(() => {
    const m = Math.max(
      10,
      ...bzPts.map((p) => Math.abs(p.v)),
      ...btPts.map((p) => p.v),
    );
    return [-Math.ceil(m * 1.1), Math.ceil(m * 1.1)];
  }, [bzPts, btPts]);

  const windSeries: TsSeries[] = [
    { points: speedPts, className: 'tsc-accent', label: 'speed' },
  ];
  const densitySeries: TsSeries[] = [
    { points: densityPts, className: 'tsc-dim', area: true, label: 'density' },
  ];
  const imfSeries: TsSeries[] = [
    { points: btPts, className: 'tsc-dim', label: 'Bt' },
    { points: bzPts, className: 'tsc-accent', label: 'Bz' },
  ];

  return (
    <div className="view-dash">
      <section className="span-12">
        <Panel
          title="Space Weather — Now"
          fetchedAt={sw.fetchedAt}
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
          <div className="tile-row">
            <StatTile
              label="SFI"
              value={data?.sfi?.Flux ?? (sfiTrend != null ? String(Math.round(sfiTrend)) : '—')}
              spark={sfiPts.slice(-60).map((p) => p.v)}
              delta={deltaText(sfiTrend, valueAgo(sfiPts, 7 * 24 * HOUR), '/ 7 d')}
              sub="10.7 cm solar flux"
              title="Penticton 10.7 cm radio flux — the general 'how energized is the ionosphere' index. Sparkline: ~2 months of observations (one solar rotation is 27 days)"
            />
            <StatTile
              label="Kp"
              value={kp != null ? kp.toFixed(1) : '—'}
              tone={kp != null && kp >= 5 ? 'bad' : kp != null && kp >= 4 ? 'warn' : null}
              spark={kpPts.slice(-48).map((p) => p.v)}
              delta={deltaText(kp, valueAgo(kpPts, 6 * HOUR), '/ 6 h', 1)}
              sub="planetary K index"
            />
            <StatTile
              label="SSN"
              value={latestCycle?.ssn != null ? String(Math.round(latestCycle.ssn)) : '—'}
              delta={
                smoothed?.smoothed_ssn != null
                  ? { text: `SSN12 ${Math.round(smoothed.smoothed_ssn)}` }
                  : null
              }
              sub="smoothed SSN12 is the P533 input"
              title="Monthly sunspot number · SSN12 = 12-month smoothed value fed to the propagation model"
            />
            <StatTile
              label="X-ray"
              value={xn?.cls.label ?? '—'}
              tone={xn?.cls.letter === 'X' ? 'bad' : xn?.cls.letter === 'M' ? 'warn' : null}
              spark={xrayPts.slice(-90).map((p) => Math.log10(Math.max(p.v, 1e-9)))}
              sub={xn?.r ? `${xn.r.label} blackout` : 'GOES 0.1–0.8 nm'}
            />
            <StatTile
              label="SW speed"
              value={speed != null ? String(Math.round(speed)) : '—'}
              unit="km/s"
              spark={speedPts.slice(-72).map((p) => p.v)}
              delta={deltaText(speed, valueAgo(speedPts, 6 * HOUR), 'km/s / 6 h')}
              sub="solar wind at L1"
            />
            <StatTile
              label="IMF Bz"
              value={bz != null ? `${bz > 0 ? '+' : ''}${bz.toFixed(1)}` : '—'}
              unit="nT"
              tone={bz != null && bz <= -10 ? 'bad' : bz != null && bz <= -5 ? 'warn' : null}
              spark={bzPts.slice(-72).map((p) => p.v)}
              sub={bz != null && bz <= -5 ? 'south — coupling energy' : 'north/neutral is benign'}
            />
            <StatTile
              label="Aurora pwr"
              value={hemiPower != null ? String(Math.round(hemiPower)) : '—'}
              unit="GW"
              tone={
                hemiPower != null && hemiPower >= 100
                  ? 'bad'
                  : hemiPower != null && hemiPower >= 50
                    ? 'warn'
                    : null
              }
              spark={hemiPts.slice(-96).map((p) => p.v)}
              delta={deltaText(hemiPower, valueAgo(hemiPts, 6 * HOUR), 'GW / 6 h')}
              sub="hemispheric power (N)"
              title="OVATION hemispheric power — total auroral energy input, northern hemisphere. Quiet is under ~20 GW; 50+ means strong aurora and degraded polar HF paths"
            />
          </div>
        </Panel>
      </section>

      <section className="span-8">
        {xrayRange === '6h' ? (
          <XrayFluxPanel state={xray} range="6h" onRange={setXrayRange} nowMs={nowMs} />
        ) : (
          <XrayRangeLoader
            key={xrayRange}
            range={xrayRange}
            onRange={setXrayRange}
            nowMs={nowMs}
          />
        )}
      </section>

      <section className="span-4">
        <Panel title="HF Impact" fetchedAt={xray.fetchedAt} stale={anyStale}>
          <ul className="impact-list">
            {xn?.r ? (
              <Impact tone="bad">
                {xn.r.label} radio blackout — dayside absorption up to ~
                {Math.round(highestAffectedFreq(xn.flux))} MHz; low bands die
                first, polar and transequatorial daylight paths worst.
              </Impact>
            ) : xn && xn.cls.letter === 'C' ? (
              <Impact tone="warn">
                {xn.cls.label} flare activity — minor D-layer absorption on
                dayside low bands; 80/40 m noticeably down near the subsolar
                point.
              </Impact>
            ) : (
              <Impact tone="quiet">
                No significant flare absorption — D layer is quiet.
              </Impact>
            )}
            {kp != null && kp >= 5 ? (
              <Impact tone="bad">
                Geomagnetic storm (Kp {kp.toFixed(1)}) — auroral-zone and polar
                paths degraded or closed; mid-latitude MUF depressed. Possible
                auroral backscatter on 6 m.
              </Impact>
            ) : kp != null && kp >= 4 ? (
              <Impact tone="warn">
                Active geomagnetic field (Kp {kp.toFixed(1)}) — expect flutter
                and reduced reliability on paths crossing the auroral oval.
              </Impact>
            ) : (
              <Impact tone="quiet">
                Quiet geomagnetic field{kp != null ? ` (Kp ${kp.toFixed(1)})` : ''} —
                high-latitude paths near normal.
              </Impact>
            )}
            {bz != null && bz <= -5 && (
              <Impact tone={bz <= -10 ? 'bad' : 'warn'}>
                IMF Bz south ({bz.toFixed(1)} nT) at L1 — the magnetosphere is
                coupling solar-wind energy. If it holds, expect Kp to rise in
                the next 1–3 h.
              </Impact>
            )}
            {medianMuf && (
              <Impact tone="quiet">
                Median MUF(3000) is {Math.round(medianMuf.muf)} MHz across{' '}
                {medianMuf.n} ionosondes — paths up to ~3000 km support that
                frequency right now.
              </Impact>
            )}
          </ul>
          <p className="footnote">
            Derived from the live feeds on this page — see each chart for the
            underlying data
          </p>
        </Panel>
      </section>

      <section className="span-6">
        <Panel title="Solar Wind (L1)" fetchedAt={solarWind.fetchedAt} stale={solarWind.stale}>
          {speedPts.length > 1 ? (
            <>
              <TimeSeriesChart
                ariaLabel="Solar wind speed, last 24 hours"
                series={windSeries}
                height={130}
                now={nowMs}
                gapMs={45 * 60_000}
                format={(v) => `${Math.round(v)} km/s`}
                yTicks={[
                  { v: 400, label: '400' },
                  { v: 600, label: '600 km/s' },
                ]}
              />
              <TimeSeriesChart
                ariaLabel="Solar wind proton density, last 24 hours"
                series={densitySeries}
                height={80}
                now={nowMs}
                gapMs={45 * 60_000}
                format={(v) => `${v.toFixed(1)} p/cm³`}
                yDomain={[0, Math.max(10, ...densityPts.map((p) => p.v)) * 1.1]}
                yTicks={[{ v: 10, label: '10 p/cm³' }]}
              />
              <p className="footnote">
                DSCOVR/ACE at L1 — changes here arrive at Earth ~30–60 min later
              </p>
            </>
          ) : (
            <p className="empty">waiting for data…</p>
          )}
        </Panel>
      </section>

      <section className="span-6">
        <Panel title="Interplanetary Field (IMF)" fetchedAt={solarWind.fetchedAt} stale={solarWind.stale}>
          {bzPts.length > 1 ? (
            <>
              <TimeSeriesChart
                ariaLabel="IMF Bz and Bt, last 24 hours"
                series={imfSeries}
                height={210}
                yDomain={imfDomain}
                yTicks={[
                  { v: 0, label: '0' },
                  { v: -5, label: '−5 nT' },
                ]}
                bands={[{ from: -5, to: imfDomain[0], className: 'tsc-band-warn' }]}
                now={nowMs}
                gapMs={45 * 60_000}
                format={(v) => `${v > 0 ? '+' : ''}${v.toFixed(1)} nT`}
              />
              <p className="footnote">
                Bz (bright) sustained below −5 nT opens the magnetosphere —
                the ~1 h storm early warning; Bt (dim) is total field strength
              </p>
            </>
          ) : (
            <p className="empty">waiting for data…</p>
          )}
        </Panel>
      </section>

      <section className="span-6">
        <Panel title="Kp — Observed & Forecast" fetchedAt={kpForecast.fetchedAt} stale={kpForecast.stale}>
          {kpForecast.data?.length ? (
            <KpStrip forecast={kpForecast.data} now={now} />
          ) : (
            <p className="empty">waiting for data…</p>
          )}
        </Panel>
      </section>

      <section className="span-6">
        <Panel title="Solar Cycle" fetchedAt={sw.fetchedAt} stale={sw.stale}>
          {cyclePts.ssn.length > 1 ? (
            <>
              <TimeSeriesChart
                ariaLabel="Monthly sunspot number, trailing 8 years — all of Cycle 25"
                series={[
                  { points: cyclePts.ssn, className: 'tsc-dim', label: 'SSN' },
                  { points: cyclePts.ssn12, className: 'tsc-accent', label: 'SSN12' },
                ]}
                height={170}
                yDomain={[0, Math.max(...cyclePts.ssn.map((p) => p.v)) * 1.15]}
                format={(v) => String(Math.round(v))}
              />
              <p className="footnote">
                monthly observed SSN (dim) and 12-month smoothed SSN12 (bright,
                the P533 model input) over the trailing 8 years — all of Cycle
                25 from the 2019 minimum; SSN12 lags ~6 months by construction
              </p>
            </>
          ) : (
            <p className="empty">waiting for data…</p>
          )}
        </Panel>
      </section>
    </div>
  );
}
