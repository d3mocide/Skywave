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
  /** Penticton F10.7 observations, ~2 months at up-to-3-per-day cadence. */
  sfi_history: { time: string; flux: number }[] | null;
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

export interface SolarRegion {
  region: number;
  latitude: number | null;
  longitude: number | null; // Stonyhurst, W positive
  location: string | null;
  area: number | null; // millionths of solar hemisphere
  spot_class: string | null; // McIntosh
  number_spots: number | null;
  mag_class: string | null; // Mount Wilson
  c_xray_events: number | null;
  m_xray_events: number | null;
  x_xray_events: number | null;
  observed_date: string | null;
}

export interface SolarActivity {
  regions: SolarRegion[] | null;
  probabilities: {
    date: string | null;
    c_class_1_day: number | null;
    m_class_1_day: number | null;
    x_class_1_day: number | null;
    '10mev_protons_1_day': number | null;
  } | null;
}

/** GOES long-band (0.1–0.8 nm) X-ray flux sample, W/m². */
export interface XraySample {
  time: string;
  flux: number;
}

/** Trailing window for /api/xray — 6 h live default, 1 d / 3 d for the
 * Space WX chart's range toggle. */
export type XrayRange = '6h' | '1d' | '3d';

/** OVATION hemispheric power (GW per auroral zone), 5-min cadence, 24 h. */
export interface HemiPower {
  series: { time: string; north: number | null; south: number | null }[];
}

export interface SolarWind {
  plasma: { time: string; density: number | null; speed: number | null }[] | null;
  mag: { time: string; bz: number | null; bt: number | null }[] | null;
}

export interface KpForecastPoint {
  time: string;
  kp: number;
  state: 'observed' | 'estimated' | 'predicted';
}

export interface AuroraForecast {
  forecast_time: string | null;
  /** [lon 0–359 E, lat −90–90, probability %] — cells ≥2% only. */
  points: [number, number, number][];
}

/** Solar imagery channels served by /api/sun/{channel}. */
export const SUN_CHANNELS = [
  { key: 'hmi', label: 'sunspots', title: 'HMI intensitygram — visible sunspots' },
  { key: 'mag', label: 'magnetic', title: 'HMI magnetogram — magnetic polarity' },
  { key: 'aia304', label: '304Å', title: 'AIA 304 — chromosphere, filaments & prominences' },
  { key: 'aia193', label: '193Å', title: 'AIA 193 — corona & coronal holes' },
  { key: 'aia171', label: '171Å', title: 'AIA 171 — quiet corona, magnetic loops' },
  { key: 'aia211', label: '211Å', title: 'AIA 211 — active region corona' },
  { key: 'lascoc2', label: 'LASCO C2', title: 'SOHO LASCO C2 coronagraph — CMEs 2–6 R☉' },
  { key: 'lascoc3', label: 'LASCO C3', title: 'SOHO LASCO C3 coronagraph — CMEs 4–30 R☉' },
] as const;

export type SunChannel = (typeof SUN_CHANNELS)[number]['key'];

export interface SunImage {
  objectUrl: string;
  fetchedAt: number | null; // ms epoch
  stale: boolean;
}

/** Time-lapse manifest: frame timestamps (unix s) available in the
 * backend's per-channel ring buffer, oldest first. */
export async function fetchSunFrames(
  channel: SunChannel,
): Promise<{ frames: number[]; interval_s: number }> {
  const res = await fetch(`/api/sun/${channel}/frames`);
  if (!res.ok) throw new Error(`/api/sun/${channel}/frames: HTTP ${res.status}`);
  return res.json();
}

export function sunFrameUrl(channel: SunChannel, ts: number): string {
  return `/api/sun/${channel}/frame/${ts}`;
}

/** Fetch a sun image as a blob so the freshness headers are readable —
 * the panel must show "last updated" like every other panel (§9). */
export async function fetchSunImage(channel: SunChannel): Promise<SunImage> {
  const res = await fetch(`/api/sun/${channel}`);
  if (!res.ok) throw new Error(`/api/sun/${channel}: HTTP ${res.status}`);
  const blob = await res.blob();
  const fetchedAt = Number(res.headers.get('X-Fetched-At'));
  return {
    objectUrl: URL.createObjectURL(blob),
    fetchedAt: Number.isFinite(fetchedAt) ? fetchedAt * 1000 : null,
    stale: res.headers.get('X-Stale') === '1',
  };
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

/** Windows served by /api/spot-history (aggregated in the bridge). */
export type SpotHistoryHours = 2 | 6 | 24;

/** Band×time-bin spot counts over the bridge's trailing window. */
export interface SpotHistorySummary {
  window_s: number;
  bin_s: number;
  until: number; // unix seconds, end of the newest bin
  /** Per band: counts oldest bin first, newest last. */
  bands: Record<string, number[]>;
  top: { call: string; count: number; bands: string[]; last_at: number }[];
  total: number;
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
  spotHistory: (hours: SpotHistoryHours) =>
    get<SpotHistorySummary>(`/api/spot-history?hours=${hours}`),
  solarActivity: () => get<SolarActivity>('/api/solar-activity'),
  xray: (range: XrayRange = '6h') => get<XraySample[]>(`/api/xray?range=${range}`),
  hemiPower: () => get<HemiPower>('/api/hemi-power'),
  solarWind: () => get<SolarWind>('/api/solar-wind'),
  kpForecast: () => get<KpForecastPoint[]>('/api/kp-forecast'),
  aurora: () => get<AuroraForecast>('/api/aurora'),
};
