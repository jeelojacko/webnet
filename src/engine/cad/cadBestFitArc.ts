/**
 * CAD best-fit arc: geometric least squares (min sum (dist_i - r)^2).
 *
 * A translation/scale-normalised Kasa seed is refined with a damped
 * Gauss-Newton (LM) loop. The result is projected to a finite sweep using the
 * largest-gap span law; a full circle is refused, matching the CAD arc
 * builder's full-circle refusal precedent.
 */
import { CAD_XY_DEGENERATE_FLOOR } from './cadGeometryShapeBuilders';
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

export type BestFitArcInput = CadBestFitPoint;

export interface BestFitArcResult {
  centerX: number;
  centerY: number;
  radius: number;
  startAngleDeg: number;
  endAngleDeg: number;
  sweepDeg: number;
  arcLength: number;
  rms: number;
  maxAbs: number;
  residuals: number[];
  closestPoints: BestFitArcInput[];
}

interface ArcCircle {
  cx: number;
  cy: number;
  r: number;
}

interface ArcSpan {
  startAngleDeg: number;
  endAngleDeg: number;
  sweepDeg: number;
}

const BEST_FIT_ARC_COLLINEAR_RATIO = 1e-12;
const BEST_FIT_ARC_FULL_CIRCLE_GAP_DEG = 1;
const BEST_FIT_ARC_MIN_SWEEP_DEG = 1e-9;
const BEST_FIT_ARC_MAX_ITERATIONS = 100;
const BEST_FIT_ARC_GRADIENT_TOLERANCE = 1e-10;
const BEST_FIT_ARC_GRADIENT_FALLBACK = 1e-6;
const BEST_FIT_ARC_STEP_TOLERANCE = 1e-10;

/** Kasa algebraic circle seed in the normalised frame. */
const kasaSeed = (points: readonly CadBestFitPoint[]): ArcCircle | null => {
  let suu = 0;
  let svv = 0;
  let suv = 0;
  let su3 = 0;
  let sv3 = 0;
  let s2 = 0;
  for (const point of points) {
    const norm = point.x * point.x + point.y * point.y;
    suu += point.x * point.x;
    svv += point.y * point.y;
    suv += point.x * point.y;
    su3 += point.x * norm;
    sv3 += point.y * norm;
    s2 += norm;
  }
  if (suu + svv <= CAD_BEST_FIT_FLOOR) return null;
  const determinant = suu * svv - suv * suv;
  if (determinant <= (suu + svv) * (suu + svv) * BEST_FIT_ARC_COLLINEAR_RATIO) return null;
  const a = (su3 * svv - sv3 * suv) / determinant;
  const b = (sv3 * suu - su3 * suv) / determinant;
  const radiusSquared = (a * a + b * b) / 4 + s2 / points.length;
  if (!Number.isFinite(radiusSquared) || radiusSquared <= CAD_BEST_FIT_FLOOR) return null;
  return { cx: a / 2, cy: b / 2, r: Math.sqrt(radiusSquared) };
};

const arcCost = (params: readonly number[], points: readonly CadBestFitPoint[]): number => {
  let cost = 0;
  for (const point of points) {
    const distance = Math.hypot(point.x - params[0], point.y - params[1]);
    const residual = distance - params[2];
    cost += residual * residual;
  }
  return cost;
};

interface ArcNormalEquations {
  jtj: number[][];
  jtr: number[];
}

const arcNormalEquations = (
  params: readonly number[],
  points: readonly CadBestFitPoint[],
): ArcNormalEquations => {
  const jtj = [
    [0, 0, 0],
    [0, 0, 0],
    [0, 0, 0],
  ];
  const jtr = [0, 0, 0];
  for (const point of points) {
    const dx = point.x - params[0];
    const dy = point.y - params[1];
    const distance = Math.hypot(dx, dy);
    if (distance <= CAD_BEST_FIT_FLOOR) continue;
    const residual = distance - params[2];
    const row = [-dx / distance, -dy / distance, -1];
    for (let rowIndex = 0; rowIndex < 3; rowIndex += 1) {
      for (let column = 0; column < 3; column += 1) {
        jtj[rowIndex][column] += row[rowIndex] * row[column];
      }
      jtr[rowIndex] += row[rowIndex] * residual;
    }
  }
  return { jtj, jtr };
};

