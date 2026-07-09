import { cadDistance, cadSegmentIntersection, type CadWorldPoint } from './cadGeometry';
import type { CadEntityId, CadLineEntity, CadParcelEntity } from './cadTypes';
import {
  cadBuildParcelClosureSummary,
  cadBuildParcelOverlapAreaSquareMeters,
  cadBuildParcelSourceDraft,
  cadPointInPolygon,
  normalizeParcelPolygonVertices,
  normalizeParcelVertexLabel,
  type CadAreaUnitSummary,
  type CadParcelClosureSummary,
  parcelPointKey,
  parcelPointsMatch,
} from './cadCogoParcelGeometry';

interface CadParcelLineCandidate {
  entityId: CadEntityId;
  start: CadWorldPoint;
  end: CadWorldPoint;
  startLabel: string;
  endLabel: string;
  startKey: string;
  endKey: string;
}

interface CadParcelNode {
  key: string;
  point: CadWorldPoint;
  label: string;
  incidentEntityIds: CadEntityId[];
}

interface CadParcelBoundarySegment {
  entityId: CadEntityId;
  start: CadWorldPoint;
  end: CadWorldPoint;
  startLabel: string;
  endLabel: string;
  startKey: string;
  endKey: string;
}

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

export interface CadParcelOverlapPairDiagnostic {
  firstParcelId: CadEntityId;
  firstParcelName: string;
  secondParcelId: CadEntityId;
  secondParcelName: string;
  overlapAreaSquareMeters: number;
}

export interface CadParcelOverlapDiagnostics {
  parcelCount: number;
  pairCount: number;
  overlapPairs: CadParcelOverlapPairDiagnostic[];
  totalOverlapAreaSquareMeters: number;
}

export interface CadParcelGapLoopDiagnostic {
  areaSquareMeters: number;
  centroid: CadWorldPoint;
}

export interface CadParcelGapDiagnostics {
  parcelCount: number;
  componentCount: number;
  exposedLoopCount: number;
  isSupported: boolean;
  gapLoops: CadParcelGapLoopDiagnostic[];
  totalGapAreaSquareMeters: number;
}
export const cadConvertAreaSquareMeters = (areaSquareMeters: number): CadAreaUnitSummary => ({
  hectares: areaSquareMeters / 10_000,
  acres: areaSquareMeters / 4046.8564224,
  squareFeet: areaSquareMeters * 10.7639104167097,
});
export const buildParcelLineCandidate = (entity: CadLineEntity): CadParcelLineCandidate => {
  const start = { x: entity.fromX, y: entity.fromY };
  const end = { x: entity.toX, y: entity.toY };
  return {
    entityId: entity.id,
    start,
    end,
    startLabel: entity.fromStationId,
    endLabel: entity.toStationId,
    startKey: parcelPointKey(start),
    endKey: parcelPointKey(end),
  };
};

export const buildParcelBoundarySegments = (
  parcel: CadParcelEntity,
): CadParcelBoundarySegment[] => {
  const vertices = normalizeParcelPolygonVertices(parcel.vertices);
  const labels = parcel.vertexLabels.length === vertices.length
    ? parcel.vertexLabels
    : vertices.map((_, index) => normalizeParcelVertexLabel(parcel.vertexLabels[index], index));
  if (vertices.length < 3) return [];
  return vertices.map((start, index) => {
    const end = vertices[(index + 1) % vertices.length]!;
    return {
      entityId: parcel.id,
      start,
      end,
      startLabel: labels[index] ?? `V${index + 1}`,
      endLabel: labels[(index + 1) % labels.length] ?? `V${((index + 1) % labels.length) + 1}`,
      startKey: parcelPointKey(start),
      endKey: parcelPointKey(end),
    };
  });
};

export const buildParcelNodeMap = (candidates: readonly CadParcelLineCandidate[]): Map<string, CadParcelNode> => {
  const nodeMap = new Map<string, CadParcelNode>();
  candidates.forEach((candidate) => {
    [
      { key: candidate.startKey, point: candidate.start, label: candidate.startLabel },
      { key: candidate.endKey, point: candidate.end, label: candidate.endLabel },
    ].forEach(({ key, point, label }) => {
      const existing = nodeMap.get(key);
      if (existing) {
        existing.incidentEntityIds.push(candidate.entityId);
        return;
      }
      nodeMap.set(key, {
        key,
        point,
        label,
        incidentEntityIds: [candidate.entityId],
      });
    });
  });
  return nodeMap;
};

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

