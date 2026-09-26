// Phase 19B Round 2C — canonical paper-object builders.
//
// Home for the screen/export-neutral paper builders: grid-north arrows,
// scale bars, viewport paper symbols, and title-block items. Extracted
// verbatim from cadExportScene.ts (no behavior change); cadExportScene.ts
// re-exports this module so existing scene/parity/DXF callers keep working.
// deriveSheetScene itself stays in cadExportScene.ts — it orchestrates the
// model-projection and label/table builders that live there.
import { BROKEN_REFERENCE_TEXT } from './cadLabelEngine';
import type {
  DraftSheet,
  DraftSheetObject,
  DraftTitleBlockDefinition,
} from './cadDraftTypes';
import type { SheetTokenContext } from './cadSheets';
import { expandSheetTokens, northArrowAngleDeg } from './cadSheets';
import type { ExportItem, ExportWarning } from './cadExportScene';

// The arrow triangle rotates clockwise by rotationDeg about its base point so
// it agrees with rotated viewport geometry; the scale bar is pure paper
// geometry (no model coordinates), hence rotation-invariant by construction.
// The viewport clip stays an axis-aligned paper rect under rotation — content
// outside it is clipped, never reprojected.
export const buildNorthArrowItems = (xMm: number, yMm: number, sizeMm: number, layer: string, rotationDeg = 0): ExportItem[] => {
  const tip = { x: xMm, y: yMm - sizeMm };
  const right = { x: xMm + sizeMm * 0.3, y: yMm };
  const tail = { x: xMm, y: yMm + sizeMm * 0.25 };
  const left = { x: xMm - sizeMm * 0.3, y: yMm };
  const rotate = (point: { x: number; y: number }): { x: number; y: number } => {
    if (rotationDeg === 0) return point;
    const a = (rotationDeg * Math.PI) / 180;
    const dx = point.x - xMm;
    const dy = point.y - yMm;
    return { x: xMm + dx * Math.cos(a) - dy * Math.sin(a), y: yMm + dx * Math.sin(a) + dy * Math.cos(a) };
  };
  return [
    { kind: 'polyline', layer, points: [rotate(tip), rotate(right), rotate(tail), rotate(left)], close: true },
    { kind: 'text', layer, x: xMm, y: yMm - sizeMm - 1.5, text: 'N (grid)', heightMm: 2.5, anchor: 'middle' },
  ];
};

export const buildScaleBarItems = (
  xMm: number,
  yMm: number,
  divisions: number,
  divisionMm: number,
  layer: string,
): ExportItem[] =>
  Array.from({ length: divisions }, (_, i) => ({
    kind: 'rect' as const,
    layer,
    x: xMm + i * divisionMm,
    y: yMm,
    width: divisionMm,
    height: 2,
    fill: i % 2 === 0 ? '#000000' : '#ffffff',
  }));

// ---------------------------------------------------------------------------
// Phase 19B §§47-54,60-62: canonical paper objects.
//
// North arrows and scale bars are explicit persisted sheet objects
// (`kind: 'north-arrow' | 'scale-bar'`) that link back to a viewport. The
// builders below are the ONE geometry source consumed by the sheet scene
// (→ SVG/PDF), the R2000 layout DXF, and the sheet UI.
// ---------------------------------------------------------------------------

export interface SheetPaperObjectFields {
  viewportId?: string;
  sizeMm?: number;
  rotationOffsetDeg?: number;
  divisions?: number;
  modelPerDivision?: number;
  showScaleText?: boolean;
  styleId?: string;
}

export interface DerivedScaleBar {
  objectId: string;
  viewportId: string;
  divisions: number;
  /** Drawing-unit length of one division (m or ft). */
  modelPerDivision: number;
  unitLabel: 'm' | 'ft';
  divisionPaperMm: number;
  totalPaperMm: number;
  showScaleText: boolean;
}

/** Screen/export-neutral viewport descriptor; no functions, no resolved model geometry. */
export interface DerivedViewportScene {
  viewportId: string;
  name: string;
  paperXmm: number;
  paperYmm: number;
  paperWidthMm: number;
  paperHeightMm: number;
  modelCenterX: number;
  modelCenterY: number;
  scaleDenominator: number;
  rotationDeg: number;
  /** §21 locked: presentation lock only; the transform is unchanged. */
  locked: boolean;
  /** §60 effective frame emission (absent legacy value keeps the historical frame). */
  plotFrame: boolean;
  /** §47-50 grid-north arrow angle in degrees 0-360, including the object offset. */
  northArrowAngleDeg: number;
  hasNorthArrow: boolean;
  /** §51-54 canonical scale bar for this viewport, when one is placed. */
  scaleBar?: DerivedScaleBar;
}

// Drawing-unit paper length: modelPerDivision is in the drawing's own units
// (metres or feet), never assumed metres, so a ft drawing divides by its
// foot length before the scale denominator.
const MM_PER_DRAWING_UNIT: Record<'m' | 'ft', number> = { m: 1000, ft: 304.8 };

