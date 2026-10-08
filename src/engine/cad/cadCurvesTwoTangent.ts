import {
  cadAngleDegFromCenter,
  cadAzimuthDeg,
  cadDistance,
  cadInfiniteLineIntersection,
  cadNormalizeAngleDeg,
  cadProjectPointOntoInfiniteLine,
  type CadArcDefinition,
  type CadWorldPoint,
} from './cadGeometry';
import { cadIsAngleOnArcSweep } from './cadGeometryArcPrimitives';
import { cadBuildArcFromCenterSweep, cadCounterClockwiseDeltaDeg } from './cadGeometryCurveCore';
import { CAD_XY_DEGENERATE_FLOOR } from './cadGeometryShapeBuilders';
import type { CadCurveMetricsSummary } from './cadCogoCurveMetrics';
import {
  buildCadCurveMetricsSummaryFromRadiusDeltaDeg,
  isValidCadCurveDeltaDeg,
  isValidCadCurveRadius,
  solveCadCurveMetricsFromDelta,
  type CadCurveMetricMode,
} from './cadCurveMetricsSolver';

/**
 * Phase F1 — shared two-tangent ray resolver and the Between / Through-point
 * kernels. Pure geometry: no project/session/transaction access.
 *
 * A "ray" is the half-line from the supporting-line intersection `PI` toward
 * the picked projection on each source line. The resolver is permutation-proof:
 * swapping the two sources, or reversing a source's endpoint order, resolves
 * the same `PI` and the same retained half-lines.
 */

/** Angular conditioning floor for near-parallel supporting lines. Matches the
 * existing FILLET line/line angular guard (`1e-6` rad). */
export const CAD_CURVE_PARALLEL_SIN_FLOOR = 1e-6;

/**
 * Multiplier applied to `Number.EPSILON` when deciding whether a quadratic
 * discriminant is numerically zero. `b*b - 4*a*c` is computed by catastrophic
 * cancellation whenever the through point lies (near) on a source ray, where
 * the true discriminant is zero; the residue is relative to the magnitude of
 * `b*b` and `4*a*c`, not to a squared length tolerance. A few ulps is enough
 * to absorb the cancellation while still rejecting materially negative roots.
 */
const CAD_CURVE_DISCRIMINANT_EPS_FACTOR = 32;

export interface CadCurveLineInput {
  entityId: string;
  segmentId?: string;
  start: CadWorldPoint;
  end: CadWorldPoint;
}

export interface CadCurveRay {
  entityId: string;
  segmentId?: string;
  /** Unit direction from PI toward the picked projection (the retained ray). */
  direction: CadWorldPoint;
  azimuthDeg: number;
  pickProjection: CadWorldPoint;
  segmentParameter: number;
  /** True when the source's `start` end lies on the trimmed-away side. */
  trimStart: boolean;
  distanceToPickProjection: number;
  /** Distance from PI to the pick-side segment endpoint along the ray. */
  distanceToSegmentEnd: number;
}

export interface CadTwoTangentRays {
  pi: CadWorldPoint;
  ray1: CadCurveRay;
  ray2: CadCurveRay;
  /** Unit travel direction into PI (== -ray1.direction). */
  incomingTangent: CadWorldPoint;
  /** Unit travel direction out of PI (== ray2.direction). */
  outgoingTangent: CadWorldPoint;
  signedTurnDeg: number;
  turnSide: 'left' | 'right';
  /** Absolute turn angle in (0, 180). */
  deltaDeg: number;
  /** Angle between the two ray directions in (0, 180). */
  rayAngleDeg: number;
}

export interface CadCurveMetricRequest {
  mode: CadCurveMetricMode;
  value: number;
}

export interface CadCurveArcResult {
  arc: CadArcDefinition;
  pc: CadWorldPoint;
  pt: CadWorldPoint;
  metrics: CadCurveMetricsSummary;
  withinPickedExtent: boolean;
}

