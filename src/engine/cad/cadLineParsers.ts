/**
 * CAD Draw Phase L1 — pure operator-text parsers for line construction.
 *
 * No project/state access here: every function maps a token string to a
 * structured value or an explicit `CadLineResult` error. Project-dependent
 * resolution (station lookup, CRS transforms) lives in the resolver modules.
 */
import { cadNormalizeAngleDeg, cadParseBearingDegrees, cadParseDmsDegrees } from './cadGeometry';
import {
  CAD_LINE_DEGENERATE_FLOOR,
  cadLineFail,
  cadLineOk,
  type CadLineResult,
  type CadLineSide,
  type CadLineSideShot,
} from './cadLineTypes';

/** Parse a bare distance token: finite and strictly positive. */
export const parseCadLineDistance = (text: string): CadLineResult<number> => {
  const value = Number(text.trim());
  if (!Number.isFinite(value) || value <= 0) {
    return cadLineFail('DISTANCE_OUT_OF_RANGE', `Expected a positive distance, received "${text}".`);
  }
  return cadLineOk(value);
};

/**
 * Parse a signed distance token for the corrected tangent/perpendicular ray
 * law: an explicit `+`/`-` sign (or none) and a finite magnitude strictly
 * above the canonical CAD floor. The sign selects forward/reverse along the
 * source frame (never array order).
 */
export const parseCadLineSignedDistance = (text: string): CadLineResult<number> => {
  const trimmed = text.trim();
  if (!/^[+-]?(?:\d+\.?\d*|\.\d+)(?:[eE][+-]?\d+)?$/.test(trimmed)) {
    return cadLineFail('INVALID_INPUT', `Expected a signed distance, received "${text}".`);
  }
  const value = Number(trimmed);
  if (!Number.isFinite(value)) {
    return cadLineFail('NON_FINITE', `Non-finite distance "${text}".`);
  }
  if (Math.abs(value) <= CAD_LINE_DEGENERATE_FLOOR) {
    return cadLineFail(
      'DISTANCE_OUT_OF_RANGE',
      'Distance must be non-zero and above the CAD floor.',
    );
  }
  return cadLineOk(value);
};

/** Decimal or DMS degrees (DMS uses `-` separators, e.g. `45-30-00`). */
export const parseCadLineAngleValueDeg = (text: string): number | null => {
  const trimmed = text.trim();
  if (!trimmed) return null;
  const parsed = cadParseDmsDegrees(trimmed);
  return parsed != null && Number.isFinite(parsed) ? parsed : null;
};

const expandCadLineRange = (first: number, second: number): number[] => {
  const step = second >= first ? 1 : -1;
  const values: number[] = [];
  for (let value = first; ; value += step) {
    values.push(value);
    if (value === second) break;
  }
  return values;
};

/**
 * Hard cap on how many points one comma-separated request may expand to.
 * The explicit bound keeps adversarial or mistyped ranges (e.g. `1-99999999`)
 * from allocating before station lookup, and is deliberately generous for
 * real survey chains while nowhere near a hang.
 */
export const CAD_LINE_POINT_RANGE_MAX_POINTS = 4096;

/**
 * Parse a station point range into an ordered, de-duplicated-by-adjacency id
 * chain. Grammar: comma-separated single ids and inclusive ranges, ascending
 * or descending, whitespace tolerant.
 *
 *   `1-3,7,10-8` => `1,2,3,7,10,9,8`
 *
 * "exact integer stationIds only": every comma-separated token must be either
 * an explicit non-negative integer or an inclusive integer range. Any other
 * token — including an empty one (`1,,2`, a leading/trailing comma) and any
 * non-integer text (`1-3,foo,7`, `1A`, `1-3.5`, `1-`, `--`) — rejects the WHOLE
 * request. Adjacent duplicates in the resulting chain also reject the whole
 * request; fewer than two effective points rejects.
 *
 * Safety: endpoints must be safe integers and the whole request may expand to
 * at most {@link CAD_LINE_POINT_RANGE_MAX_POINTS} points. Both are checked
 * BEFORE any range is expanded, so unsafe or oversized input fails closed with
 * no allocation (and no unbounded increment loop).
 */
