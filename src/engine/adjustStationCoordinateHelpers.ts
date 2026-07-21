import { EARTH_RADIUS_M } from './adjustConstants';
import { getCrsDefinition, isGeodeticInsideAreaOfUse } from './crsCatalog';
import { computeElevationFactor, computeGridFactors, inverseENToGeodetic } from './geodesy';
import { interpolateGeoidUndulation, type GeoidGridModel } from './geoid';
import type {
  CoordSystemDiagnosticCode,
  CrsOffReason,
  FactorComputationMethod,
  ParseOptions,
  Station,
  StationId,
  StationMap,
} from '../types';

export type StationFactorSnapshot = {
  convergenceAngleRad: number;
  gridScaleFactor: number;
  elevationFactor: number;
  combinedFactor: number;
  source: 'projection-formula' | 'numerical-fallback';
  factorComputationMethod: FactorComputationMethod;
};

export const stationGeodeticFromCoordinateValues = ({
  coordSystemMode,
  crsId,
  parseState,
  station,
  x,
  y,
}: {
  coordSystemMode: ParseOptions['coordSystemMode'];
  crsId: string;
  parseState?: ParseOptions;
  station: Station | undefined;
  x: number;
  y: number;
}): { latDeg: number; lonDeg: number } | null => {
  if (!station) return null;
  const hasExplicitGeodeticInput = station.coordInputClass === 'geodetic';
  if (
    hasExplicitGeodeticInput &&
    Number.isFinite(station.latDeg ?? Number.NaN) &&
    Number.isFinite(station.lonDeg ?? Number.NaN)
  ) {
    return { latDeg: station.latDeg as number, lonDeg: station.lonDeg as number };
  }
  if (coordSystemMode !== 'grid') return null;
  const inv = inverseENToGeodetic({
    east: x,
    north: y,
    originLatDeg: parseState?.originLatDeg,
    originLonDeg: parseState?.originLonDeg,
    model: parseState?.crsProjectionModel ?? 'legacy-equirectangular',
    coordSystemMode,
    crsId,
  });
  return 'failureReason' in inv ? null : { latDeg: inv.latDeg, lonDeg: inv.lonDeg };
};

export const stationEllipsoidHeightFromCoordinateValues = ({
  activeGeoidModel,
  averageGeoidHeight,
  geoidInterpolation,
  h,
  latDeg,
  lonDeg,
  station,
}: {
  activeGeoidModel: GeoidGridModel | null;
  averageGeoidHeight: number;
  geoidInterpolation: ParseOptions['geoidInterpolation'];
  h: number;
  latDeg?: number;
  lonDeg?: number;
  station: Station;
}): number => {
  if (station.heightType === 'ellipsoid') return h;
  if (activeGeoidModel && Number.isFinite(latDeg) && Number.isFinite(lonDeg)) {
    const undulation = interpolateGeoidUndulation(
      activeGeoidModel,
      latDeg as number,
      lonDeg as number,
      geoidInterpolation ?? 'bilinear',
    );
    if (Number.isFinite(undulation ?? Number.NaN)) {
      return h + (undulation as number);
    }
  }
  if (Number.isFinite(averageGeoidHeight) && Math.abs(averageGeoidHeight) > 0) {
    return h + averageGeoidHeight;
  }
  return h;
};

const reportInverseFailure = ({
  crsId,
  reason,
  setCrsOff,
  stationId,
}: {
  crsId: string;
  reason: string;
  setCrsOff: (_reason: CrsOffReason, _warning?: string) => void;
  stationId: StationId;
}): void => {
  if (reason === 'noCRSSelected') {
    setCrsOff('noCRSSelected', 'Grid coordinate mode is active but CRS id is missing.');
  } else if (reason === 'noInverseAvailable') {
    setCrsOff(
      'noInverseAvailable',
      `CRS inverse unavailable for ${crsId || 'unspecified CRS'} while resolving station geodetics.`,
    );
  } else if (reason === 'crsInitFailed') {
    setCrsOff(
      'crsInitFailed',
      `CRS initialization failed for ${crsId || 'unspecified CRS'} while resolving station geodetics.`,
    );
  } else if (reason === 'inverseFailed') {
    setCrsOff(
      'inverseFailed',
      `CRS inverse failed for station ${stationId} in ${crsId || 'unspecified CRS'}.`,
    );
  } else if (reason === 'projDbMissing') {
    setCrsOff('projDbMissing', 'Projection database is unavailable for CRS inverse operations.');
  } else if (reason === 'missingGridFiles') {
    setCrsOff(
      'missingGridFiles',
      'Required grid-shift files are missing for CRS datum/vertical operations.',
    );
  } else if (reason === 'unsupportedCrsFamily') {
    setCrsOff('unsupportedCrsFamily', `Unsupported CRS family for ${crsId || 'unspecified CRS'}.`);
  } else {
    setCrsOff('disabledByProfile');
  }
};