const normalizedAngle = (deg: number): number => ((deg % 360) + 360) % 360;

export { normalizedAngle };

const paperObjectFields = (object: DraftSheetObject): SheetPaperObjectFields =>
  object as unknown as SheetPaperObjectFields;

/** A north/scale object is canonical only when it names a viewport; a bare
 *  legacy object with no link is left to the legacy sheet-object path. */
export const linkedPaperObjectViewportId = (object: DraftSheetObject): string | undefined => {
  if (object.kind !== 'north-arrow' && object.kind !== 'scale-bar') return undefined;
  const id = paperObjectFields(object).viewportId;
  return typeof id === 'string' && id.length > 0 ? id : undefined;
};

/** §47-50: grid-north arrow for an explicit paper object. */
export const buildNorthArrowObjectItems = (
  object: DraftSheetObject,
  viewportRotationDeg: number,
  layer?: string,
): ExportItem[] => {
  const fields = paperObjectFields(object);
  const angle = normalizedAngle(northArrowAngleDeg(viewportRotationDeg) + (fields.rotationOffsetDeg ?? 0));
  return buildNorthArrowItems(object.paperXmm, object.paperYmm, fields.sizeMm ?? 8, layer ?? object.layerId, angle);
};

/** §51-54: unit-aware scale bar for an explicit paper object. */
export const buildScaleBarObjectItems = (
  object: DraftSheetObject,
  viewport: { scaleDenominator: number },
  unitsMode: 'm' | 'ft',
  layer?: string,
): { items: ExportItem[]; derived: DerivedScaleBar } => {
  const fields = paperObjectFields(object);
  const layerId = layer ?? object.layerId;
  const divisions = Math.max(1, Math.floor(fields.divisions ?? 4));
  const modelPerDivision = fields.modelPerDivision ?? 10;
  const unitLabel: 'm' | 'ft' = unitsMode === 'ft' ? 'ft' : 'm';
  const divisionPaperMm = (modelPerDivision * MM_PER_DRAWING_UNIT[unitLabel]) / viewport.scaleDenominator;
  const totalPaperMm = divisionPaperMm * divisions;
  const items = buildScaleBarItems(object.paperXmm, object.paperYmm, divisions, divisionPaperMm, layerId);
  const showScaleText = fields.showScaleText !== false;
  if (showScaleText) {
    items.push({
      kind: 'text',
      layer: layerId,
      x: object.paperXmm + totalPaperMm + 2,
      y: object.paperYmm + 1.5,
      text: `${modelPerDivision} ${unitLabel} @ 1:${viewport.scaleDenominator}`,
      heightMm: 3,
      anchor: 'start',
    });
  }
  return {
    items,
    derived: {
      objectId: object.id,
      viewportId: paperObjectFields(object).viewportId ?? '',
      divisions,
      modelPerDivision,
      unitLabel,
      divisionPaperMm,
      totalPaperMm,
      showScaleText,
    },
  };
};

/** Visible BROKEN_REFERENCE placeholder: the broken link is never rebound. */
const brokenPaperObjectItem = (object: DraftSheetObject, layer?: string): ExportItem => ({
  kind: 'text',
  layer: layer ?? object.layerId,
  x: object.paperXmm,
  y: object.paperYmm,
  text: BROKEN_REFERENCE_TEXT,
  heightMm: 3,
  anchor: 'middle',
});

export interface ViewportPaperSymbols {
  itemsByViewport: Map<string, ExportItem[]>;
  /** Broken-ref placeholders (no viewport to attach to). */
  brokenItems: ExportItem[];
  northArrowAngleByViewport: Map<string, number>;
  scaleBarByViewport: Map<string, DerivedScaleBar>;
  /** Objects the canonical path owns; legacy paths must not re-handle them. */
  consumedObjectIds: string[];
  warnings: ExportWarning[];
}

