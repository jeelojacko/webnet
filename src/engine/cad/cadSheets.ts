import { createStableRuntimeId } from '../id';
import {
  cloneDraftDocument,
  createDraftSheet,
  type DraftDocument,
  type DraftSheet,
  type DraftSheetViewport,
} from './cadDraftTypes';

// Paper sizes in mm (portrait basis); orientation applied at creation.
export const STANDARD_SHEET_SIZES_MM = {
  Letter: { widthMm: 215.9, heightMm: 279.4 },
  Legal: { widthMm: 215.9, heightMm: 355.6 },
  Tabloid: { widthMm: 279.4, heightMm: 431.8 },
  'ARCH A': { widthMm: 228.6, heightMm: 304.8 },
  'ARCH B': { widthMm: 304.8, heightMm: 457.2 },
  'ARCH C': { widthMm: 457.2, heightMm: 609.6 },
  'ARCH D': { widthMm: 609.6, heightMm: 914.4 },
  'ISO A4': { widthMm: 210, heightMm: 297 },
  'ISO A3': { widthMm: 297, heightMm: 420 },
  'ISO A2': { widthMm: 420, heightMm: 594 },
  'ISO A1': { widthMm: 594, heightMm: 841 },
  'ISO A0': { widthMm: 841, heightMm: 1189 },
} as const;

export type StandardSheetSizeId = keyof typeof STANDARD_SHEET_SIZES_MM | 'CUSTOM';
export type SheetOrientation = 'portrait' | 'landscape';
export const STANDARD_VIEWPORT_SCALES = [100, 200, 250, 500, 1000] as const;

// Viewport extras are persisted fields on DraftSheetViewport (viewport-only;
// survey coordinates are never mutated). asPlanViewport backfills safe
// defaults for documents saved before the fields existed.
export type PlanViewport = DraftSheetViewport;

export const asPlanViewport = (viewport: DraftSheetViewport): PlanViewport => ({
  ...viewport,
  rotationDeg:
    typeof viewport.rotationDeg === 'number' && Number.isFinite(viewport.rotationDeg)
      ? viewport.rotationDeg
      : 0,
});

const findSheet = (draft: DraftDocument, sheetId: string): DraftSheet | undefined =>
  draft.sheets.find((sheet) => sheet.id === sheetId);

const updateSheet = (draft: DraftDocument, sheetId: string, next: DraftSheet): DraftDocument => ({
  ...draft,
  sheets: draft.sheets.map((sheet) => (sheet.id === sheetId ? next : sheet)),
});

const patchViewport = (sheet: DraftSheet, viewportId: string, patch: Partial<PlanViewport>): DraftSheet => ({
  ...sheet,
  viewports: sheet.viewports.map((entry) =>
    entry.id === viewportId ? { ...asPlanViewport(entry), ...patch } : entry,
  ),
});

const withSheet = (draft: DraftDocument, sheetId: string, next: (_sheet: DraftSheet) => DraftSheet): DraftDocument => {
  const sheet = findSheet(draft, sheetId);
  return sheet ? updateSheet(draft, sheetId, next(sheet)) : draft;
};

export const MM_PER_INCH = 25.4;
export const mmToInch = (mm: number): number => mm / MM_PER_INCH;
export const inchToMm = (inch: number): number => inch * MM_PER_INCH;

export const createPlanSheet = ({ name, sizeId = 'ISO A4', orientation = 'landscape', customWidthMm, customHeightMm }: {
  name: string; sizeId?: StandardSheetSizeId; orientation?: SheetOrientation; customWidthMm?: number; customHeightMm?: number;
}): DraftSheet => {
  const base = sizeId === 'CUSTOM'
    ? { widthMm: customWidthMm && customWidthMm > 0 ? customWidthMm : 210, heightMm: customHeightMm && customHeightMm > 0 ? customHeightMm : 297 }
    : STANDARD_SHEET_SIZES_MM[sizeId];
  const wide = Math.max(base.widthMm, base.heightMm);
  const narrow = Math.min(base.widthMm, base.heightMm);
  const portrait = orientation === 'portrait';
  return createDraftSheet({ name, widthMm: portrait ? narrow : wide, heightMm: portrait ? wide : narrow, orientation });
};

export const addSheetToDraft = (draft: DraftDocument, sheet: DraftSheet): DraftDocument => ({
  ...draft, sheets: [...draft.sheets, sheet],
});

export const renameSheetInDraft = (draft: DraftDocument, sheetId: string, name: string): DraftDocument =>
  withSheet(draft, sheetId, (sheet) => ({ ...sheet, name }));

