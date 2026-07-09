// Satellites pass planner (TABS-REDESIGN-PLAN.md Phase D). The question is
// "when is the next pass and where do I point?" — so the hero card pairs a
// live countdown with a polar sky-track (AOS→LOS path, compass azimuths),
// an up-now panel lists birds currently above the horizon, and a 24 h
// timeline shows the pass schedule at a glance. All computed client-side
// from cached TLEs (offline-capable, §3).

import { useMemo, useState } from 'react';
import { useLiveQuery } from 'dexie-react-hooks';
import { Panel } from './Panel';
import { useNow, type ApiState } from '../hooks/useApi';
import type { Tle } from '../lib/api';
import type { LatLon } from '../lib/geo';
import { db, DEFAULT_SAT_PREFS } from '../lib/db';
import {
  compassPoint,
  currentLookAngles,
  predictPasses,
  type Pass,
} from '../lib/satellites';
import { transponderFor } from '../lib/transponders';

// A few high-interest birds shown by default; "all" is one click away.
// Word-boundary match, not substring — 'ISS' as a substring also catches
// SWISSCUBE.
const FEATURED = ['ISS', 'SO-50', 'AO-91', 'RS-44', 'GREENCUBE', 'IO-117'].map(
  (n) => new RegExp(`\\b${n}\\b`, 'i'),
);
const WINDOW_H = 24;
const MIN_EL_CHOICES = [0, 5, 10, 20];

const passId = (p: Pass) => p.name + p.aos.toISOString();

const hhmm = (d: Date) => d.toISOString().slice(11, 16) + 'Z';

function durationText(p: Pass): string {
  const min = Math.round((p.los.getTime() - p.aos.getTime()) / 60_000);
  return `${min} min`;
}

function countdownText(p: Pass, now: Date): { text: string; live: boolean } {
  const n = now.getTime();
  if (n >= p.aos.getTime() && n <= p.los.getTime()) {
    const left = Math.max(0, Math.round((p.los.getTime() - n) / 60_000));
    return { text: `IN PASS · LOS in ${left}m`, live: true };
  }
  const ms = p.aos.getTime() - n;
  const h = Math.floor(ms / 3600_000);
  const m = Math.max(0, Math.floor((ms % 3600_000) / 60_000));
  return { text: `T−${h > 0 ? `${h}h ` : ''}${m}m to AOS`, live: false };
}

/** Polar sky chart: N up, elevation rings at 0/30/60°, pass path AOS→LOS. */
function SkyTrack(props: { pass: Pass; now: Date }) {
  const { pass, now } = props;
  const C = 100;
  const R = 86;
  const pt = (az: number, el: number): [number, number] => {
    const r = ((90 - Math.max(el, 0)) / 90) * R;
    const a = (az * Math.PI) / 180;
    return [C + r * Math.sin(a), C - r * Math.cos(a)];
  };
  const path = pass.samples
    .map((s) => pt(s.az, s.el).map((v) => v.toFixed(1)).join(','))
    .join(' ');
  const [ax, ay] = pt(pass.aosAz, 0);
  const [lx, ly] = pt(pass.losAz, 0);
  const [mx, my] = pt(pass.maxElAz, pass.maxElevation);
  const nMs = now.getTime();
  const live =
    nMs >= pass.aos.getTime() && nMs <= pass.los.getTime()
      ? pass.samples.reduce((best, s) =>
          Math.abs(s.t - nMs) < Math.abs(best.t - nMs) ? s : best,
        )
      : null;
  return (
    <svg
      viewBox="0 0 200 200"
      className="skytrack"
      role="img"
      aria-label={`sky track for ${pass.name}: AOS ${Math.round(pass.aosAz)}°, max elevation ${Math.round(pass.maxElevation)}°, LOS ${Math.round(pass.losAz)}°`}
    >
      {[0, 30, 60].map((el) => (
        <circle key={el} cx={C} cy={C} r={((90 - el) / 90) * R} className="skytrack-ring" />
      ))}
      <line x1={C} y1={C - R} x2={C} y2={C + R} className="skytrack-ring" />
      <line x1={C - R} y1={C} x2={C + R} y2={C} className="skytrack-ring" />
      <text x={C} y={C - R - 4} className="skytrack-dir">N</text>
      <text x={C + R + 7} y={C + 3} className="skytrack-dir">E</text>
      <text x={C} y={C + R + 11} className="skytrack-dir">S</text>
      <text x={C - R - 7} y={C + 3} className="skytrack-dir">W</text>
      <polyline points={path} fill="none" className="skytrack-path" strokeWidth="2" />
      <circle cx={ax} cy={ay} r={3} className="skytrack-aos" />
      <text x={ax} y={ay - 5} className="skytrack-label">AOS</text>
      <circle cx={lx} cy={ly} r={3} className="skytrack-los" />
      <text x={lx} y={ly - 5} className="skytrack-label">LOS</text>
      <circle cx={mx} cy={my} r={2.5} className="skytrack-max" />
      {live && (
        <circle
          cx={pt(live.az, live.el)[0]}
          cy={pt(live.az, live.el)[1]}
          r={4}
          className="skytrack-live"
        />
      )}
    </svg>
  );
}

