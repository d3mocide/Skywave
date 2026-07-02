// Placeholder climatological estimator used ONLY until the P533 WASM build
// is dropped in. It captures the broad shape of HF propagation — MUF rises
// with solar activity and daylight, low bands work at night, absorption
// kills low bands by day — so the UI is exercisable, but it is NOT P.533 and
// the UI labels its output as an estimate.

export interface EstimatorInput {
  mhz: number;
  distanceKm: number;
  ssn12: number;
  /** Solar elevation at path midpoint, degrees (negative = night). */
  midpathSolarElev: number;
}

export function estimateReliability(input: EstimatorInput): number {
  const { mhz, distanceKm, ssn12, midpathSolarElev } = input;

  // Day factor: smooth 0 (deep night) → 1 (high sun) across twilight.
  const day = 1 / (1 + Math.exp(-midpathSolarElev / 6));

  // Rough F2-layer MUF for the circuit: baseline foF2 grows with SSN and
  // daylight; obliquity factor rises toward ~3 for long single-hop paths.
  const foF2 = 3 + (ssn12 / 200) * 6 + day * 4; // MHz, very coarse
  const hop = Math.min(distanceKm, 4000);
  const obliquity = 1 + 2 * Math.sin((Math.PI / 2) * (hop / 4000));
  const muf = foF2 * obliquity;

  // Above the MUF: reliability collapses quickly.
  const mufMargin = (muf - mhz) / muf;
  const mufTerm = 1 / (1 + Math.exp(-mufMargin * 12));

  // D-layer absorption: hits low frequencies during daylight (~1/f²).
  const absorption = day * Math.min(1, 40 / (mhz * mhz));

  // Multi-hop loss on very long paths.
  const hops = Math.max(1, Math.ceil(distanceKm / 3500));
  const hopLoss = Math.pow(0.85, hops - 1);

  const r = mufTerm * (1 - 0.8 * absorption) * hopLoss;
  return Math.max(0, Math.min(1, r));
}
