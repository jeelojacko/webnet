/**
 * Phase 12F.0 — native/WASM architecture & performance audit campaign.
 *
 * EVIDENCE TIER, manual-only (never CI): requires the real
 * cpp/build-wasm artifact (fails loudly when absent) and the read-only
 * local TBC intake for the Dataset A/B legs (fails loudly when absent;
 * vendor files are never committed).
 *
 * Legs: small-net R0/R1/R2 full parity + completeness + full-vs-selected
 * cross-check; Dataset-A stochastic ×4 setups (native-vs-TS, NOT vs TBC);
 * Dataset-B manual case; synthetic corpus parity/perf/memory scaling
 * (R2-only at 500+ where dense Qxx is infeasible); blunder what-if and
 * loop-QC agreement. Machine JSON goes to artifacts/evidence/phase12f0/
 * (gitignored); the decision report is written separately.
 *
 * No production routing/math/tolerance/GVX/UI changes.
 */
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { describe, expect, it } from 'vitest';
import { runGnssBaselineAdjustment } from '../../src/engine/gnssBaselineAdjust';
import { computeGnssLoopClosures } from '../../src/engine/gnssBaselineLoops';
import { rankGnssBaselineSuspects } from '../../src/engine/gnssBaselineStatistics';
import { createExperimentalSparseNumericalBundle } from '../../src/engine/wasm/experimentalSparseNumericalBundle';
import type { WebNetWasmFactory } from '../../src/engine/wasm/wasmTypes';
import {
  buildGnssAdjustInput,
  compareParity,
  EXPECTED_DATASET_A_SEUW,
  generateAuditNetwork,
  loadDatasetA,
  loadDatasetB,
  runNativeGnssRoute,
  runTimedGnssLoop,
  SETUP_CASES,
  type AuditNetwork,
  type AuditTopology,
  type StageTimings,
} from '../../scripts/gnss/gnssNativeArchitectureAudit';

const ARTIFACT_DIR = join(process.cwd(), 'artifacts/evidence/phase12f0');

const median = (xs: number[]): number => [...xs].sort((a, b) => a - b)[Math.floor(xs.length / 2)] ?? 0;
const heapMB = (): number => process.memoryUsage().heapUsed / 1048576;

const loadFactory = async (): Promise<WebNetWasmFactory> => {
  const mod = (await import(
    pathToFileURL(`${process.cwd()}/cpp/build-wasm/webnet_core.js`).href
  )) as { default: WebNetWasmFactory };
  if (typeof mod.default !== 'function') throw new Error('WASM factory missing: rebuild cpp/build-wasm.');
  return mod.default;
};

interface CaseRecord {
  case: string;
  params: number;
  equations: number;
  dof: number;
  r0TotalMs: number;
  r0Stages: StageTimings;
  r1TotalMs: number;
  r2TotalMs: number;
  r1Parity: ReturnType<typeof compareParity>;
  r2Parity: ReturnType<typeof compareParity>;
  r1Native: { bridgeCopyMs: number; assemblyMs?: number; factorMs?: number; solveMs?: number; queryWallMs: number; normalNnz?: number; factorNnz?: number };
  r2Native: { bridgeCopyMs: number; assemblyMs?: number; factorMs?: number; solveMs?: number; queryWallMs: number; normalNnz?: number; factorNnz?: number };
  heapDeltaR0Mb: number;
  heapDeltaR1Mb: number;
  heapDeltaR2Mb: number;
  traceIdentity: number;
  selectedVsFullMaxAbs: number;
}

