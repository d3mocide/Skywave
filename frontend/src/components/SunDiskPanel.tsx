// Solar disk imagery (TABS-REDESIGN-PLAN.md Phase E): live SDO/SOHO channels
// with NOAA's numbered regions projected onto the disk. Split out of the old
// monolithic SunPanel so the disk can take a wide grid column while region
// detail lives in its own panel; selection state is shared via the parent
// SunCMEView.

import { useEffect, useRef, useState } from 'react';
import { Panel } from './Panel';
import type { ApiState } from '../hooks/useApi';
import {
  fetchSunFrames,
  fetchSunImage,
  SUN_CHANNELS,
  sunFrameUrl,
  type SolarActivity,
  type SolarRegion,
  type SunChannel,
  type SunImage,
} from '../lib/api';
import { magRisk } from '../lib/solarRegions';

const REFRESH_MS = 10 * 60_000;
const LAPSE_FRAME_MS = 180; // ~5.5 fps — slow enough to read region motion

interface Lapse {
  frames: number[]; // unix s, oldest first
  urls: string[]; // preloaded object URLs, same order
}

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

export function SunDiskPanel(props: {
  activity: ApiState<SolarActivity>;
  regions: SolarRegion[];
  selected: number | null;
  onSelect: (region: number | null) => void;
}) {
  const { fetchedAt, stale } = props.activity;
  const [channel, setChannel] = useState<SunChannel>('hmi');
  const [image, setImage] = useState<SunImage | null>(null);
  const [imgError, setImgError] = useState(false);
  const [showRegions, setShowRegions] = useState(true);
  const urlRef = useRef<string | null>(null);
  // Previous frame, kept alive briefly so refreshes and channel switches
  // crossfade instead of hard-swapping. Ref mirrors the state so unmount
  // cleanup and the fade timeout can revoke without stale closures.
  const prevRef = useRef<string | null>(null);
  const [prevUrl, setPrevUrl] = useState<string | null>(null);
  const setPrev = (u: string | null) => {
    prevRef.current = u;
    setPrevUrl(u);
  };

  // Time-lapse playback state. `lapse` holds the preloaded frames; while
  // it's set the disk shows frames instead of the live image and the region
  // overlay hides (regions drift — pinning today's positions on yesterday's
  // disk would be wrong).
  const [lapse, setLapse] = useState<Lapse | null>(null);
  const [lapseBusy, setLapseBusy] = useState(false);
  const [lapseNote, setLapseNote] = useState<string | null>(null);
  const [frameIdx, setFrameIdx] = useState(0);
  const [playing, setPlaying] = useState(true);

  const exitLapse = () => {
    setLapse((cur) => {
      cur?.urls.forEach((u) => URL.revokeObjectURL(u));
      return null;
    });
    setLapseNote(null);
  };

  // Guards async loads against a channel switch mid-flight.
  const channelRef = useRef(channel);
  channelRef.current = channel;

  // `quiet` suppresses the failure notes — used by the LASCO auto-loop,
  // where silently staying on the live image is the right fallback.
  const enterLapse = async (quiet = false) => {
    const ch = channel;
    setLapseBusy(true);
    setLapseNote(null);
    try {
      const manifest = await fetchSunFrames(channel);
      if (manifest.frames.length < 2) {
        if (!quiet)
          setLapseNote(
            'collecting frames — the loop needs a couple of capture intervals; check back in ~an hour',
          );
        return;
      }
      const urls: string[] = [];
      for (const ts of manifest.frames) {
        const res = await fetch(sunFrameUrl(channel, ts));
        if (!res.ok) continue;
        urls.push(URL.createObjectURL(await res.blob()));
      }
      if (urls.length < 2 || channelRef.current !== ch) {
        urls.forEach((u) => URL.revokeObjectURL(u));
        if (!quiet && channelRef.current === ch)
          setLapseNote('frames expired mid-load — try again');
        return;
      }
      setLapse({ frames: manifest.frames.slice(0, urls.length), urls });
      setFrameIdx(0);
      setPlaying(true);
    } catch {
      if (!quiet) setLapseNote('time-lapse unavailable — backend frame ring unreachable');
    } finally {
      setLapseBusy(false);
    }
  };

  // The coronagraph channels *are* the CME movie — start the ambient loop
  // automatically when one is selected, falling back silently to the live
  // image when the frame ring isn't ready yet.
  useEffect(() => {
    if (channel === 'lascoc2' || channel === 'lascoc3') void enterLapse(true);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [channel]);

  // Advance the loop while playing.
  useEffect(() => {
    if (!lapse || !playing) return;
    const id = setInterval(
      () => setFrameIdx((i) => (i + 1) % lapse.urls.length),
      LAPSE_FRAME_MS,
    );
    return () => clearInterval(id);
  }, [lapse, playing]);

  // Channel switch or unmount ends the loop and frees its object URLs.
  useEffect(() => exitLapse, [channel]);

  useEffect(() => {
    let cancelled = false;
    const load = async () => {
      try {
        const img = await fetchSunImage(channel);
        if (cancelled) {
          URL.revokeObjectURL(img.objectUrl);
          return;
        }
        // Hand the outgoing frame to the crossfade layer; revoke it once
        // the fade has certainly finished.
        const old = urlRef.current;
        urlRef.current = img.objectUrl;
        setImage(img);
        setImgError(false);
        if (old) {
          if (prevRef.current) URL.revokeObjectURL(prevRef.current);
          setPrev(old);
          window.setTimeout(() => {
            if (prevRef.current === old) {
              URL.revokeObjectURL(old);
              setPrev(null);
            }
          }, 900);
        }
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

  // Revoke the live and fading object URLs when the panel unmounts.
  useEffect(
    () => () => {
      if (urlRef.current) URL.revokeObjectURL(urlRef.current);
      if (prevRef.current) URL.revokeObjectURL(prevRef.current);
    },
    [],
  );

  const probs = props.activity.data?.probabilities;
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
        {lapse ? (
          <img
            src={lapse.urls[frameIdx]}
            alt={`${channelMeta?.title ?? channel} — time-lapse frame`}
          />
        ) : image && !imgError ? (
          <>
            <img src={image.objectUrl} alt={channelMeta?.title ?? channel} />
            {prevUrl && (
              <img
                src={prevUrl}
                alt=""
                aria-hidden="true"
                className="sun-img-prev"
              />
            )}
          </>
        ) : (
          <p className="empty">
            {imgError ? 'imagery unavailable' : 'loading imagery…'}
          </p>
        )}
        {!lapse &&
          showRegions &&
          diskFrac != null &&
          !imgError &&
          image &&
          props.regions.map((r) => {
            const p = diskXY(r);
            if (!p) return null;
            const risk = magRisk(r.mag_class);
            const flaring = (r.m_xray_events ?? 0) + (r.x_xray_events ?? 0) > 0;
            return (
              <button
                key={r.region}
                className={`sun-region sun-region-${risk} ${
                  props.selected === r.region ? 'sun-region-selected' : ''
                } ${flaring ? 'sun-region-flaring' : ''}`}
                style={{
                  left: `${50 + p.x * diskFrac * 50}%`,
                  top: `${50 - p.y * diskFrac * 50}%`,
                }}
                title={`AR${r.region} · ${r.location ?? ''} · ${r.spot_class ?? '?'} / ${r.mag_class ?? '?'}${r.area != null ? ` · ${r.area} μhem` : ''}`}
                onClick={() =>
                  props.onSelect(props.selected === r.region ? null : r.region)
                }
              >
                <span className="sun-region-label">{r.region}</span>
              </button>
            );
          })}
      </div>

      {lapse && (
        <div className="sun-lapse-row">
          <button
            className="chip"
            onClick={() => setPlaying((p) => !p)}
            title={playing ? 'pause' : 'play'}
          >
            {playing ? '⏸' : '▶'}
          </button>
          <input
            type="range"
            min={0}
            max={lapse.urls.length - 1}
            value={frameIdx}
            onChange={(e) => {
              setPlaying(false);
              setFrameIdx(Number(e.target.value));
            }}
            aria-label="time-lapse frame"
          />
          <span className="mono sun-lapse-ts">
            {new Date(lapse.frames[frameIdx] * 1000)
              .toISOString()
              .slice(5, 16)
              .replace('T', ' ')}
            Z
          </span>
          <button className="chip" onClick={exitLapse} title="back to the live image">
            live
          </button>
        </div>
      )}
      <div className="sun-meta">
        {!lapse && (
          <button
            className="chip"
            disabled={lapseBusy}
            onClick={() => enterLapse()}
            title="loop the recent frames the backend has collected (~12 h at 15-min steps) — on LASCO channels this is a CME movie"
          >
            {lapseBusy ? 'loading frames…' : '▶ time-lapse'}
          </button>
        )}
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
        {diskFrac != null && !lapse && (
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
      {lapseNote && <p className="flag">{lapseNote}</p>}
      <p className="footnote">
        region positions approximate (orthographic, B0/P ignored) · imagery
        NASA SDO / SOHO
      </p>
    </Panel>
  );
}
