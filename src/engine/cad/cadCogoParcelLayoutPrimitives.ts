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
  type CadParcelLayoutFrontagePath,
  type CadParcelLayoutFrontagePathArcSegment,
} from './cadCogoParcelLayoutPath';
import {
  type CadParcelAutoLayoutDraft,
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
