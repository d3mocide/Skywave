#!/usr/bin/env bash
# Build P533 (+ statically linked P372 noise model) to WASM using the
# emscripten/emsdk Docker image, then install the artifacts into the
# frontend. See README.md in this directory.
set -euo pipefail
cd "$(dirname "$0")"

ITUR_REPO="https://github.com/ITU-R-Study-Group-3/ITU-R-HF.git"
EMSDK_IMAGE="emscripten/emsdk:3.1.61"

if [ ! -d vendor/ITU-R-HF ]; then
  echo "==> cloning ITU-R-HF (shallow)"
  git clone --depth 1 "$ITUR_REPO" vendor/ITU-R-HF
fi

echo "==> compiling P533 + P372 + wrapper with Emscripten"
# -D__linux__: selects upstream's dlopen code path (satisfied by the shims in
#   wrapper.c) and the dll* global declarations in Noise.h.
# -fcommon: Noise.h defines (not declares) those globals in a header included
#   by many translation units; upstream's Linux Makefile relies on common
#   symbol merging, which modern clang disables by default.
docker run --rm -v "$PWD":/src -w /src "$EMSDK_IMAGE" bash -c '
  set -euo pipefail
  mkdir -p dist
  emcc \
    vendor/ITU-R-HF/P533/Src/P533/*.c \
    vendor/ITU-R-HF/P372/Src/P372/Noise.c \
    vendor/ITU-R-HF/P372/Src/P372/NoiseMemory.c \
    vendor/ITU-R-HF/P372/Src/P372/InitializeNoise.c \
    wrapper.c \
    -I vendor/ITU-R-HF/P533/Src/P533 \
    -D__linux__ -fcommon -O2 \
    -sMODULARIZE -sEXPORT_ES6 -sEXPORT_NAME=createP533Module \
    -sALLOW_MEMORY_GROWTH \
    -sSTACK_SIZE=8388608 \
    -sEXPORTED_FUNCTIONS=_p533_predict_reliability \
    -sEXPORTED_RUNTIME_METHODS=cwrap,FS,IDBFS \
    -lidbfs.js \
    -o dist/p533.js
'

echo "==> installing artifacts into frontend"
mkdir -p ../frontend/public/p533 ../frontend/public/coeff
cp dist/p533.js dist/p533.wasm ../frontend/public/p533/
cp js/p533-loader.js ../frontend/public/p533/loader.js
# P372 atmospheric-noise coefficients (ReadFamDud reads the .txt flavor) and
# the MUF decile table — small enough to bundle with the app (DESIGN.md §4).
cp vendor/ITU-R-HF/P533/Data/COEFF*.txt ../frontend/public/coeff/
cp "vendor/ITU-R-HF/P533/Data/P1239-3 Decile Factors.txt" \
   "../frontend/public/coeff/P1239-3-decile-factors.txt"

cat <<'MSG'

Done. The frontend will auto-detect /p533/loader.js at runtime and switch the
propagation engine badge from "estimate" to "P.533".

Remember the monthly ionospheric files: copy ionos01.bin..ionos12.bin from
vendor/ITU-R-HF/P533/Data/ into the ionos-data volume (they are served at
/data/ionosNN.bin; the app fetches the current month, ~11 MB, once per month):

  for f in vendor/ITU-R-HF/P533/Data/ionos*.bin; do
    docker compose cp "$f" caddy:/srv/ionos/
  done
MSG
