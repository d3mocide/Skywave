// Layer toggle panel + legend shared by all three map renderers (WorldMap/
// Flat, GlobeMap, BeamMap) — same useMapLayers data underneath, so one
// legend definition can't quietly diverge from what's actually drawn.

import type { Dispatch, SetStateAction } from 'react';
import { HF_BANDS } from '../lib/propagation/engine';
import { BAND_GROUP_COLORS, BAND_GROUP_LABELS, type BandGroup } from '../lib/bands';
import type { LatLon } from '../lib/geo';
import { distanceKm, EARTH_RADIUS_KM } from '../lib/geo';
import type { LayerPrefs } from '../lib/mapLayers';
import type { RasterLayer } from '../lib/mercRaster';
import type { MapSpot, PskMark } from '../hooks/useMapLayers';
import type { PskDirection } from '../lib/pskreporter';
import type { PskStatus } from '../hooks/usePskReports';

export function MapLayerControls(props: {
  variant: 'flat' | 'globe' | 'beam';
  layers: LayerPrefs;
  setLayers: Dispatch<SetStateAction<LayerPrefs>>;
  toggle: (k: keyof LayerPrefs) => void;
  pickArmed: boolean;
  onTogglePick: () => void;
  de: LatLon | null;
  dx: LatLon | null;
  ssn12: number | null;
  coverageLayer: RasterLayer | null;
  ovationLayer: RasterLayer | null;
  mufFieldLayer: RasterLayer | null;
  blackout: { haf: number; cls: string; source: 'drap' | 'model' } | null;
  /** True when the auroral layer is on but falling back to the Kp-scaled
   * dipole oval because OVATION data isn't available. */
  auroraFallback: boolean;
  mapSpots: MapSpot[];
  fof2Count: number;
  pskMarks: PskMark[];
  pskDir: PskDirection;
  pskStatus: PskStatus;
}) {
  const { layers, setLayers, toggle, variant, de, dx } = props;
  const noun = variant === 'globe' ? 'globe' : variant === 'beam' ? 'beam map' : 'map';

  return (
    <>
      <div className="map-ctl">
        <div className="map-ctl-title">layers</div>
        <label className="map-ctl-row">
          <input type="checkbox" checked={layers.coverage} onChange={() => toggle('coverage')} />
          Coverage from DE
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
            {(!props.de || props.ssn12 == null) && (
              <span className="map-ctl-hint">
                {!props.de ? 'set your DE grid first' : 'waiting for solar data'}
              </span>
            )}
          </div>
        )}
        <label className="map-ctl-row">
          <input type="checkbox" checked={layers.spots} onChange={() => toggle('spots')} />
          DX spots
        </label>
        <label className="map-ctl-row">
          <input type="checkbox" checked={layers.muf} onChange={() => toggle('muf')} />
          Ionosonde MUF
        </label>
        <label className="map-ctl-row">
          <input type="checkbox" checked={layers.mufField} onChange={() => toggle('mufField')} />
          MUF field (interpolated)
        </label>
        <label className="map-ctl-row">
          <input type="checkbox" checked={layers.aurora} onChange={() => toggle('aurora')} />
          Aurora {props.ovationLayer ? '(OVATION)' : '(approx. oval)'}
        </label>
        <label className="map-ctl-row">
          <input type="checkbox" checked={layers.blackout} onChange={() => toggle('blackout')} />
          Absorption {props.blackout?.source === 'model' ? '(est.)' : '(D-RAP)'}
        </label>
        <label className="map-ctl-row">
          <input type="checkbox" checked={layers.psk} onChange={() => toggle('psk')} />
          Reception reports
          {layers.psk && props.pskStatus === 'off' && (
            <span className="map-ctl-hint"> — set your callsign</span>
          )}
          {layers.psk && props.pskStatus === 'down' && (
            <span className="map-ctl-hint"> — feed offline</span>
          )}
        </label>
        <button
          className={`chip map-ctl-pick ${props.pickArmed ? 'chip-on' : ''}`}
          onClick={props.onTogglePick}
          title={`click anywhere on the ${noun} to set the DX target (right-click always works)`}
        >
          🎯 {props.pickArmed ? `Click ${noun} to set DX…` : `Pick DX on ${noun}`}
        </button>
        {variant !== 'flat' && (
          <p className="map-ctl-hint canvas-map-hint">
            {variant === 'globe'
              ? 'Drag to rotate · pinch or scroll to zoom'
              : 'Centered on DE, north up · pinch or scroll to zoom'}
          </p>
        )}
      </div>

      <div className="map-legend">
        <div className="map-legend-row">
          <span className="map-legend-dot" style={{ background: '#e8b23d', opacity: 0.6 }} />
          <span>Night side · day/night terminator</span>
        </div>
        {de && dx && (
          <div className="map-legend-row map-legend-paths">
            <span className="map-legend-line map-legend-line-solid" />
            <span>
              Short path — {Math.round(distanceKm(de, dx)).toLocaleString()} km
            </span>
          </div>
        )}
        {de && dx && (
          <div className="map-legend-row map-legend-paths">
            <span className="map-legend-line map-legend-line-dashed" />
            <span>
              Long path —{' '}
              {Math.round(2 * Math.PI * EARTH_RADIUS_KM - distanceKm(de, dx)).toLocaleString()} km
            </span>
          </div>
        )}
        {props.coverageLayer && (
          <div className="map-legend-row">
            <span className="map-legend-gradient" />
            <span>{layers.coverageBand} reliability from DE · estimate</span>
          </div>
        )}
        {layers.muf && (
          <div className="map-legend-row">
            <span className="map-legend-gradient map-legend-muf" />
            <span>Ionosonde stations · measured MUF(3000)</span>
          </div>
        )}
        {props.mufFieldLayer && (
          <div className="map-legend-row">
            <span className="map-legend-gradient map-legend-muf" />
            <span>MUF(3000) field · interpolated from {props.fof2Count} ionosondes</span>
          </div>
        )}
        {props.ovationLayer && (
          <div className="map-legend-row">
            <span className="map-legend-gradient map-legend-aurora" />
            <span>Aurora probability · OVATION nowcast</span>
          </div>
        )}
        {props.auroraFallback && (
          <div className="map-legend-row">
            <span className="map-legend-line map-legend-line-dashed" style={{ borderColor: '#d8574f' }} />
            <span>Auroral oval · Kp-scaled approximation (OVATION unavailable)</span>
          </div>
        )}
        {props.blackout && (
          <div className="map-legend-row">
            <span className="map-legend-dot" style={{ background: '#d83a30' }} />
            <span>
              {props.blackout.source === 'drap' ? (
                <>
                  D-region absorption · NOAA D-RAP · HF affected to ~
                  {Math.round(props.blackout.haf)} MHz at worst
                </>
              ) : (
                <>
                  {props.blackout.cls} flare blackout · est. absorption to ~
                  {Math.round(props.blackout.haf)} MHz at subsolar (D-RAP
                  unavailable)
                </>
              )}
            </span>
          </div>
        )}
        {layers.psk && props.pskMarks.length > 0 && (
          <div className="map-legend-row">
            <span className="map-legend-line map-legend-line-solid" />
            <span>
              {props.pskMarks.length} station{props.pskMarks.length === 1 ? '' : 's'}{' '}
              {props.pskDir === 'tx' ? 'hear you' : 'heard by you'} · PSKReporter
              {props.pskStatus !== 'live' && ' (last known)'}
            </span>
          </div>
        )}
        {layers.spots && props.mapSpots.length > 0 && (
          <div className="map-legend-row">
            {(Object.keys(BAND_GROUP_COLORS) as BandGroup[]).map((g) => (
              <span key={g} className="map-legend-swatch">
                <span className="map-legend-dot" style={{ background: BAND_GROUP_COLORS[g] }} />
                {BAND_GROUP_LABELS[g]}
              </span>
            ))}
          </div>
        )}
      </div>
    </>
  );
}
