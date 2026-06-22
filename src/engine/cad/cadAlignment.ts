import {
  cadAngleDegFromCenter,
  cadArcEndPoint,
  cadArcStartPoint,
  cadClosestPointOnArc,
  cadClosestPointOnSegment,
  cadDistance,
  cadInfiniteLineIntersection,
  cadIntersectCircleCircle,
  cadIntersectInfiniteLineCircle,
  cadNormalizeAngleDeg,
  cadOffsetLineSegment,
  cadPointOnCircle,
  cadProjectPointOntoInfiniteLine,
  cadSignedSweepDeg,
} from './cadGeometry';
import type {
  CadAlignmentElement,
  CadAlignmentEntity,
  CadArcEntity,
  CadDisplayPoint,
  CadEntityId,
  CadLineEntity,
  CadStationEquation,
} from './cadTypes';

const ALIGNMENT_POINT_TOLERANCE = 1e-6;

type CadAlignmentSourceEntity = CadLineEntity | CadArcEntity;

interface CadAlignmentTraversalCandidate {
  entity: CadAlignmentSourceEntity;
  start: CadDisplayPoint;
  end: CadDisplayPoint;
  startKey: string;
  endKey: string;
}

interface CadAlignmentNode {
  key: string;
  point: CadDisplayPoint;
  incidentEntityIds: CadEntityId[];
}

export interface CadAlignmentDraft {
  elements: CadAlignmentElement[];
  startPoint: CadDisplayPoint;
  endPoint: CadDisplayPoint;
  totalLength: number;
  sourceEntityIds: CadEntityId[];
}

export interface CadAlignmentProjection {
  point: CadDisplayPoint;
  station: number;
  offset: number;
  elementIndex: number;
  elementKind: CadAlignmentElement['kind'];
}

export interface CadAlignmentStationOffsetPoint {
  point: CadDisplayPoint;
  station: number;
  offset: number;
  elementIndex: number;
  elementKind: CadAlignmentElement['kind'];
}

export interface CadAlignmentStationPoint {
  point: CadDisplayPoint;
  station: number;
}

