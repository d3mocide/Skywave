// Amateur satellite pass prediction — SGP4 via satellite.js, entirely
// client-side so it keeps working offline once TLEs are cached (§3, §7).

import * as satellite from 'satellite.js';
import type { Tle } from './api';
import type { LatLon } from './geo';

export interface Pass {
  name: string;
  aos: Date; // acquisition of signal
  los: Date; // loss of signal
  maxElevation: number; // degrees
}

function elevationAt(
  satrec: satellite.SatRec,
  observer: satellite.GeodeticLocation,
  date: Date,
): number | null {
  const pv = satellite.propagate(satrec, date);
  if (!pv || typeof pv.position === 'boolean') return null;
  const gmst = satellite.gstime(date);
  const ecf = satellite.eciToEcf(pv.position, gmst);
  const look = satellite.ecfToLookAngles(observer, ecf);
  return (look.elevation * 180) / Math.PI;
}

/**
 * Scan the next `hours` for passes over the observer. 30 s steps are enough
 * for LEO amateur sats; AOS/LOS land within half a step of truth.
 */
export function predictPasses(
  tles: Tle[],
  obs: LatLon,
  hours = 12,
  minElevation = 5,
): Pass[] {
  const observer: satellite.GeodeticLocation = {
    latitude: (obs.lat * Math.PI) / 180,
    longitude: (obs.lon * Math.PI) / 180,
    height: 0,
  };
  const passes: Pass[] = [];
  const now = new Date();
  const stepMs = 30_000;
  const endMs = now.getTime() + hours * 3600_000;

  for (const tle of tles) {
    let satrec: satellite.SatRec;
    try {
      satrec = satellite.twoline2satrec(tle.line1, tle.line2);
    } catch {
      continue;
    }
    let inPass = false;
    let aos = now;
    let maxEl = -90;
    for (let t = now.getTime(); t <= endMs; t += stepMs) {
      const el = elevationAt(satrec, observer, new Date(t));
      if (el === null) break; // decayed / bad TLE
      if (el > 0) {
        if (!inPass) {
          inPass = true;
          aos = new Date(t);
          maxEl = el;
        } else {
          maxEl = Math.max(maxEl, el);
        }
      } else if (inPass) {
        inPass = false;
        if (maxEl >= minElevation) {
          passes.push({ name: tle.name, aos, los: new Date(t), maxElevation: maxEl });
        }
        maxEl = -90;
      }
    }
  }
  return passes.sort((a, b) => a.aos.getTime() - b.aos.getTime());
}
