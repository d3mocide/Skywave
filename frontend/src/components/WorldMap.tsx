// World map (§8): DE/DX markers, short- and long-path great circles (both —
// never silently pick one, §9), day/night terminator with grayline edge.
//
// Plus the live layers that make the map the main propagation instrument:
//  - band coverage heatmap from DE (climatological estimate, labeled as such)
//  - DX cluster spots placed by callsign prefix (click to set as DX target)
//  - GIRO ionosonde foF2/MUF readings (the real measured ionosphere)
//  - approximate auroral oval scaled by live Kp
//  - subsolar point (grayline anchor)

import { useEffect, useMemo, useState } from 'react';
import {
  MapContainer,
  TileLayer,
  CircleMarker,
  ImageOverlay,
  Polyline,
  Polygon,
  Tooltip,
  useMap,
} from 'react-leaflet';
import type { LatLon } from '../lib/geo';
import {
  greatCirclePoints,
  longPathPoints,
  auroralOvalPoints,
  latLonToGrid,
} from '../lib/geo';
import { nightPolygon, subsolarPoint } from '../lib/solar';
import { renderCoverage, COVERAGE_BOUNDS } from '../lib/coverage';
import { HF_BANDS } from '../lib/propagation/engine';
import { callToLatLon, callJitter } from '../lib/prefixes';
import {
  bandOf,
  bandGroup,
  BAND_GROUP_COLORS,
  BAND_GROUP_LABELS,
  type BandGroup,
} from '../lib/bands';
import type { Spot, Fof2Station } from '../lib/api';
import 'leaflet/dist/leaflet.css';

interface LayerPrefs {
  coverage: boolean;
  coverageBand: string;
  spots: boolean;
  muf: boolean;
  aurora: boolean;
}

const DEFAULT_LAYERS: LayerPrefs = {
  coverage: true,
  coverageBand: '20m',
  spots: true,
  muf: false,
  aurora: true,
};

const LAYERS_KEY = 'skywave-map-layers';

function loadLayers(): LayerPrefs {
  try {
    const raw = localStorage.getItem(LAYERS_KEY);
    return raw ? { ...DEFAULT_LAYERS, ...JSON.parse(raw) } : DEFAULT_LAYERS;
  } catch {
    return DEFAULT_LAYERS;
  }
}

/** Sequential gold ramp for measured MUF(3000) — lighter = higher. */
function mufColor(mufd: number): string {
  if (mufd >= 28) return '#ffe9a8';
  if (mufd >= 21) return '#ffd166';
  if (mufd >= 14) return '#d9a832';
  if (mufd >= 7) return '#a67c00';
  return '#6e5300';
}

interface MapSpot {
  spot: Spot;
  pos: LatLon;
  band: string;
  group: BandGroup;
}

/** Leaflet doesn't watch its container: re-measure when it resizes (e.g.
 * entering map-focus mode), or tiles beyond the old size never load. */
function InvalidateOnResize() {
  const map = useMap();
  useEffect(() => {
    const obs = new ResizeObserver(() => map.invalidateSize());
    obs.observe(map.getContainer());
    return () => obs.disconnect();
  }, [map]);
  return null;
}

// Tiles repeat across the antimeridian but overlays don't; draw the heavy
// area layers (coverage, terminator) on the neighbor world copies too.
const WORLD_COPIES = [-360, 0, 360];

