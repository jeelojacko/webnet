/**
 * Phase 20C Wave-2B — engine-side grading-GROUP input resolution.
 *
 * Mirrors `gradingResolve.ts` for a group: loads the persisted group
 * definition, resolves EVERY ordered course of the shared Feature Line in the
 * group's persisted A->B direction (either storage order is reoriented), checks
 * the chain against the CURRENT courses, validates a closed source loop, and
 * derives the `ggrev1:` group revision. Null = BROKEN_REFERENCE downstream.
 *
 * No worker imports. Pure read of the project; never mutates definitions.
 */
import { resolveCadFeatureLine } from '../cadFeatureLines';
import { computeCadSurfaceSourceRevision } from '../cadSurfaceRevision';
import type { CadProject, CadSurface } from '../cadTypes';
import { resolveGradingSourceCourse, toGradingCourseLikes } from './gradingCourseFrame';
import { courseCriterionKey, resolveGroupMemberCriteria } from './gradingGroupCourseCriteria';
import { buildGroupRevision, type GroupRevisionCourse } from './gradingGroupRevision';
import type { CadGradingGroup } from './gradingGroupTypes';
import type { CadGradingTransition } from './gradingGroupTypes';
import { groupTerminationRequiresTarget } from './gradingGroupTermination';
import type { GradingCriterion, ResolvedGradingSource } from './gradingTypes';

export interface ResolvedGroupInputs {
  group: CadGradingGroup;
  /** One resolved A->B source per group course, in traversal order. */
  memberSources: ResolvedGradingSource[];
  /** Phase 20E: effective criterion per member (override or group default). */
  memberCriteria: GradingCriterion[];
  /**
   * Phase 20M.2 Wave B: stable member identity per member in traversal
   * order (`courseCriterionKey` in persisted A->B direction). Lets the
   * transition path verify member refs without positional trust.
   */
  memberKeys: string[];
  /**
   * Phase 20M.2 Wave B: retained transition intents verbatim (selection +
   * admission happen downstream; absent/empty = exact legacy).
   */
  transitions?: CadGradingTransition[];
  /** Present only for surface-family groups; undefined for analytic families. */
  target?: CadSurface;
  targetRevision?: string;
  revision: string;
}

export type GroupResolveResult =
  | { ok: true; inputs: ResolvedGroupInputs }
  | { ok: false; reason: string };

/**
 * The trailing `gradingGroups` project key lands with the project-integration
 * wave. Read it structurally so this slice compiles (and fails closed) before
 * the key is typed on `CadProject`.
 */
const projectGroups = (project: CadProject): CadGradingGroup[] =>
  (project as CadProject & { gradingGroups?: CadGradingGroup[] }).gradingGroups ?? [];

const findSurface = (project: CadProject, surfaceId: string): CadSurface | undefined =>
  (project.surfaces ?? []).find((entry) => entry.id === surfaceId);

/** Persisted-chain contiguity by vertex id (the group definition contract). */
export const validateGroupChainAgainstGroup = (group: CadGradingGroup): string | null => {
  const courses = group.sourceCourses;
  if (courses.length === 0) return 'group has no source courses';
  for (let index = 0; index + 1 < courses.length; index += 1) {
    if (courses[index]!.vertexBId !== courses[index + 1]!.vertexAId) {
      return 'group source courses are not contiguous';
    }
  }
  if (group.closed === true) {
    if (courses[courses.length - 1]!.vertexBId !== courses[0]!.vertexAId) {
      return 'closed group does not return to its first vertex';
    }
    if (courses.length < 3) return 'closed group needs at least three courses';
  }
  return null;
};

const orient = (px: number, py: number, qx: number, qy: number, rx: number, ry: number): number => {
  const cross = (qy - py) * (rx - qx) - (qx - px) * (ry - qy);
  if (cross > 0) return 1;
  if (cross < 0) return -1;
  return 0;
};

const onSegment = (
  px: number,
  py: number,
  qx: number,
  qy: number,
  rx: number,
  ry: number,
): boolean =>
  Math.min(px, qx) <= rx &&
  rx <= Math.max(px, qx) &&
  Math.min(py, qy) <= ry &&
  ry <= Math.max(py, qy);

interface PlanSegment {
  ax: number;
  ay: number;
  bx: number;
  by: number;
}

const segmentsIntersect = (s: PlanSegment, t: PlanSegment): boolean => {
  const o1 = orient(s.ax, s.ay, s.bx, s.by, t.ax, t.ay);
  const o2 = orient(s.ax, s.ay, s.bx, s.by, t.bx, t.by);
  const o3 = orient(t.ax, t.ay, t.bx, t.by, s.ax, s.ay);
  const o4 = orient(t.ax, t.ay, t.bx, t.by, s.bx, s.by);
  if (o1 !== o2 && o3 !== o4) return true;
  if (o1 === 0 && onSegment(s.ax, s.ay, s.bx, s.by, t.ax, t.ay)) return true;
  if (o2 === 0 && onSegment(s.ax, s.ay, s.bx, s.by, t.bx, t.by)) return true;
  if (o3 === 0 && onSegment(t.ax, t.ay, t.bx, t.by, s.ax, s.ay)) return true;
  if (o4 === 0 && onSegment(t.ax, t.ay, t.bx, t.by, s.bx, s.by)) return true;
  return false;
};

/**
 * Closed-loop plan sanity: every resolved course finite with positive plan
 * length, and the closed plan polyline free of self-intersections. Named
 * helper so the caller can surface the specific GROUP_SELF_INTERSECTION
 * reason instead of a bare null.
 * ponytail: checks the resolved course chords; a loop whose arcs cross only
 * inside a chord is not caught until arcs are analyzed by the group kernel.
 */
