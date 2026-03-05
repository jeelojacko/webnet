import proj4 from 'proj4';

import type { CoordSystemMode, CrsProjectionModel } from '../types';
import { getCrsDefinition } from './crsCatalog';

const WGS84_A = 6378137;
const WGS84_F = 1 / 298.257223563;
const WGS84_E2 = WGS84_F * (2 - WGS84_F);
const DEG_TO_RAD = Math.PI / 180;
const RAD_TO_DEG = 180 / Math.PI;

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

const projectGrid = (
  latDeg: number,
  lonDeg: number,
  crsId?: string,
): { east: number; north: number; crsId?: string } | null => {
  const def = getCrsDefinition(crsId);
  if (!def) return null;
  try {
    const [east, north] = proj4('WGS84', def.proj4, [lonDeg, latDeg]);
    if (!Number.isFinite(east) || !Number.isFinite(north)) return null;
    return { east, north, crsId: def.id };
  } catch {
    return null;
  }
};

const inverseGrid = (
  east: number,
  north: number,
  crsId?: string,
): { latDeg: number; lonDeg: number; crsId?: string } | null => {
  const def = getCrsDefinition(crsId);
  if (!def) return null;
  try {
    const [lonDeg, latDeg] = proj4(def.proj4, 'WGS84', [east, north]);
    if (!Number.isFinite(latDeg) || !Number.isFinite(lonDeg)) return null;
    return { latDeg, lonDeg, crsId: def.id };
  } catch {
    return null;
  }
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
  coordSystemMode?: CoordSystemMode;
  crsId?: string;
}): { east: number; north: number; model: CrsProjectionModel; crsId?: string } => {
  const { latDeg, lonDeg, originLatDeg, originLonDeg, model, coordSystemMode, crsId } = params;
  if (coordSystemMode === 'grid') {
    const projected = projectGrid(latDeg, lonDeg, crsId);
    if (projected) {
      return {
        east: projected.east,
        north: projected.north,
        model,
        crsId: projected.crsId,
      };
    }
  }
  if (model === 'local-enu') {
    const { east, north } = projectLocalEnu(latDeg, lonDeg, originLatDeg, originLonDeg);
    return { east, north, model };
  }
  const { east, north } = projectLocalEquirectangular(latDeg, lonDeg, originLatDeg, originLonDeg);
  return { east, north, model: 'legacy-equirectangular' };
};

export const inverseENToGeodetic = (params: {
  east: number;
  north: number;
  originLatDeg: number;
  originLonDeg: number;
  model: CrsProjectionModel;
  coordSystemMode?: CoordSystemMode;
  crsId?: string;
}): { latDeg: number; lonDeg: number } | null => {
  const { east, north, originLatDeg, originLonDeg, model, coordSystemMode, crsId } = params;
  if (coordSystemMode === 'grid') {
    const inv = inverseGrid(east, north, crsId);
    if (inv) return { latDeg: inv.latDeg, lonDeg: inv.lonDeg };
    return null;
  }

  if (model === 'local-enu') {
    // Local ENU inverse is not currently needed for parser workflows.
    // Keep behavior aligned with legacy fallback when unknown.
    return null;
  }

  const lat0 = originLatDeg * DEG_TO_RAD;
  const lon0 = originLonDeg * DEG_TO_RAD;
  const lat = lat0 + north / WGS84_A;
  const cosLat0 = Math.cos(lat0);
  if (!Number.isFinite(cosLat0) || Math.abs(cosLat0) < 1e-12) return null;
  const lon = lon0 + east / (WGS84_A * cosLat0);
  return { latDeg: lat * RAD_TO_DEG, lonDeg: lon * RAD_TO_DEG };
};

export interface GridFactors {
  convergenceAngleRad: number;
  gridScaleFactor: number;
}

export const computeGridFactors = (
  latDeg: number,
  lonDeg: number,
  crsId?: string,
): GridFactors | null => {
  const base = projectGrid(latDeg, lonDeg, crsId);
  if (!base) return null;

  const dLat = 1e-5;
  const northProbe = projectGrid(latDeg + dLat, lonDeg, crsId);
  if (!northProbe) return null;
  const dE_n = northProbe.east - base.east;
  const dN_n = northProbe.north - base.north;
  const convergenceAngleRad = Math.atan2(dE_n, dN_n);

  const eastProbeMeters = 50;
  const cosLat = Math.cos(latDeg * DEG_TO_RAD);
  if (!Number.isFinite(cosLat) || Math.abs(cosLat) < 1e-12) {
    return { convergenceAngleRad, gridScaleFactor: 1 };
  }
  const dLonRad = eastProbeMeters / (WGS84_A * cosLat);
  const dLonDeg = dLonRad * RAD_TO_DEG;
  const eastProbe = projectGrid(latDeg, lonDeg + dLonDeg, crsId);
  if (!eastProbe) return { convergenceAngleRad, gridScaleFactor: 1 };
  const gridDist = Math.hypot(eastProbe.east - base.east, eastProbe.north - base.north);
  const gridScaleFactor =
    Number.isFinite(gridDist) && gridDist > 0 ? Math.max(gridDist / eastProbeMeters, 1e-9) : 1;
  return { convergenceAngleRad, gridScaleFactor };
};

export const computeElevationFactor = (
  ellipsoidHeightM: number,
  earthRadiusM = WGS84_A,
): number => {
  if (!Number.isFinite(ellipsoidHeightM)) return 1;
  if (!Number.isFinite(earthRadiusM) || earthRadiusM <= 0) return 1;
  return earthRadiusM / (earthRadiusM + ellipsoidHeightM);
};
