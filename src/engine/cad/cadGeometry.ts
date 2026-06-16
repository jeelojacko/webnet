import type { CadArcEntity } from './cadTypes';

export interface CadWorldPoint {
  x: number;
  y: number;
}

export interface CadNamedPoint extends CadWorldPoint {
  label: string;
  snapSourceSegmentId?: string;
}

export interface CadSegmentGeometry {
  start: CadWorldPoint;
  end: CadWorldPoint;
}

export interface CadCurveMetrics {
  radius: number;
  deltaDeg: number;
  arcLength: number;
  chordLength: number;
  tangentLength: number;
}

export interface CadArcDefinition {
  center: CadWorldPoint;
  radius: number;
  startAngleDeg: number;
  endAngleDeg: number;
  startPoint: CadWorldPoint;
  endPoint: CadWorldPoint;
  deltaDeg: number;
}

export const cadDistance = (from: CadWorldPoint, to: CadWorldPoint): number =>
  Math.hypot(to.x - from.x, to.y - from.y);

export const cadMidpoint = (start: CadWorldPoint, end: CadWorldPoint): CadWorldPoint => ({
  x: (start.x + end.x) / 2,
  y: (start.y + end.y) / 2,
});

export const cadClosestPointOnSegment = (
  point: CadWorldPoint,
  start: CadWorldPoint,
  end: CadWorldPoint,
): CadWorldPoint => {
  const dx = end.x - start.x;
  const dy = end.y - start.y;
  const lengthSquared = dx * dx + dy * dy;
  if (lengthSquared <= 1e-12) return start;
  const t = ((point.x - start.x) * dx + (point.y - start.y) * dy) / lengthSquared;
  const clamped = Math.max(0, Math.min(1, t));
  return {
    x: start.x + dx * clamped,
    y: start.y + dy * clamped,
  };
};

export const cadPointOnInfiniteLine = (
  start: CadWorldPoint,
  end: CadWorldPoint,
  t: number,
): CadWorldPoint => ({
  x: start.x + (end.x - start.x) * t,
  y: start.y + (end.y - start.y) * t,
});

export const cadProjectPointOntoInfiniteLine = (
  point: CadWorldPoint,
  start: CadWorldPoint,
  end: CadWorldPoint,
): { point: CadWorldPoint; t: number } => {
  const dx = end.x - start.x;
  const dy = end.y - start.y;
  const lengthSquared = dx * dx + dy * dy;
  if (lengthSquared <= 1e-12) {
    return {
      point: { ...start },
      t: 0,
    };
  }
  const t = ((point.x - start.x) * dx + (point.y - start.y) * dy) / lengthSquared;
  return {
    point: cadPointOnInfiniteLine(start, end, t),
    t,
  };
};

export const cadPointOnCircle = (
  center: CadWorldPoint,
  radius: number,
  angleDeg: number,
): CadWorldPoint => ({
  x: center.x + Math.cos((angleDeg * Math.PI) / 180) * radius,
  y: center.y + Math.sin((angleDeg * Math.PI) / 180) * radius,
});

export const cadSegmentIntersection = (
  firstStart: CadWorldPoint,
  firstEnd: CadWorldPoint,
  secondStart: CadWorldPoint,
  secondEnd: CadWorldPoint,
): CadWorldPoint | null => {
  const dx1 = firstEnd.x - firstStart.x;
  const dy1 = firstEnd.y - firstStart.y;
  const dx2 = secondEnd.x - secondStart.x;
  const dy2 = secondEnd.y - secondStart.y;
  const denominator = dx1 * dy2 - dy1 * dx2;
  if (Math.abs(denominator) <= 1e-12) return null;

  const startDeltaX = secondStart.x - firstStart.x;
  const startDeltaY = secondStart.y - firstStart.y;
  const t = (startDeltaX * dy2 - startDeltaY * dx2) / denominator;
  const u = (startDeltaX * dy1 - startDeltaY * dx1) / denominator;
  if (t < 0 || t > 1 || u < 0 || u > 1) return null;

  return {
    x: firstStart.x + t * dx1,
    y: firstStart.y + t * dy1,
  };
};

