import { assembleAdjustmentEquations } from './adjustmentEquationAssembly';
import type { AdjustmentEquationAssemblyDependencies } from './adjustmentEquationAssemblyTypes';
import type { CoordinateConstraintEquation, SolveParameterIndex } from './adjustmentSolveTypes';
import type { EquationRowInfo } from './adjustmentSolveTypes';
import {
  accumulateNormalEquationsFromSparseRows,
  zeros,
} from './matrix';
import type { SparseMatrixRows } from './matrix';
import type { WeightMatrixWriter } from './adjustmentWeightWriter';
import { packSparseDesignRows } from './sparseEquationPacking';
import { structuredWeightsToPackedUpper } from './sparseWeightRepresentation';
import type { StructuredSymmetricWeights } from './sparseWeightRepresentation';
import type { SparseSelectedCovarianceSolver } from './numericalBackend';
import { buildCovarianceQueryPlan } from './covarianceQueryPlan';
import type { CovariancePair } from './covarianceQueryPlan';
import type { ExperimentalSparseRouteDiagnostics } from './experimentalSparseDiagnostics';
import {
  createSelectedCovarianceStore,
  dedupeSelectedQueries,
  stationParamCountOf,
} from './selectedCovarianceStore';
import type { SelectedCovarianceStore } from './selectedCovarianceStore';
import { recordSelectedCovarianceCall, recordSelectedCovarianceFallback } from './experimentalSparseDiagnostics';
import type {
  DistanceObservation,
  GpsObservation,
  Observation,
  StationId,
  StationMap,
  ZenithObservation,
} from '../types';
import type {
  GpsSolveVector,
  GpsVectorDerivatives,
} from './adjustTypes';

export type RecoveredFinalCovariance =
  | { kind: 'dense'; qxx: number[][] }
  | { kind: 'selected'; store: SelectedCovarianceStore };

interface RecoverFinalNormalCovarianceOptions {
  activeObservations: Observation[];
  augmentCovarianceObservations: (_activeObservations: Observation[]) => Observation[];
  clearGeometryCache: () => void;
  constraints: CoordinateConstraintEquation[];
  correctedDistanceModel: (_obs: Observation & { type: 'dist' }, _calcDistRaw: number) => {
    calcDistance: number;
    mapScale: number;
    prismCorrection: number;
    horizontalDerivativeFactor?: number;
    verticalDerivativeFactor?: number;
    useReducedSlopeDerivatives?: boolean;
  };
  curvatureRefractionAngle: (_horiz: number) => number;
  debug: boolean;
  directionOrientations: Record<string, number>;
  dirParamMap: Record<string, number>;
  effectiveStdDev: (_obs: Observation) => number;
  getAzimuth: (_fromId: StationId, _toId: StationId) => { az: number; dist: number };
  getModeledZenith: (_obs: ZenithObservation) => {
    z: number;
    dist: number;
    horiz: number;
    dh: number;
    crCorr: number;
    horizontalScale: number;
  };
  getObservedHorizontalDistanceIn2D: (_obs: DistanceObservation) => {
    observedDistance: number;
    sigmaDistance: number;
    usedZenith: boolean;
  };
  gpsModeledVector: (_obs: GpsObservation) => GpsSolveVector;
  gpsModeledVectorDerivatives: (_obs: GpsObservation) => GpsVectorDerivatives;
  gpsObservedVector: (_obs: GpsObservation) => GpsSolveVector;
  gpsWeight: (_obs: Observation) => {
    wEE: number;
    wNN: number;
    wEN: number;
    wUU?: number;
    wEU?: number;
    wNU?: number;
  };
  invertNormalMatrixForStats: (_normal: number[][]) => number[][];
  is2D: boolean;
  measuredAngleCorrection: (_at: StationId, _from: StationId, _to: StationId) => number;
  modeledAzimuth: (_rawAz: number, _atStationId?: StationId, _applyConvergence?: boolean) => number;
  numObsEquations: number;
  numParams: number;
  paramIndex: SolveParameterIndex;
  projectWeakFloatZenithLeafStationsForDisplay: (_options?: { log?: boolean }) => void;
  applyTsCorrelationToWeightMatrix: (
    _matrix: number[][],
    _rowInfo: EquationRowInfo[],
    _captureDiagnostics?: boolean,
  ) => void;
  applyTsCorrelationToWeightWriter?: (
    _weights: WeightMatrixWriter,
    _rowInfo: EquationRowInfo[],
    _captureDiagnostics?: boolean,
  ) => void;
  /** Test-only experimental selected-covariance backend; undefined keeps dense. */
  sparseSelectedCovarianceSolver?: SparseSelectedCovarianceSolver;
  /** Test-only sparse route diagnostics; undefined disables counting. */
  experimentalSparseDiagnostics?: ExperimentalSparseRouteDiagnostics;
  /**
   * Test-only selected-network mode: query only plan entries and return a
   * store instead of the dense all-entry Qxx reconstruction.
   */
  experimentalSelectedCovarianceMode?: boolean;
  /**
   * Phase 7B.5 test-only legacy compat (Option B): with selected mode,
   * also query exact all-station pairs without dense Qxx. Default
   * undefined/false preserves selected-network scaling/omission.
   */
  experimentalSelectedCovarianceLegacyAllPairs?: boolean;
  /** Observed station pairs feeding the selected-mode query plan. */
  connectedPairs?: readonly CovariancePair[];
  /** REL/PTOL-requested pairs feeding the selected-mode query plan. */
  requestedPairs?: readonly CovariancePair[];
  log?: (_message: string) => void;
  stations: StationMap;
  wrapToPi: (_value: number) => number;
}

