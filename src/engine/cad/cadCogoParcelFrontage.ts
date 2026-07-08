import {
  cadArcEndPoint,
  cadArcStartPoint,
  type CadWorldPoint,
} from './cadGeometry';
import type { CadArcEntity, CadEntityId, CadLineEntity, CadParcelEntity, CadPolylineEntity } from './cadTypes';
import { normalizeParcelPolygonVertices, normalizeParcelVertexLabel } from './cadCogoParcelGeometry';

export interface CadParcelLayoutFrontageReference {
  sourceEntityId: CadEntityId;
  displayLabel: string;
  sourcePointIds: string[];
  frontageLine: CadLineEntity;
  parcelSegmentIds?: string[] | null;
  parcelSegmentLabelPairs?: Array<readonly [string, string]> | null;
  sourceGeometry?:
    | {
        kind: 'line';
      }
    | {
        kind: 'polyline';
        vertices: CadWorldPoint[];
        vertexLabels: string[];
      }
    | {
        kind: 'arc';
        center: CadWorldPoint;
        radius: number;
        startAngleDeg: number;
        endAngleDeg: number;
      }
    | null;
}

const createFrontageReferenceLine = (
  sourceEntity: CadLineEntity | CadPolylineEntity | CadArcEntity,
  fromPoint: CadWorldPoint,
  toPoint: CadWorldPoint,
  fromLabel: string,
  toLabel: string,
): CadParcelLayoutFrontageReference => ({
  sourceEntityId: sourceEntity.id,
  displayLabel: `${fromLabel}-${toLabel}`,
  sourcePointIds: [fromLabel, toLabel],
  frontageLine: {
    id: `${sourceEntity.id}:frontage-chord`,
    type: 'line',
    layerId: sourceEntity.layerId,
    styleId: sourceEntity.styleId,
    visible: sourceEntity.visible,
    locked: sourceEntity.locked,
    fromStationId: fromLabel,
    toStationId: toLabel,
    fromX: fromPoint.x,
    fromY: fromPoint.y,
    toX: toPoint.x,
    toY: toPoint.y,
    sourceObservationIds: [],
  },
  sourceGeometry:
    sourceEntity.type === 'line'
      ? { kind: 'line' }
      : sourceEntity.type === 'polyline'
        ? {
            kind: 'polyline',
            vertices: sourceEntity.vertices.map((vertex) => ({ x: vertex.x, y: vertex.y })),
            vertexLabels: [...sourceEntity.vertexLabels],
          }
        : {
            kind: 'arc',
            center: { x: sourceEntity.centerX, y: sourceEntity.centerY },
            radius: sourceEntity.radius,
            startAngleDeg: sourceEntity.startAngleDeg,
            endAngleDeg: sourceEntity.endAngleDeg,
          },
});

export const cadBuildParcelLayoutFrontageReference = (
  frontageEntity: CadLineEntity | CadPolylineEntity | CadArcEntity,
): CadParcelLayoutFrontageReference | null => {
  if (frontageEntity.type === 'line') {
    return {
      sourceEntityId: frontageEntity.id,
      displayLabel: `${frontageEntity.fromStationId}-${frontageEntity.toStationId}`,
      sourcePointIds: [frontageEntity.fromStationId, frontageEntity.toStationId],
      frontageLine: frontageEntity,
      sourceGeometry: { kind: 'line' },
    };
  }
  if (frontageEntity.type === 'polyline') {
    if (frontageEntity.vertices.length < 2) return null;
    const firstVertex = frontageEntity.vertices[0]!;
    const lastVertex = frontageEntity.vertices[frontageEntity.vertices.length - 1]!;
    const firstLabel = frontageEntity.vertexLabels[0]?.trim() || 'FRONT1';
    const lastLabel =
      frontageEntity.vertexLabels[frontageEntity.vertexLabels.length - 1]?.trim() || 'FRONT2';
    const segmentLabelPairs = frontageEntity.vertices.slice(0, -1).map((_, index) => {
      const startLabel = frontageEntity.vertexLabels[index]?.trim() || `FRONT${index + 1}`;
      const endLabel = frontageEntity.vertexLabels[index + 1]?.trim() || `FRONT${index + 2}`;
      return [startLabel, endLabel] as const;
    });
    return {
      ...createFrontageReferenceLine(frontageEntity, firstVertex, lastVertex, firstLabel, lastLabel),
      displayLabel: segmentLabelPairs.map(([startLabel, endLabel]) => `${startLabel}-${endLabel}`).join(', '),
      sourcePointIds: segmentLabelPairs.flatMap(([startLabel, endLabel]) => [startLabel, endLabel]),
      parcelSegmentLabelPairs: segmentLabelPairs,
    };
  }
  const startPoint = cadArcStartPoint(frontageEntity);
  const endPoint = cadArcEndPoint(frontageEntity);
  return createFrontageReferenceLine(frontageEntity, startPoint, endPoint, 'ARC START', 'ARC END');
};

