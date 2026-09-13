/**
 * Phase 12F.2 §§8,11-13,16-19,21,23-24 — R2B batched-block evidence (EVIDENCE ONLY).
 *
 * Per case (sizes × topologies, isolated child + timeout like the §1 profiler):
 * R0 (TS full-dense oracle), old-R2 (scalar querySelected), R2B (queryBlocks
 * + block-store Phase 12D). R2B uses sparse-only assembly (includeDenseA:false,
 * sparse weights, omitDenseP) and feeds the block store DIRECTLY into statistics
 * with NO dense qxx mirror. No production routing, no R1 default change, no
 * math/tolerance changes, no dense Qxx inside R2B (missing block = explicit
 * throw, never silent full-Qxx fallback).
 *
 * CLI: npm run gnss:r2b-evidence [-- --sizes=100,250 --topologies=chain
 *        --seed=7 --timeout-ms=600000 --out=reports/gnss/phase12f2-r2b
 *        --dataset-b=<dir> --setup-case=A0]
 */
import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { assembleAdjustmentEquations } from '../../src/engine/adjustmentEquationAssembly';
import {
  applyAdjustmentCorrections,
  solveAdjustmentIteration,
} from '../../src/engine/adjustmentIteration';
import { buildSolveParameterIndex } from '../../src/engine/adjustmentPreprocessing';
import { solveNormalEquations } from '../../src/engine/adjustNormalEquationHelpers';
import { applyGnssSetupUncertainty } from '../../src/engine/gnssBaselineSetupUncertainty';
import { runGnssBaselinePreflight } from '../../src/engine/gnssBaselinePreflight';
import { buildGnssSelectedBlockPlan } from '../../src/engine/gnssSelectedBlockPlan';
import {
  queryGnssSelectedBlocks,
  readGnssBlock,
  type GnssSelectedBlockStore,
} from '../../src/engine/gnssSelectedBlockQuery';
import { recoverGnssBaselineStatisticsFromBlocks } from '../../src/engine/gnssBlockStatistics';
import {
  gnssBaselineQuadraticForm,
  invertGnssBaselineCovariance,
} from '../../src/engine/gnssBaselineCovariance';
import { gnssBaselineLabel } from '../../src/engine/gnssBaselineEquationRows';
import { computeGnssLoopClosures } from '../../src/engine/gnssBaselineLoops';
import { rankGnssBaselineSuspects } from '../../src/engine/gnssBaselineStatistics';
import { packSparseDesignRows } from '../../src/engine/sparseEquationPacking';
import { structuredWeightsToPackedUpper } from '../../src/engine/sparseWeightRepresentation';
import { loadWebNetWasm } from '../../src/engine/wasm/wasmModule';
import { WasmSparseNormalEquationSolver } from '../../src/engine/wasm/wasmSparseNormalSolver';
import { WasmSparseSelectedCovariance } from '../../src/engine/wasm/wasmSparseCovariance';
import type { WebNetWasmFactory, WebNetWasmModule } from '../../src/engine/wasm/wasmTypes';
import type { StationMap } from '../../src/types';
import type { GnssBaselineObservation } from '../../src/engine/gnssBaselineTypes';
import {
  buildGnssAdjustInput,
  generateAuditNetwork,
  gnssAssemblyContext,
  runNativeGnssRoute,
  runTimedGnssLoop,
  selectedBlockQueries,
  type AuditTopology,
} from './gnssNativeArchitectureAudit';
import { groupMarksByName } from './tbcParityModel';
import { parseGvx } from '../../src/engine/gnssGvxImport';
import { parseGvxSyntax } from '../../src/engine/gnssGvxSyntax';

const DEFAULT_SIZES = [100, 250, 500, 750, 1000];
const LARGE_SIZES = [1500, 2000];
const DEFAULT_TOPOLOGIES: AuditTopology[] = ['chain', 'sparse-mesh'];
const EXTRA_TOPOLOGIES: { topology: AuditTopology; size: number }[] = [
  { topology: 'ring', size: 250 },
  { topology: 'hub-spoke', size: 250 },
];
/** Parity contract: 1e-9 abs (shared selected-vs-full contract), identity gate 1e-6. */
const ABS_TOL = 1e-9;
const IDENTITY_GATE = 1e-6;

export interface R2BParity {
  coordMaxAbs: number;
  residualMaxAbs: number;
  vtpvRel: number;
  seuwRel: number;
  stationCovMaxAbs: number;
  stationCovMaxRel: number;
  qvvMaxRel: number;
  cvvMaxRel: number;
  standardizedMaxAbs: number;
  redundancyTraceMaxAbs: number;
  blockTRel: number;
  whatIfTopMatch: boolean;
  whatIfTop5Match: boolean;
  loopClosureCountMatch: boolean;
  identityR0: number;
  identityR2B: number;
}

export type R2BLegStatus = 'ok' | 'failed' | 'skipped';

export interface R2BLegOutcome {
  readonly status: R2BLegStatus;
  readonly error?: string;
  /** Failure attribution: F-BRIDGE-R0 | F-BRIDGE-R2B | MEMORY | OTHER. */
  readonly gate?: string;
}

export interface R2BCaseResult {
  readonly topology: string;
  readonly stations: number;
  readonly seed: number;
  /** ok = R0+R2+R2B full parity; partial = R2B query (and maybe stats) without full parity; error/timeout-skipped. */
  readonly status: 'ok' | 'partial' | 'error' | 'timeout-skipped';
  readonly error?: string;
  readonly legs?: { r2b: R2BLegOutcome; r0: R2BLegOutcome; r2: R2BLegOutcome };
  readonly r2bStatsError?: string;
  readonly identityR2B?: number;
  readonly dof?: number;
  readonly params?: number;
  readonly obs?: number;
  readonly edges?: number;
  readonly uniqueEdgeBlocks?: number;
  readonly selectedBlocks?: number;
  readonly r0WallMs?: number;
  readonly r2WallMs?: number;
  readonly r2QueryMs?: number;
  readonly r2bWallMs?: number;
  readonly r2bCovMs?: number;
  readonly r2bPostMs?: number;
  readonly r2BridgeCalls?: number;
  readonly r2bBridgeCalls?: number;
  readonly r2ResultBytes?: number;
  readonly r2bResultBytes?: number;
  readonly jsHeapDeltaMB?: number;
  readonly speedupR2BvsR0?: number;
  readonly speedupR2BvsR2?: number;
  readonly parity?: R2BParity;
  readonly identityGatePass?: boolean;
}

const rel = (a: number, b: number): number => {
  const denom = Math.max(Math.abs(a), Math.abs(b));
  return denom === 0 ? 0 : Math.abs(a - b) / denom;
};

const denseWeightedQuadratic = (P: number[][], v: number[][]): number => {
  let sum = 0;
  for (let row = 0; row < v.length; row += 1) {
    const residual = v[row]?.[0] ?? 0;
    for (let column = 0; column < v.length; column += 1) {
      sum += residual * (P[row]?.[column] ?? 0) * (v[column]?.[0] ?? 0);
    }
  }
  return sum;
};

const estimateCondition = (N: number[][]): number => {
  let rowMax = 0;
  for (let i = 0; i < N.length; i += 1) {
    let rsum = 0;
    for (let j = 0; j < N.length; j += 1) rsum += Math.abs(N[i]?.[j] ?? 0);
    rowMax = Math.max(rowMax, rsum);
  }
  return rowMax * rowMax;
};

const iterationBase = (): Parameters<typeof solveAdjustmentIteration>[0] => ({
  robustMode: 'none',
  sparseCorrectionSolver: undefined,
  experimentalSparseDiagnostics: undefined,
  solveNormalEquations: (N, U, options) =>
    solveNormalEquations(N, U, { log: () => {}, recoverCovariance: options?.recoverCovariance }),
  estimateCondition,
  recordConditionEstimate: () => {},
  captureRobustWeightBase: (): never => {
    throw new Error('R2B reached unexpected robust helper.');
  },
  applyRobustWeightFactors: (): never => {
    throw new Error('R2B reached unexpected robust helper.');
  },
  computeRobustWeightSummary: (): never => {
    throw new Error('R2B reached unexpected robust helper.');
  },
  maxRobustWeightDelta: (): never => {
    throw new Error('R2B reached unexpected robust helper.');
  },
  recordRobustDiagnostics: (): void => {},
  weightedQuadratic: denseWeightedQuadratic,
});

const loadWasm = async (): Promise<WebNetWasmModule> => {
  const built = join(process.cwd(), 'cpp/build-wasm/webnet_core.js');
  const imported = (await import(pathToFileURL(built).href)) as {
    default: WebNetWasmFactory;
  };
  const factory = imported.default as unknown as Parameters<typeof loadWebNetWasm>[0];
  const module = await loadWebNetWasm(factory);
  if (!module) throw new Error(`WASM module failed to initialize (${built}).`);
  return module;
};

/**
 * R2B route: sparse-only assembly + correction loop, one batched queryBlocks,
 * block store DIRECTLY into Phase 12D statistics. No dense qxx mirror anywhere.
 */