export const cadInfiniteLineIntersection = (
  firstStart: CadWorldPoint,
  firstEnd: CadWorldPoint,
  secondStart: CadWorldPoint,
  secondEnd: CadWorldPoint,
): CadWorldPoint | null => {
  const dx1 = firstEnd.x - firstStart.x;
  const dy1 = firstEnd.y - firstStart.y;
  const dx2 = secondEnd.x - secondStart.x;
  const dy2 = secondEnd.y - secondStart.y;
  const denominator = dx1 * dy2 - dy1 * dx2;
  if (Math.abs(denominator) <= 1e-12) return null;

  const startDeltaX = secondStart.x - firstStart.x;
  const startDeltaY = secondStart.y - firstStart.y;
  const t = (startDeltaX * dy2 - startDeltaY * dx2) / denominator;
  return {
    x: firstStart.x + t * dx1,
    y: firstStart.y + t * dy1,
  };
};

export const cadAzimuthDeg = (from: CadWorldPoint, to: CadWorldPoint): number => {
  const east = to.x - from.x;
  const north = to.y - from.y;
  const radians = Math.atan2(east, north);
  const degrees = (radians * 180) / Math.PI;
  return degrees < 0 ? degrees + 360 : degrees;
};

export const cadPointFromAzimuthDistance = (
  from: CadWorldPoint,
  azimuthDeg: number,
  distance: number,
): CadWorldPoint => {
  const radians = (azimuthDeg * Math.PI) / 180;
  return {
    x: from.x + Math.sin(radians) * distance,
    y: from.y + Math.cos(radians) * distance,
  };
};

export const cadNormalizeAngleDeg = (angleDeg: number): number => {
  const normalized = angleDeg % 360;
  return normalized < 0 ? normalized + 360 : normalized;
};

const cadCounterClockwiseDeltaDeg = (startAngleDeg: number, endAngleDeg: number): number =>
  cadNormalizeAngleDeg(endAngleDeg - startAngleDeg);

export const cadSignedSweepDeg = (startAngleDeg: number, endAngleDeg: number): number => {
  let sweep = endAngleDeg - startAngleDeg;
  while (sweep > 360) sweep -= 360;
  while (sweep < -360) sweep += 360;
  return sweep;
};

export const cadAngleDegFromCenter = (
  center: CadWorldPoint,
  point: CadWorldPoint,
): number => cadNormalizeAngleDeg((Math.atan2(point.y - center.y, point.x - center.x) * 180) / Math.PI);

const cadCreateCurveMetrics = (radius: number, deltaDeg: number): CadCurveMetrics | null => {
  if (!Number.isFinite(radius) || !Number.isFinite(deltaDeg)) return null;
  if (radius <= 1e-12 || deltaDeg <= 1e-9 || deltaDeg >= 180 - 1e-9) return null;
  const deltaRad = (deltaDeg * Math.PI) / 180;
  return {
    radius,
    deltaDeg,
    arcLength: radius * deltaRad,
    chordLength: 2 * radius * Math.sin(deltaRad / 2),
    tangentLength: radius * Math.tan(deltaRad / 2),
  };
};

export const cadBuildCurveMetricsFromRadiusDelta = (
  radius: number,
  deltaDeg: number,
): CadCurveMetrics | null => cadCreateCurveMetrics(radius, deltaDeg);

export const cadBuildCurveMetricsFromArcLength = (
  radius: number,
  arcLength: number,
): CadCurveMetrics | null => {
  if (!Number.isFinite(radius) || !Number.isFinite(arcLength) || radius <= 1e-12 || arcLength <= 1e-12) {
    return null;
  }
  const deltaDeg = (arcLength / radius) * (180 / Math.PI);
  return cadCreateCurveMetrics(radius, deltaDeg);
};

export const cadBuildCurveMetricsFromChordLength = (
  radius: number,
  chordLength: number,
): CadCurveMetrics | null => {
  if (
    !Number.isFinite(radius) ||
    !Number.isFinite(chordLength) ||
    radius <= 1e-12 ||
    chordLength <= 1e-12 ||
    chordLength >= 2 * radius - 1e-9
  ) {
    return null;
  }
  const ratio = Math.max(-1, Math.min(1, chordLength / (2 * radius)));
  const deltaDeg = (2 * Math.asin(ratio) * 180) / Math.PI;
  return cadCreateCurveMetrics(radius, deltaDeg);
};

