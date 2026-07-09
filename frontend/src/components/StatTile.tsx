// Compact stat tile (TABS-REDESIGN-PLAN.md Phase A): label, big value,
// optional trend sparkline and delta. Tiles are deliberately lighter than
// Panel — a row of them lives *inside* one Panel, which owns the
// fetched-at/stale chrome for the whole row (DESIGN.md §9).

export type Tone = 'ok' | 'warn' | 'bad';

const TONE_CLASS: Record<Tone, string> = {
  ok: 'tone-ok',
  warn: 'stat-warn',
  bad: 'stat-bad',
};

function toneClass(tone?: Tone | null): string {
  return tone ? TONE_CLASS[tone] : '';
}

/** Sparkline stretched to the tile width; non-scaling stroke keeps the line
 * crisp under the non-uniform scale. */
function Spark(props: { values: number[] }) {
  const { values } = props;
  if (values.length < 2) return null;
  const w = 120;
  const h = 26;
  let min = Math.min(...values);
  let max = Math.max(...values);
  if (min === max) {
    min -= 1;
    max += 1;
  }
  const pts = values
    .map(
      (v, i) =>
        `${((i / (values.length - 1)) * w).toFixed(1)},${(
          h - 2 - ((v - min) / (max - min)) * (h - 4)
        ).toFixed(1)}`,
    )
    .join(' ');
  return (
    <svg
      viewBox={`0 0 ${w} ${h}`}
      preserveAspectRatio="none"
      className="tile-spark"
      aria-hidden="true"
    >
      <polyline
        points={pts}
        fill="none"
        stroke="currentColor"
        strokeWidth="1.5"
        vectorEffect="non-scaling-stroke"
      />
    </svg>
  );
}

export function StatTile(props: {
  label: string;
  value: string;
  unit?: string;
  tone?: Tone | null;
  /** Recent values → sparkline under the number. */
  spark?: number[];
  /** Trend annotation, e.g. "▲ 0.7 / 6h". */
  delta?: { text: string; tone?: Tone } | null;
  /** Small caption line, e.g. "smoothed · model input". */
  sub?: string;
  title?: string;
}) {
  return (
    <div className="tile" title={props.title}>
      <span className="stat-label">{props.label}</span>
      <span className={`tile-value mono ${toneClass(props.tone)}`}>
        {props.value}
        {props.unit && <span className="tile-unit">{props.unit}</span>}
      </span>
      {props.delta && (
        <span className={`tile-delta mono ${toneClass(props.delta.tone) || 'dim'}`}>
          {props.delta.text}
        </span>
      )}
      {props.spark && <Spark values={props.spark} />}
      {props.sub && <span className="tile-sub">{props.sub}</span>}
    </div>
  );
}
