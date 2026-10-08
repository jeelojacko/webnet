import type {
  CadAlignmentEntity,
  CadArcEntity,
  CadParcelEntity,
  CadProject,
} from '../../engine/cad/cadTypes';
import type { CommandPoint, CommandSession } from './useSurveyCadCommandTypes';
import type { CadLineL1CommandKey } from './useSurveyCadLineL1Keys';
import type {
  SelectedLineCommandPoints,
  SelectedLinePairCommandPoints,
} from './useSurveyCadCommandSelection';

export type BeginCommandSession = (_session: CommandSession) => void;
export type BatchCogoDraftBuilder = (
  _inputValue: string,
) => Extract<CommandSession, { key: 'BATCH_COGO' }>['draft'];

export interface SurveyCadCommandStarters {
  /** CAD Draw L1: begin one of the 16 Line-creation modes (seed from selection). */
  startLineL1Command: (_key: CadLineL1CommandKey) => void;
  startPointCommand: () => void;
  startCogoPointCommand: () => void;
  startLineCommand: () => void;
  startRectangleCommand: () => void;
  startCircleCommand: () => void;
  startCircleDiameterCommand: () => void;
  startCircleTwoPointCommand: () => void;
  startCircleThreePointCommand: () => void;
  startCircleTangentTangentRadiusCommand: () => void;
  startCircleTangentTangentTangentCommand: () => void;
  startPolygonCommand: () => void;
  startPolylineCommand: () => void;
  /** Phase C3 — count-changing polyline vertex topology sessions. */
  startPlineInsertVertexCommand: () => void;
  startPlineDeleteVertexCommand: () => void;
  startTraverseCommand: () => void;
  startBatchCogoCommand: () => void;
  startParcelSplitBearingCommand: () => void;
  startParcelSplitAreaCommand: () => void;
  startParcelDesignateCommand: () => void;
  startParcelNumberCommand: () => void;
  startParcelLinkCommand: () => void;
  startParcelUnlinkCommand: () => void;
  startParcelCheckCommand: () => void;
  startParcelScheduleCommand: () => void;
  startParcelSharedEditCommand: (_linkId?: string) => void;
  startArc3PointCommand: () => void;
  startArcStartCenterEndCommand: () => void;
  startArcCenterStartEndCommand: () => void;
  startArcStartCenterAngleCommand: () => void;
  startArcCenterStartAngleCommand: () => void;
  startArcStartCenterChordCommand: () => void;
  startArcCenterStartChordCommand: () => void;
  startArcStartEndAngleCommand: () => void;
  startArcStartEndDirectionCommand: () => void;
  startArcStartEndRadiusCommand: () => void;
  startContinueCurveCommand: () => void;
  startTangentCurveCommand: () => void;
  startInverseCommand: () => void;
  startMultiInverseCommand: () => void;
  startAreaCommand: () => void;
  startBearingReportCommand: () => void;
  startDistanceReportCommand: () => void;
  startTurnedPointCommand: () => void;
  startDeflectionPointCommand: () => void;
  startPointAlongLineCommand: () => void;
  startExtendLineCommand: () => void;
  startOffsetPointCommand: () => void;
  startAlignmentOffsetCreateCommand: () => void;
  startAlignmentStationEquationCommand: () => void;
  startAlignmentOffsetPointCommand: () => void;
  startAlignmentIntervalPointsCommand: () => void;
  startCurveSolverCommand: () => void;
  startRadialBearingCommand: () => void;
  startPointOnCurveCommand: () => void;
  startSubdivideCurveCommand: () => void;
  startOffsetCurveCommand: () => void;
  startPiCurveCommand: () => void;
  startChordBearingCurveCommand: () => void;
  startReverseCurveCommand: () => void;
  startCompoundCurveCommand: () => void;
  startBearingBearingIntersectionCommand: () => void;
  startBearingDistanceIntersectionCommand: () => void;
  startDistanceDistanceIntersectionCommand: () => void;
  startLineCircleIntersectionCommand: () => void;
  startPerpendicularIntersectionCommand: () => void;
  startOffsetIntersectionCommand: () => void;
  startSkewIntersectionCommand: () => void;
  startMTextCommand: () => void;
  startLeaderCommand: () => void;
  startDimCommand: () => void;
  startDimLinearCommand: () => void;
  startDimAlignedCommand: () => void;
  startDimAngularCommand: () => void;
  startDimRadiusCommand: () => void;
  startDimDiameterCommand: () => void;
  startBearingLabelCommand: () => void;
  startCurveLabelCommand: () => void;
  startBestFitLineCommand: () => void;
  startBestFitArcCommand: () => void;
  startBestFitParabolaCommand: () => void;
  startMoveCommand: () => void;
  startCopyCommand: () => void;
  startRotateCommand: () => void;
  startScaleCommand: () => void;
  startMirrorCommand: () => void;
  startAlign2DCommand: () => void;
  startHelmert2DCommand: () => void;
  startGridGroundCommand: () => void;
  startProjectTransformCommand: () => void;
  startExtendCommand: () => void;
  startTrimCommand: () => void;
  startFilletCommand: () => void;
  startPasteCommand: (_sourceEntityIds: string[], _basePoint: CommandPoint) => void;
  startLineTableCommand: () => void;
  startCurveTableCommand: () => void;
  startParcelTableCommand: () => void;
  startPointTableCommand: () => void;
  startParcelReportCommand: () => void;
  startParcelDescCommand: () => void;
}

export interface BuildSurveyCadCommandStartersOptions {
  beginSession: BeginCommandSession;
  buildBatchCogoDraftForInput: BatchCogoDraftBuilder;
  selectedArcForContinue: CadArcEntity | null;
  selectedArcForCurveCogo: CadArcEntity | null;
  selectedLineCommandPoints: SelectedLineCommandPoints | null;
  selectedLinePairCommandPoints: SelectedLinePairCommandPoints | null;
  selectedAlignmentForStationing: CadAlignmentEntity | null;
  selectedParcelForBearingSplit: CadParcelEntity | null;
  selectedParcelForAreaSplit: CadParcelEntity | null;
  /** Parcel ids in pick order (19D network sessions capture these at start). */
  selectedParcelEntityIds?: string[];
  selectionCount: number;
  /** Current selection in pick order (survey-table source capture). */
  selectedEntityIds?: string[];
  /** Fallback POINTTABLE ordering when nothing is selected. */
  surveyPointEntityIdsInStationOrder?: string[];
  /**
   * Phase C3 — the sole selected editable polyline id, or null when the
   * selection is empty/ambiguous/locked. Seeds the vertex-topology sessions
   * so a second pick is only needed for the vertex/course.
   */
  selectedEditablePolylineId?: string | null;
  /**
   * CAD Best Fit E1 — live project for selection preseed (survey-point
   * attribution). Absent = sessions start empty.
   */
  bestFitProject?: CadProject | null;
}
