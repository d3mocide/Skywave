// Shared panel chrome. Every data panel shows a "last updated" timestamp and
// an explicit staleness badge — cached data is never presented as current
// without one (DESIGN.md §9). Panels collapse to their header (persisted per
// panel) so the operator can keep only what they're working with on screen.

import { useState, type ReactNode } from 'react';

const COLLAPSE_KEY = 'skywave-collapsed-panels';

function loadCollapsed(): string[] {
  try {
    return JSON.parse(localStorage.getItem(COLLAPSE_KEY) ?? '[]');
  } catch {
    return [];
  }
}

export function Panel(props: {
  title: string;
  fetchedAt?: number | null;
  stale?: boolean;
  badge?: ReactNode;
  children: ReactNode;
}) {
  const [collapsed, setCollapsed] = useState(() =>
    loadCollapsed().includes(props.title),
  );

  const toggle = () => {
    const next = !collapsed;
    setCollapsed(next);
    const list = loadCollapsed().filter((t) => t !== props.title);
    if (next) list.push(props.title);
    localStorage.setItem(COLLAPSE_KEY, JSON.stringify(list));
  };

  return (
    <section className={`panel ${collapsed ? 'collapsed' : ''}`}>
      <header className="panel-header">
        <button
          className="panel-toggle"
          onClick={toggle}
          aria-expanded={!collapsed}
          title={collapsed ? 'expand' : 'collapse'}
        >
          <span className={`panel-chevron ${collapsed ? 'closed' : ''}`}>
            ▾
          </span>
          <h2>{props.title}</h2>
        </button>
        <span className="panel-meta">
          {props.badge}
          {props.stale && <span className="badge badge-stale">Stale</span>}
          {props.fetchedAt != null && (
            <span className="timestamp" title="last updated (UTC)">
              {new Date(props.fetchedAt).toISOString().slice(11, 16)}Z
            </span>
          )}
        </span>
      </header>
      {!collapsed && <div className="panel-body">{props.children}</div>}
    </section>
  );
}
