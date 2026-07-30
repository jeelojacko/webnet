import type { CadArcDefinition, CadNamedPoint } from './cadGeometry';
import type { CadCogoWarning } from './cadCogoTypes';
import type { CadDisplayPrimitive } from './cadTypes';

export type CadBatchCogoRowStatus = 'ok' | 'warning' | 'error';
export type CadBatchCogoRowKind = 'start' | 'line' | 'curve';
export type CadBatchCogoStartSource = 'selected' | 'input';

export interface CadBatchCogoPreviewRow {
  lineNumber: number;
  input: string;
  kind: CadBatchCogoRowKind;
  status: CadBatchCogoRowStatus;
  summary: string;
}

export interface CadBatchCogoLineOperation {
  kind: 'line';
  lineNumber: number;
  from: CadNamedPoint;
  to: CadNamedPoint;
  bearing: string;
  distance: number;
}

export interface CadBatchCogoCurveOperation {
  kind: 'curve';
  lineNumber: number;
  from: CadNamedPoint;
  to: CadNamedPoint;
  side: 'left' | 'right';
  radius: number;
  deltaDeg: number;
  definition: CadArcDefinition;
}

export type CadBatchCogoOperation = CadBatchCogoLineOperation | CadBatchCogoCurveOperation;

export interface CadBatchCogoDraft {
  sourceText: string;
  startPoint: CadNamedPoint | null;
  startPointSource: CadBatchCogoStartSource | null;
  endPoint: CadNamedPoint | null;
  operations: CadBatchCogoOperation[];
  previewRows: CadBatchCogoPreviewRow[];
  warnings: CadCogoWarning[];
  previewPrimitives: CadDisplayPrimitive[];
  generatedPointCount: number;
  generatedLineCount: number;
  generatedArcCount: number;
  canCommit: boolean;
}

export interface CadBatchCogoDraftOptions {
  sourceText: string;
  selectedStartPoint?: CadNamedPoint | null;
}

export type CadBatchParsedLine = {
  point: CadNamedPoint;
  bearing: string;
  distance: number;
};

export type CadBatchParsedCurve = {
  label?: string;
  side: 'left' | 'right';
  radius: number;
  deltaDeg: number;
};
