import { olsTrend, residualSign } from './systematicPatternTrends';
import type { AdjustmentResult, Observation, StationId } from '../types';
import type {
  SystematicFaceBalance,
  SystematicRepeatSameSign,
  SystematicZenithPatterns,
} from './systematicPatternTypes';
import {
  ARCSEC_PER_RAD,
  MAX_TREND_COLLINEARITY,
  MIN_FAMILY_MEAN_COUNT,
  MIN_REPEAT_SETS,
  MIN_TREND_COUNT,
  scalarResidual,
} from './systematicPatternShared';

export const buildFaceBalance = (
  targets: AdjustmentResult['directionTargetDiagnostics'],
): SystematicFaceBalance => {
  if (!targets || targets.length === 0) {
    return {
      balancedTargets: 0, unpairedTargets: 0, unbalancedTargets: 0,
      largestFacePairDeltaArcSec: null,
      status: 'insufficient-data', reason: 'no direction targets available',
    };
  }
  let balanced = 0;
  let unbalanced = 0;
  let unpaired = 0;
  let largest: number | null = null;
  let largestSetId: string | undefined;
  let largestTarget: StationId | undefined;
  targets.forEach((t) => {
    // A set-target row missing either face count is unpaired: face-count
    // balance not assessable, never balanced or unbalanced.
    if (!(t.face1Count > 0) || !(t.face2Count > 0)) {
      unpaired += 1;
    } else if (t.faceBalanced) balanced += 1;
    else unbalanced += 1;
    // Largest absolute raw metadata value only; the stored value is reported as-is.
    if (t.facePairDeltaArcSec != null && Number.isFinite(t.facePairDeltaArcSec)) {
      if (largest == null || Math.abs(t.facePairDeltaArcSec) > Math.abs(largest)) {
        largest = t.facePairDeltaArcSec;
        largestSetId = t.setId;
        largestTarget = t.target;
      }
    }
  });
  return {
    balancedTargets: balanced,
    unbalancedTargets: unbalanced,
    unpairedTargets: unpaired,
    largestFacePairDeltaArcSec: largest,
    largestFacePairSetId: largestSetId,
    largestFacePairTarget: largestTarget,
    status: 'descriptive',
  };
};

export const buildRepeatSameSign = (active: Observation[]): SystematicRepeatSameSign[] => {
  const groups = new Map<string, { occupy: StationId; target: StationId; signs: number[] }>();
  active.forEach((obs) => {
    if (obs.type !== 'direction') return;
    const r = scalarResidual(obs);
    if (r == null) return;
    const key = `${obs.at}>>${obs.to}`;
    const entry = groups.get(key) ?? { occupy: obs.at, target: obs.to, signs: [] };
    entry.signs.push(residualSign(r));
    groups.set(key, entry);
  });
  return Array.from(groups.values())
    .map(({ occupy, target, signs }) => {
      const setCount = signs.length;
      if (setCount < MIN_REPEAT_SETS) {
        return {
          occupy, target, setCount, sameSignCount: 0,
          dominantSign: 'mixed' as const, status: 'insufficient-data' as const,
        };
      }
      const pos = signs.filter((s) => s > 0).length;
      const neg = signs.filter((s) => s < 0).length;
      const sameSignCount = Math.max(pos, neg);
      const dominantSign = pos > neg ? 'pos' : neg > pos ? 'neg' : 'mixed';
      return {
        occupy, target, setCount, sameSignCount,
        dominantSign: dominantSign as 'pos' | 'neg' | 'mixed',
        status: 'descriptive' as const,
      };
    })
    .sort((a, b) => a.occupy.localeCompare(b.occupy) || a.target.localeCompare(b.target));
};

const zenithDistOf = (obs: Observation & { type: 'zenith' }): number | null => {
  if (typeof obs.effectiveDistance === 'number' && Number.isFinite(obs.effectiveDistance)) {
    return obs.effectiveDistance;
  }
  return null;
};

export const buildZenithPatterns = (active: Observation[]): SystematicZenithPatterns => {
  const obs = active.filter((o) => o.type === 'zenith');
  const res = obs
    .map((o) => ({ o: o as Observation & { type: 'zenith' }, r: scalarResidual(o) }))
    .filter((row): row is { o: Observation & { type: 'zenith' }; r: number } => row.r != null);
  const count = res.length;
  if (count < MIN_FAMILY_MEAN_COUNT) {
    return {
      count, slopeVsDistanceArcSecPerKm: null, posCount: 0, negCount: 0,
      status: 'insufficient-data', reason: 'needs at least 2 zenith residuals',
    };
  }
  const posCount = res.filter((row) => residualSign(row.r) > 0).length;
  const negCount = res.filter((row) => residualSign(row.r) < 0).length;
  const withDist = res.filter((row) => {
    const d = zenithDistOf(row.o);
    return d != null && d > 0;
  });
  // Generic label only: 'Zenith residual vs distance'. Never refraction/collimation.
  let slope: number | null = null;
  if (withDist.length >= MIN_TREND_COUNT) {
    const fit = olsTrend(
      withDist.map((row) => (zenithDistOf(row.o) as number) / 1000),
      withDist.map((row) => row.r * ARCSEC_PER_RAD),
    );
    if (fit && Math.abs(fit.designCollinearity) < MAX_TREND_COLLINEARITY) slope = fit.slope;
  }
  return { count, slopeVsDistanceArcSecPerKm: slope, posCount, negCount, status: 'descriptive' };
};
