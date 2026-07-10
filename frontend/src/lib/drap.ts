// NOAA D-RAP absorption rendered to a raster layer — the authoritative
// replacement for the client-side flare model in blackout.ts whenever the
// feed is available. Same Mercator-row sampling as aurora.ts, same red
// ramp as blackout.ts so the layer reads identically whichever source is
// driving it. Crucially D-RAP includes polar cap absorption (proton
// events), which the X-ray-only model cannot know about.

import type { DrapData } from './api';
import { RASTER_MAX_LAT, mercY, finishRaster, type RasterLayer } from './mercRaster';

// Raster extent matches BLACKOUT_BOUNDS — the layer slots into the same
// ImageOverlay whichever source renders it.
const MAX_LAT = RASTER_MAX_LAT;
const W = 240;
const H = 150;

/** Grid step of the SWPC product (degrees) — used to rebuild a dense
 * lookup from the sparse points. Derived defensively from the data in
 * case SWPC ever changes resolution. */
function gridStep(values: number[]): number {
  const uniq = [...new Set(values)].sort((a, b) => a - b);
  let best = Infinity;
  for (let i = 1; i < uniq.length; i++) best = Math.min(best, uniq[i] - uniq[i - 1]);
  return isFinite(best) && best > 0 ? best : 2;
}

export function renderDrap(data: DrapData): RasterLayer | null {
  if (!data.points.length) return null;

  const lonStep = gridStep(data.points.map((p) => p[0]));
  const latStep = gridStep(data.points.map((p) => p[1]));
  const nx = Math.round(360 / lonStep);
  const ny = Math.round(180 / latStep) + 1;
  const grid = new Float32Array(nx * ny);
  for (const [lon, lat, mhz] of data.points) {
    const x = ((Math.round((lon + 180) / lonStep) % nx) + nx) % nx;
    const y = Math.round((lat + 90) / latStep);
    if (y >= 0 && y < ny) grid[y * nx + x] = mhz;
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
    const gy = Math.round((lat + 90) / latStep);
    if (gy < 0 || gy >= ny) continue;
    for (let i = 0; i < W; i++) {
      const lon = -180 + ((i + 0.5) / W) * 360;
      const gx = ((Math.round((lon + 180) / lonStep) % nx) + nx) % nx;
      const mhz = grid[gy * nx + gx];
      if (mhz < 1) continue;
      // Same red as blackout.ts; alpha ramps 1 MHz (barely visible) →
      // 30 MHz+ (all of HF gone, near-solid).
      const t = Math.min(1, (mhz - 1) / 29);
      const o = (j * W + i) * 4;
      px[o] = 0xd8;
      px[o + 1] = 0x3a;
      px[o + 2] = 0x30;
      px[o + 3] = Math.round(28 + 150 * t);
    }
  }
  return finishRaster(canvas, ctx, img);
}
