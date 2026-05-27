import React from 'react';

interface SurveyCadCommandLineProps {
  selectionCount: number;
  entityCount: number;
  canUndo: boolean;
  canRedo: boolean;
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
  onSelectAll: () => void;
  onClearSelection: () => void;
  onErase: () => void;
  onUndo: () => void;
  onRedo: () => void;
}

const commandButtonClassName =
  'rounded border border-slate-700 bg-slate-950/70 px-1.5 py-1 text-[9px] font-semibold uppercase tracking-[0.1em] text-slate-100 transition-colors hover:border-cyan-500/70 hover:bg-slate-900 disabled:cursor-not-allowed disabled:border-slate-800 disabled:text-slate-500';

const SurveyCadCommandLine: React.FC<SurveyCadCommandLineProps> = ({
  selectionCount,
  entityCount,
  canUndo,
  canRedo,
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
  onSelectAll,
  onClearSelection,
  onErase,
  onUndo,
  onRedo,
}) => (
  <div className="flex min-h-0 items-center justify-between gap-3">
    <div className="flex flex-wrap items-center gap-1">
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
    <div className="flex shrink-0 flex-wrap items-center gap-2 text-[10px] uppercase tracking-[0.12em] text-slate-400">
        <span data-survey-cad-entity-count>{entityCount} entities</span>
        <span data-survey-cad-selection-count>{selectionCount} selected</span>
        <span>{historyDepth} undo</span>
        <span>{redoDepth} redo</span>
    </div>
  </div>
);

export default SurveyCadCommandLine;
