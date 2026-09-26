import type {
  CadArcEntity,
} from '../../engine/cad/cadTypes';
import type { CommandSession } from './useSurveyCadCommandTypes';
import type {
  SelectedLineCommandPoints,
} from './useSurveyCadCommandSelection';
import type {
  BuildSurveyCadCommandStartersOptions,
  SurveyCadCommandStarters,
} from './useSurveyCadCommandStarters.types';

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
  selectedEntityIds = [],
  surveyPointEntityIdsInStationOrder = [],
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
  // Phase 18O annotation creation sessions (fixed anchors; text via input).
  startMTextCommand: () => beginSession({ key: 'MTEXT', inputValue: '', point: null, lines: [] }),
  startLeaderCommand: () => beginSession({ key: 'LEADER', inputValue: '', arrowPoint: null, lines: [] }),
  startDimCommand: () => beginSession({ key: 'DIM', inputValue: '', points: [] }),
  startDimLinearCommand: () => beginSession({ key: 'DIMLINEAR', inputValue: '', points: [] }),
  startDimAlignedCommand: () => beginSession({ key: 'DIMALIGNED', inputValue: '', points: [] }),
  startDimAngularCommand: () => beginSession({ key: 'DIMANGULAR', inputValue: '', points: [] }),
  startDimRadiusCommand: () => beginSession({ key: 'DIMRADIUS', inputValue: '', points: [] }),
  startDimDiameterCommand: () => beginSession({ key: 'DIMDIAMETER', inputValue: '', points: [] }),
  startBearingLabelCommand: () =>
    beginSession({ key: 'BDLABEL', inputValue: '', points: [], sourceEntityId: null }),
  startCurveLabelCommand: () =>
    beginSession({ key: 'CURVELABEL', inputValue: '', points: [], sourceEntityId: null }),
  startMoveCommand: () => {
    if (selectionCount === 0) return;
    beginSession({ key: 'MOVE', inputValue: '', startPoint: null });
  },
  startRotateCommand: () => {
    if (selectionCount === 0) return;
    beginSession({ key: 'ROTATE', inputValue: '', basePoint: null, refPoint: null });
  },
  startScaleCommand: () => {
    if (selectionCount === 0) return;
    beginSession({ key: 'SCALE', inputValue: '', basePoint: null });
  },
  startMirrorCommand: () => {
    if (selectionCount === 0) return;
    beginSession({ key: 'MIRROR', inputValue: '', firstPoint: null, secondPoint: null, eraseSource: null });
  },
  startAlign2DCommand: () => {
    if (selectionCount === 0) return;
    beginSession({ key: 'ALIGN2D', inputValue: '', source1: null, source2: null, target1: null, target2: null, scaleToFit: null });
  },
  startHelmert2DCommand: () => {
    if (selectionCount === 0) return;
    beginSession({ key: 'HELMERT2D', inputValue: '', mode: 'SIMILARITY', pairs: [], pendingSource: null });
  },
  startGridGroundCommand: () => {
    if (selectionCount === 0) return;
    beginSession({ key: 'GRIDGROUND', inputValue: '', origin: null, combinedScaleFactor: null, direction: 'GRID_TO_GROUND' });
  },
  // Whole-drawing scope: no selection required.
  startProjectTransformCommand: () => {
    beginSession({
      key: 'PROJECTTRANSFORM',
      inputValue: '',
      projectMode: 'HELMERT',
      helmertMode: 'SIMILARITY',
      pairs: [],
      pendingSource: null,
      origin: null,
      combinedScaleFactor: null,
      direction: 'GRID_TO_GROUND',
    });
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
  startLineTableCommand: () => {
    if (selectedEntityIds.length === 0) return;
    beginSession({
      key: 'SURVEYTABLE',
      inputValue: '',
      engineKey: 'LINETABLE',
      tableKind: 'line',
      sourceEntityIds: selectedEntityIds,
      insertion: null,
    });
  },
  startCurveTableCommand: () => {
    if (selectedEntityIds.length === 0) return;
    beginSession({
      key: 'SURVEYTABLE',
      inputValue: '',
      engineKey: 'CURVETABLE',
      tableKind: 'curve',
      sourceEntityIds: selectedEntityIds,
      insertion: null,
    });
  },
  startParcelTableCommand: () => {
    if (selectedEntityIds.length === 0) return;
    beginSession({
      key: 'SURVEYTABLE',
      inputValue: '',
      engineKey: 'PARCELTABLE',
      tableKind: 'parcel-course',
      sourceEntityIds: selectedEntityIds,
      insertion: null,
    });
  },
  startPointTableCommand: () => {
    const sourceEntityIds =
      selectedEntityIds.length > 0 ? selectedEntityIds : surveyPointEntityIdsInStationOrder;
    if (sourceEntityIds.length === 0) return;
    beginSession({
      key: 'SURVEYTABLE',
      inputValue: '',
      engineKey: 'POINTTABLE',
      tableKind: 'point',
      sourceEntityIds,
      insertion: null,
    });
  },
  startParcelReportCommand: () => {
    const parcelEntityId = selectedEntityIds[0];
    if (parcelEntityId == null) return;
    beginSession({
      key: 'SURVEYTABLE',
      inputValue: '',
      engineKey: 'PARCELREPORT',
      tableKind: 'parcel-summary',
      sourceEntityIds: [parcelEntityId],
      insertion: null,
    });
  },
  startParcelDescCommand: () => {
    const parcelEntityId = selectedEntityIds[0];
    if (parcelEntityId == null) return;
    beginSession({
      key: 'SURVEYTABLE',
      inputValue: '',
      engineKey: 'PARCELDESC',
      tableKind: 'parcel-course',
      sourceEntityIds: [parcelEntityId],
      insertion: null,
    });
  },
});
