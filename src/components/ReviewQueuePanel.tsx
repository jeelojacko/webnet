import React from 'react';
import type {
  ReviewQueueItem,
  ReviewQueueSeverity,
  ReviewQueueSourceType,
} from '../engine/reviewQueue';

interface ReviewQueuePanelProps {
  items: ReviewQueueItem[];
  selectedItemId: string | null;
  severityFilter: 'all' | ReviewQueueSeverity;
  sourceFilter: 'all' | ReviewQueueSourceType;
  unresolvedOnly: boolean;
  importedGroupFilter: string;
  importedGroupOptions: string[];
  onSeverityFilterChange: (_value: 'all' | ReviewQueueSeverity) => void;
  onSourceFilterChange: (_value: 'all' | ReviewQueueSourceType) => void;
  onUnresolvedOnlyChange: (_value: boolean) => void;
  onImportedGroupFilterChange: (_value: string) => void;
  onSelectItem: (_item: ReviewQueueItem) => void;
  onNextUnresolved: () => void;
  onClearFilters: () => void;
}

const ReviewQueuePanel: React.FC<ReviewQueuePanelProps> = ({
  items,
  selectedItemId,
  severityFilter,
  sourceFilter,
  unresolvedOnly,
  importedGroupFilter,
  importedGroupOptions,
  onSeverityFilterChange,
  onSourceFilterChange,
  onUnresolvedOnlyChange,
  onImportedGroupFilterChange,
  onSelectItem,
  onNextUnresolved,
  onClearFilters,
}) => {
  const [isCollapsed, setIsCollapsed] = React.useState(true);
  const unresolvedCount = items.filter((item) => !item.resolved).length;
  const hasActiveFilters =
    severityFilter !== 'all' ||
    sourceFilter !== 'all' ||
    unresolvedOnly ||
    importedGroupFilter !== 'all';
  const canExpand = items.length > 0 || hasActiveFilters;
  return (
    <div className="border-b border-slate-800 bg-slate-900/70 px-4 py-1.5 text-xs">
      <div className="flex items-center justify-between gap-3">
        <div className="flex min-w-0 items-center gap-2">
          <span className="text-[11px] uppercase tracking-[0.2em] text-cyan-300">Review Queue</span>
          <span className="truncate text-[11px] text-slate-400">
            {items.length} item{items.length === 1 ? '' : 's'} | unresolved {unresolvedCount}
          </span>
        </div>
        <button
          type="button"
          onClick={() => setIsCollapsed((current) => !current)}
          disabled={!canExpand}
          aria-label={isCollapsed ? 'Expand review queue panel' : 'Collapse review queue panel'}
          title={
            !canExpand
              ? 'Run adjustment or clear filters to populate the review queue.'
              : isCollapsed
                ? 'Expand review queue controls and items.'
                : 'Collapse review queue controls and items.'
          }
          className={`inline-flex h-6 w-6 items-center justify-center rounded border text-sm ${
            canExpand
              ? 'border-slate-700 bg-slate-950/60 text-slate-200 hover:border-cyan-400'
              : 'border-slate-800 bg-slate-950/40 text-slate-600'
          }`}
        >
          {isCollapsed ? '+' : '-'}
        </button>
      </div>

      {!isCollapsed && (
        <>
          <div className="mt-2 flex flex-wrap items-center gap-2">
            <button
              type="button"
              onClick={onNextUnresolved}
              className="rounded border border-slate-700 bg-slate-950/60 px-2 py-1 text-slate-100 hover:border-cyan-400"
              title="Jump to next unresolved queue item (Alt+N)"
            >
              Next unresolved
            </button>
            <select
              value={severityFilter}
              onChange={(event) =>
                onSeverityFilterChange(event.target.value as 'all' | ReviewQueueSeverity)
              }
              className="rounded border border-slate-700 bg-slate-950/60 px-2 py-1 text-slate-100"
            >
              <option value="all">All severities</option>
              <option value="high">High</option>
              <option value="medium">Medium</option>
              <option value="low">Low</option>
            </select>
            <select
              value={sourceFilter}
              onChange={(event) =>
                onSourceFilterChange(event.target.value as 'all' | ReviewQueueSourceType)
              }
              className="rounded border border-slate-700 bg-slate-950/60 px-2 py-1 text-slate-100"
            >
              <option value="all">All sources</option>
              <option value="import-conflict">Import conflicts</option>
              <option value="suspect-observation">Suspect observations</option>
              <option value="cluster-candidate">Cluster candidates</option>
              <option value="compare-residual">Compare residuals</option>
              <option value="compare-station">Compare stations</option>
            </select>
            <select
              value={importedGroupFilter}
              onChange={(event) => onImportedGroupFilterChange(event.target.value)}
              className="rounded border border-slate-700 bg-slate-950/60 px-2 py-1 text-slate-100"
            >
              <option value="all">All groups</option>
              {importedGroupOptions.map((option) => (
                <option key={option} value={option}>
                  {option}
                </option>
              ))}
            </select>
            <label className="inline-flex items-center gap-2 rounded border border-slate-700 bg-slate-950/60 px-2 py-1 text-slate-200">
              <input
                type="checkbox"
                checked={unresolvedOnly}
                onChange={(event) => onUnresolvedOnlyChange(event.target.checked)}
              />
              <span>Unresolved only</span>
            </label>
            <button
              type="button"
              onClick={onClearFilters}
              className="rounded border border-slate-700 bg-slate-950/60 px-2 py-1 text-slate-100 hover:border-cyan-400"
            >
              Clear filters
            </button>
          </div>
          {hasActiveFilters && (
            <div className="mt-2 flex flex-wrap items-center gap-1 text-[11px]">
              <span className="rounded border border-amber-700/70 bg-amber-950/30 px-2 py-1 text-amber-200">
                Active filters
              </span>
              {severityFilter !== 'all' && (
                <span className="rounded border border-slate-700 bg-slate-900/70 px-2 py-1 text-slate-200">
                  severity:{severityFilter}
                </span>
              )}
              {sourceFilter !== 'all' && (
                <span className="rounded border border-slate-700 bg-slate-900/70 px-2 py-1 text-slate-200">
                  source:{sourceFilter}
                </span>
              )}
              {unresolvedOnly && (
                <span className="rounded border border-slate-700 bg-slate-900/70 px-2 py-1 text-slate-200">
                  unresolved
                </span>
              )}
              {importedGroupFilter !== 'all' && (
                <span className="rounded border border-slate-700 bg-slate-900/70 px-2 py-1 text-slate-200">
                  group:{importedGroupFilter}
                </span>
              )}
            </div>
          )}
          <div className="mt-2 max-h-48 overflow-auto rounded border border-slate-800 bg-slate-950/50">
            {items.length === 0 ? (
              <div className="px-3 py-2 text-slate-500">No queue items in the current view.</div>
            ) : (
              items.map((item) => (
                <button
                  key={item.id}
                  type="button"
                  onClick={() => onSelectItem(item)}
                  className={`flex w-full items-start justify-between gap-2 border-b border-slate-800 px-3 py-2 text-left ${
                    selectedItemId === item.id
                      ? 'bg-cyan-950/40 text-cyan-100'
                      : 'text-slate-200 hover:bg-slate-900/60'
                  }`}
                >
                  <span className="min-w-0">
                    <span className="block truncate font-medium">{item.title}</span>
                    <span className="block truncate text-[11px] text-slate-400">{item.subtitle}</span>
                  </span>
                  <span className="flex shrink-0 items-center gap-1 text-[10px] uppercase tracking-wide">
                    <span
                      className={`rounded px-1.5 py-0.5 ${
                        item.severity === 'high'
                          ? 'bg-rose-900/50 text-rose-200'
                          : item.severity === 'medium'
                          ? 'bg-amber-900/50 text-amber-200'
                          : 'bg-slate-800 text-slate-300'
                      }`}
                    >
                      {item.severity}
                    </span>
                    <span
                      className={`rounded px-1.5 py-0.5 ${
                        item.resolved
                          ? 'bg-emerald-900/40 text-emerald-200'
                          : 'bg-slate-800 text-slate-300'
                      }`}
                    >
                      {item.resolved ? 'resolved' : 'open'}
                    </span>
                  </span>
                </button>
              ))
            )}
          </div>
        </>
      )}
    </div>
  );
};

export default ReviewQueuePanel;