export const cadBuildCurveMetricsFromTangentLength = (
  radius: number,
  tangentLength: number,
): CadCurveMetrics | null => {
  if (
    !Number.isFinite(radius) ||
    !Number.isFinite(tangentLength) ||
    radius <= 1e-12 ||
    tangentLength <= 1e-12
  ) {
    return null;
  }
  const deltaDeg = (2 * Math.atan(tangentLength / radius) * 180) / Math.PI;
  return cadCreateCurveMetrics(radius, deltaDeg);
};

export const cadArcStartPoint = (
  arc: Pick<CadArcEntity, 'centerX' | 'centerY' | 'radius' | 'startAngleDeg'>,
): CadWorldPoint => ({
  x: arc.centerX + Math.cos((arc.startAngleDeg * Math.PI) / 180) * arc.radius,
  y: arc.centerY + Math.sin((arc.startAngleDeg * Math.PI) / 180) * arc.radius,
});

export const cadIsAngleOnArcSweep = (
  angleDeg: number,
  startAngleDeg: number,
  endAngleDeg: number,
  toleranceDeg = 1e-9,
): boolean => {
  const angle = cadNormalizeAngleDeg(angleDeg);
  const start = cadNormalizeAngleDeg(startAngleDeg);
  const signedSweep = cadSignedSweepDeg(startAngleDeg, endAngleDeg);
  const magnitude = Math.abs(signedSweep);
  if (magnitude <= toleranceDeg) return true;
  if (signedSweep >= 0) {
    return cadCounterClockwiseDeltaDeg(start, angle) <= magnitude + toleranceDeg;
  }
  return cadCounterClockwiseDeltaDeg(angle, start) <= magnitude + toleranceDeg;
};

export const cadArcMidpoint = (
  center: CadWorldPoint,
  radius: number,
  startAngleDeg: number,
  endAngleDeg: number,
): CadWorldPoint => {
  const midpointAngleDeg = startAngleDeg + cadSignedSweepDeg(startAngleDeg, endAngleDeg) / 2;
  return cadPointOnCircle(center, radius, midpointAngleDeg);
};

export const cadClosestPointOnArc = (
  point: CadWorldPoint,
  center: CadWorldPoint,
  radius: number,
  startAngleDeg: number,
  endAngleDeg: number,
): CadWorldPoint => {
  const projectedAngleDeg = cadAngleDegFromCenter(center, point);
  if (cadIsAngleOnArcSweep(projectedAngleDeg, startAngleDeg, endAngleDeg)) {
    return cadPointOnCircle(center, radius, projectedAngleDeg);
  }
  const startPoint = cadPointOnCircle(center, radius, startAngleDeg);
  const endPoint = cadPointOnCircle(center, radius, endAngleDeg);
  return cadDistance(point, startPoint) <= cadDistance(point, endPoint) ? startPoint : endPoint;
};

export const cadProjectPointOntoCircle = (
  point: CadWorldPoint,
  center: CadWorldPoint,
  fallbackRadius: number,
): CadWorldPoint => {
  const dx = point.x - center.x;
  const dy = point.y - center.y;
  const length = Math.hypot(dx, dy);
  const radius = length > 1e-12 ? length : Math.max(fallbackRadius, 1e-6);
  if (length <= 1e-12) {
    return {
      x: center.x + radius,
      y: center.y,
    };
  }
  return {
    x: center.x + (dx / length) * radius,
    y: center.y + (dy / length) * radius,
  };
};

