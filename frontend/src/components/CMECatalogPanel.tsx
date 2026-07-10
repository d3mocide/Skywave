// CME catalog rail: the DONKI analysis list, with a detail card for the
// selected event (selection is shared with the tracker's wedges and
// timeline via SunCMEView). The card carries everything the wedge can't —
// direction, arrival window ± model uncertainty, catalog speed percentile,
// the DONKI note — and a replay button that rewinds the tracker's clock
// to the launch.

import { useMemo, useState } from 'react';
import { Panel } from './Panel';
import type { HelioCme } from './HelioView';
import type { SolarRegion } from '../lib/api';
import {
  cmeKey,
  noaaRegion,
  stormPotential,
  sunEarthFraction,
  TRANSIT_UNCERTAINTY_FRAC,
} from '../lib/cme';

const TYPE_LABEL: Record<string, string> = {
  S: 'slow',
  C: 'common',
  O: 'occasional',
  R: 'rare',
  ER: 'extremely rare',
};

function DetailCard(props: {
  row: HelioCme;
  rows: HelioCme[];
  now: Date;
  regions: SolarRegion[];
  onSelectRegion: (region: number) => void;
  onReplay: (t: Date) => void;
  onClose: () => void;
}) {
  const { row, rows, now, regions, onSelectRegion, onReplay, onClose } = props;
  const { cme, est } = row;
  const [showNote, setShowNote] = useState(false);

  const launch = new Date(cme.time21_5);
  const arrived = est && est.arrival.getTime() < now.getTime();
  const potential = est ? stormPotential(est.speedAtEarthKms) : null;
  const uncH = est ? Math.round(est.transitHours * TRANSIT_UNCERTAINTY_FRAC) : null;

  // Source region cross-link: DONKI's full AR number → NOAA's 4-digit one;
  // clickable when that region is on today's disk.
  const arNoaa = noaaRegion(cme.activeRegionNum);
  const arOnDisk = arNoaa != null && regions.some((r) => r.region === arNoaa);

  // Speed percentile across the loaded 30-day catalog.
  const pct = useMemo(() => {
    if (cme.speed == null) return null;
    const speeds = rows
      .map((r) => r.cme.speed)
      .filter((s): s is number => s != null);
    if (speeds.length < 5) return null;
    const slower = speeds.filter((s) => s < (cme.speed as number)).length;
    return Math.round((slower / speeds.length) * 100);
  }, [rows, cme.speed]);

  return (
    <div className="cme-detail">
      <div className="cme-detail-head">
        <span className={`badge ${est?.earthDirected ? 'badge-alert' : 'badge-dim'}`}>
          {est?.earthDirected ? 'Earth-directed' : 'off-axis'}
        </span>
        {cme.type && (
          <span
            className="badge badge-dim"
            title={`DONKI speed class${TYPE_LABEL[cme.type] ? ` — ${TYPE_LABEL[cme.type]}` : ''}`}
          >
            {cme.type}
          </span>
        )}
        <span className="cme-speed">{cme.speed ?? '?'} km/s</span>
        <button className="chip cme-detail-close" onClick={onClose} title="close">
          ✕
        </button>
      </div>
      <dl className="cme-detail-grid">
        <dt>first seen</dt>
        <dd className="mono">{cme.time21_5?.slice(0, 16)}Z</dd>
        <dt>direction</dt>
        <dd className="mono">
          {cme.latitude != null && cme.longitude != null
            ? `${cme.latitude >= 0 ? 'N' : 'S'}${Math.abs(cme.latitude)} ${cme.longitude >= 0 ? 'W' : 'E'}${Math.abs(cme.longitude)}`
            : '—'}
          {cme.halfAngle != null && ` · ±${cme.halfAngle}°`}
        </dd>
        {(cme.sourceLocation || arNoaa != null) && (
          <>
            <dt>source</dt>
            <dd className="mono">
              {cme.sourceLocation ?? ''}
              {cme.sourceLocation && arNoaa != null ? ' · ' : ''}
              {arNoaa != null &&
                (arOnDisk ? (
                  <button
                    className="cme-ar-link"
                    onClick={() => onSelectRegion(arNoaa)}
                    title="highlight this region on the solar disk"
                  >
                    AR {arNoaa}
                  </button>
                ) : (
                  `AR ${arNoaa}`
                ))}
            </dd>
          </>
        )}
        {cme.flare?.classType && (
          <>
            <dt>source flare</dt>
            <dd className="mono">
              {cme.flare.classType}
              {cme.flare.peakTime && ` · peak ${cme.flare.peakTime.slice(0, 16)}Z`}
            </dd>
          </>
        )}
        {est && (
          <>
            <dt>{arrived ? 'est. arrived' : 'est. arrival'}</dt>
            <dd className="mono">
              {est.arrival.toISOString().slice(0, 16)}Z
              {uncH != null && ` ± ${uncH}h`}
            </dd>
            <dt>transit</dt>
            <dd className="mono">
              {(est.transitHours / 24).toFixed(1)}d · {Math.round(est.speedAtEarthKms)}{' '}
              km/s at 1 AU
            </dd>
            {est.earthDirected && potential && (
              <>
                <dt>potential</dt>
                <dd className={potential.severe ? 'cme-potential-severe' : ''}>
                  Kp ~{potential.kpEst.toFixed(1)} · {potential.label}
                </dd>
              </>
            )}
          </>
        )}
        {!est && (
          <>
            <dt>arrival</dt>
            <dd>too slow to reach 1 AU inside the model window</dd>
          </>
        )}
        {pct != null && (
          <>
            <dt>speed rank</dt>
            <dd>faster than {pct}% of the 30-day catalog</dd>
          </>
        )}
      </dl>
      {cme.note && (
        <p
          className={`cme-detail-note ${showNote ? '' : 'clamped'}`}
          onClick={() => setShowNote((v) => !v)}
          title={showNote ? 'collapse' : 'expand'}
        >
          {cme.note}
        </p>
      )}
      <div className="cme-detail-actions">
        {!isNaN(launch.getTime()) && (
          <button
            className="chip"
            onClick={() => onReplay(new Date(launch.getTime() + 6 * 3600_000))}
            title="rewind the tracker clock to just after launch — press play to watch it fly"
          >
            ⏮ replay flight
          </button>
        )}
        {cme.link && (
          <a
            className="chip"
            href={cme.link}
            target="_blank"
            rel="noopener noreferrer"
          >
            DONKI ↗
          </a>
        )}
      </div>
    </div>
  );
}

