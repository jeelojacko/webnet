import { createStableRuntimeId } from '../id';
import { buildFeatureLineEntity } from './cadFeatureLineCreate';
import { resolveCadFeatureLine } from './cadFeatureLines';
import { canonicalizeBakedTin } from './cadExplicitBake';
import { validateExplicitTinPayload } from './cadImportedTin';
import {
  addCourseToOpenEnd,
  createGroupDefinition,
  editGroupCriteria,
  editGroupSpan,
  reassignGroupTarget,
  removeEndCourse,
  resetCourseCriteriaOverrides,
  setCourseCriteriaOverrides,
  validateGroupChain,
} from './grading/gradingGroupAuthoring';
import { toGradingCourseLikes, resolveGradingSourceCourse } from './grading/gradingCourseFrame';
import { resolveGroupInputs } from './grading/gradingGroupResolve';
import { appendCadProjectEntities } from './cadProjectState';
import { commitLayerProject } from './cadTransactionsLayerCommands';
import type {
  CadCommand,
  CadCommandDefinition,
} from './cadTransactions.types';
import type {
  CadProject,
  CadSurface,
} from './cadTypes';
import type {
  CadGradingGroup,
  GradingGroupCourse,
} from './grading/gradingGroupTypes';

/**
 * Phase 20C Wave-3 group definition + snapshot transactions.
 *
 * History: GROUP_CREATE (single side only — no Both-Sides pair), GROUP_DELETE
 * (no cascade — extracts/baked surfaces are snapshots), GROUP_EDIT_CRITERIA
 * (criterion/search/chord), GROUP_REASSIGN_TARGET, GROUP_EDIT_SPAN,
 * GROUP_ADD_COURSE / GROUP_REMOVE_END_COURSE (both → NEEDS_RECALC by revision
 * move), GROUPEXTRACTDAYLIGHT and GROUPBAKE (one entry each). Calculate and
 * worker results NEVER touch history (service-owned).
 */

const findGroup = (project: CadProject, groupId: string): CadGradingGroup | undefined =>
  (project.gradingGroups ?? []).find((entry) => entry.id === groupId);

const nextGroupName = (project: CadProject): string => {
  const taken = new Set((project.gradingGroups ?? []).map((entry) => entry.name));
  let index = (project.gradingGroups ?? []).length + 1;
  while (taken.has(`Grading Group ${index}`)) index += 1;
  return `Grading Group ${index}`;
};

const isGroupNameTaken = (project: CadProject, name: string, exceptId?: string): boolean =>
  (project.gradingGroups ?? []).some(
    (entry) => entry.id !== exceptId && entry.name === name,
  );

/** Fail-closed: source FL exists with every chain course still resolvable. */
const chainResolvable = (
  project: CadProject,
  sourceFeatureLineId: string,
  courses: GradingGroupCourse[],
): boolean => {
  const entity = project.entities.find(
    (entry) => entry.type === 'feature-line' && entry.id === sourceFeatureLineId,
  );
  if (!entity || entity.type !== 'feature-line') return false;
  const resolved = resolveCadFeatureLine(entity);
  if (!resolved) return false;
  const likes = toGradingCourseLikes(resolved.courses);
  return courses.every(
    (course) =>
      resolveGradingSourceCourse(likes, course.vertexAId, course.vertexBId) !== null,
  );
};

const withGroup = (project: CadProject, group: CadGradingGroup): CadProject => ({
  ...project,
  gradingGroups: (project.gradingGroups ?? []).map((entry) =>
    entry.id === group.id ? group : entry,
  ),
});

type GroupCreateCommand = Extract<CadCommand, { key: 'GROUP_CREATE' }>;

