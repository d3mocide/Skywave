// Shared Canvas2D + d3-geo rendering core for GlobeMap (orthographic) and
// BeamMap (azimuthal-equidistant) — same layer data (useMapLayers), same
// draw order, different projection and a couple of mode-specific touches
// (Globe looks like a lit sphere; Beam looks like a flat bearing chart with
// distance rings and compass ticks, since that's what makes it useful).

import { geoPath, geoGraticule10, type GeoProjection } from 'd3-geo';
import { feature } from 'topojson-client';
import type { Topology } from 'topojson-specification';
import landTopo from 'world-atlas/land-110m.json';
import type { LatLon } from './geo';
import { EARTH_RADIUS_KM } from './geo';
import { BAND_GROUP_COLORS } from './bands';
import type { Fof2Station } from './api';
import type { MapSpot } from '../hooks/useMapLayers';
import { sampleRaster, type RasterLayer } from './mercRaster';

export const land = feature(
  landTopo as unknown as Topology,
  (landTopo as unknown as Topology).objects.land as never,
);

// Fixed star field, generated once at module load — a UI backdrop, not real
// sky data, so it doesn't need to be per-instance, per-mode, or seeded.
export const STARS = Array.from({ length: 220 }, () => ({
  x: Math.random(),
  y: Math.random(),
  r: Math.random() * 1.1 + 0.2,
  a: Math.random() * 0.6 + 0.15,
}));

export function mufColor(mufd: number): string {
  if (mufd >= 28) return '#ffe9a8';
  if (mufd >= 21) return '#ffd166';
  if (mufd >= 14) return '#d9a832';
  if (mufd >= 7) return '#a67c00';
  return '#6e5300';
}

export function clamp(v: number, lo: number, hi: number): number {
  return Math.max(lo, Math.min(hi, v));
}

interface RasterEntry {
  layer: RasterLayer;
  alpha: number;
}

/** Composite one or more Mercator raster layers onto an offscreen canvas by
 * inverse-projecting every pixel in the map disc's bounding box. Returned as
 * a canvas (not raw ImageData) so the caller can drawImage() it — that's the
 * only way to have it respect the main context's clip region and DPR scale;
 * putImageData ignores both. */
