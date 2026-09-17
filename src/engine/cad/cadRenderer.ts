import type {
  CadDisplayPrimitive,
  CadDisplayScene,
  CadAlignmentEntity,
  CadAlignmentElement,
  CadEntity,
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
import { pointRadius, strokeWidth, textFontSize } from './cadRendererStyle';

export interface BuildCadDisplaySceneOptions {
  /**
   * Workspace-only display preference (never dirties the drawing or the
   * stored mm value). `thin` (default) reproduces the legacy normalized
   * look exactly; `scaled` maps the resolved lineweight with clamping.
   */
  lineweightDisplay?: LineweightDisplayMode;
}

interface SceneRenderContext {
  layerById: Map<string, CadProject['layers'][number]>;
  linetypeScale: number;
  lineweightDisplay: LineweightDisplayMode;
}

const sceneRenderContext = (
  project: CadProject,
  options?: BuildCadDisplaySceneOptions,
): SceneRenderContext => ({
  layerById: new Map(project.layers.map((layer) => [layer.id, layer])),
  linetypeScale: project.linetypeScale ?? 1,
  lineweightDisplay: options?.lineweightDisplay ?? 'thin',
});

interface EntityScreenStyle {
  stroke: string;
  opacity: number | undefined;
  dashPatternUnits: number[] | undefined;
  widthPx: (_legacyFallbackPx?: number) => number;
}

/** Synthesized-label color: the SOURCE entity's resolved color (trap #5) —
 *  explicit override → style → layer → default — never the labels layer. */
const sourceLabelStroke = (project: CadProject, entity: CadEntity): string =>
  resolveCadEntityAppearance({
    entity,
    layer: project.layers.find((layer) => layer.id === entity.layerId) ?? null,
    styleLibrary: project.styleLibrary,
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
    layer: ctx.layerById.get(entity.layerId),
    styleLibrary: project.styleLibrary,
  });
  const pattern = project.styleLibrary.lineTypes.find(
    (lineType) => lineType.id === resolved.lineTypeId,
  )?.dashPattern;
  // Legacy exact px (style.strokeWidth ?? per-type fallback): thin mode must
  // reproduce today's rendering pixel-for-pixel, including custom styles.
  const legacyPx = strokeWidth(project, entity, legacyFallbackPx);
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
  entity: CadPolylineEntity,
): CadDisplayPrimitive[] => {
  if (entity.metadata?.createdBy !== 'TRAVERSE') return [];
  const stroke = sourceLabelStroke(project, entity);
  const fontSize = textFontSize(project, entity, 11);
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
    stroke: sourceLabelStroke(project, entity),
    point: metrics.centroid,
    text: `${entity.areaSquareMeters.toFixed(3)} m²\n${entity.perimeterMeters.toFixed(3)} m`,
    fontSize: textFontSize(project, entity, 11),
    textAnchor: 'middle',
  }];
};

const buildArcLabelPrimitive = (
  project: CadProject,
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
    stroke: sourceLabelStroke(project, entity),
    point: {
      x: entity.centerX + Math.cos(midAngleRad) * labelRadius,
      y: entity.centerY + Math.sin(midAngleRad) * labelRadius,
    },
    text: `${formatCadSweepDms(sweepDeg)}\nR ${entity.radius.toFixed(3)} m\nL ${arcLength.toFixed(3)} m`,
    fontSize: textFontSize(project, entity, 11),
    rotationDeg,
    textAnchor: 'middle',
  }];
};

const buildAlignmentLabelPrimitive = (
  project: CadProject,
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
    stroke: sourceLabelStroke(project, entity),
    point: midpoint.point,
    text: `${entity.name}\nSTA ${formatCadStation(entity.startStation)} - ${formatCadStation(endStation)}`,
    fontSize: textFontSize(project, entity, 11),
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
      stroke: sourceLabelStroke(project, entity),
      point: marker.point,
      text: `EQ ${formatCadStation(equation.backStation)} = ${formatCadStation(equation.aheadStation)}`,
      fontSize: textFontSize(project, entity, 10),
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

const toPrimitives = (
  project: CadProject,
  ctx: SceneRenderContext,
  entity: CadEntity,
): CadDisplayPrimitive[] => {
  switch (entity.type) {
    case 'survey-point': {
      const style = entityScreenStyle(project, ctx, entity, 1.2);
      return [{
        kind: 'point',
        id: `primitive:${entity.id}`,
        layerId: entity.layerId,
        sourceEntityId: entity.id,
        stroke: style.stroke,
        fill: style.stroke,
        ...withOpacity(style),
        point: { x: entity.x, y: entity.y },
        radius: pointRadius(project, entity),
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
        ...buildTraverseLabelPrimitives(project, entity),
      ];
    case 'polygon':
      return buildVertexPrimitives(project, ctx, entity);
    case 'parcel':
      return [
        ...buildVertexPrimitives(project, ctx, entity),
        ...buildParcelLabelPrimitive(project, entity),
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
        ...buildArcLabelPrimitive(project, entity),
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
        ...buildAlignmentLabelPrimitive(project, entity),
        ...buildAlignmentStationEquationLabelPrimitives(project, entity),
      ];
    }
    case 'text': {
      const style = entityScreenStyle(project, ctx, entity, 1.2);
      return [{
        kind: 'text',
        id: `primitive:${entity.id}`,
        layerId: entity.layerId,
        sourceEntityId: entity.id,
        stroke: style.stroke,
        ...withOpacity(style),
        point: { x: entity.x, y: entity.y },
        text: entity.text,
        fontSize: textFontSize(project, entity, 11),
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
  };
};
