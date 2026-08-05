import React from 'react';
import { useSurveyCadWorkspace } from '../../hooks/surveyCad/useSurveyCadWorkspace';
import SurveyCadCommandLine from './SurveyCadCommandLine';

interface SurveyCadCommandToolbarProps {
  workspace: ReturnType<typeof useSurveyCadWorkspace>;
  canSplitParcelBySlideOrSwing: boolean;
  onCreateParcel: () => void;
  onSplitParcelBySlide: () => void;
  onSplitParcelBySwing: () => void;
  onToggleParcelLayoutPanel: () => void;
}

const SurveyCadCommandToolbar: React.FC<SurveyCadCommandToolbarProps> = ({
  workspace,
  canSplitParcelBySlideOrSwing,
  onCreateParcel,
  onSplitParcelBySlide,
  onSplitParcelBySwing,
  onToggleParcelLayoutPanel,
}) => (
  <div className="absolute left-3 right-3 top-12 z-30 overflow-visible px-2 py-1.5" data-survey-cad-toolbar-overlay>
    <div>
      <SurveyCadCommandLine
        entityCount={workspace.cadProject.entities.length}
        selectionCount={workspace.selectionCount}
        canUndo={workspace.canUndo}
        canRedo={workspace.canRedo}
        historyDepth={workspace.historyDepth}
        redoDepth={workspace.redoDepth}
        canUseSelectedLineCoreCogo={workspace.canUseSelectedLineCoreCogo}
        canUseSelectedLinePairIntersection={workspace.canUseSelectedLinePairIntersection}
        canUseSelectedArcCurveCogo={workspace.canUseSelectedArcCurveCogo}
        canCreateIntersectionPoint={workspace.canCreateIntersectionPoint}
        canCreateAlignment={workspace.canCreateAlignment}
        canReportAlignmentStation={workspace.canReportAlignmentStation}
        canCreateAlignmentOffset={workspace.canCreateAlignmentOffset}
        canCreateAlignmentStationEquation={workspace.canCreateAlignmentStationEquation}
        canCreateAlignmentOffsetPoint={workspace.canCreateAlignmentOffsetPoint}
        canCreateAlignmentIntervalPoints={workspace.canCreateAlignmentIntervalPoints}
        canCreateParcel={workspace.canCreateParcel}
        canSplitParcelByBearing={workspace.canSplitParcelByBearing}
        canSplitParcelByArea={workspace.canSplitParcelByArea}
        canReportParcelGap={workspace.canReportParcelGap}
        canReportParcelDiagnostics={workspace.canReportParcelDiagnostics}
        canReportParcelOverlap={workspace.canReportParcelOverlap}
        canSplitParcelByLine={workspace.canSplitParcelByLine}
        canContinueCurve={workspace.canContinueCurve}
        canExtendSelection={workspace.canExtendSelection}
        onStartPoint={workspace.startPointCommand}
        onStartCogoPoint={workspace.startCogoPointCommand}
        onStartLine={workspace.startLineCommand}
        onStartPolyline={workspace.startPolylineCommand}
        onStartTraverse={workspace.startTraverseCommand}
        onStartBatchCogo={workspace.startBatchCogoCommand}
        onStartParcelSplitBearing={workspace.startParcelSplitBearingCommand}
        onStartParcelSplitArea={workspace.startParcelSplitAreaCommand}
        onStartArc3Point={workspace.startArc3PointCommand}
        onStartArcStartCenterEnd={workspace.startArcStartCenterEndCommand}
        onStartArcCenterStartEnd={workspace.startArcCenterStartEndCommand}
        onStartArcStartCenterAngle={workspace.startArcStartCenterAngleCommand}
        onStartArcCenterStartAngle={workspace.startArcCenterStartAngleCommand}
        onStartArcStartCenterChord={workspace.startArcStartCenterChordCommand}
        onStartArcCenterStartChord={workspace.startArcCenterStartChordCommand}
        onStartArcStartEndAngle={workspace.startArcStartEndAngleCommand}
        onStartArcStartEndDirection={workspace.startArcStartEndDirectionCommand}
        onStartArcStartEndRadius={workspace.startArcStartEndRadiusCommand}
        onStartContinueCurve={workspace.startContinueCurveCommand}
        onStartTangentCurve={workspace.startTangentCurveCommand}
        onStartInverse={workspace.startInverseCommand}
        onStartMultiInverse={workspace.startMultiInverseCommand}
        onStartArea={workspace.startAreaCommand}
        onStartBearingReport={workspace.startBearingReportCommand}
        onStartDistanceReport={workspace.startDistanceReportCommand}
        onStartTurnedPoint={workspace.startTurnedPointCommand}
        onStartDeflectionPoint={workspace.startDeflectionPointCommand}
        onStartPointAlongLine={workspace.startPointAlongLineCommand}
        onStartExtendLine={workspace.startExtendLineCommand}
        onStartOffsetPoint={workspace.startOffsetPointCommand}
        onStartAlignmentOffsetCreate={workspace.startAlignmentOffsetCreateCommand}
        onStartAlignmentStationEquation={workspace.startAlignmentStationEquationCommand}
        onStartAlignmentOffsetPoint={workspace.startAlignmentOffsetPointCommand}
        onStartAlignmentIntervalPoints={workspace.startAlignmentIntervalPointsCommand}
        onStartCurveSolver={workspace.startCurveSolverCommand}
        onStartRadialBearing={workspace.startRadialBearingCommand}
        onStartPointOnCurve={workspace.startPointOnCurveCommand}
        onStartSubdivideCurve={workspace.startSubdivideCurveCommand}
        onStartOffsetCurve={workspace.startOffsetCurveCommand}
        onStartPiCurve={workspace.startPiCurveCommand}
        onStartChordBearingCurve={workspace.startChordBearingCurveCommand}
        onStartReverseCurve={workspace.startReverseCurveCommand}
        onStartCompoundCurve={workspace.startCompoundCurveCommand}
        onStartBearingBearingIntersection={workspace.startBearingBearingIntersectionCommand}
        onStartBearingDistanceIntersection={workspace.startBearingDistanceIntersectionCommand}
        onStartDistanceDistanceIntersection={workspace.startDistanceDistanceIntersectionCommand}
        onStartLineCircleIntersection={workspace.startLineCircleIntersectionCommand}
        onStartPerpendicularIntersection={workspace.startPerpendicularIntersectionCommand}
        onStartOffsetIntersection={workspace.startOffsetIntersectionCommand}
        onStartSkewIntersection={workspace.startSkewIntersectionCommand}
        onStartMove={workspace.startMoveCommand}
        onStartCopy={workspace.startCopyCommand}
        onStartExtend={workspace.startExtendCommand}
        onStartTrim={workspace.startTrimCommand}
        onStartFillet={workspace.startFilletCommand}
        onCreateIntersectionPoint={workspace.createIntersectionPoint}
        onCreateAlignment={workspace.createAlignmentFromSelection}
        onReportAlignmentStation={workspace.reportAlignmentStationFromSelection}
        onCreateParcel={onCreateParcel}
        onReportParcelGap={workspace.reportParcelGapFromSelection}
        onReportParcelDiagnostics={workspace.reportParcelDiagnosticsFromSelection}
        onReportParcelOverlap={workspace.reportParcelOverlapFromSelection}
        canSplitParcelBySlide={canSplitParcelBySlideOrSwing}
        canSplitParcelBySwing={canSplitParcelBySlideOrSwing}
        onSplitParcelBySlide={onSplitParcelBySlide}
        onSplitParcelBySwing={onSplitParcelBySwing}
        onSplitParcelByLine={workspace.splitParcelBySelectedLine}
        onToggleParcelLayoutPanel={onToggleParcelLayoutPanel}
        canTrimSelection={workspace.canTrimSelection}
        onSelectAll={workspace.selectAll}
        onClearSelection={workspace.clearSelection}
        onErase={workspace.eraseSelection}
        onUndo={workspace.undo}
        onRedo={workspace.redo}
      />
    </div>
  </div>
);

export default SurveyCadCommandToolbar;
