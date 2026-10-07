import {
  cadAngleDegFromCenter,
  cadDistance,
  cadInfiniteLineIntersection,
  type CadWorldPoint,
} from './cadGeometry';
import { cadIsAngleOnArcSweep, cadClosestPointOnArc } from './cadGeometryArcPrimitives';
import {
  cadIntersectCircleCircle,
  cadIntersectInfiniteLineCircle,
  cadOffsetLineSegment,
} from './cadGeometryCurveIntersections';
import { CAD_XY_DEGENERATE_FLOOR, isValidCircleGeometry } from './cadGeometryShapeBuilders';
import type { CadEntityId, CadPolylineEntity, CadProject } from './cadTypes';
import { resolveCadPolylineCourses } from './cadPolylineCourses';

/**
 * Phase B2 — pure tangent-circle solvers (Tan/Tan/Radius + Tan/Tan/Tan).
 *
 * A tangent source is one picked primitive plus the exact pick point:
 *  - line: finite segment body (constructing tangent circles follow the
 *    existing FILLET/TANGENT_CURVE extension law: the underlying INFINITE
 *    line fixes tangency; the finite segment identity is recorded),
 *  - polyline: the picked segment only (its supporting infinite line),
 *  - arc: the full underlying circle with sweep-membership enforced,
 *  - circle: the first-class CadCircleEntity.
 *
 * Only `CAD_XY_DEGENERATE_FLOOR` (the single CAD floor authority) is used for
 * numeric guards; no new epsilon is introduced. Both solvers run in a local
 * frame anchored at the picked-geometry bounding-box centre, so no tolerance or
 * branch decision depends on absolute world coordinates. Candidates are
 * validated against every source, deduplicated by center/radius, selected by
 * the minimum sum of pick-to-tangency distances (never "first element"), and a
 * score tie reports AMBIGUOUS instead of silently picking one.
 */

export interface CadTangentLinePrimitive {
  kind: 'line';
  entityId: CadEntityId;
  segmentId: string;
  start: CadWorldPoint;
  end: CadWorldPoint;
}

export interface CadTangentCirclePrimitive {
  kind: 'circle';
  entityId: CadEntityId;
  center: CadWorldPoint;
  radius: number;
}

export interface CadTangentArcPrimitive {
  kind: 'arc';
  entityId: CadEntityId;
  /**
   * Phase C2: exact polyline/feature-line course identity when this arc is a
   * course of a multi-course entity; absent for standalone `CadArcEntity`s.
   * Two picks of a shared polyline resolve to the same course only when this
   * matches, so same-entity multi-arc picks stay distinct.
   */
  segmentId?: string;
  center: CadWorldPoint;
  radius: number;
  startAngleDeg: number;
  endAngleDeg: number;
}

export type CadTangentPrimitive =
  | CadTangentLinePrimitive
  | CadTangentCirclePrimitive
  | CadTangentArcPrimitive;

export interface CadTangentSource {
  primitive: CadTangentPrimitive;
  pickPoint: CadWorldPoint;
}

export interface CadTangentCircleCandidate {
  center: CadWorldPoint;
  radius: number;
  /** One tangency point per source, in source order. */
  tangencyPoints: CadWorldPoint[];
  /** Sum of pick-to-tangency distances (selection key). */
  score: number;
}

export type CadTangentSolveStatus = 'SOLVED' | 'NO_SOLUTION' | 'AMBIGUOUS';

export interface CadTangentCircleSolveResult {
  status: CadTangentSolveStatus;
  /** Committed circle when SOLVED, else null. */
  center: CadWorldPoint | null;
  radius: number | null;
  /** Every validated candidate in deterministic score order (diagnostics/tests). */
  candidates: CadTangentCircleCandidate[];
}

/** Scale-relative guard derived from the single CAD floor authority. */
const tangentTolerance = (scale: number): number =>
  CAD_XY_DEGENERATE_FLOOR * Math.max(1, Number.isFinite(scale) ? scale : 1);

const sourceGeometryScale = (sources: readonly CadTangentSource[]): number => {
  let scale = 1;
  for (const { primitive, pickPoint } of sources) {
    scale = Math.max(scale, Math.abs(pickPoint.x), Math.abs(pickPoint.y));
    if (primitive.kind === 'line') {
      scale = Math.max(scale, Math.abs(primitive.start.x), Math.abs(primitive.start.y));
      scale = Math.max(scale, Math.abs(primitive.end.x), Math.abs(primitive.end.y));
    } else {
      scale = Math.max(scale, Math.abs(primitive.center.x), Math.abs(primitive.center.y));
      scale = Math.max(scale, Math.abs(primitive.radius));
    }
  }
  return scale;
};

