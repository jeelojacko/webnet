/**
 * Phase 12B — internal GNSS-only ECEF baseline adjustment orchestrator.
 *
 * TypeScript dense path ONLY, by construction: iteration dependencies never
 * carry a sparse correction solver, robust mode is hard-disabled, and no
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
import { applyAdjustmentCorrections, solveAdjustmentIteration } from './adjustmentIteration';
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
import { runGnssBaselinePreflight } from './gnssBaselinePreflight';
import {
  recoverGnssBaselineStatistics,
  type GnssBaselineStatistics,
} from './gnssBaselineStatistics';

export interface GnssBaselineAdjustInput {
  stations: StationMap;
  baselines: GnssBaselineObservation[];
  referenceFrame?: string;
  epoch?: string;
  ellipsoid?: string;
  maxIterations?: number;
  convergenceThresholdM?: number;
}

export interface GnssBaselineAdjustedResidual extends GnssBaselineResidual {
  baselineId: number;
  from: string;
  to: string;
}

export interface GnssBaselineAdjustResult {
  readonly adjustmentFrame: 'ecef';
  readonly routeProvenance: 'typescript-dense';
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
  readonly qxx: number[][];
  readonly conditionEstimate?: number;
  readonly logs: string[];
  /** Per-baseline Qvv/Cvv/redundancy/block diagnostics (TS dense). */
  readonly statistics: GnssBaselineStatistics[];
}

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

export const runGnssBaselineAdjustment = (
  input: GnssBaselineAdjustInput,
): GnssBaselineAdjustResult => {
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
  const preflight = runGnssBaselinePreflight({
    stations,
    baselines,
    referenceFrame: input.referenceFrame,
    epoch: input.epoch,
    ellipsoid: input.ellipsoid,
  });
  log(
    `GNSS ECEF adjustment: ${baselines.length} baselines, ` +
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
  const assemblyObservations = baselines as unknown as Observation[];
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
        sparseCorrectionSolver: undefined,
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
  baselines.forEach((baseline) => {
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
  const { normal } = accumulateNormalEquationsFromSparseRows(
    finalAssembly.sparseRows,
    finalAssembly.L,
    finalP,
    numParams,
  );
  const qxx = invertNormalMatrixForStats(normal, log);
  const residualVector: number[][] = residuals.flatMap((r) => [[r.vX], [r.vY], [r.vZ]]);
  const weightedResidualSum = denseWeightedQuadratic(finalP, residualVector);
  const varianceFactor = dof > 0 ? weightedResidualSum / dof : 0;
  const statistics = recoverGnssBaselineStatistics({
    baselines,
    residuals,
    paramIndex,
    qxx,
    seuw: Math.sqrt(Math.max(varianceFactor, 0)),
  });
  return {
    adjustmentFrame: 'ecef',
    routeProvenance: 'typescript-dense',
    stations,
    unknowns,
    numParams,
    numObsEquations,
    logicalObservations: baselines.length,
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
  };
};
