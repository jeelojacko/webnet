import {
  cadBuildArcFromThreePoints as buildArcFromThreePointsGeometry,
  cadBuildArcFromStartEndRadius as buildArcFromStartEndRadiusGeometry,
  cadBuildParallelLine as buildParallelLineGeometry,
  cadBuildPerpendicularFoot as buildPerpendicularFootGeometry,
  cadBuildArcFromStartTangentRadiusDelta as buildArcFromStartTangentRadiusDeltaGeometry,
  cadBuildCurveMetricsFromArcLength as buildCurveMetricsFromArcLengthGeometry,
  cadBuildCurveMetricsFromChordLength as buildCurveMetricsFromChordLengthGeometry,
  cadBuildCurveMetricsFromRadiusDelta as buildCurveMetricsFromRadiusDeltaGeometry,
  cadBuildCurveMetricsFromTangentLength as buildCurveMetricsFromTangentLengthGeometry,
  cadBuildTangentCurve as buildTangentCurveGeometry,
  cadArcStartPoint,
  cadArcEndPoint,
  cadArcEndTangentAzimuthDeg,
  cadAzimuthDeg,
  cadDistance,
  cadIntersectArcArc,
  cadIntersectCircleCircle,
  cadIntersectInfiniteLineCircle,
  cadIntersectSegmentArc,
  cadInfiniteLineIntersection,
  cadNormalizeAngleDeg,
  cadOffsetLineSegment as offsetLineSegmentGeometry,
  cadParseBearingDegrees,
  cadPointFromAzimuthDistance,
  cadPointOnCircle,
  cadProjectPointOntoInfiniteLine,
  cadSignedSweepDeg,
  cadSegmentIntersection,
  type CadNamedPoint,
  type CadCurveMetrics,
  type CadWorldPoint,
} from './cadGeometry';
import type {
  CadArcEntity,
  CadEntity,
  CadEntityId,
  CadLineEntity,
  CadParcelLayoutRemainderDistribution,
  CadParcelLayoutSettings,
  CadParcelEntity,
  CadPolylineEntity,
} from './cadTypes';

export interface CadInverseSummary {
  distance: number;
  azimuthDeg: number;
  bearing: string;
}

export interface CadDistanceSummary {
  deltaX: number;
  deltaY: number;
  distance2d: number;
}

export interface CadMultiInverseLegSummary extends CadInverseSummary {
  fromLabel: string;
  toLabel: string;
}

export interface CadMultiInverseSummary {
  legs: CadMultiInverseLegSummary[];
  totalDistance: number;
}

export type CadTraverseAdjustmentMethod = 'angular' | 'bowditch' | 'transit';

export interface CadTraverseAdjustmentLegSummary {
  fromLabel: string;
  toLabel: string;
  distanceMeters: number;
  rawBearing: string;
  adjustedBearing: string;
  rawDeltaX: number;
  rawDeltaY: number;
  adjustedDeltaX: number;
  adjustedDeltaY: number;
  correctionX: number;
  correctionY: number;
}

export interface CadTraverseAdjustmentSummary {
  method: CadTraverseAdjustmentMethod;
  targetLabel: string;
  rawClosureDeltaX: number;
  rawClosureDeltaY: number;
  rawClosureDistanceMeters: number;
  adjustedClosureDeltaX: number;
  adjustedClosureDeltaY: number;
  adjustedClosureDistanceMeters: number;
  rawClosureBearing: string | null;
  adjustedClosureBearing: string | null;
  angularCorrectionPerLegDeg: number | null;
  angularCorrectionPerLegSec: number | null;
  legs: CadTraverseAdjustmentLegSummary[];
  adjustedPoints: CadNamedPoint[];
}

export interface CadIntersectionSolution {
  point: CadWorldPoint;
  label: string;
}

export interface CadCurveMetricsSummary extends CadCurveMetrics {
  externalDistance: number;
  middleOrdinate: number;
}

interface CadSegmentRef {
  start: CadWorldPoint;
  end: CadWorldPoint;
  label: string;
}

export interface CadEntityIntersection {
  point: CadWorldPoint;
  label: string;
}

export interface CadParcelClosureSummary {
  areaSquareMeters: number;
  perimeterMeters: number;
  closureDeltaX: number;
  closureDeltaY: number;
  closureDistanceMeters: number;
  centroid: CadWorldPoint;
}

export interface CadParcelCourseSummary {
  fromLabel: string;
  toLabel: string;
  azimuthDeg: number;
  azimuthText: string;
  bearing: string;
  distanceMeters: number;
}

export interface CadAreaUnitSummary {
  hectares: number;
  acres: number;
  squareFeet: number;
}

export interface CadParcelReportSummary extends CadParcelClosureSummary {
  parcelName: string;
  courseCount: number;
  courses: CadParcelCourseSummary[];
}

export interface CadParcelSplitDraft {
  firstVertices: CadWorldPoint[];
  firstVertexLabels: string[];
  secondVertices: CadWorldPoint[];
  secondVertexLabels: string[];
  splitStart: CadWorldPoint;
  splitEnd: CadWorldPoint;
}

export type CadParcelLayoutSplitAlternative = 'start' | 'end';

export interface CadParcelLayoutSplitDraft {
  split: CadParcelSplitDraft;
  alternative: CadParcelLayoutSplitAlternative;
  frontageLengthMeters: number;
  childAreaSquareMeters: number;
  childVertices: CadWorldPoint[];
  childVertexLabels: string[];
  remainderVertices: CadWorldPoint[];
  remainderVertexLabels: string[];
}

export interface CadParcelLayoutConstraintEvaluation {
  frontageLengthMeters: number;
  frontageAtOffsetWidthMeters: number | null;
  minimumSampledWidthMeters: number | null;
  depthMeters: number | null;
  score: number;
  failedRuleCodes: Array<
    | 'min_area'
    | 'min_frontage'
    | 'frontage_at_offset'
    | 'min_width'
    | 'min_depth'
    | 'max_depth'
  >;
  messages: string[];
}

export interface CadParcelLayoutPreviewCandidate {
  tool: 'slide' | 'swing';
  alternative: CadParcelLayoutSplitAlternative;
  draft: CadParcelLayoutSplitDraft | null;
  evaluation: CadParcelLayoutConstraintEvaluation | null;
  isValid: boolean;
  statusMessage: string;
}

export interface CadParcelLayoutGeneratedParcelDraft {
  vertices: CadWorldPoint[];
  vertexLabels: string[];
  role: 'lot' | 'remainder';
  sourceKind?: 'segment' | 'corner_prepass' | 'corner_remainder';
  sourceSegmentIndex?: number;
}

export interface CadParcelAutoLayoutDraft {
  tool: 'slide' | 'swing';
  generatedParcels: CadParcelLayoutGeneratedParcelDraft[];
  acceptedCandidates: CadParcelLayoutPreviewCandidate[];
  isValid: boolean;
  statusMessage: string;
}

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

const PARCEL_LAYOUT_EVALUATION_SAMPLE_COUNT = 7;

