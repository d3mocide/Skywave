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

## Phase A — Shared scaffolding ✅ done

The three primitives every other phase consumes:

- [x] **Dashboard grid CSS.** `.view-dash` (12-col grid, `gap:10px`,
      `max-width:1700px`, full-height scroll) + `.span-3/-4/-6/-8/-12`
      helpers. Single-column stack under 900px. Replaces `.view-pane-inner`
      centering for the four tab views (Overview untouched).
- [x] **`StatTile` component.** Label, big mono value, optional trend
      sparkline + delta arrow, optional threshold coloring (reuses
      `stat-bad`/`stat-warn` classes), optional `title` tooltip. Extracted
      from the ad-hoc `.stat` markup in `SpaceWeatherPanel`.
- [x] **`TimeSeriesChart` component** (SVG, no deps): props for series
      (multi-line), linear/log y, y-gridlines with labels (the C/M/X decade
      pattern generalized), threshold bands (e.g. Bz < −5 shaded), time
      x-axis with UTC ticks, "now" cursor, and a hover readout
      (`pointermove` → nearest sample, value + time in a corner label —
      no floating tooltip DOM). Sized via `ResizeObserver`/container query
      so a 1500px chart renders at native resolution — fixes the stretched
      `XrayChart` problem for free when XrayChart migrates onto it.
- [x] Migrate `XrayChart` + `KpForecastStrip` onto the primitives as the
      proof-of-fit (they're the two existing "real" charts). *(Landed as
      part of the Phase B rebuild — the old `SpaceWeatherPanel` was deleted
      rather than migrated in place, since B replaced it wholesale.)*
- [x] Verify: Playwright pass at 1440px and 375px — grid fills width, no
      horizontal scroll, charts crisp (no viewBox blur).

## Phase B — Space WX: from stat card to weather dashboard ✅ done

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

- [x] Stat tile row: each tile gets a sparkline from the series behind it
      (Kp from `kp_series`, X-ray from `xray`, speed/Bz from `solarWind`)
      and a Δ-vs-6h-ago arrow. SFI keeps a plain value (no history endpoint
      — see Phase F).
- [x] X-ray chart: flare-peak markers labeled with class (new
      `flarePeaks()` in `xray.ts`, local-max detection ≥ C1), C/M/X decade
      gridlines, shaded R-scale zone. **Descoped:** the 6 h / 24 h / 3 d
      range toggle — `/api/xray` proxies the fixed 6-hour SWPC product;
      fetching the 1-/3-day products is backend work, moved to Phase F.
- [x] Solar wind charts: `plasma[]` → speed (line) + density (area, second
      axis); `mag[]` → Bz line with the ≤−5 nT danger band shaded and Bt as
      a dim envelope line. Caption keeps the "L1 → ~30–60 min lead" hint.
- [x] Kp panel: merge history + forecast into one strip — observed bars
      (dim) flowing into forecast bars, G1/G3 gridlines, "now" bin
      outlined. *(Simpler than planned: `/api/kp-forecast` already carries
      `observed` bins for the trailing days, so no `kp_series` collapsing
      was needed — the strip renders the forecast product alone.)*
