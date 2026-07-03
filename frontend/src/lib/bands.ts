// Amateur band edges and band classification, shared by the DX cluster panel
// and the map spot layer.

export const BAND_EDGES: { name: string; lo: number; hi: number }[] = [
  { name: '160m', lo: 1800, hi: 2000 },
  { name: '80m', lo: 3500, hi: 4000 },
  { name: '60m', lo: 5250, hi: 5450 },
  { name: '40m', lo: 7000, hi: 7300 },
  { name: '30m', lo: 10100, hi: 10150 },
  { name: '20m', lo: 14000, hi: 14350 },
  { name: '17m', lo: 18068, hi: 18168 },
  { name: '15m', lo: 21000, hi: 21450 },
  { name: '12m', lo: 24890, hi: 24990 },
  { name: '10m', lo: 28000, hi: 29700 },
  { name: '6m', lo: 50000, hi: 54000 },
];

export function bandOf(freqKhz: number): string | null {
  const b = BAND_EDGES.find((b) => freqKhz >= b.lo && freqKhz <= b.hi);
  return b?.name ?? null;
}

/**
 * Low/mid/high grouping for map color-coding: low bands are the night bands,
 * high bands live and die with solar flux. Three hues stay CVD-distinguishable
 * where nine would not (exact band is in the tooltip).
 */
export type BandGroup = 'low' | 'mid' | 'high';

export function bandGroup(band: string): BandGroup {
  if (['160m', '80m', '60m', '40m'].includes(band)) return 'low';
  if (['30m', '20m', '17m'].includes(band)) return 'mid';
  return 'high';
}

// Validated trio (all-pairs CVD ΔE 28.7 on the map surface) — see WorldMap.
export const BAND_GROUP_COLORS: Record<BandGroup, string> = {
  low: '#d95926',
  mid: '#1baf7a',
  high: '#9085e9',
};

export const BAND_GROUP_LABELS: Record<BandGroup, string> = {
  low: '160–40m',
  mid: '30–17m',
  high: '15m–6m',
};
