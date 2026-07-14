import { useEffect, useMemo, useRef, useState } from 'react';
import {
  cadDraftBatchCogo,
} from '../../engine/cad/cadBatchCogo';
import {
  cadArcPointByArcDistance,
  cadArcPointByChordDistance,
  cadArcSubdivisionPoints,
  cadBuildParcelReportSummary,
  cadBuildArcFromChordBearingRadius,
  cadBuildArcFromPiRadiusDelta,
  cadBuildCompoundCurve,
  buildCadDistanceSummary,
  buildCadInverseSummary,
  buildCadMultiInverseSummary,
  cadConvertAreaSquareMeters,
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
  type CadTraverseAdjustmentMethod,
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
  cadBuildContinuedArc,
  cadParseBearingDegrees,
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
  CadLineEntity,
  CadParcelEntity,
  CadPolylineEntity,
  CadSnapCandidate,
  CadSnapConstructionContext,
  CadSnapKind,
} from '../../engine/cad/cadTypes';
import type {
  ActiveCommandKey,
  CommandPoint,
  CommandSession,
  TraverseDraftMode,
} from './useSurveyCadCommandTypes';
import {
  buildTraverseLegInputFromPoints,
  sessionExpectsPointPick,
} from './useSurveyCadCommandSession';
import {
  normalizeDraftPoint,
  parseAbsolutePoint,
  parseAlignmentIntervalInput,
  parseAlignmentOffsetCreateInput,
  parseAlignmentStationEquationInput,
  parseAlignmentStationOffsetInput,
  parseBearingDistanceIntersectionInput,
  parseChordBearingCurveInput,
  parseCurveMeasureInput,
  parseCurveSideRadiusDeltaInput,
  parseCurveSolverInput,
  parseCurveSubdivisionInput,
  parseDistanceOrPercent,
  parseDistancePairInput,
  parseDualBearingInput,
  parseDualOffsetInput,
  parseInputPoint,
  parseLeftRightAngleDistance,
  parseOffsetArcInput,
  parseOffsetPointInput,
  parseSideDistanceInput,
} from './useSurveyCadCommandParsing';
import {
  helpTextForSession,
  promptForSession,
} from './useSurveyCadCommandText';
import {
  buildActiveBatchCogoDraftView,
  buildActiveTraverseDraftView,
  type ActiveBatchCogoDraftView,
  type ActiveTraverseDraftView,
} from './useSurveyCadCommandDrafts';
import { buildSnapConstructionContext } from './useSurveyCadCommandConstruction';
import {
  buildCommandPreview,
  type CadCommandPreviewState,
} from './useSurveyCadCommandPreview';
import {
  buildActiveEditCommandTargets,
  buildSelectedLineCommandPoints,
  buildSelectedLinePairCommandPoints,
} from './useSurveyCadCommandSelection';
import { useSurveyCadCommandStarters } from './useSurveyCadCommandStarters';
import { useSurveyCadCommandInputActions } from './useSurveyCadCommandInputActions';
import { useSurveyCadCommandLifecycle } from './useSurveyCadCommandLifecycle';
import { useSurveyCadTraverseDraftActions } from './useSurveyCadTraverseDraftActions';

export type { CadCommandPreviewState } from './useSurveyCadCommandPreview';

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
  selectedParcelForBearingSplit: CadParcelEntity | null;
  selectedParcelForAreaSplit: CadParcelEntity | null;
  selectedStartPointForBatchCogo: CommandPoint | null;
  reverseDirectionModifier: boolean;
  applyHistoryUpdate: (_updater: (_history: CadHistoryState) => CadHistoryState) => void;
  onReportComputation?: (
    _computation: ReturnType<typeof buildCadCogoComputation> | null,
  ) => void;
}

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
  activeBatchCogoDraft: ActiveBatchCogoDraftView | null;
  activeTraverseDraft: ActiveTraverseDraftView | null;
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

