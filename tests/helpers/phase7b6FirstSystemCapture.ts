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
import { LSAEngine } from '../../src/engine/adjust';
import type { EngineOptions } from '../../src/engine/adjustTypes';
import { estimateSparseNormalCondition } from '../../src/engine/sparseNormalCondition';
import type { Phase7b6HandshakeInput } from '../../src/engine/phase7b6CorrectionHandshake';
import {
  solvePhase7b7DenseFirstSystem,
  unpackPhase7b7DenseWeights,
  unpackPhase7b7DesignRows,
} from '../../src/engine/phase7b7FirstSystemOracle';
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

/** Unpacks CSR design rows (single implementation in the Phase 7B.7 oracle). */
export const unpackDesignRows = unpackPhase7b7DesignRows;

/** Rebuilds symmetric dense P (single implementation in the Phase 7B.7 oracle). */
export const unpackDenseWeights = unpackPhase7b7DenseWeights;

/**
 * Solves the captured first system through the production dense path
 * (same assembly + scaled/damped Cholesky as the TS reference iteration).
 * Throws fail-closed on non-finite output, mirroring production.
 */
export const solveDenseFirstSystem = (captured: CapturedFirstSystem): number[] =>
  solvePhase7b7DenseFirstSystem(captured.input);

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
