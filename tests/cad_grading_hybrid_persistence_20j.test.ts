/**
 * Phase 20J Wave C1 — hybrid grading-group persistence.
 *
 * Engine side only. Pins the 20J product contract for surface+analytic
 * (hybrid) groups: authoring admits all five kinds as sparse effective
 * criteria, criterion+target override transactions are atomic (one undo,
 * explicit eligible target, rejected ops mutate nothing), persistence
 * round-trips cross-domain overrides with schema v2 + UNBUILT reopen +
 * pinned key order, and ggrev1 moves exactly on the hybrid inputs
 * (target id/rev, overrides) while dormant targets never move it.
 */
import { describe, expect, it } from 'vitest';

import {
  createBlankCadDrawingDocument,
  parseCadDrawingFile,
  serializeCadDrawingFile,
} from '../src/engine/cad/cadDrawingFile';
import {
  createCadHistoryState,
  redoCadHistory,
  runCadCommand,
  undoCadHistory,
} from '../src/engine/cad/cadUndoRedo';
import {
  createGroupDefinition,
  editGroupCriteria,
  resetCourseCriteriaOverrides,
  setCourseCriteriaOverrides,
} from '../src/engine/cad/grading/gradingGroupAuthoring';
import {
  resolveGroupMemberCriteria,
} from '../src/engine/cad/grading/gradingGroupCourseCriteria';
import {
  sanitizeCadGradingGroups,
  sanitizeCadGradingGroupsDetailed,
} from '../src/engine/cad/grading/gradingGroupPersistence';
import { buildGroupRevision } from '../src/engine/cad/grading/gradingGroupRevision';
import { resolveGroupInputs } from '../src/engine/cad/grading/gradingGroupResolve';
import { deriveGroupStatus } from '../src/engine/cad/grading/gradingGroupStatus';
import {
  groupTerminationMode,
  groupTerminationRequiresTarget,
} from '../src/engine/cad/grading/gradingGroupTermination';
import { scaleCadGradingGroup } from '../src/engine/cad/cadProjectTransformGrading';
import type { CadFeatureLineEntity, CadProject, CadSurface } from '../src/engine/cad/cadTypes';
import type { CadGradingGroup, GradingGroupCourse } from '../src/engine/cad/grading/gradingGroupTypes';
import type { GradingCriterion, ResolvedGradingSource } from '../src/engine/cad/grading/gradingTypes';

const FIXED = (g: number): GradingCriterion => ({ kind: 'fixed', gradeRatio: g });
const DIST = (g: number, d: number): GradingCriterion => ({ kind: 'distance', gradeRatio: g, distance: d });
const ELEV = (g: number, e: number): GradingCriterion => ({ kind: 'elevation', gradeRatio: g, targetElevation: e });
const REL = (g: number, dz: number): GradingCriterion =>
  ({ kind: 'relative-elevation', gradeRatio: g, relativeElevation: dz });

const COURSES: GradingGroupCourse[] = [
  { vertexAId: 'a', vertexBId: 'b' },
  { vertexAId: 'b', vertexBId: 'c' },
  { vertexAId: 'c', vertexBId: 'd' },
  { vertexAId: 'd', vertexBId: 'a' },
];

const M = (
  sx: number, sy: number, sz: number, ex: number, ey: number, ez: number,
): ResolvedGradingSource => ({
  startX: sx, startY: sy, endX: ex, endY: ey, startZ: sz, endZ: ez,
  length: Math.hypot(ex - sx, ey - sy), reoriented: false, isArc: false,
});

const hybridGroup = (): CadGradingGroup => ({
  id: 'gg', name: 'gg', sourceFeatureLineId: 'fl-1', sourceCourses: COURSES,
  targetSurfaceId: 'tgt-1', side: 'right', criterion: FIXED(-0.5),
  courseCriteria: [
    { sourceCourse: COURSES[1]!, criterion: DIST(-0.5, 20) },
    { sourceCourse: COURSES[2]!, criterion: ELEV(-0.5, 0) },
    { sourceCourse: COURSES[3]!, criterion: REL(-0.5, -10) },
  ],
  maxSearchDistance: 50, curveChordTolerance: 0.05, cornerMode: 'miter', closed: true,
});

