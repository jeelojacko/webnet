import { useCallback, useEffect, useMemo, useRef, useState, type Dispatch, type SetStateAction } from 'react';
import { cadIntersectLineLikeEntities } from '../../engine/cad/cadCogo';
import { cloneCadDrawingDocument } from '../../engine/cad/cadDrawingFile';
import { buildMlightcadSpikeScene } from '../../engine/cad/cadMlightcadAdapter';
import type { SurfaceContourDisplayInput } from '../../engine/cad/cadSurfaceView';
import { checkCadEntityEditable } from '../../engine/cad/cadAppearance';
import { buildCadDisplayScene } from '../../engine/cad/cadRenderer';
import type { CadSurfaceCache } from '../../engine/cad/cadSurfaceCache';
import type { LineweightDisplayMode } from '../../engine/cad/cadViewportAppearance';
import {
  filterCadDisplaySceneForViewport,
  viewportHiddenEntityIds,
} from '../../engine/cad/cadViewportAppearance';
import type { CadCogoComputation } from '../../engine/cad/cadCogoTypes';
import type { CadCommand } from '../../engine/cad/cadTransactions.types';
import { runCadCommand } from '../../engine/cad/cadUndoRedo';
import { commitBlockUiOp } from '../../cad-app/blocks/cadBlockUiCommands';
import {
  commitLandXmlImport,
  type LandXmlCommitReport,
  type LandXmlCommitSelection,
} from '../../engine/cad/cadLandxmlCommit';
import type { LandXmlImportPreview } from '../../engine/landxmlImport';
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
import { buildCadAnnotationSnapshot } from './surveyCadAnnotationSnapshot';
import { applyCadAnnotationUiOp, buildLeaderAnchorCommand } from './surveyCadAnnotationOps';
import type {
  CadAnnotationOpResult,
  CadAnnotationUiOp,
} from '../../cad-app/annotation/cadAnnotationUiTypes';
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
import type { FeatureCodeCatalog } from '../../engine/fieldToFinish/featureCatalog';
import type { FieldToFinishSettings } from '../../engine/fieldToFinish/catalogIo';
import { stampCatalogStaleStatus } from '../../engine/fieldToFinish/linkedSync';

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
  // Phase 18F: session mesh cache + built-revision index (both optional;
  // absent = definition-only surface display, e.g. sheet viewports).
  surfaceCache?: CadSurfaceCache,
  surfaceRevisionIndex?: ReadonlyMap<string, readonly string[]>,
  // Phase 18H: session contour sets (optional; absent = no contour
  // display). Version tag re-renders the scene on derivation state
  // changes; getter resolves the display input per surface.
  surfaceContourInputs?: {
    version: number;
    getContours: (_surfaceId: string) => SurfaceContourDisplayInput | null;
  },
  // Phase 18I: session volume cache (+ TIN cache for CURRENT gating).
  // Absent = no volume display. Version tag re-renders on volume state changes.
  surfaceVolumeInputs?: {
    version: number;
    tinCache: CadSurfaceCache;
    volumeCache: import('../../engine/cad/surfaceVolumeCache').CadSurfaceVolumeCache;
  },
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
        buildCadDisplayScene(cadProject, {
          lineweightDisplay,
          ...(surfaceCache ? { surfaceCache, ...(surfaceRevisionIndex ? { surfaceRevisionIndex } : {}) } : {}),
          ...(surfaceContourInputs
            ? {
                surfaceContours: (surfaceId: string) =>
                  surfaceContourInputs.getContours(surfaceId) ?? undefined,
              }
            : {}),
          ...(surfaceVolumeInputs
            ? {
                surfaceVolume: {
                  tinCache: surfaceVolumeInputs.tinCache,
                  volumeCache: surfaceVolumeInputs.volumeCache,
                },
              }
            : {}),
        }),
      ),
    [cadProject, lineweightDisplay, surfaceCache, surfaceRevisionIndex, surfaceContourInputs, surfaceVolumeInputs],
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
  /**
   * Phase 18M — route ONE staged LandXML preview through the atomic
   * deferred commit (single LANDXML_IMPORT transaction; the caller
   * schedules imported surfaces on the shared build queue). All-duplicate
   * payloads return an uncommitted report without touching history/dirty.
   */
  const runLandXmlImport = (
    preview: LandXmlImportPreview,
    fileName: string,
    selection: LandXmlCommitSelection,
  ): LandXmlCommitReport | null => {
    if (!surfaceCache) return null;
    const current = historyRef.current;
    const result = commitLandXmlImport(current, surfaceCache, preview, fileName, selection, {
      deferMeshBuild: true,
    });
    if (result.state !== current) {
      applyHistoryUpdate(() => result.state);
    }
    return result.report;
  };
  // Phase 18O annotation seam: live style/selected snapshot + one undoable
  // op entry per mutation (creates run through the command sessions).
  const annotationSnapshot = useMemo(
    () => buildCadAnnotationSnapshot(cadProject, selection.selectedEntityIds),
    [cadProject, selection.selectedEntityIds],
  );
  const runAnnotationOp = (op: CadAnnotationUiOp): CadAnnotationOpResult => {
    let outcome: CadAnnotationOpResult = { applied: false };
    applyHistoryUpdate((current) => {
      if (op.kind === 'leader-reattach' || op.kind === 'leader-convert-fixed') {
        const built = buildLeaderAnchorCommand(
          current.present.project,
          op.entityId,
          op.kind === 'leader-reattach' ? 'reattach' : 'fixed',
        );
        if ('reason' in built) {
          outcome = { applied: false, reason: built.reason };
          return current;
        }
        const next = runCadCommand(current, built.command);
        outcome = next !== current ? { applied: true } : { applied: false, reason: 'REJECTED' };
        return next;
      }
      const applied = applyCadAnnotationUiOp(current.present.project, op);
      if (!applied.applied) {
        outcome = { applied: false, reason: applied.reason };
        return current;
      }
      outcome = { applied: true };
      return runCadCommand(current, {
        key: 'ANNOTATION_COMMIT',
        project: applied.project,
        label: `ANNOTATION (${op.kind})`,
      });
    });
    return outcome;
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
        !['line', 'polyline', 'polygon', 'parcel', 'arc', 'block-reference'].includes(selectedEntities[0]!.type)
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
    runLandXmlImport,
    /**
     * Phase 18N — one block table/reference op as an undoable history
     * entry (interim seam: commitBlockUiOp mirrors runCadCommand
     * bookkeeping until real BLOCK_* transactions land).
     */
    runBlockOp: (op: import('../../cad-app/blocks/cadBlockUiCommands').CadBlockUiOp): {
      applied: boolean;
      reason?: string;
    } => {
      let outcome: { applied: boolean; reason?: string } = { applied: false };
      applyHistoryUpdate((current) => {
        const next = commitBlockUiOp(current, op);
        outcome = { applied: next.state !== current, reason: next.reason };
        return next.state;
      });
      return outcome;
    },
    /** Phase 18N — lazy-seed gate; returns definitions added. */
    ensureBlockSymbols: (): number => {
      let added = 0;
      applyHistoryUpdate((current) => {
        const before = current.present.project.blockDefinitions?.length ?? 0;
        const next = commitBlockUiOp(current, { kind: 'seed-symbols' });
        added = (next.project.blockDefinitions?.length ?? 0) - before;
        return next.state;
      });
      return added;
    },
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
    // Phase 18E — drawing-owned catalog/settings edits as ONE undoable
    // full-replace transaction through history (which also propagates to the
    // parent document, so later commands never clobber the edit).
    replaceFieldToFinishCatalog: (
      catalog: FeatureCodeCatalog,
      change: 'CATALOG_CHANGED' | 'FEATURE_METADATA_CHANGED' | null,
    ) => {
      applyHistoryUpdate((current) => {
        const withCatalog = { ...current.present.project, fieldToFinishCatalog: catalog };
        const stamped = change ? stampCatalogStaleStatus(withCatalog, change) : withCatalog;
        if (stamped === current.present.project) return current;
        return { ...current, present: { ...current.present, project: stamped } };
      });
    },
    updateFieldToFinishSettings: (settings: FieldToFinishSettings) => {
      applyHistoryUpdate((current) => ({
        ...current,
        present: {
          ...current.present,
          project: { ...current.present.project, fieldToFinishSettings: settings },
        },
      }));
    },
    startPointCommand: commandState.startPointCommand,
    startCogoPointCommand: commandState.startCogoPointCommand,
    startLineCommand: commandState.startLineCommand,
    startPolylineCommand: commandState.startPolylineCommand,
    startTraverseCommand: commandState.startTraverseCommand,
    startBatchCogoCommand: commandState.startBatchCogoCommand,
    startMTextCommand: commandState.startMTextCommand,
    startLeaderCommand: commandState.startLeaderCommand,
    startDimCommand: commandState.startDimCommand,
    startDimLinearCommand: commandState.startDimLinearCommand,
    startDimAlignedCommand: commandState.startDimAlignedCommand,
    startDimAngularCommand: commandState.startDimAngularCommand,
    startDimRadiusCommand: commandState.startDimRadiusCommand,
    startDimDiameterCommand: commandState.startDimDiameterCommand,
    startBearingLabelCommand: commandState.startBearingLabelCommand,
    startCurveLabelCommand: commandState.startCurveLabelCommand,
    annotationSnapshot,
    runAnnotationOp,
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
    startRotateCommand: commandState.startRotateCommand,
    startScaleCommand: commandState.startScaleCommand,
    startMirrorCommand: commandState.startMirrorCommand,
    startAlign2DCommand: commandState.startAlign2DCommand,
    startHelmert2DCommand: commandState.startHelmert2DCommand,
    startGridGroundCommand: commandState.startGridGroundCommand,
    startProjectTransformCommand: commandState.startProjectTransformCommand,
    helmertPanelState: commandState.helmertPanelState,
    gridGroundPanelState: commandState.gridGroundPanelState,
    projectTransformPanelState: commandState.projectTransformPanelState,
    submitTransformPanelText: commandState.submitTransformPanelText,
    setGridGroundPanelOrigin: commandState.setGridGroundPanelOrigin,
    setProjectTransformOrigin: commandState.setProjectTransformOrigin,
    startExtendCommand: commandState.startExtendCommand,
    startTrimCommand: commandState.startTrimCommand,
    startFilletCommand: commandState.startFilletCommand,
    ...parcelReportActions,
    ...selectionActions,
    ...workspaceActions,
  };
};