export type CadCurveFailureCode =
  | 'DEGENERATE_RAYS'
  | 'METRIC_INVALID'
  | 'NO_SOLUTION'
  | 'MULTIPLE_SOLUTIONS'
  | 'CURVES_CANNOT_FIT'
  | 'INVALID_CHAIN'
  | 'COLLINEAR';

export type CadCurveArcOutcome =
  | { ok: true; result: CadCurveArcResult }
  | { ok: false; code: CadCurveFailureCode };

export interface CadCurveThroughPointCandidate extends CadCurveArcResult {
  side: 'left' | 'right';
}

export type CadCurveThroughPointOutcome =
  | { ok: true; result: CadCurveThroughPointCandidate; candidates: CadCurveThroughPointCandidate[] }
  | { ok: false; code: CadCurveFailureCode; candidates: CadCurveThroughPointCandidate[] };

const isFinitePoint = (point: CadWorldPoint): boolean =>
  Number.isFinite(point.x) && Number.isFinite(point.y);

const unitVector = (from: CadWorldPoint, to: CadWorldPoint): CadWorldPoint | null => {
  const dx = to.x - from.x;
  const dy = to.y - from.y;
  const length = Math.hypot(dx, dy);
  if (!Number.isFinite(length) || length <= CAD_XY_DEGENERATE_FLOOR) return null;
  return { x: dx / length, y: dy / length };
};

const cross = (a: CadWorldPoint, b: CadWorldPoint): number => a.x * b.y - a.y * b.x;

/** Smallest absolute separation between two angles in degrees, in `[0, 180]`. */
const angleSeparationDeg = (aDeg: number, bDeg: number): number => {
  const delta = Math.abs(cadNormalizeAngleDeg(aDeg - bDeg));
  return Math.min(delta, 360 - delta);
};

const scaleOf = (lines: readonly CadCurveLineInput[], picks: readonly CadWorldPoint[]): number => {
  let scale = 1;
  for (const line of lines) {
    for (const point of [line.start, line.end]) {
      scale = Math.max(scale, Math.abs(point.x), Math.abs(point.y));
    }
  }
  for (const point of picks) scale = Math.max(scale, Math.abs(point.x), Math.abs(point.y));
  return scale;
};

const buildRay = (
  line: CadCurveLineInput,
  pick: CadWorldPoint,
  pi: CadWorldPoint,
  tolerance: number,
): CadCurveRay | null => {
  const projection = cadProjectPointOntoInfiniteLine(pick, line.start, line.end);
  let vector = { x: projection.point.x - pi.x, y: projection.point.y - pi.y };
  let length = Math.hypot(vector.x, vector.y);
  if (length <= tolerance) {
    vector = { x: pick.x - pi.x, y: pick.y - pi.y };
    length = Math.hypot(vector.x, vector.y);
  }
  if (length <= tolerance) {
    const startDistance = cadDistance(pi, line.start);
    const endDistance = cadDistance(pi, line.end);
    const farther = startDistance >= endDistance ? line.start : line.end;
    vector = { x: farther.x - pi.x, y: farther.y - pi.y };
    length = Math.hypot(vector.x, vector.y);
  }
  if (!Number.isFinite(length) || length <= tolerance) return null;

  const intersectionProjection = cadProjectPointOntoInfiniteLine(pi, line.start, line.end);
  const keepStartSide =
    Math.abs(projection.t - intersectionProjection.t) <= 1e-9
      ? cadDistance(projection.point, line.start) <= cadDistance(projection.point, line.end)
      : projection.t <= intersectionProjection.t;
  const trimStart = !keepStartSide;
  const direction = { x: vector.x / length, y: vector.y / length };
  return {
    entityId: line.entityId,
    ...(line.segmentId != null ? { segmentId: line.segmentId } : {}),
    direction,
    azimuthDeg: cadAzimuthDeg({ x: 0, y: 0 }, direction),
    pickProjection: { ...projection.point },
    segmentParameter: projection.t,
    trimStart,
    distanceToPickProjection: cadDistance(pi, projection.point),
    distanceToSegmentEnd: trimStart ? cadDistance(pi, line.end) : cadDistance(pi, line.start),
  };
};

