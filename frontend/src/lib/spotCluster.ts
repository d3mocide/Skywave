// Zoom-aware DX-spot declutter: a pure grid-binning pass over already-
// projected screen coordinates. Screen space is naturally zoom-aware (the
// same great-circle distance covers more pixels as you zoom in), so no
// zoom/scale signal needs to be threaded through from the renderer — this
// runs on whatever positions the caller already computed for the current
// frame/viewport.

export interface ClusterInput<T> {
  x: number;
  y: number;
  item: T;
}

export interface Cluster<T> {
  x: number;
  y: number;
  items: T[];
}

/**
 * Bin items by rounding their screen position to the nearest `cellPx` grid
 * cell. The representative position/order within a cluster is the input
 * order — callers that want "newest first" should sort before calling.
 */
export function clusterSpots<T>(
  points: ClusterInput<T>[],
  cellPx = 16,
): Cluster<T>[] {
  const cells = new Map<string, Cluster<T>>();
  for (const p of points) {
    const key = `${Math.round(p.x / cellPx)},${Math.round(p.y / cellPx)}`;
    const existing = cells.get(key);
    if (existing) {
      existing.items.push(p.item);
    } else {
      cells.set(key, { x: p.x, y: p.y, items: [p.item] });
    }
  }
  return [...cells.values()];
}

/** Most-common key in a cluster (first-seen wins ties) — used to color a
 * merged dot by its majority band group rather than an arbitrary member. */
export function dominantBy<T>(items: T[], keyFn: (item: T) => string): string {
  const counts = new Map<string, number>();
  let best = keyFn(items[0]);
  let bestCount = 0;
  for (const it of items) {
    const k = keyFn(it);
    const c = (counts.get(k) ?? 0) + 1;
    counts.set(k, c);
    if (c > bestCount) {
      bestCount = c;
      best = k;
    }
  }
  return best;
}
