import { useEffect, useMemo, useRef, useState, type Dispatch, type SetStateAction } from 'react';
import {
  cadBuildParcelGapDiagnostics,
  cadBuildParcelOverlapDiagnostics,
  cadBuildParcelLineworkDiagnostics,
  cadIntersectLineLikeEntities,
} from '../../engine/cad/cadCogo';
import { buildCadBounds, buildCadProjectSignature } from '../../engine/cad/cadProjectState';
import { cloneSurveyCadPersistedState } from '../../engine/cad/cadPersistence';
import { buildMlightcadSpikeScene } from '../../engine/cad/cadMlightcadAdapter';
import { buildCadDisplayScene } from '../../engine/cad/cadRenderer';
import { buildCadCogoComputation, type CadCogoComputation } from '../../engine/cad/cadCogoTypes';
import {
  createCadHistoryState,
  redoCadHistory,
  runCadCommand,
  undoCadHistory,
  type CadHistoryState,
} from '../../engine/cad/cadUndoRedo';
import {
  buildCadExtendPreview,
  applyCadGripEdit,
  buildCadFilletPreview,
  buildCadGripHandles,
  buildCadTrimPreview,
} from '../../engine/cad/cadTransactions';
import { editSurveyCadPropertiesField } from './surveyCadPropertiesEdit';
import { useSurveyCadCommands, type CadCommandPreviewState } from './useSurveyCadCommands';
import { useSurveyCadSnapping, type CadSnapPreferences } from './useSurveyCadSnapping';
import { useSurveyCadSelectionDerivations } from './useSurveyCadSelectionDerivations';
import { useSurveyCadSelectionActions } from './useSurveyCadSelectionActions';
import type { CommandHoverTarget, UseSurveyCadWorkspaceResult } from './useSurveyCadWorkspace.types';
import type {
  CadAlignmentEntity,
  CadArcEntity,
  CadBounds,
  CadDisplayPrimitive,
  CadGripHandle,
  CadLineEntity,
  CadParcelEntity,
  CadParcelLayoutSettings,
  CadParcelLayoutUiState,
  CadPolylineEntity,
  CadProject,
  CadSurveyPointEntity,
  CadSnapCandidate,
  CadSnapConstructionContext,
  CadSnapKind,
  SurveyCadPersistedState,
} from '../../engine/cad/cadTypes';
import type { CadEntityId } from '../../engine/cad/cadTypes';

