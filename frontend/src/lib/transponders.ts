// Static transponder quick-reference for the common amateur birds shown in
// the Satellites view (TABS-REDESIGN-PLAN.md Phase D). Frequencies change
// rarely; this is a convenience layer, not a live database — Phase F tracks
// replacing it with a maintained source (SatNOGS DB) if it earns its keep.
// Compiled from AMSAT/ARISS published plans, 2026-07.

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
