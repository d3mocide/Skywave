// Solar position, sunrise/sunset, and the day/night terminator.
// All calculations run in UTC (DESIGN.md §9) — timezone handling is
// display-only and never feeds these functions.

import type { LatLon } from './geo';

const DEG = Math.PI / 180;

/** Julian date from a JS Date (which is inherently UTC-based). */
function julian(date: Date): number {
  return date.getTime() / 86400000 + 2440587.5;
}

/** Subsolar point: where the sun is directly overhead right now. */
export function subsolarPoint(date: Date): LatLon {
  const d = julian(date) - 2451545.0;
  const g = (357.529 + 0.98560028 * d) * DEG; // mean anomaly
  const q = 280.459 + 0.98564736 * d; // mean longitude
  const L = (q + 1.915 * Math.sin(g) + 0.02 * Math.sin(2 * g)) * DEG; // ecliptic lon
  const e = (23.439 - 0.00000036 * d) * DEG; // obliquity
  const decl = Math.asin(Math.sin(e) * Math.sin(L));
  // Equation of time (minutes), then subsolar longitude from UTC time of day.
  const ra = Math.atan2(Math.cos(e) * Math.sin(L), Math.cos(L));
  let eqt = (q * DEG - ra) / DEG;
  eqt = ((eqt + 180) % 360) - 180;
  const utcHours =
    date.getUTCHours() + date.getUTCMinutes() / 60 + date.getUTCSeconds() / 3600;
  let lon = -15 * (utcHours - 12 + (eqt * 4) / 60);
  lon = ((lon + 540) % 360) - 180;
  return { lat: decl / DEG, lon };
}

/**
 * Day/night terminator as a polygon covering the night side, suitable for a
 * translucent Leaflet overlay. The grayline is its edge.
 */
export function nightPolygon(date: Date, samples = 180): LatLon[] {
  const sun = subsolarPoint(date);
  const φs = sun.lat * DEG;
  const points: LatLon[] = [];
  for (let i = 0; i <= samples; i++) {
    const lon = -180 + (360 * i) / samples;
    const dλ = (lon - sun.lon) * DEG;
    // Latitude where solar elevation = 0 for this longitude
    const lat = Math.atan(-Math.cos(dλ) / Math.tan(φs)) / DEG;
    points.push({ lat, lon });
  }
  // Close the polygon over the pole that is in darkness
  const poleLat = sun.lat > 0 ? -90 : 90;
  points.push({ lat: poleLat, lon: 180 });
  points.push({ lat: poleLat, lon: -180 });
  return points;
}

export interface SunTimes {
  sunrise: Date | null; // null = sun never rises/sets today (polar day/night)
  sunset: Date | null;
  polar: 'day' | 'night' | null;
}

/** Sunrise/sunset (UTC Dates) for a location on the given UTC day. */
export function sunTimes(p: LatLon, date: Date): SunTimes {
  const dayStart = new Date(
    Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate()),
  );
  const noon = new Date(dayStart.getTime() + 12 * 3600000);
  const sun = subsolarPoint(noon);
  const φ = p.lat * DEG;
  const δ = sun.lat * DEG;
  // Hour angle at sunrise/sunset with standard -0.833° refraction altitude
  const cosH =
    (Math.sin(-0.833 * DEG) - Math.sin(φ) * Math.sin(δ)) /
    (Math.cos(φ) * Math.cos(δ));
  if (cosH < -1) return { sunrise: null, sunset: null, polar: 'day' };
  if (cosH > 1) return { sunrise: null, sunset: null, polar: 'night' };
  const H = Math.acos(cosH) / DEG; // degrees
  // Solar noon at this longitude (sun.lon is where noon is happening now)
  const solarNoonUTCh = 12 - (p.lon - 0) / 15 - eqtHours(noon);
  const rise = solarNoonUTCh - H / 15;
  const set = solarNoonUTCh + H / 15;
  return {
    sunrise: new Date(dayStart.getTime() + rise * 3600000),
    sunset: new Date(dayStart.getTime() + set * 3600000),
    polar: null,
  };
}

function eqtHours(date: Date): number {
  const d = julian(date) - 2451545.0;
  const g = (357.529 + 0.98560028 * d) * DEG;
  const q = 280.459 + 0.98564736 * d;
  const L = (q + 1.915 * Math.sin(g) + 0.02 * Math.sin(2 * g)) * DEG;
  const e = (23.439 - 0.00000036 * d) * DEG;
  const ra = Math.atan2(Math.cos(e) * Math.sin(L), Math.cos(L));
  let eqtDeg = ((q * DEG - ra) / DEG + 180) % 360 - 180;
  return (eqtDeg * 4) / 60;
}

/** Solar elevation in degrees at a point — used for day/night band logic. */
export function solarElevation(p: LatLon, date: Date): number {
  const sun = subsolarPoint(date);
  const φ = p.lat * DEG;
  const δ = sun.lat * DEG;
  const H = (p.lon - sun.lon) * DEG;
  const sinAlt =
    Math.sin(φ) * Math.sin(δ) + Math.cos(φ) * Math.cos(δ) * Math.cos(H);
  return Math.asin(sinAlt) / DEG;
}
