import {
  cadAngleDegFromCenter,
  cadClosestPointOnArc,
  cadClosestPointOnSegment,
  cadDistance,
  cadNormalizeAngleDeg,
  cadPointOnCircle,
  cadProjectPointOntoInfiniteLine,
  cadSignedSweepDeg,
} from './cadGeometry';
import {
  arcPositionAtAngle,
  buildTrimSegments,
  TRIM_EPSILON,
} from './cadTransactionsTrimCommon';
import { sideMismatchPenalty } from './cadTransactionsFilletLine';
import type {
  CadArcEntity,
  CadLineEntity,
  CadPolylineEntity,
} from './cadTypes';

const cadCounterClockwiseDeltaDeg = (startAngleDeg: number, endAngleDeg: number): number =>
  cadNormalizeAngleDeg(endAngleDeg - startAngleDeg);

export type CadFilletEntity = CadLineEntity | CadPolylineEntity | CadArcEntity;

export interface CadFilletSegmentRef {
  kind: 'segment';
  entity: CadLineEntity | CadPolylineEntity;
  segmentId: string;
  start: { x: number; y: number };
  end: { x: number; y: number };
}

export interface CadFilletArcRef {
  kind: 'arc';
  entity: CadArcEntity;
}

export type CadFilletRef = CadFilletSegmentRef | CadFilletArcRef;

export interface CadFilletEntityChoice<TEntity extends CadFilletEntity> {
  entity: TEntity;
  score: number;
  approachDirection: { x: number; y: number } | null;
  departDirection: { x: number; y: number } | null;
}

export interface CadFilletResult {
  firstEntity: CadFilletEntity;
  secondEntity: CadFilletEntity;
  arcDefinition: {
    center: { x: number; y: number };
    radius: number;
    startAngleDeg: number;
    endAngleDeg: number;
  } | null;
}

const pointAtArcAngle = (
  entity: CadArcEntity,
  angleDeg: number,
): { x: number; y: number } =>
  cadPointOnCircle({ x: entity.centerX, y: entity.centerY }, entity.radius, angleDeg);

const normalizeCadVector = (x: number, y: number): { x: number; y: number } | null => {
  const length = Math.hypot(x, y);
  if (length <= 1e-9) return null;
  return { x: x / length, y: y / length };
};

const negateCadVector = (vector: { x: number; y: number } | null): { x: number; y: number } | null =>
  vector ? { x: -vector.x, y: -vector.y } : null;

export const tangentDirectionAlongArcSweep = (
  entity: Pick<CadArcEntity, 'startAngleDeg' | 'endAngleDeg'>,
  angleDeg: number,
): { x: number; y: number } | null => {
  const radians = (angleDeg * Math.PI) / 180;
  const signedSweep = cadSignedSweepDeg(entity.startAngleDeg, entity.endAngleDeg);
  return signedSweep >= 0
    ? normalizeCadVector(-Math.sin(radians), Math.cos(radians))
    : normalizeCadVector(Math.sin(radians), -Math.cos(radians));
};

export const filletJoinContinuityPenalty = (
  incomingDirection: { x: number; y: number } | null,
  outgoingDirection: { x: number; y: number } | null,
): number => {
  if (!incomingDirection || !outgoingDirection) return 1_000_000;
  const dot = Math.abs(
    incomingDirection.x * outgoingDirection.x + incomingDirection.y * outgoingDirection.y,
  );
  if (dot >= 0.9999) return 0;
  if (dot >= 0.999) return 0.01;
  if (dot >= 0.995) return 0.1;
  if (dot >= 0.98) return 100;
  return 1_000_000;
};

const normalizeArcStartToAngle = (entity: CadArcEntity, angleDeg: number): number => {
  const currentSweep = cadSignedSweepDeg(entity.startAngleDeg, entity.endAngleDeg);
  const currentEndNorm = cadNormalizeAngleDeg(entity.endAngleDeg);
  const nextAngleNorm = cadNormalizeAngleDeg(angleDeg);
  if (currentSweep >= 0) {
    const magnitude = cadCounterClockwiseDeltaDeg(nextAngleNorm, currentEndNorm);
    return entity.endAngleDeg - magnitude;
  }
  const magnitude = cadCounterClockwiseDeltaDeg(currentEndNorm, nextAngleNorm);
  return entity.endAngleDeg + magnitude;
};

