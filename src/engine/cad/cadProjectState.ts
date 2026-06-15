import { cadIsAngleOnArcSweep } from './cadGeometry';
import type { CadCogoComputation } from './cadCogoTypes';
import type { CadBounds, CadEntity, CadProject } from './cadTypes';

const arcEndPoints = ({
  centerX,
  centerY,
  radius,
  startAngleDeg,
  endAngleDeg,
}: {
  centerX: number;
  centerY: number;
  radius: number;
  startAngleDeg: number;
  endAngleDeg: number;
}): Array<{ x: number; y: number }> => {
  const sampleAngles = [startAngleDeg, endAngleDeg];
  [0, 90, 180, 270].forEach((candidate) => {
    if (cadIsAngleOnArcSweep(candidate, startAngleDeg, endAngleDeg)) {
      sampleAngles.push(candidate);
    }
  });
  return sampleAngles.map((angleDeg) => {
    const radians = (angleDeg * Math.PI) / 180;
    return {
      x: centerX + Math.cos(radians) * radius,
      y: centerY + Math.sin(radians) * radius,
    };
  });
};

export const buildCadBounds = (entities: CadEntity[]): CadBounds | null => {
  let minX = Number.POSITIVE_INFINITY;
  let minY = Number.POSITIVE_INFINITY;
  let maxX = Number.NEGATIVE_INFINITY;
  let maxY = Number.NEGATIVE_INFINITY;

  const includePoint = (x: number, y: number) => {
    minX = Math.min(minX, x);
    minY = Math.min(minY, y);
    maxX = Math.max(maxX, x);
    maxY = Math.max(maxY, y);
  };

  entities.forEach((entity) => {
    switch (entity.type) {
      case 'survey-point':
      case 'text':
        includePoint(entity.x, entity.y);
        break;
      case 'line':
        includePoint(entity.fromX, entity.fromY);
        includePoint(entity.toX, entity.toY);
        break;
      case 'polyline':
      case 'polygon':
      case 'parcel':
        entity.vertices.forEach((vertex) => includePoint(vertex.x, vertex.y));
        break;
      case 'arc':
        arcEndPoints(entity).forEach((point) => includePoint(point.x, point.y));
        break;
      case 'alignment':
        entity.elements.forEach((element) => {
          if (element.kind === 'line') {
            includePoint(element.start.x, element.start.y);
            includePoint(element.end.x, element.end.y);
            return;
          }
          arcEndPoints({
            centerX: element.center.x,
            centerY: element.center.y,
            radius: element.radius,
            startAngleDeg: element.startAngleDeg,
            endAngleDeg: element.endAngleDeg,
          }).forEach((point) => includePoint(point.x, point.y));
        });
        break;
      case 'error-ellipse':
        includePoint(entity.centerX - entity.semiMajor, entity.centerY - entity.semiMajor);
        includePoint(entity.centerX + entity.semiMajor, entity.centerY + entity.semiMajor);
        break;
      default:
        break;
    }
  });

  if (!Number.isFinite(minX) || !Number.isFinite(minY) || !Number.isFinite(maxX) || !Number.isFinite(maxY)) {
    return null;
  }

  return { minX, minY, maxX, maxY };
};

export const replaceCadProjectEntities = (
  project: CadProject,
  entities: CadEntity[],
): CadProject => ({
  ...project,
  entities,
  bounds: buildCadBounds(entities),
});

export const appendCadProjectEntities = (
  project: CadProject,
  entitiesToAppend: CadEntity[],
): CadProject => replaceCadProjectEntities(project, [...project.entities, ...entitiesToAppend]);

export const appendCadProjectCogoComputation = (
  project: CadProject,
  computation: CadCogoComputation,
): CadProject => ({
  ...project,
  cogoComputations: [...(project.cogoComputations ?? []), computation],
});

export const buildCadProjectSignature = (project: CadProject): string =>
  JSON.stringify(project);
