/**
 * Phase 14F §17: canonical section-level restriction notes for QC strips
 * and settings cards.
 *
 * Display-boundary strings only — no math. Each note is written once here
 * and reused at the section level; per-row cells stay concise ("-" or a
 * short reason) and must not repeat these paragraphs.
 */

export const QC_RESTRICTION_NOTES = {
  popeApproximation:
    'Pope τ critical values reuse the normal-theory noncentrality, so formal significance under Pope τ is approximate.',
  robustFrozenWeights:
    'Robust reweighting freezes the final weights, so formal local-test and reliability significance is approximate.',
  freeNetworkDatum:
    'Free-network datum: absolute coordinate shifts are datum-dependent and reported fail-closed.',
  sparseRoute:
    'Sparse-route solves omit full-covariance diagnostics that have no sparse equivalent.',
  stochasticNotVce:
    'Group scales are empirical first-pass diagnostics, not variance-component estimates; no reweighting follows from them.',
  systematicDescriptive:
    'Pattern panels are descriptive diagnostics only; no formal p-values are computed.',
  sequenceNotTime:
    'Sequence plots follow input order, not observation time.',
  orientationAbsorbsOffsets:
    'Per-setup orientation unknowns absorb per-set constant offsets.',
} as const;

export type QcRestrictionKey = keyof typeof QC_RESTRICTION_NOTES;
