import type {
  CadDisplayPrimitive,
  CadDisplayScene,
  CadEntity,
  CadProject,
  CadStyle,
} from './cadTypes';

const layerColor = (project: CadProject, layerId: string): string =>
  project.layers.find((layer) => layer.id === layerId)?.color ?? '#94a3b8';

const entityStyle = (project: CadProject, entity: CadEntity): CadStyle | null =>
  entity.styleId != null
    ? project.styleLibrary.styles.find((style) => style.id === entity.styleId) ?? null
    : null;

const pointRadius = (project: CadProject, entity: CadEntity): number => {
  if (entity.type !== 'survey-point') return 1.8;
  const style = entityStyle(project, entity);
  if (!style?.pointSymbolId) {
    return entity.pointClass === 'control' ? 2.4 : 1.8;
  }
  return (
    project.styleLibrary.pointSymbols.find((symbol) => symbol.id === style.pointSymbolId)?.radius ??
    (entity.pointClass === 'control' ? 2.4 : 1.8)
  );
};

const strokeWidth = (project: CadProject, entity: CadEntity, fallback: number): number =>
  entityStyle(project, entity)?.strokeWidth ?? fallback;

const textFontSize = (project: CadProject, entity: CadEntity, fallback: number): number => {
  const style = entityStyle(project, entity);
  if (!style?.textStyleId) return fallback;
  return (
    project.styleLibrary.textStyles.find((textStyle) => textStyle.id === style.textStyleId)?.fontSize ??
    fallback
  );
};

const toPrimitive = (project: CadProject, entity: CadEntity): CadDisplayPrimitive => {
  const stroke = entityStyle(project, entity)?.color ?? layerColor(project, entity.layerId);
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
        radius: pointRadius(project, entity),
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
        strokeWidth: strokeWidth(project, entity, 1.25),
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
        fontSize: textFontSize(project, entity, 11),
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
        strokeWidth: strokeWidth(project, entity, 1.1),
      };
  }
};

export const buildCadDisplayScene = (project: CadProject): CadDisplayScene => ({
  bounds: project.bounds,
  primitives: project.entities
    .filter((entity) => entity.visible)
    .map((entity) => toPrimitive(project, entity)),
});
