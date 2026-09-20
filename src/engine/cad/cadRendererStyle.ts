import type { CadEntity, CadPointSymbolShape, CadProject, CadStyle } from './cadTypes';
import type { CadProjectLookup } from './cadProjectLookup';
import { resolveSurveyPointDisplay } from './cadPointGroups';
import { DEFAULT_CAD_POINT_STYLE_ID } from './cadPointStyles';
import { DEFAULT_CAD_POINT_LABEL_STYLE_ID } from './cadPointLabelStyles';

export const layerColor = (
  project: CadProject,
  layerId: string,
  lookup?: CadProjectLookup,
): string =>
  (lookup ? lookup.layerById.get(layerId) : project.layers.find((layer) => layer.id === layerId))?.color ??
  '#94a3b8';

export const entityStyle = (
  project: CadProject,
  entity: CadEntity,
  lookup?: CadProjectLookup,
): CadStyle | null => {
  if (entity.styleId == null) return null;
  const style = lookup
    ? lookup.styleById.get(entity.styleId)
    : project.styleLibrary.styles.find((style) => style.id === entity.styleId);
  return style ?? null;
};

export const pointRadius = (
  project: CadProject,
  entity: CadEntity,
  lookup?: CadProjectLookup,
): number => {
  if (entity.type !== 'survey-point') return 1.8;
  const style = entityStyle(project, entity, lookup);
  if (!style?.pointSymbolId) {
    return entity.pointClass === 'control' ? 2.4 : 1.8;
  }
  const symbol = lookup
    ? lookup.pointSymbolById.get(style.pointSymbolId)
    : project.styleLibrary.pointSymbols.find((symbol) => symbol.id === style.pointSymbolId);
  return symbol?.radius ?? (entity.pointClass === 'control' ? 2.4 : 1.8);
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
  lookup?: CadProjectLookup,
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
  const style = lookup
    ? lookup.pointStyleById.get(display.effectivePointStyleId)
    : (project.pointStyles ?? []).find((entry) => entry.id === display.effectivePointStyleId);
  if (style == null) {
    const legacy = entityStyle(project, entity, lookup);
    const legacySymbol = lookup
      ? legacy?.pointSymbolId != null
        ? lookup.pointSymbolById.get(legacy.pointSymbolId)
        : undefined
      : project.styleLibrary.pointSymbols.find((symbol) => symbol.id === legacy?.pointSymbolId);
    return { radius: pointRadius(project, entity, lookup), shape: legacySymbol?.shape, hidden: false };
  }
  if (!style.displayMarker) return { radius: 0, shape: undefined, hidden: true };
  // Phase 18N block marker path: known definition wins; the symbol stays
  // as the radius/shape fallback underneath. F2F flows through this same
  // resolver (resolveSurveyPointDisplay → effective style id), so catalog
  // styles need no parallel mapping — survey points stay
  // CadSurveyPointEntity, never converted to inserts.
  const markerScale = style.markerScale ?? 1;
  const rotationDeg = style.rotationDeg ?? 0;
  const markerSymbol = lookup
    ? style.markerSymbolId != null
      ? lookup.pointSymbolById.get(style.markerSymbolId)
      : undefined
    : project.styleLibrary.pointSymbols.find((entry) => entry.id === style.markerSymbolId);
  const knownMarkerBlock =
    style.markerBlockDefinitionId != null &&
    (lookup
      ? lookup.blockDefinitionById.has(style.markerBlockDefinitionId)
      : (project.blockDefinitions ?? []).some(
          (definition) => definition.id === style.markerBlockDefinitionId,
        ));
  if (knownMarkerBlock) {
    return {
      radius: (markerSymbol?.radius ?? fallbackRadius) * markerScale,
      shape: markerSymbol?.shape,
      hidden: false,
      blockDefinitionId: style.markerBlockDefinitionId,
      markerScale,
      rotationDeg,
    };
  }
  return {
    radius: (markerSymbol?.radius ?? fallbackRadius) * (style.markerScale ?? 1),
    shape: markerSymbol?.shape,
    hidden: false,
  };
};

export const strokeWidth = (
  project: CadProject,
  entity: CadEntity,
  fallback: number,
  lookup?: CadProjectLookup,
): number => entityStyle(project, entity, lookup)?.strokeWidth ?? fallback;

export const textFontSize = (
  project: CadProject,
  entity: CadEntity,
  fallback: number,
  lookup?: CadProjectLookup,
): number => {
  const style = entityStyle(project, entity, lookup);
  if (!style?.textStyleId) return fallback;
  const textStyle = lookup
    ? lookup.textStyleById.get(style.textStyleId)
    : project.styleLibrary.textStyles.find((textStyle) => textStyle.id === style.textStyleId);
  return textStyle?.fontSize ?? fallback;
};
