import type { AdjustmentResult, ParseOptions } from '../types';
import type { Observation, StationId } from '../types';

export interface SolveParameterIndexEntry {
  x?: number;
  y?: number;
  h?: number;
}

export type SolveParameterIndex = Record<StationId, SolveParameterIndexEntry>;

export interface CoordinateConstraintEquation {
  stationId: StationId;
  component: 'x' | 'y' | 'h';
  index: number;
  target: number;
  sigma: number;
  correlationKey?: string;
  corrXY?: number;
}

export interface CoordinateConstraintRowPlacement {
  row: number;
  constraint: CoordinateConstraintEquation;
}

export type EquationRowInfo = { obs: Observation; component?: 'E' | 'N' } | null;

export type RobustWeightMatrixBase = {
  diagonal: number[];
  correlatedPairs: { i: number; j: number; base: number }[];
};

export type RobustWeightSummary = {
  factors: number[];
  downweightedRows: number;
  minWeight: number;
  maxNorm: number;
  meanWeight: number;
  topRows: NonNullable<AdjustmentResult['robustDiagnostics']>['topDownweightedRows'];
};

export interface ControlConstraintSummary {
  count: number;
  x: number;
  y: number;
  h: number;
  xyCorrelated: number;
}

export interface SolveNormalResult {
  correction: number[][];
  qxx: number[][];
}

export interface IterationSolveDependencies {
  robustMode: ParseOptions['robustMode'];
  solveNormalEquations: (_N: number[][], _U: number[][]) => SolveNormalResult;
  estimateCondition: (_N: number[][]) => number;
  recordConditionEstimate: (_conditionEstimate: number) => void;
  captureRobustWeightBase: (
    _P: number[][],
    _rowInfo: EquationRowInfo[],
  ) => RobustWeightMatrixBase;
  applyRobustWeightFactors: (
    _P: number[][],
    _base: RobustWeightMatrixBase,
    _factors: number[],
  ) => void;
  computeRobustWeightSummary: (
    _residuals: number[],
    _rowInfo: EquationRowInfo[],
  ) => RobustWeightSummary;
  maxRobustWeightDelta: (_a: number[], _b: number[]) => number;
  recordRobustDiagnostics: (
    _iteration: number,
    _summary: RobustWeightSummary,
    _finalWeightDelta: number,
  ) => void;
  weightedQuadratic: (_P: number[][], _v: number[][]) => number;
}
