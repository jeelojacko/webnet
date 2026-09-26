import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import SurveyCadWorkspace from '../../components/SurveyCadWorkspace';
import { SheetWorkspace } from '../../components/surveyCad/SheetWorkspace';
import type { CadAppController } from '../useCadAppController';
import {
  buildCadDrawingFileName,
  MAX_CAD_DRAWING_TEXT_BYTES,
  parseCadDrawingFile,
  serializeCadDrawingFile,
} from '../../engine/cad/cadDrawingFile';
import {
  assertBrowserFileSize,
  readBrowserFileAsText,
  saveBrowserTextFile,
} from '../../engine/browserFileIo';
import { createCadShellLink, useCadShellActionsVersion, useCadShellSnapshot, type CadShellLink } from './cadShellLink';
import { useCadShellLayout } from './useCadShellLayout';
import { CadMenuBar } from './CadMenuBar';
import { CadRibbon } from './CadRibbon';
import { CadDockPanel, CadPanelErrorBoundary } from './CadDockLayout';
import { CadToolspace } from './CadToolspace';
import { CadPropertiesPalette } from './CadPropertiesPalette';
import { CadLayerPalette } from './CadLayerPalette';
import { CadCommandDock } from './CadCommandDock';
import { CadStatusBar } from './CadStatusBar';
import { CadDrawingTabs, CadModelLayoutTabs } from './CadDrawingTabs';
import { PageSetupDialog } from '../../components/surveyCad/PageSetupDialog';
import { useDraftSheetHistory } from './useDraftSheetHistory';
import { gateActionsForSheetSpace } from './sheetSpaceGate';
import type { SheetActionKind, SheetCommitOptions } from '../../components/surveyCad/SheetWorkspace.types';
import {
  addSheetToDraft,
  createPlanSheet,
  deleteSheetFromDraft,
  duplicateSheetInDraft,
  renameSheetInDraft,
  reorderSheetsInDraft,
} from '../../engine/cad/cadSheets';
import type { DraftDocument } from '../../engine/cad/cadDraftTypes';
import { CadBlockManager } from '../blocks/CadBlockManager';
import { CadAnnotationManager } from '../annotation/CadAnnotationManager';
import { CadSurveyTablePanel } from './CadSurveyTablePanel';
import {
  executeShellCommand,
  resolveShellCommandText,
  type CadShellCommandDef,
} from './cadCommandRegistry';
import type { CadAnnotationManagerTab, CadSidePanelId } from './cadShellTypes';
import './cadShell.css';

interface CadApplicationShellProps {
  controller: CadAppController;
  onBackToAdjustment: () => void;
}

const SHEET_FILE_TYPES = [
  {
    description: 'WebNet CAD Drawing',
    accept: {
      'application/json': ['.wncad', '.json'],
    },
  },
];

const PANEL_TITLES: Record<CadSidePanelId, string> = {
  toolspace: 'Toolspace',
  properties: 'Properties',
  layers: 'Layers',
};

/**
 * Phase 18B — professional CAD shell. Menu + ribbon + tabs + docks +
 * command dock + status bar around SurveyCadWorkspace (kept as the
 * viewport + interaction surface; geometry engine, commands, snapping,
 * COGO, parcels, F2F, exports, and WNCAD I/O are untouched).
 *
 * MULTI-DOC RESTRICTION: one live workspace per mount (single history,
 * selection, and viewport in useSurveyCadWorkspace). The strip shows a
 * Start tab + the one live drawing tab addressed by drawing id; closing a
 * dirty drawing parks it on the Start tab (nothing destroyed) instead of a
 * Save/Don't Save/Cancel modal. A second live tab needs per-tab workspace
 * state — the 18C step.
 */
