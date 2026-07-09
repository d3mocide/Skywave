// Rotating 3-D globe — an alternate projection for the same map data as
// WorldMap (Flat), Canvas2D + d3-geo instead of Leaflet tiles. Technique
// borrowed from Nexus (reviewed via its SourceForge mirror): an orthographic
// projection with a lit-hemisphere gradient, limb darkening, and an
// atmosphere halo standing in for real 3-D shading, drag-to-rotate,
// pinch/wheel-to-zoom, and click/right-click to set the DX target — same
// gesture vocabulary as the Flat map's pick tool.
//
// Layer computation is shared with WorldMap via useMapLayers, and the
// canvas drawing itself is shared with BeamMap via drawCanvasMap; this file
// is purely "given that data, rotate a sphere and let the user grab it."

import { useEffect, useMemo, useRef, useState } from 'react';
import { geoOrthographic } from 'd3-geo';
import type { LatLon } from '../lib/geo';
import { latLonToGrid } from '../lib/geo';
import type { Spot, Fof2Station, AuroraForecast } from '../lib/api';
import { useMapLayers, type MapSpot } from '../hooks/useMapLayers';
import { clamp, drawCanvasMap } from '../lib/canvasMapDraw';
import { MapLayerControls } from './MapLayerControls';

const GLOBE_FRACTION = 0.86; // fraction of half the canvas the sphere fills

export function GlobeMap(props: {
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
  const [rotate, setRotate] = useState<[number, number, number]>(() =>
    de ? [-de.lon, -de.lat, 0] : [20, -20, 0],
  );
  const [zoom, setZoom] = useState(1);
  const [pickArmed, setPickArmed] = useState(false);
  const userRotatedRef = useRef(false);
  const dragRef = useRef<{
    x: number;
    y: number;
    rotate: [number, number, number];
    moved: boolean;
  } | null>(null);
  // Active touches/pointers, for pinch-to-zoom (mouse never has 2 at once).
  const pointersRef = useRef<Map<number, { x: number; y: number }>>(new Map());
  const pinchRef = useRef<{ startDist: number; startZoom: number } | null>(null);
  // Screen positions from the last draw, for click hit-testing on spots.
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

  // Recenter on DE the first time it becomes available; never fight a user
  // who has already grabbed the globe.
  useEffect(() => {
    if (de && !userRotatedRef.current) {
      setRotate([-de.lon, -de.lat, 0]);
    }
  }, [de]);

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

  const projection = useMemo(() => {
    const radius = (Math.min(size.width, size.height) / 2) * GLOBE_FRACTION * zoom;
    return geoOrthographic()
      .rotate(rotate)
      .clipAngle(90)
      .translate([size.width / 2, size.height / 2])
      .scale(radius);
  }, [size, rotate, zoom]);

  // Wheel zoom needs a non-passive listener to call preventDefault (React's
  // synthetic onWheel is passive and won't stop page scroll).
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

  const pick = (clientX: number, clientY: number) => {
    const canvas = canvasRef.current;
    if (!canvas || !projection.invert) return;
    const rect = canvas.getBoundingClientRect();
    const x = clientX - rect.left;
    const y = clientY - rect.top;

    // Spot hit-test first — clicking a spot always sets it as DX, same as
    // the Flat map, independent of the pick-tool arm state.
    for (const { x: sx, y: sy, spot } of spotScreenRef.current) {
      if ((sx - x) ** 2 + (sy - y) ** 2 <= 64) {
        onSelectDx(latLonToGrid(spot.pos, 4));
        return;
      }
    }
    const geo = projection.invert([x, y]);
    if (!geo) return;
    const [lon, lat] = geo;
    onSelectDx(latLonToGrid({ lat, lon }, 4));
  };

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

  const onPointerDown = (e: React.PointerEvent<HTMLCanvasElement>) => {
    // Best-effort: keeps receiving move/up outside the canvas bounds while
    // dragging. Can throw if the pointer session isn't fully established
    // (some synthetic/edge-case dispatch paths) — not worth losing the
    // whole gesture over.
    try {
      (e.target as Element).setPointerCapture(e.pointerId);
    } catch {
      /* non-fatal */
    }
    pointersRef.current.set(e.pointerId, { x: e.clientX, y: e.clientY });
    if (pointersRef.current.size === 2) {
      const [a, b] = [...pointersRef.current.values()];
      pinchRef.current = { startDist: Math.hypot(a.x - b.x, a.y - b.y), startZoom: zoom };
      dragRef.current = null;
    } else if (pointersRef.current.size === 1) {
      dragRef.current = { x: e.clientX, y: e.clientY, rotate, moved: false };
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

    const d = dragRef.current;
    if (!d) return;
    const dx0 = e.clientX - d.x;
    const dy0 = e.clientY - d.y;
    if (Math.abs(dx0) > 3 || Math.abs(dy0) > 3) d.moved = true;
    if (!d.moved) return;
    userRotatedRef.current = true;
    const radius = (Math.min(size.width, size.height) / 2) * GLOBE_FRACTION * zoom;
    const k = 75 / radius;
    setRotate([d.rotate[0] + dx0 * k, clamp(d.rotate[1] - dy0 * k, -90, 90), 0]);
  };

  const onPointerUp = (e: React.PointerEvent<HTMLCanvasElement>) => {
    pointersRef.current.delete(e.pointerId);
    if (pointersRef.current.size < 2) pinchRef.current = null;

    if (pointersRef.current.size === 1) {
      // One finger lifted out of a pinch — resume single-finger rotation
      // from the remaining finger without treating this as a tap.
      const [remaining] = pointersRef.current.values();
      dragRef.current = { x: remaining.x, y: remaining.y, rotate, moved: true };
      return;
    }
    if (pointersRef.current.size > 0) return;

    const d = dragRef.current;
    dragRef.current = null;
    if (!d || d.moved) return;
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
    if (pointersRef.current.size === 0) dragRef.current = null;
  };

  const onContextMenu = (e: React.MouseEvent<HTMLCanvasElement>) => {
    e.preventDefault();
    pick(e.clientX, e.clientY);
  };

  // Draw. Redraw-on-change only (no animation loop) — rotate/zoom already
  // batch through React state, which coalesces to one paint per frame.
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
      discRadius: projection.scale(),
      mode: 'globe',
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
      <MapLayerControls
        variant="globe"
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
