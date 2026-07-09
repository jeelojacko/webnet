import type { CadBounds, CadProject } from './cadTypes';
import type { CadWorldPoint } from './cadGeometry';
import type { CadArcRef } from './cadSpatialIndexTypes';
import { arcRefFromEntity } from './cadSpatialEntityRefs';

export const expandBounds = (bounds: CadBounds, padding: number): CadBounds => ({
  minX: bounds.minX - padding,
  minY: bounds.minY - padding,
  maxX: bounds.maxX + padding,
  maxY: bounds.maxY + padding,
});

export const pointInsideBounds = (point: CadWorldPoint, bounds: CadBounds): boolean =>
  point.x >= bounds.minX && point.x <= bounds.maxX && point.y >= bounds.minY && point.y <= bounds.maxY;

export const segmentIntersectsBounds = (
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

export const arcIntersectsBounds = (arc: CadArcRef, bounds: CadBounds): boolean => {
  const minX = arc.center.x - arc.radius;
  const maxX = arc.center.x + arc.radius;
  const minY = arc.center.y - arc.radius;
  const maxY = arc.center.y + arc.radius;
  return !(maxX < bounds.minX || minX > bounds.maxX || maxY < bounds.minY || minY > bounds.maxY);
};

export const entityIntersectsBounds = (
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
