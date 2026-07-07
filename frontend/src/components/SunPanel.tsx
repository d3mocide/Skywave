// The Sun itself (§8+): live SDO disk imagery and SOHO coronagraphs with
// NOAA's numbered sunspot regions projected onto the disk, plus whole-disk
// flare probabilities. This is where "why is 10m open?" gets answered —
// the spots, the flare risk, and the CMEs leaving the corona are all here.

import { useEffect, useMemo, useRef, useState } from 'react';
import { Panel } from './Panel';
import type { ApiState } from '../hooks/useApi';
import {
  fetchSunImage,
  SUN_CHANNELS,
  type SolarActivity,
  type SolarRegion,
  type SunChannel,
  type SunImage,
} from '../lib/api';

const REFRESH_MS = 10 * 60_000;

// Fraction of the image half-width covered by the solar radius. SDO
// quicklooks: HMI frames the disk at ~0.94, AIA's wider field at ~0.78.
const DISK_FRACTION: Partial<Record<SunChannel, number>> = {
  hmi: 0.94,
  mag: 0.94,
  aia304: 0.78,
  aia193: 0.78,
  aia171: 0.78,
  aia211: 0.78,
};

/** Mount Wilson class → flare-risk tier. Delta configurations are the
 * X-flare factories; beta-gamma is elevated; the rest is quiet. */
function magRisk(magClass: string | null): 'high' | 'elevated' | 'low' {
  const m = (magClass ?? '').toLowerCase();
  if (m.includes('delta')) return 'high';
  if (m.includes('beta-gamma')) return 'elevated';
  return 'low';
}

/** Stonyhurst heliographic → orthographic disk position (fractions of the
 * solar radius, x west/right, y north/up). B0 and P are ignored — SDO
 * quicklooks are published solar-north-up and B0 stays within ±7°, well
 * inside a marker radius. */
function diskXY(r: SolarRegion): { x: number; y: number } | null {
  if (r.latitude == null || r.longitude == null) return null;
  const lat = (r.latitude * Math.PI) / 180;
  const lon = (r.longitude * Math.PI) / 180;
  return { x: Math.cos(lat) * Math.sin(lon), y: Math.sin(lat) };
}