export function CMECatalogPanel(props: {
  rows: HelioCme[];
  fetchedAt: number | null | undefined;
  stale: boolean | undefined;
  now: Date;
  selected: string | null;
  onSelect: (id: string | null) => void;
  regions: SolarRegion[];
  onSelectRegion: (region: number) => void;
  onReplay: (t: Date) => void;
}) {
  const {
    rows, fetchedAt, stale, now,
    selected, onSelect, regions, onSelectRegion, onReplay,
  } = props;
  const [earthOnly, setEarthOnly] = useState(false);

  const shown = useMemo(
    () => rows.filter((r) => !earthOnly || r.est?.earthDirected),
    [rows, earthOnly],
  );
  const selectedRow = rows.find((r) => cmeKey(r.cme) === selected) ?? null;

  return (
    <Panel
      title="CME Catalog"
      fetchedAt={fetchedAt}
      stale={stale}
      badge={
        <button
          className={`chip ${earthOnly ? 'chip-on' : ''}`}
          onClick={() => setEarthOnly((v) => !v)}
          title="show only earth-directed analyses"
        >
          earth-directed
        </button>
      }
    >
      {selectedRow && (
        <DetailCard
          row={selectedRow}
          rows={rows}
          now={now}
          regions={regions}
          onSelectRegion={onSelectRegion}
          onReplay={onReplay}
          onClose={() => onSelect(null)}
        />
      )}
      {shown.length === 0 ? (
        <p className="empty">no CME analyses in the last 30 days</p>
      ) : (
        <div className="cme-scroll">
          <ul className="cme-list">
            {shown.map(({ cme, est }) => {
              const arrived = est && est.arrival.getTime() < now.getTime();
              const inFlight = est?.earthDirected && !arrived;
              const frac = inFlight ? sunEarthFraction(cme, now) : null;
              const id = cmeKey(cme);
              return (
                <li
                  key={id}
                  className={`cme-row cme-selectable ${selected === id ? 'row-selected' : ''} ${arrived ? 'cme-arrived' : ''}`}
                  onClick={() => onSelect(selected === id ? null : id)}
                >
                  <div className="cme-head">
                    <span
                      className={`badge ${est?.earthDirected ? 'badge-alert' : 'badge-dim'}`}
                    >
                      {est?.earthDirected ? 'Earth-directed' : 'off-axis'}
                    </span>
                    <span className="cme-speed">{cme.speed ?? '?'} km/s</span>
                    {cme.halfAngle != null && (
                      <span className="dim" title="angular width (2 × half-angle)">
                        {Math.round(cme.halfAngle * 2)}° wide
                      </span>
                    )}
                    <span className="cme-time">{cme.time21_5?.slice(0, 16)}Z</span>
                  </div>
                  {est && (
                    <div className="cme-arrival">
                      {arrived ? 'est. arrived ' : 'est. arrival '}
                      {est.arrival.toISOString().slice(0, 16)}Z (
                      {est.transitHours.toFixed(0)} h transit,{' '}
                      {Math.round(est.speedAtEarthKms)} km/s at 1 AU)
                    </div>
                  )}
                  {frac != null && frac > 0 && frac < 1 && (
                    <div
                      className="cme-track"
                      title={`~${Math.round(frac * 100)}% of Sun→Earth distance`}
                    >
                      <span className="cme-track-sun">☉</span>
                      <span className="cme-track-bar">
                        <span
                          className="cme-track-fill"
                          style={{ width: `${Math.round(frac * 100)}%` }}
                        />
                      </span>
                      <span className="cme-track-earth">⊕</span>
                    </div>
                  )}
                </li>
              );
            })}
          </ul>
        </div>
      )}
    </Panel>
  );
}
