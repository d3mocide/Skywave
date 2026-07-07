import { useEffect, useMemo, useState } from 'react';
import { useLiveQuery } from 'dexie-react-hooks';
import { WorldMap } from './components/WorldMap';
import { SpaceWeatherPanel } from './components/SpaceWeatherPanel';
import { SunPanel } from './components/SunPanel';
import { PropagationPanel } from './components/PropagationPanel';
import { BandConditions } from './components/BandConditions';
import { CMEPanel } from './components/CMEPanel';
import { SatellitePanel } from './components/SatellitePanel';
import { DXClusterPanel } from './components/DXClusterPanel';
import { StationPanel } from './components/StationPanel';
import { api } from './lib/api';
import { db, requestPersistence } from './lib/db';
import { gridToLatLon } from './lib/geo';
import { xrayNow } from './lib/xray';
import { initWasmEngine, predictCircuit } from './lib/propagation/engine';
import { useApi, useNow } from './hooks/useApi';

// Poll intervals mirror backend TTLs (§7) — polling faster than the cache
// refreshes is wasted work.
const POLL_SW = 5 * 60_000;
const POLL_CME = 30 * 60_000;
const POLL_TLE = 6 * 3600_000;
const POLL_SPOTS = 5_000;
const POLL_FOF2 = 10 * 60_000;
const POLL_XRAY = 2 * 60_000;
const POLL_WIND = 2 * 60_000;
const POLL_AURORA = 10 * 60_000;
const POLL_KP_FORECAST = 30 * 60_000;
const POLL_SOLAR_ACTIVITY = 30 * 60_000;

