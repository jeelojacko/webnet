import {
  cadAngleDegFromCenter,
  cadClosestPointOnArc,
  cadClosestPointOnSegment,
  cadDistance,
  cadInfiniteLineIntersection,
  cadIntersectArcArc,
  cadIntersectInfiniteLineArc,
  cadIntersectSegmentArc,
  cadIsAngleOnArcSweep,
  cadNormalizeAngleDeg,
  cadProjectPointOntoInfiniteLine,
  cadSignedSweepDeg,
} from './cadGeometry';
import {
  addTrimPosition,
  angleAtArcPosition,
  arcPositionAtAngle,
  buildTrimBoundaryEntities,
  buildTrimSegments,
  isTrimmableEntity,
  trimEntityTotalLength,
  TRIM_EPSILON,
  type CadTrimEntity,
} from './cadTransactionsTrimCommon';
import type {
  CadArcEntity,
  CadEntity,
  CadEntityId,
  CadLineEntity,
  CadPolylineEntity,
  CadProject,
} from './cadTypes';
const pointOnSegmentInclusive = (
  point: { x: number; y: number },
  start: { x: number; y: number },
  end: { x: number; y: number },
): boolean => {
  const projection = cadProjectPointOntoInfiniteLine(point, start, end);
  if (projection.t < -TRIM_EPSILON || projection.t > 1 + TRIM_EPSILON) return false;
  return cadDistance(point, projection.point) <= 1e-6;
};

const collectLineExtensionIntersections = (
  lineStart: { x: number; y: number },
  lineEnd: { x: number; y: number },
  boundaries: readonly CadTrimEntity[],
  excludeEntityId: CadEntityId,
): Array<{ point: { x: number; y: number }; t: number }> => {
  const intersections: Array<{ point: { x: number; y: number }; t: number }> = [];
  boundaries.forEach((boundary) => {
    if (boundary.id === excludeEntityId) return;
    if (boundary.type === 'arc') {
      cadIntersectInfiniteLineArc(
        lineStart,
        lineEnd,
        { x: boundary.centerX, y: boundary.centerY },
        boundary.radius,
        boundary.startAngleDeg,
        boundary.endAngleDeg,
      ).forEach((point) => {
        intersections.push({
          point,
          t: cadProjectPointOntoInfiniteLine(point, lineStart, lineEnd).t,
        });
      });
      return;
    }
    buildTrimSegments(boundary).forEach((segment) => {
      const point = cadInfiniteLineIntersection(lineStart, lineEnd, segment.start, segment.end);
      if (!point || !pointOnSegmentInclusive(point, segment.start, segment.end)) return;
      intersections.push({
        point,
        t: cadProjectPointOntoInfiniteLine(point, lineStart, lineEnd).t,
      });
    });
  });
  return intersections;
};

const buildExtendedLineEntity = (
  entity: CadLineEntity,
  boundaries: readonly CadTrimEntity[],
  pickPoint: { x: number; y: number },
): CadLineEntity | null => {
  const start = { x: entity.fromX, y: entity.fromY };
  const end = { x: entity.toX, y: entity.toY };
  const projectedPick = cadProjectPointOntoInfiniteLine(pickPoint, start, end).point;
  const extendStart = cadDistance(projectedPick, start) <= cadDistance(projectedPick, end);
  const candidate = collectLineExtensionIntersections(start, end, boundaries, entity.id)
    .filter(({ t }) => (extendStart ? t < -TRIM_EPSILON : t > 1 + TRIM_EPSILON))
    .sort((left, right) => (extendStart ? right.t - left.t : left.t - right.t))[0];
  if (!candidate) return null;
  return extendStart
    ? {
        ...entity,
        fromX: candidate.point.x,
        fromY: candidate.point.y,
        metadata: {
          ...entity.metadata,
          createdBy: 'TRIM',
          manual: true,
        },
      }
    : {
        ...entity,
        toX: candidate.point.x,
        toY: candidate.point.y,
        metadata: {
          ...entity.metadata,
          createdBy: 'TRIM',
          manual: true,
        },
      };
};

