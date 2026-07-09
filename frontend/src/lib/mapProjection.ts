// Which map renderer the Overview view shows — persisted like the layer
// prefs, so a reload keeps the projection you left it on.

export type MapProjection = 'flat' | 'globe';

const KEY = 'skywave-map-projection';

export function loadProjection(): MapProjection {
  const raw = localStorage.getItem(KEY);
  return raw === 'globe' ? 'globe' : 'flat';
}

export function saveProjection(p: MapProjection): void {
  localStorage.setItem(KEY, p);
}
