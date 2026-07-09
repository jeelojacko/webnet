import {
  cadAngleDegFromCenter,
  cadDistance,
  cadInfiniteLineIntersection,
  cadNormalizeAngleDeg,
  cadProjectPointOntoInfiniteLine,
} from './cadGeometry';
import type { CadLineEntity } from './cadTypes';
const buildFilletRayDirection = (
  line: CadLineEntity,
  intersectionPoint: { x: number; y: number },
  pickPoint: { x: number; y: number },
): { directionX: number; directionY: number; trimStart: boolean } | null => {
  const start = { x: line.fromX, y: line.fromY };
  const end = { x: line.toX, y: line.toY };
  const pickProjection = cadProjectPointOntoInfiniteLine(pickPoint, start, end);
  const intersectionProjection = cadProjectPointOntoInfiniteLine(intersectionPoint, start, end);
  const projectedPick = pickProjection.point;
  const keepStartSide =
    Math.abs(pickProjection.t - intersectionProjection.t) <= 1e-9
      ? cadDistance(projectedPick, start) <= cadDistance(projectedPick, end)
      : pickProjection.t <= intersectionProjection.t;
  const trimStart = !keepStartSide;
  const primaryPoint = keepStartSide ? start : end;
  const secondaryPoint = keepStartSide ? end : start;
  const primaryVector = {
    x: primaryPoint.x - intersectionPoint.x,
    y: primaryPoint.y - intersectionPoint.y,
  };
  const primaryLength = Math.hypot(primaryVector.x, primaryVector.y);
  const projectedVector = {
    x: projectedPick.x - intersectionPoint.x,
    y: projectedPick.y - intersectionPoint.y,
  };
  const projectedLength = Math.hypot(projectedVector.x, projectedVector.y);
  const fallbackVector =
    projectedLength > 1e-9
      ? projectedVector
      : primaryLength > 1e-9
        ? primaryVector
        : {
            x: secondaryPoint.x - intersectionPoint.x,
            y: secondaryPoint.y - intersectionPoint.y,
          };
  const fallbackLength = Math.hypot(fallbackVector.x, fallbackVector.y);
  if (fallbackLength <= 1e-9) return null;
  return {
    directionX: fallbackVector.x / fallbackLength,
    directionY: fallbackVector.y / fallbackLength,
    trimStart,
  };
};

const buildFilletRayDirectionForEndpoint = (
  line: CadLineEntity,
  intersectionPoint: { x: number; y: number },
  trimStart: boolean,
): { directionX: number; directionY: number; trimStart: boolean } | null => {
  const primaryPoint = trimStart
    ? { x: line.toX, y: line.toY }
    : { x: line.fromX, y: line.fromY };
  const secondaryPoint = trimStart
    ? { x: line.fromX, y: line.fromY }
    : { x: line.toX, y: line.toY };
  const primaryVector = {
    x: primaryPoint.x - intersectionPoint.x,
    y: primaryPoint.y - intersectionPoint.y,
  };
  const primaryLength = Math.hypot(primaryVector.x, primaryVector.y);
  const fallbackVector =
    primaryLength > 1e-9
      ? primaryVector
      : {
          x: secondaryPoint.x - intersectionPoint.x,
          y: secondaryPoint.y - intersectionPoint.y,
        };
  const fallbackLength = Math.hypot(fallbackVector.x, fallbackVector.y);
  if (fallbackLength <= 1e-9) return null;
  return {
    directionX: fallbackVector.x / fallbackLength,
    directionY: fallbackVector.y / fallbackLength,
    trimStart,
  };
};

const filletRayPreferencePenalty = (
  preferredRay: { directionX: number; directionY: number } | null,
  candidateRay: { directionX: number; directionY: number },
): number => {
  if (!preferredRay) return 0;
  const dot =
    preferredRay.directionX * candidateRay.directionX +
    preferredRay.directionY * candidateRay.directionY;
  return dot >= 0.999 ? 0 : dot >= 0 ? 1000 : 1_000_000;
};

const lineSideValue = (
  lineStart: { x: number; y: number },
  lineEnd: { x: number; y: number },
  point: { x: number; y: number },
): number =>
  (lineEnd.x - lineStart.x) * (point.y - lineStart.y) -
  (lineEnd.y - lineStart.y) * (point.x - lineStart.x);

export const sideMismatchPenalty = (
  lineStart: { x: number; y: number },
  lineEnd: { x: number; y: number },
  referencePoint: { x: number; y: number },
  candidatePoint: { x: number; y: number },
): number => {
  const referenceSide = lineSideValue(lineStart, lineEnd, referencePoint);
  const candidateSide = lineSideValue(lineStart, lineEnd, candidatePoint);
  if (Math.abs(referenceSide) <= 1e-9 || Math.abs(candidateSide) <= 1e-9) return 0;
  return Math.sign(referenceSide) === Math.sign(candidateSide) ? 0 : 1_000_000;
};