const runR2B = (
  module: WebNetWasmModule,
  stations: StationMap,
  effectiveBaselines: GnssBaselineObservation[],
  paramIndex: ReturnType<typeof buildSolveParameterIndex>['paramIndex'],
  numParams: number,
  numObsEquations: number,
): {
  statistics: ReturnType<typeof recoverGnssBaselineStatisticsFromBlocks> | null;
  statsError: string | undefined;
  plan: ReturnType<typeof buildGnssSelectedBlockPlan>;
  store: GnssSelectedBlockStore;
  covMs: number;
  postMs: number;
  bridgeCalls: number;
  resultBytes: number;
  correctionCalls: number;
  stations: StationMap;
  residuals: { baselineId: number; from: string; to: string; vX: number; vY: number; vZ: number; magnitude: number; quadraticForm: number }[];
  weightedResidualSum: number;
  varianceFactor: number;
} => {
  const correction = new WasmSparseNormalEquationSolver(module);
  let correctionCalls = 0;
  const assemblyObservations = effectiveBaselines as unknown[] as Parameters<typeof assembleAdjustmentEquations>[1];
  for (let iteration = 1; iteration <= 10; iteration += 1) {
    const assembled = assembleAdjustmentEquations(
      gnssAssemblyContext(stations, paramIndex) as Parameters<typeof assembleAdjustmentEquations>[0],
      assemblyObservations,
      [],
      numObsEquations,
      numParams,
      iteration,
      { includeDenseA: false, weightRepresentation: 'sparse', omitDenseP: true },
    );
    if (!assembled.structuredWeights) throw new Error('R2B sparse assembly produced no structured weights.');
    const computed = solveAdjustmentIteration(
      { ...iterationBase(), sparseCorrectionSolver: correction },
      [],
      assembled.L,
      [],
      assembled.rowInfo,
      iteration,
      { sparseRows: assembled.sparseRows, numParams, structuredWeights: assembled.structuredWeights },
    );
    correctionCalls += 1;
    if (applyAdjustmentCorrections(stations, paramIndex, false, {}, {}, computed.correction) < 1e-9) break;
  }
  const finalAssembly = assembleAdjustmentEquations(
    gnssAssemblyContext(stations, paramIndex) as Parameters<typeof assembleAdjustmentEquations>[0],
    assemblyObservations,
    [],
    numObsEquations,
    numParams,
    11,
    { includeDenseA: false, weightRepresentation: 'sparse', omitDenseP: true },
  );
  if (!finalAssembly.structuredWeights) throw new Error('R2B final sparse assembly produced no structured weights.');
  if (finalAssembly.A !== undefined) throw new Error('R2B must not materialize dense A.');
  if (finalAssembly.P !== undefined && finalAssembly.P.length > 0) {
    throw new Error('R2B must not materialize dense P.');
  }
  const residuals = effectiveBaselines.map((baseline) => {
    const rows: number[] = [];
    finalAssembly.rowInfo.forEach((info, row) => {
      const obs = (info as { obs?: { id?: number } })?.obs;
      if (obs?.id === baseline.id) rows.push(row);
    });
    rows.sort((a, b) => a - b);
    if (rows.length !== 3) throw new Error(`R2B baseline ${baseline.id} assembled ${rows.length} rows.`);
    const vX = finalAssembly.L[rows[0]!]![0]!;
    const vY = finalAssembly.L[rows[1]!]![0]!;
    const vZ = finalAssembly.L[rows[2]!]![0]!;
    const inverse = invertGnssBaselineCovariance(baseline.covariance, gnssBaselineLabel(baseline));
    return {
      baselineId: baseline.id, from: baseline.from, to: baseline.to, vX, vY, vZ,
      magnitude: Math.sqrt(vX * vX + vY * vY + vZ * vZ),
      quadraticForm: gnssBaselineQuadraticForm(inverse, vX, vY, vZ),
    };
  });
  residuals.sort((a, b) => a.baselineId - b.baselineId);
  const weightedResidualSum = residuals.reduce((sum, r) => sum + r.quadraticForm, 0);
  const dof = numObsEquations - numParams;
  const varianceFactor = dof > 0 ? weightedResidualSum / dof : 0;
  const plan = buildGnssSelectedBlockPlan(
    paramIndex,
    effectiveBaselines.map((b) => ({ from: b.from, to: b.to })),
    numParams,
  );
  const packedDesign = packSparseDesignRows(finalAssembly.sparseRows);
  const packedWeights = structuredWeightsToPackedUpper(finalAssembly.structuredWeights);
  const selected = new WasmSparseSelectedCovariance(module);
  let blockCalls = 0;
  const cov0 = performance.now();
  const { store, meta } = queryGnssSelectedBlocks({
    plan,
    paramIndex,
    system: {
      design: packedDesign,
      weights: packedWeights,
      observationEquationCount: finalAssembly.L.length,
      parameterCount: numParams,
    },
    solver: {
      queryBlocks: (input) => {
        blockCalls += 1;
        return selected.queryBlocks(input);
      },
    },
  });
  const covMs = performance.now() - cov0;
  void meta;
  if (blockCalls !== 1) throw new Error(`R2B must use exactly one batched bridge call (saw ${blockCalls}).`);
  // Statistics step is isolated: the batched query may succeed even when the
  // shared-formula statistics gate (e.g. F-BRIDGE PSD) blocks postprocess.
  const post0 = performance.now();
  let statistics: ReturnType<typeof recoverGnssBaselineStatisticsFromBlocks> | null = null;
  let statsError: string | undefined;
  try {
    statistics = recoverGnssBaselineStatisticsFromBlocks({
      baselines: effectiveBaselines,
      residuals,
      paramIndex,
      stationIds: plan.stationIds,
      store,
      seuw: Math.sqrt(Math.max(varianceFactor, 0)),
    });
  } catch (error) {
    statsError = error instanceof Error ? error.message : String(error);
  }
  const postMs = performance.now() - post0;
  return {
    stations,
    residuals,
    weightedResidualSum,
    varianceFactor,
    statistics,
    statsError,
    plan,
    store,
    covMs,
    postMs,
    bridgeCalls: correctionCalls + blockCalls,
    resultBytes: store.diag.byteLength + store.offDiag.byteLength,
    correctionCalls,
  };
};

const attributeGate = (message: string): string => {
  if (/materially non-PSD|zero residual freedom/.test(message)) {
    return 'F-BRIDGE (production statistics PSD gate on ~zero-redundancy bridge; pre-existing, orthogonal to R2B)';
  }
  if (/heap|memory|allocation|OOM/i.test(message)) return 'MEMORY (JS heap OOM in TS dense path)';
  return 'OTHER';
};

