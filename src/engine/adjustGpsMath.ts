import { DEG_TO_RAD } from './angles';

export type GpsVectorComponents = {
  dE: number;
  dN: number;
  dU?: number;
};

const WGS84_A = 6378137;
const WGS84_F = 1 / 298.257223563;
const WGS84_E2 = WGS84_F * (2 - WGS84_F);

export const geodeticToEcef = (
  latDeg: number,
  lonDeg: number,
  heightM = 0,
): { x: number; y: number; z: number } => {
  const lat = latDeg * DEG_TO_RAD;
  const lon = lonDeg * DEG_TO_RAD;
  const sinLat = Math.sin(lat);
  const cosLat = Math.cos(lat);
  const sinLon = Math.sin(lon);
  const cosLon = Math.cos(lon);
  const n = WGS84_A / Math.sqrt(1 - WGS84_E2 * sinLat * sinLat);
  return {
    x: (n + heightM) * cosLat * cosLon,
    y: (n + heightM) * cosLat * sinLon,
    z: (n * (1 - WGS84_E2) + heightM) * sinLat,
  };
};

export const ecefDeltaToLocalEnu = (
  dX: number,
  dY: number,
  dZ: number,
  latDeg: number,
  lonDeg: number,
): Required<Pick<GpsVectorComponents, 'dE' | 'dN' | 'dU'>> => {
  const lat = latDeg * DEG_TO_RAD;
  const lon = lonDeg * DEG_TO_RAD;
  const sinLat = Math.sin(lat);
  const cosLat = Math.cos(lat);
  const sinLon = Math.sin(lon);
  const cosLon = Math.cos(lon);
  return {
    dE: -sinLon * dX + cosLon * dY,
    dN: -sinLat * cosLon * dX - sinLat * sinLon * dY + cosLat * dZ,
    dU: cosLat * cosLon * dX + cosLat * sinLon * dY + sinLat * dZ,
  };
};

export const multiplyMatrix3 = (a: number[][], b: number[][]): number[][] =>
  a.map((row) =>
    b[0].map(
      (_value, col) => row[0] * b[0][col] + row[1] * b[1][col] + row[2] * b[2][col],
    ),
  );

export const transposeMatrix3 = (matrix: number[][]): number[][] => [
  [matrix[0][0], matrix[1][0], matrix[2][0]],
  [matrix[0][1], matrix[1][1], matrix[2][1]],
  [matrix[0][2], matrix[1][2], matrix[2][2]],
];

export const transformSymmetricCovariance3 = (
  transform: number[][],
  covariance: number[][],
): number[][] => multiplyMatrix3(multiplyMatrix3(transform, covariance), transposeMatrix3(transform));

export const invertMatrix3 = (matrix: number[][]): number[][] | null => {
  const det =
    matrix[0][0] * (matrix[1][1] * matrix[2][2] - matrix[1][2] * matrix[2][1]) -
    matrix[0][1] * (matrix[1][0] * matrix[2][2] - matrix[1][2] * matrix[2][0]) +
    matrix[0][2] * (matrix[1][0] * matrix[2][1] - matrix[1][1] * matrix[2][0]);
  if (!Number.isFinite(det) || Math.abs(det) <= 1e-24) return null;
  return [
    [
      (matrix[1][1] * matrix[2][2] - matrix[1][2] * matrix[2][1]) / det,
      (matrix[0][2] * matrix[2][1] - matrix[0][1] * matrix[2][2]) / det,
      (matrix[0][1] * matrix[1][2] - matrix[0][2] * matrix[1][1]) / det,
    ],
    [
      (matrix[1][2] * matrix[2][0] - matrix[1][0] * matrix[2][2]) / det,
      (matrix[0][0] * matrix[2][2] - matrix[0][2] * matrix[2][0]) / det,
      (matrix[0][2] * matrix[1][0] - matrix[0][0] * matrix[1][2]) / det,
    ],
    [
      (matrix[1][0] * matrix[2][1] - matrix[1][1] * matrix[2][0]) / det,
      (matrix[0][1] * matrix[2][0] - matrix[0][0] * matrix[2][1]) / det,
      (matrix[0][0] * matrix[1][1] - matrix[0][1] * matrix[1][0]) / det,
    ],
  ];
};
