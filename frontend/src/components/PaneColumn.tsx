// Pane registry (UI-UX-PLAN.md Phase 3): renders a set of panels with a
// user-customizable show/hide + order, persisted in Dexie. `core` panes
// can be reordered but not hidden; `optional` panes can be both. This is
// deliberately not Nexus's basic()/expert() dual-render pane system — every
// Skywave panel already degrades to its own empty/waiting state via
// Panel.tsx's staleness badge, so there's no second fallback tier to build.

import { Fragment, useState, type ReactNode } from 'react';
import { useLiveQuery } from 'dexie-react-hooks';
import { db } from '../lib/db';

export interface PaneDef {
  id: string;
  title: string;
  category: 'core' | 'optional';
  node: ReactNode;
}

export function PaneColumn(props: { panes: PaneDef[]; className: string }) {
  const configs = useLiveQuery(() => db.paneConfig.toArray()) ?? [];
  const [customizing, setCustomizing] = useState(false);

  const configFor = (id: string) => configs.find((c) => c.id === id);

  const ordered = [...props.panes].sort((a, b) => {
    const oa = configFor(a.id)?.order ?? props.panes.indexOf(a);
    const ob = configFor(b.id)?.order ?? props.panes.indexOf(b);
    return oa - ob;
  });

  const visible = ordered.filter(
    (p) => p.category === 'core' || !configFor(p.id)?.hidden,
  );

  const move = (id: string, dir: -1 | 1) => {
    const idx = ordered.findIndex((p) => p.id === id);
    const swapIdx = idx + dir;
    if (swapIdx < 0 || swapIdx >= ordered.length) return;
    const a = ordered[idx];
    const b = ordered[swapIdx];
    const aOrder = configFor(a.id)?.order ?? idx;
    const bOrder = configFor(b.id)?.order ?? swapIdx;
    db.paneConfig.put({ id: a.id, hidden: configFor(a.id)?.hidden ?? false, order: bOrder });
    db.paneConfig.put({ id: b.id, hidden: configFor(b.id)?.hidden ?? false, order: aOrder });
  };

  const toggleHidden = (id: string) => {
    const c = configFor(id);
    db.paneConfig.put({
      id,
      hidden: !(c?.hidden ?? false),
      order: c?.order ?? props.panes.findIndex((p) => p.id === id),
    });
  };

  return (
    <div className={props.className}>
      <div className="pane-customize-row">
        <button
          type="button"
          className="chip pane-customize"
          onClick={() => setCustomizing((v) => !v)}
        >
          {customizing ? 'done' : 'customize'}
        </button>
        {customizing && (
          <div className="pane-customize-list">
            {ordered.map((p, i) => {
              const hidden = p.category === 'optional' && !!configFor(p.id)?.hidden;
              return (
                <div key={p.id} className="pane-customize-item">
                  <span className={hidden ? 'dim' : ''}>{p.title}</span>
                  <span className="pane-customize-actions">
                    {p.category === 'optional' && (
                      <button
                        type="button"
                        className="chip"
                        onClick={() => toggleHidden(p.id)}
                      >
                        {hidden ? 'show' : 'hide'}
                      </button>
                    )}
                    <button
                      type="button"
                      className="chip"
                      disabled={i === 0}
                      onClick={() => move(p.id, -1)}
                      title="move up"
                    >
                      ↑
                    </button>
                    <button
                      type="button"
                      className="chip"
                      disabled={i === ordered.length - 1}
                      onClick={() => move(p.id, 1)}
                      title="move down"
                    >
                      ↓
                    </button>
                  </span>
                </div>
              );
            })}
          </div>
        )}
      </div>
      {visible.map((p) => (
        <Fragment key={p.id}>{p.node}</Fragment>
      ))}
    </div>
  );
}
