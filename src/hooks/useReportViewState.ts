import { useDeferredValue, useEffect, useMemo, useRef, useState } from 'react';
import type { Dispatch, SetStateAction } from 'react';
import type { Observation } from '../types';
import {
  COLLAPSIBLE_DETAIL_SECTION_IDS,
  REPORT_TABLE_WINDOW_SIZE,
  createCollapsedDetailSectionsState,
  type CollapsibleDetailSectionId,
} from '../components/report/reportSectionRegistry';

export type ReportEllipseMode = '1sigma' | '95';
export type ReportObservationTypeFilter = 'all' | Observation['type'];
export type ReportExclusionFilter = 'all' | 'included' | 'excluded';

export type PinnedDetailSection = { id: CollapsibleDetailSectionId; label: string };

interface UseReportViewStateArgs {
  result: unknown;
  excludedIds: Set<number>;
  initialSnapshot?: ReportViewSnapshot;
}

export interface ReportViewSnapshot {
  ellipseMode: ReportEllipseMode;
  reportFilterQuery: string;
  reportObservationTypeFilter: ReportObservationTypeFilter;
  reportExclusionFilter: ReportExclusionFilter;
  tableRowLimits: Record<string, number>;
  pinnedDetailSections: PinnedDetailSection[];
  collapsedDetailSections: Record<CollapsibleDetailSectionId, boolean>;
}

export interface ReportViewState {
  ellipseMode: ReportEllipseMode;
  setEllipseMode: Dispatch<SetStateAction<ReportEllipseMode>>;
  ellipseConfidenceScale: number;
  reportFilterQuery: string;
  setReportFilterQuery: Dispatch<SetStateAction<string>>;
  reportObservationTypeFilter: ReportObservationTypeFilter;
  setReportObservationTypeFilter: Dispatch<SetStateAction<ReportObservationTypeFilter>>;
  reportExclusionFilter: ReportExclusionFilter;
  setReportExclusionFilter: Dispatch<SetStateAction<ReportExclusionFilter>>;
  clearFilters: () => void;
  deferredReportFilterQuery: string;
  normalizedReportFilterQuery: string;
  pinnedDetailSections: PinnedDetailSection[];
  clearPinnedDetailSections: () => void;
  isDetailSectionPinned: (_id: CollapsibleDetailSectionId) => boolean;
  togglePinnedDetailSection: (_id: CollapsibleDetailSectionId, _label: string) => void;
  isSectionCollapsed: (_id: CollapsibleDetailSectionId) => boolean;
  toggleDetailSection: (_id: CollapsibleDetailSectionId) => void;
  allDetailSectionsCollapsed: boolean;
  setAllDetailSectionsCollapsed: (_collapsed: boolean) => void;
  visibleRowsFor: <T>(_key: string, _rows: T[], _defaultSize?: number) => T[];
  showMoreRows: (_key: string, _step?: number) => void;
  snapshot: ReportViewSnapshot;
  restoreSnapshot: (_snapshot: ReportViewSnapshot) => void;
  resetState: () => void;
}

export type ReportViewControls = Omit<
  ReportViewState,
  'snapshot' | 'restoreSnapshot' | 'resetState'
>;

const cloneCollapsedDetailSectionsState = (
  source?: Partial<Record<CollapsibleDetailSectionId, boolean>>,
): Record<CollapsibleDetailSectionId, boolean> => {
  const next = createCollapsedDetailSectionsState();
  if (!source) return next;
  COLLAPSIBLE_DETAIL_SECTION_IDS.forEach((id) => {
    next[id] = source[id] ?? false;
  });
  return next;
};

const clonePinnedDetailSections = (
  sections?: readonly PinnedDetailSection[],
): PinnedDetailSection[] => (sections ?? []).map((entry) => ({ ...entry }));

