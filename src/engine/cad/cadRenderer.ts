import type {
  CadDisplayPrimitive,
  CadDisplayScene,
  CadAlignmentEntity,
  CadAlignmentElement,
  CadEntity,
  CadPolylineEntity,
  CadProject,
  CadStyle,
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

const layerColor = (project: CadProject, layerId: string): string =>
  project.layers.find((layer) => layer.id === layerId)?.color ?? '#94a3b8';

const entityStyle = (project: CadProject, entity: CadEntity): CadStyle | null =>
  entity.styleId != null
    ? project.styleLibrary.styles.find((style) => style.id === entity.styleId) ?? null
    : null;

const pointRadius = (project: CadProject, entity: CadEntity): number => {
  if (entity.type !== 'survey-point') return 1.8;
  const style = entityStyle(project, entity);
  if (!style?.pointSymbolId) {
    return entity.pointClass === 'control' ? 2.4 : 1.8;
  }
  return (
    project.styleLibrary.pointSymbols.find((symbol) => symbol.id === style.pointSymbolId)?.radius ??
    (entity.pointClass === 'control' ? 2.4 : 1.8)
  );
};

const strokeWidth = (project: CadProject, entity: CadEntity, fallback: number): number =>
  entityStyle(project, entity)?.strokeWidth ?? fallback;

const textFontSize = (project: CadProject, entity: CadEntity, fallback: number): number => {
  const style = entityStyle(project, entity);
  if (!style?.textStyleId) return fallback;
  return (
    project.styleLibrary.textStyles.find((textStyle) => textStyle.id === style.textStyleId)?.fontSize ??
    fallback
  );
};

const buildVertexPrimitives = (
  project: CadProject,
  entity: Extract<CadEntity, { vertices: Array<{ x: number; y: number }> }>,
): CadDisplayPrimitive[] => {
  const stroke = entityStyle(project, entity)?.color ?? layerColor(project, entity.layerId);
  const points =
    entity.type === 'polygon' || entity.type === 'parcel'
      ? [...entity.vertices, entity.vertices[0]].filter(
          (point): point is { x: number; y: number } => point != null,
        )
      : entity.vertices;
  return points.slice(0, -1).map((vertex, index) => ({
    kind: 'line',
    id: `primitive:${entity.id}:${index + 1}`,
    layerId: entity.layerId,
    sourceEntityId: entity.id,
    sourceSegmentId: `${entity.id}#${index}`,
    stroke,
    points: [vertex, points[index + 1]!],
    strokeWidth: strokeWidth(project, entity, entity.type === 'parcel' ? 1.5 : 1.25),
  }));
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
  const stroke = entityStyle(project, entity)?.color ?? layerColor(project, entity.layerId);
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
    stroke: entityStyle(project, entity)?.color ?? layerColor(project, 'labels'),
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
    stroke: entityStyle(project, entity)?.color ?? layerColor(project, 'labels'),
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
    stroke: entityStyle(project, entity)?.color ?? layerColor(project, 'labels'),
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
      stroke: entityStyle(project, entity)?.color ?? layerColor(project, 'labels'),
      point: marker.point,
      text: `EQ ${formatCadStation(equation.backStation)} = ${formatCadStation(equation.aheadStation)}`,
      fontSize: textFontSize(project, entity, 10),
      rotationDeg,
      textAnchor: 'middle' as const,
    }];
  });
};

const toPrimitives = (project: CadProject, entity: CadEntity): CadDisplayPrimitive[] => {
  const stroke = entityStyle(project, entity)?.color ?? layerColor(project, entity.layerId);
  switch (entity.type) {
    case 'survey-point':
      return [{
        kind: 'point',
        id: `primitive:${entity.id}`,
        layerId: entity.layerId,
        sourceEntityId: entity.id,
        stroke,
        fill: stroke,
        point: { x: entity.x, y: entity.y },
        radius: pointRadius(project, entity),
      }];
    case 'line':
      return [
        {
          kind: 'line',
          id: `primitive:${entity.id}`,
          layerId: entity.layerId,
          sourceEntityId: entity.id,
          sourceSegmentId: `${entity.id}#0`,
          stroke,
          points: [
            { x: entity.fromX, y: entity.fromY },
            { x: entity.toX, y: entity.toY },
          ],
          strokeWidth: strokeWidth(project, entity, 1.25),
        },
      ];
    case 'polyline':
      return [
        ...buildVertexPrimitives(project, entity),
        ...buildTraverseLabelPrimitives(project, entity),
      ];
    case 'polygon':
      return buildVertexPrimitives(project, entity);
    case 'parcel':
      return [
        ...buildVertexPrimitives(project, entity),
        ...buildParcelLabelPrimitive(project, entity),
      ];
    case 'arc':
      return [
        {
          kind: 'arc',
          id: `primitive:${entity.id}`,
          layerId: entity.layerId,
          sourceEntityId: entity.id,
          stroke,
          center: { x: entity.centerX, y: entity.centerY },
          radius: entity.radius,
          startAngleDeg: entity.startAngleDeg,
          endAngleDeg: entity.endAngleDeg,
          strokeWidth: strokeWidth(project, entity, 1.25),
        },
        ...buildArcLabelPrimitive(project, entity),
      ];
    case 'alignment':
      return [
        ...entity.elements.flatMap((element, index): CadDisplayPrimitive[] => {
          if (element.kind === 'line') {
            return [{
              kind: 'line',
              id: `primitive:${entity.id}:${index + 1}`,
              layerId: entity.layerId,
              sourceEntityId: entity.id,
              sourceSegmentId: `${entity.id}#${index}`,
              stroke,
              points: [element.start, element.end],
              strokeWidth: strokeWidth(project, entity, 1.5),
            }];
          }
          return [{
            kind: 'arc',
            id: `primitive:${entity.id}:${index + 1}`,
            layerId: entity.layerId,
            sourceEntityId: entity.id,
            sourceSegmentId: `${entity.id}#${index}`,
            stroke,
            center: element.center,
            radius: element.radius,
            startAngleDeg: element.startAngleDeg,
            endAngleDeg: element.endAngleDeg,
            strokeWidth: strokeWidth(project, entity, 1.5),
          }];
        }),
        ...buildAlignmentLabelPrimitive(project, entity),
        ...buildAlignmentStationEquationLabelPrimitives(project, entity),
      ];
    case 'text':
      return [{
        kind: 'text',
        id: `primitive:${entity.id}`,
        layerId: entity.layerId,
        sourceEntityId: entity.id,
        stroke,
        point: { x: entity.x, y: entity.y },
        text: entity.text,
        fontSize: textFontSize(project, entity, 11),
        textAnchor: 'start',
      }];
    case 'error-ellipse':
      return [{
        kind: 'ellipse',
        id: `primitive:${entity.id}`,
        layerId: entity.layerId,
        sourceEntityId: entity.id,
        stroke,
        center: { x: entity.centerX, y: entity.centerY },
        semiMajor: entity.semiMajor,
        semiMinor: entity.semiMinor,
        thetaDeg: entity.thetaDeg,
        strokeWidth: strokeWidth(project, entity, 1.1),
      }];
  }
};

export const buildCadDisplayScene = (project: CadProject): CadDisplayScene => ({
  bounds: project.bounds,
  primitives: project.entities
    .filter((entity) => entity.visible)
    .flatMap((entity) => toPrimitives(project, entity)),
});
