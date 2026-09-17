import { buildCadDisplayScene } from './cadRenderer';
import type { CadDisplayPrimitive } from './cadDisplayTypes';
import { resolveCadEntityAppearance } from './cadAppearance';
import { BROKEN_REFERENCE_TEXT } from './cadLabelEngine';
import { resolveEffectiveColor } from './resolveEffectiveColor';
import { finalizeExportResult, type ExportResult, type ExportWarning, type ExportWarningCode } from './exportResult';

export type { ExportResult, ExportWarning, ExportWarningCode };
import type { DraftSheet, DraftDocument } from './cadDraftTypes';
import { expandSheetTokens, asPlanViewport, buildSheetTokenContext } from './cadSheets';
import { buildTableFragmentItems } from './cadExportTables';
import type { CadProject } from './cadTypes';

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
  /** Resolved stroke color (hex). Absent only on hand-built scenes. */
  stroke?: string;
  /** Resolved fill color (hex). */
  fill?: string;
  /** SVG dash pattern from the source line type. */
  dash?: string;
  /** Source entity for disposition tracking; labels/paper items omit it. */
  sourceEntityId?: string;
  /** Resolved line weight in mm (from the source style or fallback). */
  widthMm?: number;
  /** Resolved opacity 0..1 (from entity/layer transparency); absent = opaque. */
  opacity?: number;
}

export type ExportItem =
  | (ExportBase & { kind: 'line'; x1: number; y1: number; x2: number; y2: number })
  | (ExportBase & { kind: 'polyline'; points: Array<{ x: number; y: number }>; close: boolean })
  | (ExportBase & { kind: 'rect'; x: number; y: number; width: number; height: number })
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
  /** Presentation-only paper-mm nudge applied after projection. */
  offsetMm?: { dxMm?: number; dyMm?: number };
  rotationDeg?: number;
  /** Presentation-only leader from the source point to the placed text. */
  leader?: { enabled?: boolean; elbowMm?: number; lineweightMm?: number };
  /** Per-viewport overrides keyed by viewport id; manual always wins. */
  viewportOverrides?: Record<string, { dxMm?: number; dyMm?: number; rotationDeg?: number; visible?: boolean }>;
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

// Paper-mm dash from a viewport-only drawing-unit pattern: the pattern
// already includes linetypeScale, so only the viewport model→paper factor
// (1000 / scaleDenominator, the same k as modelToPaperPoint) applies.
// Continuous patterns (absent/empty) stay dash-free, byte-identical.
const dashPatternToPaperMm = (pattern: number[] | undefined, unitsToPaperMm: number): string | undefined => {
  if (pattern == null || pattern.length === 0) return undefined;
  if (!Number.isFinite(unitsToPaperMm) || unitsToPaperMm <= 0) return undefined;
  const parts = pattern.map((entry) => Math.round(entry * unitsToPaperMm * 1000) / 1000);
  if (parts.some((entry) => !Number.isFinite(entry) || entry < 0)) return undefined;
  return parts.join(' ');
};

// Color flows from the display primitive (screen-resolved: style override →
// style → layer → default) into every export item, so SVG/PDF match the
// screen. strokeWidth maps to widthMm; dash passes through when present,
// else falls back to the viewport dash pattern scaled to paper mm.
const primitiveToPaper = (
  primitive: CadDisplayPrimitive,
  toPaper: (_x: number, _y: number) => { xMm: number; yMm: number },
  clipId: string,
  rotationDeg = 0,
  unitsToPaperMm: number,
): ExportItem[] => {
  const layer = primitive.layerId;
  const sourceEntityId = primitive.sourceEntityId;
  const stroke = primitive.stroke;
  const dash = primitive.strokeDasharray ?? dashPatternToPaperMm(primitive.dashPatternUnits, unitsToPaperMm);
  const paint = {
    stroke,
    ...(dash ? { dash } : {}),
    ...(primitive.opacity != null ? { opacity: primitive.opacity } : {}),
    sourceEntityId,
  };
  const widthOf = (width: number | undefined): { widthMm?: number } =>
    width != null ? { widthMm: width } : {};
  switch (primitive.kind) {
    case 'line': {
      const [a, b] = primitive.points;
      const pa = toPaper(a.x, a.y);
      const pb = toPaper(b.x, b.y);
      return [{ kind: 'line', layer, clipId, x1: pa.xMm, y1: pa.yMm, x2: pb.xMm, y2: pb.yMm, ...paint, ...widthOf(primitive.strokeWidth) }];
    }
    case 'point': {
      const p = toPaper(primitive.point.x, primitive.point.y);
      return [{ kind: 'circle', layer, clipId, cx: p.xMm, cy: p.yMm, r: primitive.radius, ...paint, ...(primitive.fill ? { fill: primitive.fill } : {}) }];
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
          ...paint,
          ...widthOf(primitive.strokeWidth),
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
          ...paint,
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
          ...paint,
          ...widthOf(primitive.strokeWidth),
        },
      ];
    }
    default:
      return [];
  }
};

