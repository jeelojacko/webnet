import { EARTH_RADIUS_M } from './adjustConstants';
import type {
  CoordSystemDiagnosticCode,
  Observation,
  ParseOptions,
  StationId,
  StationMap,
} from '../types';
import type { StationFactorSnapshot } from './adjustReductionTypes';

export const modeledAzimuth = ({
  applyConvergence,
  atStationId,
  crsConvergenceAngleRad,
  crsConvergenceEnabled,
  rawAz,
  stationFactorSnapshot,
}: {
  applyConvergence: boolean;
  atStationId?: StationId;
  crsConvergenceAngleRad: number;
  crsConvergenceEnabled: boolean;
  rawAz: number;
  stationFactorSnapshot: (_stationId: StationId) => StationFactorSnapshot;
}): number => {
  let az = rawAz;
  if (applyConvergence && atStationId) {
    az += stationFactorSnapshot(atStationId).convergenceAngleRad;
  } else if (
    applyConvergence &&
    crsConvergenceEnabled &&
    Number.isFinite(crsConvergenceAngleRad) &&
    Math.abs(crsConvergenceAngleRad) > 0
  ) {
    az += crsConvergenceAngleRad;
  }
  az %= 2 * Math.PI;
  if (az < 0) az += 2 * Math.PI;
  return az;
};

export const mapDistanceScaleForObservation = ({
  is2D,
  mapMode,
  mapScaleFactor,
  obs,
}: {
  is2D: boolean;
  mapMode: ParseOptions['mapMode'];
  mapScaleFactor: number;
  obs: Observation;
}): number => {
  if (obs.type !== 'dist') return 1;
  if (mapMode === 'off') return 1;
  if (is2D) return mapScaleFactor;
  return obs.mode === 'horiz' ? mapScaleFactor : 1;
};

export const crsDistanceScaleForObservation = ({
  addCoordSystemDiagnostic,
  averageScaleFactor,
  commonElevation,
  coordSystemMode,
  crsGridScaleEnabled,
  crsGridScaleFactor,
  localDatumScheme,
  obs,
  scaleOverrideActive,
  stationEllipsoidHeight,
  stationFactorSnapshot,
  stations,
}: {
  addCoordSystemDiagnostic: (_code: CoordSystemDiagnosticCode, _warning?: string) => void;
  averageScaleFactor: number;
  commonElevation: number;
  coordSystemMode: ParseOptions['coordSystemMode'];
  crsGridScaleEnabled: boolean;
  crsGridScaleFactor: number;
  localDatumScheme: ParseOptions['localDatumScheme'];
  obs: Observation;
  scaleOverrideActive: boolean;
  stationEllipsoidHeight: (_station: StationMap[string]) => number;
  stationFactorSnapshot: (_stationId: StationId) => StationFactorSnapshot;
  stations: StationMap;
}): number => {
  if (obs.type !== 'dist') return 1;
  if (coordSystemMode === 'local') {
    const legacyGridScale =
      crsGridScaleEnabled && Number.isFinite(crsGridScaleFactor) && crsGridScaleFactor > 0
        ? crsGridScaleFactor
        : 1;
    if (localDatumScheme === 'common-elevation') {
      const from = stations[obs.from];
      const to = stations[obs.to];
      if (!from || !to) return 1;
      const meanElevation = (stationEllipsoidHeight(from) + stationEllipsoidHeight(to)) / 2;
      const factor = (EARTH_RADIUS_M + commonElevation) / (EARTH_RADIUS_M + meanElevation);
      const localFactor = Number.isFinite(factor) && factor > 0 ? factor : 1;
      return localFactor * legacyGridScale;
    }
    return averageScaleFactor * legacyGridScale;
  }

  const fromF = stationFactorSnapshot(obs.from);
  const toF = stationFactorSnapshot(obs.to);
  const avgGridScale = (fromF.gridScaleFactor + toF.gridScaleFactor) / 2;
  const avgCombined = (fromF.combinedFactor + toF.combinedFactor) / 2;
  const distMode = obs.gridDistanceMode ?? 'measured';
  const distanceKind =
    obs.distanceKind ??
    (distMode === 'ellipsoidal' ? 'ellipsoidal' : distMode === 'grid' ? 'grid' : 'ground');
  if (distanceKind === 'grid') return 1;
  if (distanceKind === 'ellipsoidal') return avgGridScale;
  if (scaleOverrideActive) {
    addCoordSystemDiagnostic(
      'SCALE_OVERRIDE_USED',
      `.SCALE override active in GRID mode: measured distances use k=${averageScaleFactor.toFixed(8)} (combined factor replaced).`,
    );
    return averageScaleFactor;
  }
  return avgCombined;
};

export const zenithScaleForObservation = ({
  averageScaleFactor,
  commonElevation,
  coordSystemMode,
  crsGridScaleEnabled,
  crsGridScaleFactor,
  localDatumScheme,
  obs,
  scaleOverrideActive,
  stationEllipsoidHeight,
  stationFactorSnapshot,
  stations,
}: {
  averageScaleFactor: number;
  commonElevation: number;
  coordSystemMode: ParseOptions['coordSystemMode'];
  crsGridScaleEnabled: boolean;
  crsGridScaleFactor: number;
  localDatumScheme: ParseOptions['localDatumScheme'];
  obs: Observation & { type: 'zenith' };
  scaleOverrideActive: boolean;
  stationEllipsoidHeight: (_station: StationMap[string]) => number;
  stationFactorSnapshot: (_stationId: StationId) => StationFactorSnapshot;
  stations: StationMap;
}): number => {
  if (coordSystemMode === 'local') {
    const legacyGridScale =
      crsGridScaleEnabled && Number.isFinite(crsGridScaleFactor) && crsGridScaleFactor > 0
        ? crsGridScaleFactor
        : 1;
    if (localDatumScheme === 'common-elevation') {
      const from = stations[obs.from];
      const to = stations[obs.to];
      if (!from || !to) return 1;
      const meanElevation = (stationEllipsoidHeight(from) + stationEllipsoidHeight(to)) / 2;
      const factor = (EARTH_RADIUS_M + commonElevation) / (EARTH_RADIUS_M + meanElevation);
      const localFactor = Number.isFinite(factor) && factor > 0 ? factor : 1;
      return localFactor * legacyGridScale;
    }
    return averageScaleFactor * legacyGridScale;
  }

  const fromF = stationFactorSnapshot(obs.from);
  const toF = stationFactorSnapshot(obs.to);
  if (scaleOverrideActive) return averageScaleFactor;
  return (fromF.combinedFactor + toF.combinedFactor) / 2;
};