export const cadBuildParcelOverlapDiagnostics = (
  parcels: readonly CadParcelEntity[],
): CadParcelOverlapDiagnostics => {
  const overlapPairs: CadParcelOverlapPairDiagnostic[] = [];
  for (let firstIndex = 0; firstIndex < parcels.length; firstIndex += 1) {
    for (let secondIndex = firstIndex + 1; secondIndex < parcels.length; secondIndex += 1) {
      const firstParcel = parcels[firstIndex]!;
      const secondParcel = parcels[secondIndex]!;
      const firstVertices = normalizeParcelPolygonVertices(firstParcel.vertices);
      const secondVertices = normalizeParcelPolygonVertices(secondParcel.vertices);
      if (firstVertices.length < 3 || secondVertices.length < 3) continue;
      const mayOverlap =
        firstVertices.some((point) => cadPointInPolygon(point, secondVertices)) ||
        secondVertices.some((point) => cadPointInPolygon(point, firstVertices)) ||
        firstVertices.some((start, index) => {
          const end = firstVertices[(index + 1) % firstVertices.length]!;
          return secondVertices.some((clipStart, clipIndex) => {
            const clipEnd = secondVertices[(clipIndex + 1) % secondVertices.length]!;
            const intersection = cadSegmentIntersection(start, end, clipStart, clipEnd);
            if (!intersection) return false;
            const touchesAtSharedVertex =
              [start, end, clipStart, clipEnd].some((vertex) => parcelPointsMatch(intersection, vertex));
            return !touchesAtSharedVertex;
          });
        });
      if (!mayOverlap) continue;
      const overlapAreaSquareMeters = cadBuildParcelOverlapAreaSquareMeters(firstVertices, secondVertices);
      if (overlapAreaSquareMeters <= 1e-6) continue;
      overlapPairs.push({
        firstParcelId: firstParcel.id,
        firstParcelName: firstParcel.parcelName,
        secondParcelId: secondParcel.id,
        secondParcelName: secondParcel.parcelName,
        overlapAreaSquareMeters,
      });
    }
  }
  return {
    parcelCount: parcels.length,
    pairCount: (parcels.length * (parcels.length - 1)) / 2,
    overlapPairs,
    totalOverlapAreaSquareMeters: overlapPairs.reduce(
      (total, pair) => total + pair.overlapAreaSquareMeters,
      0,
    ),
  };
};

