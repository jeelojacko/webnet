import {
  cadArcMidpoint,
  cadClosestPointOnSegment,
  cadClosestPointOnArc,
  cadDistance,
  cadInfiniteLineIntersection,
  cadIntersectArcArc,
  cadIntersectCircleCircle,
  cadIntersectInfiniteLineArc,
  cadIntersectSegmentArc,
  cadMidpoint,
  cadPointOnCircle,
  cadProjectPointOntoInfiniteLine,
  cadSegmentIntersection,
  cadTangentPointsFromExternalPointToArc,
  cadIsAngleOnArcSweep,
  type CadWorldPoint,
} from './cadGeometry';
import { getCadEntityDisplayLabel, getCadEntitySubpartDisplayLabel } from './cadEntityNames';
import type {
  CadArcEntity,
  CadBounds,
  CadLineEntity,
  CadParcelEntity,
  CadPolygonEntity,
  CadPolylineEntity,
  CadProject,
  CadSnapCandidate,
  CadSnapConstructionContext,
  CadSnapKind,
} from './cadTypes';

const SNAP_PRIORITY: Record<CadSnapKind, number> = {
  endpoint: 0,
  'point-node': 1,
  midpoint: 2,
  'arc-midpoint': 3,
  center: 4,
  quadrant: 5,
  intersection: 6,
  'apparent-intersection': 7,
  extension: 8,
  perpendicular: 9,
  parallel: 10,
  tangent: 11,
  direction: 12,
  nearest: 13,
};

const PROXIMITY_PRIORITY_OVERRIDE_KINDS = new Set<CadSnapKind>(['nearest']);
const PROXIMITY_PRIORITY_OVERRIDE_RATIO = 0.5;
const NEAREST_PRIORITY_OVERRIDE_BLOCKED_KINDS = new Set<CadSnapKind>(['tangent', 'intersection']);

const SNAP_RANGE_MULTIPLIER: Record<CadSnapKind, number> = {
  endpoint: 0.85,
  'point-node': 0.8,
  midpoint: 0.72,
  'arc-midpoint': 0.72,
  center: 0.65,
  quadrant: 0.65,
  intersection: 0.9,
  'apparent-intersection': 0.6,
  extension: 0.6,
  perpendicular: 0.75,
  parallel: 0.8,
  tangent: 0.9,
  direction: 0.45,
  nearest: 1,
};

const CONSTRUCTION_LOCK_KINDS: CadSnapKind[] = ['extension', 'perpendicular', 'parallel', 'tangent'];
const CONSTRUCTION_REFINEMENT_PRIORITY: Record<CadSnapKind, number> = {
  intersection: 0,
  'apparent-intersection': 1,
  endpoint: 2,
  'point-node': 3,
  midpoint: 4,
  'arc-midpoint': 5,
  center: 6,
  quadrant: 7,
  extension: 8,
  perpendicular: 9,
  parallel: 10,
  tangent: 11,
  direction: 12,
  nearest: 13,
};

const DIRECTION_SNAPS = [
  { azimuthDeg: 0, label: 'N' },
  { azimuthDeg: 45, label: 'NE' },
  { azimuthDeg: 90, label: 'E' },
  { azimuthDeg: 135, label: 'SE' },
  { azimuthDeg: 180, label: 'S' },
  { azimuthDeg: 225, label: 'SW' },
  { azimuthDeg: 270, label: 'W' },
  { azimuthDeg: 315, label: 'NW' },
] as const;

