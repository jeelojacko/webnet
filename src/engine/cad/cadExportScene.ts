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
// Rotation θ (deg, clockwise as seen on the sheet) turns content about the
// viewport midpoint: paper = C + Rot(θ)·(north-up offset), matching the
// sheet preview convention (modelCenter lands at viewport center).
// NOTE (Phase 13B): this changed θ=0 output vs the old top-left anchor —
// every point shifts by half the viewport (+w/2, +h/2); distances, scale,
// and rotation behavior are unchanged. Goldens were regenerated.
export const modelToPaperPoint = (
  xModel: number,
  yModel: number,
  viewport: { modelCenterX: number; modelCenterY: number; scaleDenominator: number; paperXmm: number; paperYmm: number; paperWidthMm?: number; paperHeightMm?: number },
  rotationDeg = 0,
): { xMm: number; yMm: number } => {
  const k = 1000 / viewport.scaleDenominator;
  const qx = (xModel - viewport.modelCenterX) * k;
  const qy = -(yModel - viewport.modelCenterY) * k;
  const cx = viewport.paperXmm + (viewport.paperWidthMm ?? 0) / 2;
  const cy = viewport.paperYmm + (viewport.paperHeightMm ?? 0) / 2;
  if (rotationDeg === 0) return { xMm: cx + qx, yMm: cy + qy };
  const a = (rotationDeg * Math.PI) / 180;
  const cos = Math.cos(a);
  const sin = Math.sin(a);
  return {
    xMm: cx + qx * cos - qy * sin,
    yMm: cy + qx * sin + qy * cos,
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
  rotationDeg = 0,
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
      // Axis endpoints transform as vectors: under viewport rotation the
      // offset rotates rigidly, so per-component abs would collapse (e.g.
      // rx→0 at 90°). Hypot recovers the true semi-axis lengths.
      return [
        {
          kind: 'ellipse',
          layer,
          clipId,
          cx: c.xMm,
          cy: c.yMm,
          rx: Math.hypot(ex.xMm - c.xMm, ex.yMm - c.yMm),
          ry: Math.hypot(ey.xMm - c.xMm, ey.yMm - c.yMm),
          rotationDeg: primitive.thetaDeg + rotationDeg,
        },
      ];
    }
    default:
      return [];
  }
};

// North arrow (grid north only) and scale bar are paper-space items built by
// these helpers so fixture, SVG, and PDF share one definition.
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

  // Layers govern output: visible=false hides (a viewport visible=true
  // override re-shows for that viewport), but printable=false is
  // unconditional — excluded from SVG + PDF regardless of overrides.
  const layerFlagged = (layerId: string, flag: 'visible' | 'printable'): boolean => {
    const inProject = args.project.layers.find((layer) => layer.id === layerId);
    const inDraft = args.draft.layers.find((layer) => layer.id === layerId);
    return [inProject, inDraft].some((layer) => layer != null && layer[flag] === false);
  };
  const persistedLabels: ModelLabelPlacement[] = (args.draft.labels ?? []).map((label) => ({
    id: label.id,
    text: label.overrideText ?? label.text,
    xModel: label.xModel,
    yModel: label.yModel,
    heightMm: label.heightMm,
    layerId: label.layerId,
  }));
  const effectiveLabels = args.modelLabels ?? persistedLabels;
  sheet.viewports.forEach((viewport) => {
    const plan = asPlanViewport(viewport);
    const clipId = `viewport-${plan.id}`;
    const customClip =
      plan.clipWidthMm != null && plan.clipHeightMm != null
        ? {
            xMm: plan.clipXmm ?? plan.paperXmm,
            yMm: plan.clipYmm ?? plan.paperYmm,
            widthMm: plan.clipWidthMm,
            heightMm: plan.clipHeightMm,
          }
        : { xMm: plan.paperXmm, yMm: plan.paperYmm, widthMm: plan.paperWidthMm, heightMm: plan.paperHeightMm };
    clips.push({ id: clipId, ...customClip });
    const hidden = new Set(
      Object.entries(plan.layerOverrides ?? {})
        .filter(([, override]) => override.visible === false)
        .map(([layerId]) => layerId),
    );
    const shown = new Set(
      Object.entries(plan.layerOverrides ?? {})
        .filter(([, override]) => override.visible === true)
        .map(([layerId]) => layerId),
    );
    const isHidden = (layerId: string): boolean =>
      hidden.has(layerId) ||
      (layerFlagged(layerId, 'visible') && !shown.has(layerId)) ||
      layerFlagged(layerId, 'printable');
    const toPaper = (x: number, y: number): { xMm: number; yMm: number } =>
      modelToPaperPoint(x, y, plan, plan.rotationDeg);
    sorted
      .filter((primitive) => !isHidden(primitive.layerId))
      .forEach((primitive) => {
        try {
          items.push(...primitiveToPaper(primitive, toPaper, clipId, plan.rotationDeg));
        } catch {
          warnings.push({ code: 'SKIPPED_ENTITY', message: `skipped entity ${primitive.sourceEntityId}` });
        }
      });
    items.push({ kind: 'rect', layer: 'paper-frame', x: plan.paperXmm, y: plan.paperYmm, width: plan.paperWidthMm, height: plan.paperHeightMm });
    const toPaperForLabels = toPaper;
    effectiveLabels
      .filter((label) => !isHidden(label.layerId ?? 'labels'))
      .forEach((label) => {
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
