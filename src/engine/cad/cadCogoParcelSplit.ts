import {
  cadAngleDegFromCenter,
  cadDistance,
  cadNormalizeAngleDeg,
  cadParseBearingDegrees,
  cadPointFromAzimuthDistance,
  cadSegmentIntersection,
  type CadWorldPoint,
} from './cadGeometry';
import type { CadLineEntity, CadParcelCourseGeometry, CadParcelEntity } from './cadTypes';
import {
  cadBuildParcelClosureSummary,
  cadCross,
  cadPointListsMatch,
  normalizeParcelPolygonVertices,
  parcelPointKey,
  parcelPointsMatch,
  PARCEL_POINT_TOLERANCE,
} from './cadCogoParcelGeometry';
import {
  buildParcelCourseTopology,
  parcelSweepOffsetDeg,
  parcelSubArcGeometry,
  type CadParcelTopologyCourse,
} from './cadParcelArcGeometry';
import { cadIntersectSegmentArc } from './cadGeometryCurveIntersections';
import { cadClassifyParcelPoint, cadPointInCurvedParcel } from './cadParcelContainment';

export interface CadParcelSplitDraft {
  firstVertices: CadWorldPoint[];
  firstVertexLabels: string[];
  secondVertices: CadWorldPoint[];
  secondVertexLabels: string[];
  /**
   * Mixed line/arc course geometry for each child (present only when the
   * parent carried ≥1 true arc). length === child.vertices.length.
   */
  firstCourseGeometry?: CadParcelCourseGeometry[];
  secondCourseGeometry?: CadParcelCourseGeometry[];
  splitStart: CadWorldPoint;
  splitEnd: CadWorldPoint;
}

export type CadParcelSplitRejectionReason =
  | 'INVALID_PARCEL'
  | 'BOUNDARY_OVERLAP'
  | 'VERTEX_CONTACT'
  | 'NO_INTERSECTION'
  | 'TANGENT_ONLY'
  | 'TOO_MANY_CROSSINGS'
  | 'SAME_COURSE_TWICE'
  | 'DEGENERATE_CHILD';

export interface CadParcelSplitLineResult {
  draft: CadParcelSplitDraft | null;
  /** null on success; explicit rejection code otherwise. */
  reason: CadParcelSplitRejectionReason | null;
}

interface CadParcelSplitIntersection {
  courseIndex: number;
  point: CadWorldPoint;
  lineDistance: number;
  courseDistance: number;
}

const rejection = (reason: CadParcelSplitRejectionReason): CadParcelSplitLineResult => ({
  draft: null,
  reason,
});

const subArcGeometry = (
  course: CadParcelTopologyCourse,
  from: CadWorldPoint,
  to: CadWorldPoint,
): CadParcelCourseGeometry | null =>
  course.arc ? parcelSubArcGeometry(course.arc, from, to) : { kind: 'line' };

/**
 * Split-segment × course intersections. Line courses use the finite segment
 * intersection; arc courses use the exact segment×arc seam and convert the
 * hit's angular offset to arc length for deterministic course ordering.
 */
const collectSplitIntersections = (
  topology: readonly CadParcelTopologyCourse[],
  splitStart: CadWorldPoint,
  splitEnd: CadWorldPoint,
): { hits: CadParcelSplitIntersection[]; vertexContact: boolean } => {
  const hits: CadParcelSplitIntersection[] = [];
  let vertexContact = false;
  topology.forEach((course) => {
    const points = course.arc
      ? cadIntersectSegmentArc(
          splitStart,
          splitEnd,
          course.arc.center,
          course.arc.radius,
          course.arc.startAngleDeg,
          course.arc.endAngleDeg,
        )
      : (() => {
          const hit = cadSegmentIntersection(splitStart, splitEnd, course.from, course.to);
          return hit ? [hit] : [];
        })();
    points.forEach((point) => {
      if (topology.some((vertex) => parcelPointsMatch(point, vertex.from))) {
        vertexContact = true;
        return;
      }
      const courseDistance = course.arc
        ? Math.abs(
            parcelSweepOffsetDeg(
              course.arc.startAngleDeg,
              cadAngleDegFromCenter(course.arc.center, point),
              course.arc.signedSweepDeg,
            ),
          ) *
          (Math.PI / 180) *
          course.arc.radius
        : cadDistance(course.from, point);
      hits.push({
        courseIndex: course.position,
        point,
        lineDistance: cadDistance(splitStart, point),
        courseDistance,
      });
    });
  });
  return { hits, vertexContact };
};

