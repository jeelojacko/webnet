import React, { useCallback, useEffect, useMemo, useRef, useState, type Dispatch, type SetStateAction } from 'react';
import type { AdjustmentResult, InstrumentLibrary, ParseOptions, UnitsMode } from '../types';
import type {
  CadBounds,
  CadDrawingDocument,
  CadParcelLayoutUiState,
  SurveyCadPersistedState,
} from '../engine/cad/cadTypes';
import type { FeatureCodeCatalog } from '../engine/fieldToFinish/featureCatalog';
import { cloneFeatureCatalog } from '../engine/fieldToFinish/featureCatalog';
import { STARTER_CATALOG } from '../engine/fieldToFinish/starterCatalog';
import {
  getDrawingCatalogStatus,
  hasFieldToFinishContent,
} from '../engine/fieldToFinish/drawingCatalog';
import { classifyCatalogChange } from '../engine/fieldToFinish/linkedSync';
import { noteUiTabReady } from '../hooks/useUiPerfMonitor';
import type { SuccessfulAdjustmentRunInfo } from '../hooks/useAdjustmentOutcomeApplication';
import type { ResultDependencyIdentity } from '../engine/resultIntegrity';
import type { AdjustmentSourceSnapshot } from '../cad-app/cadSourceBridge';
import type { CadDrawingLifecycleEvent } from '../cad-app/cadAppTypes';
import type { CadShellLink } from '../cad-app/shell/cadShellLink';
import type { ActiveCommandKey } from '../hooks/surveyCad/useSurveyCadCommandTypes';
import type { CadShellActions, CadWorkspaceSnapshot, SurveyManagerKind } from '../cad-app/shell/cadShellTypes';
import { withBlockHoverTitles } from '../cad-app/blocks/cadBlockOverlay';
import type { CadSurfaceInquiry } from '../cad-app/shell/cadSurfaceSnapshot';
import {
  analysisAreaUnit,
  analysisVolumeUnit,
  buildCadAnalysisSnapshot,
} from '../cad-app/shell/cadAnalysisSnapshot';
import { buildAnalysisExportInput } from '../cad-app/shell/cadAnalysisExportInput';
import { buildGradingExportInput } from '../cad-app/shell/cadGradingExportInput';
import { buildGradingSceneLayers } from '../cad-app/shell/cadGradingDisplay';
import { buildAnalysisSceneLayers } from '../engine/cad/cadAnalysisDisplayView';
import { buildProfileViewDisplayLayers } from '../engine/cad/cadProfileView';
import {
  buildSampleLineDisplayLayers,
  buildSectionViewDisplayLayers,
} from '../engine/cad/cadSectionView';
import { filterCadDerivedLayersForViewport } from '../engine/cad/cadViewportAppearance';
import { useSurveyCadSurfaceEditSessions } from '../hooks/surveyCad/useSurveyCadSurfaceEditSessions';
import { useSurveyCadSurfacePointEditSessions } from '../hooks/surveyCad/useSurveyCadSurfacePointEditSessions';
import { useSurveyCadSurfaceBulkSelection } from '../hooks/surveyCad/useSurveyCadSurfaceBulkSelection';
import { useSurveyCadSurfaceBulkEditSessions } from '../hooks/surveyCad/useSurveyCadSurfaceBulkEditSessions';
import { useSurveyCadSurfaceBuildLifecycle } from '../hooks/surveyCad/useSurveyCadSurfaceBuildLifecycle';
import { useSurveyCadContourLifecycle } from '../hooks/surveyCad/useSurveyCadContourLifecycle';
import { useSurveyCadVolumeGradingAnalysisLifecycle } from '../hooks/surveyCad/useSurveyCadVolumeGradingAnalysisLifecycle';
import { useSurveyCadProfileSectionLifecycle } from '../hooks/surveyCad/useSurveyCadProfileSectionLifecycle';
import { useSurveyCadComposeLifecycle } from '../hooks/surveyCad/useSurveyCadComposeLifecycle';
import { createCadGradingCache } from '../engine/cad/grading/gradingCache';
import type { GradingTerminationKind } from '../engine/cad/grading/gradingTypes';
import { createCadGradingGroupCache } from '../engine/cad/grading/gradingGroupCache';
import { buildGroupGradingSceneLayers } from '../cad-app/shell/cadGradingGroupDisplay';
import { createCadSurfaceVolumeCache } from '../engine/cad/surfaceVolumeCache';
import type { DrawingDependencySummary } from '../engine/cad/cadAdjustmentDependency';
import { summarizeActiveDrawingDependency } from './surveyCad/cadDependencyDiagnostics';
import { buildCadWorkspaceShellActions } from './surveyCad/cadWorkspaceShellActions';
import { createCadShellCommandStarters } from './surveyCad/cadShellCommandStarters';
import { buildSurveyCadShellSnapshot } from './surveyCad/cadWorkspaceShellSnapshot';
import { createCadCivilInquiryHandlers } from './surveyCad/cadCivilInquiryHandlers';
import { createCadSurfacePickDispatch } from './surveyCad/cadSurfacePickDispatch';
import { useSurveyCadDrawingSource, cloneCadBounds } from '../hooks/surveyCad/useSurveyCadDrawingSource';
import { useSurveyCadDrawingLifecycleState } from '../hooks/surveyCad/useSurveyCadDrawingLifecycleState';
import { useSurveyCadDrawingFileLifecycle } from '../hooks/surveyCad/useSurveyCadDrawingFileLifecycle';
import { useSurveyCadLandXmlImportLifecycle } from '../hooks/surveyCad/useSurveyCadLandXmlImportLifecycle';
import { useSurveyCadWorkspace } from '../hooks/surveyCad/useSurveyCadWorkspace';
import type { SurveyCadDraftingTab } from './surveyCad/SurveyCadDraftingPanel';
import SurveyCadWorkspaceManagers from './surveyCad/SurveyCadWorkspaceManagers';
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
  /**
   * Phase 18C LWT: workspace-only lineweight display preference driven by
   * the shell status bar. Never dirties the drawing or the stored mm value.
   */
  lineweightDisplay?: import('../engine/cad/cadViewportAppearance').LineweightDisplayMode;
}

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
  lineweightDisplay = 'thin',
}) => {
  useEffect(() => {
    // Phase 18A: CAD now has its own app/route; keep the perf marker on the
    // closest adjustment tab key so telemetry stays schema-valid.
    noteUiTabReady('map');
  }, []);

  const { activeDrawing, emitDrawingChange } = useSurveyCadDrawingSource({
    drawing,
    onDrawingChange,
    persistedState,
    onPersistedStateChange,
    input,
    instrumentLibrary,
    parseOptions,
    units,
    result,
    resultDependencyIdentity,
    canFeedDraftingFromResult,
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
  const dependencySummary: DrawingDependencySummary = useMemo(
    () => summarizeActiveDrawingDependency(activeDrawing, resultDependencyIdentity, {
      stationIds,
      f2fLinkStatus,
      f2fLinkSourceKind,
    }),
    [activeDrawing, resultDependencyIdentity, stationIds, f2fLinkStatus, f2fLinkSourceKind],
  );
  // STRUCT-194.3 — early drawing-file / LandXML lifecycle state. Declared here
  // (unconditional, before the worker-service construction) so `setFileStatusText`
  // is available to every service `notify` hook and the refs stay stable across
  // renders, shell registration, and the manager tree. The setters/refs are
  // stable, but the exhaustive-deps rule cannot prove that through a custom
  // hook, so the affected service memos and LandXML follow-up effects carry
  // targeted suppressions that keep their exact dependency arrays.
  const {
    fileInputRef,
    landXmlImportInputRef,
    stagedLandXmlImport,
    setStagedLandXmlImport,
    pendingImportedSurfaceIds,
    setPendingImportedSurfaceIds,
    importedSurfaceIdsRef,
    fileStatusText,
    setFileStatusText,
  } = useSurveyCadDrawingLifecycleState();
  const [viewport, setViewport] = useState({ zoom: 1, panX: 0, panY: 0 });
  // Monotonic viewport generation: bumped on EVERY viewport transform (zoom,
  // pan, zoom-extents, programmatic reset). Snap candidates are stamped with
  // it so a click-less keyboard commit can reject a snap computed before any
  // transform, including a pan-only reset that leaves zoom/scale unchanged.
  const viewportGenerationRef = useRef(0);
  const applyViewport = useCallback<typeof setViewport>((action) => {
    viewportGenerationRef.current += 1;
    setViewport(action);
  }, []);
  const [viewBounds, setViewBounds] = useState<CadBounds | null>(() => cloneCadBounds(cadProject.bounds));
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
  const [draftingInitialTab, setDraftingInitialTab] = useState<SurveyCadDraftingTab>('SHEETS');
  // Phase 18E — Toolspace/ribbon focus target inside the F2F panel
  // (catalog section / review step / regen / import / export). Session-only.
  const [f2fSection, setF2fSection] = useState<string | null>(null);
  const [exportCenterOpen, setExportCenterOpen] = useState(false);
  // Phase 18D — survey style/group manager dialog (one at a time).
  const [surveyManager, setSurveyManager] = useState<{ kind: SurveyManagerKind; selectedId?: string } | null>(null);
  // Phase 18I — volume UI state (all session-only; results never persist).
  const [selectedVolumeId, setSelectedVolumeId] = useState<string | null>(null);
  // Phase 18J — profile UI state (session-only; samples never persist).
  const [selectedProfileId, setSelectedProfileId] = useState<string | null>(null);
  const [selectedProfileViewId, setSelectedProfileViewId] = useState<string | null>(null);
  // Phase 18K — section UI state (session-only; sections never persist).
  const [selectedSampleLineGroupId, setSelectedSampleLineGroupId] = useState<string | null>(null);
  const [selectedSampleLineId, setSelectedSampleLineId] = useState<string | null>(null);
  const [selectedSectionViewId, setSelectedSectionViewId] = useState<string | null>(null);
  const [volumePick, setVolumePick] = useState<{ volumeId: string } | null>(null);
  const [volumePickAnswer, setVolumePickAnswer] = useState<{ volumeId: string; text: string } | null>(null);
  const [volumeVersion, setVolumeVersion] = useState(0);
  // Phase 18U — analysis UI state (session-only; band results never persist).
  const [selectedAnalysisId, setSelectedAnalysisId] = useState<string | null>(null);
  const [selectedAnalysisLegendId, setSelectedAnalysisLegendId] = useState<string | null>(null);
  const [analysisPick, setAnalysisPick] = useState<{ analysisId: string } | null>(null);
  const [analysisPickAnswer, setAnalysisPickAnswer] = useState<{ analysisId: string; text: string } | null>(null);
  const [analysisVersion, setAnalysisVersion] = useState(0);
  const volumeCache = useMemo(
    () => createCadSurfaceVolumeCache(activeDrawing.drawingId),
    [activeDrawing.drawingId],
  );
  // Phase 20B — grading session state (definitions persist; results never do).
  const gradingCache = useMemo(
    () => createCadGradingCache(activeDrawing.drawingId),
    [activeDrawing.drawingId],
  );
  const [selectedGradingId, setSelectedGradingId] = useState<string | null>(null);
  const [gradingManagerTab, setGradingManagerTab] = useState<'definition' | 'inquiry'>('definition');
  // Phase 20F — method preselect for GRADETODISTANCE/GRADETOELEVATION/
  // GRADETORELATIVEELEVATION openers.
  const [gradingManagerMethod, setGradingManagerMethod] = useState<GradingTerminationKind>('surface');
  const [gradingVersion, setGradingVersion] = useState(0);
  // Phase 20C — grading-group session state (definitions persist; results never do).
  const groupCache = useMemo(
    () => createCadGradingGroupCache(activeDrawing.drawingId),
    [activeDrawing.drawingId],
  );
  const [selectedGroupId, setSelectedGroupId] = useState<string | null>(null);
  const [groupManagerTab, setGroupManagerTab] = useState<'definition' | 'criteria' | 'inquiry'>('definition');
  // Phase 18F — surface UI state (all session-only; meshes never persist).
  const [selectedSurfaceId, setSelectedSurfaceId] = useState<string | null>(null);
  const [surfacePick, setSurfacePick] = useState<{ surfaceId: string; mode: 'elevation' | 'slope' } | null>(null);
  const [blockInsertPick, setBlockInsertPick] = useState<{
    definitionId: string;
    scale: number;
    rotationDeg: number;
    repeat: boolean;
  } | null>(null);
  const [lastSurfaceInquiry, setLastSurfaceInquiry] = useState<CadSurfaceInquiry | null>(null);
  // STRUCT-194.4 — early surface-build lifecycle (session TIN state, the
  // per-drawing cache + live refs, the one-worker build service, and the
  // revision-keyed snapshot inputs). Declared here, before the contour
  // lifecycle, at the exact former surface/contour render position.
  const {
    surfaceMeshSessions,
    setSurfaceMeshSessions,
    surfaceCache,
    surfaceRevisionIndex,
    surfaceBuildService,
    surfaceBuildVersion,
    surfaceBuildInputs,
    activeProjectForBuildsRef,
    drawingIdForBuildsRef,
  } = useSurveyCadSurfaceBuildLifecycle({
    activeDrawingId: activeDrawing.drawingId,
    cadProject,
    setFileStatusText,
  });
  // STRUCT-194.4 — contour lifecycle (cache + version + service, the
  // auto-derive epoch/effect, and the contour scene inputs), immediately
  // after the build lifecycle so it consumes the same per-drawing TIN cache.
  const {
    contourService,
    surfaceContourInputs,
  } = useSurveyCadContourLifecycle({
    activeDrawingId: activeDrawing.drawingId,
    cadProject,
    surfaceCache,
    surfaceBuildVersion,
    activeProjectForBuildsRef,
    drawingIdForBuildsRef,
    setFileStatusText,
  });
  // STRUCT-194.5 — volume / grading / group / analysis service lifecycles
  // (one worker-backed service each; manual Calculate only, stale pending work
  // retires without auto-starting). Extracted at the exact former
  // `volumeService` position; consumes the early primitive caches/versions
  // (left in the root) and returns the services the late effects/snapshots use.
  const {
    volumeService,
    gradingService,
    analysisPlane,
    gradingInputs,
    groupInputs,
  } = useSurveyCadVolumeGradingAnalysisLifecycle({
    drawingId: activeDrawing.drawingId,
    project: cadProject,
    caches: { surfaceCache, volumeCache, gradingCache, groupCache },
    state: { gradingVersion, setVolumeVersion, setGradingVersion, setAnalysisVersion },
    activeProjectForBuildsRef,
    drawingIdForBuildsRef,
    setFileStatusText,
  });
  // STRUCT-194.5 — profile / section service lifecycles, immediately after the
  // volume/grading/analysis lifecycle at the former `profileCache` position.
  const {
    profileCache,
    profileService,
    surfaceProfileInputs,
    sectionCache,
    sectionService,
    surfaceSectionInputs,
  } = useSurveyCadProfileSectionLifecycle({
    drawingId: activeDrawing.drawingId,
    project: cadProject,
    surfaceCache,
    surfaceMeshSessions,
    activeProjectForBuildsRef,
    drawingIdForBuildsRef,
    setFileStatusText,
  });
  // Source-rebuild hookup: only a NEW mesh revision for a surface
  // cancels in-flight volume work (their revision moved). A ref diff
  // guards it — notifying on every render would supersede work that was
  // just requested. Status itself re-derives from revisions every publish.
  const notifiedMeshRevisionsRef = useRef<Record<string, string[]>>({});
  useEffect(() => {
    const previous = notifiedMeshRevisionsRef.current;
    for (const [surfaceId, revisions] of Object.entries(surfaceMeshSessions)) {
      const seen = previous[surfaceId] ?? [];
      if (revisions.length !== seen.length || revisions.some((entry, index) => entry !== seen[index])) {
        volumeService.notifyMeshBuilt(surfaceId);
        // Phase 18U — analysis results are revision-keyed too, so a source
        // rebuild retires in-flight analysis work (status re-derives stale).
        analysisPlane.notifySourceRebuilt(surfaceId);
      }
    }
    notifiedMeshRevisionsRef.current = surfaceMeshSessions;
  }, [surfaceMeshSessions, volumeService, analysisPlane]);
  // Scene + snapshot inputs refresh only when the service reports a
  // state change (pending/diagnostic transitions), not on every render.
  const surfaceVolumeInputs = useMemo(
    () => ({
      version: volumeVersion,
      tinCache: surfaceCache,
      volumeCache,
      buildingVolumeIds: volumeService.buildingVolumeIds(),
      sessionDiagnostics: volumeService.volumeDiagnostics(),
    }),
    [volumeService, volumeVersion, surfaceCache, volumeCache],
  );
  const cadWorkspace = useSurveyCadWorkspace(
    cadProject,
    activeDrawing.drawingId,
    emitDrawingChange,
    activeDrawing,
    parcelLayoutState,
    showParcelLabels,
    reverseDirectionModifier,
    lineweightDisplay,
    surfaceCache,
    surfaceRevisionIndex,
    surfaceContourInputs,
    surfaceVolumeInputs,
    viewportGenerationRef,
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
    activeSnap: cursorActiveSnap,
    pointerWorldPointRef: cursorPointerWorldPointRef,
    subscribePointerWorldPoint: subscribeCursorPointerWorldPoint,
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
  // STRUCT-194.6 — exact two-surface composition control plane (one per
  // drawing session). Called once, unconditionally, at the former compose
  // render position; the hook owns the pending-mode ref + worker service and
  // disposes the old service on a drawing/cache/workspace change. The worker
  // computes topology only; the UI-owned APPLY seam dispatches the
  // payload-carrying SURFCOMPOSE / SURFCOMPOSEPASTE transaction.
  const { composeService, pendingComposeModeRef } = useSurveyCadComposeLifecycle({
    drawingId: activeDrawing.drawingId,
    surfaceCache,
    activeProjectForBuildsRef,
    drawingIdForBuildsRef,
    cadWorkspace,
    setFileStatusText,
  });

  // Phase 18U — analysis rows + legend rows (derived once per publish).
  // surfaceMeshSessions is a dep (not just an effect trigger): a source
  // rebuild mutates the mesh cache in place, so without it the rows would
  // keep reporting SOURCE_NOT_CURRENT instead of re-deriving NEEDS_RECALC.
  const analysisSnapshot = useMemo(() => {
    void analysisVersion;
    void surfaceMeshSessions;
    return buildCadAnalysisSnapshot(
      activeProject,
      surfaceCache,
      volumeCache,
      analysisPlane.cache,
      selectedAnalysisId,
      selectedAnalysisLegendId,
    );
  }, [
    activeProject,
    surfaceCache,
    volumeCache,
    analysisPlane,
    analysisVersion,
    surfaceMeshSessions,
    selectedAnalysisId,
    selectedAnalysisLegendId,
  ]);
  // Phase 18U — Export Center input from the CURRENT cached results (fills +
  // legends through the canonical export scene; absent = legacy scene).
  const analysisExportInput = useMemo(() => {
    void analysisVersion;
    void surfaceMeshSessions;
    return buildAnalysisExportInput(
      activeProject,
      analysisSnapshot,
      surfaceCache,
      analysisPlane.cache,
      units,
    );
  }, [activeProject, analysisSnapshot, surfaceCache, analysisPlane, analysisVersion, surfaceMeshSessions, units]);
  // Phase 18L/18X — runtime caches for LandXML TIN surface / profile / section
  // export (session-only; never persisted).
  const exportCivilSources = useMemo(
    () => ({ surfaceCache, profileCache, sectionCache }),
    [surfaceCache, profileCache, sectionCache],
  );
  // Phase 18U — band fills + legend geometry from the CURRENT cached results.
  // Colors/opacity come from the live definition, so a recolor or opacity edit
  // repaints from cache (the `arev1:` revision excludes appearance).
  const analysisDisplay = useMemo(() => {
    // The analysis cache is mutated in place by the control plane, so the
    // version bump is the only reliable "results changed" trigger.
    void analysisVersion;
    void surfaceMeshSessions;
    return buildAnalysisSceneLayers(activeProject, surfaceCache, analysisPlane.cache, {
        area: analysisAreaUnit(units),
      volume: analysisVolumeUnit(units),
    });
  }, [activeProject, surfaceCache, analysisPlane, analysisVersion, surfaceMeshSessions, units]);
  // Phase 18E — drawing-owned active feature catalog, derived from the
  // HISTORY project (same source the F2F panel renders), never workspace
  // React state. Absent catalog + no F2F content = starter clone as a
  // panel-local fallback (never written silently — edits adopt it into the
  // project). Absent catalog + F2F content = MISSING_LEGACY: surfaced,
  // never silent SAMPLE.
  const starterFallback = useMemo(() => cloneFeatureCatalog(STARTER_CATALOG), []);
  const activeCatalog: FeatureCodeCatalog = activeProject.fieldToFinishCatalog ?? starterFallback;
  const catalogIsFallback = activeProject.fieldToFinishCatalog === undefined;
  const catalogStatus = getDrawingCatalogStatus(activeProject);
  const catalogHasLegacyContent = catalogIsFallback && hasFieldToFinishContent(activeProject);
  const featureCatalogRef = useRef<FeatureCodeCatalog>(activeCatalog);
  useEffect(() => {
    featureCatalogRef.current = activeCatalog;
  }, [activeCatalog]);
  // Per-definition GENERATED reference counts (from project provenance) for
  // the manager's delete warning. Geometry is never deleted with a definition.
  const f2fReferenceCounts = useMemo(() => {
    const counts: Record<string, number> = {};
    for (const entity of activeProject.entities) {
      const provenance = (entity.metadata as Record<string, unknown> | undefined)?.['provenance'] as
        | Record<string, unknown>
        | undefined;
      if (provenance?.['generatedBy'] !== 'FIELD_TO_FINISH') continue;
      const defId = provenance?.['featureDefinitionId'];
      if (typeof defId === 'string' && defId) counts[defId] = (counts[defId] ?? 0) + 1;
    }
    return counts;
  }, [activeProject.entities]);
  // Catalog edits are PROJECT mutations through history (one
  // full-catalog-replace transaction, undoable, propagated to the parent
  // document), not workspace useState. Adopting a fallback writes the
  // starter clone into the project so the drawing owns it from here on.
  const handleFeatureCatalogChange = (next: FeatureCodeCatalog) => {
    const change = classifyCatalogChange(featureCatalogRef.current, next);
    featureCatalogRef.current = next;
    cadWorkspace.replaceFieldToFinishCatalog(next, change);
  };
  // Drawing-owned F2F control-token aliases (vendor-neutral Token→Canonical).
  const handleFieldToFinishSettingsChange = (settings: { controlTokenAliases?: Record<string, string> }) => {
    cadWorkspace.updateFieldToFinishSettings({ ...settings });
  };
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
  // Phase 18J — derived profile-view display layers. OFF/FROZEN hiding
  // is engine-owned: layers attach unfiltered and the viewport filter
  // drops them under the same visible/!frozen contract as surfaces/volumes.
  // activeProject is the dep (new identity per transaction): a ref read
  // alone never resubscribes, so view create/delete left stale [] behind.
  const profileViewLayers = useMemo(() => {
    // surfaceProfileInputs.version is the republish signal: the cache is
    // mutated in place by the service, so a version bump is the only
    // reliable "results changed" trigger for this memo.
    void surfaceProfileInputs.version;
    return buildProfileViewDisplayLayers(activeProject, profileCache);
  }, [activeProject, profileCache, surfaceProfileInputs]);
  const displaySceneWithProfiles = useMemo(
    () =>
      // PERF-186.1: displaySceneWithParcelLabelToggle is already viewport
      // filtered; only the newly attached profile-view layers need the
      // OFF/FROZEN contract applied here.
      filterCadDerivedLayersForViewport(activeProject, displaySceneWithParcelLabelToggle, {
        profileViewLayers,
      }),
    [activeProject, displaySceneWithParcelLabelToggle, profileViewLayers],
  );
  // Phase 18K — derived sample-line plan + section-view display layers.
  // OFF/FROZEN hiding is engine-owned (same visible/!frozen contract as
  // profiles); activeProject is the dep (new identity per transaction).
  const sampleLineLayers = useMemo(() => {
    void surfaceSectionInputs.version;
    return buildSampleLineDisplayLayers(activeProject);
  }, [activeProject, surfaceSectionInputs]);
  const sectionViewLayers = useMemo(() => {
    // Version bump is the only reliable "results changed" trigger: the
    // cache is mutated in place by the service.
    void surfaceSectionInputs.version;
    return buildSectionViewDisplayLayers(activeProject, sectionCache);
  }, [activeProject, sectionCache, surfaceSectionInputs]);
  const displaySceneWithSections = useMemo(() =>
    // PERF-186.1: base is already filtered; only the newly attached sample /
    // section / analysis layers are filtered. withBlockHoverTitles maps the
    // existing primitives in place (hover metadata only) — it adds/removes no
    // primitive, so the already-filtered list is reused without a rescan.
    filterCadDerivedLayersForViewport(activeProject, displaySceneWithProfiles, {
      // Phase 18N — refs render natively (persist slice); tag the
      // expansion primitives with hover titles only.
      primitives: withBlockHoverTitles(activeProject, displaySceneWithProfiles.primitives),
      sampleLineLayers,
      sectionViewLayers,
      // Phase 18U — band fills render UNDER the surface/volume passes and
      // legend rows read the CURRENT cached result at render time.
      analysisLayers: analysisDisplay.layers,
      analysisLegendLayers: analysisDisplay.legendLayers,
    }),
  [activeProject, displaySceneWithProfiles, sampleLineLayers, sectionViewLayers, analysisDisplay],
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
    applyViewport({ zoom: 1, panX: 0, panY: 0 });
    setViewBounds(cloneCadBounds(cadProject.bounds));
  }, [activeDrawing.drawingId, cadProject.bounds, cadProject.id, applyViewport]);

  // STRUCT-194.3 — drawing-file control plane (New / Open / Save /
  // Import-adjusted). Called at the former handler position so the drawing
  // closures read the current render's active drawing + history seam.
  const {
    replaceActiveDrawing,
    handleNewDrawing,
    handleSaveDrawing,
    handleOpenDrawingChange,
    hasAdjustmentSource,
    handleImportAdjustedPoints,
  } = useSurveyCadDrawingFileLifecycle({
    activeDrawing,
    emitDrawingChange,
    replaceCadProject: cadWorkspace.replaceCadProject,
    units,
    onDrawingLifecycle,
    adjustmentSnapshot,
    result,
    canFeedDraftingFromResult,
    resultDependencyIdentity,
    setFileStatusText,
  });

  // STRUCT-194.3 — LandXML import control plane (stage / select / commit) plus
  // the three follow-up effects (schedule / diagnostics / cleanup). Called at
  // the former handler position so their exact dependency arrays and firing
  // order are preserved.
  const {
    handleLandXmlImportChange,
    handleLandXmlSelectionChange,
    handleLandXmlImportSelected,
  } = useSurveyCadLandXmlImportLifecycle({
    pendingImportedSurfaceIds,
    setStagedLandXmlImport,
    setPendingImportedSurfaceIds,
    importedSurfaceIdsRef,
    getLiveDrawingId: () => drawingIdForBuildsRef.current,
    activeDrawingId: activeDrawing.drawingId,
    surfaceBuildService,
    surfaceBuildVersion,
    surfaces: activeProject.surfaces,
    runLandXmlImport: cadWorkspace.runLandXmlImport,
    setFileStatusText,
  });

  // Phase 18B shell seam: registry key -> existing workspace starter.
  // Every entry routes to a live starter; absent starters report false.
  const shellStarters: Record<ActiveCommandKey, (() => void) | undefined> =
    createCadShellCommandStarters({
      workspace: cadWorkspace,
      copiedEntityIds,
      startPasteFromClipboard,
    });
  const shellAvailableCommands = useMemo(
    () =>
      (Object.keys(shellStarters) as ActiveCommandKey[]).filter(
        (key) => typeof shellStarters[key] === 'function',
      ),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [copiedEntityIds.length, activeDrawing.drawingId],
  );

  // Phase 18V — session point/region selection + bulk edits. Declared
  // before the shell snapshot so the manager/ribbon can read the selection
  // summary; selection is UI-only and revision-bound, and bulk commits reuse
  // the 18T one-transaction SURFACE_ADD_EDIT path (stale ⇒ reselect, zero
  // refs ⇒ no undo entry).
  const surfaceBulkSelection = useSurveyCadSurfaceBulkSelection({
    project: activeProject,
    cache: surfaceCache,
    selectedSurfaceId,
    buildingSurfaceIds: surfaceBuildInputs.buildingSurfaceIds,
    runCommand: (command) => cadWorkspace.runLayerCommand(command),
    rebuildSurface: (surfaceId) => surfaceBuildService.rebuildSurface(surfaceId),
    notify: (message) => setFileStatusText(message),
  });
  const surfaceBulkEditSessions = useSurveyCadSurfaceBulkEditSessions({
    project: activeProject,
    cache: surfaceCache,
    selectedSurfaceId,
    buildingSurfaceIds: surfaceBuildInputs.buildingSurfaceIds,
    runCommand: (command) => cadWorkspace.runLayerCommand(command),
    rebuildSurface: (surfaceId) => surfaceBuildService.rebuildSurface(surfaceId),
    notify: (message) => setFileStatusText(message),
    selection: surfaceBulkSelection.selection,
    clearSelection: surfaceBulkSelection.clearSelection,
  });

  // PERF-184 — destructure exactly the seven `cadWorkspace` fields this
  // closure reads. Depending on the whole result object pinned the memo to an
  // identity that is rebuilt on every root render, re-running all twelve
  // snapshot builders (and republishing) for unrelated renders.
  const {
    snapPreferences,
    commandInputValue,
    canUndo,
    canRedo,
    historyDepth,
    redoDepth,
    annotationSnapshot,
  } = cadWorkspace;

  const shellSnapshot: CadWorkspaceSnapshot | null = useMemo(() => {
    if (!shellLink) return null;
    return buildSurveyCadShellSnapshot({
      drawing: {
        id: activeDrawing.drawingId,
        name: activeDrawing.name,
        sheets: activeDrawing.draft?.sheets ?? [],
      },
      units,
      project: activeProject,
      surfaceCache,
      catalog: { catalog: activeCatalog, status: catalogStatus },
      selection: {
        count: selectionCount,
        entityIds: selectedEntityIds,
        entities: selectedEntities,
      },
      properties: propertiesPanelState,
      command: { activeKey: activeCommandKey, prompt: statusText, inputValue: commandInputValue },
      history: { canUndo, canRedo, historyDepth, redoDepth },
      snap: { preferences: snapPreferences, stationCount: stationIds.size },
      dependencyStatus: dependencySummary.status,
      annotation: annotationSnapshot,
      grading: {
        cache: gradingCache,
        selectedId: selectedGradingId,
        options: {
          buildingGradingIds: gradingInputs.buildingGradingIds,
          sessionDiagnostics: gradingInputs.sessionDiagnostics,
        },
      },
      gradingGroups: {
        cache: groupCache,
        selectedId: selectedGroupId,
        options: {
          buildingGroupIds: groupInputs.buildingGroupIds,
          sessionDiagnostics: groupInputs.sessionDiagnostics,
        },
      },
      blocks: { insertPick: blockInsertPick },
      surface: {
        selectedId: selectedSurfaceId,
        options: {
          revisionIndex: surfaceRevisionIndex,
          lastInquiry: lastSurfaceInquiry,
          buildingSurfaceIds: surfaceBuildInputs.buildingSurfaceIds,
          sessionDiagnostics: surfaceBuildInputs.sessionDiagnostics,
          syncFallbackRevisions: surfaceBuildInputs.syncFallbackRevisions,
          selection: surfaceBulkSelection.summary,
        },
      },
      volume: {
        cache: volumeCache,
        selectedId: selectedVolumeId,
        options: {
          buildingVolumeIds: surfaceVolumeInputs.buildingVolumeIds,
          sessionDiagnostics: surfaceVolumeInputs.sessionDiagnostics,
        },
      },
      analysis: analysisSnapshot,
      profile: {
        cache: profileCache,
        selectedId: selectedProfileId,
        viewId: selectedProfileViewId,
        options: {
          buildingProfileIds: surfaceProfileInputs.buildingProfileIds,
          sessionDiagnostics: surfaceProfileInputs.sessionDiagnostics,
        },
      },
      section: {
        deps: {
          sectionCache,
          statusOf: (groupId, lineId, surfaceId) => sectionService.statusOf(groupId, lineId, surfaceId),
          buildingGroupIds: surfaceSectionInputs.buildingGroupIds,
        },
        groupId: selectedSampleLineGroupId,
        lineId: selectedSampleLineId,
        viewId: selectedSectionViewId,
      },
      availableCommands: shellAvailableCommands,
    });
  }, [
    shellLink, activeDrawing, activeProject, activeCatalog, catalogStatus, selectionCount, selectedEntityIds, selectedEntities,
    propertiesPanelState, activeCommandKey, statusText, stationIds, dependencySummary, units,
    snapPreferences, commandInputValue, canUndo, canRedo, historyDepth, redoDepth, annotationSnapshot,
    shellAvailableCommands, surfaceCache, surfaceRevisionIndex, selectedSurfaceId, lastSurfaceInquiry,
    surfaceBuildInputs, volumeCache, selectedVolumeId, surfaceVolumeInputs, analysisSnapshot,
    surfaceBulkSelection.summary,
    profileCache, surfaceProfileInputs, selectedProfileId, selectedProfileViewId,
    sectionCache, sectionService, surfaceSectionInputs,
    selectedSampleLineGroupId, selectedSampleLineId, selectedSectionViewId,
    blockInsertPick,
    gradingCache, selectedGradingId, gradingInputs,
    groupCache, selectedGroupId, groupInputs,
  ]);

  useEffect(() => {
    if (shellLink && shellSnapshot) shellLink.publish(shellSnapshot);
  }, [shellLink, shellSnapshot]);

  // Phase 18N — Esc ends the INSERT pick loop (capture: runs before the
  // command dock input consumes it; typing targets keep their own Esc).
  useEffect(() => {
    if (!blockInsertPick) return;
    const onKeyDown = (event: KeyboardEvent): void => {
      if (event.key !== 'Escape') return;
      const target = event.target as HTMLElement | null;
      if (target && (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA' || target.tagName === 'SELECT')) {
        return;
      }
      setBlockInsertPick(null);
    };
    document.addEventListener('keydown', onKeyDown, true);
    return () => document.removeEventListener('keydown', onKeyDown, true);
  }, [blockInsertPick]);

  useEffect(() => {
    if (!shellLink) return;
    // PERF-183.1 — cursor readout rides the imperative pointer channel so
    // idle pointer moves never commit root React state. Snap changes still
    // re-run this effect through the `activeSnap` dependency.
    const publishCursor = (): void => {
      const snap = cursorActiveSnap;
      const raw = cursorPointerWorldPointRef.current;
      shellLink.publishCursor(
        snap
          ? { x: snap.x, y: snap.y, label: snap.label }
          : raw
            ? { x: raw.x, y: raw.y, label: `${raw.x.toFixed(3)},${raw.y.toFixed(3)}` }
            : null,
      );
    };
    const unsubscribe = subscribeCursorPointerWorldPoint(publishCursor);
    publishCursor();
    return unsubscribe;
  }, [
    shellLink,
    cursorActiveSnap,
    cursorPointerWorldPointRef,
    subscribeCursorPointerWorldPoint,
  ]);

  /**
   * Phase 18G — production rebuild through the build service (single
   * worker per drawing session). Returns the immediate acknowledgement;
   * the human-readable build result lands in the file status on
   * completion. Never history, never dirty: the mesh is derived data and
   * the status re-derives CURRENT from the cache hit.
   */
  const runSurfaceBuild = (surfaceId: string): string =>
    surfaceBuildService.rebuildSurface(surfaceId);

  const rebuildAllSurfaces = (): string => surfaceBuildService.rebuildAllSurfaces();

  // Phase 18S — TIN-topology edit sessions (swap/add-line/delete-line pick
  // loops over the CURRENT mesh). Picks stage + preview only; Enter commits
  // one undoable SURFACE_ADD_EDIT against the fresh revision and queues a
  // worker rebuild; Esc ends the loop. Overlay primitives append AFTER the
  // viewport filter so they render even when the style hides triangles.
  const surfaceEditSessions = useSurveyCadSurfaceEditSessions({
    project: activeProject,
    cache: surfaceCache,
    selectedSurfaceId,
    buildingSurfaceIds: surfaceBuildInputs.buildingSurfaceIds,
    runCommand: (command) => cadWorkspace.runLayerCommand(command),
    rebuildSurface: (surfaceId) => runSurfaceBuild(surfaceId),
    notify: (message) => setFileStatusText(message),
  });

  // Phase 18T — surface-local point/elevation sessions (same CURRENT-mesh
  // gate + one-transaction commit pattern as 18S; numeric Z values arrive
  // via the command dock, Enter commits, Esc ends). Overlay primitives
  // append AFTER the viewport filter alongside the 18S overlays.
  const surfacePointEditSessions = useSurveyCadSurfacePointEditSessions({
    project: activeProject,
    cache: surfaceCache,
    selectedSurfaceId,
    buildingSurfaceIds: surfaceBuildInputs.buildingSurfaceIds,
    runCommand: (command) => cadWorkspace.runLayerCommand(command),
    rebuildSurface: (surfaceId) => runSurfaceBuild(surfaceId),
    notify: (message) => setFileStatusText(message),
  });

  // Phase 18S/18T/18V — Esc ends the active surface session; Enter commits
  // the staged edit/selection (capture, before dock input; typing targets
  // keep their own keys).
  useEffect(() => {
    if (
      !surfaceEditSessions.session &&
      !surfacePointEditSessions.session &&
      !surfaceBulkSelection.session &&
      !surfaceBulkEditSessions.session
    ) return;
    const onKeyDown = (event: KeyboardEvent): void => {
      if (event.key !== 'Escape' && event.key !== 'Enter') return;
      const target = event.target as HTMLElement | null;
      if (target && (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA' || target.tagName === 'SELECT')) {
        return;
      }
      if (event.key === 'Escape') {
        surfaceEditSessions.cancel();
        surfacePointEditSessions.cancel();
        surfaceBulkSelection.cancel();
        surfaceBulkEditSessions.cancel();
        setFileStatusText('Surface edit session ended.');
      } else if (surfacePointEditSessions.session) {
        if (surfacePointEditSessions.handleEnter()) event.preventDefault();
      } else if (surfaceBulkEditSessions.handleEnter()) {
        event.preventDefault();
      } else if (surfaceBulkSelection.handleEnter()) {
        event.preventDefault();
      } else if (surfaceEditSessions.handleEnter()) {
        event.preventDefault();
      }
    };
    document.addEventListener('keydown', onKeyDown, true);
    return () => document.removeEventListener('keydown', onKeyDown, true);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [surfaceEditSessions, surfacePointEditSessions, surfaceBulkSelection, surfaceBulkEditSessions]);
  // Phase 18S/18V overlay: staged current/proposed/affected edges and the
  // selection/bulk previews appended post-filter so they render even when
  // the style hides triangles.
  const surfaceEditOverlayPrimitives = [
    ...surfaceEditSessions.previewPrimitives,
    ...surfacePointEditSessions.previewPrimitives,
    ...surfaceBulkSelection.previewPrimitives,
    ...surfaceBulkEditSessions.previewPrimitives,
  ];
  // Phase 20B — CURRENT grading fills + daylight from the shell snapshot
  // (same freshness as the manager). OFF/FROZEN layers drop here under the
  // same visible/!frozen contract as surfaces/volumes; stale/failed rows
  // contribute no layer, so superseded geometry never renders as current.
  const gradingDisplayLayers = useMemo(
    () => buildGradingSceneLayers(shellSnapshot?.grading),
    [shellSnapshot],
  );
  // Phase 20C — CURRENT group fills + daylight + seam, ghost side arrows
  // for the selected uncalculated group, failed corner/course markers.
  // OFF/FROZEN layers drop under the same contract; stale rows contribute
  // no layer, so superseded geometry never renders as current.
  const groupGradingDisplayLayers = useMemo(() => {
    const failedErrors = new Map<string, string>();
    for (const [groupId, diagnostic] of gradingService.groupGradingDiagnostics()) {
      failedErrors.set(groupId, diagnostic.error);
    }
    return buildGroupGradingSceneLayers(shellSnapshot?.gradingGroups, { failedErrors });
  }, [shellSnapshot, gradingService]);
  const displaySceneWithGrading = useMemo(
    // PERF-186.1: base is already filtered; only the newly attached grading
    // layers need the OFF/FROZEN contract applied.
    () => filterCadDerivedLayersForViewport(activeProject, displaySceneWithSections, {
      gradingLayers: gradingDisplayLayers,
      groupGradingLayers: groupGradingDisplayLayers,
    }),
    [activeProject, displaySceneWithSections, gradingDisplayLayers, groupGradingDisplayLayers],
  );
  const displaySceneWithSurfaceEdits = surfaceEditOverlayPrimitives.length === 0
    ? displaySceneWithGrading
    : {
      ...displaySceneWithGrading,
      primitives: [...displaySceneWithGrading.primitives, ...surfaceEditOverlayPrimitives],
    };

  // Phase 18U — drop session results for deleted maps (results never
  // persist; the control plane invalidates the cache). Legends referencing a
  // deleted map derive BROKEN_REFERENCE, so they are legal to keep.
  const knownAnalysisIdsRef = useRef<Set<string>>(new Set());
  useEffect(() => {
    const live = new Set((activeProject.analysisMaps ?? []).map((entry) => entry.id));
    for (const id of knownAnalysisIdsRef.current) {
      if (!live.has(id)) analysisPlane.handleAnalysisDeleted(id);
    }
    knownAnalysisIdsRef.current = live;
    if (selectedAnalysisId != null && !live.has(selectedAnalysisId)) setSelectedAnalysisId(null);
  }, [activeProject.analysisMaps, analysisPlane, selectedAnalysisId]);
  useEffect(() => {
    const live = new Set((activeProject.analysisLegends ?? []).map((entry) => entry.id));
    if (selectedAnalysisLegendId != null && !live.has(selectedAnalysisLegendId)) {
      setSelectedAnalysisLegendId(null);
    }
  }, [activeProject.analysisLegends, selectedAnalysisLegendId]);

  // Phase 18I — drop session results for deleted volumes (results never
  // persist; the service cancels in-flight work first so late arrivals
  // never re-apply). Converges: unknown ids are simply absent.
  const knownVolumeIdsRef = useRef<Set<string>>(new Set());
  useEffect(() => {
    const live = new Set((activeProject.volumeSurfaces ?? []).map((entry) => entry.id));
    for (const id of knownVolumeIdsRef.current) {
      if (!live.has(id)) volumeService.handleVolumeDeleted(id);
    }
    knownVolumeIdsRef.current = live;
    if (selectedVolumeId != null && !live.has(selectedVolumeId)) setSelectedVolumeId(null);
  }, [activeProject.volumeSurfaces, volumeService, selectedVolumeId]);

  // STRUCT-194.6 — the four civil inquiry helpers are pure closures over the
  // current project / TIN cache / section cache / analysis snapshot. Built once
  // per render (a plain function call, never a hook) so the pick handler and
  // shell actions always read live state.
  const {
    describeAnalysisAt,
    describeVolumeDifference,
    describeSectionElevation,
    describeProfileElevation,
  } = createCadCivilInquiryHandlers({
    project: activeProject,
    surfaceCache,
    sectionCache,
    analysisSnapshot,
  });

  // Phase 18J — drop session samples for deleted profiles (results never
  // persist; the service cancels in-flight work first). Source surface
  // meshes are untouched.
  const knownProfileIdsRef = useRef<Set<string>>(new Set());
  useEffect(() => {
    const live = new Set((activeProject.surfaceProfiles ?? []).map((entry) => entry.id));
    for (const id of knownProfileIdsRef.current) {
      if (!live.has(id)) profileService.handleProfileDeleted(id);
    }
    knownProfileIdsRef.current = live;
    if (selectedProfileId != null && !live.has(selectedProfileId)) setSelectedProfileId(null);
  }, [activeProject.surfaceProfiles, profileService, selectedProfileId]);

  // Phase 18K — drop session sections for deleted groups (results never
  // persist; the service cancels in-flight work first). Source surface
  // meshes are untouched.
  const knownSectionGroupIdsRef = useRef<Set<string>>(new Set());
  useEffect(() => {
    const live = new Set((activeProject.sampleLineGroups ?? []).map((entry) => entry.id));
    for (const id of knownSectionGroupIdsRef.current) {
      if (!live.has(id)) sectionService.handleGroupDeleted(id);
    }
    knownSectionGroupIdsRef.current = live;
    if (selectedSampleLineGroupId != null && !live.has(selectedSampleLineGroupId)) {
      setSelectedSampleLineGroupId(null);
      setSelectedSampleLineId(null);
    }
  }, [activeProject.sampleLineGroups, sectionService, selectedSampleLineGroupId]);

  // Phase 18F — drop session meshes for deleted surfaces (meshes never
  // persist; the revision index doubles as the known-id set). Phase 18H:
  // contour sets drop with the definition (service cancels in-flight
  // derivations first so late arrivals never re-apply).
  useEffect(() => {
    const live = new Set((activeProject.surfaces ?? []).map((entry) => entry.id));
    setSurfaceMeshSessions((previous) => {
      const kept: Record<string, string[]> = {};
      let changed = false;
      for (const [id, revisions] of Object.entries(previous)) {
        if (live.has(id)) kept[id] = revisions;
        else {
          changed = true;
          surfaceCache.invalidate(id);
          contourService.handleSurfaceDeleted(id);
        }
      }
      return changed ? kept : previous;
    });
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeProject.surfaces, surfaceCache, contourService]);

  // Phase 18B shell seam (+18F surface actions): shared by the shell link
  // and workspace-local consumers (surface manager) alike. STRUCT-194.2 —
  // the control plane is composed from cohesive side-effect-free factories
  // on every render so action closures read the current root state.
  const shellActions: CadShellActions = buildCadWorkspaceShellActions({
    core: {
      link: shellLink,
      starters: shellStarters,
      workspace: cadWorkspace,
      project: activeProject,
      selectedEntityIds,
      undo,
      redo,
      clearSelection,
      eraseSelection,
      handleNewDrawing,
      handleSaveDrawing,
      handleEscapeKey,
      handleEnterKey,
      setViewBounds,
      applyViewport,
      fileInputRef,
      landXmlImportInputRef,
      setDraftingPanelOpen,
      setExportCenterOpen,
      setDraftingInitialTab,
      setF2fSection,
      setSurveyManager,
      setBlockInsertPick,
      editSessions: {
        point: surfacePointEditSessions,
        bulkEdit: surfaceBulkEditSessions,
        bulkSelection: surfaceBulkSelection,
      },
    },
    civil: {
      project: activeProject,
      snapshot: shellSnapshot,
      selectedEntityIds,
      selectedVolumeId,
      selectedAnalysisId,
      surfaceCache,
      volumeService,
      analysisPlane,
      composeService,
      pendingComposeModeRef,
      workspace: cadWorkspace,
      runSurfaceBuild,
      rebuildAllSurfaces,
      describeVolumeDifference,
      describeAnalysisAt,
      editSessions: {
        edit: surfaceEditSessions,
        pointEdit: surfacePointEditSessions,
        bulkSelection: surfaceBulkSelection,
        bulkEdit: surfaceBulkEditSessions,
      },
      setSelectedSurfaceId,
      setSelectedVolumeId,
      setSelectedAnalysisId,
      setSelectedAnalysisLegendId,
      setSurfacePick,
      setVolumePick,
      setAnalysisPick,
      setAnalysisPickAnswer,
      setLastSurfaceInquiry,
      setFileStatusText,
    },
    linear: {
      project: activeProject,
      selectedProfileId,
      sectionCache,
      profileService,
      sectionService,
      workspace: cadWorkspace,
      describeProfileElevation,
      describeSectionElevation,
      setSelectedProfileId,
      setSelectedProfileViewId,
      setSelectedSampleLineGroupId,
      setSelectedSampleLineId,
      setSelectedSectionViewId,
      setFileStatusText,
    },
    grading: {
      snapshot: shellSnapshot,
      workspace: cadWorkspace,
      gradingService,
      setSelectedGradingId,
      setGradingManagerTab,
      setGradingManagerMethod,
      setGradingVersion,
      setSurveyManager,
      setSelectedGroupId,
      setGroupManagerTab,
    },
  });
  // Phase 19B QA — actions-channel subscription (see cadShellLink).
  // Registration re-runs every render to keep handlers fresh but never
  // notifies (assignment alone re-renders nobody). Notify fires only on
  // mount/unmount transitions, otherwise cleanup-per-render would ping
  // subscribers into an update loop.
  useEffect(() => {
    if (!shellLink) return;
    shellLink.actions = shellActions;
  });
  useEffect(() => {
    if (!shellLink) return;
    const link = shellLink;
    link.notifyActions();
    return () => {
      link.actions = null;
      link.notifyActions();
    };
  }, [shellLink]);

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
    <SurveyCadWorkspaceManagers
      drawingFileInputRef={fileInputRef}
      landXmlFileInputRef={landXmlImportInputRef}
      fileInputs={{
        onDrawingFileChange: handleOpenDrawingChange,
        onLandXmlFileChange: handleLandXmlImportChange,
      }}
      chrome={{
        shellChrome,
        drawingName: activeDrawing.name,
        fileStatusText,
        dependencySummary,
        hasAdjustmentSource,
        adjustmentSnapshot,
        result,
        canFeedDraftingFromResult,
        resultDependencyIdentity,
        onNewDrawing: handleNewDrawing,
        onSaveDrawing: handleSaveDrawing,
        onImportAdjustedPoints: handleImportAdjustedPoints,
        onToggleDraftingPanel: () => setDraftingPanelOpen((current) => !current),
        onToggleExportCenter: () => setExportCenterOpen((current) => !current),
      }}
      toolbar={{
        workspace: cadWorkspace,
        canSplitParcelBySlideOrSwing: parcelLayoutWorkflow.canSplitParcelBySlideOrSwing,
        onCreateParcel: parcelLayoutWorkflow.createPrimaryParcelLayout,
        onSplitParcelBySlide: parcelLayoutWorkflow.splitParcelBySlide,
        onSplitParcelBySwing: parcelLayoutWorkflow.splitParcelBySwing,
        onToggleParcelLayoutPanel: floatingPanels.toggleParcelLayoutPanel,
      }}
      draftingPanel={{
        open: draftingPanelOpen,
        project: activeProject,
        initialTab: draftingInitialTab,
        draft: activeDrawing.draft,
        workspace: cadWorkspace,
        activeDrawing,
        shellLink,
        replaceActiveDrawing,
        setFileStatusText,
        onClose: () => setDraftingPanelOpen(false),
        catalog: activeCatalog,
        onCatalogChange: handleFeatureCatalogChange,
        catalogStatus,
        catalogIsFallback,
        catalogHasLegacyContent,
        referenceCounts: f2fReferenceCounts,
        fieldToFinishSettings: activeProject.fieldToFinishSettings,
        onFieldToFinishSettingsChange: handleFieldToFinishSettingsChange,
        f2fSection,
        adjustmentSource,
      }}
      managers={{
        surveyManager,
        setSurveyManager,
        workspace: cadWorkspace,
        project: activeProject,
        catalog: activeCatalog,
        featureCatalogRef,
        onCatalogChange: handleFeatureCatalogChange,
        shellSnapshot,
        shellActions,
        surfacePick,
        volumePick,
        volumePickAnswer,
        analysisPick,
        analysisPickAnswer,
        gradingManagerTab,
        gradingManagerMethod,
        groupManagerTab,
      }}
      exportCenter={{
        open: exportCenterOpen,
        props: {
          drawing: activeDrawing,
          // MISSING_LEGACY drawings have no embedded catalog: export no
          // catalog rather than presenting the starter fallback as theirs.
          catalog: catalogHasLegacyContent ? null : activeCatalog,
          resultIdentity: resultDependencyIdentity,
          stationIds,
          f2fLinkStatus,
          f2fLinkSourceKind,
          analysis: analysisExportInput,
          grading: buildGradingExportInput(shellSnapshot?.grading),
          civilSources: exportCivilSources,
          onClose: () => setExportCenterOpen(false),
        },
      }}
      landXml={
        stagedLandXmlImport
          ? {
              staged: stagedLandXmlImport,
              onChangeSelection: handleLandXmlSelectionChange,
              onCancel: () => setStagedLandXmlImport(null),
              onImportSelected: handleLandXmlImportSelected,
            }
          : null
      }
      editForms={{
        surfacePointEditSessions,
        surfaceBulkSelection,
        surfaceBulkEditSessions,
      }}
    >
      <SurveyCadWorkspaceSurface
        workspace={cadWorkspace}
        floatingPanels={floatingPanels}
        parcelLayoutWorkflow={parcelLayoutWorkflow}
        traverseDraftPanelState={traverseDraftPanelState}
        commandDisplay={commandDisplay}
        displayScene={displaySceneWithSurfaceEdits}
        reportedComputationEntities={reportedComputationEntities}
        parcelLayoutState={parcelLayoutState}
        parcelLayoutFrontageSegmentSelectionActive={parcelLayoutFrontageSegmentSelectionActive}
        showParcelLabels={showParcelLabels}
        viewport={viewport}
        viewBounds={viewBounds}
        onViewportChange={applyViewport}
        onViewBoundsChange={setViewBounds}
        onParcelLayoutPreviewStateChange={setParcelLayoutPreviewState}
        onParcelLayoutAutoPreviewStateChange={setParcelLayoutAutoPreviewState}
        onToggleParcelLabels={() => setShowParcelLabels((current) => !current)}
        cloneBounds={cloneCadBounds}
        shellChrome={shellChrome}
        surfacePickActive={surfacePick != null || volumePick != null || analysisPick != null || blockInsertPick != null || surfaceEditSessions.session != null || surfacePointEditSessions.session != null || surfaceBulkSelection.session != null || surfaceBulkEditSessions.session != null}
        onSurfacePickPoint={createCadSurfacePickDispatch({
          editSessions: {
            pointEdit: surfacePointEditSessions,
            bulkSelection: surfaceBulkSelection,
            bulkEdit: surfaceBulkEditSessions,
            edit: surfaceEditSessions,
          },
          picks: { blockInsertPick, analysisPick, volumePick, surfacePick },
          project: activeProject,
          surfaceCache,
          inquiries: { describeAnalysisAt, describeVolumeDifference },
          runBlockOp: cadWorkspace.runBlockOp,
          setters: {
            setBlockInsertPick,
            setAnalysisPickAnswer,
            setAnalysisPick,
            setVolumePickAnswer,
            setVolumePick,
            setLastSurfaceInquiry,
            setSurfacePick,
          },
        })}
        selectedSurfaceId={selectedSurfaceId}
        onSurfaceClick={(surfaceId) => setSelectedSurfaceId(surfaceId)}
        selectedProfileViewId={selectedProfileViewId}
        onProfileViewClick={(viewId) => setSelectedProfileViewId(viewId)}
        selectedSampleLineId={selectedSampleLineId}
        onSampleLineClick={(groupId, lineId) => {
          setSelectedSampleLineGroupId(groupId);
          setSelectedSampleLineId(lineId);
        }}
        selectedSectionViewId={selectedSectionViewId}
        onSectionViewClick={(viewId) => setSelectedSectionViewId(viewId)}
      />
    </SurveyCadWorkspaceManagers>
  );
};

export default SurveyCadWorkspace;
