import { buildSheetTokenContext } from '../cadSheets';
import type { DraftDocument } from '../cadDraftTypes';
import type { CadProject } from '../cadTypes';
import {
  buildPaperLabelItems,
  buildTitleBlockItems,
  draftLabelsToPlacements,
  modelToPaperPoint,
  type ExportItem,
  type ModelLabelPlacement,
} from '../cadExportScene';
import { buildDxfExportModelWithResult, type BuildDxfModelArgs, type DxfExportModel } from './dxfExportModel';
import {
  DXF_LINETYPE_CATALOG,
  dxfLinetypeName,
  isKnownDxfLinetype,
  lineweightMmToDxf370,
  nearestAci,
  trueColorDxf420,
} from './dxfColorMap';
import { resolveEffectiveColor } from '../resolveEffectiveColor';
import { buildTableFragmentItems } from '../cadExportTables';
import { serializeDxfModelWithResult } from './dxfSerializer';
import { finalizeExportResult, type ExportResult, type ExportWarning } from '../exportResult';

// Dual DXF contract (Phase 13C §§6-10):
// - buildDxfModelSpaceText: R12 (AC1009) model-space-only survey export.
//   Byte-identical to serializeDxfModel(buildDxfExportModel(...)); paper
//   deliverables never leak into it. The WithResult variant merges model +
//   serializer warnings (unknown-linetype fallback, R12 lineweights) with
//   the model dispositions while producing byte-identical payload text.
// - buildDxfLayoutText (below): R2000 (AC1015) multi-layout export. Model
//   space keeps exact survey coordinates (meters, never rebased); each
//   DraftSheet becomes a named paper-space LAYOUT with VIEWPORT entities,
//   title block (BLOCK+INSERT), and paper annotations in mm. The WithResult
//   variant additionally surfaces the model warnings/dispositions.
// Paper space uses bottom-left origin: yDxf = sheetHeightMm - ySceneMm.

export const buildDxfModelSpaceTextWithResult = (args: BuildDxfModelArgs): ExportResult<string> => {
  const modelResult = buildDxfExportModelWithResult(args);
  const serialized = serializeDxfModelWithResult(modelResult.output);
  return finalizeExportResult({
    output: serialized.output,
    warnings: [...modelResult.warnings, ...serialized.warnings],
    errors: [],
    exportedEntityIds: [...modelResult.exportedEntityIds],
    omittedEntityIds: [...modelResult.omittedEntityIds],
    approximatedEntityIds: [...modelResult.approximatedEntityIds],
  });
};

export const buildDxfModelSpaceText = (args: BuildDxfModelArgs): string =>
  buildDxfModelSpaceTextWithResult(args).output;

export interface BuildDxfLayoutArgs {
  project: CadProject;
  draft: DraftDocument;
  modelLabels?: ModelLabelPlacement[];
  /** Shared paper extras (north arrow, scale bar) in scene mm, top-left origin. */
  paperExtras?: ExportItem[];
}

export interface DxfLayoutWarning {
  code: 'UNKNOWN_TOKEN' | 'UNSUPPORTED_SHEET_OBJECT' | 'SKIPPED_PAPER_ITEM' | 'UNKNOWN_LINETYPE';
  message: string;
}

export interface DxfLayoutResult {
  dxf: string;
  warnings: DxfLayoutWarning[];
  layouts: string[];
}

const pair = (code: number | string, value: string): string => `${code}\n${value}`;

// Full precision (6dp trimmed): large grid coordinates (E≈2.4M/N≈7.4M)
// survive exactly; integers print without a decimal point.
const fmt = (value: number): string => {
  if (!Number.isFinite(value)) return '0';
  const rounded = Math.round(value * 1e6) / 1e6;
  return String(Object.is(rounded, -0) ? 0 : rounded);
};

  // DXF symbol names forbid <>/\":;?*|=`, comma, backtick, and control /
  // format characters. Uniqueness is case-insensitive.
