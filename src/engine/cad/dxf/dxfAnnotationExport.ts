// Phase 18O annotation export derivation (model space, shared by R12 + R2000).
//
// mlightcad's data model can READ native MTEXT/LEADER/DIMENSION records, but
// this writer never emits them and the in-app adapter degrades all five
// annotation kinds to AcDbText/AcDbPoint (see cadMlightcadAdapter.ts), so a
// native annotation entity does NOT round-trip. Until that is proven, every
// annotation rides as derived primitives — LINE + TEXT plus tessellated
// arrowhead geometry from the seeded arrow blocks — and the caller always
// reports it APPROXIMATED. R12 and R2000 build from one model, so both formats
// get the same bounded approximation; only the writer differs. Nothing is
// dropped silently: a kind with no derivable geometry returns ok:false and the
// caller records it omitted with a warning.
//
// Split from dxfExportModel.ts to keep that adapter under the repo file-size
// guideline; this module owns geometry derivation only, the adapter owns
// styling/layer/block wiring.
import type { CadBearingDistanceLabelEntity, CadCurveLabelEntity, CadDimensionEntity, CadLeaderEntity, CadMTextEntity, CadMTextAttachment, CadProject } from '../cadTypes';
import type { ExportWarning } from '../exportResult';
import { resolveCadAnnotationAnchor, type CadAnnotationAnchor } from '../annotation/cadAnnotationAnchors';
import { ANNOTATION_ARROWHEAD_SEEDS } from '../annotation/cadAnnotationArrowheads';
import { resolveAnnotationScaleDenominator } from '../annotation/cadAnnotationSettings';
import { resolveCadAnnotationTextMetrics } from '../annotation/cadAnnotationTextMetrics';
import { deriveCadDimensionGeometry, type CadDimensionGeometryInput } from '../annotation/cadDimensionGeometry';
import {
  curveLabelPlacement,
  leaderTextReferencePoint,
  normalizeTextAttachment,
  sumOffsets,
} from '../annotation/cadAnnotationPlacement';
import { deriveBearingDistanceLabel, deriveCurveLabel } from '../annotation/cadSurveyLabels';
import { expandBlockReference, findBlockDefinition } from '../cadBlocks';

export interface DxfAnnotationPoint {
  x: number;
  y: number;
}

export interface DxfAnnotationPrimitives {
  lines: Array<{ from: DxfAnnotationPoint; to: DxfAnnotationPoint }>;
  texts: Array<{ at: DxfAnnotationPoint; height: number; text: string; rotationDeg?: number }>;
}

export interface DxfAnnotationDerivation {
  primitives: DxfAnnotationPrimitives;
  warnings: ExportWarning[];
  ok: boolean;
}

export type CadAnnotationEntity =
  | CadMTextEntity
  | CadLeaderEntity
  | CadDimensionEntity
  | CadBearingDistanceLabelEntity
  | CadCurveLabelEntity;

const ANNOTATION_TEXT_FALLBACK_HEIGHT = 2.5;
const ANNOTATION_TEXT_WIDTH_FACTOR = 0.6;

const emptyAnnotationPrimitives = (): DxfAnnotationPrimitives => ({ lines: [], texts: [] });

const finitePair = (x: number, y: number): boolean => Number.isFinite(x) && Number.isFinite(y);

/** One shared height resolver so model-space annotation text matches the
 *  professional style contract (legacy-screen / model / paper×scale). */
const annotationTextMetrics = (
  project: CadProject,
  textStyleId: string | undefined,
): { height: number; lineSpacing: number } => {
  const style = textStyleId != null
    ? project.styleLibrary.textStyles.find((entry) => entry.id === textStyleId)
    : undefined;
  if (style == null) return { height: ANNOTATION_TEXT_FALLBACK_HEIGHT, lineSpacing: 1.2 };
  const metrics = resolveCadAnnotationTextMetrics({
    fontFamily: style.fontFamily,
    fontSize: style.fontSize,
    heightMode: style.heightMode,
    modelHeight: style.modelHeight,
    paperHeightMm: style.paperHeightMm,
    widthFactor: style.widthFactor,
    lineSpacingFactor: style.lineSpacingFactor,
    fontWeight: style.fontWeight === 'bold' ? 700 : 400,
    fontStyle: style.fontStyle,
    annotationScaleDenominator: resolveAnnotationScaleDenominator(project),
    unitsMode: project.metadata.units,
  });
  return { height: metrics.modelHeight, lineSpacing: metrics.lineSpacingFactor };
};

