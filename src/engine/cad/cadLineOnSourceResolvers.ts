/**
 * CAD Draw L1 correction — point-on-source resolution and source frames for
 * the corrected `LINE_TANGENT_POINT` / `LINE_PERP_POINT` interaction law.
 *
 * Both corrected modes are three-phase:
 *   A. pick a source body (line / arc / circle);
 *   B. pick an exact start point ON that source (finite-segment / finite-sweep
 *      membership, residual-checked);
 *   C. enter a signed distance, or click one of the two source-frame rays.
 *
 * A source frame carries two unit directions:
 *   - `tangent`: line forward (from→to) / arc signed-sweep travel tangent /
 *     circle counter-clockwise travel tangent (documented convention);
 *   - `normal`:  line LEFT normal (x east, y north ⇒ rotate +90°); arc/circle
 *     outward radial.
 *
 * A positive signed distance travels along the chosen direction; a negative one
 * travels its reverse. This module is pure engine math: no screen space, no
 * NaN/Inf, canonical tolerances, and the resolved start is always the exact
 * projection of the pick onto the source object.
 */
import {
  cadAngleDegFromCenter,
  cadDistance,
  cadIsAngleOnArcSweep,
  cadPointOnCircle,
  cadProjectPointOntoInfiniteLine,
  cadSignedSweepDeg,
  type CadWorldPoint,
} from './cadGeometry';
import {
  CAD_LINE_DEGENERATE_FLOOR,
  cadLineFail,
  cadLineOk,
  type CadLineResult,
} from './cadLineTypes';
import type { CadArcEntity, CadCircleEntity, CadEntity, CadLineEntity } from './cadTypes';

/** Source object kinds the corrected tangent/normal modes accept. */
export type CadLineSourceEntity = CadLineEntity | CadArcEntity | CadCircleEntity;

/** Which source-frame direction the corrected modes travel along. */
export type CadLineSourceMode = 'tangent' | 'normal';

/**
 * Production residual tolerance: a pick must lie within this fraction of the
 * source's characteristic size (line length / radius) of the source curve, or
 * within the canonical line floor, whichever is larger. The resolved start is
 * always the exact projection, so this only rejects wildly-off picks; it never
 * moves the start off the source.
 */
export const CAD_LINE_SOURCE_RESIDUAL_RATIO = 0.05;

export const cadLineSourceResidualTolerance = (characteristicSize: number): number =>
  Math.max(Math.abs(characteristicSize) * CAD_LINE_SOURCE_RESIDUAL_RATIO, CAD_LINE_DEGENERATE_FLOOR);

/** Narrow a `CadEntity` to the source kinds the corrected modes accept. */
export const isCadLineSourceEntity = (
  entity: CadEntity | null | undefined,
): entity is CadLineSourceEntity =>
  entity != null && (entity.type === 'line' || entity.type === 'arc' || entity.type === 'circle');

const isFinitePoint = (point: CadWorldPoint): boolean =>
  Number.isFinite(point.x) && Number.isFinite(point.y);

const unitVector = (vector: CadWorldPoint): CadWorldPoint | null => {
  const length = Math.hypot(vector.x, vector.y);
  if (!Number.isFinite(length) || length <= CAD_LINE_DEGENERATE_FLOOR) return null;
  return { x: vector.x / length, y: vector.y / length };
};

/** Left normal of a unit direction (x east, y north): rotate +90°. */
export const cadLineLeftNormal = (direction: CadWorldPoint): CadWorldPoint => ({
  x: -direction.y === 0 ? 0 : -direction.y,
  y: direction.x === 0 ? 0 : direction.x,
});

export interface CadLineSourceFrame {
  /** Exact point on the source. */
  point: CadWorldPoint;
  /** Source tangent at the point (forward = line from→to / arc sweep / circle CCW). */
  tangent: CadWorldPoint;
  /** Source normal at the point (line LEFT normal; outward radial for arc/circle). */
  normal: CadWorldPoint;
}

/**
 * Project a pick onto the source and enforce membership: a line pick must land
 * on the finite segment (within the residual tolerance), an arc pick must land
 * on the finite sweep, and a circle pick has no sweep restriction. Non-finite
 * input, an unusable source, and off-object picks fail closed.
 */
export const projectCadLinePointOntoSource = (
  entity: CadLineSourceEntity,
  pick: CadWorldPoint,
): CadLineResult<CadWorldPoint> => {
  if (!isFinitePoint(pick)) return cadLineFail('NON_FINITE', 'Pick point is not finite.');
  if (entity.type === 'line') {
    const start = { x: entity.fromX, y: entity.fromY };
    const end = { x: entity.toX, y: entity.toY };
    const length = cadDistance(start, end);
    if (!Number.isFinite(length) || length <= CAD_LINE_DEGENERATE_FLOOR) {
      return cadLineFail('DEGENERATE', 'Source line has zero length.');
    }
    const tolerance = cadLineSourceResidualTolerance(length);
    const projection = cadProjectPointOntoInfiniteLine(pick, start, end);
    if (cadDistance(pick, projection.point) > tolerance) {
      return cadLineFail('NO_SOLUTION', 'Pick is not on the source line.');
    }
    const parameterTolerance = tolerance / length;
    if (projection.t < -parameterTolerance || projection.t > 1 + parameterTolerance) {
      return cadLineFail('NO_SOLUTION', 'Pick lies beyond the finite source segment.');
    }
    const clampedT = Math.min(1, Math.max(0, projection.t));
    return cadLineOk({
      x: start.x + (end.x - start.x) * clampedT,
      y: start.y + (end.y - start.y) * clampedT,
    });
  }
  const center = { x: entity.centerX, y: entity.centerY };
  if (!isFinitePoint(center)) return cadLineFail('NON_FINITE', 'Source center is not finite.');
  if (!Number.isFinite(entity.radius) || entity.radius <= CAD_LINE_DEGENERATE_FLOOR) {
    return cadLineFail('DEGENERATE', 'Source circle/arc has an unusable radius.');
  }
  const radialDistance = cadDistance(pick, center);
  if (Math.abs(radialDistance - entity.radius) > cadLineSourceResidualTolerance(entity.radius)) {
    return cadLineFail('NO_SOLUTION', 'Pick is not on the source arc/circle.');
  }
  const angleDeg = cadAngleDegFromCenter(center, pick);
  if (
    entity.type === 'arc' &&
    !cadIsAngleOnArcSweep(angleDeg, entity.startAngleDeg, entity.endAngleDeg)
  ) {
    return cadLineFail('OFF_SWEEP', 'Pick is off the finite source arc sweep.');
  }
  return cadLineOk(cadPointOnCircle(center, entity.radius, angleDeg));
};

