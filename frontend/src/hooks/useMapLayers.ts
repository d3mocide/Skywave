// Shared map data for both renderers (WorldMap/Flat and GlobeMap): layer
// toggles, the computed raster layers, and the vector geometry (terminator,
// great-circle paths, spots, MUF stations). One source of truth so Flat and
// Globe never quietly diverge on what "coverage layer on" actually means.

import { useEffect, useMemo, useState } from 'react';
import type { LatLon } from '../lib/geo';
import {
  greatCirclePoints,
  longPathPoints,
  auroralOvalPoints,
  gridToLatLon,
} from '../lib/geo';
import { nightPolygon, subsolarPoint } from '../lib/solar';
import { renderCoverage } from '../lib/coverage';
import { renderAurora } from '../lib/aurora';
import { renderMufMap } from '../lib/mufmap';
import { renderBlackout } from '../lib/blackout';
import { renderDrap } from '../lib/drap';
import { classifyFlux, highestAffectedFreq } from '../lib/xray';
import { HF_BANDS } from '../lib/propagation/engine';
import { callToLatLon, callJitter } from '../lib/prefixes';
import { bandOf, bandGroup, type BandGroup } from '../lib/bands';
import type { Spot, Fof2Station, AuroraForecast, DrapData } from '../lib/api';
import { loadLayers, saveLayers, type LayerPrefs } from '../lib/mapLayers';
import type { RasterLayer } from '../lib/mercRaster';
import { PSK_WINDOW_S, type PskReport } from '../lib/pskreporter';

export interface MapSpot {
  spot: Spot;
  pos: LatLon;
  band: string;
  group: BandGroup;
}

export interface PskMark {
  report: PskReport;
  /** Station position from its reported grid — real, not prefix-guessed. */
  pos: LatLon;
  /** Great-circle DE→station, when DE is configured. */
  path: LatLon[] | null;
  group: BandGroup;
  /** 0 = just heard … 1 = about to age out of the window; drives fading. */
  age: number;
}

export interface BlackoutInfo {
  layer: RasterLayer;
  haf: number;
  cls: string;
  /** 'drap' = NOAA's authoritative absorption grid; 'model' = the local
   * X-ray-flux approximation used when the feed is down. */
  source: 'drap' | 'model';
}