const cadChooseArcSweepAngles = (
  firstAngleDeg: number,
  throughAngleDeg: number,
  secondAngleDeg: number,
): { startAngleDeg: number; endAngleDeg: number; deltaDeg: number } => {
  const forwardDelta = cadCounterClockwiseDeltaDeg(firstAngleDeg, secondAngleDeg);
  const throughDelta = cadCounterClockwiseDeltaDeg(firstAngleDeg, throughAngleDeg);
  if (throughDelta <= forwardDelta + 1e-9) {
    return {
      startAngleDeg: cadNormalizeAngleDeg(firstAngleDeg),
      endAngleDeg: cadNormalizeAngleDeg(secondAngleDeg),
      deltaDeg: forwardDelta,
    };
  }
  const reverseDelta = cadCounterClockwiseDeltaDeg(secondAngleDeg, firstAngleDeg);
  return {
    startAngleDeg: cadNormalizeAngleDeg(secondAngleDeg),
    endAngleDeg: cadNormalizeAngleDeg(firstAngleDeg),
    deltaDeg: reverseDelta,
  };
};

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

  const a = (firstRadius * firstRadius - secondRadius * secondRadius + centerDistance * centerDistance) /
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
): CadWorldPoint[] => {
  const candidates = cadIntersectCircleCircle(firstCenter, firstRadius, secondCenter, secondRadius).filter(
    (point) =>
      cadIsAngleOnArcSweep(cadAngleDegFromCenter(firstCenter, point), firstStartAngleDeg, firstEndAngleDeg) &&
      cadIsAngleOnArcSweep(
        cadAngleDegFromCenter(secondCenter, point),
        secondStartAngleDeg,
        secondEndAngleDeg,
      ),
  );

  return candidates;
};

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

export const cadBuildArcFromThreePoints = (
  startPoint: CadWorldPoint,
  throughPoint: CadWorldPoint,
  endPoint: CadWorldPoint,
): CadArcDefinition | null => {
  const denominator =
    2 *
    (
      startPoint.x * (throughPoint.y - endPoint.y) +
      throughPoint.x * (endPoint.y - startPoint.y) +
      endPoint.x * (startPoint.y - throughPoint.y)
    );
  if (Math.abs(denominator) <= 1e-12) return null;

  const startSquared = startPoint.x * startPoint.x + startPoint.y * startPoint.y;
  const throughSquared = throughPoint.x * throughPoint.x + throughPoint.y * throughPoint.y;
  const endSquared = endPoint.x * endPoint.x + endPoint.y * endPoint.y;
  const center = {
    x:
      (startSquared * (throughPoint.y - endPoint.y) +
        throughSquared * (endPoint.y - startPoint.y) +
        endSquared * (startPoint.y - throughPoint.y)) /
      denominator,
    y:
      (startSquared * (endPoint.x - throughPoint.x) +
        throughSquared * (startPoint.x - endPoint.x) +
        endSquared * (throughPoint.x - startPoint.x)) /
      denominator,
  };
  const startAngleDeg = cadAngleDegFromCenter(center, startPoint);
  const throughAngleDeg = cadAngleDegFromCenter(center, throughPoint);
  const endAngleDeg = cadAngleDegFromCenter(center, endPoint);
  const sweep = cadChooseArcSweepAngles(startAngleDeg, throughAngleDeg, endAngleDeg);
  return {
    center,
    radius: cadDistance(center, startPoint),
    startAngleDeg: sweep.startAngleDeg,
    endAngleDeg: sweep.endAngleDeg,
    startPoint:
      Math.abs(sweep.startAngleDeg - startAngleDeg) <= 1e-9 ? { ...startPoint } : { ...endPoint },
    endPoint:
      Math.abs(sweep.endAngleDeg - endAngleDeg) <= 1e-9 ? { ...endPoint } : { ...startPoint },
    deltaDeg: sweep.deltaDeg,
  };
};

const cadBuildArcFromCenterAngles = (
  center: CadWorldPoint,
  radius: number,
  startAngleDeg: number,
  endAngleDeg: number,
): CadArcDefinition => {
  const signedSweep = cadSignedSweepDeg(startAngleDeg, endAngleDeg);
  return {
    center,
    radius,
    startAngleDeg,
    endAngleDeg,
    startPoint: {
      x: center.x + Math.cos((startAngleDeg * Math.PI) / 180) * radius,
      y: center.y + Math.sin((startAngleDeg * Math.PI) / 180) * radius,
    },
    endPoint: {
      x: center.x + Math.cos((endAngleDeg * Math.PI) / 180) * radius,
      y: center.y + Math.sin((endAngleDeg * Math.PI) / 180) * radius,
    },
    deltaDeg: Math.abs(signedSweep),
  };
};

