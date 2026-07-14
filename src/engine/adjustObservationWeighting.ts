import { INDUSTRY_PARITY_ANGULAR_SIGMA_SCALE } from './adjustConstants';
import type {
  Instrument,
  Observation,
  SigmaSource,
} from '../types';

type LineGeometry = { horiz: number; slope: number; elev: number };
type SigmaAzimuth = { az: number; dist: number };

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
