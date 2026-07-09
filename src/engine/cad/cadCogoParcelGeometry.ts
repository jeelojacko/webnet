import {
  cadDistance,
  type CadNamedPoint,
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
import {
  buildCadInverseSummary,
  formatCadNorthAzimuthDms,
} from './cadCogoMath';
import {
  buildParcelLineCandidate,
  buildParcelNodeMap,
} from './cadCogoParcelDiagnostics';

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
export interface CadParcelSourceDraft {
  vertices: CadWorldPoint[];
  vertexLabels: string[];
  sourceEntityIds: CadEntityId[];
}
export const normalizeParcelVertexLabel = (label: string | undefined, index: number): string => {
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

export const PARCEL_POINT_TOLERANCE = 1e-6;

const quantizeParcelCoordinate = (value: number): number =>
  Math.round(value / PARCEL_POINT_TOLERANCE);

export const parcelPointKey = (point: CadWorldPoint): string =>
  `${quantizeParcelCoordinate(point.x)}:${quantizeParcelCoordinate(point.y)}`;

export const parcelPointsMatch = (left: CadWorldPoint, right: CadWorldPoint): boolean =>
  Math.abs(left.x - right.x) <= PARCEL_POINT_TOLERANCE &&
  Math.abs(left.y - right.y) <= PARCEL_POINT_TOLERANCE;

export const compareParcelPoints = (left: CadWorldPoint, right: CadWorldPoint): number =>
  left.x === right.x ? left.y - right.y : left.x - right.x;

export const cadPointListsMatch = (
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

export const normalizeParcelPolygonVertices = (
  vertices: readonly CadWorldPoint[],
): CadWorldPoint[] => {
  if (vertices.length < 2) return vertices.map((vertex) => ({ x: vertex.x, y: vertex.y }));
  const normalized = vertices.map((vertex) => ({ x: vertex.x, y: vertex.y }));
  if (parcelPointsMatch(normalized[0]!, normalized[normalized.length - 1]!)) {
    normalized.pop();
  }
  return normalized;
};

export const cadPolygonSignedAreaDouble = (vertices: readonly CadWorldPoint[]): number => {
  if (vertices.length < 3) return 0;
  let areaDouble = 0;
  for (let index = 0; index < vertices.length; index += 1) {
    const current = vertices[index]!;
    const next = vertices[(index + 1) % vertices.length]!;
    areaDouble += current.x * next.y - next.x * current.y;
  }
  return areaDouble;
};

export const cadPolygonAreaSquareMeters = (vertices: readonly CadWorldPoint[]): number =>
  Math.abs(cadPolygonSignedAreaDouble(vertices)) / 2;

export const cadCross = (origin: CadWorldPoint, left: CadWorldPoint, right: CadWorldPoint): number =>
  (left.x - origin.x) * (right.y - origin.y) - (left.y - origin.y) * (right.x - origin.x);

export const cadPointOnSegment = (
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

export const cadPointInPolygon = (
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

export const cadPointStrictlyInPolygon = (
  point: CadWorldPoint,
  polygon: readonly CadWorldPoint[],
): boolean =>
  cadPointInPolygon(point, polygon) &&
  !polygon.some((start, index) => cadPointOnSegment(point, start, polygon[(index + 1) % polygon.length]!));

export * from './cadCogoParcelDiagnostics';

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
