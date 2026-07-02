// Propagation engine facade (DESIGN.md §4, §9).
//
// The real engine is ITU-R P.533 compiled to WASM (see /p533-wasm at the repo
// root). Until that binary is present, predictions come from a simple
// climatological estimator and every result is tagged engine:'estimate' so
// the UI can say so honestly. The interface is identical either way, so
// dropping in the WASM build changes no calling code.

import type { LatLon } from '../geo';
import {
  distanceKm,
  greatCirclePoints,
  crossesAuroralZone,
} from '../geo';
import { solarElevation } from '../solar';
import { estimateReliability } from './estimator';

// P.533 / ITURHFProp validity: 2–30 MHz oblique paths. Outside that we
// refuse rather than return a plausible-looking wrong number (§9).
export const P533_MIN_FREQ_MHZ = 2;
export const P533_MAX_FREQ_MHZ = 30;
export const NVIS_LIMIT_KM = 300;
export const AURORAL_GEOMAG_LAT = 62;

export const HF_BANDS: { name: string; mhz: number }[] = [
  { name: '80m', mhz: 3.6 },
  { name: '60m', mhz: 5.36 },
  { name: '40m', mhz: 7.1 },
  { name: '30m', mhz: 10.12 },
  { name: '20m', mhz: 14.15 },
  { name: '17m', mhz: 18.1 },
  { name: '15m', mhz: 21.2 },
  { name: '12m', mhz: 24.94 },
  { name: '10m', mhz: 28.4 },
];

export interface CircuitInput {
  de: LatLon;
  dx: LatLon;
  utc: Date;
  /** SMOOTHED sunspot number (SSN12) — never the raw daily SSN (§4). */
  ssn12: number;
}

export interface BandPrediction {
  band: string;
  mhz: number;
  /** 0–1 monthly-median circuit reliability, or null if outside validity. */
  reliability: number | null;
  outOfModelRange: boolean;
}

export interface CircuitPrediction {
  engine: 'p533-wasm' | 'estimate';
  distanceKm: number;
  bands: BandPrediction[];
  flags: {
    /** <300 km — NVIS territory, oblique P.533 not valid (§9). */
    nvis: boolean;
    /** Path crosses ~62°+ geomagnetic latitude — lower confidence (§9). */
    auroral: boolean;
  };
}

let wasmEngine: ((input: CircuitInput, mhz: number) => number) | null = null;
let initPromise: Promise<boolean> | null = null;

/** Try to load the WASM P533 build. Resolves false if not present.
 * Memoized: React StrictMode double-invokes effects, and two concurrent
 * loads would race on the IDBFS mount and the 11 MB ionos download. */
export function initWasmEngine(): Promise<boolean> {
  if (!initPromise) initPromise = tryInitWasm();
  return initPromise;
}

async function tryInitWasm(): Promise<boolean> {
  try {
    // Served alongside the app when p533-wasm has been built (see
    // /p533-wasm/README.md). Probe first: when the build is absent the SPA
    // fallback would answer the import with index.html and Chrome logs a
    // noisy MIME error. The specifier goes through a variable so neither TS
    // nor Vite tries to resolve this runtime-only module at build time.
    const loaderUrl = '/p533/loader.js';
    const probe = await fetch(loaderUrl, { method: 'HEAD' });
    if (!probe.ok || !probe.headers.get('content-type')?.includes('javascript')) {
      return false;
    }
    const mod = await import(/* @vite-ignore */ loaderUrl);
    wasmEngine = await mod.createP533();
    return true;
  } catch {
    return false;
  }
}

export function predictCircuit(input: CircuitInput): CircuitPrediction {
  const dist = distanceKm(input.de, input.dx);
  const path = greatCirclePoints(input.de, input.dx, 32);
  const nvis = dist < NVIS_LIMIT_KM;
  const auroral = crossesAuroralZone(path, AURORAL_GEOMAG_LAT);

  const bands: BandPrediction[] = HF_BANDS.map(({ name, mhz }) => {
    if (mhz < P533_MIN_FREQ_MHZ || mhz > P533_MAX_FREQ_MHZ || nvis) {
      return { band: name, mhz, reliability: null, outOfModelRange: true };
    }
    const reliability = wasmEngine
      ? wasmEngine(input, mhz)
      : estimateReliability({
          mhz,
          distanceKm: dist,
          ssn12: input.ssn12,
          // Mid-path solar elevation drives the day/night behavior
          midpathSolarElev: solarElevation(
            path[Math.floor(path.length / 2)],
            input.utc,
          ),
        });
    return { band: name, mhz, reliability, outOfModelRange: false };
  });

  return {
    engine: wasmEngine ? 'p533-wasm' : 'estimate',
    distanceKm: dist,
    bands,
    flags: { nvis, auroral },
  };
}
