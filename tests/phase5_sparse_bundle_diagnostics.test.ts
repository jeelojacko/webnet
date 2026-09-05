import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

import { LSAEngine } from '../src/engine/adjust';
import { invertNormalMatrixForStats } from '../src/engine/adjustNormalEquationHelpers';
import { solveNormalEquations } from '../src/engine/adjustNormalEquationHelpers';
import {
  accumulateNormalEquationsFromSparseRows,
  denseRowsToSparseRows,
  zeros,
} from '../src/engine/matrix';
import type {
  SparseCorrectionSolveInput,
  SparseCorrectionSolver,
  SparseRowProductsInput,
  SparseRowProductsResult,
  SparseRowProductsSolver,
  SparseSelectedCovarianceInput,
  SparseSelectedCovarianceResult,
  SparseSelectedCovarianceSolver,
} from '../src/engine/numericalBackend';
import {
  buildExperimentalSparseEngineOptions,
  createExperimentalSparseNumericalBundle,
} from '../src/engine/wasm/experimentalSparseNumericalBundle';
import type { WebNetWasmModule } from '../src/engine/wasm/wasmTypes';
import { createExperimentalSparseRouteDiagnostics } from '../src/engine/experimentalSparseDiagnostics';

const loadTutorialInput = (): string =>
  fs.readFileSync(path.join(process.cwd(), 'public/examples/mixed_grid_tutorial.dat'), 'utf-8');

type DenseEquations = { design: number[][]; weights: number[][] };

const rebuildDense = (
  rowOffsets: Int32Array,
  columns: Int32Array,
  values: Float64Array,
  weightRows: Int32Array,
  weightColumns: Int32Array,
  weightValues: Float64Array,
  equationCount: number,
  parameterCount: number,
): DenseEquations => {
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
  design: DenseEquations['design'],
  weights: DenseEquations['weights'],
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

/** Dense-backed correction stub that records every invocation. */
const countingCorrectionSolver = (): SparseCorrectionSolver & {
  inputs: SparseCorrectionSolveInput[];
} => {
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

/** Dense-backed row-products stub that records every invocation. */
const countingRowProductsSolver = (): SparseRowProductsSolver & {
  inputs: SparseRowProductsInput[];
} => {
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
      const queryRowCount = input.queryRowOffsets.length - 1;
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
            sum += left[i] * (inverse[i]?.[j] ?? 0) * right[j];
          }
        }
        return sum;
      };
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