const featureLine = (): CadFeatureLineEntity => ({
  id: 'fl-1', type: 'feature-line', layerId: 'general', visible: true, locked: false, name: 'Pad FL',
  vertices: [
    { id: 'a', x: 0, y: 0, z: 10 }, { id: 'b', x: 100, y: 0, z: 10 },
    { id: 'c', x: 100, y: 100, z: 10 }, { id: 'd', x: 0, y: 100, z: 10 },
  ],
  closed: true,
});

const flatTarget = (id: string): CadSurface => ({
  id, name: `Target ${id}`,
  definition: {
    sourceKind: 'explicit-tin',
    pointSource: { kind: 'points', pointEntityIds: [] },
    importedTin: {
      vertices: [-60, -60, 0, 160, -60, 0, 160, 160, 0, -60, 160, 0],
      faces: [0, 1, 2, 0, 2, 3],
      provenance: { kind: 'webnet-bake', sourceSurfaceId: 'seed', sourceSurfaceName: 'seed', sourceRevision: 'srev1:seed' },
    },
  },
  cachedRevision: null,
});

const projectWith = (group: CadGradingGroup): CadProject => ({
  ...createBlankCadDrawingDocument({ name: '20j-persist', units: 'm' }).project,
  entities: [featureLine()],
  surfaces: [flatTarget('tgt-1'), flatTarget('tgt-2')],
  gradingGroups: [group],
});

// ---------------------------------------------------------------------------
// 1. Authoring: all five kinds as sparse effective criteria
// ---------------------------------------------------------------------------
describe('(1) hybrid authoring', () => {
  it('derives hybrid mode from the effective set and requires a target', () => {
    const group = hybridGroup();
    const members = resolveGroupMemberCriteria(group);
    expect(groupTerminationMode(group.criterion, members)).toBe('hybrid');
    expect(groupTerminationRequiresTarget(group.criterion, members)).toBe(true);
  });

  it('creates a hybrid group with an explicit target; validates per criterion', () => {
    const created = createGroupDefinition({ ...hybridGroup(), id: 'gg2', name: 'gg2' });
    if (!created.ok) throw new Error(created.error);
    expect(created.value.targetSurfaceId).toBe('tgt-1');
    expect(created.value.courseCriteria).toHaveLength(3);
    // Per-criterion validity still fails closed (bad distance, zero grade).
    expect(createGroupDefinition({
      ...hybridGroup(), id: 'x', name: 'x',
      courseCriteria: [{ sourceCourse: COURSES[1]!, criterion: DIST(-0.5, Number.NaN) }],
    }).ok).toBe(false);
    expect(createGroupDefinition({
      ...hybridGroup(), id: 'y', name: 'y', criterion: ELEV(0, 5),
    }).ok).toBe(false);
  });

  it('refuses a surface-effective group with no live target (never silent)', () => {
    const { targetSurfaceId: _dropped, ...untargeted } = hybridGroup();
    expect(createGroupDefinition({ ...untargeted, id: 'z', name: 'z' }).ok).toBe(false);
    // Reset-to-default removes the record instead of materializing the default.
    const reset = resetCourseCriteriaOverrides(hybridGroup(), [COURSES[1]!]);
    if (!reset.ok) throw new Error(reset.error);
    expect(reset.value.courseCriteria).toHaveLength(2);
    const backToDefault = setCourseCriteriaOverrides(hybridGroup(), [COURSES[1]!], FIXED(-0.5));
    if (!backToDefault.ok) throw new Error(backToDefault.error);
    expect(backToDefault.value.courseCriteria).toHaveLength(2);
    expect(backToDefault.value.courseCriteria!.some((entry) =>
      entry.sourceCourse.vertexAId === 'b' && entry.sourceCourse.vertexBId === 'c')).toBe(false);
  });

  it('resetting the last surface override lands all-analytic and sheds the target', () => {
    const single = createGroupDefinition({
      id: 's', name: 's', sourceFeatureLineId: 'fl-1', sourceCourses: COURSES,
      targetSurfaceId: 'tgt-1', side: 'right', criterion: DIST(-0.5, 20),
      courseCriteria: [{ sourceCourse: COURSES[0]!, criterion: FIXED(-0.5) }],
      maxSearchDistance: 50, curveChordTolerance: 0.05, cornerMode: 'miter', closed: true,
    });
    if (!single.ok) throw new Error(single.error);
    const reset = resetCourseCriteriaOverrides(single.value, [COURSES[0]!]);
    if (!reset.ok) throw new Error(reset.error);
    expect(reset.value.courseCriteria).toBeUndefined();
    expect(reset.value.targetSurfaceId).toBeUndefined();
    const members = resolveGroupMemberCriteria(reset.value);
    expect(groupTerminationMode(reset.value.criterion, members)).toBe('analytic');
  });

  it('a surface default switch keeps the hybrid target; an analytic landing drops it', () => {
    const analytic = createGroupDefinition({
      id: 'an', name: 'an', sourceFeatureLineId: 'fl-1', sourceCourses: COURSES,
      side: 'right', criterion: DIST(-0.5, 20),
      maxSearchDistance: 50, curveChordTolerance: 0.05, cornerMode: 'miter', closed: true,
    });
    if (!analytic.ok) throw new Error(analytic.error);
    const toSurface = editGroupCriteria({ ...analytic.value, targetSurfaceId: 'tgt-1' }, FIXED(-0.5));
    if (!toSurface.ok) throw new Error(toSurface.error);
    expect(toSurface.value.targetSurfaceId).toBe('tgt-1');
    const backToAnalytic = editGroupCriteria(toSurface.value, DIST(-0.5, 20));
    if (!backToAnalytic.ok) throw new Error(backToAnalytic.error);
    expect(backToAnalytic.value.targetSurfaceId).toBeUndefined();
  });
});

