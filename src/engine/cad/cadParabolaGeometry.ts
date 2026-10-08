/**
 * Canonical parabola geometry: pure helpers, no entity import.
 *
 * Canonical form (units are metres; angles in the struct are documented):
 *   vertex V, opening-axis direction angle A (CCW from +X),
 *   focal length f > 0, finite extent [tStart, tEnd].
 *
 * With unit basis a = (cos A, sin A) (axis / opening) and
 * b = (sin A, -cos A) (vertex tangent):
 *
 *   P(t) = V + b * (2 f t) + a * (f t^2)
 *
 * Speed is 2 f sqrt(1 + t^2); arc length is the closed-form
 * f * [t sqrt(1+t^2) + asinh(t)] difference. All entry points are
 * finite-guarded and bounded.
 */
import type { CadBestFitPoint } from './cadBestFitCommon';

export interface CanonicalParabola {
  vertexX: number;
  vertexY: number;
  axisAngleDeg: number;
  focalLength: number;
  tStart: number;
  tEnd: number;
}

export interface CadParabolaAxisBasis {
  aX: number;
  aY: number;
  bX: number;
  bY: number;
}

export interface CadParabolaBounds {
  minX: number;
  minY: number;
  maxX: number;
  maxY: number;
}

const PARABOLA_FLOOR = 1e-12;
const CUBIC_ROOT_TOLERANCE = 1e-12;
const CUBIC_NEWTON_ITERATIONS = 4;

export const cadParabolaAxisBasis = (axisAngleDeg: number): CadParabolaAxisBasis => {
  const radians = (axisAngleDeg * Math.PI) / 180;
  const cos = Math.cos(radians);
  const sin = Math.sin(radians);
  return { aX: cos, aY: sin, bX: sin, bY: -cos };
};

const isCanonicalParabola = (parabola: CanonicalParabola): boolean =>
  Number.isFinite(parabola.vertexX) &&
  Number.isFinite(parabola.vertexY) &&
  Number.isFinite(parabola.axisAngleDeg) &&
  Number.isFinite(parabola.focalLength) &&
  Number.isFinite(parabola.tStart) &&
  Number.isFinite(parabola.tEnd) &&
  parabola.focalLength > PARABOLA_FLOOR &&
  parabola.tStart <= parabola.tEnd;

export const cadParabolaParamPoint = (
  parabola: CanonicalParabola,
  t: number,
): CadBestFitPoint => {
  const { aX, aY, bX, bY } = cadParabolaAxisBasis(parabola.axisAngleDeg);
  const f = parabola.focalLength;
  const along = f * t * t;
  const tangent = 2 * f * t;
  return {
    x: parabola.vertexX + aX * along + bX * tangent,
    y: parabola.vertexY + aY * along + bY * tangent,
  };
};

export const cadParabolaSpeed = (parabola: CanonicalParabola, t: number): number =>
  2 * parabola.focalLength * Math.sqrt(1 + t * t);

const arcLengthPrimitive = (t: number): number =>
  t * Math.sqrt(1 + t * t) + Math.asinh(t);

export const cadParabolaArcLength = (
  parabola: CanonicalParabola,
  t0: number,
  t1: number,
): number | null => {
  if (!Number.isFinite(t0) || !Number.isFinite(t1)) return null;
  const length = parabola.focalLength * (arcLengthPrimitive(t1) - arcLengthPrimitive(t0));
  return Number.isFinite(length) ? length : null;
};

export const cadParabolaCurveLength = (parabola: CanonicalParabola): number | null =>
  cadParabolaArcLength(parabola, parabola.tStart, parabola.tEnd);

const clamp = (value: number, min: number, max: number): number =>
  value < min ? min : value > max ? max : value;

/** Extrema of a world axis: evaluate ends plus interior dx/dt=0 / dy/dt=0 roots. */
export const cadParabolaBoundsAnalytic = (
  parabola: CanonicalParabola,
): CadParabolaBounds | null => {
  if (!isCanonicalParabola(parabola)) return null;
  const { aX, aY, bX, bY } = cadParabolaAxisBasis(parabola.axisAngleDeg);
  const candidates = [parabola.tStart, parabola.tEnd];
  if (Math.abs(aX) > PARABOLA_FLOOR) candidates.push(-bX / aX);
  if (Math.abs(aY) > PARABOLA_FLOOR) candidates.push(-bY / aY);
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  for (const t of candidates) {
    if (t < parabola.tStart || t > parabola.tEnd) continue;
    const point = cadParabolaParamPoint(parabola, t);
    if (point.x < minX) minX = point.x;
    if (point.x > maxX) maxX = point.x;
    if (point.y < minY) minY = point.y;
    if (point.y > maxY) maxY = point.y;
  }
  return { minX, minY, maxX, maxY };
};