const normalizeArcEndToAngle = (entity: CadArcEntity, angleDeg: number): number => {
  const currentSweep = cadSignedSweepDeg(entity.startAngleDeg, entity.endAngleDeg);
  const currentStartNorm = cadNormalizeAngleDeg(entity.startAngleDeg);
  const nextAngleNorm = cadNormalizeAngleDeg(angleDeg);
  if (currentSweep >= 0) {
    const magnitude = cadCounterClockwiseDeltaDeg(currentStartNorm, nextAngleNorm);
    return entity.startAngleDeg + magnitude;
  }
  const magnitude = cadCounterClockwiseDeltaDeg(nextAngleNorm, currentStartNorm);
  return entity.startAngleDeg - magnitude;
};

export const buildCadFilletRef = (
  entity: CadFilletEntity,
  pickPoint: { x: number; y: number },
  segmentId?: string,
): CadFilletRef | null => {
  if (entity.type === 'arc') {
    return {
      kind: 'arc',
      entity,
    };
  }
  if (entity.type === 'line') {
    return {
      kind: 'segment',
      entity,
      segmentId: `${entity.id}#0`,
      start: { x: entity.fromX, y: entity.fromY },
      end: { x: entity.toX, y: entity.toY },
    };
  }
  const segments = buildTrimSegments(entity);
  const resolvedSegment =
    (segmentId ? segments.find((candidate) => candidate.segmentId === segmentId) : null) ??
    segments
      .map((candidate) => ({
        segment: candidate,
        point: cadClosestPointOnSegment(pickPoint, candidate.start, candidate.end),
      }))
      .sort((left, right) => cadDistance(left.point, pickPoint) - cadDistance(right.point, pickPoint))[0]?.segment ??
    null;
  if (!resolvedSegment) return null;
  return {
    kind: 'segment',
    entity,
    segmentId: resolvedSegment.segmentId,
    start: resolvedSegment.start,
    end: resolvedSegment.end,
  };
};

export const offsetSegmentPoints = (
  segment: CadFilletSegmentRef,
  offset: number,
): [{ x: number; y: number }, { x: number; y: number }] | null => {
  const dx = segment.end.x - segment.start.x;
  const dy = segment.end.y - segment.start.y;
  const length = Math.hypot(dx, dy);
  if (length <= TRIM_EPSILON) return null;
  const offsetX = (-dy / length) * offset;
  const offsetY = (dx / length) * offset;
  return [
    { x: segment.start.x + offsetX, y: segment.start.y + offsetY },
    { x: segment.end.x + offsetX, y: segment.end.y + offsetY },
  ];
};

const buildTrimmedPolylineForFillet = (
  entity: CadPolylineEntity,
  segmentIndex: number,
  tangentPoint: { x: number; y: number },
  trimStart: boolean,
): CadPolylineEntity => {
  const lastSegmentIndex = entity.vertices.length - 2;
  if (trimStart) {
    if (segmentIndex <= 0) {
      return {
        ...entity,
        vertices: entity.vertices.map((vertex, index) =>
          index === 0 ? { x: tangentPoint.x, y: tangentPoint.y } : vertex,
        ),
      };
    }
    return {
      ...entity,
      vertices: [
        ...entity.vertices.slice(0, segmentIndex + 1),
        { x: tangentPoint.x, y: tangentPoint.y },
        ...entity.vertices.slice(segmentIndex + 1),
      ],
      vertexLabels: [
        ...entity.vertexLabels.slice(0, segmentIndex + 1),
        '',
        ...entity.vertexLabels.slice(segmentIndex + 1),
      ],
    };
  }

  if (segmentIndex >= lastSegmentIndex) {
    return {
      ...entity,
      vertices: entity.vertices.map((vertex, index) =>
        index === segmentIndex + 1 ? { x: tangentPoint.x, y: tangentPoint.y } : vertex,
      ),
    };
  }
  return {
    ...entity,
    vertices: [
      ...entity.vertices.slice(0, segmentIndex + 1),
      { x: tangentPoint.x, y: tangentPoint.y },
      ...entity.vertices.slice(segmentIndex + 1),
    ],
    vertexLabels: [
      ...entity.vertexLabels.slice(0, segmentIndex + 1),
      '',
      ...entity.vertexLabels.slice(segmentIndex + 1),
    ],
  };
};

