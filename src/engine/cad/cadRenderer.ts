import type {
  CadBearingDistanceLabelEntity,
  CadCurveLabelEntity,
  CadDimensionEntity,
  CadDimensionStyle,
  CadDisplayPrimitive,
  CadDisplayScene,
  CadAlignmentEntity,
  CadAlignmentElement,
  CadEntity,
  CadLeaderEntity,
  CadMTextEntity,
  CadPolylineEntity,
  CadProject,
} from './cadTypes';
import {
  buildCadInverseSummary,
  cadBuildParcelClosureSummary,
  formatCadNorthAzimuthDms,
  formatCadSweepDms,
} from './cadCogo';
import { cadSignedSweepDeg } from './cadGeometry';
import {
  cadAlignmentEndStation,
  cadAlignmentLength,
  cadAlignmentRawStationToDisplayStation,
  formatCadStation,
  cadPointAtAlignmentStationOffset,
} from './cadAlignment';
import { resolveCadEntityAppearance } from './cadAppearance';
import type { LineweightDisplayMode } from './cadViewportAppearance';
import { displayedStrokeWidthPx, opacityFromTransparency } from './cadViewportAppearance';
import { strokeWidth, surveyPointMarker, textFontSize } from './cadRendererStyle';
import { buildCadSurveyTablePrimitives } from './cadSurveyTableRender';
import { expandedBlockPrimitives } from './cadRendererBlocks';
import type { CadSurfaceCache } from './cadSurfaceCache';
import { buildSurfaceDisplayLayers, type SurfaceContourDisplayInput } from './cadSurfaceView';
import { buildVolumeDisplayLayers } from './cadVolumeView';
import type { CadSurfaceVolumeCache } from './surfaceVolumeCache';
import { materializeBoundPointLabel } from './cadPointLabelStyles';
import {
  resolveCadAnnotationAnchor,
  type CadAnnotationAnchor,
} from './annotation/cadAnnotationAnchors';
import { arrowheadTransform } from './annotation/cadAnnotationArrowheads';
import {
  paperHeightMmToModelMeters,
  resolveAnnotationScaleDenominator,
} from './annotation/cadAnnotationSettings';
import { resolveCadAnnotationTextMetrics } from './annotation/cadAnnotationTextMetrics';
import {
  deriveCadDimensionGeometry,
  type CadDimensionGeometry,
  type CadDimensionGeometryInput,
} from './annotation/cadDimensionGeometry';
import {
  bearingLabelPlacement,
  deriveBearingDistanceLabel,
  deriveCurveLabel,
} from './annotation/cadSurveyLabels';
import {
  attachmentRowOffsets,
  attachmentTextAnchor,
  attachmentVertical,
  curveLabelPlacement,
  leaderTextReferencePoint,
  normalizeTextAttachment,
  sumOffsets,
} from './annotation/cadAnnotationPlacement';
import { buildCadProjectLookup, type CadProjectLookup } from './cadProjectLookup';

export interface BuildCadDisplaySceneOptions {
  /**
   * Workspace-only display preference (never dirties the drawing or the
   * stored mm value). `thin` (default) reproduces the legacy normalized
   * look exactly; `scaled` maps the resolved lineweight with clamping.
   */
  lineweightDisplay?: LineweightDisplayMode;
  /**
   * Phase 18F — session mesh cache + per-surface built-revision index.
   * Absent = definition-only (no surface layers); the export scene never
   * passes it, so DXF/SVG/PDF output is unchanged by surfaces.
   */
  surfaceCache?: CadSurfaceCache;
  surfaceRevisionIndex?: ReadonlyMap<string, readonly string[]>;
  /**
   * Phase 18H — per-surface cached contour sets for display attach.
   * Absent = no contour display. Export scenes never pass it (surfaces
   * stay model-only deliverables; DXF contour export stays excluded).
   * NEXT INTERCHANGE STEP (not implemented): optional DXF LWPOLYLINE
   * contour export derived from the cached contour sets at export time —
   * keep excluded until a consumer contract pins layer/level mapping.
   */
  surfaceContours?: (_surfaceId: string) => SurfaceContourDisplayInput | null | undefined;
  /**
   * Phase 18I — session volume cache (+ TIN cache for CURRENT gating).
   * Absent = no volume display. Export scenes never pass it.
   */
  surfaceVolume?: { tinCache: import('./cadSurfaceCache').CadSurfaceCache; volumeCache: CadSurfaceVolumeCache };
  /**
   * Phase 18P — pre-built project index. Absent = the scene builds one for
   * this pass. Callers that already resolved a lookup (sheet export) pass
   * theirs to avoid a second O(n) build.
   */
  lookup?: CadProjectLookup;
}

interface SceneRenderContext {
  lookup: CadProjectLookup;
  /** Same map as `lookup.layerById`; kept so block expansion reuses the index. */
  layerById: CadProjectLookup['layerById'];
  linetypeScale: number;
  lineweightDisplay: LineweightDisplayMode;
}

const sceneRenderContext = (
  project: CadProject,
  options?: BuildCadDisplaySceneOptions,
): SceneRenderContext => {
  const lookup = options?.lookup ?? buildCadProjectLookup(project);
  return {
    lookup,
    layerById: lookup.layerById,
    linetypeScale: project.linetypeScale ?? 1,
    lineweightDisplay: options?.lineweightDisplay ?? 'thin',
  };
};

interface EntityScreenStyle {
  stroke: string;
  opacity: number | undefined;
  dashPatternUnits: number[] | undefined;
  widthPx: (_legacyFallbackPx?: number) => number;
}

/** Synthesized-label color: the SOURCE entity's resolved color (trap #5) —
 *  explicit override → style → layer → default — never the labels layer. */
const sourceLabelStroke = (ctx: SceneRenderContext, entity: CadEntity): string =>
  resolveCadEntityAppearance({
    entity,
    layer: ctx.lookup.layerById.get(entity.layerId) ?? null,
    styleById: ctx.lookup.styleById,
  }).color;

/** Authoritative entity styling: every geometry primitive resolves color,
 *  linetype, lineweight, and transparency through the §4-5 resolver.
 *  Synthesized *label* primitives intentionally keep the source-style color
 *  (trap #5) and bypass this helper. */
