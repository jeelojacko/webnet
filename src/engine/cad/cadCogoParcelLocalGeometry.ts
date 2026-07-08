import { cadDistance, type CadWorldPoint } from './cadGeometry';

export interface CadParcelLayoutLocalPoint {
  x: number;
  y: number;
}
export const cadBuildParcelLayoutLocalPoints = (
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

export const cadBuildParcelLayoutLocalToWorldPoint = (
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

export const cadDeduplicateLocalPolygonVertices = (
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

export const cadClipLocalPolygonAgainstVerticalBoundary = (
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

export const cadClipLocalPolygonToVerticalStrip = (
  vertices: readonly CadParcelLayoutLocalPoint[],
  startX: number,
  endX: number,
): CadParcelLayoutLocalPoint[] => {
  const leftClipped = cadClipLocalPolygonAgainstVerticalBoundary(vertices, startX, true);
  if (leftClipped.length < 3) return [];
  return cadClipLocalPolygonAgainstVerticalBoundary(leftClipped, endX, false);
};

export const cadClipLocalPolygonAgainstHorizontalBoundary = (
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