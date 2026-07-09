// World map (§8): DE/DX markers, short- and long-path great circles (both —
// never silently pick one, §9), day/night terminator with grayline edge.
//
// Plus the live layers that make the map the main propagation instrument:
//  - band coverage heatmap from DE (climatological estimate, labeled as such)
//  - DX cluster spots placed by callsign prefix (click to set as DX target)
//  - GIRO ionosonde foF2/MUF readings (the real measured ionosphere) as
//    station dots and an interpolated MUF field
//  - auroral oval: OVATION nowcast when available, Kp-scaled dipole
//    approximation otherwise (and while previewing future hours)
//  - flare radio-blackout shading (dayside D-layer absorption)
//  - subsolar point (grayline anchor)
//  - right-click (or the 🎯 pick tool) anywhere to set the DX target
//
// Layer computation (what to draw) lives in useMapLayers — shared with
// GlobeMap so Flat and Globe never quietly diverge on the underlying data.

import { useEffect, useState } from 'react';
import {
  MapContainer,
  TileLayer,
  CircleMarker,
  ImageOverlay,
  Polyline,
  Polygon,
  Tooltip,
  useMap,
  useMapEvents,
} from 'react-leaflet';
import type { LatLon } from '../lib/geo';
import { latLonToGrid } from '../lib/geo';
import { HF_BANDS } from '../lib/propagation/engine';
import { BAND_GROUP_COLORS, BAND_GROUP_LABELS, type BandGroup } from '../lib/bands';
import { COVERAGE_BOUNDS } from '../lib/coverage';
import { AURORA_BOUNDS } from '../lib/aurora';
import { MUFMAP_BOUNDS } from '../lib/mufmap';
import { BLACKOUT_BOUNDS } from '../lib/blackout';
import type { Spot, Fof2Station, AuroraForecast } from '../lib/api';
import { useMapLayers } from '../hooks/useMapLayers';
import 'leaflet/dist/leaflet.css';

