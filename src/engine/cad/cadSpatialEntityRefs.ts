import { cadPointOnCircle, type CadWorldPoint } from './cadGeometry';
import { getCadEntityDisplayLabel } from './cadEntityNames';
import type {
  CadArcEntity,
  CadLineEntity,
  CadParcelEntity,
  CadPolygonEntity,
  CadPolylineEntity,
  CadProject,
} from './cadTypes';
import type { CadArcRef, CadSegmentRef } from './cadSpatialIndexTypes';

export const lineSegments = (line: CadLineEntity): CadSegmentRef[] => [
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

export const vertexEntitySegments = (
  entity: CadPolylineEntity | CadPolygonEntity | CadParcelEntity,
): CadSegmentRef[] => {
  const points =
    entity.type === 'polyline'
      ? entity.vertices
      : [...entity.vertices, entity.vertices[0]].filter(
          (point): point is CadWorldPoint => point != null,
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

export const entitySegments = (
  entity: CadLineEntity | CadPolylineEntity | CadPolygonEntity | CadParcelEntity,
): CadSegmentRef[] =>
  entity.type === 'line' ? lineSegments(entity) : vertexEntitySegments(entity);

export const arcRefFromEntity = (_project: CadProject, entity: CadArcEntity): CadArcRef => ({
  sourceEntityId: entity.id,
  center: { x: entity.centerX, y: entity.centerY },
  radius: entity.radius,
  startAngleDeg: entity.startAngleDeg,
  endAngleDeg: entity.endAngleDeg,
  startPoint: cadPointOnCircle({ x: entity.centerX, y: entity.centerY }, entity.radius, entity.startAngleDeg),
  endPoint: cadPointOnCircle({ x: entity.centerX, y: entity.centerY }, entity.radius, entity.endAngleDeg),
  label: getCadEntityDisplayLabel(entity),
});