/**
 * Resolve two picked lines + picks into PI and the retained rays.
 * Returns `null` for the same entity, zero-length segments, parallel/near-parallel
 * supporting lines, or a degenerate (zero / near-180) turn.
 */
export const resolveTwoTangentRays = (
  line1: CadCurveLineInput,
  line2: CadCurveLineInput,
  pick1: CadWorldPoint,
  pick2: CadWorldPoint,
): CadTwoTangentRays | null => {
  if (line1.entityId === line2.entityId) return null;
  if (!isFinitePoint(line1.start) || !isFinitePoint(line1.end)) return null;
  if (!isFinitePoint(line2.start) || !isFinitePoint(line2.end)) return null;
  if (!isFinitePoint(pick1) || !isFinitePoint(pick2)) return null;
  if (cadDistance(line1.start, line1.end) <= CAD_XY_DEGENERATE_FLOOR) return null;
  if (cadDistance(line2.start, line2.end) <= CAD_XY_DEGENERATE_FLOOR) return null;

  const direction1 = unitVector(line1.start, line1.end);
  const direction2 = unitVector(line2.start, line2.end);
  if (!direction1 || !direction2) return null;
  if (Math.abs(cross(direction1, direction2)) <= CAD_CURVE_PARALLEL_SIN_FLOOR) return null;

  const pi = cadInfiniteLineIntersection(line1.start, line1.end, line2.start, line2.end);
  if (!pi || !isFinitePoint(pi)) return null;

  const tolerance = CAD_XY_DEGENERATE_FLOOR * scaleOf([line1, line2], [pick1, pick2]);
  const ray1 = buildRay(line1, pick1, pi, tolerance);
  const ray2 = buildRay(line2, pick2, pi, tolerance);
  if (!ray1 || !ray2) return null;

  const dotRays = Math.max(
    -1,
    Math.min(1, ray1.direction.x * ray2.direction.x + ray1.direction.y * ray2.direction.y),
  );
  const rayAngleDeg = (Math.acos(dotRays) * 180) / Math.PI;
  const deltaDeg = 180 - rayAngleDeg;
  if (!isValidCadCurveDeltaDeg(deltaDeg)) return null;

  const incomingTangent = { x: -ray1.direction.x, y: -ray1.direction.y };
  const outgoingTangent = { ...ray2.direction };
  const signedTurnDeg =
    (Math.atan2(cross(incomingTangent, outgoingTangent), incomingTangent.x * outgoingTangent.x + incomingTangent.y * outgoingTangent.y) *
      180) /
    Math.PI;

  return {
    pi: { ...pi },
    ray1,
    ray2,
    incomingTangent,
    outgoingTangent,
    signedTurnDeg,
    turnSide: signedTurnDeg >= 0 ? 'left' : 'right',
    deltaDeg,
    rayAngleDeg,
  };
};

const clampUnit = (value: number): number => Math.max(-1, Math.min(1, value));

/**
 * Build the minor tangent arc for a resolved ray pair from already-solved
 * metrics. Shared by Between (trim) and On (no trim) — the geometry is identical.
 */
