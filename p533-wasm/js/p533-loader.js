// Runtime loader for the P533 WASM module. Served as /p533/loader.js.
//
// Responsibilities (DESIGN.md §4 runtime data strategy):
//  1. Instantiate the Emscripten module (p533.js/p533.wasm alongside this file).
//  2. Load the bundled COEFF*.bin + decile table into MEMFS at /coeff.
//  3. Mount IDBFS at /data and ensure the CURRENT month's ionosNN.bin is
//     present — fetch it once from /data/ionosNN.bin on the server, persist
//     to IDBFS. On month rollover with no connectivity, fall back to any
//     cached month and report which one is in use.
//
// Exports: createP533() → (input, mhz) => reliability, plus a `status`
// object the UI can surface ("using March data — reconnect to update").

import createP533Module from './p533.js';

const MONTHS = ['01','02','03','04','05','06','07','08','09','10','11','12'];

async function fetchInto(Module, url, fsPath) {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`${url}: HTTP ${res.status}`);
  const buf = new Uint8Array(await res.arrayBuffer());
  Module.FS.writeFile(fsPath, buf);
  return buf.length;
}

function idbfsSync(Module, populate) {
  return new Promise((resolve, reject) => {
    Module.FS.syncfs(populate, (err) => (err ? reject(err) : resolve()));
  });
}

export const status = {
  ionosMonth: null,   // "01".."12" actually loaded
  currentMonth: null, // month it *should* be
  staleIonos: false,  // true when using a previous month's file offline
};

export async function createP533() {
  const Module = await createP533Module();

  // Tier 1: bundled coefficient files → MEMFS
  Module.FS.mkdir('/coeff');
  await Promise.all([
    ...MONTHS.map((m) =>
      fetchInto(Module, `/coeff/COEFF${m}W.bin`, `/coeff/COEFF${m}W.bin`),
    ),
    fetchInto(
      Module,
      '/coeff/P1239-3-decile-factors.txt',
      '/coeff/P1239-3 Decile Factors.txt',
    ),
  ]);

  // Tier 2: current month's ionospheric data → IDBFS (persisted)
  Module.FS.mkdir('/data');
  Module.FS.mount(Module.IDBFS, {}, '/data');
  await idbfsSync(Module, true); // pull any previously persisted months

  const now = new Date();
  const cur = MONTHS[now.getUTCMonth()];
  status.currentMonth = cur;
  const want = `/data/ionos${cur}.bin`;

  if (!Module.FS.analyzePath(want).exists) {
    try {
      await fetchInto(Module, `/data/ionos${cur}.bin`, want);
      await idbfsSync(Module, false); // persist the ~11MB download
      status.ionosMonth = cur;
    } catch {
      // Offline at month rollover: use the newest cached month (§4 step 3)
      const cached = Module.FS.readdir('/data')
        .filter((f) => /^ionos\d{2}\.bin$/.test(f))
        .sort();
      if (cached.length === 0) {
        throw new Error(
          'no ionospheric data cached — one online session is required before offline use',
        );
      }
      status.ionosMonth = cached[cached.length - 1].slice(5, 7);
      status.staleIonos = true;
    }
  } else {
    status.ionosMonth = cur;
  }

  const predict = Module.cwrap('p533_predict_reliability', 'number', [
    'number', 'number', 'number', 'number',
    'number', 'number', 'number', 'number',
  ]);

  // Matches the signature engine.ts expects: (CircuitInput, mhz) → 0..1
  return (input, mhz) => {
    const r = predict(
      input.de.lat, input.de.lon,
      input.dx.lat, input.dx.lon,
      mhz,
      Number(status.ionosMonth),
      input.utc.getUTCHours(),
      input.ssn12,
    );
    return r < 0 ? 0 : Math.min(1, r);
  };
}
