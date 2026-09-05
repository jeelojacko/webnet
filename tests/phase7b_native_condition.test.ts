/**
 * Phase 7B native sparse raw-N condition metadata.
 *
 * Proves the C++/WASM `conditionEstimate` (raw assembled N rowMax*colMax
 * before scaling/damping) matches the TS-side packed estimate, and that
 * `solveAdjustmentIteration` prefers native metadata with a safe TS
 * fallback. No production routing, tolerances, or baselines change.
 */
import { pathToFileURL } from 'node:url';
import { describe, expect, it, vi } from 'vitest';

import { solveAdjustmentIteration } from '../src/engine/adjustmentIteration';
import {
  createExperimentalSparseRouteDiagnostics,
  type ExperimentalSparseRouteDiagnostics,
} from '../src/engine/experimentalSparseDiagnostics';
import type { IterationSolveDependencies } from '../src/engine/adjustmentSolveTypes';
import type {
  SparseCorrectionSolveInput,
  SparseCorrectionSolveResult,
} from '../src/engine/numericalBackend';
import { PHASE7B_PRECISION_POLICY } from '../src/engine/phase7bPrecisionPolicy';
import {
  packSparseDesignRows,
  packUpperTriangleWeights,
} from '../src/engine/sparseEquationPacking';
import { estimateSparseNormalCondition } from '../src/engine/sparseNormalCondition';
import { WasmSparseNormalEquationSolver } from '../src/engine/wasm/wasmSparseNormalSolver';
import type { WebNetWasmFactory } from '../src/engine/wasm/wasmTypes';

const loadWasmFactory = async (): Promise<WebNetWasmFactory | null> => {
  try {
    const imported = (await import(
      pathToFileURL(`${process.cwd()}/cpp/build-wasm/webnet_core.js`).href
    )) as unknown as { default: WebNetWasmFactory };
    if (typeof imported.default !== 'function') return null;
    return imported.default;
  } catch {
    return null;
  }
};

const wasmFactory = await loadWasmFactory();

const baseDependencies = (
  diagnostics: ExperimentalSparseRouteDiagnostics,
  solver: IterationSolveDependencies['sparseCorrectionSolver'],
): IterationSolveDependencies => ({
  robustMode: 'none',
  sparseCorrectionSolver: solver,
  experimentalSparseDiagnostics: diagnostics,
  solveNormalEquations: () => ({ correction: [[0]] }),
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
  weightedQuadratic: (P, v) => P[0]![0]! * v[0]![0]! * v[0]![0]!,
});

const stubSolver = (
  result: SparseCorrectionSolveResult,
): IterationSolveDependencies['sparseCorrectionSolver'] => ({
  solveFromEquations: (_input: SparseCorrectionSolveInput) => result,
});

