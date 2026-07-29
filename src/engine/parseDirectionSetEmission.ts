import type { Observation, SigmaSource, StationId } from '../types';
import type { DirectionFace, RawDirectionShot } from './parseDirectionSetWorkflow';

export const wrapToPi = (val: number): number => {
  let out = val;
  while (out <= -Math.PI) out += 2 * Math.PI;
  while (out > Math.PI) out -= 2 * Math.PI;
  return out;
};

export const wrapTo2Pi = (val: number): number => {
  let out = val % (2 * Math.PI);
  if (out < 0) out += 2 * Math.PI;
  return out;
};

export const weightedCircularMean = (values: number[], weights?: number[]): number => {
  if (values.length === 0) return 0;
  let sumSin = 0;
  let sumCos = 0;
  for (let i = 0; i < values.length; i += 1) {
    const w = weights?.[i] ?? 1;
    sumSin += Math.sin(values[i]) * w;
    sumCos += Math.cos(values[i]) * w;
  }
  if (Math.abs(sumSin) < 1e-15 && Math.abs(sumCos) < 1e-15) {
    return wrapTo2Pi(values[0] ?? 0);
  }
  return wrapTo2Pi(Math.atan2(sumSin, sumCos));
};

export const weightedCircularSpread = (
  values: number[],
  mean: number,
  weights?: number[],
): number => {
  if (values.length === 0) return 0;
  let weightSum = 0;
  let accum = 0;
  for (let i = 0; i < values.length; i += 1) {
    const w = weights?.[i] ?? 1;
    const residual = wrapToPi(values[i] - mean);
    accum += w * residual * residual;
    weightSum += w;
  }
  return weightSum > 0 ? Math.sqrt(accum / weightSum) : 0;
};

export interface DirectionBucketEmissionStats {
  reducedCount: number;
  pairedTargets: number;
  face1Total: number;
  face2Total: number;
}

interface DirectionBucketEmissionOptions {
  bucketSetId: string;
  occupy: StationId;
  instCode: string;
  shots: RawDirectionShot[];
  normalizeFace2: boolean;
  obsIdRef: { current: number };
  pushObservation: (_observation: Observation) => void;
}

const combineSigmaSources = (shots: RawDirectionShot[]): SigmaSource => {
  const sources = shots.map((shot) => shot.sigmaSource);
  if (!sources.length) return 'default';
  if (sources.some((source) => source === 'fixed')) return 'fixed';
  if (sources.every((source) => source === 'float')) return 'float';
  if (sources.every((source) => source === 'default')) return 'default';
  return 'explicit';
};

