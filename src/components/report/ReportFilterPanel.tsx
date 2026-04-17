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
