import type { CadEntity, CadPointSymbolShape, CadProject, CadStyle } from './cadTypes';
import { resolveSurveyPointDisplay } from './cadPointGroups';
import { DEFAULT_CAD_POINT_STYLE_ID } from './cadPointStyles';
import { DEFAULT_CAD_POINT_LABEL_STYLE_ID } from './cadPointLabelStyles';

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

export interface SurveyPointMarker {
  /** Drawing-unit radius (symbol radius × markerScale). Unchanged SVG paper-mm behavior. */
  radius: number;
  /** Effective shape; undefined = legacy/unknown → preview draws circle. */
  shape: CadPointSymbolShape | undefined;
  /** True only for the No Display style: emit NO point primitive. */
  hidden: boolean;
  /**
   * Phase 18N: block marker path. Set only when the effective style names
   * a KNOWN block definition — the renderer expands it at the point
   * (scale = markerScale, rotation = rotationDeg) instead of the symbol
   * shape. Unknown refs fall back to the symbol path (never dangling).
   */
  blockDefinitionId?: string;
  /** Multiplier applied to the block expansion (style markerScale). */
  markerScale?: number;
  /** CCW degrees applied to the block expansion (style rotationDeg). */
  rotationDeg?: number;
}

/**
 * Phase 18D single marker resolver (the only resolveSurveyPointDisplay call
 * site for markers — do not duplicate). No Display (`displayMarker: false`)
 * hides the marker only: the entity still exists and stays selectable via
 * Toolspace. Drawings without the 18D table keep the legacy radius with the
 * legacy symbol shape passed through.
 */
export const surveyPointMarker = (
  project: CadProject,
  entity: CadEntity,
): SurveyPointMarker => {
  const fallbackRadius =
    entity.type === 'survey-point' && entity.pointClass === 'control' ? 2.4 : 1.8;
  if (entity.type !== 'survey-point') return { radius: 1.8, shape: undefined, hidden: false };
  const display = resolveSurveyPointDisplay({
    point: entity,
    groups: project.pointGroups ?? [],
    pointStyles: project.pointStyles ?? [],
    labelStyles: project.labelStyles ?? [],
    defaultPointStyleId: DEFAULT_CAD_POINT_STYLE_ID,
    defaultLabelStyleId: DEFAULT_CAD_POINT_LABEL_STYLE_ID,
  });
  const style = (project.pointStyles ?? []).find(
    (entry) => entry.id === display.effectivePointStyleId,
  );
  if (style == null) {
    const legacy = entityStyle(project, entity);
    const shape = project.styleLibrary.pointSymbols.find(
      (symbol) => symbol.id === legacy?.pointSymbolId,
    )?.shape;
    return { radius: pointRadius(project, entity), shape, hidden: false };
  }
  if (!style.displayMarker) return { radius: 0, shape: undefined, hidden: true };
  // Phase 18N block marker path: known definition wins; the symbol stays
  // as the radius/shape fallback underneath. F2F flows through this same
  // resolver (resolveSurveyPointDisplay → effective style id), so catalog
  // styles need no parallel mapping — survey points stay
  // CadSurveyPointEntity, never converted to inserts.
  const markerScale = style.markerScale ?? 1;
  const rotationDeg = style.rotationDeg ?? 0;
  if (
    style.markerBlockDefinitionId != null &&
    (project.blockDefinitions ?? []).some((definition) => definition.id === style.markerBlockDefinitionId)
  ) {
    const symbol = project.styleLibrary.pointSymbols.find(
      (entry) => entry.id === style.markerSymbolId,
    );
    return {
      radius: (symbol?.radius ?? fallbackRadius) * markerScale,
      shape: symbol?.shape,
      hidden: false,
      blockDefinitionId: style.markerBlockDefinitionId,
      markerScale,
      rotationDeg,
    };
  }
  const symbol = project.styleLibrary.pointSymbols.find(
    (entry) => entry.id === style.markerSymbolId,
  );
  return {
    radius: (symbol?.radius ?? fallbackRadius) * (style.markerScale ?? 1),
    shape: symbol?.shape,
    hidden: false,
  };
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
