/**
 * Phase 20F — grading-group termination-domain compatibility (20H: domains,
 * 20J Wave C1: hybrid productized).
 *
 * One group terminates per EFFECTIVE course criterion (group default +
 * sparse overrides) in `surface` (fixed and/or cut-fill), `analytic`
 * (distance, elevation, and relative-elevation), or `hybrid` (mixed).
 * Surface↔analytic joints solve through the Wave-B exact-common-tie
 * kernel, so every 5-kind mix authors, persists, and calculates.
 * `GradingTerminationKind` is unchanged; the domain/mode is derived and
 * never persisted.
 */
import {
  gradingTerminationDomain,
  gradingTerminationKind,
  type GradingCriterion,
  type GradingTerminationDomain,
  type GradingTerminationKind,
} from './gradingTypes';
import type { CadGradingGroup } from './gradingGroupTypes';
import { resolveGroupMemberCriteria } from './gradingGroupCourseCriteria';

export type GroupTerminationFamily = GradingTerminationKind;

export const groupTerminationFamily = (
  criterion: GradingCriterion,
): GroupTerminationFamily => gradingTerminationKind(criterion);

/**
 * Compatibility gate (20J Wave C1: every 5-kind mix is a legal hybrid —
 * the exact-common-tie kernel closes surface↔analytic joints). Returns
 * null always; kept as the single call site so authoring, persistence,
 * and tests read one authority. Per-criterion validity still lives in
 * `validateGradingCriterion`.
 */
export const validateGroupTerminationDomainCriteria = (
  _criterion: GradingCriterion,
  _memberCriteria: readonly GradingCriterion[],
): string | null => null;

/**
 * Single-family gate over a default criterion + its effective member
 * criteria. 20J Wave C1: all mixes legal (surface, analytic, hybrid) —
 * always null. Returns null when compatible; otherwise a clear authoring
 * error naming the offending mix.
 */
export const validateGroupTerminationCriteria = (
  criterion: GradingCriterion,
  memberCriteria: readonly GradingCriterion[],
): string | null => validateGroupTerminationDomainCriteria(criterion, memberCriteria);

/**
 * Canonical deterministic ordering of the analytic termination kinds
 * present in a mixed-analytic group (group-bake + design-patch provenance
 * only). Fixed order distance → elevation → relative-elevation, so the
 * same mix always serializes identically; homogeneous groups never emit it.
 */
export type AnalyticTerminationKind = 'distance' | 'elevation' | 'relative-elevation';

const ANALYTIC_KIND_ORDER: readonly AnalyticTerminationKind[] = [
  'distance',
  'elevation',
  'relative-elevation',
];

export const canonicalAnalyticKinds = (
  criteria: readonly GradingCriterion[],
): AnalyticTerminationKind[] => {
  const present = new Set<GradingTerminationKind>();
  for (const criterion of criteria) present.add(gradingTerminationKind(criterion));
  return ANALYTIC_KIND_ORDER.filter((kind) => present.has(kind));
};

/**
 * Canonical deterministic ordering of the termination kinds present in a
 * hybrid group (group-bake + design-patch provenance only). Fixed order
 * surface → distance → elevation → relative-elevation, so the same mix
 * always serializes identically; homogeneous groups never emit it.
 * (fixed/cut-fill both read as `surface`; only effectively present kinds
 * are listed.)
 */
export type HybridTerminationKind = 'surface' | 'distance' | 'elevation' | 'relative-elevation';

const TERMINATION_KIND_ORDER: readonly HybridTerminationKind[] = [
  'surface',
  'distance',
  'elevation',
  'relative-elevation',
];

export const canonicalTerminationKinds = (
  criteria: readonly GradingCriterion[],
): HybridTerminationKind[] => {
  const present = new Set<GradingTerminationKind>();
  for (const criterion of criteria) present.add(gradingTerminationKind(criterion));
  const out = TERMINATION_KIND_ORDER.filter((kind) =>
    kind === 'surface' ? present.has('surface') : present.has(kind),
  );
  return out;
};

/** Convenience gate for a fully-built group definition (default + overrides). */
export const validateGroupTermination = (group: CadGradingGroup): string | null =>
  validateGroupTerminationCriteria(group.criterion, resolveGroupMemberCriteria(group));

/**
 * Phase 20J Wave B — group termination MODE (single engine authority).
 *
 * Derived from the EFFECTIVE criteria (group default + per-member entries),
 * never persisted: `surface` (fixed/cut-fill only), `analytic`
 * (distance/elevation/relative-elevation only), or `hybrid` (mixed).
 */
export type GradingGroupTerminationMode = 'surface' | 'analytic' | 'hybrid';

export const groupTerminationMode = (
  criterion: GradingCriterion,
  memberCriteria: readonly GradingCriterion[],
): GradingGroupTerminationMode => {
  const domains = new Set<GradingTerminationDomain>();
  domains.add(gradingTerminationDomain(criterion));
  for (const member of memberCriteria) domains.add(gradingTerminationDomain(member));
  if (domains.size <= 1) return domains.has('surface') ? 'surface' : 'analytic';
  return 'hybrid';
};

/**
 * True when the effective criteria need a target surface: surface-only and
 * hybrid groups query the TIN; all-analytic groups never do.
 */
export const groupTerminationRequiresTarget = (
  criterion: GradingCriterion,
  memberCriteria: readonly GradingCriterion[],
): boolean => groupTerminationMode(criterion, memberCriteria) !== 'analytic';
