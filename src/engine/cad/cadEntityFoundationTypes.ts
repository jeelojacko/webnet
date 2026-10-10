/**
 * STRUCT-241.3 CAD foundation/appearance/style type leaf.
 *
 * Type-only module. It owns the eight foundation/appearance/style contracts
 * extracted verbatim from `cadTypes.ts`:
 *
 * - `CadEntityAppearance` — appearance intent (color, line type, lineweight,
 *   transparency).
 * - `CadBaseEntity` — the base entity contract.
 * - `CadLineType` — dash-pattern line type.
 * - `CadTextHeightMode` — text height mode union.
 * - `CadTextStyle` — text style with the Phase 18O professional fields.
 * - `CadPointSymbol` — point symbol definition.
 * - `CadStyle` — named style referencing a text style, point symbol, and line
 *   type.
 * - `CadStyleLibrary` — the aggregate line-type/text-style/point-symbol/style
 *   library. In the original `cadTypes.ts` it sat after the survey block, but
 *   it belongs with this foundation/style group in the leaf.
 *
 * Bodies, comments, property order, and optionality are copied verbatim; the
 * only change is that the primitive identity aliases now come from the core
 * leaf instead of being defined locally.
 *
 * Contract: type-only imports only, and only from `./cadCorePrimitiveTypes`.
 * It must never import `cadTypes`, the survey presentation leaf, any barrel,
 * an engine runtime module, or `cadTransactions`, and it declares no runtime
 * exports.
 */

import type { CadEntityId, CadLayerId, CadLineTypeId, CadPointSymbolId, CadPointSymbolShape, CadStyleId, CadTextStyleId } from './cadCorePrimitiveTypes';

export interface CadEntityAppearance {
  /** Hex color; undefined = ByLayer. */
  color?: string;
  /** Undefined = ByLayer. */
  lineTypeId?: CadLineTypeId;
  /** Physical mm; undefined = ByLayer. */
  lineweightMm?: number;
  /** 0 (opaque) .. 1 (fully transparent); undefined = ByLayer. */
  transparency?: number;
}

export interface CadBaseEntity {
  id: CadEntityId;
  type: string;
  layerId: CadLayerId;
  styleId?: CadStyleId;
  visible: boolean;
  locked: boolean;
  /** Appearance intent (ByLayer-or-explicit); absent = ByLayer. Never resolved values. */
  appearance?: CadEntityAppearance;
  metadata?: Record<string, unknown>;
}

export interface CadLineType {
  id: CadLineTypeId;
  name: string;
  dashPattern: number[];
}

export type CadTextHeightMode = 'legacy-screen' | 'model' | 'paper';

export interface CadTextStyle {
  id: CadTextStyleId;
  name: string;
  fontFamily: string;
  fontSize: number;
  /** Phase 18O professional text fields (all optional; absent = legacy). */
  heightMode?: CadTextHeightMode;
  modelHeight?: number;
  paperHeightMm?: number;
  widthFactor?: number;
  lineSpacingFactor?: number;
  fontWeight?: 'normal' | 'bold';
  fontStyle?: 'normal' | 'italic';
}

export interface CadPointSymbol {
  id: CadPointSymbolId;
  name: string;
  radius: number;
  /** Symbol shape (default circle). Optional so legacy files open unchanged. */
  shape?: CadPointSymbolShape;
}

export interface CadStyle {
  id: CadStyleId;
  name: string;
  color?: string;
  strokeWidth?: number;
  textStyleId?: CadTextStyleId;
  pointSymbolId?: CadPointSymbolId;
  lineTypeId?: CadLineTypeId;
}

export interface CadStyleLibrary {
  lineTypes: CadLineType[];
  textStyles: CadTextStyle[];
  pointSymbols: CadPointSymbol[];
  styles: CadStyle[];
}