const cadBuildArcFromCenterSweep = (
  center: CadWorldPoint,
  radius: number,
  startAngleDeg: number,
  sweepDeg: number,
): CadArcDefinition | null => {
  if (!Number.isFinite(sweepDeg) || Math.abs(sweepDeg) <= 1e-9 || Math.abs(sweepDeg) >= 360 - 1e-9) {
    return null;
  }
  return cadBuildArcFromCenterAngles(center, radius, startAngleDeg, startAngleDeg + sweepDeg);
};

export const cadBuildArcFromStartCenterEnd = (
  startPoint: CadWorldPoint,
  centerPoint: CadWorldPoint,
  endPoint: CadWorldPoint,
  reverseDirection = false,
): CadArcDefinition | null => {
  const radius = cadDistance(centerPoint, startPoint);
  if (!Number.isFinite(radius) || radius <= 1e-12) return null;
  const endRadius = cadDistance(centerPoint, endPoint);
  if (!Number.isFinite(endRadius) || endRadius <= 1e-12) return null;
  const normalizedEndPoint = {
    x: centerPoint.x + ((endPoint.x - centerPoint.x) / endRadius) * radius,
    y: centerPoint.y + ((endPoint.y - centerPoint.y) / endRadius) * radius,
  };
  const startAngleDeg = cadAngleDegFromCenter(centerPoint, startPoint);
  const endAngleDeg = cadAngleDegFromCenter(centerPoint, normalizedEndPoint);
  const ccwDelta = cadCounterClockwiseDeltaDeg(startAngleDeg, endAngleDeg);
  const shortSweep = ccwDelta <= 180 ? ccwDelta : -(360 - ccwDelta);
  const signedSweep = reverseDirection
    ? (shortSweep >= 0 ? shortSweep - 360 : shortSweep + 360)
    : shortSweep;
  return cadBuildArcFromCenterSweep(centerPoint, radius, startAngleDeg, signedSweep);
};

export const cadBuildArcFromStartCenterAngle = (
  startPoint: CadWorldPoint,
  centerPoint: CadWorldPoint,
  deltaDeg: number,
  reverseDirection = false,
): CadArcDefinition | null => {
  if (!Number.isFinite(deltaDeg) || Math.abs(deltaDeg) <= 1e-9 || Math.abs(deltaDeg) >= 360 - 1e-9) {
    return null;
  }
  const radius = cadDistance(centerPoint, startPoint);
  if (!Number.isFinite(radius) || radius <= 1e-12) return null;
  const startAngleDeg = cadAngleDegFromCenter(centerPoint, startPoint);
  const sweep = Math.abs(deltaDeg);
  return cadBuildArcFromCenterSweep(centerPoint, radius, startAngleDeg, reverseDirection ? -sweep : sweep);
};

export const cadBuildArcFromStartCenterChord = (
  startPoint: CadWorldPoint,
  centerPoint: CadWorldPoint,
  chordLength: number,
  reverseDirection = false,
): CadArcDefinition | null => {
  const radius = cadDistance(centerPoint, startPoint);
  const metrics = cadBuildCurveMetricsFromChordLength(radius, chordLength);
  if (!metrics) return null;
  return cadBuildArcFromStartCenterAngle(startPoint, centerPoint, metrics.deltaDeg, reverseDirection);
};

export const cadBuildArcFromStartEndAngle = (
  startPoint: CadWorldPoint,
  endPoint: CadWorldPoint,
  deltaDeg: number,
  reverseDirection = false,
): CadArcDefinition | null => {
  if (!Number.isFinite(deltaDeg) || Math.abs(deltaDeg) <= 1e-9 || Math.abs(deltaDeg) >= 360 - 1e-9) {
    return null;
  }
  const chordLength = cadDistance(startPoint, endPoint);
  if (chordLength <= 1e-12) return null;
  const halfDeltaRad = (Math.abs(deltaDeg) * Math.PI) / 360;
  const sinHalfDelta = Math.sin(halfDeltaRad);
  if (Math.abs(sinHalfDelta) <= 1e-12) return null;
  const radius = chordLength / (2 * sinHalfDelta);
  const halfChord = chordLength / 2;
  const offset = Math.sqrt(Math.max(0, radius * radius - halfChord * halfChord));
  const midpoint = cadMidpoint(startPoint, endPoint);
  const dx = endPoint.x - startPoint.x;
  const dy = endPoint.y - startPoint.y;
  const length = Math.hypot(dx, dy);
  if (length <= 1e-12) return null;
  const leftNormal = { x: -dy / length, y: dx / length };
  const center = reverseDirection
    ? {
        x: midpoint.x - leftNormal.x * offset,
        y: midpoint.y - leftNormal.y * offset,
      }
    : {
        x: midpoint.x + leftNormal.x * offset,
        y: midpoint.y + leftNormal.y * offset,
      };
  const startAngleDeg = cadAngleDegFromCenter(center, startPoint);
  const endAngleDeg = cadAngleDegFromCenter(center, endPoint);
  const ccwDelta = cadCounterClockwiseDeltaDeg(startAngleDeg, endAngleDeg);
  const desiredDelta = Math.abs(deltaDeg);
  const signedSweep =
    Math.abs(ccwDelta - desiredDelta) <= 1e-6 ? ccwDelta : ccwDelta - 360;
  return cadBuildArcFromCenterSweep(center, radius, startAngleDeg, signedSweep);
};

