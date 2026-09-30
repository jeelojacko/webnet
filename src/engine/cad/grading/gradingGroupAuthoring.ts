/**
 * Phase 20C Wave-1B — pure grading-group authoring builders.
 *
 * Validates the persisted SHAPE only: a contiguous open chain or a complete
 * closed cycle, single Feature Line, no disconnects/repeats/branches, A != B
 * per course, common side/criterion/search/tolerance/corner mode. Resolution
 * against a live Feature Line (adjacency, arc orientation) belongs to the
 * resolve phase and is deliberately NOT performed here.
 */
import type { GradingCriterion, GradingSide } from './gradingTypes';
import type {
  CadGradingGroup,
  GradingCornerMode,
  GradingGroupCourse,
  GradingGroupCourseCriterionOverride,
} from './gradingGroupTypes';
import { criteriaEqual, effectiveCriteriaForCourses } from './gradingGroupCourseCriteria';
import { groupTerminationRequiresTarget } from './gradingGroupTermination';
import {
  validateGradingCriterion,
  type GradingAuthoringResult,
} from './gradingAuthoring';

export interface CreateGroupInput {
  id: string;
  name: string;
  sourceFeatureLineId: string;
  sourceCourses: GradingGroupCourse[];
  /** Required for surface criteria (fixed/cut-fill); omitted for analytic. */
  targetSurfaceId?: string;
  side: GradingSide;
  criterion: GradingCriterion;
  /** Phase 20E sparse overrides (validated: member refs, no duplicates). */
  courseCriteria?: GradingGroupCourseCriterionOverride[];
  maxSearchDistance: number;
  curveChordTolerance: number;
  cornerMode: GradingCornerMode;
  closed?: boolean;
  layerId?: string;
  styleId?: string;
}

export type RemoveEnd = 'first' | 'last';

const nonEmpty = (value: unknown): value is string =>
  typeof value === 'string' && value.length > 0;

const fail = <T>(error: string): GradingAuthoringResult<T> => ({ ok: false, error });

const courseShapeError = (course: GradingGroupCourse): string | null => {
  if (!nonEmpty(course.vertexAId) || !nonEmpty(course.vertexBId)) {
    return 'course vertex ids must be non-empty';
  }
  return course.vertexAId === course.vertexBId ? 'course vertex ids must differ' : null;
};

const distinctIds = (courses: GradingGroupCourse[]): boolean =>
  new Set(courses.map((c) => c.vertexAId)).size === courses.length;

/**
 * A simple open chain has n+1 distinct vertices; a closed cycle has n distinct
 * vertices whose A-set equals its B-set. Both conditions reject disconnects,
 * repeats, and branches after the adjacency check has passed.
 */
const vertexTopologyError = (
  courses: GradingGroupCourse[],
  closed: boolean,
): string | null => {
  if (!distinctIds(courses)) return 'chain repeats a start vertex';
  if (closed) {
    return courses[courses.length - 1]!.vertexBId === courses[0]!.vertexAId
      ? null
      : 'closed cycle must return to its first vertex';
  }
  const firstIds = new Set(courses.map((c) => c.vertexAId));
  return firstIds.has(courses[courses.length - 1]!.vertexBId)
    ? 'chain revisits a vertex (repeat or branch)'
    : null;
};

/** Contiguity + topology validation for an ordered course chain. */
export const validateGroupChain = (
  courses: GradingGroupCourse[],
  closed: boolean,
): string | null => {
  if (!Array.isArray(courses) || courses.length === 0) {
    return 'sourceCourses must contain at least one course';
  }
  if (closed && courses.length < 3) return 'closed cycle needs at least three courses';
  for (const course of courses) {
    const error = courseShapeError(course);
    if (error) return error;
  }
  for (let index = 0; index + 1 < courses.length; index += 1) {
    if (courses[index]!.vertexBId !== courses[index + 1]!.vertexAId) {
      return 'sourceCourses must form a contiguous chain';
    }
  }
  return vertexTopologyError(courses, closed);
};

const identityError = (
  input: Pick<CreateGroupInput, 'id' | 'name' | 'sourceFeatureLineId' | 'side'>,
): string | null => {
  if (!nonEmpty(input.id)) return 'id must be non-empty';
  if (!nonEmpty(input.name)) return 'name must be non-empty';
  if (!nonEmpty(input.sourceFeatureLineId)) return 'sourceFeatureLineId must be non-empty';
  return input.side === 'left' || input.side === 'right' ? null : 'side must be left or right';
};

/** Phase 20J: a target surface is required when ANY effective criterion
 * (default applied to uncovered courses; a fully-overridden default is
 * invisible) is surface-terminated. Analytic-only groups omit it. */