/** Bounding-box centre of the picked geometry. The solver runs entirely in a
 * local frame anchored here so no tolerance or branch decision depends on the
 * absolute world position of the drawing. */
const tangentLocalOrigin = (sources: readonly CadTangentSource[]): CadWorldPoint => {
  let minX = Number.POSITIVE_INFINITY;
  let minY = Number.POSITIVE_INFINITY;
  let maxX = Number.NEGATIVE_INFINITY;
  let maxY = Number.NEGATIVE_INFINITY;
  const include = (point: CadWorldPoint): void => {
    minX = Math.min(minX, point.x);
    minY = Math.min(minY, point.y);
    maxX = Math.max(maxX, point.x);
    maxY = Math.max(maxY, point.y);
  };
  for (const { primitive, pickPoint } of sources) {
    include(pickPoint);
    if (primitive.kind === 'line') {
      include(primitive.start);
      include(primitive.end);
    } else {
      include(primitive.center);
    }
  }
  if (!Number.isFinite(minX) || !Number.isFinite(minY)) return { x: 0, y: 0 };
  return { x: (minX + maxX) / 2, y: (minY + maxY) / 2 };
};

const shiftPoint = (point: CadWorldPoint, origin: CadWorldPoint): CadWorldPoint => ({
  x: point.x - origin.x,
  y: point.y - origin.y,
});

const restorePoint = (point: CadWorldPoint, origin: CadWorldPoint): CadWorldPoint => ({
  x: point.x + origin.x,
  y: point.y + origin.y,
});

const shiftSourceToLocal = (source: CadTangentSource, origin: CadWorldPoint): CadTangentSource => {
  const { primitive } = source;
  const pickPoint = shiftPoint(source.pickPoint, origin);
  if (primitive.kind === 'line') {
    return {
      primitive: {
        ...primitive,
        start: shiftPoint(primitive.start, origin),
        end: shiftPoint(primitive.end, origin),
      },
      pickPoint,
    };
  }
  return {
    primitive: { ...primitive, center: shiftPoint(primitive.center, origin) },
    pickPoint,
  };
};

const shiftCandidateToWorld = (
  candidate: CadTangentCircleCandidate,
  origin: CadWorldPoint,
): CadTangentCircleCandidate => ({
  ...candidate,
  center: restorePoint(candidate.center, origin),
  tangencyPoints: candidate.tangencyPoints.map((point) => restorePoint(point, origin)),
});

const shiftResultToWorld = (
  result: CadTangentCircleSolveResult,
  origin: CadWorldPoint,
): CadTangentCircleSolveResult => ({
  ...result,
  center: result.center ? restorePoint(result.center, origin) : null,
  candidates: result.candidates.map((candidate) => shiftCandidateToWorld(candidate, origin)),
});

const isFinitePrimitive = (primitive: CadTangentPrimitive): boolean => {
  if (primitive.kind === 'line') {
    return (
      Number.isFinite(primitive.start.x) &&
      Number.isFinite(primitive.start.y) &&
      Number.isFinite(primitive.end.x) &&
      Number.isFinite(primitive.end.y) &&
      cadDistance(primitive.start, primitive.end) > CAD_XY_DEGENERATE_FLOOR
    );
  }
  return isValidCircleGeometry(primitive.center.x, primitive.center.y, primitive.radius);
};

const samePrimitive = (a: CadTangentPrimitive, b: CadTangentPrimitive): boolean => {
  if (a.kind !== b.kind) return false;
  if (a.entityId !== b.entityId) return false;
  if (a.kind === 'line' && b.kind === 'line') return a.segmentId === b.segmentId;
  if (a.kind === 'arc' && b.kind === 'arc') return a.segmentId === b.segmentId;
  return true;
};

/** True when two picks resolve to the same primitive (same entity + segment). */
export const isSameCadTangentPrimitive = samePrimitive;

interface SourceTangency {
  point: CadWorldPoint;
  residual: number;
  valid: boolean;
}