export function WorldMap(props: {
  de: LatLon | null;
  dx: LatLon | null;
  /** Display time: live "now", or now + scrub offset when previewing. */
  time: Date;
  kp: number | null;
  ssn12: number | null;
  spots: Spot[] | null;
  fof2: Fof2Station[] | null;
  onSelectDx: (grid: string) => void;
  scrubHours: number;
  onScrub: (hours: number) => void;
}) {
  const { de, dx, time, kp, ssn12, spots, fof2, onSelectDx, scrubHours, onScrub } =
    props;
  const previewing = scrubHours !== 0;

  const [layers, setLayers] = useState<LayerPrefs>(loadLayers);
  useEffect(() => {
    localStorage.setItem(LAYERS_KEY, JSON.stringify(layers));
  }, [layers]);
  const toggle = (k: keyof LayerPrefs) =>
    setLayers((l) => ({ ...l, [k]: !l[k] }));

  // Play: step the scrubber forward through the next 24 h, then loop.
  const [playing, setPlaying] = useState(false);
  useEffect(() => {
    if (!playing) return;
    const id = setInterval(() => {
      onScrub(scrubHours >= 24 ? 0 : Math.round((scrubHours + 0.5) * 2) / 2);
    }, 400);
    return () => clearInterval(id);
  }, [playing, scrubHours, onScrub]);

  const minuteBucket = Math.floor(time.getTime() / 60000);
  const night = useMemo(
    () => nightPolygon(time).map((p) => [p.lat, p.lon] as [number, number]),
    // Recompute at minute granularity — the terminator moves ~0.25°/min
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [minuteBucket],
  );
  const sun = useMemo(
    () => subsolarPoint(time),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [minuteBucket],
  );

  const shortPath = useMemo(
    () =>
      de && dx
        ? greatCirclePoints(de, dx).map((p) => [p.lat, p.lon] as [number, number])
        : null,
    [de, dx],
  );
  const longPath = useMemo(
    () =>
      de && dx
        ? longPathPoints(de, dx).map((p) => [p.lat, p.lon] as [number, number])
        : null,
    [de, dx],
  );

  const coverageMhz =
    HF_BANDS.find((b) => b.name === layers.coverageBand)?.mhz ?? 14.15;
  // 5-minute buckets: the heatmap follows the terminator, which barely moves
  // in that window, and repainting 40k cells every 15 s tick buys nothing.
  // (Scrubbing moves in 30-min steps, so every scrub lands in a new bucket.)
  const coverageBucket = Math.floor(time.getTime() / 300_000);
  const coverageUrl = useMemo(
    () =>
      layers.coverage && de && ssn12 != null
        ? renderCoverage(de, coverageMhz, time, ssn12)
        : null,
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [layers.coverage, de?.lat, de?.lon, coverageMhz, ssn12, coverageBucket],
  );

  const aurora = useMemo(() => {
    if (!layers.aurora || kp == null) return null;
    return (['N', 'S'] as const).map((h) =>
      auroralOvalPoints(kp, h).map((p) => [p.lat, p.lon] as [number, number]),
    );
  }, [layers.aurora, kp]);

  const mapSpots = useMemo<MapSpot[]>(() => {
    if (!layers.spots || !spots) return [];
    const seen = new Set<string>();
    const out: MapSpot[] = [];
    // Newest first so the dedupe keeps each call's latest frequency.
    const sorted = [...spots].sort((a, b) => b.received_at - a.received_at);
    for (const spot of sorted) {
      if (seen.has(spot.dx_call)) continue;
      const band = bandOf(spot.freq_khz);
      const base = callToLatLon(spot.dx_call);
      if (!band || !base) continue;
      seen.add(spot.dx_call);
      const j = callJitter(spot.dx_call);
      out.push({
        spot,
        band,
        group: bandGroup(band),
        pos: {
          lat: Math.max(-84, Math.min(84, base.lat + j.dLat)),
          lon: base.lon + j.dLon,
        },
      });
      if (out.length >= 80) break;
    }
    return out;
  }, [layers.spots, spots]);

  const mufStations = useMemo(() => {
    if (!layers.muf || !fof2) return [];
    return fof2.filter((s) => s.mufd != null && s.cs >= 25);
  }, [layers.muf, fof2]);

  return (
    <div className="map-wrap">
      <MapContainer
        center={de ? [de.lat, de.lon] : [30, 0]}
        zoom={2}
        minZoom={1}
        className="world-map"
        worldCopyJump
      >
        {/* OSM tiles online; the PWA shell keeps the app functional offline
            even when tiles can't load — data panels don't depend on tiles. */}
        <InvalidateOnResize />
        <TileLayer
          attribution='&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>'
          url="https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png"
        />
        {coverageUrl &&
          WORLD_COPIES.map((off) => (
            <ImageOverlay
              key={off}
              url={coverageUrl}
              bounds={[
                [COVERAGE_BOUNDS[0][0], COVERAGE_BOUNDS[0][1] + off],
                [COVERAGE_BOUNDS[1][0], COVERAGE_BOUNDS[1][1] + off],
              ]}
              opacity={1}
              interactive={false}
            />
          ))}
        {WORLD_COPIES.map((off) => (
          <Polygon
            key={off}
            positions={night.map(([la, lo]) => [la, lo + off] as [number, number])}
            pathOptions={{
              color: '#e8b23d',
              weight: 1,
              opacity: 0.5,
              fillColor: '#000',
              fillOpacity: 0.35,
              interactive: false,
            }}
          />
        ))}
        {aurora?.map((ring, i) => (
          <Polyline
            key={i}
            positions={ring}
            pathOptions={{
              color: '#d8574f',
              weight: 2,
              opacity: 0.75,
              dashArray: '4 6',
            }}
          >
            <Tooltip sticky>
              auroral oval (approx) — Kp {kp?.toFixed(1)}
            </Tooltip>
          </Polyline>
        ))}
        {mufStations.map((s) => {
          const mufd = s.mufd as number;
          const c = mufColor(mufd);
          return (
            <CircleMarker
              key={s.station.name}
              center={[s.station.latitude, s.station.longitude]}
              radius={5}
              pathOptions={{
                color: c,
                weight: 2,
                fillColor: c,
                // Measured-now data: recede while previewing a future time.
                opacity: previewing ? 0.3 : 1,
                fillOpacity: previewing ? 0.05 : 0.15,
              }}
            >
              <Tooltip>
                {s.station.name}: MUF(3000) {mufd.toFixed(1)} MHz
                {s.fof2 != null && <> · foF2 {s.fof2.toFixed(1)} MHz</>}
              </Tooltip>
            </CircleMarker>
          );
        })}
        {mapSpots.map(({ spot, pos, band, group }) => (
          <CircleMarker
            key={`${spot.dx_call}-${spot.freq_khz}`}
            center={[pos.lat, pos.lon]}
            radius={4}
            pathOptions={{
              color: BAND_GROUP_COLORS[group],
              fillColor: BAND_GROUP_COLORS[group],
              // Spots are live observations: recede while previewing.
              opacity: previewing ? 0.3 : 1,
              fillOpacity: previewing ? 0.25 : 0.85,
              weight: 1,
            }}
            eventHandlers={{
              click: () => onSelectDx(latLonToGrid(pos, 4)),
            }}
          >
            <Tooltip>
              {spot.dx_call} · {spot.freq_khz.toFixed(1)} kHz ({band})
              {spot.spot_time ? ` · ${spot.spot_time}` : ''}
              <br />
              approx. location by prefix — click to set as DX
            </Tooltip>
          </CircleMarker>
        ))}
        <CircleMarker
          center={[sun.lat, sun.lon]}
          radius={9}
          pathOptions={{
            color: '#e8b23d',
            weight: 1,
            opacity: 0.5,
            fillColor: '#e8b23d',
            fillOpacity: 0.2,
            interactive: false,
          }}
        />
        <CircleMarker
          center={[sun.lat, sun.lon]}
          radius={4}
          pathOptions={{ color: '#e8b23d', fillColor: '#e8b23d', fillOpacity: 0.9 }}
        >
          <Tooltip>subsolar point</Tooltip>
        </CircleMarker>
        {shortPath && (
          <Polyline
            positions={shortPath}
            pathOptions={{ color: '#4dd2ff', weight: 2 }}
          />
        )}
        {longPath && (
          <Polyline
            positions={longPath}
            pathOptions={{ color: '#4dd2ff', weight: 1.5, dashArray: '6 8', opacity: 0.6 }}
          />
        )}
        {de && (
          <CircleMarker
            center={[de.lat, de.lon]}
            radius={6}
            pathOptions={{ color: '#7CFC9B', fillColor: '#7CFC9B', fillOpacity: 0.9 }}
          >
            <Tooltip>DE (you)</Tooltip>
          </CircleMarker>
        )}
        {dx && (
          <CircleMarker
            center={[dx.lat, dx.lon]}
            radius={6}
            pathOptions={{ color: '#ff7c7c', fillColor: '#ff7c7c', fillOpacity: 0.9 }}
          >
            <Tooltip>DX target</Tooltip>
          </CircleMarker>
        )}
      </MapContainer>

      <div className="map-ctl">
        <div className="map-ctl-title">layers</div>
        <label className="map-ctl-row">
          <input
            type="checkbox"
            checked={layers.coverage}
            onChange={() => toggle('coverage')}
          />
          coverage from DE
        </label>
        {layers.coverage && (
          <div className="map-ctl-bands">
            {HF_BANDS.map((b) => (
              <button
                key={b.name}
                className={`chip ${layers.coverageBand === b.name ? 'chip-on' : ''}`}
                onClick={() => setLayers((l) => ({ ...l, coverageBand: b.name }))}
              >
                {b.name}
              </button>
            ))}
            {(!de || ssn12 == null) && (
              <span className="map-ctl-hint">
                {!de ? 'set your DE grid first' : 'waiting for solar data'}
              </span>
            )}
          </div>
        )}
        <label className="map-ctl-row">
          <input
            type="checkbox"
            checked={layers.spots}
            onChange={() => toggle('spots')}
          />
          DX spots
        </label>
        <label className="map-ctl-row">
          <input
            type="checkbox"
            checked={layers.muf}
            onChange={() => toggle('muf')}
          />
          ionosonde MUF
        </label>
        <label className="map-ctl-row">
          <input
            type="checkbox"
            checked={layers.aurora}
            onChange={() => toggle('aurora')}
          />
          auroral oval
        </label>
      </div>

      <div className="map-scrub">
        <button
          className="map-scrub-btn"
          onClick={() => setPlaying((p) => !p)}
          title={playing ? 'pause' : 'play the next 24 h'}
        >
          {playing ? '❚❚' : '▶'}
        </button>
        <button
          className={`map-scrub-btn ${previewing ? '' : 'map-scrub-live'}`}
          onClick={() => {
            setPlaying(false);
            onScrub(0);
          }}
          title="back to live"
        >
          now
        </button>
        <input
          type="range"
          min={0}
          max={24}
          step={0.5}
          value={scrubHours}
          onChange={(e) => onScrub(Number(e.target.value))}
          aria-label="preview time, hours ahead"
        />
        <span className={`map-scrub-label mono ${previewing ? 'previewing' : ''}`}>
          {previewing
            ? `+${scrubHours}h · ${time.toISOString().slice(11, 16)}Z`
            : 'live'}
        </span>
      </div>

      {(coverageUrl || (layers.spots && mapSpots.length > 0)) && (
        <div className="map-legend">
          {coverageUrl && (
            <div className="map-legend-row">
              <span className="map-legend-gradient" />
              <span>
                {layers.coverageBand} reliability from DE · estimate
              </span>
            </div>
          )}
          {layers.spots && mapSpots.length > 0 && (
            <div className="map-legend-row">
              {(Object.keys(BAND_GROUP_COLORS) as BandGroup[]).map((g) => (
                <span key={g} className="map-legend-swatch">
                  <span
                    className="map-legend-dot"
                    style={{ background: BAND_GROUP_COLORS[g] }}
                  />
                  {BAND_GROUP_LABELS[g]}
                </span>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
