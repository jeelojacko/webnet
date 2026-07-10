import { wrapTo2Pi } from './adjustMath';
import type { GpsCovariance, GpsSolveVector } from './adjustTypes';
import { getObservationSideshotCalcMeta } from './observationMetadata';
import type { AdjustmentResult, Observation, ParseOptions, StationId, StationMap } from '../types';

type SideshotStationFactorSnapshot = {
  gridScaleFactor: number;
  combinedFactor: number;
};

type GpsRoverOffsetVector = {
  dE: number;
  dN: number;
  dH: number;
  applied: boolean;
};

export type SideshotResultContext = {
  observations: Observation[];
  stations: StationMap;
  parseState?: ParseOptions;
  coordSystemMode: ParseOptions['coordSystemMode'];
  scaleOverrideActive: boolean;
  averageScaleFactor: number;
  crsGridScaleEnabled: boolean;
  crsGridScaleFactor: number;
  effectiveStdDev: (_obs: Observation) => number;
  prismCorrectionForObservation: (_obs: Observation) => number;
  curvatureRefractionAngle: (_horiz: number) => number;
  mapDistanceScaleForObservation: (_obs: Observation) => number;
  stationFactorSnapshot: (_stationId: StationId) => SideshotStationFactorSnapshot;
  getAzimuth: (_fromID: StationId, _toID: StationId) => { az: number; dist: number };
  gpsObservedVector: (_obs: Observation & { type: 'gps' }) => GpsSolveVector;
  gpsCovariance: (_obs: Observation) => GpsCovariance;
  gpsRoverOffsetVector: (_obs: Observation & { type: 'gps' }) => GpsRoverOffsetVector;
  modeledAzimuth: (
    _rawAz: number,
    _atStationId?: StationId,
    _applyConvergence?: boolean,
  ) => number;
};

