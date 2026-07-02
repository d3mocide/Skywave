// Runtime loader for the P533 WASM module. Served as /p533/loader.js.
//
// Responsibilities (DESIGN.md §4 runtime data strategy):
//  1. Instantiate the Emscripten module (p533.js/p533.wasm alongside this file).
//  2. Mount IDBFS at /data (persistent) and populate it:
//     - bundled COEFF01W.txt..COEFF12W.txt + P1239 decile table (small,
//       shipped with the app under /coeff/)
//     - the CURRENT month's ionosNN.bin — fetched once from the server's
//       /data/ionosNN.bin (~11 MB), persisted to IDBFS. On month rollover
//       with no connectivity, fall back to the newest cached month and
//       report which one is in use.
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

  Module.FS.mkdir('/data');
  Module.FS.mount(Module.IDBFS, {}, '/data');
  await idbfsSync(Module, true); // pull previously persisted files

  // Small bundled files: refresh from the app bundle every boot (cheap, and
  // it heals a partially-evicted IDBFS).
  await Promise.all([
    ...MONTHS.map((m) =>
      fetchInto(Module, `/coeff/COEFF${m}W.txt`, `/data/COEFF${m}W.txt`),
    ),
    fetchInto(
      Module,
      '/coeff/P1239-3-decile-factors.txt',
      '/data/P1239-3 Decile Factors.txt',
    ),
  ]);

  // Current month's ionospheric data (11 MB) — the one real download.
  const now = new Date();
  const cur = MONTHS[now.getUTCMonth()];
  status.currentMonth = cur;
  const want = `/data/ionos${cur}.bin`;

  if (!Module.FS.analyzePath(want).exists) {
    try {
      await fetchInto(Module, `/data/ionos${cur}.bin`, want);
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

  await idbfsSync(Module, false); // persist everything we just wrote

  const predict = Module.cwrap('p533_predict_reliability', 'number', [
    'number', 'number', 'number', 'number',
    'number', 'number', 'number', 'number',
  ]);

  // Matches the signature engine.ts expects: (CircuitInput, mhz) → 0..1.
  // Negative return values are wrapper error codes; the TS layer's own
  // validity guards should prevent them, so treat any as "no prediction".
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
