// Typed access to the backend proxy. Every response carries fetched_at and a
// stale flag; panels must surface both (DESIGN.md §9 — never present cached
// data as current without a timestamp).

export interface ApiEnvelope<T> {
  data: T;
  fetched_at: number; // unix seconds
  stale: boolean;
}

export interface SpaceWeather {
  sfi: { Flux: string; TimeStamp: string } | null;
  kp_series: { time: string; kp: number }[] | null;
  solar_cycle:
    | { time_tag: string; ssn: number | null; smoothed_ssn: number | null }[]
    | null;
  xray_latest: unknown;
}

export interface CmeAnalysis {
  time21_5: string;
  latitude: number | null;
  longitude: number | null;
  halfAngle: number | null;
  speed: number | null; // km/s
  type: string;
  isMostAccurate: boolean;
  associatedCMEID: string;
  note: string;
  link: string;
}

export interface Fof2Station {
  station: { name: string; longitude: number; latitude: number };
  fof2: number | null;
  mufd: number | null;
  time: string;
  cs: number; // confidence score
}

export interface Tle {
  name: string;
  line1: string;
  line2: string;
}

export interface Spot {
  spotter: string;
  freq_khz: number;
  dx_call: string;
  comment: string;
  spot_time: string | null;
  received_at: number;
}

export interface SpotsPayload {
  spots: Spot[];
  status: { connected: boolean; node: string | null; since: number | null };
}

async function get<T>(path: string): Promise<ApiEnvelope<T>> {
  const res = await fetch(path);
  if (!res.ok) throw new Error(`${path}: HTTP ${res.status}`);
  return res.json();
}

export const api = {
  spaceWeather: () => get<SpaceWeather>('/api/space-weather'),
  cmes: () => get<CmeAnalysis[]>('/api/cmes'),
  fof2: () => get<Fof2Station[]>('/api/fof2'),
  tles: () => get<Tle[]>('/api/tles'),
  spots: () => get<SpotsPayload>('/api/spots'),
};
