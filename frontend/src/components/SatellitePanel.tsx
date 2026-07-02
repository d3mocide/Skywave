// Satellite passes (§8) — SGP4 client-side from cached TLEs, so this panel
// keeps predicting while offline.

import { useMemo, useState } from 'react';
import { Panel } from './Panel';
import type { ApiState } from '../hooks/useApi';
import type { Tle } from '../lib/api';
import type { LatLon } from '../lib/geo';
import { predictPasses } from '../lib/satellites';

// A few high-interest birds shown by default; "all" is one click away.
const FEATURED = ['ISS (ZARYA)', 'SO-50', 'AO-91', 'RS-44', 'GREENCUBE (IO-117)'];

export function SatellitePanel(props: {
  tles: ApiState<Tle[]>;
  de: LatLon | null;
}) {
  const { data, fetchedAt, stale } = props.tles;
  const [showAll, setShowAll] = useState(false);

  const passes = useMemo(() => {
    if (!data || !props.de) return [];
    const subset = showAll
      ? data
      : data.filter((t) =>
          FEATURED.some((f) => t.name.toUpperCase().includes(f.split(' ')[0])),
        );
    return predictPasses(subset, props.de, 12).slice(0, 12);
  }, [data, props.de, showAll]);

  return (
    <Panel
      title="Satellites"
      fetchedAt={fetchedAt}
      stale={stale}
      badge={
        <button className="chip" onClick={() => setShowAll((v) => !v)}>
          {showAll ? 'featured' : 'all'}
        </button>
      }
    >
      {!props.de ? (
        <p className="empty">set your DE grid to predict passes</p>
      ) : passes.length === 0 ? (
        <p className="empty">
          {data ? 'no passes in the next 12 h' : 'waiting for TLEs…'}
        </p>
      ) : (
        <table className="spot-table">
          <thead>
            <tr>
              <th>satellite</th>
              <th>AOS</th>
              <th>LOS</th>
              <th>max el</th>
            </tr>
          </thead>
          <tbody>
            {passes.map((p) => (
              <tr key={p.name + p.aos.toISOString()}>
                <td className="strong">{p.name}</td>
                <td className="mono">{p.aos.toISOString().slice(11, 16)}Z</td>
                <td className="mono">{p.los.toISOString().slice(11, 16)}Z</td>
                <td className="mono">{Math.round(p.maxElevation)}°</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </Panel>
  );
}
