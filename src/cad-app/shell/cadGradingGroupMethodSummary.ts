/**
 * Phase 20H — pure grading-group method summary (SHELL/UI ONLY).
 *
 * One authority for the group-level Method label from the effective criteria
 * set (group default + every course override). A group is single-domain, so:
 *   - `Mixed Analytic`  : more than one analytic kind is in play;
 *   - `Distance` / `Elevation` / `Relative Elevation` : one analytic kind;
 *   - `Surface`         : fixed and/or cut-fill (the surface family).
 *
 * The label is never a misleading singular kind for a mixed analytic group,
 * and never "Mixed Family". Manager / Properties / Toolspace / Inquiry / CSV
 * all read this one helper so their terms cannot drift.
 */
import type { CadGradingGroup } from '../../engine/cad/grading/gradingGroupTypes';
import { resolveGroupMemberCriteria } from '../../engine/cad/grading/gradingGroupCourseCriteria';
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

/** Summarize a criterion set (group default + overrides) into one label. */
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

/** Summarize a persisted group (default + effective course criteria). */
export const groupMethodSummary = (group: CadGradingGroup): GroupMethodSummary =>
  summarizeGroupMethods([group.criterion, ...resolveGroupMemberCriteria(group)]);
