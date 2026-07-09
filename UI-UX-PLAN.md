# UI/UX Redesign — Tracking Doc

Tracks the phased rework of Skywave's frontend shell, inspired by
[Nexus](https://sourceforge.net/p/nexus-ham-radio/code/ci/main/tree/) (a
Tauri + React ham-radio cockpit). This doc is the working checklist across
sessions — update it as phases land instead of re-deriving scope each time.

**Companion doc:** [DESIGN.md](DESIGN.md) is the system architecture record
(data sources, offline strategy, propagation engine). This doc is scoped to
frontend shell/UX only and doesn't duplicate it — offline/staleness rules
referenced below always mean DESIGN.md §9, not a new mechanism.

## Why / source material

Nexus is a full operating cockpit (rig control, FT8 decode, logging) — most
of its feature surface doesn't apply to Skywave, which has no rig control or
digital-mode decoding. What's worth taking is the **shell/navigation/panel
structure and the globe-rendering technique**, not the operating features.
Reviewed directly from source (via SourceForge, commit `5a0f75`/`34ecf6`):
`ui/src/App.tsx`, `components/TopBar.tsx`, `components/ModeNav.tsx`,
`components/connect/panes.tsx`, `components/MapView.tsx`, `mapGeo.ts`.

### Explicitly not porting

TX/Tune/Stop-TX/Hold-Tx controls, FT1/DX1/FT4/FT8 tier toggles, slot clock,
TX-cycle controls, waterfall layout toggle, multi-window pop-out, chat/
messaging UI, logbook/awards/contest features. These are rig-control /
operating-cockpit features — out of scope per DESIGN.md's own feature list.

## Current Skywave shape (baseline, for reference)

Single screen, no routing: thin one-row `.topbar` + 3-column CSS grid
(`App.tsx`) — left column (Station/Propagation/BandConditions), center
Leaflet `WorldMap`, right column (SpaceWeather/Sun/DXCluster/CME/Satellite),
all always mounted, collapsible via `Panel.tsx` chevrons. No icon nav, no
per-view layout, map is `react-leaflet` (`worldCopyJump` + `TileLayer`).

---

## Phase 0 — Decisions (small, do first)

- [x] View routing approach: **URL hash** (`useHashView.ts`) — no router
      dependency, `hashchange` also covers back/forward for free
- [x] Nav IA / icon list finalized at **5 views**: Overview, Space Weather,
      DX Cluster, Satellites, Sun & CME. Dropped the originally-sketched
      separate "Station/Settings" view — `StationPanel` bundles DE/DX
      targeting with sun times and export/import as one cohesive unit, and
      DE/DX grid selection is the app's core loop input, so it stays on
      Overview rather than being split across two views. Revisit if a
      dedicated Settings view earns its keep later (e.g. once Phase 2/3
      add more global config).
- [x] `mapFocus` toggle: **kept**, scoped to the Overview view only (the
      topbar button now only renders when `view === 'overview'` — it has
      no meaning on the other four single/dual-panel views)

## Phase 1 — App shell + panel nav ✅ done

- [x] `SideNav.tsx` — icon rail (lucide-react icons), tooltips via native
      `title`, active-state left accent bar. No grouped items / settings
      gear needed — Skywave's nav is flat (5 views), unlike Nexus's
      operate-mode grouping which doesn't apply here.
- [x] Restructured `App.tsx` into shell: topbar + `.shell` (`SideNav` +
      `.workspace`), workspace content chosen by a switch over `view`
- [x] View state + hash router — no new routing dependency
- [x] Split existing panels into views:
  - **Overview** — WorldMap + StationPanel + PropagationPanel +
    BandConditions (today's default core loop; right column dropped, map
    now gets the full remaining width instead of being squeezed to `1fr`
    between two fixed 340px/380px columns)
  - **Space Weather** — SpaceWeatherPanel, full width (`.view-pane`)
  - **DX Cluster** — DXClusterPanel, full width
  - **Satellites** — SatellitePanel, full width (was cramped in the old
    380px right column)
  - **Sun & CME** — SunPanel + CMEPanel side by side via `.view-pane-grid`
    (CMEPanel includes HelioView internally, no separate view needed)
