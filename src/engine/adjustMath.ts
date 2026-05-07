import type { StationId } from '../types';

export const makePairKey = (a: StationId, b: StationId): string => (a < b ? `${a}|${b}` : `${b}|${a}`);

export const makeDirectedPairKey = (from: StationId, to: StationId): string => `${from}|${to}`;

export const wrapToPi = (value: number): number => {
  let out = value;
  while (out <= -Math.PI) out += 2 * Math.PI;
  while (out > Math.PI) out -= 2 * Math.PI;
  return out;
};

export const wrapTo2Pi = (value: number): number => {
  let out = value % (2 * Math.PI);
  if (out < 0) out += 2 * Math.PI;
  return out;
};

export const circularMean = (values: number[]): number | null => {
  if (!values.length) return null;
  let sumSin = 0;
  let sumCos = 0;
  values.forEach((value) => {
    sumSin += Math.sin(value);
    sumCos += Math.cos(value);
  });
  if (Math.abs(sumSin) < 1e-12 && Math.abs(sumCos) < 1e-12) {
    return wrapTo2Pi(values[0] ?? 0);
  }
  return wrapTo2Pi(Math.atan2(sumSin, sumCos));
};

export const azimuthFromCoords = (
  fromX: number,
  fromY: number,
  toX: number,
  toY: number,
): number => wrapTo2Pi(Math.atan2(toX - fromX, toY - fromY));

export const intersectDistanceCircles = (
  ax: number,
  ay: number,
  radiusA: number,
  bx: number,
  by: number,
  radiusB: number,
): { x: number; y: number }[] => {
  const dx = bx - ax;
  const dy = by - ay;
  const distance = Math.hypot(dx, dy);
  if (!Number.isFinite(distance) || distance <= 1e-12) return [];
  if (distance > radiusA + radiusB + 1e-6) return [];
  if (distance < Math.abs(radiusA - radiusB) - 1e-6) return [];
  const a = (radiusA * radiusA - radiusB * radiusB + distance * distance) / (2 * distance);
  const hSq = radiusA * radiusA - a * a;
  if (hSq < -1e-6) return [];
  const h = Math.sqrt(Math.max(0, hSq));
  const midX = ax + (a * dx) / distance;
  const midY = ay + (a * dy) / distance;
  const offsetX = (-dy * h) / distance;
  const offsetY = (dx * h) / distance;
  if (h <= 1e-9) return [{ x: midX, y: midY }];
  return [
    { x: midX + offsetX, y: midY + offsetY },
    { x: midX - offsetX, y: midY - offsetY },
  ];
};