/** Foot-of-perpendicular tangency on the supporting infinite line. */
const resolveLineTangency = (
  primitive: CadTangentLinePrimitive,
  center: CadWorldPoint,
  radius: number,
  tolerance: number,
): SourceTangency | null => {
  const dx = primitive.end.x - primitive.start.x;
  const dy = primitive.end.y - primitive.start.y;
  const length = Math.hypot(dx, dy);
  if (!Number.isFinite(length) || length <= CAD_XY_DEGENERATE_FLOOR) return null;
  const nx = -dy / length;
  const ny = dx / length;
  const signed = nx * (center.x - primitive.start.x) + ny * (center.y - primitive.start.y);
  const point = { x: center.x - signed * nx, y: center.y - signed * ny };
  const residual = Math.abs(Math.abs(signed) - radius);
  return { point, residual, valid: residual <= tolerance };
};

/** External/internal tangency on the full source circle (arc sweep checked). */
const resolveCircleTangency = (
  primitive: CadTangentCirclePrimitive | CadTangentArcPrimitive,
  center: CadWorldPoint,
  radius: number,
  tolerance: number,
): SourceTangency | null => {
  const distance = cadDistance(center, primitive.center);
  if (!Number.isFinite(distance)) return null;
  let best: SourceTangency | null = null;
  // s = +1 external, s = -1 internal (signed offset radius r + s*R).
  for (const s of [1, -1] as const) {
    const signedOffsetRadius = radius + s * primitive.radius;
    if (Math.abs(signedOffsetRadius) <= CAD_XY_DEGENERATE_FLOOR) continue;
    const residual = Math.abs(distance - Math.abs(signedOffsetRadius));
    if (residual > tolerance) continue;
    const point = {
      x: center.x + ((primitive.center.x - center.x) * radius) / signedOffsetRadius,
      y: center.y + ((primitive.center.y - center.y) * radius) / signedOffsetRadius,
    };
    if (!Number.isFinite(point.x) || !Number.isFinite(point.y)) continue;
    if (
      primitive.kind === 'arc' &&
      !cadIsAngleOnArcSweep(
        cadAngleDegFromCenter(primitive.center, point),
        primitive.startAngleDeg,
        primitive.endAngleDeg,
      )
    ) {
      continue;
    }
    const candidate: SourceTangency = { point, residual, valid: true };
    if (!best || candidate.residual < best.residual) best = candidate;
  }
  return best;
};

const resolveSourceTangency = (
  source: CadTangentSource,
  center: CadWorldPoint,
  radius: number,
  tolerance: number,
): SourceTangency | null =>
  source.primitive.kind === 'line'
    ? resolveLineTangency(source.primitive, center, radius, tolerance)
    : resolveCircleTangency(source.primitive, center, radius, tolerance);

const buildCandidate = (
  sources: readonly CadTangentSource[],
  center: CadWorldPoint,
  radius: number,
  tolerance: number,
): CadTangentCircleCandidate | null => {
  if (!isValidCircleGeometry(center.x, center.y, radius)) return null;
  const tangencyPoints: CadWorldPoint[] = [];
  let score = 0;
  for (const source of sources) {
    const tangency = resolveSourceTangency(source, center, radius, tolerance);
    if (!tangency || !tangency.valid) return null;
    tangencyPoints.push(tangency.point);
    score += cadDistance(source.pickPoint, tangency.point);
  }
  return { center: { x: center.x, y: center.y }, radius, tangencyPoints, score };
};

const dedupeCandidates = (
  candidates: readonly CadTangentCircleCandidate[],
  tolerance: number,
): CadTangentCircleCandidate[] => {
  const result: CadTangentCircleCandidate[] = [];
  for (const candidate of candidates) {
    const duplicate = result.some(
      (existing) =>
        cadDistance(existing.center, candidate.center) <= tolerance &&
        Math.abs(existing.radius - candidate.radius) <= tolerance,
    );
    if (!duplicate) result.push(candidate);
  }
  return result;
};

const finalizeCandidates = (
  candidates: readonly CadTangentCircleCandidate[],
  tolerance: number,
): CadTangentCircleSolveResult => {
  const deduped = dedupeCandidates(candidates, tolerance);
  if (deduped.length === 0) {
    return { status: 'NO_SOLUTION', center: null, radius: null, candidates: [] };
  }
  const sorted = [...deduped].sort((left, right) => left.score - right.score);
  const best = sorted[0]!;
  const tied = sorted
    .slice(1)
    .find((candidate) => Math.abs(candidate.score - best.score) <= tolerance);
  if (tied) {
    return { status: 'AMBIGUOUS', center: null, radius: null, candidates: sorted };
  }
  return {
    status: 'SOLVED',
    center: { ...best.center },
    radius: best.radius,
    candidates: sorted,
  };
};

