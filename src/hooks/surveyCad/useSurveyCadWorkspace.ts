import { useEffect, useMemo, useRef, useState, type Dispatch, type SetStateAction } from 'react';
import {
  cadBuildParcelReportSummary,
  cadIntersectLineLikeEntities,
  isCadLineLikeEntity,
  type CadParcelReportSummary,
} from '../../engine/cad/cadCogo';
import {
  clearCadSelection,
  getSelectedCadEntities,
  replaceCadSelection,
  selectAllCadEntities,
  toggleCadSelectionEntity,
} from '../../engine/cad/cadSelection';
import { buildCadBounds, buildCadProjectSignature } from '../../engine/cad/cadProjectState';
import { cloneSurveyCadPersistedState } from '../../engine/cad/cadPersistence';
import { buildMlightcadSpikeScene } from '../../engine/cad/cadMlightcadAdapter';
import { buildCadDisplayScene } from '../../engine/cad/cadRenderer';
import type { CadCogoComputation } from '../../engine/cad/cadCogoTypes';
import {
  createCadHistoryState,
  redoCadHistory,
  runCadCommand,
  undoCadHistory,
  type CadHistoryState,
} from '../../engine/cad/cadUndoRedo';
import {
  applyCadGripEdit,
  buildCadGripHandles,
  buildCadTrimPreview,
} from '../../engine/cad/cadTransactions';
import { useSurveyCadCommands, type CadCommandPreviewState } from './useSurveyCadCommands';
import { useSurveyCadSnapping, type CadSnapPreferences } from './useSurveyCadSnapping';
import type {
  CadArcEntity,
  CadBounds,
  CadDisplayPrimitive,
  CadGripHandle,
  CadLineEntity,
  CadPolylineEntity,
  CadProject,
  CadSnapCandidate,
  CadSnapConstructionContext,
  CadSnapKind,
  SurveyCadPersistedState,
} from '../../engine/cad/cadTypes';
import type { CadEntityId } from '../../engine/cad/cadTypes';

interface UseSurveyCadWorkspaceResult {
  cadProject: CadProject;
  displayScene: ReturnType<typeof buildCadDisplayScene>;
  mlightcadScene: ReturnType<typeof buildMlightcadSpikeScene>;
  gripHandles: CadGripHandle[];
  gripPreviewPrimitives: CadDisplayPrimitive[];
  activeGripHandleId: string | null;
  selectedEntityIds: string[];
  selectedEntities: ReturnType<typeof getSelectedCadEntities>;
  selectedParcelReport: CadParcelReportSummary | null;
  activeCogoComputation: CadCogoComputation | null;
  activeCogoComputationSource: 'selected' | 'latest' | null;
  activeTraverseDraft: {
    points: Array<{ label: string; x: number; y: number }>;
    mode: 'open' | 'closed' | 'point-to-point';
    closePoint: { label: string; x: number; y: number } | null;
    legs: Array<{
      fromLabel: string;
      toLabel: string;
      bearing: string;
      distance: number;
      inputValue: string;
    }>;
    sideshots: Array<{
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
    }>;
    totalLength: number;
    closureTargetLabel: string | null;
    closureDeltaX: number | null;
    closureDeltaY: number | null;
    closureDistance: number | null;
    closureBearing: string | null;
    closureRatio: number | null;
    adjustment: {
      method: 'angular' | 'bowditch' | 'transit';
      targetLabel: string;
      rawClosureDistance: number;
      adjustedClosureDistance: number;
      rawClosureBearing: string | null;
      adjustedClosureBearing: string | null;
      angularCorrectionPerLegSec: number | null;
    } | null;
  } | null;
  selectionCount: number;
  canUndo: boolean;
  canRedo: boolean;
  canUseSelectedLineCoreCogo: boolean;
  canUseSelectedLinePairIntersection: boolean;
  canUseSelectedArcCurveCogo: boolean;
  activeCommandKey:
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
    | 'MOVE'
    | 'COPY'
    | 'TRIM'
    | 'PASTE'
    | null;
  commandInputValue: string;
  statusText: string;
  commandHelpText: string;
  commandPreviewPrimitives: CadDisplayPrimitive[];
  commandEntityOpacityOverrides: Record<string, number>;
  commandExpectsPointPick: boolean;
  canUseActiveSnap: boolean;
  canCycleActiveSnap: boolean;
  canFinishCommand: boolean;
  canCloseTraverseDraft: boolean;
  canCreateIntersectionPoint: boolean;
  canCreateParcel: boolean;
  canContinueCurve: boolean;
  canTrimSelection: boolean;
  isGripEditing: boolean;
  activeSnap: CadSnapCandidate | null;
  nearbySnaps: readonly CadSnapCandidate[];
  snapConstructionContext: CadSnapConstructionContext;
  snapPreferences: CadSnapPreferences;
  historyDepth: number;
  redoDepth: number;
  startPointCommand: () => void;
  startCogoPointCommand: () => void;
  startLineCommand: () => void;
  startPolylineCommand: () => void;
  startTraverseCommand: () => void;
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
  startTrimCommand: () => void;
  createIntersectionPoint: () => void;
  createParcelFromSelection: () => void;
  cancelActiveCommand: () => void;
  finishActiveCommand: () => void;
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
  applyTraverseDraftAdjustment: (_method: 'angular' | 'bowditch' | 'transit') => boolean;
  clearTraverseDraftAdjustment: () => void;
  setTraverseDraftMode: (_mode: 'open' | 'closed' | 'point-to-point') => void;
  setTraverseDraftClosePoint: (_point: {
    label: string;
    x: number;
    y: number;
  } | null) => void;
  addTraverseDraftSideshot: (_occupyPointIndex: number, _inputValue: string) => boolean;
  removeTraverseDraftSideshot: (_sideshotIndex: number) => void;
  rewindTraverseDraftToPointCount: (_pointCount: number) => void;
  closeTraverseDraftLoop: () => void;
  consumeInteractionPoint: (
    _worldPoint: { x: number; y: number },
    _label?: string,
    _options?: { snapSourceSegmentId?: string; snapSourceEntityId?: string; snapKind?: CadSnapKind },
  ) => void;
  handleEnterKey: () => void;
  handleEscapeKey: () => void;
  selectEntity: (_entityId: string, _appendToSelection?: boolean) => void;
  selectEntities: (_entityIds: string[], _appendToSelection?: boolean) => void;
  startGripEdit: (_handleId: string) => void;
  updateGripEdit: (_worldPoint: { x: number; y: number }) => void;
  finishGripEdit: (_worldPoint?: { x: number; y: number }) => void;
  cancelGripEdit: () => void;
  updatePointerWorldPoint: (
    _worldPoint: { x: number; y: number } | null,
    _toleranceWorld?: number,
    _options?: {
      visibleBounds?: CadBounds | null;
      lockConstruction?: boolean;
      restrictedGripHandles?: readonly CadGripHandle[];
    },
  ) => void;
  setCommandHoverTarget: (_hoverTarget: CommandHoverTarget | null) => void;
  setSnapPreference: (_kind: keyof CadSnapPreferences, _enabled: boolean) => void;
  cycleActiveSnap: () => void;
  selectAll: () => void;
  clearSelection: () => void;
  eraseSelection: () => void;
  startPasteFromClipboard: (_entityIds: string[]) => void;
  undo: () => void;
  redo: () => void;
}

