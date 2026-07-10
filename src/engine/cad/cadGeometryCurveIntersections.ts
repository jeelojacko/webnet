import {
  cadAngleDegFromCenter,
  cadDistance,
  cadPointOnCircle,
  type CadSegmentGeometry,
  type CadWorldPoint,
} from './cadGeometry';
import { cadIsAngleOnArcSweep } from './cadGeometryCurves';

const dedupeCadPoints = (points: CadWorldPoint[], tolerance = 1e-9): CadWorldPoint[] => {
  const result: CadWorldPoint[] = [];
  points.forEach((point) => {
    if (
      result.some(
        (existing) =>
          Math.abs(existing.x - point.x) <= tolerance && Math.abs(existing.y - point.y) <= tolerance,
      )
    ) {
      return;
    }
    result.push(point);
  });
  return result;
};

export const cadIntersectSegmentCircle = (
  start: CadWorldPoint,
  end: CadWorldPoint,
  center: CadWorldPoint,
  radius: number,
): CadWorldPoint[] => {
  const dx = end.x - start.x;
  const dy = end.y - start.y;
  const fx = start.x - center.x;
  const fy = start.y - center.y;
  const a = dx * dx + dy * dy;
  if (a <= 1e-12) return [];
  const b = 2 * (fx * dx + fy * dy);
  const c = fx * fx + fy * fy - radius * radius;
  const discriminant = b * b - 4 * a * c;
  if (discriminant < -1e-12) return [];
  const root = Math.sqrt(Math.max(0, discriminant));
  const candidates = [
    (-b - root) / (2 * a),
    (-b + root) / (2 * a),
  ]
    .filter((t) => t >= -1e-9 && t <= 1 + 1e-9)
    .map((t) => ({
      x: start.x + dx * t,
      y: start.y + dy * t,
    }))
    .sort((left, right) => {
      if (Math.abs(left.x - right.x) > 1e-9) return left.x - right.x;
      return left.y - right.y;
    });
  return dedupeCadPoints(candidates);
};

export const cadIntersectSegmentArc = (
  start: CadWorldPoint,
  end: CadWorldPoint,
  center: CadWorldPoint,
  radius: number,
  startAngleDeg: number,
  endAngleDeg: number,
): CadWorldPoint[] =>
  cadIntersectSegmentCircle(start, end, center, radius).filter((point) =>
    cadIsAngleOnArcSweep(cadAngleDegFromCenter(center, point), startAngleDeg, endAngleDeg),
  );

export const cadIntersectInfiniteLineCircle = (
  start: CadWorldPoint,
  end: CadWorldPoint,
  center: CadWorldPoint,
  radius: number,
): CadWorldPoint[] => {
  const dx = end.x - start.x;
  const dy = end.y - start.y;
  const fx = start.x - center.x;
  const fy = start.y - center.y;
  const a = dx * dx + dy * dy;
  if (a <= 1e-12) return [];
  const b = 2 * (fx * dx + fy * dy);
  const c = fx * fx + fy * fy - radius * radius;
  const discriminant = b * b - 4 * a * c;
  if (discriminant < -1e-12) return [];
  const root = Math.sqrt(Math.max(0, discriminant));
  const candidates = [
    (-b - root) / (2 * a),
    (-b + root) / (2 * a),
  ].map((t) => ({
    x: start.x + dx * t,
    y: start.y + dy * t,
  }));
  return dedupeCadPoints(candidates).sort((left, right) => {
    if (Math.abs(left.x - right.x) > 1e-9) return left.x - right.x;
    return left.y - right.y;
  });
};

export const cadIntersectInfiniteLineArc = (
  start: CadWorldPoint,
  end: CadWorldPoint,
  center: CadWorldPoint,
  radius: number,
  startAngleDeg: number,
  endAngleDeg: number,
): CadWorldPoint[] =>
  cadIntersectInfiniteLineCircle(start, end, center, radius).filter((point) =>
    cadIsAngleOnArcSweep(cadAngleDegFromCenter(center, point), startAngleDeg, endAngleDeg),
  );

