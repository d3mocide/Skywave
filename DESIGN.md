# Skywave — Design Document

*Self-hosted, offline-capable HF propagation & space weather dashboard*

> **Naming note:** "Skywave" is a placeholder — it's the actual ham radio term for
> ionospheric HF propagation, fits the standalone-name convention, and isn't taken
> by anything in this space yet. Trivial to rename before v1 if something better
> comes up.

## 1. Overview

Inspired by [cmetracker.ai](https://www.cmetracker.ai) (CME visualization) and
[OpenHamClock](https://openhamclock.com) (full ham dashboard), but streamlined to
Will's own needs and built to be genuinely usable with no connectivity — not just
"works offline in a degraded state," but computes real ITU-R P.533 propagation
predictions entirely client-side once the coefficient data is cached.

Single operator, single station. No accounts, no multi-tenancy, no backend-owned
user data.

## 2. Architecture Overview

```
                         ┌─────────────────────────────────────┐
                         │         Browser (PWA)                │
                         │                                       │
  NOAA SWPC ──┐          │  React/Vite + TS                     │
  NASA DONKI ─┤          │  ├─ WorldMap (Leaflet)                │
  CelesTrak ──┤          │  ├─ P533.wasm  (compiled from         │
  kc2g GIRO ──┼──► FastAPI│      ITURHFProp/P533 core, runs       │
  DX Spider ──┤   (proxy  │      fully offline once data cached) │
  (telnet     │    + cache│  ├─ satellite.js (SGP4, offline once  │
   bridge)    │    only,  │      TLEs cached)                    │
              │    Redis) │  ├─ Service Worker (Workbox)          │
              └───────────┤  │    - MEMFS: 12x COEFF*.bin (~460KB,│
                           │  │      bundled, all months)          │
                           │  │    - IDBFS: current month's        │
                           │  │      ionosNN.bin (~11MB, fetched   │
                           │  │      once, refreshed monthly)      │
                           │  └─ IndexedDB (Dexie) — profiles,     │
                           │       filters, favorites, DE/DX state │
                           └────────────────────────────────────┘
```

No database for user data. Redis on the backend is a **shared cache only** — same
role NOAA SWPC data plays for any visitor, not "your" data. No auth, no sessions.

## 3. Stack

| Layer | Choice | Notes |
|---|---|---|
| Frontend | Vite + TypeScript | Standard reusable core pattern |
| UI framework | React | Consistent with other projects |
| Map | Leaflet | Same choice OpenHamClock made; MapLibre/Deck.gl is overkill for a 2D station map — reserve that stack for Sovereign Watch-style tactical layers |
| Propagation engine | ITU-R P.533 compiled to WASM (Emscripten) | See §4 |
| Satellite tracking | satellite.js (SGP4), client-side | Offline-capable once TLEs cached |
| PWA / offline | Service Worker (Workbox) + IndexedDB (Dexie) | |
| Backend | FastAPI | Stateless — aggregator/proxy/cache only |
| Cache | Redis | Persists across restarts (decided) |
| DX cluster bridge | Small Node or Python telnet↔HTTP microservice | Browsers can't speak raw TCP — unavoidable, same as OpenHamClock's `dxspider-proxy` |
| Auth | **None** | Reverse-proxy + Argon2id is the default pattern for projects that need gating; this one doesn't need any |
| Reverse proxy | Caddy | Matches Faraday's deployment pattern |
| Deploy | Single Docker Compose stack | |

## 4. Prediction Engine — WASM P533

Source: [`ITU-R-Study-Group-3/ITU-R-HF`](https://github.com/ITU-R-Study-Group-3/ITU-R-HF),
`P533/Src` — confirmed via direct inspection during the spike:

- ~8,500 lines of plain C, single entry point `int P533(struct PathData *path)` in
  `P533.c`, already marked `DLLEXPORT`. No threading or socket calls in the compute
  path — clean Emscripten target.
- **Data footprint is tiered, not monolithic:**
  - `COEFF01W.txt`–`COEFF12W.txt` — 12 files, ~230KB each (~2.8MB total, gzips to
    ~25%). Bundle all 12 in the app. *(Implementation note: the original plan
    assumed the ~40KB `.BIN` files, but P372's `ReadFamDud()` only parses the
    `.txt` flavor — still small enough to bundle.)*
  - `ionos01.bin`–`ionos12.bin` — 12 files, **11.2MB each**. `ReadIonParameters.c`
    only opens the file for the *current* month — never all 12. Runtime footprint
    is ~11MB, not 132MB.
  - `P1239-3 Decile Factors.txt` — small text table, within-month variability
    factors. Bundle it.

**Runtime data strategy:**

1. Ship all 12 `COEFF*.bin` in the app bundle (MEMFS, preloaded at build time).
2. On first online session, fetch the current month's `ionosNN.bin` (~11MB),
   persist to IDBFS. This is the one real download — comparable to a map tileset,
   fine on mobile data.
3. On month rollover, attempt to fetch the new month's file in the background.
   If offline when the month changes, keep using the prior month's coefficients
   with a visible "using [Month] data — reconnect to update" notice rather than
   failing. Propagation patterns shift gradually, not at midnight on the 1st.

**Climatological vs. real-time — the important caveat:** P.533 predicts *monthly
median* reliability from smoothed sunspot number (SSN12), not live conditions. It
will not by itself reflect "the band just went dead because of a flare ten minutes
ago." Two mitigations, both already precedented by OpenHamClock:

- Layer a **real-time correction** from kc2g.com's ionosonde network (GIRO) when
  available — actual measured foF2 overriding the modeled value near stations with
  current data.
- Always show current SFI/Kp/SSN alongside the prediction so the operator can see
  when live conditions are diverging from the model's baseline assumption.

Use **smoothed SSN12**, not the raw daily sunspot number, as the model input —
mixing the two silently degrades prediction quality and is an easy mistake to make.

## 5. Frontend Detail

- State lives entirely in browser storage (IndexedDB via Dexie): DE station
  config, saved DX targets, DX/PSK/satellite filters, theme, layout, favorites.
- No backend sync in v1 (see §9 for the accepted tradeoff and its escape hatch).
- Service worker owns three cache tiers: app shell (standard PWA), coefficient
  data (MEMFS-bundled + IDBFS current-month file), and short-TTL API responses
  (space weather, CME catalog, TLEs) with stale-while-revalidate + a visible
  "last updated" timestamp on every panel.

## 6. Backend Detail

FastAPI does exactly one job: proxy external APIs, cache in Redis, normalize
responses. No auth middleware, no user table, no ORM for personal data.

**DX Spider bridge:** a small standalone process (own persistent telnet connection
to a DX Spider node, HTTP/JSON on top) — same architecture as OpenHamClock's
`dxspider-proxy`, for the same reason: one shared connection instead of one per
browser tab, and persistence so spots are ready immediately on page load.

## 7. Data Sources

| Source | Data | Cache TTL | Access pattern |
|---|---|---|---|
| NOAA SWPC | SFI, Kp, SSN, X-ray flux, aurora oval | 5–15 min | Backend proxy |
| NASA DONKI | CME catalog | 30–60 min | Backend proxy; arrival estimate computed client-side (drag-based model, same approach as CME Tracker) |
| kc2g.com (GIRO) | Ionosonde foF2 nowcast | 5 min | Backend proxy — real-time correction layer |
| CelesTrak | Satellite TLEs | 6 hr | Backend proxy; SGP4 positions computed client-side |
| DX Spider network | DX spots | 5 sec | Telnet bridge microservice |
| PSKReporter | TX/RX digital mode reports | real-time | Direct browser MQTT-over-WebSocket, no backend needed |

## 8. Feature Modules (v1)

- World map — station marker, great-circle DE↔DX path, day/night terminator, gray line
- Propagation panel — per-band reliability from the WASM P533 engine for the
  currently selected DX target
- Space weather panel — SFI / Kp / SSN, with history sparkline
- CME tracker — DONKI catalog, drag-based arrival estimate, Earth-impact view
- Band conditions summary (derived from the same P533 output + live SFI/Kp)
- Satellite tracking — amateur radio satellite passes
- DX cluster spot list with band/mode/zone filtering
- DE / DX station info panels (grid, bearing, distance, sunrise/sunset)

## 9. Edge Cases

**Offline & staleness**

- *Zero cached data, first launch, offline:* the app needs one online session
  before it's useful — no bundled fallback ionos file for "any" month. Make this
  explicit in onboarding rather than silently failing.
- *Data older than its TTL and no connection:* show last-known values with an
  explicit staleness badge everywhere, never present cached data as current
  without a timestamp.
- *Storage eviction:* IndexedDB isn't guaranteed persistent, especially on iOS
  Safari (can be evicted after inactivity). Call `navigator.storage.persist()` on
  first launch, and handle a wiped cache as "needs re-sync," not a crash.

**Propagation model validity**

- *Very short paths (NVIS territory, roughly <300km):* oblique point-to-point
  P.533 isn't built for near-vertical-incidence skywave. Flag or exclude circuits
  below a minimum distance rather than returning a misleading number.
- *Very long / antipodal paths:* both short-path and long-path great-circle
  routes are physically valid — compute and display both, don't silently pick one.
- *Polar paths:* P.533's accuracy degrades on paths crossing high geomagnetic
  latitude (auroral absorption isn't well captured by a median model). Flag paths
  crossing roughly above 60–65° geomagnetic latitude as lower-confidence.
- *Out-of-band frequency requests:* P.533/ITURHFProp is scoped to 2–30MHz. Reject
  or clearly caveat anything outside that range (e.g., a 6m request) rather than
  feeding it to a model that isn't valid there.
- *Solar cycle extremes:* SSN can range from ~0 (deep minimum) to 200+ (strong
  maximum) — don't assume a "normal" mid-cycle range anywhere in the UI or input
  validation.

**Data source outages**

- Any of NOAA SWPC / DONKI / kc2g / CelesTrak / DX Spider can go down independently.
  Each panel degrades to its own cached last-known state; one outage should never
  blank the whole dashboard.
- DX Spider node down: fail over to the next node in a priority list, same pattern
  as OpenHamClock's four-node fallback chain.
- Respect upstream cache TTLs strictly — hammering POTA/WWFF/NOAA from many
  refreshes risks getting rate-limited or banned, same lesson OpenHamClock's
  documented cache windows already encode.

**Multi-device / storage (accepted tradeoff)**

- No cross-device sync in v1 — a profile on your phone won't appear on the shack
  Pi. This is intentional given no-auth/no-backend-data. Escape hatch: manual
  JSON export/import of the full local state (station config, filters, favorites),
  same pattern as OpenHamClock's profile export — copy a file over instead of
  building an account system.

**Time correctness**

- All astronomical and propagation calculations (grayline, sunrise/sunset, day/
  night band conditions, P533 hour input) run in UTC internally regardless of
  display locale — DST and local-timezone handling is display-only, never feeds
  into the model.

## 10. Deployment

Single Docker Compose stack behind Caddy, self-hosted on the hypervisor —
matches the Faraday deployment pattern. Services: `frontend` (static PWA build),
`api` (FastAPI), `redis`, `dxspider-bridge`. No database container needed for v1.

## 11. Explicitly Deferred (v2+ backlog)

- WSJT-X UDP integration
- POTA / WWFF / SOTA activator feeds
- Optional lightweight sync (would revisit the no-auth decision only if
  cross-device profile sync becomes a real pain point in practice)
- EmComm-style layout / APRS integration

## 12. Open Decisions

- Exact DX Spider node list / whether to lean on a public proxy vs. self-hosting
  the bridge from day one
- Whether the CME drag-based arrival model is hand-rolled or adapted from a
  published reference implementation
