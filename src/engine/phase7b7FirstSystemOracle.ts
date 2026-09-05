/**
 * Phase 7B.7 first-system dense N/U oracle (test-only, no routing).
 *
 * Rebuilds the EXACT first correction system the sparse backend saw
 * (packed design/weights unpacked to sparse rows + dense P, assembled
 * with the production `accumulateNormalEquationsFromSparseRows` +
 * `solveNormalEquations` helpers) and estimates the raw-N condition
 * from the packed inputs. Single implementation reused by the Phase 7B.6
 * capture driver and the Phase 7B.7 safety benchmark.
 */
import { performance } from 'node:perf_hooks';

import { solveNormalEquations } from './adjustNormalEquationHelpers';
import { accumulateNormalEquationsFromSparseRows } from './matrixSparse';
import type { SparseMatrixRows } from './matrixTypes';
import { estimateSparseNormalCondition } from './sparseNormalCondition';
import type {
  PackedSparseDesignRows,
  PackedUpperTriangle,
} from './sparseEquationPacking';

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
 * Solves the captured first system through the production dense path
 * (same assembly + scaled/damped Cholesky as the TS reference iteration).
 * Throws fail-closed on shape mismatch, mirroring production.
 */
export const solvePhase7b7DenseFirstSystem = (
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
      `Dense first-system rebuild produced ${correction.length} params for ${captured.parameterCount}.`,
    );
  }
  return correction;
};

export interface Phase7b7OracleMeasurement {
  denseCorrection: number[] | null;
  conditionEstimate: number | undefined;
  conditionSource: 'native-sparse' | 'ts-packed' | undefined;
  /** Wall time for the dense rebuild alone. */
  rebuildMs: number;
  /** Wall time for the TS-packed condition estimate alone (0 when native). */
  conditionMs: number;
}

/**
 * Times the oracle: dense rebuild always runs; the TS-packed condition
 * estimate runs only when no finite native estimate is supplied.
 */
export const measurePhase7b7FirstSystemOracle = (
  captured: Phase7b7CapturedSystem,
  nativeEstimate: number | undefined,
): Phase7b7OracleMeasurement => {
  const rebuildStart = performance.now();
  let denseCorrection: number[] | null = null;
  try {
    denseCorrection = solvePhase7b7DenseFirstSystem(captured);
  } catch {
    denseCorrection = null;
  }
  const rebuildMs = performance.now() - rebuildStart;
  if (typeof nativeEstimate === 'number' && Number.isFinite(nativeEstimate)) {
    return {
      denseCorrection,
      conditionEstimate: nativeEstimate,
      conditionSource: 'native-sparse',
      rebuildMs,
      conditionMs: 0,
    };
  }
  const conditionStart = performance.now();
  let conditionEstimate: number | undefined;
  try {
    const packed = estimateSparseNormalCondition(
      captured.design,
      captured.weights,
      captured.parameterCount,
    );
    if (Number.isFinite(packed)) conditionEstimate = packed;
  } catch {
    conditionEstimate = undefined;
  }
  return {
    denseCorrection,
    conditionEstimate,
    conditionSource: conditionEstimate === undefined ? undefined : 'ts-packed',
    rebuildMs,
    conditionMs: performance.now() - conditionStart,
  };
};
