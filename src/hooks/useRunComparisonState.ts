import { useCallback, useMemo, useRef, useState } from 'react';
import type { ClusterApprovedMerge, AdjustmentResult } from '../types';
import {
  buildRunSnapshotSummary,
  buildValueFingerprint,
  cloneSavedRunSnapshots,
  buildRunComparison,
  pushRunSnapshot,
  pushSavedRunSnapshot,
  resolveComparisonBaseline,
  type ComparisonSelection,
  type RunSnapshot,
  type SavedRunSnapshot,
} from '../engine/qaWorkflow';

interface RecordRunSnapshotArgs<TSettingsSnapshot, TRunDiagnostics> {
  result: AdjustmentResult;
  runDiagnostics: TRunDiagnostics;
  settingsSnapshot: TSettingsSnapshot;
  inputFingerprint: string;
  excludedIds: number[];
  overrideIds: number[];
  approvedClusterMerges: ClusterApprovedMerge[];
}

interface SaveCurrentRunSnapshotOptions {
  label?: string;
  notes?: string;
}

type SaveCurrentRunSnapshotResult<TSettingsSnapshot, TRunDiagnostics> =
  | {
      status: 'saved';
      snapshot: SavedRunSnapshot<TSettingsSnapshot, TRunDiagnostics>;
    }
  | {
      status: 'already-saved';
      snapshot: SavedRunSnapshot<TSettingsSnapshot, TRunDiagnostics>;
    }
  | {
      status: 'missing-current-run';
      snapshot: null;
    };

