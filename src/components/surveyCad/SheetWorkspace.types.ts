import type { DraftDocument } from '../../engine/cad/cadDraftTypes';

/**
 * Phase 19B Round 2C — paper-space interaction model.
 *
 * Document Model/Layout vs document-tab distinction: the CAD document tabs
 * (Start + the one live drawing, CadDrawingTabs) address whole drawings.
 * Model/Layout tabs (CadModelLayoutTabs) address SPACES inside the live
 * drawing: exactly one model space plus one tab per real draft.sheets entry
 * in persisted array order (which is also the PDF/DXF page order). The
 * active space routes commands, selection, and undo — never the twain.
 */
export type ActiveSpace = { kind: 'model' } | { kind: 'sheet'; sheetId: string };

export const activeSpaceOf = (layout: 'MODEL' | { sheetId: string }): ActiveSpace =>
  layout === 'MODEL' ? { kind: 'model' } : { kind: 'sheet', sheetId: layout.sheetId };

/** Paper selection: viewports (frame), north-arrow / scale-bar / plan-note
 *  objects. Title block is anchored (rendered, never selectable). Selection
 *  is UI-only overlay state — it never enters the export scene. */
export type PaperSelection =
  | { kind: 'viewport'; viewportId: string }
  | { kind: 'paper-object'; objectId: string }
  | null;

/** Compact paper status for the shell status bar (§71). Never the paper
 *  zoom: the viewport field is the selected viewport scale denominator. */
export interface PaperStatus {
  sheetName: string;
  sheetIndex: number;
  viewportScaleDenominator: number | null;
  viewportLocked: boolean;
}

export const formatPaperStatus = (status: PaperStatus): string => {
  const layout = `Layout${status.sheetIndex + 1}`;
  if (status.viewportScaleDenominator == null) return layout;
  const locked = status.viewportLocked ? ' | Locked' : '';
  return `${layout} | Viewport: 1:${status.viewportScaleDenominator}${locked}`;
};

/** Controlled-draft commit: every layout mutation funnels through this so
 *  the shell can route exactly one draft-history transaction per commit.
 *  Pointer-drag ticks commit transiently (history coalesces them); the
 *  pointer-up commit lands as the single undoable transaction. */
export interface SheetCommitOptions { transient?: boolean }
export type SheetDraftCommit = (_next: DraftDocument, _options?: SheetCommitOptions) => void;

export type SheetActionKind =
  | 'rename'
  | 'duplicate'
  | 'delete'
  | 'move-left'
  | 'move-right'
  | 'page-setup';
