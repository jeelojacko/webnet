import React, { useEffect, useState } from 'react';
import type { CadActiveLayout } from './cadShellTypes';
import type { CadWorkspaceSnapshot } from './cadShellTypes';
import type { SheetActionKind } from '../../components/surveyCad/SheetWorkspace.types';

interface CadDrawingTabsProps {
  drawingName: string;
  dirty: boolean;
  onNewDrawing: () => void;
  onCloseDrawing: () => void;
  startTab: boolean;
  onSelectStart: () => void;
}

/**
 * Phase 18B — document tabs. MULTI-DOC DECISION (documented, not blocked):
 * 18B ships ONE live drawing tab + a Start tab (Recent/New/Open/Import
 * staged from the controller). True multi-document needs per-tab workspace
 * history/selection/viewport (useSurveyCadWorkspace is single-history per
 * mount); tabs already address drawings by id so a tab list can attach
 * later without changing this strip. Dirty tabs carry an asterisk;
 * close parks the drawing on the Start tab (nothing destroyed); when dirty
 * the caller runs a confirm-discard guard first (see handleCloseDrawing in
 * CadApplicationShell via requireCleanOrConfirm) — there is no 3-way
 * Save/Don't Save/Cancel modal.
 */
export const CadDrawingTabs: React.FC<CadDrawingTabsProps> = ({
  drawingName,
  dirty,
  onNewDrawing,
  onCloseDrawing,
  startTab,
  onSelectStart,
}) => (
  <div role="tablist" aria-label="Drawing tabs" className="cad-shell-filetabs" data-cad-drawing-tabs>
    <button
      type="button"
      role="tab"
      aria-selected={startTab}
      className={`cad-shell-tab${startTab ? ' active' : ''}`}
      onClick={onSelectStart}
      title="Start — recent, new, open, import"
    >
      Start
    </button>
    <button
      type="button"
      role="tab"
      aria-selected={!startTab}
      className={`cad-shell-tab${!startTab ? ' active' : ''}`}
      title={dirty ? `${drawingName} — unsaved changes` : drawingName}
    >
      {drawingName}
      {dirty ? '*' : ''}
    </button>
    <button type="button" title="New drawing" aria-label="Add drawing tab" onClick={onNewDrawing}>
      +
    </button>
    <button
      type="button"
      title="Close drawing (guarded when dirty)"
      aria-label="Close drawing"
      onClick={onCloseDrawing}
    >
      ×
    </button>
  </div>
);

interface CadModelLayoutTabsProps {
  snapshot: CadWorkspaceSnapshot | null;
  activeLayout: CadActiveLayout;
  onSelect: (_layout: CadActiveLayout) => void;
  /** Phase 19B — sheet CRUD + Page Setup seam (all optional; absent = tabs only). */
  onAddSheet?: () => void;
  onSheetAction?: (_kind: SheetActionKind, _sheetId: string) => void;
}

/** Phase 18B — Model + real paper layouts (draft.sheets only, never faked). */
export const CadModelLayoutTabs: React.FC<CadModelLayoutTabsProps> = ({ snapshot, activeLayout, onSelect, onAddSheet, onSheetAction }) => {
  const sheets = snapshot?.sheets ?? [];
  const [menu, setMenu] = useState<{ sheetId: string; x: number; y: number } | null>(null);
  useEffect(() => {
    if (!menu) return;
    // Phase 19B QA: a bare pointerdown closer unmounts the menu before the
    // item's click handler runs (document bubble hits first), so menu-item
    // clicks never dispatch. Pointerdowns inside the menu must not close it.
    const close = (event: PointerEvent): void => {
      if (event.target instanceof Element && event.target.closest('[data-cad-sheet-menu]')) return;
      setMenu(null);
    };
    document.addEventListener('pointerdown', close);
    return () => document.removeEventListener('pointerdown', close);
  }, [menu]);
  const actions: Array<{ kind: SheetActionKind; label: string }> = [
    { kind: 'rename', label: 'Rename' },
    { kind: 'duplicate', label: 'Duplicate' },
    { kind: 'delete', label: 'Delete' },
    { kind: 'move-left', label: 'Move Left' },
    { kind: 'move-right', label: 'Move Right' },
    { kind: 'page-setup', label: 'Page Setup…' },
  ];
  return (
    <div role="tablist" aria-label="Model and layout tabs" className="cad-shell-layouttabs" data-cad-layout-tabs>
      <button
        type="button"
        role="tab"
        aria-selected={activeLayout === 'MODEL'}
        className={`cad-shell-tab${activeLayout === 'MODEL' ? ' active' : ''}`}
        onClick={() => onSelect('MODEL')}
        title="Model space"
      >
        Model
      </button>
      {sheets.map((sheet) => {
        const selected = typeof activeLayout !== 'string' && activeLayout.sheetId === sheet.id;
        return (
          <button
            key={sheet.id}
            type="button"
            role="tab"
            aria-selected={selected}
            className={`cad-shell-tab${selected ? ' active' : ''}`}
            onClick={() => onSelect({ sheetId: sheet.id })}
            onContextMenu={onSheetAction ? (event) => {
              event.preventDefault();
              onSelect({ sheetId: sheet.id });
              setMenu({ sheetId: sheet.id, x: event.clientX, y: event.clientY });
            } : undefined}
            title={`Paper layout — ${sheet.name}` + (onSheetAction ? ' (right-click for Rename/Duplicate/Delete/Move/Page Setup)' : '')}
          >
            {sheet.name}
          </button>
        );
      })}
      {onAddSheet && (
        <button type="button" title="New layout sheet" aria-label="Add layout sheet" onClick={onAddSheet}>
          +
        </button>
      )}
      {menu && onSheetAction ? (
        <div role="menu" aria-label="Sheet actions" className="cad-shell-menu" style={{ left: menu.x, top: menu.y, position: 'fixed' }} data-cad-sheet-menu>
          {actions.map((action) => (
            <button
              key={action.kind}
              type="button"
              role="menuitem"
              className="cad-shell-menu-item"
              onClick={() => {
                setMenu(null);
                onSheetAction(action.kind, menu.sheetId);
              }}
            >
              <span>{action.label}</span>
            </button>
          ))}
        </div>
      ) : null}
    </div>
  );
};
