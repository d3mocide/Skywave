// Top-down heliocentric CME projection — the "where is it now" map, and
// the hero of the Sun & CME view. View from solar north: Sun at center,
// Earth fixed on the right, each in-flight CME drawn as a wedge at its
// DONKI longitude spanning its half-angle, with the leading edge at the
// distance the same drag-based integration behind the arrival estimates
// says it has reached *at the caller's view time* — so scrubbing or
// playing the clock sweeps CMEs across the frame. Recently-arrived
// wedges linger at 1 AU and fade so playback shows impacts, not pops.

import type { CmeAnalysis } from '../lib/api';
import {
  cmeKey,
  cmeTier,
  sunEarthFraction,
  type ArrivalEstimate,
  type CmeTier,
} from '../lib/cme';

const W = 640;
const H = 420;
const R_EARTH = 182; // px for 1 AU
const R_SUN = 10;
const GHOST_HOURS = 10; // fade-out window after a wedge reaches 1 AU

export interface HelioCme {
  cme: CmeAnalysis;
  est: ArrivalEstimate | null;
}

const TIER_COLOR: Record<CmeTier, string> = {
  severe: 'var(--poor)',
  elevated: 'var(--fair)',
  directed: 'var(--accent)',
  offaxis: 'var(--dim)',
};

// Deterministic starfield — same sky every render, no deps.
const STARS = (() => {
  let s = 42;
  const rand = () => {
    s = (s * 1664525 + 1013904223) % 4294967296;
    return s / 4294967296;
  };
  return Array.from({ length: 90 }, () => ({
    x: (rand() - 0.5) * W,
    y: (rand() - 0.5) * H,
    r: 0.4 + rand() * 0.9,
    o: 0.1 + rand() * 0.4,
  }));
})();

/** Mean-longitude ephemeris (J2000 elements, circular orbits) — plenty for
 * a display where the planet dot is bigger than the error. Returns degrees. */
function meanLongitude(epochDeg: number, ratePerDay: number, t: Date): number {
  const days = (t.getTime() - Date.UTC(2000, 0, 1, 12)) / 86_400_000;
  return epochDeg + ratePerDay * days;
}

const PLANETS = [
  { name: 'Mercury', au: 0.387, epoch: 252.25, rate: 4.09233445 },
  { name: 'Venus', au: 0.723, epoch: 181.98, rate: 1.60213034 },
];
const EARTH_EPOCH = 100.46;
const EARTH_RATE = 0.98560912;

function wedgePath(lonDeg: number, halfDeg: number, rOut: number): string {
  // SVG frame: +x right (toward Earth), +y down. DONKI longitude is HEE,
  // west positive; drawn clockwise-positive, which puts west CMEs on the
  // lower half — orientation is conventional for these plots and labeled.
  const a0 = ((lonDeg - halfDeg) * Math.PI) / 180;
  const a1 = ((lonDeg + halfDeg) * Math.PI) / 180;
  const r0 = R_SUN + 2;
  const large = halfDeg > 90 ? 1 : 0;
  const x0i = r0 * Math.cos(a0), y0i = r0 * Math.sin(a0);
  const x1i = r0 * Math.cos(a1), y1i = r0 * Math.sin(a1);
  const x0o = rOut * Math.cos(a0), y0o = rOut * Math.sin(a0);
  const x1o = rOut * Math.cos(a1), y1o = rOut * Math.sin(a1);
  return [
    `M ${x0i.toFixed(1)} ${y0i.toFixed(1)}`,
    `L ${x0o.toFixed(1)} ${y0o.toFixed(1)}`,
    `A ${rOut.toFixed(1)} ${rOut.toFixed(1)} 0 ${large} 1 ${x1o.toFixed(1)} ${y1o.toFixed(1)}`,
    `L ${x1i.toFixed(1)} ${y1i.toFixed(1)}`,
    `A ${r0} ${r0} 0 ${large} 0 ${x0i.toFixed(1)} ${y0i.toFixed(1)}`,
    'Z',
  ].join(' ');
}

