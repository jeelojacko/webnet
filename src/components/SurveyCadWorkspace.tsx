import React, { useEffect, useMemo, useRef, useState, type ChangeEvent, type Dispatch, type SetStateAction } from 'react';
import type { AdjustmentResult, InstrumentLibrary, ParseOptions, UnitsMode } from '../types';
import { buildSurveyCadSpikeProject } from '../engine/cad/cadModel';
import type {
  CadBounds,
  CadDrawingDocument,
  CadParcelLayoutUiState,
  SurveyCadPersistedState,
} from '../engine/cad/cadTypes';
import {
  assertBrowserFileSize,
  readBrowserFileAsText,
  saveBrowserTextFile,
} from '../engine/browserFileIo';
import {
  buildCadDrawingFileName,
  createBlankCadDrawingDocument,
  MAX_CAD_DRAWING_TEXT_BYTES,
  migrateSurveyCadStateToDrawing,
  parseCadDrawingFile,
  serializeCadDrawingFile,
} from '../engine/cad/cadDrawingFile';
import { importAdjustedPointsIntoCadDrawing } from '../engine/cad/cadAdjustedPointsImport';
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
  input?: string;
  instrumentLibrary?: InstrumentLibrary;
  parseOptions?: ParseOptions;
  units: UnitsMode;
  result: AdjustmentResult | null;
  drawing?: CadDrawingDocument | null;
  onDrawingChange?: Dispatch<SetStateAction<CadDrawingDocument | null>>;
  persistedState?: SurveyCadPersistedState | null;
  onPersistedStateChange?: Dispatch<SetStateAction<SurveyCadPersistedState | null>>;
}

const CAD_DRAWING_FILE_TYPES = [
  {
    description: 'WebNet CAD Drawing',
    accept: {
      'application/json': ['.wncad', '.json'],
    },
  },
];

