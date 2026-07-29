import type { CadWorldPoint } from './cadGeometry';
import type { CadEntityId, CadLineEntity, CadPolylineEntity } from './cadTypes';
import {
  buildParcelLineCandidate,
  buildParcelNodeMap,
} from './cadCogoParcelDiagnostics';
import {
  compareParcelPoints,
  normalizeParcelSourceVertexLabels,
  parcelPointsMatch,
} from './cadCogoParcelGeometryPrimitives';
import type { CadParcelSourceDraft } from './cadCogoParcelGeometryTypes';

const normalizePolylineParcelSource = (entity: CadPolylineEntity): CadParcelSourceDraft | null => {
  if (entity.vertices.length < 3) return null;
  const firstVertex = entity.vertices[0];
  const lastVertex = entity.vertices[entity.vertices.length - 1];
  if (!firstVertex || !lastVertex) return null;
  const ringVertices =
    entity.vertices.length > 1 && parcelPointsMatch(firstVertex, lastVertex)
      ? entity.vertices.slice(0, -1)
      : entity.vertices;
  const ringLabels =
    entity.vertexLabels.length > 1 &&
    entity.vertexLabels[0] === entity.vertexLabels[entity.vertexLabels.length - 1]
      ? entity.vertexLabels.slice(0, -1)
      : entity.vertexLabels;
  const normalizedLabels = normalizeParcelSourceVertexLabels(ringLabels);
  return ringVertices.length >= 3
    ? {
        vertices: ringVertices.map((vertex) => ({ x: vertex.x, y: vertex.y })),
        vertexLabels: normalizedLabels,
        sourceEntityIds: [entity.id],
      }
    : null;
};

const chooseFirstClosedLineEntityId = (
  startNode: ReturnType<typeof buildParcelNodeMap> extends Map<string, infer T> ? T : never,
  candidateById: ReturnType<typeof buildParcelLineCandidate>[] extends Array<infer T>
    ? Map<CadEntityId, T>
    : never,
): CadEntityId | undefined =>
  [...startNode.incidentEntityIds].sort((leftId, rightId) => {
    const leftCandidate = candidateById.get(leftId)!;
    const rightCandidate = candidateById.get(rightId)!;
    const leftPoint =
      leftCandidate.startKey === startNode.key ? leftCandidate.end : leftCandidate.start;
    const rightPoint =
      rightCandidate.startKey === startNode.key ? rightCandidate.end : rightCandidate.start;
    const pointCompare = compareParcelPoints(leftPoint, rightPoint);
    return pointCompare !== 0 ? pointCompare : leftId.localeCompare(rightId);
  })[0];

const buildClosedLineParcelSource = (
  entities: readonly CadLineEntity[],
): CadParcelSourceDraft | null => {
  if (entities.length < 3) return null;
  const candidates = entities.map(buildParcelLineCandidate);
  const nodeMap = buildParcelNodeMap(candidates);
  const nodes = [...nodeMap.values()];
  if (nodes.length < 3) return null;
  if (nodes.some((node) => node.incidentEntityIds.length !== 2)) return null;

  const candidateById = new Map(candidates.map((candidate) => [candidate.entityId, candidate]));
  const startNode = [...nodes].sort((left, right) => compareParcelPoints(left.point, right.point))[0]!;
  const firstEntityId = chooseFirstClosedLineEntityId(startNode, candidateById);
  if (!firstEntityId) return null;

  const vertices: CadWorldPoint[] = [];
  const vertexLabels: string[] = [];
  const sourceEntityIds: CadEntityId[] = [];
  const usedEntityIds = new Set<CadEntityId>();
  let currentNode = startNode;
  let nextEntityId: CadEntityId | undefined = firstEntityId;

  vertices.push(currentNode.point);
  vertexLabels.push(currentNode.label);

  while (nextEntityId) {
    if (usedEntityIds.has(nextEntityId)) return null;
    const candidate = candidateById.get(nextEntityId);
    if (!candidate) return null;
    usedEntityIds.add(nextEntityId);
    sourceEntityIds.push(nextEntityId);

    const forward = candidate.startKey === currentNode.key;
    const nextPoint = forward ? candidate.end : candidate.start;
    const nextLabel = forward ? candidate.endLabel : candidate.startLabel;
    const nextKey = forward ? candidate.endKey : candidate.startKey;

    vertices.push(nextPoint);
    vertexLabels.push(nextLabel);

    const nextNode = nodeMap.get(nextKey);
    if (!nextNode) return null;
    currentNode = nextNode;

    if (usedEntityIds.size === candidates.length) {
      break;
    }
    nextEntityId = [...currentNode.incidentEntityIds]
      .filter((entityId) => !usedEntityIds.has(entityId))
      .sort()[0];
    if (!nextEntityId) return null;
  }

  if (!parcelPointsMatch(vertices[0]!, vertices[vertices.length - 1]!)) return null;
  if (vertexLabels[0] !== vertexLabels[vertexLabels.length - 1]) return null;

  return {
    vertices: vertices.slice(0, -1),
    vertexLabels: vertexLabels.slice(0, -1),
    sourceEntityIds,
  };
};

export const cadBuildParcelSourceDraft = (
  sourceEntities: readonly (CadLineEntity | CadPolylineEntity)[],
): CadParcelSourceDraft | null => {
  if (sourceEntities.length === 0) return null;
  if (sourceEntities.length === 1 && sourceEntities[0]?.type === 'polyline') {
    return normalizePolylineParcelSource(sourceEntities[0]);
  }
  if (sourceEntities.every((entity) => entity.type === 'line')) {
    return buildClosedLineParcelSource(sourceEntities);
  }
  return null;
};
