import type { SolveTimingBuckets } from './adjustSolveTiming';
import type { WeightMatrixWriter } from './adjustmentWeightWriter';
import type { StructuredSymmetricWeights } from './sparseWeightRepresentation';
import type { SparseRowProductsSolver } from './numericalBackend';
import type { GpsCovariance, GpsSolveVector, GpsVectorDerivatives } from './adjustTypes';
import type {
  EquationRowInfo,
  RobustWeightMatrixBase,
  RobustWeightSummary,
  SolveParameterIndex,
} from './adjustmentSolveTypes';
import type { AdjustmentResult, GpsObservation, Observation, Station, StationId, StationMap } from '../types';

export type CorrectedDistanceModelResult = {
  calcDistance: number;
  mapScale: number;
  prismCorrection: number;
  horizontalDerivativeFactor?: number;
  verticalDerivativeFactor?: number;
  useReducedSlopeDerivatives?: boolean;
};

export type ModeledZenith = {
  z: number;
  dist: number;
  horiz: number;
  dh: number;
  crCorr: number;
  horizontalScale: number;
};

export type AzimuthDistance = { az: number; dist: number };

export type TsCorrelationGroup = { key: string; station: StationId; setId?: string };

export type AdjustmentStatisticsContext = {
  observations: Observation[];
  stations: StationMap;
  unknowns: StationId[];
  paramIndex: SolveParameterIndex;
  Qxx: number[][] | null;
  is2D: boolean;
  directionOrientations: Record<string, number>;
  dof: number;
  seuw: number;
  preanalysisMode: boolean;
  robustMode: string | undefined;
  tsCorrelationEnabled: boolean;
  tsCorrelationRho: number;
  tsCorrelationScope: 'setup' | 'set' | undefined;
  localTestCritical: number;
  maxStdRes: number;
  traverseThresholds: {
    minClosureRatio: number;
    maxLinearPpm: number;
    maxAngularArcSec: number;
    maxVerticalMisclosure: number;
  };
  parseState?: {
    relativeLinePairs?: Array<{ from: StationId; to: StationId }>;
    positionalTolerancePairs?: Array<{ from: StationId; to: StationId }>;
  };
  solveTiming: SolveTimingBuckets;
  logs: string[];
  chiSquare?: AdjustmentResult['chiSquare'];
  statisticalSummary?: AdjustmentResult['statisticalSummary'];
  typeSummary?: AdjustmentResult['typeSummary'];
  directionSetDiagnostics?: AdjustmentResult['directionSetDiagnostics'];
  directionTargetDiagnostics?: AdjustmentResult['directionTargetDiagnostics'];
  directionRepeatabilityDiagnostics?: AdjustmentResult['directionRepeatabilityDiagnostics'];
  setupDiagnostics?: AdjustmentResult['setupDiagnostics'];
  residualDiagnostics?: AdjustmentResult['residualDiagnostics'];
  traverseDiagnostics?: AdjustmentResult['traverseDiagnostics'];
  autoSideshotDiagnostics?: AdjustmentResult['autoSideshotDiagnostics'];
  tsCorrelationDiagnostics?: AdjustmentResult['tsCorrelationDiagnostics'];
  precisionModels?: AdjustmentResult['precisionModels'];
  stationCovariances?: AdjustmentResult['stationCovariances'];
  relativePrecision?: AdjustmentResult['relativePrecision'];
  relativeCovariances?: AdjustmentResult['relativeCovariances'];
  weakGeometryDiagnostics?: AdjustmentResult['weakGeometryDiagnostics'];
  sideshots?: AdjustmentResult['sideshots'];
  clearGeometryCache: () => void;
  collectActiveObservations: () => Observation[];
  correctedDistanceModel: (_obs: Observation & { type: 'dist' }, _calcDistRaw: number) => CorrectedDistanceModelResult;
  curvatureRefractionAngle: (_horiz: number) => number;
  effectiveDistanceForAngularObservation: (_obs: Observation) => number | undefined;
  effectiveStdDev: (_obs: Observation) => number;
  getAzimuth: (_fromId: StationId, _toId: StationId) => AzimuthDistance;
  getModeledZenith: (_obs: Observation & { type: 'zenith' }) => ModeledZenith;
  getObservedHorizontalDistanceIn2D: (_obs: Observation & { type: 'dist' }) => {
    observedDistance: number;
    sigmaDistance: number;
    usedZenith: boolean;
  };
  gpsComponentCount: (_obs: GpsObservation) => number;
  gpsCovariance: (_obs: Observation) => GpsCovariance;
  gpsDisplayResidualTransform: (_obs: GpsObservation, _fromStation?: Station) => number[][] | null;
  gpsModeledVector: (_obs: GpsObservation) => GpsSolveVector;
  gpsModeledVectorDerivatives: (_obs: GpsObservation) => GpsVectorDerivatives;
  gpsObservedVector: (_obs: GpsObservation) => GpsSolveVector;
  gpsWeight: (_obs: Observation) => {
    wEE: number;
    wEN: number;
    wNN: number;
    wUU?: number;
    wEU?: number;
    wNU?: number;
  };
  invertNormalMatrixForStats: (_normal: number[][], _useFallback?: boolean) => number[][];
  /** Optional experimental row-product backend; undefined keeps the dense computation. */
  sparseRowProductsSolver?: SparseRowProductsSolver;
  isObservationActive: (_obs: Observation) => boolean;
  measuredAngleCorrection: (_at: StationId, _from: StationId, _to: StationId) => number;
  modeledAzimuth: (_rawAz: number, _atStationId?: StationId, _applyConvergence?: boolean) => number;
  wrapToPi: (_value: number) => number;
  applyRobustWeightFactors: (_matrix: number[][], _base: RobustWeightMatrixBase, _factors: number[]) => void;
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
  captureObservationWeightingStdDevs: (_observations: Observation[]) => void;
  captureRobustWeightBase: (_matrix: number[][], _rowInfo: EquationRowInfo[]) => RobustWeightMatrixBase;
  /** Sparse Huber support without a dense P; absent means sparse+Huber falls back to dense. */
  captureRobustWeightBaseFromStructured?: (
    _weights: StructuredSymmetricWeights,
    _rowInfo: EquationRowInfo[],
  ) => RobustWeightMatrixBase;
  applyRobustWeightFactorsToStructured?: (
    _weights: StructuredSymmetricWeights,
    _base: RobustWeightMatrixBase,
    _factors: number[],
  ) => void;
  computeRobustWeightSummary: (_residuals: number[], _rowInfo: EquationRowInfo[]) => RobustWeightSummary;
  computeSideshotResults: () => AdjustmentResult['sideshots'];
  log: (_message: string) => void;
  tsCorrelationGroup: (_obs: Observation) => TsCorrelationGroup | null;
};
