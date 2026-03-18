import React from 'react';
import type { Observation } from '../../types';
import { OBSERVATION_FILTER_OPTIONS } from './reportSectionRegistry';

interface ReportFilterPanelProps {
  isPreanalysis: boolean;
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
}

const ReportFilterPanel: React.FC<ReportFilterPanelProps> = ({
  isPreanalysis,
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
}) => (
  <div className="mb-6 border border-slate-800/60 rounded bg-slate-900/40 p-4" style={{ order: -195 }}>
    <div className="flex flex-col gap-3 md:flex-row md:items-end md:justify-between">
      <div className="flex-1 min-w-0">
        <div className="text-[11px] uppercase tracking-wider text-slate-500 mb-1">
          Report filters
        </div>
        <input
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
                onReportObservationTypeFilterChange(event.target.value as 'all' | Observation['type'])
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
);

export default ReportFilterPanel;
