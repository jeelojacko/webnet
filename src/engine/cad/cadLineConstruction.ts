/**
 * CAD Draw Phase L1 — pure directional/tangency endpoint resolvers.
 *
 * Conventions (documented once, reused everywhere):
 *  - Azimuth: 0° = North, clockwise positive; `cadAzimuthDeg` is the authority.
 *  - Turned angle: measured from the occupy→backsight ray; right = clockwise
 *    (+), left = counter-clockwise (−). Reuses `cadComputeTurnedAnglePoint`.
 *  - Deflection: measured at the line end from the forward course; right =
 *    clockwise (+). Reuses `cadComputeDeflectionAnglePoint`.
 *  - A point "left" of a directed ray has a positive cross product.
 */
import {
  cadAzimuthDeg,
  cadDistance,
  cadNormalizeAngleDeg,
  cadParseBearingDegrees,
  cadPointFromAzimuthDistance,
  cadProjectPointOntoInfiniteLine,
  type CadWorldPoint,
} from './cadGeometry';
import { cadComputeDeflectionAnglePoint, cadComputeTurnedAnglePoint } from './cadCogoMath';
import {
  CAD_LINE_DEGENERATE_FLOOR,
  cadLineFail,
  cadLineOk,
  type CadLineResult,
  type CadLineSide,
} from './cadLineTypes';

interface DirectionalInput {
  from: CadWorldPoint;
  distance: number;
  angleDeg?: number;
}

const validPoint = (point: CadWorldPoint): boolean =>
  Number.isFinite(point.x) && Number.isFinite(point.y);

const validDistance = (distance: number): boolean => Number.isFinite(distance) && distance > 0;

/** Bearing endpoint (quadrant or decimal/DMS via cadParseBearingDegrees). */
export const resolveCadLineBearingEndpoint = ({
  from,
  bearing,
  distance,
}: {
  from: CadWorldPoint;
  bearing: string;
  distance: number;
}): CadLineResult<CadWorldPoint> => {
  if (!validPoint(from)) return cadLineFail('NON_FINITE', 'Bearing origin is not finite.');
  if (!validDistance(distance)) return cadLineFail('DISTANCE_OUT_OF_RANGE', `Distance ${distance} is not positive.`);
  const azimuthDeg = cadParseBearingDegrees(bearing);
  if (azimuthDeg == null) return cadLineFail('INVALID_INPUT', `Unrecognized bearing "${bearing}".`);
  return cadLineOk(cadPointFromAzimuthDistance(from, azimuthDeg, distance));
};

/** Azimuth endpoint; input degrees are normalized into [0, 360). */
export const resolveCadLineAzimuthEndpoint = ({
  from,
  azimuthDeg,
  distance,
}: DirectionalInput & { azimuthDeg: number }): CadLineResult<CadWorldPoint> => {
  if (!validPoint(from)) return cadLineFail('NON_FINITE', 'Azimuth origin is not finite.');
  if (azimuthDeg == null || !Number.isFinite(azimuthDeg)) {
    return cadLineFail('ANGLE_OUT_OF_RANGE', 'Azimuth must be a finite angle.');
  }
  if (!validDistance(distance)) return cadLineFail('DISTANCE_OUT_OF_RANGE', `Distance ${distance} is not positive.`);
  return cadLineOk(cadPointFromAzimuthDistance(from, cadNormalizeAngleDeg(azimuthDeg), distance));
};

/**
 * Turned-angle endpoint from a backsight ray. `side` right turns clockwise.
 * Returns the forward azimuth as well so callers can chain directions.
 */
