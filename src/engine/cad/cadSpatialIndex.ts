import {
  cadArcMidpoint,
  cadClosestPointOnSegment,
  cadClosestPointOnArc,
  cadDistance,
  cadIntersectArcArc,
  cadIntersectSegmentArc,
  cadMidpoint,
  cadPointOnCircle,
  cadSegmentIntersection,
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
  CadSnapKind,
} from './cadTypes';

const SNAP_PRIORITY: Record<CadSnapKind, number> = {
  'point-node': 0,
  endpoint: 1,
  midpoint: 2,
  center: 3,
  'arc-midpoint': 4,
  quadrant: 5,
  intersection: 6,
  nearest: 7,
};

const buildCandidate = (
  kind: CadSnapKind,
  sourceEntityId: string,
  point: CadWorldPoint,
  query: CadWorldPoint,
  label: string,
): CadSnapCandidate => ({
  id: `${kind}:${sourceEntityId}:${label}`,
  kind,
  sourceEntityId,
  x: point.x,
  y: point.y,
  distance: cadDistance(query, point),
  label,
});

export interface CadSpatialIndex {
  queryNearestSnap: (
    _worldPoint: CadWorldPoint,
    _toleranceWorld: number,
    _allowedKinds?: readonly CadSnapKind[],
  ) => CadSnapCandidate | null;
}

interface CadSegmentRef {
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

export const buildCadSpatialIndex = (project: CadProject): CadSpatialIndex => ({
  queryNearestSnap: (
    worldPoint,
    toleranceWorld,
    allowedKinds = ['point-node', 'endpoint', 'midpoint', 'center', 'arc-midpoint', 'quadrant', 'intersection', 'nearest'],
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
                buildCandidate('endpoint', entity.id, segment.start, worldPoint, segment.startLabel),
                buildCandidate('endpoint', entity.id, segment.end, worldPoint, segment.endLabel),
              );
            }
            if (allowed.has('midpoint')) {
              candidates.push(
                buildCandidate('midpoint', entity.id, cadMidpoint(segment.start, segment.end), worldPoint, segment.label),
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
                ),
              );
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

    const viable = dedupeCandidates(candidates)
      .filter((candidate) => candidate.distance <= toleranceWorld)
      .sort((left, right) => {
        if (SNAP_PRIORITY[left.kind] !== SNAP_PRIORITY[right.kind]) {
          return SNAP_PRIORITY[left.kind] - SNAP_PRIORITY[right.kind];
        }
        if (Math.abs(left.distance - right.distance) > 1e-9) return left.distance - right.distance;
        return left.id.localeCompare(right.id, undefined, { numeric: true });
      });
    return viable[0] ?? null;
  },
});
