// Sun & CME view (TABS-REDESIGN-PLAN.md Phase E): the CME tracker is the
// hero on the left two-thirds of the grid — heliocentric map, playback
// clock, launch timeline — while the right rail carries the source/context
// datasets: solar disk imagery, the CME catalog + detail card, and the
// active-region table. Still routed through the PaneColumn registry so
// hide/reorder keeps working (UI-UX-PLAN.md Phase 3). Region selection,
// CME selection, and the tracker's view clock are lifted here so wedges,
// timeline markers, catalog rows, and the replay button all stay in sync.

import { useMemo, useState } from 'react';
import { PaneColumn } from './PaneColumn';
import { SunDiskPanel } from './SunDiskPanel';
import { SunRegionsPanel } from './SunRegionsPanel';
import { CMEPanel } from './CMEPanel';
import { CMECatalogPanel } from './CMECatalogPanel';
import type { HelioCme } from './HelioView';
import type { ApiState } from '../hooks/useApi';
import type { CmeAnalysis, SolarActivity, SolarFlare } from '../lib/api';
import { estimateArrival } from '../lib/cme';

export function SunCMEView(props: {
  activity: ApiState<SolarActivity>;
  cmes: ApiState<CmeAnalysis[]>;
  flares: ApiState<SolarFlare[]>;
  now: Date;
}) {
  const [selectedRegion, setSelectedRegion] = useState<number | null>(null);
  const [selectedCme, setSelectedCme] = useState<string | null>(null);
  // Tracker view clock: null = live. Lifted so the catalog's replay button
  // can rewind it too.
  const [viewTime, setViewTime] = useState<Date | null>(null);
  const [playRate, setPlayRate] = useState<number | null>(null);

  const regions = useMemo(
    () =>
      [...(props.activity.data?.regions ?? [])].sort(
        (a, b) => (b.area ?? 0) - (a.area ?? 0),
      ),
    [props.activity.data?.regions],
  );

  // Whole 30-day catalog with arrival estimates, earth-directed first —
  // the tracker, timeline, and catalog all share this one array.
  const rows = useMemo<HelioCme[]>(() => {
    if (!props.cmes.data) return [];
    return props.cmes.data
      .map((cme) => ({ cme, est: estimateArrival(cme) }))
      .sort((a, b) => {
        const ad = a.est?.earthDirected ? 0 : 1;
        const bd = b.est?.earthDirected ? 0 : 1;
        if (ad !== bd) return ad - bd;
        return (
          new Date(b.cme.time21_5).getTime() - new Date(a.cme.time21_5).getTime()
        );
      });
  }, [props.cmes.data]);

  return (
    <PaneColumn
      className="view-dash"
      panes={[
        {
          id: 'cme',
          title: 'CME Tracker & Catalog',
          category: 'optional',
          node: (
            <section className="span-8">
              <CMEPanel
                rows={rows}
                flares={props.flares.data}
                fetchedAt={props.cmes.fetchedAt}
                stale={props.cmes.stale}
                now={props.now}
                viewTime={viewTime}
                onViewTime={setViewTime}
                playRate={playRate}
                onPlayRate={setPlayRate}
                selected={selectedCme}
                onSelect={setSelectedCme}
              />
              <CMECatalogPanel
                rows={rows}
                fetchedAt={props.cmes.fetchedAt}
                stale={props.cmes.stale}
                now={props.now}
                selected={selectedCme}
                onSelect={setSelectedCme}
                regions={regions}
                onSelectRegion={setSelectedRegion}
                onReplay={(t) => {
                  setPlayRate(null);
                  setViewTime(t);
                }}
              />
            </section>
          ),
        },
        {
          id: 'sun',
          title: 'Sun & Active Regions',
          category: 'optional',
          node: (
            <section className="span-4">
              <SunDiskPanel
                activity={props.activity}
                regions={regions}
                selected={selectedRegion}
                onSelect={setSelectedRegion}
              />
              <SunRegionsPanel
                activity={props.activity}
                regions={regions}
                selected={selectedRegion}
                onSelect={setSelectedRegion}
              />
            </section>
          ),
        },
      ]}
    />
  );
}
