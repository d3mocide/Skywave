// OVATION Prime aurora nowcast rendered to a canvas for a Leaflet
// ImageOverlay — the real modeled oval, superseding the dipole/Kp
// approximation whenever data is available.
//
// Same Mercator-row sampling as coverage.ts: ImageOverlay stretches the
// bitmap linearly in projected space, so rows must be spaced in Mercator Y
// or the oval smears toward the poles exactly where it matters most.

import type { AuroraForecast } from './api';
import { RASTER_MAX_LAT, mercY, finishRaster, type RasterLayer } from './mercRaster';

const MAX_LAT = RASTER_MAX_LAT;
const W = 360;
const H = 240;

export const AURORA_BOUNDS: [[number, number], [number, number]] = [
  [-MAX_LAT, -180],
  [MAX_LAT, 180],
];

/** Probability % → RGBA. Green through yellow to red as the oval
 * intensifies — the conventional aurora-forecast ramp. */
export function auroraRamp(p: number): [number, number, number, number] {
  const t = Math.min(1, p / 100);
  const r = t < 0.5 ? Math.round(80 + 350 * t) : 255;
  const g = t < 0.5 ? 220 : Math.round(220 - 320 * (t - 0.5));
  const a = Math.round(30 + 170 * Math.min(1, t * 2.2));
  return [r, g, 90, a];
}

export function renderAurora(data: AuroraForecast): RasterLayer | null {
  if (!data.points.length) return null;

  // Rebuild the dense 1° grid from the sparse ≥2% points.
  const grid = new Uint8Array(360 * 181);
  for (const [lon, lat, p] of data.points) {
    const x = ((Math.round(lon) % 360) + 360) % 360;
    const y = Math.round(lat) + 90;
    if (y >= 0 && y <= 180) grid[y * 360 + x] = Math.min(100, Math.max(0, p));
  }

  const canvas = document.createElement('canvas');
  canvas.width = W;
  canvas.height = H;
  const ctx = canvas.getContext('2d');
  if (!ctx) return null;
  const img = ctx.createImageData(W, H);
  const px = img.data;

  const yTop = mercY(MAX_LAT);
  const ySpan = 2 * yTop;
  for (let j = 0; j < H; j++) {
    const y = yTop - ((j + 0.5) / H) * ySpan;
    const lat = ((2 * Math.atan(Math.exp(y)) - Math.PI / 2) * 180) / Math.PI;
    const gy = Math.round(lat) + 90;
    for (let i = 0; i < W; i++) {
      // Canvas x spans −180…180; OVATION longitudes are 0…359 east.
      const lonE = (i - 180 + 360) % 360;
      const p = grid[gy * 360 + lonE];
      if (p < 2) continue;
      const [r, g, b, a] = auroraRamp(p);
      const o = (j * W + i) * 4;
      px[o] = r;
      px[o + 1] = g;
      px[o + 2] = b;
      px[o + 3] = a;
    }
  }
  return finishRaster(canvas, ctx, img);
}