export const buildCadCurveArcFromRaysAndMetrics = (
  rays: CadTwoTangentRays,
  metrics: CadCurveMetricsSummary,
): CadCurveArcOutcome => {
  const { pi, ray1, ray2 } = rays;
  const radius = metrics.radius;
  const deltaDeg = metrics.deltaDeg;
  if (!isValidCadCurveRadius(radius) || !isValidCadCurveDeltaDeg(deltaDeg)) {
    return { ok: false, code: 'METRIC_INVALID' };
  }
  const halfRad = ((180 - deltaDeg) * Math.PI) / 360;
  const sinHalf = Math.sin(halfRad);
  if (Math.abs(sinHalf) <= CAD_XY_DEGENERATE_FLOOR) return { ok: false, code: 'DEGENERATE_RAYS' };

  const tangentLength = metrics.tangentLength;
  const centerDistance = radius / sinHalf;
  const bisectorVector = {
    x: ray1.direction.x + ray2.direction.x,
    y: ray1.direction.y + ray2.direction.y,
  };
  const bisectorLength = Math.hypot(bisectorVector.x, bisectorVector.y);
  if (!Number.isFinite(bisectorLength) || bisectorLength <= CAD_XY_DEGENERATE_FLOOR) {
    return { ok: false, code: 'DEGENERATE_RAYS' };
  }

  const pc = {
    x: pi.x + ray1.direction.x * tangentLength,
    y: pi.y + ray1.direction.y * tangentLength,
  };
  const pt = {
    x: pi.x + ray2.direction.x * tangentLength,
    y: pi.y + ray2.direction.y * tangentLength,
  };
  const center = {
    x: pi.x + (bisectorVector.x / bisectorLength) * centerDistance,
    y: pi.y + (bisectorVector.y / bisectorLength) * centerDistance,
  };
  const startAngleDeg = cadAngleDegFromCenter(center, pc);
  const endAngleDeg = cadAngleDegFromCenter(center, pt);
  const ccwDelta = cadCounterClockwiseDeltaDeg(startAngleDeg, endAngleDeg);
  const signedSweep = ccwDelta <= 180 ? ccwDelta : -(360 - ccwDelta);
  const arc = cadBuildArcFromCenterSweep(center, radius, startAngleDeg, signedSweep);
  if (!arc) return { ok: false, code: 'DEGENERATE_RAYS' };

  const tolerance = CAD_XY_DEGENERATE_FLOOR * Math.max(1, Math.abs(pi.x), Math.abs(pi.y));
  const withinPickedExtent =
    tangentLength <= ray1.distanceToPickProjection + tolerance &&
    tangentLength <= ray2.distanceToPickProjection + tolerance;

  return {
    ok: true,
    result: {
      arc,
      pc: { ...arc.startPoint },
      pt: { ...arc.endPoint },
      metrics,
      withinPickedExtent,
    },
  };
};

/**
 * Contract 1/2 — Between (trim) / On (no trim). Both share this kernel; the
 * caller records whether to trim. `metric` supplies the radius at the fixed
 * turn angle of the rays.
 */
export const buildCadCurveBetweenTangentRays = (
  rays: CadTwoTangentRays,
  metric: CadCurveMetricRequest,
): CadCurveArcOutcome => {
  const metrics = solveCadCurveMetricsFromDelta({
    deltaDeg: rays.deltaDeg,
    mode: metric.mode,
    value: metric.value,
  });
  if (!metrics) return { ok: false, code: 'METRIC_INVALID' };
  return buildCadCurveArcFromRaysAndMetrics(rays, metrics);
};

const solveBisectorCenters = (
  pi: CadWorldPoint,
  throughPoint: CadWorldPoint,
  bisector: CadWorldPoint,
  sinHalf: number,
  cosHalf: number,
  tolerance: number,
): CadWorldPoint[] => {
  const w = { x: pi.x - throughPoint.x, y: pi.y - throughPoint.y };
  const wb = w.x * bisector.x + w.y * bisector.y;
  const a = cosHalf * cosHalf;
  const b = 2 * wb;
  const c = w.x * w.x + w.y * w.y;
  const discriminant = b * b - 4 * a * c;
  if (a <= CAD_XY_DEGENERATE_FLOOR) return [];
  // Scale-aware zero test. A discriminant at the level of rounding noise in
  // `b*b` / `4*a*c` is a true double root (through point on a source ray), not
  // a rejection and not two phantom near-identical circles: clamp it to a
  // single double root. Only materially negative values are rejected.
  const discriminantScale = b * b + Math.abs(4 * a * c);
  const discriminantEpsilon = CAD_CURVE_DISCRIMINANT_EPS_FACTOR * Number.EPSILON * discriminantScale;
  if (discriminant < -discriminantEpsilon) return [];
  const root = discriminant > discriminantEpsilon ? Math.sqrt(discriminant) : 0;
  const roots = root === 0 ? [-b / (2 * a)] : [(-b + root) / (2 * a), (-b - root) / (2 * a)];
  const centers: CadWorldPoint[] = [];
  for (const s of roots) {
    if (!Number.isFinite(s) || Math.abs(s) <= tolerance) continue;
    const radius = Math.abs(s) * sinHalf;
    if (!isValidCadCurveRadius(radius)) continue;
    centers.push({ x: pi.x + bisector.x * s, y: pi.y + bisector.y * s });
  }
  return centers;
};

