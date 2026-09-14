// Phase 12J.4 — reproducible rnx2rtkp WASM build from third_party/rtklib.
// Certified evidence flags (scripts/gnss/gnss12j1WasmStatic.ts) + EXPORT_ES6
// (package.json type:module breaks UMD) + ENVIRONMENT=worker,node so the
// module loads in workers as well as node. Fail-closed: emcc absent or any
// vendored source hash mismatches PIN.md aborts before compiling.
// Usage: node scripts/gnss/buildRtklibWasm.mjs
import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const VENDOR = join(ROOT, 'third_party', 'rtklib');
const OUT_DIR = join(ROOT, 'cpp', 'build-wasm');
const COMMIT = '62d4677ed8425a4e2748c6d390b500d1afb493fc';

const SRCS = [
  'app/consapp/rnx2rtkp/rnx2rtkp.c', 'src/rtkcmn.c', 'src/trace.c',
  'src/rinex.c', 'src/rtkpos.c', 'src/postpos.c', 'src/solution.c',
  'src/lambda.c', 'src/geoid.c', 'src/sbas.c', 'src/preceph.c',
  'src/pntpos.c', 'src/ephemeris.c', 'src/options.c', 'src/ppp.c',
  'src/ppp_ar.c', 'src/rtcm.c', 'src/rtcm2.c', 'src/rtcm3.c',
  'src/rtcm3e.c', 'src/ionex.c', 'src/tides.c', 'src/sofa.c',
];

// -ffile-prefix-map pins __FILE__ (lambda.c embeds it in diagnostics) to the
// canonical evidence-tree path, so .wasm bytes are identical on any machine
// and match the staging build byte-for-byte.
const FLAGS = [
  '-std=c99', '-O2', `-I${join(VENDOR, 'src')}`,
  `-ffile-prefix-map=${VENDOR}=/tmp/rtklib-evidence`,
  '-DTRACE', '-DENAGLO', '-DENAQZS', '-DENAGAL', '-DENACMP', '-DENAIRN',
  '-DNFREQ=4', '-DNEXOBS=3',
  '-s', 'MODULARIZE=1', '-s', 'EXPORT_NAME=Rnx2rtkp',
  '-s', 'EXPORT_ES6=1',
  '-s', 'ALLOW_MEMORY_GROWTH=1', '-s', 'INITIAL_MEMORY=128MB',
  '-s', 'STACK_SIZE=8MB', '-s', 'ENVIRONMENT=worker,node',
  '-s', 'FORCE_FILESYSTEM=1',
  '-s', 'EXPORTED_RUNTIME_METHODS=["callMain","FS","TTY"]',
  '-s', 'INVOKE_RUN=0',
];

const sha256 = (b) => createHash('sha256').update(b).digest('hex');

function findEmcc() {
  for (const c of ['emcc', '/usr/lib/emscripten/emcc']) {
    try {
      execFileSync(c, ['--version'], { stdio: 'pipe' });
      return c;
    } catch { /* next */ }
  }
  return null;
}

function pinHashes() {
  const pin = readFileSync(join(VENDOR, 'PIN.md'), 'utf8');
  const m = new Map();
  for (const match of pin.matchAll(/([0-9a-f]{64})\s+(\S+?)[`"']?\s*$/gm))
    m.set(match[2], match[1]);
  return m;
}

const emcc = findEmcc();
if (!emcc) {
  console.error('FAIL: emcc not found (install Emscripten or add it to PATH).');
  process.exit(1);
}

// Fail closed on any source/hash drift vs PIN.md.
const expected = pinHashes();
const sources = SRCS.map((rel) => {
  const p = join(VENDOR, rel);
  if (!existsSync(p)) {
    console.error(`FAIL: vendored source absent: ${rel}`);
    process.exit(1);
  }
  const h = sha256(readFileSync(p));
  if (expected.get(rel) !== h) {
    console.error(`FAIL: hash mismatch vs PIN.md: ${rel}`);
    process.exit(1);
  }
  return { path: rel, sha256: h };
});

mkdirSync(OUT_DIR, { recursive: true });
const js = join(OUT_DIR, 'rtklib-rnx2rtkp.js');
execFileSync(emcc, [...FLAGS, ...SRCS.map((s) => join(VENDOR, s)), '-o', js],
  { stdio: 'inherit', timeout: 280_000 });

const emccVersion = execFileSync(emcc, ['--version'], { encoding: 'utf8' }).split('\n')[0].trim();
const prov = {
  commit: COMMIT,
  emcc: emcc,
  emccVersion,
  flags: FLAGS,
  sources,
  outputs: {
    js: sha256(readFileSync(js)),
    wasm: sha256(readFileSync(join(OUT_DIR, 'rtklib-rnx2rtkp.wasm'))),
  },
};
writeFileSync(join(OUT_DIR, 'rtklib-rnx2rtkp.provenance.json'), JSON.stringify(prov, null, 2) + '\n');
console.log(`built ${js} wasm-sha256=${prov.outputs.wasm}`);
