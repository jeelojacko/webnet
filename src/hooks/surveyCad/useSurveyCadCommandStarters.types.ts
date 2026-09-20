import type {
  CadAlignmentEntity,
  CadArcEntity,
  CadParcelEntity,
} from '../../engine/cad/cadTypes';
import type { CommandPoint, CommandSession } from './useSurveyCadCommandTypes';
import type {
  SelectedLineCommandPoints,
  SelectedLinePairCommandPoints,
} from './useSurveyCadCommandSelection';

export type BeginCommandSession = (_session: CommandSession) => void;
export type BatchCogoDraftBuilder = (
  _inputValue: string,
) => Extract<CommandSession, { key: 'BATCH_COGO' }>['draft'];

export interface SurveyCadCommandStarters {
  startPointCommand: () => void;
  startCogoPointCommand: () => void;
  startLineCommand: () => void;
  startPolylineCommand: () => void;
  startTraverseCommand: () => void;
  startBatchCogoCommand: () => void;
  startParcelSplitBearingCommand: () => void;
  startParcelSplitAreaCommand: () => void;
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
  startMoveCommand: () => void;
  startCopyCommand: () => void;
  startRotateCommand: () => void;
  startScaleCommand: () => void;
  startMirrorCommand: () => void;
  startAlign2DCommand: () => void;
  startHelmert2DCommand: () => void;
  startGridGroundCommand: () => void;
  startExtendCommand: () => void;
  startTrimCommand: () => void;
  startFilletCommand: () => void;
  startPasteCommand: (_sourceEntityIds: string[], _basePoint: CommandPoint) => void;
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
  selectionCount: number;
}