interface UseRunComparisonStateArgs<TSettingsSnapshot, TRunDiagnostics> {
  buildSettingDiffs: (
    _current: TSettingsSnapshot,
    _previous: TSettingsSnapshot | null,
  ) => string[];
  initialSavedRunSnapshots?: Array<SavedRunSnapshot<TSettingsSnapshot, TRunDiagnostics>>;
  savedRunSnapshotLimit?: number;
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
  initialSavedRunSnapshots = [],
  savedRunSnapshotLimit = 10,
  initialComparisonSelection = DEFAULT_COMPARISON_SELECTION,
}: UseRunComparisonStateArgs<TSettingsSnapshot, TRunDiagnostics>) => {
  const [runHistory, setRunHistory] = useState<Array<RunSnapshot<TSettingsSnapshot, TRunDiagnostics>>>(
    [],
  );
  const [savedRunSnapshots, setSavedRunSnapshots] = useState<
    Array<SavedRunSnapshot<TSettingsSnapshot, TRunDiagnostics>>
  >(() => cloneSavedRunSnapshots(initialSavedRunSnapshots));
  const [currentRunSnapshot, setCurrentRunSnapshot] =
    useState<RunSnapshot<TSettingsSnapshot, TRunDiagnostics> | null>(null);
  const [comparisonSelection, setComparisonSelection] = useState<ComparisonSelection>(
    initialComparisonSelection,
  );
  const runSnapshotCounterRef = useRef(1);
  const savedRunSnapshotCounterRef = useRef(
    Math.max(
      1,
      ...initialSavedRunSnapshots
        .map((snapshot) => {
          const match = snapshot.id.match(/^saved-run-(\d+)$/);
          return match ? Number.parseInt(match[1], 10) + 1 : 1;
        })
        .filter((value) => Number.isFinite(value)),
    ),
  );

  const baselineRunSnapshot = useMemo(
    () => resolveComparisonBaseline(runHistory, currentRunSnapshot, comparisonSelection),
    [comparisonSelection, currentRunSnapshot, runHistory],
  );
  const currentSavedRunSnapshot = useMemo(
    () =>
      currentRunSnapshot
        ? savedRunSnapshots.find((entry) => entry.sourceRunId === currentRunSnapshot.id) ?? null
        : null,
    [currentRunSnapshot, savedRunSnapshots],
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
  }, [setComparisonSelection, setCurrentRunSnapshot, setRunHistory]);

  const recordRunSnapshot = useCallback(
    ({
      result,
      runDiagnostics,
      settingsSnapshot,
      inputFingerprint,
      excludedIds,
      overrideIds,
      approvedClusterMerges,
    }: RecordRunSnapshotArgs<TSettingsSnapshot, TRunDiagnostics>) => {
      const nextSnapshot: RunSnapshot<TSettingsSnapshot, TRunDiagnostics> = {
        id: `run-${runSnapshotCounterRef.current}`,
        createdAt: new Date().toISOString(),
        label: `Run ${runSnapshotCounterRef.current.toString().padStart(2, '0')}`,
        inputFingerprint,
        settingsFingerprint: buildValueFingerprint(settingsSnapshot),
        summary: buildRunSnapshotSummary(result),
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
    [setComparisonSelection, setCurrentRunSnapshot, setRunHistory],
  );

  const restoreSavedRunSnapshots = useCallback(
    (snapshots: Array<SavedRunSnapshot<TSettingsSnapshot, TRunDiagnostics>>) => {
      setSavedRunSnapshots(cloneSavedRunSnapshots(snapshots));
      savedRunSnapshotCounterRef.current = Math.max(
        1,
        ...snapshots
          .map((snapshot) => {
            const match = snapshot.id.match(/^saved-run-(\d+)$/);
            return match ? Number.parseInt(match[1], 10) + 1 : 1;
          })
          .filter((value) => Number.isFinite(value)),
      );
    },
    [setSavedRunSnapshots],
  );

  const clearSavedRunSnapshots = useCallback(() => {
    setSavedRunSnapshots([]);
  }, [setSavedRunSnapshots]);

  const removeSavedRunSnapshot = useCallback((snapshotId: string) => {
    setSavedRunSnapshots((prev) => prev.filter((entry) => entry.id !== snapshotId));
  }, [setSavedRunSnapshots]);

  const saveCurrentRunSnapshot = useCallback(
    (
      options: SaveCurrentRunSnapshotOptions = {},
    ): SaveCurrentRunSnapshotResult<TSettingsSnapshot, TRunDiagnostics> => {
      if (!currentRunSnapshot) return { status: 'missing-current-run', snapshot: null };

      const existingSnapshot =
        savedRunSnapshots.find((entry) => entry.sourceRunId === currentRunSnapshot.id) ?? null;
      if (existingSnapshot) {
        return {
          status: 'already-saved',
          snapshot: existingSnapshot,
        };
      }

      const nextSavedSnapshot: SavedRunSnapshot<TSettingsSnapshot, TRunDiagnostics> = {
        ...currentRunSnapshot,
        id: `saved-run-${savedRunSnapshotCounterRef.current}`,
        label: options.label?.trim() || `Saved ${currentRunSnapshot.label}`,
        sourceRunId: currentRunSnapshot.id,
        savedAt: new Date().toISOString(),
        notes: options.notes?.trim() ?? '',
      };
      savedRunSnapshotCounterRef.current += 1;
      setSavedRunSnapshots((prev) =>
        pushSavedRunSnapshot(prev, nextSavedSnapshot, savedRunSnapshotLimit),
      );
      return {
        status: 'saved',
        snapshot: nextSavedSnapshot,
      };
    },
    [currentRunSnapshot, savedRunSnapshotLimit, savedRunSnapshots, setSavedRunSnapshots],
  );

  return {
    runHistory,
    savedRunSnapshots,
    currentRunSnapshot,
    currentSavedRunSnapshot,
    comparisonSelection,
    setComparisonSelection,
    baselineRunSnapshot,
    comparisonSettingDiffs,
    runComparisonSummary,
    clearRunComparisonState,
    restoreSavedRunSnapshots,
    clearSavedRunSnapshots,
    removeSavedRunSnapshot,
    saveCurrentRunSnapshot,
    recordRunSnapshot,
  };
};
