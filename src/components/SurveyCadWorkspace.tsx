import React, { useEffect, useMemo, useRef, useState, type Dispatch, type SetStateAction } from 'react';
import type { AdjustmentResult, InstrumentLibrary, ParseOptions, UnitsMode } from '../types';
import { buildSurveyCadSpikeProject } from '../engine/cad/cadModel';
import { buildCadProjectSignature } from '../engine/cad/cadProjectState';
import type {
  CadBounds,
  CadParcelLayoutUiState,
  SurveyCadPersistedState,
} from '../engine/cad/cadTypes';
import { noteUiTabReady } from '../hooks/useUiPerfMonitor';
import { useSurveyCadWorkspace } from '../hooks/surveyCad/useSurveyCadWorkspace';
import SurveyCadBatchCogoPanel from './surveyCad/SurveyCadBatchCogoPanel';
import SurveyCadCommandLine from './surveyCad/SurveyCadCommandLine';
import SurveyCadCogoPanel from './surveyCad/SurveyCadCogoPanel';
import SurveyCadParcelLayoutPanel from './surveyCad/SurveyCadParcelLayoutPanel';
import SurveyCadPropertiesPanel from './surveyCad/SurveyCadPropertiesPanel';
import SurveyCadPreview from './surveyCad/SurveyCadPreview';
import SurveyCadTraverseDraftPanel from './surveyCad/SurveyCadTraverseDraftPanel';
import { useSurveyCadCommandDisplay } from './useSurveyCadCommandDisplay';
import { useSurveyCadFloatingPanels } from './useSurveyCadFloatingPanels';
import { useSurveyCadParcelLayoutWorkflow } from './useSurveyCadParcelLayoutWorkflow';
import { useSurveyCadWorkspaceKeyboard } from './useSurveyCadWorkspaceKeyboard';
import {
  DEFAULT_PARCEL_LAYOUT_SETTINGS,
  cloneParcelLayoutSettings,
  cloneParcelLayoutUiState,
  type ParcelLayoutAutoPreviewState,
  type ParcelLayoutPreviewState,
} from './surveyCadWorkspaceParcelLayout';

interface SurveyCadWorkspaceProps {
  input: string;
  instrumentLibrary: InstrumentLibrary;
  parseOptions: ParseOptions;
  units: UnitsMode;
  result: AdjustmentResult | null;
  persistedState?: SurveyCadPersistedState | null;
  onPersistedStateChange?: Dispatch<SetStateAction<SurveyCadPersistedState | null>>;
}

