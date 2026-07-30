import type { CadEntity, CadProject, CadStyle } from './cadTypes';

export const layerColor = (project: CadProject, layerId: string): string =>
  project.layers.find((layer) => layer.id === layerId)?.color ?? '#94a3b8';

export const entityStyle = (project: CadProject, entity: CadEntity): CadStyle | null =>
  entity.styleId != null
    ? project.styleLibrary.styles.find((style) => style.id === entity.styleId) ?? null
    : null;

export const pointRadius = (project: CadProject, entity: CadEntity): number => {
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

export const strokeWidth = (project: CadProject, entity: CadEntity, fallback: number): number =>
  entityStyle(project, entity)?.strokeWidth ?? fallback;

export const textFontSize = (project: CadProject, entity: CadEntity, fallback: number): number => {
  const style = entityStyle(project, entity);
  if (!style?.textStyleId) return fallback;
  return (
    project.styleLibrary.textStyles.find((textStyle) => textStyle.id === style.textStyleId)?.fontSize ??
    fallback
  );
};
