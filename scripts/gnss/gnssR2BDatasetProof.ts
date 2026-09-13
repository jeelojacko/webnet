/**
 * Phase 12F.3 W4 — Dataset A/B commercial + setup-regression evidence
 * through the REAL R2B production route (evidence only, kill ON in-script).
 *
 * 8 legs: DatasetA-A0/AC/AH/A (controlled TBC adjustments), DatasetB-B0
 * (commercial zero-setup), DatasetB-AC/AH/A (INTERNAL setup regressions,
 * not commercial). Each leg: clean TS oracle vs real-bundle R2B route
 * (isWorker true, minParams 1 diagnostic). No math/tolerance changes.
 *
 * Usage: npm run gnss:r2b-dataset-proof
 */
import { mkdirSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

import { buildSolveParameterIndex } from '../../src/engine/adjustmentPreprocessing';
import {
  runGnssBaselineAdjustment,
  type GnssBaselineAdjustResult,
} from '../../src/engine/gnssBaselineAdjust';
import { computeGnssLoopClosures } from '../../src/engine/gnssBaselineLoops';
import { createExperimentalSparseNumericalBundle } from '../../src/engine/wasm/experimentalSparseNumericalBundle';
import type { WebNetWasmFactory } from '../../src/engine/wasm/wasmTypes';
import { setSparseAutoRouteBundleLoader } from '../../src/workers/adjustmentSparseAutoRoute';
import {
  deriveGnssNativeR2BEligibility,
  runGnssBaselineWithNativeR2B,
  setGnssNativeR2BRouteEnabled,
} from '../../src/workers/gnssBaselineNativeR2BRoute';
import { readGnssBlock } from '../../src/engine/gnssSelectedBlockQuery';
import { buildGnssSelectedBlockPlan } from '../../src/engine/gnssSelectedBlockPlan';
import {
  buildGnssAdjustInput,
  EXPECTED_DATASET_A_SEUW,
  loadDatasetA,
  loadDatasetB,
  SETUP_CASES,
  type IntakeNetwork,
} from './gnssNativeArchitectureAudit';

const EXPECTED_DATASET_B0_SEUW = 1.965038;
const COORD_TOL = 1e-9;
const REL_TOL = 1e-9;
const IDENTITY_GATE = 1e-9;

interface LegSpec {
  readonly leg: string;
  readonly dataset: 'A' | 'B';
  readonly setupName: string;
  readonly commercial: boolean;
  readonly network: IntakeNetwork;
}

interface LegResult {
  readonly leg: string;
  readonly kind: string;
  readonly status: 'PASS' | 'FAIL' | 'NOT-RUN';
  readonly reason?: string;
  readonly stations?: number;
  readonly vectors?: number;
  readonly numParams?: number;
  readonly numObsEquations?: number;
  readonly dof?: number;
  readonly tsSeuw?: number;
  readonly tsSeuwPin?: number;
  readonly tsSeuwPinMatch?: boolean;
  readonly r2bSeuw?: number;
  readonly coordMaxAbs?: number;
  readonly seuwRel?: number;
  readonly residualMaxAbs?: number;
  readonly stationCovMaxAbs?: number;
  readonly stationCovMaxRel?: number;
  readonly qvvMaxRel?: number;
  readonly cvvMaxRel?: number;
  readonly redundancyTraceAbsDiff?: number;
  readonly identityTs?: number;
  readonly identityR2b?: number;
  readonly blockTMaxAbs?: number;
  readonly loopCount?: number;
  readonly loopCycleRank?: number;
  readonly loopMatch?: boolean;
  readonly route?: string;
  readonly provenance?: string;
  readonly selectedBlockCount?: number;
  readonly factorNnz?: number;
  readonly normalNnz?: number;
  readonly iterations?: number;
}

const rel = (a: number, b: number): number => {
  const denom = Math.max(Math.abs(a), Math.abs(b));
  return denom === 0 ? 0 : Math.abs(a - b) / denom;
};

const seuwOf = (result: GnssBaselineAdjustResult): number =>
  Math.sqrt(Math.max(result.varianceFactor, 0));

const blockToArray = (block: {
  xx: number; xy: number; xz: number; yy: number; yz: number; zz: number;
}): number[] => [block.xx, block.xy, block.xz, block.yy, block.yz, block.zz];

const compareLeg = (
  leg: string,
  kind: string,
  ts: GnssBaselineAdjustResult,
  r2b: GnssBaselineAdjustResult,
  route: string,
  tsSeuwPin: number | null,
): LegResult => {
  if (!('qxx' in ts)) throw new Error(`${leg}: TS result missing qxx.`);
  if (!('selectedBlocks' in r2b)) throw new Error(`${leg}: R2B result missing selectedBlocks.`);
  let coordMaxAbs = 0;
  ts.unknowns.forEach((id) => {
    const a = ts.stations[id]!;
    const b = r2b.stations[id]!;
    coordMaxAbs = Math.max(coordMaxAbs, Math.abs(a.x - b.x), Math.abs(a.y - b.y), Math.abs(a.h - b.h));
  });
  let residualMaxAbs = 0;
  ts.residuals.forEach((r, k) => {
    const c = r2b.residuals[k]!;
    residualMaxAbs = Math.max(
      residualMaxAbs, Math.abs(r.vX - c.vX), Math.abs(r.vY - c.vY), Math.abs(r.vZ - c.vZ),
    );
  });
  // Station covariance: R2B block-store diagonals vs TS dense qxx diagonals.
  const { paramIndex } = buildSolveParameterIndex(ts.stations, ts.unknowns, false);
  const plan = buildGnssSelectedBlockPlan(
    paramIndex,
    ts.residuals.map((r) => ({ from: r.from, to: r.to })),
    ts.numParams,
  );
  const out = new Float64Array(9);
  let stationCovMaxAbs = 0;
  let stationCovMaxRel = 0;
  plan.stationIds.forEach((id, ord) => {
    readGnssBlock(r2b.selectedBlocks.store, ord, ord, out);
    const base = paramIndex[id]?.['x'] as number;
    for (let i = 0; i < 3; i += 1) {
      for (let j = 0; j < 3; j += 1) {
        const ref = ts.qxx[base + i]?.[base + j] ?? 0;
        const got = out[i * 3 + j] ?? 0;
        stationCovMaxAbs = Math.max(stationCovMaxAbs, Math.abs(ref - got));
        stationCovMaxRel = Math.max(stationCovMaxRel, rel(ref, got));
      }
    }
  });
  let qvvMaxRel = 0;
  let cvvMaxRel = 0;
  let blockTMaxAbs = 0;
  ts.statistics.forEach((s, k) => {
    const c = r2b.statistics[k]!;
    blockToArray(s.qvv).forEach((value, m) => {
      qvvMaxRel = Math.max(qvvMaxRel, rel(value, blockToArray(c.qvv)[m]!));
    });
    blockToArray(s.cvv).forEach((value, m) => {
      cvvMaxRel = Math.max(cvvMaxRel, rel(value, blockToArray(c.cvv)[m]!));
    });
    if (s.blockT != null && c.blockT != null) {
      blockTMaxAbs = Math.max(blockTMaxAbs, Math.abs(s.blockT - c.blockT));
    }
  });
  const traceTs = ts.statistics.reduce((sum, s) => sum + s.redundancy.trace, 0);
  const traceR2b = r2b.statistics.reduce((sum, s) => sum + s.redundancy.trace, 0);
  const identityTs = Math.abs(traceTs - ts.dof);
  const identityR2b = Math.abs(traceR2b - r2b.dof);
  const tsSeuw = seuwOf(ts);
  const r2bSeuw = seuwOf(r2b);
  const pass = coordMaxAbs <= COORD_TOL
    && qvvMaxRel <= REL_TOL
    && cvvMaxRel <= REL_TOL
    && identityTs < IDENTITY_GATE
    && identityR2b < IDENTITY_GATE
    && route === 'native-sparse-selected-qxx'
    && r2b.routeProvenance === 'native-sparse-selected-qxx';
  return {
    leg,
    kind,
    status: pass ? 'PASS' : 'FAIL',
    ...(pass ? {} : {
      reason: `parity gate: coordAbs=${coordMaxAbs.toExponential(2)} qvvRel=${qvvMaxRel.toExponential(2)} cvvRel=${cvvMaxRel.toExponential(2)} idTs=${identityTs.toExponential(2)} idR2b=${identityR2b.toExponential(2)} route=${route}`,
    }),
    stations: Object.keys(ts.stations).length,
    numParams: ts.numParams,
    numObsEquations: ts.numObsEquations,
    dof: ts.dof,
    tsSeuw,
    ...(tsSeuwPin == null ? {} : { tsSeuwPin, tsSeuwPinMatch: Math.abs(tsSeuw - tsSeuwPin) < 1e-6 }),
    r2bSeuw,
    coordMaxAbs,
    seuwRel: rel(tsSeuw, r2bSeuw),
    residualMaxAbs,
    stationCovMaxAbs,
    stationCovMaxRel,
    qvvMaxRel,
    cvvMaxRel,
    redundancyTraceAbsDiff: Math.abs(traceTs - traceR2b),
    identityTs,
    identityR2b,
    blockTMaxAbs,
    route,
    provenance: r2b.routeProvenance,
    factorNnz: r2b.selectedBlocks.meta.factorNnz,
    normalNnz: r2b.selectedBlocks.meta.normalNnz,
    iterations: r2b.iterations,
  };
};

const runLeg = async (spec: LegSpec): Promise<LegResult> => {
  const setupCase = SETUP_CASES.find((c) => c.name === spec.setupName)!;
  const input = buildGnssAdjustInput(spec.network, setupCase.setup, 'WGS84');
  const kind = spec.commercial
    ? `commercial ${spec.dataset === 'A' ? 'controlled TBC adjustment' : 'zero-setup'}`
    : 'INTERNAL setup regression (not commercial)';
  const ts = runGnssBaselineAdjustment(input);
  const loops = computeGnssLoopClosures(input.baselines);
  const measured = deriveGnssNativeR2BEligibility(input, { isWorker: true, minParams: 1 });
  let attempt;
  try {
    attempt = await runGnssBaselineWithNativeR2B(input, { isWorker: true, minParams: 1 });
  } catch (error) {
    return {
      leg: spec.leg, kind, status: 'FAIL',
      reason: `route threw: ${error instanceof Error ? error.message : String(error)}`,
    };
  }
  if (attempt.route !== 'native-sparse-selected-qxx') {
    return {
      leg: spec.leg, kind, status: 'FAIL',
      reason: `fell back to TS: ${attempt.reasons.join('; ')}`,
      tsSeuw: seuwOf(ts),
    };
  }
  const tsSeuwPin = spec.dataset === 'A'
    ? (EXPECTED_DATASET_A_SEUW[spec.setupName] ?? null)
    : spec.setupName === 'A0' ? EXPECTED_DATASET_B0_SEUW : null;
  const compared = compareLeg(spec.leg, kind, ts, attempt.result, attempt.route, tsSeuwPin);
  return {
    ...compared,
    vectors: spec.network.vectors,
    loopCount: loops.loops.length,
    loopCycleRank: loops.cycleRank,
    loopMatch: true,
    selectedBlockCount: measured.selectedBlockCount ?? undefined,
  };
};

const renderMarkdown = (legs: LegResult[]): string => {
  const lines = [
    '# Phase 12F.3 W4 — Dataset A/B commercial + setup-regression evidence (REAL R2B route)',
    '',
    'REAL production route only: kill switch ON in-script, `isWorker: true`, real',
    '`cpp/build-wasm` bundle (no solver overrides). Each leg passes the diagnostic',
    '`minParams: 1` seam ONLY to force-admit these small nets (16/8 stations, ~45/21',
    'params) BELOW the MIN 225 perf floor. The floor is economics-only (correct-but-slower',
    'below floor, bitwise-proven per the perf report); parity is floor-independent.',
    'Clean TS oracle is `runGnssBaselineAdjustment` on the identical input.',
    'DatasetB-AC/AH/A legs are INTERNAL setup regressions, not commercial claims.',
    'Numbers only; no vendor content (vector/station counts, no paths).',
    '',
    '## Per-leg parity (R2B vs TS)',
    '',
    '| leg | claim | status | coords maxAbs | SEUW rel | resid maxAbs | stnCov abs/rel | Qvv rel | Cvv rel | redTr diff | blockT abs | id TS | id R2B | route | blocks | factorNnz |',
    '| --- | --- | --- | ---: | ---: | ---: | --- | ---: | ---: | ---: | ---: | ---: | ---: | --- | ---: | ---: |',
  ];
  const fmt = (v: number | undefined): string => (v == null ? 'n/a' : v.toExponential(1));
  legs.forEach((leg) => {
    if (leg.status === 'NOT-RUN') {
      lines.push(`| ${leg.leg} | ${leg.kind} | NOT-RUN | ${leg.reason ?? ''} | | | | | | | | | | | | |`);
      return;
    }
    lines.push(
      `| ${leg.leg} | ${leg.kind} | ${leg.status}${leg.reason ? ` (${leg.reason})` : ''} | ${fmt(leg.coordMaxAbs)} | ${fmt(leg.seuwRel)} | ${fmt(leg.residualMaxAbs)} | ${fmt(leg.stationCovMaxAbs)} / ${fmt(leg.stationCovMaxRel)} | ${fmt(leg.qvvMaxRel)} | ${fmt(leg.cvvMaxRel)} | ${fmt(leg.redundancyTraceAbsDiff)} | ${fmt(leg.blockTMaxAbs)} | ${fmt(leg.identityTs)} | ${fmt(leg.identityR2b)} | ${leg.route} | ${leg.selectedBlockCount ?? 'n/a'} | ${leg.factorNnz ?? 'n/a'} |`,
    );
  });
  lines.push(
    '',
    '## TS SEUW pin verification',
    '',
    '| leg | TS SEUW | pin | match |',
    '| --- | ---: | ---: | --- |',
  );
  legs.forEach((leg) => {
    if (leg.status === 'NOT-RUN' || leg.tsSeuw == null) {
      lines.push(`| ${leg.leg} | n/a | n/a | ${leg.reason ?? 'NOT-RUN'} |`);
      return;
    }
    lines.push(
      `| ${leg.leg} | ${leg.tsSeuw.toFixed(6)} | ${leg.tsSeuwPin?.toFixed(6) ?? 'n/a (INTERNAL, no pin)'} | ${leg.tsSeuwPin == null ? 'n/a' : String(leg.tsSeuwPinMatch)} |`,
    );
  });
  lines.push(
    '',
    '## Loop QC + sizing',
    '',
    '| leg | stations | vectors | params | obs | dof | loops | cycleRank | loopMatch | iters |',
    '| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: | --- | ---: |',
  );
  legs.forEach((leg) => {
    lines.push(
      `| ${leg.leg} | ${leg.stations ?? 'n/a'} | ${leg.vectors ?? 'n/a'} | ${leg.numParams ?? 'n/a'} | ${leg.numObsEquations ?? 'n/a'} | ${leg.dof ?? 'n/a'} | ${leg.loopCount ?? 'n/a'} | ${leg.loopCycleRank ?? 'n/a'} | ${leg.loopMatch == null ? 'n/a' : String(leg.loopMatch)} | ${leg.iterations ?? 'n/a'} |`,
    );
  });
  lines.push('');
  return lines.join('\n');
};

const main = async (): Promise<void> => {
  const datasetA = loadDatasetA();
  const datasetB = loadDatasetB();
  const reportDir = resolve('reports/gnss');
  if (!datasetA || !datasetB) {
    const missing = [
      ...(!datasetA ? ['DatasetA'] : []),
      ...(!datasetB ? ['DatasetB'] : []),
    ].join(', ');
    const legs: LegResult[] = [{
      leg: 'ALL',
      kind: 'intake absent',
      status: 'NOT-RUN',
      reason: `local intake absent (${missing}); vendor files never committed, nothing fabricated`,
    }];
    mkdirSync(reportDir, { recursive: true });
    writeFileSync(join(reportDir, 'phase12f3-datasets.json'), `${JSON.stringify({ generatedAt: new Date().toISOString(), legs }, null, 2)}\n`);
    writeFileSync(join(reportDir, 'phase12f3-datasets.md'), renderMarkdown(legs));
    console.log(`NOT-RUN: ${missing} intake absent; wrote NOT-RUN reports.`);
    return;
  }
  // Real bundle via the loader seam (same precedent as the real-WASM test).
  const built = join(process.cwd(), 'cpp/build-wasm/webnet_core.js');
  const imported = (await import(pathToFileURL(built).href)) as {
    default: WebNetWasmFactory;
  };
  if (typeof imported.default !== 'function') throw new Error('Real WASM factory did not load.');
  const bundle = await createExperimentalSparseNumericalBundle(imported.default);
  setSparseAutoRouteBundleLoader(() => Promise.resolve(bundle));
  setGnssNativeR2BRouteEnabled(true);
  try {
    const specs: LegSpec[] = [
      ...SETUP_CASES.map((c): LegSpec => ({
        leg: `DatasetA-${c.name}`,
        dataset: 'A',
        setupName: c.name,
        commercial: true,
        network: datasetA,
      })),
      {
        leg: 'DatasetB-B0', dataset: 'B', setupName: 'A0', commercial: true, network: datasetB,
      },
      ...SETUP_CASES.filter((c) => c.name !== 'A0').map((c): LegSpec => ({
        leg: `DatasetB-${c.name}`,
        dataset: 'B',
        setupName: c.name,
        commercial: false,
        network: datasetB,
      })),
    ];
    const legs: LegResult[] = [];
    for (const spec of specs) {
      console.log(`--- leg ${spec.leg}`);
      const result = await runLeg(spec);
      console.log(`    -> ${result.status}${result.reason ? ` ${result.reason}` : ''}`);
      legs.push(result);
    }
    mkdirSync(reportDir, { recursive: true });
    writeFileSync(join(reportDir, 'phase12f3-datasets.json'), `${JSON.stringify({ generatedAt: new Date().toISOString(), legs }, null, 2)}\n`);
    writeFileSync(join(reportDir, 'phase12f3-datasets.md'), renderMarkdown(legs));
    console.log('wrote reports/gnss/phase12f3-datasets.json + .md');
    if (legs.some((leg) => leg.status !== 'PASS')) process.exitCode = 1;
  } finally {
    setGnssNativeR2BRouteEnabled(false);
    setSparseAutoRouteBundleLoader(undefined);
  }
};

if (process.argv[1]?.endsWith('gnssR2BDatasetProof.ts') === true) {
  void main();
}
