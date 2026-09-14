/**
 * Phase 12J.2 Batch B — S32 controlled ladder legs A/B/C (EVIDENCE ONLY).
 *
 * Leg A: 12J.1 reproduction (15 deg mask, broadcast). Leg B: identical
 * except 10 deg mask. Leg C: 10 deg + TRUE precise ephemeris via a `-k`
 * conf containing `pos1-sateph=precise` (the ONLY CLI path that selects
 * EPHOPT_PREC in rnx2rtkp 2.5.1 — SP3-as-input alone stays broadcast) with
 * igs13793.sp3 as nav input, plus a `-x 3` trace proving precise
 * selection (`satposs ... ephopt=1`, zero `no prec ephem` failures).
 *
 * Read-only on the local vendor corpus
 * (~/Downloads/webnet-gnss-12e/raw-baselines/ — never committed); runs
 * into os.tmpdir(), never the repo. Fail-closed SKIP (exit 0) when the
 * corpus or the pinned binary is absent so CI stays green.
 *
 * Usage: npx tsx scripts/gnss/gnss12j2Ladder.ts [--json]
 */
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { existsSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

export const CORPUS_DIR = join(process.env['HOME'] ?? '~', 'Downloads/webnet-gnss-12e/raw-baselines');
export const RTKLIB_BIN = '/tmp/rtklib-evidence/app/consapp/rnx2rtkp/gcc/rnx2rtkp';
const RB = [-1283634.1259, -4726427.8882, 4074798.0251];
const TBC = [5822.646, -5654.885, -4846.085];
const H_ROV = 2.0;
const H_BASE = 0.0083;
const WINDOW = ['-ts', '2006/06/14', '17:24:30', '-te', '2006/06/14', '18:10:30'];
const BASE_INPUTS = ['01241653.06o', 'p0411650_2.06o', '01241653.06n', 'p0411650_2.06n'];

function skip(msg: string): never {
  console.log(`SKIP: ${msg}`);
  process.exit(0);
}

/** WGS84 ellipsoidal Up unit vector at an ECEF point. */
export function ecefUp(x: number, y: number, z: number): [number, number, number] {
  const a = 6378137.0;
  const e2 = (1 / 298.257223563) * (2 - 1 / 298.257223563);
  const p = Math.hypot(x, y);
  const lon = Math.atan2(y, x);
  let lat = Math.atan2(z, p * (1 - e2));
  for (let i = 0; i < 5; i++) {
    const n = a / Math.sqrt(1 - e2 * Math.sin(lat) ** 2);
    lat = Math.atan2(z + e2 * n * Math.sin(lat), p);
  }
  return [Math.cos(lat) * Math.cos(lon), Math.cos(lat) * Math.sin(lon), Math.sin(lat)];
}

export interface LadderEpoch {
  time: string;
  x: number;
  y: number;
  z: number;
  q: number;
  ns: number;
  cov: number[];
  ratio: number;
}

export function parseLadderPos(text: string): LadderEpoch[] {
  const out: LadderEpoch[] = [];
  for (const line of text.split('\n')) {
    if (!line.trim() || line.startsWith('%')) continue;
    const f = line.trim().split(/\s+/);
    if (f.length < 15) continue;
    out.push({
      time: `${f[0]} ${f[1]}`, x: Number(f[2]), y: Number(f[3]), z: Number(f[4]),
      q: Number(f[5]), ns: Number(f[6]),
      cov: [7, 8, 9, 10, 11, 12].map((i) => Number(f[i])), ratio: Number(f[14]),
    });
  }
  return out;
}

export interface LegResult {
  name: string;
  ms: number;
  epochs: number;
  fix: number;
  floatEpochs: string[];
  nsDist: Record<number, number>;
  finalRatio: number;
  rawVec: number[];
  redVec: number[];
  vsTbcMm: number;
  lenDeltaMm: number;
  cov: number[];
  bodySha: string;
  ephopt1?: number;
  noPrecFails?: number;
}

function analyze(name: string, pos: string, ms: number, trace?: string): LegResult {
  const epochs = parseLadderPos(pos);
  const last = epochs[epochs.length - 1];
  const fix = epochs.filter((e) => e.q === 1);
  const nsDist: Record<number, number> = {};
  for (const e of epochs) nsDist[e.ns] = (nsDist[e.ns] ?? 0) + 1;
  const rawVec = [last.x - RB[0], last.y - RB[1], last.z - RB[2]];
  const upRov = ecefUp(last.x, last.y, last.z);
  const upBase = ecefUp(RB[0], RB[1], RB[2]);
  const redVec = rawVec.map((v, i) => v - (H_ROV * upRov[i] - H_BASE * upBase[i]));
  const dist = (u: number[], v: number[]): number =>
    Math.sqrt(u.reduce((s, x, i) => s + (x - v[i]) ** 2, 0));
  const len = (v: number[]): number => Math.sqrt(v.reduce((s, x) => s + x * x, 0));
  const body = pos.split('\n').filter((l) => !l.startsWith('%')).join('\n');
  const leg: LegResult = {
    name, ms, epochs: epochs.length, fix: fix.length,
    floatEpochs: epochs.filter((e) => e.q === 2).map((e) => e.time),
    nsDist, finalRatio: last.ratio, rawVec, redVec,
    vsTbcMm: dist(redVec, TBC) * 1000, lenDeltaMm: (len(redVec) - len(TBC)) * 1000,
    cov: last.cov, bodySha: createHash('sha256').update(body).digest('hex').slice(0, 16),
  };
  if (trace !== undefined) {
    leg.ephopt1 = trace.split('\n').filter((l) => l.includes('ephopt=1')).length;
    leg.noPrecFails = trace.split('\n').filter((l) =>
      l.includes('no prec ephem') || l.includes('no precise clock')).length;
  }
  return leg;
}

function runLeg(dir: string, name: string, args: string[]): { pos: string; ms: number } {
  const out = join(dir, `${name}.pos`);
  const t0 = Date.now();
  execFileSync(RTKLIB_BIN, [...args, '-o', out], { stdio: 'pipe', timeout: 120_000, cwd: dir });
  return { pos: readFileSync(out, 'utf8'), ms: Date.now() - t0 };
}

function main(): void {
  if (!existsSync(CORPUS_DIR)) skip(`corpus absent: ${CORPUS_DIR}`);
  if (!existsSync(RTKLIB_BIN)) skip(`pinned binary absent: ${RTKLIB_BIN}`);
  for (const f of [...BASE_INPUTS, 'igs13793.sp3']) {
    if (!existsSync(join(CORPUS_DIR, f))) skip(`corpus file absent: ${f}`);
  }
  const c = (f: string): string => join(CORPUS_DIR, f);
  const dir = mkdtempSync(join(tmpdir(), 's32ladder-'));
  const base = [...WINDOW, '-e', '-t', '-r', ...RB.map(String)];

  const a = runLeg(dir, 'A', ['-p', '3', '-f', '2', '-m', '15',
    '-sys', 'G', '-v', '3.0', '-ti', '30', ...base,
    c('01241653.06o'), c('p0411650_2.06o'), c('01241653.06n'), c('p0411650_2.06n')]);
  const b = runLeg(dir, 'B', ['-p', '3', '-f', '2', '-m', '10',
    '-sys', 'G', '-v', '3.0', '-ti', '30', ...base,
    c('01241653.06o'), c('p0411650_2.06o'), c('01241653.06n'), c('p0411650_2.06n')]);
  writeFileSync(join(dir, 'prec.conf'), 'pos1-sateph=precise\n');
  const cc = runLeg(dir, 'C', ['-k', join(dir, 'prec.conf'), '-p', '3', '-f', '2', '-m', '10',
    '-sys', 'G', '-v', '3.0', '-ti', '30', ...base, '-x', '3',
    c('01241653.06o'), c('p0411650_2.06o'), c('01241653.06n'), c('p0411650_2.06n'), c('igs13793.sp3')]);
  const trace = readFileSync(join(dir, 'C.pos.trace'), 'utf8');

  const legs = [analyze('A', a.pos, a.ms), analyze('B', b.pos, b.ms), analyze('C', cc.pos, cc.ms, trace)];
  if (process.argv.includes('--json')) {
    console.log(JSON.stringify({ legs }, null, 2));
    return;
  }
  const f3 = (v: number[]): string => v.map((x) => x.toFixed(4)).join(' / ');
  for (const l of legs) {
    console.log(`leg ${l.name}: ${l.epochs} epochs, FIX ${l.fix}, FLOAT ${l.epochs - l.fix}, ` +
      `final ratio ${l.finalRatio}, ns ${JSON.stringify(l.nsDist)}, ${l.ms} ms, sha ${l.bodySha}`);
    console.log(`  raw dX/dY/dZ = ${f3(l.rawVec)}`);
    console.log(`  red dX/dY/dZ = ${f3(l.redVec)}  3DvsTBC ${l.vsTbcMm.toFixed(1)} mm  dLen ${l.lenDeltaMm.toFixed(1)} mm`);
    if (l.ephopt1 !== undefined) console.log(`  trace: ephopt=1 x${l.ephopt1}, precise-failures x${l.noPrecFails}`);
  }
  const d = (u: number[], v: number[]): string =>
    Math.sqrt(u.reduce((s, x, i) => s + (x - v[i]) ** 2, 0) * 1e6).toFixed(1);
  console.log(`B-A raw 3D: ${d(legs[1].rawVec, legs[0].rawVec)} mm; ` +
    `C-B raw 3D: ${d(legs[2].rawVec, legs[1].rawVec)} mm`);
}

const asMain = process.argv[1]?.endsWith('gnss12j2Ladder.ts') ?? false;
if (asMain) main();