const positiveOffsetRadii = (sourceRadius: number, radius: number): number[] => {
  const radii = [sourceRadius + radius, Math.abs(sourceRadius - radius)];
  const result: number[] = [];
  for (const value of radii) {
    if (value <= CAD_XY_DEGENERATE_FLOOR) continue;
    if (result.some((existing) => Math.abs(existing - value) <= CAD_XY_DEGENERATE_FLOOR)) continue;
    result.push(value);
  }
  return result;
};

const emptyResult = (): CadTangentCircleSolveResult => ({
  status: 'NO_SOLUTION',
  center: null,
  radius: null,
  candidates: [],
});

const isSolvablePair = (first: CadTangentSource, second: CadTangentSource): boolean => {
  if (!isFinitePrimitive(first.primitive) || !isFinitePrimitive(second.primitive)) return false;
  if (samePrimitive(first.primitive, second.primitive)) return false;
  return true;
};

type CadTangentRoundPrimitive = CadTangentCirclePrimitive | CadTangentArcPrimitive;

const collectLineLineTtr = (
  first: CadTangentLinePrimitive,
  second: CadTangentLinePrimitive,
  radius: number,
): CadWorldPoint[] => {
  const centers: CadWorldPoint[] = [];
  for (const firstSide of [1, -1]) {
    for (const secondSide of [1, -1]) {
      const a = cadOffsetLineSegment(first.start, first.end, firstSide * radius);
      const b = cadOffsetLineSegment(second.start, second.end, secondSide * radius);
      const center = cadInfiniteLineIntersection(a.start, a.end, b.start, b.end);
      if (center) centers.push(center);
    }
  }
  return centers;
};

const collectLineCircleTtr = (
  line: CadTangentLinePrimitive,
  circle: CadTangentRoundPrimitive,
  radius: number,
): CadWorldPoint[] => {
  const centers: CadWorldPoint[] = [];
  for (const side of [1, -1]) {
    const offset = cadOffsetLineSegment(line.start, line.end, side * radius);
    for (const offsetRadius of positiveOffsetRadii(circle.radius, radius)) {
      centers.push(
        ...cadIntersectInfiniteLineCircle(offset.start, offset.end, circle.center, offsetRadius),
      );
    }
  }
  return centers;
};

const collectCircleCircleTtr = (
  first: CadTangentRoundPrimitive,
  second: CadTangentRoundPrimitive,
  radius: number,
): CadWorldPoint[] => {
  const centers: CadWorldPoint[] = [];
  for (const firstOffsetRadius of positiveOffsetRadii(first.radius, radius)) {
    for (const secondOffsetRadius of positiveOffsetRadii(second.radius, radius)) {
      centers.push(
        ...cadIntersectCircleCircle(
          first.center,
          firstOffsetRadius,
          second.center,
          secondOffsetRadius,
        ),
      );
    }
  }
  return centers;
};

export const solveCadCircleTangentTangentRadius = (
  first: CadTangentSource,
  second: CadTangentSource,
  radius: number,
): CadTangentCircleSolveResult => {
  if (!Number.isFinite(radius) || radius <= CAD_XY_DEGENERATE_FLOOR) return emptyResult();
  if (!isSolvablePair(first, second)) return emptyResult();
  const origin = tangentLocalOrigin([first, second]);
  const localFirst = shiftSourceToLocal(first, origin);
  const localSecond = shiftSourceToLocal(second, origin);
  const sources = [localFirst, localSecond] as const;
  const tolerance = tangentTolerance(sourceGeometryScale(sources));
  const centers: CadWorldPoint[] = [];
  if (localFirst.primitive.kind === 'line' && localSecond.primitive.kind === 'line') {
    centers.push(...collectLineLineTtr(localFirst.primitive, localSecond.primitive, radius));
  } else if (localFirst.primitive.kind === 'line' && localSecond.primitive.kind !== 'line') {
    centers.push(...collectLineCircleTtr(localFirst.primitive, localSecond.primitive, radius));
  } else if (localFirst.primitive.kind !== 'line' && localSecond.primitive.kind === 'line') {
    centers.push(...collectLineCircleTtr(localSecond.primitive, localFirst.primitive, radius));
  } else if (localFirst.primitive.kind !== 'line' && localSecond.primitive.kind !== 'line') {
    centers.push(...collectCircleCircleTtr(localFirst.primitive, localSecond.primitive, radius));
  }
  const candidates: CadTangentCircleCandidate[] = [];
  for (const center of centers) {
    const candidate = buildCandidate(sources, center, radius, tolerance);
    if (candidate) candidates.push(candidate);
  }
  return shiftResultToWorld(finalizeCandidates(candidates, tolerance), origin);
};

