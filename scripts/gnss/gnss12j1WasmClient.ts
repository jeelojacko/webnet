/**
 * Phase 12J.1 Batch F — EVIDENCE ONLY shared S32 oracle constants + prebuilt
 * WASM loader.
 *
 * Why this file exists: scripts/gnss/gnss12j1WasmStatic.ts runs its CLI main
 * unconditionally on import (rebuilds via emcc), so Batch F evidence scripts
 * MUST NOT import it (and existing files are frozen). The values below are
 * copied verbatim from that module's exports (S32 oracle, Batch A pin
 * record); the MEMFS driver mirrors its §31 processStaticBaseline API
 * against the PREBUILT /tmp/webnet-12j1-wasm/rnx2rtkp.js (run
 * gnss12j1WasmStatic.ts once to build). No vendor bytes.
 */
import { createHash } from 'node:crypto';

export const S32_BASE_XYZ: [number, number, number] = [-1283634.1259, -4726427.8882, 4074798.0251];
export const S32_ARGS: string[] = [
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

export interface WasmBaselineResult {
  status: 'FIX' | 'FLOAT' | 'NONE';
  deltaX: number;
  deltaY: number;
  deltaZ: number;
  covariance: [number, number, number, number, number, number];
  ratio: number;
  satellites: number;
  epochs: number;
  processMs: number;
  posBodySha256: string;
}

interface WasmModule {
  FS: {
    mkdir(_p: string): void;
    writeFile(_p: string, _d: Uint8Array): void;
    readFile(_p: string, _o: { encoding: 'utf8' }): string;
    unlink(_p: string): void;
  };
  callMain(_a: string[]): number;
}

const WORK = '/work';

/** Drive the prebuilt module through the same MEMFS API as §31 (copy semantics). */
export async function runPrebuiltWasm(
  jsPath: string,
  roverObs: Uint8Array,
  baseObs: Uint8Array,
  nav: Uint8Array[],
  baseXyz: [number, number, number],
  extraArgs: string[] = S32_ARGS,
): Promise<WasmBaselineResult> {
  const mod = (await (
    (await import(jsPath)) as { default: () => Promise<WasmModule> }
  ).default()) as WasmModule;
  try {
    mod.FS.mkdir(WORK);
  } catch {
    /* exists */
  }
  const out = `${WORK}/out.pos`;
  try {
    mod.FS.unlink(out);
  } catch {
    /* absent */
  }
  mod.FS.writeFile(`${WORK}/rover.obs`, roverObs);
  mod.FS.writeFile(`${WORK}/base.obs`, baseObs);
  const navPaths = nav.map((buf, i) => {
    const p = `${WORK}/nav${i}.nav`;
    mod.FS.writeFile(p, buf);
    return p;
  });
  const t0 = performance.now();
  try {
    mod.callMain([...extraArgs, '-o', out, '-r', ...baseXyz.map(String),
      `${WORK}/rover.obs`, `${WORK}/base.obs`, ...navPaths]);
  } catch (e: unknown) {
    const st = (e as { status?: number })?.status;
    if (st !== undefined && st !== 0) throw new Error(`wasm rnx2rtkp exited with status ${st}`);
  }
  const ms = performance.now() - t0;
  const pos = mod.FS.readFile(out, { encoding: 'utf8' });
  const body = pos.split('\n').filter((l) => l && !l.startsWith('%'));
  const data = body;
  const last = data.filter((l) => l.trim().split(/\s+/)[5] === '1').pop() ?? data[data.length - 1] ?? '';
  const f = last.trim().split(/\s+/);
  const q = Number(f[5] ?? 0);
  return {
    status: q === 1 ? 'FIX' : q === 2 ? 'FLOAT' : 'NONE',
    deltaX: Number(f[2]) - baseXyz[0],
    deltaY: Number(f[3]) - baseXyz[1],
    deltaZ: Number(f[4]) - baseXyz[2],
    covariance: [7, 8, 9, 10, 11, 12].map((i) => Number(f[i] ?? NaN)) as WasmBaselineResult['covariance'],
    ratio: Number(f[14] ?? NaN),
    satellites: Number(f[6] ?? NaN),
    epochs: data.length,
    processMs: ms,
    posBodySha256: createHash('sha256').update(data.join('\n')).digest('hex'),
  };
}