const buildCandidate = (
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

interface CadSegmentRef {
  segmentId: string;
  sourceEntityId: string;
  start: CadWorldPoint;
  end: CadWorldPoint;
  startLabel: string;
  endLabel: string;
  label: string;
}

interface CadArcRef {
  sourceEntityId: string;
  center: CadWorldPoint;
  radius: number;
  startAngleDeg: number;
  endAngleDeg: number;
  startPoint: CadWorldPoint;
  endPoint: CadWorldPoint;
  label: string;
}

const lineSegments = (line: CadLineEntity): CadSegmentRef[] => [
  {
    segmentId: `${line.id}#0`,
    sourceEntityId: line.id,
    start: { x: line.fromX, y: line.fromY },
    end: { x: line.toX, y: line.toY },
    startLabel: line.fromStationId,
    endLabel: line.toStationId,
    label: `${line.fromStationId}-${line.toStationId}`,
  },
];

const vertexEntitySegments = (
  entity: CadPolylineEntity | CadPolygonEntity | CadParcelEntity,
): CadSegmentRef[] => {
  const points =
    entity.type === 'polyline'
      ? entity.vertices
      : [...entity.vertices, entity.vertices[0]].filter(
          (point): point is CadSegmentRef['start'] => point != null,
        );
  return points.slice(0, -1).map((vertex, index) => ({
    segmentId: `${entity.id}#${index}`,
    sourceEntityId: entity.id,
    start: vertex,
    end: points[index + 1]!,
    startLabel: entity.vertexLabels[index] ?? `V${index + 1}`,
    endLabel: entity.vertexLabels[index + 1] ?? `V${index + 2}`,
    label: `${entity.vertexLabels[index] ?? `V${index + 1}`}-${entity.vertexLabels[index + 1] ?? `V${index + 2}`}`,
  }));
};

const entitySegments = (entity: CadLineEntity | CadPolylineEntity | CadPolygonEntity | CadParcelEntity): CadSegmentRef[] =>
  entity.type === 'line' ? lineSegments(entity) : vertexEntitySegments(entity);

const arcRefFromEntity = (project: CadProject, entity: CadArcEntity): CadArcRef => ({
  sourceEntityId: entity.id,
  center: { x: entity.centerX, y: entity.centerY },
  radius: entity.radius,
  startAngleDeg: entity.startAngleDeg,
  endAngleDeg: entity.endAngleDeg,
  startPoint: cadPointOnCircle({ x: entity.centerX, y: entity.centerY }, entity.radius, entity.startAngleDeg),
  endPoint: cadPointOnCircle({ x: entity.centerX, y: entity.centerY }, entity.radius, entity.endAngleDeg),
  label: getCadEntityDisplayLabel(entity),
});

const dedupeCandidates = (candidates: CadSnapCandidate[]): CadSnapCandidate[] => {
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

const candidateSort = (left: CadSnapCandidate, right: CadSnapCandidate): number => {
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

const pointOnCandidateLine = (
  point: CadWorldPoint,
  candidate: CadSnapCandidate,
  toleranceWorld: number,
): boolean => {
  const constraintSegment = candidate.guideSegments?.[0];
  if (!constraintSegment) return false;
  const projection = cadProjectPointOntoInfiniteLine(point, constraintSegment[0], constraintSegment[1]).point;
  return cadDistance(point, projection) <= Math.max(toleranceWorld * 0.08, 1e-6);
};

const mergeGuideSegments = (
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

const buildCompoundConstructionCandidate = (
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

const compoundCandidateSort = (left: CadSnapCandidate, right: CadSnapCandidate): number => {
  if (CONSTRUCTION_REFINEMENT_PRIORITY[left.kind] !== CONSTRUCTION_REFINEMENT_PRIORITY[right.kind]) {
    return CONSTRUCTION_REFINEMENT_PRIORITY[left.kind] - CONSTRUCTION_REFINEMENT_PRIORITY[right.kind];
  }
  if (Math.abs(left.distance - right.distance) > 1e-9) return left.distance - right.distance;
  return left.id.localeCompare(right.id, undefined, { numeric: true });
};

const buildExtensionCandidate = (
  segment: CadSegmentRef,
  worldPoint: CadWorldPoint,
): CadWorldPoint | null => {
  const projection = cadProjectPointOntoInfiniteLine(worldPoint, segment.start, segment.end);
  if (projection.t >= -1e-9 && projection.t <= 1 + 1e-9) return null;
  return projection.point;
};

const buildParallelCandidate = (
  segment: CadSegmentRef,
  basePoint: CadWorldPoint,
  worldPoint: CadWorldPoint,
): CadWorldPoint | null => {
  const directionEnd = {
    x: basePoint.x + (segment.end.x - segment.start.x),
    y: basePoint.y + (segment.end.y - segment.start.y),
  };
  const projection = cadProjectPointOntoInfiniteLine(worldPoint, basePoint, directionEnd);
  return projection.point;
};

const buildPerpendicularThroughBaseCandidate = (
  segment: CadSegmentRef,
  basePoint: CadWorldPoint,
  worldPoint: CadWorldPoint,
): CadWorldPoint | null => {
  const dx = segment.end.x - segment.start.x;
  const dy = segment.end.y - segment.start.y;
  if (Math.hypot(dx, dy) <= 1e-9) return null;
  const directionEnd = {
    x: basePoint.x - dy,
    y: basePoint.y + dx,
  };
  return cadProjectPointOntoInfiniteLine(worldPoint, basePoint, directionEnd).point;
};

const buildTangentThroughArcPointCandidate = (
  arc: CadArcRef,
  basePoint: CadWorldPoint,
  worldPoint: CadWorldPoint,
): CadWorldPoint | null => {
  const radialDx = basePoint.x - arc.center.x;
  const radialDy = basePoint.y - arc.center.y;
  if (Math.hypot(radialDx, radialDy) <= 1e-9) return null;
  const tangentDirectionPoint = {
    x: basePoint.x - radialDy,
    y: basePoint.y + radialDx,
  };
  return cadProjectPointOntoInfiniteLine(worldPoint, basePoint, tangentDirectionPoint).point;
};

const cadAzimuthFromPoint = (
  from: CadWorldPoint,
  to: CadWorldPoint,
): number => {
  const dx = to.x - from.x;
  const dy = to.y - from.y;
  return ((Math.atan2(dx, dy) * 180) / Math.PI + 360) % 360;
};

const buildDirectionCandidate = (
  basePoint: CadWorldPoint,
  worldPoint: CadWorldPoint,
): { point: CadWorldPoint; azimuthDeg: number; label: string } | null => {
  if (cadDistance(basePoint, worldPoint) <= 1e-9) return null;
  const azimuthDeg = cadAzimuthFromPoint(basePoint, worldPoint);
  const snapped = DIRECTION_SNAPS.reduce((best, current) => {
    const delta = Math.abs((((azimuthDeg - current.azimuthDeg) % 360) + 540) % 360 - 180);
    if (!best || delta < best.delta) {
      return { ...current, delta };
    }
    return best;
  }, null as ({ azimuthDeg: number; label: string; delta: number } | null));
  if (!snapped) return null;
  const direction = {
    x: Math.sin((snapped.azimuthDeg * Math.PI) / 180),
    y: Math.cos((snapped.azimuthDeg * Math.PI) / 180),
  };
  const distanceAlong = Math.max(
    0,
    (worldPoint.x - basePoint.x) * direction.x + (worldPoint.y - basePoint.y) * direction.y,
  );
  return {
    point: {
      x: basePoint.x + direction.x * distanceAlong,
      y: basePoint.y + direction.y * distanceAlong,
    },
    azimuthDeg: snapped.azimuthDeg,
    label: snapped.label,
  };
};

const buildPerpendicularThroughTangentSeedCandidate = (
  arc: CadArcRef,
  tangentSeedPoint: CadWorldPoint,
  worldPoint: CadWorldPoint,
): CadWorldPoint | null => {
  if (cadDistance(tangentSeedPoint, arc.center) <= 1e-9) return null;
  return cadProjectPointOntoInfiniteLine(worldPoint, tangentSeedPoint, arc.center).point;
};

const buildLockedConstructionPoint = (
  kind: 'extension' | 'perpendicular' | 'parallel',
  segment: CadSegmentRef,
  basePoint: CadWorldPoint,
  worldPoint: CadWorldPoint,
): CadWorldPoint | null => {
  if (kind === 'extension') {
    return cadProjectPointOntoInfiniteLine(worldPoint, segment.start, segment.end).point;
  }
  if (kind === 'parallel') {
    return buildParallelCandidate(segment, basePoint, worldPoint);
  }
  const foot = cadProjectPointOntoInfiniteLine(basePoint, segment.start, segment.end).point;
  if (cadDistance(basePoint, foot) <= 1e-9) {
    return buildPerpendicularThroughBaseCandidate(segment, basePoint, worldPoint);
  }
  return cadProjectPointOntoInfiniteLine(worldPoint, basePoint, foot).point;
};

const isPointOnSegment = (
  point: CadWorldPoint,
  start: CadWorldPoint,
  end: CadWorldPoint,
  tolerance = 1e-6,
): boolean => {
  const projection = cadProjectPointOntoInfiniteLine(point, start, end);
  return projection.t >= -tolerance && projection.t <= 1 + tolerance && cadDistance(point, projection.point) <= tolerance;
};

const buildLockedLineIntersectionCandidates = (
  basePoint: CadWorldPoint,
  lockedLinePoint: CadWorldPoint,
  worldPoint: CadWorldPoint,
  segments: CadSegmentRef[],
  arcs: CadArcRef[],
  lockedKind: 'perpendicular' | 'parallel' | 'tangent',
  lockedSourceEntityId: string,
): CadSnapCandidate[] => {
  if (cadDistance(basePoint, lockedLinePoint) <= 1e-9) return [];
  const candidates: CadSnapCandidate[] = [];

  segments.forEach((segment) => {
    const intersection = cadInfiniteLineIntersection(basePoint, lockedLinePoint, segment.start, segment.end);
    if (!intersection || pointMatches(intersection, basePoint) || !isPointOnSegment(intersection, segment.start, segment.end)) {
      return;
    }
    const distanceOverride = cadDistance(worldPoint, cadClosestPointOnSegment(worldPoint, segment.start, segment.end));
    candidates.push(
      buildCandidate(
        'intersection',
        `${lockedSourceEntityId}|${segment.sourceEntityId}`,
        intersection,
        worldPoint,
        `${segment.label} locked`,
        [
          [basePoint, intersection],
          [segment.start, segment.end],
        ],
        segment.segmentId,
        distanceOverride,
      ),
    );
  });

  arcs.forEach((arc) => {
    cadIntersectInfiniteLineArc(
      basePoint,
      lockedLinePoint,
      arc.center,
      arc.radius,
      arc.startAngleDeg,
      arc.endAngleDeg,
    ).forEach((intersection) => {
      if (pointMatches(intersection, basePoint)) return;
      const distanceOverride = cadDistance(
        worldPoint,
        cadClosestPointOnArc(worldPoint, arc.center, arc.radius, arc.startAngleDeg, arc.endAngleDeg),
      );
      candidates.push(
        buildCandidate(
          'intersection',
          `${lockedSourceEntityId}|${arc.sourceEntityId}`,
          intersection,
          worldPoint,
          `${arc.label} locked`,
          [
            [basePoint, intersection],
            [arc.center, intersection],
          ],
          undefined,
          distanceOverride,
        ),
      );
    });
  });

  return candidates.filter((candidate) => candidate.kind !== lockedKind);
};

const nearestSegmentEndpointToPoint = (
  segment: CadSegmentRef,
  point: CadWorldPoint,
): CadWorldPoint =>
  cadDistance(segment.start, point) <= cadDistance(segment.end, point) ? segment.start : segment.end;

const nearestArcEndpointToPoint = (
  arc: CadArcRef,
  point: CadWorldPoint,
): CadWorldPoint =>
  cadDistance(arc.startPoint, point) <= cadDistance(arc.endPoint, point) ? arc.startPoint : arc.endPoint;

const sourceEntityIdIncludedInCandidate = (candidate: CadSnapCandidate, sourceEntityId: string): boolean =>
  candidate.sourceEntityId.split('|').includes(sourceEntityId);

const candidateMatchesLockedSnap = (
  candidate: CadSnapCandidate,
  lockedSnap: CadSnapConstructionContext['lockedSnap'] | null | undefined,
): boolean => {
  if (!lockedSnap || candidate.kind !== lockedSnap.kind) return false;
  if (lockedSnap.sourceSegmentId != null) {
    return candidate.sourceSegmentId === lockedSnap.sourceSegmentId;
  }
  return sourceEntityIdIncludedInCandidate(candidate, lockedSnap.sourceEntityId);
};

const endpointKey = (point: CadWorldPoint): string => `${point.x.toFixed(6)}:${point.y.toFixed(6)}`;

const pointMatches = (left: CadWorldPoint, right: CadWorldPoint, tolerance = 1e-6): boolean =>
  cadDistance(left, right) <= tolerance;

const segmentPathObstructed = (
  pathStart: CadWorldPoint,
  pathEnd: CadWorldPoint,
  segments: CadSegmentRef[],
  ignoredSegmentIds: Set<string>,
): boolean =>
  segments.some((segment) => {
    if (ignoredSegmentIds.has(segment.segmentId)) return false;
    const intersection = cadSegmentIntersection(pathStart, pathEnd, segment.start, segment.end);
    if (!intersection) return false;
    return !pointMatches(intersection, pathStart) && !pointMatches(intersection, pathEnd);
  });

const buildScopedSegmentIds = (
  segments: CadSegmentRef[],
  basePoint: CadWorldPoint | null,
  seedSegmentId: string | null | undefined,
  maxDepth: number,
): Set<string> | null => {
  if (!basePoint && !seedSegmentId) return null;
  const segmentsById = new Map(segments.map((segment) => [segment.segmentId, segment]));
  const endpointSegments = new Map<string, string[]>();
  segments.forEach((segment) => {
    [segment.start, segment.end].forEach((point) => {
      const key = endpointKey(point);
      const atPoint = endpointSegments.get(key);
      if (atPoint) {
        atPoint.push(segment.segmentId);
      } else {
        endpointSegments.set(key, [segment.segmentId]);
      }
    });
  });

  const pointSeedIds = basePoint
    ? segments
    .filter((segment) => pointMatches(basePoint, segment.start) || pointMatches(basePoint, segment.end))
    .map((segment) => segment.segmentId)
    : [];
  const seedIds = [...new Set([...(seedSegmentId ? [seedSegmentId] : []), ...pointSeedIds])];
  if (seedIds.length === 0) return null;

  const visited = new Set<string>();
  const queue = seedIds.map((segmentId) => ({ segmentId, depth: 0 }));
  while (queue.length > 0) {
    const current = queue.shift();
    if (!current || visited.has(current.segmentId)) continue;
    visited.add(current.segmentId);
    if (current.depth >= maxDepth) continue;
    const segment = segmentsById.get(current.segmentId);
    if (!segment) continue;
    [segment.start, segment.end].forEach((point) => {
      (endpointSegments.get(endpointKey(point)) ?? []).forEach((neighborId) => {
        if (!visited.has(neighborId)) {
          queue.push({ segmentId: neighborId, depth: current.depth + 1 });
        }
      });
    });
  }
  return visited;
};

const scopeAllowsSegment = (
  scope: Set<string> | null,
  segmentId: string,
  requireScope: boolean,
): boolean => {
  if (scope) return scope.has(segmentId);
  return !requireScope;
};

const expandBounds = (bounds: CadBounds, padding: number): CadBounds => ({
  minX: bounds.minX - padding,
  minY: bounds.minY - padding,
  maxX: bounds.maxX + padding,
  maxY: bounds.maxY + padding,
});

const pointInsideBounds = (point: CadWorldPoint, bounds: CadBounds): boolean =>
  point.x >= bounds.minX && point.x <= bounds.maxX && point.y >= bounds.minY && point.y <= bounds.maxY;

const segmentIntersectsBounds = (
  start: CadWorldPoint,
  end: CadWorldPoint,
  bounds: CadBounds,
): boolean => {
  if (pointInsideBounds(start, bounds) || pointInsideBounds(end, bounds)) return true;
  const minX = Math.min(start.x, end.x);
  const maxX = Math.max(start.x, end.x);
  const minY = Math.min(start.y, end.y);
  const maxY = Math.max(start.y, end.y);
  return !(maxX < bounds.minX || minX > bounds.maxX || maxY < bounds.minY || minY > bounds.maxY);
};

const arcIntersectsBounds = (arc: CadArcRef, bounds: CadBounds): boolean => {
  const minX = arc.center.x - arc.radius;
  const maxX = arc.center.x + arc.radius;
  const minY = arc.center.y - arc.radius;
  const maxY = arc.center.y + arc.radius;
  return !(maxX < bounds.minX || minX > bounds.maxX || maxY < bounds.minY || minY > bounds.maxY);
};

const entityIntersectsBounds = (
  project: CadProject,
  entity: CadProject['entities'][number],
  bounds: CadBounds,
): boolean => {
  switch (entity.type) {
    case 'survey-point':
      return pointInsideBounds({ x: entity.x, y: entity.y }, bounds);
    case 'line':
      return segmentIntersectsBounds(
        { x: entity.fromX, y: entity.fromY },
        { x: entity.toX, y: entity.toY },
        bounds,
      );
    case 'polyline':
    case 'polygon':
    case 'parcel': {
      const points =
        entity.type === 'polyline'
          ? entity.vertices
          : [...entity.vertices, entity.vertices[0]].filter(
              (point): point is CadWorldPoint => point != null,
            );
      return points.slice(0, -1).some((point, index) =>
        segmentIntersectsBounds(point, points[index + 1]!, bounds),
      );
    }
    case 'arc':
      return arcIntersectsBounds(arcRefFromEntity(project, entity), bounds);
    case 'text':
      return pointInsideBounds({ x: entity.x, y: entity.y }, bounds);
    case 'error-ellipse':
      return !(
        entity.centerX + entity.semiMajor < bounds.minX ||
        entity.centerX - entity.semiMajor > bounds.maxX ||
        entity.centerY + entity.semiMajor < bounds.minY ||
        entity.centerY - entity.semiMajor > bounds.maxY
      );
    default:
      return true;
  }
};

export const buildCadSpatialIndex = (project: CadProject): CadSpatialIndex => {
  const querySnapCandidates = (
    worldPoint: CadWorldPoint,
    toleranceWorld: number,
    allowedKinds: readonly CadSnapKind[] = [
      'point-node',
      'endpoint',
      'midpoint',
      'center',
      'arc-midpoint',
      'quadrant',
      'intersection',
      'apparent-intersection',
      'extension',
      'perpendicular',
      'parallel',
      'tangent',
      'nearest',
    ],
    constructionContext: CadSnapConstructionContext = { active: false, basePoint: null },
    visibleBounds: CadBounds | null = null,
  ): CadSnapCandidate[] => {
    const allowed = new Set(allowedKinds);
    const candidates: CadSnapCandidate[] = [];
    const visibleQueryBounds = visibleBounds ? expandBounds(visibleBounds, toleranceWorld * 1.5) : null;
    const visibleEntities = visibleQueryBounds
      ? project.entities.filter(
          (entity) => entity.visible && entityIntersectsBounds(project, entity, visibleQueryBounds),
        )
      : project.entities.filter((entity) => entity.visible);
    const segments = visibleEntities
      .filter((entity): entity is CadLineEntity | CadPolylineEntity | CadPolygonEntity | CadParcelEntity =>
        entity.type === 'line' ||
          entity.type === 'polyline' ||
          entity.type === 'polygon' ||
          entity.type === 'parcel',
      )
      .flatMap((entity) => entitySegments(entity));
    const arcs = visibleEntities
      .filter((entity): entity is CadArcEntity => entity.type === 'arc')
      .map((entity) => arcRefFromEntity(project, entity));
    const basePoint = constructionContext.active ? constructionContext.basePoint : null;
    const scopeSeedSegmentId = constructionContext.scopeSeedSegmentId ?? null;
    const scopeSeedSegment = scopeSeedSegmentId
      ? segments.find((segment) => segment.segmentId === scopeSeedSegmentId) ?? null
      : null;
    const tangentSeedArcEntityId = constructionContext.tangentSeedArcEntityId ?? null;
    const tangentSeedPoint = constructionContext.tangentSeedPoint ?? basePoint;
    const tangentSeedArc = tangentSeedArcEntityId
      ? arcs.find((arc) => arc.sourceEntityId === tangentSeedArcEntityId) ?? null
      : null;
    const hasPerpendicularStartSeed = scopeSeedSegment != null || tangentSeedArc != null;
    const parallelScope = constructionContext.active ? buildScopedSegmentIds(segments, basePoint, scopeSeedSegmentId, 1) : null;
    const extensionScope = constructionContext.active ? buildScopedSegmentIds(segments, basePoint, scopeSeedSegmentId, 2) : null;
    const apparentScope = constructionContext.active ? buildScopedSegmentIds(segments, basePoint, scopeSeedSegmentId, 2) : null;
    const requireExplicitScope = constructionContext.active && scopeSeedSegmentId != null;

    visibleEntities.forEach((entity) => {
      switch (entity.type) {
        case 'survey-point':
          if (allowed.has('point-node')) {
            candidates.push(
              buildCandidate('point-node', entity.id, { x: entity.x, y: entity.y }, worldPoint, entity.stationId),
            );
          }
          break;
        case 'line':
        case 'polyline':
        case 'polygon':
        case 'parcel':
          entitySegments(entity).forEach((segment) => {
            if (allowed.has('endpoint')) {
              candidates.push(
                buildCandidate('endpoint', entity.id, segment.start, worldPoint, segment.startLabel, undefined, segment.segmentId),
                buildCandidate('endpoint', entity.id, segment.end, worldPoint, segment.endLabel, undefined, segment.segmentId),
              );
            }
            if (allowed.has('midpoint')) {
              candidates.push(
                buildCandidate('midpoint', entity.id, cadMidpoint(segment.start, segment.end), worldPoint, segment.label, undefined, segment.segmentId),
              );
            }
            if (allowed.has('nearest')) {
              candidates.push(
                buildCandidate(
                  'nearest',
                  entity.id,
                  cadClosestPointOnSegment(worldPoint, segment.start, segment.end),
                  worldPoint,
                  segment.label,
                  undefined,
                  segment.segmentId,
                ),
              );
            }
            if (constructionContext.active && allowed.has('extension')) {
              if (!scopeAllowsSegment(extensionScope, segment.segmentId, requireExplicitScope)) {
                return;
              }
              const extensionPoint = buildExtensionCandidate(segment, worldPoint);
              if (extensionPoint) {
                const extensionAnchor = nearestSegmentEndpointToPoint(segment, extensionPoint);
                if (
                  segmentPathObstructed(
                    extensionAnchor,
                    extensionPoint,
                    segments,
                    new Set([segment.segmentId]),
                  )
                ) {
                  return;
                }
                candidates.push(
                  buildCandidate(
                    'extension',
                    entity.id,
                    extensionPoint,
                    worldPoint,
                    `${segment.label} ext`,
                    [[extensionAnchor, extensionPoint]],
                    segment.segmentId,
                  ),
                );
              }
            }
            if (
              constructionContext.active &&
              basePoint &&
              allowed.has('perpendicular') &&
              !hasPerpendicularStartSeed
            ) {
              const perpendicularPoint = cadProjectPointOntoInfiniteLine(basePoint, segment.start, segment.end).point;
              candidates.push(
                buildCandidate(
                  'perpendicular',
                  entity.id,
                  perpendicularPoint,
                  worldPoint,
                  `${segment.label} perp`,
                  [[basePoint, perpendicularPoint]],
                  segment.segmentId,
                  undefined,
                  perpendicularPoint,
                ),
              );
            }
            if (constructionContext.active && basePoint && allowed.has('parallel')) {
              if (!scopeAllowsSegment(parallelScope, segment.segmentId, true)) {
                return;
              }
              const parallelPoint = buildParallelCandidate(segment, basePoint, worldPoint);
              if (parallelPoint) {
                candidates.push(
                  buildCandidate(
                    'parallel',
                    entity.id,
                    parallelPoint,
                    worldPoint,
                    `${segment.label} parallel`,
                    [
                      [basePoint, parallelPoint],
                      [segment.start, segment.end],
                    ],
                    segment.segmentId,
                  ),
                );
              }
            }
          });
          break;
        case 'arc': {
          const arc = arcRefFromEntity(project, entity);
          if (allowed.has('endpoint')) {
            candidates.push(
              buildCandidate(
                'endpoint',
                entity.id,
                arc.startPoint,
                worldPoint,
                getCadEntitySubpartDisplayLabel(project, entity.id, 'arc-start'),
              ),
              buildCandidate(
                'endpoint',
                entity.id,
                arc.endPoint,
                worldPoint,
                getCadEntitySubpartDisplayLabel(project, entity.id, 'arc-end'),
              ),
            );
          }
          if (allowed.has('center')) {
            candidates.push(
              buildCandidate(
                'center',
                entity.id,
                arc.center,
                worldPoint,
                getCadEntitySubpartDisplayLabel(project, entity.id, 'center'),
              ),
            );
          }
          if (allowed.has('arc-midpoint')) {
            candidates.push(
              buildCandidate(
                'arc-midpoint',
                entity.id,
                cadArcMidpoint(arc.center, arc.radius, arc.startAngleDeg, arc.endAngleDeg),
                worldPoint,
                getCadEntitySubpartDisplayLabel(project, entity.id, 'arc-midpoint'),
              ),
            );
          }
          if (allowed.has('quadrant')) {
            [0, 90, 180, 270].forEach((angleDeg) => {
              if (!cadIsAngleOnArcSweep(angleDeg, arc.startAngleDeg, arc.endAngleDeg)) return;
              candidates.push(
                buildCandidate(
                  'quadrant',
                  entity.id,
                  cadPointOnCircle(arc.center, arc.radius, angleDeg),
                  worldPoint,
                  getCadEntitySubpartDisplayLabel(project, entity.id, 'quadrant', { quadrantAngleDeg: angleDeg }),
                ),
              );
            });
          }
          if (allowed.has('nearest')) {
            candidates.push(
              buildCandidate(
                'nearest',
                entity.id,
                cadClosestPointOnArc(worldPoint, arc.center, arc.radius, arc.startAngleDeg, arc.endAngleDeg),
                worldPoint,
                arc.label,
              ),
            );
          }
          if (
            constructionContext.active &&
            basePoint &&
            allowed.has('perpendicular') &&
            !hasPerpendicularStartSeed
          ) {
            candidates.push(
                buildCandidate(
                  'perpendicular',
                  entity.id,
                  cadClosestPointOnArc(basePoint, arc.center, arc.radius, arc.startAngleDeg, arc.endAngleDeg),
                  worldPoint,
                  `${arc.label} perp`,
                  [
                    [basePoint, cadClosestPointOnArc(basePoint, arc.center, arc.radius, arc.startAngleDeg, arc.endAngleDeg)],
                    [arc.center, cadClosestPointOnArc(basePoint, arc.center, arc.radius, arc.startAngleDeg, arc.endAngleDeg)],
                  ],
                ),
              );
            }
          if (constructionContext.active && basePoint && allowed.has('tangent')) {
            cadTangentPointsFromExternalPointToArc(
              basePoint,
              arc.center,
              arc.radius,
              arc.startAngleDeg,
              arc.endAngleDeg,
            ).forEach((tangentPoint) => {
              const tangentLineDistance = cadDistance(
                worldPoint,
                cadProjectPointOntoInfiniteLine(worldPoint, basePoint, tangentPoint).point,
              );
              candidates.push(
                buildCandidate(
                  'tangent',
                  entity.id,
                  tangentPoint,
                  worldPoint,
                  `${arc.label} tangent`,
                  [
                    [basePoint, tangentPoint],
                    [arc.center, tangentPoint],
                  ],
                  undefined,
                  tangentLineDistance,
                  tangentPoint,
                ),
              );
            });
          }
          break;
        }
        default:
          break;
      }
    });

    if (constructionContext.active && basePoint && scopeSeedSegment && allowed.has('perpendicular')) {
      const startPerpendicularPoint = buildPerpendicularThroughBaseCandidate(scopeSeedSegment, basePoint, worldPoint);
      if (startPerpendicularPoint) {
        candidates.push(
          buildCandidate(
            'perpendicular',
            scopeSeedSegment.sourceEntityId,
            startPerpendicularPoint,
            worldPoint,
            `${scopeSeedSegment.label} start perp`,
            [
              [basePoint, startPerpendicularPoint],
              [scopeSeedSegment.start, scopeSeedSegment.end],
            ],
            scopeSeedSegment.segmentId,
            undefined,
            cadProjectPointOntoInfiniteLine(basePoint, scopeSeedSegment.start, scopeSeedSegment.end).point,
          ),
        );
      }
    }

    if (constructionContext.active && tangentSeedArc && tangentSeedPoint && allowed.has('perpendicular')) {
      const curveStartPerpendicularPoint = buildPerpendicularThroughTangentSeedCandidate(
        tangentSeedArc,
        tangentSeedPoint,
        worldPoint,
      );
      if (curveStartPerpendicularPoint) {
        candidates.push(
          buildCandidate(
            'perpendicular',
            tangentSeedArc.sourceEntityId,
            curveStartPerpendicularPoint,
            worldPoint,
            `${tangentSeedArc.label} start perp`,
            [
              [tangentSeedPoint, curveStartPerpendicularPoint],
              [tangentSeedArc.center, tangentSeedPoint],
            ],
            undefined,
            undefined,
            tangentSeedArc.center,
          ),
        );
      }
    }

    if (constructionContext.active && basePoint && tangentSeedArc && allowed.has('tangent')) {
      const tangentPoint = buildTangentThroughArcPointCandidate(tangentSeedArc, basePoint, worldPoint);
      if (tangentPoint) {
        candidates.push(
          buildCandidate(
            'tangent',
            tangentSeedArc.sourceEntityId,
            tangentPoint,
            worldPoint,
            `${tangentSeedArc.label} tangent`,
            [
              [basePoint, tangentPoint],
              [tangentSeedArc.center, basePoint],
            ],
            undefined,
            undefined,
            tangentPoint,
          ),
        );
      }
    }

    if (constructionContext.active && basePoint && allowed.has('direction')) {
      const directionSnap = buildDirectionCandidate(basePoint, worldPoint);
      if (directionSnap) {
        candidates.push(
          buildCandidate(
            'direction',
            'direction-guide',
            directionSnap.point,
            worldPoint,
            `${directionSnap.label} ${directionSnap.azimuthDeg.toString().padStart(3, '0')}°`,
            [[basePoint, directionSnap.point]],
          ),
        );
      }
    }

    if (allowed.has('intersection')) {
      for (let leftIndex = 0; leftIndex < segments.length; leftIndex += 1) {
        for (let rightIndex = leftIndex + 1; rightIndex < segments.length; rightIndex += 1) {
          const left = segments[leftIndex];
          const right = segments[rightIndex];
          const intersection = cadSegmentIntersection(left.start, left.end, right.start, right.end);
          if (!intersection) continue;
          candidates.push(
            buildCandidate(
              'intersection',
              `${left.sourceEntityId}|${right.sourceEntityId}`,
              intersection,
              worldPoint,
              `${left.label} x ${right.label}`,
            ),
          );
        }
      }
      segments.forEach((segment) => {
        arcs.forEach((arc) => {
          cadIntersectSegmentArc(
            segment.start,
            segment.end,
            arc.center,
            arc.radius,
            arc.startAngleDeg,
            arc.endAngleDeg,
          ).forEach((intersection) => {
            candidates.push(
              buildCandidate(
                'intersection',
                `${segment.sourceEntityId}|${arc.sourceEntityId}`,
                intersection,
                worldPoint,
                `${segment.label} x ${arc.label}`,
              ),
            );
          });
        });
      });
      for (let leftIndex = 0; leftIndex < arcs.length; leftIndex += 1) {
        for (let rightIndex = leftIndex + 1; rightIndex < arcs.length; rightIndex += 1) {
          const left = arcs[leftIndex];
          const right = arcs[rightIndex];
          cadIntersectArcArc(
            left.center,
            left.radius,
            left.startAngleDeg,
            left.endAngleDeg,
            right.center,
            right.radius,
            right.startAngleDeg,
            right.endAngleDeg,
          ).forEach((intersection) => {
            candidates.push(
              buildCandidate(
                'intersection',
                `${left.sourceEntityId}|${right.sourceEntityId}`,
                intersection,
                worldPoint,
                `${left.label} x ${right.label}`,
              ),
            );
          });
        }
      }
    }
    if (constructionContext.active && allowed.has('apparent-intersection')) {
      for (let leftIndex = 0; leftIndex < segments.length; leftIndex += 1) {
        for (let rightIndex = leftIndex + 1; rightIndex < segments.length; rightIndex += 1) {
          const left = segments[leftIndex];
          const right = segments[rightIndex];
          if (
            !scopeAllowsSegment(apparentScope, left.segmentId, requireExplicitScope) ||
            !scopeAllowsSegment(apparentScope, right.segmentId, requireExplicitScope)
          ) {
            continue;
          }
          if (cadSegmentIntersection(left.start, left.end, right.start, right.end)) continue;
          const intersection = cadInfiniteLineIntersection(left.start, left.end, right.start, right.end);
          if (!intersection) continue;
          const leftAnchor = nearestSegmentEndpointToPoint(left, intersection);
          const rightAnchor = nearestSegmentEndpointToPoint(right, intersection);
          if (
            segmentPathObstructed(leftAnchor, intersection, segments, new Set([left.segmentId, right.segmentId])) ||
            segmentPathObstructed(rightAnchor, intersection, segments, new Set([left.segmentId, right.segmentId]))
          ) {
            continue;
          }
          candidates.push(
            buildCandidate(
              'apparent-intersection',
              `${left.sourceEntityId}|${right.sourceEntityId}`,
              intersection,
              worldPoint,
              `${left.label} x ${right.label} apparent`,
              [
                [leftAnchor, intersection],
                [rightAnchor, intersection],
              ],
            ),
          );
        }
      }
      segments.forEach((segment) => {
        if (!scopeAllowsSegment(apparentScope, segment.segmentId, requireExplicitScope)) {
          return;
        }
        arcs.forEach((arc) => {
          const exactIntersections = cadIntersectSegmentArc(
            segment.start,
            segment.end,
            arc.center,
            arc.radius,
            arc.startAngleDeg,
            arc.endAngleDeg,
          );
          cadIntersectInfiniteLineArc(
            segment.start,
            segment.end,
            arc.center,
            arc.radius,
            arc.startAngleDeg,
            arc.endAngleDeg,
          )
            .filter((intersection) => !exactIntersections.some(
              (exact) =>
                Math.abs(exact.x - intersection.x) <= 1e-9 &&
                Math.abs(exact.y - intersection.y) <= 1e-9,
            ))
            .forEach((intersection) => {
              const segmentAnchor = nearestSegmentEndpointToPoint(segment, intersection);
              if (
                segmentPathObstructed(
                  segmentAnchor,
                  intersection,
                  segments,
                  new Set([segment.segmentId]),
                )
              ) {
                return;
              }
              candidates.push(
                buildCandidate(
                  'apparent-intersection',
                  `${segment.sourceEntityId}|${arc.sourceEntityId}`,
                  intersection,
                  worldPoint,
                  `${segment.label} x ${arc.label} apparent`,
                  [
                    [segmentAnchor, intersection],
                    [nearestArcEndpointToPoint(arc, intersection), intersection],
                  ],
                ),
              );
            });
        });
      });
      for (let leftIndex = 0; leftIndex < arcs.length; leftIndex += 1) {
        for (let rightIndex = leftIndex + 1; rightIndex < arcs.length; rightIndex += 1) {
          const left = arcs[leftIndex];
          const right = arcs[rightIndex];
          const exactIntersections = cadIntersectArcArc(
            left.center,
            left.radius,
            left.startAngleDeg,
            left.endAngleDeg,
            right.center,
            right.radius,
            right.startAngleDeg,
            right.endAngleDeg,
          );
          cadIntersectCircleCircle(left.center, left.radius, right.center, right.radius)
            .filter((intersection) => !exactIntersections.some(
              (exact) =>
                Math.abs(exact.x - intersection.x) <= 1e-9 &&
                Math.abs(exact.y - intersection.y) <= 1e-9,
            ))
            .forEach((intersection) => {
              candidates.push(
                buildCandidate(
                  'apparent-intersection',
                  `${left.sourceEntityId}|${right.sourceEntityId}`,
                  intersection,
                  worldPoint,
                  `${left.label} x ${right.label} apparent`,
                  [
                    [nearestArcEndpointToPoint(left, intersection), intersection],
                    [nearestArcEndpointToPoint(right, intersection), intersection],
                  ],
                ),
              );
            });
        }
      }
    }

    if (constructionContext.lockedSnap && basePoint) {
      const lockedSegment = segments.find(
        (segment) =>
          (constructionContext.lockedSnap?.sourceSegmentId != null &&
            segment.segmentId === constructionContext.lockedSnap.sourceSegmentId) ||
          segment.sourceEntityId === constructionContext.lockedSnap?.sourceEntityId,
      );
      const lockedArc =
        constructionContext.lockedSnap.kind === 'tangent' ||
        constructionContext.lockedSnap.kind === 'perpendicular'
          ? arcs.find((arc) => arc.sourceEntityId === constructionContext.lockedSnap?.sourceEntityId) ?? null
          : null;
      const tangentGuidePoint = constructionContext.lockedSnap.guidePoint ?? null;
      const lockedPoint =
        lockedArc && tangentGuidePoint
          ? cadProjectPointOntoInfiniteLine(worldPoint, basePoint, tangentGuidePoint).point
          : lockedSegment && constructionContext.lockedSnap.kind !== 'tangent'
            ? buildLockedConstructionPoint(
                constructionContext.lockedSnap.kind,
                lockedSegment,
                basePoint,
                worldPoint,
              )
            : null;
      if (lockedPoint) {
        const lockedSourceEntityId =
          constructionContext.lockedSnap.kind === 'tangent'
            ? lockedArc?.sourceEntityId ?? constructionContext.lockedSnap.sourceEntityId
            : lockedSegment?.sourceEntityId ?? constructionContext.lockedSnap.sourceEntityId;
        const lockedSourceEntity =
          project.entities.find((entity) => entity.id === lockedSourceEntityId) ?? null;
        const lockedSourceLabel = lockedArc?.label ?? (lockedSourceEntity ? getCadEntityDisplayLabel(lockedSourceEntity) : lockedSourceEntityId);
        const explicitLockedConstructionCandidate = buildCandidate(
          constructionContext.lockedSnap.kind,
          lockedSourceEntityId,
          lockedPoint,
          worldPoint,
          constructionContext.lockedSnap.kind === 'tangent'
            ? `${lockedSourceLabel} tangent`
            : `${lockedSegment?.label ?? lockedSourceLabel} ${
                constructionContext.lockedSnap.kind === 'extension'
                  ? 'ext'
                  : constructionContext.lockedSnap.kind === 'parallel'
                    ? 'parallel'
                    : 'perp'
              }`,
          constructionContext.lockedSnap.kind === 'tangent'
            ? [
                [basePoint, lockedPoint],
                ...(lockedArc ? [[lockedArc.center, tangentGuidePoint ?? lockedPoint] as [CadWorldPoint, CadWorldPoint]] : []),
              ]
            : lockedArc
              ? [
                  [basePoint, lockedPoint],
                  [lockedArc.center, basePoint],
                ]
            : [
                [basePoint, lockedPoint],
                [lockedSegment!.start, lockedSegment!.end],
              ],
          constructionContext.lockedSnap.sourceSegmentId,
          undefined,
          tangentGuidePoint ?? undefined,
        );
        candidates.push(explicitLockedConstructionCandidate);
        if (constructionContext.lockedSnap.kind !== 'extension') {
          candidates.push(
            ...buildLockedLineIntersectionCandidates(
              basePoint,
              lockedPoint,
              worldPoint,
              segments,
              arcs,
              constructionContext.lockedSnap.kind,
              lockedSourceEntityId,
            ),
          );
        }
      }
    }

    return dedupeCandidates(candidates)
      .filter(
        (candidate) =>
          candidate.distance <= toleranceWorld * SNAP_RANGE_MULTIPLIER[candidate.kind] ||
          candidateMatchesLockedSnap(candidate, constructionContext.lockedSnap),
      )
      .sort(candidateSort);
  };

  return {
    querySnapCandidates,
    queryNearestSnap: (
    worldPoint: CadWorldPoint,
    toleranceWorld: number,
    allowedKinds: readonly CadSnapKind[] = [
      'point-node',
      'endpoint',
      'midpoint',
      'center',
      'arc-midpoint',
      'quadrant',
      'intersection',
      'apparent-intersection',
      'extension',
      'perpendicular',
      'parallel',
      'tangent',
      'nearest',
    ],
    constructionContext: CadSnapConstructionContext = { active: false, basePoint: null },
    visibleBounds: CadBounds | null = null,
  ) => {
    const viable = querySnapCandidates(
      worldPoint,
      toleranceWorld,
      allowedKinds,
      constructionContext,
      visibleBounds,
    );
    const lockedConstructionCandidate =
      ((constructionContext.lockedSnap
        ? viable.find(
            (candidate) =>
              candidate.kind === constructionContext.lockedSnap?.kind &&
              candidateMatchesLockedSnap(candidate, constructionContext.lockedSnap),
          ) ?? null
        : null) ??
      viable.find((candidate) =>
        CONSTRUCTION_LOCK_KINDS.includes(candidate.kind),
      ) ??
      null);
    if (lockedConstructionCandidate) {
      const compoundCandidate = viable
        .filter((candidate) =>
          candidate.id !== lockedConstructionCandidate.id &&
          candidate.kind !== 'nearest' &&
          !CONSTRUCTION_LOCK_KINDS.includes(candidate.kind) &&
          pointOnCandidateLine(candidate, lockedConstructionCandidate, toleranceWorld),
        )
        .sort(compoundCandidateSort)[0];
      if (compoundCandidate) {
        return buildCompoundConstructionCandidate(lockedConstructionCandidate, compoundCandidate);
      }
    }
    return viable[0] ?? null;
    },
  };
};