/** Multiline text becomes several TEXT rows (DXF TEXT has no inline newline).
 *  Horizontal centering uses the same chars*0.6*height estimate as dimension
 *  text; model space is y-up, so lower rows step DOWN in y. */
const pushAnnotationTextRows = (
  primitives: DxfAnnotationPrimitives,
  x: number,
  y: number,
  metrics: { height: number; lineSpacing: number },
  text: string,
  attachment: CadMTextAttachment = 'top-left',
  rotationDeg?: number,
): void => {
  const rows = text.split(/\r\n|\r|\n/);
  const step = metrics.height * metrics.lineSpacing;
  const vertical = attachment.split('-')[0];
  const total = Math.max(0, rows.length - 1) * step;
  const firstY = y + (vertical === 'top' ? 0 : vertical === 'middle' ? total / 2 : total);
  const horizontal = attachment.split('-')[1];
  rows.forEach((row, index) => {
    if (row.length === 0) return;
    const width = row.length * ANNOTATION_TEXT_WIDTH_FACTOR * metrics.height;
    const offset = horizontal === 'center' ? -width / 2 : horizontal === 'right' ? -width : 0;
    primitives.texts.push({
      at: { x: x + offset, y: firstY - index * step },
      height: metrics.height,
      text: row,
      ...(rotationDeg != null && rotationDeg !== 0 ? { rotationDeg } : {}),
    });
  });
};

const annotationArrowDefinition = (project: CadProject, definitionId: string | undefined) => {
  if (definitionId == null) return undefined;
  return findBlockDefinition(project.blockDefinitions, definitionId)
    ?? ANNOTATION_ARROWHEAD_SEEDS.find((seed) => seed.id === definitionId);
};

/** Arrowheads are plain world-space geometry (tip-at-point convention from
 *  cadDimensionGeometry). Seeded arrow blocks also work without a project
 *  block table entry, so no native BLOCK/INSERT is required for fidelity and
 *  a dangling INSERT can never be emitted. */
const pushAnnotationArrow = (
  primitives: DxfAnnotationPrimitives,
  project: CadProject,
  definitionId: string | undefined,
  transform: { x: number; y: number; rotationDeg: number; size: number },
): boolean => {
  const definition = annotationArrowDefinition(project, definitionId);
  if (definition == null || !Number.isFinite(transform.size) || transform.size <= 0) return false;
  let children;
  try {
    children = expandBlockReference(definition, {
      x: transform.x, y: transform.y, rotationDeg: transform.rotationDeg,
      scaleX: transform.size, scaleY: transform.size,
    });
  } catch {
    return false;
  }
  children.forEach((child) => {
    if (child.type === 'line') {
      primitives.lines.push({ from: { x: child.fromX, y: child.fromY }, to: { x: child.toX, y: child.toY } });
    } else if (child.type === 'polygon' || child.type === 'polyline') {
      const vertices = child.vertices;
      vertices.slice(0, -1).forEach((vertex, index) => {
        primitives.lines.push({ from: vertex, to: vertices[index + 1] as DxfAnnotationPoint });
      });
      if (child.type === 'polygon' && vertices.length > 2) {
        primitives.lines.push({ from: vertices[vertices.length - 1] as DxfAnnotationPoint, to: vertices[0] as DxfAnnotationPoint });
      }
    }
  });
  return true;
};

