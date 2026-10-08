/**
 * Shared numeric helpers for the CAD best-fit line / arc / parabola solvers.
 *
 * Pure numerics only: no CadEntity union, no UI. Samples are filtered for
 * finiteness, scaled to a characteristic span for conditioning, and collapsed
 * to a lexicographically sorted distinct set so every fit is deterministic and
 * independent of the caller's point order.
 */
import { CAD_XY_DEGENERATE_FLOOR } from './cadGeometryShapeBuilders';

export interface CadBestFitPoint {
  x: number;
  y: number;
}

/** Absolute numeric floor shared with the CAD draw geometry guards. */
export const CAD_BEST_FIT_FLOOR = CAD_XY_DEGENERATE_FLOOR;

/** Relative dedupe tolerance applied to the characteristic span. */
export const CAD_BEST_FIT_DEDUPE_RATIO = 1e-12;

export interface CadBestFitPrepared {
  /** Finite samples in caller order (for residual reporting). */
  finite: CadBestFitPoint[];
  /** Finite, deduped, lexicographically sorted samples (for fitting). */
  distinct: CadBestFitPoint[];
  /** Mean of the distinct samples (world). */
  centroid: CadBestFitPoint;
  /** max(width, height) of the finite samples, 0 when degenerate. */
  span: number;
}

export const cadBestFitFinitePoints = (
  points: readonly CadBestFitPoint[],
): CadBestFitPoint[] =>
  points
    .filter((point) => Number.isFinite(point.x) && Number.isFinite(point.y))
    .map((point) => ({ x: point.x, y: point.y }));

export const cadBestFitSpan = (points: readonly CadBestFitPoint[]): number => {
  if (points.length === 0) return 0;
  let minX = Infinity;
  let maxX = -Infinity;
  let minY = Infinity;
  let maxY = -Infinity;
  for (const point of points) {
    if (point.x < minX) minX = point.x;
    if (point.x > maxX) maxX = point.x;
    if (point.y < minY) minY = point.y;
    if (point.y > maxY) maxY = point.y;
  }
  return Math.max(maxX - minX, maxY - minY);
};

export const cadBestFitCentroid = (
  points: readonly CadBestFitPoint[],
): CadBestFitPoint => {
  if (points.length === 0) return { x: 0, y: 0 };
  let sumX = 0;
  let sumY = 0;
  for (const point of points) {
    sumX += point.x;
    sumY += point.y;
  }
  return { x: sumX / points.length, y: sumY / points.length };
};

export const cadBestFitSortUnique = (
  points: readonly CadBestFitPoint[],
  tolerance: number,
): CadBestFitPoint[] => {
  const sorted = [...points].sort((first, second) =>
    first.x === second.x ? first.y - second.y : first.x - second.x,
  );
  const distinct: CadBestFitPoint[] = [];
  for (const point of sorted) {
    const duplicate = distinct.some(
      (kept) => Math.hypot(point.x - kept.x, point.y - kept.y) <= tolerance,
    );
    if (!duplicate) distinct.push({ x: point.x, y: point.y });
  }
  return distinct;
};

export const cadPrepareBestFitPoints = (
  points: readonly CadBestFitPoint[],
): CadBestFitPrepared => {
  const finite = cadBestFitFinitePoints(points);
  const span = cadBestFitSpan(finite);
  const tolerance = Math.max(span * CAD_BEST_FIT_DEDUPE_RATIO, CAD_BEST_FIT_FLOOR);
  const distinct = cadBestFitSortUnique(finite, tolerance);
  const centroid = cadBestFitCentroid(distinct.length > 0 ? distinct : finite);
  return { finite, distinct, centroid, span };
};

/** Closure over world points normalised by centroid + span for conditioning. */
export interface CadBestFitLocalFrame {
  centroid: CadBestFitPoint;
  span: number;
  toWorld(_localX: number, _localY: number): CadBestFitPoint;
  toLocal(_point: CadBestFitPoint): CadBestFitPoint;
}

