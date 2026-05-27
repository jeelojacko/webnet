import React from 'react';

interface SurveyCadCommandLineProps {
  selectionCount: number;
  canUndo: boolean;
  canRedo: boolean;
  activeCommandKey:
    | 'POINT'
    | 'COGO_POINT'
    | 'LINE'
    | 'PLINE'
    | 'ARC_3PT'
    | 'TANGENT_CURVE'
    | 'INVERSE'
    | 'MOVE'
    | 'COPY'
    | null;
  commandInputValue: string;
  statusText: string;
  commandHelpText: string;
  canUseActiveSnap: boolean;
  canFinishCommand: boolean;
  canCreateIntersectionPoint: boolean;
  onStartPoint: () => void;
  onStartCogoPoint: () => void;
  onStartLine: () => void;
  onStartPolyline: () => void;
  onStartArc3Point: () => void;
  onStartTangentCurve: () => void;
  onStartInverse: () => void;
  onStartMove: () => void;
  onStartCopy: () => void;
  onCreateIntersectionPoint: () => void;
  onCancelCommand: () => void;
  onFinishCommand: () => void;
  onCommandInputChange: (_value: string) => void;
  onSubmitCommand: () => void;
  onUseActiveSnap: () => void;
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
  activeCommandKey,
  commandInputValue,
  statusText,
  commandHelpText,
  canUseActiveSnap,
  canFinishCommand,
  canCreateIntersectionPoint,
  onStartPoint,
  onStartCogoPoint,
  onStartLine,
  onStartPolyline,
  onStartArc3Point,
  onStartTangentCurve,
  onStartInverse,
  onStartMove,
  onStartCopy,
  onCreateIntersectionPoint,
  onCancelCommand,
  onFinishCommand,
  onCommandInputChange,
  onSubmitCommand,
  onUseActiveSnap,
  onSelectAll,
  onClearSelection,
  onErase,
  onUndo,
  onRedo,
}) => (
  <div className="rounded-xl border border-slate-800 bg-slate-900/70 p-4">
    <div className="flex flex-wrap items-center gap-2">
      <button type="button" className={commandButtonClassName} onClick={onStartPoint}>
        POINT
      </button>
      <button type="button" className={commandButtonClassName} onClick={onStartCogoPoint}>
        COGO PT
      </button>
      <button type="button" className={commandButtonClassName} onClick={onStartLine}>
        LINE
      </button>
      <button type="button" className={commandButtonClassName} onClick={onStartPolyline}>
        PLINE
      </button>
      <button type="button" className={commandButtonClassName} onClick={onStartArc3Point}>
        ARC 3PT
      </button>
      <button type="button" className={commandButtonClassName} onClick={onStartTangentCurve}>
        TAN CURVE
      </button>
      <button type="button" className={commandButtonClassName} onClick={onStartInverse}>
        INVERSE
      </button>
      <button
        type="button"
        className={commandButtonClassName}
        onClick={onStartMove}
        disabled={selectionCount === 0}
      >
        MOVE
      </button>
      <button
        type="button"
        className={commandButtonClassName}
        onClick={onStartCopy}
        disabled={selectionCount === 0}
      >
        COPY
      </button>
      <button
        type="button"
        className={commandButtonClassName}
        onClick={onCreateIntersectionPoint}
        disabled={!canCreateIntersectionPoint}
      >
        INTX
      </button>
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
    <div className="mt-3 grid gap-2 md:grid-cols-[minmax(0,1fr)_auto_auto_auto]">
      <input
        type="text"
        value={commandInputValue}
        onChange={(event) => onCommandInputChange(event.target.value)}
        placeholder={
          activeCommandKey
            ? activeCommandKey === 'POINT'
              ? 'x,y or LABEL=x,y'
              : activeCommandKey === 'COGO_POINT'
                ? 'snap base, then @azimuth,distance or N45-00-00E,100'
              : activeCommandKey === 'TANGENT_CURVE'
                ? 'point picks, then numeric radius'
              : activeCommandKey === 'PLINE' || activeCommandKey === 'LINE' || activeCommandKey === 'ARC_3PT' || activeCommandKey === 'INVERSE' || activeCommandKey === 'MOVE' || activeCommandKey === 'COPY'
                ? 'x,y or @azimuth,distance or N45-00-00E,100'
                : 'x,y'
            : 'Start POINT, LINE, or INVERSE to use typed input'
        }
        className="rounded-md border border-slate-700 bg-slate-950/70 px-3 py-2 text-sm text-slate-100 outline-none transition-colors placeholder:text-slate-500 focus:border-cyan-500/70"
        disabled={activeCommandKey == null}
      />
      <button
        type="button"
        className={commandButtonClassName}
        onClick={onUseActiveSnap}
        disabled={!canUseActiveSnap}
      >
        Use Snap
      </button>
      <button
        type="button"
        className={commandButtonClassName}
        onClick={onFinishCommand}
        disabled={!canFinishCommand}
      >
        Finish PLINE
      </button>
      <button
        type="button"
        className={commandButtonClassName}
        onClick={activeCommandKey ? onSubmitCommand : onCancelCommand}
        disabled={activeCommandKey == null}
      >
        Submit
      </button>
    </div>
    <div className="mt-2 flex flex-wrap items-center justify-between gap-2 text-[11px] text-slate-400">
      <span data-survey-cad-command-help>{commandHelpText}</span>
      {activeCommandKey ? (
        <button
          type="button"
          className="rounded-md border border-slate-800 bg-slate-950/60 px-2 py-1 text-[11px] uppercase tracking-[0.18em] text-slate-300 transition-colors hover:border-rose-500/70 hover:text-rose-200"
          onClick={onCancelCommand}
        >
          Cancel {activeCommandKey}
        </button>
      ) : null}
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
