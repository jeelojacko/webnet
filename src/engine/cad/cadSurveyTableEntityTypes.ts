/**
 * STRUCT-241.5 CAD survey-table entity type leaf.
 *
 * Type-only module. It owns the seven survey table (drawing annotation table)
 * contracts extracted verbatim (names, JSDoc, field names, optionality,
 * discriminants, property order, literal unions, and union member order
 * unchanged) from `cadTypes.ts`, in original source order:
 *
 * - `CadSurveyTableKind` — survey table kind literal union.
 * - `CadSurveyTableRowSource` — discriminated row source reference union.
 * - `CadSurveyTableRow` — row identity + source + optional tag overrides.
 * - `CadSurveyTableTagSettings` — tag visibility/prefix/style/offset settings.
 * - `CadSurveyTableColumnOverride` — per-column visibility + heading override.
 * - `CadSurveyTableEntity` — placement + style + row list annotation entity.
 * - `CadSurveyTableStyle` — display-only survey table style.
 *
 * Bodies and comments are copied verbatim, preserving the source-reference
 * row semantics (rows are SOURCE REFERENCES resolved at read time, never baked
 * geometry/text) and the paper/model display-only style convention. The only
 * change is that the base entity and primitive identity dependencies now come
 * from their owning leaves instead of `cadTypes`.
 *
 * Contract: type-only imports only, and only from
 * `./cadEntityFoundationTypes` (CadBaseEntity) and `./cadCorePrimitiveTypes`
 * (CadEntityId, CadTextStyleId). It must never import `cadTypes`, any barrel,
 * an engine runtime module, or `cadTransactions`, and it declares no runtime
 * exports.
 */

import type { CadBaseEntity } from './cadEntityFoundationTypes';
import type { CadEntityId, CadTextStyleId } from './cadCorePrimitiveTypes';

/**
 * Phase 19A survey table (drawing annotation table). Rows are SOURCE
 * REFERENCES resolved at read time (never baked geometry/text); the entity
 * is placement + style + row list only.
 */
export type CadSurveyTableKind = 'line' | 'curve' | 'parcel-course' | 'parcel-summary' | 'point';

export type CadSurveyTableRowSource =
  | { kind: 'line'; entityId: CadEntityId }
  | { kind: 'arc'; entityId: CadEntityId }
  | { kind: 'parcel-course'; parcelId: CadEntityId; courseId: string }
  | { kind: 'parcel'; parcelId: CadEntityId }
  | { kind: 'survey-point'; entityId: CadEntityId };

export interface CadSurveyTableRow {
  /** Stable row identity (reorder/remove/custom-code target). */
  id: string;
  source: CadSurveyTableRowSource;
  customCode?: string;
  /** Explicit tag offset override (WINS over the entity tagSettings). */
  tagOffset?: { dx: number; dy: number };
  showTag?: boolean;
}

export interface CadSurveyTableTagSettings {
  showTags?: boolean;
  /** Extra prefix prepended to every tag string (e.g. `T-`). */
  tagPrefix?: string;
  /** Text style for tag labels; absent = table text style. */
  tagTextStyleId?: CadTextStyleId;
  /** Default tag offset (drawing units) relative to the derived anchor. */
  tagOffset?: { dx: number; dy: number };
}

/** Per-column display override: visibility toggle + heading text. */
export interface CadSurveyTableColumnOverride {
  key: string;
  visible?: boolean;
  heading?: string;
}

export interface CadSurveyTableEntity extends CadBaseEntity {
  type: 'survey-table';
  tableKind: CadSurveyTableKind;
  /** Insertion point (world/drawing units). */
  x: number;
  y: number;
  rotationDeg: number;
  tableStyleId: string;
  rows: CadSurveyTableRow[];
  title?: string;
  /** Code prefix (e.g. `L`); absent/empty = per-kind default (L/C/P). */
  prefix?: string;
  /** First code number; absent = 1. */
  startNumber?: number;
  showHeader?: boolean;
  showTitle?: boolean;
  tagSettings?: CadSurveyTableTagSettings;
  /** Per-column visibility/heading overrides (registry order preserved). */
  columnOverrides?: CadSurveyTableColumnOverride[];
}

/**
 * Phase 19A survey table display style. Paper/model modes mirror the text
 * height mode convention; every field is display-only (no geometry).
 */
export interface CadSurveyTableStyle {
  id: string;
  name: string;
  textStyleId: CadTextStyleId;
  headerTextStyleId?: CadTextStyleId;
  rowHeight: number;
  rowHeightMode: 'model' | 'paper';
  cellPadding: number;
  cellPaddingMode: 'model' | 'paper';
  borderWidth: number;
  showOuterBorder: boolean;
  showInnerGrid: boolean;
  headerAlignment: 'left' | 'center' | 'right';
  bodyAlignment: 'left' | 'center' | 'right';
  titleGap: number;
  description?: string;
}
