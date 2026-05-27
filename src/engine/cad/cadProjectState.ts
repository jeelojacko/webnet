import type { CadBounds, CadEntity, CadProject } from './cadTypes';

const arcEndPoints = (entity: Extract<CadEntity, { type: 'arc' }>): Array<{ x: number; y: number }> => {
  const normalizedStart = ((entity.startAngleDeg % 360) + 360) % 360;
  const normalizedEnd = ((entity.endAngleDeg % 360) + 360) % 360;
  const sampleAngles = [normalizedStart, normalizedEnd];
  [0, 90, 180, 270].forEach((candidate) => {
    const wrappedEnd = normalizedEnd < normalizedStart ? normalizedEnd + 360 : normalizedEnd;
    const test = candidate < normalizedStart ? candidate + 360 : candidate;
    if (test >= normalizedStart && test <= wrappedEnd) {
      sampleAngles.push(candidate);
    }
  });
  return sampleAngles.map((angleDeg) => {
    const radians = (angleDeg * Math.PI) / 180;
    return {
      x: entity.centerX + Math.cos(radians) * entity.radius,
      y: entity.centerY + Math.sin(radians) * entity.radius,
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

export const buildCadProjectSignature = (project: CadProject): string =>
  JSON.stringify(project);
