import { useCallback, useMemo, useRef, useState } from 'react';
import type { ClusterApprovedMerge, AdjustmentResult } from '../types';
import {
  buildRunComparison,
  pushRunSnapshot,
  resolveComparisonBaseline,
  type ComparisonSelection,
  type RunSnapshot,
} from '../engine/qaWorkflow';

interface RecordRunSnapshotArgs<TSettingsSnapshot, TRunDiagnostics> {
  result: AdjustmentResult;
  runDiagnostics: TRunDiagnostics;
  settingsSnapshot: TSettingsSnapshot;
  excludedIds: number[];
  overrideIds: number[];
  approvedClusterMerges: ClusterApprovedMerge[];
}

interface UseRunComparisonStateArgs<TSettingsSnapshot, TRunDiagnostics> {
  buildSettingDiffs: (
    _current: TSettingsSnapshot,
    _previous: TSettingsSnapshot | null,
  ) => string[];
  initialComparisonSelection?: ComparisonSelection;
}

const DEFAULT_COMPARISON_SELECTION: ComparisonSelection = {
  baselineRunId: null,
  pinnedBaselineRunId: null,
  stationMovementThreshold: 0.001,
  residualDeltaThreshold: 0.25,
};

export const useRunComparisonState = <TSettingsSnapshot, TRunDiagnostics>({
  buildSettingDiffs,
  initialComparisonSelection = DEFAULT_COMPARISON_SELECTION,
}: UseRunComparisonStateArgs<TSettingsSnapshot, TRunDiagnostics>) => {
  const [runHistory, setRunHistory] = useState<Array<RunSnapshot<TSettingsSnapshot, TRunDiagnostics>>>(
    [],
  );
  const [currentRunSnapshot, setCurrentRunSnapshot] =
    useState<RunSnapshot<TSettingsSnapshot, TRunDiagnostics> | null>(null);
  const [comparisonSelection, setComparisonSelection] = useState<ComparisonSelection>(
    initialComparisonSelection,
  );
  const runSnapshotCounterRef = useRef(1);

  const baselineRunSnapshot = useMemo(
    () => resolveComparisonBaseline(runHistory, currentRunSnapshot, comparisonSelection),
    [comparisonSelection, currentRunSnapshot, runHistory],
  );

  const comparisonSettingDiffs = useMemo(() => {
    if (!currentRunSnapshot || !baselineRunSnapshot) return [];
    return buildSettingDiffs(
      currentRunSnapshot.settingsSnapshot,
      baselineRunSnapshot.settingsSnapshot,
    );
  }, [baselineRunSnapshot, buildSettingDiffs, currentRunSnapshot]);

  const runComparisonSummary = useMemo(() => {
    if (!currentRunSnapshot || !baselineRunSnapshot) return null;
    return buildRunComparison(
      currentRunSnapshot,
      baselineRunSnapshot,
      comparisonSelection,
      comparisonSettingDiffs,
    );
  }, [baselineRunSnapshot, comparisonSelection, comparisonSettingDiffs, currentRunSnapshot]);

  const clearRunComparisonState = useCallback(() => {
    setRunHistory([]);
    setCurrentRunSnapshot(null);
    setComparisonSelection((prev) => ({
      ...prev,
      baselineRunId: null,
      pinnedBaselineRunId: null,
    }));
  }, []);

  const recordRunSnapshot = useCallback(
    ({
      result,
      runDiagnostics,
      settingsSnapshot,
      excludedIds,
      overrideIds,
      approvedClusterMerges,
    }: RecordRunSnapshotArgs<TSettingsSnapshot, TRunDiagnostics>) => {
      const nextSnapshot: RunSnapshot<TSettingsSnapshot, TRunDiagnostics> = {
        id: `run-${runSnapshotCounterRef.current}`,
        createdAt: new Date().toISOString(),
        label: `Run ${runSnapshotCounterRef.current.toString().padStart(2, '0')}`,
        result,
        runDiagnostics,
        settingsSnapshot,
        excludedIds: excludedIds.slice().sort((a, b) => a - b),
        overrideIds: overrideIds.slice().sort((a, b) => a - b),
        approvedClusterMerges: approvedClusterMerges.map((merge) => ({ ...merge })),
      };
      runSnapshotCounterRef.current += 1;
      setCurrentRunSnapshot(nextSnapshot);
      setRunHistory((prev) => {
        const nextHistory = pushRunSnapshot(prev, nextSnapshot);
        setComparisonSelection((currentSelection) => {
          if (
            !currentSelection.pinnedBaselineRunId &&
            !currentSelection.baselineRunId &&
            nextHistory.length > 1
          ) {
            return {
              ...currentSelection,
              baselineRunId: nextHistory[1]?.id ?? null,
            };
          }
          const availableIds = new Set(nextHistory.map((entry) => entry.id));
          return {
            ...currentSelection,
            baselineRunId:
              currentSelection.baselineRunId && !availableIds.has(currentSelection.baselineRunId)
                ? nextHistory.find((entry) => entry.id !== nextSnapshot.id)?.id ?? null
                : currentSelection.baselineRunId,
            pinnedBaselineRunId:
              currentSelection.pinnedBaselineRunId &&
              !availableIds.has(currentSelection.pinnedBaselineRunId)
                ? null
                : currentSelection.pinnedBaselineRunId,
          };
        });
        return nextHistory;
      });
      return nextSnapshot;
    },
    [],
  );

  return {
    runHistory,
    currentRunSnapshot,
    comparisonSelection,
    setComparisonSelection,
    baselineRunSnapshot,
    comparisonSettingDiffs,
    runComparisonSummary,
    clearRunComparisonState,
    recordRunSnapshot,
  };
};
