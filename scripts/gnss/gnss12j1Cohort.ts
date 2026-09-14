/**
 * Phase 12J.1 Batch C2 §§24-27 — EVIDENCE ONLY.
 *
 * First parity cohort: all TBC-cited P041<->0124 GPS-only sessions, plus
 * *a-decimation check (§25), rover<->rover pairs (§26), GLONASS probe (§27)
 * and CLI determinism (§28 partial). Read-only on the local vendor corpus
 * (~/Downloads/webnet-gnss-12e/raw-baselines/ + tbc-intake/ — never
 * committed); reuses the pinned rnx2rtkp binary built from
 * /tmp/rtklib-evidence (62d4677) without rebuilding; solutions run into
 * os.tmpdir(), never the repo. Fail-closed SKIP (exit 0) when the corpus
 * or the binary is absent so CI stays green.
 *
 * P041 `_0/_1/_2` variants are body-identical (only the PGM download-date
 * comment differs; md5 of post-header bytes equal) — no session split, so
 * every leg uses the canonical p0411650.06o. TBC windows below were parsed
 * from the local TBC intake baseline reports (Processing Start/Stop, GPS).
 *
 * Usage: npx tsx scripts/gnss/gnss12j1Cohort.ts [--json]
 */
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { existsSync, mkdtempSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

export const CORPUS_DIR = join(process.env['HOME'] ?? '~', 'Downloads/webnet-gnss-12e/raw-baselines');
export const RTKLIB_BIN = '/tmp/rtklib-evidence/app/consapp/rnx2rtkp/gcc/rnx2rtkp';
const BASE_XYZ: [number, number, number] = [-1283634.1259, -4726427.8882, 4074798.0251];
const OPTS = ['-p', '3', '-f', '2', '-m', '15', '-v', '3.0', '-ti', '30', '-e', '-t'];

export interface CohortLeg {
  id: string; tbc: string; station: string; rover: string; navR: string;
  ts: string; te: string; tbcXYZ: [number, number, number]; tbcCov: number[];
}

/** §24 cohort: TBC solution / station / window / mark-to-mark vector / cov. */
export const COHORT: CohortLeg[] = [
  { id: 'S38', tbc: 'B38', station: 'HANNA', rover: '01241650.06o', navR: '01241650.06n',
    ts: '2006/06/14 14:57:30', te: '2006/06/14 15:31:00',
    tbcXYZ: [4348.976, -5305.799, -4876.455],
    tbcCov: [0.0000109297, 0.0000029882, -0.0000048020, 0.0000472479, -0.0000153013, 0.0000288719] },
  { id: 'S40', tbc: 'B40', station: 'HANNA', rover: '01241651.06o', navR: '01241651.06n',
    ts: '2006/06/14 15:49:30', te: '2006/06/14 16:21:00',
    tbcXYZ: [4348.973, -5305.802, -4876.453],
    tbcCov: [0.0000128850, 0.0000098126, -0.0000064013, 0.0000369838, -0.0000123863, 0.0000242543] },
  { id: 'S39', tbc: 'B39', station: '5', rover: '01241652.06o', navR: '01241652.06n',
    ts: '2006/06/14 16:38:00', te: '2006/06/14 17:11:00',
    tbcXYZ: [5591.998, -5202.406, -4367.016],
    tbcCov: [0.0000230761, 0.0000235478, -0.0000174954, 0.0000740902, -0.0000392081, 0.0000525487] },
  { id: 'S32', tbc: 'B32', station: 'SIXTWO', rover: '01241653.06o', navR: '01241653.06n',
    ts: '2006/06/14 17:24:30', te: '2006/06/14 18:10:30',
    tbcXYZ: [5822.646, -5654.885, -4846.085],
    tbcCov: [0.0000247718, 0.0000655581, -0.0000531839, 0.0003463746, -0.0002570615, 0.0002267204] },
  { id: 'S31', tbc: 'B31', station: '5', rover: '01241654.06o', navR: '01241654.06n',
    ts: '2006/06/14 18:26:00', te: '2006/06/14 19:01:00',
    tbcXYZ: [5591.996, -5202.419, -4367.008],
    tbcCov: [0.0000180689, 0.0000211447, -0.0000042979, 0.0000738327, -0.0000108474, 0.0000302427] },
];

type V3 = [number, number, number];
const sub = (a: V3, b: V3): V3 => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
const sc = (a: V3, s: number): V3 => [a[0] * s, a[1] * s, a[2] * s];
const norm = (a: V3): number => Math.hypot(a[0], a[1], a[2]);
const E2 = (1 / 298.257223563) * (2 - 1 / 298.257223563);

/** Up unit vector at an ECEF approx position (WGS84, 5-iteration latitude). */
function upAt(xyz: V3): V3 {
  const [x, y, z] = xyz;
  const p = Math.hypot(x, y);
  let lat = Math.atan2(z, p * (1 - E2));
  for (let i = 0; i < 5; i++) {
    const s = Math.sin(lat);
    lat = Math.atan2(z + E2 * 6378137 / Math.sqrt(1 - E2 * s * s) * s, p);
  }
  const lon = Math.atan2(y, x);
  return [Math.cos(lat) * Math.cos(lon), Math.cos(lat) * Math.sin(lon), Math.sin(lat)];
}

function headerHen(path: string): { approx: V3; hen: V3 } {
  const text = readFileSync(path, 'utf8');
  let approx: V3 = [NaN, NaN, NaN];
  let hen: V3 = [NaN, NaN, NaN];
  for (const line of text.split('\n')) {
    if (line.includes('APPROX POSITION XYZ'))
      approx = [parseFloat(line.slice(0, 14)), parseFloat(line.slice(14, 28)), parseFloat(line.slice(28, 42))];
    else if (line.includes('ANTENNA: DELTA H/E/N'))
      hen = [parseFloat(line.slice(0, 14)), parseFloat(line.slice(14, 28)), parseFloat(line.slice(28, 42))];
    if (line.includes('END OF HEADER')) break;
  }
  return { approx, hen };
}

/** L1 marker-ARP correction H_rov·Up_rov − H_base·Up_base (E/N are 0 here). */
export function markerCorrection(rovPath: string, basePath: string): V3 {
  const r = headerHen(rovPath);
  const b = headerHen(basePath);
  return sub(sc(upAt(r.approx), r.hen[0]), sc(upAt(b.approx), b.hen[0]));
}

export interface Epoch { t: string; x: number; y: number; z: number; q: number; ns: number;
  sx: number; sy: number; sz: number; sxy: number; syz: number; szx: number; ratio: number }

export function parseEpochs(pos: string): Epoch[] {
  const out: Epoch[] = [];
  for (const line of pos.split('\n')) {
    if (!line.trim() || line.startsWith('%')) continue;
    const f = line.trim().split(/\s+/).map(Number);
    if (f.length < 15 || !Number.isFinite(f[5])) continue;
    out.push({ t: line.slice(0, 22).trim(), x: f[2], y: f[3], z: f[4], q: f[5], ns: f[6],
      sx: f[7], sy: f[8], sz: f[9], sxy: f[10], syz: f[11], szx: f[12], ratio: f[14] });
  }
  return out;
}

export interface RunResult { bodyHash: string; epochs: Epoch[]; runtimeMs: number }

export function runRnx(dir: string, name: string, args: string[]): RunResult {
  const out = join(dir, `${name}.pos`);
  const t0 = Date.now();
  execFileSync(RTKLIB_BIN, [...args, '-o', out], { stdio: 'pipe', timeout: 300_000 });
  const pos = readFileSync(out, 'utf8');
  const body = pos.split('\n').filter((l) => !l.startsWith('%')).join('\n');
  return { bodyHash: createHash('sha256').update(body).digest('hex'), epochs: parseEpochs(pos), runtimeMs: Date.now() - t0 };
}

const ssq = (sd: number): number => (sd < 0 ? -sd * sd : sd * sd);

export interface LegReport { id: string; fix: number; float: number; total: number; ratioMax: number;
  ratioMed: number; vecDeltaMm: number; lenDeltaMm: number; sigRtkMm: number[]; sigTbcMm: number[];
  traceRatio: number; runtimeMs: number; bodyHash: string }

function summarize(id: string, run: RunResult, baseRef: V3, corr: V3,
    tbcXYZ: [number, number, number], tbcCov: number[]): LegReport {
  const ep = run.epochs;
  const fix = ep.filter((e) => e.q === 1);
  const last = fix[fix.length - 1];
  const raw: V3 = [last.x - baseRef[0], last.y - baseRef[1], last.z - baseRef[2]];
  const marked = sub(raw, corr);
  const dv: V3 = [marked[0] - tbcXYZ[0], marked[1] - tbcXYZ[1], marked[2] - tbcXYZ[2]];
  const rtk = [last.sx * last.sx, ssq(last.sxy), ssq(last.szx), last.sy * last.sy, ssq(last.syz), last.sz * last.sz];
  const rs = fix.map((e) => e.ratio).sort((a, b) => a - b);
  return { id, fix: fix.length, float: ep.filter((e) => e.q === 2).length, total: ep.length,
    ratioMax: rs[rs.length - 1], ratioMed: rs[Math.floor(rs.length / 2)],
    vecDeltaMm: norm(dv) * 1000, lenDeltaMm: (norm(marked) - norm(tbcXYZ)) * 1000,
    sigRtkMm: [Math.sqrt(rtk[0]) * 1000, Math.sqrt(rtk[3]) * 1000, Math.sqrt(rtk[5]) * 1000],
    sigTbcMm: [Math.sqrt(tbcCov[0]) * 1000, Math.sqrt(tbcCov[3]) * 1000, Math.sqrt(tbcCov[5]) * 1000],
    traceRatio: (rtk[0] + rtk[3] + rtk[5]) / (tbcCov[0] + tbcCov[3] + tbcCov[5]),
    runtimeMs: run.runtimeMs, bodyHash: run.bodyHash };
}

function skip(msg: string): never {
  console.log(`SKIP: ${msg}`);
  process.exit(0);
}

function main(): void {
  if (!existsSync(CORPUS_DIR)) skip(`corpus absent: ${CORPUS_DIR}`);
  if (!existsSync(RTKLIB_BIN)) skip(`pinned binary absent: ${RTKLIB_BIN}`);
  const c = (f: string): string => join(CORPUS_DIR, f);
  const need = [...COHORT.map((l) => l.rover), 'p0411650.06o', 'p0411650.06n',
    '01241652a.06o', '89911654.06o', '89911654a.06o', '89911650.06o', '80341650.06o',
    '89911650.06n', '80341650.06n', '89911653.06o', '15151658.06o', '89911653.06n',
    '15151658.06n', '89911650.06g', '80341650.06g', '89911653.06g', '15151658.06g'];
  for (const f of need) if (!existsSync(c(f))) skip(`corpus file absent: ${f}`);
  const dir = mkdtempSync(join(tmpdir(), 'cohort-'));
  const base = BASE_XYZ;

  // §24 — cohort legs, GPS-only, exact TBC windows.
  const legs: LegReport[] = COHORT.map((l) => {
    const run = runRnx(dir, l.id, [...OPTS, '-sys', 'G', '-ts', l.ts, '-te', l.te,
      '-r', ...base.map(String), c(l.rover), c('p0411650.06o'), c(l.navR), c('p0411650.06n')]);
    return summarize(l.id, run, base, markerCorrection(c(l.rover), c('p0411650.06o')), l.tbcXYZ, l.tbcCov);
  });

  // §25 — main vs *a (same base, same window); compare last-FIX vectors.
  const alt: Record<string, { dvMm: number }> = {};
  for (const [id, main, star, ts, te] of [
      ['S39', '01241652.06o', '01241652a.06o', '2006/06/14 16:38:00', '2006/06/14 17:11:00'],
      ['S36', '89911654.06o', '89911654a.06o', '2006/06/14 18:16:30', '2006/06/14 19:00:00'],
    ] as const) {
    const mk = (rov: string, n: string): Epoch[] => runRnx(dir, n, [...OPTS, '-sys', 'G',
      '-ts', ts, '-te', te, '-r', ...base.map(String), c(rov), c('p0411650.06o'),
      c(rov.replace('.06o', '.06n')), c('p0411650.06n')]).epochs.filter((e) => e.q === 1);
    const a = mk(main, `${id}m`);
    const b = mk(star, `${id}a`);
    const la = a[a.length - 1];
    const lb = b[b.length - 1];
    alt[id] = { dvMm: norm([la.x - lb.x, la.y - lb.y, la.z - lb.z]) * 1000 };
  }

  // §26 — simultaneous rover<->rover, GPS-only (base = header approx, reported).
  const rr: Record<string, { fix: number; total: number; ratioMax: number; runtimeMs: number; hash: string }> = {};
  for (const [id, brov, rrov, bnav, rnav, ts, te] of [
      ['RR1', '80341650.06o', '89911650.06o', '80341650.06n', '89911650.06n', '2006/06/14 15:00:00', '2006/06/14 15:30:00'],
      ['RR2', '15151658.06o', '89911653.06o', '15151658.06n', '89911653.06n', '2006/06/14 17:24:00', '2006/06/14 18:10:00'],
    ] as const) {
    const bref = headerHen(c(brov)).approx;
    const run = runRnx(dir, id, [...OPTS, '-sys', 'G', '-ts', ts, '-te', te,
      '-r', ...bref.map(String), c(rrov), c(brov), c(rnav), c(bnav)]);
    const fix = run.epochs.filter((e) => e.q === 1);
    rr[id] = { fix: fix.length, total: run.epochs.length,
      ratioMax: Math.max(...fix.map((e) => e.ratio)), runtimeMs: run.runtimeMs, hash: run.bodyHash };
  }

  // §27 — same §26 pairs with -sys GR + .06g nav (GPS+GLONASS NOT for MVP).
  const gr: Record<string, { fix: number; total: number; ratioMax: number; runtimeMs: number; hash: string }> = {};
  for (const [id, brov, rrov, bnav, rnav, bnavG, rnavG, ts, te] of [
      ['RR1', '80341650.06o', '89911650.06o', '80341650.06n', '89911650.06n', '80341650.06g', '89911650.06g', '2006/06/14 15:00:00', '2006/06/14 15:30:00'],
      ['RR2', '15151658.06o', '89911653.06o', '15151658.06n', '89911653.06n', '15151658.06g', '89911653.06g', '2006/06/14 17:24:00', '2006/06/14 18:10:00'],
    ] as const) {
    const bref = headerHen(c(brov)).approx;
    const run = runRnx(dir, `${id}g`, [...OPTS, '-sys', 'GR', '-ts', ts, '-te', te,
      '-r', ...bref.map(String), c(rrov), c(brov), c(rnav), c(bnav), c(rnavG), c(bnavG)]);
    const fix = run.epochs.filter((e) => e.q === 1);
    gr[id] = { fix: fix.length, total: run.epochs.length,
      ratioMax: fix.length > 0 ? Math.max(...fix.map((e) => e.ratio)) : 0,
      runtimeMs: run.runtimeMs, hash: run.bodyHash };
  }

  // §27b — GLONASS-only control on the RR1 window (same pair, R nav only).
  const rb = headerHen(c('80341650.06o')).approx;
  const ronly = runRnx(dir, 'RR1r', [...OPTS, '-sys', 'R', '-ts', '2006/06/14 15:00:00',
    '-te', '2006/06/14 15:30:00', '-r', ...rb.map(String), c('89911650.06o'),
    c('80341650.06o'), c('89911650.06g'), c('80341650.06g')]);
  const grOnly = { fix: ronly.epochs.filter((e) => e.q === 1).length, total: ronly.epochs.length };

  // §28 partial — determinism: 2 more S32 runs + 1 extra each on S39/S31.
  const det: Record<string, boolean> = {};
  const s32 = COHORT[3];
  const h0 = legs[3].bodyHash;
  for (let i = 1; i <= 2; i++) {
    const r = runRnx(dir, `S32r${i}`, [...OPTS, '-sys', 'G', '-ts', s32.ts, '-te', s32.te,
      '-r', ...base.map(String), c(s32.rover), c('p0411650.06o'), c(s32.navR), c('p0411650.06n')]);
    det[`S32 run${i + 1}`] = r.bodyHash === h0;
  }
  for (const [id, leg] of [['S39', COHORT[2]], ['S31', COHORT[4]]] as const) {
    const r = runRnx(dir, `${id}x`, [...OPTS, '-sys', 'G', '-ts', leg.ts, '-te', leg.te,
      '-r', ...base.map(String), c(leg.rover), c('p0411650.06o'), c(leg.navR), c('p0411650.06n')]);
    det[`${id} rerun`] = r.bodyHash === legs.find((l) => l.id === id)!.bodyHash;
  }

  const out = { legs, alt, rr, gr, grOnly, det };
  if (process.argv.includes('--json')) {
    console.log(JSON.stringify(out, null, 2));
    return;
  }
  for (const l of legs)
    console.log(`${l.id}: FIX ${l.fix}/${l.total} ratio med/max ${l.ratioMed}/${l.ratioMax}` +
      ` |dVec| ${l.vecDeltaMm.toFixed(1)}mm dLen ${l.lenDeltaMm.toFixed(1)}mm` +
      ` sigRTK ${l.sigRtkMm.map((v) => v.toFixed(1)).join('/')}mm` +
      ` sigTBC ${l.sigTbcMm.map((v) => v.toFixed(1)).join('/')}mm tr ${l.traceRatio.toFixed(2)}` +
      ` ${l.runtimeMs}ms ${l.bodyHash.slice(0, 12)}`);
  console.log(`ALT: ${Object.entries(alt).map(([k, v]) => `${k} dVec=${v.dvMm.toFixed(1)}mm`).join(' ')}`);
  console.log(`RR: ${Object.entries(rr).map(([k, v]) => `${k} FIX ${v.fix}/${v.total} rMax ${v.ratioMax}`).join(' ')}`);
  console.log(`GR: ${Object.entries(gr).map(([k, v]) => `${k} FIX ${v.fix}/${v.total} rMax ${v.ratioMax}`).join(' ')}`);
  console.log(`GR-ONLY: RR1 window -sys R -> FIX ${grOnly.fix}/${grOnly.total}; .06g holds 12 records with RINEX2-style 'R n' IDs in a 3.04 wrapper`);
  console.log(`DET: ${Object.entries(det).map(([k, v]) => `${k}=${v ? 'SAME' : 'DIFF'}`).join(' ')}`);
}

const asMain = process.argv[1]?.endsWith('gnss12j1Cohort.ts') ?? false;
if (asMain) main();