/** Dense-backed selected-covariance stub that records every invocation. */
const countingCovarianceSolver = (): SparseSelectedCovarianceSolver & {
  inputs: SparseSelectedCovarianceInput[];
} => {
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

const failing = (message: string) => ({
  solveFromEquations: () => {
    throw new Error(message);
  },
  queryRowProducts: () => {
    throw new Error(message);
  },
  querySelected: () => {
    throw new Error(message);
  },
});

describe('phase 5 experimental sparse bundle and route diagnostics', () => {
  it('loads one shared module for all three solvers', async () => {
    let factoryCalls = 0;
    const factory = () => {
      factoryCalls += 1;
      return {} as WebNetWasmModule;
    };
    const bundle = await createExperimentalSparseNumericalBundle(factory);
    expect(factoryCalls).toBe(1);
    expect(bundle.sparseCorrectionSolver).toBeDefined();
    expect(bundle.sparseRowProductsSolver).toBeDefined();
    expect(bundle.sparseSelectedCovarianceSolver).toBeDefined();
    const moduleOf = (solver: object): unknown => (solver as { _module: unknown })._module;
    expect(moduleOf(bundle.sparseCorrectionSolver)).toBe(bundle.module);
    expect(moduleOf(bundle.sparseRowProductsSolver)).toBe(bundle.module);
    expect(moduleOf(bundle.sparseSelectedCovarianceSolver)).toBe(bundle.module);
  });

  it('builds full engine injection options preserving solver instances', async () => {
    const bundle = await createExperimentalSparseNumericalBundle(() => ({} as WebNetWasmModule));
    const diagnostics = createExperimentalSparseRouteDiagnostics();
    const options = buildExperimentalSparseEngineOptions(bundle, diagnostics);
    expect(options.sparseCorrectionSolver).toBe(bundle.sparseCorrectionSolver);
    expect(options.sparseRowProductsSolver).toBe(bundle.sparseRowProductsSolver);
    expect(options.sparseSelectedCovarianceSolver).toBe(bundle.sparseSelectedCovarianceSolver);
    expect(options.experimentalSparseDiagnostics).toBe(diagnostics);
    const engine = new LSAEngine({ input: loadTutorialInput(), ...options }) as unknown as Record<
      string,
      unknown
    >;
    expect(engine['sparseCorrectionSolver']).toBe(bundle.sparseCorrectionSolver);
    expect(engine['sparseRowProductsSolver']).toBe(bundle.sparseRowProductsSolver);
    expect(engine['sparseSelectedCovarianceSolver']).toBe(bundle.sparseSelectedCovarianceSolver);
    expect(engine['experimentalSparseDiagnostics']).toBe(diagnostics);
  });

  it('propagates all three solvers and diagnostics into nested solves', () => {
    const input = loadTutorialInput();
    const correction = countingCorrectionSolver();
    const rowProducts = countingRowProductsSolver();
    const covariance = countingCovarianceSolver();
    const diagnostics = createExperimentalSparseRouteDiagnostics();
    const seen: Record<string, unknown>[] = [];
    const originalSolve = LSAEngine.prototype.solve;
    // eslint-disable-next-line no-unused-vars
    LSAEngine.prototype.solve = function (this: LSAEngine) {
      const self = this as unknown as Record<string, unknown>;
      seen.push({
        sparseCorrectionSolver: self['sparseCorrectionSolver'],
        sparseRowProductsSolver: self['sparseRowProductsSolver'],
        sparseSelectedCovarianceSolver: self['sparseSelectedCovarianceSolver'],
        experimentalSparseDiagnostics: self['experimentalSparseDiagnostics'],
      });
      return originalSolve.apply(this);
    };
    try {
      const result = new LSAEngine({
        input,
        parseOptions: { runMode: 'blunder-detect' },
        sparseCorrectionSolver: correction,
        sparseRowProductsSolver: rowProducts,
        sparseSelectedCovarianceSolver: covariance,
        experimentalSparseDiagnostics: diagnostics,
      }).solve();
      expect(result.success).toBe(true);
    } finally {
      LSAEngine.prototype.solve = originalSolve;
    }
    expect(seen.length).toBeGreaterThanOrEqual(2);
    seen.forEach((entry) => {
      expect(entry['sparseCorrectionSolver']).toBe(correction);
      expect(entry['sparseRowProductsSolver']).toBe(rowProducts);
      expect(entry['sparseSelectedCovarianceSolver']).toBe(covariance);
      expect(entry['experimentalSparseDiagnostics']).toBe(diagnostics);
    });
    expect(correction.inputs.length).toBeGreaterThan(0);
    expect(rowProducts.inputs.length).toBeGreaterThan(0);
    expect(covariance.inputs.length).toBeGreaterThan(0);
    expect(diagnostics.sparseCorrectionCalls).toBe(correction.inputs.length);
    expect(diagnostics.rowProductsCalls).toBe(rowProducts.inputs.length);
    expect(diagnostics.selectedCovarianceCalls).toBe(covariance.inputs.length);
    expect(diagnostics.sparseCorrectionFallbacks).toBe(0);
    expect(diagnostics.rowProductsFallbacks).toBe(0);
    expect(diagnostics.selectedCovarianceFallbacks).toBe(0);
  });

  it('counts dense fallbacks with reasons while preserving the solve', () => {
    const input = loadTutorialInput();
    const baseline = new LSAEngine({ input }).solve();
    expect(baseline.success).toBe(true);
    const diagnostics = createExperimentalSparseRouteDiagnostics();
    const backend = failing('experimental backend offline');
    const result = new LSAEngine({
      input,
      sparseCorrectionSolver: backend as SparseCorrectionSolver,
      sparseRowProductsSolver: backend as unknown as SparseRowProductsSolver,
      sparseSelectedCovarianceSolver: backend as unknown as SparseSelectedCovarianceSolver,
      experimentalSparseDiagnostics: diagnostics,
    }).solve();
    expect(result.success).toBe(true);
    expect(diagnostics.sparseCorrectionCalls).toBeGreaterThan(0);
    expect(diagnostics.sparseCorrectionFallbacks).toBeGreaterThan(0);
    expect(diagnostics.sparseCorrectionFallbackReasons.length).toBe(
      diagnostics.sparseCorrectionFallbacks,
    );
    expect(diagnostics.rowProductsCalls).toBeGreaterThan(0);
    expect(diagnostics.rowProductsFallbacks).toBeGreaterThan(0);
    expect(diagnostics.rowProductsFallbackReasons.length).toBe(diagnostics.rowProductsFallbacks);
    expect(diagnostics.selectedCovarianceCalls).toBeGreaterThan(0);
    expect(diagnostics.selectedCovarianceFallbacks).toBeGreaterThan(0);
    expect(diagnostics.selectedCovarianceFallbackReasons.length).toBe(
      diagnostics.selectedCovarianceFallbacks,
    );
    [...diagnostics.sparseCorrectionFallbackReasons,
      ...diagnostics.rowProductsFallbackReasons,
      ...diagnostics.selectedCovarianceFallbackReasons,
    ].forEach((reason) => {
      expect(typeof reason).toBe('string');
      expect(reason.length).toBeGreaterThan(0);
    });
  });
});
