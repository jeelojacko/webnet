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

/** Phase 7B.5 internal covariance demand kinds (test-only, no routing). */
export type Phase7bCovarianceDemandKind =
  | 'selected-network'
  | 'legacy-all-pairs-compat'
  | 'dense-all-entry';

export interface Phase7bCovarianceDemandPolicy {
  readonly kind: Phase7bCovarianceDemandKind;
  /** Human-readable demand contract for this kind. */
  readonly demand: string;
  /** Whether legacy all-pairs relativePrecision rows are produced. */
  readonly legacyAllPairsProduced: boolean;
  /** Whether a dense Qxx reconstruction is allocated. */
  readonly denseQxxAllocated: boolean;
}

/**
 * Explicit internal demand policy distinguishing the unchanged
 * selected-network route from the Phase 7B.5 legacy compat (Option B)
 * and the dense all-entry reference (Option A). Names coverage only;
 * changes no baseline, tolerance, or production routing.
 */
export const PHASE7B_COVARIANCE_DEMAND_POLICY: Record<
  Phase7bCovarianceDemandKind,
  Phase7bCovarianceDemandPolicy
> = {
  'selected-network': {
    kind: 'selected-network',
    demand: 'station blocks plus connected/requested pairs only; skips legacy all-pairs rows',
    legacyAllPairsProduced: false,
    denseQxxAllocated: false,
  },
  'legacy-all-pairs-compat': {
    kind: 'legacy-all-pairs-compat',
    demand:
      'exact 2D/3D all-station blocks plus connected/requested pairs (Option B); no dense Qxx, no orientation unknowns',
    legacyAllPairsProduced: true,
    denseQxxAllocated: false,
  },
  'dense-all-entry': {
    kind: 'dense-all-entry',
    demand: 'every Qxx entry (Option A, numParams x numParams) with legacy all-pairs rows',
    legacyAllPairsProduced: true,
    denseQxxAllocated: true,
  },
};

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

export interface Phase7b5CoverageMetadata extends Phase7bCoverageMetadata {
  demandKinds: readonly Phase7bCovarianceDemandKind[];
  compatNotes: readonly string[];
}

/** Static coverage record for the bounded Phase 7B.5 compat batch. */
export const describePhase7b5Coverage = (): Phase7b5CoverageMetadata => ({
  ...describePhase7bCoverage(),
  fixtureKinds: [
    ...describePhase7bCoverage().fixtureKinds,
    'legacy-compat-2d-arbitrary-pair',
    'legacy-compat-2d-fixed-station',
    'legacy-compat-2d-orientation-unknowns',
    'legacy-compat-3d-height-blocks',
  ],
  routes: [
    ...describePhase7bCoverage().routes,
    'sparse-legacy-all-pairs-compat Option B (test-injected, no dense Qxx)',
    'dense-all-entry Option A reference (test-only demand benchmark)',
  ],
  demandKinds: ['selected-network', 'legacy-all-pairs-compat', 'dense-all-entry'],
  compatNotes: [
    'existing TS formulas/order/undefined/default behavior preserved; compat reuses the identical all-pairs loop',
    'selected-network scaling unchanged; compat is opt-in and never routed to production',
    'orientation unknowns stay outside station demand; fixed stations read as zero without queries',
  ],
});
