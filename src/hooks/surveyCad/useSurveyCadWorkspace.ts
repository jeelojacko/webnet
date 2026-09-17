import { useCallback, useEffect, useMemo, useRef, useState, type Dispatch, type SetStateAction } from 'react';
import { cadIntersectLineLikeEntities } from '../../engine/cad/cadCogo';
import { cloneCadDrawingDocument } from '../../engine/cad/cadDrawingFile';
import { buildMlightcadSpikeScene } from '../../engine/cad/cadMlightcadAdapter';
import { checkCadEntityEditable } from '../../engine/cad/cadAppearance';
import { buildCadDisplayScene } from '../../engine/cad/cadRenderer';
import type { LineweightDisplayMode } from '../../engine/cad/cadViewportAppearance';
import {
  filterCadDisplaySceneForViewport,
  viewportHiddenEntityIds,
} from '../../engine/cad/cadViewportAppearance';
import type { CadCogoComputation } from '../../engine/cad/cadCogoTypes';
import type { CadCommand } from '../../engine/cad/cadTransactions.types';
import { runCadCommand } from '../../engine/cad/cadUndoRedo';
import { editSurveyCadPropertiesField } from './surveyCadPropertiesEdit';
import { useSurveyCadSnapping, type CadSnapPreferences } from './useSurveyCadSnapping';
import { useSurveyCadSelectionDerivations } from './useSurveyCadSelectionDerivations';
import { useSurveyCadSelectionActions } from './useSurveyCadSelectionActions';
import { useSurveyCadWorkspaceActions } from './surveyCadWorkspaceActions';
import { buildSurveyCadWorkspaceParcelReports } from './surveyCadWorkspaceParcelReports';
import { useSurveyCadWorkspaceCommandController } from './useSurveyCadWorkspaceCommandController';
import { useSurveyCadWorkspaceHistory } from './useSurveyCadWorkspaceHistory';
import { useSurveyCadWorkspacePersistence } from './useSurveyCadWorkspacePersistence';
import { useSurveyCadWorkspacePreviews } from './useSurveyCadWorkspacePreviews';
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
} from '../../engine/cad/cadTypes';
import type { CadEntityId } from '../../engine/cad/cadTypes';
import { createCadSelectionState } from '../../engine/cad/cadSelection';
import { runFieldToFinishCommand } from '../../engine/fieldToFinish/regeneration';
import type { FieldToFinishCadPayload } from '../../engine/fieldToFinish/cadGeneration';