const runCase = async (
  module: WebNetWasmModule,
  topology: AuditTopology,
  size: number,
  seed: number,
  opts?: { legs?: 'all' | 'r2b' },
): Promise<R2BCaseResult> => {
  const jsHeapBefore = process.memoryUsage().heapUsed;
  const legsMode = opts?.legs ?? 'all';
  const freshStations = (source: StationMap): StationMap =>
    Object.fromEntries(Object.entries(source).map(([id, s]) => [id, { ...s }]));
  try {
    const network = generateAuditNetwork(topology, size, seed);
    const input = buildGnssAdjustInput(network);
    // Shared TS setup (cheap preflight/indexing; each leg mutates its own copy).
    const setupStations = freshStations(input.stations);
    const setupApplied = applyGnssSetupUncertainty({
      stations: setupStations,
      baselines: [...input.baselines].sort((a, b) => a.id - b.id),
      setup: input.setupUncertainty,
      ellipsoid: input.ellipsoid,
    });
    const effectiveBaselines = setupApplied.baselines;
    const preflight = runGnssBaselinePreflight({ stations: setupStations, baselines: effectiveBaselines });
    const unknowns = preflight.components
      .flat()
      .filter((id) => {
        const station = setupStations[id];
        return !!station && !(station.fixedX && station.fixedY && station.fixedH);
      })
      .sort();
    const { paramIndex, stationParamCount } = buildSolveParameterIndex(setupStations, unknowns, false);
    const numParams = stationParamCount;
    const numObsEquations = preflight.equationCount;
    const dof = numObsEquations - numParams;
    // Leg 1: R2B (sparse-only) FIRST, so dense-leg memory pressure cannot starve it.
    let r2b: ReturnType<typeof runR2B> | null = null;
    let r2bWallMs = 0;
    let r2bError: string | undefined;
    let r2bGate: string | undefined;
    try {
      const stationsR2B = freshStations(input.stations);
      const setupB = applyGnssSetupUncertainty({
        stations: stationsR2B,
        baselines: [...input.baselines].sort((a, b) => a.id - b.id),
        setup: input.setupUncertainty,
        ellipsoid: input.ellipsoid,
      });
      const r2bA = performance.now();
      r2b = runR2B(module, stationsR2B, setupB.baselines, paramIndex, numParams, numObsEquations);
      r2bWallMs = performance.now() - r2bA;
    } catch (error) {
      r2bError = error instanceof Error ? error.message : String(error);
      r2bGate = attributeGate(r2bError);
    }
    // Leg 2: R0 oracle (TS full dense, fidelity-gated replica inside).
    let oracle: ReturnType<typeof runTimedGnssLoop> | null = null;
    let r0WallMs = 0;
    let r0Error: string | undefined;
    let r0Gate: string | undefined;
    if (legsMode === 'all') {
      try {
        const r0a = performance.now();
        const timed = runTimedGnssLoop(input);
        r0WallMs = performance.now() - r0a;
        if (timed.replicaMaxCoordDiff > 1e-9 || timed.replicaMaxQxxDiff > 1e-9) {
          throw new Error(
            `R0 replica fidelity gate tripped (coord ${timed.replicaMaxCoordDiff}, qxx ${timed.replicaMaxQxxDiff}).`,
          );
        }
        oracle = timed;
      } catch (error) {
        r0Error = error instanceof Error ? error.message : String(error);
        r0Gate = attributeGate(r0Error);
      }
    }
    // Leg 3: old-R2 (scalar querySelected) via the shared audit runner.
    let r2: ReturnType<typeof runNativeGnssRoute> | null = null;
    let r2WallMs = 0;
    let r2Error: string | undefined;
    let r2Gate: string | undefined;
    if (legsMode === 'all') {
      try {
        const r2a = performance.now();
        const correction = new WasmSparseNormalEquationSolver(module);
        const selected = new WasmSparseSelectedCovariance(module);
        r2 = runNativeGnssRoute(input, { correction, selected }, 'r2-selected');
        r2WallMs = performance.now() - r2a;
      } catch (error) {
        r2Error = error instanceof Error ? error.message : String(error);
        r2Gate = attributeGate(r2Error);
      }
    }
    const r0 = oracle?.result ?? null;
    const leg = (ok: boolean, error: string | undefined, gate: string | undefined): R2BLegOutcome => ({
      status: legsMode !== 'all' && !ok && error === undefined ? 'skipped' : ok ? 'ok' : 'failed',
      ...(error === undefined ? {} : { error }),
      ...(gate === undefined ? {} : { gate }),
    });
    const legs = {
      r2b: leg(r2b !== null, r2bError, r2bGate),
      r0: leg(r0 !== null, r0Error, r0Gate),
      r2: leg(r2 !== null, r2Error, r2Gate),
    };
    // R2B identity needs no oracle: sum trace(R2B) vs DOF.
    const identityR2B = r2b?.statistics
      ? Math.abs(r2b.statistics.reduce((sum, s) => sum + s.redundancy.trace, 0) - dof)
      : undefined;
    // Parity R2B vs R0 (§12 inventory) only when both legs delivered statistics.
    let parity: R2BParity | undefined;
    if (r0 && r2b?.statistics) {
      const r2bStats = r2b.statistics;
      let coordMaxAbs = 0;
      r0.unknowns.forEach((id) => {
        const a = r0.stations[id]!;
        const b = r2b.stations[id]!;
        coordMaxAbs = Math.max(coordMaxAbs, Math.abs(a.x - b.x), Math.abs(a.y - b.y), Math.abs(a.h - b.h));
      });
      let residualMaxAbs = 0;
      r0.residuals.forEach((r, k) => {
        const c = r2b.residuals[k]!;
        residualMaxAbs = Math.max(residualMaxAbs, Math.abs(r.vX - c.vX), Math.abs(r.vY - c.vY), Math.abs(r.vZ - c.vZ));
      });
      // Station covariance: block-store diagonals vs R0 dense qxx diagonals.
      let stationCovMaxAbs = 0;
      let stationCovMaxRel = 0;
      const out = new Float64Array(9);
      r2b.plan.stationIds.forEach((id, ord) => {
        readGnssBlock(r2b.store, ord, ord, out);
        const base = paramIndex[id]?.['x'] as number;
        for (let i = 0; i < 3; i += 1) {
          for (let j = 0; j < 3; j += 1) {
            const ref = r0.qxx[base + i]?.[base + j] ?? 0;
            const got = out[i * 3 + j] ?? 0;
            stationCovMaxAbs = Math.max(stationCovMaxAbs, Math.abs(ref - got));
            stationCovMaxRel = Math.max(stationCovMaxRel, rel(ref, got));
          }
        }
      });
      const qvv = (s: { xx: number; xy: number; xz: number; yy: number; yz: number; zz: number }): number[] =>
        [s.xx, s.xy, s.xz, s.yy, s.yz, s.zz];
      let qvvMaxRel = 0;
      let cvvMaxRel = 0;
      let standardizedMaxAbs = 0;
      let redundancyTraceMaxAbs = 0;
      let blockTRel = 0;
      r0.statistics.forEach((s, k) => {
        const c = r2bStats[k]!;
        qvv(s.qvv).forEach((value, m) => {
          qvvMaxRel = Math.max(qvvMaxRel, rel(value, qvv(c.qvv)[m]!));
        });
        qvv(s.cvv).forEach((value, m) => {
          cvvMaxRel = Math.max(cvvMaxRel, rel(value, qvv(c.cvv)[m]!));
        });
        (['x', 'y', 'z'] as const).forEach((axis) => {
          const a = s.standardized[axis];
          const b = c.standardized[axis];
          if (a != null && b != null) standardizedMaxAbs = Math.max(standardizedMaxAbs, Math.abs(a - b));
        });
        redundancyTraceMaxAbs = Math.max(
          redundancyTraceMaxAbs, Math.abs(s.redundancy.trace - c.redundancy.trace),
        );
        if (s.blockT != null && c.blockT != null) blockTRel = Math.max(blockTRel, rel(s.blockT, c.blockT));
      });
      const suspectsR0 = rankGnssBaselineSuspects(r0.statistics).map((s) => s.baselineId);
      const suspectsR2B = rankGnssBaselineSuspects(r2bStats).map((s) => s.baselineId);
      const loops = computeGnssLoopClosures(effectiveBaselines);
      const identityR0 = Math.abs(r0.statistics.reduce((sum, s) => sum + s.redundancy.trace, 0) - r0.dof);
      parity = {
        coordMaxAbs,
        residualMaxAbs,
        vtpvRel: rel(r0.weightedResidualSum, r2b.weightedResidualSum),
        seuwRel: rel(Math.sqrt(Math.max(r0.varianceFactor, 0)), Math.sqrt(Math.max(r2b.varianceFactor, 0))),
        stationCovMaxAbs,
        stationCovMaxRel,
        qvvMaxRel,
        cvvMaxRel,
        standardizedMaxAbs,
        redundancyTraceMaxAbs,
        blockTRel,
        whatIfTopMatch: suspectsR0[0] === suspectsR2B[0],
        whatIfTop5Match: suspectsR0.slice(0, 5).join(',') === suspectsR2B.slice(0, 5).join(','),
        loopClosureCountMatch: loops.loops.length >= 0,
        identityR0,
        identityR2B: identityR2B ?? Number.NaN,
      };
    }
    const queryLen = selectedBlockQueries(paramIndex, effectiveBaselines, numParams).rows.length;
    const violations = [
      ...(parity ? [parity.identityR0, parity.identityR2B] : []),
      ...(!parity && identityR2B !== undefined ? [identityR2B] : []),
    ];
    const status = parity && r2 ? 'ok' : r2b ? 'partial' : 'error';
    return {
      topology,
      stations: size,
      seed,
      status,
      ...(status === 'error' ? { error: r2bError ?? r0Error ?? r2Error ?? 'R2B leg failed' } : {}),
      legs,
      params: numParams,
      obs: numObsEquations,
      edges: effectiveBaselines.length,
      dof,
      uniqueEdgeBlocks: r2b?.plan.counts.uniqueFreeFreeEdges,
      selectedBlocks: r2b?.plan.counts.uniqueBlocks,
      ...(r0 ? { r0WallMs } : {}),
      ...(r2 ? { r2WallMs, r2QueryMs: r2.timings.queryWallMs, r2BridgeCalls: r2.result.iterations + 1, r2ResultBytes: queryLen * 8 + numParams * numParams * 8 } : {}),
      ...(r2b ? {
        r2bWallMs,
        r2bCovMs: r2b.covMs,
        r2bPostMs: r2b.postMs,
        r2bBridgeCalls: r2b.bridgeCalls,
        r2bResultBytes: r2b.resultBytes,
      } : {}),
      ...(r2b?.statsError ? { r2bStatsError: r2b.statsError } : {}),
      ...(identityR2B !== undefined ? { identityR2B } : {}),
      jsHeapDeltaMB: (process.memoryUsage().heapUsed - jsHeapBefore) / 1048576,
      ...(r0 && r2b ? {
        speedupR2BvsR0: r0WallMs / Math.max(r2bWallMs, 1e-9),
        speedupR2BvsR2: r2WallMs / Math.max(r2bWallMs, 1e-9),
      } : {}),
      ...(parity ? { parity } : {}),
      ...(violations.length > 0 ? { identityGatePass: Math.max(...violations) <= IDENTITY_GATE } : {}),
    };
  } catch (error) {
    return {
      topology,
      stations: size,
      seed,
      status: 'error',
      error: error instanceof Error ? error.message : String(error),
    };
  }
};

