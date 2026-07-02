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
}

const db = new Dexie('skywave') as Dexie & {
  settings: EntityTable<Settings, 'id'>;
  dxTargets: EntityTable<DxTarget, 'id'>;
  filters: EntityTable<Filters, 'id'>;
};

db.version(1).stores({
  settings: 'id',
  dxTargets: '++id, favorite, createdAt',
  filters: 'id',
});

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
  const [settings, dxTargets, filters] = await Promise.all([
    db.settings.toArray(),
    db.dxTargets.toArray(),
    db.filters.toArray(),
  ]);
  return JSON.stringify(
    { skywaveExport: 1, settings, dxTargets, filters },
    null,
    2,
  );
}

export async function importState(json: string): Promise<void> {
  const parsed = JSON.parse(json);
  if (parsed.skywaveExport !== 1) throw new Error('not a Skywave export');
  await db.transaction('rw', db.settings, db.dxTargets, db.filters, async () => {
    await Promise.all([
      db.settings.clear(),
      db.dxTargets.clear(),
      db.filters.clear(),
    ]);
    await db.settings.bulkAdd(parsed.settings);
    await db.dxTargets.bulkAdd(
      parsed.dxTargets.map((t: DxTarget) => ({ ...t, id: undefined })),
    );
    await db.filters.bulkAdd(parsed.filters);
  });
}

export { db };
