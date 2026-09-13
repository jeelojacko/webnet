/**
 * Phase 12F.0 — static GNSS native/WASM architecture & performance audit.
 *
 * EVIDENCE-ONLY shared harness (never imported by production code):
 * deterministic synthetic corpus generators with realistic ECEF geometry,
 * R0 TS-dense oracle runners (plain + stage-timed replica), R1/R2 native
 * runners (smallest reuse of existing APIs: WASM sparse correction solver
 * injected into solveAdjustmentIteration + WASM selected-covariance for
 * Qxx), TS statistics reconstruction, parity comparators, and local-intake
 * Dataset A/B loaders (read-only; vendor files never committed).
 *
 * Routing/math/tolerance/GVX/UI contract: untouched. The TS oracle stays
 * authoritative; RINEX is out of scope.
 */
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { assembleAdjustmentEquations } from '../../src/engine/adjustmentEquationAssembly';
import {
  applyAdjustmentCorrections,
  solveAdjustmentIteration,
} from '../../src/engine/adjustmentIteration';
import { buildSolveParameterIndex } from '../../src/engine/adjustmentPreprocessing';
import {
  invertNormalMatrixForStats,
  solveNormalEquations,
} from '../../src/engine/adjustNormalEquationHelpers';
import {
  accumulateNormalEquationsFromSparseRows,
  type SparseMatrixRows,
} from '../../src/engine/matrix';
import {
  runGnssBaselineAdjustment,
  type GnssBaselineAdjustInput,
  type GnssBaselineAdjustResult,
} from '../../src/engine/gnssBaselineAdjust';
import {
  gnssBaselineQuadraticForm,
  invertGnssBaselineCovariance,
} from '../../src/engine/gnssBaselineCovariance';
import { gnssBaselineLabel } from '../../src/engine/gnssBaselineEquationRows';
import { runGnssBaselinePreflight } from '../../src/engine/gnssBaselinePreflight';
import {
  recoverGnssBaselineStatistics,
  type GnssBaselineStatistics,
} from '../../src/engine/gnssBaselineStatistics';
import {
  applyGnssSetupUncertainty,
  type GnssSetupUncertainty,
} from '../../src/engine/gnssBaselineSetupUncertainty';
import type { GnssBaselineObservation } from '../../src/engine/gnssBaselineTypes';
import {
  parseGvx,
} from '../../src/engine/gnssGvxImport';
import { parseGvxSyntax } from '../../src/engine/gnssGvxSyntax';
import {
  packSparseDesignRows,
  packUpperTriangleWeights,
} from '../../src/engine/sparseEquationPacking';
import type {
  SparseCorrectionSolver,
  SparseSelectedCovarianceSolver,
} from '../../src/engine/numericalBackend';
import {
  groupMarksByName,
} from './tbcParityModel';
import type { StationMap } from '../../src/types';
import type { SolveParameterIndex } from '../../src/engine/adjustmentSolveTypes';

import type { AuditNetwork } from './gnssNativeAuditCorpus';

export {
  AUDIT_TOPOLOGIES,
  type AuditNetwork,
  type AuditTopology,
  BRIDGE_TOPOLOGIES,
  BRIDGELESS_TOPOLOGIES,
  generateAuditNetwork,
  latLonToEcef,
  mulberry32,
  randomSpdCovariance,
  topologyEdges,
} from './gnssNativeAuditCorpus';

// R0 oracle (production) + stage-timed replica (fidelity-gated).
// ---------------------------------------------------------------------------

export interface StageTimings {
  preprocessMs: number;
  solveLoopMs: number;
  finalAssemblyMs: number;
  normalAccumMs: number;
  qxxInvertMs: number;
  statisticsMs: number;
  totalMs: number;
}

export interface TimedOracle {
  readonly result: GnssBaselineAdjustResult;
  readonly stages: StageTimings;
  /** Max |coord| vs production runGnssBaselineAdjustment (replica gate). */
  readonly replicaMaxCoordDiff: number;
  readonly replicaMaxQxxDiff: number;
}