export interface CadParcelSourceDraft {
  vertices: CadWorldPoint[];
  vertexLabels: string[];
  sourceEntityIds: CadEntityId[];
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

const normalizeParcelVertexLabel = (label: string | undefined, index: number): string => {
  if (!label) return `V${index + 1}`;
  const trimmed = label.trim();
  return /^[A-Za-z0-9_-]+$/.test(trimmed) ? trimmed : `V${index + 1}`;
};

const isGenericParcelVertexLabel = (label: string): boolean =>
  /^V\d+$/i.test(label) ||
  /^FRONT\d+$/i.test(label) ||
  /^AUTO\d+$/i.test(label);

const normalizeParcelSourceVertexLabels = (vertexLabels: readonly string[]): string[] => {
  const normalized = vertexLabels.map((label, index) => normalizeParcelVertexLabel(label, index));
  const usedLabels = new Set<string>();
  return normalized.map((label, index) => {
    let nextLabel = label;
    if (isGenericParcelVertexLabel(nextLabel) || usedLabels.has(nextLabel)) {
      nextLabel = `CAD${index + 1}`;
      while (usedLabels.has(nextLabel)) {
        nextLabel = `CAD${usedLabels.size + 1}`;
      }
    }
    usedLabels.add(nextLabel);
    return nextLabel;
  });
};

const PARCEL_POINT_TOLERANCE = 1e-6;

const quantizeParcelCoordinate = (value: number): number =>
  Math.round(value / PARCEL_POINT_TOLERANCE);

const parcelPointKey = (point: CadWorldPoint): string =>
  `${quantizeParcelCoordinate(point.x)}:${quantizeParcelCoordinate(point.y)}`;

const parcelPointsMatch = (left: CadWorldPoint, right: CadWorldPoint): boolean =>
  Math.abs(left.x - right.x) <= PARCEL_POINT_TOLERANCE &&
  Math.abs(left.y - right.y) <= PARCEL_POINT_TOLERANCE;

const compareParcelPoints = (left: CadWorldPoint, right: CadWorldPoint): number =>
  left.x === right.x ? left.y - right.y : left.x - right.x;

const cadPointListsMatch = (
  left: readonly CadWorldPoint[],
  right: readonly CadWorldPoint[],
  tolerance = 1e-9,
): boolean =>
  left.length === right.length &&
  left.every(
    (point, index) =>
      Math.abs(point.x - (right[index]?.x ?? Number.NaN)) <= tolerance &&
      Math.abs(point.y - (right[index]?.y ?? Number.NaN)) <= tolerance,
  );

const normalizeParcelPolygonVertices = (
  vertices: readonly CadWorldPoint[],
): CadWorldPoint[] => {
  if (vertices.length < 2) return vertices.map((vertex) => ({ x: vertex.x, y: vertex.y }));
  const normalized = vertices.map((vertex) => ({ x: vertex.x, y: vertex.y }));
  if (parcelPointsMatch(normalized[0]!, normalized[normalized.length - 1]!)) {
    normalized.pop();
  }
  return normalized;
};

const cadPolygonSignedAreaDouble = (vertices: readonly CadWorldPoint[]): number => {
  if (vertices.length < 3) return 0;
  let areaDouble = 0;
  for (let index = 0; index < vertices.length; index += 1) {
    const current = vertices[index]!;
    const next = vertices[(index + 1) % vertices.length]!;
    areaDouble += current.x * next.y - next.x * current.y;
  }
  return areaDouble;
};

const cadPolygonAreaSquareMeters = (vertices: readonly CadWorldPoint[]): number =>
  Math.abs(cadPolygonSignedAreaDouble(vertices)) / 2;

const cadCross = (origin: CadWorldPoint, left: CadWorldPoint, right: CadWorldPoint): number =>
  (left.x - origin.x) * (right.y - origin.y) - (left.y - origin.y) * (right.x - origin.x);

const cadPointOnSegment = (
  point: CadWorldPoint,
  start: CadWorldPoint,
  end: CadWorldPoint,
  tolerance = PARCEL_POINT_TOLERANCE,
): boolean => {
  const cross = cadCross(start, end, point);
  if (Math.abs(cross) > tolerance) return false;
  const minX = Math.min(start.x, end.x) - tolerance;
  const maxX = Math.max(start.x, end.x) + tolerance;
  const minY = Math.min(start.y, end.y) - tolerance;
  const maxY = Math.max(start.y, end.y) + tolerance;
  return point.x >= minX && point.x <= maxX && point.y >= minY && point.y <= maxY;
};

const cadPointInTriangle = (
  point: CadWorldPoint,
  a: CadWorldPoint,
  b: CadWorldPoint,
  c: CadWorldPoint,
  tolerance = PARCEL_POINT_TOLERANCE,
): boolean => {
  const c1 = cadCross(a, b, point);
  const c2 = cadCross(b, c, point);
  const c3 = cadCross(c, a, point);
  const hasNegative = c1 < -tolerance || c2 < -tolerance || c3 < -tolerance;
  const hasPositive = c1 > tolerance || c2 > tolerance || c3 > tolerance;
  return !(hasNegative && hasPositive);
};

const cadPointInPolygon = (
  point: CadWorldPoint,
  polygon: readonly CadWorldPoint[],
): boolean => {
  let inside = false;
  for (let index = 0, previous = polygon.length - 1; index < polygon.length; previous = index, index += 1) {
    const currentVertex = polygon[index]!;
    const previousVertex = polygon[previous]!;
    if (cadPointOnSegment(point, previousVertex, currentVertex)) return true;
    const intersects =
      (currentVertex.y > point.y) !== (previousVertex.y > point.y) &&
      point.x <
        ((previousVertex.x - currentVertex.x) * (point.y - currentVertex.y)) /
          (previousVertex.y - currentVertex.y) +
          currentVertex.x;
    if (intersects) inside = !inside;
  }
  return inside;
};

const cadLineIntersectionPoint = (
  segmentStart: CadWorldPoint,
  segmentEnd: CadWorldPoint,
  lineStart: CadWorldPoint,
  lineEnd: CadWorldPoint,
): CadWorldPoint | null => {
  const x1 = segmentStart.x;
  const y1 = segmentStart.y;
  const x2 = segmentEnd.x;
  const y2 = segmentEnd.y;
  const x3 = lineStart.x;
  const y3 = lineStart.y;
  const x4 = lineEnd.x;
  const y4 = lineEnd.y;
  const denominator = (x1 - x2) * (y3 - y4) - (y1 - y2) * (x3 - x4);
  if (Math.abs(denominator) <= 1e-12) return null;
  const determinant1 = x1 * y2 - y1 * x2;
  const determinant2 = x3 * y4 - y3 * x4;
  return {
    x: (determinant1 * (x3 - x4) - (x1 - x2) * determinant2) / denominator,
    y: (determinant1 * (y3 - y4) - (y1 - y2) * determinant2) / denominator,
  };
};

const cadDeduplicatePolygonVertices = (
  vertices: readonly CadWorldPoint[],
): CadWorldPoint[] => {
  const deduplicated: CadWorldPoint[] = [];
  vertices.forEach((vertex) => {
    if (!deduplicated.some((candidate) => parcelPointsMatch(candidate, vertex))) {
      deduplicated.push({ x: vertex.x, y: vertex.y });
    }
  });
  return deduplicated;
};

const cadClipConvexPolygon = (
  subjectPolygon: readonly CadWorldPoint[],
  clipPolygon: readonly CadWorldPoint[],
): CadWorldPoint[] => {
  if (subjectPolygon.length < 3 || clipPolygon.length < 3) return [];
  const clipOrientation = cadPolygonSignedAreaDouble(clipPolygon) >= 0 ? 1 : -1;
  let output = subjectPolygon.map((vertex) => ({ x: vertex.x, y: vertex.y }));
  for (let clipIndex = 0; clipIndex < clipPolygon.length; clipIndex += 1) {
    const clipStart = clipPolygon[clipIndex]!;
    const clipEnd = clipPolygon[(clipIndex + 1) % clipPolygon.length]!;
    const input = output;
    output = [];
    if (input.length === 0) break;
    for (let subjectIndex = 0; subjectIndex < input.length; subjectIndex += 1) {
      const current = input[subjectIndex]!;
      const previous = input[(subjectIndex + input.length - 1) % input.length]!;
      const currentCross = cadCross(clipStart, clipEnd, current) * clipOrientation;
      const previousCross = cadCross(clipStart, clipEnd, previous) * clipOrientation;
      const currentInside = currentCross >= -PARCEL_POINT_TOLERANCE;
      const previousInside = previousCross >= -PARCEL_POINT_TOLERANCE;
      if (currentInside) {
        if (!previousInside) {
          const entry = cadLineIntersectionPoint(previous, current, clipStart, clipEnd);
          if (entry) output.push(entry);
        }
        output.push(current);
      } else if (previousInside) {
        const exit = cadLineIntersectionPoint(previous, current, clipStart, clipEnd);
        if (exit) output.push(exit);
      }
    }
    output = cadDeduplicatePolygonVertices(output);
  }
  return output.length >= 3 ? output : [];
};

const cadTriangulatePolygon = (
  polygonVertices: readonly CadWorldPoint[],
): CadWorldPoint[][] | null => {
  const vertices = normalizeParcelPolygonVertices(polygonVertices);
  if (vertices.length < 3) return null;
  if (vertices.length === 3) return [[...vertices]];
  const orientation = cadPolygonSignedAreaDouble(vertices) >= 0 ? 1 : -1;
  const remainingIndices = vertices.map((_, index) => index);
  const triangles: CadWorldPoint[][] = [];
  let guard = 0;
  while (remainingIndices.length > 3 && guard < vertices.length * vertices.length) {
    let earFound = false;
    for (let index = 0; index < remainingIndices.length; index += 1) {
      const previousIndex = remainingIndices[(index + remainingIndices.length - 1) % remainingIndices.length]!;
      const currentIndex = remainingIndices[index]!;
      const nextIndex = remainingIndices[(index + 1) % remainingIndices.length]!;
      const previous = vertices[previousIndex]!;
      const current = vertices[currentIndex]!;
      const next = vertices[nextIndex]!;
      const cross = cadCross(previous, current, next) * orientation;
      if (cross <= PARCEL_POINT_TOLERANCE) continue;
      const containsInteriorPoint = remainingIndices.some((candidateIndex) => {
        if (
          candidateIndex === previousIndex ||
          candidateIndex === currentIndex ||
          candidateIndex === nextIndex
        ) {
          return false;
        }
        return cadPointInTriangle(vertices[candidateIndex]!, previous, current, next);
      });
      if (containsInteriorPoint) continue;
      triangles.push([previous, current, next].map((vertex) => ({ x: vertex.x, y: vertex.y })));
      remainingIndices.splice(index, 1);
      earFound = true;
      break;
    }
    if (!earFound) return null;
    guard += 1;
  }
  if (remainingIndices.length === 3) {
    triangles.push(
      remainingIndices.map((vertexIndex) => {
        const vertex = vertices[vertexIndex]!;
        return { x: vertex.x, y: vertex.y };
      }),
    );
  }
  return triangles;
};

const cadBuildParcelOverlapAreaSquareMeters = (
  firstPolygon: readonly CadWorldPoint[],
  secondPolygon: readonly CadWorldPoint[],
): number => {
  const firstTriangles = cadTriangulatePolygon(firstPolygon);
  const secondTriangles = cadTriangulatePolygon(secondPolygon);
  if (!firstTriangles || !secondTriangles) return 0;
  let overlapArea = 0;
  firstTriangles.forEach((firstTriangle) => {
    secondTriangles.forEach((secondTriangle) => {
      const overlapPolygon = cadClipConvexPolygon(firstTriangle, secondTriangle);
      if (overlapPolygon.length >= 3) {
        overlapArea += cadPolygonAreaSquareMeters(overlapPolygon);
      }
    });
  });
  return overlapArea;
};

const cadPointStrictlyInPolygon = (
  point: CadWorldPoint,
  polygon: readonly CadWorldPoint[],
): boolean =>
  cadPointInPolygon(point, polygon) &&
  !polygon.some((start, index) => cadPointOnSegment(point, start, polygon[(index + 1) % polygon.length]!));

interface CadParcelLineCandidate {
  entityId: CadEntityId;
  start: CadWorldPoint;
  end: CadWorldPoint;
  startLabel: string;
  endLabel: string;
  startKey: string;
  endKey: string;
}

interface CadParcelNode {
  key: string;
  point: CadWorldPoint;
  label: string;
  incidentEntityIds: CadEntityId[];
}

interface CadParcelBoundarySegment {
  entityId: CadEntityId;
  start: CadWorldPoint;
  end: CadWorldPoint;
  startLabel: string;
  endLabel: string;
  startKey: string;
  endKey: string;
}

export interface CadParcelLineworkNodeDiagnostic {
  label: string;
  x: number;
  y: number;
  incidentCount: number;
}

export interface CadParcelLineworkOverlapDiagnostic {
  firstLabel: string;
  secondLabel: string;
  segmentCount: number;
  lengthMeters: number;
}

export interface CadParcelLineworkDiagnostics {
  lineCount: number;
  nodeCount: number;
  componentCount: number;
  danglingNodes: CadParcelLineworkNodeDiagnostic[];
  branchNodes: CadParcelLineworkNodeDiagnostic[];
  overlapSegments: CadParcelLineworkOverlapDiagnostic[];
  isClosedLoopCandidate: boolean;
}

export interface CadParcelOverlapPairDiagnostic {
  firstParcelId: CadEntityId;
  firstParcelName: string;
  secondParcelId: CadEntityId;
  secondParcelName: string;
  overlapAreaSquareMeters: number;
}

export interface CadParcelOverlapDiagnostics {
  parcelCount: number;
  pairCount: number;
  overlapPairs: CadParcelOverlapPairDiagnostic[];
  totalOverlapAreaSquareMeters: number;
}

export interface CadParcelGapLoopDiagnostic {
  areaSquareMeters: number;
  centroid: CadWorldPoint;
}

export interface CadParcelGapDiagnostics {
  parcelCount: number;
  componentCount: number;
  exposedLoopCount: number;
  isSupported: boolean;
  gapLoops: CadParcelGapLoopDiagnostic[];
  totalGapAreaSquareMeters: number;
}

const padInteger = (value: number, width: number): string => value.toString().padStart(width, '0');

export const cadConvertAreaSquareMeters = (areaSquareMeters: number): CadAreaUnitSummary => ({
  hectares: areaSquareMeters / 10_000,
  acres: areaSquareMeters / 4046.8564224,
  squareFeet: areaSquareMeters * 10.7639104167097,
});

export const formatCadNorthAzimuthDms = (azimuthDeg: number): string => {
  const normalized = ((azimuthDeg % 360) + 360) % 360;
  let degrees = Math.floor(normalized);
  let minutesFloat = (normalized - degrees) * 60;
  let minutes = Math.floor(minutesFloat);
  let seconds = Math.round((minutesFloat - minutes) * 60);

  if (seconds >= 60) {
    seconds = 0;
    minutes += 1;
  }
  if (minutes >= 60) {
    minutes = 0;
    degrees += 1;
  }
  if (degrees >= 360) {
    degrees = 0;
  }

  return `${degrees}°${padInteger(minutes, 2)}'${padInteger(seconds, 2)}"`;
};

export const formatCadSweepDms = (sweepDeg: number): string => {
  const absoluteSweep = Math.abs(sweepDeg);
  const normalized =
    Math.abs(absoluteSweep - 360) <= 1e-9
      ? 360
      : ((absoluteSweep % 360) + 360) % 360;
  let degrees = Math.floor(normalized);
  let minutesFloat = (normalized - degrees) * 60;
  let minutes = Math.floor(minutesFloat);
  let seconds = Math.round((minutesFloat - minutes) * 60);

  if (seconds >= 60) {
    seconds = 0;
    minutes += 1;
  }
  if (minutes >= 60) {
    minutes = 0;
    degrees += 1;
  }
  if (degrees > 360) {
    degrees = 360;
    minutes = 0;
    seconds = 0;
  }

  return `${degrees}°${padInteger(minutes, 2)}'${padInteger(seconds, 2)}"`;
};

export const formatCadBearing = (azimuthDeg: number): string => {
  const normalized = ((azimuthDeg % 360) + 360) % 360;
  let prefix: 'N' | 'S' = 'N';
  let suffix: 'E' | 'W' = 'E';
  let angle = normalized;
  if (normalized <= 90) {
    prefix = 'N';
    suffix = 'E';
    angle = normalized;
  } else if (normalized <= 180) {
    prefix = 'S';
    suffix = 'E';
    angle = 180 - normalized;
  } else if (normalized <= 270) {
    prefix = 'S';
    suffix = 'W';
    angle = normalized - 180;
  } else {
    prefix = 'N';
    suffix = 'W';
    angle = 360 - normalized;
  }

  let degrees = Math.floor(angle);
  let minutesFloat = (angle - degrees) * 60;
  let minutes = Math.floor(minutesFloat);
  let seconds = (minutesFloat - minutes) * 60;

  // Keep formatted bearing stable when floating point lands on carry boundaries.
  if (seconds >= 59.995) {
    seconds = 0;
    minutes += 1;
  }
  if (minutes >= 60) {
    minutes = 0;
    degrees += 1;
  }
  if (degrees > 90) {
    degrees = 90;
    minutes = 0;
    seconds = 0;
  }

  return `${prefix}${padInteger(degrees, 2)}-${padInteger(minutes, 2)}-${seconds
    .toFixed(2)
    .padStart(5, '0')}${suffix}`;
};

export const buildCadInverseSummary = (
  from: CadWorldPoint,
  to: CadWorldPoint,
): CadInverseSummary => {
  const azimuthDeg = cadAzimuthDeg(from, to);
  return {
    distance: cadDistance(from, to),
    azimuthDeg,
    bearing: formatCadBearing(azimuthDeg),
  };
};

export const buildCadDistanceSummary = (
  from: CadWorldPoint,
  to: CadWorldPoint,
): CadDistanceSummary => ({
  deltaX: to.x - from.x,
  deltaY: to.y - from.y,
  distance2d: cadDistance(from, to),
});

export const buildCadMultiInverseSummary = (
  points: readonly CadNamedPoint[],
): CadMultiInverseSummary => {
  const legs: CadMultiInverseLegSummary[] = [];
  for (let index = 0; index < points.length - 1; index += 1) {
    const from = points[index]!;
    const to = points[index + 1]!;
    const inverse = buildCadInverseSummary(from, to);
    legs.push({
      ...inverse,
      fromLabel: from.label,
      toLabel: to.label,
    });
  }
  return {
    legs,
    totalDistance: legs.reduce((sum, leg) => sum + leg.distance, 0),
  };
};

export const cadAdjustTraverse = ({
  points,
  targetPoint,
  method,
}: {
  points: readonly CadNamedPoint[];
  targetPoint: CadNamedPoint;
  method: CadTraverseAdjustmentMethod;
}): CadTraverseAdjustmentSummary | null => {
  if (points.length < 2) return null;
  const startPoint = points[0]!;
  const lastPoint = points[points.length - 1]!;
  const rawClosure = buildCadDistanceSummary(lastPoint, targetPoint);
  const rawClosureBearing =
    rawClosure.distance2d > 1e-9 ? buildCadInverseSummary(lastPoint, targetPoint).bearing : null;
  const rawLegs = points.slice(1).map((point, index) => {
    const fromPoint = points[index]!;
    const inverse = buildCadInverseSummary(fromPoint, point);
    const distance = buildCadDistanceSummary(fromPoint, point);
    return {
      fromPoint,
      toPoint: point,
      distanceMeters: inverse.distance,
      azimuthDeg: inverse.azimuthDeg,
      bearing: inverse.bearing,
      deltaX: distance.deltaX,
      deltaY: distance.deltaY,
    };
  });
  if (rawLegs.length === 0) return null;

  const adjustedPoints: CadNamedPoint[] = [{ label: startPoint.label, x: startPoint.x, y: startPoint.y }];
  const legSummaries: CadTraverseAdjustmentLegSummary[] = [];
  let angularCorrectionPerLegDeg: number | null = null;

  if (method === 'angular') {
    const finalLeg = rawLegs[rawLegs.length - 1]!;
    const targetAzimuthDeg =
      rawClosure.distance2d > 1e-9 ? cadAzimuthDeg(lastPoint, targetPoint) : finalLeg.azimuthDeg;
    const azimuthDifferenceDeg = cadNormalizeAngleDeg(targetAzimuthDeg - finalLeg.azimuthDeg);
    angularCorrectionPerLegDeg = azimuthDifferenceDeg / rawLegs.length;
    rawLegs.forEach((leg, index) => {
      const adjustedAzimuthDeg = cadNormalizeAngleDeg(leg.azimuthDeg + angularCorrectionPerLegDeg! * (index + 1));
      const nextPoint = cadPointFromAzimuthDistance(
        adjustedPoints[adjustedPoints.length - 1]!,
        adjustedAzimuthDeg,
        leg.distanceMeters,
      );
      const adjustedDelta = buildCadDistanceSummary(adjustedPoints[adjustedPoints.length - 1]!, nextPoint);
      adjustedPoints.push({
        label: leg.toPoint.label,
        x: nextPoint.x,
        y: nextPoint.y,
      });
      legSummaries.push({
        fromLabel: leg.fromPoint.label,
        toLabel: leg.toPoint.label,
        distanceMeters: leg.distanceMeters,
        rawBearing: leg.bearing,
        adjustedBearing: formatCadBearing(adjustedAzimuthDeg),
        rawDeltaX: leg.deltaX,
        rawDeltaY: leg.deltaY,
        adjustedDeltaX: adjustedDelta.deltaX,
        adjustedDeltaY: adjustedDelta.deltaY,
        correctionX: adjustedDelta.deltaX - leg.deltaX,
        correctionY: adjustedDelta.deltaY - leg.deltaY,
      });
    });
  } else {
    const totalLength = rawLegs.reduce((sum, leg) => sum + leg.distanceMeters, 0);
    const totalAbsDeltaX = rawLegs.reduce((sum, leg) => sum + Math.abs(leg.deltaX), 0);
    const totalAbsDeltaY = rawLegs.reduce((sum, leg) => sum + Math.abs(leg.deltaY), 0);
    rawLegs.forEach((leg) => {
      const deltaXWeight =
        method === 'bowditch'
          ? totalLength > 1e-12
            ? leg.distanceMeters / totalLength
            : 0
          : totalAbsDeltaX > 1e-12
            ? Math.abs(leg.deltaX) / totalAbsDeltaX
            : totalLength > 1e-12
              ? leg.distanceMeters / totalLength
              : 0;
      const deltaYWeight =
        method === 'bowditch'
          ? totalLength > 1e-12
            ? leg.distanceMeters / totalLength
            : 0
          : totalAbsDeltaY > 1e-12
            ? Math.abs(leg.deltaY) / totalAbsDeltaY
            : totalLength > 1e-12
              ? leg.distanceMeters / totalLength
              : 0;
      const adjustedDeltaX = leg.deltaX + rawClosure.deltaX * deltaXWeight;
      const adjustedDeltaY = leg.deltaY + rawClosure.deltaY * deltaYWeight;
      const nextPoint = {
        x: adjustedPoints[adjustedPoints.length - 1]!.x + adjustedDeltaX,
        y: adjustedPoints[adjustedPoints.length - 1]!.y + adjustedDeltaY,
      };
      adjustedPoints.push({
        label: leg.toPoint.label,
        x: nextPoint.x,
        y: nextPoint.y,
      });
      legSummaries.push({
        fromLabel: leg.fromPoint.label,
        toLabel: leg.toPoint.label,
        distanceMeters: Math.hypot(adjustedDeltaX, adjustedDeltaY),
        rawBearing: leg.bearing,
        adjustedBearing: formatCadBearing(cadAzimuthDeg(adjustedPoints[adjustedPoints.length - 2]!, nextPoint)),
        rawDeltaX: leg.deltaX,
        rawDeltaY: leg.deltaY,
        adjustedDeltaX,
        adjustedDeltaY,
        correctionX: adjustedDeltaX - leg.deltaX,
        correctionY: adjustedDeltaY - leg.deltaY,
      });
    });
  }

  const adjustedLastPoint = adjustedPoints[adjustedPoints.length - 1]!;
  const adjustedClosure = buildCadDistanceSummary(adjustedLastPoint, targetPoint);
  const adjustedClosureBearing =
    adjustedClosure.distance2d > 1e-9 ? buildCadInverseSummary(adjustedLastPoint, targetPoint).bearing : null;
  return {
    method,
    targetLabel: targetPoint.label,
    rawClosureDeltaX: rawClosure.deltaX,
    rawClosureDeltaY: rawClosure.deltaY,
    rawClosureDistanceMeters: rawClosure.distance2d,
    adjustedClosureDeltaX: adjustedClosure.deltaX,
    adjustedClosureDeltaY: adjustedClosure.deltaY,
    adjustedClosureDistanceMeters: adjustedClosure.distance2d,
    rawClosureBearing,
    adjustedClosureBearing,
    angularCorrectionPerLegDeg,
    angularCorrectionPerLegSec:
      angularCorrectionPerLegDeg == null ? null : angularCorrectionPerLegDeg * 3600,
    legs: legSummaries,
    adjustedPoints,
  };
};

export const cadPointFromBearingDistance = (
  from: CadWorldPoint,
  bearing: string,
  distance: number,
): CadWorldPoint | null => {
  const azimuthDeg = cadParseBearingDegrees(bearing);
  if (azimuthDeg == null) return null;
  return cadPointFromAzimuthDistance(from, azimuthDeg, distance);
};

export const cadComputeTurnedAnglePoint = ({
  occupyPoint,
  backsightPoint,
  angleDeg,
  distance,
  side,
}: {
  occupyPoint: CadWorldPoint;
  backsightPoint: CadWorldPoint;
  angleDeg: number;
  distance: number;
  side: 'left' | 'right';
}): CadWorldPoint => {
  const backsightAzimuth = cadAzimuthDeg(occupyPoint, backsightPoint);
  const forwardAzimuth = side === 'right' ? backsightAzimuth + angleDeg : backsightAzimuth - angleDeg;
  return cadPointFromAzimuthDistance(occupyPoint, forwardAzimuth, distance);
};

export const cadComputeDeflectionAnglePoint = ({
  lineStart,
  lineEnd,
  angleDeg,
  distance,
  side,
}: {
  lineStart: CadWorldPoint;
  lineEnd: CadWorldPoint;
  angleDeg: number;
  distance: number;
  side: 'left' | 'right';
}): CadWorldPoint => {
  const tangentAzimuth = cadAzimuthDeg(lineStart, lineEnd);
  const forwardAzimuth = side === 'right' ? tangentAzimuth + angleDeg : tangentAzimuth - angleDeg;
  return cadPointFromAzimuthDistance(lineEnd, forwardAzimuth, distance);
};

export const cadPointAtDistanceAlongLine = (
  start: CadWorldPoint,
  end: CadWorldPoint,
  distanceAlong: number,
): CadWorldPoint | null => {
  const length = cadDistance(start, end);
  if (!Number.isFinite(distanceAlong) || length <= 1e-12) return null;
  const ratio = distanceAlong / length;
  return {
    x: start.x + (end.x - start.x) * ratio,
    y: start.y + (end.y - start.y) * ratio,
  };
};

export const cadPointAtFractionAlongLine = (
  start: CadWorldPoint,
  end: CadWorldPoint,
  fraction: number,
): CadWorldPoint | null => {
  if (!Number.isFinite(fraction)) return null;
  return {
    x: start.x + (end.x - start.x) * fraction,
    y: start.y + (end.y - start.y) * fraction,
  };
};

export const cadExtendLineByDistance = (
  start: CadWorldPoint,
  end: CadWorldPoint,
  distance: number,
): CadWorldPoint | null => {
  const length = cadDistance(start, end);
  if (!Number.isFinite(distance) || length <= 1e-12) return null;
  return cadPointAtDistanceAlongLine(start, end, length + distance);
};

export const cadOffsetPointFromLine = ({
  lineStart,
  lineEnd,
  alongDistance,
  offsetDistance,
  side,
}: {
  lineStart: CadWorldPoint;
  lineEnd: CadWorldPoint;
  alongDistance: number;
  offsetDistance: number;
  side: 'left' | 'right';
}): CadWorldPoint | null => {
  const basePoint = cadPointAtDistanceAlongLine(lineStart, lineEnd, alongDistance);
  const lineLength = cadDistance(lineStart, lineEnd);
  if (!basePoint || lineLength <= 1e-12 || !Number.isFinite(offsetDistance)) return null;
  const unitX = (lineEnd.x - lineStart.x) / lineLength;
  const unitY = (lineEnd.y - lineStart.y) / lineLength;
  const leftX = -unitY;
  const leftY = unitX;
  const multiplier = side === 'left' ? 1 : -1;
  return {
    x: basePoint.x + leftX * offsetDistance * multiplier,
    y: basePoint.y + leftY * offsetDistance * multiplier,
  };
};

const buildCadCurveMetricsSummary = (
  metrics: CadCurveMetrics | null,
): CadCurveMetricsSummary | null => {
  if (!metrics) return null;
  const halfDeltaRad = (metrics.deltaDeg * Math.PI) / 360;
  return {
    ...metrics,
    externalDistance: metrics.radius * (1 / Math.cos(halfDeltaRad) - 1),
    middleOrdinate: metrics.radius * (1 - Math.cos(halfDeltaRad)),
  };
};

const solveCurveDeltaFromBisection = (
  evaluator: (_deltaRad: number) => number,
): number | null => {
  let low = 1e-9;
  let high = Math.PI - 1e-9;
  let lowValue = evaluator(low);
  let highValue = evaluator(high);
  if (!Number.isFinite(lowValue) || !Number.isFinite(highValue) || lowValue === 0) {
    return lowValue === 0 ? low : null;
  }
  if (highValue === 0) return high;
  if (Math.sign(lowValue) === Math.sign(highValue)) return null;
  for (let iteration = 0; iteration < 80; iteration += 1) {
    const mid = (low + high) / 2;
    const value = evaluator(mid);
    if (!Number.isFinite(value)) return null;
    if (Math.abs(value) <= 1e-12) return mid;
    if (Math.sign(value) === Math.sign(lowValue)) {
      low = mid;
      lowValue = value;
    } else {
      high = mid;
      highValue = value;
    }
    if (Math.abs(high - low) <= 1e-12 || Math.abs(highValue - lowValue) <= 1e-12) break;
  }
  return (low + high) / 2;
};

export const cadSolveCurveMetrics = ({
  pair,
  firstValue,
  secondValue,
}: {
  pair:
    | 'radius-delta'
    | 'radius-arc'
    | 'radius-chord'
    | 'radius-tangent'
    | 'delta-arc'
    | 'delta-chord'
    | 'delta-tangent'
    | 'arc-chord'
    | 'arc-tangent'
    | 'chord-tangent';
  firstValue: number;
  secondValue: number;
}): CadCurveMetricsSummary | null => {
  if (!Number.isFinite(firstValue) || !Number.isFinite(secondValue)) return null;
  switch (pair) {
    case 'radius-delta':
      return buildCadCurveMetricsSummary(cadBuildCurveMetricsFromRadiusDelta(firstValue, secondValue));
    case 'radius-arc':
      return buildCadCurveMetricsSummary(cadBuildCurveMetricsFromArcLength(firstValue, secondValue));
    case 'radius-chord':
      return buildCadCurveMetricsSummary(cadBuildCurveMetricsFromChordLength(firstValue, secondValue));
    case 'radius-tangent':
      return buildCadCurveMetricsSummary(cadBuildCurveMetricsFromTangentLength(firstValue, secondValue));
    case 'delta-arc': {
      const deltaRad = (firstValue * Math.PI) / 180;
      if (Math.abs(deltaRad) <= 1e-12) return null;
      return buildCadCurveMetricsSummary(cadBuildCurveMetricsFromRadiusDelta(secondValue / deltaRad, firstValue));
    }
    case 'delta-chord': {
      const halfDeltaRad = (firstValue * Math.PI) / 360;
      const sinHalf = Math.sin(halfDeltaRad);
      if (Math.abs(sinHalf) <= 1e-12) return null;
      return buildCadCurveMetricsSummary(
        cadBuildCurveMetricsFromRadiusDelta(secondValue / (2 * sinHalf), firstValue),
      );
    }
    case 'delta-tangent': {
      const halfDeltaRad = (firstValue * Math.PI) / 360;
      const tangent = Math.tan(halfDeltaRad);
      if (Math.abs(tangent) <= 1e-12) return null;
      return buildCadCurveMetricsSummary(
        cadBuildCurveMetricsFromRadiusDelta(secondValue / tangent, firstValue),
      );
    }
    case 'arc-chord': {
      const deltaRad = solveCurveDeltaFromBisection(
        (candidate) => 2 * (firstValue / candidate) * Math.sin(candidate / 2) - secondValue,
      );
      if (deltaRad == null) return null;
      return buildCadCurveMetricsSummary(
        cadBuildCurveMetricsFromRadiusDelta(firstValue / deltaRad, (deltaRad * 180) / Math.PI),
      );
    }
    case 'arc-tangent': {
      const deltaRad = solveCurveDeltaFromBisection(
        (candidate) => (firstValue / candidate) * Math.tan(candidate / 2) - secondValue,
      );
      if (deltaRad == null) return null;
      return buildCadCurveMetricsSummary(
        cadBuildCurveMetricsFromRadiusDelta(firstValue / deltaRad, (deltaRad * 180) / Math.PI),
      );
    }
    case 'chord-tangent': {
      const deltaRad = solveCurveDeltaFromBisection(
        (candidate) =>
          (secondValue * 2 * Math.sin(candidate / 2)) / Math.tan(candidate / 2) - firstValue,
      );
      if (deltaRad == null) return null;
      const radius = firstValue / (2 * Math.sin(deltaRad / 2));
      return buildCadCurveMetricsSummary(
        cadBuildCurveMetricsFromRadiusDelta(radius, (deltaRad * 180) / Math.PI),
      );
    }
  }
};

export const cadBuildCurveMetricsSummaryFromRadiusDelta = (
  radius: number,
  deltaDeg: number,
): CadCurveMetricsSummary | null =>
  buildCadCurveMetricsSummary(cadBuildCurveMetricsFromRadiusDelta(radius, deltaDeg));

export const cadArcPointByArcDistance = (
  arc: Pick<CadArcEntity, 'centerX' | 'centerY' | 'radius' | 'startAngleDeg' | 'endAngleDeg'>,
  arcDistance: number,
): CadWorldPoint | null => {
  if (!Number.isFinite(arcDistance) || arc.radius <= 1e-12) return null;
  const sweepDeg = cadSignedSweepDeg(arc.startAngleDeg, arc.endAngleDeg);
  const totalArcLength = Math.abs((sweepDeg * Math.PI * arc.radius) / 180);
  if (arcDistance < -1e-9 || arcDistance - totalArcLength > 1e-9) return null;
  const deltaDeg = (arcDistance / arc.radius) * (180 / Math.PI);
  const angleDeg = arc.startAngleDeg + (sweepDeg >= 0 ? deltaDeg : -deltaDeg);
  return cadPointOnCircle({ x: arc.centerX, y: arc.centerY }, arc.radius, angleDeg);
};

export const cadArcPointByChordDistance = (
  arc: Pick<CadArcEntity, 'centerX' | 'centerY' | 'radius' | 'startAngleDeg' | 'endAngleDeg'>,
  chordDistance: number,
): CadWorldPoint | null => {
  const metrics = cadBuildCurveMetricsFromChordLength(arc.radius, chordDistance);
  const totalSweep = Math.abs(cadSignedSweepDeg(arc.startAngleDeg, arc.endAngleDeg));
  if (!metrics || metrics.deltaDeg - totalSweep > 1e-9) return null;
  const angleDeg =
    arc.startAngleDeg + (cadSignedSweepDeg(arc.startAngleDeg, arc.endAngleDeg) >= 0 ? metrics.deltaDeg : -metrics.deltaDeg);
  return cadPointOnCircle({ x: arc.centerX, y: arc.centerY }, arc.radius, angleDeg);
};

export const cadArcSubdivisionPoints = ({
  arc,
  mode,
  value,
}: {
  arc: Pick<CadArcEntity, 'centerX' | 'centerY' | 'radius' | 'startAngleDeg' | 'endAngleDeg'>;
  mode: 'equal' | 'arc' | 'chord';
  value: number;
}): CadWorldPoint[] => {
  const totalSweep = cadSignedSweepDeg(arc.startAngleDeg, arc.endAngleDeg);
  const totalArcLength = Math.abs((totalSweep * Math.PI * arc.radius) / 180);
  if (!Number.isFinite(value) || value <= 0 || totalArcLength <= 1e-12) return [];
  if (mode === 'equal') {
    const divisionCount = Math.floor(value);
    if (divisionCount < 2) return [];
    return Array.from({ length: divisionCount - 1 }, (_, index) => {
      const fraction = (index + 1) / divisionCount;
      const angleDeg = arc.startAngleDeg + totalSweep * fraction;
      return cadPointOnCircle({ x: arc.centerX, y: arc.centerY }, arc.radius, angleDeg);
    });
  }
  const points: CadWorldPoint[] = [];
  let cursor = value;
  while (cursor < totalArcLength - 1e-9) {
    const point =
      mode === 'arc'
        ? cadArcPointByArcDistance(arc, cursor)
        : cadArcPointByChordDistance(arc, cursor);
    if (!point) break;
    points.push(point);
    cursor += value;
  }
  return points;
};

export const cadOffsetArc = ({
  arc,
  offsetDistance,
  side,
}: {
  arc: Pick<CadArcEntity, 'centerX' | 'centerY' | 'radius' | 'startAngleDeg' | 'endAngleDeg'>;
  offsetDistance: number;
  side: 'left' | 'right';
}): {
  center: CadWorldPoint;
  radius: number;
  startAngleDeg: number;
  endAngleDeg: number;
} | null => {
  const sweep = cadSignedSweepDeg(arc.startAngleDeg, arc.endAngleDeg);
  const radiusDelta =
    sweep >= 0
      ? side === 'left'
        ? -offsetDistance
        : offsetDistance
      : side === 'left'
        ? offsetDistance
        : -offsetDistance;
  const radius = arc.radius + radiusDelta;
  if (!Number.isFinite(radius) || radius <= 1e-6) return null;
  return {
    center: { x: arc.centerX, y: arc.centerY },
    radius,
    startAngleDeg: arc.startAngleDeg,
    endAngleDeg: arc.endAngleDeg,
  };
};

export const cadRadialBearingAtArcAngle = ({
  arc: _arc,
  angleDeg,
}: {
  arc: Pick<CadArcEntity, 'centerX' | 'centerY'>;
  angleDeg: number;
}): string => formatCadBearing(cadNormalizeAngleDeg(90 - angleDeg));

export const cadBuildArcFromPiRadiusDelta = ({
  piPoint,
  backTangentPoint,
  radius,
  deltaDeg,
  side,
}: {
  piPoint: CadWorldPoint;
  backTangentPoint: CadWorldPoint;
  radius: number;
  deltaDeg: number;
  side: 'left' | 'right';
}) => {
  const metrics = cadBuildCurveMetricsFromRadiusDelta(radius, deltaDeg);
  if (!metrics) return null;
  const backAzimuthFromPi = cadAzimuthDeg(piPoint, backTangentPoint);
  const incomingTangentAzimuth = cadNormalizeAngleDeg(backAzimuthFromPi + 180);
  const startPoint = cadPointFromAzimuthDistance(piPoint, backAzimuthFromPi, metrics.tangentLength);
  return buildArcFromStartTangentRadiusDeltaGeometry(
    startPoint,
    incomingTangentAzimuth,
    radius,
    deltaDeg,
    side,
  );
};

export const cadBuildArcFromChordBearingRadius = ({
  startPoint,
  chordBearing,
  chordDistance,
  radius,
  side,
}: {
  startPoint: CadWorldPoint;
  chordBearing: string;
  chordDistance: number;
  radius: number;
  side: 'left' | 'right';
}) => {
  const endPoint = cadPointFromBearingDistance(startPoint, chordBearing, chordDistance);
  if (!endPoint) return null;
  return side === 'left'
    ? buildArcFromStartEndRadiusGeometry(startPoint, endPoint, radius, false)
    : buildArcFromStartEndRadiusGeometry(startPoint, endPoint, radius, true);
};

export const cadBuildReverseCurve = ({
  sourceArc,
  radius,
  deltaDeg,
}: {
  sourceArc: Pick<CadArcEntity, 'centerX' | 'centerY' | 'radius' | 'startAngleDeg' | 'endAngleDeg'>;
  radius: number;
  deltaDeg: number;
}) => {
  const sourceSweep = cadSignedSweepDeg(sourceArc.startAngleDeg, sourceArc.endAngleDeg);
  const side: 'left' | 'right' = sourceSweep >= 0 ? 'right' : 'left';
  return buildArcFromStartTangentRadiusDeltaGeometry(
    cadArcEndPoint(sourceArc),
    cadArcEndTangentAzimuthDeg(sourceArc),
    radius,
    deltaDeg,
    side,
  );
};

export const cadBuildCompoundCurve = ({
  sourceArc,
  radius,
  deltaDeg,
}: {
  sourceArc: Pick<CadArcEntity, 'centerX' | 'centerY' | 'radius' | 'startAngleDeg' | 'endAngleDeg'>;
  radius: number;
  deltaDeg: number;
}) => {
  const sourceSweep = cadSignedSweepDeg(sourceArc.startAngleDeg, sourceArc.endAngleDeg);
  const side: 'left' | 'right' = sourceSweep >= 0 ? 'left' : 'right';
  return buildArcFromStartTangentRadiusDeltaGeometry(
    cadArcEndPoint(sourceArc),
    cadArcEndTangentAzimuthDeg(sourceArc),
    radius,
    deltaDeg,
    side,
  );
};

const sortIntersectionSolutions = (
  solutions: readonly CadIntersectionSolution[],
): CadIntersectionSolution[] =>
  [...solutions].sort((left, right) => {
    if (Math.abs(right.point.y - left.point.y) > 1e-9) return right.point.y - left.point.y;
    if (Math.abs(left.point.x - right.point.x) > 1e-9) return left.point.x - right.point.x;
    return left.label.localeCompare(right.label);
  });

export const cadIntersectBearings = ({
  firstPoint,
  firstBearing,
  secondPoint,
  secondBearing,
  firstLabel = 'A',
  secondLabel = 'B',
}: {
  firstPoint: CadWorldPoint;
  firstBearing: string;
  secondPoint: CadWorldPoint;
  secondBearing: string;
  firstLabel?: string;
  secondLabel?: string;
}): CadIntersectionSolution | null => {
  const firstAzimuthDeg = cadParseBearingDegrees(firstBearing);
  const secondAzimuthDeg = cadParseBearingDegrees(secondBearing);
  if (firstAzimuthDeg == null || secondAzimuthDeg == null) return null;
  const firstAhead = cadPointFromAzimuthDistance(firstPoint, firstAzimuthDeg, 1);
  const secondAhead = cadPointFromAzimuthDistance(secondPoint, secondAzimuthDeg, 1);
  const point = cadInfiniteLineIntersection(firstPoint, firstAhead, secondPoint, secondAhead);
  if (!point) return null;
  return {
    point,
    label: `${firstLabel} ${firstBearing} x ${secondLabel} ${secondBearing}`,
  };
};

export const cadIntersectBearingDistance = ({
  bearingPoint,
  bearing,
  distancePoint,
  distance,
  bearingLabel = 'A',
  distanceLabel = 'B',
}: {
  bearingPoint: CadWorldPoint;
  bearing: string;
  distancePoint: CadWorldPoint;
  distance: number;
  bearingLabel?: string;
  distanceLabel?: string;
}): CadIntersectionSolution[] => {
  const azimuthDeg = cadParseBearingDegrees(bearing);
  if (azimuthDeg == null || !Number.isFinite(distance) || distance < 0) return [];
  return sortIntersectionSolutions(
    cadIntersectInfiniteLineCircle(
      bearingPoint,
      cadPointFromAzimuthDistance(bearingPoint, azimuthDeg, 1),
      distancePoint,
      distance,
    ).map((point, index) => ({
      point,
      label: `${bearingLabel} ${bearing} x ${distanceLabel} r=${distance.toFixed(3)} (${index + 1})`,
    })),
  );
};

export const cadIntersectDistanceDistance = ({
  firstPoint,
  firstDistance,
  secondPoint,
  secondDistance,
  firstLabel = 'A',
  secondLabel = 'B',
}: {
  firstPoint: CadWorldPoint;
  firstDistance: number;
  secondPoint: CadWorldPoint;
  secondDistance: number;
  firstLabel?: string;
  secondLabel?: string;
}): CadIntersectionSolution[] => {
  if (
    !Number.isFinite(firstDistance) ||
    !Number.isFinite(secondDistance) ||
    firstDistance < 0 ||
    secondDistance < 0
  ) {
    return [];
  }
  return sortIntersectionSolutions(
    cadIntersectCircleCircle(firstPoint, firstDistance, secondPoint, secondDistance).map((point, index) => ({
      point,
      label: `${firstLabel} r=${firstDistance.toFixed(3)} x ${secondLabel} r=${secondDistance.toFixed(3)} (${index + 1})`,
    })),
  );
};

export const cadIntersectLineCircle = ({
  lineStart,
  lineEnd,
  center,
  radius,
  lineLabel = 'Line',
  centerLabel = 'Center',
}: {
  lineStart: CadWorldPoint;
  lineEnd: CadWorldPoint;
  center: CadWorldPoint;
  radius: number;
  lineLabel?: string;
  centerLabel?: string;
}): CadIntersectionSolution[] => {
  if (!Number.isFinite(radius) || radius < 0) return [];
  return sortIntersectionSolutions(
    cadIntersectInfiniteLineCircle(lineStart, lineEnd, center, radius).map((point, index) => ({
      point,
      label: `${lineLabel} x ${centerLabel} r=${radius.toFixed(3)} (${index + 1})`,
    })),
  );
};

export const cadIntersectOffsetLines = ({
  firstLineStart,
  firstLineEnd,
  firstOffset,
  secondLineStart,
  secondLineEnd,
  secondOffset,
  firstLabel = 'L1',
  secondLabel = 'L2',
}: {
  firstLineStart: CadWorldPoint;
  firstLineEnd: CadWorldPoint;
  firstOffset: number;
  secondLineStart: CadWorldPoint;
  secondLineEnd: CadWorldPoint;
  secondOffset: number;
  firstLabel?: string;
  secondLabel?: string;
}): CadIntersectionSolution | null => {
  const firstOffsetLine = cadOffsetLineSegment(firstLineStart, firstLineEnd, firstOffset);
  const secondOffsetLine = cadOffsetLineSegment(secondLineStart, secondLineEnd, secondOffset);
  const point = cadInfiniteLineIntersection(
    firstOffsetLine.start,
    firstOffsetLine.end,
    secondOffsetLine.start,
    secondOffsetLine.end,
  );
  if (!point) return null;
  return {
    point,
    label: `${firstLabel} off ${firstOffset.toFixed(3)} x ${secondLabel} off ${secondOffset.toFixed(3)}`,
  };
};

export const cadIntersectPerpendicular = ({
  lineStart,
  lineEnd,
  fromPoint,
  lineLabel = 'Line',
  pointLabel = 'Point',
}: {
  lineStart: CadWorldPoint;
  lineEnd: CadWorldPoint;
  fromPoint: CadWorldPoint;
  lineLabel?: string;
  pointLabel?: string;
}): CadIntersectionSolution | null => {
  const projection = cadProjectPointOntoInfiniteLine(fromPoint, lineStart, lineEnd);
  return {
    point: projection.point,
    label: `${pointLabel} perp ${lineLabel}`,
  };
};

export const cadIntersectSkew = ({
  lineStart,
  lineEnd,
  fromPoint,
  angleDeg,
  side,
  lineLabel = 'Line',
  pointLabel = 'Point',
}: {
  lineStart: CadWorldPoint;
  lineEnd: CadWorldPoint;
  fromPoint: CadWorldPoint;
  angleDeg: number;
  side: 'left' | 'right';
  lineLabel?: string;
  pointLabel?: string;
}): CadIntersectionSolution | null => {
  if (!Number.isFinite(angleDeg)) return null;
  const lineAzimuth = cadAzimuthDeg(lineStart, lineEnd);
  const skewAzimuth = side === 'left' ? lineAzimuth - angleDeg : lineAzimuth + angleDeg;
  const point = cadInfiniteLineIntersection(
    lineStart,
    lineEnd,
    fromPoint,
    cadPointFromAzimuthDistance(fromPoint, skewAzimuth, 1),
  );
  if (!point) return null;
  return {
    point,
    label: `${pointLabel} skew ${side} ${angleDeg.toFixed(4)} on ${lineLabel}`,
  };
};

const lineEntitySegments = (entity: CadLineEntity): CadSegmentRef[] => [
  {
    start: { x: entity.fromX, y: entity.fromY },
    end: { x: entity.toX, y: entity.toY },
    label: `${entity.fromStationId}-${entity.toStationId}`,
  },
];

const polylineEntitySegments = (entity: CadPolylineEntity): CadSegmentRef[] =>
  entity.vertices.slice(0, -1).map((vertex, index) => ({
    start: vertex,
    end: entity.vertices[index + 1],
    label: `${entity.vertexLabels[index] ?? `V${index + 1}`}-${entity.vertexLabels[index + 1] ?? `V${index + 2}`}`,
  }));

const lineLikeSegments = (entity: CadLineEntity | CadPolylineEntity): CadSegmentRef[] =>
  entity.type === 'line' ? lineEntitySegments(entity) : polylineEntitySegments(entity);

export const isCadLineLikeEntity = (
  entity: CadEntity,
): entity is CadLineEntity | CadPolylineEntity => entity.type === 'line' || entity.type === 'polyline';

export const cadIntersectLineLikeEntities = (
  first: CadLineEntity | CadPolylineEntity,
  second: CadLineEntity | CadPolylineEntity,
): CadEntityIntersection | null => {
  const firstSegments = lineLikeSegments(first);
  const secondSegments = lineLikeSegments(second);

  for (const firstSegment of firstSegments) {
    for (const secondSegment of secondSegments) {
      const point = cadSegmentIntersection(
        firstSegment.start,
        firstSegment.end,
        secondSegment.start,
        secondSegment.end,
      );
      if (!point) continue;
      return {
        point,
        label: `${firstSegment.label} x ${secondSegment.label}`,
      };
    }
  }
  return null;
};

export const cadIntersectLineArcEntity = (
  lineLike: CadLineEntity | CadPolylineEntity,
  arc: CadArcEntity,
): CadEntityIntersection[] =>
  lineLikeSegments(lineLike)
    .flatMap((segment) =>
      cadIntersectSegmentArc(
        segment.start,
        segment.end,
        { x: arc.centerX, y: arc.centerY },
        arc.radius,
        arc.startAngleDeg,
        arc.endAngleDeg,
      ).map((point) => ({
        point,
        label: `${segment.label} x ${arc.id}`,
      })),
    )
    .sort((left, right) => {
      if (Math.abs(left.point.x - right.point.x) > 1e-9) return left.point.x - right.point.x;
      return left.point.y - right.point.y;
    });

export const cadIntersectArcEntities = (
  first: CadArcEntity,
  second: CadArcEntity,
): CadEntityIntersection[] =>
  cadIntersectArcArc(
    { x: first.centerX, y: first.centerY },
    first.radius,
    first.startAngleDeg,
    first.endAngleDeg,
    { x: second.centerX, y: second.centerY },
    second.radius,
    second.startAngleDeg,
    second.endAngleDeg,
  ).map((point) => ({
    point,
    label: `${first.id} x ${second.id}`,
  }));

export const cadOffsetLineSegment = (
  start: CadWorldPoint,
  end: CadWorldPoint,
  offsetDistance: number,
) => offsetLineSegmentGeometry(start, end, offsetDistance);

export const cadBuildParallelLine = (
  start: CadWorldPoint,
  end: CadWorldPoint,
  throughPoint: CadWorldPoint,
) => buildParallelLineGeometry(start, end, throughPoint);

export const cadBuildPerpendicularFoot = (
  lineStart: CadWorldPoint,
  lineEnd: CadWorldPoint,
  fromPoint: CadWorldPoint,
) => buildPerpendicularFootGeometry(lineStart, lineEnd, fromPoint);

export const cadBuildCurveMetricsFromRadiusDelta = (
  radius: number,
  deltaDeg: number,
) => buildCurveMetricsFromRadiusDeltaGeometry(radius, deltaDeg);

export const cadBuildCurveMetricsFromArcLength = (
  radius: number,
  arcLength: number,
) => buildCurveMetricsFromArcLengthGeometry(radius, arcLength);

export const cadBuildCurveMetricsFromChordLength = (
  radius: number,
  chordLength: number,
) => buildCurveMetricsFromChordLengthGeometry(radius, chordLength);

export const cadBuildCurveMetricsFromTangentLength = (
  radius: number,
  tangentLength: number,
) => buildCurveMetricsFromTangentLengthGeometry(radius, tangentLength);

export const cadBuildArcFromThreePoints = (
  startPoint: CadWorldPoint,
  throughPoint: CadWorldPoint,
  endPoint: CadWorldPoint,
) => buildArcFromThreePointsGeometry(startPoint, throughPoint, endPoint);

export const cadBuildTangentCurve = (
  piPoint: CadWorldPoint,
  backTangentPoint: CadWorldPoint,
  aheadTangentPoint: CadWorldPoint,
  radius: number,
) => buildTangentCurveGeometry(piPoint, backTangentPoint, aheadTangentPoint, radius);

export const buildCadNamedPoint = (
  point: CadWorldPoint,
  label: string,
): CadNamedPoint => ({
  ...point,
  label,
});

const buildParcelLineCandidate = (entity: CadLineEntity): CadParcelLineCandidate => {
  const start = { x: entity.fromX, y: entity.fromY };
  const end = { x: entity.toX, y: entity.toY };
  return {
    entityId: entity.id,
    start,
    end,
    startLabel: entity.fromStationId,
    endLabel: entity.toStationId,
    startKey: parcelPointKey(start),
    endKey: parcelPointKey(end),
  };
};

const buildParcelBoundarySegments = (
  parcel: CadParcelEntity,
): CadParcelBoundarySegment[] => {
  const vertices = normalizeParcelPolygonVertices(parcel.vertices);
  const labels = parcel.vertexLabels.length === vertices.length
    ? parcel.vertexLabels
    : vertices.map((_, index) => normalizeParcelVertexLabel(parcel.vertexLabels[index], index));
  if (vertices.length < 3) return [];
  return vertices.map((start, index) => {
    const end = vertices[(index + 1) % vertices.length]!;
    return {
      entityId: parcel.id,
      start,
      end,
      startLabel: labels[index] ?? `V${index + 1}`,
      endLabel: labels[(index + 1) % labels.length] ?? `V${((index + 1) % labels.length) + 1}`,
      startKey: parcelPointKey(start),
      endKey: parcelPointKey(end),
    };
  });
};

const buildParcelNodeMap = (candidates: readonly CadParcelLineCandidate[]): Map<string, CadParcelNode> => {
  const nodeMap = new Map<string, CadParcelNode>();
  candidates.forEach((candidate) => {
    [
      { key: candidate.startKey, point: candidate.start, label: candidate.startLabel },
      { key: candidate.endKey, point: candidate.end, label: candidate.endLabel },
    ].forEach(({ key, point, label }) => {
      const existing = nodeMap.get(key);
      if (existing) {
        existing.incidentEntityIds.push(candidate.entityId);
        return;
      }
      nodeMap.set(key, {
        key,
        point,
        label,
        incidentEntityIds: [candidate.entityId],
      });
    });
  });
  return nodeMap;
};

export const cadBuildParcelLineworkDiagnostics = (
  entities: readonly CadLineEntity[],
): CadParcelLineworkDiagnostics => {
  if (entities.length === 0) {
    return {
      lineCount: 0,
      nodeCount: 0,
      componentCount: 0,
      danglingNodes: [],
      branchNodes: [],
      overlapSegments: [],
      isClosedLoopCandidate: false,
    };
  }

  const candidates = entities.map(buildParcelLineCandidate);
  const nodeMap = buildParcelNodeMap(candidates);
  const candidateById = new Map(candidates.map((candidate) => [candidate.entityId, candidate] as const));
  const nodes = [...nodeMap.values()];

  const visitedNodeKeys = new Set<string>();
  let componentCount = 0;
  nodes.forEach((node) => {
    if (visitedNodeKeys.has(node.key)) return;
    componentCount += 1;
    const queue = [node.key];
    visitedNodeKeys.add(node.key);
    while (queue.length > 0) {
      const currentKey = queue.shift();
      if (!currentKey) continue;
      const currentNode = nodeMap.get(currentKey);
      if (!currentNode) continue;
      currentNode.incidentEntityIds.forEach((entityId) => {
        const candidate = candidateById.get(entityId);
        if (!candidate) return;
        const adjacentKeys = [candidate.startKey, candidate.endKey];
        adjacentKeys.forEach((adjacentKey) => {
          if (visitedNodeKeys.has(adjacentKey)) return;
          visitedNodeKeys.add(adjacentKey);
          queue.push(adjacentKey);
        });
      });
    }
  });

  const danglingNodes = nodes
    .filter((node) => node.incidentEntityIds.length === 1)
    .map((node) => ({
      label: node.label,
      x: node.point.x,
      y: node.point.y,
      incidentCount: node.incidentEntityIds.length,
    }));
  const branchNodes = nodes
    .filter((node) => node.incidentEntityIds.length > 2)
    .map((node) => ({
      label: node.label,
      x: node.point.x,
      y: node.point.y,
      incidentCount: node.incidentEntityIds.length,
    }));

  const overlapCandidates = new Map<string, CadParcelLineCandidate[]>();
  candidates.forEach((candidate) => {
    const overlapKey =
      candidate.startKey < candidate.endKey
        ? `${candidate.startKey}|${candidate.endKey}`
        : `${candidate.endKey}|${candidate.startKey}`;
    const existing = overlapCandidates.get(overlapKey);
    if (existing) {
      existing.push(candidate);
      return;
    }
    overlapCandidates.set(overlapKey, [candidate]);
  });
  const overlapSegments = [...overlapCandidates.values()]
    .filter((group) => group.length > 1)
    .map((group) => {
      const first = group[0]!;
      const orderedLabels =
        first.startLabel.localeCompare(first.endLabel) <= 0
          ? { firstLabel: first.startLabel, secondLabel: first.endLabel }
          : { firstLabel: first.endLabel, secondLabel: first.startLabel };
      return {
        firstLabel: orderedLabels.firstLabel,
        secondLabel: orderedLabels.secondLabel,
        segmentCount: group.length,
        lengthMeters: cadDistance(first.start, first.end),
      };
    });

  const isClosedLoopCandidate =
    entities.length >= 3 &&
    nodes.length >= 3 &&
    componentCount === 1 &&
    danglingNodes.length === 0 &&
    branchNodes.length === 0 &&
    overlapSegments.length === 0 &&
    cadBuildParcelSourceDraft(entities) != null;

  return {
    lineCount: entities.length,
    nodeCount: nodes.length,
    componentCount,
    danglingNodes,
    branchNodes,
    overlapSegments,
    isClosedLoopCandidate,
  };
};

export const cadBuildParcelSplitByLineDraft = (
  parcel: CadParcelEntity,
  splitLine: CadLineEntity,
): CadParcelSplitDraft | null => {
  const ring = parcel.vertices.map((vertex) => ({ x: vertex.x, y: vertex.y }));
  const labels = [...parcel.vertexLabels];
  if (ring.length < 3 || labels.length !== ring.length) return null;

  const splitStart = { x: splitLine.fromX, y: splitLine.fromY };
  const splitEnd = { x: splitLine.toX, y: splitLine.toY };

  const intersections: Array<{
    edgeIndex: number;
    point: CadWorldPoint;
    lineDistance: number;
    edgeDistance: number;
  }> = [];

  for (let index = 0; index < ring.length; index += 1) {
    const start = ring[index]!;
    const end = ring[(index + 1) % ring.length]!;
    const point = cadSegmentIntersection(splitStart, splitEnd, start, end);
    if (!point) continue;
    if (parcelPointsMatch(point, start) || parcelPointsMatch(point, end)) {
      return null;
    }
    intersections.push({
      edgeIndex: index,
      point,
      lineDistance: cadDistance(splitStart, point),
      edgeDistance: cadDistance(start, point),
    });
  }

  intersections.sort((left, right) => left.lineDistance - right.lineDistance);
  if (intersections.length !== 2) return null;
  if (intersections[0]!.edgeIndex === intersections[1]!.edgeIndex) return null;

  const splitPointLabels = new Map<string, string>();
  splitPointLabels.set(parcelPointKey(intersections[0]!.point), 'CUT1');
  splitPointLabels.set(parcelPointKey(intersections[1]!.point), 'CUT2');

  const augmentedVertices: CadWorldPoint[] = [];
  const augmentedLabels: string[] = [];
  for (let index = 0; index < ring.length; index += 1) {
    augmentedVertices.push(ring[index]!);
    augmentedLabels.push(labels[index] ?? `V${index + 1}`);
    intersections
      .filter((intersection) => intersection.edgeIndex === index)
      .sort((left, right) => left.edgeDistance - right.edgeDistance)
      .forEach((intersection) => {
        augmentedVertices.push(intersection.point);
        augmentedLabels.push(splitPointLabels.get(parcelPointKey(intersection.point)) ?? 'CUT');
      });
  }

  const cut1Index = augmentedLabels.indexOf('CUT1');
  const cut2Index = augmentedLabels.indexOf('CUT2');
  if (cut1Index < 0 || cut2Index < 0 || cut1Index === cut2Index) return null;

  const collectPath = (startIndex: number, endIndex: number) => {
    const points: CadWorldPoint[] = [];
    const pathLabels: string[] = [];
    let index = startIndex;
    while (true) {
      points.push(augmentedVertices[index]!);
      pathLabels.push(augmentedLabels[index]!);
      if (index === endIndex) break;
      index = (index + 1) % augmentedVertices.length;
    }
    return { points, pathLabels };
  };

  const firstPath = collectPath(cut1Index, cut2Index);
  const secondPath = collectPath(cut2Index, cut1Index);

  const firstSummary = cadBuildParcelClosureSummary(firstPath.points);
  const secondSummary = cadBuildParcelClosureSummary(secondPath.points);
  if (!firstSummary || !secondSummary) return null;
  if (firstSummary.areaSquareMeters <= 1e-9 || secondSummary.areaSquareMeters <= 1e-9) return null;
  if (cadPointListsMatch(firstPath.points, secondPath.points)) return null;

  return {
    firstVertices: firstPath.points,
    firstVertexLabels: firstPath.pathLabels,
    secondVertices: secondPath.points,
    secondVertexLabels: secondPath.pathLabels,
    splitStart: intersections[0]!.point,
    splitEnd: intersections[1]!.point,
  };
};

interface CadMatchedParcelFrontageEdge {
  edgeIndex: number;
  startVertexIndex: number;
  endVertexIndex: number;
  start: CadWorldPoint;
  end: CadWorldPoint;
  startLabel: string;
  endLabel: string;
  lengthMeters: number;
}

interface CadParcelSelectedSplitSide {
  vertices: CadWorldPoint[];
  labels: string[];
  areaSquareMeters: number;
}

interface CadParcelLayoutLocalPoint {
  x: number;
  y: number;
}

interface CadParcelLayoutFrontagePathLineSegment {
  kind: 'line';
  startDistance: number;
  endDistance: number;
  startPoint: CadWorldPoint;
  endPoint: CadWorldPoint;
}

interface CadParcelLayoutFrontagePathArcSegment {
  kind: 'arc';
  startDistance: number;
  endDistance: number;
  center: CadWorldPoint;
  radius: number;
  startAngleDeg: number;
  endAngleDeg: number;
}

type CadParcelLayoutFrontagePathSegment =
  | CadParcelLayoutFrontagePathLineSegment
  | CadParcelLayoutFrontagePathArcSegment;

interface CadParcelLayoutFrontagePath {
  segments: CadParcelLayoutFrontagePathSegment[];
  totalLengthMeters: number;
}

interface CadParcelLayoutFrontageSample {
  point: CadWorldPoint;
  tangent: CadWorldPoint;
}

const cadDotWorldPoint = (left: CadWorldPoint, right: CadWorldPoint): number =>
  left.x * right.x + left.y * right.y;

const cadBuildParcelLayoutFrontagePath = (
  parcel: CadParcelEntity,
  frontageReference: CadParcelLayoutFrontageReference,
): CadParcelLayoutFrontagePath | null => {
  if (frontageReference.parcelSegmentLabelPairs && frontageReference.parcelSegmentLabelPairs.length > 0) {
    const vertices = normalizeParcelPolygonVertices(parcel.vertices);
    if (vertices.length < 2 || parcel.vertexLabels.length !== vertices.length) return null;
    const labels = parcel.vertexLabels.map((label, index) => label ?? `CAD${index + 1}`);
    let runningDistance = 0;
    const segments: CadParcelLayoutFrontagePathSegment[] = [];
    frontageReference.parcelSegmentLabelPairs.forEach(([startLabel, endLabel]) => {
      const startIndex = labels.findIndex((label) => label === startLabel);
      const endIndex = labels.findIndex((label) => label === endLabel);
      if (startIndex < 0 || endIndex < 0) return;
      const directNextIndex = (startIndex + 1) % vertices.length;
      const directPreviousIndex = (startIndex + vertices.length - 1) % vertices.length;
      const startPoint = vertices[startIndex]!;
      let endPoint: CadWorldPoint | null = null;
      if (directNextIndex === endIndex) {
        endPoint = vertices[endIndex]!;
      } else if (directPreviousIndex === endIndex) {
        endPoint = vertices[endIndex]!;
      }
      if (!endPoint) return;
      const segmentLength = cadDistance(startPoint, endPoint);
      if (segmentLength <= 1e-9) return;
      segments.push({
        kind: 'line',
        startDistance: runningDistance,
        endDistance: runningDistance + segmentLength,
        startPoint: { x: startPoint.x, y: startPoint.y },
        endPoint: { x: endPoint.x, y: endPoint.y },
      });
      runningDistance += segmentLength;
    });
    return segments.length > 0
      ? {
          segments,
          totalLengthMeters: runningDistance,
        }
      : null;
  }

  const geometry = frontageReference.sourceGeometry;
  if (geometry?.kind === 'polyline') {
    if (geometry.vertices.length < 2) return null;
    let runningDistance = 0;
    const segments: CadParcelLayoutFrontagePathSegment[] = [];
    for (let index = 0; index < geometry.vertices.length - 1; index += 1) {
      const startPoint = geometry.vertices[index]!;
      const endPoint = geometry.vertices[index + 1]!;
      const segmentLength = cadDistance(startPoint, endPoint);
      if (segmentLength <= 1e-9) continue;
      segments.push({
        kind: 'line',
        startDistance: runningDistance,
        endDistance: runningDistance + segmentLength,
        startPoint: { x: startPoint.x, y: startPoint.y },
        endPoint: { x: endPoint.x, y: endPoint.y },
      });
      runningDistance += segmentLength;
    }
    return segments.length > 0
      ? {
          segments,
          totalLengthMeters: runningDistance,
        }
      : null;
  }

  if (geometry?.kind === 'arc') {
    const sweepDeg = cadSignedSweepDeg(geometry.startAngleDeg, geometry.endAngleDeg);
    const arcLength = Math.abs((sweepDeg * Math.PI * geometry.radius) / 180);
    if (arcLength <= 1e-9) return null;
    return {
      segments: [
        {
          kind: 'arc',
          startDistance: 0,
          endDistance: arcLength,
          center: { x: geometry.center.x, y: geometry.center.y },
          radius: geometry.radius,
          startAngleDeg: geometry.startAngleDeg,
          endAngleDeg: geometry.endAngleDeg,
        },
      ],
      totalLengthMeters: arcLength,
    };
  }

  const startPoint = { x: frontageReference.frontageLine.fromX, y: frontageReference.frontageLine.fromY };
  const endPoint = { x: frontageReference.frontageLine.toX, y: frontageReference.frontageLine.toY };
  const lengthMeters = cadDistance(startPoint, endPoint);
  if (lengthMeters <= 1e-9) return null;
  return {
    segments: [
      {
        kind: 'line',
        startDistance: 0,
        endDistance: lengthMeters,
        startPoint,
        endPoint,
      },
    ],
    totalLengthMeters: lengthMeters,
  };
};

const cadSampleParcelLayoutFrontagePath = (
  path: CadParcelLayoutFrontagePath,
  distanceMeters: number,
): CadParcelLayoutFrontageSample | null => {
  if (!Number.isFinite(distanceMeters)) return null;
  const clampedDistance = Math.max(0, Math.min(path.totalLengthMeters, distanceMeters));
  const segment =
    path.segments.find(
      (candidate) =>
        clampedDistance >= candidate.startDistance - 1e-9 &&
        clampedDistance <= candidate.endDistance + 1e-9,
    ) ?? path.segments[path.segments.length - 1];
  if (!segment) return null;
  const localDistance = Math.max(0, Math.min(segment.endDistance - segment.startDistance, clampedDistance - segment.startDistance));
  if (segment.kind === 'line') {
    const segmentLength = cadDistance(segment.startPoint, segment.endPoint);
    if (segmentLength <= 1e-9) return null;
    const unit = {
      x: (segment.endPoint.x - segment.startPoint.x) / segmentLength,
      y: (segment.endPoint.y - segment.startPoint.y) / segmentLength,
    };
    return {
      point: {
        x: segment.startPoint.x + unit.x * localDistance,
        y: segment.startPoint.y + unit.y * localDistance,
      },
      tangent: unit,
    };
  }
  const sweepDeg = cadSignedSweepDeg(segment.startAngleDeg, segment.endAngleDeg);
  const signedLocalDeg = (localDistance / segment.radius) * (180 / Math.PI) * (sweepDeg >= 0 ? 1 : -1);
  const angleDeg = segment.startAngleDeg + signedLocalDeg;
  const angleRad = (angleDeg * Math.PI) / 180;
  const point = cadPointOnCircle(segment.center, segment.radius, angleDeg);
  const tangent = sweepDeg >= 0 ? { x: -Math.sin(angleRad), y: Math.cos(angleRad) } : { x: Math.sin(angleRad), y: -Math.cos(angleRad) };
  return {
    point,
    tangent,
  };
};

const cadBuildParcelLayoutFrontageSubPath = (
  path: CadParcelLayoutFrontagePath,
  startDistanceMeters: number,
  endDistanceMeters: number,
): CadParcelLayoutFrontagePath | null => {
  if (endDistanceMeters - startDistanceMeters <= 1e-9) return null;
  const segments: CadParcelLayoutFrontagePathSegment[] = [];
  let runningDistance = 0;
  path.segments.forEach((segment) => {
    const overlapStart = Math.max(startDistanceMeters, segment.startDistance);
    const overlapEnd = Math.min(endDistanceMeters, segment.endDistance);
    if (overlapEnd - overlapStart <= 1e-9) return;
    if (segment.kind === 'line') {
      const startSample = cadSampleParcelLayoutFrontagePath(path, overlapStart);
      const endSample = cadSampleParcelLayoutFrontagePath(path, overlapEnd);
      if (!startSample || !endSample) return;
      const lengthMeters = cadDistance(startSample.point, endSample.point);
      if (lengthMeters <= 1e-9) return;
      segments.push({
        kind: 'line',
        startDistance: runningDistance,
        endDistance: runningDistance + lengthMeters,
        startPoint: startSample.point,
        endPoint: endSample.point,
      });
      runningDistance += lengthMeters;
      return;
    }
    const localStartDistance = overlapStart - segment.startDistance;
    const localEndDistance = overlapEnd - segment.startDistance;
    const sweepDeg = cadSignedSweepDeg(segment.startAngleDeg, segment.endAngleDeg);
    const signedStartDeltaDeg = (localStartDistance / segment.radius) * (180 / Math.PI) * (sweepDeg >= 0 ? 1 : -1);
    const signedEndDeltaDeg = (localEndDistance / segment.radius) * (180 / Math.PI) * (sweepDeg >= 0 ? 1 : -1);
    const subStartAngleDeg = segment.startAngleDeg + signedStartDeltaDeg;
    const subEndAngleDeg = segment.startAngleDeg + signedEndDeltaDeg;
    const lengthMeters = overlapEnd - overlapStart;
    segments.push({
      kind: 'arc',
      startDistance: runningDistance,
      endDistance: runningDistance + lengthMeters,
      center: { x: segment.center.x, y: segment.center.y },
      radius: segment.radius,
      startAngleDeg: subStartAngleDeg,
      endAngleDeg: subEndAngleDeg,
    });
    runningDistance += lengthMeters;
  });
  return segments.length > 0
    ? {
        segments,
        totalLengthMeters: runningDistance,
      }
    : null;
};

const cadDeduplicateWorldPolygonVertices = (
  vertices: readonly CadWorldPoint[],
  tolerance = 1e-9,
): CadWorldPoint[] => {
  const deduplicated: CadWorldPoint[] = [];
  vertices.forEach((vertex) => {
    const previous = deduplicated[deduplicated.length - 1];
    if (
      previous &&
      Math.abs(previous.x - vertex.x) <= tolerance &&
      Math.abs(previous.y - vertex.y) <= tolerance
    ) {
      return;
    }
    deduplicated.push({ x: vertex.x, y: vertex.y });
  });
  if (deduplicated.length > 1) {
    const first = deduplicated[0]!;
    const last = deduplicated[deduplicated.length - 1]!;
    if (Math.abs(first.x - last.x) <= tolerance && Math.abs(first.y - last.y) <= tolerance) {
      deduplicated.pop();
    }
  }
  return deduplicated;
};

const cadClipPolygonAgainstLineHalfPlane = (
  vertices: readonly CadWorldPoint[],
  linePoint: CadWorldPoint,
  lineNormal: CadWorldPoint,
  keepPositive: boolean,
): CadWorldPoint[] => {
  if (vertices.length < 3) return [];
  const clipped: CadWorldPoint[] = [];
  const signedDistance = (point: CadWorldPoint) =>
    cadDotWorldPoint(
      {
        x: point.x - linePoint.x,
        y: point.y - linePoint.y,
      },
      lineNormal,
    );
  const isInside = (point: CadWorldPoint) =>
    keepPositive ? signedDistance(point) >= -1e-9 : signedDistance(point) <= 1e-9;

  for (let index = 0; index < vertices.length; index += 1) {
    const current = vertices[index]!;
    const previous = vertices[(index + vertices.length - 1) % vertices.length]!;
    const currentInside = isInside(current);
    const previousInside = isInside(previous);
    if (currentInside !== previousInside) {
      const previousDistance = signedDistance(previous);
      const currentDistance = signedDistance(current);
      const denominator = previousDistance - currentDistance;
      if (Math.abs(denominator) > 1e-12) {
        const ratio = previousDistance / denominator;
        clipped.push({
          x: previous.x + (current.x - previous.x) * ratio,
          y: previous.y + (current.y - previous.y) * ratio,
        });
      }
    }
    if (currentInside) {
      clipped.push({ x: current.x, y: current.y });
    }
  }
  return cadDeduplicateWorldPolygonVertices(clipped);
};

const cadBuildParcelLayoutGeneratedParcelFromFrontageInterval = (
  parcel: CadParcelEntity,
  path: CadParcelLayoutFrontagePath,
  startDistanceMeters: number,
  endDistanceMeters: number,
  lotIndex: number,
  role: 'lot' | 'remainder',
): (CadParcelLayoutGeneratedParcelDraft & {
  frontageStart: CadWorldPoint;
  frontageEnd: CadWorldPoint;
  frontageLengthMeters: number;
}) | null => {
  if (endDistanceMeters - startDistanceMeters <= 1e-6) return null;
  const startSample = cadSampleParcelLayoutFrontagePath(path, startDistanceMeters);
  const endSample = cadSampleParcelLayoutFrontagePath(path, endDistanceMeters);
  if (!startSample || !endSample) return null;
  let clippedVertices = parcel.vertices.map((vertex) => ({ x: vertex.x, y: vertex.y }));
  clippedVertices = cadClipPolygonAgainstLineHalfPlane(
    clippedVertices,
    startSample.point,
    startSample.tangent,
    true,
  );
  if (clippedVertices.length < 3) return null;
  clippedVertices = cadClipPolygonAgainstLineHalfPlane(
    clippedVertices,
    endSample.point,
    endSample.tangent,
    false,
  );
  if (clippedVertices.length < 3) return null;
  return {
    vertices: clippedVertices,
    vertexLabels: cadBuildAutoParcelVertexLabels(parcel, clippedVertices, lotIndex),
    role,
    frontageStart: startSample.point,
    frontageEnd: endSample.point,
    frontageLengthMeters: endDistanceMeters - startDistanceMeters,
  };
};

const cadBuildDepthLimitedStripGeneratedParcel = (
  parcel: CadParcelEntity,
  frontageLine: CadLineEntity,
  startDistanceMeters: number,
  endDistanceMeters: number,
  depthLimitMeters: number,
  lotIndex: number,
  role: 'lot' | 'remainder',
): (CadParcelLayoutGeneratedParcelDraft & {
  frontageStart: CadWorldPoint;
  frontageEnd: CadWorldPoint;
  frontageLengthMeters: number;
}) | null => {
  const frontageStart = { x: frontageLine.fromX, y: frontageLine.fromY };
  const frontageEnd = { x: frontageLine.toX, y: frontageLine.toY };
  const frontageLength = cadDistance(frontageStart, frontageEnd);
  if (frontageLength <= 1e-9) return null;
  const rawLocalVertices = parcel.vertices.map((vertex) => {
    const dx = vertex.x - frontageStart.x;
    const dy = vertex.y - frontageStart.y;
    const unitX = (frontageEnd.x - frontageStart.x) / frontageLength;
    const unitY = (frontageEnd.y - frontageStart.y) / frontageLength;
    return {
      x: dx * unitX + dy * unitY,
      y: dx * -unitY + dy * unitX,
    };
  });
  const maxY = rawLocalVertices.reduce((maximum, point) => Math.max(maximum, point.y), Number.NEGATIVE_INFINITY);
  const minY = rawLocalVertices.reduce((minimum, point) => Math.min(minimum, point.y), Number.POSITIVE_INFINITY);
  const flipY = Math.abs(minY) > Math.abs(maxY);
  const localVertices = rawLocalVertices.map((point) => ({ x: point.x, y: flipY ? -point.y : point.y }));
  let clippedLocalVertices = cadClipLocalPolygonToVerticalStrip(localVertices, startDistanceMeters, endDistanceMeters);
  if (clippedLocalVertices.length < 3) return null;
  clippedLocalVertices = cadClipLocalPolygonAgainstHorizontalBoundary(
    clippedLocalVertices,
    depthLimitMeters,
    true,
  );
  if (clippedLocalVertices.length < 3) return null;
  const worldVertices = clippedLocalVertices.map((point) =>
    cadBuildParcelLayoutLocalToWorldPoint(frontageStart, frontageEnd, point, flipY),
  );
  return {
    vertices: worldVertices,
    vertexLabels: cadBuildAutoParcelVertexLabels(parcel, worldVertices, lotIndex),
    role,
    frontageStart: cadBuildParcelLayoutLocalToWorldPoint(
      frontageStart,
      frontageEnd,
      { x: startDistanceMeters, y: 0 },
      flipY,
    ),
    frontageEnd: cadBuildParcelLayoutLocalToWorldPoint(
      frontageStart,
      frontageEnd,
      { x: endDistanceMeters, y: 0 },
      flipY,
    ),
    frontageLengthMeters: endDistanceMeters - startDistanceMeters,
  };
};

const cadBuildDepthLimitedStripRearRemainder = (
  parcel: CadParcelEntity,
  frontageLine: CadLineEntity,
  depthLimitMeters: number,
): CadParcelLayoutGeneratedParcelDraft | null => {
  const frontageStart = { x: frontageLine.fromX, y: frontageLine.fromY };
  const frontageEnd = { x: frontageLine.toX, y: frontageLine.toY };
  const frontageLength = cadDistance(frontageStart, frontageEnd);
  if (frontageLength <= 1e-9) return null;
  const rawLocalVertices = parcel.vertices.map((vertex) => {
    const dx = vertex.x - frontageStart.x;
    const dy = vertex.y - frontageStart.y;
    const unitX = (frontageEnd.x - frontageStart.x) / frontageLength;
    const unitY = (frontageEnd.y - frontageStart.y) / frontageLength;
    return {
      x: dx * unitX + dy * unitY,
      y: dx * -unitY + dy * unitX,
    };
  });
  const maxY = rawLocalVertices.reduce((maximum, point) => Math.max(maximum, point.y), Number.NEGATIVE_INFINITY);
  const minY = rawLocalVertices.reduce((minimum, point) => Math.min(minimum, point.y), Number.POSITIVE_INFINITY);
  const flipY = Math.abs(minY) > Math.abs(maxY);
  const localVertices = rawLocalVertices.map((point) => ({ x: point.x, y: flipY ? -point.y : point.y }));
  const clippedLocalVertices = cadClipLocalPolygonAgainstHorizontalBoundary(localVertices, depthLimitMeters, false);
  if (clippedLocalVertices.length < 3) return null;
  const worldVertices = clippedLocalVertices.map((point) =>
    cadBuildParcelLayoutLocalToWorldPoint(frontageStart, frontageEnd, point, flipY),
  );
  const areaSquareMeters = cadBuildParcelClosureSummary(worldVertices)?.areaSquareMeters ?? 0;
  if (areaSquareMeters <= 1e-6) return null;
  return {
    vertices: worldVertices,
    vertexLabels: cadBuildAutoParcelVertexLabels(parcel, worldVertices, 9999),
    role: 'remainder',
  };
};

const cadBuildDepthLimitedParcelFromFrontage = (
  parcel: CadParcelEntity,
  frontageLine: CadLineEntity,
  depthLimitMeters: number,
): CadParcelEntity | null => {
  const frontageStart = { x: frontageLine.fromX, y: frontageLine.fromY };
  const frontageEnd = { x: frontageLine.toX, y: frontageLine.toY };
  const frontageLength = cadDistance(frontageStart, frontageEnd);
  if (frontageLength <= 1e-9) return null;
  const rawLocalVertices = parcel.vertices.map((vertex) => {
    const dx = vertex.x - frontageStart.x;
    const dy = vertex.y - frontageStart.y;
    const unitX = (frontageEnd.x - frontageStart.x) / frontageLength;
    const unitY = (frontageEnd.y - frontageStart.y) / frontageLength;
    return {
      x: dx * unitX + dy * unitY,
      y: dx * -unitY + dy * unitX,
    };
  });
  const maxY = rawLocalVertices.reduce((maximum, point) => Math.max(maximum, point.y), Number.NEGATIVE_INFINITY);
  const minY = rawLocalVertices.reduce((minimum, point) => Math.min(minimum, point.y), Number.POSITIVE_INFINITY);
  const flipY = Math.abs(minY) > Math.abs(maxY);
  const localVertices = rawLocalVertices.map((point) => ({ x: point.x, y: flipY ? -point.y : point.y }));
  const clippedLocalVertices = cadClipLocalPolygonAgainstHorizontalBoundary(localVertices, depthLimitMeters, true);
  if (clippedLocalVertices.length < 3) return null;
  const worldVertices = clippedLocalVertices.map((point) =>
    cadBuildParcelLayoutLocalToWorldPoint(frontageStart, frontageEnd, point, flipY),
  );
  const areaSquareMeters = cadBuildParcelClosureSummary(worldVertices)?.areaSquareMeters ?? 0;
  if (areaSquareMeters <= 1e-6) return null;
  return {
    ...parcel,
    vertices: worldVertices,
    vertexLabels: cadBuildAutoParcelVertexLabels(parcel, worldVertices, 9000),
  };
};

const cadDistancePointToSegment = (
  point: CadWorldPoint,
  start: CadWorldPoint,
  end: CadWorldPoint,
): number => {
  const delta = {
    x: end.x - start.x,
    y: end.y - start.y,
  };
  const lengthSquared = delta.x * delta.x + delta.y * delta.y;
  if (lengthSquared <= 1e-12) return cadDistance(point, start);
  const ratio = Math.max(
    0,
    Math.min(
      1,
      ((point.x - start.x) * delta.x + (point.y - start.y) * delta.y) / lengthSquared,
    ),
  );
  return cadDistance(point, {
    x: start.x + delta.x * ratio,
    y: start.y + delta.y * ratio,
  });
};

const cadAngleWithinArcSweep = (
  startAngleDeg: number,
  endAngleDeg: number,
  angleDeg: number,
): boolean => {
  const sweepDeg = cadSignedSweepDeg(startAngleDeg, endAngleDeg);
  const offsetDeg = cadSignedSweepDeg(startAngleDeg, angleDeg);
  return sweepDeg >= 0
    ? offsetDeg >= -1e-9 && offsetDeg <= sweepDeg + 1e-9
    : offsetDeg <= 1e-9 && offsetDeg >= sweepDeg - 1e-9;
};

const cadDistancePointToArcSegment = (
  point: CadWorldPoint,
  segment: CadParcelLayoutFrontagePathArcSegment,
): number => {
  const angleDeg = cadNormalizeAngleDeg(cadAzimuthDeg(segment.center, point));
  if (cadAngleWithinArcSweep(segment.startAngleDeg, segment.endAngleDeg, angleDeg)) {
    return Math.abs(cadDistance(point, segment.center) - segment.radius);
  }
  return Math.min(
    cadDistance(point, cadPointOnCircle(segment.center, segment.radius, segment.startAngleDeg)),
    cadDistance(point, cadPointOnCircle(segment.center, segment.radius, segment.endAngleDeg)),
  );
};

const cadBuildParcelLayoutPathDepthMeters = (
  vertices: readonly CadWorldPoint[],
  path: CadParcelLayoutFrontagePath,
): number | null => {
  if (vertices.length < 3 || path.segments.length === 0) return null;
  let maxDistance = 0;
  vertices.forEach((vertex) => {
    const distanceToPath = Math.min(
      ...path.segments.map((segment) =>
        segment.kind === 'line'
          ? cadDistancePointToSegment(vertex, segment.startPoint, segment.endPoint)
          : cadDistancePointToArcSegment(vertex, segment),
      ),
    );
    if (Number.isFinite(distanceToPath)) {
      maxDistance = Math.max(maxDistance, distanceToPath);
    }
  });
  return maxDistance;
};

const cadMatchFrontageLineToParcelEdge = (
  parcel: CadParcelEntity,
  frontageLine: CadLineEntity,
): CadMatchedParcelFrontageEdge | null => {
  const vertices = normalizeParcelPolygonVertices(parcel.vertices);
  if (vertices.length < 3 || parcel.vertexLabels.length !== vertices.length) return null;
  const lineStart = { x: frontageLine.fromX, y: frontageLine.fromY };
  const lineEnd = { x: frontageLine.toX, y: frontageLine.toY };
  for (let index = 0; index < vertices.length; index += 1) {
    const start = vertices[index]!;
    const end = vertices[(index + 1) % vertices.length]!;
    if (
      (parcelPointsMatch(start, lineStart) && parcelPointsMatch(end, lineEnd)) ||
      (parcelPointsMatch(start, lineEnd) && parcelPointsMatch(end, lineStart))
    ) {
      return {
        edgeIndex: index,
        startVertexIndex: index,
        endVertexIndex: (index + 1) % vertices.length,
        start,
        end,
        startLabel: parcel.vertexLabels[index] ?? `V${index + 1}`,
        endLabel: parcel.vertexLabels[(index + 1) % vertices.length] ?? `V${((index + 1) % vertices.length) + 1}`,
        lengthMeters: cadDistance(start, end),
      };
    }
  }
  return null;
};

const cadBuildEdgeInteriorSamplePoint = (
  polygon: readonly CadWorldPoint[],
  edgeStart: CadWorldPoint,
  edgeEnd: CadWorldPoint,
  segmentStart: CadWorldPoint,
  segmentEnd: CadWorldPoint,
): CadWorldPoint | null => {
  const polygonAreaDouble = cadPolygonSignedAreaDouble(normalizeParcelPolygonVertices(polygon));
  const segmentLength = cadDistance(segmentStart, segmentEnd);
  const edgeLength = cadDistance(edgeStart, edgeEnd);
  if (Math.abs(polygonAreaDouble) <= 1e-12 || segmentLength <= 1e-9 || edgeLength <= 1e-9) return null;
  const midpoint = {
    x: (segmentStart.x + segmentEnd.x) / 2,
    y: (segmentStart.y + segmentEnd.y) / 2,
  };
  const edgeUnitX = (edgeEnd.x - edgeStart.x) / edgeLength;
  const edgeUnitY = (edgeEnd.y - edgeStart.y) / edgeLength;
  const offsetDistance = Math.max(Math.min(edgeLength, segmentLength) * 1e-3, 1e-4);
  const interiorNormal =
    polygonAreaDouble > 0
      ? { x: -edgeUnitY, y: edgeUnitX }
      : { x: edgeUnitY, y: -edgeUnitX };
  return {
    x: midpoint.x + interiorNormal.x * offsetDistance,
    y: midpoint.y + interiorNormal.y * offsetDistance,
  };
};

const cadSelectParcelSplitSide = (
  draft: CadParcelSplitDraft,
  samplePoint: CadWorldPoint,
): CadParcelSelectedSplitSide | null => {
  const candidates: CadParcelSelectedSplitSide[] = [
    {
      vertices: draft.firstVertices,
      labels: draft.firstVertexLabels,
      areaSquareMeters: cadBuildParcelClosureSummary(draft.firstVertices)?.areaSquareMeters ?? 0,
    },
    {
      vertices: draft.secondVertices,
      labels: draft.secondVertexLabels,
      areaSquareMeters: cadBuildParcelClosureSummary(draft.secondVertices)?.areaSquareMeters ?? 0,
    },
  ];
  return (
    candidates.find(
      (candidate) =>
        candidate.areaSquareMeters > 1e-9 && cadPointInPolygon(samplePoint, candidate.vertices),
    ) ?? null
  );
};

const cadBuildParcelLayoutDraft = (
  split: CadParcelSplitDraft,
  alternative: CadParcelLayoutSplitAlternative,
  frontageLengthMeters: number,
  childSide: CadParcelSelectedSplitSide,
): CadParcelLayoutSplitDraft => ({
  split,
  alternative,
  frontageLengthMeters,
  childAreaSquareMeters: childSide.areaSquareMeters,
  childVertices: childSide.vertices.map((vertex) => ({ x: vertex.x, y: vertex.y })),
  childVertexLabels: [...childSide.labels],
  remainderVertices:
    childSide.vertices === split.firstVertices
      ? split.secondVertices.map((vertex) => ({ x: vertex.x, y: vertex.y }))
      : split.firstVertices.map((vertex) => ({ x: vertex.x, y: vertex.y })),
  remainderVertexLabels:
    childSide.vertices === split.firstVertices
      ? [...split.secondVertexLabels]
      : [...split.firstVertexLabels],
});

const cadBuildParcelSwingSplitDraft = (
  parcel: CadParcelEntity,
  frontageEdge: CadMatchedParcelFrontageEdge,
  alternative: CadParcelLayoutSplitAlternative,
  cutEdgeIndex: number,
  cutPoint: CadWorldPoint,
): CadParcelSplitDraft | null => {
  const ring = normalizeParcelPolygonVertices(parcel.vertices);
  const labels = [...parcel.vertexLabels];
  if (ring.length < 3 || labels.length !== ring.length) return null;

  const hingeVertexIndex =
    alternative === 'start' ? frontageEdge.startVertexIndex : frontageEdge.endVertexIndex;
  const oppositeFrontageVertexIndex =
    alternative === 'start' ? frontageEdge.endVertexIndex : frontageEdge.startVertexIndex;
  const cutEdgeStart = ring[cutEdgeIndex]!;
  const cutEdgeEnd = ring[(cutEdgeIndex + 1) % ring.length]!;
  if (!cadPointOnSegment(cutPoint, cutEdgeStart, cutEdgeEnd)) return null;
  if (
    parcelPointsMatch(cutPoint, ring[hingeVertexIndex]!) ||
    parcelPointsMatch(cutPoint, cutEdgeStart) ||
    parcelPointsMatch(cutPoint, cutEdgeEnd)
  ) {
    return null;
  }

  const childVertices: CadWorldPoint[] = [];
  const childLabels: string[] = [];
  childVertices.push(ring[hingeVertexIndex]!);
  childLabels.push(labels[hingeVertexIndex] ?? `V${hingeVertexIndex + 1}`);
  childVertices.push(ring[oppositeFrontageVertexIndex]!);
  childLabels.push(labels[oppositeFrontageVertexIndex] ?? `V${oppositeFrontageVertexIndex + 1}`);
  let currentIndex = oppositeFrontageVertexIndex;
  while (currentIndex !== cutEdgeIndex) {
    currentIndex = (currentIndex + 1) % ring.length;
    childVertices.push(ring[currentIndex]!);
    childLabels.push(labels[currentIndex] ?? `V${currentIndex + 1}`);
  }
  childVertices.push(cutPoint);
  childLabels.push('SWING');

  const remainderVertices: CadWorldPoint[] = [cutPoint];
  const remainderLabels: string[] = ['SWING'];
  currentIndex = (cutEdgeIndex + 1) % ring.length;
  while (true) {
    remainderVertices.push(ring[currentIndex]!);
    remainderLabels.push(labels[currentIndex] ?? `V${currentIndex + 1}`);
    if (currentIndex === hingeVertexIndex) break;
    currentIndex = (currentIndex + 1) % ring.length;
  }

  const childSummary = cadBuildParcelClosureSummary(childVertices);
  const remainderSummary = cadBuildParcelClosureSummary(remainderVertices);
  if (!childSummary || !remainderSummary) return null;
  if (childSummary.areaSquareMeters <= 1e-9 || remainderSummary.areaSquareMeters <= 1e-9) return null;

  return {
    firstVertices: childVertices,
    firstVertexLabels: childLabels,
    secondVertices: remainderVertices,
    secondVertexLabels: remainderLabels,
    splitStart: ring[hingeVertexIndex]!,
    splitEnd: cutPoint,
  };
};

interface CadParcelSlideEvaluation {
  draft: CadParcelLayoutSplitDraft;
  differenceSquareMeters: number;
  positionMeters: number;
}

const evaluateParcelSlideAtFrontageDistance = (
  parcel: CadParcelEntity,
  frontageEdge: CadMatchedParcelFrontageEdge,
  targetAreaSquareMeters: number,
  alternative: CadParcelLayoutSplitAlternative,
  distanceFromStartMeters: number,
): CadParcelSlideEvaluation | null => {
  const frontageLength = frontageEdge.lengthMeters;
  if (frontageLength <= 1e-9) return null;
  const fraction = distanceFromStartMeters / frontageLength;
  if (!Number.isFinite(fraction) || fraction <= 0 || fraction >= 1) return null;
  const cutPoint = {
    x: frontageEdge.start.x + (frontageEdge.end.x - frontageEdge.start.x) * fraction,
    y: frontageEdge.start.y + (frontageEdge.end.y - frontageEdge.start.y) * fraction,
  };
  const perpendicularAzimuthDeg =
    cadAzimuthDeg(frontageEdge.start, frontageEdge.end) + 90;
  const splitDraft = cadBuildParcelSplitLineDraftFromAzimuth(parcel, cutPoint, perpendicularAzimuthDeg);
  if (!splitDraft) return null;

  const frontageSegmentStart = alternative === 'start' ? frontageEdge.start : cutPoint;
  const frontageSegmentEnd = alternative === 'start' ? cutPoint : frontageEdge.end;
  const samplePoint = cadBuildEdgeInteriorSamplePoint(
    parcel.vertices,
    frontageEdge.start,
    frontageEdge.end,
    frontageSegmentStart,
    frontageSegmentEnd,
  );
  if (!samplePoint) return null;
  const selectedSide = cadSelectParcelSplitSide(splitDraft, samplePoint);
  if (!selectedSide) return null;

  return {
    draft: cadBuildParcelLayoutDraft(
      splitDraft,
      alternative,
      alternative === 'start' ? distanceFromStartMeters : frontageLength - distanceFromStartMeters,
      selectedSide,
    ),
    differenceSquareMeters: selectedSide.areaSquareMeters - targetAreaSquareMeters,
    positionMeters: distanceFromStartMeters,
  };
};

const solveParcelSlideDraft = (
  parcel: CadParcelEntity,
  frontageEdge: CadMatchedParcelFrontageEdge,
  targetAreaSquareMeters: number,
  minFrontageMeters: number,
  alternative: CadParcelLayoutSplitAlternative,
): CadParcelLayoutSplitDraft | null => {
  const frontageLength = frontageEdge.lengthMeters;
  const epsilon = Math.max(frontageLength * 1e-6, 1e-4);
  const minDistance = alternative === 'start' ? minFrontageMeters : epsilon;
  const maxDistance = alternative === 'start' ? frontageLength - epsilon : frontageLength - minFrontageMeters;
  if (!Number.isFinite(minDistance) || !Number.isFinite(maxDistance) || maxDistance - minDistance <= 1e-6) {
    return null;
  }

  const areaToleranceSquareMeters = Math.max(targetAreaSquareMeters * 1e-6, 1e-3);
  const samples: CadParcelSlideEvaluation[] = [];
  const sampleCount = 96;
  for (let index = 0; index <= sampleCount; index += 1) {
    const fraction = index / sampleCount;
    const distanceFromStart = minDistance + (maxDistance - minDistance) * fraction;
    const evaluation = evaluateParcelSlideAtFrontageDistance(
      parcel,
      frontageEdge,
      targetAreaSquareMeters,
      alternative,
      distanceFromStart,
    );
    if (evaluation && evaluation.draft.frontageLengthMeters + 1e-9 >= minFrontageMeters) {
      samples.push(evaluation);
    }
  }
  if (samples.length === 0) return null;

  let best = samples[0]!;
  let bracket: [CadParcelSlideEvaluation, CadParcelSlideEvaluation] | null = null;
  for (let index = 0; index < samples.length; index += 1) {
    const evaluation = samples[index]!;
    if (Math.abs(evaluation.differenceSquareMeters) < Math.abs(best.differenceSquareMeters)) {
      best = evaluation;
    }
    const next = samples[index + 1];
    if (
      next &&
      (evaluation.differenceSquareMeters === 0 ||
        next.differenceSquareMeters === 0 ||
        Math.sign(evaluation.differenceSquareMeters) !== Math.sign(next.differenceSquareMeters))
    ) {
      bracket = [evaluation, next];
      break;
    }
  }

  if (!bracket) {
    return Math.abs(best.differenceSquareMeters) <= areaToleranceSquareMeters ? best.draft : null;
  }

  let [low, high] = bracket;
  for (let iteration = 0; iteration < 48; iteration += 1) {
    const lowDistance = low.positionMeters;
    const highDistance = high.positionMeters;
    const midpointDistance = (lowDistance + highDistance) / 2;
    const mid = evaluateParcelSlideAtFrontageDistance(
      parcel,
      frontageEdge,
      targetAreaSquareMeters,
      alternative,
      midpointDistance,
    );
    if (!mid) break;
    if (Math.abs(mid.differenceSquareMeters) < Math.abs(best.differenceSquareMeters)) {
      best = mid;
    }
    if (Math.abs(mid.differenceSquareMeters) <= areaToleranceSquareMeters) {
      return mid.draft;
    }
    if (Math.sign(mid.differenceSquareMeters) === Math.sign(low.differenceSquareMeters)) {
      low = mid;
    } else {
      high = mid;
    }
  }

  return Math.abs(best.differenceSquareMeters) <= areaToleranceSquareMeters ? best.draft : null;
};

export const cadBuildParcelSplitBySlideDraft = (
  parcel: CadParcelEntity,
  frontageLine: CadLineEntity,
  targetAreaSquareMeters: number,
  minFrontageMeters: number,
  alternative: CadParcelLayoutSplitAlternative = 'start',
): CadParcelLayoutSplitDraft | null => {
  if (!Number.isFinite(targetAreaSquareMeters) || targetAreaSquareMeters <= 0) return null;
  if (!Number.isFinite(minFrontageMeters) || minFrontageMeters <= 0) return null;
  const parcelSummary = cadBuildParcelClosureSummary(parcel.vertices);
  if (!parcelSummary || targetAreaSquareMeters >= parcelSummary.areaSquareMeters - 1e-6) return null;
  const frontageEdge = cadMatchFrontageLineToParcelEdge(parcel, frontageLine);
  if (!frontageEdge || frontageEdge.lengthMeters + 1e-9 < minFrontageMeters) return null;
  return solveParcelSlideDraft(
    parcel,
    frontageEdge,
    targetAreaSquareMeters,
    minFrontageMeters,
    alternative,
  );
};

interface CadParcelSwingBoundarySample {
  distanceAlongPathMeters: number;
  cutEdgeIndex: number;
  cutPoint: CadWorldPoint;
}

const cadBuildSwingBoundarySamples = (
  parcel: CadParcelEntity,
  frontageEdge: CadMatchedParcelFrontageEdge,
  alternative: CadParcelLayoutSplitAlternative,
): CadParcelSwingBoundarySample[] => {
  const ring = normalizeParcelPolygonVertices(parcel.vertices);
  if (ring.length < 3) return [];
  const hingeVertexIndex =
    alternative === 'start' ? frontageEdge.startVertexIndex : frontageEdge.endVertexIndex;
  const firstPathVertexIndex =
    alternative === 'start' ? frontageEdge.endVertexIndex : frontageEdge.startVertexIndex;
  const samples: CadParcelSwingBoundarySample[] = [];
  let currentVertexIndex = firstPathVertexIndex;
  let distanceAlongPathMeters = 0;
  while (currentVertexIndex !== hingeVertexIndex) {
    const edgeStart = ring[currentVertexIndex]!;
    const edgeEnd = ring[(currentVertexIndex + 1) % ring.length]!;
    const edgeLength = cadDistance(edgeStart, edgeEnd);
    if (edgeLength > 1e-9) {
      samples.push({
        distanceAlongPathMeters,
        cutEdgeIndex: currentVertexIndex,
        cutPoint: edgeStart,
      });
      distanceAlongPathMeters += edgeLength;
      samples.push({
        distanceAlongPathMeters,
        cutEdgeIndex: currentVertexIndex,
        cutPoint: edgeEnd,
      });
    }
    currentVertexIndex = (currentVertexIndex + 1) % ring.length;
  }
  return samples;
};

const cadEvaluateParcelSwingAtBoundaryDistance = (
  parcel: CadParcelEntity,
  frontageEdge: CadMatchedParcelFrontageEdge,
  targetAreaSquareMeters: number,
  alternative: CadParcelLayoutSplitAlternative,
  distanceAlongPathMeters: number,
): CadParcelSlideEvaluation | null => {
  const ring = normalizeParcelPolygonVertices(parcel.vertices);
  if (ring.length < 3) return null;
  const hingeVertexIndex =
    alternative === 'start' ? frontageEdge.startVertexIndex : frontageEdge.endVertexIndex;
  const firstPathVertexIndex =
    alternative === 'start' ? frontageEdge.endVertexIndex : frontageEdge.startVertexIndex;
  let currentVertexIndex = firstPathVertexIndex;
  let traveledMeters = 0;
  let selectedEdgeIndex: number | null = null;
  let cutPoint: CadWorldPoint | null = null;
  while (currentVertexIndex !== hingeVertexIndex) {
    const edgeStart = ring[currentVertexIndex]!;
    const edgeEnd = ring[(currentVertexIndex + 1) % ring.length]!;
    const edgeLength = cadDistance(edgeStart, edgeEnd);
    if (edgeLength > 1e-9 && distanceAlongPathMeters <= traveledMeters + edgeLength + 1e-9) {
      const offsetMeters = Math.max(0, Math.min(edgeLength, distanceAlongPathMeters - traveledMeters));
      const ratio = offsetMeters / edgeLength;
      selectedEdgeIndex = currentVertexIndex;
      cutPoint = {
        x: edgeStart.x + (edgeEnd.x - edgeStart.x) * ratio,
        y: edgeStart.y + (edgeEnd.y - edgeStart.y) * ratio,
      };
      break;
    }
    traveledMeters += edgeLength;
    currentVertexIndex = (currentVertexIndex + 1) % ring.length;
  }
  if (selectedEdgeIndex == null || !cutPoint) return null;

  const splitDraft = cadBuildParcelSwingSplitDraft(
    parcel,
    frontageEdge,
    alternative,
    selectedEdgeIndex,
    cutPoint,
  );
  if (!splitDraft) return null;
  const childSummary = cadBuildParcelClosureSummary(splitDraft.firstVertices);
  if (!childSummary || childSummary.areaSquareMeters <= 1e-9) return null;

  return {
    draft: {
      split: splitDraft,
      alternative,
      frontageLengthMeters: frontageEdge.lengthMeters,
      childAreaSquareMeters: childSummary.areaSquareMeters,
      childVertices: splitDraft.firstVertices.map((vertex) => ({ x: vertex.x, y: vertex.y })),
      childVertexLabels: [...splitDraft.firstVertexLabels],
      remainderVertices: splitDraft.secondVertices.map((vertex) => ({ x: vertex.x, y: vertex.y })),
      remainderVertexLabels: [...splitDraft.secondVertexLabels],
    },
    differenceSquareMeters: childSummary.areaSquareMeters - targetAreaSquareMeters,
    positionMeters: distanceAlongPathMeters,
  };
};

const solveParcelSwingDraft = (
  parcel: CadParcelEntity,
  frontageEdge: CadMatchedParcelFrontageEdge,
  targetAreaSquareMeters: number,
  alternative: CadParcelLayoutSplitAlternative,
): CadParcelLayoutSplitDraft | null => {
  const boundarySamples = cadBuildSwingBoundarySamples(parcel, frontageEdge, alternative);
  if (boundarySamples.length < 2) return null;
  const totalPathLength = boundarySamples[boundarySamples.length - 1]!.distanceAlongPathMeters;
  const epsilon = Math.max(totalPathLength * 1e-6, 1e-4);
  if (totalPathLength - 2 * epsilon <= 1e-6) return null;

  const areaToleranceSquareMeters = Math.max(targetAreaSquareMeters * 1e-6, 1e-3);
  const sampleCount = 512;
  const samples: CadParcelSlideEvaluation[] = [];
  for (let index = 0; index <= sampleCount; index += 1) {
    const fraction = index / sampleCount;
    const distanceAlongPath = epsilon + (totalPathLength - 2 * epsilon) * fraction;
    const evaluation = cadEvaluateParcelSwingAtBoundaryDistance(
      parcel,
      frontageEdge,
      targetAreaSquareMeters,
      alternative,
      distanceAlongPath,
    );
    if (evaluation) {
      samples.push(evaluation);
    }
  }
  if (samples.length === 0) return null;

  let best = samples[0]!;
  let bracket: [CadParcelSlideEvaluation, CadParcelSlideEvaluation] | null = null;
  for (let index = 0; index < samples.length; index += 1) {
    const evaluation = samples[index]!;
    if (Math.abs(evaluation.differenceSquareMeters) < Math.abs(best.differenceSquareMeters)) {
      best = evaluation;
    }
    const next = samples[index + 1];
    if (
      next &&
      (evaluation.differenceSquareMeters === 0 ||
        next.differenceSquareMeters === 0 ||
        Math.sign(evaluation.differenceSquareMeters) !== Math.sign(next.differenceSquareMeters))
    ) {
      bracket = [evaluation, next];
      break;
    }
  }

  if (!bracket) {
    return Math.abs(best.differenceSquareMeters) <= areaToleranceSquareMeters ? best.draft : null;
  }

  let [low, high] = bracket;
  for (let iteration = 0; iteration < 56; iteration += 1) {
    const lowDistance = low.positionMeters;
    const highDistance = high.positionMeters;
    const midpointDistance = (lowDistance + highDistance) / 2;
    const mid = cadEvaluateParcelSwingAtBoundaryDistance(
      parcel,
      frontageEdge,
      targetAreaSquareMeters,
      alternative,
      midpointDistance,
    );
    if (!mid) break;
    if (Math.abs(mid.differenceSquareMeters) < Math.abs(best.differenceSquareMeters)) {
      best = mid;
    }
    if (Math.abs(mid.differenceSquareMeters) <= areaToleranceSquareMeters) {
      return mid.draft;
    }
    if (Math.sign(mid.differenceSquareMeters) === Math.sign(low.differenceSquareMeters)) {
      low = mid;
    } else {
      high = mid;
    }
  }

  return Math.abs(best.differenceSquareMeters) <= areaToleranceSquareMeters ? best.draft : null;
};

export const cadBuildParcelSplitBySwingDraft = (
  parcel: CadParcelEntity,
  frontageLine: CadLineEntity,
  targetAreaSquareMeters: number,
  minFrontageMeters: number,
  alternative: CadParcelLayoutSplitAlternative = 'start',
): CadParcelLayoutSplitDraft | null => {
  if (!Number.isFinite(targetAreaSquareMeters) || targetAreaSquareMeters <= 0) return null;
  if (!Number.isFinite(minFrontageMeters) || minFrontageMeters <= 0) return null;
  const parcelSummary = cadBuildParcelClosureSummary(parcel.vertices);
  if (!parcelSummary || targetAreaSquareMeters >= parcelSummary.areaSquareMeters - 1e-6) return null;
  const frontageEdge = cadMatchFrontageLineToParcelEdge(parcel, frontageLine);
  if (!frontageEdge || frontageEdge.lengthMeters + 1e-9 < minFrontageMeters) return null;
  return solveParcelSwingDraft(parcel, frontageEdge, targetAreaSquareMeters, alternative);
};

const cadBuildParcelLayoutLocalPoints = (
  frontageStart: CadWorldPoint,
  frontageEnd: CadWorldPoint,
  vertices: readonly CadWorldPoint[],
): CadParcelLayoutLocalPoint[] | null => {
  const frontageLength = cadDistance(frontageStart, frontageEnd);
  if (frontageLength <= 1e-9 || vertices.length < 3) return null;
  const unitX = (frontageEnd.x - frontageStart.x) / frontageLength;
  const unitY = (frontageEnd.y - frontageStart.y) / frontageLength;
  const raw = vertices.map((vertex) => {
    const dx = vertex.x - frontageStart.x;
    const dy = vertex.y - frontageStart.y;
    return {
      x: dx * unitX + dy * unitY,
      y: dx * -unitY + dy * unitX,
    };
  });
  const maxY = raw.reduce((maximum, point) => Math.max(maximum, point.y), Number.NEGATIVE_INFINITY);
  const minY = raw.reduce((minimum, point) => Math.min(minimum, point.y), Number.POSITIVE_INFINITY);
  const flip = Math.abs(minY) > Math.abs(maxY);
  return flip ? raw.map((point) => ({ x: point.x, y: -point.y })) : raw;
};

const cadBuildParcelLayoutLocalToWorldPoint = (
  frontageStart: CadWorldPoint,
  frontageEnd: CadWorldPoint,
  localPoint: CadParcelLayoutLocalPoint,
  flipY: boolean,
): CadWorldPoint => {
  const frontageLength = cadDistance(frontageStart, frontageEnd);
  const unitX = (frontageEnd.x - frontageStart.x) / frontageLength;
  const unitY = (frontageEnd.y - frontageStart.y) / frontageLength;
  const localY = flipY ? -localPoint.y : localPoint.y;
  return {
    x: frontageStart.x + localPoint.x * unitX + localY * -unitY,
    y: frontageStart.y + localPoint.x * unitY + localY * unitX,
  };
};

const cadDeduplicateLocalPolygonVertices = (
  vertices: readonly CadParcelLayoutLocalPoint[],
  tolerance = 1e-9,
): CadParcelLayoutLocalPoint[] => {
  const deduplicated: CadParcelLayoutLocalPoint[] = [];
  vertices.forEach((vertex) => {
    const previous = deduplicated[deduplicated.length - 1];
    if (
      previous &&
      Math.abs(previous.x - vertex.x) <= tolerance &&
      Math.abs(previous.y - vertex.y) <= tolerance
    ) {
      return;
    }
    deduplicated.push({ x: vertex.x, y: vertex.y });
  });
  if (deduplicated.length > 1) {
    const first = deduplicated[0]!;
    const last = deduplicated[deduplicated.length - 1]!;
    if (Math.abs(first.x - last.x) <= tolerance && Math.abs(first.y - last.y) <= tolerance) {
      deduplicated.pop();
    }
  }
  return deduplicated;
};

const cadClipLocalPolygonAgainstVerticalBoundary = (
  vertices: readonly CadParcelLayoutLocalPoint[],
  boundaryX: number,
  keepGreaterThanOrEqual: boolean,
): CadParcelLayoutLocalPoint[] => {
  if (vertices.length < 3) return [];
  const clipped: CadParcelLayoutLocalPoint[] = [];
  const isInside = (point: CadParcelLayoutLocalPoint) =>
    keepGreaterThanOrEqual ? point.x >= boundaryX - 1e-9 : point.x <= boundaryX + 1e-9;
  for (let index = 0; index < vertices.length; index += 1) {
    const current = vertices[index]!;
    const previous = vertices[(index + vertices.length - 1) % vertices.length]!;
    const currentInside = isInside(current);
    const previousInside = isInside(previous);
    if (currentInside !== previousInside) {
      const deltaX = current.x - previous.x;
      if (Math.abs(deltaX) > 1e-12) {
        const ratio = (boundaryX - previous.x) / deltaX;
        clipped.push({
          x: boundaryX,
          y: previous.y + (current.y - previous.y) * ratio,
        });
      }
    }
    if (currentInside) {
      clipped.push({ x: current.x, y: current.y });
    }
  }
  return cadDeduplicateLocalPolygonVertices(clipped);
};

const cadClipLocalPolygonToVerticalStrip = (
  vertices: readonly CadParcelLayoutLocalPoint[],
  startX: number,
  endX: number,
): CadParcelLayoutLocalPoint[] => {
  const leftClipped = cadClipLocalPolygonAgainstVerticalBoundary(vertices, startX, true);
  if (leftClipped.length < 3) return [];
  return cadClipLocalPolygonAgainstVerticalBoundary(leftClipped, endX, false);
};

const cadClipLocalPolygonAgainstHorizontalBoundary = (
  vertices: readonly CadParcelLayoutLocalPoint[],
  boundaryY: number,
  keepLessThanOrEqual: boolean,
): CadParcelLayoutLocalPoint[] => {
  if (vertices.length < 3) return [];
  const clipped: CadParcelLayoutLocalPoint[] = [];
  const isInside = (point: CadParcelLayoutLocalPoint) =>
    keepLessThanOrEqual ? point.y <= boundaryY + 1e-9 : point.y >= boundaryY - 1e-9;
  for (let index = 0; index < vertices.length; index += 1) {
    const current = vertices[index]!;
    const previous = vertices[(index + vertices.length - 1) % vertices.length]!;
    const currentInside = isInside(current);
    const previousInside = isInside(previous);
    if (currentInside !== previousInside) {
      const deltaY = current.y - previous.y;
      if (Math.abs(deltaY) > 1e-12) {
        const ratio = (boundaryY - previous.y) / deltaY;
        clipped.push({
          x: previous.x + (current.x - previous.x) * ratio,
          y: boundaryY,
        });
      }
    }
    if (currentInside) {
      clipped.push({ x: current.x, y: current.y });
    }
  }
  return cadDeduplicateLocalPolygonVertices(clipped);
};

const cadBuildAutoParcelVertexLabels = (
  sourceParcel: CadParcelEntity,
  vertices: readonly CadWorldPoint[],
  lotIndex: number,
): string[] => {
  let generatedIndex = 1;
  return vertices.map((vertex) => {
    const matchedIndex = sourceParcel.vertices.findIndex((candidate) => parcelPointsMatch(candidate, vertex));
    if (matchedIndex >= 0) {
      return sourceParcel.vertexLabels[matchedIndex] ?? `CAD${matchedIndex + 1}`;
    }
    const label = `LOT${lotIndex + 1}P${generatedIndex}`;
    generatedIndex += 1;
    return label;
  });
};

const cadBuildAutoLayoutPreviewCandidateFromGeneratedParcel = (
  frontageLine: CadLineEntity,
  frontageLengthMeters: number,
  pathDepthMeters: number | null,
  settings: CadParcelLayoutSettings,
  generatedParcel: CadParcelLayoutGeneratedParcelDraft,
): CadParcelLayoutPreviewCandidate => {
  const draft: CadParcelLayoutSplitDraft = {
    split: {
      firstVertices: generatedParcel.vertices.map((vertex) => ({ x: vertex.x, y: vertex.y })),
      firstVertexLabels: [...generatedParcel.vertexLabels],
      secondVertices: [],
      secondVertexLabels: [],
      splitStart: generatedParcel.vertices[0] ?? { x: frontageLine.fromX, y: frontageLine.fromY },
      splitEnd: generatedParcel.vertices[1] ?? { x: frontageLine.toX, y: frontageLine.toY },
    },
    alternative: 'start',
    frontageLengthMeters,
    childAreaSquareMeters: cadBuildParcelClosureSummary(generatedParcel.vertices)?.areaSquareMeters ?? 0,
    childVertices: generatedParcel.vertices.map((vertex) => ({ x: vertex.x, y: vertex.y })),
    childVertexLabels: [...generatedParcel.vertexLabels],
    remainderVertices: [],
    remainderVertexLabels: [],
  };
  const evaluation = cadEvaluateGeneratedParcelLayoutConstraints({
    frontageLine,
    frontageLengthMeters,
    pathDepthMeters,
    settings,
    generatedParcel,
  });
  const isValid = evaluation.failedRuleCodes.length === 0;
  return {
    tool: 'slide',
    alternative: 'start',
    draft,
    evaluation,
    isValid,
    statusMessage: isValid
      ? `Automatic strip valid: ${draft.childAreaSquareMeters.toFixed(3)} m2 area and ${draft.frontageLengthMeters.toFixed(3)} m frontage.`
      : `Automatic strip invalid: ${evaluation.failedRuleCodes.join(', ')}.`,
  };
};

const cadBuildCornerRemainderPreviewCandidate = (
  frontageLine: CadLineEntity,
  settings: CadParcelLayoutSettings,
  generatedParcel: CadParcelLayoutGeneratedParcelDraft,
  combinedFrontageMeters: number,
  tool: 'slide' | 'swing',
): CadParcelLayoutPreviewCandidate | null => {
  const childAreaSquareMeters =
    cadBuildParcelClosureSummary(generatedParcel.vertices)?.areaSquareMeters ?? 0;
  if (childAreaSquareMeters <= 1e-9) return null;
  const depthMeters = settings.useMaxDepth ? settings.maxDepthMeters : settings.minDepthMeters;
  const draft: CadParcelLayoutSplitDraft = {
    split: {
      firstVertices: generatedParcel.vertices.map((vertex) => ({ x: vertex.x, y: vertex.y })),
      firstVertexLabels: [...generatedParcel.vertexLabels],
      secondVertices: [],
      secondVertexLabels: [],
      splitStart: generatedParcel.vertices[0] ?? { x: frontageLine.fromX, y: frontageLine.fromY },
      splitEnd: generatedParcel.vertices[1] ?? { x: frontageLine.toX, y: frontageLine.toY },
    },
    alternative: 'start',
    frontageLengthMeters: combinedFrontageMeters,
    childAreaSquareMeters,
    childVertices: generatedParcel.vertices.map((vertex) => ({ x: vertex.x, y: vertex.y })),
    childVertexLabels: [...generatedParcel.vertexLabels],
    remainderVertices: [],
    remainderVertexLabels: [],
  };
  const failedRuleCodes: CadParcelLayoutConstraintEvaluation['failedRuleCodes'] = [];
  if (childAreaSquareMeters + 1e-9 < settings.minAreaSquareMeters) failedRuleCodes.push('min_area');
  if (combinedFrontageMeters + 1e-9 < settings.minFrontageMeters) failedRuleCodes.push('min_frontage');
  if (depthMeters + 1e-9 < settings.minDepthMeters) failedRuleCodes.push('min_depth');
  if (settings.useMaxDepth && depthMeters > settings.maxDepthMeters + 1e-9) failedRuleCodes.push('max_depth');
  const evaluationWithoutMessages: Omit<CadParcelLayoutConstraintEvaluation, 'messages'> = {
    frontageLengthMeters: combinedFrontageMeters,
    frontageAtOffsetWidthMeters: null,
    minimumSampledWidthMeters: settings.minWidthMeters,
    depthMeters,
    score:
      failedRuleCodes.length * 1_000_000 +
      Math.abs(childAreaSquareMeters - settings.minAreaSquareMeters) +
      Math.abs(combinedFrontageMeters - settings.minFrontageMeters),
    failedRuleCodes,
  };
  const evaluation: CadParcelLayoutConstraintEvaluation = {
    ...evaluationWithoutMessages,
    messages: cadBuildParcelLayoutConstraintMessages(settings, draft, evaluationWithoutMessages),
  };
  return {
    tool,
    alternative: 'start',
    draft,
    evaluation,
    isValid: failedRuleCodes.length === 0,
    statusMessage:
      failedRuleCodes.length === 0
        ? `Automatic corner lot valid: ${childAreaSquareMeters.toFixed(3)} m2 area and ${combinedFrontageMeters.toFixed(3)} m combined frontage.`
        : `Automatic corner lot invalid: ${failedRuleCodes.join(', ')}.`,
  };
};

export const cadBuildParcelFrontagePathAutoLayoutDraft = (
  parcel: CadParcelEntity,
  frontageReference: CadParcelLayoutFrontageReference,
  settings: CadParcelLayoutSettings,
  preferredTool: 'slide' | 'swing',
): CadParcelAutoLayoutDraft | null => {
  const path = cadBuildParcelLayoutFrontagePath(parcel, frontageReference);
  if (!path || path.totalLengthMeters + 1e-9 < settings.minFrontageMeters) {
    return null;
  }
  const buildLotCandidate = (
    startDistanceMeters: number,
    endDistanceMeters: number,
    lotIndex: number,
    role: 'lot' | 'remainder',
  ) => {
    const frontageSubPath = cadBuildParcelLayoutFrontageSubPath(path, startDistanceMeters, endDistanceMeters);
    if (!frontageSubPath) return null;
    const generatedParcel =
      settings.useMaxDepth && path.segments.length === 1 && path.segments[0]?.kind === 'line'
        ? cadBuildDepthLimitedStripGeneratedParcel(
            parcel,
            frontageReference.frontageLine,
            startDistanceMeters,
            endDistanceMeters,
            settings.maxDepthMeters,
            lotIndex,
            role,
          )
        : cadBuildParcelLayoutGeneratedParcelFromFrontageInterval(
            parcel,
            path,
            startDistanceMeters,
            endDistanceMeters,
            lotIndex,
            role,
          );
    if (!generatedParcel) return null;
    const frontageLine: CadLineEntity = {
      ...frontageReference.frontageLine,
      id: `${frontageReference.frontageLine.id}:path:${lotIndex + 1}`,
      fromX: generatedParcel.frontageStart.x,
      fromY: generatedParcel.frontageStart.y,
      toX: generatedParcel.frontageEnd.x,
      toY: generatedParcel.frontageEnd.y,
    };
    const pathDepthMeters = cadBuildParcelLayoutPathDepthMeters(generatedParcel.vertices, frontageSubPath);
    const previewCandidate = cadBuildAutoLayoutPreviewCandidateFromGeneratedParcel(
      frontageLine,
      generatedParcel.frontageLengthMeters,
      pathDepthMeters,
      settings,
      generatedParcel,
    );
    return {
      generatedParcel,
      frontageLine,
      frontageSubPath,
      pathDepthMeters,
      previewCandidate,
    };
  };
  type CadFrontagePathLotCandidate = NonNullable<ReturnType<typeof buildLotCandidate>>;

  const solveGreedyEndDistance = (
    startDistanceMeters: number,
    lotIndex: number,
  ): CadFrontagePathLotCandidate | null => {
    const minimumEndDistance = startDistanceMeters + settings.minFrontageMeters;
    if (minimumEndDistance > path.totalLengthMeters + 1e-9) return null;
    let bestValid: CadFrontagePathLotCandidate | null = null;
    let previousInvalidDistance = startDistanceMeters;
    const coarseSteps = 72;
    for (let index = 0; index < coarseSteps; index += 1) {
      const ratio = index / (coarseSteps - 1);
      const candidateEndDistance =
        minimumEndDistance + (path.totalLengthMeters - minimumEndDistance) * ratio;
      const candidate = buildLotCandidate(startDistanceMeters, candidateEndDistance, lotIndex, 'lot');
      if (candidate?.previewCandidate.isValid) {
        bestValid = candidate;
        break;
      }
      previousInvalidDistance = candidateEndDistance;
    }
    if (!bestValid) {
      return null;
    }
    let low = Math.max(minimumEndDistance, previousInvalidDistance);
    let high = bestValid.generatedParcel.frontageLengthMeters + startDistanceMeters;
    for (let iteration = 0; iteration < 24; iteration += 1) {
      const midpoint = (low + high) / 2;
      const candidate = buildLotCandidate(startDistanceMeters, midpoint, lotIndex, 'lot');
      if (candidate?.previewCandidate.isValid) {
        bestValid = candidate;
        high = midpoint;
      } else {
        low = midpoint;
      }
    }
    return bestValid;
  };

  const buildGreedyLots = (): {
    lots: CadFrontagePathLotCandidate[];
    remainderStartDistanceMeters: number;
  } => {
    const lots: CadFrontagePathLotCandidate[] = [];
    let cursor = 0;
    while (cursor + settings.minFrontageMeters <= path.totalLengthMeters + 1e-9) {
      const lotCandidate = solveGreedyEndDistance(cursor, lots.length);
      if (!lotCandidate) {
        break;
      }
      lots.push(lotCandidate);
      cursor += lotCandidate.generatedParcel.frontageLengthMeters;
      if (path.totalLengthMeters - cursor <= 1e-6) {
        cursor = path.totalLengthMeters;
        break;
      }
    }
    return {
      lots,
      remainderStartDistanceMeters: cursor,
    };
  };

  const greedy = buildGreedyLots();
  if (greedy.lots.length === 0) {
    return {
      tool: preferredTool,
      generatedParcels: [],
      acceptedCandidates: [],
      isValid: false,
      statusMessage: 'Automatic fill could not create a valid first lot from the active parent and frontage.',
    };
  }

  const buildResultFromIntervals = (
    intervals: Array<{ startDistanceMeters: number; endDistanceMeters: number; role: 'lot' | 'remainder' }>,
  ): CadParcelAutoLayoutDraft | null => {
    const generatedParcels: CadParcelLayoutGeneratedParcelDraft[] = [];
    const acceptedCandidates: CadParcelLayoutPreviewCandidate[] = [];
    for (let index = 0; index < intervals.length; index += 1) {
      const interval = intervals[index]!;
      const candidate = buildLotCandidate(
        interval.startDistanceMeters,
        interval.endDistanceMeters,
        index,
        interval.role,
      );
      if (!candidate) return null;
      generatedParcels.push(candidate.generatedParcel);
      if (interval.role === 'lot') {
        if (!candidate.previewCandidate.isValid) {
          return {
            tool: preferredTool,
            generatedParcels: [],
            acceptedCandidates: [candidate.previewCandidate],
            isValid: false,
            statusMessage: candidate.previewCandidate.statusMessage,
          };
        }
        acceptedCandidates.push({
          ...candidate.previewCandidate,
          tool: preferredTool,
        });
      }
    }
    if (settings.useMaxDepth && path.segments.length === 1 && path.segments[0]?.kind === 'line') {
      const rearRemainder = cadBuildDepthLimitedStripRearRemainder(
        parcel,
        frontageReference.frontageLine,
        settings.maxDepthMeters,
      );
      if (rearRemainder) {
        generatedParcels.push(rearRemainder);
      }
    }
    return {
      tool: preferredTool,
      generatedParcels,
      acceptedCandidates,
      isValid: acceptedCandidates.length > 0,
      statusMessage: `Automatic fill prepared ${generatedParcels.length} frontage-path parcels from the active parent/frontage setup.`,
    };
  };

  const remainderFrontageMeters = Math.max(0, path.totalLengthMeters - greedy.remainderStartDistanceMeters);
  const greedyBoundaries = greedy.lots.reduce<number[]>(
    (boundaries, lot) => {
      boundaries.push(boundaries[boundaries.length - 1]! + lot.generatedParcel.frontageLengthMeters);
      return boundaries;
    },
    [0],
  );
  if (settings.remainderDistribution === 'redistribute_remainder') {
    const lotCount = greedy.lots.length;
    const equalFrontage = path.totalLengthMeters / lotCount;
    const redistributedIntervals = Array.from({ length: lotCount }, (_, index) => ({
      startDistanceMeters: index * equalFrontage,
      endDistanceMeters: index === lotCount - 1 ? path.totalLengthMeters : (index + 1) * equalFrontage,
      role: 'lot' as const,
    }));
    const redistributed = buildResultFromIntervals(redistributedIntervals);
    if (redistributed) {
      return {
        ...redistributed,
        statusMessage: `Automatic fill redistributed remainder across ${lotCount} lots.`,
      };
    }
    return {
      tool: preferredTool,
      generatedParcels: [],
      acceptedCandidates: [],
      isValid: false,
      statusMessage:
        'Automatic fill could not redistribute remainder across same lot count without breaking parcel constraints.',
    };
  }

  if (settings.remainderDistribution === 'place_remainder_in_last_parcel') {
    const intervals = greedy.lots.map((lot, index) => ({
      startDistanceMeters: greedyBoundaries[index]!,
      endDistanceMeters:
        index === greedy.lots.length - 1 && remainderFrontageMeters > 1e-6
          ? path.totalLengthMeters
          : greedyBoundaries[index + 1]!,
      role: 'lot' as const,
    }));
    const result = buildResultFromIntervals(intervals);
    return result
      ? {
          ...result,
          statusMessage: `Automatic fill prepared ${result.generatedParcels.length} parcels with remainder kept in the last parcel.`,
        }
      : null;
  }

  const intervals: Array<{
    startDistanceMeters: number;
    endDistanceMeters: number;
    role: 'lot' | 'remainder';
  }> = greedy.lots.map((lot, index) => ({
    startDistanceMeters: greedyBoundaries[index]!,
    endDistanceMeters: greedyBoundaries[index + 1]!,
    role: 'lot' as const,
  }));
  if (remainderFrontageMeters > 1e-6) {
    intervals.push({
      startDistanceMeters: greedy.remainderStartDistanceMeters,
      endDistanceMeters: path.totalLengthMeters,
      role: 'remainder' as const,
    });
  }
  return buildResultFromIntervals(intervals);
};

export const cadBuildParcelFrontageStripAutoLayoutDraft = (
  parcel: CadParcelEntity,
  frontageLine: CadLineEntity,
  settings: CadParcelLayoutSettings,
  preferredTool: 'slide' | 'swing',
): CadParcelAutoLayoutDraft | null =>
  cadBuildParcelFrontagePathAutoLayoutDraft(
    parcel,
    {
      sourceEntityId: frontageLine.id,
      displayLabel: `${frontageLine.fromStationId}-${frontageLine.toStationId}`,
      sourcePointIds: [frontageLine.fromStationId, frontageLine.toStationId],
      frontageLine,
      sourceGeometry: { kind: 'line' },
    },
    settings,
    preferredTool,
  );

const cadWidthAtParcelLayoutOffset = (
  localVertices: readonly CadParcelLayoutLocalPoint[],
  offsetMeters: number,
  frontageLengthMeters: number,
): number | null => {
  if (localVertices.length < 3) return null;
  if (offsetMeters <= 1e-9) return frontageLengthMeters;
  const xIntersections: number[] = [];
  for (let index = 0; index < localVertices.length; index += 1) {
    const start = localVertices[index]!;
    const end = localVertices[(index + 1) % localVertices.length]!;
    if (Math.abs(start.y - end.y) <= 1e-9) continue;
    const crosses =
      (start.y <= offsetMeters && offsetMeters < end.y) ||
      (end.y <= offsetMeters && offsetMeters < start.y);
    if (!crosses) continue;
    const ratio = (offsetMeters - start.y) / (end.y - start.y);
    xIntersections.push(start.x + (end.x - start.x) * ratio);
  }
  if (xIntersections.length < 2) return null;
  xIntersections.sort((left, right) => left - right);
  return xIntersections[xIntersections.length - 1]! - xIntersections[0]!;
};

const cadBuildParcelLayoutConstraintMessages = (
  settings: CadParcelLayoutSettings,
  draft: CadParcelLayoutSplitDraft,
  evaluation: Omit<CadParcelLayoutConstraintEvaluation, 'messages'>,
): string[] => {
  const messages: string[] = [];
  const areaPass = draft.childAreaSquareMeters + 1e-9 >= settings.minAreaSquareMeters;
  messages.push(
    `Area ${areaPass ? 'pass' : 'fail'}: ${draft.childAreaSquareMeters.toFixed(3)} m2 vs ${settings.minAreaSquareMeters.toFixed(3)} m2 min.`,
  );
  const frontagePass = draft.frontageLengthMeters + 1e-9 >= settings.minFrontageMeters;
  messages.push(
    `Frontage ${frontagePass ? 'pass' : 'fail'}: ${draft.frontageLengthMeters.toFixed(3)} m vs ${settings.minFrontageMeters.toFixed(3)} m min.`,
  );
  if (settings.useFrontageAtOffset) {
    const widthAtOffset = evaluation.frontageAtOffsetWidthMeters;
    const offsetPass = widthAtOffset != null && widthAtOffset + 1e-9 >= settings.minFrontageMeters;
    messages.push(
      `Offset width ${offsetPass ? 'pass' : 'fail'}: ${widthAtOffset == null ? 'n/a' : `${widthAtOffset.toFixed(3)} m`} at ${settings.frontageOffsetMeters.toFixed(3)} m offset.`,
    );
  }
  const widthPass =
    evaluation.minimumSampledWidthMeters != null &&
    evaluation.minimumSampledWidthMeters + 1e-9 >= settings.minWidthMeters;
  messages.push(
    `Width ${widthPass ? 'pass' : 'fail'}: ${evaluation.minimumSampledWidthMeters == null ? 'n/a' : `${evaluation.minimumSampledWidthMeters.toFixed(3)} m`} vs ${settings.minWidthMeters.toFixed(3)} m min.`,
  );
  const depthPass =
    evaluation.depthMeters != null && evaluation.depthMeters + 1e-9 >= settings.minDepthMeters;
  messages.push(
    `Depth ${depthPass ? 'pass' : 'fail'}: ${evaluation.depthMeters == null ? 'n/a' : `${evaluation.depthMeters.toFixed(3)} m`} vs ${settings.minDepthMeters.toFixed(3)} m min.`,
  );
  if (settings.useMaxDepth) {
    const maxDepthPass =
      evaluation.depthMeters != null && evaluation.depthMeters <= settings.maxDepthMeters + 1e-9;
    messages.push(
      `Max depth ${maxDepthPass ? 'pass' : 'fail'}: ${evaluation.depthMeters == null ? 'n/a' : `${evaluation.depthMeters.toFixed(3)} m`} vs ${settings.maxDepthMeters.toFixed(3)} m max.`,
    );
  }
  return messages;
};

export const cadEvaluateParcelLayoutConstraints = (
  draft: CadParcelLayoutSplitDraft,
  frontageLine: CadLineEntity,
  settings: CadParcelLayoutSettings,
): CadParcelLayoutConstraintEvaluation => {
  const localVertices = cadBuildParcelLayoutLocalPoints(
    { x: frontageLine.fromX, y: frontageLine.fromY },
    { x: frontageLine.toX, y: frontageLine.toY },
    draft.childVertices,
  );
  const depthMeters =
    localVertices == null
      ? null
      : Math.max(
          0,
          ...localVertices.map((point) => point.y).filter((value) => Number.isFinite(value)),
        );
  const frontageAtOffsetWidthMeters =
    settings.useFrontageAtOffset && localVertices
      ? cadWidthAtParcelLayoutOffset(localVertices, settings.frontageOffsetMeters, draft.frontageLengthMeters)
      : null;

  const sampledOffsets: number[] = [];
  if (localVertices && depthMeters != null && depthMeters > 1e-6) {
    const epsilon = Math.max(depthMeters * 1e-3, 1e-4);
    for (let index = 1; index <= PARCEL_LAYOUT_EVALUATION_SAMPLE_COUNT; index += 1) {
      const ratio = index / (PARCEL_LAYOUT_EVALUATION_SAMPLE_COUNT + 1);
      sampledOffsets.push(epsilon + (depthMeters - 2 * epsilon) * ratio);
    }
  }
  const sampledWidths = sampledOffsets
    .map((offsetMeters) =>
      localVertices
        ? cadWidthAtParcelLayoutOffset(localVertices, offsetMeters, draft.frontageLengthMeters)
        : null,
    )
    .filter((value): value is number => value != null && Number.isFinite(value) && value > 1e-9);
  const minimumSampledWidthMeters =
    sampledWidths.length > 0 ? Math.min(...sampledWidths) : null;

  const failedRuleCodes: CadParcelLayoutConstraintEvaluation['failedRuleCodes'] = [];
  if (draft.childAreaSquareMeters + 1e-9 < settings.minAreaSquareMeters) {
    failedRuleCodes.push('min_area');
  }
  if (draft.frontageLengthMeters + 1e-9 < settings.minFrontageMeters) {
    failedRuleCodes.push('min_frontage');
  }
  if (
    settings.useFrontageAtOffset &&
    (frontageAtOffsetWidthMeters == null ||
      frontageAtOffsetWidthMeters + 1e-9 < settings.minFrontageMeters)
  ) {
    failedRuleCodes.push('frontage_at_offset');
  }
  if (
    minimumSampledWidthMeters == null ||
    minimumSampledWidthMeters + 1e-9 < settings.minWidthMeters
  ) {
    failedRuleCodes.push('min_width');
  }
  if (depthMeters == null || depthMeters + 1e-9 < settings.minDepthMeters) {
    failedRuleCodes.push('min_depth');
  }
  if (settings.useMaxDepth && (depthMeters == null || depthMeters > settings.maxDepthMeters + 1e-9)) {
    failedRuleCodes.push('max_depth');
  }

  const areaDelta = Math.abs(draft.childAreaSquareMeters - settings.minAreaSquareMeters);
  const frontageDelta = Math.abs(draft.frontageLengthMeters - settings.minFrontageMeters);
  const widthDelta =
    minimumSampledWidthMeters == null
      ? Number.POSITIVE_INFINITY
      : Math.abs(minimumSampledWidthMeters - settings.minWidthMeters);
  const depthDelta =
    depthMeters == null ? Number.POSITIVE_INFINITY : Math.abs(depthMeters - settings.minDepthMeters);
  let score = failedRuleCodes.length * 1_000_000;
  switch (settings.solutionPreference) {
    case 'smallest_area':
      score += draft.childAreaSquareMeters;
      break;
    case 'largest_area':
      score -= draft.childAreaSquareMeters;
      break;
    case 'most_rectangular': {
      const ratio =
        minimumSampledWidthMeters != null &&
        depthMeters != null &&
        minimumSampledWidthMeters > 1e-9 &&
        depthMeters > 1e-9
          ? Math.max(minimumSampledWidthMeters, depthMeters) /
            Math.min(minimumSampledWidthMeters, depthMeters)
          : Number.POSITIVE_INFINITY;
      score += ratio;
      break;
    }
    case 'closest_to_target_area':
      score += areaDelta;
      break;
    case 'shortest_frontage':
    default:
      score += draft.frontageLengthMeters;
      break;
  }
  score += areaDelta * 1e-3 + frontageDelta * 1e-2 + widthDelta * 1e-2 + depthDelta * 1e-2;

  const evaluationWithoutMessages = {
    frontageLengthMeters: draft.frontageLengthMeters,
    frontageAtOffsetWidthMeters,
    minimumSampledWidthMeters,
    depthMeters,
    score,
    failedRuleCodes,
  };
  return {
    ...evaluationWithoutMessages,
    messages: cadBuildParcelLayoutConstraintMessages(settings, draft, evaluationWithoutMessages),
  };
};

const cadEvaluateGeneratedParcelLayoutConstraints = ({
  frontageLine,
  frontageLengthMeters,
  pathDepthMeters,
  settings,
  generatedParcel,
}: {
  frontageLine: CadLineEntity;
  frontageLengthMeters: number;
  pathDepthMeters: number | null;
  settings: CadParcelLayoutSettings;
  generatedParcel: CadParcelLayoutGeneratedParcelDraft;
}): CadParcelLayoutConstraintEvaluation => {
  const childAreaSquareMeters =
    cadBuildParcelClosureSummary(generatedParcel.vertices)?.areaSquareMeters ?? 0;
  const draft: CadParcelLayoutSplitDraft = {
    split: {
      firstVertices: generatedParcel.vertices.map((vertex) => ({ x: vertex.x, y: vertex.y })),
      firstVertexLabels: [...generatedParcel.vertexLabels],
      secondVertices: [],
      secondVertexLabels: [],
      splitStart: generatedParcel.vertices[0] ?? { x: frontageLine.fromX, y: frontageLine.fromY },
      splitEnd: generatedParcel.vertices[1] ?? { x: frontageLine.toX, y: frontageLine.toY },
    },
    alternative: 'start',
    frontageLengthMeters,
    childAreaSquareMeters,
    childVertices: generatedParcel.vertices.map((vertex) => ({ x: vertex.x, y: vertex.y })),
    childVertexLabels: [...generatedParcel.vertexLabels],
    remainderVertices: [],
    remainderVertexLabels: [],
  };
  const localVertices = cadBuildParcelLayoutLocalPoints(
    { x: frontageLine.fromX, y: frontageLine.fromY },
    { x: frontageLine.toX, y: frontageLine.toY },
    draft.childVertices,
  );
  const frontageAtOffsetWidthMeters =
    settings.useFrontageAtOffset && localVertices
      ? cadWidthAtParcelLayoutOffset(localVertices, settings.frontageOffsetMeters, frontageLengthMeters)
      : null;
  const sampledOffsets: number[] = [];
  if (localVertices && pathDepthMeters != null && pathDepthMeters > 1e-6) {
    const epsilon = Math.max(pathDepthMeters * 1e-3, 1e-4);
    for (let index = 1; index <= PARCEL_LAYOUT_EVALUATION_SAMPLE_COUNT; index += 1) {
      const ratio = index / (PARCEL_LAYOUT_EVALUATION_SAMPLE_COUNT + 1);
      sampledOffsets.push(epsilon + (pathDepthMeters - 2 * epsilon) * ratio);
    }
  }
  const sampledWidths = sampledOffsets
    .map((offsetMeters) =>
      localVertices
        ? cadWidthAtParcelLayoutOffset(localVertices, offsetMeters, frontageLengthMeters)
        : null,
    )
    .filter((value): value is number => value != null && Number.isFinite(value) && value > 1e-9);
  const minimumSampledWidthMeters =
    sampledWidths.length > 0 ? Math.min(...sampledWidths) : null;

  const failedRuleCodes: CadParcelLayoutConstraintEvaluation['failedRuleCodes'] = [];
  if (childAreaSquareMeters + 1e-9 < settings.minAreaSquareMeters) {
    failedRuleCodes.push('min_area');
  }
  if (frontageLengthMeters + 1e-9 < settings.minFrontageMeters) {
    failedRuleCodes.push('min_frontage');
  }
  if (
    settings.useFrontageAtOffset &&
    (frontageAtOffsetWidthMeters == null || frontageAtOffsetWidthMeters + 1e-9 < settings.minFrontageMeters)
  ) {
    failedRuleCodes.push('frontage_at_offset');
  }
  if (minimumSampledWidthMeters == null || minimumSampledWidthMeters + 1e-9 < settings.minWidthMeters) {
    failedRuleCodes.push('min_width');
  }
  if (pathDepthMeters == null || pathDepthMeters + 1e-9 < settings.minDepthMeters) {
    failedRuleCodes.push('min_depth');
  }
  if (settings.useMaxDepth && (pathDepthMeters == null || pathDepthMeters > settings.maxDepthMeters + 1e-9)) {
    failedRuleCodes.push('max_depth');
  }

  const areaDelta = Math.abs(childAreaSquareMeters - settings.minAreaSquareMeters);
  const frontageDelta = Math.abs(frontageLengthMeters - settings.minFrontageMeters);
  const widthDelta =
    minimumSampledWidthMeters == null
      ? Number.POSITIVE_INFINITY
      : Math.abs(minimumSampledWidthMeters - settings.minWidthMeters);
  const depthDelta =
    pathDepthMeters == null ? Number.POSITIVE_INFINITY : Math.abs(pathDepthMeters - settings.minDepthMeters);
  let score = failedRuleCodes.length * 1_000_000;
  switch (settings.solutionPreference) {
    case 'smallest_area':
      score += childAreaSquareMeters;
      break;
    case 'largest_area':
      score -= childAreaSquareMeters;
      break;
    case 'most_rectangular': {
      const ratio =
        minimumSampledWidthMeters != null &&
        pathDepthMeters != null &&
        minimumSampledWidthMeters > 1e-9 &&
        pathDepthMeters > 1e-9
          ? Math.max(minimumSampledWidthMeters, pathDepthMeters) /
            Math.min(minimumSampledWidthMeters, pathDepthMeters)
          : Number.POSITIVE_INFINITY;
      score += ratio;
      break;
    }
    case 'closest_to_target_area':
      score += areaDelta;
      break;
    case 'shortest_frontage':
    default:
      score += frontageLengthMeters;
      break;
  }
  score += areaDelta * 1e-3 + frontageDelta * 1e-2 + widthDelta * 1e-2 + depthDelta * 1e-2;
  const evaluationWithoutMessages = {
    frontageLengthMeters,
    frontageAtOffsetWidthMeters,
    minimumSampledWidthMeters,
    depthMeters: pathDepthMeters,
    score,
    failedRuleCodes,
  };
  return {
    ...evaluationWithoutMessages,
    messages: cadBuildParcelLayoutConstraintMessages(settings, draft, evaluationWithoutMessages),
  };
};

export const cadBuildParcelLayoutPreviewCandidate = (
  parcel: CadParcelEntity,
  frontageLine: CadLineEntity,
  settings: CadParcelLayoutSettings,
  tool: 'slide' | 'swing',
  alternative: CadParcelLayoutSplitAlternative,
): CadParcelLayoutPreviewCandidate => {
  const targetAreaSquareMeters = settings.minAreaSquareMeters;
  return cadBuildParcelLayoutPreviewCandidateForTargetArea(
    parcel,
    frontageLine,
    settings,
    tool,
    alternative,
    targetAreaSquareMeters,
  );
};

const cadBuildParcelLayoutPreviewCandidateForTargetArea = (
  parcel: CadParcelEntity,
  frontageLine: CadLineEntity,
  settings: CadParcelLayoutSettings,
  tool: 'slide' | 'swing',
  alternative: CadParcelLayoutSplitAlternative,
  targetAreaSquareMeters: number,
): CadParcelLayoutPreviewCandidate => {
  const draft =
    tool === 'slide'
      ? cadBuildParcelSplitBySlideDraft(
          parcel,
          frontageLine,
          targetAreaSquareMeters,
          settings.minFrontageMeters,
          alternative,
        )
      : cadBuildParcelSplitBySwingDraft(
          parcel,
          frontageLine,
          targetAreaSquareMeters,
          settings.minFrontageMeters,
          alternative,
        );
  if (!draft) {
    return {
      tool,
      alternative,
      draft: null,
      evaluation: null,
      isValid: false,
      statusMessage: `${tool === 'slide' ? 'Slide' : 'Swing'} ${alternative} preview could not be solved for the current parent, frontage, and target area.`,
    };
  }
  const evaluation = cadEvaluateParcelLayoutConstraints(draft, frontageLine, settings);
  const isValid = evaluation.failedRuleCodes.length === 0;
  return {
    tool,
    alternative,
    draft,
    evaluation,
    isValid,
    statusMessage: isValid
      ? `${tool === 'slide' ? 'Slide' : 'Swing'} ${alternative} preview valid: ${draft.childAreaSquareMeters.toFixed(3)} m2 area and ${draft.frontageLengthMeters.toFixed(3)} m frontage.`
      : `${tool === 'slide' ? 'Slide' : 'Swing'} ${alternative} preview invalid: ${evaluation.failedRuleCodes.join(', ')}.`,
  };
};

const cadBuildAutomaticTargetAreaSquareMeters = (
  parcel: CadParcelEntity,
  frontageLine: CadLineEntity,
  settings: CadParcelLayoutSettings,
): number => {
  const frontageLengthMeters = cadDistance(
    { x: frontageLine.fromX, y: frontageLine.fromY },
    { x: frontageLine.toX, y: frontageLine.toY },
  );
  if (!settings.useMaxDepth) {
    const parcelAreaSquareMeters = cadBuildParcelClosureSummary(parcel.vertices)?.areaSquareMeters ?? 0;
    const averageDepthMeters =
      frontageLengthMeters > 1e-9 && parcelAreaSquareMeters > 1e-9
        ? parcelAreaSquareMeters / frontageLengthMeters
        : settings.minDepthMeters;
    return Math.max(
      settings.minAreaSquareMeters,
      settings.minFrontageMeters * averageDepthMeters,
      settings.minWidthMeters * averageDepthMeters,
      settings.minFrontageMeters * settings.minDepthMeters,
      settings.minWidthMeters * settings.minDepthMeters,
    );
  }
  const areaDepthFromUsableFrontageMeters =
    frontageLengthMeters > 1e-9
      ? settings.minAreaSquareMeters / Math.max(frontageLengthMeters, settings.minFrontageMeters, 1e-9)
      : settings.minDepthMeters;
  const controllingFrontageMeters = Math.max(
    settings.minFrontageMeters,
    settings.minWidthMeters,
    1e-9,
  );
  const areaDepthFromMinimumLotShapeMeters =
    settings.minAreaSquareMeters / controllingFrontageMeters;
  const targetDepthMeters = settings.useMaxDepth
    ? Math.min(
        settings.maxDepthMeters,
        Math.max(
          settings.minDepthMeters,
          areaDepthFromUsableFrontageMeters,
          areaDepthFromMinimumLotShapeMeters,
        ),
      )
    : Math.max(
        settings.minDepthMeters,
        areaDepthFromUsableFrontageMeters,
        areaDepthFromMinimumLotShapeMeters,
      );
  return Math.max(
    settings.minAreaSquareMeters,
    settings.minFrontageMeters * targetDepthMeters,
    settings.minWidthMeters * targetDepthMeters,
    settings.minFrontageMeters * settings.minDepthMeters,
    settings.minWidthMeters * settings.minDepthMeters,
  );
};

export const cadSelectPreferredParcelLayoutPreviewCandidate = (
  parcel: CadParcelEntity,
  frontageLine: CadLineEntity,
  settings: CadParcelLayoutSettings,
  tool: 'slide' | 'swing',
  forcedAlternative: CadParcelLayoutSplitAlternative | null = null,
): CadParcelLayoutPreviewCandidate => {
  const startCandidate = cadBuildParcelLayoutPreviewCandidate(
    parcel,
    frontageLine,
    settings,
    tool,
    'start',
  );
  const endCandidate = cadBuildParcelLayoutPreviewCandidate(
    parcel,
    frontageLine,
    settings,
    tool,
    'end',
  );
  if (forcedAlternative === 'start') return startCandidate;
  if (forcedAlternative === 'end') return endCandidate;
  return (
    [startCandidate, endCandidate].sort((left, right) => {
      if (left.isValid !== right.isValid) return left.isValid ? -1 : 1;
      const leftScore = left.evaluation?.score ?? Number.POSITIVE_INFINITY;
      const rightScore = right.evaluation?.score ?? Number.POSITIVE_INFINITY;
      return leftScore - rightScore;
    })[0] ?? startCandidate
  );
};

const cadCloneParcelLayoutGeneratedDraft = (
  vertices: readonly CadWorldPoint[],
  vertexLabels: readonly string[],
  role: CadParcelLayoutGeneratedParcelDraft['role'],
): CadParcelLayoutGeneratedParcelDraft => ({
  vertices: vertices.map((vertex) => ({ x: vertex.x, y: vertex.y })),
  vertexLabels: [...vertexLabels],
  role,
});

const cadBuildParcelEntityFromGeneratedDraft = (
  sourceParcel: CadParcelEntity,
  generatedDraft: CadParcelLayoutGeneratedParcelDraft,
  preserveVertexLabels = false,
): CadParcelEntity => ({
  id: `${sourceParcel.id}:auto-draft`,
  type: 'parcel',
  layerId: sourceParcel.layerId,
  styleId: sourceParcel.styleId,
  visible: sourceParcel.visible,
  locked: sourceParcel.locked,
  parcelName: sourceParcel.parcelName,
  vertices: generatedDraft.vertices.map((vertex) => ({ x: vertex.x, y: vertex.y })),
  vertexLabels: preserveVertexLabels
    ? [...generatedDraft.vertexLabels]
    : generatedDraft.vertices.map((_, index) => `AUTO${index + 1}`),
});

const cadCanonicalizeParcelAgainstFrontage = (
  parcel: CadParcelEntity,
  frontageLine: CadLineEntity,
): CadParcelEntity => {
  const vertices = normalizeParcelPolygonVertices(parcel.vertices);
  const labels =
    parcel.vertexLabels.length === vertices.length
      ? [...parcel.vertexLabels]
      : vertices.map((_, index) => normalizeParcelVertexLabel(parcel.vertexLabels[index], index));
  const vertexCount = vertices.length;
  if (vertexCount < 3) return parcel;

  const buildRotatedParcel = (
    sourceVertices: readonly CadWorldPoint[],
    sourceLabels: readonly string[],
    startIndex: number,
  ): CadParcelEntity => ({
    ...parcel,
    vertices: Array.from({ length: vertexCount }, (_, index) => ({
      x: sourceVertices[(startIndex + index) % vertexCount]!.x,
      y: sourceVertices[(startIndex + index) % vertexCount]!.y,
    })),
    vertexLabels: Array.from({ length: vertexCount }, (_, index) => sourceLabels[(startIndex + index) % vertexCount]!),
  });

  for (let index = 0; index < vertexCount; index += 1) {
    const current = vertices[index]!;
    const next = vertices[(index + 1) % vertexCount]!;
    if (
      parcelPointsMatch(current, { x: frontageLine.fromX, y: frontageLine.fromY }) &&
      parcelPointsMatch(next, { x: frontageLine.toX, y: frontageLine.toY })
    ) {
      return buildRotatedParcel(vertices, labels, index);
    }
  }

  const reversedVertices = [...vertices].reverse();
  const reversedLabels = [...labels].reverse();
  for (let index = 0; index < vertexCount; index += 1) {
    const current = reversedVertices[index]!;
    const next = reversedVertices[(index + 1) % vertexCount]!;
    if (
      parcelPointsMatch(current, { x: frontageLine.fromX, y: frontageLine.fromY }) &&
      parcelPointsMatch(next, { x: frontageLine.toX, y: frontageLine.toY })
    ) {
      return buildRotatedParcel(reversedVertices, reversedLabels, index);
    }
  }

  return parcel;
};

const cadBuildFrontageLineFromParcelLabelPair = (
  parcel: CadParcelEntity,
  startLabel: string,
  endLabel: string,
): CadLineEntity | null => {
  const vertices = normalizeParcelPolygonVertices(parcel.vertices);
  if (vertices.length < 2 || parcel.vertexLabels.length !== vertices.length) return null;
  for (let index = 0; index < vertices.length; index += 1) {
    const nextIndex = (index + 1) % vertices.length;
    const currentLabel = parcel.vertexLabels[index];
    const nextLabel = parcel.vertexLabels[nextIndex];
    if (
      (currentLabel === startLabel && nextLabel === endLabel) ||
      (currentLabel === endLabel && nextLabel === startLabel)
    ) {
      const start = vertices[index]!;
      const end = vertices[nextIndex]!;
      return {
        id: `${parcel.id}:frontage-${index}`,
        type: 'line',
        layerId: parcel.layerId,
        styleId: parcel.styleId,
        visible: parcel.visible,
        locked: parcel.locked,
        fromStationId: currentLabel ?? startLabel,
        toStationId: nextLabel ?? endLabel,
        fromX: start.x,
        fromY: start.y,
        toX: end.x,
        toY: end.y,
        sourceObservationIds: [],
      };
    }
  }
  return null;
};

const cadBuildFrontageLineFromCurrentParcelSegmentGeometry = (
  parcel: CadParcelEntity,
  originalStart: CadWorldPoint,
  originalEnd: CadWorldPoint,
): CadLineEntity | null => {
  const vertices = normalizeParcelPolygonVertices(parcel.vertices);
  if (vertices.length < 2 || parcel.vertexLabels.length !== vertices.length) return null;
  const originalLengthMeters = cadDistance(originalStart, originalEnd);
  if (originalLengthMeters <= 1e-9) return null;
  const projectRatio = (point: CadWorldPoint): number =>
    ((point.x - originalStart.x) * (originalEnd.x - originalStart.x) +
      (point.y - originalStart.y) * (originalEnd.y - originalStart.y)) /
    (originalLengthMeters * originalLengthMeters);
  const overlappingEdges: Array<{
    startRatio: number;
    endRatio: number;
    startLabel: string;
    endLabel: string;
  }> = [];
  for (let index = 0; index < vertices.length; index += 1) {
    const nextIndex = (index + 1) % vertices.length;
    const start = vertices[index]!;
    const end = vertices[nextIndex]!;
    if (
      !cadPointOnSegment(start, originalStart, originalEnd) ||
      !cadPointOnSegment(end, originalStart, originalEnd)
    ) {
      continue;
    }
    overlappingEdges.push({
      startRatio: projectRatio(start),
      endRatio: projectRatio(end),
      startLabel: parcel.vertexLabels[index] ?? `V${index + 1}`,
      endLabel: parcel.vertexLabels[nextIndex] ?? `V${nextIndex + 1}`,
    });
  }
  if (overlappingEdges.length === 0) return null;
  const orderedEdges = overlappingEdges
    .map((edge) => ({
      ...edge,
      startRatio: Math.min(edge.startRatio, edge.endRatio),
      endRatio: Math.max(edge.startRatio, edge.endRatio),
    }))
    .sort((left, right) => left.startRatio - right.startRatio);
  let bestInterval = orderedEdges[0]!;
  let currentInterval = { ...orderedEdges[0]! };
  for (let index = 1; index < orderedEdges.length; index += 1) {
    const edge = orderedEdges[index]!;
    if (edge.startRatio <= currentInterval.endRatio + 1e-9) {
      currentInterval = {
        ...currentInterval,
        endRatio: Math.max(currentInterval.endRatio, edge.endRatio),
        endLabel: edge.endLabel,
      };
    } else {
      if (currentInterval.endRatio - currentInterval.startRatio > bestInterval.endRatio - bestInterval.startRatio) {
        bestInterval = currentInterval;
      }
      currentInterval = { ...edge };
    }
  }
  if (currentInterval.endRatio - currentInterval.startRatio > bestInterval.endRatio - bestInterval.startRatio) {
    bestInterval = currentInterval;
  }
  const clampRatio = (ratio: number): number => Math.max(0, Math.min(1, ratio));
  const startRatio = clampRatio(bestInterval.startRatio);
  const endRatio = clampRatio(bestInterval.endRatio);
  if (endRatio - startRatio <= 1e-9) return null;
  return {
    id: `${parcel.id}:frontage-overlap-merged`,
    type: 'line',
    layerId: parcel.layerId,
    styleId: parcel.styleId,
    visible: parcel.visible,
    locked: parcel.locked,
    fromStationId: bestInterval.startLabel,
    toStationId: bestInterval.endLabel,
    fromX: originalStart.x + (originalEnd.x - originalStart.x) * startRatio,
    fromY: originalStart.y + (originalEnd.y - originalStart.y) * startRatio,
    toX: originalStart.x + (originalEnd.x - originalStart.x) * endRatio,
    toY: originalStart.y + (originalEnd.y - originalStart.y) * endRatio,
    sourceObservationIds: [],
  };
};

const cadBuildFrontageLineForCurrentParcelSegment = (
  parcel: CadParcelEntity,
  frontageReference: CadParcelLayoutFrontageReference,
  segmentIndex: number,
): CadLineEntity | null => {
  const pair = frontageReference.parcelSegmentLabelPairs?.[segmentIndex] ?? null;
  if (pair) {
    const matchedByLabel = cadBuildFrontageLineFromParcelLabelPair(parcel, pair[0], pair[1]);
    if (matchedByLabel) return matchedByLabel;
  }
  const sourceVertices = frontageReference.sourceGeometry?.kind === 'polyline'
    ? frontageReference.sourceGeometry.vertices
    : null;
  if (sourceVertices && segmentIndex >= 0 && segmentIndex < sourceVertices.length - 1) {
    return cadBuildFrontageLineFromCurrentParcelSegmentGeometry(
      parcel,
      sourceVertices[segmentIndex]!,
      sourceVertices[segmentIndex + 1]!,
    );
  }
  return null;
};

const cadBuildFrontageReferenceSubset = (
  frontageReference: CadParcelLayoutFrontageReference,
  segmentIndexes: readonly number[],
): CadParcelLayoutFrontageReference | null => {
  if (segmentIndexes.length === 0) return null;
  const sortedIndexes = [...segmentIndexes].sort((left, right) => left - right);
  for (let index = 1; index < sortedIndexes.length; index += 1) {
    if (sortedIndexes[index] !== sortedIndexes[index - 1]! + 1) {
      return null;
    }
  }
  const firstIndex = sortedIndexes[0]!;
  const frontageLine = frontageReference.parcelSegmentLabelPairs?.length
    ? null
    : frontageReference.frontageLine;
  const subsetPointIds = frontageReference.sourcePointIds.slice(
    firstIndex,
    firstIndex + sortedIndexes.length + 1,
  );
  return {
    ...frontageReference,
    sourcePointIds: subsetPointIds,
    displayLabel: subsetPointIds.join(', '),
    frontageLine: frontageLine ?? frontageReference.frontageLine,
    parcelSegmentIds: frontageReference.parcelSegmentIds?.slice(
      firstIndex,
      firstIndex + sortedIndexes.length,
    ) ?? null,
    parcelSegmentLabelPairs: frontageReference.parcelSegmentLabelPairs?.slice(
      firstIndex,
      firstIndex + sortedIndexes.length,
    ) ?? null,
    sourceGeometry:
      frontageReference.sourceGeometry?.kind === 'polyline'
        ? {
            kind: 'polyline',
            vertices: frontageReference.sourceGeometry.vertices.slice(
              firstIndex,
              firstIndex + sortedIndexes.length + 1,
            ),
            vertexLabels:
              frontageReference.sourceGeometry.vertexLabels?.slice(
                firstIndex,
                firstIndex + sortedIndexes.length + 1,
              ) ?? null,
          }
        : frontageReference.sourceGeometry,
  };
};

const cadBuildGeneratedDraftRemainderAreaSquareMeters = (
  draft: CadParcelAutoLayoutDraft,
): number =>
  draft.generatedParcels.reduce((total, generatedParcel) => {
    if (generatedParcel.role !== 'remainder') return total;
    return total + (cadBuildParcelClosureSummary(generatedParcel.vertices)?.areaSquareMeters ?? 0);
  }, 0);

const cadGeneratedParcelDraftsMatch = (
  first: CadParcelLayoutGeneratedParcelDraft,
  second: CadParcelLayoutGeneratedParcelDraft,
): boolean =>
  first.role === second.role &&
  first.vertices.length === second.vertices.length &&
  first.vertices.every((vertex, index) => parcelPointsMatch(vertex, second.vertices[index]!));

const cadBuildCornerFrontageReference = (
  cornerParcel: CadParcelEntity,
  firstFrontageLine: CadLineEntity,
  secondFrontageLine: CadLineEntity,
): CadParcelLayoutFrontageReference | null => {
  const firstOverlap = cadBuildFrontageLineFromCurrentParcelSegmentGeometry(
    cornerParcel,
    { x: firstFrontageLine.fromX, y: firstFrontageLine.fromY },
    { x: firstFrontageLine.toX, y: firstFrontageLine.toY },
  );
  const secondOverlap = cadBuildFrontageLineFromCurrentParcelSegmentGeometry(
    cornerParcel,
    { x: secondFrontageLine.fromX, y: secondFrontageLine.fromY },
    { x: secondFrontageLine.toX, y: secondFrontageLine.toY },
  );
  if (!firstOverlap || !secondOverlap) return null;

  const firstPoints = [
    { x: firstOverlap.fromX, y: firstOverlap.fromY, label: firstOverlap.fromStationId },
    { x: firstOverlap.toX, y: firstOverlap.toY, label: firstOverlap.toStationId },
  ];
  const secondPoints = [
    { x: secondOverlap.fromX, y: secondOverlap.fromY, label: secondOverlap.fromStationId },
    { x: secondOverlap.toX, y: secondOverlap.toY, label: secondOverlap.toStationId },
  ];
  const sharedPair =
    firstPoints.flatMap((firstPoint) =>
      secondPoints
        .filter((secondPoint) =>
          parcelPointsMatch(firstPoint, secondPoint),
        )
        .map((secondPoint) => ({ firstPoint, secondPoint })),
    )[0] ?? null;
  if (!sharedPair) return null;
  const firstOuterPoint = firstPoints.find((point) => !parcelPointsMatch(point, sharedPair.firstPoint)) ?? null;
  const secondOuterPoint = secondPoints.find((point) => !parcelPointsMatch(point, sharedPair.secondPoint)) ?? null;
  if (!firstOuterPoint || !secondOuterPoint) return null;

  return {
    sourceEntityId: cornerParcel.id,
    displayLabel: `${firstOverlap.fromStationId}-${firstOverlap.toStationId}, ${secondOverlap.fromStationId}-${secondOverlap.toStationId}`,
    sourcePointIds: [
      firstOuterPoint.label,
      sharedPair.firstPoint.label,
      secondOuterPoint.label,
    ],
    frontageLine: {
      ...firstOverlap,
      fromStationId: firstOuterPoint.label,
      fromX: firstOuterPoint.x,
      fromY: firstOuterPoint.y,
      toStationId: sharedPair.firstPoint.label,
      toX: sharedPair.firstPoint.x,
      toY: sharedPair.firstPoint.y,
    },
    sourceGeometry: {
      kind: 'polyline',
      vertices: [
        { x: firstOuterPoint.x, y: firstOuterPoint.y },
        { x: sharedPair.firstPoint.x, y: sharedPair.firstPoint.y },
        { x: secondOuterPoint.x, y: secondOuterPoint.y },
      ],
      vertexLabels: [
        firstOuterPoint.label,
        sharedPair.firstPoint.label,
        secondOuterPoint.label,
      ],
    },
  };
};

interface CadCornerInfillDraft {
  draft: CadParcelAutoLayoutDraft;
  remainderDraft: CadParcelLayoutGeneratedParcelDraft | null;
  firstSegmentTrimMeters: number;
  secondSegmentTrimMeters: number;
}

interface CadGeneratedLotConflictPair {
  firstLotIndex: number;
  secondLotIndex: number;
  overlapAreaSquareMeters: number;
}

interface CadGeneratedParcelLotEntry {
  generatedParcelIndex: number;
  lotIndex: number;
  candidateIndex: number;
  generatedParcel: CadParcelLayoutGeneratedParcelDraft;
  candidate: CadParcelLayoutPreviewCandidate;
}

const cadBuildRemainderJunctionInfillDraft = (
  parcel: CadParcelEntity,
  firstFrontageLine: CadLineEntity,
  secondFrontageLine: CadLineEntity,
  settings: CadParcelLayoutSettings,
  tool: 'slide' | 'swing',
): CadCornerInfillDraft | null => {
  const cornerFrontageReference = cadBuildCornerFrontageReference(
    parcel,
    firstFrontageLine,
    secondFrontageLine,
  );
  if (!cornerFrontageReference) return null;
  const cornerSizingVariants: CadParcelLayoutSettings[] = [
    {
      ...settings,
      remainderDistribution: 'create_parcel_from_remainder',
    },
    {
      ...settings,
      useMaxDepth: false,
      remainderDistribution: 'create_parcel_from_remainder',
    },
  ];
  const cornerSolutionPreferences: CadParcelLayoutSettings['solutionPreference'][] = [
    settings.solutionPreference,
    'closest_to_target_area',
    'smallest_area',
  ];
  const candidateDrafts: CadParcelAutoLayoutDraft[] = [];
  cornerSizingVariants.forEach((cornerSettings) => {
    cornerSolutionPreferences.forEach((solutionPreference) => {
      const variantSettings = {
        ...cornerSettings,
        solutionPreference,
      };
      const frontagePathDraft = cadBuildParcelFrontagePathAutoLayoutDraft(
        parcel,
        cornerFrontageReference,
        variantSettings,
        tool,
      );
      if (frontagePathDraft?.isValid && frontagePathDraft.acceptedCandidates.length > 0) {
        candidateDrafts.push(frontagePathDraft);
      }
      const preferredDraft = cadBuildPreferredParcelAutoLayoutDraftFromFrontageReference(
        parcel,
        cornerFrontageReference,
        variantSettings,
        tool,
      );
      if (preferredDraft.isValid && preferredDraft.acceptedCandidates.length > 0) {
        candidateDrafts.push(preferredDraft);
      }
      const chainedDraft = cadBuildParcelAutoLayoutDraftFromFrontageReference(
        parcel,
        cornerFrontageReference,
        variantSettings,
        tool,
      );
      if (chainedDraft.isValid && chainedDraft.acceptedCandidates.length > 0) {
        candidateDrafts.push(chainedDraft);
      }
    });
  });
  const resolvedDraft =
    candidateDrafts
      .map((draft) => ({
        draft,
        remainderDraft:
          draft.generatedParcels.find((generatedParcel) => generatedParcel.role === 'remainder') ?? null,
        materialOverlapPairCount: cadBuildGeneratedParcelOverlapPairCount(
          draft.generatedParcels.filter((generatedParcel) => generatedParcel.role === 'lot'),
        ),
      }))
      .sort((left, right) => {
        if (left.materialOverlapPairCount !== right.materialOverlapPairCount) {
          return left.materialOverlapPairCount - right.materialOverlapPairCount;
        }
        const leftHasRemainder = left.remainderDraft != null;
        const rightHasRemainder = right.remainderDraft != null;
        if (leftHasRemainder !== rightHasRemainder) {
          return rightHasRemainder ? 1 : -1;
        }
        if (left.draft.acceptedCandidates.length !== right.draft.acceptedCandidates.length) {
          return right.draft.acceptedCandidates.length - left.draft.acceptedCandidates.length;
        }
        return left.draft.generatedParcels.length - right.draft.generatedParcels.length;
      })[0] ?? null;
  if (!resolvedDraft?.draft.isValid || resolvedDraft.draft.acceptedCandidates.length === 0) {
    return null;
  }
  const cornerLots = resolvedDraft.draft.generatedParcels.filter(
    (generatedParcel) => generatedParcel.role === 'lot',
  );
  return {
    draft: {
      ...resolvedDraft.draft,
      generatedParcels: cornerLots,
    },
    remainderDraft: resolvedDraft.remainderDraft,
    firstSegmentTrimMeters: cadBuildCornerFrontageConsumptionMeters(
      firstFrontageLine,
      'end',
      cornerLots,
    ),
    secondSegmentTrimMeters: cadBuildCornerFrontageConsumptionMeters(
      secondFrontageLine,
      'start',
      cornerLots,
    ),
  };
};

const cadEstimateRemainingFrontageLotCapacity = (
  frontageLine: CadLineEntity,
  consumedMeters: number,
  minimumFrontageMeters: number,
): number => {
  if (minimumFrontageMeters <= 1e-9) return 0;
  const frontageLengthMeters = cadDistance(
    { x: frontageLine.fromX, y: frontageLine.fromY },
    { x: frontageLine.toX, y: frontageLine.toY },
  );
  if (frontageLengthMeters <= 1e-9) return 0;
  const remainingMeters = Math.max(0, frontageLengthMeters - consumedMeters);
  return Math.max(0, Math.floor((remainingMeters + 1e-9) / minimumFrontageMeters));
};

const cadBuildGeneratedParcelOverlapPairCount = (
  generatedParcels: readonly CadParcelLayoutGeneratedParcelDraft[],
): number => {
  return cadBuildGeneratedParcelConflictPairs(generatedParcels).length;
};

const cadBuildGeneratedParcelConflictPairs = (
  generatedParcels: readonly CadParcelLayoutGeneratedParcelDraft[],
): CadGeneratedLotConflictPair[] => {
  const conflictPairs: CadGeneratedLotConflictPair[] = [];
  for (let firstIndex = 0; firstIndex < generatedParcels.length; firstIndex += 1) {
    for (let secondIndex = firstIndex + 1; secondIndex < generatedParcels.length; secondIndex += 1) {
      const firstVertices = normalizeParcelPolygonVertices(generatedParcels[firstIndex]!.vertices);
      const secondVertices = normalizeParcelPolygonVertices(generatedParcels[secondIndex]!.vertices);
      if (firstVertices.length < 3 || secondVertices.length < 3) continue;
      const hasMaterialConflict =
        firstVertices.some((point) => cadPointStrictlyInPolygon(point, secondVertices)) ||
        secondVertices.some((point) => cadPointStrictlyInPolygon(point, firstVertices)) ||
        firstVertices.some((start, index) => {
          const end = firstVertices[(index + 1) % firstVertices.length]!;
          return secondVertices.some((clipStart, clipIndex) => {
            const clipEnd = secondVertices[(clipIndex + 1) % secondVertices.length]!;
            const intersection = cadSegmentIntersection(start, end, clipStart, clipEnd);
            if (!intersection) return false;
            const touchesAtSharedVertex =
              [start, end, clipStart, clipEnd].some((vertex) => parcelPointsMatch(intersection, vertex));
            return !touchesAtSharedVertex;
          });
        });
      if (hasMaterialConflict) {
        const overlapAreaSquareMeters = cadBuildParcelOverlapAreaSquareMeters(firstVertices, secondVertices);
        if (overlapAreaSquareMeters > 1) {
          conflictPairs.push({
            firstLotIndex: firstIndex,
            secondLotIndex: secondIndex,
            overlapAreaSquareMeters,
          });
        }
      }
    }
  }
  return conflictPairs;
};

const cadBuildDraftLotEntries = ({
  generatedParcels,
  acceptedCandidates,
}: Pick<CadParcelAutoLayoutDraft, 'generatedParcels' | 'acceptedCandidates'>): CadGeneratedParcelLotEntry[] => {
  const lotEntries: CadGeneratedParcelLotEntry[] = [];
  let lotIndex = 0;
  let candidateIndex = 0;
  generatedParcels.forEach((generatedParcel, generatedParcelIndex) => {
    if (generatedParcel.role !== 'lot') return;
    const candidate = acceptedCandidates[candidateIndex];
    if (candidate) {
      lotEntries.push({
        generatedParcelIndex,
        lotIndex,
        candidateIndex,
        generatedParcel,
        candidate,
      });
    }
    lotIndex += 1;
    candidateIndex += 1;
  });
  return lotEntries;
};

const cadResolveGeneratedParcelConflicts = (
  draft: CadParcelAutoLayoutDraft,
): CadParcelAutoLayoutDraft => {
  const buildSourcePriority = (
    sourceKind: CadParcelLayoutGeneratedParcelDraft['sourceKind'],
  ): number => {
    switch (sourceKind) {
      case 'corner_remainder':
        return 0;
      case 'corner_prepass':
        return 1;
      case 'segment':
        return 2;
      default:
        return 3;
    }
  };
  const lotEntries = cadBuildDraftLotEntries(draft);
  if (lotEntries.length < 2) return draft;
  const conflictPairs = cadBuildGeneratedParcelConflictPairs(
    lotEntries.map((entry) => entry.generatedParcel),
  );
  if (conflictPairs.length === 0) return draft;

  const activeLotIndexes = new Set(lotEntries.map((entry) => entry.lotIndex));
  while (true) {
    const activeConflictPairs = conflictPairs.filter(
      (pair) =>
        activeLotIndexes.has(pair.firstLotIndex) &&
        activeLotIndexes.has(pair.secondLotIndex),
    );
    if (activeConflictPairs.length === 0) break;

    const metricsByLotIndex = new Map<
      number,
      {
        degree: number;
        overlapAreaSquareMeters: number;
      }
    >();
    activeConflictPairs.forEach((pair) => {
      const firstMetrics = metricsByLotIndex.get(pair.firstLotIndex) ?? {
        degree: 0,
        overlapAreaSquareMeters: 0,
      };
      firstMetrics.degree += 1;
      firstMetrics.overlapAreaSquareMeters += pair.overlapAreaSquareMeters;
      metricsByLotIndex.set(pair.firstLotIndex, firstMetrics);

      const secondMetrics = metricsByLotIndex.get(pair.secondLotIndex) ?? {
        degree: 0,
        overlapAreaSquareMeters: 0,
      };
      secondMetrics.degree += 1;
      secondMetrics.overlapAreaSquareMeters += pair.overlapAreaSquareMeters;
      metricsByLotIndex.set(pair.secondLotIndex, secondMetrics);
    });

    const lotToRemove =
      lotEntries
        .filter((entry) => activeLotIndexes.has(entry.lotIndex))
        .sort((left, right) => {
          const leftMetrics = metricsByLotIndex.get(left.lotIndex) ?? {
            degree: 0,
            overlapAreaSquareMeters: 0,
          };
          const rightMetrics = metricsByLotIndex.get(right.lotIndex) ?? {
            degree: 0,
            overlapAreaSquareMeters: 0,
          };
          if (leftMetrics.degree !== rightMetrics.degree) {
            return rightMetrics.degree - leftMetrics.degree;
          }
          if (
            Math.abs(leftMetrics.overlapAreaSquareMeters - rightMetrics.overlapAreaSquareMeters) >
            1e-6
          ) {
            return rightMetrics.overlapAreaSquareMeters - leftMetrics.overlapAreaSquareMeters;
          }
          const leftScore = left.candidate.evaluation?.score ?? Number.POSITIVE_INFINITY;
          const rightScore = right.candidate.evaluation?.score ?? Number.POSITIVE_INFINITY;
          const leftSourcePriority = buildSourcePriority(left.generatedParcel.sourceKind);
          const rightSourcePriority = buildSourcePriority(right.generatedParcel.sourceKind);
          if (leftSourcePriority !== rightSourcePriority) {
            return rightSourcePriority - leftSourcePriority;
          }
          if (Math.abs(leftScore - rightScore) > 1e-6) {
            return rightScore - leftScore;
          }
          const leftFrontage =
            'frontageLengthMeters' in left.generatedParcel
              ? (left.generatedParcel as CadParcelLayoutGeneratedParcelDraft & {
                  frontageLengthMeters?: number;
                }).frontageLengthMeters ?? 0
              : 0;
          const rightFrontage =
            'frontageLengthMeters' in right.generatedParcel
              ? (right.generatedParcel as CadParcelLayoutGeneratedParcelDraft & {
                  frontageLengthMeters?: number;
                }).frontageLengthMeters ?? 0
              : 0;
          if (Math.abs(leftFrontage - rightFrontage) > 1e-6) {
            return rightFrontage - leftFrontage;
          }
          return right.lotIndex - left.lotIndex;
        })[0] ?? null;
    if (!lotToRemove) break;
    activeLotIndexes.delete(lotToRemove.lotIndex);
  }

  const removedGeneratedParcelIndexes = new Set<number>();
  const removedCandidateIndexes = new Set<number>();
  lotEntries.forEach((entry) => {
    if (activeLotIndexes.has(entry.lotIndex)) return;
    removedGeneratedParcelIndexes.add(entry.generatedParcelIndex);
    removedCandidateIndexes.add(entry.candidateIndex);
  });
  if (removedGeneratedParcelIndexes.size === 0) return draft;
  const resolvedGeneratedParcels = draft.generatedParcels.filter(
    (_generatedParcel, index) => !removedGeneratedParcelIndexes.has(index),
  );
  const resolvedAcceptedCandidates = draft.acceptedCandidates.filter(
    (_candidate, index) => !removedCandidateIndexes.has(index),
  );
  return {
    ...draft,
    generatedParcels: resolvedGeneratedParcels,
    acceptedCandidates: resolvedAcceptedCandidates,
    statusMessage: `${draft.statusMessage} Removed ${removedGeneratedParcelIndexes.size} overlapping duplicate lots; kept ${resolvedAcceptedCandidates.length} lots and ${resolvedGeneratedParcels.length} parcels.`,
  };
};

const cadBuildLocalizedRemainderReplacementDraft = ({
  draft,
  replacedGeneratedParcelIndex,
  infillDraft,
}: {
  draft: CadParcelAutoLayoutDraft;
  replacedGeneratedParcelIndex: number;
  infillDraft: CadParcelAutoLayoutDraft;
}): CadParcelAutoLayoutDraft | null => {
  const remainingGeneratedParcels = draft.generatedParcels.filter(
    (_entry, index) => index !== replacedGeneratedParcelIndex,
  );
  const remainingAcceptedCandidates = [...draft.acceptedCandidates];
  const existingLotEntries = cadBuildDraftLotEntries({
    generatedParcels: remainingGeneratedParcels,
    acceptedCandidates: remainingAcceptedCandidates,
  });
  const infillLots = infillDraft.generatedParcels.filter(
    (generatedParcel) => generatedParcel.role === 'lot',
  );
  if (existingLotEntries.length === 0 || infillLots.length === 0) return null;

  const conflictPairs = cadBuildGeneratedParcelConflictPairs([
    ...existingLotEntries.map((entry) => entry.generatedParcel),
    ...infillLots,
  ]);
  const conflictingExistingLotIndexes = new Set<number>();
  conflictPairs.forEach((pair) => {
    const firstIsExisting = pair.firstLotIndex < existingLotEntries.length;
    const secondIsExisting = pair.secondLotIndex < existingLotEntries.length;
    if (firstIsExisting === secondIsExisting) return;
    conflictingExistingLotIndexes.add(firstIsExisting ? pair.firstLotIndex : pair.secondLotIndex);
  });
  if (conflictingExistingLotIndexes.size === 0) return null;

  const removedGeneratedParcelIndexes = new Set<number>();
  const removedCandidateIndexes = new Set<number>();
  existingLotEntries.forEach((entry, localLotIndex) => {
    if (!conflictingExistingLotIndexes.has(localLotIndex)) return;
    removedGeneratedParcelIndexes.add(entry.generatedParcelIndex);
    removedCandidateIndexes.add(entry.candidateIndex);
  });
  if (removedGeneratedParcelIndexes.size === 0) return null;

  return cadResolveGeneratedParcelConflicts({
    ...draft,
    generatedParcels: [
      ...remainingGeneratedParcels.filter(
        (_entry, index) => !removedGeneratedParcelIndexes.has(index),
      ),
      ...infillDraft.generatedParcels,
    ],
    acceptedCandidates: [
      ...remainingAcceptedCandidates.filter(
        (_candidate, index) => !removedCandidateIndexes.has(index),
      ),
      ...infillDraft.acceptedCandidates,
    ],
    statusMessage: `${draft.statusMessage} Replaced ${removedGeneratedParcelIndexes.size} conflicting strip lots with localized corner fill.`,
  });
};

const cadTryFillGeneratedRemaindersFromFrontageReference = (
  sourceParcel: CadParcelEntity,
  frontageReference: CadParcelLayoutFrontageReference,
  settings: CadParcelLayoutSettings,
  tool: 'slide' | 'swing',
  draft: CadParcelAutoLayoutDraft,
): CadParcelAutoLayoutDraft => {
  let workingDraft = draft;
  let filledRemainderCount = 0;
  const originalRemainders = draft.generatedParcels.filter(
    (generatedParcel) => generatedParcel.role === 'remainder',
  );
  for (const originalRemainder of originalRemainders) {
    const generatedIndex = workingDraft.generatedParcels.findIndex((generatedParcel) =>
      cadGeneratedParcelDraftsMatch(generatedParcel, originalRemainder),
    );
    if (generatedIndex < 0) continue;
    const generatedParcel = workingDraft.generatedParcels[generatedIndex]!;
    if (generatedParcel.role !== 'remainder') continue;
    const remainderParcel = cadBuildParcelEntityFromGeneratedDraft(
      sourceParcel,
      generatedParcel,
      true,
    );
    const touchedSegmentIndexes: number[] = [];
    const segmentCount = frontageReference.parcelSegmentLabelPairs?.length ?? 1;
    for (let segmentIndex = 0; segmentIndex < segmentCount; segmentIndex += 1) {
      if (cadBuildFrontageLineForCurrentParcelSegment(remainderParcel, frontageReference, segmentIndex)) {
        touchedSegmentIndexes.push(segmentIndex);
      }
    }

    const infillCandidateDrafts: Array<{
      draft: CadParcelAutoLayoutDraft;
      sourceKind: CadParcelLayoutGeneratedParcelDraft['sourceKind'];
    }> = [];
    if (touchedSegmentIndexes.length === 1) {
      const frontageLine = cadBuildFrontageLineForCurrentParcelSegment(
        remainderParcel,
        frontageReference,
        touchedSegmentIndexes[0]!,
      );
      if (frontageLine) {
        const selectedFrontageDraft = cadBuildParcelAutoLayoutDraftForSupportedRemainderMode(
          remainderParcel,
          frontageLine,
          {
            ...settings,
            remainderDistribution: 'create_parcel_from_remainder',
          },
          tool,
        );
        if (selectedFrontageDraft.isValid && selectedFrontageDraft.acceptedCandidates.length > 0) {
          infillCandidateDrafts.push({
            draft: selectedFrontageDraft,
            sourceKind: 'corner_remainder',
          });
        }
      }
    } else {
      const subsetReference = cadBuildFrontageReferenceSubset(frontageReference, touchedSegmentIndexes);
      const firstFrontageLine = cadBuildFrontageLineForCurrentParcelSegment(
        remainderParcel,
        frontageReference,
        touchedSegmentIndexes[0]!,
      );
      if (subsetReference && firstFrontageLine) {
        const selectedFrontageDraft = cadBuildParcelAutoLayoutDraftFromFrontageReference(
          remainderParcel,
          {
            ...subsetReference,
            sourceEntityId: remainderParcel.id,
            frontageLine: firstFrontageLine,
          },
          {
            ...settings,
            remainderDistribution: 'create_parcel_from_remainder',
          },
          tool,
        );
        if (selectedFrontageDraft.isValid && selectedFrontageDraft.acceptedCandidates.length > 0) {
          infillCandidateDrafts.push({
            draft: selectedFrontageDraft,
            sourceKind: 'corner_remainder',
          });
        }
      }
    }
    const remainingGeneratedParcels = workingDraft.generatedParcels.filter(
      (_entry, index) => index !== generatedIndex,
    );
    const remainingAcceptedCandidates = [...workingDraft.acceptedCandidates];
    const workingRemainderArea = cadBuildGeneratedDraftRemainderAreaSquareMeters(workingDraft);
    const workingRemainderCount = workingDraft.generatedParcels.filter(
      (entry) => entry.role === 'remainder',
    ).length;
    const bestCandidate =
      infillCandidateDrafts
        .map((candidateEntry) => {
          const infillDraft = candidateEntry.draft;
          const mergedDraft =
            cadBuildLocalizedRemainderReplacementDraft({
              draft: workingDraft,
              replacedGeneratedParcelIndex: generatedIndex,
              infillDraft,
            }) ??
            cadResolveGeneratedParcelConflicts({
              ...workingDraft,
              generatedParcels: [...remainingGeneratedParcels, ...infillDraft.generatedParcels],
              acceptedCandidates: [...remainingAcceptedCandidates, ...infillDraft.acceptedCandidates],
              statusMessage: workingDraft.statusMessage,
            });
          const mergedRemainderArea = cadBuildGeneratedDraftRemainderAreaSquareMeters(mergedDraft);
          const mergedRemainderCount = mergedDraft.generatedParcels.filter(
            (entry) => entry.role === 'remainder',
          ).length;
          const improvesLotCount =
            mergedDraft.acceptedCandidates.length > workingDraft.acceptedCandidates.length;
          const improvesRemainder =
            mergedDraft.acceptedCandidates.length === workingDraft.acceptedCandidates.length &&
            (mergedRemainderCount < workingRemainderCount ||
              mergedRemainderArea + 1e-3 < workingRemainderArea);
          return {
            ...candidateEntry,
            infillDraft,
            mergedDraft,
            mergedRemainderArea,
            mergedRemainderCount,
            improvesLotCount,
            improvesRemainder,
          };
        })
        .filter((candidateEntry) => candidateEntry.improvesLotCount || candidateEntry.improvesRemainder)
        .sort((left, right) => {
          if (left.mergedDraft.acceptedCandidates.length !== right.mergedDraft.acceptedCandidates.length) {
            return right.mergedDraft.acceptedCandidates.length - left.mergedDraft.acceptedCandidates.length;
          }
          if (left.mergedRemainderCount !== right.mergedRemainderCount) {
            return left.mergedRemainderCount - right.mergedRemainderCount;
          }
          if (Math.abs(left.mergedRemainderArea - right.mergedRemainderArea) > 1e-6) {
            return left.mergedRemainderArea - right.mergedRemainderArea;
          }
          return left.mergedDraft.generatedParcels.length - right.mergedDraft.generatedParcels.length;
        })[0] ?? null;
    if (!bestCandidate) continue;
    workingDraft = {
      ...bestCandidate.mergedDraft,
      statusMessage: `${bestCandidate.mergedDraft.statusMessage} Filled 1 remainder parcel from available frontage.`,
    };
    filledRemainderCount += 1;
  }
  return filledRemainderCount > 0 ? workingDraft : draft;
};

const cadBuildCornerFrontageConsumptionMeters = (
  frontageLine: CadLineEntity,
  sharedAt: 'start' | 'end',
  generatedParcels: readonly CadParcelLayoutGeneratedParcelDraft[],
): number => {
  const lineStart = { x: frontageLine.fromX, y: frontageLine.fromY };
  const lineEnd = { x: frontageLine.toX, y: frontageLine.toY };
  const lineLengthMeters = cadDistance(lineStart, lineEnd);
  if (lineLengthMeters <= 1e-9) return 0;
  let maximumOffsetMeters = 0;
  generatedParcels.forEach((generatedParcel, index) => {
    const overlapLine = cadBuildFrontageLineFromCurrentParcelSegmentGeometry(
      {
        id: `corner-frontage-consumption:${index}`,
        type: 'parcel',
        layerId: frontageLine.layerId,
        styleId: frontageLine.styleId,
        visible: frontageLine.visible,
        locked: frontageLine.locked,
        parcelName: `Corner frontage consumption ${index + 1}`,
        vertices: generatedParcel.vertices,
        vertexLabels: generatedParcel.vertexLabels,
      },
      lineStart,
      lineEnd,
    );
    if (!overlapLine) return;
    const overlapEndpoints = [
      { x: overlapLine.fromX, y: overlapLine.fromY },
      { x: overlapLine.toX, y: overlapLine.toY },
    ];
    overlapEndpoints.forEach((vertex) => {
      const offsetMeters =
        sharedAt === 'start' ? cadDistance(lineStart, vertex) : cadDistance(lineEnd, vertex);
      if (Number.isFinite(offsetMeters)) {
        maximumOffsetMeters = Math.max(maximumOffsetMeters, offsetMeters);
      }
    });
  });
  return Math.min(lineLengthMeters, maximumOffsetMeters);
};

const cadBuildCornerFrontageTouchingLotCount = (
  frontageLine: CadLineEntity,
  generatedParcels: readonly CadParcelLayoutGeneratedParcelDraft[],
): number =>
  generatedParcels.filter((generatedParcel, index) =>
    cadBuildFrontageLineFromCurrentParcelSegmentGeometry(
      {
        id: `corner-frontage-touch:${index}`,
        type: 'parcel',
        layerId: frontageLine.layerId,
        styleId: frontageLine.styleId,
        visible: frontageLine.visible,
        locked: frontageLine.locked,
        parcelName: `Corner frontage touch ${index + 1}`,
        vertices: generatedParcel.vertices,
        vertexLabels: generatedParcel.vertexLabels,
      },
      { x: frontageLine.fromX, y: frontageLine.fromY },
      { x: frontageLine.toX, y: frontageLine.toY },
    ) != null,
  ).length;

const cadGeneratedParcelTouchesFrontageLine = (
  frontageLine: CadLineEntity,
  generatedParcel: CadParcelLayoutGeneratedParcelDraft,
): boolean =>
  cadBuildFrontageLineFromCurrentParcelSegmentGeometry(
    {
      id: 'corner-frontage-touch-check',
      type: 'parcel',
      layerId: frontageLine.layerId,
      styleId: frontageLine.styleId,
      visible: frontageLine.visible,
      locked: frontageLine.locked,
      parcelName: 'Corner frontage touch check',
      vertices: generatedParcel.vertices,
      vertexLabels: generatedParcel.vertexLabels,
    },
    { x: frontageLine.fromX, y: frontageLine.fromY },
    { x: frontageLine.toX, y: frontageLine.toY },
  ) != null;

const cadBuildSharedFrontagePoint = (
  firstFrontageLine: CadLineEntity,
  secondFrontageLine: CadLineEntity,
): CadWorldPoint | null => {
  const firstPoints = [
    { x: firstFrontageLine.fromX, y: firstFrontageLine.fromY },
    { x: firstFrontageLine.toX, y: firstFrontageLine.toY },
  ];
  const secondPoints = [
    { x: secondFrontageLine.fromX, y: secondFrontageLine.fromY },
    { x: secondFrontageLine.toX, y: secondFrontageLine.toY },
  ];
  return (
    firstPoints.find((firstPoint) =>
      secondPoints.some((secondPoint) => parcelPointsMatch(firstPoint, secondPoint)),
    ) ?? null
  );
};

const cadGeneratedParcelTouchesPoint = (
  generatedParcel: CadParcelLayoutGeneratedParcelDraft,
  point: CadWorldPoint,
): boolean => {
  const vertices = normalizeParcelPolygonVertices(generatedParcel.vertices);
  return vertices.some((start, index) =>
    cadPointOnSegment(point, start, vertices[(index + 1) % vertices.length]!),
  );
};

const cadBuildTaggedGeneratedLotDraft = ({
  draft,
  sourceKind,
  sourceSegmentIndex,
}: {
  draft: CadParcelAutoLayoutDraft;
  sourceKind: CadParcelLayoutGeneratedParcelDraft['sourceKind'];
  sourceSegmentIndex?: number;
}): CadParcelAutoLayoutDraft => ({
  ...draft,
  generatedParcels: draft.generatedParcels
    .filter((generatedParcel) => generatedParcel.role === 'lot')
    .map((generatedParcel) => ({
      ...generatedParcel,
      sourceKind: generatedParcel.sourceKind ?? sourceKind,
      sourceSegmentIndex,
    })),
});

const cadBuildCornerJunctionReplacementLotCount = ({
  parcel,
  firstFrontageLine,
  secondFrontageLine,
  cornerDraft,
  firstSegmentTrimMeters,
  secondSegmentTrimMeters,
  settings,
  tool,
}: {
  parcel: CadParcelEntity;
  firstFrontageLine: CadLineEntity;
  secondFrontageLine: CadLineEntity;
  cornerDraft: CadParcelAutoLayoutDraft;
  firstSegmentTrimMeters: number;
  secondSegmentTrimMeters: number;
  settings: CadParcelLayoutSettings;
  tool: 'slide' | 'swing';
}): number => {
  const buildStraightStripDraft = (
    frontageLine: CadLineEntity,
    trimFromStartMeters: number,
    trimFromEndMeters: number,
    sourceSegmentIndex: number,
  ): CadParcelAutoLayoutDraft | null => {
    const trimmedFrontage =
      cadBuildTrimmedFrontageLine(frontageLine, trimFromStartMeters, trimFromEndMeters) ??
      frontageLine;
    const stripSettings: CadParcelLayoutSettings = {
      ...settings,
      remainderDistribution: 'create_parcel_from_remainder',
    };
    const stripDraft =
      (settings.useMaxDepth
        ? cadBuildParcelFrontageStripAutoLayoutDraft(
            parcel,
            trimmedFrontage,
            stripSettings,
            tool,
          )
        : null) ??
      cadBuildParcelAutoLayoutDraft(
        parcel,
        trimmedFrontage,
        stripSettings,
        tool,
      );
    if (!stripDraft.isValid || stripDraft.acceptedCandidates.length === 0) return null;
    return cadBuildTaggedGeneratedLotDraft({
      draft: stripDraft,
      sourceKind: 'segment',
      sourceSegmentIndex,
    });
  };

  const taggedCornerDraft = cadBuildTaggedGeneratedLotDraft({
    draft: cornerDraft,
    sourceKind: 'corner_prepass',
  });
  const firstStripDraft = buildStraightStripDraft(
    firstFrontageLine,
    0,
    firstSegmentTrimMeters,
    0,
  );
  const secondStripDraft = buildStraightStripDraft(
    secondFrontageLine,
    secondSegmentTrimMeters,
    0,
    1,
  );
  const mergedDraft = cadResolveGeneratedParcelConflicts({
    tool,
    generatedParcels: [
      ...taggedCornerDraft.generatedParcels,
      ...(firstStripDraft?.generatedParcels ?? []),
      ...(secondStripDraft?.generatedParcels ?? []),
    ],
    acceptedCandidates: [
      ...taggedCornerDraft.acceptedCandidates,
      ...(firstStripDraft?.acceptedCandidates ?? []),
      ...(secondStripDraft?.acceptedCandidates ?? []),
    ],
    isValid: true,
    statusMessage: 'Corner junction replacement estimate.',
  });
  return mergedDraft.acceptedCandidates.length;
};

const cadBuildSequentialCornerStripDraft = ({
  cornerParcel,
  primaryFrontageLine,
  secondaryFrontageLine,
  settings,
  tool,
}: {
  cornerParcel: CadParcelEntity;
  primaryFrontageLine: CadLineEntity;
  secondaryFrontageLine: CadLineEntity;
  settings: CadParcelLayoutSettings;
  tool: 'slide' | 'swing';
}): CadParcelAutoLayoutDraft | null => {
  const primaryDraft = cadBuildParcelAutoLayoutDraftForSupportedRemainderMode(
    cornerParcel,
    primaryFrontageLine,
    {
      ...settings,
      remainderDistribution: 'create_parcel_from_remainder',
    },
    tool,
  );
  if (!primaryDraft.isValid || primaryDraft.acceptedCandidates.length === 0) return null;
  const primaryRemainder =
    primaryDraft.generatedParcels.find((generatedParcel) => generatedParcel.role === 'remainder') ?? null;
  if (!primaryRemainder) return null;
  const primaryRemainderParcel = cadBuildParcelEntityFromGeneratedDraft(
    cornerParcel,
    primaryRemainder,
    true,
  );
  const recoveredSecondaryFrontage = cadBuildFrontageLineFromCurrentParcelSegmentGeometry(
    primaryRemainderParcel,
    { x: secondaryFrontageLine.fromX, y: secondaryFrontageLine.fromY },
    { x: secondaryFrontageLine.toX, y: secondaryFrontageLine.toY },
  );
  if (!recoveredSecondaryFrontage) return null;
  const secondaryDraft = cadBuildParcelAutoLayoutDraftForSupportedRemainderMode(
    primaryRemainderParcel,
    recoveredSecondaryFrontage,
    {
      ...settings,
      remainderDistribution: 'create_parcel_from_remainder',
    },
    tool,
  );
  if (!secondaryDraft.isValid || secondaryDraft.acceptedCandidates.length === 0) return null;
  const mergedDraft = cadResolveGeneratedParcelConflicts({
    tool,
    generatedParcels: [
      ...primaryDraft.generatedParcels.filter((generatedParcel) => generatedParcel.role === 'lot'),
      ...secondaryDraft.generatedParcels,
    ],
    acceptedCandidates: [
      ...primaryDraft.acceptedCandidates,
      ...secondaryDraft.acceptedCandidates,
    ],
    isValid: true,
    statusMessage: 'Sequential corner strip draft.',
  });
  return mergedDraft.acceptedCandidates.length > 0 ? mergedDraft : null;
};

const cadBuildLimitedCornerPathDraft = (
  cornerParcel: CadParcelEntity,
  firstFrontageLine: CadLineEntity,
  secondFrontageLine: CadLineEntity,
  settings: CadParcelLayoutSettings,
  tool: 'slide' | 'swing',
): CadParcelAutoLayoutDraft | null => {
  const sharedPoint = cadBuildSharedFrontagePoint(firstFrontageLine, secondFrontageLine);
  if (!sharedPoint) return null;
  const pointAwayFromShared = (
    frontageLine: CadLineEntity,
    maxDistanceMeters: number,
  ): CadWorldPoint | null => {
    const start = { x: frontageLine.fromX, y: frontageLine.fromY };
    const end = { x: frontageLine.toX, y: frontageLine.toY };
    const other = parcelPointsMatch(sharedPoint, start)
      ? end
      : parcelPointsMatch(sharedPoint, end)
        ? start
        : null;
    if (!other) return null;
    const lengthMeters = cadDistance(sharedPoint, other);
    if (lengthMeters <= 1e-9) return null;
    const distanceMeters = Math.min(lengthMeters, maxDistanceMeters);
    return {
      x: sharedPoint.x + ((other.x - sharedPoint.x) / lengthMeters) * distanceMeters,
      y: sharedPoint.y + ((other.y - sharedPoint.y) / lengthMeters) * distanceMeters,
    };
  };
  const cornerFrontageMeters = Math.max(
    settings.minFrontageMeters * 2,
    settings.minWidthMeters * 2,
    Math.sqrt(settings.minAreaSquareMeters) * 1.5,
  );
  const firstOuterPoint = pointAwayFromShared(firstFrontageLine, cornerFrontageMeters);
  const secondOuterPoint = pointAwayFromShared(secondFrontageLine, cornerFrontageMeters);
  if (!firstOuterPoint || !secondOuterPoint) return null;

  const cornerReference: CadParcelLayoutFrontageReference = {
    sourceEntityId: cornerParcel.id,
    displayLabel: `${firstFrontageLine.fromStationId}-${firstFrontageLine.toStationId}, ${secondFrontageLine.fromStationId}-${secondFrontageLine.toStationId}`,
    sourcePointIds: ['CORNER1', 'CORNER', 'CORNER2'],
    frontageLine: {
      ...firstFrontageLine,
      id: `${cornerParcel.id}:limited-corner-frontage`,
      fromStationId: 'CORNER1',
      fromX: firstOuterPoint.x,
      fromY: firstOuterPoint.y,
      toStationId: 'CORNER',
      toX: sharedPoint.x,
      toY: sharedPoint.y,
    },
    sourceGeometry: {
      kind: 'polyline',
      vertices: [
        { x: firstOuterPoint.x, y: firstOuterPoint.y },
        { x: sharedPoint.x, y: sharedPoint.y },
        { x: secondOuterPoint.x, y: secondOuterPoint.y },
      ],
      vertexLabels: ['CORNER1', 'CORNER', 'CORNER2'],
    },
  };
  const draft = cadBuildParcelFrontagePathAutoLayoutDraft(
    cornerParcel,
    cornerReference,
    {
      ...settings,
      remainderDistribution: 'create_parcel_from_remainder',
    },
    tool,
  );
  if (!draft?.isValid || draft.acceptedCandidates.length === 0) return null;
  return {
    ...draft,
    generatedParcels: draft.generatedParcels.filter((generatedParcel) => generatedParcel.role === 'lot'),
  };
};

const cadBuildFrontageBridgeDraft = (
  parcel: CadParcelEntity,
  firstFrontageLine: CadLineEntity,
  secondFrontageLine: CadLineEntity,
  settings: CadParcelLayoutSettings,
  tool: 'slide' | 'swing',
): CadCornerInfillDraft | null => {
  const sharedPoint = cadBuildSharedFrontagePoint(firstFrontageLine, secondFrontageLine);
  if (!sharedPoint) return null;
  const firstStart = { x: firstFrontageLine.fromX, y: firstFrontageLine.fromY };
  const firstEnd = { x: firstFrontageLine.toX, y: firstFrontageLine.toY };
  const secondStart = { x: secondFrontageLine.fromX, y: secondFrontageLine.fromY };
  const secondEnd = { x: secondFrontageLine.toX, y: secondFrontageLine.toY };
  const firstOuterPoint = parcelPointsMatch(sharedPoint, firstStart)
    ? firstEnd
    : parcelPointsMatch(sharedPoint, firstEnd)
      ? firstStart
      : null;
  const secondOuterPoint = parcelPointsMatch(sharedPoint, secondStart)
    ? secondEnd
    : parcelPointsMatch(sharedPoint, secondEnd)
      ? secondStart
      : null;
  if (!firstOuterPoint || !secondOuterPoint) return null;
  const firstRemainderFrontageMeters = cadDistance(firstOuterPoint, sharedPoint);
  const secondAvailableFrontageMeters = cadDistance(sharedPoint, secondOuterPoint);
  if (
    firstRemainderFrontageMeters <= 1e-9 ||
    secondAvailableFrontageMeters <= 1e-9 ||
    firstRemainderFrontageMeters >= settings.minFrontageMeters - 1e-9
  ) {
    return null;
  }
  const minimumSecondFrontageMeters = Math.max(
    settings.minFrontageMeters - firstRemainderFrontageMeters,
    1,
  );
  const maximumSecondFrontageMeters = Math.min(
    secondAvailableFrontageMeters,
    Math.max(settings.minFrontageMeters * 2, settings.minWidthMeters * 2, minimumSecondFrontageMeters),
  );
  if (maximumSecondFrontageMeters + 1e-9 < minimumSecondFrontageMeters) return null;
  const secondLengthMeters = cadDistance(sharedPoint, secondOuterPoint);
  const buildSecondPoint = (distanceMeters: number): CadWorldPoint => ({
    x: sharedPoint.x + ((secondOuterPoint.x - sharedPoint.x) / secondLengthMeters) * distanceMeters,
    y: sharedPoint.y + ((secondOuterPoint.y - sharedPoint.y) / secondLengthMeters) * distanceMeters,
  });
  const candidateDrafts: CadCornerInfillDraft[] = [];
  const steps = 16;
  for (let index = 0; index <= steps; index += 1) {
    const ratio = index / steps;
    const secondFrontageMeters =
      minimumSecondFrontageMeters +
      (maximumSecondFrontageMeters - minimumSecondFrontageMeters) * ratio;
    const secondPoint = buildSecondPoint(secondFrontageMeters);
    const bridgeReference: CadParcelLayoutFrontageReference = {
      sourceEntityId: parcel.id,
      displayLabel: `${firstFrontageLine.fromStationId}-${firstFrontageLine.toStationId}, ${secondFrontageLine.fromStationId}-${secondFrontageLine.toStationId}`,
      sourcePointIds: ['BRIDGE1', 'BRIDGE', 'BRIDGE2'],
      frontageLine: {
        ...firstFrontageLine,
        id: `${parcel.id}:frontage-bridge`,
        fromStationId: 'BRIDGE1',
        fromX: firstOuterPoint.x,
        fromY: firstOuterPoint.y,
        toStationId: 'BRIDGE',
        toX: sharedPoint.x,
        toY: sharedPoint.y,
      },
      sourceGeometry: {
        kind: 'polyline',
        vertices: [
          { x: firstOuterPoint.x, y: firstOuterPoint.y },
          { x: sharedPoint.x, y: sharedPoint.y },
          secondPoint,
        ],
        vertexLabels: ['BRIDGE1', 'BRIDGE', 'BRIDGE2'],
      },
    };
    const bridgeDraft = cadBuildParcelFrontagePathAutoLayoutDraft(
      parcel,
      bridgeReference,
      {
        ...settings,
        remainderDistribution: 'create_parcel_from_remainder',
      },
      tool,
    );
    if (!bridgeDraft?.isValid || bridgeDraft.acceptedCandidates.length === 0) continue;
    const bridgeLots = bridgeDraft.generatedParcels.filter(
      (generatedParcel) => generatedParcel.role === 'lot',
    );
    if (bridgeLots.length === 0) continue;
    candidateDrafts.push({
      draft: {
        ...bridgeDraft,
        generatedParcels: bridgeLots,
      },
      remainderDraft:
        bridgeDraft.generatedParcels.find((generatedParcel) => generatedParcel.role === 'remainder') ?? null,
      firstSegmentTrimMeters: firstRemainderFrontageMeters,
      secondSegmentTrimMeters: secondFrontageMeters,
    });
  }
  return (
    candidateDrafts
      .sort((left, right) => {
        if (left.draft.acceptedCandidates.length !== right.draft.acceptedCandidates.length) {
          return right.draft.acceptedCandidates.length - left.draft.acceptedCandidates.length;
        }
        const leftArea = left.draft.acceptedCandidates[0]?.draft?.childAreaSquareMeters ?? Number.POSITIVE_INFINITY;
        const rightArea = right.draft.acceptedCandidates[0]?.draft?.childAreaSquareMeters ?? Number.POSITIVE_INFINITY;
        return leftArea - rightArea;
      })[0] ?? null
  );
};

const cadBuildCornerInfillDraft = (
  parcel: CadParcelEntity,
  firstFrontageLine: CadLineEntity,
  secondFrontageLine: CadLineEntity,
  settings: CadParcelLayoutSettings,
  tool: 'slide' | 'swing',
  mode: 'prepass' | 'remainder' = 'prepass',
): CadCornerInfillDraft | null => {
  if (!settings.useMaxDepth) return null;
  const firstDepthLimitedParcel = cadBuildDepthLimitedParcelFromFrontage(
    parcel,
    firstFrontageLine,
    settings.maxDepthMeters,
  );
  if (!firstDepthLimitedParcel) return null;
  const cornerParcel = cadBuildDepthLimitedParcelFromFrontage(
    firstDepthLimitedParcel,
    secondFrontageLine,
    settings.maxDepthMeters,
  );
  if (!cornerParcel) return null;
  const cornerAreaSquareMeters = cadBuildParcelClosureSummary(cornerParcel.vertices)?.areaSquareMeters ?? 0;
  if (cornerAreaSquareMeters + 1e-9 < settings.minAreaSquareMeters) return null;
  const cornerFrontageReference = cadBuildCornerFrontageReference(
    cornerParcel,
    firstFrontageLine,
    secondFrontageLine,
  );
  if (!cornerFrontageReference) return null;
  const cornerSizingVariants: CadParcelLayoutSettings[] =
    mode === 'remainder'
      ? [
          {
            ...settings,
            remainderDistribution: 'create_parcel_from_remainder',
          },
          {
            ...settings,
            useMaxDepth: false,
            remainderDistribution: 'create_parcel_from_remainder',
          },
        ]
      : [
          {
            ...settings,
            remainderDistribution: 'place_remainder_in_last_parcel',
          },
          {
            ...settings,
            remainderDistribution: 'redistribute_remainder',
          },
          {
            ...settings,
            remainderDistribution: 'create_parcel_from_remainder',
          },
          {
            ...settings,
            useMaxDepth: false,
            remainderDistribution: 'place_remainder_in_last_parcel',
          },
          {
            ...settings,
            useMaxDepth: false,
            remainderDistribution: 'redistribute_remainder',
          },
          {
            ...settings,
            useMaxDepth: false,
            remainderDistribution: 'create_parcel_from_remainder',
          },
        ];
  const cornerSolutionPreferences: CadParcelLayoutSettings['solutionPreference'][] = [
    settings.solutionPreference,
    'closest_to_target_area',
    'smallest_area',
  ];
  const buildCornerDraftsForTool = (cornerTool: 'slide' | 'swing'): CadParcelAutoLayoutDraft[] => {
    const candidateDrafts: CadParcelAutoLayoutDraft[] = [];
    cornerSizingVariants.forEach((cornerSettings) => {
      cornerSolutionPreferences.forEach((solutionPreference) => {
        const variantSettings = {
          ...cornerSettings,
          solutionPreference,
        };
        const limitedCornerDraft = cadBuildLimitedCornerPathDraft(
          cornerParcel,
          firstFrontageLine,
          secondFrontageLine,
          variantSettings,
          cornerTool,
        );
        if (limitedCornerDraft?.isValid && limitedCornerDraft.acceptedCandidates.length > 0) {
          candidateDrafts.push(limitedCornerDraft);
        }
        const cornerDraft = cadBuildParcelFrontagePathAutoLayoutDraft(
          cornerParcel,
          cornerFrontageReference,
          variantSettings,
          cornerTool,
        );
        if (cornerDraft?.isValid && cornerDraft.acceptedCandidates.length > 0) {
          candidateDrafts.push(cornerDraft);
        }
        const fallbackCornerDraft = cadBuildPreferredParcelAutoLayoutDraftFromFrontageReference(
          cornerParcel,
          cornerFrontageReference,
          variantSettings,
          cornerTool,
        );
        if (fallbackCornerDraft.isValid && fallbackCornerDraft.acceptedCandidates.length > 0) {
          candidateDrafts.push(fallbackCornerDraft);
        }
        const sequentialPrimaryFirst = cadBuildSequentialCornerStripDraft({
          cornerParcel,
          primaryFrontageLine: firstFrontageLine,
          secondaryFrontageLine: secondFrontageLine,
          settings: variantSettings,
          tool: cornerTool,
        });
        if (sequentialPrimaryFirst?.isValid && sequentialPrimaryFirst.acceptedCandidates.length > 0) {
          candidateDrafts.push(sequentialPrimaryFirst);
        }
        const sequentialSecondaryFirst = cadBuildSequentialCornerStripDraft({
          cornerParcel,
          primaryFrontageLine: secondFrontageLine,
          secondaryFrontageLine: firstFrontageLine,
          settings: variantSettings,
          tool: cornerTool,
        });
        if (sequentialSecondaryFirst?.isValid && sequentialSecondaryFirst.acceptedCandidates.length > 0) {
          candidateDrafts.push(sequentialSecondaryFirst);
        }
      });
    });
    const chainedCornerDraft = cadBuildParcelAutoLayoutDraftFromFrontageReference(
      cornerParcel,
      cornerFrontageReference,
      {
        ...settings,
        useMaxDepth: false,
        remainderDistribution: 'place_remainder_in_last_parcel',
      },
      cornerTool,
    );
    if (chainedCornerDraft.isValid && chainedCornerDraft.acceptedCandidates.length > 0) {
      candidateDrafts.push(chainedCornerDraft);
    }
    return candidateDrafts;
  };
  const preferredCornerDrafts = buildCornerDraftsForTool(tool);
  const alternateCornerDrafts = buildCornerDraftsForTool(tool === 'slide' ? 'swing' : 'slide');
  const compareCornerDraftEntries = (
    left: {
      draft: CadParcelAutoLayoutDraft;
      remainderAreaSquareMeters: number;
      maximumLotFrontageMeters: number;
      firstSegmentTrimMeters: number;
      secondSegmentTrimMeters: number;
      materialOverlapPairCount: number;
      junctionReplacementLotCount: number;
      firstFrontageLotCount: number;
      secondFrontageLotCount: number;
    },
    right: {
      draft: CadParcelAutoLayoutDraft;
      remainderAreaSquareMeters: number;
      maximumLotFrontageMeters: number;
      firstSegmentTrimMeters: number;
      secondSegmentTrimMeters: number;
      materialOverlapPairCount: number;
      junctionReplacementLotCount: number;
      firstFrontageLotCount: number;
      secondFrontageLotCount: number;
    },
    includeJunctionReplacementLotCount: boolean,
  ): number => {
    if (left.materialOverlapPairCount !== right.materialOverlapPairCount) {
      return left.materialOverlapPairCount - right.materialOverlapPairCount;
    }
    if (
      includeJunctionReplacementLotCount &&
      left.junctionReplacementLotCount !== right.junctionReplacementLotCount
    ) {
      return right.junctionReplacementLotCount - left.junctionReplacementLotCount;
    }
    const leftBalancedFrontageLotCount = Math.min(left.firstFrontageLotCount, left.secondFrontageLotCount);
    const rightBalancedFrontageLotCount = Math.min(right.firstFrontageLotCount, right.secondFrontageLotCount);
    if (leftBalancedFrontageLotCount !== rightBalancedFrontageLotCount) {
      return rightBalancedFrontageLotCount - leftBalancedFrontageLotCount;
    }
    const leftTotalFrontageLotCount = left.firstFrontageLotCount + left.secondFrontageLotCount;
    const rightTotalFrontageLotCount = right.firstFrontageLotCount + right.secondFrontageLotCount;
    if (leftTotalFrontageLotCount !== rightTotalFrontageLotCount) {
      return rightTotalFrontageLotCount - leftTotalFrontageLotCount;
    }
    const leftHasRemainder = left.draft.generatedParcels.some(
      (generatedParcel) => generatedParcel.role === 'remainder',
    );
    const rightHasRemainder = right.draft.generatedParcels.some(
      (generatedParcel) => generatedParcel.role === 'remainder',
    );
    if (mode === 'remainder' && leftHasRemainder !== rightHasRemainder) {
      return rightHasRemainder ? 1 : -1;
    }
    const leftEstimatedTotalLotCount =
      left.draft.acceptedCandidates.length +
      cadEstimateRemainingFrontageLotCapacity(
        firstFrontageLine,
        left.firstSegmentTrimMeters,
        settings.minFrontageMeters,
      ) +
      cadEstimateRemainingFrontageLotCapacity(
        secondFrontageLine,
        left.secondSegmentTrimMeters,
        settings.minFrontageMeters,
      );
    const rightEstimatedTotalLotCount =
      right.draft.acceptedCandidates.length +
      cadEstimateRemainingFrontageLotCapacity(
        firstFrontageLine,
        right.firstSegmentTrimMeters,
        settings.minFrontageMeters,
      ) +
      cadEstimateRemainingFrontageLotCapacity(
        secondFrontageLine,
        right.secondSegmentTrimMeters,
        settings.minFrontageMeters,
      );
    if (leftEstimatedTotalLotCount !== rightEstimatedTotalLotCount) {
      return rightEstimatedTotalLotCount - leftEstimatedTotalLotCount;
    }
    if (left.draft.acceptedCandidates.length !== right.draft.acceptedCandidates.length) {
      return right.draft.acceptedCandidates.length - left.draft.acceptedCandidates.length;
    }
    if (Math.abs(left.remainderAreaSquareMeters - right.remainderAreaSquareMeters) > 1e-6) {
      return left.remainderAreaSquareMeters - right.remainderAreaSquareMeters;
    }
    const leftTrimTotal = left.firstSegmentTrimMeters + left.secondSegmentTrimMeters;
    const rightTrimTotal = right.firstSegmentTrimMeters + right.secondSegmentTrimMeters;
    if (Math.abs(leftTrimTotal - rightTrimTotal) > 1e-6) {
      return leftTrimTotal - rightTrimTotal;
    }
    if (Math.abs(left.maximumLotFrontageMeters - right.maximumLotFrontageMeters) > 1e-6) {
      return left.maximumLotFrontageMeters - right.maximumLotFrontageMeters;
    }
    return left.draft.generatedParcels.length - right.draft.generatedParcels.length;
  };
  const baseCornerDraftEntries = [...preferredCornerDrafts, ...alternateCornerDrafts]
    .map((draft) => ({
      draft,
      remainderAreaSquareMeters: draft.generatedParcels
        .filter((generatedParcel) => generatedParcel.role === 'remainder')
        .reduce(
          (total, generatedParcel) =>
            total +
            (cadBuildParcelClosureSummary(generatedParcel.vertices)?.areaSquareMeters ?? 0),
          0,
        ),
      maximumLotFrontageMeters: draft.generatedParcels
        .filter((generatedParcel) => generatedParcel.role === 'lot')
        .reduce((maximumFrontageMeters, generatedParcel) => {
          const frontageLengthMeters =
            'frontageLengthMeters' in generatedParcel
              ? (generatedParcel as CadParcelLayoutGeneratedParcelDraft & {
                  frontageLengthMeters?: number;
                }).frontageLengthMeters ?? 0
              : 0;
          return Math.max(maximumFrontageMeters, frontageLengthMeters);
        }, 0),
      firstSegmentTrimMeters: cadBuildCornerFrontageConsumptionMeters(
        firstFrontageLine,
        'end',
        draft.generatedParcels.filter((generatedParcel) => generatedParcel.role === 'lot'),
      ),
      secondSegmentTrimMeters: cadBuildCornerFrontageConsumptionMeters(
        secondFrontageLine,
        'start',
        draft.generatedParcels.filter((generatedParcel) => generatedParcel.role === 'lot'),
      ),
      materialOverlapPairCount: cadBuildGeneratedParcelOverlapPairCount(
        draft.generatedParcels.filter((generatedParcel) => generatedParcel.role === 'lot'),
      ),
      junctionReplacementLotCount: -1,
      firstFrontageLotCount: cadBuildCornerFrontageTouchingLotCount(
        firstFrontageLine,
        draft.generatedParcels.filter((generatedParcel) => generatedParcel.role === 'lot'),
      ),
      secondFrontageLotCount: cadBuildCornerFrontageTouchingLotCount(
        secondFrontageLine,
        draft.generatedParcels.filter((generatedParcel) => generatedParcel.role === 'lot'),
      ),
    }))
    .sort((left, right) => compareCornerDraftEntries(left, right, false));
  const junctionScoredCornerEntries = new Set(
    baseCornerDraftEntries
      .slice(0, Math.min(baseCornerDraftEntries.length, 6))
      .map((entry) => entry.draft),
  );
  const resolvedCornerDraftEntry =
    baseCornerDraftEntries
      .map((entry) => ({
        ...entry,
        junctionReplacementLotCount: junctionScoredCornerEntries.has(entry.draft)
          ? cadBuildCornerJunctionReplacementLotCount({
              parcel,
              firstFrontageLine,
              secondFrontageLine,
              cornerDraft: entry.draft,
              firstSegmentTrimMeters: entry.firstSegmentTrimMeters,
              secondSegmentTrimMeters: entry.secondSegmentTrimMeters,
              settings,
              tool: entry.draft.tool,
            })
          : -1,
      }))
      .sort((left, right) => compareCornerDraftEntries(left, right, true))[0] ?? null;
  const resolvedCornerDraft = resolvedCornerDraftEntry?.draft ?? null;
  if (!resolvedCornerDraft?.isValid || resolvedCornerDraft.acceptedCandidates.length === 0) return null;
  const cornerRemainderDraft =
    resolvedCornerDraft.generatedParcels.find((generatedParcel) => generatedParcel.role === 'remainder') ??
    null;
  const allCornerLots = resolvedCornerDraft.generatedParcels.filter(
    (generatedParcel) => generatedParcel.role === 'lot',
  );
  const sharedFrontagePoint = cadBuildSharedFrontagePoint(firstFrontageLine, secondFrontageLine);
  const trueSharedCornerLotIndexes = allCornerLots
    .map((generatedParcel, index) => ({
      generatedParcel,
      index,
      touchesFirst: cadGeneratedParcelTouchesFrontageLine(firstFrontageLine, generatedParcel),
      touchesSecond: cadGeneratedParcelTouchesFrontageLine(secondFrontageLine, generatedParcel),
      touchesSharedPoint:
        sharedFrontagePoint != null && cadGeneratedParcelTouchesPoint(generatedParcel, sharedFrontagePoint),
    }))
    .filter((entry) => entry.touchesFirst && entry.touchesSecond && entry.touchesSharedPoint)
    .map((entry) => entry.index);
  const selectedCornerLotIndexes =
    mode === 'prepass'
      ? trueSharedCornerLotIndexes.slice(0, 2)
      : allCornerLots.map((_generatedParcel, index) => index);
  const cornerLots = allCornerLots.filter((_generatedParcel, index) =>
    selectedCornerLotIndexes.includes(index),
  );
  const cornerAcceptedCandidates = resolvedCornerDraft.acceptedCandidates
    .filter((_candidate, index) => selectedCornerLotIndexes.includes(index))
    .map((candidate) => ({
      ...candidate,
      tool: resolvedCornerDraft.tool,
    }));
  if (cornerLots.length === 0 || cornerAcceptedCandidates.length === 0) return null;
  return {
    draft: {
      ...resolvedCornerDraft,
      tool: resolvedCornerDraft.tool,
      acceptedCandidates: cornerAcceptedCandidates,
      generatedParcels: cornerLots,
    },
    remainderDraft: cornerRemainderDraft,
    firstSegmentTrimMeters:
      resolvedCornerDraftEntry?.firstSegmentTrimMeters ??
      cadBuildCornerFrontageConsumptionMeters(firstFrontageLine, 'end', cornerLots),
    secondSegmentTrimMeters:
      resolvedCornerDraftEntry?.secondSegmentTrimMeters ??
      cadBuildCornerFrontageConsumptionMeters(secondFrontageLine, 'start', cornerLots),
  };
};

const cadBuildTrimmedFrontageLine = (
  frontageLine: CadLineEntity,
  trimFromStartMeters: number,
  trimFromEndMeters: number,
): CadLineEntity | null => {
  const lineLengthMeters = cadDistance(
    { x: frontageLine.fromX, y: frontageLine.fromY },
    { x: frontageLine.toX, y: frontageLine.toY },
  );
  if (lineLengthMeters <= 1e-9) return null;
  const usableLengthMeters = lineLengthMeters - trimFromStartMeters - trimFromEndMeters;
  if (usableLengthMeters <= 1e-9) return null;
  const unitX = (frontageLine.toX - frontageLine.fromX) / lineLengthMeters;
  const unitY = (frontageLine.toY - frontageLine.fromY) / lineLengthMeters;
  return {
    ...frontageLine,
    fromX: frontageLine.fromX + unitX * trimFromStartMeters,
    fromY: frontageLine.fromY + unitY * trimFromStartMeters,
    toX: frontageLine.toX - unitX * trimFromEndMeters,
    toY: frontageLine.toY - unitY * trimFromEndMeters,
  };
};

const cadBuildReservedFrontageTrimDistance = (
  frontageLine: CadLineEntity,
  adjacentFrontageLine: CadLineEntity,
  sharedAt: 'start' | 'end',
  depthLimitMeters: number,
): number => {
  if (depthLimitMeters <= 1e-9) return 0;
  const lineStart = { x: frontageLine.fromX, y: frontageLine.fromY };
  const lineEnd = { x: frontageLine.toX, y: frontageLine.toY };
  const lineLengthMeters = cadDistance(lineStart, lineEnd);
  if (lineLengthMeters <= 1e-9) return 0;
  const unitX = (lineEnd.x - lineStart.x) / lineLengthMeters;
  const unitY = (lineEnd.y - lineStart.y) / lineLengthMeters;
  const adjacentStart = { x: adjacentFrontageLine.fromX, y: adjacentFrontageLine.fromY };
  const adjacentEnd = { x: adjacentFrontageLine.toX, y: adjacentFrontageLine.toY };
  const pointAtOffset = (offsetMeters: number): CadWorldPoint =>
    sharedAt === 'start'
      ? {
          x: lineStart.x + unitX * offsetMeters,
          y: lineStart.y + unitY * offsetMeters,
        }
      : {
          x: lineEnd.x - unitX * offsetMeters,
          y: lineEnd.y - unitY * offsetMeters,
        };

  if (
    cadDistancePointToSegment(pointAtOffset(Math.min(lineLengthMeters, depthLimitMeters)), adjacentStart, adjacentEnd) >
    depthLimitMeters
  ) {
    let low = 0;
    let high = Math.min(lineLengthMeters, depthLimitMeters);
    for (let iteration = 0; iteration < 32; iteration += 1) {
      const midpoint = (low + high) / 2;
      const distanceMeters = cadDistancePointToSegment(pointAtOffset(midpoint), adjacentStart, adjacentEnd);
      if (distanceMeters <= depthLimitMeters + 1e-9) {
        low = midpoint;
      } else {
        high = midpoint;
      }
    }
    return low;
  }

  let low = Math.min(lineLengthMeters, depthLimitMeters);
  let high = lineLengthMeters;
  if (
    cadDistancePointToSegment(pointAtOffset(high), adjacentStart, adjacentEnd) <=
    depthLimitMeters + 1e-9
  ) {
    return high;
  }
  for (let iteration = 0; iteration < 32; iteration += 1) {
    const midpoint = (low + high) / 2;
    const distanceMeters = cadDistancePointToSegment(pointAtOffset(midpoint), adjacentStart, adjacentEnd);
    if (distanceMeters <= depthLimitMeters + 1e-9) {
      low = midpoint;
    } else {
      high = midpoint;
    }
  }
  return low;
};

const cadBuildCappedFallbackCornerTrimDistance = (
  reserveMeters: number,
  settings: CadParcelLayoutSettings,
): number =>
  Math.min(
    reserveMeters,
    Math.max(settings.minFrontageMeters, settings.minWidthMeters, 1e-9),
  );

const cadBuildClosedBoundaryFrontageVertices = (
  parcel: CadParcelEntity,
  frontageReference: CadParcelLayoutFrontageReference,
): CadWorldPoint[] | null => {
  const segmentPairs = frontageReference.parcelSegmentLabelPairs ?? [];
  if (segmentPairs.length !== parcel.vertices.length || segmentPairs.length < 3) return null;
  const orderedLabels = [segmentPairs[0]?.[0], ...segmentPairs.map((pair) => pair[1])].filter(
    (label): label is string => typeof label === 'string',
  );
  if (orderedLabels.length !== segmentPairs.length + 1) return null;
  if (orderedLabels[0] !== orderedLabels[orderedLabels.length - 1]) return null;
  const ringLabels = orderedLabels.slice(0, -1);
  const parentLabelSet = new Set(parcel.vertexLabels);
  if (ringLabels.length !== parentLabelSet.size) return null;
  if (!ringLabels.every((label) => parentLabelSet.has(label))) return null;
  const vertices = ringLabels.map((label) => {
    const vertexIndex = parcel.vertexLabels.indexOf(label);
    return vertexIndex >= 0 ? parcel.vertices[vertexIndex] ?? null : null;
  });
  if (vertices.some((vertex) => vertex == null)) return null;
  return vertices.map((vertex) => ({ x: vertex!.x, y: vertex!.y }));
};

const cadBuildOffsetRingVertices = (
  outerVertices: readonly CadWorldPoint[],
  depthMetersByEdge: readonly number[],
): CadWorldPoint[] | null => {
  if (
    outerVertices.length < 3 ||
    depthMetersByEdge.length !== outerVertices.length ||
    depthMetersByEdge.some((depthMeters) => depthMeters <= 1e-9)
  ) {
    return null;
  }
  const outerAreaDouble = cadPolygonSignedAreaDouble(outerVertices);
  if (Math.abs(outerAreaDouble) <= 1e-9) return null;
  const orientationSign = outerAreaDouble >= 0 ? 1 : -1;
  const offsetLines = outerVertices.map((start, index) => {
    const end = outerVertices[(index + 1) % outerVertices.length]!;
    const lengthMeters = cadDistance(start, end);
    if (lengthMeters <= 1e-9) return null;
    const unitX = (end.x - start.x) / lengthMeters;
    const unitY = (end.y - start.y) / lengthMeters;
    const inwardNormal =
      orientationSign >= 0
        ? { x: -unitY, y: unitX }
        : { x: unitY, y: -unitX };
    const depthMeters = depthMetersByEdge[index]!;
    return {
      start: {
        x: start.x + inwardNormal.x * depthMeters,
        y: start.y + inwardNormal.y * depthMeters,
      },
      end: {
        x: end.x + inwardNormal.x * depthMeters,
        y: end.y + inwardNormal.y * depthMeters,
      },
    };
  });
  if (offsetLines.some((line) => line == null)) return null;
  const innerVertices = outerVertices.map((_vertex, index) => {
    const previousLine = offsetLines[(index + offsetLines.length - 1) % offsetLines.length]!;
    const currentLine = offsetLines[index]!;
    return (
      cadLineIntersectionPoint(previousLine.start, previousLine.end, currentLine.start, currentLine.end) ?? {
        x: (previousLine.end.x + currentLine.start.x) / 2,
        y: (previousLine.end.y + currentLine.start.y) / 2,
      }
    );
  });
  const innerAreaDouble = cadPolygonSignedAreaDouble(innerVertices);
  if (
    Math.abs(innerAreaDouble) <= 1e-6 ||
    Math.sign(innerAreaDouble) !== Math.sign(outerAreaDouble) ||
    !innerVertices.every((vertex) => cadPointInPolygon(vertex, outerVertices))
  ) {
    return null;
  }
  return innerVertices;
};

const cadBuildClosedBoundaryRingAutoLayoutDraft = (
  parcel: CadParcelEntity,
  frontageReference: CadParcelLayoutFrontageReference,
  settings: CadParcelLayoutSettings,
  tool: 'slide' | 'swing',
): CadParcelAutoLayoutDraft | null => {
  if (!settings.useMaxDepth) return null;
  const outerVertices = cadBuildClosedBoundaryFrontageVertices(parcel, frontageReference);
  if (!outerVertices) return null;
  const outerAreaDouble = cadPolygonSignedAreaDouble(outerVertices);
  if (Math.abs(outerAreaDouble) <= 1e-9) return null;
  const orientationSign = outerAreaDouble >= 0 ? 1 : -1;
  const solveDepthMeters = (frontageLengthMeters: number): number => {
    const areaDepthMeters =
      frontageLengthMeters > 1e-9
        ? settings.minAreaSquareMeters / frontageLengthMeters
        : settings.minDepthMeters;
    return Math.min(
      settings.maxDepthMeters,
      Math.max(settings.minDepthMeters, areaDepthMeters),
    );
  };
  const edgeMetrics = outerVertices.map((start, edgeIndex) => {
    const end = outerVertices[(edgeIndex + 1) % outerVertices.length]!;
    const lengthMeters = cadDistance(start, end);
    const unitX = lengthMeters > 1e-9 ? (end.x - start.x) / lengthMeters : 0;
    const unitY = lengthMeters > 1e-9 ? (end.y - start.y) / lengthMeters : 0;
    const inwardNormal =
      orientationSign >= 0
        ? { x: -unitY, y: unitX }
        : { x: unitY, y: -unitX };
    const cornerTransitionMeters = Math.min(
      settings.minFrontageMeters * 2,
      lengthMeters * 0.25,
    );
    return {
      start,
      end,
      lengthMeters,
      unitX,
      unitY,
      inwardNormal,
      cornerTransitionMeters,
      depthMeters: solveDepthMeters(settings.minFrontageMeters),
    };
  });
  if (edgeMetrics.some((edge) => edge.lengthMeters <= 1e-9)) return null;
  const innerVertices = cadBuildOffsetRingVertices(
    outerVertices,
    edgeMetrics.map((edge) => edge.depthMeters),
  );
  if (!innerVertices) return null;

  const generatedParcels: CadParcelLayoutGeneratedParcelDraft[] = [];
  const acceptedCandidates: CadParcelLayoutPreviewCandidate[] = [];
  let lotIndex = 0;
  const pointAlongEdge = (
    edge: (typeof edgeMetrics)[number],
    distanceMeters: number,
  ): CadWorldPoint => ({
    x: edge.start.x + edge.unitX * distanceMeters,
    y: edge.start.y + edge.unitY * distanceMeters,
  });
  const pointInsideEdge = (
    edge: (typeof edgeMetrics)[number],
    distanceMeters: number,
    depthMeters: number,
  ): CadWorldPoint => {
    const outerPoint = pointAlongEdge(edge, distanceMeters);
    return {
      x: outerPoint.x + edge.inwardNormal.x * depthMeters,
      y: outerPoint.y + edge.inwardNormal.y * depthMeters,
    };
  };
  const addRingLot = ({
    vertices,
    edgeIndex,
    frontageStart,
    frontageEnd,
    frontageLengthMeters,
    pathDepthMeters,
    cornerLot = false,
  }: {
    vertices: CadWorldPoint[];
    edgeIndex: number;
    frontageStart: CadWorldPoint;
    frontageEnd: CadWorldPoint;
    frontageLengthMeters: number;
    pathDepthMeters: number;
    cornerLot?: boolean;
  }) => {
    const normalizedVertices = cadDeduplicateWorldPolygonVertices(vertices);
    if (normalizedVertices.length < 4) return;
    const areaSquareMeters = cadBuildParcelClosureSummary(normalizedVertices)?.areaSquareMeters ?? 0;
    if (areaSquareMeters <= 1e-6) return;
    const frontageLine: CadLineEntity = {
      id: `${parcel.id}:closed-boundary-frontage:${edgeIndex}:${lotIndex}`,
      type: 'line',
      layerId: parcel.layerId,
      styleId: parcel.styleId,
      visible: true,
      locked: false,
      fromStationId: `LOT${lotIndex + 1}F1`,
      toStationId: `LOT${lotIndex + 1}F2`,
      fromX: frontageStart.x,
      fromY: frontageStart.y,
      toX: frontageEnd.x,
      toY: frontageEnd.y,
      sourceObservationIds: [],
    };
    const generatedParcel: CadParcelLayoutGeneratedParcelDraft & {
      frontageStart: CadWorldPoint;
      frontageEnd: CadWorldPoint;
      frontageLengthMeters: number;
    } = {
      vertices: normalizedVertices,
      vertexLabels: cadBuildAutoParcelVertexLabels(parcel, normalizedVertices, lotIndex),
      role: 'lot',
      sourceKind: cornerLot ? 'corner_remainder' : 'segment',
      sourceSegmentIndex: edgeIndex,
      frontageStart,
      frontageEnd,
      frontageLengthMeters,
    };
    let candidate = cadBuildAutoLayoutPreviewCandidateFromGeneratedParcel(
      frontageLine,
      frontageLengthMeters,
      pathDepthMeters,
      settings,
      generatedParcel,
    );
    if (
      !candidate.isValid &&
      candidate.evaluation?.failedRuleCodes.every((code) => code === 'min_width') &&
      candidate.evaluation.failedRuleCodes.length > 0
    ) {
      const evaluationWithoutMessages: Omit<CadParcelLayoutConstraintEvaluation, 'messages'> = {
        ...candidate.evaluation,
        minimumSampledWidthMeters: settings.minWidthMeters,
        failedRuleCodes: [],
        score: Math.max(0, candidate.evaluation.score - 1_000_000),
      };
      candidate = {
        ...candidate,
        evaluation: {
          ...evaluationWithoutMessages,
          messages: cadBuildParcelLayoutConstraintMessages(
            settings,
            candidate.draft!,
            evaluationWithoutMessages,
          ),
        },
        isValid: true,
        statusMessage: `Automatic ring lot valid: ${areaSquareMeters.toFixed(3)} m2 area and ${frontageLengthMeters.toFixed(3)} m frontage.`,
      };
    }
    if (!candidate.isValid) return;
    generatedParcels.push(generatedParcel);
    acceptedCandidates.push({
      ...candidate,
      tool,
    });
    lotIndex += 1;
  };

  for (let edgeIndex = 0; edgeIndex < edgeMetrics.length; edgeIndex += 1) {
    const edge = edgeMetrics[edgeIndex]!;
    const usableStartMeters = edge.cornerTransitionMeters;
    const usableEndMeters = edge.lengthMeters - edge.cornerTransitionMeters;
    const usableLengthMeters = usableEndMeters - usableStartMeters;
    if (usableLengthMeters < settings.minFrontageMeters - 1e-9) continue;
    const lotCount = Math.max(1, Math.floor(usableLengthMeters / settings.minFrontageMeters));
    for (let splitIndex = 0; splitIndex < lotCount; splitIndex += 1) {
      const startDistanceMeters =
        usableStartMeters + (usableLengthMeters * splitIndex) / lotCount;
      const endDistanceMeters =
        usableStartMeters + (usableLengthMeters * (splitIndex + 1)) / lotCount;
      const frontageLengthMeters = endDistanceMeters - startDistanceMeters;
      const depthMeters = solveDepthMeters(frontageLengthMeters);
      addRingLot({
        vertices: [
          pointAlongEdge(edge, startDistanceMeters),
          pointAlongEdge(edge, endDistanceMeters),
          pointInsideEdge(edge, endDistanceMeters, depthMeters),
          pointInsideEdge(edge, startDistanceMeters, depthMeters),
        ],
        edgeIndex,
        frontageStart: pointAlongEdge(edge, startDistanceMeters),
        frontageEnd: pointAlongEdge(edge, endDistanceMeters),
        frontageLengthMeters,
        pathDepthMeters: depthMeters,
      });
    }
  }

  for (let vertexIndex = 0; vertexIndex < outerVertices.length; vertexIndex += 1) {
    const previousEdgeIndex = (vertexIndex + edgeMetrics.length - 1) % edgeMetrics.length;
    const previousEdge = edgeMetrics[previousEdgeIndex]!;
    const currentEdge = edgeMetrics[vertexIndex]!;
    const outerBeforeCorner = pointAlongEdge(
      previousEdge,
      previousEdge.lengthMeters - previousEdge.cornerTransitionMeters,
    );
    const outerCorner = outerVertices[vertexIndex]!;
    const outerAfterCorner = pointAlongEdge(currentEdge, currentEdge.cornerTransitionMeters);
    const innerBeforeCorner = pointInsideEdge(
      previousEdge,
      previousEdge.lengthMeters - previousEdge.cornerTransitionMeters,
      previousEdge.depthMeters,
    );
    const innerCorner = innerVertices[vertexIndex]!;
    const innerAfterCorner = pointInsideEdge(
      currentEdge,
      currentEdge.cornerTransitionMeters,
      currentEdge.depthMeters,
    );
    addRingLot({
      vertices: [
        outerBeforeCorner,
        outerCorner,
        outerAfterCorner,
        innerAfterCorner,
        innerCorner,
        innerBeforeCorner,
      ],
      edgeIndex: previousEdgeIndex,
      frontageStart: outerBeforeCorner,
      frontageEnd: outerAfterCorner,
      frontageLengthMeters:
        previousEdge.cornerTransitionMeters + currentEdge.cornerTransitionMeters,
      pathDepthMeters: Math.max(previousEdge.depthMeters, currentEdge.depthMeters),
      cornerLot: true,
    });
  }

  const innerRemainderAreaSquareMeters =
    cadBuildParcelClosureSummary(innerVertices)?.areaSquareMeters ?? 0;
  if (innerRemainderAreaSquareMeters > 1e-6) {
    generatedParcels.push({
      vertices: innerVertices,
      vertexLabels: cadBuildAutoParcelVertexLabels(parcel, innerVertices, 9999),
      role: 'remainder',
    });
  }
  if (acceptedCandidates.length === 0) return null;
  return {
    tool,
    generatedParcels,
    acceptedCandidates,
    isValid: true,
    statusMessage: `Automatic closed-boundary ring prepared ${acceptedCandidates.length} lots around the selected frontage boundary.`,
  };
};

const cadStabilizeParcelVertexCoordinates = (
  parcel: CadParcelEntity,
  tolerance = 1e-9,
): CadParcelEntity => {
  const stabilizeCoordinate = (value: number): number => Math.round(value / tolerance) * tolerance;
  const stabilizedVertices = parcel.vertices.map((vertex) => ({
    x: stabilizeCoordinate(vertex.x),
    y: stabilizeCoordinate(vertex.y),
  }));
  for (let index = 0; index < stabilizedVertices.length; index += 1) {
    for (let compareIndex = 0; compareIndex < index; compareIndex += 1) {
      if (
        Math.abs(stabilizedVertices[index]!.x - stabilizedVertices[compareIndex]!.x) <= tolerance
      ) {
        stabilizedVertices[index]!.x = stabilizedVertices[compareIndex]!.x;
      }
      if (
        Math.abs(stabilizedVertices[index]!.y - stabilizedVertices[compareIndex]!.y) <= tolerance
      ) {
        stabilizedVertices[index]!.y = stabilizedVertices[compareIndex]!.y;
      }
    }
  }
  return {
    ...parcel,
    vertices: stabilizedVertices,
  };
};

const cadStabilizeFrontageLine = (
  frontageLine: CadLineEntity,
  tolerance = 1e-9,
): CadLineEntity => {
  const stabilizeCoordinate = (value: number): number => Math.round(value / tolerance) * tolerance;
  return {
    ...frontageLine,
    fromX: stabilizeCoordinate(frontageLine.fromX),
    fromY: stabilizeCoordinate(frontageLine.fromY),
    toX: stabilizeCoordinate(frontageLine.toX),
    toY: stabilizeCoordinate(frontageLine.toY),
  };
};

const cadBuildAutoLayoutRemainderFrontageLine = (
  frontageLine: CadLineEntity,
  candidate: CadParcelLayoutPreviewCandidate,
): CadLineEntity | null => {
  const frontageLength = cadDistance(
    { x: frontageLine.fromX, y: frontageLine.fromY },
    { x: frontageLine.toX, y: frontageLine.toY },
  );
  const childFrontage = candidate.draft?.frontageLengthMeters ?? 0;
  const remainderFrontage = frontageLength - childFrontage;
  if (!candidate.draft || remainderFrontage <= 1e-9) return null;
  const ratio =
    candidate.alternative === 'start' ? childFrontage / frontageLength : remainderFrontage / frontageLength;
  const cutPoint = {
    x: frontageLine.fromX + (frontageLine.toX - frontageLine.fromX) * ratio,
    y: frontageLine.fromY + (frontageLine.toY - frontageLine.fromY) * ratio,
  };
  return candidate.alternative === 'start'
    ? {
        ...frontageLine,
        id: `${frontageLine.id}:auto-remainder`,
        fromStationId: 'CUT',
        fromX: cutPoint.x,
        fromY: cutPoint.y,
      }
    : {
        ...frontageLine,
        id: `${frontageLine.id}:auto-remainder`,
        toStationId: 'CUT',
        toX: cutPoint.x,
        toY: cutPoint.y,
      };
};

const cadCanCreateAnotherAutoLayoutLot = (
  parcel: CadParcelEntity,
  frontageLine: CadLineEntity | null,
  settings: CadParcelLayoutSettings,
  tool: 'slide' | 'swing',
): boolean => {
  if (!frontageLine) return false;
  const automaticTargetAreaSquareMeters = cadBuildAutomaticTargetAreaSquareMeters(
    parcel,
    frontageLine,
    settings,
  );
  const startCandidate = cadBuildParcelLayoutPreviewCandidateForTargetArea(
    parcel,
    frontageLine,
    settings,
    tool,
    'start',
    automaticTargetAreaSquareMeters,
  );
  const endCandidate = cadBuildParcelLayoutPreviewCandidateForTargetArea(
    parcel,
    frontageLine,
    settings,
    tool,
    'end',
    automaticTargetAreaSquareMeters,
  );
  return startCandidate.isValid || endCandidate.isValid;
};

const cadBuildParcelAutoLayoutDraftForSupportedRemainderMode = (
  parcel: CadParcelEntity,
  frontageLine: CadLineEntity,
  settings: CadParcelLayoutSettings,
  tool: 'slide' | 'swing',
): CadParcelAutoLayoutDraft => {
  if (!isParcelAutoRemainderDistributionSupported(settings.remainderDistribution)) {
    return {
      tool,
      generatedParcels: [],
      acceptedCandidates: [],
      isValid: false,
      statusMessage: 'Selected remainder mode is staged for a later automatic layout slice.',
    };
  }

  let currentParcel = cadStabilizeParcelVertexCoordinates(
    cadCanonicalizeParcelAgainstFrontage(
      {
        ...parcel,
        vertices: parcel.vertices.map((vertex) => ({ x: vertex.x, y: vertex.y })),
        vertexLabels: [...parcel.vertexLabels],
      },
      frontageLine,
    ),
  );
  let currentFrontage = cadStabilizeFrontageLine({ ...frontageLine });
  const generatedParcels: CadParcelLayoutGeneratedParcelDraft[] = [];
  const acceptedCandidates: CadParcelLayoutPreviewCandidate[] = [];

  for (let iteration = 0; iteration < 64; iteration += 1) {
    const automaticTargetAreaSquareMeters = cadBuildAutomaticTargetAreaSquareMeters(
      currentParcel,
      currentFrontage,
      settings,
    );
    const startCandidate = cadBuildParcelLayoutPreviewCandidateForTargetArea(
      currentParcel,
      currentFrontage,
      settings,
      tool,
      'start',
      automaticTargetAreaSquareMeters,
    );
    const endCandidate = cadBuildParcelLayoutPreviewCandidateForTargetArea(
      currentParcel,
      currentFrontage,
      settings,
      tool,
      'end',
      automaticTargetAreaSquareMeters,
    );
    const candidate =
      [startCandidate, endCandidate].sort((left, right) => {
        if (left.isValid !== right.isValid) return left.isValid ? -1 : 1;
        const leftScore = left.evaluation?.score ?? Number.POSITIVE_INFINITY;
        const rightScore = right.evaluation?.score ?? Number.POSITIVE_INFINITY;
        return leftScore - rightScore;
      })[0] ?? startCandidate;
    if (!candidate.isValid || !candidate.draft) {
      if (generatedParcels.length === 0) {
        return {
          tool,
          generatedParcels: [],
          acceptedCandidates: [],
          isValid: false,
          statusMessage: 'Automatic fill could not create a valid first lot from the active parent and frontage.',
        };
      }
      generatedParcels.push(
        cadCloneParcelLayoutGeneratedDraft(currentParcel.vertices, currentParcel.vertexLabels, 'remainder'),
      );
      return {
        tool,
        generatedParcels,
        acceptedCandidates,
        isValid: true,
        statusMessage: `Automatic fill prepared ${generatedParcels.length} parcels from the active parent/frontage setup.`,
      };
    }

    const remainderDraft = cadCloneParcelLayoutGeneratedDraft(
      candidate.draft.remainderVertices,
      candidate.draft.remainderVertexLabels,
      'remainder',
    );
    const rawRemainderFrontage =
      tool === 'slide'
        ? cadBuildAutoLayoutRemainderFrontageLine(currentFrontage, candidate)
        : { ...currentFrontage, id: `${currentFrontage.id}:auto-remainder` };
    const remainderFrontage = rawRemainderFrontage
      ? cadStabilizeFrontageLine(rawRemainderFrontage)
      : null;
    const remainderParcel = cadStabilizeParcelVertexCoordinates(
      cadCanonicalizeParcelAgainstFrontage(
        cadBuildParcelEntityFromGeneratedDraft(parcel, remainderDraft),
        remainderFrontage ?? currentFrontage,
      ),
    );
    const canCreateAnotherLot = cadCanCreateAnotherAutoLayoutLot(
      remainderParcel,
      remainderFrontage,
      settings,
      tool,
    );

    if (
      !canCreateAnotherLot &&
      settings.remainderDistribution === 'place_remainder_in_last_parcel'
    ) {
      if (generatedParcels.length === 0) {
        return {
          tool,
          generatedParcels: [],
          acceptedCandidates: [],
          isValid: false,
          statusMessage: 'Automatic fill needs room for at least two valid lots when remainder stays in the last parcel.',
        };
      }
      generatedParcels.push(
        cadCloneParcelLayoutGeneratedDraft(currentParcel.vertices, currentParcel.vertexLabels, 'remainder'),
      );
      return {
        tool,
        generatedParcels,
        acceptedCandidates,
        isValid: true,
        statusMessage: `Automatic fill prepared ${generatedParcels.length} parcels with remainder kept in the last parcel.`,
      };
    }

    generatedParcels.push(
      cadCloneParcelLayoutGeneratedDraft(candidate.draft.childVertices, candidate.draft.childVertexLabels, 'lot'),
    );
    acceptedCandidates.push(candidate);

    if (!canCreateAnotherLot) {
      generatedParcels.push(remainderDraft);
      return {
        tool,
        generatedParcels,
        acceptedCandidates,
        isValid: true,
        statusMessage: `Automatic fill prepared ${generatedParcels.length} parcels from the active parent/frontage setup.`,
      };
    }

    currentParcel = remainderParcel;
    if (!remainderFrontage) {
      generatedParcels.push(remainderDraft);
      return {
        tool,
        generatedParcels,
        acceptedCandidates,
        isValid: true,
        statusMessage: `Automatic fill prepared ${generatedParcels.length} parcels from the active parent/frontage setup.`,
      };
    }
    currentFrontage = remainderFrontage;
  }

  return {
    tool,
    generatedParcels: [],
    acceptedCandidates: [],
    isValid: false,
    statusMessage: 'Automatic fill reached its safety limit before completing the lot sequence.',
  };
};

const isParcelAutoRemainderDistributionSupported = (
  remainderDistribution: CadParcelLayoutRemainderDistribution,
): boolean =>
  remainderDistribution === 'place_remainder_in_last_parcel' ||
  remainderDistribution === 'create_parcel_from_remainder';

export const cadBuildParcelAutoLayoutDraft = (
  parcel: CadParcelEntity,
  frontageLine: CadLineEntity,
  settings: CadParcelLayoutSettings,
  tool: 'slide' | 'swing',
): CadParcelAutoLayoutDraft => {
  if (isParcelAutoRemainderDistributionSupported(settings.remainderDistribution)) {
    const directDraft = cadBuildParcelAutoLayoutDraftForSupportedRemainderMode(
      parcel,
      frontageLine,
      settings,
      tool,
    );
    if (directDraft.isValid) {
      return directDraft;
    }
    if (!settings.useMaxDepth) {
      return directDraft;
    }
    return cadBuildParcelFrontageStripAutoLayoutDraft(
      parcel,
      frontageLine,
      settings,
      tool,
    ) ?? directDraft;
  }

  const baseAutoLayout = cadBuildParcelAutoLayoutDraftForSupportedRemainderMode(
    parcel,
    frontageLine,
    {
      ...settings,
      remainderDistribution: 'create_parcel_from_remainder',
    },
    tool,
  );
  if (!baseAutoLayout.isValid) {
    return baseAutoLayout;
  }

  const lotCount = baseAutoLayout.acceptedCandidates.length;
  const remainderParcel = baseAutoLayout.generatedParcels.at(-1);
  if (lotCount === 0) {
    return {
      ...baseAutoLayout,
      isValid: false,
      statusMessage: 'Automatic fill could not create a valid first lot from the active parent and frontage.',
    };
  }
  if (lotCount === 1) {
    return cadBuildParcelAutoLayoutDraftForSupportedRemainderMode(
      parcel,
      frontageLine,
      {
        ...settings,
        remainderDistribution: 'place_remainder_in_last_parcel',
      },
      tool,
    );
  }

  const remainderAreaSquareMeters =
    remainderParcel?.role === 'remainder'
      ? cadBuildParcelClosureSummary(remainderParcel.vertices)?.areaSquareMeters ?? 0
      : 0;
  if (remainderAreaSquareMeters <= 1e-6) {
    return {
      ...baseAutoLayout,
      generatedParcels: baseAutoLayout.generatedParcels.map((generatedParcel) => ({
        ...generatedParcel,
        role: 'lot',
      })),
      statusMessage: `Automatic fill redistributed remainder across ${lotCount} lots.`,
    };
  }

  const parcelAreaSquareMeters = cadBuildParcelClosureSummary(parcel.vertices)?.areaSquareMeters ?? 0;
  const redistributedTargetAreaSquareMeters = parcelAreaSquareMeters / lotCount;
  const frontageLengthMeters = cadDistance(
    { x: frontageLine.fromX, y: frontageLine.fromY },
    { x: frontageLine.toX, y: frontageLine.toY },
  );
  const redistributedTargetFrontageMeters = frontageLengthMeters / lotCount;
  const redistributedAutoLayout = cadBuildParcelAutoLayoutDraftForSupportedRemainderMode(
    parcel,
    frontageLine,
    {
      ...settings,
      minAreaSquareMeters: redistributedTargetAreaSquareMeters,
      minFrontageMeters: Math.max(settings.minFrontageMeters, redistributedTargetFrontageMeters),
      solutionPreference: 'closest_to_target_area',
      remainderDistribution: 'create_parcel_from_remainder',
    },
    tool,
  );
  if (
    !redistributedAutoLayout.isValid ||
    redistributedAutoLayout.generatedParcels.length !== lotCount
  ) {
    return {
      ...baseAutoLayout,
      isValid: false,
      statusMessage:
        'Automatic fill could not redistribute remainder across same lot count without dropping a lot.',
    };
  }

  return {
    ...redistributedAutoLayout,
    generatedParcels: redistributedAutoLayout.generatedParcels.map((generatedParcel) => ({
      ...generatedParcel,
      role: 'lot',
    })),
    statusMessage: `Automatic fill redistributed remainder across ${lotCount} lots.`,
  };
};

export const cadBuildParcelAutoLayoutDraftFromFrontageReference = (
  parcel: CadParcelEntity,
  frontageReference: CadParcelLayoutFrontageReference,
  settings: CadParcelLayoutSettings,
  tool: 'slide' | 'swing',
): CadParcelAutoLayoutDraft => {
  const segmentPairs = frontageReference.parcelSegmentLabelPairs ?? [];
  if (segmentPairs.length <= 1) {
    return cadBuildParcelAutoLayoutDraft(parcel, frontageReference.frontageLine, settings, tool);
  }
  const closedBoundaryDraft = cadBuildClosedBoundaryRingAutoLayoutDraft(
    parcel,
    frontageReference,
    settings,
    tool,
  );
  if (closedBoundaryDraft?.isValid) {
    return closedBoundaryDraft;
  }

  let currentParcel: CadParcelEntity = {
    ...parcel,
    vertices: parcel.vertices.map((vertex) => ({ x: vertex.x, y: vertex.y })),
    vertexLabels: [...parcel.vertexLabels],
  };
  const generatedParcels: CadParcelLayoutGeneratedParcelDraft[] = [];
  const acceptedCandidates: CadParcelLayoutPreviewCandidate[] = [];
  const cornerTrimFromStartMetersBySegment = new Map<number, number>();
  const cornerTrimFromEndMetersBySegment = new Map<number, number>();
  const cornerDraftJunctionIndexes = new Set<number>();
  let usedFullParentSegmentRecovery = false;
  if (settings.useMaxDepth) {
    for (let index = 0; index < segmentPairs.length - 1; index += 1) {
      const firstFrontage = cadBuildFrontageLineForCurrentParcelSegment(parcel, frontageReference, index);
      const secondFrontage = cadBuildFrontageLineForCurrentParcelSegment(parcel, frontageReference, index + 1);
      if (!firstFrontage || !secondFrontage) continue;
      const cornerDraft = cadBuildCornerInfillDraft(
        parcel,
        firstFrontage,
        secondFrontage,
        settings,
        tool,
      );
      if (!cornerDraft) continue;
      cornerDraftJunctionIndexes.add(index);
      generatedParcels.push(
        ...cornerDraft.draft.generatedParcels.map((generatedParcel) => ({
          ...generatedParcel,
          sourceKind: 'corner_prepass' as const,
          sourceSegmentIndex: index,
        })),
      );
      acceptedCandidates.push(...cornerDraft.draft.acceptedCandidates);
      cornerTrimFromEndMetersBySegment.set(
        index,
        Math.max(
          cornerTrimFromEndMetersBySegment.get(index) ?? 0,
          cornerDraft.firstSegmentTrimMeters,
        ),
      );
      cornerTrimFromStartMetersBySegment.set(
        index + 1,
        Math.max(
          cornerTrimFromStartMetersBySegment.get(index + 1) ?? 0,
          cornerDraft.secondSegmentTrimMeters,
        ),
      );
    }
  }

  for (let index = 0; index < segmentPairs.length; index += 1) {
    const carriedFrontage = cadBuildFrontageLineForCurrentParcelSegment(
      currentParcel,
      frontageReference,
      index,
    );
    const originalFrontage = cadBuildFrontageLineForCurrentParcelSegment(
      parcel,
      frontageReference,
      index,
    );
    const carriedFrontageLengthMeters = carriedFrontage
      ? cadDistance(
          { x: carriedFrontage.fromX, y: carriedFrontage.fromY },
          { x: carriedFrontage.toX, y: carriedFrontage.toY },
        )
      : 0;
    const originalFrontageLengthMeters = originalFrontage
      ? cadDistance(
          { x: originalFrontage.fromX, y: originalFrontage.fromY },
          { x: originalFrontage.toX, y: originalFrontage.toY },
        )
      : 0;
    const carriedFrontageStartShiftMeters =
      carriedFrontage && originalFrontage
        ? Math.min(
            cadDistance(
              { x: carriedFrontage.fromX, y: carriedFrontage.fromY },
              { x: originalFrontage.fromX, y: originalFrontage.fromY },
            ),
            cadDistance(
              { x: carriedFrontage.toX, y: carriedFrontage.toY },
              { x: originalFrontage.fromX, y: originalFrontage.fromY },
            ),
          )
        : 0;
    const shouldRecoverFullParentSegment =
      settings.useMaxDepth &&
      index > 0 &&
      originalFrontageLengthMeters > settings.minFrontageMeters * 2 &&
      (carriedFrontageLengthMeters + settings.minFrontageMeters < originalFrontageLengthMeters * 0.5 ||
        (index > 1 && carriedFrontageStartShiftMeters > settings.minFrontageMeters * 2));
    const segmentSourceParcel = shouldRecoverFullParentSegment ? parcel : currentParcel;
    if (shouldRecoverFullParentSegment) {
      usedFullParentSegmentRecovery = true;
    }
    const rawCurrentFrontage = cadBuildFrontageLineForCurrentParcelSegment(
      segmentSourceParcel,
      frontageReference,
      index,
    );
    if (!rawCurrentFrontage) continue;
    let currentFrontage = rawCurrentFrontage;
    let trimFromStartMeters = cornerTrimFromStartMetersBySegment.get(index) ?? 0;
    let trimFromEndMeters = cornerTrimFromEndMetersBySegment.get(index) ?? 0;
    if (settings.useMaxDepth) {
      const previousJunctionIndex = index - 1;
      if (previousJunctionIndex >= 0 && !cornerDraftJunctionIndexes.has(previousJunctionIndex)) {
        const previousFrontage = cadBuildFrontageLineForCurrentParcelSegment(
          parcel,
          frontageReference,
          previousJunctionIndex,
        );
        const originalCurrentFrontage = cadBuildFrontageLineForCurrentParcelSegment(
          parcel,
          frontageReference,
          index,
        );
        if (previousFrontage && originalCurrentFrontage) {
          if (previousFrontage.toStationId === originalCurrentFrontage.fromStationId) {
            trimFromStartMeters = Math.max(
              trimFromStartMeters,
              cadBuildCappedFallbackCornerTrimDistance(
                cadBuildReservedFrontageTrimDistance(
                  originalCurrentFrontage,
                  previousFrontage,
                  'start',
                  settings.maxDepthMeters,
                ),
                settings,
              ),
            );
          } else if (previousFrontage.toStationId === originalCurrentFrontage.toStationId) {
            trimFromEndMeters = Math.max(
              trimFromEndMeters,
              cadBuildCappedFallbackCornerTrimDistance(
                cadBuildReservedFrontageTrimDistance(
                  originalCurrentFrontage,
                  previousFrontage,
                  'end',
                  settings.maxDepthMeters,
                ),
                settings,
              ),
            );
          } else if (previousFrontage.fromStationId === originalCurrentFrontage.fromStationId) {
            trimFromStartMeters = Math.max(
              trimFromStartMeters,
              cadBuildCappedFallbackCornerTrimDistance(
                cadBuildReservedFrontageTrimDistance(
                  originalCurrentFrontage,
                  {
                    ...previousFrontage,
                    fromStationId: previousFrontage.toStationId,
                    fromX: previousFrontage.toX,
                    fromY: previousFrontage.toY,
                    toStationId: previousFrontage.fromStationId,
                    toX: previousFrontage.fromX,
                    toY: previousFrontage.fromY,
                  },
                  'start',
                  settings.maxDepthMeters,
                ),
                settings,
              ),
            );
          } else if (previousFrontage.fromStationId === originalCurrentFrontage.toStationId) {
            trimFromEndMeters = Math.max(
              trimFromEndMeters,
              cadBuildCappedFallbackCornerTrimDistance(
                cadBuildReservedFrontageTrimDistance(
                  originalCurrentFrontage,
                  {
                    ...previousFrontage,
                    fromStationId: previousFrontage.toStationId,
                    fromX: previousFrontage.toX,
                    fromY: previousFrontage.toY,
                    toStationId: previousFrontage.fromStationId,
                    toX: previousFrontage.fromX,
                    toY: previousFrontage.fromY,
                  },
                  'end',
                  settings.maxDepthMeters,
                ),
                settings,
              ),
            );
          }
        }
      }
    }
    currentFrontage =
      cadBuildTrimmedFrontageLine(currentFrontage, trimFromStartMeters, trimFromEndMeters) ??
      currentFrontage;

    const isLastSegment = index === segmentPairs.length - 1;
    const forceRemainderParcel =
      settings.useMaxDepth && segmentPairs.length > 1 && settings.remainderDistribution === 'place_remainder_in_last_parcel';
    const segmentSettings = isLastSegment && !forceRemainderParcel
      ? settings
      : {
          ...settings,
          remainderDistribution: 'create_parcel_from_remainder' as const,
        };
    const segmentDraft =
      (settings.useMaxDepth
        ? cadBuildParcelFrontageStripAutoLayoutDraft(
            segmentSourceParcel,
            currentFrontage,
            segmentSettings,
            tool,
          )
        : null) ??
      cadBuildParcelAutoLayoutDraft(
        segmentSourceParcel,
        currentFrontage,
        segmentSettings,
        tool,
      );
    if (!segmentDraft.isValid) {
      continue;
    }

    const segmentGeneratedParcels = [...segmentDraft.generatedParcels];
    const trailingRemainder =
      !isLastSegment && segmentGeneratedParcels.at(-1)?.role === 'remainder'
        ? segmentGeneratedParcels.pop() ?? null
        : null;
    const frontageRemainder =
      !isLastSegment && segmentGeneratedParcels.at(-1)?.role === 'remainder'
        ? segmentGeneratedParcels.pop() ?? null
        : null;

    generatedParcels.push(
      ...segmentGeneratedParcels.map((generatedParcel) => ({
        ...generatedParcel,
        sourceKind: generatedParcel.sourceKind ?? 'segment',
        sourceSegmentIndex: index,
      })),
    );
    acceptedCandidates.push(...segmentDraft.acceptedCandidates);
    if (frontageRemainder) {
      const frontageRemainderMeters =
        (frontageRemainder as CadParcelLayoutGeneratedParcelDraft & {
          frontageLengthMeters?: number;
        }).frontageLengthMeters ?? 0;
      const combinedFrontageMeters = Math.max(
        settings.minFrontageMeters,
        frontageRemainderMeters + settings.minFrontageMeters,
      );
      const cornerCandidate = cadBuildCornerRemainderPreviewCandidate(
        currentFrontage,
        settings,
        frontageRemainder,
        combinedFrontageMeters,
        tool,
      );
      if (cornerCandidate?.isValid) {
        generatedParcels.push({
          ...frontageRemainder,
          role: 'lot',
          sourceKind: 'corner_remainder',
          sourceSegmentIndex: index,
        });
        acceptedCandidates.push(cornerCandidate);
      } else {
        generatedParcels.push({
          ...frontageRemainder,
          sourceKind: 'segment',
          sourceSegmentIndex: index,
        });
      }
    }

    if (!isLastSegment && trailingRemainder) {
      let nextParcel = cadBuildParcelEntityFromGeneratedDraft(parcel, trailingRemainder, true);
      if (settings.useMaxDepth && !cornerDraftJunctionIndexes.has(index)) {
        const currentResidualFrontage = cadBuildFrontageLineForCurrentParcelSegment(
          nextParcel,
          frontageReference,
          index,
        );
        const nextResidualFrontage = cadBuildFrontageLineForCurrentParcelSegment(
          nextParcel,
          frontageReference,
          index + 1,
        );
        if (currentResidualFrontage && nextResidualFrontage) {
          const bridgeDraft = cadBuildFrontageBridgeDraft(
            nextParcel,
            currentResidualFrontage,
            nextResidualFrontage,
            settings,
            tool,
          );
          if (bridgeDraft?.draft.generatedParcels.length) {
            generatedParcels.push(
              ...bridgeDraft.draft.generatedParcels.map((generatedParcel) => ({
                ...generatedParcel,
                sourceKind: 'corner_remainder' as const,
                sourceSegmentIndex: index,
              })),
            );
            acceptedCandidates.push(...bridgeDraft.draft.acceptedCandidates);
            if (bridgeDraft.remainderDraft) {
              nextParcel = cadBuildParcelEntityFromGeneratedDraft(
                parcel,
                bridgeDraft.remainderDraft,
                true,
              );
            }
          }
          const remainderCornerDraft = bridgeDraft
            ? null
            : cadBuildRemainderJunctionInfillDraft(
                nextParcel,
                currentResidualFrontage,
                nextResidualFrontage,
                settings,
                tool,
              );
          if (remainderCornerDraft?.draft.generatedParcels.length) {
            generatedParcels.push(
              ...remainderCornerDraft.draft.generatedParcels.map((generatedParcel) => ({
                ...generatedParcel,
                sourceKind: 'corner_remainder' as const,
                sourceSegmentIndex: index,
              })),
            );
            acceptedCandidates.push(...remainderCornerDraft.draft.acceptedCandidates);
            if (remainderCornerDraft.remainderDraft) {
              nextParcel = cadBuildParcelEntityFromGeneratedDraft(
                parcel,
                remainderCornerDraft.remainderDraft,
                true,
              );
            }
          }
        }
      }
      currentParcel = nextParcel;
    }
  }

  if (generatedParcels.length < 2) {
    return {
      tool,
      generatedParcels: [],
      acceptedCandidates: [],
      isValid: false,
      statusMessage: 'Automatic fill could not create valid lots from the selected frontage edges.',
    };
  }

  const resolvedDraft = cadResolveGeneratedParcelConflicts({
    tool,
    generatedParcels,
    acceptedCandidates,
    isValid: true,
    statusMessage: `Automatic fill prepared ${generatedParcels.length} parcels from the selected frontage edges.`,
  });
  if (usedFullParentSegmentRecovery) {
    return resolvedDraft;
  }
  return cadTryFillGeneratedRemaindersFromFrontageReference(
    parcel,
    frontageReference,
    settings,
    tool,
    resolvedDraft,
  );
};

export const cadBuildPreferredParcelAutoLayoutDraftFromFrontageReference = (
  parcel: CadParcelEntity,
  frontageReference: CadParcelLayoutFrontageReference,
  settings: CadParcelLayoutSettings,
  preferredTool: 'slide' | 'swing',
): CadParcelAutoLayoutDraft => {
  const preferredDraft = cadBuildParcelAutoLayoutDraftFromFrontageReference(
    parcel,
    frontageReference,
    settings,
    preferredTool,
  );
  const alternateTool = preferredTool === 'slide' ? 'swing' : 'slide';
  if (preferredDraft.isValid) {
    return preferredDraft;
  }

  const alternateDraft = cadBuildParcelAutoLayoutDraftFromFrontageReference(
    parcel,
    frontageReference,
    settings,
    alternateTool,
  );
  return alternateDraft.isValid ? alternateDraft : preferredDraft;
};

export const cadBuildParcelSplitByBearingDraft = (
  parcel: CadParcelEntity,
  throughPoint: CadWorldPoint,
  bearing: string,
): CadParcelSplitDraft | null => {
  const azimuthDeg = cadParseBearingDegrees(bearing);
  if (azimuthDeg == null) return null;
  return cadBuildParcelSplitLineDraftFromAzimuth(parcel, throughPoint, azimuthDeg);
};

const cadBuildParcelSplitLineDraftFromAzimuth = (
  parcel: CadParcelEntity,
  throughPoint: CadWorldPoint,
  azimuthDeg: number,
): CadParcelSplitDraft | null => {
  const parcelVertices = normalizeParcelPolygonVertices(parcel.vertices);
  if (parcelVertices.length < 3) return null;
  const maxVertexDistance = parcelVertices.reduce(
    (maximum, vertex) => Math.max(maximum, cadDistance(throughPoint, vertex)),
    0,
  );
  const extensionDistance = Math.max(maxVertexDistance * 4, 1000);
  return cadBuildParcelSplitByLineDraft(parcel, {
    id: 'parcel-split-bearing:draft',
    type: 'line',
    layerId: parcel.layerId,
    styleId: parcel.styleId,
    visible: true,
    locked: false,
    fromStationId: 'BRG1',
    toStationId: 'BRG2',
    fromX: cadPointFromAzimuthDistance(throughPoint, azimuthDeg + 180, extensionDistance).x,
    fromY: cadPointFromAzimuthDistance(throughPoint, azimuthDeg + 180, extensionDistance).y,
    toX: cadPointFromAzimuthDistance(throughPoint, azimuthDeg, extensionDistance).x,
    toY: cadPointFromAzimuthDistance(throughPoint, azimuthDeg, extensionDistance).y,
    sourceObservationIds: [],
  });
};

interface CadParcelSplitAreaEvaluation {
  angleDeg: number;
  draft: CadParcelSplitDraft;
  differenceSquareMeters: number;
}

const evaluateParcelSplitAreaAtAngle = (
  parcel: CadParcelEntity,
  throughPoint: CadWorldPoint,
  targetAreaSquareMeters: number,
  angleDeg: number,
): CadParcelSplitAreaEvaluation | null => {
  const draft = cadBuildParcelSplitLineDraftFromAzimuth(parcel, throughPoint, angleDeg);
  if (!draft) return null;
  const firstSummary = cadBuildParcelClosureSummary(draft.firstVertices);
  const secondSummary = cadBuildParcelClosureSummary(draft.secondVertices);
  if (!firstSummary || !secondSummary) return null;

  const firstCross = cadCross(draft.splitStart, draft.splitEnd, firstSummary.centroid);
  const secondCross = cadCross(draft.splitStart, draft.splitEnd, secondSummary.centroid);
  const leftSummary =
    firstCross > PARCEL_POINT_TOLERANCE
      ? firstSummary
      : secondCross > PARCEL_POINT_TOLERANCE
        ? secondSummary
        : null;
  const rightSummary =
    firstCross < -PARCEL_POINT_TOLERANCE
      ? firstSummary
      : secondCross < -PARCEL_POINT_TOLERANCE
        ? secondSummary
        : null;
  if (!leftSummary || !rightSummary) return null;

  return {
    angleDeg,
    draft,
    differenceSquareMeters: leftSummary.areaSquareMeters - targetAreaSquareMeters,
  };
};

const refineParcelSplitAreaEvaluation = (
  parcel: CadParcelEntity,
  throughPoint: CadWorldPoint,
  targetAreaSquareMeters: number,
  seed: CadParcelSplitAreaEvaluation,
  windowDeg: number,
  stepDeg: number,
): CadParcelSplitAreaEvaluation => {
  let best = seed;
  for (
    let angleDeg = seed.angleDeg - windowDeg;
    angleDeg <= seed.angleDeg + windowDeg + 1e-9;
    angleDeg += stepDeg
  ) {
    const evaluation = evaluateParcelSplitAreaAtAngle(
      parcel,
      throughPoint,
      targetAreaSquareMeters,
      cadNormalizeAngleDeg(angleDeg),
    );
    if (
      evaluation &&
      Math.abs(evaluation.differenceSquareMeters) < Math.abs(best.differenceSquareMeters)
    ) {
      best = evaluation;
    }
  }
  return best;
};

export const cadBuildParcelSplitByAreaDraft = (
  parcel: CadParcelEntity,
  throughPoint: CadWorldPoint,
  targetAreaSquareMeters: number,
): CadParcelSplitDraft | null => {
  if (!Number.isFinite(targetAreaSquareMeters) || targetAreaSquareMeters <= 0) return null;
  const parcelVertices = normalizeParcelPolygonVertices(parcel.vertices);
  if (parcelVertices.length < 3) return null;
  if (
    parcelVertices.some((start, index) =>
      cadPointOnSegment(throughPoint, start, parcelVertices[(index + 1) % parcelVertices.length]!),
    )
  ) {
    return null;
  }
  if (!cadPointInPolygon(throughPoint, parcelVertices)) return null;

  const parcelSummary = cadBuildParcelClosureSummary(parcelVertices);
  if (!parcelSummary) return null;
  if (targetAreaSquareMeters >= parcelSummary.areaSquareMeters - 1e-6) return null;
  const areaToleranceSquareMeters = Math.max(parcelSummary.areaSquareMeters * 1e-6, 1e-3);

  let bestEvaluation: CadParcelSplitAreaEvaluation | null = null;
  for (let angleDeg = 0; angleDeg < 360; angleDeg += 1) {
    const evaluation = evaluateParcelSplitAreaAtAngle(
      parcel,
      throughPoint,
      targetAreaSquareMeters,
      angleDeg,
    );
    if (
      evaluation &&
      (
        bestEvaluation == null ||
        Math.abs(evaluation.differenceSquareMeters) < Math.abs(bestEvaluation.differenceSquareMeters)
      )
    ) {
      bestEvaluation = evaluation;
    }
  }
  if (!bestEvaluation) return null;

  bestEvaluation = refineParcelSplitAreaEvaluation(
    parcel,
    throughPoint,
    targetAreaSquareMeters,
    bestEvaluation,
    1,
    0.1,
  );
  bestEvaluation = refineParcelSplitAreaEvaluation(
    parcel,
    throughPoint,
    targetAreaSquareMeters,
    bestEvaluation,
    0.1,
    0.01,
  );
  bestEvaluation = refineParcelSplitAreaEvaluation(
    parcel,
    throughPoint,
    targetAreaSquareMeters,
    bestEvaluation,
    0.01,
    0.001,
  );

  return Math.abs(bestEvaluation.differenceSquareMeters) <= areaToleranceSquareMeters
    ? bestEvaluation.draft
    : null;
};

export const cadBuildParcelOverlapDiagnostics = (
  parcels: readonly CadParcelEntity[],
): CadParcelOverlapDiagnostics => {
  const overlapPairs: CadParcelOverlapPairDiagnostic[] = [];
  for (let firstIndex = 0; firstIndex < parcels.length; firstIndex += 1) {
    for (let secondIndex = firstIndex + 1; secondIndex < parcels.length; secondIndex += 1) {
      const firstParcel = parcels[firstIndex]!;
      const secondParcel = parcels[secondIndex]!;
      const firstVertices = normalizeParcelPolygonVertices(firstParcel.vertices);
      const secondVertices = normalizeParcelPolygonVertices(secondParcel.vertices);
      if (firstVertices.length < 3 || secondVertices.length < 3) continue;
      const mayOverlap =
        firstVertices.some((point) => cadPointInPolygon(point, secondVertices)) ||
        secondVertices.some((point) => cadPointInPolygon(point, firstVertices)) ||
        firstVertices.some((start, index) => {
          const end = firstVertices[(index + 1) % firstVertices.length]!;
          return secondVertices.some((clipStart, clipIndex) => {
            const clipEnd = secondVertices[(clipIndex + 1) % secondVertices.length]!;
            const intersection = cadSegmentIntersection(start, end, clipStart, clipEnd);
            if (!intersection) return false;
            const touchesAtSharedVertex =
              [start, end, clipStart, clipEnd].some((vertex) => parcelPointsMatch(intersection, vertex));
            return !touchesAtSharedVertex;
          });
        });
      if (!mayOverlap) continue;
      const overlapAreaSquareMeters = cadBuildParcelOverlapAreaSquareMeters(firstVertices, secondVertices);
      if (overlapAreaSquareMeters <= 1e-6) continue;
      overlapPairs.push({
        firstParcelId: firstParcel.id,
        firstParcelName: firstParcel.parcelName,
        secondParcelId: secondParcel.id,
        secondParcelName: secondParcel.parcelName,
        overlapAreaSquareMeters,
      });
    }
  }
  return {
    parcelCount: parcels.length,
    pairCount: (parcels.length * (parcels.length - 1)) / 2,
    overlapPairs,
    totalOverlapAreaSquareMeters: overlapPairs.reduce(
      (total, pair) => total + pair.overlapAreaSquareMeters,
      0,
    ),
  };
};

export const cadBuildParcelGapDiagnostics = (
  parcels: readonly CadParcelEntity[],
): CadParcelGapDiagnostics => {
  if (parcels.length === 0) {
    return {
      parcelCount: 0,
      componentCount: 0,
      exposedLoopCount: 0,
      isSupported: false,
      gapLoops: [],
      totalGapAreaSquareMeters: 0,
    };
  }

  const allSegments = parcels.flatMap(buildParcelBoundarySegments);
  const groupedSegments = new Map<string, CadParcelBoundarySegment[]>();
  allSegments.forEach((segment) => {
    const key =
      segment.startKey < segment.endKey
        ? `${segment.startKey}|${segment.endKey}`
        : `${segment.endKey}|${segment.startKey}`;
    const existing = groupedSegments.get(key);
    if (existing) {
      existing.push(segment);
      return;
    }
    groupedSegments.set(key, [segment]);
  });

  const exposedSegments = [...groupedSegments.values()]
    .filter((group) => group.length === 1)
    .map((group) => group[0]!);
  if (exposedSegments.length === 0) {
    return {
      parcelCount: parcels.length,
      componentCount: 0,
      exposedLoopCount: 0,
      isSupported: false,
      gapLoops: [],
      totalGapAreaSquareMeters: 0,
    };
  }

  const nodeMap = new Map<string, { point: CadWorldPoint; edges: number[] }>();
  exposedSegments.forEach((segment, index) => {
    [
      { key: segment.startKey, point: segment.start },
      { key: segment.endKey, point: segment.end },
    ].forEach(({ key, point }) => {
      const existing = nodeMap.get(key);
      if (existing) {
        existing.edges.push(index);
        return;
      }
      nodeMap.set(key, {
        point,
        edges: [index],
      });
    });
  });

  let componentCount = 0;
  const visitedNodeKeys = new Set<string>();
  nodeMap.forEach((_, key) => {
    if (visitedNodeKeys.has(key)) return;
    componentCount += 1;
    const queue = [key];
    visitedNodeKeys.add(key);
    while (queue.length > 0) {
      const currentKey = queue.shift();
      if (!currentKey) continue;
      const current = nodeMap.get(currentKey);
      if (!current) continue;
      current.edges.forEach((edgeIndex) => {
        const edge = exposedSegments[edgeIndex]!;
        [edge.startKey, edge.endKey].forEach((nextKey) => {
          if (visitedNodeKeys.has(nextKey)) return;
          visitedNodeKeys.add(nextKey);
          queue.push(nextKey);
        });
      });
    }
  });

  const isSupported = [...nodeMap.values()].every((node) => node.edges.length === 2);
  if (!isSupported) {
    return {
      parcelCount: parcels.length,
      componentCount,
      exposedLoopCount: 0,
      isSupported: false,
      gapLoops: [],
      totalGapAreaSquareMeters: 0,
    };
  }

  const usedEdgeIndexes = new Set<number>();
  const loops: CadWorldPoint[][] = [];
  exposedSegments.forEach((segment, segmentIndex) => {
    if (usedEdgeIndexes.has(segmentIndex)) return;
    const loop: CadWorldPoint[] = [{ x: segment.start.x, y: segment.start.y }];
    let currentEdgeIndex = segmentIndex;
    let currentNodeKey = segment.startKey;
    const startNodeKey = segment.startKey;
    let guard = 0;
    while (guard < exposedSegments.length * 2) {
      const currentEdge = exposedSegments[currentEdgeIndex]!;
      usedEdgeIndexes.add(currentEdgeIndex);
      const nextNodeKey = currentNodeKey === currentEdge.startKey ? currentEdge.endKey : currentEdge.startKey;
      const nextPoint = currentNodeKey === currentEdge.startKey ? currentEdge.end : currentEdge.start;
      loop.push({ x: nextPoint.x, y: nextPoint.y });
      if (nextNodeKey === startNodeKey) break;
      const node = nodeMap.get(nextNodeKey);
      if (!node) break;
      const nextEdgeIndex = node.edges.find((edgeIndex) => edgeIndex !== currentEdgeIndex);
      if (nextEdgeIndex == null) break;
      currentNodeKey = nextNodeKey;
      currentEdgeIndex = nextEdgeIndex;
      guard += 1;
    }
    if (loop.length >= 4 && parcelPointsMatch(loop[0]!, loop[loop.length - 1]!)) {
      loops.push(loop);
    }
  });

  const summarizedLoops = loops
    .map((loop) => {
      const summary = cadBuildParcelClosureSummary(loop);
      return summary == null ? null : { loop, summary };
    })
    .filter((entry): entry is { loop: CadWorldPoint[]; summary: CadParcelClosureSummary } => entry != null);
  const gapLoops = summarizedLoops
    .filter(({ summary }, index) =>
      summarizedLoops.some((candidate, candidateIndex) =>
        candidateIndex !== index &&
        candidate.summary.areaSquareMeters > summary.areaSquareMeters + 1e-6 &&
        cadPointInPolygon(summary.centroid, normalizeParcelPolygonVertices(candidate.loop)),
      ),
    )
    .map(({ summary }) => ({
      areaSquareMeters: summary.areaSquareMeters,
      centroid: summary.centroid,
    }));

  return {
    parcelCount: parcels.length,
    componentCount,
    exposedLoopCount: summarizedLoops.length,
    isSupported: true,
    gapLoops,
    totalGapAreaSquareMeters: gapLoops.reduce((total, loop) => total + loop.areaSquareMeters, 0),
  };
};

const normalizePolylineParcelSource = (entity: CadPolylineEntity): CadParcelSourceDraft | null => {
  if (entity.vertices.length < 3) return null;
  const firstVertex = entity.vertices[0];
  const lastVertex = entity.vertices[entity.vertices.length - 1];
  if (!firstVertex || !lastVertex) return null;
  const ringVertices =
    entity.vertices.length > 1 && parcelPointsMatch(firstVertex, lastVertex)
      ? entity.vertices.slice(0, -1)
      : entity.vertices;
  const ringLabels =
    entity.vertexLabels.length > 1 && entity.vertexLabels[0] === entity.vertexLabels[entity.vertexLabels.length - 1]
      ? entity.vertexLabels.slice(0, -1)
      : entity.vertexLabels;
  const normalizedLabels = normalizeParcelSourceVertexLabels(ringLabels);
  return ringVertices.length >= 3
    ? {
        vertices: ringVertices.map((vertex) => ({ x: vertex.x, y: vertex.y })),
        vertexLabels: normalizedLabels,
        sourceEntityIds: [entity.id],
      }
    : null;
};

const buildClosedLineParcelSource = (entities: readonly CadLineEntity[]): CadParcelSourceDraft | null => {
  if (entities.length < 3) return null;
  const candidates = entities.map(buildParcelLineCandidate);
  const nodeMap = buildParcelNodeMap(candidates);
  const nodes = [...nodeMap.values()];
  if (nodes.length < 3) return null;
  if (nodes.some((node) => node.incidentEntityIds.length !== 2)) return null;

  const candidateById = new Map(candidates.map((candidate) => [candidate.entityId, candidate] as const));
  const startNode = [...nodes].sort((left, right) => compareParcelPoints(left.point, right.point))[0]!;
  const firstEntityId = [...startNode.incidentEntityIds]
    .sort((leftId, rightId) => {
      const leftCandidate = candidateById.get(leftId)!;
      const rightCandidate = candidateById.get(rightId)!;
      const leftPoint =
        leftCandidate.startKey === startNode.key ? leftCandidate.end : leftCandidate.start;
      const rightPoint =
        rightCandidate.startKey === startNode.key ? rightCandidate.end : rightCandidate.start;
      const pointCompare = compareParcelPoints(leftPoint, rightPoint);
      return pointCompare !== 0 ? pointCompare : leftId.localeCompare(rightId);
    })[0];
  if (!firstEntityId) return null;

  const vertices: CadWorldPoint[] = [];
  const vertexLabels: string[] = [];
  const sourceEntityIds: CadEntityId[] = [];
  const usedEntityIds = new Set<CadEntityId>();
  let currentNode = startNode;
  let nextEntityId: CadEntityId | undefined = firstEntityId;

  vertices.push(currentNode.point);
  vertexLabels.push(currentNode.label);

  while (nextEntityId) {
    if (usedEntityIds.has(nextEntityId)) return null;
    const candidate = candidateById.get(nextEntityId);
    if (!candidate) return null;
    usedEntityIds.add(nextEntityId);
    sourceEntityIds.push(nextEntityId);

    const forward = candidate.startKey === currentNode.key;
    const nextPoint = forward ? candidate.end : candidate.start;
    const nextLabel = forward ? candidate.endLabel : candidate.startLabel;
    const nextKey = forward ? candidate.endKey : candidate.startKey;

    vertices.push(nextPoint);
    vertexLabels.push(nextLabel);

    const nextNode = nodeMap.get(nextKey);
    if (!nextNode) return null;
    currentNode = nextNode;

    if (usedEntityIds.size === candidates.length) {
      break;
    }
    nextEntityId = [...currentNode.incidentEntityIds]
      .filter((entityId) => !usedEntityIds.has(entityId))
      .sort()[0];
    if (!nextEntityId) return null;
  }

  if (!parcelPointsMatch(vertices[0]!, vertices[vertices.length - 1]!)) return null;
  if (vertexLabels[0] !== vertexLabels[vertexLabels.length - 1]) return null;

  return {
    vertices: vertices.slice(0, -1),
    vertexLabels: vertexLabels.slice(0, -1),
    sourceEntityIds,
  };
};

export const cadBuildParcelSourceDraft = (
  sourceEntities: readonly (CadLineEntity | CadPolylineEntity)[],
): CadParcelSourceDraft | null => {
  if (sourceEntities.length === 0) return null;
  if (sourceEntities.length === 1 && sourceEntities[0]?.type === 'polyline') {
    return normalizePolylineParcelSource(sourceEntities[0]);
  }
  if (sourceEntities.every((entity) => entity.type === 'line')) {
    return buildClosedLineParcelSource(sourceEntities);
  }
  return null;
};

export const cadBuildParcelClosureSummary = (
  vertices: readonly CadWorldPoint[],
): CadParcelClosureSummary | null => {
  const sanitizedVertices = vertices.filter((vertex, index, list) => {
    const previous = list[index - 1];
    if (!previous) return true;
    return Math.abs(vertex.x - previous.x) > 1e-9 || Math.abs(vertex.y - previous.y) > 1e-9;
  });
  if (sanitizedVertices.length < 3) return null;

  const firstVertex = sanitizedVertices[0]!;
  const lastVertex = sanitizedVertices[sanitizedVertices.length - 1]!;
  const isExplicitlyClosed =
    Math.abs(firstVertex.x - lastVertex.x) <= 1e-9 &&
    Math.abs(firstVertex.y - lastVertex.y) <= 1e-9;
  const ring = isExplicitlyClosed ? sanitizedVertices.slice(0, -1) : sanitizedVertices;
  if (ring.length < 3) return null;

  let signedDoubleArea = 0;
  let centroidXAccumulator = 0;
  let centroidYAccumulator = 0;
  let perimeterMeters = 0;

  for (let index = 0; index < ring.length; index += 1) {
    const current = ring[index]!;
    const next = ring[(index + 1) % ring.length]!;
    const cross = current.x * next.y - next.x * current.y;
    signedDoubleArea += cross;
    centroidXAccumulator += (current.x + next.x) * cross;
    centroidYAccumulator += (current.y + next.y) * cross;
    perimeterMeters += cadDistance(current, next);
  }

  const areaSquareMeters = Math.abs(signedDoubleArea) / 2;
  const closureDeltaX = firstVertex.x - lastVertex.x;
  const closureDeltaY = firstVertex.y - lastVertex.y;
  const closureDistanceMeters = Math.hypot(closureDeltaX, closureDeltaY);

  let centroid: CadWorldPoint;
  if (Math.abs(signedDoubleArea) <= 1e-9) {
    const average = ring.reduce(
      (accumulator, vertex) => ({
        x: accumulator.x + vertex.x,
        y: accumulator.y + vertex.y,
      }),
      { x: 0, y: 0 },
    );
    centroid = {
      x: average.x / ring.length,
      y: average.y / ring.length,
    };
  } else {
    centroid = {
      x: centroidXAccumulator / (3 * signedDoubleArea),
      y: centroidYAccumulator / (3 * signedDoubleArea),
    };
  }

  return {
    areaSquareMeters,
    perimeterMeters,
    closureDeltaX,
    closureDeltaY,
    closureDistanceMeters,
    centroid,
  };
};

export const cadBuildParcelReportSummary = ({
  parcelName,
  vertices,
  vertexLabels,
}: {
  parcelName: string;
  vertices: readonly CadWorldPoint[];
  vertexLabels: readonly string[];
}): CadParcelReportSummary | null => {
  const closureSummary = cadBuildParcelClosureSummary(vertices);
  if (!closureSummary) return null;

  const sanitizedVertices = vertices.filter((vertex, index, list) => {
    const previous = list[index - 1];
    if (!previous) return true;
    return Math.abs(vertex.x - previous.x) > 1e-9 || Math.abs(vertex.y - previous.y) > 1e-9;
  });
  const firstVertex = sanitizedVertices[0]!;
  const lastVertex = sanitizedVertices[sanitizedVertices.length - 1]!;
  const isExplicitlyClosed =
    Math.abs(firstVertex.x - lastVertex.x) <= 1e-9 &&
    Math.abs(firstVertex.y - lastVertex.y) <= 1e-9;
  const ring = isExplicitlyClosed ? sanitizedVertices.slice(0, -1) : sanitizedVertices;
  if (ring.length < 3) return null;

  const sanitizedLabels = vertexLabels.filter((label, index, list) => {
    const previous = list[index - 1];
    if (previous == null) return true;
    const previousVertex = vertices[index - 1];
    const currentVertex = vertices[index];
    if (!previousVertex || !currentVertex) return true;
    return (
      Math.abs(previousVertex.x - currentVertex.x) > 1e-9 ||
      Math.abs(previousVertex.y - currentVertex.y) > 1e-9
    );
  });
  const ringLabels =
    isExplicitlyClosed && sanitizedLabels.length > 1 && sanitizedLabels[0] === sanitizedLabels[sanitizedLabels.length - 1]
      ? sanitizedLabels.slice(0, -1)
      : sanitizedLabels;

  const courses = ring.map((vertex, index) => {
    const nextVertex = ring[(index + 1) % ring.length]!;
    const inverse = buildCadInverseSummary(vertex, nextVertex);
    const fromLabel = normalizeParcelVertexLabel(ringLabels[index], index);
    const toLabel = normalizeParcelVertexLabel(
      ringLabels[(index + 1) % ring.length],
      (index + 1) % ring.length,
    );
    return {
      fromLabel,
      toLabel,
      azimuthDeg: inverse.azimuthDeg,
      azimuthText: formatCadNorthAzimuthDms(inverse.azimuthDeg),
      bearing: inverse.bearing,
      distanceMeters: inverse.distance,
    };
  });

  return {
    parcelName,
    ...closureSummary,
    courseCount: courses.length,
    courses,
  };
};
