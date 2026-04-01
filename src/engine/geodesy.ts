import proj4 from 'proj4';

import type { CoordSystemDiagnosticCode, CoordSystemMode, CrsProjectionModel } from '../types';
import { getCrsDefinition, type CrsDefinition } from './crsCatalog';

const WGS84_A = 6378137;
const WGS84_F = 1 / 298.257223563;
const WGS84_E2 = WGS84_F * (2 - WGS84_F);
const GRS80_F = 1 / 298.257222101;
const GRS80_E2 = GRS80_F * (2 - GRS80_F);
const GRS80_EP2 = GRS80_E2 / (1 - GRS80_E2);
const DEG_TO_RAD = Math.PI / 180;
const RAD_TO_DEG = 180 / Math.PI;

export type FactorComputationSource = 'projection-formula' | 'numerical-fallback';

export interface TransformResult {
  east: number;
  north: number;
  hEllipsoid?: number;
  crsId?: string;
  datumOpId: string;
  warnings: string[];
  diagnostics: CoordSystemDiagnosticCode[];
}

export interface FactorSnapshot {
  convergenceRad: number;
  gridScale: number;
  elevationFactor: number;
  combinedFactor: number;
  source: FactorComputationSource;
  datumOpId?: string;
  warnings: string[];
  diagnostics: CoordSystemDiagnosticCode[];
}

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

