// Amateur satellite pass prediction — SGP4 via satellite.js, entirely
// client-side so it keeps working offline once TLEs are cached (§3, §7).
// The scan records full pass geometry (azimuths + a coarse sky track) for
// the pass-planner view (TABS-REDESIGN-PLAN.md Phase D) — AOS/LOS times
// alone don't answer "where do I point".

import * as satellite from 'satellite.js';
import type { Tle } from './api';
import type { LatLon } from './geo';

export interface PassSample {
  t: number; // ms epoch
  az: number; // degrees true
  el: number; // degrees above horizon
}

export interface Pass {
  name: string;
  aos: Date; // acquisition of signal
  los: Date; // loss of signal
  maxElevation: number; // degrees
  aosAz: number;
  losAz: number;
  maxElAz: number;
  maxElTime: Date;
  /** 30 s-cadence sky track, AOS → LOS — feeds the polar plot. */
  samples: PassSample[];
}

/** Satellite currently above the horizon, with live pointing. */
export interface LiveLook {
  name: string;
  az: number;
  el: number;
}

function toObserver(obs: LatLon): satellite.GeodeticLocation {
  return {
    latitude: (obs.lat * Math.PI) / 180,
    longitude: (obs.lon * Math.PI) / 180,
    height: 0,
  };
}

function lookAt(
  satrec: satellite.SatRec,
  observer: satellite.GeodeticLocation,
  date: Date,
): { az: number; el: number } | null {
  const pv = satellite.propagate(satrec, date);
  if (!pv || typeof pv.position === 'boolean') return null;
  const gmst = satellite.gstime(date);
  const ecf = satellite.eciToEcf(pv.position, gmst);
  const look = satellite.ecfToLookAngles(observer, ecf);
  return {
    az: ((look.azimuth * 180) / Math.PI + 360) % 360,
    el: (look.elevation * 180) / Math.PI,
  };
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
  const observer = toObserver(obs);
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
    let aosAz = 0;
    let maxEl = -90;
    let maxElAz = 0;
    let maxElT = now.getTime();
    let samples: PassSample[] = [];
    for (let t = now.getTime(); t <= endMs; t += stepMs) {
      const look = lookAt(satrec, observer, new Date(t));
      if (look === null) break; // decayed / bad TLE
      if (look.el > 0) {
        if (!inPass) {
          inPass = true;
          aos = new Date(t);
          aosAz = look.az;
          maxEl = look.el;
          maxElAz = look.az;
          maxElT = t;
          samples = [];
        } else if (look.el > maxEl) {
          maxEl = look.el;
          maxElAz = look.az;
          maxElT = t;
        }
        samples.push({ t, az: look.az, el: look.el });
      } else if (inPass) {
        inPass = false;
        if (maxEl >= minElevation) {
          passes.push({
            name: tle.name,
            aos,
            los: new Date(t),
            maxElevation: maxEl,
            aosAz,
            losAz: samples.length ? samples[samples.length - 1].az : maxElAz,
            maxElAz,
            maxElTime: new Date(maxElT),
            samples,
          });
        }
        maxEl = -90;
        samples = [];
      }
    }
  }
  return passes.sort((a, b) => a.aos.getTime() - b.aos.getTime());
}

/** Live look angles for every satellite above the horizon right now. */
export function currentLookAngles(
  tles: Tle[],
  obs: LatLon,
  date: Date,
): LiveLook[] {
  const observer = toObserver(obs);
  const out: LiveLook[] = [];
  for (const tle of tles) {
    try {
      const satrec = satellite.twoline2satrec(tle.line1, tle.line2);
      const look = lookAt(satrec, observer, date);
      if (look && look.el > 0) out.push({ name: tle.name, az: look.az, el: look.el });
    } catch {
      continue;
    }
  }
  return out.sort((a, b) => b.el - a.el);
}

const WINDS = [
  'N', 'NNE', 'NE', 'ENE', 'E', 'ESE', 'SE', 'SSE',
  'S', 'SSW', 'SW', 'WSW', 'W', 'WNW', 'NW', 'NNW',
];

/** 16-wind compass point for an azimuth, e.g. 337° → NNW. */
export function compassPoint(az: number): string {
  return WINDS[Math.round(((az % 360) + 360) % 360 / 22.5) % 16];
}