export const cadBuildParcelGapDiagnostics = (
  parcels: readonly CadParcelEntity[],
): CadParcelGapDiagnostics => {
  if (parcels.length === 0) {
    return {
      parcelCount: 0,
      componentCount: 0,
      exposedLoopCount: 0,
      isSupported: false,
      gapLoops: [],
      totalGapAreaSquareMeters: 0,
    };
  }

  const allSegments = parcels.flatMap(buildParcelBoundarySegments);
  const groupedSegments = new Map<string, CadParcelBoundarySegment[]>();
  allSegments.forEach((segment) => {
    const key =
      segment.startKey < segment.endKey
        ? `${segment.startKey}|${segment.endKey}`
        : `${segment.endKey}|${segment.startKey}`;
    const existing = groupedSegments.get(key);
    if (existing) {
      existing.push(segment);
      return;
    }
    groupedSegments.set(key, [segment]);
  });

  const exposedSegments = [...groupedSegments.values()]
    .filter((group) => group.length === 1)
    .map((group) => group[0]!);
  if (exposedSegments.length === 0) {
    return {
      parcelCount: parcels.length,
      componentCount: 0,
      exposedLoopCount: 0,
      isSupported: false,
      gapLoops: [],
      totalGapAreaSquareMeters: 0,
    };
  }

  const nodeMap = new Map<string, { point: CadWorldPoint; edges: number[] }>();
  exposedSegments.forEach((segment, index) => {
    [
      { key: segment.startKey, point: segment.start },
      { key: segment.endKey, point: segment.end },
    ].forEach(({ key, point }) => {
      const existing = nodeMap.get(key);
      if (existing) {
        existing.edges.push(index);
        return;
      }
      nodeMap.set(key, {
        point,
        edges: [index],
      });
    });
  });

  let componentCount = 0;
  const visitedNodeKeys = new Set<string>();
  nodeMap.forEach((_, key) => {
    if (visitedNodeKeys.has(key)) return;
    componentCount += 1;
    const queue = [key];
    visitedNodeKeys.add(key);
    while (queue.length > 0) {
      const currentKey = queue.shift();
      if (!currentKey) continue;
      const current = nodeMap.get(currentKey);
      if (!current) continue;
      current.edges.forEach((edgeIndex) => {
        const edge = exposedSegments[edgeIndex]!;
        [edge.startKey, edge.endKey].forEach((nextKey) => {
          if (visitedNodeKeys.has(nextKey)) return;
          visitedNodeKeys.add(nextKey);
          queue.push(nextKey);
        });
      });
    }
  });

  const isSupported = [...nodeMap.values()].every((node) => node.edges.length === 2);
  if (!isSupported) {
    return {
      parcelCount: parcels.length,
      componentCount,
      exposedLoopCount: 0,
      isSupported: false,
      gapLoops: [],
      totalGapAreaSquareMeters: 0,
    };
  }

  const usedEdgeIndexes = new Set<number>();
  const loops: CadWorldPoint[][] = [];
  exposedSegments.forEach((segment, segmentIndex) => {
    if (usedEdgeIndexes.has(segmentIndex)) return;
    const loop: CadWorldPoint[] = [{ x: segment.start.x, y: segment.start.y }];
    let currentEdgeIndex = segmentIndex;
    let currentNodeKey = segment.startKey;
    const startNodeKey = segment.startKey;
    let guard = 0;
    while (guard < exposedSegments.length * 2) {
      const currentEdge = exposedSegments[currentEdgeIndex]!;
      usedEdgeIndexes.add(currentEdgeIndex);
      const nextNodeKey = currentNodeKey === currentEdge.startKey ? currentEdge.endKey : currentEdge.startKey;
      const nextPoint = currentNodeKey === currentEdge.startKey ? currentEdge.end : currentEdge.start;
      loop.push({ x: nextPoint.x, y: nextPoint.y });
      if (nextNodeKey === startNodeKey) break;
      const node = nodeMap.get(nextNodeKey);
      if (!node) break;
      const nextEdgeIndex = node.edges.find((edgeIndex) => edgeIndex !== currentEdgeIndex);
      if (nextEdgeIndex == null) break;
      currentNodeKey = nextNodeKey;
      currentEdgeIndex = nextEdgeIndex;
      guard += 1;
    }
    if (loop.length >= 4 && parcelPointsMatch(loop[0]!, loop[loop.length - 1]!)) {
      loops.push(loop);
    }
  });

  const summarizedLoops = loops
    .map((loop) => {
      const summary = cadBuildParcelClosureSummary(loop);
      return summary == null ? null : { loop, summary };
    })
    .filter((entry): entry is { loop: CadWorldPoint[]; summary: CadParcelClosureSummary } => entry != null);
  const gapLoops = summarizedLoops
    .filter(({ summary }, index) =>
      summarizedLoops.some((candidate, candidateIndex) =>
        candidateIndex !== index &&
        candidate.summary.areaSquareMeters > summary.areaSquareMeters + 1e-6 &&
        cadPointInPolygon(summary.centroid, normalizeParcelPolygonVertices(candidate.loop)),
      ),
    )
    .map(({ summary }) => ({
      areaSquareMeters: summary.areaSquareMeters,
      centroid: summary.centroid,
    }));

  return {
    parcelCount: parcels.length,
    componentCount,
    exposedLoopCount: summarizedLoops.length,
    isSupported: true,
    gapLoops,
    totalGapAreaSquareMeters: gapLoops.reduce((total, loop) => total + loop.areaSquareMeters, 0),
  };
};
