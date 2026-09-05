/**
 * Phase 7B explicit internal precision policy.
 *
 * This module only names the tolerances and coverage already used by the
 * surrounding evidence; it changes no baseline, tolerance, or production
 * routing. Import it from tests and developer tooling instead of
 * scattering magic numbers.
 */
export const PHASE7B_PRECISION_POLICY = {
  /** TS-vs-sparse coordinate agreement gate (meters), shared with Phase 6/7A. */
  shadowToleranceM: 1e-6,
  /** Generated-truth agreement gate (meters) for sparse-only scaling runs. */
  truthToleranceM: 0.1,
  /** Repeat-determinism gate (meters) for back-to-back sparse solves. */
  repeatToleranceM: 1e-12,
  /** Condition-estimate warning threshold, mirroring `maxCondition`. */
  conditionThreshold: 1e12,
  /** Relative agreement gate between dense and sparse condition estimates. */
  conditionRelativeTolerance: 1e-9,
  /** Dense-vs-structured weight quadratic relative gate. */
  weightQuadraticRelativeTolerance: 1e-12,
} as const;

export interface Phase7bCoverageMetadata {
  fixtureKinds: readonly string[];
  parserSyntax: readonly string[];
  routes: readonly string[];
  deferred: readonly string[];
}

/** Static coverage record for the bounded Phase 7B batch. */
export const describePhase7bCoverage = (): Phase7bCoverageMetadata => ({
  fixtureKinds: ['full-enu-small-grid', 'full-enu-scaling-chain-grid'],
  parserSyntax: ['G0/G1/G2/G3 with nonzero cXY/cXZ/cYZ in .CRS GRID mode'],
  routes: [
    'ts-dense-reference',
    'sparse-selected-network (test-injected)',
    'sparse-only-scaling (test-injected, no dense reference)',
  ],
  deferred: [
    'sparse execution inside the production adjustment worker (no injection seam)',
    'LOCAL-mode full-ENU weights (parser block preserved; solve uses diagonal proxy by design)',
  ],
});
