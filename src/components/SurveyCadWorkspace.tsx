import React, { useEffect, useMemo, useRef, useState, type Dispatch, type SetStateAction } from 'react';
import type { AdjustmentResult, InstrumentLibrary, ParseOptions, UnitsMode } from '../types';
import { buildSurveyCadSpikeProject } from '../engine/cad/cadModel';
import {
  cadBuildParcelAutoLayoutDraft,
  cadBuildParcelLayoutFrontageReference,
  type CadParcelAutoLayoutDraft,
  type CadParcelLayoutPreviewCandidate,
  cadSelectPreferredParcelLayoutPreviewCandidate,
} from '../engine/cad/cadCogo';
import { buildCadProjectSignature } from '../engine/cad/cadProjectState';
import type {
  CadBounds,
  CadDisplayPrimitive,
  CadEntityId,
  CadParcelLayoutSettings,
  CadParcelLayoutUiState,
  SurveyCadPersistedState,
} from '../engine/cad/cadTypes';
import { noteUiTabReady } from '../hooks/useUiPerfMonitor';
import { useSurveyCadWorkspace } from '../hooks/surveyCad/useSurveyCadWorkspace';
import SurveyCadCommandLine from './surveyCad/SurveyCadCommandLine';
import SurveyCadCogoPanel from './surveyCad/SurveyCadCogoPanel';
import SurveyCadParcelLayoutPanel from './surveyCad/SurveyCadParcelLayoutPanel';
import type { FloatingPanelResizeDirection } from './surveyCad/SurveyCadFloatingPanelShell';
import SurveyCadPropertiesPanel from './surveyCad/SurveyCadPropertiesPanel';
import SurveyCadPreview from './surveyCad/SurveyCadPreview';

interface SurveyCadWorkspaceProps {
  input: string;
  instrumentLibrary: InstrumentLibrary;
  parseOptions: ParseOptions;
  units: UnitsMode;
  result: AdjustmentResult | null;
  persistedState?: SurveyCadPersistedState | null;
  onPersistedStateChange?: Dispatch<SetStateAction<SurveyCadPersistedState | null>>;
}

const DEFAULT_PARCEL_LAYOUT_SETTINGS: CadParcelLayoutSettings = {
  minAreaSquareMeters: 1000,
  minFrontageMeters: 30,
  useFrontageAtOffset: false,
  frontageOffsetMeters: 10,
  minWidthMeters: 20,
  minDepthMeters: 20,
  useMaxDepth: false,
  maxDepthMeters: 150,
  solutionPreference: 'shortest_frontage',
  automaticMode: 'off',
  remainderDistribution: 'place_remainder_in_last_parcel',
};

const DEFAULT_PARCEL_LAYOUT_FLOATING_WIDTH_PX = 304;
const DEFAULT_PARCEL_LAYOUT_FLOATING_HEIGHT_PX = 600;
const MIN_PARCEL_LAYOUT_FLOATING_WIDTH_PX = 304;
const MIN_PARCEL_LAYOUT_FLOATING_HEIGHT_PX = 220;
const PARCEL_LAYOUT_FLOATING_VIEWPORT_GUTTER_PX = 8;
const PARCEL_LAYOUT_FLOATING_MIN_TOP_PX = 72;
const CAD_SIDE_PANEL_WIDTH_PX = 304;
const CAD_SIDE_PANEL_GAP_PX = 12;
const CAD_SIDE_PANEL_TOP_PX = 120;
const PROPERTIES_PANEL_FLOATING_LEFT_PX = 24;
const PROPERTIES_PANEL_FLOATING_TOP_PX = 120;
const PROPERTIES_PANEL_HEIGHT_PX = 600;

type CadSidePanelDock = 'left' | 'right' | 'floating';
type CadSidePanelId = 'parcel-layout' | 'properties';

const DEFAULT_PARCEL_LAYOUT_UI_STATE: CadParcelLayoutUiState = {
  open: false,
  collapsed: false,
  dock: 'right',
  floatingLeftPx: 24,
  floatingTopPx: 112,
  floatingWidthPx: DEFAULT_PARCEL_LAYOUT_FLOATING_WIDTH_PX,
  floatingHeightPx: DEFAULT_PARCEL_LAYOUT_FLOATING_HEIGHT_PX,
  activeParentParcelId: null,
  activeFrontageEntityId: null,
  settings: DEFAULT_PARCEL_LAYOUT_SETTINGS,
};

const cloneParcelLayoutSettings = (settings: CadParcelLayoutSettings): CadParcelLayoutSettings => ({
  minAreaSquareMeters: settings.minAreaSquareMeters,
  minFrontageMeters: settings.minFrontageMeters,
  useFrontageAtOffset: settings.useFrontageAtOffset,
  frontageOffsetMeters: settings.frontageOffsetMeters,
  minWidthMeters: settings.minWidthMeters,
  minDepthMeters: settings.minDepthMeters,
  useMaxDepth: settings.useMaxDepth,
  maxDepthMeters: settings.maxDepthMeters,
  solutionPreference: settings.solutionPreference,
  automaticMode: settings.automaticMode,
  remainderDistribution: settings.remainderDistribution,
});

const cloneParcelLayoutUiState = (
  state: CadParcelLayoutUiState | undefined | null,
): CadParcelLayoutUiState => {
  const floatingWidthPx = state?.floatingWidthPx ?? DEFAULT_PARCEL_LAYOUT_UI_STATE.floatingWidthPx;
  const floatingHeightPx =
    state?.floatingWidthPx === DEFAULT_PARCEL_LAYOUT_FLOATING_WIDTH_PX &&
    state?.floatingHeightPx === 560
      ? DEFAULT_PARCEL_LAYOUT_FLOATING_HEIGHT_PX
      : (state?.floatingHeightPx ?? DEFAULT_PARCEL_LAYOUT_UI_STATE.floatingHeightPx);
  return {
    open: state?.open ?? DEFAULT_PARCEL_LAYOUT_UI_STATE.open,
    collapsed: state?.collapsed ?? DEFAULT_PARCEL_LAYOUT_UI_STATE.collapsed,
    dock: state?.dock ?? DEFAULT_PARCEL_LAYOUT_UI_STATE.dock,
    floatingLeftPx: state?.floatingLeftPx ?? DEFAULT_PARCEL_LAYOUT_UI_STATE.floatingLeftPx,
    floatingTopPx: state?.floatingTopPx ?? DEFAULT_PARCEL_LAYOUT_UI_STATE.floatingTopPx,
    floatingWidthPx,
    floatingHeightPx,
    activeParentParcelId: state?.activeParentParcelId ?? DEFAULT_PARCEL_LAYOUT_UI_STATE.activeParentParcelId,
    activeFrontageEntityId: state?.activeFrontageEntityId ?? DEFAULT_PARCEL_LAYOUT_UI_STATE.activeFrontageEntityId,
    settings: cloneParcelLayoutSettings(state?.settings ?? DEFAULT_PARCEL_LAYOUT_SETTINGS),
  };
};

interface ParcelLayoutPreviewState {
  candidate: CadParcelLayoutPreviewCandidate;
}

interface ParcelLayoutAutoPreviewState {
  draft: CadParcelAutoLayoutDraft;
  activeIndex: number;
}

