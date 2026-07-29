import type {
  CadAlignmentElement,
  CadArcEntity,
  CadDisplayPoint,
  CadEntityId,
  CadLineEntity,
} from './cadTypes';

export type CadAlignmentSourceEntity = CadLineEntity | CadArcEntity;

export interface CadAlignmentTraversalCandidate {
  entity: CadAlignmentSourceEntity;
  start: CadDisplayPoint;
  end: CadDisplayPoint;
  startKey: string;
  endKey: string;
}

export interface CadAlignmentNode {
  key: string;
  point: CadDisplayPoint;
  incidentEntityIds: CadEntityId[];
}

export interface CadAlignmentDraft {
  elements: CadAlignmentElement[];
  startPoint: CadDisplayPoint;
  endPoint: CadDisplayPoint;
  totalLength: number;
  sourceEntityIds: CadEntityId[];
}

export interface CadAlignmentProjection {
  point: CadDisplayPoint;
  station: number;
  offset: number;
  elementIndex: number;
  elementKind: CadAlignmentElement['kind'];
}

export interface CadAlignmentStationOffsetPoint {
  point: CadDisplayPoint;
  station: number;
  offset: number;
  elementIndex: number;
  elementKind: CadAlignmentElement['kind'];
}

export interface CadAlignmentStationPoint {
  point: CadDisplayPoint;
  station: number;
}
