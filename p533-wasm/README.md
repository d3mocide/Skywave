# P533 → WASM build pipeline

Compiles the ITU-R P.533 reference implementation
([`ITU-R-Study-Group-3/ITU-R-HF`](https://github.com/ITU-R-Study-Group-3/ITU-R-HF),
`P533/Src` — ~8,500 lines of plain C, single `P533(struct PathData *)` entry
point, no threads or sockets) to WebAssembly, per DESIGN.md §4.

## Build

Requires Docker (uses the official `emscripten/emsdk` image — no local
toolchain needed):

```sh
./build.sh
```

The script:

1. Clones `ITU-R-Study-Group-3/ITU-R-HF` (shallow) into `vendor/`.
2. Compiles `P533/Src/*.c` + `wrapper.c` with Emscripten as a modularized
   ES-module (`-sMODULARIZE -sEXPORT_ES6`), exporting
   `_p533_predict_reliability` and the FS helpers.
3. Copies the outputs to `../frontend/public/p533/` (`p533.js`, `p533.wasm`)
   where `frontend/src/lib/propagation/engine.ts` auto-detects them at
   runtime. No frontend code changes needed — the engine badge flips from
   "estimate" to "P.533".

## Data files (DESIGN.md §4 tiering)

- `COEFF01W.bin`–`COEFF12W.bin` (~460 KB total) and
  `P1239-3 Decile Factors.txt`: copied by `build.sh` from the cloned repo
  into `../frontend/public/coeff/` — bundled with the app, preloaded into
  MEMFS by the wrapper.
- `ionosNN.bin` (11.2 MB **per month**): NOT bundled. Serve them from
  `/data/` (see `docker-compose.yml`'s `ionos-data` volume); the app fetches
  only the current month's file on first online session and persists it via
  the service worker's CacheFirst tier + IDBFS. On month rollover the app
  fetches the new month in the background and keeps using the prior month
  (with a visible notice) when offline.

## Wrapper contract

`wrapper.c` exposes a single flat function so no struct layout crosses the
JS boundary:

```c
double p533_predict_reliability(
    double tx_lat_deg, double tx_lon_deg,
    double rx_lat_deg, double rx_lon_deg,
    double freq_mhz, int month, int hour_utc, double ssn12);
```

Returns basic circuit reliability (0–1) or a negative error code. Input
validation (2–30 MHz, ≥300 km) is enforced both here and in the TS layer —
the model must never see inputs outside its validity envelope (§9).