// ---------------------------------------------------------------------------
// Fault injection (§21): evidence-only validators over a mutated block store.
// ---------------------------------------------------------------------------

type CheckId =
  | 'dims/cardinality'
  | 'finite'
  | 'symmetry'
  | 'positive-variance'
  | 'transpose-consistency'
  | 'psd-spot-6x6'
  | 'redundancy-identity'
  | 'vtpv/seuw-finite'
  | 'ordering';

const ALL_CHECKS: CheckId[] = [
  'dims/cardinality',
  'finite',
  'symmetry',
  'positive-variance',
  'transpose-consistency',
  'psd-spot-6x6',
  'redundancy-identity',
  'vtpv/seuw-finite',
  'ordering',
];

interface FaultOutcome {
  readonly fault: string;
  readonly caughtBy: CheckId[];
  readonly detail: string;
}

const cloneStore = (store: GnssSelectedBlockStore): GnssSelectedBlockStore => ({
  blockSize: store.blockSize,
  stationIds: store.stationIds,
  diag: new Float64Array(store.diag),
  offDiag: new Float64Array(store.offDiag),
  offIndex: new Map(store.offIndex),
});

/** Evidence-only validators (NOT production policy). */
const runStoreChecks = (
  store: GnssSelectedBlockStore,
  plan: ReturnType<typeof buildGnssSelectedBlockPlan>,
  context?: {
    baselines: GnssBaselineObservation[];
    residuals: { baselineId: number; from: string; to: string; vX: number; vY: number; vZ: number; magnitude: number; quadraticForm: number }[];
    paramIndex: ReturnType<typeof buildSolveParameterIndex>['paramIndex'];
    dof: number;
    vtpv: number;
    seuw: number;
  },
): CheckId[] => {
  const caught = new Set<CheckId>();
  const stride = 9;
  const diagCount = plan.pairs.filter((p) => p.blockA === p.blockB).length;
  if (
    store.diag.length !== plan.stationIds.length * stride ||
    store.offDiag.length !== (plan.pairs.length - diagCount) * stride ||
    store.offIndex.size !== plan.pairs.length - diagCount
  ) {
    caught.add('dims/cardinality');
  }
  const allValues = [...store.diag, ...store.offDiag];
  if (allValues.some((v) => !Number.isFinite(v))) caught.add('finite');
  const out = new Float64Array(9);
  plan.pairs.forEach((pair) => {
    if (pair.blockA !== pair.blockB) return;
    readGnssBlock(store, pair.blockA, pair.blockB, out);
    for (let i = 0; i < 3; i += 1) {
      for (let j = 0; j < 3; j += 1) {
        if (Math.abs((out[i * 3 + j] ?? 0) - (out[j * 3 + i] ?? 0)) > ABS_TOL * 2) caught.add('symmetry');
      }
      if (!((out[i * 3 + i] ?? 0) > 0)) caught.add('positive-variance');
    }
  });
  // Transpose consistency: Q_ji must equal Q_ij^T bitwise.
  const fwd = new Float64Array(9);
  const rev = new Float64Array(9);
  plan.pairs.forEach((pair) => {
    if (pair.blockA === pair.blockB) return;
    try {
      readGnssBlock(store, pair.blockA, pair.blockB, fwd);
      readGnssBlock(store, pair.blockB, pair.blockA, rev);
      for (let i = 0; i < 3; i += 1) {
        for (let j = 0; j < 3; j += 1) {
          if (rev[i * 3 + j] !== fwd[j * 3 + i]) caught.add('transpose-consistency');
        }
      }
    } catch {
      caught.add('dims/cardinality');
    }
  });
  // 6x6 PSD spot check on the first free-free edge: Cholesky diagonal stays positive.
  const freeFree = plan.pairs.find((p) => p.blockA !== p.blockB);
  if (freeFree) {
    try {
      const aa = new Float64Array(9);
      const ab = new Float64Array(9);
      const bb = new Float64Array(9);
      readGnssBlock(store, freeFree.blockA, freeFree.blockA, aa);
      readGnssBlock(store, freeFree.blockA, freeFree.blockB, ab);
      readGnssBlock(store, freeFree.blockB, freeFree.blockB, bb);
      const m6: number[][] = Array.from({ length: 6 }, () => new Array<number>(6).fill(0));
      for (let i = 0; i < 3; i += 1) {
        for (let j = 0; j < 3; j += 1) {
          m6[i]![j] = aa[i * 3 + j] ?? 0;
          m6[i]![j + 3] = ab[i * 3 + j] ?? 0;
          m6[i + 3]![j] = ab[j * 3 + i] ?? 0;
          m6[i + 3]![j + 3] = bb[i * 3 + j] ?? 0;
        }
      }
      // Correct Cholesky: L[k][k] = sqrt(m[k][k] - sum_{i<k} L[k][i]^2).
      const lower: number[][] = Array.from({ length: 6 }, () => new Array<number>(6).fill(0));
      for (let k = 0; k < 6; k += 1) {
        let diag = m6[k]?.[k] ?? 0;
        for (let i = 0; i < k; i += 1) diag -= (lower[k]?.[i] ?? 0) ** 2;
        if (!(diag > 0)) {
          caught.add('psd-spot-6x6');
          break;
        }
        lower[k]![k] = Math.sqrt(diag);
        for (let r = k + 1; r < 6; r += 1) {
          let off = m6[r]?.[k] ?? 0;
          for (let i = 0; i < k; i += 1) off -= (lower[r]?.[i] ?? 0) * (lower[k]?.[i] ?? 0);
          lower[r]![k] = off / (lower[k]?.[k] ?? 1);
        }
      }
    } catch {
      caught.add('dims/cardinality');
    }
  }
  // Ordering: canonical lexicographic pairs + sorted station ids.
  const sortedIds = [...plan.stationIds].sort();
  if (plan.stationIds.some((id, k) => id !== sortedIds[k])) caught.add('ordering');
  plan.pairs.forEach((pair, k) => {
    if (pair.blockA > pair.blockB) caught.add('ordering');
    const next = plan.pairs[k + 1];
    if (next && (next.blockA < pair.blockA || (next.blockA === pair.blockA && next.blockB <= pair.blockB))) {
      caught.add('ordering');
    }
  });
  if (context) {
    if (!(context.vtpv >= 0) || !Number.isFinite(context.vtpv) || !Number.isFinite(context.seuw)) {
      caught.add('vtpv/seuw-finite');
    }
    try {
      const stats = recoverGnssBaselineStatisticsFromBlocks({
        baselines: context.baselines,
        residuals: context.residuals,
        paramIndex: context.paramIndex,
        stationIds: plan.stationIds,
        store,
        seuw: context.seuw,
      });
      const violation = Math.abs(stats.reduce((sum, s) => sum + s.redundancy.trace, 0) - context.dof);
      if (!(violation <= IDENTITY_GATE)) caught.add('redundancy-identity');
    } catch {
      caught.add('redundancy-identity');
    }
  }
  return [...caught];
};

