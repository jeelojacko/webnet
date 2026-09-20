import type { CadEntity, CadProject } from '../cadTypes';
import type { ModelLabelPlacement } from '../cadExportScene';
import { DEFAULT_RESOLVED_LINEWEIGHT_MM, resolveCadEntityAppearance } from '../cadAppearance';
import {
  emptyExportResult,
  finalizeExportResult,
  type ExportResult,
  type ExportWarning,
} from '../exportResult';
import { resolveEffectiveColor as resolveColor } from '../resolveEffectiveColor';
import { materializeBoundPointLabel } from '../cadPointLabelStyles';
import {
  blockReferenceInsert,
  buildDxfBlockTable,
  collectReferencedBlockIds,
} from './dxfBlockExport';
import type { DxfBlockEntry, DxfInsert } from './dxfBlockExport';
export type {
  DxfBlockChildArc,
  DxfBlockChildLine,
  DxfBlockChildPolyline,
  DxfBlockChildText,
  DxfBlockEntry,
  DxfInsert,
} from './dxfBlockExport';
import { expandBlockReference, findBlockDefinition, normalizeBlockScales } from '../cadBlocks';
import { surveyPointMarker } from '../cadRendererStyle';
import { deriveAnnotationPrimitives } from './dxfAnnotationExport';

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
  /** Individually hidden entity (group 60); absent/false = visible. */
  invisible?: boolean;
  /** Source entity id for warning attribution. */
  sourceId?: string;
}

export type DxfInsertStyled = DxfInsert & DxfEntryStyle;