export const duplicateSheetInDraft = (draft: DraftDocument, sheetId: string): DraftDocument => {
  const sheet = findSheet(draft, sheetId);
  if (!sheet) return draft;
  const copy: DraftSheet = {
    ...sheet, id: createStableRuntimeId('draft-sheet'), name: `${sheet.name} copy`, margins: { ...sheet.margins },
    viewports: sheet.viewports.map((viewport) => ({ ...viewport, id: createStableRuntimeId('draft-viewport') })),
    sheetObjects: sheet.sheetObjects.map((object) => ({ ...object, id: createStableRuntimeId('draft-sheet-object') })),
  };
  return { ...draft, sheets: [...draft.sheets, copy] };
};

export const deleteSheetFromDraft = (draft: DraftDocument, sheetId: string): DraftDocument => ({
  ...draft, sheets: draft.sheets.filter((sheet) => sheet.id !== sheetId),
});

// Multi-sheet order is the explicit array order; unknown ids are ignored and
// sheets missing from the order keep relative order at the end.
export const reorderSheetsInDraft = (draft: DraftDocument, orderIds: string[]): DraftDocument => {
  const rank = new Map(orderIds.map((id, index) => [id, index]));
  const key = (id: string): number => (rank.has(id) ? (rank.get(id) as number) : Number.MAX_SAFE_INTEGER);
  return { ...draft, sheets: [...draft.sheets].sort((a, b) => key(a.id) - key(b.id)) };
};

export const addViewportToSheet = (draft: DraftDocument, sheetId: string,
  viewport: Partial<DraftSheetViewport> & { modelCenterX: number; modelCenterY: number }): DraftDocument =>
  withSheet(draft, sheetId, (sheet) => ({
    ...sheet,
    viewports: [...sheet.viewports, asPlanViewport({
      id: createStableRuntimeId('draft-viewport'), name: 'Viewport', scaleDenominator: 500,
      paperXmm: sheet.margins.leftMm, paperYmm: sheet.margins.topMm,
      paperWidthMm: Math.max(10, sheet.widthMm - sheet.margins.leftMm - sheet.margins.rightMm),
      paperHeightMm: Math.max(10, sheet.heightMm - sheet.margins.topMm - sheet.margins.bottomMm),
      rotationDeg: 0,
      ...viewport,
    } as DraftSheetViewport)],
  }));

// Viewport-only transforms below: model-space coordinates are never touched.
export const moveViewportCenter = (draft: DraftDocument, sheetId: string, viewportId: string, center: { x: number; y: number }): DraftDocument =>
  withSheet(draft, sheetId, (sheet) => patchViewport(sheet, viewportId, { modelCenterX: center.x, modelCenterY: center.y }));

export const setViewportScale = (draft: DraftDocument, sheetId: string, viewportId: string, scaleDenominator: number): DraftDocument | undefined => {
  if (!Number.isFinite(scaleDenominator) || scaleDenominator <= 0) return undefined;
  const sheet = findSheet(draft, sheetId);
  return sheet ? updateSheet(draft, sheetId, patchViewport(sheet, viewportId, { scaleDenominator })) : draft;
};

export const rotateViewport = (draft: DraftDocument, sheetId: string, viewportId: string, rotationDeg: number): DraftDocument | undefined => {
  if (!Number.isFinite(rotationDeg)) return undefined;
  const sheet = findSheet(draft, sheetId);
  return sheet ? updateSheet(draft, sheetId, patchViewport(sheet, viewportId, { rotationDeg })) : draft;
};

export const setViewportClip = (draft: DraftDocument, sheetId: string, viewportId: string,
  clip: { xMm: number; yMm: number; widthMm: number; heightMm: number }): DraftDocument =>
  withSheet(draft, sheetId, (sheet) => patchViewport(sheet, viewportId,
    { clipXmm: clip.xMm, clipYmm: clip.yMm, clipWidthMm: clip.widthMm, clipHeightMm: clip.heightMm }));

export const setViewportLayerOverride = (draft: DraftDocument, sheetId: string, viewportId: string,
  layerId: string, override: { visible?: boolean } | undefined): DraftDocument =>
  withSheet(draft, sheetId, (sheet) => {
    const current = asPlanViewport(sheet.viewports.find((entry) => entry.id === viewportId) ?? {
      id: viewportId, name: 'Viewport', modelCenterX: 0, modelCenterY: 0, scaleDenominator: 500,
      paperXmm: 0, paperYmm: 0, paperWidthMm: 10, paperHeightMm: 10, rotationDeg: 0,
    });
    const layerOverrides = { ...(current.layerOverrides ?? {}) };
    if (override === undefined) delete layerOverrides[layerId];
    else layerOverrides[layerId] = override;
    return patchViewport(sheet, viewportId, { layerOverrides });
  });

// Scale math at the paper boundary only; model units untouched.
// Model meters to paper mm: paperMm = modelM * 1000 / scaleDenominator.
export const modelToPaperMm = (modelMeters: number, scaleDenominator: number): number =>
  (modelMeters * 1000) / scaleDenominator;

