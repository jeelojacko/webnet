/**
 * Phase 14B: internal-reliability (MDB) policy.
 *
 * Pure module — no imports from the engine except the shared Acklam
 * normal quantile in localTestPolicy. All types are plain
 * JSON-serializable so the policy can travel through ParseOptions,
 * the worker protocol, and run-settings fingerprints unchanged.
 *
 * Two models (deliberately separate from LocalTestPolicy):
 * - 'legacy-3.29' (default): the historical MDB = 3.29 * s0 * sigma / sqrt(r)
 *   with the a-posteriori variance factor s0. Bit-identical to the
 *   pre-14B code path; old projects reproduce with zero migration.
 * - 'statistical': single-alternative Baarda MDB0 = delta0 * sigma / sqrt(r)
 *   with a-priori sigma (NO SEUW factor — pure a-priori per Teunissen),
 *   where delta0 = z(1-alpha/2) + z(power) is the normal-theory
 *   noncentrality for the given significance level and detection power.
 *
 * Scale break vs legacy: the statistical MDB intentionally omits the SEUW
 * multiplier, so legacy and statistical MDBs differ by delta0/(3.29*seuw).
 * With a seuw=1 run the ratio is exactly delta0/3.29.
 *
 * Multiple testing: the statistical MDB is the single-alternative Baarda
 * upper bound (Rofatto). No multiplicity correction is applied to the MDB
 * even when the local-test policy uses Bonferroni/Sidak — documented,
 * not corrected.
 */

import { LEGACY_LOCAL_TEST_CRITICAL, normalQuantile } from './localTestPolicy';

export type ReliabilityModel = 'legacy-3.29' | 'statistical';

/**
 * Method provenance per run:
 * - 'legacy-3.29': historical 3.29 scaling (legacy model, or fallback).
 * - 'exact-normal': Baarda w (or legacy-fixed formal) — the normal delta0
 *   is the exact single-alternative noncentrality.
 * - 'approximation-normal-for-tau': Pope tau — the exact test needs a
 *   noncentral-t noncentrality, so the normal delta0 is flagged approximate.
 */
export type ReliabilityMethod =
  | 'legacy-3.29'
  | 'exact-normal'
  | 'approximation-normal-for-tau';

export interface ReliabilityPolicy {
  model?: ReliabilityModel;
  /** Two-sided significance level for the statistical MDB; default 0.001. */
  alpha?: number;
  /** Detection power for the statistical MDB; default 0.8. */
  power?: number;
}

export interface ReliabilityDerivation {
  model: ReliabilityModel;
  alpha: number;
  power: number;
  delta0: number;
  lambda0: number;
  method: ReliabilityMethod;
  approximate: boolean;
  available: boolean;
  reason?: string;
}

export interface ReliabilitySummary extends ReliabilityDerivation {
  /** True when Huber reweighting froze the final weights (approximate). */
  robustApproximation: boolean;
}

export const DEFAULT_RELIABILITY_MODEL: ReliabilityModel = 'legacy-3.29';
export const DEFAULT_RELIABILITY_ALPHA = 0.001;
export const DEFAULT_RELIABILITY_POWER = 0.8;

/** Reference noncentralities: alpha=0.001/power=80% -> delta0=4.132 (lambda0=17.07). */
export const DEFAULT_RELIABILITY_POLICY: Required<ReliabilityPolicy> = {
  model: DEFAULT_RELIABILITY_MODEL,
  alpha: DEFAULT_RELIABILITY_ALPHA,
  power: DEFAULT_RELIABILITY_POWER,
};

export const normalizeReliabilityPolicy = (
  policy?: ReliabilityPolicy,
): Required<ReliabilityPolicy> => ({
  model: policy?.model ?? DEFAULT_RELIABILITY_MODEL,
  alpha: policy?.alpha ?? DEFAULT_RELIABILITY_ALPHA,
  power: policy?.power ?? DEFAULT_RELIABILITY_POWER,
});

const isValidAlpha = (alpha: number): boolean =>
  Number.isFinite(alpha) && alpha >= 1e-12 && alpha <= 0.5;

const isValidPower = (power: number): boolean =>
  Number.isFinite(power) && power > 0 && power < 1;

/**
 * Normal-theory noncentrality for the single-alternative Baarda MDB:
 * delta0 = z(1-alpha/2) + z(power), lambda0 = delta0^2.
 * Returns NaN parts for invalid input; never throws.
 */
export const solveNoncentrality = (
  alpha: number,
  power: number,
): { delta0: number; lambda0: number } => {
  if (!isValidAlpha(alpha) || !isValidPower(power)) {
    return { delta0: Number.NaN, lambda0: Number.NaN };
  }
  const delta0 = normalQuantile(1 - alpha / 2) + normalQuantile(power);
  if (!Number.isFinite(delta0)) return { delta0: Number.NaN, lambda0: Number.NaN };
  return { delta0, lambda0: delta0 * delta0 };
};

export interface DeriveReliabilityArgs {
  policy?: ReliabilityPolicy;
  /** Local-test statistic family driving provenance: w is exact, tau is approximate. */
  statisticFamily?: 'w' | 'tau';
  robustMode?: string;
}

