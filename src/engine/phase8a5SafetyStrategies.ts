/**
 * Phase 8A.5 preanalysis safety strategies P0-P4 (TEST/EVIDENCE ONLY).
 *
 * Pure evaluators over direct-TypeScript outcomes plus optional
 * actual-worker evidence. Nothing here touches production routing,
 * tolerances, or the engine; thresholds mirror existing production
 * constants without changing them.
 *
 * - P0 static: existing Phase 8A eligibility (dimension/robust/correlation/
 *   GPS-covariance gates plus the unknown-count cap).
 * - P1 condition: P0 plus a finite condition estimate at or below the
 *   production warn threshold (warn-only in production; hard gate here so
 *   calibration can count false admits/rejects explicitly).
 * - P2 correction diagnostic: requires per-system dense-oracle evidence
 *   (max correction agreement within tolerance, undamped, finite
 *   condition); cases without worker oracles fail closed as unevaluated.
 * - P3 covariance sentinel: physical validity plus the TEST-ONLY
 *   dense-vs-sparse sentinel. The sentinel reuses the existing result
 *   contract (`comparePreanalysisContract` covariance maxima), NOT a true
 *   captured-covariance comparison: a real selected-vs-dense covariance
 *   capture would be invasive to the production engine, so this limitation
 *   is explicit and carried into the reports.
 * - P4 combined: P1 and P3 must both admit.
 *
 * Ground truth for false admit/reject accounting is the user-visible final
 * contract: worker cases use `comparePreanalysisContract` pass/fail;
 * direct-only cases use self-consistency (success, iterations 1, seuw 1,
 * physical validity). A strategy admits when its gate passes; a false
 * admit is admit-while-untrue, a false reject is reject-while-true.
 */
import type { AdjustmentResult } from '../typesAdjustmentResult';
import { SPARSE_CONDITION_THRESHOLD } from './sparseNormalCondition';

export const PHASE8A5_CONDITION_THRESHOLD = SPARSE_CONDITION_THRESHOLD;

/** Absolute tolerance for per-system correction-oracle agreement. */
export const PHASE8A5_CORRECTION_TOLERANCE = 1e-9;

/** Relative tolerance for the dense-vs-sparse covariance sentinel. */
export const PHASE8A5_SENTINEL_RELATIVE_TOLERANCE = 1e-6;

export type Phase8a5StrategyId = 'P0' | 'P1' | 'P2' | 'P3' | 'P4';

export interface Phase8a5StrategyResult {
  id: Phase8a5StrategyId;
  admit: boolean;
  reasons: string[];
}

export interface Phase8a5CorrectionEvidence {
  available: boolean;
  maxCorrectionDiff: number | null;
  damping: number | null;
  conditionEstimate: number | undefined;
}

export interface Phase8a5SentinelEvidence {
  available: boolean;
  maxCovarianceRelativeDiff: number | null;
  maxRelativeCovarianceRelativeDiff: number | null;
  maxRelativePrecisionRelativeDiff: number | null;
  sentinelPass: boolean;
  sentinelReasons: string[];
}

/** Physical-validity check over final covariance/precision blocks. */
export const validateCovariancePhysical = (
  result: AdjustmentResult,
): { valid: boolean; reasons: string[] } => {
  const reasons: string[] = [];
  const fail = (reason: string): void => {
    if (reasons.length < 8) reasons.push(reason);
  };
  for (const row of result.stationCovariances ?? []) {
    for (const key of ['sigmaE', 'sigmaN'] as const) {
      const value = row[key];
      if (value == null) {
        fail(`stationCovariances[${row.stationId}].${key}: missing`);
      } else if (!Number.isFinite(value) || value <= 0) {
        fail(`stationCovariances[${row.stationId}].${key}: non-physical (${value})`);
      }
    }
    const sigmaH = row.sigmaH;
    if (sigmaH != null && (!Number.isFinite(sigmaH) || sigmaH <= 0)) {
      fail(`stationCovariances[${row.stationId}].sigmaH: non-physical (${sigmaH})`);
    }
  }
  for (const row of result.relativePrecision ?? []) {
    for (const key of ['sigmaN', 'sigmaE', 'sigmaDist'] as const) {
      const value = row[key];
      if (value == null) continue;
      if (!Number.isFinite(value) || value < 0) {
        fail(`relativePrecision[${row.from}-${row.to}].${key}: non-physical (${value})`);
      }
    }
  }
  for (const row of result.relativeCovariances ?? []) {
    for (const key of ['cEE', 'cEN', 'cNN', 'sigmaE', 'sigmaN'] as const) {
      const value = row[key];
      if (value == null) continue;
      if (!Number.isFinite(value)) {
        fail(`relativeCovariances[${row.from}-${row.to}].${key}: non-finite`);
      }
    }
  }
  return { valid: reasons.length === 0, reasons };
};

