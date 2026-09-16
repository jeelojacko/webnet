import type { AdjustmentResult } from '../types';

/**
 * Presentation helpers for the empirical first-pass stochastic group
 * diagnostics (Phase 14C). No math here — formatting and fail-state labels
 * only. The engine contract lives in `./stochasticGroupDiagnostics`.
 */

/** Spec §25 tooltip: neutral scale reading, no threshold verdict. */
export const STOCHASTIC_SCALE_TOOLTIP =
  'Group sigma scale s = sqrt(Ω/R): observed variation relative to stated precision. ' +
  'Scale > 1 means observed variation exceeds stated precision; < 1 means stated sigmas look ' +
  'conservative for this group; ≈ 1 means consistent, subject to estimation uncertainty. ' +
  'First-pass diagnostic only — no automatic reweighting.';

export const formatStochasticScale = (sigmaScale: number | undefined): string =>
  sigmaScale != null && Number.isFinite(sigmaScale) ? `×${sigmaScale.toFixed(2)}` : '-';

/**
 * Redundancy DOF formatting: raw values carry no pass/fail threshold, and a
 * fixed 3-decimal display would round a tiny-but-positive R to "0.000" next
 * to a confident-looking scale. Small values switch to exponential notation.
 */
export const formatStochasticRedundancy = (redundancyDof: number | null | undefined): string => {
  if (redundancyDof == null || !Number.isFinite(redundancyDof)) return '-';
  if (redundancyDof !== 0 && Math.abs(redundancyDof) < 0.0005) return redundancyDof.toExponential(2);
  return redundancyDof.toFixed(3);
};

/** Below this redundancy a diagnostic scale is shown as indicative-only (presentation heuristic, not a threshold). */
export const STOCHASTIC_WEAK_REDUNDANCY = 0.01;

/** Human status label: 'estimated' stays a machine status; people see 'diagnostic'. */
export const formatStochasticStatus = (group: {
  status: 'estimated' | 'unestimable' | 'unavailable';
  reason?: string;
  redundancyDof: number;
}): string => {
  if (group.status !== 'estimated') {
    return `${group.status}${group.reason ? ` — ${group.reason}` : ''}`;
  }
  if (Number.isFinite(group.redundancyDof) && group.redundancyDof < STOCHASTIC_WEAK_REDUNDANCY) {
    return 'diagnostic (low redundancy — indicative only)';
  }
  return 'diagnostic';
};

/**
 * Spec §26 pointer: ONLY when the global chi-square fails, one compact line
 * naming the most-deviant diagnostic group scale. Upper-tail failure (variance
 * factor above its interval) points at the largest scale — possibly optimistic
 * sigmas; lower-tail failure points at the smallest scale — possibly
 * conservative sigmas. Wording stays first-pass ("may indicate"): parameter
 * coupling means no single group is proven responsible. Null otherwise — a
 * passing global test carries no per-group correctness implication.
 */
export const buildStochasticPointerLine = (result: AdjustmentResult): string | null => {
  if (!result.chiSquare || result.chiSquare.pass95) return null;
  const groups = result.stochasticDiagnostics?.groups ?? [];
  const estimated = groups.filter(
    (group): group is typeof group & { sigmaScale: number } =>
      group.status === 'estimated' && group.sigmaScale != null && Number.isFinite(group.sigmaScale),
  );
  if (estimated.length === 0) return null;
  const { varianceFactor, varianceFactorLower } = result.chiSquare;
  const lowerTail =
    Number.isFinite(varianceFactor) &&
    Number.isFinite(varianceFactorLower) &&
    varianceFactor < varianceFactorLower;
  const best = estimated.reduce((a, b) =>
    lowerTail ? (b.sigmaScale < a.sigmaScale ? b : a) : (b.sigmaScale > a.sigmaScale ? b : a),
  );
  const direction = lowerTail ? 'smallest' : 'largest';
  const hint = lowerTail
    ? 'may indicate conservative stated sigmas in this group'
    : 'may indicate optimistic stated sigmas in this group';
  return (
    `Global stochastic model check failed. First-pass pointer only (not a verdict): ${direction} ` +
    `diagnostic group scale ${best.label} ${formatStochasticScale(best.sigmaScale)} — ${hint}, ` +
    `subject to between-group coupling.`
  );
};