// --- Tan/Tan/Tan (Apollonius) -------------------------------------------

type ApolloniusLine = {
  kind: 'line';
  index: number;
  nx: number;
  ny: number;
  d: number;
};

type ApolloniusCircle = {
  kind: 'circle';
  index: number;
  cx: number;
  cy: number;
  r: number;
};

type ApolloniusObject = ApolloniusLine | ApolloniusCircle;

interface LinearConstraint {
  a: number;
  b: number;
  /** Coefficient of R. */
  c: number;
  rhs: number;
  /** Index of the line whose own equation this is (null for a radical axis). */
  fullUsed: number | null;
}

const buildApolloniusObjects = (
  sources: readonly CadTangentSource[],
): ApolloniusObject[] | null => {
  const objects: ApolloniusObject[] = [];
  for (let index = 0; index < sources.length; index += 1) {
    const primitive = sources[index]!.primitive;
    if (!isFinitePrimitive(primitive)) return null;
    if (primitive.kind === 'line') {
      const dx = primitive.end.x - primitive.start.x;
      const dy = primitive.end.y - primitive.start.y;
      const length = Math.hypot(dx, dy);
      if (length <= CAD_XY_DEGENERATE_FLOOR) return null;
      const nx = -dy / length;
      const ny = dx / length;
      objects.push({
        kind: 'line',
        index,
        nx,
        ny,
        d: nx * primitive.start.x + ny * primitive.start.y,
      });
    } else {
      objects.push({
        kind: 'circle',
        index,
        cx: primitive.center.x,
        cy: primitive.center.y,
        r: primitive.radius,
      });
    }
  }
  return objects;
};

const buildLinearConstraints = (
  objects: readonly ApolloniusObject[],
  signs: readonly number[],
  tolerance: number,
): LinearConstraint[] | null => {
  const constraints: LinearConstraint[] = [];
  for (const object of objects) {
    if (object.kind === 'line') {
      constraints.push({
        a: object.nx,
        b: object.ny,
        c: -signs[object.index]!,
        rhs: object.d,
        fullUsed: object.index,
      });
    }
  }
  for (let i = 0; i < objects.length; i += 1) {
    for (let j = i + 1; j < objects.length; j += 1) {
      const left = objects[i]!;
      const right = objects[j]!;
      if (left.kind !== 'circle' || right.kind !== 'circle') continue;
      const a = -2 * (left.cx - right.cx);
      const b = -2 * (left.cy - right.cy);
      const c = -2 * (signs[left.index]! * left.r - signs[right.index]! * right.r);
      const rhs =
        left.r * left.r -
        right.r * right.r -
        (left.cx * left.cx + left.cy * left.cy - right.cx * right.cx - right.cy * right.cy);
      if (Math.abs(a) <= CAD_XY_DEGENERATE_FLOOR && Math.abs(b) <= CAD_XY_DEGENERATE_FLOOR) {
        // Concentric pair: the radical axis degenerates to the radius-only
        // relation c*R = rhs. Judge the FULL tuple instead of discarding it.
        if (Math.abs(c) <= tolerance) {
          // No radius information: rhs == 0 is a redundant duplicate, a
          // materially nonzero rhs means this sign branch is inconsistent.
          if (Math.abs(rhs) <= tolerance * tolerance) continue;
          return null;
        }
      }
      constraints.push({ a, b, c, rhs, fullUsed: null });
    }
  }
  return constraints;
};

/** Stable quadratic roots in the `q` form: `q = -0.5*(b + sign(b)*sqrt(D))`,
 * roots `q/a` and `c/q`. The naive `(-b ± sqrt(D))/(2a)` cancels
 * catastrophically for one root when `|b|` is large; the previous code's b<0
 * branch also reused the same expression for both roots, collapsing a genuine
 * two-root system onto a single duplicated root. Exported for focused unit
 * coverage of the sign/branch matrix (a=1,b=-3,c=2 must yield {1,2}). */
