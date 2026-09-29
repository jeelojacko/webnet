/**
 * Phase 20F — grading-group termination-family compatibility.
 *
 * One group terminates at ONE family across every effective course
 * criterion (group default + sparse overrides):
 *   - `surface`  : grade-to-surface (fixed and/or cut-fill may mix freely);
 *   - `distance` : analytic constant horizontal grading limit;
 *   - `elevation`: analytic constant-Z grading limit.
 *
 * Mixing families inside one group has no honest closed-form kernel (surface
 * corners need a TIN tie while analytic corners intersect two limit lines),
 * so every cross-family combination fails closed at authoring with a named
 * diagnostic. Wildcard families are deliberately absent: fail closed now.
 */
import {
  gradingTerminationKind,
  type GradingCriterion,
  type GradingTerminationKind,
} from './gradingTypes';
import type { CadGradingGroup } from './gradingGroupTypes';
import { resolveGroupMemberCriteria } from './gradingGroupCourseCriteria';

export type GroupTerminationFamily = GradingTerminationKind;

const FAMILY_LABEL: Record<GroupTerminationFamily, string> = {
  surface: 'Surface',
  distance: 'Distance',
  elevation: 'Elevation',
};

/** Termination family of one criterion (surface = legacy fixed/cut-fill). */
export const groupTerminationFamily = (
  criterion: GradingCriterion,
): GroupTerminationFamily => gradingTerminationKind(criterion);

/**
 * Single-family gate over a default criterion + its effective member
 * criteria. Returns null when the group terminates in exactly one family;
 * otherwise a clear authoring error naming the offending mix.
 */
export const validateGroupTerminationCriteria = (
  criterion: GradingCriterion,
  memberCriteria: readonly GradingCriterion[],
): string | null => {
  const families = new Set<GroupTerminationFamily>();
  families.add(groupTerminationFamily(criterion));
  for (const member of memberCriteria) families.add(groupTerminationFamily(member));
  if (families.size <= 1) return null;
  const names = [...families].map((family) => FAMILY_LABEL[family]).join(', ');
  return `grading group mixes termination families (${names}); one group must use a single family (Surface, Distance, or Elevation)`;
};

/** Convenience gate for a fully-built group definition (default + overrides). */
export const validateGroupTermination = (group: CadGradingGroup): string | null =>
  validateGroupTerminationCriteria(group.criterion, resolveGroupMemberCriteria(group));