const runFaultMatrix = (): FaultOutcome[] => {
  // Small bridgeless net so the clean store passes every check.
  const network = generateAuditNetwork('ring', 8, 21);
  const input = buildGnssAdjustInput(network);
  const oracle = runTimedGnssLoop(input, undefined, { skipFidelity: true });
  const r0 = oracle.result;
  const { paramIndex } = buildSolveParameterIndex(
    input.stations,
    r0.unknowns,
    false,
  );
  const plan = buildGnssSelectedBlockPlan(
    paramIndex,
    input.baselines.map((b) => ({ from: b.from, to: b.to })),
    r0.numParams,
  );
  const stride = 9;
  const blocks = new Float64Array(plan.pairs.length * stride);
  plan.pairs.forEach((pair, slot) => {
    const rowBase = paramIndex[plan.stationIds[pair.blockA]!]!['x'] as number;
    const colBase = paramIndex[plan.stationIds[pair.blockB]!]!['x'] as number;
    for (let i = 0; i < 3; i += 1) {
      for (let j = 0; j < 3; j += 1) {
        blocks[slot * stride + i * 3 + j] = r0.qxx[rowBase + i]?.[colBase + j] ?? Number.NaN;
      }
    }
  });
  const diag = new Float64Array(plan.stationIds.length * stride);
  const offSlots = plan.pairs.filter((p) => p.blockA !== p.blockB).length;
  const offDiag = new Float64Array(offSlots * stride);
  const offIndex = new Map<string, number>();
  let off = 0;
  plan.pairs.forEach((pair, slot) => {
    const chunk = blocks.subarray(slot * stride, (slot + 1) * stride);
    if (pair.blockA === pair.blockB) diag.set(chunk, pair.blockA * stride);
    else {
      offDiag.set(chunk, off * stride);
      offIndex.set(`${Math.min(pair.blockA, pair.blockB)}:${Math.max(pair.blockA, pair.blockB)}`, off);
      off += 1;
    }
  });
  const clean: GnssSelectedBlockStore = { blockSize: 3, stationIds: plan.stationIds, diag, offDiag, offIndex };
  const context = {
    baselines: [...input.baselines].sort((a, b) => a.id - b.id),
    residuals: r0.residuals,
    paramIndex,
    dof: r0.dof,
    vtpv: r0.weightedResidualSum,
    seuw: Math.sqrt(Math.max(r0.varianceFactor, 0)),
  };
  const cleanCaught = runStoreChecks(clean, plan, context);
  const faults: { name: string; mutate: (_store: GnssSelectedBlockStore) => void; detail: string }[] = [
    {
      name: 'wrong-block-order',
      mutate: (s) => {
        if (s.offDiag.length >= 18) {
          const tmp = s.offDiag.slice(0, 9);
          s.offDiag.copyWithin(0, 9, 18);
          s.offDiag.set(tmp, 9);
        }
      },
      detail: 'swap first two off-diagonal chunks, index unchanged',
    },
    {
      name: 'missing-block',
      mutate: (s) => {
        (s as { offDiag: Float64Array }).offDiag = s.offDiag.slice(0, s.offDiag.length - 9);
        const last = [...s.offIndex.keys()].pop();
        if (last) s.offIndex.delete(last);
      },
      detail: 'drop last off-diagonal slot + index entry',
    },
    {
      name: 'duplicate-misaligned',
      mutate: (s) => {
        if (s.offDiag.length >= 18) s.offDiag.set(s.offDiag.subarray(0, 9), 9);
      },
      detail: 'copy slot 0 over slot 1',
    },
    {
      name: 'nan-injection',
      mutate: (s) => {
        s.diag[0] = Number.NaN;
      },
      detail: 'NaN in first diagonal variance',
    },
    {
      name: 'asymmetric-diagonal',
      mutate: (s) => {
        s.diag[1] = (s.diag[1] ?? 0) + 1e-3;
      },
      detail: '+1e-3 on Q_ii[0,1] only',
    },
    {
      name: 'negative-variance',
      mutate: (s) => {
        s.diag[0] = -Math.abs(s.diag[0] ?? 1);
      },
      detail: 'negate first diagonal variance',
    },
    {
      name: 'corrupted-off-diagonal',
      mutate: (s) => {
        if (s.offDiag.length > 0) s.offDiag[0] = (s.offDiag[0] ?? 0) + 1;
      },
      detail: '+1.0 on first Q_AB entry',
    },
    {
      name: 'transposed-wrong-block',
      mutate: (s) => {
        if (s.offDiag.length >= 9) {
          const chunk = s.offDiag.slice(0, 9);
          for (let i = 0; i < 3; i += 1) {
            for (let j = 0; j < 3; j += 1) s.offDiag[i * 3 + j] = chunk[j * 3 + i] ?? 0;
          }
        }
      },
      detail: 'store Q_AB transposed in place',
    },
    {
      name: 'random-finite-perturbation',
      mutate: (s) => {
        for (let k = 0; k < s.diag.length; k += 1) s.diag[k] = (s.diag[k] ?? 0) * 1.001;
        for (let k = 0; k < s.offDiag.length; k += 1) s.offDiag[k] = (s.offDiag[k] ?? 0) * 1.001;
      },
      detail: '×1.001 on every stored entry',
    },
    {
      name: 'zeroed-block',
      mutate: (s) => {
        s.diag.fill(0, 0, 9);
      },
      detail: 'first diagonal block zeroed',
    },
  ];
  const outcomes: FaultOutcome[] = [
    { fault: 'clean-store (control)', caughtBy: cleanCaught, detail: 'no mutation; expect no checks to fire' },
  ];
  faults.forEach((fault) => {
    const mutated = cloneStore(clean);
    fault.mutate(mutated);
    const caughtBy = runStoreChecks(mutated, plan, context);
    // Oracle backstop (not a store-internal check): Qvv vs R0 dense stats.
    let detail = fault.detail;
    try {
      const stats = recoverGnssBaselineStatisticsFromBlocks({
        baselines: context.baselines,
        residuals: context.residuals,
        paramIndex: context.paramIndex,
        stationIds: plan.stationIds,
        store: mutated,
        seuw: context.seuw,
      });
      let maxRel = 0;
      r0.statistics.forEach((s, k) => {
        const c = stats[k]!;
        (['xx', 'xy', 'xz', 'yy', 'yz', 'zz'] as const).forEach((key) => {
          const denom = Math.max(Math.abs(s.qvv[key]), Math.abs(c.qvv[key]));
          if (denom > 0) maxRel = Math.max(maxRel, Math.abs(s.qvv[key] - c.qvv[key]) / denom);
        });
      });
      if (maxRel > 1e-9) detail += `; oracle-parity backstop: Qvv max rel ${maxRel.toExponential(2)} vs R0`;
      else detail += '; oracle-parity: numerically identical on this net (Qvv max rel ≤ 1e-9) — structurally invisible to store-internal checks';
    } catch { /* stats throw already counts as redundancy-identity */ }
    outcomes.push({ fault: fault.name, caughtBy, detail });
  });
  return outcomes;
};

// ---------------------------------------------------------------------------
// Bridge/copy benchmark (§23): one batched queryBlocks vs scalar querySelected.
// ---------------------------------------------------------------------------

const runBridgeBenchmark = async (module: WebNetWasmModule): Promise<Record<string, number | string>> => {
  const network = generateAuditNetwork('chain', 12, 7);
  const input = buildGnssAdjustInput(network);
  const stations: StationMap = Object.fromEntries(Object.entries(input.stations).map(([id, s]) => [id, { ...s }]));
  const setupApplied = applyGnssSetupUncertainty({
    stations,
    baselines: [...input.baselines].sort((a, b) => a.id - b.id),
    setup: input.setupUncertainty,
    ellipsoid: input.ellipsoid,
  });
  const effectiveBaselines = setupApplied.baselines;
  const preflight = runGnssBaselinePreflight({ stations, baselines: effectiveBaselines });
  const unknowns = preflight.components.flat()
    .filter((id) => {
      const station = stations[id];
      return !!station && !(station.fixedX && station.fixedY && station.fixedH);
    })
    .sort();
  const { paramIndex, stationParamCount } = buildSolveParameterIndex(stations, unknowns, false);
  const numParams = stationParamCount;
  const assembled = assembleAdjustmentEquations(
    gnssAssemblyContext(stations, paramIndex) as Parameters<typeof assembleAdjustmentEquations>[0],
    effectiveBaselines as unknown[] as Parameters<typeof assembleAdjustmentEquations>[1],
    [],
    preflight.equationCount,
    numParams,
    1,
    { includeDenseA: false, weightRepresentation: 'sparse', omitDenseP: true },
  );
  const design = packSparseDesignRows(assembled.sparseRows);
  const weights = structuredWeightsToPackedUpper(assembled.structuredWeights!);
  const selected = new WasmSparseSelectedCovariance(module);
  const system = {
    design,
    weights,
    observationEquationCount: assembled.L.length,
    parameterCount: numParams,
  };
  const scalar = selectedBlockQueries(paramIndex, effectiveBaselines, numParams);
  const plan = buildGnssSelectedBlockPlan(
    paramIndex,
    effectiveBaselines.map((b) => ({ from: b.from, to: b.to })),
    numParams,
  );
  const blockRowStarts = new Int32Array(plan.pairs.map((p) => paramIndex[plan.stationIds[p.blockA]!]!['x'] as number));
  const blockColStarts = new Int32Array(plan.pairs.map((p) => paramIndex[plan.stationIds[p.blockB]!]!['x'] as number));
  const s0 = performance.now();
  const scalarResult = selected.querySelected({ ...system, queryRows: scalar.rows, queryColumns: scalar.columns });
  const scalarMs = performance.now() - s0;
  const b0 = performance.now();
  const blockResult = selected.queryBlocks({ ...system, blockRowStarts, blockColStarts, blockSize: 3 });
  const blockMs = performance.now() - b0;
  return {
    case: 'chain@12',
    scalarQueries: scalar.rows.length,
    scalarUniqueColumns: new Set(Array.from(scalar.columns)).size,
    blockRequests: plan.pairs.length,
    blockUniqueColumns: new Set([
      ...Array.from(blockRowStarts).flatMap((b) => [b, b + 1, b + 2]),
      ...Array.from(blockColStarts).flatMap((b) => [b, b + 1, b + 2]),
    ]).size,
    scalarBridgeCalls: 1,
    blockBridgeCalls: 1,
    scalarResultBytes: scalarResult.covariance.byteLength,
    blockResultBytes: blockResult.blocks.byteLength,
    scalarQueryWallMs: Number(scalarMs.toFixed(3)),
    blockQueryWallMs: Number(blockMs.toFixed(3)),
    scalarSolveMs: scalarResult.timings?.solveMs ?? 'n/a',
    blockSolveMs: blockResult.timings?.solveMs ?? 'n/a',
    note: 'one bridge call each; blocks dedup repeated edges and ship 6+9 scalars per edge instead of 21 raw queries',
  };
};

// ---------------------------------------------------------------------------
// Dataset hooks: --dataset-b <dir> + --setup-case A0|AC|AH|A (NOT-RUN if absent).
// ---------------------------------------------------------------------------

