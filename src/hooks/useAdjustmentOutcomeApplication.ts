import { startTransition, useCallback } from 'react';
import type { Dispatch, SetStateAction } from 'react';
import type { ClusterReviewDecision, ParseSettings, RunSettingsSnapshot } from '../appStateTypes';
import type {
  AdjustmentResult,
  ClusterApprovedMerge,
  ObservationOverride,
} from '../types';
import type { RunSessionOutcome } from '../engine/runSession';
import { noteUiPerfStage } from './useUiPerfMonitor';
import {
  buildRejectedClusterProposals,
  type ClusterCandidate,
  type RunReviewContext,
} from './useAdjustmentWorkflowClusters';

export type ApplyRunOutcomeContext = {
  inputSnapshot: string;
  parseSettingsSnapshot: ParseSettings;
  settingsSnapshot: RunSettingsSnapshot;
  inputFingerprint: string;
  overrideIds: number[];
  reviewContext?: RunReviewContext;
};

interface UseAdjustmentOutcomeApplicationArgs<TRunDiagnostics> {
  result: AdjustmentResult | null;
  clusterReviewDecisions: Record<string, ClusterReviewDecision>;
  overrides: Record<number, ObservationOverride>;
  buildRunDiagnostics: (_parseSettings: ParseSettings, _solved: AdjustmentResult) => TRunDiagnostics;
  setExcludedIds: Dispatch<SetStateAction<Set<number>>>;
  setActivePreanalysisAdditionIds: Dispatch<SetStateAction<Set<string>>>;
  setOverrides: Dispatch<SetStateAction<Record<number, ObservationOverride>>>;
  setClusterReviewDecisions: Dispatch<SetStateAction<Record<string, ClusterReviewDecision>>>;
  setActiveClusterApprovedMerges: Dispatch<SetStateAction<ClusterApprovedMerge[]>>;
  setResult: (_value: AdjustmentResult | null) => void;
  setRunDiagnostics: (_value: TRunDiagnostics | null) => void;
  setRunElapsedMs: (_value: number | null) => void;
  setLastRunInput: (_value: string | null) => void;
  setLastRunSettingsSnapshot: (_value: RunSettingsSnapshot | null) => void;
  activateReportTab: () => void;
  recordRunSnapshot: (_snapshot: {
    result: AdjustmentResult;
    runDiagnostics: TRunDiagnostics;
    settingsSnapshot: RunSettingsSnapshot;
    inputFingerprint: string;
    excludedIds: number[];
    activePreanalysisAdditionIds: string[];
    overrideIds: number[];
    overrides: Record<number, ObservationOverride>;
    approvedClusterMerges: ClusterApprovedMerge[];
  }) => void;
}

const applyClusterReviewRejections = (
  solved: AdjustmentResult,
  candidates: ClusterCandidate[],
  decisions: Record<string, ClusterReviewDecision>,
): void => {
  if (!solved.clusterDiagnostics?.enabled) return;
  const rejected = buildRejectedClusterProposals(candidates, decisions);
  solved.clusterDiagnostics.rejectedProposals = rejected;
  if (rejected.length > 0) {
    solved.logs.unshift(`Cluster review: rejected proposals=${rejected.length}`);
  }
};

const prependRunProfileLogs = <TRunDiagnostics>(
  solved: AdjustmentResult,
  runProfile: TRunDiagnostics,
): void => {
  if ('parity' in (runProfile as object) && (runProfile as { parity?: boolean }).parity) {
    solved.logs.unshift(
      'Solve profile: Industry Standard parity (raw directions, classical weighting, industry default instrument fallback).',
    );
  }
  const runMode = (runProfile as { runMode?: string }).runMode;
  const plannedObservationCount =
    (runProfile as { plannedObservationCount?: number }).plannedObservationCount ?? 0;
  const preanalysisMode = (runProfile as { preanalysisMode?: boolean }).preanalysisMode ?? false;
  if (preanalysisMode) {
    solved.logs.unshift(
      `Run mode: preanalysis (planned observations=${plannedObservationCount}, residual-based QC disabled).`,
    );
  } else if (runMode && runMode !== 'adjustment') {
    solved.logs.unshift(`Run mode: ${runMode}.`);
  }
};

