/**
 * Phase 19B — paper-object / viewport edit helpers (paper-space only).
 *
 * cadSheets.ts (shell-owned) exposes scale/rotation/center/clip/layer-override
 * setters but not the full property surface the Sheet Properties panel and
 * the paper-object dialogs need. These are thin, pure, deterministic
 * mutations on DraftDocument: no model coordinates are ever touched.
 */
import { createStableRuntimeId } from '../id';
import { asPlanViewport, northArrowAngleDeg, scaleBarTotalPaperMm } from './cadSheets';
import type {
  DraftDocument,
  DraftSheet,
  DraftSheetObject,
  DraftSheetViewport,
} from './cadDraftTypes';

const patchSheet = (
  draft: DraftDocument,
  sheetId: string,
  next: (_sheet: DraftSheet) => DraftSheet,
): DraftDocument => ({
  ...draft,
  sheets: draft.sheets.map((sheet) => (sheet.id === sheetId ? next(sheet) : sheet)),
});

export const findSheetViewport = (
  sheet: DraftSheet,
  viewportId: string,
): DraftSheetViewport | undefined => sheet.viewports.find((viewport) => viewport.id === viewportId);

export const findSheetObject = (
  sheet: DraftSheet,
  objectId: string,
): DraftSheetObject | undefined => sheet.sheetObjects.find((object) => object.id === objectId);

/** Generic viewport patch (name, paper box, lock, plot frame, clip, ...). */
export const updateSheetViewport = (
  draft: DraftDocument,
  sheetId: string,
  viewportId: string,
  patch: Partial<DraftSheetViewport>,
): DraftDocument =>
  patchSheet(draft, sheetId, (sheet) => ({
    ...sheet,
    viewports: sheet.viewports.map((viewport) =>
      viewport.id === viewportId ? { ...asPlanViewport(viewport), ...patch } : viewport,
    ),
  }));

export const updateSheetObject = (
  draft: DraftDocument,
  sheetId: string,
  objectId: string,
  patch: Partial<DraftSheetObject>,
): DraftDocument =>
  patchSheet(draft, sheetId, (sheet) => ({
    ...sheet,
    sheetObjects: sheet.sheetObjects.map((object) =>
      object.id === objectId ? { ...object, ...patch } : object,
    ),
  }));

export const removeSheetObject = (
  draft: DraftDocument,
  sheetId: string,
  objectId: string,
): DraftDocument =>
  patchSheet(draft, sheetId, (sheet) => ({
    ...sheet,
    sheetObjects: sheet.sheetObjects.filter((object) => object.id !== objectId),
  }));

export const addSheetObject = (
  draft: DraftDocument,
  sheetId: string,
  object: Omit<DraftSheetObject, 'id'> & { id?: string },
): DraftDocument =>
  patchSheet(draft, sheetId, (sheet) => ({
    ...sheet,
    sheetObjects: [
      ...sheet.sheetObjects,
      { ...object, id: object.id ?? createStableRuntimeId('draft-sheet-object') } as DraftSheetObject,
    ],
  }));

/** North arrow seeded inset from a viewport's top-right corner. */
export const defaultNorthArrowObject = (viewport: DraftSheetViewport): DraftSheetObject => ({
  id: createStableRuntimeId('draft-sheet-object'),
  kind: 'north-arrow',
  layerId: 'labels',
  paperXmm: viewport.paperXmm + Math.max(0, viewport.paperWidthMm - 14),
  paperYmm: viewport.paperYmm + 6,
  sizeMm: 12,
  viewportId: viewport.id,
  rotationOffsetDeg: 0,
});

/** Scale bar seeded along a viewport's bottom-left corner. */
export const defaultScaleBarObject = (viewport: DraftSheetViewport): DraftSheetObject => ({
  id: createStableRuntimeId('draft-sheet-object'),
  kind: 'scale-bar',
  layerId: 'labels',
  paperXmm: viewport.paperXmm + 8,
  paperYmm: viewport.paperYmm + Math.max(0, viewport.paperHeightMm - 8),
  divisions: 4,
  modelPerDivision: 10,
  showScaleText: true,
  viewportId: viewport.id,
});

export const defaultPlanNoteObject = (viewport?: DraftSheetViewport): DraftSheetObject => ({
  id: createStableRuntimeId('draft-sheet-object'),
  kind: 'plan-note',
  layerId: 'labels',
  paperXmm: viewport ? viewport.paperXmm + 8 : 15,
  paperYmm: viewport ? viewport.paperYmm + 20 : 20,
  text: 'Note',
  rotationDeg: 0,
});

/** Grid-north arrow angle for an object: viewport rotation + extra offset,
 *  normalised 0–360°. Never true/geodetic north. */
export const resolvedNorthArrowAngleDeg = (
  viewportRotationDeg: number,
  rotationOffsetDeg = 0,
): number => {
  const angle = northArrowAngleDeg(viewportRotationDeg) + rotationOffsetDeg;
  return ((angle % 360) + 360) % 360;
};

/** Resolved scale-bar length in paper mm (read-only display value). */
export const resolvedScaleBarTotalMm = (
  viewport: DraftSheetViewport,
  object: Pick<DraftSheetObject, 'divisions' | 'modelPerDivision'>,
  unitsMode: 'm' | 'ft',
): number =>
  scaleBarTotalPaperMm({
    divisions: object.divisions ?? 4,
    modelPerDivision: object.modelPerDivision ?? 10,
    scaleDenominator: viewport.scaleDenominator,
    unitsMode,
  });
