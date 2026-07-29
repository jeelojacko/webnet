import {
  extractAutoAdjustDirectiveFromInput,
  formatAutoAdjustLogLines,
  runAutoAdjustCycles,
  type AutoAdjustConfig,
} from './autoAdjust';
import { createDirectSolveCore } from './directRunCore';
import { solveWithImpacts } from './directRunDiagnostics';
import { normalizeClusterApprovedMerges } from './solveEngine';
import type { SolveProfile } from '../appStateTypes';
import type { Instrument, RunMode } from '../types';
import type { RunSessionOutcome, RunSessionRequest } from './runSession';

const AUTO_ADJUST_MIN_REDUNDANCY = 0.05;

interface CreateDirectRunPipelineArgs {
  defaultIndustryInstrumentCode: string;
  defaultIndustryInstrument: Instrument;
  normalizeSolveProfile: (_profile: SolveProfile) => SolveProfile;
}

const buildAutoAdjustConfig = (request: RunSessionRequest): AutoAdjustConfig => {
  const inlineAutoAdjust = extractAutoAdjustDirectiveFromInput(request.input);
  const uiRunMode: RunMode =
    request.parseSettings.runMode ??
    (request.parseSettings.preanalysisMode ? 'preanalysis' : 'adjustment');

  return {
    enabled:
      uiRunMode === 'adjustment'
        ? (inlineAutoAdjust?.enabled ?? request.parseSettings.autoAdjustEnabled)
        : false,
    maxCycles: inlineAutoAdjust?.maxCycles ?? request.parseSettings.autoAdjustMaxCycles,
    maxRemovalsPerCycle:
      inlineAutoAdjust?.maxRemovalsPerCycle ??
      request.parseSettings.autoAdjustMaxRemovalsPerCycle,
    stdResThreshold:
      inlineAutoAdjust?.stdResThreshold ?? request.parseSettings.autoAdjustStdResThreshold,
    minRedundancy: AUTO_ADJUST_MIN_REDUNDANCY,
  };
};

const applyAutoAdjustDiagnostics = (
  request: RunSessionRequest,
  solved: RunSessionOutcome['result'],
  autoAdjustSummary: ReturnType<typeof runAutoAdjustCycles>,
  autoAdjustConfig: AutoAdjustConfig,
): void => {
  if (solved.parseState) {
    solved.parseState.autoAdjustEnabled = autoAdjustConfig.enabled;
    solved.parseState.autoAdjustMaxCycles = autoAdjustSummary.config.maxCycles;
    solved.parseState.autoAdjustMaxRemovalsPerCycle =
      autoAdjustSummary.config.maxRemovalsPerCycle;
    solved.parseState.autoAdjustStdResThreshold = autoAdjustSummary.config.stdResThreshold;
  }
  solved.autoAdjustDiagnostics = {
    enabled: true,
    threshold: autoAdjustSummary.config.stdResThreshold,
    maxCycles: autoAdjustSummary.config.maxCycles,
    maxRemovalsPerCycle: autoAdjustSummary.config.maxRemovalsPerCycle,
    minRedundancy: autoAdjustSummary.config.minRedundancy ?? AUTO_ADJUST_MIN_REDUNDANCY,
    stopReason: autoAdjustSummary.stopReason,
    cycles: autoAdjustSummary.cycles.map((cycle) => ({
      cycle: cycle.cycle,
      seuw: cycle.seuw,
      maxAbsStdRes: cycle.maxAbsStdRes,
      removals: [...cycle.removals],
    })),
    removed: autoAdjustSummary.cycles.flatMap((cycle) => cycle.removals),
  };
  const autoLines = formatAutoAdjustLogLines(autoAdjustSummary);
  for (let i = autoLines.length - 1; i >= 0; i -= 1) {
    solved.logs.unshift(autoLines[i]);
  }
};

export const createDirectRunPipeline = ({
  defaultIndustryInstrumentCode,
  defaultIndustryInstrument,
  normalizeSolveProfile,
}: CreateDirectRunPipelineArgs) => {
  const solveCore = createDirectSolveCore({
    defaultIndustryInstrumentCode,
    defaultIndustryInstrument,
    normalizeSolveProfile,
  });

  return function runWithExclusionsDirect(request: RunSessionRequest): RunSessionOutcome {
    const startMs = Date.now();
    let effectiveExclusions = new Set(request.excludedIds);
    let activePreanalysisAdditionIds = [...request.activePreanalysisAdditionIds];
    let effectiveOverrides = request.overrides;
    let effectiveClusterMerges = normalizeClusterApprovedMerges(request.approvedClusterMerges);
    let autoAdjustSummary: ReturnType<typeof runAutoAdjustCycles> | null = null;

    if (!request.parseSettings.clusterDetectionEnabled) {
      effectiveClusterMerges = [];
    }

    const inputChangedSinceLastRun =
      request.lastRunInput != null && request.input !== request.lastRunInput;
    const droppedExclusions = inputChangedSinceLastRun ? effectiveExclusions.size : 0;
    const droppedPreanalysisAdditions = inputChangedSinceLastRun
      ? activePreanalysisAdditionIds.length
      : 0;
    const droppedOverrides = inputChangedSinceLastRun ? Object.keys(effectiveOverrides).length : 0;
    const droppedClusterMerges = inputChangedSinceLastRun ? effectiveClusterMerges.length : 0;

    if (
      inputChangedSinceLastRun &&
      (droppedExclusions > 0 ||
        droppedPreanalysisAdditions > 0 ||
        droppedOverrides > 0 ||
        droppedClusterMerges > 0)
    ) {
      effectiveExclusions = new Set();
      activePreanalysisAdditionIds = [];
      effectiveOverrides = {};
      effectiveClusterMerges = [];
    }

    const autoAdjustConfig = buildAutoAdjustConfig(request);
    if (autoAdjustConfig.enabled) {
      autoAdjustSummary = runAutoAdjustCycles(effectiveExclusions, autoAdjustConfig, (trialExclusions) =>
        solveCore(request, trialExclusions, undefined, effectiveOverrides, effectiveClusterMerges),
      );
      effectiveExclusions = autoAdjustSummary.finalExcludedIds;
    }

    const solved = solveWithImpacts({
      request: { ...request, activePreanalysisAdditionIds },
      excludeSet: effectiveExclusions,
      overrideValues: effectiveOverrides,
      approvedClusterMerges: effectiveClusterMerges,
      solveCore,
      defaultIndustryInstrumentCode,
      defaultIndustryInstrument,
      normalizeSolveProfile,
    });
    activePreanalysisAdditionIds = [
      ...(solved.preanalysisSyntheticAdditionIds ?? activePreanalysisAdditionIds),
    ];

    if (autoAdjustSummary?.enabled) {
      applyAutoAdjustDiagnostics(request, solved, autoAdjustSummary, autoAdjustConfig);
    }

    const elapsedMs = Date.now() - startMs;

    return {
      result: solved,
      effectiveExcludedIds: [...effectiveExclusions],
      activePreanalysisAdditionIds: [...activePreanalysisAdditionIds],
      effectiveClusterApprovedMerges: effectiveClusterMerges,
      droppedExclusions,
      droppedPreanalysisAdditions,
      droppedOverrides,
      droppedClusterMerges,
      inputChangedSinceLastRun,
      elapsedMs,
      profile: {
        totalElapsedMs: elapsedMs,
        solveInvocationCount: 1,
        stages: [{ id: 'main-solve', label: 'Direct pipeline', durationMs: elapsedMs, solveCount: 1 }],
      },
    };
  };
};