const groupCreateCommand: CadCommandDefinition<GroupCreateCommand> = {
  key: 'GROUP_CREATE',
  execute: (snapshot, command) => {
    const target = (snapshot.project.surfaces ?? []).find(
      (entry) => entry.id === command.targetSurfaceId,
    );
    if (!target) return null;
    if (!chainResolvable(snapshot.project, command.sourceFeatureLineId, command.sourceCourses)) {
      return null;
    }
    const baseName = command.name?.trim() || nextGroupName(snapshot.project);
    if (isGroupNameTaken(snapshot.project, baseName)) return null;
    const created = createGroupDefinition({
      id: createStableRuntimeId('cad-grading-group'),
      name: baseName,
      sourceFeatureLineId: command.sourceFeatureLineId,
      sourceCourses: command.sourceCourses,
      targetSurfaceId: command.targetSurfaceId,
      side: command.side,
      criterion: command.criterion,
      maxSearchDistance: command.maxSearchDistance,
      curveChordTolerance: command.curveChordTolerance,
      cornerMode: command.cornerMode ?? 'miter',
      ...(command.closed === true ? { closed: true as const } : {}),
      ...(command.layerId !== undefined ? { layerId: command.layerId } : {}),
      ...(command.courseCriteria !== undefined ? { courseCriteria: command.courseCriteria } : {}),
    });
    if (!created.ok) return null;
    return commitLayerProject('GROUP_CREATE', snapshot, {
      ...snapshot.project,
      gradingGroups: [...(snapshot.project.gradingGroups ?? []), created.value],
    }, `GROUP_CREATE (${baseName})`);
  },
};

type GroupDeleteCommand = Extract<CadCommand, { key: 'GROUP_DELETE' }>;

const groupDeleteCommand: CadCommandDefinition<GroupDeleteCommand> = {
  key: 'GROUP_DELETE',
  execute: (snapshot, command) => {
    const group = findGroup(snapshot.project, command.groupId);
    if (!group) return null;
    // No cascade: daylight extracts and baked surfaces are snapshots and stay.
    return commitLayerProject('GROUP_DELETE', snapshot, {
      ...snapshot.project,
      gradingGroups: (snapshot.project.gradingGroups ?? []).filter((entry) => entry.id !== group.id),
    }, `GROUP_DELETE (${group.name})`);
  },
};

type GroupEditCriteriaCommand = Extract<CadCommand, { key: 'GROUP_EDIT_CRITERIA' }>;

const groupEditCriteriaCommand: CadCommandDefinition<GroupEditCriteriaCommand> = {
  key: 'GROUP_EDIT_CRITERIA',
  execute: (snapshot, command) => {
    const group = findGroup(snapshot.project, command.groupId);
    if (!group) return null;
    if (
      command.criterion === undefined &&
      command.maxSearchDistance === undefined &&
      command.curveChordTolerance === undefined
    ) {
      return null;
    }
    let next = group;
    if (command.criterion !== undefined) {
      const edited = editGroupCriteria(next, command.criterion);
      if (!edited.ok) return null;
      next = edited.value;
    }
    if (command.maxSearchDistance !== undefined) {
      if (!Number.isFinite(command.maxSearchDistance) || !(command.maxSearchDistance > 0)) return null;
      next = { ...next, maxSearchDistance: command.maxSearchDistance };
    }
    if (command.curveChordTolerance !== undefined) {
      if (!Number.isFinite(command.curveChordTolerance) || !(command.curveChordTolerance > 0)) return null;
      next = { ...next, curveChordTolerance: command.curveChordTolerance };
    }
    // Revision moves → NEEDS_RECALC derives; cached results keyed by ggrev go stale.
    return commitLayerProject('GROUP_EDIT_CRITERIA', snapshot, withGroup(snapshot.project, next),
      `GROUP_EDIT_CRITERIA (${group.name})`);
  },
};

type GroupReassignTargetCommand = Extract<CadCommand, { key: 'GROUP_REASSIGN_TARGET' }>;

