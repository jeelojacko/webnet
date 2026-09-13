/**
 * Phase 12B — internal GNSS-only ECEF baseline adjustment orchestrator.
 *
 * TypeScript dense path by default: iteration dependencies carry a sparse
 * correction solver ONLY when the default-OFF 12F.1 native route injects
 * one via `nativeRuntime`; robust mode is hard-disabled, and no
 * geoid/height preprocessing, CRS transform, or terrestrial equation is
 * reachable from this module. Foreign observation types cannot enter
 * (typed input + throwing assembly stubs); frame/datum validation happens
 * in `gnssBaselinePreflight` before any numerics.
 *
 * Under `adjustmentFrame = 'ecef'` the stored station triplet means:
 *   x -> X, y -> Y, h -> Z   (Cartesian metres; h is NOT a height here)
 * Results carry the explicit frame tag so downstream project-frame
 * consumers cannot mistake the values for easting/northing/elevation.
 */
import type { Observation, StationMap } from '../types';
import { assembleAdjustmentEquations } from './adjustmentEquationAssembly';
import type { EquationRowInfo } from './adjustmentSolveTypes';
import type { SolveParameterIndex } from './adjustmentSolveTypes';
import { applyAdjustmentCorrections, solveAdjustmentIteration } from './adjustmentIteration';
import type { SparseMatrixRows } from './matrix';
import type { SparseCorrectionSolver, SparseFactorMetadata } from './numericalBackend';
import { buildSolveParameterIndex } from './adjustmentPreprocessing';
import { invertNormalMatrixForStats, solveNormalEquations } from './adjustNormalEquationHelpers';
import { accumulateNormalEquationsFromSparseRows } from './matrix';
import type {
  GnssBaselineObservation,
  GnssBaselineResidual,
} from './gnssBaselineTypes';
import {
  gnssBaselineQuadraticForm,
  invertGnssBaselineCovariance,
} from './gnssBaselineCovariance';
import { gnssBaselineLabel } from './gnssBaselineEquationRows';
import {
  applyGnssSetupUncertainty,
  type GnssSetupContribution,
  type GnssSetupModel,
  type GnssSetupUncertainty,
} from './gnssBaselineSetupUncertainty';
import { buildGnssSelectedBlockPlan, type GnssSelectedBlockPlan } from './gnssSelectedBlockPlan';
import { verifyGnssSelectedBlocks } from './gnssSelectedBlockVerify';
import type { GnssSelectedBlockStore } from './gnssSelectedBlockQuery';
import { recoverGnssBaselineStatisticsFromBlocks } from './gnssBlockStatistics';
import {
  recoverGnssBaselineStatistics,
  type GnssBaselineStatistics,
} from './gnssBaselineStatistics';
import { runGnssBaselinePreflight } from './gnssBaselinePreflight';

export interface GnssBaselineAdjustInput {
  stations: StationMap;
  baselines: GnssBaselineObservation[];
  referenceFrame?: string;
  epoch?: string;
  ellipsoid?: string;
  /**
   * Phase 12E.3: optional endpoint setup uncertainty (metres, 1-sigma).
   * Absent (or both sigmas 0) => raw covariances solve untouched.
   * Nonzero => per-endpoint local-ENU augmentation applied once from
   * the a-priori station coords before iteration; raw preserved on each
   * observation's `rawCovariance`. Never admit a nonzero-setup network
   * to a native/sparse route: GNSS stays TS-dense (existing tripwires).
   */
  setupUncertainty?: GnssSetupUncertainty;
  maxIterations?: number;
  convergenceThresholdM?: number;
  /**
   * Phase 12F.1 internal/test-only native R1 seam. Absent (the default)
   * => TS-dense solve, bit-identical to Phase 12E.3. Present => the
   * iteration loop solves corrections through `sparseCorrectionSolver`
   * (existing `solveAdjustmentIteration` seam) and final Qxx comes from
   * `nativeQxxProvider` (native full-dense query + C1/C2/C3 verification
   * inside the provider; it throws on any fault). Any provider throw
   * propagates so the route wrapper can rerun clean TypeScript.
   */
  nativeRuntime?: GnssBaselineNativeRuntime;
}