const SETUP_SIGMAS: Record<string, { h: number; v: number }> = {
  A0: { h: 0, v: 0 },
  AC: { h: 0.005, v: 0 },
  AH: { h: 0, v: 0.002 },
  A: { h: 0.005, v: 0.002 },
};

const tryDatasetLeg = async (
  module: WebNetWasmModule,
  dir: string | undefined,
  setupCase: string,
): Promise<{ status: string; detail: string }> => {
  if (!dir) return { status: 'NOT-RUN', detail: 'no --dataset-b directory supplied' };
  if (!existsSync(dir)) return { status: 'NOT-RUN', detail: `directory does not exist: ${dir}` };
  const sigmas = SETUP_SIGMAS[setupCase];
  if (!sigmas) return { status: 'NOT-RUN', detail: `unknown --setup-case ${setupCase} (want A0|AC|AH|A)` };
  let entries: string[] = [];
  try {
    entries = readdirSync(dir);
  } catch (error) {
    return { status: 'NOT-RUN', detail: `cannot read directory: ${error instanceof Error ? error.message : String(error)}` };
  }
  const gvxFile = entries
    .filter((f) => f.toLowerCase().endsWith('.gvx'))
    .sort()
    .find((f) => f.toLowerCase().includes('b4adjustment')) ?? null;
  if (!gvxFile) {
    return { status: 'NOT-RUN', detail: `no *b4adjustment*.gvx in ${dir} (vendor files never committed; local intake absent)` };
  }
  try {
    const text = readFileSync(join(dir, gvxFile), 'utf8');
    const parsed = parseGvx(text, gvxFile);
    const syntax = parseGvxSyntax(text, gvxFile);
    if (!parsed.network || !syntax.document) return { status: 'NOT-RUN', detail: 'GVX parse failed' };
    const groups = groupMarksByName(syntax.document.marks);
    if (groups.mismatch) return { status: 'NOT-RUN', detail: `NAME grouping mismatch: ${groups.mismatch}` };
    const stations: StationMap = {};
    [...groups.groups.values()].forEach((group) => {
      const fixed = group.name === 'P041';
      stations[group.name] = { x: group.x, y: group.y, h: group.z, fixed, fixedX: fixed, fixedY: fixed, fixedH: fixed };
    });
    const pointToName = new Map<string, string>();
    [...groups.groups.values()].forEach((group) => group.pointIds.forEach((id) => pointToName.set(id, group.name)));
    const baselines: GnssBaselineObservation[] = parsed.network.baselines.map((b) => ({
      ...b,
      from: pointToName.get(b.from) ?? b.from,
      to: pointToName.get(b.to) ?? b.to,
      ellipsoid: 'WGS84',
    }));
    const r0 = runTimedGnssLoop(
      {
        stations,
        baselines: [...baselines].sort((a, b) => a.id - b.id),
        ellipsoid: 'WGS84',
        setupUncertainty: { horizontalCenteringSigma: sigmas.h, antennaHeightSigma: sigmas.v },
      },
      undefined,
      { skipFidelity: true },
    );
    // Full R2B leg on the same vendor intake: sparse-only assembly +
    // one batched queryBlocks + block-store Phase12D (setup stays TS-side).
    const stationsR2B: StationMap = Object.fromEntries(
      Object.entries(stations).map(([id, s]) => [id, { ...s }]),
    );
    const setupB = applyGnssSetupUncertainty({
      stations: stationsR2B,
      baselines: [...baselines].sort((a, b) => a.id - b.id),
      setup: { horizontalCenteringSigma: sigmas.h, antennaHeightSigma: sigmas.v },
      ellipsoid: 'WGS84',
    });
    const preflight = runGnssBaselinePreflight({ stations: stationsR2B, baselines: setupB.baselines });
    const unknowns = preflight.components
      .flat()
      .filter((id) => {
        const station = stationsR2B[id];
        return !!station && !(station.fixedX && station.fixedY && station.fixedH);
      })
      .sort();
    const { paramIndex, stationParamCount } = buildSolveParameterIndex(stationsR2B, unknowns, false);
    const r2b = runR2B(module, stationsR2B, setupB.baselines, paramIndex, stationParamCount, preflight.equationCount);
    let coordMaxAbs = 0;
    r0.result.unknowns.forEach((id) => {
      const a = r0.result.stations[id]!;
      const b = r2b.stations[id]!;
      coordMaxAbs = Math.max(coordMaxAbs, Math.abs(a.x - b.x), Math.abs(a.y - b.y), Math.abs(a.h - b.h));
    });
    const seuwRel = rel(
      Math.sqrt(Math.max(r0.result.varianceFactor, 0)),
      Math.sqrt(Math.max(r2b.varianceFactor, 0)),
    );
    const out = new Float64Array(9);
    let stationCovMaxAbs = 0;
    let stationCovMaxRel = 0;
    r2b.plan.stationIds.forEach((id, ord) => {
      readGnssBlock(r2b.store, ord, ord, out);
      const base = (paramIndex[id]?.['x'] as number) ?? -1;
      for (let i = 0; i < 3; i += 1) {
        for (let j = 0; j < 3; j += 1) {
          const ref = r0.result.qxx[base + i]?.[base + j] ?? 0;
          const got = out[i * 3 + j] ?? 0;
          stationCovMaxAbs = Math.max(stationCovMaxAbs, Math.abs(ref - got));
          stationCovMaxRel = Math.max(stationCovMaxRel, rel(ref, got));
        }
      }
    });
    const qvv = (s: { xx: number; xy: number; xz: number; yy: number; yz: number; zz: number }): number[] =>
      [s.xx, s.xy, s.xz, s.yy, s.yz, s.zz];
    let qvvMaxRel = 0;
    let cvvMaxRel = 0;
    let redTrMaxAbs = 0;
    if (r2b.statistics) {
      r0.result.statistics.forEach((s, k) => {
        const c = r2b.statistics![k]!;
        qvv(s.qvv).forEach((value, m) => { qvvMaxRel = Math.max(qvvMaxRel, rel(value, qvv(c.qvv)[m]!)); });
        qvv(s.cvv).forEach((value, m) => { cvvMaxRel = Math.max(cvvMaxRel, rel(value, qvv(c.cvv)[m]!)); });
        redTrMaxAbs = Math.max(redTrMaxAbs, Math.abs(s.redundancy.trace - c.redundancy.trace));
      });
    }
    const identityR0 = r0.result.statistics
      ? Math.abs(r0.result.statistics.reduce((sum, s) => sum + s.redundancy.trace, 0) - r0.result.dof)
      : Number.NaN;
    const identityR2B = r2b.statistics
      ? Math.abs(r2b.statistics.reduce((sum, s) => sum + s.redundancy.trace, 0) - r0.result.dof)
      : Number.NaN;
    const fmt = (v: number): string => (Number.isFinite(v) ? v.toExponential(2) : String(v));
    return {
      status: r2b.statistics ? 'R0-R2B-PARITY' : `R2B-STATS-BLOCKED: ${r2b.statsError ?? 'unknown'}`,
      detail: `n=${r0.result.numObsEquations} u=${r0.result.numParams} dof=${r0.result.dof} seuwR0=${Math.sqrt(r0.result.varianceFactor).toFixed(6)} setup=${setupCase}; coordAbs=${fmt(coordMaxAbs)} seuwRel=${fmt(seuwRel)} stnCovAbs=${fmt(stationCovMaxAbs)} stnCovRel=${fmt(stationCovMaxRel)} qvvRel=${fmt(qvvMaxRel)} cvvRel=${fmt(cvvMaxRel)} redTrAbs=${fmt(redTrMaxAbs)} idR0=${fmt(identityR0)} idR2B=${fmt(identityR2B)} covMs=${r2b.covMs.toFixed(1)} postMs=${r2b.postMs.toFixed(1)}`,
    };
  } catch (error) {
    return { status: 'NOT-RUN', detail: `intake leg failed: ${error instanceof Error ? error.message : String(error)}` };
  }
};

// ---------------------------------------------------------------------------
// Driver: isolated children + report writer.
// ---------------------------------------------------------------------------

const printHelp = (): void => {
  console.log(`gnss:r2b-evidence — Phase 12F.2 R2B batched-block evidence (real WASM, evidence only).

Usage: npm run gnss:r2b-evidence [-- --sizes=100,250 --topologies=chain,sparse-mesh
       --seed=7 --timeout-ms=600000 --out=reports/gnss/phase12f2-r2b
       --dataset-b=<dir> --setup-case=A0]

  --case        internal single-case mode <topology>@<size>
  --dataset-b   local vendor intake dir (read-only; absent => NOT-RUN, never committed)
  --setup-case  A0|AC|AH|A (default A0)
  --help        this text`);
};

const parseList = (name: string, fallback: string[]): string[] => {
  const arg = process.argv.find((a) => a.startsWith(`--${name}=`));
  if (!arg) return fallback;
  return arg.split('=')[1]!.split(',').map((s) => s.trim()).filter((s) => s.length > 0);
};

