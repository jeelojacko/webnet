import {
  cadClosestPointOnSegment,
  cadDistance,
  cadMidpoint,
  cadSegmentIntersection,
  type CadWorldPoint,
} from './cadGeometry';
import type {
  CadLineEntity,
  CadPolylineEntity,
  CadProject,
  CadSnapCandidate,
  CadSnapKind,
} from './cadTypes';

const SNAP_PRIORITY: Record<CadSnapKind, number> = {
  'point-node': 0,
  endpoint: 1,
  midpoint: 2,
  intersection: 3,
  nearest: 4,
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

const polylineSegments = (polyline: CadPolylineEntity): CadSegmentRef[] =>
  polyline.vertices.slice(0, -1).map((vertex, index) => ({
    sourceEntityId: polyline.id,
    start: vertex,
    end: polyline.vertices[index + 1],
    startLabel: polyline.vertexLabels[index] ?? `V${index + 1}`,
    endLabel: polyline.vertexLabels[index + 1] ?? `V${index + 2}`,
    label: polyline.vertexLabels.join(' -> ') || polyline.id,
  }));

const entitySegments = (entity: CadLineEntity | CadPolylineEntity): CadSegmentRef[] =>
  entity.type === 'line' ? lineSegments(entity) : polylineSegments(entity);

export const buildCadSpatialIndex = (project: CadProject): CadSpatialIndex => ({
  queryNearestSnap: (
    worldPoint,
    toleranceWorld,
    allowedKinds = ['point-node', 'endpoint', 'midpoint', 'intersection', 'nearest'],
  ) => {
    const allowed = new Set(allowedKinds);
    const candidates: CadSnapCandidate[] = [];
    const segments = project.entities
      .filter((entity): entity is CadLineEntity | CadPolylineEntity =>
        entity.visible && (entity.type === 'line' || entity.type === 'polyline'),
      )
      .flatMap((entity) => entitySegments(entity));

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
    }

    const viable = candidates
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