export const reduceDirectionBucket = ({
  bucketSetId,
  occupy,
  instCode,
  shots,
  normalizeFace2,
  obsIdRef,
  pushObservation,
}: DirectionBucketEmissionOptions): DirectionBucketEmissionStats => {
  const byTarget = new Map<StationId, RawDirectionShot[]>();
  shots.forEach((shot) => {
    const list = byTarget.get(shot.to) ?? [];
    list.push(shot);
    byTarget.set(shot.to, list);
  });

  let reducedCount = 0;
  let pairedTargets = 0;
  let face1Total = 0;
  let face2Total = 0;

  const targets = [...byTarget.keys()].sort((a, b) => a.localeCompare(b));
  targets.forEach((to) => {
    const targetShots = byTarget.get(to) ?? [];
    if (!targetShots.length) return;
    const face1Count = targetShots.filter((shot) => shot.face === 'face1').length;
    const face2Count = targetShots.length - face1Count;
    face1Total += face1Count;
    face2Total += face2Count;
    if (face1Count > 0 && face2Count > 0) pairedTargets += 1;

    const normalized = targetShots.map((shot) => {
      const obs =
        normalizeFace2 && shot.face === 'face2' && !shot.isOrientationReference
          ? wrapTo2Pi(shot.obs - Math.PI)
          : wrapTo2Pi(shot.obs);
      const weight = 1 / Math.max(shot.stdDev * shot.stdDev, 1e-24);
      return { ...shot, normalizedObs: obs, weight };
    });
    const obsValues = normalized.map((shot) => shot.normalizedObs);
    const obsWeights = normalized.map((shot) => shot.weight);
    const reducedObs = weightedCircularMean(obsValues, obsWeights);
    const sumW = obsWeights.reduce((acc, weight) => acc + weight, 0);
    const reducedSigma = sumW > 0 ? Math.sqrt(1 / sumW) : normalized[0].stdDev;
    const residuals = normalized.map((shot) => wrapToPi(shot.normalizedObs - reducedObs));
    const spread = weightedCircularSpread(obsValues, reducedObs, obsWeights);
    const rawMaxResidual = residuals.length ? Math.max(...residuals.map((r) => Math.abs(r))) : 0;
    const face1Stats = faceStats(normalized, 'face1');
    const face2Stats = faceStats(normalized, 'face2');
    const facePairDelta =
      face1Stats.mean != null && face2Stats.mean != null
        ? Math.abs(wrapToPi(face1Stats.mean - face2Stats.mean))
        : undefined;

    pushObservation({
      id: obsIdRef.current++,
      type: 'direction',
      instCode,
      setId: bucketSetId,
      at: occupy,
      to,
      obs: reducedObs,
      planned: targetShots.some((shot) => shot.planned === true),
      stdDev: reducedSigma,
      sigmaSource: combineSigmaSources(targetShots),
      sourceLine: Math.min(...targetShots.map((shot) => shot.sourceLine)),
      rawCount: targetShots.length,
      rawFace1Count: face1Count,
      rawFace2Count: face2Count,
      rawSpread: spread,
      rawMaxResidual,
      facePairDelta,
      face1Spread: face1Stats.spread,
      face2Spread: face2Stats.spread,
      reducedSigma,
    });
    reducedCount += 1;
  });

  return { reducedCount, pairedTargets, face1Total, face2Total };
};

type NormalizedDirectionShot = RawDirectionShot & { normalizedObs: number; weight: number };

const faceStats = (
  normalized: NormalizedDirectionShot[],
  face: DirectionFace,
): { mean?: number; spread?: number } => {
  const faceShots = normalized.filter((shot) => shot.face === face);
  if (!faceShots.length) return {};
  const faceObs = faceShots.map((shot) => shot.normalizedObs);
  const faceWeights = faceShots.map((shot) => shot.weight);
  const mean = weightedCircularMean(faceObs, faceWeights);
  const faceSpread = weightedCircularSpread(faceObs, mean, faceWeights);
  return { mean, spread: faceSpread };
};

export const pushRawDirectionBucket = ({
  bucketSetId,
  occupy,
  instCode,
  shots,
  normalizeFace2,
  obsIdRef,
  pushObservation,
}: DirectionBucketEmissionOptions): DirectionBucketEmissionStats => {
  const byTargetFaceCounts = new Map<StationId, { face1: number; face2: number }>();
  let face1Total = 0;
  let face2Total = 0;

  shots.forEach((shot) => {
    const obs =
      normalizeFace2 && shot.face === 'face2' && !shot.isOrientationReference
        ? wrapTo2Pi(shot.obs - Math.PI)
        : wrapTo2Pi(shot.obs);
    pushObservation({
      id: obsIdRef.current++,
      type: 'direction',
      instCode,
      setId: bucketSetId,
      at: occupy,
      to: shot.to,
      obs,
      planned: shot.planned === true,
      stdDev: shot.stdDev,
      sigmaSource: shot.sigmaSource,
      sourceLine: shot.sourceLine,
      rawCount: 1,
      rawFace1Count: shot.face === 'face1' ? 1 : 0,
      rawFace2Count: shot.face === 'face2' ? 1 : 0,
      rawSpread: 0,
      rawMaxResidual: 0,
      reducedSigma: shot.stdDev,
    });
    const entry = byTargetFaceCounts.get(shot.to) ?? { face1: 0, face2: 0 };
    if (shot.face === 'face1') {
      entry.face1 += 1;
      face1Total += 1;
    } else {
      entry.face2 += 1;
      face2Total += 1;
    }
    byTargetFaceCounts.set(shot.to, entry);
  });

  const pairedTargets = [...byTargetFaceCounts.values()].filter(
    (entry) => entry.face1 > 0 && entry.face2 > 0,
  ).length;
  return {
    reducedCount: shots.length,
    pairedTargets,
    face1Total,
    face2Total,
  };
};
