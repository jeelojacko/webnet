import {
  cadDistance,
  cadPointOnCircle,
  type CadWorldPoint,
} from './cadGeometry';
import type { CadLineEntity, CadParcelEntity } from './cadTypes';
import { cadBuildParcelClosureSummary, normalizeParcelPolygonVertices } from './cadCogoParcelGeometry';
import type { CadParcelLayoutSplitAlternative, CadParcelLayoutSplitDraft } from './cadCogoParcelLayoutTypes';
import {
  cadBuildParcelSwingSplitDraft,
  cadMatchFrontageLineToParcelEdge,
  type CadMatchedParcelFrontageEdge,
} from './cadCogoParcelLayoutSharedPrimitives';
import type { CadParcelSlideEvaluation } from './cadCogoParcelLayoutSlide';
import {
  describeParcelArcCourse,
  parcelCourseCanonicalKind,
  type CadParcelArcMetrics,
} from './cadParcelArcGeometry';

export interface CadParcelSwingBoundarySample {
  distanceAlongPathMeters: number;
  cutEdgeIndex: number;
  cutPoint: CadWorldPoint;
}

interface SwingCourseInfo {
  lengthMeters: number;
  arc: CadParcelArcMetrics | null;
}

const courseArcMetrics = (
  parcel: CadParcelEntity,
  position: number,
  from: CadWorldPoint,
  to: CadWorldPoint,
): CadParcelArcMetrics | null => {
  const entry = parcel.courseGeometry?.[position];
  if (parcelCourseCanonicalKind(entry) !== 'arc' || entry?.kind !== 'arc') return null;
  return describeParcelArcCourse(from, to, entry.bulge);
};

const buildSwingCourseInfo = (
  parcel: CadParcelEntity,
  ring: readonly CadWorldPoint[],
): SwingCourseInfo[] =>
  ring.map((from, index) => {
    const to = ring[(index + 1) % ring.length]!;
    const arc = courseArcMetrics(parcel, index, from, to);
    return { lengthMeters: arc ? arc.arcLength : cadDistance(from, to), arc };
  });

/** Point along a course at arc-length offset from its start (line or arc). */
const pointAlongCourse = (
  ring: readonly CadWorldPoint[],
  index: number,
  info: SwingCourseInfo,
  offsetMeters: number,
): CadWorldPoint => {
  const start = ring[index]!;
  const end = ring[(index + 1) % ring.length]!;
  if (!info.arc) {
    const length = cadDistance(start, end);
    if (length <= 1e-12) return { ...start };
    const ratio = Math.max(0, Math.min(1, offsetMeters / length));
    return { x: start.x + (end.x - start.x) * ratio, y: start.y + (end.y - start.y) * ratio };
  }
  const sweepSign = info.arc.signedSweepDeg >= 0 ? 1 : -1;
  const angleDeg =
    info.arc.startAngleDeg + (offsetMeters / info.arc.radius) * (180 / Math.PI) * sweepSign;
  return cadPointOnCircle(info.arc.center, info.arc.radius, angleDeg);
};

/**
 * Boundary-perimeter walk from the frontage's far endpoint to the hinge,
 * parameterized by true boundary length (line lengths + arc lengths). Arc
 * courses emit their analytic arc-length samples; straight output is
 * numerically identical to the legacy chord walk.
 */
