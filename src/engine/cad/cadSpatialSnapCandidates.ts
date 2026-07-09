import { cadDistance, cadProjectPointOntoInfiniteLine, type CadWorldPoint } from './cadGeometry';
import type { CadSnapCandidate, CadSnapKind } from './cadTypes';
import {
  CONSTRUCTION_REFINEMENT_PRIORITY,
  NEAREST_PRIORITY_OVERRIDE_BLOCKED_KINDS,
  PROXIMITY_PRIORITY_OVERRIDE_KINDS,
  PROXIMITY_PRIORITY_OVERRIDE_RATIO,
  SNAP_PRIORITY,
} from './cadSpatialSnapConstants';

export const buildCandidate = (
  kind: CadSnapKind,
  sourceEntityId: string,
  point: CadWorldPoint,
  query: CadWorldPoint,
  label: string,
  guideSegments?: Array<[CadWorldPoint, CadWorldPoint]>,
  sourceSegmentId?: string,
  distanceOverride?: number,
  lockGuidePoint?: CadWorldPoint,
): CadSnapCandidate => ({
  id: `${kind}:${sourceEntityId}:${label}`,
  kind,
  sourceEntityId,
  sourceSegmentId,
  x: point.x,
  y: point.y,
  distance: distanceOverride ?? cadDistance(query, point),
  label,
  guideSegments,
  lockGuidePoint,
});

export const dedupeCandidates = (candidates: CadSnapCandidate[]): CadSnapCandidate[] => {
  const seen = new Set<string>();
  return candidates.filter((candidate) => {
    const key = `${candidate.kind}:${candidate.x.toFixed(9)}:${candidate.y.toFixed(9)}`;
    if (seen.has(key)) {
      return false;
    }
    seen.add(key);
    return true;
  });
};

export const candidateSort = (left: CadSnapCandidate, right: CadSnapCandidate): number => {
  if (Math.abs(left.distance - right.distance) > 1e-9) {
    const leftOverridesPriority =
      PROXIMITY_PRIORITY_OVERRIDE_KINDS.has(left.kind) &&
      !NEAREST_PRIORITY_OVERRIDE_BLOCKED_KINDS.has(right.kind) &&
      SNAP_PRIORITY[left.kind] > SNAP_PRIORITY[right.kind] &&
      left.distance <= right.distance * PROXIMITY_PRIORITY_OVERRIDE_RATIO;
    const rightOverridesPriority =
      PROXIMITY_PRIORITY_OVERRIDE_KINDS.has(right.kind) &&
      !NEAREST_PRIORITY_OVERRIDE_BLOCKED_KINDS.has(left.kind) &&
      SNAP_PRIORITY[right.kind] > SNAP_PRIORITY[left.kind] &&
      right.distance <= left.distance * PROXIMITY_PRIORITY_OVERRIDE_RATIO;
    if (leftOverridesPriority !== rightOverridesPriority) {
      return leftOverridesPriority ? -1 : 1;
    }
  }
  if (SNAP_PRIORITY[left.kind] !== SNAP_PRIORITY[right.kind]) {
    return SNAP_PRIORITY[left.kind] - SNAP_PRIORITY[right.kind];
  }
  if (Math.abs(left.distance - right.distance) > 1e-9) return left.distance - right.distance;
  return left.id.localeCompare(right.id, undefined, { numeric: true });
};

export const pointOnCandidateLine = (
  point: CadWorldPoint,
  candidate: CadSnapCandidate,
  toleranceWorld: number,
): boolean => {
  const constraintSegment = candidate.guideSegments?.[0];
  if (!constraintSegment) return false;
  const projection = cadProjectPointOntoInfiniteLine(point, constraintSegment[0], constraintSegment[1]).point;
  return cadDistance(point, projection) <= Math.max(toleranceWorld * 0.08, 1e-6);
};

export const mergeGuideSegments = (
  primary: CadSnapCandidate,
  secondary: CadSnapCandidate,
): Array<[CadWorldPoint, CadWorldPoint]> | undefined => {
  const seen = new Set<string>();
  const merged = [...(primary.guideSegments ?? []), ...(secondary.guideSegments ?? [])].filter((segment) => {
    const key = `${segment[0].x.toFixed(9)}:${segment[0].y.toFixed(9)}:${segment[1].x.toFixed(9)}:${segment[1].y.toFixed(9)}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
  return merged.length > 0 ? merged : undefined;
};

export const buildCompoundConstructionCandidate = (
  primary: CadSnapCandidate,
  secondary: CadSnapCandidate,
): CadSnapCandidate => ({
  ...secondary,
  id: `${primary.id}|${secondary.id}`,
  kind: primary.kind,
  sourceEntityId: `${primary.sourceEntityId}|${secondary.sourceEntityId}`,
  label: `${primary.label} + ${secondary.label}`,
  guideSegments: mergeGuideSegments(primary, secondary),
  compoundKinds: [primary.kind, secondary.kind],
  lockGuidePoint: primary.lockGuidePoint,
});

export const compoundCandidateSort = (left: CadSnapCandidate, right: CadSnapCandidate): number => {
  if (CONSTRUCTION_REFINEMENT_PRIORITY[left.kind] !== CONSTRUCTION_REFINEMENT_PRIORITY[right.kind]) {
    return CONSTRUCTION_REFINEMENT_PRIORITY[left.kind] - CONSTRUCTION_REFINEMENT_PRIORITY[right.kind];
  }
  if (Math.abs(left.distance - right.distance) > 1e-9) return left.distance - right.distance;
  return left.id.localeCompare(right.id, undefined, { numeric: true });
};