export const gnssAssemblyContext = (stations: StationMap, paramIndex: SolveParameterIndex) => ({
  stations,
  paramIndex,
  is2D: false,
  debug: false,
  directionOrientations: {},
  dirParamMap: {},
  effectiveStdDev: (): never => {
    throw new Error('GNSS audit reached unexpected helper effectiveStdDev.');
  },
  correctedDistanceModel: (): never => {
    throw new Error('GNSS audit reached unexpected helper correctedDistanceModel.');
  },
  getObservedHorizontalDistanceIn2D: (): never => {
    throw new Error('GNSS audit reached unexpected helper getObservedHorizontalDistanceIn2D.');
  },
  getAzimuth: (): never => {
    throw new Error('GNSS audit reached unexpected helper getAzimuth.');
  },
  measuredAngleCorrection: (): never => {
    throw new Error('GNSS audit reached unexpected helper measuredAngleCorrection.');
  },
  modeledAzimuth: (): never => {
    throw new Error('GNSS audit reached unexpected helper modeledAzimuth.');
  },
  wrapToPi: (): never => {
    throw new Error('GNSS audit reached unexpected helper wrapToPi.');
  },
  gpsObservedVector: (): never => {
    throw new Error('GNSS audit reached unexpected helper gpsObservedVector.');
  },
  gpsModeledVector: (): never => {
    throw new Error('GNSS audit reached unexpected helper gpsModeledVector.');
  },
  gpsModeledVectorDerivatives: (): never => {
    throw new Error('GNSS audit reached unexpected helper gpsModeledVectorDerivatives.');
  },
  gpsWeight: (): never => {
    throw new Error('GNSS audit reached unexpected helper gpsWeight.');
  },
  getModeledZenith: (): never => {
    throw new Error('GNSS audit reached unexpected helper getModeledZenith.');
  },
  curvatureRefractionAngle: (): never => {
    throw new Error('GNSS audit reached unexpected helper curvatureRefractionAngle.');
  },
  applyTsCorrelationToWeightMatrix: (): void => {},
  logObsDebug: undefined,
});

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
  let colMax = 0;
  for (let i = 0; i < N.length; i += 1) {
    let rsum = 0;
    let csum = 0;
    for (let j = 0; j < N.length; j += 1) {
      rsum += Math.abs(N[i]?.[j] ?? 0);
      csum += Math.abs(N[j]?.[i] ?? 0);
    }
    rowMax = Math.max(rowMax, rsum);
    colMax = Math.max(colMax, csum);
  }
  return rowMax * colMax;
};

/**
 * Stage-timed replica of runGnssBaselineAdjustment's pipeline with an
 * injectable sparse correction solver (undefined = TS dense, identical to
 * production). Fidelity vs production is gated numerically by callers.
 */
