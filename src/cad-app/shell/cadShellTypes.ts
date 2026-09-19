import type {
  CadEntity,
  CadEntityId,
  CadLayer,
  CadLineType,
  CadSnapKind,
} from '../../engine/cad/cadTypes';
import type { CadSnapPreferences } from '../../hooks/surveyCad/useSurveyCadSnapping';
import type {
  CadEntityPropertyEditField,
  CadPropertiesPanelState,
} from '../../engine/cad/cadProperties';
import type { CadCommand } from '../../engine/cad/cadTransactions.types';
import type { BreaklineEntityPreview, BoundarySourcePreview } from '../../engine/cad/cadSurfaceView';
import type { CadSurfaceSnapshot } from './cadSurfaceSnapshot';
import type { CadVolumeSnapshot } from './cadVolumeSnapshot';
import type { CadProfileSnapshot } from './cadProfileSnapshot';
import type { CadSectionSnapshot } from './cadSectionSnapshot';
import type { ActiveCommandKey } from '../../hooks/surveyCad/useSurveyCadCommandTypes';
import type { DraftSheet } from '../../engine/cad/cadDraftTypes';

export type { ActiveCommandKey };

/** Phase 18B — dock sides. No floating document windows (single browser canvas). */
export type CadDockSide = 'left' | 'right' | 'bottom-hidden';

/** Panels that can live in a side dock. */
export type CadSidePanelId = 'toolspace' | 'properties' | 'layers';

export type CadToolspaceTab = 'prospector' | 'survey' | 'settings';

/** Phase 18D — survey manager/dialog targets (ribbon + toolspace entry points). */
export type SurveyManagerKind =
  | 'points'
  | 'point-groups'
  | 'point-styles'
  | 'point-label-styles'
  | 'f2f'
  | 'surfaces'
  | 'profiles'
  | 'sections';

/**
 * Phase 18D — per-point display facts precomputed in the workspace (resolver
 * + names + source lines), so Toolspace/Properties stay dumb renderers.
 * `table` is capped for the point table; `selected` always covers the full
 * survey-point selection for Properties batch edits.
 */
export interface CadSurveyPointDisplayInfo {
  entityId: string;
  stationId: string;
  x: number;
  y: number;
  z?: number;
  description?: string;
  featureCode?: string;
  layerId: string;
  pointClass: string;
  source: string;
  basePointStyleName: string;
  pointStyleOverrideId: string | null;
  pointStyleOverrideName: string | null;
  effectivePointStyleName: string;
  pointStyleSourceText: string;
  baseLabelStyleName: string;
  pointLabelStyleOverrideId: string | null;
  labelStyleOverrideName: string | null;
  effectiveLabelStyleName: string;
  labelStyleSourceText: string;
  matchingGroupNames: string[];
}

export interface CadSurveySnapshot {
  pointCount: number;
  allPointIds: string[];
  groups: Array<{ id: string; name: string; memberCount: number; priority: number }>;
  pointStyles: Array<{ id: string; name: string }>;
  labelStyles: Array<{ id: string; name: string }>;
  table: CadSurveyPointDisplayInfo[];
  tableTruncated: boolean;
  selected: CadSurveyPointDisplayInfo[];
}

/**
 * Phase 18E — F2F derived summary for Toolspace/ribbon. Computed from the
 * drawing-owned catalog + entity provenance on every publish; the shell
 * holds no F2F state of its own.
 */
export interface CadF2FSnapshot {
  catalogName: string;
  catalogVersion: string;
  catalogRevision: string;
  definitionCount: number;
  aliasCount: number;
  catalogState: 'READY' | 'MISSING_LEGACY';
  generatedPoints: number;
  generatedLabels: number;
  generatedLinework: number;
  overrides: number;
  detached: number;
  unmapped: number;
  linkStatus: string;
}

export type CadActiveLayout = 'MODEL' | { sheetId: string };

/**
 * Phase 18B — workspace chrome state persisted to localStorage, separate
 * from WNCAD. Drawing content is never stored here.
 */
export interface CadShellLayoutState {
  version: 1;
  leftPanel: CadSidePanelId | null;
  rightPanel: CadSidePanelId | null;
  leftWidthPx: number;
  rightWidthPx: number;
  commandHeightPx: number;
  toolspaceTab: CadToolspaceTab;
  ribbonCollapsed: boolean;
  /**
   * Phase 18C — lineweight display toggle. WORKSPACE-ONLY: persisted with
   * shell chrome (localStorage), never written to the drawing, never dirty.
   */
  lineweightDisplay: boolean;
}

