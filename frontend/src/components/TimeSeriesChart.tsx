// Shared time-series chart (TABS-REDESIGN-PLAN.md Phase A). Hand-rolled SVG —
// lines, areas, threshold bands and gridlines are all Skywave's charts need,
// so no chart library. The SVG is rendered at the container's measured pixel
// width (ResizeObserver) instead of stretching a small fixed viewBox — the
// failure mode that made the original full-width XrayChart blurry.

import {
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type PointerEvent,
} from 'react';

export interface TsPoint {
  t: number; // ms epoch
  v: number;
}

export interface TsSeries {
  points: TsPoint[];
  /** Stroke color via CSS class — tsc-accent / tsc-fair / tsc-good / tsc-poor / tsc-dim. */
  className: string;
  /** Fill down to the bottom of the plot (needs a matching tsc-area-* class). */
  area?: boolean;
  /** Name shown in the hover readout. */
  label?: string;
}

/** Horizontal gridline with an in-plot label (the C/M/X decade pattern). */
export interface TsTick {
  v: number;
  label: string;
}

/** Shaded horizontal danger zone, e.g. Bz ≤ −5 nT. */
export interface TsBand {
  from: number;
  to: number;
  className: string; // tsc-band-warn / tsc-band-bad
}

/** Labeled point annotation, e.g. a flare peak with its class. */
export interface TsMarker {
  t: number;
  v: number;
  label: string;
}

const PAD_TOP = 6;
const PAD_BOTTOM = 16;

/** UTC tick positions/labels for the x axis, ~1 per 110px. */
function timeTicks(
  t0: number,
  t1: number,
  width: number,
): { t: number; label: string }[] {
  const span = t1 - t0;
  if (span <= 0) return [];
  const target = Math.max(2, Math.floor(width / 110));
  const H = 3600_000;
  const D = 24 * H;
  const steps = [
    15 * 60_000, 30 * 60_000, H, 2 * H, 3 * H, 6 * H, 12 * H,
    D, 2 * D, 7 * D, 30.44 * D, 91.3 * D, 365.25 * D,
  ];
  const step = steps.find((s) => span / s <= target) ?? steps[steps.length - 1];
  const out: { t: number; label: string }[] = [];
  for (let t = Math.ceil(t0 / step) * step; t <= t1; t += step) {
    const iso = new Date(t).toISOString();
    const label =
      step >= 28 * D
        ? iso.slice(0, 7) // YYYY-MM
        : step >= D
          ? iso.slice(5, 10) // MM-DD
          : iso.slice(11, 16); // HH:MM
    out.push({ t, label });
  }
  return out;
}

