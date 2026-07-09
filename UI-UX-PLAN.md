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

## Phase 3 — Pane registry ✅ done

- [x] `PaneDef` type: `id`, `title`, `category`, `node` (`components/
      PaneColumn.tsx`). Simplified to two categories, **`core` / `optional`**
      — dropped Nexus's third `advanced`/no-network tier. Nexus needed three
      because Connect has ~19 candidate panes; Skywave's largest pane set is
      3 (Overview) or 2 (Sun & CME), so a `core`-can't-hide vs.
      `optional`-can-hide split covers it without a category nobody would
      ever populate.
- [x] Also dropped Nexus's `basic()`/`expert()` dual-render split — every
      Skywave panel already renders its own empty/waiting/stale state via
      `Panel.tsx`'s badge, so there's no second data-fallback tier to wire
      up. `PaneDef.node` is a single rendered element, not two render fns.
- [x] Applied the registry only where it does something: **Overview**'s
      left column (Station/Propagation/Band Conditions — all `core`,
      reorderable but not hideable, since they're the app's central loop)
      and **Sun & CME** (both `optional` — hideable and reorderable). Left
      Space Weather/DX Cluster/Satellites as plain single-panel renders;
      wrapping a lone panel in a picker with nothing to pick would be
      abstraction for its own sake.
- [x] Show/hide + reorder UI (`PaneColumn`'s "customize" control: ↑/↓ move
      buttons, hide/show for optional panes), persisted in a new Dexie
      `paneConfig` table (`{ id, hidden, order }`, `db.ts` version 2).
      Included in `exportState`/`importState` — older exports without it
      tolerated as empty.
- [x] Staleness handling untouched — `PaneColumn` only controls visibility/
      order, every pane's `node` is the same component from Phase 1/2
      rendering its own state exactly as before.
- [x] Verified live via Playwright: reordered Overview's panes (moved Band
      Conditions to the top), hid the CME Tracker pane on Sun & CME, then
      reloaded the page and confirmed both choices persisted through
      IndexedDB. No React crashes.

## Phase 4 — Globe view ✅ done

Reference: Nexus's globe is **Canvas2D + d3-geo**, not WebGL. Confirmed
`mapGeo.ts` source (see below) — directly portable.

- [x] Added `d3-geo`, `topojson-client`, `world-atlas` (+ `@types/*`) —
      `world-atlas`'s bundled `land-110m.json` (56KB) for the basemap, low
      enough resolution to bundle directly rather than fetch
- [x] `GlobeMap.tsx` — Canvas2D renderer, `geoOrthographic` projection
      (single-projection scope — see "Beam" note below)
- [x] **Extracted `hooks/useMapLayers.ts`** before writing GlobeMap: all the
      layer computation that used to live inside `WorldMap.tsx` (terminator,
      subsolar point, great-circle paths, the four raster layers, spot/MUF
      station lists) moved into one hook consumed by *both* renderers. This
      wasn't in the original plan but became necessary — without it, Flat
      and Globe would each carry their own copy of ~150 lines of layer logic
      with a real risk of silently drifting apart on what "coverage layer
      on" means. `WorldMap.tsx` shrank by about a third in the process.
- [x] **Full raster-layer parity**, not just the vector layers originally
      scoped: coverage heatmap, OVATION aurora, interpolated MUF field, and
      flare blackout all render on the globe, not just Flat. Made possible
      by extending the four `render*()` functions (`coverage.ts`,
      `aurora.ts`, `mufmap.ts`, `blackout.ts`) to return the raw `ImageData`
      alongside the PNG data URL (new shared `lib/mercRaster.ts`), so the
      globe can inverse-project each on-screen pixel to a (lat, lon) and
      sample the *same* already-computed raster Leaflet uses — no
      duplicated science, no second reliability/interpolation
      implementation to keep in sync.
      - Composited into an offscreen canvas and `drawImage()`-ed onto the
        main context (not `putImageData` directly — that ignores both the
        DPR transform and the sphere clip region, both of which matter
        here).
      - Same z-order as Flat: coverage → terminator → (OVATION + MUF field
        + blackout, combined) → vector aurora-ring fallback.