/** Split line lying along a straight course with a shared interval (overlap). */
const splitOverlapsBoundary = (
  topology: readonly CadParcelTopologyCourse[],
  splitStart: CadWorldPoint,
  splitEnd: CadWorldPoint,
): boolean =>
  topology.some((course) => {
    if (course.arc) return false;
    const splitLength = cadDistance(splitStart, splitEnd);
    if (splitLength <= 1e-12) return false;
    const collinearTolerance = PARCEL_POINT_TOLERANCE * splitLength;
    const collinear =
      Math.abs(cadCross(splitStart, splitEnd, course.from)) <= collinearTolerance &&
      Math.abs(cadCross(splitStart, splitEnd, course.to)) <= collinearTolerance;
    if (!collinear) return false;
    const dx = splitEnd.x - splitStart.x;
    const dy = splitEnd.y - splitStart.y;
    const lengthSquared = dx * dx + dy * dy;
    if (lengthSquared <= 1e-12) return false;
    const project = (point: CadWorldPoint): number =>
      ((point.x - splitStart.x) * dx + (point.y - splitStart.y) * dy) / lengthSquared;
    const overlapStart = Math.max(0, Math.min(project(course.from), project(course.to)));
    const overlapEnd = Math.min(1, Math.max(project(course.from), project(course.to)));
    return overlapEnd - overlapStart > 1e-9;
  });

interface AugmentedRing {
  vertices: CadWorldPoint[];
  labels: string[];
  geometry: CadParcelCourseGeometry[];
}

const buildAugmentedRing = (
  parcel: CadParcelEntity,
  topology: readonly CadParcelTopologyCourse[],
  hits: readonly CadParcelSplitIntersection[],
  cutLabels: ReadonlyMap<string, string>,
  hasArc: boolean,
): AugmentedRing | null => {
  const vertices: CadWorldPoint[] = [];
  const labels: string[] = [];
  const geometry: CadParcelCourseGeometry[] = [];
  for (const course of topology) {
    const courseHits = hits
      .filter((hit) => hit.courseIndex === course.position)
      .sort((left, right) => left.courseDistance - right.courseDistance);
    let previous = course.from;
    vertices.push(course.from);
    labels.push(parcel.vertexLabels[course.rawIndex] ?? `V${course.rawIndex + 1}`);
    for (const hit of courseHits) {
      const sub = subArcGeometry(course, previous, hit.point);
      if (sub == null) return null;
      geometry.push(sub);
      vertices.push(hit.point);
      labels.push(cutLabels.get(parcelPointKey(hit.point)) ?? 'CUT');
      previous = hit.point;
    }
    const tail = subArcGeometry(course, previous, course.to);
    if (tail == null) return null;
    geometry.push(tail);
  }
  return hasArc ? { vertices, labels, geometry } : { vertices, labels, geometry: [] };
};

const collectChild = (
  ring: AugmentedRing,
  startIndex: number,
  endIndex: number,
  hasArc: boolean,
): { points: CadWorldPoint[]; labels: string[]; geometry: CadParcelCourseGeometry[] } | null => {
  const points: CadWorldPoint[] = [];
  const labels: string[] = [];
  const geometry: CadParcelCourseGeometry[] = [];
  let index = startIndex;
  while (true) {
    points.push(ring.vertices[index]!);
    labels.push(ring.labels[index]!);
    if (index === endIndex) break;
    if (hasArc) geometry.push(ring.geometry[index]!);
    index = (index + 1) % ring.vertices.length;
  }
  if (hasArc) geometry.push({ kind: 'line' });
  return { points, labels, geometry };
};

/**
 * PARCEL_SPLIT kernel: exactly-two-crossing line split with analytic
 * line×line and line×arc intersections. Arc interior hits retire the parent
 * course and mint exact sub-arcs (sweep/length sums conserved); children get
 * fresh course ids at commit. Deterministic by line distance then course
 * distance. Straight parcels take the legacy path bit-for-bit (no geometry
 * attached), arc parcels carry child courseGeometry.
 */