export function TimeSeriesChart(props: {
  series: TsSeries[];
  ariaLabel: string;
  height?: number; // plot px height incl. padding, default 140
  yScale?: 'linear' | 'log';
  /** Defaults to the data extent (log scale requires positive values). */
  yDomain?: [number, number];
  yTicks?: TsTick[];
  bands?: TsBand[];
  markers?: TsMarker[];
  /** Draw a dashed vertical cursor at this time (ms epoch). */
  now?: number;
  /** Hover readout value formatting; default 2 significant digits. */
  format?: (v: number) => string;
  /** Break lines across sample gaps larger than this (ms). */
  gapMs?: number;
}) {
  const {
    series,
    height = 140,
    yScale = 'linear',
    format = (v) => v.toPrecision(3),
  } = props;
  const wrapRef = useRef<HTMLDivElement>(null);
  const [width, setWidth] = useState(600);
  const [hoverT, setHoverT] = useState<number | null>(null);

  useLayoutEffect(() => {
    const el = wrapRef.current;
    if (!el) return;
    const ro = new ResizeObserver((entries) => {
      const w = entries[0]?.contentRect.width;
      if (w) setWidth(Math.round(w));
    });
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  const { t0, t1, y0, y1 } = useMemo(() => {
    let tMin = Infinity;
    let tMax = -Infinity;
    let vMin = Infinity;
    let vMax = -Infinity;
    for (const s of series) {
      for (const p of s.points) {
        if (p.t < tMin) tMin = p.t;
        if (p.t > tMax) tMax = p.t;
        if (p.v < vMin) vMin = p.v;
        if (p.v > vMax) vMax = p.v;
      }
    }
    let [d0, d1] = props.yDomain ?? [vMin, vMax];
    if (d0 === d1) [d0, d1] = [d0 - 1, d1 + 1]; // flat series
    return { t0: tMin, t1: tMax, y0: d0, y1: d1 };
  }, [series, props.yDomain]);

  const plotH = height - PAD_TOP - PAD_BOTTOM;
  const hasData = isFinite(t0) && t1 > t0;

  const x = (t: number) => ((t - t0) / (t1 - t0)) * width;
  const y = (v: number) => {
    let f: number;
    if (yScale === 'log') {
      const lv = Math.log10(Math.max(v, 1e-12));
      f = (lv - Math.log10(y0)) / (Math.log10(y1) - Math.log10(y0));
    } else {
      f = (v - y0) / (y1 - y0);
    }
    return PAD_TOP + plotH - Math.min(Math.max(f, 0), 1) * plotH;
  };

  /** Split a series into gap-free segments, each rendered as one polyline. */
  const segments = (s: TsSeries): TsPoint[][] => {
    if (!props.gapMs) return [s.points];
    const segs: TsPoint[][] = [];
    let cur: TsPoint[] = [];
    for (const p of s.points) {
      if (cur.length && p.t - cur[cur.length - 1].t > props.gapMs) {
        if (cur.length > 1) segs.push(cur);
        cur = [];
      }
      cur.push(p);
    }
    if (cur.length > 1) segs.push(cur);
    return segs;
  };

  const onMove = (e: PointerEvent<SVGSVGElement>) => {
    const rect = e.currentTarget.getBoundingClientRect();
    const frac = (e.clientX - rect.left) / rect.width;
    setHoverT(t0 + Math.min(Math.max(frac, 0), 1) * (t1 - t0));
  };

  // Nearest sample per labeled series at the hovered time.
  const readout = useMemo(() => {
    if (hoverT == null || !hasData) return null;
    const parts: string[] = [];
    let shownT: number | null = null;
    for (const s of series) {
      if (!s.points.length) continue;
      let best = s.points[0];
      for (const p of s.points) {
        if (Math.abs(p.t - hoverT) < Math.abs(best.t - hoverT)) best = p;
      }
      shownT ??= best.t;
      parts.push(`${s.label ? `${s.label} ` : ''}${format(best.v)}`);
    }
    if (shownT == null) return null;
    return {
      x: x(shownT),
      text: `${new Date(shownT).toISOString().slice(11, 16)}Z · ${parts.join(' · ')}`,
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [hoverT, series, hasData, t0, t1, width, format]);

  if (!hasData) return null;

  return (
    <div className="tsc" ref={wrapRef}>
      <svg
        width={width}
        height={height}
        role="img"
        aria-label={props.ariaLabel}
        onPointerMove={onMove}
        onPointerLeave={() => setHoverT(null)}
      >
        {props.bands?.map((b, i) => {
          const top = y(Math.max(b.from, b.to));
          return (
            <rect
              key={i}
              x={0}
              width={width}
              y={top}
              height={Math.max(0, y(Math.min(b.from, b.to)) - top)}
              className={b.className}
            />
          );
        })}
        {props.yTicks?.map((tk) => (
          <g key={tk.label}>
            <line x1={0} x2={width} y1={y(tk.v)} y2={y(tk.v)} className="tsc-grid" />
            <text x={3} y={Math.max(9, y(tk.v) - 2)} className="tsc-grid-label">
              {tk.label}
            </text>
          </g>
        ))}
        {timeTicks(t0, t1, width).map((tk) => (
          <g key={tk.t}>
            <line
              x1={x(tk.t)}
              x2={x(tk.t)}
              y1={PAD_TOP}
              y2={PAD_TOP + plotH}
              className="tsc-grid tsc-grid-x"
            />
            <text
              x={Math.min(Math.max(x(tk.t), 18), width - 18)}
              y={height - 4}
              className="tsc-xlabel"
            >
              {tk.label}
            </text>
          </g>
        ))}
        {series.map((s, si) =>
          segments(s).map((seg, gi) => {
            const pts = seg
              .map((p) => `${x(p.t).toFixed(1)},${y(p.v).toFixed(1)}`)
              .join(' ');
            return s.area ? (
              <polygon
                key={`${si}-${gi}`}
                points={`${x(seg[0].t).toFixed(1)},${PAD_TOP + plotH} ${pts} ${x(
                  seg[seg.length - 1].t,
                ).toFixed(1)},${PAD_TOP + plotH}`}
                className={`tsc-area ${s.className}`}
              />
            ) : (
              <polyline
                key={`${si}-${gi}`}
                points={pts}
                fill="none"
                strokeWidth="1.5"
                className={s.className}
              />
            );
          }),
        )}
        {props.markers?.map((m, i) => (
          <g key={i}>
            <circle cx={x(m.t)} cy={y(m.v)} r={2.5} className="tsc-marker-dot" />
            <text
              x={x(m.t)}
              y={Math.max(10, y(m.v) - 6)}
              className="tsc-marker"
            >
              {m.label}
            </text>
          </g>
        ))}
        {props.now != null && props.now >= t0 && props.now <= t1 && (
          <line
            x1={x(props.now)}
            x2={x(props.now)}
            y1={PAD_TOP}
            y2={PAD_TOP + plotH}
            className="tsc-now"
          />
        )}
        {readout && (
          <line
            x1={readout.x}
            x2={readout.x}
            y1={PAD_TOP}
            y2={PAD_TOP + plotH}
            className="tsc-cursor"
          />
        )}
      </svg>
      {readout && <span className="tsc-readout mono">{readout.text}</span>}
    </div>
  );
}
