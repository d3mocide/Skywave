// Active-region interpretation shared by the Sun disk overlay and the
// region detail panel (TABS-REDESIGN-PLAN.md Phase E).

import type { SolarRegion } from './api';

/** Mount Wilson class → flare-risk tier. Delta configurations are the
 * X-flare factories; beta-gamma is elevated; the rest is quiet. */
export function magRisk(magClass: string | null): 'high' | 'elevated' | 'low' {
  const m = (magClass ?? '').toLowerCase();
  if (m.includes('delta')) return 'high';
  if (m.includes('beta-gamma')) return 'elevated';
  return 'low';
}

/** One-line plain-language reading of a Mount Wilson magnetic class. */
export function magClassNote(magClass: string | null): string {
  const m = (magClass ?? '').toLowerCase();
  if (m.includes('delta'))
    return 'opposite polarities sharing one penumbra — the X-flare configuration';
  if (m.includes('beta-gamma'))
    return 'mixed polarities without a clear dividing line — elevated flare risk';
  if (m.includes('gamma'))
    return 'thoroughly mixed polarities — elevated flare risk';
  if (m.includes('beta')) return 'simple bipolar group — modest flare risk';
  if (m.includes('alpha')) return 'unipolar spot group — usually quiet';
  return 'unclassified';
}

/** Compact 24 h flare history, e.g. "3C 1M" — from the NOAA per-region
 * event counts that were previously fetched but never displayed. */
export function flareHistory(r: SolarRegion): string | null {
  const parts: string[] = [];
  if (r.c_xray_events) parts.push(`${r.c_xray_events}C`);
  if (r.m_xray_events) parts.push(`${r.m_xray_events}M`);
  if (r.x_xray_events) parts.push(`${r.x_xray_events}X`);
  return parts.length ? parts.join(' ') : null;
}
