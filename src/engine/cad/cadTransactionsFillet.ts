import {
  cadInfiniteLineIntersection,
  cadIntersectArcArc,
  cadIntersectInfiniteLineArc,
} from './cadGeometry';
import { TRIM_EPSILON } from './cadTransactionsTrimCommon';
import { buildCadLineFillet } from './cadTransactionsFilletLine';
import {
  buildCadFilletRef,
  offsetSegmentPoints,
  type CadFilletEntity,
  type CadFilletResult,
} from './cadTransactionsFilletGeneralHelpers';
import { buildFilletResultFromCenter } from './cadTransactionsFilletRadiusResult';
import { buildZeroRadiusFilletResult } from './cadTransactionsFilletZeroRadius';
import type { CadArcEntity } from './cadTypes';

export type { CadFilletEntity } from './cadTransactionsFilletGeneralHelpers';

export const buildCadGeneralFillet = (
  firstEntity: CadFilletEntity,
  firstPickPoint: { x: number; y: number },
  secondEntity: CadFilletEntity,
  secondPickPoint: { x: number; y: number },
  radius: number,
  firstSegmentId?: string,
  secondSegmentId?: string,
): CadFilletResult | null => {
  if (!Number.isFinite(radius) || radius < -1e-9) return null;
  const firstRef = buildCadFilletRef(firstEntity, firstPickPoint, firstSegmentId);
  const secondRef = buildCadFilletRef(secondEntity, secondPickPoint, secondSegmentId);
  if (!firstRef || !secondRef) return null;

  if (
    firstRef.kind === 'segment' &&
    secondRef.kind === 'segment' &&
    firstRef.entity.type === 'line' &&
    secondRef.entity.type === 'line'
  ) {
    const fillet = buildCadLineFillet(
      firstRef.entity,
      firstPickPoint,
      secondRef.entity,
      secondPickPoint,
      radius,
    );
    if (!fillet) return null;
    return {
      firstEntity: fillet.firstLine,
      secondEntity: fillet.secondLine,
      arcDefinition: fillet.arcDefinition,
    };
  }

  if (radius <= 1e-9) {
    const corner = buildZeroRadiusFilletResult(firstRef, firstPickPoint, secondRef, secondPickPoint);
    return corner
      ? {
          firstEntity: corner.firstEntity,
          secondEntity: corner.secondEntity,
          arcDefinition: null,
        }
      : null;
  }

  let candidateCenters: Array<{ x: number; y: number }> = [];
  if (firstRef.kind === 'segment' && secondRef.kind === 'segment') {
    candidateCenters = [-1, 1].flatMap((firstSide) =>
      [-1, 1].flatMap((secondSide) => {
        const firstOffset = offsetSegmentPoints(firstRef, radius * firstSide);
        const secondOffset = offsetSegmentPoints(secondRef, radius * secondSide);
        if (!firstOffset || !secondOffset) return [];
        const point = cadInfiniteLineIntersection(
          firstOffset[0],
          firstOffset[1],
          secondOffset[0],
          secondOffset[1],
        );
        return point ? [point] : [];
      }),
    );
  } else if (firstRef.kind === 'segment' && secondRef.kind === 'arc') {
    candidateCenters = [-1, 1].flatMap((lineSide) => {
      const lineOffset = offsetSegmentPoints(firstRef, radius * lineSide);
      if (!lineOffset) return [];
      const arcRadii = [secondRef.entity.radius + radius];
      if (secondRef.entity.radius - radius > TRIM_EPSILON) {
        arcRadii.push(secondRef.entity.radius - radius);
      }
      return arcRadii.flatMap((offsetRadius) =>
        cadIntersectInfiniteLineArc(
          lineOffset[0],
          lineOffset[1],
          { x: secondRef.entity.centerX, y: secondRef.entity.centerY },
          offsetRadius,
          0,
          360,
        ),
      );
    });
  } else if (firstRef.kind === 'arc' && secondRef.kind === 'segment') {
    candidateCenters = [-1, 1].flatMap((lineSide) => {
      const lineOffset = offsetSegmentPoints(secondRef, radius * lineSide);
      if (!lineOffset) return [];
      const arcRadii = [firstRef.entity.radius + radius];
      if (firstRef.entity.radius - radius > TRIM_EPSILON) {
        arcRadii.push(firstRef.entity.radius - radius);
      }
      return arcRadii.flatMap((offsetRadius) =>
        cadIntersectInfiniteLineArc(
          lineOffset[0],
          lineOffset[1],
          { x: firstRef.entity.centerX, y: firstRef.entity.centerY },
          offsetRadius,
          0,
          360,
        ),
      );
    });
  } else {
    const firstArc = firstRef.entity as CadArcEntity;
    const secondArc = secondRef.entity as CadArcEntity;
    const firstRadii = [firstArc.radius + radius];
    if (firstArc.radius - radius > TRIM_EPSILON) {
      firstRadii.push(firstArc.radius - radius);
    }
    const secondRadii = [secondArc.radius + radius];
    if (secondArc.radius - radius > TRIM_EPSILON) {
      secondRadii.push(secondArc.radius - radius);
    }
    candidateCenters = firstRadii.flatMap((firstOffsetRadius) =>
      secondRadii.flatMap((secondOffsetRadius) =>
        cadIntersectArcArc(
          { x: firstArc.centerX, y: firstArc.centerY },
          firstOffsetRadius,
          0,
          360,
          { x: secondArc.centerX, y: secondArc.centerY },
          secondOffsetRadius,
          0,
          360,
        ),
      ),
    );
  }

  const bestCandidate =
    candidateCenters
      .map((centerPoint) =>
        buildFilletResultFromCenter(
          firstRef,
          firstPickPoint,
          secondRef,
          secondPickPoint,
          centerPoint,
          radius,
        ),
      )
      .filter((candidate): candidate is CadFilletResult & { score: number } => candidate != null)
      .sort((left, right) => left.score - right.score)[0] ?? null;
  if (!bestCandidate) return null;
  return {
    firstEntity: bestCandidate.firstEntity,
    secondEntity: bestCandidate.secondEntity,
    arcDefinition: bestCandidate.arcDefinition,
  };
};
