import { cadDistance, type CadWorldPoint } from './cadGeometry';
import type { CadLineEntity, CadParcelEntity } from './cadTypes';
import { cadBuildParcelClosureSummary, parcelPointsMatch } from './cadCogoParcelGeometry';
import {
  cadBuildParcelLayoutLocalToWorldPoint,
  cadClipLocalPolygonAgainstHorizontalBoundary,
  cadClipLocalPolygonToVerticalStrip,
} from './cadCogoParcelLocalGeometry';
import type { CadParcelLayoutGeneratedParcelDraft } from './cadCogoParcelLayoutTypes';
import {
  cadDotWorldPoint,
  cadSampleParcelLayoutFrontagePath,
  type CadParcelLayoutFrontagePath,
} from './cadCogoParcelLayoutPath';

export const cadDeduplicateWorldPolygonVertices = (
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

export const cadSimplifyCollinearWorldPolygonVertices = (
  vertices: readonly CadWorldPoint[],
  tolerance = 1e-7,
): CadWorldPoint[] => {
  let simplified = cadDeduplicateWorldPolygonVertices(vertices, tolerance);
  let changed = true;
  while (changed && simplified.length > 3) {
    changed = false;
    const nextSimplified: CadWorldPoint[] = [];
    for (let index = 0; index < simplified.length; index += 1) {
      const previous = simplified[(index + simplified.length - 1) % simplified.length]!;
      const current = simplified[index]!;
      const next = simplified[(index + 1) % simplified.length]!;
      const previousVector = {
        x: current.x - previous.x,
        y: current.y - previous.y,
      };
      const nextVector = {
        x: next.x - current.x,
        y: next.y - current.y,
      };
      const cross = Math.abs(previousVector.x * nextVector.y - previousVector.y * nextVector.x);
      const lengthProduct = Math.max(
        1,
        Math.hypot(previousVector.x, previousVector.y) *
          Math.hypot(nextVector.x, nextVector.y),
      );
      const dot = previousVector.x * nextVector.x + previousVector.y * nextVector.y;
      if (cross <= tolerance * lengthProduct && dot >= -tolerance) {
        changed = true;
        continue;
      }
      nextSimplified.push(current);
    }
    simplified = nextSimplified;
  }
  return simplified;
};

export const cadClipPolygonAgainstLineHalfPlane = (
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

export const cadBuildParcelLayoutGeneratedParcelFromFrontageInterval = (
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

export const cadBuildDepthLimitedStripGeneratedParcel = (
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

export const cadBuildDepthLimitedStripRearRemainder = (
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

export const cadBuildDepthLimitedParcelFromFrontage = (
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

export const cadBuildAutoParcelVertexLabels = (
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
