/**
 * Phase 12J.1 Batch E §§29-35 — EVIDENCE ONLY.
 *
 * WASM proof for pinned RTKLIB static relative GPS L1/L2 (S32 oracle).
 * Rebuilds the wasm module at runtime from /tmp/rtklib-evidence (never
 * committed), drives it via an in-memory-FS adapter, and checks CLI↔WASM
 * exactness + repeat determinism + memory/perf. Fail-closed SKIP (exit 0)
 * when the corpus, RTKLIB tree, native CLI, or emcc is absent.
 *
 * Usage:
 *   npx tsx scripts/gnss/gnss12j1WasmStatic.ts [--skip-build] [--json]
 *
 * Corpus + RTKLIB are local-only inputs; nothing under ~/Downloads or /tmp
 * is committed. No src/ production integration.
 */
import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import {
  existsSync,
  mkdirSync,
  readFileSync,
  statSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

export const CORPUS_DIR = join(
  process.env['HOME'] ?? '~',
  'Downloads/webnet-gnss-12e/raw-baselines',
);
export const RTKLIB_DIR = '/tmp/rtklib-evidence';
export const CLI_BIN = join(RTKLIB_DIR, 'app/consapp/rnx2rtkp/gcc/rnx2rtkp');
export const EMCC = '/usr/lib/emscripten/emcc';

// Exact S32 oracle (Batch A pin record): P041 base XYZ + processing options.
export const S32_BASE_XYZ = [-1283634.1259, -4726427.8882, 4074798.0251];
export const S32_ARGS = [
  '-p', '3', '-f', '2', '-m', '15', '-sys', 'G', '-v', '3.0', '-ti', '30',
  '-ts', '2006/06/14', '17:24:30', '-te', '2006/06/14', '18:10:30',
  '-e', '-t',
];
export const S32_FILES = {
  roverObs: '01241653.06o',
  baseObs: 'p0411650_2.06o',
  roverNav: '01241653.06n',
  baseNav: 'p0411650_2.06n',
} as const;

// §29 — full rnx2rtkp object set (same translation units as the gcc build).
const RTKLIB_SRCS = [
  'app/consapp/rnx2rtkp/rnx2rtkp.c', 'src/rtkcmn.c', 'src/trace.c',
  'src/rinex.c', 'src/rtkpos.c', 'src/postpos.c', 'src/solution.c',
  'src/lambda.c', 'src/geoid.c', 'src/sbas.c', 'src/preceph.c',
  'src/pntpos.c', 'src/ephemeris.c', 'src/options.c', 'src/ppp.c',
  'src/ppp_ar.c', 'src/rtcm.c', 'src/rtcm2.c', 'src/rtcm3.c',
  'src/rtcm3e.c', 'src/ionex.c', 'src/tides.c', 'src/sofa.c',
];
export const EMCC_DEFINE_OPTS = [
  '-DTRACE', '-DENAGLO', '-DENAQZS', '-DENAGAL', '-DENACMP', '-DENAIRN',
  '-DNFREQ=4', '-DNEXOBS=3',
];
export const EMCC_FLAGS = [
  '-std=c99', '-O2', `-I${join(RTKLIB_DIR, 'src')}`, ...EMCC_DEFINE_OPTS,
  '-s', 'MODULARIZE=1', '-s', 'EXPORT_NAME=Rnx2rtkp',
  '-s', 'ALLOW_MEMORY_GROWTH=1', '-s', 'INITIAL_MEMORY=128MB',
  // PROVEN NEED (§29): default 64 KiB stack traps inside readrnx/rtkpos
  // ("memory access out of bounds"); 8 MiB fixes it, nothing else changed.
  '-s', 'STACK_SIZE=8MB', '-s', 'ENVIRONMENT=node',
  '-s', 'FORCE_FILESYSTEM=1',
  '-s', 'EXPORTED_RUNTIME_METHODS=["callMain","FS","TTY"]',
  '-s', 'INVOKE_RUN=0',
];

export interface BaselineInputs {
  roverObs: Uint8Array;
  baseObs: Uint8Array;
  nav: Uint8Array[]; // rover nav first, then base nav
  baseXyz: [number, number, number];
  extraArgs?: string[]; // time window etc; defaults to S32_ARGS
}

export interface BaselineResult {
  status: 'FIX' | 'FLOAT' | 'NONE';
  deltaX: number;
  deltaY: number;
  deltaZ: number;
  /** 6 covariance terms (m) exactly as printed in the .pos line. */
  covariance: [number, number, number, number, number, number];
  ratio: number;
  satellites: number;
  epochs: number;
  diagnostics: {
    posLines: number;
    sha256: string;
    processMs: number;
    rawPos: string;
  };
}

// §30 — deterministic MEMFS names; fixed set, no host paths, no traversal.
// Copy semantics: writeFile copies the buffer into MEMFS; readFile copies
// out. Caller buffers are never retained. Outputs are unlinked before each
// run so a failed run can never return a stale solution.
const WORK = '/work';
const NAMES = {
  roverObs: `${WORK}/rover.obs`,
  baseObs: `${WORK}/base.obs`,
  nav: [`${WORK}/nav0.nav`, `${WORK}/nav1.nav`],
  out: `${WORK}/out.pos`,
};

type WasmModule = {
  FS: {
    mkdir(_p: string): void;
    writeFile(_p: string, _d: Uint8Array): void;
    readFile(_p: string, _o: { encoding: 'utf8' }): string;
    unlink(_p: string): void;
  };
  callMain(_a: string[]): number;
};

async function loadModule(jsPath: string): Promise<WasmModule> {
  const ns = (await import(jsPath)) as { default: () => Promise<WasmModule> };
  return ns.default();
}

/** §31 — evidence-only JS API. No raw RTKLIB structs cross the boundary;
 *  the .pos text output is parsed into plain JSON. */
export function makeProcessor(mod: WasmModule) {
  try {
    mod.FS.mkdir(WORK);
  } catch {
    /* exists */
  }
  return function processStaticBaseline(
    inp: BaselineInputs,
  ): BaselineResult {
    try {
      mod.FS.unlink(NAMES.out);
    } catch {
      /* absent */
    }
    mod.FS.writeFile(NAMES.roverObs, inp.roverObs);
    mod.FS.writeFile(NAMES.baseObs, inp.baseObs);
    const navPaths: string[] = [];
    inp.nav.forEach((buf, i) => {
      const p = NAMES.nav[i] ?? `${WORK}/nav${i}.nav`;
      mod.FS.writeFile(p, buf);
      navPaths.push(p);
    });
    const args = [
      ...(inp.extraArgs ?? S32_ARGS),
      '-o', NAMES.out,
      '-r', ...inp.baseXyz.map(String),
      NAMES.roverObs, NAMES.baseObs, ...navPaths,
    ];
    const t0 = performance.now();
    try {
      mod.callMain(args);
    } catch (e: unknown) {
      const st = (e as { status?: number })?.status;
      if (st !== undefined && st !== 0)
        throw new Error(`wasm rnx2rtkp exited with status ${st}`);
      // Emscripten exit(0) throws; a zero-status throw means success.
    }
    const ms = performance.now() - t0;
    const pos = mod.FS.readFile(NAMES.out, { encoding: 'utf8' });
    const data = pos.split('\n').filter((l) => l && !l.startsWith('%'));
    const last = data.filter((l) => l.trim().split(/\s+/)[5] === '1').pop()
      ?? data[data.length - 1] ?? '';
    const f = last.trim().split(/\s+/);
    const q = Number(f[5] ?? 0);
    const xyz = [Number(f[2]), Number(f[3]), Number(f[4])];
    return {
      status: q === 1 ? 'FIX' : q === 2 ? 'FLOAT' : 'NONE',
      deltaX: xyz[0]! - inp.baseXyz[0],
      deltaY: xyz[1]! - inp.baseXyz[1],
      deltaZ: xyz[2]! - inp.baseXyz[2],
      covariance: [7, 8, 9, 10, 11, 12].map((i) => Number(f[i] ?? NaN)) as BaselineResult['covariance'],
      ratio: Number(f[14] ?? NaN),
      satellites: Number(f[6] ?? NaN),
      epochs: data.length,
      diagnostics: {
        posLines: data.length,
        sha256: createHash('sha256').update(pos).digest('hex'),
        processMs: ms,
        rawPos: pos,
      },
    };
  };
}

function readCorpus(name: string): Uint8Array {
  return new Uint8Array(readFileSync(join(CORPUS_DIR, name)));
}

function missingPrereqs(): string | null {
  if (!existsSync(CORPUS_DIR)) return `corpus dir absent: ${CORPUS_DIR}`;
  for (const f of Object.values(S32_FILES))
    if (!existsSync(join(CORPUS_DIR, f))) return `corpus file absent: ${f}`;
  if (!existsSync(join(RTKLIB_DIR, 'src/rtklib.h')))
    return `shared RTKLIB tree absent: ${RTKLIB_DIR}`;
  if (!existsSync(CLI_BIN)) return `native CLI absent: ${CLI_BIN}`;
  if (!existsSync(EMCC)) return `emcc absent: ${EMCC}`;
  return null;
}

function buildModule(outDir: string): { js: string } {
  mkdirSync(outDir, { recursive: true });
  const js = join(outDir, 'rnx2rtkp.js');
  const srcs = RTKLIB_SRCS.map((s) => join(RTKLIB_DIR, s));
  execFileSync(EMCC, [...EMCC_FLAGS, ...srcs, '-o', js],
    { stdio: 'pipe', timeout: 280_000 });
  return { js };
}

/** §32 — line/field diff of CLI vs WASM .pos (input-file header excluded:
 *  host paths vs MEMFS paths by construction). */
export function diffPos(cli: string, wasm: string) {
  const norm = (t: string) =>
    t.split('\n').map((l) =>
      l.startsWith('% inp file') ? '% inp file  : <path>' : l);
  const c = norm(cli);
  const w = norm(wasm);
  const differing = c.map((l, i) => (l === w[i] ? -1 : i)).filter((i) => i >= 0);
  let maxAbs = 0;
  let maxAt = '';
  c.forEach((l, i) => {
    if (!l || l.startsWith('%')) return;
    const a = l.trim().split(/\s+/);
    const b = (w[i] ?? '').trim().split(/\s+/);
    a.forEach((x, k) => {
      const d = Math.abs(Number(x) - Number(b[k]));
      if (Number.isFinite(d) && d > maxAbs) {
        maxAbs = d;
        maxAt = `line ${i} field ${k}: ${x} vs ${b[k]}`;
      }
    });
  });
  return {
    cliLines: c.length,
    wasmLines: w.length,
    differingLines: differing,
    maxAbsNumericDiff: maxAbs,
    maxAt,
  };
}

async function main(): Promise<void> {
  const json = process.argv.includes('--json');
  const skipBuild = process.argv.includes('--skip-build');
  const miss = missingPrereqs();
  if (miss) {
    console.log(JSON.stringify({ skipped: true, reason: miss }));
    return;
  }
  const outDir = join(tmpdir(), 'webnet-12j1-wasm');
  if (!skipBuild) buildModule(outDir);
  const js = join(outDir, 'rnx2rtkp.js');
  const wasmBytes = statSync(join(outDir, 'rnx2rtkp.wasm')).size;
  const jsBytes = statSync(js).size;

  const s32: BaselineInputs = {
    roverObs: readCorpus(S32_FILES.roverObs),
    baseObs: readCorpus(S32_FILES.baseObs),
    nav: [readCorpus(S32_FILES.roverNav), readCorpus(S32_FILES.baseNav)],
    baseXyz: S32_BASE_XYZ as [number, number, number],
  };

  // §32 reference: native CLI on identical bytes/options.
  const tCli0 = performance.now();
  execFileSync(CLI_BIN, [...S32_ARGS, '-o', join(outDir, 's32_cli.pos'), '-r',
    ...S32_BASE_XYZ.map(String),
    ...Object.values(S32_FILES).map((f) => join(CORPUS_DIR, f)),
  ], { stdio: 'pipe', timeout: 60_000 });
  const cliMs = performance.now() - tCli0;
  const cliText = readFileSync(join(outDir, 's32_cli.pos'), 'utf8');

  const tInit0 = performance.now();
  const process_ = makeProcessor(await loadModule(js));
  const initMs = performance.now() - tInit0;

  // §33 — same instance x3, then interleave another occupation, then again.
  const runs = [process_(s32), process_(s32), process_(s32)];
  const alt: BaselineInputs = {
    ...s32,
    roverObs: readCorpus('01241654.06o'),
    baseObs: readCorpus('p0411650_1.06o'),
    nav: [readCorpus('01241654.06n'), readCorpus('p0411650_1.06n')],
    extraArgs: ['-p', '3', '-f', '2', '-m', '15', '-sys', 'G', '-v', '3.0'],
  };
  const altRes = process_(alt);
  const post = process_(s32);
  // Fresh instance x1.
  const fresh = makeProcessor(await loadModule(js))(s32);

  const diff = diffPos(cliText, runs[0]!.diagnostics.rawPos);
  const report = {
    build: { wasmBytes, jsBytes, emccFlags: EMCC_FLAGS },
    cli: { processMs: Math.round(cliMs) },
    initMs: Math.round(initMs),
    wasm: {
      status: runs[0]!.status,
      delta: [runs[0]!.deltaX, runs[0]!.deltaY, runs[0]!.deltaZ],
      covariance: runs[0]!.covariance,
      ratio: runs[0]!.ratio,
      satellites: runs[0]!.satellites,
      epochs: runs[0]!.epochs,
      processMs: runs.map((r) => Math.round(r.diagnostics.processMs)),
    },
    cliWasmDiff: diff,
    determinism: {
      sameInstance: runs.every((r) =>
        r.diagnostics.sha256 === runs[0]!.diagnostics.sha256),
      postInterleave: post.diagnostics.sha256 === runs[0]!.diagnostics.sha256,
      freshInstance: fresh.diagnostics.sha256 === runs[0]!.diagnostics.sha256,
      altEpochs: altRes.epochs,
    },
  };
  console.log(json ? JSON.stringify(report) : JSON.stringify(report, null, 2));
}

void main().catch((e: unknown) => {
  console.error(`FAIL: ${(e as Error).message}`);
  process.exit(1);
});
