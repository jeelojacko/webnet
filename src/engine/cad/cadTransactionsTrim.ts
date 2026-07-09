import {
  cadAngleDegFromCenter,
  cadClosestPointOnArc,
  cadClosestPointOnSegment,
  cadDistance,
  cadIntersectArcArc,
  cadIntersectSegmentArc,
  cadProjectPointOntoInfiniteLine,
  cadSegmentIntersection,
  cadSignedSweepDeg,
} from './cadGeometry';
import {
  addTrimPosition,
  angleAtArcPosition,
  arcPositionAtAngle,
  buildTrimBoundaryEntities,
  buildTrimKeepIntervals,
  buildTrimSegments,
  pointAtLinePosition,
  pointAtPolylinePosition,
  trimEntityTotalLength,
  trimLabelForEntity,
  TRIM_EPSILON,
  isTrimmableEntity,
  type CadTrimEntity,
  type CadTrimInterval,
  type CadTrimPieceBuildOptions,
} from './cadTransactionsTrimCommon';
import type {
  CadArcEntity,
  CadEntity,
  CadEntityId,
  CadLineEntity,
  CadPolylineEntity,
  CadProject,
} from './cadTypes';
import { createStableRuntimeId } from '../id';
const buildTrimIntersectionsForLineLike = (
  target: CadLineEntity | CadPolylineEntity,
  boundaries: readonly CadTrimEntity[],
): number[] => {
  const positions: number[] = [];
  const segments = buildTrimSegments(target);
  const totalLength = trimEntityTotalLength(target);
  boundaries.forEach((boundary) => {
    if (boundary.id === target.id) return;
    if (boundary.type === 'arc') {
      segments.forEach((segment) => {
        cadIntersectSegmentArc(
          segment.start,
          segment.end,
          { x: boundary.centerX, y: boundary.centerY },
          boundary.radius,
          boundary.startAngleDeg,
          boundary.endAngleDeg,
        ).forEach((point) => {
          addTrimPosition(
            positions,
            segment.startDistance + cadDistance(segment.start, point),
            totalLength,
          );
        });
      });
      return;
    }
    const boundarySegments = buildTrimSegments(boundary);
    segments.forEach((targetSegment) => {
      boundarySegments.forEach((boundarySegment) => {
        const point = cadSegmentIntersection(
          targetSegment.start,
          targetSegment.end,
          boundarySegment.start,
          boundarySegment.end,
        );
        if (!point) return;
        addTrimPosition(
          positions,
          targetSegment.startDistance + cadDistance(targetSegment.start, point),
          totalLength,
        );
      });
    });
  });
  return positions.sort((left, right) => left - right);
};

const buildTrimIntersectionsForArc = (
  target: CadArcEntity,
  boundaries: readonly CadTrimEntity[],
): number[] => {
  const positions: number[] = [];
  const totalSweep = Math.abs(cadSignedSweepDeg(target.startAngleDeg, target.endAngleDeg));
  boundaries.forEach((boundary) => {
    if (boundary.id === target.id) return;
    if (boundary.type === 'arc') {
      cadIntersectArcArc(
        { x: target.centerX, y: target.centerY },
        target.radius,
        target.startAngleDeg,
        target.endAngleDeg,
        { x: boundary.centerX, y: boundary.centerY },
        boundary.radius,
        boundary.startAngleDeg,
        boundary.endAngleDeg,
      ).forEach((point) => {
        addTrimPosition(
          positions,
          arcPositionAtAngle(
            target,
            cadAngleDegFromCenter({ x: target.centerX, y: target.centerY }, point),
          ),
          totalSweep,
        );
      });
      return;
    }
    buildTrimSegments(boundary).forEach((segment) => {
      cadIntersectSegmentArc(
        segment.start,
        segment.end,
        { x: target.centerX, y: target.centerY },
        target.radius,
        target.startAngleDeg,
        target.endAngleDeg,
      ).forEach((point) => {
        addTrimPosition(
          positions,
          arcPositionAtAngle(
            target,
            cadAngleDegFromCenter({ x: target.centerX, y: target.centerY }, point),
          ),
          totalSweep,
        );
      });
    });
  });
  return positions.sort((left, right) => left - right);
};

