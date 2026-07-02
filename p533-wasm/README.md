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

- `COEFF01W.txt`–`COEFF12W.txt` (~230 KB each, ~2.8 MB total; gzip serves
  ~25% of that) and `P1239-3 Decile Factors.txt`: copied by `build.sh` into
  `../frontend/public/coeff/` — bundled with the app. Note: the design doc
  originally assumed the ~40 KB `.BIN` coefficient files, but P372's
  `ReadFamDud()` only parses the `.txt` flavor, so those are what ships.
- `ionosNN.bin` (11.2 MB **per month**): NOT bundled. Serve them from
  `/data/` (see `docker-compose.yml`'s `ionos-data` volume); the app fetches
  only the current month's file on first online session and persists it via
  IDBFS. On month rollover the app fetches the new month in the background
  and keeps using the prior month (with a visible notice) when offline.

## Wrapper contract

`wrapper.c` exposes a single flat function so no struct layout crosses the
JS boundary:

```c
double p533_predict_reliability(
    double tx_lat_deg, double tx_lon_deg,
    double rx_lat_deg, double rx_lon_deg,
    double freq_mhz, int month /*1-12*/, int hour_utc, double ssn12);
```

Returns basic circuit reliability (0–1) or a negative error code. Input
validation (2–30 MHz, ≥300 km) is enforced both here and in the TS layer —
the model must never see inputs outside its validity envelope (§9).

Fixed circuit assumptions (v1): 100 W, isotropic antennas both ends, rural
man-made noise, and a required SNR of −10 dB in 3 kHz (≈25 dB·Hz — VOACAP's
CW threshold), so "reliability" reads as "a CW-grade contact is workable".
A per-mode/power/antenna selector is a v2 item.

## Porting notes (why the build flags look like that)

- `-D__linux__`: selects upstream's dlopen code path and the `dll*` global
  declarations in `Noise.h`; `wrapper.c` provides dlopen/dlsym shims that
  resolve to the statically-linked P372 objects, so no upstream source is
  patched.
- `-fcommon` + strong definitions in `wrapper.c`: `Noise.h` *defines* the
  P372 function-pointer globals in every translation unit; wasm-ld has no
  common-symbol merging, so the wrapper owns the single real definition.
- `-sSTACK_SIZE=8388608`: `MedianSkywaveFieldStrengthLong()` keeps large
  arrays on the stack and overflows Emscripten's 64 KB default immediately.
- WASM output is verified bit-identical in behavior to a native gcc build of
  the same sources across a 4-hour × 9-band matrix.