export const runTimedGnssLoop = (
  input: GnssBaselineAdjustInput,
  sparseCorrectionSolver?: SparseCorrectionSolver,
  options?: { skipFidelity?: boolean },
): TimedOracle => {
  const total0 = performance.now();
  const stations: StationMap = Object.fromEntries(
    Object.entries(input.stations).map(([id, s]) => [id, { ...s }]),
  );
  const baselines = [...input.baselines].sort((a, b) => a.id - b.id);
  const setupApplied = applyGnssSetupUncertainty({
    stations,
    baselines,
    setup: input.setupUncertainty,
    ellipsoid: input.ellipsoid,
  });
  const effectiveBaselines = setupApplied.baselines;
  const preflight = runGnssBaselinePreflight({
    stations,
    baselines: effectiveBaselines,
    referenceFrame: input.referenceFrame,
    epoch: input.epoch,
    ellipsoid: input.ellipsoid,
  });
  const unknowns = preflight.components
    .flat()
    .filter((stationIdValue) => {
      const station = stations[stationIdValue];
      return !!station && !(station.fixedX && station.fixedY && station.fixedH);
    })
    .sort();
  const { paramIndex, stationParamCount } = buildSolveParameterIndex(stations, unknowns, false);
  const numParams = stationParamCount;
  const numObsEquations = preflight.equationCount;
  const dof = numObsEquations - numParams;
  if (dof < 0) throw new Error('Audit network is under-determined.');
  const preprocessMs = performance.now() - total0;
  const assemblyObservations = effectiveBaselines as unknown[] as Parameters<typeof assembleAdjustmentEquations>[1];
  const maxIterations = input.maxIterations ?? 10;
  const convergenceThresholdM = input.convergenceThresholdM ?? 1e-9;
  const solve0 = performance.now();
  let iterations = 0;
  let converged = false;
  let maxCorrectionM = Number.POSITIVE_INFINITY;
  let lastSparseRows: SparseMatrixRows = [];
  for (let iteration = 1; iteration <= maxIterations; iteration += 1) {
    iterations = iteration;
    const assembled = assembleAdjustmentEquations(
      gnssAssemblyContext(stations, paramIndex) as Parameters<typeof assembleAdjustmentEquations>[0],
      assemblyObservations,
      [],
      numObsEquations,
      numParams,
      iteration,
    );
    lastSparseRows = assembled.sparseRows;
    const computed = solveAdjustmentIteration(
      {
        robustMode: 'none',
        sparseCorrectionSolver,
        experimentalSparseDiagnostics: undefined,
        solveNormalEquations: (N, U, options) =>
          solveNormalEquations(N, U, { log: () => {}, recoverCovariance: options?.recoverCovariance }),
        estimateCondition,
        recordConditionEstimate: () => {},
        captureRobustWeightBase: (): never => {
          throw new Error('GNSS audit reached unexpected robust helper.');
        },
        applyRobustWeightFactors: (): never => {
          throw new Error('GNSS audit reached unexpected robust helper.');
        },
        computeRobustWeightSummary: (): never => {
          throw new Error('GNSS audit reached unexpected robust helper.');
        },
        maxRobustWeightDelta: (): never => {
          throw new Error('GNSS audit reached unexpected robust helper.');
        },
        recordRobustDiagnostics: (): void => {},
        weightedQuadratic: denseWeightedQuadratic,
      },
      assembled.A ?? [],
      assembled.L,
      assembled.P,
      assembled.rowInfo,
      iteration,
      { sparseRows: assembled.sparseRows, numParams },
    );
    maxCorrectionM = applyAdjustmentCorrections(stations, paramIndex, false, {}, {}, computed.correction);
    if (maxCorrectionM < convergenceThresholdM) {
      converged = true;
      break;
    }
  }
  const solveLoopMs = performance.now() - solve0;
  const fa0 = performance.now();
  const finalAssembly = assembleAdjustmentEquations(
    gnssAssemblyContext(stations, paramIndex) as Parameters<typeof assembleAdjustmentEquations>[0],
    assemblyObservations,
    [],
    numObsEquations,
    numParams,
    iterations + 1,
  );
  const finalAssemblyMs = performance.now() - fa0;
  const finalP = finalAssembly.P ?? [];
  const residuals = effectiveBaselines.map((baseline) => {
    const rows: number[] = [];
    finalAssembly.rowInfo.forEach((info, row) => {
      const obs = (info as { obs?: { id?: number } })?.obs;
      if (obs?.id === baseline.id) rows.push(row);
    });
    rows.sort((a, b) => a - b);
    if (rows.length !== 3) throw new Error(`Audit baseline ${baseline.id} assembled ${rows.length} rows.`);
    const vX = finalAssembly.L[rows[0]!]![0]!;
    const vY = finalAssembly.L[rows[1]!]![0]!;
    const vZ = finalAssembly.L[rows[2]!]![0]!;
    const inverse = invertGnssBaselineCovariance(baseline.covariance, gnssBaselineLabel(baseline));
    return {
      baselineId: baseline.id,
      from: baseline.from,
      to: baseline.to,
      vX, vY, vZ,
      magnitude: Math.sqrt(vX * vX + vY * vY + vZ * vZ),
      quadraticForm: gnssBaselineQuadraticForm(inverse, vX, vY, vZ),
    };
  });
  residuals.sort((a, b) => a.baselineId - b.baselineId);
  const na0 = performance.now();
  const { normal } = accumulateNormalEquationsFromSparseRows(
    finalAssembly.sparseRows, finalAssembly.L, finalP, numParams,
  );
  const normalAccumMs = performance.now() - na0;
  const q0 = performance.now();
  const qxx = invertNormalMatrixForStats(normal, () => {});
  const qxxInvertMs = performance.now() - q0;
  const residualVector: number[][] = residuals.flatMap((r) => [[r.vX], [r.vY], [r.vZ]]);
  const weightedResidualSum = denseWeightedQuadratic(finalP, residualVector);
  const varianceFactor = dof > 0 ? weightedResidualSum / dof : 0;
  const s0 = performance.now();
  const statistics = recoverGnssBaselineStatistics({
    baselines: effectiveBaselines,
    residuals,
    paramIndex,
    qxx,
    seuw: Math.sqrt(Math.max(varianceFactor, 0)),
  });
  const statisticsMs = performance.now() - s0;
  const production = options?.skipFidelity ? null : runGnssBaselineAdjustment(input);
  let replicaMaxCoordDiff = 0;
  unknowns.forEach((id) => {
    const a = stations[id]!;
    const b = (production?.stations[id] ?? a)!;
    replicaMaxCoordDiff = Math.max(
      replicaMaxCoordDiff,
      Math.abs(a.x - b.x), Math.abs(a.y - b.y), Math.abs(a.h - b.h),
    );
  });
  let replicaMaxQxxDiff = 0;
  qxx.forEach((row, i) => row.forEach((value, j) => {
    replicaMaxQxxDiff = Math.max(replicaMaxQxxDiff, Math.abs(value - ((production?.qxx[i]?.[j] ?? value) ?? 0)));
  }));
  void lastSparseRows;
  const result: GnssBaselineAdjustResult = {
    adjustmentFrame: 'ecef',
    routeProvenance: 'typescript-dense',
    stations,
    unknowns,
    numParams,
    numObsEquations,
    logicalObservations: effectiveBaselines.length,
    dof,
    iterations,
    converged,
    maxCorrectionM,
    residuals,
    weightedResidualSum,
    varianceFactor,
    qxx,
    logs: [],
    statistics,
    ...(setupApplied.setupModel
      ? { setupModel: setupApplied.setupModel, setupContributions: setupApplied.contributions }
      : {}),
  };
  return {
    result,
    stages: {
      preprocessMs, solveLoopMs, finalAssemblyMs, normalAccumMs,
      qxxInvertMs, statisticsMs, totalMs: performance.now() - total0,
    },
    replicaMaxCoordDiff,
    replicaMaxQxxDiff,
  };
};