const SurveyCadWorkspace: React.FC<SurveyCadWorkspaceProps> = ({
  input = '',
  instrumentLibrary = {},
  parseOptions,
  units,
  result,
  drawing = null,
  onDrawingChange,
  persistedState = null,
  onPersistedStateChange,
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

  const legacyDrawing = useMemo<CadDrawingDocument>(() => {
    if (persistedState) {
      return migrateSurveyCadStateToDrawing({
        state: persistedState,
        units,
      });
    }
    if (parseOptions) {
      const project = buildSurveyCadSpikeProject({
        input,
        instrumentLibrary,
        parseOptions,
        units,
        result,
      });
      const migrated = migrateSurveyCadStateToDrawing({
        state: {
          version: 1,
          sourceSignature: 'legacy',
          project,
        },
        name: project.name,
        units,
      });
      return migrated;
    }
    return createBlankCadDrawingDocument({ units });
  }, [input, instrumentLibrary, parseOptions, persistedState, result, units]);
  const activeDrawing = drawing ?? legacyDrawing;
  const emitDrawingChange: Dispatch<SetStateAction<CadDrawingDocument | null>> =
    onDrawingChange ??
    ((update) => {
      if (!onPersistedStateChange) return;
      onPersistedStateChange((previousLegacy) => {
        const previousDrawing = previousLegacy
          ? migrateSurveyCadStateToDrawing({ state: previousLegacy, units })
          : activeDrawing;
        const nextDrawing = typeof update === 'function' ? update(previousDrawing) : update;
        if (nextDrawing === previousDrawing) return previousLegacy;
        return nextDrawing
          ? {
              version: 1,
              sourceSignature: nextDrawing.drawingId.startsWith('cad-drawing:')
                ? nextDrawing.drawingId.slice('cad-drawing:'.length)
                : nextDrawing.drawingId,
              project: nextDrawing.project,
              parcelLayout: nextDrawing.parcelLayout,
              showParcelLabels: nextDrawing.showParcelLabels,
            }
          : null;
      });
    });
  const cadProject = activeDrawing.project;
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const [fileStatusText, setFileStatusText] = useState('');
  const [viewport, setViewport] = useState({ zoom: 1, panX: 0, panY: 0 });
  const [viewBounds, setViewBounds] = useState<CadBounds | null>(() => cloneBounds(cadProject.bounds));
  const [parcelLayoutState, setParcelLayoutState] = useState<CadParcelLayoutUiState>(() =>
    cloneParcelLayoutUiState(activeDrawing.parcelLayout),
  );
  const [parcelLayoutPreviewState, setParcelLayoutPreviewState] = useState<ParcelLayoutPreviewState | null>(null);
  const [parcelLayoutAutoPreviewState, setParcelLayoutAutoPreviewState] =
    useState<ParcelLayoutAutoPreviewState | null>(null);
  const [parcelLayoutAutoTool, setParcelLayoutAutoTool] = useState<'slide' | 'swing'>('slide');
  const [parcelLayoutFrontageSegmentSelectionActive, setParcelLayoutFrontageSegmentSelectionActive] =
    useState(false);
  const [parcelLayoutFrontageSegmentSelectionIds, setParcelLayoutFrontageSegmentSelectionIds] = useState<string[]>([]);
  const [showParcelLabels, setShowParcelLabels] = useState<boolean>(
    () => activeDrawing.showParcelLabels ?? true,
  );
  const [copiedEntityIds, setCopiedEntityIds] = useState<string[]>([]);
  const [reverseDirectionModifier, setReverseDirectionModifier] = useState(false);
  const cadWorkspace = useSurveyCadWorkspace(
    cadProject,
    activeDrawing.drawingId,
    emitDrawingChange,
    activeDrawing,
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
      activeDrawing.drawingId;
    if (parcelLayoutHydrationKeyRef.current === hydrationKey) return;
    parcelLayoutHydrationKeyRef.current = hydrationKey;
    setParcelLayoutState(cloneParcelLayoutUiState(activeDrawing.parcelLayout));
    setShowParcelLabels(activeDrawing.showParcelLabels ?? true);
  }, [activeDrawing]);

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
  }, [activeDrawing.drawingId, cadProject.bounds, cadProject.id]);

  const replaceActiveDrawing = (nextDrawing: CadDrawingDocument, statusText: string) => {
    emitDrawingChange(nextDrawing);
    cadWorkspace.replaceCadProject(nextDrawing.project, statusText);
    setFileStatusText(statusText);
  };

  const handleNewDrawing = () => {
    replaceActiveDrawing(
      createBlankCadDrawingDocument({ units }),
      'New CAD drawing created.',
    );
  };

  const handleSaveDrawing = async () => {
    const saved = await saveBrowserTextFile(
      buildCadDrawingFileName(activeDrawing.name),
      serializeCadDrawingFile(activeDrawing),
      CAD_DRAWING_FILE_TYPES,
    );
    if (saved) setFileStatusText(`Saved ${buildCadDrawingFileName(activeDrawing.name)}.`);
  };

  const handleOpenDrawingChange = async (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    event.target.value = '';
    if (!file) return;
    try {
      assertBrowserFileSize(file, MAX_CAD_DRAWING_TEXT_BYTES, `${file.name} CAD drawing`);
      const rawText = await readBrowserFileAsText(file);
      const parsed = parseCadDrawingFile(rawText);
      if (!parsed.ok) {
        setFileStatusText(parsed.errors.join(' '));
        return;
      }
      replaceActiveDrawing(parsed.drawing, `Opened ${file.name}.`);
    } catch (error) {
      setFileStatusText(error instanceof Error ? error.message : String(error));
    }
  };

  const handleImportAdjustedPoints = () => {
    if (!result) return;
    const nextDrawing = importAdjustedPointsIntoCadDrawing({
      document: activeDrawing,
      result,
      sourceName: 'Current adjustment',
    });
    replaceActiveDrawing(nextDrawing, 'Imported adjusted points.');
  };

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
      <input
        ref={fileInputRef}
        type="file"
        accept=".wncad,.json,.survey-cad.json"
        className="hidden"
        onChange={handleOpenDrawingChange}
        data-survey-cad-open-drawing-input
      />
      <div className="relative h-full min-h-0 bg-slate-950">
        <div className="absolute left-3 right-3 top-1 z-40 flex items-center justify-between gap-2 px-2 text-[11px] text-slate-300">
          <div className="min-w-0 truncate" data-survey-cad-drawing-title>
            {activeDrawing.name}
          </div>
          <div className="flex flex-wrap items-center justify-end gap-1">
            <button type="button" className="rounded border border-slate-600 bg-slate-900 px-2 py-1 text-slate-100 hover:bg-slate-800" onClick={handleNewDrawing} data-survey-cad-new-drawing>
              New Drawing
            </button>
            <button type="button" className="rounded border border-slate-600 bg-slate-900 px-2 py-1 text-slate-100 hover:bg-slate-800" onClick={() => fileInputRef.current?.click()} data-survey-cad-open-drawing>
              Open Drawing
            </button>
            <button type="button" className="rounded border border-slate-600 bg-slate-900 px-2 py-1 text-slate-100 hover:bg-slate-800" onClick={handleSaveDrawing} data-survey-cad-save-drawing>
              Save Drawing
            </button>
            <button type="button" className="rounded border border-slate-600 bg-slate-900 px-2 py-1 text-slate-100 hover:bg-slate-800" onClick={handleSaveDrawing} data-survey-cad-save-drawing-as>
              Save Drawing As
            </button>
            <button type="button" className="rounded border border-slate-600 bg-slate-900 px-2 py-1 text-slate-100 hover:bg-slate-800" onClick={handleSaveDrawing} data-survey-cad-export-drawing>
              Export Drawing
            </button>
            <button
              type="button"
              className="rounded border border-sky-500 bg-sky-950 px-2 py-1 text-sky-100 hover:bg-sky-900 disabled:cursor-not-allowed disabled:border-slate-700 disabled:bg-slate-900 disabled:text-slate-500"
              onClick={handleImportAdjustedPoints}
              disabled={!result}
              data-survey-cad-import-adjusted-points
            >
              Import Adjusted Points
            </button>
          </div>
        </div>
        {fileStatusText ? (
          <div className="absolute left-5 top-9 z-40 max-w-xl truncate text-[11px] text-slate-400" data-survey-cad-file-status>
            {fileStatusText}
          </div>
        ) : null}
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
