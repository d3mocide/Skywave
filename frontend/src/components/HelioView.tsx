// Top-down heliocentric CME projection — the "where is it now" map.
// View from solar north: Sun at center, Earth fixed on the right, each
// in-flight CME drawn as a wedge at its DONKI longitude spanning its
// half-angle, with the leading edge at the distance the same drag-based
// integration behind the arrival estimates says it has reached. A CME
// pointed at the Earth line visibly closes the gap hour by hour.

import type { CmeAnalysis } from '../lib/api';
import { sunEarthFraction, type ArrivalEstimate } from '../lib/cme';

const SIZE = 260;
const R_EARTH = 108; // px for 1 AU
const R_SUN = 7;

export interface HelioCme {
  cme: CmeAnalysis;
  est: ArrivalEstimate | null;
}

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

export function HelioView(props: {
  rows: HelioCme[];
  now: Date;
  selected: string | null;
  onSelect: (id: string | null) => void;
}) {
  const { rows, now, selected, onSelect } = props;

  const inFlight = rows
    .map((r) => ({ ...r, frac: sunEarthFraction(r.cme, now) }))
    .filter(
      (r): r is HelioCme & { frac: number } =>
        r.frac != null && r.frac > 0.01 && r.frac < 1 && r.cme.longitude != null,
    );

  if (!inFlight.length) return null;

  const half = SIZE / 2;
  return (
    <div className="helio-wrap">
      <svg
        viewBox={`${-half} ${-half} ${SIZE} ${SIZE}`}
        className="helio-view"
        role="img"
        aria-label="heliocentric CME positions, viewed from solar north"
      >
        {/* Earth orbit */}
        <circle
          r={R_EARTH}
          fill="none"
          stroke="var(--panel-border)"
          strokeDasharray="3 5"
        />
        {/* Sun→Earth line */}
        <line
          x1={R_SUN + 2}
          y1={0}
          x2={R_EARTH}
          y2={0}
          stroke="var(--panel-border)"
          strokeWidth={1}
        />
        {inFlight.map(({ cme, est, frac }) => {
          const id = cme.associatedCMEID + cme.time21_5;
          const isSel = selected === id;
          const directed = est?.earthDirected ?? false;
          const color = directed ? 'var(--poor)' : 'var(--dim)';
          return (
            <path
              key={id}
              d={wedgePath(
                cme.longitude as number,
                Math.min(cme.halfAngle ?? 30, 120),
                R_SUN + 2 + frac * (R_EARTH - R_SUN - 2),
              )}
              fill={color}
              fillOpacity={isSel ? 0.5 : directed ? 0.3 : 0.16}
              stroke={color}
              strokeOpacity={isSel ? 1 : 0.55}
              strokeWidth={isSel ? 1.5 : 1}
              className="helio-cme"
              onClick={() => onSelect(isSel ? null : id)}
            >
              <title>
                {`${cme.speed ?? '?'} km/s · lon ${cme.longitude}° · ±${cme.halfAngle ?? '?'}° · ~${Math.round(frac * 100)}% of 1 AU${directed ? ' · Earth-directed' : ''}`}
              </title>
            </path>
          );
        })}
        {/* Sun */}
        <circle r={R_SUN} fill="#e8b23d" />
        {/* Earth */}
        <circle cx={R_EARTH} cy={0} r={4} fill="var(--accent)">
          <title>Earth</title>
        </circle>
        <text
          x={R_EARTH}
          y={14}
          textAnchor="middle"
          className="helio-label"
        >
          ⊕
        </text>
      </svg>
      <p className="footnote">
        view from solar north · Earth right · wedge = CME span at its
        drag-model distance · click to match the list
      </p>
    </div>
  );
}
