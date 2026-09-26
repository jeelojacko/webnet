/**
 * Phase 19B — Page Setup (paper-space only).
 *
 * Pure helpers behind the Page Setup dialog. Mirrors `createPlanSheet`
 * orientation math (portrait basis registry → wide/narrow by orientation)
 * because cadSheets.ts is owned by the shell round; no math beyond mm.
 *
 * Rules honoured here:
 * - STANDARD_SHEET_SIZES_MM is the single size registry (no second list).
 * - Orientation swaps paper dimensions only; model/viewport/title geometry
 *   is never rotated or distorted.
 * - CUSTOM width/height live in mm; inch is display-only (25.4 helpers).
 * - Margins are a visual, non-plotting guide; nothing is auto-clipped.
 */
import {
  STANDARD_SHEET_SIZES_MM,
  type SheetOrientation,
  type StandardSheetSizeId,
} from './cadSheets';
import type { DraftSheet, DraftSheetMargins } from './cadDraftTypes';

export type SheetSizeId = StandardSheetSizeId;

export const SHEET_SIZE_IDS: readonly SheetSizeId[] = [
  ...(Object.keys(STANDARD_SHEET_SIZES_MM) as StandardSheetSizeId[]),
  'CUSTOM',
];

export const isSheetSizeId = (value: string): value is SheetSizeId =>
  (SHEET_SIZE_IDS as readonly string[]).includes(value);

export interface SheetPageSetup {
  name: string;
  sizeId: SheetSizeId;
  orientation: SheetOrientation;
  /** Custom basis in mm; ignored for standard sizes. */
  customWidthMm: number;
  customHeightMm: number;
  margins: DraftSheetMargins;
}

export interface SheetPageSetupWarning {
  code: 'PAPER_FIT';
  message: string;
  /** Viewport or sheet object that no longer fits. */
  objectId?: string;
}

const FIT_EPS_MM = 0.01;
const approx = (a: number, b: number): boolean => Math.abs(a - b) <= 0.5;

/** Resolve paper dimensions from the setup. Orientation is the only thing
 *  that swaps width/height; geometry is never touched. */
export const resolveSheetPaperMm = (setup: SheetPageSetup): { widthMm: number; heightMm: number } => {
  if (setup.sizeId === 'CUSTOM') {
    return {
      widthMm: setup.customWidthMm > 0 ? setup.customWidthMm : 210,
      heightMm: setup.customHeightMm > 0 ? setup.customHeightMm : 297,
    };
  }
  const base = STANDARD_SHEET_SIZES_MM[setup.sizeId];
  const wide = Math.max(base.widthMm, base.heightMm);
  const narrow = Math.min(base.widthMm, base.heightMm);
  return setup.orientation === 'portrait'
    ? { widthMm: narrow, heightMm: wide }
    : { widthMm: wide, heightMm: narrow };
};

/** Match a sheet's stored dimensions back to a standard size id (either
 *  orientation) or CUSTOM when nothing matches. Display-only inference. */
export const inferSheetSizeId = (sheet: Pick<DraftSheet, 'widthMm' | 'heightMm'>): SheetSizeId => {
  for (const [id, base] of Object.entries(STANDARD_SHEET_SIZES_MM) as [
    StandardSheetSizeId,
    { widthMm: number; heightMm: number },
  ][]) {
    const wide = Math.max(base.widthMm, base.heightMm);
    const narrow = Math.min(base.widthMm, base.heightMm);
    const matches =
      (approx(sheet.widthMm, wide) && approx(sheet.heightMm, narrow)) ||
      (approx(sheet.widthMm, narrow) && approx(sheet.heightMm, wide));
    if (matches) return id;
  }
  return 'CUSTOM';
};

export const sheetPageSetupFromSheet = (sheet: DraftSheet): SheetPageSetup => {
  const sizeId = inferSheetSizeId(sheet);
  return {
    name: sheet.name,
    sizeId,
    orientation: sheet.orientation,
    customWidthMm: sheet.widthMm,
    customHeightMm: sheet.heightMm,
    margins: { ...sheet.margins },
  };
};

/** Viewports/objects whose paper box no longer fits the page. Warning only —
 *  the caller warns and applies; nothing auto-clips or distorts. */
export const collectPageSetupFitWarnings = (sheet: DraftSheet): SheetPageSetupWarning[] => {
  const warnings: SheetPageSetupWarning[] = [];
  sheet.viewports.forEach((viewport) => {
    const fits =
      viewport.paperXmm >= -FIT_EPS_MM &&
      viewport.paperYmm >= -FIT_EPS_MM &&
      viewport.paperXmm + viewport.paperWidthMm <= sheet.widthMm + FIT_EPS_MM &&
      viewport.paperYmm + viewport.paperHeightMm <= sheet.heightMm + FIT_EPS_MM;
    if (!fits) {
      warnings.push({
        code: 'PAPER_FIT',
        objectId: viewport.id,
        message: `Viewport "${viewport.name}" extends beyond the ${sheet.widthMm}×${sheet.heightMm} mm page after resize; reposition or resize it (geometry is not distorted).`,
      });
    }
  });
  sheet.sheetObjects.forEach((object) => {
    const fits =
      object.paperXmm >= -FIT_EPS_MM &&
      object.paperYmm >= -FIT_EPS_MM &&
      object.paperXmm <= sheet.widthMm + FIT_EPS_MM &&
      object.paperYmm <= sheet.heightMm + FIT_EPS_MM;
    if (!fits) {
      warnings.push({
        code: 'PAPER_FIT',
        objectId: object.id,
        message: `Paper object "${object.kind}" sits outside the ${sheet.widthMm}×${sheet.heightMm} mm page after resize; reposition it.`,
      });
    }
  });
  return warnings;
};

/** Apply a setup to one sheet. Geometry (viewports, objects, title block) is
 *  never rotated or distorted on orientation change. */
export const applySheetPageSetup = (
  sheet: DraftSheet,
  setup: SheetPageSetup,
): { sheet: DraftSheet; warnings: SheetPageSetupWarning[] } => {
  const { widthMm, heightMm } = resolveSheetPaperMm(setup);
  const next: DraftSheet = {
    ...sheet,
    name: setup.name.trim() || sheet.name,
    orientation: setup.orientation,
    widthMm,
    heightMm,
    margins: { ...setup.margins },
  };
  return { sheet: next, warnings: collectPageSetupFitWarnings(next) };
};

export const applySheetPageSetupToDraft = (
  draft: import('./cadDraftTypes').DraftDocument,
  sheetId: string,
  setup: SheetPageSetup,
): { draft: import('./cadDraftTypes').DraftDocument; warnings: SheetPageSetupWarning[] } => {
  const sheet = draft.sheets.find((entry) => entry.id === sheetId);
  if (!sheet) return { draft, warnings: [] };
  const { sheet: next, warnings } = applySheetPageSetup(sheet, setup);
  return {
    draft: { ...draft, sheets: draft.sheets.map((entry) => (entry.id === sheetId ? next : entry)) },
    warnings,
  };
};