const buildExtendedPolylineEntity = (
  entity: CadPolylineEntity,
  boundaries: readonly CadTrimEntity[],
  pickPoint: { x: number; y: number },
  targetSegmentId?: string,
): CadPolylineEntity | null => {
  if (entity.vertices.length < 2) return null;
  const segments = buildTrimSegments(entity);
  const totalLength = trimEntityTotalLength(entity);
  const pickedSegment =
    (targetSegmentId
      ? segments.find((segment) => segment.segmentId === targetSegmentId)
      : null) ??
    segments
      .map((segment) => ({
        segment,
        point: cadClosestPointOnSegment(pickPoint, segment.start, segment.end),
      }))
      .sort((left, right) => cadDistance(left.point, pickPoint) - cadDistance(right.point, pickPoint))[0]?.segment ??
    null;
  if (!pickedSegment) return null;
  const projectedPoint = cadClosestPointOnSegment(pickPoint, pickedSegment.start, pickedSegment.end);
  const pickPosition = pickedSegment.startDistance + cadDistance(pickedSegment.start, projectedPoint);
  const extendStart = pickPosition <= totalLength / 2;
  const lineStart = extendStart ? entity.vertices[1]! : entity.vertices[entity.vertices.length - 2]!;
  const lineEnd = extendStart ? entity.vertices[0]! : entity.vertices[entity.vertices.length - 1]!;
  const candidate = collectLineExtensionIntersections(lineStart, lineEnd, boundaries, entity.id)
    .filter(({ t }) => t > 1 + TRIM_EPSILON)
    .sort((left, right) => left.t - right.t)[0];
  if (!candidate) return null;
  return {
    ...entity,
    vertices: entity.vertices.map((vertex, index) =>
      index === (extendStart ? 0 : entity.vertices.length - 1)
        ? { x: candidate.point.x, y: candidate.point.y }
        : vertex,
    ),
    metadata: {
      ...entity.metadata,
      createdBy: 'TRIM',
      manual: true,
    },
  };
};

const collectArcExtensionIntersections = (
  arc: CadArcEntity,
  boundaries: readonly CadTrimEntity[],
): number[] => {
  const positions: number[] = [];
  boundaries.forEach((boundary) => {
    if (boundary.id === arc.id) return;
    if (boundary.type === 'arc') {
      cadIntersectArcArc(
        { x: arc.centerX, y: arc.centerY },
        arc.radius,
        0,
        360,
        { x: boundary.centerX, y: boundary.centerY },
        boundary.radius,
        boundary.startAngleDeg,
        boundary.endAngleDeg,
      ).forEach((point) => {
        addTrimPosition(
          positions,
          arcPositionAtAngle(arc, cadAngleDegFromCenter({ x: arc.centerX, y: arc.centerY }, point)),
          360,
        );
      });
      return;
    }
    buildTrimSegments(boundary).forEach((segment) => {
      cadIntersectSegmentArc(
        segment.start,
        segment.end,
        { x: arc.centerX, y: arc.centerY },
        arc.radius,
        0,
        360,
      ).forEach((point) => {
        addTrimPosition(
          positions,
          arcPositionAtAngle(arc, cadAngleDegFromCenter({ x: arc.centerX, y: arc.centerY }, point)),
          360,
        );
      });
    });
  });
  return positions.sort((left, right) => left - right);
};

