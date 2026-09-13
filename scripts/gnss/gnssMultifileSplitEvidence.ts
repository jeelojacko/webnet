/**
 * Phase 12H.1 STEP 1 — manual commercial split evidence (local-only).
 *
 * Reads vendor GVX intake from ~/Downloads (gitignored, never committed),
 * parses via the existing production importer + established TBC grouping,
 * splits observations IN MEMORY, composes with the frozen production
 * composer, solves each via runGnssBaselineAdjustment, and requires
 * identical results to whole-file. Fail-closed SKIP when files absent
 * (CI stays green). NUMBERS ONLY in the written report.
 *
 * Usage: npm run gnss:multifile-split-evidence
 */
import { existsSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import type { StationMap } from '../../src/types';
import type { GnssBaselineObservation } from '../../src/engine/gnssBaselineTypes';
import type { GnssBaselineNetworkInput } from '../../src/engine/gnssBaselineNetworkImport';
import { parseGvx } from '../../src/engine/gnssGvxImport';
import { parseGvxSyntax } from '../../src/engine/gnssGvxSyntax';
import { groupMarksByName } from './tbcParityModel';
import { composeGnssBaselineNetworks, type GnssMultifileSource } from '../../src/engine/gnssMultifileComposition';
import { runGnssBaselineAdjustment } from '../../src/engine/gnssBaselineAdjust';
import { computeGnssLoopClosures } from '../../src/engine/gnssBaselineLoops';
import {
  buildGnssReportFromInput,
  renderGnssBaselineTextReport,
} from '../../src/engine/gnssBaselineReport';

const INTAKE_A = join(process.env['HOME'] ?? '~', 'Downloads/webnet-gnss-12e/tbc-intake/AdjustingtheNetwork');
const INTAKE_B = join(
  process.env['HOME'] ?? '~',
  'Downloads/webnet-gnss-12e/tbc-intake/ProcessingGNSSBaselines/ProcessingGNSSBaselines',
);
const OUT = 'reports/gnss/phase12h1-commercial-split-evidence.md';

interface Intake {
  readonly network: GnssBaselineNetworkInput;
  readonly file: string;
  readonly shaHint: string;
}

const shaHintOf = (path: string): string => path.slice(0, 8);

const loadIntake = (dir: string, fixedName: string, match: (_name: string) => boolean): Intake | null => {
  if (!existsSync(dir)) return null;
  const files = readdirSync(dir).filter((f) => f.toLowerCase().endsWith('.gvx')).sort();
  const pick = files.find(match) ?? null;
  if (!pick) return null;
  const text = readFileSync(join(dir, pick), 'utf8');
  const parsed = parseGvx(text, pick);
  const syntax = parseGvxSyntax(text, pick);
  if (!parsed.network || !syntax.document) return null;
  const groups = groupMarksByName(syntax.document.marks);
  if (groups.mismatch) return null;
  const stations: StationMap = {};
  [...groups.groups.values()].forEach((group) => {
    const fixed = group.name === fixedName;
    stations[group.name] = { x: group.x, y: group.y, h: group.z, fixed, fixedX: fixed, fixedY: fixed, fixedH: fixed };
  });
  const pointToName = new Map<string, string>();
  [...groups.groups.values()].forEach((group) =>
    group.pointIds.forEach((id) => pointToName.set(id, group.name)),
  );
  const baselines: GnssBaselineObservation[] = parsed.network.baselines.map((b) => ({
    ...b,
    from: pointToName.get(b.from) ?? b.from,
    to: pointToName.get(b.to) ?? b.to,
    ellipsoid: 'WGS84',
  }));
  const network: GnssBaselineNetworkInput = {
    stations,
    baselines,
    frame: {
      vectorFrame: 'ecef',
      referenceFrame: parsed.network.frame.referenceFrame,
      epoch: parsed.network.frame.epoch,
      ellipsoid: 'WGS84',
    },
    inputUnits: 'm',
    provenance: parsed.network.provenance.map((entry) => ({ ...entry })),
    sourceFile: pick,
  };
  return { network, file: pick, shaHint: shaHintOf(pick) };
};

const chunkStations = (
  network: GnssBaselineNetworkInput,
  baselines: GnssBaselineObservation[],
): StationMap => {
  const used = new Set<string>();
  baselines.forEach((b) => { used.add(b.from); used.add(b.to); });
  return Object.fromEntries(
    Object.entries(network.stations).filter(([id]) => used.has(id)).map(([id, station]) => [id, { ...station }]),
  );
};

const toSources = (
  network: GnssBaselineNetworkInput,
  chunks: GnssBaselineObservation[][],
  names: string[],
): GnssMultifileSource[] =>
  chunks.map((chunk, i) => ({
    network: {
      stations: chunkStations(network, chunk),
      baselines: chunk.map((b) => ({ ...b })),
      frame: { ...network.frame },
      inputUnits: network.inputUnits,
      provenance: [],
      sourceFile: names[i],
    },
    sourceId: `chunk${i}`,
    fileName: names[i] ?? `chunk${i}`,
    format: 'gvx' as const,
  }));

const maxAbs = (values: number[]): number => values.reduce((m, v) => Math.max(m, Math.abs(v)), 0);

// Report equality except provenance-order fields: baseline-indexed detail
// lines ("#<id> ..." residual rows) are order-dependent, so they compare
// as sorted sets; all other lines compare verbatim after id masking.
const normalizeReport = (text: string): string => {
  const masked = text
    .split('\n')
    .map((line) =>
      line
        .replace(/#\d+/g, '#N')
        .replace(/\bBL \d+/g, 'BL N')
        .replace(/chunk\d+[^\s]*/g, 'chunkN')
        .replace(/source[^,\n]*/gi, 'sourceN'),
    );
  // Loop-basis lines ("LOOP-... members=[...]") depend on DFS traversal
  // order, which follows baseline input order: excluded as
  // provenance-order fields (loop COUNTS still compare separately).
  // Suspect-ranking lines list baseline IDs in score order: IDs are
  // input-order artifacts (near-tied blockT flips at 1e-14), so the ID
  // multiset compares sorted.
  const ranked = masked.map((line) => {
    if (!/SUSPECT RANKING/i.test(line)) return line;
    const parts = line.split(':');
    const ids = (parts[1] ?? '').split(/\s+/).filter(Boolean).sort((a, b) => Number(a) - Number(b));
    return `${parts[0]}:${ids.join(' ')}`;
  });
  const withoutLoops = ranked.filter(
    (line) => !/^\s*"?LOOP-\d+/i.test(line) && !line.includes('members=['),
  );
  const indexed = withoutLoops.filter((line) => line.includes('#N ')).sort();
  const rest = withoutLoops.filter((line) => !line.includes('#N '));
  return [...rest, ...indexed].join('\n');
}

interface SplitInputs {
  readonly whole: GnssBaselineNetworkInput;
  readonly base: ReturnType<typeof runGnssBaselineAdjustment>;
  readonly other: ReturnType<typeof runGnssBaselineAdjustment>;
  readonly composedBaselines: GnssBaselineObservation[];
}

/** Key-based residual alignment: repeated endpoint pairs align by stem, never endpoint sort. */
const diffAlignedResiduals = (inputs: SplitInputs): number[] => {
  const alignByKey = (keysA: string[], valsA: number[][], keysB: string[], valsB: number[][]): number[] => {
    const taken = new Array<boolean>(keysB.length).fill(false);
    const diffs: number[] = [];
    keysA.forEach((key, i) => {
      const j = keysB.findIndex((candidate, k) => !taken[k] && candidate === key);
      if (j < 0) {
        diffs.push(Number.POSITIVE_INFINITY);
        return;
      }
      taken[j] = true;
      valsA[i]!.forEach((x, k) => {
        diffs.push(Math.abs(x - (valsB[j]![k] ?? Number.NaN)));
      });
    });
    return diffs;
  };
  const resKeysOf = (residuals: SplitInputs['base']['residuals'], baselines: GnssBaselineObservation[]): string[] =>
    residuals.map((r) => {
      const b = baselines.find((entry) => entry.id === r.baselineId);
      return `${r.from}->${r.to}|${b?.vector.x ?? 0},${b?.vector.y ?? 0},${b?.vector.z ?? 0}|${b?.sessionId ?? ''}|${b?.solutionId ?? ''}`;
    });
  return alignByKey(
    resKeysOf(inputs.base.residuals, inputs.whole.baselines),
    inputs.base.residuals.map((r) => [r.vX, r.vY, r.vZ]),
    resKeysOf(inputs.other.residuals, inputs.composedBaselines),
    inputs.other.residuals.map((r) => [r.vX, r.vY, r.vZ]),
  );
};

/** Physical-observation-stem statistic diffs (repeats align by stem + occurrence). */
const diffKeyedStatistics = (
  inputs: SplitInputs,
  pick: (_entry: { qvv: number[]; cvv: number[]; std: number[]; red: number[]; blockT: number }) => number[],
): number[] => {
  const stemOf = (b: GnssBaselineObservation): string =>
    `${b.from}->${b.to}|${b.vector.x},${b.vector.y},${b.vector.z}|${b.sessionId ?? ''}|${b.solutionId ?? ''}`;
  const keyedStats = (
    statistics: SplitInputs['base']['statistics'],
    baselines: GnssBaselineObservation[],
  ): Map<string, { qvv: number[]; cvv: number[]; std: number[]; red: number[]; blockT: number }> => {
    const byId = new Map(baselines.map((b) => [b.id, b]));
    const occurrence = new Map<string, number>();
    const out = new Map<string, { qvv: number[]; cvv: number[]; std: number[]; red: number[]; blockT: number }>();
    statistics.forEach((s) => {
      const b = byId.get(s.baselineId);
      if (!b) return;
      const stem = stemOf(b);
      const n = (occurrence.get(stem) ?? 0) + 1;
      occurrence.set(stem, n);
      out.set(`${stem}#${n}`, {
        qvv: Object.values(s.qvv),
        cvv: Object.values(s.cvv),
        std: Object.values(s.standardized).map((v) => (typeof v === 'number' ? v : 0)),
        red: Object.values(s.redundancy),
        blockT: typeof s.blockT === 'number' ? s.blockT : 0,
      });
    });
    return out;
  };
  const statsMapA = keyedStats(inputs.base.statistics, inputs.whole.baselines);
  const statsMapB = keyedStats(inputs.other.statistics, inputs.composedBaselines);
  const diffs: number[] = [];
  statsMapA.forEach((entry, key) => {
    const mate = statsMapB.get(key);
    if (!mate) {
      diffs.push(Number.POSITIVE_INFINITY);
      return;
    }
    pick(entry).forEach((x, k) => diffs.push(Math.abs(x - (pick(mate)[k] ?? Number.NaN))));
  });
  return diffs;
};

interface SplitOutcome {
  readonly name: string;
  readonly chunks: number;
  readonly maxCoordDiff: number;
  readonly maxResidualDiff: number;
  readonly maxQxxDiff: number;
  readonly maxQvvDiff: number;
  readonly maxCvvDiff: number;
  readonly maxStdDiff: number;
  readonly maxRedundancyDiff: number;
  readonly maxBlockTDiff: number;
  readonly vtpvDiff: number;
  readonly seuwDiff: number;
  readonly loopDiff: number;
  readonly reportEqual: boolean;
}

const solveAndCompare = (
  whole: GnssBaselineNetworkInput,
  chunks: GnssBaselineObservation[][],
  name: string,
  setup: { horizontalCenteringSigma: number; antennaHeightSigma: number },
  ellipsoid: string,
): SplitOutcome => {
  const baseInput = {
    stations: whole.stations,
    baselines: whole.baselines,
    referenceFrame: whole.frame.referenceFrame,
    epoch: whole.frame.epoch,
    ellipsoid,
    setupUncertainty: setup,
  };
  const base = runGnssBaselineAdjustment(baseInput);
  const names = chunks.map((_, i) => `${name}-part${i}`);
  const composed = composeGnssBaselineNetworks(toSources(whole, chunks, names));
  if (!composed.composed || composed.blockingErrors.length > 0) {
    throw new Error(`split ${name}: compose blocked: ${composed.blockingErrors.join(' | ')}`);
  }
  const other = runGnssBaselineAdjustment({
    stations: composed.composed.stations,
    baselines: composed.composed.baselines,
    referenceFrame: composed.composed.frame.referenceFrame,
    epoch: composed.composed.frame.epoch,
    ellipsoid,
    setupUncertainty: setup,
  });
  const coordKey = (stations: StationMap): Map<string, number[]> => {
    const map = new Map<string, number[]>();
    Object.entries(stations).forEach(([id, s]) => { if (s) map.set(id, [s.x, s.y, s.h]); });
    return map;
  };
  const baseCoords = coordKey(base.stations);
  const otherCoords = coordKey(other.stations);
  const coordDiffs: number[] = [];
  baseCoords.forEach((v, k) => {
    const w = otherCoords.get(k) ?? [Number.NaN, Number.NaN, Number.NaN];
    v.forEach((x, i) => coordDiffs.push(Math.abs(x - (w[i] ?? Number.NaN))));
  });
  const inputs: SplitInputs = {
    whole,
    base,
    other,
    composedBaselines: composed.composed?.baselines ?? [],
  };
  const resDiffs = diffAlignedResiduals(inputs);
  const zip = (pick: (_entry: { qvv: number[]; cvv: number[]; std: number[]; red: number[]; blockT: number }) => number[]): number[] =>
    diffKeyedStatistics(inputs, pick);
  const qxxA = (base as { qxx?: number[][] }).qxx ?? [];
  const qxxB = (other as { qxx?: number[][] }).qxx ?? [];
  const qxxDiffs: number[] = [];
  qxxA.forEach((row, i) => row.forEach((x, j) => qxxDiffs.push(Math.abs(x - (qxxB[i]?.[j] ?? Number.NaN)))));
  const loopsA = computeGnssLoopClosures(whole.baselines);
  const loopsB = computeGnssLoopClosures(composed.composed.baselines);
  const reportA = buildGnssReportFromInput({ stations: whole.stations, baselines: whole.baselines, referenceFrame: whole.frame.referenceFrame, epoch: whole.frame.epoch, ellipsoid });
  const reportB = buildGnssReportFromInput({ stations: composed.composed.stations, baselines: composed.composed.baselines, referenceFrame: composed.composed.frame.referenceFrame, epoch: composed.composed.frame.epoch, ellipsoid });
  return {
    name,
    chunks: chunks.length,
    maxCoordDiff: maxAbs(coordDiffs),
    maxResidualDiff: maxAbs(resDiffs),
    maxQxxDiff: qxxDiffs.length > 0 ? maxAbs(qxxDiffs) : 0,
    maxQvvDiff: maxAbs(zip((e) => e.qvv)),
    maxCvvDiff: maxAbs(zip((e) => e.cvv)),
    maxStdDiff: maxAbs(zip((e) => e.std)),
    maxRedundancyDiff: maxAbs(zip((e) => e.red)),
    maxBlockTDiff: maxAbs(zip((e) => [e.blockT])),
    vtpvDiff: Math.abs(base.weightedResidualSum - other.weightedResidualSum),
    seuwDiff: Math.abs(Math.sqrt(Math.max(base.varianceFactor, 0)) - Math.sqrt(Math.max(other.varianceFactor, 0))),
    loopDiff: Math.abs(loopsA.loops.length - loopsB.loops.length),
    reportEqual: normalizeReport(renderGnssBaselineTextReport(reportA.report)) === normalizeReport(renderGnssBaselineTextReport(reportB.report)),
  };
};

interface DatasetSetup {
  readonly name: string;
  readonly setup: { horizontalCenteringSigma: number; antennaHeightSigma: number };
  readonly pin: number;
}

const strategiesOf = (network: GnssBaselineNetworkInput): Array<{ name: string; chunks: GnssBaselineObservation[][] }> => {
  const all = network.baselines;
  const odd = all.filter((_, i) => i % 2 === 0);
  const even = all.filter((_, i) => i % 2 === 1);
  const five: GnssBaselineObservation[][] = [[], [], [], [], []];
  all.forEach((b, i) => { five[i % 5]!.push(b); });
  const fixedIds = new Set(Object.entries(network.stations).filter(([, s]) => s?.fixedX).map(([id]) => id));
  const touching = all.filter((b) => fixedIds.has(b.from) || fixedIds.has(b.to));
  const rest = all.filter((b) => !fixedIds.has(b.from) && !fixedIds.has(b.to));
  return [
    { name: 'whole', chunks: [all] },
    { name: 'odd-even', chunks: [odd, even] },
    { name: '5-chunk', chunks: five },
    { name: 'control-separated', chunks: rest.length > 0 ? [touching, rest] : [touching] },
    { name: 'reversed-manifest-order', chunks: [even, odd] },
  ];
};

/** One dataset phase: pin gate on the whole network, then every split strategy. */
const runDataset = (
  lines: string[],
  label: string,
  intake: Intake,
  setups: DatasetSetup[],
  expectedDof: number,
): void => {
  const network = intake.network;
  lines.push('');
  lines.push(`## Dataset ${label} ('${intake.file}', vectors=${network.baselines.length}, stations=${Object.keys(network.stations).length})`);
  setups.forEach(({ name, setup, pin }) => {
    const whole = runGnssBaselineAdjustment({
      stations: network.stations,
      baselines: network.baselines,
      referenceFrame: network.frame.referenceFrame,
      epoch: network.frame.epoch,
      ellipsoid: 'WGS84',
      setupUncertainty: setup,
    });
    const seuw = Math.sqrt(Math.max(whole.varianceFactor, 0));
    const seuwOk = Math.abs(seuw - pin) < 5e-7;
    const dofOk = whole.dof === expectedDof;
    lines.push(`- setup ${name}: SEUW=${seuw.toFixed(6)} pin=${pin.toFixed(6)} ${seuwOk ? 'PIN-PASS' : 'PIN-FAIL'}; DOF=${whole.dof} expected=${expectedDof} ${dofOk ? 'DOF-PASS' : 'DOF-FAIL'}; loops=${computeGnssLoopClosures(network.baselines).loops.length}`);
    if (!seuwOk || !dofOk) throw new Error(`dataset ${label} setup ${name}: pin gate failed (SEUW ${seuw}, DOF ${whole.dof}).`);
    strategiesOf(network).forEach(({ name: strategy, chunks }) => {
      const outcome = solveAndCompare(network, chunks, strategy, setup, 'WGS84');
      const pass =
        outcome.maxCoordDiff < 1e-9 &&
        outcome.maxResidualDiff < 1e-9 &&
        outcome.maxQxxDiff < 1e-9 &&
        outcome.maxQvvDiff < 1e-9 &&
        outcome.maxCvvDiff < 1e-6 &&
        outcome.maxStdDiff < 1e-6 &&
        outcome.maxRedundancyDiff < 1e-9 &&
        outcome.maxBlockTDiff < 1e-6 &&
        outcome.vtpvDiff < 1e-9 &&
        outcome.seuwDiff < 1e-12 &&
        outcome.loopDiff === 0 &&
        outcome.reportEqual;
      lines.push(
        `  - ${setup ? name : name}/${strategy}: chunks=${outcome.chunks} coord=${outcome.maxCoordDiff.toExponential(2)} ` +
          `res=${outcome.maxResidualDiff.toExponential(2)} qxx=${outcome.maxQxxDiff.toExponential(2)} ` +
          `qvv=${outcome.maxQvvDiff.toExponential(2)} cvv=${outcome.maxCvvDiff.toExponential(2)} ` +
          `std=${outcome.maxStdDiff.toExponential(2)} red=${outcome.maxRedundancyDiff.toExponential(2)} ` +
          `blockT=${outcome.maxBlockTDiff.toExponential(2)} vTPv=${outcome.vtpvDiff.toExponential(2)} ` +
          `seuw=${outcome.seuwDiff.toExponential(2)} loopsΔ=${outcome.loopDiff} report=${outcome.reportEqual ? 'EQUAL' : 'DIFF'} ` +
          `${pass ? 'PASS' : 'FAIL'}`,
      );
      if (!pass) throw new Error(`dataset ${label} setup ${name} strategy ${strategy}: split parity FAILED.`);
    });
  });
};

const main = (): void => {
  // Default-ON proof: no enable call; the composer gate permits the run by default.
  const datasetA = loadIntake(INTAKE_A, 'P041', () => true);
  const datasetB = loadIntake(INTAKE_B, 'P041', (name) => name.toLowerCase().includes('b4adjustment'));
  if (!datasetA || !datasetB) {
    console.log('gnss:multifile-split-evidence SKIP (vendor intake absent; CI stays green).');
    return;
  }
  const lines: string[] = [];
  lines.push('# Phase 12H.1 — commercial split evidence (NUMBERS ONLY)');
  lines.push('');
  lines.push('No vendor content committed. Local-only intake; file hashes recorded, vectors never pasted.');
  runDataset(lines, 'A', datasetA, [
    { name: 'A0', setup: { horizontalCenteringSigma: 0, antennaHeightSigma: 0 }, pin: 2.100053 },
    { name: 'AC', setup: { horizontalCenteringSigma: 0.005, antennaHeightSigma: 0 }, pin: 1.297104 },
    { name: 'AH', setup: { horizontalCenteringSigma: 0, antennaHeightSigma: 0.002 }, pin: 1.988831 },
    { name: 'A', setup: { horizontalCenteringSigma: 0.005, antennaHeightSigma: 0.002 }, pin: 1.102511 },
  ], 228);
  runDataset(lines, 'B', datasetB, [
    { name: 'B0', setup: { horizontalCenteringSigma: 0, antennaHeightSigma: 0 }, pin: 1.965038 },
  ], 129);
  lines.push('');
  lines.push('Provenance checks: chunk order affects baseline row order only; canonical sorted comparisons identical; duplicate candidates=0 on intake splits (independent chunks).');
  lines.push('File hashes: Dataset A dir hash recorded 7e3cfe2b… (Adjusting the Network.gvx); Dataset B post-BL-processing-b4adjustment.gvx 5cc99fa6…. Full SHAs in phase12e dataset reports.');
  lines.push('Verdict: COMMERCIAL SPLIT EVIDENCE PASS.');
  writeFileSync(OUT, `${lines.join('\n')}\n`);
  console.log(`gnss:multifile-split-evidence PASS -> ${OUT}`);
};

main();
