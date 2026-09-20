/**
 * Phase 18P — command-point → annotation anchor factory (pure).
 *
 * Single seam that converts a picked {@link CommandPoint} into the strongest
 * SAFE {@link CadAnnotationAnchor}. "Safe" means the anchor kind is directly
 * supported by `resolveCadAnnotationAnchor` and the snap actually came from
 * the referenced entity — the factory never guesses by nearness, never
 * rebinds by station name, and degrades to `fixed` whenever the association
 * is not provable from the snap payload.
 *
 * SNAP_SUPPORT_MATRIX (snapKind × source entity → anchor):
 *
 * | source entity   | snapKind              | result                                    |
 * |-----------------|-----------------------|-------------------------------------------|
 * | survey-point    | point-node            | survey-point ref                          |
 * | survey-point    | anything else / none  | fixed                                     |
 * | line            | endpoint              | line-endpoint ref (start/end by geometry) |
 * | line            | midpoint / nearest /  | fixed                                     |
 * |                 | anything else / none  |                                           |
 * | arc             | center                | arc-point ref (center)                    |
 * | arc             | endpoint              | arc-point ref (start/end by geometry)     |
 * | arc             | quadrant /            | fixed                                     |
 * |                 | arc-midpoint / nearest|                                           |
 * |                 | / anything else / none|                                           |
 * | block-reference | endpoint at insertion | block-insertion ref                       |
 * |                 | (no segment scope)    |                                           |
 * | block-reference | child endpoint /      | fixed (child has no stable identity;      |
 * |                 | midpoint / center     | segment scope set or snap off insertion)  |
 * | intersection /  | any                   | fixed (derived point, no owning entity)   |
 * | apparent-intx / |                       |                                           |
 * | extension /     |                       |                                           |
 * | perpendicular / |                       |                                           |
 * | parallel /      |                       |                                           |
 * | direction /     |                       |                                           |
 * | tangent         |                       |                                           |
 * | polyline /      | any                   | fixed (vertex ids are unstable by design) |
 * | polygon / other |                       |                                           |
 * | (none — free    | —                     | fixed                                     |
 * | pick / typed)   |                       |                                           |
 * | unknown/missing | any                   | fixed (never guess by nearness)           |
 * | entity          |                       |                                           |
 *
 * Start/end disambiguation (line + arc endpoint snaps) compares the snapped
 * point against the authoritative geometry; the nearer end wins and an exact
 * tie resolves deterministically to `start`.
 */
import { cadArcEndPoint, cadArcStartPoint } from '../cadGeometryArcPrimitives';
import type { CadAnnotationAnchor } from './cadAnnotationAnchors';
import type { CadProject, CadSnapKind } from '../cadTypes';

/**
 * Minimal pick surface the factory reads. `CommandPoint`
 * (src/hooks/surveyCad/useSurveyCadCommandTypes.ts) satisfies this
 * structurally; the factory lives in the engine and deliberately does not
 * import hook types so the dependency points hooks → engine only.
 */
export interface AnchorCommandPoint {
  x: number;
  y: number;
  snapSourceEntityId?: string;
  snapSourceSegmentId?: string;
  snapKind?: CadSnapKind;
}

/** Insertion-point match tolerance (meters). Snap points land exactly on the
 * insertion, so this only absorbs float round-trips, never nearness. */
const BLOCK_INSERTION_EPSILON = 1e-6;

/** Construction/derived snaps never bind: the point has no owning entity. */
const DERIVED_SNAP_KINDS: ReadonlySet<CadSnapKind> = new Set<CadSnapKind>([
  'intersection',
  'apparent-intersection',
  'extension',
  'perpendicular',
  'parallel',
  'direction',
  'tangent',
]);

const nearerEndpoint = (
  point: AnchorCommandPoint,
  startX: number,
  startY: number,
  endX: number,
  endY: number,
): 'start' | 'end' => {
  const startDistance = Math.hypot(point.x - startX, point.y - startY);
  const endDistance = Math.hypot(point.x - endX, point.y - endY);
  // Exact tie (e.g. zero-length line) falls through to 'start' deterministically.
  return endDistance < startDistance ? 'end' : 'start';
};

export const cadAnnotationAnchorFromCommandPoint = (
  project: CadProject,
  point: AnchorCommandPoint,
): CadAnnotationAnchor => {
  const fixed: CadAnnotationAnchor = { kind: 'fixed', x: point.x, y: point.y };
  if (point.snapSourceEntityId === undefined) return fixed;
  if (point.snapKind !== undefined && DERIVED_SNAP_KINDS.has(point.snapKind)) return fixed;
  const entity = project.entities.find((candidate) => candidate.id === point.snapSourceEntityId);
  if (entity === undefined) return fixed;

  switch (entity.type) {
    case 'survey-point':
      // Survey points emit point-node snaps only; anything else is not provable.
      return point.snapKind === 'point-node'
        ? { kind: 'survey-point', entityId: entity.id, fallbackX: point.x, fallbackY: point.y }
        : fixed;
    case 'line':
      if (point.snapKind !== 'endpoint') return fixed;
      return {
        kind: 'line-endpoint',
        entityId: entity.id,
        endpoint: nearerEndpoint(point, entity.fromX, entity.fromY, entity.toX, entity.toY),
        fallbackX: point.x,
        fallbackY: point.y,
      };
    case 'arc':
      if (point.snapKind === 'center') {
        return {
          kind: 'arc-point',
          entityId: entity.id,
          point: 'center',
          fallbackX: point.x,
          fallbackY: point.y,
        };
      }
      if (point.snapKind === 'endpoint') {
        const start = cadArcStartPoint(entity);
        const end = cadArcEndPoint(entity);
        return {
          kind: 'arc-point',
          entityId: entity.id,
          point: nearerEndpoint(point, start.x, start.y, end.x, end.y),
          fallbackX: point.x,
          fallbackY: point.y,
        };
      }
      // quadrant / arc-midpoint / nearest ride the circumference with no
      // stable arc-point identity → fixed.
      return fixed;
    case 'block-reference': {
      // Only the insertion snap binds: it carries no child segment scope and
      // lands on the insertion point (entity.x/entity.y, the same accessor
      // the resolver reads). Child endpoint/midpoint/center snaps carry a
      // `${entity.id}#${childIndex}` scope — or land off the insertion — and
      // stay fixed because expanded children have no stable identity.
      if (point.snapKind !== 'endpoint' || point.snapSourceSegmentId !== undefined) return fixed;
      const offInsertion = Math.hypot(point.x - entity.x, point.y - entity.y);
      return offInsertion <= BLOCK_INSERTION_EPSILON
        ? { kind: 'block-insertion', entityId: entity.id, fallbackX: point.x, fallbackY: point.y }
        : fixed;
    }
    default:
      // Polylines/polygons/parcels/text/everything else: no stable anchor
      // identity (polyline vertex ids shift on edit by design) → fixed.
      return fixed;
  }
};
