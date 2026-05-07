import { useCallback, useMemo, type Dispatch, type SetStateAction } from 'react';
import type { WorkspaceTabKey } from '../appStateTypes';

interface ComparisonSelectionState {
  baselineRunId: string | null;
  pinnedBaselineRunId: string | null;
  stationMovementThreshold: number;
  residualDeltaThreshold: number;
}

interface UseAppRunComparisonPanelArgs {
  lastRunInput: string | null;
  handleEditorInputChange: (_value: string) => void;
  clearWorkspaceArtifacts: () => void;
  resetImportReviewWorkflow: () => void;
  resetAdjustmentWorkflowState: () => void;
  clearRunComparisonState: () => void;
  resetWorkspaceReviewState: () => void;
  clearCurrentDraft: () => void;
  setImportNotice: Dispatch<
    SetStateAction<{ title: string; detailLines: string[] } | null>
  >;
  currentRunSnapshot: { id: string } | null;
  savedRunSnapshots: Array<{ id: string }>;
  saveCurrentRunSnapshot: (_args?: {
    reopenState: import('../engine/qaWorkflow').SavedRunWorkspaceState;
  }) =>
    | {
        status: 'saved';
        snapshot: { label: string };
      }
    | {
        status: 'already-saved';
        snapshot: { label: string };
      }
    | {
        status: 'missing-current-run';
        snapshot: null;
      };
  buildSavedRunReopenState: () => import('../engine/qaWorkflow').SavedRunWorkspaceState;
  setComparisonSelection: Dispatch<SetStateAction<ComparisonSelectionState>>;
  renameSavedRunSnapshot: (_snapshotId: string, _label: string) => void;
  updateSavedRunSnapshotNotes: (_snapshotId: string, _notes: string) => void;
  removeSavedRunSnapshot: (_snapshotId: string) => void;
  baselineRunSnapshot: { id: string } | null;
  selectStation: (_stationId: string, _origin: 'compare') => void;
  selectObservation: (_observationId: number, _origin: 'compare') => void;
  setActiveTab: Dispatch<SetStateAction<WorkspaceTabKey>>;
}

export const useAppRunComparisonPanel = ({
  lastRunInput,
  handleEditorInputChange,
  clearWorkspaceArtifacts,
  resetImportReviewWorkflow,
  resetAdjustmentWorkflowState,
  clearRunComparisonState,
  resetWorkspaceReviewState,
  clearCurrentDraft,
  setImportNotice,
  currentRunSnapshot,
  savedRunSnapshots,
  saveCurrentRunSnapshot,
  buildSavedRunReopenState,
  setComparisonSelection,
  renameSavedRunSnapshot,
  updateSavedRunSnapshotNotes,
  removeSavedRunSnapshot,
  baselineRunSnapshot,
  selectStation,
  selectObservation,
  setActiveTab,
}: UseAppRunComparisonPanelArgs) => {
  const showRunComparisonPanel = useMemo(
    () => Boolean(currentRunSnapshot || savedRunSnapshots.length > 0),
    [currentRunSnapshot, savedRunSnapshots.length],
  );

  const handleResetToLastRun = useCallback(() => {
    if (lastRunInput != null) handleEditorInputChange(lastRunInput);
    clearWorkspaceArtifacts();
    resetImportReviewWorkflow();
    resetAdjustmentWorkflowState();
    clearRunComparisonState();
    resetWorkspaceReviewState();
  }, [
    clearRunComparisonState,
    clearWorkspaceArtifacts,
    handleEditorInputChange,
    lastRunInput,
    resetAdjustmentWorkflowState,
    resetImportReviewWorkflow,
    resetWorkspaceReviewState,
  ]);

  const handleClearCurrentDraft = useCallback(() => {
    clearCurrentDraft();
    setImportNotice({
      title: 'Local draft cleared',
      detailLines: ['Browser-local draft recovery data was cleared for the current workspace.'],
    });
  }, [clearCurrentDraft, setImportNotice]);

  const handleSaveCurrentSnapshot = useCallback(() => {
    const saveOutcome = saveCurrentRunSnapshot({
      reopenState: buildSavedRunReopenState(),
    });
    if (saveOutcome.status === 'saved') {
      setImportNotice({
        title: 'Run snapshot saved',
        detailLines: [
          `Stored ${saveOutcome.snapshot.label}.`,
          'Saved run snapshots persist in browser recovery and portable project exports.',
        ],
      });
      return;
    }
    if (saveOutcome.status === 'missing-current-run') return;
    setImportNotice({
      title: 'Run snapshot already saved',
      detailLines: [`${saveOutcome.snapshot.label} is already in the saved-run list.`],
    });
  }, [buildSavedRunReopenState, saveCurrentRunSnapshot, setImportNotice]);

  const handleCompareWithSavedRun = useCallback(
    (snapshotId: string) =>
      setComparisonSelection((prev) => ({
        ...prev,
        baselineRunId: snapshotId,
        pinnedBaselineRunId: null,
      })),
    [setComparisonSelection],
  );

  const handleRenameSavedRun = useCallback(
    (snapshotId: string, label: string) => renameSavedRunSnapshot(snapshotId, label),
    [renameSavedRunSnapshot],
  );

  const handleUpdateSavedRunNotes = useCallback(
    (snapshotId: string, notes: string) => updateSavedRunSnapshotNotes(snapshotId, notes),
    [updateSavedRunSnapshotNotes],
  );

  const handleDeleteSavedRun = useCallback(
    (snapshotId: string) => removeSavedRunSnapshot(snapshotId),
    [removeSavedRunSnapshot],
  );

  const handleSelectBaseline = useCallback(
    (snapshotId: string | null) =>
      setComparisonSelection((prev) => ({
        ...prev,
        baselineRunId: snapshotId || null,
      })),
    [setComparisonSelection],
  );

  const handleTogglePinBaseline = useCallback(
    () =>
      setComparisonSelection((prev) => ({
        ...prev,
        pinnedBaselineRunId:
          baselineRunSnapshot && prev.pinnedBaselineRunId !== baselineRunSnapshot.id
            ? baselineRunSnapshot.id
            : null,
      })),
    [baselineRunSnapshot, setComparisonSelection],
  );

  const handleStationThresholdChange = useCallback(
    (value: number) =>
      setComparisonSelection((prev) => ({
        ...prev,
        stationMovementThreshold: value,
      })),
    [setComparisonSelection],
  );

  const handleResidualThresholdChange = useCallback(
    (value: number) =>
      setComparisonSelection((prev) => ({
        ...prev,
        residualDeltaThreshold: value,
      })),
    [setComparisonSelection],
  );

  const handleCompareSelectStation = useCallback(
    (stationId: string) => {
      selectStation(stationId, 'compare');
      setActiveTab('map');
    },
    [selectStation, setActiveTab],
  );

  const handleCompareSelectObservation = useCallback(
    (observationId: number) => {
      selectObservation(observationId, 'compare');
      setActiveTab('report');
    },
    [selectObservation, setActiveTab],
  );

  return {
    showRunComparisonPanel,
    handleResetToLastRun,
    handleClearCurrentDraft,
    handleSaveCurrentSnapshot,
    handleCompareWithSavedRun,
    handleRenameSavedRun,
    handleUpdateSavedRunNotes,
    handleDeleteSavedRun,
    handleSelectBaseline,
    handleTogglePinBaseline,
    handleStationThresholdChange,
    handleResidualThresholdChange,
    handleCompareSelectStation,
    handleCompareSelectObservation,
  };
};
