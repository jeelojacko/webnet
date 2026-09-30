/**
 * Phase 20E Wave-1A — per-course effective-criterion resolution.
 *
 * Single precedence rule: an override whose vertex-id pair matches the
 * persisted traversal course (either order, so span reversal rides along)
 * wins; otherwise the group default applies. Callers build ONE
 * `Map<"A>B", criterion>` per resolve and every consumer reads through it —
 * never `.find()` in loops.
 *
 * Pure, no worker/React coupling. No GradingCriterionV2, no blends, no
 * station identity.
 */
import type { GradingCriterion } from './gradingTypes';
import type {
  CadGradingGroup,
  GradingGroupCourse,
  GradingGroupCourseCriterionOverride,
} from './gradingGroupTypes';

/** Canonical override-map key for one ordered vertex pair. */
export const courseCriterionKey = (vertexAId: string, vertexBId: string): string =>
  `${vertexAId}>${vertexBId}`;

/** Both storage orders hit the same entry, so reversal is invariant. */
const lookupKeys = (course: GradingGroupCourse): [string, string] => [
  courseCriterionKey(course.vertexAId, course.vertexBId),
  courseCriterionKey(course.vertexBId, course.vertexAId),
];

/**
 * Build the single override map for a group (later duplicates shadow
 * earlier ones; persistence/authoring block duplicates, this stays total).
 */
export const buildCourseCriterionMap = (
  group: Pick<CadGradingGroup, 'courseCriteria'>,
): Map<string, GradingCriterion> => {
  const map = new Map<string, GradingCriterion>();
  for (const override of group.courseCriteria ?? []) {
    map.set(courseCriterionKey(override.sourceCourse.vertexAId, override.sourceCourse.vertexBId), override.criterion);
  }
  return map;
};

/** Effective criterion for one traversal course through a prebuilt map. */
export const effectiveCriterionForCourse = (
  group: Pick<CadGradingGroup, 'criterion'>,
  map: ReadonlyMap<string, GradingCriterion>,
  course: GradingGroupCourse,
): GradingCriterion => {
  for (const key of lookupKeys(course)) {
    const hit = map.get(key);
    if (hit) return hit;
  }
  return group.criterion;
};

/**
 * Resolve one course ref against a group (the task-spec entry point):
 * override wins, otherwise the group default.
 */
export const resolveGradingGroupCourseCriterion = (
  group: CadGradingGroup,
  courseRef: GradingGroupCourse,
): GradingCriterion =>
  effectiveCriterionForCourse(group, buildCourseCriterionMap(group), courseRef);

/** Effective criteria for the whole traversal, in order (one map build). */
export const resolveGroupMemberCriteria = (group: CadGradingGroup): GradingCriterion[] =>
  effectiveCriteriaForCourses(group.criterion, group.sourceCourses, group.courseCriteria);

/**
 * Phase 20J Wave C4 — effective per-course criteria from a stored default
 * plus sparse overrides (override wins, otherwise the default). The same
 * single-precedence rule as `resolveGroupMemberCriteria`, for callers
 * that hold the parts (authoring, persistence, revision) rather than a
 * built group. Courses using the default count; a fully-overridden
 * default is invisible (it applies to zero courses).
 */
export const effectiveCriteriaForCourses = (
  criterion: GradingCriterion,
  sourceCourses: readonly GradingGroupCourse[],
  courseCriteria?: readonly GradingGroupCourseCriterionOverride[],
): GradingCriterion[] => {
  const map = buildCourseCriterionMap({ courseCriteria } as Pick<CadGradingGroup, 'courseCriteria'>);
  const group = { criterion };
  return sourceCourses.map((course) => effectiveCriterionForCourse(group, map, course));
};

/**
 * Canonical sparse overrides in `sourceCourses` traversal order (for the
 * ggrev1 hash). Orphan refs (no traversal course matches either order) and
 * duplicates collapse out; entries equal to the group default are dropped
 * (sparse: reset-to-default removes the record).
 */
export const canonicalCourseCriteria = (
  group: Pick<CadGradingGroup, 'criterion' | 'sourceCourses' | 'courseCriteria'>,
): GradingGroupCourseCriterionOverride[] => {
  const map = buildCourseCriterionMap(group);
  const seen = new Set<string>();
  const out: GradingGroupCourseCriterionOverride[] = [];
  for (const course of group.sourceCourses) {
    const keys = lookupKeys(course);
    if (seen.has(keys[0]) || seen.has(keys[1])) continue;
    seen.add(keys[0]);
    seen.add(keys[1]);
    let hit: GradingCriterion | undefined;
    for (const key of keys) {
      const candidate = map.get(key);
      if (candidate) {
        hit = candidate;
        break;
      }
    }
    if (!hit) continue;
    if (criteriaEqual(hit, group.criterion)) continue;
    out.push({ sourceCourse: { ...course }, criterion: { ...hit } });
  }
  return out;
};

/**
 * Structural criterion equality (kind + ratios). Phase 20F/20G: distance,
 * elevation, and relative-elevation compare their exact numeric inputs
 * (no tolerance), so a reset-to-default removes the override only when the
 * inputs are identical.
 */
export const criteriaEqual = (a: GradingCriterion, b: GradingCriterion): boolean => {
  if (a.kind !== b.kind) return false;
  if (a.kind === 'fixed' && b.kind === 'fixed') return a.gradeRatio === b.gradeRatio;
  if (a.kind === 'cut-fill' && b.kind === 'cut-fill') {
    return a.cutGradeRatio === b.cutGradeRatio && a.fillGradeRatio === b.fillGradeRatio;
  }
  if (a.kind === 'distance' && b.kind === 'distance') {
    return a.gradeRatio === b.gradeRatio && a.distance === b.distance;
  }
  if (a.kind === 'elevation' && b.kind === 'elevation') {
    return a.gradeRatio === b.gradeRatio && a.targetElevation === b.targetElevation;
  }
  if (a.kind === 'relative-elevation' && b.kind === 'relative-elevation') {
    return a.gradeRatio === b.gradeRatio && a.relativeElevation === b.relativeElevation;
  }
  return false;
};
