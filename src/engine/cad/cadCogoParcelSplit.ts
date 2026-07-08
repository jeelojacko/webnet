import {
  cadDistance,
  cadNormalizeAngleDeg,
  cadParseBearingDegrees,
  cadPointFromAzimuthDistance,
  cadSegmentIntersection,
  type CadWorldPoint,
} from './cadGeometry';
import type { CadLineEntity, CadParcelEntity } from './cadTypes';
import {
  cadBuildParcelClosureSummary,
  cadCross,
  cadPointInPolygon,
  cadPointListsMatch,
  cadPointOnSegment,
  normalizeParcelPolygonVertices,
  parcelPointKey,
  parcelPointsMatch,
  PARCEL_POINT_TOLERANCE,
} from './cadCogoParcelGeometry';

export interface CadParcelSplitDraft {
  firstVertices: CadWorldPoint[];
  firstVertexLabels: string[];
  secondVertices: CadWorldPoint[];
  secondVertexLabels: string[];
  splitStart: CadWorldPoint;
  splitEnd: CadWorldPoint;
}
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
export const cadBuildParcelSplitByBearingDraft = (
  parcel: CadParcelEntity,
  throughPoint: CadWorldPoint,
  bearing: string,
): CadParcelSplitDraft | null => {
  const azimuthDeg = cadParseBearingDegrees(bearing);
  if (azimuthDeg == null) return null;
  return cadBuildParcelSplitLineDraftFromAzimuth(parcel, throughPoint, azimuthDeg);
};

export const cadBuildParcelSplitLineDraftFromAzimuth = (
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