const resolveAnnotationPoint = (
  anchor: CadAnnotationAnchor,
  project: CadProject,
  entityId: string,
  warnings: ExportWarning[],
): DxfAnnotationPoint => {
  const resolution = resolveCadAnnotationAnchor(anchor, project);
  if (resolution.ok) return { x: resolution.x, y: resolution.y };
  warnings.push({
    code: 'BROKEN_REFERENCE',
    message: `annotation ${entityId} anchor could not resolve; exported at persisted fallback`,
    entityId,
  });
  return { x: resolution.fallbackX, y: resolution.fallbackY };
};

const dimensionGeometryKind = (
  entity: CadDimensionEntity,
): 'linear-horizontal' | 'linear-vertical' | 'aligned' | 'angular' | 'radius' | 'diameter' => {
  if (entity.dimensionKind === 'linear') {
    if (entity.orientation === 'vertical') return 'linear-vertical';
    if (entity.orientation === 'horizontal') return 'linear-horizontal';
    return 'aligned';
  }
  return entity.dimensionKind;
};

const deriveMTextAnnotation = (
  entity: CadMTextEntity,
  project: CadProject,
): DxfAnnotationDerivation => {
  const primitives = emptyAnnotationPrimitives();
  if (!finitePair(entity.x, entity.y)) return { primitives, warnings: [], ok: false };
  pushAnnotationTextRows(primitives, entity.x, entity.y, annotationTextMetrics(project, entity.textStyleId), entity.text, entity.attachment);
  return { primitives, warnings: [], ok: primitives.texts.length > 0 };
};

const deriveLeaderAnnotation = (
  entity: CadLeaderEntity,
  project: CadProject,
): DxfAnnotationDerivation => {
  const primitives = emptyAnnotationPrimitives();
  const warnings: ExportWarning[] = [];
  const style = project.leaderStyles?.find((entry) => entry.id === entity.leaderStyleId);
  const start = resolveAnnotationPoint(entity.arrowAnchor, project, entity.id, warnings);
  const vertices = entity.vertices.filter((vertex) => finitePair(vertex.x, vertex.y));
  if (vertices.length === 0) return { primitives, warnings, ok: false };
  const path = [start, ...vertices];
  const last = vertices[vertices.length - 1] as DxfAnnotationPoint;
  const before = (path[path.length - 2] ?? start) as DxfAnnotationPoint;
  const dx = last.x - before.x;
  const dy = last.y - before.y;
  const length = Math.hypot(dx, dy);
  const dir = length > 1e-12 ? { x: dx / length, y: dy / length } : { x: 1, y: 0 };
  const landingLength = style?.landingLength ?? 5;
  const landingEnd = { x: last.x + dir.x * landingLength, y: last.y + dir.y * landingLength };
  for (let index = 0; index + 1 < path.length; index += 1) {
    const from = path[index] as DxfAnnotationPoint;
    const to = path[index + 1] as DxfAnnotationPoint;
    if (from.x === to.x && from.y === to.y) continue;
    primitives.lines.push({ from, to });
  }
  if (landingLength > 0) {
    primitives.lines.push({ from: last, to: landingEnd });
  }
  const arrival = (path[1] ?? last) as DxfAnnotationPoint;
  const arrowDirection = (Math.atan2(start.y - arrival.y, start.x - arrival.x) * 180) / Math.PI;
  if (Number.isFinite(arrowDirection)) {
    pushAnnotationArrow(primitives, project, style?.arrowBlockDefinitionId, {
      x: start.x, y: start.y, rotationDeg: arrowDirection, size: style?.arrowSize ?? 2.5,
    });
  }
  const metrics = annotationTextMetrics(project, entity.textStyleId ?? style?.textStyleId);
  const reference = leaderTextReferencePoint(landingEnd, dir, style?.textGap ?? 1);
  pushAnnotationTextRows(
    primitives,
    reference.x,
    reference.y,
    metrics,
    entity.text,
    normalizeTextAttachment(entity.textAttachment),
  );
  return { primitives, warnings, ok: primitives.lines.length + primitives.texts.length > 0 };
};