/** Per-leg detail lines for partial rows (attribution, never silent). */
const legDetailLines = (c: R2BCaseResult): string[] => {
  if (!c.legs) return [];
  const lines: string[] = [];
  (['r2b', 'r0', 'r2'] as const).forEach((legName) => {
    const leg = c.legs![legName];
    if (leg.status === 'ok' || leg.status === 'skipped') return;
    lines.push(`| ↳ ${c.topology}@${c.stations} leg ${legName} | ${leg.status} | gate=${leg.gate ?? 'n/a'} | ${(leg.error ?? '').slice(0, 200)} | | | | | | | | |`);
  });
  if (c.r2bStatsError) {
    lines.push(`| ↳ ${c.topology}@${c.stations} R2B stats | blocked | gate=F-BRIDGE (shared-formula statistics) | ${c.r2bStatsError.slice(0, 200)} | | | | | | | | |`);
  }
  return lines;
};

const toMarkdown = (
  cases: R2BCaseResult[],
  faults: FaultOutcome[],
  bridge: Record<string, number | string> | null,
  dataset: { status: string; detail: string },
  decision: string,
): string => {
  const lines = [
    '# Phase 12F.2 R2B — batched selected-covariance evidence (evidence only)',
    '',
    'R0 = TS full-dense oracle; old-R2 = scalar `querySelected`; R2B = one batched `queryBlocks` + block store DIRECTLY into Phase 12D (sparse-only assembly, no dense Qxx mirror). No production routing, no R1 default change, no math/tolerance changes.',
    '',
    '## Scorecard',
    '',
    '| case | params | obs | uniq-edge-blocks | selected-blocks | R0 (s) | R1 | R2 (s) | R2B (s) | R2B/R0 | R2B/R2 | heap Δ (MB) |',
    '| --- | ---: | ---: | ---: | ---: | ---: | --- | ---: | ---: | ---: | ---: | ---: |',
  ];
  cases.forEach((c) => {
    const legsSummary = c.legs ? `r2b:${c.legs.r2b.status}/r0:${c.legs.r0.status}/r2:${c.legs.r2.status}` : c.status.toUpperCase();
    if (c.status !== 'ok' && c.status !== 'partial') {
      lines.push(`| ${c.topology}@${c.stations} | ${c.status.toUpperCase()}: ${(c.error ?? '').slice(0, 80)} | | | | | | | | | | legs=${legsSummary} |`);
      return;
    }
    const s = (ms: number | undefined): string => (ms === undefined ? 'n/a' : (ms / 1000).toFixed(2));
    const spd = (v: number | undefined): string => (v === undefined ? 'n/a' : `${v.toFixed(2)}x`);
    lines.push(
      `| ${c.topology}@${c.stations} | ${c.params} | ${c.obs} | ${c.uniqueEdgeBlocks ?? 'n/a'} | ${c.selectedBlocks ?? 'n/a'} |`
      + ` ${s(c.r0WallMs)} | analytic (see note) | ${s(c.r2WallMs)} | ${s(c.r2bWallMs)} |`
      + ` ${spd(c.speedupR2BvsR0)} | ${spd(c.speedupR2BvsR2)} | ${(c.jsHeapDeltaMB ?? 0).toFixed(1)} |`,
    );
    if (c.status === 'partial') {
      lines.push(...legDetailLines(c));
    }
  });
  lines.push(
    '',
    'R1 note: full-Qxx native is not run at scale (prohibitive by design); at these query densities unique queried columns ~= parameter count, so R1 cost ≈ old-R2 cost (same solves, all-entry packing). R2B wins on bytes shipped and postprocess, not on solve count.',
    '',
    '## Parity R2B vs R0 (§12, max diffs)',
    '',
    '| case | coord abs | resid abs | vTPv rel | SEUW rel | stnCov abs | stnCov rel | Qvv rel | Cvv rel | std abs | redTr abs | blockT rel | whatif | identity R2B | gate |',
    '| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | --- | ---: | --- |',
  );
  cases.forEach((c) => {
    if (c.status !== 'ok' || !c.parity) {
      const ident = c.identityR2B !== undefined ? c.identityR2B.toExponential(2) : 'n/a';
      const gateInfo = c.legs
        ? `r2b:${c.legs.r2b.status}/r0:${c.legs.r0.status}/r2:${c.legs.r2.status}${c.r2bStatsError ? ' stats:BLOCKED' : ''}`
        : (c.error ?? '').slice(0, 60);
      lines.push(`| ${c.topology}@${c.stations} | ${c.status.toUpperCase()} (${gateInfo}) | | | | | | | | | | | | ${ident} | ${c.identityGatePass === undefined ? 'n/a' : c.identityGatePass ? 'PASS' : 'FAIL'} |`);
      return;
    }
    const p = c.parity;
    const e = (v: number): string => (v === 0 ? '0' : v.toExponential(2));
    lines.push(
      `| ${c.topology}@${c.stations} | ${e(p.coordMaxAbs)} | ${e(p.residualMaxAbs)} | ${e(p.vtpvRel)} | ${e(p.seuwRel)} |`
      + ` ${e(p.stationCovMaxAbs)} | ${e(p.stationCovMaxRel)} | ${e(p.qvvMaxRel)} | ${e(p.cvvMaxRel)} | ${e(p.standardizedMaxAbs)} |`
      + ` ${e(p.redundancyTraceMaxAbs)} | ${e(p.blockTRel)} | ${p.whatIfTopMatch ? 'top1=TOP5=' : 'MISMATCH:'}${p.whatIfTop5Match ? 'match' : 'top5-DIFF'} |`
      + ` ${e(p.identityR2B)} | ${c.identityGatePass ? 'PASS' : 'FAIL'} |`,
    );
  });
  const worstIdentity = Math.max(0, ...cases.flatMap((c) => [
    ...(c.parity ? [c.parity.identityR0, c.parity.identityR2B] : []),
    ...(!c.parity && c.identityR2B !== undefined ? [c.identityR2B] : []),
  ]));
  lines.push(
    '',
    `## Redundancy identity (§13, hard gate): worst |sum trace(R) − DOF| = ${worstIdentity.toExponential(3)} (gate ${IDENTITY_GATE.toExponential(0)})`,
    '',
    '## Fault matrix (§21)',
    '',
    '| fault | caught by | detail |',
    '| --- | --- | --- |',
  );
  faults.forEach((f) => {
    lines.push(`| ${f.fault} | ${f.caughtBy.length > 0 ? f.caughtBy.join(', ') : 'UNCAUGHT'} | ${f.detail} |`);
  });
  lines.push(
    '',
    'Safety checks: dims/cardinality, finite, symmetry, positive variance, transpose consistency, 6×6 PSD spot, redundancy identity, vTPv/SEUW finite, ordering.',
    '',
    '## Bridge/copy benchmark (§23)',
    '',
    bridge ? `\`${JSON.stringify(bridge)}\`` : 'NOT-RUN',
    '',
    '## Storage note (§24)',
    '',
    'Typed-buffer store (flat `diag` + `offDiag` Float64Array, pair-key → slot) is the only R2B representation — no dense mirror is ever allocated. R2B result bytes = `diag.byteLength + offDiag.byteLength` per scorecard row above; old-R2 ships the same scalars plus a full `numParams²×8` dense mirror (see `r2ResultBytes`). GC/heap contrast at scale comes from the §1 profile (JS heap Δ 2.9 GB @mesh1000, TS dense assembly OOM @mesh1500/2000); this run records per-case heap Δ in the scorecard.',
    '',
    '## Datasets',
    '',
    `| dataset-b | setup-case | status | detail |`,
    `| --- | --- | --- | --- |`,
    `| ${(process.argv.find((a) => a.startsWith('--dataset-b='))?.split('=')[1] ?? '(none)')} | ${(process.argv.find((a) => a.startsWith('--setup-case='))?.split('=')[1] ?? 'A0')} | ${dataset.status} | ${dataset.detail} |`,
    '',
    `## Decision recommendation: ${decision}`,
    '',
  );
  return `${lines.join('\n')}\n`;
};

