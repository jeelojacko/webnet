/**
 * Phase 18O — associative annotation anchor resolution (pure).
 *
 * An annotation point may bind to a stable feature of a model entity instead
 * of freezing raw coordinates. Supported references are the entity kinds with
 * a stable identity: survey points, line endpoints, arc center/start/end, and
 * block insertions. Polyline vertices are intentionally NOT supported: a
 * polyline vertex has no stable id (the index shifts on edit and the
 * render/segment id is `${entity.id}#${index}`), so any polyline vertex
 * binding MUST be persisted as `fixed`.
 *
 * Resolution never silently rebinds by station name: a missing entity or a
 * type mismatch yields `BROKEN_REFERENCE` together with the persisted
 * fallback point. Broken references stay broken until explicitly repaired.
 */
import { cadArcEndPoint, cadArcStartPoint } from '../cadGeometryArcPrimitives';
import type { CadProjectLookup } from '../cadProjectLookup';
import type { CadEntity, CadProject } from '../cadTypes';
import type {
  CadAnnotationAnchor,
  CadAnnotationAnchorPoint,
  CadAnnotationAnchorRef,
  CadAnnotationAnchorResolution,
  CadAnnotationFixedAnchor,
} from './cadAnnotationAnchorTypes';

export type {
  CadAnnotationAnchor,
  CadAnnotationAnchorPoint,
  CadAnnotationAnchorRef,
  CadAnnotationAnchorResolution,
  CadAnnotationArcPointAnchor,
  CadAnnotationBlockInsertionAnchor,
  CadAnnotationFixedAnchor,
  CadAnnotationLineEndpointAnchor,
  CadAnnotationSurveyPointAnchor,
} from './cadAnnotationAnchorTypes';

/** Fallback point persisted alongside every anchor (the raw point for `fixed`). */
export function anchorFallbackPoint(anchor: CadAnnotationAnchor): CadAnnotationAnchorPoint {
  return anchor.kind === 'fixed'
    ? { x: anchor.x, y: anchor.y }
    : { x: anchor.fallbackX, y: anchor.fallbackY };
}

function brokenResolution(anchor: CadAnnotationAnchorRef): CadAnnotationAnchorResolution {
  const fallback = anchorFallbackPoint(anchor);
  return { ok: false, fallbackX: fallback.x, fallbackY: fallback.y, reason: 'BROKEN_REFERENCE' };
}

function resolveEntityAnchor(
  anchor: CadAnnotationAnchorRef,
  entity: CadEntity,
): CadAnnotationAnchorPoint | null {
  switch (anchor.kind) {
    case 'survey-point':
      return entity.type === 'survey-point' ? { x: entity.x, y: entity.y } : null;
    case 'line-endpoint':
      if (entity.type !== 'line') return null;
      return anchor.endpoint === 'start'
        ? { x: entity.fromX, y: entity.fromY }
        : { x: entity.toX, y: entity.toY };
    case 'arc-point':
      // Circles associate ONLY via the center anchor: a circle has no
      // start/end points, so those stay BROKEN (never fake endpoints).
      // No new anchor kind is needed: 'center' already exists.
      if (entity.type === 'circle') {
        return anchor.point === 'center' ? { x: entity.centerX, y: entity.centerY } : null;
      }
      if (entity.type !== 'arc') return null;
      if (anchor.point === 'center') return { x: entity.centerX, y: entity.centerY };
      return anchor.point === 'start' ? cadArcStartPoint(entity) : cadArcEndPoint(entity);
    case 'block-insertion':
      return entity.type === 'block-reference' ? { x: entity.x, y: entity.y } : null;
  }
}

/**
 * Resolve an anchor against the project's top-level entities. Pure: performs
 * no mutation, no unit conversion, and no rebinding by station name.
 */
export function resolveCadAnnotationAnchor(
  anchor: CadAnnotationAnchor,
  project: CadProject,
  lookup?: CadProjectLookup,
): CadAnnotationAnchorResolution {
  if (anchor.kind === 'fixed') return { ok: true, x: anchor.x, y: anchor.y };
  const entity = lookup
    ? lookup.entityById.get(anchor.entityId)
    : project.entities.find((candidate) => candidate.id === anchor.entityId);
  if (entity === undefined) return brokenResolution(anchor);
  const point = resolveEntityAnchor(anchor, entity);
  return point === null ? brokenResolution(anchor) : { ok: true, x: point.x, y: point.y };
}

/** True when `anchor` is an entity reference that currently cannot resolve. */
export function isAnchorBroken(anchor: CadAnnotationAnchor, project: CadProject): boolean {
  return !resolveCadAnnotationAnchor(anchor, project).ok;
}

/** Convert any anchor to a frozen point at its fallback (repair / detach). */
export function fixAnchor(anchor: CadAnnotationAnchor): CadAnnotationFixedAnchor {
  const point = anchorFallbackPoint(anchor);
  return { kind: 'fixed', x: point.x, y: point.y };
}
