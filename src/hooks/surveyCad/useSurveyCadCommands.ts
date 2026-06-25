import { useEffect, useMemo, useRef, useState } from 'react';
import { dmsToRad } from '../../engine/angles';
import {
  cadDraftBatchCogo,
  type CadBatchCogoDraft,
} from '../../engine/cad/cadBatchCogo';
import {
  cadArcPointByArcDistance,
  cadArcPointByChordDistance,
  cadArcSubdivisionPoints,
  cadAdjustTraverse,
  cadBuildArcFromChordBearingRadius,
  cadBuildArcFromPiRadiusDelta,
  cadBuildCompoundCurve,
  buildCadDistanceSummary,
  buildCadInverseSummary,
  buildCadMultiInverseSummary,
  cadBuildCurveMetricsSummaryFromRadiusDelta,
  cadComputeDeflectionAnglePoint,
  cadComputeTurnedAnglePoint,
  cadExtendLineByDistance,
  cadOffsetArc,
  cadRadialBearingAtArcAngle,
  cadSolveCurveMetrics,
  cadIntersectBearingDistance,
  cadIntersectBearings,
  cadIntersectDistanceDistance,
  cadIntersectLineCircle,
  cadIntersectOffsetLines,
  cadIntersectPerpendicular,
  cadIntersectSkew,
  cadBuildReverseCurve,
  cadOffsetPointFromLine,
  cadPointAtDistanceAlongLine,
  cadPointAtFractionAlongLine,
  formatCadBearing,
  cadPointFromBearingDistance,
  type CadTraverseAdjustmentMethod,
  type CadTraverseAdjustmentSummary,
} from '../../engine/cad/cadCogo';
import { buildCadCogoComputation } from '../../engine/cad/cadCogoTypes';
import {
  cadArcEndPoint,
  cadBuildArcFromStartCenterAngle,
  cadBuildArcFromStartCenterChord,
  cadBuildArcFromStartCenterEnd,
  cadBuildArcFromStartEndAngle,
  cadBuildArcFromStartEndDirection,
  cadBuildArcFromStartEndRadius,
  cadBuildArcFromThreePoints,
  cadBuildContinuedArc,
  cadBuildTangentCurve,
  cadParseBearingDegrees,
  cadPointFromAzimuthDistance,
  cadSignedSweepDeg,
  type CadNamedPoint,
} from '../../engine/cad/cadGeometry';
import {
  cadBuildAlignmentStationPoints,
  cadBuildOffsetAlignmentDraft,
  cadPointAtAlignmentStationOffset,
} from '../../engine/cad/cadAlignment';
import { runCadCommand, type CadHistoryState } from '../../engine/cad/cadUndoRedo';
import type {
  CadAlignmentEntity,
  CadArcEntity,
  CadDisplayPrimitive,
  CadLineEntity,
  CadPolylineEntity,
  CadSnapCandidate,
  CadSnapConstructionContext,
  CadSnapKind,
} from '../../engine/cad/cadTypes';

type CommandPoint = CadNamedPoint & {
  snapSourceSegmentId?: string;
  snapSourceEntityId?: string;
  snapKind?: CadSnapKind;
  extendMode?: boolean;
};

type TraverseDraftMode = 'open' | 'closed' | 'point-to-point';

interface TraverseSideshotDraft {
  occupyLabel: string;
  backsightLabel: string;
  side: 'left' | 'right';
  angleDeg: number;
  distance: number;
  inputValue: string;
  point: {
    label: string;
    x: number;
    y: number;
  };
}

interface TraverseAdjustmentDraft {
  method: CadTraverseAdjustmentMethod;
  summary: CadTraverseAdjustmentSummary;
}

type ActiveCommandKey =
  | 'POINT'
  | 'COGO_POINT'
  | 'LINE'
  | 'PLINE'
  | 'TRAVERSE'
  | 'ARC_3PT'
  | 'ARC_SCE'
  | 'ARC_CSE'
  | 'ARC_SCA'
  | 'ARC_CSA'
  | 'ARC_SCL'
  | 'ARC_CSL'
  | 'ARC_SEA'
  | 'ARC_SED'
  | 'ARC_SER'
  | 'CONTINUE_CURVE'
  | 'TANGENT_CURVE'
  | 'INVERSE'
  | 'MULTI_INVERSE'
  | 'BEARING_REPORT'
  | 'DISTANCE_REPORT'
  | 'TURNED_POINT'
  | 'DEFLECT_POINT'
  | 'POINT_ALONG_LINE'
  | 'EXTEND_LINE'
  | 'OFFSET_POINT'
  | 'ALIGNMENT_OFFSET_CREATE'
  | 'ALIGNMENT_STATION_EQUATION'
  | 'ALIGNMENT_OFFSET_POINT'
  | 'ALIGNMENT_INTERVAL_POINTS'
  | 'CURVE_SOLVER'
  | 'RADIAL_BEARING'
  | 'POINT_ON_CURVE'
  | 'SUBDIVIDE_CURVE'
  | 'OFFSET_CURVE'
  | 'PI_CURVE'
  | 'CHORD_BEARING_CURVE'
  | 'REVERSE_CURVE'
  | 'COMPOUND_CURVE'
  | 'BEARING_BEARING_INTX'
  | 'BEARING_DISTANCE_INTX'
  | 'DISTANCE_DISTANCE_INTX'
  | 'LINE_CIRCLE_INTX'
  | 'PERP_INTX'
  | 'OFFSET_INTX'
  | 'SKEW_INTX'
  | 'BATCH_COGO'
  | 'MOVE'
  | 'COPY'
  | 'EXTEND'
  | 'TRIM'
  | 'FILLET'
  | 'PASTE';

type CommandSession =
  | {
      key: 'POINT';
      inputValue: string;
      resultText?: string;
    }
  | {
      key: 'COGO_POINT' | 'LINE' | 'INVERSE' | 'MOVE' | 'COPY';
      inputValue: string;
      startPoint: CommandPoint | null;
      resultText?: string;
    }
  | {
      key: 'BEARING_REPORT' | 'DISTANCE_REPORT';
      inputValue: string;
      startPoint: CommandPoint | null;
      resultText?: string;
    }
  | {
      key: 'MULTI_INVERSE';
      inputValue: string;
      points: CommandPoint[];
      resultText?: string;
    }
  | {
      key: 'TURNED_POINT';
      inputValue: string;
      occupyPoint: CommandPoint | null;
      backsightPoint: CommandPoint | null;
      resultText?: string;
    }
  | {
      key: 'DEFLECT_POINT' | 'POINT_ALONG_LINE' | 'EXTEND_LINE' | 'OFFSET_POINT';
      inputValue: string;
      lineStart: CommandPoint;
      lineEnd: CommandPoint;
      resultText?: string;
    }
  | {
      key: 'ALIGNMENT_OFFSET_CREATE';
      inputValue: string;
      alignment: CadAlignmentEntity;
      resultText?: string;
    }
  | {
      key: 'ALIGNMENT_STATION_EQUATION';
      inputValue: string;
      alignment: CadAlignmentEntity;
      resultText?: string;
    }
  | {
      key: 'ALIGNMENT_OFFSET_POINT';
      inputValue: string;
      alignment: CadAlignmentEntity;
      resultText?: string;
    }
  | {
      key: 'ALIGNMENT_INTERVAL_POINTS';
      inputValue: string;
      alignment: CadAlignmentEntity;
      resultText?: string;
    }
  | {
      key: 'CURVE_SOLVER';
      inputValue: string;
      resultText?: string;
    }
  | {
      key: 'RADIAL_BEARING' | 'POINT_ON_CURVE' | 'SUBDIVIDE_CURVE' | 'OFFSET_CURVE' | 'REVERSE_CURVE' | 'COMPOUND_CURVE';
      inputValue: string;
      arc: CadArcEntity;
      resultText?: string;
    }
  | {
      key: 'PI_CURVE';
      inputValue: string;
      piPoint: CommandPoint | null;
      backTangentPoint: CommandPoint | null;
      resultText?: string;
    }
  | {
      key: 'CHORD_BEARING_CURVE';
      inputValue: string;
      startPoint: CommandPoint | null;
      resultText?: string;
    }
  | {
      key: 'BEARING_BEARING_INTX' | 'BEARING_DISTANCE_INTX' | 'DISTANCE_DISTANCE_INTX';
      inputValue: string;
      firstPoint: CommandPoint | null;
      secondPoint: CommandPoint | null;
      resultText?: string;
    }
  | {
      key: 'LINE_CIRCLE_INTX' | 'PERP_INTX' | 'SKEW_INTX';
      inputValue: string;
      lineStart: CommandPoint;
      lineEnd: CommandPoint;
      targetPoint: CommandPoint | null;
      resultText?: string;
    }
  | {
      key: 'OFFSET_INTX';
      inputValue: string;
      firstLineStart: CommandPoint;
      firstLineEnd: CommandPoint;
      secondLineStart: CommandPoint;
      secondLineEnd: CommandPoint;
      resultText?: string;
    }
  | {
      key: 'BATCH_COGO';
      inputValue: string;
      draft: CadBatchCogoDraft;
      resultText?: string;
    }
  | {
      key: 'PASTE';
      inputValue: string;
      startPoint: CommandPoint;
      sourceEntityIds: string[];
      resultText?: string;
    }
  | {
      key: 'EXTEND';
      inputValue: string;
      firstTargetEntityId: string | null;
      firstTargetPickPoint: CommandPoint | null;
      firstTargetSegmentId?: string;
      resultText?: string;
    }
  | {
      key: 'TRIM';
      inputValue: string;
      firstEntityId: string | null;
      firstPickPoint: CommandPoint | null;
      firstSegmentId?: string;
      resultText?: string;
    }
  | {
      key: 'FILLET';
      inputValue: string;
      radius: number | null;
      firstEntityId: string | null;
      firstPickPoint: CommandPoint | null;
      firstSegmentId?: string;
      resultText?: string;
    }
  | {
      key: 'PLINE';
      inputValue: string;
      points: CommandPoint[];
      resultText?: string;
    }
  | {
      key: 'TRAVERSE';
      inputValue: string;
      points: CommandPoint[];
      inputPoints: CommandPoint[];
      legInputs: string[];
      mode: TraverseDraftMode;
      closePoint: CommandPoint | null;
      sideshots: TraverseSideshotDraft[];
      adjustment: TraverseAdjustmentDraft | null;
      resultText?: string;
    }
  | {
      key: 'ARC_3PT';
      inputValue: string;
      points: CommandPoint[];
      resultText?: string;
    }
  | {
      key:
        | 'ARC_SCE'
        | 'ARC_CSE'
        | 'ARC_SCA'
        | 'ARC_CSA'
        | 'ARC_SCL'
        | 'ARC_CSL'
        | 'ARC_SEA'
        | 'ARC_SED'
        | 'ARC_SER';
      inputValue: string;
      points: CommandPoint[];
      resultText?: string;
    }
  | {
      key: 'CONTINUE_CURVE';
      inputValue: string;
      sourceArc: CadArcEntity;
      resultText?: string;
    }
  | {
      key: 'TANGENT_CURVE';
      inputValue: string;
      piPoint: CommandPoint | null;
      backTangentPoint: CommandPoint | null;
      aheadTangentPoint: CommandPoint | null;
      resultText?: string;
    };

interface UseSurveyCadCommandsArgs {
  activeSnap: CadSnapCandidate | null;
  previewPoint: { x: number; y: number; label: string } | null;
  history: CadHistoryState;
  selectionCount: number;
  selectedArcForContinue: CadArcEntity | null;
  selectedArcForCurveCogo: CadArcEntity | null;
  selectedLineForCoreCogo: CadLineEntity | null;
  selectedLinePairForIntersection: [CadLineEntity, CadLineEntity] | null;
  selectedAlignmentForStationing: CadAlignmentEntity | null;
  selectedStartPointForBatchCogo: CommandPoint | null;
  reverseDirectionModifier: boolean;
  applyHistoryUpdate: (_updater: (_history: CadHistoryState) => CadHistoryState) => void;
  onReportComputation?: (
    _computation: ReturnType<typeof buildCadCogoComputation> | null,
  ) => void;
}

export type CadCommandPreviewState =
  | {
      kind: 'point';
      point: { x: number; y: number };
    }
  | {
      kind: 'line';
      points: [{ x: number; y: number }, { x: number; y: number }];
    }
  | {
      kind: 'polyline';
      points: Array<{ x: number; y: number }>;
    }
  | {
      kind: 'arc';
      center: { x: number; y: number };
      radius: number;
      startAngleDeg: number;
      endAngleDeg: number;
    }
  | {
      kind: 'translate-selection';
      deltaX: number;
      deltaY: number;
      sourceEntityIds?: string[];
    }
  | {
      kind: 'primitives';
      primitives: CadDisplayPrimitive[];
    };

interface UseSurveyCadCommandsResult {
  activeCommandKey: ActiveCommandKey | null;
  commandInputValue: string;
  commandPrompt: string;
  commandHelpText: string;
  commandPreview: CadCommandPreviewState | null;
  activeTrimCuttingEntityIds: string[];
  activeExtendTarget:
    | {
        entityId: string;
        pickPoint: { x: number; y: number };
        segmentId?: string;
      }
    | null;
  activeFilletPreview:
    | {
        radius: number;
        firstEntityId: string;
        firstPickPoint: { x: number; y: number };
        firstSegmentId?: string;
      }
    | null;
  activeBatchCogoDraft: {
    inputValue: string;
    startPoint: { label: string; x: number; y: number } | null;
    startPointSource: 'selected' | 'input' | null;
    endPoint: { label: string; x: number; y: number } | null;
    previewRows: Array<{
      lineNumber: number;
      input: string;
      kind: 'start' | 'line' | 'curve';
      status: 'ok' | 'warning' | 'error';
      summary: string;
    }>;
    warnings: Array<{
      code: string;
      message: string;
      severity: 'info' | 'warning' | 'error';
    }>;
    generatedPointCount: number;
    generatedLineCount: number;
    generatedArcCount: number;
    canCommit: boolean;
  } | null;
  activeTraverseDraft: {
    points: Array<{ label: string; x: number; y: number }>;
    mode: TraverseDraftMode;
    closePoint: { label: string; x: number; y: number } | null;
    legs: Array<{
      fromLabel: string;
      toLabel: string;
      bearing: string;
      distance: number;
      inputValue: string;
    }>;
    sideshots: TraverseSideshotDraft[];
    totalLength: number;
    closureTargetLabel: string | null;
    closureDeltaX: number | null;
    closureDeltaY: number | null;
    closureDistance: number | null;
    closureBearing: string | null;
    closureRatio: number | null;
    adjustment: {
      method: CadTraverseAdjustmentMethod;
      targetLabel: string;
      rawClosureDistance: number;
      adjustedClosureDistance: number;
      rawClosureBearing: string | null;
      adjustedClosureBearing: string | null;
      angularCorrectionPerLegSec: number | null;
    } | null;
  } | null;
  snapConstructionContext: CadSnapConstructionContext;
  commandExpectsPointPick: boolean;
  canUseActiveSnap: boolean;
  canCycleActiveSnap: boolean;
  canFinishCommand: boolean;
  canCloseTraverseDraft: boolean;
  startPointCommand: () => void;
  startCogoPointCommand: () => void;
  startLineCommand: () => void;
  startPolylineCommand: () => void;
  startTraverseCommand: () => void;
  startBatchCogoCommand: () => void;
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
  cancelCommand: () => void;
  finishCommand: () => void;
  setCommandInputValue: (_value: string) => void;
  appendCommandInputValue: (_value: string) => void;
  backspaceCommandInputValue: () => void;
  submitCommandInput: () => void;
  useActiveSnap: () => void;
  editTraverseDraftLeg: (_legIndex: number) => void;
  replaceTraverseDraftLeg: (_legIndex: number, _inputValue: string) => boolean;
  appendTraverseDraftPoint: (_inputValue: string) => boolean;
  insertTraverseDraftLeg: (_legIndex: number, _inputValue: string) => boolean;
  moveTraverseDraftLeg: (_legIndex: number, _direction: -1 | 1) => boolean;
  applyTraverseDraftAdjustment: (_method: CadTraverseAdjustmentMethod) => boolean;
  clearTraverseDraftAdjustment: () => void;
  setTraverseDraftMode: (_mode: TraverseDraftMode) => void;
  setTraverseDraftClosePoint: (_point: CommandPoint | null) => void;
  addTraverseDraftSideshot: (_occupyPointIndex: number, _inputValue: string) => boolean;
  removeTraverseDraftSideshot: (_sideshotIndex: number) => void;
  rewindTraverseDraftToPointCount: (_pointCount: number) => void;
  closeTraverseDraftLoop: () => void;
  setBatchCogoInputValue: (_value: string) => void;
  commitBatchCogoDraft: () => void;
  consumeInteractionPoint: (
    _point: { x: number; y: number },
    _label?: string,
    _options?: {
      snapSourceSegmentId?: string;
      snapSourceEntityId?: string;
      snapKind?: CadSnapKind;
      extendMode?: boolean;
    },
  ) => void;
  handleEnterKey: () => void;
  handleEscapeKey: () => void;
}

const isNumeric = (value: string): boolean => value.trim().length > 0 && Number.isFinite(Number(value));

const ARC_TANGENT_SEED_KINDS = new Set<CadSnapKind>([
  'nearest',
  'endpoint',
  'arc-midpoint',
  'quadrant',
  'center',
]);

const tangentSeedArcEntityIdFromPoint = (point: CommandPoint | null): string | null => {
  if (!point?.snapSourceEntityId || !point.snapKind) return null;
  if (!ARC_TANGENT_SEED_KINDS.has(point.snapKind)) return null;
  return point.snapSourceEntityId;
};

const tangentSeedPointFromPoint = (
  point: CommandPoint | null,
): { x: number; y: number } | null =>
  tangentSeedArcEntityIdFromPoint(point) ? { x: point!.x, y: point!.y } : null;

const buildTraverseLegInputFromPoints = (fromPoint: CommandPoint, toPoint: CommandPoint): string => {
  const inverse = buildCadInverseSummary(fromPoint, toPoint);
  return `${inverse.bearing},${inverse.distance.toFixed(3)}`;
};

const buildTraverseClosureTarget = (
  mode: TraverseDraftMode,
  inputPoints: readonly CommandPoint[],
  closePoint: CommandPoint | null,
): CommandPoint | null => {
  if (mode === 'closed') return inputPoints[0] ?? null;
  if (mode === 'point-to-point') return closePoint;
  return inputPoints.length > 0 ? inputPoints[0]! : null;
};

const recalculateTraverseSideshotPoint = (
  points: readonly CommandPoint[],
  sideshot: TraverseSideshotDraft,
): TraverseSideshotDraft => {
  const occupyIndex = points.findIndex((point) => point.label === sideshot.occupyLabel);
  const occupyPoint = occupyIndex > 0 ? points[occupyIndex] ?? null : null;
  const backsightPoint = occupyIndex > 0 ? points[occupyIndex - 1] ?? null : null;
  if (!occupyPoint || !backsightPoint) return sideshot;
  const nextPoint = cadComputeTurnedAnglePoint({
    occupyPoint,
    backsightPoint,
    angleDeg: sideshot.angleDeg,
    distance: sideshot.distance,
    side: sideshot.side,
  });
  return {
    ...sideshot,
    point: {
      label: sideshot.point.label,
      x: nextPoint.x,
      y: nextPoint.y,
    },
  };
};

const sessionExpectsPointPick = (session: CommandSession | null): boolean => {
  if (!session) return false;
  switch (session.key) {
    case 'POINT':
    case 'COGO_POINT':
    case 'LINE':
    case 'INVERSE':
    case 'BEARING_REPORT':
    case 'DISTANCE_REPORT':
    case 'MOVE':
    case 'COPY':
    case 'EXTEND':
    case 'TRIM':
    case 'FILLET':
    case 'PASTE':
    case 'PLINE':
    case 'TRAVERSE':
    case 'MULTI_INVERSE':
    case 'BEARING_BEARING_INTX':
    case 'BEARING_DISTANCE_INTX':
    case 'DISTANCE_DISTANCE_INTX':
    case 'CHORD_BEARING_CURVE':
    case 'ARC_3PT':
    case 'CONTINUE_CURVE':
      return true;
    case 'ARC_SCE':
    case 'ARC_CSE':
      return session.points.length < 3;
    case 'ARC_SCA':
    case 'ARC_CSA':
    case 'ARC_SCL':
    case 'ARC_CSL':
    case 'ARC_SEA':
    case 'ARC_SED':
    case 'ARC_SER':
      return session.points.length < 2;
    case 'TANGENT_CURVE':
      return session.aheadTangentPoint == null;
    case 'TURNED_POINT':
      return session.backsightPoint == null;
    case 'PI_CURVE':
      return session.backTangentPoint == null;
    case 'LINE_CIRCLE_INTX':
    case 'PERP_INTX':
    case 'SKEW_INTX':
      return session.targetPoint == null;
    case 'CURVE_SOLVER':
    case 'RADIAL_BEARING':
    case 'POINT_ON_CURVE':
    case 'SUBDIVIDE_CURVE':
    case 'OFFSET_CURVE':
    case 'REVERSE_CURVE':
    case 'COMPOUND_CURVE':
    case 'OFFSET_INTX':
    case 'ALIGNMENT_OFFSET_CREATE':
    case 'ALIGNMENT_STATION_EQUATION':
    case 'ALIGNMENT_OFFSET_POINT':
    case 'ALIGNMENT_INTERVAL_POINTS':
    case 'DEFLECT_POINT':
    case 'POINT_ALONG_LINE':
    case 'EXTEND_LINE':
    case 'OFFSET_POINT':
    case 'BATCH_COGO':
      return false;
  }
};

const splitLabelFromBody = (token: string): { label?: string; body: string } => {
  const normalized = token.trim();
  const labelIndex = normalized.indexOf('=');
  if (labelIndex < 0) return { body: normalized };
  return {
    label: normalized.slice(0, labelIndex).trim() || undefined,
    body: normalized.slice(labelIndex + 1).trim(),
  };
};

const parseAbsolutePoint = (token: string): CommandPoint | null => {
  const { label, body } = splitLabelFromBody(token);
  if (body.length === 0) return null;
  const parts = body.split(',').map((part) => part.trim());
  if (parts.length !== 2 || !isNumeric(parts[0]) || !isNumeric(parts[1])) return null;
  const x = Number(parts[0]);
  const y = Number(parts[1]);
  return {
    x,
    y,
    label: label || `${x.toFixed(3)},${y.toFixed(3)}`,
  };
};

const inputHasExplicitLabel = (token: string): boolean => {
  const { label } = splitLabelFromBody(token);
  return label != null && label.length > 0;
};

const isAutoGeneratedPointLabel = (point: CommandPoint): boolean =>
  point.label === `${point.x.toFixed(3)},${point.y.toFixed(3)}` || /^cad\d+$/i.test(point.label) || /^tp\d+$/i.test(point.label);

const nextAutoPointOrdinal = (
  points: readonly CommandPoint[],
  existingStationIds: readonly string[],
): number => {
  let maxOrdinal = 0;
  existingStationIds.forEach((stationId) => {
    const match = /^cad(\d+)$/i.exec(stationId);
    if (!match) return;
    maxOrdinal = Math.max(maxOrdinal, Number.parseInt(match[1] ?? '0', 10));
  });
  points.forEach((point) => {
    const match = /^cad(\d+)$/i.exec(point.label) ?? /^tp(\d+)$/i.exec(point.label);
    if (!match) return;
    maxOrdinal = Math.max(maxOrdinal, Number.parseInt(match[1] ?? '0', 10));
  });
  return maxOrdinal + 1;
};

