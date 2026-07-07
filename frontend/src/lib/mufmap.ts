// Interpolated MUF(3000) field from the GIRO ionosonde network — turns the
// scatter of station readings into the continuous "what does the real
// ionosphere support right now" surface. Inverse-distance-weighted on the
// sphere, with confidence fading where the nearest sounder is far away:
// mid-ocean values are honest extrapolation and should look like it.

import type { Fof2Station } from './api';

const MAX_LAT = 85;
const W = 240;
const H = 150;

export const MUFMAP_BOUNDS: [[number, number], [number, number]] = [
  [-MAX_LAT, -180],
  [MAX_LAT, 180],
];

const DEG = Math.PI / 180;

function mercY(latDeg: number): number {
  return Math.log(Math.tan(Math.PI / 4 + (latDeg * DEG) / 2));
}

// Same gold ramp as the station dots (WorldMap.mufColor), interpolated so
// dots and field read as one layer. Stops at 7/14/21/28 MHz.
const STOPS: [number, [number, number, number]][] = [
  [4, [0x4a, 0x38, 0x00]],
  [7, [0x6e, 0x53, 0x00]],
  [14, [0xa6, 0x7c, 0x00]],
  [21, [0xd9, 0xa8, 0x32]],
  [28, [0xff, 0xd1, 0x66]],
  [35, [0xff, 0xe9, 0xa8]],
];

function mufRGB(muf: number): [number, number, number] {
  if (muf <= STOPS[0][0]) return STOPS[0][1];
  for (let k = 1; k < STOPS.length; k++) {
    if (muf <= STOPS[k][0]) {
      const [m0, c0] = STOPS[k - 1];
      const [m1, c1] = STOPS[k];
      const t = (muf - m0) / (m1 - m0);
      return [
        Math.round(c0[0] + (c1[0] - c0[0]) * t),
        Math.round(c0[1] + (c1[1] - c0[1]) * t),
        Math.round(c0[2] + (c1[2] - c0[2]) * t),
      ];
    }
  }
  return STOPS[STOPS.length - 1][1];
}

interface Sounder {
  x: number; // unit vector on the sphere
  y: number;
  z: number;
  muf: number;
}

/**
 * Render the IDW MUF(3000) field as a PNG data URL, or null when fewer than
 * three usable sounders are reporting (a "field" from two points is noise).
 */
export function renderMufMap(stations: Fof2Station[]): string | null {
  const sounders: Sounder[] = [];
  for (const s of stations) {
    if (s.mufd == null || s.cs < 25) continue;
    const φ = s.station.latitude * DEG;
    const λ = s.station.longitude * DEG;
    sounders.push({
      x: Math.cos(φ) * Math.cos(λ),
      y: Math.cos(φ) * Math.sin(λ),
      z: Math.sin(φ),
      muf: s.mufd,
    });
  }
  if (sounders.length < 3) return null;

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
    const lat = (2 * Math.atan(Math.exp(y)) - Math.PI / 2) / DEG;
    const φ = lat * DEG;
    const cosφ = Math.cos(φ);
    const sinφ = Math.sin(φ);
    for (let i = 0; i < W; i++) {
      const λ = (-180 + ((i + 0.5) / W) * 360) * DEG;
      const gx = cosφ * Math.cos(λ);
      const gy = cosφ * Math.sin(λ);
      const gz = sinφ;

      // IDW over angular distance; track the nearest sounder for the
      // confidence fade. Chord length ≈ angle for the scales involved.
      let wSum = 0;
      let vSum = 0;
      let nearest = Infinity;
      for (const s of sounders) {
        const dot = Math.max(-1, Math.min(1, gx * s.x + gy * s.y + gz * s.z));
        const ang = Math.acos(dot); // radians ≈ dist/R
        if (ang < nearest) nearest = ang;
        const w = 1 / (ang * ang + 1e-4);
        wSum += w;
        vSum += w * s.muf;
      }
      const muf = vSum / wSum;
      const nearestKm = nearest * 6371;
      // Full confidence within ~1500 km of a sounder, gone past ~4500 km.
      const conf = Math.max(0, Math.min(1, (4500 - nearestKm) / 3000));
      if (conf <= 0) continue;

      const [r, g, b] = mufRGB(muf);
      const o = (j * W + i) * 4;
      px[o] = r;
      px[o + 1] = g;
      px[o + 2] = b;
      px[o + 3] = Math.round(110 * conf);
    }
  }
  ctx.putImageData(img, 0, 0);
  return canvas.toDataURL('image/png');
}
