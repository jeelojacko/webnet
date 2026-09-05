import type { EquationRowInfo } from './adjustmentSolveTypes';
import type { SparseMatrixRows } from './matrixTypes';
import type {
  SparseRowProductsSolver,
} from './numericalBackend';
import type { Observation } from '../types';
import { packSparseDesignRows, packUpperTriangleWeights } from './sparseEquationPacking';

export interface StandardizedResidualRowProducts {
  /** Per-equation quadratic forms r_k^T Qxx r_k; length is the equation count. */
  quadratic: ArrayLike<number>;
  /** Cross product r_a^T Qxx r_b for a requested pair, or undefined if absent. */
  crossFor: (_rowA: number, _rowB: number) => number | undefined;
}

export interface StandardizedResidualRowProductRequest {
  sparseRows: SparseMatrixRows;
  weights: number[][];
  rowInfo: EquationRowInfo[];
  activeObservations: Observation[];
  observationEquationCount: number;
  parameterCount: number;
}

export interface RowProductLogContext {
  sparseRowProductsSolver?: SparseRowProductsSolver;
  log: (_message: string) => void;
}

const crossKey = (rowA: number, rowB: number): string => `${rowA},${rowB}`;

/**
 * Collects multi-row GPS groups in active-observation order.
 * Every GPS observation needs cross products: larger groups feed the
 * Qvv display transform, and two-component E/N pairs feed the per-component
 * residual standard errors via the 2x2 Qvv block.
 */
const collectGpsCrossGroups = (
  rowInfo: EquationRowInfo[],
  activeObservations: Observation[],
): number[][] => {
  const rowsByObs = new Map<number, number[]>();
  rowInfo.forEach((info, row) => {
    if (!info) return;
    const rows = rowsByObs.get(info.obs.id) ?? [];
    rows.push(row);
    rowsByObs.set(info.obs.id, rows);
  });
  const groups: number[][] = [];
  activeObservations.forEach((obs) => {
    if (obs.type !== 'gps') return;
    const rows = rowsByObs.get(obs.id) ?? [];
    if (rows.length > 1) groups.push(rows);
  });
  return groups;
};

/**
 * Packs assembled sparse equations and queries quadratic/cross products
 * with the normal-equation inverse. The packed design doubles as the
 * query CSR since standardized residuals need one quadratic per equation.
 * Throws on packing or solver failure; callers decide on dense fallback.
 */
export const queryStandardizedResidualRowProducts = (
  solver: SparseRowProductsSolver,
  request: StandardizedResidualRowProductRequest,
): StandardizedResidualRowProducts => {
  const design = packSparseDesignRows(request.sparseRows);
  const weights = packUpperTriangleWeights(request.weights, request.observationEquationCount);
  const groups = collectGpsCrossGroups(request.rowInfo, request.activeObservations);
  const crossA: number[] = [];
  const crossB: number[] = [];
  groups.forEach((rows) => {
    rows.forEach((rowA) => {
      rows.forEach((rowB) => {
        crossA.push(rowA);
        crossB.push(rowB);
      });
    });
  });
  const result = solver.queryRowProducts({
    design,
    weights,
    observationEquationCount: request.observationEquationCount,
    parameterCount: request.parameterCount,
    queryRowOffsets: design.rowOffsets,
    queryColumns: design.columns,
    queryValues: design.values,
    crossA: Int32Array.from(crossA),
    crossB: Int32Array.from(crossB),
  });
  if (result.damping > 0) {
    throw new Error(
      `Sparse row products used diagonal damping (lambda=${result.damping.toExponential(3)}, attempts=${result.dampingAttempts}); falling back to dense standardized residuals to avoid damped covariance.`,
    );
  }
  if (result.quadratic.length !== request.observationEquationCount) {
    throw new Error('Sparse row products returned an unexpected quadratic count.');
  }
  if (result.cross.length !== crossA.length) {
    throw new Error('Sparse row products returned an unexpected cross count.');
  }
  const crossByPair = new Map<string, number>();
  crossA.forEach((rowA, index) => {
    crossByPair.set(crossKey(rowA, crossB[index] ?? -1), result.cross[index] ?? 0);
  });
  return {
    quadratic: result.quadratic,
    crossFor: (rowA, rowB) => crossByPair.get(crossKey(rowA, rowB)),
  };
};

/**
 * Experimental routing: uses the injected row-product solver when present,
 * otherwise returns null so callers keep the dense computation. Solver
 * failures fall back to dense with a warning, preserving default behavior.
 */
export const tryQueryStandardizedResidualRowProducts = (
  ctx: RowProductLogContext,
  request: StandardizedResidualRowProductRequest,
): StandardizedResidualRowProducts | null => {
  const solver = ctx.sparseRowProductsSolver;
  if (!solver) return null;
  try {
    return queryStandardizedResidualRowProducts(solver, request);
  } catch (error) {
    const detail = error instanceof Error ? ` ${error.message}` : '';
    ctx.log(`Warning: sparse row-product standardized residuals unavailable; using dense fallback.${detail}`);
    return null;
  }
};
