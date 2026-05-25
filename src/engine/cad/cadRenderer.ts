import type {
  CadDisplayPrimitive,
  CadDisplayScene,
  CadEntity,
  CadProject,
} from './cadTypes';

const layerColor = (project: CadProject, layerId: string): string =>
  project.layers.find((layer) => layer.id === layerId)?.color ?? '#94a3b8';

const toPrimitive = (project: CadProject, entity: CadEntity): CadDisplayPrimitive => {
  const stroke = layerColor(project, entity.layerId);
  switch (entity.type) {
    case 'survey-point':
      return {
        kind: 'point',
        id: `primitive:${entity.id}`,
        layerId: entity.layerId,
        sourceEntityId: entity.id,
        stroke,
        fill: stroke,
        point: { x: entity.x, y: entity.y },
        radius: entity.pointClass === 'control' ? 2.4 : 1.8,
      };
    case 'line':
      return {
        kind: 'line',
        id: `primitive:${entity.id}`,
        layerId: entity.layerId,
        sourceEntityId: entity.id,
        stroke,
        points: [
          { x: entity.fromX, y: entity.fromY },
          { x: entity.toX, y: entity.toY },
        ],
        strokeWidth: 1.25,
      };
    case 'text':
      return {
        kind: 'text',
        id: `primitive:${entity.id}`,
        layerId: entity.layerId,
        sourceEntityId: entity.id,
        stroke,
        point: { x: entity.x, y: entity.y },
        text: entity.text,
        fontSize: 11,
      };
    case 'error-ellipse':
      return {
        kind: 'ellipse',
        id: `primitive:${entity.id}`,
        layerId: entity.layerId,
        sourceEntityId: entity.id,
        stroke,
        center: { x: entity.centerX, y: entity.centerY },
        semiMajor: entity.semiMajor,
        semiMinor: entity.semiMinor,
        thetaDeg: entity.thetaDeg,
        strokeWidth: 1.1,
      };
  }
};

export const buildCadDisplayScene = (project: CadProject): CadDisplayScene => ({
  bounds: project.bounds,
  primitives: project.entities
    .filter((entity) => entity.visible)
    .map((entity) => toPrimitive(project, entity)),
});
