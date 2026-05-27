import React from 'react';

interface SurveyCadCommandLineProps {
  selectionCount: number;
  entityCount: number;
  canUndo: boolean;
  canRedo: boolean;
  activeCommandKey:
    | 'POINT'
    | 'COGO_POINT'
    | 'LINE'
    | 'PLINE'
    | 'TRAVERSE'
    | 'ARC_3PT'
    | 'TANGENT_CURVE'
    | 'INVERSE'
    | 'MOVE'
    | 'COPY'
    | null;
  commandInputValue: string;
  statusText: string;
  commandHelpText: string;
  snapStatusText: string;
  historyDepth: number;
  redoDepth: number;
  canCreateIntersectionPoint: boolean;
  onStartPoint: () => void;
  onStartCogoPoint: () => void;
  onStartLine: () => void;
  onStartPolyline: () => void;
  onStartTraverse: () => void;
  onStartArc3Point: () => void;
  onStartTangentCurve: () => void;
  onStartInverse: () => void;
  onStartMove: () => void;
  onStartCopy: () => void;
  onCreateIntersectionPoint: () => void;
  onCommandInputChange: (_value: string) => void;
  onSelectAll: () => void;
  onClearSelection: () => void;
  onErase: () => void;
  onUndo: () => void;
  onRedo: () => void;
  onEnterKey: () => void;
  onEscapeKey: () => void;
}

const commandButtonClassName =
  'rounded border border-slate-700 bg-slate-950/70 px-2 py-1 text-[10px] font-semibold uppercase tracking-[0.14em] text-slate-100 transition-colors hover:border-cyan-500/70 hover:bg-slate-900 disabled:cursor-not-allowed disabled:border-slate-800 disabled:text-slate-500';

const SurveyCadCommandLine: React.FC<SurveyCadCommandLineProps> = ({
  selectionCount,
  entityCount,
  canUndo,
  canRedo,
  activeCommandKey,
  commandInputValue,
  statusText,
  commandHelpText,
  snapStatusText,
  historyDepth,
  redoDepth,
  canCreateIntersectionPoint,
  onStartPoint,
  onStartCogoPoint,
  onStartLine,
  onStartPolyline,
  onStartTraverse,
  onStartArc3Point,
  onStartTangentCurve,
  onStartInverse,
  onStartMove,
  onStartCopy,
  onCreateIntersectionPoint,
  onCommandInputChange,
  onSelectAll,
  onClearSelection,
  onErase,
  onUndo,
  onRedo,
  onEnterKey,
  onEscapeKey,
}) => (
  <div className="flex min-h-0 flex-col gap-2">
    <div className="flex flex-wrap items-center gap-1.5">
      <button type="button" className={commandButtonClassName} onClick={onStartPoint} title="Point">
        POINT
      </button>
      <button type="button" className={commandButtonClassName} onClick={onStartCogoPoint} title="COGO Point">
        COGO
      </button>
      <button type="button" className={commandButtonClassName} onClick={onStartLine} title="Line">
        LINE
      </button>
      <button type="button" className={commandButtonClassName} onClick={onStartPolyline} title="Polyline">
        PLINE
      </button>
      <button type="button" className={commandButtonClassName} onClick={onStartTraverse} title="Traverse">
        TRAV
      </button>
      <button type="button" className={commandButtonClassName} onClick={onStartArc3Point} title="Arc 3 Point">
        ARC
      </button>
      <button type="button" className={commandButtonClassName} onClick={onStartTangentCurve} title="Tangent Curve">
        TCURVE
      </button>
      <button type="button" className={commandButtonClassName} onClick={onStartInverse} title="Inverse">
        INV
      </button>
      <button
        type="button"
        className={commandButtonClassName}
        onClick={onStartMove}
        disabled={selectionCount === 0}
        title="Move"
      >
        MOVE
      </button>
      <button
        type="button"
        className={commandButtonClassName}
        onClick={onStartCopy}
        disabled={selectionCount === 0}
        title="Copy"
      >
        COPY
      </button>
      <button
        type="button"
        className={commandButtonClassName}
        onClick={onCreateIntersectionPoint}
        disabled={!canCreateIntersectionPoint}
        title="Intersection Point"
      >
        INTX
      </button>
      <button type="button" className={commandButtonClassName} onClick={onSelectAll} title="Select All">
        S-ALL
      </button>
      <button
        type="button"
        className={commandButtonClassName}
        onClick={onClearSelection}
        disabled={selectionCount === 0}
        title="Clear Selection"
      >
        CLEAR
      </button>
      <button
        type="button"
        className={commandButtonClassName}
        onClick={onErase}
        disabled={selectionCount === 0}
        title="Erase"
      >
        ERASE
      </button>
      <button
        type="button"
        className={commandButtonClassName}
        onClick={onUndo}
        disabled={!canUndo}
        title="Undo"
      >
        UNDO
      </button>
      <button
        type="button"
        className={commandButtonClassName}
        onClick={onRedo}
        disabled={!canRedo}
        title="Redo"
      >
        REDO
      </button>
    </div>
    <div className="grid gap-2 md:grid-cols-[minmax(0,1fr)_auto]">
      <input
        type="text"
        value={commandInputValue}
        onChange={(event) => onCommandInputChange(event.target.value)}
        onKeyDown={(event) => {
          if (event.key === 'Enter') {
            event.preventDefault();
            onEnterKey();
          } else if (event.key === 'Escape') {
            event.preventDefault();
            onEscapeKey();
          }
        }}
        placeholder={
          activeCommandKey
            ? activeCommandKey === 'POINT'
              ? 'click in model space or type x,y / LABEL=x,y'
              : activeCommandKey === 'COGO_POINT'
                ? 'click base/target or type @azimuth,distance'
                : activeCommandKey === 'TRAVERSE'
                  ? 'click start / next point or type bearing-distance'
                : activeCommandKey === 'TANGENT_CURVE'
                  ? 'click tangent points or type radius'
                  : 'click in model space or type x,y / bearing-distance'
            : 'choose a command, then click in model space or type coordinates'
        }
        className="min-w-0 rounded border border-slate-700 bg-slate-950/70 px-3 py-1.5 text-xs text-slate-100 outline-none transition-colors placeholder:text-slate-500 focus:border-cyan-500/70"
        disabled={activeCommandKey == null}
      />
      <div className="flex flex-wrap items-center gap-2 text-[10px] uppercase tracking-[0.14em] text-slate-400">
        <span data-survey-cad-entity-count>{entityCount} entities</span>
        <span data-survey-cad-selection-count>{selectionCount} selected</span>
        <span>{historyDepth} undo</span>
        <span>{redoDepth} redo</span>
      </div>
    </div>
    <div className="flex flex-wrap items-center justify-between gap-2 text-[11px] text-slate-400">
      <span data-survey-cad-command-help>{commandHelpText}</span>
      <span data-survey-cad-snap-status>{snapStatusText}</span>
    </div>
    <div
      className="rounded border border-slate-800 bg-slate-950/60 px-3 py-2 text-xs text-slate-300"
      data-survey-cad-command-status
    >
      {statusText}
    </div>
  </div>
);

export default SurveyCadCommandLine;