export const useSurveyCadWorkspace = (
  baseProject: CadProject,
  persistedState: SurveyCadPersistedState | null,
  onPersistedStateChange: Dispatch<SetStateAction<SurveyCadPersistedState | null>>,
  parcelLayoutState: CadParcelLayoutUiState | undefined,
  showParcelLabels: boolean,
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
  const {
    propertiesPanelState,
    selectedAlignmentDraft,
    selectedAlignmentForStationing,
    selectedArcForContinue,
    selectedEntities,
    selectedLineForCoreCogo,
    selectedLineLikes,
    selectedLinePairForIntersection,
    selectedParcelDiagnosticLines,
    selectedParcelForSplit,
    selectedParcelReport,
    selectedParcelsForOverlap,
    selectedParcelSource,
    selectedSplitLineForParcel,
    selectedSurveyPointForBatchCogo,
    selectedSurveyPointForStationing,
  } = useSurveyCadSelectionDerivations({ cadProject, selection });
  const [reportedComputation, setReportedComputation] = useState<CadCogoComputation | null>(null);
  const editPropertiesField = (
    entityId: CadEntityId,
    field: import('../../engine/cad/cadProperties').CadEntityPropertyEditField,
    value: string,
  ): boolean =>
    editSurveyCadPropertiesField({
      entityId,
      field,
      history: historyRef.current,
      updateHistory: applyHistoryUpdate,
      value,
    });
  const [activeGripHandle, setActiveGripHandle] = useState<CadGripHandle | null>(null);
  const selectionActions = useSurveyCadSelectionActions({
    updateHistory: applyHistoryUpdate,
    setActiveGripHandle,
  });
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
    activeTrimCuttingEntityIds,
    activeExtendTarget,
    activeFilletPreview,
    activeBatchCogoDraft,
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
    startBatchCogoCommand,
    startParcelSplitBearingCommand,
    startParcelSplitAreaCommand,
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
    startAreaCommand,
    startBearingReportCommand,
    startDistanceReportCommand,
    startTurnedPointCommand,
    startDeflectionPointCommand,
    startPointAlongLineCommand,
    startExtendLineCommand,
    startOffsetPointCommand,
    startAlignmentOffsetCreateCommand,
    startAlignmentStationEquationCommand,
    startAlignmentOffsetPointCommand,
    startAlignmentIntervalPointsCommand,
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
    startExtendCommand,
    startTrimCommand,
    startFilletCommand,
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
    setBatchCogoInputValue,
    commitBatchCogoDraft,
    consumeInteractionPoint,
    handleEnterKey,
    handleEscapeKey,
  } = useSurveyCadCommands({
    activeSnap,
    previewPoint,
    history,
    selectionCount: selection.selectedEntityIds.length,
    selectedArcForContinue,
    selectedArcForCurveCogo: selectedArcForContinue,
    selectedLineForCoreCogo,
    selectedLinePairForIntersection,
    selectedAlignmentForStationing,
    selectedParcelForBearingSplit: selectedEntities.length === 1 && selectedEntities[0]?.type === 'parcel'
      ? selectedEntities[0]
      : null,
    selectedParcelForAreaSplit: selectedEntities.length === 1 && selectedEntities[0]?.type === 'parcel'
      ? selectedEntities[0]
      : null,
    selectedStartPointForBatchCogo: selectedSurveyPointForBatchCogo
      ? {
          x: selectedSurveyPointForBatchCogo.x,
          y: selectedSurveyPointForBatchCogo.y,
          label: selectedSurveyPointForBatchCogo.stationId,
        }
      : null,
    reverseDirectionModifier,
    applyHistoryUpdate,
    onReportComputation: setReportedComputation,
  });
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
    if (activeCommandKey === 'TRIM' || activeCommandKey === 'EXTEND' || activeCommandKey === 'FILLET') return;
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
    if (commandPreview.kind === 'primitives') {
      return commandPreview.primitives;
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
    if (activeCommandKey !== 'TRIM' || !commandHoverTarget || activeTrimCuttingEntityIds.length === 0) return null;
    return buildCadTrimPreview(
      cadProject,
      activeTrimCuttingEntityIds,
      commandHoverTarget.entityId,
      commandHoverTarget.point,
      commandHoverTarget.segmentId,
    );
  }, [activeCommandKey, activeTrimCuttingEntityIds, cadProject, commandHoverTarget]);
  const trimPreviewPrimitives = useMemo<CadDisplayPrimitive[]>(() => {
    if (!trimPreview) return [];
    return buildCadDisplayScene({
      ...cadProject,
      entities: trimPreview.previewEntities,
      bounds: buildCadBounds(trimPreview.previewEntities),
    }).primitives;
  }, [cadProject, trimPreview]);
  const extendPreview = useMemo(() => {
    if (activeCommandKey !== 'EXTEND' || !commandHoverTarget || !activeExtendTarget) return null;
    return buildCadExtendPreview(
      cadProject,
      commandHoverTarget.entityId,
      activeExtendTarget.entityId,
      activeExtendTarget.pickPoint,
      activeExtendTarget.segmentId,
    );
  }, [activeCommandKey, activeExtendTarget, cadProject, commandHoverTarget]);
  const extendPreviewPrimitives = useMemo<CadDisplayPrimitive[]>(() => {
    if (!extendPreview) return [];
    return buildCadDisplayScene({
      ...cadProject,
      entities: extendPreview.previewEntities,
      bounds: buildCadBounds(extendPreview.previewEntities),
    }).primitives;
  }, [cadProject, extendPreview]);
  const filletPreview = useMemo(() => {
    if (activeCommandKey !== 'FILLET' || !commandHoverTarget || !activeFilletPreview) return null;
    return buildCadFilletPreview(
      cadProject,
      activeFilletPreview.radius,
      activeFilletPreview.firstEntityId,
      activeFilletPreview.firstPickPoint,
      activeFilletPreview.firstSegmentId,
      commandHoverTarget.entityId,
      commandHoverTarget.point,
      commandHoverTarget.segmentId,
    );
  }, [activeCommandKey, activeFilletPreview, cadProject, commandHoverTarget]);
  const filletPreviewPrimitives = useMemo<CadDisplayPrimitive[]>(() => {
    if (!filletPreview) return [];
    return buildCadDisplayScene({
      ...cadProject,
      entities: filletPreview.previewEntities,
      bounds: buildCadBounds(filletPreview.previewEntities),
    }).primitives;
  }, [cadProject, filletPreview]);
  const commandEntityOpacityOverrides = useMemo<Record<string, number>>(
    () => ({
      ...(trimPreview ? { [trimPreview.targetEntityId]: 0.22 } : {}),
      ...(extendPreview
        ? {
            [extendPreview.targetEntityId]: 0.22,
            [extendPreview.boundaryEntityId]: 0.22,
          }
        : {}),
      ...(filletPreview
        ? {
            [filletPreview.firstEntityId]: 0.22,
            [filletPreview.secondEntityId]: 0.22,
          }
        : {}),
    }),
    [extendPreview, filletPreview, trimPreview],
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
        parcelLayout: parcelLayoutState,
        showParcelLabels,
      });
      if (
        current?.sourceSignature === nextState.sourceSignature &&
        buildCadProjectSignature(current.project) === buildCadProjectSignature(nextState.project) &&
        JSON.stringify(current.parcelLayout ?? null) === JSON.stringify(nextState.parcelLayout ?? null) &&
        (current?.showParcelLabels ?? true) === nextState.showParcelLabels
      ) {
        return current;
      }
      return nextState;
    });
  }, [cadProject, onPersistedStateChange, parcelLayoutState, projectSignature, showParcelLabels]);

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
    reportedComputation,
    propertiesPanelState,
    activeBatchCogoDraft,
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
    commandPreviewPrimitives: [
      ...commandPreviewPrimitives,
      ...trimPreviewPrimitives,
      ...extendPreviewPrimitives,
      ...filletPreviewPrimitives,
    ],
    commandEntityOpacityOverrides,
    commandExpectsPointPick,
    canUseActiveSnap,
    canCycleActiveSnap,
    canFinishCommand,
    canCloseTraverseDraft,
    canCreateIntersectionPoint: selectedIntersection != null,
    canCreateAlignment: selectedAlignmentDraft != null,
    canReportAlignmentStation:
      selectedEntities.length === 2 &&
      selectedAlignmentForStationing != null &&
      selectedSurveyPointForStationing != null,
    canCreateAlignmentOffset:
      selectedEntities.length === 1 && selectedAlignmentForStationing != null,
    canCreateAlignmentStationEquation:
      selectedEntities.length === 1 && selectedAlignmentForStationing != null,
    canCreateAlignmentOffsetPoint:
      selectedEntities.length === 1 && selectedAlignmentForStationing != null,
    canCreateAlignmentIntervalPoints:
      selectedEntities.length === 1 && selectedAlignmentForStationing != null,
    canCreateParcel: selectedParcelSource != null,
    canSplitParcelByBearing:
      selectedEntities.length === 1 && selectedEntities[0]?.type === 'parcel',
    canSplitParcelByArea:
      selectedEntities.length === 1 && selectedEntities[0]?.type === 'parcel',
    canReportParcelGap: selectedParcelsForOverlap.length >= 2,
    canReportParcelDiagnostics: selectedParcelDiagnosticLines.length > 0,
    canReportParcelOverlap: selectedParcelsForOverlap.length >= 2,
    canSplitParcelByLine: selectedParcelForSplit != null && selectedSplitLineForParcel != null,
    canContinueCurve: selectedArcForContinue != null,
    canTrimSelection: true,
    canExtendSelection: true,
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
    startBatchCogoCommand,
    startParcelSplitBearingCommand,
    startParcelSplitAreaCommand,
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
    startAreaCommand,
    startBearingReportCommand,
    startDistanceReportCommand,
    startTurnedPointCommand,
    startDeflectionPointCommand,
    startPointAlongLineCommand,
    startExtendLineCommand,
    startOffsetPointCommand,
    startAlignmentOffsetCreateCommand,
    startAlignmentStationEquationCommand,
    startAlignmentOffsetPointCommand,
    startAlignmentIntervalPointsCommand,
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
    startExtendCommand,
    startTrimCommand,
    startFilletCommand,
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
    createAlignmentFromSelection: () => {
      if (!selectedAlignmentDraft) return;
      applyHistoryUpdate((current) =>
        runCadCommand(current, {
          key: 'ALIGNMENT_CREATE',
          sourceEntityIds: selectedAlignmentDraft.sourceEntityIds,
        }),
      );
    },
    reportAlignmentStationFromSelection: () => {
      if (
        selectedEntities.length !== 2 ||
        !selectedAlignmentForStationing ||
        !selectedSurveyPointForStationing
      ) {
        return;
      }
      applyHistoryUpdate((current) =>
        runCadCommand(current, {
          key: 'ALIGNMENT_STATION_REPORT',
          alignmentEntityId: selectedAlignmentForStationing.id,
          pointEntityId: selectedSurveyPointForStationing.id,
        }),
      );
    },
    createParcelFromSelection: () => {
      if (!selectedParcelSource) return;
      applyHistoryUpdate((current) =>
        runCadCommand(current, {
          key: 'PARCEL_CREATE',
          sourceEntityIds: selectedParcelSource.sourceEntityIds,
        }),
      );
    },
    reportParcelGapFromSelection: () => {
      if (selectedParcelsForOverlap.length < 2) return;
      const diagnostics = cadBuildParcelGapDiagnostics(selectedParcelsForOverlap);
      const summary = !diagnostics.isSupported
        ? 'Selected parcels do not form one simple connected coverage for gap detection.'
        : diagnostics.gapLoops.length === 0
          ? `Checked ${diagnostics.exposedLoopCount} exposed loop${diagnostics.exposedLoopCount === 1 ? '' : 's'}. No enclosed gaps found.`
          : `Found ${diagnostics.gapLoops.length} enclosed gap loop${diagnostics.gapLoops.length === 1 ? '' : 's'} inside the selected parcel coverage.`;
      setReportedComputation(
        buildCadCogoComputation({
          createdEntities: [],
          report: {
            title: 'Parcel Gap Check',
            summary,
            rows: [
              { label: 'Parcels', value: diagnostics.parcelCount.toFixed(0) },
              { label: 'Components', value: diagnostics.componentCount.toFixed(0) },
              { label: 'Supported', value: diagnostics.isSupported ? 'Yes' : 'No' },
              { label: 'Exposed loops', value: diagnostics.exposedLoopCount.toFixed(0) },
              { label: 'Gap loops', value: diagnostics.gapLoops.length.toFixed(0) },
              {
                label: 'Total gap area',
                value: diagnostics.totalGapAreaSquareMeters.toFixed(3),
                unit: 'm2',
              },
              ...(
                diagnostics.gapLoops.length === 0
                  ? [{ label: 'Gaps', value: diagnostics.isSupported ? 'None' : 'Unsupported selection' }]
                  : diagnostics.gapLoops.flatMap((gap, index) => [
                      {
                        label: `Gap ${index + 1} Area`,
                        value: gap.areaSquareMeters.toFixed(3),
                        unit: 'm2',
                      },
                      {
                        label: `Gap ${index + 1} Center`,
                        value: `${gap.centroid.x.toFixed(3)}, ${gap.centroid.y.toFixed(3)}`,
                      },
                    ])
              ),
            ],
          },
          warnings: [],
          provenance: {
            id: `parcel-gap:${Date.now()}:${Math.random().toString(36).slice(2, 8)}`,
            toolKey: 'PARCEL_GAP',
            inputs: {
              parcelEntityIds: selectedParcelsForOverlap.map((entity) => entity.id),
            },
            resultSummary: summary,
            createdAtIso: new Date().toISOString(),
          },
        }),
      );
    },
    reportParcelDiagnosticsFromSelection: () => {
      if (selectedParcelDiagnosticLines.length === 0) return;
      const diagnostics = cadBuildParcelLineworkDiagnostics(selectedParcelDiagnosticLines);
      const openEnds = diagnostics.danglingNodes.map((node) => node.label).join(', ');
      const branchNodes = diagnostics.branchNodes.map((node) => node.label).join(', ');
      const overlapSummary = diagnostics.overlapSegments
        .map((segment) => `${segment.firstLabel}-${segment.secondLabel} x${segment.segmentCount}`)
        .join(', ');
      const summary = diagnostics.isClosedLoopCandidate
        ? 'Selected linework forms one closed parcel loop.'
        : `Selected linework has ${diagnostics.danglingNodes.length} open end${diagnostics.danglingNodes.length === 1 ? '' : 's'}, ${diagnostics.branchNodes.length} branch node${diagnostics.branchNodes.length === 1 ? '' : 's'}, and ${diagnostics.overlapSegments.length} overlap group${diagnostics.overlapSegments.length === 1 ? '' : 's'}.`;
      setReportedComputation(
        buildCadCogoComputation({
          createdEntities: [],
          report: {
            title: 'Parcel Linework Check',
            summary,
            rows: [
              {
                label: 'Status',
                value: diagnostics.isClosedLoopCandidate ? 'Closed loop ready for PARCEL' : 'Needs cleanup',
              },
              { label: 'Lines', value: diagnostics.lineCount.toFixed(0) },
              { label: 'Nodes', value: diagnostics.nodeCount.toFixed(0) },
              { label: 'Components', value: diagnostics.componentCount.toFixed(0) },
              { label: 'Open ends', value: openEnds || 'None' },
              { label: 'Branch nodes', value: branchNodes || 'None' },
              { label: 'Overlaps', value: overlapSummary || 'None' },
            ],
          },
          warnings: [],
          provenance: {
            id: `parcel-check:${Date.now()}:${Math.random().toString(36).slice(2, 8)}`,
            toolKey: 'PARCEL_CHECK',
            inputs: {
              sourceEntityIds: selectedParcelDiagnosticLines.map((entity) => entity.id),
            },
            resultSummary: summary,
            createdAtIso: new Date().toISOString(),
          },
        }),
      );
    },
    reportParcelOverlapFromSelection: () => {
      if (selectedParcelsForOverlap.length < 2) return;
      const diagnostics = cadBuildParcelOverlapDiagnostics(selectedParcelsForOverlap);
      const summary =
        diagnostics.overlapPairs.length === 0
          ? `Checked ${diagnostics.pairCount} parcel pair${diagnostics.pairCount === 1 ? '' : 's'}. No overlaps found.`
          : `Found ${diagnostics.overlapPairs.length} overlapping parcel pair${diagnostics.overlapPairs.length === 1 ? '' : 's'} across ${diagnostics.pairCount} checked pair${diagnostics.pairCount === 1 ? '' : 's'}.`;
      setReportedComputation(
        buildCadCogoComputation({
          createdEntities: [],
          report: {
            title: 'Parcel Overlap Check',
            summary,
            rows: [
              { label: 'Parcels', value: diagnostics.parcelCount.toFixed(0) },
              { label: 'Pairs checked', value: diagnostics.pairCount.toFixed(0) },
              { label: 'Overlap pairs', value: diagnostics.overlapPairs.length.toFixed(0) },
              {
                label: 'Total overlap',
                value: diagnostics.totalOverlapAreaSquareMeters.toFixed(3),
                unit: 'm2',
              },
              ...(
                diagnostics.overlapPairs.length === 0
                  ? [{ label: 'Pairs', value: 'None' }]
                  : diagnostics.overlapPairs.map((pair, index) => ({
                      label: `Pair ${index + 1}`,
                      value: `${pair.firstParcelName} x ${pair.secondParcelName}`,
                    }))
              ),
              ...diagnostics.overlapPairs.map((pair, index) => ({
                label: `Pair ${index + 1} Area`,
                value: pair.overlapAreaSquareMeters.toFixed(3),
                unit: 'm2',
              })),
            ],
          },
          warnings: [],
          provenance: {
            id: `parcel-overlap:${Date.now()}:${Math.random().toString(36).slice(2, 8)}`,
            toolKey: 'PARCEL_OVERLAP',
            inputs: {
              parcelEntityIds: selectedParcelsForOverlap.map((entity) => entity.id),
            },
            resultSummary: summary,
            createdAtIso: new Date().toISOString(),
          },
        }),
      );
    },
    splitParcelBySelectedLine: () => {
      if (!selectedParcelForSplit || !selectedSplitLineForParcel) return;
      applyHistoryUpdate((current) =>
        runCadCommand(current, {
          key: 'PARCEL_SPLIT',
          parcelEntityId: selectedParcelForSplit.id,
          splitLineEntityId: selectedSplitLineForParcel.id,
        }),
      );
    },
    commitParcelSlideLayout: ({
      parcelEntityId,
      frontageEntityId,
      frontageParcelSegmentIds,
      targetAreaSquareMeters,
      minFrontageMeters,
      alternative,
      settings,
    }) => {
      applyHistoryUpdate((current) =>
        runCadCommand(current, {
          key: 'PARCEL_SPLIT_SLIDE',
          parcelEntityId,
          frontageEntityId,
          frontageParcelSegmentIds,
          targetAreaSquareMeters,
          minFrontageMeters,
          alternative,
          settings,
        }),
      );
    },
    commitParcelSwingLayout: ({
      parcelEntityId,
      frontageEntityId,
      frontageParcelSegmentIds,
      targetAreaSquareMeters,
      minFrontageMeters,
      alternative,
      settings,
    }) => {
      applyHistoryUpdate((current) =>
        runCadCommand(current, {
          key: 'PARCEL_SPLIT_SWING',
          parcelEntityId,
          frontageEntityId,
          frontageParcelSegmentIds,
          targetAreaSquareMeters,
          minFrontageMeters,
          alternative,
          settings,
        }),
      );
    },
    commitParcelAutoLayout: ({
      parcelEntityId,
      frontageEntityId,
      frontageParcelSegmentIds,
      tool,
      settings,
    }) => {
      applyHistoryUpdate((current) =>
        runCadCommand(current, {
          key: 'PARCEL_LAYOUT_AUTO',
          parcelEntityId,
          frontageEntityId,
          frontageParcelSegmentIds,
          tool,
          settings,
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
    editPropertiesField,
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
    setBatchCogoInputValue,
    commitBatchCogoDraft,
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
            extendMode: options?.extendMode,
          },
        );
        return;
      }
      consumeInteractionPoint(worldPoint, label, {
        ...options,
        snapSourceSegmentId: options?.snapSourceSegmentId ?? commandHoverTarget?.segmentId,
        snapSourceEntityId: options?.snapSourceEntityId ?? commandHoverTarget?.entityId,
      });
    },
    handleEnterKey,
    handleEscapeKey,
    ...selectionActions,
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