/**
 * Phase 12F.3 internal/test-only native R2B selected-blocks provider.
 * Receives the canonical block plan plus the final packed system context,
 * performs exactly one batched `queryBlocks` bridge call, and returns the
 * folded block store with native factor metadata. Throws on any fault
 * (including the pre-solve fill gate) so the route reruns clean TS.
 */
export interface GnssBaselineNativeSelectedBlocksProviderInput {
  readonly sparseRows: SparseMatrixRows;
  readonly weights: number[][];
  readonly numParams: number;
  readonly plan: GnssSelectedBlockPlan;
  readonly paramIndex: SolveParameterIndex;
}

export interface GnssBaselineNativeSelectedBlocks {
  readonly store: GnssSelectedBlockStore;
  readonly meta: SparseFactorMetadata;
  readonly uniqueColumns: number;
}

/** Phase 12F.1 injected native R1 dependencies (never constructed in production TS). */
export interface GnssBaselineNativeRuntime {
  readonly sparseCorrectionSolver?: SparseCorrectionSolver;
  readonly nativeQxxProvider?: (_input: {
    sparseRows: SparseMatrixRows;
    weights: number[][];
    numParams: number;
  }) => number[][];
  /**
   * Phase 12F.3 injected native R2B dependency. Mutually exclusive with
   * `nativeQxxProvider`: both present throws fail-closed.
   */
  readonly nativeSelectedBlocksProvider?: (
    _input: GnssBaselineNativeSelectedBlocksProviderInput,
  ) => GnssBaselineNativeSelectedBlocks;
}

export interface GnssBaselineAdjustedResidual extends GnssBaselineResidual {
  baselineId: number;
  from: string;
  to: string;
}

/** Common R2B/dense result fields; dense and selected variants add their Qxx source. */
export interface GnssBaselineAdjustResultBase {
  readonly adjustmentFrame: 'ecef';
  readonly routeProvenance:
    | 'typescript-dense'
    | 'native-sparse-full-qxx'
    | 'native-sparse-selected-qxx';
  readonly stations: StationMap;
  readonly unknowns: string[];
  readonly numParams: number;
  readonly numObsEquations: number;
  readonly logicalObservations: number;
  readonly dof: number;
  readonly iterations: number;
  readonly converged: boolean;
  readonly maxCorrectionM: number;
  readonly residuals: GnssBaselineAdjustedResidual[];
  readonly weightedResidualSum: number;
  readonly varianceFactor: number;
  readonly conditionEstimate?: number;
  readonly logs: string[];
  /** Per-baseline Qvv/Cvv/redundancy/block diagnostics (TS dense). */
  readonly statistics: GnssBaselineStatistics[];
  /** Phase 12E.3: resolved setup model (null-shape via undefined when inactive). */
  readonly setupModel?: GnssSetupModel;
  /** Phase 12E.3: per-baseline raw/setup/effective covariances (undefined when inactive). */
  readonly setupContributions?: GnssSetupContribution[];
}

/** Dense Qxx result: clean TS or Phase 12F.1 native full-dense. */
export interface GnssBaselineDenseAdjustResult extends GnssBaselineAdjustResultBase {
  readonly routeProvenance: 'typescript-dense' | 'native-sparse-full-qxx';
  readonly qxx: number[][];
}

/**
 * Phase 12F.3 R2B result: block-store Qxx source, NO qxx field. Statistics
 * are Phase-12D-identical, recovered from the verified block store.
 */
export interface GnssBaselineSelectedAdjustResult extends GnssBaselineAdjustResultBase {
  readonly routeProvenance: 'native-sparse-selected-qxx';
  readonly selectedBlocks: GnssBaselineNativeSelectedBlocks;
}

/** Production result: dense by default, selected-blocks only via the R2B seam. */
export type GnssBaselineAdjustResult =
  | GnssBaselineDenseAdjustResult
  | GnssBaselineSelectedAdjustResult;