export const validateClosedGroupLoop = (sources: ResolvedGradingSource[]): string | null => {
  if (sources.length < 3) return 'closed group needs at least three courses';
  const segments: PlanSegment[] = [];
  for (const source of sources) {
    if (![source.startX, source.startY, source.endX, source.endY].every(Number.isFinite)) {
      return 'closed group has non-finite plan geometry';
    }
    if (!(source.length > 0) || !Number.isFinite(source.length)) {
      return 'closed group has a zero-length course';
    }
    segments.push({ ax: source.startX, ay: source.startY, bx: source.endX, by: source.endY });
  }
  const count = segments.length;
  for (let i = 0; i < count; i += 1) {
    for (let j = i + 1; j < count; j += 1) {
      const adjacent = j === i + 1 || (i === 0 && j === count - 1);
      if (adjacent) continue;
      if (segmentsIntersect(segments[i]!, segments[j]!)) {
        return `closed group source loop self-intersects (courses ${i} and ${j})`;
      }
    }
  }
  return null;
};

/**
 * Resolve with a failure reason (used for group diagnostics); the public
 * `resolveGroupInputs` collapses this to null for the BROKEN_REFERENCE gate.
 */
export const resolveGroupInputsWithReason = (
  project: CadProject,
  groupId: string,
): GroupResolveResult => {
  const group = projectGroups(project).find((entry) => entry.id === groupId);
  if (!group) return { ok: false, reason: 'grading group not found' };
  const chain = validateGroupChainAgainstGroup(group);
  if (chain) return { ok: false, reason: chain };
  const entity = project.entities.find(
    (entry) => entry.type === 'feature-line' && entry.id === group.sourceFeatureLineId,
  );
  if (!entity || entity.type !== 'feature-line') {
    return { ok: false, reason: 'group source feature line not found' };
  }
  const resolvedFeatureLine = resolveCadFeatureLine(entity);
  if (!resolvedFeatureLine) return { ok: false, reason: 'group source feature line is invalid' };
  const courses = toGradingCourseLikes(resolvedFeatureLine.courses);
  const memberSources: ResolvedGradingSource[] = [];
  for (const course of group.sourceCourses) {
    const resolved = resolveGradingSourceCourse(courses, course.vertexAId, course.vertexBId);
    if (!resolved) {
      return {
        ok: false,
        reason: `group course ${course.vertexAId}->${course.vertexBId} is missing from the current source`,
      };
    }
    memberSources.push(resolved);
  }
  if (group.closed === true) {
    const loop = validateClosedGroupLoop(memberSources);
    if (loop) return { ok: false, reason: loop };
  }
  const memberCriteria = resolveGroupMemberCriteria(group);
  // Phase 20H: derive the domain set from ALL effective member criteria
  // (default + overrides). Phase 20J Wave B: surface+analytic mixes resolve
  // as hybrid (exact-common-tie engine proof); malformed states still fail
  // closed downstream. An all-analytic group never queries a target: a
  // dormant legacy target id is ignored entirely (never BROKEN_REFERENCE).
  // Surface and hybrid groups still require a resolvable target.
  const requiresSurface = groupTerminationRequiresTarget(group.criterion, memberCriteria);
  let target: CadSurface | undefined;
  let targetRevision: string | undefined;
  if (requiresSurface) {
    if (group.targetSurfaceId === undefined) {
      return { ok: false, reason: 'group target surface not found' };
    }
    target = findSurface(project, group.targetSurfaceId);
    if (!target) return { ok: false, reason: 'group target surface not found' };
    targetRevision = computeCadSurfaceSourceRevision(project, target);
  }
  const coursesForRevision: GroupRevisionCourse[] = group.sourceCourses.map((course, index) => ({
    vertexAId: course.vertexAId,
    vertexBId: course.vertexBId,
    resolvedSource: memberSources[index]!,
  }));
  const revision = buildGroupRevision({
    sourceFeatureLineId: group.sourceFeatureLineId,
    courses: coursesForRevision,
    ...(target !== undefined ? { targetSurfaceId: target.id } : {}),
    ...(targetRevision !== undefined ? { targetRevision } : {}),
    side: group.side,
    criterion: group.criterion,
    courseCriteria: group.courseCriteria,
    // Phase 20M.2 Wave B: transition canonical fields participate; absent
    // stays absent so legacy hashes are byte-identical.
    ...(group.transitions !== undefined ? { transitions: group.transitions } : {}),
    maxSearchDistance: group.maxSearchDistance,
    curveChordTolerance: group.curveChordTolerance,
    cornerMode: group.cornerMode,
    closed: group.closed === true,
  });
  return {
    ok: true,
    inputs: {
      group,
      memberSources,
      memberCriteria,
      memberKeys: group.sourceCourses.map((course) =>
        courseCriterionKey(course.vertexAId, course.vertexBId),
      ),
      ...(group.transitions !== undefined ? { transitions: group.transitions } : {}),
      ...(target !== undefined ? { target } : {}),
      ...(targetRevision !== undefined ? { targetRevision } : {}),
      revision,
    },
  };
};

/**
 * Resolve a group definition to its calculation inputs, or null when any
 * reference is broken (missing group/source/target, non-adjacent current
 * course inserted between chain vertices, or an invalid closed loop).
 */
export const resolveGroupInputs = (
  project: CadProject,
  groupId: string,
): ResolvedGroupInputs | null => {
  const outcome = resolveGroupInputsWithReason(project, groupId);
  return outcome.ok ? outcome.inputs : null;
};