type CovarianceAssemblyDependencies = Pick<
  RecoverFinalNormalCovarianceOptions,
  | 'stations'
  | 'paramIndex'
  | 'is2D'
  | 'debug'
  | 'directionOrientations'
  | 'dirParamMap'
  | 'effectiveStdDev'
  | 'correctedDistanceModel'
  | 'getObservedHorizontalDistanceIn2D'
  | 'getAzimuth'
  | 'measuredAngleCorrection'
  | 'modeledAzimuth'
  | 'wrapToPi'
  | 'gpsObservedVector'
  | 'gpsModeledVector'
  | 'gpsModeledVectorDerivatives'
  | 'gpsWeight'
  | 'getModeledZenith'
  | 'curvatureRefractionAngle'
  | 'applyTsCorrelationToWeightMatrix'
  | 'applyTsCorrelationToWeightWriter'
>;

const buildAssemblyDependencies = (
  options: CovarianceAssemblyDependencies,
): AdjustmentEquationAssemblyDependencies => ({
  stations: options.stations,
  paramIndex: options.paramIndex,
  is2D: options.is2D,
  debug: options.debug,
  directionOrientations: options.directionOrientations,
  dirParamMap: options.dirParamMap,
  effectiveStdDev: options.effectiveStdDev,
  correctedDistanceModel: options.correctedDistanceModel,
  getObservedHorizontalDistanceIn2D: options.getObservedHorizontalDistanceIn2D,
  getAzimuth: options.getAzimuth,
  measuredAngleCorrection: options.measuredAngleCorrection,
  modeledAzimuth: options.modeledAzimuth,
  wrapToPi: options.wrapToPi,
  gpsObservedVector: options.gpsObservedVector,
  gpsModeledVector: options.gpsModeledVector,
  gpsModeledVectorDerivatives: options.gpsModeledVectorDerivatives,
  gpsWeight: options.gpsWeight,
  getModeledZenith: options.getModeledZenith,
  curvatureRefractionAngle: options.curvatureRefractionAngle,
  applyTsCorrelationToWeightMatrix: options.applyTsCorrelationToWeightMatrix,
  applyTsCorrelationToWeightWriter: options.applyTsCorrelationToWeightWriter,
});