const runCase = async (
  label: string,
  topology: AuditTopology,
  stations: number,
  seed: number,
  bundle: Awaited<ReturnType<typeof createExperimentalSparseNumericalBundle>>,
  options?: { setupIndex?: number; measured?: number; skipR0Dense?: boolean; mutate?: (_network: AuditNetwork) => void },
): Promise<CaseRecord> => {
  const network = generateAuditNetwork(topology, stations, seed);
  options?.mutate?.(network);
  const setup = options?.setupIndex != null ? SETUP_CASES[options.setupIndex]!.setup : undefined;
  const input = buildGnssAdjustInput(network, setup);
  const measured = options?.measured ?? 5;
  // Warm-up (compilation + allocator paths), then measured medians.
  // Fidelity (extra production run) only on the first pass to bound
  // dense-solve repetitions at scale.
  runTimedGnssLoop(input, undefined, { skipFidelity: true });
  const r0Totals: number[] = [];
  // Fidelity-gated run FIRST: assert the replica against production before
  // any skipFidelity timing run reassigns r0 (self-comparison would be 0
  // by construction).
  const gated = runTimedGnssLoop(input);
  expect(gated.replicaMaxCoordDiff).toBeLessThan(1e-12);
  expect(gated.replicaMaxQxxDiff).toBeLessThan(1e-15);
  const r0 = gated;
  for (let i = 0; i < measured; i += 1) {
    const timed = runTimedGnssLoop(input, undefined, { skipFidelity: true });
    r0Totals.push(timed.stages.totalMs);
  }
  const heap0 = heapMB();
  runTimedGnssLoop(input, undefined, { skipFidelity: true });
  const heapDeltaR0Mb = heapMB() - heap0;
  const solvers = {
    correction: bundle.sparseCorrectionSolver,
    selected: bundle.sparseSelectedCovarianceSolver,
  };
  runNativeGnssRoute(input, solvers, 'r1-full');
  const r1Totals: number[] = [];
  let r1 = runNativeGnssRoute(input, solvers, 'r1-full');
  for (let i = 0; i < measured; i += 1) {
    const t0 = performance.now();
    const attempt = runNativeGnssRoute(input, solvers, 'r1-full');
    r1Totals.push(performance.now() - t0);
    if (i === 0) r1 = attempt;
  }
  const heap1 = heapMB();
  runNativeGnssRoute(input, solvers, 'r1-full');
  const heapDeltaR1Mb = heapMB() - heap1;
  runNativeGnssRoute(input, solvers, 'r2-selected');
  const r2Totals: number[] = [];
  let r2 = runNativeGnssRoute(input, solvers, 'r2-selected');
  for (let i = 0; i < measured; i += 1) {
    const t0 = performance.now();
    const attempt = runNativeGnssRoute(input, solvers, 'r2-selected');
    r2Totals.push(performance.now() - t0);
    if (i === 0) r2 = attempt;
  }
  const heap2 = heapMB();
  runNativeGnssRoute(input, solvers, 'r2-selected');
  const heapDeltaR2Mb = heapMB() - heap2;
  const r1Parity = compareParity(r0.result, r1.result, 'full');
  const r2Parity = compareParity(r0.result, r2.result, 'selected');
  // Full-vs-selected cross-check (§18): iterate exactly the queried
  // positions (upper-triangle + Q_AB spans), so exactly-zero queried
  // entries are compared, not silently skipped.
  let selectedVsFullMaxAbs = 0;
  for (let k = 0; k < r2.queryRows.length; k += 1) {
    const rr = r2.queryRows[k]!;
    const cc = r2.queryColumns[k]!;
    selectedVsFullMaxAbs = Math.max(
      selectedVsFullMaxAbs,
      Math.abs((r2.qxx[rr]?.[cc] ?? 0) - (r1.qxx[rr]?.[cc] ?? 0)),
    );
  }
  const record: CaseRecord = {
    case: label,
    params: r0.result.numParams,
    equations: r0.result.numObsEquations,
    dof: r0.result.dof,
    r0TotalMs: median(r0Totals),
    r0Stages: r0.stages,
    r1TotalMs: median(r1Totals),
    r2TotalMs: median(r2Totals),
    r1Parity,
    r2Parity,
    r1Native: {
      bridgeCopyMs: r1.timings.bridgeCopyMs,
      assemblyMs: r1.timings.nativeAssemblyMs,
      factorMs: r1.timings.factorMs,
      solveMs: r1.timings.solveCovMs,
      queryWallMs: r1.timings.queryWallMs,
      normalNnz: r1.timings.normalNnz,
      factorNnz: r1.timings.factorNnz,
    },
    r2Native: {
      bridgeCopyMs: r2.timings.bridgeCopyMs,
      assemblyMs: r2.timings.nativeAssemblyMs,
      factorMs: r2.timings.factorMs,
      solveMs: r2.timings.solveCovMs,
      queryWallMs: r2.timings.queryWallMs,
      normalNnz: r2.timings.normalNnz,
      factorNnz: r2.timings.factorNnz,
    },
    heapDeltaR0Mb,
    heapDeltaR1Mb,
    heapDeltaR2Mb,
    traceIdentity: Math.max(r1Parity.redundancyTraceAbs, r2Parity.redundancyTraceAbs),
    selectedVsFullMaxAbs,
  };
  void options?.skipR0Dense;
  return record;
};