export const sanitizeLayoutName = (name: string, taken: Set<string>): string => {
  let base = name.replace(/[<>/\\":;?*|=`,]/g, '_').replace(/[\p{Cc}\p{Cf}]/gu, '_').trim().slice(0, 255);
  if (base === '') base = 'Sheet';
  if (base.startsWith('*') || base.toLowerCase() === 'model') base = `${base}_1`;
  let out = base;
  let index = 2;
  while (taken.has(out.toLowerCase())) {
    out = `${base}_${index}`;
    index += 1;
  }
  taken.add(out.toLowerCase());
  return out;
};

// Single-line TEXT (group 1) cannot carry raw newlines; collapse them.
const cleanText = (text: string): string => text.replace(/\r\n|\r|\n/g, ' ');

const normDeg = (deg: number): number => ((deg % 360) + 360) % 360;

interface PaperContext {
  out: string[];
  owner: string;
  flipY: (_y: number) => number;
  layers: Set<string>;
  /** First-seen base hex per paper layer (layer-record color). */
  layerBase: Map<string, string>;
  paperColorOf: (_layer: string) => string;
  warnings: DxfLayoutWarning[];
  takeHandle: () => string;
}

// Same color treatment as model space: nearest-ACI 62 for compatibility
// plus 420 true color. Omitted only when the item matches its layer base.
const paperPaint = (ctx: PaperContext, layer: string, stroke: string | undefined): string[] => {
  const base = ctx.paperColorOf(layer);
  ctx.layers.add(layer);
  if (!ctx.layerBase.has(layer)) ctx.layerBase.set(layer, base);
  const eff = stroke ?? base;
  if (eff === base && stroke == null) return [];
  if (eff === base) return [];
  return [pair(62, String(nearestAci(eff))), pair(420, String(trueColorDxf420(eff)))];
}

// Annotation multiline paper text rides as one TEXT row per line (TEXT group 1
// cannot carry raw newlines); single-line items stay byte-identical.
const PAPER_TEXT_LINE_SPACING = 1.2;

const emitPaperTextRow = (
  ctx: PaperContext,
  layer: string,
  x: number,
  yScene: number,
  height: number,
  text: string,
  rotationSceneDeg = 0,
  stroke?: string,
): void => {
  const paint = paperPaint(ctx, layer, stroke);
  ctx.out.push(
    pair(0, 'TEXT'), pair(5, ctx.takeHandle()), pair(330, ctx.owner),
    pair(100, 'AcDbEntity'), pair(8, layer), ...paint,
    pair(100, 'AcDbText'),
    pair(10, fmt(x)), pair(20, fmt(ctx.flipY(yScene))), pair(30, '0'),
    pair(40, fmt(height)), pair(1, cleanText(text)), pair(7, 'Standard'),
  );
  // Scene rotation is clockwise-as-seen (SVG rotate direction); DXF group 50
  // is CCW in a y-up frame, so the same visual is the negated angle.
  if (normDeg(rotationSceneDeg) !== 0) ctx.out.push(pair(50, fmt(normDeg(-rotationSceneDeg))));
};

const emitPaperText = (
  ctx: PaperContext,
  layer: string,
  x: number,
  yScene: number,
  height: number,
  text: string,
  rotationSceneDeg = 0,
  stroke?: string,
): void => {
  const rows = text.split(/\r\n|\r|\n/);
  rows.forEach((line, index) => {
    emitPaperTextRow(ctx, layer, x, yScene + index * height * PAPER_TEXT_LINE_SPACING, height, line, rotationSceneDeg, stroke);
  });
};

const emitPaperPolyline = (ctx: PaperContext, layer: string, points: Array<{ x: number; y: number }>, closed: boolean, stroke?: string): void => {
  if (points.length === 0) return;
  const paint = paperPaint(ctx, layer, stroke);
  ctx.out.push(
    pair(0, 'LWPOLYLINE'), pair(5, ctx.takeHandle()), pair(330, ctx.owner),
    pair(100, 'AcDbEntity'), pair(8, layer), ...paint,
    pair(100, 'AcDbPolyline'),
    pair(90, String(points.length)), pair(70, closed ? '1' : '0'),
  );
  points.forEach((point) => {
    ctx.out.push(pair(10, fmt(point.x)), pair(20, fmt(ctx.flipY(point.y))));
  });
};

const emitPaperItem = (ctx: PaperContext, item: ExportItem): void => {
  switch (item.kind) {
    case 'line':
      ctx.out.push(
        pair(0, 'LINE'), pair(5, ctx.takeHandle()), pair(330, ctx.owner),
        pair(100, 'AcDbEntity'), pair(8, item.layer), ...paperPaint(ctx, item.layer, item.stroke),
        pair(100, 'AcDbLine'),
        pair(10, fmt(item.x1)), pair(20, fmt(ctx.flipY(item.y1))), pair(30, '0'),
        pair(11, fmt(item.x2)), pair(21, fmt(ctx.flipY(item.y2))), pair(31, '0'),
      );
      break;
    case 'polyline':
      emitPaperPolyline(ctx, item.layer, item.points, item.close, item.stroke);
      break;
    case 'rect':
      emitPaperPolyline(ctx, item.layer, [
        { x: item.x, y: item.y },
        { x: item.x + item.width, y: item.y },
        { x: item.x + item.width, y: item.y + item.height },
        { x: item.x, y: item.y + item.height },
      ], true, item.stroke);
      break;
    case 'circle':
      ctx.out.push(
        pair(0, 'CIRCLE'), pair(5, ctx.takeHandle()), pair(330, ctx.owner),
        pair(100, 'AcDbEntity'), pair(8, item.layer), ...paperPaint(ctx, item.layer, item.stroke),
        pair(100, 'AcDbCircle'),
        pair(10, fmt(item.cx)), pair(20, fmt(ctx.flipY(item.cy))), pair(30, '0'),
        pair(40, fmt(item.r)),
      );
      break;
    case 'ellipse': {
      if (!(item.rx > 0) || !(item.ry > 0)) {
        ctx.warnings.push({ code: 'SKIPPED_PAPER_ITEM', message: `ellipse with non-positive axis on layer ${item.layer}` });
        break;
      }
      const twist = ((-(item.rotationDeg ?? 0)) * Math.PI) / 180;
      const cx = item.cx;
      const cy = ctx.flipY(item.cy);
      ctx.out.push(
        pair(0, 'ELLIPSE'), pair(5, ctx.takeHandle()), pair(330, ctx.owner),
        pair(100, 'AcDbEntity'), pair(8, item.layer), ...paperPaint(ctx, item.layer, item.stroke),
        pair(100, 'AcDbEllipse'),
        pair(10, fmt(cx)), pair(20, fmt(cy)), pair(30, '0'),
        pair(11, fmt(item.rx * Math.cos(twist))), pair(21, fmt(item.rx * Math.sin(twist))), pair(31, '0'),
        pair(40, fmt(item.ry / item.rx)),
        pair(41, '0'), pair(42, fmt(2 * Math.PI)),
      );
      break;
    }
    case 'arc':
      ctx.out.push(
        pair(0, 'ARC'), pair(5, ctx.takeHandle()), pair(330, ctx.owner),
        pair(100, 'AcDbEntity'), pair(8, item.layer), ...paperPaint(ctx, item.layer, item.stroke),
        pair(100, 'AcDbArc'),
        pair(10, fmt(item.cx)), pair(20, fmt(ctx.flipY(item.cy))), pair(30, '0'),
        pair(40, fmt(item.r)),
        pair(50, fmt(normDeg(-item.endDeg))),
        pair(51, fmt(normDeg(-item.startDeg))),
      );
      break;
    case 'text':
      emitPaperText(ctx, item.layer, item.x, item.y, item.heightMm, item.text, item.rotationDeg ?? 0, item.stroke);
      break;
    default:
      break;
  }
};

const modelBounds = (model: DxfExportModel): { minX: number; minY: number; maxX: number; maxY: number } => {
  const xs: number[] = [];
  const ys: number[] = [];
  const push = (x: number, y: number): void => {
    if (Number.isFinite(x) && Number.isFinite(y)) {
      xs.push(x);
      ys.push(y);
    }
  };
  model.points.forEach((point) => push(point.at.x, point.at.y));
  model.lines.forEach((line) => {
    push(line.from.x, line.from.y);
    push(line.to.x, line.to.y);
  });
  model.polylines.forEach((polyline) => polyline.vertices.forEach((vertex) => push(vertex.x, vertex.y)));
  model.arcs.forEach((arc) => {
    push(arc.center.x - arc.radius, arc.center.y - arc.radius);
    push(arc.center.x + arc.radius, arc.center.y + arc.radius);
  });
  model.texts.forEach((entry) => push(entry.at.x, entry.at.y));
  (model.inserts ?? []).forEach((insert) => push(insert.at.x, insert.at.y));
  if (xs.length === 0) return { minX: 0, minY: 0, maxX: 1000, maxY: 1000 };
  return {
    minX: Math.min(...xs),
    minY: Math.min(...ys),
    maxX: Math.max(...xs),
    maxY: Math.max(...ys),
  };
};

export interface DxfLayoutContent {
  dxf: string;
  layouts: string[];
}

/** Paper-only warnings use layout codes; the WithResult variant maps them
 *  into the shared ExportWarning union (SKIPPED_PAPER_ITEM and
 *  UNKNOWN_LINETYPE ride as SKIPPED_ENTITY) preserving message text. */
const toExportWarnings = (warnings: DxfLayoutWarning[]): ExportWarning[] =>
  warnings.map((warning) => ({
    code: (warning.code === 'UNKNOWN_TOKEN' || warning.code === 'UNSUPPORTED_SHEET_OBJECT'
      ? warning.code
      : 'SKIPPED_ENTITY') as ExportWarning['code'],
    message: warning.message,
  }));

interface DxfLayoutInner extends DxfLayoutResult {
  modelResult: ExportResult<DxfExportModel>;
}

const buildDxfLayoutInner = (args: BuildDxfLayoutArgs): DxfLayoutInner => {
  const warnings: DxfLayoutWarning[] = [];
  let nextHandle = 0x20;
  const takeHandle = (): string => {
    const handle = nextHandle.toString(16).toUpperCase();
    nextHandle += 1;
    return handle;
  };

  const modelResult = buildDxfExportModelWithResult({ project: args.project, modelLabels: args.modelLabels });
  const model = modelResult.output;
  const paperLayers = new Set<string>();
  const takenNames = new Set<string>(['model']);
  const layoutNames = args.draft.sheets.map((sheet) => sanitizeLayoutName(sheet.name, takenNames));

  // Paper layer colors resolve through the shared resolver (project layer
  // first, then draft layer), matching the scene builder's inheritance.
  const paperLayerBase = new Map<string, string>();
  const paperColorOf = (layer: string): string =>
    resolveEffectiveColor({
      layer:
        args.project.layers.find((entry) => entry.id === layer)?.color ??
        args.draft.layers.find((entry) => entry.id === layer)?.color,
    });
  // Full LTYPE table for every referenced type: ByBlock/ByLayer plus each
  // model linetype. Unknown ids fall back to Continuous AND warn via
  // UNKNOWN_LINETYPE — never silently solidified.
  const usedLinetypeIds = [...(model.usedLinetypes ?? ['continuous'])].sort();
  usedLinetypeIds.forEach((id) => {
    if (!isKnownDxfLinetype(id)) {
      warnings.push({ code: 'UNKNOWN_LINETYPE', message: `linetype ${JSON.stringify(id)} falls back to Continuous` });
    }
  });
  const usedLinetypeNames = [...new Set(usedLinetypeIds.map((id) => dxfLinetypeName(id)))].sort();

  // Pre-assign structural handles (owners are referenced before definition).
  const vportTable = takeHandle();
  const vportActive = takeHandle();
  const ltypeTable = takeHandle();
  const ltypeByBlock = takeHandle();
  const ltypeByLayer = takeHandle();
  const ltypeHandles = new Map<string, string>(
    usedLinetypeNames.map((name) => [name, takeHandle()]),
  );
  const layerTable = takeHandle();
  const layerHandles = new Map<string, string>();
  layerHandles.set('0', takeHandle());
  [...model.layers].sort().forEach((layer) => {
    if (!layerHandles.has(layer)) layerHandles.set(layer, takeHandle());
  });
  const styleTable = takeHandle();
  const styleStandard = takeHandle();
  const appidTable = takeHandle();
  const appidAcad = takeHandle();
  const dimstyleTable = takeHandle();
  const dimstyleStandard = takeHandle();
  const blockRecordTable = takeHandle();
  const modelSpaceRecord = takeHandle();
  // First paper layout owns *Paper_Space; the rest take *Paper_Space0, 1, …
  const paperRecords = args.draft.sheets.map((_, index) =>
    ({ handle: takeHandle(), name: index === 0 ? '*Paper_Space' : `*Paper_Space${index - 1}` }));
  const titleRecords = layoutNames.map((name) => ({ handle: takeHandle(), name: `TB_${name}` }));
  // Phase 18N: one BLOCK_RECORD per native model-space block (R2000
  // model-space block table; handles stay deterministic — no-block
  // drawings take no handles here, so existing goldens are untouched).
  const modelBlockRecords = (model.blocks ?? []).map((block) => ({ handle: takeHandle(), name: block.name }));
  const rootDict = takeHandle();
  const layoutDict = takeHandle();
  const modelLayout = takeHandle();
  const sheetLayouts = args.draft.sheets.map(() => takeHandle());

  const blockBegin = new Map<string, string>();
  const blockEnd = new Map<string, string>();
  [...paperRecords, ...titleRecords, ...modelBlockRecords].forEach((record) => {
    blockBegin.set(record.handle, takeHandle());
    blockEnd.set(record.handle, takeHandle());
  });
  const modelBegin = takeHandle();
  const modelEnd = takeHandle();

  const out: string[] = [];
  const emitModelEntity = (codes: string[]): void => {
    out.push(...codes);
  };

  // Model-space entities: exact survey coordinates, full precision.
  // Color treatment matches R12 (nearest-ACI 62) plus 420 true color;
  // 370 lineweights ride where the model carries them; 6 linetype only
  // when the entity differs from its layer (BYLAYER by omission).
  // OFF layers ride as negative 62; frozen/locked ride in the layer-table
  // 70 bits; individually hidden entities ride as group 60 (invisible).
  const modelOwner = modelSpaceRecord;
  const invisible60 = (invisible: boolean | undefined): string[] =>
    invisible === true ? [pair(60, '1')] : [];
  const modelLayerHex = (layer: string): string => model.layerColors?.[layer] ?? '#ffffff';
  const modelLayerLinetype = (layer: string): string =>
    dxfLinetypeName(model.layerLinetypes?.[layer] ?? 'continuous');
  const modelPaint = (
    layer: string,
    colorHex: string | undefined,
    linetypeId: string | undefined,
    lineweightMm: number | undefined,
  ): string[] => {
    const codes: string[] = [];
    if (colorHex != null && colorHex !== modelLayerHex(layer)) {
      codes.push(pair(62, String(nearestAci(colorHex))), pair(420, String(trueColorDxf420(colorHex))));
    }
    if (linetypeId != null && dxfLinetypeName(linetypeId) !== modelLayerLinetype(layer)) {
      codes.push(pair(6, dxfLinetypeName(linetypeId)));
    }
    // Layer lineweights ride on the layer table record; entities carry 370
    // only when they override (BYLAYER by omission otherwise).
    if (lineweightMm != null) codes.push(pair(370, String(lineweightMmToDxf370(lineweightMm))));
    return codes;
  };
  model.points.forEach((point) => {
    emitModelEntity([
      pair(0, 'POINT'), pair(5, takeHandle()), pair(330, modelOwner),
      pair(100, 'AcDbEntity'), pair(8, point.layer),
      ...modelPaint(point.layer, point.colorHex, point.linetypeId, point.lineweightMm),
      ...invisible60(point.invisible),
      pair(100, 'AcDbPoint'),
      pair(10, fmt(point.at.x)), pair(20, fmt(point.at.y)), pair(30, '0'),
    ]);
  });
  model.lines.forEach((line) => {
    emitModelEntity([
      pair(0, 'LINE'), pair(5, takeHandle()), pair(330, modelOwner),
      pair(100, 'AcDbEntity'), pair(8, line.layer),
      ...modelPaint(line.layer, line.colorHex, line.linetypeId, line.lineweightMm),
      ...invisible60(line.invisible),
      pair(100, 'AcDbLine'),
      pair(10, fmt(line.from.x)), pair(20, fmt(line.from.y)), pair(30, '0'),
      pair(11, fmt(line.to.x)), pair(21, fmt(line.to.y)), pair(31, '0'),
    ]);
  });
  model.polylines.forEach((polyline) => {
    emitModelEntity([
      pair(0, 'LWPOLYLINE'), pair(5, takeHandle()), pair(330, modelOwner),
      pair(100, 'AcDbEntity'), pair(8, polyline.layer),
      ...modelPaint(polyline.layer, polyline.colorHex, polyline.linetypeId, polyline.lineweightMm),
      ...invisible60(polyline.invisible),
      pair(100, 'AcDbPolyline'),
      pair(90, String(polyline.vertices.length)), pair(70, polyline.closed ? '1' : '0'),
    ]);
    polyline.vertices.forEach((vertex) => {
      emitModelEntity([pair(10, fmt(vertex.x)), pair(20, fmt(vertex.y))]);
    });
  });
  model.arcs.forEach((arc) => {
    emitModelEntity([
      pair(0, 'ARC'), pair(5, takeHandle()), pair(330, modelOwner),
      pair(100, 'AcDbEntity'), pair(8, arc.layer),
      ...modelPaint(arc.layer, arc.colorHex, arc.linetypeId, arc.lineweightMm),
      ...invisible60(arc.invisible),
      pair(100, 'AcDbArc'),
      pair(10, fmt(arc.center.x)), pair(20, fmt(arc.center.y)), pair(30, '0'),
      pair(40, fmt(arc.radius)), pair(50, fmt(arc.startDeg)), pair(51, fmt(arc.endDeg)),
    ]);
  });
  model.texts.forEach((entry) => {
    emitModelEntity([
      pair(0, 'TEXT'), pair(5, takeHandle()), pair(330, modelOwner),
      pair(100, 'AcDbEntity'), pair(8, entry.layer),
      ...modelPaint(entry.layer, entry.colorHex, entry.linetypeId, entry.lineweightMm),
      ...invisible60(entry.invisible),
      pair(100, 'AcDbText'),
      pair(10, fmt(entry.at.x)), pair(20, fmt(entry.at.y)), pair(30, '0'),
      pair(40, fmt(entry.height)), pair(1, cleanText(entry.text)), pair(7, 'Standard'),
      ...(entry.rotationDeg != null && entry.rotationDeg !== 0 ? [pair(50, fmt(entry.rotationDeg))] : []),
    ]);
  });
  // Phase 18N: native model-space INSERTs (R2000 carries 41/42/43 scales
  // + 50 rotation; every referenced block gets a BLOCK_RECORD below).
  (model.inserts ?? []).forEach((insert) => {
    emitModelEntity([
      pair(0, 'INSERT'), pair(5, takeHandle()), pair(330, modelOwner),
      pair(100, 'AcDbEntity'), pair(8, insert.layer),
      ...modelPaint(insert.layer, insert.colorHex, insert.linetypeId, insert.lineweightMm),
      ...invisible60(insert.invisible),
      pair(100, 'AcDbInsert'),
      pair(2, insert.blockName),
      pair(10, fmt(insert.at.x)), pair(20, fmt(insert.at.y)), pair(30, '0'),
      pair(41, fmt(insert.scaleX)), pair(42, fmt(insert.scaleY)), pair(43, '1'),
      pair(50, fmt(normDeg(insert.rotationDeg))),
    ]);
  });
  const modelEntities = out.splice(0, out.length);

  // Paper-space bodies per sheet (mm, bottom-left origin): title block
  // geometry first, then the sheet's own entities.
  const titleBodies: string[][] = [];
  const paperBodies: string[][] = [];
  args.draft.sheets.forEach((sheet, sheetIndex) => {
    const section: string[] = [];
    const record = paperRecords[sheetIndex] as { handle: string; name: string };
    const flipY = (y: number): number => sheet.heightMm - y;
    const ctx: PaperContext = { out: section, owner: record.handle, flipY, layers: paperLayers, layerBase: paperLayerBase, paperColorOf, warnings, takeHandle };
    // Required full-paper default viewport (id 1): some readers ignore
    // paper space without it. Sheet-sized, centered, 1:1 view height.
    section.push(
      pair(0, 'VIEWPORT'), pair(5, takeHandle()), pair(330, record.handle),
      pair(100, 'AcDbEntity'), pair(8, '0'),
      pair(100, 'AcDbViewport'),
      pair(10, fmt(sheet.widthMm / 2)), pair(20, fmt(sheet.heightMm / 2)), pair(30, '0'),
      pair(40, fmt(sheet.widthMm)), pair(41, fmt(sheet.heightMm)),
      pair(12, '0'), pair(22, '0'), pair(32, '0'),
      pair(45, fmt(sheet.heightMm)),
      pair(51, '0'),
      pair(69, '1'),
    );
    sheet.viewports.forEach((viewport, viewportIndex) => {
      const cxPaper = viewport.paperXmm + viewport.paperWidthMm / 2;
      const cyPaper = flipY(viewport.paperYmm + viewport.paperHeightMm / 2);
      const viewHeight = (viewport.paperHeightMm * viewport.scaleDenominator) / 1000;
      section.push(
        pair(0, 'VIEWPORT'), pair(5, takeHandle()), pair(330, record.handle),
        pair(100, 'AcDbEntity'), pair(8, '0'),
        pair(100, 'AcDbViewport'),
        pair(10, fmt(cxPaper)), pair(20, fmt(cyPaper)), pair(30, '0'),
        pair(40, fmt(viewport.paperWidthMm)), pair(41, fmt(viewport.paperHeightMm)),
        pair(12, fmt(viewport.modelCenterX)), pair(22, fmt(viewport.modelCenterY)), pair(32, '0'),
        pair(45, fmt(viewHeight)),
        pair(51, fmt(normDeg(viewport.rotationDeg))),
        // Default viewport above owns id 1; floating model views start at 2.
        pair(69, String(viewportIndex + 2)),
      );
    });
    // Paper-space labels (document DXF subset): same per-viewport
    // resolution as SVG/PDF via buildPaperLabelItems; leaders ride along
    // as LINE items. Scene coords (top-left origin); emitPaperItem flips.
    {
      const effective = args.modelLabels ?? draftLabelsToPlacements(args.draft.labels);
      sheet.viewports.forEach((viewport) => {
        const toPaper = (x: number, y: number): { xMm: number; yMm: number } =>
          modelToPaperPoint(x, y, viewport, viewport.rotationDeg ?? 0);
        const placed = buildPaperLabelItems(effective, viewport.id, toPaper);
        placed.items.forEach((item) => emitPaperItem(ctx, item));
      });
    }
    // Title block (rect outline, sheet fields, sheet-object texts) as
    // BLOCK+INSERT at the origin so paper coordinates stay absolute.
    const title = buildTitleBlockItems(sheet, 'title-block',
      sheet.titleBlockId ? args.draft.titleBlockDefinitions.find((entry) => entry.id === sheet.titleBlockId) : undefined,
      buildSheetTokenContext({ sheet, sheetNumber: sheetIndex + 1, projectName: args.project.name }));
    title.unknownTokens.forEach((token) => {
      warnings.push({ code: 'UNKNOWN_TOKEN', message: `sheet ${sheet.name}: unknown sheet token {${token}}` });
    });
    sheet.sheetObjects.forEach((object) => {
      if (typeof object.text !== 'string') {
        warnings.push({ code: 'UNSUPPORTED_SHEET_OBJECT', message: `sheet ${sheet.name}: object ${object.id} (${object.kind}) has no text and is not representable` });
      }
    });
    const titleRecord = titleRecords[sheetIndex] as { handle: string; name: string };
    const blockCtx: PaperContext = { out: [], owner: titleRecord.handle, flipY, layers: paperLayers, layerBase: paperLayerBase, paperColorOf, warnings, takeHandle };
    title.items.forEach((item) => emitPaperItem(blockCtx, item));
    titleBodies.push(blockCtx.out);
    paperBodies.push(section);
    section.push(
      pair(0, 'INSERT'), pair(5, takeHandle()), pair(330, record.handle),
      pair(100, 'AcDbEntity'), pair(8, 'title-block'),
      pair(100, 'AcDbBlockReference'),
      pair(2, titleRecord.name),
      pair(10, '0'), pair(20, '0'), pair(30, '0'),
    );
    paperLayers.add('title-block');
    // Persisted continued tables: same paper-mm renderer as the scene, so
    // layout DXF carries identical headers/rows/Continued titles.
    buildTableFragmentItems(args.draft, sheet.id).forEach((item) => emitPaperItem(ctx, item));
    (args.paperExtras ?? []).forEach((item) => emitPaperItem(ctx, item));
  });

  // Late-discovered paper layers get table handles now (before TABLES emit).
  [...paperLayers].sort().forEach((layer) => {
    if (!layerHandles.has(layer)) layerHandles.set(layer, takeHandle());
  });
  const handseed = nextHandle.toString(16).toUpperCase();

  const dxf: string[] = [];
  dxf.push(
    pair(0, 'SECTION'), pair(2, 'HEADER'),
    pair(9, '$ACADVER'), pair(1, 'AC1015'),
    pair(9, '$HANDSEED'), pair(5, handseed),
    pair(9, '$INSUNITS'), pair(70, '6'),
    pair(9, '$MEASUREMENT'), pair(70, '1'),
    pair(0, 'ENDSEC'),
    pair(0, 'SECTION'), pair(2, 'CLASSES'), pair(0, 'ENDSEC'),
    pair(0, 'SECTION'), pair(2, 'TABLES'),
    pair(0, 'TABLE'), pair(2, 'VPORT'), pair(5, vportTable), pair(330, '0'),
    pair(100, 'AcDbSymbolTable'), pair(70, '1'),
    pair(0, 'VPORT'), pair(5, vportActive), pair(330, vportTable),
    pair(100, 'AcDbSymbolTableRecord'), pair(100, 'AcDbViewportTableRecord'),
    pair(2, '*Active'), pair(70, '0'),
    pair(0, 'ENDTAB'),
    pair(0, 'TABLE'), pair(2, 'LTYPE'), pair(5, ltypeTable), pair(330, '0'),
    pair(100, 'AcDbSymbolTable'), pair(70, String(2 + ltypeHandles.size)),
    pair(0, 'LTYPE'), pair(5, ltypeByBlock), pair(330, ltypeTable),
    pair(100, 'AcDbSymbolTableRecord'), pair(100, 'AcDbLinetypeTableRecord'),
    pair(2, 'ByBlock'), pair(70, '0'), pair(3, ''), pair(72, '65'), pair(73, '0'), pair(40, '0'),
    pair(0, 'LTYPE'), pair(5, ltypeByLayer), pair(330, ltypeTable),
    pair(100, 'AcDbSymbolTableRecord'), pair(100, 'AcDbLinetypeTableRecord'),
    pair(2, 'ByLayer'), pair(70, '0'), pair(3, ''), pair(72, '65'), pair(73, '0'), pair(40, '0'),
    ...usedLinetypeNames.flatMap((name) => {
      const id = usedLinetypeIds.find((entry) => dxfLinetypeName(entry) === name) ?? 'continuous';
      const def = DXF_LINETYPE_CATALOG[id] ?? DXF_LINETYPE_CATALOG['continuous'];
      const entry = def as { name: string; pattern: number[] };
      const rec: string[] = [
        pair(0, 'LTYPE'), pair(5, ltypeHandles.get(name) as string), pair(330, ltypeTable),
        pair(100, 'AcDbSymbolTableRecord'), pair(100, 'AcDbLinetypeTableRecord'),
        pair(2, name), pair(70, '0'),
      ];
      if (entry.pattern.length === 0) {
        rec.push(pair(3, 'Solid line'), pair(72, '65'), pair(73, '0'), pair(40, '0'));
      } else {
        const total = entry.pattern.reduce((sum, el) => sum + Math.abs(el), 0);
        rec.push(
          pair(3, 'Short dashes'), pair(72, '65'), pair(73, String(entry.pattern.length)),
          pair(40, fmt(total)),
        );
        entry.pattern.forEach((el) => {
          rec.push(pair(49, fmt(el)), pair(74, el >= 0 ? '0' : '1'));
        });
      }
      return rec;
    }),
    pair(0, 'ENDTAB'),
    pair(0, 'TABLE'), pair(2, 'LAYER'), pair(5, layerTable), pair(330, '0'),
    pair(100, 'AcDbSymbolTable'), pair(70, String(layerHandles.size)),
  );
  [...layerHandles.entries()].sort((a, b) => (a[0] < b[0] ? -1 : 1)).forEach(([layer, handle]) => {
    const hex = model.layerColors?.[layer] ?? paperLayerBase.get(layer) ?? '#ffffff';
    const flags = model.layerFlags?.[layer];
    const aci = nearestAci(hex);
    let bits70 = 0;
    if (flags?.frozen === true) bits70 |= 1;
    if (flags?.locked === true) bits70 |= 4;
    const codes: string[] = [
      pair(0, 'LAYER'), pair(5, handle), pair(330, layerTable),
      pair(100, 'AcDbSymbolTableRecord'), pair(100, 'AcDbLayerTableRecord'),
      pair(2, layer), pair(70, String(bits70)),
      // OFF rides as negative 62 (420 true color stays positive).
      pair(62, String(flags?.off === true ? -aci : aci)), pair(420, String(trueColorDxf420(hex))),
      pair(6, dxfLinetypeName(model.layerLinetypes?.[layer] ?? 'continuous')),
    ];
    const weight = model.layerLineweights?.[layer];
    if (weight != null) codes.push(pair(370, String(lineweightMmToDxf370(weight))));
    dxf.push(...codes);
  });
  dxf.push(
    pair(0, 'ENDTAB'),
    pair(0, 'TABLE'), pair(2, 'STYLE'), pair(5, styleTable), pair(330, '0'),
    pair(100, 'AcDbSymbolTable'), pair(70, '1'),
    pair(0, 'STYLE'), pair(5, styleStandard), pair(330, styleTable),
    pair(100, 'AcDbSymbolTableRecord'), pair(100, 'AcDbTextStyleTableRecord'),
    pair(2, 'Standard'), pair(70, '0'), pair(40, '0'), pair(41, '1'), pair(50, '0'),
    pair(71, '0'), pair(42, '0.2'), pair(3, 'txt'), pair(4, ''),
    pair(0, 'ENDTAB'),
    pair(0, 'TABLE'), pair(2, 'APPID'), pair(5, appidTable), pair(330, '0'),
    pair(100, 'AcDbSymbolTable'), pair(70, '1'),
    pair(0, 'APPID'), pair(5, appidAcad), pair(330, appidTable),
    pair(100, 'AcDbSymbolTableRecord'), pair(100, 'AcDbRegAppTableRecord'),
    pair(2, 'ACAD'), pair(70, '0'),
    pair(0, 'ENDTAB'),
    pair(0, 'TABLE'), pair(2, 'DIMSTYLE'), pair(5, dimstyleTable), pair(330, '0'),
    pair(100, 'AcDbSymbolTable'), pair(70, '1'),
    pair(0, 'DIMSTYLE'), pair(5, dimstyleStandard), pair(330, dimstyleTable),
    pair(100, 'AcDbSymbolTableRecord'), pair(100, 'AcDbDimStyleTableRecord'),
    pair(2, 'Standard'), pair(70, '0'),
    pair(0, 'ENDTAB'),
    pair(0, 'TABLE'), pair(2, 'BLOCK_RECORD'), pair(5, blockRecordTable), pair(330, '0'),
    pair(100, 'AcDbSymbolTable'), pair(70, String(2 + paperRecords.length + titleRecords.length + modelBlockRecords.length)),
    pair(0, 'BLOCK_RECORD'), pair(5, modelSpaceRecord), pair(330, blockRecordTable),
    pair(100, 'AcDbSymbolTableRecord'), pair(100, 'AcDbBlockTableRecord'),
    pair(2, '*Model_Space'), pair(70, '0'), pair(280, '1'), pair(281, '0'), pair(340, modelLayout),
  );
  paperRecords.forEach((record, index) => {
    dxf.push(
      pair(0, 'BLOCK_RECORD'), pair(5, record.handle), pair(330, blockRecordTable),
      pair(100, 'AcDbSymbolTableRecord'), pair(100, 'AcDbBlockTableRecord'),
      pair(2, record.name), pair(70, '0'), pair(280, '1'), pair(281, '0'),
      pair(340, sheetLayouts[index] as string),
    );
  });
  titleRecords.forEach((record) => {
    dxf.push(
      pair(0, 'BLOCK_RECORD'), pair(5, record.handle), pair(330, blockRecordTable),
      pair(100, 'AcDbSymbolTableRecord'), pair(100, 'AcDbBlockTableRecord'),
      pair(2, record.name), pair(70, '0'), pair(280, '1'), pair(281, '0'),
    );
  });
  modelBlockRecords.forEach((record) => {
    dxf.push(
      pair(0, 'BLOCK_RECORD'), pair(5, record.handle), pair(330, blockRecordTable),
      pair(100, 'AcDbSymbolTableRecord'), pair(100, 'AcDbBlockTableRecord'),
      pair(2, record.name), pair(70, '0'), pair(280, '1'), pair(281, '0'),
    );
  });
  dxf.push(pair(0, 'ENDTAB'), pair(0, 'ENDSEC'));

  dxf.push(pair(0, 'SECTION'), pair(2, 'BLOCKS'));
  const emitBlock = (recordName: string, recordHandle: string, body: string[]): void => {
    dxf.push(
      pair(0, 'BLOCK'), pair(5, blockBegin.get(recordHandle) as string), pair(330, recordHandle),
      pair(100, 'AcDbEntity'), pair(8, '0'),
      pair(100, 'AcDbBlockBegin'),
      pair(2, recordName), pair(70, '0'), pair(10, '0'), pair(20, '0'), pair(30, '0'), pair(3, recordName),
      ...body,
      pair(0, 'ENDBLK'), pair(5, blockEnd.get(recordHandle) as string), pair(330, recordHandle),
      pair(100, 'AcDbEntity'), pair(100, 'AcDbBlockEnd'),
    );
  };
  dxf.push(
    pair(0, 'BLOCK'), pair(5, modelBegin), pair(330, modelSpaceRecord),
    pair(100, 'AcDbEntity'), pair(8, '0'),
    pair(100, 'AcDbBlockBegin'),
    pair(2, '*Model_Space'), pair(70, '0'), pair(10, '0'), pair(20, '0'), pair(30, '0'), pair(3, '*Model_Space'),
    pair(0, 'ENDBLK'), pair(5, modelEnd), pair(330, modelSpaceRecord),
    pair(100, 'AcDbEntity'), pair(100, 'AcDbBlockEnd'),
  );
  let titleIndex = 0;
  paperRecords.forEach((record, index) => {
    emitBlock(record.name, record.handle, []);
    emitBlock(
      (titleRecords[index] as { handle: string; name: string }).name,
      (titleRecords[index] as { handle: string; name: string }).handle,
      titleBodies[titleIndex] as string[],
    );
    titleIndex += 1;
  });
  // Phase 18N: model-space block bodies (base-shifted children, BYLAYER).
  (model.blocks ?? []).forEach((block, blockIndex) => {
    const record = modelBlockRecords[blockIndex] as { handle: string; name: string };
    const body: string[] = [];
    block.lines.forEach((line) => {
      body.push(
        pair(0, 'LINE'), pair(5, takeHandle()), pair(330, record.handle),
        pair(100, 'AcDbEntity'), pair(8, line.layer),
        pair(100, 'AcDbLine'),
        pair(10, fmt(line.from.x)), pair(20, fmt(line.from.y)), pair(30, '0'),
        pair(11, fmt(line.to.x)), pair(21, fmt(line.to.y)), pair(31, '0'),
      );
    });
    block.polylines.forEach((polyline) => {
      body.push(
        pair(0, 'LWPOLYLINE'), pair(5, takeHandle()), pair(330, record.handle),
        pair(100, 'AcDbEntity'), pair(8, polyline.layer),
        pair(100, 'AcDbPolyline'),
        pair(90, String(polyline.vertices.length)), pair(70, polyline.closed ? '1' : '0'),
      );
      polyline.vertices.forEach((vertex) => {
        body.push(pair(10, fmt(vertex.x)), pair(20, fmt(vertex.y)));
      });
    });
    block.arcs.forEach((arc) => {
      body.push(
        pair(0, 'ARC'), pair(5, takeHandle()), pair(330, record.handle),
        pair(100, 'AcDbEntity'), pair(8, arc.layer),
        pair(100, 'AcDbArc'),
        pair(10, fmt(arc.center.x)), pair(20, fmt(arc.center.y)), pair(30, '0'),
        pair(40, fmt(arc.radius)), pair(50, fmt(arc.startDeg)), pair(51, fmt(arc.endDeg)),
      );
    });
    block.texts.forEach((entry) => {
      body.push(
        pair(0, 'TEXT'), pair(5, takeHandle()), pair(330, record.handle),
        pair(100, 'AcDbEntity'), pair(8, entry.layer),
        pair(100, 'AcDbText'),
        pair(10, fmt(entry.at.x)), pair(20, fmt(entry.at.y)), pair(30, '0'),
        pair(40, fmt(entry.height)), pair(1, cleanText(entry.text)), pair(7, 'Standard'),
      );
    });
    emitBlock(record.name, record.handle, body);
  });
  dxf.push(pair(0, 'ENDSEC'));

  dxf.push(pair(0, 'SECTION'), pair(2, 'ENTITIES'));
  dxf.push(...modelEntities);
  paperRecords.forEach((_, index) => {
    dxf.push(...(paperBodies[index] as string[]));
  });
  dxf.push(pair(0, 'ENDSEC'));

  const bounds = modelBounds(model);
  dxf.push(
    pair(0, 'SECTION'), pair(2, 'OBJECTS'),
    pair(0, 'DICTIONARY'), pair(5, rootDict), pair(330, '0'),
    pair(100, 'AcDbDictionary'), pair(280, '1'), pair(281, '1'),
    pair(3, 'ACAD_LAYOUT'), pair(350, layoutDict),
    pair(0, 'DICTIONARY'), pair(5, layoutDict), pair(330, rootDict),
    pair(100, 'AcDbDictionary'), pair(280, '1'), pair(281, '1'),
    pair(3, 'Model'), pair(350, modelLayout),
  );
  layoutNames.forEach((name, index) => {
    dxf.push(pair(3, name), pair(350, sheetLayouts[index] as string));
  });
  const emitLayout = (handle: string, name: string, tabOrder: number, blockRecord: string, minX: number, minY: number, maxX: number, maxY: number): void => {
    dxf.push(
      pair(0, 'LAYOUT'), pair(5, handle), pair(330, layoutDict),
      pair(100, 'AcDbPlotSettings'),
      pair(1, ''), pair(2, ''), pair(4, ''), pair(6, ''),
      pair(40, '0'), pair(41, '0'), pair(42, '0'), pair(43, '0'),
      pair(44, '0'), pair(45, '0'), pair(46, '0'), pair(47, '0'),
      pair(142, '1'), pair(143, '1'),
      pair(70, '0'), pair(72, '0'), pair(73, '0'), pair(74, '0'),
      pair(7, ''), pair(75, '0'), pair(76, '0'), pair(77, '0'), pair(78, '0'), pair(147, '0'),
      pair(100, 'AcDbLayout'),
      pair(1, name), pair(70, '1'), pair(71, String(tabOrder)), pair(330, blockRecord), pair(331, '0'),
      pair(10, fmt(minX)), pair(20, fmt(minY)),
      pair(11, fmt(maxX)), pair(21, fmt(maxY)),
      pair(12, '0'), pair(22, '0'), pair(32, '0'),
      pair(14, fmt(minX)), pair(24, fmt(minY)), pair(34, '0'),
      pair(15, fmt(maxX)), pair(25, fmt(maxY)), pair(35, '0'),
    );
  };
  emitLayout(modelLayout, 'Model', 0, modelSpaceRecord, bounds.minX, bounds.minY, bounds.maxX, bounds.maxY);
  args.draft.sheets.forEach((sheet, index) => {
    emitLayout(
      sheetLayouts[index] as string, layoutNames[index] as string, index + 1,
      (paperRecords[index] as { handle: string }).handle, 0, 0, sheet.widthMm, sheet.heightMm,
    );
  });
  dxf.push(pair(0, 'ENDSEC'), pair(0, 'EOF'));

  return { dxf: `${dxf.join('\n')}\n`, warnings, layouts: layoutNames, modelResult };
};

/** Legacy bare-layout path (paper warnings only). Prefer WithResult for new callers. */
export const buildDxfLayoutText = (args: BuildDxfLayoutArgs): DxfLayoutResult => {
  const { modelResult: _dropped, ...bare } = buildDxfLayoutInner(args);
  return bare;
};

/** R2000 with the unified result contract: model warnings/dispositions
 *  plus the mapped paper warnings; payload identical to the bare path. */
export const buildDxfLayoutTextWithResult = (args: BuildDxfLayoutArgs): ExportResult<DxfLayoutContent> => {
  const inner = buildDxfLayoutInner(args);
  return finalizeExportResult({
    output: { dxf: inner.dxf, layouts: inner.layouts },
    warnings: [...inner.modelResult.warnings, ...toExportWarnings(inner.warnings)],
    errors: [],
    exportedEntityIds: [...inner.modelResult.exportedEntityIds],
    omittedEntityIds: [...inner.modelResult.omittedEntityIds],
    approximatedEntityIds: [...inner.modelResult.approximatedEntityIds],
  });
};