export const resolveCadLineTurnedAngleEndpoint = ({
  occupy,
  backsight,
  side,
  angleDeg,
  distance,
}: {
  occupy: CadWorldPoint;
  backsight: CadWorldPoint;
  side: CadLineSide;
  angleDeg: number;
  distance: number;
}): CadLineResult<{ point: CadWorldPoint; azimuthDeg: number }> => {
  if (!validPoint(occupy) || !validPoint(backsight)) {
    return cadLineFail('NON_FINITE', 'Turned-angle origin/backsight is not finite.');
  }
  if (!Number.isFinite(angleDeg)) return cadLineFail('ANGLE_OUT_OF_RANGE', 'Turned angle must be finite.');
  if (!validDistance(distance)) return cadLineFail('DISTANCE_OUT_OF_RANGE', `Distance ${distance} is not positive.`);
  if (cadDistance(occupy, backsight) <= CAD_LINE_DEGENERATE_FLOOR) {
    return cadLineFail('DEGENERATE', 'Occupy and backsight are the same point.');
  }
  const point = cadComputeTurnedAnglePoint({ occupyPoint: occupy, backsightPoint: backsight, angleDeg, distance, side });
  return cadLineOk({ point, azimuthDeg: cadAzimuthDeg(occupy, point) });
};

/**
 * Deflection endpoint at `lineEnd` from the forward course. Deflection angles
 * are conventionally strictly between 0° and 180°.
 */
export const resolveCadLineDeflectionEndpoint = ({
  lineStart,
  lineEnd,
  side,
  angleDeg,
  distance,
}: {
  lineStart: CadWorldPoint;
  lineEnd: CadWorldPoint;
  side: CadLineSide;
  angleDeg: number;
  distance: number;
}): CadLineResult<{ point: CadWorldPoint; azimuthDeg: number }> => {
  if (!validPoint(lineStart) || !validPoint(lineEnd)) {
    return cadLineFail('NON_FINITE', 'Deflection line endpoints are not finite.');
  }
  if (!Number.isFinite(angleDeg) || angleDeg <= 0 || angleDeg >= 180) {
    return cadLineFail('ANGLE_OUT_OF_RANGE', `Deflection angle ${angleDeg} must be within (0, 180).`);
  }
  if (!validDistance(distance)) return cadLineFail('DISTANCE_OUT_OF_RANGE', `Distance ${distance} is not positive.`);
  if (cadDistance(lineStart, lineEnd) <= CAD_LINE_DEGENERATE_FLOOR) {
    return cadLineFail('DEGENERATE', 'Deflection line start and end are the same point.');
  }
  const point = cadComputeDeflectionAnglePoint({ lineStart, lineEnd, angleDeg, distance, side });
  return cadLineOk({ point, azimuthDeg: cadAzimuthDeg(lineEnd, point) });
};

/**
 * Deterministically pick the reference-segment endpoint nearest to a pick
 * point. A near-midpoint tie is NOT resolved by array order: it fails closed
 * so the operator repicks.
 */
export const pickCadLineReferenceStartEndpoint = ({
  start,
  end,
  pickPoint,
}: {
  start: CadWorldPoint;
  end: CadWorldPoint;
  pickPoint: CadWorldPoint;
}): CadLineResult<{ point: CadWorldPoint; endpoint: 'start' | 'end' }> => {
  const toStart = cadDistance(pickPoint, start);
  const toEnd = cadDistance(pickPoint, end);
  if (Math.abs(toStart - toEnd) <= CAD_LINE_DEGENERATE_FLOOR) {
    return cadLineFail('AMBIGUOUS_ENDPOINT', 'Pick is equidistant from both reference endpoints; repick nearer an end.');
  }
  return toStart < toEnd
    ? cadLineOk({ point: { ...start }, endpoint: 'start' })
    : cadLineOk({ point: { ...end }, endpoint: 'end' });
};

/** Perpendicular foot from a point onto the infinite supporting line. */
export const resolveCadLinePerpendicularFoot = ({
  lineStart,
  lineEnd,
  from,
}: {
  lineStart: CadWorldPoint;
  lineEnd: CadWorldPoint;
  from: CadWorldPoint;
}): CadLineResult<CadWorldPoint> => {
  if (!validPoint(lineStart) || !validPoint(lineEnd) || !validPoint(from)) {
    return cadLineFail('NON_FINITE', 'Perpendicular inputs must be finite.');
  }
  if (cadDistance(lineStart, lineEnd) <= CAD_LINE_DEGENERATE_FLOOR) {
    return cadLineFail('DEGENERATE', 'Perpendicular line has zero length.');
  }
  return cadLineOk(cadProjectPointOntoInfiniteLine(from, lineStart, lineEnd).point);
};
