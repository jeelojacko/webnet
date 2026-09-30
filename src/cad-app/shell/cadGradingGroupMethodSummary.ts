/**
 * Phase 20H — pure grading-group method summary (SHELL/UI ONLY).
 *
 * One authority for the group-level Method label from the EFFECTIVE criteria
 * set (one resolved criterion per traversal course). The group default
 * contributes only when at least one course rides it: a fully-overridden
 * default names no effective method and must not leak into the label.
 * A group is single-domain, so:
 *   - `Mixed Analytic`  : more than one analytic kind is effective;
 *   - `Distance` / `Elevation` / `Relative Elevation` : one analytic kind;
 *   - `Surface`         : fixed and/or cut-fill (the surface family).
 *
 * The label is never a misleading singular kind for a mixed analytic group,
 * and never "Mixed Family". Manager / Properties / Toolspace / Inquiry / CSV
 * all read this one helper so their terms cannot drift.
 */
import type { CadGradingGroup } from '../../engine/cad/grading/gradingGroupTypes';
import {
  criteriaEqual,
  resolveGroupMemberCriteria,
} from '../../engine/cad/grading/gradingGroupCourseCriteria';
import type {
  GradingCriterion,
  GradingTerminationKind,
} from '../../engine/cad/grading/gradingTypes';
import { gradingTerminationKind } from '../../engine/cad/grading/gradingTypes';
import { gradingMethodLabel } from './cadGradingCriterionInput';

/** Canonical, deterministic kind order (surface first, analytic in family order). */
const KIND_ORDER: readonly GradingTerminationKind[] = [
  'surface',
  'distance',
  'elevation',
  'relative-elevation',
];

export const MIXED_ANALYTIC_LABEL = 'Mixed Analytic';

export interface GroupMethodSummary {
  /** Group-level label: a single method name, or `Mixed Analytic`. */
  label: string;
  /** True when more than one analytic kind is effective in this group. */
  mixedAnalytic: boolean;
  /** Distinct effective termination kinds, canonical order. */
  kinds: GradingTerminationKind[];
  /** Human exact-kind list, e.g. `Distance + Relative Elevation`. */
  detail: string;
}

/**
 * Summarize an explicit criterion set into one label. Callers must pass the
 * EFFECTIVE set (one resolved criterion per course); a stored default that
 * no course rides must not be included.
 */
export const summarizeGroupMethods = (
  criteria: readonly GradingCriterion[],
): GroupMethodSummary => {
  const present = new Set<GradingTerminationKind>();
  for (const criterion of criteria) present.add(gradingTerminationKind(criterion));
  const kinds = KIND_ORDER.filter((kind) => present.has(kind));
  const mixedAnalytic = kinds.length > 1;
  return {
    // A group can never mix surface with analytic (engine gate), so >1 kind
    // is always an analytic mix.
    label: mixedAnalytic ? MIXED_ANALYTIC_LABEL : (kinds[0] ? gradingMethodLabel(kinds[0]) : 'Surface'),
    mixedAnalytic,
    kinds,
    detail: kinds.map(gradingMethodLabel).join(' + '),
  };
};

/**
 * Summarize a persisted group from its effective per-course criteria. A
 * fully-overridden default is invisible here; a courseless group falls back
 * to its default kind so the label never reads empty.
 */
export const groupMethodSummary = (group: CadGradingGroup): GroupMethodSummary => {
  const effective = resolveGroupMemberCriteria(group);
  return summarizeGroupMethods(effective.length > 0 ? effective : [group.criterion]);
};

/**
 * Value-level representative for single-criterion displays (inquiry Target /
 * CSV Criterion rows, provenance singular fields). The stored default while
 * it is effective on at least one course, else the first effective course
 * criterion (traversal order, deterministic). A fully-overridden default
 * never poses as the calculated criterion.
 */
export const representativeGroupCriterion = (
  group: CadGradingGroup,
): GradingCriterion => {
  const effective = resolveGroupMemberCriteria(group);
  if (effective.length === 0) return group.criterion;
  return effective.some((entry) => criteriaEqual(entry, group.criterion))
    ? group.criterion
    : effective[0]!;
};
