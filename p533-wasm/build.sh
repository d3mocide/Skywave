#!/usr/bin/env bash
# Build P533 to WASM using the emscripten/emsdk Docker image, then install
# the artifacts into the frontend. See README.md in this directory.
set -euo pipefail
cd "$(dirname "$0")"

ITUR_REPO="https://github.com/ITU-R-Study-Group-3/ITU-R-HF.git"
EMSDK_IMAGE="emscripten/emsdk:3.1.61"

if [ ! -d vendor/ITU-R-HF ]; then
  echo "==> cloning ITU-R-HF (shallow)"
  git clone --depth 1 "$ITUR_REPO" vendor/ITU-R-HF
fi

echo "==> compiling P533 + wrapper with Emscripten"
docker run --rm -v "$PWD":/src -w /src "$EMSDK_IMAGE" bash -c '
  set -euo pipefail
  mkdir -p dist
  emcc \
    vendor/ITU-R-HF/P533/Src/*.c \
    wrapper.c \
    -I vendor/ITU-R-HF/P533/Src \
    -O2 \
    -sMODULARIZE -sEXPORT_ES6 -sEXPORT_NAME=createP533Module \
    -sALLOW_MEMORY_GROWTH \
    -sEXPORTED_FUNCTIONS=_p533_predict_reliability,_malloc,_free \
    -sEXPORTED_RUNTIME_METHODS=cwrap,FS,IDBFS \
    -lidbfs.js \
    -o dist/p533.js
'

echo "==> installing artifacts into frontend"
mkdir -p ../frontend/public/p533 ../frontend/public/coeff
cp dist/p533.js dist/p533.wasm ../frontend/public/p533/
cp js/p533-loader.js ../frontend/public/p533/loader.js
cp vendor/ITU-R-HF/P533/Data/COEFF*.bin ../frontend/public/coeff/
cp "vendor/ITU-R-HF/P533/Data/P1239-3 Decile Factors.txt" \
   "../frontend/public/coeff/P1239-3-decile-factors.txt"

cat <<'MSG'

Done. The frontend will auto-detect /p533/p533.js at runtime and switch the
propagation engine badge from "estimate" to "P.533".

Remember the monthly ionospheric files: copy ionos01.bin..ionos12.bin from
vendor/ITU-R-HF/P533/Data/ to your ionos-data volume so the app can fetch
/data/ionosNN.bin for the current month (11.2 MB, fetched once per month).
MSG