const unreachableInGnssMode = (name: string): never => {
  throw new Error(`GNSS-only ECEF adjustment reached unexpected helper '${name}'.`);
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
  const n = N.length;
  if (!n) return 0;
  let rowMax = 0;
  let colMax = 0;
  for (let i = 0; i < n; i += 1) {
    let rsum = 0;
    let csum = 0;
    for (let j = 0; j < n; j += 1) {
      rsum += Math.abs(N[i]?.[j] ?? 0);
      csum += Math.abs(N[j]?.[i] ?? 0);
    }
    rowMax = Math.max(rowMax, rsum);
    colMax = Math.max(colMax, csum);
  }
  return rowMax * colMax;
};

/**
 * Overloads keep existing TS callers zero-change: anything that can not
 * carry a selected-blocks provider returns the dense result type; only a
 * runtime with the R2B provider returns the selected-blocks union member.
 */
export function runGnssBaselineAdjustment(
  _input: GnssBaselineAdjustInput & {
    nativeRuntime: GnssBaselineNativeRuntime & {
      nativeSelectedBlocksProvider: NonNullable<
        GnssBaselineNativeRuntime['nativeSelectedBlocksProvider']
      >;
    };
  },
): GnssBaselineSelectedAdjustResult;
// eslint-disable-next-line no-redeclare -- overload signature for the dense result
export function runGnssBaselineAdjustment(
  _input: GnssBaselineAdjustInput,
): GnssBaselineDenseAdjustResult;
// eslint-disable-next-line no-redeclare -- implementation of the overloaded signatures
export function runGnssBaselineAdjustment(
  input: GnssBaselineAdjustInput,
): GnssBaselineAdjustResult {
  const logs: string[] = [];
  const log = (message: string): void => {
    logs.push(message);
  };
  const maxIterations = input.maxIterations ?? 10;
  const convergenceThresholdM = input.convergenceThresholdM ?? 1e-9;
  // Work on a copy: caller station state is never mutated.
  const stations: StationMap = Object.fromEntries(
    Object.entries(input.stations).map(([stationId, station]) => [stationId, { ...station }]),
  );
  const baselines = [...input.baselines].sort((a, b) => a.id - b.id);
  // Phase 12E.3: endpoint setup augmentation happens ONCE here, from the
  // a-priori input coords, before preflight and before any iteration.
  // Fixed (control) endpoints are augmented like free ones. Inactive
  // setup returns the input observations untouched (bit-identical solve).
  const setupApplied = applyGnssSetupUncertainty({
    stations,
    baselines,
    setup: input.setupUncertainty,
    ellipsoid: input.ellipsoid,
  });
  const effectiveBaselines = setupApplied.baselines;
  if (setupApplied.setupModel) {
    log(
      `GNSS setup uncertainty: centering=${setupApplied.setupModel.horizontalCenteringSigma} m ` +
        `height=${setupApplied.setupModel.antennaHeightSigma} m ` +
        `orientation=${setupApplied.setupModel.orientation} ellipsoid=${setupApplied.setupModel.ellipsoid}.`,
    );
  }
  const preflight = runGnssBaselinePreflight({
    stations,
    baselines: effectiveBaselines,
    referenceFrame: input.referenceFrame,
    epoch: input.epoch,
    ellipsoid: input.ellipsoid,
  });
  log(
    `GNSS ECEF adjustment: ${effectiveBaselines.length} baselines, ` +
      `${preflight.components.length} component(s), ${preflight.equationCount} equations.`,
  );
  const unknowns = preflight.components
    .flat()
    .filter((stationId) => {
      const station = stations[stationId];
      return !!station && !(station.fixedX && station.fixedY && station.fixedH);
    })
    .sort();
  // NOTE: project-mode automatic holds (applyAutomaticHorizontalHolds /
  // applyAutomaticHeightHolds) are deliberately NOT applied: in ECEF mode
  // every baseline endpoint carries all three Cartesian components, and the
  // height-hold heuristic would wrongly fix Z. Fixed stations anchor only
  // through their declared fixedX/fixedY/fixedH control values.
  const { paramIndex, stationParamCount } = buildSolveParameterIndex(stations, unknowns, false);
  const numParams = stationParamCount;
  const numObsEquations = preflight.equationCount;
  const dof = numObsEquations - numParams;
  if (dof < 0) {
    throw new Error(
      `GNSS baseline adjustment is under-determined: ${numObsEquations} equations for ${numParams} parameters.`,
    );
  }
  const assemblyObservations = effectiveBaselines as unknown as Observation[];
  let conditionEstimate: number | undefined;
  let iterations = 0;
  let converged = false;
  let maxCorrectionM = Number.POSITIVE_INFINITY;
  for (let iteration = 1; iteration <= maxIterations; iteration += 1) {
    iterations = iteration;
    const assembled = assembleAdjustmentEquations(
      {
        stations,
        paramIndex,
        is2D: false,
        debug: false,
        directionOrientations: {},
        dirParamMap: {},
        effectiveStdDev: () => unreachableInGnssMode('effectiveStdDev'),
        correctedDistanceModel: () => unreachableInGnssMode('correctedDistanceModel'),
        getObservedHorizontalDistanceIn2D: () => unreachableInGnssMode('getObservedHorizontalDistanceIn2D'),
        getAzimuth: () => unreachableInGnssMode('getAzimuth'),
        measuredAngleCorrection: () => unreachableInGnssMode('measuredAngleCorrection'),
        modeledAzimuth: () => unreachableInGnssMode('modeledAzimuth'),
        wrapToPi: () => unreachableInGnssMode('wrapToPi'),
        gpsObservedVector: () => unreachableInGnssMode('gpsObservedVector'),
        gpsModeledVector: () => unreachableInGnssMode('gpsModeledVector'),
        gpsModeledVectorDerivatives: () => unreachableInGnssMode('gpsModeledVectorDerivatives'),
        gpsWeight: () => unreachableInGnssMode('gpsWeight'),
        getModeledZenith: () => unreachableInGnssMode('getModeledZenith'),
        curvatureRefractionAngle: () => unreachableInGnssMode('curvatureRefractionAngle'),
        // No TS-correlation in GNSS-only mode: identity preserves P exactly.
        applyTsCorrelationToWeightMatrix: () => {},
        logObsDebug: undefined,
      },
      assemblyObservations,
      [],
      numObsEquations,
      numParams,
      iteration,
    );
    const computed = solveAdjustmentIteration(
      {
        robustMode: 'none',
        sparseCorrectionSolver: input.nativeRuntime?.sparseCorrectionSolver,
        experimentalSparseDiagnostics: undefined,
        solveNormalEquations: (N, U, options) =>
          solveNormalEquations(N, U, { log, recoverCovariance: options?.recoverCovariance }),
        estimateCondition,
        recordConditionEstimate: (estimate) => {
          conditionEstimate = estimate;
        },
        captureRobustWeightBase: () => unreachableInGnssMode('captureRobustWeightBase'),
        applyRobustWeightFactors: () => unreachableInGnssMode('applyRobustWeightFactors'),
        computeRobustWeightSummary: () => unreachableInGnssMode('computeRobustWeightSummary'),
        maxRobustWeightDelta: () => unreachableInGnssMode('maxRobustWeightDelta'),
        recordRobustDiagnostics: () => unreachableInGnssMode('recordRobustDiagnostics'),
        weightedQuadratic: denseWeightedQuadratic,
      },
      assembled.A ?? [],
      assembled.L,
      assembled.P,
      assembled.rowInfo,
      iteration,
      { sparseRows: assembled.sparseRows, numParams },
    );
    maxCorrectionM = applyAdjustmentCorrections(
      stations,
      paramIndex,
      false,
      {},
      {},
      computed.correction,
    );
    if (maxCorrectionM < convergenceThresholdM) {
      converged = true;
      break;
    }
  }
  log(
    `GNSS ECEF solve: iterations=${iterations} converged=${converged} ` +
      `maxCorrection=${maxCorrectionM.toExponential(3)}m dof=${dof}.`,
  );
  // Final assembly at the solved state: residuals V = L (zero correction).
  const finalAssembly = assembleAdjustmentEquations(
    {
      stations,
      paramIndex,
      is2D: false,
      debug: false,
      directionOrientations: {},
      dirParamMap: {},
      effectiveStdDev: () => unreachableInGnssMode('effectiveStdDev'),
      correctedDistanceModel: () => unreachableInGnssMode('correctedDistanceModel'),
      getObservedHorizontalDistanceIn2D: () => unreachableInGnssMode('getObservedHorizontalDistanceIn2D'),
      getAzimuth: () => unreachableInGnssMode('getAzimuth'),
      measuredAngleCorrection: () => unreachableInGnssMode('measuredAngleCorrection'),
      modeledAzimuth: () => unreachableInGnssMode('modeledAzimuth'),
      wrapToPi: () => unreachableInGnssMode('wrapToPi'),
      gpsObservedVector: () => unreachableInGnssMode('gpsObservedVector'),
      gpsModeledVector: () => unreachableInGnssMode('gpsModeledVector'),
      gpsModeledVectorDerivatives: () => unreachableInGnssMode('gpsModeledVectorDerivatives'),
      gpsWeight: () => unreachableInGnssMode('gpsWeight'),
      getModeledZenith: () => unreachableInGnssMode('getModeledZenith'),
      curvatureRefractionAngle: () => unreachableInGnssMode('curvatureRefractionAngle'),
      applyTsCorrelationToWeightMatrix: () => {},
      logObsDebug: undefined,
    },
    assemblyObservations,
    [],
    numObsEquations,
    numParams,
    iterations + 1,
  );
  const finalP = finalAssembly.P ?? [];
  const residuals: GnssBaselineAdjustedResidual[] = [];
  const rowByBaseline = new Map<number, { row: number; info: EquationRowInfo }[]>();
  finalAssembly.rowInfo.forEach((info, row) => {
    const obs = info?.obs as unknown as GnssBaselineObservation | undefined;
    if (!obs || typeof obs.id !== 'number') return;
    const entries = rowByBaseline.get(obs.id) ?? [];
    entries.push({ row, info });
    rowByBaseline.set(obs.id, entries);
  });
  effectiveBaselines.forEach((baseline) => {
    const entries = (rowByBaseline.get(baseline.id) ?? []).sort((a, b) => a.row - b.row);
    if (entries.length !== 3) {
      throw new Error(
        `GNSS baseline ${gnssBaselineLabel(baseline)} assembled ${entries.length} rows instead of 3.`,
      );
    }
    const [vX, vY, vZ] = entries.map(
      (entry) => finalAssembly.L[entry.row]?.[0] ?? Number.NaN,
    ) as [number, number, number];
    const inverse = invertGnssBaselineCovariance(baseline.covariance, gnssBaselineLabel(baseline));
    residuals.push({
      baselineId: baseline.id,
      from: baseline.from,
      to: baseline.to,
      vX,
      vY,
      vZ,
      magnitude: Math.sqrt(vX * vX + vY * vY + vZ * vZ),
      quadraticForm: gnssBaselineQuadraticForm(inverse, vX, vY, vZ),
    });
  });
  residuals.sort((a, b) => a.baselineId - b.baselineId);
  // Phase 12F.1: native full-dense Qxx replaces the dense inversion only
  // when a provider is injected; it throws on any fault (dimension,
  // non-finite, verification reject) so the caller falls back to TS.
  const nativeQxxProvider = input.nativeRuntime?.nativeQxxProvider;
  const nativeSelectedBlocksProvider = input.nativeRuntime?.nativeSelectedBlocksProvider;
  if (nativeQxxProvider && nativeSelectedBlocksProvider) {
    throw new Error('GNSS native runtime carries both Qxx providers (fail-closed).');
  }
  // R2B never consumes the dense normal: skip its boxed p² accumulation
  // (the shared TS-dense assembly above is untouched; only this dead
  // normal is skipped, so no math changes on any route).
  const { normal } = nativeSelectedBlocksProvider
    ? { normal: [] as number[][] }
    : accumulateNormalEquationsFromSparseRows(
        finalAssembly.sparseRows,
        finalAssembly.L,
        finalP,
        numParams,
      );
  const residualVector: number[][] = residuals.flatMap((r) => [[r.vX], [r.vY], [r.vZ]]);
  const weightedResidualSum = denseWeightedQuadratic(finalP, residualVector);
  const varianceFactor = dof > 0 ? weightedResidualSum / dof : 0;
  const seuw = Math.sqrt(Math.max(varianceFactor, 0));
  const setupTail = setupApplied.setupModel
    ? {
        setupModel: setupApplied.setupModel,
        setupContributions: setupApplied.contributions,
      }
    : {};
  // --- R2B selected-blocks branch (begin): the normal matrix is never
  // inverted on this path and no full-dense covariance provider is used.
  // No scalar-selected queries either: one batched block query only.
  if (nativeSelectedBlocksProvider) {
    const plan = buildGnssSelectedBlockPlan(
      paramIndex,
      effectiveBaselines.map((baseline) => ({ from: baseline.from, to: baseline.to })),
      numParams,
    );
    const selected = nativeSelectedBlocksProvider({
      sparseRows: finalAssembly.sparseRows,
      weights: finalP,
      numParams,
      plan,
      paramIndex,
    });
    verifyGnssSelectedBlocks(selected.store, plan);
    const statistics = recoverGnssBaselineStatisticsFromBlocks({
      baselines: effectiveBaselines,
      residuals,
      paramIndex,
      stationIds: plan.stationIds,
      store: selected.store,
      seuw,
    });
    const identityViolation = Math.abs(
      statistics.reduce((sum, stat) => sum + stat.redundancy.trace, 0) - dof,
    );
    if (!(identityViolation < 1e-9)) {
      throw new Error(
        `GNSS selected-block identity gate tripped: |sum trace(R) - dof| = ${identityViolation} (fail-closed).`,
      );
    }
    const totalStations = Object.keys(stations).length;
    log(
      `GNSS selected blocks: stations=${totalStations} free=${unknowns.length} ` +
        `fixed=${totalStations - unknowns.length} params=${numParams} ` +
        `baselines=${effectiveBaselines.length} freeFreeEdges=${plan.counts.uniqueFreeFreeEdges} ` +
        `blocks=${plan.counts.uniqueBlocks} uniqueColumns=${selected.uniqueColumns} ` +
        `factorNnz=${selected.meta.factorNnz}.`,
    );
    log('GNSS Qxx: native sparse selected-blocks (verified).');
    return {
      adjustmentFrame: 'ecef',
      routeProvenance: 'native-sparse-selected-qxx',
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
      conditionEstimate,
      logs,
      statistics,
      selectedBlocks: selected,
      ...setupTail,
    };
  }
  // --- R2B selected-blocks branch (end).
  let qxx: number[][];
  let routeProvenance: GnssBaselineDenseAdjustResult['routeProvenance'] = 'typescript-dense';
  if (nativeQxxProvider) {
    const nativeQxx = nativeQxxProvider({ sparseRows: finalAssembly.sparseRows, weights: finalP, numParams });
    if (
      nativeQxx.length !== numParams ||
      nativeQxx.some((row) => row.length !== numParams || row.some((value) => !Number.isFinite(value)))
    ) {
      throw new Error('GNSS native Qxx failed dimension/finite gate (fail-closed).');
    }
    qxx = nativeQxx;
    routeProvenance = 'native-sparse-full-qxx';
    log('GNSS Qxx: native sparse full-dense (verified).');
  } else {
    qxx = invertNormalMatrixForStats(normal, log);
  }
  const statistics = recoverGnssBaselineStatistics({
    baselines: effectiveBaselines,
    residuals,
    paramIndex,
    qxx,
    seuw,
  });
  return {
    adjustmentFrame: 'ecef',
    routeProvenance,
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
    conditionEstimate,
    logs,
    statistics,
    ...setupTail,
  };
}
