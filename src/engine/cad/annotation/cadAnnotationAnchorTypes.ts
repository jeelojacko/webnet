/**
 * STRUCT-195.7 annotation anchor type leaf.
 *
 * Type-only module. It holds the discriminated annotation anchor shapes plus
 * the anchor point / resolution result types so that lower-level modules can
 * depend on them WITHOUT pulling the runtime anchor resolver (and its
 * `cadTypes` import) into their graph.
 *
 * Contract: this file must stay free of value imports and value exports and
 * must export ONLY type aliases / interfaces. `cadAnnotationAnchors.ts`
 * re-exports every name here so existing consumers keep compiling.
 *
 * An annotation point may bind to a stable feature of a model entity instead
 * of freezing raw coordinates. Supported references are the entity kinds with
 * a stable identity: survey points, line endpoints, arc center/start/end, and
 * block insertions. Polyline vertices are intentionally NOT supported: a
 * polyline vertex has no stable id (the index shifts on edit and the
 * render/segment id is `${entity.id}#${index}`), so any polyline vertex
 * binding MUST be persisted as `fixed`.
 */
import type { CadEntityId } from '../cadCorePrimitiveTypes';

export interface CadAnnotationFixedAnchor {
  kind: 'fixed';
  x: number;
  y: number;
}

export interface CadAnnotationSurveyPointAnchor {
  kind: 'survey-point';
  entityId: CadEntityId;
  fallbackX: number;
  fallbackY: number;
}

export interface CadAnnotationLineEndpointAnchor {
  kind: 'line-endpoint';
  entityId: CadEntityId;
  endpoint: 'start' | 'end';
  fallbackX: number;
  fallbackY: number;
}

export interface CadAnnotationArcPointAnchor {
  kind: 'arc-point';
  entityId: CadEntityId;
  point: 'center' | 'start' | 'end';
  fallbackX: number;
  fallbackY: number;
}

export interface CadAnnotationBlockInsertionAnchor {
  kind: 'block-insertion';
  entityId: CadEntityId;
  fallbackX: number;
  fallbackY: number;
}

/** Any entity-bound (non-fixed) annotation anchor. */
export type CadAnnotationAnchorRef =
  | CadAnnotationSurveyPointAnchor
  | CadAnnotationLineEndpointAnchor
  | CadAnnotationArcPointAnchor
  | CadAnnotationBlockInsertionAnchor;

/** Annotation point binding: a frozen point or an associative entity reference. */
export type CadAnnotationAnchor = CadAnnotationFixedAnchor | CadAnnotationAnchorRef;

export interface CadAnnotationAnchorPoint {
  x: number;
  y: number;
}

export type CadAnnotationAnchorResolution =
  | { ok: true; x: number; y: number }
  | { ok: false; fallbackX: number; fallbackY: number; reason: 'BROKEN_REFERENCE' };
