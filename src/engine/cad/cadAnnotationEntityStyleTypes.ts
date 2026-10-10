/**
 * STRUCT-241.5 CAD annotation entity/style type leaf.
 *
 * Type-only module. It owns the twelve Phase 18O professional annotation
 * entity and style-table contracts extracted verbatim (names, JSDoc, field
 * names, optionality, nullability, discriminants, property order, literal
 * unions, and union member order unchanged) from `cadTypes.ts`, in original
 * source order:
 *
 * - `CadMTextAttachment` — 9-point mtext attachment.
 * - `CadMTextEntity` — mtext annotation entity.
 * - `CadLeaderEntity` — leader annotation entity.
 * - `CadDimensionKind` — dimension kind union.
 * - `CadDimensionEntity` — dimension annotation entity.
 * - `CadBearingDistanceLabelEntity` — bearing/distance label entity.
 * - `CadCurveLabelEntity` — curve label entity.
 * - `CadDimensionStyle` — dimension style table entry.
 * - `CadLeaderStyle` — leader style table entry.
 * - `CadBearingLabelStyle` — bearing/distance label style table entry.
 * - `CadCurveLabelField` — curve label field union.
 * - `CadCurveLabelStyle` — curve label style table entry.
 *
 * Bodies and comments are copied verbatim; the only change is that the base
 * entity, annotation anchor, and primitive identity dependencies now come
 * from their owning leaves instead of `cadTypes`.
 *
 * Contract: type-only imports only, and only from
 * `./cadEntityFoundationTypes` (CadBaseEntity),
 * `./annotation/cadAnnotationAnchorTypes` (CadAnnotationAnchor), and
 * `./cadCorePrimitiveTypes` (CadEntityId, CadTextStyleId). It must never
 * import `cadTypes`, any barrel, an engine runtime module, or
 * `cadTransactions`, and it declares no runtime exports.
 */

import type { CadBaseEntity } from './cadEntityFoundationTypes';
import type { CadAnnotationAnchor } from './annotation/cadAnnotationAnchorTypes';
import type { CadEntityId, CadTextStyleId } from './cadCorePrimitiveTypes';

// ---------------------------------------------------------------------------
// Phase 18O professional annotation entities + style tables (all additive)
// ---------------------------------------------------------------------------

/** 9-point mtext attachment. */
export type CadMTextAttachment =
  | 'top-left' | 'top-center' | 'top-right'
  | 'middle-left' | 'middle-center' | 'middle-right'
  | 'bottom-left' | 'bottom-center' | 'bottom-right';

export interface CadMTextEntity extends CadBaseEntity {
  type: 'mtext';
  x: number;
  y: number;
  text: string;
  textStyleId: CadTextStyleId;
  rotationDeg: number;
  attachment: CadMTextAttachment;
}

export interface CadLeaderEntity extends CadBaseEntity {
  type: 'leader';
  arrowAnchor: CadAnnotationAnchor;
  vertices: { x: number; y: number }[];
  text: string;
  leaderStyleId: string;
  textStyleId?: CadTextStyleId;
  textAttachment?: CadMTextAttachment;
}

export type CadDimensionKind = 'linear' | 'aligned' | 'angular' | 'radius' | 'diameter';

export interface CadDimensionEntity extends CadBaseEntity {
  type: 'dimension';
  dimensionKind: CadDimensionKind;
  anchors: CadAnnotationAnchor[];
  /** Definition-point pair for linear/aligned (anchor pair). */
  defPoint1?: CadAnnotationAnchor;
  defPoint2?: CadAnnotationAnchor;
  orientation?: 'horizontal' | 'vertical' | 'aligned';
  dimLinePoint: { x: number; y: number };
  textPoint?: { x: number; y: number };
  dimensionStyleId: string;
  textOverride?: string;
}

export interface CadBearingDistanceLabelEntity extends CadBaseEntity {
  type: 'bearing-label';
  sourceEntityId: CadEntityId;
  labelStyleId: string;
  offset: { x: number; y: number };
  side?: 'left' | 'right' | 'auto';
  manualTextOverride?: string;
}

export interface CadCurveLabelEntity extends CadBaseEntity {
  type: 'curve-label';
  sourceEntityId: CadEntityId;
  labelStyleId: string;
  offset: { x: number; y: number };
  manualTextOverride?: string;
}

export interface CadDimensionStyle {
  id: string;
  name: string;
  textStyleId: CadTextStyleId;
  arrowBlockDefinitionId: string;
  arrowSize: number;
  arrowSizeMode?: 'model' | 'paper';
  textGap: number;
  extensionOffset: number;
  extensionOvershoot: number;
  decimalPrecision: number;
  prefix?: string;
  suffix?: string;
}

export interface CadLeaderStyle {
  id: string;
  name: string;
  textStyleId: CadTextStyleId;
  arrowBlockDefinitionId: string;
  arrowSize: number;
  arrowSizeMode?: 'model' | 'paper';
  landingLength: number;
  textGap: number;
}

export interface CadBearingLabelStyle {
  id: string;
  name: string;
  textStyleId: CadTextStyleId;
  content: 'bearing' | 'distance' | 'bearing-distance' | 'distance-bearing';
  separator: 'newline' | 'space' | 'slash';
  offset: { x: number; y: number };
  decimalPrecision: number;
}

export type CadCurveLabelField = 'radius' | 'delta' | 'length' | 'chord';

export interface CadCurveLabelStyle {
  id: string;
  name: string;
  textStyleId: CadTextStyleId;
  fields: CadCurveLabelField[];
  offset: { x: number; y: number };
  decimalPrecision: number;
}
