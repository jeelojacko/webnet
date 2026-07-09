import type {
  CadBounds,
  CadSnapCandidate,
  CadSnapConstructionContext,
  CadSnapKind,
} from './cadTypes';
import type { CadWorldPoint } from './cadGeometry';

export interface CadSpatialIndex {
  querySnapCandidates: (
    _worldPoint: CadWorldPoint,
    _toleranceWorld: number,
    _allowedKinds?: readonly CadSnapKind[],
    _constructionContext?: CadSnapConstructionContext,
    _visibleBounds?: CadBounds | null,
  ) => CadSnapCandidate[];
  queryNearestSnap: (
    _worldPoint: CadWorldPoint,
    _toleranceWorld: number,
    _allowedKinds?: readonly CadSnapKind[],
    _constructionContext?: CadSnapConstructionContext,
    _visibleBounds?: CadBounds | null,
  ) => CadSnapCandidate | null;
}

export interface CadSegmentRef {
  segmentId: string;
  sourceEntityId: string;
  start: CadWorldPoint;
  end: CadWorldPoint;
  startLabel: string;
  endLabel: string;
  label: string;
}

export interface CadArcRef {
  sourceEntityId: string;
  center: CadWorldPoint;
  radius: number;
  startAngleDeg: number;
  endAngleDeg: number;
  startPoint: CadWorldPoint;
  endPoint: CadWorldPoint;
  label: string;
}
