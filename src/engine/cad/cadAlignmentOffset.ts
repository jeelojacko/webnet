import {
  cadAngleDegFromCenter,
  cadDistance,
  cadInfiniteLineIntersection,
  cadIntersectCircleCircle,
  cadIntersectInfiniteLineCircle,
  cadNormalizeAngleDeg,
  cadOffsetLineSegment,
  cadPointOnCircle,
  cadSignedSweepDeg,
} from './cadGeometry';
import type {
  CadAlignmentElement,
  CadAlignmentEntity,
  CadDisplayPoint,
  CadEntityId,
  CadStationEquation,
} from './cadTypes';

export interface CadOffsetAlignmentDraft {
  elements: CadAlignmentElement[];
  startPoint: CadDisplayPoint;
  endPoint: CadDisplayPoint;
  totalLength: number;
  sourceEntityIds: CadEntityId[];
}

interface CadOffsetLinePrimitive {
  kind: 'line';
  start: CadDisplayPoint;
  end: CadDisplayPoint;
  sourceEntityId?: CadEntityId;
}

interface CadOffsetArcPrimitive {
  kind: 'arc';
  center: CadDisplayPoint;
  radius: number;
  startAngleDeg: number;
  endAngleDeg: number;
  sweepSign: 1 | -1;
  sourceEntityId?: CadEntityId;
}

type CadOffsetPrimitive = CadOffsetLinePrimitive | CadOffsetArcPrimitive;

const isAlignmentElementArray = (
  alignment: Pick<CadAlignmentEntity, 'elements'> | Pick<CadAlignmentEntity, 'elements' | 'startStation'> | readonly CadAlignmentElement[],
): alignment is readonly CadAlignmentElement[] => Array.isArray(alignment);

const getAlignmentElements = (
  alignment: Pick<CadAlignmentEntity, 'elements'> | Pick<CadAlignmentEntity, 'elements' | 'startStation'> | readonly CadAlignmentElement[],
): readonly CadAlignmentElement[] => (isAlignmentElementArray(alignment) ? alignment : alignment.elements);

const alignmentElementLength = (element: CadAlignmentElement): number =>
  element.kind === 'line'
    ? cadDistance(element.start, element.end)
    : (Math.abs(cadSignedSweepDeg(element.startAngleDeg, element.endAngleDeg)) * Math.PI * element.radius) / 180;

const cadAlignmentLength = (alignment: Pick<CadAlignmentEntity, 'elements'> | readonly CadAlignmentElement[]): number => {
  const elements = getAlignmentElements(alignment);
  return elements.reduce(
    (total: number, element: CadAlignmentElement) => total + alignmentElementLength(element),
    0,
  );
};

const alignmentElementStartPoint = (element: CadAlignmentElement): CadDisplayPoint =>
  element.kind === 'line'
    ? element.start
    : cadPointOnCircle(element.center, element.radius, element.startAngleDeg);

const alignmentElementEndPoint = (element: CadAlignmentElement): CadDisplayPoint =>
  element.kind === 'line'
    ? element.end
    : cadPointOnCircle(element.center, element.radius, element.endAngleDeg);

const offsetPrimitiveStartPoint = (element: CadOffsetPrimitive): CadDisplayPoint =>
  element.kind === 'line'
    ? element.start
    : cadPointOnCircle(element.center, element.radius, element.startAngleDeg);

const offsetPrimitiveEndPoint = (element: CadOffsetPrimitive): CadDisplayPoint =>
  element.kind === 'line'
    ? element.end
    : cadPointOnCircle(element.center, element.radius, element.endAngleDeg);

const buildOffsetAlignmentPrimitive = (
  element: CadAlignmentElement,
  offset: number,
): CadOffsetPrimitive | null => {
  if (element.kind === 'line') {
    const segment = cadOffsetLineSegment(element.start, element.end, offset);
    return {
      kind: 'line',
      start: segment.start,
      end: segment.end,
      sourceEntityId: element.sourceEntityId,
    };
  }

  const sweepSign: 1 | -1 = cadSignedSweepDeg(element.startAngleDeg, element.endAngleDeg) >= 0 ? 1 : -1;
  const radius = sweepSign > 0 ? element.radius - offset : element.radius + offset;
  if (!Number.isFinite(radius) || radius <= 1e-9) return null;
  return {
    kind: 'arc',
    center: element.center,
    radius,
    startAngleDeg: element.startAngleDeg,
    endAngleDeg: element.endAngleDeg,
    sweepSign,
    sourceEntityId: element.sourceEntityId,
  };
};

const midpoint = (left: CadDisplayPoint, right: CadDisplayPoint): CadDisplayPoint => ({
  x: (left.x + right.x) / 2,
  y: (left.y + right.y) / 2,
});