/** Sequential gold ramp for measured MUF(3000) — lighter = higher. */
function mufColor(mufd: number): string {
  if (mufd >= 28) return '#ffe9a8';
  if (mufd >= 21) return '#ffd166';
  if (mufd >= 14) return '#d9a832';
  if (mufd >= 7) return '#a67c00';
  return '#6e5300';
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

/** Set the DX target from the map itself: right-click always works, and
 * left-click works while the 🎯 pick tool is armed. */
function DxPicker(props: {
  armed: boolean;
  onPick: (grid: string) => void;
  onDisarm: () => void;
}) {
  useMapEvents({
    contextmenu(e) {
      props.onPick(latLonToGrid({ lat: e.latlng.lat, lon: e.latlng.lng }, 4));
    },
    click(e) {
      if (!props.armed) return;
      props.onPick(latLonToGrid({ lat: e.latlng.lat, lon: e.latlng.lng }, 4));
      props.onDisarm();
    },
  });
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
  /** Effective Kp for the display time — forecast Kp while previewing. */
  kp: number | null;
  ssn12: number | null;
  spots: Spot[] | null;
  fof2: Fof2Station[] | null;
  aurora: AuroraForecast | null;
  /** Current GOES long-band X-ray flux, W/m² — drives the blackout layer. */
  xrayFlux: number | null;
  onSelectDx: (grid: string) => void;
  /** True while the top bar's time scrubber previews a future hour — live-
   * only layers (OVATION aurora, MUF field, blackout) hide and observed
   * markers (spots, fof2) recede rather than pretending to be current. */
  previewing: boolean;
}) {
  const { de, dx, ssn12, onSelectDx, previewing } = props;
  const [pickArmed, setPickArmed] = useState(false);

  const {
    layers,
    setLayers,
    toggle,
    night,
    sun,
    shortPath,
    longPath,
    coverageLayer,
    ovationLayer,
    auroraRings,
    mufFieldLayer,
    blackout,
    mapSpots,
    mufStations,
  } = useMapLayers(props);

  const nightTuples = night.map((p) => [p.lat, p.lon] as [number, number]);
  const shortTuples = shortPath?.map((p) => [p.lat, p.lon] as [number, number]) ?? null;
  const longTuples = longPath?.map((p) => [p.lat, p.lon] as [number, number]) ?? null;
  const auroraTuples =
    auroraRings?.map((ring) => ring.map((p) => [p.lat, p.lon] as [number, number])) ?? null;

  return (
    <div className={`map-wrap ${pickArmed ? 'map-picking' : ''}`}>
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
        <DxPicker
          armed={pickArmed}
          onPick={onSelectDx}
          onDisarm={() => setPickArmed(false)}
        />
        <TileLayer
          attribution='&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>'
          url="https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png"
        />
        {coverageLayer &&
          WORLD_COPIES.map((off) => (
            <ImageOverlay
              key={off}
              url={coverageLayer.url}
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
            positions={nightTuples.map(([la, lo]) => [la, lo + off] as [number, number])}
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
        {ovationLayer &&
          WORLD_COPIES.map((off) => (
            <ImageOverlay
              key={`ov${off}`}
              url={ovationLayer.url}
              bounds={[
                [AURORA_BOUNDS[0][0], AURORA_BOUNDS[0][1] + off],
                [AURORA_BOUNDS[1][0], AURORA_BOUNDS[1][1] + off],
              ]}
              opacity={0.85}
              interactive={false}
            />
          ))}
        {auroraTuples?.map((ring, i) => (
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
              auroral oval (approx{previewing ? ', forecast Kp' : ''}) — Kp{' '}
              {props.kp?.toFixed(1)}
            </Tooltip>
          </Polyline>
        ))}
        {mufFieldLayer &&
          WORLD_COPIES.map((off) => (
            <ImageOverlay
              key={`muf${off}`}
              url={mufFieldLayer.url}
              bounds={[
                [MUFMAP_BOUNDS[0][0], MUFMAP_BOUNDS[0][1] + off],
                [MUFMAP_BOUNDS[1][0], MUFMAP_BOUNDS[1][1] + off],
              ]}
              opacity={0.9}
              interactive={false}
            />
          ))}
        {blackout &&
          WORLD_COPIES.map((off) => (
            <ImageOverlay
              key={`bo${off}`}
              url={blackout.layer.url}
              bounds={[
                [BLACKOUT_BOUNDS[0][0], BLACKOUT_BOUNDS[0][1] + off],
                [BLACKOUT_BOUNDS[1][0], BLACKOUT_BOUNDS[1][1] + off],
              ]}
              opacity={1}
              interactive={false}
            />
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
        {shortTuples && (
          <Polyline
            positions={shortTuples}
            pathOptions={{ color: '#4dd2ff', weight: 2 }}
          />
        )}
        {longTuples && (
          <Polyline
            positions={longTuples}
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
            checked={layers.mufField}
            onChange={() => toggle('mufField')}
          />
          MUF field (interpolated)
        </label>
        <label className="map-ctl-row">
          <input
            type="checkbox"
            checked={layers.aurora}
            onChange={() => toggle('aurora')}
          />
          aurora {ovationLayer ? '(OVATION)' : '(approx oval)'}
        </label>
        <label className="map-ctl-row">
          <input
            type="checkbox"
            checked={layers.blackout}
            onChange={() => toggle('blackout')}
          />
          flare blackout
        </label>
        <button
          className={`chip map-ctl-pick ${pickArmed ? 'chip-on' : ''}`}
          onClick={() => setPickArmed((v) => !v)}
          title="click anywhere on the map to set the DX target (right-click always works)"
        >
          🎯 {pickArmed ? 'click map to set DX…' : 'pick DX on map'}
        </button>
      </div>

      {(coverageLayer ||
        (layers.spots && mapSpots.length > 0) ||
        mufFieldLayer ||
        blackout ||
        ovationLayer) && (
        <div className="map-legend">
          {coverageLayer && (
            <div className="map-legend-row">
              <span className="map-legend-gradient" />
              <span>
                {layers.coverageBand} reliability from DE · estimate
              </span>
            </div>
          )}
          {mufFieldLayer && (
            <div className="map-legend-row">
              <span className="map-legend-gradient map-legend-muf" />
              <span>
                MUF(3000) field · interpolated from{' '}
                {props.fof2?.filter((s) => s.mufd != null && s.cs >= 25).length ?? 0}{' '}
                ionosondes
              </span>
            </div>
          )}
          {ovationLayer && (
            <div className="map-legend-row">
              <span className="map-legend-gradient map-legend-aurora" />
              <span>aurora probability · OVATION nowcast</span>
            </div>
          )}
          {blackout && (
            <div className="map-legend-row">
              <span className="map-legend-dot" style={{ background: '#d83a30' }} />
              <span>
                {blackout.cls} flare blackout · absorption to ~
                {Math.round(blackout.haf)} MHz at subsolar
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
