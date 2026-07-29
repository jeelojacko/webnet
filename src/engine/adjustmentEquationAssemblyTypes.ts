import type { SparseMatrixRows } from './matrix';
import type {
  CoordinateConstraintEquation,
  EquationRowInfo,
  SolveParameterIndex,
} from './adjustmentSolveTypes';
import type {
  DistanceObservation,
  GpsObservation,
  Observation,
  StationId,
  StationMap,
} from '../types';

export interface DistanceModelResult {
  calcDistance: number;
  mapScale: number;
  prismCorrection: number;
  horizontalDerivativeFactor?: number;
  verticalDerivativeFactor?: number;
  useReducedSlopeDerivatives?: boolean;
}

export interface HorizontalDistanceObservation {
  observedDistance: number;
  sigmaDistance: number;
  usedZenith: boolean;
}

export interface ZenithGeometry {
  z: number;
  dist: number;
  horiz: number;
  dh: number;
  crCorr: number;
  horizontalScale?: number;
}

export interface AdjustmentEquationAssemblyDependencies {
  stations: StationMap;
  paramIndex: SolveParameterIndex;
  is2D: boolean;
  debug: boolean;
  directionOrientations: Record<string, number>;
  dirParamMap: Record<string, number>;
  effectiveStdDev: (_observation: Observation) => number;
  correctedDistanceModel: (
    _observation: DistanceObservation,
    _calcDistRaw: number,
  ) => DistanceModelResult;
  getObservedHorizontalDistanceIn2D: (
    _observation: DistanceObservation,
  ) => HorizontalDistanceObservation;
  getAzimuth: (_fromId: StationId, _toId: StationId) => { az: number; dist: number };
  measuredAngleCorrection: (_at: StationId, _from: StationId, _to: StationId) => number;
  modeledAzimuth: (
    _rawAz: number,
    _atStationId?: StationId,
    _applyConvergence?: boolean,
  ) => number;
  wrapToPi: (_value: number) => number;
  gpsObservedVector: (
    _observation: GpsObservation,
  ) => { dE: number; dN: number; dU?: number; scale: number };
  gpsModeledVector: (
    _observation: GpsObservation,
  ) => { dE: number; dN: number; dU?: number; scale: number };
  gpsModeledVectorDerivatives: (_observation: GpsObservation) => {
    from: { x?: { dE: number; dN: number; dU?: number }; y?: { dE: number; dN: number; dU?: number }; h?: { dE: number; dN: number; dU?: number } };
    to: { x?: { dE: number; dN: number; dU?: number }; y?: { dE: number; dN: number; dU?: number }; h?: { dE: number; dN: number; dU?: number } };
  };
  gpsWeight: (_observation: Observation) => {
    wEE: number;
    wNN: number;
    wEN: number;
    wUU?: number;
    wEU?: number;
    wNU?: number;
  };
  getModeledZenith: (_observation: Observation & { type: 'zenith' }) => ZenithGeometry;
  curvatureRefractionAngle: (_horiz: number) => number;
  applyTsCorrelationToWeightMatrix: (_P: number[][], _rowInfo: EquationRowInfo[]) => void;
  logObsDebug?: (_iteration: number, _label: string, _details: string) => void;
}

export interface AdjustmentEquationAssemblyResult {
  A?: number[][];
  L: number[][];
  P: number[][];
  rowInfo: EquationRowInfo[];
  sparseRows: SparseMatrixRows;
}

export interface AdjustmentEquationAssemblyOptions {
  includeDenseA?: boolean;
}

export interface EquationRowAssemblyState {
  L: number[][];
  P: number[][];
  rowInfo: EquationRowInfo[];
  assignCoefficient: (_row: number, _column: number | undefined, _value: number) => void;
}

export type { CoordinateConstraintEquation };