export function useMapLayers(props: {
  de: LatLon | null;
  dx: LatLon | null;
  time: Date;
  kp: number | null;
  ssn12: number | null;
  spots: Spot[] | null;
  fof2: Fof2Station[] | null;
  aurora: AuroraForecast | null;
  xrayFlux: number | null;
  /** NOAA D-RAP absorption grid — preferred blackout source when present. */
  drap: DrapData | null;
  /** PSKReporter reports, already filtered to the selected direction. */
  psk: PskReport[] | null;
  previewing: boolean;
}) {
  const { de, dx, time, kp, ssn12, spots, fof2, aurora: ovation, xrayFlux, drap, psk, previewing } = props;

  const [layers, setLayers] = useState<LayerPrefs>(loadLayers);
  useEffect(() => {
    saveLayers(layers);
  }, [layers]);
  const toggle = (k: keyof LayerPrefs) => setLayers((l) => ({ ...l, [k]: !l[k] }));

  const minuteBucket = Math.floor(time.getTime() / 60000);
  const night = useMemo(
    () => nightPolygon(time),
    // Recompute at minute granularity — the terminator moves ~0.25°/min.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [minuteBucket],
  );
  const sun = useMemo(
    () => subsolarPoint(time),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [minuteBucket],
  );

  const shortPath = useMemo(
    () => (de && dx ? greatCirclePoints(de, dx) : null),
    [de, dx],
  );
  const longPath = useMemo(
    () => (de && dx ? longPathPoints(de, dx) : null),
    [de, dx],
  );

  const coverageMhz = HF_BANDS.find((b) => b.name === layers.coverageBand)?.mhz ?? 14.15;
  // 5-minute buckets: the heatmap follows the terminator, which barely moves
  // in that window, and repainting the grid every 15 s tick buys nothing.
  const coverageBucket = Math.floor(time.getTime() / 300_000);
  const coverageLayer = useMemo(
    () =>
      layers.coverage && de && ssn12 != null
        ? renderCoverage(de, coverageMhz, time, ssn12)
        : null,
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [layers.coverage, de?.lat, de?.lon, coverageMhz, ssn12, coverageBucket],
  );

  // Aurora: the OVATION nowcast bitmap is truth for "now"; while previewing
  // future hours (or when OVATION is down) fall back to the Kp-scaled
  // dipole rings, which can at least follow the forecast Kp.
  const ovationLayer = useMemo(
    () => (layers.aurora && !previewing && ovation ? renderAurora(ovation) : null),
    [layers.aurora, previewing, ovation],
  );
  const auroraRings = useMemo(() => {
    if (!layers.aurora || kp == null || ovationLayer) return null;
    return (['N', 'S'] as const).map((h) => auroralOvalPoints(kp, h));
  }, [layers.aurora, kp, ovationLayer]);

  const mufFieldLayer = useMemo(
    () => (layers.mufField && fof2 && !previewing ? renderMufMap(fof2) : null),
    [layers.mufField, fof2, previewing],
  );

  // Blackout: NOAA D-RAP is truth when available (it also carries polar
  // cap absorption the X-ray model can't see); the local flux-based model
  // is the fallback — same pattern as OVATION vs. the Kp oval. Live-only:
  // absorption now says nothing about +N hours from now.
  const blackout = useMemo<BlackoutInfo | null>(() => {
    if (!layers.blackout || previewing) return null;
    if (drap) {
      // An empty grid is an authoritative "nothing absorbed" — don't fall
      // through to the model just because the Sun is quiet.
      const layer = renderDrap(drap);
      if (!layer) return null;
      return { layer, haf: drap.max_mhz, cls: 'D-RAP', source: 'drap' };
    }
    if (xrayFlux == null || xrayFlux < 1e-6) return null;
    const layer = renderBlackout(xrayFlux, time);
    if (!layer) return null;
    return {
      layer,
      haf: highestAffectedFreq(xrayFlux),
      cls: classifyFlux(xrayFlux).label,
      source: 'model',
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [layers.blackout, previewing, drap, xrayFlux, coverageBucket]);

  const mapSpots = useMemo<MapSpot[]>(() => {
    if (!layers.spots || !spots) return [];
    const seen = new Set<string>();
    const out: MapSpot[] = [];
    // Newest first so the dedupe keeps each call's latest frequency.
    const sorted = [...spots].sort((a, b) => b.received_at - a.received_at);
    for (const spot of sorted) {
      if (seen.has(spot.dx_call)) continue;
      const band = bandOf(spot.freq_khz);
      const base = callToLatLon(spot.dx_call);
      if (!band || !base) continue;
      seen.add(spot.dx_call);
      const j = callJitter(spot.dx_call);
      out.push({
        spot,
        band,
        group: bandGroup(band),
        pos: {
          lat: Math.max(-84, Math.min(84, base.lat + j.dLat)),
          lon: base.lon + j.dLon,
        },
      });
      if (out.length >= 80) break;
    }
    return out;
  }, [layers.spots, spots]);

  const mufStations = useMemo(() => {
    if (!layers.muf || !fof2) return [];
    return fof2.filter((s) => s.mufd != null && s.cs >= 25);
  }, [layers.muf, fof2]);

  // PSK reception reports: one mark per station (newest report wins — the
  // input is newest-first), positioned by its actual reported grid. The
  // great circle to DE is the point of the layer: it draws the paths that
  // are *verifiably open right now* for your signal.
  const pskMarks = useMemo<PskMark[]>(() => {
    if (!layers.psk || !psk?.length) return [];
    const nowS = Date.now() / 1000;
    const seen = new Set<string>();
    const out: PskMark[] = [];
    for (const report of psk) {
      if (!report.grid || seen.has(report.call)) continue;
      const pos = gridToLatLon(report.grid);
      if (!pos) continue;
      seen.add(report.call);
      out.push({
        report,
        pos,
        path: de ? greatCirclePoints(de, pos, 48) : null,
        group: report.band ? bandGroup(report.band) : 'mid',
        age: Math.max(0, Math.min(1, (nowS - report.t) / PSK_WINDOW_S)),
      });
      if (out.length >= 120) break;
    }
    return out;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [layers.psk, psk, de?.lat, de?.lon, minuteBucket]);

  return {
    layers,
    setLayers,
    toggle,
    night,
    sun,
    shortPath,
    longPath,
    coverageLayer,
    ovationLayer,
    auroraRings,
    mufFieldLayer,
    blackout,
    mapSpots,
    mufStations,
    pskMarks,
  };
}

export type MapLayersState = ReturnType<typeof useMapLayers>;