// ---------------------------------------------------------------------------
// 2. Criterion+target atomic transactions (one undo entry, zero-mutation reject)
// ---------------------------------------------------------------------------
describe('(2) atomic criterion+target transactions', () => {
  const analyticProject = (): { project: CadProject; groupId: string } => {
    const created = createGroupDefinition({
      id: 'ag', name: 'ag', sourceFeatureLineId: 'fl-1', sourceCourses: COURSES,
      side: 'right', criterion: DIST(-0.5, 20),
      maxSearchDistance: 50, curveChordTolerance: 0.05, cornerMode: 'miter', closed: true,
    });
    if (!created.ok) throw new Error(created.error);
    return { project: projectWith(created.value), groupId: 'ag' };
  };

  it('sets a surface override + assigns the target in ONE undo entry', () => {
    const { project, groupId } = analyticProject();
    const history = createCadHistoryState(project);
    const done = runCadCommand(history, {
      key: 'GROUP_SET_COURSE_CRITERIA',
      groupId,
      courses: [COURSES[0]!],
      criterion: FIXED(-0.5),
      targetSurfaceId: 'tgt-1',
    });
    expect(done.undoStack).toHaveLength(1);
    const group = done.present.project.gradingGroups![0]!;
    expect(group.courseCriteria).toHaveLength(1);
    expect(group.targetSurfaceId).toBe('tgt-1');
    const undone = undoCadHistory(done);
    expect(undone.present.project.gradingGroups![0]!.courseCriteria).toBeUndefined();
    expect(undone.present.project.gradingGroups![0]!.targetSurfaceId).toBeUndefined();
    expect(redoCadHistory(undone).present.project.gradingGroups![0]!.targetSurfaceId).toBe('tgt-1');
  });

  it('rejects a surface override with no explicit target (never a silent first-surface)', () => {
    const { project, groupId } = analyticProject();
    const before = JSON.stringify(project.gradingGroups);
    const history = createCadHistoryState(project);
    const rejected = runCadCommand(history, {
      key: 'GROUP_SET_COURSE_CRITERIA',
      groupId,
      courses: [COURSES[0]!],
      criterion: FIXED(-0.5),
    });
    expect(rejected.undoStack).toHaveLength(0);
    expect(JSON.stringify(rejected.present.project.gradingGroups)).toBe(before);
  });

  it('rejects an unknown target id with zero mutation', () => {
    const { project, groupId } = analyticProject();
    const before = JSON.stringify(project.gradingGroups);
    const rejected = runCadCommand(createCadHistoryState(project), {
      key: 'GROUP_SET_COURSE_CRITERIA',
      groupId,
      courses: [COURSES[0]!],
      criterion: FIXED(-0.5),
      targetSurfaceId: 'no-such-surface',
    });
    expect(rejected.undoStack).toHaveLength(0);
    expect(JSON.stringify(rejected.present.project.gradingGroups)).toBe(before);
  });

  it('switches the default + assigns the target atomically via GROUP_EDIT_CRITERIA', () => {
    const { project, groupId } = analyticProject();
    const rev0 = resolveGroupInputs(project, groupId)!.revision;
    const done = runCadCommand(createCadHistoryState(project), {
      key: 'GROUP_EDIT_CRITERIA',
      groupId,
      criterion: FIXED(-0.5),
      targetSurfaceId: 'tgt-2',
    });
    expect(done.undoStack).toHaveLength(1);
    const group = done.present.project.gradingGroups![0]!;
    expect(group.criterion).toEqual(FIXED(-0.5));
    expect(group.targetSurfaceId).toBe('tgt-2');
    expect(resolveGroupInputs(done.present.project, groupId)!.revision).not.toBe(rev0);
    // Clearing the live target of a surface group rejects with zero mutation.
    const before = JSON.stringify(done.present.project.gradingGroups);
    const cleared = runCadCommand(done, { key: 'GROUP_EDIT_CRITERIA', groupId, targetSurfaceId: null });
    expect(cleared.undoStack).toHaveLength(1);
    expect(JSON.stringify(cleared.present.project.gradingGroups)).toBe(before);
  });

  it('reassigns the target of an analytic-default hybrid; blocks all-analytic reassign', () => {
    const { project, groupId } = analyticProject();
    const seeded = runCadCommand(createCadHistoryState(project), {
      key: 'GROUP_SET_COURSE_CRITERIA',
      groupId,
      courses: [COURSES[0]!],
      criterion: FIXED(-0.5),
      targetSurfaceId: 'tgt-1',
    });
    const hybridId = seeded.present.project.gradingGroups![0]!.id;
    const moved = runCadCommand(seeded, { key: 'GROUP_REASSIGN_TARGET', groupId: hybridId, targetSurfaceId: 'tgt-2' });
    expect(moved.undoStack).toHaveLength(2);
    expect(moved.present.project.gradingGroups![0]!.targetSurfaceId).toBe('tgt-2');
    const analyticOnly = runCadCommand(createCadHistoryState(project), {
      key: 'GROUP_REASSIGN_TARGET', groupId, targetSurfaceId: 'tgt-1',
    });
    expect(analyticOnly.undoStack).toHaveLength(0);
  });
});