- [x] `styles.css`: added `.shell` / `.side-nav` / `.nav-btn` / `.workspace`
      / `.view-pane` / `.view-pane-grid`; `.panel` chrome untouched;
      `.layout` grid dropped its third (380px) column now that the right
      column's panels moved to their own views
- [x] Verified offline staleness badges still render correctly per-view —
      confirmed live via Playwright against a backend-less dev server: all
      panels degrade to their empty/waiting states, zero React crashes
      (only network 500s from the absent backend, expected)
- [x] Added `lucide-react` dependency for nav icons (matches Nexus's icon
      choice; small, tree-shakeable, zero other runtime deps)

## Phase 2 — Top bar consolidation ✅ done

- [x] Contextual controls area in the top bar, shown/hidden per view — the
      `TimeScrubber` and the map-focus toggle both check `view ===
      'overview'` inline (`App.tsx` isn't split into a separate `TopBar`
      component yet — didn't need to be, since it's one small conditional
      block, not a growing prop surface like Nexus's `hideX` flags. Revisit
      extraction if Phase 3+ adds more per-view chrome.)
- [x] Moved the map's time-scrubber into the top bar: new
      `TimeScrubber.tsx` (play/pause, "now", range, label — same behavior
      as before, just relocated), shown only on Overview. Removed the old
      `.map-scrub` floating overlay and its `playing` state from
      `WorldMap.tsx` entirely; `WorldMap` now takes a `previewing: boolean`
      prop instead of owning the scrub UI, since several of its layers
      (OVATION aurora, MUF field, blackout, spot/fof2 marker opacity)
      branch on preview state independent of the control itself.
- [x] Aggregate staleness badge (`anyStale`, OR of all ten `ApiState.stale`
      flags) in the top bar, visible on every view — reuses the existing
      `.badge.badge-stale` class from `Panel.tsx` rather than inventing a
      second staleness mechanism
- [x] Theme decision: **staying single dark theme.** Nexus's 3-theme system
      (dark/light/amber) rides on an OKLCH token architecture that's a
      separate, sizeable effort (its own `DESIGN.md` Stage A) — not part of
      what was asked for (panel nav, top bar, globe) and not worth the
      scope creep here. Revisit only if a light/amber theme becomes an
      explicit ask.
- [x] Verified live via Playwright: scrubber updates the time label and the
      map's terminator/sun position, "+12H PREVIEW" badges in
      Propagation/Band Conditions still fire correctly, scrubber is absent
      on non-Overview views, no React crashes.

## Phase 3 — Pane registry

- [ ] `PaneDef` type: `id`, `title`, `category` (`core` / `optional` /
      `advanced`), render fn — mirrors Nexus's `core`/`b2`/`b3` categories
- [ ] Migrate Overview's panels into registry entries
- [ ] Pane picker UI (show/hide, reorder), persisted in Dexie (new table or
      extend `settings`)
- [ ] Fallback-to-basic-description behavior when a pane has no live data
      must route through the **existing** stale/last-known handling
      (`Panel.tsx` badge) — don't build a second staleness mechanism

## Phase 4 — Globe view

Reference: Nexus's globe is **Canvas2D + d3-geo**, not WebGL. Confirmed
`mapGeo.ts` source (see below) — directly portable.

- [ ] Add `d3-geo` dependency (not currently in `package.json` — Skywave
      only has `leaflet`/`react-leaflet` today); add `world-atlas` (topojson
      land data) for the canvas basemap — Nexus's `world-atlas.d.ts` implies
      the same package
- [ ] `GlobeMap.tsx` — Canvas2D renderer using the projection helper below
- [ ] Port layers as canvas draw functions (currently Leaflet layers in
      `WorldMap.tsx`): land/coastline basemap, day/night terminator,
      band-coverage heatmap, DX spot dots, ionosonde MUF dots, aurora oval,
      great-circle DE↔DX path, own-station marker
- [ ] Interactions: drag-to-rotate (globe), wheel-zoom, click hit-testing
      reusing the existing `onSelectDx` callback
- [ ] Projection toggle: **Flat** (keep existing Leaflet) / **Globe**
      (new canvas, `geoOrthographic`) / **Beam** (new canvas,
      `geoAzimuthalEquidistant` — bearing-and-distance centered on DE, high
      value on its own for "which way do I point my beam")