export const paperMmToModel = (paperMm: number, scaleDenominator: number): number =>
  (paperMm * scaleDenominator) / 1000;

// Fit-to-page suggests a scale; the caller records the actual denominator used.
export const suggestViewportScale = ({ modelWidthM, modelHeightM, paperWidthMm, paperHeightMm }: {
  modelWidthM: number; modelHeightM: number; paperWidthMm: number; paperHeightMm: number;
}): number | undefined => {
  if (modelWidthM <= 0 || modelHeightM <= 0 || paperWidthMm <= 0 || paperHeightMm <= 0) return undefined;
  return Math.max((modelWidthM * 1000) / paperWidthMm, (modelHeightM * 1000) / paperHeightMm);
};

// North arrow: grid-north only, rotation-aware. Never true/geodetic north.
// Convention: viewport rotation θ turns model content clockwise by θ as seen
// on the sheet (SVG rotate(θ) direction), so grid north — up at θ=0 — points
// θ-clockwise-from-up and the arrow angle is +θ normalised to 0–360°.
// Export scene, SVG, PDF, and sheet preview all share this convention.
export const NORTH_REFERENCE = 'grid' as const;
export const northArrowAngleDeg = (viewportRotationDeg: number): number =>
  ((viewportRotationDeg % 360) + 360) % 360;

// Scale bar linked to viewport scale.
export interface ScaleBarSegment { index: number; paperLengthMm: number; modelLengthM: number; }

export const buildScaleBar = ({ scaleDenominator, divisions = 4, modelPerDivisionM = 10 }: {
  scaleDenominator: number; divisions?: number; modelPerDivisionM?: number;
}): ScaleBarSegment[] =>
  Array.from({ length: divisions }, (_, index) => ({
    index, modelLengthM: modelPerDivisionM, paperLengthMm: modelToPaperMm(modelPerDivisionM, scaleDenominator),
  }));

// Title-block tokens (bounded set; unknown tokens stay literal + warn).
// Definition-vs-instance semantics: a DraftTitleBlockDefinition is the
// reusable template (geometry + token placeholders, stable id); a
// TitleBlockInstance binds one sheet to one definition with per-sheet field
// values. Editing a definition changes every sheet using it; editing an
// instance changes only that sheet.
export const SHEET_TOKENS = ['PROJECT_NAME', 'PROJECT_NUMBER', 'SHEET_NAME', 'SHEET_NUMBER', 'SCALE', 'CRS', 'DATE', 'DRAWN_BY', 'CHECKED_BY', 'CLIENT', 'LOCATION'] as const;
export type SheetTokenId = (typeof SHEET_TOKENS)[number];
export type SheetTokenContext = Partial<Record<SheetTokenId, string>>;

export const expandSheetTokens = (template: string, context: SheetTokenContext): { text: string; unknownTokens: string[] } => {
  const unknownTokens: string[] = [];
  const text = template.replace(/\{([A-Z_]+)\}/g, (match, name: string) => {
    if (!(SHEET_TOKENS as readonly string[]).includes(name)) {
      if (!unknownTokens.includes(name)) unknownTokens.push(name);
      return match;
    }
    return context[name as SheetTokenId] ?? match;
  });
  return { text, unknownTokens };
};

export interface TitleBlockInstance { id: string; sheetId: string; definitionId: string; values: Record<string, string>; }

export const createTitleBlockInstance = ({ sheetId, definitionId, values = {} }: {
  sheetId: string; definitionId: string; values?: Record<string, string>;
}): TitleBlockInstance => ({ id: createStableRuntimeId('draft-title-block-instance'), sheetId, definitionId, values: { ...values } });

export const setTitleBlockField = (instance: TitleBlockInstance, field: string, value: string): TitleBlockInstance => ({
  ...instance, values: { ...instance.values, [field]: value },
});

// Shared token context so preview, SVG, PDF, and layout-DXF expand the same
// text from the same paper-mm numerics. SCALE lists viewport scales.
export const buildSheetTokenContext = (args: {
  sheet: { name: string; viewports: readonly { scaleDenominator: number }[] };
  sheetNumber: number;
  projectName?: string;
  projectNumber?: string;
  crs?: string;
  date?: string;
  drawnBy?: string;
  checkedBy?: string;
  client?: string;
  location?: string;
}): SheetTokenContext => ({
  PROJECT_NAME: args.projectName ?? '',
  PROJECT_NUMBER: args.projectNumber ?? '',
  SHEET_NAME: args.sheet.name,
  SHEET_NUMBER: `${args.sheetNumber}`,
  SCALE: args.sheet.viewports.map((viewport) => `1:${viewport.scaleDenominator}`).join(', '),
  CRS: args.crs ?? '',
  DATE: args.date ?? new Date().toISOString().slice(0, 10),
  DRAWN_BY: args.drawnBy ?? '',
  CHECKED_BY: args.checkedBy ?? '',
  CLIENT: args.client ?? '',
  LOCATION: args.location ?? '',
});