/** Derive the run-level reliability summary; never throws. */
export const deriveReliability = (args: DeriveReliabilityArgs): ReliabilitySummary => {
  const normalized = normalizeReliabilityPolicy(args.policy);
  const robustApproximation = args.robustMode === 'huber';
  if (normalized.model === 'legacy-3.29') {
    return {
      model: 'legacy-3.29',
      alpha: normalized.alpha,
      power: normalized.power,
      delta0: LEGACY_LOCAL_TEST_CRITICAL,
      lambda0: LEGACY_LOCAL_TEST_CRITICAL * LEGACY_LOCAL_TEST_CRITICAL,
      method: 'legacy-3.29',
      approximate: false,
      available: true,
      robustApproximation,
    };
  }
  const clampNotes: string[] = [];
  let alpha = normalized.alpha;
  let power = normalized.power;
  if (!isValidAlpha(alpha)) {
    clampNotes.push(`alpha-clamped-${alpha}`);
    alpha = Math.min(Math.max(alpha, 1e-12), 0.5);
    if (!Number.isFinite(alpha)) alpha = DEFAULT_RELIABILITY_ALPHA;
  }
  if (!isValidPower(power)) {
    clampNotes.push(`power-clamped-${power}`);
    power = power <= 0 ? Number.MIN_VALUE : 1 - Number.EPSILON;
    if (!Number.isFinite(power)) power = DEFAULT_RELIABILITY_POWER;
  }
  const { delta0, lambda0 } = solveNoncentrality(alpha, power);
  if (!Number.isFinite(delta0)) {
    return {
      model: 'statistical',
      alpha,
      power,
      delta0: Number.POSITIVE_INFINITY,
      lambda0: Number.POSITIVE_INFINITY,
      method:
        args.statisticFamily === 'tau' ? 'approximation-normal-for-tau' : 'exact-normal',
      approximate: true,
      available: false,
      reason: 'noncentrality-not-finite',
      robustApproximation,
    };
  }
  const tauApproximation = args.statisticFamily === 'tau';
  const approximate = tauApproximation || robustApproximation;
  const reasons = [...clampNotes];
  if (tauApproximation) reasons.push('tau-needs-noncentral-t');
  if (robustApproximation) reasons.push('robust-frozen-weights');
  return {
    model: 'statistical',
    alpha,
    power,
    delta0,
    lambda0,
    method: tauApproximation ? 'approximation-normal-for-tau' : 'exact-normal',
    approximate,
    available: true,
    ...(reasons.length > 0 ? { reason: reasons.join(';') } : {}),
    robustApproximation,
  };
};

/**
 * Statistical (a-priori) MDB for one testable scalar equation:
 * MDB = delta0 * sigma / sqrt(r), with sigma = sqrt(qll) and NO SEUW factor.
 * Uses the same CLAMPED redundancy r as legacy for continuity.
 * Returns +Inf for r <= 1e-12 (untestable); never NaN, never throws.
 */
export const statisticalMdb = (
  qll: number,
  redundancyClamped: number,
  delta0: number,
): number => {
  if (!(qll > 0) || !Number.isFinite(delta0) || !(redundancyClamped > 1e-12)) {
    return Number.POSITIVE_INFINITY;
  }
  const sigma = Math.sqrt(qll);
  if (!Number.isFinite(sigma)) return Number.POSITIVE_INFINITY;
  return (delta0 * sigma) / Math.sqrt(redundancyClamped);
};

/**
 * Linear MDB in millimetres for angular observations:
 * mdbLinearMm = mdbRad * effectiveDistanceM * 1000.
 * Returns undefined when either input is not a finite positive value.
 */
export const mdbLinearMm = (
  mdbRad: number,
  effectiveDistanceM: number | undefined,
): number | undefined => {
  if (
    !Number.isFinite(mdbRad) ||
    effectiveDistanceM == null ||
    !Number.isFinite(effectiveDistanceM) ||
    effectiveDistanceM <= 0
  ) {
    return undefined;
  }
  return mdbRad * effectiveDistanceM * 1000;
};

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

/**
 * Sanitize a persisted/foreign reliability policy. Returns undefined when the
 * value is absent (legacy projects predate the field and load as legacy) or
 * unusable; never throws.
 */
export const sanitizeReliabilityPolicy = (
  value: unknown,
): ReliabilityPolicy | undefined => {
  if (value == null) return undefined;
  if (!isRecord(value)) return undefined;
  const { model, alpha, power } = value;
  if (model !== 'legacy-3.29' && model !== 'statistical' && model !== undefined) {
    return undefined;
  }
  const policy: ReliabilityPolicy = {};
  if (model !== undefined) policy.model = model;
  if (typeof alpha === 'number' && isValidAlpha(alpha)) policy.alpha = alpha;
  else if (alpha !== undefined) return undefined;
  if (typeof power === 'number' && isValidPower(power)) policy.power = power;
  else if (power !== undefined) return undefined;
  return policy;
};

/** Normalized structural equality (defaults filled) for stale-run comparison. */
export const reliabilityPoliciesEqual = (
  a: ReliabilityPolicy | undefined,
  b: ReliabilityPolicy | undefined,
): boolean => {
  const na = normalizeReliabilityPolicy(a);
  const nb = normalizeReliabilityPolicy(b);
  return na.model === nb.model && na.alpha === nb.alpha && na.power === nb.power;
};

/** Short model label for reports, exports, and stale-run diffs. */
export const formatReliabilityModelLabel = (model: ReliabilityModel): string => {
  if (model === 'statistical') return 'Statistical MDB';
  return 'Legacy MDB (3.29)';
};

/** One-line policy description, e.g. for text exports and stale-run diffs. */
export const formatReliabilityPolicyLine = (policy?: ReliabilityPolicy): string => {
  const normalized = normalizeReliabilityPolicy(policy);
  if (normalized.model === 'legacy-3.29') {
    return `Legacy MDB (3.29)`;
  }
  return `Statistical MDB, alpha=${normalized.alpha}, power=${normalized.power}`;
};