export const CAD_SHELL_LAYOUT_STORAGE_KEY = 'webnet.cad.shell.v1';

/**
 * Phase 18B — slow-changing workspace facts published by
 * SurveyCadWorkspace to the shell. Cursor position rides a separate
 * channel (see CadShellLink) so mousemove never re-renders chrome.
 */
export interface CadWorkspaceSnapshot {
  drawingId: string;
  drawingName: string;
  units: string;
  entityCount: number;
  selectionCount: number;
  selectedEntityIds: string[];
  /** Slim entity summaries for Toolspace/Properties (no scene data). */
  selectionPreview: Array<{ id: string; type: CadEntity['type']; label: string }>;
  layers: CadLayer[];
  layerEntityCounts: Record<string, number>;
  /** Project-owned current layer (always resolved; falls back to `general`). */
  currentLayerId: string;
  /** Drawing-owned linetype library (manager dropdown, Toolspace list). */
  lineTypes: CadLineType[];
  sheets: DraftSheet[];
  properties: CadPropertiesPanelState | null;
  activeCommandKey: string | null;
  commandPrompt: string;
  commandInputValue: string;
  canUndo: boolean;
  canRedo: boolean;
  historyDepth: number;
  redoDepth: number;
  snapPreferences: CadSnapPreferences;
  snapStatusText: string;
  stationCount: number;
  dependencyStatus: string;
  /** Phase 18D — survey points/groups/styles summary; null when no workspace. */
  survey: CadSurveySnapshot | null;
  /** Phase 18F — TIN surfaces (definitions + session mesh status). */
  surface: CadSurfaceSnapshot | null;
  /** Phase 18I — TIN-to-TIN volume relationships (derived status + quantities). */
  volume: CadVolumeSnapshot | null;
  /** Phase 18J — surface profiles + profile views (derived status + stats). */
  profile: CadProfileSnapshot | null;
  /** Phase 18K — sample-line groups + section views (derived status + areas). */
  section: CadSectionSnapshot | null;
  /** Phase 18E — F2F catalog + provenance summary (derived, no duplicate state). */
  f2f: CadF2FSnapshot | null;
  /** UI command keys with a live starter in the mounted workspace. */
  availableCommands: string[];
}

export interface CadCursorPoint {
  x: number;
  y: number;
  label: string;
}

/**
 * Phase 18B — actions registered on the link by SurveyCadWorkspace.
 * Every entry routes to existing workspace machinery (starters, history,
 * selection, layer replace); the shell never mutates the drawing directly.
 * Absent (null link / embedded use) = shell chrome hidden, workspace standalone.
 */
