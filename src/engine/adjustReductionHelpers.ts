import { DEG_TO_RAD, RAD_TO_DEG } from './angles';
import { EARTH_RADIUS_M } from './adjustConstants';
import {
  computeElevationFactor,
  computeGridFactors,
  projectGeodeticToEN,
} from './geodesy';
import type {
  CoordSystemDiagnosticCode,
  FactorComputationMethod,
  Observation,
  ParseOptions,
  StationId,
  StationMap,
} from '../types';

type StationFactorSnapshot = {
  convergenceAngleRad: number;
  gridScaleFactor: number;
  elevationFactor: number;
  combinedFactor: number;
  source: 'projection-formula' | 'numerical-fallback';
  factorComputationMethod: FactorComputationMethod;
};

type ZenithGeometry = {
  z: number;
  dist: number;
  horiz: number;
  dh: number;
  crCorr: number;
};

type CorrectedDistanceModelResult = {
  calcDistance: number;
  mapScale: number;
  prismCorrection: number;
  horizontalDerivativeFactor?: number;
  verticalDerivativeFactor?: number;
  useReducedSlopeDerivatives?: boolean;
};

export const measuredAngleCorrection = ({
  coordSystemMode,
  from,
  stationFactorSnapshot,
  to,
}: {
  coordSystemMode: ParseOptions['coordSystemMode'];
  from: StationId;
  stationFactorSnapshot: (_stationId: StationId) => StationFactorSnapshot;
  to: StationId;
}): number => {
  if (coordSystemMode !== 'grid') return 0;
  const convFrom = stationFactorSnapshot(from).convergenceAngleRad;
  const convTo = stationFactorSnapshot(to).convergenceAngleRad;
  return convTo - convFrom;
};

export const rawDistanceCombinedFactor = ({
  coordSystemMode,
  crsId,
  obs,
  stationEllipsoidHeight,
  stationFactorSnapshot,
  stationGeodetic,
  stations,
}: {
  coordSystemMode: ParseOptions['coordSystemMode'];
  crsId: string;
  obs: Observation & { type: 'dist' };
  stationEllipsoidHeight: (_station: StationMap[string]) => number;
  stationFactorSnapshot: (_stationId: StationId) => StationFactorSnapshot;
  stationGeodetic: (_stationId: StationId) => { latDeg: number; lonDeg: number } | null;
  stations: StationMap;
}): number => {
  const fromF = stationFactorSnapshot(obs.from);
  const toF = stationFactorSnapshot(obs.to);
  const averageCombined = (fromF.combinedFactor + toF.combinedFactor) / 2;
  if (coordSystemMode !== 'grid') return averageCombined;

  const fromGeo = stationGeodetic(obs.from);
  const toGeo = stationGeodetic(obs.to);
  const fromStation = stations[obs.from];
  const toStation = stations[obs.to];
  if (!fromGeo || !toGeo || !fromStation || !toStation) return averageCombined;

  const midpointFactors = computeGridFactors(
    (fromGeo.latDeg + toGeo.latDeg) / 2,
    (fromGeo.lonDeg + toGeo.lonDeg) / 2,
    crsId,
  );
  if (!midpointFactors) return averageCombined;

  const meanEllipsoidHeight =
    (stationEllipsoidHeight(fromStation) + stationEllipsoidHeight(toStation)) / 2;
  return midpointFactors.gridScaleFactor * computeElevationFactor(meanEllipsoidHeight);
};

