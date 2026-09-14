/**
 * Phase 12J.2 Batch E §§35-42 — EVIDENCE ONLY (one-file cohort + WASM + end-to-end).
 *
 * Reruns ALL FIVE P041<->0124 legs with the finalized Batch B policy
 * (10° mask + TRUE precise via `-k prec.conf` + igs13793.sp3 + GPS-only
 * `-f 2` FIXED, no antenna calibration), then finalized-config CLI<->WASM
 * parity on S32 (incl. SP3 fail-closed + determinism), then the S32
 * canonical end-to-end through the existing §36 adapter + WebNet report.
 *
 * Read-only on the local corpus (~/Downloads/webnet-gnss-12e/raw-baselines/,
 * never committed); runs into os.tmpdir(). Fail-closed SKIP (exit 0) when
 * the corpus, pinned binary, or prebuilt WASM is absent. No src/ changes.
 *
 * Usage: npx tsx scripts/gnss/gnss12j2Cohort.ts [--json]
 */
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { existsSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { buildGnssReportFromInput } from '../../src/engine/gnssBaselineReport';
import type { StationMap } from '../../src/types';
import { MARKER_TO_MARKER_ECEF, adaptRawBaselineToObservation } from './gnss12j1CanonicalAdapter';
import { COHORT, markerCorrection } from './gnss12j1Cohort';

const CORPUS = join(process.env['HOME'] ?? '~', 'Downloads/webnet-gnss-12e/raw-baselines');
const CLI = '/tmp/rtklib-evidence/app/consapp/rnx2rtkp/gcc/rnx2rtkp';
const WASM_JS = join(tmpdir(), 'webnet-12j1-wasm', 'rnx2rtkp.js');
const BASE: [number, number, number] = [-1283634.1259, -4726427.8882, 4074798.0251];
const SP3 = 'igs13793.sp3';
const c = (f: string): string => join(CORPUS, f);
const skip = (m: string): never => { console.log(`SKIP: ${m}`); process.exit(0); };

type V3 = [number, number, number];
const sub = (a: number[], b: number[]): V3 => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
const norm = (a: number[]): number => Math.hypot(a[0], a[1], a[2]);
const E2 = (1 / 298.257223563) * (2 - 1 / 298.257223563);
function upAt(xyz: number[]): V3 {
  const p = Math.hypot(xyz[0], xyz[1]);
  let la = Math.atan2(xyz[2], p * (1 - E2));
  for (let i = 0; i < 5; i++) la = Math.atan2(xyz[2] + E2 * 6378137 / Math.sqrt(1 - E2 * Math.sin(la) ** 2) * Math.sin(la), p);
  const lo = Math.atan2(xyz[1], xyz[0]);
  return [Math.cos(la) * Math.cos(lo), Math.cos(la) * Math.sin(lo), Math.sin(la)];
}
/** H/V split of a discrepancy + TBC flag/pass classification at leg length. */
export function classify(dv: V3, marked: V3, tbc: number[]): { h: number; v: number; verdict: string } {
  const up = upAt([BASE[0] + marked[0], BASE[1] + marked[1], BASE[2] + marked[2]]);
  const v = Math.abs(dv[0] * up[0] + dv[1] * up[1] + dv[2] * up[2]);
  const h = Math.sqrt(Math.max(0, norm(dv) ** 2 - v ** 2));
  const L = norm(tbc);
  const hf = 0.02 + L * 1e-6; const vf = 0.05 + L * 1e-6;
  const hF = 0.05 + L * 1e-6; const vF = 0.1 + L * 1e-6;
  const verdict = h > hF || v > vF ? 'FAIL' : h > hf || v > vf ? 'FLAG' : 'PASS';
  return { h: h * 1000, v: v * 1000, verdict };
}

interface Ep { q: number; ns: number; x: number; y: number; z: number; cov: number[]; ratio: number }
function parsePos(text: string): Ep[] {
  const out: Ep[] = [];
  for (const line of text.split('\n')) {
    if (!line.trim() || line.startsWith('%')) continue;
    const f = line.trim().split(/\s+/).map(Number);
    if (f.length < 15 || !Number.isFinite(f[5])) continue;
    out.push({ q: f[5], ns: f[6], x: f[2], y: f[3], z: f[4],
      cov: [f[7], f[8], f[9], f[10], f[11], f[12]], ratio: f[14] });
  }
  return out;
}
interface LegOut { args: string[]; pos: string; ms: number }
function runCli(dir: string, name: string, args: string[]): LegOut {
  const out = join(dir, `${name}.pos`);
  const t0 = Date.now();
  execFileSync(CLI, [...args, '-o', out], { stdio: 'pipe', timeout: 300_000 });
  return { args, pos: readFileSync(out, 'utf8'), ms: Date.now() - t0 };
}
function summarize(id: string, run: LegOut, tbc: number[], corr: V3, baseObs: string, rovObs: string):
  Record<string, number | string | number[]> {
  const ep = parsePos(run.pos);
  const fix = ep.filter((e) => e.q === 1);
  const last = fix[fix.length - 1];
  const raw = sub([last.x, last.y, last.z], BASE);
  const marked = sub(raw, corr);
  const dv = sub(marked, tbc);
  const cl = classify(dv as V3, marked as V3, tbc);
  const body = run.pos.split('\n').filter((l) => !l.startsWith('%')).join('\n');
  void baseObs; void rovObs;
  return { id, fix: fix.length, total: ep.length, ratio: last.ratio,
    ns: last.ns, dX: dv[0] * 1000, dY: dv[1] * 1000, dZ: dv[2] * 1000,
    d3: norm(dv) * 1000, dH: cl.h, dV: cl.v, verdict: cl.verdict,
    dLen: (norm(marked) - norm(tbc)) * 1000, len: norm(marked),
    sig: [last.cov[0], last.cov[1], last.cov[2]].map((s) => Math.abs(s) * 1000),
    ms: run.ms, sha: createHash('sha256').update(body).digest('hex').slice(0, 16) };
}

interface Wm { FS: { mkdir(_p: string): void; writeFile(_p: string, _d: Uint8Array): void;
  readFile(_p: string, _o: { encoding: 'utf8' }): string; unlink(_p: string): void };
  callMain(_a: string[]): number }
async function wasmRun(mod: Wm, tag: string, extra: string[], files: Record<string, Uint8Array>, withTrace: boolean):
  Promise<{ status: string; dx: number[]; cov: number[]; ratio: number; ns: number; epochs: number; sha: string; ephopt1: number }> {
  const W = '/work';
  try { mod.FS.mkdir(W); } catch { /* exists */ }
  for (const [n, b] of Object.entries(files)) mod.FS.writeFile(`${W}/${n}`, b);
  const out = `${W}/${tag}.pos`;
  try { mod.FS.unlink(out); } catch { /* absent */ }
  const navKeys = Object.keys(files).filter((k) => k.startsWith('nav'));
  const args = [...extra, '-o', out, '-r', ...BASE.map(String),
    `${W}/rover.obs`, `${W}/base.obs`, ...navKeys.map((k) => `${W}/${k}`)];
  if (withTrace) args.push('-x', '3');
  try { mod.callMain(args); } catch (e: unknown) {
    const st = (e as { status?: number })?.status;
    if (st !== undefined && st !== 0) throw new Error(`wasm exit ${st}`);
  }
  const pos = mod.FS.readFile(out, { encoding: 'utf8' });
  const ep = parsePos(pos);
  const fix = ep.filter((e) => e.q === 1);
  const last = fix.length > 0 ? fix[fix.length - 1] : ep[ep.length - 1];
  let ephopt1 = -1;
  if (withTrace) {
    try {
      const tr = mod.FS.readFile(`${out}.trace`, { encoding: 'utf8' });
      ephopt1 = tr.split('\n').filter((l) => l.includes('ephopt=1')).length;
    } catch { ephopt1 = -2; }
  }
  const body = pos.split('\n').filter((l) => !l.startsWith('%')).join('\n');
  return { status: fix.length > 0 ? 'FIX' : ep.length > 0 ? 'FLOAT' : 'NONE',
    dx: last ? sub([last.x, last.y, last.z], BASE) : [NaN, NaN, NaN],
    cov: last ? last.cov : [], ratio: last ? last.ratio : NaN, ns: last ? last.ns : NaN,
    epochs: ep.length, sha: createHash('sha256').update(body).digest('hex').slice(0, 16), ephopt1 };
}

async function main(): Promise<void> {
  if (!existsSync(CORPUS)) skip(`corpus absent: ${CORPUS}`);
  if (!existsSync(CLI)) skip(`pinned binary absent: ${CLI}`);
  if (!existsSync(WASM_JS)) skip(`prebuilt WASM absent: ${WASM_JS}`);
  for (const l of COHORT) for (const f of [l.rover, l.navR]) if (!existsSync(c(f))) skip(`absent: ${f}`);
  for (const f of ['p0411650.06o', 'p0411650.06n', SP3]) if (!existsSync(c(f))) skip(`absent: ${f}`);
  const dir = mkdtempSync(join(tmpdir(), 'e12j2-'));
  const conf = join(dir, 'prec.conf');
  writeFileSync(conf, 'pos1-sateph=precise\n');
  const sp3hash = createHash('sha256').update(readFileSync(c(SP3))).digest('hex');

  const legs = COHORT.map((l) => {
    const [tsD, tsT] = l.ts.split(' '); const [teD, teT] = l.te.split(' ');
    const run = runCli(dir, l.id, ['-k', conf, '-p', '3', '-f', '2', '-m', '10', '-sys', 'G',
      '-v', '3.0', '-ti', '30', '-ts', tsD, tsT, '-te', teD, teT, '-e', '-t', '-r', ...BASE.map(String),
      c(l.rover), c('p0411650.06o'), c(l.navR), c('p0411650.06n'), c(SP3)]);
    return summarize(l.id, run, l.tbcXYZ, markerCorrection(c(l.rover), c('p0411650.06o')), 'p0411650.06o', l.rover);
  });

  // WASM: finalized S32 (mask 10 + precise + SP3), fail-closed without SP3, repeat.
  const s32 = COHORT[3];
  const [sD, sT] = s32.ts.split(' '); const [eD, eT] = s32.te.split(' ');
  const xa = ['-k', '/work/prec.conf', '-p', '3', '-f', '2', '-m', '10', '-sys', 'G',
    '-v', '3.0', '-ti', '30', '-ts', sD, sT, '-te', eD, eT, '-e', '-t'];
  const rd = (n: string): Uint8Array => new Uint8Array(readFileSync(c(n)));
  const full: Record<string, Uint8Array> = { 'rover.obs': rd(s32.rover), 'base.obs': rd('p0411650.06o'),
    'nav0.nav': rd(s32.navR), 'nav1.nav': rd('p0411650.06n'), 'nav2.sp3': rd(SP3),
    'prec.conf': new Uint8Array(Buffer.from('pos1-sateph=precise\n')) };
  const noSp3: Record<string, Uint8Array> = { ...full };
  delete noSp3['nav2.sp3'];
  const mod = (await ((await import(WASM_JS)) as { default: () => Promise<Wm> }).default()) as Wm;
  const wFull = await wasmRun(mod, 's32f', xa, full, true);
  const wNoSp3 = await wasmRun(mod, 's32n', xa, noSp3, false);
  const wRep = await wasmRun(mod, 's32r', xa, full, false);

  // End-to-end: WASM S32 -> marker correction -> §36 adapter -> WebNet report.
  const corr = markerCorrection(c(s32.rover), c('p0411650.06o'));
  const marked: [number, number, number] = [wFull.dx[0] - corr[0], wFull.dx[1] - corr[1], wFull.dx[2] - corr[2]];
  const ssq = (s: number): number => (s < 0 ? -s * s : s * s);
  const obs = adaptRawBaselineToObservation({ from: 'P041', to: 'SIXTWO',
    reference: MARKER_TO_MARKER_ECEF, delta: marked,
    covariance: { xx: ssq(wFull.cov[0]), xy: ssq(wFull.cov[3]), xz: ssq(wFull.cov[5]),
      yy: ssq(wFull.cov[1]), yz: ssq(wFull.cov[4]), zz: ssq(wFull.cov[2]) },
    sourceFrame: 'WGS84(G1150)-class/broadcast+igs13793-precise',
    sessionId: 'S32', solutionId: 'B32-FIN', sourceFile: 'wasm-finalized-12j2' }, 32);
  const [bx, by, bz] = BASE;
  const stations: StationMap = { P041: { x: bx, y: by, h: bz, fixed: true, fixedX: true, fixedY: true, fixedH: true },
    SIXTWO: { x: bx + marked[0], y: by + marked[1], h: bz + marked[2],
      fixed: false, fixedX: false, fixedY: false, fixedH: false } };
  const { result, report } = buildGnssReportFromInput({ stations, baselines: [obs] });
  const entry = report.baselines.find((b) => b.sessionId === 'S32');
  const e2e = { converged: result.converged, dof: result.dof,
    prov: entry ? { s: entry.sessionId, sol: entry.solutionId, from: entry.from, to: entry.to } : null,
    marked, tbc3: norm(sub(marked, s32.tbcXYZ)) * 1000 };

  const out = { legs, sp3hash, wasm: { full: wFull, noSp3: { status: wNoSp3.status, epochs: wNoSp3.epochs }, repeatSame: wRep.sha === wFull.sha }, e2e };
  if (process.argv.includes('--json')) { console.log(JSON.stringify(out, null, 2)); return; }
  for (const l of legs)
    console.log(`${l.id}: FIX ${l.fix}/${l.total} r=${l.ratio} ns=${l.ns} d3=${(l.d3 as number).toFixed(1)}mm H/V=${(l.dH as number).toFixed(1)}/${(l.dV as number).toFixed(1)} ${l.verdict} dLen=${(l.dLen as number).toFixed(1)}mm ${l.ms}ms ${l.sha}`);
  console.log(`WASM full: ${wFull.status} ep=${wFull.epochs} r=${wFull.ratio} ns=${wFull.ns} ephopt1=${wFull.ephopt1} ${wFull.sha}`);
  console.log(`WASM noSP3: ${wNoSp3.status} ep=${wNoSp3.epochs} (fail-closed); repeat same=${wRep.sha === wFull.sha}`);
  console.log(`E2E: converged=${e2e.converged} dof=${e2e.dof} tbc3=${(e2e.tbc3 as number).toFixed(1)}mm prov=${JSON.stringify(e2e.prov)}`);
}

const asMain = process.argv[1]?.endsWith('gnss12j2Cohort.ts') ?? false;
if (asMain) void main();