const buildCadLineFilletCandidate = (
  firstLine: CadLineEntity,
  firstPickPoint: { x: number; y: number },
  secondLine: CadLineEntity,
  secondPickPoint: { x: number; y: number },
  radius: number,
  intersectionPoint: { x: number; y: number },
  firstRay: { directionX: number; directionY: number; trimStart: boolean },
  secondRay: { directionX: number; directionY: number; trimStart: boolean },
): {
  firstLine: CadLineEntity;
  secondLine: CadLineEntity;
  arcDefinition: {
    center: { x: number; y: number };
    radius: number;
    startAngleDeg: number;
    endAngleDeg: number;
  };
  score: number;
} | null => {
  const dotProduct = Math.max(
    -1,
    Math.min(1, firstRay.directionX * secondRay.directionX + firstRay.directionY * secondRay.directionY),
  );
  const angle = Math.acos(dotProduct);
  if (!Number.isFinite(angle) || angle <= 1e-6 || Math.abs(Math.PI - angle) <= 1e-6) return null;

  const tangentOffset = radius / Math.tan(angle / 2);
  const centerOffset = radius / Math.sin(angle / 2);
  if (!Number.isFinite(tangentOffset) || !Number.isFinite(centerOffset)) return null;

  const firstTangentPoint = {
    x: intersectionPoint.x + firstRay.directionX * tangentOffset,
    y: intersectionPoint.y + firstRay.directionY * tangentOffset,
  };
  const secondTangentPoint = {
    x: intersectionPoint.x + secondRay.directionX * tangentOffset,
    y: intersectionPoint.y + secondRay.directionY * tangentOffset,
  };
  const bisectorVector = {
    x: firstRay.directionX + secondRay.directionX,
    y: firstRay.directionY + secondRay.directionY,
  };
  const bisectorLength = Math.hypot(bisectorVector.x, bisectorVector.y);
  if (bisectorLength <= 1e-9) return null;
  const centerPoint = {
    x: intersectionPoint.x + (bisectorVector.x / bisectorLength) * centerOffset,
    y: intersectionPoint.y + (bisectorVector.y / bisectorLength) * centerOffset,
  };
  const startAngleDeg = cadAngleDegFromCenter(centerPoint, firstTangentPoint);
  const endAngleSeedDeg = cadAngleDegFromCenter(centerPoint, secondTangentPoint);
  const ccwDeltaDeg = cadNormalizeAngleDeg(endAngleSeedDeg - startAngleDeg);
  const signedSweepDeg = ccwDeltaDeg <= 180 ? ccwDeltaDeg : -(360 - ccwDeltaDeg);
  if (Math.abs(signedSweepDeg) <= 1e-6 || Math.abs(signedSweepDeg) >= 180 - 1e-6) return null;

  const nextFirstLine: CadLineEntity = firstRay.trimStart
    ? {
        ...firstLine,
        fromX: firstTangentPoint.x,
        fromY: firstTangentPoint.y,
      }
    : {
        ...firstLine,
        toX: firstTangentPoint.x,
        toY: firstTangentPoint.y,
      };
  const nextSecondLine: CadLineEntity = secondRay.trimStart
    ? {
        ...secondLine,
        fromX: secondTangentPoint.x,
        fromY: secondTangentPoint.y,
      }
    : {
        ...secondLine,
        toX: secondTangentPoint.x,
        toY: secondTangentPoint.y,
      };

  return {
    firstLine: nextFirstLine,
    secondLine: nextSecondLine,
    arcDefinition: {
      center: centerPoint,
      radius,
      startAngleDeg,
      endAngleDeg: startAngleDeg + signedSweepDeg,
    },
    score:
      sideMismatchPenalty(
        { x: firstLine.fromX, y: firstLine.fromY },
        { x: firstLine.toX, y: firstLine.toY },
        secondPickPoint,
        centerPoint,
      ) +
      sideMismatchPenalty(
        { x: secondLine.fromX, y: secondLine.fromY },
        { x: secondLine.toX, y: secondLine.toY },
        firstPickPoint,
        centerPoint,
      ) +
      cadDistance(firstPickPoint, firstTangentPoint) +
      cadDistance(secondPickPoint, secondTangentPoint),
  };
};

const buildCadLineCornerCandidate = (
  firstLine: CadLineEntity,
  firstPickPoint: { x: number; y: number },
  secondLine: CadLineEntity,
  secondPickPoint: { x: number; y: number },
  intersectionPoint: { x: number; y: number },
  firstRay: { directionX: number; directionY: number; trimStart: boolean },
  secondRay: { directionX: number; directionY: number; trimStart: boolean },
): {
  firstLine: CadLineEntity;
  secondLine: CadLineEntity;
  score: number;
} => {
  const nextFirstLine: CadLineEntity = firstRay.trimStart
    ? {
        ...firstLine,
        fromX: intersectionPoint.x,
        fromY: intersectionPoint.y,
      }
    : {
        ...firstLine,
        toX: intersectionPoint.x,
        toY: intersectionPoint.y,
      };
  const nextSecondLine: CadLineEntity = secondRay.trimStart
    ? {
        ...secondLine,
        fromX: intersectionPoint.x,
        fromY: intersectionPoint.y,
      }
    : {
        ...secondLine,
        toX: intersectionPoint.x,
        toY: intersectionPoint.y,
      };
  return {
    firstLine: nextFirstLine,
    secondLine: nextSecondLine,
    score:
      sideMismatchPenalty(
        { x: firstLine.fromX, y: firstLine.fromY },
        { x: firstLine.toX, y: firstLine.toY },
        secondPickPoint,
        intersectionPoint,
      ) +
      sideMismatchPenalty(
        { x: secondLine.fromX, y: secondLine.fromY },
        { x: secondLine.toX, y: secondLine.toY },
        firstPickPoint,
        intersectionPoint,
      ) +
      cadDistance(firstPickPoint, intersectionPoint) +
      cadDistance(secondPickPoint, intersectionPoint),
  };
};

