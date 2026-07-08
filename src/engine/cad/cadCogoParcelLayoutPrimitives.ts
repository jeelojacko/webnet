import {
  cadAzimuthDeg,
  cadDistance,
  cadNormalizeAngleDeg,
  cadPointOnCircle,
  cadSignedSweepDeg,
  type CadNamedPoint,
  type CadWorldPoint,
} from './cadGeometry';
import type { CadEntity, CadLineEntity, CadParcelLayoutSettings, CadParcelEntity } from './cadTypes';
import { type CadEntityIntersection, type CadIntersectionSolution } from './cadCogoMath';
import {
  cadBuildParcelClosureSummary,
  cadPointInPolygon,
  cadPointOnSegment,
  cadPolygonSignedAreaDouble,
  normalizeParcelPolygonVertices,
  PARCEL_POINT_TOLERANCE,
  parcelPointsMatch,
} from './cadCogoParcelGeometry';
import { cadBuildParcelSplitLineDraftFromAzimuth, type CadParcelSplitDraft } from './cadCogoParcelSplit';
import { type CadParcelLayoutFrontageReference } from './cadCogoParcelFrontage';
import {
  cadBuildParcelLayoutLocalToWorldPoint,
  cadClipLocalPolygonAgainstHorizontalBoundary,
  cadClipLocalPolygonToVerticalStrip,
} from './cadCogoParcelLocalGeometry';
import {
  type CadParcelAutoLayoutDraft,
  type CadParcelLayoutGeneratedParcelDraft,
  type CadParcelLayoutSplitAlternative,
  type CadParcelLayoutSplitDraft,
} from './cadCogoParcelLayoutTypes';

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


export interface CadParcelLayoutFrontagePathLineSegment {
  kind: 'line';
  startDistance: number;
  endDistance: number;
  startPoint: CadWorldPoint;
  endPoint: CadWorldPoint;
}

export interface CadParcelLayoutFrontagePathArcSegment {
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

export interface CadParcelLayoutFrontagePath {
  segments: CadParcelLayoutFrontagePathSegment[];
  totalLengthMeters: number;
}

export interface CadParcelLayoutFrontageSample {
  point: CadWorldPoint;
  tangent: CadWorldPoint;
}

export const cadDotWorldPoint = (left: CadWorldPoint, right: CadWorldPoint): number =>
  left.x * right.x + left.y * right.y;

export const cadBuildParcelLayoutFrontagePath = (
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

export const cadSampleParcelLayoutFrontagePath = (
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

export const cadBuildParcelLayoutFrontageSubPath = (
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

export interface CadParcelSlideEvaluation {
  draft: CadParcelLayoutSplitDraft;
  differenceSquareMeters: number;
  positionMeters: number;
}

export const evaluateParcelSlideAtFrontageDistance = (
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

export const solveParcelSlideDraft = (
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

export interface CadParcelSwingBoundarySample {
  distanceAlongPathMeters: number;
  cutEdgeIndex: number;
  cutPoint: CadWorldPoint;
}

export const cadBuildSwingBoundarySamples = (
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

export const cadEvaluateParcelSwingAtBoundaryDistance = (
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

export const solveParcelSwingDraft = (
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
