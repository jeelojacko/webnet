import {
  startTransition,
  useCallback,
  useEffect,
  useMemo,
  useState,
  type Dispatch,
  type SetStateAction,
} from 'react';
import { deepClonePlain } from '../engine/plainData';
import {
  buildValueFingerprint,
  cloneSavedRunSnapshots,
  type ComparisonSelection,
  type SavedRunReviewState,
  type SavedRunSnapshot,
  type SavedRunWorkspaceState,
} from '../engine/qaWorkflow';
import { buildQaDerivedResult, type DerivedQaResult } from '../engine/qaWorkflow';
import type {
  RunDiagnostics,
  RunSettingsSnapshot,
  WorkspaceReviewState,
  WorkspaceTabKey,
} from '../appStateTypes';
import type { AdjustmentResult, ClusterApprovedMerge, ObservationOverride } from '../types';
import {
  createDefaultWorkspaceReviewState,
  useWorkspaceReviewState,
} from './useWorkspaceReviewState';
import type { ProjectRunFile } from '../engine/projectWorkspace';
import { measureUiPerfBlock } from './useUiPerfMonitor';

interface PipelineStateLike {
  status: 'idle' | 'running' | 'failed' | 'cancelled';
  phase?: 'queued' | 'solving' | 'finalizing' | string | null;
}

interface UseAppRunWorkspaceReviewArgs {
  result: AdjustmentResult | null;
  excludedIds: Set<number>;
  projectRunValidationOk: boolean;
  pendingRunSettingDiffs: string[];
  pipelineState: PipelineStateLike;
  lastRunInput: string | null;
  effectiveRunInput: string;
  activeTab: WorkspaceTabKey;
  comparisonSelection: ComparisonSelection;
  activeProjectRunFiles: ProjectRunFile[];
  effectiveRunIncludeFiles: Record<string, string>;
  runComparisonSummary: ReturnType<typeof import('../engine/qaWorkflow').buildRunComparison> | null;
  restoreSavedRunSnapshot: (
    _snapshotId: string,
  ) => SavedRunSnapshot<RunSettingsSnapshot, RunDiagnostics> | null;
  restoreAdjustmentWorkflowState: (_state: {
    result: AdjustmentResult;
    excludedIds: number[];
    activePreanalysisAdditionIds: string[];
    overrides: Record<number, ObservationOverride>;
    approvedClusterMerges: ClusterApprovedMerge[];
  }) => void;
  setResult: Dispatch<SetStateAction<AdjustmentResult | null>>;
  setRunDiagnostics: Dispatch<SetStateAction<RunDiagnostics | null>>;
  setRunElapsedMs: Dispatch<SetStateAction<number | null>>;
  setPendingEditorJumpLine: Dispatch<SetStateAction<number | null>>;
  setLastRunInput: Dispatch<SetStateAction<string | null>>;
  setLastRunSettingsSnapshot: Dispatch<SetStateAction<RunSettingsSnapshot | null>>;
  setImportNotice: Dispatch<
    SetStateAction<{ title: string; detailLines: string[] } | null>
  >;
  setActiveTab: Dispatch<SetStateAction<WorkspaceTabKey>>;
}

