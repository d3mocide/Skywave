import { useEffect, useMemo, useState } from 'react';
import { useLiveQuery } from 'dexie-react-hooks';
import { WorldMap } from './components/WorldMap';
import { SpaceWeatherPanel } from './components/SpaceWeatherPanel';
import { PropagationPanel } from './components/PropagationPanel';
import { BandConditions } from './components/BandConditions';
import { CMEPanel } from './components/CMEPanel';
import { SatellitePanel } from './components/SatellitePanel';
import { DXClusterPanel } from './components/DXClusterPanel';
import { StationPanel } from './components/StationPanel';
import { api } from './lib/api';
import { db, requestPersistence } from './lib/db';
import { gridToLatLon } from './lib/geo';
import { initWasmEngine, predictCircuit } from './lib/propagation/engine';
import { useApi, useNow } from './hooks/useApi';

// Poll intervals mirror backend TTLs (§7) — polling faster than the cache
// refreshes is wasted work.
const POLL_SW = 5 * 60_000;
const POLL_CME = 30 * 60_000;
const POLL_TLE = 6 * 3600_000;
const POLL_SPOTS = 5_000;
const POLL_FOF2 = 10 * 60_000;

export default function App() {
  const now = useNow(15_000);
  const settings = useLiveQuery(() => db.settings.get('settings'));
  const [dxGrid, setDxGrid] = useState('');
  const [wasmReady, setWasmReady] = useState(false);

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

  // wasmReady is a dependency so predictions recompute the moment the P533
  // engine finishes loading (it flips the badge from "estimate" to "P.533").
  const prediction = useMemo(() => {
    if (!de || !dx || ssn12 == null) return null;
    return predictCircuit({ de, dx, utc: now, ssn12 });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [de, dx, ssn12, wasmReady, Math.floor(now.getTime() / 60_000)]);

  return (
    <div className="app">
      <header className="topbar">
        <h1>Skywave</h1>
        <span className="topbar-call">{settings?.deCallsign || 'set your call'}</span>
        <span className="topbar-clock mono">
          {now.toISOString().slice(0, 16).replace('T', ' ')}Z
        </span>
      </header>
      <main className="layout">
        <div className="map-cell">
          <WorldMap
            de={de}
            dx={dx}
            now={now}
            kp={kp}
            ssn12={ssn12}
            spots={spots.data?.spots ?? null}
            fof2={fof2.data}
            onSelectDx={setDxGrid}
          />
        </div>
        <div className="panel-col">
          <StationPanel
            de={de}
            dx={dx}
            dxGrid={dxGrid}
            onDxGridChange={setDxGrid}
            now={now}
          />
          <SpaceWeatherPanel sw={sw} />
          <PropagationPanel
            prediction={prediction}
            hasCircuit={!!(de && dx)}
            hasSsn={ssn12 != null}
          />
          <BandConditions prediction={prediction} kp={kp} />
        </div>
        <div className="panel-col">
          <DXClusterPanel spots={spots} />
          <CMEPanel cmes={cmes} now={now} />
          <SatellitePanel tles={tles} de={de} />
        </div>
      </main>
    </div>
  );
}