const buildAllEntryQueries = (
  numParams: number,
): { queryRows: Int32Array; queryColumns: Int32Array } => {
  const count = numParams * numParams;
  const queryRows = new Int32Array(count);
  const queryColumns = new Int32Array(count);
  let position = 0;
  for (let row = 0; row < numParams; row += 1) {
    for (let column = 0; column < numParams; column += 1) {
      queryRows[position] = row;
      queryColumns[position] = column;
      position += 1;
    }
  }
  return { queryRows, queryColumns };
};

const reconstructDenseQxx = (covariance: ArrayLike<number>, numParams: number): number[][] => {
  if (covariance.length !== numParams * numParams) {
    throw new Error('Selected covariance returned an unexpected entry count.');
  }
  const qxx: number[][] = Array.from({ length: numParams }, () => new Array<number>(numParams).fill(0));
  let position = 0;
  for (let row = 0; row < numParams; row += 1) {
    for (let column = 0; column < numParams; column += 1) {
      const value = covariance[position] ?? 0;
      if (!Number.isFinite(value)) throw new Error('Selected covariance contains a non-finite entry.');
      (qxx[row] as number[])[column] = value;
      position += 1;
    }
  }
  return qxx;
};

/**
 * Experimental path: packs sparse design rows plus structured weights
 * directly (no dense P) and queries every Qxx entry so the reconstructed
 * dense matrix preserves the existing precision/report contract.
 */
const querySparseSelectedCovariance = (
  solver: SparseSelectedCovarianceSolver,
  sparseRows: SparseMatrixRows,
  structuredWeights: StructuredSymmetricWeights,
  observationEquationCount: number,
  numParams: number,
): number[][] => {
  const { queryRows, queryColumns } = buildAllEntryQueries(numParams);
  const result = solver.querySelected({
    design: packSparseDesignRows(sparseRows),
    weights: structuredWeightsToPackedUpper(structuredWeights),
    observationEquationCount,
    parameterCount: numParams,
    queryRows,
    queryColumns,
  });
  if (result.damping > 0) {
    throw new Error(
      `Sparse selected covariance used diagonal damping (lambda=${result.damping.toExponential(3)}, attempts=${result.dampingAttempts}); falling back to dense covariance to avoid damped precision.`,
    );
  }
  return reconstructDenseQxx(result.covariance, numParams);
};

const querySelectedCovarianceStore = (
  solver: SparseSelectedCovarianceSolver,
  sparseRows: SparseMatrixRows,
  structuredWeights: StructuredSymmetricWeights,
  observationEquationCount: number,
  options: RecoverFinalNormalCovarianceOptions,
): SelectedCovarianceStore => {
  const plan = buildCovarianceQueryPlan({
    paramIndex: options.paramIndex,
    unknowns: Object.keys(options.paramIndex),
    stationParamCount: stationParamCountOf(options.paramIndex),
    connectedPairs: options.connectedPairs,
    requestedPairs: options.requestedPairs,
    includeHeight: !options.is2D,
    includeAllStationPairs: options.experimentalSelectedCovarianceLegacyAllPairs === true,
  });
  const queries = dedupeSelectedQueries(plan.queries);
  const result = solver.querySelected({
    design: packSparseDesignRows(sparseRows),
    weights: structuredWeightsToPackedUpper(structuredWeights),
    observationEquationCount,
    parameterCount: options.numParams,
    queryRows: Int32Array.from(queries.map((query) => query.row)),
    queryColumns: Int32Array.from(queries.map((query) => query.column)),
  });
  if (result.damping > 0) {
    throw new Error(
      `Sparse selected covariance used diagonal damping (lambda=${result.damping.toExponential(3)}, attempts=${result.dampingAttempts}); falling back to dense covariance to avoid damped precision.`,
    );
  }
  return createSelectedCovarianceStore(options.numParams, queries, result.covariance, {
    legacyAllPairsCovered: options.experimentalSelectedCovarianceLegacyAllPairs === true,
  });
};

