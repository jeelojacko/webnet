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

export interface CadCircleRef {
  sourceEntityId: string;
  center: CadWorldPoint;
  radius: number;
  label: string;
}

export interface CadArcRef {
  sourceEntityId: string;
  /**
   * Phase C2: exact polyline/feature-line course identity (`${entity.id}#i`)
   * when this arc is one course of a multi-course entity. Standalone
   * `CadArcEntity` refs leave it absent (legacy shape); consumers must fall
   * back to `sourceEntityId` only when no segment id is supplied.
   */
  segmentId?: string;
  center: CadWorldPoint;
  radius: number;
  startAngleDeg: number;
  endAngleDeg: number;
  startPoint: CadWorldPoint;
  endPoint: CadWorldPoint;
  label: string;
}