export const createDefaultReportViewSnapshot = (): ReportViewSnapshot => ({
  ellipseMode: '1sigma',
  reportFilterQuery: '',
  reportObservationTypeFilter: 'all',
  reportExclusionFilter: 'all',
  tableRowLimits: {},
  pinnedDetailSections: [],
  collapsedDetailSections: createCollapsedDetailSectionsState(),
});

const normalizeReportViewSnapshot = (
  snapshot?: ReportViewSnapshot,
): ReportViewSnapshot => {
  const fallback = createDefaultReportViewSnapshot();
  if (!snapshot) return fallback;
  return {
    ellipseMode: snapshot.ellipseMode === '95' ? '95' : '1sigma',
    reportFilterQuery: snapshot.reportFilterQuery ?? '',
    reportObservationTypeFilter: snapshot.reportObservationTypeFilter ?? 'all',
    reportExclusionFilter: snapshot.reportExclusionFilter ?? 'all',
    tableRowLimits: { ...(snapshot.tableRowLimits ?? {}) },
    pinnedDetailSections: clonePinnedDetailSections(snapshot.pinnedDetailSections),
    collapsedDetailSections: cloneCollapsedDetailSectionsState(snapshot.collapsedDetailSections),
  };
};

export const useReportViewState = ({
  result,
  excludedIds,
  initialSnapshot,
}: UseReportViewStateArgs): ReportViewState => {
  const [ellipseMode, setEllipseMode] = useState<ReportEllipseMode>(
    () => normalizeReportViewSnapshot(initialSnapshot).ellipseMode,
  );
  const [collapsedDetailSections, setCollapsedDetailSections] = useState<
    Record<CollapsibleDetailSectionId, boolean>
  >(() => normalizeReportViewSnapshot(initialSnapshot).collapsedDetailSections);
  const [reportFilterQuery, setReportFilterQuery] = useState(
    () => normalizeReportViewSnapshot(initialSnapshot).reportFilterQuery,
  );
  const [reportObservationTypeFilter, setReportObservationTypeFilter] =
    useState<ReportObservationTypeFilter>(
      () => normalizeReportViewSnapshot(initialSnapshot).reportObservationTypeFilter,
    );
  const [reportExclusionFilter, setReportExclusionFilter] =
    useState<ReportExclusionFilter>(
      () => normalizeReportViewSnapshot(initialSnapshot).reportExclusionFilter,
    );
  const [tableRowLimits, setTableRowLimits] = useState<Record<string, number>>(
    () => normalizeReportViewSnapshot(initialSnapshot).tableRowLimits,
  );
  const [pinnedDetailSections, setPinnedDetailSections] = useState<PinnedDetailSection[]>(
    () => normalizeReportViewSnapshot(initialSnapshot).pinnedDetailSections,
  );

  const deferredReportFilterQuery = useDeferredValue(reportFilterQuery);
  const normalizedReportFilterQuery = deferredReportFilterQuery.trim().toLowerCase();
  const ellipseConfidenceScale = ellipseMode === '95' ? 2.4477 : 1;
  const skipNextAutoWindowResetRef = useRef(false);
  const excludedIdsSignature = useMemo(
    () => Array.from(excludedIds).sort((left, right) => left - right).join(','),
    [excludedIds],
  );
  const allDetailSectionsCollapsed = useMemo(
    () => COLLAPSIBLE_DETAIL_SECTION_IDS.every((id) => collapsedDetailSections[id]),
    [collapsedDetailSections],
  );

  useEffect(() => {
    if (skipNextAutoWindowResetRef.current) {
      skipNextAutoWindowResetRef.current = false;
      return;
    }
    setTableRowLimits({});
  }, [
    excludedIdsSignature,
    normalizedReportFilterQuery,
    reportExclusionFilter,
    reportObservationTypeFilter,
    result,
  ]);

  const clearFilters = () => {
    setReportFilterQuery('');
    setReportObservationTypeFilter('all');
    setReportExclusionFilter('all');
  };

  const isDetailSectionPinned = (id: CollapsibleDetailSectionId): boolean =>
    pinnedDetailSections.some((entry) => entry.id === id);

  const togglePinnedDetailSection = (id: CollapsibleDetailSectionId, label: string) => {
    setPinnedDetailSections((prev) => {
      if (prev.some((entry) => entry.id === id)) {
        return prev.filter((entry) => entry.id !== id);
      }
      return [...prev, { id, label }];
    });
  };

  const clearPinnedDetailSections = () => setPinnedDetailSections([]);

  const isSectionCollapsed = (id: CollapsibleDetailSectionId): boolean =>
    collapsedDetailSections[id] ?? false;

  const toggleDetailSection = (id: CollapsibleDetailSectionId) => {
    setCollapsedDetailSections((prev) => ({
      ...prev,
      [id]: !prev[id],
    }));
  };

  const setAllDetailSectionsCollapsed = (collapsed: boolean) => {
    setCollapsedDetailSections((prev) => {
      const next = { ...prev };
      COLLAPSIBLE_DETAIL_SECTION_IDS.forEach((id) => {
        next[id] = collapsed;
      });
      return next;
    });
  };

  const visibleRowsFor = <T,>(
    key: string,
    rows: T[],
    defaultSize = REPORT_TABLE_WINDOW_SIZE,
  ): T[] => rows.slice(0, tableRowLimits[key] ?? defaultSize);

  const showMoreRows = (key: string, step = REPORT_TABLE_WINDOW_SIZE) => {
    setTableRowLimits((prev) => ({
      ...prev,
      [key]: (prev[key] ?? step) + step,
    }));
  };

  const restoreSnapshot = (nextSnapshot: ReportViewSnapshot) => {
    const normalizedSnapshot = normalizeReportViewSnapshot(nextSnapshot);
    skipNextAutoWindowResetRef.current = true;
    setEllipseMode(normalizedSnapshot.ellipseMode);
    setReportFilterQuery(normalizedSnapshot.reportFilterQuery);
    setReportObservationTypeFilter(normalizedSnapshot.reportObservationTypeFilter);
    setReportExclusionFilter(normalizedSnapshot.reportExclusionFilter);
    setTableRowLimits(normalizedSnapshot.tableRowLimits);
    setPinnedDetailSections(normalizedSnapshot.pinnedDetailSections);
    setCollapsedDetailSections(normalizedSnapshot.collapsedDetailSections);
  };

  const resetState = () => {
    restoreSnapshot(createDefaultReportViewSnapshot());
  };

  const snapshot = useMemo<ReportViewSnapshot>(
    () => ({
      ellipseMode,
      reportFilterQuery,
      reportObservationTypeFilter,
      reportExclusionFilter,
      tableRowLimits: { ...tableRowLimits },
      pinnedDetailSections: clonePinnedDetailSections(pinnedDetailSections),
      collapsedDetailSections: cloneCollapsedDetailSectionsState(collapsedDetailSections),
    }),
    [
      collapsedDetailSections,
      ellipseMode,
      pinnedDetailSections,
      reportExclusionFilter,
      reportFilterQuery,
      reportObservationTypeFilter,
      tableRowLimits,
    ],
  );

  return {
    ellipseMode,
    setEllipseMode,
    ellipseConfidenceScale,
    reportFilterQuery,
    setReportFilterQuery,
    reportObservationTypeFilter,
    setReportObservationTypeFilter,
    reportExclusionFilter,
    setReportExclusionFilter,
    clearFilters,
    deferredReportFilterQuery,
    normalizedReportFilterQuery,
    pinnedDetailSections,
    clearPinnedDetailSections,
    isDetailSectionPinned,
    togglePinnedDetailSection,
    isSectionCollapsed,
    toggleDetailSection,
    allDetailSectionsCollapsed,
    setAllDetailSectionsCollapsed,
    visibleRowsFor,
    showMoreRows,
    snapshot,
    restoreSnapshot,
    resetState,
  };
};