const entityScreenStyle = (
  project: CadProject,
  ctx: SceneRenderContext,
  entity: CadEntity,
  legacyFallbackPx: number,
): EntityScreenStyle => {
  const resolved = resolveCadEntityAppearance({
    entity,
    layer: ctx.lookup.layerById.get(entity.layerId),
    styleById: ctx.lookup.styleById,
  });
  const pattern = ctx.lookup.lineTypeById.get(resolved.lineTypeId)?.dashPattern;
  // Legacy exact px (style.strokeWidth ?? per-type fallback): thin mode must
  // reproduce today's rendering pixel-for-pixel, including custom styles.
  const legacyPx = strokeWidth(project, entity, legacyFallbackPx, ctx.lookup);
  return {
    stroke: resolved.color,
    opacity: opacityFromTransparency(resolved.transparency),
    dashPatternUnits:
      pattern != null && pattern.length > 0
        ? pattern.map((entry) => entry * ctx.linetypeScale)
        : undefined,
    widthPx: (legacyFallback: number = legacyPx): number =>
      displayedStrokeWidthPx(resolved.lineweightMm, ctx.lineweightDisplay, legacyFallback),
  };
};

const buildVertexPrimitives = (
  project: CadProject,
  ctx: SceneRenderContext,
  entity: Extract<CadEntity, { vertices: Array<{ x: number; y: number }> }>,
): CadDisplayPrimitive[] => {
  const style = entityScreenStyle(
    project,
    ctx,
    entity,
    entity.type === 'parcel' ? 1.5 : 1.25,
  );
  const points =
    entity.type === 'polygon' || entity.type === 'parcel'
      ? [...entity.vertices, entity.vertices[0]].filter(
          (point): point is { x: number; y: number } => point != null,
        )
      : entity.vertices;
  // Accumulated drawing-unit length keeps dashes continuous across segments.
  let accumulatedUnits = 0;
  return points.slice(0, -1).map((vertex, index) => {
    const next = points[index + 1]!;
    const offsetUnits = style.dashPatternUnits != null ? accumulatedUnits : undefined;
    accumulatedUnits += Math.hypot(next.x - vertex.x, next.y - vertex.y) * ctx.linetypeScale;
    return {
      kind: 'line',
      id: `primitive:${entity.id}:${index + 1}`,
      layerId: entity.layerId,
      sourceEntityId: entity.id,
      sourceSegmentId: `${entity.id}#${index}`,
      stroke: style.stroke,
      ...(style.opacity != null ? { opacity: style.opacity } : {}),
      ...(style.dashPatternUnits != null
        ? { dashPatternUnits: style.dashPatternUnits, dashOffsetUnits: offsetUnits ?? 0 }
        : {}),
      points: [vertex, next],
      strokeWidth: style.widthPx(),
    };
  });
};

const polylineSegments = (
  entity: CadPolylineEntity,
): Array<{
  start: { x: number; y: number };
  end: { x: number; y: number };
  idSuffix: string;
}> => entity.vertices.slice(0, -1).map((vertex, index) => ({
  start: vertex,
  end: entity.vertices[index + 1]!,
  idSuffix: `${index + 1}`,
}));

const normalizeReadableLabelRotation = (rotationDeg: number): number => {
  let normalized = ((rotationDeg + 180) % 360 + 360) % 360 - 180;
  if (normalized > 90) normalized -= 180;
  if (normalized < -90) normalized += 180;
  return normalized;
};

const normalizeArcSweepAngles = (
  startAngleDeg: number,
  endAngleDeg: number,
): { startAngleDeg: number; endAngleDeg: number; signedSweepDeg: number; sweepDeg: number } => {
  const normalizedStart = ((startAngleDeg % 360) + 360) % 360;
  const signedSweepDeg = cadSignedSweepDeg(startAngleDeg, endAngleDeg);
  return {
    startAngleDeg: normalizedStart,
    endAngleDeg: normalizedStart + signedSweepDeg,
    signedSweepDeg,
    sweepDeg: Math.max(0.0001, Math.abs(signedSweepDeg)),
  };
};

const buildTraverseLabelPrimitives = (
  project: CadProject,
  ctx: SceneRenderContext,
  entity: CadPolylineEntity,
): CadDisplayPrimitive[] => {
  if (entity.metadata?.createdBy !== 'TRAVERSE') return [];
  const stroke = sourceLabelStroke(ctx, entity);
  const fontSize = textFontSize(project, entity, 11, ctx.lookup);
  return polylineSegments(entity).flatMap((segment) => {
    const inverse = buildCadInverseSummary(segment.start, segment.end);
    const dx = segment.end.x - segment.start.x;
    const dy = segment.end.y - segment.start.y;
    const length = Math.hypot(dx, dy);
    if (length <= 1e-9) return [];

    const midpoint = {
      x: (segment.start.x + segment.end.x) / 2,
      y: (segment.start.y + segment.end.y) / 2,
    };
    const normal = { x: -dy / length, y: dx / length };
    const offsetDistance = Math.max(length * 0.025, 1.2);
    const rotationDeg = normalizeReadableLabelRotation(-((Math.atan2(dy, dx) * 180) / Math.PI));

    return [
      {
        kind: 'text',
        id: `primitive:${entity.id}:azimuth:${segment.idSuffix}`,
        layerId: 'labels',
        sourceEntityId: entity.id,
        stroke,
        point: {
          x: midpoint.x + normal.x * offsetDistance,
          y: midpoint.y + normal.y * offsetDistance,
        },
        text: formatCadNorthAzimuthDms(inverse.azimuthDeg),
        fontSize,
        rotationDeg,
        textAnchor: 'middle',
      },
      {
        kind: 'text',
        id: `primitive:${entity.id}:distance:${segment.idSuffix}`,
        layerId: 'labels',
        sourceEntityId: entity.id,
        stroke,
        point: {
          x: midpoint.x - normal.x * offsetDistance,
          y: midpoint.y - normal.y * offsetDistance,
        },
        text: `${inverse.distance.toFixed(3)} m`,
        fontSize,
        rotationDeg,
        textAnchor: 'middle',
      },
    ];
  });
};

const buildParcelLabelPrimitive = (
  project: CadProject,
  ctx: SceneRenderContext,
  entity: Extract<CadEntity, { type: 'parcel' }>,
): CadDisplayPrimitive[] => {
  if (entity.areaSquareMeters == null || entity.perimeterMeters == null || entity.vertices.length < 3) {
    return [];
  }
  const metrics = cadBuildParcelClosureSummary(entity.vertices);
  if (!metrics) return [];
  return [{
    kind: 'text',
    id: `primitive:${entity.id}:parcel-label`,
    layerId: 'labels',
    sourceEntityId: entity.id,
    stroke: sourceLabelStroke(ctx, entity),
    point: metrics.centroid,
    text: `${entity.areaSquareMeters.toFixed(3)} m²\n${entity.perimeterMeters.toFixed(3)} m`,
    fontSize: textFontSize(project, entity, 11, ctx.lookup),
    textAnchor: 'middle',
  }];
};