export const draftLabelsToPlacements = (labels: DraftDocument['labels']): ModelLabelPlacement[] =>
  (labels ?? []).map((label) => ({
    id: label.id,
    text: label.overrideText ?? label.text,
    xModel: label.xModel,
    yModel: label.yModel,
    heightMm: label.heightMm,
    layerId: label.layerId,
    ...(label.rotationDeg != null ? { rotationDeg: label.rotationDeg } : {}),
    ...(label.leader != null ? { leader: { ...label.leader } } : {}),
    ...(label.viewportOverrides != null ? { viewportOverrides: { ...label.viewportOverrides } } : {}),
  }));

// Per-viewport label resolution shared by SVG/PDF (scene) and layout DXF:
// one definition so all deliverables place the same text identically.
// Manual per-viewport overrides win over base offsets; hidden labels
// (visible === false) emit nothing. Leaders are presentation-only lines
// from the source point to the placed text; geometry is never touched.
export const buildPaperLabelItems = (
  labels: ModelLabelPlacement[],
  viewportId: string,
  toPaper: (_x: number, _y: number) => { xMm: number; yMm: number },
  clipId?: string,
): { items: ExportItem[]; brokenIds: string[] } => {
  const items: ExportItem[] = [];
  const brokenIds: string[] = [];
  const ordered = [...labels].sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
  ordered.forEach((label) => {
    const override = label.viewportOverrides?.[viewportId];
    if (override?.visible === false) return;
    if (label.broken || label.text == null) brokenIds.push(label.id);
    const p = toPaper(label.xModel, label.yModel);
    const dx = override?.dxMm ?? label.offsetMm?.dxMm ?? 0;
    const dy = override?.dyMm ?? label.offsetMm?.dyMm ?? 0;
    const x = p.xMm + dx;
    const y = p.yMm + dy;
    if (label.leader?.enabled && (dx !== 0 || dy !== 0)) {
      // Two-segment elbow: horizontal jog of elbowMm from the source point
      // toward the text, then straight to the text. elbowMm clamps to |dx|
      // so the jog never overshoots; dx === 0 (or no positive elbow) stays
      // a single straight segment. All serializers share this resolver, so
      // the elbow renders identically in scene, SVG, PDF, and layout-DXF.
      const elbowMm = label.leader.elbowMm ?? 0;
      if (elbowMm > 0 && dx !== 0) {
        const jog = Math.sign(dx) * Math.min(elbowMm, Math.abs(dx));
        items.push({
          kind: 'polyline',
          layer: label.layerId ?? 'labels',
          ...(clipId ? { clipId } : {}),
          points: [{ x: p.xMm, y: p.yMm }, { x: p.xMm + jog, y: p.yMm }, { x, y }],
          close: false,
          widthMm: label.leader.lineweightMm,
        });
      } else {
        items.push({ kind: 'line', layer: label.layerId ?? 'labels', ...(clipId ? { clipId } : {}), x1: p.xMm, y1: p.yMm, x2: x, y2: y, widthMm: label.leader.lineweightMm });
      }
    }
    items.push({
      kind: 'text',
      layer: label.layerId ?? 'labels',
      ...(clipId ? { clipId } : {}),
      x,
      y,
      text: label.broken || label.text == null ? BROKEN_REFERENCE_TEXT : label.text,
      heightMm: label.heightMm ?? 2.5,
      anchor: 'middle',
      ...(override?.rotationDeg ?? label.rotationDeg
        ? { rotationDeg: override?.rotationDeg ?? label.rotationDeg }
        : {}),
    });
  });
  return { items, brokenIds };
};
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

