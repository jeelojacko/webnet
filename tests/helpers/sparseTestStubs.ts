/**
 * Phase 7B test-only dense-backed sparse stubs with invocation counting.
 *
 * Shared by the runtime-seam unit tests and the actual-worker bridge so
 * both prove the same sparse correction / row-product / selected-covariance
 * execution through injected worker-local runtime.
 */
import {
  accumulateNormalEquationsFromSparseRows,
  denseRowsToSparseRows,
  zeros,
} from '../../src/engine/matrix';
import { invertNormalMatrixForStats, solveNormalEquations } from '../../src/engine/adjustNormalEquationHelpers';
import type {
  SparseCorrectionSolveInput,
  SparseCorrectionSolver,
  SparseRowProductsInput,
  SparseRowProductsSolver,
  SparseRowProductsResult,
  SparseSelectedCovarianceInput,
  SparseSelectedCovarianceResult,
  SparseSelectedCovarianceSolver,
} from '../../src/engine/numericalBackend';

const rebuildDense = (
  rowOffsets: Int32Array,
  columns: Int32Array,
  values: Float64Array,
  weightRows: Int32Array,
  weightColumns: Int32Array,
  weightValues: Float64Array,
  equationCount: number,
  parameterCount: number,
): { design: number[][]; weights: number[][] } => {
  const design = Array.from({ length: equationCount }, () => new Array<number>(parameterCount).fill(0));
  for (let row = 0; row < equationCount; row += 1) {
    for (let k = rowOffsets[row] ?? 0; k < (rowOffsets[row + 1] ?? 0); k += 1) {
      design[row][columns[k] ?? 0] = values[k] ?? 0;
    }
  }
  const weights = Array.from({ length: equationCount }, () => new Array<number>(equationCount).fill(0));
  for (let k = 0; k < weightValues.length; k += 1) {
    const row = weightRows[k] ?? 0;
    const column = weightColumns[k] ?? 0;
    weights[row][column] = weightValues[k] ?? 0;
    weights[column][row] = weightValues[k] ?? 0;
  }
  return { design, weights };
};

const invertPackedSystem = (
  design: number[][],
  weights: number[][],
  equationCount: number,
  parameterCount: number,
): number[][] => {
  const { normal } = accumulateNormalEquationsFromSparseRows(
    denseRowsToSparseRows(design),
    zeros(equationCount, 1),
    weights,
    parameterCount,
  );
  return invertNormalMatrixForStats(normal, () => undefined);
};

export type CountingCorrectionSolver = SparseCorrectionSolver & {
  inputs: SparseCorrectionSolveInput[];
};

export const countingCorrectionSolver = (): CountingCorrectionSolver => {
  const inputs: SparseCorrectionSolveInput[] = [];
  return {
    inputs,
    solveFromEquations(input: SparseCorrectionSolveInput) {
      inputs.push(input);
      const { design, weights } = rebuildDense(
        input.design.rowOffsets,
        input.design.columns,
        input.design.values,
        input.weights.rows,
        input.weights.columns,
        input.weights.values,
        input.observationEquationCount,
        input.parameterCount,
      );
      const misclosures = Array.from(input.misclosures, (value) => [value]);
      const { normal, rhs } = accumulateNormalEquationsFromSparseRows(
        denseRowsToSparseRows(design),
        misclosures,
        weights,
        input.parameterCount,
      );
      const { correction } = solveNormalEquations(normal, rhs, { log: () => undefined });
      return {
        correction,
        damping: 0,
        dampingAttempts: 0,
        designNnz: input.design.values.length,
        weightNnz: input.weights.values.length,
        normalNnz: 0,
        factorNnz: 0,
        ordering: 'test',
        solver: 'dense-backed-stub',
      };
    },
  };
};

export type CountingRowProductsSolver = SparseRowProductsSolver & {
  inputs: SparseRowProductsInput[];
};

export const countingRowProductsSolver = (): CountingRowProductsSolver => {
  const inputs: SparseRowProductsInput[] = [];
  return {
    inputs,
    queryRowProducts(input: SparseRowProductsInput): SparseRowProductsResult {
      inputs.push(input);
      const { design, weights } = rebuildDense(
        input.design.rowOffsets,
        input.design.columns,
        input.design.values,
        input.weights.rows,
        input.weights.columns,
        input.weights.values,
        input.observationEquationCount,
        input.parameterCount,
      );
      const inverse = invertPackedSystem(
        design,
        weights,
        input.observationEquationCount,
        input.parameterCount,
      );
      const at = (row: number): number[] => {
        const out = new Array<number>(input.parameterCount).fill(0);
        for (let k = input.queryRowOffsets[row] ?? 0; k < (input.queryRowOffsets[row + 1] ?? 0); k += 1) {
          out[input.queryColumns[k] ?? 0] = input.queryValues[k] ?? 0;
        }
        return out;
      };
      const form = (left: number[], right: number[]): number => {
        let sum = 0;
        for (let i = 0; i < input.parameterCount; i += 1) {
          for (let j = 0; j < input.parameterCount; j += 1) {
            sum += left[i]! * (inverse[i]?.[j] ?? 0) * right[j]!;
          }
        }
        return sum;
      };
      const queryRowCount = input.queryRowOffsets.length - 1;
      const quadratic = new Float64Array(queryRowCount);
      for (let row = 0; row < queryRowCount; row += 1) quadratic[row] = form(at(row), at(row));
      const cross = new Float64Array(input.crossA.length);
      for (let c = 0; c < input.crossA.length; c += 1) {
        cross[c] = form(at(input.crossA[c] ?? 0), at(input.crossB[c] ?? 0));
      }
      return { quadratic, cross, normalNnz: 0, factorNnz: 0, damping: 0, dampingAttempts: 0 };
    },
  };
};

export type CountingCovarianceSolver = SparseSelectedCovarianceSolver & {
  inputs: SparseSelectedCovarianceInput[];
};

export const countingCovarianceSolver = (): CountingCovarianceSolver => {
  const inputs: SparseSelectedCovarianceInput[] = [];
  return {
    inputs,
    querySelected(input: SparseSelectedCovarianceInput): SparseSelectedCovarianceResult {
      inputs.push(input);
      const { design, weights } = rebuildDense(
        input.design.rowOffsets,
        input.design.columns,
        input.design.values,
        input.weights.rows,
        input.weights.columns,
        input.weights.values,
        input.observationEquationCount,
        input.parameterCount,
      );
      const inverse = invertPackedSystem(
        design,
        weights,
        input.observationEquationCount,
        input.parameterCount,
      );
      const covariance = Float64Array.from(
        input.queryRows.map((row, index) => inverse[row]?.[input.queryColumns[index] ?? -1] ?? 0),
      );
      return { covariance, normalNnz: 0, factorNnz: 0, damping: 0, dampingAttempts: 0 };
    },
  };
};
