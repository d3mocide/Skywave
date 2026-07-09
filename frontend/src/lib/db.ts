// All user state lives in the browser (DESIGN.md §5) — Dexie over IndexedDB.
// No backend sync in v1; the escape hatch is manual JSON export/import (§9).

import Dexie, { type EntityTable } from 'dexie';

export interface Settings {
  id: 'settings';
  deCallsign: string;
  deGrid: string; // Maidenhead
  theme: 'dark' | 'light';
}

export interface DxTarget {
  id?: number;
  label: string;
  grid: string;
  favorite: boolean;
  createdAt: number;
}

export interface Filters {
  id: 'filters';
  bands: string[]; // empty = all
  modes: string[]; // empty = all
  /** Hide spots on bands the estimator gives ~0% reliability from DE. */
  workableOnly?: boolean;
}

/** Trailing window of DX spots for the cluster view's activity charts.
 * The /api/spots payload only carries the recent tail, so the 2 h band×time
 * heatmap must accumulate client-side (TABS-REDESIGN-PLAN.md Phase C).
 * This is a data cache, not user state — deliberately excluded from
 * exportState. */
export interface SpotHistoryRow {
  id: string; // spotter|dx_call|freq|spot_time — idempotent re-put key
  received_at: number; // unix seconds
  freq_khz: number;
  dx_call: string;
  spotter: string;
  comment: string;
}

/** Per-pane visibility/order for the pane registry (UI-UX-PLAN.md Phase 3).
 * `id` is the pane's registry id (e.g. 'station', 'sun'), not a table
 * autoincrement — one row per pane the user has touched. */
export interface PaneConfig {
  id: string;
  hidden: boolean;
  order: number;
}

const db = new Dexie('skywave') as Dexie & {
  settings: EntityTable<Settings, 'id'>;
  dxTargets: EntityTable<DxTarget, 'id'>;
  filters: EntityTable<Filters, 'id'>;
  paneConfig: EntityTable<PaneConfig, 'id'>;
  spotHistory: EntityTable<SpotHistoryRow, 'id'>;
};

db.version(1).stores({
  settings: 'id',
  dxTargets: '++id, favorite, createdAt',
  filters: 'id',
});

db.version(2).stores({
  settings: 'id',
  dxTargets: '++id, favorite, createdAt',
  filters: 'id',
  paneConfig: 'id',
});

db.version(3).stores({
  settings: 'id',
  dxTargets: '++id, favorite, createdAt',
  filters: 'id',
  paneConfig: 'id',
  spotHistory: 'id, received_at',
});

export const SPOT_HISTORY_WINDOW_S = 2 * 3600;

/** Merge the latest spots payload into the trailing window and prune. */
export async function accumulateSpotHistory(
  spots: {
    spotter: string;
    freq_khz: number;
    dx_call: string;
    comment: string;
    spot_time: string | null;
    received_at: number;
  }[],
): Promise<void> {
  const rows: SpotHistoryRow[] = spots.map((s) => ({
    id: `${s.spotter}|${s.dx_call}|${s.freq_khz.toFixed(1)}|${s.spot_time ?? s.received_at}`,
    received_at: s.received_at,
    freq_khz: s.freq_khz,
    dx_call: s.dx_call,
    spotter: s.spotter,
    comment: s.comment,
  }));
  const cutoff = Date.now() / 1000 - SPOT_HISTORY_WINDOW_S;
  await db.transaction('rw', db.spotHistory, async () => {
    await db.spotHistory.bulkPut(rows);
    await db.spotHistory.where('received_at').below(cutoff).delete();
  });
}

export const DEFAULT_SETTINGS: Settings = {
  id: 'settings',
  deCallsign: '',
  deGrid: '',
  theme: 'dark',
};

export const DEFAULT_FILTERS: Filters = { id: 'filters', bands: [], modes: [] };

/**
 * IndexedDB isn't guaranteed persistent (iOS Safari can evict after
 * inactivity — §9). Request persistence on first launch; a wiped cache is
 * handled as "needs re-sync", not a crash.
 */
export async function requestPersistence(): Promise<boolean> {
  if (navigator.storage?.persist) {
    return navigator.storage.persist();
  }
  return false;
}

/** Full local state export — the multi-device escape hatch (§9). */
export async function exportState(): Promise<string> {
  const [settings, dxTargets, filters, paneConfig] = await Promise.all([
    db.settings.toArray(),
    db.dxTargets.toArray(),
    db.filters.toArray(),
    db.paneConfig.toArray(),
  ]);
  return JSON.stringify(
    { skywaveExport: 1, settings, dxTargets, filters, paneConfig },
    null,
    2,
  );
}

export async function importState(json: string): Promise<void> {
  const parsed = JSON.parse(json);
  if (parsed.skywaveExport !== 1) throw new Error('not a Skywave export');
  await db.transaction(
    'rw',
    db.settings,
    db.dxTargets,
    db.filters,
    db.paneConfig,
    async () => {
      await Promise.all([
        db.settings.clear(),
        db.dxTargets.clear(),
        db.filters.clear(),
        db.paneConfig.clear(),
      ]);
      await db.settings.bulkAdd(parsed.settings);
      await db.dxTargets.bulkAdd(
        parsed.dxTargets.map((t: DxTarget) => ({ ...t, id: undefined })),
      );
      await db.filters.bulkAdd(parsed.filters);
      // Older exports predate the pane registry (Phase 3) — tolerate absence.
      if (parsed.paneConfig) await db.paneConfig.bulkAdd(parsed.paneConfig);
    },
  );
}

export { db };
