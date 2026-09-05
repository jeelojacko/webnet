/**
 * Browser-safe dense rebuild of a captured sparse correction system.
 *
 * Pure subset of the Phase 7B.7 first-system oracle: unpacks packed CSR
 * design rows plus packed upper-triangle weights and solves the system
 * through the production dense path (same assembly + scaled/damped
 * Cholesky as the TypeScript reference iteration), with the TS-packed
 * condition estimate as fallback when no finite native estimate is
 * supplied. No Node-only imports, so worker routing code can use it;
 * wall-clock timing stays in `phase7b7FirstSystemOracle`.
 */
import { solveNormalEquations } from './adjustNormalEquationHelpers';
import { accumulateNormalEquationsFromSparseRows } from './matrixSparse';
import type { SparseMatrixRows } from './matrixTypes';
import { estimateSparseNormalCondition } from './sparseNormalCondition';
import type {
  PackedSparseDesignRows,
  PackedUpperTriangle,
} from './sparseEquationPacking';
import type { Phase7b6ConditionSource } from './phase7b6CorrectionHandshake';

export interface Phase7b7CapturedSystem {
  design: PackedSparseDesignRows;
  weights: PackedUpperTriangle;
  misclosures: Float64Array;
  observationEquationCount: number;
  parameterCount: number;
}

/** Unpacks CSR design rows to the sparse-row shape used by dense assembly. */
export const unpackPhase7b7DesignRows = (
  design: PackedSparseDesignRows,
): SparseMatrixRows => {
  const rows: SparseMatrixRows = [];
  const equationCount = design.rowOffsets.length - 1;
  for (let row = 0; row < equationCount; row += 1) {
    const start = design.rowOffsets[row] ?? 0;
    const end = design.rowOffsets[row + 1] ?? 0;
    const entries: SparseMatrixRows[number] = [];
    for (let k = start; k < end; k += 1) {
      entries.push({
        index: design.columns[k] ?? 0,
        value: design.values[k] ?? 0,
      });
    }
    rows.push(entries);
  }
  return rows;
};

/** Rebuilds symmetric dense P from packed upper-triangle entries. */
export const unpackPhase7b7DenseWeights = (
  weights: PackedUpperTriangle,
  size: number,
): number[][] => {
  const dense: number[][] = Array.from({ length: size }, () => new Array<number>(size).fill(0));
  for (let k = 0; k < weights.values.length; k += 1) {
    const row = weights.rows[k] ?? 0;
    const column = weights.columns[k] ?? 0;
    const value = weights.values[k] ?? 0;
    (dense[row] as number[])[column] = value;
    (dense[column] as number[])[row] = value;
  }
  return dense;
};

/**
 * Solves the captured system through the production dense path (same
 * assembly + scaled/damped Cholesky as the TS reference iteration).
 * Throws fail-closed on shape mismatch, mirroring production.
 */
export const solvePhase7b7DenseSystem = (
  captured: Phase7b7CapturedSystem,
): number[] => {
  const rows = unpackPhase7b7DesignRows(captured.design);
  const dense = unpackPhase7b7DenseWeights(captured.weights, captured.observationEquationCount);
  const residuals = Array.from(captured.misclosures, (value) => [value]);
  const { normal, rhs } = accumulateNormalEquationsFromSparseRows(
    rows,
    residuals,
    dense,
    captured.parameterCount,
  );
  const solved = solveNormalEquations(normal, rhs, { log: () => undefined });
  const correction = (solved.correction ?? []).map((row) => row[0] ?? Number.NaN);
  if (correction.length !== captured.parameterCount) {
    throw new Error(
      `Dense system rebuild produced ${correction.length} params for ${captured.parameterCount}.`,
    );
  }
  return correction;
};

export interface Phase7b7DenseOracleEvidence {
  denseCorrection: number[] | null;
  conditionEstimate: number | undefined;
  conditionSource: Phase7b6ConditionSource | undefined;
}

/**
 * Gathers oracle evidence for one captured system: dense rebuild always
 * runs; the TS-packed condition estimate runs only when no finite native
 * estimate is supplied.
 */
export const measurePhase7b7DenseOracle = (
  captured: Phase7b7CapturedSystem,
  nativeEstimate: number | undefined,
): Phase7b7DenseOracleEvidence => {
  let denseCorrection: number[] | null = null;
  try {
    denseCorrection = solvePhase7b7DenseSystem(captured);
  } catch {
    denseCorrection = null;
  }
  if (typeof nativeEstimate === 'number' && Number.isFinite(nativeEstimate)) {
    return { denseCorrection, conditionEstimate: nativeEstimate, conditionSource: 'native-sparse' };
  }
  try {
    const packed = estimateSparseNormalCondition(
      captured.design,
      captured.weights,
      captured.parameterCount,
    );
    if (Number.isFinite(packed)) {
      return { denseCorrection, conditionEstimate: packed, conditionSource: 'ts-packed' };
    }
  } catch {
    // Fall through to unknown condition evidence.
  }
  return { denseCorrection, conditionEstimate: undefined, conditionSource: undefined };
};
