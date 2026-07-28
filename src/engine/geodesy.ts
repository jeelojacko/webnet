import type { CoordSystemDiagnosticCode } from '../types';
import { getCrsDefinition, type CrsDefinition } from './crsCatalog';
import { DEG_TO_RAD, GRS80_E2, GRS80_EP2, RAD_TO_DEG, WGS84_A } from './geodesyConstants';
import { resolveDatumOperation } from './geodesyDatum';
import { inverseGrid, projectGrid, projectGridWithProj4 } from './geodesyProjection';

export {
  ecefDeltaToLocalEnu,
  transformEcefDeltaCovarianceToLocalEnu,
  transformFactoredEcefDeltaCovarianceToLocalEnu,
} from './geodesyEcef';
export {
  inverseENToGeodetic,
  parseCrsProjectionModelToken,
  projectGeodeticToEN,
} from './geodesyProjection';

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
const CLASSIC_TRAVERSE_CSRS_DISPLAY_NB_PROJ4 =
  '+proj=sterea +lat_0=46.5 +lon_0=-66.5 +k=0.999912 +x_0=2500000 +y_0=7500000 +ellps=GRS80 +units=m +no_defs +type=crs';
const CLASSIC_TRAVERSE_GEODETIC_DISPLAY_CRS_ID = 'CA_NAD83_CSRS_NB_STEREO_DOUBLE';

export const computeClassicTraverseCsrsDisplayGridFactors = (
  latDeg: number,
  lonDeg: number,
): { convergenceAngleRad: number; gridScaleFactor: number } | null =>
  numericLocalGridFactorsFromProjector(latDeg, lonDeg, (probeLatDeg, probeLonDeg) =>
    projectGridWithProj4(probeLatDeg, probeLonDeg, CLASSIC_TRAVERSE_CSRS_DISPLAY_NB_PROJ4),
  );

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
