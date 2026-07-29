import {
  cadArcEndPoint,
  cadArcStartPoint,
} from './cadGeometry';
import type { CadAlignmentElement, CadDisplayPoint, CadEntityId } from './cadTypes';
import {
  alignmentElementEndPoint,
  alignmentElementLength,
  alignmentElementStartPoint,
  ALIGNMENT_POINT_TOLERANCE,
} from './cadAlignmentElements';
import type {
  CadAlignmentDraft,
  CadAlignmentNode,
  CadAlignmentSourceEntity,
  CadAlignmentTraversalCandidate,
} from './cadAlignmentTypes';

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

const createTraversalCandidate = (
  entity: CadAlignmentSourceEntity,
): CadAlignmentTraversalCandidate => {
  const endpoints = sourceEntityEndpoints(entity);
  return {
    entity,
    start: endpoints.start,
    end: endpoints.end,
    startKey: pointKey(endpoints.start),
    endKey: pointKey(endpoints.end),
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

const buildAlignmentNodeMap = (
  candidates: readonly CadAlignmentTraversalCandidate[],
): Map<string, CadAlignmentNode> => {
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

const cadAlignmentLengthFromElements = (elements: readonly CadAlignmentElement[]): number =>
  elements.reduce((total, element) => total + alignmentElementLength(element), 0);

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
    totalLength: cadAlignmentLengthFromElements(elements),
    sourceEntityIds: elements
      .map((element) => element.sourceEntityId)
      .filter((entityId): entityId is CadEntityId => entityId != null),
  };
};