export const quadraticRoots = (a: number, b: number, c: number, tolerance: number): number[] => {
  if (Math.abs(a) <= CAD_XY_DEGENERATE_FLOOR) {
    if (Math.abs(b) <= tolerance) return [];
    const linear = -c / b;
    return Number.isFinite(linear) ? [linear] : [];
  }
  const discriminant = b * b - 4 * a * c;
  if (discriminant < -tolerance * tolerance) return [];
  const root = Math.sqrt(Math.max(0, discriminant));
  const q = -0.5 * (b + (b >= 0 ? root : -root));
  const roots: number[] = [];
  const pushRoot = (value: number): void => {
    if (!Number.isFinite(value)) return;
    if (roots.some((existing) => Math.abs(existing - value) <= tolerance)) return;
    roots.push(value);
  };
  if (Math.abs(q) <= CAD_XY_DEGENERATE_FLOOR && Math.abs(c) <= tolerance * tolerance) {
    // Genuine zero root only: q ~ 0 does NOT imply c ~ 0 (e.g. a=1e-11, b=0,
    // c=-1e-14 has q ~ -3.2e-13 but true roots ~ +/-0.0316), and for D >= 0
    // q == 0 implies c == 0. Collapse to {0, -b/a} only when the constant
    // term is also zero within the caller's tolerance authority; otherwise
    // the q-form quotients below still carry both nonzero roots.
    pushRoot(0);
    pushRoot(-b / a);
  } else {
    pushRoot(q / a);
    pushRoot(c / q);
  }
  return roots;
};

const objectRootsForParam = (
  object: ApolloniusObject,
  x0: number,
  x1: number,
  y0: number,
  y1: number,
  r0: number,
  r1: number,
  sign: number,
  tolerance: number,
): number[] => {
  if (object.kind === 'line') {
    const denominator = object.nx * x1 + object.ny * y1 - sign * r1;
    const numerator = -(object.nx * x0 + object.ny * y0 - sign * r0 - object.d);
    if (Math.abs(denominator) <= CAD_XY_DEGENERATE_FLOOR) return [];
    const value = numerator / denominator;
    return Number.isFinite(value) ? [value] : [];
  }
  const ux = x0 - object.cx;
  const uy = y0 - object.cy;
  const w0 = r0 + sign * object.r;
  const w1 = r1;
  const a = x1 * x1 + y1 * y1 - w1 * w1;
  const b = 2 * (ux * x1 + uy * y1) - 2 * w0 * w1;
  const c = ux * ux + uy * uy - w0 * w0;
  return quadraticRoots(a, b, c, tolerance).filter((value) => Number.isFinite(value));
};

interface AffineParametrization {
  x0: number;
  x1: number;
  y0: number;
  y1: number;
  r0: number;
  r1: number;
}

const minorDetTolerance = (m00: number, m01: number, m10: number, m11: number): number =>
  CAD_XY_DEGENERATE_FLOOR * Math.max(1, Math.abs(m00 * m11), Math.abs(m01 * m10));

/** Express the center and radius affinely in one free parameter t. The radius is
 * tried first (matching the classic Apollonius parametrization); when the (x, y)
 * block is rank-deficient — e.g. collinear circle centres — x or y is used as
 * the free parameter instead, so the remaining circle equation still closes the
 * system without any iteration. */
const parameterizeConstraints = (
  first: LinearConstraint,
  second: LinearConstraint,
): AffineParametrization | null => {
  const firstCoef = [first.a, first.b, first.c];
  const secondCoef = [second.a, second.b, second.c];
  for (const free of [2, 0, 1]) {
    const dependent = [0, 1, 2].filter((index) => index !== free);
    const d0 = dependent[0]!;
    const d1 = dependent[1]!;
    const m00 = firstCoef[d0]!;
    const m01 = firstCoef[d1]!;
    const m10 = secondCoef[d0]!;
    const m11 = secondCoef[d1]!;
    const det = m00 * m11 - m01 * m10;
    if (Math.abs(det) <= minorDetTolerance(m00, m01, m10, m11)) continue;
    const firstFree = firstCoef[free]!;
    const secondFree = secondCoef[free]!;
    const constants = [0, 0, 0];
    const linears = [0, 0, 0];
    constants[free] = 0;
    linears[free] = 1;
    constants[d0] = (first.rhs * m11 - second.rhs * m01) / det;
    linears[d0] = (-firstFree * m11 + secondFree * m01) / det;
    constants[d1] = (m00 * second.rhs - m10 * first.rhs) / det;
    linears[d1] = (-m00 * secondFree + m10 * firstFree) / det;
    if (![...constants, ...linears].every((value) => Number.isFinite(value))) continue;
    return {
      x0: constants[0]!,
      x1: linears[0]!,
      y0: constants[1]!,
      y1: linears[1]!,
      r0: constants[2]!,
      r1: linears[2]!,
    };
  }
  return null;
};