const normalizeDraftPoint = (
  point: CommandPoint,
  existingPoints: readonly CommandPoint[],
  existingStationIds: readonly string[],
  options?: { rawInput?: string },
): CommandPoint => {
  const shouldAutoLabel =
    options?.rawInput != null
      ? !inputHasExplicitLabel(options.rawInput)
      : isAutoGeneratedPointLabel(point);
  if (!shouldAutoLabel) return point;
  return {
    ...point,
    label: `CAD${nextAutoPointOrdinal(existingPoints, existingStationIds)}`,
  };
};

const parseRelativeBearingDistance = (
  token: string,
  basePoint: CommandPoint | null,
): CommandPoint | null => {
  if (!basePoint) return null;
  const { label, body } = splitLabelFromBody(token);
  if (body.length === 0) return null;
  const trimmed = body.trim();
  const prefixed = trimmed.startsWith('@');
  const directionBody = prefixed ? trimmed.slice(1).trim() : trimmed;
  const parts = directionBody.split(',').map((part) => part.trim());
  if (parts.length !== 2 || !isNumeric(parts[1])) return null;
  const directionToken = parts[0];
  const distance = Number(parts[1]);
  const looksLikeBearing = /^[NS]/i.test(directionToken);
  if (!prefixed && !looksLikeBearing) return null;
  const azimuthDeg = looksLikeBearing
    ? cadParseBearingDegrees(directionToken)
    : isNumeric(directionToken)
      ? Number(directionToken)
      : null;
  if (azimuthDeg == null) return null;
  const point = looksLikeBearing
    ? cadPointFromBearingDistance(basePoint, directionToken, distance)
    : cadPointFromAzimuthDistance(basePoint, azimuthDeg, distance);
  if (!point) return null;
  return {
    ...point,
    label: label || `${prefixed ? '@' : ''}${directionToken},${distance}`,
  };
};

const parseAngleValueDeg = (token: string): number | null => {
  const trimmed = token.trim();
  if (trimmed.length === 0) return null;
  if (/^[+-]?\d{1,3}-\d{1,2}-\d{1,2}(?:\.\d+)?$/.test(trimmed)) {
    return (dmsToRad(trimmed) * 180) / Math.PI;
  }
  const numeric = Number(trimmed);
  return Number.isFinite(numeric) ? numeric : null;
};

const parseLeftRightAngleDistance = (
  token: string,
): { label?: string; side: 'left' | 'right'; angleDeg: number; distance: number } | null => {
  const { label, body } = splitLabelFromBody(token);
  const match = /^([LR])\s*([^,]+)\s*,\s*([-+]?\d*\.?\d+)\s*$/i.exec(body);
  if (!match) return null;
  const angleDeg = parseAngleValueDeg(match[2] ?? '');
  const distance = Number(match[3]);
  if (angleDeg == null || !Number.isFinite(distance) || distance <= 0) return null;
  return {
    label,
    side: (match[1] ?? '').toUpperCase() === 'L' ? 'left' : 'right',
    angleDeg,
    distance,
  };
};

const parseDistanceOrPercent = (
  token: string,
): { label?: string; distance?: number; fraction?: number } | null => {
  const { label, body } = splitLabelFromBody(token);
  const trimmed = body.trim();
  if (trimmed.endsWith('%')) {
    const percent = Number(trimmed.slice(0, -1));
    if (!Number.isFinite(percent)) return null;
    return { label, fraction: percent / 100 };
  }
  const distance = Number(trimmed);
  if (!Number.isFinite(distance)) return null;
  return { label, distance };
};

const parseOffsetPointInput = (
  token: string,
): { label?: string; side: 'left' | 'right'; offsetDistance: number; alongDistance?: number; alongFraction?: number } | null => {
  const { label, body } = splitLabelFromBody(token);
  const match = /^([LR])\s*([-+]?\d*\.?\d+)\s*,\s*(.+)$/i.exec(body);
  if (!match) return null;
  const offsetDistance = Number(match[2]);
  const along = parseDistanceOrPercent(match[3] ?? '');
  if (!Number.isFinite(offsetDistance) || !along) return null;
  return {
    label,
    side: (match[1] ?? '').toUpperCase() === 'L' ? 'left' : 'right',
    offsetDistance,
    alongDistance: along.distance,
    alongFraction: along.fraction,
  };
};

const parseAlignmentStationOffsetInput = (
  token: string,
): { label?: string; station: number; offset: number } | null => {
  const { label, body } = splitLabelFromBody(token);
  const parts = body.split(',').map((part) => part.trim());
  if (parts.length !== 2) return null;
  const station = Number(parts[0]);
  const offset = Number(parts[1]);
  if (!Number.isFinite(station) || !Number.isFinite(offset)) return null;
  return { label, station, offset };
};

const parseAlignmentOffsetCreateInput = (
  token: string,
): { name?: string; offset: number } | null => {
  const { label, body } = splitLabelFromBody(token);
  const offset = Number(body.trim());
  if (!Number.isFinite(offset) || Math.abs(offset) <= 1e-9) return null;
  return { name: label, offset };
};

const parseAlignmentStationEquationInput = (
  token: string,
): { backStation: number; aheadStation: number } | null => {
  const { body } = splitLabelFromBody(token);
  const parts = body.split(',').map((part) => part.trim());
  if (parts.length !== 2) return null;
  const backStation = Number(parts[0]);
  const aheadStation = Number(parts[1]);
  if (!Number.isFinite(backStation) || !Number.isFinite(aheadStation) || aheadStation < backStation) {
    return null;
  }
  return { backStation, aheadStation };
};

const parseAlignmentIntervalInput = (
  token: string,
): { labelPrefix?: string; startStation?: number; endStation?: number; interval: number } | null => {
  const { label, body } = splitLabelFromBody(token);
  const parts = body.split(',').map((part) => part.trim());
  if (parts.length === 1) {
    const interval = Number(parts[0]);
    if (!Number.isFinite(interval) || interval <= 0) return null;
    return {
      labelPrefix: label,
      interval,
    };
  }
  if (parts.length === 3) {
    const startStation = Number(parts[0]);
    const endStation = Number(parts[1]);
    const interval = Number(parts[2]);
    if (
      !Number.isFinite(startStation) ||
      !Number.isFinite(endStation) ||
      !Number.isFinite(interval) ||
      interval <= 0 ||
      endStation < startStation
    ) {
      return null;
    }
    return {
      labelPrefix: label,
      startStation,
      endStation,
      interval,
    };
  }
  return null;
};

const parseDualBearingInput = (
  token: string,
): { firstBearing: string; secondBearing: string } | null => {
  const parts = token.split(/[;|]/).map((part) => part.trim()).filter((part) => part.length > 0);
  if (parts.length !== 2) return null;
  if (cadParseBearingDegrees(parts[0]) == null || cadParseBearingDegrees(parts[1]) == null) return null;
  return {
    firstBearing: parts[0]!,
    secondBearing: parts[1]!,
  };
};

const parseBearingDistanceIntersectionInput = (
  token: string,
): { bearing: string; distance: number } | null => {
  const parts = token.split(/[;|]/).map((part) => part.trim()).filter((part) => part.length > 0);
  if (parts.length !== 2) return null;
  const distance = Number(parts[1]);
  if (cadParseBearingDegrees(parts[0]) == null || !Number.isFinite(distance) || distance < 0) return null;
  return {
    bearing: parts[0]!,
    distance,
  };
};

const parseDistancePairInput = (
  token: string,
): { firstDistance: number; secondDistance: number } | null => {
  const parts = token.split(',').map((part) => part.trim());
  if (parts.length !== 2) return null;
  const firstDistance = Number(parts[0]);
  const secondDistance = Number(parts[1]);
  if (!Number.isFinite(firstDistance) || !Number.isFinite(secondDistance)) return null;
  return { firstDistance, secondDistance };
};

const parseSideDistanceInput = (
  token: string,
): { side: 'left' | 'right'; distance: number } | null => {
  const match = /^([LR])\s*([-+]?\d*\.?\d+)\s*$/i.exec(token.trim());
  if (!match) return null;
  const distance = Number(match[2]);
  if (!Number.isFinite(distance)) return null;
  return {
    side: (match[1] ?? '').toUpperCase() === 'L' ? 'left' : 'right',
    distance,
  };
};

const parseDualOffsetInput = (
  token: string,
): { firstOffset: number; secondOffset: number } | null => {
  const parts = token.split(',').map((part) => part.trim());
  if (parts.length !== 2) return null;
  const first = parseSideDistanceInput(parts[0] ?? '');
  const second = parseSideDistanceInput(parts[1] ?? '');
  if (!first || !second) return null;
  return {
    firstOffset: first.side === 'left' ? first.distance : -first.distance,
    secondOffset: second.side === 'left' ? second.distance : -second.distance,
  };
};

const parseCurveSolverInput = (
  token: string,
):
  | {
      pair:
        | 'radius-delta'
        | 'radius-arc'
        | 'radius-chord'
        | 'radius-tangent'
        | 'delta-arc'
        | 'delta-chord'
        | 'delta-tangent'
        | 'arc-chord'
        | 'arc-tangent'
        | 'chord-tangent';
      firstValue: number;
      secondValue: number;
    }
  | null => {
  const parts = token.split(',').map((part) => part.trim());
  if (parts.length !== 4) return null;
  const pair = `${parts[0].toLowerCase()}-${parts[1].toLowerCase()}` as
    | 'radius-delta'
    | 'radius-arc'
    | 'radius-chord'
    | 'radius-tangent'
    | 'delta-arc'
    | 'delta-chord'
    | 'delta-tangent'
    | 'arc-chord'
    | 'arc-tangent'
    | 'chord-tangent';
  const allowedPairs = new Set([
    'radius-delta',
    'radius-arc',
    'radius-chord',
    'radius-tangent',
    'delta-arc',
    'delta-chord',
    'delta-tangent',
    'arc-chord',
    'arc-tangent',
    'chord-tangent',
  ]);
  if (!allowedPairs.has(pair)) return null;
  const firstValue = Number(parts[2]);
  const secondValue = Number(parts[3]);
  if (!Number.isFinite(firstValue) || !Number.isFinite(secondValue)) return null;
  return { pair, firstValue, secondValue };
};

const parseCurveSideRadiusDeltaInput = (
  token: string,
): { side: 'left' | 'right'; radius: number; deltaDeg: number } | null => {
  const match = /^([LR])\s*([-+]?\d*\.?\d+)\s*,\s*([^,]+)\s*$/i.exec(token.trim());
  if (!match) return null;
  const radius = Number(match[2]);
  const deltaDeg = parseAngleValueDeg(match[3] ?? '');
  if (!Number.isFinite(radius) || radius <= 0 || deltaDeg == null || deltaDeg <= 0) return null;
  return {
    side: (match[1] ?? '').toUpperCase() === 'L' ? 'left' : 'right',
    radius,
    deltaDeg,
  };
};

const parseCurveMeasureInput = (
  token: string,
): { mode: 'arc' | 'chord'; distance: number } | null => {
  const match = /^(ARC|CHORD)\s*[,; ]\s*([-+]?\d*\.?\d+)\s*$/i.exec(token.trim());
  if (!match) return null;
  const distance = Number(match[2]);
  if (!Number.isFinite(distance) || distance < 0) return null;
  return {
    mode: (match[1] ?? '').toUpperCase() === 'ARC' ? 'arc' : 'chord',
    distance,
  };
};

const parseCurveSubdivisionInput = (
  token: string,
): { mode: 'equal' | 'arc' | 'chord'; value: number } | null => {
  const match = /^(EQUAL|ARC|CHORD)\s*[,; ]\s*([-+]?\d*\.?\d+)\s*$/i.exec(token.trim());
  if (!match) return null;
  const value = Number(match[2]);
  if (!Number.isFinite(value) || value <= 0) return null;
  return {
    mode: (match[1] ?? '').toLowerCase() as 'equal' | 'arc' | 'chord',
    value,
  };
};

const parseOffsetArcInput = (
  token: string,
): { side: 'left' | 'right'; offsetDistance: number } | null => {
  const match = /^([LR])\s*([-+]?\d*\.?\d+)\s*$/i.exec(token.trim());
  if (!match) return null;
  const offsetDistance = Number(match[2]);
  if (!Number.isFinite(offsetDistance) || offsetDistance <= 0) return null;
  return {
    side: (match[1] ?? '').toUpperCase() === 'L' ? 'left' : 'right',
    offsetDistance,
  };
};

const parseChordBearingCurveInput = (
  token: string,
): { chordBearing: string; chordDistance: number; radius: number; side: 'left' | 'right' } | null => {
  const parts = token.split(',').map((part) => part.trim());
  if (parts.length !== 4) return null;
  const chordDistance = Number(parts[1]);
  const radius = Number(parts[2]);
  const sideToken = parts[3]?.toUpperCase();
  if (
    cadParseBearingDegrees(parts[0] ?? '') == null ||
    !Number.isFinite(chordDistance) ||
    chordDistance <= 0 ||
    !Number.isFinite(radius) ||
    radius <= 0 ||
    (sideToken !== 'L' && sideToken !== 'R')
  ) {
    return null;
  }
  return {
    chordBearing: parts[0]!,
    chordDistance,
    radius,
    side: sideToken === 'L' ? 'left' : 'right',
  };
};

const promptForSession = (session: CommandSession | null, fallbackStatus: string): string => {
  if (!session) return fallbackStatus;
  switch (session.key) {
    case 'POINT':
      return session.resultText ?? 'POINT active. Click in model space or enter `x,y` / `LABEL=x,y`, then press Enter.';
    case 'COGO_POINT':
      return session.resultText ??
        (session.startPoint
          ? `COGO_POINT active. Base ${session.startPoint.label} captured. Enter target as \`@azimuth,distance\`, \`N45-00-00E,100\`, or absolute \`x,y\`.`
          : 'COGO_POINT active. Click or enter the base point.');
    case 'LINE':
      return session.resultText ??
        (session.startPoint
          ? `LINE active. Start at ${session.startPoint.label}. Click the end point or enter \`x,y\`, \`@azimuth,distance\`, or \`N45-00-00E,100\`, then press Enter.`
          : 'LINE active. Click or enter the start point.');
    case 'PLINE':
      return session.resultText ??
        (session.points.length > 0
          ? `PLINE active. ${session.points.length} vertex${session.points.length === 1 ? '' : 'es'} captured. Click the next point or press Enter on an empty input to finish once 2+ vertices exist.`
          : 'PLINE active. Click or enter the first vertex.');
    case 'TRAVERSE':
      return session.resultText ??
        (session.points.length > 0
          ? `TRAVERSE ${session.mode} active. ${session.points.length} station${session.points.length === 1 ? '' : 's'} captured. Enter the next leg as \`@azimuth,distance\` or bearing-distance, or click another point.`
          : 'TRAVERSE active. Click or enter the first station.');
    case 'BATCH_COGO':
      return session.resultText ??
        `BATCH_COGO active. Paste deed calls in the batch panel. Use a selected start point or begin with \`START LABEL=x,y\`.`;
    case 'ARC_3PT':
      return session.resultText ??
        (session.points.length === 0
          ? 'ARC_3PT active. Click or enter the start point.'
          : session.points.length === 1
            ? `ARC_3PT active. Start ${session.points[0].label} captured. Enter the through point.`
            : `ARC_3PT active. Start ${session.points[0].label} and through ${session.points[1]?.label} captured. Enter the end point.`);
    case 'ARC_SCE':
      return session.resultText ??
        (session.points.length === 0
          ? 'ARC SCE active. Click or enter the start point.'
          : session.points.length === 1
            ? `ARC SCE active. Start ${session.points[0].label} captured. Enter the center point.`
            : `ARC SCE active. Start ${session.points[0].label} and center ${session.points[1]?.label} captured. Enter the end point.`);
    case 'ARC_CSE':
      return session.resultText ??
        (session.points.length === 0
          ? 'ARC CSE active. Click or enter the center point.'
          : session.points.length === 1
            ? `ARC CSE active. Center ${session.points[0].label} captured. Enter the start point.`
            : `ARC CSE active. Center ${session.points[0].label} and start ${session.points[1]?.label} captured. Enter the end point.`);
    case 'ARC_SCA':
      return session.resultText ??
        (session.points.length < 2
          ? (session.points.length === 0
              ? 'ARC SCA active. Click or enter the start point.'
              : `ARC SCA active. Start ${session.points[0].label} captured. Enter the center point.`)
          : `ARC SCA active. Enter the included angle in degrees.${''}`);
    case 'ARC_CSA':
      return session.resultText ??
        (session.points.length < 2
          ? (session.points.length === 0
              ? 'ARC CSA active. Click or enter the center point.'
              : `ARC CSA active. Center ${session.points[0].label} captured. Enter the start point.`)
          : 'ARC CSA active. Enter the included angle in degrees.');
    case 'ARC_SCL':
      return session.resultText ??
        (session.points.length < 2
          ? (session.points.length === 0
              ? 'ARC SCL active. Click or enter the start point.'
              : `ARC SCL active. Start ${session.points[0].label} captured. Enter the center point.`)
          : 'ARC SCL active. Enter the chord length.');
    case 'ARC_CSL':
      return session.resultText ??
        (session.points.length < 2
          ? (session.points.length === 0
              ? 'ARC CSL active. Click or enter the center point.'
              : `ARC CSL active. Center ${session.points[0].label} captured. Enter the start point.`)
          : 'ARC CSL active. Enter the chord length.');
    case 'ARC_SEA':
      return session.resultText ??
        (session.points.length === 0
          ? 'ARC SEA active. Click or enter the start point.'
          : session.points.length === 1
            ? `ARC SEA active. Start ${session.points[0].label} captured. Enter the end point.`
            : 'ARC SEA active. Enter the included angle in degrees.');
    case 'ARC_SED':
      return session.resultText ??
        (session.points.length === 0
          ? 'ARC SED active. Click or enter the start point.'
          : session.points.length === 1
            ? `ARC SED active. Start ${session.points[0].label} captured. Enter the end point.`
            : 'ARC SED active. Enter the start direction as azimuth or survey bearing.');
    case 'ARC_SER':
      return session.resultText ??
        (session.points.length === 0
          ? 'ARC SER active. Click or enter the start point.'
          : session.points.length === 1
            ? `ARC SER active. Start ${session.points[0].label} captured. Enter the end point.`
            : 'ARC SER active. Enter the radius.');
    case 'CONTINUE_CURVE':
      return session.resultText ??
        `CONTINUE CURVE active. Source arc ${session.sourceArc.id} captured. Enter the next end point.`;
    case 'TANGENT_CURVE':
      return session.resultText ??
        (session.piPoint == null
          ? 'TANGENT_CURVE active. Click or enter the PI point.'
          : session.backTangentPoint == null
            ? `TANGENT_CURVE active. PI ${session.piPoint.label} captured. Enter the back tangent point.`
            : session.aheadTangentPoint == null
              ? `TANGENT_CURVE active. PI ${session.piPoint.label} and back point ${session.backTangentPoint.label} captured. Enter the ahead tangent point.`
              : `TANGENT_CURVE active. Enter the radius for PI ${session.piPoint.label}.`);
    case 'INVERSE':
      return session.resultText ??
        (session.startPoint
          ? `INVERSE active. Start at ${session.startPoint.label}. Click the end point or enter \`x,y\`, \`@azimuth,distance\`, or \`N45-00-00E,100\`, then press Enter.`
          : 'INVERSE active. Click or enter the first point.');
    case 'MULTI_INVERSE':
      return session.resultText ??
        (session.points.length > 0
          ? `MULTI_INVERSE active. ${session.points.length} point${session.points.length === 1 ? '' : 's'} captured. Click the next point or press Enter on an empty input to report the sequence.`
          : 'MULTI_INVERSE active. Click or enter the first point.');
    case 'BEARING_REPORT':
      return session.resultText ??
        (session.startPoint
          ? `BEARING report active. Start at ${session.startPoint.label}. Click the end point or enter \`x,y\`, \`@azimuth,distance\`, or \`N45-00-00E,100\`.`
          : 'BEARING report active. Click or enter the first point.');
    case 'DISTANCE_REPORT':
      return session.resultText ??
        (session.startPoint
          ? `DISTANCE report active. Start at ${session.startPoint.label}. Click the end point or enter \`x,y\`, \`@azimuth,distance\`, or \`N45-00-00E,100\`.`
          : 'DISTANCE report active. Click or enter the first point.');
    case 'TURNED_POINT':
      return session.resultText ??
        (session.occupyPoint == null
          ? 'TURNED_POINT active. Click or enter the occupied point.'
          : session.backsightPoint == null
            ? `TURNED_POINT active. Occupied point ${session.occupyPoint.label} captured. Click or enter the backsight point.`
            : `TURNED_POINT active. Enter \`Langle,distance\` or \`Rangle,distance\` from ${session.occupyPoint.label}.`);
    case 'DEFLECT_POINT':
      return session.resultText ??
        `DEFLECT_POINT active. Selected line ${session.lineStart.label}-${session.lineEnd.label}. Enter \`Langle,distance\` or \`Rangle,distance\`.`;
    case 'POINT_ALONG_LINE':
      return session.resultText ??
        `POINT_ALONG_LINE active. Selected line ${session.lineStart.label}-${session.lineEnd.label}. Enter distance or percent like \`25\` or \`50%\`.`;
    case 'EXTEND_LINE':
      return session.resultText ??
        `EXTEND_LINE active. Selected line ${session.lineStart.label}-${session.lineEnd.label}. Enter extension distance.`;
    case 'OFFSET_POINT':
      return session.resultText ??
        `OFFSET_POINT active. Selected line ${session.lineStart.label}-${session.lineEnd.label}. Enter \`Loffset,along\` or \`Roffset,along\`, with along as distance or percent.`;
    case 'ALIGNMENT_OFFSET_CREATE':
      return session.resultText ??
        `ALIGNMENT_OFFSET_CREATE active. Selected alignment ${session.alignment.name}. Enter \`offset\` or \`NAME=offset\`.`;
    case 'ALIGNMENT_STATION_EQUATION':
      return session.resultText ??
        `ALIGNMENT_STATION_EQUATION active. Selected alignment ${session.alignment.name}. Enter \`backStation,aheadStation\`.`;
    case 'ALIGNMENT_OFFSET_POINT':
      return session.resultText ??
        `ALIGNMENT_OFFSET_POINT active. Selected alignment ${session.alignment.name}. Enter \`station,offset\` or \`LABEL=station,offset\`.`;
    case 'ALIGNMENT_INTERVAL_POINTS':
      return session.resultText ??
        `ALIGNMENT_INTERVAL_POINTS active. Selected alignment ${session.alignment.name}. Enter \`interval\` or \`start,end,interval\`, with optional \`LABEL=\` prefix.`;
    case 'CURVE_SOLVER':
      return session.resultText ?? 'CURVE_SOLVER active. Enter `param1,param2,value1,value2` such as `radius,delta,200,60`.';
    case 'RADIAL_BEARING':
      return session.resultText ?? `RADIAL_BEARING active. Selected arc ${session.arc.id}. Enter \`PC\`, \`PT\`, or \`MID\`.`;
    case 'POINT_ON_CURVE':
      return session.resultText ?? `POINT_ON_CURVE active. Selected arc ${session.arc.id}. Enter \`ARC,distance\` or \`CHORD,distance\`.`;
    case 'SUBDIVIDE_CURVE':
      return session.resultText ?? `SUBDIVIDE_CURVE active. Selected arc ${session.arc.id}. Enter \`EQUAL,count\`, \`ARC,interval\`, or \`CHORD,interval\`.`;
    case 'OFFSET_CURVE':
      return session.resultText ?? `OFFSET_CURVE active. Selected arc ${session.arc.id}. Enter \`Ldistance\` or \`Rdistance\`.`;
    case 'PI_CURVE':
      return session.resultText ??
        (session.piPoint == null
          ? 'PI_CURVE active. Click or enter the PI point.'
          : session.backTangentPoint == null
            ? `PI_CURVE active. PI ${session.piPoint.label} captured. Click or enter the back tangent point.`
            : `PI_CURVE active. Enter \`Lradius,delta\` or \`Rradius,delta\` from PI ${session.piPoint.label}.`);
    case 'CHORD_BEARING_CURVE':
      return session.resultText ??
        (session.startPoint == null
          ? 'CHORD_BEARING_CURVE active. Click or enter the start point.'
          : `CHORD_BEARING_CURVE active. Enter \`bearing,chord,radius,L|R\` from ${session.startPoint.label}.`);
    case 'REVERSE_CURVE':
      return session.resultText ?? `REVERSE_CURVE active. Selected arc ${session.arc.id}. Enter \`Lradius,delta\` or \`Rradius,delta\`.`;
    case 'COMPOUND_CURVE':
      return session.resultText ?? `COMPOUND_CURVE active. Selected arc ${session.arc.id}. Enter \`Lradius,delta\` or \`Rradius,delta\`.`;
    case 'BEARING_BEARING_INTX':
      return session.resultText ??
        (session.firstPoint == null
          ? 'BEARING_BEARING_INTX active. Click or enter the first origin point.'
          : session.secondPoint == null
            ? `BEARING_BEARING_INTX active. First origin ${session.firstPoint.label} captured. Click or enter the second origin point.`
            : `BEARING_BEARING_INTX active. Enter \`bearing1;bearing2\` from ${session.firstPoint.label} and ${session.secondPoint.label}.`);
    case 'BEARING_DISTANCE_INTX':
      return session.resultText ??
        (session.firstPoint == null
          ? 'BEARING_DISTANCE_INTX active. Click or enter the bearing origin point.'
          : session.secondPoint == null
            ? `BEARING_DISTANCE_INTX active. Bearing origin ${session.firstPoint.label} captured. Click or enter the distance center point.`
            : `BEARING_DISTANCE_INTX active. Enter \`bearing;distance\` from ${session.firstPoint.label} against ${session.secondPoint.label}.`);
    case 'DISTANCE_DISTANCE_INTX':
      return session.resultText ??
        (session.firstPoint == null
          ? 'DISTANCE_DISTANCE_INTX active. Click or enter the first center point.'
          : session.secondPoint == null
            ? `DISTANCE_DISTANCE_INTX active. First center ${session.firstPoint.label} captured. Click or enter the second center point.`
            : `DISTANCE_DISTANCE_INTX active. Enter \`distance1,distance2\` from ${session.firstPoint.label} and ${session.secondPoint.label}.`);
    case 'LINE_CIRCLE_INTX':
      return session.resultText ??
        (session.targetPoint == null
          ? `LINE_CIRCLE_INTX active. Selected line ${session.lineStart.label}-${session.lineEnd.label}. Click or enter the circle center point.`
          : `LINE_CIRCLE_INTX active. Enter the radius from center ${session.targetPoint.label}.`);
    case 'PERP_INTX':
      return session.resultText ??
        (session.targetPoint == null
          ? `PERP_INTX active. Selected line ${session.lineStart.label}-${session.lineEnd.label}. Click or enter the external point.`
          : `PERP_INTX active. Press Enter to create the perpendicular foot from ${session.targetPoint.label}.`);
    case 'OFFSET_INTX':
      return session.resultText ??
        `OFFSET_INTX active. Enter \`Loff1,Roff2\` for ${session.firstLineStart.label}-${session.firstLineEnd.label} and ${session.secondLineStart.label}-${session.secondLineEnd.label}.`;
    case 'SKEW_INTX':
      return session.resultText ??
        (session.targetPoint == null
          ? `SKEW_INTX active. Selected line ${session.lineStart.label}-${session.lineEnd.label}. Click or enter the source point.`
          : `SKEW_INTX active. Enter \`Langle\` or \`Rangle\` from ${session.targetPoint.label}.`);
    case 'MOVE':
      return session.resultText ??
        (session.startPoint
          ? `MOVE active. Base point ${session.startPoint.label} captured. Click the target point or enter \`@azimuth,distance\` / bearing-distance, then press Enter.`
          : 'MOVE active. Click or enter the base point for the current selection.');
    case 'COPY':
      return session.resultText ??
        (session.startPoint
          ? `COPY active. Base point ${session.startPoint.label} captured. Click the target point or enter \`@azimuth,distance\` / bearing-distance, then press Enter.`
          : 'COPY active. Click or enter the base point for the current selection.');
    case 'EXTEND':
      return session.resultText ??
        (session.firstTargetEntityId == null
          ? 'EXT active. Click the first line, polyline, or arc to extend.'
          : 'EXT active. Source entity captured. Click the boundary line, polyline, or arc to extend to. Enter or Esc ends the command.');
    case 'TRIM':
      return session.resultText ??
        (session.firstEntityId == null
          ? 'TRIM active. Click the first line, polyline, or arc to use as the cutting edge.'
          : 'TRIM active. First entity captured. Click the target portion to trim against it. Enter or Esc ends the command.');
    case 'FILLET':
      return session.resultText ??
        (session.radius == null
          ? 'FILLET active. Enter the fillet radius, then press Enter.'
          : session.firstEntityId == null
            ? `FILLET active. Radius ${session.radius.toFixed(3)} m set. Click the first line, polyline, or arc near the corner to round.`
            : `FILLET active. Radius ${session.radius.toFixed(3)} m set. First entity captured. Click the second line, polyline, or arc near the same corner, or press Enter/Esc to finish.`);
    case 'PASTE':
      return session.resultText ??
        `PASTE active. Clipboard base ${session.startPoint.label} captured. Click the insertion point or enter \`x,y\`, \`@azimuth,distance\`, or \`N45-00-00E,100\`, then press Enter.`;
  }
};