const buildTrimmedLinePieces = (
  entity: CadLineEntity,
  intervals: readonly CadTrimInterval[],
  options?: CadTrimPieceBuildOptions,
): CadLineEntity[] => {
  const totalLength = trimEntityTotalLength(entity);
  return intervals.flatMap((interval, index) => {
    const start = pointAtLinePosition(entity, interval.start);
    const end = pointAtLinePosition(entity, interval.end);
    if (cadDistance(start, end) <= TRIM_EPSILON) return [];
    const preserveId =
      intervals.length === 1 && (options?.preserveOriginalIdWhenSingle ?? true);
    return [{
      ...entity,
      id: preserveId ? entity.id : options?.idForPiece?.(index) ?? createStableRuntimeId('cad-line'),
      fromStationId:
        interval.start <= TRIM_EPSILON ? entity.fromStationId : trimLabelForEntity(entity.id, index + 1, 'S'),
      toStationId:
        interval.end >= totalLength - TRIM_EPSILON ? entity.toStationId : trimLabelForEntity(entity.id, index + 1, 'E'),
      fromX: start.x,
      fromY: start.y,
      toX: end.x,
      toY: end.y,
      metadata:
        options?.includeTrimMetadata === false
          ? entity.metadata
          : {
              ...entity.metadata,
              createdBy: 'TRIM',
              manual: true,
            },
    }];
  });
};

const buildTrimmedPolylinePieces = (
  entity: CadPolylineEntity,
  intervals: readonly CadTrimInterval[],
  options?: CadTrimPieceBuildOptions,
): CadPolylineEntity[] => {
  const totalLength = trimEntityTotalLength(entity);
  const vertexDistances = buildTrimSegments(entity).map((segment) => segment.startDistance);
  vertexDistances.push(totalLength);
  return intervals.flatMap((interval, index) => {
    const points = [pointAtPolylinePosition(entity, interval.start)];
    const labels = [
      interval.start <= TRIM_EPSILON
        ? entity.vertexLabels[0] ?? 'V1'
        : trimLabelForEntity(entity.id, index + 1, 'S'),
    ];
    entity.vertices.forEach((vertex, vertexIndex) => {
      const distance = vertexDistances[vertexIndex] ?? 0;
      if (distance <= interval.start + TRIM_EPSILON || distance >= interval.end - TRIM_EPSILON) return;
      points.push(vertex);
      labels.push(entity.vertexLabels[vertexIndex] ?? `V${vertexIndex + 1}`);
    });
    const endPoint = pointAtPolylinePosition(entity, interval.end);
    if (cadDistance(points[points.length - 1]!, endPoint) > TRIM_EPSILON) {
      points.push(endPoint);
      labels.push(
        interval.end >= totalLength - TRIM_EPSILON
          ? entity.vertexLabels[entity.vertexLabels.length - 1] ?? `V${entity.vertexLabels.length}`
          : trimLabelForEntity(entity.id, index + 1, 'E'),
      );
    } else if (interval.end >= totalLength - TRIM_EPSILON) {
      labels[labels.length - 1] = entity.vertexLabels[entity.vertexLabels.length - 1] ?? `V${entity.vertexLabels.length}`;
    }
    if (points.length < 2) return [];
    const preserveId =
      intervals.length === 1 && (options?.preserveOriginalIdWhenSingle ?? true);
    return [{
      ...entity,
      id:
        preserveId
          ? entity.id
          : options?.idForPiece?.(index) ?? createStableRuntimeId('cad-polyline'),
      vertices: points,
      vertexLabels: labels,
      metadata:
        options?.includeTrimMetadata === false
          ? entity.metadata
          : {
              ...entity.metadata,
              createdBy: 'TRIM',
              manual: true,
            },
    }];
  });
};

const buildTrimmedArcPieces = (
  entity: CadArcEntity,
  intervals: readonly CadTrimInterval[],
  options?: CadTrimPieceBuildOptions,
): CadArcEntity[] => {
  const totalSweep = Math.abs(cadSignedSweepDeg(entity.startAngleDeg, entity.endAngleDeg));
  return intervals.flatMap((interval, index) => {
    if (interval.end - interval.start <= TRIM_EPSILON) return [];
    const preserveId =
      intervals.length === 1 && (options?.preserveOriginalIdWhenSingle ?? true);
    return [{
      ...entity,
      id: preserveId ? entity.id : options?.idForPiece?.(index) ?? createStableRuntimeId('cad-arc'),
      startAngleDeg: angleAtArcPosition(entity, interval.start),
      endAngleDeg: angleAtArcPosition(entity, interval.end),
      metadata:
        options?.includeTrimMetadata === false
          ? entity.metadata
          : {
              ...entity.metadata,
              createdBy: 'TRIM',
              manual: true,
              trimPiece: index + 1,
              trimmedFromArcId: entity.id,
              trimmedTotalSweepDeg: totalSweep,
            },
    }];
  });
};