export const useAppRunWorkspaceReview = ({
  result,
  excludedIds,
  projectRunValidationOk,
  pendingRunSettingDiffs,
  pipelineState,
  lastRunInput,
  effectiveRunInput,
  activeTab,
  comparisonSelection,
  activeProjectRunFiles,
  effectiveRunIncludeFiles,
  restoreSavedRunSnapshot,
  restoreAdjustmentWorkflowState,
  setResult,
  setRunDiagnostics,
  setRunElapsedMs,
  setPendingEditorJumpLine,
  setLastRunInput,
  setLastRunSettingsSnapshot,
  setImportNotice,
  setActiveTab,
}: UseAppRunWorkspaceReviewArgs) => {
  const [qaDerivedResult, setQaDerivedResult] = useState<DerivedQaResult | null>(null);
  const [qaDerivedReady, setQaDerivedReady] = useState(false);

  useEffect(() => {
    if (!result) {
      setQaDerivedResult(null);
      setQaDerivedReady(false);
      return undefined;
    }
    setQaDerivedResult(null);
    setQaDerivedReady(false);
    let cancelled = false;
    const handle = globalThis.setTimeout(() => {
      if (cancelled) return;
      const nextDerived = measureUiPerfBlock('buildQaDerivedResult', () =>
        buildQaDerivedResult(result),
      );
      startTransition(() => {
        if (cancelled) return;
        setQaDerivedResult(nextDerived);
        setQaDerivedReady(true);
      });
    }, 0);
    return () => {
      cancelled = true;
      globalThis.clearTimeout(handle);
    };
  }, [result]);

  const workspaceReviewState = useWorkspaceReviewState({
    derivedResult: qaDerivedResult,
    derivedResultReady: qaDerivedReady,
    result,
    excludedIds,
  });
  const {
    selection,
    selectObservation,
    selectStation,
    snapshot: workspaceReviewSnapshot,
    restoreSnapshot: restoreWorkspaceReviewSnapshot,
  } = workspaceReviewState;

  const handleWorkspaceTabChange = useCallback(
    (tab: WorkspaceTabKey) => {
      setActiveTab(tab);
    },
    [setActiveTab],
  );
  const handleReportStationSelection = useCallback(
    (stationId: string) => {
      selectStation(stationId, 'report');
    },
    [selectStation],
  );
  const handleReportObservationSelection = useCallback(
    (observationId: number) => {
      selectObservation(observationId, 'report');
    },
    [selectObservation],
  );
  const handleMapStationSelection = useCallback(
    (stationId: string) => {
      selectStation(stationId, 'map');
    },
    [selectStation],
  );
  const handleMapObservationSelection = useCallback(
    (observationId: number) => {
      selectObservation(observationId, 'map');
    },
    [selectObservation],
  );

  const blockingReasons = useMemo(() => {
    const reasons: string[] = [];
    if (!projectRunValidationOk) reasons.push('Select at least one checked project file');
    if (pendingRunSettingDiffs.length > 0) {
      reasons.push(`${pendingRunSettingDiffs.length} setting change(s) pending rerun`);
    }
    if (pipelineState.status === 'running') reasons.push('Run in progress');
    return reasons;
  }, [pendingRunSettingDiffs.length, pipelineState.status, projectRunValidationOk]);
  const runFreshness = useMemo(() => {
    if (pipelineState.status === 'running') return 'running' as const;
    if (selection.observationId != null || selection.stationId != null) return 'reviewing' as const;
    if (result && lastRunInput !== effectiveRunInput) return 'result-stale' as const;
    if (pendingRunSettingDiffs.length > 0) return 'dirty-needs-rerun' as const;
    return 'ready' as const;
  }, [
    effectiveRunInput,
    lastRunInput,
    pendingRunSettingDiffs.length,
    pipelineState.status,
    result,
    selection.observationId,
    selection.stationId,
  ]);
  const persistedWorkspaceReviewSnapshot = useMemo(
    () => ({
      ...workspaceReviewSnapshot,
      runFreshness,
      blockingReasons: blockingReasons.slice(),
    }),
    [blockingReasons, runFreshness, workspaceReviewSnapshot],
  );
  const buildSavedRunReopenState = useCallback(
    (): SavedRunWorkspaceState => ({
      activeTab,
      review: deepClonePlain(persistedWorkspaceReviewSnapshot),
      comparisonSelection: { ...comparisonSelection },
    }),
    [activeTab, comparisonSelection, persistedWorkspaceReviewSnapshot],
  );
  const buildWorkspaceReviewStateFromSavedRun = useCallback(
    (savedReview: SavedRunReviewState): WorkspaceReviewState => {
      const defaults = createDefaultWorkspaceReviewState();
      return {
        reportView: {
          ...defaults.reportView,
          ...savedReview.reportView,
          reportObservationTypeFilter: savedReview.reportView
            .reportObservationTypeFilter as WorkspaceReviewState['reportView']['reportObservationTypeFilter'],
          tableRowLimits: { ...savedReview.reportView.tableRowLimits },
          pinnedDetailSections: savedReview.reportView
            .pinnedDetailSections as WorkspaceReviewState['reportView']['pinnedDetailSections'],
          collapsedDetailSections: {
            ...defaults.reportView.collapsedDetailSections,
            ...(savedReview.reportView.collapsedDetailSections as Partial<
              WorkspaceReviewState['reportView']['collapsedDetailSections']
            >),
          },
        },
        selection: { ...savedReview.selection },
        pinnedObservationIds: savedReview.pinnedObservationIds.slice(),
        runFreshness: 'ready',
        blockingReasons: [],
      };
    },
    [],
  );

  const handleRestoreSavedRun = useCallback(
    (snapshotId: string) => {
      const restoredSnapshot = restoreSavedRunSnapshot(snapshotId);
      if (!restoredSnapshot) return;
      const restoredResult = cloneSavedRunSnapshots([restoredSnapshot])[0].result;
      const activeInputFingerprint = buildValueFingerprint({
        input: effectiveRunInput,
        runFiles: activeProjectRunFiles,
        includeFiles: effectiveRunIncludeFiles,
      });
      setResult(restoredResult);
      setRunDiagnostics(restoredSnapshot.runDiagnostics);
      setRunElapsedMs(null);
      setPendingEditorJumpLine(null);
      setLastRunInput(
        restoredSnapshot.inputFingerprint === activeInputFingerprint ? effectiveRunInput : null,
      );
      setLastRunSettingsSnapshot(restoredSnapshot.settingsSnapshot);
      restoreAdjustmentWorkflowState({
        result: restoredResult,
        excludedIds: restoredSnapshot.excludedIds,
        activePreanalysisAdditionIds: restoredSnapshot.activePreanalysisAdditionIds ?? [],
        overrides: restoredSnapshot.overrides,
        approvedClusterMerges: restoredSnapshot.approvedClusterMerges,
      });
      restoreWorkspaceReviewSnapshot(
        restoredSnapshot.reopenState
          ? buildWorkspaceReviewStateFromSavedRun(restoredSnapshot.reopenState.review)
          : createDefaultWorkspaceReviewState(),
      );
      setActiveTab(restoredSnapshot.reopenState?.activeTab ?? 'report');
      setImportNotice({
        title: 'Saved run restored',
        detailLines:
          restoredSnapshot.inputFingerprint === activeInputFingerprint
            ? [
                `Reopened ${restoredSnapshot.label}.`,
                'Result, review state, and compare thresholds were restored from the saved snapshot.',
              ]
            : [
                `Reopened ${restoredSnapshot.label}.`,
                'Result and review state were restored, but the current editor input differs from the saved run fingerprint. Rerun before reusing exclusions or compare baselines for new edits.',
              ],
      });
    },
    [
      activeProjectRunFiles,
      buildWorkspaceReviewStateFromSavedRun,
      effectiveRunIncludeFiles,
      effectiveRunInput,
      restoreAdjustmentWorkflowState,
      restoreSavedRunSnapshot,
      restoreWorkspaceReviewSnapshot,
      setActiveTab,
      setImportNotice,
      setLastRunInput,
      setLastRunSettingsSnapshot,
      setPendingEditorJumpLine,
      setResult,
      setRunDiagnostics,
      setRunElapsedMs,
    ],
  );

  const runPhaseLabel = useMemo(() => {
    if (pipelineState.status === 'running') {
      if (pipelineState.phase === 'queued') return 'Queued';
      if (pipelineState.phase === 'solving') return 'Solving';
      if (pipelineState.phase === 'finalizing') return 'Finalizing';
      return 'Running';
    }
    if (pipelineState.status === 'cancelled') return 'Cancelled';
    if (pipelineState.status === 'failed') return 'Failed';
    return null;
  }, [pipelineState.phase, pipelineState.status]);

  return {
    qaDerivedResult,
    workspaceReviewState,
    selection,
    workspaceReviewSnapshot,
    restoreWorkspaceReviewSnapshot,
    handleWorkspaceTabChange,
    handleReportStationSelection,
    handleReportObservationSelection,
    handleMapStationSelection,
    handleMapObservationSelection,
    blockingReasons,
    runFreshness,
    persistedWorkspaceReviewSnapshot,
    buildSavedRunReopenState,
    handleRestoreSavedRun,
    runPhaseLabel,
  };
};