const buildArcLabelPrimitive = (
  project: CadProject,
  ctx: SceneRenderContext,
  entity: Extract<CadEntity, { type: 'arc' }>,
): CadDisplayPrimitive[] => {
  const { startAngleDeg, signedSweepDeg, sweepDeg } = normalizeArcSweepAngles(
    entity.startAngleDeg,
    entity.endAngleDeg,
  );
  const midAngleDeg = startAngleDeg + signedSweepDeg / 2;
  const midAngleRad = (midAngleDeg * Math.PI) / 180;
  const labelRadius = Math.max(entity.radius - Math.max(entity.radius * 0.18, 2), entity.radius * 0.45);
  const tangentAngleDeg = midAngleDeg + 90;
  const rotationDeg = normalizeReadableLabelRotation(-tangentAngleDeg);
  const arcLength = entity.radius * ((sweepDeg * Math.PI) / 180);
  return [{
    kind: 'text',
    id: `primitive:${entity.id}:curve-label`,
    layerId: 'labels',
    sourceEntityId: entity.id,
    stroke: sourceLabelStroke(ctx, entity),
    point: {
      x: entity.centerX + Math.cos(midAngleRad) * labelRadius,
      y: entity.centerY + Math.sin(midAngleRad) * labelRadius,
    },
    text: `${formatCadSweepDms(sweepDeg)}\nR ${entity.radius.toFixed(3)} m\nL ${arcLength.toFixed(3)} m`,
    fontSize: textFontSize(project, entity, 11, ctx.lookup),
    rotationDeg,
    textAnchor: 'middle',
  }];
};

const buildAlignmentLabelPrimitive = (
  project: CadProject,
  ctx: SceneRenderContext,
  entity: CadAlignmentEntity,
): CadDisplayPrimitive[] => {
  const totalLength = cadAlignmentLength(entity);
  const endStation = cadAlignmentEndStation(entity);
  if (entity.elements.length === 0 || totalLength <= 1e-9 || endStation == null) {
    return [];
  }

  const midpointRawStation = entity.startStation + totalLength / 2;
  const midpointDisplayStation = cadAlignmentRawStationToDisplayStation(entity, midpointRawStation);
  if (midpointDisplayStation == null) return [];

  const labelOffset = Math.max(Math.min(totalLength * 0.02, 8), 1.5);
  const midpoint = cadPointAtAlignmentStationOffset(entity, midpointDisplayStation, labelOffset);
  if (!midpoint) return [];
  const rotationDeg = buildAlignmentLabelRotation(entity.elements[midpoint.elementIndex], midpoint.point);
  if (rotationDeg == null) return [];

  return [{
    kind: 'text',
    id: `primitive:${entity.id}:alignment-label`,
    layerId: 'labels',
    sourceEntityId: entity.id,
    stroke: sourceLabelStroke(ctx, entity),
    point: midpoint.point,
    text: `${entity.name}\nSTA ${formatCadStation(entity.startStation)} - ${formatCadStation(endStation)}`,
    fontSize: textFontSize(project, entity, 11, ctx.lookup),
    rotationDeg,
    textAnchor: 'middle',
  }];
};

const buildAlignmentLabelRotation = (
  element: CadAlignmentElement | undefined,
  point: { x: number; y: number },
): number | null => {
  if (!element) return null;
  if (element.kind === 'line') {
    return normalizeReadableLabelRotation(
      -((Math.atan2(element.end.y - element.start.y, element.end.x - element.start.x) * 180) / Math.PI),
    );
  }
  const radiusAngleDeg =
    ((Math.atan2(point.y - element.center.y, point.x - element.center.x) * 180) / Math.PI);
  const tangentAngleDeg =
    radiusAngleDeg + (cadSignedSweepDeg(element.startAngleDeg, element.endAngleDeg) >= 0 ? 90 : -90);
  return normalizeReadableLabelRotation(-tangentAngleDeg);
};

const buildAlignmentStationEquationLabelPrimitives = (
  project: CadProject,
  ctx: SceneRenderContext,
  entity: CadAlignmentEntity,
): CadDisplayPrimitive[] => {
  if (!Array.isArray(entity.stationEquations) || entity.stationEquations.length === 0) {
    return [];
  }

  return entity.stationEquations.flatMap((equation, index) => {
    const labelOffset = 3 + index * 1.5;
    const marker = cadPointAtAlignmentStationOffset(entity, equation.aheadStation, labelOffset);
    if (!marker) return [];
    const rotationDeg = buildAlignmentLabelRotation(entity.elements[marker.elementIndex], marker.point);
    if (rotationDeg == null) return [];
    return [{
      kind: 'text' as const,
      id: `primitive:${entity.id}:station-equation-label:${index + 1}`,
      layerId: 'labels',
      sourceEntityId: entity.id,
      stroke: sourceLabelStroke(ctx, entity),
      point: marker.point,
      text: `EQ ${formatCadStation(equation.backStation)} = ${formatCadStation(equation.aheadStation)}`,
      fontSize: textFontSize(project, entity, 10, ctx.lookup),
      rotationDeg,
      textAnchor: 'middle' as const,
    }];
  });
};

const withDash = (
  style: EntityScreenStyle,
  offsetUnits = 0,
): { dashPatternUnits?: number[]; dashOffsetUnits?: number } =>
  style.dashPatternUnits != null
    ? { dashPatternUnits: style.dashPatternUnits, dashOffsetUnits: offsetUnits }
    : {};

const withOpacity = (
  style: EntityScreenStyle,
): { opacity?: number } =>
  style.opacity != null ? { opacity: style.opacity } : {};

// ---------------------------------------------------------------------------
// Phase 18O annotation derivation (display only; never persisted).
// Every derived primitive carries sourceEntityId = owning annotation id and
// rides the host layerId, so derived geometry is never independently
// selectable. Broken references fall back to the persisted point with a
// BROKEN marker text primitive.
// ---------------------------------------------------------------------------