export const rawDirectionSetCorrection = ({
  coordSystemMode,
  crsId,
  obs,
  parseState,
  stationGeodetic,
  stations,
  wrapToPi,
}: {
  coordSystemMode: ParseOptions['coordSystemMode'];
  crsId: string;
  obs: Observation & { type: 'direction' };
  parseState?: ParseOptions;
  stationGeodetic: (_stationId: StationId) => { latDeg: number; lonDeg: number } | null;
  stations: StationMap;
  wrapToPi: (_value: number) => number;
}): number => {
  if (coordSystemMode !== 'grid') return 0;
  const fromStation = stations[obs.at];
  const toStation = stations[obs.to];
  const fromGeo = stationGeodetic(obs.at);
  const toGeo = stationGeodetic(obs.to);
  if (!fromStation || !toStation || !fromGeo || !toGeo) return 0;
  const lat1 = fromGeo.latDeg * DEG_TO_RAD;
  const lon1 = fromGeo.lonDeg * DEG_TO_RAD;
  const lat2 = toGeo.latDeg * DEG_TO_RAD;
  const lon2 = toGeo.lonDeg * DEG_TO_RAD;
  const dLon = lon2 - lon1;
  const y = Math.sin(dLon) * Math.cos(lat2);
  const x =
    Math.cos(lat1) * Math.sin(lat2) - Math.sin(lat1) * Math.cos(lat2) * Math.cos(dLon);
  const bearing = Math.atan2(y, x);
  const hav =
    Math.sin((lat2 - lat1) / 2) ** 2 +
    Math.cos(lat1) * Math.cos(lat2) * Math.sin(dLon / 2) ** 2;
  const centralAngle = 2 * Math.asin(Math.min(1, Math.sqrt(Math.max(hav, 0))));
  if (!Number.isFinite(centralAngle) || centralAngle <= 0) return 0;
  const step = Math.min(centralAngle * 1e-2, 1e-6);
  if (!Number.isFinite(step) || step <= 0) return 0;
  const nearLat = Math.asin(
    Math.sin(lat1) * Math.cos(step) + Math.cos(lat1) * Math.sin(step) * Math.cos(bearing),
  );
  const nearLon =
    lon1 +
    Math.atan2(
      Math.sin(bearing) * Math.sin(step) * Math.cos(lat1),
      Math.cos(step) - Math.sin(lat1) * Math.sin(nearLat),
    );
  const nearProjected = projectGeodeticToEN({
    latDeg: nearLat * RAD_TO_DEG,
    lonDeg: nearLon * RAD_TO_DEG,
    originLatDeg: parseState?.originLatDeg ?? fromGeo.latDeg,
    originLonDeg: parseState?.originLonDeg ?? fromGeo.lonDeg,
    model: parseState?.crsProjectionModel ?? 'legacy-equirectangular',
    coordSystemMode,
    crsId,
  });
  const tangentAz = Math.atan2(
    nearProjected.east - fromStation.x,
    nearProjected.north - fromStation.y,
  );
  const chordAz = Math.atan2(toStation.x - fromStation.x, toStation.y - fromStation.y);
  return wrapToPi(chordAz - tangentAz);
};

export const captureRawTraverseDistanceFactorSnapshots = (
  activeObservations: Observation[],
  parseState: ParseOptions | undefined,
  rawDistanceCombinedFactor: (_obs: Observation & { type: 'dist' }) => number,
): void => {
  if (!parseState) return;

  const rawDistanceCombinedFactorByObsId: Record<number, number> = {};
  activeObservations.forEach((obs) => {
    if (obs.type !== 'dist') return;
    rawDistanceCombinedFactorByObsId[obs.id] = rawDistanceCombinedFactor(obs);
  });
  parseState.rawDistanceCombinedFactorByObsId = rawDistanceCombinedFactorByObsId;
};

export const captureRawTraverseDirectionCorrections = (
  activeObservations: Observation[],
  parseState: ParseOptions | undefined,
  rawDirectionSetCorrection: (_obs: Observation & { type: 'direction' }) => number,
): void => {
  if (!parseState) return;
  const directionGroups = new Map<string, Array<Observation & { type: 'direction' }>>();
  activeObservations
    .filter((obs): obs is Observation & { type: 'direction' } => obs.type === 'direction')
    .sort((a, b) => {
      const aLine = a.sourceLine ?? Number.MAX_SAFE_INTEGER;
      const bLine = b.sourceLine ?? Number.MAX_SAFE_INTEGER;
      if (aLine !== bLine) return aLine - bLine;
      return a.id - b.id;
    })
    .forEach((obs) => {
      const group = directionGroups.get(obs.setId) ?? [];
      group.push(obs);
      directionGroups.set(obs.setId, group);
    });

  const rawDirectionSetCorrectionByObsId: Record<number, number> = {};
  directionGroups.forEach((group) => {
    group.forEach((obs) => {
      rawDirectionSetCorrectionByObsId[obs.id] = rawDirectionSetCorrection(obs);
    });
  });
  parseState.rawDirectionSetCorrectionByObsId = rawDirectionSetCorrectionByObsId;
};

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

