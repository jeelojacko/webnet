import React from 'react';
import { flushSync } from 'react-dom';

interface SurveyCadCommandLineProps {
  selectionCount: number;
  entityCount: number;
  canUndo: boolean;
  canRedo: boolean;
  historyDepth: number;
  redoDepth: number;
  canUseSelectedLineCoreCogo: boolean;
  canUseSelectedLinePairIntersection: boolean;
  canUseSelectedArcCurveCogo: boolean;
  canCreateIntersectionPoint: boolean;
  canCreateAlignment: boolean;
  canReportAlignmentStation: boolean;
  canCreateAlignmentOffset: boolean;
  canCreateAlignmentStationEquation: boolean;
  canCreateAlignmentOffsetPoint: boolean;
  canCreateAlignmentIntervalPoints: boolean;
  canCreateParcel: boolean;
  canSplitParcelByBearing: boolean;
  canSplitParcelByArea: boolean;
  canSplitParcelBySlide: boolean;
  canSplitParcelBySwing: boolean;
  canReportParcelGap: boolean;
  canReportParcelDiagnostics: boolean;
  canReportParcelOverlap: boolean;
  canSplitParcelByLine: boolean;
  canContinueCurve: boolean;
  canTrimSelection: boolean;
  canExtendSelection: boolean;
  onStartPoint: () => void;
  onStartCogoPoint: () => void;
  onStartLine: () => void;
  onStartPolyline: () => void;
  onStartTraverse: () => void;
  onStartBatchCogo: () => void;
  onStartParcelSplitBearing: () => void;
  onStartParcelSplitArea: () => void;
  onSplitParcelBySlide: () => void;
  onSplitParcelBySwing: () => void;
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
  onStartMultiInverse: () => void;
  onStartArea: () => void;
  onStartBearingReport: () => void;
  onStartDistanceReport: () => void;
  onStartTurnedPoint: () => void;
  onStartDeflectionPoint: () => void;
  onStartPointAlongLine: () => void;
  onStartExtendLine: () => void;
  onStartOffsetPoint: () => void;
  onStartAlignmentOffsetCreate: () => void;
  onStartAlignmentStationEquation: () => void;
  onStartAlignmentOffsetPoint: () => void;
  onStartAlignmentIntervalPoints: () => void;
  onStartCurveSolver: () => void;
  onStartRadialBearing: () => void;
  onStartPointOnCurve: () => void;
  onStartSubdivideCurve: () => void;
  onStartOffsetCurve: () => void;
  onStartPiCurve: () => void;
  onStartChordBearingCurve: () => void;
  onStartReverseCurve: () => void;
  onStartCompoundCurve: () => void;
  onStartBearingBearingIntersection: () => void;
  onStartBearingDistanceIntersection: () => void;
  onStartDistanceDistanceIntersection: () => void;
  onStartLineCircleIntersection: () => void;
  onStartPerpendicularIntersection: () => void;
  onStartOffsetIntersection: () => void;
  onStartSkewIntersection: () => void;
  onStartMove: () => void;
  onStartCopy: () => void;
  onStartExtend: () => void;
  onStartTrim: () => void;
  onStartFillet: () => void;
  onCreateIntersectionPoint: () => void;
  onCreateAlignment: () => void;
  onReportAlignmentStation: () => void;
  onCreateParcel: () => void;
  onReportParcelGap: () => void;
  onReportParcelDiagnostics: () => void;
  onReportParcelOverlap: () => void;
  onSplitParcelByLine: () => void;
  onToggleParcelLayoutPanel: () => void;
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
  canUseSelectedLineCoreCogo,
  canUseSelectedLinePairIntersection,
  canUseSelectedArcCurveCogo,
  canCreateIntersectionPoint,
  canCreateAlignment,
  canReportAlignmentStation,
  canCreateAlignmentOffset,
  canCreateAlignmentStationEquation,
  canCreateAlignmentOffsetPoint,
  canCreateAlignmentIntervalPoints,
  canCreateParcel,
  canSplitParcelByBearing,
  canSplitParcelByArea,
  canSplitParcelBySlide,
  canSplitParcelBySwing,
  canReportParcelGap,
  canReportParcelDiagnostics,
  canReportParcelOverlap,
  canSplitParcelByLine,
  canContinueCurve,
  canTrimSelection,
  canExtendSelection,
  onStartPoint,
  onStartCogoPoint,
  onStartLine,
  onStartPolyline,
  onStartTraverse,
  onStartBatchCogo,
  onStartParcelSplitBearing,
  onStartParcelSplitArea,
  onSplitParcelBySlide,
  onSplitParcelBySwing,
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
  onStartMultiInverse,
  onStartArea,
  onStartBearingReport,
  onStartDistanceReport,
  onStartTurnedPoint,
  onStartDeflectionPoint,
  onStartPointAlongLine,
  onStartExtendLine,
  onStartOffsetPoint,
  onStartAlignmentOffsetCreate,
  onStartAlignmentStationEquation,
  onStartAlignmentOffsetPoint,
  onStartAlignmentIntervalPoints,
  onStartCurveSolver,
  onStartRadialBearing,
  onStartPointOnCurve,
  onStartSubdivideCurve,
  onStartOffsetCurve,
  onStartPiCurve,
  onStartChordBearingCurve,
  onStartReverseCurve,
  onStartCompoundCurve,
  onStartBearingBearingIntersection,
  onStartBearingDistanceIntersection,
  onStartDistanceDistanceIntersection,
  onStartLineCircleIntersection,
  onStartPerpendicularIntersection,
  onStartOffsetIntersection,
  onStartSkewIntersection,
  onStartMove,
  onStartCopy,
  onStartExtend,
  onStartTrim,
  onStartFillet,
  onCreateIntersectionPoint,
  onCreateAlignment,
  onReportAlignmentStation,
  onCreateParcel,
  onReportParcelGap,
  onReportParcelDiagnostics,
  onReportParcelOverlap,
  onSplitParcelByLine,
  onToggleParcelLayoutPanel,
  onSelectAll,
  onClearSelection,
  onErase,
  onUndo,
  onRedo,
}) => {
  const [arcMenuOpen, setArcMenuOpen] = React.useState(false);
  const [coreCogoMenuOpen, setCoreCogoMenuOpen] = React.useState(false);
  const [curveMenuOpen, setCurveMenuOpen] = React.useState(false);
  const [intersectionMenuOpen, setIntersectionMenuOpen] = React.useState(false);
  const [parcelMenuOpen, setParcelMenuOpen] = React.useState(false);
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
      <button type="button" className={commandButtonClassName} onClick={() => runImmediate(onStartBatchCogo)} title="Batch COGO">
        DEED
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
      <div className="relative flex items-stretch" data-survey-cad-core-cogo-tool>
        <button type="button" className={commandButtonClassName} onClick={() => runImmediate(onStartMultiInverse)} title="Multi Inverse">
          P/L
        </button>
        <button
          type="button"
          className={commandButtonClassName}
          onClick={() => setCoreCogoMenuOpen((current) => !current)}
          title="Point-Line COGO"
          data-survey-cad-core-cogo-menu-button
        >
          ▾
        </button>
        {coreCogoMenuOpen ? (
          <div
            className="absolute left-0 top-full z-20 mt-1 grid min-w-56 gap-1 rounded border border-slate-700 bg-slate-950/95 p-2 shadow-xl"
            data-survey-cad-core-cogo-menu
          >
            <button type="button" className={arcMenuButtonClassName} onClick={() => { setCoreCogoMenuOpen(false); runImmediate(onStartMultiInverse); }}>
              Multi Inverse
            </button>
            <button type="button" className={arcMenuButtonClassName} onClick={() => { setCoreCogoMenuOpen(false); runImmediate(onStartArea); }}>
              Area Sequence
            </button>
            <button type="button" className={arcMenuButtonClassName} onClick={() => { setCoreCogoMenuOpen(false); runImmediate(onStartBearingReport); }}>
              Bearing Report
            </button>
            <button type="button" className={arcMenuButtonClassName} onClick={() => { setCoreCogoMenuOpen(false); runImmediate(onStartDistanceReport); }}>
              Distance Report
            </button>
            <button type="button" className={arcMenuButtonClassName} onClick={() => { setCoreCogoMenuOpen(false); runImmediate(onStartTurnedPoint); }}>
              Turned Point
            </button>
            <button
              type="button"
              className={arcMenuButtonClassName}
              onClick={() => { setCoreCogoMenuOpen(false); runImmediate(onStartDeflectionPoint); }}
              disabled={!canUseSelectedLineCoreCogo}
            >
              Deflection Point
            </button>
            <button
              type="button"
              className={arcMenuButtonClassName}
              onClick={() => { setCoreCogoMenuOpen(false); runImmediate(onStartPointAlongLine); }}
              disabled={!canUseSelectedLineCoreCogo}
            >
              Point Along Line
            </button>
            <button
              type="button"
              className={arcMenuButtonClassName}
              onClick={() => { setCoreCogoMenuOpen(false); runImmediate(onStartExtendLine); }}
              disabled={!canUseSelectedLineCoreCogo}
            >
              Extend Line
            </button>
            <button
              type="button"
              className={arcMenuButtonClassName}
              onClick={() => { setCoreCogoMenuOpen(false); runImmediate(onStartOffsetPoint); }}
              disabled={!canUseSelectedLineCoreCogo}
            >
              Offset Point
            </button>
          </div>
        ) : null}
      </div>
      <div className="relative flex items-stretch" data-survey-cad-curve-tool>
        <button type="button" className={commandButtonClassName} onClick={() => runImmediate(onStartCurveSolver)} title="Curve Calculator">
          CURVE
        </button>
        <button
          type="button"
          className={commandButtonClassName}
          onClick={() => setCurveMenuOpen((current) => !current)}
          title="Curve Tools"
          data-survey-cad-curve-menu-button
        >
          ▾
        </button>
        {curveMenuOpen ? (
          <div
            className="absolute left-0 top-full z-20 mt-1 grid min-w-56 gap-1 rounded border border-slate-700 bg-slate-950/95 p-2 shadow-xl"
            data-survey-cad-curve-menu
          >
            <button type="button" className={arcMenuButtonClassName} onClick={() => { setCurveMenuOpen(false); runImmediate(onStartCurveSolver); }}>
              Curve Calculator
            </button>
            <button type="button" className={arcMenuButtonClassName} onClick={() => { setCurveMenuOpen(false); runImmediate(onStartPiCurve); }}>
              PI Radius Delta
            </button>
            <button type="button" className={arcMenuButtonClassName} onClick={() => { setCurveMenuOpen(false); runImmediate(onStartChordBearingCurve); }}>
              Chord Bearing Curve
            </button>
            <button
              type="button"
              className={arcMenuButtonClassName}
              onClick={() => { setCurveMenuOpen(false); runImmediate(onStartRadialBearing); }}
              disabled={!canUseSelectedArcCurveCogo}
            >
              Radial Bearing
            </button>
            <button
              type="button"
              className={arcMenuButtonClassName}
              onClick={() => { setCurveMenuOpen(false); runImmediate(onStartPointOnCurve); }}
              disabled={!canUseSelectedArcCurveCogo}
            >
              Point On Curve
            </button>
            <button
              type="button"
              className={arcMenuButtonClassName}
              onClick={() => { setCurveMenuOpen(false); runImmediate(onStartSubdivideCurve); }}
              disabled={!canUseSelectedArcCurveCogo}
            >
              Subdivide Curve
            </button>
            <button
              type="button"
              className={arcMenuButtonClassName}
              onClick={() => { setCurveMenuOpen(false); runImmediate(onStartOffsetCurve); }}
              disabled={!canUseSelectedArcCurveCogo}
            >
              Offset Curve
            </button>
            <button
              type="button"
              className={arcMenuButtonClassName}
              onClick={() => { setCurveMenuOpen(false); runImmediate(onStartReverseCurve); }}
              disabled={!canUseSelectedArcCurveCogo}
            >
              Reverse Curve
            </button>
            <button
              type="button"
              className={arcMenuButtonClassName}
              onClick={() => { setCurveMenuOpen(false); runImmediate(onStartCompoundCurve); }}
              disabled={!canUseSelectedArcCurveCogo}
            >
              Compound Curve
            </button>
          </div>
        ) : null}
      </div>
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
        onClick={() => runImmediate(onStartExtend)}
        disabled={!canExtendSelection}
        title="Extend"
      >
        EXT
      </button>
      <button
        type="button"
        className={commandButtonClassName}
        onClick={() => runImmediate(onStartTrim)}
        disabled={!canTrimSelection}
        title="Trim"
      >
        TRIM
      </button>
      <button
        type="button"
        className={commandButtonClassName}
        onClick={() => runImmediate(onStartFillet)}
        title="Fillet"
      >
        FILLET
      </button>
      <div className="relative flex items-stretch" data-survey-cad-intersection-tool>
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
          onClick={() => setIntersectionMenuOpen((current) => !current)}
          title="Intersection Tools"
          data-survey-cad-intersection-menu-button
        >
          ▾
        </button>
        {intersectionMenuOpen ? (
          <div
            className="absolute left-0 top-full z-20 mt-1 grid min-w-56 gap-1 rounded border border-slate-700 bg-slate-950/95 p-2 shadow-xl"
            data-survey-cad-intersection-menu
          >
            <button type="button" className={arcMenuButtonClassName} onClick={() => { setIntersectionMenuOpen(false); runImmediate(onStartBearingBearingIntersection); }}>
              Bearing-Bearing
            </button>
            <button type="button" className={arcMenuButtonClassName} onClick={() => { setIntersectionMenuOpen(false); runImmediate(onStartBearingDistanceIntersection); }}>
              Bearing-Distance
            </button>
            <button type="button" className={arcMenuButtonClassName} onClick={() => { setIntersectionMenuOpen(false); runImmediate(onStartDistanceDistanceIntersection); }}>
              Distance-Distance
            </button>
            <button
              type="button"
              className={arcMenuButtonClassName}
              onClick={() => { setIntersectionMenuOpen(false); runImmediate(onStartLineCircleIntersection); }}
              disabled={!canUseSelectedLineCoreCogo}
            >
              Line-Circle
            </button>
            <button
              type="button"
              className={arcMenuButtonClassName}
              onClick={() => { setIntersectionMenuOpen(false); runImmediate(onStartPerpendicularIntersection); }}
              disabled={!canUseSelectedLineCoreCogo}
            >
              Perpendicular
            </button>
            <button
              type="button"
              className={arcMenuButtonClassName}
              onClick={() => { setIntersectionMenuOpen(false); runImmediate(onStartOffsetIntersection); }}
              disabled={!canUseSelectedLinePairIntersection}
            >
              Offset Intersection
            </button>
            <button
              type="button"
              className={arcMenuButtonClassName}
              onClick={() => { setIntersectionMenuOpen(false); runImmediate(onStartSkewIntersection); }}
              disabled={!canUseSelectedLineCoreCogo}
            >
              Skew Intersection
            </button>
          </div>
        ) : null}
      </div>
      <button
        type="button"
        className={commandButtonClassName}
        onClick={() => runImmediate(onCreateAlignment)}
        disabled={!canCreateAlignment}
        title="Create Alignment"
      >
        ALIGN
      </button>
      <button
        type="button"
        className={commandButtonClassName}
        onClick={() => runImmediate(onStartAlignmentOffsetCreate)}
        disabled={!canCreateAlignmentOffset}
        title="Create Offset Alignment"
      >
        ALIGN OFF
      </button>
      <button
        type="button"
        className={commandButtonClassName}
        onClick={() => runImmediate(onReportAlignmentStation)}
        disabled={!canReportAlignmentStation}
        title="Alignment Station"
      >
        STA
      </button>
      <button
        type="button"
        className={commandButtonClassName}
        onClick={() => runImmediate(onStartAlignmentStationEquation)}
        disabled={!canCreateAlignmentStationEquation}
        title="Alignment Station Equation"
      >
        STA EQ
      </button>
      <button
        type="button"
        className={commandButtonClassName}
        onClick={() => runImmediate(onStartAlignmentOffsetPoint)}
        disabled={!canCreateAlignmentOffsetPoint}
        title="Alignment Station Offset Point"
      >
        STA PT
      </button>
      <button
        type="button"
        className={commandButtonClassName}
        onClick={() => runImmediate(onStartAlignmentIntervalPoints)}
        disabled={!canCreateAlignmentIntervalPoints}
        title="Alignment Station Interval Points"
      >
        STA INT
      </button>
      <div className="relative flex items-stretch" data-survey-cad-parcel-tool>
        <button
          type="button"
          className={commandButtonClassName}
          onClick={() => runImmediate(onCreateParcel)}
          disabled={!canCreateParcel}
          title="Create Parcel"
        >
          PARCEL
        </button>
        <button
          type="button"
          className={commandButtonClassName}
          onClick={() => setParcelMenuOpen((current) => !current)}
          title="Parcel Tools"
          data-survey-cad-parcel-menu-button
        >
          ▾
        </button>
        {parcelMenuOpen ? (
          <div
            className="absolute left-0 top-full z-20 mt-1 grid min-w-56 gap-1 rounded border border-slate-700 bg-slate-950/95 p-2 shadow-xl"
            data-survey-cad-parcel-menu
          >
            <button
              type="button"
              className={arcMenuButtonClassName}
              onClick={() => { setParcelMenuOpen(false); runImmediate(onCreateParcel); }}
              disabled={!canCreateParcel}
            >
              Create Parcel
            </button>
            <button
              type="button"
              className={arcMenuButtonClassName}
              onClick={() => { setParcelMenuOpen(false); runImmediate(onStartParcelSplitBearing); }}
              disabled={!canSplitParcelByBearing}
            >
              Split by Bearing
            </button>
            <button
              type="button"
              className={arcMenuButtonClassName}
              onClick={() => { setParcelMenuOpen(false); runImmediate(onStartParcelSplitArea); }}
              disabled={!canSplitParcelByArea}
            >
              Split by Area
            </button>
            <button
              type="button"
              className={arcMenuButtonClassName}
              onClick={() => { setParcelMenuOpen(false); runImmediate(onSplitParcelBySlide); }}
              disabled={!canSplitParcelBySlide}
            >
              Sliding Area Split
            </button>
            <button
              type="button"
              className={arcMenuButtonClassName}
              onClick={() => { setParcelMenuOpen(false); runImmediate(onSplitParcelBySwing); }}
              disabled={!canSplitParcelBySwing}
            >
              Hinged Area Split
            </button>
            <button
              type="button"
              className={arcMenuButtonClassName}
              onClick={() => { setParcelMenuOpen(false); runImmediate(onToggleParcelLayoutPanel); }}
            >
              Layout Tools
            </button>
            <button
              type="button"
              className={arcMenuButtonClassName}
              onClick={() => { setParcelMenuOpen(false); runImmediate(onReportParcelGap); }}
              disabled={!canReportParcelGap}
            >
              Parcel Gap
            </button>
            <button
              type="button"
              className={arcMenuButtonClassName}
              onClick={() => { setParcelMenuOpen(false); runImmediate(onReportParcelDiagnostics); }}
              disabled={!canReportParcelDiagnostics}
            >
              Parcel Check
            </button>
            <button
              type="button"
              className={arcMenuButtonClassName}
              onClick={() => { setParcelMenuOpen(false); runImmediate(onReportParcelOverlap); }}
              disabled={!canReportParcelOverlap}
            >
              Parcel Overlap
            </button>
            <button
              type="button"
              className={arcMenuButtonClassName}
              onClick={() => { setParcelMenuOpen(false); runImmediate(onSplitParcelByLine); }}
              disabled={!canSplitParcelByLine}
            >
              Split by Line
            </button>
          </div>
        ) : null}
      </div>
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