// ---------------------------------------------------------------------------
// Native R1 (full Qxx) / R2 (selected per-edge blocks) runners.
// ---------------------------------------------------------------------------

export interface NativeTimings {
  bridgeCopyMs: number;
  factorMs?: number;
  solveCovMs?: number;
  nativeAssemblyMs?: number;
  queryWallMs: number;
  totalMs: number;
  normalNnz?: number;
  factorNnz?: number;
}

/** Per-edge station-block queries: Q_AA, Q_AB, Q_BB (Q_BA = transpose). */
export const selectedBlockQueries = (
  paramIndex: SolveParameterIndex,
  baselines: GnssBaselineObservation[],
  numParams: number,
): { rows: Int32Array; columns: Int32Array; edgeSpans: { baselineId: number; start: number; count: number }[] } => {
  const rows: number[] = [];
  const columns: number[] = [];
  const edgeSpans: { baselineId: number; start: number; count: number }[] = [];
  const keys = ['x', 'y', 'h'] as const;
  baselines.forEach((baseline) => {
    const start = rows.length;
    const fromCols = keys.map((k) => paramIndex[baseline.from]?.[k]);
    const toCols = keys.map((k) => paramIndex[baseline.to]?.[k]);
    // Q_AA (upper triangle incl. diagonal: 6), Q_BB (6), Q_AB full (9).
    const push = (r: number | undefined, c: number | undefined): void => {
      if (r == null || c == null) return;
      if (r < 0 || c < 0 || r >= numParams || c >= numParams) {
        throw new Error(`Audit selected query outside parameter range (${r},${c}).`);
      }
      rows.push(r);
      columns.push(c);
    };
    for (let a = 0; a < 3; a += 1) {
      for (let b = a; b < 3; b += 1) {
        push(fromCols[a], fromCols[b]);
        push(toCols[a], toCols[b]);
      }
    }
    for (let a = 0; a < 3; a += 1) {
      for (let b = 0; b < 3; b += 1) push(fromCols[a], toCols[b]);
    }
    edgeSpans.push({ baselineId: baseline.id, start, count: rows.length - start });
  });
  return { rows: Int32Array.from(rows), columns: Int32Array.from(columns), edgeSpans };
};

export interface NativeRouteResult {
  /** Evidence-accurate route tag (never a production route tag). */
  readonly route: 'evidence-native-r1' | 'evidence-native-r2';
  /** Stations/corrections/residuals/vTPv/SEUW reconstructed in TS. */
  readonly result: GnssBaselineAdjustResult;
  /** Full dense Qxx (R1) or block-sparse Qxx (R2: selected entries only). */
  readonly qxx: number[][];
  /** Exact queried (row, column) positions (upper-triangle + Q_AB blocks). */
  readonly queryRows: Int32Array;
  readonly queryColumns: Int32Array;
  /** True when every selected query round-tripped (R2 completeness). */
  readonly selectedCoverage: number;
  readonly timings: NativeTimings;
}

/**
 * R1/R2 shared core: TS setup+preflight+assembly, native sparse correction
 * solve per iteration, native selected-covariance for Qxx (all-entry for
 * R1, per-edge blocks for R2), TS residual/statistics reconstruction.
 */
