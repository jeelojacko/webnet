import { useDeferredValue, useEffect, useMemo, useState } from 'react';
import type { Dispatch, SetStateAction } from 'react';
import type { Observation } from '../types';
import {
  COLLAPSIBLE_DETAIL_SECTION_IDS,
  REPORT_TABLE_WINDOW_SIZE,
  createCollapsedDetailSectionsState,
  type CollapsibleDetailSectionId,
} from '../components/report/reportSectionRegistry';

type ReportObservationTypeFilter = 'all' | Observation['type'];
type ReportExclusionFilter = 'all' | 'included' | 'excluded';

export type PinnedDetailSection = { id: CollapsibleDetailSectionId; label: string };

interface UseReportViewStateArgs {
  result: unknown;
  excludedIds: Set<number>;
}

export interface ReportViewState {
  ellipseMode: '1sigma' | '95';
  setEllipseMode: Dispatch<SetStateAction<'1sigma' | '95'>>;
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
}

export const useReportViewState = ({
  result,
  excludedIds,
}: UseReportViewStateArgs): ReportViewState => {
  const [ellipseMode, setEllipseMode] = useState<'1sigma' | '95'>('1sigma');
  const [collapsedDetailSections, setCollapsedDetailSections] = useState<
    Record<CollapsibleDetailSectionId, boolean>
  >(createCollapsedDetailSectionsState);
  const [reportFilterQuery, setReportFilterQuery] = useState('');
  const [reportObservationTypeFilter, setReportObservationTypeFilter] =
    useState<ReportObservationTypeFilter>('all');
  const [reportExclusionFilter, setReportExclusionFilter] =
    useState<ReportExclusionFilter>('all');
  const [tableRowLimits, setTableRowLimits] = useState<Record<string, number>>({});
  const [pinnedDetailSections, setPinnedDetailSections] = useState<PinnedDetailSection[]>([]);

  const deferredReportFilterQuery = useDeferredValue(reportFilterQuery);
  const normalizedReportFilterQuery = deferredReportFilterQuery.trim().toLowerCase();
  const ellipseConfidenceScale = ellipseMode === '95' ? 2.4477 : 1;
  const excludedIdsSignature = useMemo(
    () => Array.from(excludedIds).sort((left, right) => left - right).join(','),
    [excludedIds],
  );
  const allDetailSectionsCollapsed = useMemo(
    () => COLLAPSIBLE_DETAIL_SECTION_IDS.every((id) => collapsedDetailSections[id]),
    [collapsedDetailSections],
  );

  useEffect(() => {
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
  };
};
