import { cadDistance, type CadWorldPoint } from './cadGeometry';
import {
  buildCadInverseSummary,
  formatCadNorthAzimuthDms,
} from './cadCogoMath';
import { normalizeParcelVertexLabel } from './cadCogoParcelGeometryPrimitives';
import type {
  CadParcelClosureSummary,
  CadParcelReportSummary,
} from './cadCogoParcelGeometryTypes';

const sanitizeAdjacentDuplicateVertices = (
  vertices: readonly CadWorldPoint[],
): CadWorldPoint[] =>
  vertices.filter((vertex, index, list) => {
    const previous = list[index - 1];
    if (!previous) return true;
    return Math.abs(vertex.x - previous.x) > 1e-9 || Math.abs(vertex.y - previous.y) > 1e-9;
  });

const buildParcelRing = (vertices: readonly CadWorldPoint[]): CadWorldPoint[] | null => {
  const sanitizedVertices = sanitizeAdjacentDuplicateVertices(vertices);
  if (sanitizedVertices.length < 3) return null;

  const firstVertex = sanitizedVertices[0]!;
  const lastVertex = sanitizedVertices[sanitizedVertices.length - 1]!;
  const isExplicitlyClosed =
    Math.abs(firstVertex.x - lastVertex.x) <= 1e-9 &&
    Math.abs(firstVertex.y - lastVertex.y) <= 1e-9;
  const ring = isExplicitlyClosed ? sanitizedVertices.slice(0, -1) : sanitizedVertices;
  return ring.length >= 3 ? ring : null;
};

const calculateParcelCentroid = (
  ring: readonly CadWorldPoint[],
  signedDoubleArea: number,
  centroidXAccumulator: number,
  centroidYAccumulator: number,
): CadWorldPoint => {
  if (Math.abs(signedDoubleArea) <= 1e-9) {
    const average = ring.reduce(
      (accumulator, vertex) => ({
        x: accumulator.x + vertex.x,
        y: accumulator.y + vertex.y,
      }),
      { x: 0, y: 0 },
    );
    return {
      x: average.x / ring.length,
      y: average.y / ring.length,
    };
  }

  return {
    x: centroidXAccumulator / (3 * signedDoubleArea),
    y: centroidYAccumulator / (3 * signedDoubleArea),
  };
};

export const cadBuildParcelClosureSummary = (
  vertices: readonly CadWorldPoint[],
): CadParcelClosureSummary | null => {
  const sanitizedVertices = sanitizeAdjacentDuplicateVertices(vertices);
  if (sanitizedVertices.length < 3) return null;

  const firstVertex = sanitizedVertices[0]!;
  const lastVertex = sanitizedVertices[sanitizedVertices.length - 1]!;
  const ring = buildParcelRing(sanitizedVertices);
  if (!ring) return null;

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
  const centroid = calculateParcelCentroid(
    ring,
    signedDoubleArea,
    centroidXAccumulator,
    centroidYAccumulator,
  );

  return {
    areaSquareMeters,
    perimeterMeters,
    closureDeltaX,
    closureDeltaY,
    closureDistanceMeters,
    centroid,
  };
};

const buildParcelReportRingLabels = ({
  isExplicitlyClosed,
  vertexLabels,
  vertices,
}: {
  isExplicitlyClosed: boolean;
  vertexLabels: readonly string[];
  vertices: readonly CadWorldPoint[];
}): string[] => {
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

  return isExplicitlyClosed &&
    sanitizedLabels.length > 1 &&
    sanitizedLabels[0] === sanitizedLabels[sanitizedLabels.length - 1]
    ? sanitizedLabels.slice(0, -1)
    : sanitizedLabels;
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

  const sanitizedVertices = sanitizeAdjacentDuplicateVertices(vertices);
  const firstVertex = sanitizedVertices[0]!;
  const lastVertex = sanitizedVertices[sanitizedVertices.length - 1]!;
  const isExplicitlyClosed =
    Math.abs(firstVertex.x - lastVertex.x) <= 1e-9 &&
    Math.abs(firstVertex.y - lastVertex.y) <= 1e-9;
  const ring = isExplicitlyClosed ? sanitizedVertices.slice(0, -1) : sanitizedVertices;
  if (ring.length < 3) return null;

  const ringLabels = buildParcelReportRingLabels({
    isExplicitlyClosed,
    vertexLabels,
    vertices,
  });

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