const helpTextForSession = (session: CommandSession | null): string => {
  if (!session) {
      return 'Interactive commands accept `x,y`, optional `LABEL=x,y`, `@azimuth,distance`, and survey bearing-distance like `N45-00-00E,100`.';
  }
  switch (session.key) {
    case 'POINT':
      return 'POINT input: click in the model space, or type `x,y` / `LABEL=x,y`. Enter commits. Esc cancels.';
    case 'COGO_POINT':
      return session.startPoint
        ? 'COGO_POINT target: `x,y`, `LABEL=x,y`, `@azimuth,distance`, or survey bearing-distance like `N45-00-00E,100` from the base point.'
        : 'COGO_POINT base point: click in the model space or type `x,y` / `LABEL=x,y`.';
    case 'LINE':
      return session.startPoint
        ? 'LINE second point: `x,y`, `LABEL=x,y`, `@azimuth,distance`, or `N45-00-00E,100` from the first point.'
        : 'LINE first point: click in the model space or type `x,y` / `LABEL=x,y`.';
    case 'PLINE':
      return session.points.length > 0
        ? 'PLINE next vertex: click in the model space or type `x,y`, `@azimuth,distance`, or bearing-distance from the last vertex. Press Enter on an empty input to finish after 2+ vertices.'
        : 'PLINE first vertex: click in the model space or type `x,y` / `LABEL=x,y`.';
    case 'TRAVERSE':
      return session.points.length > 0
        ? session.mode === 'point-to-point'
          ? 'TRAVERSE next leg: click the next station, or type `@azimuth,distance` / `N45-00-00E,100` from the last station. Select a survey point as the close target before finishing point-to-point traverse.'
          : 'TRAVERSE next leg: click the next station, or type `@azimuth,distance` / `N45-00-00E,100` from the last station. Press Enter on an empty input to finish after 2+ stations.'
        : 'TRAVERSE first station: click in the model space or type `x,y` / `LABEL=x,y`.';
    case 'BATCH_COGO':
      return 'BATCH_COGO input lives in the batch panel. Supported rows: `START LABEL=x,y`, deed bearing-distance like `N 35°24\'10" E 125.32`, `LABEL=N45-00-00E,100`, `@45,100`, and tangent curves like `CURVE LEFT R 50 DELTA 30`.';
    case 'ARC_3PT':
      return session.points.length < 2
        ? 'ARC 3PT point input: click in the model space or type `x,y` / `LABEL=x,y`. The through point fixes the arc side, so Ctrl flip is not used here.'
        : 'ARC 3PT end point: click in the model space or type `x,y` / `LABEL=x,y` to commit the arc. The through point fixes the arc side, so Ctrl flip is not used here.';
    case 'ARC_SCE':
      return session.points.length < 2
        ? 'ARC Start-Center-End point input: click in the model space or type `x,y` / `LABEL=x,y`. Hold Ctrl to reverse the arc direction.'
        : 'ARC Start-Center-End end point input: click in model space or type `x,y` / `LABEL=x,y`. Hold Ctrl to reverse the arc direction.';
    case 'ARC_CSE':
      return session.points.length < 2
        ? 'ARC Center-Start-End point input: click in the model space or type `x,y` / `LABEL=x,y`. Hold Ctrl to reverse the arc direction.'
        : 'ARC Center-Start-End end point input: click in model space or type `x,y` / `LABEL=x,y`. Hold Ctrl to reverse the arc direction.';
    case 'ARC_SCA':
      return session.points.length < 2
        ? 'ARC Start-Center-Angle point input: click in the model space or type `x,y` / `LABEL=x,y`.'
        : 'ARC Start-Center-Angle value input: enter a positive included angle in degrees. Hold Ctrl to reverse direction.';
    case 'ARC_CSA':
      return session.points.length < 2
        ? 'ARC Center-Start-Angle point input: click in the model space or type `x,y` / `LABEL=x,y`.'
        : 'ARC Center-Start-Angle value input: enter a positive included angle in degrees. Hold Ctrl to reverse direction.';
    case 'ARC_SCL':
      return session.points.length < 2
        ? 'ARC Start-Center-Length point input: click in the model space or type `x,y` / `LABEL=x,y`.'
        : 'ARC Start-Center-Length value input: enter a positive chord length. Hold Ctrl to reverse direction.';
    case 'ARC_CSL':
      return session.points.length < 2
        ? 'ARC Center-Start-Length point input: click in the model space or type `x,y` / `LABEL=x,y`.'
        : 'ARC Center-Start-Length value input: enter a positive chord length. Hold Ctrl to reverse direction.';
    case 'ARC_SEA':
      return session.points.length < 2
        ? 'ARC Start-End-Angle point input: click in the model space or type `x,y` / `LABEL=x,y`.'
        : 'ARC Start-End-Angle value input: enter a positive included angle in degrees. Hold Ctrl to use the opposite bulge.';
    case 'ARC_SED':
      return session.points.length < 2
        ? 'ARC Start-End-Direction point input: click in the model space or type `x,y` / `LABEL=x,y`.'
        : 'ARC Start-End-Direction value input: enter a start tangent azimuth or survey bearing. Hold Ctrl to reverse the turn side.';
    case 'ARC_SER':
      return session.points.length < 2
        ? 'ARC Start-End-Radius point input: click in the model space or type `x,y` / `LABEL=x,y`.'
        : 'ARC Start-End-Radius value input: enter a positive radius. Hold Ctrl to use the opposite bulge.';
    case 'CONTINUE_CURVE':
      return 'Continue Curve input: click in the model space or type `x,y` / `LABEL=x,y`. Hold Ctrl to reverse the continuation side.';
    case 'TANGENT_CURVE':
      return session.aheadTangentPoint
        ? 'Tangent curve radius input: numeric radius only.'
        : 'Tangent curve point input: click in the model space or type `x,y` / `LABEL=x,y`.';
    case 'INVERSE':
      return session.startPoint
        ? 'INVERSE second point: `x,y`, `LABEL=x,y`, `@azimuth,distance`, or bearing-distance from the first point.'
        : 'INVERSE first point: click in the model space or type `x,y` / `LABEL=x,y`.';
    case 'MULTI_INVERSE':
      return session.points.length > 0
        ? 'MULTI_INVERSE next point: click in model space or type `x,y` / relative bearing-distance. Press Enter on an empty input to finish the report.'
        : 'MULTI_INVERSE first point: click in model space or type `x,y` / `LABEL=x,y`.';
    case 'BEARING_REPORT':
      return session.startPoint
        ? 'BEARING report second point: `x,y`, `LABEL=x,y`, `@azimuth,distance`, or bearing-distance from the first point.'
        : 'BEARING report first point: click in the model space or type `x,y` / `LABEL=x,y`.';
    case 'DISTANCE_REPORT':
      return session.startPoint
        ? 'DISTANCE report second point: `x,y`, `LABEL=x,y`, `@azimuth,distance`, or bearing-distance from the first point.'
        : 'DISTANCE report first point: click in the model space or type `x,y` / `LABEL=x,y`.';
    case 'TURNED_POINT':
      return session.backsightPoint
        ? 'TURNED_POINT value input: enter `Langle,distance` or `Rangle,distance`. Angle accepts decimal degrees or `dd-mm-ss`.'
        : 'TURNED_POINT point input: click in model space or type `x,y` / `LABEL=x,y` for occupied and backsight points.';
    case 'DEFLECT_POINT':
      return 'DEFLECT_POINT value input: enter `Langle,distance` or `Rangle,distance`. Angle accepts decimal degrees or `dd-mm-ss`.';
    case 'POINT_ALONG_LINE':
      return 'POINT_ALONG_LINE input: enter distance from start, or percent like `50%`.';
    case 'EXTEND_LINE':
      return 'EXTEND_LINE input: enter extension distance from the selected line end.';
    case 'OFFSET_POINT':
      return 'OFFSET_POINT input: enter `Loffset,along` or `Roffset,along`; along may be distance or percent like `50%`.';
    case 'ALIGNMENT_OFFSET_CREATE':
      return 'ALIGNMENT_OFFSET_CREATE input: enter `offset` or `NAME=offset`. Positive offset follows the current station report sign.';
    case 'ALIGNMENT_STATION_EQUATION':
      return 'ALIGNMENT_STATION_EQUATION input: enter `backStation,aheadStation`; ahead must stay at or above back.';
    case 'ALIGNMENT_OFFSET_POINT':
      return 'ALIGNMENT_OFFSET_POINT input: enter `station,offset` or `LABEL=station,offset`. Positive offset follows the current station report sign.';
    case 'ALIGNMENT_INTERVAL_POINTS':
      return 'ALIGNMENT_INTERVAL_POINTS input: enter `interval` for full alignment coverage or `start,end,interval`; optional `LABEL=` sets a point-label prefix.';
    case 'CURVE_SOLVER':
      return 'CURVE_SOLVER input: enter `param1,param2,value1,value2`, for example `radius,delta,200,60` or `arc,chord,125,120`.';
    case 'RADIAL_BEARING':
      return 'RADIAL_BEARING input: enter `PC`, `PT`, or `MID` for the selected arc.';
    case 'POINT_ON_CURVE':
      return 'POINT_ON_CURVE input: enter `ARC,distance` or `CHORD,distance` from the selected arc start.';
    case 'SUBDIVIDE_CURVE':
      return 'SUBDIVIDE_CURVE input: enter `EQUAL,count`, `ARC,interval`, or `CHORD,interval`.';
    case 'OFFSET_CURVE':
      return 'OFFSET_CURVE input: enter `Ldistance` or `Rdistance` from the selected arc.';
    case 'PI_CURVE':
      return session.backTangentPoint
        ? 'PI_CURVE value input: enter `Lradius,delta` or `Rradius,delta`.'
        : 'PI_CURVE point input: click in model space or type `x,y` / `LABEL=x,y` for PI and back tangent points.';
    case 'CHORD_BEARING_CURVE':
      return session.startPoint
        ? 'CHORD_BEARING_CURVE input: enter `bearing,chord,radius,L|R`.'
        : 'CHORD_BEARING_CURVE point input: click in the model space or type `x,y` / `LABEL=x,y` for the start point.';
    case 'REVERSE_CURVE':
      return 'REVERSE_CURVE input: enter `Lradius,delta` or `Rradius,delta` to continue opposite the selected arc.';
    case 'COMPOUND_CURVE':
      return 'COMPOUND_CURVE input: enter `Lradius,delta` or `Rradius,delta` to continue same-side from the selected arc.';
    case 'BEARING_BEARING_INTX':
      return session.secondPoint
        ? 'BEARING_BEARING_INTX input: enter `bearing1;bearing2`, for example `N45-00-00E;S10-00-00E`.'
        : 'BEARING_BEARING_INTX point input: click in model space or type `x,y` / `LABEL=x,y` for both origin points.';
    case 'BEARING_DISTANCE_INTX':
      return session.secondPoint
        ? 'BEARING_DISTANCE_INTX input: enter `bearing;distance`, for example `N45-00-00E;25.000`.'
        : 'BEARING_DISTANCE_INTX point input: click in model space or type `x,y` / `LABEL=x,y` for the bearing origin and distance center.';
    case 'DISTANCE_DISTANCE_INTX':
      return session.secondPoint
        ? 'DISTANCE_DISTANCE_INTX input: enter `distance1,distance2`.'
        : 'DISTANCE_DISTANCE_INTX point input: click in model space or type `x,y` / `LABEL=x,y` for both circle centers.';
    case 'LINE_CIRCLE_INTX':
      return session.targetPoint
        ? 'LINE_CIRCLE_INTX input: enter the circle radius as a positive number.'
        : 'LINE_CIRCLE_INTX point input: click in model space or type `x,y` / `LABEL=x,y` for the circle center.';
    case 'PERP_INTX':
      return session.targetPoint
        ? 'PERP_INTX creates the perpendicular foot immediately after the external point is captured.'
        : 'PERP_INTX point input: click in model space or type `x,y` / `LABEL=x,y` for the external point.';
    case 'OFFSET_INTX':
      return 'OFFSET_INTX input: enter `Loff1,Roff2` style offsets for the two selected lines.';
    case 'SKEW_INTX':
      return session.targetPoint
        ? 'SKEW_INTX input: enter `Langle` or `Rangle`, for example `R30`.'
        : 'SKEW_INTX point input: click in model space or type `x,y` / `LABEL=x,y` for the source point.';
    case 'MOVE':
      return session.startPoint
        ? 'MOVE target point: `x,y`, `LABEL=x,y`, `@azimuth,distance`, or bearing-distance from the base point.'
        : 'MOVE base point: click in the model space or type `x,y` / `LABEL=x,y`.';
    case 'COPY':
      return session.startPoint
        ? 'COPY target point: `x,y`, `LABEL=x,y`, `@azimuth,distance`, or bearing-distance from the base point.'
        : 'COPY base point: click in the model space or type `x,y` / `LABEL=x,y`.';
    case 'EXTEND':
      return session.firstTargetEntityId == null
        ? 'EXT input: click the line, polyline, or arc you want to extend.'
        : 'EXT boundary pick: click the line, polyline, or arc to extend to. After commit, EXT resets for the next source/boundary pair until Enter, Esc, or empty-space double-click ends it.';
    case 'TRIM':
      return session.firstEntityId == null
        ? 'TRIM input: click the first line, polyline, or arc as the cutting edge.'
        : 'TRIM target pick: click the target portion to remove against the captured cutting edge. After commit, TRIM resets for the next first-entity/second-entity pair until Enter, Esc, or empty-space double-click ends it.';
    case 'FILLET':
      return session.radius == null
        ? 'FILLET input: enter a zero-or-greater radius, then click the first and second line, polyline, or arc near the corner. Radius 0 keeps a hard intersection corner. The same radius stays active until Enter, Esc, or empty-space double-click ends the tool.'
        : 'FILLET picks: click two lines, polylines, or arcs near the corner to round. The current radius stays active for repeated corners until Enter, Esc, or empty-space double-click ends the tool.';
    case 'PASTE':
      return 'PASTE insertion point: click in the model space or type `x,y`, `LABEL=x,y`, `@azimuth,distance`, or bearing-distance from the clipboard base point.';
  }
};

const buildCenterFirstArcDefinition = (
  commandKey: 'ARC_CSE' | 'ARC_CSA' | 'ARC_CSL',
  points: CadNamedPoint[],
  value: number | null,
  reverseDirectionModifier: boolean,
) => {
  if (points.length < 2) return null;
  if (commandKey === 'ARC_CSE') {
    if (points.length < 3) return null;
    return cadBuildArcFromStartCenterEnd(
      points[1]!,
      points[0]!,
      points[2]!,
      reverseDirectionModifier,
    );
  }
  if (value == null) return null;
  return commandKey === 'ARC_CSA'
    ? cadBuildArcFromStartCenterAngle(points[1]!, points[0]!, value, reverseDirectionModifier)
    : cadBuildArcFromStartCenterChord(points[1]!, points[0]!, value, reverseDirectionModifier);
};

const commandPointsMatch = (first: CadNamedPoint, second: CadNamedPoint): boolean =>
  Math.abs(first.x - second.x) <= 1e-9 && Math.abs(first.y - second.y) <= 1e-9;