export interface CadShellActions {
  /** Start a UI command session; returns false when the key has no starter. */
  startCommand: (_key: ActiveCommandKey) => boolean;
  undo: () => void;
  redo: () => void;
  selectAll: () => void;
  clearSelection: () => void;
  eraseSelection: () => void;
  selectEntities: (_entityIds: string[], _append?: boolean) => void;
  editField: (
    _entityId: CadEntityId,
    _field: CadEntityPropertyEditField,
    _value: string,
  ) => import('../../hooks/surveyCad/surveyCadPropertiesEdit').CadPropertiesEditOutcome;
  /** Route one undoable layer-table mutation (LAYER_* family). */
  runLayerCommand: (_command: CadCommand) => boolean;
  /** Route one undoable survey-display mutation (SURVEY_* family). */
  runSurveyCommand: (_command: CadCommand) => boolean;
  /** Phase 18F — select a surface (Toolspace/manager/viewport converge here). */
  selectSurface: (_surfaceId: string | null) => void;
  /** Phase 18I — select a volume surface (Toolspace/manager converge here). */
  selectVolume: (_volumeId: string | null) => void;
  /** Phase 18J — select a surface profile (Toolspace/manager/viewport converge). */
  selectProfile: (_profileId: string | null) => void;
  /** Phase 18J — manual session rebuild of one profile (never auto-started). */
  rebuildProfile: (_profileId: string) => string;
  /** Phase 18J — create a profile view from the current profile selection. */
  createProfileView: (_profileId?: string) => void;
  /** Phase 18J — select a profile view (viewport click / Toolspace converge). */
  selectProfileView: (_viewId: string | null) => void;
  /**
   * Phase 18J — display-station input resolves to E/N/elevation text (pure
   * read; ambiguous equation gaps answer honestly, never guessed).
   */
  queryProfileElevation: (_profileId: string, _displayStation: number) => string;
  /** Phase 18K — select a sample-line group (Toolspace/manager/viewport converge). */
  selectSampleLineGroup: (_groupId: string | null) => void;
  /** Phase 18K — select one sample line within its group. */
  selectSampleLine: (_groupId: string | null, _lineId: string | null) => void;
  /** Phase 18K — manual session rebuild of one group (never auto-started). */
  rebuildSections: (_groupId: string) => string;
  /** Phase 18K — manual session rebuild of one line x every source. */
  rebuildSectionLine: (_groupId: string, _lineId: string) => string;
  /** Phase 18K — batch-create section views for a group (single vertical stack). */
  createSectionViews: (_groupId: string) => string;
  /** Phase 18K — select a section view (viewport click / Toolspace converge). */
  selectSectionView: (_viewId: string | null) => void;
  /**
   * Phase 18K — line + surface + signed offset (+left) resolves to
   * displayed-station/offset/E/N/elevation text (pure read; gaps and
   * outside-coverage answer honestly, never guessed).
   */
  querySectionElevation: (_groupId: string, _lineId: string, _surfaceId: string, _offset: number) => string;
  /**
   * Phase 18I — manual volume calculation through the session volume
   * service (explicit Calculate/Recalculate only; never auto-started).
   * Returns display text for the command/history seam.
   */
  requestVolume: (_volumeId: string) => string;
  /**
   * Phase 18I — arm a one-shot viewport pick for difference inquiry
   * (null disarms). The picked world point resolves to base/comparison
   * elevations + CUT/FILL verdict text.
   */
  startVolumePick: (_volumeId: string | null) => void;
  /** Phase 18I — E/N inputs resolve to difference display text (pure read). */
  queryVolumeDifference: (_volumeId: string, _x: number, _y: number) => string | null;
  /** Phase 18I — manual Calculate for the selected volume (ribbon/registry path). */
  calculateSelectedVolume: () => void;
  /**
   * Phase 18F — arm a one-shot viewport pick for surface inquiry
   * (null disarms). The picked world point resolves to E/N/elevation text.
   */
  startSurfacePick: (_surfaceId: string | null, _mode?: 'elevation' | 'slope') => void;
  /** Phase 18F — E/N inputs resolve to elevation display text (pure read). */
  querySurfaceElevation: (_surfaceId: string, _x: number, _y: number) => string | null;
  /** Phase 18H — E/N inputs resolve to slope/aspect display text (pure read). */
  querySurfaceSlope: (_surfaceId: string, _x: number, _y: number) => string | null;
  /**
   * Phase 18F — synchronous session rebuild of one surface (pure engine
   * build into the session mesh cache; never history, never dirty).
   * Returns display text for the command/history seam.
   */
  rebuildSurface: (_surfaceId: string) => string;
  /** Phase 18F — rebuild every surface needing it; display text summary. */
  rebuildAllSurfaces: () => string;
  /**
   * Phase 18F — preview the single selected chainable entity as breakline
   * source (Z gate + F2F provenance); null when selection is unusable.
   */
  describeBreaklineSource: (_allowF2F: boolean) => BreaklineEntityPreview | null;
  /**
   * Phase 18F — preview the single selected ring entity as a boundary
   * source (closed-ness validated in the editor); null when unusable.
   */
  describeBoundarySource: () => BoundarySourcePreview | null;
  /**
   * Open a survey manager dialog (point-groups preselects a group), or
   * focus the Toolspace survey tab (points). F2F opens the drafting panel.
   */
  openSurveyManager: (_kind: SurveyManagerKind, _selectedId?: string) => void;
  /** Select every survey point in the drawing. */
  selectAllSurveyPoints: () => void;
  /** Select the survey points matching one group (engine-side membership). */
  selectSurveyGroupPoints: (_groupId: string) => void;
  /** Guarded set-current (must exist/ON/thawed); false + no-op when blocked. */
  setCurrentLayer: (_layerId: string) => boolean;
  /** Show + focus the Layer Properties Manager. */
  openLayerManager: () => void;
  setSnapPreference: (_kind: CadSnapKind, _enabled: boolean) => void;
  newDrawing: () => void;
  openDrawingFile: () => void;
  saveDrawing: () => void;
  /**
   * Phase 18M — open the LandXML import file picker. The workspace parses the
   * picked file into a staged preview; nothing commits until worker 3 wires
   * `commitLandXmlImport` + imported-TIN scheduling behind the review panel.
   */
  requestLandXmlImport: () => void;
  toggleDraftingPanel: () => void;
  toggleExportCenter: () => void;
  cancelCommand: () => void;
  confirmCommandInput: () => void;
}
