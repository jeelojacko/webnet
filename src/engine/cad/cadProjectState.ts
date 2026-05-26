import type { CadBounds, CadEntity, CadProject } from './cadTypes';

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

export const buildCadProjectSignature = (project: CadProject): string =>
  [
    project.version,
    project.id,
    project.metadata.source,
    project.metadata.runMode,
    project.metadata.units,
    project.metadata.stationCount,
    project.metadata.observationCount,
    project.metadata.adjustedStationCount,
    project.layers
      .map((layer) => `${layer.id}:${layer.visible ? 1 : 0}:${layer.locked ? 1 : 0}`)
      .join('|'),
    project.styleLibrary.styles
      .map((style) => `${style.id}:${style.color ?? '-'}:${style.strokeWidth ?? '-'}`)
      .join('|'),
    project.entities.map((entity) => entity.id).join('|'),
  ].join('::');
