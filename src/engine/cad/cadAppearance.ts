// Authoritative CAD appearance resolver (Phase 18C spec §4-5).
//
// Pure + deterministic: explicit entity appearance > legacy style value >
// layer value > built-in default. Stores intent only — never writes resolved
// values back. Unknown/missing layer = visible, editable unless entity.locked.
import type {
  CadEntity,
  CadLayer,
  CadLineTypeId,
  CadProject,
  CadStyle,
  CadStyleLibrary,
} from './cadTypes';

export const DEFAULT_APPEARANCE_COLOR = '#94a3b8';
export const DEFAULT_APPEARANCE_LINETYPE_ID: CadLineTypeId = 'continuous';
/** Undefined lineweight (Default) resolves to this many mm. */
export const DEFAULT_RESOLVED_LINEWEIGHT_MM = 0.25;

export const isUsableColor = (color: string | undefined): color is string =>
  typeof color === 'string' && color.length > 0;

const firstUsable = (...values: Array<string | undefined>): string | undefined =>
  values.find(isUsableColor);

const firstFinite = (...values: Array<number | undefined>): number | undefined =>
  values.find((value) => typeof value === 'number' && Number.isFinite(value));

export const clampTransparency = (value: number): number =>
  Math.min(1, Math.max(0, value));

const lookupStyle = (
  entity: CadEntity,
  styleLibrary: CadStyleLibrary | null | undefined,
  styleById: ReadonlyMap<string, CadStyle> | undefined,
): CadStyle | undefined => {
  if (entity.styleId == null) return undefined;
  return styleById
    ? styleById.get(entity.styleId)
    : styleLibrary?.styles.find((style) => style.id === entity.styleId);
};

export interface ResolveCadEntityAppearanceArgs {
  entity: CadEntity;
  layer?: CadLayer | null;
  styleLibrary?: CadStyleLibrary | null;
  /** Optional pre-built `styleLibrary.styles` index (Phase 18P O(1) path). */
  styleById?: ReadonlyMap<string, CadStyle>;
}

/** Stable rejection code for locked-source mutations (spec §6). */
export const CAD_EDIT_LOCKED_REASON = 'LAYER_LOCKED' as const;

export type CadEntityEditBlockReason = typeof CAD_EDIT_LOCKED_REASON | 'ENTITY_HIDDEN';

export interface CadEntityEditCheck {
  editable: boolean;
  reason: CadEntityEditBlockReason | null;
}

export interface ResolvedCadEntityAppearance {
  visible: boolean;
  selectable: boolean;
  editable: boolean;
  color: string;
  lineTypeId: string;
  lineweightMm: number;
  transparency: number;
  printable: boolean;
}

/**
 * Central editability gate (spec §6). Single choke point for move / erase /
 * trim / fillet / extend / properties-edit / layer-move paths: locked source
 * (entity or its layer) rejects with stable `LAYER_LOCKED`; hidden source
 * rejects with `ENTITY_HIDDEN`. Unknown/missing layer stays editable unless
 * the entity itself is locked or hidden.
 */
export const checkCadEntityEditable = (
  project: Pick<CadProject, 'layers' | 'styleLibrary'>,
  entity: CadEntity,
): CadEntityEditCheck => {
  const layer = project.layers.find((candidate) => candidate.id === entity.layerId);
  if (entity.locked || layer?.locked === true) {
    return { editable: false, reason: CAD_EDIT_LOCKED_REASON };
  }
  const { visible } = resolveCadEntityAppearance({
    entity,
    layer,
    styleLibrary: project.styleLibrary,
  });
  if (!visible) return { editable: false, reason: 'ENTITY_HIDDEN' };
  return { editable: true, reason: null };
};

export const resolveCadEntityAppearance = ({ 
  entity,
  layer,
  styleLibrary,
  styleById,
}: ResolveCadEntityAppearanceArgs): ResolvedCadEntityAppearance => {
  const style = lookupStyle(entity, styleLibrary, styleById);
  const explicit = entity.appearance;
  // Lineweight precedence differs from color: explicit > layer >
  // legacy style.strokeWidth > Default (spec §4).
  const lineweightMm =
    firstFinite(explicit?.lineweightMm, layer?.lineweightMm, style?.strokeWidth) ??
    DEFAULT_RESOLVED_LINEWEIGHT_MM;
  const layerVisible = layer == null || layer.visible !== false;
  const visible = entity.visible && layerVisible && layer?.frozen !== true;
  return {
    visible,
    // Locked entities stay selectable for inspection; edits are gated.
    selectable: visible,
    editable: visible && !entity.locked && layer?.locked !== true,
    color:
      firstUsable(explicit?.color, style?.color, layer?.color) ?? DEFAULT_APPEARANCE_COLOR,
    lineTypeId:
      firstUsable(explicit?.lineTypeId, style?.lineTypeId, layer?.lineTypeId) ??
      DEFAULT_APPEARANCE_LINETYPE_ID,
    lineweightMm,
    transparency: clampTransparency(
      firstFinite(explicit?.transparency, layer?.transparency) ?? 0,
    ),
    printable: layer?.printable !== false,
  };
};
