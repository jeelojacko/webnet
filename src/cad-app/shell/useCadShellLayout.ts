import { useCallback, useState } from 'react';
import {
  CAD_SHELL_LAYOUT_STORAGE_KEY,
  type CadActiveLayout,
  type CadShellLayoutState,
  type CadSidePanelId,
  type CadToolspaceTab,
} from './cadShellTypes';

export const DEFAULT_SHELL_LAYOUT: CadShellLayoutState = {
  version: 1,
  leftPanel: 'toolspace',
  rightPanel: 'properties',
  leftWidthPx: 264,
  rightWidthPx: 288,
  commandHeightPx: 148,
  toolspaceTab: 'prospector',
  ribbonCollapsed: false,
  lineweightDisplay: false,
};

const MIN_PANEL_PX = 180;
const MAX_PANEL_PX = 560;
const MIN_COMMAND_PX = 96;
const MAX_COMMAND_PX = 400;

const clamp = (value: number, min: number, max: number): number =>
  Math.min(max, Math.max(min, value));

const sanitizeLayout = (value: unknown): CadShellLayoutState => {
  if (typeof value !== 'object' || value === null) return DEFAULT_SHELL_LAYOUT;
  const raw = value as Partial<CadShellLayoutState>;
  const panel = (entry: unknown): CadSidePanelId | null =>
    entry === 'toolspace' || entry === 'properties' || entry === 'layers' ? entry : null;
  const tab = (entry: unknown): CadToolspaceTab =>
    entry === 'survey' || entry === 'settings' ? entry : 'prospector';
  return {
    version: 1,
    leftPanel: panel(raw.leftPanel),
    rightPanel: panel(raw.rightPanel),
    leftWidthPx: clamp(Number(raw.leftWidthPx) || DEFAULT_SHELL_LAYOUT.leftWidthPx, MIN_PANEL_PX, MAX_PANEL_PX),
    rightWidthPx: clamp(Number(raw.rightWidthPx) || DEFAULT_SHELL_LAYOUT.rightWidthPx, MIN_PANEL_PX, MAX_PANEL_PX),
    commandHeightPx: clamp(
      Number(raw.commandHeightPx) || DEFAULT_SHELL_LAYOUT.commandHeightPx,
      MIN_COMMAND_PX,
      MAX_COMMAND_PX,
    ),
    toolspaceTab: tab(raw.toolspaceTab),
    ribbonCollapsed: raw.ribbonCollapsed === true,
    lineweightDisplay: raw.lineweightDisplay === true,
  };
};

export const loadShellLayout = (storage: Pick<Storage, 'getItem'> | null): CadShellLayoutState => {
  try {
    const raw = storage?.getItem(CAD_SHELL_LAYOUT_STORAGE_KEY);
    if (!raw) return DEFAULT_SHELL_LAYOUT;
    return sanitizeLayout(JSON.parse(raw) as unknown);
  } catch {
    return DEFAULT_SHELL_LAYOUT;
  }
};

export const saveShellLayout = (
  storage: Pick<Storage, 'setItem' | 'removeItem'> | null,
  layout: CadShellLayoutState,
): void => {
  try {
    storage?.setItem(CAD_SHELL_LAYOUT_STORAGE_KEY, JSON.stringify(layout));
  } catch {
    // Workspace chrome persistence is best-effort; the drawing is unaffected.
  }
};

export interface CadShellLayoutController {
  layout: CadShellLayoutState;
  setSidePanel: (_side: 'left' | 'right', _panel: CadSidePanelId | null) => void;
  /** Move a panel to the other side (or close when target occupied by itself). */
  movePanel: (_panel: CadSidePanelId) => void;
  setSideWidth: (_side: 'left' | 'right', _widthPx: number) => void;
  setCommandHeight: (_heightPx: number) => void;
  setToolspaceTab: (_tab: CadToolspaceTab) => void;
  setRibbonCollapsed: (_collapsed: boolean) => void;
  setLineweightDisplay: (_enabled: boolean) => void;
  resetWorkspace: () => void;
  activeLayout: CadActiveLayout;
  setActiveLayout: (_layout: CadActiveLayout) => void;
}

/**
 * Phase 18B — shell chrome persistence. localStorage only; Reset Workspace
 * restores dock defaults and never touches the drawing.
 */
export const useCadShellLayout = (): CadShellLayoutController => {
  const [layout, setLayout] = useState<CadShellLayoutState>(() =>
    typeof window === 'undefined' ? DEFAULT_SHELL_LAYOUT : loadShellLayout(window.localStorage),
  );
  // Active Model/sheet layout is per-session view state (real draft.sheets
  // only); the dock geometry above is the persisted part.
  const [activeLayout, setActiveLayout] = useState<CadActiveLayout>('MODEL');

  const update = useCallback((patch: Partial<CadShellLayoutState>) => {
    setLayout((current) => {
      const next = sanitizeLayout({ ...current, ...patch });
      if (typeof window !== 'undefined') saveShellLayout(window.localStorage, next);
      return next;
    });
  }, []);

  const setSidePanel = useCallback(
    (side: 'left' | 'right', panel: CadSidePanelId | null) => {
      update(side === 'left' ? { leftPanel: panel } : { rightPanel: panel });
    },
    [update],
  );

  const movePanel = useCallback((panel: CadSidePanelId) => {
    setLayout((current) => {
      // Move across docks; an occupied target swaps with the moved panel.
      const moved: CadShellLayoutState =
        current.leftPanel === panel
          ? sanitizeLayout({ ...current, leftPanel: current.rightPanel, rightPanel: panel })
          : sanitizeLayout({ ...current, rightPanel: current.leftPanel, leftPanel: panel });
      if (typeof window !== 'undefined') saveShellLayout(window.localStorage, moved);
      return moved;
    });
  }, []);

  const resetWorkspace = useCallback(() => {
    setLayout(DEFAULT_SHELL_LAYOUT);
    if (typeof window !== 'undefined') {
      try {
        window.localStorage.removeItem(CAD_SHELL_LAYOUT_STORAGE_KEY);
      } catch {
        // Best-effort; defaults already restored in state.
      }
    }
    setActiveLayout('MODEL');
  }, []);

  return {
    layout,
    setSidePanel,
    movePanel,
    setSideWidth: useCallback(
      (side, widthPx) => update(side === 'left' ? { leftWidthPx: widthPx } : { rightWidthPx: widthPx }),
      [update],
    ),
    setCommandHeight: useCallback((heightPx) => update({ commandHeightPx: heightPx }), [update]),
    setToolspaceTab: useCallback((tab) => update({ toolspaceTab: tab }), [update]),
    setRibbonCollapsed: useCallback((collapsed) => update({ ribbonCollapsed: collapsed }), [update]),
    setLineweightDisplay: useCallback((enabled) => update({ lineweightDisplay: enabled }), [update]),
    resetWorkspace,
    activeLayout,
    setActiveLayout,
  };
};
