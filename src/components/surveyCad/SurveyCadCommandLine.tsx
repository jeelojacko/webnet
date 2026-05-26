import React from 'react';

interface SurveyCadCommandLineProps {
  selectionCount: number;
  canUndo: boolean;
  canRedo: boolean;
  statusText: string;
  onSelectAll: () => void;
  onClearSelection: () => void;
  onErase: () => void;
  onUndo: () => void;
  onRedo: () => void;
}

const commandButtonClassName =
  'rounded-md border border-slate-700 bg-slate-950/70 px-3 py-2 text-xs font-semibold uppercase tracking-[0.18em] text-slate-100 transition-colors hover:border-cyan-500/70 hover:bg-slate-900 disabled:cursor-not-allowed disabled:border-slate-800 disabled:text-slate-500';

const SurveyCadCommandLine: React.FC<SurveyCadCommandLineProps> = ({
  selectionCount,
  canUndo,
  canRedo,
  statusText,
  onSelectAll,
  onClearSelection,
  onErase,
  onUndo,
  onRedo,
}) => (
  <div className="rounded-xl border border-slate-800 bg-slate-900/70 p-4">
    <div className="flex flex-wrap items-center gap-2">
      <button type="button" className={commandButtonClassName} onClick={onSelectAll}>
        Select All
      </button>
      <button
        type="button"
        className={commandButtonClassName}
        onClick={onClearSelection}
        disabled={selectionCount === 0}
      >
        Clear Selection
      </button>
      <button
        type="button"
        className={commandButtonClassName}
        onClick={onErase}
        disabled={selectionCount === 0}
      >
        ERASE
      </button>
      <button type="button" className={commandButtonClassName} onClick={onUndo} disabled={!canUndo}>
        Undo
      </button>
      <button type="button" className={commandButtonClassName} onClick={onRedo} disabled={!canRedo}>
        Redo
      </button>
    </div>
    <div
      className="mt-3 rounded-lg border border-slate-800 bg-slate-950/60 px-3 py-2 text-xs text-slate-300"
      data-survey-cad-command-status
    >
      {statusText}
    </div>
  </div>
);

export default SurveyCadCommandLine;
