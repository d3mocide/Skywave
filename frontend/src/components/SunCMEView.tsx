// Sun & CME view (TABS-REDESIGN-PLAN.md Phase E): three panes on the
// dashboard grid — big disk imagery, region detail + table, CME tracker —
// still routed through the PaneColumn registry so hide/reorder keeps
// working (UI-UX-PLAN.md Phase 3). Region selection is lifted here so the
// disk overlay and the regions panel stay in sync.

import { useMemo, useState } from 'react';
import { PaneColumn } from './PaneColumn';
import { SunDiskPanel } from './SunDiskPanel';
import { SunRegionsPanel } from './SunRegionsPanel';
import { CMEPanel } from './CMEPanel';
import type { ApiState } from '../hooks/useApi';
import type { CmeAnalysis, SolarActivity } from '../lib/api';

export function SunCMEView(props: {
  activity: ApiState<SolarActivity>;
  cmes: ApiState<CmeAnalysis[]>;
  now: Date;
}) {
  const [selected, setSelected] = useState<number | null>(null);

  const regions = useMemo(
    () =>
      [...(props.activity.data?.regions ?? [])].sort(
        (a, b) => (b.area ?? 0) - (a.area ?? 0),
      ),
    [props.activity.data?.regions],
  );

  return (
    <PaneColumn
      className="view-dash"
      panes={[
        {
          id: 'sun',
          title: 'Sun',
          category: 'optional',
          node: (
            <section className="span-5">
              <SunDiskPanel
                activity={props.activity}
                regions={regions}
                selected={selected}
                onSelect={setSelected}
              />
            </section>
          ),
        },
        {
          id: 'regions',
          title: 'Active Regions',
          category: 'optional',
          node: (
            <section className="span-3">
              <SunRegionsPanel
                activity={props.activity}
                regions={regions}
                selected={selected}
                onSelect={setSelected}
              />
            </section>
          ),
        },
        {
          id: 'cme',
          title: 'CME Tracker',
          category: 'optional',
          node: (
            <section className="span-4">
              <CMEPanel cmes={props.cmes} now={props.now} />
            </section>
          ),
        },
      ]}
    />
  );
}
