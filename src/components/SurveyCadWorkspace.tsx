import React, { useEffect, useMemo, useRef, useState, type ChangeEvent, type Dispatch, type SetStateAction } from 'react';
import type { AdjustmentResult, InstrumentLibrary, ParseOptions, UnitsMode } from '../types';
import { buildSurveyCadSpikeProject } from '../engine/cad/cadModel';
import type {
  CadBounds,
  CadDrawingDocument,
  CadParcelLayoutUiState,
  CadSampleLineGroup,
  CadSurveyPointEntity,
  SurveyCadPersistedState,
} from '../engine/cad/cadTypes';
import { evaluatePointGroupMembership } from '../engine/cad/cadPointGroups';
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
import { importSnapshotIntoCadDrawing } from '../cad-app/cadSnapshotImport';
import type { CadDrawingLifecycleEvent } from '../cad-app/cadAppTypes';
import type { CadShellLink } from '../cad-app/shell/cadShellLink';
import type { ActiveCommandKey } from '../hooks/surveyCad/useSurveyCadCommandTypes';
import type { CadShellActions, CadWorkspaceSnapshot, SurveyManagerKind } from '../cad-app/shell/cadShellTypes';
import { buildCadSurveySnapshot } from '../cad-app/shell/cadSurveySnapshot';
import {
  buildCadSurfaceSnapshot,
  querySurfaceElevationText,
  querySurfaceSlopeText,
  type CadSurfaceInquiry,
} from '../cad-app/shell/cadSurfaceSnapshot';
import {
  buildCadVolumeSnapshot,
  formatVolumeDifferenceAnswer,
  queryVolumeDifference,
} from '../cad-app/shell/cadVolumeSnapshot';
import { buildCadProfileSnapshot, formatProfileElevationAnswer } from '../cad-app/shell/cadProfileSnapshot';
import { CadSurfaceManager } from '../cad-app/shell/CadSurfaceManager';
import { CadProfileManager } from '../cad-app/shell/CadProfileManager';
import { CadSampleLineManager } from '../cad-app/shell/CadSampleLineManager';
import {
  buildCadSectionSnapshot,
  estimateSectionViewFrame,
  formatSectionElevationAnswer,
  layoutSectionViewStack,
  querySectionElevationAtOffset,
} from '../cad-app/shell/cadSectionSnapshot';
import { buildProfileViewDisplayLayers } from '../engine/cad/cadProfileView';
import {
  buildSampleLineDisplayLayers,
  buildSectionViewDisplayLayers,
} from '../engine/cad/cadSectionView';
import { filterCadDisplaySceneForViewport } from '../engine/cad/cadViewportAppearance';
import { resolveProfileStationInput, queryProfileElevationAt } from '../engine/cad/profiles/profileInquiry';
import { cadAlignmentRawStationToDisplayStation, formatCadStation } from '../engine/cad/cadAlignmentStationing';
import { createCadSurfaceCache } from '../engine/cad/cadSurfaceCache';
import { createCadSurfaceContourCache } from '../engine/cad/surfaceContourCache';
import { SurfaceWorkerClient } from '../workers/surfaceWorkerClient';
import { SurfaceBuildService } from '../workers/surfaceBuildService';
import { SurfaceContourService } from '../workers/surfaceContourService';
import { SurfaceVolumeService } from '../workers/surfaceVolumeService';
import { SurfaceProfileService } from '../workers/surfaceProfileService';
import { SurfaceSectionService } from '../workers/surfaceSectionService';
import { createCadProfileCache } from '../engine/cad/profileCache';
import { createCadSectionCache } from '../engine/cad/sectionCache';
import { createCadSurfaceVolumeCache } from '../engine/cad/surfaceVolumeCache';
import { computeCadSurfaceSourceRevision } from '../engine/cad/cadSurfaces';
import { backfillCadSurfaceStyles } from '../engine/cad/cadSurfaceStyles';
import { contourLevelSpecFromStyle } from '../engine/cad/cadSurfaceContourView';
import {
  computeContourGeometryRevision,
  toContourGeometrySpec,
} from '../engine/cad/surfaceContours/contourStyleRevision';
import type { SurfaceContourDisplayInput } from '../engine/cad/cadSurfaceView';
import {
  describeSelectedBoundaryEntity,
  describeSelectedBreaklineEntity,
} from '../engine/cad/cadSurfaceView';
import { surfaceContentRevision } from '../engine/cad/cadSurfaceView';
import { buildCadF2FSnapshot } from './surveyCad/f2fGeneratedSummary';
import { getCadEntityDisplayLabel } from '../engine/cad/cadEntityNames';
import { resolveCurrentCadLayerId } from '../engine/cad/cadLayers';
import { validateSetCurrent } from './surveyCad/LayerPanel.guards';
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
import { SurveyCadDraftingPanel, type SurveyCadDraftingTab } from './surveyCad/SurveyCadDraftingPanel';
import { SurveyPointGroupManager } from './surveyCad/SurveyPointGroupManager';
import { SurveyPointLabelStyleManager } from './surveyCad/SurveyPointLabelStyleManager';
import { SurveyPointStyleManager } from './surveyCad/SurveyPointStyleManager';
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
  /**
   * Phase 18C LWT: workspace-only lineweight display preference driven by
   * the shell status bar. Never dirties the drawing or the stored mm value.
   */
  lineweightDisplay?: import('../engine/cad/cadViewportAppearance').LineweightDisplayMode;
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
  lineweightDisplay = 'thin',
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
  const volumeCache = useMemo(
    () => createCadSurfaceVolumeCache(activeDrawing.drawingId),
    [activeDrawing.drawingId],
  );
  // Phase 18F — surface UI state (all session-only; meshes never persist).
  const [selectedSurfaceId, setSelectedSurfaceId] = useState<string | null>(null);
  const [surfacePick, setSurfacePick] = useState<{ surfaceId: string; mode: 'elevation' | 'slope' } | null>(null);
  const [lastSurfaceInquiry, setLastSurfaceInquiry] = useState<CadSurfaceInquiry | null>(null);
  const [surfaceMeshSessions, setSurfaceMeshSessions] = useState<Record<string, string[]>>({});
  const surfaceCache = useMemo(
    () => createCadSurfaceCache(activeDrawing.drawingId),
    [activeDrawing.drawingId],
  );
  const surfaceRevisionIndex = useMemo(
    () => new Map(Object.entries(surfaceMeshSessions)),
    [surfaceMeshSessions],
  );
  // Phase 18G — production builds run through the surface build service
  // (one worker per drawing session; async completion populates the
  // session mesh cache). Refs mirror render state so late worker
  // completions always guard against the live project/drawing.
  const activeProjectForBuildsRef = useRef(cadProject);
  activeProjectForBuildsRef.current = cadProject;
  const drawingIdForBuildsRef = useRef(activeDrawing.drawingId);
  drawingIdForBuildsRef.current = activeDrawing.drawingId;
  const surfaceMeshSessionsForBuildsRef = useRef(surfaceMeshSessions);
  surfaceMeshSessionsForBuildsRef.current = surfaceMeshSessions;
  const [surfaceBuildVersion, setSurfaceBuildVersion] = useState(0);
  const surfaceBuildService = useMemo(
    () =>
      new SurfaceBuildService({
        drawingId: activeDrawing.drawingId,
        getProject: () => activeProjectForBuildsRef.current,
        getDrawingId: () => drawingIdForBuildsRef.current,
        cache: surfaceCache,
        createTransport: () => {
          try {
            if (typeof Worker === 'undefined') return null;
            return new SurfaceWorkerClient(
              new Worker(new URL('../workers/surfaceWorker.ts', import.meta.url), {
                type: 'module',
              }),
            );
          } catch {
            return null;
          }
        },
        getBuiltRevisions: (surfaceId) => surfaceMeshSessionsForBuildsRef.current[surfaceId] ?? [],
        // Bounded index: current + ≤1 previous stale revision per surface.
        recordRevision: (surfaceId, revision) =>
          setSurfaceMeshSessions((previous) => ({
            ...previous,
            [surfaceId]: [...(previous[surfaceId] ?? []), revision].slice(-2),
          })),
        notify: (message) => setFileStatusText(message),
        onStateChange: () => setSurfaceBuildVersion((version) => version + 1),
      }),
    [activeDrawing.drawingId, surfaceCache],
  );
  useEffect(() => () => surfaceBuildService.dispose(), [surfaceBuildService]);
  // Snapshot inputs refresh only when the service reports a state change
  // (pending/diagnostic transitions), not on every render.
  const surfaceBuildInputs = useMemo(
    () => ({
      // Version tag: refreshes snapshot inputs whenever the service reports
      // a state change (pending/diagnostic transitions), not on every render.
      buildVersion: surfaceBuildVersion,
      buildingSurfaceIds: surfaceBuildService.buildingSurfaceIds(),
      sessionDiagnostics: surfaceBuildService.sessionDiagnostics(),
      syncFallbackRevisions: surfaceBuildService.syncFallbackRevisions(),
    }),
    [surfaceBuildService, surfaceBuildVersion],
  );
  // Phase 18H — contour derivation control plane (one per drawing
  // session, mirrors SurfaceBuildService ownership). Derivations consume
  // the cached TIN (never rebuild it) and populate the session contour
  // cache; late results from an old interval/mesh/drawing never replace
  // the current set (latest-wins per surface, owned by the service).
  const contourCache = useMemo(
    () => createCadSurfaceContourCache(activeDrawing.drawingId),
    [activeDrawing.drawingId],
  );
  const [contourVersion, setContourVersion] = useState(0);
  const contourService = useMemo(
    () =>
      new SurfaceContourService({
        drawingId: activeDrawing.drawingId,
        getProject: () => activeProjectForBuildsRef.current,
        getDrawingId: () => drawingIdForBuildsRef.current,
        tinCache: surfaceCache,
        contourCache,
        createTransport: () => {
          try {
            if (typeof Worker === 'undefined') return null;
            return new SurfaceWorkerClient(
              new Worker(new URL('../workers/surfaceWorker.ts', import.meta.url), {
                type: 'module',
              }),
            );
          } catch {
            return null;
          }
        },
        shouldAutoDerive: (surfaceId) => {
          const project = activeProjectForBuildsRef.current;
          const surface = (project.surfaces ?? []).find((entry) => entry.id === surfaceId);
          if (!surface) return false;
          const style = backfillCadSurfaceStyles(project.surfaceStyles).find(
            (entry) => entry.id === surface.styleId,
          );
          return style != null && contourLevelSpecFromStyle(style) != null;
        },
        notify: (message) => setFileStatusText(message),
        onStateChange: () => setContourVersion((version) => version + 1),
      }),
    [activeDrawing.drawingId, surfaceCache, contourCache],
  );
  useEffect(() => () => contourService.dispose(), [contourService]);
  // Auto-derive: every surface whose style enables contours and whose
  // parent TIN is CURRENT gets a cached set for the style's geometry
  // revision. Guarded (cached/pending/current-TIN checks) so the effect
  // converges instead of re-requesting. Fires on project edits (style or
  // definition), TIN completions (build version), and contour state
  // changes (completion/diagnostic). Never touches the TIN.
  useEffect(() => {
    const project = activeProjectForBuildsRef.current;
    for (const surface of project.surfaces ?? []) {
      const style = backfillCadSurfaceStyles(project.surfaceStyles).find(
        (entry) => entry.id === surface.styleId,
      );
      if (!style) continue;
      const spec = contourLevelSpecFromStyle(style);
      if (!spec) continue;
      // Session CURRENT = fresh TIN cache hit (cachedRevision is never
      // written in-session; see resolveSurfaceDisplayStatus).
      const revision = computeCadSurfaceSourceRevision(project, surface);
      if (!surfaceCache.get(surface.id, revision)) continue;
      const geometryRevision = computeContourGeometryRevision(toContourGeometrySpec(spec));
      if (contourCache.get(surface.id, revision, geometryRevision)) continue;
      if (contourService.buildingContourIds().has(surface.id)) continue;
      contourService.requestContours(surface.id, spec);
    }
  });
  // Scene input: current-geometry set when the TIN is fresh, newest
  // retained set as stale display otherwise (mirrors the stale-mesh
  // contract). Null = no contour display (definition-only, legacy style,
  // or nothing derived yet). Version tag re-renders on derivation state
  // changes.
  const surfaceContourInputs = useMemo(() => {
    const getContours = (surfaceId: string): SurfaceContourDisplayInput | null => {
      const project = activeProjectForBuildsRef.current;
      const surface = (project.surfaces ?? []).find((entry) => entry.id === surfaceId);
      if (!surface) return null;
      const style = backfillCadSurfaceStyles(project.surfaceStyles).find(
        (entry) => entry.id === surface.styleId,
      );
      if (!style) return null;
      const spec = contourLevelSpecFromStyle(style);
      if (!spec) return null;
      const revision = computeCadSurfaceSourceRevision(project, surface);
      if (surfaceCache.get(surfaceId, revision)) {
        const geometryRevision = computeContourGeometryRevision(toContourGeometrySpec(spec));
        const set = contourCache.get(surfaceId, revision, geometryRevision);
        return set ? { set } : null;
      }
      const retained = contourCache.retained(surfaceId);
      const stale = retained.length > 0 ? retained[retained.length - 1]! : undefined;
      return stale ? { set: stale } : null;
    };
    return { version: contourVersion, getContours };
  }, [contourVersion, surfaceCache, contourCache]);
  // Phase 18I — volume derivation control plane (one per drawing
  // session, mirrors SurfaceBuildService ownership). Manual calculation
  // only: source rebuilds never auto-start volume work; notifyMeshBuilt
  // cancels in-flight work for affected volumes and lets status derive
  // stale from the revision. No-Display styles request quantity-only
  // (includeDisplay false, decided inside the service).
  const volumeService = useMemo(
    () =>
      new SurfaceVolumeService({
        drawingId: activeDrawing.drawingId,
        getProject: () => activeProjectForBuildsRef.current,
        getDrawingId: () => drawingIdForBuildsRef.current,
        tinCache: surfaceCache,
        volumeCache,
        createTransport: () => {
          try {
            if (typeof Worker === 'undefined') return null;
            return new SurfaceWorkerClient(
              new Worker(new URL('../workers/surfaceWorker.ts', import.meta.url), {
                type: 'module',
              }),
            );
          } catch {
            return null;
          }
        },
        notify: (message) => setFileStatusText(message),
        onStateChange: () => setVolumeVersion((version) => version + 1),
      }),
    [activeDrawing.drawingId, surfaceCache, volumeCache],
  );
  useEffect(() => () => volumeService.dispose(), [volumeService]);
  // Phase 18J — profile derivation control plane (one per drawing
  // session, mirrors SurfaceVolumeService ownership). Manual derivation
  // only: source rebuilds and alignment edits never auto-start profile
  // work; the notify hooks cancel in-flight work for affected profiles
  // and status re-derives from the revision. Results never persist.
  const profileCache = useMemo(
    () => createCadProfileCache(activeDrawing.drawingId),
    [activeDrawing.drawingId],
  );
  const [profileVersion, setProfileVersion] = useState(0);
  const profileService = useMemo(
    () =>
      new SurfaceProfileService({
        drawingId: activeDrawing.drawingId,
        getProject: () => activeProjectForBuildsRef.current,
        getDrawingId: () => drawingIdForBuildsRef.current,
        tinCache: surfaceCache,
        profileCache,
        createTransport: () => {
          try {
            if (typeof Worker === 'undefined') return null;
            return new SurfaceWorkerClient(
              new Worker(new URL('../workers/surfaceWorker.ts', import.meta.url), {
                type: 'module',
              }),
            );
          } catch {
            return null;
          }
        },
        notify: (message) => setFileStatusText(message),
        onStateChange: () => setProfileVersion((version) => version + 1),
      }),
    [activeDrawing.drawingId, surfaceCache, profileCache],
  );
  useEffect(() => () => profileService.dispose(), [profileService]);
  // Source-rebuild hookup: only a NEW mesh revision for a surface
  // cancels in-flight profile work (their revision moved). A ref diff
  // guards it — notifying on every render would supersede work that was
  // just requested. Status itself re-derives from revisions every publish.
  const notifiedProfileMeshRevisionsRef = useRef<Record<string, string[]>>({});
  useEffect(() => {
    const previous = notifiedProfileMeshRevisionsRef.current;
    for (const [surfaceId, revisions] of Object.entries(surfaceMeshSessions)) {
      const seen = previous[surfaceId] ?? [];
      if (revisions.length !== seen.length || revisions.some((entry, index) => entry !== seen[index])) {
        profileService.notifyMeshBuilt(surfaceId);
      }
    }
    notifiedProfileMeshRevisionsRef.current = surfaceMeshSessions;
  }, [surfaceMeshSessions, profileService]);
  // Alignment-edit hookup: only a CHANGED alignment entity cancels
  // in-flight work for bound profiles (revision guard keeps stale
  // results from CURRENT). Digest diff — not a per-render notify.
  const notifiedAlignmentDigestsRef = useRef<Record<string, string>>({});
  useEffect(() => {
    const previous = notifiedAlignmentDigestsRef.current;
    const next: Record<string, string> = {};
    for (const entity of cadProject.entities) {
      if (entity.type !== 'alignment') continue;
      const digest = JSON.stringify(entity);
      next[entity.id] = digest;
      if (previous[entity.id] != null && previous[entity.id] !== digest) {
        profileService.notifyAlignmentChanged(entity.id);
      }
    }
    notifiedAlignmentDigestsRef.current = next;
  }, [cadProject, profileService]);
  // Scene + snapshot inputs refresh only when the service reports a
  // state change (pending/diagnostic transitions), not on every render.
  const surfaceProfileInputs = useMemo(
    () => ({
      version: profileVersion,
      tinCache: surfaceCache,
      profileCache,
      buildingProfileIds: profileService.buildingProfileIds(),
      sessionDiagnostics: profileService.profileDiagnostics(),
    }),
    [profileService, profileVersion, surfaceCache, profileCache],
  );
  // Phase 18K — section derivation control plane (one per drawing
  // session, mirrors the profile service). Manual derivation only:
  // source rebuilds and alignment edits never auto-start section work;
  // the notify hooks cancel in-flight batches for affected groups and
  // status re-derives from the revision. Results never persist.
  const sectionCache = useMemo(
    () => createCadSectionCache(activeDrawing.drawingId),
    [activeDrawing.drawingId],
  );
  const [sectionVersion, setSectionVersion] = useState(0);
  const sectionService = useMemo(
    () =>
      new SurfaceSectionService({
        drawingId: activeDrawing.drawingId,
        getProject: () => activeProjectForBuildsRef.current,
        getDrawingId: () => drawingIdForBuildsRef.current,
        tinCache: surfaceCache,
        sectionCache,
        createTransport: () => {
          try {
            if (typeof Worker === 'undefined') return null;
            return new SurfaceWorkerClient(
              new Worker(new URL('../workers/surfaceWorker.ts', import.meta.url), {
                type: 'module',
              }),
            );
          } catch {
            return null;
          }
        },
        notify: (message) => setFileStatusText(message),
        onStateChange: () => setSectionVersion((version) => version + 1),
      }),
    [activeDrawing.drawingId, surfaceCache, sectionCache],
  );
  useEffect(() => () => sectionService.dispose(), [sectionService]);
  // Source-rebuild + alignment-edit hookups share the profile diff refs'
  // shape: only NEW mesh revisions / CHANGED alignment digests notify.
  // A ref diff guards both — notifying on every render would supersede
  // work that was just requested.
  const notifiedSectionMeshRevisionsRef = useRef<Record<string, string[]>>({});
  useEffect(() => {
    const previous = notifiedSectionMeshRevisionsRef.current;
    for (const [surfaceId, revisions] of Object.entries(surfaceMeshSessions)) {
      const seen = previous[surfaceId] ?? [];
      if (revisions.length !== seen.length || revisions.some((entry, index) => entry !== seen[index])) {
        sectionService.notifyMeshBuilt(surfaceId);
      }
    }
    notifiedSectionMeshRevisionsRef.current = surfaceMeshSessions;
  }, [surfaceMeshSessions, sectionService]);
  const notifiedSectionAlignmentDigestsRef = useRef<Record<string, string>>({});
  useEffect(() => {
    const previous = notifiedSectionAlignmentDigestsRef.current;
    const next: Record<string, string> = {};
    for (const entity of cadProject.entities) {
      if (entity.type !== 'alignment') continue;
      const digest = JSON.stringify(entity);
      next[entity.id] = digest;
      if (previous[entity.id] != null && previous[entity.id] !== digest) {
        sectionService.notifyAlignmentChanged(entity.id);
      }
    }
    notifiedSectionAlignmentDigestsRef.current = next;
  }, [cadProject, sectionService]);
  const surfaceSectionInputs = useMemo(
    () => ({
      version: sectionVersion,
      sectionCache,
      buildingGroupIds: sectionService.buildingGroupIds(),
    }),
    [sectionService, sectionVersion, sectionCache],
  );
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
      }
    }
    notifiedMeshRevisionsRef.current = surfaceMeshSessions;
  }, [surfaceMeshSessions, volumeService]);
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
      filterCadDisplaySceneForViewport(activeProject, {
        ...displaySceneWithParcelLabelToggle,
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
  const displaySceneWithSections = useMemo(
    () =>
      filterCadDisplaySceneForViewport(activeProject, {
        ...displaySceneWithProfiles,
        sampleLineLayers,
        sectionViewLayers,
      }),
    [activeProject, displaySceneWithProfiles, sampleLineLayers, sectionViewLayers],
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
      currentLayerId: resolveCurrentCadLayerId(activeProject),
      lineTypes: activeProject.styleLibrary.lineTypes,
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
      survey: buildCadSurveySnapshot(activeProject, selectedEntityIds),
      f2f: buildCadF2FSnapshot(activeProject, activeCatalog, catalogStatus),
      surface: buildCadSurfaceSnapshot(activeProject, surfaceCache, selectedSurfaceId, {
        revisionIndex: surfaceRevisionIndex,
        lastInquiry: lastSurfaceInquiry,
        buildingSurfaceIds: surfaceBuildInputs.buildingSurfaceIds,
        sessionDiagnostics: surfaceBuildInputs.sessionDiagnostics,
        syncFallbackRevisions: surfaceBuildInputs.syncFallbackRevisions,
      }),
      volume: buildCadVolumeSnapshot(activeProject, surfaceCache, volumeCache, selectedVolumeId, {
        buildingVolumeIds: surfaceVolumeInputs.buildingVolumeIds,
        sessionDiagnostics: surfaceVolumeInputs.sessionDiagnostics,
      }),
      profile: buildCadProfileSnapshot(
        activeProject,
        surfaceCache,
        profileCache,
        selectedProfileId,
        selectedProfileViewId,
        {
          buildingProfileIds: surfaceProfileInputs.buildingProfileIds,
          sessionDiagnostics: surfaceProfileInputs.sessionDiagnostics,
        },
      ),
      section: buildCadSectionSnapshot(
        activeProject,
        {
          sectionCache,
          statusOf: (groupId, lineId, surfaceId) => sectionService.statusOf(groupId, lineId, surfaceId),
          buildingGroupIds: surfaceSectionInputs.buildingGroupIds,
        },
        selectedSampleLineGroupId,
        selectedSampleLineId,
        selectedSectionViewId,
      ),
      availableCommands: shellAvailableCommands,
    };
  }, [
    shellLink, activeDrawing, activeProject, activeCatalog, catalogStatus, selectionCount, selectedEntityIds, selectedEntities,
    propertiesPanelState, activeCommandKey, statusText, cadWorkspace, stationIds, dependencySummary, units,
    shellAvailableCommands, surfaceCache, surfaceRevisionIndex, selectedSurfaceId, lastSurfaceInquiry,
    surfaceBuildInputs, volumeCache, selectedVolumeId, surfaceVolumeInputs,
    profileCache, surfaceProfileInputs, selectedProfileId, selectedProfileViewId,
    sectionCache, sectionService, surfaceSectionInputs,
    selectedSampleLineGroupId, selectedSampleLineId, selectedSectionViewId,
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

  // Phase 18I — difference inquiry text (live source inquiry; pure read).
  const describeVolumeDifference = (volumeId: string, x: number, y: number): string | null => {
    const volume = activeProject.volumeSurfaces?.find((entry) => entry.id === volumeId);
    const name = volume?.name ?? volumeId;
    const result = queryVolumeDifference(activeProject, surfaceCache, volumeId, x, y);
    return formatVolumeDifferenceAnswer(result, name, x, y);
  };

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

  // Phase 18K — Section Elevation at Offset (live interpolation inquiry).
  // Signed offset (+left/−right) resolves to the displayed station +
  // E/N + interpolated elevation; gaps and outside-coverage answer
  // honestly (never guessed). Null group/line/surface/result = block.
  const describeSectionElevation = (
    groupId: string,
    lineId: string,
    surfaceId: string,
    offset: number,
  ): string => {
    const group = (activeProject.sampleLineGroups ?? []).find((entry) => entry.id === groupId);
    const line = group?.sampleLines.find((entry) => entry.id === lineId) ?? null;
    const surface = (activeProject.surfaces ?? []).find((entry) => entry.id === surfaceId);
    const alignment = activeProject.entities.find((entry) => entry.id === group?.alignmentEntityId);
    const viewName = line?.manualName ?? group?.name ?? lineId;
    if (!group || !line || !surface || !alignment || alignment.type !== 'alignment') {
      return formatSectionElevationAnswer(viewName, '—', offset, null, false);
    }
    const displayed = formatCadStation(
      cadAlignmentRawStationToDisplayStation(alignment, line.rawStation) ?? line.rawStation,
    );
    const hit = querySectionElevationAtOffset(
      activeProject,
      sectionCache,
      groupId,
      lineId,
      surfaceId,
      offset,
    );
    if (!hit) {
      return formatSectionElevationAnswer(viewName, displayed, offset, null, true);
    }
    return formatSectionElevationAnswer(viewName, displayed, offset, hit, true);
  };

  // Phase 18J — Profile Elevation at Station (live interpolation inquiry).
  // Display station resolves to raw chainage through the shared stationing
  // semantics; an ambiguous equation gap or unstationed input is surfaced
  // honestly (never guessed). Null alignment/surface/mesh = honest block.
  const describeProfileElevation = (profileId: string, displayStation: number): string => {
    const profile = (activeProject.surfaceProfiles ?? []).find((entry) => entry.id === profileId);
    if (!profile) return 'Profile not found.';
    const alignment = activeProject.entities.find((entry) => entry.id === profile.alignmentEntityId);
    const surface = (activeProject.surfaces ?? []).find((entry) => entry.id === profile.surfaceId);
    if (!alignment || alignment.type !== 'alignment' || !surface) {
      return formatProfileElevationAnswer(profile.name, profile.alignmentEntityId, '—', NaN, null, false);
    }
    const displayed = formatCadStation(displayStation);
    const mesh = surfaceCache.get(surface.id, surfaceContentRevision(activeProject, surface));
    if (!mesh) {
      return formatProfileElevationAnswer(profile.name, alignment.name, displayed, NaN, null, false);
    }
    const raw = resolveProfileStationInput(
      { elements: alignment.elements, startStation: alignment.startStation, stationEquations: alignment.stationEquations },
      displayStation,
    );
    if (raw == null) {
      return `Station ${displayed} is ambiguous inside a station equation (or unstationed) on “${profile.name}” — no guess.`;
    }
    const answer = queryProfileElevationAt(
      {
        alignmentElements: alignment.elements,
        startStation: alignment.startStation,
        stationEquations: alignment.stationEquations,
        mesh: { points: mesh.points, triangles: mesh.triangles, grid: mesh.grid, adjacency: mesh.adjacency, edgeKinds: mesh.edgeKinds },
      },
      raw,
    );
    if ('gap' in answer) {
      return `No surface profile elevation at station ${displayed} on “${profile.name}”.`;
    }
    return formatProfileElevationAnswer(profile.name, alignment.name, displayed, raw, answer, true);
  };

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
  }, [activeProject.surfaces, surfaceCache, contourService]);

  // Phase 18B shell seam (+18F surface actions): shared by the shell link
  // and workspace-local consumers (surface manager) alike.
  const shellActions: CadShellActions = {
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
      runLayerCommand: (command) => cadWorkspace.runLayerCommand(command),
      runSurveyCommand: (command) => cadWorkspace.runLayerCommand(command),
      selectSurface: (surfaceId) => setSelectedSurfaceId(surfaceId),
      selectVolume: (volumeId) => setSelectedVolumeId(volumeId),
      selectProfile: (profileId) => setSelectedProfileId(profileId),
      rebuildProfile: (profileId) => profileService.requestProfile(profileId),
      createProfileView: (profileId) => {
        const target = (activeProject.surfaceProfiles ?? []).find(
          (entry) => entry.id === (profileId ?? selectedProfileId),
        );
        if (!target) {
          setFileStatusText('Select a surface profile first.');
          return;
        }
        const ok = cadWorkspace.runLayerCommand({
          key: 'PROFILE_VIEW_CREATE',
          alignmentEntityId: target.alignmentEntityId,
          profileIds: [target.id],
        });
        setFileStatusText(ok ? 'Profile view created.' : 'Profile view rejected — see status/locks.');
      },
      selectProfileView: (viewId) => setSelectedProfileViewId(viewId),
      queryProfileElevation: (profileId, displayStation) =>
        describeProfileElevation(profileId, displayStation),
      selectSampleLineGroup: (groupId) => {
        setSelectedSampleLineGroupId(groupId);
        if (groupId == null) setSelectedSampleLineId(null);
      },
      selectSampleLine: (groupId, lineId) => {
        if (groupId != null) setSelectedSampleLineGroupId(groupId);
        setSelectedSampleLineId(lineId);
      },
      rebuildSections: (groupId) => sectionService.requestGroup(groupId),
      rebuildSectionLine: (groupId, lineId) => sectionService.requestLine(groupId, lineId),
      createSectionViews: (groupId) => {
        const group = (activeProject.sampleLineGroups ?? []).find((entry) => entry.id === groupId);
        if (!group) {
          setFileStatusText('Select a sample-line group first.');
          return 'Select a sample-line group first.';
        }
        const existing = (activeProject.sectionViews ?? []).filter(
          (entry) => entry.sampleLineGroupId === groupId,
        );
        const builtLineIds = new Set(existing.map((entry) => entry.sampleLineId));
        const missing = group.sampleLines.filter((entry) => !builtLineIds.has(entry.id));
        if (missing.length === 0) {
          setFileStatusText(`Section views for “${group.name}” already exist.`);
          return `Section views for “${group.name}” already exist.`;
        }
        // Deterministic single vertical stack below one insertion origin:
        // origin sits under the lowest existing frame (estimated heights),
        // then each frame steps down by height + gap — never overlapping
        // by construction. Placements persist via undoable transactions.
        const gap = 20;
        const groupById = new Map((activeProject.sampleLineGroups ?? []).map((entry) => [entry.id, entry]));
        const estimatedHeight = (ownerGroup: CadSampleLineGroup, lineId: string, ve = 1): number =>
          estimateSectionViewFrame(activeProject, sectionCache, ownerGroup, lineId, ve, 60).height + 20;
        // Layout clears EVERY existing section view, not just this group's:
        // a new group stacks below the current lowest frame so cross-group
        // frames never overlap.
        const allViews = activeProject.sectionViews ?? [];
        const lowest = allViews.length > 0
          ? Math.min(...allViews.map((entry) => entry.insertionY))
          : 0;
        const frames = missing.map((line) => ({
          lineId: line.id,
          width: line.leftWidth + line.rightWidth,
          height: estimatedHeight(group, line.id),
        }));
        const clearance = allViews.length > 0
          ? Math.max(
              ...allViews.map((view) => {
                const owner = groupById.get(view.sampleLineGroupId);
                return owner
                  ? estimatedHeight(owner, view.sampleLineId, view.verticalExaggeration)
                  : gap * 4;
              }),
              ...frames.map((frame) => frame.height),
            ) + gap
          : 0;
        const placements = layoutSectionViewStack(0, lowest - clearance, frames, gap);
        let created = 0;
        for (const placement of placements) {
          const ok = cadWorkspace.runLayerCommand({
            key: 'SECTION_VIEW_CREATE',
            sampleLineGroupId: groupId,
            sampleLineId: placement.lineId,
            insertionX: placement.insertionX,
            insertionY: placement.insertionY,
          });
          if (ok) created += 1;
        }
        const message =
          created === placements.length
            ? `Created ${created} section views for “${group.name}”.`
            : `Created ${created} of ${placements.length} section views — see status/locks.`;
        setFileStatusText(message);
        return message;
      },
      selectSectionView: (viewId) => setSelectedSectionViewId(viewId),
      querySectionElevation: (groupId, lineId, surfaceId, offset) =>
        describeSectionElevation(groupId, lineId, surfaceId, offset),
      requestVolume: (volumeId) => volumeService.requestVolume(volumeId),
      calculateSelectedVolume: () => {
        if (selectedVolumeId == null) return 'No volume surface selected.';
        const message = volumeService.requestVolume(selectedVolumeId);
        setFileStatusText(message);
      },
      startVolumePick: (volumeId) => {
        setSurfacePick(null);
        setVolumePick(volumeId == null ? null : { volumeId });
      },
      queryVolumeDifference: (volumeId, x, y) => describeVolumeDifference(volumeId, x, y),
      startSurfacePick: (surfaceId, mode) => {
        setVolumePick(null);
        setSurfacePick(surfaceId == null ? null : { surfaceId, mode: mode ?? 'elevation' });
      },
      querySurfaceElevation: (surfaceId, x, y) => {
        const text = querySurfaceElevationText(activeProject, surfaceCache, surfaceId, x, y);
        if (text != null) {
          const surface = activeProject.surfaces?.find((entry) => entry.id === surfaceId);
          setLastSurfaceInquiry({ surfaceId, surfaceName: surface?.name ?? surfaceId, x, y, text });
        }
        return text;
      },
      querySurfaceSlope: (surfaceId, x, y) => {
        const text = querySurfaceSlopeText(activeProject, surfaceCache, surfaceId, x, y);
        if (text != null) {
          const surface = activeProject.surfaces?.find((entry) => entry.id === surfaceId);
          setLastSurfaceInquiry({ surfaceId, surfaceName: surface?.name ?? surfaceId, x, y, text });
        }
        return text;
      },
      rebuildSurface: (surfaceId) => runSurfaceBuild(surfaceId),
      rebuildAllSurfaces: () => rebuildAllSurfaces(),
      describeBreaklineSource: (allowF2F) =>
        describeSelectedBreaklineEntity(activeProject, selectedEntityIds, { allowF2F }),
      describeBoundarySource: () =>
        describeSelectedBoundaryEntity(activeProject, selectedEntityIds),
      openSurveyManager: (kind, selectedId) => {
        if (kind === 'points') {
          shellLink?.requestToolspaceTab?.('survey');
          return;
        }
        if (kind === 'f2f') {
          setDraftingInitialTab('FIELD_TO_FINISH');
          setF2fSection(selectedId ?? null);
          setDraftingPanelOpen(true);
          return;
        }
        setSurveyManager({ kind, selectedId });
      },
      selectAllSurveyPoints: () => {
        cadWorkspace.selectEntities(
          activeProject.entities.filter((entity) => entity.type === 'survey-point').map((entity) => entity.id),
        );
      },
      selectSurveyGroupPoints: (groupId) => {
        const group = (activeProject.pointGroups ?? []).find((entry) => entry.id === groupId);
        if (!group) return;
        cadWorkspace.selectEntities(
          activeProject.entities.filter(
            (entity): entity is CadSurveyPointEntity =>
              entity.type === 'survey-point' && evaluatePointGroupMembership(entity, group),
          ).map((entity) => entity.id),
        );
      },
      setCurrentLayer: (layerId) => {
        // SET_CURRENT guard (spec §3): must exist, be ON, not frozen.
        if (validateSetCurrent(activeProject.layers, layerId) != null) return false;
        return cadWorkspace.runLayerCommand({ key: 'LAYER_SET_CURRENT', layerId });
      },
      openLayerManager: () => shellLink?.requestLayerManager?.(),
      setSnapPreference: (kind, enabled) => cadWorkspace.setSnapPreference(kind, enabled),
      newDrawing: () => handleNewDrawing(),
      openDrawingFile: () => fileInputRef.current?.click(),
      saveDrawing: () => void handleSaveDrawing(),
      toggleDraftingPanel: () => setDraftingPanelOpen((current) => !current),
      toggleExportCenter: () => setExportCenterOpen((current) => !current),
      cancelCommand: () => handleEscapeKey(),
      confirmCommandInput: () => handleEnterKey(),
    };
  useEffect(() => {
    if (!shellLink) return;
    shellLink.actions = shellActions;
    return () => {
      if (shellLink.actions === shellActions) shellLink.actions = null;
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
            initialTab={draftingInitialTab}
            draft={activeDrawing.draft}
            onLayerCommand={(command) => void cadWorkspace.runLayerCommand(command)}
            onSetCurrentLayer={(layerId) => {
              if (validateSetCurrent(activeProject.layers, layerId) != null) return;
              void cadWorkspace.runLayerCommand({ key: 'LAYER_SET_CURRENT', layerId });
            }}
            onDraftChange={(draft) => {
              replaceActiveDrawing({ ...activeDrawing, draft }, 'Updated title block template.');
            }}
            onClose={() => setDraftingPanelOpen(false)}
            onCommitFieldToFinishPayload={cadWorkspace.commitFieldToFinishPayload}
            catalog={activeCatalog}
            onCatalogChange={handleFeatureCatalogChange}
            catalogStatus={catalogStatus}
            catalogIsFallback={catalogIsFallback}
            catalogHasLegacyContent={catalogHasLegacyContent}
            referenceCounts={f2fReferenceCounts}
            fieldToFinishSettings={activeProject.fieldToFinishSettings}
            onFieldToFinishSettingsChange={handleFieldToFinishSettingsChange}
            f2fSection={f2fSection}
            adjustmentSource={adjustmentSource}
          />
        ) : null}
        {surveyManager?.kind === 'point-styles' ? (
          <SurveyPointStyleManager
            project={activeProject}
            catalog={activeCatalog}
            onSurveyCommand={(command) => cadWorkspace.runLayerCommand(command)}
            onCatalogRewire={(table, fromId, toId) => {
              handleFeatureCatalogChange({
                ...featureCatalogRef.current,
                definitions: featureCatalogRef.current.definitions.map((def) =>
                  table === 'point' && def.pointStyleId === fromId
                    ? { ...def, pointStyleId: toId }
                    : table === 'label' && def.labelStyleId === fromId
                      ? { ...def, labelStyleId: toId }
                      : def,
                ),
              });
            }}
            initialSelectedId={surveyManager.selectedId}
            onClose={() => setSurveyManager(null)}
          />
        ) : null}
        {surveyManager?.kind === 'point-label-styles' ? (
          <SurveyPointLabelStyleManager
            project={activeProject}
            catalog={activeCatalog}
            onSurveyCommand={(command) => cadWorkspace.runLayerCommand(command)}
            onCatalogRewire={(table, fromId, toId) => {
              handleFeatureCatalogChange({
                ...featureCatalogRef.current,
                definitions: featureCatalogRef.current.definitions.map((def) =>
                  table === 'point' && def.pointStyleId === fromId
                    ? { ...def, pointStyleId: toId }
                    : table === 'label' && def.labelStyleId === fromId
                      ? { ...def, labelStyleId: toId }
                      : def,
                ),
              });
            }}
            initialSelectedId={surveyManager.selectedId}
            onClose={() => setSurveyManager(null)}
          />
        ) : null}
        {surveyManager?.kind === 'point-groups' ? (
          <SurveyPointGroupManager
            project={activeProject}
            onSurveyCommand={(command) => cadWorkspace.runLayerCommand(command)}
            initialSelectedId={surveyManager.selectedId}
            onClose={() => setSurveyManager(null)}
          />
        ) : null}
        {surveyManager?.kind === 'surfaces' && shellSnapshot ? (
          <CadSurfaceManager
            snapshot={shellSnapshot}
            actions={shellActions}
            initialSelectedId={surveyManager.selectedId}
            pickArmedFor={surfacePick?.surfaceId ?? null}
            volumePickArmedFor={volumePick?.volumeId ?? null}
            volumePickAnswer={volumePickAnswer}
            onClose={() => setSurveyManager(null)}
          />
        ) : null}
        {surveyManager?.kind === 'profiles' && shellSnapshot ? (
          <CadProfileManager
            snapshot={shellSnapshot}
            actions={shellActions}
            onClose={() => setSurveyManager(null)}
          />
        ) : null}
        {surveyManager?.kind === 'sections' && shellSnapshot ? (
          <CadSampleLineManager
            snapshot={shellSnapshot}
            actions={shellActions}
            onClose={() => setSurveyManager(null)}
          />
        ) : null}
        {exportCenterOpen ? (
          <ExportCenterPanel
            drawing={activeDrawing}
            // MISSING_LEGACY drawings have no embedded catalog: export no
            // catalog rather than presenting the starter fallback as theirs.
            catalog={catalogHasLegacyContent ? null : activeCatalog}
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
          displayScene={displaySceneWithSections}
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
          surfacePickActive={surfacePick != null || volumePick != null}
          onSurfacePickPoint={(worldPoint) => {
            if (volumePick) {
              const text = describeVolumeDifference(volumePick.volumeId, worldPoint.x, worldPoint.y);
              if (text != null) {
                setVolumePickAnswer({ volumeId: volumePick.volumeId, text });
              }
              setVolumePick(null);
              return;
            }
            if (!surfacePick) return;
            const text = surfacePick.mode === 'slope'
              ? querySurfaceSlopeText(
                activeProject,
                surfaceCache,
                surfacePick.surfaceId,
                worldPoint.x,
                worldPoint.y,
              )
              : querySurfaceElevationText(
                activeProject,
                surfaceCache,
                surfacePick.surfaceId,
                worldPoint.x,
                worldPoint.y,
              );
            if (text != null) {
              const surface = activeProject.surfaces?.find((entry) => entry.id === surfacePick.surfaceId);
              setLastSurfaceInquiry({
                surfaceId: surfacePick.surfaceId,
                surfaceName: surface?.name ?? surfacePick.surfaceId,
                x: worldPoint.x,
                y: worldPoint.y,
                text,
              });
            }
            setSurfacePick(null);
          }}
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
      </div>
    </div>
  );
};

export default SurveyCadWorkspace;
