/**
 * Opt-in internal detailed solve-stage profiling (Phase 10B evidence only).
 *
 * Disabled by default: every instrumentation site guards on the collector
 * being present, so production solves pay a single branch per stage and no
 * timing calls. Enabling never changes numerics, logs, or the public
 * `AdjustmentResult` contract — the collector lives outside the result and
 * is threaded only through test-only `EngineOptions` fields.
 */
export interface IterationSystemProbeInput {
  iteration: number;
  design: { rowOffsets: Int32Array; columns: Int32Array; values: Float64Array };
  weights: { rows: Int32Array; columns: Int32Array; values: Float64Array };
  misclosures: Float64Array;
  observationEquationCount: number;
  parameterCount: number;
  /** Dense TypeScript correction for this system (column vector, length = parameterCount). */
  tsCorrection: number[];
}

export interface IterationStageRecord {
  iteration: number;
  parameterCount: number;
  equationCount: number;
  designNnz: number;
  weightNnz: number;
  assemblyMs: number;
  accumulateMs: number;
  factorSolveMs: number;
  stateUpdateMs: number;
}

export interface CovarianceStageRecord {
  assemblyMs: number;
  accumulateMs: number;
  invertMs: number;
  calls: number;
}

export interface DetailedSolveProfile {
  iterations: IterationStageRecord[];
  assemblyMs: number;
  accumulateMs: number;
  factorSolveMs: number;
  stateUpdateMs: number;
  covariance: CovarianceStageRecord;
  statisticsMs: number;
  iterationCount: number;
}

export const createDetailedSolveProfiler = (): {
  profile: DetailedSolveProfile;
  recordIteration: (_record: IterationStageRecord) => void;
  recordCovariance: (_assemblyMs: number, _accumulateMs: number, _invertMs: number) => void;
  recordStatistics: (_ms: number) => void;
} => {
  const profile: DetailedSolveProfile = {
    iterations: [],
    assemblyMs: 0,
    accumulateMs: 0,
    factorSolveMs: 0,
    stateUpdateMs: 0,
    covariance: { assemblyMs: 0, accumulateMs: 0, invertMs: 0, calls: 0 },
    statisticsMs: 0,
    iterationCount: 0,
  };
  return {
    profile,
    recordIteration: (record) => {
      profile.iterations.push(record);
      profile.assemblyMs += record.assemblyMs;
      profile.accumulateMs += record.accumulateMs;
      profile.factorSolveMs += record.factorSolveMs;
      profile.stateUpdateMs += record.stateUpdateMs;
      profile.iterationCount += 1;
    },
    recordCovariance: (assemblyMs, accumulateMs, invertMs) => {
      profile.covariance.assemblyMs += assemblyMs;
      profile.covariance.accumulateMs += accumulateMs;
      profile.covariance.invertMs += invertMs;
      profile.covariance.calls += 1;
    },
    recordStatistics: (ms) => {
      profile.statisticsMs += ms;
    },
  };
};

export type DetailedSolveProfiler = ReturnType<typeof createDetailedSolveProfiler>;

/** High-resolution clock isolated here so call sites stay branch-only when disabled. */
export const detailedNow = (): number =>
  typeof performance !== 'undefined' && typeof performance.now === 'function'
    ? performance.now()
    : Date.now();
