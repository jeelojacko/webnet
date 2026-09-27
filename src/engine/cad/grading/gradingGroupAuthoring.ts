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
} from './gradingGroupTypes';
import {
  validateGradingCriterion,
  type GradingAuthoringResult,
} from './gradingAuthoring';

export interface CreateGroupInput {
  id: string;
  name: string;
  sourceFeatureLineId: string;
  sourceCourses: GradingGroupCourse[];
  targetSurfaceId: string;
  side: GradingSide;
  criterion: GradingCriterion;
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
  input: Pick<CreateGroupInput, 'id' | 'name' | 'sourceFeatureLineId' | 'targetSurfaceId' | 'side'>,
): string | null => {
  if (!nonEmpty(input.id)) return 'id must be non-empty';
  if (!nonEmpty(input.name)) return 'name must be non-empty';
  if (!nonEmpty(input.sourceFeatureLineId)) return 'sourceFeatureLineId must be non-empty';
  if (!nonEmpty(input.targetSurfaceId)) return 'targetSurfaceId must be non-empty';
  return input.side === 'left' || input.side === 'right' ? null : 'side must be left or right';
};

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

const toGroup = (input: CreateGroupInput): CadGradingGroup => ({
  id: input.id,
  name: input.name,
  sourceFeatureLineId: input.sourceFeatureLineId,
  sourceCourses: input.sourceCourses.map((course) => ({ ...course })),
  targetSurfaceId: input.targetSurfaceId,
  side: input.side,
  criterion: input.criterion,
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
  const scalars = scalarError(input);
  if (scalars) return fail(scalars);
  const chain = validateGroupChain(input.sourceCourses, input.closed === true);
  if (chain) return fail(chain);
  return { ok: true, value: toGroup(input) };
};

/** Replace the shared criterion on an existing group (returns a copy). */
export const editGroupCriteria = (
  current: CadGradingGroup,
  criterion: GradingCriterion,
): GradingAuthoringResult<CadGradingGroup> => {
  const error = validateGradingCriterion(criterion);
  if (error) return fail(error);
  return { ok: true, value: { ...current, criterion } };
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
