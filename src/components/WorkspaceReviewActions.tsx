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
  className?: string;
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
  className = '',
}) => (
  <div className={`text-xs text-slate-300 ${className}`.trim()}>
    <div className="flex flex-wrap items-center gap-2">
      <span
        className="text-[11px] uppercase tracking-[0.2em] text-slate-500"
        title="Quick review actions for stepping through suspects, jumping to the source input, pinning the active observation, or focusing the report filter."
      >
        QA Review
      </span>
      <button
        type="button"
        data-qa-review-action="prev-suspect"
        onClick={onSelectPreviousSuspect}
        disabled={!canNavigateSuspects}
        title="Select the previous suspect observation and return review focus to it."
        className={canNavigateSuspects ? actionClassName : disabledActionClassName}
      >
        Prev suspect
      </button>
      <button
        type="button"
        data-qa-review-action="next-suspect"
        onClick={onSelectNextSuspect}
        disabled={!canNavigateSuspects}
        title="Select the next suspect observation and return review focus to it."
        className={canNavigateSuspects ? actionClassName : disabledActionClassName}
      >
        Next suspect
      </button>
      <button
        type="button"
        data-qa-review-action="focus-filter"
        onClick={onFocusReportFilter}
        title="Open the report tab if needed and focus the report filter input."
        className={actionClassName}
      >
        Focus filter
      </button>
      <button
        type="button"
        data-qa-review-action="jump-input"
        onClick={onJumpToInput}
        disabled={!canJumpToInput}
        title="Jump the input editor to the source line for the current selection."
        className={canJumpToInput ? actionClassName : disabledActionClassName}
      >
        Jump to input
      </button>
      <button
        type="button"
        data-qa-review-action="pin-selected"
        onClick={onTogglePinSelectedObservation}
        disabled={!canPinSelectedObservation}
        title="Pin or unpin the currently selected observation for quick return navigation."
        className={canPinSelectedObservation ? actionClassName : disabledActionClassName}
      >
        {isSelectedObservationPinned ? 'Unpin selected' : 'Pin selected'}
      </button>
    </div>
  </div>
);

export default WorkspaceReviewActions;
