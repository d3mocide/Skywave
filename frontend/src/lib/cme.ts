// Drag-based CME arrival estimate, computed client-side from the DONKI
// catalog (DESIGN.md §7) — same approach as CME Tracker. This is the simple
// drag-based interplanetary propagation model (Vršnak et al.-style DBM):
// the CME decelerates (or accelerates) toward ambient solar wind speed with
// drag ∝ relative speed.

import type { CmeAnalysis } from './api';

const AU_KM = 149_597_871;
const SUN_START_KM = 21.5 * 695_700; // DONKI speeds are fitted at 21.5 R☉
const AMBIENT_KMS = 450; // typical slow solar wind
const GAMMA = 0.2e-7; // drag parameter, 1/km — mid-range published value

export interface ArrivalEstimate {
  arrival: Date;
  transitHours: number;
  speedAtEarthKms: number;
  /** Loose screen: |latitude| and |longitude| small enough to matter. */
  earthDirected: boolean;
}

export function estimateArrival(cme: CmeAnalysis): ArrivalEstimate | null {
  if (!cme.speed || !cme.time21_5) return null;
  const launch = new Date(cme.time21_5);
  if (isNaN(launch.getTime())) return null;

  // Closed-form DBM: v(t) = w + (v0-w)/(1 ± γ(v0-w)t), integrate numerically
  // for distance — a 10-minute step is far below the model's own error bars.
  let v = cme.speed; // km/s
  let dist = SUN_START_KM;
  let t = 0; // seconds
  const dt = 600;
  const target = AU_KM;
  const maxT = 15 * 86400; // give up past 15 days (never Earth-effective)
  while (dist < target && t < maxT) {
    const dv = v - AMBIENT_KMS;
    const sign = dv >= 0 ? 1 : -1;
    v = v - sign * GAMMA * dv * dv * dt;
    dist += v * dt;
    t += dt;
  }
  if (dist < target) return null;

  const lon = cme.longitude ?? 999;
  const lat = cme.latitude ?? 999;
  const half = cme.halfAngle ?? 30;
  const earthDirected =
    Math.abs(lon) <= half + 10 && Math.abs(lat) <= half + 10;

  return {
    arrival: new Date(launch.getTime() + t * 1000),
    transitHours: t / 3600,
    speedAtEarthKms: v,
    earthDirected,
  };
}