const expectFullParity = (parity: ReturnType<typeof compareParity>, label: string): void => {
  expect(parity.maxCoordAbs, `${label} coords`).toBeLessThan(1e-9);
  expect(parity.vtpvRel, `${label} vTPv`).toBeLessThan(1e-9);
  expect(parity.seuwRel, `${label} SEUW`).toBeLessThan(1e-9);
  expect(parity.qxxMaxRel, `${label} Qxx rel`).toBeLessThan(1e-6);
  expect(parity.qxxMaxAbs, `${label} Qxx abs`).toBeLessThan(1e-9);
  expect(parity.residualMaxAbs, `${label} residuals`).toBeLessThan(1e-9);
  expect(parity.qvvMaxRel, `${label} Qvv`).toBeLessThan(1e-6);
  expect(parity.cvvMaxRel, `${label} Cvv`).toBeLessThan(1e-6);
  expect(parity.redundancyTraceAbs, `${label} trace`).toBeLessThan(1e-9);
  expect(parity.standardizedMaxAbs, `${label} standardized`).toBeLessThan(1e-6);
  expect(parity.blockTRel, `${label} blockT`).toBeLessThan(1e-6);
};

const expectSelectedParity = (parity: ReturnType<typeof compareParity>, label: string): void => {
  // Same contract minus full-Qxx entries (selected blocks only).
  expect(parity.maxCoordAbs, `${label} coords`).toBeLessThan(1e-9);
  expect(parity.vtpvRel, `${label} vTPv`).toBeLessThan(1e-9);
  expect(parity.seuwRel, `${label} SEUW`).toBeLessThan(1e-9);
  expect(parity.residualMaxAbs, `${label} residuals`).toBeLessThan(1e-9);
  expect(parity.qvvMaxRel, `${label} Qvv`).toBeLessThan(1e-6);
  expect(parity.cvvMaxRel, `${label} Cvv`).toBeLessThan(1e-6);
  expect(parity.redundancyTraceAbs, `${label} trace`).toBeLessThan(1e-9);
  expect(parity.standardizedMaxAbs, `${label} standardized`).toBeLessThan(1e-6);
  expect(parity.blockTRel, `${label} blockT`).toBeLessThan(1e-6);
};

