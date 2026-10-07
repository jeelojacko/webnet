import { cadPointOnCircle, type CadWorldPoint } from './cadGeometry';
import { cadPolylineVerticesWrapToFirst } from './cadPolylineGeometry';
import { CAD_PARCEL_BULGE_LINE_FLOOR } from './cadParcelArcGeometry';
import { resolveCadFeatureLine } from './cadFeatureLines';
import { getCadEntityDisplayLabel } from './cadEntityNames';
import type {
  CadArcEntity,
  CadCircleEntity,
  CadFeatureLineEntity,
  CadLineEntity,
  CadParcelEntity,
  CadPolygonEntity,
  CadPolylineEntity,
  CadProject,
} from './cadTypes';
import type { CadArcRef, CadCircleRef, CadSegmentRef } from './cadSpatialIndexTypes';

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
  const vertices = entity.vertices;
  const isPolyline = entity.type === 'polyline';
  // C1: a closed PLINE stores no duplicate closure vertex, so the segment
  // iterator owns the last→first edge (label = first vertex label). A legacy
  // closed ring that already repeats first (e.g. TRAVERSE) keeps its N-1
  // stored edges untouched.
  const wrapsToFirst =
    isPolyline && cadPolylineVerticesWrapToFirst(vertices, entity.closed === true);
  const points = isPolyline
    ? wrapsToFirst
      ? [...vertices, vertices[0]!]
      : vertices
    : [...vertices, vertices[0]].filter((point): point is CadWorldPoint => point != null);
  const labels = wrapsToFirst
    ? [...entity.vertexLabels, entity.vertexLabels[0] ?? 'V1']
    : entity.vertexLabels;
  return points.slice(0, -1).map((vertex, index) => ({
    segmentId: `${entity.id}#${index}`,
    sourceEntityId: entity.id,
    start: vertex,
    end: points[index + 1]!,
    startLabel: labels[index] ?? `V${index + 1}`,
    endLabel: labels[index + 1] ?? `V${index + 2}`,
    label: `${labels[index] ?? `V${index + 1}`}-${labels[index + 1] ?? `V${index + 2}`}`,
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

export const circleRefFromEntity = (_project: CadProject, entity: CadCircleEntity): CadCircleRef => ({
  sourceEntityId: entity.id,
  center: { x: entity.centerX, y: entity.centerY },
  radius: entity.radius,
  label: getCadEntityDisplayLabel(entity),
});

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