const targetRule = (
  criterion: GradingCriterion,
  sourceCourses: GradingGroupCourse[],
  courseCriteria: GradingGroupCourseCriterionOverride[] | undefined,
  targetSurfaceId: string | undefined,
): string | null =>
  groupTerminationRequiresTarget(
    criterion,
    effectiveCriteriaForCourses(criterion, sourceCourses, courseCriteria),
  ) && !nonEmpty(targetSurfaceId)
    ? 'targetSurfaceId must be non-empty when a surface-terminated criterion is effective'
    : null;

const scalarError = (
  input: Pick<CreateGroupInput, 'maxSearchDistance' | 'curveChordTolerance'>,
): string | null => {
  if (!Number.isFinite(input.maxSearchDistance) || !(input.maxSearchDistance > 0)) {
    return 'maxSearchDistance must be > 0';
  }
  if (!Number.isFinite(input.curveChordTolerance) || !(input.curveChordTolerance > 0)) {
    return 'curveChordTolerance must be > 0';
  }
  return null;
};

/** Phase 20E: override refs must name real traversal courses, exactly once. */
const overrideRefError = (
  courses: GradingGroupCourse[],
  courseCriteria: GradingGroupCourseCriterionOverride[] | undefined,
): string | null => {
  if (courseCriteria === undefined) return null;
  const members = new Set(courses.flatMap((c) => [`${c.vertexAId}>${c.vertexBId}`, `${c.vertexBId}>${c.vertexAId}`]));
  const seen = new Set<string>();
  for (const entry of courseCriteria) {
    const error = validateGradingCriterion(entry.criterion);
    if (error) return error;
    const key = `${entry.sourceCourse.vertexAId}>${entry.sourceCourse.vertexBId}`;
    if (!members.has(key)) return 'courseCriteria references a course outside the group span';
    const canon = [entry.sourceCourse.vertexAId, entry.sourceCourse.vertexBId].sort().join('>');
    if (seen.has(canon)) return 'courseCriteria duplicates a course';
    seen.add(canon);
  }
  return null;
};

const toGroup = (input: CreateGroupInput): CadGradingGroup => ({
  id: input.id,
  name: input.name,
  sourceFeatureLineId: input.sourceFeatureLineId,
  sourceCourses: input.sourceCourses.map((course) => ({ ...course })),
  // The target persists whenever a surface-terminated criterion is
  // effective (surface default on an uncovered course, or an analytic
  // default with a surface override); all-analytic groups omit it
  // (dormancy by omission). A fully-overridden default is invisible.
  ...(groupTerminationRequiresTarget(
    input.criterion,
    effectiveCriteriaForCourses(input.criterion, input.sourceCourses, input.courseCriteria),
  ) && nonEmpty(input.targetSurfaceId)
    ? { targetSurfaceId: input.targetSurfaceId }
    : {}),
  side: input.side,
  criterion: input.criterion,
  ...(input.courseCriteria !== undefined
    ? { courseCriteria: input.courseCriteria.map((entry) => ({ sourceCourse: { ...entry.sourceCourse }, criterion: { ...entry.criterion } })) }
    : {}),
  maxSearchDistance: input.maxSearchDistance,
  curveChordTolerance: input.curveChordTolerance,
  cornerMode: input.cornerMode,
  ...(input.closed === true ? { closed: true } : {}),
  ...(input.layerId !== undefined ? { layerId: input.layerId } : {}),
  ...(input.styleId !== undefined ? { styleId: input.styleId } : {}),
});

/** Create one group definition (pure, no project mutation). */
export const createGroupDefinition = (
  input: CreateGroupInput,
): GradingAuthoringResult<CadGradingGroup> => {
  const identity = identityError(input);
  if (identity) return fail(identity);
  if (input.cornerMode !== 'miter') return fail('cornerMode must be miter');
  const criterion = validateGradingCriterion(input.criterion);
  if (criterion) return fail(criterion);
  const target = targetRule(
    input.criterion,
    input.sourceCourses,
    input.courseCriteria,
    input.targetSurfaceId,
  );
  if (target) return fail(target);
  const scalars = scalarError(input);
  if (scalars) return fail(scalars);
  const chain = validateGroupChain(input.sourceCourses, input.closed === true);
  if (chain) return fail(chain);
  const overrides = overrideRefError(input.sourceCourses, input.courseCriteria);
  if (overrides) return fail(overrides);
  return { ok: true, value: toGroup(input) };
};

/** Replace the shared criterion on an existing group (returns a copy).
 * 20J: hybrid-legal; the target rule derives from the effective set (new
 * default + retained overrides), so an analytic default with a surface
 * override keeps its target while all-analytic drops a dormant id. */
