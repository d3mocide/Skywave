// Band conditions summary strip (§8) — derived from the same P533 output as
// the propagation panel, then degraded by live Kp so a storm shows up even
// though the underlying model is monthly-median.

import { Panel } from './Panel';
import type { CircuitPrediction } from '../lib/propagation/engine';
import type { XrayNow } from '../lib/xray';

function kpPenalty(kp: number | null): number {
  if (kp == null || kp < 4) return 1;
  // Kp 4 → mild, Kp 9 → severe. Coarse on purpose; it's a summary strip.
  return Math.max(0.15, 1 - (kp - 3) * 0.15);
}

export function BandConditions(props: {
  prediction: CircuitPrediction | null;
  kp: number | null;
  /** Live X-ray state, or null while previewing (a flare says nothing
   * about +N hours from now). */
  xray: XrayNow | null;
  /** Non-zero while the map's time scrubber previews a future hour. */
  previewHours: number;
}) {
  const { prediction, kp, xray } = props;
  const penalty = kpPenalty(kp);

  return (
    <Panel
      title="Band Conditions"
      badge={
        <>
          {props.previewHours !== 0 && (
            <span className="badge badge-warn">+{props.previewHours}h preview</span>
          )}
          {kp != null && kp >= 5 && (
            <span className="badge badge-alert">
              Geomagnetic storm — Kp {kp.toFixed(0)}
            </span>
          )}
          {xray?.r && (
            <span
              className="badge badge-alert"
              title="X-ray flare in progress — dayside paths degraded, low bands first"
            >
              {xray.r.label} Blackout
            </span>
          )}
        </>
      }
    >
      {!prediction ? (
        <p className="empty">Needs a DE/DX circuit</p>
      ) : (
        <div className="cond-strip">
          {prediction.bands.map((b) => {
            const r = b.reliability == null ? null : b.reliability * penalty;
            const cls =
              r == null
                ? 'cond-na'
                : r > 0.66
                  ? 'cond-good'
                  : r > 0.33
                    ? 'cond-fair'
                    : 'cond-poor';
            const label =
              r == null ? 'n/a' : r > 0.66 ? 'good' : r > 0.33 ? 'fair' : 'poor';
            return (
              <div key={b.band} className={`cond-cell ${cls}`} title={`${b.band}: ${label}`}>
                <span className="cond-band">{b.band}</span>
                <span className="cond-label">{label}</span>
              </div>
            );
          })}
        </div>
      )}
    </Panel>
  );
}