/** Style-resolved model text height (meters) + line spacing; legacy fallback. */
const annotationTextFont = (
  project: CadProject,
  entity: CadEntity,
  textStyleId: string | undefined,
  lookup?: CadProjectLookup,
): { fontSize: number; lineSpacingFactor: number } => {
  const fallback = { fontSize: textFontSize(project, entity, 11, lookup), lineSpacingFactor: 1 };
  const textStyle =
    textStyleId != null
      ? lookup
        ? lookup.textStyleById.get(textStyleId)
        : project.styleLibrary.textStyles.find((entry) => entry.id === textStyleId)
      : undefined;
  if (!textStyle) return fallback;
  const metrics = resolveCadAnnotationTextMetrics({
    fontFamily: textStyle.fontFamily,
    fontSize: textStyle.fontSize,
    heightMode: textStyle.heightMode,
    modelHeight: textStyle.modelHeight,
    paperHeightMm: textStyle.paperHeightMm,
    widthFactor: textStyle.widthFactor,
    lineSpacingFactor: textStyle.lineSpacingFactor,
    fontWeight: textStyle.fontWeight === 'bold' ? 700 : 400,
    fontStyle: textStyle.fontStyle,
    annotationScaleDenominator: resolveAnnotationScaleDenominator(project.annotationSettings),
    unitsMode: project.metadata.units,
  });
  return { fontSize: metrics.modelHeight, lineSpacingFactor: metrics.lineSpacingFactor };
};

/** Arrow size in model meters (paper mode scales through annotation settings). */
const annotationArrowSize = (
  project: CadProject,
  size: number,
  mode?: 'model' | 'paper',
): number => {
  if (mode === 'paper') {
    const model = paperHeightMmToModelMeters(
      size,
      resolveAnnotationScaleDenominator(project.annotationSettings),
      project.metadata.units,
    );
    if (Number.isFinite(model) && model > 0) return model;
  }
  return size;
};

const brokenAnnotationPrimitive = (
  project: CadProject,
  ctx: SceneRenderContext,
  entity: CadEntity,
  point: { x: number; y: number },
): CadDisplayPrimitive => {
  const style = entityScreenStyle(project, ctx, entity, 1.2);
  return {
    kind: 'text',
    id: `primitive:${entity.id}:broken`,
    layerId: entity.layerId,
    sourceEntityId: entity.id,
    stroke: style.stroke,
    ...withOpacity(style),
    point,
    text: 'BROKEN',
    fontSize: textFontSize(project, entity, 11, ctx.lookup),
    textAnchor: 'middle',
  };
};

/**
 * Arrowhead via the existing block-reference expansion path (host layer +
 * host source id, never independently selectable). Plain shaft-stub line
 * fallback when the block definition is missing.
 */
const arrowheadPrimitives = (
  project: CadProject,
  ctx: SceneRenderContext,
  entity: CadEntity,
  style: EntityScreenStyle,
  blockDefinitionId: string,
  x: number,
  y: number,
  directionDeg: number,
  size: number,
  suffix: string,
): CadDisplayPrimitive[] => {
  if (!(size > 0)) return [];
  let transform;
  try {
    transform = arrowheadTransform({ x, y, directionDeg, size });
  } catch {
    return [];
  }
  const expanded = expandedBlockPrimitives(
    project,
    ctx,
    blockDefinitionId,
    {
      x: transform.x,
      y: transform.y,
      rotationDeg: transform.rotationDeg,
      scaleX: transform.scaleX,
      scaleY: transform.scaleY,
    },
    entity,
    `primitive:${entity.id}:${suffix}`,
    (child) => toPrimitives(project, ctx, child),
  );
  if (expanded) return expanded;
  const radians = (transform.rotationDeg * Math.PI) / 180;
  const tail = { x: x - Math.cos(radians) * size, y: y - Math.sin(radians) * size };
  return [{
    kind: 'line',
    id: `primitive:${entity.id}:${suffix}`,
    layerId: entity.layerId,
    sourceEntityId: entity.id,
    stroke: style.stroke,
    ...withOpacity(style),
    ...withDash(style),
    points: [{ x, y }, tail],
    strokeWidth: style.widthPx(),
  }];
};

const mtextAttachmentAnchor = (attachment: CadMTextEntity['attachment']): 'start' | 'middle' | 'end' =>
  attachment.endsWith('right') ? 'end' : attachment.endsWith('center') ? 'middle' : 'start';

const buildMTextPrimitives = (
  project: CadProject,
  ctx: SceneRenderContext,
  entity: CadMTextEntity,
): CadDisplayPrimitive[] => {
  const style = entityScreenStyle(project, ctx, entity, 1.2);
  const font = annotationTextFont(project, entity, entity.textStyleId, ctx.lookup);
  const lines = entity.text.split('\n');
  const radians = (entity.rotationDeg * Math.PI) / 180;
  const up = { x: -Math.sin(radians), y: Math.cos(radians) };
  const lineHeight = font.fontSize * font.lineSpacingFactor;
  const totalHeight = lineHeight * lines.length;
  const topShift = entity.attachment.startsWith('middle')
    ? (totalHeight - lineHeight) / 2
    : entity.attachment.startsWith('bottom')
      ? totalHeight - lineHeight
      : 0;
  const anchor = mtextAttachmentAnchor(entity.attachment);
  return lines.map((lineText, index) => {
    const shift = topShift - index * lineHeight;
    return {
      kind: 'text' as const,
      id: `primitive:${entity.id}:${index + 1}`,
      layerId: entity.layerId,
      sourceEntityId: entity.id,
      stroke: style.stroke,
      ...withOpacity(style),
      point: { x: entity.x + up.x * shift, y: entity.y + up.y * shift },
      text: lineText,
      fontSize: font.fontSize,
      ...(entity.rotationDeg !== 0 ? { rotationDeg: entity.rotationDeg } : {}),
      textAnchor: anchor,
    };
  });
};

const leaderTextPrimitives = (
  entity: CadLeaderEntity,
  style: EntityScreenStyle,
  reference: { x: number; y: number },
  text: string,
  font: { fontSize: number; lineSpacingFactor: number },
): CadDisplayPrimitive[] => {
  const attachment = normalizeTextAttachment(entity.textAttachment);
  const anchor = attachmentTextAnchor(attachment);
  const offsets = attachmentRowOffsets(
    attachmentVertical(attachment),
    text.split('\n').length,
    font.fontSize,
    font.lineSpacingFactor,
  );
  return text.split('\n').map((lineText, index) => ({
    kind: 'text' as const,
    id: index === 0 ? `primitive:${entity.id}:text` : `primitive:${entity.id}:text:${index + 1}`,
    layerId: entity.layerId,
    sourceEntityId: entity.id,
    stroke: style.stroke,
    ...withOpacity(style),
    point: { x: reference.x, y: reference.y + offsets[index]! },
    text: lineText,
    fontSize: font.fontSize,
    textAnchor: anchor,
  }));
};

