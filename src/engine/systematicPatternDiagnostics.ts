import type { Observation } from '../types';
import type { SystematicDiagnostics, SystematicDiagnosticsInput } from './systematicPatternTypes';
import { buildDistanceTrend, buildSetupFamilies, insufficientTrend, setupFamilyDisplayUnit } from './systematicPatternSetupDistance';
import { buildFaceBalance, buildRepeatSameSign, buildZenithPatterns } from './systematicPatternDirectionZenith';
import { buildGnssPatterns, buildLevelingPatterns, buildSignRuns } from './systematicPatternLevelGnssSign';

export type {
  SystematicDiagnostics,
  SystematicDiagnosticsInput,
  SystematicDistanceTrend,
  SystematicFaceBalance,
  SystematicGnssPatterns,
  SystematicLevelingPatterns,
  SystematicRepeatSameSign,
  SystematicSetupFamily,
  SystematicSignRun,
  SystematicStatus,
  SystematicZenithPatterns,
} from './systematicPatternTypes';
export { setupFamilyDisplayUnit };

const unavailable = (reason: string): SystematicDiagnostics => ({
  available: false,
  unavailableReason: reason,
  setupFamilies: [],
  distanceTrend: insufficientTrend(0, null, null, null, reason),
  directionFaceBalance: {
    balancedTargets: 0, unbalancedTargets: 0, unpairedTargets: 0,
    largestFacePairDeltaArcSec: null,
    status: 'unavailable', reason,
  },
  directionRepeatSameSign: [],
  zenithPatterns: {
    count: 0, slopeVsDistanceArcSecPerKm: null, posCount: 0, negCount: 0,
    status: 'unavailable', reason,
  },
  levelingPatterns: {
    orderedBy: 'input-sequence', count: 0, cumulativeKm: null, driftMmPerKm: null,
    posCount: 0, negCount: 0, longestPos: 0, longestNeg: 0, signChanges: 0,
    status: 'unavailable', reason,
  },
  gnssPatterns: {
    count: 0, meanEMm: null, meanNMm: null, meanUMm: null,
    rmsEMm: null, rmsNMm: null, rmsUMm: null, status: 'unavailable', reason,
  },
  signRuns: [],
  warnings: [],
});

/**
 * Descriptive-only systematic pattern diagnostics. No p-values, no formal
 * tests, no causal labels — values describe residual association only and
 * never identify a cause. Per-set direction means are orientation-absorbed
 * and reported as such. Count/span/collinearity gates are descriptive
 * product coverage guards, not calibrated test thresholds.
 */
export const buildSystematicDiagnostics = (
  activeObservations: Observation[],
  input: SystematicDiagnosticsInput = {},
): SystematicDiagnostics | undefined => {
  if (input.isPreanalysis) {
    return unavailable('no residuals exist in preanalysis mode');
  }
  if (input.isDataCheck) {
    return unavailable('no formal residual tests in data-check mode');
  }
  const setDiags = input.directionSetDiagnostics ?? [];
  const repeatDiags = input.directionRepeatabilityDiagnostics ?? [];
  const worstSet = [...setDiags].sort(
    (a, b) => (b.residualRmsArcSec ?? 0) - (a.residualRmsArcSec ?? 0),
  )[0];
  const worstRepeat = [...repeatDiags].sort((a, b) => b.setCount - a.setCount)[0];
  const warnings: string[] = [];
  if (input.tsCorrelated) {
    warnings.push('observations correlated where applicable; patterns may reflect correlation');
  }
  let robustNote: string | undefined;
  if (input.isRobust) {
    robustNote =
      `robust mode (${input.robustMode ?? 'robust'}): these descriptors add no ` +
      'formal pattern tests and use final robust-fit residuals (descriptive only)';
    warnings.push(
      'robust reweighting active: pattern descriptors use final robust-fit residuals, descriptive only',
    );
  }
  let freeNetworkNote: string | undefined;
  if (input.freeNetwork) {
    freeNetworkNote =
      'free-network datum: observation residual descriptors are datum/gauge invariant; ' +
      'no datum-related pattern warning applies';
    warnings.push(
      'free-network datum: observation residual descriptors are datum/gauge invariant',
    );
  }
  return {
    available: true,
    setupFamilies: buildSetupFamilies(activeObservations),
    distanceTrend: buildDistanceTrend(activeObservations),
    worstDirectionSet: worstSet
      ? {
          setId: worstSet.setId,
          occupy: worstSet.occupy,
          residualRmsArcSec: worstSet.residualRmsArcSec,
        }
      : undefined,
    worstDirectionRepeat: worstRepeat
      ? { occupy: worstRepeat.occupy, target: worstRepeat.target, setCount: worstRepeat.setCount }
      : undefined,
    directionFaceBalance: buildFaceBalance(input.directionTargetDiagnostics),
    directionRepeatSameSign: buildRepeatSameSign(activeObservations),
    zenithPatterns: buildZenithPatterns(activeObservations),
    levelingPatterns: buildLevelingPatterns(activeObservations),
    gnssPatterns: buildGnssPatterns(activeObservations),
    signRuns: buildSignRuns(activeObservations),
    warnings,
    robustNote,
    freeNetworkNote,
  };
};
