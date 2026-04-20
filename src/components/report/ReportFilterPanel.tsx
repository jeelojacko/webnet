import React, { useEffect, useRef } from 'react';
import type { Observation } from '../../types';
import type { CollapsibleDetailSectionId } from './reportSectionRegistry';
import { OBSERVATION_FILTER_OPTIONS } from './reportSectionRegistry';

interface ReportFilterPanelProps {
  isPreanalysis: boolean;
  sectionId: CollapsibleDetailSectionId;
  collapsed: boolean;
  onToggleCollapse: (_sectionId: CollapsibleDetailSectionId) => void;
  reportFilterQuery: string;
  onReportFilterQueryChange: (_value: string) => void;
  reportObservationTypeFilter: 'all' | Observation['type'];
  onReportObservationTypeFilterChange: (_value: 'all' | Observation['type']) => void;
  reportExclusionFilter: 'all' | 'included' | 'excluded';
  onReportExclusionFilterChange: (_value: 'all' | 'included' | 'excluded') => void;
  reviewConflictOnly: boolean;
  onReviewConflictOnlyChange: (_value: boolean) => void;
  reviewAdjustedOnly: boolean;
  onReviewAdjustedOnlyChange: (_value: boolean) => void;
  reviewImportedGroupFilter: string;
  onReviewImportedGroupFilterChange: (_value: string) => void;
  importedGroupOptions: string[];
  onClearFilters: () => void;
  filteredObservationCount: number;
  totalObservationCount: number;
  deferredReportFilterQuery: string;
  normalizedReportFilterQuery: string;
  focusRequestKey?: number;
}