const groupReassignTargetCommand: CadCommandDefinition<GroupReassignTargetCommand> = {
  key: 'GROUP_REASSIGN_TARGET',
  execute: (snapshot, command) => {
    const group = findGroup(snapshot.project, command.groupId);
    if (!group) return null;
    const target = (snapshot.project.surfaces ?? []).find(
      (entry) => entry.id === command.targetSurfaceId,
    );
    if (!target || target.id === group.targetSurfaceId) return null;
    const reassigned = reassignGroupTarget(group, target.id);
    if (!reassigned.ok) return null;
    return commitLayerProject('GROUP_REASSIGN_TARGET', snapshot, withGroup(snapshot.project, reassigned.value),
      `GROUP_REASSIGN_TARGET (${group.name})`);
  },
};

type GroupEditSpanCommand = Extract<CadCommand, { key: 'GROUP_EDIT_SPAN' }>;

const groupEditSpanCommand: CadCommandDefinition<GroupEditSpanCommand> = {
  key: 'GROUP_EDIT_SPAN',
  execute: (snapshot, command) => {
    const group = findGroup(snapshot.project, command.groupId);
    if (!group) return null;
    const closed = command.closed ?? (group.closed === true);
    const chain = validateGroupChain(command.sourceCourses, closed);
    if (chain) return null;
    if (!chainResolvable(snapshot.project, group.sourceFeatureLineId, command.sourceCourses)) {
      return null;
    }
    const edited = editGroupSpan(group, command.sourceCourses, closed);
    if (!edited.ok) return null;
    // Orphan overrides (courses that left the span) drop with a history-label warning.
    const dropped = edited.value.removedOverrides.length;
    const label = dropped > 0
      ? `GROUP_EDIT_SPAN (${group.name}, dropped ${dropped} orphan course-criterion override${dropped === 1 ? '' : 's'})`
      : `GROUP_EDIT_SPAN (${group.name})`;
    return commitLayerProject('GROUP_EDIT_SPAN', snapshot, withGroup(snapshot.project, edited.value.group), label);
  },
};

type GroupAddCourseCommand = Extract<CadCommand, { key: 'GROUP_ADD_COURSE' }>;

const groupAddCourseCommand: CadCommandDefinition<GroupAddCourseCommand> = {
  key: 'GROUP_ADD_COURSE',
  execute: (snapshot, command) => {
    const group = findGroup(snapshot.project, command.groupId);
    if (!group) return null;
    const added = addCourseToOpenEnd(group, command.course);
    if (!added.ok) return null;
    if (!chainResolvable(snapshot.project, group.sourceFeatureLineId, added.value.sourceCourses)) {
      return null;
    }
    return commitLayerProject('GROUP_ADD_COURSE', snapshot, withGroup(snapshot.project, added.value),
      `GROUP_ADD_COURSE (${group.name})`);
  },
};

type GroupRemoveEndCourseCommand = Extract<CadCommand, { key: 'GROUP_REMOVE_END_COURSE' }>;

const groupRemoveEndCourseCommand: CadCommandDefinition<GroupRemoveEndCourseCommand> = {
  key: 'GROUP_REMOVE_END_COURSE',
  execute: (snapshot, command) => {
    const group = findGroup(snapshot.project, command.groupId);
    if (!group) return null;
    const removed = removeEndCourse(group, command.which);
    if (!removed.ok) return null;
    return commitLayerProject('GROUP_REMOVE_END_COURSE', snapshot, withGroup(snapshot.project, removed.value),
      `GROUP_REMOVE_END_COURSE (${group.name})`);
  },
};

type GroupSetCourseCriteriaCommand = Extract<CadCommand, { key: 'GROUP_SET_COURSE_CRITERIA' }>;

/**
 * Phase 20E: apply one criterion to every named course in ONE undo step
 * (default edit + multi-select apply). Sparse: a value equal to the group
 * default removes those records. Duplicate/orphan refs BLOCK (null).
 */
const groupSetCourseCriteriaCommand: CadCommandDefinition<GroupSetCourseCriteriaCommand> = {
  key: 'GROUP_SET_COURSE_CRITERIA',
  execute: (snapshot, command) => {
    const group = findGroup(snapshot.project, command.groupId);
    if (!group) return null;
    const applied = setCourseCriteriaOverrides(group, command.courses, command.criterion);
    if (!applied.ok) return null;
    return commitLayerProject('GROUP_SET_COURSE_CRITERIA', snapshot, withGroup(snapshot.project, applied.value),
      `GROUP_SET_COURSE_CRITERIA (${group.name})`);
  },
};