export const cadBuildArcFromStartEndRadius = (
  startPoint: CadWorldPoint,
  endPoint: CadWorldPoint,
  radius: number,
  reverseDirection = false,
): CadArcDefinition | null => {
  if (!Number.isFinite(radius) || radius <= 1e-12) return null;
  const chordLength = cadDistance(startPoint, endPoint);
  if (chordLength <= 1e-12 || chordLength > 2 * radius + 1e-9) return null;
  const midpoint = cadMidpoint(startPoint, endPoint);
  const halfChord = chordLength / 2;
  const offset = Math.sqrt(Math.max(0, radius * radius - halfChord * halfChord));
  const dx = endPoint.x - startPoint.x;
  const dy = endPoint.y - startPoint.y;
  const length = Math.hypot(dx, dy);
  if (length <= 1e-12) return null;
  const leftNormal = { x: -dy / length, y: dx / length };
  const center = reverseDirection
    ? {
        x: midpoint.x - leftNormal.x * offset,
        y: midpoint.y - leftNormal.y * offset,
      }
    : {
        x: midpoint.x + leftNormal.x * offset,
        y: midpoint.y + leftNormal.y * offset,
      };
  const startAngleDeg = cadAngleDegFromCenter(center, startPoint);
  const endAngleDeg = cadAngleDegFromCenter(center, endPoint);
  const ccwDelta = cadCounterClockwiseDeltaDeg(startAngleDeg, endAngleDeg);
  const signedSweep = ccwDelta <= 180 ? ccwDelta : ccwDelta - 360;
  return cadBuildArcFromCenterSweep(center, radius, startAngleDeg, signedSweep);
};

export const cadBuildArcFromStartEndDirection = (
  startPoint: CadWorldPoint,
  endPoint: CadWorldPoint,
  directionAzimuthDeg: number,
  reverseDirection = false,
): CadArcDefinition | null => {
  if (!Number.isFinite(directionAzimuthDeg)) return null;
  const directionRadians = (directionAzimuthDeg * Math.PI) / 180;
  const tangent = {
    x: Math.sin(directionRadians),
    y: Math.cos(directionRadians),
  };
  const normal = reverseDirection
    ? { x: tangent.y, y: -tangent.x }
    : { x: -tangent.y, y: tangent.x };
  const chord = {
    x: endPoint.x - startPoint.x,
    y: endPoint.y - startPoint.y,
  };
  const denominator = 2 * (chord.x * normal.x + chord.y * normal.y);
  if (Math.abs(denominator) <= 1e-12) return null;
  const t = (chord.x * chord.x + chord.y * chord.y) / denominator;
  const center = {
    x: startPoint.x + normal.x * t,
    y: startPoint.y + normal.y * t,
  };
  const startAngleDeg = cadAngleDegFromCenter(center, startPoint);
  const endAngleDeg = cadAngleDegFromCenter(center, endPoint);
  const ccwDelta = cadCounterClockwiseDeltaDeg(startAngleDeg, endAngleDeg);
  const ccwTangentAzimuth = cadNormalizeAngleDeg(360 - startAngleDeg);
  const tangentMatches = (candidateAzimuthDeg: number): boolean => {
    const difference = cadNormalizeAngleDeg(candidateAzimuthDeg - directionAzimuthDeg);
    return Math.min(difference, 360 - difference) <= 1e-6;
  };
  const signedSweep = tangentMatches(ccwTangentAzimuth) ? ccwDelta : ccwDelta - 360;
  return cadBuildArcFromCenterSweep(center, cadDistance(center, startPoint), startAngleDeg, signedSweep);
};

