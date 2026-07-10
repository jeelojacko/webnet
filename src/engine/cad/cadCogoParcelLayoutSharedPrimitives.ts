import {
  cadAzimuthDeg,
  cadDistance,
  cadNormalizeAngleDeg,
  cadPointOnCircle,
  cadSignedSweepDeg,
  type CadWorldPoint,
} from './cadGeometry';
import type { CadLineEntity, CadParcelEntity } from './cadTypes';
import {
  cadBuildParcelClosureSummary,
  cadPointInPolygon,
  cadPointOnSegment,
  cadPolygonSignedAreaDouble,
  normalizeParcelPolygonVertices,
  parcelPointsMatch,
} from './cadCogoParcelGeometry';
import type { CadParcelSplitDraft } from './cadCogoParcelSplit';
import type { CadParcelLayoutFrontagePathArcSegment, CadParcelLayoutFrontagePath } from './cadCogoParcelLayoutPath';
import type { CadParcelLayoutSplitAlternative, CadParcelLayoutSplitDraft } from './cadCogoParcelLayoutTypes';

export interface CadMatchedParcelFrontageEdge {
  edgeIndex: number;
  startVertexIndex: number;
  endVertexIndex: number;
  start: CadWorldPoint;
  end: CadWorldPoint;
  startLabel: string;
  endLabel: string;
  lengthMeters: number;
}

export interface CadParcelSelectedSplitSide {
  vertices: CadWorldPoint[];
  labels: string[];
  areaSquareMeters: number;
}

export * from './cadCogoParcelLayoutPath';

export * from './cadCogoParcelLayoutGeneratedPrimitives';

export const cadDistancePointToSegment = (
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

export const cadAngleWithinArcSweep = (
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

export const cadDistancePointToArcSegment = (
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

export const cadBuildParcelLayoutPathDepthMeters = (
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

export const cadMatchFrontageLineToParcelEdge = (
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

export const cadBuildEdgeInteriorSamplePoint = (
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

export const cadSelectParcelSplitSide = (
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

export const cadBuildParcelLayoutDraft = (
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

export const cadBuildParcelSwingSplitDraft = (
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