export const buildCadLineFillet = (
  firstLine: CadLineEntity,
  firstPickPoint: { x: number; y: number },
  secondLine: CadLineEntity,
  secondPickPoint: { x: number; y: number },
  radius: number,
): {
  firstLine: CadLineEntity;
  secondLine: CadLineEntity;
  arcDefinition: {
    center: { x: number; y: number };
    radius: number;
    startAngleDeg: number;
    endAngleDeg: number;
  } | null;
} | null => {
  if (!Number.isFinite(radius) || radius < -1e-9) return null;
  const firstStart = { x: firstLine.fromX, y: firstLine.fromY };
  const firstEnd = { x: firstLine.toX, y: firstLine.toY };
  const secondStart = { x: secondLine.fromX, y: secondLine.fromY };
  const secondEnd = { x: secondLine.toX, y: secondLine.toY };
  const intersectionPoint = cadInfiniteLineIntersection(firstStart, firstEnd, secondStart, secondEnd);
  if (!intersectionPoint) return null;

  const preferredFirstRay = buildFilletRayDirection(firstLine, intersectionPoint, firstPickPoint);
  const preferredSecondRay = buildFilletRayDirection(secondLine, intersectionPoint, secondPickPoint);
  const firstRayCandidates = [true, false]
    .map((trimStart) => buildFilletRayDirectionForEndpoint(firstLine, intersectionPoint, trimStart))
    .filter((candidate): candidate is NonNullable<typeof candidate> => candidate != null);
  const secondRayCandidates = [true, false]
    .map((trimStart) => buildFilletRayDirectionForEndpoint(secondLine, intersectionPoint, trimStart))
    .filter((candidate): candidate is NonNullable<typeof candidate> => candidate != null);
  if (firstRayCandidates.length === 0 || secondRayCandidates.length === 0) return null;

  const firstPreferredCandidates = firstRayCandidates
    .filter(
      (candidate) =>
        preferredFirstRay == null
          ? true
          : candidate.trimStart === preferredFirstRay.trimStart &&
            filletRayPreferencePenalty(preferredFirstRay, candidate) === 0,
    )
    .sort((left, right) => {
      const leftPenalty = filletRayPreferencePenalty(preferredFirstRay, left);
      const rightPenalty = filletRayPreferencePenalty(preferredFirstRay, right);
      return leftPenalty - rightPenalty;
    });
  const secondPreferredCandidates = secondRayCandidates
    .filter(
      (candidate) =>
        preferredSecondRay == null
          ? true
          : candidate.trimStart === preferredSecondRay.trimStart &&
            filletRayPreferencePenalty(preferredSecondRay, candidate) === 0,
    )
    .sort((left, right) => {
      const leftPenalty = filletRayPreferencePenalty(preferredSecondRay, left);
      const rightPenalty = filletRayPreferencePenalty(preferredSecondRay, right);
      return leftPenalty - rightPenalty;
    });
  if (firstPreferredCandidates.length === 0 || secondPreferredCandidates.length === 0) return null;

  if (radius <= 1e-9) {
    const bestCornerCandidate =
      firstPreferredCandidates
        .flatMap((firstRay) =>
          secondPreferredCandidates.map((secondRay) =>
            buildCadLineCornerCandidate(
              firstLine,
              firstPickPoint,
              secondLine,
              secondPickPoint,
              intersectionPoint,
              firstRay,
              secondRay,
            ),
          ),
        )
        .sort((left, right) => left.score - right.score)[0] ?? null;
    if (!bestCornerCandidate) return null;
    return {
      firstLine: bestCornerCandidate.firstLine,
      secondLine: bestCornerCandidate.secondLine,
      arcDefinition: null,
    };
  }

  const bestCandidate =
    firstPreferredCandidates
      .flatMap((firstRay) =>
        secondPreferredCandidates.map((secondRay) =>
          buildCadLineFilletCandidate(
            firstLine,
            firstPickPoint,
            secondLine,
            secondPickPoint,
            radius,
            intersectionPoint,
            firstRay,
            secondRay,
          ),
        ),
      )
      .filter((candidate): candidate is NonNullable<typeof candidate> => candidate != null)
      .sort((left, right) => left.score - right.score)[0] ?? null;
  if (!bestCandidate) return null;

  return {
    firstLine: bestCandidate.firstLine,
    secondLine: bestCandidate.secondLine,
    arcDefinition: bestCandidate.arcDefinition,
  };
};
