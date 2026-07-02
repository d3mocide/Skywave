// Propagation panel (§8): per-band reliability for the selected DX circuit,
// with the §9 validity flags surfaced instead of hidden. The prediction is
// computed once in App and shared with the band-conditions summary.

import { Panel } from './Panel';
import type { CircuitPrediction } from '../lib/propagation/engine';

export function PropagationPanel(props: {
  prediction: CircuitPrediction | null;
  hasCircuit: boolean;
  hasSsn: boolean;
}) {
  const { prediction } = props;

  const engineBadge = prediction && (
    <span
      className={`badge ${prediction.engine === 'estimate' ? 'badge-warn' : 'badge-ok'}`}
      title={
        prediction.engine === 'estimate'
          ? 'P533 WASM engine not built — showing rough climatological estimate'
          : 'ITU-R P.533 monthly-median prediction'
      }
    >
      {prediction.engine === 'estimate' ? 'estimate' : 'P.533'}
    </span>
  );

  return (
    <Panel title="Propagation" badge={engineBadge}>
      {!props.hasCircuit ? (
        <p className="empty">set DE and DX grids to see predictions</p>
      ) : !props.hasSsn ? (
        <p className="empty">waiting for smoothed SSN…</p>
      ) : prediction ? (
        <>
          {prediction.flags.nvis && (
            <p className="flag">
              circuit &lt;300 km — NVIS territory, outside the oblique P.533
              model's validity; no per-band numbers shown
            </p>
          )}
          {prediction.flags.auroral && (
            <p className="flag">
              path crosses the auroral zone — median-model confidence is
              reduced
            </p>
          )}
          <ul className="band-list">
            {prediction.bands.map((b) => (
              <li key={b.band} className="band-row">
                <span className="band-name">{b.band}</span>
                {b.reliability == null ? (
                  <span className="band-na">n/a</span>
                ) : (
                  <>
                    <div className="band-bar">
                      <div
                        className="band-bar-fill"
                        style={{
                          width: `${Math.round(b.reliability * 100)}%`,
                          background:
                            b.reliability > 0.66
                              ? 'var(--good)'
                              : b.reliability > 0.33
                                ? 'var(--fair)'
                                : 'var(--poor)',
                        }}
                      />
                    </div>
                    <span className="band-pct">
                      {Math.round(b.reliability * 100)}%
                    </span>
                  </>
                )}
              </li>
            ))}
          </ul>
          <p className="footnote">
            monthly-median reliability — live conditions can diverge (compare
            SFI/Kp)
          </p>
        </>
      ) : null}
    </Panel>
  );
}
