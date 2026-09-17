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
import type { ActiveCommandKey } from '../../hooks/surveyCad/useSurveyCadCommandTypes';
import type { DraftSheet } from '../../engine/cad/cadDraftTypes';

export type { ActiveCommandKey };

/** Phase 18B — dock sides. No floating document windows (single browser canvas). */
export type CadDockSide = 'left' | 'right' | 'bottom-hidden';

/** Panels that can live in a side dock. */
export type CadSidePanelId = 'toolspace' | 'properties' | 'layers';

export type CadToolspaceTab = 'prospector' | 'survey' | 'settings';

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
  /** Guarded set-current (must exist/ON/thawed); false + no-op when blocked. */
  setCurrentLayer: (_layerId: string) => boolean;
  /** Show + focus the Layer Properties Manager. */
  openLayerManager: () => void;
  setSnapPreference: (_kind: CadSnapKind, _enabled: boolean) => void;
  newDrawing: () => void;
  openDrawingFile: () => void;
  saveDrawing: () => void;
  toggleDraftingPanel: () => void;
  toggleExportCenter: () => void;
  cancelCommand: () => void;
  confirmCommandInput: () => void;
}