const refineCubicRoots = (roots: readonly number[], p: number, q: number): number[] => {
  const refined: number[] = [];
  for (const root of roots) {
    let t = root;
    for (let i = 0; i < CUBIC_NEWTON_ITERATIONS; i += 1) {
      const value = ((t * t + p) * t) + q;
      const derivative = 3 * t * t + p;
      if (Math.abs(derivative) <= PARABOLA_FLOOR) break;
      t -= value / derivative;
    }
    if (Number.isFinite(t)) refined.push(t);
  }
  const unique: number[] = [];
  for (const root of refined) {
    const duplicate = unique.some(
      (kept) => Math.abs(root - kept) <= CUBIC_ROOT_TOLERANCE * (1 + Math.abs(root)),
    );
    if (!duplicate) unique.push(root);
  }
  return unique.sort((first, second) => first - second);
};

/** Deterministic real roots of t^3 + p t + q = 0 (Newton-refined, deduped). */
export const cadSolveDepressedCubic = (p: number, q: number): number[] => {
  if (!Number.isFinite(p) || !Number.isFinite(q)) return [];
  if (Math.abs(p) <= PARABOLA_FLOOR && Math.abs(q) <= PARABOLA_FLOOR) return [0];
  if (Math.abs(p) <= PARABOLA_FLOOR) return refineCubicRoots([Math.cbrt(-q)], p, q);
  if (Math.abs(q) <= PARABOLA_FLOOR) {
    const roots = [0];
    if (p < 0) {
      const root = Math.sqrt(-p);
      roots.push(-root, root);
    }
    return refineCubicRoots(roots, p, q);
  }
  const discriminant = -(4 * p * p * p + 27 * q * q);
  if (discriminant > 0) {
    const magnitude = 2 * Math.sqrt(-p / 3);
    const argument = clamp((3 * q) / (p * magnitude), -1, 1);
    const theta = Math.acos(argument) / 3;
    const roots: number[] = [];
    for (let index = 0; index < 3; index += 1) {
      roots.push(magnitude * Math.cos(theta - (2 * Math.PI * index) / 3));
    }
    return refineCubicRoots(roots, p, q);
  }
  const root = Math.cbrt(-q / 2 + Math.sqrt(q * q / 4 + p * p * p / 27)) +
    Math.cbrt(-q / 2 - Math.sqrt(q * q / 4 + p * p * p / 27));
  return refineCubicRoots([root], p, q);
};

interface ParabolaLocal {
  u: number;
  v: number;
  f: number;
}

const toLocal = (parabola: CanonicalParabola, point: CadBestFitPoint): ParabolaLocal => {
  const { aX, aY, bX, bY } = cadParabolaAxisBasis(parabola.axisAngleDeg);
  const dx = point.x - parabola.vertexX;
  const dy = point.y - parabola.vertexY;
  return { u: dx * aX + dy * aY, v: dx * bX + dy * bY, f: parabola.focalLength };
};

const localSquaredDistance = (local: ParabolaLocal, t: number): number => {
  const du = local.u - local.f * t * t;
  const dv = local.v - 2 * local.f * t;
  return du * du + dv * dv;
};

const closestRootToLocal = (local: ParabolaLocal, candidates: readonly number[]): number => {
  let bestT = candidates[0];
  let bestDistance = localSquaredDistance(local, bestT);
  for (const t of candidates) {
    const distance = localSquaredDistance(local, t);
    if (distance < bestDistance) {
      bestDistance = distance;
      bestT = t;
    }
  }
  return bestT;
};

/** Closest parameter on the infinite parabolas, or null when non-finite. */
export const cadParabolaClosestParameterInfinite = (
  parabola: CanonicalParabola,
  point: CadBestFitPoint,
): number | null => {
  if (!isCanonicalParabola(parabola)) return null;
  if (!Number.isFinite(point.x) || !Number.isFinite(point.y)) return null;
  const local = toLocal(parabola, point);
  const roots = cadSolveDepressedCubic((2 * local.f - local.u) / local.f, -local.v / local.f);
  if (roots.length === 0) return null;
  return closestRootToLocal(local, roots);
};