const SurveyCadWorkspace: React.FC<SurveyCadWorkspaceProps> = ({
  input,
  instrumentLibrary,
  parseOptions,
  units,
  result,
  persistedState = null,
  onPersistedStateChange = (_value) => null,
}) => {
  const cloneBounds = (bounds: CadBounds | null): CadBounds | null =>
    bounds
      ? {
          minX: bounds.minX,
          minY: bounds.minY,
          maxX: bounds.maxX,
          maxY: bounds.maxY,
        }
      : null;

  useEffect(() => {
    noteUiTabReady('survey-cad');
  }, []);

  const cadProject = useMemo(
    () =>
      buildSurveyCadSpikeProject({
        input,
        instrumentLibrary,
        parseOptions,
        units,
        result,
      }),
    [input, instrumentLibrary, parseOptions, result, units],
  );
  const [viewport, setViewport] = useState({ zoom: 1, panX: 0, panY: 0 });
  const [viewBounds, setViewBounds] = useState<CadBounds | null>(() => cloneBounds(cadProject.bounds));
  const [parcelLayoutState, setParcelLayoutState] = useState<CadParcelLayoutUiState>(() =>
    cloneParcelLayoutUiState(persistedState?.parcelLayout),
  );
  const [parcelLayoutPreviewState, setParcelLayoutPreviewState] = useState<ParcelLayoutPreviewState | null>(null);
  const [parcelLayoutAutoPreviewState, setParcelLayoutAutoPreviewState] =
    useState<ParcelLayoutAutoPreviewState | null>(null);
  const [parcelLayoutAutoTool, setParcelLayoutAutoTool] = useState<'slide' | 'swing'>('slide');
  const [parcelLayoutFrontageSegmentSelectionActive, setParcelLayoutFrontageSegmentSelectionActive] =
    useState(false);
  const [parcelLayoutFrontageSegmentSelectionIds, setParcelLayoutFrontageSegmentSelectionIds] = useState<string[]>([]);
  const [showParcelLabels, setShowParcelLabels] = useState<boolean>(
    () => persistedState?.showParcelLabels ?? true,
  );
  const [copiedEntityIds, setCopiedEntityIds] = useState<string[]>([]);
  const [reverseDirectionModifier, setReverseDirectionModifier] = useState(false);
  const [editingTraverseLegIndex, setEditingTraverseLegIndex] = useState<number | null>(null);
  const [editingTraverseLegInput, setEditingTraverseLegInput] = useState('');
  const [insertingTraverseLegIndex, setInsertingTraverseLegIndex] = useState<number | null>(null);
  const [insertingTraverseLegInput, setInsertingTraverseLegInput] = useState('');
  const [newTraverseLegInput, setNewTraverseLegInput] = useState('');
  const [newTraverseSideshotOccupyIndex, setNewTraverseSideshotOccupyIndex] = useState(1);
  const [newTraverseSideshotInput, setNewTraverseSideshotInput] = useState('');
  const {
    cadProject: activeProject,
    displayScene,
    gripHandles,
    gripPreviewPrimitives,
    activeGripHandleId,
    selectedEntityIds,
    selectedEntities,
    selectedParcelReport,
    reportedComputation,
    propertiesPanelState,
    activeBatchCogoDraft,
    activeTraverseDraft,
    selectionCount,
    canUndo,
    canRedo,
    canUseSelectedLineCoreCogo,
    canUseSelectedLinePairIntersection,
    canUseSelectedArcCurveCogo,
    activeCommandKey,
    commandInputValue,
    statusText,
    commandHelpText,
    commandPreviewPrimitives,
    commandEntityOpacityOverrides,
    commandExpectsPointPick,
    canCloseTraverseDraft,
    canFinishCommand,
    canCreateIntersectionPoint,
    canCreateAlignment,
    canReportAlignmentStation,
    canCreateAlignmentOffset,
    canCreateAlignmentStationEquation,
    canCreateAlignmentOffsetPoint,
    canCreateAlignmentIntervalPoints,
    canCreateParcel,
    canSplitParcelByBearing,
    canSplitParcelByArea,
    canReportParcelGap,
    canReportParcelDiagnostics,
    canReportParcelOverlap,
    canSplitParcelByLine,
    canContinueCurve,
    canTrimSelection,
    canExtendSelection,
    isGripEditing,
    canCycleActiveSnap,
    activeSnap,
    nearbySnaps,
    snapConstructionContext,
    snapPreferences,
    historyDepth,
    redoDepth,
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
    createIntersectionPoint,
    createAlignmentFromSelection,
    reportAlignmentStationFromSelection,
    createParcelFromSelection,
    reportParcelGapFromSelection,
    reportParcelDiagnosticsFromSelection,
    reportParcelOverlapFromSelection,
    splitParcelBySelectedLine,
    commitParcelSlideLayout,
    commitParcelSwingLayout,
    commitParcelAutoLayout,
    setCommandInputValue,
    appendCommandInputValue,
    backspaceCommandInputValue,
    consumeInteractionPoint,
    handleEnterKey,
    handleEscapeKey,
    appendTraverseDraftPoint,
    insertTraverseDraftLeg,
    moveTraverseDraftLeg,
    applyTraverseDraftAdjustment,
    clearTraverseDraftAdjustment,
    replaceTraverseDraftLeg,
    setTraverseDraftMode,
    setTraverseDraftClosePoint,
    addTraverseDraftSideshot,
    removeTraverseDraftSideshot,
    rewindTraverseDraftToPointCount,
    closeTraverseDraftLoop,
    setBatchCogoInputValue,
    commitBatchCogoDraft,
    selectEntity,
    selectEntities,
    editPropertiesField,
    startGripEdit,
    updateGripEdit,
    finishGripEdit,
    cancelGripEdit,
    updatePointerWorldPoint,
    setCommandHoverTarget,
    cycleActiveSnap,
    setSnapPreference,
    selectAll,
    clearSelection,
    eraseSelection,
    startPasteFromClipboard,
    undo,
    redo,
  } = useSurveyCadWorkspace(
    cadProject,
    persistedState,
    onPersistedStateChange,
    parcelLayoutState,
    showParcelLabels,
    reverseDirectionModifier,
  );
  const copiedEntityIdsRef = useRef<string[]>([]);
  const parcelLayoutHydrationKeyRef = useRef<string | null>(null);
  const selectedTraverseClosePoint =
    selectedEntities.length === 1 && selectedEntities[0]?.type === 'survey-point'
      ? selectedEntities[0]
      : null;

  useEffect(() => {
    copiedEntityIdsRef.current = copiedEntityIds;
  }, [copiedEntityIds]);

  useEffect(() => {
    const hydrationKey =
      persistedState == null
        ? 'null'
        : `${persistedState.sourceSignature}:${buildCadProjectSignature(persistedState.project)}`;
    if (parcelLayoutHydrationKeyRef.current === hydrationKey) return;
    parcelLayoutHydrationKeyRef.current = hydrationKey;
    setParcelLayoutState(cloneParcelLayoutUiState(persistedState?.parcelLayout));
    setShowParcelLabels(persistedState?.showParcelLabels ?? true);
  }, [persistedState]);

  const displaySceneWithParcelLabelToggle = useMemo(
    () =>
      showParcelLabels
        ? displayScene
        : {
            ...displayScene,
            primitives: displayScene.primitives.filter(
              (primitive) => primitive.kind !== 'text' || !primitive.id.endsWith(':parcel-label'),
            ),
        },
    [displayScene, showParcelLabels],
  );
  const reportedComputationEntities = useMemo(
    () =>
      reportedComputation
        ? activeProject.entities.filter((entity) => reportedComputation.createdEntityIds.includes(entity.id))
        : [],
    [activeProject.entities, reportedComputation],
  );

  useEffect(() => {
    if (!activeTraverseDraft || editingTraverseLegIndex == null) {
      if (editingTraverseLegIndex != null) {
        setEditingTraverseLegIndex(null);
        setEditingTraverseLegInput('');
      }
      return;
    }
    if (editingTraverseLegIndex >= activeTraverseDraft.legs.length) {
      setEditingTraverseLegIndex(null);
      setEditingTraverseLegInput('');
    }
  }, [activeTraverseDraft, editingTraverseLegIndex]);

  useEffect(() => {
    if (!activeTraverseDraft || insertingTraverseLegIndex == null) {
      if (insertingTraverseLegIndex != null) {
        setInsertingTraverseLegIndex(null);
        setInsertingTraverseLegInput('');
      }
      return;
    }
    if (insertingTraverseLegIndex > activeTraverseDraft.legs.length) {
      setInsertingTraverseLegIndex(null);
      setInsertingTraverseLegInput('');
    }
  }, [activeTraverseDraft, insertingTraverseLegIndex]);

  useEffect(() => {
    if (!activeTraverseDraft) {
      setInsertingTraverseLegIndex(null);
      setInsertingTraverseLegInput('');
      setNewTraverseLegInput('');
      setNewTraverseSideshotOccupyIndex(1);
      setNewTraverseSideshotInput('');
      return;
    }
    if (activeTraverseDraft.points.length <= 1) {
      setNewTraverseSideshotOccupyIndex(1);
      return;
    }
    setNewTraverseSideshotOccupyIndex((current) =>
      Math.min(Math.max(current, 1), activeTraverseDraft.points.length - 1),
    );
  }, [activeTraverseDraft]);

  const startTraverseLegEdit = (legIndex: number) => {
    const leg = activeTraverseDraft?.legs[legIndex];
    if (!leg) return;
    setEditingTraverseLegIndex(legIndex);
    setEditingTraverseLegInput(leg.inputValue);
  };

  const cancelTraverseLegEdit = () => {
    setEditingTraverseLegIndex(null);
    setEditingTraverseLegInput('');
  };

  const applyTraverseLegEdit = () => {
    if (editingTraverseLegIndex == null) return;
    const nextValue = editingTraverseLegInput.trim();
    if (nextValue.length === 0) return;
    if (replaceTraverseDraftLeg(editingTraverseLegIndex, nextValue)) {
      setEditingTraverseLegIndex(null);
      setEditingTraverseLegInput('');
    }
  };

  const appendTraverseLegFromPanel = () => {
    const nextValue = newTraverseLegInput.trim();
    if (nextValue.length === 0) return;
    if (appendTraverseDraftPoint(nextValue)) {
      setNewTraverseLegInput('');
    }
  };

  const startTraverseLegInsert = (legIndex: number) => {
    setEditingTraverseLegIndex(null);
    setEditingTraverseLegInput('');
    setInsertingTraverseLegIndex(legIndex);
    setInsertingTraverseLegInput('');
  };

  const cancelTraverseLegInsert = () => {
    setInsertingTraverseLegIndex(null);
    setInsertingTraverseLegInput('');
  };

  const applyTraverseLegInsert = () => {
    if (insertingTraverseLegIndex == null) return;
    const nextValue = insertingTraverseLegInput.trim();
    if (nextValue.length === 0) return;
    if (insertTraverseDraftLeg(insertingTraverseLegIndex, nextValue)) {
      setInsertingTraverseLegIndex(null);
      setInsertingTraverseLegInput('');
    }
  };

  const nudgeTraverseLeg = (legIndex: number, direction: -1 | 1) => {
    if (moveTraverseDraftLeg(legIndex, direction)) {
      setEditingTraverseLegIndex(null);
      setEditingTraverseLegInput('');
      setInsertingTraverseLegIndex(null);
      setInsertingTraverseLegInput('');
    }
  };

  const applyTraverseSideshot = () => {
    if (newTraverseSideshotInput.trim().length === 0) return;
    if (addTraverseDraftSideshot(newTraverseSideshotOccupyIndex, newTraverseSideshotInput.trim())) {
      setNewTraverseSideshotInput('');
    }
  };

  const {
    commandInputPlaceholder,
    commandModifierHint,
    commandStatusText,
    constructionHint,
  } = useSurveyCadCommandDisplay({
    activeCommandKey,
    reverseDirectionModifier,
    snapConstructionContext,
    snapPreferences,
    statusText,
  });

  const {
    dockedPanelOffsets,
    isParcelLayoutDragging,
    isPropertiesPanelDragging,
    parcelLayoutResizeDirection,
    propertiesPanelUiState,
    setParcelLayoutDock,
    setPropertiesPanelDock,
    startParcelLayoutDrag,
    startParcelLayoutResize,
    startPropertiesPanelDrag,
    toggleParcelLayoutPanel,
    togglePropertiesPanelCollapsed,
  } = useSurveyCadFloatingPanels({
    parcelLayoutState,
    setParcelLayoutState,
    propertiesPanelVisible: propertiesPanelState != null,
  });
  const {
    autoLayoutToolTitle,
    canAcceptParcelLayoutPreview,
    canCreateAllParcelLayout,
    canPreviewAllParcelLayout,
    canPreviewParcelSlideOrSwing,
    canRunAutoLayoutTool,
    canRunPrimaryParcelLayoutCreate,
    canSplitParcelBySlideOrSwing,
    canUseCurrentSelectionAsFrontage,
    canUseCurrentSelectionAsParent,
    canUseParcelFrontageSegments,
    effectiveParcelLayoutParentEntity,
    frontageSegmentActionTitle,
    hasParcelLayoutPreview,
    mergedCommandPreviewPrimitives,
    parcelLayoutFrontageLabel,
    parcelLayoutPreviewDetails,
    parcelLayoutPreviewStatus,
    acceptFrontageSegmentSelection,
    acceptParcelLayoutPreview,
    cancelFrontageSegmentSelection,
    createPrimaryParcelLayout,
    cycleParcelLayoutPreviewAlternative,
    previewAllParcelLayout,
    previewParcelLayoutSplit,
    createAllParcelLayout,
    runAutoLayoutTool,
    splitParcelBySlide,
    splitParcelBySwing,
    startFrontageSegmentSelection,
    toggleFrontageSegmentSelection,
    updateParcelLayoutState,
    useSelectedFrontageEntity,
    useSelectedParentParcel,
  } = useSurveyCadParcelLayoutWorkflow({
    activeProject,
    commandPreviewPrimitives,
    selectedEntities,
    canCreateParcel,
    createParcelFromSelection,
    commitParcelSlideLayout,
    commitParcelSwingLayout,
    commitParcelAutoLayout,
    parcelLayoutState,
    setParcelLayoutState,
    parcelLayoutPreviewState,
    setParcelLayoutPreviewState,
    parcelLayoutAutoPreviewState,
    setParcelLayoutAutoPreviewState,
    parcelLayoutAutoTool,
    setParcelLayoutAutoTool,
    parcelLayoutFrontageSegmentSelectionActive,
    setParcelLayoutFrontageSegmentSelectionActive,
    parcelLayoutFrontageSegmentSelectionIds,
    setParcelLayoutFrontageSegmentSelectionIds,
  });
  useEffect(() => {
    setViewport({ zoom: 1, panX: 0, panY: 0 });
    setViewBounds(cloneBounds(cadProject.bounds));
  }, [cadProject.bounds, cadProject.id]);

  useSurveyCadWorkspaceKeyboard({
    activeCommandKey,
    appendCommandInputValue,
    backspaceCommandInputValue,
    canCycleActiveSnap,
    clearSelection,
    copiedEntityIds,
    copiedEntityIdsRef,
    cycleActiveSnap,
    eraseSelection,
    handleEnterKey,
    handleEscapeKey,
    isGripEditing,
    nearbySnapCount: nearbySnaps.length,
    redo,
    selectedEntityIds,
    selectionCount,
    setCopiedEntityIds,
    setReverseDirectionModifier,
    startPasteFromClipboard,
    undo,
  });

  return (
    <div className="h-full min-h-0 overflow-hidden bg-slate-950 text-slate-100" data-survey-cad-dedicated-page>
      <div className="relative h-full min-h-0 bg-slate-950">
        <div className="absolute left-3 right-3 top-3 z-30 overflow-visible px-2 py-1.5" data-survey-cad-toolbar-overlay>
          <div>
            <SurveyCadCommandLine
              entityCount={activeProject.entities.length}
              selectionCount={selectionCount}
              canUndo={canUndo}
              canRedo={canRedo}
              historyDepth={historyDepth}
              redoDepth={redoDepth}
              canUseSelectedLineCoreCogo={canUseSelectedLineCoreCogo}
              canUseSelectedLinePairIntersection={canUseSelectedLinePairIntersection}
              canUseSelectedArcCurveCogo={canUseSelectedArcCurveCogo}
              canCreateIntersectionPoint={canCreateIntersectionPoint}
              canCreateAlignment={canCreateAlignment}
              canReportAlignmentStation={canReportAlignmentStation}
              canCreateAlignmentOffset={canCreateAlignmentOffset}
              canCreateAlignmentStationEquation={canCreateAlignmentStationEquation}
              canCreateAlignmentOffsetPoint={canCreateAlignmentOffsetPoint}
              canCreateAlignmentIntervalPoints={canCreateAlignmentIntervalPoints}
              canCreateParcel={canCreateParcel}
              canSplitParcelByBearing={canSplitParcelByBearing}
              canSplitParcelByArea={canSplitParcelByArea}
              canReportParcelGap={canReportParcelGap}
              canReportParcelDiagnostics={canReportParcelDiagnostics}
              canReportParcelOverlap={canReportParcelOverlap}
              canSplitParcelByLine={canSplitParcelByLine}
              canContinueCurve={canContinueCurve}
              canExtendSelection={canExtendSelection}
              onStartPoint={startPointCommand}
              onStartCogoPoint={startCogoPointCommand}
              onStartLine={startLineCommand}
              onStartPolyline={startPolylineCommand}
              onStartTraverse={startTraverseCommand}
              onStartBatchCogo={startBatchCogoCommand}
              onStartParcelSplitBearing={startParcelSplitBearingCommand}
              onStartParcelSplitArea={startParcelSplitAreaCommand}
              onStartArc3Point={startArc3PointCommand}
              onStartArcStartCenterEnd={startArcStartCenterEndCommand}
              onStartArcCenterStartEnd={startArcCenterStartEndCommand}
              onStartArcStartCenterAngle={startArcStartCenterAngleCommand}
              onStartArcCenterStartAngle={startArcCenterStartAngleCommand}
              onStartArcStartCenterChord={startArcStartCenterChordCommand}
              onStartArcCenterStartChord={startArcCenterStartChordCommand}
              onStartArcStartEndAngle={startArcStartEndAngleCommand}
              onStartArcStartEndDirection={startArcStartEndDirectionCommand}
              onStartArcStartEndRadius={startArcStartEndRadiusCommand}
              onStartContinueCurve={startContinueCurveCommand}
              onStartTangentCurve={startTangentCurveCommand}
              onStartInverse={startInverseCommand}
              onStartMultiInverse={startMultiInverseCommand}
              onStartArea={startAreaCommand}
              onStartBearingReport={startBearingReportCommand}
              onStartDistanceReport={startDistanceReportCommand}
              onStartTurnedPoint={startTurnedPointCommand}
              onStartDeflectionPoint={startDeflectionPointCommand}
              onStartPointAlongLine={startPointAlongLineCommand}
              onStartExtendLine={startExtendLineCommand}
              onStartOffsetPoint={startOffsetPointCommand}
              onStartAlignmentOffsetCreate={startAlignmentOffsetCreateCommand}
              onStartAlignmentStationEquation={startAlignmentStationEquationCommand}
              onStartAlignmentOffsetPoint={startAlignmentOffsetPointCommand}
              onStartAlignmentIntervalPoints={startAlignmentIntervalPointsCommand}
              onStartCurveSolver={startCurveSolverCommand}
              onStartRadialBearing={startRadialBearingCommand}
              onStartPointOnCurve={startPointOnCurveCommand}
              onStartSubdivideCurve={startSubdivideCurveCommand}
              onStartOffsetCurve={startOffsetCurveCommand}
              onStartPiCurve={startPiCurveCommand}
              onStartChordBearingCurve={startChordBearingCurveCommand}
              onStartReverseCurve={startReverseCurveCommand}
              onStartCompoundCurve={startCompoundCurveCommand}
              onStartBearingBearingIntersection={startBearingBearingIntersectionCommand}
              onStartBearingDistanceIntersection={startBearingDistanceIntersectionCommand}
              onStartDistanceDistanceIntersection={startDistanceDistanceIntersectionCommand}
              onStartLineCircleIntersection={startLineCircleIntersectionCommand}
              onStartPerpendicularIntersection={startPerpendicularIntersectionCommand}
              onStartOffsetIntersection={startOffsetIntersectionCommand}
              onStartSkewIntersection={startSkewIntersectionCommand}
              onStartMove={startMoveCommand}
              onStartCopy={startCopyCommand}
              onStartExtend={startExtendCommand}
              onStartTrim={startTrimCommand}
              onStartFillet={startFilletCommand}
              onCreateIntersectionPoint={createIntersectionPoint}
              onCreateAlignment={createAlignmentFromSelection}
              onReportAlignmentStation={reportAlignmentStationFromSelection}
              onCreateParcel={createPrimaryParcelLayout}
              onReportParcelGap={reportParcelGapFromSelection}
              onReportParcelDiagnostics={reportParcelDiagnosticsFromSelection}
              onReportParcelOverlap={reportParcelOverlapFromSelection}
              canSplitParcelBySlide={canSplitParcelBySlideOrSwing}
              canSplitParcelBySwing={canSplitParcelBySlideOrSwing}
              onSplitParcelBySlide={splitParcelBySlide}
              onSplitParcelBySwing={splitParcelBySwing}
              onSplitParcelByLine={splitParcelBySelectedLine}
              onToggleParcelLayoutPanel={toggleParcelLayoutPanel}
              canTrimSelection={canTrimSelection}
              onSelectAll={selectAll}
              onClearSelection={clearSelection}
              onErase={eraseSelection}
              onUndo={undo}
              onRedo={redo}
            />
          </div>
        </div>
        <div className="h-full">
          {isParcelLayoutDragging || parcelLayoutResizeDirection || isPropertiesPanelDragging ? (
            <div
              className={`fixed inset-0 z-[39] ${
                isPropertiesPanelDragging || isParcelLayoutDragging
                  ? 'cursor-move'
                  : parcelLayoutResizeDirection === 'right'
                  ? 'cursor-ew-resize'
                  : parcelLayoutResizeDirection === 'bottom'
                    ? 'cursor-ns-resize'
                    : parcelLayoutResizeDirection === 'corner'
                      ? 'cursor-nwse-resize'
                      : 'cursor-move'
              }`}
              data-survey-cad-parcel-layout-drag-shield
            />
          ) : null}
          {propertiesPanelState ? (
            <SurveyCadPropertiesPanel
              panelState={propertiesPanelState}
              selectedParcelReport={selectedParcelReport}
              dock={propertiesPanelUiState.dock}
              dockOffsetPx={dockedPanelOffsets.properties}
              floatingLeftPx={propertiesPanelUiState.floatingLeftPx}
              floatingTopPx={propertiesPanelUiState.floatingTopPx}
              collapsed={propertiesPanelUiState.collapsed}
              onSetDock={setPropertiesPanelDock}
              onToggleCollapsed={togglePropertiesPanelCollapsed}
              onClose={() => clearSelection()}
              onStartDrag={startPropertiesPanelDrag}
              onSelectEntity={(entityId) => selectEntity(entityId)}
              onEditField={editPropertiesField}
            />
          ) : null}
          {reportedComputation ? (
            <SurveyCadCogoPanel
              computation={reportedComputation}
              createdEntities={reportedComputationEntities}
              sourceLabel="latest"
            />
          ) : null}
          {parcelLayoutState.open ? (
            <SurveyCadParcelLayoutPanel
              state={parcelLayoutState}
              parentParcelName={effectiveParcelLayoutParentEntity?.parcelName ?? null}
              frontageLabel={parcelLayoutFrontageLabel}
              previewStatus={parcelLayoutPreviewStatus}
              previewDetails={parcelLayoutPreviewDetails}
              hasPreview={hasParcelLayoutPreview}
              canAcceptPreview={canAcceptParcelLayoutPreview}
              canPreviewLayout={canPreviewParcelSlideOrSwing}
              canUseCurrentSelectionAsParent={canUseCurrentSelectionAsParent}
              canUseCurrentSelectionAsFrontage={canUseCurrentSelectionAsFrontage}
              canUseParcelFrontageSegments={canUseParcelFrontageSegments}
              isSelectingFrontageSegments={parcelLayoutFrontageSegmentSelectionActive}
              onClose={() => updateParcelLayoutState((current) => ({ ...current, open: false }))}
              onToggleCollapsed={() => updateParcelLayoutState((current) => ({ ...current, collapsed: !current.collapsed }))}
              onSetDock={setParcelLayoutDock}
              dockOffsetPx={dockedPanelOffsets['parcel-layout']}
              onStartDrag={startParcelLayoutDrag}
              onStartResize={startParcelLayoutResize}
              onUseSelectedParent={useSelectedParentParcel}
              onUseSelectedFrontage={useSelectedFrontageEntity}
              onStartFrontageSegmentSelection={startFrontageSegmentSelection}
              onAcceptFrontageSegmentSelection={acceptFrontageSegmentSelection}
              onCancelFrontageSegmentSelection={cancelFrontageSegmentSelection}
              onClearParent={() => updateParcelLayoutState((current) => ({
                ...current,
                activeParentParcelId: null,
                activeFrontageParcelSegmentIds: null,
              }))}
              onClearFrontage={() => updateParcelLayoutState((current) => ({
                ...current,
                activeFrontageEntityId: null,
                activeFrontageParcelSegmentIds: null,
              }))}
              onUpdateSettings={(settings) => updateParcelLayoutState((current) => ({ ...current, settings }))}
              onResetSettings={() => updateParcelLayoutState((current) => ({
                ...current,
                settings: cloneParcelLayoutSettings(DEFAULT_PARCEL_LAYOUT_SETTINGS),
              }))}
              onCreateParcel={createPrimaryParcelLayout}
              onSplitByLine={splitParcelBySelectedLine}
              onSplitByBearing={startParcelSplitBearingCommand}
              onSplitByArea={startParcelSplitAreaCommand}
              onPreviewSlide={() => previewParcelLayoutSplit('slide')}
              onPreviewSwing={() => previewParcelLayoutSplit('swing')}
              onAutoLayout={runAutoLayoutTool}
              onCyclePreviewAlternative={cycleParcelLayoutPreviewAlternative}
              onAcceptPreview={acceptParcelLayoutPreview}
              onRejectPreview={() => {
                setParcelLayoutPreviewState(null);
                setParcelLayoutAutoPreviewState(null);
              }}
              onPreviewAll={previewAllParcelLayout}
              onCreateAll={createAllParcelLayout}
              onReportGap={reportParcelGapFromSelection}
              onReportCheck={reportParcelDiagnosticsFromSelection}
              onReportOverlap={reportParcelOverlapFromSelection}
              canPreviewAll={canPreviewAllParcelLayout}
              canCreateAll={canCreateAllParcelLayout}
              canCreateParcel={canRunPrimaryParcelLayoutCreate}
              canSplitByLine={canSplitParcelByLine}
              canSplitByBearing={canSplitParcelByBearing}
              canSplitByArea={canSplitParcelByArea}
              canAutoLayout={canRunAutoLayoutTool}
              canReportGap={canReportParcelGap}
              canReportCheck={canReportParcelDiagnostics}
              canReportOverlap={canReportParcelOverlap}
              autoToolTitle={autoLayoutToolTitle}
              frontageSegmentActionTitle={frontageSegmentActionTitle}
            />
          ) : null}
          {activeBatchCogoDraft ? (
            <SurveyCadBatchCogoPanel
              draft={activeBatchCogoDraft}
              onInputChange={setBatchCogoInputValue}
              onCommit={commitBatchCogoDraft}
              onCancel={handleEscapeKey}
            />
          ) : null}          {activeTraverseDraft ? (
            <SurveyCadTraverseDraftPanel
              draft={activeTraverseDraft}
              selectedClosePoint={selectedTraverseClosePoint}
              canCloseTraverseDraft={canCloseTraverseDraft}
              canFinishCommand={canFinishCommand}
              editingLegIndex={editingTraverseLegIndex}
              editingLegInput={editingTraverseLegInput}
              insertingLegIndex={insertingTraverseLegIndex}
              insertingLegInput={insertingTraverseLegInput}
              newLegInput={newTraverseLegInput}
              newSideshotOccupyIndex={newTraverseSideshotOccupyIndex}
              newSideshotInput={newTraverseSideshotInput}
              onSetMode={setTraverseDraftMode}
              onSetClosePoint={setTraverseDraftClosePoint}
              onRewindToPointCount={rewindTraverseDraftToPointCount}
              onCloseLoop={closeTraverseDraftLoop}
              onFinish={handleEnterKey}
              onCancel={handleEscapeKey}
              onNewLegInputChange={setNewTraverseLegInput}
              onAppendLeg={appendTraverseLegFromPanel}
              onStartInsertLeg={startTraverseLegInsert}
              onInsertLegInputChange={setInsertingTraverseLegInput}
              onApplyInsertLeg={applyTraverseLegInsert}
              onCancelInsertLeg={cancelTraverseLegInsert}
              onStartEditLeg={startTraverseLegEdit}
              onEditLegInputChange={setEditingTraverseLegInput}
              onApplyEditLeg={applyTraverseLegEdit}
              onCancelEditLeg={cancelTraverseLegEdit}
              onNudgeLeg={nudgeTraverseLeg}
              onApplyAdjustment={applyTraverseDraftAdjustment}
              onClearAdjustment={clearTraverseDraftAdjustment}
              onSideshotOccupyIndexChange={setNewTraverseSideshotOccupyIndex}
              onSideshotInputChange={setNewTraverseSideshotInput}
              onApplySideshot={applyTraverseSideshot}
              onRemoveSideshot={removeTraverseDraftSideshot}
            />
          ) : null}          <SurveyCadPreview
              scene={displaySceneWithParcelLabelToggle}
              viewBounds={viewBounds}
              selectedEntityIds={selectedEntityIds}
              selectedParcelReport={propertiesPanelState ? null : selectedParcelReport}
              showParcelLabels={showParcelLabels}
            hasTopRightOverlay={
              propertiesPanelState != null ||
              reportedComputation != null ||
              activeBatchCogoDraft != null ||
              activeTraverseDraft != null
            }
            activeSnap={activeSnap}
            commandPreviewPrimitives={mergedCommandPreviewPrimitives}
            gripHandles={gripHandles}
            gripPreviewPrimitives={gripPreviewPrimitives}
            activeGripHandleId={activeGripHandleId}
            commandStatusText={commandStatusText}
            commandHelpText={commandHelpText}
            commandModifierHint={commandModifierHint}
            constructionHint={constructionHint}
            snapPreferences={snapPreferences}
            commandInputValue={commandInputValue}
            commandInputPlaceholder={commandInputPlaceholder}
            commandInputEnabled={
              activeCommandKey != null &&
              activeCommandKey !== 'TRIM' &&
              activeCommandKey !== 'EXTEND' &&
              activeCommandKey !== 'BATCH_COGO'
            }
            commandEntityOpacityOverrides={commandEntityOpacityOverrides}
            viewport={viewport}
            commandActive={activeCommandKey != null}
            commandPointInputActive={commandExpectsPointPick}
            onViewportChange={setViewport}
            onPrimitiveClickIntercept={toggleFrontageSegmentSelection}
            onSelectEntity={selectEntity}
            onSelectEntities={selectEntities}
            onStartGripEdit={startGripEdit}
            onUpdateGripEdit={updateGripEdit}
            onFinishGripEdit={finishGripEdit}
            onCancelGripEdit={cancelGripEdit}
            onConsumeInteractionPoint={consumeInteractionPoint}
            onPointerWorldPointChange={updatePointerWorldPoint}
            onToggleParcelLabels={() => setShowParcelLabels((current) => !current)}
            onCommandHoverTargetChange={setCommandHoverTarget}
            onSnapPreferenceChange={setSnapPreference}
            onCommandInputChange={setCommandInputValue}
            onCommandInputEnter={handleEnterKey}
            onCommandInputEscape={() => {
              if (activeCommandKey) {
                handleEscapeKey();
                return;
              }
              if (selectionCount > 0) {
                clearSelection();
              }
            }}
            onEmptyBackgroundDoubleClick={() => {
              if (activeCommandKey) {
                handleEscapeKey();
              }
            }}
            onZoomExtents={() => {
              setViewBounds(cloneBounds(activeProject.bounds));
              setViewport({ zoom: 1, panX: 0, panY: 0 });
            }}
          />
        </div>
      </div>
    </div>
  );
};

export default SurveyCadWorkspace;
