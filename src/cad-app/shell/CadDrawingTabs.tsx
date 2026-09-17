import React from 'react';
import type { CadActiveLayout } from './cadShellTypes';
import type { CadWorkspaceSnapshot } from './cadShellTypes';

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
}

/** Phase 18B — Model + real paper layouts (draft.sheets only, never faked). */
export const CadModelLayoutTabs: React.FC<CadModelLayoutTabsProps> = ({ snapshot, activeLayout, onSelect }) => {
  const sheets = snapshot?.sheets ?? [];
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
            title={`Paper layout — ${sheet.name}`}
          >
            {sheet.name}
          </button>
        );
      })}
    </div>
  );
};