const trySparseSelectedCovariance = (
  options: RecoverFinalNormalCovarianceOptions,
  covarianceObservations: Observation[],
  covarianceObsEquationCount: number,
): RecoveredFinalCovariance => {
  const solver = options.sparseSelectedCovarianceSolver;
  if (!solver) throw new Error('Selected-covariance solver is not injected.');
  const { sparseRows, structuredWeights } = assembleAdjustmentEquations(
    buildAssemblyDependencies(options),
    covarianceObservations,
    options.constraints,
    covarianceObsEquationCount,
    options.numParams,
    undefined,
    { includeDenseA: false, weightRepresentation: 'sparse', omitDenseP: true },
  );
  if (!structuredWeights) {
    throw new Error('Sparse covariance assembly did not produce structured weights.');
  }
  if (options.experimentalSelectedCovarianceMode === true) {
    return {
      kind: 'selected',
      store: querySelectedCovarianceStore(
        solver,
        sparseRows,
        structuredWeights,
        covarianceObsEquationCount,
        options,
      ),
    };
  }
  return {
    kind: 'dense',
    qxx: querySparseSelectedCovariance(
      solver,
      sparseRows,
      structuredWeights,
      covarianceObsEquationCount,
      options.numParams,
    ),
  };
};

const recoverDenseCovariance = (
  options: RecoverFinalNormalCovarianceOptions,
  covarianceObservations: Observation[],
  covarianceObsEquationCount: number,
): number[][] => {
  const { P, sparseRows } = assembleAdjustmentEquations(
    buildAssemblyDependencies(options),
    covarianceObservations,
    options.constraints,
    covarianceObsEquationCount,
    options.numParams,
    undefined,
    { includeDenseA: false },
  );
  if (!P) {
    throw new Error('Dense weight matrix is required for covariance recovery.');
  }
  const { normal } = accumulateNormalEquationsFromSparseRows(
    sparseRows,
    zeros(covarianceObsEquationCount, 1),
    P,
    options.numParams,
  );
  return options.invertNormalMatrixForStats(normal);
};

export const recoverFinalNormalCovariance = (
  options: RecoverFinalNormalCovarianceOptions,
): RecoveredFinalCovariance | null => {
  const {
    activeObservations,
    augmentCovarianceObservations,
    clearGeometryCache,
    numObsEquations,
    numParams,
    projectWeakFloatZenithLeafStationsForDisplay,
    stations,
  } = options;
  if (numParams <= 0 || numObsEquations <= 0) return null;
  const stationSnapshot = Object.fromEntries(
    Object.entries(stations).map(([stationId, station]) => [stationId, { ...station }]),
  ) as StationMap;
  projectWeakFloatZenithLeafStationsForDisplay({ log: false });
  const covarianceObservations = augmentCovarianceObservations(activeObservations);
  const covarianceObsEquationCount =
    numObsEquations + (covarianceObservations.length - activeObservations.length);
  try {
    clearGeometryCache();
    if (options.sparseSelectedCovarianceSolver) {
      try {
        recordSelectedCovarianceCall(options.experimentalSparseDiagnostics);
        return trySparseSelectedCovariance(
          options,
          covarianceObservations,
          covarianceObsEquationCount,
        );
      } catch (error) {
        const detail = error instanceof Error ? ` ${error.message}` : '';
        recordSelectedCovarianceFallback(
          options.experimentalSparseDiagnostics,
          detail.trim() || 'sparse selected covariance failed',
        );
        options.log?.(
          `Warning: sparse selected covariance unavailable; using dense fallback.${detail}`,
        );
        clearGeometryCache();
      }
    }
    return {
      kind: 'dense',
      qxx: recoverDenseCovariance(options, covarianceObservations, covarianceObsEquationCount),
    };
  } finally {
    Object.keys(stationSnapshot).forEach((stationId) => {
      stations[stationId] = { ...stationSnapshot[stationId] };
    });
    clearGeometryCache();
  }
};
