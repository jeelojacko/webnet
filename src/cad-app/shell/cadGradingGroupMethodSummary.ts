/**
 * Phase 20H — pure grading-group method summary (SHELL/UI ONLY).
 * Phase 20J Wave C2 — hybrid groups (surface + analytic effective mix).
 *
 * One authority for the group-level Method label from the EFFECTIVE criteria
 * set (one resolved criterion per traversal course). The group default
 * contributes only when at least one course rides it: a fully-overridden
 * default names no effective method and must not leak into the label.
 *   - `Hybrid`              : surface + at least one analytic kind effective;
 *   - `Mixed Analytic`      : more than one analytic kind, no surface;
 *   - `Distance` / `Elevation` / `Relative Elevation` : one analytic kind;
 *   - `Surface`             : fixed and/or cut-fill (the surface family).
 *
 * The label is never a misleading singular kind for a mixed group.
 * Manager / Properties / Toolspace / Inquiry / CSV all read this one
 * helper so their terms cannot drift.
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

/** Phase 20J Wave C2 — group-level label for a surface + analytic mix. */
export const HYBRID_LABEL = 'Hybrid';

/**
 * Phase 20J Wave C2 — exact hybrid-corner wording shared by the manager
 * default editor and the course criteria panel (one source, no drift).
 * States the tie requirement; never claims calculability.
 */
export const HYBRID_CORNER_WARNING =
  'Hybrid Surface/analytic corners require one exact common tie. Calculate fails closed when a transition would be required.';

export interface GroupMethodSummary {
  /** Group-level label: a single method name, `Mixed Analytic`, or `Hybrid`. */
  label: string;
  /** True when more than one analytic kind is effective in this group. */
  mixedAnalytic: boolean;
  /** True when surface + at least one analytic kind are both effective. */
  hybrid: boolean;
  /** True when at least one effective course ties to the target surface. */
  requiresTarget: boolean;
  /** Distinct effective termination kinds, canonical order. */
  kinds: GradingTerminationKind[];
  /**
   * Human exact-kind list. Hybrid carries its prefix
   * (`Hybrid — Surface + Distance`); every other mix is the bare join
   * (`Distance + Relative Elevation`).
   */
  detail: string;
  /** Bare exact-kind list without any prefix (`Surface + Distance`). */
  methodList: string;
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
  const hasSurface = kinds.includes('surface');
  const analyticKinds = kinds.filter((kind) => kind !== 'surface');
  const hybrid = hasSurface && analyticKinds.length > 0;
  const mixedAnalytic = analyticKinds.length > 1;
  const methodList = kinds.map(gradingMethodLabel).join(' + ');
  return {
    label: hybrid ? HYBRID_LABEL : mixedAnalytic ? MIXED_ANALYTIC_LABEL : (kinds[0] ? gradingMethodLabel(kinds[0]) : 'Surface'),
    mixedAnalytic,
    hybrid,
    requiresTarget: hasSurface,
    kinds,
    detail: hybrid ? `${HYBRID_LABEL} — ${methodList}` : methodList,
    methodList,
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
