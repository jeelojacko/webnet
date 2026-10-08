/**
 * CAD best-fit parabola: rotated geometric (orthogonal-distance) least squares.
 *
 * This is NOT a world-axis y = a x^2 + b x + c regression. Points are
 * normalised, a rotation-aware coarse seed is chosen by multi-angle quadratic
 * regression scored with true closest-point cost, then the canonical
 * vertex/axis/focal are refined (damped Gauss-Newton) against closest-point
 * distances from cadParabolaGeometry.
 */
import {
  CAD_BEST_FIT_FLOOR,
  cadBestFitLocalFrame,
  cadBestFitMaxAbs,
  cadBestFitMeanSquared,
  cadBestFitNormalizeAngleDeg,
  cadBestFitSolveLinearSystem,
  cadPrepareBestFitPoints,
  type CadBestFitPoint,
} from './cadBestFitCommon';
import {
  cadParabolaClosestParameterFinite,
  cadParabolaClosestParameterInfinite,
  cadParabolaNormal,
  cadParabolaParamPoint,
  type CanonicalParabola,
} from './cadParabolaGeometry';

export type BestFitParabolaInput = CadBestFitPoint;

export interface BestFitParabolaResult {
  canonical: CanonicalParabola;
  rms: number;
  maxAbs: number;
  residuals: number[];
  closestPoints: BestFitParabolaInput[];
  tValues: number[];
}

interface ParabolaParams {
  vx: number;
  vy: number;
  thetaRad: number;
  f: number;
}

const PARABOLA_FIT_ALPHA_FLOOR = 1e-12;
const PARABOLA_FIT_MAX_ITERATIONS = 100;
const PARABOLA_FIT_GRADIENT_TOLERANCE = 1e-10;
const PARABOLA_FIT_T_RANGE_FLOOR = 1e-9;
const PARABOLA_FIT_MAX_FOCAL_SPAN_RATIO = 1e6;
const PARABOLA_FIT_FD_STEP = 1e-6;
const PARABOLA_FIT_STEP_TOLERANCE = 1e-10;
const PARABOLA_FIT_AXIS_TRIAL_DEG = 5;
const PARABOLA_FIT_AXIS_TRIAL_COUNT = 180 / PARABOLA_FIT_AXIS_TRIAL_DEG;

const canonicalFromParams = (
  params: ParabolaParams,
  tStart: number,
  tEnd: number,
): CanonicalParabola => ({
  vertexX: params.vx,
  vertexY: params.vy,
  axisAngleDeg: cadBestFitNormalizeAngleDeg((params.thetaRad * 180) / Math.PI),
  focalLength: params.f,
  tStart,
  tEnd,
});

const parabolaInfiniteCost = (
  params: ParabolaParams,
  points: readonly CadBestFitPoint[],
): number => {
  const canonical = canonicalFromParams(params, -1, 1);
  let cost = 0;
  for (const point of points) {
    const t = cadParabolaClosestParameterInfinite(canonical, point);
    if (t === null) return Infinity;
    const projected = cadParabolaParamPoint(canonical, t);
    const dx = point.x - projected.x;
    const dy = point.y - projected.y;
    cost += dx * dx + dy * dy;
  }
  return cost;
};

const quadraticRegressionSeed = (
  points: readonly CadBestFitPoint[],
  axisAngleRad: number,
): ParabolaParams | null => {
  const cos = Math.cos(axisAngleRad);
  const sin = Math.sin(axisAngleRad);
  const aX = cos;
  const aY = sin;
  const bX = sin;
  const bY = -cos;
  let sv4 = 0;
  let sv3 = 0;
  let sv2 = 0;
  let sv = 0;
  let suv2 = 0;
  let suv = 0;
  let su = 0;
  for (const point of points) {
    const u = point.x * aX + point.y * aY;
    const v = point.x * bX + point.y * bY;
    const v2 = v * v;
    sv4 += v2 * v2;
    sv3 += v2 * v;
    sv2 += v2;
    sv += v;
    suv2 += u * v2;
    suv += u * v;
    su += u;
  }
  const coefficients = cadBestFitSolveLinearSystem(
    [
      [sv4, sv3, sv2],
      [sv3, sv2, sv],
      [sv2, sv, points.length],
    ],
    [suv2, suv, su],
  );
  if (!coefficients) return null;
  let [alpha, beta, gamma] = coefficients;
  let thetaRad = axisAngleRad;
  if (alpha < 0) {
    alpha = -alpha;
    gamma = -gamma;
    thetaRad += Math.PI;
  }
  if (!Number.isFinite(alpha) || Math.abs(alpha) <= PARABOLA_FIT_ALPHA_FLOOR) return null;
  const f = 1 / (4 * alpha);
  const v0 = -beta / (2 * alpha);
  const u0 = gamma - alpha * v0 * v0;
  const cosFlip = Math.cos(thetaRad);
  const sinFlip = Math.sin(thetaRad);
  return {
    vx: cosFlip * u0 + sinFlip * v0,
    vy: sinFlip * u0 - cosFlip * v0,
    thetaRad,
    f,
  };
};