export const cadBuildSwingBoundarySamples = (
  parcel: CadParcelEntity,
  frontageEdge: CadMatchedParcelFrontageEdge,
  alternative: CadParcelLayoutSplitAlternative,
): CadParcelSwingBoundarySample[] => {
  const ring = normalizeParcelPolygonVertices(parcel.vertices);
  if (ring.length < 3) return [];
  const courseInfo = buildSwingCourseInfo(parcel, ring);
  const hingeVertexIndex =
    alternative === 'start' ? frontageEdge.startVertexIndex : frontageEdge.endVertexIndex;
  const firstPathVertexIndex =
    alternative === 'start' ? frontageEdge.endVertexIndex : frontageEdge.startVertexIndex;
  const samples: CadParcelSwingBoundarySample[] = [];
  let currentVertexIndex = firstPathVertexIndex;
  let distanceAlongPathMeters = 0;
  while (currentVertexIndex !== hingeVertexIndex) {
    const info = courseInfo[currentVertexIndex]!;
    if (info.lengthMeters > 1e-9) {
      samples.push({
        distanceAlongPathMeters,
        cutEdgeIndex: currentVertexIndex,
        cutPoint: { ...ring[currentVertexIndex]! },
      });
      distanceAlongPathMeters += info.lengthMeters;
      samples.push({
        distanceAlongPathMeters,
        cutEdgeIndex: currentVertexIndex,
        cutPoint: { ...ring[(currentVertexIndex + 1) % ring.length]! },
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
  const courseInfo = buildSwingCourseInfo(parcel, ring);
  const hingeVertexIndex =
    alternative === 'start' ? frontageEdge.startVertexIndex : frontageEdge.endVertexIndex;
  const firstPathVertexIndex =
    alternative === 'start' ? frontageEdge.endVertexIndex : frontageEdge.startVertexIndex;
  let currentVertexIndex = firstPathVertexIndex;
  let traveledMeters = 0;
  let selectedEdgeIndex: number | null = null;
  let cutPoint: CadWorldPoint | null = null;
  while (currentVertexIndex !== hingeVertexIndex) {
    const info = courseInfo[currentVertexIndex]!;
    if (
      info.lengthMeters > 1e-9 &&
      distanceAlongPathMeters <= traveledMeters + info.lengthMeters + 1e-9
    ) {
      const offsetMeters = Math.max(
        0,
        Math.min(info.lengthMeters, distanceAlongPathMeters - traveledMeters),
      );
      selectedEdgeIndex = currentVertexIndex;
      cutPoint = pointAlongCourse(ring, currentVertexIndex, info, offsetMeters);
      break;
    }
    traveledMeters += info.lengthMeters;
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
  const childSummary = cadBuildParcelClosureSummary(
    splitDraft.firstVertices,
    splitDraft.firstCourseGeometry ? { courseGeometry: splitDraft.firstCourseGeometry } : undefined,
  );
  if (!childSummary || childSummary.areaSquareMeters <= 1e-9) return null;

  return {
    draft: {
      split: splitDraft,
      alternative,
      frontageLengthMeters: frontageEdge.lengthMeters,
      childAreaSquareMeters: childSummary.areaSquareMeters,
      childVertices: splitDraft.firstVertices.map((vertex) => ({ x: vertex.x, y: vertex.y })),
      childVertexLabels: [...splitDraft.firstVertexLabels],
      ...(splitDraft.firstCourseGeometry
        ? { childCourseGeometry: splitDraft.firstCourseGeometry.map((entry) => ({ ...entry })) }
        : {}),
      remainderVertices: splitDraft.secondVertices.map((vertex) => ({ x: vertex.x, y: vertex.y })),
      remainderVertexLabels: [...splitDraft.secondVertexLabels],
      ...(splitDraft.secondCourseGeometry
        ? { remainderCourseGeometry: splitDraft.secondCourseGeometry.map((entry) => ({ ...entry })) }
        : {}),
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
  const parcelSummary = cadBuildParcelClosureSummary(parcel.vertices, {
    courseGeometry: parcel.courseGeometry,
  });
  if (!parcelSummary || targetAreaSquareMeters >= parcelSummary.areaSquareMeters - 1e-6) return null;
  const frontageEdge = cadMatchFrontageLineToParcelEdge(parcel, frontageLine);
  if (!frontageEdge || frontageEdge.lengthMeters + 1e-9 < minFrontageMeters) return null;
  return solveParcelSwingDraft(parcel, frontageEdge, targetAreaSquareMeters, alternative);
};