const refineArc = (seed: ArcCircle, points: readonly CadBestFitPoint[]): ArcCircle | null => {
  let params = [seed.cx, seed.cy, seed.r];
  let cost = arcCost(params, points);
  let lambda = 1e-6;
  const result = (): ArcCircle => ({ cx: params[0], cy: params[1], r: params[2] });
  for (let iteration = 0; iteration < BEST_FIT_ARC_MAX_ITERATIONS; iteration += 1) {
    const { jtj, jtr } = arcNormalEquations(params, points);
    const gradient = Math.hypot(...jtr);
    if (gradient <= BEST_FIT_ARC_GRADIENT_TOLERANCE * (1 + cost)) return result();
    const damped = jtj.map((row, rowIndex) =>
      row.map((value, column) =>
        rowIndex === column ? value + lambda * (Math.abs(value) + CAD_BEST_FIT_FLOOR) : value,
      ),
    );
    const step = cadBestFitSolveLinearSystem(damped, jtr.map((value) => -value));
    if (!step) {
      lambda *= 10;
      if (lambda > 1e12) return gradient <= BEST_FIT_ARC_GRADIENT_FALLBACK * (1 + cost) ? result() : null;
      continue;
    }
    if (Math.hypot(...step) <= BEST_FIT_ARC_STEP_TOLERANCE * (1 + Math.hypot(...params))) {
      return result();
    }
    const candidate = params.map((value, index) => value + step[index]);
    const candidateCost = arcCost(candidate, points);
    if (candidateCost < cost && Number.isFinite(candidateCost)) {
      params = candidate;
      cost = candidateCost;
      lambda = Math.max(lambda * 0.3, 1e-12);
    } else {
      lambda *= 10;
      if (lambda > 1e12) return gradient <= BEST_FIT_ARC_GRADIENT_FALLBACK * (1 + cost) ? result() : null;
    }
  }
  const { jtr } = arcNormalEquations(params, points);
  return Math.hypot(...jtr) <= BEST_FIT_ARC_GRADIENT_FALLBACK * (1 + cost) ? result() : null;
};

const arcSpanLaw = (
  points: readonly CadBestFitPoint[],
  center: CadBestFitPoint,
): ArcSpan | null => {
  const angles = points
    .map((point) => Math.atan2(point.y - center.y, point.x - center.x))
    .sort((first, second) => first - second);
  let largestGap = 0;
  let gapIndex = angles.length - 1;
  for (let index = 0; index < angles.length; index += 1) {
    const next = index === angles.length - 1 ? angles[0] + 2 * Math.PI : angles[index + 1];
    const gap = next - angles[index];
    if (gap > largestGap) {
      largestGap = gap;
      gapIndex = index;
    }
  }
  if ((largestGap * 180) / Math.PI <= BEST_FIT_ARC_FULL_CIRCLE_GAP_DEG) return null;
  const sweepDeg = 360 - (largestGap * 180) / Math.PI;
  if (!Number.isFinite(sweepDeg) || sweepDeg <= BEST_FIT_ARC_MIN_SWEEP_DEG) return null;
  const startAngleDeg = cadBestFitNormalizeAngleDeg(
    (angles[(gapIndex + 1) % angles.length] * 180) / Math.PI,
  );
  return { startAngleDeg, endAngleDeg: startAngleDeg + sweepDeg, sweepDeg };
};

const arcPointAt = (center: CadBestFitPoint, radius: number, angleDeg: number): CadBestFitPoint => ({
  x: center.x + Math.cos((angleDeg * Math.PI) / 180) * radius,
  y: center.y + Math.sin((angleDeg * Math.PI) / 180) * radius,
});

const closestPointOnArc = (
  point: CadBestFitPoint,
  center: CadBestFitPoint,
  radius: number,
  span: ArcSpan,
): CadBestFitPoint => {
  const angleDeg = cadBestFitNormalizeAngleDeg(
    (Math.atan2(point.y - center.y, point.x - center.x) * 180) / Math.PI,
  );
  const delta = cadBestFitNormalizeAngleDeg(angleDeg - span.startAngleDeg);
  if (delta <= span.sweepDeg + 1e-9) return arcPointAt(center, radius, angleDeg);
  const startPoint = arcPointAt(center, radius, span.startAngleDeg);
  const endPoint = arcPointAt(center, radius, span.endAngleDeg);
  const toStart = Math.hypot(point.x - startPoint.x, point.y - startPoint.y);
  const toEnd = Math.hypot(point.x - endPoint.x, point.y - endPoint.y);
  return toStart <= toEnd ? startPoint : endPoint;
};

export const cadBestFitArc = (
  points: readonly BestFitArcInput[],
): BestFitArcResult | null => {
  const prepared = cadPrepareBestFitPoints(points);
  if (prepared.distinct.length < 3) return null;
  if (!Number.isFinite(prepared.span) || prepared.span <= CAD_BEST_FIT_FLOOR) return null;
  const frame = cadBestFitLocalFrame(prepared.centroid, prepared.span);
  const local = prepared.distinct.map((point) => frame.toLocal(point));
  const seed = kasaSeed(local);
  if (!seed) return null;
  const refined = refineArc(seed, local);
  if (!refined) return null;
  const center = frame.toWorld(refined.cx, refined.cy);
  const radius = refined.r * prepared.span;
  if (!Number.isFinite(radius) || radius <= CAD_XY_DEGENERATE_FLOOR) return null;
  const span = arcSpanLaw(local, { x: refined.cx, y: refined.cy });
  if (!span) return null;
  const residuals = prepared.finite.map(
    (point) => Math.hypot(point.x - center.x, point.y - center.y) - radius,
  );
  return {
    centerX: center.x,
    centerY: center.y,
    radius,
    startAngleDeg: span.startAngleDeg,
    endAngleDeg: span.endAngleDeg,
    sweepDeg: span.sweepDeg,
    arcLength: radius * ((span.sweepDeg * Math.PI) / 180),
    rms: Math.sqrt(cadBestFitMeanSquared(residuals)),
    maxAbs: cadBestFitMaxAbs(residuals),
    residuals,
    closestPoints: prepared.finite.map((point) => closestPointOnArc(point, center, radius, span)),
  };
};
