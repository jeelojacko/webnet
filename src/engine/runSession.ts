import {
  extractAutoAdjustDirectiveFromInput,
  formatAutoAdjustLogLines,
  runAutoAdjustCycles,
  type AutoAdjustConfig,
} from './autoAdjust';
import { createSessionSolveRunner } from './runSessionSolver';
export {
  collectSuspectImpactCandidates,
  resolveSuspectImpactSkipReason,
} from './runSessionSuspectImpact';
import type {
  RunSessionOutcome,
  RunSessionProgressCallback,
  RunSessionProfile,
  RunSessionRequest,
  RunSessionStageId,
  RunSessionStageProfile,
} from './runSessionTypes';
export type {
  RunSessionOutcome,
  RunSessionParseSettings,
  RunSessionProgressCallback,
  RunSessionProgressUpdate,
  RunSessionProfile,
  RunSessionRequest,
  RunSessionStageProfile,
} from './runSessionTypes';
import { normalizeClusterApprovedMerges } from './solveEngine';
import type { ClusterApprovedMerge, ObservationOverride, RunMode } from '../types';

const AUTO_ADJUST_MIN_REDUNDANCY = 0.05;

const stageLabelForProfile = (stageId: RunSessionStageId): string => {
  switch (stageId) {
    case 'main-solve':
      return 'Main solve';
    case 'suspect-impact':
      return 'Suspect impact analysis';
    case 'preanalysis-impact':
      return 'Preanalysis impact analysis';
    case 'robust-compare':
      return 'Robust comparison';
    case 'auto-adjust':
      return 'Auto-adjust';
    default:
      return stageId;
  }
};

const resetStaleRunState = (
  request: RunSessionRequest,
): {
  effectiveExclusions: Set<number>;
  activePreanalysisAdditionIds: string[];
  effectiveOverrides: Record<number, ObservationOverride>;
  effectiveClusterMerges: ClusterApprovedMerge[];
  droppedExclusions: number;
  droppedPreanalysisAdditions: number;
  droppedOverrides: number;
  droppedClusterMerges: number;
  inputChangedSinceLastRun: boolean;
} => {
  const inputChangedSinceLastRun =
    request.lastRunInput != null && request.input !== request.lastRunInput;
  const initialClusterMerges = request.parseSettings.clusterDetectionEnabled
    ? normalizeClusterApprovedMerges(request.approvedClusterMerges)
    : [];
  const droppedExclusions = inputChangedSinceLastRun ? request.excludedIds.length : 0;
  const droppedPreanalysisAdditions = inputChangedSinceLastRun
    ? request.activePreanalysisAdditionIds.length
    : 0;
  const droppedOverrides = inputChangedSinceLastRun ? Object.keys(request.overrides).length : 0;
  const droppedClusterMerges = inputChangedSinceLastRun ? initialClusterMerges.length : 0;
  const shouldDropState =
    inputChangedSinceLastRun &&
    (droppedExclusions > 0 ||
      droppedPreanalysisAdditions > 0 ||
      droppedOverrides > 0 ||
      droppedClusterMerges > 0);

  return {
    effectiveExclusions: new Set(shouldDropState ? [] : request.excludedIds),
    activePreanalysisAdditionIds: shouldDropState ? [] : [...request.activePreanalysisAdditionIds],
    effectiveOverrides: shouldDropState ? {} : request.overrides,
    effectiveClusterMerges: shouldDropState ? [] : initialClusterMerges,
    droppedExclusions,
    droppedPreanalysisAdditions,
    droppedOverrides,
    droppedClusterMerges,
    inputChangedSinceLastRun,
  };
};

const createAutoAdjustConfig = (request: RunSessionRequest): AutoAdjustConfig => {
  const uiRunMode: RunMode =
    request.parseSettings.runMode ??
    (request.parseSettings.preanalysisMode ? 'preanalysis' : 'adjustment');
  const inlineAutoAdjust = extractAutoAdjustDirectiveFromInput(request.input);
  return {
    enabled:
      uiRunMode === 'adjustment'
        ? (inlineAutoAdjust?.enabled ?? request.parseSettings.autoAdjustEnabled)
        : false,
    maxCycles: inlineAutoAdjust?.maxCycles ?? request.parseSettings.autoAdjustMaxCycles,
    maxRemovalsPerCycle:
      inlineAutoAdjust?.maxRemovalsPerCycle ?? request.parseSettings.autoAdjustMaxRemovalsPerCycle,
    stdResThreshold:
      inlineAutoAdjust?.stdResThreshold ?? request.parseSettings.autoAdjustStdResThreshold,
    minRedundancy: AUTO_ADJUST_MIN_REDUNDANCY,
  };
};

