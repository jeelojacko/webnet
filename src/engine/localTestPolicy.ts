/**
 * Phase 14A: formal local (single-outlier) test policy.
 *
 * Pure module — no imports from the engine. All types are plain
 * JSON-serializable so the policy can travel through ParseOptions,
 * the worker protocol, and run-settings fingerprints unchanged.
 */

export type LocalTestMode = 'legacy-fixed' | 'baarda-w' | 'pope-tau';
export type LocalTestCorrection = 'none' | 'bonferroni' | 'sidak';
export type LocalTestStatisticFamily = 'w' | 'tau';

export interface LocalTestPolicy {
  mode: LocalTestMode;
  /** Two-sided nominal significance level (entered alpha): per-test when correction is 'none', target family-wise level under Bonferroni/Šidák; default 0.05. Ignored by legacy-fixed. */
  alpha?: number;
  /** Multiplicity correction over the run test count; default 'none'. Ignored by legacy-fixed. */
  correction?: LocalTestCorrection;
  /** Legacy detection threshold; default 3.29. Only used by legacy-fixed. */
  critical?: number;
}

export interface LocalTestDerivation {
  statisticFamily: LocalTestStatisticFamily;
  alpha: number;
  effectiveAlpha: number;
  correction: LocalTestCorrection;
  testCount: number;
  criticalValue: number;
  dof: number;
  twoSided: true;
  available: boolean;
  unavailableReason?: string;
}

export interface LocalTestSummary extends LocalTestDerivation {
  mode: LocalTestMode;
  legacyCritical: number;
  /** True when Huber reweighting makes classical significance approximate. */
  robustApproximation: boolean;
  robustApproximationReason?: string;
}

export const LEGACY_LOCAL_TEST_CRITICAL = 3.29;
export const DEFAULT_LOCAL_TEST_ALPHA = 0.05;

const isValidAlpha = (alpha: number): boolean =>
  Number.isFinite(alpha) && alpha > 0 && alpha <= 0.5;

const isValidCount = (m: number): boolean => Number.isInteger(m) && m >= 1;

/**
 * Standard normal quantile (Acklam rational approximation, ~1e-9).
 * Returns NaN outside (0, 1).
 */
export const normalQuantile = (p: number): number => {
  if (!Number.isFinite(p) || p <= 0 || p >= 1) return Number.NaN;
  const a = [-3.969683028665376e1, 2.209460984245205e2, -2.759285104469687e2,
    1.38357751867269e2, -3.066479806614716e1, 2.506628277459239];
  const b = [-5.447609879822406e1, 1.615858368580409e2, -1.556989798598866e2,
    6.680131188771972e1, -1.328068155288572e1];
  const c = [-7.784894002430293e-3, -3.223964580411365e-1, -2.400758277161838,
    -2.549732539343734, 4.374664141464968, 2.938163982698783];
  const d = [7.784695709041462e-3, 3.224671290700398e-1, 2.445134137142996, 3.754408661907416];
  const plow = 0.02425;
  const phigh = 1 - plow;
  if (p < plow) {
    const q = Math.sqrt(-2 * Math.log(p));
    return (((((c[0] * q + c[1]) * q + c[2]) * q + c[3]) * q + c[4]) * q + c[5]) /
      ((((d[0] * q + d[1]) * q + d[2]) * q + d[3]) * q + 1);
  }
  if (p > phigh) {
    const q = Math.sqrt(-2 * Math.log(1 - p));
    return -(((((c[0] * q + c[1]) * q + c[2]) * q + c[3]) * q + c[4]) * q + c[5]) /
      ((((d[0] * q + d[1]) * q + d[2]) * q + d[3]) * q + 1);
  }
  const q = p - 0.5;
  const r = q * q;
  return (((((a[0] * r + a[1]) * r + a[2]) * r + a[3]) * r + a[4]) * r + a[5]) * q /
    (((((b[0] * r + b[1]) * r + b[2]) * r + b[3]) * r + b[4]) * r + 1);
};

