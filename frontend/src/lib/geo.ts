// Geodesy helpers: Maidenhead grid conversion, great-circle math, and the
// geomagnetic-latitude approximation used to flag polar paths (DESIGN.md §9).

export interface LatLon {
  lat: number;
  lon: number;
}

const DEG = Math.PI / 180;
export const EARTH_RADIUS_KM = 6371;

/** Maidenhead grid (4 or 6 char) → center lat/lon. */
export function gridToLatLon(grid: string): LatLon | null {
  const g = grid.trim().toUpperCase();
  if (!/^[A-R]{2}[0-9]{2}([A-X]{2})?$/.test(g)) return null;
  let lon = (g.charCodeAt(0) - 65) * 20 - 180;
  let lat = (g.charCodeAt(1) - 65) * 10 - 90;
  lon += parseInt(g[2]) * 2;
  lat += parseInt(g[3]) * 1;
  if (g.length === 6) {
    lon += (g.charCodeAt(4) - 65) * (2 / 24) + 1 / 24;
    lat += (g.charCodeAt(5) - 65) * (1 / 24) + 1 / 48;
  } else {
    lon += 1;
    lat += 0.5;
  }
  return { lat, lon };
}

export function latLonToGrid(p: LatLon, precision: 4 | 6 = 6): string {
  const lon = p.lon + 180;
  const lat = p.lat + 90;
  let g =
    String.fromCharCode(65 + Math.floor(lon / 20)) +
    String.fromCharCode(65 + Math.floor(lat / 10)) +
    Math.floor((lon % 20) / 2).toString() +
    Math.floor(lat % 10).toString();
  if (precision === 6) {
    g +=
      String.fromCharCode(97 + Math.floor(((lon % 2) * 60) / 5)) +
      String.fromCharCode(97 + Math.floor(((lat % 1) * 60) / 2.5));
  }
  return g;
}

/** Great-circle distance in km. */
export function distanceKm(a: LatLon, b: LatLon): number {
  const φ1 = a.lat * DEG;
  const φ2 = b.lat * DEG;
  const dφ = (b.lat - a.lat) * DEG;
  const dλ = (b.lon - a.lon) * DEG;
  const h =
    Math.sin(dφ / 2) ** 2 +
    Math.cos(φ1) * Math.cos(φ2) * Math.sin(dλ / 2) ** 2;
  return 2 * EARTH_RADIUS_KM * Math.asin(Math.sqrt(h));
}

/** Initial great-circle bearing in degrees true. */
export function bearingDeg(a: LatLon, b: LatLon): number {
  const φ1 = a.lat * DEG;
  const φ2 = b.lat * DEG;
  const dλ = (b.lon - a.lon) * DEG;
  const y = Math.sin(dλ) * Math.cos(φ2);
  const x =
    Math.cos(φ1) * Math.sin(φ2) - Math.sin(φ1) * Math.cos(φ2) * Math.cos(dλ);
  return ((Math.atan2(y, x) / DEG) + 360) % 360;
}

/** Intermediate point at fraction f along the great circle a→b. */
function intermediate(a: LatLon, b: LatLon, f: number): LatLon {
  const φ1 = a.lat * DEG, λ1 = a.lon * DEG;
  const φ2 = b.lat * DEG, λ2 = b.lon * DEG;
  const δ = distanceKm(a, b) / EARTH_RADIUS_KM;
  if (δ === 0) return a;
  const A = Math.sin((1 - f) * δ) / Math.sin(δ);
  const B = Math.sin(f * δ) / Math.sin(δ);
  const x = A * Math.cos(φ1) * Math.cos(λ1) + B * Math.cos(φ2) * Math.cos(λ2);
  const y = A * Math.cos(φ1) * Math.sin(λ1) + B * Math.cos(φ2) * Math.sin(λ2);
  const z = A * Math.sin(φ1) + B * Math.sin(φ2);
  return {
    lat: Math.atan2(z, Math.sqrt(x * x + y * y)) / DEG,
    lon: Math.atan2(y, x) / DEG,
  };
}

/**
 * Sample the short-path great circle a→b. Longitudes are unwrapped into a
 * continuous sequence so Leaflet draws one line instead of jumping at ±180°.
 */
export function greatCirclePoints(a: LatLon, b: LatLon, n = 64): LatLon[] {
  const pts: LatLon[] = [];
  let prevLon: number | null = null;
  let offset = 0;
  for (let i = 0; i <= n; i++) {
    const p = intermediate(a, b, i / n);
    if (prevLon !== null) {
      if (p.lon - prevLon > 180) offset -= 360;
      else if (p.lon - prevLon < -180) offset += 360;
    }
    prevLon = p.lon;
    pts.push({ lat: p.lat, lon: p.lon + offset });
  }
  return pts;
}

/**
 * Long-path route: through the antipode of the midpoint. Both short and long
 * path are physically valid HF routes — always compute both (§9).
 */
export function longPathPoints(a: LatLon, b: LatLon, n = 64): LatLon[] {
  const mid = intermediate(a, b, 0.5);
  const anti: LatLon = {
    lat: -mid.lat,
    lon: mid.lon > 0 ? mid.lon - 180 : mid.lon + 180,
  };
  const first = greatCirclePoints(a, anti, n / 2);
  // Continue the unwrapped longitude sequence across the join.
  const second = greatCirclePoints(anti, b, n / 2);
  const shift = first[first.length - 1].lon - second[0].lon;
  const rewrapped = second.map((p) => ({
    lat: p.lat,
    lon: p.lon + Math.round(shift / 360) * 360,
  }));
  return [...first, ...rewrapped.slice(1)];
}

/**
 * Approximate geomagnetic latitude using the dipole model (2020-era IGRF
 * pole at 80.7°N, 72.7°W). Adequate for "is this path auroral?" flagging —
 * not for science.
 */
export function geomagneticLat(p: LatLon): number {
  const poleLat = 80.7 * DEG;
  const poleLon = -72.7 * DEG;
  const φ = p.lat * DEG;
  const λ = p.lon * DEG;
  const sinMag =
    Math.sin(φ) * Math.sin(poleLat) +
    Math.cos(φ) * Math.cos(poleLat) * Math.cos(λ - poleLon);
  return Math.asin(sinMag) / DEG;
}

/** True if any sampled point of the path exceeds |latThreshold|° geomagnetic. */
export function crossesAuroralZone(
  path: LatLon[],
  latThreshold = 62,
): boolean {
  return path.some((p) => Math.abs(geomagneticLat(p)) >= latThreshold);
}
