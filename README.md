# Skywave

Self-hosted, offline-capable HF propagation & space weather dashboard for a
single operator / single station. No accounts, no backend-owned user data.

See [DESIGN.md](DESIGN.md) for the full design document.

## Layout

| Path | What |
|---|---|
| `frontend/` | Vite + React + TS PWA — Leaflet world map, propagation / space weather / CME / satellite / DX cluster panels, Dexie (IndexedDB) local state, Workbox service worker |
| `backend/` | FastAPI — stateless proxy/cache for NOAA SWPC, NASA DONKI, kc2g GIRO, CelesTrak; Redis-backed with per-source TTLs |
| `dxspider-bridge/` | Persistent telnet connection to a DX Spider node, republished as HTTP/JSON (browsers can't speak raw TCP) |
| `p533-wasm/` | Emscripten build pipeline for the ITU-R P.533 reference C implementation → WASM |
| `docker-compose.yml` + `Caddyfile` | Single-stack deployment behind Caddy |

## Quick start (deployment)

```sh
DXSPIDER_LOGIN=YOURCALL docker compose up -d --build
```

Then open http://localhost/ and set your callsign + Maidenhead grid in the
Station panel. State lives entirely in your browser; use the Station panel's
export/import to move a profile between devices.

### Real P.533 predictions

Out of the box the propagation panel runs a rough climatological
**estimate** (clearly badged as such). To switch it to the real ITU-R P.533
engine:

```sh
cd p533-wasm && ./build.sh   # requires Docker; see p533-wasm/README.md
```

then copy the monthly `ionosNN.bin` files into the `ionos-data` volume as
described in [p533-wasm/README.md](p533-wasm/README.md) and rebuild the
frontend image. The engine badge flips from "estimate" to "P.533".

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