const seedParabola = (points: readonly CadBestFitPoint[]): ParabolaParams | null => {
  let best: ParabolaParams | null = null;
  let bestCost = Infinity;
  for (let index = 0; index < PARABOLA_FIT_AXIS_TRIAL_COUNT; index += 1) {
    const axisAngleRad = (index * PARABOLA_FIT_AXIS_TRIAL_DEG * Math.PI) / 180;
    const candidate = quadraticRegressionSeed(points, axisAngleRad);
    if (!candidate) continue;
    const cost = parabolaInfiniteCost(candidate, points);
    if (Number.isFinite(cost) && cost < bestCost) {
      bestCost = cost;
      best = candidate;
    }
  }
  return best;
};

const parabolaResidualVector = (
  params: ParabolaParams,
  points: readonly CadBestFitPoint[],
): number[] | null => {
  const canonical = canonicalFromParams(params, -1, 1);
  const residuals: number[] = [];
  for (const point of points) {
    const t = cadParabolaClosestParameterInfinite(canonical, point);
    if (t === null) return null;
    const projected = cadParabolaParamPoint(canonical, t);
    residuals.push(projected.x - point.x, projected.y - point.y);
  }
  return residuals;
};

const withParameterDelta = (
  params: ParabolaParams,
  index: number,
  delta: number,
): ParabolaParams => {
  switch (index) {
    case 0:
      return { ...params, vx: params.vx + delta };
    case 1:
      return { ...params, vy: params.vy + delta };
    case 2:
      return { ...params, thetaRad: params.thetaRad + delta };
    default:
      return { ...params, f: params.f + delta };
  }
};

interface ParabolaNormalEquations {
  jtj: number[][];
  jtr: number[];
  cost: number;
  valid: boolean;
}

const emptyParabolaEquations = (valid: boolean): ParabolaNormalEquations => ({
  jtj: [
    [0, 0, 0, 0],
    [0, 0, 0, 0],
    [0, 0, 0, 0],
    [0, 0, 0, 0],
  ],
  jtr: [0, 0, 0, 0],
  cost: Infinity,
  valid,
});

/** Gauss-Newton normal equations from a central-difference residual Jacobian. */
const parabolaNormalEquations = (
  params: ParabolaParams,
  points: readonly CadBestFitPoint[],
): ParabolaNormalEquations => {
  const base = parabolaResidualVector(params, points);
  if (!base) return emptyParabolaEquations(false);
  const columns: number[][] = [];
  const jtr = [0, 0, 0, 0];
  for (let index = 0; index < 4; index += 1) {
    const value = index === 0
      ? params.vx
      : index === 1
        ? params.vy
        : index === 2
          ? params.thetaRad
          : params.f;
    const step = PARABOLA_FIT_FD_STEP * (1 + Math.abs(value));
    const plus = parabolaResidualVector(withParameterDelta(params, index, step), points);
    const minus = parabolaResidualVector(withParameterDelta(params, index, -step), points);
    if (!plus || !minus) return emptyParabolaEquations(false);
    const column = plus.map((entry, row) => (entry - minus[row]) / (2 * step));
    columns.push(column);
    let projection = 0;
    for (let row = 0; row < base.length; row += 1) projection += column[row] * base[row];
    jtr[index] = projection;
  }
  const jtj = [
    [0, 0, 0, 0],
    [0, 0, 0, 0],
    [0, 0, 0, 0],
    [0, 0, 0, 0],
  ];
  for (let row = 0; row < 4; row += 1) {
    for (let column = 0; column < 4; column += 1) {
      let sum = 0;
      for (let entry = 0; entry < base.length; entry += 1) {
        sum += columns[row][entry] * columns[column][entry];
      }
      jtj[row][column] = sum;
    }
  }
  let cost = 0;
  for (const residual of base) cost += residual * residual;
  return { jtj, jtr, cost, valid: true };
};

const dampedMatrix = (jtj: readonly number[][], lambda: number): number[][] =>
  jtj.map((row, rowIndex) =>
    row.map((value, column) =>
      rowIndex === column ? value + lambda * (Math.abs(value) + CAD_BEST_FIT_FLOOR) : value,
    ),
  );

