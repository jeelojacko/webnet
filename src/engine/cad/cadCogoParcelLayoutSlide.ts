import { cadAzimuthDeg } from './cadGeometry';
import type { CadLineEntity, CadParcelEntity } from './cadTypes';
import { cadBuildParcelClosureSummary } from './cadCogoParcelGeometry';
import { cadBuildParcelSplitLineDraftFromAzimuth } from './cadCogoParcelSplit';
import type { CadParcelLayoutSplitAlternative, CadParcelLayoutSplitDraft } from './cadCogoParcelLayoutTypes';
import {
  cadBuildEdgeInteriorSamplePoint,
  cadBuildParcelLayoutDraft,
  cadMatchFrontageLineToParcelEdge,
  cadSelectParcelSplitSide,
  type CadMatchedParcelFrontageEdge,
} from './cadCogoParcelLayoutSharedPrimitives';

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