export const cadBestFitLocalFrame = (
  centroid: CadBestFitPoint,
  span: number,
): CadBestFitLocalFrame => {
  const inverseSpan = span > 0 ? 1 / span : 0;
  return {
    centroid,
    span,
    toWorld: (localX, localY) => ({
      x: centroid.x + localX * span,
      y: centroid.y + localY * span,
    }),
    toLocal: (point) => ({
      x: (point.x - centroid.x) * inverseSpan,
      y: (point.y - centroid.y) * inverseSpan,
    }),
  };
};

export interface CadBestFitEigen2 {
  majorValue: number;
  minorValue: number;
  majorX: number;
  majorY: number;
  minorX: number;
  minorY: number;
}

/**
 * Closed-form eigendecomposition of a symmetric 2x2 matrix [[m00, m01],
 * [m01, m11]]. Eigenvectors are unit length and deterministic.
 */
export const cadBestFitSymmetricEigen2 = (
  m00: number,
  m01: number,
  m11: number,
): CadBestFitEigen2 | null => {
  if (![m00, m01, m11].every((value) => Number.isFinite(value))) return null;
  const half = (m00 + m11) / 2;
  const radius = Math.hypot((m00 - m11) / 2, m01);
  const angle = 0.5 * Math.atan2(2 * m01, m00 - m11);
  const cos = Math.cos(angle);
  const sin = Math.sin(angle);
  return {
    majorValue: half + radius,
    minorValue: half - radius,
    majorX: cos,
    majorY: sin,
    minorX: -sin,
    minorY: cos,
  };
};

export const cadBestFitMeanSquared = (values: readonly number[]): number => {
  if (values.length === 0) return 0;
  let sum = 0;
  for (const value of values) sum += value * value;
  return sum / values.length;
};

export const cadBestFitMaxAbs = (values: readonly number[]): number => {
  let maxAbs = 0;
  for (const value of values) {
    const abs = Math.abs(value);
    if (abs > maxAbs) maxAbs = abs;
  }
  return maxAbs;
};

export const cadBestFitNormalizeAngleDeg = (angleDeg: number): number => {
  const normalized = angleDeg % 360;
  return normalized < 0 ? normalized + 360 : normalized;
};

/**
 * Clamp helper used by span/parameter laws. `NaN` fails closed to `null`.
 */
export const cadBestFitClampFinite = (
  value: number,
  min: number,
  max: number,
): number | null => {
  if (!Number.isFinite(value) || !Number.isFinite(min) || !Number.isFinite(max)) {
    return null;
  }
  if (value < min) return min;
  if (value > max) return max;
  return value;
};

/**
 * Dense square solve by Gaussian elimination with partial pivoting. Returns
 * null for singular/non-finite systems so callers can fail closed.
 */
export const cadBestFitSolveLinearSystem = (
  matrix: readonly number[][],
  rhs: readonly number[],
): number[] | null => {
  const size = rhs.length;
  const augmented = matrix.map((row, index) => [...row, rhs[index]]);
  for (let column = 0; column < size; column += 1) {
    let pivot = column;
    for (let row = column + 1; row < size; row += 1) {
      if (Math.abs(augmented[row][column]) > Math.abs(augmented[pivot][column])) pivot = row;
    }
    if (Math.abs(augmented[pivot][column]) <= CAD_BEST_FIT_FLOOR) return null;
    [augmented[column], augmented[pivot]] = [augmented[pivot], augmented[column]];
    for (let row = column + 1; row < size; row += 1) {
      const factor = augmented[row][column] / augmented[column][column];
      for (let index = column; index <= size; index += 1) {
        augmented[row][index] -= factor * augmented[column][index];
      }
    }
  }
  const solution = new Array<number>(size).fill(0);
  for (let row = size - 1; row >= 0; row -= 1) {
    let sum = augmented[row][size];
    for (let index = row + 1; index < size; index += 1) {
      sum -= augmented[row][index] * solution[index];
    }
    solution[row] = sum / augmented[row][row];
  }
  return solution.every((value) => Number.isFinite(value)) ? solution : null;
};