export const cadIntersectCircleCircle = (
  firstCenter: CadWorldPoint,
  firstRadius: number,
  secondCenter: CadWorldPoint,
  secondRadius: number,
): CadWorldPoint[] => {
  const centerDistance = cadDistance(firstCenter, secondCenter);
  if (centerDistance <= 1e-12) return [];
  if (centerDistance > firstRadius + secondRadius + 1e-9) return [];
  if (centerDistance < Math.abs(firstRadius - secondRadius) - 1e-9) return [];

  const a =
    (firstRadius * firstRadius - secondRadius * secondRadius + centerDistance * centerDistance) /
    (2 * centerDistance);
  const heightSquared = firstRadius * firstRadius - a * a;
  if (heightSquared < -1e-9) return [];

  const baseX = firstCenter.x + ((secondCenter.x - firstCenter.x) * a) / centerDistance;
  const baseY = firstCenter.y + ((secondCenter.y - firstCenter.y) * a) / centerDistance;
  const offsetScale = Math.sqrt(Math.max(0, heightSquared)) / centerDistance;
  const offsetX = -(secondCenter.y - firstCenter.y) * offsetScale;
  const offsetY = (secondCenter.x - firstCenter.x) * offsetScale;

  const candidates = dedupeCadPoints([
    { x: baseX + offsetX, y: baseY + offsetY },
    { x: baseX - offsetX, y: baseY - offsetY },
  ]);

  return candidates.sort((left, right) => {
    if (Math.abs(right.y - left.y) > 1e-9) return right.y - left.y;
    return left.x - right.x;
  });
};

export const cadIntersectArcArc = (
  firstCenter: CadWorldPoint,
  firstRadius: number,
  firstStartAngleDeg: number,
  firstEndAngleDeg: number,
  secondCenter: CadWorldPoint,
  secondRadius: number,
  secondStartAngleDeg: number,
  secondEndAngleDeg: number,
): CadWorldPoint[] =>
  cadIntersectCircleCircle(firstCenter, firstRadius, secondCenter, secondRadius).filter(
    (point) =>
      cadIsAngleOnArcSweep(cadAngleDegFromCenter(firstCenter, point), firstStartAngleDeg, firstEndAngleDeg) &&
      cadIsAngleOnArcSweep(
        cadAngleDegFromCenter(secondCenter, point),
        secondStartAngleDeg,
        secondEndAngleDeg,
      ),
  );

export const cadTangentPointsFromExternalPointToCircle = (
  point: CadWorldPoint,
  center: CadWorldPoint,
  radius: number,
): CadWorldPoint[] => {
  const distanceToCenter = cadDistance(point, center);
  if (distanceToCenter < radius - 1e-9 || radius <= 1e-12) return [];
  if (Math.abs(distanceToCenter - radius) <= 1e-9) {
    return [{ ...point }];
  }
  const angleToPointDeg = cadAngleDegFromCenter(center, point);
  const offsetDeg = (Math.acos(Math.max(-1, Math.min(1, radius / distanceToCenter))) * 180) / Math.PI;
  return dedupeCadPoints([
    cadPointOnCircle(center, radius, angleToPointDeg + offsetDeg),
    cadPointOnCircle(center, radius, angleToPointDeg - offsetDeg),
  ]);
};

export const cadTangentPointsFromExternalPointToArc = (
  point: CadWorldPoint,
  center: CadWorldPoint,
  radius: number,
  startAngleDeg: number,
  endAngleDeg: number,
): CadWorldPoint[] =>
  cadTangentPointsFromExternalPointToCircle(point, center, radius).filter((candidate) =>
    cadIsAngleOnArcSweep(cadAngleDegFromCenter(center, candidate), startAngleDeg, endAngleDeg),
  );

export const cadOffsetLineSegment = (
  start: CadWorldPoint,
  end: CadWorldPoint,
  offsetDistance: number,
): CadSegmentGeometry => {
  const dx = end.x - start.x;
  const dy = end.y - start.y;
  const length = Math.hypot(dx, dy);
  if (length <= 1e-12) {
    return {
      start: { ...start },
      end: { ...end },
    };
  }
  const normalX = -dy / length;
  const normalY = dx / length;
  return {
    start: {
      x: start.x + normalX * offsetDistance,
      y: start.y + normalY * offsetDistance,
    },
    end: {
      x: end.x + normalX * offsetDistance,
      y: end.y + normalY * offsetDistance,
    },
  };
};

export const cadBuildParallelLine = (
  start: CadWorldPoint,
  end: CadWorldPoint,
  throughPoint: CadWorldPoint,
): CadSegmentGeometry => ({
  start: { ...throughPoint },
  end: {
    x: throughPoint.x + (end.x - start.x),
    y: throughPoint.y + (end.y - start.y),
  },
});

export const cadBuildPerpendicularFoot = (
  lineStart: CadWorldPoint,
  lineEnd: CadWorldPoint,
  fromPoint: CadWorldPoint,
): CadWorldPoint => {
  const dx = lineEnd.x - lineStart.x;
  const dy = lineEnd.y - lineStart.y;
  const lengthSquared = dx * dx + dy * dy;
  if (lengthSquared <= 1e-12) return { ...lineStart };
  const t = ((fromPoint.x - lineStart.x) * dx + (fromPoint.y - lineStart.y) * dy) / lengthSquared;
  return {
    x: lineStart.x + dx * t,
    y: lineStart.y + dy * t,
  };
};
