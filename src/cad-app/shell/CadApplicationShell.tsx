import React, { useEffect, useMemo, useState } from 'react';
import SurveyCadWorkspace from '../../components/SurveyCadWorkspace';
import { SheetWorkspace } from '../../components/surveyCad/SheetWorkspace';
import type { CadAppController } from '../useCadAppController';
import { createCadShellLink, useCadShellSnapshot, type CadShellLink } from './cadShellLink';
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
import { CadBlockManager } from '../blocks/CadBlockManager';
import { CadAnnotationManager } from '../annotation/CadAnnotationManager';
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
  const [showStart, setShowStart] = useState(false);
  const [blockManager, setBlockManager] = useState<{ tab: 'blocks' | 'symbols' | 'insert' } | null>(null);
  const [annotationManager, setAnnotationManager] = useState<{ tab?: CadAnnotationManagerTab } | null>(null);
  const [contextMenu, setContextMenu] = useState<{ x: number; y: number } | null>(null);

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
    layout.activeLayout === 'MODEL' ? null : (layout.activeLayout as { sheetId: string }).sheetId;  // Phase 18C — LAYER command / ribbon / manager focus path: reveal the
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
    return () => {
      link.requestLayerManager = null;
      link.requestToolspaceTab = null;
      link.requestBlockManager = null;
      link.requestAnnotationManager = null;
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
            snapshot={snapshot}
            actions={link.actions}
            tab={layout.layout.toolspaceTab}
            onTabChange={layout.setToolspaceTab}
          />
        ) : null}
        {panel === 'properties' ? <CadPropertiesPalette snapshot={snapshot} actions={link.actions} /> : null}
        {panel === 'layers' ? <CadLayerPalette snapshot={snapshot} actions={link.actions} /> : null}
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
          onClick={() => link.actions?.openDrawingFile()}
        >
          Open
        </button>
        <button
          type="button"
          aria-label="Save Drawing"
          title="Save the drawing (WNCAD)"
          disabled={snapshot == null}
          onClick={() => link.actions?.saveDrawing()}
        >
          Save
        </button>
      </div>
      <CadMenuBar snapshot={snapshot} actions={link.actions} layout={layout} onBackToAdjustment={onBackToAdjustment} />
      <CadRibbon
        snapshot={snapshot}
        actions={link.actions}
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
                />
              </CadPanelErrorBoundary>
            )}
            {contextMenu ? (
              <ViewportContextMenu
                x={contextMenu.x}
                y={contextMenu.y}
                hasSelection={(snapshot?.selectionCount ?? 0) > 0}
                onClose={() => setContextMenu(null)}
                onPick={(text) => {
                  setContextMenu(null);
                  const def = resolveShellCommandText(text);
                  if (def) executeShellCommand(def, link.actions);
                }}
                onAction={(name) => {
                  setContextMenu(null);
                  if (name === 'erase') link.actions?.eraseSelection();
                  if (name === 'clear') link.actions?.clearSelection();
                  if (name === 'select-all') link.actions?.selectAll();
                }}
              />
            ) : null}
          </div>
          <CadModelLayoutTabs snapshot={snapshot} activeLayout={layout.activeLayout} onSelect={layout.setActiveLayout} />
          <CadCommandDock
            link={link}
            snapshot={snapshot}
            heightPx={layout.layout.commandHeightPx}
            onResize={layout.setCommandHeight}
          />
        </div>
        {renderSidePanel(layout.layout.rightPanel, 'right')}
      </div>
      <CadStatusBar
        link={link}
        snapshot={snapshot}
        dirty={session.dirty}
        activeLayout={layout.activeLayout}
        lineweightDisplay={layout.layout.lineweightDisplay}
        onToggleLineweightDisplay={layout.setLineweightDisplay}
      />
      {blockManager && snapshot?.blocks ? (
        <CadBlockManager
          blocks={snapshot.blocks}
          selectedEntityIds={snapshot.selectedEntityIds}
          initialTab={blockManager.tab}
          actions={{
            runBlockOp: (op) =>
              link.actions?.runBlockOp?.(op) ?? { applied: false, reason: 'Block commands unavailable.' },
            ensureSymbols: () => link.actions?.ensureBlockSymbols?.() ?? 0,
            selectEntities: (ids) => link.actions?.selectEntities(ids),
            armInsertPick: (definitionId, scale, rotationDeg, repeat) => {
              link.actions?.armInsertPick?.(definitionId, scale, rotationDeg, repeat);
              setBlockManager(null);
            },
            insertPickArmed: snapshot.blocks.insertPick != null
              ? { definitionId: snapshot.blocks.insertPick.definitionId }
              : null,
            cancelInsertPick: () => link.actions?.cancelInsertPick?.(),
          }}
          onClose={() => setBlockManager(null)}
        />
      ) : null}
      {annotationManager && snapshot?.annotation ? (
        <CadAnnotationManager
          annotation={snapshot.annotation}
          initialTab={annotationManager.tab}
          runOp={(op) =>
            link.actions?.runAnnotationOp?.(op) ?? {
              applied: false,
              reason: 'Annotation commands unavailable in this workspace.',
            }}
          onClose={() => setAnnotationManager(null)}
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