/** 24 h Gantt: one row per satellite with a pass; bar brightness = max el. */
function PassTimeline(props: {
  passes: Pass[];
  now: Date;
  selected: string | null;
  onSelect: (id: string) => void;
}) {
  const t0 = props.now.getTime();
  const span = WINDOW_H * 3600_000;
  const bySat = useMemo(() => {
    const m = new Map<string, Pass[]>();
    for (const p of props.passes) {
      m.set(p.name, [...(m.get(p.name) ?? []), p]);
    }
    return [...m.entries()];
  }, [props.passes]);
  if (!bySat.length) return null;
  return (
    <div className="sat-tl">
      <div className="sat-tl-header">
        <span className="sat-tl-name" />
        <div className="sat-tl-hours mono">
          {[0, 6, 12, 18, 24].map((h) => (
            <span key={h}>
              {h === 0 ? 'now' : hhmm(new Date(t0 + h * 3600_000))}
            </span>
          ))}
        </div>
      </div>
      {bySat.map(([name, passes]) => (
        <div key={name} className="sat-tl-row">
          <span className="sat-tl-name" title={name}>
            {name.replace(/ \(.*\)$/, '')}
          </span>
          <div className="sat-tl-track">
            {passes.map((p) => {
              const left = ((p.aos.getTime() - t0) / span) * 100;
              const width = Math.max(
                0.6,
                ((p.los.getTime() - p.aos.getTime()) / span) * 100,
              );
              const id = passId(p);
              return (
                <button
                  key={id}
                  className={`sat-tl-bar ${props.selected === id ? 'sat-tl-bar-sel' : ''}`}
                  style={{
                    left: `${Math.max(0, left)}%`,
                    width: `${width}%`,
                    opacity: 0.45 + (Math.min(p.maxElevation, 90) / 90) * 0.55,
                  }}
                  title={`${name} · ${hhmm(p.aos)} → ${hhmm(p.los)} · max el ${Math.round(p.maxElevation)}°`}
                  onClick={() => props.onSelect(id)}
                />
              );
            })}
          </div>
        </div>
      ))}
    </div>
  );
}

