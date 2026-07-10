// Transponder reference for the Satellites view. Primary source is the
// SatNOGS DB via /api/transponders (Phase F), matched by NORAD id from the
// TLE; the static table below is the offline/outage fallback (compiled
// from AMSAT/ARISS published plans, 2026-07 — frequencies change rarely).

import type { Transponder } from './api';

export interface TransponderInfo {
  /** Matched against the TLE name, case-insensitive substring. */
  match: string;
  uplink: string;
  downlink: string;
  mode: string;
}

export const TRANSPONDERS: TransponderInfo[] = [
  {
    match: 'ISS',
    uplink: '145.990 (67 Hz)',
    downlink: '437.800',
    mode: 'FM repeater · APRS 145.825',
  },
  {
    match: 'SO-50',
    uplink: '145.850 (67 Hz)',
    downlink: '436.795',
    mode: 'FM voice',
  },
  {
    match: 'AO-91',
    uplink: '435.250 (67 Hz)',
    downlink: '145.960',
    mode: 'FM voice',
  },
  {
    match: 'RS-44',
    uplink: '145.935–145.995',
    downlink: '435.610–435.670',
    mode: 'linear SSB/CW (inverting)',
  },
  {
    match: 'IO-117',
    uplink: '435.310',
    downlink: '435.310',
    mode: '1k2 GMSK digipeater',
  },
  {
    match: 'GREENCUBE',
    uplink: '435.310',
    downlink: '435.310',
    mode: '1k2 GMSK digipeater',
  },
  {
    match: 'AO-7',
    uplink: '432.125–432.175',
    downlink: '145.925–145.975',
    mode: 'linear SSB/CW (mode B, inverting)',
  },
  {
    match: 'FO-29',
    uplink: '145.900–146.000',
    downlink: '435.800–435.900',
    mode: 'linear SSB/CW (inverting)',
  },
  {
    match: 'PO-101',
    uplink: '145.900 (141.3 Hz)',
    downlink: '437.500',
    mode: 'FM voice (scheduled)',
  },
];

export function transponderFor(name: string): TransponderInfo | null {
  const n = name.toUpperCase();
  return TRANSPONDERS.find((t) => n.includes(t.match.toUpperCase())) ?? null;
}

/** NORAD catalog number from TLE line 1 (columns 3–7). */
export function noradOf(line1: string): number | null {
  const n = parseInt(line1.slice(2, 7), 10);
  return Number.isFinite(n) && n > 0 ? n : null;
}

const fmtMHz = (hz: number | null): string | null =>
  hz != null && hz > 0 ? (hz / 1e6).toFixed(3) : null;

function fmtRange(lo: number | null, hi: number | null): string {
  const a = fmtMHz(lo);
  const b = fmtMHz(hi);
  if (a && b && a !== b) return `${a}–${b}`;
  return a ?? b ?? '—';
}

/** Live SatNOGS entry → the same display shape as the static table. */
export function liveToDisplay(t: Transponder): TransponderInfo & { desc: string } {
  const mode = [
    t.mode,
    t.invert ? 'inverting' : null,
    t.baud != null && t.baud > 0 ? `${Math.round(t.baud)} bd` : null,
  ]
    .filter(Boolean)
    .join(' · ');
  return {
    match: '',
    desc: t.desc || t.type,
    uplink: fmtRange(t.uplink_low, t.uplink_high),
    downlink: fmtRange(t.downlink_low, t.downlink_high),
    mode: mode || t.type,
  };
}

/** Group the compact SatNOGS list by NORAD id, transponder-type entries
 * first (the thing an operator points at before beacons/telemetry). */
export function groupByNorad(list: Transponder[]): Map<number, Transponder[]> {
  const by = new Map<number, Transponder[]>();
  for (const t of list) {
    const cur = by.get(t.norad);
    if (cur) cur.push(t);
    else by.set(t.norad, [t]);
  }
  const rank = (t: Transponder) =>
    t.type.toLowerCase().includes('transponder') ? 0 : t.uplink_low != null ? 1 : 2;
  for (const arr of by.values()) arr.sort((a, b) => rank(a) - rank(b));
  return by;
}
