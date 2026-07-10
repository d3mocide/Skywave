// Recent flares rail (under Active Regions): the DONKI FLR catalog as a
// compact log, newest first, cross-linked both ways — a flare's region
// selects it on the solar disk, and a flare that produced a catalogued CME
// jumps to that CME in the tracker. The badge tallies the last 24 h so the
// panel reads at a glance like the regions table's flare column.

import { useMemo } from 'react';
import { Panel } from './Panel';
import type { ApiState } from '../hooks/useApi';
import type { SolarFlare, SolarRegion } from '../lib/api';
import type { HelioCme } from './HelioView';
import { cmeKey, noaaRegion } from '../lib/cme';

const MAX_ROWS = 25;

function classTier(classType: string | null): 'x' | 'm' | 'c' {
  const c = classType?.[0]?.toUpperCase();
  return c === 'X' ? 'x' : c === 'M' ? 'm' : 'c';
}

export function FlarePanel(props: {
  flares: ApiState<SolarFlare[]>;
  regions: SolarRegion[];
  rows: HelioCme[];
  now: Date;
  onSelectRegion: (region: number) => void;
  onSelectCme: (id: string) => void;
}) {
  const { data, fetchedAt, stale } = props.flares;
  const { regions, rows, now, onSelectRegion, onSelectCme } = props;

  const flares = useMemo(
    () =>
      [...(data ?? [])]
        .filter((f) => f.peakTime ?? f.beginTime)
        .sort(
          (a, b) =>
            new Date(b.peakTime ?? b.beginTime ?? 0).getTime() -
            new Date(a.peakTime ?? a.beginTime ?? 0).getTime(),
        )
        .slice(0, MAX_ROWS),
    [data],
  );

  // "1X 2M 4C / 24 h" tally, same shape as the regions table's flare column.
  const dayTally = useMemo(() => {
    const cutoff = now.getTime() - 86_400_000;
    const counts = { x: 0, m: 0, c: 0 };
    for (const f of data ?? []) {
      const t = new Date(f.peakTime ?? f.beginTime ?? 0).getTime();
      if (t >= cutoff) counts[classTier(f.classType)]++;
    }
    const parts = [
      counts.c ? `${counts.c}C` : '',
      counts.m ? `${counts.m}M` : '',
      counts.x ? `${counts.x}X` : '',
    ].filter(Boolean);
    return parts.length ? `${parts.join(' ')} / 24 h` : null;
  }, [data, now]);

  return (
    <Panel
      title="Recent Flares"
      fetchedAt={fetchedAt}
      stale={stale}
      badge={
        dayTally ? <span className="badge badge-dim mono">{dayTally}</span> : null
      }
    >
      {flares.length === 0 ? (
        <p className="empty">no flares in the DONKI catalog (30 days)</p>
      ) : (
        <div className="flare-scroll">
          <ul className="flare-list">
            {flares.map((f) => {
              const ts = (f.peakTime ?? f.beginTime)!;
              const ar = noaaRegion(f.activeRegionNum);
              const arOnDisk = ar != null && regions.some((r) => r.region === ar);
              const linked = f.linkedCME
                ? rows.find((r) => r.cme.flare?.flrID === f.flrID)
                : undefined;
              return (
                <li key={f.flrID} className="flare-row">
                  <span className={`flare-class mono fl-${classTier(f.classType)}`}>
                    {f.classType ?? '?'}
                  </span>
                  {f.link ? (
                    <a
                      className="flare-time mono"
                      href={f.link}
                      target="_blank"
                      rel="noopener noreferrer"
                      title="peak time · open in NASA DONKI"
                    >
                      {ts.slice(5, 16).replace('T', ' ')}Z
                    </a>
                  ) : (
                    <span className="flare-time mono" title="peak time">
                      {ts.slice(5, 16).replace('T', ' ')}Z
                    </span>
                  )}
                  {ar != null &&
                    (arOnDisk ? (
                      <button
                        className="cme-ar-link mono"
                        onClick={() => onSelectRegion(ar)}
                        title="highlight this region on the solar disk"
                      >
                        AR {ar}
                      </button>
                    ) : (
                      <span className="dim mono">AR {ar}</span>
                    ))}
                  {linked ? (
                    <button
                      className="chip flare-cme-link"
                      onClick={() => onSelectCme(cmeKey(linked.cme))}
                      title="this flare's eruption is in the CME catalog — select it in the tracker"
                    >
                      CME →
                    </button>
                  ) : (
                    f.linkedCME && (
                      <span
                        className="dim flare-cme-note"
                        title="produced a CME (not in the loaded analyses)"
                      >
                        CME
                      </span>
                    )
                  )}
                </li>
              );
            })}
          </ul>
        </div>
      )}
      <p className="footnote">NASA DONKI flare catalog · M/X flares black out HF on the dayside</p>
    </Panel>
  );
}