type GroupResetCourseCriteriaCommand = Extract<CadCommand, { key: 'GROUP_RESET_COURSE_CRITERIA' }>;

/** Phase 20E: drop override records on the named courses (one undo step). */
const groupResetCourseCriteriaCommand: CadCommandDefinition<GroupResetCourseCriteriaCommand> = {
  key: 'GROUP_RESET_COURSE_CRITERIA',
  execute: (snapshot, command) => {
    const group = findGroup(snapshot.project, command.groupId);
    if (!group) return null;
    const reset = resetCourseCriteriaOverrides(group, command.courses);
    if (!reset.ok) return null;
    return commitLayerProject('GROUP_RESET_COURSE_CRITERIA', snapshot, withGroup(snapshot.project, reset.value),
      `GROUP_RESET_COURSE_CRITERIA (${group.name})`);
  },
};

/**
 * Calculate dispatch gate (NO history entry — pure check the UI runs before
 * service dispatch). Requires a resolvable definition; target CURRENT-ness
 * is session-owned (tinCache), so the caller passes it in: false →
 * SOURCE_NOT_CURRENT fail-closed. Cut/fill source coverage is enforced in
 * the worker (TARGET_GAP fail-closed).
 */
export const groupCalculateGate = (
  project: CadProject,
  groupId: string,
  targetCurrent: boolean,
): { ok: true; revision: string } | { ok: false; message: string } => {
  const inputs = resolveGroupInputs(project, groupId);
  if (!inputs) {
    return { ok: false, message: `Group grading calculation blocked: group “${groupId}” has a broken source or target reference.` };
  }
  if (!targetCurrent) {
    return {
      ok: false,
      message: `Group grading calculation blocked: target TIN for “${inputs.target.name}” is not CURRENT (SOURCE_NOT_CURRENT) — rebuild it first.`,
    };
  }
  return { ok: true, revision: inputs.revision };
};

type GroupExtractCommand = Extract<CadCommand, { key: 'GROUPEXTRACTDAYLIGHT' }>;

/**
 * GROUPEXTRACTDAYLIGHT: snapshot the cached merged daylight boundary into a
 * NEW CadFeatureLineEntity (`<name> - Daylight`, fresh ids, exact cached
 * XYZ, no live dependency, piecewise LINE courses always). Open groups →
 * open line; closed groups → closed line. Requires CURRENT (ggrev match +
 * session CURRENT assertion) + a passed-in cached result.
 */
const groupExtractCommand: CadCommandDefinition<GroupExtractCommand> = {
  key: 'GROUPEXTRACTDAYLIGHT',
  execute: (snapshot, command) => {
    const inputs = resolveGroupInputs(snapshot.project, command.groupId);
    if (!inputs) return null;
    if (command.sessionCurrent !== true) return null;
    const result = command.result;
    if (result.groupId !== inputs.group.id) return null;
    if (result.revision !== inputs.revision || command.expectedRevision !== inputs.revision) {
      return null;
    }
    if (result.daylightPoints.length < 6 || result.daylightPoints.length % 3 !== 0) return null;
    const vertices: Array<{ x: number; y: number }> = [];
    const elevations: number[] = [];
    for (let i = 0; i + 2 < result.daylightPoints.length; i += 3) {
      vertices.push({ x: result.daylightPoints[i]!, y: result.daylightPoints[i + 1]! });
      elevations.push(result.daylightPoints[i + 2]!);
    }
    const entity = buildFeatureLineEntity(
      snapshot.project,
      { vertices, elevations, closed: inputs.group.closed === true },
      { name: `${inputs.group.name} - Daylight`, createdBy: 'GROUPEXTRACTDAYLIGHT' },
    );
    if (!entity) return null;
    return commitLayerProject('GROUPEXTRACTDAYLIGHT', snapshot,
      appendCadProjectEntities(snapshot.project, [entity]),
      `GROUPEXTRACTDAYLIGHT (${entity.name})`);
  },
};