const refineParabola = (
  seed: ParabolaParams,
  points: readonly CadBestFitPoint[],
): ParabolaParams | null => {
  let params = { ...seed };
  let lambda = 1e-6;
  for (let iteration = 0; iteration < PARABOLA_FIT_MAX_ITERATIONS; iteration += 1) {
    const equations = parabolaNormalEquations(params, points);
    if (!equations.valid) return null;
    if (Math.hypot(...equations.jtr) <= PARABOLA_FIT_GRADIENT_TOLERANCE * (1 + equations.cost)) {
      return params;
    }
    const step = cadBestFitSolveLinearSystem(
      dampedMatrix(equations.jtj, lambda),
      equations.jtr.map((value) => -value),
    );
    if (!step) {
      lambda *= 10;
      if (lambda > 1e12) return null;
      continue;
    }
    const parameterNorm = Math.hypot(params.vx, params.vy, params.thetaRad, params.f);
    if (Math.hypot(...step) <= PARABOLA_FIT_STEP_TOLERANCE * (1 + parameterNorm)) return params;
    const candidate: ParabolaParams = {
      vx: params.vx + step[0],
      vy: params.vy + step[1],
      thetaRad: params.thetaRad + step[2],
      f: params.f + step[3],
    };
    const candidateEquations = parabolaNormalEquations(candidate, points);
    if (candidateEquations.valid && candidateEquations.cost < equations.cost) {
      params = candidate;
      lambda = Math.max(lambda * 0.3, 1e-12);
    } else {
      lambda *= 10;
      if (lambda > 1e12) return null;
    }
  }
  return null;
};

interface ParabolaExtent {
  tStart: number;
  tEnd: number;
}

const parabolaExtent = (
  params: ParabolaParams,
  points: readonly CadBestFitPoint[],
): ParabolaExtent | null => {
  const canonical = canonicalFromParams(params, -1, 1);
  let tStart = Infinity;
  let tEnd = -Infinity;
  for (const point of points) {
    const t = cadParabolaClosestParameterInfinite(canonical, point);
    if (t === null) return null;
    if (t < tStart) tStart = t;
    if (t > tEnd) tEnd = t;
  }
  if (!Number.isFinite(tStart) || !Number.isFinite(tEnd)) return null;
  if (tEnd - tStart <= PARABOLA_FIT_T_RANGE_FLOOR) return null;
  return { tStart, tEnd };
};

const toWorldCanonical = (
  params: ParabolaParams,
  extent: ParabolaExtent,
  centroid: CadBestFitPoint,
  span: number,
): CanonicalParabola => ({
  vertexX: centroid.x + span * params.vx,
  vertexY: centroid.y + span * params.vy,
  axisAngleDeg: cadBestFitNormalizeAngleDeg((params.thetaRad * 180) / Math.PI),
  focalLength: span * params.f,
  tStart: extent.tStart,
  tEnd: extent.tEnd,
});

interface ParabolaResiduals {
  residuals: number[];
  closestPoints: CadBestFitPoint[];
  tValues: number[];
}

const parabolaResiduals = (
  canonical: CanonicalParabola,
  points: readonly CadBestFitPoint[],
): ParabolaResiduals | null => {
  const residuals: number[] = [];
  const closestPoints: CadBestFitPoint[] = [];
  const tValues: number[] = [];
  for (const point of points) {
    const t = cadParabolaClosestParameterFinite(canonical, point);
    if (t === null) return null;
    const projected = cadParabolaParamPoint(canonical, t);
    const normal = cadParabolaNormal(canonical, t);
    residuals.push((point.x - projected.x) * normal.x + (point.y - projected.y) * normal.y);
    closestPoints.push(projected);
    tValues.push(t);
  }
  return { residuals, closestPoints, tValues };
};

export const cadBestFitParabola = (
  points: readonly BestFitParabolaInput[],
): BestFitParabolaResult | null => {
  const prepared = cadPrepareBestFitPoints(points);
  if (prepared.distinct.length < 5) return null;
  if (!Number.isFinite(prepared.span) || prepared.span <= CAD_BEST_FIT_FLOOR) return null;
  const frame = cadBestFitLocalFrame(prepared.centroid, prepared.span);
  const local = prepared.distinct.map((point) => frame.toLocal(point));
  const seed = seedParabola(local);
  if (!seed) return null;
  const refined = refineParabola(seed, local);
  if (!refined) return null;
  const extent = parabolaExtent(refined, local);
  if (!extent) return null;
  const canonical = toWorldCanonical(refined, extent, prepared.centroid, prepared.span);
  if (
    !Number.isFinite(canonical.focalLength) ||
    canonical.focalLength <= CAD_BEST_FIT_FLOOR ||
    canonical.focalLength > prepared.span * PARABOLA_FIT_MAX_FOCAL_SPAN_RATIO
  ) {
    return null;
  }
  const reporting = parabolaResiduals(canonical, prepared.finite);
  if (!reporting) return null;
  return {
    canonical,
    rms: Math.sqrt(cadBestFitMeanSquared(reporting.residuals)),
    maxAbs: cadBestFitMaxAbs(reporting.residuals),
    residuals: reporting.residuals,
    closestPoints: reporting.closestPoints,
    tValues: reporting.tValues,
  };
};
