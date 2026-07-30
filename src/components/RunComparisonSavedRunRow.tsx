import React from 'react';

import type { SavedRunRowProps } from './RunComparisonPanel.types';

export const SavedRunRow = <TSettingsSnapshot, TRunDiagnostics>({
  snapshot,
  isCurrent,
  canCompare,
  onRestore,
  onCompare,
  onRename,
  onNotesChange,
  onDelete,
}: SavedRunRowProps<TSettingsSnapshot, TRunDiagnostics>) => {
  const [labelDraft, setLabelDraft] = React.useState(snapshot.label);
  const [notesDraft, setNotesDraft] = React.useState(snapshot.notes);

  React.useEffect(() => {
    setLabelDraft(snapshot.label);
    setNotesDraft(snapshot.notes);
  }, [snapshot.label, snapshot.notes]);

  return (
    <div
      className={`rounded border p-3 ${
        isCurrent
          ? 'border-cyan-500/70 bg-cyan-950/20'
          : 'border-slate-800 bg-slate-950/40'
      }`}
    >
      <div className="flex flex-col gap-2 lg:flex-row lg:items-start lg:justify-between">
        <div className="min-w-0 flex-1">
          <div className="flex flex-col gap-2 md:flex-row md:items-center">
            <input
              type="text"
              value={labelDraft}
              onChange={(event) => setLabelDraft(event.target.value)}
              onBlur={() => onRename(snapshot.id, labelDraft)}
              onKeyDown={(event) => {
                if (event.key === 'Enter') {
                  event.preventDefault();
                  (event.currentTarget as HTMLInputElement).blur();
                }
              }}
              className="min-w-0 flex-1 rounded border border-slate-700 bg-slate-950/60 px-3 py-2 font-mono text-sm text-slate-100"
              aria-label={`Saved run label ${snapshot.label}`}
            />
            <div className="text-xs text-slate-400">
              {snapshot.summary.converged ? 'Converged' : 'Not converged'} {' | '}SEUW{' '}
              {snapshot.summary.seuw.toFixed(4)} {' | '}Obs {snapshot.summary.observationCount}
            </div>
          </div>
          <div className="mt-2 text-xs text-slate-500">
            Saved {new Date(snapshot.savedAt).toLocaleString()}
          </div>
          <input
            type="text"
            value={notesDraft}
            onChange={(event) => setNotesDraft(event.target.value)}
            onBlur={() => onNotesChange(snapshot.id, notesDraft)}
            className="mt-2 w-full rounded border border-slate-800 bg-slate-950/50 px-3 py-2 text-xs text-slate-300"
            placeholder="Add saved-run notes"
            aria-label={`Saved run notes ${snapshot.label}`}
          />
        </div>
        <div className="flex flex-wrap items-center gap-2">
          {isCurrent && (
            <span className="rounded border border-cyan-700 bg-cyan-950/40 px-2 py-1 text-[11px] uppercase tracking-wide text-cyan-100">
              Current
            </span>
          )}
          <button
            type="button"
            onClick={() => onRestore(snapshot.id)}
            className="rounded border border-slate-700 bg-slate-950/60 px-3 py-2 text-xs uppercase tracking-wide text-slate-100 hover:border-cyan-400"
          >
            Restore
          </button>
          <button
            type="button"
            onClick={() => onCompare(snapshot.id)}
            disabled={!canCompare}
            className={`rounded border px-3 py-2 text-xs uppercase tracking-wide ${
              canCompare
                ? 'border-slate-700 bg-slate-950/60 text-slate-100 hover:border-cyan-400'
                : 'border-slate-800 bg-slate-950/40 text-slate-600'
            }`}
          >
            Compare
          </button>
          <button
            type="button"
            onClick={() => onDelete(snapshot.id)}
            className="rounded border border-rose-900/70 bg-rose-950/30 px-3 py-2 text-xs uppercase tracking-wide text-rose-200 hover:border-rose-500"
          >
            Delete
          </button>
        </div>
      </div>
    </div>
  );
};