type GroupBakeCommand = Extract<CadCommand, { key: 'GROUPBAKE' }>;

const uniqueBakedGroupSurfaceName = (project: CadProject, groupName: string): string => {
  const taken = new Set((project.surfaces ?? []).map((entry) => entry.name));
  const base = `${groupName} - Baked`;
  if (!taken.has(base)) return base;
  let index = 2;
  while (taken.has(`${base} (${index})`)) index += 1;
  return `${base} (${index})`;
};

/**
 * GROUPBAKE: snapshot the calculated group strip mesh into a new
 * explicit-TIN surface (`kind: 'webnet-grading-group-bake'` provenance).
 * Requires CURRENT + nonzero mesh + expected revision. TIED/empty meshes
 * (zero-area ties bake nothing) block.
 */
const groupBakeCommand: CadCommandDefinition<GroupBakeCommand> = {
  key: 'GROUPBAKE',
  execute: (snapshot, command) => {
    const inputs = resolveGroupInputs(snapshot.project, command.groupId);
    if (!inputs) return null;
    if (command.sessionCurrent !== true) return null;
    const result = command.result;
    if (result.groupId !== inputs.group.id) return null;
    if (result.revision !== inputs.revision || command.expectedRevision !== inputs.revision) {
      return null;
    }
    if (result.gradingMesh.triangles.length === 0) return null;
    const canonical = canonicalizeBakedTin(result.gradingMesh.points, result.gradingMesh.triangles);
    const payload = {
      vertices: canonical.vertices,
      faces: canonical.faces,
      provenance: {
        kind: 'webnet-grading-group-bake' as const,
        groupId: inputs.group.id,
        groupName: inputs.group.name,
        groupRevision: inputs.revision,
        sourceFeatureLineId: inputs.group.sourceFeatureLineId,
        sourceCourseRefs: inputs.group.sourceCourses.map(
          (course) => `${course.vertexAId}>${course.vertexBId}`,
        ),
        targetSurfaceId: inputs.target.id,
        side: inputs.group.side,
        accuracy: result.accuracy,
        cornerMode: inputs.group.cornerMode,
      },
    };
    if (validateExplicitTinPayload(payload) != null) return null;
    const surface: CadSurface = {
      id: createStableRuntimeId('cad-surface'),
      name: uniqueBakedGroupSurfaceName(snapshot.project, inputs.group.name),
      definition: {
        sourceKind: 'explicit-tin',
        pointSource: { kind: 'points', pointEntityIds: [] },
        importedTin: payload,
      },
      ...(inputs.group.layerId != null ? { layerId: inputs.group.layerId } : {}),
      cachedRevision: null,
    };
    return commitLayerProject('GROUPBAKE', snapshot, {
      ...snapshot.project,
      surfaces: [...(snapshot.project.surfaces ?? []), surface],
    }, `GROUPBAKE (${surface.name})`);
  },
};

export const gradingGroupCommandDefinitions = {
  GROUP_CREATE: groupCreateCommand,
  GROUP_DELETE: groupDeleteCommand,
  GROUP_EDIT_CRITERIA: groupEditCriteriaCommand,
  GROUP_REASSIGN_TARGET: groupReassignTargetCommand,
  GROUP_EDIT_SPAN: groupEditSpanCommand,
  GROUP_ADD_COURSE: groupAddCourseCommand,
  GROUP_REMOVE_END_COURSE: groupRemoveEndCourseCommand,
  GROUP_SET_COURSE_CRITERIA: groupSetCourseCriteriaCommand,
  GROUP_RESET_COURSE_CRITERIA: groupResetCourseCriteriaCommand,
  GROUPEXTRACTDAYLIGHT: groupExtractCommand,
  GROUPBAKE: groupBakeCommand,
} as const;
