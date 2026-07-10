import {
  cadInfiniteLineIntersection,
  cadIntersectArcArc,
  cadIntersectInfiniteLineArc,
  cadIntersectSegmentArc,
  cadSegmentIntersection,
} from './cadGeometry';
import {
  buildArcFilletChoices,
  buildSegmentFilletChoices,
  type CadFilletRef,
  type CadFilletResult,
} from './cadTransactionsFilletGeneralHelpers';
import type { CadArcEntity } from './cadTypes';

export const buildZeroRadiusFilletResult = (
  firstRef: CadFilletRef,
  firstPickPoint: { x: number; y: number },
  secondRef: CadFilletRef,
  secondPickPoint: { x: number; y: number },
): (CadFilletResult & { score: number }) | null => {
  let intersections: Array<{ x: number; y: number }> = [];
  if (firstRef.kind === 'segment' && secondRef.kind === 'segment') {
    const point =
      firstRef.entity.type === 'line' && secondRef.entity.type === 'line'
        ? cadInfiniteLineIntersection(firstRef.start, firstRef.end, secondRef.start, secondRef.end)
        : cadSegmentIntersection(firstRef.start, firstRef.end, secondRef.start, secondRef.end);
    intersections = point ? [point] : [];
  } else if (firstRef.kind === 'segment' && secondRef.kind === 'arc') {
    intersections =
      firstRef.entity.type === 'line'
        ? cadIntersectInfiniteLineArc(
            firstRef.start,
            firstRef.end,
            { x: secondRef.entity.centerX, y: secondRef.entity.centerY },
            secondRef.entity.radius,
            secondRef.entity.startAngleDeg,
            secondRef.entity.endAngleDeg,
          )
        : cadIntersectSegmentArc(
            firstRef.start,
            firstRef.end,
            { x: secondRef.entity.centerX, y: secondRef.entity.centerY },
            secondRef.entity.radius,
            secondRef.entity.startAngleDeg,
            secondRef.entity.endAngleDeg,
          );
  } else if (firstRef.kind === 'arc' && secondRef.kind === 'segment') {
    intersections =
      secondRef.entity.type === 'line'
        ? cadIntersectInfiniteLineArc(
            secondRef.start,
            secondRef.end,
            { x: firstRef.entity.centerX, y: firstRef.entity.centerY },
            firstRef.entity.radius,
            firstRef.entity.startAngleDeg,
            firstRef.entity.endAngleDeg,
          )
        : cadIntersectSegmentArc(
            secondRef.start,
            secondRef.end,
            { x: firstRef.entity.centerX, y: firstRef.entity.centerY },
            firstRef.entity.radius,
            firstRef.entity.startAngleDeg,
            firstRef.entity.endAngleDeg,
          );
  } else {
    const firstArc = firstRef.entity as CadArcEntity;
    const secondArc = secondRef.entity as CadArcEntity;
    intersections = cadIntersectArcArc(
      { x: firstArc.centerX, y: firstArc.centerY },
      firstArc.radius,
      firstArc.startAngleDeg,
      firstArc.endAngleDeg,
      { x: secondArc.centerX, y: secondArc.centerY },
      secondArc.radius,
      secondArc.startAngleDeg,
      secondArc.endAngleDeg,
    );
  }
  const bestCandidate =
    intersections
      .map((intersectionPoint) => {
        const firstChoices =
          firstRef.kind === 'segment'
            ? buildSegmentFilletChoices(
                firstRef,
                firstPickPoint,
                intersectionPoint,
                intersectionPoint,
                secondPickPoint,
                true,
              )
            : buildArcFilletChoices(firstRef, firstPickPoint, intersectionPoint);
        const secondChoices =
          secondRef.kind === 'segment'
            ? buildSegmentFilletChoices(
                secondRef,
                secondPickPoint,
                intersectionPoint,
                intersectionPoint,
                firstPickPoint,
                true,
              )
            : buildArcFilletChoices(secondRef, secondPickPoint, intersectionPoint);
        if (firstChoices.length === 0 || secondChoices.length === 0) return null;
        const pair =
          firstChoices
            .flatMap((firstChoice) =>
              secondChoices.map((secondChoice) => ({
                firstChoice,
                secondChoice,
                score: firstChoice.score + secondChoice.score,
              })),
            )
            .sort((left, right) => left.score - right.score)[0] ?? null;
        if (!pair) return null;
        return {
          firstEntity: pair.firstChoice.entity,
          secondEntity: pair.secondChoice.entity,
          arcDefinition: null,
          score: pair.score,
        } as CadFilletResult & { score: number };
      })
      .filter((candidate): candidate is NonNullable<typeof candidate> => candidate != null)
      .sort((left, right) => left.score - right.score)[0] ?? null;
  return bestCandidate;
};
