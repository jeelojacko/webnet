import type { CadProject } from '../cadTypes';
import type { ModelLabelPlacement } from '../cadExportScene';
import { entityStyle } from '../cadRendererStyle';
import {
  emptyExportResult,
  finalizeExportResult,
  type ExportResult,
  type ExportWarning,
} from '../exportResult';
import { resolveEffectiveColor as resolveColor } from '../resolveEffectiveColor';

// Adapter boundary: the drafting/document core never becomes DXF-shaped.
// This model is the only DXF-aware shape, built fresh per export and thrown
// away. MODEL-space survey coordinates only: paper-space objects (viewports,
// title blocks, north arrows, scale bars, sheet notes) are deliberately
// EXCLUDED — flattening them into fake model coordinates would corrupt the
// survey grid, so paper deliverables stay in SVG/PDF.
//
// Color/linetype/lineweight ride alongside each entry so R12 (ACI 62 +
// linetype 6) and R2000 (420 true color + 370 lineweight) agree. Colors are
// effective hex resolved through the shared resolver (style → layer →
// default); the serializers map hex → ACI, omitting group 62/420/6/370 when
// the entity matches its layer (BYLAYER by omission).
export interface DxfPoint {
  x: number;
  y: number;
}

interface DxfEntryStyle {
  /** Effective hex color; absent = BYLAYER (inherit the layer record). */
  colorHex?: string;
  /** Linetype id (catalog in dxfColorMap); absent = layer linetype. */
  linetypeId?: string;
  /** Lineweight in mm; absent = BYLAYER. */
  lineweightMm?: number;
  /** Source entity id for warning attribution. */
  sourceId?: string;
}

export interface DxfExportModel {
  layers: string[];
  points: Array<{ layer: string; at: DxfPoint } & DxfEntryStyle>;
  lines: Array<{ layer: string; from: DxfPoint; to: DxfPoint } & DxfEntryStyle>;
  polylines: Array<{ layer: string; vertices: DxfPoint[]; closed: boolean } & DxfEntryStyle>;
  arcs: Array<{ layer: string; center: DxfPoint; radius: number; startDeg: number; endDeg: number } & DxfEntryStyle>;
  texts: Array<{ layer: string; at: DxfPoint; height: number; text: string } & DxfEntryStyle>;
  /** Effective layer hex colors (shared-resolver output). Absent = default. */
  layerColors?: Record<string, string>;
  /** Effective layer linetype ids. Absent = continuous. */
  layerLinetypes?: Record<string, string>;
  /** Layer lineweights in mm. Absent = BYLAYER (R12 warns, R2000 emits). */
  layerLineweights?: Record<string, number>;
  /** Linetype ids actually referenced (layers + entities), sorted. */
  usedLinetypes?: string[];
}

export interface BuildDxfModelArgs {
  project: CadProject;
  modelLabels?: ModelLabelPlacement[];
}

const layerOf = (layerId: string): string => layerId;

// Error-ellipse faceting: DXF has no confidence-ellipse entity, so ellipses
// ride as a 36-gon closed polyline (documented approximation + warning).
// Theta rotates the major axis; model space is y-up so plain math rotation.
const ELLIPSE_SEGMENTS = 36;

const ellipseToVertices = (
  centerX: number,
  centerY: number,
  semiMajor: number,
  semiMinor: number,
  thetaDeg: number,
): DxfPoint[] => {
  const theta = (thetaDeg * Math.PI) / 180;
  const cos = Math.cos(theta);
  const sin = Math.sin(theta);
  const out: DxfPoint[] = [];
  for (let i = 0; i < ELLIPSE_SEGMENTS; i += 1) {
    const t = (i / ELLIPSE_SEGMENTS) * 2 * Math.PI;
    const ex = semiMajor * Math.cos(t);
    const ey = semiMinor * Math.sin(t);
    out.push({ x: centerX + ex * cos - ey * sin, y: centerY + ex * sin + ey * cos });
  }
  return out;
};

const finitePair = (x: number, y: number): boolean => Number.isFinite(x) && Number.isFinite(y);