export const editGroupCriteria = (
  current: CadGradingGroup,
  criterion: GradingCriterion,
): GradingAuthoringResult<CadGradingGroup> => {
  const error = validateGradingCriterion(criterion);
  if (error) return fail(error);
  const members = effectiveCriteriaForCourses(criterion, current.sourceCourses, current.courseCriteria);
  if (groupTerminationRequiresTarget(criterion, members) && !nonEmpty(current.targetSurfaceId)) {
    return fail('targetSurfaceId must be non-empty when a surface-terminated criterion is effective');
  }
  if (!groupTerminationRequiresTarget(criterion, members)) {
    // All-analytic: drop any dormant target id.
    const { targetSurfaceId: _dormant, ...rest } = current;
    return { ok: true, value: { ...rest, criterion } };
  }
  return { ok: true, value: { ...current, criterion } };
};

/**
 * Phase 20E: set one criterion override on each named course (multi-select
 * apply lands as ONE undo transaction at the command layer). sparse:
 * a value equal to the group default REMOVES the record instead of
 * storing a copy. Every ref must name a traversal course (either order).
 */
export const setCourseCriteriaOverrides = (
  current: CadGradingGroup,
  courses: GradingGroupCourse[],
  criterion: GradingCriterion,
): GradingAuthoringResult<CadGradingGroup> => {
  const error = validateGradingCriterion(criterion);
  if (error) return fail(error);
  if (courses.length === 0) return fail('courses must contain at least one course');
  const members = new Set(
    current.sourceCourses.flatMap((c) => [`${c.vertexAId}>${c.vertexBId}`, `${c.vertexBId}>${c.vertexAId}`]),
  );
  const canonOf = (c: GradingGroupCourse): string => [c.vertexAId, c.vertexBId].sort().join('>');
  const seen = new Set<string>();
  for (const course of courses) {
    if (course.vertexAId === course.vertexBId) return fail('course vertex ids must differ');
    if (!members.has(`${course.vertexAId}>${course.vertexBId}`)) {
      return fail('courseCriteria references a course outside the group span');
    }
    const canon = canonOf(course);
    if (seen.has(canon)) return fail('courseCriteria duplicates a course');
    seen.add(canon);
  }
  const resetToDefault = criteriaEqual(criterion, current.criterion);
  const kept = (current.courseCriteria ?? []).filter((entry) => !seen.has(canonOf(entry.sourceCourse)));
  const next: GradingGroupCourseCriterionOverride[] = resetToDefault
    ? kept.map((entry) => ({ sourceCourse: { ...entry.sourceCourse }, criterion: { ...entry.criterion } }))
    : [
        ...kept.map((entry) => ({ sourceCourse: { ...entry.sourceCourse }, criterion: { ...entry.criterion } })),
        ...courses.map((course) => ({
          sourceCourse: { ...course },
          criterion: { ...criterion } as GradingCriterion,
        })),
      ];
  if (next.length === 0) {
    const { courseCriteria: _dropped, ...rest } = current;
    return { ok: true, value: rest };
  }
  // 20J: hybrid-legal. A surface-effective result needs a live target
  // (the command layer pre-seeds an explicit one — never silent); an
  // all-analytic result drops a dormant id.
  const memberCriteria = effectiveCriteriaForCourses(current.criterion, current.sourceCourses, next);
  if (groupTerminationRequiresTarget(current.criterion, memberCriteria)) {
    if (!nonEmpty(current.targetSurfaceId)) {
      return fail('targetSurfaceId must be non-empty when a surface-terminated criterion is effective');
    }
    return { ok: true, value: { ...current, courseCriteria: next } };
  }
  const { targetSurfaceId: _dormant, ...stripped } = current;
  return { ok: true, value: { ...stripped, courseCriteria: next } };
};

/** Phase 20E: drop the override records on the named courses (sparse reset). */
export const resetCourseCriteriaOverrides = (
  current: CadGradingGroup,
  courses: GradingGroupCourse[],
): GradingAuthoringResult<CadGradingGroup> => {
  if (courses.length === 0) return fail('courses must contain at least one course');
  const targets = new Set(
    courses.map((c) => [c.vertexAId, c.vertexBId].sort().join('>')),
  );
  const kept = (current.courseCriteria ?? []).filter(
    (entry) => !targets.has([entry.sourceCourse.vertexAId, entry.sourceCourse.vertexBId].sort().join('>')),
  );
  if (kept.length === (current.courseCriteria ?? []).length) return fail('no overrides on the named courses');
  // 20J: resetting the last surface override can land all-analytic — drop
  // a dormant target id there; a still-surface result keeps its target.
  if (kept.length === 0) {
    const { courseCriteria: _dropped, ...rest } = current;
    if (groupTerminationRequiresTarget(
      current.criterion,
      effectiveCriteriaForCourses(current.criterion, current.sourceCourses, undefined),
    )) return { ok: true, value: rest };
    const { targetSurfaceId: _dormant, ...stripped } = rest;
    return { ok: true, value: stripped };
  }
  const keptCriteria = effectiveCriteriaForCourses(current.criterion, current.sourceCourses, kept);
  if (!groupTerminationRequiresTarget(current.criterion, keptCriteria)) {
    const { targetSurfaceId: _dormant, ...stripped } = current;
    return { ok: true, value: { ...stripped, courseCriteria: kept } };
  }
  return { ok: true, value: { ...current, courseCriteria: kept } };
};