const buildLeaderPrimitives = (
  project: CadProject,
  ctx: SceneRenderContext,
  entity: CadLeaderEntity,
): CadDisplayPrimitive[] => {
  const style = entityScreenStyle(project, ctx, entity, 1.2);
  const resolution = resolveCadAnnotationAnchor(entity.arrowAnchor, project);
  if (!resolution.ok) {
    return [brokenAnnotationPrimitive(
      project,
      ctx,
      entity,
      { x: resolution.fallbackX, y: resolution.fallbackY },
    )];
  }
  const arrowPoint = { x: resolution.x, y: resolution.y };
  const through = [arrowPoint, ...entity.vertices];
  const primitives: CadDisplayPrimitive[] = through.slice(0, -1).map((vertex, index) => {
    const next = through[index + 1]!;
    return {
      kind: 'line' as const,
      id: `primitive:${entity.id}:${index + 1}`,
      layerId: entity.layerId,
      sourceEntityId: entity.id,
      sourceSegmentId: `${entity.id}#${index}`,
      stroke: style.stroke,
      ...withOpacity(style),
      ...withDash(style),
      points: [vertex, next] as [{ x: number; y: number }, { x: number; y: number }],
      strokeWidth: style.widthPx(),
    };
  });
  const leaderStyle = ctx.lookup.leaderStyleById.get(entity.leaderStyleId);
  const last = through.at(-1) ?? arrowPoint;
  if (!leaderStyle) {
    primitives.push(...leaderTextPrimitives(
      entity,
      style,
      last,
      entity.text,
      { fontSize: textFontSize(project, entity, 11, ctx.lookup), lineSpacingFactor: 1.2 },
    ));
    return primitives;
  }
  const arrival = through[1] ?? { x: arrowPoint.x + 1, y: arrowPoint.y };
  const arrowDirDeg =
    (Math.atan2(arrowPoint.y - arrival.y, arrowPoint.x - arrival.x) * 180) / Math.PI;
  primitives.push(...arrowheadPrimitives(
    project,
    ctx,
    entity,
    style,
    leaderStyle.arrowBlockDefinitionId,
    arrowPoint.x,
    arrowPoint.y,
    arrowDirDeg,
    annotationArrowSize(project, leaderStyle.arrowSize, leaderStyle.arrowSizeMode),
    'arrow',
  ));
  const before = through.length >= 2 ? through[through.length - 2]! : { x: last.x - 1, y: last.y };
  const dx = last.x - before.x;
  const dy = last.y - before.y;
  const length = Math.hypot(dx, dy);
  const dir = length > 1e-12 ? { x: dx / length, y: dy / length } : { x: 1, y: 0 };
  const landingEnd = {
    x: last.x + dir.x * leaderStyle.landingLength,
    y: last.y + dir.y * leaderStyle.landingLength,
  };
  if (leaderStyle.landingLength > 0) {
    primitives.push({
      kind: 'line',
      id: `primitive:${entity.id}:landing`,
      layerId: entity.layerId,
      sourceEntityId: entity.id,
      stroke: style.stroke,
      ...withOpacity(style),
      ...withDash(style),
      points: [last, landingEnd],
      strokeWidth: style.widthPx(),
    });
  }
  const font = annotationTextFont(
    project,
    entity,
    entity.textStyleId ?? leaderStyle.textStyleId,
    ctx.lookup,
  );
  primitives.push(...leaderTextPrimitives(
    entity,
    style,
    leaderTextReferencePoint(landingEnd, dir, leaderStyle.textGap),
    entity.text,
    font,
  ));
  return primitives;
};

interface ResolvedDimensionAnchors {
  p1: { x: number; y: number };
  p2: { x: number; y: number };
  vertex?: { x: number; y: number };
  ray1Point?: { x: number; y: number };
  ray2Point?: { x: number; y: number };
  center?: { x: number; y: number };
  radius?: number;
  arcPoint?: { x: number; y: number };
}

const resolveDimensionAnchors = (
  project: CadProject,
  entity: CadDimensionEntity,
  lookup?: CadProjectLookup,
): ResolvedDimensionAnchors | null => {
  const resolveOne = (anchor: CadAnnotationAnchor): { x: number; y: number } | null => {
    const resolution = resolveCadAnnotationAnchor(anchor, project, lookup);
    return resolution.ok ? { x: resolution.x, y: resolution.y } : null;
  };
  switch (entity.dimensionKind) {
    case 'linear':
    case 'aligned': {
      const raw1 = entity.defPoint1 ?? entity.anchors[0];
      const raw2 = entity.defPoint2 ?? entity.anchors[1];
      if (!raw1 || !raw2) return null;
      const p1 = resolveOne(raw1);
      const p2 = resolveOne(raw2);
      return p1 && p2 ? { p1, p2 } : null;
    }
    case 'angular': {
      if (entity.anchors.length >= 3) {
        const vertex = resolveOne(entity.anchors[0]!);
        const ray1Point = resolveOne(entity.anchors[1]!);
        const ray2Point = resolveOne(entity.anchors[2]!);
        if (!vertex || !ray1Point || !ray2Point) return null;
        return { p1: ray1Point, p2: ray2Point, vertex, ray1Point, ray2Point };
      }
      if (entity.anchors.length >= 2) {
        const p1 = resolveOne(entity.anchors[0]!);
        const p2 = resolveOne(entity.anchors[1]!);
        return p1 && p2 ? { p1, p2 } : null;
      }
      return null;
    }
    case 'radius':
    case 'diameter': {
      const rawCenter = entity.anchors[0];
      const rawArc = entity.anchors[1];
      if (rawCenter && rawArc) {
        const center = resolveOne(rawCenter);
        const arcPoint = resolveOne(rawArc);
        if (!center || !arcPoint) return null;
        return {
          p1: center,
          p2: arcPoint,
          center,
          arcPoint,
          radius: Math.hypot(arcPoint.x - center.x, arcPoint.y - center.y),
        };
      }
      // Phase 18P: production DIMRADIUS/DIMDIAMETER commits ONE defining
      // anchor (the arc pick; the second pick is the dim-line point). When
      // that anchor is an arc-point ref, derive center + radius live from
      // the arc entity so radius edits re-measure instead of rendering
      // BROKEN. A lone fixed anchor still resolves null (no association).
      if (rawCenter && !rawArc && rawCenter.kind === 'arc-point') {
        const source = lookup
          ? lookup.entityById.get(rawCenter.entityId)
          : project.entities.find((candidate) => candidate.id === rawCenter.entityId);
        if (!source || source.type !== 'arc') return null;
        const center = { x: source.centerX, y: source.centerY };
        const anchorPoint = resolveOne(rawCenter);
        if (!anchorPoint) return null;
        let arcPoint: { x: number; y: number };
        if (rawCenter.point === 'center') {
          const dx = entity.dimLinePoint.x - center.x;
          const dy = entity.dimLinePoint.y - center.y;
          const length = Math.hypot(dx, dy);
          const direction =
            length > 1e-12 ? { x: dx / length, y: dy / length } : { x: 1, y: 0 };
          arcPoint = {
            x: center.x + direction.x * source.radius,
            y: center.y + direction.y * source.radius,
          };
        } else {
          arcPoint = anchorPoint;
        }
        return {
          p1: center,
          p2: arcPoint,
          center,
          arcPoint,
          radius: source.radius,
        };
      }
      return null;
    }
  }
};

