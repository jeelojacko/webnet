import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { deepClonePlain } from '../engine/plainData';
import {
  buildComparisonCandidateSnapshots,
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
import {
  DEFAULT_COMPARISON_SELECTION,
  sanitizeComparisonSelection,
} from './useRunComparisonState.selection';
import type {
  RecordRunSnapshotArgs,
  SaveCurrentRunSnapshotOptions,
  SaveCurrentRunSnapshotResult,
  UseRunComparisonStateArgs,
} from './useRunComparisonState.types';

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
  const savedRunSnapshotsRef = useRef(savedRunSnapshots);
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

  const comparisonCandidates = useMemo(
    () => buildComparisonCandidateSnapshots(runHistory, savedRunSnapshots, currentRunSnapshot),
    [currentRunSnapshot, runHistory, savedRunSnapshots],
  );
  useEffect(() => {
    savedRunSnapshotsRef.current = savedRunSnapshots;
  }, [savedRunSnapshots]);
  const baselineRunSnapshot = useMemo(
    () =>
      resolveComparisonBaseline(
        runHistory,
        savedRunSnapshots,
        currentRunSnapshot,
        comparisonSelection,
      ),
    [comparisonSelection, currentRunSnapshot, runHistory, savedRunSnapshots],
  );
  const currentSavedRunSnapshot = useMemo(
    () => {
      if (!currentRunSnapshot) return null;
      const byId = savedRunSnapshots.find((entry) => entry.id === currentRunSnapshot.id) ?? null;
      if (byId) return byId;
      return (
        savedRunSnapshots.find((entry) => entry.sourceRunId === currentRunSnapshot.id) ?? null
      );
    },
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
      activePreanalysisAdditionIds,
      overrideIds,
      overrides,
      approvedClusterMerges,
      reopenState = null,
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
        activePreanalysisAdditionIds: (activePreanalysisAdditionIds ?? [])
          .slice()
          .sort((a, b) => a.localeCompare(b, undefined, { numeric: true })),
        overrideIds: overrideIds.slice().sort((a, b) => a - b),
        overrides: deepClonePlain(overrides),
        approvedClusterMerges: approvedClusterMerges.map((merge) => ({ ...merge })),
        reopenState: reopenState ? deepClonePlain(reopenState) : null,
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
          const availableIds = new Set(
            buildComparisonCandidateSnapshots(
              nextHistory,
              savedRunSnapshotsRef.current,
              nextSnapshot,
            ).map(
              (entry) => entry.id,
            ),
          );
          const sanitizedSelection = sanitizeComparisonSelection(
            currentSelection,
            availableIds,
          );
          return {
            ...sanitizedSelection,
            baselineRunId:
              sanitizedSelection.baselineRunId ??
              buildComparisonCandidateSnapshots(
                nextHistory,
                savedRunSnapshotsRef.current,
                nextSnapshot,
              )[0]?.id ??
              null,
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
      const nextSnapshots = cloneSavedRunSnapshots(snapshots);
      setSavedRunSnapshots(nextSnapshots);
      savedRunSnapshotCounterRef.current = Math.max(
        1,
        ...snapshots
          .map((snapshot) => {
            const match = snapshot.id.match(/^saved-run-(\d+)$/);
            return match ? Number.parseInt(match[1], 10) + 1 : 1;
          })
          .filter((value) => Number.isFinite(value)),
      );
      setComparisonSelection((prev) => {
        const availableIds = new Set(
          buildComparisonCandidateSnapshots(runHistory, nextSnapshots, currentRunSnapshot).map(
            (entry) => entry.id,
          ),
        );
        return sanitizeComparisonSelection(prev, availableIds);
      });
    },
    [currentRunSnapshot, runHistory, setComparisonSelection, setSavedRunSnapshots],
  );

  const clearSavedRunSnapshots = useCallback(() => {
    setSavedRunSnapshots([]);
    setComparisonSelection((prev) => {
      const availableIds = new Set(
        buildComparisonCandidateSnapshots(runHistory, [], currentRunSnapshot).map(
          (entry) => entry.id,
        ),
      );
      return sanitizeComparisonSelection(prev, availableIds);
    });
  }, [currentRunSnapshot, runHistory, setComparisonSelection, setSavedRunSnapshots]);

  const removeSavedRunSnapshot = useCallback((snapshotId: string) => {
    setSavedRunSnapshots((prev) => {
      const nextSnapshots = prev.filter((entry) => entry.id !== snapshotId);
      setComparisonSelection((currentSelection) => {
        const availableIds = new Set(
          buildComparisonCandidateSnapshots(runHistory, nextSnapshots, currentRunSnapshot).map(
            (entry) => entry.id,
          ),
        );
        return sanitizeComparisonSelection(currentSelection, availableIds);
      });
      return nextSnapshots;
    });
    setCurrentRunSnapshot((prev) => (prev?.id === snapshotId ? null : prev));
  }, [currentRunSnapshot, runHistory, setComparisonSelection, setCurrentRunSnapshot, setSavedRunSnapshots]);

  const renameSavedRunSnapshot = useCallback((snapshotId: string, label: string) => {
    const nextLabel = label.trim();
    if (!nextLabel) return;
    setSavedRunSnapshots((prev) =>
      prev.map((entry) => (entry.id === snapshotId ? { ...entry, label: nextLabel } : entry)),
    );
    setCurrentRunSnapshot((prev) => (prev?.id === snapshotId ? { ...prev, label: nextLabel } : prev));
  }, [setCurrentRunSnapshot, setSavedRunSnapshots]);

  const updateSavedRunSnapshotNotes = useCallback((snapshotId: string, notes: string) => {
    setSavedRunSnapshots((prev) =>
      prev.map((entry) => (entry.id === snapshotId ? { ...entry, notes } : entry)),
    );
  }, [setSavedRunSnapshots]);

  const restoreSavedRunSnapshot = useCallback((snapshotId: string) => {
    const snapshot =
      savedRunSnapshots.find((entry) => entry.id === snapshotId) ?? null;
    if (!snapshot) return null;
    const restoredSnapshot = deepClonePlain(snapshot) as RunSnapshot<
      TSettingsSnapshot,
      TRunDiagnostics
    >;
    setCurrentRunSnapshot(restoredSnapshot);
    setComparisonSelection((prev) => {
      const reopenSelection = snapshot.reopenState?.comparisonSelection ?? prev;
      const availableIds = new Set(
        buildComparisonCandidateSnapshots(runHistory, savedRunSnapshots, restoredSnapshot).map(
          (entry) => entry.id,
        ),
      );
      const sanitizedSelection = sanitizeComparisonSelection(reopenSelection, availableIds);
      return {
        ...sanitizedSelection,
        baselineRunId:
          sanitizedSelection.baselineRunId ??
          buildComparisonCandidateSnapshots(runHistory, savedRunSnapshots, restoredSnapshot)[0]?.id ??
          null,
      };
    });
    return snapshot;
  }, [runHistory, savedRunSnapshots, setComparisonSelection, setCurrentRunSnapshot]);

  const saveCurrentRunSnapshot = useCallback(
    (
      options: SaveCurrentRunSnapshotOptions = {},
    ): SaveCurrentRunSnapshotResult<TSettingsSnapshot, TRunDiagnostics> => {
      if (!currentRunSnapshot) return { status: 'missing-current-run', snapshot: null };

      const existingSnapshot =
        savedRunSnapshots.find(
          (entry) =>
            entry.id === currentRunSnapshot.id || entry.sourceRunId === currentRunSnapshot.id,
        ) ?? null;
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
        reopenState:
          options.reopenState !== undefined
            ? options.reopenState
              ? deepClonePlain(options.reopenState)
              : null
            : currentRunSnapshot.reopenState
              ? deepClonePlain(currentRunSnapshot.reopenState)
              : null,
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
    comparisonCandidates,
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
    renameSavedRunSnapshot,
    updateSavedRunSnapshotNotes,
    restoreSavedRunSnapshot,
    saveCurrentRunSnapshot,
    recordRunSnapshot,
  };
};
