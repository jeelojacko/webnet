import type {
  CadArcEntity,
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

const buildArcPoints = (entity: CadArcEntity): Array<{ x: number; y: number }> => {
  const normalizedStart = ((entity.startAngleDeg % 360) + 360) % 360;
  const normalizedEndBase = ((entity.endAngleDeg % 360) + 360) % 360;
  const normalizedEnd = normalizedEndBase <= normalizedStart ? normalizedEndBase + 360 : normalizedEndBase;
  const sweep = Math.max(1, normalizedEnd - normalizedStart);
  const segmentCount = Math.max(8, Math.ceil(sweep / 15));
  return Array.from({ length: segmentCount + 1 }, (_, index) => {
    const angleDeg = normalizedStart + (sweep * index) / segmentCount;
    const radians = (angleDeg * Math.PI) / 180;
    return {
      x: entity.centerX + Math.cos(radians) * entity.radius,
      y: entity.centerY + Math.sin(radians) * entity.radius,
    };
  });
};

const buildVertexPrimitives = (
  project: CadProject,
  entity: Extract<CadEntity, { vertices: Array<{ x: number; y: number }> }>,
): CadDisplayPrimitive[] => {
  const stroke = entityStyle(project, entity)?.color ?? layerColor(project, entity.layerId);
  const points =
    entity.type === 'polygon' || entity.type === 'parcel'
      ? [...entity.vertices, entity.vertices[0]].filter(
          (point): point is { x: number; y: number } => point != null,
        )
      : entity.vertices;
  return points.slice(0, -1).map((vertex, index) => ({
    kind: 'line',
    id: `primitive:${entity.id}:${index + 1}`,
    layerId: entity.layerId,
    sourceEntityId: entity.id,
    stroke,
    points: [vertex, points[index + 1]!],
    strokeWidth: strokeWidth(project, entity, entity.type === 'parcel' ? 1.5 : 1.25),
  }));
};

const toPrimitives = (project: CadProject, entity: CadEntity): CadDisplayPrimitive[] => {
  const stroke = entityStyle(project, entity)?.color ?? layerColor(project, entity.layerId);
  switch (entity.type) {
    case 'survey-point':
      return [{
        kind: 'point',
        id: `primitive:${entity.id}`,
        layerId: entity.layerId,
        sourceEntityId: entity.id,
        stroke,
        fill: stroke,
        point: { x: entity.x, y: entity.y },
        radius: pointRadius(project, entity),
      }];
    case 'line':
      return [{
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
      }];
    case 'polyline':
    case 'polygon':
    case 'parcel':
      return buildVertexPrimitives(project, entity);
    case 'arc': {
      const points = buildArcPoints(entity);
      return points.slice(0, -1).map((vertex, index) => ({
        kind: 'line',
        id: `primitive:${entity.id}:${index + 1}`,
        layerId: entity.layerId,
        sourceEntityId: entity.id,
        stroke,
        points: [vertex, points[index + 1]!],
        strokeWidth: strokeWidth(project, entity, 1.25),
      }));
    }
    case 'text':
      return [{
        kind: 'text',
        id: `primitive:${entity.id}`,
        layerId: entity.layerId,
        sourceEntityId: entity.id,
        stroke,
        point: { x: entity.x, y: entity.y },
        text: entity.text,
        fontSize: textFontSize(project, entity, 11),
      }];
    case 'error-ellipse':
      return [{
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
      }];
  }
};

export const buildCadDisplayScene = (project: CadProject): CadDisplayScene => ({
  bounds: project.bounds,
  primitives: project.entities
    .filter((entity) => entity.visible)
    .flatMap((entity) => toPrimitives(project, entity)),
});
