import { startTransition, useCallback } from 'react';
import type { Dispatch, SetStateAction } from 'react';
import type { ClusterReviewDecision, ParseSettings, RunSettingsSnapshot } from '../appStateTypes';
import type {
  AdjustmentResult,
  ClusterApprovedMerge,
  ObservationOverride,
} from '../types';
import type { RunSessionOutcome } from '../engine/runSession';
import { buildAdjustmentResultFingerprint } from '../engine/adjustmentResultFingerprint';
import {
  buildExclusionDependencyFingerprint,
  isDeliverableRunMode,
  type AppliedRunIdentity,
} from '../engine/resultIntegrity';
import { noteUiPerfStage } from './useUiPerfMonitor';
import {
  buildRejectedClusterProposals,
  type ClusterCandidate,
  type RunReviewContext,
} from './useAdjustmentWorkflowClusters';

/** Payload fired once per successful production adjustment run for linked-F2F rerun sync. */
export type SuccessfulAdjustmentRunInfo = {
  result: AdjustmentResult;
  inputFingerprint: string;
  settingsFingerprint: string;
  /**
   * RunSettingsSnapshot.runMode behind the run; only 'adjustment' feeds
   * drafting. Optional so legacy/test callers without run context still
   * compile — absent is treated as unknown (never implicitly deliverable).
   */
  runMode?: string;
  /**
   * Authoritative result revision (adjustment-result/v1); the link stamps
   * this as sourceRevision. Optional so legacy/test callers without result
   * context still compile — absent falls back to the input:settings composite.
   */
  resultFingerprint?: string;
  /**
   * Phase 17E: the new result's dependency identity (== current identity
   * at fire time) for stamping synced F2F entities. Optional so
   * legacy/test callers still compile — absent means no stamping.
   */
  resultDependencyIdentity?: import('../engine/resultIntegrity').ResultDependencyIdentity | null;
};

export type ApplyRunOutcomeContext = {
  inputSnapshot: string;
  parseSettingsSnapshot: ParseSettings;
  settingsSnapshot: RunSettingsSnapshot;
  inputFingerprint: string;
  /** Deterministic fingerprint of the run settings snapshot; pairs with inputFingerprint in the F2F link sourceRevision. */
  settingsFingerprint: string;
  overrideIds: number[];
  reviewContext?: RunReviewContext;
  appliedRunIdentity: AppliedRunIdentity;
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
  setAppliedRunIdentity: (_value: AppliedRunIdentity | null) => void;
  activateReportTab: () => void;
  /**
   * Linked-F2F rerun seam (Bucket A2). Fired once per successful PRODUCTION
   * run (success && converged && mode='adjustment' && !preanalysisMode)
   * after the outcome is applied; never on failure, cancellation,
   * preanalysis, data-check, or blunder-detect runs. The subscriber derives linked-doc
   * updates via applyAdjustmentRerunToLinkedF2f (passing both fingerprints so
   * the link sourceRevision stays a true `<input>:<settings>` composite) and
   * commits the returned project as one atomic persisted-drawing update.
   * Top-level state cannot push CAD history entries — history is
   * workspace-local — so this is NOT a single undoable CAD transaction; the
   * workspace adopts it as the new history baseline (consistent with
   * replaceCadProject). Run history stays append-only: CAD undo never alters
   * recorded results, and re-running the adjustment re-derives the same sync.
   */
  onSuccessfulAdjustmentRun?: (_info: SuccessfulAdjustmentRunInfo) => void;
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
    appliedRunIdentity?: AppliedRunIdentity | null;
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
  setAppliedRunIdentity,
  activateReportTab,
  recordRunSnapshot,
  onSuccessfulAdjustmentRun,
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
      const droppedRunState =
        outcome.inputChangedSinceLastRun &&
        (outcome.droppedExclusions > 0 ||
          outcome.droppedPreanalysisAdditions > 0 ||
          outcome.droppedOverrides > 0 ||
          outcome.droppedClusterMerges > 0);
      if (droppedRunState) {
        solved.logs.unshift(
          `Input changed since previous run: cleared ${outcome.droppedExclusions} exclusion(s), ${outcome.droppedPreanalysisAdditions} preanalysis addition(s), ${outcome.droppedOverrides} override(s), and ${outcome.droppedClusterMerges} approved cluster merge(s).`,
        );
        setActivePreanalysisAdditionIds(new Set());
        setOverrides({});
        setClusterReviewDecisions({});
      }
      setLastRunInput(context.inputSnapshot);
      setLastRunSettingsSnapshot(context.settingsSnapshot);
      const effectiveOverridesForIdentity = droppedRunState ? {} : overrides;
      const effectiveAppliedIdentity: AppliedRunIdentity = {
        ...context.appliedRunIdentity,
        exclusionFingerprint: buildExclusionDependencyFingerprint({
          excludedIds: outcome.effectiveExcludedIds,
          overrides: effectiveOverridesForIdentity,
          activePreanalysisAdditionIds: outcome.activePreanalysisAdditionIds,
          approvedClusterMerges: outcome.effectiveClusterApprovedMerges,
        }),
      };
      setAppliedRunIdentity(effectiveAppliedIdentity);
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
        appliedRunIdentity: effectiveAppliedIdentity,
      });
      startTransition(() => {
        setActiveClusterApprovedMerges(outcome.effectiveClusterApprovedMerges);
        setRunDiagnostics(runProfile);
        setRunElapsedMs(outcome.elapsedMs);
      });
      if (
        solved.success &&
        solved.converged &&
        !solved.preanalysisMode &&
        isDeliverableRunMode(context.appliedRunIdentity?.runMode ?? '')
      ) {
        onSuccessfulAdjustmentRun?.({
          result: solved,
          inputFingerprint: context.inputFingerprint,
          settingsFingerprint: context.settingsFingerprint,
          runMode: context.appliedRunIdentity.runMode,
          resultFingerprint: buildAdjustmentResultFingerprint(solved),
          resultDependencyIdentity: effectiveAppliedIdentity,
        });
      }
      noteUiPerfStage('applyRunOutcomeComplete');
    },
    [
      activateReportTab,
      buildRunDiagnostics,
      clusterReviewDecisions,
      overrides,
      recordRunSnapshot,
      onSuccessfulAdjustmentRun,
      result?.clusterDiagnostics?.candidates,
      setActiveClusterApprovedMerges,
      setActivePreanalysisAdditionIds,
      setClusterReviewDecisions,
      setExcludedIds,
      setLastRunInput,
      setLastRunSettingsSnapshot,
      setAppliedRunIdentity,
      setOverrides,
      setResult,
      setRunDiagnostics,
      setRunElapsedMs,
    ],
  );