const deriveDimensionAnnotation = (
  entity: CadDimensionEntity,
  project: CadProject,
): DxfAnnotationDerivation => {
  const primitives = emptyAnnotationPrimitives();
  const warnings: ExportWarning[] = [];
  const style = project.dimensionStyles?.find((entry) => entry.id === entity.dimensionStyleId);
  const p1Anchor = entity.defPoint1 ?? entity.anchors[0];
  const p2Anchor = entity.defPoint2 ?? entity.anchors[1];
  const kind = dimensionGeometryKind(entity);
  // Phase 18P: production radius/diameter commits one defining anchor (the
  // arc pick); the second pick is the dim-line point. Every other kind
  // still requires both anchors.
  const singleRadialAnchor =
    (kind === 'radius' || kind === 'diameter') && p2Anchor == null && p1Anchor?.kind === 'arc-point'
      ? p1Anchor
      : null;
  if (p1Anchor == null || (singleRadialAnchor == null && p2Anchor == null) || !finitePair(entity.dimLinePoint.x, entity.dimLinePoint.y)) {
    return { primitives, warnings, ok: false };
  }
  const p1 = resolveAnnotationPoint(p1Anchor, project, entity.id, warnings);
  const p2 = p2Anchor != null ? resolveAnnotationPoint(p2Anchor, project, entity.id, warnings) : p1;
  const metrics = annotationTextMetrics(project, style?.textStyleId);
  const common = {
    kind,
    p1,
    p2,
    dimLinePoint: { ...entity.dimLinePoint },
    ...(entity.textPoint != null ? { textPoint: { ...entity.textPoint } } : {}),
    textGap: style?.textGap ?? 1,
    arrowSize: style?.arrowSize ?? 2.5,
    extensionOffset: style?.extensionOffset ?? 1,
    extensionOvershoot: style?.extensionOvershoot ?? 1,
    textHeight: metrics.height,
    decimalPrecision: style?.decimalPrecision ?? 3,
    ...(style?.prefix != null ? { prefix: style.prefix } : {}),
    ...(style?.suffix != null ? { suffix: style.suffix } : {}),
  };
  let input: CadDimensionGeometryInput = common;
  if (kind === 'angular') {
    const ray2Anchor = entity.anchors[2];
    input = { ...common, vertex: p1, ray1Point: p2, ray2Point: ray2Anchor != null ? resolveAnnotationPoint(ray2Anchor, project, entity.id, warnings) : p2 };
  } else if (kind === 'radius' || kind === 'diameter') {
    if (singleRadialAnchor != null) {
      // Lone arc-point anchor: center + radius read live from the arc
      // entity (same derivation as the viewport renderer), so radius edits
      // re-measure in DXF too instead of dropping the dimension silently.
      const source = project.entities.find(
        (candidate) => candidate.id === singleRadialAnchor.entityId,
      );
      if (source == null || source.type !== 'arc') return { primitives, warnings, ok: false };
      const center = { x: source.centerX, y: source.centerY };
      let arcPoint: { x: number; y: number };
      if (singleRadialAnchor.point === 'center') {
        const dx = entity.dimLinePoint.x - center.x;
        const dy = entity.dimLinePoint.y - center.y;
        const length = Math.hypot(dx, dy);
        const direction = length > 1e-12 ? { x: dx / length, y: dy / length } : { x: 1, y: 0 };
        arcPoint = { x: center.x + direction.x * source.radius, y: center.y + direction.y * source.radius };
      } else {
        arcPoint = p1;
      }
      input = { ...common, p1: center, center, radius: source.radius, arcPoint };
    } else {
      input = { ...common, center: p1, radius: Math.hypot(p2.x - p1.x, p2.y - p1.y), arcPoint: p2 };
    }
  }
  const geometry = deriveCadDimensionGeometry(input);
  geometry.extensionSegments.forEach((segment) => primitives.lines.push({ from: segment.from, to: segment.to }));
  geometry.dimensionSegments.forEach((segment) => primitives.lines.push({ from: segment.from, to: segment.to }));
  geometry.arrowTransforms.forEach((arrow) => {
    pushAnnotationArrow(primitives, project, style?.arrowBlockDefinitionId, arrow);
  });
  pushAnnotationTextRows(
    primitives,
    geometry.textPosition.x,
    geometry.textPosition.y,
    metrics,
    entity.textOverride ?? geometry.formattedText,
    'middle-center',
    geometry.textRotationDeg,
  );
  return { primitives, warnings, ok: primitives.lines.length + primitives.texts.length > 0 };
};