- [x] Port layers as canvas draw functions: land/coastline basemap
      (topojson → `geoPath`), graticule (`geoGraticule10`, globe-only —
      Flat has no lat/lon grid), day/night terminator, band-coverage
      heatmap, DX spot dots, ionosonde MUF dots, aurora oval (both OVATION
      raster and the vector dipole-ring fallback), great-circle DE↔DX
      path (short + long), own-station + DX markers, subsolar point
- [x] Interactions: drag-to-rotate (pointer events, linear sensitivity
      `k = 75/radius`, latitude clamped to ±90° so it can't flip over a
      pole), wheel-zoom (native non-passive listener — React's synthetic
      `onWheel` can't `preventDefault()`), click-to-pick reusing
      `onSelectDx` (spot-dot hit-test first via cached screen positions,
      then falls through to `projection.invert()` for a bare-map click),
      right-click always picks (matches Flat's "right-click always works")
- [x] Layer prefs (`lib/mapLayers.ts`, extracted from `WorldMap.tsx`) are
      **shared** between Flat and Globe via one localStorage key — turning
      off a layer in one view keeps it off in the other; they're two
      projections of the same data, not two independent settings surfaces
- [x] Visual treatment: star field backdrop (generated once at module load,
      not re-seeded per mount), radial-gradient lit-hemisphere sphere base
      (independent of the real terminator — a stylistic 3-D cue, not
      astronomical data), limb darkening, atmosphere halo outside the disc
      edge, thin rim stroke
- [x] Redraw-on-change only, no animation loop — rotate/zoom go through
      React state, coalesced to one paint per frame; no separate fx overlay
      canvas (that was already flagged optional/stretch)
- [x] **Scoped down**: only `geoOrthographic` (Globe) shipped alongside
      Leaflet (Flat). The `geoAzimuthalEquidistant` "Beam" projection
      (bearing/distance-from-DE — high standalone value, noted in the PR
      description) is **not** in this pass; the projection toggle
      (`lib/mapProjection.ts`) is a simple two-way switch today, but
      `GlobeMap`'s `projection` is computed from one small `useMemo` — a
      third mode reusing the same canvas/interaction plumbing is a small
      addition later, not a rewrite.
- [x] Verified live via Playwright: land basemap renders recognizable
      continents at the correct positions, DE/DX markers and great-circle
      short+long paths land exactly where the Flat map/StationPanel's
      bearing numbers say they should, subsolar point tracks real UTC time,
      terminator visible, drag-rotate and wheel-zoom both work, click-to-pick
      correctly resolved a clicked point to a grid square, layer toggles
      shared with Flat, resize (via the map-focus toggle) and Overview
      unmount/remount (navigating away and back) both survive cleanly with
      no console errors.
- [x] Decided: **Leaflet stays** for Flat rather than being replaced —
      the canvas renderer is additive, not a migration. Revisit only if
      Flat mode itself ever needs the topojson basemap's offline
      characteristics (no tile server dependency).

**Known follow-up (not blocking):** the production JS bundle crossed
Vite's 500KB warning threshold with `d3-geo` + the bundled land topology
added (~490KB → ~580KB minified). Code-splitting `GlobeMap` behind a
dynamic `import()` so Flat-only users don't pay for it is a reasonable
later optimization; not done here to keep this PR's scope to the
UI/UX rework itself.

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
  decided to stay single-theme for now.
- 2026-07-09 — Phase 3 (pane registry) implemented and verified:
  `PaneColumn.tsx` + a Dexie `paneConfig` table give Overview's core panes
  and Sun & CME's optional panes user-controlled show/hide + reorder,
  right-sized down from Nexus's 3-category/dual-render system since
  Skywave's pane counts per view are much smaller.
- 2026-07-09 — Phase 4 (globe view) implemented and verified: `GlobeMap.tsx`
  (Canvas2D + d3-geo `geoOrthographic`), with full raster-layer parity
  (coverage/aurora/MUF-field/blackout) via a new `lib/mercRaster.ts`
  inverse-projection sampler rather than the vector-only scope originally
  planned. Layer logic extracted to `hooks/useMapLayers.ts` so Flat and
  Globe share one source of truth instead of two copies. All four phases
  from the original plan are now shipped in this PR.
