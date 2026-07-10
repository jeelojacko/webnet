import { cadAngleDegFromCenter, cadDistance, cadNormalizeAngleDeg, cadPointOnCircle, cadProjectPointOntoInfiniteLine } from './cadGeometry';
import {
  buildArcFilletChoices,
  buildSegmentFilletChoices,
  filletJoinContinuityPenalty,
  tangentDirectionAlongArcSweep,
  type CadFilletRef,
  type CadFilletResult,
} from './cadTransactionsFilletGeneralHelpers';

const buildFilletArcDefinition = (
  centerPoint: { x: number; y: number },
  radius: number,
  firstTangentPoint: { x: number; y: number },
  secondTangentPoint: { x: number; y: number },
): CadFilletResult['arcDefinition'] => {
  const startAngleDeg = cadAngleDegFromCenter(centerPoint, firstTangentPoint);
  const endAngleSeedDeg = cadAngleDegFromCenter(centerPoint, secondTangentPoint);
  const ccwDeltaDeg = cadNormalizeAngleDeg(endAngleSeedDeg - startAngleDeg);
  const signedSweepDeg = ccwDeltaDeg <= 180 ? ccwDeltaDeg : -(360 - ccwDeltaDeg);
  if (Math.abs(signedSweepDeg) <= 1e-6 || Math.abs(signedSweepDeg) >= 180 - 1e-6) return null;
  return {
    center: centerPoint,
    radius,
    startAngleDeg,
    endAngleDeg: startAngleDeg + signedSweepDeg,
  };
};

export const buildFilletResultFromCenter = (
  firstRef: CadFilletRef,
  firstPickPoint: { x: number; y: number },
  secondRef: CadFilletRef,
  secondPickPoint: { x: number; y: number },
  centerPoint: { x: number; y: number },
  radius: number,
): (CadFilletResult & { score: number }) | null => {
  const firstTangentPoint =
    firstRef.kind === 'segment'
      ? cadProjectPointOntoInfiniteLine(centerPoint, firstRef.start, firstRef.end).point
      : cadPointOnCircle(
          { x: firstRef.entity.centerX, y: firstRef.entity.centerY },
          firstRef.entity.radius,
          cadAngleDegFromCenter({ x: firstRef.entity.centerX, y: firstRef.entity.centerY }, centerPoint),
        );
  const secondTangentPoint =
    secondRef.kind === 'segment'
      ? cadProjectPointOntoInfiniteLine(centerPoint, secondRef.start, secondRef.end).point
      : cadPointOnCircle(
          { x: secondRef.entity.centerX, y: secondRef.entity.centerY },
          secondRef.entity.radius,
          cadAngleDegFromCenter({ x: secondRef.entity.centerX, y: secondRef.entity.centerY }, centerPoint),
        );
  if (Math.abs(cadDistance(centerPoint, firstTangentPoint) - radius) > 1e-4) return null;
  if (Math.abs(cadDistance(centerPoint, secondTangentPoint) - radius) > 1e-4) return null;
  const arcDefinition = buildFilletArcDefinition(centerPoint, radius, firstTangentPoint, secondTangentPoint);
  if (!arcDefinition) return null;

  const firstChoices =
    firstRef.kind === 'segment'
      ? buildSegmentFilletChoices(
          firstRef,
          firstPickPoint,
          firstTangentPoint,
          centerPoint,
          secondPickPoint,
          true,
        )
      : buildArcFilletChoices(firstRef, firstPickPoint, firstTangentPoint);
  const secondChoices =
    secondRef.kind === 'segment'
      ? buildSegmentFilletChoices(
          secondRef,
          secondPickPoint,
          secondTangentPoint,
          centerPoint,
          firstPickPoint,
          true,
        )
      : buildArcFilletChoices(secondRef, secondPickPoint, secondTangentPoint);
  if (firstChoices.length === 0 || secondChoices.length === 0) return null;

  const bestPair =
    firstChoices
      .flatMap((firstChoice) => {
        const filletStartDirection = tangentDirectionAlongArcSweep(
          arcDefinition,
          arcDefinition.startAngleDeg,
        );
        const filletEndDirection = tangentDirectionAlongArcSweep(
          arcDefinition,
          arcDefinition.endAngleDeg,
        );
        return secondChoices.map((secondChoice) => ({
          firstChoice,
          secondChoice,
          score:
            firstChoice.score +
            secondChoice.score +
            filletJoinContinuityPenalty(firstChoice.approachDirection, filletStartDirection) +
            filletJoinContinuityPenalty(filletEndDirection, secondChoice.departDirection),
        }));
      })
      .sort((left, right) => left.score - right.score)[0] ?? null;
  if (!bestPair) return null;
  return {
    firstEntity: bestPair.firstChoice.entity,
    secondEntity: bestPair.secondChoice.entity,
    arcDefinition,
    score: bestPair.score,
  };
};
