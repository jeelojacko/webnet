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

export interface StatisticsStageRecord {
  residualsMs: number;
  standardizedResidualsMs: number;
  precisionPropagationMs: number;
  diagnosticsMs: number;
  calls: number;
}

export interface StandardizedResidualStageRecord {
  statisticsEquationAssemblyMs: number;
  robustWeightPreparationMs: number;
  statisticsNormalAccumulationMs: number;
  statisticsQxxInversionMs: number;
  rowProductConstructionMs: number;
  perEquationStatisticsMs: number;
  gpsCrossProductTransformMs: number;
  summaryConstructionMs: number;
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
  statisticsDetail: StatisticsStageRecord;
  standardizedResidualDetail: StandardizedResidualStageRecord;
  iterationCount: number;
}

export const createDetailedSolveProfiler = (): {
  profile: DetailedSolveProfile;
  recordIteration: (_record: IterationStageRecord) => void;
  recordCovariance: (_assemblyMs: number, _accumulateMs: number, _invertMs: number) => void;
  recordStatistics: (_ms: number) => void;
  recordStatisticsStage: (_partial: Partial<Omit<StatisticsStageRecord, 'calls'>>) => void;
  recordStandardizedResidualStage: (
    _partial: Partial<Omit<StandardizedResidualStageRecord, 'calls'>>,
  ) => void;
} => {
  const profile: DetailedSolveProfile = {
    iterations: [],
    assemblyMs: 0,
    accumulateMs: 0,
    factorSolveMs: 0,
    stateUpdateMs: 0,
    covariance: { assemblyMs: 0, accumulateMs: 0, invertMs: 0, calls: 0 },
    statisticsMs: 0,
    statisticsDetail: {
      residualsMs: 0,
      standardizedResidualsMs: 0,
      precisionPropagationMs: 0,
      diagnosticsMs: 0,
      calls: 0,
    },
    standardizedResidualDetail: {
      statisticsEquationAssemblyMs: 0,
      robustWeightPreparationMs: 0,
      statisticsNormalAccumulationMs: 0,
      statisticsQxxInversionMs: 0,
      rowProductConstructionMs: 0,
      perEquationStatisticsMs: 0,
      gpsCrossProductTransformMs: 0,
      summaryConstructionMs: 0,
      calls: 0,
    },
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
      profile.statisticsDetail.calls += 1;
    },
    recordStatisticsStage: (partial) => {
      if (partial.residualsMs) profile.statisticsDetail.residualsMs += partial.residualsMs;
      if (partial.standardizedResidualsMs) {
        profile.statisticsDetail.standardizedResidualsMs += partial.standardizedResidualsMs;
      }
      if (partial.precisionPropagationMs) {
        profile.statisticsDetail.precisionPropagationMs += partial.precisionPropagationMs;
      }
      if (partial.diagnosticsMs) profile.statisticsDetail.diagnosticsMs += partial.diagnosticsMs;
    },
    recordStandardizedResidualStage: (partial) => {
      const detail = profile.standardizedResidualDetail;
      if (partial.statisticsEquationAssemblyMs) {
        detail.statisticsEquationAssemblyMs += partial.statisticsEquationAssemblyMs;
      }
      if (partial.robustWeightPreparationMs) {
        detail.robustWeightPreparationMs += partial.robustWeightPreparationMs;
      }
      if (partial.statisticsNormalAccumulationMs) {
        detail.statisticsNormalAccumulationMs += partial.statisticsNormalAccumulationMs;
      }
      if (partial.statisticsQxxInversionMs) {
        detail.statisticsQxxInversionMs += partial.statisticsQxxInversionMs;
      }
      if (partial.rowProductConstructionMs) {
        detail.rowProductConstructionMs += partial.rowProductConstructionMs;
      }
      if (partial.perEquationStatisticsMs) {
        detail.perEquationStatisticsMs += partial.perEquationStatisticsMs;
      }
      if (partial.gpsCrossProductTransformMs) {
        detail.gpsCrossProductTransformMs += partial.gpsCrossProductTransformMs;
      }
      if (partial.summaryConstructionMs) {
        detail.summaryConstructionMs += partial.summaryConstructionMs;
      }
      detail.calls += 1;
    },
  };
};

export type DetailedSolveProfiler = ReturnType<typeof createDetailedSolveProfiler>;

/** High-resolution clock isolated here so call sites stay branch-only when disabled. */
export const detailedNow = (): number =>
  typeof performance !== 'undefined' && typeof performance.now === 'function'
    ? performance.now()
    : Date.now();
