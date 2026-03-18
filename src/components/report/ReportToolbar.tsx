import React from 'react';

interface ReportToolbarProps {
  onReRun: () => void;
  onToggleCollapseAll: () => void;
  allDetailSectionsCollapsed: boolean;
  onClearExclusions: () => void;
  onResetOverrides: () => void;
  showClusterMergeRevert: boolean;
  clusterAppliedMergeCount: number;
  onClearClusterMerges: () => void;
  unitScale: number;
  units: 'm' | 'ft';
}

const ReportToolbar: React.FC<ReportToolbarProps> = ({
  onReRun,
  onToggleCollapseAll,
  allDetailSectionsCollapsed,
  onClearExclusions,
  onResetOverrides,
  showClusterMergeRevert,
  clusterAppliedMergeCount,
  onClearClusterMerges,
  unitScale,
  units,
}) => (
  <div className="flex items-center justify-between mb-4 text-xs text-slate-400" style={{ order: -220 }}>
    <div className="space-x-3">
      <button
        onClick={onReRun}
        className="px-3 py-1 bg-green-700 hover:bg-green-600 text-slate-100 rounded"
      >
        Re-run with exclusions
      </button>
      <button
        onClick={onToggleCollapseAll}
        className="px-3 py-1 bg-slate-700 rounded hover:bg-slate-600 text-slate-100"
      >
        {allDetailSectionsCollapsed ? 'Expand detail sections' : 'Collapse detail sections'}
      </button>
      <button onClick={onClearExclusions} className="px-3 py-1 bg-slate-700 rounded">
        Reset exclusions
      </button>
      <button onClick={onResetOverrides} className="px-3 py-1 bg-slate-700 rounded">
        Reset overrides
      </button>
      {showClusterMergeRevert ? (
        <button
          onClick={onClearClusterMerges}
          disabled={clusterAppliedMergeCount === 0}
          className={`px-3 py-1 rounded ${
            clusterAppliedMergeCount === 0
              ? 'bg-slate-800 text-slate-600 cursor-not-allowed'
              : 'bg-amber-700 hover:bg-amber-600 text-slate-100'
          }`}
        >
          Revert cluster merges
        </button>
      ) : null}
    </div>
    <div className="space-x-2 text-slate-500">
      <span>
        Unit scale: {unitScale.toFixed(4)} ({units})
      </span>
    </div>
  </div>
);

export default ReportToolbar;