/**
 * Contract 3 — circle tangent to both rays through a picked point. Enumerates
 * candidate centers on both angle bisectors, validates ray membership and the
 * finite sweep, and returns every candidate so the caller can offer a side
 * choice (never an array-order pick).
 */
export const solveCadCurveThroughTwoTangentRays = (
  rays: CadTwoTangentRays,
  throughPoint: CadWorldPoint,
): CadCurveThroughPointOutcome => {
  if (!isFinitePoint(throughPoint)) return { ok: false, code: 'NO_SOLUTION', candidates: [] };
  const { pi, ray1, ray2 } = rays;
  const dotRays = clampUnit(
    ray1.direction.x * ray2.direction.x + ray1.direction.y * ray2.direction.y,
  );
  const halfRad = Math.acos(dotRays) / 2;
  const sinHalf = Math.sin(halfRad);
  const cosHalf = Math.cos(halfRad);
  if (sinHalf <= CAD_XY_DEGENERATE_FLOOR) {
    return { ok: false, code: 'DEGENERATE_RAYS', candidates: [] };
  }

  const scale = Math.max(1, Math.abs(pi.x), Math.abs(pi.y), Math.abs(throughPoint.x), Math.abs(throughPoint.y));
  const tolerance = CAD_XY_DEGENERATE_FLOOR * scale;
  const scaleTolerance = CAD_XY_DEGENERATE_FLOOR * scale;

  const sum = { x: ray1.direction.x + ray2.direction.x, y: ray1.direction.y + ray2.direction.y };
  const diff = { x: ray1.direction.x - ray2.direction.x, y: ray1.direction.y - ray2.direction.y };
  const bisectors: CadWorldPoint[] = [];
  for (const candidate of [sum, diff]) {
    const length = Math.hypot(candidate.x, candidate.y);
    if (length > CAD_XY_DEGENERATE_FLOOR) {
      bisectors.push({ x: candidate.x / length, y: candidate.y / length });
    }
  }

  const candidates: CadCurveThroughPointCandidate[] = [];
  for (const bisector of bisectors) {
    for (const center of solveBisectorCenters(pi, throughPoint, bisector, sinHalf, cosHalf, tolerance)) {
      const radius = cadDistance(center, throughPoint);
      if (!isValidCadCurveRadius(radius)) continue;
      const pcParam = (center.x - pi.x) * ray1.direction.x + (center.y - pi.y) * ray1.direction.y;
      const ptParam = (center.x - pi.x) * ray2.direction.x + (center.y - pi.y) * ray2.direction.y;
      if (pcParam <= scaleTolerance || ptParam <= scaleTolerance) continue;
      const pc = {
        x: pi.x + ray1.direction.x * pcParam,
        y: pi.y + ray1.direction.y * pcParam,
      };
      const pt = {
        x: pi.x + ray2.direction.x * ptParam,
        y: pi.y + ray2.direction.y * ptParam,
      };
      const startAngleDeg = cadAngleDegFromCenter(center, pc);
      const endAngleDeg = cadAngleDegFromCenter(center, pt);
      const ccwDelta = cadCounterClockwiseDeltaDeg(startAngleDeg, endAngleDeg);
      const signedSweep = ccwDelta <= 180 ? ccwDelta : -(360 - ccwDelta);
      const arc = cadBuildArcFromCenterSweep(center, radius, startAngleDeg, signedSweep);
      if (!arc) continue;
      const throughAngleDeg = cadAngleDegFromCenter(center, throughPoint);
      // A through point coincident with PC/PT (within tolerance) lies on the
      // minor arc by definition; `cadIsAngleOnArcSweep` only tolerances the
      // sweep magnitude, so guard the start/end boundary here for both turn
      // directions (CW and CCW) without widening the shared primitive.
      const coincidentWithEndpoint =
        angleSeparationDeg(throughAngleDeg, arc.startAngleDeg) <= 1e-6 ||
        angleSeparationDeg(throughAngleDeg, arc.endAngleDeg) <= 1e-6;
      if (
        !coincidentWithEndpoint &&
        !cadIsAngleOnArcSweep(throughAngleDeg, arc.startAngleDeg, arc.endAngleDeg, 1e-6)
      ) {
        continue;
      }
      const metrics = buildCadCurveMetricsSummaryFromRadiusDeltaDeg(radius, arc.deltaDeg);
      if (!metrics) continue;
      const side: 'left' | 'right' =
        cross(ray1.direction, { x: center.x - pi.x, y: center.y - pi.y }) >= 0
          ? 'left'
          : 'right';
      const duplicate = candidates.some(
        (existing) =>
          cadDistance(existing.arc.center, center) <= tolerance &&
          Math.abs(existing.metrics.radius - radius) <= tolerance,
      );
      if (duplicate) continue;
      candidates.push({
        arc,
        pc: { ...arc.startPoint },
        pt: { ...arc.endPoint },
        metrics,
        withinPickedExtent:
          pcParam <= ray1.distanceToPickProjection + scaleTolerance &&
          ptParam <= ray2.distanceToPickProjection + scaleTolerance,
        side,
      });
    }
  }

  candidates.sort((left, right) => {
    if (Math.abs(left.metrics.radius - right.metrics.radius) > tolerance) {
      return left.metrics.radius - right.metrics.radius;
    }
    if (Math.abs(left.arc.center.x - right.arc.center.x) > tolerance) {
      return left.arc.center.x - right.arc.center.x;
    }
    return left.arc.center.y - right.arc.center.y;
  });

  if (candidates.length === 0) return { ok: false, code: 'NO_SOLUTION', candidates: [] };
  if (candidates.length > 1) {
    return { ok: false, code: 'MULTIPLE_SOLUTIONS', candidates };
  }
  return { ok: true, result: candidates[0]!, candidates };
};