export const buildSideshotResults = (
  context: SideshotResultContext,
): AdjustmentResult['sideshots'] => {
const isSideshot = (obs: Observation): boolean => getObservationSideshotCalcMeta(obs) != null;
const isGpsSideshot = (obs: Observation): obs is Observation & { type: 'gps' } =>
  obs.type === 'gps' && obs.gpsMode === 'sideshot';
const verticalByKey = new Map<string, Observation>();
context.observations.forEach((obs) => {
  if (!isSideshot(obs)) return;
  if ((obs.type !== 'lev' && obs.type !== 'zenith') || !('from' in obs) || !('to' in obs))
    return;
  const key = `${obs.from}|${obs.to}|${obs.sourceLine ?? -1}`;
  verticalByKey.set(key, obs);
});

const rows: NonNullable<AdjustmentResult['sideshots']> = [];
context.observations.forEach((obs) => {
  if (!isSideshot(obs) || obs.type !== 'dist') return;
  const from = obs.from;
  const to = obs.to;
  const sourceLine = obs.sourceLine;
  const key = `${from}|${to}|${sourceLine ?? -1}`;
  const vertical = verticalByKey.get(key);
  const fromSt = context.stations[from];
  const toSt = context.stations[to];
  const calcMeta = getObservationSideshotCalcMeta(obs);
  if (!fromSt) return;

  const mode = obs.mode ?? 'slope';
  const distSigma = context.effectiveStdDev(obs);
  const prismCorrection = context.prismCorrectionForObservation(obs);
  const observedDistance = Math.max(obs.obs - prismCorrection, 0);
  let horizDistance = observedDistance;
  let sigmaHoriz = distSigma;
  let deltaH: number | undefined;
  let sigmaDh = 0;

  if (mode === 'slope') {
    const zen = vertical && vertical.type === 'zenith' ? vertical : undefined;
    if (zen) {
      let zGeom = zen.obs;
      for (let iteration = 0; iteration < 3; iteration += 1) {
        const trialHoriz = observedDistance * Math.sin(zGeom);
        const crCorr = context.curvatureRefractionAngle(trialHoriz);
        zGeom = Math.min(Math.PI, Math.max(0, zen.obs - crCorr));
      }
      const sigmaZ = context.effectiveStdDev(zen);
      horizDistance = observedDistance * Math.sin(zGeom);
      deltaH = observedDistance * Math.cos(zGeom);
      sigmaHoriz = Math.sqrt(
        (Math.sin(zGeom) * distSigma) ** 2 + (observedDistance * Math.cos(zGeom) * sigmaZ) ** 2,
      );
      sigmaDh = Math.sqrt(
        (Math.cos(zGeom) * distSigma) ** 2 + (observedDistance * Math.sin(zGeom) * sigmaZ) ** 2,
      );
    }
  } else {
    horizDistance = observedDistance;
    sigmaHoriz = distSigma;
    const lev = vertical && vertical.type === 'lev' ? vertical : undefined;
    if (lev) {
      deltaH = lev.obs;
      sigmaDh = context.effectiveStdDev(lev);
    }
  }

  let horizScale = context.mapDistanceScaleForObservation(obs);
  if (context.coordSystemMode === 'grid') {
    const fromFactors = context.stationFactorSnapshot(from);
    const distMode = obs.gridDistanceMode ?? 'measured';
    const distanceKind =
      obs.distanceKind ??
      (distMode === 'ellipsoidal' ? 'ellipsoidal' : distMode === 'grid' ? 'grid' : 'ground');
    if (distanceKind === 'ellipsoidal') {
      horizScale *= fromFactors.gridScaleFactor;
    } else if (distanceKind === 'ground') {
      horizScale *= context.scaleOverrideActive ? context.averageScaleFactor : fromFactors.combinedFactor;
    }
  } else if (context.crsGridScaleEnabled) {
    horizScale *= context.crsGridScaleFactor;
  }
  if (horizScale !== 1) {
    horizDistance *= horizScale;
    sigmaHoriz *= Math.abs(horizScale);
  }

  const explicitAz = calcMeta?.azimuthObs;
  const explicitSigmaAz = calcMeta?.azimuthStdDev;
  const setupHz = calcMeta?.hzObs;
  const setupSigmaHz = calcMeta?.hzStdDev;
  const backsightId = calcMeta?.backsightId as StationId | undefined;
  const hasExplicitAz = Number.isFinite(explicitAz);
  const hasSetupHz = Number.isFinite(setupHz);
  const backsightSt = backsightId ? context.stations[backsightId] : undefined;
  const hasTargetAz = !!toSt;
  let setupAzimuth: number | undefined;
  if (hasSetupHz && backsightId && backsightSt) {
    const bs = context.getAzimuth(from, backsightId).az;
    setupAzimuth = wrapTo2Pi(bs + (setupHz as number));
  }
  const hasAzimuth = hasExplicitAz || setupAzimuth != null || hasTargetAz;
  const azimuth = hasExplicitAz
    ? (explicitAz as number)
    : setupAzimuth != null
      ? setupAzimuth
      : hasTargetAz
        ? context.getAzimuth(from, to).az
        : undefined;
  let sigmaAz = hasExplicitAz ? (explicitSigmaAz ?? 0) : 0;
  if (!hasExplicitAz && setupAzimuth != null && backsightId && backsightSt) {
    const azBs = context.getAzimuth(from, backsightId);
    const d = Math.max(azBs.dist, 1e-12);
    const dAz_dE_To = Math.cos(azBs.az) / d;
    const dAz_dN_To = -Math.sin(azBs.az) / d;
    const dAz_dE_From = -dAz_dE_To;
    const dAz_dN_From = -dAz_dN_To;
    const sETo = backsightSt.sE ?? 0;
    const sNTo = backsightSt.sN ?? 0;
    const sEFrom = fromSt.sE ?? 0;
    const sNFrom = fromSt.sN ?? 0;
    const sigmaAzBs = Math.sqrt(
      (dAz_dE_To * sETo) ** 2 +
        (dAz_dN_To * sNTo) ** 2 +
        (dAz_dE_From * sEFrom) ** 2 +
        (dAz_dN_From * sNFrom) ** 2,
    );
    sigmaAz = Math.sqrt((setupSigmaHz ?? 0) ** 2 + sigmaAzBs ** 2);
  } else if (!hasExplicitAz && setupAzimuth == null && hasTargetAz && azimuth != null) {
    const az = context.getAzimuth(from, to);
    const d = Math.max(az.dist, 1e-12);
    const dAz_dE_To = Math.cos(az.az) / d;
    const dAz_dN_To = -Math.sin(az.az) / d;
    const dAz_dE_From = -dAz_dE_To;
    const dAz_dN_From = -dAz_dN_To;
    const sETo = toSt?.sE ?? 0;
    const sNTo = toSt?.sN ?? 0;
    const sEFrom = fromSt.sE ?? 0;
    const sNFrom = fromSt.sN ?? 0;
    sigmaAz = Math.sqrt(
      (dAz_dE_To * sETo) ** 2 +
        (dAz_dN_To * sNTo) ** 2 +
        (dAz_dE_From * sEFrom) ** 2 +
        (dAz_dN_From * sNFrom) ** 2,
    );
  }
  const easting =
    hasAzimuth && azimuth != null ? fromSt.x + horizDistance * Math.sin(azimuth) : undefined;
  const northing =
    hasAzimuth && azimuth != null ? fromSt.y + horizDistance * Math.cos(azimuth) : undefined;
  const height = deltaH != null ? fromSt.h + deltaH : undefined;

  const sigmaFromE = fromSt.sE ?? 0;
  const sigmaFromN = fromSt.sN ?? 0;
  const sigmaFromH = fromSt.sH ?? 0;
  const sigmaE =
    hasAzimuth && azimuth != null
      ? Math.sqrt(
          sigmaFromE * sigmaFromE +
            (Math.sin(azimuth) * sigmaHoriz) ** 2 +
            (horizDistance * Math.cos(azimuth) * sigmaAz) ** 2,
        )
      : undefined;
  const sigmaN =
    hasAzimuth && azimuth != null
      ? Math.sqrt(
          sigmaFromN * sigmaFromN +
            (Math.cos(azimuth) * sigmaHoriz) ** 2 +
            (horizDistance * Math.sin(azimuth) * sigmaAz) ** 2,
        )
      : undefined;
  const sigmaH =
    deltaH != null ? Math.sqrt(sigmaFromH * sigmaFromH + sigmaDh * sigmaDh) : undefined;

  const notes: string[] = [];
  if (hasSetupHz && !backsightSt) {
    notes.push('setup horizontal angle provided but backsight is unavailable');
  }
  if (!hasAzimuth)
    notes.push('target station has no approximate coordinates; azimuth unavailable');
  if (mode === 'slope' && (!vertical || vertical.type !== 'zenith')) {
    notes.push('no zenith with slope distance; used slope as horizontal proxy');
  }

  rows.push({
    id: `${from}->${to}@${sourceLine ?? rows.length + 1}`,
    sourceLine,
    from,
    to,
    mode,
    sourceType: 'SS',
    hasAzimuth,
    azimuth,
    azimuthSource: hasExplicitAz
      ? 'explicit'
      : setupAzimuth != null
        ? 'setup'
        : hasTargetAz
          ? 'target'
          : undefined,
    sigmaAz: hasAzimuth ? sigmaAz : undefined,
    distance: obs.obs,
    horizDistance,
    deltaH,
    easting,
    northing,
    height,
    sigmaE,
    sigmaN,
    sigmaH,
    note: notes.length ? notes.join('; ') : undefined,
  });
});

context.observations.forEach((obs) => {
  if (!isGpsSideshot(obs)) return;
  const from = obs.from;
  const to = obs.to;
  const sourceLine = obs.sourceLine;
  const fromSt = context.stations[from];
  const corrected = context.gpsObservedVector(obs);
  const dE = corrected.dE;
  const dN = corrected.dN;
  const horizDistance = Math.sqrt(dE * dE + dN * dN);
  const hasAzimuth = horizDistance > 0;
  let azimuth: number | undefined;
  if (hasAzimuth) {
    azimuth = Math.atan2(dE, dN);
    if (azimuth < 0) azimuth += 2 * Math.PI;
  }
  const easting = fromSt ? fromSt.x + dE : undefined;
  const northing = fromSt ? fromSt.y + dN : undefined;
  const cov = context.gpsCovariance(obs);
  const sigmaE =
    fromSt && Number.isFinite(cov.cEE) ? Math.sqrt((fromSt.sE ?? 0) ** 2 + cov.cEE) : undefined;
  const sigmaN =
    fromSt && Number.isFinite(cov.cNN) ? Math.sqrt((fromSt.sN ?? 0) ** 2 + cov.cNN) : undefined;
  const notes: string[] = [];
  if (!fromSt) notes.push('occupy station not solved; sideshot coordinate unavailable');
  const offset = context.gpsRoverOffsetVector(obs);
  if (offset.applied) {
    notes.push(
      `rover offset dE=${offset.dE.toFixed(4)}m dN=${offset.dN.toFixed(4)}m dH=${offset.dH.toFixed(4)}m`,
    );
  }

  rows.push({
    id: `${from}->${to}@${sourceLine ?? rows.length + 1}:GPS`,
    sourceLine,
    from,
    to,
    mode: 'gps',
    sourceType: 'G',
    hasAzimuth,
    azimuth,
    azimuthSource: hasAzimuth ? 'vector' : undefined,
    distance: horizDistance,
    horizDistance,
    easting,
    northing,
    sigmaE,
    sigmaN,
    note: notes.length ? notes.join('; ') : undefined,
  });
});

(context.parseState?.gpsTopoShots ?? []).forEach((shot, idx) => {
  const sourceLine = shot.sourceLine;
  const relationFrom = shot.fromId?.trim() ? shot.fromId : undefined;
  const from = relationFrom ?? shot.pointId;
  const to = shot.pointId;
  const fromSt = relationFrom ? context.stations[relationFrom] : undefined;
  const baseSigmaE = shot.sigmaE;
  const baseSigmaN = shot.sigmaN;
  const baseSigmaH = shot.sigmaH;
  let hasAzimuth = false;
  let azimuth: number | undefined;
  let horizDistance = 0;
  let distance = 0;
  let deltaH: number | undefined;
  const notes: string[] = [];
  if (fromSt) {
    const dE = shot.east - fromSt.x;
    const dN = shot.north - fromSt.y;
    horizDistance = Math.hypot(dE, dN);
    distance = horizDistance;
    if (horizDistance > 1e-12) {
      let az = Math.atan2(dE, dN);
      if (az < 0) az += 2 * Math.PI;
      azimuth = context.modeledAzimuth(az, relationFrom);
      hasAzimuth = true;
    }
    if (shot.height != null) deltaH = shot.height - fromSt.h;
  } else if (relationFrom) {
    notes.push(`FROM=${relationFrom} not solved; relation unavailable`);
  } else {
    notes.push('standalone coordinate shot');
  }

  const sigmaE =
    baseSigmaE != null
      ? Math.sqrt((fromSt?.sE ?? 0) ** 2 + baseSigmaE ** 2)
      : fromSt
        ? fromSt.sE
        : undefined;
  const sigmaN =
    baseSigmaN != null
      ? Math.sqrt((fromSt?.sN ?? 0) ** 2 + baseSigmaN ** 2)
      : fromSt
        ? fromSt.sN
        : undefined;
  const sigmaH =
    shot.height != null
      ? baseSigmaH != null
        ? Math.sqrt((fromSt?.sH ?? 0) ** 2 + baseSigmaH ** 2)
        : fromSt
          ? fromSt.sH
          : undefined
      : undefined;

  rows.push({
    id: `${from}->${to}@${sourceLine ?? rows.length + idx + 1}:GS`,
    sourceLine,
    from,
    to,
    mode: 'gps',
    sourceType: 'GS',
    relationFrom,
    hasAzimuth,
    azimuth,
    azimuthSource: hasAzimuth ? 'coordinate' : undefined,
    distance,
    horizDistance,
    deltaH,
    easting: shot.east,
    northing: shot.north,
    height: shot.height,
    sigmaE,
    sigmaN,
    sigmaH,
    note: notes.length ? notes.join('; ') : undefined,
  });
});

return rows.sort((a, b) => {
  const la = a.sourceLine ?? Number.MAX_SAFE_INTEGER;
  const lb = b.sourceLine ?? Number.MAX_SAFE_INTEGER;
  if (la !== lb) return la - lb;
  return a.id.localeCompare(b.id);
});
};