/** Closest parameter on the finite curve [tStart, tEnd]. */
export const cadParabolaClosestParameterFinite = (
  parabola: CanonicalParabola,
  point: CadBestFitPoint,
): number | null => {
  if (!isCanonicalParabola(parabola)) return null;
  const local = toLocal(parabola, point);
  const interior = cadSolveDepressedCubic(
    (2 * local.f - local.u) / local.f,
    -local.v / local.f,
  ).filter((t) => t >= parabola.tStart && t <= parabola.tEnd);
  const candidates = [parabola.tStart, parabola.tEnd, ...interior];
  return closestRootToLocal(local, candidates);
};

export const cadParabolaClosestPoint = (
  parabola: CanonicalParabola,
  point: CadBestFitPoint,
): CadBestFitPoint | null => {
  const t = cadParabolaClosestParameterFinite(parabola, point);
  return t === null ? null : cadParabolaParamPoint(parabola, t);
};

/** Unit normal at P(t), positive toward the opening/focus side. */
export const cadParabolaNormal = (
  parabola: CanonicalParabola,
  t: number,
): CadBestFitPoint => {
  const { aX, aY, bX, bY } = cadParabolaAxisBasis(parabola.axisAngleDeg);
  const scale = Math.sqrt(1 + t * t);
  return {
    x: (aX - bX * t) / scale,
    y: (aY - bY * t) / scale,
  };
};

/** Parameter splitting the finite arc into equal arc lengths (monotonic solve). */
export const cadParabolaHalfLengthMidpointT = (
  parabola: CanonicalParabola,
): number | null => {
  if (!isCanonicalParabola(parabola)) return null;
  const target = (arcLengthPrimitive(parabola.tStart) + arcLengthPrimitive(parabola.tEnd)) / 2;
  let low = parabola.tStart;
  let high = parabola.tEnd;
  for (let iteration = 0; iteration < 200; iteration += 1) {
    const mid = (low + high) / 2;
    if (arcLengthPrimitive(mid) < target) low = mid;
    else high = mid;
    if (high - low <= 1e-15 * (1 + Math.abs(mid))) break;
  }
  return (low + high) / 2;
};

interface LocalLine {
  u0: number;
  v0: number;
  du: number;
  dv: number;
}

const solveSegmentIntersections = (local: LocalLine, f: number): number[] => {
  const { u0, v0, du, dv } = local;
  if (Math.abs(dv) <= PARABOLA_FLOOR) {
    if (Math.abs(du) <= PARABOLA_FLOOR) return [];
    const s = (v0 * v0 / (4 * f) - u0) / du;
    return [s];
  }
  const a = dv * dv;
  const b = 2 * v0 * dv - 4 * f * du;
  const c = v0 * v0 - 4 * f * u0;
  const discriminant = b * b - 4 * a * c;
  if (discriminant < 0) return [];
  const root = Math.sqrt(discriminant);
  return [(-b - root) / (2 * a), (-b + root) / (2 * a)];
};

/** Intersections of the finite parabola arc with a line segment. */
export const cadParabolaLineIntersection = (
  parabola: CanonicalParabola,
  lineStart: CadBestFitPoint,
  lineEnd: CadBestFitPoint,
): CadBestFitPoint[] => {
  if (!isCanonicalParabola(parabola)) return [];
  if (![lineStart.x, lineStart.y, lineEnd.x, lineEnd.y].every(Number.isFinite)) return [];
  const start = toLocal(parabola, lineStart);
  const end = toLocal(parabola, lineEnd);
  const localLine: LocalLine = {
    u0: start.u,
    v0: start.v,
    du: end.u - start.u,
    dv: end.v - start.v,
  };
  const hits: CadBestFitPoint[] = [];
  for (const s of solveSegmentIntersections(localLine, parabola.focalLength)) {
    if (!Number.isFinite(s) || s < 0 || s > 1) continue;
    const v = localLine.v0 + localLine.dv * s;
    const t = v / (2 * parabola.focalLength);
    if (t < parabola.tStart || t > parabola.tEnd) continue;
    hits.push(cadParabolaParamPoint(parabola, t));
  }
  return hits;
};