export const useSurveyCadCommands = ({
  activeSnap,
  previewPoint,
  history,
  selectionCount,
  selectedArcForContinue,
  selectedArcForCurveCogo,
  selectedLineForCoreCogo,
  selectedLinePairForIntersection,
  selectedAlignmentForStationing,
  selectedStartPointForBatchCogo,
  reverseDirectionModifier,
  applyHistoryUpdate,
  onReportComputation,
}: UseSurveyCadCommandsArgs): UseSurveyCadCommandsResult => {
  const projectStationIds = history.present.project.entities
    .filter((entity): entity is Extract<(typeof history.present.project.entities)[number], { type: 'survey-point' }> =>
      entity.type === 'survey-point',
    )
    .map((entity) => entity.stationId);
  const [session, setSession] = useState<CommandSession | null>(null);
  const sessionRef = useRef<CommandSession | null>(session);
  const selectedLineCommandPoints = useMemo(
    () =>
      selectedLineForCoreCogo
        ? {
            start: {
              x: selectedLineForCoreCogo.fromX,
              y: selectedLineForCoreCogo.fromY,
              label: selectedLineForCoreCogo.fromStationId,
            } as CommandPoint,
            end: {
              x: selectedLineForCoreCogo.toX,
              y: selectedLineForCoreCogo.toY,
              label: selectedLineForCoreCogo.toStationId,
            } as CommandPoint,
          }
        : null,
    [selectedLineForCoreCogo],
  );
  const selectedLinePairCommandPoints = useMemo(
    () =>
      selectedLinePairForIntersection
        ? {
            first: {
              start: {
                x: selectedLinePairForIntersection[0].fromX,
                y: selectedLinePairForIntersection[0].fromY,
                label: selectedLinePairForIntersection[0].fromStationId,
              } as CommandPoint,
              end: {
                x: selectedLinePairForIntersection[0].toX,
                y: selectedLinePairForIntersection[0].toY,
                label: selectedLinePairForIntersection[0].toStationId,
              } as CommandPoint,
            },
            second: {
              start: {
                x: selectedLinePairForIntersection[1].fromX,
                y: selectedLinePairForIntersection[1].fromY,
                label: selectedLinePairForIntersection[1].fromStationId,
              } as CommandPoint,
              end: {
                x: selectedLinePairForIntersection[1].toX,
                y: selectedLinePairForIntersection[1].toY,
                label: selectedLinePairForIntersection[1].toStationId,
              } as CommandPoint,
            },
          }
        : null,
    [selectedLinePairForIntersection],
  );

  useEffect(() => {
    sessionRef.current = session;
  }, [session]);

  const replaceSession = (nextSession: CommandSession | null) => {
    sessionRef.current = nextSession;
    setSession(nextSession);
  };

  const updateSession = (
    updater: (_session: CommandSession | null) => CommandSession | null,
  ) => {
    const nextSession = updater(sessionRef.current);
    replaceSession(nextSession);
  };

  const beginSession = (nextSession: CommandSession) => {
    onReportComputation?.(null);
    replaceSession(nextSession);
  };

  const publishReport = (
    toolKey: string,
    title: string,
    summary: string,
    rows: Array<{ label: string; value: string; unit?: string }>,
    alternatives: Array<{ id: string; label: string; point?: { x: number; y: number } }> = [],
  ) => {
    onReportComputation?.(
      buildCadCogoComputation({
        createdEntities: [],
        report: {
          title,
          summary,
          rows,
        },
        warnings: [],
        alternatives,
        provenance: {
          id: `${toolKey}:${Date.now()}:${Math.random().toString(36).slice(2, 8)}`,
          toolKey,
          inputs: {},
          resultSummary: summary,
          createdAtIso: new Date().toISOString(),
        },
      }),
    );
  };

  const buildBatchCogoDraftForInput = (
    inputValue: string,
    startPoint: CommandPoint | null = selectedStartPointForBatchCogo,
  ) =>
    cadDraftBatchCogo({
      sourceText: inputValue,
      selectedStartPoint: startPoint
        ? {
            x: startPoint.x,
            y: startPoint.y,
            label: startPoint.label,
          }
        : null,
    });

  const statusPrompt = useMemo(
    () => promptForSession(session, history.commandState.prompt),
    [history.commandState.prompt, session],
  );
  const helpText = useMemo(() => helpTextForSession(session), [session]);
  const commandExpectsPointPick = useMemo(() => sessionExpectsPointPick(session), [session]);
  const snapConstructionContext = useMemo<CadSnapConstructionContext>(() => {
    if (!session) {
      return { active: false, basePoint: null };
    }
    switch (session.key) {
      case 'POINT':
        return { active: false, basePoint: null };
      case 'COGO_POINT':
      case 'LINE':
      case 'INVERSE':
      case 'BEARING_REPORT':
      case 'DISTANCE_REPORT':
        return session.startPoint
          ? {
              active: true,
              basePoint: { x: session.startPoint.x, y: session.startPoint.y },
              scopeSeedSegmentId: session.startPoint.snapSourceSegmentId ?? null,
              tangentSeedArcEntityId: tangentSeedArcEntityIdFromPoint(session.startPoint),
              tangentSeedPoint: tangentSeedPointFromPoint(session.startPoint),
            }
          : { active: false, basePoint: null };
      case 'MULTI_INVERSE':
        return session.points.length > 0
          ? {
              active: true,
              basePoint: {
                x: session.points[session.points.length - 1]!.x,
                y: session.points[session.points.length - 1]!.y,
              },
            }
          : { active: false, basePoint: null };
      case 'BEARING_BEARING_INTX':
      case 'BEARING_DISTANCE_INTX':
      case 'DISTANCE_DISTANCE_INTX':
        return session.secondPoint
          ? { active: false, basePoint: null }
          : session.firstPoint
            ? {
                active: true,
                basePoint: { x: session.firstPoint.x, y: session.firstPoint.y },
              }
            : { active: false, basePoint: null };
      case 'CHORD_BEARING_CURVE':
        return session.startPoint
          ? {
              active: true,
              basePoint: { x: session.startPoint.x, y: session.startPoint.y },
            }
          : { active: false, basePoint: null };
      case 'TURNED_POINT':
        return session.backsightPoint
          ? { active: false, basePoint: null }
          : session.occupyPoint
            ? {
                active: true,
                basePoint: { x: session.occupyPoint.x, y: session.occupyPoint.y },
              }
            : { active: false, basePoint: null };
      case 'DEFLECT_POINT':
      case 'POINT_ALONG_LINE':
      case 'EXTEND_LINE':
      case 'OFFSET_POINT':
      case 'ALIGNMENT_OFFSET_CREATE':
      case 'ALIGNMENT_STATION_EQUATION':
      case 'ALIGNMENT_OFFSET_POINT':
      case 'ALIGNMENT_INTERVAL_POINTS':
      case 'BATCH_COGO':
      case 'CURVE_SOLVER':
      case 'RADIAL_BEARING':
      case 'POINT_ON_CURVE':
      case 'SUBDIVIDE_CURVE':
      case 'OFFSET_CURVE':
      case 'REVERSE_CURVE':
      case 'COMPOUND_CURVE':
      case 'OFFSET_INTX':
        return { active: false, basePoint: null };
      case 'PI_CURVE':
        return session.backTangentPoint
          ? { active: false, basePoint: null }
          : session.piPoint
            ? {
                active: true,
                basePoint: { x: session.piPoint.x, y: session.piPoint.y },
              }
            : { active: false, basePoint: null };
      case 'LINE_CIRCLE_INTX':
      case 'PERP_INTX':
      case 'SKEW_INTX':
        return session.targetPoint
          ? { active: false, basePoint: null }
          : {
              active: true,
              basePoint: { x: session.lineEnd.x, y: session.lineEnd.y },
            };
      case 'MOVE':
      case 'COPY':
      case 'EXTEND':
      case 'TRIM':
      case 'FILLET':
        return { active: false, basePoint: null };
      case 'PASTE':
        return {
          active: true,
          basePoint: { x: session.startPoint.x, y: session.startPoint.y },
          scopeSeedSegmentId: session.startPoint.snapSourceSegmentId ?? null,
          tangentSeedArcEntityId: tangentSeedArcEntityIdFromPoint(session.startPoint),
          tangentSeedPoint: tangentSeedPointFromPoint(session.startPoint),
        };
      case 'PLINE':
      case 'TRAVERSE':
      case 'ARC_3PT':
        return session.points.length > 0
          ? {
              active: true,
              basePoint: {
                x: session.points[session.points.length - 1]!.x,
                y: session.points[session.points.length - 1]!.y,
              },
              tangentSeedArcEntityId: tangentSeedArcEntityIdFromPoint(
                session.points[session.points.length - 1]!,
              ),
              tangentSeedPoint: tangentSeedPointFromPoint(
                session.points[session.points.length - 1]!,
              ),
            }
          : { active: false, basePoint: null };
      case 'ARC_SCE':
      case 'ARC_CSE':
        return session.points.length < 3 && session.points.length > 0
          ? {
              active: true,
              basePoint: {
                x: session.points[session.points.length - 1]!.x,
                y: session.points[session.points.length - 1]!.y,
              },
              tangentSeedArcEntityId: tangentSeedArcEntityIdFromPoint(
                session.points[session.points.length - 1]!,
              ),
              tangentSeedPoint: tangentSeedPointFromPoint(
                session.points[session.points.length - 1]!,
              ),
            }
          : { active: false, basePoint: null };
      case 'ARC_SCA':
      case 'ARC_CSA':
      case 'ARC_SCL':
      case 'ARC_CSL':
      case 'ARC_SEA':
      case 'ARC_SED':
      case 'ARC_SER':
        return session.points.length < 2 && session.points.length > 0
          ? {
              active: true,
              basePoint: {
                x: session.points[session.points.length - 1]!.x,
                y: session.points[session.points.length - 1]!.y,
              },
            }
          : { active: false, basePoint: null };
      case 'CONTINUE_CURVE': {
        const endPoint = cadArcEndPoint(session.sourceArc);
        return {
          active: true,
          basePoint: endPoint,
          tangentSeedArcEntityId: session.sourceArc.id,
          tangentSeedPoint: endPoint,
        };
      }
      case 'TANGENT_CURVE':
        return session.aheadTangentPoint == null
          ? session.backTangentPoint
            ? { active: true, basePoint: { x: session.backTangentPoint.x, y: session.backTangentPoint.y } }
            : session.piPoint
              ? { active: true, basePoint: { x: session.piPoint.x, y: session.piPoint.y } }
              : { active: false, basePoint: null }
          : { active: false, basePoint: null };
    }
  }, [session]);
  const commandPreview = useMemo<CadCommandPreviewState | null>(() => {
    if (!session) return null;
    switch (session.key) {
      case 'POINT':
        if (!previewPoint) return null;
        return {
          kind: 'point',
          point: { x: previewPoint.x, y: previewPoint.y },
        };
      case 'COGO_POINT':
      case 'LINE':
      case 'INVERSE':
      case 'BEARING_REPORT':
      case 'BEARING_BEARING_INTX':
      case 'BEARING_DISTANCE_INTX':
      case 'CHORD_BEARING_CURVE':
      case 'DISTANCE_DISTANCE_INTX':
      case 'DISTANCE_REPORT':
        if (!previewPoint) return null;
        if ('startPoint' in session && !session.startPoint) {
          return {
            kind: 'point',
            point: { x: previewPoint.x, y: previewPoint.y },
          };
        }
        if ('firstPoint' in session && !session.firstPoint) {
          return {
            kind: 'point',
            point: { x: previewPoint.x, y: previewPoint.y },
          };
        }
        if ('firstPoint' in session && session.firstPoint && !session.secondPoint) {
          return {
            kind: 'line',
            points: [
              { x: session.firstPoint.x, y: session.firstPoint.y },
              { x: previewPoint.x, y: previewPoint.y },
            ],
          };
        }
        return {
          kind: 'line',
          points: [
            { x: ('startPoint' in session ? session.startPoint!.x : session.firstPoint!.x), y: ('startPoint' in session ? session.startPoint!.y : session.firstPoint!.y) },
            { x: previewPoint.x, y: previewPoint.y },
          ],
        };
      case 'MULTI_INVERSE':
        if (!previewPoint) return null;
        if (session.points.length === 0) {
          return {
            kind: 'point',
            point: { x: previewPoint.x, y: previewPoint.y },
          };
        }
        return {
          kind: 'polyline',
          points: [
            ...session.points.map((point) => ({ x: point.x, y: point.y })),
            { x: previewPoint.x, y: previewPoint.y },
          ],
        };
      case 'TURNED_POINT':
        if (!previewPoint) return null;
        if (session.occupyPoint == null) {
          return {
            kind: 'point',
            point: { x: previewPoint.x, y: previewPoint.y },
          };
        }
        if (session.backsightPoint == null) {
          return {
            kind: 'line',
            points: [
              { x: session.occupyPoint.x, y: session.occupyPoint.y },
              { x: previewPoint.x, y: previewPoint.y },
            ],
          };
        }
        return null;
      case 'PI_CURVE':
        if (!previewPoint) return null;
        if (session.piPoint == null) {
          return {
            kind: 'point',
            point: { x: previewPoint.x, y: previewPoint.y },
          };
        }
        if (session.backTangentPoint == null) {
          return {
            kind: 'line',
            points: [
              { x: session.piPoint.x, y: session.piPoint.y },
              { x: previewPoint.x, y: previewPoint.y },
            ],
          };
        }
        return null;
      case 'DEFLECT_POINT':
      case 'POINT_ALONG_LINE':
      case 'EXTEND_LINE':
      case 'OFFSET_POINT':
      case 'CURVE_SOLVER':
      case 'RADIAL_BEARING':
      case 'POINT_ON_CURVE':
      case 'SUBDIVIDE_CURVE':
      case 'OFFSET_CURVE':
      case 'REVERSE_CURVE':
      case 'COMPOUND_CURVE':
      case 'OFFSET_INTX':
        return null;
      case 'ALIGNMENT_OFFSET_CREATE': {
        const parsed = parseAlignmentOffsetCreateInput(session.inputValue);
        const draft = parsed ? cadBuildOffsetAlignmentDraft(session.alignment, parsed.offset) : null;
        if (!draft) return null;
        return {
          kind: 'primitives',
          primitives: draft.elements.map((element, index) =>
            element.kind === 'line'
              ? {
                  kind: 'line' as const,
                  id: `preview:alignment-offset:${index + 1}`,
                  layerId: 'preview',
                  sourceEntityId: `preview:alignment-offset:${index + 1}`,
                  stroke: '#22d3ee',
                  points: [element.start, element.end],
                  strokeWidth: 1.5,
                  opacity: 0.85,
                  strokeDasharray: '8 6',
                }
              : {
                  kind: 'arc' as const,
                  id: `preview:alignment-offset:${index + 1}`,
                  layerId: 'preview',
                  sourceEntityId: `preview:alignment-offset:${index + 1}`,
                  stroke: '#22d3ee',
                  center: element.center,
                  radius: element.radius,
                  startAngleDeg: element.startAngleDeg,
                  endAngleDeg: element.endAngleDeg,
                  strokeWidth: 1.5,
                  opacity: 0.85,
                  strokeDasharray: '8 6',
                },
          ),
        };
      }
      case 'ALIGNMENT_STATION_EQUATION':
        return null;
      case 'ALIGNMENT_INTERVAL_POINTS': {
        const parsed = parseAlignmentIntervalInput(session.inputValue);
        const points = parsed
          ? cadBuildAlignmentStationPoints(session.alignment, {
              startStation: parsed.startStation,
              endStation: parsed.endStation,
              interval: parsed.interval,
              includeStart: true,
              includeEnd: true,
            })
          : [];
        return points.length === 0
          ? null
          : {
              kind: 'primitives',
              primitives: points.map((stationPoint, index) => ({
                kind: 'point' as const,
                id: `preview:alignment-interval:${index + 1}`,
                layerId: 'preview',
                sourceEntityId: `preview:alignment-interval:${index + 1}`,
                stroke: '#22d3ee',
                fill: '#22d3ee',
                point: stationPoint.point,
                radius: 2.4,
                opacity: 0.85,
              })),
            };
      }
      case 'ALIGNMENT_OFFSET_POINT': {
        const parsed = parseAlignmentStationOffsetInput(session.inputValue);
        const point = parsed
          ? cadPointAtAlignmentStationOffset(session.alignment, parsed.station, parsed.offset)
          : null;
        return point
          ? {
              kind: 'point',
              point: {
                x: point.point.x,
                y: point.point.y,
              },
            }
          : null;
      }
      case 'LINE_CIRCLE_INTX':
      case 'PERP_INTX':
      case 'SKEW_INTX':
        if (!previewPoint || session.targetPoint != null) return null;
        return {
          kind: 'line',
          points: [
            { x: session.lineEnd.x, y: session.lineEnd.y },
            { x: previewPoint.x, y: previewPoint.y },
          ],
        };
      case 'PLINE':
      case 'TRAVERSE':
        if (!previewPoint) return null;
        if (session.points.length === 0) {
          return {
            kind: 'point',
            point: { x: previewPoint.x, y: previewPoint.y },
          };
        }
        return {
          kind: 'polyline',
          points: [
            ...session.points.map((point) => ({ x: point.x, y: point.y })),
            { x: previewPoint.x, y: previewPoint.y },
          ],
        };
      case 'ARC_3PT':
        if (!previewPoint) return null;
        if (session.points.length === 0) {
          return {
            kind: 'point',
            point: { x: previewPoint.x, y: previewPoint.y },
          };
        }
        if (session.points.length === 1) {
          return {
            kind: 'line',
            points: [
              { x: session.points[0].x, y: session.points[0].y },
              { x: previewPoint.x, y: previewPoint.y },
            ],
          };
        }
        return (() => {
          const previewArc = cadBuildArcFromThreePoints(session.points[0], session.points[1], previewPoint);
          return previewArc
            ? {
                kind: 'arc' as const,
                center: previewArc.center,
                radius: previewArc.radius,
                startAngleDeg: previewArc.startAngleDeg,
                endAngleDeg: previewArc.endAngleDeg,
              }
            : {
                kind: 'polyline' as const,
                points: [
                  { x: session.points[0].x, y: session.points[0].y },
                  { x: session.points[1].x, y: session.points[1].y },
                  { x: previewPoint.x, y: previewPoint.y },
                ],
              };
        })();
      case 'ARC_SCE':
      case 'ARC_CSE':
        if (!previewPoint) return null;
        if (session.points.length === 0) {
          return { kind: 'point', point: { x: previewPoint.x, y: previewPoint.y } };
        }
        if (session.points.length === 1) {
          return {
            kind: 'line',
            points: [
              { x: session.points[0].x, y: session.points[0].y },
              { x: previewPoint.x, y: previewPoint.y },
            ],
          };
        }
        return (() => {
          const previewArc =
            session.key === 'ARC_SCE'
              ? cadBuildArcFromStartCenterEnd(
                  session.points[0],
                  session.points[1],
                  previewPoint,
                  reverseDirectionModifier,
                )
              : buildCenterFirstArcDefinition(
                  'ARC_CSE',
                  [...session.points, previewPoint as CadNamedPoint],
                  null,
                  reverseDirectionModifier,
                );
          return previewArc
            ? {
                kind: 'arc' as const,
                center: previewArc.center,
                radius: previewArc.radius,
                startAngleDeg: previewArc.startAngleDeg,
                endAngleDeg: previewArc.endAngleDeg,
              }
            : {
                kind: 'polyline' as const,
                points: [
                  { x: session.points[0].x, y: session.points[0].y },
                  { x: session.points[1].x, y: session.points[1].y },
                  { x: previewPoint.x, y: previewPoint.y },
                ],
              };
        })();
      case 'ARC_SCA':
      case 'ARC_CSA':
      case 'ARC_SCL':
      case 'ARC_CSL':
      case 'ARC_SEA':
      case 'ARC_SED':
      case 'ARC_SER': {
        if (session.points.length === 0) {
          if (!previewPoint) return null;
          return { kind: 'point', point: { x: previewPoint.x, y: previewPoint.y } };
        }
        if (session.points.length === 1) {
          if (!previewPoint) return null;
          return {
            kind: 'line',
            points: [
              { x: session.points[0].x, y: session.points[0].y },
              { x: previewPoint.x, y: previewPoint.y },
            ],
          };
        }
        const rawInput = session.inputValue.trim();
        if (rawInput.length === 0) {
          return {
            kind: 'line',
            points: [
              { x: session.points[0].x, y: session.points[0].y },
              { x: session.points[1].x, y: session.points[1].y },
            ],
          };
        }
        const numericValue = Number(rawInput);
        const directionValue =
          cadParseBearingDegrees(rawInput) ?? (Number.isFinite(numericValue) ? numericValue : null);
        const previewArc =
          session.key === 'ARC_SCA'
            ? cadBuildArcFromStartCenterAngle(
                session.points[0],
                session.points[1],
                numericValue,
                reverseDirectionModifier,
              )
            : session.key === 'ARC_CSA'
              ? buildCenterFirstArcDefinition(
                  'ARC_CSA',
                  session.points,
                  numericValue,
                  reverseDirectionModifier,
                )
            : session.key === 'ARC_SCL'
              ? cadBuildArcFromStartCenterChord(
                  session.points[0],
                  session.points[1],
                  numericValue,
                  reverseDirectionModifier,
                )
              : session.key === 'ARC_CSL'
                ? buildCenterFirstArcDefinition(
                    'ARC_CSL',
                    session.points,
                    numericValue,
                    reverseDirectionModifier,
                  )
              : session.key === 'ARC_SEA'
                ? cadBuildArcFromStartEndAngle(
                    session.points[0],
                    session.points[1],
                    numericValue,
                    reverseDirectionModifier,
                  )
                : session.key === 'ARC_SER'
                  ? cadBuildArcFromStartEndRadius(
                      session.points[0],
                      session.points[1],
                      numericValue,
                      reverseDirectionModifier,
                    )
                  : directionValue == null
                    ? null
                    : cadBuildArcFromStartEndDirection(
                        session.points[0],
                        session.points[1],
                        directionValue,
                        reverseDirectionModifier,
                      );
        return previewArc
          ? {
              kind: 'arc' as const,
              center: previewArc.center,
              radius: previewArc.radius,
              startAngleDeg: previewArc.startAngleDeg,
              endAngleDeg: previewArc.endAngleDeg,
            }
          : {
              kind: 'line' as const,
              points: [
                { x: session.points[0].x, y: session.points[0].y },
                { x: session.points[1].x, y: session.points[1].y },
              ],
            };
      }
      case 'CONTINUE_CURVE': {
        if (!previewPoint) return null;
        const previewArc = cadBuildContinuedArc(
          session.sourceArc,
          previewPoint,
          reverseDirectionModifier,
        );
        return previewArc
          ? {
              kind: 'arc',
              center: previewArc.center,
              radius: previewArc.radius,
              startAngleDeg: previewArc.startAngleDeg,
              endAngleDeg: previewArc.endAngleDeg,
            }
          : {
              kind: 'line',
              points: [cadArcEndPoint(session.sourceArc), { x: previewPoint.x, y: previewPoint.y }],
            };
      }
      case 'TANGENT_CURVE':
        if (session.piPoint == null && !previewPoint) return null;
        if (session.piPoint == null) {
          if (!previewPoint) return null;
          return {
            kind: 'point',
            point: { x: previewPoint.x, y: previewPoint.y },
          };
        }
        if (session.backTangentPoint == null) {
          if (!previewPoint) return null;
          return {
            kind: 'line',
            points: [
              { x: session.piPoint.x, y: session.piPoint.y },
              { x: previewPoint.x, y: previewPoint.y },
            ],
          };
        }
        if (session.aheadTangentPoint == null) {
          if (!previewPoint) return null;
          return {
            kind: 'polyline',
            points: [
              { x: session.backTangentPoint.x, y: session.backTangentPoint.y },
              { x: session.piPoint.x, y: session.piPoint.y },
              { x: previewPoint.x, y: previewPoint.y },
            ],
          };
        }
        if (session.inputValue.trim().length > 0) {
          const radius = Number(session.inputValue.trim());
          if (Number.isFinite(radius) && radius > 0) {
            const previewArc = cadBuildTangentCurve(
              session.piPoint,
              session.backTangentPoint,
              session.aheadTangentPoint,
              radius,
            );
            if (previewArc) {
              return {
                kind: 'arc',
                center: previewArc.center,
                radius: previewArc.radius,
                startAngleDeg: previewArc.startAngleDeg,
                endAngleDeg: previewArc.endAngleDeg,
              };
            }
          }
        }
        return {
          kind: 'polyline',
          points: [
            { x: session.backTangentPoint.x, y: session.backTangentPoint.y },
            { x: session.piPoint.x, y: session.piPoint.y },
            { x: session.aheadTangentPoint.x, y: session.aheadTangentPoint.y },
          ],
        };
      case 'MOVE':
      case 'COPY':
      case 'EXTEND':
      case 'TRIM':
      case 'FILLET':
        if (!previewPoint) return null;
        if (session.key === 'TRIM' || session.key === 'FILLET' || session.key === 'EXTEND') {
          return null;
        }
        if (!session.startPoint) {
          return {
            kind: 'point',
            point: { x: previewPoint.x, y: previewPoint.y },
          };
        }
        return {
          kind: 'translate-selection',
          deltaX: previewPoint.x - session.startPoint.x,
          deltaY: previewPoint.y - session.startPoint.y,
        };
      case 'PASTE':
        if (!previewPoint) return null;
        return {
          kind: 'translate-selection',
          deltaX: previewPoint.x - session.startPoint.x,
          deltaY: previewPoint.y - session.startPoint.y,
          sourceEntityIds: session.sourceEntityIds,
        };
      case 'BATCH_COGO':
        return session.draft.previewPrimitives.length > 0
          ? {
              kind: 'primitives',
              primitives: session.draft.previewPrimitives,
            }
          : null;
    }
  }, [previewPoint, reverseDirectionModifier, session]);

const parseInputPoint = (inputValue: string, basePoint: CommandPoint | null): CommandPoint | null =>
    parseRelativeBearingDistance(inputValue, basePoint) ?? parseAbsolutePoint(inputValue);


  const commitArcDefinition = (
    modeLabel: string,
    arcDefinition: {
      center: { x: number; y: number };
      radius: number;
      startAngleDeg: number;
      endAngleDeg: number;
    } | null,
    metadata?: Record<string, unknown>,
  ) => {
    if (!arcDefinition) return false;
    applyHistoryUpdate((existing) =>
      runCadCommand(existing, {
        key: 'ARC_CREATE',
        modeLabel,
        definition: arcDefinition,
        metadata,
      }),
    );
    return true;
  };

  const consumePoint = (
    point: CommandPoint,
    options?: { suppressPointLabel?: boolean },
  ) => {
    const current = sessionRef.current;
    if (!current) return;
    if (current.key === 'POINT') {
      applyHistoryUpdate((existing) =>
        runCadCommand(existing, {
          key: 'POINT',
          x: point.x,
          y: point.y,
          label: options?.suppressPointLabel ? undefined : point.label,
        }),
      );
      replaceSession(null);
      return;
    }
    if (current.key === 'COGO_POINT') {
      if (!current.startPoint) {
        replaceSession({
          ...current,
          startPoint: point,
          inputValue: '',
          resultText: undefined,
        });
        return;
      }
      const directionLabel = current.inputValue.trim() || point.label;
      applyHistoryUpdate((existing) =>
        runCadCommand(existing, {
          key: 'COGO_POINT',
          x: point.x,
          y: point.y,
          basisLabel: current.startPoint!.label,
          directionLabel,
        }),
      );
      replaceSession(null);
      return;
    }
    if (current.key === 'MULTI_INVERSE') {
      replaceSession({
        ...current,
        points: [...current.points, point],
        inputValue: '',
        resultText: undefined,
      });
      return;
    }
    if (current.key === 'BEARING_REPORT' || current.key === 'DISTANCE_REPORT') {
      if (!current.startPoint) {
        replaceSession({
          ...current,
          startPoint: point,
          inputValue: '',
          resultText: undefined,
        });
        return;
      }
      const startPoint = current.startPoint;
      const inverse = buildCadInverseSummary(startPoint, point);
      const distance = buildCadDistanceSummary(startPoint, point);
      if (current.key === 'BEARING_REPORT') {
        publishReport(
          'BEARING_REPORT',
          'Bearing Between Points',
          `Computed bearing from ${startPoint.label} to ${point.label}`,
          [
            { label: 'From', value: startPoint.label },
            { label: 'To', value: point.label },
            { label: 'Bearing', value: inverse.bearing },
            { label: 'Azimuth', value: inverse.azimuthDeg.toFixed(4), unit: 'deg' },
          ],
        );
        replaceSession({
          ...current,
          startPoint: null,
          inputValue: '',
          resultText: `BEARING ${startPoint.label} -> ${point.label}: ${inverse.bearing}, azimuth ${inverse.azimuthDeg.toFixed(4)} deg.`,
        });
        return;
      }
      publishReport(
        'DISTANCE_REPORT',
        'Distance Between Points',
        `Computed distance from ${startPoint.label} to ${point.label}`,
        [
          { label: 'From', value: startPoint.label },
          { label: 'To', value: point.label },
          { label: 'Distance', value: distance.distance2d.toFixed(3), unit: 'm' },
          { label: 'dE', value: distance.deltaX.toFixed(3), unit: 'm' },
          { label: 'dN', value: distance.deltaY.toFixed(3), unit: 'm' },
        ],
      );
      replaceSession({
        ...current,
        startPoint: null,
        inputValue: '',
        resultText: `DISTANCE ${startPoint.label} -> ${point.label}: ${distance.distance2d.toFixed(3)} m.`,
      });
      return;
    }
    if (current.key === 'TURNED_POINT') {
      if (!current.occupyPoint) {
        replaceSession({
          ...current,
          occupyPoint: point,
          inputValue: '',
          resultText: undefined,
        });
        return;
      }
      if (!current.backsightPoint) {
        replaceSession({
          ...current,
          backsightPoint: point,
          inputValue: '',
          resultText: undefined,
        });
      }
      return;
    }
    if (current.key === 'PI_CURVE') {
      if (!current.piPoint) {
        replaceSession({
          ...current,
          piPoint: point,
          inputValue: '',
          resultText: undefined,
        });
        return;
      }
      if (!current.backTangentPoint) {
        replaceSession({
          ...current,
          backTangentPoint: point,
          inputValue: '',
          resultText: undefined,
        });
      }
      return;
    }
    if (current.key === 'CHORD_BEARING_CURVE') {
      if (!current.startPoint) {
        replaceSession({
          ...current,
          startPoint: point,
          inputValue: '',
          resultText: undefined,
        });
      }
      return;
    }
    if (
      current.key === 'BEARING_BEARING_INTX' ||
      current.key === 'BEARING_DISTANCE_INTX' ||
      current.key === 'DISTANCE_DISTANCE_INTX'
    ) {
      if (!current.firstPoint) {
        replaceSession({
          ...current,
          firstPoint: point,
          inputValue: '',
          resultText: undefined,
        });
        return;
      }
      if (!current.secondPoint) {
        replaceSession({
          ...current,
          secondPoint: point,
          inputValue: '',
          resultText: undefined,
        });
      }
      return;
    }
    if (current.key === 'LINE_CIRCLE_INTX' || current.key === 'SKEW_INTX') {
      if (!current.targetPoint) {
        replaceSession({
          ...current,
          targetPoint: point,
          inputValue: '',
          resultText: undefined,
        });
      }
      return;
    }
    if (current.key === 'PERP_INTX') {
      const solution = cadIntersectPerpendicular({
        lineStart: current.lineStart,
        lineEnd: current.lineEnd,
        fromPoint: point,
        lineLabel: `${current.lineStart.label}-${current.lineEnd.label}`,
        pointLabel: point.label,
      });
      if (!solution) {
        replaceSession({
          ...current,
          resultText: 'PERP_INTX could not compute a perpendicular foot from that point.',
        });
        return;
      }
      applyHistoryUpdate((existing) =>
        runCadCommand(existing, {
          key: 'POINT',
          x: solution.point.x,
          y: solution.point.y,
        }),
      );
      publishReport(
        'PERP_INTX',
        'Perpendicular Intersection',
        `Computed perpendicular foot from ${point.label} to ${current.lineStart.label}-${current.lineEnd.label}`,
          [
            { label: 'Point', value: point.label },
            { label: 'Line', value: `${current.lineStart.label}-${current.lineEnd.label}` },
            { label: 'Northing', value: solution.point.y.toFixed(3), unit: 'm' },
            { label: 'Easting', value: solution.point.x.toFixed(3), unit: 'm' },
            {
              label: 'Offset',
              value: buildCadDistanceSummary(point, solution.point).distance2d.toFixed(3),
              unit: 'm',
            },
          ],
        );
      replaceSession(null);
      return;
    }
    if (current.key === 'PLINE' || current.key === 'TRAVERSE') {
      const draftPoint =
        current.key === 'TRAVERSE'
          ? normalizeDraftPoint(point, current.inputPoints, projectStationIds)
          : normalizeDraftPoint(point, current.points, projectStationIds);
      replaceSession(
        current.key === 'TRAVERSE'
          ? {
              ...current,
              points: [...current.inputPoints, draftPoint],
              inputPoints: [...current.inputPoints, draftPoint],
              legInputs:
                current.inputPoints.length === 0
                  ? current.legInputs
                  : [
                      ...current.legInputs,
                      buildTraverseLegInputFromPoints(
                        current.inputPoints[current.inputPoints.length - 1]!,
                        draftPoint,
                      ),
                    ],
              adjustment: null,
              inputValue: '',
              resultText: undefined,
            }
          : {
              ...current,
              points: [...current.points, draftPoint],
              inputValue: '',
              resultText: undefined,
            },
      );
      return;
    }
    if (current.key === 'ARC_3PT') {
      const nextPoints = [...current.points, point];
      if (nextPoints.length < 3) {
        replaceSession({
          ...current,
          points: nextPoints,
          inputValue: '',
          resultText: undefined,
        });
        return;
      }
      applyHistoryUpdate((existing) =>
        runCadCommand(existing, {
          key: 'ARC_3PT',
          start: nextPoints[0]!,
          through: nextPoints[1]!,
          end: nextPoints[2]!,
        }),
      );
      replaceSession(null);
      return;
    }
    if (
      current.key === 'ARC_SCE' ||
      current.key === 'ARC_CSE' ||
      current.key === 'ARC_SCA' ||
      current.key === 'ARC_CSA' ||
      current.key === 'ARC_SCL' ||
      current.key === 'ARC_CSL' ||
      current.key === 'ARC_SEA' ||
      current.key === 'ARC_SED' ||
      current.key === 'ARC_SER'
    ) {
      const nextPoints = [...current.points, point];
      if (
        ((current.key === 'ARC_SCE' || current.key === 'ARC_CSE') && nextPoints.length < 3) ||
        current.key !== 'ARC_SCE' && current.key !== 'ARC_CSE' && nextPoints.length < 2
      ) {
        replaceSession({
          ...current,
          points: nextPoints,
          inputValue: '',
          resultText: undefined,
        });
        return;
      }
      if (current.key === 'ARC_SCE' || current.key === 'ARC_CSE') {
        const committed = commitArcDefinition(
          current.key,
          current.key === 'ARC_SCE'
            ? cadBuildArcFromStartCenterEnd(
                nextPoints[0]!,
                nextPoints[1]!,
                nextPoints[2]!,
                reverseDirectionModifier,
              )
            : buildCenterFirstArcDefinition('ARC_CSE', nextPoints, null, reverseDirectionModifier),
          {
            startLabel: current.key === 'ARC_SCE' ? nextPoints[0]!.label : nextPoints[1]!.label,
            centerLabel: current.key === 'ARC_SCE' ? nextPoints[1]!.label : nextPoints[0]!.label,
            endLabel: nextPoints[2]!.label,
          },
        );
        replaceSession(
          committed
            ? null
            : {
                ...current,
                points: nextPoints,
                resultText: `${current.key === 'ARC_SCE' ? 'ARC SCE' : 'ARC CSE'} invalid. Adjust the points or hold Ctrl to reverse.`,
              },
        );
        return;
      }
      if (current.points.length < 2) {
        replaceSession({
          ...current,
          points: nextPoints,
          inputValue: '',
          resultText: undefined,
        });
        return;
      }
      replaceSession({
        ...current,
        resultText: 'This arc mode now needs a typed value. Enter it in the command bar.',
      });
      return;
    }
    if (current.key === 'CONTINUE_CURVE') {
      const committed = commitArcDefinition(
        'CONTINUE_CURVE',
        cadBuildContinuedArc(current.sourceArc, point, reverseDirectionModifier),
        {
          sourceArcId: current.sourceArc.id,
          endLabel: point.label,
        },
      );
      replaceSession(
        committed
          ? null
          : {
              ...current,
              resultText: 'Continue Curve invalid. Choose a different endpoint or hold Ctrl to reverse.',
            },
      );
      return;
    }
    if (current.key === 'TANGENT_CURVE') {
      if (!current.piPoint) {
        replaceSession({
          ...current,
          piPoint: point,
          inputValue: '',
          resultText: undefined,
        });
        return;
      }
      if (!current.backTangentPoint) {
        replaceSession({
          ...current,
          backTangentPoint: point,
          inputValue: '',
          resultText: undefined,
        });
        return;
      }
      if (!current.aheadTangentPoint) {
        replaceSession({
          ...current,
          aheadTangentPoint: point,
          inputValue: '',
          resultText: undefined,
        });
      }
      return;
    }
    if (current.key === 'LINE') {
      if (!current.startPoint) {
        replaceSession({
          ...current,
          startPoint: point,
          inputValue: '',
          resultText: undefined,
        });
        return;
      }
      const startPoint = current.startPoint;
      applyHistoryUpdate((existing) =>
        runCadCommand(existing, {
          key: 'LINE',
          start: startPoint,
          end: point,
        }),
      );
      replaceSession(null);
      return;
    }
    if (current.key === 'MOVE' || current.key === 'COPY') {
      if (!current.startPoint) {
        replaceSession({
          ...current,
          startPoint: point,
          inputValue: '',
          resultText: undefined,
        });
        return;
      }
      const startPoint = current.startPoint;
      const transformKey: 'MOVE' | 'COPY' = current.key;
      applyHistoryUpdate((existing) =>
        runCadCommand(existing, {
          key: transformKey,
          deltaX: point.x - startPoint.x,
          deltaY: point.y - startPoint.y,
        }),
      );
      replaceSession(null);
      return;
    }
    if (current.key === 'TRIM') {
      const targetEntityId = point.snapSourceEntityId;
      if (!targetEntityId) {
        replaceSession({
          ...current,
          resultText: 'TRIM needs a direct line, polyline, or arc body click. Background points do not trim.',
        });
        return;
      }
      if (current.firstEntityId == null || current.firstPickPoint == null) {
        replaceSession({
          ...current,
          firstEntityId: targetEntityId,
          firstPickPoint: point,
          firstSegmentId: point.snapSourceSegmentId,
          inputValue: '',
          resultText: 'TRIM first entity captured. Click target portion to trim against it.',
        });
        return;
      }
      let committed = false;
      applyHistoryUpdate((existing) => {
        const next = runCadCommand(existing, {
          key: 'TRIM',
          cuttingEntityIds: [current.firstEntityId!],
          targetEntityId,
          pickPoint: { x: point.x, y: point.y },
          targetSegmentId: point.snapSourceSegmentId,
        });
        committed = next !== existing;
        return next;
      });
      replaceSession({
        ...current,
        firstEntityId: null,
        firstPickPoint: null,
        firstSegmentId: undefined,
        inputValue: '',
        resultText: committed
          ? `TRIM committed on ${targetEntityId}. Click the next cutting edge, then the next target, or press Enter/Esc to finish.`
          : current.firstEntityId === targetEntityId &&
              current.firstSegmentId === point.snapSourceSegmentId
            ? 'TRIM ignored the same pick twice. Click a different target entity or segment.'
            : `TRIM found no removable span on ${targetEntityId}. Check cutting-edge selection and click a different side.`,
      });
      return;
    }
    if (current.key === 'EXTEND') {
      const targetEntityId = point.snapSourceEntityId;
      if (!targetEntityId) {
        replaceSession({
          ...current,
          resultText: 'EXT needs a direct line, polyline, or arc body click. Background points do not extend.',
        });
        return;
      }
      if (current.firstTargetEntityId == null) {
        replaceSession({
          ...current,
          firstTargetEntityId: targetEntityId,
          firstTargetPickPoint: point,
          firstTargetSegmentId: point.snapSourceSegmentId,
          inputValue: '',
          resultText: 'EXT source entity captured. Click the boundary to extend to.',
        });
        return;
      }
      let committed = false;
      applyHistoryUpdate((existing) => {
        const next = runCadCommand(existing, {
          key: 'EXTEND',
          boundaryEntityIds: [targetEntityId],
          targetEntityId: current.firstTargetEntityId!,
          targetPickPoint: {
            x: current.firstTargetPickPoint!.x,
            y: current.firstTargetPickPoint!.y,
          },
          targetSegmentId: current.firstTargetSegmentId,
        });
        committed = next !== existing;
        return next;
      });
      replaceSession({
        ...current,
        firstTargetEntityId: null,
        firstTargetPickPoint: null,
        firstTargetSegmentId: undefined,
        inputValue: '',
        resultText: committed
          ? `EXT committed on ${current.firstTargetEntityId ?? targetEntityId}. Click the next entity to extend, or press Enter/Esc to finish.`
          : current.firstTargetEntityId === targetEntityId
            ? 'EXT ignored the same entity twice. Click a different boundary entity.'
            : `EXT found no extend path on ${current.firstTargetEntityId}. Check the picked end and boundary.`,
      });
      return;
    }
    if (current.key === 'FILLET') {
      if (current.radius == null) {
        replaceSession({
          ...current,
          resultText: 'FILLET needs a radius first. Enter a zero-or-greater numeric radius, then press Enter.',
        });
        return;
      }
      const targetEntityId = point.snapSourceEntityId;
      if (!targetEntityId) {
        replaceSession({
          ...current,
          resultText: 'FILLET needs a direct entity click. Background points do not define a fillet corner.',
        });
        return;
      }
      const targetEntity = history.present.project.entities.find(
        (entity): entity is CadLineEntity | CadPolylineEntity | CadArcEntity =>
          (entity.type === 'line' || entity.type === 'polyline' || entity.type === 'arc') &&
          entity.id === targetEntityId,
      );
      if (!targetEntity) {
        replaceSession({
          ...current,
          resultText: 'FILLET currently supports line, polyline, and arc corners only. Click a valid entity near the desired corner.',
        });
        return;
      }
      if (current.firstEntityId == null || current.firstPickPoint == null) {
        replaceSession({
          ...current,
          firstEntityId: targetEntity.id,
          firstPickPoint: point,
          firstSegmentId: point.snapSourceSegmentId,
          inputValue: '',
          resultText: `FILLET first entity captured. Click the second entity for radius ${current.radius.toFixed(3)} m.`,
        });
        return;
      }
      let committed = false;
      applyHistoryUpdate((existing) => {
        const next = runCadCommand(existing, {
          key: 'FILLET',
          radius: current.radius!,
          firstEntityId: current.firstEntityId!,
          firstPickPoint: { x: current.firstPickPoint!.x, y: current.firstPickPoint!.y },
          firstSegmentId: current.firstSegmentId,
          secondEntityId: targetEntity.id,
          secondPickPoint: { x: point.x, y: point.y },
          secondSegmentId: point.snapSourceSegmentId,
        });
        committed = next !== existing;
        return next;
      });
      replaceSession({
        ...current,
        firstEntityId: null,
        firstPickPoint: null,
        firstSegmentId: undefined,
        inputValue: '',
        resultText: committed
          ? `FILLET committed. Radius ${current.radius.toFixed(3)} m still active. Click two more entities, or press Enter/Esc to finish.`
          : current.firstEntityId === targetEntity.id &&
              current.firstSegmentId === point.snapSourceSegmentId
            ? 'FILLET ignored the same pick twice. Click a different second entity or segment near the same corner.'
            : `FILLET failed for ${current.radius.toFixed(3)} m. Check that the clicked entities can form that corner radius.`,
      });
      return;
    }
    if (current.key === 'PASTE') {
      const startPoint = current.startPoint;
      applyHistoryUpdate((existing) =>
        runCadCommand(existing, {
          key: 'PASTE',
          deltaX: point.x - startPoint.x,
          deltaY: point.y - startPoint.y,
          entityIds: current.sourceEntityIds,
        }),
      );
      replaceSession(null);
      return;
    }
    if (!('startPoint' in current)) return;
    if (!current.startPoint) {
      replaceSession({
        ...current,
        startPoint: point,
        inputValue: '',
        resultText: undefined,
      });
      return;
    }
    const inverse = buildCadInverseSummary(current.startPoint, point);
    onReportComputation?.(
      buildCadCogoComputation({
        createdEntities: [],
        report: {
          title: 'Inverse',
          summary: `Computed inverse from ${current.startPoint.label} to ${point.label}`,
          rows: [
            { label: 'From', value: current.startPoint.label },
            { label: 'To', value: point.label },
            { label: 'Distance', value: inverse.distance.toFixed(3), unit: 'm' },
            { label: 'Azimuth', value: inverse.azimuthDeg.toFixed(4), unit: 'deg' },
            { label: 'Bearing', value: formatCadBearing(inverse.azimuthDeg) },
          ],
        },
        warnings: [],
        provenance: {
          id: `inverse:${current.startPoint.label}:${point.label}:${inverse.distance.toFixed(6)}:${inverse.azimuthDeg.toFixed(6)}`,
          toolKey: 'INVERSE',
          inputs: {
            from: current.startPoint,
            to: point,
          },
          resultSummary: `Inverse ${current.startPoint.label} to ${point.label}`,
          createdAtIso: new Date().toISOString(),
        },
      }),
    );
    replaceSession({
      ...current,
      startPoint: null,
      inputValue: '',
      resultText: `INVERSE ${current.startPoint.label} -> ${point.label}: distance ${inverse.distance.toFixed(3)}, azimuth ${inverse.azimuthDeg.toFixed(4)} deg, bearing ${inverse.bearing}.`,
    });
  };

  const finishPolylineSession = () => {
    if (!session || session.key !== 'PLINE' || session.points.length < 2) return;
    applyHistoryUpdate((existing) =>
      runCadCommand(existing, {
        key: 'PLINE',
        vertices: session.points,
      }),
    );
    replaceSession(null);
  };

  const finishTraverseSession = () => {
    if (!session || session.key !== 'TRAVERSE' || session.points.length < 2) return;
    const traverseVertices =
      session.mode === 'closed'
        ? commandPointsMatch(session.points[0]!, session.points[session.points.length - 1]!)
          ? session.points
          : [...session.points, session.points[0]!]
        : session.mode === 'point-to-point' && session.closePoint
          ? commandPointsMatch(session.closePoint, session.points[session.points.length - 1]!)
            ? session.points
            : [...session.points, session.closePoint]
          : session.points;
    applyHistoryUpdate((existing) =>
      runCadCommand(existing, {
        key: 'TRAVERSE',
        vertices: traverseVertices,
        rawVertices: session.inputPoints,
        mode: session.mode,
        closePoint:
          session.mode === 'point-to-point' && session.closePoint
            ? {
                x: session.closePoint.x,
                y: session.closePoint.y,
                label: session.closePoint.label,
              }
            : undefined,
        sideshots: session.sideshots.map((sideshot) => ({
          occupyLabel: sideshot.occupyLabel,
          backsightLabel: sideshot.backsightLabel,
          side: sideshot.side,
          angleDeg: sideshot.angleDeg,
          distance: sideshot.distance,
          point: recalculateTraverseSideshotPoint(session.points, sideshot).point,
        })),
        adjustment:
          session.adjustment == null
            ? undefined
            : {
                method: session.adjustment.method,
                targetLabel: session.adjustment.summary.targetLabel,
                rawClosureDistance: session.adjustment.summary.rawClosureDistanceMeters,
                adjustedClosureDistance: session.adjustment.summary.adjustedClosureDistanceMeters,
                rawClosureBearing: session.adjustment.summary.rawClosureBearing,
                adjustedClosureBearing: session.adjustment.summary.adjustedClosureBearing,
                angularCorrectionPerLegSec: session.adjustment.summary.angularCorrectionPerLegSec,
              },
      }),
    );
    replaceSession(null);
  };

  const filterTraverseSideshotsForPoints = (
    points: CommandPoint[],
    sideshots: TraverseSideshotDraft[],
  ): TraverseSideshotDraft[] =>
    sideshots.filter((shot) =>
      points.some((point, index, sourcePoints) =>
        point.label === shot.occupyLabel && index > 0 && sourcePoints[index - 1]?.label === shot.backsightLabel,
      ),
    );

  const rebuildTraverseDraftFromLegInputs = (
    current: Extract<CommandSession, { key: 'TRAVERSE' }>,
    legInputs: string[],
    resultText?: string,
  ): Extract<CommandSession, { key: 'TRAVERSE' }> | null => {
    const startPoint = current.points[0] ?? null;
    if (!startPoint) return current;
    const nextPoints: CommandPoint[] = [startPoint];
    for (const legInput of legInputs) {
      const parsedPoint = parseInputPoint(legInput, nextPoints[nextPoints.length - 1] ?? null);
      if (!parsedPoint) {
        replaceSession({
          ...current,
          resultText:
            'Traverse row update failed because one of the leg inputs is invalid. Use coordinates or bearing-distance values.',
        });
        return null;
      }
      nextPoints.push(
        normalizeDraftPoint(parsedPoint, nextPoints, projectStationIds, {
          rawInput: legInput,
        }),
      );
    }
    return {
      ...current,
      points: nextPoints,
      inputPoints: nextPoints,
      legInputs,
      sideshots: filterTraverseSideshotsForPoints(nextPoints, current.sideshots),
      adjustment: null,
      inputValue: '',
      resultText,
    };
  };

  const submitSessionInput = () => {
    if (!session) return;
    if (session.key === 'MULTI_INVERSE') {
      if (session.inputValue.trim().length === 0) {
        if (session.points.length < 2) return;
        const multi = buildCadMultiInverseSummary(session.points);
        publishReport(
          'MULTI_INVERSE',
          'Multi-Point Inverse',
          `Computed ${multi.legs.length} inverse leg${multi.legs.length === 1 ? '' : 's'}`,
          [
            ...multi.legs.flatMap((leg, index) => ([
              { label: `Leg ${index + 1}`, value: `${leg.fromLabel} -> ${leg.toLabel}` },
              { label: `Leg ${index + 1} Bearing`, value: leg.bearing },
              { label: `Leg ${index + 1} Distance`, value: leg.distance.toFixed(3), unit: 'm' },
            ])),
            { label: 'Total distance', value: multi.totalDistance.toFixed(3), unit: 'm' },
          ],
        );
        replaceSession({
          ...session,
          points: [],
          resultText: `MULTI_INVERSE reported ${multi.legs.length} legs, total ${multi.totalDistance.toFixed(3)} m.`,
        });
        return;
      }
      const parsedPoint = parseInputPoint(session.inputValue, session.points[session.points.length - 1] ?? null);
      if (!parsedPoint) {
        replaceSession({
          ...session,
          resultText: 'MULTI_INVERSE point input invalid. Use `x,y`, `LABEL=x,y`, `@azimuth,distance`, or survey bearing-distance.',
        });
        return;
      }
      consumePoint(parsedPoint);
      return;
    }
    if (session.key === 'TURNED_POINT') {
      if (session.occupyPoint == null || session.backsightPoint == null) {
        const parsedPoint = parseInputPoint(session.inputValue, session.occupyPoint);
        if (!parsedPoint) {
          replaceSession({
            ...session,
            resultText: 'TURNED_POINT point input invalid. Use `x,y` or `LABEL=x,y`.',
          });
          return;
        }
        consumePoint(parsedPoint);
        return;
      }
      const parsed = parseLeftRightAngleDistance(session.inputValue);
      if (!parsed) {
        replaceSession({
          ...session,
          resultText: 'TURNED_POINT input invalid. Use `Langle,distance` or `Rangle,distance`.',
        });
        return;
      }
      const point = cadComputeTurnedAnglePoint({
        occupyPoint: session.occupyPoint,
        backsightPoint: session.backsightPoint,
        angleDeg: parsed.angleDeg,
        distance: parsed.distance,
        side: parsed.side,
      });
      applyHistoryUpdate((existing) =>
        runCadCommand(existing, {
          key: 'POINT',
          x: point.x,
          y: point.y,
          label: parsed.label,
        }),
      );
      publishReport(
        'TURNED_POINT',
        'Turned Angle + Distance',
        `Created point from ${session.occupyPoint.label} using ${parsed.side} angle`,
        [
          { label: 'Occupy', value: session.occupyPoint.label },
          { label: 'Backsight', value: session.backsightPoint.label },
          { label: 'Turn', value: `${parsed.side} ${parsed.angleDeg.toFixed(4)} deg` },
          { label: 'Distance', value: parsed.distance.toFixed(3), unit: 'm' },
          { label: 'Northing', value: point.y.toFixed(3), unit: 'm' },
          { label: 'Easting', value: point.x.toFixed(3), unit: 'm' },
        ],
      );
      replaceSession(null);
      return;
    }
    if (
      session.key === 'DEFLECT_POINT' ||
      session.key === 'POINT_ALONG_LINE' ||
      session.key === 'EXTEND_LINE' ||
      session.key === 'OFFSET_POINT' ||
      session.key === 'ALIGNMENT_OFFSET_POINT'
    ) {
      if (session.key === 'ALIGNMENT_OFFSET_POINT') {
        const parsed = parseAlignmentStationOffsetInput(session.inputValue);
        const point = parsed
          ? cadPointAtAlignmentStationOffset(session.alignment, parsed.station, parsed.offset)
          : null;
        if (!parsed || !point) {
          replaceSession({
            ...session,
            resultText: 'ALIGNMENT_OFFSET_POINT input invalid. Use `station,offset` or `LABEL=station,offset` within the selected alignment range.',
          });
          return;
        }
        applyHistoryUpdate((existing) =>
          runCadCommand(existing, {
            key: 'ALIGNMENT_OFFSET_POINT',
            alignmentEntityId: session.alignment.id,
            station: parsed.station,
            offset: parsed.offset,
            label: parsed.label,
          }),
        );
        replaceSession(null);
        return;
      }
      if (session.key === 'DEFLECT_POINT') {
        const parsed = parseLeftRightAngleDistance(session.inputValue);
        if (!parsed) {
          replaceSession({
            ...session,
            resultText: 'DEFLECT_POINT input invalid. Use `Langle,distance` or `Rangle,distance`.',
          });
          return;
        }
        const point = cadComputeDeflectionAnglePoint({
          lineStart: session.lineStart,
          lineEnd: session.lineEnd,
          angleDeg: parsed.angleDeg,
          distance: parsed.distance,
          side: parsed.side,
        });
        applyHistoryUpdate((existing) =>
          runCadCommand(existing, {
            key: 'POINT',
            x: point.x,
            y: point.y,
            label: parsed.label,
          }),
        );
        publishReport(
          'DEFLECT_POINT',
          'Deflection Angle + Distance',
          `Created deflection point from ${session.lineStart.label}-${session.lineEnd.label}`,
          [
            { label: 'Line', value: `${session.lineStart.label}-${session.lineEnd.label}` },
            { label: 'Deflection', value: `${parsed.side} ${parsed.angleDeg.toFixed(4)} deg` },
            { label: 'Distance', value: parsed.distance.toFixed(3), unit: 'm' },
            { label: 'Northing', value: point.y.toFixed(3), unit: 'm' },
            { label: 'Easting', value: point.x.toFixed(3), unit: 'm' },
          ],
        );
        replaceSession(null);
        return;
      }
      if (session.key === 'POINT_ALONG_LINE') {
        const parsed = parseDistanceOrPercent(session.inputValue);
        const point =
          parsed?.fraction != null
            ? cadPointAtFractionAlongLine(session.lineStart, session.lineEnd, parsed.fraction)
            : parsed?.distance != null
              ? cadPointAtDistanceAlongLine(session.lineStart, session.lineEnd, parsed.distance)
              : null;
        if (!parsed || !point) {
          replaceSession({
            ...session,
            resultText: 'POINT_ALONG_LINE input invalid. Use distance or percent like `25` or `50%`.',
          });
          return;
        }
        applyHistoryUpdate((existing) =>
          runCadCommand(existing, {
            key: 'POINT',
            x: point.x,
            y: point.y,
            label: parsed.label,
          }),
        );
        publishReport(
          'POINT_ALONG_LINE',
          'Point Along Line',
          `Created point along ${session.lineStart.label}-${session.lineEnd.label}`,
          [
            { label: 'Line', value: `${session.lineStart.label}-${session.lineEnd.label}` },
            parsed.fraction != null
              ? { label: 'Fraction', value: (parsed.fraction * 100).toFixed(3), unit: '%' }
              : { label: 'Distance', value: (parsed.distance ?? 0).toFixed(3), unit: 'm' },
            { label: 'Northing', value: point.y.toFixed(3), unit: 'm' },
            { label: 'Easting', value: point.x.toFixed(3), unit: 'm' },
          ],
        );
        replaceSession(null);
        return;
      }
      if (session.key === 'EXTEND_LINE') {
        const distance = Number(session.inputValue.trim());
        const point = Number.isFinite(distance)
          ? cadExtendLineByDistance(session.lineStart, session.lineEnd, distance)
          : null;
        if (!point) {
          replaceSession({
            ...session,
            resultText: 'EXTEND_LINE input invalid. Enter a positive extension distance.',
          });
          return;
        }
        applyHistoryUpdate((existing) =>
          runCadCommand(existing, {
            key: 'LINE',
            start: session.lineEnd,
            end: {
              ...point,
              label: `${session.lineEnd.label}+${distance.toFixed(3)}`,
            },
          }),
        );
        publishReport(
          'EXTEND_LINE',
          'Extend Line by Distance',
          `Extended ${session.lineStart.label}-${session.lineEnd.label} by ${distance.toFixed(3)} m`,
          [
            { label: 'Line', value: `${session.lineStart.label}-${session.lineEnd.label}` },
            { label: 'Extension', value: distance.toFixed(3), unit: 'm' },
            { label: 'End Northing', value: point.y.toFixed(3), unit: 'm' },
            { label: 'End Easting', value: point.x.toFixed(3), unit: 'm' },
          ],
        );
        replaceSession(null);
        return;
      }
      const parsed = parseOffsetPointInput(session.inputValue);
      const lineLength = buildCadDistanceSummary(session.lineStart, session.lineEnd).distance2d;
      const alongDistance =
        parsed?.alongFraction != null ? parsed.alongFraction * lineLength : parsed?.alongDistance;
      const point =
        parsed && alongDistance != null
          ? cadOffsetPointFromLine({
              lineStart: session.lineStart,
              lineEnd: session.lineEnd,
              alongDistance,
              offsetDistance: parsed.offsetDistance,
              side: parsed.side,
            })
          : null;
      if (!parsed || alongDistance == null || !point) {
        replaceSession({
          ...session,
          resultText: 'OFFSET_POINT input invalid. Use `Loffset,along` or `Roffset,along`.',
        });
        return;
      }
      applyHistoryUpdate((existing) =>
        runCadCommand(existing, {
          key: 'POINT',
          x: point.x,
          y: point.y,
          label: parsed.label,
        }),
      );
      publishReport(
        'OFFSET_POINT',
        'Offset Point',
        `Created offset point from ${session.lineStart.label}-${session.lineEnd.label}`,
        [
          { label: 'Line', value: `${session.lineStart.label}-${session.lineEnd.label}` },
          { label: 'Offset', value: `${parsed.side} ${parsed.offsetDistance.toFixed(3)} m` },
          { label: 'Along', value: alongDistance.toFixed(3), unit: 'm' },
          { label: 'Northing', value: point.y.toFixed(3), unit: 'm' },
          { label: 'Easting', value: point.x.toFixed(3), unit: 'm' },
        ],
      );
      replaceSession(null);
      return;
    }
    if (session.key === 'ALIGNMENT_OFFSET_CREATE') {
      const parsed = parseAlignmentOffsetCreateInput(session.inputValue);
      const draft = parsed ? cadBuildOffsetAlignmentDraft(session.alignment, parsed.offset) : null;
      if (!parsed || !draft) {
        replaceSession({
          ...session,
          resultText: 'ALIGNMENT_OFFSET_CREATE input invalid. Use `offset` or `NAME=offset` for a buildable selected alignment.',
        });
        return;
      }
      applyHistoryUpdate((existing) =>
        runCadCommand(existing, {
          key: 'ALIGNMENT_OFFSET_CREATE',
          alignmentEntityId: session.alignment.id,
          offset: parsed.offset,
          name: parsed.name,
        }),
      );
      replaceSession(null);
      return;
    }
    if (session.key === 'ALIGNMENT_STATION_EQUATION') {
      const parsed = parseAlignmentStationEquationInput(session.inputValue);
      if (!parsed) {
        replaceSession({
          ...session,
          resultText: 'ALIGNMENT_STATION_EQUATION input invalid. Use `backStation,aheadStation`, with ahead at or above back.',
        });
        return;
      }
      applyHistoryUpdate((existing) =>
        runCadCommand(existing, {
          key: 'ALIGNMENT_STATION_EQUATION',
          alignmentEntityId: session.alignment.id,
          backStation: parsed.backStation,
          aheadStation: parsed.aheadStation,
        }),
      );
      replaceSession(null);
      return;
    }
    if (session.key === 'ALIGNMENT_INTERVAL_POINTS') {
      const parsed = parseAlignmentIntervalInput(session.inputValue);
      const points = parsed
        ? cadBuildAlignmentStationPoints(session.alignment, {
            startStation: parsed.startStation,
            endStation: parsed.endStation,
            interval: parsed.interval,
            includeStart: true,
            includeEnd: true,
          })
        : [];
      if (!parsed || points.length === 0) {
        replaceSession({
          ...session,
          resultText: 'ALIGNMENT_INTERVAL_POINTS input invalid. Use `interval` or `start,end,interval` within the selected alignment range.',
        });
        return;
      }
      applyHistoryUpdate((existing) =>
        runCadCommand(existing, {
          key: 'ALIGNMENT_INTERVAL_POINTS',
          alignmentEntityId: session.alignment.id,
          interval: parsed.interval,
          startStation: parsed.startStation,
          endStation: parsed.endStation,
          labelPrefix: parsed.labelPrefix,
        }),
      );
      replaceSession(null);
      return;
    }
    if (session.key === 'CURVE_SOLVER') {
      const parsed = parseCurveSolverInput(session.inputValue);
      const solution = parsed ? cadSolveCurveMetrics(parsed) : null;
      if (!parsed || !solution) {
        replaceSession({
          ...session,
          resultText: 'CURVE_SOLVER input invalid. Use `param1,param2,value1,value2` with a solvable pair.',
        });
        return;
      }
      publishReport(
        'CURVE_SOLVER',
        'Curve Calculator',
        `Solved curve from ${parsed.pair}`,
        [
          { label: 'Pair', value: parsed.pair },
          { label: 'Radius', value: solution.radius.toFixed(3), unit: 'm' },
          { label: 'Delta', value: solution.deltaDeg.toFixed(4), unit: 'deg' },
          { label: 'Arc Length', value: solution.arcLength.toFixed(3), unit: 'm' },
          { label: 'Chord Length', value: solution.chordLength.toFixed(3), unit: 'm' },
          { label: 'Tangent Length', value: solution.tangentLength.toFixed(3), unit: 'm' },
          { label: 'External', value: solution.externalDistance.toFixed(3), unit: 'm' },
          { label: 'Middle Ordinate', value: solution.middleOrdinate.toFixed(3), unit: 'm' },
        ],
      );
      replaceSession({
        ...session,
        inputValue: '',
        resultText: `CURVE_SOLVER solved ${parsed.pair}: R ${solution.radius.toFixed(3)} m, Δ ${solution.deltaDeg.toFixed(4)} deg.`,
      });
      return;
    }
    if (
      session.key === 'RADIAL_BEARING' ||
      session.key === 'POINT_ON_CURVE' ||
      session.key === 'SUBDIVIDE_CURVE' ||
      session.key === 'OFFSET_CURVE' ||
      session.key === 'REVERSE_CURVE' ||
      session.key === 'COMPOUND_CURVE'
    ) {
      if (session.key === 'RADIAL_BEARING') {
        const token = session.inputValue.trim().toUpperCase();
        const angleDeg =
          token === 'PC'
            ? session.arc.startAngleDeg
            : token === 'PT'
              ? session.arc.endAngleDeg
              : token === 'MID'
                ? session.arc.startAngleDeg + cadSignedSweepDeg(session.arc.startAngleDeg, session.arc.endAngleDeg) / 2
                : null;
        if (angleDeg == null) {
          replaceSession({
            ...session,
            resultText: 'RADIAL_BEARING input invalid. Use `PC`, `PT`, or `MID`.',
          });
          return;
        }
        const bearing = cadRadialBearingAtArcAngle({ arc: session.arc, angleDeg });
        publishReport(
          'RADIAL_BEARING',
          'Radial Bearing',
          `Computed radial bearing on ${session.arc.id}`,
          [
            { label: 'Arc', value: session.arc.id },
            { label: 'Location', value: token },
            { label: 'Bearing', value: bearing },
          ],
        );
        replaceSession({
          ...session,
          inputValue: '',
          resultText: `RADIAL_BEARING ${session.arc.id} ${token}: ${bearing}.`,
        });
        return;
      }
      if (session.key === 'POINT_ON_CURVE') {
        const parsed = parseCurveMeasureInput(session.inputValue);
        const point =
          parsed?.mode === 'arc'
            ? cadArcPointByArcDistance(session.arc, parsed.distance)
            : parsed?.mode === 'chord'
              ? cadArcPointByChordDistance(session.arc, parsed.distance)
              : null;
        if (!parsed || !point) {
          replaceSession({
            ...session,
            resultText: 'POINT_ON_CURVE input invalid. Use `ARC,distance` or `CHORD,distance` within the selected arc.',
          });
          return;
        }
        applyHistoryUpdate((existing) =>
          runCadCommand(existing, {
            key: 'POINT',
            x: point.x,
            y: point.y,
          }),
        );
        publishReport(
          'POINT_ON_CURVE',
          'Point On Curve',
          `Created point on ${session.arc.id}`,
          [
            { label: 'Arc', value: session.arc.id },
            { label: 'Mode', value: parsed.mode.toUpperCase() },
            { label: 'Distance', value: parsed.distance.toFixed(3), unit: 'm' },
            { label: 'Northing', value: point.y.toFixed(3), unit: 'm' },
            { label: 'Easting', value: point.x.toFixed(3), unit: 'm' },
          ],
        );
        replaceSession(null);
        return;
      }
      if (session.key === 'SUBDIVIDE_CURVE') {
        const parsed = parseCurveSubdivisionInput(session.inputValue);
        const points = parsed ? cadArcSubdivisionPoints({ arc: session.arc, mode: parsed.mode, value: parsed.value }) : [];
        if (!parsed || points.length === 0) {
          replaceSession({
            ...session,
            resultText: 'SUBDIVIDE_CURVE input invalid. Use `EQUAL,count`, `ARC,interval`, or `CHORD,interval` that yields interior points.',
          });
          return;
        }
        applyHistoryUpdate((existing) =>
          points.reduce(
            (current, point, index) =>
              runCadCommand(current, {
                key: 'POINT',
                x: point.x,
                y: point.y,
                label: `${session.arc.id}-${index + 1}`,
              }),
            existing,
          ),
        );
        publishReport(
          'SUBDIVIDE_CURVE',
          'Curve Subdivision',
          `Created ${points.length} subdivision point${points.length === 1 ? '' : 's'} on ${session.arc.id}`,
          [
            { label: 'Arc', value: session.arc.id },
            { label: 'Mode', value: parsed.mode.toUpperCase() },
            { label: 'Value', value: parsed.value.toFixed(3) },
            { label: 'Points', value: points.length.toString() },
          ],
        );
        replaceSession(null);
        return;
      }
      if (session.key === 'OFFSET_CURVE') {
        const parsed = parseOffsetArcInput(session.inputValue);
        const definition =
          parsed &&
          cadOffsetArc({
            arc: session.arc,
            offsetDistance: parsed.offsetDistance,
            side: parsed.side,
          });
        if (!parsed || !definition) {
          replaceSession({
            ...session,
            resultText: 'OFFSET_CURVE input invalid. Use `Ldistance` or `Rdistance` with a valid remaining radius.',
          });
          return;
        }
        commitArcDefinition('OFFSET_CURVE', {
          center: definition.center,
          radius: definition.radius,
          startAngleDeg: definition.startAngleDeg,
          endAngleDeg: definition.endAngleDeg,
        });
        publishReport(
          'OFFSET_CURVE',
          'Offset Curve',
          `Created offset curve from ${session.arc.id}`,
          [
            { label: 'Arc', value: session.arc.id },
            { label: 'Offset', value: `${parsed.side} ${parsed.offsetDistance.toFixed(3)} m` },
            { label: 'Radius', value: definition.radius.toFixed(3), unit: 'm' },
          ],
        );
        replaceSession(null);
        return;
      }
      const parsed = parseCurveSideRadiusDeltaInput(session.inputValue);
      const definition =
        parsed &&
        (session.key === 'REVERSE_CURVE'
          ? cadBuildReverseCurve({
              sourceArc: session.arc,
              radius: parsed.radius,
              deltaDeg: parsed.deltaDeg,
            })
          : cadBuildCompoundCurve({
              sourceArc: session.arc,
              radius: parsed.radius,
              deltaDeg: parsed.deltaDeg,
            }));
      if (!parsed || !definition) {
        replaceSession({
          ...session,
          resultText: `${session.key} input invalid. Use \`Lradius,delta\` or \`Rradius,delta\` with a valid curve.`,
        });
        return;
      }
      commitArcDefinition(session.key, definition, {
        sourceArcId: session.arc.id,
        side: parsed.side,
        radius: parsed.radius,
        deltaDeg: parsed.deltaDeg,
      });
      publishReport(
        session.key,
        session.key === 'REVERSE_CURVE' ? 'Reverse Curve' : 'Compound Curve',
        `Created ${session.key === 'REVERSE_CURVE' ? 'reverse' : 'compound'} curve from ${session.arc.id}`,
        [
          { label: 'Source Arc', value: session.arc.id },
          { label: 'Radius', value: parsed.radius.toFixed(3), unit: 'm' },
          { label: 'Delta', value: parsed.deltaDeg.toFixed(4), unit: 'deg' },
        ],
      );
      replaceSession(null);
      return;
    }
    if (session.key === 'PI_CURVE') {
      if (session.piPoint == null || session.backTangentPoint == null) {
        const parsedPoint = parseInputPoint(session.inputValue, session.piPoint);
        if (!parsedPoint) {
          replaceSession({
            ...session,
            resultText: 'PI_CURVE point input invalid. Use `x,y` or `LABEL=x,y`.',
          });
          return;
        }
        consumePoint(parsedPoint);
        return;
      }
      const parsed = parseCurveSideRadiusDeltaInput(session.inputValue);
      const definition =
        parsed &&
        cadBuildArcFromPiRadiusDelta({
          piPoint: session.piPoint,
          backTangentPoint: session.backTangentPoint,
          radius: parsed.radius,
          deltaDeg: parsed.deltaDeg,
          side: parsed.side,
        });
      const summary = parsed ? cadBuildCurveMetricsSummaryFromRadiusDelta(parsed.radius, parsed.deltaDeg) : null;
      if (!parsed || !definition || !summary) {
        replaceSession({
          ...session,
          resultText: 'PI_CURVE input invalid. Use `Lradius,delta` or `Rradius,delta` with a valid tangent setup.',
        });
        return;
      }
      commitArcDefinition('PI_CURVE', definition, {
        piLabel: session.piPoint.label,
        backTangentLabel: session.backTangentPoint.label,
        side: parsed.side,
      });
      publishReport(
        'PI_CURVE',
        'PI Radius Delta Curve',
        `Created PI-radius-delta curve from ${session.piPoint.label}`,
        [
          { label: 'PI', value: session.piPoint.label },
          { label: 'Back Tangent', value: session.backTangentPoint.label },
          { label: 'Radius', value: parsed.radius.toFixed(3), unit: 'm' },
          { label: 'Delta', value: parsed.deltaDeg.toFixed(4), unit: 'deg' },
          { label: 'Tangent', value: summary.tangentLength.toFixed(3), unit: 'm' },
        ],
      );
      replaceSession(null);
      return;
    }
    if (session.key === 'CHORD_BEARING_CURVE') {
      if (session.startPoint == null) {
        const parsedPoint = parseInputPoint(session.inputValue, null);
        if (!parsedPoint) {
          replaceSession({
            ...session,
            resultText: 'CHORD_BEARING_CURVE start input invalid. Use `x,y` or `LABEL=x,y`.',
          });
          return;
        }
        consumePoint(parsedPoint);
        return;
      }
      const parsed = parseChordBearingCurveInput(session.inputValue);
      const definition =
        parsed &&
        cadBuildArcFromChordBearingRadius({
          startPoint: session.startPoint,
          chordBearing: parsed.chordBearing,
          chordDistance: parsed.chordDistance,
          radius: parsed.radius,
          side: parsed.side,
        });
      if (!parsed || !definition) {
        replaceSession({
          ...session,
          resultText: 'CHORD_BEARING_CURVE input invalid. Use `bearing,chord,radius,L|R` with a valid radius.',
        });
        return;
      }
      commitArcDefinition('CHORD_BEARING_CURVE', definition, {
        startLabel: session.startPoint.label,
        chordBearing: parsed.chordBearing,
        chordDistance: parsed.chordDistance,
        side: parsed.side,
      });
      publishReport(
        'CHORD_BEARING_CURVE',
        'Chord Bearing Curve',
        `Created curve from ${session.startPoint.label}`,
        [
          { label: 'Start', value: session.startPoint.label },
          { label: 'Chord Bearing', value: parsed.chordBearing },
          { label: 'Chord Length', value: parsed.chordDistance.toFixed(3), unit: 'm' },
          { label: 'Radius', value: parsed.radius.toFixed(3), unit: 'm' },
        ],
      );
      replaceSession(null);
      return;
    }
    if (
      session.key === 'BEARING_BEARING_INTX' ||
      session.key === 'BEARING_DISTANCE_INTX' ||
      session.key === 'DISTANCE_DISTANCE_INTX'
    ) {
      if (session.firstPoint == null || session.secondPoint == null) {
        const parsedPoint = parseInputPoint(session.inputValue, session.firstPoint);
        if (!parsedPoint) {
          replaceSession({
            ...session,
            resultText: `${session.key} point input invalid. Use \`x,y\` or \`LABEL=x,y\`.`,
          });
          return;
        }
        consumePoint(parsedPoint);
        return;
      }

      if (session.key === 'BEARING_BEARING_INTX') {
        const parsed = parseDualBearingInput(session.inputValue);
        const solution =
          parsed &&
          cadIntersectBearings({
            firstPoint: session.firstPoint,
            firstBearing: parsed.firstBearing,
            secondPoint: session.secondPoint,
            secondBearing: parsed.secondBearing,
            firstLabel: session.firstPoint.label,
            secondLabel: session.secondPoint.label,
          });
        if (!parsed || !solution) {
          replaceSession({
            ...session,
            resultText: 'BEARING_BEARING_INTX input invalid. Use `bearing1;bearing2` with non-parallel bearings.',
          });
          return;
        }
        applyHistoryUpdate((existing) =>
          runCadCommand(existing, {
            key: 'POINT',
            x: solution.point.x,
            y: solution.point.y,
          }),
        );
        publishReport(
          'BEARING_BEARING_INTX',
          'Bearing-Bearing Intersection',
          `Computed bearing intersection from ${session.firstPoint.label} and ${session.secondPoint.label}`,
          [
            { label: 'Origin 1', value: session.firstPoint.label },
            { label: 'Bearing 1', value: parsed.firstBearing },
            { label: 'Origin 2', value: session.secondPoint.label },
            { label: 'Bearing 2', value: parsed.secondBearing },
            { label: 'Northing', value: solution.point.y.toFixed(3), unit: 'm' },
            { label: 'Easting', value: solution.point.x.toFixed(3), unit: 'm' },
          ],
        );
        replaceSession(null);
        return;
      }

      if (session.key === 'BEARING_DISTANCE_INTX') {
        const parsed = parseBearingDistanceIntersectionInput(session.inputValue);
        const solutions =
          parsed
            ? cadIntersectBearingDistance({
                bearingPoint: session.firstPoint,
                bearing: parsed.bearing,
                distancePoint: session.secondPoint,
                distance: parsed.distance,
                bearingLabel: session.firstPoint.label,
                distanceLabel: session.secondPoint.label,
              })
            : [];
        const primary = solutions[0];
        if (!parsed || !primary) {
          replaceSession({
            ...session,
            resultText: 'BEARING_DISTANCE_INTX input invalid. Use `bearing;distance` and a solvable radius.',
          });
          return;
        }
        applyHistoryUpdate((existing) =>
          runCadCommand(existing, {
            key: 'POINT',
            x: primary.point.x,
            y: primary.point.y,
          }),
        );
        publishReport(
          'BEARING_DISTANCE_INTX',
          'Bearing-Distance Intersection',
          `Computed bearing-distance intersection from ${session.firstPoint.label} and ${session.secondPoint.label}`,
          [
            { label: 'Bearing origin', value: session.firstPoint.label },
            { label: 'Bearing', value: parsed.bearing },
            { label: 'Distance center', value: session.secondPoint.label },
            { label: 'Radius', value: parsed.distance.toFixed(3), unit: 'm' },
            { label: 'Chosen Northing', value: primary.point.y.toFixed(3), unit: 'm' },
            { label: 'Chosen Easting', value: primary.point.x.toFixed(3), unit: 'm' },
          ],
          solutions.slice(1).map((solution, index) => ({
            id: `bd-alt-${index + 2}`,
            label: `${solution.label}: N ${solution.point.y.toFixed(3)} E ${solution.point.x.toFixed(3)}`,
            point: solution.point,
          })),
        );
        replaceSession(null);
        return;
      }

      const parsed = parseDistancePairInput(session.inputValue);
      const solutions =
        parsed
          ? cadIntersectDistanceDistance({
              firstPoint: session.firstPoint,
              firstDistance: parsed.firstDistance,
              secondPoint: session.secondPoint,
              secondDistance: parsed.secondDistance,
              firstLabel: session.firstPoint.label,
              secondLabel: session.secondPoint.label,
            })
          : [];
      const primary = solutions[0];
      if (!parsed || !primary) {
        replaceSession({
          ...session,
          resultText: 'DISTANCE_DISTANCE_INTX input invalid. Use `distance1,distance2` with intersecting circles.',
        });
        return;
      }
      applyHistoryUpdate((existing) =>
        runCadCommand(existing, {
          key: 'POINT',
          x: primary.point.x,
          y: primary.point.y,
        }),
      );
      publishReport(
        'DISTANCE_DISTANCE_INTX',
        'Distance-Distance Intersection',
        `Computed distance-distance intersection from ${session.firstPoint.label} and ${session.secondPoint.label}`,
        [
          { label: 'Center 1', value: session.firstPoint.label },
          { label: 'Radius 1', value: parsed.firstDistance.toFixed(3), unit: 'm' },
          { label: 'Center 2', value: session.secondPoint.label },
          { label: 'Radius 2', value: parsed.secondDistance.toFixed(3), unit: 'm' },
          { label: 'Chosen Northing', value: primary.point.y.toFixed(3), unit: 'm' },
          { label: 'Chosen Easting', value: primary.point.x.toFixed(3), unit: 'm' },
        ],
        solutions.slice(1).map((solution, index) => ({
          id: `dd-alt-${index + 2}`,
          label: `${solution.label}: N ${solution.point.y.toFixed(3)} E ${solution.point.x.toFixed(3)}`,
          point: solution.point,
        })),
      );
      replaceSession(null);
      return;
    }
    if (
      session.key === 'LINE_CIRCLE_INTX' ||
      session.key === 'OFFSET_INTX' ||
      session.key === 'SKEW_INTX'
    ) {
      if (session.key === 'LINE_CIRCLE_INTX') {
        if (session.targetPoint == null) {
          const parsedPoint = parseInputPoint(session.inputValue, session.lineEnd);
          if (!parsedPoint) {
            replaceSession({
              ...session,
              resultText: 'LINE_CIRCLE_INTX center input invalid. Use `x,y` or `LABEL=x,y`.',
            });
            return;
          }
          consumePoint(parsedPoint);
          return;
        }
        const radius = Number(session.inputValue.trim());
        const solutions = Number.isFinite(radius)
          ? cadIntersectLineCircle({
              lineStart: session.lineStart,
              lineEnd: session.lineEnd,
              center: session.targetPoint,
              radius,
              lineLabel: `${session.lineStart.label}-${session.lineEnd.label}`,
              centerLabel: session.targetPoint.label,
            })
          : [];
        const primary = solutions[0];
        if (!primary) {
          replaceSession({
            ...session,
            resultText: 'LINE_CIRCLE_INTX radius invalid or no intersection found.',
          });
          return;
        }
        applyHistoryUpdate((existing) =>
          runCadCommand(existing, {
            key: 'POINT',
            x: primary.point.x,
            y: primary.point.y,
          }),
        );
        publishReport(
          'LINE_CIRCLE_INTX',
          'Line-Circle Intersection',
          `Computed line-circle intersection on ${session.lineStart.label}-${session.lineEnd.label}`,
          [
            { label: 'Line', value: `${session.lineStart.label}-${session.lineEnd.label}` },
            { label: 'Center', value: session.targetPoint.label },
            { label: 'Radius', value: radius.toFixed(3), unit: 'm' },
            { label: 'Chosen Northing', value: primary.point.y.toFixed(3), unit: 'm' },
            { label: 'Chosen Easting', value: primary.point.x.toFixed(3), unit: 'm' },
          ],
          solutions.slice(1).map((solution, index) => ({
            id: `lc-alt-${index + 2}`,
            label: `${solution.label}: N ${solution.point.y.toFixed(3)} E ${solution.point.x.toFixed(3)}`,
            point: solution.point,
          })),
        );
        replaceSession(null);
        return;
      }
      if (session.key === 'OFFSET_INTX') {
        const parsed = parseDualOffsetInput(session.inputValue);
        const solution =
          parsed &&
          cadIntersectOffsetLines({
            firstLineStart: session.firstLineStart,
            firstLineEnd: session.firstLineEnd,
            firstOffset: parsed.firstOffset,
            secondLineStart: session.secondLineStart,
            secondLineEnd: session.secondLineEnd,
            secondOffset: parsed.secondOffset,
            firstLabel: `${session.firstLineStart.label}-${session.firstLineEnd.label}`,
            secondLabel: `${session.secondLineStart.label}-${session.secondLineEnd.label}`,
          });
        if (!parsed || !solution) {
          replaceSession({
            ...session,
            resultText: 'OFFSET_INTX input invalid. Use `Loff1,Roff2` with non-parallel offset lines.',
          });
          return;
        }
        applyHistoryUpdate((existing) =>
          runCadCommand(existing, {
            key: 'POINT',
            x: solution.point.x,
            y: solution.point.y,
          }),
        );
        publishReport(
          'OFFSET_INTX',
          'Offset Intersection',
          `Computed offset intersection from two selected lines`,
          [
            { label: 'Line 1', value: `${session.firstLineStart.label}-${session.firstLineEnd.label}` },
            { label: 'Offset 1', value: parsed.firstOffset.toFixed(3), unit: 'm' },
            { label: 'Line 2', value: `${session.secondLineStart.label}-${session.secondLineEnd.label}` },
            { label: 'Offset 2', value: parsed.secondOffset.toFixed(3), unit: 'm' },
            { label: 'Northing', value: solution.point.y.toFixed(3), unit: 'm' },
            { label: 'Easting', value: solution.point.x.toFixed(3), unit: 'm' },
          ],
        );
        replaceSession(null);
        return;
      }
      if (session.targetPoint == null) {
        const parsedPoint = parseInputPoint(session.inputValue, session.lineEnd);
        if (!parsedPoint) {
          replaceSession({
            ...session,
            resultText: 'SKEW_INTX point input invalid. Use `x,y` or `LABEL=x,y`.',
          });
          return;
        }
        consumePoint(parsedPoint);
        return;
      }
      const parsed = parseSideDistanceInput(session.inputValue);
      const solution =
        parsed &&
        cadIntersectSkew({
          lineStart: session.lineStart,
          lineEnd: session.lineEnd,
          fromPoint: session.targetPoint,
          angleDeg: parsed.distance,
          side: parsed.side,
          lineLabel: `${session.lineStart.label}-${session.lineEnd.label}`,
          pointLabel: session.targetPoint.label,
        });
      if (!parsed || !solution) {
        replaceSession({
          ...session,
          resultText: 'SKEW_INTX input invalid. Use `Langle` or `Rangle` with a non-parallel skew.',
        });
        return;
      }
      applyHistoryUpdate((existing) =>
        runCadCommand(existing, {
          key: 'POINT',
          x: solution.point.x,
          y: solution.point.y,
        }),
      );
      publishReport(
        'SKEW_INTX',
        'Skew Intersection',
        `Computed skew intersection from ${session.targetPoint.label} onto ${session.lineStart.label}-${session.lineEnd.label}`,
        [
          { label: 'Source point', value: session.targetPoint.label },
          { label: 'Line', value: `${session.lineStart.label}-${session.lineEnd.label}` },
          { label: 'Skew', value: `${parsed.side} ${parsed.distance.toFixed(4)} deg` },
          { label: 'Northing', value: solution.point.y.toFixed(3), unit: 'm' },
          { label: 'Easting', value: solution.point.x.toFixed(3), unit: 'm' },
        ],
      );
      replaceSession(null);
      return;
    }
    if (session.key === 'TRAVERSE') {
      const rawInput = session.inputValue.trim();
      const parsedPoint =
        session.inputPoints.length === 0
          ? parseAbsolutePoint(rawInput)
          : parseInputPoint(rawInput, session.inputPoints[session.inputPoints.length - 1] ?? null);
      if (!parsedPoint) {
        replaceSession({
          ...session,
          resultText:
            session.inputPoints.length === 0
              ? 'Traverse start input invalid. Use `x,y` or `LABEL=x,y`.'
              : 'Traverse leg input invalid. Use `x,y`, `LABEL=x,y`, `@azimuth,distance`, or survey bearing-distance like `N45-00-00E,100`.',
        });
        return;
      }
      const normalizedPoint = normalizeDraftPoint(parsedPoint, session.inputPoints, projectStationIds, {
        rawInput,
      });
      replaceSession({
        ...session,
        points: [...session.inputPoints, normalizedPoint],
        inputPoints: [...session.inputPoints, normalizedPoint],
        legInputs:
          session.inputPoints.length === 0
            ? session.legInputs
            : [...session.legInputs, rawInput],
        adjustment: null,
        inputValue: '',
        resultText: undefined,
      });
      return;
    }
    if (session.key === 'FILLET') {
      const radius = Number(session.inputValue.trim());
      if (!Number.isFinite(radius) || radius < 0) {
        replaceSession({
          ...session,
          resultText: 'FILLET radius invalid. Enter a zero-or-greater numeric radius, then press Enter.',
        });
        return;
      }
      replaceSession({
        ...session,
        radius,
        inputValue: '',
        firstEntityId: null,
        firstPickPoint: null,
        firstSegmentId: undefined,
        resultText: `FILLET radius ${radius.toFixed(3)} m set. Click the first line, polyline, or arc near the corner to round.`,
      });
      return;
    }
    const basePoint =
      session.key === 'PLINE' ||
      session.key === 'ARC_3PT' ||
      session.key === 'ARC_SCE' ||
      session.key === 'ARC_CSE' ||
      session.key === 'ARC_SCA' ||
      session.key === 'ARC_CSA' ||
      session.key === 'ARC_SCL' ||
      session.key === 'ARC_CSL' ||
      session.key === 'ARC_SEA' ||
      session.key === 'ARC_SED' ||
      session.key === 'ARC_SER'
        ? session.points[session.points.length - 1] ?? null
        : session.key === 'CONTINUE_CURVE'
          ? {
              ...cadArcEndPoint(session.sourceArc),
              label: session.sourceArc.id,
            }
        : session.key === 'TANGENT_CURVE'
          ? session.aheadTangentPoint ?? session.backTangentPoint ?? session.piPoint
          : 'startPoint' in session
            ? session.startPoint
            : null;
    if (
      session.key === 'ARC_SCA' ||
      session.key === 'ARC_CSA' ||
      session.key === 'ARC_SCL' ||
      session.key === 'ARC_CSL' ||
      session.key === 'ARC_SEA' ||
      session.key === 'ARC_SED' ||
      session.key === 'ARC_SER'
    ) {
      if (session.points.length < 2) {
        const parsed = parseInputPoint(session.inputValue, basePoint);
        if (!parsed) {
          replaceSession({
            ...session,
            resultText: 'Arc point input invalid. Use `x,y` or `LABEL=x,y` for the required points.',
          });
          return;
        }
        consumePoint(parsed);
        return;
      }
      const rawInput = session.inputValue.trim();
      const numericValue = Number(rawInput);
      const directionValue =
        cadParseBearingDegrees(rawInput) ?? (Number.isFinite(numericValue) ? numericValue : null);
      const arcDefinition =
        session.key === 'ARC_SCA'
          ? cadBuildArcFromStartCenterAngle(
              session.points[0]!,
              session.points[1]!,
              numericValue,
              reverseDirectionModifier,
            )
          : session.key === 'ARC_CSA'
            ? buildCenterFirstArcDefinition(
                'ARC_CSA',
                session.points,
                numericValue,
                reverseDirectionModifier,
              )
          : session.key === 'ARC_SCL'
            ? cadBuildArcFromStartCenterChord(
                session.points[0]!,
                session.points[1]!,
                numericValue,
                reverseDirectionModifier,
              )
            : session.key === 'ARC_CSL'
              ? buildCenterFirstArcDefinition(
                  'ARC_CSL',
                  session.points,
                  numericValue,
                  reverseDirectionModifier,
                )
            : session.key === 'ARC_SEA'
              ? cadBuildArcFromStartEndAngle(
                  session.points[0]!,
                  session.points[1]!,
                  numericValue,
                  reverseDirectionModifier,
                )
              : session.key === 'ARC_SER'
                ? cadBuildArcFromStartEndRadius(
                    session.points[0]!,
                    session.points[1]!,
                    numericValue,
                    reverseDirectionModifier,
                  )
                : directionValue == null
                  ? null
                  : cadBuildArcFromStartEndDirection(
                      session.points[0]!,
                      session.points[1]!,
                      directionValue,
                      reverseDirectionModifier,
                    );
      const committed = commitArcDefinition(session.key, arcDefinition, {
        startLabel:
          session.key === 'ARC_CSA' || session.key === 'ARC_CSL'
            ? session.points[1]!.label
            : session.points[0]!.label,
        secondLabel:
          session.key === 'ARC_CSA' || session.key === 'ARC_CSL'
            ? session.points[0]!.label
            : session.points[1]!.label,
      });
      if (committed) {
        replaceSession(null);
        return;
      }
      replaceSession({
        ...session,
        resultText:
          session.key === 'ARC_SED'
            ? 'Arc direction invalid. Enter a valid azimuth or survey bearing.'
            : 'Arc value invalid. Enter a valid positive value or hold Ctrl to reverse direction.',
      });
      return;
    }
    if (session.key === 'TANGENT_CURVE' && session.aheadTangentPoint) {
      const piPoint = session.piPoint;
      const backTangentPoint = session.backTangentPoint;
      const aheadTangentPoint = session.aheadTangentPoint;
      if (!piPoint || !backTangentPoint || !aheadTangentPoint) {
        replaceSession({
          ...session,
          resultText: 'Tangent curve points incomplete. Capture PI, back, and ahead points first.',
        });
        return;
      }
      const radius = Number(session.inputValue.trim());
      if (!Number.isFinite(radius) || radius <= 0) {
        replaceSession({
          ...session,
          resultText: 'Tangent curve radius invalid. Enter a positive numeric radius.',
        });
        return;
      }
      applyHistoryUpdate((existing) =>
        runCadCommand(existing, {
          key: 'TANGENT_CURVE',
          pi: piPoint,
          backTangentPoint,
          aheadTangentPoint,
          radius,
        }),
      );
      replaceSession(null);
      return;
    }
    const parsed = parseInputPoint(session.inputValue, basePoint);
    if (!parsed) {
      replaceSession({
        ...session,
        resultText:
          session.key === 'POINT'
            ? 'POINT input invalid. Use `x,y` or `LABEL=x,y`.'
            : session.key === 'TANGENT_CURVE' && session.aheadTangentPoint
              ? 'Tangent curve radius invalid. Enter a positive numeric radius.'
              : 'Command input invalid. Use `x,y`, `LABEL=x,y`, `@azimuth,distance`, or survey bearing-distance like `N45-00-00E,100`.',
      });
      return;
    }
    consumePoint(parsed);
  };

  const handleEnterKey = () => {
    if (!session) return;
    if (session.key === 'TRIM' || session.key === 'EXTEND') {
      replaceSession(null);
      return;
    }
    if (session.key === 'FILLET' && session.inputValue.trim().length === 0) {
      replaceSession(null);
      return;
    }
    if (session.key === 'PLINE' && session.inputValue.trim().length === 0 && session.points.length >= 2) {
      finishPolylineSession();
      return;
    }
    if (session.key === 'TRAVERSE' && session.inputValue.trim().length === 0 && session.points.length >= 2) {
      if (session.mode === 'point-to-point' && session.closePoint == null) {
        replaceSession({
          ...session,
          resultText: 'Point-to-point traverse needs a selected close target before finishing.',
        });
        return;
      }
      finishTraverseSession();
      return;
    }
    if (session.key === 'MULTI_INVERSE' && session.inputValue.trim().length === 0 && session.points.length >= 2) {
      submitSessionInput();
      return;
    }
    if (session.inputValue.trim().length === 0) return;
    submitSessionInput();
  };

  const handleEscapeKey = () => {
    replaceSession(null);
  };

  const commitBatchCogoDraft = () => {
    const current = sessionRef.current;
    if (!current || current.key !== 'BATCH_COGO') return;
    if (!current.draft.canCommit) {
      replaceSession({
        ...current,
        resultText:
          current.draft.previewRows.find((row) => row.status === 'error')?.summary ??
          'BATCH_COGO draft is incomplete. Add a start point and at least one valid row.',
      });
      return;
    }
    applyHistoryUpdate((existing) =>
      runCadCommand(existing, {
        key: 'BATCH_COGO',
        draft: current.draft,
      }),
    );
    replaceSession(null);
  };

  const setTraverseDraftMode = (mode: TraverseDraftMode) => {
    const current = sessionRef.current;
    if (!current || current.key !== 'TRAVERSE') return;
    const isExplicitlyClosed =
      current.inputPoints.length >= 2 &&
      commandPointsMatch(current.inputPoints[0]!, current.inputPoints[current.inputPoints.length - 1]!) &&
      current.legInputs.length === current.inputPoints.length - 1;
    const nextInputPoints =
      mode !== 'closed' && isExplicitlyClosed
        ? current.inputPoints.slice(0, -1)
        : current.inputPoints;
    replaceSession({
      ...current,
      points: nextInputPoints,
      inputPoints: nextInputPoints,
      legInputs:
        mode !== 'closed' && isExplicitlyClosed
          ? current.legInputs.slice(0, -1)
          : current.legInputs,
      mode,
      closePoint: mode === 'point-to-point' ? current.closePoint : null,
      adjustment: null,
      inputValue: '',
      resultText: undefined,
    });
  };

  const setTraverseDraftClosePoint = (point: CommandPoint | null) => {
    const current = sessionRef.current;
    if (!current || current.key !== 'TRAVERSE') return;
    replaceSession({
      ...current,
      closePoint: point,
      adjustment: null,
      resultText:
        point == null
          ? 'Cleared traverse close target.'
          : `Traverse will close onto ${point.label}.`,
    });
  };

  const addTraverseDraftSideshot = (occupyPointIndex: number, inputValue: string) => {
    const current = sessionRef.current;
    if (!current || current.key !== 'TRAVERSE') return false;
    const occupyPoint = current.points[occupyPointIndex];
    const backsightPoint = current.points[occupyPointIndex - 1];
    if (!occupyPoint || !backsightPoint) return false;
    const parsed = parseLeftRightAngleDistance(inputValue);
    if (!parsed) {
      replaceSession({
        ...current,
        resultText: 'Sideshot input invalid. Use `Langle,distance` or `Rangle,distance`.',
      });
      return false;
    }
    const point = cadComputeTurnedAnglePoint({
      occupyPoint,
      backsightPoint,
      angleDeg: parsed.angleDeg,
      distance: parsed.distance,
      side: parsed.side,
    });
    replaceSession({
      ...current,
      sideshots: [
        ...current.sideshots,
        {
          occupyLabel: occupyPoint.label,
          backsightLabel: backsightPoint.label,
          side: parsed.side,
          angleDeg: parsed.angleDeg,
          distance: parsed.distance,
          inputValue,
          point: {
            label:
              parsed.label ??
              `${occupyPoint.label}-SS${(current.sideshots.filter((shot) => shot.occupyLabel === occupyPoint.label).length + 1).toString()}`,
            x: point.x,
            y: point.y,
          },
        },
      ],
      adjustment: current.adjustment
        ? {
            ...current.adjustment,
            summary: {
              ...current.adjustment.summary,
              adjustedPoints: current.adjustment.summary.adjustedPoints,
            },
          }
        : null,
      resultText: `Added sideshot from ${occupyPoint.label} with backsight ${backsightPoint.label}.`,
    });
    return true;
  };

  const removeTraverseDraftSideshot = (sideshotIndex: number) => {
    const current = sessionRef.current;
    if (!current || current.key !== 'TRAVERSE') return;
    replaceSession({
      ...current,
      sideshots: current.sideshots.filter((_, index) => index !== sideshotIndex),
      resultText: undefined,
    });
  };

  const rewindTraverseDraftToPointCount = (pointCount: number) => {
    const current = sessionRef.current;
    if (!current || current.key !== 'TRAVERSE') return;
    const nextCount = Math.max(0, Math.min(pointCount, current.inputPoints.length));
    const nextPoints = current.inputPoints.slice(0, nextCount);
    replaceSession({
      ...current,
      points: nextPoints,
      inputPoints: nextPoints,
      legInputs: current.legInputs.slice(0, Math.max(0, nextCount - 1)),
      sideshots: filterTraverseSideshotsForPoints(nextPoints, current.sideshots),
      adjustment: null,
      inputValue: '',
      resultText: undefined,
    });
  };

  const editTraverseDraftLeg = (legIndex: number) => {
    const current = sessionRef.current;
    if (!current || current.key !== 'TRAVERSE') return;
    const fromPoint = current.points[legIndex];
    const toPoint = current.points[legIndex + 1];
    if (!fromPoint || !toPoint) return;
    const inverse = buildCadInverseSummary(fromPoint, toPoint);
    replaceSession({
      ...current,
      points: current.inputPoints.slice(0, legIndex + 1),
      inputPoints: current.inputPoints.slice(0, legIndex + 1),
      legInputs: current.legInputs.slice(0, legIndex),
      inputValue: current.legInputs[legIndex] ?? `${inverse.bearing},${inverse.distance.toFixed(3)}`,
      adjustment: null,
      resultText: `Editing leg ${fromPoint.label} -> ${toPoint.label}. Update the command value and press Enter to replace downstream traverse geometry.`,
    });
  };

  const replaceTraverseDraftLeg = (legIndex: number, inputValue: string) => {
    const current = sessionRef.current;
    if (!current || current.key !== 'TRAVERSE') return false;
    const nextLegInputs = current.legInputs.map((legInput, index) =>
      index === legIndex ? inputValue : legInput,
    );
    const rebuilt = rebuildTraverseDraftFromLegInputs(
      current,
      nextLegInputs,
      `Replaced leg ${legIndex + 1}. Continue editing rows or press Enter on blank input to finish.`,
    );
    if (!rebuilt) {
      replaceSession({
        ...current,
        resultText:
          'Traverse leg input invalid. Use `x,y`, `LABEL=x,y`, `@azimuth,distance`, or survey bearing-distance like `N45-00-00E,100`.',
      });
      return false;
    }
    replaceSession(rebuilt);
    return true;
  };

  const appendTraverseDraftPoint = (inputValue: string) => {
    const current = sessionRef.current;
    if (!current || current.key !== 'TRAVERSE') return false;
    const parsedPoint =
      current.points.length === 0
        ? parseAbsolutePoint(inputValue)
        : parseInputPoint(inputValue, current.points[current.points.length - 1] ?? null);
    if (!parsedPoint) {
      replaceSession({
        ...current,
        resultText:
          current.points.length === 0
            ? 'Traverse start input invalid. Use `x,y` or `LABEL=x,y`.'
            : 'Traverse leg input invalid. Use `x,y`, `LABEL=x,y`, `@azimuth,distance`, or survey bearing-distance like `N45-00-00E,100`.',
      });
      return false;
    }
      const normalizedPoint = normalizeDraftPoint(parsedPoint, current.inputPoints, projectStationIds, {
        rawInput: inputValue,
      });
    replaceSession({
      ...current,
      points: [...current.inputPoints, normalizedPoint],
      inputPoints: [...current.inputPoints, normalizedPoint],
      legInputs:
        current.inputPoints.length === 0
          ? current.legInputs
          : [...current.legInputs, inputValue],
      adjustment: null,
      inputValue: '',
      resultText: undefined,
    });
    return true;
  };

  const insertTraverseDraftLeg = (legIndex: number, inputValue: string) => {
    const current = sessionRef.current;
    if (!current || current.key !== 'TRAVERSE' || current.points.length === 0) return false;
    const nextLegInputs = [...current.legInputs];
    nextLegInputs.splice(legIndex, 0, inputValue);
    const rebuilt = rebuildTraverseDraftFromLegInputs(
      current,
      nextLegInputs,
      `Inserted leg ${legIndex + 1}. Downstream traverse rows were rebuilt from the updated sequence.`,
    );
    if (!rebuilt) {
      replaceSession({
        ...current,
        resultText:
          'Traverse leg input invalid. Use `x,y`, `LABEL=x,y`, `@azimuth,distance`, or survey bearing-distance like `N45-00-00E,100`.',
      });
      return false;
    }
    replaceSession(rebuilt);
    return true;
  };

  const moveTraverseDraftLeg = (legIndex: number, direction: -1 | 1) => {
    const current = sessionRef.current;
    if (!current || current.key !== 'TRAVERSE') return false;
    const swapIndex = legIndex + direction;
    if (legIndex < 0 || legIndex >= current.legInputs.length || swapIndex < 0 || swapIndex >= current.legInputs.length) {
      return false;
    }
    const nextLegInputs = [...current.legInputs];
    const [moved] = nextLegInputs.splice(legIndex, 1);
    nextLegInputs.splice(swapIndex, 0, moved!);
    const rebuilt = rebuildTraverseDraftFromLegInputs(
      current,
      nextLegInputs,
      `Moved leg ${legIndex + 1} ${direction < 0 ? 'up' : 'down'} and rebuilt downstream traverse geometry.`,
    );
    if (!rebuilt) return false;
    replaceSession(rebuilt);
    return true;
  };

  const applyTraverseDraftAdjustment = (method: CadTraverseAdjustmentMethod) => {
    const current = sessionRef.current;
    if (!current || current.key !== 'TRAVERSE') return false;
    const targetPoint = buildTraverseClosureTarget(current.mode, current.inputPoints, current.closePoint);
    if (!targetPoint || current.inputPoints.length < 2) {
      replaceSession({
        ...current,
        resultText: 'Traverse adjustment needs at least two stations and a closure target.',
      });
      return false;
    }
    const summary = cadAdjustTraverse({
      points: current.inputPoints,
      targetPoint,
      method,
    });
    if (!summary) {
      replaceSession({
        ...current,
        resultText: 'Traverse adjustment could not be computed from the current draft.',
      });
      return false;
    }
    const adjustedPoints = summary.adjustedPoints.map((point, index) => ({
      ...point,
      snapSourceEntityId: current.inputPoints[index]?.snapSourceEntityId,
      snapSourceSegmentId: current.inputPoints[index]?.snapSourceSegmentId,
      snapKind: current.inputPoints[index]?.snapKind,
    }));
    replaceSession({
      ...current,
      points: adjustedPoints,
      adjustment: {
        method,
        summary,
      },
      resultText:
        method === 'angular'
          ? `Applied angular balance. Remaining closure ${summary.adjustedClosureDistanceMeters.toFixed(3)} m.`
          : `Applied ${method === 'bowditch' ? 'Bowditch' : 'transit'} adjustment. Closure ${summary.adjustedClosureDistanceMeters.toFixed(3)} m.`,
    });
    return true;
  };

  const clearTraverseDraftAdjustment = () => {
    const current = sessionRef.current;
    if (!current || current.key !== 'TRAVERSE' || current.adjustment == null) return;
    replaceSession({
      ...current,
      points: current.inputPoints,
      adjustment: null,
      resultText: 'Cleared traverse adjustment and restored entered geometry.',
    });
  };

  const closeTraverseDraftLoop = () => {
    const current = sessionRef.current;
    if (!current || current.key !== 'TRAVERSE' || current.inputPoints.length < 3) return;
    const firstPoint = current.inputPoints[0]!;
    const lastPoint = current.inputPoints[current.inputPoints.length - 1]!;
    if (commandPointsMatch(firstPoint, lastPoint)) {
      return;
    }
    const nextInputPoints = [...current.inputPoints, firstPoint];
    replaceSession({
      ...current,
      mode: 'closed',
      points: nextInputPoints,
      inputPoints: nextInputPoints,
      legInputs: [...current.legInputs, buildTraverseLegInputFromPoints(lastPoint, firstPoint)],
      adjustment: null,
      inputValue: '',
      resultText: undefined,
    });
  };

  const activeTraverseDraft = useMemo(() => {
    if (session?.key !== 'TRAVERSE') return null;
    const points = session.points.map((point) => ({
      label: point.label,
      x: point.x,
      y: point.y,
    }));
    const legs = session.points.slice(1).map((point, index) => {
      const fromPoint = session.points[index]!;
      const inverse = buildCadInverseSummary(fromPoint, point);
      return {
        fromLabel: fromPoint.label,
        toLabel: point.label,
        bearing: inverse.bearing,
        distance: inverse.distance,
        inputValue: session.legInputs[index] ?? `${inverse.bearing},${inverse.distance.toFixed(3)}`,
      };
    });
    const totalLength = legs.reduce((sum, leg) => sum + leg.distance, 0);
    const closureTarget = buildTraverseClosureTarget(session.mode, session.inputPoints, session.closePoint);
    if (session.points.length < 2) {
      return {
        points,
        mode: session.mode,
        closePoint: session.closePoint
          ? { label: session.closePoint.label, x: session.closePoint.x, y: session.closePoint.y }
          : null,
        legs,
        sideshots: session.sideshots.map((sideshot) => recalculateTraverseSideshotPoint(session.points, sideshot)),
        totalLength,
        closureTargetLabel: closureTarget?.label ?? null,
        closureDeltaX: null,
        closureDeltaY: null,
        closureDistance: null,
        closureBearing: null,
        closureRatio: null,
        adjustment:
          session.adjustment == null
            ? null
            : {
                method: session.adjustment.method,
                targetLabel: session.adjustment.summary.targetLabel,
                rawClosureDistance: session.adjustment.summary.rawClosureDistanceMeters,
                adjustedClosureDistance: session.adjustment.summary.adjustedClosureDistanceMeters,
                rawClosureBearing: session.adjustment.summary.rawClosureBearing,
                adjustedClosureBearing: session.adjustment.summary.adjustedClosureBearing,
                angularCorrectionPerLegSec: session.adjustment.summary.angularCorrectionPerLegSec,
              },
      };
    }
    const closureTargetPoint = closureTarget;
    const lastPoint = session.points[session.points.length - 1]!;
    const closureDistance =
      closureTargetPoint == null ? null : buildCadDistanceSummary(lastPoint, closureTargetPoint).distance2d;
    const closureDelta =
      closureTargetPoint == null ? null : buildCadDistanceSummary(lastPoint, closureTargetPoint);
    const closureBearing =
      closureTargetPoint && closureDistance != null && closureDistance > 1e-9
        ? buildCadInverseSummary(
            lastPoint,
            closureTargetPoint,
          ).bearing
        : null;
    return {
      points,
      mode: session.mode,
      closePoint: session.closePoint
        ? { label: session.closePoint.label, x: session.closePoint.x, y: session.closePoint.y }
        : null,
      legs,
      sideshots: session.sideshots.map((sideshot) => recalculateTraverseSideshotPoint(session.points, sideshot)),
      totalLength,
      closureTargetLabel: closureTargetPoint?.label ?? null,
      closureDeltaX: closureDelta?.deltaX ?? null,
      closureDeltaY: closureDelta?.deltaY ?? null,
      closureDistance,
      closureBearing,
      closureRatio:
        closureDistance != null && closureDistance > 1e-9 && totalLength > 0
          ? totalLength / closureDistance
          : null,
      adjustment:
        session.adjustment == null
          ? null
          : {
              method: session.adjustment.method,
              targetLabel: session.adjustment.summary.targetLabel,
              rawClosureDistance: session.adjustment.summary.rawClosureDistanceMeters,
              adjustedClosureDistance: session.adjustment.summary.adjustedClosureDistanceMeters,
              rawClosureBearing: session.adjustment.summary.rawClosureBearing,
              adjustedClosureBearing: session.adjustment.summary.adjustedClosureBearing,
              angularCorrectionPerLegSec: session.adjustment.summary.angularCorrectionPerLegSec,
            },
    };
  }, [session]);

  const activeBatchCogoDraft = useMemo(() => {
    if (!session || session.key !== 'BATCH_COGO') return null;
    return {
      inputValue: session.inputValue,
      startPoint: session.draft.startPoint,
      startPointSource: session.draft.startPointSource,
      endPoint: session.draft.endPoint,
      previewRows: session.draft.previewRows,
      warnings: session.draft.warnings,
      generatedPointCount: session.draft.generatedPointCount,
      generatedLineCount: session.draft.generatedLineCount,
      generatedArcCount: session.draft.generatedArcCount,
      canCommit: session.draft.canCommit,
    };
  }, [session]);

  return {
    activeCommandKey: session?.key ?? null,
    commandInputValue: session?.inputValue ?? '',
    commandPrompt: statusPrompt,
    commandHelpText: helpText,
    commandPreview,
    activeTrimCuttingEntityIds:
      session?.key === 'TRIM' && session.firstEntityId != null ? [session.firstEntityId] : [],
    activeExtendTarget:
      session?.key === 'EXTEND' &&
      session.firstTargetEntityId != null &&
      session.firstTargetPickPoint != null
        ? {
            entityId: session.firstTargetEntityId,
            pickPoint: {
              x: session.firstTargetPickPoint.x,
              y: session.firstTargetPickPoint.y,
            },
            segmentId: session.firstTargetSegmentId,
          }
        : null,
    activeFilletPreview:
      session?.key === 'FILLET' &&
      session.radius != null &&
      session.firstEntityId != null &&
      session.firstPickPoint != null
        ? {
            radius: session.radius,
            firstEntityId: session.firstEntityId,
            firstPickPoint: {
              x: session.firstPickPoint.x,
              y: session.firstPickPoint.y,
            },
            firstSegmentId: session.firstSegmentId,
          }
        : null,
    activeBatchCogoDraft,
    activeTraverseDraft,
    snapConstructionContext,
    commandExpectsPointPick,
    canUseActiveSnap:
      activeSnap != null &&
      commandExpectsPointPick &&
      session?.key !== 'TRIM' &&
      session?.key !== 'EXTEND',
    canCycleActiveSnap:
      commandExpectsPointPick &&
      session?.key !== 'TRIM' &&
      session?.key !== 'EXTEND',
    canFinishCommand:
      session?.key === 'PLINE'
        ? session.points.length >= 2
        : session?.key === 'TRAVERSE'
          ? session.points.length >= 2 &&
            (session.mode !== 'point-to-point' || session.closePoint != null)
          : session?.key === 'BATCH_COGO'
            ? session.draft.canCommit
            : false,
    canCloseTraverseDraft:
      session?.key === 'TRAVERSE' &&
      session.points.length >= 3 &&
      (Math.abs(session.points[0]!.x - session.points[session.points.length - 1]!.x) > 1e-9 ||
        Math.abs(session.points[0]!.y - session.points[session.points.length - 1]!.y) > 1e-9),
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
    startArc3PointCommand: () =>
      beginSession({
        key: 'ARC_3PT',
        inputValue: '',
        points: [],
      }),
    startArcStartCenterEndCommand: () =>
      beginSession({
        key: 'ARC_SCE',
        inputValue: '',
        points: [],
      }),
    startArcCenterStartEndCommand: () =>
      beginSession({
        key: 'ARC_CSE',
        inputValue: '',
        points: [],
      }),
    startArcStartCenterAngleCommand: () =>
      beginSession({
        key: 'ARC_SCA',
        inputValue: '',
        points: [],
      }),
    startArcCenterStartAngleCommand: () =>
      beginSession({
        key: 'ARC_CSA',
        inputValue: '',
        points: [],
      }),
    startArcStartCenterChordCommand: () =>
      beginSession({
        key: 'ARC_SCL',
        inputValue: '',
        points: [],
      }),
    startArcCenterStartChordCommand: () =>
      beginSession({
        key: 'ARC_CSL',
        inputValue: '',
        points: [],
      }),
    startArcStartEndAngleCommand: () =>
      beginSession({
        key: 'ARC_SEA',
        inputValue: '',
        points: [],
      }),
    startArcStartEndDirectionCommand: () =>
      beginSession({
        key: 'ARC_SED',
        inputValue: '',
        points: [],
      }),
    startArcStartEndRadiusCommand: () =>
      beginSession({
        key: 'ARC_SER',
        inputValue: '',
        points: [],
      }),
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
    startInverseCommand: () =>
      beginSession({
        key: 'INVERSE',
        inputValue: '',
        startPoint: null,
      }),
    startMultiInverseCommand: () =>
      beginSession({
        key: 'MULTI_INVERSE',
        inputValue: '',
        points: [],
      }),
    startBearingReportCommand: () =>
      beginSession({
        key: 'BEARING_REPORT',
        inputValue: '',
        startPoint: null,
      }),
    startDistanceReportCommand: () =>
      beginSession({
        key: 'DISTANCE_REPORT',
        inputValue: '',
        startPoint: null,
      }),
    startTurnedPointCommand: () =>
      beginSession({
        key: 'TURNED_POINT',
        inputValue: '',
        occupyPoint: null,
        backsightPoint: null,
      }),
    startDeflectionPointCommand: () => {
      if (!selectedLineCommandPoints) return;
      beginSession({
        key: 'DEFLECT_POINT',
        inputValue: '',
        lineStart: selectedLineCommandPoints.start,
        lineEnd: selectedLineCommandPoints.end,
      });
    },
    startPointAlongLineCommand: () => {
      if (!selectedLineCommandPoints) return;
      beginSession({
        key: 'POINT_ALONG_LINE',
        inputValue: '',
        lineStart: selectedLineCommandPoints.start,
        lineEnd: selectedLineCommandPoints.end,
      });
    },
    startExtendLineCommand: () => {
      if (!selectedLineCommandPoints) return;
      beginSession({
        key: 'EXTEND_LINE',
        inputValue: '',
        lineStart: selectedLineCommandPoints.start,
        lineEnd: selectedLineCommandPoints.end,
      });
    },
    startOffsetPointCommand: () => {
      if (!selectedLineCommandPoints) return;
      beginSession({
        key: 'OFFSET_POINT',
        inputValue: '',
        lineStart: selectedLineCommandPoints.start,
        lineEnd: selectedLineCommandPoints.end,
      });
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
    startCurveSolverCommand: () =>
      beginSession({
        key: 'CURVE_SOLVER',
        inputValue: '',
      }),
    startRadialBearingCommand: () => {
      if (!selectedArcForCurveCogo) return;
      beginSession({
        key: 'RADIAL_BEARING',
        inputValue: '',
        arc: selectedArcForCurveCogo,
      });
    },
    startPointOnCurveCommand: () => {
      if (!selectedArcForCurveCogo) return;
      beginSession({
        key: 'POINT_ON_CURVE',
        inputValue: '',
        arc: selectedArcForCurveCogo,
      });
    },
    startSubdivideCurveCommand: () => {
      if (!selectedArcForCurveCogo) return;
      beginSession({
        key: 'SUBDIVIDE_CURVE',
        inputValue: '',
        arc: selectedArcForCurveCogo,
      });
    },
    startOffsetCurveCommand: () => {
      if (!selectedArcForCurveCogo) return;
      beginSession({
        key: 'OFFSET_CURVE',
        inputValue: '',
        arc: selectedArcForCurveCogo,
      });
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
      beginSession({
        key: 'REVERSE_CURVE',
        inputValue: '',
        arc: selectedArcForCurveCogo,
      });
    },
    startCompoundCurveCommand: () => {
      if (!selectedArcForCurveCogo) return;
      beginSession({
        key: 'COMPOUND_CURVE',
        inputValue: '',
        arc: selectedArcForCurveCogo,
      });
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
      beginSession({
        key: 'MOVE',
        inputValue: '',
        startPoint: null,
      });
    },
    startCopyCommand: () => {
      if (selectionCount === 0) return;
      beginSession({
        key: 'COPY',
        inputValue: '',
        startPoint: null,
      });
    },
    startExtendCommand: () => {
      beginSession({
        key: 'EXTEND',
        inputValue: '',
        firstTargetEntityId: null,
        firstTargetPickPoint: null,
        firstTargetSegmentId: undefined,
      });
    },
    startTrimCommand: () => {
      beginSession({
        key: 'TRIM',
        inputValue: '',
        firstEntityId: null,
        firstPickPoint: null,
        firstSegmentId: undefined,
      });
    },
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
    cancelCommand: () => replaceSession(null),
    finishCommand: () => {
      if (session?.key === 'PLINE') {
        finishPolylineSession();
        return;
      }
      if (session?.key === 'TRAVERSE') {
        finishTraverseSession();
        return;
      }
      if (session?.key === 'BATCH_COGO') {
        commitBatchCogoDraft();
      }
    },
    setCommandInputValue: (value) =>
      updateSession((current) =>
        current && current.key !== 'TRIM' && current.key !== 'EXTEND'
          ? { ...current, inputValue: value, resultText: undefined }
          : current,
      ),
    appendCommandInputValue: (value) =>
      updateSession((current) =>
        current && current.key !== 'TRIM' && current.key !== 'EXTEND'
          ? { ...current, inputValue: `${current.inputValue}${value}`, resultText: undefined }
          : current,
      ),
    backspaceCommandInputValue: () =>
      updateSession((current) =>
        current && current.key !== 'TRIM' && current.key !== 'EXTEND'
          ? { ...current, inputValue: current.inputValue.slice(0, -1), resultText: undefined }
          : current,
      ),
    submitCommandInput: submitSessionInput,
    useActiveSnap: () => {
      if (!activeSnap) return;
      consumePoint(
        {
          x: activeSnap.x,
          y: activeSnap.y,
          label: activeSnap.label,
          snapSourceSegmentId: activeSnap.sourceSegmentId,
          snapSourceEntityId: activeSnap.sourceEntityId,
          snapKind: activeSnap.kind,
        },
        { suppressPointLabel: true },
      );
    },
    editTraverseDraftLeg,
    replaceTraverseDraftLeg,
    appendTraverseDraftPoint,
    insertTraverseDraftLeg,
    moveTraverseDraftLeg,
    applyTraverseDraftAdjustment,
    clearTraverseDraftAdjustment,
    setTraverseDraftMode,
    setTraverseDraftClosePoint,
    addTraverseDraftSideshot,
    removeTraverseDraftSideshot,
    rewindTraverseDraftToPointCount,
    closeTraverseDraftLoop,
    setBatchCogoInputValue: (value) =>
      updateSession((current) =>
        current && current.key === 'BATCH_COGO'
          ? {
              ...current,
              inputValue: value,
              draft: buildBatchCogoDraftForInput(value),
              resultText: undefined,
            }
          : current,
      ),
    commitBatchCogoDraft,
    consumeInteractionPoint: (point, label, options) => {
      if (!session) return;
      consumePoint(
        {
          x: point.x,
          y: point.y,
          label: label ?? `${point.x.toFixed(3)},${point.y.toFixed(3)}`,
          snapSourceSegmentId: options?.snapSourceSegmentId,
          snapSourceEntityId: options?.snapSourceEntityId,
          snapKind: options?.snapKind,
          extendMode: options?.extendMode,
        },
        { suppressPointLabel: true },
      );
    },
    handleEnterKey,
    handleEscapeKey,
  };
};