export const parseCadLinePointRange = (text: string): CadLineResult<string[]> => {
  const ids: number[] = [];
  for (const rawToken of text.split(',')) {
    const token = rawToken.trim();
    if (!token) {
      return cadLineFail(
        'POINT_RANGE_INVALID_TOKEN',
        `Empty point token in "${text.trim()}"; every token must be an integer or integer range.`,
      );
    }
    const range = /^(\d+)\s*-\s*(\d+)$/.exec(token);
    if (range) {
      const first = Number(range[1]);
      const second = Number(range[2]);
      if (!Number.isSafeInteger(first) || !Number.isSafeInteger(second)) {
        return cadLineFail(
          'POINT_RANGE_UNSAFE_INTEGER',
          `Point range "${token}" uses an integer beyond the exactly-representable range.`,
        );
      }
      const span = Math.abs(second - first) + 1;
      if (ids.length + span > CAD_LINE_POINT_RANGE_MAX_POINTS) {
        return cadLineFail(
          'POINT_RANGE_TOO_LARGE',
          `Point range "${text.trim()}" expands to more than ${CAD_LINE_POINT_RANGE_MAX_POINTS} points.`,
        );
      }
      ids.push(...expandCadLineRange(first, second));
      continue;
    }
    if (/^\d+$/.test(token)) {
      const value = Number(token);
      if (!Number.isSafeInteger(value)) {
        return cadLineFail(
          'POINT_RANGE_UNSAFE_INTEGER',
          `Point id "${token}" is beyond the exactly-representable range.`,
        );
      }
      if (ids.length + 1 > CAD_LINE_POINT_RANGE_MAX_POINTS) {
        return cadLineFail(
          'POINT_RANGE_TOO_LARGE',
          `Point list "${text.trim()}" expands to more than ${CAD_LINE_POINT_RANGE_MAX_POINTS} points.`,
        );
      }
      ids.push(value);
      continue;
    }
    return cadLineFail(
      'POINT_RANGE_INVALID_TOKEN',
      `Point token "${token}" is neither an integer nor an integer range.`,
    );
  }
  if (ids.length < 2) {
    return cadLineFail(
      'POINT_RANGE_TOO_SHORT',
      'A line point range needs at least two effective points.',
    );
  }
  for (let index = 1; index < ids.length; index += 1) {
    if (ids[index] === ids[index - 1]) {
      return cadLineFail(
        'POINT_RANGE_DUPLICATE',
        `Adjacent duplicate point "${ids[index]}" in range "${text.trim()}".`,
      );
    }
  }
  return cadLineOk(ids.map((value) => String(value)));
};

const parsePair = (text: string): string[] | null => {
  const parts = text.split(',').map((part) => part.trim());
  return parts.length === 2 && parts.every((part) => part.length > 0) ? parts : null;
};

/**
 * Parse an operator `Northing,Easting` pair. Drawing XY is x = easting,
 * y = northing, so the two components are deliberately asymmetric (a swap
 * regression is caught by tests).
 */
export const parseCadLineNorthEast = (text: string): CadLineResult<{ east: number; north: number }> => {
  const parts = parsePair(text);
  if (!parts) return cadLineFail('INVALID_INPUT', `Expected "Northing,Easting", received "${text}".`);
  const north = Number(parts[0]);
  const east = Number(parts[1]);
  if (!Number.isFinite(north) || !Number.isFinite(east)) {
    return cadLineFail('NON_FINITE', `Non-finite Northing/Easting in "${text}".`);
  }
  return cadLineOk({ east, north });
};

/** GRID_NE uses the same operator order as `Northing,Easting`. */
export const parseCadLineGridNe = parseCadLineNorthEast;