export const cadBuildParcelSplitByLineDraftDetailed = (
  parcel: CadParcelEntity,
  splitLine: CadLineEntity,
): CadParcelSplitLineResult => {
  const splitStart = { x: splitLine.fromX, y: splitLine.fromY };
  const splitEnd = { x: splitLine.toX, y: splitLine.toY };
  if (parcel.vertices.length < 3 || parcel.vertexLabels.length !== parcel.vertices.length) {
    return rejection('INVALID_PARCEL');
  }
  const topology = buildParcelCourseTopology(parcel.vertices, parcel.courseGeometry);
  if (!topology) return rejection('INVALID_PARCEL');

  const { hits, vertexContact } = collectSplitIntersections(topology, splitStart, splitEnd);
  if (vertexContact) return rejection('VERTEX_CONTACT');
  if (splitOverlapsBoundary(topology, splitStart, splitEnd)) return rejection('BOUNDARY_OVERLAP');

  if (hits.length === 0) return rejection('NO_INTERSECTION');
  if (hits.length === 1) {
    return rejection(hits[0]!.courseIndex >= 0 && topology[hits[0]!.courseIndex]!.arc ? 'TANGENT_ONLY' : 'NO_INTERSECTION');
  }
  if (hits.length > 2) return rejection('TOO_MANY_CROSSINGS');

  hits.sort((left, right) => left.lineDistance - right.lineDistance);
  if (hits[0]!.courseIndex === hits[1]!.courseIndex) return rejection('SAME_COURSE_TWICE');

  const cutLabels = new Map<string, string>();
  cutLabels.set(parcelPointKey(hits[0]!.point), 'CUT1');
  cutLabels.set(parcelPointKey(hits[1]!.point), 'CUT2');
  const hasArc = topology.some((course) => course.arc != null);
  const ring = buildAugmentedRing(parcel, topology, hits, cutLabels, hasArc);
  if (!ring) return rejection('INVALID_PARCEL');

  const cut1Index = ring.labels.indexOf('CUT1');
  const cut2Index = ring.labels.indexOf('CUT2');
  if (cut1Index < 0 || cut2Index < 0 || cut1Index === cut2Index) return rejection('INVALID_PARCEL');

  const firstPath = collectChild(ring, cut1Index, cut2Index, hasArc);
  const secondPath = collectChild(ring, cut2Index, cut1Index, hasArc);
  if (!firstPath || !secondPath) return rejection('INVALID_PARCEL');

  const firstSummary = cadBuildParcelClosureSummary(
    firstPath.points,
    hasArc ? { courseGeometry: firstPath.geometry } : undefined,
  );
  const secondSummary = cadBuildParcelClosureSummary(
    secondPath.points,
    hasArc ? { courseGeometry: secondPath.geometry } : undefined,
  );
  if (!firstSummary || !secondSummary) return rejection('DEGENERATE_CHILD');
  if (firstSummary.areaSquareMeters <= 1e-9 || secondSummary.areaSquareMeters <= 1e-9) {
    return rejection('DEGENERATE_CHILD');
  }
  if (cadPointListsMatch(firstPath.points, secondPath.points)) return rejection('DEGENERATE_CHILD');

  return {
    reason: null,
    draft: {
      firstVertices: firstPath.points,
      firstVertexLabels: firstPath.labels,
      secondVertices: secondPath.points,
      secondVertexLabels: secondPath.labels,
      ...(hasArc ? { firstCourseGeometry: firstPath.geometry, secondCourseGeometry: secondPath.geometry } : {}),
      splitStart: hits[0]!.point,
      splitEnd: hits[1]!.point,
    },
  };
};

export const cadBuildParcelSplitByLineDraft = (
  parcel: CadParcelEntity,
  splitLine: CadLineEntity,
): CadParcelSplitDraft | null => cadBuildParcelSplitByLineDraftDetailed(parcel, splitLine).draft;

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
  const firstSummary = cadBuildParcelClosureSummary(
    draft.firstVertices,
    draft.firstCourseGeometry ? { courseGeometry: draft.firstCourseGeometry } : undefined,
  );
  const secondSummary = cadBuildParcelClosureSummary(
    draft.secondVertices,
    draft.secondCourseGeometry ? { courseGeometry: draft.secondCourseGeometry } : undefined,
  );
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

/**
 * PARCEL_SPLIT_AREA kernel: same 1° sweep + refinement passes; every
 * candidate child area is analytic (arc-aware closure). Point-in-parcel uses
 * the exact curved classifier. Achieved error = |left child area − target|;
 * solver tolerance semantics unchanged.
 */
export const cadBuildParcelSplitByAreaDraft = (
  parcel: CadParcelEntity,
  throughPoint: CadWorldPoint,
  targetAreaSquareMeters: number,
): CadParcelSplitDraft | null => {
  if (!Number.isFinite(targetAreaSquareMeters) || targetAreaSquareMeters <= 0) return null;
  const parcelVertices = normalizeParcelPolygonVertices(parcel.vertices);
  if (parcelVertices.length < 3) return null;
  if (cadClassifyParcelPoint(parcel, throughPoint) === 'boundary') return null;
  if (!cadPointInCurvedParcel(parcel, throughPoint)) return null;

  const parcelSummary = cadBuildParcelClosureSummary(parcelVertices, {
    courseGeometry: parcel.courseGeometry,
  });
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
