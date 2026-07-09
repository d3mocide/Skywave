# Tab Views Redesign — Tracking Doc

Redesigns the four non-Overview views — **Space WX, DX Cluster, Satellites,
Sun & CME** — from "one centered panel floating in empty space" into full
dashboard layouts that use the whole workspace. This doc is the working
checklist across sessions: brainstorm → layout decisions → phased tasks.
Update it as phases land instead of re-deriving scope each time.

**Companion docs:** [DESIGN.md](DESIGN.md) is the architecture record —
staleness/offline rules referenced below always mean DESIGN.md §9.
[UI-UX-PLAN.md](UI-UX-PLAN.md) covers the shell/nav/map work that created
these views; this doc picks up where its Phase 1 stopped ("plain
single-panel renders").

---

## Problem statement (from live-app review, 2026-07-09)

Screenshots of all four tabs on a ~1900px display show the same failure
mode: each view renders one `Panel` inside `.view-pane-inner`
(max-width 1100/1400, centered), leaving 60–80% of the screen black.

Per-tab audit — what's on screen vs. what the app **already fetches**:

| View | Shown today | Fetched but never shown |
|---|---|---|
| Space WX | 5 stat numbers, one 120px Kp sparkline, X-ray chart, one line of latest solar-wind values, Kp forecast strip | Full DSCOVR plasma+mag **time series** (`SolarWind.plasma[]/mag[]`), 3 days of `kp_series` history, the entire multi-year `solar_cycle` array (SSN + SSN12), `aurora` grid, `fof2` stations |
| DX Cluster | 30-row spot table, band/mode filter chips | Spot flow over time (rate/heatmap), per-band activity distribution, spotter counts, prefix→continent/bearing (lib exists: `prefixes.ts`, `geo.ts`) |
| Satellites | ≤12-row AOS/LOS/max-el table | Live az/el ("up now"), pass geometry (AOS/LOS azimuths, sky track), ground track — all computable from cached TLEs via satellite.js; transponder freqs (static data, not yet in repo) |
| Sun & CME | Disk imagery + region table; HelioView + CME list | Per-region flare history (`c/m/x_xray_events` fields), CME `halfAngle`/`note`/DONKI `link`, region detail on select (click today only highlights) |

Secondary issues visible in the screenshots:

- `XrayChart` uses `viewBox="0 0 250 60"` at `width:100%` — at 1500px wide
  it scales into a fat blurry crayon line. Any full-width chart needs real
  responsive sizing, not viewBox stretching.
- Satellites: `all` toggle renders in the *badge* slot; no min-elevation
  control, no favorites, times are bare `HH:MMZ` with no "in how long".
- Sun & CME is the closest to right (two panes, real content) but the disk
  image is capped small while half the row is empty, and the region table
  scrolls below the fold.

## Design principles

1. **Every view answers an operator question.** Space WX: *"is the
   ionosphere disturbed, and is it getting better or worse?"* DX Cluster:
   *"where is the activity and can I work it?"* Satellites: *"when is the
   next pass and where do I point?"* Sun & CME: *"what's coming in the
   next 72 h?"* Layout decisions get judged against the question — the
   most decision-relevant element takes the biggest slot.
2. **Dashboard grid, not centered card.** Each view becomes a 12-col CSS
   grid filling the workspace (soft cap ~1700px so lines stay readable),
   collapsing to 1 column under 900px like the Overview layout does.
3. **Existing `Panel` chrome everywhere.** Every new tile/chart keeps the
   `fetchedAt`/`stale` contract (§9). `PaneColumn` customize/hide/reorder
   applies once a view has ≥2 optional panes (UI-UX-PLAN Phase 3 rule).
4. **No chart library.** Extend the hand-rolled SVG approach into one
   shared `TimeSeriesChart` instead of adding recharts/d3-scale. Keeps the
   bundle small and offline-simple; our charts are lines, bars, and bands.
5. **Frontend-only first.** Phases A–E need zero backend changes — they
   render data already flowing. Backend-dependent ideas are quarantined in
   Phase F so they can't stall the layout work.

---

## Phase A — Shared scaffolding (do first)

The three primitives every other phase consumes:

- [ ] **Dashboard grid CSS.** `.view-dash` (12-col grid, `gap:10px`,
      `max-width:1700px`, full-height scroll) + `.span-3/-4/-6/-8/-12`
      helpers. Single-column stack under 900px. Replaces `.view-pane-inner`
      centering for the four tab views (Overview untouched).
- [ ] **`StatTile` component.** Label, big mono value, optional trend
      sparkline + delta arrow, optional threshold coloring (reuses
      `stat-bad`/`stat-warn` classes), optional `title` tooltip. Extracted
      from the ad-hoc `.stat` markup in `SpaceWeatherPanel`.
- [ ] **`TimeSeriesChart` component** (SVG, no deps): props for series
      (multi-line), linear/log y, y-gridlines with labels (the C/M/X decade
      pattern generalized), threshold bands (e.g. Bz < −5 shaded), time
      x-axis with UTC ticks, "now" cursor, and a hover readout
      (`pointermove` → nearest sample, value + time in a corner label —
      no floating tooltip DOM). Sized via `ResizeObserver`/container query
      so a 1500px chart renders at native resolution — fixes the stretched
      `XrayChart` problem for free when XrayChart migrates onto it.
- [ ] Migrate `XrayChart` + `KpForecastStrip` onto the primitives as the
      proof-of-fit (they're the two existing "real" charts).
- [ ] Verify: Playwright pass at 1440px and 375px — grid fills width, no
      horizontal scroll, charts crisp (no viewBox blur).

## Phase B — Space WX: from stat card to weather dashboard

The question: *"is the ionosphere disturbed, and which way is it trending?"*
Trend is the whole point of having time-series data — today we show one
sample of almost everything.

Layout (12-col):

```
[SFI][Kp][SSN·SSN12][X-ray now][SW speed][Bz]              ← 6 StatTiles, span-2 each
[ GOES X-ray — log line, C/M/X bands, flare peaks    span-8 ][ HF impact  span-4 ]
[ Solar wind speed + density — 24 h        span-6 ][ IMF Bz/Bt — 24 h     span-6 ]
[ Kp — observed bars + 3-day forecast      span-6 ][ Solar cycle — SSN/SSN12 span-6 ]
```

- [ ] Stat tile row: each tile gets a sparkline from the series behind it
      (Kp from `kp_series`, X-ray from `xray`, speed/Bz from `solarWind`)
      and a Δ-vs-6h-ago arrow. SFI keeps a plain value (no history endpoint
      — see Phase F).
- [ ] X-ray chart: 6 h / 24 h / 3 d range toggle (data window permitting),
      flare-peak markers labeled with class (local-max detection ≥ C1),
      NOAA R-scale annotation on the right edge. Reuses `xray.ts` helpers.
- [ ] Solar wind charts: `plasma[]` → speed (line) + density (area, second
      axis); `mag[]` → Bz line with the ≤−5 nT danger band shaded and Bt as
      a dim envelope line. Caption keeps the "L1 → ~30–60 min lead" hint.
- [ ] Kp panel: merge history + forecast into one strip — observed bars
      (dim, from `kp_series` collapsed to 3 h bins) flowing into forecast
      bars (existing `KpForecastStrip` styling), G-scale bands (G1 at Kp5…)
      as horizontal gridlines.
- [ ] Solar cycle chart: monthly `ssn` scatter + `smoothed_ssn` line over
      the full fetched span, "you are here" marker. Answers "where are we
      in Cycle 25" — currently invisible despite the data being fetched.
- [ ] **HF impact panel** (the translation layer): 3–4 plain-language lines
      derived from data already in hand — D-layer absorption from
      `xrayNow().r` ("R1 blackout — daylight HF degraded below 15 MHz"),
      auroral absorption from Kp ("polar paths degraded"), Bz south
      warning, MUF trend from median `fof2` station values. Each line
      links its source panel. This is the panel a non-expert reads first.
- [ ] Pane registry: wrap the ≥2-optional panes in `PaneColumn` (core:
      stat row + X-ray; optional: the rest) per UI-UX-PLAN Phase 3 rule.

## Phase C — DX Cluster: from log tail to activity picture

The question: *"where is the activity and can I work it?"* The table
answers "what was spotted"; nothing answers "which band is hot" or "is
this workable from here" — even though the propagation prediction and
prefix→location libs already exist.

Layout: main column (span-8) + analytics rail (span-4):

```
[ filters: bands · modes · search · workable-only          span-12 ]
[ spot table — taller, age-faded, band-dot,      span-8 ][ band activity   span-4 ]
[   dedup'd, click→DX (existing)                        ][ heatmap band×t  span-4 ]
[                                                       ][ top DX calls    span-4 ]
```

- [ ] Table upgrades: raise cap 30 → ~200 rows in a scrollable region
      (simple overflow scroll; virtualize only if profiling says so);
      **dedupe** repeat spots of the same call+freq into one row with a
      spotter count (`×4`); age-based row fade (bright <5 min → dim 1 h);
      band-colored dot on freq (reuse the 160–40/30–17/15–6 palette from
      the map legend); derived mode chip in the info cell; relative age
      ("3m") next to the `HHMMZ` time.
- [ ] Search box filtering DX call / prefix, alongside existing chips
      (persisted in the same Dexie `filters` row).
- [ ] **Workable-only toggle**: cross each spot's band against the current
      `prediction` (already computed in `App.tsx` — pass it down) and the
      spot's bearing/distance from `prefixes.ts`; hide spots on bands with
      ~0% reliability. Labeled "workable (est.)" with a tooltip noting
      it's the monthly-median model, matching PropagationPanel's caveat.
- [ ] Band activity panel: horizontal bar per band, spots-per-last-hour,
      band palette colors — the "which band is hot *right now*" glance.
- [ ] Activity heatmap: band × 15-min cells over the trailing 2 h.
      Client-side accumulation keyed by `received_at` (Dexie table capped
      to ~2 h so it survives reloads; spots API only returns the recent
      window, so history must be accumulated, not re-fetched).
- [ ] Top-DX list: most-spotted calls in the window with spot count and
      band(s) — pileup detector. Click behaves like a table row
      (`onSelectDx`).
- [ ] Keep: connection badge, click-to-set-DX, filter persistence.

## Phase D — Satellites: from timetable to pass planner

The question: *"when is the next pass and where do I point?"* AOS/LOS
times alone don't answer it — azimuths and elevations do. All of it is
computable offline from cached TLEs; `predictPasses()` just doesn't record
geometry yet.

Layout:

```
[ next-pass hero: countdown · polar sky-track ·       span-8 ][ up now   span-4 ]
[   AOS/max/LOS az·el · duration · transponder freqs         ][ (live az/el)    ]
[ pass timeline — 24 h Gantt, one row per sat               span-12 ]
[ pass table (existing + az columns, click→sky-track)  span-8 ][ filters span-4 ]
```

- [ ] `satellites.ts`: extend `Pass` with `aosAz`, `losAz`, `maxElAz`,
      `maxElTime`, and a coarse `samples: {t, az, el}[]` (the 30 s scan
      already computes look angles — record them instead of discarding).
      Add `currentLookAngles(tles, obs, now)` for the up-now panel.
- [ ] **Polar sky-track plot** (SVG): N/E/S/W compass circle, elevation
      rings (0/30/60°), pass path with AOS→LOS direction arrow, max-el
      dot. Renders the hero's next pass; clicking any table row swaps it.
- [ ] Next-pass hero: live countdown to AOS (reuse `useNow` tick), pass
      duration, max el, AOS/LOS azimuths as compass points ("AOS 337° NNW").
- [ ] `lib/transponders.ts`: static uplink/downlink/mode table for the
      FEATURED birds (ISS, SO-50, AO-91, RS-44, IO-117 + the CelesTrak
      amateur list's common actives). Shown in hero + table tooltip.
      Static data is fine — these change rarely; note the source and date.
- [ ] Up-now panel: satellites currently above horizon with live az/el,
      refreshed on the `useNow` tick; empty state "none above horizon —
      next AOS in 12m".
- [ ] Pass timeline: 24 h horizontal Gantt (one row per satellite with a
      pass, bar per pass, height/opacity by max el, now-cursor). Extends
      the prediction window 12 → 24 h for this view.
- [ ] Filters panel: featured/all (move out of the badge slot), min-el
      slider (5/10/20°), per-sat favorites persisted in Dexie (new table,
      included in export/import like `paneConfig` was).
- [ ] Optional (call during build): small ground-track inset on the hero
      using the existing d3-geo land topojson — only if it fits without
      crowding; the polar plot is the must-have.

## Phase E — Sun & CME: use the width, surface the buried fields

Closest to done already — the fix is proportion and depth, not new
concepts. The disk image is the richest element and should get the space;
the two unused API surfaces (per-region flare history, CME detail fields)
add depth with zero fetch changes.

Layout (wide: three columns; narrow: stacked):

```
[ Sun disk — large, chips above     span-5 ][ region detail   span-3 ][ CME tracker  span-4 ]
[   (fills column height)                  ][ flare odds + regions   ][  helio + list       ]
```

- [ ] Let the disk scale to its column (~700px on wide screens) instead of
      the current cap; channel chips stay above it. Keep region overlay
      behavior as-is.
- [ ] **Region detail card**: selecting a region (disk marker or table row
      — wiring exists) populates a card: location, McIntosh + Mount Wilson
      class with the one-line explanation currently buried in tooltips,
      area, spot count, and **flare history** from the unused
      `c/m/x_xray_events` fields ("3 C · 1 M in last 24 h"). Empty state:
      "select a region".
- [ ] Region table: add a compact flare-history column (`3C 1M —`), keep
      risk coloring; scrolls within its card instead of pushing the page.
- [ ] CME list upgrades: show angular width (`halfAngle × 2`), link the
      timestamp to the DONKI `link` (external, `rel=noopener`), dim fully
      arrived events, add an "earth-directed only" filter chip. Keep
      HelioView and the countdown banner exactly as they are — they work.
- [ ] Pane registry already wraps this view — extend it to the third
      column (all three panes `optional`, matching current behavior).

## Phase F — Backlog (needs backend or new data; do not block A–E)

- [ ] SFI history endpoint (NOAA penticton series) → SFI tile sparkline.
- [ ] Server-side spot history (>2 h) → longer heatmap window; today's
      client-side Dexie accumulation is the deliberate stopgap.
- [ ] Solar imagery time-lapse (backend would need to retain N frames per
      channel; storage + TTL question — write up before building).
- [ ] Hemispheric power index / aurora summary stat for Space WX (parse
      from the existing SWPC aurora product or its text sibling).
- [ ] D-region absorption product (DRAP) as both a Space WX chart and a
      possible map layer.
- [ ] Satellite transponder data from a maintained source (SatNOGS DB)
      instead of the static table, with offline caching.

## Sequencing & verification

Order: **A → B → C → D → E** (F opportunistic). B first among the views
because it reuses A's primitives most heavily and proves them; C and D are
independent of each other; E is smallest.

Each phase lands as its own PR with the UI-UX-PLAN.md convention: verify
via Playwright against the running stack at desktop (1440px) and mobile
(375px) widths, screenshot before/after, check the staleness badge still
surfaces on every new panel (kill the backend, confirm `stale` chips), and
update this doc's checkboxes + change log in the same PR.

## Change log

- **2026-07-09** — Doc created from live-app layout review of the four tab
  views (screenshots) + code audit of `App.tsx`, the four panel components,
  `api.ts`, `satellites.ts`. Key finding driving scope: the frontend
  already fetches nearly everything the redesigned views need — Phases A–E
  are frontend-only.
