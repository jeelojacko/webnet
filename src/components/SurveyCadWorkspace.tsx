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
  cloneCadDrawingDocument,
  createBlankCadDrawingDocument,
  MAX_CAD_DRAWING_TEXT_BYTES,
  migrateSurveyCadStateToDrawing,
  parseCadDrawingFile,
  serializeCadDrawingFile,
} from '../engine/cad/cadDrawingFile';
import { importAdjustedPointsIntoCadDrawing } from '../engine/cad/cadAdjustedPointsImport';
import type { FeatureCodeCatalog } from '../engine/fieldToFinish/featureCatalog';
import { classifyCatalogChange, stampCatalogStaleStatus } from '../engine/fieldToFinish/linkedSync';
import { noteUiTabReady } from '../hooks/useUiPerfMonitor';
import type { SuccessfulAdjustmentRunInfo } from '../hooks/useAdjustmentOutcomeApplication';
import type { ResultDependencyIdentity } from '../engine/resultIntegrity';
import type { AdjustmentSourceSnapshot } from '../cad-app/cadSourceBridge';
import { importSnapshotIntoCadDrawing } from '../cad-app/cadSnapshotImport';
import type { CadDrawingLifecycleEvent } from '../cad-app/cadAppTypes';
import type { CadShellLink } from '../cad-app/shell/cadShellLink';
import type { ActiveCommandKey } from '../hooks/surveyCad/useSurveyCadCommandTypes';
import type { CadShellActions, CadWorkspaceSnapshot } from '../cad-app/shell/cadShellTypes';
import { getCadEntityDisplayLabel } from '../engine/cad/cadEntityNames';
import { createStableRuntimeId } from '../engine/id';
import {
  summarizeDrawingDependency,
  type CadDependencyReasonCode,
  type DrawingDependencySummary,
} from '../engine/cad/cadAdjustmentDependency';
import {
  buildDraftLabelEntityStatusMap,
  evaluateDraftLabelDependencies,
  hasStaleDerivedDraftLabel,
} from '../engine/cad/cadDraftLabelDependency';
import { useSurveyCadWorkspace } from '../hooks/surveyCad/useSurveyCadWorkspace';
import SurveyCadCommandToolbar from './surveyCad/SurveyCadCommandToolbar';
import { SurveyCadDraftingPanel } from './surveyCad/SurveyCadDraftingPanel';
import { cloneSampleCatalog } from './surveyCad/cloneSampleCatalog';
import { ExportCenterPanel } from './surveyCad/ExportCenterPanel';
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
  /** Latest successful production run for explicit adjustment-backed F2F commits; absent = no run yet. */
  adjustmentSource?: SuccessfulAdjustmentRunInfo | null;
  /**
   * Phase 18A explicit bridge snapshot (standalone CAD app). Takes the import
   * role of `result` when no live adjustment result is present; never both.
   */
  adjustmentSnapshot?: AdjustmentSourceSnapshot | null;
  /**
   * Phase 18A lifecycle hook so the standalone CAD controller can track
   * save/open/new for dirty state. Best-effort; absent = no tracking.
   */
  onDrawingLifecycle?: (_event: CadDrawingLifecycleEvent, _fileName: string | null) => void;
  /**
   * Current adjustment-result identity for the CAD dependency chip and the
   * Export Center deliverable gate. Absent/null = unknown (fail-closed).
   */
  resultDependencyIdentity?: ResultDependencyIdentity | null;
  /**
   * Freshness gate for NEW drafting feeds (auto spike + Import Adjusted
   * Points). False blocks new feeds without touching existing CAD entities.
   * Defaults false (fail-closed).
   */
  canFeedDraftingFromResult?: boolean;
  /**
   * Phase 18B shell seam. When set, the workspace publishes snapshots to the
   * shell link and registers dispatch actions on it. With shellChrome the
   * workspace also hides its own file-action strip + command toolbar so the
   * shell owns the chrome (viewport + interaction surface only).
   */
  shellLink?: CadShellLink | null;
  shellChrome?: boolean;
}