/** Latitude/longitude in decimal degrees (`latitude,longitude`). Range checked. */
export const parseCadLineLatLong = (
  text: string,
): CadLineResult<{ latitudeDeg: number; longitudeDeg: number }> => {
  const parts = parsePair(text);
  if (!parts) return cadLineFail('INVALID_INPUT', `Expected "latitude,longitude", received "${text}".`);
  const latitudeDeg = Number(parts[0]);
  const longitudeDeg = Number(parts[1]);
  if (!Number.isFinite(latitudeDeg) || !Number.isFinite(longitudeDeg)) {
    return cadLineFail('NON_FINITE', `Non-finite latitude/longitude in "${text}".`);
  }
  if (latitudeDeg < -90 || latitudeDeg > 90) {
    return cadLineFail('LATLONG_OUT_OF_RANGE', `Latitude ${latitudeDeg} is outside [-90, 90].`);
  }
  if (longitudeDeg < -180 || longitudeDeg > 180) {
    return cadLineFail('LATLONG_OUT_OF_RANGE', `Longitude ${longitudeDeg} is outside [-180, 180].`);
  }
  return cadLineOk({ latitudeDeg, longitudeDeg });
};

/** Parse `<bearing>,<distance>` (bearing via cadParseBearingDegrees). */
export const parseCadLineBearingDistance = (
  text: string,
): CadLineResult<{ bearing: string; distance: number }> => {
  const parts = parsePair(text);
  if (!parts) return cadLineFail('INVALID_INPUT', `Expected "bearing,distance", received "${text}".`);
  if (cadParseBearingDegrees(parts[0]) == null) {
    return cadLineFail('INVALID_INPUT', `Unrecognized bearing "${parts[0]}".`);
  }
  const distance = parseCadLineDistance(parts[1]);
  if (!distance.ok) return distance;
  return cadLineOk({ bearing: parts[0], distance: distance.value });
};

/** Parse `<azimuth>,<distance>` (0° = North, clockwise; decimal or DMS). */
export const parseCadLineAzimuthDistance = (
  text: string,
): CadLineResult<{ azimuthDeg: number; distance: number }> => {
  const parts = parsePair(text);
  if (!parts) return cadLineFail('INVALID_INPUT', `Expected "azimuth,distance", received "${text}".`);
  const azimuthDeg = parseCadLineAngleValueDeg(parts[0]);
  if (azimuthDeg == null) {
    return cadLineFail('INVALID_INPUT', `Unrecognized azimuth "${parts[0]}".`);
  }
  const distance = parseCadLineDistance(parts[1]);
  if (!distance.ok) return distance;
  return cadLineOk({ azimuthDeg: cadNormalizeAngleDeg(azimuthDeg), distance: distance.value });
};

/**
 * Parse `<L|R><angle>,<distance>` — WebNet turned-angle grammar (mirrors
 * `parseLeftRightAngleDistance` in the session hook so there is one grammar).
 */
export const parseCadLineLeftRightAngleDistance = (
  text: string,
): CadLineResult<{ side: CadLineSide; angleDeg: number; distance: number }> => {
  const match = /^([LR])\s*([^,]+)\s*,\s*([^,]+)\s*$/i.exec(text.trim());
  if (!match) return cadLineFail('INVALID_INPUT', `Expected "L|R angle,distance", received "${text}".`);
  const angleDeg = parseCadLineAngleValueDeg(match[2]);
  if (angleDeg == null) return cadLineFail('INVALID_INPUT', `Unrecognized angle "${match[2]}".`);
  const distance = parseCadLineDistance(match[3]);
  if (!distance.ok) return distance;
  return cadLineOk({
    side: match[1].toUpperCase() === 'L' ? 'left' : 'right',
    angleDeg,
    distance: distance.value,
  });
};