export interface DxfExportModel {
  layers: string[];
  points: Array<{ layer: string; at: DxfPoint } & DxfEntryStyle>;
  lines: Array<{ layer: string; from: DxfPoint; to: DxfPoint } & DxfEntryStyle>;
  polylines: Array<{ layer: string; vertices: DxfPoint[]; closed: boolean } & DxfEntryStyle>;
  arcs: Array<{ layer: string; center: DxfPoint; radius: number; startDeg: number; endDeg: number } & DxfEntryStyle>;
  texts: Array<{ layer: string; at: DxfPoint; height: number; text: string; rotationDeg?: number } & DxfEntryStyle>;
  /**
   * Phase 18N native block table (referenced definitions only). Children
   * ride base-shifted (stored minus definition.basePoint) with BLOCK base
   * (0,0), so INSERT world = insert + R·S·local matches the engine
   * transform exactly. Children are BYLAYER (layer only): instance-level
   * INSERT carries the reference's explicit style.
   */
  blocks?: DxfBlockEntry[];
  /** Native INSERTs: block references + block-backed point markers. */
  inserts?: DxfInsertStyled[];
  /** Effective layer hex colors (shared-resolver output). Absent = default. */
  layerColors?: Record<string, string>;
  /** Effective layer linetype ids. Absent = continuous. */
  layerLinetypes?: Record<string, string>;
  /** Layer lineweights in mm. Absent = BYLAYER (R12 warns, R2000 emits). */
  layerLineweights?: Record<string, number>;
  /** Layer state flags for OFF (negative-ACI 62) / frozen+locked (70 bits). */
  layerFlags?: Record<string, { off: boolean; frozen: boolean; locked: boolean }>;
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

const finiteAngle = (deg: number): boolean => Number.isFinite(deg);

/** Every vertex must be finite; serializers coerce non-finite to 0, so
 *  invalid rings are omitted with a warning instead of corrupting output. */
const finiteVertices = (vertices: ReadonlyArray<{ x: number; y: number }>): boolean =>
  vertices.every((vertex) => finitePair(vertex.x, vertex.y));

export const buildDxfExportModelWithResult = (args: BuildDxfModelArgs): ExportResult<DxfExportModel> => {
  const result = emptyExportResult<DxfExportModel>({
    layers: [],
    points: [],
    lines: [],
    polylines: [],
    arcs: [],
    texts: [],
    blocks: [],
    inserts: [],
    layerColors: {},
    layerLinetypes: {},
    layerLineweights: {},
    layerFlags: {},
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
      model.layerFlags![name] = {
        off: layer?.visible === false,
        frozen: layer?.frozen === true,
        locked: layer?.locked === true,
      };
    }
    return name;
  };
  // Shared-resolver precedence (explicit > style > layer > default),
  // matching screen and plot. Resolving through resolveCadEntityAppearance
  // (not entityStyle) closes the entryStyle gap: legacy style.strokeWidth
  // reaches DXF 370 instead of silently exporting BYLAYER.
  const entryStyle = (entity: CadEntity): DxfEntryStyle => {
    const layer = args.project.layers.find((entry) => entry.id === entity.layerId);
    const resolved = resolveCadEntityAppearance({
      entity,
      layer: layer ?? null,
      styleLibrary: args.project.styleLibrary,
    });
    const layerHex = model.layerColors![registerLayer(entity.layerId)] as string;
    const layerLinetype = model.layerLinetypes![entity.layerId] ?? 'continuous';
    const layerWeight = layer?.lineweightMm ?? DEFAULT_RESOLVED_LINEWEIGHT_MM;
    usedLinetypes.add(resolved.lineTypeId);
    const out: DxfEntryStyle = { sourceId: entity.id };
    if (resolved.color !== layerHex) out.colorHex = resolved.color;
    if (resolved.lineTypeId !== layerLinetype) out.linetypeId = resolved.lineTypeId;
    if (resolved.lineweightMm !== layerWeight) out.lineweightMm = resolved.lineweightMm;
    if (entity.visible === false) out.invisible = true;
    return out;
  };
  const sorted = [...args.project.entities].sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
  // Phase 18N native block table (dxfBlockExport.ts): referenced
  // definitions only, DXF-sanitized + deduped, so serializers stay native.
  const blockTable = buildDxfBlockTable({
    project: args.project,
    referencedIds: collectReferencedBlockIds(args.project, sorted),
    registerLayer,
    warn,
  });
  (model.blocks ??= []).push(...blockTable.blocks);
  const blockNameById = blockTable.names;
  sorted.forEach((entity) => {
    // DXF retain policy (spec §6): every entity rides, including OFF /
    // frozen / non-printable layers and individually hidden entities —
    // layer state travels in the layer record (OFF = negative 62,
    // frozen/locked = 70 bits), entity.hidden travels as group 60.
    switch (entity.type) {
      case 'survey-point': {
        if (!finitePair(entity.x, entity.y)) {
          warn({ code: 'SKIPPED_ENTITY', message: `survey-point ${entity.id} has non-finite coordinates`, entityId: entity.id });
          result.omittedEntityIds.push(entity.id);
          break;
        }
        // Phase 18N: block-backed markers ride as native INSERT (exact —
        // no POINT_SYMBOL_APPROXIMATED warning); the station label TEXT
        // rides alongside exactly as before.
        const marker = surveyPointMarker(args.project, entity);
        const markerBlockName = marker.blockDefinitionId != null
          ? blockNameById.get(marker.blockDefinitionId)
          : undefined;
        if (marker.blockDefinitionId != null && markerBlockName != null) {
          const scale = marker.markerScale ?? 1;
          (model.inserts ??= []).push({
            ...blockReferenceInsert(
              registerLayer(entity.layerId),
              markerBlockName,
              marker.blockDefinitionId,
              { x: entity.x, y: entity.y },
              marker.rotationDeg ?? 0,
              scale,
              scale,
            ),
            ...entryStyle(entity),
          });
        } else {
        // Bounded symbol policy (§§33,34): every point rides as POINT (+ its
        // station label as TEXT, as before) regardless of its display
        // symbol — no block library. The approximation is always warned.
        model.points.push({ layer: registerLayer(entity.layerId), at: { x: entity.x, y: entity.y }, ...entryStyle(entity) });
        }
        model.texts.push({ layer: registerLayer(entity.layerId), at: { x: entity.x, y: entity.y }, height: 1, text: String(entity.stationId), ...entryStyle(entity) });
        result.exportedEntityIds.push(entity.id);
        if (markerBlockName == null) {
          result.approximatedEntityIds.push(entity.id);
          warn({ code: 'POINT_SYMBOL_APPROXIMATED', message: `survey-point ${entity.id} symbol approximated as POINT+TEXT`, entityId: entity.id });
        }
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
      case 'polyline': {
        if (entity.vertices.length < 2 || !finiteVertices(entity.vertices)) {
          warn({ code: 'SKIPPED_ENTITY', message: `polyline ${entity.id} has fewer than 2 finite vertices`, entityId: entity.id });
          result.omittedEntityIds.push(entity.id);
          break;
        }
        model.polylines.push({
          layer: registerLayer(entity.layerId),
          vertices: entity.vertices.map((v) => ({ x: v.x, y: v.y })),
          closed: entity.closed,
          ...entryStyle(entity),
        });
        result.exportedEntityIds.push(entity.id);
        break;
      }
      case 'polygon':
      case 'parcel': {
        // §35: boundary geometry as a closed polyline (geometric only —
        // LandXML/DXF carry no legal parcel meaning). The closed-polyline
        // encoding is an APPROXIMATED representation: always warned.
        if (entity.vertices.length < 3 || !finiteVertices(entity.vertices)) {
          warn({ code: 'SKIPPED_ENTITY', message: `${entity.type} ${entity.id} has fewer than 3 finite vertices`, entityId: entity.id });
          result.omittedEntityIds.push(entity.id);
          break;
        }
        model.polylines.push({
          layer: registerLayer(entity.layerId),
          vertices: entity.vertices.map((v) => ({ x: v.x, y: v.y })),
          closed: true,
          ...entryStyle(entity),
        });
        result.exportedEntityIds.push(entity.id);
        result.approximatedEntityIds.push(entity.id);
        warn({ code: 'SKIPPED_ENTITY', message: `${entity.type} ${entity.id} approximated as closed polyline (geometric only, no legal parcel meaning)`, entityId: entity.id });
        break;
      }
      case 'arc':
        if (
          !finitePair(entity.centerX, entity.centerY) ||
          !Number.isFinite(entity.radius) || entity.radius <= 0 ||
          !finiteAngle(entity.startAngleDeg) || !finiteAngle(entity.endAngleDeg)
        ) {
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
      case 'text': {
        if (!finitePair(entity.x, entity.y)) {
          warn({ code: 'SKIPPED_ENTITY', message: `text ${entity.id} has non-finite coordinates`, entityId: entity.id });
          result.omittedEntityIds.push(entity.id);
          break;
        }
        // Bound labels export materialized content at the materialized
        // position (unresolvable bindings fall back to baked snapshots, see
        // the orphan policy in cadPointLabelStyles). A No Label style hides
        // the text intentionally: the entity stays exported, no warning.
        // Points keep the POINT+TEXT approximation with its warning below.
        const bound = materializeBoundPointLabel(entity, args.project);
        if (bound != null && !bound.visible) {
          registerLayer(entity.layerId);
          result.exportedEntityIds.push(entity.id);
          break;
        }
        model.texts.push({
          layer: registerLayer(entity.layerId),
          at: bound != null ? { x: bound.x, y: bound.y } : { x: entity.x, y: entity.y },
          height: 2.5,
          text: bound != null ? bound.text : entity.text,
          ...entryStyle(entity),
        });
        result.exportedEntityIds.push(entity.id);
        break;
      }
      case 'alignment': {
        // §36: the wrapper is never dropped silently — each line/arc
        // element rides as its own primitive (attributed to the wrapper id
        // via sourceId). Element expansion is an APPROXIMATED
        // representation of the alignment wrapper: always warned when any
        // element exports. Unrepresentable elements warn individually
        // (entity-attributed) while the wrapper stays exported +
        // approximated — never exported+omitted.
        let exported = 0;
        let skipped = 0;
        entity.elements.forEach((element, index) => {
          if (element.kind === 'line') {
            if (!finitePair(element.start.x, element.start.y) || !finitePair(element.end.x, element.end.y)) {
              warn({ code: 'SKIPPED_ENTITY', message: `alignment ${entity.id} element ${index} (line) has non-finite coordinates`, entityId: entity.id });
              skipped += 1;
              return;
            }
            model.lines.push({ layer: registerLayer(entity.layerId), from: { ...element.start }, to: { ...element.end }, ...entryStyle(entity) });
            exported += 1;
          } else if (element.kind === 'arc') {
            if (
              !finitePair(element.center.x, element.center.y) ||
              !Number.isFinite(element.radius) || element.radius <= 0 ||
              !finiteAngle(element.startAngleDeg) || !finiteAngle(element.endAngleDeg)
            ) {
              warn({ code: 'SKIPPED_ENTITY', message: `alignment ${entity.id} element ${index} (arc) has invalid geometry`, entityId: entity.id });
              skipped += 1;
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
            skipped += 1;
          }
        });
        if (exported > 0) {
          result.exportedEntityIds.push(entity.id);
          result.approximatedEntityIds.push(entity.id);
          warn({
            code: 'SKIPPED_ENTITY',
            message: skipped > 0
              ? `alignment ${entity.id} expanded to ${exported} line/arc primitives (${skipped} elements skipped)`
              : `alignment ${entity.id} expanded to ${exported} line/arc primitives`,
            entityId: entity.id,
          });
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
      case 'block-reference': {
        // Phase 18N native INSERT (exact — never approximated). Dangling
        // refs and bad scales omit + warn (fail-closed; load sanitize
        // normally prevents both).
        const definition = findBlockDefinition(args.project.blockDefinitions, entity.blockDefinitionId);
        if (!definition || blockNameById.get(entity.blockDefinitionId) == null) {
          warn({ code: 'SKIPPED_ENTITY', message: `block-reference ${entity.id} points at unknown definition ${entity.blockDefinitionId}`, entityId: entity.id });
          result.omittedEntityIds.push(entity.id);
          break;
        }
        if (normalizeBlockScales(entity.scaleX, entity.scaleY) != null || !finitePair(entity.x, entity.y) || !finiteAngle(entity.rotationDeg)) {
          warn({ code: 'SKIPPED_ENTITY', message: `block-reference ${entity.id} has an invalid transform`, entityId: entity.id });
          result.omittedEntityIds.push(entity.id);
          break;
        }
        (model.inserts ??= []).push({
          ...blockReferenceInsert(
            registerLayer(entity.layerId),
            blockNameById.get(entity.blockDefinitionId) as string,
            entity.blockDefinitionId,
            { x: entity.x, y: entity.y },
            entity.rotationDeg,
            entity.scaleX,
            entity.scaleY,
            entity.mirrored,
          ),
          ...entryStyle(entity),
        });
        // Phase 18Q: a mirrored INSERT's TEXT children would render
        // mirrored in a DXF reader, so they ride as world-space TEXT
        // (readable glyphs) alongside the native INSERT. Geometry children
        // stay in the BLOCK — no definition duplication, never unmirrored.
        if (entity.mirrored === true) {
          try {
            const meanScale = (entity.scaleX + entity.scaleY) / 2;
            for (const child of expandBlockReference(definition, entity)) {
              if (child.type !== 'text') continue;
              model.texts.push({
                layer: registerLayer(child.layerId),
                at: { x: child.x, y: child.y },
                height: 2.5 * meanScale,
                text: child.text,
                ...entryStyle(entity),
              });
            }
          } catch {
            // Expansion already validated above; belt-and-suspenders no-op.
          }
        }
        result.exportedEntityIds.push(entity.id);
        break;
      }
      case 'mtext':
      case 'leader':
      case 'dimension':
      case 'bearing-label':
      case 'curve-label': {
        // Phase 18O: derived LINE/TEXT primitives + tessellated arrowheads.
        // APPROXIMATED (never a native annotation entity), and never a silent
        // drop: an underivable entity is omitted with its warning. See the
        // annotation export block above for the mlightcad round-trip rationale.
        const derivation = deriveAnnotationPrimitives(entity, args.project);
        const count = derivation.primitives.lines.length + derivation.primitives.texts.length;
        if (!derivation.ok || count === 0) {
          warn({ code: 'SKIPPED_ENTITY', message: `${entity.type} ${entity.id} has no derivable annotation geometry`, entityId: entity.id });
          result.omittedEntityIds.push(entity.id);
          break;
        }
        const annotationStyle = entryStyle(entity);
        const layer = registerLayer(entity.layerId);
        derivation.primitives.lines.forEach((line) => {
          model.lines.push({ layer, from: line.from, to: line.to, ...annotationStyle });
        });
        derivation.primitives.texts.forEach((text) => {
          model.texts.push({
            layer,
            at: text.at,
            height: text.height,
            text: text.text,
            ...(text.rotationDeg != null ? { rotationDeg: text.rotationDeg } : {}),
            ...annotationStyle,
          });
        });
        derivation.warnings.forEach(warn);
        result.exportedEntityIds.push(entity.id);
        result.approximatedEntityIds.push(entity.id);
        warn({ code: 'SKIPPED_ENTITY', message: `${entity.type} ${entity.id} approximated as derived LINE/TEXT primitives (no round-trip-safe native DXF annotation)`, entityId: entity.id });
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
    if (!finitePair(label.xModel, label.yModel)) {
      warn({ code: 'SKIPPED_ENTITY', message: `model label ${label.id} has non-finite coordinates` });
      return;
    }
    model.texts.push({ layer: registerLayer(label.layerId ?? 'labels'), at: { x: label.xModel, y: label.yModel }, height: 2.5, text: label.text });
  });
  model.layers.sort();
  model.usedLinetypes = [...usedLinetypes].sort();
  return finalizeExportResult(result);
};

/** Legacy bare-model path (no warnings). Prefer WithResult for new callers. */
export const buildDxfExportModel = (args: BuildDxfModelArgs): DxfExportModel =>
  buildDxfExportModelWithResult(args).output;