export const runAdjustmentSession = (
  request: RunSessionRequest,
  onProgress?: RunSessionProgressCallback,
): RunSessionOutcome => {
  const startedAt = Date.now();
  let {
    effectiveExclusions,
    activePreanalysisAdditionIds,
    effectiveOverrides,
    effectiveClusterMerges,
    droppedExclusions,
    droppedPreanalysisAdditions,
    droppedOverrides,
    droppedClusterMerges,
    inputChangedSinceLastRun,
  } = resetStaleRunState(request);
  const stageProfiles = new Map<RunSessionStageId, RunSessionStageProfile>();
  const recordStageDuration = (stageId: RunSessionStageId, durationMs: number): void => {
    const existing = stageProfiles.get(stageId);
    if (existing) {
      existing.durationMs += durationMs;
      existing.solveCount += 1;
      return;
    }
    stageProfiles.set(stageId, {
      id: stageId,
      label: stageLabelForProfile(stageId),
      durationMs,
      solveCount: 1,
    });
  };
  const runner = createSessionSolveRunner({
    request,
    startedAt,
    activePreanalysisAdditionIds,
    effectiveOverrides,
    effectiveClusterMerges,
    onProgress,
    recordStageDuration,
  });
  const autoAdjustConfig = createAutoAdjustConfig(request);
  const autoAdjustSummary = autoAdjustConfig.enabled
    ? runAutoAdjustCycles(effectiveExclusions, autoAdjustConfig, (trialExclusions) =>
        runner.solveCore(trialExclusions, undefined, effectiveOverrides, effectiveClusterMerges, {
          stageId: 'auto-adjust',
          stageLabel: 'Auto-adjust',
          solveTotalHint: runner.getSolveInvocationCount() + 1,
        }),
      )
    : null;
  if (autoAdjustSummary?.enabled) {
    effectiveExclusions = autoAdjustSummary.finalExcludedIds;
  }

  const result = runner.solveWithImpacts(
    effectiveExclusions,
    effectiveOverrides,
    effectiveClusterMerges,
  );
  const solveInvocationCount = runner.getSolveInvocationCount();
  onProgress?.({
    phase: 'finalizing',
    elapsedMs: Date.now() - startedAt,
    stageId: 'main-solve',
    stageLabel: 'Finalizing result',
    solveIndex: solveInvocationCount,
    solveTotalHint: solveInvocationCount,
  });
  if (autoAdjustSummary?.enabled) {
    if (result.parseState) {
      result.parseState.autoAdjustEnabled = autoAdjustConfig.enabled;
      result.parseState.autoAdjustMaxCycles = autoAdjustSummary.config.maxCycles;
      result.parseState.autoAdjustMaxRemovalsPerCycle =
        autoAdjustSummary.config.maxRemovalsPerCycle;
      result.parseState.autoAdjustStdResThreshold = autoAdjustSummary.config.stdResThreshold;
    }
    result.autoAdjustDiagnostics = {
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
      result.logs.unshift(autoLines[i]);
    }
  }

  const elapsedMs = Date.now() - startedAt;
  const profile: RunSessionProfile = {
    totalElapsedMs: elapsedMs,
    solveInvocationCount,
    stages: [...stageProfiles.values()],
  };
  activePreanalysisAdditionIds = runner.getActivePreanalysisAdditionIds();

  return {
    result,
    effectiveExcludedIds: [...effectiveExclusions],
    activePreanalysisAdditionIds,
    effectiveClusterApprovedMerges: effectiveClusterMerges,
    droppedExclusions,
    droppedPreanalysisAdditions,
    droppedOverrides,
    droppedClusterMerges,
    inputChangedSinceLastRun,
    elapsedMs,
    profile,
  };
};