export function SunPanel(props: { activity: ApiState<SolarActivity> }) {
  const { data, fetchedAt, stale } = props.activity;
  const [channel, setChannel] = useState<SunChannel>('hmi');
  const [image, setImage] = useState<SunImage | null>(null);
  const [imgError, setImgError] = useState(false);
  const [showRegions, setShowRegions] = useState(true);
  const [selected, setSelected] = useState<number | null>(null);
  const urlRef = useRef<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    const load = async () => {
      try {
        const img = await fetchSunImage(channel);
        if (cancelled) {
          URL.revokeObjectURL(img.objectUrl);
          return;
        }
        if (urlRef.current) URL.revokeObjectURL(urlRef.current);
        urlRef.current = img.objectUrl;
        setImage(img);
        setImgError(false);
      } catch {
        if (!cancelled) setImgError(true);
      }
    };
    load();
    const id = setInterval(load, REFRESH_MS);
    return () => {
      cancelled = true;
      clearInterval(id);
    };
  }, [channel]);

  // Revoke the last object URL when the panel unmounts.
  useEffect(
    () => () => {
      if (urlRef.current) URL.revokeObjectURL(urlRef.current);
    },
    [],
  );

  const regions = useMemo(
    () =>
      [...(data?.regions ?? [])].sort((a, b) => (b.area ?? 0) - (a.area ?? 0)),
    [data?.regions],
  );
  const probs = data?.probabilities;
  const diskFrac = DISK_FRACTION[channel];
  const channelMeta = SUN_CHANNELS.find((c) => c.key === channel);

  return (
    <Panel
      title="Sun"
      fetchedAt={image?.fetchedAt ?? fetchedAt}
      stale={stale || image?.stale}
      badge={
        probs?.x_class_1_day != null && probs.x_class_1_day >= 20 ? (
          <span className="badge badge-alert">X-flare {probs.x_class_1_day}%</span>
        ) : probs?.m_class_1_day != null && probs.m_class_1_day >= 40 ? (
          <span className="badge badge-warn">M-flare {probs.m_class_1_day}%</span>
        ) : null
      }
    >
      <div className="filter-row">
        {SUN_CHANNELS.map((c) => (
          <button
            key={c.key}
            className={`chip ${channel === c.key ? 'chip-on' : ''}`}
            title={c.title}
            onClick={() => setChannel(c.key)}
          >
            {c.label}
          </button>
        ))}
      </div>

      <div className="sun-disk">
        {image && !imgError ? (
          <img src={image.objectUrl} alt={channelMeta?.title ?? channel} />
        ) : (
          <p className="empty">
            {imgError ? 'imagery unavailable' : 'loading imagery…'}
          </p>
        )}
        {showRegions &&
          diskFrac != null &&
          !imgError &&
          image &&
          regions.map((r) => {
            const p = diskXY(r);
            if (!p) return null;
            const risk = magRisk(r.mag_class);
            return (
              <button
                key={r.region}
                className={`sun-region sun-region-${risk} ${
                  selected === r.region ? 'sun-region-selected' : ''
                }`}
                style={{
                  left: `${50 + p.x * diskFrac * 50}%`,
                  top: `${50 - p.y * diskFrac * 50}%`,
                }}
                title={`AR${r.region} · ${r.location ?? ''} · ${r.spot_class ?? '?'} / ${r.mag_class ?? '?'}${r.area != null ? ` · ${r.area} μhem` : ''}`}
                onClick={() =>
                  setSelected((s) => (s === r.region ? null : r.region))
                }
              >
                <span className="sun-region-label">{r.region}</span>
              </button>
            );
          })}
      </div>

      <div className="sun-meta">
        {probs && (
          <span className="sun-probs mono" title="1-day flare probabilities (NOAA)">
            flare odds{' '}
            <span>C {probs.c_class_1_day ?? '–'}%</span>
            <span className={probs.m_class_1_day != null && probs.m_class_1_day >= 40 ? 'stat-warn' : ''}>
              M {probs.m_class_1_day ?? '–'}%
            </span>
            <span className={probs.x_class_1_day != null && probs.x_class_1_day >= 10 ? 'stat-bad' : ''}>
              X {probs.x_class_1_day ?? '–'}%
            </span>
          </span>
        )}
        {diskFrac != null && (
          <label className="sun-overlay-toggle">
            <input
              type="checkbox"
              checked={showRegions}
              onChange={() => setShowRegions((v) => !v)}
            />
            regions
          </label>
        )}
      </div>

      {regions.length > 0 ? (
        <table className="spot-table">
          <thead>
            <tr>
              <th>region</th>
              <th>class</th>
              <th>mag</th>
              <th>area</th>
              <th>spots</th>
            </tr>
          </thead>
          <tbody>
            {regions.slice(0, 8).map((r) => {
              const risk = magRisk(r.mag_class);
              return (
                <tr
                  key={r.region}
                  className={`spot-clickable ${selected === r.region ? 'row-selected' : ''}`}
                  onClick={() =>
                    setSelected((s) => (s === r.region ? null : r.region))
                  }
                >
                  <td className="strong">
                    AR{r.region}{' '}
                    <span className="dim">{r.location ?? ''}</span>
                  </td>
                  <td className="mono">{r.spot_class ?? '—'}</td>
                  <td
                    className={
                      risk === 'high'
                        ? 'stat-bad strong'
                        : risk === 'elevated'
                          ? 'stat-warn'
                          : ''
                    }
                    title="Mount Wilson magnetic class — delta = highest flare risk"
                  >
                    {r.mag_class ?? '—'}
                  </td>
                  <td className="mono">{r.area ?? '—'}</td>
                  <td className="mono">{r.number_spots ?? '—'}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      ) : (
        data && <p className="empty">no numbered active regions — blank Sun</p>
      )}
      <p className="footnote">
        region positions approximate (orthographic, B0/P ignored) · imagery
        NASA SDO / SOHO
      </p>
    </Panel>
  );
}
