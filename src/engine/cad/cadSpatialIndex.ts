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
import type {
  CadArcEntity,
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
  nearest: 12,
};

const SNAP_RANGE_MULTIPLIER: Record<CadSnapKind, number> = {
  endpoint: 0.85,
  'point-node': 0.8,
  midpoint: 0.72,
  'arc-midpoint': 0.72,
  center: 0.65,
  quadrant: 0.65,
  intersection: 0.65,
  'apparent-intersection': 0.6,
  extension: 0.6,
  perpendicular: 0.6,
  parallel: 0.6,
  tangent: 0.6,
  nearest: 1,
};

const CONSTRUCTION_LOCK_KINDS: CadSnapKind[] = ['extension', 'perpendicular', 'parallel'];
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
  nearest: 12,
};

const buildCandidate = (
  kind: CadSnapKind,
  sourceEntityId: string,
  point: CadWorldPoint,
  query: CadWorldPoint,
  label: string,
  guideSegments?: Array<[CadWorldPoint, CadWorldPoint]>,
  sourceSegmentId?: string,
): CadSnapCandidate => ({
  id: `${kind}:${sourceEntityId}:${label}`,
  kind,
  sourceEntityId,
  sourceSegmentId,
  x: point.x,
  y: point.y,
  distance: cadDistance(query, point),
  label,
  guideSegments,
});

export interface CadSpatialIndex {
  queryNearestSnap: (
    _worldPoint: CadWorldPoint,
    _toleranceWorld: number,
    _allowedKinds?: readonly CadSnapKind[],
    _constructionContext?: CadSnapConstructionContext,
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
    label: entity.vertexLabels.join(' -> ') || entity.id,
  }));
};

const entitySegments = (entity: CadLineEntity | CadPolylineEntity | CadPolygonEntity | CadParcelEntity): CadSegmentRef[] =>
  entity.type === 'line' ? lineSegments(entity) : vertexEntitySegments(entity);

const arcRefFromEntity = (entity: CadArcEntity): CadArcRef => ({
  sourceEntityId: entity.id,
  center: { x: entity.centerX, y: entity.centerY },
  radius: entity.radius,
  startAngleDeg: entity.startAngleDeg,
  endAngleDeg: entity.endAngleDeg,
  startPoint: cadPointOnCircle({ x: entity.centerX, y: entity.centerY }, entity.radius, entity.startAngleDeg),
  endPoint: cadPointOnCircle({ x: entity.centerX, y: entity.centerY }, entity.radius, entity.endAngleDeg),
  label: entity.id,
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
  if (cadDistance(basePoint, foot) <= 1e-9) return foot;
  return cadProjectPointOntoInfiniteLine(worldPoint, basePoint, foot).point;
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

export const buildCadSpatialIndex = (project: CadProject): CadSpatialIndex => ({
  queryNearestSnap: (
    worldPoint,
    toleranceWorld,
    allowedKinds = [
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
    constructionContext = { active: false, basePoint: null },
  ) => {
    const allowed = new Set(allowedKinds);
    const candidates: CadSnapCandidate[] = [];
    const segments = project.entities
      .filter((entity): entity is CadLineEntity | CadPolylineEntity | CadPolygonEntity | CadParcelEntity =>
        entity.visible &&
        (entity.type === 'line' ||
          entity.type === 'polyline' ||
          entity.type === 'polygon' ||
          entity.type === 'parcel'),
      )
      .flatMap((entity) => entitySegments(entity));
    const arcs = project.entities
      .filter((entity): entity is CadArcEntity => entity.visible && entity.type === 'arc')
      .map((entity) => arcRefFromEntity(entity));
    const basePoint = constructionContext.active ? constructionContext.basePoint : null;
    const scopeSeedSegmentId = constructionContext.scopeSeedSegmentId ?? null;
    const parallelScope = constructionContext.active ? buildScopedSegmentIds(segments, basePoint, scopeSeedSegmentId, 1) : null;
    const extensionScope = constructionContext.active ? buildScopedSegmentIds(segments, basePoint, scopeSeedSegmentId, 2) : null;
    const apparentScope = constructionContext.active ? buildScopedSegmentIds(segments, basePoint, scopeSeedSegmentId, 2) : null;

    project.entities.forEach((entity) => {
      if (!entity.visible) return;
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
              if (extensionScope && !extensionScope.has(segment.segmentId)) {
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
            if (constructionContext.active && basePoint && allowed.has('perpendicular')) {
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
                ),
              );
            }
            if (constructionContext.active && basePoint && allowed.has('parallel')) {
              if (parallelScope && !parallelScope.has(segment.segmentId)) {
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
          const arc = arcRefFromEntity(entity);
          if (allowed.has('endpoint')) {
            candidates.push(
              buildCandidate('endpoint', entity.id, arc.startPoint, worldPoint, `${arc.label} start`),
              buildCandidate('endpoint', entity.id, arc.endPoint, worldPoint, `${arc.label} end`),
            );
          }
          if (allowed.has('center')) {
            candidates.push(buildCandidate('center', entity.id, arc.center, worldPoint, `${arc.label} center`));
          }
          if (allowed.has('arc-midpoint')) {
            candidates.push(
              buildCandidate(
                'arc-midpoint',
                entity.id,
                cadArcMidpoint(arc.center, arc.radius, arc.startAngleDeg, arc.endAngleDeg),
                worldPoint,
                `${arc.label} mid`,
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
                  `${arc.label} q${angleDeg}`,
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
          if (constructionContext.active && basePoint && allowed.has('perpendicular')) {
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
            apparentScope &&
            (!apparentScope.has(left.segmentId) || !apparentScope.has(right.segmentId))
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
        if (apparentScope && !apparentScope.has(segment.segmentId)) {
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
        (segment) => segment.sourceEntityId === constructionContext.lockedSnap?.sourceEntityId,
      );
      if (lockedSegment) {
        const lockedPoint = buildLockedConstructionPoint(
          constructionContext.lockedSnap.kind,
          lockedSegment,
          basePoint,
          worldPoint,
        );
        if (lockedPoint) {
          candidates.push(
            buildCandidate(
              constructionContext.lockedSnap.kind,
              lockedSegment.sourceEntityId,
              lockedPoint,
              worldPoint,
              `${lockedSegment.label} ${
                constructionContext.lockedSnap.kind === 'extension'
                  ? 'ext'
                  : constructionContext.lockedSnap.kind === 'parallel'
                    ? 'parallel'
                    : 'perp'
              }`,
              constructionContext.lockedSnap.kind === 'parallel'
                ? [
                    [basePoint, lockedPoint],
                    [lockedSegment.start, lockedSegment.end],
                  ]
                : [
                    [basePoint, lockedPoint],
                    [lockedSegment.start, lockedSegment.end],
                  ],
            ),
          );
        }
      }
    }

    const viable = dedupeCandidates(candidates)
      .filter(
        (candidate) => candidate.distance <= toleranceWorld * SNAP_RANGE_MULTIPLIER[candidate.kind],
      )
      .sort(candidateSort);

    const lockedConstructionCandidate =
      (constructionContext.lockedSnap
        ? viable.find(
            (candidate) =>
              candidate.kind === constructionContext.lockedSnap?.kind &&
              sourceEntityIdIncludedInCandidate(candidate, constructionContext.lockedSnap.sourceEntityId),
          ) ?? null
        : null) ??
      viable.find((candidate) =>
        CONSTRUCTION_LOCK_KINDS.includes(candidate.kind),
      ) ??
      null;
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
});
