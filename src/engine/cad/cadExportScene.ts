import { buildCadDisplayScene } from './cadRenderer';
import type { CadDisplayPrimitive } from './cadDisplayTypes';
import { BROKEN_REFERENCE_TEXT } from './cadLabelEngine';
import type { DraftSheet, DraftDocument } from './cadDraftTypes';
import { expandSheetTokens, asPlanViewport } from './cadSheets';
import type { CadProject } from './cadTypes';

export interface ExportWarning {
  code: 'BROKEN_REFERENCE' | 'UNKNOWN_TOKEN' | 'MISSING_STYLE' | 'SKIPPED_ENTITY';
  message: string;
}

export interface ExportClip {
  id: string;
  xMm: number;
  yMm: number;
  widthMm: number;
  heightMm: number;
}

export interface ExportBase {
  layer: string;
  clipId?: string;
}

export type ExportItem =
  | (ExportBase & { kind: 'line'; x1: number; y1: number; x2: number; y2: number; widthMm?: number })
  | (ExportBase & { kind: 'polyline'; points: Array<{ x: number; y: number }>; close: boolean; widthMm?: number })
  | (ExportBase & { kind: 'rect'; x: number; y: number; width: number; height: number; fill?: string })
  | (ExportBase & { kind: 'circle'; cx: number; cy: number; r: number })
  | (ExportBase & { kind: 'ellipse'; cx: number; cy: number; rx: number; ry: number; rotationDeg: number })
  | (ExportBase & { kind: 'arc'; cx: number; cy: number; r: number; startDeg: number; endDeg: number })
  | (ExportBase & {
      kind: 'text';
      x: number;
      y: number;
      text: string;
      heightMm: number;
      anchor?: 'start' | 'middle' | 'end';
      rotationDeg?: number;
    });

// Paper-space scene in mm, origin top-left. One representation feeds the
// screen preview, the SVG serializer, and the PDF adapter.
export interface ExportSheetScene {
  sheetId: string;
  sheetName: string;
  widthMm: number;
  heightMm: number;
  clips: ExportClip[];
  items: ExportItem[];
}

export interface ModelLabelPlacement {
  id: string;
  text?: string;
  broken?: boolean;
  xModel: number;
  yModel: number;
  heightMm?: number;
  layerId?: string;
}

export interface PaperTextPlacement {
  text: string;
  xMm: number;
  yMm: number;
  heightMm?: number;
  anchor?: 'start' | 'middle' | 'end';
  layerId?: string;
}

// Precision-safe model→paper mapping: the viewport-center offset is removed
// in model units BEFORE scaling, so E≈2.4M/N≈7.4M grids lose nothing to
// float cancellation. Stored geometry is never touched.
export const modelToPaperPoint = (
  xModel: number,
  yModel: number,
  viewport: { modelCenterX: number; modelCenterY: number; scaleDenominator: number; paperXmm: number; paperYmm: number },
): { xMm: number; yMm: number } => {
  const k = 1000 / viewport.scaleDenominator;
  return {
    xMm: viewport.paperXmm + (xModel - viewport.modelCenterX) * k,
    yMm: viewport.paperYmm - (yModel - viewport.modelCenterY) * k,
  };
};

const ARC_STEPS = 48;

const arcToPolyline = (
  cx: number,
  cy: number,
  r: number,
  startDeg: number,
  endDeg: number,
): Array<{ x: number; y: number }> => {
  let sweep = endDeg - startDeg;
  while (sweep <= 0) sweep += 360;
  const steps = Math.max(8, Math.ceil((sweep / 360) * ARC_STEPS));
  return Array.from({ length: steps + 1 }, (_, i) => {
    const a = ((startDeg + (sweep * i) / steps) * Math.PI) / 180;
    return { x: cx + r * Math.cos(a), y: cy + r * Math.sin(a) };
  });
};

const primitiveToPaper = (
  primitive: CadDisplayPrimitive,
  toPaper: (_x: number, _y: number) => { xMm: number; yMm: number },
  clipId: string,
): ExportItem[] => {
  const layer = primitive.layerId;
  switch (primitive.kind) {
    case 'line': {
      const [a, b] = primitive.points;
      const pa = toPaper(a.x, a.y);
      const pb = toPaper(b.x, b.y);
      return [{ kind: 'line', layer, clipId, x1: pa.xMm, y1: pa.yMm, x2: pb.xMm, y2: pb.yMm }];
    }
    case 'point': {
      const p = toPaper(primitive.point.x, primitive.point.y);
      return [{ kind: 'circle', layer, clipId, cx: p.xMm, cy: p.yMm, r: primitive.radius }];
    }
    case 'arc': {
      const c = toPaper(primitive.center.x, primitive.center.y);
      const k = Math.abs(toPaper(primitive.center.x + primitive.radius, primitive.center.y).xMm - c.xMm);
      void k;
      return [
        {
          kind: 'polyline',
          layer,
          clipId,
          points: arcToPolyline(primitive.center.x, primitive.center.y, primitive.radius, primitive.startAngleDeg, primitive.endAngleDeg).map(
            (pt) => {
              const q = toPaper(pt.x, pt.y);
              return { x: q.xMm, y: q.yMm };
            },
          ),
          close: false,
        },
      ];
    }
    case 'text': {
      const p = toPaper(primitive.point.x, primitive.point.y);
      return [
        {
          kind: 'text',
          layer,
          clipId,
          x: p.xMm,
          y: p.yMm,
          text: primitive.text,
          heightMm: Math.max(0.5, primitive.fontSize * 0.35),
          anchor: primitive.textAnchor,
        },
      ];
    }
    case 'ellipse': {
      const c = toPaper(primitive.center.x, primitive.center.y);
      const ex = toPaper(primitive.center.x + primitive.semiMajor, primitive.center.y);
      const ey = toPaper(primitive.center.x, primitive.center.y + primitive.semiMinor);
      return [
        {
          kind: 'ellipse',
          layer,
          clipId,
          cx: c.xMm,
          cy: c.yMm,
          rx: Math.abs(ex.xMm - c.xMm),
          ry: Math.abs(ey.yMm - c.yMm),
          rotationDeg: primitive.thetaDeg,
        },
      ];
    }
    default:
      return [];
  }
};