// Template management (pure; run inside runDraftSheetCommand for undo/redo).
export const createTitleBlockTemplate = (name: string): import('./cadDraftTypes').DraftTitleBlockDefinition => ({
  id: createStableRuntimeId('draft-title-block'),
  name,
  fieldNames: [],
  elements: [],
});

export const duplicateTitleBlockTemplate = (
  draft: DraftDocument,
  definitionId: string,
): DraftDocument => {
  const source = draft.titleBlockDefinitions.find((entry) => entry.id === definitionId);
  if (!source) return draft;
  return {
    ...draft,
    titleBlockDefinitions: [
      ...draft.titleBlockDefinitions,
      {
        ...source,
        id: createStableRuntimeId('draft-title-block'),
        name: `${source.name} copy`,
        fieldNames: [...source.fieldNames],
        ...(source.elements ? { elements: source.elements.map((element) => ({ ...element, id: createStableRuntimeId('draft-title-block-element') })) } : {}),
      },
    ],
  };
};

export const renameTitleBlockTemplate = (draft: DraftDocument, definitionId: string, name: string): DraftDocument => ({
  ...draft,
  titleBlockDefinitions: draft.titleBlockDefinitions.map((entry) =>
    entry.id === definitionId ? { ...entry, name } : entry,
  ),
});

export const editTitleBlockTemplateElements = (
  draft: DraftDocument,
  definitionId: string,
  elements: import('./cadDraftTypes').DraftTitleBlockElement[],
): DraftDocument => ({
  ...draft,
  titleBlockDefinitions: draft.titleBlockDefinitions.map((entry) =>
    entry.id === definitionId ? { ...entry, elements: elements.map((element) => ({ ...element })) } : entry,
  ),
});

// Fails closed: a template in use by any sheet is kept and reported.
export const deleteTitleBlockTemplateIfUnused = (
  draft: DraftDocument,
  definitionId: string,
): { draft: DraftDocument; deleted: boolean } => {
  const inUse = draft.sheets.some((sheet) => sheet.titleBlockId === definitionId);
  if (inUse) return { draft, deleted: false };
  return {
    draft: {
      ...draft,
      titleBlockDefinitions: draft.titleBlockDefinitions.filter((entry) => entry.id !== definitionId),
    },
    deleted: true,
  };
};

export const assignTitleBlockToSheet = (draft: DraftDocument, sheetId: string, definitionId: string | undefined): DraftDocument => ({
  ...draft,
  sheets: draft.sheets.map((sheet) =>
    sheet.id === sheetId ? { ...sheet, ...(definitionId ? { titleBlockId: definitionId } : { titleBlockId: undefined }) } : sheet,
  ),
});

// Plan notes: multiline paper-space text objects.
export const addPlanNote = (draft: DraftDocument, sheetId: string,
  note: { layerId: string; paperXmm: number; paperYmm: number; text: string }): DraftDocument =>
  withSheet(draft, sheetId, (sheet) => ({
    ...sheet, sheetObjects: [...sheet.sheetObjects, { id: createStableRuntimeId('draft-sheet-object'), kind: 'plan-note', ...note }],
  }));

export const editPlanNoteText = (draft: DraftDocument, sheetId: string, objectId: string, text: string): DraftDocument =>
  withSheet(draft, sheetId, (sheet) => ({
    ...sheet, sheetObjects: sheet.sheetObjects.map((object) => (object.id === objectId ? { ...object, text } : object)),
  }));

// Draft-only history: snapshots of the draft document. Never touches
// adjustment results or model-space entities.
export interface DraftSheetHistoryState { draft: DraftDocument; past: DraftDocument[]; future: DraftDocument[]; }

export const createDraftSheetHistory = (draft: DraftDocument): DraftSheetHistoryState => ({ draft, past: [], future: [] });

export const runDraftSheetCommand = (state: DraftSheetHistoryState, apply: (_draft: DraftDocument) => DraftDocument): DraftSheetHistoryState => ({
  draft: apply(state.draft), past: [...state.past, cloneDraftDocument(state.draft)], future: [],
});

export const undoDraftSheetHistory = (state: DraftSheetHistoryState): DraftSheetHistoryState => {
  const previous = state.past[state.past.length - 1];
  if (!previous) return state;
  return { draft: previous, past: state.past.slice(0, -1), future: [cloneDraftDocument(state.draft), ...state.future] };
};

export const redoDraftSheetHistory = (state: DraftSheetHistoryState): DraftSheetHistoryState => {
  const [next, ...rest] = state.future;
  if (!next) return state;
  return { draft: next, past: [...state.past, cloneDraftDocument(state.draft)], future: rest };
};