export const buildDxfExportModelWithResult = (args: BuildDxfModelArgs): ExportResult<DxfExportModel> => {
  const result = emptyExportResult<DxfExportModel>({
    layers: [],
    points: [],
    lines: [],
    polylines: [],
    arcs: [],
    texts: [],
    layerColors: {},
    layerLinetypes: {},
    layerLineweights: {},
    usedLinetypes: [],
  });
  const model = result.output;
  const seen = new Set<string>();
  const usedLinetypes = new Set<string>(['continuous']);
  const warn = (warning: ExportWarning): void => {
    result.warnings.push(warning);
  };
  const registerLayer = (layerId: string): string => {
    const name = layerOf(layerId);
    if (!seen.has(name)) {
      seen.add(name);
      model.layers.push(name);
      const layer = args.project.layers.find((entry) => entry.id === layerId);
      model.layerColors![name] = resolveColor({ layer: layer?.color });
      const linetype = layer?.lineTypeId ?? 'continuous';
      model.layerLinetypes![name] = linetype;
      usedLinetypes.add(linetype);
      if (layer?.lineweightMm != null && Number.isFinite(layer.lineweightMm)) {
        model.layerLineweights![name] = layer.lineweightMm;
      }
    }
    return name;
  };
  // Shared-resolver precedence (style → layer → default), matching screen.
  const entryStyle = (entity: { styleId?: string; layerId: string; id: string }): DxfEntryStyle => {
    const style = entityStyle(args.project, entity as never);
    const layerHex = model.layerColors![registerLayer(entity.layerId)] as string;
    const hex = resolveColor({ style: style?.color, layer: layerHex });
    const linetypeId = style?.lineTypeId ?? model.layerLinetypes![entity.layerId] ?? 'continuous';
    usedLinetypes.add(linetypeId);
    const out: DxfEntryStyle = { sourceId: entity.id };
    if (hex !== layerHex) out.colorHex = hex;
    const layerLinetype = model.layerLinetypes![entity.layerId] ?? 'continuous';
    if (linetypeId !== layerLinetype) out.linetypeId = linetypeId;
    return out;
  };
  const sorted = [...args.project.entities].sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
  sorted.forEach((entity) => {
    if (entity.visible === false) return;
    switch (entity.type) {
      case 'survey-point': {
        if (!finitePair(entity.x, entity.y)) {
          warn({ code: 'SKIPPED_ENTITY', message: `survey-point ${entity.id} has non-finite coordinates`, entityId: entity.id });
          result.omittedEntityIds.push(entity.id);
          break;
        }
        // Bounded symbol policy (§§33,34): every point rides as POINT (+ its
        // station label as TEXT, as before) regardless of its display
        // symbol — no block library. The approximation is always warned.
        model.points.push({ layer: registerLayer(entity.layerId), at: { x: entity.x, y: entity.y }, ...entryStyle(entity) });
        model.texts.push({ layer: registerLayer(entity.layerId), at: { x: entity.x, y: entity.y }, height: 1, text: String(entity.stationId), ...entryStyle(entity) });
        result.exportedEntityIds.push(entity.id);
        result.approximatedEntityIds.push(entity.id);
        warn({ code: 'POINT_SYMBOL_APPROXIMATED', message: `survey-point ${entity.id} symbol approximated as POINT+TEXT`, entityId: entity.id });
        break;
      }
      case 'line':
        if (!finitePair(entity.fromX, entity.fromY) || !finitePair(entity.toX, entity.toY)) {
          warn({ code: 'SKIPPED_ENTITY', message: `line ${entity.id} has non-finite coordinates`, entityId: entity.id });
          result.omittedEntityIds.push(entity.id);
          break;
        }
        model.lines.push({
          layer: registerLayer(entity.layerId),
          from: { x: entity.fromX, y: entity.fromY },
          to: { x: entity.toX, y: entity.toY },
          ...entryStyle(entity),
        });
        result.exportedEntityIds.push(entity.id);
        break;
      case 'polyline':
        model.polylines.push({
          layer: registerLayer(entity.layerId),
          vertices: entity.vertices.map((v) => ({ x: v.x, y: v.y })),
          closed: entity.closed,
          ...entryStyle(entity),
        });
        result.exportedEntityIds.push(entity.id);
        break;
      case 'polygon':
      case 'parcel':
        // §35: boundary geometry as a closed polyline (geometric only —
        // LandXML/DXF carry no legal parcel meaning).
        model.polylines.push({
          layer: registerLayer(entity.layerId),
          vertices: entity.vertices.map((v) => ({ x: v.x, y: v.y })),
          closed: true,
          ...entryStyle(entity),
        });
        result.exportedEntityIds.push(entity.id);
        break;
      case 'arc':
        if (!finitePair(entity.centerX, entity.centerY) || !Number.isFinite(entity.radius) || entity.radius <= 0) {
          warn({ code: 'SKIPPED_ENTITY', message: `arc ${entity.id} has invalid geometry`, entityId: entity.id });
          result.omittedEntityIds.push(entity.id);
          break;
        }
        model.arcs.push({
          layer: registerLayer(entity.layerId),
          center: { x: entity.centerX, y: entity.centerY },
          radius: entity.radius,
          startDeg: entity.startAngleDeg,
          endDeg: entity.endAngleDeg,
          ...entryStyle(entity),
        });
        result.exportedEntityIds.push(entity.id);
        break;
      case 'text':
        model.texts.push({ layer: registerLayer(entity.layerId), at: { x: entity.x, y: entity.y }, height: 2.5, text: entity.text, ...entryStyle(entity) });
        result.exportedEntityIds.push(entity.id);
        break;
      case 'alignment': {
        // §36: the wrapper is never dropped silently — each line/arc
        // element rides as its own primitive (attributed to the wrapper id
        // via sourceId); only unrepresentable elements warn individually.
        let exported = 0;
        entity.elements.forEach((element, index) => {
          if (element.kind === 'line') {
            if (!finitePair(element.start.x, element.start.y) || !finitePair(element.end.x, element.end.y)) {
              warn({ code: 'SKIPPED_ENTITY', message: `alignment ${entity.id} element ${index} (line) has non-finite coordinates`, entityId: entity.id });
              return;
            }
            model.lines.push({ layer: registerLayer(entity.layerId), from: { ...element.start }, to: { ...element.end }, ...entryStyle(entity) });
            exported += 1;
          } else if (element.kind === 'arc') {
            if (!finitePair(element.center.x, element.center.y) || !Number.isFinite(element.radius) || element.radius <= 0) {
              warn({ code: 'SKIPPED_ENTITY', message: `alignment ${entity.id} element ${index} (arc) has invalid geometry`, entityId: entity.id });
              return;
            }
            model.arcs.push({
              layer: registerLayer(entity.layerId),
              center: { ...element.center },
              radius: element.radius,
              startDeg: element.startAngleDeg,
              endDeg: element.endAngleDeg,
              ...entryStyle(entity),
            });
            exported += 1;
          } else {
            warn({ code: 'SKIPPED_ENTITY', message: `alignment ${entity.id} element ${index} has unknown kind`, entityId: entity.id });
          }
        });
        if (exported > 0) {
          result.exportedEntityIds.push(entity.id);
        } else {
          warn({ code: 'SKIPPED_ENTITY', message: `alignment ${entity.id} exported no representable elements`, entityId: entity.id });
          result.omittedEntityIds.push(entity.id);
        }
        break;
      }
      case 'error-ellipse': {
        // §37: DXF approximates with a faceted closed polyline (warned);
        // LandXML carries no ellipse at all (NOT_APPLICABLE, see landxmlCad).
        if (
          !finitePair(entity.centerX, entity.centerY) ||
          !Number.isFinite(entity.semiMajor) || entity.semiMajor <= 0 ||
          !Number.isFinite(entity.semiMinor) || entity.semiMinor <= 0
        ) {
          warn({ code: 'SKIPPED_ENTITY', message: `error-ellipse ${entity.id} has invalid axes`, entityId: entity.id });
          result.omittedEntityIds.push(entity.id);
          break;
        }
        model.polylines.push({
          layer: registerLayer(entity.layerId),
          vertices: ellipseToVertices(entity.centerX, entity.centerY, entity.semiMajor, entity.semiMinor, entity.thetaDeg),
          closed: true,
          ...entryStyle(entity),
        });
        result.exportedEntityIds.push(entity.id);
        result.approximatedEntityIds.push(entity.id);
        // No ELLIPSE_APPROXIMATED code in the frozen union — SKIPPED_ENTITY
        // carries the message; the id list marks the approximation.
        warn({ code: 'SKIPPED_ENTITY', message: `error-ellipse ${entity.id} approximated as ${ELLIPSE_SEGMENTS}-gon polyline (DXF has no confidence-ellipse entity)`, entityId: entity.id });
        break;
      }
      default:
        warn({ code: 'SKIPPED_ENTITY', message: `entity ${(entity as { id: string }).id} has unsupported type ${(entity as { type: string }).type}`, entityId: (entity as { id: string }).id });
        result.omittedEntityIds.push((entity as { id: string }).id);
        break;
    }
  });
  (args.modelLabels ?? []).forEach((label) => {
    if (label.broken || label.text == null) return;
    model.texts.push({ layer: registerLayer(label.layerId ?? 'labels'), at: { x: label.xModel, y: label.yModel }, height: 2.5, text: label.text });
  });
  model.layers.sort();
  model.usedLinetypes = [...usedLinetypes].sort();
  return finalizeExportResult(result);
};

/** Legacy bare-model path (no warnings). Prefer WithResult for new callers. */
export const buildDxfExportModel = (args: BuildDxfModelArgs): DxfExportModel =>
  buildDxfExportModelWithResult(args).output;

