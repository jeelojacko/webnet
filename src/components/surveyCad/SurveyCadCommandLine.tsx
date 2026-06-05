import React from 'react';
import { flushSync } from 'react-dom';

interface SurveyCadCommandLineProps {
  selectionCount: number;
  entityCount: number;
  canUndo: boolean;
  canRedo: boolean;
  historyDepth: number;
  redoDepth: number;
  canCreateIntersectionPoint: boolean;
  canCreateParcel: boolean;
  canContinueCurve: boolean;
  onStartPoint: () => void;
  onStartCogoPoint: () => void;
  onStartLine: () => void;
  onStartPolyline: () => void;
  onStartTraverse: () => void;
  onStartArc3Point: () => void;
  onStartArcStartCenterEnd: () => void;
  onStartArcCenterStartEnd: () => void;
  onStartArcStartCenterAngle: () => void;
  onStartArcCenterStartAngle: () => void;
  onStartArcStartCenterChord: () => void;
  onStartArcCenterStartChord: () => void;
  onStartArcStartEndAngle: () => void;
  onStartArcStartEndDirection: () => void;
  onStartArcStartEndRadius: () => void;
  onStartContinueCurve: () => void;
  onStartTangentCurve: () => void;
  onStartInverse: () => void;
  onStartMove: () => void;
  onStartCopy: () => void;
  onCreateIntersectionPoint: () => void;
  onCreateParcel: () => void;
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
  canCreateParcel,
  canContinueCurve,
  onStartPoint,
  onStartCogoPoint,
  onStartLine,
  onStartPolyline,
  onStartTraverse,
  onStartArc3Point,
  onStartArcStartCenterEnd,
  onStartArcCenterStartEnd,
  onStartArcStartCenterAngle,
  onStartArcCenterStartAngle,
  onStartArcStartCenterChord,
  onStartArcCenterStartChord,
  onStartArcStartEndAngle,
  onStartArcStartEndDirection,
  onStartArcStartEndRadius,
  onStartContinueCurve,
  onStartTangentCurve,
  onStartInverse,
  onStartMove,
  onStartCopy,
  onCreateIntersectionPoint,
  onCreateParcel,
  onSelectAll,
  onClearSelection,
  onErase,
  onUndo,
  onRedo,
}) => {
  const [arcMenuOpen, setArcMenuOpen] = React.useState(false);
  const runImmediate = (action: () => void) => {
    flushSync(() => {
      action();
    });
  };

  return (
  <div className="flex min-h-0 items-center justify-between gap-3">
    <div className="flex flex-wrap items-center gap-1">
      <button type="button" className={commandButtonClassName} onClick={() => runImmediate(onStartPoint)} title="Point">
        POINT
      </button>
      <button type="button" className={commandButtonClassName} onClick={() => runImmediate(onStartCogoPoint)} title="COGO Point">
        COGO
      </button>
      <button type="button" className={commandButtonClassName} onClick={() => runImmediate(onStartLine)} title="Line">
        LINE
      </button>
      <button type="button" className={commandButtonClassName} onClick={() => runImmediate(onStartPolyline)} title="Polyline">
        PLINE
      </button>
      <button type="button" className={commandButtonClassName} onClick={() => runImmediate(onStartTraverse)} title="Traverse">
        TRAV
      </button>
      <div className="relative flex items-stretch" data-survey-cad-arc-tool>
        <button type="button" className={commandButtonClassName} onClick={() => runImmediate(onStartArc3Point)} title="Arc 3 Point">
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
            <button type="button" className={arcMenuButtonClassName} onClick={() => { setArcMenuOpen(false); runImmediate(onStartArc3Point); }}>
              3 Point
            </button>
            <button type="button" className={arcMenuButtonClassName} onClick={() => { setArcMenuOpen(false); runImmediate(onStartArcStartCenterEnd); }}>
              Start Center End
            </button>
            <button type="button" className={arcMenuButtonClassName} onClick={() => { setArcMenuOpen(false); runImmediate(onStartArcStartCenterAngle); }}>
              Start Center Angle
            </button>
            <button type="button" className={arcMenuButtonClassName} onClick={() => { setArcMenuOpen(false); runImmediate(onStartArcStartCenterChord); }}>
              Start Center Length
            </button>
            <button type="button" className={arcMenuButtonClassName} onClick={() => { setArcMenuOpen(false); runImmediate(onStartArcStartEndAngle); }}>
              Start End Angle
            </button>
            <button type="button" className={arcMenuButtonClassName} onClick={() => { setArcMenuOpen(false); runImmediate(onStartArcStartEndDirection); }}>
              Start End Direction
            </button>
            <button type="button" className={arcMenuButtonClassName} onClick={() => { setArcMenuOpen(false); runImmediate(onStartArcStartEndRadius); }}>
              Start End Radius
            </button>
            <button type="button" className={arcMenuButtonClassName} onClick={() => { setArcMenuOpen(false); runImmediate(onStartArcCenterStartEnd); }}>
              Center Start End
            </button>
            <button type="button" className={arcMenuButtonClassName} onClick={() => { setArcMenuOpen(false); runImmediate(onStartArcCenterStartAngle); }}>
              Center Start Angle
            </button>
            <button type="button" className={arcMenuButtonClassName} onClick={() => { setArcMenuOpen(false); runImmediate(onStartArcCenterStartChord); }}>
              Center Start Length
            </button>
            <button type="button" className={arcMenuButtonClassName} onClick={() => { setArcMenuOpen(false); runImmediate(onStartTangentCurve); }}>
              Tangent Curve
            </button>
            <button
              type="button"
              className={arcMenuButtonClassName}
              onClick={() => { setArcMenuOpen(false); runImmediate(onStartContinueCurve); }}
              disabled={!canContinueCurve}
            >
              Continue Curve
            </button>
          </div>
        ) : null}
      </div>
      <button type="button" className={commandButtonClassName} onClick={() => runImmediate(onStartInverse)} title="Inverse">
        INV
      </button>
      <button
        type="button"
        className={commandButtonClassName}
        onClick={() => runImmediate(onStartMove)}
        disabled={selectionCount === 0}
        title="Move"
      >
        MOVE
      </button>
      <button
        type="button"
        className={commandButtonClassName}
        onClick={() => runImmediate(onStartCopy)}
        disabled={selectionCount === 0}
        title="Copy"
      >
        COPY
      </button>
      <button
        type="button"
        className={commandButtonClassName}
        onClick={() => runImmediate(onCreateIntersectionPoint)}
        disabled={!canCreateIntersectionPoint}
        title="Intersection Point"
      >
        INTX
      </button>
      <button
        type="button"
        className={commandButtonClassName}
        onClick={() => runImmediate(onCreateParcel)}
        disabled={!canCreateParcel}
        title="Create Parcel"
      >
        PARCEL
      </button>
      <button type="button" className={commandButtonClassName} onClick={() => runImmediate(onSelectAll)} title="Select All">
        S-ALL
      </button>
      <button
        type="button"
        className={commandButtonClassName}
        onClick={() => runImmediate(onClearSelection)}
        disabled={selectionCount === 0}
        title="Clear Selection"
      >
        CLEAR
      </button>
      <button
        type="button"
        className={commandButtonClassName}
        onClick={() => runImmediate(onErase)}
        disabled={selectionCount === 0}
        title="Erase"
      >
        ERASE
      </button>
      <button
        type="button"
        className={commandButtonClassName}
        onClick={() => runImmediate(onUndo)}
        disabled={!canUndo}
        title="Undo"
      >
        UNDO
      </button>
      <button
        type="button"
        className={commandButtonClassName}
        onClick={() => runImmediate(onRedo)}
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