const buildParcelLayoutPreviewPrimitives = (
  preview: ParcelLayoutPreviewState | null,
  autoPreview: ParcelLayoutAutoPreviewState | null,
  parcelEntityId: CadEntityId | null,
): CadDisplayPrimitive[] => {
  if (!parcelEntityId) return [];
  if (preview) {
    const { draft } = preview.candidate;
    if (!draft) return [];
    const { split } = draft;
    const vertices = draft.childVertices.concat(draft.childVertices[0] ?? []);
    const childOutlinePrimitives: CadDisplayPrimitive[] = [];
    for (let index = 0; index < draft.childVertices.length; index += 1) {
      const start = vertices[index];
      const end = vertices[index + 1];
      if (!start || !end) continue;
      childOutlinePrimitives.push({
        id: `parcel-layout-preview-outline-${index}`,
        kind: 'line',
        layerId: 'parcels',
        sourceEntityId: parcelEntityId,
        points: [start, end],
        stroke: '#22d3ee',
        strokeWidth: index === draft.childVertices.length - 1 ? 2.4 : 1.8,
        opacity: 0.95,
        strokeDasharray: index === draft.childVertices.length - 1 ? '4 3' : '7 5',
      });
    }
    childOutlinePrimitives.push({
      id: 'parcel-layout-preview-split',
      kind: 'line',
      layerId: 'parcels',
      sourceEntityId: parcelEntityId,
      points: [split.splitStart, split.splitEnd],
      stroke: preview.candidate.tool === 'slide' ? '#f59e0b' : '#34d399',
      strokeWidth: 2.6,
      opacity: 0.95,
      strokeDasharray: '10 5',
    });
    childOutlinePrimitives.push({
      id: 'parcel-layout-preview-label',
      kind: 'text',
      layerId: 'parcels',
      sourceEntityId: parcelEntityId,
      point: {
        x: (split.splitStart.x + split.splitEnd.x) / 2,
        y: (split.splitStart.y + split.splitEnd.y) / 2,
      },
      text: `${preview.candidate.tool === 'slide' ? 'Slide' : 'Swing'} ${preview.candidate.alternative} | ${draft.childAreaSquareMeters.toFixed(1)} m2 | ${draft.frontageLengthMeters.toFixed(1)} m`,
      stroke: '#e2e8f0',
      fontSize: 11,
      opacity: 0.95,
      textAnchor: 'middle',
    });
    return childOutlinePrimitives;
  }
  if (!autoPreview) return [];
  return autoPreview.draft.generatedParcels.flatMap((generatedParcel, parcelIndex) => {
    const vertices = generatedParcel.vertices.concat(generatedParcel.vertices[0] ?? []);
    const isActive = parcelIndex === autoPreview.activeIndex;
    const stroke = generatedParcel.role === 'remainder' ? '#94a3b8' : isActive ? '#22d3ee' : '#f59e0b';
    return generatedParcel.vertices.flatMap((_, index) => {
      const start = vertices[index];
      const end = vertices[index + 1];
      if (!start || !end) return [];
      return [
        {
          id: `parcel-layout-auto-preview-outline-${parcelIndex}-${index}`,
          kind: 'line' as const,
          layerId: 'parcels',
          sourceEntityId: parcelEntityId,
          points: [start, end],
          stroke,
          strokeWidth: isActive ? 2.4 : 1.6,
          opacity: generatedParcel.role === 'remainder' ? 0.75 : isActive ? 0.95 : 0.8,
          strokeDasharray: generatedParcel.role === 'remainder' ? '3 3' : isActive ? '8 4' : '6 4',
        },
      ];
    });
  });
};

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
  const [propertiesPanelUiState, setPropertiesPanelUiState] = useState<{
    dock: CadSidePanelDock;
    collapsed: boolean;
    floatingLeftPx: number;
    floatingTopPx: number;
  }>({
    dock: 'right',
    collapsed: false,
    floatingLeftPx: PROPERTIES_PANEL_FLOATING_LEFT_PX,
    floatingTopPx: PROPERTIES_PANEL_FLOATING_TOP_PX,
  });
  const [panelDockOrders, setPanelDockOrders] = useState<Record<CadSidePanelId, number>>({
    'parcel-layout': 0,
    properties: 0,
  });
  const panelDockOrderCounterRef = useRef(0);
  const touchPanelDockOrder = (panelId: CadSidePanelId) => {
    panelDockOrderCounterRef.current += 1;
    const nextOrder = panelDockOrderCounterRef.current;
    setPanelDockOrders((current) => ({
      ...current,
      [panelId]: nextOrder,
    }));
  };
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

  useEffect(() => {
    const isVisible = propertiesPanelState != null;
    if (isVisible && !previousPropertiesPanelVisibleRef.current) {
      touchPanelDockOrder('properties');
    }
    previousPropertiesPanelVisibleRef.current = isVisible;
  }, [propertiesPanelState]);

  useEffect(() => {
    if (parcelLayoutState.open && !previousParcelLayoutOpenRef.current) {
      touchPanelDockOrder('parcel-layout');
    }
    previousParcelLayoutOpenRef.current = parcelLayoutState.open;
  }, [parcelLayoutState.open]);

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
  const dockedPanelOffsets = useMemo(() => {
    const visiblePanels: Array<{
      id: CadSidePanelId;
      dock: CadSidePanelDock;
      order: number;
    }> = [];
    if (propertiesPanelState) {
      visiblePanels.push({
        id: 'properties',
        dock: propertiesPanelUiState.dock,
        order: panelDockOrders.properties,
      });
    }
    if (parcelLayoutState.open && parcelLayoutState.dock !== 'floating') {
      visiblePanels.push({
        id: 'parcel-layout',
        dock: parcelLayoutState.dock,
        order: panelDockOrders['parcel-layout'],
      });
    }
    const offsets: Record<CadSidePanelId, number> = {
      'parcel-layout': CAD_SIDE_PANEL_GAP_PX,
      properties: CAD_SIDE_PANEL_GAP_PX,
    };
    (['left', 'right'] as const).forEach((dock) => {
      visiblePanels
        .filter((panel) => panel.dock === dock)
        .sort((left, right) => left.order - right.order)
        .forEach((panel, index) => {
          offsets[panel.id] = CAD_SIDE_PANEL_GAP_PX + index * (CAD_SIDE_PANEL_WIDTH_PX + CAD_SIDE_PANEL_GAP_PX);
        });
    });
    return offsets;
  }, [panelDockOrders, parcelLayoutState.dock, parcelLayoutState.open, propertiesPanelState, propertiesPanelUiState.dock]);

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

  const commandInputPlaceholder = useMemo(() => {
    if (!activeCommandKey) return 'Choose a command, then click or type in the drawing window';
    if (activeCommandKey === 'POINT') return 'Click in model space or type x,y / LABEL=x,y';
    if (activeCommandKey === 'COGO_POINT') return 'Click base/target or type @azimuth,distance';
    if (activeCommandKey === 'TRAVERSE') return 'Click start / next point or type bearing-distance';
    if (activeCommandKey === 'BATCH_COGO') return 'Use batch COGO panel for pasted deed rows';
    if (activeCommandKey === 'MULTI_INVERSE') return 'Click point sequence or type x,y / bearing-distance';
    if (activeCommandKey === 'AREA') return 'Click point sequence or type x,y / bearing-distance, then Enter to close';
    if (activeCommandKey === 'TURNED_POINT') return 'Pick occupy/backsight, then type Langle,distance or Rangle,distance';
    if (activeCommandKey === 'DEFLECT_POINT') return 'Type Langle,distance or Rangle,distance from selected line';
    if (activeCommandKey === 'POINT_ALONG_LINE') return 'Type distance or percent like 25 or 50% from selected line';
    if (activeCommandKey === 'EXTEND_LINE') return 'Type extension distance from selected line end';
    if (activeCommandKey === 'OFFSET_POINT') return 'Type Loffset,along or Roffset,along from selected line';
    if (activeCommandKey === 'ALIGNMENT_OFFSET_CREATE') return 'Type offset or NAME=offset from selected alignment';
    if (activeCommandKey === 'ALIGNMENT_STATION_EQUATION') return 'Type backStation,aheadStation from selected alignment';
    if (activeCommandKey === 'ALIGNMENT_OFFSET_POINT') return 'Type station,offset or LABEL=station,offset from selected alignment';
    if (activeCommandKey === 'ALIGNMENT_INTERVAL_POINTS') return 'Type interval or start,end,interval from selected alignment';
    if (activeCommandKey === 'CURVE_SOLVER') return 'Type param1,param2,value1,value2 like radius,delta,200,60';
    if (activeCommandKey === 'RADIAL_BEARING') return 'Type PC, PT, or MID from selected arc';
    if (activeCommandKey === 'POINT_ON_CURVE') return 'Type ARC,distance or CHORD,distance from selected arc start';
    if (activeCommandKey === 'SUBDIVIDE_CURVE') return 'Type EQUAL,count or ARC/CHORD interval for selected arc';
    if (activeCommandKey === 'OFFSET_CURVE') return 'Type Ldistance or Rdistance from selected arc';
    if (activeCommandKey === 'PI_CURVE') return 'Pick PI/back tangent, then type Lradius,delta or Rradius,delta';
    if (activeCommandKey === 'CHORD_BEARING_CURVE') return 'Pick start, then type bearing,chord,radius,L|R';
    if (activeCommandKey === 'REVERSE_CURVE') return 'Type Lradius,delta or Rradius,delta from selected arc';
    if (activeCommandKey === 'COMPOUND_CURVE') return 'Type Lradius,delta or Rradius,delta from selected arc';
    if (activeCommandKey === 'BEARING_BEARING_INTX') return 'Pick two points, then type bearing1;bearing2';
    if (activeCommandKey === 'BEARING_DISTANCE_INTX') return 'Pick bearing point and center, then type bearing;distance';
    if (activeCommandKey === 'DISTANCE_DISTANCE_INTX') return 'Pick two centers, then type distance1,distance2';
    if (activeCommandKey === 'LINE_CIRCLE_INTX') return 'Select a line, pick a center point, then type radius';
    if (activeCommandKey === 'PERP_INTX') return 'Select a line, then pick the external point';
    if (activeCommandKey === 'OFFSET_INTX') return 'Select two lines, then type Loff1,Roff2';
    if (activeCommandKey === 'SKEW_INTX') return 'Select a line, pick a source point, then type Langle or Rangle';
    if (activeCommandKey === 'EXTEND') return 'Click entity to extend, then click boundary. Enter/Esc ends extend';
    if (activeCommandKey === 'TRIM') return 'Click first entity, then click side to trim on second entity. Enter/Esc ends trim';
    if (activeCommandKey === 'FILLET') return 'Type radius, then click two entities near the corner. Enter/Esc ends fillet';
    if (activeCommandKey?.startsWith('ARC_') || activeCommandKey === 'CONTINUE_CURVE') {
      return 'Pick arc points, then enter the required value. Hold Ctrl to reverse direction';
    }
    if (activeCommandKey === 'TANGENT_CURVE') return 'Click tangent points or type radius';
    if (activeCommandKey === 'PASTE') return 'Click insertion point or type x,y / bearing-distance';
    return 'Click in model space or type x,y / bearing-distance';
  }, [activeCommandKey]);
  const commandStatusText = useMemo(
    () => (statusText.startsWith('Ready.') ? '' : statusText),
    [statusText],
  );
  const commandModifierHint = useMemo(() => {
    if (
      activeCommandKey == null ||
      ![
        'ARC_SCE',
        'ARC_CSE',
        'ARC_SCA',
        'ARC_CSA',
        'ARC_SCL',
        'ARC_CSL',
        'ARC_SEA',
        'ARC_SED',
        'ARC_SER',
        'CONTINUE_CURVE',
      ].includes(activeCommandKey)
    ) {
      return '';
    }
    return reverseDirectionModifier ? 'Ctrl Held: Flip Arc' : 'Ctrl = Flip Arc';
  }, [activeCommandKey, reverseDirectionModifier]);
  const constructionHint = useMemo(() => {
    if (!snapConstructionContext.active || !snapConstructionContext.basePoint) return '';
    const enabledConstructionKinds = [
      snapPreferences.extension ? 'Ext' : null,
      snapPreferences.perpendicular ? 'Perp' : null,
      snapPreferences.parallel ? 'Par' : null,
      snapPreferences['apparent-intersection'] ? 'App' : null,
      snapPreferences.tangent ? 'Tan' : null,
    ].filter((value): value is string => value != null);
    if (enabledConstructionKinds.length === 0) return '';
    return `Base ${snapConstructionContext.basePoint.x.toFixed(3)},${snapConstructionContext.basePoint.y.toFixed(3)}: Construction snaps live (${enabledConstructionKinds.join('/')})`;
  }, [snapConstructionContext, snapPreferences]);

  const parcelLayoutDragRef = useRef<{
    pointerId: number;
    startClientX: number;
    startClientY: number;
    startLeftPx: number;
    startTopPx: number;
  } | null>(null);
  const propertiesPanelDragRef = useRef<{
    pointerId: number;
    startClientX: number;
    startClientY: number;
    startLeftPx: number;
    startTopPx: number;
  } | null>(null);
  const parcelLayoutResizeRef = useRef<{
    pointerId: number;
    direction: FloatingPanelResizeDirection;
    startClientX: number;
    startClientY: number;
    startWidthPx: number;
    startHeightPx: number;
    startLeftPx: number;
    startTopPx: number;
  } | null>(null);
  const [isParcelLayoutDragging, setIsParcelLayoutDragging] = useState(false);
  const [isPropertiesPanelDragging, setIsPropertiesPanelDragging] = useState(false);
  const [parcelLayoutResizeDirection, setParcelLayoutResizeDirection] =
    useState<FloatingPanelResizeDirection | null>(null);
  const previousPropertiesPanelVisibleRef = useRef(false);
  const previousParcelLayoutOpenRef = useRef(false);
  const parcelLayoutParentEntity = useMemo(
    () =>
      parcelLayoutState.activeParentParcelId == null
        ? null
        : activeProject.entities.find(
            (entity): entity is Extract<(typeof activeProject.entities)[number], { type: 'parcel' }> =>
              entity.id === parcelLayoutState.activeParentParcelId && entity.type === 'parcel',
          ) ?? null,
    [activeProject, parcelLayoutState.activeParentParcelId],
  );
  const parcelLayoutFrontageEntity = useMemo(
    () =>
      parcelLayoutState.activeFrontageEntityId == null
        ? null
        : activeProject.entities.find(
            (entity): entity is Extract<(typeof activeProject.entities)[number], { type: 'line' | 'polyline' | 'arc' }> =>
              entity.id === parcelLayoutState.activeFrontageEntityId &&
              (entity.type === 'line' || entity.type === 'polyline' || entity.type === 'arc'),
          ) ?? null,
    [activeProject, parcelLayoutState.activeFrontageEntityId],
  );
  const selectedParcelForLayout =
    selectedEntities.length === 1 && selectedEntities[0]?.type === 'parcel'
      ? selectedEntities[0]
      : selectedEntities.find((entity) => entity.type === 'parcel') ?? null;
  const selectedFrontageForLayout =
    selectedEntities.find(
      (entity): entity is Extract<(typeof selectedEntities)[number], { type: 'line' | 'polyline' | 'arc' }> =>
        entity.type === 'line' || entity.type === 'polyline' || entity.type === 'arc',
    ) ?? null;
  const parcelLayoutFrontageReference = useMemo(
    () =>
      parcelLayoutFrontageEntity
        ? cadBuildParcelLayoutFrontageReference(parcelLayoutFrontageEntity)
        : null,
    [parcelLayoutFrontageEntity],
  );
  const directParcelSplitTarget = useMemo(() => {
    const parcel = parcelLayoutParentEntity ?? selectedParcelForLayout;
    const frontage = parcelLayoutFrontageEntity ?? selectedFrontageForLayout;
    const frontageReference = frontage
      ? cadBuildParcelLayoutFrontageReference(frontage)
      : null;
    return parcel && frontage && frontageReference ? { parcel, frontage, frontageReference } : null;
  }, [
    parcelLayoutFrontageEntity,
    parcelLayoutParentEntity,
    selectedFrontageForLayout,
    selectedParcelForLayout,
  ]);
  const parcelLayoutFrontageLabel = useMemo(() => {
    return parcelLayoutFrontageReference?.displayLabel ?? null;
  }, [parcelLayoutFrontageReference]);
  const canPreviewParcelSlideOrSwing =
    parcelLayoutParentEntity != null && parcelLayoutFrontageReference != null;
  const directParcelSlideCandidate = useMemo(
    () =>
      directParcelSplitTarget
        ? cadSelectPreferredParcelLayoutPreviewCandidate(
            directParcelSplitTarget.parcel,
            directParcelSplitTarget.frontageReference.frontageLine,
            parcelLayoutState.settings,
            'slide',
          )
        : null,
    [directParcelSplitTarget, parcelLayoutState.settings],
  );
  const directParcelSwingCandidate = useMemo(
    () =>
      directParcelSplitTarget
        ? cadSelectPreferredParcelLayoutPreviewCandidate(
            directParcelSplitTarget.parcel,
            directParcelSplitTarget.frontageReference.frontageLine,
            parcelLayoutState.settings,
            'swing',
          )
        : null,
    [directParcelSplitTarget, parcelLayoutState.settings],
  );
  const parcelLayoutPreviewPrimitives = useMemo(
    () =>
      buildParcelLayoutPreviewPrimitives(
        parcelLayoutPreviewState,
        parcelLayoutAutoPreviewState,
        parcelLayoutParentEntity?.id ?? null,
      ),
    [parcelLayoutAutoPreviewState, parcelLayoutParentEntity?.id, parcelLayoutPreviewState],
  );
  const mergedCommandPreviewPrimitives = useMemo(
    () => [...commandPreviewPrimitives, ...parcelLayoutPreviewPrimitives],
    [commandPreviewPrimitives, parcelLayoutPreviewPrimitives],
  );
  const parcelLayoutPreviewStatus = useMemo(() => {
    if (!parcelLayoutParentEntity) {
      return 'Choose one parent parcel for parcel-layout preview.';
    }
    if (!parcelLayoutFrontageReference) {
      return 'Choose one frontage entity that matches a parent parcel edge.';
    }
    if (parcelLayoutAutoPreviewState) {
      const lotCount = parcelLayoutAutoPreviewState.draft.acceptedCandidates.length;
      const previewIndex = Math.min(parcelLayoutAutoPreviewState.activeIndex + 1, lotCount);
      return `Automatic preview ${previewIndex} of ${lotCount}: ${parcelLayoutAutoPreviewState.draft.acceptedCandidates[parcelLayoutAutoPreviewState.activeIndex]?.statusMessage ?? parcelLayoutAutoPreviewState.draft.statusMessage}`;
    }
    if (!parcelLayoutPreviewState) {
      return 'Use Slide or Swing to preview one child lot from the active parent/frontage setup.';
    }
    return parcelLayoutPreviewState.candidate.statusMessage;
  }, [parcelLayoutAutoPreviewState, parcelLayoutFrontageReference, parcelLayoutParentEntity, parcelLayoutPreviewState]);

  const parcelLayoutPreviewDetails = useMemo(() => {
    if (parcelLayoutAutoPreviewState) {
      const activeCandidate =
        parcelLayoutAutoPreviewState.draft.acceptedCandidates[parcelLayoutAutoPreviewState.activeIndex] ?? null;
      return [
        `Generated parcels: ${parcelLayoutAutoPreviewState.draft.generatedParcels.length}`,
        `Generated lots: ${parcelLayoutAutoPreviewState.draft.acceptedCandidates.length}`,
        ...(activeCandidate?.evaluation?.messages ?? []),
      ];
    }
    return parcelLayoutPreviewState?.candidate.evaluation?.messages ?? [];
  }, [parcelLayoutAutoPreviewState, parcelLayoutPreviewState]);

  const parcelAutoLayoutDraft = useMemo(() => {
    if (!parcelLayoutParentEntity || !parcelLayoutFrontageReference) return null;
    return cadBuildParcelAutoLayoutDraft(
      parcelLayoutParentEntity,
      parcelLayoutFrontageReference.frontageLine,
      parcelLayoutState.settings,
      parcelLayoutAutoTool,
    );
  }, [parcelLayoutAutoTool, parcelLayoutFrontageReference, parcelLayoutParentEntity, parcelLayoutState.settings]);

  const canCreateAllParcelLayout =
    parcelLayoutParentEntity != null &&
    parcelLayoutFrontageReference != null &&
    parcelLayoutState.settings.automaticMode === 'fill_parent' &&
    (parcelAutoLayoutDraft?.isValid ?? false);
  const canRunPrimaryParcelLayoutCreate =
    parcelLayoutState.settings.automaticMode === 'fill_parent'
      ? canCreateAllParcelLayout
      : canCreateParcel;
  const canPreviewAllParcelLayout =
    parcelLayoutParentEntity != null &&
    parcelLayoutFrontageReference != null &&
    parcelLayoutState.settings.automaticMode !== 'off' &&
    (parcelAutoLayoutDraft?.isValid ?? false);

  const previewParcelLayoutSplit = (
    tool: 'slide' | 'swing',
    alternative = parcelLayoutPreviewState?.candidate.tool === tool
      ? parcelLayoutPreviewState.candidate.alternative
      : null,
    ) => {
    if (!parcelLayoutParentEntity || !parcelLayoutFrontageReference) return;
    setParcelLayoutAutoTool(tool);
    setParcelLayoutAutoPreviewState(null);
    const preferredCandidate = cadSelectPreferredParcelLayoutPreviewCandidate(
      parcelLayoutParentEntity,
      parcelLayoutFrontageReference.frontageLine,
      parcelLayoutState.settings,
      tool,
      alternative,
    );
    setParcelLayoutPreviewState({ candidate: preferredCandidate });
  };

  const cycleParcelLayoutPreviewAlternative = () => {
    if (parcelLayoutAutoPreviewState) {
      setParcelLayoutAutoPreviewState((current) =>
        current == null
          ? current
          : {
              ...current,
              activeIndex: (current.activeIndex + 1) % Math.max(current.draft.acceptedCandidates.length, 1),
            },
      );
      return;
    }
    if (!parcelLayoutPreviewState) return;
    previewParcelLayoutSplit(
      parcelLayoutPreviewState.candidate.tool,
      parcelLayoutPreviewState.candidate.alternative === 'start' ? 'end' : 'start',
    );
  };

  const acceptParcelLayoutPreview = () => {
    if (
      parcelLayoutAutoPreviewState &&
      parcelLayoutParentEntity &&
      parcelLayoutFrontageEntity
    ) {
      const activeCandidate =
        parcelLayoutAutoPreviewState.draft.acceptedCandidates[parcelLayoutAutoPreviewState.activeIndex] ?? null;
      if (!activeCandidate?.isValid || !activeCandidate.draft) return;
      if (activeCandidate.tool === 'slide') {
        commitParcelSlideLayout({
          parcelEntityId: parcelLayoutParentEntity.id,
          frontageEntityId: parcelLayoutFrontageEntity.id,
          targetAreaSquareMeters: parcelLayoutState.settings.minAreaSquareMeters,
          minFrontageMeters: parcelLayoutState.settings.minFrontageMeters,
          alternative: activeCandidate.alternative,
          settings: cloneParcelLayoutSettings(parcelLayoutState.settings),
        });
      } else {
        commitParcelSwingLayout({
          parcelEntityId: parcelLayoutParentEntity.id,
          frontageEntityId: parcelLayoutFrontageEntity.id,
          targetAreaSquareMeters: parcelLayoutState.settings.minAreaSquareMeters,
          minFrontageMeters: parcelLayoutState.settings.minFrontageMeters,
          alternative: activeCandidate.alternative,
          settings: cloneParcelLayoutSettings(parcelLayoutState.settings),
        });
      }
      setParcelLayoutAutoPreviewState(null);
      setParcelLayoutPreviewState(null);
      return;
    }
    if (
      !parcelLayoutPreviewState ||
      !parcelLayoutPreviewState.candidate.isValid ||
      !parcelLayoutPreviewState.candidate.draft ||
      !parcelLayoutParentEntity ||
      !parcelLayoutFrontageEntity
    ) {
      return;
    }
    if (parcelLayoutPreviewState.candidate.tool === 'slide') {
      commitParcelSlideLayout({
        parcelEntityId: parcelLayoutParentEntity.id,
        frontageEntityId: parcelLayoutFrontageEntity.id,
        targetAreaSquareMeters: parcelLayoutState.settings.minAreaSquareMeters,
        minFrontageMeters: parcelLayoutState.settings.minFrontageMeters,
        alternative: parcelLayoutPreviewState.candidate.alternative,
        settings: cloneParcelLayoutSettings(parcelLayoutState.settings),
      });
    } else {
      commitParcelSwingLayout({
        parcelEntityId: parcelLayoutParentEntity.id,
        frontageEntityId: parcelLayoutFrontageEntity.id,
        targetAreaSquareMeters: parcelLayoutState.settings.minAreaSquareMeters,
        minFrontageMeters: parcelLayoutState.settings.minFrontageMeters,
        alternative: parcelLayoutPreviewState.candidate.alternative,
        settings: cloneParcelLayoutSettings(parcelLayoutState.settings),
      });
    }
    setParcelLayoutPreviewState(null);
  };

  const previewAllParcelLayout = () => {
    if (!canPreviewAllParcelLayout || !parcelAutoLayoutDraft) return;
    setParcelLayoutPreviewState(null);
    setParcelLayoutAutoPreviewState({
      draft: parcelAutoLayoutDraft,
      activeIndex: 0,
    });
  };

  const createAllParcelLayout = () => {
    if (
      !canCreateAllParcelLayout ||
      !parcelLayoutParentEntity ||
      !parcelLayoutFrontageEntity
    ) {
      return;
    }
    commitParcelAutoLayout({
      parcelEntityId: parcelLayoutParentEntity.id,
      frontageEntityId: parcelLayoutFrontageEntity.id,
      tool: parcelLayoutAutoTool,
      settings: cloneParcelLayoutSettings(parcelLayoutState.settings),
    });
    setParcelLayoutAutoPreviewState(null);
    setParcelLayoutPreviewState(null);
  };

  const splitParcelBySlide = () => {
    if (!directParcelSplitTarget) return;
    commitParcelSlideLayout({
      parcelEntityId: directParcelSplitTarget.parcel.id,
      frontageEntityId: directParcelSplitTarget.frontage.id,
      targetAreaSquareMeters: parcelLayoutState.settings.minAreaSquareMeters,
      minFrontageMeters: parcelLayoutState.settings.minFrontageMeters,
      alternative: directParcelSlideCandidate?.alternative ?? 'start',
      settings: cloneParcelLayoutSettings(parcelLayoutState.settings),
    });
    setParcelLayoutAutoPreviewState(null);
    setParcelLayoutPreviewState(null);
  };

  const splitParcelBySwing = () => {
    if (!directParcelSplitTarget) return;
    commitParcelSwingLayout({
      parcelEntityId: directParcelSplitTarget.parcel.id,
      frontageEntityId: directParcelSplitTarget.frontage.id,
      targetAreaSquareMeters: parcelLayoutState.settings.minAreaSquareMeters,
      minFrontageMeters: parcelLayoutState.settings.minFrontageMeters,
      alternative: directParcelSwingCandidate?.alternative ?? 'start',
      settings: cloneParcelLayoutSettings(parcelLayoutState.settings),
    });
    setParcelLayoutAutoPreviewState(null);
    setParcelLayoutPreviewState(null);
  };

  useEffect(() => {
    if (parcelLayoutState.dock !== 'floating') return;
    const handlePointerMove = (event: PointerEvent) => {
      const drag = parcelLayoutDragRef.current;
      if (drag && drag.pointerId === event.pointerId) {
        event.preventDefault();
        const maxLeft = Math.max(
          PARCEL_LAYOUT_FLOATING_VIEWPORT_GUTTER_PX,
          window.innerWidth - parcelLayoutState.floatingWidthPx - PARCEL_LAYOUT_FLOATING_VIEWPORT_GUTTER_PX,
        );
        const maxTop = Math.max(
          PARCEL_LAYOUT_FLOATING_MIN_TOP_PX,
          window.innerHeight - parcelLayoutState.floatingHeightPx - PARCEL_LAYOUT_FLOATING_VIEWPORT_GUTTER_PX,
        );
        const nextLeft = drag.startLeftPx + (event.clientX - drag.startClientX);
        const nextTop = drag.startTopPx + (event.clientY - drag.startClientY);
        setParcelLayoutState((current) => ({
          ...current,
          floatingLeftPx: Math.min(
            maxLeft,
            Math.max(PARCEL_LAYOUT_FLOATING_VIEWPORT_GUTTER_PX, nextLeft),
          ),
          floatingTopPx: Math.min(
            maxTop,
            Math.max(PARCEL_LAYOUT_FLOATING_MIN_TOP_PX, nextTop),
          ),
        }));
        return;
      }
      const resize = parcelLayoutResizeRef.current;
      if (!resize || resize.pointerId !== event.pointerId) return;
      event.preventDefault();
      setParcelLayoutState((current) => {
        const maxWidth = Math.max(
          MIN_PARCEL_LAYOUT_FLOATING_WIDTH_PX,
          window.innerWidth - current.floatingLeftPx - PARCEL_LAYOUT_FLOATING_VIEWPORT_GUTTER_PX,
        );
        const maxHeight = Math.min(
          DEFAULT_PARCEL_LAYOUT_FLOATING_HEIGHT_PX,
          Math.max(
            MIN_PARCEL_LAYOUT_FLOATING_HEIGHT_PX,
            window.innerHeight - current.floatingTopPx - PARCEL_LAYOUT_FLOATING_VIEWPORT_GUTTER_PX,
          ),
        );
        const minHeight = Math.min(
          MIN_PARCEL_LAYOUT_FLOATING_HEIGHT_PX,
          DEFAULT_PARCEL_LAYOUT_FLOATING_HEIGHT_PX,
        );
        const deltaX = event.clientX - resize.startClientX;
        const deltaY = event.clientY - resize.startClientY;
        const widthDelta =
          resize.direction === 'right' || resize.direction === 'corner' ? deltaX : 0;
        const heightDelta =
          resize.direction === 'bottom' || resize.direction === 'corner' ? deltaY : 0;
        return {
          ...current,
          floatingWidthPx: Math.min(
            maxWidth,
            Math.max(MIN_PARCEL_LAYOUT_FLOATING_WIDTH_PX, resize.startWidthPx + widthDelta),
          ),
          floatingHeightPx: Math.min(
            maxHeight,
            Math.max(minHeight, resize.startHeightPx + heightDelta),
          ),
        };
      });
    };
    const clearDrag = (pointerId: number) => {
      if (parcelLayoutDragRef.current?.pointerId === pointerId) {
        parcelLayoutDragRef.current = null;
        setIsParcelLayoutDragging(false);
      }
      if (parcelLayoutResizeRef.current?.pointerId === pointerId) {
        parcelLayoutResizeRef.current = null;
        setParcelLayoutResizeDirection(null);
      }
    };
    const handlePointerUp = (event: PointerEvent) => {
      clearDrag(event.pointerId);
    };
    const handlePointerCancel = (event: PointerEvent) => {
      clearDrag(event.pointerId);
    };
    window.addEventListener('pointermove', handlePointerMove);
    window.addEventListener('pointerup', handlePointerUp);
    window.addEventListener('pointercancel', handlePointerCancel);
    return () => {
      window.removeEventListener('pointermove', handlePointerMove);
      window.removeEventListener('pointerup', handlePointerUp);
      window.removeEventListener('pointercancel', handlePointerCancel);
    };
  }, [
    parcelLayoutState.dock,
    parcelLayoutState.floatingHeightPx,
    parcelLayoutState.floatingWidthPx,
  ]);

  const createPrimaryParcelLayout = () => {
    if (parcelLayoutState.settings.automaticMode === 'fill_parent') {
      createAllParcelLayout();
      return;
    }
    createParcelFromSelection();
  };

  useEffect(() => {
    if (propertiesPanelUiState.dock !== 'floating' || propertiesPanelState == null) return;
    const handlePointerMove = (event: PointerEvent) => {
      const drag = propertiesPanelDragRef.current;
      if (!drag || drag.pointerId !== event.pointerId) return;
      event.preventDefault();
      const maxLeft = Math.max(
        PARCEL_LAYOUT_FLOATING_VIEWPORT_GUTTER_PX,
        window.innerWidth - CAD_SIDE_PANEL_WIDTH_PX - PARCEL_LAYOUT_FLOATING_VIEWPORT_GUTTER_PX,
      );
      const maxTop = Math.max(
        CAD_SIDE_PANEL_TOP_PX,
        window.innerHeight - PROPERTIES_PANEL_HEIGHT_PX - PARCEL_LAYOUT_FLOATING_VIEWPORT_GUTTER_PX,
      );
      const nextLeft = drag.startLeftPx + (event.clientX - drag.startClientX);
      const nextTop = drag.startTopPx + (event.clientY - drag.startClientY);
      setPropertiesPanelUiState((current) => ({
        ...current,
        floatingLeftPx: Math.min(
          maxLeft,
          Math.max(PARCEL_LAYOUT_FLOATING_VIEWPORT_GUTTER_PX, nextLeft),
        ),
        floatingTopPx: Math.min(
          maxTop,
          Math.max(CAD_SIDE_PANEL_TOP_PX, nextTop),
        ),
      }));
    };
    const clearDrag = (pointerId: number) => {
      if (propertiesPanelDragRef.current?.pointerId === pointerId) {
        propertiesPanelDragRef.current = null;
        setIsPropertiesPanelDragging(false);
      }
    };
    const handlePointerUp = (event: PointerEvent) => {
      clearDrag(event.pointerId);
    };
    const handlePointerCancel = (event: PointerEvent) => {
      clearDrag(event.pointerId);
    };
    window.addEventListener('pointermove', handlePointerMove);
    window.addEventListener('pointerup', handlePointerUp);
    window.addEventListener('pointercancel', handlePointerCancel);
    return () => {
      window.removeEventListener('pointermove', handlePointerMove);
      window.removeEventListener('pointerup', handlePointerUp);
      window.removeEventListener('pointercancel', handlePointerCancel);
    };
  }, [propertiesPanelState, propertiesPanelUiState.dock]);

  useEffect(() => {
    if (parcelLayoutState.open && parcelLayoutState.dock === 'floating') return;
    parcelLayoutDragRef.current = null;
    parcelLayoutResizeRef.current = null;
    setIsParcelLayoutDragging(false);
    setParcelLayoutResizeDirection(null);
  }, [parcelLayoutState.dock, parcelLayoutState.open]);

  useEffect(() => {
    if (propertiesPanelState && propertiesPanelUiState.dock === 'floating') return;
    propertiesPanelDragRef.current = null;
    setIsPropertiesPanelDragging(false);
  }, [propertiesPanelState, propertiesPanelUiState.dock]);

  const toggleParcelLayoutPanel = () => {
    setParcelLayoutState((current) => ({ ...current, open: !current.open }));
  };

  const updateParcelLayoutState = (updater: (_current: CadParcelLayoutUiState) => CadParcelLayoutUiState) => {
    setParcelLayoutState((current) => updater(current));
  };

  useEffect(() => {
    setParcelLayoutPreviewState(null);
  }, [
    parcelLayoutParentEntity?.id,
    parcelLayoutFrontageEntity?.id,
    parcelLayoutState.settings.minAreaSquareMeters,
    parcelLayoutState.settings.minFrontageMeters,
    parcelLayoutState.settings.useFrontageAtOffset,
    parcelLayoutState.settings.frontageOffsetMeters,
    parcelLayoutState.settings.minWidthMeters,
    parcelLayoutState.settings.minDepthMeters,
    parcelLayoutState.settings.useMaxDepth,
    parcelLayoutState.settings.maxDepthMeters,
    parcelLayoutState.settings.solutionPreference,
    activeProject.entities.length,
  ]);
  useEffect(() => {
    setParcelLayoutAutoPreviewState(null);
  }, [
    parcelLayoutParentEntity?.id,
    parcelLayoutFrontageEntity?.id,
    parcelLayoutState.settings.minAreaSquareMeters,
    parcelLayoutState.settings.minFrontageMeters,
    parcelLayoutState.settings.useFrontageAtOffset,
    parcelLayoutState.settings.frontageOffsetMeters,
    parcelLayoutState.settings.minWidthMeters,
    parcelLayoutState.settings.minDepthMeters,
    parcelLayoutState.settings.useMaxDepth,
    parcelLayoutState.settings.maxDepthMeters,
    parcelLayoutState.settings.solutionPreference,
    parcelLayoutState.settings.automaticMode,
    parcelLayoutState.settings.remainderDistribution,
    activeProject.entities.length,
  ]);

  useEffect(() => {
    setViewport({ zoom: 1, panX: 0, panY: 0 });
    setViewBounds(cloneBounds(cadProject.bounds));
  }, [cadProject.bounds, cadProject.id]);

  useEffect(() => {
    const isEditableTarget = (target: EventTarget | null): boolean =>
      (target instanceof HTMLInputElement && !target.disabled && !target.readOnly) ||
      (target instanceof HTMLTextAreaElement && !target.disabled && !target.readOnly) ||
      (target instanceof HTMLElement && target.isContentEditable);

    const handleKeyDown = (event: KeyboardEvent) => {
      const target = event.target;
      if (event.key === 'Escape') {
        if (activeCommandKey == null && selectionCount === 0) return;
        event.preventDefault();
        if (activeCommandKey) {
          handleEscapeKey();
          return;
        }
        clearSelection();
        return;
      }
      if (event.key === ' ' && (canCycleActiveSnap || isGripEditing) && nearbySnaps.length > 1) {
        event.preventDefault();
        cycleActiveSnap();
        return;
      }
      if (event.key === 'Control') {
        setReverseDirectionModifier(true);
      }
      const modifierKey = event.ctrlKey || event.metaKey;
      if (modifierKey && !isEditableTarget(target)) {
        const lowerKey = event.key.toLowerCase();
        if (lowerKey === 'c' && selectionCount > 0) {
          event.preventDefault();
          setCopiedEntityIds(selectedEntityIds);
          copiedEntityIdsRef.current = selectedEntityIds;
          return;
        }
        if (lowerKey === 'v' && copiedEntityIdsRef.current.length > 0) {
          event.preventDefault();
          startPasteFromClipboard(copiedEntityIdsRef.current);
          return;
        }
        if (lowerKey === 'z') {
          event.preventDefault();
          if (event.shiftKey) {
            redo();
            return;
          }
          undo();
          return;
        }
        if (lowerKey === 'y') {
          event.preventDefault();
          redo();
          return;
        }
      }
      if (event.key === 'Enter' && activeCommandKey != null) {
        if (isEditableTarget(target)) return;
        event.preventDefault();
        handleEnterKey();
        return;
      }
      if (
        activeCommandKey == null &&
        !modifierKey &&
        !isEditableTarget(target) &&
        !event.altKey &&
        selectionCount > 0 &&
        (event.key === 'Backspace' || event.key === 'Delete')
      ) {
        event.preventDefault();
        eraseSelection();
        return;
      }
      if (activeCommandKey == null || modifierKey || isEditableTarget(target) || event.altKey) return;
      if (event.key === 'Backspace') {
        event.preventDefault();
        backspaceCommandInputValue();
        return;
      }
      if (event.key.length !== 1) return;
      event.preventDefault();
      appendCommandInputValue(event.key);
    };
    window.addEventListener('keydown', handleKeyDown);
    const handleKeyUp = (event: KeyboardEvent) => {
      if (event.key === 'Control') {
        setReverseDirectionModifier(false);
      }
    };
    const handleBlur = () => setReverseDirectionModifier(false);
    window.addEventListener('keyup', handleKeyUp);
    window.addEventListener('blur', handleBlur);
    return () => {
      window.removeEventListener('keydown', handleKeyDown);
      window.removeEventListener('keyup', handleKeyUp);
      window.removeEventListener('blur', handleBlur);
    };
  }, [
    activeCommandKey,
    appendCommandInputValue,
    backspaceCommandInputValue,
    clearSelection,
    canCycleActiveSnap,
    isGripEditing,
    cycleActiveSnap,
    eraseSelection,
    handleEnterKey,
    handleEscapeKey,
    nearbySnaps.length,
    copiedEntityIds,
    redo,
    selectedEntityIds,
    selectionCount,
    startPasteFromClipboard,
    undo,
  ]);

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
              canSplitParcelBySlide={directParcelSplitTarget != null}
              canSplitParcelBySwing={directParcelSplitTarget != null}
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
              onSetDock={(dock) => {
                setPropertiesPanelUiState((current) => ({ ...current, dock }));
                if (dock !== 'floating') touchPanelDockOrder('properties');
              }}
              onToggleCollapsed={() =>
                setPropertiesPanelUiState((current) => ({
                  ...current,
                  collapsed: !current.collapsed,
                }))
              }
              onClose={() => clearSelection()}
              onStartDrag={(event) => {
                if (propertiesPanelUiState.dock !== 'floating') return;
                if (event.button !== 0) return;
                const target = event.target;
                if (
                  target instanceof HTMLElement &&
                  target.closest('button, input, select, textarea, label, a')
                ) {
                  return;
                }
                event.preventDefault();
                event.stopPropagation();
                propertiesPanelDragRef.current = {
                  pointerId: event.pointerId,
                  startClientX: event.clientX,
                  startClientY: event.clientY,
                  startLeftPx: propertiesPanelUiState.floatingLeftPx,
                  startTopPx: propertiesPanelUiState.floatingTopPx,
                };
                setIsPropertiesPanelDragging(true);
              }}
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
              parentParcelName={parcelLayoutParentEntity?.parcelName ?? null}
              frontageLabel={parcelLayoutFrontageLabel}
              previewStatus={parcelLayoutPreviewStatus}
              previewDetails={parcelLayoutPreviewDetails}
              hasPreview={parcelLayoutPreviewState != null || parcelLayoutAutoPreviewState != null}
              canAcceptPreview={
                parcelLayoutAutoPreviewState != null
                  ? parcelLayoutState.settings.automaticMode === 'single_preview'
                  : (parcelLayoutPreviewState?.candidate.isValid ?? false)
              }
              canPreviewLayout={canPreviewParcelSlideOrSwing}
              canUseCurrentSelectionAsParent={selectedParcelForLayout != null}
              canUseCurrentSelectionAsFrontage={selectedFrontageForLayout != null}
              onClose={() => updateParcelLayoutState((current) => ({ ...current, open: false }))}
              onToggleCollapsed={() => updateParcelLayoutState((current) => ({ ...current, collapsed: !current.collapsed }))}
              onSetDock={(dock) => {
                updateParcelLayoutState((current) => ({ ...current, dock }));
                touchPanelDockOrder('parcel-layout');
              }}
              dockOffsetPx={dockedPanelOffsets['parcel-layout']}
              onStartDrag={(event) => {
                if (parcelLayoutState.dock !== 'floating') return;
                if (event.button !== 0) return;
                const target = event.target;
                if (
                  target instanceof HTMLElement &&
                  target.closest('button, input, select, textarea, label, a')
                ) {
                  return;
                }
                event.preventDefault();
                event.stopPropagation();
                parcelLayoutResizeRef.current = null;
                setParcelLayoutResizeDirection(null);
                parcelLayoutDragRef.current = {
                  pointerId: event.pointerId,
                  startClientX: event.clientX,
                  startClientY: event.clientY,
                  startLeftPx: parcelLayoutState.floatingLeftPx,
                  startTopPx: parcelLayoutState.floatingTopPx,
                };
                setIsParcelLayoutDragging(true);
              }}
              onStartResize={(direction, event) => {
                if (parcelLayoutState.dock !== 'floating') return;
                if (event.button !== 0) return;
                event.preventDefault();
                event.stopPropagation();
                parcelLayoutDragRef.current = null;
                setIsParcelLayoutDragging(false);
                parcelLayoutResizeRef.current = {
                  pointerId: event.pointerId,
                  direction,
                  startClientX: event.clientX,
                  startClientY: event.clientY,
                  startWidthPx: parcelLayoutState.floatingWidthPx,
                  startHeightPx: parcelLayoutState.floatingHeightPx,
                  startLeftPx: parcelLayoutState.floatingLeftPx,
                  startTopPx: parcelLayoutState.floatingTopPx,
                };
                setParcelLayoutResizeDirection(direction);
              }}
              onUseSelectedParent={() => {
                if (!selectedParcelForLayout || selectedParcelForLayout.type !== 'parcel') return;
                updateParcelLayoutState((current) => ({
                  ...current,
                  activeParentParcelId: selectedParcelForLayout.id,
                }));
              }}
              onUseSelectedFrontage={() => {
                if (!selectedFrontageForLayout) return;
                updateParcelLayoutState((current) => ({
                  ...current,
                  activeFrontageEntityId: selectedFrontageForLayout.id,
                }));
              }}
              onClearParent={() => updateParcelLayoutState((current) => ({ ...current, activeParentParcelId: null }))}
              onClearFrontage={() => updateParcelLayoutState((current) => ({ ...current, activeFrontageEntityId: null }))}
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
              canReportGap={canReportParcelGap}
              canReportCheck={canReportParcelDiagnostics}
              canReportOverlap={canReportParcelOverlap}
            />
          ) : null}
          {activeBatchCogoDraft ? (
            <div
              className="absolute right-4 top-20 z-20 w-[28rem] rounded border border-slate-700/80 bg-slate-950/90 p-3 text-xs text-slate-100 shadow-xl"
              data-survey-cad-batch-cogo-draft
            >
              <div className="mb-2 flex items-center justify-between">
                <span className="font-semibold tracking-wide text-cyan-200">Batch COGO</span>
                <span className="text-slate-400">
                  {activeBatchCogoDraft.generatedPointCount} pts / {activeBatchCogoDraft.generatedLineCount} lines / {activeBatchCogoDraft.generatedArcCount} arcs
                </span>
              </div>
              <div className="mb-2 grid grid-cols-[auto,1fr] gap-x-3 gap-y-1 text-[11px] text-slate-300">
                <span>Start</span>
                <span data-survey-cad-batch-cogo-start>
                  {activeBatchCogoDraft.startPoint
                    ? `${activeBatchCogoDraft.startPoint.label} (${activeBatchCogoDraft.startPointSource ?? 'input'})`
                    : '--'}
                </span>
                <span>End</span>
                <span data-survey-cad-batch-cogo-end>{activeBatchCogoDraft.endPoint?.label ?? '--'}</span>
              </div>
              <textarea
                className="mb-2 h-32 w-full rounded border border-slate-700 bg-slate-900 px-2 py-1 text-[11px] text-slate-100 outline-none focus:border-cyan-400"
                placeholder={'START POB=1000,1000\nP1=N45-00-00E,100\nCURVE RIGHT R 50 DELTA 30'}
                value={activeBatchCogoDraft.inputValue}
                onChange={(event) => setBatchCogoInputValue(event.target.value)}
                data-survey-cad-batch-cogo-input
              />
              <div className="mb-2 flex gap-2">
                <button
                  type="button"
                  className="pointer-events-auto rounded border border-slate-700 px-2 py-1 text-[11px] text-slate-200 enabled:hover:border-cyan-400 enabled:hover:text-cyan-200 disabled:cursor-not-allowed disabled:opacity-40"
                  onClick={commitBatchCogoDraft}
                  disabled={!activeBatchCogoDraft.canCommit}
                  data-survey-cad-batch-cogo-commit
                >
                  Commit
                </button>
                <button
                  type="button"
                  className="pointer-events-auto rounded border border-slate-700 px-2 py-1 text-[11px] text-slate-200 hover:border-cyan-400 hover:text-cyan-200"
                  onClick={handleEscapeKey}
                  data-survey-cad-batch-cogo-cancel
                >
                  Cancel
                </button>
              </div>
              <div className="mb-2 max-h-40 overflow-auto rounded border border-slate-800/80 bg-slate-900/60 p-2 text-[11px]">
                {activeBatchCogoDraft.previewRows.length === 0 ? (
                  <div className="text-slate-400">Paste deed rows to preview generated geometry.</div>
                ) : (
                  activeBatchCogoDraft.previewRows.map((row) => (
                    <div
                      key={`${row.lineNumber}:${row.input}`}
                      className="mb-1 border-b border-slate-800/70 pb-1 last:mb-0 last:border-b-0 last:pb-0"
                      data-survey-cad-batch-cogo-row
                    >
                      <div className="flex items-center justify-between gap-2">
                        <span className="text-slate-200">
                          Row {row.lineNumber} · {row.kind}
                        </span>
                        <span
                          className={
                            row.status === 'ok'
                              ? 'text-cyan-200'
                              : row.status === 'warning'
                                ? 'text-amber-200'
                                : 'text-rose-200'
                          }
                        >
                          {row.status}
                        </span>
                      </div>
                      <div className="text-slate-400">{row.input}</div>
                      <div>{row.summary}</div>
                    </div>
                  ))
                )}
              </div>
              {activeBatchCogoDraft.warnings.length > 0 ? (
                <div className="rounded border border-amber-900/60 bg-amber-950/20 p-2 text-[11px] text-amber-100" data-survey-cad-batch-cogo-warnings>
                  {activeBatchCogoDraft.warnings.map((warning) => (
                    <div key={`${warning.code}:${warning.message}`}>[{warning.severity}] {warning.message}</div>
                  ))}
                </div>
              ) : null}
            </div>
          ) : null}
          {activeTraverseDraft ? (
            <div
              className="absolute right-4 top-20 z-20 w-[26rem] rounded border border-slate-700/80 bg-slate-950/90 p-3 text-xs text-slate-100 shadow-xl"
              data-survey-cad-traverse-draft
            >
              <div className="mb-2 flex items-center justify-between">
                <span className="font-semibold tracking-wide text-cyan-200">Traverse Draft</span>
                <span className="text-slate-400">{activeTraverseDraft.points.length} pts</span>
              </div>
              <div className="mb-3 flex flex-wrap gap-2">
                <button
                  type="button"
                  className={`pointer-events-auto rounded border px-2 py-1 text-[11px] ${activeTraverseDraft.mode === 'open' ? 'border-cyan-400 text-cyan-200' : 'border-slate-700 text-slate-300 hover:border-cyan-400 hover:text-cyan-200'}`}
                  onClick={() => setTraverseDraftMode('open')}
                  data-survey-cad-traverse-mode-open
                >
                  Open
                </button>
                <button
                  type="button"
                  className={`pointer-events-auto rounded border px-2 py-1 text-[11px] ${activeTraverseDraft.mode === 'closed' ? 'border-cyan-400 text-cyan-200' : 'border-slate-700 text-slate-300 hover:border-cyan-400 hover:text-cyan-200'}`}
                  onClick={() => setTraverseDraftMode('closed')}
                  data-survey-cad-traverse-mode-closed
                >
                  Closed
                </button>
                <button
                  type="button"
                  className={`pointer-events-auto rounded border px-2 py-1 text-[11px] ${activeTraverseDraft.mode === 'point-to-point' ? 'border-cyan-400 text-cyan-200' : 'border-slate-700 text-slate-300 hover:border-cyan-400 hover:text-cyan-200'}`}
                  onClick={() => setTraverseDraftMode('point-to-point')}
                  data-survey-cad-traverse-mode-point-to-point
                >
                  Point-To-Point
                </button>
              </div>
              {activeTraverseDraft.mode === 'point-to-point' ? (
                <div className="mb-3 rounded border border-slate-800/80 bg-slate-900/60 p-2 text-[11px]">
                  <div className="mb-2 flex items-center justify-between text-slate-300">
                    <span>Close target</span>
                    <span data-survey-cad-traverse-close-target>{activeTraverseDraft.closePoint?.label ?? '--'}</span>
                  </div>
                  <div className="flex flex-wrap gap-2">
                    <button
                      type="button"
                      className="pointer-events-auto rounded border border-slate-700 px-2 py-1 text-[11px] text-slate-200 enabled:hover:border-cyan-400 enabled:hover:text-cyan-200 disabled:cursor-not-allowed disabled:opacity-40"
                      onClick={() =>
                        selectedTraverseClosePoint
                          ? setTraverseDraftClosePoint({
                              label: selectedTraverseClosePoint.stationId,
                              x: selectedTraverseClosePoint.x,
                              y: selectedTraverseClosePoint.y,
                            })
                          : null
                      }
                      disabled={selectedTraverseClosePoint == null}
                      data-survey-cad-traverse-use-selected-close
                    >
                      Use Selected Point
                    </button>
                    <button
                      type="button"
                      className="pointer-events-auto rounded border border-slate-700 px-2 py-1 text-[11px] text-slate-200 enabled:hover:border-cyan-400 enabled:hover:text-cyan-200 disabled:cursor-not-allowed disabled:opacity-40"
                      onClick={() => setTraverseDraftClosePoint(null)}
                      disabled={activeTraverseDraft.closePoint == null}
                      data-survey-cad-traverse-clear-close
                    >
                      Clear Target
                    </button>
                  </div>
                </div>
              ) : null}
              <div className="mb-3 flex gap-2">
                <button
                  type="button"
                  className="pointer-events-auto rounded border border-slate-700 px-2 py-1 text-[11px] text-slate-200 enabled:hover:border-cyan-400 enabled:hover:text-cyan-200 disabled:cursor-not-allowed disabled:opacity-40"
                  onClick={() => rewindTraverseDraftToPointCount(Math.max(activeTraverseDraft.points.length - 1, 0))}
                  disabled={activeTraverseDraft.points.length < 2}
                  data-survey-cad-traverse-rewind-last
                >
                  Undo Leg
                </button>
                <button
                  type="button"
                  className="pointer-events-auto rounded border border-slate-700 px-2 py-1 text-[11px] text-slate-200 enabled:hover:border-cyan-400 enabled:hover:text-cyan-200 disabled:cursor-not-allowed disabled:opacity-40"
                  onClick={closeTraverseDraftLoop}
                  disabled={!canCloseTraverseDraft}
                  data-survey-cad-traverse-close-loop
                >
                  Close To Start
                </button>
                <button
                  type="button"
                  className="pointer-events-auto rounded border border-slate-700 px-2 py-1 text-[11px] text-slate-200 enabled:hover:border-cyan-400 enabled:hover:text-cyan-200 disabled:cursor-not-allowed disabled:opacity-40"
                  onClick={handleEnterKey}
                  disabled={!canFinishCommand}
                  data-survey-cad-traverse-finish
                >
                  Finish
                </button>
                <button
                  type="button"
                  className="pointer-events-auto rounded border border-slate-700 px-2 py-1 text-[11px] text-slate-200 hover:border-cyan-400 hover:text-cyan-200"
                  onClick={handleEscapeKey}
                  data-survey-cad-traverse-cancel
                >
                  Cancel
                </button>
              </div>
              <div className="mb-3 grid grid-cols-[minmax(0,1fr)_auto] gap-2">
                <input
                  type="text"
                  className="rounded border border-slate-700 bg-slate-900 px-2 py-1 text-[11px] text-slate-100 outline-none focus:border-cyan-400"
                  placeholder={
                    activeTraverseDraft.points.length === 0
                      ? 'A=0,0'
                      : 'N45-00-00E,100 or @45,100'
                  }
                  value={newTraverseLegInput}
                  onChange={(event) => setNewTraverseLegInput(event.target.value)}
                  onKeyDown={(event) => {
                    if (event.key === 'Enter') {
                      event.preventDefault();
                      appendTraverseLegFromPanel();
                    }
                  }}
                  data-survey-cad-traverse-next-input
                />
                <button
                  type="button"
                  className="pointer-events-auto rounded border border-slate-700 px-2 py-1 text-[11px] text-slate-200 hover:border-cyan-400 hover:text-cyan-200"
                  onClick={appendTraverseLegFromPanel}
                  data-survey-cad-traverse-next-add
                >
                  Add Leg
                </button>
              </div>
              <div className="max-h-64 overflow-auto pr-1">
                {activeTraverseDraft.legs.length === 0 ? (
                  <div className="text-slate-400">Capture the first two stations to populate leg rows.</div>
                ) : (
                  <>
                    {insertingTraverseLegIndex != null ? (
                      <div
                        className="mb-2 rounded border border-slate-800/80 bg-slate-900/60 p-2 text-[11px] text-slate-200"
                        data-survey-cad-traverse-insert-panel
                      >
                        <div className="mb-2">
                          Insert before leg {insertingTraverseLegIndex + 1}
                        </div>
                        <div className="grid grid-cols-[minmax(0,1fr)_auto_auto] gap-2">
                          <input
                            type="text"
                            className="rounded border border-slate-700 bg-slate-900 px-2 py-1 text-[11px] text-slate-100 outline-none focus:border-cyan-400"
                            placeholder="N45-00-00E,100 or @45,100"
                            value={insertingTraverseLegInput}
                            onChange={(event) => setInsertingTraverseLegInput(event.target.value)}
                            onKeyDown={(event) => {
                              if (event.key === 'Enter') {
                                event.preventDefault();
                                applyTraverseLegInsert();
                              }
                              if (event.key === 'Escape') {
                                event.preventDefault();
                                cancelTraverseLegInsert();
                              }
                            }}
                            data-survey-cad-traverse-insert-input
                          />
                          <button
                            type="button"
                            className="pointer-events-auto rounded border border-slate-700 px-2 py-1 text-[11px] text-slate-200 hover:border-cyan-400 hover:text-cyan-200"
                            onClick={applyTraverseLegInsert}
                            data-survey-cad-traverse-insert-apply
                          >
                            Insert
                          </button>
                          <button
                            type="button"
                            className="pointer-events-auto rounded border border-slate-700 px-2 py-1 text-[11px] text-slate-200 hover:border-cyan-400 hover:text-cyan-200"
                            onClick={cancelTraverseLegInsert}
                            data-survey-cad-traverse-insert-cancel
                          >
                            Cancel
                          </button>
                        </div>
                      </div>
                    ) : null}
                    <table className="w-full border-collapse text-left">
                      <thead>
                        <tr className="text-[11px] uppercase tracking-wide text-slate-400">
                          <th className="pb-1 font-medium">Leg</th>
                          <th className="pb-1 font-medium">Input</th>
                          <th className="pb-1 text-right font-medium">Dist</th>
                          <th className="pb-1 text-right font-medium">Row</th>
                        </tr>
                      </thead>
                      <tbody>
                        {activeTraverseDraft.legs.map((leg, index) => {
                          const isEditing = editingTraverseLegIndex === index;
                          return (
                            <tr
                              key={`${leg.fromLabel}-${leg.toLabel}-${index}`}
                              className="border-t border-slate-800/80"
                              data-survey-cad-traverse-leg
                            >
                              <td className="py-1 pr-2 text-slate-200">{leg.fromLabel} - {leg.toLabel}</td>
                              <td className="py-1 pr-2 text-slate-300">
                                {isEditing ? (
                                  <input
                                    type="text"
                                    value={editingTraverseLegInput}
                                    onChange={(event) => setEditingTraverseLegInput(event.target.value)}
                                    onKeyDown={(event) => {
                                      if (event.key === 'Enter') {
                                        event.preventDefault();
                                        applyTraverseLegEdit();
                                      }
                                      if (event.key === 'Escape') {
                                        event.preventDefault();
                                        cancelTraverseLegEdit();
                                      }
                                    }}
                                    className="w-full rounded border border-slate-700 bg-slate-900 px-2 py-1 text-[11px] text-slate-100 outline-none focus:border-cyan-400"
                                    data-survey-cad-traverse-edit-input={index}
                                  />
                                ) : (
                                  leg.inputValue
                                )}
                              </td>
                              <td className="py-1 text-right text-slate-200">
                                {isEditing ? '--' : leg.distance.toFixed(3)}
                              </td>
                              <td className="py-1 pl-2 text-right">
                                {isEditing ? (
                                  <>
                                    <button
                                      type="button"
                                      className="pointer-events-auto mr-1 rounded border border-slate-700 px-1.5 py-0.5 text-[10px] text-slate-300 hover:border-cyan-400 hover:text-cyan-200"
                                      onClick={applyTraverseLegEdit}
                                      data-survey-cad-traverse-apply-leg={index}
                                    >
                                      Apply
                                    </button>
                                    <button
                                      type="button"
                                      className="pointer-events-auto rounded border border-slate-700 px-1.5 py-0.5 text-[10px] text-slate-300 hover:border-cyan-400 hover:text-cyan-200"
                                      onClick={cancelTraverseLegEdit}
                                      data-survey-cad-traverse-cancel-leg={index}
                                    >
                                      Cancel
                                    </button>
                                  </>
                                ) : (
                                  <div className="flex flex-wrap justify-end gap-1">
                                    <button
                                      type="button"
                                      className="pointer-events-auto rounded border border-slate-700 px-1.5 py-0.5 text-[10px] text-slate-300 hover:border-cyan-400 hover:text-cyan-200"
                                      onClick={() => startTraverseLegInsert(index)}
                                      data-survey-cad-traverse-insert-leg={index}
                                    >
                                      Insert
                                    </button>
                                    <button
                                      type="button"
                                      className="pointer-events-auto rounded border border-slate-700 px-1.5 py-0.5 text-[10px] text-slate-300 hover:border-cyan-400 hover:text-cyan-200"
                                      onClick={() => nudgeTraverseLeg(index, -1)}
                                      disabled={index === 0}
                                      data-survey-cad-traverse-move-up={index}
                                    >
                                      Up
                                    </button>
                                    <button
                                      type="button"
                                      className="pointer-events-auto rounded border border-slate-700 px-1.5 py-0.5 text-[10px] text-slate-300 hover:border-cyan-400 hover:text-cyan-200"
                                      onClick={() => nudgeTraverseLeg(index, 1)}
                                      disabled={index === activeTraverseDraft.legs.length - 1}
                                      data-survey-cad-traverse-move-down={index}
                                    >
                                      Down
                                    </button>
                                    <button
                                      type="button"
                                      className="pointer-events-auto rounded border border-slate-700 px-1.5 py-0.5 text-[10px] text-slate-300 hover:border-cyan-400 hover:text-cyan-200"
                                      onClick={() => startTraverseLegEdit(index)}
                                      data-survey-cad-traverse-edit-leg={index}
                                    >
                                      Edit
                                    </button>
                                    <button
                                      type="button"
                                      className="pointer-events-auto rounded border border-slate-700 px-1.5 py-0.5 text-[10px] text-slate-300 hover:border-cyan-400 hover:text-cyan-200"
                                      onClick={() => rewindTraverseDraftToPointCount(index + 1)}
                                      data-survey-cad-traverse-rewind-leg={index}
                                    >
                                      Rewind
                                    </button>
                                  </div>
                                )}
                              </td>
                            </tr>
                          );
                        })}
                      </tbody>
                    </table>
                  </>
                )}
              </div>
              <div className="mt-3 border-t border-slate-800/80 pt-2 text-slate-300">
                <div className="flex justify-between">
                  <span>Total Length</span>
                  <span>{activeTraverseDraft.totalLength.toFixed(3)} m</span>
                </div>
                <div className="flex justify-between">
                  <span>Closure Target</span>
                  <span>{activeTraverseDraft.closureTargetLabel ?? '--'}</span>
                </div>
                <div className="flex justify-between">
                  <span>Closure dE</span>
                  <span>{activeTraverseDraft.closureDeltaX == null ? '--' : `${activeTraverseDraft.closureDeltaX.toFixed(3)} m`}</span>
                </div>
                <div className="flex justify-between">
                  <span>Closure dN</span>
                  <span>{activeTraverseDraft.closureDeltaY == null ? '--' : `${activeTraverseDraft.closureDeltaY.toFixed(3)} m`}</span>
                </div>
                <div className="flex justify-between" data-survey-cad-traverse-closure>
                  <span>Closure</span>
                  <span>{activeTraverseDraft.closureDistance == null ? '--' : `${activeTraverseDraft.closureDistance.toFixed(3)} m`}</span>
                </div>
                <div className="flex justify-between">
                  <span>Closure Bearing</span>
                  <span>{activeTraverseDraft.closureBearing ?? '--'}</span>
                </div>
                <div className="flex justify-between" data-survey-cad-traverse-closure-ratio>
                  <span>Closure Ratio</span>
                  <span>{activeTraverseDraft.closureRatio == null ? '--' : `1:${activeTraverseDraft.closureRatio.toFixed(0)}`}</span>
                </div>
              </div>
              <div className="mt-3 border-t border-slate-800/80 pt-2 text-slate-300">
                <div className="mb-2 flex items-center justify-between">
                  <span className="font-semibold text-cyan-200">Adjustment</span>
                  <span data-survey-cad-traverse-adjustment-method>
                    {activeTraverseDraft.adjustment?.method ?? '--'}
                  </span>
                </div>
                <div className="mb-2 flex flex-wrap gap-2">
                  <button
                    type="button"
                    className="pointer-events-auto rounded border border-slate-700 px-2 py-1 text-[11px] text-slate-200 enabled:hover:border-cyan-400 enabled:hover:text-cyan-200 disabled:cursor-not-allowed disabled:opacity-40"
                    onClick={() => applyTraverseDraftAdjustment('angular')}
                    disabled={activeTraverseDraft.mode === 'open' || activeTraverseDraft.points.length < 2 || activeTraverseDraft.closureTargetLabel == null}
                    data-survey-cad-traverse-adjust-angular
                  >
                    Angular
                  </button>
                  <button
                    type="button"
                    className="pointer-events-auto rounded border border-slate-700 px-2 py-1 text-[11px] text-slate-200 enabled:hover:border-cyan-400 enabled:hover:text-cyan-200 disabled:cursor-not-allowed disabled:opacity-40"
                    onClick={() => applyTraverseDraftAdjustment('bowditch')}
                    disabled={activeTraverseDraft.mode === 'open' || activeTraverseDraft.points.length < 2 || activeTraverseDraft.closureTargetLabel == null}
                    data-survey-cad-traverse-adjust-bowditch
                  >
                    Bowditch
                  </button>
                  <button
                    type="button"
                    className="pointer-events-auto rounded border border-slate-700 px-2 py-1 text-[11px] text-slate-200 enabled:hover:border-cyan-400 enabled:hover:text-cyan-200 disabled:cursor-not-allowed disabled:opacity-40"
                    onClick={() => applyTraverseDraftAdjustment('transit')}
                    disabled={activeTraverseDraft.mode === 'open' || activeTraverseDraft.points.length < 2 || activeTraverseDraft.closureTargetLabel == null}
                    data-survey-cad-traverse-adjust-transit
                  >
                    Transit
                  </button>
                  <button
                    type="button"
                    className="pointer-events-auto rounded border border-slate-700 px-2 py-1 text-[11px] text-slate-200 enabled:hover:border-cyan-400 enabled:hover:text-cyan-200 disabled:cursor-not-allowed disabled:opacity-40"
                    onClick={clearTraverseDraftAdjustment}
                    disabled={activeTraverseDraft.adjustment == null}
                    data-survey-cad-traverse-adjust-clear
                  >
                    Clear
                  </button>
                </div>
                {activeTraverseDraft.adjustment ? (
                  <div className="space-y-1 text-[11px]" data-survey-cad-traverse-adjustment-report>
                    <div className="flex justify-between">
                      <span>Raw closure</span>
                      <span>{activeTraverseDraft.adjustment.rawClosureDistance.toFixed(3)} m</span>
                    </div>
                    <div className="flex justify-between">
                      <span>Adjusted closure</span>
                      <span>{activeTraverseDraft.adjustment.adjustedClosureDistance.toFixed(3)} m</span>
                    </div>
                    <div className="flex justify-between">
                      <span>Raw bearing</span>
                      <span>{activeTraverseDraft.adjustment.rawClosureBearing ?? '--'}</span>
                    </div>
                    <div className="flex justify-between">
                      <span>Adjusted bearing</span>
                      <span>{activeTraverseDraft.adjustment.adjustedClosureBearing ?? '--'}</span>
                    </div>
                    <div className="flex justify-between">
                      <span>Angular / leg</span>
                      <span>
                        {activeTraverseDraft.adjustment.angularCorrectionPerLegSec == null
                          ? '--'
                          : `${activeTraverseDraft.adjustment.angularCorrectionPerLegSec.toFixed(2)}"`}
                      </span>
                    </div>
                  </div>
                ) : (
                  <div className="text-[11px] text-slate-400">
                    Apply angular, Bowditch, or transit balance against the current closure target before commit.
                  </div>
                )}
              </div>
              <div className="mt-3 border-t border-slate-800/80 pt-2 text-slate-300">
                <div className="mb-2 flex items-center justify-between">
                  <span className="font-semibold text-cyan-200">Sideshots</span>
                  <span data-survey-cad-traverse-sideshot-count>{activeTraverseDraft.sideshots.length}</span>
                </div>
                {activeTraverseDraft.points.length > 1 ? (
                  <div className="mb-2 grid grid-cols-[minmax(0,1fr)_minmax(0,1.4fr)_auto] gap-2">
                    <select
                      className="rounded border border-slate-700 bg-slate-900 px-2 py-1 text-[11px] text-slate-100"
                      value={newTraverseSideshotOccupyIndex}
                      onChange={(event) => setNewTraverseSideshotOccupyIndex(Number(event.target.value))}
                      data-survey-cad-traverse-sideshot-occupy
                    >
                      {activeTraverseDraft.points.map((point, index) =>
                        index === 0 ? null : (
                          <option key={`${point.label}-${index}`} value={index}>
                            {point.label} bs {activeTraverseDraft.points[index - 1]?.label}
                          </option>
                        ),
                      )}
                    </select>
                    <input
                      type="text"
                      className="rounded border border-slate-700 bg-slate-900 px-2 py-1 text-[11px] text-slate-100 outline-none focus:border-cyan-400"
                      placeholder="L45,20 or R12-30-00,15"
                      value={newTraverseSideshotInput}
                      onChange={(event) => setNewTraverseSideshotInput(event.target.value)}
                      onKeyDown={(event) => {
                        if (event.key === 'Enter') {
                          event.preventDefault();
                          applyTraverseSideshot();
                        }
                      }}
                      data-survey-cad-traverse-sideshot-input
                    />
                    <button
                      type="button"
                      className="pointer-events-auto rounded border border-slate-700 px-2 py-1 text-[11px] text-slate-200 hover:border-cyan-400 hover:text-cyan-200"
                      onClick={applyTraverseSideshot}
                      data-survey-cad-traverse-sideshot-add
                    >
                      Add
                    </button>
                  </div>
                ) : (
                  <div className="mb-2 text-slate-400">Capture at least two traverse stations before adding sideshots.</div>
                )}
                {activeTraverseDraft.sideshots.length === 0 ? (
                  <div className="text-slate-400">No sideshots yet.</div>
                ) : (
                  <div className="max-h-28 space-y-1 overflow-auto pr-1">
                    {activeTraverseDraft.sideshots.map((sideshot, index) => (
                      <div
                        key={`${sideshot.point.label}-${index}`}
                        className="flex items-center justify-between rounded border border-slate-800/80 px-2 py-1"
                        data-survey-cad-traverse-sideshot-row
                      >
                        <span>
                          {sideshot.occupyLabel} {'->'} {sideshot.point.label} ({sideshot.inputValue})
                        </span>
                        <button
                          type="button"
                          className="pointer-events-auto rounded border border-slate-700 px-1.5 py-0.5 text-[10px] text-slate-300 hover:border-cyan-400 hover:text-cyan-200"
                          onClick={() => removeTraverseDraftSideshot(index)}
                          data-survey-cad-traverse-sideshot-remove={index}
                        >
                          Remove
                        </button>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            </div>
          ) : null}
          <SurveyCadPreview
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