export const buildSegmentFilletChoices = (
  ref: CadFilletSegmentRef,
  pickPoint: { x: number; y: number },
  tangentPoint: { x: number; y: number },
  centerPoint: { x: number; y: number },
  oppositePickPoint: { x: number; y: number },
  preferPickedSide: boolean,
): Array<CadFilletEntityChoice<CadLineEntity | CadPolylineEntity>> => {
  const tangentProjection = cadProjectPointOntoInfiniteLine(tangentPoint, ref.start, ref.end);
  const tangentOnSegment = tangentProjection.point;
  if (cadDistance(tangentPoint, tangentOnSegment) > 1e-4) return [];
  const tangentT = tangentProjection.t;
  const pickT = cadProjectPointOntoInfiniteLine(pickPoint, ref.start, ref.end).t;
  const pickDistanceToStart = cadDistance(pickPoint, ref.start);
  const pickDistanceToEnd = cadDistance(pickPoint, ref.end);
  const interiorPick = pickT > 0.2 && pickT < 0.8;
  const preferHoveredRay = preferPickedSide || interiorPick;
  const allowTrimStart =
    ref.entity.type === 'line'
      ? tangentT <= 1 + TRIM_EPSILON
      : tangentT >= -TRIM_EPSILON && tangentT <= 1 + TRIM_EPSILON;
  const allowTrimEnd =
    ref.entity.type === 'line'
      ? tangentT >= -TRIM_EPSILON
      : tangentT >= -TRIM_EPSILON && tangentT <= 1 + TRIM_EPSILON;
  const choices: Array<CadFilletEntityChoice<CadLineEntity | CadPolylineEntity>> = [];
  const forwardDirection = normalizeCadVector(ref.end.x - ref.start.x, ref.end.y - ref.start.y);
  const reverseDirection = negateCadVector(forwardDirection);
  if (allowTrimStart) {
    const segmentIndex = Number(ref.segmentId.split('#')[1]);
    const nextEntity =
      ref.entity.type === 'line'
        ? {
            ...ref.entity,
            fromX: tangentOnSegment.x,
            fromY: tangentOnSegment.y,
          }
        : buildTrimmedPolylineForFillet(ref.entity, segmentIndex, tangentOnSegment, true);
    choices.push({
      entity: nextEntity,
      score:
        sideMismatchPenalty(ref.start, ref.end, oppositePickPoint, centerPoint) +
        cadDistance(pickPoint, tangentOnSegment) +
        ((preferHoveredRay
          ? pickT >= tangentT - 1e-9
          : pickDistanceToStart <= pickDistanceToEnd)
          ? 0
          : 1000),
      approachDirection: reverseDirection,
      departDirection: forwardDirection,
    });
  }
  if (allowTrimEnd) {
    const segmentIndex = Number(ref.segmentId.split('#')[1]);
    const nextEntity =
      ref.entity.type === 'line'
        ? {
            ...ref.entity,
            toX: tangentOnSegment.x,
            toY: tangentOnSegment.y,
          }
        : buildTrimmedPolylineForFillet(ref.entity, segmentIndex, tangentOnSegment, false);
    choices.push({
      entity: nextEntity,
      score:
        sideMismatchPenalty(ref.start, ref.end, oppositePickPoint, centerPoint) +
        cadDistance(pickPoint, tangentOnSegment) +
        ((preferHoveredRay
          ? pickT <= tangentT + 1e-9
          : pickDistanceToEnd <= pickDistanceToStart)
          ? 0
          : 1000),
      approachDirection: forwardDirection,
      departDirection: reverseDirection,
    });
  }
  return choices;
};

