/**
 * Phase 19B — drawing-owned sheet-template CRUD (paper-space only).
 *
 * Templates are recipes. `createSheetFromTemplate` (cadSheets.ts) deep-copies
 * a recipe into a new sheet with fresh stable ids: later template edits never
 * affect sheets created earlier (snapshot semantics). Templates carry no
 * back-reference from sheets, so a template is always "unused" by contract;
 * deletion is a plain recipe removal.
 */
import { createStableRuntimeId } from '../id';
import type { DraftDocument, DraftSheet, DraftSheetTemplate } from './cadDraftTypes';

const templateId = (): string => createStableRuntimeId('draft-sheet-template');

export const blankSheetTemplate = (name: string): DraftSheetTemplate => ({
  id: templateId(),
  name,
  widthMm: 420,
  heightMm: 297,
  orientation: 'landscape',
  margins: { topMm: 10, bottomMm: 10, leftMm: 10, rightMm: 10 },
  viewportLayouts: [],
});

export const addSheetTemplate = (
  draft: DraftDocument,
  template: DraftSheetTemplate,
): DraftDocument => ({ ...draft, templates: [...(draft.templates ?? []), template] });

export const duplicateSheetTemplate = (
  draft: DraftDocument,
  sourceId: string,
): DraftDocument => {
  const source = (draft.templates ?? []).find((entry) => entry.id === sourceId);
  if (!source) return draft;
  const copy: DraftSheetTemplate = {
    ...source,
    id: templateId(),
    name: `${source.name} copy`,
    margins: { ...source.margins },
    viewportLayouts: source.viewportLayouts.map((layout) => ({ ...layout })),
    ...(source.northArrows ? { northArrows: source.northArrows.map((entry) => ({ ...entry })) } : {}),
    ...(source.scaleBars ? { scaleBars: source.scaleBars.map((entry) => ({ ...entry })) } : {}),
    ...(source.notes ? { notes: source.notes.map((entry) => ({ ...entry })) } : {}),
  };
  return { ...draft, templates: [...(draft.templates ?? []), copy] };
};

export const renameSheetTemplate = (
  draft: DraftDocument,
  templateIdValue: string,
  name: string,
): DraftDocument => ({
  ...draft,
  templates: (draft.templates ?? []).map((entry) =>
    entry.id === templateIdValue ? { ...entry, name } : entry,
  ),
});

export const deleteSheetTemplate = (draft: DraftDocument, templateIdValue: string): DraftDocument => ({
  ...draft,
  templates: (draft.templates ?? []).filter((entry) => entry.id !== templateIdValue),
});

/** Snapshot the current sheet layout into a reusable recipe. */
export const sheetTemplateFromSheet = (
  sheet: DraftSheet,
  name: string,
): DraftSheetTemplate => {
  const viewportIndex = new Map(sheet.viewports.map((viewport, index) => [viewport.id, index]));
  const viewportLayouts = sheet.viewports.map((viewport) => ({
    name: viewport.name,
    paperXmm: viewport.paperXmm,
    paperYmm: viewport.paperYmm,
    paperWidthMm: viewport.paperWidthMm,
    paperHeightMm: viewport.paperHeightMm,
    scaleDenominator: viewport.scaleDenominator,
  }));
  const northArrows = sheet.sheetObjects
    .filter((object) => object.kind === 'north-arrow' && viewportIndex.has(object.viewportId ?? ''))
    .map((object) => ({
      viewportIndex: viewportIndex.get(object.viewportId as string) as number,
      paperXmm: object.paperXmm,
      paperYmm: object.paperYmm,
      sizeMm: object.sizeMm ?? 12,
    }));
  const scaleBars = sheet.sheetObjects
    .filter((object) => object.kind === 'scale-bar' && viewportIndex.has(object.viewportId ?? ''))
    .map((object) => ({
      viewportIndex: viewportIndex.get(object.viewportId as string) as number,
      paperXmm: object.paperXmm,
      paperYmm: object.paperYmm,
      divisions: object.divisions ?? 4,
      modelPerDivision: object.modelPerDivision ?? 10,
    }));
  const notes = sheet.sheetObjects
    .filter((object) => object.kind === 'plan-note' && typeof object.text === 'string')
    .map((object) => ({ text: object.text as string, paperXmm: object.paperXmm, paperYmm: object.paperYmm }));
  return {
    id: templateId(),
    name,
    widthMm: sheet.widthMm,
    heightMm: sheet.heightMm,
    orientation: sheet.orientation,
    margins: { ...sheet.margins },
    viewportLayouts,
    ...(sheet.titleBlockId ? { titleBlockDefinitionId: sheet.titleBlockId } : {}),
    ...(northArrows.length > 0 ? { northArrows } : {}),
    ...(scaleBars.length > 0 ? { scaleBars } : {}),
    ...(notes.length > 0 ? { notes } : {}),
  };
};

export const addSheetTemplateFromSheet = (
  draft: DraftDocument,
  sheetId: string,
  name: string,
): DraftDocument => {
  const sheet = draft.sheets.find((entry) => entry.id === sheetId);
  if (!sheet) return draft;
  return addSheetTemplate(draft, sheetTemplateFromSheet(sheet, name));
};