/** Regularized incomplete beta I_x(a, b) via continued fraction; compact and tested. */
export const incompleteBeta = (x: number, a: number, b: number): number => {
  if (!Number.isFinite(x) || !Number.isFinite(a) || !Number.isFinite(b)) return Number.NaN;
  if (a <= 0 || b <= 0) return Number.NaN;
  if (x <= 0) return 0;
  if (x >= 1) return 1;
  const front = Math.exp(logGamma(a + b) - logGamma(a) - logGamma(b) +
    a * Math.log(x) + b * Math.log(1 - x));
  const useSymmetry = x > (a + 1) / (a + b + 2);
  const contFrac = (xx: number, aa: number, bb: number): number => {
    const maxIter = 200;
    const eps = 3e-14;
    const fpmin = 1e-300;
    let qab = aa + bb;
    let qap = aa + 1;
    let qam = aa - 1;
    let c = 1;
    let d = 1 - (qab * xx) / qap;
    if (Math.abs(d) < fpmin) d = fpmin;
    d = 1 / d;
    let h = d;
    for (let m = 1; m <= maxIter; m += 1) {
      const m2 = 2 * m;
      let aaTerm = (m * (bb - m) * xx) / ((qam + m2) * (aa + m2));
      d = 1 + aaTerm * d;
      if (Math.abs(d) < fpmin) d = fpmin;
      c = 1 + aaTerm / c;
      if (Math.abs(c) < fpmin) c = fpmin;
      d = 1 / d;
      h *= d * c;
      aaTerm = (-(aa + m) * (qab + m) * xx) / ((aa + m2) * (qap + m2));
      d = 1 + aaTerm * d;
      if (Math.abs(d) < fpmin) d = fpmin;
      c = 1 + aaTerm / c;
      if (Math.abs(c) < fpmin) c = fpmin;
      d = 1 / d;
      const delta = d * c;
      h *= delta;
      if (Math.abs(delta - 1) < eps) break;
    }
    return h;
  };
  if (!useSymmetry) return (front * contFrac(x, a, b)) / a;
  return 1 - (front * contFrac(1 - x, b, a)) / b;
};

const logGamma = (x: number): number => {
  // Lanczos g=7 approximation; sufficient for the beta front factor.
  const c = [0.9999999999998099, 676.5203681218851, -1259.1392167224028,
    771.3234287776531, -176.6150291621406, 12.507343278686905,
    -0.13857109526572012, 9.984369578019572e-6, 1.5056327351493116e-7];
  if (x < 0.5) return Math.log(Math.PI / Math.sin(Math.PI * x)) - logGamma(1 - x);
  const z = x - 1;
  let a = c[0];
  for (let i = 1; i < 9; i += 1) a += c[i] / (z + i);
  const t = z + 7.5;
  return 0.5 * Math.log(2 * Math.PI) + (z + 0.5) * Math.log(t) - t + Math.log(a);
};

/** Upper-tail Student-t CDF complement helper: P(T > t) for t >= 0. */
const tUpperTail = (t: number, dof: number): number => {
  if (t <= 0) return 0.5;
  const x = dof / (dof + t * t);
  return 0.5 * incompleteBeta(x, dof / 2, 0.5);
};

/**
 * Student-t quantile via bisection on the incomplete-beta tail.
 * Returns NaN for invalid p/dof; never throws.
 */
export const studentTQuantile = (p: number, dof: number): number => {
  if (!Number.isFinite(p) || !Number.isFinite(dof)) return Number.NaN;
  if (p <= 0 || p >= 1 || dof <= 0) return Number.NaN;
  if (p === 0.5) return 0;
  const tail = p > 0.5 ? 1 - p : p;
  const sign = p > 0.5 ? 1 : -1;
  let lo = 0;
  let hi = 1;
  while (tUpperTail(hi, dof) > tail) {
    lo = hi;
    hi *= 2;
    if (hi > 1e12) return sign * hi;
  }
  for (let i = 0; i < 200; i += 1) {
    const mid = 0.5 * (lo + hi);
    if (tUpperTail(mid, dof) > tail) lo = mid;
    else hi = mid;
  }
  return sign * 0.5 * (lo + hi);
};

/**
 * Pope's tau critical value: t = t_{1-alpha/2, dof-1},
 * tau = t*sqrt(dof)/sqrt(dof-1+t^2). dof <= 1 → NaN (tau degenerates).
 */