/**
 * Build the source frame for an already-exact on-source point. The forward
 * conventions are: line from→to; arc signed-sweep travel; circle CCW. An arc
 * whose signed sweep is negative travels clockwise. The normal is the left
 * normal for lines and the outward radial for arcs/circles.
 */
export const resolveCadLineSourceFrame = (
  entity: CadLineSourceEntity,
  point: CadWorldPoint,
): CadLineResult<CadLineSourceFrame> => {
  if (!isFinitePoint(point)) return cadLineFail('NON_FINITE', 'Source point is not finite.');
  if (entity.type === 'line') {
    const tangent = unitVector({ x: entity.toX - entity.fromX, y: entity.toY - entity.fromY });
    if (!tangent) return cadLineFail('DEGENERATE', 'Source line has zero length.');
    return cadLineOk({ point: { ...point }, tangent, normal: cadLineLeftNormal(tangent) });
  }
  const center = { x: entity.centerX, y: entity.centerY };
  const radial = unitVector({ x: point.x - center.x, y: point.y - center.y });
  if (!radial) return cadLineFail('DEGENERATE', 'Source point coincides with the center.');
  const counterClockwise =
    entity.type === 'circle' || cadSignedSweepDeg(entity.startAngleDeg, entity.endAngleDeg) >= 0;
  const tangent = counterClockwise
    ? cadLineLeftNormal(radial)
    : { x: radial.y, y: -radial.x };
  return cadLineOk({ point: { ...point }, tangent, normal: radial });
};

/** Project a pick onto the source and return its exact frame (membership law). */
export const resolveCadLineOnSourcePoint = (
  entity: CadLineSourceEntity,
  pick: CadWorldPoint,
): CadLineResult<CadLineSourceFrame> => {
  const projected = projectCadLinePointOntoSource(entity, pick);
  if (!projected.ok) return projected;
  return resolveCadLineSourceFrame(entity, projected.value);
};

/** Pick the ray direction a corrected mode travels along. */
export const cadLineSourceDirection = (
  frame: CadLineSourceFrame,
  mode: CadLineSourceMode,
): CadWorldPoint => (mode === 'tangent' ? frame.tangent : frame.normal);

/**
 * Endpoint at a signed distance along a unit ray. A zero or sub-floor distance
 * is a degenerate line and fails closed.
 */
export const resolveCadLineRayEndpoint = (
  origin: CadWorldPoint,
  direction: CadWorldPoint,
  signedDistance: number,
): CadLineResult<CadWorldPoint> => {
  if (!isFinitePoint(origin) || !isFinitePoint(direction)) {
    return cadLineFail('NON_FINITE', 'Ray origin/direction is not finite.');
  }
  if (!Number.isFinite(signedDistance)) {
    return cadLineFail('NON_FINITE', `Distance ${signedDistance} is not finite.`);
  }
  if (Math.abs(signedDistance) <= CAD_LINE_DEGENERATE_FLOOR) {
    return cadLineFail('DISTANCE_OUT_OF_RANGE', 'Distance must be non-zero and above the CAD floor.');
  }
  return cadLineOk({
    x: origin.x + direction.x * signedDistance,
    y: origin.y + direction.y * signedDistance,
  });
};

/**
 * Constrain an endpoint click to the two source rays (direction and its
 * reverse): the nearest ray wins by the sign of the projection. A click on the
 * perpendicular bisector (projection within the CAD floor) is a tie and fails
 * closed so the operator repicks — array/ray order never decides.
 */
export const resolveCadLineRayClick = (
  origin: CadWorldPoint,
  direction: CadWorldPoint,
  cursor: CadWorldPoint,
): CadLineResult<{ endpoint: CadWorldPoint; signedDistance: number }> => {
  if (!isFinitePoint(origin) || !isFinitePoint(direction) || !isFinitePoint(cursor)) {
    return cadLineFail('NON_FINITE', 'Ray/click inputs must be finite.');
  }
  const signedDistance =
    (cursor.x - origin.x) * direction.x + (cursor.y - origin.y) * direction.y;
  if (Math.abs(signedDistance) <= CAD_LINE_DEGENERATE_FLOOR) {
    return cadLineFail(
      'AMBIGUOUS_POINT',
      'Endpoint click is equidistant from the two source rays; click clearly along one ray.',
    );
  }
  return cadLineOk({
    endpoint: {
      x: origin.x + direction.x * signedDistance,
      y: origin.y + direction.y * signedDistance,
    },
    signedDistance,
  });
};
