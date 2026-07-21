import { assembleAdjustmentEquations } from './adjustmentEquationAssembly';
import type { CoordinateConstraintEquation, SolveParameterIndex } from './adjustmentSolveTypes';
import type { EquationRowInfo } from './adjustmentSolveTypes';
import {
  accumulateNormalEquationsFromSparseRows,
  zeros,
} from './matrix';
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
  stations: StationMap;
  wrapToPi: (_value: number) => number;
}

export const recoverFinalNormalCovariance = ({
  activeObservations,
  augmentCovarianceObservations,
  clearGeometryCache,
  constraints,
  correctedDistanceModel,
  curvatureRefractionAngle,
  debug,
  directionOrientations,
  dirParamMap,
  effectiveStdDev,
  getAzimuth,
  getModeledZenith,
  getObservedHorizontalDistanceIn2D,
  gpsModeledVector,
  gpsModeledVectorDerivatives,
  gpsObservedVector,
  gpsWeight,
  invertNormalMatrixForStats,
  is2D,
  measuredAngleCorrection,
  modeledAzimuth,
  numObsEquations,
  numParams,
  paramIndex,
  projectWeakFloatZenithLeafStationsForDisplay,
  applyTsCorrelationToWeightMatrix,
  stations,
  wrapToPi,
}: RecoverFinalNormalCovarianceOptions): number[][] | null => {
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
    const { P, sparseRows } = assembleAdjustmentEquations(
      {
        stations,
        paramIndex,
        is2D,
        debug,
        directionOrientations,
        dirParamMap,
        effectiveStdDev,
        correctedDistanceModel,
        getObservedHorizontalDistanceIn2D,
        getAzimuth,
        measuredAngleCorrection,
        modeledAzimuth,
        wrapToPi,
        gpsObservedVector,
        gpsModeledVector,
        gpsModeledVectorDerivatives,
        gpsWeight,
        getModeledZenith,
        curvatureRefractionAngle,
        applyTsCorrelationToWeightMatrix,
      },
      covarianceObservations,
      constraints,
      covarianceObsEquationCount,
      numParams,
      undefined,
      { includeDenseA: false },
    );
    const { normal } = accumulateNormalEquationsFromSparseRows(
      sparseRows,
      zeros(covarianceObsEquationCount, 1),
      P,
      numParams,
    );
    return invertNormalMatrixForStats(normal);
  } finally {
    Object.keys(stationSnapshot).forEach((stationId) => {
      stations[stationId] = { ...stationSnapshot[stationId] };
    });
    clearGeometryCache();
  }
};
