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

export interface ControlConstraintSummary {
  count: number;
  x: number;
  y: number;
  h: number;
  xyCorrelated: number;
}
