import {
  cadDistance,
  cadNormalizeAngleDeg,
  cadSignedSweepDeg,
} from './cadGeometry';
import type {
  CadArcEntity,
  CadEntity,
  CadEntityId,
  CadLineEntity,
  CadPolylineEntity,
  CadProject,
} from './cadTypes';
export type CadTrimEntity = CadLineEntity | CadPolylineEntity | CadArcEntity;

export interface CadTrimSegmentRef {
  segmentId: string;
  start: { x: number; y: number };
  end: { x: number; y: number };
  startLabel: string;
  endLabel: string;
  startDistance: number;
  length: number;
}

export interface CadTrimInterval {
  start: number;
  end: number;
}

export interface CadTrimPieceBuildOptions {
  preserveOriginalIdWhenSingle?: boolean;
  idForPiece?: (_index: number) => string;
  includeTrimMetadata?: boolean;
}

export const TRIM_EPSILON = 1e-6;

export const isTrimmableEntity = (entity: CadEntity): entity is CadTrimEntity =>
  entity.type === 'line' || entity.type === 'polyline' || entity.type === 'arc';

export const buildTrimSegments = (entity: CadLineEntity | CadPolylineEntity): CadTrimSegmentRef[] => {
  if (entity.type === 'line') {
    return [
      {
        segmentId: `${entity.id}#0`,
        start: { x: entity.fromX, y: entity.fromY },
        end: { x: entity.toX, y: entity.toY },
        startLabel: entity.fromStationId,
        endLabel: entity.toStationId,
        startDistance: 0,
        length: cadDistance({ x: entity.fromX, y: entity.fromY }, { x: entity.toX, y: entity.toY }),
      },
    ];
  }

  const segments: CadTrimSegmentRef[] = [];
  let startDistance = 0;
  entity.vertices.slice(0, -1).forEach((vertex, index) => {
    const next = entity.vertices[index + 1]!;
    const length = cadDistance(vertex, next);
    segments.push({
      segmentId: `${entity.id}#${index}`,
      start: vertex,
      end: next,
      startLabel: entity.vertexLabels[index] ?? `V${index + 1}`,
      endLabel: entity.vertexLabels[index + 1] ?? `V${index + 2}`,
      startDistance,
      length,
    });
    startDistance += length;
  });
  return segments;
};

export const trimEntityTotalLength = (entity: CadLineEntity | CadPolylineEntity): number => {
  const segments = buildTrimSegments(entity);
  if (segments.length === 0) return 0;
  const last = segments[segments.length - 1]!;
  return last.startDistance + last.length;
};

export const pointAtLinePosition = (
  entity: CadLineEntity,
  position: number,
): { x: number; y: number } => {
  const start = { x: entity.fromX, y: entity.fromY };
  const end = { x: entity.toX, y: entity.toY };
  const length = cadDistance(start, end);
  if (length <= TRIM_EPSILON) return start;
  const t = Math.max(0, Math.min(1, position / length));
  return {
    x: start.x + (end.x - start.x) * t,
    y: start.y + (end.y - start.y) * t,
  };
};

export const pointAtPolylinePosition = (
  entity: CadPolylineEntity,
  position: number,
): { x: number; y: number } => {
  const segments = buildTrimSegments(entity);
  if (segments.length === 0) return entity.vertices[0] ?? { x: 0, y: 0 };
  const totalLength = trimEntityTotalLength(entity);
  const clamped = Math.max(0, Math.min(totalLength, position));
  const segment =
    segments.find(
      (candidate) => clamped <= candidate.startDistance + candidate.length + TRIM_EPSILON,
    ) ?? segments[segments.length - 1]!;
  if (segment.length <= TRIM_EPSILON) return segment.start;
  const localDistance = Math.max(0, Math.min(segment.length, clamped - segment.startDistance));
  const t = localDistance / segment.length;
  return {
    x: segment.start.x + (segment.end.x - segment.start.x) * t,
    y: segment.start.y + (segment.end.y - segment.start.y) * t,
  };
};

export const arcPositionAtAngle = (
  entity: CadArcEntity,
  angleDeg: number,
): number => {
  const signedSweep = cadSignedSweepDeg(entity.startAngleDeg, entity.endAngleDeg);
  const direction = signedSweep >= 0 ? 1 : -1;
  const magnitude = Math.abs(signedSweep);
  const normalizedStart = cadNormalizeAngleDeg(entity.startAngleDeg);
  const normalizedAngle = cadNormalizeAngleDeg(angleDeg);
  if (direction >= 0) {
    return Math.min(
      magnitude,
      cadNormalizeAngleDeg(normalizedAngle - normalizedStart),
    );
  }
  return Math.min(
    magnitude,
    cadNormalizeAngleDeg(normalizedStart - normalizedAngle),
  );
};

export const angleAtArcPosition = (entity: CadArcEntity, position: number): number => {
  const signedSweep = cadSignedSweepDeg(entity.startAngleDeg, entity.endAngleDeg);
  const magnitude = Math.abs(signedSweep);
  const clamped = Math.max(0, Math.min(magnitude, position));
  return entity.startAngleDeg + (signedSweep >= 0 ? clamped : -clamped);
};

export const trimLabelForEntity = (entityId: string, pieceIndex: number, endpoint: 'S' | 'E'): string =>
  `${entityId}:TR${pieceIndex}${endpoint}`;

export const addTrimPosition = (positions: number[], value: number, total: number) => {
  if (value <= TRIM_EPSILON || value >= total - TRIM_EPSILON) return;
  if (positions.some((existing) => Math.abs(existing - value) <= TRIM_EPSILON)) return;
  positions.push(value);
};

export const buildTrimKeepIntervals = (
  intersections: number[],
  pickPosition: number,
  total: number,
): CadTrimInterval[] => {
  if (total <= TRIM_EPSILON) return [];
  const boundaries = [0, ...intersections.filter((value) => value > TRIM_EPSILON && value < total - TRIM_EPSILON), total]
    .sort((left, right) => left - right);
  let removeIndex = -1;
  for (let index = 0; index < boundaries.length - 1; index += 1) {
    const start = boundaries[index]!;
    const end = boundaries[index + 1]!;
    if (pickPosition >= start - TRIM_EPSILON && pickPosition <= end + TRIM_EPSILON) {
      removeIndex = index;
      break;
    }
  }
  if (removeIndex < 0) return [];
  return boundaries
    .slice(0, -1)
    .map((start, index) => ({ start, end: boundaries[index + 1]! }))
    .filter((interval, index) => index !== removeIndex && interval.end - interval.start > TRIM_EPSILON);
};

export const buildTrimBoundaryEntities = (
  project: CadProject,
  entityIds: readonly CadEntityId[],
): CadTrimEntity[] =>
  entityIds
    .map((entityId) => project.entities.find((entity) => entity.id === entityId))
    .filter((entity): entity is CadTrimEntity => entity != null && isTrimmableEntity(entity) && !entity.locked);

