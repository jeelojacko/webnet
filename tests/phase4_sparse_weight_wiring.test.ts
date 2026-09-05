import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

import { LSAEngine } from '../src/engine/adjust';
import { solveAdjustmentIteration } from '../src/engine/adjustmentIteration';
import {
  applyRobustWeightFactors,
  applyRobustWeightFactorsToStructured,
  captureRobustWeightBase,
  captureRobustWeightBaseFromStructured,
  computeRobustWeightSummary,
  maxRobustWeightDelta,
} from '../src/engine/adjustRobustWeights';
import { accumulateNormalEquationsFromSparseRows } from '../src/engine/matrix';
import type { SparseMatrixRows } from '../src/engine/matrix';
import { solveNormalEquations } from '../src/engine/adjustNormalEquationHelpers';
import type {
  SparseCorrectionSolveInput,
  SparseCorrectionSolver,
} from '../src/engine/numericalBackend';
import {
  queryStandardizedResidualRowProducts,
} from '../src/engine/adjustStatisticsRowProducts';
import { packUpperTriangleWeights } from '../src/engine/sparseEquationPacking';
import { structuredWeightsToPackedUpper } from '../src/engine/sparseWeightRepresentation';
import type { StructuredSymmetricWeights } from '../src/engine/sparseWeightRepresentation';
import { structuredWeightsFromDense } from '../src/engine/sparseWeightRepresentation';
import { structuredQuadraticForm } from '../src/engine/sparseWeightRepresentation';
import { symmetricQuadraticForm } from '../src/engine/matrix';
import type { EquationRowInfo } from '../src/engine/adjustmentSolveTypes';
import type { Observation } from '../src/types';

/** Dense-backed reference sparse solver: rebuilds dense equations from packed input. */
const denseBackedSparseSolver = (): SparseCorrectionSolver & { inputs: SparseCorrectionSolveInput[] } => {
  const inputs: SparseCorrectionSolveInput[] = [];
  return {
    inputs,
    solveFromEquations(input: SparseCorrectionSolveInput) {
      inputs.push(input);
      const equationCount = input.observationEquationCount;
      const rows: SparseMatrixRows = [];
      for (let row = 0; row < equationCount; row += 1) {
        const entries: { index: number; value: number }[] = [];
        for (let k = input.design.rowOffsets[row] ?? 0; k < (input.design.rowOffsets[row + 1] ?? 0); k += 1) {
          entries.push({ index: input.design.columns[k] ?? 0, value: input.design.values[k] ?? 0 });
        }
        rows.push(entries);
      }
      const weights: number[][] = Array.from({ length: equationCount }, () => new Array<number>(equationCount).fill(0));
      for (let k = 0; k < input.weights.values.length; k += 1) {
        const row = input.weights.rows[k] ?? 0;
        const column = input.weights.columns[k] ?? 0;
        const value = input.weights.values[k] ?? 0;
        weights[row][column] = value;
        weights[column][row] = value;
      }
      const misclosures = Array.from(input.misclosures, (value) => [value]);
      const { normal, rhs } = accumulateNormalEquationsFromSparseRows(
        rows,
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
        ordering: 'reference',
        solver: 'dense-backed-reference',
      };
    },
  };
};

const loadTutorialInput = (): string =>
  fs.readFileSync(path.join(process.cwd(), 'public/examples/mixed_grid_tutorial.dat'), 'utf-8');

const summarizeRun = (engine: LSAEngine): unknown => {
  const result = engine.solve();
  expect(result.success).toBe(true);
  return {
    stations: result.stations,
    observations: result.observations.map((obs: Observation) => ({
      id: obs.id,
      stdRes: obs.stdRes,
      redundancy: obs.redundancy,
      residual: obs.residual,
    })),
  };
};

