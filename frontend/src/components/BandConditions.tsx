// Band conditions summary strip (§8) — derived from the same P533 output as
// the propagation panel, then degraded by live Kp so a storm shows up even
// though the underlying model is monthly-median.

import { Panel } from './Panel';
import type { CircuitPrediction } from '../lib/propagation/engine';

function kpPenalty(kp: number | null): number {
  if (kp == null || kp < 4) return 1;
  // Kp 4 → mild, Kp 9 → severe. Coarse on purpose; it's a summary strip.
  return Math.max(0.15, 1 - (kp - 3) * 0.15);
}

export function BandConditions(props: {
  prediction: CircuitPrediction | null;
  kp: number | null;
}) {
  const { prediction, kp } = props;
  const penalty = kpPenalty(kp);

  return (
    <Panel
      title="Band Conditions"
      badge={
        kp != null && kp >= 5 ? (
          <span className="badge badge-alert">geomagnetic storm — Kp {kp.toFixed(0)}</span>
        ) : undefined
      }
    >
      {!prediction ? (
        <p className="empty">needs a DE/DX circuit</p>
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
