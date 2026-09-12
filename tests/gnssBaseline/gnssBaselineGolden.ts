/**
 * Phase 12B test-only independent golden solver.
 *
 * Implements the linear baseline model x_hat = (A'PA)^-1 A'Pl with its OWN
 * dense matrix code (Gaussian elimination with partial pivoting). Imports
 * NOTHING from src/engine numerics: agreement with the production path is
 * genuine cross-implementation parity, not self-comparison.
 *
 * Canonical ordering (mirrors the documented contract, not production
 * internals): unknowns sorted by station id, components x/y/h; equation
 * rows grouped 3-per-baseline in baseline id order.
 */
import type { StationMap } from '../../src/types';
import type { GnssBaselineObservation } from '../../src/engine/gnssBaselineTypes';

export interface GoldenResult {
  unknowns: string[];
  coordinates: Record<string, { x: number; y: number; z: number }>;
  residuals: { baselineId: number; vX: number; vY: number; vZ: number }[];
  weightedResidualSum: number;
  varianceFactor: number;
  qxx: number[][];
  dof: number;
}

type Matrix = number[][];

const zeros = (rows: number, columns: number): Matrix =>
  Array.from({ length: rows }, () => new Array<number>(columns).fill(0));

const transpose = (m: Matrix): Matrix =>
  m[0]!.map((_, column) => m.map((row) => row[column]!));

const multiply = (a: Matrix, b: Matrix): Matrix => {
  const result = zeros(a.length, b[0]!.length);
  for (let i = 0; i < a.length; i += 1) {
    for (let k = 0; k < b.length; k += 1) {
      const aik = a[i]![k]!;
      if (aik === 0) continue;
      for (let j = 0; j < b[0]!.length; j += 1) {
        result[i]![j]! += aik * b[k]![j]!;
      }
    }
  }
  return result;
};

/** Gauss-Jordan inverse with partial pivoting (independent of engine LDLT). */
const invert = (m: Matrix): Matrix => {
  const n = m.length;
  const augmented = m.map((row, i) => [
    ...row,
    ...Array.from({ length: n }, (_, j) => (i === j ? 1 : 0)),
  ]);
  for (let column = 0; column < n; column += 1) {
    let pivot = column;
    for (let row = column + 1; row < n; row += 1) {
      if (Math.abs(augmented[row]![column]!) > Math.abs(augmented[pivot]![column]!)) {
        pivot = row;
      }
    }
    if (Math.abs(augmented[pivot]![column]!) < 1e-300) {
      throw new Error('Golden solver: singular normal matrix.');
    }
    [augmented[column], augmented[pivot]] = [augmented[pivot]!, augmented[column]!];
    const scale = augmented[column]![column]!;
    for (let j = 0; j < 2 * n; j += 1) augmented[column]![j]! /= scale;
    for (let row = 0; row < n; row += 1) {
      if (row === column) continue;
      const factor = augmented[row]![column]!;
      if (factor === 0) continue;
      for (let j = 0; j < 2 * n; j += 1) {
        augmented[row]![j]! -= factor * augmented[column]![j]!;
      }
    }
  }
  return augmented.map((row) => row.slice(n));
};

const invertSymmetric3x3 = (c: {
  xx: number; xy: number; xz: number; yy: number; yz: number; zz: number;
}): Matrix => {
  const m = [
    [c.xx, c.xy, c.xz],
    [c.xy, c.yy, c.yz],
    [c.xz, c.yz, c.zz],
  ];
  return invert(m);
};

export const runGoldenBaselineAdjustment = (
  stations: StationMap,
  baselines: GnssBaselineObservation[],
): GoldenResult => {
  const ordered = [...baselines].sort((a, b) => a.id - b.id);
  const touched = new Set<string>();
  ordered.forEach((b) => {
    touched.add(b.from);
    touched.add(b.to);
  });
  const unknowns = [...touched]
    .filter((id) => {
      const s = stations[id];
      return !!s && !(s.fixedX && s.fixedY && s.fixedH);
    })
    .sort();
  const columnOf = new Map<string, number>();
  unknowns.forEach((id, index) => columnOf.set(id, 3 * index));
  const numParams = 3 * unknowns.length;
  const numEquations = 3 * ordered.length;
  const design = zeros(numEquations, numParams);
  const misclosure = zeros(numEquations, 1);
  const weight = zeros(numEquations, numEquations);
  ordered.forEach((baseline, baselineIndex) => {
    const from = stations[baseline.from]!;
    const to = stations[baseline.to]!;
    const calc = [to.x - from.x, to.y - from.y, to.h - from.h];
    const obs = [baseline.vector.x, baseline.vector.y, baseline.vector.z];
    const inverse = invertSymmetric3x3(baseline.covariance);
    for (let component = 0; component < 3; component += 1) {
      const row = 3 * baselineIndex + component;
      misclosure[row]![0] = obs[component]! - calc[component]!;
      const fromColumn = columnOf.get(baseline.from);
      const toColumn = columnOf.get(baseline.to);
      if (fromColumn != null) design[row]![fromColumn + component]! = -1;
      if (toColumn != null) design[row]![toColumn + component]! = 1;
      for (let other = 0; other < 3; other += 1) {
        weight[row]![3 * baselineIndex + other]! = inverse[component]![other]!;
      }
    }
  });
  const normal = multiply(multiply(transpose(design), weight), design);
  const rhs = multiply(multiply(transpose(design), weight), misclosure);
  const qxx = invert(normal);
  const correction = multiply(qxx, rhs);
  // Residuals at the solved state: recompute misclosure with corrected stations.
  const solved: Record<string, { x: number; y: number; z: number }> = {};
  Object.entries(stations).forEach(([id, station]) => {
    const column = columnOf.get(id);
    solved[id] = {
      x: station.x + (column != null ? correction[column]![0]! : 0),
      y: station.y + (column != null ? correction[column + 1]![0]! : 0),
      z: station.h + (column != null ? correction[column + 2]![0]! : 0),
    };
  });
  const residuals = ordered.map((baseline) => {
    const from = solved[baseline.from]!;
    const to = solved[baseline.to]!;
    return {
      baselineId: baseline.id,
      vX: baseline.vector.x - (to.x - from.x),
      vY: baseline.vector.y - (to.y - from.y),
      vZ: baseline.vector.z - (to.z - from.z),
    };
  });
  const residualVector = residuals.flatMap((r) => [[r.vX], [r.vY], [r.vZ]]);
  const weighted = multiply(multiply(transpose(residualVector), weight), residualVector);
  const weightedResidualSum = weighted[0]![0]!;
  const dof = numEquations - numParams;
  return {
    unknowns,
    coordinates: solved,
    residuals,
    weightedResidualSum,
    varianceFactor: dof > 0 ? weightedResidualSum / dof : 0,
    qxx,
    dof,
  };
};