export interface ResolvedDimensionDerivation {
  style: CadDimensionStyle;
  geometry: CadDimensionGeometry;
  textHeight: number;
  arrowSize: number;
}

/**
 * Shared dimension derivation (renderer + spatial bounds stay on one source
 * of truth). Null when the style is unknown or a required anchor is broken.
 */
export const resolveDimensionDerivation = (
  project: CadProject,
  entity: CadDimensionEntity,
  lookup?: CadProjectLookup,
): ResolvedDimensionDerivation | null => {
  const style = lookup
    ? lookup.dimensionStyleById.get(entity.dimensionStyleId)
    : project.dimensionStyles?.find((entry) => entry.id === entity.dimensionStyleId);
  if (!style) return null;
  const resolved = resolveDimensionAnchors(project, entity, lookup);
  if (!resolved) return null;
  const textHeight = annotationTextFont(project, entity, style.textStyleId, lookup).fontSize;
  const arrowSize = annotationArrowSize(project, style.arrowSize, style.arrowSizeMode);
  const kind: CadDimensionGeometryInput['kind'] =
    entity.dimensionKind === 'linear'
      ? entity.orientation === 'horizontal'
        ? 'linear-horizontal'
        : entity.orientation === 'vertical'
          ? 'linear-vertical'
          : 'aligned'
      : entity.dimensionKind;
  const geometry = deriveCadDimensionGeometry({
    kind,
    p1: resolved.p1,
    p2: resolved.p2,
    ...(resolved.vertex ? { vertex: resolved.vertex } : {}),
    ...(resolved.ray1Point && resolved.ray2Point
      ? { ray1Point: resolved.ray1Point, ray2Point: resolved.ray2Point }
      : {}),
    ...(resolved.center && resolved.arcPoint
      ? { center: resolved.center, radius: resolved.radius, arcPoint: resolved.arcPoint }
      : {}),
    dimLinePoint: entity.dimLinePoint,
    ...(entity.textPoint != null ? { textPoint: entity.textPoint } : {}),
    textGap: style.textGap,
    arrowSize,
    extensionOffset: style.extensionOffset,
    extensionOvershoot: style.extensionOvershoot,
    textHeight,
    decimalPrecision: style.decimalPrecision,
    ...(style.prefix ? { prefix: style.prefix } : {}),
    ...(style.suffix ? { suffix: style.suffix } : {}),
  });
  return { style, geometry, textHeight, arrowSize };
};

const buildDimensionPrimitives = (
  project: CadProject,
  ctx: SceneRenderContext,
  entity: CadDimensionEntity,
): CadDisplayPrimitive[] => {
  const style = entityScreenStyle(project, ctx, entity, 1.2);
  const fallbackPoint = entity.textPoint ?? entity.dimLinePoint;
  const lineFallback = (): CadDisplayPrimitive[] => [
    {
      kind: 'line',
      id: `primitive:${entity.id}`,
      layerId: entity.layerId,
      sourceEntityId: entity.id,
      stroke: style.stroke,
      ...withOpacity(style),
      ...withDash(style),
      points: [entity.dimLinePoint, fallbackPoint],
      strokeWidth: style.widthPx(),
    },
    {
      kind: 'text',
      id: `primitive:${entity.id}:text`,
      layerId: entity.layerId,
      sourceEntityId: entity.id,
      stroke: style.stroke,
      ...withOpacity(style),
      point: fallbackPoint,
      text: entity.textOverride ?? 'Dimension',
      fontSize: textFontSize(project, entity, 11, ctx.lookup),
      textAnchor: 'middle',
    },
  ];
  const derived: ResolvedDimensionDerivation | null = resolveDimensionDerivation(project, entity, ctx.lookup);
  if (!derived) {
    const anchors = resolveDimensionAnchors(project, entity, ctx.lookup);
    if (!anchors) return [brokenAnnotationPrimitive(project, ctx, entity, fallbackPoint)];
    return lineFallback();
  }
  const { geometry } = derived;
  return [
    ...geometry.extensionSegments.map((segment, index): CadDisplayPrimitive => ({
      kind: 'line',
      id: `primitive:${entity.id}:ext:${index + 1}`,
      layerId: entity.layerId,
      sourceEntityId: entity.id,
      stroke: style.stroke,
      ...withOpacity(style),
      ...withDash(style),
      points: [segment.from, segment.to],
      strokeWidth: style.widthPx(),
    })),
    ...geometry.dimensionSegments.map((segment, index): CadDisplayPrimitive => ({
      kind: 'line',
      id: `primitive:${entity.id}:dim:${index + 1}`,
      layerId: entity.layerId,
      sourceEntityId: entity.id,
      stroke: style.stroke,
      ...withOpacity(style),
      ...withDash(style),
      points: [segment.from, segment.to],
      strokeWidth: style.widthPx(),
    })),
    ...geometry.arrowTransforms.flatMap((arrow, index) =>
      arrowheadPrimitives(
        project,
        ctx,
        entity,
        style,
        derived.style.arrowBlockDefinitionId,
        arrow.x,
        arrow.y,
        arrow.rotationDeg,
        arrow.size,
        `arrow:${index + 1}`,
      ),
    ),
    {
      kind: 'text',
      id: `primitive:${entity.id}:text`,
      layerId: entity.layerId,
      sourceEntityId: entity.id,
      stroke: style.stroke,
      ...withOpacity(style),
      point: geometry.textPosition,
      text: entity.textOverride ?? geometry.formattedText,
      fontSize: derived.textHeight,
      ...(geometry.textRotationDeg !== 0 ? { rotationDeg: geometry.textRotationDeg } : {}),
      textAnchor: 'middle',
    },
  ];
};

