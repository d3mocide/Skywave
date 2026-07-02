// World map (§8): DE/DX markers, short- and long-path great circles (both —
// never silently pick one, §9), day/night terminator with grayline edge.

import { useMemo } from 'react';
import {
  MapContainer,
  TileLayer,
  CircleMarker,
  Polyline,
  Polygon,
  Tooltip,
} from 'react-leaflet';
import type { LatLon } from '../lib/geo';
import { greatCirclePoints, longPathPoints } from '../lib/geo';
import { nightPolygon } from '../lib/solar';
import 'leaflet/dist/leaflet.css';

export function WorldMap(props: {
  de: LatLon | null;
  dx: LatLon | null;
  now: Date;
}) {
  const { de, dx, now } = props;

  const night = useMemo(
    () => nightPolygon(now).map((p) => [p.lat, p.lon] as [number, number]),
    // Recompute at minute granularity — the terminator moves ~0.25°/min
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [Math.floor(now.getTime() / 60000)],
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

  return (
    <MapContainer
      center={de ? [de.lat, de.lon] : [30, 0]}
      zoom={2}
      minZoom={1}
      className="world-map"
      worldCopyJump
    >
      {/* OSM tiles online; the PWA shell keeps the app functional offline
          even when tiles can't load — data panels don't depend on tiles. */}
      <TileLayer
        attribution='&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>'
        url="https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png"
      />
      <Polygon
        positions={night}
        pathOptions={{
          color: '#e8b23d',
          weight: 1,
          opacity: 0.5,
          fillColor: '#000',
          fillOpacity: 0.35,
          interactive: false,
        }}
      />
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
  );
}