/**
 * MIN-DIST support: resolve a target point onto the second supporting line and
 * offer the `PT` candidates at `±distance` along the tangent. Only candidates on
 * the user-selected second ray are returned as usable; the caller fails or asks
 * for a side when the usable set is empty.
 */
export const resolveCadCurveMinDistancePt = (
  rays: CadTwoTangentRays,
  targetPoint: CadWorldPoint,
  distance: number,
): { candidates: CadWorldPoint[]; onSelectedRay: CadWorldPoint[] } | null => {
  if (!isFinitePoint(targetPoint) || !Number.isFinite(distance) || distance <= 0) return null;
  const { pi, ray2 } = rays;
  const projection = cadProjectPointOntoInfiniteLine(targetPoint, pi, {
    x: pi.x + ray2.direction.x,
    y: pi.y + ray2.direction.y,
  });
  const scale = Math.max(1, Math.abs(pi.x), Math.abs(pi.y), Math.abs(targetPoint.x), Math.abs(targetPoint.y));
  const tolerance = CAD_XY_DEGENERATE_FLOOR * scale;
  const candidates = [
    {
      x: projection.point.x + ray2.direction.x * distance,
      y: projection.point.y + ray2.direction.y * distance,
    },
    {
      x: projection.point.x - ray2.direction.x * distance,
      y: projection.point.y - ray2.direction.y * distance,
    },
  ];
  const onSelectedRay = candidates.filter((candidate) => {
    const param =
      (candidate.x - pi.x) * ray2.direction.x + (candidate.y - pi.y) * ray2.direction.y;
    return param > tolerance;
  });
  return { candidates, onSelectedRay };
};