// North arrow (grid north only) and scale bar are paper-space items built by
// these helpers so fixture, SVG, and PDF share one definition.
export const buildNorthArrowItems = (xMm: number, yMm: number, sizeMm: number, layer: string): ExportItem[] => [
  { kind: 'polyline', layer, points: [{ x: xMm, y: yMm - sizeMm }, { x: xMm + sizeMm * 0.3, y: yMm }, { x: xMm, y: yMm + sizeMm * 0.25 }, { x: xMm - sizeMm * 0.3, y: yMm }], close: true },
  { kind: 'text', layer, x: xMm, y: yMm - sizeMm - 1.5, text: 'N (grid)', heightMm: 2.5, anchor: 'middle' },
];

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

export const buildTitleBlockItems = (sheet: DraftSheet, layer: string): { items: ExportItem[]; unknownTokens: string[] } => {
  const items: ExportItem[] = [];
  const unknownTokens: string[] = [];
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

export interface BuildSceneArgs {
  draft: DraftDocument;
  sheetId: string;
  project: CadProject;
  modelLabels?: ModelLabelPlacement[];
  paperTexts?: PaperTextPlacement[];
  paperExtras?: ExportItem[];
}

// Throws only when the sheet itself is missing (essential object). Broken
// label refs and unknown tokens become warnings; the export still completes.
export const buildExportSheetScene = (args: BuildSceneArgs): { scene: ExportSheetScene; warnings: ExportWarning[] } => {
  const warnings: ExportWarning[] = [];
  const sheet = args.draft.sheets.find((entry) => entry.id === args.sheetId);
  if (!sheet) throw new Error(`export: sheet ${args.sheetId} not found`);
  const clips: ExportClip[] = [];
  const items: ExportItem[] = [];
  const display = buildCadDisplayScene(args.project);
  const sorted = [...display.primitives].sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));

  sheet.viewports.forEach((viewport, index) => {
    const plan = asPlanViewport(viewport);
    const clipId = `viewport-${index}`;
    clips.push({ id: clipId, xMm: plan.paperXmm, yMm: plan.paperYmm, widthMm: plan.paperWidthMm, heightMm: plan.paperHeightMm });
    const hidden = new Set(
      Object.entries(plan.layerOverrides ?? {})
        .filter(([, override]) => override.visible === false)
        .map(([layerId]) => layerId),
    );
    const toPaper = (x: number, y: number): { xMm: number; yMm: number } => modelToPaperPoint(x, y, plan);
    sorted
      .filter((primitive) => !hidden.has(primitive.layerId))
      .forEach((primitive) => {
        try {
          items.push(...primitiveToPaper(primitive, toPaper, clipId));
        } catch {
          warnings.push({ code: 'SKIPPED_ENTITY', message: `skipped entity ${primitive.sourceEntityId}` });
        }
      });
    items.push({ kind: 'rect', layer: 'paper-frame', x: plan.paperXmm, y: plan.paperYmm, width: plan.paperWidthMm, height: plan.paperHeightMm });
    const toPaperForLabels = toPaper;
    (args.modelLabels ?? []).forEach((label) => {
      if (label.broken || label.text == null) {
        warnings.push({ code: 'BROKEN_REFERENCE', message: `label ${label.id} has a broken reference` });
      }
      const p = toPaperForLabels(label.xModel, label.yModel);
      items.push({
        kind: 'text',
        layer: label.layerId ?? 'labels',
        clipId,
        x: p.xMm,
        y: p.yMm,
        text: label.broken || label.text == null ? BROKEN_REFERENCE_TEXT : label.text,
        heightMm: label.heightMm ?? 2.5,
        anchor: 'middle',
      });
    });
  });

  const title = buildTitleBlockItems(sheet, 'title-block');
  items.push(...title.items);
  title.unknownTokens.forEach((token) => {
    warnings.push({ code: 'UNKNOWN_TOKEN', message: `unknown sheet token {${token}}` });
  });
  (args.paperTexts ?? []).forEach((placement) => {
    items.push({
      kind: 'text',
      layer: placement.layerId ?? 'paper-text',
      x: placement.xMm,
      y: placement.yMm,
      text: placement.text,
      heightMm: placement.heightMm ?? 3,
      anchor: placement.anchor,
    });
  });
  items.push(...(args.paperExtras ?? []));

  return {
    scene: { sheetId: sheet.id, sheetName: sheet.name, widthMm: sheet.widthMm, heightMm: sheet.heightMm, clips, items },
    warnings,
  };
};