export const cadBuildArcFromStartTangentRadiusDelta = (
  startPoint: CadWorldPoint,
  tangentAzimuthDeg: number,
  radius: number,
  deltaDeg: number,
  side: 'left' | 'right',
): CadArcDefinition | null => {
  if (
    !Number.isFinite(tangentAzimuthDeg) ||
    !Number.isFinite(radius) ||
    !Number.isFinite(deltaDeg) ||
    radius <= 1e-12 ||
    Math.abs(deltaDeg) <= 1e-9 ||
    Math.abs(deltaDeg) >= 360 - 1e-9
  ) {
    return null;
  }
  const tangentRadians = (tangentAzimuthDeg * Math.PI) / 180;
  const tangent = {
    x: Math.sin(tangentRadians),
    y: Math.cos(tangentRadians),
  };
  const leftNormal = {
    x: -tangent.y,
    y: tangent.x,
  };
  const center =
    side === 'left'
      ? {
          x: startPoint.x + leftNormal.x * radius,
          y: startPoint.y + leftNormal.y * radius,
        }
      : {
          x: startPoint.x - leftNormal.x * radius,
          y: startPoint.y - leftNormal.y * radius,
        };
  const startAngleDeg = cadAngleDegFromCenter(center, startPoint);
  return cadBuildArcFromCenterSweep(
    center,
    radius,
    startAngleDeg,
    side === 'left' ? Math.abs(deltaDeg) : -Math.abs(deltaDeg),
  );
};

export const cadArcEndPoint = (arc: Pick<CadArcEntity, 'centerX' | 'centerY' | 'radius' | 'endAngleDeg'>): CadWorldPoint => ({
  x: arc.centerX + Math.cos((arc.endAngleDeg * Math.PI) / 180) * arc.radius,
  y: arc.centerY + Math.sin((arc.endAngleDeg * Math.PI) / 180) * arc.radius,
});

export const cadArcEndTangentAzimuthDeg = (
  arc: Pick<CadArcEntity, 'startAngleDeg' | 'endAngleDeg'>,
): number =>
  cadSignedSweepDeg(arc.startAngleDeg, arc.endAngleDeg) >= 0
    ? cadNormalizeAngleDeg(360 - arc.endAngleDeg)
    : cadNormalizeAngleDeg(180 - arc.endAngleDeg);

export const cadBuildContinuedArc = (
  sourceArc: Pick<CadArcEntity, 'centerX' | 'centerY' | 'radius' | 'startAngleDeg' | 'endAngleDeg'>,
  endPoint: CadWorldPoint,
  reverseDirection = false,
): CadArcDefinition | null =>
  cadBuildArcFromStartEndDirection(
    cadArcEndPoint(sourceArc),
    endPoint,
    cadArcEndTangentAzimuthDeg(sourceArc),
    reverseDirection,
  );

