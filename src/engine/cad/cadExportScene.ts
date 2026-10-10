import { buildCadDisplayScene } from './cadRenderer';
import { cadSignedSweepDeg } from './cadGeometry';
import type { CadDisplayPrimitive } from './cadDisplayTypes';
import { describePointSymbolShape } from './cadPointSymbolShape';
import { surveyPointMarker } from './cadRendererStyle';
import { materializeBoundPointLabel } from './cadPointLabelStyles';
import { resolveCadEntityAppearance, type ResolvedCadEntityAppearance } from './cadAppearance';
import { buildCadProjectLookup, type CadProjectLookup } from './cadProjectLookup';
import { BROKEN_REFERENCE_TEXT } from './cadLabelEngine';
import { resolveEffectiveColor } from './resolveEffectiveColor';
import { finalizeExportResult, type ExportResult, type ExportWarning, type ExportWarningCode } from './exportResult';

export type { ExportResult, ExportWarning, ExportWarningCode };
import type { DraftDocument } from './cadDraftTypes';
import {
  asPlanViewport,
  buildSheetTokenContext,
  northArrowAngleDeg,
} from './cadSheets';
import { buildTableFragmentItems } from './cadExportTables';
import { buildAnalysisSheetItems, type CadAnalysisExportInput } from './cadAnalysisExportScene';
import { buildGradingSheetItems, type CadGradingExportInput } from './cadGradingExportScene';
import { buildGroupSheetItems, type CadGradingGroupExportInput } from './cadGradingGroupExportScene';
import type { CadEntity, CadProject } from './cadTypes';

export interface ExportClip {
  id: string;
  xMm: number;
  yMm: number;
  widthMm: number;
  heightMm: number;
}

import type { ExportItem } from './cadExportItemTypes';

