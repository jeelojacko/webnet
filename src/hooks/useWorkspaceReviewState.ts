import { useCallback, useEffect } from 'react';
import type { DerivedQaResult } from '../engine/qaWorkflow';
import type { WorkspaceReviewState } from '../appStateTypes';
import {
  createDefaultReportViewSnapshot,
  useReportViewState,
} from './useReportViewState';
import { useQaSelection } from './useQaSelection';

interface UseWorkspaceReviewStateArgs {
  derivedResult: DerivedQaResult | null;
  result: unknown;
  excludedIds: Set<number>;
  initialSnapshot?: WorkspaceReviewState;
}

export const createDefaultWorkspaceReviewState = (): WorkspaceReviewState => ({
  reportView: createDefaultReportViewSnapshot(),
  selection: {
    stationId: null,
    observationId: null,
    sourceLine: null,
    origin: null,
  },
  pinnedObservationIds: [],
});

export const useWorkspaceReviewState = ({
  derivedResult,
  result,
  excludedIds,
  initialSnapshot,
}: UseWorkspaceReviewStateArgs) => {
  const report = useReportViewState({
    result,
    excludedIds,
    initialSnapshot: initialSnapshot?.reportView,
  });
  const qa = useQaSelection(derivedResult, {
    initialSelection: initialSnapshot?.selection,
    initialPinnedObservationIds: initialSnapshot?.pinnedObservationIds,
  });

  const {
    selection,
    pinnedObservationIds,
    clearSelection,
    clearPinnedObservations,
    restoreSelection,
    restorePinnedObservationIds,
  } = qa;

  useEffect(() => {
    if (!derivedResult) {
      clearSelection();
      clearPinnedObservations();
      return;
    }
    if (selection.observationId != null && !derivedResult.observationById.has(selection.observationId)) {
      clearSelection();
      return;
    }
    if (selection.stationId != null && !derivedResult.stationById.has(selection.stationId)) {
      clearSelection();
    }
  }, [clearPinnedObservations, clearSelection, derivedResult, selection.observationId, selection.stationId]);

  useEffect(() => {
    if (!derivedResult || pinnedObservationIds.length === 0) return;
    const nextPinnedIds = pinnedObservationIds.filter((id) => derivedResult.observationById.has(id));
    if (nextPinnedIds.length !== pinnedObservationIds.length) {
      restorePinnedObservationIds(nextPinnedIds);
    }
  }, [derivedResult, pinnedObservationIds, restorePinnedObservationIds]);

  const restoreSnapshot = useCallback(
    (snapshot: WorkspaceReviewState) => {
      report.restoreSnapshot(snapshot.reportView);
      restoreSelection(snapshot.selection);
      restorePinnedObservationIds(snapshot.pinnedObservationIds.slice());
    },
    [report, restorePinnedObservationIds, restoreSelection],
  );

  const resetState = useCallback(() => {
    report.resetState();
    clearSelection();
    clearPinnedObservations();
  }, [clearPinnedObservations, clearSelection, report]);

  const snapshot: WorkspaceReviewState = {
    reportView: report.snapshot,
    selection,
    pinnedObservationIds: pinnedObservationIds.slice(),
  };

  return {
    ...report,
    ...qa,
    snapshot,
    restoreSnapshot,
    resetState,
  };
};
