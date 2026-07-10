import type { CadArcEntity } from './cadTypes';

export * from './cadGeometryCurves';
export * from './cadGeometryCurveIntersections';

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
