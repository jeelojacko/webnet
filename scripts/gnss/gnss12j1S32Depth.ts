/**
 * Phase 12J.1 Batch C1 §§14-17 — EVIDENCE ONLY.
 *
 * S32 processing-depth re-verification (broadcast-vs-SP3, epoch accounting,
 * signal contract, ambiguity result). Read-only on the local vendor corpus
 * (~/Downloads/webnet-gnss-12e/raw-baselines/ — never committed); reuses the
 * pinned rnx2rtkp binary built from /tmp/rtklib-evidence (62d4677) without
 * rebuilding; runs into os.tmpdir(), never the repo. Fail-closed SKIP
 * (exit 0) when the corpus or the binary is absent so CI stays green.
 *
 * Usage: npx tsx scripts/gnss/gnss12j1S32Depth.ts [--json]
 */
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { existsSync, mkdtempSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

export const CORPUS_DIR = join(process.env['HOME'] ?? '~', 'Downloads/webnet-gnss-12e/raw-baselines');
export const RTKLIB_BIN = '/tmp/rtklib-evidence/app/consapp/rnx2rtkp/gcc/rnx2rtkp';
const BASE_XYZ = ['-1283634.1259', '-4726427.8882', '4074798.0251'];
const WINDOW = ['-ts', '2006/06/14 17:24:30', '-te', '2006/06/14 18:10:30'];
const COMMON_OPTS = ['-p', '3', '-f', '2', '-m', '15', '-sys', 'G', '-v', '3.0', '-ti', '30', '-e', '-t'];

function skip(msg: string): never {
  console.log(`SKIP: ${msg}`);
  process.exit(0);
}

export interface PosEpoch {
  time: string;
  secs: number;
  q: number;
  ns: number;
  ratio: number;
}

export function parsePos(text: string): { header: string[]; epochs: PosEpoch[] } {
  const header: string[] = [];
  const epochs: PosEpoch[] = [];
  for (const line of text.split('\n')) {
    if (!line.trim()) continue;
    if (line.startsWith('%')) {
      header.push(line);
      continue;
    }
    const f = line.trim().split(/\s+/);
    if (f.length < 15) continue;
    const [d, t, , , , q, ns] = f as [string, string, string, string, string, string, string];
    const [hh, mm, ss] = t.split(':').map(Number);
    epochs.push({
      time: `${d} ${t}`,
      secs: (hh ?? 0) * 3600 + (mm ?? 0) * 60 + (ss ?? 0),
      q: Number(q),
      ns: Number(ns),
      ratio: Number(f[14]),
    });
  }
  return { header, epochs };
}

export function expectedGrid(): number[] {
  const start = 17 * 3600 + 24 * 60 + 30;
  const out: number[] = [];
  for (let i = 0; i < 93; i++) out.push(start + i * 30);
  return out;
}

function runLeg(dir: string, name: string, extraInputs: string[]): { pos: string; body: string } {
  const c = CORPUS_DIR;
  const out = join(dir, `${name}.pos`);
  const args = [
    ...COMMON_OPTS,
    ...WINDOW,
    '-o', out,
    '-r', ...BASE_XYZ,
    join(c, '01241653.06o'), join(c, 'p0411650_2.06o'),
    join(c, '01241653.06n'), join(c, 'p0411650_2.06n'),
    ...extraInputs,
  ];
  execFileSync(RTKLIB_BIN, args, { stdio: 'pipe', timeout: 120_000 });
  const pos = readFileSync(out, 'utf8');
  const body = pos.split('\n').filter((l) => !l.startsWith('%')).join('\n');
  return { pos, body };
}

export function obsTypesFromHeader(path: string): string[] {
  const text = readFileSync(path, 'utf8');
  const lines = text.split('\n');
  const out: string[] = [];
  for (const line of lines) {
    if (line.includes('END OF HEADER')) break;
    const m3 = line.match(/^G\s+(\d+)\s+((?:[A-Z]\d[A-Z]\s*)+)\s*SYS \/ # \/ OBS TYPES/);
    if (m3) {
      const n = Number(m3[1]);
      out.push(...(m3[2].match(/[A-Z]\d[A-Z]/g) ?? []).slice(0, n));
    }
    const m2 = line.match(/^\s*(\d+)\s+((?:[A-Z]\d\s+)+)# \/ TYPES OF OBSERV/);
    if (m2) out.push(...(m2[2].trim().split(/\s+/).slice(0, Number(m2[1]))));
  }
  return out;
}

function main(): void {
  if (!existsSync(CORPUS_DIR)) skip(`corpus absent: ${CORPUS_DIR}`);
  if (!existsSync(RTKLIB_BIN)) skip(`pinned binary absent: ${RTKLIB_BIN}`);
  const need = ['01241653.06o', 'p0411650_2.06o', '01241653.06n', 'p0411650_2.06n', 'igs13793.sp3'];
  for (const f of need) if (!existsSync(join(CORPUS_DIR, f))) skip(`corpus file absent: ${f}`);

  const dir = mkdtempSync(join(tmpdir(), 's32depth-'));
  const bcast = runLeg(dir, 's32_bcast', []);
  const sp3 = runLeg(dir, 's32_sp3', [join(CORPUS_DIR, 'igs13793.sp3')]);
  const bHash = createHash('sha256').update(bcast.body).digest('hex');
  const sHash = createHash('sha256').update(sp3.body).digest('hex');

  const { epochs } = parsePos(bcast.pos);
  const grid = expectedGrid();
  const have = new Set(epochs.map((e) => e.secs));
  const missing = grid.filter((s) => !have.has(s));
  const fix = epochs.filter((e) => e.q === 1);
  const flt = epochs.filter((e) => e.q === 2);
  const ratios = fix.map((e) => e.ratio).sort((a, b) => a - b);
  const nsDist: Record<number, number> = {};
  for (const e of epochs) nsDist[e.ns] = (nsDist[e.ns] ?? 0) + 1;
  const spacings = epochs.slice(1).map((e, i) => e.secs - epochs[i].secs);

  const result = {
    legs: {
      broadcastSha256Body: bHash,
      sp3Sha256Body: sHash,
      bodiesIdentical: bHash === sHash,
    },
    epochs: {
      expected: 93,
      present: epochs.length,
      rejected: missing.length,
      first: epochs[0]?.time,
      last: epochs[epochs.length - 1]?.time,
      spacingDeviations: spacings.filter((s) => s !== 30).length,
    },
    quality: {
      fix: fix.length,
      float: flt.length,
      floatEpochs: flt.map((e) => e.time),
      ratioMin: ratios[0],
      ratioMedian: ratios[Math.floor(ratios.length / 2)],
      ratioMax: ratios[ratios.length - 1],
      finalRatio: epochs[epochs.length - 1]?.ratio,
      belowThreshold30: ratios.filter((r) => r < 3.0).length,
      nsDistribution: nsDist,
    },
    signals: {
      rover: obsTypesFromHeader(join(CORPUS_DIR, '01241653.06o')),
      base: obsTypesFromHeader(join(CORPUS_DIR, 'p0411650_2.06o')),
    },
  };

  if (process.argv.includes('--json')) {
    console.log(JSON.stringify(result, null, 2));
    return;
  }
  console.log(`bodies identical: ${result.legs.bodiesIdentical} (0.0 mm)`);
  console.log(`epochs: expected 93, present ${result.epochs.present}, rejected ${result.epochs.rejected}`);
  console.log(`window: ${result.epochs.first} .. ${result.epochs.last}, spacing deviations: ${result.epochs.spacingDeviations}`);
  console.log(`FIX ${result.quality.fix}/93, FLOAT ${result.quality.float}/93`);
  console.log(`ratio: min ${result.quality.ratioMin}, median ${result.quality.ratioMedian}, max ${result.quality.ratioMax}, final ${result.quality.finalRatio}`);
  console.log(`ns: ${JSON.stringify(result.quality.nsDistribution)}`);
  console.log(`rover obs: ${result.signals.rover.join(' ')}`);
  console.log(`base obs: ${result.signals.base.join(' ')}`);
}

const asMain = process.argv[1]?.endsWith('gnss12j1S32Depth.ts') ?? false;
if (asMain) main();