export const resolveStationGeodetic = ({
  addCoordSystemDiagnostic,
  coordSystemMode,
  crsId,
  markDatumFallbackUsed,
  parseState,
  setCrsDatumOpId,
  setCrsOff,
  setCrsOn,
  stationId,
  stations,
}: {
  addCoordSystemDiagnostic: (_code: CoordSystemDiagnosticCode, _warning?: string) => void;
  coordSystemMode: ParseOptions['coordSystemMode'];
  crsId: string;
  markDatumFallbackUsed: () => void;
  parseState?: ParseOptions;
  setCrsDatumOpId: (_datumOpId: string) => void;
  setCrsOff: (_reason: CrsOffReason, _warning?: string) => void;
  setCrsOn: () => void;
  stationId: StationId;
  stations: StationMap;
}): { latDeg: number; lonDeg: number } | null => {
  const station = stations[stationId];
  if (!station) return null;
  const hasExplicitGeodeticInput = station.coordInputClass === 'geodetic';
  if (
    hasExplicitGeodeticInput &&
    Number.isFinite(station.latDeg ?? Number.NaN) &&
    Number.isFinite(station.lonDeg ?? Number.NaN)
  ) {
    if (coordSystemMode === 'grid') setCrsOn();
    return { latDeg: station.latDeg as number, lonDeg: station.lonDeg as number };
  }
  if (coordSystemMode !== 'grid') return null;
  const inv = inverseENToGeodetic({
    east: station.x,
    north: station.y,
    originLatDeg: parseState?.originLatDeg,
    originLonDeg: parseState?.originLonDeg,
    model: parseState?.crsProjectionModel ?? 'legacy-equirectangular',
    coordSystemMode,
    crsId,
  });
  if ('failureReason' in inv) {
    reportInverseFailure({ crsId, reason: inv.failureReason, setCrsOff, stationId });
    return null;
  }
  setCrsOn();
  if (inv.datumOpId) setCrsDatumOpId(inv.datumOpId);
  (inv.diagnostics ?? []).forEach((code) => {
    addCoordSystemDiagnostic(code);
    if (code === 'CRS_DATUM_FALLBACK') markDatumFallbackUsed();
  });
  (inv.warnings ?? []).forEach((warning) =>
    addCoordSystemDiagnostic('CRS_DATUM_FALLBACK', warning),
  );
  station.latDeg = inv.latDeg;
  station.lonDeg = inv.lonDeg;
  return inv;
};