- [x] Solar cycle chart: monthly `ssn` (dim line) + `smoothed_ssn` (bright)
      over the fetched span. *(Note: the backend keeps only a 24-month tail
      of the SWPC series — a "whole Cycle 25" chart needs that slice
      widened; parked in Phase F. The right end of the chart **is** "you
      are here", so no separate marker.)*
- [x] **HF impact panel** (the translation layer): 3–4 plain-language lines
      derived from data already in hand — D-layer absorption from
      `xrayNow().r` ("R1 blackout — daylight HF degraded below 15 MHz"),
      auroral absorption from Kp ("polar paths degraded"), Bz south
      warning, median `fof2` MUF(3000). This is the panel a non-expert
      reads first. *(Plain text with a shared footnote instead of per-line
      links to source panels.)*
- [ ] Pane registry: wrap the optional panes in `PaneColumn`. **Deferred:**
      reordering span-8/span-4 cells produces ragged grids; needs a
      span-aware registry (or per-view slot map) before it helps more than
      it hurts. Revisit if anyone actually asks to hide a Space WX chart.

## Phase C — DX Cluster: from log tail to activity picture ✅ done

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

- [x] Table upgrades: raise cap 30 → ~200 rows in a scrollable region
      (simple overflow scroll; virtualize only if profiling says so);
      **dedupe** repeat spots of the same call+freq into one row with a
      spotter count (`×4`); age-based row fade (bright <5 min → dim 1 h);
      band-colored dot on freq (reuse the 160–40/30–17/15–6 palette from
      the map legend); derived mode chip in the info cell; relative age
      ("3m") next to the `HHMMZ` time.
- [x] Search box filtering DX call / prefix, alongside existing chips
      (persisted in the same Dexie `filters` row).
- [x] **Workable-only toggle**: labeled "workable (est.)", disabled until a
      DE grid is set. *(Better than planned: instead of reusing the DE→DX
      circuit prediction — which is a different path than each spot's —
      it runs the closed-form `estimateReliability` from DE toward the
      spot's prefix location, memoized per call+band. Deliberately not the
      P533 wasm engine: ~200 calls per poll would stall the table.)*
- [x] Band activity panel: horizontal bar per band, spots-per-last-hour,
      band palette colors — the "which band is hot *right now*" glance.
- [x] Activity heatmap: band × 15-min cells over the trailing 2 h.
      Client-side accumulation keyed by `received_at` (Dexie table capped
      to ~2 h so it survives reloads; spots API only returns the recent
      window, so history must be accumulated, not re-fetched).
- [x] Top-DX list: most-spotted calls in the window with spot count and
      band(s) — pileup detector. Click behaves like a table row
      (`onSelectDx`).
- [x] Keep: connection badge, click-to-set-DX, filter persistence.

## Phase D — Satellites: from timetable to pass planner ✅ done

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

- [x] `satellites.ts`: extend `Pass` with `aosAz`, `losAz`, `maxElAz`,
      `maxElTime`, and a coarse `samples: {t, az, el}[]` (the 30 s scan
      already computes look angles — record them instead of discarding).
      Add `currentLookAngles(tles, obs, now)` for the up-now panel.
- [x] **Polar sky-track plot** (SVG): N/E/S/W compass circle, elevation
      rings (0/30/60°), pass path with labeled AOS/LOS endpoint dots,
      max-el dot, live position dot while a pass is in progress. Renders
      the hero's pass; clicking any table row or timeline bar swaps it.
- [x] Next-pass hero: live countdown to AOS (reuse `useNow` tick), pass
      duration, max el, AOS/LOS azimuths as compass points ("AOS 337° NNW").
- [x] `lib/transponders.ts`: static uplink/downlink/mode table for the
      FEATURED birds (ISS, SO-50, AO-91, RS-44, IO-117 + the CelesTrak
      amateur list's common actives). Shown in hero + table tooltip.
      Static data is fine — these change rarely; note the source and date.
- [x] Up-now panel: satellites currently above horizon with live az/el,
      refreshed on the `useNow` tick; empty state "none above horizon —
      next AOS in 12m".
- [x] Pass timeline: 24 h horizontal Gantt (one row per satellite with a
      pass, bar per pass, height/opacity by max el, now-cursor). Extends
      the prediction window 12 → 24 h for this view.
- [x] Filters panel: featured/all (moved out of the badge slot), min-el
      chips (0/5/10/20°), per-sat ★ favorites persisted in the new Dexie
      `satPrefs` table (db v4), included in export/import like `paneConfig`
      was. Also fixed a latent featured-filter bug: `'ISS'` substring
      matching caught SWISSCUBE — now word-boundary regexes.
- [ ] ~~Optional: small ground-track inset on the hero~~ — **skipped**, as
      the bullet allowed: the hero is already dense with the polar plot,
      countdown, and transponder table. Revisit only on request.

## Phase E — Sun & CME: use the width, surface the buried fields ✅ done

Closest to done already — the fix is proportion and depth, not new
concepts. The disk image is the richest element and should get the space;
the two unused API surfaces (per-region flare history, CME detail fields)
add depth with zero fetch changes.

Layout (wide: three columns; narrow: stacked):

```
[ Sun disk — large, chips above     span-5 ][ region detail   span-3 ][ CME tracker  span-4 ]
[   (fills column height)                  ][ flare odds + regions   ][  helio + list       ]
```

- [x] Let the disk scale to its column (~700px on wide screens) instead of
      the current cap; channel chips stay above it. Keep region overlay
      behavior as-is.
- [x] **Region detail card**: selecting a region (disk marker or table row
      — wiring exists) populates a card: location, McIntosh + Mount Wilson
      class with the one-line explanation currently buried in tooltips,
      area, spot count, and **flare history** from the unused
      `c/m/x_xray_events` fields ("3 C · 1 M in last 24 h"). Empty state:
      "select a region".
- [x] Region table: add a compact flare-history column (`3C 1M —`), keep
      risk coloring; scrolls within its card instead of pushing the page.
- [x] CME list upgrades: show angular width (`halfAngle × 2`), link the
      timestamp to the DONKI `link` (external, `rel=noopener`), dim fully
      arrived events, add an "earth-directed only" filter chip. Keep
      HelioView and the countdown banner exactly as they are — they work.
- [x] Pane registry already wraps this view — extended to the third column
      (panes `sun` / new `regions` / `cme`, all `optional`; existing
      hide/order rows for `sun` and `cme` keep working). The old monolithic
      `SunPanel` split into `SunDiskPanel` + `SunRegionsPanel` with shared
      selection lifted into `SunCMEView`; region interpretation helpers
      moved to `lib/solarRegions.ts`.

## Phase F — Backlog (needs backend or new data; do not block A–E)

- [x] SFI history endpoint (NOAA penticton series) → SFI tile sparkline.
      *(Folded into `/api/space-weather` as `sfi_history` — the
      `f107_cm_flux.json` product, ~2 months at up-to-3/day cadence; tile
      gets sparkline + Δ-vs-7d.)*
- [x] X-ray range toggle (6 h / 1 d / 3 d): proxy SWPC's `xrays-1-day` /
      `xrays-3-day` products next to the current fixed 6 h one (moved here
      from Phase B). *(`/api/xray?range=6h|1d|3d`, per-range cache keys and
      TTLs; wide windows are max-downsampled — not decimated — so flare
      peaks survive: 3 d is ~900 points, not 4,320.)*
- [x] Widen the backend's `solar_cycle` tail (currently 24 months) so the
      Space WX solar-cycle chart can show all of Cycle 25 (moved here from
      Phase B). *(24 → 96 months; chart hover readout became date-aware —
      YYYY-MM at cycle scale instead of a meaningless HH:MM.)*
- [x] Server-side spot history (>2 h) → longer heatmap window; today's
      client-side Dexie accumulation is the deliberate stopgap. *(The
      **bridge** owns the window, not the backend: its telnet connection is
      always up, so the record has no gaps while browsers only poll when
      open. In-memory 24 h ring of `(t, freq, call)` tuples (~6 MB worst
      case), served pre-aggregated as band×time-bin counts + a most-spotted
      list (`/history?hours=2|6|24` → a few KB, never 30k raw spots),
      proxied at `/api/spot-history` with a 60 s cache. DX Cluster rail gets
      2 h / 6 h / 24 h chips; the Dexie accumulation stays as the 2 h
      offline fallback. Bridge restart losing the window is accepted §9
      degradation.)*
- [x] Solar imagery time-lapse (backend would need to retain N frames per
      channel; storage + TTL question — write up before building). *(The
      write-up, resolved: a background task snapshots each channel every
      `SUN_TIMELAPSE_INTERVAL` (default = the 15 min image TTL, so it also
      keeps the `/api/sun` cache warm — no extra upstream load) into a
      Redis ring capped at `SUN_TIMELAPSE_FRAMES` (default 48 ⇒ a 12 h
      loop). Storage: 8 channels × 48 frames × ~70 KB base64 ≈ **27 MB** of
      Redis — fine for a self-hosted single-station stack; set frames=0 to
      disable. Consecutive identical frames are hash-deduped since upstream
      quicklooks update on their own schedule. Frames serve as immutable
      binaries (`/api/sun/{ch}/frame/{ts}`, `Cache-Control: immutable`)
      behind a manifest; the Sun panel gets a play/scrub loop — on the
      LASCO channels this is a CME movie. This is the backend's one
      deliberate departure from pure fetch-on-demand: a loop can't be
      assembled retroactively.)*
- [x] Hemispheric power index / aurora summary stat for Space WX (parse
      from the existing SWPC aurora product or its text sibling). *(New
      `/api/hemi-power` parsing `aurora-nowcast-hemi-power.txt`, trailing
      24 h; 7th stat tile with GW value, sparkline, Δ-vs-6h, warn ≥50 /
      bad ≥100 GW.)*
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
- **2026-07-10 (later)** — Phase F: spot history + imagery time-lapse
  landed (design notes inline above). Verified end-to-end against a local
  rig: fake DX Spider node → real bridge → backend → DX Cluster rail
  (2 h/6 h/24 h chips, 48-cell day heatmap, most-spotted over the window;
  bridge killed mid-run → stale badge + local 2 h fallback), and a
  changing-image fake SDO → frame ring (hash dedupe, cap, immutable frame
  responses, 404 on expired ts) → Sun panel loop (play/scrub/live).
  Remaining F items: DRAP absorption product, SatNOGS transponder source.
- **2026-07-10** — Phase F: the four SWPC-data items landed (SFI history →
  tile sparkline, X-ray 6 h/24 h/3 d range toggle with max-preserving
  downsample, solar-cycle tail 24 → 96 months, hemispheric power stat via
  new `/api/hemi-power`). Verified end-to-end against a local fixture SWPC
  (real backend + Redis + vite, Playwright-driven): synthetic M2.5 flare
  30 h back appears only in the wide windows and survives downsampling;
  bad `range` → 400; `n/a` rows in the hemi-power product pass through as
  nulls. Remaining F items (spot history, imagery time-lapse, DRAP,
  SatNOGS) still open.
- **2026-07-09** — Phases A–E implemented (one commit per phase on
  `claude/app-tabs-layout-redesign-m0ibc7`). Deviations annotated inline:
  X-ray range toggle and full-cycle SSN chart moved to Phase F (backend
  data windows), Space WX pane registry deferred (span-aware registry
  needed first), satellite ground-track inset skipped, workable-only
  filter upgraded to per-spot estimator paths. Verified with Playwright
  screenshots at 1440px and 375px against the vite dev server with all
  `/api/*` routes mocked (deterministic fixtures; backend untouched) —
  grid fills the workspace, single-column stack on mobile, wide tables
  scroll inside their panels, charts render at native resolution.
