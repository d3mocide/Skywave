// CME tracker hero (§8): the heliocentric projection as the main stage,
// with a time-machine underneath — play/scrub the clock from 30 days back
// to 3 days ahead and watch every DONKI analysis launch, decelerate, and
// sweep past Earth on the same DBM integration that produces the arrival
// estimates. The inbound alert bar always tracks the *real* clock; only
// the visualization follows the scrubbed time.

import { useEffect, useMemo, useRef, type PointerEvent } from 'react';
import { Panel } from './Panel';
import { HelioView, type HelioCme } from './HelioView';
import { cmeKey, cmeTier, stormPotential, type CmeTier } from '../lib/cme';

const PAST_DAYS = 30;
const FUTURE_DAYS = 3;
const TICK_MS = 100;
export const PLAY_RATES = [1, 6, 24] as const; // sim-hours per wall-second

function countdown(ms: number): string {
  const h = Math.floor(ms / 3600_000);
  const m = Math.floor((ms % 3600_000) / 60_000);
  return `T−${h}h ${m.toString().padStart(2, '0')}m`;
}

function offsetLabel(ms: number): string {
  const sign = ms < 0 ? '−' : '+';
  const h = Math.abs(ms) / 3600_000;
  return h >= 48 ? `${sign}${(h / 24).toFixed(1)}d` : `${sign}${Math.round(h)}h`;
}

const TIER_CLASS: Record<CmeTier, string> = {
  severe: 'tl-severe',
  elevated: 'tl-elevated',
  directed: 'tl-directed',
  offaxis: 'tl-offaxis',
};

/** Launch-event strip doubling as the scrubber: markers at each analysis'
 * 21.5 R☉ time, drag anywhere to move the view clock. */
