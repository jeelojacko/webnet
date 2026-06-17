import {
  cadAngleDegFromCenter,
  cadArcEndPoint,
  cadArcStartPoint,
  cadClosestPointOnArc,
  cadClosestPointOnSegment,
  cadDistance,
  cadNormalizeAngleDeg,
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

export const cadAlignmentLength = (alignment: Pick<CadAlignmentEntity, 'elements'> | readonly CadAlignmentElement[]): number => {
  const elements: readonly CadAlignmentElement[] = isAlignmentElementArray(alignment) ? alignment : alignment.elements;
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

export const cadPointAtAlignmentStation = (
  alignment: Pick<CadAlignmentEntity, 'elements' | 'startStation'> | readonly CadAlignmentElement[],
  station: number,
): CadDisplayPoint | null => {
  const elements: readonly CadAlignmentElement[] =
    isAlignmentElementArray(alignment) ? alignment : alignment.elements;
  const startStation = !isAlignmentElementArray(alignment) && 'startStation' in alignment ? alignment.startStation : 0;
  if (elements.length === 0) return null;
  const localStation = station - startStation;
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
  alignment: Pick<CadAlignmentEntity, 'elements' | 'startStation'> | readonly CadAlignmentElement[],
  point: CadDisplayPoint,
): CadAlignmentProjection | null => {
  const elements: readonly CadAlignmentElement[] =
    isAlignmentElementArray(alignment) ? alignment : alignment.elements;
  const startStation = !isAlignmentElementArray(alignment) && 'startStation' in alignment ? alignment.startStation : 0;
  if (elements.length === 0) return null;

  let best: CadAlignmentProjection | null = null;
  let stationBase = startStation;
  elements.forEach((element: CadAlignmentElement, elementIndex: number) => {
    const projection =
      element.kind === 'line'
        ? projectPointToLineElement(element, point, stationBase, elementIndex)
        : projectPointToArcElement(element, point, stationBase, elementIndex);
    if (best == null || cadDistance(point, projection.point) < cadDistance(point, best.point) - 1e-9) {
      best = projection;
    }
    stationBase += alignmentElementLength(element);
  });
  return best;
};
