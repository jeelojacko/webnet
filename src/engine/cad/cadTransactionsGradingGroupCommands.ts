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
import { gradingTerminationKind } from './grading/gradingTypes';
import { criteriaEqual, effectiveCriteriaForCourses } from './grading/gradingGroupCourseCriteria';
import { resolveGroupMemberCriteria } from './grading/gradingGroupCourseCriteria';
import {
  canonicalAnalyticKinds,
  canonicalTerminationKinds,
  groupTerminationMode,
  groupTerminationRequiresTarget,
} from './grading/gradingGroupTermination';
import { toGradingCourseLikes, resolveGradingSourceCourse } from './grading/gradingCourseFrame';
import { resolveGroupInputs } from './grading/gradingGroupResolve';
import { gradingTopologyCertificateProductError } from './grading/gradingTopologyCertificate';
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

/**
 * Phase 20J: criterion+target atomicity. Applies an explicit target to a
 * working copy (string must name a live surface; null clears); undefined
 * keeps the retained id. Null = unknown surface id (caller rejects).
 * Never picks a silent first-surface default.
 */
const applyExplicitGroupTarget = (
  project: CadProject,
  group: CadGradingGroup,
  targetSurfaceId: string | null | undefined,
): CadGradingGroup | null => {
  if (targetSurfaceId === undefined) return group;
  if (targetSurfaceId === null) {
    const { targetSurfaceId: _dropped, ...rest } = group;
    return rest;
  }
  const exists = (project.surfaces ?? []).some((entry) => entry.id === targetSurfaceId);
  if (!exists) return null;
  return { ...group, targetSurfaceId };
};

/** Effective-set target rule: a surface-effective group must carry a live id. */
const effectiveTargetRule = (
  criterion: CadGradingGroup['criterion'],
  memberCriteria: CadGradingGroup['criterion'][],
  targetSurfaceId: string | undefined,
): string | null =>
  groupTerminationRequiresTarget(criterion, memberCriteria) && targetSurfaceId === undefined
    ? 'targetSurfaceId must be non-empty when a surface-terminated criterion is effective'
    : null;

type GroupCreateCommand = Extract<CadCommand, { key: 'GROUP_CREATE' }>;

