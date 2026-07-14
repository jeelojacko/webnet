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

type BeginCommandSession = (_session: CommandSession) => void;
type BatchCogoDraftBuilder = (
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
  startMoveCommand: () => void;
  startCopyCommand: () => void;
  startExtendCommand: () => void;
  startTrimCommand: () => void;
  startFilletCommand: () => void;
  startPasteCommand: (_sourceEntityIds: string[], _basePoint: CommandPoint) => void;
}

interface BuildSurveyCadCommandStartersOptions {
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

const lineCommandSession = (
  key: 'DEFLECT_POINT' | 'POINT_ALONG_LINE' | 'EXTEND_LINE' | 'OFFSET_POINT',
  selectedLineCommandPoints: SelectedLineCommandPoints,
): CommandSession => ({
  key,
  inputValue: '',
  lineStart: selectedLineCommandPoints.start,
  lineEnd: selectedLineCommandPoints.end,
});

const selectedArcCommandSession = (
  key: 'RADIAL_BEARING' | 'POINT_ON_CURVE' | 'SUBDIVIDE_CURVE' | 'OFFSET_CURVE' | 'REVERSE_CURVE' | 'COMPOUND_CURVE',
  arc: CadArcEntity,
): CommandSession => ({
  key,
  inputValue: '',
  arc,
});

export const useSurveyCadCommandStarters = ({
  beginSession,
  buildBatchCogoDraftForInput,
  selectedArcForContinue,
  selectedArcForCurveCogo,
  selectedLineCommandPoints,
  selectedLinePairCommandPoints,
  selectedAlignmentForStationing,
  selectedParcelForBearingSplit,
  selectedParcelForAreaSplit,
  selectionCount,
}: BuildSurveyCadCommandStartersOptions): SurveyCadCommandStarters => ({
  startPointCommand: () => beginSession({ key: 'POINT', inputValue: '' }),
  startCogoPointCommand: () =>
    beginSession({
      key: 'COGO_POINT',
      inputValue: '',
      startPoint: null,
    }),
  startLineCommand: () =>
    beginSession({
      key: 'LINE',
      inputValue: '',
      startPoint: null,
    }),
  startPolylineCommand: () =>
    beginSession({
      key: 'PLINE',
      inputValue: '',
      points: [],
    }),
  startTraverseCommand: () =>
    beginSession({
      key: 'TRAVERSE',
      inputValue: '',
      points: [],
      inputPoints: [],
      legInputs: [],
      mode: 'open',
      closePoint: null,
      sideshots: [],
      adjustment: null,
    }),
  startBatchCogoCommand: () =>
    beginSession({
      key: 'BATCH_COGO',
      inputValue: '',
      draft: buildBatchCogoDraftForInput(''),
    }),
  startParcelSplitBearingCommand: () => {
    if (!selectedParcelForBearingSplit) return;
    beginSession({
      key: 'PARCEL_SPLIT_BEARING',
      inputValue: '',
      parcel: selectedParcelForBearingSplit,
      splitPoint: null,
    });
  },
  startParcelSplitAreaCommand: () => {
    if (!selectedParcelForAreaSplit) return;
    beginSession({
      key: 'PARCEL_SPLIT_AREA',
      inputValue: '',
      parcel: selectedParcelForAreaSplit,
      splitPoint: null,
    });
  },
  startArc3PointCommand: () => beginSession({ key: 'ARC_3PT', inputValue: '', points: [] }),
  startArcStartCenterEndCommand: () => beginSession({ key: 'ARC_SCE', inputValue: '', points: [] }),
  startArcCenterStartEndCommand: () => beginSession({ key: 'ARC_CSE', inputValue: '', points: [] }),
  startArcStartCenterAngleCommand: () => beginSession({ key: 'ARC_SCA', inputValue: '', points: [] }),
  startArcCenterStartAngleCommand: () => beginSession({ key: 'ARC_CSA', inputValue: '', points: [] }),
  startArcStartCenterChordCommand: () => beginSession({ key: 'ARC_SCL', inputValue: '', points: [] }),
  startArcCenterStartChordCommand: () => beginSession({ key: 'ARC_CSL', inputValue: '', points: [] }),
  startArcStartEndAngleCommand: () => beginSession({ key: 'ARC_SEA', inputValue: '', points: [] }),
  startArcStartEndDirectionCommand: () => beginSession({ key: 'ARC_SED', inputValue: '', points: [] }),
  startArcStartEndRadiusCommand: () => beginSession({ key: 'ARC_SER', inputValue: '', points: [] }),
  startContinueCurveCommand: () => {
    if (!selectedArcForContinue) return;
    beginSession({
      key: 'CONTINUE_CURVE',
      inputValue: '',
      sourceArc: selectedArcForContinue,
    });
  },
  startTangentCurveCommand: () =>
    beginSession({
      key: 'TANGENT_CURVE',
      inputValue: '',
      piPoint: null,
      backTangentPoint: null,
      aheadTangentPoint: null,
    }),
  startInverseCommand: () => beginSession({ key: 'INVERSE', inputValue: '', startPoint: null }),
  startMultiInverseCommand: () => beginSession({ key: 'MULTI_INVERSE', inputValue: '', points: [] }),
  startAreaCommand: () => beginSession({ key: 'AREA', inputValue: '', points: [] }),
  startBearingReportCommand: () => beginSession({ key: 'BEARING_REPORT', inputValue: '', startPoint: null }),
  startDistanceReportCommand: () => beginSession({ key: 'DISTANCE_REPORT', inputValue: '', startPoint: null }),
  startTurnedPointCommand: () =>
    beginSession({
      key: 'TURNED_POINT',
      inputValue: '',
      occupyPoint: null,
      backsightPoint: null,
    }),
  startDeflectionPointCommand: () => {
    if (!selectedLineCommandPoints) return;
    beginSession(lineCommandSession('DEFLECT_POINT', selectedLineCommandPoints));
  },
  startPointAlongLineCommand: () => {
    if (!selectedLineCommandPoints) return;
    beginSession(lineCommandSession('POINT_ALONG_LINE', selectedLineCommandPoints));
  },
  startExtendLineCommand: () => {
    if (!selectedLineCommandPoints) return;
    beginSession(lineCommandSession('EXTEND_LINE', selectedLineCommandPoints));
  },
  startOffsetPointCommand: () => {
    if (!selectedLineCommandPoints) return;
    beginSession(lineCommandSession('OFFSET_POINT', selectedLineCommandPoints));
  },
  startAlignmentOffsetCreateCommand: () => {
    if (!selectedAlignmentForStationing) return;
    beginSession({
      key: 'ALIGNMENT_OFFSET_CREATE',
      inputValue: '',
      alignment: selectedAlignmentForStationing,
    });
  },
  startAlignmentStationEquationCommand: () => {
    if (!selectedAlignmentForStationing) return;
    beginSession({
      key: 'ALIGNMENT_STATION_EQUATION',
      inputValue: '',
      alignment: selectedAlignmentForStationing,
    });
  },
  startAlignmentOffsetPointCommand: () => {
    if (!selectedAlignmentForStationing) return;
    beginSession({
      key: 'ALIGNMENT_OFFSET_POINT',
      inputValue: '',
      alignment: selectedAlignmentForStationing,
    });
  },
  startAlignmentIntervalPointsCommand: () => {
    if (!selectedAlignmentForStationing) return;
    beginSession({
      key: 'ALIGNMENT_INTERVAL_POINTS',
      inputValue: '',
      alignment: selectedAlignmentForStationing,
    });
  },
  startCurveSolverCommand: () => beginSession({ key: 'CURVE_SOLVER', inputValue: '' }),
  startRadialBearingCommand: () => {
    if (!selectedArcForCurveCogo) return;
    beginSession(selectedArcCommandSession('RADIAL_BEARING', selectedArcForCurveCogo));
  },
  startPointOnCurveCommand: () => {
    if (!selectedArcForCurveCogo) return;
    beginSession(selectedArcCommandSession('POINT_ON_CURVE', selectedArcForCurveCogo));
  },
  startSubdivideCurveCommand: () => {
    if (!selectedArcForCurveCogo) return;
    beginSession(selectedArcCommandSession('SUBDIVIDE_CURVE', selectedArcForCurveCogo));
  },
  startOffsetCurveCommand: () => {
    if (!selectedArcForCurveCogo) return;
    beginSession(selectedArcCommandSession('OFFSET_CURVE', selectedArcForCurveCogo));
  },
  startPiCurveCommand: () =>
    beginSession({
      key: 'PI_CURVE',
      inputValue: '',
      piPoint: null,
      backTangentPoint: null,
    }),
  startChordBearingCurveCommand: () =>
    beginSession({
      key: 'CHORD_BEARING_CURVE',
      inputValue: '',
      startPoint: null,
    }),
  startReverseCurveCommand: () => {
    if (!selectedArcForCurveCogo) return;
    beginSession(selectedArcCommandSession('REVERSE_CURVE', selectedArcForCurveCogo));
  },
  startCompoundCurveCommand: () => {
    if (!selectedArcForCurveCogo) return;
    beginSession(selectedArcCommandSession('COMPOUND_CURVE', selectedArcForCurveCogo));
  },
  startBearingBearingIntersectionCommand: () =>
    beginSession({
      key: 'BEARING_BEARING_INTX',
      inputValue: '',
      firstPoint: null,
      secondPoint: null,
    }),
  startBearingDistanceIntersectionCommand: () =>
    beginSession({
      key: 'BEARING_DISTANCE_INTX',
      inputValue: '',
      firstPoint: null,
      secondPoint: null,
    }),
  startDistanceDistanceIntersectionCommand: () =>
    beginSession({
      key: 'DISTANCE_DISTANCE_INTX',
      inputValue: '',
      firstPoint: null,
      secondPoint: null,
    }),
  startLineCircleIntersectionCommand: () => {
    if (!selectedLineCommandPoints) return;
    beginSession({
      key: 'LINE_CIRCLE_INTX',
      inputValue: '',
      lineStart: selectedLineCommandPoints.start,
      lineEnd: selectedLineCommandPoints.end,
      targetPoint: null,
    });
  },
  startPerpendicularIntersectionCommand: () => {
    if (!selectedLineCommandPoints) return;
    beginSession({
      key: 'PERP_INTX',
      inputValue: '',
      lineStart: selectedLineCommandPoints.start,
      lineEnd: selectedLineCommandPoints.end,
      targetPoint: null,
    });
  },
  startOffsetIntersectionCommand: () => {
    if (!selectedLinePairCommandPoints) return;
    beginSession({
      key: 'OFFSET_INTX',
      inputValue: '',
      firstLineStart: selectedLinePairCommandPoints.first.start,
      firstLineEnd: selectedLinePairCommandPoints.first.end,
      secondLineStart: selectedLinePairCommandPoints.second.start,
      secondLineEnd: selectedLinePairCommandPoints.second.end,
    });
  },
  startSkewIntersectionCommand: () => {
    if (!selectedLineCommandPoints) return;
    beginSession({
      key: 'SKEW_INTX',
      inputValue: '',
      lineStart: selectedLineCommandPoints.start,
      lineEnd: selectedLineCommandPoints.end,
      targetPoint: null,
    });
  },
  startMoveCommand: () => {
    if (selectionCount === 0) return;
    beginSession({ key: 'MOVE', inputValue: '', startPoint: null });
  },
  startCopyCommand: () => {
    if (selectionCount === 0) return;
    beginSession({ key: 'COPY', inputValue: '', startPoint: null });
  },
  startExtendCommand: () =>
    beginSession({
      key: 'EXTEND',
      inputValue: '',
      firstTargetEntityId: null,
      firstTargetPickPoint: null,
      firstTargetSegmentId: undefined,
    }),
  startTrimCommand: () =>
    beginSession({
      key: 'TRIM',
      inputValue: '',
      firstEntityId: null,
      firstPickPoint: null,
      firstSegmentId: undefined,
    }),
  startFilletCommand: () =>
    beginSession({
      key: 'FILLET',
      inputValue: '',
      radius: null,
      firstEntityId: null,
      firstPickPoint: null,
      firstSegmentId: undefined,
    }),
  startPasteCommand: (sourceEntityIds, basePoint) => {
    if (sourceEntityIds.length === 0) return;
    beginSession({
      key: 'PASTE',
      inputValue: '',
      startPoint: basePoint,
      sourceEntityIds,
    });
  },
});
