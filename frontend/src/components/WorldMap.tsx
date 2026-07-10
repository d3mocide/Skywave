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

import { Fragment, useEffect, useMemo, useState } from 'react';
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
import { latLonToGrid, distanceKm, EARTH_RADIUS_KM } from '../lib/geo';
import { BAND_GROUP_COLORS } from '../lib/bands';
import { COVERAGE_BOUNDS } from '../lib/coverage';
import { AURORA_BOUNDS } from '../lib/aurora';
import { MUFMAP_BOUNDS, mufColor } from '../lib/mufmap';
import { BLACKOUT_BOUNDS } from '../lib/blackout';
import type { Spot, Fof2Station, AuroraForecast } from '../lib/api';
import type { PskDirection, PskReport } from '../lib/pskreporter';
import type { PskStatus } from '../hooks/usePskReports';
import { useMapLayers, type MapSpot } from '../hooks/useMapLayers';
import { MapLayerControls } from './MapLayerControls';
import { clusterSpots, dominantBy } from '../lib/spotCluster';
import 'leaflet/dist/leaflet.css';

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

/** DX spots, clustered in screen space so a dense pileup (e.g. a contest
 * weekend over EU) reads as one badged dot instead of an overlapping mess.
 * Leaflet doesn't expose marker screen positions declaratively, so this
 * recomputes them via the map instance on every zoom/pan — the same
 * zoom-awareness the canvas renderers get for free from already working in
 * screen space. mapSpots is newest-first (see useMapLayers), so a cluster's
 * first item is its most recent spot — same representative a lone marker
 * would show today. */
function ClusteredSpots(props: {
  mapSpots: MapSpot[];
  previewing: boolean;
  onSelectDx: (grid: string) => void;
}) {
  const map = useMap();
  // Bumped on every zoomend/moveend so the memo below recomputes screen
  // positions even though `map` and `mapSpots` themselves haven't changed.
  const [viewTick, setViewTick] = useState(0);
  useMapEvents({
    zoomend: () => setViewTick((n) => n + 1),
    moveend: () => setViewTick((n) => n + 1),
  });

  const clusters = useMemo(() => {
    const projected = props.mapSpots.map((spot) => {
      const pt = map.latLngToContainerPoint([spot.pos.lat, spot.pos.lon]);
      return { x: pt.x, y: pt.y, item: spot };
    });
    return clusterSpots(projected);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [map, props.mapSpots, viewTick]);

  return (
    <>
      {clusters.map((cluster) => {
        const rep = cluster.items[0];
        const count = cluster.items.length;
        const group = dominantBy(cluster.items, (s) => s.group) as MapSpot['group'];
        const color = BAND_GROUP_COLORS[group];
        return (
          <CircleMarker
            key={`${rep.spot.dx_call}-${rep.spot.freq_khz}`}
            center={[rep.pos.lat, rep.pos.lon]}
            radius={4 + Math.min(4, count - 1)}
            pathOptions={{
              color,
              fillColor: color,
              // Spots are live observations: recede while previewing.
              opacity: props.previewing ? 0.3 : 1,
              fillOpacity: props.previewing ? 0.25 : 0.85,
              weight: 1,
            }}
            eventHandlers={{
              click: () => props.onSelectDx(latLonToGrid(rep.pos, 4)),
            }}
          >
            <Tooltip>
              {count === 1 ? (
                <>
                  {rep.spot.dx_call} · {rep.spot.freq_khz.toFixed(1)} kHz ({rep.band})
                  {rep.spot.spot_time ? ` · ${rep.spot.spot_time}` : ''}
                  <br />
                  approx. location by prefix — click to set as DX
                </>
              ) : (
                <>
                  {count} spots here — click to set DX to {rep.spot.dx_call}
                  <br />
                  {cluster.items
                    .slice(0, 8)
                    .map((s) => s.spot.dx_call)
                    .join(', ')}
                  {count > 8 ? `, +${count - 8} more` : ''}
                </>
              )}
            </Tooltip>
          </CircleMarker>
        );
      })}
    </>
  );
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
  /** PSKReporter reception reports, filtered to the selected direction. */
  psk: PskReport[] | null;
  pskDir: PskDirection;
  pskStatus: PskStatus;
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
    pskMarks,
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
        {/* PSK reception fan — under the DX spots so spot dots stay
            clickable through a dense fan. Positions are real reported
            grids, not prefix guesses, so clicking one is a precise DX. */}
        {pskMarks.map((mark) => {
          const color = BAND_GROUP_COLORS[mark.group];
          const alpha = (previewing ? 0.15 : 0.75) * (1 - mark.age * 0.7);
          const r = mark.report;
          const tip = (
            <Tooltip>
              {r.call}
              {props.pskDir === 'tx' ? ' hears you' : ' heard by you'} · {r.band ?? '?'}{' '}
              {r.mode}
              {r.snr != null && <> · {r.snr > 0 ? `+${r.snr}` : r.snr} dB</>}
              <br />
              {r.grid}
              {de && <> · {Math.round(distanceKm(de, mark.pos)).toLocaleString()} km</>} ·{' '}
              {Math.max(0, Math.round((Date.now() / 1000 - r.t) / 60))} min ago — click to
              set as DX
            </Tooltip>
          );
          return (
            <Fragment key={r.call}>
              {mark.path && (
                <Polyline
                  positions={mark.path.map((p) => [p.lat, p.lon] as [number, number])}
                  pathOptions={{ color, weight: 1, opacity: alpha * 0.6, interactive: false }}
                />
              )}
              <CircleMarker
                center={[mark.pos.lat, mark.pos.lon]}
                radius={3}
                pathOptions={{ color, fillColor: color, opacity: alpha, fillOpacity: alpha, weight: 1 }}
                eventHandlers={{ click: () => onSelectDx(r.grid ?? '') }}
              >
                {tip}
              </CircleMarker>
            </Fragment>
          );
        })}
        <ClusteredSpots mapSpots={mapSpots} previewing={previewing} onSelectDx={onSelectDx} />
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
        {shortTuples && de && dx && (
          <Polyline
            positions={shortTuples}
            pathOptions={{ color: '#4dd2ff', weight: 2 }}
          >
            <Tooltip sticky>short path — {Math.round(distanceKm(de, dx)).toLocaleString()} km</Tooltip>
          </Polyline>
        )}
        {longTuples && de && dx && (
          <Polyline
            positions={longTuples}
            pathOptions={{ color: '#4dd2ff', weight: 1.5, dashArray: '6 8', opacity: 0.6 }}
          >
            <Tooltip sticky>
              long path —{' '}
              {Math.round(2 * Math.PI * EARTH_RADIUS_KM - distanceKm(de, dx)).toLocaleString()} km
            </Tooltip>
          </Polyline>
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

      <MapLayerControls
        variant="flat"
        layers={layers}
        setLayers={setLayers}
        toggle={toggle}
        pickArmed={pickArmed}
        onTogglePick={() => setPickArmed((v) => !v)}
        de={de}
        dx={dx}
        ssn12={ssn12}
        coverageLayer={coverageLayer}
        ovationLayer={ovationLayer}
        mufFieldLayer={mufFieldLayer}
        blackout={blackout}
        auroraFallback={layers.aurora && !ovationLayer && auroraRings != null}
        mapSpots={mapSpots}
        fof2Count={props.fof2?.filter((s) => s.mufd != null && s.cs >= 25).length ?? 0}
        pskMarks={pskMarks}
        pskDir={props.pskDir}
        pskStatus={props.pskStatus}
      />
    </div>
  );
}
