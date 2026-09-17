import type {
  CadEntity,
  CadEntityId,
  CadLayer,
  CadSnapKind,
} from '../../engine/cad/cadTypes';
import type { CadSnapPreferences } from '../../hooks/surveyCad/useSurveyCadSnapping';
import type {
  CadEntityPropertyEditField,
  CadPropertiesPanelState,
} from '../../engine/cad/cadProperties';
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
  ) => boolean;
  setLayerPatch: (_layerId: string, _patch: Partial<CadLayer>) => void;
  createLayer: (_name: string) => void;
  deleteLayer: (_layerId: string) => void;
  setSnapPreference: (_kind: CadSnapKind, _enabled: boolean) => void;
  newDrawing: () => void;
  openDrawingFile: () => void;
  saveDrawing: () => void;
  toggleDraftingPanel: () => void;
  toggleExportCenter: () => void;
  cancelCommand: () => void;
  confirmCommandInput: () => void;
}
