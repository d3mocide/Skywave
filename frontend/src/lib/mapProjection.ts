// Which map renderer the Overview view shows — persisted like the layer
// prefs, so a reload keeps the projection you left it on.

export type MapProjection = 'flat' | 'globe' | 'beam';

const KEY = 'skywave-map-projection';
const VALID: MapProjection[] = ['flat', 'globe', 'beam'];

export function loadProjection(): MapProjection {
  const raw = localStorage.getItem(KEY);
  return VALID.includes(raw as MapProjection) ? (raw as MapProjection) : 'flat';
}

export function saveProjection(p: MapProjection): void {
  localStorage.setItem(KEY, p);
}