export const runNativeGnssRoute = (
  input: GnssBaselineAdjustInput,
  solvers: { correction: SparseCorrectionSolver; selected: SparseSelectedCovarianceSolver },
  mode: 'r1-full' | 'r2-selected',
): NativeRouteResult => {
  const total0 = performance.now();
  const stations: StationMap = Object.fromEntries(
    Object.entries(input.stations).map(([id, s]) => [id, { ...s }]),
  );
  const baselines = [...input.baselines].sort((a, b) => a.id - b.id);
  const setupApplied = applyGnssSetupUncertainty({
    stations, baselines, setup: input.setupUncertainty, ellipsoid: input.ellipsoid,
  });
  const effectiveBaselines = setupApplied.baselines;
  const preflight = runGnssBaselinePreflight({
    stations,
    baselines: effectiveBaselines,
    referenceFrame: input.referenceFrame,
    epoch: input.epoch,
    ellipsoid: input.ellipsoid,
  });
  const unknowns = preflight.components
    .flat()
    .filter((stationIdValue) => {
      const station = stations[stationIdValue];
      return !!station && !(station.fixedX && station.fixedY && station.fixedH);
    })
    .sort();
  const { paramIndex, stationParamCount } = buildSolveParameterIndex(stations, unknowns, false);
  const numParams = stationParamCount;
  const numObsEquations = preflight.equationCount;
  const dof = numObsEquations - numParams;
  if (dof < 0) throw new Error('Audit network is under-determined.');
  const assemblyObservations = effectiveBaselines as unknown[] as Parameters<typeof assembleAdjustmentEquations>[1];
  const maxIterations = input.maxIterations ?? 10;
  const convergenceThresholdM = input.convergenceThresholdM ?? 1e-9;
  let iterations = 0;
  let converged = false;
  let maxCorrectionM = Number.POSITIVE_INFINITY;
  let finalAssembly!: ReturnType<typeof assembleAdjustmentEquations>;
  for (let iteration = 1; iteration <= maxIterations; iteration += 1) {
    iterations = iteration;
    const assembled = assembleAdjustmentEquations(
      gnssAssemblyContext(stations, paramIndex) as Parameters<typeof assembleAdjustmentEquations>[0],
      assemblyObservations,
      [],
      numObsEquations,
      numParams,
      iteration,
    );
    const computed = solveAdjustmentIteration(
      {
        robustMode: 'none',
        sparseCorrectionSolver: solvers.correction,
        experimentalSparseDiagnostics: undefined,
        solveNormalEquations: (N, U, options) =>
          solveNormalEquations(N, U, { log: () => {}, recoverCovariance: options?.recoverCovariance }),
        estimateCondition,
        recordConditionEstimate: () => {},
        captureRobustWeightBase: (): never => {
          throw new Error('GNSS audit reached unexpected robust helper.');
        },
        applyRobustWeightFactors: (): never => {
          throw new Error('GNSS audit reached unexpected robust helper.');
        },
        computeRobustWeightSummary: (): never => {
          throw new Error('GNSS audit reached unexpected robust helper.');
        },
        maxRobustWeightDelta: (): never => {
          throw new Error('GNSS audit reached unexpected robust helper.');
        },
        recordRobustDiagnostics: (): void => {},
        weightedQuadratic: denseWeightedQuadratic,
      },
      assembled.A ?? [],
      assembled.L,
      assembled.P,
      assembled.rowInfo,
      iteration,
      { sparseRows: assembled.sparseRows, numParams },
    );
    maxCorrectionM = applyAdjustmentCorrections(stations, paramIndex, false, {}, {}, computed.correction);
    if (iteration === maxIterations || maxCorrectionM < convergenceThresholdM) {
      finalAssembly = assembleAdjustmentEquations(
        gnssAssemblyContext(stations, paramIndex) as Parameters<typeof assembleAdjustmentEquations>[0],
        assemblyObservations,
        [],
        numObsEquations,
        numParams,
        iteration + 1,
      );
    }
    if (maxCorrectionM < convergenceThresholdM) {
      converged = true;
      break;
    }
  }
  if (!finalAssembly) throw new Error('Audit native route produced no final assembly.');
  const finalP = finalAssembly.P ?? [];
  // Bridge copy (representative pack cost) + native covariance queries.
  const bc0 = performance.now();
  const packedDesign = packSparseDesignRows(finalAssembly.sparseRows);
  const packedWeights = packUpperTriangleWeights(finalP, finalAssembly.L.length);
  let queryRows: Int32Array;
  let queryColumns: Int32Array;
  if (mode === 'r1-full') {
    const qr: number[] = [];
    const qc: number[] = [];
    for (let r = 0; r < numParams; r += 1) {
      for (let c = r; c < numParams; c += 1) {
        qr.push(r);
        qc.push(c);
      }
    }
    queryRows = Int32Array.from(qr);
    queryColumns = Int32Array.from(qc);
  } else {
    const blocks = selectedBlockQueries(paramIndex, effectiveBaselines, numParams);
    queryRows = blocks.rows;
    queryColumns = blocks.columns;
  }
  const bridgeCopyMs = performance.now() - bc0;
  const q0 = performance.now();
  const selected = solvers.selected.querySelected({
    design: packedDesign,
    weights: packedWeights,
    observationEquationCount: finalAssembly.L.length,
    parameterCount: numParams,
    queryRows,
    queryColumns,
  });
  const queryWallMs = performance.now() - q0;
  const qxx: number[][] = Array.from({ length: numParams }, () => new Array<number>(numParams).fill(0));
  for (let k = 0; k < queryRows.length; k += 1) {
    const r = queryRows[k]!;
    const c = queryColumns[k]!;
    const value = selected.covariance[k]!;
    if (!Number.isFinite(value)) throw new Error(`Audit native route returned non-finite Qxx at (${r},${c}).`);
    qxx[r]![c] = value;
    qxx[c]![r] = value;
  }
  const selectedCoverage = queryRows.length;
  const residuals = effectiveBaselines.map((baseline) => {
    const rows: number[] = [];
    finalAssembly.rowInfo.forEach((info, row) => {
      const obs = (info as { obs?: { id?: number } })?.obs;
      if (obs?.id === baseline.id) rows.push(row);
    });
    rows.sort((a, b) => a - b);
    if (rows.length !== 3) {
      throw new Error(`Audit native route baseline ${baseline.id} assembled ${rows.length} rows instead of 3.`);
    }
    const vX = finalAssembly.L[rows[0]!]![0]!;
    const vY = finalAssembly.L[rows[1]!]![0]!;
    const vZ = finalAssembly.L[rows[2]!]![0]!;
    const inverse = invertGnssBaselineCovariance(baseline.covariance, gnssBaselineLabel(baseline));
    return {
      baselineId: baseline.id,
      from: baseline.from,
      to: baseline.to,
      vX, vY, vZ,
      magnitude: Math.sqrt(vX * vX + vY * vY + vZ * vZ),
      quadraticForm: gnssBaselineQuadraticForm(inverse, vX, vY, vZ),
    };
  });
  residuals.sort((a, b) => a.baselineId - b.baselineId);
  const residualVector: number[][] = residuals.flatMap((r) => [[r.vX], [r.vY], [r.vZ]]);
  const weightedResidualSum = denseWeightedQuadratic(finalP, residualVector);
  const varianceFactor = dof > 0 ? weightedResidualSum / dof : 0;
  const statistics = recoverGnssBaselineStatistics({
    baselines: effectiveBaselines,
    residuals,
    paramIndex,
    qxx,
    seuw: Math.sqrt(Math.max(varianceFactor, 0)),
  });
  const result: GnssBaselineAdjustResult = {
    adjustmentFrame: 'ecef',
    routeProvenance: 'typescript-dense',
    stations,
    unknowns,
    numParams,
    numObsEquations,
    logicalObservations: effectiveBaselines.length,
    dof,
    iterations,
    converged,
    maxCorrectionM,
    residuals,
    weightedResidualSum,
    varianceFactor,
    qxx,
    logs: [],
    statistics,
    ...(setupApplied.setupModel
      ? { setupModel: setupApplied.setupModel, setupContributions: setupApplied.contributions }
      : {}),
  };
  return {
    route: mode === 'r1-full' ? 'evidence-native-r1' : 'evidence-native-r2',
    result,
    qxx,
    queryRows,
    queryColumns,
    selectedCoverage,
    timings: {
      bridgeCopyMs,
      factorMs: selected.timings?.factorizeMs,
      solveCovMs: selected.timings?.solveMs,
      nativeAssemblyMs: selected.timings?.assemblyMs,
      queryWallMs,
      totalMs: performance.now() - total0,
      normalNnz: selected.normalNnz,
      factorNnz: selected.factorNnz,
    },
  };
};