export function SatellitesView(props: { tles: ApiState<Tle[]>; de: LatLon | null }) {
  const { data, fetchedAt, stale } = props.tles;
  const now = useNow(15_000);
  const prefs = useLiveQuery(() => db.satPrefs.get('satPrefs')) ?? DEFAULT_SAT_PREFS;
  const [selectedId, setSelectedId] = useState<string | null>(null);

  const subset = useMemo(() => {
    if (!data) return [];
    if (prefs.showAll) return data;
    return data.filter(
      (t) =>
        FEATURED.some((re) => re.test(t.name)) ||
        prefs.favorites.includes(t.name),
    );
  }, [data, prefs.showAll, prefs.favorites]);

  // Recompute the schedule every 5 min so the window rolls forward without
  // rebuilding on every clock tick (predictPasses scans 24 h at 30 s steps).
  const scheduleKey = Math.floor(now.getTime() / (5 * 60_000));
  const passes = useMemo(() => {
    if (!subset.length || !props.de) return [];
    return predictPasses(subset, props.de, WINDOW_H, prefs.minElevation);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [subset, props.de, prefs.minElevation, scheduleKey]);

  // Drop passes that have fully ended; keep one in progress.
  const upcoming = useMemo(
    () => passes.filter((p) => p.los.getTime() > now.getTime()),
    [passes, now],
  );

  const selected =
    upcoming.find((p) => passId(p) === selectedId) ?? upcoming[0] ?? null;

  const upNow = useMemo(() => {
    if (!subset.length || !props.de) return [];
    return currentLookAngles(subset, props.de, now);
  }, [subset, props.de, now]);

  const savePrefs = (patch: Partial<typeof prefs>) =>
    db.satPrefs.put({ ...DEFAULT_SAT_PREFS, ...prefs, ...patch, id: 'satPrefs' });

  const toggleFavorite = (name: string) =>
    savePrefs({
      favorites: prefs.favorites.includes(name)
        ? prefs.favorites.filter((f) => f !== name)
        : [...prefs.favorites, name],
    });

  if (!props.de) {
    return (
      <div className="view-dash">
        <section className="span-12">
          <Panel title="Satellites" fetchedAt={fetchedAt} stale={stale}>
            <p className="empty">set your DE grid on Overview to predict passes</p>
          </Panel>
        </section>
      </div>
    );
  }

  const xpond = selected ? transponderFor(selected.name) : null;
  const cd = selected ? countdownText(selected, now) : null;

  return (
    <div className="view-dash">
      <section className="span-8">
        <Panel
          title="Next Pass"
          fetchedAt={fetchedAt}
          stale={stale}
          badge={
            cd?.live ? <span className="badge badge-ok">in pass</span> : null
          }
        >
          {!selected ? (
            <p className="empty">
              {data
                ? `no passes ≥${prefs.minElevation}° in the next ${WINDOW_H} h`
                : 'waiting for TLEs…'}
            </p>
          ) : (
            <div className="sat-hero">
              <div className="sat-hero-info">
                <div className="sat-hero-name strong">{selected.name}</div>
                <div className={`sat-hero-count mono ${cd?.live ? 'tone-ok' : ''}`}>
                  {cd?.text}
                </div>
                <table className="spot-table sat-hero-table">
                  <tbody>
                    <tr>
                      <td className="dim">AOS</td>
                      <td className="mono">{hhmm(selected.aos)}</td>
                      <td className="mono">
                        {Math.round(selected.aosAz)}° {compassPoint(selected.aosAz)}
                      </td>
                    </tr>
                    <tr>
                      <td className="dim">max el</td>
                      <td className="mono">{hhmm(selected.maxElTime)}</td>
                      <td className="mono">
                        {Math.round(selected.maxElevation)}° el ·{' '}
                        {Math.round(selected.maxElAz)}° {compassPoint(selected.maxElAz)}
                      </td>
                    </tr>
                    <tr>
                      <td className="dim">LOS</td>
                      <td className="mono">{hhmm(selected.los)}</td>
                      <td className="mono">
                        {Math.round(selected.losAz)}° {compassPoint(selected.losAz)}
                      </td>
                    </tr>
                    <tr>
                      <td className="dim">duration</td>
                      <td className="mono" colSpan={2}>
                        {durationText(selected)}
                      </td>
                    </tr>
                    {xpond && (
                      <>
                        <tr>
                          <td className="dim">uplink</td>
                          <td className="mono" colSpan={2}>{xpond.uplink}</td>
                        </tr>
                        <tr>
                          <td className="dim">downlink</td>
                          <td className="mono" colSpan={2}>{xpond.downlink}</td>
                        </tr>
                        <tr>
                          <td className="dim">mode</td>
                          <td colSpan={2}>{xpond.mode}</td>
                        </tr>
                      </>
                    )}
                  </tbody>
                </table>
              </div>
              <SkyTrack pass={selected} now={now} />
            </div>
          )}
        </Panel>
      </section>

      <section className="span-4">
        <Panel title="Up Now" fetchedAt={fetchedAt} stale={stale}>
          {upNow.length === 0 ? (
            <p className="empty">
              none above horizon
              {upcoming[0] &&
                ` — next AOS ${hhmm(upcoming[0].aos)} (${upcoming[0].name.replace(/ \(.*\)$/, '')})`}
            </p>
          ) : (
            <table className="spot-table">
              <thead>
                <tr>
                  <th>satellite</th>
                  <th>az</th>
                  <th>el</th>
                </tr>
              </thead>
              <tbody>
                {upNow.map((s) => (
                  <tr key={s.name}>
                    <td className="strong">{s.name}</td>
                    <td className="mono">
                      {Math.round(s.az)}° {compassPoint(s.az)}
                    </td>
                    <td className="mono">{Math.round(s.el)}°</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
          <p className="footnote">live pointing — refreshes every 15 s</p>
        </Panel>

        <Panel title="Filters" fetchedAt={fetchedAt} stale={stale}>
          <div className="filter-row">
            <button
              className={`chip ${!prefs.showAll ? 'chip-on' : ''}`}
              onClick={() => savePrefs({ showAll: false })}
              title="featured birds + your ★ favorites"
            >
              featured
            </button>
            <button
              className={`chip ${prefs.showAll ? 'chip-on' : ''}`}
              onClick={() => savePrefs({ showAll: true })}
              title="every satellite in the CelesTrak amateur set — slower to compute"
            >
              all
            </button>
          </div>
          <div className="filter-row">
            <span className="dim sat-filter-label">min el</span>
            {MIN_EL_CHOICES.map((el) => (
              <button
                key={el}
                className={`chip ${prefs.minElevation === el ? 'chip-on' : ''}`}
                onClick={() => savePrefs({ minElevation: el })}
              >
                {el}°
              </button>
            ))}
          </div>
          <p className="footnote">
            ★ in the pass table pins a bird into the featured set
          </p>
        </Panel>
      </section>

      <section className="span-12">
        <Panel title="Pass Timeline — 24 h" fetchedAt={fetchedAt} stale={stale}>
          {upcoming.length ? (
            <PassTimeline
              passes={upcoming}
              now={now}
              selected={selected ? passId(selected) : null}
              onSelect={setSelectedId}
            />
          ) : (
            <p className="empty">no passes to plot</p>
          )}
        </Panel>
      </section>

      <section className="span-12">
        <Panel title="Passes" fetchedAt={fetchedAt} stale={stale}>
          {upcoming.length === 0 ? (
            <p className="empty">
              {data ? `no passes in the next ${WINDOW_H} h` : 'waiting for TLEs…'}
            </p>
          ) : (
            <div className="hscroll">
            <table className="spot-table">
              <thead>
                <tr>
                  <th />
                  <th>satellite</th>
                  <th>AOS</th>
                  <th>az</th>
                  <th>max el</th>
                  <th>LOS</th>
                  <th>az</th>
                  <th>dur</th>
                </tr>
              </thead>
              <tbody>
                {upcoming.map((p) => {
                  const id = passId(p);
                  const fav = prefs.favorites.includes(p.name);
                  const live =
                    now.getTime() >= p.aos.getTime() &&
                    now.getTime() <= p.los.getTime();
                  return (
                    <tr
                      key={id}
                      className={`spot-clickable ${selected && passId(selected) === id ? 'row-selected' : ''}`}
                      onClick={() => setSelectedId(id)}
                      title="show sky track"
                    >
                      <td>
                        <button
                          className={`sat-fav ${fav ? 'sat-fav-on' : ''}`}
                          title={fav ? 'remove from favorites' : 'add to favorites'}
                          onClick={(e) => {
                            e.stopPropagation();
                            toggleFavorite(p.name);
                          }}
                        >
                          ★
                        </button>
                      </td>
                      <td className="strong">
                        {p.name}
                        {live && <span className="badge badge-ok sat-live-badge">live</span>}
                      </td>
                      <td className="mono">{hhmm(p.aos)}</td>
                      <td className="mono dim">
                        {Math.round(p.aosAz)}° {compassPoint(p.aosAz)}
                      </td>
                      <td className="mono">{Math.round(p.maxElevation)}°</td>
                      <td className="mono">{hhmm(p.los)}</td>
                      <td className="mono dim">
                        {Math.round(p.losAz)}° {compassPoint(p.losAz)}
                      </td>
                      <td className="mono dim">{durationText(p)}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
            </div>
          )}
        </Panel>
      </section>
    </div>
  );
}