// ---------------------------------------------------------------------------
// 3. Persistence round-trip: schema v2, key order, UNBUILT reopen
// ---------------------------------------------------------------------------
describe('(3) hybrid persistence round-trip', () => {
  it('round-trips cross-domain overrides + target with no result/status bytes', () => {
    const drawing = createBlankCadDrawingDocument({ name: '20j-save', units: 'm' });
    const text = serializeCadDrawingFile({ ...drawing, project: projectWith(hybridGroup()) });
    expect(text).toContain('relativeElevation');
    expect(text).toContain('targetSurfaceId');
    expect(text).not.toMatch(/"accuracy"|"status"|gradingGroupResult/);
    const parsed = parseCadDrawingFile(text);
    expect(parsed.ok).toBe(true);
    if (!parsed.ok) return;
    const reopened = parsed.drawing.project.gradingGroups ?? [];
    expect(reopened).toHaveLength(1);
    expect(resolveGroupMemberCriteria(reopened[0]!)).toEqual([
      FIXED(-0.5), DIST(-0.5, 20), ELEV(-0.5, 0), REL(-0.5, -10),
    ]);
    expect(reopened[0]!.targetSurfaceId).toBe('tgt-1');
  });

  it('re-saves byte-identically and keeps schema v2 with the trailing key order', () => {
    const drawing = createBlankCadDrawingDocument({ name: '20j-save', units: 'm' });
    const first = serializeCadDrawingFile({ ...drawing, project: projectWith(hybridGroup()) });
    const parsed = parseCadDrawingFile(first);
    if (!parsed.ok) throw new Error('parse failed');
    expect(parseCadDrawingFile(first).ok).toBe(true);
    const second = serializeCadDrawingFile(parsed.drawing);
    expect(second).toBe(first);
    expect(parsed.drawing.schemaVersion).toBe(2);
    const groupsAt = first.indexOf('"gradingGroups"');
    expect(groupsAt).toBeGreaterThan(-1);
    expect(first.indexOf('"gradings"') < groupsAt).toBe(true);
    const groupText = first.slice(groupsAt);
    expect(groupText.indexOf('"sourceCourses"') < groupText.indexOf('"targetSurfaceId"')).toBe(true);
    expect(groupText.indexOf('"targetSurfaceId"') < groupText.indexOf('"courseCriteria"')).toBe(true);
  });

  it('drops invalid criteria with a report and drops target-less hybrids', () => {
    const { dropped } = sanitizeCadGradingGroupsDetailed([
      {
        ...hybridGroup(),
        courseCriteria: [
          { sourceCourse: COURSES[1]!, criterion: DIST(-0.5, 20) },
          { sourceCourse: COURSES[9] ?? { vertexAId: 'x', vertexBId: 'y' }, criterion: ELEV(-0.5, 0) },
          { sourceCourse: COURSES[2]!, criterion: DIST(-0.5, Number.NaN) },
        ],
      },
    ]);
    expect(dropped.map((entry) => entry.reason).sort()).toEqual(['invalid-criterion', 'orphan']);
    const { targetSurfaceId: _dropped, ...untargeted } = hybridGroup();
    expect(sanitizeCadGradingGroups([untargeted])).toHaveLength(0);
  });

  it('reopens UNBUILT: resolvable for Calculate, no result, hybrid effective set', () => {
    const drawing = createBlankCadDrawingDocument({ name: '20j-reopen', units: 'm' });
    const parsed = parseCadDrawingFile(serializeCadDrawingFile({ ...drawing, project: projectWith(hybridGroup()) }));
    if (!parsed.ok) throw new Error('parse failed');
    const reopened = parsed.drawing.project.gradingGroups![0]!;
    // Engine-level UNBUILT: inputs resolve (calculable) but no result exists.
    const inputs = resolveGroupInputs(parsed.drawing.project, reopened.id);
    expect(inputs).not.toBeNull();
    expect(inputs!.target!.id).toBe('tgt-1');
    expect(inputs!.targetRevision).toBeDefined();
    expect(deriveGroupStatus({
      brokenRef: false, building: false, hasResult: false,
      sourceCurrent: true, needsRecalc: false,
    })).toBe('UNBUILT');
    expect(groupTerminationMode(reopened.criterion, resolveGroupMemberCriteria(reopened))).toBe('hybrid');
  });

  it('an all-analytic group resolves with no target and ignores a dormant id', () => {
    const drawing = createBlankCadDrawingDocument({ name: '20j-analytic', units: 'm' });
    const analytic: CadGradingGroup = {
      id: 'an', name: 'an', sourceFeatureLineId: 'fl-1', sourceCourses: COURSES,
      side: 'right', criterion: DIST(-0.5, 20),
      courseCriteria: [{ sourceCourse: COURSES[1]!, criterion: ELEV(-0.5, 0) }],
      maxSearchDistance: 50, curveChordTolerance: 0.05, cornerMode: 'miter', closed: true,
    };
    const parsed = parseCadDrawingFile(serializeCadDrawingFile({
      ...drawing,
      project: {
        ...projectWith(analytic),
        gradingGroups: [{ ...analytic, targetSurfaceId: 'tgt-1' }],
      },
    }));
    if (!parsed.ok) throw new Error('parse failed');
    const reopened = parsed.drawing.project.gradingGroups![0]!;
    expect(reopened.targetSurfaceId).toBeUndefined();
    const inputs = resolveGroupInputs(parsed.drawing.project, reopened.id);
    expect(inputs).not.toBeNull();
    expect(inputs!.target).toBeUndefined();
    expect(inputs!.targetRevision).toBeUndefined();
  });
});