export type { ExportBase, ExportItem } from './cadExportItemTypes';

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
  // Traversal-signed sweep: display arc primitives carry the parcel course
  // traversal direction (CW courses arrive with endDeg < startDeg). A
  // CCW-only normalization would tessellate the complementary major arc
  // (e.g. -47° becomes +313°) — a full-circle ghost on sheets/exports.
  const signedSweep = cadSignedSweepDeg(startDeg, endDeg);
  const sweep = Math.abs(signedSweep) < 1e-9 ? 360 : signedSweep;
  const steps = Math.max(8, Math.ceil((Math.abs(sweep) / 360) * ARC_STEPS));
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
      // Honest marker shapes (shared geometry with the screen preview):
      // circle/dot stay circles; every other shape rides as a closed
      // polyline or line items. The SVG/PDF writers represent all six, so
      // no POINT_SYMBOL_APPROXIMATED warning is emitted here — only writers
      // that cannot represent a shape warn (DXF: POINT+TEXT, always).
      // Radius keeps the pinned drawing-units-as-paper-mm semantics.
      const geometry = describePointSymbolShape(primitive.shape, primitive.radius);
      if (geometry.kind === 'circle' || geometry.kind === 'dot') {
        const p = toPaper(primitive.point.x, primitive.point.y);
        return [{ kind: 'circle', layer, clipId, cx: p.xMm, cy: p.yMm, r: primitive.radius, ...paint, ...(primitive.fill ? { fill: primitive.fill } : {}) }];
      }
      if (geometry.kind === 'polygon') {
        return [{
          kind: 'polyline',
          layer,
          clipId,
          points: geometry.points.map((offset) => {
            const q = toPaper(primitive.point.x + offset.x, primitive.point.y + offset.y);
            return { x: q.xMm, y: q.yMm };
          }),
          close: true,
          ...paint,
          ...(primitive.fill ? { fill: primitive.fill } : {}),
        }];
      }
      return geometry.segments.map(([from, to]) => {
        const pa = toPaper(primitive.point.x + from.x, primitive.point.y + from.y);
        const pb = toPaper(primitive.point.x + to.x, primitive.point.y + to.y);
        return { kind: 'line' as const, layer, clipId, x1: pa.xMm, y1: pa.yMm, x2: pb.xMm, y2: pb.yMm, ...paint };
      });
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
    case 'circle': {
      const c = toPaper(primitive.center.x, primitive.center.y);
      return [
        {
          kind: 'circle',
          layer,
          clipId,
          cx: c.xMm,
          cy: c.yMm,
          r: primitive.radius * unitsToPaperMm,
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
          // Phase 18P: forward viewport text rotation (curve/bearing/dim
          // labels) so SVG/PDF match the screen. Absent/zero stays absent
          // so non-rotated fixtures serialize byte-identically.
          ...(primitive.rotationDeg ? { rotationDeg: primitive.rotationDeg } : {}),
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
    case 'band': {
      // Phase C2 width band: ONE filled closed polyline in paper space, so
      // SVG/PDF render the exact model-space band the viewport shows
      // (never a pixel strokeWidth). Points transform through the same
      // viewport projection as every other primitive.
      const points = primitive.points.map((point) => {
        const q = toPaper(point.x, point.y);
        return { x: q.xMm, y: q.yMm };
      });
      if (points.length < 3) return [];
      return [
        {
          kind: 'polyline',
          layer,
          clipId,
          points,
          close: true,
          fill: primitive.fill,
          ...paint,
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
// Phase 19B Round 2C — canonical paper builders live in cadSheetScene.ts
// (moved verbatim; this module re-exports them so scene/parity/DXF callers
// are unaffected). deriveSheetScene stays here: it orchestrates the
// model-projection and label/table builders owned by this module.
import {
  buildTitleBlockItems,
  buildViewportPaperSymbols,
  normalizedAngle,
} from './cadSheetScene';
import type { DerivedScaleBar, DerivedViewportScene } from './cadSheetScene';
export {
  buildNorthArrowItems,
  buildScaleBarItems,
  buildNorthArrowObjectItems,
  buildScaleBarObjectItems,
  buildTitleBlockItems,
  buildViewportPaperSymbols,
  linkedPaperObjectViewportId,
} from './cadSheetScene';
export type {
  DerivedScaleBar,
  DerivedViewportScene,
  SheetPaperObjectFields,
  ViewportPaperSymbols,
} from './cadSheetScene';

// Layer visibility/printable filtering also applies to analysis maps: a map
// whose owning layer is hidden or non-printable contributes no fills/legend,
// without changing its derived status. Filters both layers and legends so the
// builder never re-emits geometry for a hidden layer.
const filterAnalysisInput = (
  input: CadAnalysisExportInput | undefined,
  isVisible: (_layerId: string) => boolean,
): CadAnalysisExportInput | undefined => {
  if (!input) return undefined;
  const mapLayer = (map: { layerId?: string }, fallback: string): string => map.layerId ?? fallback;
  return {
    layers: (input.layers ?? []).filter((layer) => isVisible(mapLayer(layer.map, 'analysis'))),
    legends: (input.legends ?? []).filter((entry) =>
      isVisible(mapLayer(entry.map ?? {}, 'analysis-legend')),
    ),
  };
};

export interface BuildSceneArgs {
  draft: DraftDocument;
  sheetId: string;
  project: CadProject;
  modelLabels?: ModelLabelPlacement[];
  paperTexts?: PaperTextPlacement[];
  paperExtras?: ExportItem[];
  /**
   * Phase 18U: CURRENT analysis-map fills/boundaries + legends, projected
   * through the same viewport transform as the model geometry. Session-only
   * derived regions; absent = legacy scene unchanged.
   */
  analysis?: CadAnalysisExportInput;
  /**
   * Phase 20B: CURRENT grading daylight + triangle fill, projected through
   * the same viewport transform as the model geometry. Session-only derived
   * regions; absent = legacy scene unchanged.
   */
  grading?: CadGradingExportInput;
  /**
   * Phase 20C: CURRENT grading-group triangle fill + merged daylight, with
   * optional plot-intended corner seams. Session-only derived regions;
   * absent = legacy scene unchanged.
   */
  gradingGroups?: CadGradingGroupExportInput;
  /**
   * Phase 20A: presentation-only feature-line Z/grade labels (never
   * geometry, never persisted). Absent = plan geometry only.
   */
  featureLineLabels?: boolean;
}

// Exporters consume the authoritative resolver (spec §5): primitive colors
// and widths arrive legacy-resolved (style → layer), so items whose source
// entity carries explicit 18C appearance intent are corrected here to the
// resolved values — idempotent once the renderer resolves them too.
// Transparency (new in 18C, never renderer-resolved before) always applies.
//
// Phase 18P: source entity/layer/style resolution goes through the lookup
// (O(1)) and the resolved triple is memoized per sourceEntityId so a source
// that produced many items (dimensions, leaders, block children) resolves
// once per export pass.
type SourceAppearance = { entity: CadEntity; resolved: ResolvedCadEntityAppearance };

const resolveSourceAppearance = (
  entityId: string,
  lookup: CadProjectLookup,
  memo: Map<string, SourceAppearance | null>,
): SourceAppearance | null => {
  const cached = memo.get(entityId);
  if (cached !== undefined) return cached;
  const entity = lookup.entityById.get(entityId);
  const value =
    entity != null
      ? {
          entity,
          resolved: resolveCadEntityAppearance({
            entity,
            layer: lookup.layerById.get(entity.layerId) ?? null,
            styleById: lookup.styleById,
          }),
        }
      : null;
  memo.set(entityId, value);
  return value;
};

const correctPlotAppearance = (
  item: ExportItem,
  lookup: CadProjectLookup,
  memo: Map<string, SourceAppearance | null>,
): ExportItem => {
  if (item.sourceEntityId == null) return item;
  const source = resolveSourceAppearance(item.sourceEntityId, lookup, memo);
  if (!source) return item;
  const { entity, resolved } = source;
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
//
// Z-order (§62), deterministic and identical for scene/SVG/PDF/layout-DXF:
// viewport frame → projected model/analysis geometry → viewport-linked
// annotations (labels, north arrow, scale bar) → paper notes/tables → title
// block. Caller-supplied `paperExtras` stay last for backward compatibility
// with the pre-19B scene contract.
const deriveSheetSceneInternal = (
  args: BuildSceneArgs,
): ExportResult<ExportSheetScene> & { viewports: DerivedViewportScene[] } => {
  const warnings: ExportWarning[] = [];
  const exportedEntityIds: string[] = [];
  const omittedEntityIds: string[] = [];
  const omittedEntityIdSet = new Set<string>();
  const recordOmitted = (entityId: string, message: string): void => {
    omittedEntityIds.push(entityId);
    omittedEntityIdSet.add(entityId);
    warnings.push({ code: 'SKIPPED_ENTITY', message, entityId });
  };
  const approximatedEntityIds: string[] = [];
  const sheet = args.draft.sheets.find((entry) => entry.id === args.sheetId);
  if (!sheet) throw new Error(`export: sheet ${args.sheetId} not found`);
  const clips: ExportClip[] = [];
  const items: ExportItem[] = [];
  const derivedViewports: DerivedViewportScene[] = [];
  // Phase 18P: one derived project index + one draft-layer index for the
  // whole export pass; the corrected appearance triple is memoized per
  // sourceEntityId below.
  const lookup = buildCadProjectLookup(args.project);
  const draftLayerById = new Map(args.draft.layers.map((layer) => [layer.id, layer]));
  const sourceAppearanceMemo = new Map<string, SourceAppearance | null>();
  const display = buildCadDisplayScene(args.project, {
    lookup,
    ...(args.featureLineLabels != null ? { featureLineLabels: args.featureLineLabels } : {}),
  });
  const sorted = [...display.primitives].sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));

  // Layers govern output: visible=false hides (a viewport visible=true
  // override re-shows for that viewport), frozen hides through the same
  // filter path as OFF (spec §6; the drawing-standard difference is
  // persistence, not current viewport result), but printable=false is
  // unconditional — excluded from SVG + PDF regardless of overrides.
  const layerFlagged = (layerId: string, flag: 'visible' | 'printable'): boolean => {
    const projectLayer = lookup.layerById.get(layerId);
    const draftLayer = draftLayerById.get(layerId);
    if (flag === 'visible') {
      return (
        (projectLayer != null && (projectLayer.visible === false || projectLayer.frozen === true)) ||
        (draftLayer != null && (draftLayer.visible === false || draftLayer.frozen === true))
      );
    }
    return (
      (projectLayer != null && projectLayer.printable === false) ||
      (draftLayer != null && draftLayer.printable === false)
    );
  };
  const layerColorOf = (layerId: string): string | undefined =>
    lookup.layerById.get(layerId)?.color ?? draftLayerById.get(layerId)?.color;
  // §61: paper objects resolve the drawing layer catalog; NO-PLOT (printable
  // false) wins and frozen/OFF hide, but viewport layer overrides never apply
  // to paper objects.
  const paperLayerHidden = (layerId: string): boolean =>
    layerFlagged(layerId, 'visible') || layerFlagged(layerId, 'printable');
  const paperSymbols = buildViewportPaperSymbols({
    sheet,
    unitsMode: args.draft.precision.unitsMode,
    isHidden: paperLayerHidden,
  });
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
    // Analysis fills sit BENEATH the model linework/annotations (volume-view
    // precedent); the legend rides above it. CURRENT-only gate + dispositions
    // live in the shared builder, so every sheet format agrees.
    const analysisItems = buildAnalysisSheetItems(
      filterAnalysisInput(args.analysis, (layerId) => !isHidden(layerId)),
      toPaper,
      clipId,
    );
    items.push(...analysisItems.items);
    analysisItems.warnings.forEach((warning) => warnings.push(warning));
    // Phase 20B grading fills + daylight sit with the analysis fills beneath
    // the model linework; the CURRENT-only gate + dispositions are shared.
    const gradingInput: CadGradingExportInput | undefined = args.grading
      ? {
          layers: (args.grading.layers ?? []).filter((layer) =>
            !isHidden(layer.grading.layerId ?? 'grading'),
          ),
        }
      : undefined;
    const gradingItems = buildGradingSheetItems(gradingInput, toPaper, clipId);
    items.push(...gradingItems.items);
    gradingItems.warnings.forEach((warning) => warnings.push(warning));
    // Phase 20C grading-group fills + merged daylight ride with the 20B
    // grading fills beneath the model linework; the CURRENT-only gate +
    // dispositions are shared.
    const gradingGroupInput: CadGradingGroupExportInput | undefined = args.gradingGroups
      ? {
          layers: (args.gradingGroups.layers ?? []).filter((layer) =>
            !isHidden(layer.group.layerId ?? 'grading-group'),
          ),
        }
      : undefined;
    const gradingGroupItems = buildGroupSheetItems(gradingGroupInput, toPaper, clipId);
    items.push(...gradingGroupItems.items);
    gradingGroupItems.warnings.forEach((warning) => warnings.push(warning));
    sorted
      .filter((primitive) => !isHidden(primitive.layerId))
      .forEach((primitive) => {
        try {
          const produced = primitiveToPaper(primitive, toPaper, clipId, plan.rotationDeg, 1000 / plan.scaleDenominator);
          if (produced.length === 0) {
            recordOmitted(primitive.sourceEntityId, `skipped entity ${primitive.sourceEntityId} (no export geometry)`);
            return;
          }
          items.push(...produced);
          exportedEntityIds.push(primitive.sourceEntityId);
        } catch {
          recordOmitted(primitive.sourceEntityId, `skipped entity ${primitive.sourceEntityId}`);
        }
      });
    // §60: the viewport border plots only when requested. Legacy viewports
    // that predate `plotFrame` keep the historical always-on frame; an
    // explicit `plotFrame: false` opts out.
    const rawPlotFrame = (viewport as { plotFrame?: boolean }).plotFrame;
    if (rawPlotFrame !== false) {
      items.push({ kind: 'rect', layer: 'paper-frame', x: plan.paperXmm, y: plan.paperYmm, width: plan.paperWidthMm, height: plan.paperHeightMm });
    }
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
    // §47-54: canonical north arrow / scale bar for this viewport, from the
    // same explicit paper objects the layout DXF consumes.
    items.push(...(paperSymbols.itemsByViewport.get(plan.id) ?? []));
    derivedViewports.push({
      viewportId: plan.id,
      name: plan.name,
      paperXmm: plan.paperXmm,
      paperYmm: plan.paperYmm,
      paperWidthMm: plan.paperWidthMm,
      paperHeightMm: plan.paperHeightMm,
      modelCenterX: plan.modelCenterX,
      modelCenterY: plan.modelCenterY,
      scaleDenominator: plan.scaleDenominator,
      rotationDeg: plan.rotationDeg,
      locked: (viewport as { locked?: boolean }).locked === true,
      plotFrame: rawPlotFrame !== false,
      northArrowAngleDeg:
        paperSymbols.northArrowAngleByViewport.get(plan.id) ?? normalizedAngle(northArrowAngleDeg(plan.rotationDeg)),
      hasNorthArrow: paperSymbols.northArrowAngleByViewport.has(plan.id),
      ...(paperSymbols.scaleBarByViewport.get(plan.id) != null
        ? { scaleBar: paperSymbols.scaleBarByViewport.get(plan.id) as DerivedScaleBar }
        : {}),
    });
  });
  // §49: a paper object whose viewport link is missing stays visibly broken.
  items.push(...paperSymbols.brokenItems);
  paperSymbols.warnings.forEach((warning) => warnings.push(warning));

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
  // own display primitives, they are just filtered per viewport. Likewise
  // a No Display point style or No Label label style is an explicit style
  // choice, not degenerate geometry: those entities are excluded here.
  const intentionallyUnplotted = (entityId: string): boolean => {
    const entity = lookup.entityById.get(entityId);
    if (entity?.type === 'survey-point') return surveyPointMarker(args.project, entity, lookup).hidden;
    if (entity?.type === 'text') return materializeBoundPointLabel(entity, args.project, lookup)?.visible === false;
    return false;
  };
  const primitiveCounts = new Map<string, number>();
  display.primitives.forEach((primitive) => {
    primitiveCounts.set(primitive.sourceEntityId, (primitiveCounts.get(primitive.sourceEntityId) ?? 0) + 1);
  });
  args.project.entities.forEach((entity) => {
    if (!entity.visible) return;
    if ((primitiveCounts.get(entity.id) ?? 0) > 0) return;
    if (omittedEntityIdSet.has(entity.id)) return;
    if (layerFlagged(entity.layerId, 'visible') || layerFlagged(entity.layerId, 'printable')) return;
    if (intentionallyUnplotted(entity.id)) return;
    recordOmitted(entity.id, `skipped entity ${entity.id} (no export geometry)`);
  });

  const painted = items.map((item) =>
    backfillItemColor(
      correctPlotAppearance(item, lookup, sourceAppearanceMemo),
      layerColorOf,
    ),
  );
  const finalized = finalizeExportResult({
    output: { sheetId: sheet.id, sheetName: sheet.name, widthMm: sheet.widthMm, heightMm: sheet.heightMm, clips, items: painted },
    warnings,
    errors: [],
    exportedEntityIds,
    omittedEntityIds,
    approximatedEntityIds,
  });
  return { ...finalized, viewports: derivedViewports };
};

/** §106 canonical derived sheet scene: one geometry source for the screen,
 *  SVG, PDF, and layout-DXF. Paper-mm items plus serializable viewport
 *  descriptors (transform, lock, plot frame, north angle, scale bar). */
export interface DerivedSheetScene {
  sheetId: string;
  sheetName: string;
  widthMm: number;
  heightMm: number;
  scene: ExportSheetScene;
  viewports: DerivedViewportScene[];
  warnings: ExportWarning[];
}

export const deriveSheetScene = (args: BuildSceneArgs): DerivedSheetScene => {
  const internal = deriveSheetSceneInternal(args);
  return {
    sheetId: internal.output.sheetId,
    sheetName: internal.output.sheetName,
    widthMm: internal.output.widthMm,
    heightMm: internal.output.heightMm,
    scene: internal.output,
    viewports: internal.viewports,
    warnings: internal.warnings,
  };
};

export const buildExportSheetSceneWithResult = (args: BuildSceneArgs): ExportResult<ExportSheetScene> => {
  const { output, warnings, errors, exportedEntityIds, omittedEntityIds, approximatedEntityIds } =
    deriveSheetSceneInternal(args);
  return { output, warnings, errors, exportedEntityIds, omittedEntityIds, approximatedEntityIds };
};

// Legacy shape: thin wrapper so the dev harness and existing callers keep
// compiling. New code should prefer buildExportSheetSceneWithResult.
export const buildExportSheetScene = (args: BuildSceneArgs): { scene: ExportSheetScene; warnings: ExportWarning[] } => {
  const result = buildExportSheetSceneWithResult(args);
  return { scene: result.output, warnings: result.warnings };
};