// One renderer for preview, SVG, PDF, and layout-DXF: identical paper-mm
// numerics everywhere. When the sheet references a visual template, its
// elements render verbatim; otherwise the legacy bar renders.
export const buildTitleBlockItems = (
  sheet: DraftSheet,
  layer: string,
  template?: import('./cadDraftTypes').DraftTitleBlockDefinition,
  tokenContext?: import('./cadSheets').SheetTokenContext,
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

export interface BuildSceneArgs {
  draft: DraftDocument;
  sheetId: string;
  project: CadProject;
  modelLabels?: ModelLabelPlacement[];
  paperTexts?: PaperTextPlacement[];
  paperExtras?: ExportItem[];
}

// Exporters consume the authoritative resolver (spec §5): primitive colors
// and widths arrive legacy-resolved (style → layer), so items whose source
// entity carries explicit 18C appearance intent are corrected here to the
// resolved values — idempotent once the renderer resolves them too.
// Transparency (new in 18C, never renderer-resolved before) always applies.
const correctPlotAppearance = (item: ExportItem, project: CadProject): ExportItem => {
  if (item.sourceEntityId == null) return item;
  const entity = project.entities.find((entry) => entry.id === item.sourceEntityId);
  if (!entity) return item;
  const layer = project.layers.find((entry) => entry.id === entity.layerId) ?? null;
  const resolved = resolveCadEntityAppearance({ entity, layer, styleLibrary: project.styleLibrary });
  let next = item;
  if (entity.appearance?.color != null && next.stroke !== resolved.color) {
    next = { ...next, stroke: resolved.color };
    if (next.kind === 'circle' && next.fill != null && next.fill !== 'none') {
      next = { ...next, fill: resolved.color };
    }
  }
  if (entity.appearance?.lineweightMm != null && next.kind !== 'text' && 'widthMm' in next && next.widthMm !== resolved.lineweightMm) {
    next = { ...next, widthMm: resolved.lineweightMm };
  }
  if (resolved.transparency > 0 && next.opacity == null) {
    next = { ...next, opacity: Math.round((1 - resolved.transparency) * 1000) / 1000 };
  }
  return next;
};

// Paper-space items that carry no resolved color (labels, frames, title
// block, caller paper extras) inherit their layer color through the shared
// resolver, so every scene item reaches SVG/PDF with an explicit stroke.
// Items that already carry a stroke (primitive-derived, caller-painted)
// are never overwritten.
const backfillItemColor = (
  item: ExportItem,
  layerColorOf: (_layerId: string) => string | undefined,
): ExportItem => {
  if (item.stroke != null) return item;
  const stroke = resolveEffectiveColor({ layer: layerColorOf(item.layer) });
  if (item.kind === 'rect' && item.fill != null) return { ...item, stroke };
  return { ...item, stroke };
};

// Throws only when the sheet itself is missing (essential object). Broken
// label refs and unknown tokens become warnings; the export still completes.
// Full unified result: entity disposition lists included, no silent drops.
export const buildExportSheetSceneWithResult = (args: BuildSceneArgs): ExportResult<ExportSheetScene> => {
  const warnings: ExportWarning[] = [];
  const exportedEntityIds: string[] = [];
  const omittedEntityIds: string[] = [];
  const approximatedEntityIds: string[] = [];
  const sheet = args.draft.sheets.find((entry) => entry.id === args.sheetId);
  if (!sheet) throw new Error(`export: sheet ${args.sheetId} not found`);
  const clips: ExportClip[] = [];
  const items: ExportItem[] = [];
  const display = buildCadDisplayScene(args.project);
  const sorted = [...display.primitives].sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));

  // Layers govern output: visible=false hides (a viewport visible=true
  // override re-shows for that viewport), frozen hides through the same
  // filter path as OFF (spec §6; the drawing-standard difference is
  // persistence, not current viewport result), but printable=false is
  // unconditional — excluded from SVG + PDF regardless of overrides.
  const layerFlagged = (layerId: string, flag: 'visible' | 'printable'): boolean => {
    const layers = [
      args.project.layers.find((layer) => layer.id === layerId),
      args.draft.layers.find((layer) => layer.id === layerId),
    ];
    if (flag === 'visible') {
      return layers.some((layer) => layer != null && (layer.visible === false || layer.frozen === true));
    }
    return layers.some((layer) => layer != null && layer.printable === false);
  };
  const layerColorOf = (layerId: string): string | undefined =>
    args.project.layers.find((layer) => layer.id === layerId)?.color ??
    args.draft.layers.find((layer) => layer.id === layerId)?.color;
  // Non-circle point symbols (square/triangle/cross/x) render as circles:
  // explicit approximation, never silent.
  const approximatedShapeOf = (entityId: string): boolean => {
    const entity = args.project.entities.find((entry) => entry.id === entityId);
    if (entity?.type !== 'survey-point' || entity.styleId == null) return false;
    const style = args.project.styleLibrary.styles.find((entry) => entry.id === entity.styleId);
    const shape = args.project.styleLibrary.pointSymbols.find((entry) => entry.id === style?.pointSymbolId)?.shape;
    return shape != null && shape !== 'circle' && shape !== 'dot';
  };
  const noteApproximated = (entityId: string): void => {
    if (approximatedEntityIds.includes(entityId)) return;
    approximatedEntityIds.push(entityId);
    warnings.push({ code: 'POINT_SYMBOL_APPROXIMATED', message: `point ${entityId} symbol approximated as circle`, entityId });
  };
  const persistedLabels: ModelLabelPlacement[] = draftLabelsToPlacements(args.draft.labels);
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
          const produced = primitiveToPaper(primitive, toPaper, clipId, plan.rotationDeg, 1000 / plan.scaleDenominator);
          if (produced.length === 0) {
            omittedEntityIds.push(primitive.sourceEntityId);
            warnings.push({ code: 'SKIPPED_ENTITY', message: `skipped entity ${primitive.sourceEntityId} (no export geometry)`, entityId: primitive.sourceEntityId });
            return;
          }
          items.push(...produced);
          exportedEntityIds.push(primitive.sourceEntityId);
          if (primitive.kind === 'point' && approximatedShapeOf(primitive.sourceEntityId)) {
            noteApproximated(primitive.sourceEntityId);
          }
        } catch {
          omittedEntityIds.push(primitive.sourceEntityId);
          warnings.push({ code: 'SKIPPED_ENTITY', message: `skipped entity ${primitive.sourceEntityId}`, entityId: primitive.sourceEntityId });
        }
      });
    items.push({ kind: 'rect', layer: 'paper-frame', x: plan.paperXmm, y: plan.paperYmm, width: plan.paperWidthMm, height: plan.paperHeightMm });
    const toPaperForLabels = toPaper;
    const placed = buildPaperLabelItems(
      effectiveLabels.filter((label) => !isHidden(label.layerId ?? 'labels')),
      plan.id,
      toPaperForLabels,
      clipId,
    );
    placed.brokenIds.forEach((id) => {
      warnings.push({ code: 'BROKEN_REFERENCE', message: `label ${id} has a broken reference` });
    });
    items.push(...placed.items);
  });

  const sheetIndex = args.draft.sheets.findIndex((entry) => entry.id === sheet.id);
  const template = sheet.titleBlockId
    ? args.draft.titleBlockDefinitions.find((entry) => entry.id === sheet.titleBlockId)
    : undefined;
  const title = buildTitleBlockItems(sheet, 'title-block', template, buildSheetTokenContext({
    sheet,
    sheetNumber: sheetIndex + 1,
    projectName: args.project.name,
  }));
  items.push(...title.items);
  title.unknownTokens.forEach((token) => {
    warnings.push({ code: 'UNKNOWN_TOKEN', message: `unknown sheet token {${token}}` });
  });
  // Persisted continued-table fragments render from logical rows + row
  // ranges (deterministic order, repeated headers, Continued marker).
  items.push(...buildTableFragmentItems(args.draft, sheet.id));
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

  // Entities that yield zero display primitives (degenerate geometry such
  // as a single-vertex polyline) would otherwise vanish silently: they are
  // omitted with an explicit warning. Intentionally hidden content
  // (invisible entities/layers, non-printable layers) is excluded, and
  // viewport-override hiding never triggers this — hidden entities still
  // own display primitives, they are just filtered per viewport.
  const primitiveCounts = new Map<string, number>();
  display.primitives.forEach((primitive) => {
    primitiveCounts.set(primitive.sourceEntityId, (primitiveCounts.get(primitive.sourceEntityId) ?? 0) + 1);
  });
  args.project.entities.forEach((entity) => {
    if (!entity.visible) return;
    if ((primitiveCounts.get(entity.id) ?? 0) > 0) return;
    if (omittedEntityIds.includes(entity.id)) return;
    if (layerFlagged(entity.layerId, 'visible') || layerFlagged(entity.layerId, 'printable')) return;
    omittedEntityIds.push(entity.id);
    warnings.push({ code: 'SKIPPED_ENTITY', message: `skipped entity ${entity.id} (no export geometry)`, entityId: entity.id });
  });

  const painted = items.map((item) => backfillItemColor(correctPlotAppearance(item, args.project), layerColorOf));
  return finalizeExportResult({
    output: { sheetId: sheet.id, sheetName: sheet.name, widthMm: sheet.widthMm, heightMm: sheet.heightMm, clips, items: painted },
    warnings,
    errors: [],
    exportedEntityIds,
    omittedEntityIds,
    approximatedEntityIds,
  });
};

// Legacy shape: thin wrapper so the dev harness and existing callers keep
// compiling. New code should prefer buildExportSheetSceneWithResult.
export const buildExportSheetScene = (args: BuildSceneArgs): { scene: ExportSheetScene; warnings: ExportWarning[] } => {
  const result = buildExportSheetSceneWithResult(args);
  return { scene: result.output, warnings: result.warnings };
};