export const buildArcFilletChoices = (
  ref: CadFilletArcRef,
  pickPoint: { x: number; y: number },
  tangentPoint: { x: number; y: number },
): Array<CadFilletEntityChoice<CadArcEntity>> => {
  const tangentAngleDeg = cadAngleDegFromCenter(
    { x: ref.entity.centerX, y: ref.entity.centerY },
    tangentPoint,
  );
  const pickAngleDeg = cadAngleDegFromCenter(
    { x: ref.entity.centerX, y: ref.entity.centerY },
    pickPoint,
  );
  const totalSweep = Math.abs(cadSignedSweepDeg(ref.entity.startAngleDeg, ref.entity.endAngleDeg));
  const tangentPosition = arcPositionAtAngle(ref.entity, tangentAngleDeg);
  const pickPosition = arcPositionAtAngle(ref.entity, pickAngleDeg);
  const startPoint = pointAtArcAngle(ref.entity, ref.entity.startAngleDeg);
  const endPoint = pointAtArcAngle(ref.entity, ref.entity.endAngleDeg);
  const pickDistanceToStart = cadDistance(pickPoint, startPoint);
  const pickDistanceToEnd = cadDistance(pickPoint, endPoint);
  const interiorPick = pickPosition > totalSweep * 0.2 && pickPosition < totalSweep * 0.8;
  const preferDeepInteriorBranch = interiorPick && totalSweep > 120;
  const trimStartEntity = {
    ...ref.entity,
    startAngleDeg: normalizeArcStartToAngle(ref.entity, tangentAngleDeg),
  };
  const trimEndEntity = {
    ...ref.entity,
    endAngleDeg: normalizeArcEndToAngle(ref.entity, tangentAngleDeg),
  };
  const buildArcChoiceScore = (
    entity: CadArcEntity,
    trimStart: boolean,
    preferredByEndpoint: boolean,
  ): number => {
    const hoverDistance = cadDistance(
      pickPoint,
      cadClosestPointOnArc(
        pickPoint,
        { x: entity.centerX, y: entity.centerY },
        entity.radius,
        entity.startAngleDeg,
        entity.endAngleDeg,
      ),
    );
    const candidateSweep = Math.abs(cadSignedSweepDeg(entity.startAngleDeg, entity.endAngleDeg));
    const candidatePickPosition = arcPositionAtAngle(entity, pickAngleDeg);
    const keptGap = trimStart ? candidatePickPosition : candidateSweep - candidatePickPosition;
    const retainsHoveredArcPoint = hoverDistance <= 1e-6;
    const interiorRetentionPenalty = interiorPick && !retainsHoveredArcPoint ? 1_000_000 : 0;
    if (!preferDeepInteriorBranch) {
      return (
        interiorRetentionPenalty +
        hoverDistance +
        cadDistance(pickPoint, tangentPoint) +
        ((interiorPick
          ? trimStart
            ? pickPosition >= tangentPosition - 1e-6
            : pickPosition <= tangentPosition + 1e-6
          : preferredByEndpoint)
          ? 0
          : 1000)
      );
    }
    return (
      interiorRetentionPenalty +
      hoverDistance * 100 -
      keptGap +
      cadDistance(pickPoint, tangentPoint) +
      ((interiorPick
        ? hoverDistance <= 1e-6
        : preferredByEndpoint)
        ? 0
        : 1000)
    );
  };
  return [
    {
      entity: trimStartEntity,
      score: buildArcChoiceScore(
        trimStartEntity,
        true,
        pickDistanceToStart <= pickDistanceToEnd,
      ),
      approachDirection: negateCadVector(
        tangentDirectionAlongArcSweep(trimStartEntity, tangentAngleDeg),
      ),
      departDirection: tangentDirectionAlongArcSweep(trimStartEntity, tangentAngleDeg),
    },
    {
      entity: trimEndEntity,
      score: buildArcChoiceScore(
        trimEndEntity,
        false,
        pickDistanceToEnd <= pickDistanceToStart,
      ),
      approachDirection: tangentDirectionAlongArcSweep(trimEndEntity, tangentAngleDeg),
      departDirection: negateCadVector(
        tangentDirectionAlongArcSweep(trimEndEntity, tangentAngleDeg),
      ),
    },
  ];
};