/** Canonical paper symbols grouped by linked viewport, in deterministic id order. */
export const buildViewportPaperSymbols = (args: {
  sheet: DraftSheet;
  unitsMode: 'm' | 'ft';
  /** Drawing layer catalog + NO-PLOT; viewport overrides never apply here. */
  isHidden: (_layerId: string) => boolean;
}): ViewportPaperSymbols => {
  const viewportById = new Map(args.sheet.viewports.map((viewport) => [viewport.id, viewport]));
  const itemsByViewport = new Map<string, ExportItem[]>();
  const brokenItems: ExportItem[] = [];
  const northArrowAngleByViewport = new Map<string, number>();
  const scaleBarByViewport = new Map<string, DerivedScaleBar>();
  const consumedObjectIds: string[] = [];
  const warnings: ExportWarning[] = [];
  const ordered = [...args.sheet.sheetObjects].sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
  ordered.forEach((object) => {
    const viewportId = linkedPaperObjectViewportId(object);
    if (viewportId == null) return;
    consumedObjectIds.push(object.id);
    if (args.isHidden(object.layerId)) return;
    const viewport = viewportById.get(viewportId);
    if (!viewport) {
      warnings.push({
        code: 'BROKEN_REFERENCE',
        message: `paper object ${object.id} references missing viewport ${viewportId}`,
        entityId: object.id,
      });
      brokenItems.push(brokenPaperObjectItem(object));
      return;
    }
    if (object.kind === 'north-arrow') {
      const angle = normalizedAngle(
        northArrowAngleDeg(viewport.rotationDeg) + (paperObjectFields(object).rotationOffsetDeg ?? 0),
      );
      northArrowAngleByViewport.set(viewportId, angle);
      const list = itemsByViewport.get(viewportId) ?? [];
      list.push(...buildNorthArrowObjectItems(object, viewport.rotationDeg));
      itemsByViewport.set(viewportId, list);
      return;
    }
    const { items, derived } = buildScaleBarObjectItems(object, viewport, args.unitsMode);
    scaleBarByViewport.set(viewportId, derived);
    const list = itemsByViewport.get(viewportId) ?? [];
    list.push(...items);
    itemsByViewport.set(viewportId, list);
  });
  return { itemsByViewport, brokenItems, northArrowAngleByViewport, scaleBarByViewport, consumedObjectIds, warnings };
};

// One renderer for preview, SVG, PDF, and layout-DXF: identical paper-mm
// numerics everywhere. When the sheet references a visual template, its
// elements render verbatim; otherwise the legacy bar renders.
export const buildTitleBlockItems = (
  sheet: DraftSheet,
  layer: string,
  template?: DraftTitleBlockDefinition,
  tokenContext?: SheetTokenContext,
): { items: ExportItem[]; unknownTokens: string[] } => {
  const items: ExportItem[] = [];
  const unknownTokens: string[] = [];
  const noteUnknown = (names: readonly string[]): void => {
    names.forEach((token) => {
      if (!unknownTokens.includes(token)) unknownTokens.push(token);
    });
  };
  if (template?.elements && template.elements.length > 0) {
    const ordered = [...template.elements].sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
    ordered.forEach((element) => {
      if (element.kind === 'rect') {
        items.push({
          kind: 'rect', layer,
          x: element.xMm, y: element.yMm,
          width: Math.max(0.1, element.widthMm ?? 10),
          height: Math.max(0.1, element.heightMm ?? 5),
        });
        return;
      }
      if (element.kind === 'line') {
        items.push({
          kind: 'line', layer,
          x1: element.xMm, y1: element.yMm,
          x2: element.x2Mm ?? element.xMm, y2: element.y2Mm ?? element.yMm,
          ...(element.lineweightMm != null ? { widthMm: element.lineweightMm } : {}),
        });
        return;
      }
      const raw = element.kind === 'token-text' ? (element.tokenTemplate ?? element.text ?? '') : (element.text ?? '');
      const { text, unknownTokens: unknown } = expandSheetTokens(raw, tokenContext ?? {});
      noteUnknown(unknown);
      items.push({
        kind: 'text', layer,
        x: element.xMm, y: element.yMm, text,
        heightMm: Math.max(0.5, element.fontSizeMm ?? 3),
        anchor: element.alignment === 'center' ? 'middle' : element.alignment === 'right' ? 'end' : 'start',
      });
    });
    const notes = [...sheet.sheetObjects].sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
    notes.forEach((object) => {
      if (typeof object.text !== 'string') return;
      const { text, unknownTokens: unknown } = expandSheetTokens(object.text, tokenContext ?? {});
      noteUnknown(unknown);
      items.push({
        kind: 'text', layer: object.layerId,
        x: object.paperXmm, y: object.paperYmm, text,
        heightMm: 3, anchor: 'start',
        ...(object.rotationDeg ? { rotationDeg: object.rotationDeg } : {}),
      });
    });
    return { items, unknownTokens };
  }
  const barH = 14;
  const y = sheet.heightMm - sheet.margins.bottomMm - barH;
  items.push({ kind: 'rect', layer, x: sheet.margins.leftMm, y, width: sheet.widthMm - sheet.margins.leftMm - sheet.margins.rightMm, height: barH });
  const fields = [sheet.name, `${sheet.widthMm}x${sheet.heightMm}mm`];
  sheet.sheetObjects.forEach((object) => {
    if (typeof object.text !== 'string') return;
    const { text, unknownTokens: unknown } = expandSheetTokens(object.text, { SHEET_NAME: sheet.name });
    unknown.forEach((token) => {
      if (!unknownTokens.includes(token)) unknownTokens.push(token);
    });
    items.push({ kind: 'text', layer: object.layerId, x: object.paperXmm, y: object.paperYmm, text, heightMm: 3 });
  });
  fields.forEach((field, index) => {
    items.push({
      kind: 'text',
      layer,
      x: sheet.margins.leftMm + 2 + index * 60,
      y: y + barH / 2 + 1,
      text: field,
      heightMm: 3,
    });
  });
  return { items, unknownTokens };
};
