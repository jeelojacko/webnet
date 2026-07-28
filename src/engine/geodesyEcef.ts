import { DEG_TO_RAD, WGS84_A, WGS84_E2 } from './geodesyConstants';

interface EcefCovariance {
  cXX: number;
  cYY: number;
  cZZ: number;
  cXY: number;
  cXZ: number;
  cYZ: number;
}

interface LocalEnuCovariance {
  cEE: number;
  cNN: number;
  cUU: number;
  cEN: number;
  cEU: number;
  cNU: number;
}

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
  const x = (n + heightM) * cosLat * cosLon;
  const y = (n + heightM) * cosLat * sinLon;
  const z = (n * (1 - WGS84_E2) + heightM) * sinLat;
  return { x, y, z };
};

export const ecefDeltaToLocalEnu = (
  dX: number,
  dY: number,
  dZ: number,
  latDeg: number,
  lonDeg: number,
): { east: number; north: number; up: number } => {
  const lat = latDeg * DEG_TO_RAD;
  const lon = lonDeg * DEG_TO_RAD;
  const sinLat = Math.sin(lat);
  const cosLat = Math.cos(lat);
  const sinLon = Math.sin(lon);
  const cosLon = Math.cos(lon);
  return {
    east: -sinLon * dX + cosLon * dY,
    north: -sinLat * cosLon * dX - sinLat * sinLon * dY + cosLat * dZ,
    up: cosLat * cosLon * dX + cosLat * sinLon * dY + sinLat * dZ,
  };
};

export const transformEcefDeltaCovarianceToLocalEnu = (
  covariance: EcefCovariance,
  latDeg: number,
  lonDeg: number,
): LocalEnuCovariance => {
  const lat = latDeg * DEG_TO_RAD;
  const lon = lonDeg * DEG_TO_RAD;
  const sinLat = Math.sin(lat);
  const cosLat = Math.cos(lat);
  const sinLon = Math.sin(lon);
  const cosLon = Math.cos(lon);
  const rotation = [
    [-sinLon, cosLon, 0],
    [-sinLat * cosLon, -sinLat * sinLon, cosLat],
    [cosLat * cosLon, cosLat * sinLon, sinLat],
  ];
  const q = [
    [covariance.cXX, covariance.cXY, covariance.cXZ],
    [covariance.cXY, covariance.cYY, covariance.cYZ],
    [covariance.cXZ, covariance.cYZ, covariance.cZZ],
  ];
  const transformed = multiplyMatrix3(
    multiplyMatrix3(rotation, q),
    transposeMatrix3(rotation),
  );
  return {
    cEE: transformed[0][0],
    cEN: transformed[0][1],
    cEU: transformed[0][2],
    cNN: transformed[1][1],
    cNU: transformed[1][2],
    cUU: transformed[2][2],
  };
};

export const transformFactoredEcefDeltaCovarianceToLocalEnu = (
  covariance: EcefCovariance,
  latDeg: number,
  lonDeg: number,
  horizontalFactor?: number,
  verticalFactor?: number,
): LocalEnuCovariance => {
  const h = normalizeGnssVectorFactor(horizontalFactor);
  const v = normalizeGnssVectorFactor(verticalFactor);
  const hh = h * h;
  const vv = v * v;
  const hv = h * v;
  const rawCovariance = {
    cXX: covariance.cXX / hh,
    cYY: covariance.cYY / hh,
    cZZ: covariance.cZZ / vv,
    cXY: covariance.cXY / hh,
    cXZ: covariance.cXZ / hv,
    cYZ: covariance.cYZ / hv,
  };
  return applyGnssVectorFactorsToLocalCovariance(
    transformEcefDeltaCovarianceToLocalEnu(rawCovariance, latDeg, lonDeg),
    h,
    v,
  );
};

const normalizeGnssVectorFactor = (factor?: number): number =>
  Number.isFinite(factor) && (factor as number) > 0 ? (factor as number) : 1;

const applyGnssVectorFactorsToLocalCovariance = (
  covariance: LocalEnuCovariance,
  horizontalFactor?: number,
  verticalFactor?: number,
): LocalEnuCovariance => {
  const h = normalizeGnssVectorFactor(horizontalFactor);
  const v = normalizeGnssVectorFactor(verticalFactor);
  const hh = h * h;
  const vv = v * v;
  const hv = h * v;
  return {
    cEE: covariance.cEE * hh,
    cNN: covariance.cNN * hh,
    cUU: covariance.cUU * vv,
    cEN: covariance.cEN * hh,
    cEU: covariance.cEU * hv,
    cNU: covariance.cNU * hv,
  };
};

const multiplyMatrix3 = (a: number[][], b: number[][]): number[][] =>
  a.map((row) =>
    b[0].map(
      (_value, col) => row[0] * b[0][col] + row[1] * b[1][col] + row[2] * b[2][col],
    ),
  );

const transposeMatrix3 = (matrix: number[][]): number[][] => [
  [matrix[0][0], matrix[1][0], matrix[2][0]],
  [matrix[0][1], matrix[1][1], matrix[2][1]],
  [matrix[0][2], matrix[1][2], matrix[2][2]],
];
