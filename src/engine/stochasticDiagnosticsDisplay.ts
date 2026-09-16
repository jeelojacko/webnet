import type { AdjustmentResult } from '../types';

/**
 * Presentation helpers for the single-pass Förstner stochastic group
 * diagnostics (Phase 14C). No math here — formatting and fail-state labels
 * only. The engine contract lives in `./stochasticGroupDiagnostics`.
 */

/** Spec §25 tooltip: neutral scale reading, no threshold verdict. */
export const STOCHASTIC_SCALE_TOOLTIP =
  'Group sigma scale s = sqrt(Ω/R): observed variation relative to stated precision. ' +
  'Scale > 1 means observed variation exceeds stated precision; < 1 means stated sigmas look ' +
  'conservative for this group; ≈ 1 means consistent, subject to estimation uncertainty. ' +
  'Diagnostics only — no automatic reweighting.';

export const formatStochasticScale = (sigmaScale: number | undefined): string =>
  sigmaScale != null && Number.isFinite(sigmaScale) ? `×${sigmaScale.toFixed(2)}` : '-';

/**
 * Spec §26 pointer: ONLY when the global chi-square fails, one compact line
 * naming the largest estimated group scale. Null otherwise — a passing global
 * test carries no per-group correctness implication.
 */
export const buildStochasticPointerLine = (result: AdjustmentResult): string | null => {
  if (!result.chiSquare || result.chiSquare.pass95) return null;
  const groups = result.stochasticDiagnostics?.groups ?? [];
  let best: { label: string; sigmaScale: number } | null = null;
  for (const group of groups) {
    if (group.status !== 'estimated' || group.sigmaScale == null) continue;
    if (!Number.isFinite(group.sigmaScale)) continue;
    if (!best || group.sigmaScale > best.sigmaScale) best = { label: group.label, sigmaScale: group.sigmaScale };
  }
  if (!best) return null;
  return `Global stochastic model failed. Largest estimated group scale: ${best.label} ${formatStochasticScale(best.sigmaScale)}.`;
};
