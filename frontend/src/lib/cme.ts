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

/** DBM integration from 21.5 R☉ up to `stopT` seconds or 1 AU. */
function integrate(v0: number, stopT: number): { dist: number; v: number; t: number } {
  // Closed-form DBM: v(t) = w + (v0-w)/(1 ± γ(v0-w)t), integrate numerically
  // for distance — a 10-minute step is far below the model's own error bars.
  let v = v0; // km/s
  let dist = SUN_START_KM;
  let t = 0; // seconds
  const dt = 600;
  while (dist < AU_KM && t < stopT) {
    const dv = v - AMBIENT_KMS;
    const sign = dv >= 0 ? 1 : -1;
    v = v - sign * GAMMA * dv * dv * dt;
    dist += v * dt;
    t += dt;
  }
  return { dist, v, t };
}

export function estimateArrival(cme: CmeAnalysis): ArrivalEstimate | null {
  if (!cme.speed || !cme.time21_5) return null;
  const launch = new Date(cme.time21_5);
  if (isNaN(launch.getTime())) return null;

  const maxT = 15 * 86400; // give up past 15 days (never Earth-effective)
  const { dist, v, t } = integrate(cme.speed, maxT);
  if (dist < AU_KM) return null;

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

/**
 * Fraction of the Sun→Earth distance covered by `now`, from the same DBM
 * integration as estimateArrival (not a linear time fraction — the CME
 * decelerates, so it covers the first half faster).
 */
export function sunEarthFraction(cme: CmeAnalysis, now: Date): number | null {
  if (!cme.speed || !cme.time21_5) return null;
  const launch = new Date(cme.time21_5).getTime();
  if (isNaN(launch)) return null;
  const elapsed = (now.getTime() - launch) / 1000;
  if (elapsed <= 0) return 0;
  const { dist } = integrate(cme.speed, elapsed);
  return Math.min(1, dist / AU_KM);
}

/**
 * DBM transit-time error, as a fraction of the transit. Published DBM
 * validations put arrival errors around ±10–17 h on ~3-day transits, so a
 * flat 15% is honest without pretending to per-event precision.
 */
export const TRANSIT_UNCERTAINTY_FRAC = 0.15;

/** Stable row id — DONKI analyses have no id of their own. */
export function cmeKey(cme: CmeAnalysis): string {
  return cme.associatedCMEID + cme.time21_5;
}

export type CmeTier = 'severe' | 'elevated' | 'directed' | 'offaxis';

/**
 * Display tier for an analysis: earth-directed events grade by the same
 * speed-only Kp potential the readouts use; everything else is background.
 */
export function cmeTier(est: ArrivalEstimate | null): CmeTier {
  if (!est?.earthDirected) return 'offaxis';
  const { kpEst } = stormPotential(est.speedAtEarthKms);
  if (kpEst >= 5) return 'severe';
  if (kpEst >= 4) return 'elevated';
  return 'directed';
}

/**
 * Very rough storm potential from arrival speed alone (no Bz, no density —
 * the honest label is "potential", not "forecast"). Tuned so ~480 km/s reads
 * quiet and ~1000 km/s reads storm-capable.
 */
export function stormPotential(speedAtEarthKms: number): {
  kpEst: number;
  label: string;
  severe: boolean;
} {
  const kpEst = Math.max(0, Math.min(9, (speedAtEarthKms - 240) / 100));
  const label =
    kpEst < 4
      ? 'below storm level'
      : kpEst < 5
        ? 'active conditions'
        : kpEst < 6
          ? 'G1 possible'
          : kpEst < 7
            ? 'G2 possible'
            : 'G3+ possible';
  return { kpEst, label, severe: kpEst >= 5 };
}