// ---------------------------------------------------------------------------
// Parity comparators (§16 contract shape).
// ---------------------------------------------------------------------------

export interface ParityReport {
  maxCoordAbs: number;
  maxCorrectionAbs: number;
  vtpvRel: number;
  seuwRel: number;
  qxxMaxAbs: number;
  qxxMaxRel: number;
  residualMaxAbs: number;
  qvvMaxRel: number;
  cvvMaxRel: number;
  redundancyTraceAbs: number;
  standardizedMaxAbs: number;
  blockTRel: number;
}

const rel = (a: number, b: number): number => {
  const denom = Math.max(Math.abs(a), Math.abs(b));
  if (denom === 0) return 0;
  return Math.abs(a - b) / denom;
};

const blockToArray = (block: { xx: number; xy: number; xz: number; yy: number; yz: number; zz: number }): number[] =>
  [block.xx, block.xy, block.xz, block.yy, block.yz, block.zz];

/** Full §16 parity contract between R0 oracle and an R1/R2 native result. */
export const compareParity = (
  oracle: GnssBaselineAdjustResult,
  candidate: GnssBaselineAdjustResult,
  qxxMode: 'full' | 'selected',
): ParityReport => {
  let maxCoordAbs = 0;
  oracle.unknowns.forEach((id) => {
    const a = oracle.stations[id]!;
    const b = candidate.stations[id]!;
    maxCoordAbs = Math.max(maxCoordAbs, Math.abs(a.x - b.x), Math.abs(a.y - b.y), Math.abs(a.h - b.h));
  });
  const vtpvRel = rel(oracle.weightedResidualSum, candidate.weightedResidualSum);
  const seuwRel = rel(Math.sqrt(Math.max(oracle.varianceFactor, 0)), Math.sqrt(Math.max(candidate.varianceFactor, 0)));
  let qxxMaxAbs = 0;
  let qxxMaxRel = 0;
  if (qxxMode === 'full') {
    if (!('qxx' in oracle) || !('qxx' in candidate)) {
      throw new Error('Parity full-Qxx mode requires dense results (fail-closed).');
    }
    oracle.qxx.forEach((row, i) => row.forEach((value, j) => {
      const other = candidate.qxx[i]?.[j] ?? 0;
      qxxMaxAbs = Math.max(qxxMaxAbs, Math.abs(value - other));
      qxxMaxRel = Math.max(qxxMaxRel, rel(value, other));
    }));
  }
  let residualMaxAbs = 0;
  oracle.residuals.forEach((r, k) => {
    const c = candidate.residuals[k]!;
    residualMaxAbs = Math.max(
      residualMaxAbs,
      Math.abs(r.vX - c.vX), Math.abs(r.vY - c.vY), Math.abs(r.vZ - c.vZ),
    );
  });
  let qvvMaxRel = 0;
  let cvvMaxRel = 0;
  let standardizedMaxAbs = 0;
  let blockTRel = 0;
  oracle.statistics.forEach((s, k) => {
    const c = candidate.statistics[k]!;
    blockToArray(s.qvv).forEach((value, m) => {
      qvvMaxRel = Math.max(qvvMaxRel, rel(value, blockToArray(c.qvv)[m]!));
    });
    blockToArray(s.cvv).forEach((value, m) => {
      cvvMaxRel = Math.max(cvvMaxRel, rel(value, blockToArray(c.cvv)[m]!));
    });
    (['x', 'y', 'z'] as const).forEach((axis) => {
      const a = s.standardized[axis];
      const b = c.standardized[axis];
      if (a != null && b != null) standardizedMaxAbs = Math.max(standardizedMaxAbs, Math.abs(a - b));
    });
    if (s.blockT != null && c.blockT != null) blockTRel = Math.max(blockTRel, rel(s.blockT, c.blockT));
  });
  // Redundancy-trace identity (§17): sum of block traces must equal DOF.
  const traceOf = (stats: GnssBaselineStatistics[]): number =>
    stats.reduce((sum, s) => sum + s.redundancy.trace, 0);
  const redundancyTraceAbs = Math.max(
    Math.abs(traceOf(oracle.statistics) - oracle.dof),
    Math.abs(traceOf(candidate.statistics) - candidate.dof),
  );
  return {
    maxCoordAbs,
    maxCorrectionAbs: maxCoordAbs,
    vtpvRel,
    seuwRel,
    qxxMaxAbs,
    qxxMaxRel,
    residualMaxAbs,
    qvvMaxRel,
    cvvMaxRel,
    redundancyTraceAbs,
    standardizedMaxAbs,
    blockTRel,
  };
};

