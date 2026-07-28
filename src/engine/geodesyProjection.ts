import proj4 from 'proj4';

import type { CoordSystemDiagnosticCode, CoordSystemMode, CrsProjectionModel } from '../types';
import { getCrsDefinition } from './crsCatalog';
import { DEG_TO_RAD, RAD_TO_DEG, WGS84_A } from './geodesyConstants';
import { resolveDatumOperation } from './geodesyDatum';
import { geodeticToEcef } from './geodesyEcef';
import type { TransformResult } from './geodesy';

export const projectGrid = (
  latDeg: number,
  lonDeg: number,
  crsId?: string,
): TransformResult | null => {
  const def = getCrsDefinition(crsId);
  if (!def) return null;
  const datum = resolveDatumOperation(def);
  try {
    const [east, north] = proj4('WGS84', def.proj4, [lonDeg, latDeg]);
    if (!Number.isFinite(east) || !Number.isFinite(north)) return null;
    return {
      east,
      north,
      crsId: def.id,
      datumOpId: datum.datumOpId,
      warnings: [...datum.warnings],
      diagnostics: [...datum.diagnostics],
    };
  } catch {
    return null;
  }
};

export const projectGridWithProj4 = (
  latDeg: number,
  lonDeg: number,
  proj4Def: string,
): { east: number; north: number } | null => {
  try {
    const [east, north] = proj4('WGS84', proj4Def, [lonDeg, latDeg]);
    if (!Number.isFinite(east) || !Number.isFinite(north)) return null;
    return { east, north };
  } catch {
    return null;
  }
};

export const inverseGrid = (
  east: number,
  north: number,
  crsId?: string,
):
  | {
      latDeg: number;
      lonDeg: number;
      crsId?: string;
      datumOpId: string;
      warnings: string[];
      diagnostics: CoordSystemDiagnosticCode[];
    }
  | {
      failureReason: 'noCRSSelected' | 'noInverseAvailable' | 'inverseFailed' | 'crsInitFailed';
    } => {
  if (!crsId || !crsId.trim()) return { failureReason: 'noCRSSelected' };
  const def = getCrsDefinition(crsId);
  if (!def) return { failureReason: 'noInverseAvailable' };
  const datum = resolveDatumOperation(def);
  try {
    const [lonDeg, latDeg] = proj4(def.proj4, 'WGS84', [east, north]);
    if (!Number.isFinite(latDeg) || !Number.isFinite(lonDeg)) {
      return { failureReason: 'inverseFailed' };
    }
    return {
      latDeg,
      lonDeg,
      crsId: def.id,
      datumOpId: datum.datumOpId,
      warnings: [...datum.warnings],
      diagnostics: [...datum.diagnostics],
    };
  } catch (error) {
    const message = error instanceof Error ? error.message.toLowerCase() : '';
    if (message.includes('unknown projection') || message.includes('parse')) {
      return { failureReason: 'crsInitFailed' };
    }
    return { failureReason: 'inverseFailed' };
  }
};

export const parseCrsProjectionModelToken = (token?: string): CrsProjectionModel | null => {
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
}): {
  east: number;
  north: number;
  model: CrsProjectionModel;
  crsId?: string;
  datumOpId?: string;
  warnings?: string[];
  diagnostics?: CoordSystemDiagnosticCode[];
} => {
  const { latDeg, lonDeg, originLatDeg, originLonDeg, model, coordSystemMode, crsId } = params;
  if (coordSystemMode === 'grid') {
    const projected = projectGrid(latDeg, lonDeg, crsId);
    if (projected) {
      return {
        east: projected.east,
        north: projected.north,
        model,
        crsId: projected.crsId,
        datumOpId: projected.datumOpId,
        warnings: projected.warnings,
        diagnostics: projected.diagnostics,
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
  originLatDeg?: number;
  originLonDeg?: number;
  model: CrsProjectionModel;
  coordSystemMode?: CoordSystemMode;
  crsId?: string;
}):
  | {
      latDeg: number;
      lonDeg: number;
      datumOpId?: string;
      warnings?: string[];
      diagnostics?: CoordSystemDiagnosticCode[];
    }
  | {
      failureReason:
        | 'noCRSSelected'
        | 'projDbMissing'
        | 'noInverseAvailable'
        | 'inverseFailed'
        | 'unsupportedCrsFamily'
        | 'disabledByProfile'
        | 'crsInitFailed'
        | 'missingGridFiles';
    } => {
  const { east, north, originLatDeg, originLonDeg, model, coordSystemMode, crsId } = params;
  if (coordSystemMode === 'grid') {
    const inv = inverseGrid(east, north, crsId);
    if ('failureReason' in inv) {
      return {
        failureReason:
          inv.failureReason === 'noInverseAvailable' ? 'noInverseAvailable' : inv.failureReason,
      };
    }
    return {
      latDeg: inv.latDeg,
      lonDeg: inv.lonDeg,
      datumOpId: inv.datumOpId,
      warnings: inv.warnings,
      diagnostics: inv.diagnostics,
    };
  }

  if (model === 'local-enu') {
    // Local ENU inverse is not currently needed for parser workflows.
    // Keep behavior aligned with legacy fallback when unknown.
    return { failureReason: 'noInverseAvailable' };
  }
  if (
    !Number.isFinite(originLatDeg ?? Number.NaN) ||
    !Number.isFinite(originLonDeg ?? Number.NaN)
  ) {
    return { failureReason: 'inverseFailed' };
  }

  const lat0 = (originLatDeg as number) * DEG_TO_RAD;
  const lon0 = (originLonDeg as number) * DEG_TO_RAD;
  const lat = lat0 + north / WGS84_A;
  const cosLat0 = Math.cos(lat0);
  if (!Number.isFinite(cosLat0) || Math.abs(cosLat0) < 1e-12) {
    return { failureReason: 'inverseFailed' };
  }
  const lon = lon0 + east / (WGS84_A * cosLat0);
  return { latDeg: lat * RAD_TO_DEG, lonDeg: lon * RAD_TO_DEG };
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
