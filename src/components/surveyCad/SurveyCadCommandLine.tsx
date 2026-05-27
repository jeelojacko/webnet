import React from 'react';

interface SurveyCadCommandLineProps {
  selectionCount: number;
  entityCount: number;
  canUndo: boolean;
  canRedo: boolean;
  historyDepth: number;
  redoDepth: number;
  canCreateIntersectionPoint: boolean;
  canContinueCurve: boolean;
  onStartPoint: () => void;
  onStartCogoPoint: () => void;
  onStartLine: () => void;
  onStartPolyline: () => void;
  onStartTraverse: () => void;
  onStartArc3Point: () => void;
  onStartArcStartCenterEnd: () => void;
  onStartArcStartCenterAngle: () => void;
  onStartArcStartCenterChord: () => void;
  onStartArcStartEndAngle: () => void;
  onStartArcStartEndDirection: () => void;
  onStartArcStartEndRadius: () => void;
  onStartContinueCurve: () => void;
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

const arcMenuButtonClassName =
  'w-full rounded border border-slate-700 bg-slate-950/85 px-2 py-1 text-left text-[10px] font-semibold uppercase tracking-[0.08em] text-slate-100 transition-colors hover:border-cyan-500/70 hover:bg-slate-900';

const SurveyCadCommandLine: React.FC<SurveyCadCommandLineProps> = ({
  selectionCount,
  entityCount,
  canUndo,
  canRedo,
  historyDepth,
  redoDepth,
  canCreateIntersectionPoint,
  canContinueCurve,
  onStartPoint,
  onStartCogoPoint,
  onStartLine,
  onStartPolyline,
  onStartTraverse,
  onStartArc3Point,
  onStartArcStartCenterEnd,
  onStartArcStartCenterAngle,
  onStartArcStartCenterChord,
  onStartArcStartEndAngle,
  onStartArcStartEndDirection,
  onStartArcStartEndRadius,
  onStartContinueCurve,
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
}) => {
  const [arcMenuOpen, setArcMenuOpen] = React.useState(false);

  return (
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
      <div className="relative flex items-stretch" data-survey-cad-arc-tool>
        <button type="button" className={commandButtonClassName} onClick={onStartArc3Point} title="Arc 3 Point">
          ARC
        </button>
        <button
          type="button"
          className={commandButtonClassName}
          onClick={() => setArcMenuOpen((current) => !current)}
          title="Arc Modes"
          data-survey-cad-arc-menu-button
        >
          ▾
        </button>
        {arcMenuOpen ? (
          <div
            className="absolute left-0 top-full z-20 mt-1 grid min-w-56 gap-1 rounded border border-slate-700 bg-slate-950/95 p-2 shadow-xl"
            data-survey-cad-arc-menu
          >
            <button type="button" className={arcMenuButtonClassName} onClick={() => { setArcMenuOpen(false); onStartArc3Point(); }}>
              3 Point
            </button>
            <button type="button" className={arcMenuButtonClassName} onClick={() => { setArcMenuOpen(false); onStartArcStartCenterEnd(); }}>
              Start Center End
            </button>
            <button type="button" className={arcMenuButtonClassName} onClick={() => { setArcMenuOpen(false); onStartArcStartCenterAngle(); }}>
              Start Center Angle
            </button>
            <button type="button" className={arcMenuButtonClassName} onClick={() => { setArcMenuOpen(false); onStartArcStartCenterChord(); }}>
              Start Center Length
            </button>
            <button type="button" className={arcMenuButtonClassName} onClick={() => { setArcMenuOpen(false); onStartArcStartEndAngle(); }}>
              Start End Angle
            </button>
            <button type="button" className={arcMenuButtonClassName} onClick={() => { setArcMenuOpen(false); onStartArcStartEndDirection(); }}>
              Start End Direction
            </button>
            <button type="button" className={arcMenuButtonClassName} onClick={() => { setArcMenuOpen(false); onStartArcStartEndRadius(); }}>
              Start End Radius
            </button>
            <button type="button" className={arcMenuButtonClassName} onClick={() => { setArcMenuOpen(false); onStartArcStartCenterEnd(); }}>
              Center Start End
            </button>
            <button type="button" className={arcMenuButtonClassName} onClick={() => { setArcMenuOpen(false); onStartArcStartCenterAngle(); }}>
              Center Start Angle
            </button>
            <button type="button" className={arcMenuButtonClassName} onClick={() => { setArcMenuOpen(false); onStartArcStartCenterChord(); }}>
              Center Start Length
            </button>
            <button type="button" className={arcMenuButtonClassName} onClick={() => { setArcMenuOpen(false); onStartTangentCurve(); }}>
              Tangent Curve
            </button>
            <button
              type="button"
              className={arcMenuButtonClassName}
              onClick={() => { setArcMenuOpen(false); onStartContinueCurve(); }}
              disabled={!canContinueCurve}
            >
              Continue Curve
            </button>
          </div>
        ) : null}
      </div>
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
};

export default SurveyCadCommandLine;