export const useAdjustmentOutcomeApplication = <TRunDiagnostics>({
  result,
  clusterReviewDecisions,
  overrides,
  buildRunDiagnostics,
  setExcludedIds,
  setActivePreanalysisAdditionIds,
  setOverrides,
  setClusterReviewDecisions,
  setActiveClusterApprovedMerges,
  setResult,
  setRunDiagnostics,
  setRunElapsedMs,
  setLastRunInput,
  setLastRunSettingsSnapshot,
  activateReportTab,
  recordRunSnapshot,
}: UseAdjustmentOutcomeApplicationArgs<TRunDiagnostics>) =>
  useCallback(
    (outcome: RunSessionOutcome, context: ApplyRunOutcomeContext) => {
      noteUiPerfStage('applyRunOutcomeStart');
      const solved = outcome.result;
      applyClusterReviewRejections(
        solved,
        context.reviewContext?.candidates ?? result?.clusterDiagnostics?.candidates ?? [],
        context.reviewContext?.decisions ?? clusterReviewDecisions,
      );
      const runProfile = buildRunDiagnostics(context.parseSettingsSnapshot, solved);
      prependRunProfileLogs(solved, runProfile);
      if (
        outcome.inputChangedSinceLastRun &&
        (outcome.droppedExclusions > 0 ||
          outcome.droppedPreanalysisAdditions > 0 ||
          outcome.droppedOverrides > 0 ||
          outcome.droppedClusterMerges > 0)
      ) {
        solved.logs.unshift(
          `Input changed since previous run: cleared ${outcome.droppedExclusions} exclusion(s), ${outcome.droppedPreanalysisAdditions} preanalysis addition(s), ${outcome.droppedOverrides} override(s), and ${outcome.droppedClusterMerges} approved cluster merge(s).`,
        );
        setActivePreanalysisAdditionIds(new Set());
        setOverrides({});
        setClusterReviewDecisions({});
      }
      setLastRunInput(context.inputSnapshot);
      setLastRunSettingsSnapshot(context.settingsSnapshot);
      setExcludedIds(new Set(outcome.effectiveExcludedIds));
      setActivePreanalysisAdditionIds(new Set(outcome.activePreanalysisAdditionIds));
      setResult(solved);
      activateReportTab();
      recordRunSnapshot({
        result: solved,
        runDiagnostics: runProfile,
        settingsSnapshot: context.settingsSnapshot,
        inputFingerprint: context.inputFingerprint,
        excludedIds: outcome.effectiveExcludedIds,
        activePreanalysisAdditionIds: outcome.activePreanalysisAdditionIds,
        overrideIds: context.overrideIds,
        overrides,
        approvedClusterMerges: outcome.effectiveClusterApprovedMerges,
      });
      startTransition(() => {
        setActiveClusterApprovedMerges(outcome.effectiveClusterApprovedMerges);
        setRunDiagnostics(runProfile);
        setRunElapsedMs(outcome.elapsedMs);
      });
      noteUiPerfStage('applyRunOutcomeComplete');
    },
    [
      activateReportTab,
      buildRunDiagnostics,
      clusterReviewDecisions,
      overrides,
      recordRunSnapshot,
      result?.clusterDiagnostics?.candidates,
      setActiveClusterApprovedMerges,
      setActivePreanalysisAdditionIds,
      setClusterReviewDecisions,
      setExcludedIds,
      setLastRunInput,
      setLastRunSettingsSnapshot,
      setOverrides,
      setResult,
      setRunDiagnostics,
      setRunElapsedMs,
    ],
  );