/** Phase 17E: first reason code in words for the dependency status chip. */
const DEPENDENCY_CAUSE_WORDS: Record<CadDependencyReasonCode, string> = {
  CAD_CURRENT: 'dependencies current',
  CAD_NO_DEPENDENCY: 'manual only',
  CAD_SOURCE_RESULT_STALE: 'result stale',
  CAD_SOURCE_RESULT_REPLACED: 'result replaced',
  CAD_SOURCE_STATION_MISSING: 'linked stations missing',
  CAD_LEGACY_DEPENDENCY_UNKNOWN: 'unstamped legacy entities',
  CAD_PARCEL_METRICS_STALE: 'parcel metrics changed',
  CAD_F2F_SYNC_INCOMPLETE: 'field-to-finish sync incomplete',
  CAD_DERIVED_LABEL_STALE: 'derived annotations stale',
  CAD_OWNER_CONFLICT: 'conflicting ownership',
};

/** Phase 17E: action hint for the dependency status chip. */
const DEPENDENCY_ACTION_HINT: Record<CadDependencyReasonCode, string> = {
  CAD_CURRENT: '',
  CAD_NO_DEPENDENCY: '',
  CAD_SOURCE_RESULT_STALE: 'Refresh adjusted points',
  CAD_SOURCE_RESULT_REPLACED: 'Refresh adjusted points',
  CAD_SOURCE_STATION_MISSING: 'Refresh adjusted points',
  CAD_LEGACY_DEPENDENCY_UNKNOWN: 'Review parcel',
  CAD_PARCEL_METRICS_STALE: 'Review parcel',
  CAD_F2F_SYNC_INCOMPLETE: 'Sync linked F2F',
  CAD_DERIVED_LABEL_STALE: 'Refresh derived annotations',
  CAD_OWNER_CONFLICT: 'Review parcel',
};

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
  adjustmentSource = null,
  adjustmentSnapshot = null,
  onDrawingLifecycle,
  canFeedDraftingFromResult = false,
  resultDependencyIdentity = null,
  shellLink = null,
  shellChrome = false,
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
    // Phase 18A: CAD now has its own app/route; keep the perf marker on the
    // closest adjustment tab key so telemetry stays schema-valid.
    noteUiTabReady('map');
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
        result: canFeedDraftingFromResult ? result : null,
        resultDependencyIdentity,
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
  }, [canFeedDraftingFromResult, input, instrumentLibrary, parseOptions, persistedState, result, resultDependencyIdentity, units]);
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
  // Phase 17E drawing dependency status (single text chip, not color-only).
  // Phase 18A: standalone CAD consumes the explicit bridge snapshot; the
  // live result path is kept for embedded/test callers. Never both at once.
  const effectiveStations = useMemo(
    () => adjustmentSnapshot?.stations ?? result?.stations ?? {},
    [adjustmentSnapshot, result],
  );
  const stationIds = useMemo(() => new Set(Object.keys(effectiveStations)), [effectiveStations]);
  const f2fLinkStatus = activeDrawing.project.metadata.fieldToFinishLink?.status;
  const f2fLinkSourceKind = activeDrawing.project.metadata.fieldToFinishLink?.sourceKind;
  const dependencySummary: DrawingDependencySummary = useMemo(() => {
    const summary = summarizeDrawingDependency(activeDrawing.project, resultDependencyIdentity, {
      stationIds,
      f2fLinkStatus,
      f2fLinkSourceKind,
    });
    if (summary.status === 'STALE') return summary;
    const labels = activeDrawing.draft?.labels ?? [];
    if (labels.length === 0) return summary;
    const statusMap = buildDraftLabelEntityStatusMap(activeDrawing.project.entities, resultDependencyIdentity, {
      stationIds,
      f2fLinkStatus,
      f2fLinkSourceKind,
    });
    if (!hasStaleDerivedDraftLabel(evaluateDraftLabelDependencies(labels, statusMap))) return summary;
    return {
      ...summary,
      status: 'STALE',
      reasons: summary.reasons.includes('CAD_DERIVED_LABEL_STALE')
        ? summary.reasons
        : [...summary.reasons, 'CAD_DERIVED_LABEL_STALE'],
    };
  }, [activeDrawing, resultDependencyIdentity, stationIds, f2fLinkStatus, f2fLinkSourceKind]);
  const dependencyCause = DEPENDENCY_CAUSE_WORDS[dependencySummary.reasons[0] ?? 'CAD_OWNER_CONFLICT'];
  const dependencyAction = dependencySummary.status === 'CURRENT' || dependencySummary.status === 'MANUAL_ONLY'
    ? null
    : DEPENDENCY_ACTION_HINT[dependencySummary.reasons[0] ?? 'CAD_OWNER_CONFLICT'];
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
  const [draftingPanelOpen, setDraftingPanelOpen] = useState(false);
  const [exportCenterOpen, setExportCenterOpen] = useState(false);
  // Workspace-owned active feature catalog: the F2F panel edits it and the
  // Export Center catalog tab exports exactly this object.
  const [featureCatalog, setFeatureCatalog] = useState(cloneSampleCatalog);
  const featureCatalogRef = useRef(featureCatalog);
  // Catalog edits mark a linked project stale (no regeneration): the edit
  // is the only moment the UI knows the generation inputs changed, and the
  // rerun subscriber cannot see workspace catalog state. Stamping is
  // idempotent; the workspace adopts the stamped document as its history
  // baseline like any other external document update.
  const handleFeatureCatalogChange = (next: FeatureCodeCatalog) => {
    const change = classifyCatalogChange(featureCatalogRef.current, next);
    featureCatalogRef.current = next;
    setFeatureCatalog(next);
    // NOTE: intentionally not via linkedRerunSync (which pulls cadLabelEngine
    // into this graph and trips the cadCogoParcel* star-export cycle —
    // cadCogoParcelGeometry * cadCogoParcelDiagnostics *
    // cadCogoParcelLineworkDiagnostics resolve undefined when entered from
    // that side). stampCatalogStaleStatus + clone stay on cycle-free edges.
    if (change) {
      emitDrawingChange((current) => {
        if (!current || !current.project.metadata.fieldToFinishLink) return current;
        const stamped = stampCatalogStaleStatus(current.project, change);
        if (stamped === current.project) return current;
        return cloneCadDrawingDocument({
          ...current,
          updatedAt: new Date().toISOString(),
          project: stamped,
        });
      });
    }
  };
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
    onDrawingLifecycle?.('cad-created', null);
  };

  const handleSaveDrawing = async () => {
    const fileName = buildCadDrawingFileName(activeDrawing.name);
    const saved = await saveBrowserTextFile(
      fileName,
      serializeCadDrawingFile(activeDrawing),
      CAD_DRAWING_FILE_TYPES,
    );
    if (saved) {
      setFileStatusText(`Saved ${fileName}.`);
      onDrawingLifecycle?.('cad-saved', fileName);
    }
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
      onDrawingLifecycle?.('cad-opened', file.name);
    } catch (error) {
      setFileStatusText(error instanceof Error ? error.message : String(error));
    }
  };

  const hasAdjustmentSource = adjustmentSnapshot != null || (result != null && canFeedDraftingFromResult && resultDependencyIdentity != null);
  const handleImportAdjustedPoints = () => {
    // Phase 18A: explicit bridge snapshot first (standalone CAD has no live result).
    if (adjustmentSnapshot) {
      const imported = importSnapshotIntoCadDrawing({
        document: activeDrawing,
        snapshot: adjustmentSnapshot,
      });
      if (!imported.ok) {
        setFileStatusText(imported.message);
        return;
      }
      replaceActiveDrawing(imported.drawing, 'Imported adjusted points.');
      return;
    }
    if (!result || !canFeedDraftingFromResult || !resultDependencyIdentity) {
      setFileStatusText(
        'Import blocked: the adjustment result is not current (stale, failed, or non-production run). Re-run the adjustment, then import again.',
      );
      return;
    }
    const nextDrawing = importAdjustedPointsIntoCadDrawing({
      document: activeDrawing,
      identity: resultDependencyIdentity,
      result,
      sourceName: 'Current adjustment',
    });
    replaceActiveDrawing(nextDrawing, 'Imported adjusted points.');
  };

  // Phase 18B shell seam: registry key -> existing workspace starter.
  // Every entry routes to a live starter; absent starters report false.
  const shellStarters: Record<ActiveCommandKey, (() => void) | undefined> = {
    POINT: cadWorkspace.startPointCommand,
    COGO_POINT: cadWorkspace.startCogoPointCommand,
    LINE: cadWorkspace.startLineCommand,
    PLINE: cadWorkspace.startPolylineCommand,
    TRAVERSE: cadWorkspace.startTraverseCommand,
    ARC_3PT: cadWorkspace.startArc3PointCommand,
    ARC_SCE: cadWorkspace.startArcStartCenterEndCommand,
    ARC_CSE: cadWorkspace.startArcCenterStartEndCommand,
    ARC_SCA: cadWorkspace.startArcStartCenterAngleCommand,
    ARC_CSA: cadWorkspace.startArcCenterStartAngleCommand,
    ARC_SCL: cadWorkspace.startArcStartCenterChordCommand,
    ARC_CSL: cadWorkspace.startArcCenterStartChordCommand,
    ARC_SEA: cadWorkspace.startArcStartEndAngleCommand,
    ARC_SED: cadWorkspace.startArcStartEndDirectionCommand,
    ARC_SER: cadWorkspace.startArcStartEndRadiusCommand,
    CONTINUE_CURVE: cadWorkspace.startContinueCurveCommand,
    TANGENT_CURVE: cadWorkspace.startTangentCurveCommand,
    INVERSE: cadWorkspace.startInverseCommand,
    MULTI_INVERSE: cadWorkspace.startMultiInverseCommand,
    AREA: cadWorkspace.startAreaCommand,
    BEARING_REPORT: cadWorkspace.startBearingReportCommand,
    DISTANCE_REPORT: cadWorkspace.startDistanceReportCommand,
    TURNED_POINT: cadWorkspace.startTurnedPointCommand,
    DEFLECT_POINT: cadWorkspace.startDeflectionPointCommand,
    POINT_ALONG_LINE: cadWorkspace.startPointAlongLineCommand,
    EXTEND_LINE: cadWorkspace.startExtendLineCommand,
    OFFSET_POINT: cadWorkspace.startOffsetPointCommand,
    ALIGNMENT_OFFSET_CREATE: cadWorkspace.startAlignmentOffsetCreateCommand,
    ALIGNMENT_STATION_EQUATION: cadWorkspace.startAlignmentStationEquationCommand,
    ALIGNMENT_OFFSET_POINT: cadWorkspace.startAlignmentOffsetPointCommand,
    ALIGNMENT_INTERVAL_POINTS: cadWorkspace.startAlignmentIntervalPointsCommand,
    CURVE_SOLVER: cadWorkspace.startCurveSolverCommand,
    RADIAL_BEARING: cadWorkspace.startRadialBearingCommand,
    POINT_ON_CURVE: cadWorkspace.startPointOnCurveCommand,
    SUBDIVIDE_CURVE: cadWorkspace.startSubdivideCurveCommand,
    OFFSET_CURVE: cadWorkspace.startOffsetCurveCommand,
    PI_CURVE: cadWorkspace.startPiCurveCommand,
    CHORD_BEARING_CURVE: cadWorkspace.startChordBearingCurveCommand,
    REVERSE_CURVE: cadWorkspace.startReverseCurveCommand,
    COMPOUND_CURVE: cadWorkspace.startCompoundCurveCommand,
    BEARING_BEARING_INTX: cadWorkspace.startBearingBearingIntersectionCommand,
    BEARING_DISTANCE_INTX: cadWorkspace.startBearingDistanceIntersectionCommand,
    DISTANCE_DISTANCE_INTX: cadWorkspace.startDistanceDistanceIntersectionCommand,
    LINE_CIRCLE_INTX: cadWorkspace.startLineCircleIntersectionCommand,
    PERP_INTX: cadWorkspace.startPerpendicularIntersectionCommand,
    OFFSET_INTX: cadWorkspace.startOffsetIntersectionCommand,
    SKEW_INTX: cadWorkspace.startSkewIntersectionCommand,
    BATCH_COGO: cadWorkspace.startBatchCogoCommand,
    PARCEL_SPLIT_BEARING: cadWorkspace.startParcelSplitBearingCommand,
    PARCEL_SPLIT_AREA: cadWorkspace.startParcelSplitAreaCommand,
    MOVE: cadWorkspace.startMoveCommand,
    COPY: cadWorkspace.startCopyCommand,
    EXTEND: cadWorkspace.startExtendCommand,
    TRIM: cadWorkspace.startTrimCommand,
    FILLET: cadWorkspace.startFilletCommand,
    PASTE: copiedEntityIds.length > 0 ? () => startPasteFromClipboard(copiedEntityIds) : undefined,
  };
  const shellAvailableCommands = useMemo(
    () =>
      (Object.keys(shellStarters) as ActiveCommandKey[]).filter(
        (key) => typeof shellStarters[key] === 'function',
      ),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [copiedEntityIds.length, activeDrawing.drawingId],
  );

  const shellSnapshot: CadWorkspaceSnapshot | null = useMemo(() => {
    if (!shellLink) return null;
    const enabledSnaps = Object.entries(cadWorkspace.snapPreferences)
      .filter(([, enabled]) => enabled)
      .map(([kind]) => kind);
    const layerEntityCounts: Record<string, number> = {};
    for (const entity of activeProject.entities) {
      layerEntityCounts[entity.layerId] = (layerEntityCounts[entity.layerId] ?? 0) + 1;
    }
    return {
      drawingId: activeDrawing.drawingId,
      drawingName: activeDrawing.name,
      units,
      entityCount: activeProject.entities.length,
      selectionCount,
      selectedEntityIds,
      selectionPreview: selectedEntities
        .slice(0, 200)
        .map((entity) => ({ id: entity.id, type: entity.type, label: getCadEntityDisplayLabel(entity) })),
      layers: activeProject.layers,
      layerEntityCounts,
      sheets: activeDrawing.draft?.sheets ?? [],
      properties: propertiesPanelState,
      activeCommandKey,
      commandPrompt: statusText,
      commandInputValue: cadWorkspace.commandInputValue,
      canUndo: cadWorkspace.canUndo,
      canRedo: cadWorkspace.canRedo,
      historyDepth: cadWorkspace.historyDepth,
      redoDepth: cadWorkspace.redoDepth,
      snapPreferences: cadWorkspace.snapPreferences,
      snapStatusText: enabledSnaps.length > 0 ? `SNAP: ${enabledSnaps.join(', ')}` : 'OSNAP off',
      stationCount: stationIds.size,
      dependencyStatus: dependencySummary.status,
      availableCommands: shellAvailableCommands,
    };
  }, [
    shellLink, activeDrawing, activeProject, selectionCount, selectedEntityIds, selectedEntities,
    propertiesPanelState, activeCommandKey, statusText, cadWorkspace, stationIds, dependencySummary, units,
    shellAvailableCommands,
  ]);

  useEffect(() => {
    if (shellLink && shellSnapshot) shellLink.publish(shellSnapshot);
  }, [shellLink, shellSnapshot]);

  useEffect(() => {
    if (!shellLink) return;
    const snap = cadWorkspace.activeSnap;
    const raw = cadWorkspace.pointerWorldPoint;
    shellLink.publishCursor(
      snap
        ? { x: snap.x, y: snap.y, label: snap.label }
        : raw
          ? { x: raw.x, y: raw.y, label: `${raw.x.toFixed(3)},${raw.y.toFixed(3)}` }
          : null,
    );
  }, [shellLink, cadWorkspace.activeSnap, cadWorkspace.pointerWorldPoint]);

  useEffect(() => {
    if (!shellLink) return;
    const actions: CadShellActions = {
      startCommand: (key) => {
        const starter = shellStarters[key];
        if (typeof starter !== 'function') return false;
        starter();
        return true;
      },
      undo,
      redo,
      selectAll: () => cadWorkspace.selectAll(),
      clearSelection,
      eraseSelection,
      selectEntities: (entityIds, append) => cadWorkspace.selectEntities(entityIds, append),
      editField: (entityId, field, value) => cadWorkspace.editPropertiesField(entityId, field, value),
      setLayerPatch: (layerId, patch) => {
        replaceActiveDrawing(
          { ...activeDrawing, project: { ...activeDrawing.project, layers: activeDrawing.project.layers.map((layer) => (layer.id === layerId ? { ...layer, ...patch } : layer)) } },
          'Updated CAD layers.',
        );
      },
      createLayer: (name) => {
        const trimmed = name.trim();
        if (!trimmed) return;
        replaceActiveDrawing(
          {
            ...activeDrawing,
            project: {
              ...activeDrawing.project,
              layers: [
                ...activeDrawing.project.layers,
                {
                  id: createStableRuntimeId('cad-layer'),
                  name: trimmed,
                  color: '#ffffff',
                  visible: true,
                  locked: false,
                  printable: true,
                  role: 'planning',
                },
              ],
            },
          },
          'Updated CAD layers.',
        );
      },
      deleteLayer: (layerId) => {
        // Populated-layer guard mirrors LAYER_DELETE (move objects off first).
        if (activeDrawing.project.entities.some((entity) => entity.layerId === layerId)) return;
        replaceActiveDrawing(
          {
            ...activeDrawing,
            project: {
              ...activeDrawing.project,
              layers: activeDrawing.project.layers.filter((layer) => layer.id !== layerId),
            },
          },
          'Updated CAD layers.',
        );
      },
      setSnapPreference: (kind, enabled) => cadWorkspace.setSnapPreference(kind, enabled),
      newDrawing: () => handleNewDrawing(),
      openDrawingFile: () => fileInputRef.current?.click(),
      saveDrawing: () => void handleSaveDrawing(),
      toggleDraftingPanel: () => setDraftingPanelOpen((current) => !current),
      toggleExportCenter: () => setExportCenterOpen((current) => !current),
      cancelCommand: () => handleEscapeKey(),
      confirmCommandInput: () => handleEnterKey(),
    };
    shellLink.actions = actions;
    return () => {
      if (shellLink.actions === actions) shellLink.actions = null;
    };
  });

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
        {shellChrome ? null : (
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
            <button type="button" className="rounded border border-slate-600 bg-slate-900 px-2 py-1 text-slate-100 hover:bg-slate-800" onClick={() => setDraftingPanelOpen((current) => !current)} data-survey-cad-drafting-panels>
              Sheets &amp; Layers
            </button>
            <button type="button" className="rounded border border-slate-600 bg-slate-900 px-2 py-1 text-slate-100 hover:bg-slate-800" onClick={() => setExportCenterOpen((current) => !current)} data-survey-cad-export-center>
              Export Center
            </button>
            {hasAdjustmentSource ? (
              <button
                type="button"
                className="rounded border border-sky-500 bg-sky-950 px-2 py-1 text-sky-100 hover:bg-sky-900 disabled:cursor-not-allowed disabled:border-slate-700 disabled:bg-slate-900 disabled:text-slate-500"
                onClick={handleImportAdjustedPoints}
                disabled={adjustmentSnapshot != null ? false : (!result || !canFeedDraftingFromResult || !resultDependencyIdentity)}
                title={
                  adjustmentSnapshot != null
                    ? 'Import adjusted points from the published adjustment source'
                    : canFeedDraftingFromResult
                      ? 'Import adjusted points from the current result'
                      : 'Import blocked: the adjustment result is not current'
                }
                data-survey-cad-import-adjusted-points
              >
                Import Adjusted Points
              </button>
            ) : null}
          </div>
        </div>
        )}
        {fileStatusText ? (
          <div className="absolute left-5 top-9 z-40 max-w-xl truncate text-[11px] text-slate-400" data-survey-cad-file-status>
            {fileStatusText}
          </div>
        ) : null}
        <div
          className="absolute left-5 top-14 z-40 max-w-xl truncate text-[11px] text-slate-300"
          data-survey-cad-dependency-status
          title={dependencyAction ?? undefined}
        >
          {`CAD status: ${dependencySummary.status === 'MANUAL_ONLY' ? 'MANUAL-ONLY' : dependencySummary.status}`}
          {dependencySummary.status === 'CURRENT' || dependencySummary.status === 'MANUAL_ONLY'
            ? ` — ${dependencyCause}.`
            : ` — ${dependencyCause}.${dependencyAction ? ` ${dependencyAction}.` : ''}`}
        </div>
        {shellChrome ? null : (
        <SurveyCadCommandToolbar
          workspace={cadWorkspace}
          canSplitParcelBySlideOrSwing={parcelLayoutWorkflow.canSplitParcelBySlideOrSwing}
          onCreateParcel={parcelLayoutWorkflow.createPrimaryParcelLayout}
          onSplitParcelBySlide={parcelLayoutWorkflow.splitParcelBySlide}
          onSplitParcelBySwing={parcelLayoutWorkflow.splitParcelBySwing}
          onToggleParcelLayoutPanel={floatingPanels.toggleParcelLayoutPanel}
        />
        )}
        {draftingPanelOpen ? (
          <SurveyCadDraftingPanel
            project={activeProject}
            draft={activeDrawing.draft}
            onProjectLayersChange={(layers) => {
              replaceActiveDrawing(
                { ...activeDrawing, project: { ...activeDrawing.project, layers } },
                'Updated CAD layers.',
              );
            }}
            onDraftChange={(draft) => {
              replaceActiveDrawing({ ...activeDrawing, draft }, 'Updated title block template.');
            }}
            onClose={() => setDraftingPanelOpen(false)}
            onCommitFieldToFinishPayload={cadWorkspace.commitFieldToFinishPayload}
            catalog={featureCatalog}
            onCatalogChange={handleFeatureCatalogChange}
            adjustmentSource={adjustmentSource}
          />
        ) : null}
        {exportCenterOpen ? (
          <ExportCenterPanel
            drawing={activeDrawing}
            catalog={featureCatalog}
            resultIdentity={resultDependencyIdentity}
            stationIds={stationIds}
            f2fLinkStatus={f2fLinkStatus}
            f2fLinkSourceKind={f2fLinkSourceKind}
            onClose={() => setExportCenterOpen(false)}
          />
        ) : null}
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