export const tauCritical = (dof: number, alphaTwoSided: number): number => {
  if (!Number.isFinite(dof) || !Number.isFinite(alphaTwoSided)) return Number.NaN;
  if (dof <= 1 || !isValidAlpha(alphaTwoSided)) return Number.NaN;
  const t = studentTQuantile(1 - alphaTwoSided / 2, dof - 1);
  if (!Number.isFinite(t)) return Number.NaN;
  return (t * Math.sqrt(dof)) / Math.sqrt(dof - 1 + t * t);
};

/** Entered alpha reduced to a per-test level (identity when correction is 'none'; the family-wise target split over m otherwise); NaN on invalid input, never throws. */
export const effectiveAlpha = (
  alpha: number,
  testCount: number,
  correction: LocalTestCorrection,
): number => {
  if (!Number.isFinite(alpha) || !isValidAlpha(alpha)) return Number.NaN;
  if (!isValidCount(testCount)) return Number.NaN;
  if (correction === 'bonferroni') return alpha / testCount;
  if (correction === 'sidak') return 1 - Math.pow(1 - alpha, 1 / testCount);
  return alpha;
};

export interface DeriveLocalTestCriticalArgs {
  mode: LocalTestMode;
  alpha?: number;
  correction?: LocalTestCorrection;
  testCount: number;
  dof: number;
  legacyCritical?: number;
  /** A-posteriori variance factor root; required for pope-tau availability. */
  seuw?: number;
}

export const normalizeLocalTestPolicy = (policy?: LocalTestPolicy): Required<LocalTestPolicy> => ({
  mode: policy?.mode ?? 'legacy-fixed',
  alpha: policy?.alpha ?? DEFAULT_LOCAL_TEST_ALPHA,
  correction: policy?.correction ?? 'none',
  critical: policy?.critical ?? LEGACY_LOCAL_TEST_CRITICAL,
});

/** Derive the run-level detection threshold once per run; never throws. */
export const deriveLocalTestCritical = (args: DeriveLocalTestCriticalArgs): LocalTestDerivation => {
  const policy = normalizeLocalTestPolicy(args);
  const legacyCritical = Number.isFinite(args.legacyCritical ?? Number.NaN)
    ? (args.legacyCritical as number)
    : LEGACY_LOCAL_TEST_CRITICAL;
  const dof = args.dof;
  if (policy.mode === 'legacy-fixed') {
    return {
      statisticFamily: 'tau',
      alpha: policy.alpha,
      effectiveAlpha: policy.alpha,
      correction: 'none',
      testCount: args.testCount,
      criticalValue: legacyCritical,
      dof,
      twoSided: true,
      available: true,
    };
  }
  if (!Number.isFinite(dof) || dof <= 0) {
    return {
      statisticFamily: policy.mode === 'pope-tau' ? 'tau' : 'w',
      alpha: policy.alpha,
      effectiveAlpha: Number.NaN,
      correction: policy.correction,
      testCount: args.testCount,
      criticalValue: Number.NaN,
      dof,
      twoSided: true,
      available: false,
      unavailableReason: 'non-positive-dof',
    };
  }
  const eff = effectiveAlpha(policy.alpha, args.testCount, policy.correction);
  if (!Number.isFinite(eff)) {
    return {
      statisticFamily: policy.mode === 'pope-tau' ? 'tau' : 'w',
      alpha: policy.alpha,
      effectiveAlpha: Number.NaN,
      correction: policy.correction,
      testCount: args.testCount,
      criticalValue: Number.NaN,
      dof,
      twoSided: true,
      available: false,
      unavailableReason: 'invalid-input',
    };
  }
  if (policy.mode === 'pope-tau') {
    if (dof <= 1) {
      return {
        statisticFamily: 'tau',
        alpha: policy.alpha,
        effectiveAlpha: eff,
        correction: policy.correction,
        testCount: args.testCount,
        criticalValue: Number.NaN,
        dof,
        twoSided: true,
        available: false,
        unavailableReason: 'dof-too-small',
      };
    }
    // tau scales by the estimated variance factor; a non-positive SEUW
    // (e.g. a perfect fit) leaves it statistically undefined. Baarda-w is
    // SEUW-independent and stays available; legacy keeps its historical
    // fallback at the call site.
    if (args.seuw != null && (!Number.isFinite(args.seuw) || args.seuw <= 0)) {
      return {
        statisticFamily: 'tau',
        alpha: policy.alpha,
        effectiveAlpha: eff,
        correction: policy.correction,
        testCount: args.testCount,
        criticalValue: Number.NaN,
        dof,
        twoSided: true,
        available: false,
        unavailableReason: 'seuw-not-positive',
      };
    }
    const critical = tauCritical(dof, eff);
    return {
      statisticFamily: 'tau',
      alpha: policy.alpha,
      effectiveAlpha: eff,
      correction: policy.correction,
      testCount: args.testCount,
      criticalValue: critical,
      dof,
      twoSided: true,
      available: !Number.isNaN(critical),
      ...(Number.isNaN(critical) ? { unavailableReason: 'invalid-input' } : {}),
    };
  }
  const critical = normalQuantile(1 - eff / 2);
  return {
    statisticFamily: 'w',
    alpha: policy.alpha,
    effectiveAlpha: eff,
    correction: policy.correction,
    testCount: args.testCount,
    criticalValue: critical,
    dof,
    twoSided: true,
    available: Number.isFinite(critical),
    ...(Number.isFinite(critical) ? {} : { unavailableReason: 'invalid-input' }),
  };
};

