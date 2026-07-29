import type { CadWorldPoint } from './cadGeometry';

export const normalizeParcelVertexLabel = (label: string | undefined, index: number): string => {
  if (!label) return `V${index + 1}`;
  const trimmed = label.trim();
  return /^[A-Za-z0-9_-]+$/.test(trimmed) ? trimmed : `V${index + 1}`;
};

const isGenericParcelVertexLabel = (label: string): boolean =>
  /^V\d+$/i.test(label) || /^FRONT\d+$/i.test(label) || /^AUTO\d+$/i.test(label);

export const normalizeParcelSourceVertexLabels = (vertexLabels: readonly string[]): string[] => {
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

export const cadPointInTriangle = (
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
  for (
    let index = 0, previous = polygon.length - 1;
    index < polygon.length;
    previous = index, index += 1
  ) {
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

export const cadPointStrictlyInPolygon = (
  point: CadWorldPoint,
  polygon: readonly CadWorldPoint[],
): boolean =>
  cadPointInPolygon(point, polygon) &&
  !polygon.some((start, index) =>
    cadPointOnSegment(point, start, polygon[(index + 1) % polygon.length]!),
  );
