import React from 'react';
import { flushSync } from 'react-dom';

import { commandButtonClassName } from './SurveyCadCommandLine.constants';
import { SurveyCadArcMenu, SurveyCadCoreCogoMenu, SurveyCadCurveMenu, SurveyCadIntersectionMenu, SurveyCadParcelMenu } from './SurveyCadCommandLineMenus';
import { SurveyCadCommandLineEditControls } from './SurveyCadCommandLineEditControls';
import { SurveyCadCommandLineSelectionControls } from './SurveyCadCommandLineSelectionControls';
import type { SurveyCadCommandLineProps } from './SurveyCadCommandLine.types';

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
  const runImmediate = (action: () => void) => flushSync(action);

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
          <SurveyCadArcMenu
            canContinueCurve={canContinueCurve}
            onClose={() => setArcMenuOpen(false)}
            onStartArc3Point={onStartArc3Point}
            onStartArcCenterStartAngle={onStartArcCenterStartAngle}
            onStartArcCenterStartChord={onStartArcCenterStartChord}
            onStartArcCenterStartEnd={onStartArcCenterStartEnd}
            onStartArcStartCenterAngle={onStartArcStartCenterAngle}
            onStartArcStartCenterChord={onStartArcStartCenterChord}
            onStartArcStartCenterEnd={onStartArcStartCenterEnd}
            onStartArcStartEndAngle={onStartArcStartEndAngle}
            onStartArcStartEndDirection={onStartArcStartEndDirection}
            onStartArcStartEndRadius={onStartArcStartEndRadius}
            onStartContinueCurve={onStartContinueCurve}
            onStartTangentCurve={onStartTangentCurve}
            runImmediate={runImmediate}
          />
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
          <SurveyCadCoreCogoMenu
            canUseSelectedLineCoreCogo={canUseSelectedLineCoreCogo}
            onClose={() => setCoreCogoMenuOpen(false)}
            onStartArea={onStartArea}
            onStartBearingReport={onStartBearingReport}
            onStartDeflectionPoint={onStartDeflectionPoint}
            onStartDistanceReport={onStartDistanceReport}
            onStartExtendLine={onStartExtendLine}
            onStartMultiInverse={onStartMultiInverse}
            onStartOffsetPoint={onStartOffsetPoint}
            onStartPointAlongLine={onStartPointAlongLine}
            onStartTurnedPoint={onStartTurnedPoint}
            runImmediate={runImmediate}
          />
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
          <SurveyCadCurveMenu
            canUseSelectedArcCurveCogo={canUseSelectedArcCurveCogo}
            onClose={() => setCurveMenuOpen(false)}
            onStartChordBearingCurve={onStartChordBearingCurve}
            onStartCompoundCurve={onStartCompoundCurve}
            onStartCurveSolver={onStartCurveSolver}
            onStartOffsetCurve={onStartOffsetCurve}
            onStartPiCurve={onStartPiCurve}
            onStartPointOnCurve={onStartPointOnCurve}
            onStartRadialBearing={onStartRadialBearing}
            onStartReverseCurve={onStartReverseCurve}
            onStartSubdivideCurve={onStartSubdivideCurve}
            runImmediate={runImmediate}
          />
        ) : null}
      </div>
      <SurveyCadCommandLineEditControls
        canExtendSelection={canExtendSelection}
        canTrimSelection={canTrimSelection}
        onStartCopy={onStartCopy}
        onStartExtend={onStartExtend}
        onStartFillet={onStartFillet}
        onStartMove={onStartMove}
        onStartTrim={onStartTrim}
        runImmediate={runImmediate}
        selectionCount={selectionCount}
      />
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
          <SurveyCadIntersectionMenu
            canUseSelectedLineCoreCogo={canUseSelectedLineCoreCogo}
            canUseSelectedLinePairIntersection={canUseSelectedLinePairIntersection}
            onClose={() => setIntersectionMenuOpen(false)}
            onStartBearingBearingIntersection={onStartBearingBearingIntersection}
            onStartBearingDistanceIntersection={onStartBearingDistanceIntersection}
            onStartDistanceDistanceIntersection={onStartDistanceDistanceIntersection}
            onStartLineCircleIntersection={onStartLineCircleIntersection}
            onStartOffsetIntersection={onStartOffsetIntersection}
            onStartPerpendicularIntersection={onStartPerpendicularIntersection}
            onStartSkewIntersection={onStartSkewIntersection}
            runImmediate={runImmediate}
          />
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
          <SurveyCadParcelMenu
            canCreateParcel={canCreateParcel}
            canReportParcelDiagnostics={canReportParcelDiagnostics}
            canReportParcelGap={canReportParcelGap}
            canReportParcelOverlap={canReportParcelOverlap}
            canSplitParcelByArea={canSplitParcelByArea}
            canSplitParcelByBearing={canSplitParcelByBearing}
            canSplitParcelByLine={canSplitParcelByLine}
            canSplitParcelBySlide={canSplitParcelBySlide}
            canSplitParcelBySwing={canSplitParcelBySwing}
            onClose={() => setParcelMenuOpen(false)}
            onCreateParcel={onCreateParcel}
            onReportParcelDiagnostics={onReportParcelDiagnostics}
            onReportParcelGap={onReportParcelGap}
            onReportParcelOverlap={onReportParcelOverlap}
            onSplitParcelByLine={onSplitParcelByLine}
            onSplitParcelBySlide={onSplitParcelBySlide}
            onSplitParcelBySwing={onSplitParcelBySwing}
            onStartParcelSplitArea={onStartParcelSplitArea}
            onStartParcelSplitBearing={onStartParcelSplitBearing}
            onToggleParcelLayoutPanel={onToggleParcelLayoutPanel}
            runImmediate={runImmediate}
          />
        ) : null}
      </div>
      <SurveyCadCommandLineSelectionControls
        canRedo={canRedo}
        canUndo={canUndo}
        entityCount={entityCount}
        historyDepth={historyDepth}
        onClearSelection={onClearSelection}
        onErase={onErase}
        onRedo={onRedo}
        onSelectAll={onSelectAll}
        onUndo={onUndo}
        redoDepth={redoDepth}
        runImmediate={runImmediate}
        selectionCount={selectionCount}
      />
    </div>
  </div>
  );
};

export default SurveyCadCommandLine;
