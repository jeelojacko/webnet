import type { ActiveCommandKey } from '../../cad-app/shell/cadShellTypes';
import type { UseSurveyCadWorkspaceResult } from '../../hooks/surveyCad/useSurveyCadWorkspace.types';

/**
 * STRUCT-194.7 — the workspace command-start methods the shell starter
 * registry routes to. Deliberately a narrow `Pick` (not the whole workspace
 * result) so the registry declares exactly what it needs and an added or
 * renamed starter fails typecheck here.
 */
export type CadShellCommandStarterWorkspace = Pick<
  UseSurveyCadWorkspaceResult,
  | 'startPointCommand'
  | 'startCogoPointCommand'
  | 'startLineCommand'
  | 'startLineL1Command'
  | 'startRectangleCommand'
  | 'startCircleCommand'
  | 'startCircleDiameterCommand'
  | 'startCircleTwoPointCommand'
  | 'startCircleThreePointCommand'
  | 'startCircleTangentTangentRadiusCommand'
  | 'startCircleTangentTangentTangentCommand'
  | 'startPolygonCommand'
  | 'startPolylineCommand'
  | 'startPlineInsertVertexCommand'
  | 'startPlineDeleteVertexCommand'
  | 'startTraverseCommand'
  | 'startArc3PointCommand'
  | 'startArcStartCenterEndCommand'
  | 'startArcCenterStartEndCommand'
  | 'startArcStartCenterAngleCommand'
  | 'startArcCenterStartAngleCommand'
  | 'startArcStartCenterChordCommand'
  | 'startArcCenterStartChordCommand'
  | 'startArcStartEndAngleCommand'
  | 'startArcStartEndDirectionCommand'
  | 'startArcStartEndRadiusCommand'
  | 'startContinueCurveCommand'
  | 'startTangentCurveCommand'
  | 'startCurveBetweenTwoLinesCommand'
  | 'startCurveOnTwoLinesCommand'
  | 'startCurveThroughPointCommand'
  | 'startMultipleCurvesCommand'
  | 'startCurveFromEndCommand'
  | 'startReverseOrCompoundCommand'
  | 'startBestFitLineCommand'
  | 'startBestFitArcCommand'
  | 'startBestFitParabolaCommand'
  | 'startInverseCommand'
  | 'startMultiInverseCommand'
  | 'startAreaCommand'
  | 'startBearingReportCommand'
  | 'startDistanceReportCommand'
  | 'startTurnedPointCommand'
  | 'startDeflectionPointCommand'
  | 'startPointAlongLineCommand'
  | 'startExtendLineCommand'
  | 'startOffsetPointCommand'
  | 'startAlignmentOffsetCreateCommand'
  | 'startAlignmentStationEquationCommand'
  | 'startAlignmentOffsetPointCommand'
  | 'startAlignmentIntervalPointsCommand'
  | 'startCurveSolverCommand'
  | 'startRadialBearingCommand'
  | 'startPointOnCurveCommand'
  | 'startSubdivideCurveCommand'
  | 'startOffsetCurveCommand'
  | 'startPiCurveCommand'
  | 'startChordBearingCurveCommand'
  | 'startReverseCurveCommand'
  | 'startCompoundCurveCommand'
  | 'startBearingBearingIntersectionCommand'
  | 'startBearingDistanceIntersectionCommand'
  | 'startDistanceDistanceIntersectionCommand'
  | 'startLineCircleIntersectionCommand'
  | 'startPerpendicularIntersectionCommand'
  | 'startOffsetIntersectionCommand'
  | 'startSkewIntersectionCommand'
  | 'startBatchCogoCommand'
  | 'startParcelSplitBearingCommand'
  | 'startParcelSplitAreaCommand'
  | 'startParcelDesignateCommand'
  | 'startParcelNumberCommand'
  | 'startParcelLinkCommand'
  | 'startParcelUnlinkCommand'
  | 'startParcelCheckCommand'
  | 'startParcelScheduleCommand'
  | 'startParcelSharedEditCommand'
  | 'startLineTableCommand'
  | 'startCurveTableCommand'
  | 'startParcelTableCommand'
  | 'startPointTableCommand'
  | 'startParcelReportCommand'
  | 'startParcelDescCommand'
  | 'startMTextCommand'
  | 'startLeaderCommand'
  | 'startDimCommand'
  | 'startDimLinearCommand'
  | 'startDimAlignedCommand'
  | 'startDimAngularCommand'
  | 'startDimRadiusCommand'
  | 'startDimDiameterCommand'
  | 'startBearingLabelCommand'
  | 'startCurveLabelCommand'
  | 'startMoveCommand'
  | 'startCopyCommand'
  | 'startRotateCommand'
  | 'startScaleCommand'
  | 'startMirrorCommand'
  | 'startAlign2DCommand'
  | 'startHelmert2DCommand'
  | 'startGridGroundCommand'
  | 'startProjectTransformCommand'
  | 'startExtendCommand'
  | 'startTrimCommand'
  | 'startFilletCommand'
>;

