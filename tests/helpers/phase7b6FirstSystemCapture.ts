/**
 * Phase 7B.6 first-system capture driver (test-only, no routing).
 *
 * Records the EXACT first correction system the sparse backend sees by
 * decorating the injected `SparseCorrectionSolver`, then rebuilds the
 * identical dense normal system in-test (packed design/weights unpacked to
 * sparse rows + dense P, assembled with the production
 * `accumulateNormalEquationsFromSparseRows` + `solveNormalEquations`
 * helpers). No production code changes: the decorator sits between
 * `LSAEngine` and the injected bundle solver.
 */
import { solveNormalEquations } from '../../src/engine/adjustNormalEquationHelpers';
import { LSAEngine } from '../../src/engine/adjust';
import type { EngineOptions } from '../../src/engine/adjustTypes';
import { estimateSparseNormalCondition } from '../../src/engine/sparseNormalCondition';
import type { Phase7b6HandshakeInput } from '../../src/engine/phase7b6CorrectionHandshake';
import { accumulateNormalEquationsFromSparseRows } from '../../src/engine/matrixSparse';
import type { SparseMatrixRows } from '../../src/engine/matrixTypes';
import type {
  SparseCorrectionSolveInput,
  SparseCorrectionSolveResult,
  SparseCorrectionSolver,
} from '../../src/engine/numericalBackend';
import type {
  PackedSparseDesignRows,
  PackedUpperTriangle,
} from '../../src/engine/sparseEquationPacking';

export interface CapturedFirstSystem {
  input: {
    design: PackedSparseDesignRows;
    weights: PackedUpperTriangle;
    misclosures: Float64Array;
    observationEquationCount: number;
    parameterCount: number;
  };
  result: SparseCorrectionSolveResult | null;
  threw: boolean;
  calls: number;
}

const copyPackedInput = (input: SparseCorrectionSolveInput): CapturedFirstSystem['input'] => ({
  design: {
    rowOffsets: Int32Array.from(input.design.rowOffsets),
    columns: Int32Array.from(input.design.columns),
    values: Float64Array.from(input.design.values),
  },
  weights: {
    rows: Int32Array.from(input.weights.rows),
    columns: Int32Array.from(input.weights.columns),
    values: Float64Array.from(input.weights.values),
  },
  misclosures: Float64Array.from(input.misclosures),
  observationEquationCount: input.observationEquationCount,
  parameterCount: input.parameterCount,
});

/** Recording decorator: captures the first sparse correction system. */
export class RecordingSparseCorrectionSolver implements SparseCorrectionSolver {
  capture: CapturedFirstSystem | null = null;

  private calls = 0;

  private readonly delegate: SparseCorrectionSolver;

  constructor(delegate: SparseCorrectionSolver) {
    this.delegate = delegate;
  }

  solveFromEquations(input: SparseCorrectionSolveInput): SparseCorrectionSolveResult {
    this.calls += 1;
    if (this.calls === 1) {
      try {
        const result = this.delegate.solveFromEquations(input);
        this.capture = {
          input: copyPackedInput(input),
          result,
          threw: false,
          calls: this.calls,
        };
        return result;
      } catch (error) {
        this.capture = {
          input: copyPackedInput(input),
          result: null,
          threw: true,
          calls: this.calls,
        };
        throw error;
      }
    }
    return this.delegate.solveFromEquations(input);
  }
}

/** Unpacks CSR design rows to the sparse-row shape used by dense assembly. */
export const unpackDesignRows = (design: PackedSparseDesignRows): SparseMatrixRows => {
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
export const unpackDenseWeights = (weights: PackedUpperTriangle, size: number): number[][] => {
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
 * Throws fail-closed on non-finite output, mirroring production.
 */
export const solveDenseFirstSystem = (captured: CapturedFirstSystem): number[] => {
  const rows = unpackDesignRows(captured.input.design);
  const dense = unpackDenseWeights(
    captured.input.weights,
    captured.input.observationEquationCount,
  );
  const residuals = Array.from(captured.input.misclosures, (value) => [value]);
  const { normal, rhs } = accumulateNormalEquationsFromSparseRows(
    rows,
    residuals,
    dense,
    captured.input.parameterCount,
  );
  const solved = solveNormalEquations(normal, rhs, { log: () => undefined });
  const correction = (solved.correction ?? []).map((row) => row[0] ?? Number.NaN);
  if (correction.length !== captured.input.parameterCount) {
    throw new Error(
      `Dense first-system rebuild produced ${correction.length} params for ${captured.input.parameterCount}.`,
    );
  }
  return correction;
};

export interface Phase7b6LiveHandshakeRun {
  reference: ReturnType<LSAEngine['solve']>;
  candidate: ReturnType<LSAEngine['solve']>;
  recorder: RecordingSparseCorrectionSolver;
  handshakeInput: Phase7b6HandshakeInput;
}

/**
 * Runs a TS reference plus a sparse-injected candidate (recording the exact
 * first system the sparse backend saw), rebuilds the identical dense first
 * system in-test, and assembles the handshake input. Condition prefers the
 * native sparse estimate and falls back to the TS packed estimate; when
 * both are unavailable the evidence stays missing so the verdict rejects
 * fail-closed unless waived.
 */
export const runPhase7b6LiveHandshake = (options: {
  input: string;
  maxIterations: number;
  sparseSolver: SparseCorrectionSolver;
  extraOptions?: Partial<EngineOptions>;
}): Phase7b6LiveHandshakeRun => {
  const reference = new LSAEngine({
    input: options.input,
    maxIterations: options.maxIterations,
  }).solve();
  const recorder = new RecordingSparseCorrectionSolver(options.sparseSolver);
  const candidate = new LSAEngine({
    input: options.input,
    maxIterations: options.maxIterations,
    ...(options.extraOptions ?? {}),
    sparseCorrectionSolver: recorder,
  }).solve();
  const captured = recorder.capture;
  if (!captured) {
    return { reference, candidate, recorder, handshakeInput: { reference, candidate, firstSystem: null } };
  }
  let denseCorrection: number[] | null = null;
  try {
    denseCorrection = solveDenseFirstSystem(captured);
  } catch {
    denseCorrection = null;
  }
  const nativeEstimate = captured.result?.conditionEstimate;
  let conditionEstimate: number | undefined;
  let conditionSource: 'native-sparse' | 'ts-packed' | undefined;
  if (typeof nativeEstimate === 'number' && Number.isFinite(nativeEstimate)) {
    conditionEstimate = nativeEstimate;
    conditionSource = 'native-sparse';
  } else {
    try {
      const packed = estimateSparseNormalCondition(
        captured.input.design,
        captured.input.weights,
        captured.input.parameterCount,
      );
      if (Number.isFinite(packed)) {
        conditionEstimate = packed;
        conditionSource = 'ts-packed';
      }
    } catch {
      conditionEstimate = undefined;
    }
  }
  return {
    reference,
    candidate,
    recorder,
    handshakeInput: {
      reference,
      candidate,
      firstSystem: {
        parameterCount: captured.input.parameterCount,
        denseCorrection: denseCorrection ?? [],
        sparseCorrection:
          captured.result == null
            ? null
            : Array.from(
                { length: captured.input.parameterCount },
                (_, index) => captured.result?.correction[index]?.[0] ?? Number.NaN,
              ),
        sparseDamping: captured.result?.damping ?? Number.NaN,
        ...(conditionEstimate === undefined ? {} : { conditionEstimate }),
        ...(conditionSource === undefined ? {} : { conditionSource }),
      },
    },
  };
};