interface CadResolvedStationEquation extends CadStationEquation {
  rawStation: number;
  deltaBefore: number;
  deltaAfter: number;
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

const quantizeAlignmentCoordinate = (value: number): number =>
  Math.round(value / ALIGNMENT_POINT_TOLERANCE);

const pointKey = (point: CadDisplayPoint): string =>
  `${quantizeAlignmentCoordinate(point.x)}:${quantizeAlignmentCoordinate(point.y)}`;

const pointsMatch = (left: CadDisplayPoint, right: CadDisplayPoint): boolean =>
  Math.abs(left.x - right.x) <= ALIGNMENT_POINT_TOLERANCE &&
  Math.abs(left.y - right.y) <= ALIGNMENT_POINT_TOLERANCE;

const comparePoints = (left: CadDisplayPoint, right: CadDisplayPoint): number =>
  left.x === right.x ? left.y - right.y : left.x - right.x;

const sourceEntityEndpoints = (
  entity: CadAlignmentSourceEntity,
): Pick<CadAlignmentTraversalCandidate, 'start' | 'end'> =>
  entity.type === 'line'
    ? {
        start: { x: entity.fromX, y: entity.fromY },
        end: { x: entity.toX, y: entity.toY },
      }
    : {
        start: cadArcStartPoint(entity),
        end: cadArcEndPoint(entity),
      };

const createTraversalCandidate = (entity: CadAlignmentSourceEntity): CadAlignmentTraversalCandidate => {
  const endpoints = sourceEntityEndpoints(entity);
  return {
    entity,
    start: endpoints.start,
    end: endpoints.end,
    startKey: pointKey(endpoints.start),
    endKey: pointKey(endpoints.end),
  };
};

const alignmentElementLength = (element: CadAlignmentElement): number =>
  element.kind === 'line'
    ? cadDistance(element.start, element.end)
    : (Math.abs(cadSignedSweepDeg(element.startAngleDeg, element.endAngleDeg)) * Math.PI * element.radius) / 180;

const getAlignmentElements = (
  alignment: Pick<CadAlignmentEntity, 'elements'> | Pick<CadAlignmentEntity, 'elements' | 'startStation'> | readonly CadAlignmentElement[],
): readonly CadAlignmentElement[] => (isAlignmentElementArray(alignment) ? alignment : alignment.elements);

const getAlignmentStartStation = (
  alignment: Pick<CadAlignmentEntity, 'elements'> | Pick<CadAlignmentEntity, 'elements' | 'startStation'> | readonly CadAlignmentElement[],
): number => (!isAlignmentElementArray(alignment) && 'startStation' in alignment ? alignment.startStation : 0);

const getAlignmentStationEquations = (
  alignment:
    | Pick<CadAlignmentEntity, 'elements' | 'startStation' | 'stationEquations'>
    | readonly CadAlignmentElement[],
): readonly CadStationEquation[] =>
  !isAlignmentElementArray(alignment) && 'stationEquations' in alignment && Array.isArray(alignment.stationEquations)
    ? alignment.stationEquations
    : [];

const resolveAlignmentStationEquations = (
  alignment:
    | Pick<CadAlignmentEntity, 'elements' | 'startStation' | 'stationEquations'>
    | readonly CadAlignmentElement[],
): CadResolvedStationEquation[] | null => {
  const startStation = getAlignmentStartStation(alignment);
  const endRawStation = startStation + cadAlignmentLength(getAlignmentElements(alignment));
  const equations = [...getAlignmentStationEquations(alignment)];
  if (equations.length === 0) return [];

  const resolved: CadResolvedStationEquation[] = [];
  let deltaBefore = 0;
  let previousRawStation = startStation;
  for (const equation of equations) {
    if (!Number.isFinite(equation.backStation) || !Number.isFinite(equation.aheadStation)) {
      return null;
    }
    const rawStation = equation.rawStation ?? equation.backStation - deltaBefore;
    if (
      !Number.isFinite(rawStation) ||
      rawStation < startStation - 1e-9 ||
      rawStation > endRawStation + 1e-9 ||
      rawStation < previousRawStation - 1e-9
    ) {
      return null;
    }
    const deltaAfter = deltaBefore + (equation.aheadStation - equation.backStation);
    resolved.push({
      ...equation,
      rawStation,
      deltaBefore,
      deltaAfter,
    });
    deltaBefore = deltaAfter;
    previousRawStation = rawStation;
  }
  return resolved;
};

export const cadAlignmentLength = (alignment: Pick<CadAlignmentEntity, 'elements'> | readonly CadAlignmentElement[]): number => {
  const elements = getAlignmentElements(alignment);
  return elements.reduce(
    (total: number, element: CadAlignmentElement) => total + alignmentElementLength(element),
    0,
  );
};

export const cadAlignmentEndStation = (
  alignment:
    | Pick<CadAlignmentEntity, 'elements' | 'startStation' | 'stationEquations'>
    | readonly CadAlignmentElement[],
): number | null => {
  const startStation = getAlignmentStartStation(alignment);
  const totalLength = cadAlignmentLength(getAlignmentElements(alignment));
  const resolvedEquations = resolveAlignmentStationEquations(alignment);
  if (resolvedEquations == null) return null;
  const deltaAfter = resolvedEquations[resolvedEquations.length - 1]?.deltaAfter ?? 0;
  return startStation + totalLength + deltaAfter;
};

export const formatCadStation = (station: number): string => {
  if (!Number.isFinite(station)) return 'NaN';
  const sign = station < 0 ? '-' : '';
  const absoluteStation = Math.abs(station);
  const major = Math.floor(absoluteStation / 100);
  const minor = absoluteStation - major * 100;
  return `${sign}${major}+${minor.toFixed(3).padStart(6, '0')}`;
};

export const cadAlignmentRawStationToDisplayStation = (
  alignment:
    | Pick<CadAlignmentEntity, 'elements' | 'startStation' | 'stationEquations'>
    | readonly CadAlignmentElement[],
  rawStation: number,
): number | null => {
  if (!Number.isFinite(rawStation)) return null;
  const startStation = getAlignmentStartStation(alignment);
  const endRawStation = startStation + cadAlignmentLength(getAlignmentElements(alignment));
  if (rawStation < startStation - 1e-9 || rawStation > endRawStation + 1e-9) return null;
  const resolvedEquations = resolveAlignmentStationEquations(alignment);
  if (resolvedEquations == null) return null;

  let delta = 0;
  for (const equation of resolvedEquations) {
    if (rawStation < equation.rawStation - 1e-9) {
      return rawStation + delta;
    }
    if (Math.abs(rawStation - equation.rawStation) <= 1e-9) {
      return equation.aheadStation;
    }
    delta = equation.deltaAfter;
  }
  return rawStation + delta;
};

export const cadAlignmentDisplayStationToRawStation = (
  alignment:
    | Pick<CadAlignmentEntity, 'elements' | 'startStation' | 'stationEquations'>
    | readonly CadAlignmentElement[],
  station: number,
): number | null => {
  if (!Number.isFinite(station)) return null;
  const startStation = getAlignmentStartStation(alignment);
  const endRawStation = startStation + cadAlignmentLength(getAlignmentElements(alignment));
  const resolvedEquations = resolveAlignmentStationEquations(alignment);
  if (resolvedEquations == null) return null;

  let delta = 0;
  let displayStart = startStation;
  for (const equation of resolvedEquations) {
    if (station >= displayStart - 1e-9 && station <= equation.backStation + 1e-9) {
      return Math.max(startStation, Math.min(endRawStation, station - delta));
    }
    if (station > equation.backStation + 1e-9 && station < equation.aheadStation - 1e-9) {
      return null;
    }
    if (Math.abs(station - equation.aheadStation) <= 1e-9) {
      return equation.rawStation;
    }
    delta = equation.deltaAfter;
    displayStart = equation.aheadStation;
  }

  const endDisplayStation = endRawStation + delta;
  if (station < displayStart - 1e-9 || station > endDisplayStation + 1e-9) return null;
  return Math.max(startStation, Math.min(endRawStation, station - delta));
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

const reverseAlignmentElement = (candidate: CadAlignmentTraversalCandidate): CadAlignmentElement =>
  candidate.entity.type === 'line'
    ? {
        kind: 'line',
        start: candidate.end,
        end: candidate.start,
        sourceEntityId: candidate.entity.id,
      }
    : {
        kind: 'arc',
        center: { x: candidate.entity.centerX, y: candidate.entity.centerY },
        radius: candidate.entity.radius,
        startAngleDeg: candidate.entity.endAngleDeg,
        endAngleDeg: candidate.entity.startAngleDeg,
        sourceEntityId: candidate.entity.id,
      };

const forwardAlignmentElement = (candidate: CadAlignmentTraversalCandidate): CadAlignmentElement =>
  candidate.entity.type === 'line'
    ? {
        kind: 'line',
        start: candidate.start,
        end: candidate.end,
        sourceEntityId: candidate.entity.id,
      }
    : {
        kind: 'arc',
        center: { x: candidate.entity.centerX, y: candidate.entity.centerY },
        radius: candidate.entity.radius,
        startAngleDeg: candidate.entity.startAngleDeg,
        endAngleDeg: candidate.entity.endAngleDeg,
        sourceEntityId: candidate.entity.id,
      };

const buildAlignmentNodeMap = (candidates: readonly CadAlignmentTraversalCandidate[]): Map<string, CadAlignmentNode> => {
  const nodeMap = new Map<string, CadAlignmentNode>();
  candidates.forEach((candidate) => {
    [candidate.startKey, candidate.endKey].forEach((key, index) => {
      const point = index === 0 ? candidate.start : candidate.end;
      const existing = nodeMap.get(key);
      if (existing) {
        existing.incidentEntityIds.push(candidate.entity.id);
        return;
      }
      nodeMap.set(key, {
        key,
        point,
        incidentEntityIds: [candidate.entity.id],
      });
    });
  });
  return nodeMap;
};

export const cadBuildAlignmentDraft = (
  sourceEntities: readonly CadAlignmentSourceEntity[],
): CadAlignmentDraft | null => {
  if (sourceEntities.length === 0) return null;

  const candidates = sourceEntities.map(createTraversalCandidate);
  if (candidates.length === 1) {
    const only = candidates[0]!;
    const element = forwardAlignmentElement(only);
    return {
      elements: [element],
      startPoint: alignmentElementStartPoint(element),
      endPoint: alignmentElementEndPoint(element),
      totalLength: alignmentElementLength(element),
      sourceEntityIds: [only.entity.id],
    };
  }

  const nodeMap = buildAlignmentNodeMap(candidates);
  const endpointNodes = [...nodeMap.values()].filter((node) => node.incidentEntityIds.length === 1);
  if (endpointNodes.length !== 2) return null;
  if ([...nodeMap.values()].some((node) => node.incidentEntityIds.length > 2)) return null;

  endpointNodes.sort((left, right) => comparePoints(left.point, right.point));
  const candidateById = new Map(candidates.map((candidate) => [candidate.entity.id, candidate]));
  const usedEntityIds = new Set<CadEntityId>();
  const elements: CadAlignmentElement[] = [];
  let currentKey = endpointNodes[0]!.key;

  while (usedEntityIds.size < candidates.length) {
    const node = nodeMap.get(currentKey);
    if (!node) return null;
    const nextEntityId = [...node.incidentEntityIds]
      .filter((entityId) => !usedEntityIds.has(entityId))
      .sort()[0];
    if (!nextEntityId) return null;
    const candidate = candidateById.get(nextEntityId);
    if (!candidate) return null;

    const orientedElement =
      candidate.startKey === currentKey ? forwardAlignmentElement(candidate) : reverseAlignmentElement(candidate);
    elements.push(orientedElement);
    usedEntityIds.add(nextEntityId);
    currentKey = candidate.startKey === currentKey ? candidate.endKey : candidate.startKey;
  }

  if (elements.length !== candidates.length) return null;
  const startPoint = alignmentElementStartPoint(elements[0]!);
  const endPoint = alignmentElementEndPoint(elements[elements.length - 1]!);
  if (!pointsMatch(endPoint, endpointNodes[1]!.point)) return null;

  return {
    elements,
    startPoint,
    endPoint,
    totalLength: cadAlignmentLength(elements),
    sourceEntityIds: elements
      .map((element) => element.sourceEntityId)
      .filter((entityId): entityId is CadEntityId => entityId != null),
  };
};

export const cadBuildOffsetAlignmentDraft = (
  alignment:
    | Pick<CadAlignmentEntity, 'elements' | 'startStation' | 'stationEquations'>
    | readonly CadAlignmentElement[],
  offset: number,
): CadAlignmentDraft | null => {
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

export const cadPointAtAlignmentStation = (
  alignment:
    | Pick<CadAlignmentEntity, 'elements' | 'startStation' | 'stationEquations'>
    | readonly CadAlignmentElement[],
  station: number,
): CadDisplayPoint | null => {
  const elements = getAlignmentElements(alignment);
  const startStation = getAlignmentStartStation(alignment);
  if (elements.length === 0) return null;
  const rawStation = cadAlignmentDisplayStationToRawStation(alignment, station);
  if (rawStation == null) return null;
  const localStation = rawStation - startStation;
  if (!Number.isFinite(localStation) || localStation < -1e-9) return null;

  let traversed = 0;
  for (const element of elements) {
    const elementLength = alignmentElementLength(element);
    const nextTraversed = traversed + elementLength;
    if (localStation <= nextTraversed + 1e-9) {
      const distanceAlong = Math.max(0, Math.min(elementLength, localStation - traversed));
      if (element.kind === 'line') {
        if (elementLength <= 1e-12) return element.start;
        const ratio = distanceAlong / elementLength;
        return {
          x: element.start.x + (element.end.x - element.start.x) * ratio,
          y: element.start.y + (element.end.y - element.start.y) * ratio,
        };
      }
      const sweepDeg = cadSignedSweepDeg(element.startAngleDeg, element.endAngleDeg);
      const direction = sweepDeg >= 0 ? 1 : -1;
      const deltaDeg = (distanceAlong / element.radius) * (180 / Math.PI) * direction;
      return cadPointOnCircle(
        element.center,
        element.radius,
        cadNormalizeAngleDeg(element.startAngleDeg + deltaDeg),
      );
    }
    traversed = nextTraversed;
  }
  if (Math.abs(localStation - traversed) <= 1e-9) {
    return alignmentElementEndPoint(elements[elements.length - 1]!);
  }
  return null;
};

export const cadPointAtAlignmentStationOffset = (
  alignment:
    | Pick<CadAlignmentEntity, 'elements' | 'startStation' | 'stationEquations'>
    | readonly CadAlignmentElement[],
  station: number,
  offset: number,
): CadAlignmentStationOffsetPoint | null => {
  const elements = getAlignmentElements(alignment);
  const startStation = getAlignmentStartStation(alignment);
  if (elements.length === 0 || !Number.isFinite(station) || !Number.isFinite(offset)) return null;

  const rawStation = cadAlignmentDisplayStationToRawStation(alignment, station);
  if (rawStation == null) return null;
  const localStation = rawStation - startStation;
  if (localStation < -1e-9) return null;

  let traversed = 0;
  for (let elementIndex = 0; elementIndex < elements.length; elementIndex += 1) {
    const element = elements[elementIndex]!;
    const elementLength = alignmentElementLength(element);
    const nextTraversed = traversed + elementLength;
    if (localStation <= nextTraversed + 1e-9) {
      const distanceAlong = Math.max(0, Math.min(elementLength, localStation - traversed));
      if (element.kind === 'line') {
        if (elementLength <= 1e-12) return null;
        const ratio = distanceAlong / elementLength;
        const pointOnLine = {
          x: element.start.x + (element.end.x - element.start.x) * ratio,
          y: element.start.y + (element.end.y - element.start.y) * ratio,
        };
        const dx = element.end.x - element.start.x;
        const dy = element.end.y - element.start.y;
        const leftNormalX = -dy / elementLength;
        const leftNormalY = dx / elementLength;
        return {
          point: {
            x: pointOnLine.x + leftNormalX * offset,
            y: pointOnLine.y + leftNormalY * offset,
          },
          station,
          offset,
          elementIndex,
          elementKind: 'line',
        };
      }

      const sweepDeg = cadSignedSweepDeg(element.startAngleDeg, element.endAngleDeg);
      const direction = sweepDeg >= 0 ? 1 : -1;
      const deltaDeg = (distanceAlong / element.radius) * (180 / Math.PI) * direction;
      const angleDeg = cadNormalizeAngleDeg(element.startAngleDeg + deltaDeg);
      const radialDistance = sweepDeg >= 0 ? element.radius - offset : element.radius + offset;
      if (!Number.isFinite(radialDistance) || radialDistance < 0) return null;
      return {
        point: cadPointOnCircle(element.center, radialDistance, angleDeg),
        station,
        offset,
        elementIndex,
        elementKind: 'arc',
      };
    }
    traversed = nextTraversed;
  }

  if (Math.abs(localStation - traversed) <= 1e-9) {
    const lastElement = elements[elements.length - 1]!;
    if (lastElement.kind === 'line') {
      const elementLength = alignmentElementLength(lastElement);
      if (elementLength <= 1e-12) return null;
      const dx = lastElement.end.x - lastElement.start.x;
      const dy = lastElement.end.y - lastElement.start.y;
      const leftNormalX = -dy / elementLength;
      const leftNormalY = dx / elementLength;
      return {
        point: {
          x: lastElement.end.x + leftNormalX * offset,
          y: lastElement.end.y + leftNormalY * offset,
        },
        station,
        offset,
        elementIndex: elements.length - 1,
        elementKind: 'line',
      };
    }
    const sweepDeg = cadSignedSweepDeg(lastElement.startAngleDeg, lastElement.endAngleDeg);
    const radialDistance = sweepDeg >= 0 ? lastElement.radius - offset : lastElement.radius + offset;
    if (!Number.isFinite(radialDistance) || radialDistance < 0) return null;
    return {
      point: cadPointOnCircle(lastElement.center, radialDistance, lastElement.endAngleDeg),
      station,
      offset,
      elementIndex: elements.length - 1,
      elementKind: 'arc',
    };
  }

  return null;
};

const projectPointToLineElement = (
  element: Extract<CadAlignmentElement, { kind: 'line' }>,
  point: CadDisplayPoint,
  stationBase: number,
  elementIndex: number,
): CadAlignmentProjection => {
  const projected = cadProjectPointOntoInfiniteLine(point, element.start, element.end);
  const elementLength = alignmentElementLength(element);
  const clampedT = Math.max(0, Math.min(1, projected.t));
  const projectedPoint =
    clampedT === projected.t
      ? projected.point
      : cadClosestPointOnSegment(point, element.start, element.end);
  const dx = element.end.x - element.start.x;
  const dy = element.end.y - element.start.y;
  const projectedDistance = elementLength * clampedT;
  const cross = dx * (point.y - projectedPoint.y) - dy * (point.x - projectedPoint.x);

  return {
    point: projectedPoint,
    station: stationBase + projectedDistance,
    offset: Math.sign(cross) * cadDistance(point, projectedPoint),
    elementIndex,
    elementKind: 'line',
  };
};

const projectPointToArcElement = (
  element: Extract<CadAlignmentElement, { kind: 'arc' }>,
  point: CadDisplayPoint,
  stationBase: number,
  elementIndex: number,
): CadAlignmentProjection => {
  const projectedPoint = cadClosestPointOnArc(
    point,
    element.center,
    element.radius,
    element.startAngleDeg,
    element.endAngleDeg,
  );
  const sweepDeg = cadSignedSweepDeg(element.startAngleDeg, element.endAngleDeg);
  const pointAngleDeg = cadAngleDegFromCenter(element.center, projectedPoint);
  const deltaDeg =
    sweepDeg >= 0
      ? cadNormalizeAngleDeg(pointAngleDeg - element.startAngleDeg)
      : cadNormalizeAngleDeg(element.startAngleDeg - pointAngleDeg);
  const station = stationBase + (deltaDeg * Math.PI * element.radius) / 180;
  const radiusToPoint = cadDistance(element.center, point);
  const offset = sweepDeg >= 0 ? element.radius - radiusToPoint : radiusToPoint - element.radius;

  return {
    point: projectedPoint,
    station,
    offset,
    elementIndex,
    elementKind: 'arc',
  };
};

export const cadProjectPointToAlignment = (
  alignment:
    | Pick<CadAlignmentEntity, 'elements' | 'startStation' | 'stationEquations'>
    | readonly CadAlignmentElement[],
  point: CadDisplayPoint,
): CadAlignmentProjection | null => {
  const elements = getAlignmentElements(alignment);
  const startStation = getAlignmentStartStation(alignment);
  if (elements.length === 0) return null;

  let best: CadAlignmentProjection | null = null;
  let stationBase = startStation;
  for (let elementIndex = 0; elementIndex < elements.length; elementIndex += 1) {
    const element = elements[elementIndex]!;
    const projection =
      element.kind === 'line'
        ? projectPointToLineElement(element, point, stationBase, elementIndex)
        : projectPointToArcElement(element, point, stationBase, elementIndex);
    if (best == null || cadDistance(point, projection.point) < cadDistance(point, best.point) - 1e-9) {
      best = projection;
    }
    stationBase += alignmentElementLength(element);
  }
  if (best == null) return null;
  const displayStation = cadAlignmentRawStationToDisplayStation(alignment, best.station);
  return displayStation == null
    ? null
    : {
        ...best,
        station: displayStation,
      };
};

export const cadBuildAlignmentStationPoints = (
  alignment:
    | Pick<CadAlignmentEntity, 'elements' | 'startStation' | 'stationEquations'>
    | readonly CadAlignmentElement[],
  options: {
    startStation?: number;
    endStation?: number;
    interval: number;
    includeStart?: boolean;
    includeEnd?: boolean;
  },
): CadAlignmentStationPoint[] => {
  const elements = getAlignmentElements(alignment);
  const defaultStartStation = getAlignmentStartStation(alignment);
  const defaultEndStation = cadAlignmentEndStation(alignment);
  const startStation = options.startStation ?? defaultStartStation;
  const endStation = options.endStation ?? defaultEndStation ?? defaultStartStation;
  const interval = options.interval;
  const includeStart = options.includeStart ?? true;
  const includeEnd = options.includeEnd ?? true;
  if (
    elements.length === 0 ||
    !Number.isFinite(interval) ||
    interval <= 0 ||
    !Number.isFinite(startStation) ||
    endStation == null ||
    !Number.isFinite(endStation) ||
    endStation < startStation - 1e-9
  ) {
    return [];
  }

  const stations: number[] = [];
  if (includeStart) stations.push(startStation);

  let nextStation = startStation + interval;
  while (nextStation < endStation - 1e-9) {
    stations.push(nextStation);
    nextStation += interval;
  }

  if (includeEnd && (stations.length === 0 || Math.abs(stations[stations.length - 1]! - endStation) > 1e-9)) {
    stations.push(endStation);
  }

  return stations
    .map((station) => {
      const point = cadPointAtAlignmentStation(alignment, station);
      return point ? { station, point } : null;
    })
    .filter((value): value is CadAlignmentStationPoint => value != null);
};