/** Per-item completeness classification for the Phase-12D output inventory. */
export type CompletenessClass = 'FULL' | 'SELECTED-SUFFICIENT' | 'NO-QXX';

export const COMPLETENESS_INVENTORY: { item: string; verdict: CompletenessClass; reason: string }[] = [
  { item: 'adjusted coordinates', verdict: 'NO-QXX', reason: 'solve output only; identical solve => identical coords' },
  { item: 'corrections/iterations/convergence', verdict: 'NO-QXX', reason: 'iteration outputs; no covariance input' },
  { item: 'residuals v', verdict: 'NO-QXX', reason: 'final-assembly misclosures; no covariance input' },
  { item: 'vTPv/SEUW', verdict: 'NO-QXX', reason: 'v^T P v over block-diagonal P; no Qxx input' },
  { item: 'Qxx station precision', verdict: 'SELECTED-SUFFICIENT', reason: 'diagonal blocks Q_AA per station derivable from per-edge blocks' },
  { item: 'Qvv blocks', verdict: 'SELECTED-SUFFICIENT', reason: 'Qvv_i = C_i - A_i Qxx A_i^T touches only the edge station blocks' },
  { item: 'Cvv blocks', verdict: 'SELECTED-SUFFICIENT', reason: 'seuw^2 scale of Qvv (SEUW needs no Qxx)' },
  { item: 'standardized residuals', verdict: 'SELECTED-SUFFICIENT', reason: 'v/sqrt(Cvv) from Cvv blocks' },
  { item: 'block redundancy + trace=DOF', verdict: 'SELECTED-SUFFICIENT', reason: 'R_i = Qvv_i P_i from Qvv blocks; identity verified numerically' },
  { item: 'block T', verdict: 'SELECTED-SUFFICIENT', reason: 'v^T Cvv^+ v eigen-decomposition of the 3x3 Cvv block' },
  { item: 'loop QC closures', verdict: 'NO-QXX', reason: 'adjusted-coordinate geometry only' },
  { item: 'blunder what-if ranking', verdict: 'SELECTED-SUFFICIENT', reason: 'rankGnssBaselineSuspects sorts blockT only' },
];

