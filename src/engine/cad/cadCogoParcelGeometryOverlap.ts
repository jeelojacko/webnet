import type { CadWorldPoint } from './cadGeometry';
import {
  cadCross,
  cadPointInTriangle,
  cadPolygonAreaSquareMeters,
  cadPolygonSignedAreaDouble,
  normalizeParcelPolygonVertices,
  PARCEL_POINT_TOLERANCE,
  parcelPointsMatch,
} from './cadCogoParcelGeometryPrimitives';

export const cadLineIntersectionPoint = (
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

export const cadDeduplicatePolygonVertices = (
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

export const cadClipConvexPolygon = (
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
      const previousIndex =
        remainingIndices[(index + remainingIndices.length - 1) % remainingIndices.length]!;
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

export const cadBuildParcelOverlapAreaSquareMeters = (
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
