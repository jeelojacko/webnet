import { cadDistance } from './cadGeometry';
import type { CadLineEntity } from './cadTypes';
import { cadBuildParcelSourceDraft } from './cadCogoParcelGeometrySourceDraft';
import { buildParcelLineCandidate, buildParcelNodeMap, type CadParcelLineCandidate } from './cadCogoParcelLineworkTopology';

export { buildParcelLineCandidate, buildParcelNodeMap };

export interface CadParcelLineworkNodeDiagnostic {
  label: string;
  x: number;
  y: number;
  incidentCount: number;
}

export interface CadParcelLineworkOverlapDiagnostic {
  firstLabel: string;
  secondLabel: string;
  segmentCount: number;
  lengthMeters: number;
}

export interface CadParcelLineworkDiagnostics {
  lineCount: number;
  nodeCount: number;
  componentCount: number;
  danglingNodes: CadParcelLineworkNodeDiagnostic[];
  branchNodes: CadParcelLineworkNodeDiagnostic[];
  overlapSegments: CadParcelLineworkOverlapDiagnostic[];
  isClosedLoopCandidate: boolean;
}

export const cadBuildParcelLineworkDiagnostics = (
  entities: readonly CadLineEntity[],
): CadParcelLineworkDiagnostics => {
  if (entities.length === 0) {
    return {
      lineCount: 0,
      nodeCount: 0,
      componentCount: 0,
      danglingNodes: [],
      branchNodes: [],
      overlapSegments: [],
      isClosedLoopCandidate: false,
    };
  }

  const candidates = entities.map(buildParcelLineCandidate);
  const nodeMap = buildParcelNodeMap(candidates);
  const candidateById = new Map(candidates.map((candidate) => [candidate.entityId, candidate] as const));
  const nodes = [...nodeMap.values()];

  const visitedNodeKeys = new Set<string>();
  let componentCount = 0;
  nodes.forEach((node) => {
    if (visitedNodeKeys.has(node.key)) return;
    componentCount += 1;
    const queue = [node.key];
    visitedNodeKeys.add(node.key);
    while (queue.length > 0) {
      const currentKey = queue.shift();
      if (!currentKey) continue;
      const currentNode = nodeMap.get(currentKey);
      if (!currentNode) continue;
      currentNode.incidentEntityIds.forEach((entityId) => {
        const candidate = candidateById.get(entityId);
        if (!candidate) return;
        const adjacentKeys = [candidate.startKey, candidate.endKey];
        adjacentKeys.forEach((adjacentKey) => {
          if (visitedNodeKeys.has(adjacentKey)) return;
          visitedNodeKeys.add(adjacentKey);
          queue.push(adjacentKey);
        });
      });
    }
  });

  const danglingNodes = nodes
    .filter((node) => node.incidentEntityIds.length === 1)
    .map((node) => ({
      label: node.label,
      x: node.point.x,
      y: node.point.y,
      incidentCount: node.incidentEntityIds.length,
    }));
  const branchNodes = nodes
    .filter((node) => node.incidentEntityIds.length > 2)
    .map((node) => ({
      label: node.label,
      x: node.point.x,
      y: node.point.y,
      incidentCount: node.incidentEntityIds.length,
    }));

  const overlapCandidates = new Map<string, CadParcelLineCandidate[]>();
  candidates.forEach((candidate) => {
    const overlapKey =
      candidate.startKey < candidate.endKey
        ? `${candidate.startKey}|${candidate.endKey}`
        : `${candidate.endKey}|${candidate.startKey}`;
    const existing = overlapCandidates.get(overlapKey);
    if (existing) {
      existing.push(candidate);
      return;
    }
    overlapCandidates.set(overlapKey, [candidate]);
  });
  const overlapSegments = [...overlapCandidates.values()]
    .filter((group) => group.length > 1)
    .map((group) => {
      const first = group[0]!;
      const orderedLabels =
        first.startLabel.localeCompare(first.endLabel) <= 0
          ? { firstLabel: first.startLabel, secondLabel: first.endLabel }
          : { firstLabel: first.endLabel, secondLabel: first.startLabel };
      return {
        firstLabel: orderedLabels.firstLabel,
        secondLabel: orderedLabels.secondLabel,
        segmentCount: group.length,
        lengthMeters: cadDistance(first.start, first.end),
      };
    });

  const isClosedLoopCandidate =
    entities.length >= 3 &&
    nodes.length >= 3 &&
    componentCount === 1 &&
    danglingNodes.length === 0 &&
    branchNodes.length === 0 &&
    overlapSegments.length === 0 &&
    cadBuildParcelSourceDraft(entities) != null;

  return {
    lineCount: entities.length,
    nodeCount: nodes.length,
    componentCount,
    danglingNodes,
    branchNodes,
    overlapSegments,
    isClosedLoopCandidate,
  };
};
