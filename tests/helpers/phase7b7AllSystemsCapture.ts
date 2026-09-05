/**
 * Phase 7B.7 every-iteration capture driver (test-only, no routing).
 *
 * Decorates the injected `SparseCorrectionSolver` and records EVERY
 * correction system the sparse backend sees (one call per iteration),
 * bounded by PHASE7B7_MAX_CAPTURED_SYSTEMS. No production code changes:
 * the decorator sits between `LSAEngine` and the injected bundle solver.
 */
import { LSAEngine } from '../../src/engine/adjust';
import type { EngineOptions } from '../../src/engine/adjustTypes';
import {
  PHASE7B7_MAX_CAPTURED_SYSTEMS,
  type Phase7b7StrategyId,
} from '../../src/engine/phase7b7SafetyStrategies';
import { measurePhase7b7FirstSystemOracle } from '../../src/engine/phase7b7FirstSystemOracle';
import type {
  Phase7b7OracleSystemEvidence,
  Phase7b7PreflightResult,
} from '../../src/engine/phase7b7StrategyVerdict';
import {
  evaluatePhase7b7StrategyVerdict,
  type Phase7b7StrategyVerdict,
} from '../../src/engine/phase7b7StrategyVerdict';
import type {
  SparseCorrectionSolveInput,
  SparseCorrectionSolveResult,
  SparseCorrectionSolver,
} from '../../src/engine/numericalBackend';
import type { Phase7b7CapturedSystem } from '../../src/engine/phase7b7FirstSystemOracle';

export interface CapturedCorrectionSystem {
  input: Phase7b7CapturedSystem;
  result: SparseCorrectionSolveResult | null;
  threw: boolean;
  callIndex: number;
}

const copyPackedInput = (input: SparseCorrectionSolveInput): Phase7b7CapturedSystem => ({
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

/**
 * Recording decorator: captures every sparse correction system up to the
 * test-only bound. Later calls pass through uncaptured and set
 * `truncated` so S3 can never silently claim full coverage.
 */
export class AllSystemsCaptureSolver implements SparseCorrectionSolver {
  readonly systems: CapturedCorrectionSystem[] = [];

  truncated = false;

  private readonly delegate: SparseCorrectionSolver;

  constructor(delegate: SparseCorrectionSolver) {
    this.delegate = delegate;
  }

  solveFromEquations(input: SparseCorrectionSolveInput): SparseCorrectionSolveResult {
    const callIndex = this.systems.length;
    if (callIndex >= PHASE7B7_MAX_CAPTURED_SYSTEMS) {
      this.truncated = true;
      return this.delegate.solveFromEquations(input);
    }
    try {
      const result = this.delegate.solveFromEquations(input);
      this.systems.push({ input: copyPackedInput(input), result, threw: false, callIndex });
      return result;
    } catch (error) {
      this.systems.push({ input: copyPackedInput(input), result: null, threw: true, callIndex });
      throw error;
    }
  }
}

/** Builds per-iteration oracle evidence from captured systems (untimed). */
export const buildPhase7b7OracleEvidence = (
  systems: CapturedCorrectionSystem[],
): Phase7b7OracleSystemEvidence[] =>
  systems.map((system) => {
    const measured = measurePhase7b7FirstSystemOracle(
      system.input,
      system.result?.conditionEstimate,
    );
    return {
      parameterCount: system.input.parameterCount,
      denseCorrection: measured.denseCorrection,
      sparseCorrection:
        system.result == null
          ? null
          : Array.from(
              { length: system.input.parameterCount },
              (_, index) => system.result?.correction[index]?.[0] ?? Number.NaN,
            ),
      sparseDamping: system.result?.damping ?? Number.NaN,
      ...(measured.conditionEstimate === undefined
        ? {}
        : { conditionEstimate: measured.conditionEstimate }),
      ...(measured.conditionSource === undefined
        ? {}
        : { conditionSource: measured.conditionSource }),
    };
  });

export interface Phase7b7LiveStrategyRun {
  reference: ReturnType<LSAEngine['solve']>;
  candidate: ReturnType<LSAEngine['solve']>;
  recorder: AllSystemsCaptureSolver;
  evidence: Phase7b7OracleSystemEvidence[];
}

/**
 * Runs a TS reference plus a sparse-injected candidate capturing every
 * correction system, then assembles per-iteration oracle evidence.
 */
export const runPhase7b7LiveStrategy = (options: {
  input: string;
  maxIterations: number;
  sparseSolver: SparseCorrectionSolver;
  extraOptions?: Partial<EngineOptions>;
}): Phase7b7LiveStrategyRun => {
  const reference = new LSAEngine({
    input: options.input,
    maxIterations: options.maxIterations,
  }).solve();
  const recorder = new AllSystemsCaptureSolver(options.sparseSolver);
  const candidate = new LSAEngine({
    input: options.input,
    maxIterations: options.maxIterations,
    ...(options.extraOptions ?? {}),
    sparseCorrectionSolver: recorder,
  }).solve();
  const evidence = buildPhase7b7OracleEvidence(recorder.systems);
  return { reference, candidate, recorder, evidence };
};

/** Evaluates one strategy level over a live run's captured evidence. */
export const verdictForPhase7b7Run = (
  run: Phase7b7LiveStrategyRun,
  strategy: Phase7b7StrategyId,
  preflight: Phase7b7PreflightResult,
): Phase7b7StrategyVerdict =>
  evaluatePhase7b7StrategyVerdict({
    strategy,
    reference: run.reference,
    candidate: run.candidate,
    systems: run.evidence,
    captureTruncated: run.recorder.truncated,
    preflight,
  });