- [ ] Visual treatment lift (technique, not code — reimplement against our
      own layer data): star field backdrop, radial-gradient lit hemisphere,
      limb darkening, atmosphere halo just outside the disc edge
- [ ] Redraw-on-change only (matches current event-driven Leaflet
      re-renders); an animated fx overlay canvas (e.g. flare rays) is
      optional/stretch, not required for parity
- [ ] Open call: does Leaflet get fully replaced by the canvas renderer
      eventually (drop a dependency), or does Flat mode stay Leaflet
      permanently? Defer decision to end of Phase 4, once the canvas
      renderer's basemap quality is proven out

### Projection math reference (from Nexus `mapGeo.ts`)

Three interchangeable d3-geo projections, selected by `kind`:

```ts
export function makeProjection(
  kind: Projection,
  center: LatLon | null,
  width: number,
  height: number,
  view?: MapView3,
): GeoProjection {
  const zoom = view?.zoom ?? 1
  const panX = view?.panX ?? 0
  const panY = view?.panY ?? 0
  const c = center ?? { lat: 0, lon: 0 }

  if (kind === 'globe') {
    const radius = (Math.min(width, height) / 2) * 0.92 * zoom
    const rot = view?.rotate ?? [-c.lon, -c.lat]
    return geoOrthographic()
      .rotate(rot)
      .clipAngle(90)
      .translate([width / 2 + panX, height / 2 + panY])
      .scale(radius)
  }

  if (kind === 'world') {
    const p = geoEquirectangular().fitSize([width, height], { type: 'Sphere' })
    if (zoom !== 1 || panX || panY) {
      const s0 = p.scale()
      const [tx, ty] = p.translate()
      p.scale(s0 * zoom)
      p.translate([width / 2 + (tx - width / 2) * zoom + panX,
                   height / 2 + (ty - height / 2) * zoom + panY])
    }
    return p
  }

  // AEQD beam map — true bearing/distance from DE
  const radius = (Math.min(width, height) / 2) * 0.94 * zoom
  return geoAzimuthalEquidistant()
    .rotate([-c.lon, -c.lat])
    .clipAngle(180)
    .translate([width / 2 + panX, height / 2 + panY])
    .scale(radius / Math.PI)
}

export function project(proj: GeoProjection, ll: LatLon): [number, number] | null {
  const p = proj([ll.lon, ll.lat])
  if (!p || !Number.isFinite(p[0]) || !Number.isFinite(p[1])) return null
  return [p[0], p[1]]
}
```

Notes for our port:

- `globe` = `geoOrthographic`, clipped to the visible hemisphere
  (`clipAngle(90)`), rotated so DE faces the "camera"
  (`rotate = [-lon, -lat]` of center). Drag-to-rotate just updates
  `view.rotate` and re-projects.
- `world` = `geoEquirectangular`, fit to the canvas size — this is the
  "Flat" mode; roughly what Leaflet already gives us, so low priority to
  duplicate unless we're retiring Leaflet.
- `beam` (AEQD) = azimuthal-equidistant centered on DE, `clipAngle(180)`
  (whole globe, antipode at the rim) — distances from center are
  true-to-scale, which is exactly a ham radio "great-circle bearing map."
  This one has standalone value even before the full 3-D globe lands.
- Skywave already has great-circle math in `frontend/src/lib/geo.ts`
  (`distanceKm`, grid↔lat/lon) — reuse that, no need to duplicate via
  d3-geo's own geodesic helpers.

---

## Change log

- 2026-07-09 — Doc created; Phases 0–4 scoped from Nexus source review.
- 2026-07-09 — Phase 0 decisions locked, Phase 1 (app shell + panel nav)
  implemented and verified in-browser: `SideNav.tsx`, `useHashView.ts`,
  `App.tsx` restructured around `.shell`/`.workspace`, five routed views
  live.
- 2026-07-09 — Phase 2 (top bar consolidation) implemented and verified:
  `TimeScrubber.tsx` moved out of the map into the top bar, `WorldMap.tsx`
  simplified to a `previewing` boolean, aggregate staleness badge added,
  decided to stay single-theme for now. Next up: Phase 3 (pane registry).