export const buildTrimmedEntityPieces = (
  entity: CadTrimEntity,
  boundaries: readonly CadTrimEntity[],
  pickPoint: { x: number; y: number },
  targetSegmentId?: string,
  options?: CadTrimPieceBuildOptions,
): CadEntity[] => {
  if (entity.type === 'line') {
    const intersections = buildTrimIntersectionsForLineLike(entity, boundaries);
    if (intersections.length === 0) return [];
    const start = { x: entity.fromX, y: entity.fromY };
    const end = { x: entity.toX, y: entity.toY };
    const projection =
      targetSegmentId === `${entity.id}#0`
        ? cadProjectPointOntoInfiniteLine(pickPoint, start, end)
        : cadProjectPointOntoInfiniteLine(cadClosestPointOnSegment(pickPoint, start, end), start, end);
    const pickPosition = cadDistance(start, projection.point);
    return buildTrimmedLinePieces(
      entity,
      buildTrimKeepIntervals(intersections, pickPosition, trimEntityTotalLength(entity)),
      options,
    );
  }

  if (entity.type === 'polyline') {
    const intersections = buildTrimIntersectionsForLineLike(entity, boundaries);
    if (intersections.length === 0) return [];
    const segments = buildTrimSegments(entity);
    const pickedSegment =
      (targetSegmentId
        ? segments.find((segment) => segment.segmentId === targetSegmentId)
        : null) ??
      segments
        .map((segment) => ({
          segment,
          point: cadClosestPointOnSegment(pickPoint, segment.start, segment.end),
        }))
        .sort(
          (left, right) =>
            cadDistance(left.point, pickPoint) - cadDistance(right.point, pickPoint),
        )[0]?.segment ??
      null;
    if (!pickedSegment) return [];
    const projectedPoint = cadClosestPointOnSegment(pickPoint, pickedSegment.start, pickedSegment.end);
    const pickPosition =
      pickedSegment.startDistance + cadDistance(pickedSegment.start, projectedPoint);
    return buildTrimmedPolylinePieces(
      entity,
      buildTrimKeepIntervals(intersections, pickPosition, trimEntityTotalLength(entity)),
      options,
    );
  }

  const intersections = buildTrimIntersectionsForArc(entity, boundaries);
  if (intersections.length === 0) return [];
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
  return buildTrimmedArcPieces(
    entity,
    buildTrimKeepIntervals(
      intersections,
      pickPosition,
      Math.abs(cadSignedSweepDeg(entity.startAngleDeg, entity.endAngleDeg)),
    ),
    options,
  );
};

export interface CadTrimPreview {
  targetEntityId: CadEntityId;
  previewEntities: CadEntity[];
}

export const buildCadTrimPreview = (
  project: CadProject,
  cuttingEntityIds: readonly CadEntityId[],
  targetEntityId: CadEntityId,
  pickPoint: { x: number; y: number },
  targetSegmentId?: string,
): CadTrimPreview | null => {
  const cuttingEntities = buildTrimBoundaryEntities(project, cuttingEntityIds);
  if (cuttingEntities.length === 0) return null;
  if (cuttingEntities.some((entity) => entity.id === targetEntityId)) return null;
  const targetEntity = project.entities.find(
    (entity): entity is CadTrimEntity =>
      entity.id === targetEntityId && isTrimmableEntity(entity) && !entity.locked,
  );
  if (!targetEntity) return null;
  const previewEntities = buildTrimmedEntityPieces(
    targetEntity,
    cuttingEntities,
    pickPoint,
    targetSegmentId,
    {
      preserveOriginalIdWhenSingle: false,
      idForPiece: (index) => `${targetEntity.id}:trim-preview:${index + 1}`,
      includeTrimMetadata: false,
    },
  ).map((entity, index) => ({
    ...entity,
    id: `${targetEntity.id}:trim-preview:${index + 1}`,
    metadata: targetEntity.metadata,
  }));
  if (previewEntities.length === 0) return null;
  return {
    targetEntityId: targetEntity.id,
    previewEntities,
  };
};