export const buildStationFactorSnapshot = ({
  addCoordSystemDiagnostic,
  averageGeoidHeight,
  coordSystemMode,
  crsConvergenceAngleRad,
  crsConvergenceEnabled,
  crsGridScaleEnabled,
  crsGridScaleFactor,
  crsId,
  markDatumFallbackUsed,
  setCrsDatumOpId,
  stationEllipsoidHeight,
  stationFactorCache,
  stationGeodetic,
  stationId,
  stations,
}: {
  addCoordSystemDiagnostic: (_code: CoordSystemDiagnosticCode, _warning?: string) => void;
  averageGeoidHeight: number;
  coordSystemMode: ParseOptions['coordSystemMode'];
  crsConvergenceAngleRad: number;
  crsConvergenceEnabled: boolean;
  crsGridScaleEnabled: boolean;
  crsGridScaleFactor: number;
  crsId: string;
  markDatumFallbackUsed: () => void;
  setCrsDatumOpId: (_datumOpId: string) => void;
  stationEllipsoidHeight: (_station: Station) => number;
  stationFactorCache: Map<string, StationFactorSnapshot>;
  stationGeodetic: (_stationId: StationId) => { latDeg: number; lonDeg: number } | null;
  stationId: StationId;
  stations: StationMap;
}): StationFactorSnapshot => {
  const station = stations[stationId];
  if (!station) {
    return {
      convergenceAngleRad: 0,
      gridScaleFactor: 1,
      elevationFactor: 1,
      combinedFactor: 1,
      source: 'projection-formula',
      factorComputationMethod: 'fallback',
    };
  }
  const cacheKey = [
    stationId,
    coordSystemMode ?? 'local',
    crsId,
    Number.isFinite(station.x) ? station.x.toFixed(6) : 'nan',
    Number.isFinite(station.y) ? station.y.toFixed(6) : 'nan',
    Number.isFinite(station.h) ? station.h.toFixed(6) : 'nan',
    Number.isFinite(station.latDeg ?? Number.NaN) ? (station.latDeg as number).toFixed(9) : '-',
    Number.isFinite(station.lonDeg ?? Number.NaN) ? (station.lonDeg as number).toFixed(9) : '-',
    crsGridScaleEnabled ? crsGridScaleFactor.toFixed(10) : 'off',
    crsConvergenceEnabled ? crsConvergenceAngleRad.toFixed(12) : 'off',
    averageGeoidHeight.toFixed(6),
  ].join('|');
  const cached = stationFactorCache.get(cacheKey);
  if (cached) return cached;
  let convergenceAngleRad = 0;
  let gridScaleFactor = 1;
  let source: 'projection-formula' | 'numerical-fallback' = 'projection-formula';
  let factorComputationMethod: FactorComputationMethod = 'fallback';
  if (coordSystemMode === 'grid') {
    const geo = stationGeodetic(stationId);
    if (geo) {
      const factors = computeGridFactors(geo.latDeg, geo.lonDeg, crsId);
      if (factors) {
        convergenceAngleRad = factors.convergenceAngleRad;
        gridScaleFactor = factors.gridScaleFactor;
        source = factors.source;
        factorComputationMethod =
          factors.source === 'numerical-fallback' ? 'fallback' : 'inverseToGeodetic';
        if (factors.datumOpId) setCrsDatumOpId(factors.datumOpId);
        (factors.diagnostics ?? []).forEach((code) => {
          addCoordSystemDiagnostic(code);
          if (code === 'CRS_DATUM_FALLBACK') markDatumFallbackUsed();
        });
        (factors.warnings ?? []).forEach((warning) =>
          addCoordSystemDiagnostic(
            factors.source === 'numerical-fallback'
              ? 'FACTOR_APPROXIMATION_USED'
              : 'CRS_DATUM_FALLBACK',
            warning,
          ),
        );
      }
    }
  }
  if (crsGridScaleEnabled) gridScaleFactor *= crsGridScaleFactor;
  if (
    crsConvergenceEnabled &&
    Number.isFinite(crsConvergenceAngleRad) &&
    Math.abs(crsConvergenceAngleRad) > 0
  ) {
    convergenceAngleRad += crsConvergenceAngleRad;
  }
  const elevationFactor = computeElevationFactor(stationEllipsoidHeight(station), EARTH_RADIUS_M);
  const combinedFactor = gridScaleFactor * elevationFactor;
  station.convergenceAngleRad = convergenceAngleRad;
  station.gridScaleFactor = gridScaleFactor;
  station.elevationFactor = elevationFactor;
  station.combinedFactor = combinedFactor;
  station.factorComputationSource = source;
  station.factorComputationMethod = factorComputationMethod;
  const snapshot = {
    convergenceAngleRad,
    gridScaleFactor,
    elevationFactor,
    combinedFactor,
    source,
    factorComputationMethod,
  };
  stationFactorCache.set(cacheKey, snapshot);
  return snapshot;
};

export const evaluateCrsAreaOfUseCoverage = ({
  addCoordSystemDiagnostic,
  coordSystemMode,
  crsId,
  stationGeodetic,
  stations,
}: {
  addCoordSystemDiagnostic: (_code: CoordSystemDiagnosticCode, _warning?: string) => void;
  coordSystemMode: ParseOptions['coordSystemMode'];
  crsId: string;
  stationGeodetic: (_stationId: StationId) => { latDeg: number; lonDeg: number } | null;
  stations: StationMap;
}): { status: 'inside' | 'outside' | 'unknown'; outOfAreaStationCount: number } => {
  if (coordSystemMode !== 'grid') {
    return { status: 'unknown', outOfAreaStationCount: 0 };
  }
  const def = getCrsDefinition(crsId);
  if (!def?.areaOfUseBounds) {
    return { status: 'unknown', outOfAreaStationCount: 0 };
  }
  let evaluated = 0;
  const outside: StationId[] = [];
  Object.keys(stations).forEach((stationId) => {
    const geo = stationGeodetic(stationId);
    if (!geo) return;
    const inside = isGeodeticInsideAreaOfUse(def, geo.latDeg, geo.lonDeg);
    if (inside == null) return;
    evaluated += 1;
    if (!inside) outside.push(stationId);
  });
  if (evaluated === 0 || outside.length === 0) {
    return {
      status: evaluated === 0 ? 'unknown' : 'inside',
      outOfAreaStationCount: 0,
    };
  }
  const sample = outside.slice(0, 8).join(', ');
  const suffix = outside.length > 8 ? ` (+${outside.length - 8} more)` : '';
  addCoordSystemDiagnostic(
    'CRS_OUT_OF_AREA',
    `Selected CRS ${def.id} area-of-use (${def.areaOfUse}) may not cover all stations: ${sample}${suffix}.`,
  );
  return { status: 'outside', outOfAreaStationCount: outside.length };
};
