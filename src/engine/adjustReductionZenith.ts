import { EARTH_RADIUS_M } from './adjustConstants';
import type { Observation, ParseOptions, StationId, StationMap } from '../types';
import type { ZenithGeometry } from './adjustReductionTypes';

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
