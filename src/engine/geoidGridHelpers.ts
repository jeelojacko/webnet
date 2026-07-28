import type { GeoidGridModel } from './geoidTypes';

export const parsePositiveInt = (token: string | undefined): number | null => {
  if (!token) return null;
  const parsed = Number.parseInt(token, 10);
  if (!Number.isFinite(parsed) || parsed <= 0) return null;
  return parsed;
};

export const parseFinite = (token: string | undefined): number | null => {
  if (!token) return null;
  const parsed = Number.parseFloat(token);
  if (!Number.isFinite(parsed)) return null;
  return parsed;
};

export const normalizeLongitude = (lonDeg: number): number => {
  let normalized = lonDeg;
  while (normalized > 180) normalized -= 360;
  while (normalized < -180) normalized += 360;
  return normalized;
};

export const isReasonableSpan = (min: number, max: number, step: number): boolean =>
  Number.isFinite(min) &&
  Number.isFinite(max) &&
  Number.isFinite(step) &&
  max > min &&
  step > 0 &&
  step <= Math.abs(max - min);

export const validateGridShape = (rows: number, cols: number): boolean =>
  Number.isFinite(rows) &&
  Number.isFinite(cols) &&
  rows >= 2 &&
  cols >= 2 &&
  rows <= 200000 &&
  cols <= 200000;

export const buildGridModelFromMatrix = (
  id: string,
  source: string,
  rows: number,
  cols: number,
  latMin: number,
  latMax: number,
  lonMin: number,
  lonMax: number,
  values: number[][],
  normalizeId: (_id: string) => string,
): GeoidGridModel | null => {
  if (!validateGridShape(rows, cols)) return null;
  if (!isReasonableSpan(latMin, latMax, (latMax - latMin) / (rows - 1))) return null;
  if (!isReasonableSpan(lonMin, lonMax, (lonMax - lonMin) / (cols - 1))) return null;
  if (values.length !== rows) return null;
  if (values.some((row) => row.length !== cols)) return null;
  const dLat = (latMax - latMin) / (rows - 1);
  const dLon = (lonMax - lonMin) / (cols - 1);
  return {
    id: normalizeId(id),
    name: normalizeId(id),
    source,
    rows,
    cols,
    latMin,
    latMax,
    lonMin,
    lonMax,
    dLat,
    dLon,
    values,
  };
};