const buildExtendedArcEntity = (
  entity: CadArcEntity,
  boundaries: readonly CadTrimEntity[],
  pickPoint: { x: number; y: number },
): CadArcEntity | null => {
  const totalSweep = Math.abs(cadSignedSweepDeg(entity.startAngleDeg, entity.endAngleDeg));
  const closestPoint = cadClosestPointOnArc(
    pickPoint,
    { x: entity.centerX, y: entity.centerY },
    entity.radius,
    entity.startAngleDeg,
    entity.endAngleDeg,
  );
  const pickPosition = arcPositionAtAngle(
    entity,
    cadAngleDegFromCenter({ x: entity.centerX, y: entity.centerY }, closestPoint),
  );
  const extendStart = pickPosition <= totalSweep / 2;
  const sweepSign = cadSignedSweepDeg(entity.startAngleDeg, entity.endAngleDeg) >= 0 ? 1 : -1;
  const currentStartNorm = cadNormalizeAngleDeg(entity.startAngleDeg);
  const currentEndNorm = cadNormalizeAngleDeg(entity.endAngleDeg);
  const candidate = collectArcExtensionIntersections(entity, boundaries)
    .map((position) => {
      const angleDeg = cadNormalizeAngleDeg(angleAtArcPosition(entity, position));
      if (cadIsAngleOnArcSweep(angleDeg, entity.startAngleDeg, entity.endAngleDeg, 1e-6)) {
        const atStart = cadNormalizeAngleDeg(angleDeg - currentStartNorm) <= 1e-6;
        const atEnd = cadNormalizeAngleDeg(currentEndNorm - angleDeg) <= 1e-6;
        if (!(atStart || atEnd)) return null;
      }
      const delta = extendStart
        ? (sweepSign >= 0
            ? cadNormalizeAngleDeg(currentStartNorm - angleDeg)
            : cadNormalizeAngleDeg(angleDeg - currentStartNorm))
        : (sweepSign >= 0
            ? cadNormalizeAngleDeg(angleDeg - currentEndNorm)
            : cadNormalizeAngleDeg(currentEndNorm - angleDeg));
      if (delta <= TRIM_EPSILON) return null;
      return { delta };
    })
    .filter((entry): entry is { delta: number } => entry != null)
    .sort((left, right) => left.delta - right.delta)[0];
  if (!candidate) return null;
  return extendStart
    ? {
        ...entity,
        startAngleDeg: sweepSign >= 0 ? entity.startAngleDeg - candidate.delta : entity.startAngleDeg + candidate.delta,
        metadata: {
          ...entity.metadata,
          createdBy: 'TRIM',
          manual: true,
        },
      }
    : {
        ...entity,
        endAngleDeg: sweepSign >= 0 ? entity.endAngleDeg + candidate.delta : entity.endAngleDeg - candidate.delta,
        metadata: {
          ...entity.metadata,
          createdBy: 'TRIM',
          manual: true,
        },
      };
};

export const buildExtendedTrimEntity = (
  entity: CadTrimEntity,
  boundaries: readonly CadTrimEntity[],
  pickPoint: { x: number; y: number },
  targetSegmentId?: string,
): CadEntity[] => {
  if (entity.type === 'line') {
    const extended = buildExtendedLineEntity(entity, boundaries, pickPoint);
    return extended ? [extended] : [];
  }
  if (entity.type === 'polyline') {
    const extended = buildExtendedPolylineEntity(entity, boundaries, pickPoint, targetSegmentId);
    return extended ? [extended] : [];
  }
  const extended = buildExtendedArcEntity(entity, boundaries, pickPoint);
  return extended ? [extended] : [];
};

export interface CadExtendPreview {
  targetEntityId: CadEntityId;
  boundaryEntityId: CadEntityId;
  previewEntities: CadEntity[];
}

export const buildCadExtendPreview = (
  project: CadProject,
  boundaryEntityId: CadEntityId,
  targetEntityId: CadEntityId,
  targetPickPoint: { x: number; y: number },
  targetSegmentId?: string,
): CadExtendPreview | null => {
  const boundaryEntities = buildTrimBoundaryEntities(project, [boundaryEntityId]);
  if (boundaryEntities.length === 0) return null;
  if (boundaryEntities.some((entity) => entity.id === targetEntityId)) return null;
  const targetEntity = project.entities.find(
    (entity): entity is CadTrimEntity =>
      entity.id === targetEntityId && isTrimmableEntity(entity) && !entity.locked,
  );
  if (!targetEntity) return null;
  const previewEntities = buildExtendedTrimEntity(
    targetEntity,
    boundaryEntities,
    targetPickPoint,
    targetSegmentId,
  ).map((entity, index) => ({
    ...entity,
    id: `${targetEntity.id}:extend-preview:${index + 1}`,
    metadata: targetEntity.metadata,
  }));
  if (previewEntities.length === 0) return null;
  return {
    targetEntityId: targetEntity.id,
    boundaryEntityId,
    previewEntities,
  };
};

