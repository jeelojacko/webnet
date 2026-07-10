import { cadDistance, type CadWorldPoint } from './cadGeometry';
import type { CadLineEntity, CadParcelEntity } from './cadTypes';
import { cadBuildParcelClosureSummary, normalizeParcelPolygonVertices } from './cadCogoParcelGeometry';
import type { CadParcelLayoutSplitAlternative, CadParcelLayoutSplitDraft } from './cadCogoParcelLayoutTypes';
import {
  cadBuildParcelSwingSplitDraft,
  cadMatchFrontageLineToParcelEdge,
  type CadMatchedParcelFrontageEdge,
} from './cadCogoParcelLayoutSharedPrimitives';
import type { CadParcelSlideEvaluation } from './cadCogoParcelLayoutSlide';

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
