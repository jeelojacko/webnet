import { useEffect, useMemo, useRef, useState } from 'react';
import {
  buildCadDistanceSummary,
  buildCadInverseSummary,
  cadIntersectPerpendicular,
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
  cadParseBearingDegrees,
  type CadNamedPoint,
} from '../../engine/cad/cadGeometry';
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
  parseInputPoint,
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
import { createSurveyCadReportPublisher } from './useSurveyCadCommandReports';
import { useSurveyCadTraverseDraftActions } from './useSurveyCadTraverseDraftActions';
import { createBatchCogoDraftBuilder } from './useSurveyCadBatchCogoDraft';
import { buildSurveyCadCommandAvailability } from './useSurveyCadCommandAvailability';
import { handleSurveyCadArcPointPick } from './useSurveyCadArcPointPick';
import { handleSurveyCadEditPointPick } from './useSurveyCadEditPointPick';
import { handleSurveyCadParcelSplitPointPick } from './useSurveyCadParcelSplitPointPick';
import { handleSurveyCadCurveSubmit } from './useSurveyCadCurveSubmit';
import { handleSurveyCadIntersectionSubmit } from './useSurveyCadIntersectionSubmit';
import { handleSurveyCadTypedSubmit } from './useSurveyCadTypedSubmit';

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

  const publishReport = useMemo(
    () => createSurveyCadReportPublisher(onReportComputation),
    [onReportComputation],
  );
  const buildBatchCogoDraftForInput = useMemo(
    () => createBatchCogoDraftBuilder(selectedStartPointForBatchCogo),
    [selectedStartPointForBatchCogo],
  );

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
  const commandAvailability = useMemo(
    () =>
      buildSurveyCadCommandAvailability({
        activeSnap,
        commandExpectsPointPick,
        session,
      }),
    [activeSnap, commandExpectsPointPick, session],
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
    if (
      handleSurveyCadArcPointPick({
        applyHistoryUpdate,
        commitArcDefinition,
        current,
        point,
        replaceSession,
        reverseDirectionModifier,
      })
    ) {
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
    if (
      handleSurveyCadEditPointPick({
        applyHistoryUpdate,
        current,
        history,
        point,
        replaceSession,
      })
    ) {
      return;
    }
    if (handleSurveyCadParcelSplitPointPick({ current, point, replaceSession })) {
      return;
    }
    if (current.key !== 'INVERSE') return;
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
    if (
      handleSurveyCadTypedSubmit({
        applyHistoryUpdate,
        consumePoint,
        publishReport,
        replaceSession,
        session,
      })
    ) {
      return;
    }
    if (
      handleSurveyCadCurveSubmit({
        applyHistoryUpdate,
        commitArcDefinition,
        consumePoint,
        publishReport,
        replaceSession,
        session,
      })
    ) {
      return;
    }
    if (
      handleSurveyCadIntersectionSubmit({
        applyHistoryUpdate,
        consumePoint,
        publishReport,
        replaceSession,
        session,
      })
    ) {
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
    canUseActiveSnap: commandAvailability.canUseActiveSnap,
    canCycleActiveSnap: commandAvailability.canCycleActiveSnap,
    canFinishCommand: commandAvailability.canFinishCommand,
    canCloseTraverseDraft: commandAvailability.canCloseTraverseDraft,
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