describe('phase 4 sparse weight wiring', () => {
  it('solves an iteration from structured weights without a dense P matrix', () => {
    const denseP = [[4, 0.5], [0.5, 2]];
    const structured = structuredWeightsFromDense(denseP, 2);
    const sparseRows: SparseMatrixRows = [
      [{ index: 0, value: 1 }],
      [{ index: 0, value: 2 }],
    ];
    const solver = denseBackedSparseSolver();
    const baseDeps = {
      robustMode: 'none' as const,
      sparseCorrectionSolver: solver as SparseCorrectionSolver,
      solveNormalEquations: () => { throw new Error('dense solver must not run on the sparse path'); },
      estimateCondition: () => 0,
      recordConditionEstimate: () => undefined,
      captureRobustWeightBase: () => ({ diagonal: [], correlatedPairs: [] }),
      applyRobustWeightFactors: () => undefined,
      computeRobustWeightSummary: () => ({
        factors: [],
        downweightedRows: 0,
        minWeight: 1,
        maxNorm: 0,
        meanWeight: 1,
        topRows: [],
      }),
      maxRobustWeightDelta: () => 0,
      recordRobustDiagnostics: () => undefined,
      weightedQuadratic: () => { throw new Error('dense quadratic must not run on the sparse path'); },
    };
    const sparseResult = solveAdjustmentIteration(
      baseDeps,
      [[1], [2]],
      [[3], [5]],
      undefined,
      [null, null],
      1,
      { sparseRows, numParams: 1, structuredWeights: structured },
    );
    const denseResult = solveAdjustmentIteration(
      { ...baseDeps, sparseCorrectionSolver: undefined,
        solveNormalEquations: (N, U) => solveNormalEquations(N, U, { log: () => undefined }),
        weightedQuadratic: (P, v) => symmetricQuadraticForm(P, v) },
      [[1], [2]],
      [[3], [5]],
      denseP,
      [null, null],
      1,
      { sparseRows, numParams: 1 },
    );
    expect(solver.inputs.length).toBeGreaterThan(0);
    const packed = solver.inputs[0]?.weights;
    const expected = packUpperTriangleWeights(denseP, 2);
    expect([...(packed?.rows ?? [])]).toEqual([...expected.rows]);
    expect([...(packed?.columns ?? [])]).toEqual([...expected.columns]);
    expect([...(packed?.values ?? [])]).toEqual([...expected.values]);
    expect(sparseResult.correction[0]?.[0]).toBeCloseTo(denseResult.correction[0]?.[0] ?? 0, 12);
    expect(sparseResult.sumBefore).toBeCloseTo(denseResult.sumBefore, 9);
    expect(sparseResult.sumAfter).toBeCloseTo(denseResult.sumAfter, 9);
  });

  it('treats an empty dense P as omitted and stays on the sparse path', () => {
    const denseP = [[4, 0.5], [0.5, 2]];
    const structured = structuredWeightsFromDense(denseP, 2);
    const sparseRows: SparseMatrixRows = [
      [{ index: 0, value: 1 }],
      [{ index: 0, value: 2 }],
    ];
    const solver = denseBackedSparseSolver();
    const sparseResult = solveAdjustmentIteration(
      {
        robustMode: 'none' as const,
        sparseCorrectionSolver: solver as SparseCorrectionSolver,
        solveNormalEquations: () => { throw new Error('dense solver must not run on the sparse path'); },
        estimateCondition: () => 0,
        recordConditionEstimate: () => undefined,
        captureRobustWeightBase: () => ({ diagonal: [], correlatedPairs: [] }),
        applyRobustWeightFactors: () => undefined,
        computeRobustWeightSummary: () => ({
          factors: [],
          downweightedRows: 0,
          minWeight: 1,
          maxNorm: 0,
          meanWeight: 1,
          topRows: [],
        }),
        maxRobustWeightDelta: () => 0,
        recordRobustDiagnostics: () => undefined,
        weightedQuadratic: () => { throw new Error('dense quadratic must not run on the sparse path'); },
      },
      [[1], [2]],
      [[3], [5]],
      // Legacy omitDenseP shape: a truthy empty matrix must not route dense.
      [],
      [null, null],
      1,
      { sparseRows, numParams: 1, structuredWeights: structured },
    );
    expect(solver.inputs.length).toBe(1);
    // structuredWeightsToPackedUpper(structured) packs 3 entries (2 diagonal + 1 pair).
    expect(solver.inputs[0]?.weights.values.length).toBe(3);
    expect(sparseResult.correction[0]?.[0]).toBeCloseTo(37.5 / 14, 12);
    // Weighted objectives come from the structured form, not weightedQuadratic([]) === 0.
    expect(sparseResult.sumBefore).toBeCloseTo(4 * 9 + 2 * 0.5 * 3 * 5 + 2 * 25, 9);
    expect(sparseResult.sumAfter).toBeGreaterThan(0);
  });

  it('treats an empty dense P as omitted in the Huber loop', () => {
    const denseP = [[4, 0.5], [0.5, 2]];
    const sparseRows: SparseMatrixRows = [
      [{ index: 0, value: 1 }],
      [{ index: 0, value: 2 }],
    ];
    const rowInfo: EquationRowInfo[] = [
      { obs: { id: 1, type: 'dist', from: 'A', to: 'B', obs: 10 } as unknown as Observation },
      { obs: { id: 2, type: 'dist', from: 'B', to: 'C', obs: 10 } as unknown as Observation },
    ];
    const huberDeps = {
      robustMode: 'huber' as const,
      sparseCorrectionSolver: denseBackedSparseSolver() as SparseCorrectionSolver,
      solveNormalEquations: (N: number[][], U: number[][]) =>
        solveNormalEquations(N, U, { log: () => undefined }),
      estimateCondition: () => 0,
      recordConditionEstimate: () => undefined,
      captureRobustWeightBase: (P: number[][], info: EquationRowInfo[]) =>
        captureRobustWeightBase(P, info, { robustCorrelationRowGroups: () => [] }),
      applyRobustWeightFactors: (
        P: number[][],
        base: { diagonal: number[]; correlatedPairs: { i: number; j: number; base: number }[] },
        factors: number[],
      ) => applyRobustWeightFactors(P, base, factors),
      captureRobustWeightBaseFromStructured: (
        weights: StructuredSymmetricWeights,
        info: EquationRowInfo[],
      ) => captureRobustWeightBaseFromStructured(weights, info, { robustCorrelationRowGroups: () => [] }),
      applyRobustWeightFactorsToStructured: (
        weights: StructuredSymmetricWeights,
        base: { diagonal: number[]; correlatedPairs: { i: number; j: number; base: number }[] },
        factors: number[],
      ) => applyRobustWeightFactorsToStructured(weights, base, factors),
      computeRobustWeightSummary: (residuals: number[], info: EquationRowInfo[]) =>
        computeRobustWeightSummary(residuals, info, { robustK: 1.5, rowSigma: () => 0.5 }),
      maxRobustWeightDelta,
      recordRobustDiagnostics: () => undefined,
      weightedQuadratic: () => { throw new Error('dense quadratic must not run on the sparse path'); },
    };
    const L = [[0.01], [4]];
    const structured = structuredWeightsFromDense(denseP, 2);
    const sparseResult = solveAdjustmentIteration(
      huberDeps,
      [[1], [2]],
      L.map((row) => [...row]),
      [],
      rowInfo,
      1,
      { sparseRows, numParams: 1, structuredWeights: structured },
    );
    const denseResult = solveAdjustmentIteration(
      { ...huberDeps, sparseCorrectionSolver: undefined,
        weightedQuadratic: (P, v) => symmetricQuadraticForm(P, v) },
      [[1], [2]],
      L.map((row) => [...row]),
      denseP.map((row) => [...row]),
      rowInfo,
      1,
      { sparseRows, numParams: 1 },
    );
    expect(sparseResult.correction[0]?.[0]).toBeCloseTo(denseResult.correction[0]?.[0] ?? 0, 9);
    expect(sparseResult.sumAfter).toBeCloseTo(denseResult.sumAfter, 9);
  });

  it('rejects an empty dense P on the dense-only path instead of solving garbage', () => {
    expect(() => solveAdjustmentIteration(
      {
        robustMode: 'none' as const,
        solveNormalEquations: (N, U) => solveNormalEquations(N, U, { log: () => undefined }),
        estimateCondition: () => 0,
        recordConditionEstimate: () => undefined,
        captureRobustWeightBase: () => ({ diagonal: [], correlatedPairs: [] }),
        applyRobustWeightFactors: () => undefined,
        computeRobustWeightSummary: () => ({
          factors: [],
          downweightedRows: 0,
          minWeight: 1,
          maxNorm: 0,
          meanWeight: 1,
          topRows: [],
        }),
        maxRobustWeightDelta: () => 0,
        recordRobustDiagnostics: () => undefined,
        weightedQuadratic: (P, v) => symmetricQuadraticForm(P, v),
      },
      [[1]],
      [[1]],
      [],
      [null],
      1,
      { sparseRows: [[{ index: 0, value: 1 }]], numParams: 1 },
    )).toThrow(/Dense weight matrix is required/);
  });

  it('matches dense Huber iterations with structured diagonal/off-diagonal updates', () => {
    const denseP = [[4, 0.5], [0.5, 2]];
    const sparseRows: SparseMatrixRows = [
      [{ index: 0, value: 1 }],
      [{ index: 0, value: 2 }],
    ];
    const rowInfo: EquationRowInfo[] = [
      { obs: { id: 1, type: 'dist', from: 'A', to: 'B', obs: 10 } as unknown as Observation },
      { obs: { id: 2, type: 'dist', from: 'B', to: 'C', obs: 10 } as unknown as Observation },
    ];
    const rowSigma = () => 0.5;
    const groups = () => [[0, 1]];
    const summaryOptions = { robustK: 1.5, rowSigma };
    const sharedDeps = {
      robustMode: 'huber' as const,
      solveNormalEquations: (N: number[][], U: number[][]) =>
        solveNormalEquations(N, U, { log: () => undefined }),
      estimateCondition: () => 0,
      recordConditionEstimate: () => undefined,
      captureRobustWeightBase: (P: number[][], info: EquationRowInfo[]) =>
        captureRobustWeightBase(P, info, { robustCorrelationRowGroups: groups }),
      applyRobustWeightFactors: (P: number[][], base: { diagonal: number[]; correlatedPairs: { i: number; j: number; base: number }[] }, factors: number[]) =>
        applyRobustWeightFactors(P, base, factors),
      captureRobustWeightBaseFromStructured: (
        weights: StructuredSymmetricWeights,
        info: EquationRowInfo[],
      ) => captureRobustWeightBaseFromStructured(weights, info, { robustCorrelationRowGroups: groups }),
      applyRobustWeightFactorsToStructured: (
        weights: StructuredSymmetricWeights,
        base: { diagonal: number[]; correlatedPairs: { i: number; j: number; base: number }[] },
        factors: number[],
      ) => applyRobustWeightFactorsToStructured(weights, base, factors),
      computeRobustWeightSummary: (residuals: number[], info: EquationRowInfo[]) =>
        computeRobustWeightSummary(residuals, info, summaryOptions),
      maxRobustWeightDelta,
      recordRobustDiagnostics: () => undefined,
      weightedQuadratic: (P: number[][], v: number[][]) => symmetricQuadraticForm(P, v),
    };
    // Outlier misclosure on row 1 forces Huber downweighting through both paths.
    const L = [[0.01], [4]];
    const denseCopy = denseP.map((row) => [...row]);
    const denseResult = solveAdjustmentIteration(
      sharedDeps,
      [[1], [2]],
      L,
      denseCopy,
      rowInfo,
      1,
      { sparseRows, numParams: 1 },
    );
    const structured = structuredWeightsFromDense(denseP, 2);
    const sparseResult = solveAdjustmentIteration(
      { ...sharedDeps, sparseCorrectionSolver: denseBackedSparseSolver() },
      [[1], [2]],
      L.map((row) => [...row]),
      undefined,
      rowInfo,
      1,
      { sparseRows, numParams: 1, structuredWeights: structured },
    );
    expect(sparseResult.correction[0]?.[0]).toBeCloseTo(denseResult.correction[0]?.[0] ?? 0, 9);
    expect(sparseResult.sumAfter).toBeCloseTo(denseResult.sumAfter, 9);
    expect(structured.diagonal[1] ?? 0).toBeLessThan(2);
    expect(denseCopy[1]?.[1] ?? 0).toBeCloseTo(structured.diagonal[1] ?? 0, 12);
  });

  it('keeps an explicit error when sparse Huber lacks structured robust support', () => {
    const structured = structuredWeightsFromDense([[1]], 1);
    expect(() => solveAdjustmentIteration(
      {
        robustMode: 'huber',
        solveNormalEquations: (N, U) => solveNormalEquations(N, U, { log: () => undefined }),
        estimateCondition: () => 0,
        recordConditionEstimate: () => undefined,
        captureRobustWeightBase: (P, info) =>
          captureRobustWeightBase(P, info, { robustCorrelationRowGroups: () => [] }),
        applyRobustWeightFactors: () => undefined,
        computeRobustWeightSummary: () => ({
          factors: [1],
          downweightedRows: 0,
          minWeight: 1,
          maxNorm: 0,
          meanWeight: 1,
          topRows: [],
        }),
        maxRobustWeightDelta: () => 0,
        recordRobustDiagnostics: () => undefined,
        weightedQuadratic: (P, v) => symmetricQuadraticForm(P, v),
      },
      [[1]],
      [[1]],
      undefined,
      [null],
      1,
      { sparseRows: [[{ index: 0, value: 1 }]], numParams: 1, structuredWeights: structured },
    )).toThrow(/Dense weight matrix is required/);
  });

  it('matches dense engine results with an injected sparse correction solver', () => {
    const input = loadTutorialInput();
    const baseline = summarizeRun(new LSAEngine({ input }));
    const solver = denseBackedSparseSolver();
    const routed = summarizeRun(new LSAEngine({ input, sparseCorrectionSolver: solver }));
    expect(solver.inputs.length).toBeGreaterThan(0);
    expect(routed).toEqual(baseline);
  });

  it('falls back to dense weights when the sparse correction solver fails', () => {
    const input = loadTutorialInput();
    const baseline = summarizeRun(new LSAEngine({ input }));
    const failing = {
      solveFromEquations: () => { throw new Error('experimental backend offline'); },
    };
    const engine = new LSAEngine({ input, sparseCorrectionSolver: failing });
    const result = engine.solve();
    expect(result.success).toBe(true);
    expect(summarizeRun(new LSAEngine({ input }))).toEqual(baseline);
    expect(result.logs.some((line) => line.includes('retrying with dense weights'))).toBe(true);
  });

  it('packs structured weights identically to dense weights for row products', () => {
    const dense = [[2, 0.5, 0], [0.5, 3, 0.1], [0, 0.1, 4]];
    const structured = structuredWeightsFromDense(dense, 3);
    expect(structuredWeightsToPackedUpper(structured)).toEqual(packUpperTriangleWeights(dense, 3));
    const gpsObs = {
      id: 7, type: 'gps', from: 'A', to: 'B', obs: { dE: 1, dN: 2, dU: 3 },
    } as unknown as Observation;
    const rows: SparseMatrixRows = [
      [{ index: 0, value: 1 }],
      [{ index: 1, value: 1 }],
      [{ index: 0, value: 0.5 }, { index: 1, value: 0.5 }],
    ];
    const rowInfo: EquationRowInfo[] = [
      { obs: gpsObs, component: 'E' },
      { obs: gpsObs, component: 'N' },
      { obs: gpsObs, component: 'U' },
    ];
    const seen: { rows: number[]; columns: number[]; values: number[] }[] = [];
    const spy = {
      queryRowProducts: (request: {
        design: { values: Float64Array };
        weights: { rows: Int32Array; columns: Int32Array; values: Float64Array };
        observationEquationCount: number;
        parameterCount: number;
        queryRowOffsets: Int32Array;
        queryColumns: Int32Array;
        queryValues: Float64Array;
        crossA: Int32Array;
        crossB: Int32Array;
      }) => {
        seen.push({
          rows: [...request.weights.rows],
          columns: [...request.weights.columns],
          values: [...request.weights.values],
        });
        return {
          quadratic: new Float64Array(request.observationEquationCount),
          cross: new Float64Array(request.crossA.length),
          normalNnz: 0,
          factorNnz: 0,
          damping: 0,
          dampingAttempts: 0,
        };
      },
    };
    queryStandardizedResidualRowProducts(spy, {
      sparseRows: rows,
      structuredWeights: structuredWeightsFromDense([[1, 0, 0], [0, 1, 0], [0, 0, 1]], 3),
      rowInfo,
      activeObservations: [gpsObs],
      observationEquationCount: 3,
      parameterCount: 2,
    });
    queryStandardizedResidualRowProducts(spy, {
      sparseRows: rows,
      weights: [[1, 0, 0], [0, 1, 0], [0, 0, 1]],
      rowInfo,
      activeObservations: [gpsObs],
      observationEquationCount: 3,
      parameterCount: 2,
    });
    expect(seen).toHaveLength(2);
    expect(seen[0]).toEqual(seen[1]);
  });

  it('evaluates the structured quadratic form exactly like the dense form', () => {
    const dense = [[2, 0.5], [0.5, 3]];
    const structured = structuredWeightsFromDense(dense, 2);
    const residuals = [[1.5], [-2]];
    expect(structuredQuadraticForm(structured, residuals)).toBeCloseTo(
      symmetricQuadraticForm(dense, residuals),
      12,
    );
    const captureOptions = { robustCorrelationRowGroups: () => [[0, 1]] };
    const denseBase = captureRobustWeightBase(dense.map((row) => [...row]), [null, null], captureOptions);
    const structuredBase = captureRobustWeightBaseFromStructured(structured, [null, null], captureOptions);
    expect(structuredBase).toEqual(denseBase);
    const factors = [0.5, 1];
    const denseMutated = dense.map((row) => [...row]);
    applyRobustWeightFactors(denseMutated, denseBase, factors);
    applyRobustWeightFactorsToStructured(structured, structuredBase, factors);
    expect([...structured.diagonal]).toEqual([denseMutated[0]?.[0], denseMutated[1]?.[1]]);
    expect([...structured.offValues]).toEqual([denseMutated[0]?.[1]]);
    expect(structuredQuadraticForm(structured, residuals)).toBeCloseTo(
      symmetricQuadraticForm(denseMutated, residuals),
      12,
    );
  });

  it('matches dense Huber engine results with an injected sparse correction solver', () => {
    const input = loadTutorialInput();
    const baseline = summarizeRun(new LSAEngine({ input, parseOptions: { robustMode: 'huber' } }));
    const solver = denseBackedSparseSolver();
    const routed = summarizeRun(
      new LSAEngine({ input, parseOptions: { robustMode: 'huber' }, sparseCorrectionSolver: solver }),
    );
    expect(solver.inputs.length).toBeGreaterThan(0);
    // Structured Huber planning must stay on the sparse path without a dense retry.
    const retried = new LSAEngine({
      input,
      parseOptions: { robustMode: 'huber' },
      sparseCorrectionSolver: solver,
    }).solve();
    expect(retried.logs.some((line) => line.includes('retrying with dense weights'))).toBe(false);
    expect(routed).toEqual(baseline);
  });
});