/** Just the leading-edge arc of the same wedge — stroked brighter as the
 * shock front. */
function frontPath(lonDeg: number, halfDeg: number, rOut: number): string {
  const a0 = ((lonDeg - halfDeg) * Math.PI) / 180;
  const a1 = ((lonDeg + halfDeg) * Math.PI) / 180;
  const large = halfDeg > 90 ? 1 : 0;
  return [
    `M ${(rOut * Math.cos(a0)).toFixed(1)} ${(rOut * Math.sin(a0)).toFixed(1)}`,
    `A ${rOut.toFixed(1)} ${rOut.toFixed(1)} 0 ${large} 1 ${(rOut * Math.cos(a1)).toFixed(1)} ${(rOut * Math.sin(a1)).toFixed(1)}`,
  ].join(' ');
}

export function HelioView(props: {
  rows: HelioCme[];
  viewTime: Date;
  selected: string | null;
  onSelect: (id: string | null) => void;
}) {
  const { rows, viewTime, selected, onSelect } = props;

  // Everything currently between the Sun and 1 AU at viewTime, plus a
  // short fading "ghost" once the front passes 1 AU.
  const drawn = rows.flatMap((r) => {
    if (r.cme.longitude == null) return [];
    const frac = sunEarthFraction(r.cme, viewTime);
    if (frac == null || frac <= 0.01) return [];
    if (frac < 1) return [{ ...r, frac, ghost: 0 }];
    if (!r.est) return [];
    const hoursPast = (viewTime.getTime() - r.est.arrival.getTime()) / 3600_000;
    if (hoursPast < 0 || hoursPast > GHOST_HOURS) return [];
    return [{ ...r, frac: 1, ghost: hoursPast / GHOST_HOURS }];
  });

  const earthLon = meanLongitude(EARTH_EPOCH, EARTH_RATE, viewTime);

  return (
    <div className="helio-wrap">
      <svg
        viewBox={`${-W / 2} ${-H / 2} ${W} ${H}`}
        className="helio-view helio-hero"
        role="img"
        aria-label="heliocentric CME positions, viewed from solar north"
      >
        <defs>
          <radialGradient id="helio-sun-glow">
            <stop offset="0%" stopColor="#e8b23d" stopOpacity="0.55" />
            <stop offset="45%" stopColor="#e8b23d" stopOpacity="0.12" />
            <stop offset="100%" stopColor="#e8b23d" stopOpacity="0" />
          </radialGradient>
          {drawn.map((d, i) => {
            const rOut = R_SUN + 2 + d.frac * (R_EARTH - R_SUN - 2);
            const color = TIER_COLOR[cmeTier(d.est)];
            return (
              <radialGradient
                key={i}
                id={`helio-wedge-${i}`}
                gradientUnits="userSpaceOnUse"
                cx="0"
                cy="0"
                r={rOut}
              >
                <stop offset="0%" stopColor={color} stopOpacity="0.02" />
                <stop offset="55%" stopColor={color} stopOpacity="0.12" />
                <stop offset="100%" stopColor={color} stopOpacity="0.5" />
              </radialGradient>
            );
          })}
        </defs>

        {/* click-away target */}
        <rect
          x={-W / 2}
          y={-H / 2}
          width={W}
          height={H}
          fill="transparent"
          onClick={() => onSelect(null)}
        />
        {STARS.map((s, i) => (
          <circle key={i} cx={s.x} cy={s.y} r={s.r} fill="#d7e1f2" opacity={s.o} />
        ))}

        {/* orbits + distance scale */}
        {PLANETS.map((p) => (
          <circle
            key={p.name}
            r={p.au * R_EARTH}
            fill="none"
            stroke="var(--panel-border)"
            strokeOpacity={0.7}
            strokeDasharray="2 6"
          />
        ))}
        <circle
          r={R_EARTH}
          fill="none"
          stroke="var(--panel-border)"
          strokeDasharray="3 5"
        />
        <line
          x1={R_SUN + 2}
          y1={0}
          x2={R_EARTH}
          y2={0}
          stroke="var(--panel-border)"
          strokeWidth={1}
        />
        <text x={0.5 * R_EARTH} y={-4} className="helio-scale" textAnchor="middle">
          0.5 AU
        </text>
        <text
          x={R_EARTH * Math.cos(Math.PI / 4) + 4}
          y={-R_EARTH * Math.sin(Math.PI / 4) - 4}
          className="helio-scale"
        >
          1 AU
        </text>

        {/* planets — mean-longitude positions, drawn in the same mirrored
            HEE-style frame as the CME wedges (Earth fixed at 0°/right) */}
        {PLANETS.map((p) => {
          const th = (-(meanLongitude(p.epoch, p.rate, viewTime) - earthLon) * Math.PI) / 180;
          const r = p.au * R_EARTH;
          return (
            <circle
              key={p.name}
              cx={r * Math.cos(th)}
              cy={r * Math.sin(th)}
              r={3}
              className="helio-planet"
            >
              <title>{p.name} (approximate position)</title>
            </circle>
          );
        })}

        {drawn.map((d, i) => {
          const { cme, est, frac, ghost } = d;
          const id = cmeKey(cme);
          const isSel = selected === id;
          const tier = cmeTier(est);
          const color = TIER_COLOR[tier];
          const lon = cme.longitude as number;
          const half = Math.min(cme.halfAngle ?? 30, 120);
          const rOut = R_SUN + 2 + frac * (R_EARTH - R_SUN - 2);
          const fade = 1 - ghost;
          const lx = (rOut + 14) * Math.cos((lon * Math.PI) / 180);
          const ly = (rOut + 14) * Math.sin((lon * Math.PI) / 180);
          return (
            <g
              key={id}
              className="helio-cme"
              opacity={fade}
              onClick={() => onSelect(isSel ? null : id)}
            >
              <path
                d={wedgePath(lon, half, rOut)}
                fill={`url(#helio-wedge-${i})`}
                fillOpacity={isSel ? 1.4 : tier === 'offaxis' ? 0.55 : 1}
                stroke={color}
                strokeOpacity={isSel ? 0.9 : 0.35}
                strokeWidth={isSel ? 1.5 : 1}
              />
              <path
                d={frontPath(lon, half, rOut)}
                fill="none"
                stroke={color}
                strokeOpacity={isSel ? 1 : 0.8}
                strokeWidth={isSel ? 2.5 : 1.75}
                strokeLinecap="round"
              />
              <text
                x={lx}
                y={ly}
                textAnchor={Math.abs(lon) > 90 ? 'end' : 'start'}
                className={`helio-speed mono ${isSel ? 'helio-speed-sel' : ''}`}
              >
                {cme.speed != null ? `${Math.round(cme.speed)} km/s` : '?'}
              </text>
              <title>
                {`${cme.speed ?? '?'} km/s · lon ${lon}° · ±${cme.halfAngle ?? '?'}° · ~${Math.round(frac * 100)}% of 1 AU${est?.earthDirected ? ' · Earth-directed' : ''}`}
              </title>
            </g>
          );
        })}

        {/* Sun */}
        <circle r={R_SUN * 4} fill="url(#helio-sun-glow)" />
        <circle r={R_SUN} fill="#e8b23d" />
        {/* Earth */}
        <circle cx={R_EARTH} cy={0} r={8} fill="var(--accent)" fillOpacity={0.18} />
        <circle cx={R_EARTH} cy={0} r={4} fill="var(--accent)">
          <title>Earth</title>
        </circle>
        <text x={R_EARTH} y={18} textAnchor="middle" className="helio-label">
          ⊕
        </text>
      </svg>
    </div>
  );
}