/** Builds sentinel evidence from contract covariance maxima. */
export const buildSentinelEvidence = (args: {
  available: boolean;
  comparison: {
    maxCovarianceRelativeDiff: number;
    maxRelativeCovarianceRelativeDiff: number;
    maxRelativePrecisionRelativeDiff: number;
  } | null;
}): Phase8a5SentinelEvidence => {
  if (!args.available || !args.comparison) {
    return {
      available: false,
      maxCovarianceRelativeDiff: null,
      maxRelativeCovarianceRelativeDiff: null,
      maxRelativePrecisionRelativeDiff: null,
      sentinelPass: false,
      sentinelReasons: ['no dense-vs-sparse sentinel evidence (fail-closed)'],
    };
  }
  const reasons: string[] = [];
  const check = (label: string, value: number): void => {
    if (!Number.isFinite(value)) {
      reasons.push(`${label}: non-finite (fail-closed)`);
    } else if (value > PHASE8A5_SENTINEL_RELATIVE_TOLERANCE) {
      reasons.push(`${label}: ${value.toExponential(2)} exceeds ${PHASE8A5_SENTINEL_RELATIVE_TOLERANCE}`);
    }
  };
  check('stationCovariance', args.comparison.maxCovarianceRelativeDiff);
  check('relativeCovariance', args.comparison.maxRelativeCovarianceRelativeDiff);
  check('relativePrecision', args.comparison.maxRelativePrecisionRelativeDiff);
  return {
    available: true,
    maxCovarianceRelativeDiff: args.comparison.maxCovarianceRelativeDiff,
    maxRelativeCovarianceRelativeDiff: args.comparison.maxRelativeCovarianceRelativeDiff,
    maxRelativePrecisionRelativeDiff: args.comparison.maxRelativePrecisionRelativeDiff,
    sentinelPass: reasons.length === 0,
    sentinelReasons: reasons,
  };
};

const checkCorrectionEvidence = (
  oracles: Phase8a5CorrectionEvidence[],
): { pass: boolean; reasons: string[] } => {
  if (oracles.length === 0) {
    return { pass: false, reasons: ['no correction systems captured (fail-closed)'] };
  }
  const reasons: string[] = [];
  oracles.forEach((oracle, index) => {
    const tag = `system ${index + 1}`;
    if (!oracle.available) {
      reasons.push(`${tag}: no oracle evidence (fail-closed)`);
      return;
    }
    if (oracle.maxCorrectionDiff == null || !Number.isFinite(oracle.maxCorrectionDiff)) {
      reasons.push(`${tag}: non-finite correction agreement (fail-closed)`);
    } else if (oracle.maxCorrectionDiff > PHASE8A5_CORRECTION_TOLERANCE) {
      reasons.push(
        `${tag}: correction diff ${oracle.maxCorrectionDiff.toExponential(2)} exceeds ${PHASE8A5_CORRECTION_TOLERANCE}`,
      );
    }
    if (!Number.isFinite(oracle.damping ?? Number.NaN) || oracle.damping !== 0) {
      reasons.push(`${tag}: damping=${oracle.damping} (undamped required)`);
    }
    if (oracle.conditionEstimate == null || !Number.isFinite(oracle.conditionEstimate)) {
      reasons.push(`${tag}: no finite condition estimate (fail-closed)`);
    }
  });
  return { pass: reasons.length === 0, reasons };
};

/**
 * Evaluates the P0-P4 ladder for one corpus case. All inputs are plain
 * evidence snapshots; evaluation is deterministic and side-effect free.
 */
export const evaluatePhase8a5Strategies = (args: {
  staticAdmit: boolean;
  staticReasons: string[];
  conditionEstimate: number | undefined;
  conditionThreshold?: number;
  correctionOracles: Phase8a5CorrectionEvidence[];
  physicalValid: boolean;
  physicalReasons: string[];
  sentinel: Phase8a5SentinelEvidence;
  groundTruth: boolean;
  groundTruthNote: string;
}): { strategies: Phase8a5StrategyResult[]; falseAdmits: Phase8a5StrategyId[]; falseRejects: Phase8a5StrategyId[] } => {
  const threshold = args.conditionThreshold ?? PHASE8A5_CONDITION_THRESHOLD;
  const p0Reasons = args.staticAdmit ? [] : [...args.staticReasons];
  const p1Reasons = [...p0Reasons];
  if (args.conditionEstimate == null || !Number.isFinite(args.conditionEstimate)) {
    p1Reasons.push('no finite condition estimate (fail-closed)');
  } else if (args.conditionEstimate > threshold) {
    p1Reasons.push(
      `condition ${args.conditionEstimate.toExponential(3)} exceeds ${threshold.toExponential(3)}`,
    );
  }
  const correction = checkCorrectionEvidence(args.correctionOracles);
  const p2Reasons = [...p0Reasons, ...correction.reasons];
  const p3Reasons = [...p0Reasons];
  if (!args.physicalValid) p3Reasons.push(...args.physicalReasons);
  if (!args.sentinel.available) {
    p3Reasons.push(...args.sentinel.sentinelReasons);
  } else if (!args.sentinel.sentinelPass) {
    p3Reasons.push(...args.sentinel.sentinelReasons);
  }
  const p4Reasons = [...p1Reasons];
  if (!args.physicalValid) p4Reasons.push(...args.physicalReasons);
  if (!args.sentinel.available || !args.sentinel.sentinelPass) {
    p4Reasons.push(...args.sentinel.sentinelReasons);
  }
  const strategies: Phase8a5StrategyResult[] = [
    { id: 'P0', admit: p0Reasons.length === 0, reasons: p0Reasons },
    { id: 'P1', admit: p1Reasons.length === 0, reasons: p1Reasons },
    { id: 'P2', admit: p2Reasons.length === 0, reasons: p2Reasons },
    { id: 'P3', admit: p3Reasons.length === 0, reasons: p3Reasons },
    { id: 'P4', admit: p4Reasons.length === 0, reasons: p4Reasons },
  ];
  const falseAdmits: Phase8a5StrategyId[] = [];
  const falseRejects: Phase8a5StrategyId[] = [];
  for (const strategy of strategies) {
    if (strategy.admit && !args.groundTruth) falseAdmits.push(strategy.id);
    if (!strategy.admit && args.groundTruth) falseRejects.push(strategy.id);
  }
  return { strategies, falseAdmits, falseRejects };
};