export function compositeRasters(
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

const BEARING_LABELS: [number, string][] = [
  [0, 'N'],
  [90, 'E'],
  [180, 'S'],
  [270, 'W'],
];

export interface CanvasMapDrawOptions {
  width: number;
  height: number;
  projection: GeoProjection;
  /** Pixel radius of the map disc's outer edge. For Globe this is
   * projection.scale() (clipAngle 90 — the disc *is* the visible
   * hemisphere); for Beam it's scale()·π (clipAngle 180 — the disc reaches
   * all the way to the antipode). */
  discRadius: number;
  mode: 'globe' | 'beam';
  de: LatLon | null;
  dx: LatLon | null;
  night: LatLon[];
  sun: LatLon;
  shortPath: LatLon[] | null;
  longPath: LatLon[] | null;
  coverageLayer: RasterLayer | null;
  ovationLayer: RasterLayer | null;
  auroraRings: LatLon[][] | null;
  mufFieldLayer: RasterLayer | null;
  blackout: { layer: RasterLayer; haf: number; cls: string } | null;
  mapSpots: MapSpot[];
  mufStations: Fof2Station[];
  previewing: boolean;
}

/** Draws one frame and returns the projected spot screen positions, for the
 * caller's click hit-testing. Redraw-on-change only — no animation loop. */
export function drawCanvasMap(
  ctx: CanvasRenderingContext2D,
  opts: CanvasMapDrawOptions,
): { x: number; y: number; spot: MapSpot }[] {
  const {
    width,
    height,
    projection,
    discRadius: radius,
    mode,
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
  } = opts;

  ctx.clearRect(0, 0, width, height);

  const cx = width / 2;
  const cy = height / 2;
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

  if (radius <= 0) return [];

  if (mode === 'globe') {
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
  } else {
    // Flat chart disc — a subtle vignette, not a "lit sphere": this isn't
    // depicting a 3-D object, it's a bearing/distance chart.
    ctx.save();
    const base = ctx.createRadialGradient(cx, cy, 0, cx, cy, radius);
    base.addColorStop(0, '#101c38');
    base.addColorStop(1, '#060a16');
    ctx.fillStyle = base;
    ctx.beginPath();
    ctx.arc(cx, cy, radius, 0, Math.PI * 2);
    ctx.fill();
    ctx.restore();
  }

  // Everything on the map disc, clipped to its edge.
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

  // Distance rings (Beam only) — the whole point of an azimuthal-equidistant
  // chart is reading true distance off the radius, so make the scale visible.
  if (mode === 'beam') {
    const maxKm = Math.PI * EARTH_RADIUS_KM;
    for (const km of [5000, 10000, 15000]) {
      const r = radius * (km / maxKm);
      if (r <= 0 || r >= radius) continue;
      ctx.beginPath();
      ctx.arc(cx, cy, r, 0, Math.PI * 2);
      ctx.strokeStyle = 'rgba(140,160,190,0.18)';
      ctx.lineWidth = 0.5;
      ctx.stroke();
      ctx.fillStyle = 'rgba(200,210,230,0.55)';
      ctx.font = '9px ui-monospace, monospace';
      ctx.fillText(`${km / 1000}k km`, cx + 4, cy - r - 2);
    }
  }

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
    const r = compositeRasters(projection, cx, cy, radius, [{ layer: coverageLayer, alpha: 1 }]);
    if (r) ctx.drawImage(r.canvas, r.x, r.y);
  }

  // Day/night terminator.
  ctx.beginPath();
  path({ type: 'Polygon', coordinates: [night.map((p) => [p.lon, p.lat])] } as never);
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
      path({ type: 'LineString', coordinates: ring.map((p) => [p.lon, p.lat]) } as never);
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
    const mufdVal = s.mufd as number;
    ctx.beginPath();
    ctx.arc(pt[0], pt[1], 4, 0, Math.PI * 2);
    ctx.fillStyle = mufColor(mufdVal);
    ctx.globalAlpha = previewing ? 0.15 : 0.55;
    ctx.fill();
    ctx.globalAlpha = previewing ? 0.3 : 1;
    ctx.lineWidth = 1.5;
    ctx.strokeStyle = mufColor(mufdVal);
    ctx.stroke();
    ctx.globalAlpha = 1;
  }

  // DX spots — screen positions returned for the caller's click hit-testing.
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

  ctx.restore(); // end disc clip

  if (mode === 'globe') {
    // Limb darkening, clipped to the disc again on top of everything drawn —
    // only makes sense as a 3-D cue, so Globe-only.
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
  } else {
    // Compass bearing ticks around the rim — true bearing from DE reads
    // directly off the angle, same convention as a wall beam-heading chart:
    // rotate() with gamma=0 puts true north at the top of the disc.
    ctx.save();
    for (let b = 0; b < 360; b += 30) {
      const a = ((b - 90) * Math.PI) / 180;
      const inner = radius - (b % 90 === 0 ? 9 : 5);
      const x0 = cx + inner * Math.cos(a);
      const y0 = cy + inner * Math.sin(a);
      const x1 = cx + radius * Math.cos(a);
      const y1 = cy + radius * Math.sin(a);
      ctx.beginPath();
      ctx.moveTo(x0, y0);
      ctx.lineTo(x1, y1);
      ctx.strokeStyle = 'rgba(160,180,210,0.5)';
      ctx.lineWidth = 1;
      ctx.stroke();
    }
    ctx.fillStyle = '#8ca0c4';
    ctx.font = '11px ui-monospace, monospace';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    for (const [b, label] of BEARING_LABELS) {
      const a = ((b - 90) * Math.PI) / 180;
      const x = cx + (radius + 13) * Math.cos(a);
      const y = cy + (radius + 13) * Math.sin(a);
      ctx.fillText(label, x, y);
    }
    ctx.textAlign = 'start';
    ctx.textBaseline = 'alphabetic';
    ctx.restore();
  }

  // Rim.
  ctx.beginPath();
  ctx.arc(cx, cy, radius, 0, Math.PI * 2);
  ctx.strokeStyle = 'rgba(140,170,210,0.45)';
  ctx.lineWidth = 1;
  ctx.stroke();

  return spotScreens;
}