const groupCreateCommand: CadCommandDefinition<GroupCreateCommand> = {
  key: 'GROUP_CREATE',
  execute: (snapshot, command) => {
    // 20J: the target rule derives from the EFFECTIVE per-course set
    // (Wave C4: a fully-overridden stored default is invisible) — a
    // hybrid create needs a live target even under an analytic default;
    // an all-analytic create omits it.
    const effectiveForCreate = effectiveCriteriaForCourses(
      command.criterion,
      command.sourceCourses,
      command.courseCriteria,
    );
    const requiresSurface = groupTerminationRequiresTarget(command.criterion, effectiveForCreate);
    const target = requiresSurface
      ? (snapshot.project.surfaces ?? []).find((entry) => entry.id === command.targetSurfaceId)
      : undefined;
    if (requiresSurface && !target) return null;
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
      ...(target ? { targetSurfaceId: target.id } : {}),
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
      command.targetSurfaceId === undefined &&
      command.maxSearchDistance === undefined &&
      command.curveChordTolerance === undefined
    ) {
      return null;
    }
    // 20J: kind switch + target land in ONE history entry against the
    // EFFECTIVE set (incoming default + retained overrides): a hybrid
    // result needs an explicit eligible target, an all-analytic result
    // never carries one. Rejected ops return null with zero mutation.
    const nextCriterion = command.criterion ?? group.criterion;
    // Wave C4 EFFECTIVE per-course list (fully-overridden default invisible).
    const retainedMembers = effectiveCriteriaForCourses(
      nextCriterion,
      group.sourceCourses,
      group.courseCriteria,
    );
    let next = group;
    if (command.targetSurfaceId !== undefined) {
      if (command.targetSurfaceId === null) {
        // Clear allowed only for all-analytic results.
        if (groupTerminationRequiresTarget(nextCriterion, retainedMembers)) return null;
        if (group.targetSurfaceId === undefined) return null;
        const { targetSurfaceId: _dropped, ...rest } = next;
        next = rest;
      } else {
        const exists = (snapshot.project.surfaces ?? []).some(
          (entry) => entry.id === command.targetSurfaceId,
        );
        if (!exists) return null;
        // Analytic-only results never carry a target id.
        if (!groupTerminationRequiresTarget(nextCriterion, retainedMembers)) return null;
        next = { ...next, targetSurfaceId: command.targetSurfaceId };
      }
    }
    if (command.criterion !== undefined) {
      const edited = editGroupCriteria(next, command.criterion);
      if (!edited.ok) return null;
      next = edited.value;
    } else if (command.targetSurfaceId !== undefined) {
      // Target-only path: the pure criterion edit above is skipped, so
      // enforce the effective target rule here.
      const members = effectiveCriteriaForCourses(next.criterion, next.sourceCourses, next.courseCriteria);
      if (effectiveTargetRule(next.criterion, members, next.targetSurfaceId) !== null) return null;
    }
    if (command.maxSearchDistance !== undefined) {
      if (!Number.isFinite(command.maxSearchDistance) || !(command.maxSearchDistance > 0)) return null;
      next = { ...next, maxSearchDistance: command.maxSearchDistance };
    }
    if (command.curveChordTolerance !== undefined) {
      if (!Number.isFinite(command.curveChordTolerance) || !(command.curveChordTolerance > 0)) return null;
      next = { ...next, curveChordTolerance: command.curveChordTolerance };
    }
    if (next === group) return null;
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
    // 20J: reassignment is live-target-only — surface and hybrid groups
    // (ANY effective surface member); all-analytic groups carry no target.
    const members = resolveGroupMemberCriteria(group);
    if (!groupTerminationRequiresTarget(group.criterion, members)) return null;
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
 * Phase 20J: an explicit target rides in the SAME undo entry (string must
 * name a live surface; null clears for all-analytic results only). A
 * surface-effective result with no live target rejects — never a silent
 * first-surface pick; rejected ops mutate nothing.
 */
const groupSetCourseCriteriaCommand: CadCommandDefinition<GroupSetCourseCriteriaCommand> = {
  key: 'GROUP_SET_COURSE_CRITERIA',
  execute: (snapshot, command) => {
    const group = findGroup(snapshot.project, command.groupId);
    if (!group) return null;
    const base = applyExplicitGroupTarget(snapshot.project, group, command.targetSurfaceId);
    if (!base) return null;
    const applied = setCourseCriteriaOverrides(base, command.courses, command.criterion);
    if (!applied.ok) return null;
    return commitLayerProject('GROUP_SET_COURSE_CRITERIA', snapshot, withGroup(snapshot.project, applied.value),
      `GROUP_SET_COURSE_CRITERIA (${group.name})`);
  },
};

type GroupResetCourseCriteriaCommand = Extract<CadCommand, { key: 'GROUP_RESET_COURSE_CRITERIA' }>;

/**
 * Phase 20E: drop override records on the named courses (one undo step).
 * Phase 20J: same atomic target rule as GROUP_SET_COURSE_CRITERIA.
 */
const groupResetCourseCriteriaCommand: CadCommandDefinition<GroupResetCourseCriteriaCommand> = {
  key: 'GROUP_RESET_COURSE_CRITERIA',
  execute: (snapshot, command) => {
    const group = findGroup(snapshot.project, command.groupId);
    if (!group) return null;
    const base = applyExplicitGroupTarget(snapshot.project, group, command.targetSurfaceId);
    if (!base) return null;
    const reset = resetCourseCriteriaOverrides(base, command.courses);
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
  if (!targetCurrent && inputs.target) {
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
 * NEW CadFeatureLineEntity (fresh ids, exact cached XYZ, no live
 * dependency, piecewise LINE courses always). Open groups → open line;
 * closed groups → closed line. Hybrid groups extract as
 * `<name> - Grading Boundary`; homogeneous groups keep the legacy
 * `<name> - Daylight`. Requires CURRENT (ggrev match + session CURRENT
 * assertion) + a passed-in cached result.
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
    // 20K.2: refuse an uncertified / forged / mismatched CURRENT mesh.
    if (gradingTopologyCertificateProductError(result.topologyCertificate, 'group', result.gradingMesh) != null) return null;
    // 20J: the final boundary term is `Grading Boundary` for hybrid groups
    // only; homogeneous extracts keep their exact legacy name. The
    // `daylightPoints` result field is unchanged in every mode.
    const boundaryName = groupTerminationMode(inputs.group.criterion, inputs.memberCriteria) === 'hybrid'
      ? `${inputs.group.name} - Grading Boundary`
      : `${inputs.group.name} - Daylight`;
    const vertices: Array<{ x: number; y: number }> = [];
    const elevations: number[] = [];
    for (let i = 0; i + 2 < result.daylightPoints.length; i += 3) {
      vertices.push({ x: result.daylightPoints[i]!, y: result.daylightPoints[i + 1]! });
      elevations.push(result.daylightPoints[i + 2]!);
    }
    const entity = buildFeatureLineEntity(
      snapshot.project,
      { vertices, elevations, closed: inputs.group.closed === true },
      { name: boundaryName, createdBy: 'GROUPEXTRACTDAYLIGHT' },
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
    // 20K.2: refuse an uncertified / forged / mismatched CURRENT mesh.
    if (gradingTopologyCertificateProductError(result.topologyCertificate, 'group', result.gradingMesh) != null) return null;
    const criterion = inputs.group.criterion;
    // Phase 20J: the bake targetKind reflects the EFFECTIVE per-course
    // criteria. Homogeneous groups keep their exact legacy shape;
    // mixed-analytic groups keep `mixed-analytic` + analyticKinds; hybrid
    // (surface+analytic) groups record `hybrid` + canonical
    // terminationKinds and always carry the live target id — never a
    // singular criterionDistance/targetElevation/relativeElevation value.
    const effective = inputs.memberCriteria.length > 0 ? inputs.memberCriteria : [criterion];
    const hybrid = groupTerminationMode(criterion, effective) === 'hybrid';
    const analyticKinds = canonicalAnalyticKinds(effective);
    const terminationKinds = canonicalTerminationKinds(effective);
    const mixed = !hybrid && analyticKinds.length > 1;
    const targetKind: 'surface' | 'distance' | 'elevation' | 'relative-elevation' | 'mixed-analytic' | 'hybrid' =
      hybrid ? 'hybrid' : mixed ? 'mixed-analytic' : gradingTerminationKind(effective[0]!);
    // Singular value fields describe the calculated result: the stored
    // default while it is effective on at least one course, else the first
    // effective criterion. Mixed groups carry no singular value by contract.
    const representative = effective.some((entry) => criteriaEqual(entry, criterion))
      ? criterion
      : effective[0]!;
    if ((targetKind === 'surface' || targetKind === 'hybrid') && !inputs.target) return null;
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
        targetKind,
        ...(mixed ? { analyticKinds } : {}),
        ...(hybrid ? { terminationKinds } : {}),
        ...((targetKind === 'surface' || targetKind === 'hybrid') && inputs.target !== undefined
          ? { targetSurfaceId: inputs.target.id }
          : {}),
        ...(!mixed && !hybrid && representative.kind === 'distance' ? { criterionDistance: representative.distance } : {}),
        ...(!mixed && !hybrid && representative.kind === 'elevation' ? { targetElevation: representative.targetElevation } : {}),
        ...(!mixed && !hybrid && representative.kind === 'relative-elevation' ? { relativeElevation: representative.relativeElevation } : {}),
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
