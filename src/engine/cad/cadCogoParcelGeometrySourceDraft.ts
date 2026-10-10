import { cadDistance, cadSignedSweepDeg, type CadWorldPoint } from './cadGeometry';
import { cadArcEndPoint, cadArcStartPoint } from './cadGeometryArcPrimitives';
import { parcelBulgeFromArcDefinition, validateParcelBoundaryTopology } from './cadParcelArcGeometry';
import type {
  CadArcEntity,
  CadEntityId,
  CadLineEntity,
  CadParcelCourseGeometry,
  CadPolylineEntity,
} from './cadTypes';
import {
  buildParcelLineCandidate,
  buildParcelNodeMap,
} from './cadCogoParcelLineworkTopology';
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

// ---------------------------------------------------------------------------
// Mixed line/arc chain creation (Phase 19C Round 2).
// ---------------------------------------------------------------------------

interface CadParcelChainCandidate {
  entityId: CadEntityId;
  start: CadWorldPoint;
  end: CadWorldPoint;
  startLabel: string;
  endLabel: string;
  startKey: string;
  endKey: string;
  geometry: CadParcelCourseGeometry;
}

const chainPointKey = (point: CadWorldPoint): string =>
  `${Math.round(point.x / 1e-6)}:${Math.round(point.y / 1e-6)}`;

const buildChainCandidate = (
  entity: CadLineEntity | CadArcEntity,
  index: number,
): CadParcelChainCandidate | null => {
  if (entity.type === 'line') {
    const start = { x: entity.fromX, y: entity.fromY };
    const end = { x: entity.toX, y: entity.toY };
    return {
      entityId: entity.id,
      start,
      end,
      startLabel: entity.fromStationId,
      endLabel: entity.toStationId,
      startKey: chainPointKey(start),
      endKey: chainPointKey(end),
      geometry: { kind: 'line' },
    };
  }
  const start = cadArcStartPoint(entity);
  const end = cadArcEndPoint(entity);
  if (cadDistance(start, end) <= 1e-9) return null;
  const sweep = cadSignedSweepDeg(entity.startAngleDeg, entity.endAngleDeg);
  const bulge = parcelBulgeFromArcDefinition({
    from: start,
    to: end,
    center: { x: entity.centerX, y: entity.centerY },
    radius: entity.radius,
    signedSweepDeg: sweep,
  });
  if (bulge == null) return null;
  return {
    entityId: entity.id,
    start,
    end,
    startLabel: `ARC${index + 1}A`,
    endLabel: `ARC${index + 1}B`,
    startKey: chainPointKey(start),
    endKey: chainPointKey(end),
    geometry: { kind: 'arc', bulge },
  };
};

const reverseChainGeometry = (entry: CadParcelCourseGeometry): CadParcelCourseGeometry =>
  entry.kind === 'arc' ? { kind: 'arc', bulge: -entry.bulge } : { kind: 'line' };

/**
 * Closed connected Line+Arc chain: deterministic traversal (lexicographic
 * start node, then endpoint/id tie-break), exactly two incident entities per
 * node (no branches), self-crossing rejected via the shared topology
 * validator, arcs carried with preserved sweep. Sources untouched; the
 * caller mints fresh ids.
 */
const buildMixedChainParcelSource = (
  entities: readonly (CadLineEntity | CadArcEntity)[],
): CadParcelSourceDraft | null => {
  if (entities.length < 3) return null;
  const candidates = [...entities]
    .sort((left, right) => left.id.localeCompare(right.id))
    .map((entity, index) => buildChainCandidate(entity, index))
    .filter((candidate): candidate is CadParcelChainCandidate => candidate != null);
  if (candidates.length !== entities.length) return null;

  const nodeMap = new Map<string, { key: string; point: CadWorldPoint; label: string; incidentEntityIds: CadEntityId[] }>();
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
      nodeMap.set(key, { key, point, label, incidentEntityIds: [candidate.entityId] });
    });
  });
  const nodes = [...nodeMap.values()];
  if (nodes.length < 3) return null;
  if (nodes.some((node) => node.incidentEntityIds.length !== 2)) return null;

  const candidateById = new Map(candidates.map((candidate) => [candidate.entityId, candidate]));
  const startNode = [...nodes].sort((left, right) => compareParcelPoints(left.point, right.point))[0]!;
  const firstEntityId = [...startNode.incidentEntityIds].sort((leftId, rightId) => {
    const left = candidateById.get(leftId)!;
    const right = candidateById.get(rightId)!;
    const leftPoint = left.startKey === startNode.key ? left.end : left.start;
    const rightPoint = right.startKey === startNode.key ? right.end : right.start;
    const pointCompare = compareParcelPoints(leftPoint, rightPoint);
    return pointCompare !== 0 ? pointCompare : leftId.localeCompare(rightId);
  })[0];
  if (!firstEntityId) return null;

  const vertices: CadWorldPoint[] = [];
  const vertexLabels: string[] = [];
  const sourceEntityIds: CadEntityId[] = [];
  const courseGeometry: CadParcelCourseGeometry[] = [];
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
    courseGeometry.push(forward ? candidate.geometry : reverseChainGeometry(candidate.geometry));

    const nextNode = nodeMap.get(nextKey);
    if (!nextNode) return null;
    currentNode = nextNode;

    if (usedEntityIds.size === candidates.length) break;
    nextEntityId = [...currentNode.incidentEntityIds]
      .filter((entityId) => !usedEntityIds.has(entityId))
      .sort()[0];
    if (!nextEntityId) return null;
  }

  if (!parcelPointsMatch(vertices[0]!, vertices[vertices.length - 1]!)) return null;

  const ringVertices = vertices.slice(0, -1);
  const ringLabels = vertexLabels.slice(0, -1);
  const hasArc = courseGeometry.some((entry) => entry.kind === 'arc');
  if (hasArc && !validateParcelBoundaryTopology(ringVertices, courseGeometry).ok) return null;

  return {
    vertices: ringVertices,
    vertexLabels: normalizeParcelSourceVertexLabels(ringLabels),
    sourceEntityIds,
    ...(hasArc ? { courseGeometry } : {}),
  };
};

export const cadBuildParcelSourceDraft = (
  sourceEntities: readonly (CadLineEntity | CadPolylineEntity | CadArcEntity)[],
): CadParcelSourceDraft | null => {
  if (sourceEntities.length === 0) return null;
  if (sourceEntities.length === 1 && sourceEntities[0]?.type === 'polyline') {
    return normalizePolylineParcelSource(sourceEntities[0]);
  }
  if (sourceEntities.every((entity) => entity.type === 'line')) {
    return buildClosedLineParcelSource(sourceEntities as readonly CadLineEntity[]);
  }
  if (sourceEntities.every((entity) => entity.type === 'line' || entity.type === 'arc')) {
    return buildMixedChainParcelSource(sourceEntities as readonly (CadLineEntity | CadArcEntity)[]);
  }
  return null;
};
