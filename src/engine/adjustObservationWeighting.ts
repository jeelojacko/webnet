import { INDUSTRY_PARITY_ANGULAR_SIGMA_SCALE } from './adjustConstants';
import type {
  Instrument,
  Observation,
  SigmaSource,
  StationId,
  StationMap,
} from '../types';

type LineGeometry = { horiz: number; slope: number; elev: number };
type SigmaAzimuth = { az: number; dist: number };
type SigmaZenith = { z: number; dist: number; horiz: number; dh: number; crCorr: number };

export const captureInitialSigmaGeometrySnapshot = ({
  azimuthCache,
  geometryDependentSigmaReference,
  stations,
  zenithCache,
}: {
  azimuthCache: Map<string, SigmaAzimuth>;
  geometryDependentSigmaReference: 'current' | 'initial';
  stations: StationMap;
  zenithCache: Map<string, SigmaZenith>;
}): StationMap => {
  if (geometryDependentSigmaReference !== 'initial') {
    azimuthCache.clear();
    zenithCache.clear();
    return {};
  }
  azimuthCache.clear();
  zenithCache.clear();
  return Object.fromEntries(
    Object.entries(stations).map(([id, station]) => [
      id,
      {
        ...station,
        x: station.x,
        y: station.y,
        h: station.h,
      },
    ]),
  );
};

export const getSigmaGeometryAzimuth = ({
  cache,
  currentGeometryAzimuth,
  fromID,
  geometryDependentSigmaReference,
  initialSigmaGeometryStations,
  toID,
}: {
  cache: Map<string, SigmaAzimuth>;
  currentGeometryAzimuth: (_fromId: StationId, _toId: StationId) => SigmaAzimuth;
  fromID: StationId;
  geometryDependentSigmaReference: 'current' | 'initial';
  initialSigmaGeometryStations: StationMap;
  toID: StationId;
}): SigmaAzimuth => {
  if (geometryDependentSigmaReference !== 'initial') {
    return currentGeometryAzimuth(fromID, toID);
  }
  const cacheKey = `${fromID}|${toID}`;
  const cached = cache.get(cacheKey);
  if (cached) return cached;
  const s1 = initialSigmaGeometryStations[fromID];
  const s2 = initialSigmaGeometryStations[toID];
  if (!s1 || !s2) return { az: 0, dist: 0 };
  const dx = s2.x - s1.x;
  const dy = s2.y - s1.y;
  let az = Math.atan2(dx, dy);
  if (az < 0) az += 2 * Math.PI;
  const result = { az, dist: Math.sqrt(dx * dx + dy * dy) };
  cache.set(cacheKey, result);
  return result;
};

export const getSigmaGeometryZenith = ({
  cache,
  currentGeometryZenith,
  curvatureRefractionAngle,
  fromID,
  geometryDependentSigmaReference,
  hi = 0,
  ht = 0,
  initialSigmaGeometryStations,
  toID,
}: {
  cache: Map<string, SigmaZenith>;
  currentGeometryZenith: (
    _fromId: StationId,
    _toId: StationId,
    _hi?: number,
    _ht?: number,
  ) => SigmaZenith;
  curvatureRefractionAngle: (_horiz: number) => number;
  fromID: StationId;
  geometryDependentSigmaReference: 'current' | 'initial';
  hi?: number;
  ht?: number;
  initialSigmaGeometryStations: StationMap;
  toID: StationId;
}): SigmaZenith => {
  if (geometryDependentSigmaReference !== 'initial') {
    return currentGeometryZenith(fromID, toID, hi, ht);
  }
  const cacheKey = `${fromID}|${toID}|${hi}|${ht}`;
  const cached = cache.get(cacheKey);
  if (cached) return cached;
  const s1 = initialSigmaGeometryStations[fromID];
  const s2 = initialSigmaGeometryStations[toID];
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
  cache.set(cacheKey, result);
  return result;
};

export const shouldApplyIndustryParityAngularSigmaCalibration = (
  obs: Observation,
  source: SigmaSource,
  geometryDependentSigmaReference: 'current' | 'initial',
): boolean => {
  if (geometryDependentSigmaReference !== 'initial') return false;
  if (source === 'explicit' || source === 'fixed' || source === 'float') return false;
  return (
    obs.type === 'angle' ||
    obs.type === 'direction' ||
    obs.type === 'bearing' ||
    obs.type === 'dir'
  );
};

