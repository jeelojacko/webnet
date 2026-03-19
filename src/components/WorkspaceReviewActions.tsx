import React from 'react';

interface WorkspaceReviewActionsProps {
  canNavigateSuspects: boolean;
  canJumpToInput: boolean;
  canPinSelectedObservation: boolean;
  isSelectedObservationPinned: boolean;
  onSelectPreviousSuspect: () => void;
  onSelectNextSuspect: () => void;
  onJumpToInput: () => void;
  onTogglePinSelectedObservation: () => void;
  onFocusReportFilter: () => void;
}

const actionClassName =
  'rounded border border-slate-700 bg-slate-900/70 px-2 py-1 text-[11px] uppercase tracking-wide text-slate-200 hover:border-cyan-400';
const disabledActionClassName =
  'rounded border border-slate-800 bg-slate-950/40 px-2 py-1 text-[11px] uppercase tracking-wide text-slate-600';

const WorkspaceReviewActions: React.FC<WorkspaceReviewActionsProps> = ({
  canNavigateSuspects,
  canJumpToInput,
  canPinSelectedObservation,
  isSelectedObservationPinned,
  onSelectPreviousSuspect,
  onSelectNextSuspect,
  onJumpToInput,
  onTogglePinSelectedObservation,
  onFocusReportFilter,
}) => (
  <div className="border-b border-slate-800 bg-slate-950/90 px-4 py-2 text-xs text-slate-300">
    <div className="flex flex-wrap items-center gap-2">
      <span className="text-[11px] uppercase tracking-[0.2em] text-slate-500">QA Review</span>
      <button
        type="button"
        data-qa-review-action="prev-suspect"
        onClick={onSelectPreviousSuspect}
        disabled={!canNavigateSuspects}
        className={canNavigateSuspects ? actionClassName : disabledActionClassName}
      >
        Prev suspect
      </button>
      <button
        type="button"
        data-qa-review-action="next-suspect"
        onClick={onSelectNextSuspect}
        disabled={!canNavigateSuspects}
        className={canNavigateSuspects ? actionClassName : disabledActionClassName}
      >
        Next suspect
      </button>
      <button
        type="button"
        data-qa-review-action="focus-filter"
        onClick={onFocusReportFilter}
        className={actionClassName}
      >
        Focus filter
      </button>
      <button
        type="button"
        data-qa-review-action="jump-input"
        onClick={onJumpToInput}
        disabled={!canJumpToInput}
        className={canJumpToInput ? actionClassName : disabledActionClassName}
      >
        Jump to input
      </button>
      <button
        type="button"
        data-qa-review-action="pin-selected"
        onClick={onTogglePinSelectedObservation}
        disabled={!canPinSelectedObservation}
        className={canPinSelectedObservation ? actionClassName : disabledActionClassName}
      >
        {isSelectedObservationPinned ? 'Unpin selected' : 'Pin selected'}
      </button>
    </div>
  </div>
);

export default WorkspaceReviewActions;
