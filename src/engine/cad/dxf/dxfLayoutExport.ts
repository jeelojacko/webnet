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
import { buildDxfExportModel, type BuildDxfModelArgs, type DxfExportModel } from './dxfExportModel';
import { serializeDxfModel } from './dxfSerializer';

// Dual DXF contract (Phase 13C §§6-10):
// - buildDxfModelSpaceText: R12 (AC1009) model-space-only survey export.
//   Byte-identical to serializeDxfModel(buildDxfExportModel(...)); paper
//   deliverables never leak into it.
// - buildDxfLayoutText (below): R2000 (AC1015) multi-layout export. Model
//   space keeps exact survey coordinates (meters, never rebased); each
//   DraftSheet becomes a named paper-space LAYOUT with VIEWPORT entities,
//   title block (BLOCK+INSERT), and paper annotations in mm.
// Paper space uses bottom-left origin: yDxf = sheetHeightMm - ySceneMm.

export const buildDxfModelSpaceText = (args: BuildDxfModelArgs): string =>
  serializeDxfModel(buildDxfExportModel(args));

export interface BuildDxfLayoutArgs {
  project: CadProject;
  draft: DraftDocument;
  modelLabels?: ModelLabelPlacement[];
  /** Shared paper extras (north arrow, scale bar) in scene mm, top-left origin. */
  paperExtras?: ExportItem[];
}

export interface DxfLayoutWarning {
  code: 'UNKNOWN_TOKEN' | 'UNSUPPORTED_SHEET_OBJECT' | 'SKIPPED_PAPER_ITEM';
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
  warnings: DxfLayoutWarning[];
  takeHandle: () => string;
}

const emitPaperText = (
  ctx: PaperContext,
  layer: string,
  x: number,
  yScene: number,
  height: number,
  text: string,
  rotationSceneDeg = 0,
): void => {
  ctx.layers.add(layer);
  ctx.out.push(
    pair(0, 'TEXT'), pair(5, ctx.takeHandle()), pair(330, ctx.owner),
    pair(100, 'AcDbEntity'), pair(8, layer),
    pair(100, 'AcDbText'),
    pair(10, fmt(x)), pair(20, fmt(ctx.flipY(yScene))), pair(30, '0'),
    pair(40, fmt(height)), pair(1, cleanText(text)), pair(7, 'Standard'),
  );
  // Scene rotation is clockwise-as-seen (SVG rotate direction); DXF group 50
  // is CCW in a y-up frame, so the same visual is the negated angle.
  if (normDeg(rotationSceneDeg) !== 0) ctx.out.push(pair(50, fmt(normDeg(-rotationSceneDeg))));
};