export const effectiveStdDev = ({
  addCenteringToExplicit,
  applyCentering,
  centeringLineGeometry,
  geometryDependentSigmaReference,
  getSigmaGeometryAzimuth,
  instrument,
  is2D,
  obs,
  wrapToPi,
}: {
  addCenteringToExplicit: boolean;
  applyCentering: boolean;
  centeringLineGeometry: (
    _fromId: string,
    _toId: string,
    _hi?: number,
    _ht?: number,
  ) => LineGeometry;
  geometryDependentSigmaReference: 'current' | 'initial';
  getSigmaGeometryAzimuth: (_fromId: string, _toId: string) => SigmaAzimuth;
  instrument?: Instrument;
  is2D: boolean;
  obs: Observation;
  wrapToPi: (_value: number) => number;
}): number => {
  let sigma = Number.isFinite(obs.stdDev) ? obs.stdDev : 0;
  if (!instrument) return Math.max(sigma, 1e-12);

  const source = obs.sigmaSource ?? 'explicit';
  if (shouldApplyIndustryParityAngularSigmaCalibration(obs, source, geometryDependentSigmaReference)) {
    sigma *= INDUSTRY_PARITY_ANGULAR_SIGMA_SCALE;
  }
  if (source === 'fixed' || source === 'float') return Math.max(sigma, 1e-12);
  if (!applyCentering) return Math.max(sigma, 1e-12);
  if (source === 'explicit' && !addCenteringToExplicit) return Math.max(sigma, 1e-12);

  const instCenter = instrument.instCentr_m || 0;
  const tgtCenter = instrument.tgtCentr_m || 0;
  const centerHorizSq = instCenter * instCenter + tgtCenter * tgtCenter;
  const centerHoriz = Math.sqrt(centerHorizSq);
  const centerVert = Math.abs(instrument.vertCentr_m || 0);
  const centerVertSq = centerVert * centerVert;

  if (obs.type === 'dist') {
    if (is2D || obs.mode !== 'slope') {
      if (centerHoriz <= 0) return Math.max(sigma, 1e-12);
      return Math.max(Math.sqrt(sigma * sigma + centerHorizSq), 1e-12);
    }
    if (centerHorizSq <= 0 && centerVertSq <= 0) return Math.max(sigma, 1e-12);
    const geom = centeringLineGeometry(obs.from, obs.to, obs.hi ?? 0, obs.ht ?? 0);
    const slope = Math.max(geom.slope, 1e-12);
    const horizRatioSq = (geom.horiz / slope) ** 2;
    const elevRatioSq = (geom.elev / slope) ** 2;
    const centeringVariance = horizRatioSq * centerHorizSq + 2 * elevRatioSq * centerVertSq;
    return Math.max(Math.sqrt(sigma * sigma + centeringVariance), 1e-12);
  }

  if (obs.type === 'direction') {
    if (centerHoriz <= 0) return Math.max(sigma, 1e-12);
    const az = getSigmaGeometryAzimuth(obs.at, obs.to);
    const term = az.dist > 0 ? centerHoriz / az.dist : 0;
    return Math.max(Math.sqrt(sigma * sigma + term * term), 1e-12);
  }
  if (obs.type === 'bearing') {
    if (centerHoriz <= 0) return Math.max(sigma, 1e-12);
    const az = getSigmaGeometryAzimuth(obs.from, obs.to);
    const term = az.dist > 0 ? centerHoriz / az.dist : 0;
    return Math.max(Math.sqrt(sigma * sigma + term * term), 1e-12);
  }
  if (obs.type === 'dir') {
    if (centerHoriz <= 0) return Math.max(sigma, 1e-12);
    const az = getSigmaGeometryAzimuth(obs.from, obs.to);
    const term = az.dist > 0 ? centerHoriz / az.dist : 0;
    return Math.max(Math.sqrt(sigma * sigma + term * term), 1e-12);
  }
  if (obs.type === 'angle') {
    if (centerHoriz <= 0) return Math.max(sigma, 1e-12);
    const azTo = getSigmaGeometryAzimuth(obs.at, obs.to);
    const azFrom = getSigmaGeometryAzimuth(obs.at, obs.from);
    const dTo = Math.max(azTo.dist, 1e-12);
    const dFrom = Math.max(azFrom.dist, 1e-12);
    const geometryAngle = wrapToPi(azTo.az - azFrom.az);
    const angle =
      geometryDependentSigmaReference === 'initial'
        ? geometryAngle
        : Number.isFinite(obs.obs)
          ? obs.obs
          : geometryAngle;
    const cross = Math.cos(angle);
    const termSq =
      (centerHoriz * centerHoriz) / (dTo * dTo) +
      (centerHoriz * centerHoriz) / (dFrom * dFrom) -
      (2 * centerHoriz * centerHoriz * cross) / (dTo * dFrom);
    const term = Math.sqrt(Math.max(termSq, 0));
    return Math.max(Math.sqrt(sigma * sigma + term * term), 1e-12);
  }
  if (obs.type === 'zenith') {
    if (centerHorizSq <= 0 && centerVertSq <= 0) return Math.max(sigma, 1e-12);
    const geom = centeringLineGeometry(obs.from, obs.to, obs.hi ?? 0, obs.ht ?? 0);
    const slope = Math.max(geom.slope, 1e-12);
    const horizRatioSq = (geom.horiz / slope) ** 2;
    const elevRatioSq = (geom.elev / slope) ** 2;
    const linearVariance = elevRatioSq * centerHorizSq + 2 * horizRatioSq * centerVertSq;
    const term = Math.sqrt(Math.max(linearVariance, 0)) / slope;
    return Math.max(Math.sqrt(sigma * sigma + term * term), 1e-12);
  }
  if (obs.type === 'lev') {
    return Math.max(sigma, 1e-12);
  }

  return Math.max(sigma, 1e-12);
};