const buildBearingLabelPrimitives = (
  project: CadProject,
  ctx: SceneRenderContext,
  entity: CadBearingDistanceLabelEntity,
): CadDisplayPrimitive[] => {
  const style = entityScreenStyle(project, ctx, entity, 1.2);
  const source = ctx.lookup.entityById.get(entity.sourceEntityId);
  if (source?.type !== 'line') {
    return [brokenAnnotationPrimitive(project, ctx, entity, entity.offset)];
  }
  const labelStyle = ctx.lookup.bearingLabelStyleById.get(entity.labelStyleId);
  const from = { x: source.fromX, y: source.fromY };
  const to = { x: source.toX, y: source.toY };
  const label = deriveBearingDistanceLabel({
    from,
    to,
    content: labelStyle?.content ?? 'bearing-distance',
    separator: labelStyle?.separator === 'space' ? ' ' : labelStyle?.separator === 'slash' ? '/' : '\n',
    distancePrecision: labelStyle?.decimalPrecision ?? 3,
    ...(entity.manualTextOverride !== undefined
      ? { manualTextOverride: entity.manualTextOverride }
      : {}),
  });
  const offsetMagnitude = labelStyle ? Math.hypot(labelStyle.offset.x, labelStyle.offset.y) : 0;
  const placement = bearingLabelPlacement(from, to, offsetMagnitude, entity.side === 'right' ? 'right' : 'left');
  const font = annotationTextFont(project, entity, labelStyle?.textStyleId, ctx.lookup);
  return [{
    kind: 'text',
    id: `primitive:${entity.id}`,
    layerId: entity.layerId,
    sourceEntityId: entity.id,
    stroke: style.stroke,
    ...withOpacity(style),
    point: { x: placement.x + entity.offset.x, y: placement.y + entity.offset.y },
    text: label.text,
    fontSize: font.fontSize,
    ...(placement.rotationDeg !== 0 ? { rotationDeg: placement.rotationDeg } : {}),
    textAnchor: 'middle',
  }];
};

const buildCurveLabelPrimitives = (
  project: CadProject,
  ctx: SceneRenderContext,
  entity: CadCurveLabelEntity,
): CadDisplayPrimitive[] => {
  const style = entityScreenStyle(project, ctx, entity, 1.2);
  const source = ctx.lookup.entityById.get(entity.sourceEntityId);
  const labelStyle = ctx.lookup.curveLabelStyleById.get(entity.labelStyleId);
  if (source?.type !== 'arc') {
    return [brokenAnnotationPrimitive(project, ctx, entity, entity.offset)];
  }
  const label = deriveCurveLabel({
    center: { x: source.centerX, y: source.centerY },
    radius: source.radius,
    startAngleDeg: source.startAngleDeg,
    endAngleDeg: source.endAngleDeg,
    fields: labelStyle?.fields ?? ['radius', 'delta', 'length'],
    decimalPrecision: labelStyle?.decimalPrecision ?? 3,
    ...(entity.manualTextOverride !== undefined
      ? { manualTextOverride: entity.manualTextOverride }
      : {}),
  });
  if (!label) return [brokenAnnotationPrimitive(project, ctx, entity, entity.offset)];
  const placement = curveLabelPlacement({
    center: { x: source.centerX, y: source.centerY },
    radius: source.radius,
    startAngleDeg: source.startAngleDeg,
    endAngleDeg: source.endAngleDeg,
    offset: sumOffsets(labelStyle?.offset, entity.offset),
  });
  if (!placement) return [brokenAnnotationPrimitive(project, ctx, entity, entity.offset)];
  const font = annotationTextFont(project, entity, labelStyle?.textStyleId, ctx.lookup);
  return [{
    kind: 'text',
    id: `primitive:${entity.id}`,
    layerId: entity.layerId,
    sourceEntityId: entity.id,
    stroke: style.stroke,
    ...withOpacity(style),
    point: { x: placement.x, y: placement.y },
    text: label.text,
    fontSize: font.fontSize,
    ...(placement.rotationDeg !== 0 ? { rotationDeg: placement.rotationDeg } : {}),
    textAnchor: 'middle',
  }];
};