export interface CadShellCommandStarterContext {
  /** Live workspace starters (identity changes every root render). */
  workspace: CadShellCommandStarterWorkspace;
  /**
   * Clipboard snapshot for the PASTE entry. The closure captures the ids the
   * render observed; PASTE is absent (undefined) while the clipboard is empty.
   */
  copiedEntityIds: string[];
  /** Paste dispatch (`cadWorkspace.startPasteFromClipboard`). */
  startPasteFromClipboard: (_entityIds: string[]) => void;
}

/**
 * STRUCT-194.7 — pure factory for the Phase 18B shell starter registry.
 *
 * Behavior-preserving extraction of the former inline `shellStarters` literal:
 * same key set, same insertion order, same wrappers, same `SURVEYTABLE:
 * undefined` gap, and the same conditional PASTE closure over the clipboard
 * snapshot captured on this call. Returns a fresh object every call (no static
 * registry, no cache); it is not memoized, so `shellAvailableCommands`
 * recomputes from current values exactly as before.
 */
export const createCadShellCommandStarters = (
  context: CadShellCommandStarterContext,
): Record<ActiveCommandKey, (() => void) | undefined> => {
  const { workspace, copiedEntityIds, startPasteFromClipboard } = context;
  return {
    POINT: workspace.startPointCommand,
    COGO_POINT: workspace.startCogoPointCommand,
    LINE: workspace.startLineCommand,
    LINE_POINT_RANGE: () => workspace.startLineL1Command('LINE_POINT_RANGE'),
    LINE_POINT_OBJECT: () => workspace.startLineL1Command('LINE_POINT_OBJECT'),
    LINE_POINT_NAME: () => workspace.startLineL1Command('LINE_POINT_NAME'),
    LINE_NE: () => workspace.startLineL1Command('LINE_NE'),
    LINE_GRID_NE: () => workspace.startLineL1Command('LINE_GRID_NE'),
    LINE_LATLONG: () => workspace.startLineL1Command('LINE_LATLONG'),
    LINE_BEARING: () => workspace.startLineL1Command('LINE_BEARING'),
    LINE_AZIMUTH: () => workspace.startLineL1Command('LINE_AZIMUTH'),
    LINE_ANGLE: () => workspace.startLineL1Command('LINE_ANGLE'),
    LINE_DEFLECTION: () => workspace.startLineL1Command('LINE_DEFLECTION'),
    LINE_STATION_OFFSET: () => workspace.startLineL1Command('LINE_STATION_OFFSET'),
    LINE_SIDE_SHOT: () => workspace.startLineL1Command('LINE_SIDE_SHOT'),
    LINE_EXTENSION: () => workspace.startLineL1Command('LINE_EXTENSION'),
    LINE_FROM_END: () => workspace.startLineL1Command('LINE_FROM_END'),
    LINE_TANGENT_POINT: () => workspace.startLineL1Command('LINE_TANGENT_POINT'),
    LINE_PERP_POINT: () => workspace.startLineL1Command('LINE_PERP_POINT'),
    RECTANGLE: workspace.startRectangleCommand,
    CIRCLE: workspace.startCircleCommand,
    CIRCLECD: workspace.startCircleDiameterCommand,
    CIRCLE2P: workspace.startCircleTwoPointCommand,
    CIRCLE3P: workspace.startCircleThreePointCommand,
    CIRCLETTR: workspace.startCircleTangentTangentRadiusCommand,
    CIRCLETTT: workspace.startCircleTangentTangentTangentCommand,
    POLYGON: workspace.startPolygonCommand,
    PLINE: workspace.startPolylineCommand,
    PLINEINSERTVERTEX: workspace.startPlineInsertVertexCommand,
    PLINEDELETEVERTEX: workspace.startPlineDeleteVertexCommand,
    TRAVERSE: workspace.startTraverseCommand,
    ARC_3PT: workspace.startArc3PointCommand,
    ARC_SCE: workspace.startArcStartCenterEndCommand,
    ARC_CSE: workspace.startArcCenterStartEndCommand,
    ARC_SCA: workspace.startArcStartCenterAngleCommand,
    ARC_CSA: workspace.startArcCenterStartAngleCommand,
    ARC_SCL: workspace.startArcStartCenterChordCommand,
    ARC_CSL: workspace.startArcCenterStartChordCommand,
    ARC_SEA: workspace.startArcStartEndAngleCommand,
    ARC_SED: workspace.startArcStartEndDirectionCommand,
    ARC_SER: workspace.startArcStartEndRadiusCommand,
    CONTINUE_CURVE: workspace.startContinueCurveCommand,
    TANGENT_CURVE: workspace.startTangentCurveCommand,
    CURVE_BETWEEN_TWO_LINES: workspace.startCurveBetweenTwoLinesCommand,
    CURVE_ON_TWO_LINES: workspace.startCurveOnTwoLinesCommand,
    CURVE_THROUGH_POINT: workspace.startCurveThroughPointCommand,
    MULTIPLE_CURVES: workspace.startMultipleCurvesCommand,
    CURVE_FROM_END: workspace.startCurveFromEndCommand,
    REVERSE_OR_COMPOUND: workspace.startReverseOrCompoundCommand,
    BESTFITLINE: workspace.startBestFitLineCommand,
    BESTFITARC: workspace.startBestFitArcCommand,
    BESTFITPARABOLA: workspace.startBestFitParabolaCommand,
    INVERSE: workspace.startInverseCommand,
    MULTI_INVERSE: workspace.startMultiInverseCommand,
    AREA: workspace.startAreaCommand,
    BEARING_REPORT: workspace.startBearingReportCommand,
    DISTANCE_REPORT: workspace.startDistanceReportCommand,
    TURNED_POINT: workspace.startTurnedPointCommand,
    DEFLECT_POINT: workspace.startDeflectionPointCommand,
    POINT_ALONG_LINE: workspace.startPointAlongLineCommand,
    EXTEND_LINE: workspace.startExtendLineCommand,
    OFFSET_POINT: workspace.startOffsetPointCommand,
    ALIGNMENT_OFFSET_CREATE: workspace.startAlignmentOffsetCreateCommand,
    ALIGNMENT_STATION_EQUATION: workspace.startAlignmentStationEquationCommand,
    ALIGNMENT_OFFSET_POINT: workspace.startAlignmentOffsetPointCommand,
    ALIGNMENT_INTERVAL_POINTS: workspace.startAlignmentIntervalPointsCommand,
    CURVE_SOLVER: workspace.startCurveSolverCommand,
    RADIAL_BEARING: workspace.startRadialBearingCommand,
    POINT_ON_CURVE: workspace.startPointOnCurveCommand,
    SUBDIVIDE_CURVE: workspace.startSubdivideCurveCommand,
    OFFSET_CURVE: workspace.startOffsetCurveCommand,
    PI_CURVE: workspace.startPiCurveCommand,
    CHORD_BEARING_CURVE: workspace.startChordBearingCurveCommand,
    REVERSE_CURVE: workspace.startReverseCurveCommand,
    COMPOUND_CURVE: workspace.startCompoundCurveCommand,
    BEARING_BEARING_INTX: workspace.startBearingBearingIntersectionCommand,
    BEARING_DISTANCE_INTX: workspace.startBearingDistanceIntersectionCommand,
    DISTANCE_DISTANCE_INTX: workspace.startDistanceDistanceIntersectionCommand,
    LINE_CIRCLE_INTX: workspace.startLineCircleIntersectionCommand,
    PERP_INTX: workspace.startPerpendicularIntersectionCommand,
    OFFSET_INTX: workspace.startOffsetIntersectionCommand,
    SKEW_INTX: workspace.startSkewIntersectionCommand,
    BATCH_COGO: workspace.startBatchCogoCommand,
    PARCEL_SPLIT_BEARING: workspace.startParcelSplitBearingCommand,
    PARCEL_SPLIT_AREA: workspace.startParcelSplitAreaCommand,
    PARCELDESIGNATE: workspace.startParcelDesignateCommand,
    PARCELNUMBER: workspace.startParcelNumberCommand,
    PARCELLINK: workspace.startParcelLinkCommand,
    PARCELUNLINK: workspace.startParcelUnlinkCommand,
    PARCELCHECK: workspace.startParcelCheckCommand,
    PARCELSCHEDULE: workspace.startParcelScheduleCommand,
    PARCELSHAREDEDIT: () => workspace.startParcelSharedEditCommand(),
    LINETABLE: workspace.startLineTableCommand,
    CURVETABLE: workspace.startCurveTableCommand,
    PARCELTABLE: workspace.startParcelTableCommand,
    POINTTABLE: workspace.startPointTableCommand,
    PARCELREPORT: workspace.startParcelReportCommand,
    PARCELDESC: workspace.startParcelDescCommand,
    SURVEYTABLE: undefined,
    MTEXT: workspace.startMTextCommand,
    LEADER: workspace.startLeaderCommand,
    DIM: workspace.startDimCommand,
    DIMLINEAR: workspace.startDimLinearCommand,
    DIMALIGNED: workspace.startDimAlignedCommand,
    DIMANGULAR: workspace.startDimAngularCommand,
    DIMRADIUS: workspace.startDimRadiusCommand,
    DIMDIAMETER: workspace.startDimDiameterCommand,
    BDLABEL: workspace.startBearingLabelCommand,
    CURVELABEL: workspace.startCurveLabelCommand,
    MOVE: workspace.startMoveCommand,
    COPY: workspace.startCopyCommand,
    ROTATE: workspace.startRotateCommand,
    SCALE: workspace.startScaleCommand,
    MIRROR: workspace.startMirrorCommand,
    ALIGN2D: workspace.startAlign2DCommand,
    HELMERT2D: workspace.startHelmert2DCommand,
    GRIDGROUND: workspace.startGridGroundCommand,
    PROJECTTRANSFORM: workspace.startProjectTransformCommand,
    EXTEND: workspace.startExtendCommand,
    TRIM: workspace.startTrimCommand,
    FILLET: workspace.startFilletCommand,
    PASTE: copiedEntityIds.length > 0 ? () => startPasteFromClipboard(copiedEntityIds) : undefined,
  };
};
