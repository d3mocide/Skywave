# Skywave

Self-hosted, offline-capable HF propagation & space weather dashboard for a
single operator / single station. No accounts, no backend-owned user data.

See [DESIGN.md](DESIGN.md) for the full design document.

## Layout

| Path | What |
|---|---|
| `frontend/` | Vite + React + TS PWA — world map with live layers (band coverage heatmap, DX spots, ionosonde MUF dots + interpolated MUF field, OVATION aurora nowcast, flare radio-blackout shading, PSKReporter reception fan, right-click to set DX), rendered as either a flat Leaflet map or a rotating 3-D globe (Canvas2D + d3-geo); Sun panel (SDO/SOHO imagery with sunspot regions plotted on the disk, flare probabilities), heliocentric CME projection, GOES X-ray / solar-wind / Kp-forecast instrumentation, propagation / reception (live "who hears me" via PSKReporter MQTT-over-WebSocket) / satellite / DX cluster panels, panel-nav app shell with a pane registry, Dexie (IndexedDB) local state, Workbox service worker |
| `backend/` | FastAPI — stateless proxy/cache for NOAA SWPC (space weather, sunspot regions, X-ray flux, solar wind, Kp forecast, OVATION aurora + hemispheric power, D-RAP absorption), NASA DONKI, NASA SDO + SOHO imagery (plus a rolling ~12 h time-lapse frame ring per channel), kc2g GIRO, CelesTrak, SatNOGS DB transponders; Redis-backed with per-source TTLs |
| `dxspider-bridge/` | Persistent telnet connection to a DX Spider node, republished as HTTP/JSON (browsers can't speak raw TCP); keeps a 24 h spot-history window served as band×time aggregates |
| `p533-wasm/` | Emscripten build pipeline for the ITU-R P.533 reference C implementation → WASM |
| `docker-compose.yml` + `Caddyfile` | Dev stack behind Caddy, built from source |
| `docker-compose.prod.yml` | Prod stack behind Caddy, runs published GHCR images |

## Quick start (deployment)

Everything — the stack plus the real ITU-R P.533 propagation engine — in
one command (requires Docker and make):

```sh
make all DXSPIDER_LOGIN=YOURCALL
```

Then open http://localhost/ and set your callsign + Maidenhead grid in the
Station panel. State lives entirely in your browser; use the Station panel's
export/import to move a profile between devices.

Useful targets: `make up` (stack only, propagation runs in clearly-badged
estimate mode), `make p533` (build + deploy the P.533 WASM engine later),
`make logs`, `make down`, `make distclean`. Run without make instead:

```sh
DXSPIDER_LOGIN=YOURCALL docker compose up -d --build   # stack on :80
cd p533-wasm && ./build.sh                             # P.533 engine
# load ionos files into the volume (see p533-wasm/README.md), then
docker compose build frontend && docker compose up -d frontend
```

## Production deployment (VPS)

Images are built multi-arch (linux/amd64 + linux/arm64) and published to
GHCR by `.github/workflows/docker-publish.yml` on every push to `main`
(tag `latest`) and on version tags `vX.Y.Z`. `docker-compose.prod.yml` runs
those published images instead of building from source — no compilers or
source checkout needed on the VPS itself, just the compose file + Caddyfile.

```sh
cp .env.example .env    # set DXSPIDER_LOGIN and SITE_ADDRESS
docker compose -f docker-compose.prod.yml pull
docker compose -f docker-compose.prod.yml up -d
# or: make prod-up
```

`SITE_ADDRESS` is required in prod (e.g. `skywave.example.com`, DNS
pointing at the VPS, ports 80+443 open) — Caddy uses it to request an
automatic Let's Encrypt certificate. Leaving it unset is only supported in
the dev compose file, where Caddy falls back to plain HTTP on `:80`.

The P.533 WASM engine and ionosonde data still need to be loaded into the
`skywave-ionos-data` volume once (`make wasm ionos-load`, or follow
`p533-wasm/README.md`) and the frontend image already bundles the compiled
WASM — rebuild/republish the frontend image after running `make wasm`
locally if you want P.533 baked into a specific published tag, otherwise
the estimate-mode fallback is used.

First-time GHCR note: packages default to private. After the first publish,
either make the `skywave-frontend`/`skywave-api`/`skywave-dxspider-bridge`
packages public in GitHub (Package settings → Change visibility), or
configure your VPS's Docker with a `docker login ghcr.io` using a token
that has read access.

## Development

```sh
# backend (needs a local redis: docker run -p 6379:6379 redis:7-alpine)
cd backend && pip install -e . && uvicorn app.main:app --reload

# bridge
cd dxspider-bridge && DXSPIDER_LOGIN=YOURCALL python bridge.py

# frontend (proxies /api to localhost:8000)
cd frontend && npm install && npm run dev
```

## Offline behavior

- App shell, coefficient data, and the current month's ionospheric file are
  cached; propagation predictions and satellite passes keep computing with
  no connectivity.
- Live-data panels (space weather, CMEs, DX spots) degrade to last-known
  values with an explicit staleness badge — one source being down never
  blanks the dashboard.
- First launch needs one online session to fetch data; the app says so
  rather than failing silently.
