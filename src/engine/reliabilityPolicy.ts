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
 *   with the a-posteriori variance factor s0 and the clamped diagonal
 *   redundancy r = qvv_clamped/qll. Bit-identical to the pre-14B code
 *   path; old projects reproduce with zero migration.
 * - 'statistical': single-alternative Baarda MDB0 = delta0 * sqrt(qvv_ii) / |R_ii|
 *   with a-priori cofactor qvv_ii (NO SEUW factor — pure a-priori per
 *   Teunissen), where delta0 = z(1-alpha/2) + z(power) is the two-sided
 *   normal-approximation noncentrality for the given significance level
 *   and nominal detection power (exact only for the w-test construction),
 *   and R_ii = (Qvv P)_ii = 1 - (A Qxx A' P)_ii is the correlated
 *   scalar-residual sensitivity over the TRUE weight-matrix column
 *   (diagonal P recovers R_ii = r, so the diagonal case is unchanged).
 *
 * Scale break vs legacy: the statistical MDB intentionally omits the SEUW
 * multiplier. On diagonal-P runs legacy and statistical MDBs differ by
 * delta0/(3.29*seuw) (exactly delta0/3.29 at seuw=1); correlated blocks
 * use the full-column sensitivity instead, so no single ratio holds there.
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
 * - 'exact-normal': Baarda w only — the normal delta0 is the exact
 *   single-alternative noncentrality. (Legacy-fixed local mode reports the
 *   tau family, so statistical reliability paired with it classifies as
 *   the tau approximation below.)
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
  Number.isFinite(power) && power >= 0.5 && power < 1;

/**
 * Normal-theory noncentrality for the single-alternative Baarda MDB:
 * delta0 = z(1-alpha/2) + z(power), lambda0 = delta0^2.
 * Two-sided normal approximation: exact for the Baarda w-test
 * noncentrality construction (sigma0 known), approximate for Pope tau
 * (flagged separately) and never a finite-sample detection probability.
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
  const alpha = normalized.alpha;
  const power = normalized.power;
  // Fail closed: out-of-range alpha/power (alpha outside finite
  // [1e-12, 0.5], power outside finite [0.5, 1)) yields
  // available=false. Invalid direct policies are never clamped into
  // range (no MIN_VALUE/EPSILON coercion); delta0/lambda0 report +Inf
  // so downstream MDBs are untestable rather than silently rescaled.
  if (!isValidAlpha(alpha) || !isValidPower(power)) {
    const reasons: string[] = [];
    if (!isValidAlpha(alpha)) reasons.push(`invalid-alpha-${alpha}`);
    if (!isValidPower(power)) reasons.push(`invalid-power-${power}`);
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
      reason: reasons.join(';'),
      robustApproximation,
    };
  }
  const { delta0, lambda0 } = solveNoncentrality(alpha, power);
  if (!Number.isFinite(delta0) || !(delta0 > 0)) {
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
  const reasons: string[] = [];
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
 * Unclamped sensitivity/testability floor shared by the statistical MDB
 * and external-reliability gating: sensitivities at or below this (or
 * non-finite) mean the scalar residual carries no detectable signal.
 */
export const STATISTICAL_SENSITIVITY_FLOOR = 1e-12;

/** True when the correlated sensitivity carries a detectable signal. */
export const isTestableSensitivity = (sensitivity: number): boolean =>
  Number.isFinite(sensitivity) && Math.abs(sensitivity) > STATISTICAL_SENSITIVITY_FLOOR;

/**
 * Correlated scalar-residual sensitivity R_ii = (Qvv P)_ii for one scalar
 * equation, evaluated as 1 - (A Qxx A' P)_ii over the TRUE weight-matrix
 * column: R = 1 - sum_{l in group} (a_i Qxx a_l') P[l][i].
 *
 * The cross-form provider returns (a_row Qxx a_col') — dense callers pass
 * B[row].a_col dots, sparse row-product callers pass crossFor (falling
 * back to the quadratic for the diagonal). Only rows coupled through P
 * (TS-correlation groups, GPS covariance blocks) contribute; everywhere
 * else P[l][i] is exactly 0. Diagonal P recovers R_ii = r_ii.
 *
 * Returns NaN when a coupled cross form or weight is missing (fail
 * closed: the MDB helper maps that to +Inf); never throws.
 */
export const statisticalSensitivity = (
  row: number,
  groupRows: number[],
  crossAqxxat: (_rowA: number, _rowB: number) => number | undefined,
  weightAt: (_coupledRow: number, _row: number) => number,
): number => {
  let coupled = 0;
  for (const coupledRow of groupRows) {
    const aqxxat = crossAqxxat(row, coupledRow);
    const weight = weightAt(coupledRow, row);
    if (aqxxat == null || !Number.isFinite(aqxxat)) return Number.NaN;
    if (!Number.isFinite(weight)) return Number.NaN;
    coupled += aqxxat * weight;
  }
  const sensitivity = 1 - coupled;
  return Number.isFinite(sensitivity) ? sensitivity : Number.NaN;
};

/**
 * Statistical (a-priori) MDB for one scalar equation:
 * MDB = delta0 * sqrt(qvv_ii) / |R_ii|, with the a-priori residual
 * cofactor qvv_ii (NO SEUW factor) and the correlated sensitivity R_ii
 * from statisticalSensitivity. The legacy MDB deliberately keeps the old
 * clamped-diagonal form (bit-identical default path); only the
 * statistical model uses this sensitivity form.
 *
 * Returns +Inf for non-positive/non-finite qvv, untestable sensitivity
 * (|R| <= 1e-12 or non-finite), or non-finite/non-positive delta0;
 * never NaN, never throws.
 */
export const statisticalMdb = (
  qvv: number,
  sensitivity: number,
  delta0: number,
): number => {
  if (!Number.isFinite(qvv) || !(qvv > 0)) return Number.POSITIVE_INFINITY;
  if (!isTestableSensitivity(sensitivity)) return Number.POSITIVE_INFINITY;
  if (!Number.isFinite(delta0) || !(delta0 > 0)) return Number.POSITIVE_INFINITY;
  const mdb = (delta0 * Math.sqrt(qvv)) / Math.abs(sensitivity);
  return Number.isFinite(mdb) && mdb > 0 ? mdb : Number.POSITIVE_INFINITY;
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
