// Rotating 3-D globe — an alternate projection for the same map data as
// WorldMap (Flat), Canvas2D + d3-geo instead of Leaflet tiles. Technique
// borrowed from Nexus (github.com/… reviewed via SourceForge mirror): an
// orthographic projection with a lit-hemisphere gradient, limb darkening,
// and an atmosphere halo standing in for real 3-D shading, drag-to-rotate,
// wheel-to-zoom, and click/right-click to set the DX target — same gesture
// vocabulary as the Flat map's pick tool.
//
// Layer computation is shared with WorldMap via useMapLayers; this file is
// purely "given that data, draw a sphere instead of a slippy map."

import { useEffect, useMemo, useRef, useState } from 'react';
import { geoOrthographic, geoPath, geoGraticule10, type GeoProjection } from 'd3-geo';
import { feature } from 'topojson-client';
import type { Topology } from 'topojson-specification';
import landTopo from 'world-atlas/land-110m.json';
import type { LatLon } from '../lib/geo';
import { latLonToGrid } from '../lib/geo';
import { HF_BANDS } from '../lib/propagation/engine';
import { BAND_GROUP_COLORS, BAND_GROUP_LABELS, type BandGroup } from '../lib/bands';
import type { Spot, Fof2Station, AuroraForecast } from '../lib/api';
import { useMapLayers, type MapSpot } from '../hooks/useMapLayers';
import { sampleRaster, type RasterLayer } from '../lib/mercRaster';

const land = feature(landTopo as unknown as Topology, (landTopo as unknown as Topology).objects.land as never);

// Fixed star field, generated once at module load — a UI backdrop, not
// real sky data, so it doesn't need to be per-instance or seeded.
const STARS = Array.from({ length: 220 }, () => ({
  x: Math.random(),
  y: Math.random(),
  r: Math.random() * 1.1 + 0.2,
  a: Math.random() * 0.6 + 0.15,
}));

function mufColor(mufd: number): string {
  if (mufd >= 28) return '#ffe9a8';
  if (mufd >= 21) return '#ffd166';
  if (mufd >= 14) return '#d9a832';
  if (mufd >= 7) return '#a67c00';
  return '#6e5300';
}

function clamp(v: number, lo: number, hi: number): number {
  return Math.max(lo, Math.min(hi, v));
}

interface RasterEntry {
  layer: RasterLayer;
  alpha: number;
}

/** Composite one or more Mercator raster layers onto an offscreen canvas by
 * inverse-projecting every pixel in the sphere's bounding box. Returned as a
 * canvas (not raw ImageData) so the caller can drawImage() it — that's the
 * only way to have it respect the main context's clip region and DPR scale;
 * putImageData ignores both. */