interface CommandHoverTarget {
  entityId: string;
  segmentId?: string;
  point: { x: number; y: number };
}

const cogoProvenanceIdFromEntity = (entity: ReturnType<typeof getSelectedCadEntities>[number]): string | null => {
  const cogoMetadata = entity.metadata?.cogo;
  if (
    typeof cogoMetadata !== 'object' ||
    cogoMetadata == null ||
    !('provenanceId' in cogoMetadata) ||
    typeof cogoMetadata.provenanceId !== 'string'
  ) {
    return null;
  }
  return cogoMetadata.provenanceId;
};

export const useSurveyCadWorkspace = (
  baseProject: CadProject,
  persistedState: SurveyCadPersistedState | null,
  onPersistedStateChange: Dispatch<SetStateAction<SurveyCadPersistedState | null>>,
  reverseDirectionModifier = false,
): UseSurveyCadWorkspaceResult => {
  const projectSignature = useMemo(() => buildCadProjectSignature(baseProject), [baseProject]);
  const persistedProjectRef = useRef(persistedState?.project ?? null);
  const historySourceSignatureRef = useRef<string | null>(
    persistedState?.sourceSignature === projectSignature ? persistedState.sourceSignature : projectSignature,
  );

  useEffect(() => {
    persistedProjectRef.current = persistedState?.project ?? null;
  }, [persistedState]);

  const [history, setHistory] = useState(() =>
    createCadHistoryState(
      persistedState?.sourceSignature === projectSignature ? persistedState.project : baseProject,
      baseProject.entities[0] ? [baseProject.entities[0].id] : [],
    ),
  );
  const historyRef = useRef(history);

  useEffect(() => {
    historyRef.current = history;
  }, [history]);

  const replaceHistory = (nextHistory: CadHistoryState) => {
    historyRef.current = nextHistory;
    setHistory(nextHistory);
  };

  const applyHistoryUpdate = (updater: (_history: CadHistoryState) => CadHistoryState) => {
    const nextHistory = updater(historyRef.current);
    historyRef.current = nextHistory;
    setHistory(nextHistory);
  };

  useEffect(() => {
    const nextSourceSignature =
      persistedState?.sourceSignature === projectSignature ? persistedState.sourceSignature : projectSignature;
    if (historySourceSignatureRef.current === nextSourceSignature) return;
    historySourceSignatureRef.current = nextSourceSignature;
    replaceHistory(
      createCadHistoryState(
        persistedState?.sourceSignature === projectSignature && persistedProjectRef.current
          ? persistedProjectRef.current
          : baseProject,
        baseProject.entities[0] ? [baseProject.entities[0].id] : [],
      ),
    );
  }, [baseProject, persistedState?.sourceSignature, projectSignature]);

  const cadProject = history.present.project;
  const selection = history.present.selection;
  const activeGripHandleRef = useRef<CadGripHandle | null>(null);

  const displayScene = useMemo(() => buildCadDisplayScene(cadProject), [cadProject]);
  const mlightcadScene = useMemo(() => buildMlightcadSpikeScene(cadProject), [cadProject]);
  const selectedEntities = useMemo(
    () => getSelectedCadEntities(cadProject, selection),
    [cadProject, selection],
  );
  const selectedArcForContinue = useMemo(
    () => selectedEntities.find((entity): entity is CadArcEntity => entity.type === 'arc') ?? null,
    [selectedEntities],
  );
  const selectedPolylineForParcel = useMemo(
    () =>
      selectedEntities.find(
        (entity): entity is CadPolylineEntity =>
          entity.type === 'polyline' && entity.vertices.length >= 3,
      ) ?? null,
    [selectedEntities],
  );
  const selectedLineLikes = useMemo(
    () => selectedEntities.filter(isCadLineLikeEntity),
    [selectedEntities],
  );
  const selectedLineForCoreCogo = useMemo(
    () =>
      selectedEntities.length === 1 && selectedEntities[0]?.type === 'line'
        ? selectedEntities[0]
        : null,
    [selectedEntities],
  );
  const selectedLinePairForIntersection = useMemo(
    () =>
      selectedEntities.length === 2 &&
      selectedEntities[0]?.type === 'line' &&
      selectedEntities[1]?.type === 'line'
        ? [selectedEntities[0], selectedEntities[1]] as [CadLineEntity, CadLineEntity]
        : null,
    [selectedEntities],
  );
  const selectedTrimEntities = useMemo(
    () => selectedEntities.filter((entity) => entity.type === 'line' || entity.type === 'polyline' || entity.type === 'arc'),
    [selectedEntities],
  );
  const trimCuttingEntityIds = useMemo(
    () => selectedTrimEntities.map((entity) => entity.id),
    [selectedTrimEntities],
  );
  const selectedParcelReport = useMemo(() => {
    const selectedParcel = selectedEntities.find((entity) => entity.type === 'parcel');
    if (!selectedParcel || selectedParcel.type !== 'parcel') return null;
    return cadBuildParcelReportSummary({
      parcelName: selectedParcel.parcelName,
      vertices: selectedParcel.vertices,
      vertexLabels: selectedParcel.vertexLabels,
    });
  }, [selectedEntities]);
  const [reportedComputation, setReportedComputation] = useState<CadCogoComputation | null>(null);
  const latestPersistedCogoComputation = useMemo(
    () => cadProject.cogoComputations[cadProject.cogoComputations.length - 1] ?? null,
    [cadProject.cogoComputations],
  );
  const selectedCogoComputation = useMemo(() => {
    const selectedProvenanceIds = new Set(
      selectedEntities
        .map((entity) => cogoProvenanceIdFromEntity(entity))
        .filter((value): value is string => value != null),
    );
    if (selectedProvenanceIds.size === 0) return null;
    for (let index = cadProject.cogoComputations.length - 1; index >= 0; index -= 1) {
      const computation = cadProject.cogoComputations[index];
      if (computation && selectedProvenanceIds.has(computation.id)) {
        return computation;
      }
    }
    return null;
  }, [cadProject.cogoComputations, selectedEntities]);
  const activeCogoComputation = reportedComputation ?? selectedCogoComputation ?? latestPersistedCogoComputation;
  const activeCogoComputationSource: 'selected' | 'latest' | null =
    reportedComputation != null
      ? 'latest'
      : selectedCogoComputation != null
      ? 'selected'
      : activeCogoComputation != null
        ? 'latest'
        : null;
  const [activeGripHandle, setActiveGripHandle] = useState<CadGripHandle | null>(null);
  useEffect(() => {
    activeGripHandleRef.current = activeGripHandle;
  }, [activeGripHandle]);
  const editableSelectedEntity = useMemo(
    () =>
      selectedEntities.length === 1 &&
      ['line', 'polyline', 'polygon', 'parcel', 'arc'].includes(selectedEntities[0]!.type)
        ? selectedEntities[0]!
        : null,
    [selectedEntities],
  );
  const [snapConstructionContext, setSnapConstructionContext] = useState<CadSnapConstructionContext>({
    active: false,
    basePoint: null,
  });
  const [commandHoverTarget, setCommandHoverTargetState] = useState<CommandHoverTarget | null>(null);
  const {
    activeSnap,
    nearbySnaps,
    pointerWorldPoint,
    snapPreferences,
    updatePointerWorldPoint: updatePointerWorldPointInternal,
    cycleActiveSnap,
    setSnapPreference,
  } = useSurveyCadSnapping(cadProject, snapConstructionContext);
  const previewPoint = useMemo(
    () =>
      activeSnap
        ? { x: activeSnap.x, y: activeSnap.y, label: activeSnap.label }
        : pointerWorldPoint
          ? {
              x: pointerWorldPoint.x,
              y: pointerWorldPoint.y,
              label: `${pointerWorldPoint.x.toFixed(3)},${pointerWorldPoint.y.toFixed(3)}`,
            }
          : null,
    [activeSnap, pointerWorldPoint],
  );
  const {
    activeCommandKey,
    commandInputValue,
    commandPrompt,
    commandHelpText,
    commandPreview,
    activeTraverseDraft,
    snapConstructionContext: nextSnapConstructionContext,
    commandExpectsPointPick,
    canUseActiveSnap,
    canCycleActiveSnap,
    canFinishCommand,
    canCloseTraverseDraft,
    startPointCommand,
    startCogoPointCommand,
    startLineCommand,
    startPolylineCommand,
    startTraverseCommand,
    startArc3PointCommand,
    startArcStartCenterEndCommand,
    startArcCenterStartEndCommand,
    startArcStartCenterAngleCommand,
    startArcCenterStartAngleCommand,
    startArcStartCenterChordCommand,
    startArcCenterStartChordCommand,
    startArcStartEndAngleCommand,
    startArcStartEndDirectionCommand,
    startArcStartEndRadiusCommand,
    startContinueCurveCommand,
    startTangentCurveCommand,
    startInverseCommand,
    startMultiInverseCommand,
    startBearingReportCommand,
    startDistanceReportCommand,
    startTurnedPointCommand,
    startDeflectionPointCommand,
    startPointAlongLineCommand,
    startExtendLineCommand,
    startOffsetPointCommand,
    startCurveSolverCommand,
    startRadialBearingCommand,
    startPointOnCurveCommand,
    startSubdivideCurveCommand,
    startOffsetCurveCommand,
    startPiCurveCommand,
    startChordBearingCurveCommand,
    startReverseCurveCommand,
    startCompoundCurveCommand,
    startBearingBearingIntersectionCommand,
    startBearingDistanceIntersectionCommand,
    startDistanceDistanceIntersectionCommand,
    startLineCircleIntersectionCommand,
    startPerpendicularIntersectionCommand,
    startOffsetIntersectionCommand,
    startSkewIntersectionCommand,
    startMoveCommand,
    startCopyCommand,
    startTrimCommand,
    startPasteCommand,
    cancelCommand,
    finishCommand,
    setCommandInputValue,
    appendCommandInputValue,
    backspaceCommandInputValue,
    submitCommandInput,
    useActiveSnap,
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
    consumeInteractionPoint,
    handleEnterKey,
    handleEscapeKey,
  } = useSurveyCadCommands({
    activeSnap,
    previewPoint,
    history,
    selectionCount: selection.selectedEntityIds.length,
    trimCuttingEntityIds,
    selectedArcForContinue,
    selectedArcForCurveCogo: selectedArcForContinue,
    selectedLineForCoreCogo,
    selectedLinePairForIntersection,
    reverseDirectionModifier,
    applyHistoryUpdate,
    onReportComputation: setReportedComputation,
  });
  useEffect(() => {
    if (activeCommandKey == null || activeCommandKey === 'INVERSE') return;
    setReportedComputation(null);
  }, [activeCommandKey]);
  useEffect(() => {
    setSnapConstructionContext((current) => {
      if (
        current.active === nextSnapConstructionContext.active &&
        current.scopeSeedSegmentId === nextSnapConstructionContext.scopeSeedSegmentId &&
        current.tangentSeedArcEntityId === nextSnapConstructionContext.tangentSeedArcEntityId &&
        current.basePoint?.x === nextSnapConstructionContext.basePoint?.x &&
        current.basePoint?.y === nextSnapConstructionContext.basePoint?.y &&
        current.tangentSeedPoint?.x === nextSnapConstructionContext.tangentSeedPoint?.x &&
        current.tangentSeedPoint?.y === nextSnapConstructionContext.tangentSeedPoint?.y
      ) {
        return current;
      }
      return nextSnapConstructionContext;
    });
  }, [nextSnapConstructionContext]);
  useEffect(() => {
    if (activeCommandKey === 'TRIM') return;
    setCommandHoverTargetState(null);
  }, [activeCommandKey]);
  const updatePointerWorldPoint = (
    worldPoint: { x: number; y: number } | null,
    toleranceWorldOverride?: number,
    options?: {
      visibleBounds?: CadBounds | null;
      lockConstruction?: boolean;
      restrictedGripHandles?: readonly CadGripHandle[];
    },
  ) => {
    updatePointerWorldPointInternal(worldPoint, toleranceWorldOverride, {
      ...options,
      restrictedGripHandles: options?.restrictedGripHandles ?? [],
    });
  };
  const commandPreviewPrimitives = useMemo<CadDisplayPrimitive[]>(() => {
    if (!commandPreview) return [] as CadDisplayPrimitive[];
    const previewStroke =
      activeCommandKey === 'COPY' || activeCommandKey === 'PASTE' ? '#38bdf8' : '#22d3ee';
    const previewOpacity = 0.85;
    if (commandPreview.kind === 'point') {
      return [
        {
          kind: 'point' as const,
          id: 'preview:point',
          layerId: 'preview',
          sourceEntityId: 'preview:point',
          stroke: previewStroke,
          fill: previewStroke,
          point: commandPreview.point,
          radius: 2.4,
          opacity: previewOpacity,
        },
      ];
    }
    if (commandPreview.kind === 'line') {
      return [
        {
          kind: 'line' as const,
          id: 'preview:line',
          layerId: 'preview',
          sourceEntityId: 'preview:line',
          stroke: previewStroke,
          points: commandPreview.points,
          strokeWidth: 1.5,
          opacity: previewOpacity,
          strokeDasharray: '8 6',
        },
      ];
    }
    if (commandPreview.kind === 'arc') {
      return [
        {
          kind: 'arc' as const,
          id: 'preview:arc',
          layerId: 'preview',
          sourceEntityId: 'preview:arc',
          stroke: previewStroke,
          center: commandPreview.center,
          radius: commandPreview.radius,
          startAngleDeg: commandPreview.startAngleDeg,
          endAngleDeg: commandPreview.endAngleDeg,
          strokeWidth: 1.5,
          opacity: previewOpacity,
          strokeDasharray: '8 6',
        },
      ];
    }
    if (commandPreview.kind === 'polyline') {
      return commandPreview.points.slice(0, -1).map((point, index) => ({
        kind: 'line' as const,
        id: `preview:polyline:${index + 1}`,
        layerId: 'preview',
        sourceEntityId: `preview:polyline:${index + 1}`,
        stroke: previewStroke,
        points: [point, commandPreview.points[index + 1]!] as [{ x: number; y: number }, { x: number; y: number }],
        strokeWidth: 1.5,
        opacity: previewOpacity,
        strokeDasharray: '8 6',
      }));
    }
    const previewSourceEntityIds =
      commandPreview.kind === 'translate-selection'
        ? commandPreview.sourceEntityIds ?? selection.selectedEntityIds
        : selection.selectedEntityIds;
    return displayScene.primitives
      .filter((primitive) => previewSourceEntityIds.includes(primitive.sourceEntityId))
      .map((primitive, index) => {
        if (primitive.kind === 'line') {
          return {
            ...primitive,
            id: `preview:translate:${index + 1}`,
            sourceEntityId: `preview:translate:${index + 1}`,
            stroke: previewStroke,
            points: [
              {
                x: primitive.points[0].x + commandPreview.deltaX,
                y: primitive.points[0].y + commandPreview.deltaY,
              },
              {
                x: primitive.points[1].x + commandPreview.deltaX,
                y: primitive.points[1].y + commandPreview.deltaY,
              },
            ] as [{ x: number; y: number }, { x: number; y: number }],
            opacity: 0.6,
            strokeDasharray: '8 6',
          };
        }
        if (primitive.kind === 'point') {
          return {
            ...primitive,
            id: `preview:translate:${index + 1}`,
            sourceEntityId: `preview:translate:${index + 1}`,
            stroke: previewStroke,
            fill: previewStroke,
            point: {
              x: primitive.point.x + commandPreview.deltaX,
              y: primitive.point.y + commandPreview.deltaY,
            },
            opacity: 0.6,
          };
        }
        if (primitive.kind === 'text') {
          return {
            ...primitive,
            id: `preview:translate:${index + 1}`,
            sourceEntityId: `preview:translate:${index + 1}`,
            stroke: previewStroke,
            point: {
              x: primitive.point.x + commandPreview.deltaX,
              y: primitive.point.y + commandPreview.deltaY,
            },
            opacity: 0.6,
          };
        }
        if (primitive.kind === 'arc') {
          return {
            ...primitive,
            id: `preview:translate:${index + 1}`,
            sourceEntityId: `preview:translate:${index + 1}`,
            stroke: previewStroke,
            center: {
              x: primitive.center.x + commandPreview.deltaX,
              y: primitive.center.y + commandPreview.deltaY,
            },
            opacity: 0.6,
            strokeDasharray: '8 6',
          };
        }
        return {
          ...primitive,
          id: `preview:translate:${index + 1}`,
          sourceEntityId: `preview:translate:${index + 1}`,
          stroke: previewStroke,
          center: {
            x: primitive.center.x + commandPreview.deltaX,
            y: primitive.center.y + commandPreview.deltaY,
          },
          opacity: 0.6,
          strokeDasharray: '8 6',
        };
      });
  }, [activeCommandKey, commandPreview, displayScene.primitives, selection.selectedEntityIds]);
  const trimPreview = useMemo(() => {
    if (activeCommandKey !== 'TRIM' || !commandHoverTarget) return null;
    return buildCadTrimPreview(
      cadProject,
      trimCuttingEntityIds,
      commandHoverTarget.entityId,
      commandHoverTarget.point,
      commandHoverTarget.segmentId,
    );
  }, [activeCommandKey, cadProject, commandHoverTarget, trimCuttingEntityIds]);
  const trimPreviewPrimitives = useMemo<CadDisplayPrimitive[]>(() => {
    if (!trimPreview) return [];
    return buildCadDisplayScene({
      ...cadProject,
      entities: trimPreview.previewEntities,
      bounds: buildCadBounds(trimPreview.previewEntities),
    }).primitives;
  }, [cadProject, trimPreview]);
  const commandEntityOpacityOverrides = useMemo<Record<string, number>>(
    () => (trimPreview ? { [trimPreview.targetEntityId]: 0.22 } : {}),
    [trimPreview],
  );
  const gripHandles = useMemo(
    () =>
      activeCommandKey == null && editableSelectedEntity
        ? buildCadGripHandles(editableSelectedEntity)
        : [],
    [activeCommandKey, editableSelectedEntity],
  );
  useEffect(() => {
    if (activeCommandKey != null && activeGripHandle != null) {
      setActiveGripHandle(null);
    }
  }, [activeCommandKey, activeGripHandle]);
  useEffect(() => {
    if (!activeGripHandle) return;
    const nextHandle = gripHandles.find((handle) => handle.id === activeGripHandle.id) ?? null;
    if (!nextHandle) {
      setActiveGripHandle(null);
    }
  }, [activeGripHandle, gripHandles]);
  const gripPreviewPrimitives = useMemo<CadDisplayPrimitive[]>(() => {
    if (!activeGripHandle) return [];
    const previewProject = applyCadGripEdit(cadProject, {
      key: 'GRIP_EDIT',
      entityId: activeGripHandle.entityId,
      gripKind: activeGripHandle.kind,
      x: activeGripHandle.x,
      y: activeGripHandle.y,
      vertexIndex: activeGripHandle.vertexIndex,
    });
    if (!previewProject) return [];
    return buildCadDisplayScene(previewProject).primitives
      .filter((primitive) => primitive.sourceEntityId === activeGripHandle.entityId)
      .map((primitive) => ({
        ...primitive,
        stroke: '#22d3ee',
        fill: primitive.kind === 'point' ? '#22d3ee' : primitive.fill,
        opacity: 0.9,
        strokeDasharray:
          primitive.kind === 'text' || primitive.kind === 'point'
            ? primitive.strokeDasharray
            : primitive.strokeDasharray ?? '8 6',
      }));
  }, [activeGripHandle, cadProject]);
  const selectedIntersection = useMemo(() => {
    if (selectedLineLikes.length !== 2) return null;
    return cadIntersectLineLikeEntities(selectedLineLikes[0], selectedLineLikes[1]);
  }, [selectedLineLikes]);
  useEffect(() => {
    onPersistedStateChange((current) => {
      const nextState = cloneSurveyCadPersistedState({
        version: 1,
        sourceSignature: projectSignature,
        project: cadProject,
      });
      if (
        current?.sourceSignature === nextState.sourceSignature &&
        buildCadProjectSignature(current.project) === buildCadProjectSignature(nextState.project)
      ) {
        return current;
      }
      return nextState;
    });
  }, [cadProject, onPersistedStateChange, projectSignature]);

  return {
    cadProject,
    displayScene,
    mlightcadScene,
    gripHandles,
    gripPreviewPrimitives,
    activeGripHandleId: activeGripHandle?.id ?? null,
    selectedEntityIds: selection.selectedEntityIds,
    selectedEntities,
    selectedParcelReport,
    activeCogoComputation,
    activeCogoComputationSource,
    activeTraverseDraft,
    selectionCount: selection.selectedEntityIds.length,
    canUndo: history.undoStack.length > 0,
    canRedo: history.redoStack.length > 0,
    canUseSelectedLineCoreCogo: selectedLineForCoreCogo != null,
    canUseSelectedLinePairIntersection: selectedLinePairForIntersection != null,
    canUseSelectedArcCurveCogo: selectedArcForContinue != null,
    activeCommandKey,
    commandInputValue,
    statusText: commandPrompt,
    commandHelpText,
    commandPreviewPrimitives: [...commandPreviewPrimitives, ...trimPreviewPrimitives],
    commandEntityOpacityOverrides,
    commandExpectsPointPick,
    canUseActiveSnap,
    canCycleActiveSnap,
    canFinishCommand,
    canCloseTraverseDraft,
    canCreateIntersectionPoint: selectedIntersection != null,
    canCreateParcel: selectedPolylineForParcel != null,
    canContinueCurve: selectedArcForContinue != null,
    canTrimSelection: trimCuttingEntityIds.length > 0,
    isGripEditing: activeGripHandle != null,
    activeSnap,
    nearbySnaps,
    snapConstructionContext,
    snapPreferences,
    historyDepth: history.undoStack.length,
    redoDepth: history.redoStack.length,
    startPointCommand,
    startCogoPointCommand,
    startLineCommand,
    startPolylineCommand,
    startTraverseCommand,
    startArc3PointCommand,
    startArcStartCenterEndCommand,
    startArcCenterStartEndCommand,
    startArcStartCenterAngleCommand,
    startArcCenterStartAngleCommand,
    startArcStartCenterChordCommand,
    startArcCenterStartChordCommand,
    startArcStartEndAngleCommand,
    startArcStartEndDirectionCommand,
    startArcStartEndRadiusCommand,
    startContinueCurveCommand,
    startTangentCurveCommand,
    startInverseCommand,
    startMultiInverseCommand,
    startBearingReportCommand,
    startDistanceReportCommand,
    startTurnedPointCommand,
    startDeflectionPointCommand,
    startPointAlongLineCommand,
    startExtendLineCommand,
    startOffsetPointCommand,
    startCurveSolverCommand,
    startRadialBearingCommand,
    startPointOnCurveCommand,
    startSubdivideCurveCommand,
    startOffsetCurveCommand,
    startPiCurveCommand,
    startChordBearingCurveCommand,
    startReverseCurveCommand,
    startCompoundCurveCommand,
    startBearingBearingIntersectionCommand,
    startBearingDistanceIntersectionCommand,
    startDistanceDistanceIntersectionCommand,
    startLineCircleIntersectionCommand,
    startPerpendicularIntersectionCommand,
    startOffsetIntersectionCommand,
    startSkewIntersectionCommand,
    startMoveCommand,
    startCopyCommand,
    startTrimCommand,
    createIntersectionPoint: () => {
      if (!selectedIntersection || selectedLineLikes.length !== 2) return;
      applyHistoryUpdate((current) =>
        runCadCommand(current, {
          key: 'INTERSECT_POINT',
          x: selectedIntersection.point.x,
          y: selectedIntersection.point.y,
          firstLabel: selectedLineLikes[0].id,
          secondLabel: selectedLineLikes[1].id,
        }),
      );
    },
    createParcelFromSelection: () => {
      if (!selectedPolylineForParcel) return;
      applyHistoryUpdate((current) =>
        runCadCommand(current, {
          key: 'PARCEL_CREATE',
          sourceEntityId: selectedPolylineForParcel.id,
        }),
      );
    },
    cancelActiveCommand: cancelCommand,
    finishActiveCommand: finishCommand,
    setCommandInputValue,
    appendCommandInputValue,
    backspaceCommandInputValue,
    submitCommandInput,
    useActiveSnap,
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
    cycleActiveSnap,
    consumeInteractionPoint: (worldPoint, label, options) => {
      if (canUseActiveSnap && activeSnap) {
        consumeInteractionPoint(
          { x: activeSnap.x, y: activeSnap.y },
          activeSnap.label,
          {
            snapSourceSegmentId: activeSnap.sourceSegmentId,
            snapSourceEntityId: activeSnap.sourceEntityId,
            snapKind: activeSnap.kind,
          },
        );
        return;
      }
      consumeInteractionPoint(worldPoint, label, options);
    },
    handleEnterKey,
    handleEscapeKey,
    selectEntity: (entityId, appendToSelection = false) => {
      setActiveGripHandle(null);
      applyHistoryUpdate((current) => {
        const nextSelection =
          appendToSelection
            ? toggleCadSelectionEntity(current.present.project, current.present.selection, entityId)
            : replaceCadSelection(current.present.project, [entityId]);
        return {
          ...current,
          present: {
            ...current.present,
            selection: nextSelection,
          },
          commandState: {
            key: 'IDLE',
            phase: 'idle',
            prompt: `Selected ${nextSelection.selectedEntityIds.length} entr${nextSelection.selectedEntityIds.length === 1 ? 'y' : 'ies'}.`,
          },
        };
      });
    },
    selectEntities: (entityIds, appendToSelection = false) => {
      setActiveGripHandle(null);
      applyHistoryUpdate((current) => {
        const selectedIdSet = appendToSelection
          ? new Set<CadEntityId>([
              ...current.present.selection.selectedEntityIds,
              ...entityIds,
            ])
          : new Set<CadEntityId>(entityIds);
        const orderedIds = current.present.project.entities
          .filter((entity) => selectedIdSet.has(entity.id))
          .map((entity) => entity.id);
        const nextSelection = replaceCadSelection(current.present.project, orderedIds);
        return {
          ...current,
          present: {
            ...current.present,
            selection: nextSelection,
          },
          commandState: {
            key: 'IDLE',
            phase: 'idle',
            prompt: `Selected ${nextSelection.selectedEntityIds.length} entr${nextSelection.selectedEntityIds.length === 1 ? 'y' : 'ies'}.`,
          },
        };
      });
    },
    selectAll: () => {
      setActiveGripHandle(null);
      applyHistoryUpdate((current) => {
        const nextSelection = selectAllCadEntities(current.present.project);
        return {
          ...current,
          present: {
            ...current.present,
            selection: nextSelection,
          },
          commandState: {
            key: 'IDLE',
            phase: 'idle',
            prompt: `Selected ${nextSelection.selectedEntityIds.length} entr${nextSelection.selectedEntityIds.length === 1 ? 'y' : 'ies'}.`,
          },
        };
      });
    },
    startGripEdit: (handleId) => {
      const handle = gripHandles.find((candidate) => candidate.id === handleId) ?? null;
      if (!handle) return;
      activeGripHandleRef.current = handle;
      setActiveGripHandle(handle);
    },
    updateGripEdit: (worldPoint) => {
      const currentHandle = activeGripHandleRef.current;
      if (!currentHandle) return;
      const nextHandle = {
        ...currentHandle,
        x: worldPoint.x,
        y: worldPoint.y,
      };
      activeGripHandleRef.current = nextHandle;
      setActiveGripHandle((current) =>
        current
          ? {
              ...current,
              x: worldPoint.x,
              y: worldPoint.y,
            }
          : current,
      );
    },
    finishGripEdit: (worldPoint?: { x: number; y: number }) => {
      const gripHandle = activeGripHandleRef.current;
      if (!gripHandle) return;
      const committedHandle =
        worldPoint == null
          ? gripHandle
          : {
              ...gripHandle,
              x: worldPoint.x,
              y: worldPoint.y,
            };
      applyHistoryUpdate((current) =>
        runCadCommand(current, {
          key: 'GRIP_EDIT',
          entityId: committedHandle.entityId,
          gripKind: committedHandle.kind,
          x: committedHandle.x,
          y: committedHandle.y,
          vertexIndex: committedHandle.vertexIndex,
        }),
      );
      activeGripHandleRef.current = null;
      setActiveGripHandle(null);
    },
    cancelGripEdit: () => {
      activeGripHandleRef.current = null;
      setActiveGripHandle(null);
    },
    updatePointerWorldPoint,
    setSnapPreference,
    clearSelection: () => {
      setActiveGripHandle(null);
      applyHistoryUpdate((current) => ({
        ...current,
        present: {
          ...current.present,
          selection: clearCadSelection(),
        },
        commandState: {
          key: 'IDLE',
          phase: 'idle',
          prompt: 'Selection cleared.',
        },
      }));
    },
    eraseSelection: () => {
      setActiveGripHandle(null);
      applyHistoryUpdate((current) => runCadCommand(current, { key: 'ERASE' }));
    },
    startPasteFromClipboard: (entityIds) => {
      const sourceEntities = history.present.project.entities.filter((entity) =>
        entityIds.includes(entity.id),
      );
      const bounds = buildCadBounds(sourceEntities);
      if (!bounds || sourceEntities.length === 0) return;
      startPasteCommand(
        sourceEntities.map((entity) => entity.id),
        {
          x: bounds.minX,
          y: bounds.minY,
          label: `${bounds.minX.toFixed(3)},${bounds.minY.toFixed(3)}`,
        },
      );
    },
    undo: () => {
      setActiveGripHandle(null);
      applyHistoryUpdate((current) => undoCadHistory(current));
    },
    redo: () => {
      setActiveGripHandle(null);
      applyHistoryUpdate((current) => redoCadHistory(current));
    },
    setCommandHoverTarget: (hoverTarget) => {
      setCommandHoverTargetState((current) => {
        if (
          current?.entityId === hoverTarget?.entityId &&
          current?.segmentId === hoverTarget?.segmentId &&
          current?.point.x === hoverTarget?.point.x &&
          current?.point.y === hoverTarget?.point.y
        ) {
          return current;
        }
        return hoverTarget;
      });
    },
  };
};
