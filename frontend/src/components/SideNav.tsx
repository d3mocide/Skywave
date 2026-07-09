// Left icon rail — panel navigation (UI-UX-PLAN.md Phase 1). Swaps the
// workspace between views instead of stacking every panel on one screen.

import type { LucideIcon } from 'lucide-react';
import { Activity, Radar, Rss, Satellite, Sun } from 'lucide-react';
import type { ViewId } from '../hooks/useHashView';

interface NavItem {
  id: ViewId;
  label: string;
  icon: LucideIcon;
  title: string;
}

const ITEMS: NavItem[] = [
  {
    id: 'overview',
    label: 'Overview',
    icon: Radar,
    title: 'Overview — station config, propagation circuit, and the live map',
  },
  {
    id: 'spaceweather',
    label: 'Space WX',
    icon: Activity,
    title: 'Space Weather — SFI, Kp, SSN, X-ray flux, solar wind, Kp forecast',
  },
  {
    id: 'dxcluster',
    label: 'DX Cluster',
    icon: Rss,
    title: 'DX Cluster — live spots with band/mode filtering',
  },
  {
    id: 'satellites',
    label: 'Satellites',
    icon: Satellite,
    title: 'Satellites — amateur radio pass predictions for your grid',
  },
  {
    id: 'suncme',
    label: 'Sun & CME',
    icon: Sun,
    title: 'Sun & CME — solar disk imagery, sunspot regions, CME tracking',
  },
];

export function SideNav(props: { view: ViewId; onSelect: (v: ViewId) => void }) {
  return (
    <nav className="side-nav" aria-label="Panels">
      {ITEMS.map((it) => {
        const Icon = it.icon;
        const active = props.view === it.id;
        return (
          <button
            key={it.id}
            type="button"
            className={`nav-btn${active ? ' active' : ''}`}
            aria-current={active ? 'page' : undefined}
            title={it.title}
            onClick={() => props.onSelect(it.id)}
          >
            <Icon size={20} strokeWidth={1.75} aria-hidden="true" />
            <span className="nav-label">{it.label}</span>
          </button>
        );
      })}
    </nav>
  );
}