// ---------------------------------------------------------------------------
// Local-intake Dataset A/B loaders (read-only; null when intake absent).
// ---------------------------------------------------------------------------

export interface IntakeNetwork {
  readonly stations: StationMap;
  readonly baselines: GnssBaselineObservation[];
  readonly vectors: number;
  readonly fixedName: string;
}

const INTAKE_A = join(process.env['HOME'] ?? '~', 'Downloads/webnet-gnss-12e/tbc-intake/AdjustingtheNetwork');
const INTAKE_B = join(
  process.env['HOME'] ?? '~',
  'Downloads/webnet-gnss-12e/tbc-intake/ProcessingGNSSBaselines/ProcessingGNSSBaselines',
);

const loadIntakeNetwork = (dir: string, fixedName: string): IntakeNetwork | null => {
  if (!existsSync(dir)) return null;
  const gvxFile = readdirSync(dir)
    .filter((f) => f.toLowerCase().endsWith('.gvx'))
    .sort()
    .find((f) => (fixedName === 'P041' ? true : f.toLowerCase().includes('b4adjustment')));
  if (!gvxFile) return null;
  const gvxText = readFileSync(join(dir, gvxFile), 'utf8');
  const parsed = parseGvx(gvxText, gvxFile);
  const syntax = parseGvxSyntax(gvxText, gvxFile);
  if (!parsed.network || !parsed.source || !syntax.document) return null;
  const groups = groupMarksByName(syntax.document.marks);
  if (groups.mismatch) return null;
  const stations: StationMap = {};
  [...groups.groups.values()].forEach((group) => {
    const fixed = group.name === fixedName;
    stations[group.name] = {
      x: group.x, y: group.y, h: group.z,
      fixed, fixedX: fixed, fixedY: fixed, fixedH: fixed,
    };
  });
  const pointToName = new Map<string, string>();
  [...groups.groups.values()].forEach((group) =>
    group.pointIds.forEach((id) => pointToName.set(id, group.name)),
  );
  // 12E.3 convention: intake GVX baselines carry no ellipsoid tag; stamp
  // the orientation provenance (TBC report frame note => WGS84) so setup
  // legs can pass the matching session ellipsoid. Numerically inert for
  // raw (A0/B0) legs.
  const baselines: GnssBaselineObservation[] = parsed.network.baselines.map((b) => ({
    ...b,
    from: pointToName.get(b.from) ?? b.from,
    to: pointToName.get(b.to) ?? b.to,
    ellipsoid: 'WGS84',
  }));
  return { stations, baselines, vectors: baselines.length, fixedName };
};

export const loadDatasetA = (): IntakeNetwork | null => loadIntakeNetwork(INTAKE_A, 'P041');

export const loadDatasetB = (): IntakeNetwork | null => loadIntakeNetwork(INTAKE_B, 'P041');

/** The four stochastic setup cases (§13): A0/AC/AH/A sigma pairs. */
export const SETUP_CASES: { name: string; setup: GnssSetupUncertainty }[] = [
  { name: 'A0', setup: { horizontalCenteringSigma: 0, antennaHeightSigma: 0 } },
  { name: 'AC', setup: { horizontalCenteringSigma: 0.005, antennaHeightSigma: 0 } },
  { name: 'AH', setup: { horizontalCenteringSigma: 0, antennaHeightSigma: 0.002 } },
  { name: 'A', setup: { horizontalCenteringSigma: 0.005, antennaHeightSigma: 0.002 } },
];

/** Expected Dataset-A TS SEUW per setup case (12E.3-pinned oracle values). */
export const EXPECTED_DATASET_A_SEUW: Record<string, number> = {
  A0: 2.100053,
  AC: 1.297104,
  AH: 1.988831,
  A: 1.102511,
};

export const buildGnssAdjustInput = (
  network: AuditNetwork | IntakeNetwork,
  setup?: GnssSetupUncertainty,
  ellipsoid?: string,
): GnssBaselineAdjustInput => ({
  stations: network.stations,
  baselines: network.baselines,
  // No session frame tags: preflight/setup resolve the unanimous
  // baseline values (mirrors the TBC parity evidence flow for intake
  // networks; synthetic baselines are unanimous by construction).
  // Intake GVX baselines carry no ellipsoid tag, so Dataset-A/B setup
  // legs pass the session ellipsoid explicitly (12E.3 used 'WGS84').
  ...(ellipsoid ? { ellipsoid } : {}),
  ...(setup ? { setupUncertainty: setup } : {}),
});