export const useSurveyCadWorkspace = (
  baseProject: CadProject,
  resetKey: string,
  onProjectChange: Dispatch<SetStateAction<import('../../engine/cad/cadTypes').CadDrawingDocument | null>>,
  drawing: import('../../engine/cad/cadTypes').CadDrawingDocument,
  parcelLayoutState: CadParcelLayoutUiState | undefined,
  showParcelLabels: boolean,
  reverseDirectionModifier = false,
  // Phase 18C LWT: workspace-only display preference (never dirties the
  // drawing or the stored mm value).
  lineweightDisplay: LineweightDisplayMode = 'thin',
): UseSurveyCadWorkspaceResult => {
  const { history, historyRef, applyHistoryUpdate: applyHistoryUpdateBase } = useSurveyCadWorkspaceHistory(
    baseProject,
    resetKey,
  );
  // Memoized so viewport effects (e.g. hidden-selection retirement) can depend on it.
  const applyHistoryUpdate = useCallback(
    (
      updater: (
        _history: import('../../engine/cad/cadUndoRedo').CadHistoryState,
      ) => import('../../engine/cad/cadUndoRedo').CadHistoryState,
    ) => {
      let nextProject: CadProject | null = null;
      applyHistoryUpdateBase((current) => {
        const next = updater(current);
        nextProject = next.present.project;
        return next;
      });
      if (!nextProject) return;
      onProjectChange((current) => {
        if (!current || current.drawingId !== drawing.drawingId) return current;
        return cloneCadDrawingDocument({
          ...current,
          updatedAt: new Date().toISOString(),
          project: nextProject!,
          parcelLayout: parcelLayoutState,
          showParcelLabels,
        });
      });
    },
    [applyHistoryUpdateBase, drawing.drawingId, onProjectChange, parcelLayoutState, showParcelLabels],
  );
  const cadProject = history.present.project;
  const selection = history.present.selection;
  const activeGripHandleRef = useRef<CadGripHandle | null>(null);

  // View-layer filter (spec §6): OFF/frozen-layer primitives hide at the
  // viewport consumer — never inside buildCadDisplayScene (export scene
  // needs hidden primitives). Unknown/missing layers default visible.
  const displayScene = useMemo(
    () =>
      filterCadDisplaySceneForViewport(
        cadProject,
        buildCadDisplayScene(cadProject, { lineweightDisplay }),
      ),
    [cadProject, lineweightDisplay],
  );
  // Retire selection of newly hidden ids so grips never float on invisible geometry.
  useEffect(() => {
    const hidden = viewportHiddenEntityIds(cadProject);
    if (!selection.selectedEntityIds.some((entityId) => hidden.has(entityId))) return;
    applyHistoryUpdate((current) => {
      const retired = viewportHiddenEntityIds(current.present.project);
      const visibleIds = current.present.selection.selectedEntityIds.filter(
        (entityId) => !retired.has(entityId),
      );
      if (visibleIds.length === current.present.selection.selectedEntityIds.length) {
        return current;
      }
      return {
        ...current,
        present: {
          ...current.present,
          selection: createCadSelectionState(current.present.project, visibleIds),
        },
      };
    });
  }, [applyHistoryUpdate, cadProject, selection.selectedEntityIds]);
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
  ): import('./surveyCadPropertiesEdit').CadPropertiesEditOutcome =>
    editSurveyCadPropertiesField({
      entityId,
      field,
      history: historyRef.current,
      updateHistory: applyHistoryUpdate,
      value,
    });
  /**
   * Phase 18C — dispatch one undoable command (LAYER_* family) through
   * history. Replaces the replaceActiveDrawing layer paths (undo-wipe +
   * selection-steal). Returns false when the command rejects.
   */
  const runLayerCommand = (command: CadCommand): boolean => {
    let applied = false;
    applyHistoryUpdate((current) => {
      const next = runCadCommand(current, command);
      applied = next !== current;
      return next;
    });
    return applied;
  };
  const [activeGripHandle, setActiveGripHandle] = useState<CadGripHandle | null>(null);
  const selectionActions = useSurveyCadSelectionActions({
    updateHistory: applyHistoryUpdate,
    setActiveGripHandle,
  });
  useEffect(() => {
    activeGripHandleRef.current = activeGripHandle;
  }, [activeGripHandle]);
  const editableSelectedEntity = useMemo(
    () => {
      if (
        selectedEntities.length !== 1 ||
        !['line', 'polyline', 'polygon', 'parcel', 'arc'].includes(selectedEntities[0]!.type)
      ) {
        return null;
      }
      // No grips on locked sources: grip edits route through the same gate.
      const candidate = selectedEntities[0]!;
      return checkCadEntityEditable(cadProject, candidate).editable ? candidate : null;
    },
    [cadProject, selectedEntities],
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
  const commandState = useSurveyCadWorkspaceCommandController({
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
    setSnapConstructionContext,
  });

  useEffect(() => {
    if (commandState.activeCommandKey === 'TRIM' || commandState.activeCommandKey === 'EXTEND' || commandState.activeCommandKey === 'FILLET') return;
    setCommandHoverTargetState(null);
  }, [commandState.activeCommandKey]);
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
  const {
    commandPreviewPrimitives,
    commandEntityOpacityOverrides,
    gripHandles,
    gripPreviewPrimitives,
  } = useSurveyCadWorkspacePreviews({
    activeCommandKey: commandState.activeCommandKey,
    activeExtendTarget: commandState.activeExtendTarget,
    activeFilletPreview: commandState.activeFilletPreview,
    activeGripHandle,
    activeTrimCuttingEntityIds: commandState.activeTrimCuttingEntityIds,
    cadProject,
    commandHoverTarget,
    commandPreview: commandState.commandPreview,
    displayPrimitives: displayScene.primitives,
    editableSelectedEntity,
    selectedEntityIds: selection.selectedEntityIds,
    setActiveGripHandle,
  });
  const selectedIntersection = useMemo(() => {
    if (selectedLineLikes.length !== 2) return null;
    return cadIntersectLineLikeEntities(selectedLineLikes[0], selectedLineLikes[1]);
  }, [selectedLineLikes]);
  useSurveyCadWorkspacePersistence({
    cadProject,
    drawing,
    onDrawingChange: onProjectChange,
    parcelLayoutState,
    showParcelLabels,
  });

  const parcelReportActions = buildSurveyCadWorkspaceParcelReports({
    selectedParcelDiagnosticLines,
    selectedParcelsForOverlap,
    setReportedComputation,
  });
  const workspaceActions = useSurveyCadWorkspaceActions({
    activeSnap,
    activeGripHandleRef,
    addTraverseDraftSideshot: commandState.addTraverseDraftSideshot,
    appendCommandInputValue: commandState.appendCommandInputValue,
    appendTraverseDraftPoint: commandState.appendTraverseDraftPoint,
    applyHistoryUpdate,
    applyTraverseDraftAdjustment: commandState.applyTraverseDraftAdjustment,
    backspaceCommandInputValue: commandState.backspaceCommandInputValue,
    cancelCommand: commandState.cancelCommand,
    canUseActiveSnap: commandState.canUseActiveSnap,
    clearTraverseDraftAdjustment: commandState.clearTraverseDraftAdjustment,
    closeTraverseDraftLoop: commandState.closeTraverseDraftLoop,
    commandHoverTarget,
    commitBatchCogoDraft: commandState.commitBatchCogoDraft,
    consumeInteractionPoint: commandState.consumeInteractionPoint,
    cycleActiveSnap,
    editPropertiesField,
    editTraverseDraftLeg: commandState.editTraverseDraftLeg,
    finishCommand: commandState.finishCommand,
    gripHandles,
    handleEnterKey: commandState.handleEnterKey,
    handleEscapeKey: commandState.handleEscapeKey,
    history,
    insertTraverseDraftLeg: commandState.insertTraverseDraftLeg,
    moveTraverseDraftLeg: commandState.moveTraverseDraftLeg,
    parcelReportActions,
    removeTraverseDraftSideshot: commandState.removeTraverseDraftSideshot,
    replaceTraverseDraftLeg: commandState.replaceTraverseDraftLeg,
    rewindTraverseDraftToPointCount: commandState.rewindTraverseDraftToPointCount,
    selectedAlignmentDraft,
    selectedAlignmentForStationing,
    selectedEntities,
    selectedIntersection,
    selectedLineLikes,
    selectedParcelForSplit,
    selectedParcelSource,
    selectedSplitLineForParcel,
    selectedSurveyPointForStationing,
    selectionActions,
    setActiveGripHandle,
    setBatchCogoInputValue: commandState.setBatchCogoInputValue,
    setCommandHoverTargetState,
    setCommandInputValue: commandState.setCommandInputValue,
    setSnapPreference,
    setTraverseDraftClosePoint: commandState.setTraverseDraftClosePoint,
    setTraverseDraftMode: commandState.setTraverseDraftMode,
    startPasteCommand: commandState.startPasteCommand,
    submitCommandInput: commandState.submitCommandInput,
    updatePointerWorldPoint,
    useActiveSnap: commandState.useActiveSnap,
  });

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
    activeBatchCogoDraft: commandState.activeBatchCogoDraft,
    activeTraverseDraft: commandState.activeTraverseDraft,
    selectionCount: selection.selectedEntityIds.length,
    canUndo: history.undoStack.length > 0,
    canRedo: history.redoStack.length > 0,
    canUseSelectedLineCoreCogo: selectedLineForCoreCogo != null,
    canUseSelectedLinePairIntersection: selectedLinePairForIntersection != null,
    canUseSelectedArcCurveCogo: selectedArcForContinue != null,
    activeCommandKey: commandState.activeCommandKey,
    commandInputValue: commandState.commandInputValue,
    statusText: commandState.commandPrompt,
    commandHelpText: commandState.commandHelpText,
    commandPreviewPrimitives,
    commandEntityOpacityOverrides,
    commandExpectsPointPick: commandState.commandExpectsPointPick,
    canUseActiveSnap: commandState.canUseActiveSnap,
    canCycleActiveSnap: commandState.canCycleActiveSnap,
    canFinishCommand: commandState.canFinishCommand,
    canCloseTraverseDraft: commandState.canCloseTraverseDraft,
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
    pointerWorldPoint,
    snapConstructionContext,
    snapPreferences,
    historyDepth: history.undoStack.length,
    redoDepth: history.redoStack.length,
    runLayerCommand,
    replaceCadProject: (project: CadProject, statusText = 'Drawing updated.') => {
      applyHistoryUpdate((current) => ({
        ...current,
        present: {
          project,
          selection: createCadSelectionState(project, project.entities[0] ? [project.entities[0].id] : []),
        },
        undoStack: [],
        redoStack: [],
        commandState: {
          key: 'IDLE',
          phase: 'idle',
          prompt: statusText,
        },
      }));
    },
    commitFieldToFinishPayload: (payload: FieldToFinishCadPayload) => {
      applyHistoryUpdate((current) => runFieldToFinishCommand(current, payload));
    },
    startPointCommand: commandState.startPointCommand,
    startCogoPointCommand: commandState.startCogoPointCommand,
    startLineCommand: commandState.startLineCommand,
    startPolylineCommand: commandState.startPolylineCommand,
    startTraverseCommand: commandState.startTraverseCommand,
    startBatchCogoCommand: commandState.startBatchCogoCommand,
    startParcelSplitBearingCommand: commandState.startParcelSplitBearingCommand,
    startParcelSplitAreaCommand: commandState.startParcelSplitAreaCommand,
    startArc3PointCommand: commandState.startArc3PointCommand,
    startArcStartCenterEndCommand: commandState.startArcStartCenterEndCommand,
    startArcCenterStartEndCommand: commandState.startArcCenterStartEndCommand,
    startArcStartCenterAngleCommand: commandState.startArcStartCenterAngleCommand,
    startArcCenterStartAngleCommand: commandState.startArcCenterStartAngleCommand,
    startArcStartCenterChordCommand: commandState.startArcStartCenterChordCommand,
    startArcCenterStartChordCommand: commandState.startArcCenterStartChordCommand,
    startArcStartEndAngleCommand: commandState.startArcStartEndAngleCommand,
    startArcStartEndDirectionCommand: commandState.startArcStartEndDirectionCommand,
    startArcStartEndRadiusCommand: commandState.startArcStartEndRadiusCommand,
    startContinueCurveCommand: commandState.startContinueCurveCommand,
    startTangentCurveCommand: commandState.startTangentCurveCommand,
    startInverseCommand: commandState.startInverseCommand,
    startMultiInverseCommand: commandState.startMultiInverseCommand,
    startAreaCommand: commandState.startAreaCommand,
    startBearingReportCommand: commandState.startBearingReportCommand,
    startDistanceReportCommand: commandState.startDistanceReportCommand,
    startTurnedPointCommand: commandState.startTurnedPointCommand,
    startDeflectionPointCommand: commandState.startDeflectionPointCommand,
    startPointAlongLineCommand: commandState.startPointAlongLineCommand,
    startExtendLineCommand: commandState.startExtendLineCommand,
    startOffsetPointCommand: commandState.startOffsetPointCommand,
    startAlignmentOffsetCreateCommand: commandState.startAlignmentOffsetCreateCommand,
    startAlignmentStationEquationCommand: commandState.startAlignmentStationEquationCommand,
    startAlignmentOffsetPointCommand: commandState.startAlignmentOffsetPointCommand,
    startAlignmentIntervalPointsCommand: commandState.startAlignmentIntervalPointsCommand,
    startCurveSolverCommand: commandState.startCurveSolverCommand,
    startRadialBearingCommand: commandState.startRadialBearingCommand,
    startPointOnCurveCommand: commandState.startPointOnCurveCommand,
    startSubdivideCurveCommand: commandState.startSubdivideCurveCommand,
    startOffsetCurveCommand: commandState.startOffsetCurveCommand,
    startPiCurveCommand: commandState.startPiCurveCommand,
    startChordBearingCurveCommand: commandState.startChordBearingCurveCommand,
    startReverseCurveCommand: commandState.startReverseCurveCommand,
    startCompoundCurveCommand: commandState.startCompoundCurveCommand,
    startBearingBearingIntersectionCommand: commandState.startBearingBearingIntersectionCommand,
    startBearingDistanceIntersectionCommand: commandState.startBearingDistanceIntersectionCommand,
    startDistanceDistanceIntersectionCommand: commandState.startDistanceDistanceIntersectionCommand,
    startLineCircleIntersectionCommand: commandState.startLineCircleIntersectionCommand,
    startPerpendicularIntersectionCommand: commandState.startPerpendicularIntersectionCommand,
    startOffsetIntersectionCommand: commandState.startOffsetIntersectionCommand,
    startSkewIntersectionCommand: commandState.startSkewIntersectionCommand,
    startMoveCommand: commandState.startMoveCommand,
    startCopyCommand: commandState.startCopyCommand,
    startExtendCommand: commandState.startExtendCommand,
    startTrimCommand: commandState.startTrimCommand,
    startFilletCommand: commandState.startFilletCommand,
    ...parcelReportActions,
    ...selectionActions,
    ...workspaceActions,
  };
};

