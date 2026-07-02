// DE / DX station info (§8): grid, bearing, distance, sunrise/sunset — all
// astronomical math in UTC (§9). Also home of the JSON export/import escape
// hatch (§9) and DE configuration.

import { useState } from 'react';
import { useLiveQuery } from 'dexie-react-hooks';
import { Panel } from './Panel';
import {
  db,
  DEFAULT_SETTINGS,
  exportState,
  importState,
} from '../lib/db';
import type { LatLon } from '../lib/geo';
import { gridToLatLon, distanceKm, bearingDeg } from '../lib/geo';
import { sunTimes } from '../lib/solar';

function fmtTime(d: Date | null, polar: 'day' | 'night' | null): string {
  if (polar === 'day') return 'polar day';
  if (polar === 'night') return 'polar night';
  return d ? d.toISOString().slice(11, 16) + 'Z' : '—';
}

function StationInfo(props: { label: string; loc: LatLon; now: Date }) {
  const t = sunTimes(props.loc, props.now);
  return (
    <div className="station-info">
      <span className="stat-label">{props.label}</span>
      <span>
        ☀︎↑ {fmtTime(t.sunrise, t.polar)} ☀︎↓ {fmtTime(t.sunset, t.polar)}
      </span>
    </div>
  );
}

export function StationPanel(props: {
  de: LatLon | null;
  dx: LatLon | null;
  dxGrid: string;
  onDxGridChange: (grid: string) => void;
  now: Date;
}) {
  const settings =
    useLiveQuery(() => db.settings.get('settings')) ?? DEFAULT_SETTINGS;
  const [gridDraft, setGridDraft] = useState<string | null>(null);
  const [callDraft, setCallDraft] = useState<string | null>(null);
  const [importError, setImportError] = useState<string | null>(null);

  const gridValue = gridDraft ?? settings.deGrid;
  const gridValid = gridValue === '' || gridToLatLon(gridValue) !== null;

  const save = () => {
    db.settings.put({
      ...settings,
      id: 'settings',
      deGrid: gridDraft ?? settings.deGrid,
      deCallsign: callDraft ?? settings.deCallsign,
    });
    setGridDraft(null);
    setCallDraft(null);
  };

  const doExport = async () => {
    const blob = new Blob([await exportState()], { type: 'application/json' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = 'skywave-profile.json';
    a.click();
    URL.revokeObjectURL(a.href);
  };

  const doImport = (file: File) => {
    file
      .text()
      .then(importState)
      .then(() => setImportError(null))
      .catch((e) => setImportError(String(e)));
  };

  const { de, dx, now } = props;

  return (
    <Panel title="Station">
      <div className="form-row">
        <label>
          call
          <input
            value={callDraft ?? settings.deCallsign}
            onChange={(e) => setCallDraft(e.target.value.toUpperCase())}
            placeholder="N0CALL"
            size={8}
          />
        </label>
        <label>
          DE grid
          <input
            value={gridValue}
            onChange={(e) => setGridDraft(e.target.value.toUpperCase())}
            placeholder="FN31pr"
            size={7}
            className={gridValid ? '' : 'invalid'}
          />
        </label>
        <label>
          DX grid
          <input
            value={props.dxGrid}
            onChange={(e) => props.onDxGridChange(e.target.value.toUpperCase())}
            placeholder="JN58td"
            size={7}
            className={
              props.dxGrid === '' || gridToLatLon(props.dxGrid) ? '' : 'invalid'
            }
          />
        </label>
        {(gridDraft !== null || callDraft !== null) && (
          <button className="chip chip-on" onClick={save} disabled={!gridValid}>
            save
          </button>
        )}
      </div>

      {de && dx && (
        <div className="stat-row">
          <div className="stat">
            <span className="stat-label">distance</span>
            <span className="stat-value">
              {Math.round(distanceKm(de, dx)).toLocaleString()} km
            </span>
          </div>
          <div className="stat">
            <span className="stat-label">bearing (SP)</span>
            <span className="stat-value">{Math.round(bearingDeg(de, dx))}°</span>
          </div>
          <div className="stat">
            <span className="stat-label">bearing (LP)</span>
            <span className="stat-value">
              {Math.round((bearingDeg(de, dx) + 180) % 360)}°
            </span>
          </div>
        </div>
      )}

      {de && <StationInfo label="DE sun" loc={de} now={now} />}
      {dx && <StationInfo label="DX sun" loc={dx} now={now} />}

      <div className="form-row profile-actions">
        <button className="chip" onClick={doExport}>
          export profile
        </button>
        <label className="chip">
          import profile
          <input
            type="file"
            accept="application/json"
            style={{ display: 'none' }}
            onChange={(e) => e.target.files?.[0] && doImport(e.target.files[0])}
          />
        </label>
        {importError && <span className="flag">{importError}</span>}
      </div>
    </Panel>
  );
}
