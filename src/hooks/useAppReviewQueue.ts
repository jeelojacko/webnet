import { useCallback, useEffect, useMemo, useState, type Dispatch, type SetStateAction } from 'react';
import { buildReviewQueue, type ReviewQueueItem, type ReviewQueueSeverity, type ReviewQueueSourceType } from '../engine/reviewQueue';
import type { RunComparisonSummary } from '../engine/qaWorkflow';
import type { AdjustmentResult } from '../types';
import type { ClusterReviewDecision } from '../appStateTypes';
import type { ImportConflict, ImportResolution } from '../engine/importConflictReview';

interface UseAppReviewQueueArgs {
  result: AdjustmentResult | null;
  excludedIds: Set<number>;
  clusterReviewDecisions: Record<string, ClusterReviewDecision>;
  runComparisonSummary: RunComparisonSummary | null;
  importReviewState:
    | {
        conflicts: ImportConflict[];
        conflictResolutions: Record<string, ImportResolution>;
        conflictRenameValues: Record<string, string>;
      }
    | null
    | undefined;
  selectObservation: (_observationId: number, _origin: 'queue') => void;
  selectStation: (_stationId: string, _origin: 'queue') => void;
  setActiveTab: (_tab: 'report' | 'processing-summary' | 'industry-output' | 'map') => void;
  setIsSidebarOpen: Dispatch<SetStateAction<boolean>>;
  setPendingEditorJumpLine: Dispatch<SetStateAction<number | null>>;
}

