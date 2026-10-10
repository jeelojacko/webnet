/**
 * STRUCT-241.3 CAD survey presentation / point-group type leaf.
 *
 * Type-only module. It owns the nine survey presentation and point-group
 * contracts extracted verbatim (names, JSDoc, field names, optionality,
 * property order, and literal unions unchanged) from `cadTypes.ts`, in
 * original source order: `CadPointStyleId`, `CadPointLabelStyleId`,
 * `CadPointGroupId`, `CadPointGroupQuery`, `CadPointGroup`,
 * `CadPointLabelComponent`, `CadPointLabelStyle`, `CadPointLabelBinding`,
 * and `CadPointStyle`.
 *
 * Contract: type-only imports only. It imports the primitive identity aliases
 * from the zero-import core leaf (`./cadCorePrimitiveTypes`); it must never
 * import `cadTypes`, the foundation style leaf, any barrel, any engine
 * runtime, or `cadTransactions`, and it declares no runtime exports. No new
 * dependency cycle (SCC) is introduced.
 */

import type { CadEntityId, CadPointSymbolId, CadTextStyleId } from './cadCorePrimitiveTypes';

export type CadPointStyleId = string;
export type CadPointLabelStyleId = string;
export type CadPointGroupId = string;

/**
 * Phase 18D point-group query. DISPLAY/ORGANIZATION ONLY: matching never
 * duplicates geometry and never mutates coordinates. Wildcards `*` (any run)
 * and `?` (exactly one char) are supported ONLY in descriptionPattern and
 * featureCodePattern, matched case-INSENSITIVELY. Regex/bracket syntax is
 * not supported: any pattern containing `[`, `]` or `\` is malformed and
 * fails closed (matches nothing; see validatePointGroupQuery). Entity-id
 * lists match exactly (case-sensitive); excludePointIds always wins over
 * includePointIds and query constraints.
 */
export interface CadPointGroupQuery {
  /** Entity ids (point.id) explicitly included (OR with query constraints). */
  includePointIds?: string[];
  /** Entity ids always excluded; wins over include and query. */
  excludePointIds?: string[];
  descriptionPattern?: string;
  featureCodePattern?: string;
  pointClass?: 'control' | 'free' | 'unknown';
  layerId?: string;
  source?: 'adjustment-result' | 'parsed-input';
  elevationMin?: number;
  elevationMax?: number;
}

/**
 * Phase 18D point group: a named, ordered query rule carrying optional
 * per-property style overrides. Overrides are display-only references;
 * unknown style ids fall back deterministically at resolve time.
 */
export interface CadPointGroup {
  id: CadPointGroupId;
  name: string;
  query: CadPointGroupQuery;
  pointStyleOverrideId?: CadPointStyleId;
  pointLabelStyleOverrideId?: CadPointLabelStyleId;
  /** Lower = higher precedence; list order is the tiebreak. */
  priority: number;
  description?: string;
}

export type CadPointLabelComponent = 'pointNumber' | 'description' | 'elevation' | 'featureCode';

/**
 * Phase 18D: point label content/layout ONLY (which components, order,
 * separator, elevation decimals, placement offset, visibility). Color/font
 * stay with the label's own layer/style; no annotation scale yet (future).
 */
export interface CadPointLabelStyle {
  id: CadPointLabelStyleId;
  name: string;
  components: {
    pointNumber?: boolean;
    description?: boolean;
    elevation?: boolean;
    featureCode?: boolean;
    prefix?: string;
    suffix?: string;
  };
  componentOrder: CadPointLabelComponent[];
  separator: string;
  /** Elevation decimals, 0-4. Drawing units; never the global precision. */
  elevationDecimals: number;
  textStyleId: CadTextStyleId;
  /** Base placement offset in drawing units (point + offset). */
  offsetX: number;
  offsetY: number;
  rotationDeg?: number;
  /** False = label not drawn (point/layer visibility unaffected). */
  visible: boolean;
  description?: string;
}

/**
 * Phase 18D: associative binding on a text label. x/y/text remain compat
 * snapshots; the binding is the associative source of truth. offsetOverride
 * WINS over the style offset (not additive); the label keeps its own layer
 * (no visibility coupling to the point).
 */
export interface CadPointLabelBinding {
  pointEntityId: CadEntityId;
  labelStyleId: CadPointLabelStyleId;
  offsetOverride?: { dx: number; dy: number };
  rotationOverrideDeg?: number;
  content: { mode: 'derived' } | { mode: 'manual'; text: string };
}

/**
 * Phase 18D: marker presentation ONLY (symbol + scale + rotation + visibility).
 * Color/layer/coordinate ownership stays with the 18C resolver (authoritative
 * for color/transparency/visibility). Radius semantics: markerScale multiplies
 * the referenced symbol radius in drawing units (NOT paper mm; the SVG/PDF
 * paper-mm gap is a known-future item, see phase18d-point-style-notes.md).
 */
export interface CadPointStyle {
  id: CadPointStyleId;
  name: string;
  /** Ref into styleLibrary.pointSymbols. */
  markerSymbolId: CadPointSymbolId;
  /**
   * Phase 18N: block marker ref (into project.blockDefinitions). Mutually
   * exclusive with markerSymbolId via validateCadPointStyle — when set (and
   * known) the marker renders the block at the point (scale =
   * markerScale, rotation = rotationDeg); markerSymbolId stays as the
   * legacy fallback. Absent on legacy styles = unchanged rendering.
   */
  markerBlockDefinitionId?: string;
  /** Multiplier on the symbol radius (drawing units). Default 1. */
  markerScale?: number;
  /** Marker rotation in degrees. Default 0. */
  rotationDeg?: number;
  /** False = marker not drawn (label/layer visibility unaffected). */
  displayMarker: boolean;
  description?: string;
}
