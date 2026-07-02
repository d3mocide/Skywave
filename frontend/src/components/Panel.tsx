// Shared panel chrome. Every data panel shows a "last updated" timestamp and
// an explicit staleness badge — cached data is never presented as current
// without one (DESIGN.md §9).

import type { ReactNode } from 'react';

export function Panel(props: {
  title: string;
  fetchedAt?: number | null;
  stale?: boolean;
  badge?: ReactNode;
  children: ReactNode;
}) {
  return (
    <section className="panel">
      <header className="panel-header">
        <h2>{props.title}</h2>
        <span className="panel-meta">
          {props.badge}
          {props.stale && <span className="badge badge-stale">stale</span>}
          {props.fetchedAt != null && (
            <span className="timestamp" title="last updated (UTC)">
              {new Date(props.fetchedAt).toISOString().slice(11, 16)}Z
            </span>
          )}
        </span>
      </header>
      <div className="panel-body">{props.children}</div>
    </section>
  );
}
