// Flare radio-blackout layer: during an X-ray flare the dayside D-layer
// absorbs HF, hardest at the subsolar point and fading toward the
// terminator (D-RAP behavior). Rendered as a red canvas overlay whose
// alpha follows local absorption — appears only while a flare is in
// progress, so the layer costs nothing on a quiet Sun.

import type { LatLon } from './geo';
import { subsolarPoint } from './solar';
import { highestAffectedFreq } from './xray';

const MAX_LAT = 85;
const W = 240;
const H = 150;

export const BLACKOUT_BOUNDS: [[number, number], [number, number]] = [
  [-MAX_LAT, -180],
  [MAX_LAT, 180],
];

const DEG = Math.PI / 180;

function mercY(latDeg: number): number {
  return Math.log(Math.tan(Math.PI / 4 + (latDeg * DEG) / 2));
}

/**
 * Render the absorption overlay, or null when the flare is too weak to
 * matter (subsolar highest-affected-frequency under ~5 MHz).
 */
export function renderBlackout(flux: number, utc: Date): string | null {
  const hafSubsolar = highestAffectedFreq(flux);
  if (hafSubsolar < 5) return null;

  const sun: LatLon = subsolarPoint(utc);
  const φs = sun.lat * DEG;
  const sinφs = Math.sin(φs);
  const cosφs = Math.cos(φs);

  const canvas = document.createElement('canvas');
  canvas.width = W;
  canvas.height = H;
  const ctx = canvas.getContext('2d');
  if (!ctx) return null;
  const img = ctx.createImageData(W, H);
  const px = img.data;

  // Severity 0…1 scales overall opacity: M1 (HAF 15) faint, X10+ solid.
  const severity = Math.max(0, Math.min(1, (hafSubsolar - 5) / 30));

  const yTop = mercY(MAX_LAT);
  const ySpan = 2 * yTop;
  for (let j = 0; j < H; j++) {
    const y = yTop - ((j + 0.5) / H) * ySpan;
    const lat = (2 * Math.atan(Math.exp(y)) - Math.PI / 2) / DEG;
    const φ = lat * DEG;
    for (let i = 0; i < W; i++) {
      const lon = -180 + ((i + 0.5) / W) * 360;
      const cosχ =
        Math.sin(φ) * sinφs +
        Math.cos(φ) * cosφs * Math.cos((lon - sun.lon) * DEG);
      if (cosχ <= 0) continue; // night side — no D-layer photoionization
      // D-RAP: absorption scales ~cos^0.75 of the solar zenith angle.
      const local = Math.pow(cosχ, 0.75);
      const o = (j * W + i) * 4;
      px[o] = 0xd8;
      px[o + 1] = 0x3a;
      px[o + 2] = 0x30;
      px[o + 3] = Math.round(150 * severity * local);
    }
  }
  ctx.putImageData(img, 0, 0);
  return canvas.toDataURL('image/png');
}