const emitPaperPolyline = (ctx: PaperContext, layer: string, points: Array<{ x: number; y: number }>, closed: boolean): void => {
  if (points.length === 0) return;
  ctx.layers.add(layer);
  ctx.out.push(
    pair(0, 'LWPOLYLINE'), pair(5, ctx.takeHandle()), pair(330, ctx.owner),
    pair(100, 'AcDbEntity'), pair(8, layer),
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
      ctx.layers.add(item.layer);
      ctx.out.push(
        pair(0, 'LINE'), pair(5, ctx.takeHandle()), pair(330, ctx.owner),
        pair(100, 'AcDbEntity'), pair(8, item.layer),
        pair(100, 'AcDbLine'),
        pair(10, fmt(item.x1)), pair(20, fmt(ctx.flipY(item.y1))), pair(30, '0'),
        pair(11, fmt(item.x2)), pair(21, fmt(ctx.flipY(item.y2))), pair(31, '0'),
      );
      break;
    case 'polyline':
      emitPaperPolyline(ctx, item.layer, item.points, item.close);
      break;
    case 'rect':
      emitPaperPolyline(ctx, item.layer, [
        { x: item.x, y: item.y },
        { x: item.x + item.width, y: item.y },
        { x: item.x + item.width, y: item.y + item.height },
        { x: item.x, y: item.y + item.height },
      ], true);
      break;
    case 'circle':
      ctx.layers.add(item.layer);
      ctx.out.push(
        pair(0, 'CIRCLE'), pair(5, ctx.takeHandle()), pair(330, ctx.owner),
        pair(100, 'AcDbEntity'), pair(8, item.layer),
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
      ctx.layers.add(item.layer);
      ctx.out.push(
        pair(0, 'ELLIPSE'), pair(5, ctx.takeHandle()), pair(330, ctx.owner),
        pair(100, 'AcDbEntity'), pair(8, item.layer),
        pair(100, 'AcDbEllipse'),
        pair(10, fmt(cx)), pair(20, fmt(cy)), pair(30, '0'),
        pair(11, fmt(item.rx * Math.cos(twist))), pair(21, fmt(item.rx * Math.sin(twist))), pair(31, '0'),
        pair(40, fmt(item.ry / item.rx)),
        pair(41, '0'), pair(42, fmt(2 * Math.PI)),
      );
      break;
    }
    case 'arc':
      ctx.layers.add(item.layer);
      ctx.out.push(
        pair(0, 'ARC'), pair(5, ctx.takeHandle()), pair(330, ctx.owner),
        pair(100, 'AcDbEntity'), pair(8, item.layer),
        pair(100, 'AcDbArc'),
        pair(10, fmt(item.cx)), pair(20, fmt(ctx.flipY(item.cy))), pair(30, '0'),
        pair(40, fmt(item.r)),
        pair(50, fmt(normDeg(-item.endDeg))),
        pair(51, fmt(normDeg(-item.startDeg))),
      );
      break;
    case 'text':
      emitPaperText(ctx, item.layer, item.x, item.y, item.heightMm, item.text, item.rotationDeg ?? 0);
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
  if (xs.length === 0) return { minX: 0, minY: 0, maxX: 1000, maxY: 1000 };
  return {
    minX: Math.min(...xs),
    minY: Math.min(...ys),
    maxX: Math.max(...xs),
    maxY: Math.max(...ys),
  };
};

export const buildDxfLayoutText = (args: BuildDxfLayoutArgs): DxfLayoutResult => {
  const warnings: DxfLayoutWarning[] = [];
  let nextHandle = 0x20;
  const takeHandle = (): string => {
    const handle = nextHandle.toString(16).toUpperCase();
    nextHandle += 1;
    return handle;
  };

  const model = buildDxfExportModel({ project: args.project, modelLabels: args.modelLabels });
  const paperLayers = new Set<string>();
  const takenNames = new Set<string>(['model']);
  const layoutNames = args.draft.sheets.map((sheet) => sanitizeLayoutName(sheet.name, takenNames));

  // Pre-assign structural handles (owners are referenced before definition).
  const vportTable = takeHandle();
  const vportActive = takeHandle();
  const ltypeTable = takeHandle();
  const ltypeHandles = [takeHandle(), takeHandle(), takeHandle()];
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
  const rootDict = takeHandle();
  const layoutDict = takeHandle();
  const modelLayout = takeHandle();
  const sheetLayouts = args.draft.sheets.map(() => takeHandle());

  const blockBegin = new Map<string, string>();
  const blockEnd = new Map<string, string>();
  [...paperRecords, ...titleRecords].forEach((record) => {
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
  const modelOwner = modelSpaceRecord;
  model.points.forEach((point) => {
    emitModelEntity([
      pair(0, 'POINT'), pair(5, takeHandle()), pair(330, modelOwner),
      pair(100, 'AcDbEntity'), pair(8, point.layer),
      pair(100, 'AcDbPoint'),
      pair(10, fmt(point.at.x)), pair(20, fmt(point.at.y)), pair(30, '0'),
    ]);
  });
  model.lines.forEach((line) => {
    emitModelEntity([
      pair(0, 'LINE'), pair(5, takeHandle()), pair(330, modelOwner),
      pair(100, 'AcDbEntity'), pair(8, line.layer),
      pair(100, 'AcDbLine'),
      pair(10, fmt(line.from.x)), pair(20, fmt(line.from.y)), pair(30, '0'),
      pair(11, fmt(line.to.x)), pair(21, fmt(line.to.y)), pair(31, '0'),
    ]);
  });
  model.polylines.forEach((polyline) => {
    emitModelEntity([
      pair(0, 'LWPOLYLINE'), pair(5, takeHandle()), pair(330, modelOwner),
      pair(100, 'AcDbEntity'), pair(8, polyline.layer),
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
      pair(100, 'AcDbArc'),
      pair(10, fmt(arc.center.x)), pair(20, fmt(arc.center.y)), pair(30, '0'),
      pair(40, fmt(arc.radius)), pair(50, fmt(arc.startDeg)), pair(51, fmt(arc.endDeg)),
    ]);
  });
  model.texts.forEach((entry) => {
    emitModelEntity([
      pair(0, 'TEXT'), pair(5, takeHandle()), pair(330, modelOwner),
      pair(100, 'AcDbEntity'), pair(8, entry.layer),
      pair(100, 'AcDbText'),
      pair(10, fmt(entry.at.x)), pair(20, fmt(entry.at.y)), pair(30, '0'),
      pair(40, fmt(entry.height)), pair(1, cleanText(entry.text)), pair(7, 'Standard'),
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
    const ctx: PaperContext = { out: section, owner: record.handle, flipY, layers: paperLayers, warnings, takeHandle };
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
        pair(69, String(viewportIndex + 1)),
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
    const blockCtx: PaperContext = { out: [], owner: titleRecord.handle, flipY, layers: paperLayers, warnings, takeHandle };
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
    pair(100, 'AcDbSymbolTable'), pair(70, '3'),
    pair(0, 'LTYPE'), pair(5, ltypeHandles[0]), pair(330, ltypeTable),
    pair(100, 'AcDbSymbolTableRecord'), pair(100, 'AcDbLinetypeTableRecord'),
    pair(2, 'ByBlock'), pair(70, '0'), pair(3, ''), pair(72, '65'), pair(73, '0'), pair(40, '0'),
    pair(0, 'LTYPE'), pair(5, ltypeHandles[1]), pair(330, ltypeTable),
    pair(100, 'AcDbSymbolTableRecord'), pair(100, 'AcDbLinetypeTableRecord'),
    pair(2, 'ByLayer'), pair(70, '0'), pair(3, ''), pair(72, '65'), pair(73, '0'), pair(40, '0'),
    pair(0, 'LTYPE'), pair(5, ltypeHandles[2]), pair(330, ltypeTable),
    pair(100, 'AcDbSymbolTableRecord'), pair(100, 'AcDbLinetypeTableRecord'),
    pair(2, 'Continuous'), pair(70, '0'), pair(3, 'Solid line'), pair(72, '65'), pair(73, '0'), pair(40, '0'),
    pair(0, 'ENDTAB'),
    pair(0, 'TABLE'), pair(2, 'LAYER'), pair(5, layerTable), pair(330, '0'),
    pair(100, 'AcDbSymbolTable'), pair(70, String(layerHandles.size)),
  );
  [...layerHandles.entries()].sort((a, b) => (a[0] < b[0] ? -1 : 1)).forEach(([layer, handle]) => {
    dxf.push(
      pair(0, 'LAYER'), pair(5, handle), pair(330, layerTable),
      pair(100, 'AcDbSymbolTableRecord'), pair(100, 'AcDbLayerTableRecord'),
      pair(2, layer), pair(70, '0'), pair(62, '7'), pair(6, 'Continuous'),
    );
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
    pair(100, 'AcDbSymbolTable'), pair(70, String(2 + paperRecords.length + titleRecords.length)),
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

  return { dxf: `${dxf.join('\n')}\n`, warnings, layouts: layoutNames };
};
