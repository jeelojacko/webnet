import React from 'react';

interface ReportLoadMoreFooterProps {
  rowKey: string;
  shownCount: number;
  totalCount: number;
  onShowMore: (_rowKey: string, _step?: number) => void;
  step?: number;
}

const ReportLoadMoreFooter: React.FC<ReportLoadMoreFooterProps> = ({
  rowKey,
  shownCount,
  totalCount,
  onShowMore,
  step,
}) => {
  if (totalCount <= shownCount) return null;

  return (
    <div className="flex items-center justify-between gap-3 px-4 py-2 border-t border-slate-800/60 text-xs text-slate-400">
      <span>
        Showing {shownCount} of {totalCount} rows
      </span>
      <button
        type="button"
        onClick={() => onShowMore(rowKey, step)}
        className="px-3 py-1 rounded bg-slate-800 hover:bg-slate-700 text-slate-100"
        data-report-load-more={rowKey}
      >
        Show more
      </button>
    </div>
  );
};

export default ReportLoadMoreFooter;