export const cadBuildParcelLayoutFrontageReferenceFromParcelSegments = (
  parcel: CadParcelEntity,
  segmentIds: readonly string[],
): CadParcelLayoutFrontageReference | null => {
  if (segmentIds.length === 0 || parcel.vertices.length < 2) return null;
  const vertices = normalizeParcelPolygonVertices(parcel.vertices);
  if (vertices.length < 2) return null;
  const labels =
    parcel.vertexLabels.length === vertices.length
      ? parcel.vertexLabels
      : vertices.map((_, index) => normalizeParcelVertexLabel(parcel.vertexLabels[index], index));

  const uniqueSegmentIds = [...new Set(segmentIds)];
  const matchedSegments = uniqueSegmentIds
    .map((segmentId) => {
      const expectedPrefix = `${parcel.id}#`;
      if (!segmentId.startsWith(expectedPrefix)) return null;
      const rawIndex = Number(segmentId.slice(expectedPrefix.length));
      if (!Number.isInteger(rawIndex) || rawIndex < 0 || rawIndex >= vertices.length) return null;
      const start = vertices[rawIndex]!;
      const end = vertices[(rawIndex + 1) % vertices.length]!;
      return {
        segmentId,
        index: rawIndex,
        start,
        end,
        startLabel: labels[rawIndex] ?? `V${rawIndex + 1}`,
        endLabel: labels[(rawIndex + 1) % vertices.length] ?? `V${((rawIndex + 1) % vertices.length) + 1}`,
      };
    })
    .filter((segment): segment is NonNullable<typeof segment> => segment != null)
    .sort((left, right) => left.index - right.index);
  if (matchedSegments.length === 0) return null;

  const firstSegment = matchedSegments[0]!;
  const displayLabel = matchedSegments
    .map((segment) => `${segment.startLabel}-${segment.endLabel}`)
    .join(', ');

  return {
    sourceEntityId: parcel.id,
    displayLabel,
    sourcePointIds: matchedSegments.flatMap((segment) => [segment.startLabel, segment.endLabel]),
    frontageLine: {
      id: `${parcel.id}:frontage-segment:${firstSegment.index}`,
      type: 'line',
      layerId: parcel.layerId,
      styleId: parcel.styleId,
      visible: parcel.visible,
      locked: parcel.locked,
      fromStationId: firstSegment.startLabel,
      toStationId: firstSegment.endLabel,
      fromX: firstSegment.start.x,
      fromY: firstSegment.start.y,
      toX: firstSegment.end.x,
      toY: firstSegment.end.y,
      sourceObservationIds: [],
    },
    parcelSegmentLabelPairs: matchedSegments.map(
      (segment) => [segment.startLabel, segment.endLabel] as const,
    ),
    parcelSegmentIds: matchedSegments.map((segment) => segment.segmentId),
    sourceGeometry: {
      kind: 'polyline',
      vertices: matchedSegments.flatMap((segment, index) =>
        index === 0
          ? [{ x: segment.start.x, y: segment.start.y }, { x: segment.end.x, y: segment.end.y }]
          : [{ x: segment.end.x, y: segment.end.y }],
      ),
      vertexLabels: matchedSegments.flatMap((segment, index) =>
        index === 0 ? [segment.startLabel, segment.endLabel] : [segment.endLabel],
      ),
    },
  };
};
