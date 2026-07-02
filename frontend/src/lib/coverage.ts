// World coverage heatmap: estimated reliability from the DE station to every
// point on Earth for one band, rendered to a canvas for a Leaflet
// ImageOverlay. Always computed with the fast climatological estimator —
// ~40k circuit evaluations per repaint is nothing for it, but would take
// seconds through the P533 WASM engine — so the layer is labeled "estimate"
// regardless of which engine drives the per-circuit panels.

import type { LatLon } from './geo';
import { distanceKm, midpoint } from './geo';
import { solarElevation } from './solar';
import { estimateReliability } from './propagation/estimator';

// Web Mercator clips at ±85.05°; the overlay must match or land shifts.
const MAX_LAT = 85;
const W = 288;
const H = 144;

export const COVERAGE_BOUNDS: [[number, number], [number, number]] = [
  [-MAX_LAT, -180],
  [MAX_LAT, 180],
];

// Single-hue alpha ramp on the app accent (sequential job: magnitude only).
const R = 0x4d, G = 0xd2, B = 0xff;

function mercY(latDeg: number): number {
  const φ = (latDeg * Math.PI) / 180;
  return Math.log(Math.tan(Math.PI / 4 + φ / 2));
}

/**
 * Render the coverage grid as a PNG data URL. Rows are spaced uniformly in
 * Mercator Y (not latitude): ImageOverlay stretches the bitmap linearly in
 * projected space, so uniform-latitude rows would smear toward the poles.
 */
export function renderCoverage(
  de: LatLon,
  mhz: number,
  utc: Date,
  ssn12: number,
): string | null {
  const canvas = document.createElement('canvas');
  canvas.width = W;
  canvas.height = H;
  const ctx = canvas.getContext('2d');
  if (!ctx) return null;

  const yTop = mercY(MAX_LAT);
  const ySpan = 2 * yTop;
  const img = ctx.createImageData(W, H);
  const px = img.data;

  for (let j = 0; j < H; j++) {
    const y = yTop - ((j + 0.5) / H) * ySpan;
    const lat = ((2 * Math.atan(Math.exp(y)) - Math.PI / 2) * 180) / Math.PI;
    for (let i = 0; i < W; i++) {
      const lon = -180 + ((i + 0.5) / W) * 360;
      const p = { lat, lon };
      const dist = distanceKm(de, p);
      const rel = estimateReliability({
        mhz,
        distanceKm: dist,
        ssn12,
        midpathSolarElev: solarElevation(midpoint(de, p), utc),
      });
      // Quadratic alpha: linear washes the whole map at high solar flux;
      // squaring keeps the open regions bright and lets marginal ones recede.
      const a = rel < 0.03 ? 0 : Math.round(rel * rel * 150);
      const o = (j * W + i) * 4;
      px[o] = R;
      px[o + 1] = G;
      px[o + 2] = B;
      px[o + 3] = a;
    }
  }
  ctx.putImageData(img, 0, 0);
  return canvas.toDataURL('image/png');
}