/**
 * Parse either a signed extension delta (`+5`, `-3.5`) or an explicit new
 * total length (`T10`, `TOTAL=10`). The sign convention is applied by the
 * extension resolver, not here.
 */
export const parseCadLineExtensionTarget = (
  text: string,
): CadLineResult<{ kind: 'delta'; delta: number } | { kind: 'total'; total: number }> => {
  const trimmed = text.trim();
  const total = /^(?:T|TOTAL)\s*=?\s*([-+]?\d*\.?\d+)$/i.exec(trimmed);
  if (total) {
    const value = Number(total[1]);
    if (!Number.isFinite(value) || value <= 0) {
      return cadLineFail('DISTANCE_OUT_OF_RANGE', `Total length must be positive, received "${trimmed}".`);
    }
    return cadLineOk({ kind: 'total', total: value });
  }
  const delta = /^([-+]?\d*\.?\d+)$/.exec(trimmed);
  if (!delta) return cadLineFail('INVALID_INPUT', `Expected a signed delta or T<length>, received "${trimmed}".`);
  const value = Number(delta[1]);
  if (!Number.isFinite(value)) return cadLineFail('NON_FINITE', `Non-finite delta "${trimmed}".`);
  return cadLineOk({ kind: 'delta', delta: value });
};

/**
 * Parse one side-shot token with an explicit, unambiguous mode prefix:
 *   `B<bearing>,<distance>`   bearing
 *   `AZ<angle>,<distance>`    grid azimuth (0° N, clockwise)
 *   `TL<angle>,<distance>`    turned angle left  (from the backsight ray)
 *   `TR<angle>,<distance>`    turned angle right
 *   `DL<angle>,<distance>`    deflection left     (from the forward course)
 *   `DR<angle>,<distance>`    deflection right
 * Prefixes are required so a bare `L30,100` can never be silently mis-read.
 */
export const parseCadLineSideShot = (text: string): CadLineResult<CadLineSideShot> => {
  const trimmed = text.trim();
  const bearing = /^B\s*([^,]+)\s*,\s*([^,]+)\s*$/i.exec(trimmed);
  if (bearing) {
    if (cadParseBearingDegrees(bearing[1]) == null) {
      return cadLineFail('INVALID_INPUT', `Unrecognized bearing "${bearing[1]}".`);
    }
    const distance = parseCadLineDistance(bearing[2]);
    if (!distance.ok) return distance;
    return cadLineOk({ mode: 'bearing', bearing: bearing[1], distance: distance.value });
  }
  const azimuth = /^AZ\s*([^,]+)\s*,\s*([^,]+)\s*$/i.exec(trimmed);
  if (azimuth) {
    const azimuthDeg = parseCadLineAngleValueDeg(azimuth[1]);
    if (azimuthDeg == null) return cadLineFail('INVALID_INPUT', `Unrecognized azimuth "${azimuth[1]}".`);
    const distance = parseCadLineDistance(azimuth[2]);
    if (!distance.ok) return distance;
    return cadLineOk({
      mode: 'azimuth',
      azimuthDeg: cadNormalizeAngleDeg(azimuthDeg),
      distance: distance.value,
    });
  }
  const relative = /^([TD])([LR])\s*([^,]+)\s*,\s*([^,]+)\s*$/i.exec(trimmed);
  if (relative) {
    const angleDeg = parseCadLineAngleValueDeg(relative[3]);
    if (angleDeg == null) return cadLineFail('INVALID_INPUT', `Unrecognized angle "${relative[3]}".`);
    const distance = parseCadLineDistance(relative[4]);
    if (!distance.ok) return distance;
    return cadLineOk({
      mode: relative[1].toUpperCase() === 'T' ? 'turn' : 'deflection',
      side: relative[2].toUpperCase() === 'L' ? 'left' : 'right',
      angleDeg,
      distance: distance.value,
    });
  }
  return cadLineFail('INVALID_INPUT', `Unrecognized side shot "${trimmed}".`);
};