const ReportFilterPanel: React.FC<ReportFilterPanelProps> = ({
  isPreanalysis,
  sectionId,
  collapsed,
  onToggleCollapse,
  reportFilterQuery,
  onReportFilterQueryChange,
  reportObservationTypeFilter,
  onReportObservationTypeFilterChange,
  reportExclusionFilter,
  onReportExclusionFilterChange,
  reviewConflictOnly,
  onReviewConflictOnlyChange,
  reviewAdjustedOnly,
  onReviewAdjustedOnlyChange,
  reviewImportedGroupFilter,
  onReviewImportedGroupFilterChange,
  importedGroupOptions,
  onClearFilters,
  filteredObservationCount,
  totalObservationCount,
  deferredReportFilterQuery,
  normalizedReportFilterQuery,
  focusRequestKey = 0,
}) => {
  const filterInputRef = useRef<HTMLInputElement | null>(null);

  useEffect(() => {
    if (focusRequestKey <= 0) return;
    if (collapsed) onToggleCollapse(sectionId);
    filterInputRef.current?.focus();
    filterInputRef.current?.select();
  }, [collapsed, focusRequestKey, onToggleCollapse, sectionId]);

  return (
    <div
      className="mb-6 border border-slate-800/60 rounded bg-slate-900/40"
      style={{ order: -195 }}
    >
      <div className="flex items-center justify-between gap-3 border-b border-slate-800 px-3 py-2 text-[11px] uppercase tracking-wider">
        <div className="text-slate-400">Report Filters</div>
        <button
          type="button"
          onClick={() => onToggleCollapse(sectionId)}
          aria-label={collapsed ? 'Expand report filters panel' : 'Collapse report filters panel'}
          className="inline-flex h-6 w-6 items-center justify-center rounded border border-slate-700 bg-slate-950/60 text-sm text-slate-200 hover:border-cyan-400"
        >
          {collapsed ? '+' : '-'}
        </button>
      </div>
      {!collapsed && (
        <div className="p-4">
          <div className="flex flex-col gap-3 md:flex-row md:items-end md:justify-between">
            <div className="flex-1 min-w-0">
              <input
                ref={filterInputRef}
                type="text"
                value={reportFilterQuery}
                onChange={(event) => onReportFilterQueryChange(event.target.value)}
                placeholder="Filter by station ID, source line, or table text"
                aria-label="Report filter text"
                className="w-full rounded border border-slate-700 bg-slate-950/60 px-3 py-2 text-sm text-slate-100 placeholder:text-slate-500"
              />
            </div>
            {!isPreanalysis ? (
              <>
                <div className="w-full md:w-64">
                  <div className="text-[11px] uppercase tracking-wider text-slate-500 mb-1">
                    Observation type
                  </div>
                  <select
                    value={reportObservationTypeFilter}
                    onChange={(event) =>
                      onReportObservationTypeFilterChange(
                        event.target.value as 'all' | Observation['type'],
                      )
                    }
                    aria-label="Observation type filter"
                    className="w-full rounded border border-slate-700 bg-slate-950/60 px-3 py-2 text-sm text-slate-100"
                  >
                    {OBSERVATION_FILTER_OPTIONS.map((option) => (
                      <option key={option.value} value={option.value}>
                        {option.label}
                      </option>
                    ))}
                  </select>
                </div>
                <div className="w-full md:w-48">
                  <div className="text-[11px] uppercase tracking-wider text-slate-500 mb-1">
                    Exclusion status
                  </div>
                  <select
                    value={reportExclusionFilter}
                    onChange={(event) =>
                      onReportExclusionFilterChange(
                        event.target.value as 'all' | 'included' | 'excluded',
                      )
                    }
                    aria-label="Observation exclusion filter"
                    className="w-full rounded border border-slate-700 bg-slate-950/60 px-3 py-2 text-sm text-slate-100"
                  >
                    <option value="all">All observations</option>
                    <option value="included">Included only</option>
                    <option value="excluded">Excluded only</option>
                  </select>
                </div>
                <label className="w-full md:w-48">
                  <div className="text-[11px] uppercase tracking-wider text-slate-500 mb-1">
                    Imported Group
                  </div>
                  <select
                    value={reviewImportedGroupFilter}
                    onChange={(event) => onReviewImportedGroupFilterChange(event.target.value)}
                    aria-label="Imported group filter"
                    className="w-full rounded border border-slate-700 bg-slate-950/60 px-3 py-2 text-sm text-slate-100"
                  >
                    <option value="all">All groups</option>
                    <option value="__none__">Workspace only</option>
                    {importedGroupOptions.map((group) => (
                      <option key={group} value={group}>
                        {group}
                      </option>
                    ))}
                  </select>
                </label>
              </>
            ) : null}
            <button
              type="button"
              onClick={onClearFilters}
              className="rounded bg-slate-800 px-3 py-2 text-xs text-slate-100 hover:bg-slate-700"
            >
              Clear filters
            </button>
          </div>
          {!isPreanalysis && (
            <div className="mt-3 flex flex-wrap items-center gap-2 text-[11px]">
              <label className="inline-flex items-center gap-2 rounded border border-slate-700 bg-slate-950/40 px-2 py-1 text-slate-300">
                <input
                  type="checkbox"
                  checked={reviewConflictOnly}
                  onChange={(event) => onReviewConflictOnlyChange(event.target.checked)}
                />
                <span className="uppercase tracking-wide">Conflict-only</span>
              </label>
              <label className="inline-flex items-center gap-2 rounded border border-slate-700 bg-slate-950/40 px-2 py-1 text-slate-300">
                <input
                  type="checkbox"
                  checked={reviewAdjustedOnly}
                  onChange={(event) => onReviewAdjustedOnlyChange(event.target.checked)}
                />
                <span className="uppercase tracking-wide">Adjusted-only</span>
              </label>
              {(reviewConflictOnly ||
                reviewAdjustedOnly ||
                (reviewImportedGroupFilter !== 'all' && reviewImportedGroupFilter !== '')) && (
                <div className="ml-auto flex flex-wrap items-center gap-1">
                  <span className="rounded border border-amber-700/70 bg-amber-950/30 px-2 py-1 text-amber-200">
                    Active filters
                  </span>
                  {reviewConflictOnly && (
                    <button
                      type="button"
                      onClick={() => onReviewConflictOnlyChange(false)}
                      className="rounded border border-slate-700 bg-slate-900/70 px-2 py-1 text-slate-200 hover:border-cyan-400"
                    >
                      conflict-only ×
                    </button>
                  )}
                  {reviewAdjustedOnly && (
                    <button
                      type="button"
                      onClick={() => onReviewAdjustedOnlyChange(false)}
                      className="rounded border border-slate-700 bg-slate-900/70 px-2 py-1 text-slate-200 hover:border-cyan-400"
                    >
                      adjusted-only ×
                    </button>
                  )}
                  {reviewImportedGroupFilter !== 'all' &&
                    reviewImportedGroupFilter !== '' && (
                      <button
                        type="button"
                        onClick={() => onReviewImportedGroupFilterChange('all')}
                        className="rounded border border-slate-700 bg-slate-900/70 px-2 py-1 text-slate-200 hover:border-cyan-400"
                      >
                        group:{' '}
                        {reviewImportedGroupFilter === '__none__'
                          ? 'workspace'
                          : reviewImportedGroupFilter}{' '}
                        ×
                      </button>
                    )}
                </div>
              )}
            </div>
          )}
          <div className="mt-2 text-xs text-slate-500">
            Observations: {filteredObservationCount}/{totalObservationCount}
            {normalizedReportFilterQuery ? ` | Query: ${deferredReportFilterQuery.trim()}` : ''}
          </div>
        </div>
      )}
    </div>
  );
};

export default ReportFilterPanel;
