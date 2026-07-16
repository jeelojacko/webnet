import React from 'react';

export interface SurveyCadBatchCogoDraftView {
  inputValue: string;
  startPoint: { label: string; x: number; y: number } | null;
  startPointSource: 'selected' | 'input' | null;
  endPoint: { label: string; x: number; y: number } | null;
  previewRows: Array<{
    lineNumber: number;
    input: string;
    kind: 'start' | 'line' | 'curve';
    status: 'ok' | 'warning' | 'error';
    summary: string;
  }>;
  warnings: Array<{
    code: string;
    message: string;
    severity: 'info' | 'warning' | 'error';
  }>;
  generatedPointCount: number;
  generatedLineCount: number;
  generatedArcCount: number;
  canCommit: boolean;
}

interface SurveyCadBatchCogoPanelProps {
  draft: SurveyCadBatchCogoDraftView;
  onInputChange: (_value: string) => void;
  onCommit: () => void;
  onCancel: () => void;
}

const panelButtonClassName =
  'pointer-events-auto rounded border border-slate-700 px-2 py-1 text-[11px] text-slate-200 enabled:hover:border-cyan-400 enabled:hover:text-cyan-200 disabled:cursor-not-allowed disabled:opacity-40';

const getRowStatusClassName = (status: SurveyCadBatchCogoDraftView['previewRows'][number]['status']) =>
  status === 'ok' ? 'text-cyan-200' : status === 'warning' ? 'text-amber-200' : 'text-rose-200';

const SurveyCadBatchCogoPanel: React.FC<SurveyCadBatchCogoPanelProps> = ({
  draft,
  onInputChange,
  onCommit,
  onCancel,
}) => (
  <div
    className="absolute right-4 top-20 z-20 w-[28rem] rounded border border-slate-700/80 bg-slate-950/90 p-3 text-xs text-slate-100 shadow-xl"
    data-survey-cad-batch-cogo-draft
  >
    <div className="mb-2 flex items-center justify-between">
      <span className="font-semibold tracking-wide text-cyan-200">Batch COGO</span>
      <span className="text-slate-400">
        {draft.generatedPointCount} pts / {draft.generatedLineCount} lines / {draft.generatedArcCount} arcs
      </span>
    </div>
    <div className="mb-2 grid grid-cols-[auto,1fr] gap-x-3 gap-y-1 text-[11px] text-slate-300">
      <span>Start</span>
      <span data-survey-cad-batch-cogo-start>
        {draft.startPoint ? `${draft.startPoint.label} (${draft.startPointSource ?? 'input'})` : '--'}
      </span>
      <span>End</span>
      <span data-survey-cad-batch-cogo-end>{draft.endPoint?.label ?? '--'}</span>
    </div>
    <textarea
      className="mb-2 h-32 w-full rounded border border-slate-700 bg-slate-900 px-2 py-1 text-[11px] text-slate-100 outline-none focus:border-cyan-400"
      placeholder={'START POB=1000,1000\nP1=N45-00-00E,100\nCURVE RIGHT R 50 DELTA 30'}
      value={draft.inputValue}
      onChange={(event) => onInputChange(event.target.value)}
      data-survey-cad-batch-cogo-input
    />
    <div className="mb-2 flex gap-2">
      <button
        type="button"
        className={panelButtonClassName}
        onClick={onCommit}
        disabled={!draft.canCommit}
        data-survey-cad-batch-cogo-commit
      >
        Commit
      </button>
      <button
        type="button"
        className="pointer-events-auto rounded border border-slate-700 px-2 py-1 text-[11px] text-slate-200 hover:border-cyan-400 hover:text-cyan-200"
        onClick={onCancel}
        data-survey-cad-batch-cogo-cancel
      >
        Cancel
      </button>
    </div>
    <div className="mb-2 max-h-40 overflow-auto rounded border border-slate-800/80 bg-slate-900/60 p-2 text-[11px]">
      {draft.previewRows.length === 0 ? (
        <div className="text-slate-400">Paste deed rows to preview generated geometry.</div>
      ) : (
        draft.previewRows.map((row) => (
          <div
            key={`${row.lineNumber}:${row.input}`}
            className="mb-1 border-b border-slate-800/70 pb-1 last:mb-0 last:border-b-0 last:pb-0"
            data-survey-cad-batch-cogo-row
          >
            <div className="flex items-center justify-between gap-2">
              <span className="text-slate-200">
                Row {row.lineNumber} · {row.kind}
              </span>
              <span className={getRowStatusClassName(row.status)}>{row.status}</span>
            </div>
            <div className="text-slate-400">{row.input}</div>
            <div>{row.summary}</div>
          </div>
        ))
      )}
    </div>
    {draft.warnings.length > 0 ? (
      <div
        className="rounded border border-amber-900/60 bg-amber-950/20 p-2 text-[11px] text-amber-100"
        data-survey-cad-batch-cogo-warnings
      >
        {draft.warnings.map((warning) => (
          <div key={`${warning.code}:${warning.message}`}>
            [{warning.severity}] {warning.message}
          </div>
        ))}
      </div>
    ) : null}
  </div>
);

export default SurveyCadBatchCogoPanel;
