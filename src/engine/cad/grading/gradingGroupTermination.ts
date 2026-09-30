/**
 * Phase 20F — grading-group termination-domain compatibility (20H: domains).
 *
 * One group terminates in ONE domain across every effective course
 * criterion (group default + sparse overrides): `surface` (fixed and/or
 * cut-fill mix freely) or `analytic` (distance, elevation, and
 * relative-elevation mix freely). A surface+analytic mix has no honest
 * closed-form kernel, so it fails closed at authoring with a named
 * diagnostic. `GradingTerminationKind` is unchanged; the domain is derived
 * and never persisted.
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
 * Same-domain gate: one group terminates in exactly ONE domain across
 * every effective course criterion (group default + sparse overrides):
 *   - `surface`  : grade-to-surface (fixed and/or cut-fill mix freely);
 *   - `analytic` : distance, elevation, and relative-elevation mix freely
 *     (every corner intersects two closed-form limit lines, no TIN tie).
 *
 * A surface+analytic mix has no honest closed-form kernel (surface corners
 * need a TIN tie while analytic corners intersect two limit lines), so it
 * fails closed at authoring with a named diagnostic. Null = compatible.
 */
export const validateGroupTerminationDomainCriteria = (
  criterion: GradingCriterion,
  memberCriteria: readonly GradingCriterion[],
): string | null => {
  const domains = new Set<GradingTerminationDomain>();
  domains.add(gradingTerminationDomain(criterion));
  for (const member of memberCriteria) domains.add(gradingTerminationDomain(member));
  if (domains.size <= 1) return null;
  return 'grading group mixes surface and analytic termination (Surface vs Distance, Elevation, or Relative Elevation); one group must terminate entirely on the target surface or entirely analytically';
};

/**
 * Single-family gate over a default criterion + its effective member
 * criteria. Same-domain rule (see `validateGroupTerminationDomainCriteria`):
 * surface kinds (fixed/cut-fill) mix freely, analytic kinds
 * (distance/elevation/relative-elevation) mix freely, surface+analytic
 * fails closed. Returns null when compatible; otherwise a clear authoring
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

/** Convenience gate for a fully-built group definition (default + overrides). */
export const validateGroupTermination = (group: CadGradingGroup): string | null =>
  validateGroupTerminationCriteria(group.criterion, resolveGroupMemberCriteria(group));