const projectGrid = (latDeg: number, lonDeg: number, crsId?: string): TransformResult | null => {
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

const projectGridWithProj4 = (
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

const inverseGrid = (
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

export interface GridFactors {
  convergenceAngleRad: number;
  gridScaleFactor: number;
  source: FactorComputationSource;
  datumOpId?: string;
  warnings: string[];
  diagnostics: CoordSystemDiagnosticCode[];
}

const wrapLonRad = (lonRad: number): number => {
  let wrapped = lonRad;
  while (wrapped > Math.PI) wrapped -= 2 * Math.PI;
  while (wrapped < -Math.PI) wrapped += 2 * Math.PI;
  return wrapped;
};

const defaultLon0ForDef = (def: CrsDefinition): number | undefined => {
  if (Number.isFinite(def.projectionParams?.lon0Deg ?? Number.NaN)) {
    return def.projectionParams?.lon0Deg;
  }
  if (def.projectionFamily === 'utm' && Number.isFinite(def.zoneNumber ?? Number.NaN)) {
    return (def.zoneNumber as number) * 6 - 183;
  }
  return undefined;
};

const defaultScaleForDef = (def: CrsDefinition): number => {
  if (Number.isFinite(def.projectionParams?.k0 ?? Number.NaN)) {
    return Math.max(1e-12, def.projectionParams?.k0 as number);
  }
  if (def.projectionFamily === 'utm') return 0.9996;
  if (def.projectionFamily === 'mtm') return 0.9999;
  return 1;
};

const tmFactors = (
  latDeg: number,
  lonDeg: number,
  def: CrsDefinition,
): { convergenceAngleRad: number; gridScaleFactor: number } | null => {
  const lon0Deg = defaultLon0ForDef(def);
  if (!Number.isFinite(lon0Deg ?? Number.NaN)) return null;
  const k0 = defaultScaleForDef(def);
  const lat = latDeg * DEG_TO_RAD;
  const lon = lonDeg * DEG_TO_RAD;
  const lon0 = (lon0Deg as number) * DEG_TO_RAD;
  const dLon = wrapLonRad(lon - lon0);
  const sinLat = Math.sin(lat);
  const cosLat = Math.cos(lat);
  const tanLat = Math.tan(lat);
  const t = tanLat * tanLat;
  const c = GRS80_EP2 * cosLat * cosLat;
  const a = dLon * cosLat;
  const a2 = a * a;
  const a4 = a2 * a2;
  const k =
    k0 * (1 + ((1 + c) * a2) / 2 + ((5 - 4 * t + 42 * c + 13 * c * c - 28 * GRS80_EP2) * a4) / 24);
  const convergenceAngleRad = Math.atan2(Math.tan(dLon) * sinLat, 1);
  if (!Number.isFinite(k) || k <= 0 || !Number.isFinite(convergenceAngleRad)) return null;
  return { convergenceAngleRad, gridScaleFactor: k };
};

const obliqueStereographicFactors = (
  latDeg: number,
  lonDeg: number,
  def: CrsDefinition,
): { convergenceAngleRad: number; gridScaleFactor: number } | null => {
  const lat0Deg = def.projectionParams?.lat0Deg;
  const lon0Deg = defaultLon0ForDef(def);
  if (!Number.isFinite(lat0Deg ?? Number.NaN) || !Number.isFinite(lon0Deg ?? Number.NaN)) {
    return null;
  }
  const k0 = defaultScaleForDef(def);
  const lat = latDeg * DEG_TO_RAD;
  const lon = lonDeg * DEG_TO_RAD;
  const lat0 = (lat0Deg as number) * DEG_TO_RAD;
  const lon0 = (lon0Deg as number) * DEG_TO_RAD;
  const dLon = wrapLonRad(lon - lon0);
  const sinLat = Math.sin(lat);
  const cosLat = Math.cos(lat);
  const sinLat0 = Math.sin(lat0);
  const cosLat0 = Math.cos(lat0);
  const denom = 1 + sinLat0 * sinLat + cosLat0 * cosLat * Math.cos(dLon);
  if (!Number.isFinite(denom) || Math.abs(denom) < 1e-12) return null;
  const gridScaleFactor = (2 * k0) / denom;
  const convergenceAngleRad = Math.atan2(
    Math.sin(dLon) * cosLat0,
    sinLat * cosLat0 - cosLat * sinLat0 * Math.cos(dLon),
  );
  if (!Number.isFinite(gridScaleFactor) || gridScaleFactor <= 0) return null;
  if (!Number.isFinite(convergenceAngleRad)) return null;
  return { convergenceAngleRad, gridScaleFactor };
};

const numericGridFactors = (
  latDeg: number,
  lonDeg: number,
  crsId?: string,
): { convergenceAngleRad: number; gridScaleFactor: number } | null => {
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

const numericLocalGridFactorsFromProjector = (
  latDeg: number,
  lonDeg: number,
  projector: (_latDeg: number, _lonDeg: number) => { east: number; north: number } | null,
): { convergenceAngleRad: number; gridScaleFactor: number } | null => {
  const base = projector(latDeg, lonDeg);
  if (!base) return null;

  const latRad = latDeg * DEG_TO_RAD;
  const sinLat = Math.sin(latRad);
  const cosLat = Math.cos(latRad);
  if (!Number.isFinite(cosLat) || Math.abs(cosLat) < 1e-12) return null;

  const meridianRadius =
    WGS84_A * (1 - GRS80_E2) / Math.pow(1 - GRS80_E2 * sinLat * sinLat, 1.5);
  const primeVerticalRadius = WGS84_A / Math.sqrt(1 - GRS80_E2 * sinLat * sinLat);
  if (
    !Number.isFinite(meridianRadius) ||
    meridianRadius <= 0 ||
    !Number.isFinite(primeVerticalRadius) ||
    primeVerticalRadius <= 0
  ) {
    return null;
  }

  const probeMeters = 50;
  const dLatDeg = (probeMeters / meridianRadius) * RAD_TO_DEG;
  const dLonDeg = (probeMeters / (primeVerticalRadius * cosLat)) * RAD_TO_DEG;

  const northProbe = projector(latDeg + dLatDeg, lonDeg);
  const eastProbe = projector(latDeg, lonDeg + dLonDeg);
  if (!northProbe || !eastProbe) return null;

  const dE_n = northProbe.east - base.east;
  const dN_n = northProbe.north - base.north;
  const dE_e = eastProbe.east - base.east;
  const dN_e = eastProbe.north - base.north;

  const convergenceAngleRad = -Math.atan2(dE_n, dN_n);
  const northScale = Math.hypot(dE_n, dN_n) / probeMeters;
  const eastScale = Math.hypot(dE_e, dN_e) / probeMeters;
  const gridScaleFactor = (northScale + eastScale) / 2;

  if (!Number.isFinite(convergenceAngleRad) || !Number.isFinite(gridScaleFactor)) {
    return null;
  }

  return {
    convergenceAngleRad,
    gridScaleFactor: Math.max(gridScaleFactor, 1e-9),
  };
};

const numericLocalGridFactors = (
  latDeg: number,
  lonDeg: number,
  crsId?: string,
): { convergenceAngleRad: number; gridScaleFactor: number } | null =>
  numericLocalGridFactorsFromProjector(latDeg, lonDeg, (probeLatDeg, probeLonDeg) =>
    projectGrid(probeLatDeg, probeLonDeg, crsId),
  );

// Later classic traverse listing sections in the stored reference appear to use
// a slightly different legacy NB83 display contract than the solve/parity CRS.
// Keep that display-only contract isolated here so listing code can derive the
// tiny residual factor/convergence deltas instead of hard-coded constants.
const CLASSIC_TRAVERSE_LEGACY_DISPLAY_NB83_PROJ4 =
  '+proj=sterea +lat_0=46.5 +lon_0=-66.5000096185 +k=0.99982986015 +x_0=2500000 +y_0=7500000 +ellps=GRS80 +units=m +no_defs +type=crs';
const CLASSIC_TRAVERSE_GEODETIC_DISPLAY_CRS_ID = 'CA_NAD83_CSRS_NB_STEREO_DOUBLE';

export const computeClassicTraverseLegacyDisplayGridFactors = (
  latDeg: number,
  lonDeg: number,
): { convergenceAngleRad: number; gridScaleFactor: number } | null =>
  numericLocalGridFactorsFromProjector(latDeg, lonDeg, (probeLatDeg, probeLonDeg) =>
    projectGridWithProj4(
      probeLatDeg,
      probeLonDeg,
      CLASSIC_TRAVERSE_LEGACY_DISPLAY_NB83_PROJ4,
    ),
  );

// The stored traverse reference keeps the legacy NB83 adjusted coordinate
// layout, but the paired geodetic rows invert those displayed coordinates
// through the CSRS double-stereographic definition. Keep that display-only
// geodetic contract isolated from the solve CRS.
export const inverseClassicTraverseDisplayGeodetic = (
  east: number,
  north: number,
):
  | {
      latDeg: number;
      lonDeg: number;
      crsId: string;
      datumOpId: string;
      warnings: string[];
      diagnostics: CoordSystemDiagnosticCode[];
    }
  | null => {
  const inv = inverseGrid(east, north, CLASSIC_TRAVERSE_GEODETIC_DISPLAY_CRS_ID);
  if ('failureReason' in inv) return null;
  return {
    latDeg: inv.latDeg,
    lonDeg: inv.lonDeg,
    crsId: CLASSIC_TRAVERSE_GEODETIC_DISPLAY_CRS_ID,
    datumOpId: inv.datumOpId,
    warnings: inv.warnings,
    diagnostics: inv.diagnostics,
  };
};

const resolveDatumOperation = (
  def?: CrsDefinition,
): {
  datumOpId: string;
  warnings: string[];
  diagnostics: CoordSystemDiagnosticCode[];
  fallbackUsed: boolean;
} => {
  if (!def) {
    return {
      datumOpId: 'UNRESOLVED',
      warnings: ['CRS datum operation unresolved: unknown CRS definition.'],
      diagnostics: ['CRS_DATUM_FALLBACK'],
      fallbackUsed: true,
    };
  }
  const primary = def.supportedDatumOps?.primary?.trim();
  if (primary) {
    return {
      datumOpId: primary,
      warnings: [],
      diagnostics: [],
      fallbackUsed: false,
    };
  }
  const fallback = def.supportedDatumOps?.fallbacks?.find((token) => token.trim().length > 0);
  if (fallback) {
    return {
      datumOpId: fallback,
      warnings: [`CRS datum operation fallback used for ${def.id}: ${fallback}`],
      diagnostics: ['CRS_DATUM_FALLBACK'],
      fallbackUsed: true,
    };
  }
  return {
    datumOpId: 'WGS84-ASSUMED',
    warnings: [`CRS datum operation fallback used for ${def.id}: WGS84-ASSUMED`],
    diagnostics: ['CRS_DATUM_FALLBACK'],
    fallbackUsed: true,
  };
};

export const computeGridFactors = (
  latDeg: number,
  lonDeg: number,
  crsId?: string,
): GridFactors | null => {
  const def = getCrsDefinition(crsId);
  const datum = resolveDatumOperation(def);
  if (!def) return null;

  if (def.factorStrategy === 'numeric-local') {
    const numeric = numericLocalGridFactors(latDeg, lonDeg, crsId);
    if (!numeric) return null;
    return {
      convergenceAngleRad: numeric.convergenceAngleRad,
      gridScaleFactor: numeric.gridScaleFactor,
      source: 'numerical-fallback',
      datumOpId: datum.datumOpId,
      warnings: [
        ...datum.warnings,
        `Projection factors for ${def.id} use the local numeric grid-factor path tuned to the legacy NewBrunswick83 contract.`,
      ],
      diagnostics: [...datum.diagnostics, 'FACTOR_APPROXIMATION_USED'],
    };
  }

  let formula: { convergenceAngleRad: number; gridScaleFactor: number } | null = null;
  if (
    def.projectionFamily === 'utm' ||
    def.projectionFamily === 'mtm' ||
    def.projectionFamily === 'transverse-mercator'
  ) {
    formula = tmFactors(latDeg, lonDeg, def);
  } else if (def.projectionFamily === 'oblique-stereographic') {
    formula = obliqueStereographicFactors(latDeg, lonDeg, def);
  }

  if (formula) {
    return {
      convergenceAngleRad: formula.convergenceAngleRad,
      gridScaleFactor: formula.gridScaleFactor,
      source: 'projection-formula',
      datumOpId: datum.datumOpId,
      warnings: [...datum.warnings],
      diagnostics: [...datum.diagnostics],
    };
  }

  const numeric = numericGridFactors(latDeg, lonDeg, crsId);
  if (!numeric) return null;
  return {
    convergenceAngleRad: numeric.convergenceAngleRad,
    gridScaleFactor: numeric.gridScaleFactor,
    source: 'numerical-fallback',
    datumOpId: datum.datumOpId,
    warnings: [
      ...datum.warnings,
      `Projection-factor formula unavailable for ${def.id}; PROJ numeric fallback used (method=finite-difference, op=${datum.datumOpId || 'UNSPECIFIED'}).`,
    ],
    diagnostics: [...datum.diagnostics, 'FACTOR_APPROXIMATION_USED', 'FACTOR_FALLBACK_PROJ_USED'],
  };
};

export const computeElevationFactor = (
  ellipsoidHeightM: number,
  earthRadiusM = WGS84_A,
): number => {
  if (!Number.isFinite(ellipsoidHeightM)) return 1;
  if (!Number.isFinite(earthRadiusM) || earthRadiusM <= 0) return 1;
  return earthRadiusM / (earthRadiusM + ellipsoidHeightM);
};