function compositeRasters(
  projection: GeoProjection,
  cx: number,
  cy: number,
  radius: number,
  entries: RasterEntry[],
): { canvas: HTMLCanvasElement; x: number; y: number } | null {
  if (!entries.length || !projection.invert) return null;
  const invert = projection.invert;
  const x0 = Math.max(0, Math.floor(cx - radius));
  const y0 = Math.max(0, Math.floor(cy - radius));
  const w = Math.ceil(cx + radius) - x0;
  const h = Math.ceil(cy + radius) - y0;
  if (w <= 0 || h <= 0) return null;

  const img = new ImageData(w, h);
  const od = img.data;
  const r2 = radius * radius;
  for (let py = 0; py < h; py++) {
    const pyAbs = y0 + py;
    const dy = pyAbs - cy;
    for (let px = 0; px < w; px++) {
      const pxAbs = x0 + px;
      const dx = pxAbs - cx;
      if (dx * dx + dy * dy > r2) continue;
      const geo = invert([pxAbs, pyAbs]);
      if (!geo) continue;
      const [lon, lat] = geo;
      let rOut = 0, gOut = 0, bOut = 0, aOut = 0;
      for (const { layer, alpha } of entries) {
        const s = sampleRaster(layer, lat, lon);
        if (!s) continue;
        const sa = (s[3] / 255) * alpha;
        if (sa <= 0) continue;
        rOut = s[0] * sa + rOut * (1 - sa);
        gOut = s[1] * sa + gOut * (1 - sa);
        bOut = s[2] * sa + bOut * (1 - sa);
        aOut = sa + aOut * (1 - sa);
      }
      if (aOut <= 0.003) continue;
      const o = (py * w + px) * 4;
      od[o] = rOut;
      od[o + 1] = gOut;
      od[o + 2] = bOut;
      od[o + 3] = Math.round(aOut * 255);
    }
  }

  const off = document.createElement('canvas');
  off.width = w;
  off.height = h;
  const octx = off.getContext('2d');
  if (!octx) return null;
  octx.putImageData(img, 0, 0);
  return { canvas: off, x: x0, y: y0 };
}

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
    const radius = (Math.min(size.width, size.height) / 2) * 0.86 * zoom;
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

  const onPointerDown = (e: React.PointerEvent<HTMLCanvasElement>) => {
    (e.target as Element).setPointerCapture(e.pointerId);
    dragRef.current = { x: e.clientX, y: e.clientY, rotate, moved: false };
  };
  const onPointerMove = (e: React.PointerEvent<HTMLCanvasElement>) => {
    const d = dragRef.current;
    if (!d) return;
    const dx0 = e.clientX - d.x;
    const dy0 = e.clientY - d.y;
    if (Math.abs(dx0) > 3 || Math.abs(dy0) > 3) d.moved = true;
    if (!d.moved) return;
    userRotatedRef.current = true;
    const radius = (Math.min(size.width, size.height) / 2) * 0.86 * zoom;
    const k = 75 / radius;
    setRotate([
      d.rotate[0] + dx0 * k,
      clamp(d.rotate[1] - dy0 * k, -90, 90),
      0,
    ]);
  };
  const onPointerUp = (e: React.PointerEvent<HTMLCanvasElement>) => {
    const d = dragRef.current;
    dragRef.current = null;
    if (!d) return;
    if (!d.moved) {
      if (pickArmed) {
        pick(e.clientX, e.clientY);
        setPickArmed(false);
      } else {
        // A plain click (not armed) still hits a spot dot, matching Flat.
        const canvas = canvasRef.current;
        if (!canvas) return;
        const rect = canvas.getBoundingClientRect();
        const x = e.clientX - rect.left;
        const y = e.clientY - rect.top;
        for (const { x: sx, y: sy, spot } of spotScreenRef.current) {
          if ((sx - x) ** 2 + (sy - y) ** 2 <= 64) {
            onSelectDx(latLonToGrid(spot.pos, 4));
            break;
          }
        }
      }
    }
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
    ctx.clearRect(0, 0, width, height);

    const cx = width / 2;
    const cy = height / 2;
    const radius = projection.scale();
    const path = geoPath(projection, ctx);

    // Star field backdrop.
    ctx.save();
    for (const s of STARS) {
      ctx.globalAlpha = s.a;
      ctx.fillStyle = '#dce8ff';
      ctx.beginPath();
      ctx.arc(s.x * width, s.y * height, s.r, 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.restore();

    if (radius <= 0) return;

    // Atmosphere halo, behind the sphere.
    ctx.save();
    const halo = ctx.createRadialGradient(cx, cy, radius * 0.96, cx, cy, radius * 1.18);
    halo.addColorStop(0, 'rgba(77,210,255,0.32)');
    halo.addColorStop(1, 'rgba(77,210,255,0)');
    ctx.fillStyle = halo;
    ctx.beginPath();
    ctx.arc(cx, cy, radius * 1.18, 0, Math.PI * 2);
    ctx.fill();
    ctx.restore();

    // Sphere base — a stylistic lit/dark gradient, independent of the real
    // day/night terminator drawn below (that's actual astronomical data).
    ctx.save();
    const base = ctx.createRadialGradient(
      cx - radius * 0.35,
      cy - radius * 0.35,
      radius * 0.05,
      cx,
      cy,
      radius * 1.05,
    );
    base.addColorStop(0, '#1c3057');
    base.addColorStop(0.55, '#101c38');
    base.addColorStop(1, '#050a16');
    ctx.fillStyle = base;
    ctx.beginPath();
    ctx.arc(cx, cy, radius, 0, Math.PI * 2);
    ctx.fill();
    ctx.restore();

    // Everything on the sphere's surface, clipped to its disc.
    ctx.save();
    ctx.beginPath();
    ctx.arc(cx, cy, radius, 0, Math.PI * 2);
    ctx.clip();

    // Graticule — faint, reads as texture rather than data.
    ctx.beginPath();
    path(geoGraticule10());
    ctx.strokeStyle = 'rgba(140,160,190,0.10)';
    ctx.lineWidth = 0.5;
    ctx.stroke();

    // Land.
    ctx.beginPath();
    path(land as never);
    ctx.fillStyle = '#17301f';
    ctx.fill();
    ctx.strokeStyle = '#274a2e';
    ctx.lineWidth = 0.5;
    ctx.stroke();

    // Coverage heatmap (before the terminator, same z-order as Flat).
    if (coverageLayer) {
      const r = compositeRasters(projection, cx, cy, radius, [
        { layer: coverageLayer, alpha: 1 },
      ]);
      if (r) ctx.drawImage(r.canvas, r.x, r.y);
    }

    // Day/night terminator.
    ctx.beginPath();
    path({
      type: 'Polygon',
      coordinates: [night.map((p) => [p.lon, p.lat])],
    } as never);
    ctx.fillStyle = 'rgba(0,0,0,0.35)';
    ctx.fill();
    ctx.strokeStyle = 'rgba(232,178,61,0.5)';
    ctx.lineWidth = 1;
    ctx.stroke();

    // OVATION aurora / MUF field / blackout — same combined z-order as Flat.
    {
      const entries: RasterEntry[] = [];
      if (ovationLayer) entries.push({ layer: ovationLayer, alpha: 0.85 });
      if (mufFieldLayer) entries.push({ layer: mufFieldLayer, alpha: 0.9 });
      if (blackout) entries.push({ layer: blackout.layer, alpha: 1 });
      if (entries.length) {
        const r = compositeRasters(projection, cx, cy, radius, entries);
        if (r) ctx.drawImage(r.canvas, r.x, r.y);
      }
    }

    // Auroral oval vector fallback (only when OVATION isn't driving it).
    if (auroraRings) {
      for (const ring of auroraRings) {
        ctx.beginPath();
        path({
          type: 'LineString',
          coordinates: ring.map((p) => [p.lon, p.lat]),
        } as never);
        ctx.setLineDash([4, 6]);
        ctx.strokeStyle = '#d8574f';
        ctx.globalAlpha = 0.75;
        ctx.lineWidth = 2;
        ctx.stroke();
        ctx.setLineDash([]);
        ctx.globalAlpha = 1;
      }
    }

    const project = (p: LatLon): [number, number] | null => projection([p.lon, p.lat]);

    // MUF ionosonde stations.
    for (const s of mufStations) {
      const pt = project({ lat: s.station.latitude, lon: s.station.longitude });
      if (!pt) continue;
      const mufd = s.mufd as number;
      ctx.beginPath();
      ctx.arc(pt[0], pt[1], 4, 0, Math.PI * 2);
      ctx.fillStyle = mufColor(mufd);
      ctx.globalAlpha = previewing ? 0.15 : 0.55;
      ctx.fill();
      ctx.globalAlpha = previewing ? 0.3 : 1;
      ctx.lineWidth = 1.5;
      ctx.strokeStyle = mufColor(mufd);
      ctx.stroke();
      ctx.globalAlpha = 1;
    }

    // DX spots — cache screen positions for click hit-testing.
    const spotScreens: { x: number; y: number; spot: MapSpot }[] = [];
    for (const ms of mapSpots) {
      const pt = project(ms.pos);
      if (!pt) continue;
      spotScreens.push({ x: pt[0], y: pt[1], spot: ms });
      ctx.beginPath();
      ctx.arc(pt[0], pt[1], 3.5, 0, Math.PI * 2);
      ctx.fillStyle = BAND_GROUP_COLORS[ms.group];
      ctx.globalAlpha = previewing ? 0.25 : 0.85;
      ctx.fill();
      ctx.globalAlpha = 1;
    }
    spotScreenRef.current = spotScreens;

    // Subsolar point.
    const sunPt = project(sun);
    if (sunPt) {
      ctx.beginPath();
      ctx.arc(sunPt[0], sunPt[1], 9, 0, Math.PI * 2);
      ctx.fillStyle = 'rgba(232,178,61,0.2)';
      ctx.fill();
      ctx.beginPath();
      ctx.arc(sunPt[0], sunPt[1], 4, 0, Math.PI * 2);
      ctx.fillStyle = '#e8b23d';
      ctx.fill();
    }

    // Great-circle paths.
    if (shortPath) {
      ctx.beginPath();
      path({ type: 'LineString', coordinates: shortPath.map((p) => [p.lon, p.lat]) } as never);
      ctx.strokeStyle = '#4dd2ff';
      ctx.lineWidth = 2;
      ctx.stroke();
    }
    if (longPath) {
      ctx.beginPath();
      path({ type: 'LineString', coordinates: longPath.map((p) => [p.lon, p.lat]) } as never);
      ctx.setLineDash([6, 8]);
      ctx.strokeStyle = '#4dd2ff';
      ctx.globalAlpha = 0.6;
      ctx.lineWidth = 1.5;
      ctx.stroke();
      ctx.setLineDash([]);
      ctx.globalAlpha = 1;
    }

    // DE / DX markers, on top.
    if (de) {
      const pt = project(de);
      if (pt) {
        ctx.beginPath();
        ctx.arc(pt[0], pt[1], 6, 0, Math.PI * 2);
        ctx.fillStyle = '#7CFC9B';
        ctx.fill();
      }
    }
    if (dx) {
      const pt = project(dx);
      if (pt) {
        ctx.beginPath();
        ctx.arc(pt[0], pt[1], 6, 0, Math.PI * 2);
        ctx.fillStyle = '#ff7c7c';
        ctx.fill();
      }
    }

    ctx.restore(); // end sphere clip

    // Limb darkening, clipped to the disc again on top of everything drawn.
    ctx.save();
    ctx.beginPath();
    ctx.arc(cx, cy, radius, 0, Math.PI * 2);
    ctx.clip();
    const limb = ctx.createRadialGradient(cx, cy, radius * 0.55, cx, cy, radius);
    limb.addColorStop(0, 'rgba(0,0,0,0)');
    limb.addColorStop(1, 'rgba(0,0,0,0.55)');
    ctx.fillStyle = limb;
    ctx.beginPath();
    ctx.arc(cx, cy, radius, 0, Math.PI * 2);
    ctx.fill();
    ctx.restore();

    // Rim.
    ctx.beginPath();
    ctx.arc(cx, cy, radius, 0, Math.PI * 2);
    ctx.strokeStyle = 'rgba(140,170,210,0.45)';
    ctx.lineWidth = 1;
    ctx.stroke();
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
    <div className={`map-wrap globe-wrap ${pickArmed ? 'map-picking' : ''}`} ref={containerRef}>
      <canvas
        ref={canvasRef}
        className="globe-canvas"
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
        onContextMenu={onContextMenu}
      />

      <div className="map-ctl">
        <div className="map-ctl-title">layers</div>
        <label className="map-ctl-row">
          <input
            type="checkbox"
            checked={layers.coverage}
            onChange={() => toggle('coverage')}
          />
          coverage from DE
        </label>
        {layers.coverage && (
          <div className="map-ctl-bands">
            {HF_BANDS.map((b) => (
              <button
                key={b.name}
                className={`chip ${layers.coverageBand === b.name ? 'chip-on' : ''}`}
                onClick={() => setLayers((l) => ({ ...l, coverageBand: b.name }))}
              >
                {b.name}
              </button>
            ))}
            {(!de || props.ssn12 == null) && (
              <span className="map-ctl-hint">
                {!de ? 'set your DE grid first' : 'waiting for solar data'}
              </span>
            )}
          </div>
        )}
        <label className="map-ctl-row">
          <input type="checkbox" checked={layers.spots} onChange={() => toggle('spots')} />
          DX spots
        </label>
        <label className="map-ctl-row">
          <input type="checkbox" checked={layers.muf} onChange={() => toggle('muf')} />
          ionosonde MUF
        </label>
        <label className="map-ctl-row">
          <input type="checkbox" checked={layers.mufField} onChange={() => toggle('mufField')} />
          MUF field (interpolated)
        </label>
        <label className="map-ctl-row">
          <input type="checkbox" checked={layers.aurora} onChange={() => toggle('aurora')} />
          aurora {ovationLayer ? '(OVATION)' : '(approx oval)'}
        </label>
        <label className="map-ctl-row">
          <input type="checkbox" checked={layers.blackout} onChange={() => toggle('blackout')} />
          flare blackout
        </label>
        <button
          className={`chip map-ctl-pick ${pickArmed ? 'chip-on' : ''}`}
          onClick={() => setPickArmed((v) => !v)}
          title="click anywhere on the globe to set the DX target (right-click always works)"
        >
          🎯 {pickArmed ? 'click globe to set DX…' : 'pick DX on globe'}
        </button>
        <p className="map-ctl-hint globe-drag-hint">drag to rotate · scroll to zoom</p>
      </div>

      {(coverageLayer ||
        (layers.spots && mapSpots.length > 0) ||
        mufFieldLayer ||
        blackout ||
        ovationLayer) && (
        <div className="map-legend">
          {coverageLayer && (
            <div className="map-legend-row">
              <span className="map-legend-gradient" />
              <span>{layers.coverageBand} reliability from DE · estimate</span>
            </div>
          )}
          {mufFieldLayer && (
            <div className="map-legend-row">
              <span className="map-legend-gradient map-legend-muf" />
              <span>
                MUF(3000) field · interpolated from{' '}
                {props.fof2?.filter((s) => s.mufd != null && s.cs >= 25).length ?? 0} ionosondes
              </span>
            </div>
          )}
          {ovationLayer && (
            <div className="map-legend-row">
              <span className="map-legend-gradient map-legend-aurora" />
              <span>aurora probability · OVATION nowcast</span>
            </div>
          )}
          {blackout && (
            <div className="map-legend-row">
              <span className="map-legend-dot" style={{ background: '#d83a30' }} />
              <span>
                {blackout.cls} flare blackout · absorption to ~{Math.round(blackout.haf)} MHz at
                subsolar
              </span>
            </div>
          )}
          {layers.spots && mapSpots.length > 0 && (
            <div className="map-legend-row">
              {(Object.keys(BAND_GROUP_COLORS) as BandGroup[]).map((g) => (
                <span key={g} className="map-legend-swatch">
                  <span className="map-legend-dot" style={{ background: BAND_GROUP_COLORS[g] }} />
                  {BAND_GROUP_LABELS[g]}
                </span>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