/**
 * A scalar residual equation is testable when it carries redundancy.
 * Pass the UNCLAMPED redundancy (pre-clamp qvv); the clamped statistics
 * path reports finite-looking values for r ~= 0 that must not count.
 */
export const isTestableEquation = (redundancyUnclamped: number, qll: number): boolean =>
  qll > 0 && redundancyUnclamped > 1e-12;

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

/**
 * Sanitize a persisted/foreign local-test policy. Returns undefined when the
 * value is absent (legacy projects predate the field and load as legacy) or
 * unusable; never throws.
 */
export const sanitizeLocalTestPolicy = (value: unknown): LocalTestPolicy | undefined => {
  if (value == null) return undefined;
  if (!isRecord(value)) return undefined;
  const { mode, alpha, correction, critical } = value;
  if (mode !== 'legacy-fixed' && mode !== 'baarda-w' && mode !== 'pope-tau') return undefined;
  const policy: LocalTestPolicy = { mode };
  if (typeof alpha === 'number' && isValidAlpha(alpha)) policy.alpha = alpha;
  else if (alpha !== undefined) return undefined;
  if (correction === 'none' || correction === 'bonferroni' || correction === 'sidak') {
    policy.correction = correction;
  } else if (correction !== undefined) return undefined;
  if (typeof critical === 'number' && Number.isFinite(critical) && critical > 0) {
    policy.critical = critical;
  } else if (critical !== undefined) return undefined;
  return policy;
};

/** Normalized structural equality (defaults filled) for stale-run comparison. */
export const localTestPoliciesEqual = (
  a: LocalTestPolicy | undefined,
  b: LocalTestPolicy | undefined,
): boolean => {
  const na = normalizeLocalTestPolicy(a);
  const nb = normalizeLocalTestPolicy(b);
  return (
    na.mode === nb.mode &&
    na.alpha === nb.alpha &&
    na.correction === nb.correction &&
    na.critical === nb.critical
  );
};

/** Short mode label for reports, exports, and stale-run diffs. */
export const formatLocalTestModeLabel = (mode: LocalTestMode): string => {
  if (mode === 'baarda-w') return 'Baarda w-test';
  if (mode === 'pope-tau') return 'Pope τ-test';
  return 'Legacy fixed (3.29)';
};

/** One-line policy description, e.g. for text exports and stale-run diffs. */
export const formatLocalTestPolicyLine = (policy?: LocalTestPolicy): string => {
  const normalized = normalizeLocalTestPolicy(policy);
  if (normalized.mode === 'legacy-fixed') {
    return `Legacy fixed (${normalized.critical.toFixed(2)})`;
  }
  return `${formatLocalTestModeLabel(normalized.mode)}, alpha=${normalized.alpha}, correction=${normalized.correction}`;
};
