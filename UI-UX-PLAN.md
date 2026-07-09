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

- [ ] View routing approach: local component state vs. URL hash (hash gets
      back-button + bookmarkability for free; recommend hash)
- [ ] Finalize nav IA / icon list (see Phase 1 view list below)
- [ ] Confirm `mapFocus` toggle's fate once Overview is its own view
      (likely redundant — decide keep vs. drop)

## Phase 1 — App shell + panel nav

- [ ] `SideNav.tsx` — icon rail, tooltips, active-state highlight (modeled
      on Nexus `ModeNav`: grouped items, current-view pill, settings gear
      pinned bottom)
- [ ] Restructure `App.tsx` into shell: topbar + `SideNav` + routed view
      content (`<div class="shell">` wrapping nav + workspace)
- [ ] View state + switch-based router, no new dependency needed
- [ ] Split existing panels into views:
  - **Overview** — WorldMap + StationPanel + PropagationPanel +
    BandConditions (today's default core loop)
  - **Space Weather** — SpaceWeatherPanel, full width
  - **DX Cluster** — DXClusterPanel, full width (room for a bigger table)
  - **Satellites** — SatellitePanel, expanded out of the cramped right
    column
  - **Sun & CME** — SunPanel + CMEPanel + HelioView
  - **Station/Settings** — StationPanel config, export/import
- [ ] `styles.css`: add `.shell` / `.side-nav`; keep `.panel` chrome as-is
- [ ] Verify offline staleness badges still render correctly per-view
      (nothing about routing should change DESIGN.md §9 behavior)

## Phase 2 — Top bar consolidation

- [ ] Contextual controls area in `TopBar`, shown/hidden per view (Nexus
      pattern: `hideX` boolean props on one shared component, not one
      topbar per view)
- [ ] Move the map's time-scrubber (`scrubHours`) control into the top bar,
      shown only on views that consume `viewTime` (Overview; maybe Space
      Weather)
- [ ] Aggregate connection/staleness indicator (roll-up of all
      `ApiState.stale` flags) visible on every view
- [ ] Decide: add a light/amber theme, or stay single dark theme
      (Nexus has 3; Skywave currently has 1 — no obligation to match)

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
