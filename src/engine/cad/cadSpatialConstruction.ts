import {
  cadClosestPointOnArc,
  cadClosestPointOnSegment,
  cadDistance,
  cadInfiniteLineIntersection,
  cadIntersectInfiniteLineArc,
  cadProjectPointOntoInfiniteLine,
  cadSegmentIntersection,
  type CadWorldPoint,
} from './cadGeometry';
import type { CadSnapCandidate, CadSnapConstructionContext } from './cadTypes';
import type { CadArcRef, CadSegmentRef } from './cadSpatialIndexTypes';
import { DIRECTION_SNAPS } from './cadSpatialSnapConstants';
import { buildCandidate } from './cadSpatialSnapCandidates';

export const buildExtensionCandidate = (
  segment: CadSegmentRef,
  worldPoint: CadWorldPoint,
): CadWorldPoint | null => {
  const projection = cadProjectPointOntoInfiniteLine(worldPoint, segment.start, segment.end);
  if (projection.t >= -1e-9 && projection.t <= 1 + 1e-9) return null;
  return projection.point;
};

export const buildParallelCandidate = (
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

export const buildPerpendicularThroughBaseCandidate = (
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

export const buildTangentThroughArcPointCandidate = (
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

export const cadAzimuthFromPoint = (
  from: CadWorldPoint,
  to: CadWorldPoint,
): number => {
  const dx = to.x - from.x;
  const dy = to.y - from.y;
  return ((Math.atan2(dx, dy) * 180) / Math.PI + 360) % 360;
};

export const buildDirectionCandidate = (
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

export const buildPerpendicularThroughTangentSeedCandidate = (
  arc: CadArcRef,
  tangentSeedPoint: CadWorldPoint,
  worldPoint: CadWorldPoint,
): CadWorldPoint | null => {
  if (cadDistance(tangentSeedPoint, arc.center) <= 1e-9) return null;
  return cadProjectPointOntoInfiniteLine(worldPoint, tangentSeedPoint, arc.center).point;
};

export const buildLockedConstructionPoint = (
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

export const isPointOnSegment = (
  point: CadWorldPoint,
  start: CadWorldPoint,
  end: CadWorldPoint,
  tolerance = 1e-6,
): boolean => {
  const projection = cadProjectPointOntoInfiniteLine(point, start, end);
  return projection.t >= -tolerance && projection.t <= 1 + tolerance && cadDistance(point, projection.point) <= tolerance;
};

export const buildLockedLineIntersectionCandidates = (
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

export const nearestSegmentEndpointToPoint = (
  segment: CadSegmentRef,
  point: CadWorldPoint,
): CadWorldPoint =>
  cadDistance(segment.start, point) <= cadDistance(segment.end, point) ? segment.start : segment.end;

export const nearestArcEndpointToPoint = (
  arc: CadArcRef,
  point: CadWorldPoint,
): CadWorldPoint =>
  cadDistance(arc.startPoint, point) <= cadDistance(arc.endPoint, point) ? arc.startPoint : arc.endPoint;

export const sourceEntityIdIncludedInCandidate = (candidate: CadSnapCandidate, sourceEntityId: string): boolean =>
  candidate.sourceEntityId.split('|').includes(sourceEntityId);

export const candidateMatchesLockedSnap = (
  candidate: CadSnapCandidate,
  lockedSnap: CadSnapConstructionContext['lockedSnap'] | null | undefined,
): boolean => {
  if (!lockedSnap || candidate.kind !== lockedSnap.kind) return false;
  if (lockedSnap.sourceSegmentId != null) {
    return candidate.sourceSegmentId === lockedSnap.sourceSegmentId;
  }
  return sourceEntityIdIncludedInCandidate(candidate, lockedSnap.sourceEntityId);
};

export const endpointKey = (point: CadWorldPoint): string => `${point.x.toFixed(6)}:${point.y.toFixed(6)}`;

export const pointMatches = (left: CadWorldPoint, right: CadWorldPoint, tolerance = 1e-6): boolean =>
  cadDistance(left, right) <= tolerance;

export const segmentPathObstructed = (
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

export const buildScopedSegmentIds = (
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

export const scopeAllowsSegment = (
  scope: Set<string> | null,
  segmentId: string,
  requireScope: boolean,
): boolean => {
  if (scope) return scope.has(segmentId);
  return !requireScope;
};