/** Solve one sign triple: pick two independent linear constraints, express the
 * center and radius affinely in one free parameter, and substitute into an
 * object whose own equation was not consumed. Returns the resulting circle
 * candidates. */
const collectSignTripleCandidates = (
  sources: readonly CadTangentSource[],
  objects: readonly ApolloniusObject[],
  signs: readonly number[],
  tolerance: number,
): CadTangentCircleCandidate[] => {
  const constraints = buildLinearConstraints(objects, signs, tolerance);
  if (!constraints) return [];
  const candidates: CadTangentCircleCandidate[] = [];
  for (let i = 0; i < constraints.length; i += 1) {
    for (let j = i + 1; j < constraints.length; j += 1) {
      const first = constraints[i]!;
      const second = constraints[j]!;
      const parametrization = parameterizeConstraints(first, second);
      if (!parametrization) continue;
      const used = new Set<number>();
      if (first.fullUsed != null) used.add(first.fullUsed);
      if (second.fullUsed != null) used.add(second.fullUsed);
      for (const object of objects) {
        if (used.has(object.index)) continue;
        for (const root of objectRootsForParam(
          object,
          parametrization.x0,
          parametrization.x1,
          parametrization.y0,
          parametrization.y1,
          parametrization.r0,
          parametrization.r1,
          signs[object.index]!,
          tolerance,
        )) {
          const center = {
            x: parametrization.x0 + parametrization.x1 * root,
            y: parametrization.y0 + parametrization.y1 * root,
          };
          const radius = parametrization.r0 + parametrization.r1 * root;
          const candidate = buildCandidate(sources, center, radius, tolerance);
          if (candidate) candidates.push(candidate);
        }
      }
    }
  }
  return candidates;
};

export const solveCadCircleTangentTangentTangent = (
  first: CadTangentSource,
  second: CadTangentSource,
  third: CadTangentSource,
): CadTangentCircleSolveResult => {
  const sources = [first, second, third] as const;
  for (let i = 0; i < sources.length; i += 1) {
    for (let j = i + 1; j < sources.length; j += 1) {
      if (!isSolvablePair(sources[i]!, sources[j]!)) return emptyResult();
    }
  }
  const origin = tangentLocalOrigin(sources);
  const localSources = sources.map((source) => shiftSourceToLocal(source, origin));
  const objects = buildApolloniusObjects(localSources);
  if (!objects) return emptyResult();
  const tolerance = tangentTolerance(sourceGeometryScale(localSources));
  const candidates: CadTangentCircleCandidate[] = [];
  for (const s1 of [1, -1]) {
    for (const s2 of [1, -1]) {
      for (const s3 of [1, -1]) {
        candidates.push(
          ...collectSignTripleCandidates(localSources, objects, [s1, s2, s3], tolerance),
        );
      }
    }
  }
  return shiftResultToWorld(finalizeCandidates(candidates, tolerance), origin);
};

// --- Project resolution --------------------------------------------------

interface ResolvedPolylineSegment {
  start: CadWorldPoint;
  end: CadWorldPoint;
  segmentId: string;
}

const resolvePolylineSegment = (
  entityId: CadEntityId,
  segmentId: string | undefined,
  pickPoint: CadWorldPoint,
  vertices: readonly CadWorldPoint[],
  closed: boolean,
): ResolvedPolylineSegment | null => {
  const count = vertices.length;
  if (count < 2) return null;
  const segmentCount = closed ? count : count - 1;
  let best: (ResolvedPolylineSegment & { distance: number }) | null = null;
  for (let index = 0; index < segmentCount; index += 1) {
    const start = vertices[index]!;
    const end = vertices[(index + 1) % count]!;
    const length = cadDistance(start, end);
    if (length <= CAD_XY_DEGENERATE_FLOOR) continue;
    const id = `${entityId}#${index}`;
    if (segmentId != null && segmentId !== id) continue;
    const nx = -(end.y - start.y) / length;
    const ny = (end.x - start.x) / length;
    const distance = Math.abs(nx * (pickPoint.x - start.x) + ny * (pickPoint.y - start.y));
    if (!best || distance < best.distance) {
      best = { start: { ...start }, end: { ...end }, segmentId: id, distance };
    }
  }
  if (!best) return null;
  return { start: best.start, end: best.end, segmentId: best.segmentId };
};

/** Resolve a picked entity + pick point into a tangent source. The segment id
 * (from the spatial snap) pins polylines to the picked segment; without one,
 * the closest segment is used. Fail closed for unsupported entities. */