export const cadBuildTangentCurve = (
  piPoint: CadWorldPoint,
  backTangentPoint: CadWorldPoint,
  aheadTangentPoint: CadWorldPoint,
  radius: number,
): CadArcDefinition | null => {
  if (!Number.isFinite(radius) || radius <= 1e-12) return null;
  const backVector = {
    x: backTangentPoint.x - piPoint.x,
    y: backTangentPoint.y - piPoint.y,
  };
  const aheadVector = {
    x: aheadTangentPoint.x - piPoint.x,
    y: aheadTangentPoint.y - piPoint.y,
  };
  const backLength = Math.hypot(backVector.x, backVector.y);
  const aheadLength = Math.hypot(aheadVector.x, aheadVector.y);
  if (backLength <= 1e-12 || aheadLength <= 1e-12) return null;

  const incomingDirection = {
    x: -backVector.x / backLength,
    y: -backVector.y / backLength,
  };
  const outgoingDirection = {
    x: aheadVector.x / aheadLength,
    y: aheadVector.y / aheadLength,
  };
  const dot = Math.max(
    -1,
    Math.min(1, incomingDirection.x * outgoingDirection.x + incomingDirection.y * outgoingDirection.y),
  );
  const deltaDeg = (Math.acos(dot) * 180) / Math.PI;
  const metrics = cadCreateCurveMetrics(radius, deltaDeg);
  if (!metrics) return null;
  if (metrics.tangentLength > backLength + 1e-9 || metrics.tangentLength > aheadLength + 1e-9) return null;

  const startPoint = {
    x: piPoint.x + (backVector.x / backLength) * metrics.tangentLength,
    y: piPoint.y + (backVector.y / backLength) * metrics.tangentLength,
  };
  const endPoint = {
    x: piPoint.x + (aheadVector.x / aheadLength) * metrics.tangentLength,
    y: piPoint.y + (aheadVector.y / aheadLength) * metrics.tangentLength,
  };
  const turnCross = incomingDirection.x * outgoingDirection.y - incomingDirection.y * outgoingDirection.x;
  const leftNormal = { x: -incomingDirection.y, y: incomingDirection.x };
  const rightNormal = { x: incomingDirection.y, y: -incomingDirection.x };
  const normal = turnCross >= 0 ? leftNormal : rightNormal;
  const center = {
    x: startPoint.x + normal.x * radius,
    y: startPoint.y + normal.y * radius,
  };
  const startAngleDeg = cadAngleDegFromCenter(center, startPoint);
  const endAngleDeg = cadAngleDegFromCenter(center, endPoint);
  const ccwDelta = cadCounterClockwiseDeltaDeg(startAngleDeg, endAngleDeg);
  const signedSweep = Math.abs(ccwDelta - deltaDeg) <= 1e-6 ? ccwDelta : ccwDelta - 360;
  return cadBuildArcFromCenterSweep(center, radius, startAngleDeg, signedSweep);
};

const normalizeDmsToken = (value: string): string =>
  value
    .trim()
    .replace(/[°º]/g, '-')
    .replace(/'/g, '-')
    .replace(/"/g, '')
    .replace(/\s+/g, '');

export const cadParseDmsDegrees = (value: string): number | null => {
  const normalized = normalizeDmsToken(value);
  if (!normalized) return null;
  if (!normalized.includes('-')) {
    const parsed = Number.parseFloat(normalized);
    return Number.isFinite(parsed) ? parsed : null;
  }
  const sign = normalized.startsWith('-') ? -1 : 1;
  const body = normalized.replace(/^[+-]/, '');
  const parts = body.split('-').filter((part) => part.length > 0);
  if (parts.length === 0 || parts.length > 3) return null;
  const [degreesToken, minutesToken = '0', secondsToken = '0'] = parts;
  const degrees = Number.parseFloat(degreesToken);
  const minutes = Number.parseFloat(minutesToken);
  const seconds = Number.parseFloat(secondsToken);
  if (![degrees, minutes, seconds].every(Number.isFinite)) return null;
  if (minutes < 0 || minutes >= 60 || seconds < 0 || seconds >= 60) return null;
  return sign * (Math.abs(degrees) + minutes / 60 + seconds / 3600);
};

export const cadParseBearingDegrees = (value: string): number | null => {
  const trimmed = value.trim().toUpperCase();
  if (!trimmed) return null;
  const compact = trimmed.replace(/\s+/g, '');
  const quadrantMatch = compact.match(/^([NS])(.+)([EW])$/);
  if (!quadrantMatch) {
    const parsed = cadParseDmsDegrees(compact);
    if (parsed == null) return null;
    const normalized = ((parsed % 360) + 360) % 360;
    return normalized;
  }
  const angleDeg = cadParseDmsDegrees(quadrantMatch[2]);
  if (angleDeg == null) return null;
  const clamped = Math.max(0, Math.min(90, angleDeg));
  if (quadrantMatch[1] === 'N' && quadrantMatch[3] === 'E') return clamped;
  if (quadrantMatch[1] === 'S' && quadrantMatch[3] === 'E') return 180 - clamped;
  if (quadrantMatch[1] === 'S' && quadrantMatch[3] === 'W') return 180 + clamped;
  if (quadrantMatch[1] === 'N' && quadrantMatch[3] === 'W') return 360 - clamped;
  return null;
};