export const prismCorrectionForObservation = ({
  obs,
  prismEnabled,
  prismOffset,
  prismScope,
}: {
  obs: Observation;
  prismEnabled: boolean;
  prismOffset: number;
  prismScope: ParseOptions['prismScope'];
}): number => {
  if (obs.type !== 'dist' && obs.type !== 'zenith') return 0;

  const obsOffset = Number.isFinite(obs.prismCorrectionM ?? NaN)
    ? (obs.prismCorrectionM ?? 0)
    : undefined;
  if (obsOffset != null) {
    if (obs.prismScope === 'set') {
      const setId = typeof obs.setId === 'string' ? obs.setId.trim() : '';
      if (!setId) return 0;
    }
    return obsOffset;
  }

  if (!prismEnabled || !Number.isFinite(prismOffset) || Math.abs(prismOffset) <= 0) {
    return 0;
  }
  if ((prismScope ?? 'global') === 'set') {
    const setId = typeof obs.setId === 'string' ? obs.setId.trim() : '';
    if (!setId) return 0;
  }
  return prismOffset;
};

export const correctedDistanceModel = ({
  calcDistRaw,
  centeringLineGeometry,
  coordSystemMode,
  distanceScaleForObservation,
  is2D,
  obs,
  prismCorrectionForObservation,
}: {
  calcDistRaw: number;
  centeringLineGeometry: (
    _fromId: StationId,
    _toId: StationId,
    _hi?: number,
    _ht?: number,
  ) => { horiz: number; slope: number; elev: number };
  coordSystemMode: ParseOptions['coordSystemMode'];
  distanceScaleForObservation: (_obs: Observation) => number;
  is2D: boolean;
  obs: Observation & { type: 'dist' };
  prismCorrectionForObservation: (_obs: Observation) => number;
}): CorrectedDistanceModelResult => {
  const mapScale = distanceScaleForObservation(obs);
  const prismCorrection = prismCorrectionForObservation(obs);
  if (
    coordSystemMode === 'grid' &&
    !is2D &&
    obs.mode === 'slope' &&
    Number.isFinite(mapScale) &&
    mapScale > 0
  ) {
    const geom = centeringLineGeometry(obs.from, obs.to, obs.hi ?? 0, obs.ht ?? 0);
    const groundHoriz = geom.horiz / mapScale;
    const calcDistance =
      Math.sqrt(groundHoriz * groundHoriz + geom.elev * geom.elev) + prismCorrection;
    const denom = Math.max(calcDistance - prismCorrection, 1e-12);
    return {
      calcDistance,
      mapScale,
      prismCorrection,
      horizontalDerivativeFactor: 1 / (mapScale * mapScale * denom),
      verticalDerivativeFactor: 1 / denom,
      useReducedSlopeDerivatives: true,
    };
  }
  return {
    calcDistance: (calcDistRaw + prismCorrection) * mapScale,
    mapScale,
    prismCorrection,
  };
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

export const getZenith = ({
  curvatureRefractionAngle,
  fromID,
  hi = 0,
  ht = 0,
  stations,
  toID,
  zenithCache,
}: {
  curvatureRefractionAngle: (_horiz: number) => number;
  fromID: StationId;
  hi?: number;
  ht?: number;
  stations: StationMap;
  toID: StationId;
  zenithCache: Map<string, ZenithGeometry>;
}): ZenithGeometry => {
  const cacheKey = `${fromID}|${toID}|${hi}|${ht}`;
  const cached = zenithCache.get(cacheKey);
  if (cached) return cached;
  const s1 = stations[fromID];
  const s2 = stations[toID];
  if (!s1 || !s2) return { z: 0, dist: 0, horiz: 0, dh: 0, crCorr: 0 };
  const dx = s2.x - s1.x;
  const dy = s2.y - s1.y;
  const dh = s2.h + ht - (s1.h + hi);
  const horiz = Math.sqrt(dx * dx + dy * dy);
  const dist = Math.sqrt(horiz * horiz + dh * dh);
  const zGeom = dist === 0 ? 0 : Math.acos(dh / dist);
  const crCorr = curvatureRefractionAngle(horiz);
  const z = Math.min(Math.PI, Math.max(0, zGeom + crCorr));
  const result = { z, dist, horiz, dh, crCorr };
  zenithCache.set(cacheKey, result);
  return result;
};

export const getModeledZenith = ({
  coordSystemMode,
  curvatureRefractionAngle,
  getZenith,
  is2D,
  obs,
  zenithScaleForObservation,
}: {
  coordSystemMode: ParseOptions['coordSystemMode'];
  curvatureRefractionAngle: (_horiz: number) => number;
  getZenith: (
    _fromId: StationId,
    _toId: StationId,
    _hi?: number,
    _ht?: number,
  ) => ZenithGeometry;
  is2D: boolean;
  obs: Observation & { type: 'zenith' };
  zenithScaleForObservation: (_obs: Observation & { type: 'zenith' }) => number;
}): ZenithGeometry & { horizontalScale: number } => {
  const raw = getZenith(obs.from, obs.to, obs.hi ?? 0, obs.ht ?? 0);
  const horizontalScale = coordSystemMode === 'grid' && !is2D ? zenithScaleForObservation(obs) : 1;
  if (
    !Number.isFinite(horizontalScale) ||
    horizontalScale <= 0 ||
    Math.abs(horizontalScale - 1) <= 1e-12
  ) {
    return { ...raw, horizontalScale: 1 };
  }
  const horiz = raw.horiz / horizontalScale;
  const dist = Math.sqrt(horiz * horiz + raw.dh * raw.dh);
  const zGeom = dist === 0 ? 0 : Math.acos(raw.dh / dist);
  const crCorr = curvatureRefractionAngle(horiz);
  const z = Math.min(Math.PI, Math.max(0, zGeom + crCorr));
  return { z, dist, horiz, dh: raw.dh, crCorr, horizontalScale };
};

export const effectiveDistanceForAngularObservation = ({
  getAzimuth,
  getModeledZenith,
  obs,
}: {
  getAzimuth: (_fromId: StationId, _toId: StationId) => { az: number; dist: number };
  getModeledZenith: (_obs: Observation & { type: 'zenith' }) => ZenithGeometry & {
    horizontalScale: number;
  };
  obs: Observation;
}): number | undefined => {
  if (obs.type === 'angle') {
    const rayFrom = getAzimuth(obs.at, obs.from).dist;
    const rayTo = getAzimuth(obs.at, obs.to).dist;
    if (!Number.isFinite(rayFrom) || !Number.isFinite(rayTo) || rayFrom <= 0 || rayTo <= 0) {
      return undefined;
    }
    const denom = 1 / rayFrom + 1 / rayTo;
    return denom > 0 ? 2 / denom : undefined;
  }
  if (obs.type === 'direction') {
    const dist = getAzimuth(obs.at, obs.to).dist;
    return Number.isFinite(dist) && dist > 0 ? dist : undefined;
  }
  if (obs.type === 'bearing' || obs.type === 'dir') {
    const dist = getAzimuth(obs.from, obs.to).dist;
    return Number.isFinite(dist) && dist > 0 ? dist : undefined;
  }
  if (obs.type === 'zenith') {
    const geom = getModeledZenith(obs).dist;
    return Number.isFinite(geom) && geom > 0 ? geom : undefined;
  }
  return undefined;
};

export const curvatureRefractionAngle = ({
  applyCurvatureRefraction,
  horiz,
  refractionCoefficient,
  verticalReduction,
}: {
  applyCurvatureRefraction: boolean;
  horiz: number;
  refractionCoefficient: number;
  verticalReduction: ParseOptions['verticalReduction'];
}): number => {
  if (!applyCurvatureRefraction) return 0;
  if (verticalReduction !== 'curvref') return 0;
  if (!Number.isFinite(horiz) || horiz <= 0) return 0;
  return ((1 - 2 * refractionCoefficient) * horiz) / (2 * EARTH_RADIUS_M);
};