export default function App() {
  const now = useNow(15_000);
  const settings = useLiveQuery(() => db.settings.get('settings'));
  const [dxGrid, setDxGrid] = useState('');
  const [wasmReady, setWasmReady] = useState(false);
  // Time scrubber: preview propagation up to 24 h ahead. 0 = live. Predictions
  // and the map's sun-driven layers follow viewTime; live feeds stay live.
  const [scrubHours, setScrubHours] = useState(0);
  const [mapFocus, setMapFocus] = useState(false);

  useEffect(() => {
    requestPersistence();
    initWasmEngine().then(setWasmReady);
  }, []);

  const de = useMemo(
    () => (settings?.deGrid ? gridToLatLon(settings.deGrid) : null),
    [settings?.deGrid],
  );
  const dx = useMemo(() => (dxGrid ? gridToLatLon(dxGrid) : null), [dxGrid]);

  const sw = useApi(api.spaceWeather, POLL_SW);
  const cmes = useApi(api.cmes, POLL_CME);
  const tles = useApi(api.tles, POLL_TLE);
  const spots = useApi(api.spots, POLL_SPOTS);
  const fof2 = useApi(api.fof2, POLL_FOF2);
  const xray = useApi(api.xray, POLL_XRAY);
  const solarWind = useApi(api.solarWind, POLL_WIND);
  const aurora = useApi(api.aurora, POLL_AURORA);
  const kpForecast = useApi(api.kpForecast, POLL_KP_FORECAST);
  const solarActivity = useApi(api.solarActivity, POLL_SOLAR_ACTIVITY);

  // SMOOTHED SSN12 — the P533 input (§4). Never feed raw daily SSN.
  const ssn12 = useMemo(() => {
    const cycle = sw.data?.solar_cycle ?? [];
    const latest = [...cycle].reverse().find((c) => c.smoothed_ssn != null);
    return latest?.smoothed_ssn ?? null;
  }, [sw.data]);

  const kp = useMemo(() => {
    const series = sw.data?.kp_series;
    return series?.length ? series[series.length - 1].kp : null;
  }, [sw.data]);

  const viewTime = useMemo(
    () => new Date(now.getTime() + scrubHours * 3600_000),
    [now, scrubHours],
  );

  // Effective Kp for the display time: live value normally, the NOAA 3-day
  // forecast bin covering viewTime while the scrubber previews ahead — so
  // the auroral oval and band-condition penalty follow the forecast.
  const effectiveKp = useMemo(() => {
    if (scrubHours === 0 || !kpForecast.data?.length) return kp;
    const t = viewTime.getTime();
    let best = kp;
    for (const p of kpForecast.data) {
      const pt = new Date(p.time.replace(' ', 'T') + 'Z').getTime();
      if (isNaN(pt) || pt > t) break;
      best = p.kp;
    }
    return best;
  }, [scrubHours, kpForecast.data, kp, viewTime]);

  const xn = useMemo(() => xrayNow(xray.data), [xray.data]);

  // wasmReady is a dependency so predictions recompute the moment the P533
  // engine finishes loading (it flips the badge from "estimate" to "P.533").
  const prediction = useMemo(() => {
    if (!de || !dx || ssn12 == null) return null;
    return predictCircuit({ de, dx, utc: viewTime, ssn12 });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [de, dx, ssn12, wasmReady, scrubHours, Math.floor(now.getTime() / 60_000)]);

  const sfi = sw.data?.sfi?.Flux ?? null;

  return (
    <div className="app">
      <header className="topbar">
        <h1>Skywave</h1>
        <span className="topbar-call">{settings?.deCallsign || 'set your call'}</span>
        {/* Glanceable space weather — the numbers that decide whether it's
            worth switching the rig on, without scanning the panels. */}
        <span className="topbar-stats mono">
          {sfi != null && <span title="10.7 cm solar flux">SFI {sfi}</span>}
          {kp != null && (
            <span
              title="planetary K index (latest)"
              className={kp >= 5 ? 'stat-bad' : kp >= 4 ? 'stat-warn' : ''}
            >
              Kp {kp.toFixed(1)}
            </span>
          )}
          {ssn12 != null && <span title="smoothed sunspot number">SSN12 {Math.round(ssn12)}</span>}
          {xn && (
            <span
              title={`GOES X-ray flux${xn.r ? ` — ${xn.r.label} radio blackout` : ''}`}
              className={
                xn.cls.letter === 'X'
                  ? 'stat-bad'
                  : xn.cls.letter === 'M'
                    ? 'stat-warn'
                    : ''
              }
            >
              ☀ {xn.cls.label}
            </span>
          )}
          {(() => {
            const plasma = solarWind.data?.plasma;
            const mag = solarWind.data?.mag;
            const speed = plasma?.length
              ? plasma[plasma.length - 1].speed
              : null;
            const bz = mag?.length ? mag[mag.length - 1].bz : null;
            if (speed == null && bz == null) return null;
            return (
              <span
                title="solar wind at L1 (speed · IMF Bz)"
                className={bz != null && bz <= -5 ? 'stat-warn' : ''}
              >
                SW {speed != null ? Math.round(speed) : '—'}
                {bz != null && ` · Bz ${bz > 0 ? '+' : ''}${bz.toFixed(0)}`}
              </span>
            );
          })()}
        </span>
        <button
          className="chip topbar-focus"
          onClick={() => setMapFocus((v) => !v)}
          title={mapFocus ? 'show data panels' : 'hide data panels — map only'}
        >
          {mapFocus ? '⤡ panels' : '⤢ map'}
        </button>
        <span className="topbar-clock mono">
          {now.toISOString().slice(0, 16).replace('T', ' ')}Z
        </span>
      </header>
      <main className={`layout ${mapFocus ? 'map-focus' : ''}`}>
        <div className="map-cell">
          <WorldMap
            de={de}
            dx={dx}
            time={viewTime}
            kp={effectiveKp}
            ssn12={ssn12}
            spots={spots.data?.spots ?? null}
            fof2={fof2.data}
            aurora={aurora.data}
            xrayFlux={xn?.flux ?? null}
            onSelectDx={setDxGrid}
            scrubHours={scrubHours}
            onScrub={setScrubHours}
          />
        </div>
        {/* Left: your station and the model — what SHOULD work for your
            circuit. Right: the live sky — what IS happening. The map sits
            between, where prediction meets observation. */}
        <div className="panel-col panel-col-left">
          <StationPanel
            de={de}
            dx={dx}
            dxGrid={dxGrid}
            onDxGridChange={setDxGrid}
            now={now}
          />
          <PropagationPanel
            prediction={prediction}
            hasCircuit={!!(de && dx)}
            hasSsn={ssn12 != null}
            previewHours={scrubHours}
          />
          <BandConditions
            prediction={prediction}
            kp={effectiveKp}
            xray={scrubHours === 0 ? xn : null}
            previewHours={scrubHours}
          />
        </div>
        <div className="panel-col panel-col-right">
          <SpaceWeatherPanel
            sw={sw}
            xray={xray}
            solarWind={solarWind}
            kpForecast={kpForecast}
            now={now}
          />
          <SunPanel activity={solarActivity} />
          <DXClusterPanel spots={spots} onSelectDx={setDxGrid} />
          <CMEPanel cmes={cmes} now={now} />
          <SatellitePanel tles={tles} de={de} />
        </div>
      </main>
    </div>
  );
}
