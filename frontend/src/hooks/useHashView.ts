// URL hash routing between panel views. Deliberately not a routing library —
// five fixed views, no nesting, no params. `hashchange` also fires on
// back/forward, so the browser's history buttons work for free.

import { useCallback, useEffect, useState } from 'react';

export type ViewId = 'overview' | 'spaceweather' | 'dxcluster' | 'satellites' | 'suncme';

const VIEWS: ViewId[] = ['overview', 'spaceweather', 'dxcluster', 'satellites', 'suncme'];
const DEFAULT_VIEW: ViewId = 'overview';

function parseHash(): ViewId {
  const h = window.location.hash.slice(1) as ViewId;
  return VIEWS.includes(h) ? h : DEFAULT_VIEW;
}

export function useHashView(): [ViewId, (v: ViewId) => void] {
  const [view, setView] = useState<ViewId>(parseHash);

  useEffect(() => {
    const onHashChange = () => setView(parseHash());
    window.addEventListener('hashchange', onHashChange);
    return () => window.removeEventListener('hashchange', onHashChange);
  }, []);

  const navigate = useCallback((v: ViewId) => {
    window.location.hash = v;
  }, []);

  return [view, navigate];
}