export const CadApplicationShell: React.FC<CadApplicationShellProps> = ({ controller, onBackToAdjustment }) => {
  const link: CadShellLink = useMemo(() => createCadShellLink(), []);
  const layout = useCadShellLayout();
  const snapshot = useCadShellSnapshot(link);
  // Phase 19B QA — re-read link.actions whenever the workspace
  // (un)registers it; assignment alone never re-renders chrome.
  const actionsVersion = useCadShellActionsVersion(link);
  const [showStart, setShowStart] = useState(false);
  const [blockManager, setBlockManager] = useState<{ tab: 'blocks' | 'symbols' | 'insert' } | null>(null);
  const [annotationManager, setAnnotationManager] = useState<{ tab?: CadAnnotationManagerTab } | null>(null);
  const [surveyTableManagerOpen, setSurveyTableManagerOpen] = useState(false);
  const [contextMenu, setContextMenu] = useState<{ x: number; y: number } | null>(null);
  const [paperStatus, setPaperStatus] = useState<string | null>(null);
  // Page Setup dialog owned by 19b-ui-D, mounted here on the tab seam.
  const [pageSetupSheetId, setPageSetupSheetId] = useState<string | null>(null);

  const {
    session,
    applyDrawingChange,
    applyLifecycleEvent,
    pendingSnapshot,
    latestRegistryEntry,
    handleImportPendingSource,
    requireCleanOrConfirm,
  } = controller;

  useEffect(() => {
    document.title = `${session.drawing.name}${session.dirty ? '*' : ''} — WebNet CAD`;
  }, [session.drawing.name, session.dirty]);

  const activeSheetId =
    layout.activeLayout === 'MODEL' ? null : (layout.activeLayout as { sheetId: string }).sheetId;
  const sheetActive = layout.activeSpace.kind === 'sheet';
  const liveDraft = session.drawing.draft;

  // Phase 19B §§83-84 — shell-owned draft/sheet history. Sheet-active
  // commits/Undo/Redo route here; model-active routes to model history.
  const publishDraft = useCallback((next: DraftDocument) => {
    applyDrawingChange((previous) => {
      if (!previous) return previous;
      return { ...previous, draft: next };
    });
  }, [applyDrawingChange]);
  const sheetHist = useDraftSheetHistory(liveDraft, publishDraft);
  const commitDraft = useCallback((next: DraftDocument, options?: SheetCommitOptions) => {
    sheetHist.commit(next, options);
  }, [sheetHist]);

  // Round 3F — the model-space DraftingPanel edits draft-only data through
  // the same shell-owned history, so model undo/redo survives and the edit
  // is undoable on sheet tabs.
  useEffect(() => {
    link.requestDraftCommit = (next) => commitDraft(next);
    return () => {
      link.requestDraftCommit = null;
    };
  }, [link, commitDraft]);

  // Undo routing: model space → model history, sheet space → sheet history.
  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent): void => {
      const target = event.target as HTMLElement | null;
      if (target && (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA' || target.tagName === 'SELECT' || target.isContentEditable)) return;
      if ((event.ctrlKey || event.metaKey) && !event.shiftKey && (event.key === 'z' || event.key === 'Z')) {
        if (layout.activeLayout === 'MODEL') link.actions?.undo();
        else sheetHist.undo();
        event.preventDefault();
      } else if ((event.ctrlKey || event.metaKey) && (event.key === 'y' || event.key === 'Y' || (event.shiftKey && (event.key === 'z' || event.key === 'Z')))) {
        if (layout.activeLayout === 'MODEL') link.actions?.redo();
        else sheetHist.redo();
        event.preventDefault();
      }
    };
    document.addEventListener('keydown', onKeyDown);
    return () => document.removeEventListener('keydown', onKeyDown);
  }, [link, layout.activeLayout, sheetHist]);

  // Phase 19B QA — sheet-space file ops. The model workspace (owner of
  // link.actions file handlers) is unmounted on layout tabs, so Save/Open
  // route here through the live session drawing (model + draft) instead of
  // a stale closure. Model-tab behavior is untouched.
  const sheetOpenInputRef = useRef<HTMLInputElement>(null);
  const handleSheetSave = useCallback(() => {
    const fileName = buildCadDrawingFileName(session.drawing.name);
    void saveBrowserTextFile(fileName, serializeCadDrawingFile(session.drawing), SHEET_FILE_TYPES).then((saved) => {
      if (saved) applyLifecycleEvent('cad-saved', fileName);
    });
  }, [session.drawing, applyLifecycleEvent]);
  const handleSheetOpenFile = useCallback(async (file: File | undefined) => {
    if (!file) return;
    try {
      assertBrowserFileSize(file, MAX_CAD_DRAWING_TEXT_BYTES, `${file.name} CAD drawing`);
      const parsed = parseCadDrawingFile(await readBrowserFileAsText(file));
      if (!parsed.ok) return;
      if (!requireCleanOrConfirm(`Replace the current drawing with ${file.name}`)) return;
      applyDrawingChange(() => parsed.drawing);
      applyLifecycleEvent('cad-opened', file.name);
    } catch {
      // Malformed/oversize files leave the session untouched.
    }
  }, [applyDrawingChange, applyLifecycleEvent, requireCleanOrConfirm]);

  // Chrome gating (§1.6): on sheet tabs the ribbon/menu/dock see no model
  // selection, no model commands, and sheet-routed undo/redo.
  const chromeSnapshot = useMemo(() => {
    if (!snapshot || !sheetActive) return snapshot;
    return { ...snapshot, canUndo: sheetHist.canUndo, canRedo: sheetHist.canRedo, selectionCount: 0, selectedEntityIds: [] as string[], selectionPreview: [], availableCommands: [] as string[] };
  }, [snapshot, sheetActive, sheetHist]);
  const chromeActions = useMemo(() => {
    if (!link.actions || !sheetActive) return link.actions;
    const gated = gateActionsForSheetSpace(link.actions, sheetHist.undo, sheetHist.redo);
    // File ops pass the gate but the model workspace that owns them is
    // unmounted on layout tabs: rebind to the session-backed handlers so
    // Save/Open keep working (covers the quick access + menu paths).
    return {
      ...gated,
      saveDrawing: () => void handleSheetSave(),
      openDrawingFile: () => sheetOpenInputRef.current?.click(),
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [link.actions, link, actionsVersion, sheetActive, sheetHist, handleSheetSave]);

  const handleAddSheet = useCallback(() => {
    const current = liveDraft;
    if (!current) return;
    const next = addSheetToDraft(current, createPlanSheet({ name: `Layout ${current.sheets.length + 1}` }));
    const created = next.sheets[next.sheets.length - 1];
    commitDraft(next);
    if (created) layout.setActiveLayout({ sheetId: created.id });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [liveDraft, commitDraft]);

  const handleSheetAction = useCallback((kind: SheetActionKind, sheetId: string) => {
    const current = liveDraft;
    if (!current) return;
    const sheet = current.sheets.find((entry) => entry.id === sheetId);
    if (!sheet) return;
    if (kind === 'page-setup') {
      layout.setActiveLayout({ sheetId });
      setPageSetupSheetId(sheetId);
      return;
    }
    if (kind === 'rename') {
      if (typeof window.prompt !== 'function') return;
      const name = window.prompt('Rename sheet', sheet.name);
      if (name != null && name.trim().length > 0) commitDraft(renameSheetInDraft(current, sheetId, name.trim()));
      return;
    }
    if (kind === 'duplicate') {
      const next = duplicateSheetInDraft(current, sheetId);
      const copy = next.sheets[next.sheets.length - 1];
      commitDraft(next);
      if (copy) layout.setActiveLayout({ sheetId: copy.id });
      return;
    }
    if (kind === 'delete') {
      const holdsContent = sheet.viewports.length > 0 || sheet.sheetObjects.length > 0 || sheet.titleBlockId != null;
      if (holdsContent) {
        if (typeof window.confirm !== 'function') return;
        if (!window.confirm(`Delete sheet "${sheet.name}" with its viewports, notes, and title block?`)) return;
      }
      commitDraft(deleteSheetFromDraft(current, sheetId));
      if (activeSheetId === sheetId) layout.setActiveLayout('MODEL');
      return;
    }
    const index = current.sheets.findIndex((entry) => entry.id === sheetId);
    const swapWith = kind === 'move-left' ? index - 1 : index + 1;
    if (index < 0 || swapWith < 0 || swapWith >= current.sheets.length) return;
    const order = current.sheets.map((entry) => entry.id);
    const moving = order[index] as string;
    order[index] = order[swapWith] as string;
    order[swapWith] = moving;
    commitDraft(reorderSheetsInDraft(current, order));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [liveDraft, commitDraft, activeSheetId]);  // Phase 18C — LAYER command / ribbon / manager focus path: reveal the
  // Layers dock (right side when hidden) then focus its filter input.
  useEffect(() => {
    link.requestLayerManager = () => {
      if (layout.layout.leftPanel !== 'layers' && layout.layout.rightPanel !== 'layers') {
        layout.setSidePanel('right', 'layers');
      }
      requestAnimationFrame(() => {
        document.querySelector<HTMLElement>('[data-cad-layers] input')?.focus();
      });
    };
    // Phase 18D — survey ribbon entry points focus the Toolspace Survey tab.
    link.requestToolspaceTab = (tab) => {
      if (layout.layout.leftPanel !== 'toolspace' && layout.layout.rightPanel !== 'toolspace') {
        layout.setSidePanel('left', 'toolspace');
      }
      layout.setToolspaceTab(tab);
    };
    // Phase 18N — registry BLOCK/INSERT/BLOCKS entries open the manager.
    link.requestBlockManager = (tab) => setBlockManager({ tab: tab ?? 'blocks' });
    // Phase 18O — annotation style commands open the Annotation Styles manager.
    link.requestAnnotationManager = (tab) => setAnnotationManager({ tab });
    // Phase 19A — survey table commands open the survey table manager.
    link.requestSurveyTableManager = () => setSurveyTableManagerOpen(true);
    return () => {
      link.requestLayerManager = null;
      link.requestToolspaceTab = null;
      link.requestBlockManager = null;
      link.requestAnnotationManager = null;
      link.requestSurveyTableManager = null;
    };
  }, [link, layout]);

  const activeSheet = activeSheetId
    ? (snapshot?.sheets.find((sheet) => sheet.id === activeSheetId) ?? null)
    : null;
  useEffect(() => {
    // A sheet deleted elsewhere falls back to Model (never a dead tab).
    if (activeSheetId && snapshot && !snapshot.sheets.some((sheet) => sheet.id === activeSheetId)) {
      layout.setActiveLayout('MODEL');
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [snapshot?.sheets.length, activeSheetId]);

  const handleCloseDrawing = (): void => {
    // Park on Start; the session drawing is retained, nothing destroyed.
    if (session.dirty && !requireCleanOrConfirm('Close the drawing view')) return;
    setShowStart(true);
  };

  const renderSidePanel = (panel: CadSidePanelId | null, side: 'left' | 'right'): React.ReactNode => {
    if (!panel) return null;
    const widthPx = side === 'left' ? layout.layout.leftWidthPx : layout.layout.rightWidthPx;
    return (
      <CadDockPanel
        panel={panel}
        title={PANEL_TITLES[panel]}
        side={side}
        widthPx={widthPx}
        onClose={() => layout.setSidePanel(side, null)}
        onMove={() => layout.movePanel(panel)}
        onResize={(next) => layout.setSideWidth(side, next)}
      >
        {panel === 'toolspace' ? (
          <CadToolspace
            snapshot={chromeSnapshot}
            actions={chromeActions}
            tab={layout.layout.toolspaceTab}
            onTabChange={layout.setToolspaceTab}
          />
        ) : null}
        {panel === 'properties' ? <CadPropertiesPalette snapshot={chromeSnapshot} actions={chromeActions} /> : null}
        {panel === 'layers' ? <CadLayerPalette snapshot={chromeSnapshot} actions={chromeActions} /> : null}
      </CadDockPanel>
    );
  };

  return (
    <div className="cad-shell" data-cad-shell>
      <div className="cad-shell-quickaccess" data-cad-quick-access>
        <span className="cad-shell-appname">WebNet CAD</span>
        <button type="button" onClick={onBackToAdjustment} title="Back to the adjustment app">
          Back to Adjustment
        </button>
        <button
          type="button"
          aria-label="New Drawing"
          title="New drawing"
          disabled={snapshot == null}
          onClick={() => link.actions?.newDrawing()}
        >
          New
        </button>
        <button
          type="button"
          aria-label="Open Drawing"
          title="Open a WNCAD file"
          disabled={snapshot == null}
          onClick={() => (sheetActive ? sheetOpenInputRef.current?.click() : link.actions?.openDrawingFile())}
        >
          Open
        </button>
        <button
          type="button"
          aria-label="Save Drawing"
          title="Save the drawing (WNCAD)"
          disabled={snapshot == null}
          onClick={() => (sheetActive ? void handleSheetSave() : link.actions?.saveDrawing())}
        >
          Save
        </button>
      </div>
      <CadMenuBar snapshot={chromeSnapshot} actions={chromeActions} layout={layout} onBackToAdjustment={onBackToAdjustment} />
      <CadRibbon
        snapshot={chromeSnapshot}
        actions={chromeActions}
        collapsed={layout.layout.ribbonCollapsed}
        onToggleCollapsed={() => layout.setRibbonCollapsed(!layout.layout.ribbonCollapsed)}
      />
      <CadDrawingTabs
        drawingName={session.drawing.name}
        dirty={session.dirty}
        onNewDrawing={() => {
          link.actions?.newDrawing();
          setShowStart(false);
        }}
        onCloseDrawing={handleCloseDrawing}
        startTab={showStart}
        onSelectStart={() => setShowStart(true)}
      />
      <div className="cad-shell-main">
        {renderSidePanel(layout.layout.leftPanel, 'left')}
        <div className="cad-shell-center">
          <div
            className="cad-shell-viewport"
            data-cad-viewport
            onContextMenu={(event) => {
              event.preventDefault();
              setContextMenu({ x: event.clientX, y: event.clientY });
            }}
          >
            {showStart ? (
              <StartTab
                drawingName={session.drawing.name}
                dirty={session.dirty}
                saveTargetName={session.saveTargetName}
                hasPendingSource={pendingSnapshot != null}
                onResume={() => setShowStart(false)}
                onNew={() => {
                  link.actions?.newDrawing();
                  setShowStart(false);
                }}
                onOpen={() => link.actions?.openDrawingFile()}
                onImport={handleImportPendingSource}
              />
            ) : layout.activeLayout === 'MODEL' || !activeSheet || !session.drawing.draft ? (
              <CadPanelErrorBoundary panelName="Viewport">
                <SurveyCadWorkspace
                  units={session.drawing.units}
                  result={null}
                  drawing={session.drawing}
                  onDrawingChange={applyDrawingChange}
                  onDrawingLifecycle={applyLifecycleEvent}
                  adjustmentSnapshot={pendingSnapshot}
                  resultDependencyIdentity={latestRegistryEntry?.appliedRunIdentity ?? null}
                  shellLink={link}
                  shellChrome
                  lineweightDisplay={layout.layout.lineweightDisplay ? 'scaled' : 'thin'}
                />
              </CadPanelErrorBoundary>
            ) : (
              <CadPanelErrorBoundary panelName="Sheet view">
                <SheetWorkspace
                  key={activeSheet.id}
                  project={session.drawing.project}
                  draft={session.drawing.draft}
                  activeSheetId={activeSheet.id}
                  initialView="SHEET"
                  projectName={session.drawing.name}
                  onDraftCommit={commitDraft}
                  onPaperStatusChange={setPaperStatus}
                />
              </CadPanelErrorBoundary>
            )}
            {contextMenu ? (
              sheetActive ? (
                <div role="menu" aria-label="Paper context menu" className="cad-shell-menu" style={{ left: contextMenu.x, top: contextMenu.y, position: 'fixed' }} data-cad-context-menu>
                  <button type="button" role="menuitem" className="cad-shell-menu-item" onClick={() => setContextMenu(null)}>
                    <span>Paper space — model commands unavailable here</span>
                  </button>
                </div>
              ) : (
              <ViewportContextMenu
                x={contextMenu.x}
                y={contextMenu.y}
                hasSelection={(snapshot?.selectionCount ?? 0) > 0}
                onClose={() => setContextMenu(null)}
                onPick={(text) => {
                  setContextMenu(null);
                  const def = resolveShellCommandText(text);
                  if (def) executeShellCommand(def, chromeActions);
                }}
                onAction={(name) => {
                  setContextMenu(null);
                  if (name === 'erase') chromeActions?.eraseSelection();
                  if (name === 'clear') chromeActions?.clearSelection();
                  if (name === 'select-all') chromeActions?.selectAll();
                }}
              />
              )
            ) : null}
          </div>
          <CadModelLayoutTabs snapshot={snapshot} activeLayout={layout.activeLayout} onSelect={layout.setActiveLayout} onAddSheet={liveDraft ? handleAddSheet : undefined} onSheetAction={liveDraft ? handleSheetAction : undefined} />
          <CadCommandDock
            link={link}
            snapshot={chromeSnapshot}
            actionsOverride={chromeActions}
            heightPx={layout.layout.commandHeightPx}
            onResize={layout.setCommandHeight}
          />
        </div>
        {renderSidePanel(layout.layout.rightPanel, 'right')}
      </div>
      <CadStatusBar
        link={link}
        snapshot={chromeSnapshot}
        dirty={session.dirty}
        activeLayout={layout.activeLayout}
        lineweightDisplay={layout.layout.lineweightDisplay}
        onToggleLineweightDisplay={layout.setLineweightDisplay}
        paperStatus={sheetActive ? paperStatus : null}
      />
      {blockManager && snapshot?.blocks ? (
        <CadBlockManager
          blocks={snapshot.blocks}
          selectedEntityIds={chromeSnapshot?.selectedEntityIds ?? []}
          initialTab={blockManager.tab}
          actions={{
            runBlockOp: (op) =>
              chromeActions?.runBlockOp?.(op) ?? { applied: false, reason: 'Block commands unavailable.' },
            ensureSymbols: () => chromeActions?.ensureBlockSymbols?.() ?? 0,
            selectEntities: (ids) => chromeActions?.selectEntities(ids),
            armInsertPick: (definitionId, scale, rotationDeg, repeat) => {
              chromeActions?.armInsertPick?.(definitionId, scale, rotationDeg, repeat);
              setBlockManager(null);
            },
            insertPickArmed: snapshot.blocks.insertPick != null
              ? { definitionId: snapshot.blocks.insertPick.definitionId }
              : null,
            cancelInsertPick: () => chromeActions?.cancelInsertPick?.(),
          }}
          onClose={() => setBlockManager(null)}
        />
      ) : null}
      {annotationManager && snapshot?.annotation ? (
        <CadAnnotationManager
          annotation={snapshot.annotation}
          initialTab={annotationManager.tab}
          runOp={(op) =>
            chromeActions?.runAnnotationOp?.(op) ?? {
              applied: false,
              reason: 'Annotation commands unavailable in this workspace.',
            }}
          onClose={() => setAnnotationManager(null)}
        />
      ) : null}
      {surveyTableManagerOpen ? (
        <div className="cad-survey-table-manager" data-cad-survey-table-manager>
          <button
            type="button"
            className="cad-shell-ribbon-tab"
            onClick={() => setSurveyTableManagerOpen(false)}
            data-cad-survey-table-manager-close
          >
            Close
          </button>
          <CadSurveyTablePanel snapshot={chromeSnapshot} actions={chromeActions} />
        </div>
      ) : null}
      <input
        ref={sheetOpenInputRef}
        type="file"
        accept=".wncad,.json,application/json"
        className="hidden"
        aria-hidden="true"
        tabIndex={-1}
        data-cad-shell-open-drawing-input
        onChange={(event) => {
          const file = event.target.files?.[0];
          event.target.value = '';
          void handleSheetOpenFile(file);
        }}
      />
      {pageSetupSheetId && liveDraft ? (
        <PageSetupDialog
          draft={liveDraft}
          sheetId={pageSetupSheetId}
          onDraftChange={(next) => commitDraft(next)}
          onClose={() => setPageSetupSheetId(null)}
        />
      ) : null}
    </div>
  );
};

const StartTab: React.FC<{
  drawingName: string;
  dirty: boolean;
  saveTargetName: string | null;
  hasPendingSource: boolean;
  onResume: () => void;
  onNew: () => void;
  onOpen: () => void;
  onImport: () => void;
}> = ({ drawingName, dirty, saveTargetName, hasPendingSource, onResume, onNew, onOpen, onImport }) => (
  <div className="cad-shell-start" data-cad-start-tab>
    <h2>Start</h2>
    <p className="cad-shell-empty">
      Current drawing: {drawingName}
      {dirty ? ' (unsaved changes)' : ''}
      {saveTargetName ? ` — ${saveTargetName}` : ''}
    </p>
    <div className="cad-shell-start-actions">
      <button type="button" onClick={onResume}>Resume drawing</button>
      <button type="button" onClick={onNew}>New drawing</button>
      <button type="button" onClick={onOpen}>Open drawing</button>
      {hasPendingSource ? <button type="button" onClick={onImport}>Import adjustment source</button> : null}
    </div>
  </div>
);

const ViewportContextMenu: React.FC<{
  x: number;
  y: number;
  hasSelection: boolean;
  onClose: () => void;
  onPick: (_text: string) => void;
  onAction: (_name: 'erase' | 'clear' | 'select-all') => void;
}> = ({ x, y, hasSelection, onClose, onPick, onAction }) => {
  useEffect(() => {
    const onPointerDown = (): void => onClose();
    const onKeyDown = (event: KeyboardEvent): void => {
      if (event.key === 'Escape') {
        event.stopPropagation();
        onClose();
      }
    };
    document.addEventListener('pointerdown', onPointerDown);
    document.addEventListener('keydown', onKeyDown, true);
    return () => {
      document.removeEventListener('pointerdown', onPointerDown);
      document.removeEventListener('keydown', onKeyDown, true);
    };
  }, [onClose]);
  const quick: CadShellCommandDef[] = ['LINE', 'PLINE', 'MOVE', 'COPY', 'TRIM', 'EXTEND']
    .map((key) => resolveShellCommandText(key))
    .filter((def): def is CadShellCommandDef => def != null);
  return (
    <div role="menu" aria-label="Viewport context menu" className="cad-shell-menu" style={{ left: x, top: y, position: 'fixed' }} data-cad-context-menu>
      {hasSelection ? (
        <>
          <button type="button" role="menuitem" className="cad-shell-menu-item" onClick={() => onAction('erase')}>
            <span>Erase selected</span>
          </button>
          <button type="button" role="menuitem" className="cad-shell-menu-item" onClick={() => onAction('clear')}>
            <span>Clear selection</span>
          </button>
          <div className="cad-shell-menu-sep" />
        </>
      ) : (
        <button type="button" role="menuitem" className="cad-shell-menu-item" onClick={() => onAction('select-all')}>
          <span>Select all</span>
        </button>
      )}
      {quick.map((def) => (
        <button
          key={def.key}
          type="button"
          role="menuitem"
          title={`${def.label} — ${def.hint}`}
          className="cad-shell-menu-item"
          onClick={() => onPick(def.key)}
        >
          <span>{def.label}</span>
        </button>
      ))}
    </div>
  );
};