// ---------------------------------------------------------------------------
// 4. ggrev1 pins: legacy bytes, hybrid movement, dormant no-move, reorder
// ---------------------------------------------------------------------------
describe('(4) hybrid revision pins', () => {
  const coursesOf = () => COURSES.map((course) => ({
    vertexAId: course.vertexAId, vertexBId: course.vertexBId,
    resolvedSource: M(0, 0, 10, 100, 0, 10),
  }));
  const base = () => ({
    sourceFeatureLineId: 'fl-1', courses: coursesOf(),
    targetSurfaceId: 'tgt-1', targetRevision: 'srev1:aaa',
    side: 'right' as const, criterion: FIXED(-0.5),
    maxSearchDistance: 50, curveChordTolerance: 0.05, cornerMode: 'miter' as const, closed: true,
  });

  it('keeps pre-20J homogeneous bytes identical (empty overrides = absent)', () => {
    expect(buildGroupRevision({ ...base(), courseCriteria: [] })).toBe(buildGroupRevision(base()));
    const analyticBase = { ...base(), criterion: DIST(-0.5, 20) };
    expect(buildGroupRevision({ ...analyticBase, courseCriteria: [] })).toBe(buildGroupRevision(analyticBase));
  });

  it('moves on target id, target revision, and override changes', () => {
    const rev0 = buildGroupRevision(base());
    expect(buildGroupRevision({ ...base(), targetSurfaceId: 'tgt-2' })).not.toBe(rev0);
    expect(buildGroupRevision({ ...base(), targetRevision: 'srev1:bbb' })).not.toBe(rev0);
    const withOverride = buildGroupRevision({
      ...base(),
      courseCriteria: [{ sourceCourse: COURSES[1]!, criterion: DIST(-0.5, 20) }],
    });
    expect(withOverride).not.toBe(rev0);
    // A dormant target never moves an all-analytic revision.
    const analyticBase = { ...base(), criterion: DIST(-0.5, 20) };
    const analyticRev = buildGroupRevision(analyticBase);
    expect(buildGroupRevision({ ...analyticBase, targetSurfaceId: undefined, targetRevision: undefined }))
      .toBe(analyticRev);
    // An analytic-default hybrid DOES move on the target (surface member live).
    const hybridRev = buildGroupRevision({
      ...analyticBase,
      courseCriteria: [{ sourceCourse: COURSES[1]!, criterion: FIXED(-0.5) }],
    });
    expect(hybridRev).not.toBe(analyticRev);
    expect(buildGroupRevision({
      ...analyticBase,
      targetSurfaceId: 'tgt-2',
      courseCriteria: [{ sourceCourse: COURSES[1]!, criterion: FIXED(-0.5) }],
    })).not.toBe(hybridRev);
  });

  it('is deterministic under storage reorder (canonical traversal order)', () => {
    const stored = {
      ...base(),
      courseCriteria: [
        { sourceCourse: COURSES[2]!, criterion: ELEV(-0.5, 0) },
        { sourceCourse: COURSES[1]!, criterion: DIST(-0.5, 20) },
      ],
    };
    const traversal = {
      ...base(),
      courseCriteria: [
        { sourceCourse: COURSES[1]!, criterion: DIST(-0.5, 20) },
        { sourceCourse: COURSES[2]!, criterion: ELEV(-0.5, 0) },
      ],
    };
    expect(buildGroupRevision(stored)).toBe(buildGroupRevision(traversal));
    expect(buildGroupRevision(stored)).toBe(buildGroupRevision(stored));
  });
});

// ---------------------------------------------------------------------------
// 5. Project transform ×4 oracle pin
// ---------------------------------------------------------------------------
describe('(5) project transform scaling', () => {
  it('scales search/chord/Distance ×4; never elevations, grades, side, Z, or target', () => {
    const scaled = scaleCadGradingGroup(hybridGroup(), 4);
    expect(scaled.maxSearchDistance).toBe(200);
    expect(scaled.curveChordTolerance).toBeCloseTo(0.2, 12);
    expect(scaled.criterion).toEqual(FIXED(-0.5));
    expect(scaled.side).toBe('right');
    expect(scaled.targetSurfaceId).toBe('tgt-1');
    expect(scaled.sourceCourses).toEqual(COURSES);
    const scaledMembers = resolveGroupMemberCriteria(scaled);
    expect(scaledMembers[1]).toEqual(DIST(-0.5, 80));
    expect(scaledMembers[2]).toEqual(ELEV(-0.5, 0));
    expect(scaledMembers[3]).toEqual(REL(-0.5, -10));
    // Sparse stays sparse: absent stays absent, no materialized defaults.
    expect(scaleCadGradingGroup({ ...hybridGroup(), courseCriteria: undefined }, 4).courseCriteria)
      .toBeUndefined();
  });
});
