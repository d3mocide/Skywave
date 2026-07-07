# Skywave

Self-hosted, offline-capable HF propagation & space weather dashboard for a
single operator / single station. No accounts, no backend-owned user data.

See [DESIGN.md](DESIGN.md) for the full design document.

## Layout

| Path | What |
|---|---|
| `frontend/` | Vite + React + TS PWA — Leaflet world map with live layers (band coverage heatmap, DX spots, ionosonde MUF dots + interpolated MUF field, OVATION aurora nowcast, flare radio-blackout shading, right-click to set DX), Sun panel (SDO/SOHO imagery with sunspot regions plotted on the disk, flare probabilities), heliocentric CME projection, GOES X-ray / solar-wind / Kp-forecast instrumentation, propagation / satellite / DX cluster panels, Dexie (IndexedDB) local state, Workbox service worker |
| `backend/` | FastAPI — stateless proxy/cache for NOAA SWPC (space weather, sunspot regions, X-ray flux, solar wind, Kp forecast, OVATION aurora), NASA DONKI, NASA SDO + SOHO imagery, kc2g GIRO, CelesTrak; Redis-backed with per-source TTLs |
| `dxspider-bridge/` | Persistent telnet connection to a DX Spider node, republished as HTTP/JSON (browsers can't speak raw TCP) |
| `p533-wasm/` | Emscripten build pipeline for the ITU-R P.533 reference C implementation → WASM |
| `docker-compose.yml` + `Caddyfile` | Single-stack deployment behind Caddy |

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