export interface EditGroupSpanResult {
  group: CadGradingGroup;
  /** Traversal refs whose override records were dropped by the span edit. */
  removedOverrides: string[];
}

/**
 * Phase 20E: replace the traversal span, dropping override records whose
 * course left the span (insert splits mint fresh ids → BROKEN_REFERENCE
 * with no migration; the caller warns on `removedOverrides`).
 */
export const editGroupSpan = (
  current: CadGradingGroup,
  sourceCourses: GradingGroupCourse[],
  closed: boolean,
): GradingAuthoringResult<EditGroupSpanResult> => {
  const chain = validateGroupChain(sourceCourses, closed);
  if (chain) return fail(chain);
  const members = new Set(
    sourceCourses.flatMap((c) => [`${c.vertexAId}>${c.vertexBId}`, `${c.vertexBId}>${c.vertexAId}`]),
  );
  const removedOverrides: string[] = [];
  const kept = (current.courseCriteria ?? []).filter((entry) => {
    const keep = members.has(`${entry.sourceCourse.vertexAId}>${entry.sourceCourse.vertexBId}`);
    if (!keep) removedOverrides.push(`${entry.sourceCourse.vertexAId}>${entry.sourceCourse.vertexBId}`);
    return keep;
  });
  const rebuilt = createGroupDefinition({
    id: current.id,
    name: current.name,
    sourceFeatureLineId: current.sourceFeatureLineId,
    sourceCourses,
    targetSurfaceId: current.targetSurfaceId,
    side: current.side,
    criterion: current.criterion,
    // 20J: kept overrides ride into the constructor so a hybrid target
    // rule (analytic default + surface override) sees its target.
    ...(kept.length > 0
      ? {
          courseCriteria: kept.map((entry) => ({
            sourceCourse: { ...entry.sourceCourse },
            criterion: { ...entry.criterion },
          })),
        }
      : {}),
    maxSearchDistance: current.maxSearchDistance,
    curveChordTolerance: current.curveChordTolerance,
    cornerMode: current.cornerMode,
    ...(closed ? { closed: true as const } : {}),
    ...(current.layerId !== undefined ? { layerId: current.layerId } : {}),
    ...(current.styleId !== undefined ? { styleId: current.styleId } : {}),
  });
  if (!rebuilt.ok) return fail(rebuilt.error);
  return { ok: true, value: { group: rebuilt.value, removedOverrides } };
};

/** Point an existing group at a different target surface (copy). */
export const reassignGroupTarget = (
  current: CadGradingGroup,
  targetSurfaceId: string,
): GradingAuthoringResult<CadGradingGroup> => {
  if (!nonEmpty(targetSurfaceId)) return fail('targetSurfaceId must be non-empty');
  return { ok: true, value: { ...current, targetSurfaceId } };
};

/** Extend an OPEN chain at either end; the new course must touch one end. */
export const addCourseToOpenEnd = (
  current: CadGradingGroup,
  course: GradingGroupCourse,
): GradingAuthoringResult<CadGradingGroup> => {
  if (current.closed === true) return fail('closed groups cannot add end courses');
  const shape = courseShapeError(course);
  if (shape) return fail(shape);
  const courses = current.sourceCourses;
  const first = courses[0]!;
  const last = courses[courses.length - 1]!;
  let next: GradingGroupCourse[];
  if (course.vertexAId === last.vertexBId) next = [...courses, { ...course }];
  else if (course.vertexBId === first.vertexAId) next = [{ ...course }, ...courses];
  else return fail('new course must continue an open-chain end');
  const chain = validateGroupChain(next, false);
  if (chain) return fail(chain);
  return { ok: true, value: { ...current, sourceCourses: next } };
};

/** Drop the first or last course of an OPEN chain; closed needs its workflow. */
export const removeEndCourse = (
  current: CadGradingGroup,
  which: RemoveEnd,
): GradingAuthoringResult<CadGradingGroup> => {
  if (current.closed === true) {
    return fail('closed groups require the explicit closed-cycle workflow');
  }
  if (current.sourceCourses.length <= 1) return fail('chain must retain at least one course');
  const next =
    which === 'first' ? current.sourceCourses.slice(1) : current.sourceCourses.slice(0, -1);
  const chain = validateGroupChain(next, false);
  if (chain) return fail(chain);
  return { ok: true, value: { ...current, sourceCourses: next.map((c) => ({ ...c })) } };
};