export const resolveCadTangentSource = (
  project: CadProject,
  entityId: CadEntityId,
  pickPoint: CadWorldPoint,
  segmentId?: string,
): CadTangentSource | null => {
  const entity = project.entities.find((candidate) => candidate.id === entityId);
  if (!entity) return null;
  if (entity.type === 'line') {
    return {
      primitive: {
        kind: 'line',
        entityId,
        segmentId: `${entity.id}#0`,
        start: { x: entity.fromX, y: entity.fromY },
        end: { x: entity.toX, y: entity.toY },
      },
      pickPoint: { x: pickPoint.x, y: pickPoint.y },
    };
  }
  if (entity.type === 'circle') {
    return {
      primitive: {
        kind: 'circle',
        entityId,
        center: { x: entity.centerX, y: entity.centerY },
        radius: entity.radius,
      },
      pickPoint: { x: pickPoint.x, y: pickPoint.y },
    };
  }
  if (entity.type === 'arc') {
    return {
      primitive: {
        kind: 'arc',
        entityId,
        center: { x: entity.centerX, y: entity.centerY },
        radius: entity.radius,
        startAngleDeg: entity.startAngleDeg,
        endAngleDeg: entity.endAngleDeg,
      },
      pickPoint: { x: pickPoint.x, y: pickPoint.y },
    };
  }
  if (entity.type === 'polyline') {
    return resolvePolylineTangentSource(entity, entityId, pickPoint, segmentId);
  }
  return null;
};

/**
 * Phase C2: a polyline pick resolves its true course. Line courses keep the
 * existing finite-segment path; arc courses expose a native arc primitive
 * (center/radius/sweep) so CIRCLE TTR/TTT and LINE L1 treat a bulged course
 * as an arc, never its chord. Malformed metadata fails closed (null).
 */
const resolvePolylineTangentSource = (
  entity: CadPolylineEntity,
  entityId: CadEntityId,
  pickPoint: CadWorldPoint,
  segmentId: string | undefined,
): CadTangentSource | null => {
  if (entity.segmentGeometry == null && entity.segmentWidths == null) {
    const line = resolvePolylineSegment(
      entityId,
      segmentId,
      pickPoint,
      entity.vertices,
      entity.closed === true,
    );
    if (!line) return null;
    return {
      primitive: { kind: 'line', entityId, segmentId: line.segmentId, start: line.start, end: line.end },
      pickPoint: { x: pickPoint.x, y: pickPoint.y },
    };
  }
  const courses = resolveCadPolylineCourses(entity);
  if (!courses) return null;
  let best: { course: (typeof courses)[number]; distance: number } | null = null;
  for (const course of courses) {
    const id = `${entityId}#${course.index}`;
    if (segmentId != null && segmentId !== id) continue;
    let distance: number;
    if (course.kind === 'arc' && course.metrics != null) {
      const foot = cadClosestPointOnArc(
        pickPoint,
        course.metrics.center,
        course.metrics.radius,
        course.metrics.startAngleDeg,
        course.metrics.startAngleDeg + course.metrics.signedSweepDeg,
      );
      distance = cadDistance(pickPoint, foot);
    } else {
      const length = cadDistance(course.from, course.to);
      if (length <= CAD_XY_DEGENERATE_FLOOR) continue;
      const nx = -(course.to.y - course.from.y) / length;
      const ny = (course.to.x - course.from.x) / length;
      distance = Math.abs(nx * (pickPoint.x - course.from.x) + ny * (pickPoint.y - course.from.y));
    }
    if (!best || distance < best.distance) best = { course, distance };
  }
  if (!best) return null;
  const course = best.course;
  if (course.kind === 'arc' && course.metrics != null) {
    return {
      primitive: {
        kind: 'arc',
        entityId,
        segmentId: `${entityId}#${course.index}`,
        center: { ...course.metrics.center },
        radius: course.metrics.radius,
        startAngleDeg: course.metrics.startAngleDeg,
        endAngleDeg: course.metrics.startAngleDeg + course.metrics.signedSweepDeg,
      },
      pickPoint: { x: pickPoint.x, y: pickPoint.y },
    };
  }
  return {
    primitive: {
      kind: 'line',
      entityId,
      segmentId: `${entityId}#${course.index}`,
      start: { x: course.from.x, y: course.from.y },
      end: { x: course.to.x, y: course.to.y },
    },
    pickPoint: { x: pickPoint.x, y: pickPoint.y },
  };
};
