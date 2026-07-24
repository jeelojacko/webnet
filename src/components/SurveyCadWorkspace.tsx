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
import SurveyCadCommandToolbar from './surveyCad/SurveyCadCommandToolbar';
import SurveyCadWorkspaceSurface from './SurveyCadWorkspaceSurface';
import { useSurveyCadCommandDisplay } from './useSurveyCadCommandDisplay';
import { useSurveyCadFloatingPanels } from './useSurveyCadFloatingPanels';
import { useSurveyCadParcelLayoutWorkflow } from './useSurveyCadParcelLayoutWorkflow';
import { useSurveyCadTraverseDraftPanelState } from './useSurveyCadTraverseDraftPanelState';
import { useSurveyCadWorkspaceKeyboard } from './useSurveyCadWorkspaceKeyboard';
import {
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
  const cadWorkspace = useSurveyCadWorkspace(
    cadProject,
    persistedState,
    onPersistedStateChange,
    parcelLayoutState,
    showParcelLabels,
    reverseDirectionModifier,
  );
  const {
    cadProject: activeProject,
    displayScene,
    activeTraverseDraft,
    selectedEntityIds,
    selectedEntities,
    reportedComputation,
    propertiesPanelState,
    selectionCount,
    activeCommandKey,
    statusText,
    commandPreviewPrimitives,
    canCreateParcel,
    isGripEditing,
    canCycleActiveSnap,
    nearbySnaps,
    snapConstructionContext,
    appendCommandInputValue,
    backspaceCommandInputValue,
    handleEnterKey,
    handleEscapeKey,
    appendTraverseDraftPoint,
    insertTraverseDraftLeg,
    moveTraverseDraftLeg,
    replaceTraverseDraftLeg,
    addTraverseDraftSideshot,
    cycleActiveSnap,
    clearSelection,
    eraseSelection,
    startPasteFromClipboard,
    undo,
    redo,
  } = cadWorkspace;
  const copiedEntityIdsRef = useRef<string[]>([]);
  const parcelLayoutHydrationKeyRef = useRef<string | null>(null);
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

  const traverseDraftPanelState = useSurveyCadTraverseDraftPanelState({
    activeTraverseDraft,
    selectedEntities,
    addTraverseDraftSideshot,
    appendTraverseDraftPoint,
    insertTraverseDraftLeg,
    moveTraverseDraftLeg,
    replaceTraverseDraftLeg,
  });
  const commandDisplay = useSurveyCadCommandDisplay({
    activeCommandKey,
    reverseDirectionModifier,
    snapConstructionContext,
    snapPreferences: cadWorkspace.snapPreferences,
    statusText,
  });

  const floatingPanels = useSurveyCadFloatingPanels({
    parcelLayoutState,
    setParcelLayoutState,
    propertiesPanelVisible: propertiesPanelState != null,
  });
  const parcelLayoutWorkflow = useSurveyCadParcelLayoutWorkflow({
    activeProject,
    commandPreviewPrimitives,
    selectedEntities,
    canCreateParcel,
    createParcelFromSelection: cadWorkspace.createParcelFromSelection,
    commitParcelSlideLayout: cadWorkspace.commitParcelSlideLayout,
    commitParcelSwingLayout: cadWorkspace.commitParcelSwingLayout,
    commitParcelAutoLayout: cadWorkspace.commitParcelAutoLayout,
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
        <SurveyCadCommandToolbar
          workspace={cadWorkspace}
          canSplitParcelBySlideOrSwing={parcelLayoutWorkflow.canSplitParcelBySlideOrSwing}
          onCreateParcel={parcelLayoutWorkflow.createPrimaryParcelLayout}
          onSplitParcelBySlide={parcelLayoutWorkflow.splitParcelBySlide}
          onSplitParcelBySwing={parcelLayoutWorkflow.splitParcelBySwing}
          onToggleParcelLayoutPanel={floatingPanels.toggleParcelLayoutPanel}
        />
        <SurveyCadWorkspaceSurface
          workspace={cadWorkspace}
          floatingPanels={floatingPanels}
          parcelLayoutWorkflow={parcelLayoutWorkflow}
          traverseDraftPanelState={traverseDraftPanelState}
          commandDisplay={commandDisplay}
          displayScene={displaySceneWithParcelLabelToggle}
          reportedComputationEntities={reportedComputationEntities}
          parcelLayoutState={parcelLayoutState}
          parcelLayoutFrontageSegmentSelectionActive={parcelLayoutFrontageSegmentSelectionActive}
          showParcelLabels={showParcelLabels}
          viewport={viewport}
          viewBounds={viewBounds}
          onViewportChange={setViewport}
          onViewBoundsChange={setViewBounds}
          onParcelLayoutPreviewStateChange={setParcelLayoutPreviewState}
          onParcelLayoutAutoPreviewStateChange={setParcelLayoutAutoPreviewState}
          onToggleParcelLabels={() => setShowParcelLabels((current) => !current)}
          cloneBounds={cloneBounds}
        />
      </div>
    </div>
  );
};

export default SurveyCadWorkspace;