const toPrimitives = (
  project: CadProject,
  ctx: SceneRenderContext,
  entity: CadEntity,
): CadDisplayPrimitive[] => {
  switch (entity.type) {
    case 'survey-point': {
      const style = entityScreenStyle(project, ctx, entity, 1.2);
      const marker = surveyPointMarker(project, entity, ctx.lookup);
      // No Display style: no marker primitive. The entity still exists and
      // stays selectable via Toolspace; only the marker is omitted.
      if (marker.hidden) return [];
      // Phase 18N block-backed marker: expand the definition at the point
      // (style scale/rotation); unknown definitions fall back to symbol.
      if (marker.blockDefinitionId != null) {
        const scale = marker.markerScale ?? 1;
        const expanded = expandedBlockPrimitives(
          project,
          ctx,
          marker.blockDefinitionId,
          { x: entity.x, y: entity.y, rotationDeg: marker.rotationDeg ?? 0, scaleX: scale, scaleY: scale },
          entity,
          `primitive:${entity.id}:marker`,
          (child) => toPrimitives(project, ctx, child),
        );
        if (expanded != null) return expanded;
      }
      return [{
        kind: 'point',
        id: `primitive:${entity.id}`,
        layerId: entity.layerId,
        sourceEntityId: entity.id,
        stroke: style.stroke,
        fill: style.stroke,
        ...withOpacity(style),
        point: { x: entity.x, y: entity.y },
        radius: marker.radius,
        ...(marker.shape != null ? { shape: marker.shape } : {}),
      }];
    }
    case 'line': {
      const style = entityScreenStyle(project, ctx, entity, 1.25);
      return [
        {
          kind: 'line',
          id: `primitive:${entity.id}`,
          layerId: entity.layerId,
          sourceEntityId: entity.id,
          sourceSegmentId: `${entity.id}#0`,
          stroke: style.stroke,
          ...withOpacity(style),
          ...withDash(style),
          points: [
            { x: entity.fromX, y: entity.fromY },
            { x: entity.toX, y: entity.toY },
          ],
          strokeWidth: style.widthPx(),
        },
      ];
    }
    case 'polyline':
      return [
        ...buildVertexPrimitives(project, ctx, entity),
        ...buildTraverseLabelPrimitives(project, ctx, entity),
      ];
    case 'polygon':
      return buildVertexPrimitives(project, ctx, entity);
    case 'parcel':
      return [
        ...buildVertexPrimitives(project, ctx, entity),
        ...buildParcelLabelPrimitive(project, ctx, entity),
      ];
    case 'arc': {
      const style = entityScreenStyle(project, ctx, entity, 1.25);
      return [
        {
          kind: 'arc',
          id: `primitive:${entity.id}`,
          layerId: entity.layerId,
          sourceEntityId: entity.id,
          stroke: style.stroke,
          ...withOpacity(style),
          ...withDash(style),
          center: { x: entity.centerX, y: entity.centerY },
          radius: entity.radius,
          startAngleDeg: entity.startAngleDeg,
          endAngleDeg: entity.endAngleDeg,
          strokeWidth: style.widthPx(),
        },
        ...buildArcLabelPrimitive(project, ctx, entity),
      ];
    }
    case 'alignment': {
      const style = entityScreenStyle(project, ctx, entity, 1.5);
      return [
        ...entity.elements.flatMap((element, index): CadDisplayPrimitive[] => {
          if (element.kind === 'line') {
            return [{
              kind: 'line',
              id: `primitive:${entity.id}:${index + 1}`,
              layerId: entity.layerId,
              sourceEntityId: entity.id,
              sourceSegmentId: `${entity.id}#${index}`,
              stroke: style.stroke,
              ...withOpacity(style),
              ...withDash(style),
              points: [element.start, element.end],
              strokeWidth: style.widthPx(),
            }];
          }
          return [{
            kind: 'arc',
            id: `primitive:${entity.id}:${index + 1}`,
            layerId: entity.layerId,
            sourceEntityId: entity.id,
            sourceSegmentId: `${entity.id}#${index}`,
            stroke: style.stroke,
            ...withOpacity(style),
            ...withDash(style),
            center: element.center,
            radius: element.radius,
            startAngleDeg: element.startAngleDeg,
            endAngleDeg: element.endAngleDeg,
            strokeWidth: style.widthPx(),
          }];
        }),
        ...buildAlignmentLabelPrimitive(project, ctx, entity),
        ...buildAlignmentStationEquationLabelPrimitives(project, ctx, entity),
      ];
    }
    case 'text': {
      const style = entityScreenStyle(project, ctx, entity, 1.2);
      // Associative label: materialized text/position/rotation; a No Label
      // style emits nothing. Unresolvable bindings fall back to baked.
      const bound = materializeBoundPointLabel(entity, project, ctx.lookup);
      if (bound != null) {
        if (!bound.visible) return [];
        return [{
          kind: 'text',
          id: `primitive:${entity.id}`,
          layerId: entity.layerId,
          sourceEntityId: entity.id,
          stroke: style.stroke,
          ...withOpacity(style),
          point: { x: bound.x, y: bound.y },
          text: bound.text,
          fontSize: textFontSize(project, entity, 11, ctx.lookup),
          ...(bound.rotationDeg !== 0 ? { rotationDeg: bound.rotationDeg } : {}),
          textAnchor: 'start',
        }];
      }
      return [{
        kind: 'text',
        id: `primitive:${entity.id}`,
        layerId: entity.layerId,
        sourceEntityId: entity.id,
        stroke: style.stroke,
        ...withOpacity(style),
        point: { x: entity.x, y: entity.y },
        text: entity.text,
        fontSize: textFontSize(project, entity, 11, ctx.lookup),
        textAnchor: 'start',
      }];
    }
    case 'error-ellipse': {
      const style = entityScreenStyle(project, ctx, entity, 1.1);
      return [{
        kind: 'ellipse',
        id: `primitive:${entity.id}`,
        layerId: entity.layerId,
        sourceEntityId: entity.id,
        stroke: style.stroke,
        ...withOpacity(style),
        ...withDash(style),
        center: { x: entity.centerX, y: entity.centerY },
        semiMajor: entity.semiMajor,
        semiMinor: entity.semiMinor,
        thetaDeg: entity.thetaDeg,
        strokeWidth: style.widthPx(),
      }];
    }
    case 'mtext':
      return buildMTextPrimitives(project, ctx, entity);
    case 'leader':
      return buildLeaderPrimitives(project, ctx, entity);
    case 'dimension':
      return buildDimensionPrimitives(project, ctx, entity);
    case 'bearing-label':
      return buildBearingLabelPrimitives(project, ctx, entity);
    case 'curve-label':
      return buildCurveLabelPrimitives(project, ctx, entity);
    case 'block-reference':
      // Phase 18N: expand to world-space children (single source with
      // snap/bounds/export). Dangling refs render nothing (load sanitize
      // drops them; this is the belt-and-suspenders fallback).
      return expandedBlockPrimitives(
        project,
        ctx,
        entity.blockDefinitionId,
        { x: entity.x, y: entity.y, rotationDeg: entity.rotationDeg, scaleX: entity.scaleX, scaleY: entity.scaleY, ...(entity.mirrored === true ? { mirrored: true as const } : {}) },
        entity,
        `primitive:${entity.id}`,
        (child) => toPrimitives(project, ctx, child),
      ) ?? [];
    case 'survey-table': {
      // Phase 19A: derived frame/grid/text primitives (bounded, never one
      // entity per cell). Values/geometry are recomputed at read time.
      const style = entityScreenStyle(project, ctx, entity, 1);
      return buildCadSurveyTablePrimitives(entity, project, {
        stroke: style.stroke,
        strokeWidthPx: style.widthPx(),
        fontSize: textFontSize(project, entity, 11, ctx.lookup),
        tagFontSize: textFontSize(project, entity, 9, ctx.lookup),
        ...(style.opacity != null ? { opacity: style.opacity } : {}),
      });
    }
  }
};

// NOTE: no layer-visibility filtering here (trap #1). The export scene needs
// hidden primitives; viewports filter via filterCadDisplaySceneForViewport.
export const buildCadDisplayScene = (
  project: CadProject,
  options?: BuildCadDisplaySceneOptions,
): CadDisplayScene => {
  const ctx = sceneRenderContext(project, options);
  return {
    bounds: project.bounds,
    primitives: project.entities
      .filter((entity) => entity.visible)
      .flatMap((entity) => toPrimitives(project, ctx, entity)),
    // Phase 18F — derived TIN layers alongside entity primitives. Empty
    // (not absent) when no surface is built so consumers skip uniformly.
    // Null cache (export scene, sheet viewports) = definition-only.
    surfaceLayers: options?.surfaceCache
      ? buildSurfaceDisplayLayers(project, options.surfaceCache, options.surfaceRevisionIndex, options.surfaceContours)
      : [],
    // Phase 18I — derived volume CUT/FILL paths alongside TIN layers.
    volumeLayers: options?.surfaceVolume
      ? buildVolumeDisplayLayers(project, options.surfaceVolume.tinCache, options.surfaceVolume.volumeCache)
      : [],
  };
};
