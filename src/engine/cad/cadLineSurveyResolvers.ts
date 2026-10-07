/**
 * CAD Draw Phase L1 — survey-side resolvers: station-point lookup, point-range
 * chains, alignment station/offset, and fixed-origin side shots.
 */
import {
  cadAzimuthDeg,
  cadDistance,
  cadNormalizeAngleDeg,
  cadParseBearingDegrees,
  cadPointFromAzimuthDistance,
  type CadWorldPoint,
} from './cadGeometry';
import { cadPointAtAlignmentStationOffset } from './cadAlignment';
import { parseCadLinePointRange } from './cadLineParsers';
import {
  CAD_LINE_DEGENERATE_FLOOR,
  cadLineFail,
  cadLineOk,
  type CadLinePointInput,
  type CadLineResult,
  type CadLineSideShot,
} from './cadLineTypes';
import type { CadAlignmentElement, CadAlignmentEntity, CadProject, CadSurveyPointEntity } from './cadTypes';

/**
 * Exact station-id lookup over drawing survey points. WebNet has no
 * case-insensitive/fuzzy station resolver (verified), so this stays
 * exact-only: a duplicate exact id fails closed as ambiguous.
 */
export const resolveCadLinePointByStationId = (
  project: Pick<CadProject, 'entities'>,
  stationId: string,
): CadLineResult<CadLinePointInput> => {
  const matches = project.entities.filter(
    (entity): entity is CadSurveyPointEntity =>
      entity.type === 'survey-point' && entity.stationId === stationId,
  );
  if (matches.length === 0) {
    return cadLineFail('POINT_NOT_FOUND', `No drawing point with station id "${stationId}".`);
  }
  if (matches.length > 1) {
    return cadLineFail('AMBIGUOUS_POINT', `Station id "${stationId}" is not unique in the drawing.`);
  }
  const point = matches[0];
  return cadLineOk({ x: point.x, y: point.y, label: point.stationId });
};

/**
 * Parse a point range and resolve every station id atomically. Any missing or
 * ambiguous id fails the whole request; no partial chain is returned.
 */
export const resolveCadLinePointChain = (
  project: Pick<CadProject, 'entities'>,
  text: string,
): CadLineResult<CadLinePointInput[]> => {
  const range = parseCadLinePointRange(text);
  if (!range.ok) return range;
  const points: CadLinePointInput[] = [];
  for (const stationId of range.value) {
    const resolved = resolveCadLinePointByStationId(project, stationId);
    if (!resolved.ok) return resolved;
    points.push(resolved.value);
  }
  if (points.length < 2) {
    return cadLineFail('POINT_RANGE_TOO_SHORT', 'A line point chain needs at least two points.');
  }
  return cadLineOk(points);
};

/** Alignment station/offset oracle; `station` is a display station. */
export const resolveCadLineStationOffsetPoint = (
  alignment: Pick<CadAlignmentEntity, 'elements' | 'startStation' | 'stationEquations'> | readonly CadAlignmentElement[],
  input: { station: number; offset: number },
): CadLineResult<CadWorldPoint> => {
  if (!Number.isFinite(input.station) || !Number.isFinite(input.offset)) {
    return cadLineFail('NON_FINITE', 'Station/offset must be finite.');
  }
  const resolved = cadPointAtAlignmentStationOffset(alignment, input.station, input.offset);
  if (!resolved) {
    return cadLineFail('OUT_OF_RANGE', `Station ${input.station} is outside the alignment range.`);
  }
  return cadLineOk(resolved.point);
};

/**
 * Fixed-origin ray law: every shot starts at the same `occupy` point and is
 * independent — shots are NEVER chained end-to-end.
 *
 * Direction conventions:
 *  - bearing  : `cadParseBearingDegrees` quadrant/DMS.
 *  - azimuth  : 0° North clockwise, normalized.
 *  - turn     : measured from the occupy→referencePoint backsight ray;
 *               right = clockwise (+).
 *  - deflection: measured from the forward course referencePoint→occupy;
 *               right = clockwise (+).
 */
export const resolveCadLineSideShots = (
  origin: { occupy: CadWorldPoint; referencePoint?: CadWorldPoint },
  shots: readonly CadLineSideShot[],
): CadLineResult<CadWorldPoint[]> => {
  if (!Number.isFinite(origin.occupy.x) || !Number.isFinite(origin.occupy.y)) {
    return cadLineFail('NON_FINITE', 'Side-shot occupy point must be finite.');
  }
  const points: CadWorldPoint[] = [];
  for (const shot of shots) {
    if (!Number.isFinite(shot.distance) || shot.distance <= 0) {
      return cadLineFail('DISTANCE_OUT_OF_RANGE', `Side-shot distance ${shot.distance} is not positive.`);
    }
    let azimuthDeg: number | null = null;
    if (shot.mode === 'bearing') {
      azimuthDeg = shot.bearing != null ? cadParseBearingDegrees(shot.bearing) : null;
    } else if (shot.mode === 'azimuth') {
      azimuthDeg = shot.azimuthDeg != null && Number.isFinite(shot.azimuthDeg)
        ? cadNormalizeAngleDeg(shot.azimuthDeg)
        : null;
    } else {
      const reference = origin.referencePoint;
      if (!reference || !Number.isFinite(reference.x) || !Number.isFinite(reference.y)) {
        return cadLineFail('INVALID_INPUT', `Side-shot ${shot.mode} requires a reference direction.`);
      }
      if (shot.angleDeg == null || !Number.isFinite(shot.angleDeg)) {
        return cadLineFail('ANGLE_OUT_OF_RANGE', `Side-shot ${shot.mode} angle must be finite.`);
      }
      if (cadDistance(origin.occupy, reference) <= CAD_LINE_DEGENERATE_FLOOR) {
        return cadLineFail('DEGENERATE', 'Side-shot reference direction has zero length.');
      }
      const baseAzimuth =
        shot.mode === 'turn'
          ? cadAzimuthDeg(origin.occupy, reference)
          : cadAzimuthDeg(reference, origin.occupy);
      azimuthDeg = baseAzimuth + (shot.side === 'left' ? -shot.angleDeg : shot.angleDeg);
    }
    if (azimuthDeg == null || !Number.isFinite(azimuthDeg)) {
      return cadLineFail('INVALID_INPUT', `Side-shot ${shot.mode} direction is invalid.`);
    }
    points.push(cadPointFromAzimuthDistance(origin.occupy, azimuthDeg, shot.distance));
  }
  return cadLineOk(points);
};