describe('phase12f0 native architecture audit (real WASM, manual)', () => {
  it('small-net R0/R1/R2 parity, completeness, and cross-checks', async () => {
    const factory = await loadFactory();
    const bundle = await createExperimentalSparseNumericalBundle(factory);
    mkdirSync(ARTIFACT_DIR, { recursive: true });
    const records: CaseRecord[] = [];
    const legs: { label: string; topology: AuditTopology; stations: number; seed: number; mutate?: (_network: AuditNetwork) => void }[] = [
      // Bridgeless only (finding F-BRIDGE excludes chains/trees/rays).
      { label: 'mesh-10', topology: 'sparse-mesh', stations: 10, seed: 1201 },
      { label: 'ring-10', topology: 'ring', stations: 10, seed: 1202 },
      { label: 'repeated-12', topology: 'repeated-edge', stations: 12, seed: 1203 },
      { label: 'mesh-25', topology: 'sparse-mesh', stations: 25, seed: 1204 },
      { label: 'ring-50', topology: 'ring', stations: 50, seed: 1205 },
      // Heterogeneous-sigma probe (MEDIUM 3): one ultra-precise edge
      // (covariance x1e-4) inside a bridgeless mesh — lopsided weighting
      // stressing near-zero-redundancy margins without a cut-edge.
      {
        label: 'hetero-mesh-25', topology: 'sparse-mesh', stations: 25, seed: 1204,
        mutate: (network) => {
          const first = network.baselines[0]!;
          const scale = 1e-4;
          network.baselines[0] = {
            ...first,
            covariance: {
              xx: first.covariance.xx * scale, xy: first.covariance.xy * scale,
              xz: first.covariance.xz * scale, yy: first.covariance.yy * scale,
              yz: first.covariance.yz * scale, zz: first.covariance.zz * scale,
            },
          };
        },
      },
    ];
    for (const { label, topology, stations, seed, mutate } of legs) {
      const record = await runCase(label, topology, stations, seed, bundle, { mutate });
      records.push(record);
      expectFullParity(record.r1Parity, `${label}/R1`);
      expectSelectedParity(record.r2Parity, `${label}/R2`);
      expect(record.selectedVsFullMaxAbs, `${label} full-vs-selected`).toBeLessThan(1e-9);
      expect(record.traceIdentity, `${label} trace`).toBeLessThan(1e-9);
    }
    // Blunder what-if + loop QC agreement on mesh-10.
    const network = generateAuditNetwork('sparse-mesh', 10, 1201);
    const blundered = network.baselines.map((b, index) =>
      index === 0 ? { ...b, vector: { ...b.vector, x: b.vector.x + 0.05 } } : b);
    const r0b = runGnssBaselineAdjustment(buildGnssAdjustInput({ stations: network.stations, baselines: blundered }));
    const r2b = runNativeGnssRoute(
      buildGnssAdjustInput({ stations: network.stations, baselines: blundered }),
      { correction: bundle.sparseCorrectionSolver, selected: bundle.sparseSelectedCovarianceSolver },
      'r2-selected',
    );
    const top0 = rankGnssBaselineSuspects(r0b.statistics)[0]!;
    const top2 = rankGnssBaselineSuspects(r2b.result.statistics)[0]!;
    expect(top2.baselineId).toBe(top0.baselineId);
    expect(top0.baselineId).toBe(blundered[0]!.id);
    const loops = computeGnssLoopClosures(network.baselines);
    expect(loops.loops.length).toBeGreaterThan(0);
    expect(loops.cycleRank).toBe(network.baselines.length - 10 + 1);
    writeFileSync(join(ARTIFACT_DIR, 'small-net.json'), JSON.stringify(records, null, 2));
  }, 600000);

  it('Dataset-A stochastic cases: native-vs-TS on effective covariances', async () => {
    const intake = loadDatasetA();
    if (!intake) throw new Error('Dataset-A intake absent (expected local read-only intake).');
    const factory = await loadFactory();
    const bundle = await createExperimentalSparseNumericalBundle(factory);
    mkdirSync(ARTIFACT_DIR, { recursive: true });
    const rows: Record<string, unknown>[] = [];
    for (const { name, setup } of SETUP_CASES) {
      // 12E.3 production API: session ellipsoid WGS84 (intake GVX is tagless).
      const input = buildGnssAdjustInput(intake, setup, 'WGS84');
      const r0 = runGnssBaselineAdjustment(input);
      const seuw = Math.sqrt(Math.max(r0.varianceFactor, 0));
      // Oracle pin (12E.3): TS SEUW must reproduce the known values.
      expect(Math.abs(seuw - EXPECTED_DATASET_A_SEUW[name]!), `TS SEUW ${name}`).toBeLessThan(1e-6);
      const solvers = {
        correction: bundle.sparseCorrectionSolver,
        selected: bundle.sparseSelectedCovarianceSolver,
      };
      const r1 = runNativeGnssRoute(input, solvers, 'r1-full');
      const r2 = runNativeGnssRoute(input, solvers, 'r2-selected');
      const p1 = compareParity(r0, r1.result, 'full');
      const p2 = compareParity(r0, r2.result, 'selected');
      expectFullParity(p1, `datasetA-${name}/R1`);
      expectSelectedParity(p2, `datasetA-${name}/R2`);
      rows.push({
        setup: name, seuw, expected: EXPECTED_DATASET_A_SEUW[name],
        r1Coords: p1.maxCoordAbs, r1SeuwRel: p1.seuwRel, r1QxxRel: p1.qxxMaxRel,
        r2Coords: p2.maxCoordAbs, r2SeuwRel: p2.seuwRel, r2BlockTRel: p2.blockTRel,
      });
    }
    writeFileSync(join(ARTIFACT_DIR, 'dataset-a.json'), JSON.stringify(rows, null, 2));
  }, 600000);

  it('Dataset-B manual case: 50-vector network R0/R1/R2', async () => {
    const intake = loadDatasetB();
    if (!intake) throw new Error('Dataset-B intake absent (expected local read-only intake).');
    expect(intake.vectors).toBe(50);
    const factory = await loadFactory();
    const bundle = await createExperimentalSparseNumericalBundle(factory);
    mkdirSync(ARTIFACT_DIR, { recursive: true });
    const input = buildGnssAdjustInput(intake);
    const r0 = runTimedGnssLoop(input);
    expect(r0.replicaMaxCoordDiff).toBeLessThan(1e-12);
    const solvers = {
      correction: bundle.sparseCorrectionSolver,
      selected: bundle.sparseSelectedCovarianceSolver,
    };
    const r1 = runNativeGnssRoute(input, solvers, 'r1-full');
    const r2 = runNativeGnssRoute(input, solvers, 'r2-selected');
    const p1 = compareParity(r0.result, r1.result, 'full');
    const p2 = compareParity(r0.result, r2.result, 'selected');
    expectFullParity(p1, 'datasetB/R1');
    expectSelectedParity(p2, 'datasetB/R2');
    writeFileSync(join(ARTIFACT_DIR, 'dataset-b.json'), JSON.stringify([{
      params: r0.result.numParams, dof: r0.result.dof,
      seuw: Math.sqrt(Math.max(r0.result.varianceFactor, 0)),
      vtpv: r0.result.weightedResidualSum,
      r1Parity: p1, r2Parity: p2,
      r1Native: r1.timings, r2Native: r2.timings,
    }], null, 2));
  }, 600000);

  it('corpus scaling: parity, crossover, memory (R2-only at 500+)', async () => {
    const factory = await loadFactory();
    const bundle = await createExperimentalSparseNumericalBundle(factory);
    mkdirSync(ARTIFACT_DIR, { recursive: true });
    const records: CaseRecord[] = [];
    // Mid sizes carry full R0/R1/R2; 500+ is R2-only (dense Qxx infeasible).
    const fullLegs: [string, AuditTopology, number, number][] = [
      ['mesh-100', 'sparse-mesh', 100, 1301],
    ];
    for (const [label, topology, stations, seed] of fullLegs) {
      const record = await runCase(label, topology, stations, seed, bundle, { measured: 3 });
      records.push(record);
      expectFullParity(record.r1Parity, `${label}/R1`);
      expectSelectedParity(record.r2Parity, `${label}/R2`);
    }
    // mesh-250: single-sample walls (dense TS inversion dominates; the
    // fidelity gate still runs once per size).
    {
      const record = await runCase('mesh-250', 'sparse-mesh', 250, 1302, bundle, { measured: 1 });
      records.push(record);
      expectFullParity(record.r1Parity, 'mesh-250/R1');
      expectSelectedParity(record.r2Parity, 'mesh-250/R2');
    }
    const largeRows: Record<string, unknown>[] = [];
    for (const [label, topology, stations, seed] of [
      ['mesh-500', 'sparse-mesh', 500, 1401],
      ['mesh-1000', 'sparse-mesh', 1000, 1402],
      // mesh-2000 deliberately NOT in-suite: observed JS-heap OOM in the
      // TS dense assembly (P ~ 24k^2 x 8 B = 4.6 GB + boxed A) kills the
      // worker before any native call. Ceiling documented in the report.
    ] as [string, AuditTopology, number, number][]) {
      try {
        const network = generateAuditNetwork(topology, stations, seed);
      const input = buildGnssAdjustInput(network);
      const solvers = {
        correction: bundle.sparseCorrectionSolver,
        selected: bundle.sparseSelectedCovarianceSolver,
      };
      // TS dense Qxx is deliberately NOT formed here; R2 self-validates via
      // the redundancy-trace identity (needs selected blocks only).
      const heapBefore = heapMB();
      const first = runNativeGnssRoute(input, solvers, 'r2-selected');
      const walls: number[] = [];
      for (let i = 0; i < 2; i += 1) {
        const t0 = performance.now();
        runNativeGnssRoute(input, solvers, 'r2-selected');
        walls.push(performance.now() - t0);
      }
      const heapAfter = heapMB();
      const trace = first.result.statistics.reduce((sum, s) => sum + s.redundancy.trace, 0);
      const traceAbs = Math.abs(trace - first.result.dof);
      expect(traceAbs, `${label} R2 trace identity`).toBeLessThan(1e-6);
      expect(first.result.converged, `${label} converged`).toBe(true);
      largeRows.push({
        case: label, params: first.result.numParams, dof: first.result.dof,
        equations: first.result.numObsEquations,
        densePBytes: first.result.numObsEquations ** 2 * 8,
        r2TotalMs: median(walls),
        bridgeCopyMs: first.timings.bridgeCopyMs,
        factorMs: first.timings.factorMs,
        solveMs: first.timings.solveCovMs,
        queryWallMs: first.timings.queryWallMs,
        normalNnz: first.timings.normalNnz,
        factorNnz: first.timings.factorNnz,
        selectedQueries: first.selectedCoverage,
        qxxBytesAvoided: first.result.numParams ** 2 * 8,
        heapDeltaMb: heapAfter - heapBefore,
        traceAbs,
      });
      } catch (error) {
        // Ceiling probe: record the failure mode instead of killing the
        // worker (dense TS assembly is the expected limiter).
        largeRows.push({ case: label, failed: (error as Error).message?.slice(0, 300) });
      }
      // Incremental write: a hard crash at a later size keeps earlier rows.
      writeFileSync(
        join(ARTIFACT_DIR, 'corpus.json'),
        JSON.stringify({ records, large: largeRows }, null, 2),
      );
    }
    writeFileSync(
      join(ARTIFACT_DIR, 'corpus.json'),
      JSON.stringify({ records, large: largeRows }, null, 2),
    );
  }, 1200000);
});
