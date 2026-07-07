// GOES X-ray flux interpretation: flare classes, NOAA R-scale, and the
// D-RAP-style dayside absorption estimate used by the map blackout layer.
//
// Flare classes are decades of long-band (0.1–0.8 nm) flux in W/m²:
//   A < 1e-7 ≤ B < 1e-6 ≤ C < 1e-5 ≤ M < 1e-4 ≤ X

import type { XraySample } from './api';

export interface FlareClass {
  letter: 'A' | 'B' | 'C' | 'M' | 'X';
  magnitude: number; // e.g. 2.3 for C2.3
  label: string; // "C2.3"
}

export function classifyFlux(flux: number): FlareClass {
  let letter: FlareClass['letter'];
  let base: number;
  if (flux >= 1e-4) [letter, base] = ['X', 1e-4];
  else if (flux >= 1e-5) [letter, base] = ['M', 1e-5];
  else if (flux >= 1e-6) [letter, base] = ['C', 1e-6];
  else if (flux >= 1e-7) [letter, base] = ['B', 1e-7];
  else [letter, base] = ['A', 1e-8];
  const magnitude = flux / base;
  return {
    letter,
    magnitude,
    label: `${letter}${magnitude >= 10 ? magnitude.toFixed(0) : magnitude.toFixed(1)}`,
  };
}

/** NOAA radio blackout scale: R1 = M1 … R5 = X20. Null below M1. */
export function rScale(flux: number): { level: number; label: string } | null {
  if (flux >= 2e-3) return { level: 5, label: 'R5 extreme' };
  if (flux >= 1e-3) return { level: 4, label: 'R4 severe' };
  if (flux >= 1e-4) return { level: 3, label: 'R3 strong' };
  if (flux >= 5e-5) return { level: 2, label: 'R2 moderate' };
  if (flux >= 1e-5) return { level: 1, label: 'R1 minor' };
  return null;
}

export interface XrayNow {
  flux: number;
  time: string;
  cls: FlareClass;
  r: { level: number; label: string } | null;
  /** Flux still climbing over the last ~10 min and already ≥C — eruption
   * in progress rather than decay. */
  rising: boolean;
}

export function xrayNow(series: XraySample[] | null): XrayNow | null {
  if (!series?.length) return null;
  const last = series[series.length - 1];
  const tenAgo = series[Math.max(0, series.length - 11)];
  return {
    flux: last.flux,
    time: last.time,
    cls: classifyFlux(last.flux),
    r: rScale(last.flux),
    rising: last.flux >= 1e-6 && last.flux > tenAgo.flux * 1.5,
  };
}

/**
 * Highest affected frequency (MHz) at the subsolar point for the current
 * flux — the standard D-RAP empirical fit. Elsewhere on the dayside it
 * scales by cos(solar zenith angle)^0.75. Below ~2 MHz the event is a
 * non-story for HF and callers should draw nothing.
 */
export function highestAffectedFreq(flux: number): number {
  return Math.max(0, 10 * Math.log10(flux) + 65);
}
