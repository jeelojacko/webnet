import { cadPointOnCircle, type CadWorldPoint } from './cadGeometry';
import { CAD_PARCEL_BULGE_LINE_FLOOR } from './cadParcelArcGeometry';
import { resolveCadFeatureLine } from './cadFeatureLines';
import { getCadEntityDisplayLabel } from './cadEntityNames';
import type {
  CadArcEntity,
  CadFeatureLineEntity,
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
  entity:
    | CadLineEntity
    | CadPolylineEntity
    | CadPolygonEntity
    | CadParcelEntity
    | CadFeatureLineEntity,
): CadSegmentRef[] => {
  if (entity.type === 'line') return lineSegments(entity);
  if (entity.type === 'feature-line') return featureLineCourseSegments(entity);
  return vertexEntitySegments(entity);
};

/** Phase 20A: line-course segments of a feature line (arc courses are arcs). */
export const featureLineCourseSegments = (entity: CadFeatureLineEntity): CadSegmentRef[] => {
  const resolved = resolveCadFeatureLine(entity);
  if (!resolved) return [];
  return resolved.courses
    .filter((course) => course.kind === 'line')
    .map((course) => ({
      segmentId: `${entity.id}#${course.index}`,
      sourceEntityId: entity.id,
      start: { x: course.from.x, y: course.from.y },
      end: { x: course.to.x, y: course.to.y },
      startLabel: `V${course.index + 1}`,
      endLabel: `V${course.index + 2}`,
      label: `V${course.index + 1}-V${course.index + 2}`,
    }));
};

/** Phase 20A: arc-course refs of a feature line (reuse the resolver only). */
export const featureLineCourseArcs = (entity: CadFeatureLineEntity): CadArcRef[] => {
  const resolved = resolveCadFeatureLine(entity);
  if (!resolved) return [];
  return resolved.courses
    .filter(
      (course) =>
        course.kind === 'arc' &&
        course.center != null &&
        course.radius != null &&
        course.startAngleDeg != null &&
        course.signedSweepDeg != null,
    )
    .map((course) => ({
      sourceEntityId: entity.id,
      center: { ...course.center! },
      radius: course.radius!,
      startAngleDeg: course.startAngleDeg!,
      endAngleDeg: course.startAngleDeg! + course.signedSweepDeg!,
      startPoint: { x: course.from.x, y: course.from.y },
      endPoint: { x: course.to.x, y: course.to.y },
      label: `${getCadEntityDisplayLabel(entity)}#${course.index}`,
    }));
};

/** True when a course entry is a canonical arc (shared machine floor). */
export const isFeatureLineArcCourse = (
  entry: { kind: 'line' } | { kind: 'arc'; bulge: number } | undefined,
): boolean => entry?.kind === 'arc' && Math.abs(entry.bulge) >= CAD_PARCEL_BULGE_LINE_FLOOR;

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