const buildReportProvenance = (toolKey: string, summary: string) => ({
  id: `${toolKey}:${Date.now()}:${Math.random().toString(36).slice(2, 8)}`,
  toolKey,
  inputs: {},
  resultSummary: summary,
  createdAtIso: new Date().toISOString(),
});

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
  selectedParcelForBearingSplit,
  selectedParcelForAreaSplit,
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
    () => buildSelectedLineCommandPoints(selectedLineForCoreCogo),
    [selectedLineForCoreCogo],
  );
  const selectedLinePairCommandPoints = useMemo(
    () => buildSelectedLinePairCommandPoints(selectedLinePairForIntersection),
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
        provenance: buildReportProvenance(toolKey, summary),
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
  const snapConstructionContext = useMemo(() => buildSnapConstructionContext(session), [session]);
  const commandPreview = useMemo(
    () => buildCommandPreview({ session, previewPoint, reverseDirectionModifier }),
    [previewPoint, reverseDirectionModifier, session],
  );
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
    if (current.key === 'AREA') {
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
    if (current.key === 'PARCEL_SPLIT_BEARING') {
      if (current.splitPoint == null) {
        replaceSession({
          ...current,
          splitPoint: point,
          inputValue: '',
          resultText: `PARCEL SPLIT bearing through point ${point.label} captured. Enter the bearing, then press Enter.`,
        });
      }
      return;
    }
    if (current.key === 'PARCEL_SPLIT_AREA') {
      if (current.splitPoint == null) {
        replaceSession({
          ...current,
          splitPoint: point,
          inputValue: '',
          resultText: `PARCEL SPLIT area through point ${point.label} captured. Enter the target area in square meters, then press Enter.`,
        });
      }
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
    if (session.key === 'AREA') {
      if (session.inputValue.trim().length === 0) {
        if (session.points.length < 3) return;
        const report = cadBuildParcelReportSummary({
          parcelName: 'Area Sequence',
          vertices: session.points,
          vertexLabels: session.points.map((point) => point.label),
        });
        if (!report) {
          replaceSession({
            ...session,
            resultText: 'AREA could not build a valid loop from the captured point sequence.',
          });
          return;
        }
        const convertedArea = cadConvertAreaSquareMeters(report.areaSquareMeters);
        publishReport(
          'AREA',
          'Area by Point Sequence',
          `Computed area from ${report.courseCount} side${report.courseCount === 1 ? '' : 's'}.`,
          [
            { label: 'Points', value: session.points.map((point) => point.label).join(' -> ') },
            { label: 'Area', value: report.areaSquareMeters.toFixed(3), unit: 'm2' },
            { label: 'Area (ha)', value: convertedArea.hectares.toFixed(4), unit: 'ha' },
            { label: 'Area (ac)', value: convertedArea.acres.toFixed(4), unit: 'ac' },
            { label: 'Area (ft2)', value: convertedArea.squareFeet.toFixed(3), unit: 'ft2' },
            { label: 'Perimeter', value: report.perimeterMeters.toFixed(3), unit: 'm' },
            { label: 'Closure dN', value: report.closureDeltaY.toFixed(3), unit: 'm' },
            { label: 'Closure dE', value: report.closureDeltaX.toFixed(3), unit: 'm' },
            { label: 'Closure', value: report.closureDistanceMeters.toFixed(3), unit: 'm' },
          ],
        );
        replaceSession({
          ...session,
          points: [],
          resultText: `AREA reported ${report.courseCount} sides, ${report.areaSquareMeters.toFixed(3)} m².`,
        });
        return;
      }
      const parsedPoint = parseInputPoint(session.inputValue, session.points[session.points.length - 1] ?? null);
      if (!parsedPoint) {
        replaceSession({
          ...session,
          resultText: 'AREA point input invalid. Use `x,y`, `LABEL=x,y`, `@azimuth,distance`, or survey bearing-distance.',
        });
        return;
      }
      consumePoint(parsedPoint);
      return;
    }
    if (session.key === 'PARCEL_SPLIT_BEARING') {
      if (session.splitPoint == null) {
        const parsedPoint = parseInputPoint(session.inputValue, null);
        if (!parsedPoint) {
          replaceSession({
            ...session,
            resultText: 'PARCEL SPLIT bearing through point invalid. Use `x,y` or `LABEL=x,y`.',
          });
          return;
        }
        consumePoint(parsedPoint);
        return;
      }
      const bearing = session.inputValue.trim();
      if (cadParseBearingDegrees(bearing) == null) {
        replaceSession({
          ...session,
          resultText: 'PARCEL SPLIT bearing invalid. Enter an azimuth or survey bearing like `N45-00-00E`.',
        });
        return;
      }
      let committed = false;
      applyHistoryUpdate((existing) => {
        const next = runCadCommand(existing, {
          key: 'PARCEL_SPLIT_BEARING',
          parcelEntityId: session.parcel.id,
          throughPointX: session.splitPoint!.x,
          throughPointY: session.splitPoint!.y,
          throughPointLabel: session.splitPoint!.label,
          bearing,
        });
        committed = next !== existing;
        return next;
      });
      replaceSession(
        committed
          ? null
          : {
              ...session,
              resultText: `PARCEL SPLIT bearing failed on ${session.parcel.parcelName}. Check that the through point and bearing cross the parcel boundary exactly twice.`,
            },
      );
      return;
    }
    if (session.key === 'PARCEL_SPLIT_AREA') {
      if (session.splitPoint == null) {
        const parsedPoint = parseInputPoint(session.inputValue, null);
        if (!parsedPoint) {
          replaceSession({
            ...session,
            resultText: 'PARCEL SPLIT area through point invalid. Use `x,y` or `LABEL=x,y`.',
          });
          return;
        }
        consumePoint(parsedPoint);
        return;
      }
      const targetAreaSquareMeters = Number(session.inputValue.trim());
      if (!Number.isFinite(targetAreaSquareMeters) || targetAreaSquareMeters <= 0) {
        replaceSession({
          ...session,
          resultText: 'PARCEL SPLIT area invalid. Enter a positive target area in square meters.',
        });
        return;
      }
      let committed = false;
      applyHistoryUpdate((existing) => {
        const next = runCadCommand(existing, {
          key: 'PARCEL_SPLIT_AREA',
          parcelEntityId: session.parcel.id,
          throughPointX: session.splitPoint!.x,
          throughPointY: session.splitPoint!.y,
          throughPointLabel: session.splitPoint!.label,
          targetAreaSquareMeters,
        });
        committed = next !== existing;
        return next;
      });
      replaceSession(
        committed
          ? null
          : {
              ...session,
              resultText: `PARCEL SPLIT area failed on ${session.parcel.parcelName}. Check that the through point is inside the parcel and the target area is achievable from that point.`,
            },
      );
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
            resultText: 'STA PT input invalid. Use `station,offset` or `LABEL=station,offset` within the selected alignment range.',
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
          resultText: 'ALIGN OFF input invalid. Use `offset` or `NAME=offset` for a buildable selected alignment.',
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
          resultText: 'STA EQ input invalid. Use `backStation,aheadStation`, with ahead at or above back.',
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
          resultText: 'STA INT input invalid. Use `interval` or `start,end,interval` within the selected alignment range.',
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

  const activeTraverseDraft = useMemo(() => buildActiveTraverseDraftView(session), [session]);

  const activeBatchCogoDraft = useMemo(() => buildActiveBatchCogoDraftView(session), [session]);
  const activeEditCommandTargets = useMemo(() => buildActiveEditCommandTargets(session), [session]);
  const traverseDraftActions = useSurveyCadTraverseDraftActions({
    projectStationIds,
    replaceSession,
    sessionRef,
  });
  const commandLifecycle = useSurveyCadCommandLifecycle({
    applyHistoryUpdate,
    replaceSession,
    session,
    sessionRef,
    submitSessionInput,
  });
  const commandInputActions = useSurveyCadCommandInputActions({
    activeSnap,
    buildBatchCogoDraftForInput,
    consumePoint,
    session,
    updateSession,
  });
  const commandStarters = useSurveyCadCommandStarters({
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
  });

  return {
    activeCommandKey: session?.key ?? null,
    commandInputValue: session?.inputValue ?? '',
    commandPrompt: statusPrompt,
    commandHelpText: helpText,
    commandPreview,
    activeTrimCuttingEntityIds: activeEditCommandTargets.activeTrimCuttingEntityIds,
    activeExtendTarget: activeEditCommandTargets.activeExtendTarget,
    activeFilletPreview: activeEditCommandTargets.activeFilletPreview,
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
          : session?.key === 'PARCEL_SPLIT_BEARING' || session?.key === 'PARCEL_SPLIT_AREA'
            ? session.splitPoint != null && session.inputValue.trim().length > 0
          : session?.key === 'BATCH_COGO'
            ? session.draft.canCommit
            : false,
    canCloseTraverseDraft:
      session?.key === 'TRAVERSE' &&
      session.points.length >= 3 &&
      (Math.abs(session.points[0]!.x - session.points[session.points.length - 1]!.x) > 1e-9 ||
        Math.abs(session.points[0]!.y - session.points[session.points.length - 1]!.y) > 1e-9),
    ...commandStarters,
    cancelCommand: commandLifecycle.cancelCommand,
    finishCommand: commandLifecycle.finishCommand,
    setCommandInputValue: commandInputActions.setCommandInputValue,
    appendCommandInputValue: commandInputActions.appendCommandInputValue,
    backspaceCommandInputValue: commandInputActions.backspaceCommandInputValue,
    submitCommandInput: submitSessionInput,
    useActiveSnap: commandInputActions.useActiveSnap,
    editTraverseDraftLeg: traverseDraftActions.editTraverseDraftLeg,
    replaceTraverseDraftLeg: traverseDraftActions.replaceTraverseDraftLeg,
    appendTraverseDraftPoint: traverseDraftActions.appendTraverseDraftPoint,
    insertTraverseDraftLeg: traverseDraftActions.insertTraverseDraftLeg,
    moveTraverseDraftLeg: traverseDraftActions.moveTraverseDraftLeg,
    applyTraverseDraftAdjustment: traverseDraftActions.applyTraverseDraftAdjustment,
    clearTraverseDraftAdjustment: traverseDraftActions.clearTraverseDraftAdjustment,
    setTraverseDraftMode: traverseDraftActions.setTraverseDraftMode,
    setTraverseDraftClosePoint: traverseDraftActions.setTraverseDraftClosePoint,
    addTraverseDraftSideshot: traverseDraftActions.addTraverseDraftSideshot,
    removeTraverseDraftSideshot: traverseDraftActions.removeTraverseDraftSideshot,
    rewindTraverseDraftToPointCount: traverseDraftActions.rewindTraverseDraftToPointCount,
    closeTraverseDraftLoop: traverseDraftActions.closeTraverseDraftLoop,
    setBatchCogoInputValue: commandInputActions.setBatchCogoInputValue,
    commitBatchCogoDraft: commandLifecycle.commitBatchCogoDraft,
    consumeInteractionPoint: commandInputActions.consumeInteractionPoint,
    handleEnterKey: commandLifecycle.handleEnterKey,
    handleEscapeKey: commandLifecycle.handleEscapeKey,
  };
};