const chooseBestOffsetJoinPoint = (
  candidates: readonly CadDisplayPoint[],
  previousGuess: CadDisplayPoint,
  nextGuess: CadDisplayPoint,
): CadDisplayPoint | null => {
  if (candidates.length === 0) return null;
  return [...candidates].sort((left, right) => {
    const leftScore = cadDistance(left, previousGuess) + cadDistance(left, nextGuess);
    const rightScore = cadDistance(right, previousGuess) + cadDistance(right, nextGuess);
    if (Math.abs(leftScore - rightScore) > 1e-9) return leftScore - rightScore;
    if (Math.abs(left.x - right.x) > 1e-9) return left.x - right.x;
    return left.y - right.y;
  })[0]!;
};

const resolveOffsetAlignmentJoint = (
  previous: CadOffsetPrimitive,
  next: CadOffsetPrimitive,
): CadDisplayPoint | null => {
  const previousGuess = offsetPrimitiveEndPoint(previous);
  const nextGuess = offsetPrimitiveStartPoint(next);
  if (cadDistance(previousGuess, nextGuess) <= 1e-6) {
    return midpoint(previousGuess, nextGuess);
  }

  if (previous.kind === 'line' && next.kind === 'line') {
    return cadInfiniteLineIntersection(previous.start, previous.end, next.start, next.end);
  }

  if (previous.kind === 'line' && next.kind === 'arc') {
    return chooseBestOffsetJoinPoint(
      cadIntersectInfiniteLineCircle(previous.start, previous.end, next.center, next.radius),
      previousGuess,
      nextGuess,
    );
  }

  if (previous.kind === 'arc' && next.kind === 'line') {
    return chooseBestOffsetJoinPoint(
      cadIntersectInfiniteLineCircle(next.start, next.end, previous.center, previous.radius),
      previousGuess,
      nextGuess,
    );
  }

  if (previous.kind === 'arc' && next.kind === 'arc') {
    return chooseBestOffsetJoinPoint(
      cadIntersectCircleCircle(previous.center, previous.radius, next.center, next.radius),
      previousGuess,
      nextGuess,
    );
  }

  return null;
};

const buildOffsetAlignmentElement = (
  primitive: CadOffsetPrimitive,
  start: CadDisplayPoint,
  end: CadDisplayPoint,
): CadAlignmentElement | null => {
  if (primitive.kind === 'line') {
    return {
      kind: 'line',
      start,
      end,
      sourceEntityId: primitive.sourceEntityId,
    };
  }

  const startAngleDeg = cadAngleDegFromCenter(primitive.center, start);
  const endAngleDeg = cadAngleDegFromCenter(primitive.center, end);
  if (primitive.sweepSign > 0) {
    const deltaDeg = cadNormalizeAngleDeg(endAngleDeg - startAngleDeg);
    if (deltaDeg <= 1e-9) return null;
    return {
      kind: 'arc',
      center: primitive.center,
      radius: primitive.radius,
      startAngleDeg,
      endAngleDeg: startAngleDeg + deltaDeg,
      sourceEntityId: primitive.sourceEntityId,
    };
  }
  const deltaDeg = cadNormalizeAngleDeg(startAngleDeg - endAngleDeg);
  if (deltaDeg <= 1e-9) return null;
  return {
    kind: 'arc',
    center: primitive.center,
    radius: primitive.radius,
    startAngleDeg,
    endAngleDeg: startAngleDeg - deltaDeg,
    sourceEntityId: primitive.sourceEntityId,
  };
};

export const cadBuildOffsetAlignmentDraft = (
  alignment:
    | Pick<CadAlignmentEntity, 'elements' | 'startStation' | 'stationEquations'>
    | readonly CadAlignmentElement[],
  offset: number,
): CadOffsetAlignmentDraft | null => {
  const elements = getAlignmentElements(alignment);
  if (elements.length === 0 || !Number.isFinite(offset) || Math.abs(offset) <= 1e-9) return null;

  const primitives = elements
    .map((element) => buildOffsetAlignmentPrimitive(element, offset))
    .filter((value): value is CadOffsetPrimitive => value != null);
  if (primitives.length !== elements.length) return null;

  const vertices: CadDisplayPoint[] = [offsetPrimitiveStartPoint(primitives[0]!)];
  for (let index = 0; index < primitives.length - 1; index += 1) {
    const joint = resolveOffsetAlignmentJoint(primitives[index]!, primitives[index + 1]!);
    if (!joint) return null;
    vertices.push(joint);
  }
  vertices.push(offsetPrimitiveEndPoint(primitives[primitives.length - 1]!));

  const offsetElements = primitives.map((primitive, index) =>
    buildOffsetAlignmentElement(primitive, vertices[index]!, vertices[index + 1]!),
  );
  if (offsetElements.some((element) => element == null)) return null;

  const resolvedElements = offsetElements.filter((element): element is CadAlignmentElement => element != null);
  return {
    elements: resolvedElements,
    startPoint: alignmentElementStartPoint(resolvedElements[0]!),
    endPoint: alignmentElementEndPoint(resolvedElements[resolvedElements.length - 1]!),
    totalLength: cadAlignmentLength(resolvedElements),
    sourceEntityIds: resolvedElements
      .map((element) => element.sourceEntityId)
      .filter((entityId): entityId is CadEntityId => entityId != null),
  };
};