function Timeline(props: {
  rows: HelioCme[];
  now: Date;
  viewTime: Date;
  live: boolean;
  selected: string | null;
  onScrub: (t: Date | null) => void;
  onSelect: (id: string) => void;
}) {
  const { rows, now, viewTime, live, selected, onScrub, onSelect } = props;
  const ref = useRef<HTMLDivElement>(null);
  const dragging = useRef(false);

  const t0 = now.getTime() - PAST_DAYS * 86_400_000;
  const t1 = now.getTime() + FUTURE_DAYS * 86_400_000;
  const toPct = (t: number) => ((t - t0) / (t1 - t0)) * 100;

  const timeAt = (clientX: number): Date => {
    const el = ref.current!;
    const { left, width } = el.getBoundingClientRect();
    const f = Math.min(1, Math.max(0, (clientX - left) / width));
    return new Date(t0 + f * (t1 - t0));
  };

  const onPointerDown = (e: PointerEvent<HTMLDivElement>) => {
    dragging.current = true;
    e.currentTarget.setPointerCapture(e.pointerId);
    onScrub(timeAt(e.clientX));
  };
  const onPointerMove = (e: PointerEvent<HTMLDivElement>) => {
    if (dragging.current) onScrub(timeAt(e.clientX));
  };
  const onPointerUp = () => {
    dragging.current = false;
  };

  // Weekly date ticks, aligned to UTC midnights.
  const ticks = useMemo(() => {
    const out: { pct: number; label: string }[] = [];
    const day = new Date(t0);
    day.setUTCHours(0, 0, 0, 0);
    for (let t = day.getTime(); t < t1; t += 7 * 86_400_000) {
      if (t < t0) continue;
      const d = new Date(t);
      out.push({
        pct: toPct(t),
        label: `${d.getUTCMonth() + 1}/${d.getUTCDate()}`,
      });
    }
    return out;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [t0, t1]);

  return (
    <div
      ref={ref}
      className="cme-timeline"
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={onPointerUp}
      title="drag to move the view clock"
    >
      {ticks.map((t) => (
        <span key={t.label} className="cme-tl-tick" style={{ left: `${t.pct}%` }}>
          <span className="cme-tl-tick-label mono">{t.label}</span>
        </span>
      ))}
      {rows.map((r) => {
        const t = new Date(r.cme.time21_5).getTime();
        if (isNaN(t) || t < t0 || t > t1) return null;
        const id = cmeKey(r.cme);
        return (
          <button
            key={id}
            className={`cme-tl-marker ${TIER_CLASS[cmeTier(r.est)]} ${selected === id ? 'cme-tl-marker-sel' : ''}`}
            style={{ left: `${toPct(t)}%` }}
            title={`${r.cme.speed ?? '?'} km/s · ${r.cme.time21_5?.slice(0, 16)}Z${r.est?.earthDirected ? ' · Earth-directed' : ''}`}
            onClick={(e) => {
              e.stopPropagation();
              onSelect(id);
              // jump the clock a few hours past launch so the wedge is visible
              onScrub(new Date(t + 6 * 3600_000));
            }}
            onPointerDown={(e) => e.stopPropagation()}
          />
        );
      })}
      <span className="cme-tl-now" style={{ left: `${toPct(now.getTime())}%` }}>
        <span className="cme-tl-now-label mono">now</span>
      </span>
      {!live && (
        <span
          className="cme-tl-cursor"
          style={{ left: `${toPct(viewTime.getTime())}%` }}
        />
      )}
    </div>
  );
}

export function CMEPanel(props: {
  rows: HelioCme[];
  fetchedAt: number | null | undefined;
  stale: boolean | undefined;
  now: Date;
  viewTime: Date | null; // null = live
  onViewTime: (t: Date | null) => void;
  playRate: number | null; // sim-hours per second, null = paused
  onPlayRate: (r: number | null) => void;
  selected: string | null;
  onSelect: (id: string | null) => void;
}) {
  const {
    rows, fetchedAt, stale, now,
    viewTime, onViewTime, playRate, onPlayRate, selected, onSelect,
  } = props;

  const displayTime = viewTime ?? now;
  const live = viewTime == null;
  const maxT = now.getTime() + FUTURE_DAYS * 86_400_000;

  // Playback: advance the view clock; stop at the future edge.
  useEffect(() => {
    if (playRate == null) return;
    const id = setInterval(() => {
      const base = viewTime ?? now;
      const next = base.getTime() + playRate * 3600_000 * (TICK_MS / 1000);
      if (next >= maxT) {
        onViewTime(new Date(maxT));
        onPlayRate(null);
      } else {
        onViewTime(new Date(next));
      }
    }, TICK_MS);
    return () => clearInterval(id);
  }, [playRate, viewTime, now, maxT, onViewTime, onPlayRate]);

  // Next impact: the earliest earth-directed arrival still in the future —
  // real clock, not the scrubbed one.
  const next = useMemo(() => {
    const inbound = rows.filter(
      (r) => r.est?.earthDirected && r.est.arrival.getTime() > now.getTime(),
    );
    if (!inbound.length) return null;
    return inbound.reduce((a, b) =>
      a.est!.arrival.getTime() <= b.est!.arrival.getTime() ? a : b,
    );
  }, [rows, now]);

  const nextPotential = next?.est ? stormPotential(next.est.speedAtEarthKms) : null;

  return (
    <Panel title="CME Tracker" fetchedAt={fetchedAt} stale={stale}>
      {next && next.est && nextPotential && (
        <div className={`cme-alert ${nextPotential.severe ? 'cme-alert-severe' : ''}`}>
          <span className="cme-alert-count mono">
            {countdown(next.est.arrival.getTime() - now.getTime())}
          </span>
          <span className="cme-alert-what">
            CME inbound · est. {next.est.arrival.toISOString().slice(0, 16)}Z
          </span>
          <span className="cme-alert-kp">
            {Math.round(next.est.speedAtEarthKms)} km/s at 1 AU ·{' '}
            <span className={nextPotential.severe ? 'cme-potential-severe' : ''}>
              Kp ~{nextPotential.kpEst.toFixed(1)} ({nextPotential.label})
            </span>
          </span>
          <button
            className="chip cme-alert-jump"
            onClick={() => {
              onSelect(cmeKey(next.cme));
              onViewTime(null);
            }}
            title="select this CME on the map"
          >
            view
          </button>
        </div>
      )}

      <HelioView
        rows={rows}
        viewTime={displayTime}
        selected={selected}
        onSelect={onSelect}
      />

      <div className="helio-controls">
        <button
          className="chip"
          onClick={() =>
            playRate == null ? onPlayRate(PLAY_RATES[1]) : onPlayRate(null)
          }
          title={playRate == null ? 'play the clock' : 'pause'}
        >
          {playRate == null ? '▶' : '❚❚'}
        </button>
        {PLAY_RATES.map((r) => (
          <button
            key={r}
            className={`chip ${playRate === r ? 'chip-on' : ''}`}
            onClick={() => onPlayRate(playRate === r ? null : r)}
            title={`play at ${r} simulated hours per second`}
          >
            {r >= 24 ? `${r / 24}d/s` : `${r}h/s`}
          </button>
        ))}
        <button
          className={`chip ${live ? 'chip-on' : ''}`}
          onClick={() => {
            onPlayRate(null);
            onViewTime(null);
          }}
          title="back to the live clock"
        >
          now
        </button>
        <span className={`helio-clock mono ${live ? '' : 'previewing'}`}>
          {displayTime.toISOString().slice(0, 16).replace('T', ' ')}Z
          {live ? ' · live' : ` · ${offsetLabel(displayTime.getTime() - now.getTime())}`}
        </span>
      </div>

      <Timeline
        rows={rows}
        now={now}
        viewTime={displayTime}
        live={live}
        selected={selected}
        onScrub={(t) => {
          onPlayRate(null);
          onViewTime(t);
        }}
        onSelect={(id) => onSelect(id)}
      />

      <p className="footnote">
        view from solar north · Earth right · wedge = CME span at its
        drag-model distance for the shown time · planets approximate ·
        markers on the strip are launches (drag it to time-travel)
      </p>
    </Panel>
  );
}