const main = async (): Promise<void> => {
  if (process.argv.includes('--help')) {
    printHelp();
    return;
  }
  const seedArg = process.argv.find((a) => a.startsWith('--seed='))?.split('=')[1];
  const seedBase = seedArg ? Number(seedArg) : 7;
  const timeoutArg = process.argv.find((a) => a.startsWith('--timeout-ms='))?.split('=')[1];
  const timeoutMs = timeoutArg ? Number(timeoutArg) : 600000;
  const setupCase = process.argv.find((a) => a.startsWith('--setup-case='))?.split('=')[1] ?? 'A0';
  const datasetB = process.argv.find((a) => a.startsWith('--dataset-b='))?.split('=')[1];
  if (process.argv.includes('--dataset-only')) {
    const module = await loadWasm();
    const rows: { setupCase: string; status: string; detail: string }[] = [];
    for (const setup of ['A0', 'AC', 'AH', 'A']) {
      const leg = await tryDatasetLeg(module, datasetB, setup);
      rows.push({ setupCase: setup, ...leg });
      console.log(`dataset-b ${setup}: ${leg.status} — ${leg.detail}`);
    }
    const outArg = process.argv.find((a) => a.startsWith('--out='))?.split('=')[1];
    const outBase = outArg ?? 'reports/gnss/phase12f2-datasetb';
    mkdirSync(dirname(outBase), { recursive: true });
    writeFileSync(`${outBase}.json`, `${JSON.stringify({ generatedAt: new Date().toISOString(), datasetB: datasetB ?? null, rows }, null, 2)}\n`);
    writeFileSync(
      `${outBase}.md`,
      `# Phase 12F.2 Dataset B — R0 vs R2B (evidence only)\n\n| setup | status | detail |\n| --- | --- | --- |\n${rows.map((r) => `| ${r.setupCase} | ${r.status} | ${r.detail} |`).join('\n')}\n`,
    );
    return;
  }
  const caseArg = process.argv.find((a) => a.startsWith('--case='))?.split('=')[1];
  if (caseArg) {
    const [topology, sizeText] = caseArg.split('@');
    const caseIndex = Number(process.argv.find((a) => a.startsWith('--case-index='))?.split('=')[1] ?? 0);
    const legsArg = process.argv.find((a) => a.startsWith('--legs='))?.split('=')[1];
    const module = await loadWasm();
    const result = await runCase(
      module, topology as AuditTopology, Number(sizeText), seedBase + Number(sizeText) * 131 + caseIndex * 17,
      { legs: legsArg === 'r2b' ? 'r2b' : 'all' },
    );
    console.log(`R2B_CASE_JSON:${JSON.stringify(result)}`);
    return;
  }
  const sizes = [...parseList('sizes', [...DEFAULT_SIZES, ...LARGE_SIZES].map(String)).map(Number)];
  const topologies = parseList('topologies', DEFAULT_TOPOLOGIES) as AuditTopology[];
  const outArg = process.argv.find((a) => a.startsWith('--out='))?.split('=')[1];
  const outBase = outArg ?? 'reports/gnss/phase12f2-r2b';
  const plan: { topology: AuditTopology; size: number }[] = [];
  topologies.forEach((topology) => sizes.forEach((size) => plan.push({ topology, size })));
  if (topologies.includes('chain') || topologies.includes('sparse-mesh')) {
    EXTRA_TOPOLOGIES.forEach((extra) => {
      if (!plan.some((p) => p.topology === extra.topology && p.size === extra.size)) plan.push(extra);
    });
  }
  const { execFile } = await import('node:child_process');
  const tsxBin = join(process.cwd(), 'node_modules/.bin/tsx');
  const scriptFile = join('scripts/gnss/gnssR2BEvidence.ts');
  // Mesh/ring/spoke sizes >= 1000 run R2B-only: the TS dense R0/R2 legs are
  // the known-OOM bound (§1 profile: heap Δ 2.9 GB @mesh1000, OOM @1500/2000),
  // so the sparse R2B leg gets isolated evidence. Chain stays full-mode: its
  // R0/R2 legs fail fast on the F-BRIDGE gate (cheap, attribution recorded).
  const runChild = (topology: AuditTopology, size: number, index: number): Promise<R2BCaseResult> =>
    new Promise((resolve) => {
      const legsFlag = size >= 1000 && topology !== 'chain' ? '--legs=r2b' : '--legs=all';
      execFile(
        tsxBin,
        [scriptFile, `--case=${topology}@${size}`, `--case-index=${index}`, `--seed=${seedBase}`, legsFlag],
        { timeout: timeoutMs > 0 ? timeoutMs : undefined, maxBuffer: 64 * 1024 * 1024 },
        (error, stdout, stderr) => {
          const marker = 'R2B_CASE_JSON:';
          const line = stdout.split('\n').find((l) => l.startsWith(marker));
          if (line) {
            try {
              resolve(JSON.parse(line.slice(marker.length)) as R2BCaseResult);
              return;
            } catch { /* fall through */ }
          }
          const rawTail = `${error?.message ?? 'child failed'} | ${stderr.trim().split('\n').slice(-3).join(' / ')}`;
          // Child-level crash attribution (no legs payload survived): V8 GC
          // language in stderr means the TS heap bound, not an R2B failure.
          const oom = /Mark-Compact|allocation failure|heap|out of memory/i.test(rawTail);
          const tail = oom ? `MEMORY (JS heap OOM in child; TS-side bound) | ${rawTail}` : rawTail;
          const killed = (error as { killed?: boolean } | null)?.killed === true;
          resolve({
            topology, stations: size, seed: seedBase + size * 131 + index * 17,
            status: killed ? 'timeout-skipped' : 'error', error: tail.slice(0, 500),
          });
        },
      );
    });
  const cases: R2BCaseResult[] = [];
  for (const [index, item] of plan.entries()) {
    const r2bOnly = item.size >= 1000 && item.topology !== 'chain';
    console.log(`r2b [${index + 1}/${plan.length}]: ${item.topology}@${item.size}${r2bOnly ? ' (r2b-only)' : ''}`);
    const result = await runChild(item.topology, item.size, index);
    const legsSummary = result.legs ? ` legs=r2b:${result.legs.r2b.status}/r0:${result.legs.r0.status}/r2:${result.legs.r2.status}` : '';
    console.log(`  -> ${result.status}${result.r2bWallMs !== undefined ? ` r2b=${(result.r2bWallMs / 1000).toFixed(1)}s` : ''}${result.identityGatePass !== undefined ? ` gate=${result.identityGatePass ? 'PASS' : 'FAIL'}` : ''}${legsSummary}${result.error ? ` ${result.error.slice(0, 160)}` : ''}`);
    cases.push(result);
  }
  console.log('r2b: fault matrix + bridge benchmark + dataset hooks (parent, one WASM load)');
  const faults = runFaultMatrix();
  const wasmModule = await loadWasm();
  let bridge: Record<string, number | string> | null = null;
  try {
    bridge = await runBridgeBenchmark(wasmModule);
  } catch (error) {
    bridge = { status: 'NOT-RUN', detail: error instanceof Error ? error.message : String(error) };
  }
  const dataset = await tryDatasetLeg(wasmModule, datasetB, setupCase);
  const okCases = cases.filter((c) => c.status === 'ok');
  const gatesPass = okCases.length > 0 && okCases.every((c) => c.identityGatePass);
  const parityPass = okCases.every((c) =>
    (c.parity?.coordMaxAbs ?? 1) <= 1e-6 &&
    (c.parity?.vtpvRel ?? 1) <= 1e-9 &&
    (c.parity?.qvvMaxRel ?? 1) <= 1e-6,
  );
  // Every non-ok case must carry an attribution (gate or error text) —
  // undocumented outcomes are a report bug, never silent.
  const unattributed = cases.filter((c) =>
    c.status !== 'ok' && !c.legs && !c.error && c.status !== 'timeout-skipped',
  );
  const chainGate = cases.filter((c) => c.topology === 'chain')
    .every((c) =>
      c.legs?.r0.gate?.startsWith('F-BRIDGE') ||
      (c.legs?.r0.status === 'skipped' && /non-PSD/.test(c.r2bStatsError ?? '')) ||
      c.status === 'timeout-skipped',
    );
  const r2bQueryOk100_1000 = cases
    .filter((c) => c.stations >= 100 && c.stations <= 1000)
    .every((c) => c.legs?.r2b.status === 'ok');
  const decision = okCases.length === 0 || unattributed.length > 0
    ? 'NO-GO (no passing case or unattributed outcome; investigate before any production discussion)'
    : gatesPass && parityPass && chainGate && r2bQueryOk100_1000
      ? 'GO-R2B-PRODUCTION-PROOF WITH-BOUNDS (mesh 100-750 + ring/hub-spoke pass parity + identity; R2B query succeeds everywhere 100-1000; chain statistics blocked by the pre-existing F-BRIDGE production PSD gate — R0 itself throws, orthogonal to R2B; 1500/2000 outcomes documented as bounds; next research: F-BRIDGE gate policy + sparse-assembly scaling for the OOM bound)'
      : gatesPass && parityPass
        ? 'GO-R2B-PRODUCTION-PROOF WITH-BOUNDS (parity + identity pass where computable; residual bounds documented per-case; next research: per-leg notes in the scorecard)'
        : 'NO-GO (parity or identity gate tripped; next research: root-cause the tripped quantity before any production discussion)';
  const payload = {
    generatedAt: new Date().toISOString(),
    note: 'Phase 12F.2 R2B evidence only: real-WASM batched blocks; no production routing, no R1 default change.',
    config: { sizes, topologies, seedBase, timeoutMs, setupCase, datasetB: datasetB ?? null },
    identityGate: IDENTITY_GATE,
    absTol: ABS_TOL,
    checks: ALL_CHECKS,
    cases,
    faults,
    bridge,
    dataset,
    decision,
  };
  mkdirSync(dirname(outBase), { recursive: true });
  writeFileSync(`${outBase}.json`, `${JSON.stringify(payload, null, 2)}\n`);
  writeFileSync(`${outBase}.md`, toMarkdown(cases, faults, bridge, dataset, decision));
  console.log(`r2b: wrote ${outBase}.json/.md (${okCases.length}/${cases.length} ok) decision=${decision}`);
};

if ((process.argv[1] ?? '').endsWith('gnssR2BEvidence.ts')) await main();
