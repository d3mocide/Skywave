// Shared layer visibility/prefs for both map renderers (WorldMap/Flat and
// GlobeMap). One localStorage key so toggling a layer off in one view
// keeps it off in the other — they're two projections of the same data,
// not two independent settings surfaces.

export interface LayerPrefs {
  coverage: boolean;
  coverageBand: string;
  spots: boolean;
  muf: boolean;
  mufField: boolean;
  aurora: boolean;
  blackout: boolean;
  /** PSKReporter reception reports for the operator's own call. */
  psk: boolean;
}

export const DEFAULT_LAYERS: LayerPrefs = {
  coverage: true,
  coverageBand: '20m',
  spots: true,
  muf: false,
  mufField: false,
  aurora: true,
  blackout: true,
  psk: true,
};

const LAYERS_KEY = 'skywave-map-layers';

export function loadLayers(): LayerPrefs {
  try {
    const raw = localStorage.getItem(LAYERS_KEY);
    return raw ? { ...DEFAULT_LAYERS, ...JSON.parse(raw) } : DEFAULT_LAYERS;
  } catch {
    return DEFAULT_LAYERS;
  }
}

export function saveLayers(layers: LayerPrefs): void {
  localStorage.setItem(LAYERS_KEY, JSON.stringify(layers));
}