const LABEL_CONTENT_SEPARATOR: Record<'newline' | 'space' | 'slash', string> = {
  newline: '\n',
  space: ' ',
  slash: ' / ',
};

const deriveBearingLabelAnnotation = (
  entity: CadBearingDistanceLabelEntity,
  project: CadProject,
): DxfAnnotationDerivation => {
  const primitives = emptyAnnotationPrimitives();
  const source = project.entities.find((candidate) => candidate.id === entity.sourceEntityId);
  if (source == null || source.type !== 'line') return { primitives, warnings: [], ok: false };
  const style = project.bearingLabelStyles?.find((entry) => entry.id === entity.labelStyleId);
  const label = deriveBearingDistanceLabel({
    from: { x: source.fromX, y: source.fromY },
    to: { x: source.toX, y: source.toY },
    content: style?.content ?? 'bearing-distance',
    separator: style != null ? LABEL_CONTENT_SEPARATOR[style.separator] : '\n',
    distancePrecision: style?.decimalPrecision ?? 3,
    ...(entity.manualTextOverride != null ? { manualTextOverride: entity.manualTextOverride } : {}),
  });
  const x = label.midpoint.x + entity.offset.x;
  const y = label.midpoint.y + entity.offset.y;
  if (!finitePair(x, y)) return { primitives, warnings: [], ok: false };
  pushAnnotationTextRows(primitives, x, y, annotationTextMetrics(project, style?.textStyleId), label.text, 'middle-center');
  return { primitives, warnings: [], ok: primitives.texts.length > 0 };
};

const deriveCurveLabelAnnotation = (
  entity: CadCurveLabelEntity,
  project: CadProject,
): DxfAnnotationDerivation => {
  const primitives = emptyAnnotationPrimitives();
  const source = project.entities.find((candidate) => candidate.id === entity.sourceEntityId);
  if (source == null || source.type !== 'arc') return { primitives, warnings: [], ok: false };
  const style = project.curveLabelStyles?.find((entry) => entry.id === entity.labelStyleId);
  const label = deriveCurveLabel({
    center: { x: source.centerX, y: source.centerY },
    radius: source.radius,
    startAngleDeg: source.startAngleDeg,
    endAngleDeg: source.endAngleDeg,
    fields: style?.fields ?? ['radius', 'delta', 'length'],
    decimalPrecision: style?.decimalPrecision ?? 3,
    ...(entity.manualTextOverride != null ? { manualTextOverride: entity.manualTextOverride } : {}),
  });
  if (label == null) return { primitives, warnings: [], ok: false };
  const placement = curveLabelPlacement({
    center: { x: source.centerX, y: source.centerY },
    radius: source.radius,
    startAngleDeg: source.startAngleDeg,
    endAngleDeg: source.endAngleDeg,
    offset: sumOffsets(style?.offset, entity.offset),
  });
  if (placement == null || !finitePair(placement.x, placement.y)) return { primitives, warnings: [], ok: false };
  pushAnnotationTextRows(
    primitives,
    placement.x,
    placement.y,
    annotationTextMetrics(project, style?.textStyleId),
    label.text,
    'middle-center',
    placement.rotationDeg,
  );
  return { primitives, warnings: [], ok: primitives.texts.length > 0 };
};

export const deriveAnnotationPrimitives = (
  entity: CadAnnotationEntity,
  project: CadProject,
): DxfAnnotationDerivation => {
  switch (entity.type) {
    case 'mtext':
      return deriveMTextAnnotation(entity, project);
    case 'leader':
      return deriveLeaderAnnotation(entity, project);
    case 'dimension':
      return deriveDimensionAnnotation(entity, project);
    case 'bearing-label':
      return deriveBearingLabelAnnotation(entity, project);
    case 'curve-label':
      return deriveCurveLabelAnnotation(entity, project);
  }
};