export const useAppReviewQueue = ({
  result,
  excludedIds,
  clusterReviewDecisions,
  runComparisonSummary,
  importReviewState,
  selectObservation,
  selectStation,
  setActiveTab,
  setIsSidebarOpen,
  setPendingEditorJumpLine,
}: UseAppReviewQueueArgs) => {
  const [reviewQueueSeverityFilter, setReviewQueueSeverityFilter] = useState<
    'all' | ReviewQueueSeverity
  >('all');
  const [reviewQueueSourceFilter, setReviewQueueSourceFilter] = useState<
    'all' | ReviewQueueSourceType
  >('all');
  const [reviewQueueUnresolvedOnly, setReviewQueueUnresolvedOnly] = useState(false);
  const [reviewQueueImportedGroupFilter, setReviewQueueImportedGroupFilter] = useState('all');
  const [selectedReviewQueueItemId, setSelectedReviewQueueItemId] = useState<string | null>(null);
  const [reportFilterFocusRequestKey, setReportFilterFocusRequestKey] = useState(0);

  const reviewQueueItems = useMemo(
    () =>
      buildReviewQueue({
        result,
        excludedIds,
        clusterReviewDecisions,
        comparisonSummary: runComparisonSummary,
        importConflicts: importReviewState?.conflicts ?? [],
        conflictResolutions: importReviewState?.conflictResolutions ?? {},
        conflictRenameValues: importReviewState?.conflictRenameValues ?? {},
      }),
    [
      clusterReviewDecisions,
      excludedIds,
      importReviewState?.conflictRenameValues,
      importReviewState?.conflictResolutions,
      importReviewState?.conflicts,
      result,
      runComparisonSummary,
    ],
  );
  const reviewQueueImportedGroupOptions = useMemo(
    () =>
      [
        ...new Set(
          reviewQueueItems
            .map((item) => item.sourceGroup)
            .filter((group) => group !== 'workspace'),
        ),
      ].sort((left, right) => left.localeCompare(right, undefined, { numeric: true })),
    [reviewQueueItems],
  );
  const filteredReviewQueueItems = useMemo(
    () =>
      reviewQueueItems.filter((item) => {
        if (reviewQueueSeverityFilter !== 'all' && item.severity !== reviewQueueSeverityFilter) {
          return false;
        }
        if (reviewQueueSourceFilter !== 'all' && item.sourceType !== reviewQueueSourceFilter) {
          return false;
        }
        if (reviewQueueUnresolvedOnly && item.resolved) return false;
        if (
          reviewQueueImportedGroupFilter !== 'all' &&
          item.sourceGroup !== reviewQueueImportedGroupFilter
        ) {
          return false;
        }
        return true;
      }),
    [
      reviewQueueImportedGroupFilter,
      reviewQueueItems,
      reviewQueueSeverityFilter,
      reviewQueueSourceFilter,
      reviewQueueUnresolvedOnly,
    ],
  );

  const handleJumpToSourceLine = useCallback(
    (lineNumber: number) => {
      if (!Number.isFinite(lineNumber) || lineNumber <= 0) return;
      setIsSidebarOpen(true);
      setPendingEditorJumpLine(Math.trunc(lineNumber));
    },
    [setIsSidebarOpen, setPendingEditorJumpLine],
  );

  const handleFocusReportFilter = useCallback(() => {
    setActiveTab('report');
    setReportFilterFocusRequestKey((current) => current + 1);
  }, [setActiveTab]);

  const handleSelectReviewQueueItem = useCallback(
    (item: ReviewQueueItem) => {
      setSelectedReviewQueueItemId(item.id);
      if (item.target.kind === 'observation') {
        selectObservation(item.target.observationId, 'queue');
        setActiveTab(item.preferredTab === 'map' ? 'map' : 'report');
        if (item.target.sourceLine != null) handleJumpToSourceLine(item.target.sourceLine);
        return;
      }
      if (item.target.kind === 'station') {
        selectStation(item.target.stationId, 'queue');
        setActiveTab(item.preferredTab === 'report' ? 'report' : 'map');
        if (item.target.sourceLine != null) handleJumpToSourceLine(item.target.sourceLine);
        return;
      }
      handleJumpToSourceLine(item.target.sourceLine);
      setActiveTab('report');
    },
    [handleJumpToSourceLine, selectObservation, selectStation, setActiveTab],
  );

  const handleNextUnresolvedQueueItem = useCallback(() => {
    const unresolved = filteredReviewQueueItems.filter((item) => !item.resolved);
    if (unresolved.length === 0) return;
    const currentIndex = unresolved.findIndex((item) => item.id === selectedReviewQueueItemId);
    const next = unresolved[currentIndex < 0 ? 0 : (currentIndex + 1) % unresolved.length];
    handleSelectReviewQueueItem(next);
  }, [filteredReviewQueueItems, handleSelectReviewQueueItem, selectedReviewQueueItemId]);

  const clearReviewQueueFilters = useCallback(() => {
    setReviewQueueSeverityFilter('all');
    setReviewQueueSourceFilter('all');
    setReviewQueueUnresolvedOnly(false);
    setReviewQueueImportedGroupFilter('all');
  }, []);

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      const target = event.target as HTMLElement | null;
      const tag = target?.tagName?.toLowerCase() ?? '';
      if (tag === 'input' || tag === 'textarea' || target?.isContentEditable) return;
      if (event.altKey && event.key.toLowerCase() === 'n') {
        event.preventDefault();
        handleNextUnresolvedQueueItem();
      }
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [handleNextUnresolvedQueueItem]);

  return {
    filteredReviewQueueItems,
    reviewQueueImportedGroupOptions,
    reviewQueueSeverityFilter,
    setReviewQueueSeverityFilter,
    reviewQueueSourceFilter,
    setReviewQueueSourceFilter,
    reviewQueueUnresolvedOnly,
    setReviewQueueUnresolvedOnly,
    reviewQueueImportedGroupFilter,
    setReviewQueueImportedGroupFilter,
    selectedReviewQueueItemId,
    handleJumpToSourceLine,
    handleFocusReportFilter,
    reportFilterFocusRequestKey,
    handleSelectReviewQueueItem,
    handleNextUnresolvedQueueItem,
    clearReviewQueueFilters,
  };
};
