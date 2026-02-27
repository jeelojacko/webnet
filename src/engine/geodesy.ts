import type { CrsProjectionModel } from '../types';

const WGS84_A = 6378137;
const WGS84_F = 1 / 298.257223563;
const WGS84_E2 = WGS84_F * (2 - WGS84_F);
const DEG_TO_RAD = Math.PI / 180;

const geodeticToEcef = (
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

const projectLocalEquirectangular = (
  latDeg: number,
  lonDeg: number,
  originLatDeg: number,
  originLonDeg: number,
): { east: number; north: number } => {
  const lat = latDeg * DEG_TO_RAD;
  const lon = lonDeg * DEG_TO_RAD;
  const lat0 = originLatDeg * DEG_TO_RAD;
  const lon0 = originLonDeg * DEG_TO_RAD;
  const dLat = lat - lat0;
  const dLon = lon - lon0;
  const north = WGS84_A * dLat;
  const east = WGS84_A * Math.cos(lat0) * dLon;
  return { east, north };
};

const projectLocalEnu = (
  latDeg: number,
  lonDeg: number,
  originLatDeg: number,
  originLonDeg: number,
): { east: number; north: number } => {
  const p = geodeticToEcef(latDeg, lonDeg, 0);
  const o = geodeticToEcef(originLatDeg, originLonDeg, 0);
  const lat0 = originLatDeg * DEG_TO_RAD;
  const lon0 = originLonDeg * DEG_TO_RAD;
  const sinLat0 = Math.sin(lat0);
  const cosLat0 = Math.cos(lat0);
  const sinLon0 = Math.sin(lon0);
  const cosLon0 = Math.cos(lon0);
  const dx = p.x - o.x;
  const dy = p.y - o.y;
  const dz = p.z - o.z;

  const east = -sinLon0 * dx + cosLon0 * dy;
  const north = -sinLat0 * cosLon0 * dx - sinLat0 * sinLon0 * dy + cosLat0 * dz;
  return { east, north };
};

export const parseCrsProjectionModelToken = (
  token?: string,
): CrsProjectionModel | null => {
  if (!token) return null;
  const upper = token.trim().toUpperCase();
  if (!upper) return null;
  if (
    upper === 'LEGACY' ||
    upper === 'LOCAL' ||
    upper === 'EQUIRECT' ||
    upper === 'EQUIRECTANGULAR'
  ) {
    return 'legacy-equirectangular';
  }
  if (upper === 'ENU' || upper === 'TANGENT' || upper === 'LOCAL-ENU') {
    return 'local-enu';
  }
  return null;
};

export const projectGeodeticToEN = (params: {
  latDeg: number;
  lonDeg: number;
  originLatDeg: number;
  originLonDeg: number;
  model: CrsProjectionModel;
}): { east: number; north: number; model: CrsProjectionModel } => {
  const { latDeg, lonDeg, originLatDeg, originLonDeg, model } = params;
  if (model === 'local-enu') {
    const { east, north } = projectLocalEnu(latDeg, lonDeg, originLatDeg, originLonDeg);
    return { east, north, model };
  }
  const { east, north } = projectLocalEquirectangular(latDeg, lonDeg, originLatDeg, originLonDeg);
  return { east, north, model: 'legacy-equirectangular' };
};