describe('phase 7B native condition iteration wiring (no WASM)', () => {
  it('prefers finite native metadata over the TS recomputation', () => {
    const diagnostics = createExperimentalSparseRouteDiagnostics();
    const solveFromEquations = vi.fn((_input: SparseCorrectionSolveInput) => ({
      correction: [[1], [2]],
      damping: 0,
      dampingAttempts: 0,
      designNnz: 4,
      weightNnz: 3,
      normalNnz: 4,
      factorNnz: 3,
      ordering: 'AMD',
      solver: 'SimplicialLLT',
      conditionEstimate: 12345,
    }));
    const result = solveAdjustmentIteration(
      baseDependencies(diagnostics, { solveFromEquations }),
      [[1, 2], [3, 4]],
      [[5], [11]],
      [[2, 0.5], [0.5, 3]],
      [null, null],
      1,
    );
    expect(result.correction).toEqual([[1], [2]]);
    expect(diagnostics.sparseConditionEstimates).toEqual([12345]);
    expect(solveFromEquations).toHaveBeenCalledTimes(1);
  });

  it('falls back to the TS packed estimate only when native metadata is absent', () => {
    const diagnostics = createExperimentalSparseRouteDiagnostics();
    const result = solveAdjustmentIteration(
      baseDependencies(diagnostics, stubSolver({
        correction: [[1], [2]],
        damping: 0,
        dampingAttempts: 0,
        designNnz: 4,
        weightNnz: 3,
        normalNnz: 4,
        factorNnz: 3,
        ordering: 'AMD',
        solver: 'SimplicialLLT',
      })),
      [[1, 2], [3, 4]],
      [[5], [11]],
      [[2, 0.5], [0.5, 3]],
      [null, null],
      1,
    );
    expect(result.correction).toEqual([[1], [2]]);
    expect(diagnostics.sparseConditionEstimates).toHaveLength(1);
    const rows = [[{ index: 0, value: 1 }, { index: 1, value: 2 }], [{ index: 0, value: 3 }, { index: 1, value: 4 }]];
    const expected = estimateSparseNormalCondition(
      packSparseDesignRows(rows),
      packUpperTriangleWeights([[2, 0.5], [0.5, 3]], 2),
      2,
    );
    expect(diagnostics.sparseConditionEstimates[0]).toBe(expected);
  });

  it('falls back when native metadata is non-finite and records once', () => {
    const diagnostics = createExperimentalSparseRouteDiagnostics();
    const deps = baseDependencies(diagnostics, stubSolver({
      correction: [[1], [2]],
      damping: 0,
      dampingAttempts: 0,
      designNnz: 4,
      weightNnz: 3,
      normalNnz: 4,
      factorNnz: 3,
      ordering: 'AMD',
      solver: 'SimplicialLLT',
      conditionEstimate: Number.NaN,
    }));
    solveAdjustmentIteration(
      deps, [[1, 2], [3, 4]], [[5], [11]], [[2, 0.5], [0.5, 3]], [null, null], 1,
    );
    expect(diagnostics.sparseConditionEstimates).toHaveLength(1);
    expect(Number.isFinite(diagnostics.sparseConditionEstimates[0] ?? Number.NaN)).toBe(true);
    // A second first-iteration call must not append; later iterations never record.
    solveAdjustmentIteration(
      deps, [[1, 2], [3, 4]], [[5], [11]], [[2, 0.5], [0.5, 3]], [null, null], 1,
    );
    solveAdjustmentIteration(
      deps, [[1, 2], [3, 4]], [[5], [11]], [[2, 0.5], [0.5, 3]], [null, null], 2,
    );
    expect(diagnostics.sparseConditionEstimates).toHaveLength(1);
  });
});

describe.runIf(wasmFactory != null)('phase 7B native condition WASM parity', () => {
  it('matches the TS packed estimate with finite native metadata', async () => {
    const module = await wasmFactory!();
    const solver = new WasmSparseNormalEquationSolver(module);
    const rows = [
      [{ index: 0, value: 1 }, { index: 1, value: 2 }],
      [{ index: 0, value: 3 }, { index: 1, value: 4 }],
    ];
    const denseP = [[2, 0.5], [0.5, 3]];
    const { buildSparseSolveInput } = await import('../src/engine/sparseEquationPacking');
    const result = solver.solveFromEquations(buildSparseSolveInput(rows, denseP, [[5], [11]], 2));
    expect(result.correction.map((row) => row[0]!)).toEqual([
      expect.closeTo(1, 12),
      expect.closeTo(2, 12),
    ]);
    expect(result.conditionEstimate).toBeDefined();
    expect(Number.isFinite(result.conditionEstimate ?? Number.NaN)).toBe(true);
    const expected = estimateSparseNormalCondition(
      packSparseDesignRows(rows),
      packUpperTriangleWeights(denseP, 2),
      2,
    );
    // Raw-N reference: N=[[32,45],[45,64]] => 109*109 = 11881.
    expect(expected).toBe(11881);
    const tolerance =
      PHASE7B_PRECISION_POLICY.conditionRelativeTolerance * Math.max(1, Math.abs(expected));
    expect(Math.abs((result.conditionEstimate ?? 0) - expected)).toBeLessThanOrEqual(tolerance);
  });

  it('fails closed with a message on invalid input', async () => {
    const module = await wasmFactory!();
    const solver = new WasmSparseNormalEquationSolver(module);
    const design = packSparseDesignRows([[{ index: 0, value: 1 }]]);
    const weights = packUpperTriangleWeights([[1]], 1);
    // Out-of-range design column: packed length check passes, native rejects.
    const badDesign = {
      rowOffsets: design.rowOffsets,
      columns: new Int32Array([7]),
      values: new Float64Array([1]),
    };
    expect(() => solver.solveFromEquations({
      design: badDesign,
      weights,
      misclosures: new Float64Array([0]),
      observationEquationCount: 1,
      parameterCount: 2,
    })).toThrow();
  });
});
