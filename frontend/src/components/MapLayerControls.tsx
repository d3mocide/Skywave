// Layer toggle panel + legend shared by GlobeMap and BeamMap — identical
// capabilities on both (they're both new canvas renderers over the same
// useMapLayers data), so unlike WorldMap/Flat there's no risk in sharing
// this outright.

import type { Dispatch, SetStateAction } from 'react';
import { HF_BANDS } from '../lib/propagation/engine';
import { BAND_GROUP_COLORS, BAND_GROUP_LABELS, type BandGroup } from '../lib/bands';
import type { LatLon } from '../lib/geo';
import type { LayerPrefs } from '../lib/mapLayers';
import type { RasterLayer } from '../lib/mercRaster';
import type { MapSpot } from '../hooks/useMapLayers';

export function MapLayerControls(props: {
  variant: 'globe' | 'beam';
  layers: LayerPrefs;
  setLayers: Dispatch<SetStateAction<LayerPrefs>>;
  toggle: (k: keyof LayerPrefs) => void;
  pickArmed: boolean;
  onTogglePick: () => void;
  de: LatLon | null;
  ssn12: number | null;
  coverageLayer: RasterLayer | null;
  ovationLayer: RasterLayer | null;
  mufFieldLayer: RasterLayer | null;
  blackout: { haf: number; cls: string } | null;
  mapSpots: MapSpot[];
  fof2Count: number;
}) {
  const { layers, setLayers, toggle, variant } = props;
  const noun = variant === 'globe' ? 'globe' : 'beam map';

  return (
    <>
      <div className="map-ctl">
        <div className="map-ctl-title">layers</div>
        <label className="map-ctl-row">
          <input type="checkbox" checked={layers.coverage} onChange={() => toggle('coverage')} />
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
          ionosonde MUF
        </label>
        <label className="map-ctl-row">
          <input type="checkbox" checked={layers.mufField} onChange={() => toggle('mufField')} />
          MUF field (interpolated)
        </label>
        <label className="map-ctl-row">
          <input type="checkbox" checked={layers.aurora} onChange={() => toggle('aurora')} />
          aurora {props.ovationLayer ? '(OVATION)' : '(approx oval)'}
        </label>
        <label className="map-ctl-row">
          <input type="checkbox" checked={layers.blackout} onChange={() => toggle('blackout')} />
          flare blackout
        </label>
        <button
          className={`chip map-ctl-pick ${props.pickArmed ? 'chip-on' : ''}`}
          onClick={props.onTogglePick}
          title={`click anywhere on the ${noun} to set the DX target (right-click always works)`}
        >
          🎯 {props.pickArmed ? `click ${noun} to set DX…` : `pick DX on ${noun}`}
        </button>
        <p className="map-ctl-hint canvas-map-hint">
          {variant === 'globe'
            ? 'drag to rotate · pinch or scroll to zoom'
            : 'centered on DE, north up · pinch or scroll to zoom'}
        </p>
      </div>

      {(props.coverageLayer ||
        (layers.spots && props.mapSpots.length > 0) ||
        props.mufFieldLayer ||
        props.blackout ||
        props.ovationLayer) && (
        <div className="map-legend">
          {props.coverageLayer && (
            <div className="map-legend-row">
              <span className="map-legend-gradient" />
              <span>{layers.coverageBand} reliability from DE · estimate</span>
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
              <span>aurora probability · OVATION nowcast</span>
            </div>
          )}
          {props.blackout && (
            <div className="map-legend-row">
              <span className="map-legend-dot" style={{ background: '#d83a30' }} />
              <span>
                {props.blackout.cls} flare blackout · absorption to ~
                {Math.round(props.blackout.haf)} MHz at subsolar
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
      )}
    </>
  );
}
