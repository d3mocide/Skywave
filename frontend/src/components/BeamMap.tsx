// Azimuthal-equidistant "beam heading" chart — centered on DE, true bearing
// and true distance readable directly off the angle and radius, same
// convention as a wall beam-heading chart (rotate() with gamma=0 puts true
// north at the top). Unlike GlobeMap this doesn't rotate under drag — the
// whole point is staying locked to DE so the numbers stay true — but it
// shares the same canvas drawing core (drawCanvasMap) and layer data
// (useMapLayers), and supports the same pinch/wheel zoom and click/
// right-click DX picking.

import { useEffect, useMemo, useRef, useState } from 'react';
import { geoAzimuthalEquidistant } from 'd3-geo';
import type { LatLon } from '../lib/geo';
import { latLonToGrid } from '../lib/geo';
import type { Spot, Fof2Station, AuroraForecast } from '../lib/api';
import { useMapLayers, type MapSpot } from '../hooks/useMapLayers';
import { clamp, drawCanvasMap } from '../lib/canvasMapDraw';
import { MapLayerControls } from './MapLayerControls';

const BEAM_FRACTION = 0.86; // fraction of half the canvas the disc fills

export function BeamMap(props: {
  de: LatLon | null;
  dx: LatLon | null;
  time: Date;
  kp: number | null;
  ssn12: number | null;
  spots: Spot[] | null;
  fof2: Fof2Station[] | null;
  aurora: AuroraForecast | null;
  xrayFlux: number | null;
  onSelectDx: (grid: string) => void;
  previewing: boolean;
}) {
  const { de, dx, onSelectDx, previewing } = props;
  const containerRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [size, setSize] = useState({ width: 640, height: 480 });
  const [zoom, setZoom] = useState(1);
  const [pickArmed, setPickArmed] = useState(false);
  const pointersRef = useRef<Map<number, { x: number; y: number }>>(new Map());
  const pinchRef = useRef<{ startDist: number; startZoom: number } | null>(null);
  const tapRef = useRef<{ x: number; y: number; moved: boolean } | null>(null);
  const spotScreenRef = useRef<{ x: number; y: number; spot: MapSpot }[]>([]);

  const {
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
  } = useMapLayers(props);

  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;
    const obs = new ResizeObserver((entries) => {
      const r = entries[0]?.contentRect;
      if (r) setSize({ width: Math.round(r.width), height: Math.round(r.height) });
    });
    obs.observe(el);
    return () => obs.disconnect();
  }, []);

  // Always centered on DE, north up — never user-rotatable. That's what
  // makes the bearing/distance readout true; letting it spin would defeat
  // the point.
  const projection = useMemo(() => {
    const center = de ?? { lat: 0, lon: 0 };
    const discRadius = (Math.min(size.width, size.height) / 2) * BEAM_FRACTION * zoom;
    return geoAzimuthalEquidistant()
      .rotate([-center.lon, -center.lat, 0])
      .clipAngle(180)
      .translate([size.width / 2, size.height / 2])
      .scale(discRadius / Math.PI);
  }, [size, de, zoom]);

  useEffect(() => {
    const el = canvasRef.current;
    if (!el) return;
    const onWheel = (e: WheelEvent) => {
      e.preventDefault();
      setZoom((z) => clamp(z * Math.exp(-e.deltaY * 0.001), 0.6, 4.5));
    };
    el.addEventListener('wheel', onWheel, { passive: false });
    return () => el.removeEventListener('wheel', onWheel);
  }, []);

  const hitTestSpot = (clientX: number, clientY: number): boolean => {
    const canvas = canvasRef.current;
    if (!canvas) return false;
    const rect = canvas.getBoundingClientRect();
    const x = clientX - rect.left;
    const y = clientY - rect.top;
    for (const { x: sx, y: sy, spot } of spotScreenRef.current) {
      if ((sx - x) ** 2 + (sy - y) ** 2 <= 64) {
        onSelectDx(latLonToGrid(spot.pos, 4));
        return true;
      }
    }
    return false;
  };

  const pick = (clientX: number, clientY: number) => {
    const canvas = canvasRef.current;
    if (!canvas || !projection.invert) return;
    if (hitTestSpot(clientX, clientY)) return;
    const rect = canvas.getBoundingClientRect();
    const geo = projection.invert([clientX - rect.left, clientY - rect.top]);
    if (!geo) return;
    const [lon, lat] = geo;
    onSelectDx(latLonToGrid({ lat, lon }, 4));
  };

  const onPointerDown = (e: React.PointerEvent<HTMLCanvasElement>) => {
    try {
      (e.target as Element).setPointerCapture(e.pointerId);
    } catch {
      /* non-fatal — see GlobeMap's onPointerDown for why */
    }
    pointersRef.current.set(e.pointerId, { x: e.clientX, y: e.clientY });
    if (pointersRef.current.size === 2) {
      const [a, b] = [...pointersRef.current.values()];
      pinchRef.current = { startDist: Math.hypot(a.x - b.x, a.y - b.y), startZoom: zoom };
      tapRef.current = null;
    } else if (pointersRef.current.size === 1) {
      tapRef.current = { x: e.clientX, y: e.clientY, moved: false };
    }
  };

  const onPointerMove = (e: React.PointerEvent<HTMLCanvasElement>) => {
    if (pointersRef.current.has(e.pointerId)) {
      pointersRef.current.set(e.pointerId, { x: e.clientX, y: e.clientY });
    }
    if (pointersRef.current.size === 2 && pinchRef.current) {
      const [a, b] = [...pointersRef.current.values()];
      const dist = Math.hypot(a.x - b.x, a.y - b.y);
      if (dist > 0 && pinchRef.current.startDist > 0) {
        setZoom(clamp((pinchRef.current.startZoom * dist) / pinchRef.current.startDist, 0.6, 4.5));
      }
      return;
    }
    const t = tapRef.current;
    if (!t) return;
    if (Math.abs(e.clientX - t.x) > 3 || Math.abs(e.clientY - t.y) > 3) t.moved = true;
  };

  const onPointerUp = (e: React.PointerEvent<HTMLCanvasElement>) => {
    pointersRef.current.delete(e.pointerId);
    if (pointersRef.current.size < 2) pinchRef.current = null;
    if (pointersRef.current.size > 0) return;

    const t = tapRef.current;
    tapRef.current = null;
    if (!t || t.moved) return;
    if (pickArmed) {
      pick(e.clientX, e.clientY);
      setPickArmed(false);
    } else {
      hitTestSpot(e.clientX, e.clientY);
    }
  };

  const onPointerCancel = (e: React.PointerEvent<HTMLCanvasElement>) => {
    pointersRef.current.delete(e.pointerId);
    if (pointersRef.current.size < 2) pinchRef.current = null;
    if (pointersRef.current.size === 0) tapRef.current = null;
  };

  const onContextMenu = (e: React.MouseEvent<HTMLCanvasElement>) => {
    e.preventDefault();
    pick(e.clientX, e.clientY);
  };

  useEffect(() => {
    const canvas = canvasRef.current;
    const ctx = canvas?.getContext('2d');
    if (!canvas || !ctx) return;

    const dpr = window.devicePixelRatio || 1;
    const { width, height } = size;
    canvas.width = Math.max(1, Math.round(width * dpr));
    canvas.height = Math.max(1, Math.round(height * dpr));
    canvas.style.width = `${width}px`;
    canvas.style.height = `${height}px`;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);

    spotScreenRef.current = drawCanvasMap(ctx, {
      width,
      height,
      projection,
      discRadius: projection.scale() * Math.PI,
      mode: 'beam',
      de,
      dx,
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
      previewing,
    });
  }, [
    size,
    projection,
    de,
    dx,
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
    previewing,
  ]);

  return (
    <div className={`map-wrap canvas-map-wrap ${pickArmed ? 'map-picking' : ''}`} ref={containerRef}>
      <canvas
        ref={canvasRef}
        className="canvas-map"
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
        onPointerCancel={onPointerCancel}
        onContextMenu={onContextMenu}
      />
      {!de && (
        <div className="map-ctl-hint beam-no-de-hint">set your DE grid to center the beam map</div>
      )}
      <MapLayerControls
        variant="beam"
        layers={layers}
        setLayers={setLayers}
        toggle={toggle}
        pickArmed={pickArmed}
        onTogglePick={() => setPickArmed((v) => !v)}
        de={de}
        dx={dx}
        ssn12={props.ssn12}
        coverageLayer={coverageLayer}
        ovationLayer={ovationLayer}
        mufFieldLayer={mufFieldLayer}
        blackout={blackout}
        auroraFallback={layers.aurora && !ovationLayer && auroraRings != null}
        mapSpots={mapSpots}
        fof2Count={props.fof2?.filter((s) => s.mufd != null && s.cs >= 25).length ?? 0}
      />
    </div>
  );
}
