/**
 * Phase 20E Wave-1A — per-course override authoring, transactions,
 * persistence, and worker passthrough.
 *
 * Covers §§18, 32, 33: override set/reset (duplicate BLOCK, orphan BLOCK on
 * create, sparse reset-to-default), one-undo multi-select apply, span-edit
 * orphan removal with history-label warning, insert-no-migration, reverse
 * invariance, sanitizer diagnostics, WNCAD round-trip, resolve member
 * criteria, and the worker request map.
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
  type CadHistoryState,
} from '../src/engine/cad/cadUndoRedo';
import {
  editGroupSpan,
  resetCourseCriteriaOverrides,
  setCourseCriteriaOverrides,
} from '../src/engine/cad/grading/gradingGroupAuthoring';
import {
  sanitizeCadGradingGroups,
  sanitizeCadGradingGroupsDetailed,
} from '../src/engine/cad/grading/gradingGroupPersistence';
import { resolveGroupInputs } from '../src/engine/cad/grading/gradingGroupResolve';
import { toGroupSolveInput } from '../src/workers/surfaceWorkerHandler';
import type {
  CadFeatureLineEntity,
  CadProject,
  CadSurface,
} from '../src/engine/cad/cadTypes';
import type {
  CadGradingGroup,
  GradingGroupCourse,
} from '../src/engine/cad/grading/gradingGroupTypes';
import type { GradingCriterion } from '../src/engine/cad/grading/gradingTypes';

const FIXED_HALF: GradingCriterion = { kind: 'fixed', gradeRatio: -0.5 };
const FIXED_STEEP: GradingCriterion = { kind: 'fixed', gradeRatio: -1.0 };

let seq = 0;
const nextId = (prefix: string): string => {
  seq += 1;
  return `${prefix}-20e-gc${seq}`;
};

const vertex = (id: string, x: number, y: number, z: number) => ({ id, x, y, z });

const makeChainFeatureLine = (id: string): CadFeatureLineEntity => ({
  id,
  type: 'feature-line',
  layerId: 'general',
  visible: true,
  locked: false,
  name: `FL ${id}`,
  vertices: [
    vertex(`vertex:${id}:a`, 0, 0, 10),
    vertex(`vertex:${id}:b`, 100, 0, 10),
    vertex(`vertex:${id}:c`, 100, 100, 10),
  ],
});

const makeFlatTarget = (id: string, name: string): CadSurface => ({
  id,
  name,
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

const world = (): { project: CadProject; flId: string; targetId: string; vids: string[] } => {
  const drawing = createBlankCadDrawingDocument({ name: 'Group Overrides', units: 'm' });
  const flId = nextId('fl');
  const targetId = nextId('tgt');
  const project: CadProject = {
    ...drawing.project,
    entities: [makeChainFeatureLine(flId)],
    surfaces: [makeFlatTarget(targetId, 'Target')],
  };
  const entity = project.entities.find((entry) => entry.id === flId) as CadFeatureLineEntity;
  return { project, flId, targetId, vids: entity.vertices.map((v) => v.id) };
};

const createGroup = (
  state: CadHistoryState,
  params: {
    name: string;
    flId: string;
    courses: Array<[string, string]>;
    targetId: string;
    courseCriteria?: Array<{ course: [string, string]; criterion: GradingCriterion }>;
  },
): CadHistoryState =>
  runCadCommand(state, {
    key: 'GROUP_CREATE',
    name: params.name,
    sourceFeatureLineId: params.flId,
    sourceCourses: params.courses.map(([vertexAId, vertexBId]) => ({ vertexAId, vertexBId })),
    targetSurfaceId: params.targetId,
    side: 'right',
    criterion: FIXED_HALF,
    maxSearchDistance: 50,
    curveChordTolerance: 0.05,
    ...(params.courseCriteria !== undefined
      ? {
          courseCriteria: params.courseCriteria.map((entry) => ({
            sourceCourse: { vertexAId: entry.course[0], vertexBId: entry.course[1] },
            criterion: entry.criterion,
          })),
        }
      : {}),
  });

const groupOf = (project: CadProject, name: string): CadGradingGroup => {
  const group = (project.gradingGroups ?? []).find((entry) => entry.name === name);
  if (!group) throw new Error(`group ${name} missing`);
  return group;
};

describe('20E authoring: set/reset overrides', () => {
  const base: CadGradingGroup = {
    id: 'g', name: 'G', sourceFeatureLineId: 'fl',
    sourceCourses: [
      { vertexAId: 'a', vertexBId: 'b' },
      { vertexAId: 'b', vertexBId: 'c' },
    ],
    targetSurfaceId: 'tgt', side: 'right', criterion: FIXED_HALF,
    maxSearchDistance: 50, curveChordTolerance: 0.05, cornerMode: 'miter',
  };

  it('set stores a sparse record; reset removes it (field absent)', () => {
    const set = setCourseCriteriaOverrides(base, [{ vertexAId: 'a', vertexBId: 'b' }], FIXED_STEEP);
    expect(set.ok).toBe(true);
    if (!set.ok) return;
    expect(set.value.courseCriteria).toEqual([
      { sourceCourse: { vertexAId: 'a', vertexBId: 'b' }, criterion: FIXED_STEEP },
    ]);
    const reset = resetCourseCriteriaOverrides(set.value, [{ vertexAId: 'a', vertexBId: 'b' }]);
    expect(reset.ok).toBe(true);
    if (!reset.ok) return;
    expect(reset.value.courseCriteria).toBeUndefined();
    expect('courseCriteria' in reset.value).toBe(false);
  });

  it('set-to-default removes the record instead of storing a copy', () => {
    const set = setCourseCriteriaOverrides(base, [{ vertexAId: 'a', vertexBId: 'b' }], FIXED_STEEP);
    expect(set.ok).toBe(true);
    if (!set.ok) return;
    const backToDefault = setCourseCriteriaOverrides(
      set.value, [{ vertexAId: 'a', vertexBId: 'b' }], { kind: 'fixed', gradeRatio: -0.5 },
    );
    expect(backToDefault.ok).toBe(true);
    if (!backToDefault.ok) return;
    expect(backToDefault.value.courseCriteria).toBeUndefined();
  });

  it('duplicate refs BLOCK; orphan refs BLOCK; bad criterion BLOCKs', () => {
    expect(setCourseCriteriaOverrides(
      base,
      [{ vertexAId: 'a', vertexBId: 'b' }, { vertexAId: 'b', vertexBId: 'a' }],
      FIXED_STEEP,
    ).ok).toBe(false);
    expect(setCourseCriteriaOverrides(
      base, [{ vertexAId: 'a', vertexBId: 'zzz' }], FIXED_STEEP,
    ).ok).toBe(false);
    expect(setCourseCriteriaOverrides(
      base,
      [{ vertexAId: 'a', vertexBId: 'b' }],
      { kind: 'fixed', gradeRatio: NaN },
    ).ok).toBe(false);
    expect(resetCourseCriteriaOverrides(base, [{ vertexAId: 'a', vertexBId: 'b' }]).ok).toBe(false);
  });
});

describe('20E authoring: span edit + insert + reverse', () => {
  const base: CadGradingGroup = {
    id: 'g', name: 'G', sourceFeatureLineId: 'fl',
    sourceCourses: [
      { vertexAId: 'a', vertexBId: 'b' },
      { vertexAId: 'b', vertexBId: 'c' },
    ],
    targetSurfaceId: 'tgt', side: 'right', criterion: FIXED_HALF,
    maxSearchDistance: 50, curveChordTolerance: 0.05, cornerMode: 'miter',
    courseCriteria: [
      { sourceCourse: { vertexAId: 'a', vertexBId: 'b' }, criterion: FIXED_STEEP },
      { sourceCourse: { vertexAId: 'b', vertexBId: 'c' }, criterion: FIXED_STEEP },
    ],
  };

  it('dropping a course removes its orphan override and reports it', () => {
    const edited = editGroupSpan(base, [{ vertexAId: 'b', vertexBId: 'c' }], false);
    expect(edited.ok).toBe(true);
    if (!edited.ok) return;
    expect(edited.value.removedOverrides).toEqual(['a>b']);
    expect(edited.value.group.courseCriteria).toEqual([
      { sourceCourse: { vertexAId: 'b', vertexBId: 'c' }, criterion: FIXED_STEEP },
    ]);
  });

  it('insert (fresh ids, no migration) orphans the split-course override', () => {
    // Insert of vertex n between a and b: the a>b record names a dead ref.
    const edited = editGroupSpan(
      base,
      [
        { vertexAId: 'a', vertexBId: 'n' },
        { vertexAId: 'n', vertexBId: 'b' },
        { vertexAId: 'b', vertexBId: 'c' },
      ],
      false,
    );
    expect(edited.ok).toBe(true);
    if (!edited.ok) return;
    expect(edited.value.removedOverrides).toEqual(['a>b']);
    expect(edited.value.group.courseCriteria).toEqual([
      { sourceCourse: { vertexAId: 'b', vertexBId: 'c' }, criterion: FIXED_STEEP },
    ]);
  });

  it('reversed span keeps both overrides (reverse invariant)', () => {
    const edited = editGroupSpan(
      base,
      [
        { vertexAId: 'c', vertexBId: 'b' },
        { vertexAId: 'b', vertexBId: 'a' },
      ],
      false,
    );
    expect(edited.ok).toBe(true);
    if (!edited.ok) return;
    expect(edited.value.removedOverrides).toEqual([]);
    expect(edited.value.group.courseCriteria).toHaveLength(2);
  });
});

describe('20E transactions: set/reset/span/create', () => {
  it('GROUP_CREATE accepts valid overrides; duplicate/orphan BLOCK', () => {
    const { project, flId, targetId, vids } = world();
    const [a, b, c] = vids as [string, string, string];
    const state0 = createCadHistoryState(project);
    const okState = createGroup(state0, {
      name: 'G', flId, targetId,
      courses: [[a!, b!], [b!, c!]],
      courseCriteria: [{ course: [b!, c!], criterion: FIXED_STEEP }],
    });
    expect(groupOf(okState.present.project, 'G').courseCriteria).toEqual([
      { sourceCourse: { vertexAId: b, vertexBId: c }, criterion: FIXED_STEEP },
    ]);
    const dupState = createGroup(state0, {
      name: 'G2', flId, targetId,
      courses: [[a!, b!], [b!, c!]],
      courseCriteria: [
        { course: [b!, c!], criterion: FIXED_STEEP },
        { course: [c!, b!], criterion: FIXED_HALF },
      ],
    });
    expect(dupState.present.project.gradingGroups).toHaveLength(0);
    const orphanState = createGroup(state0, {
      name: 'G3', flId, targetId,
      courses: [[a!, b!], [b!, c!]],
      courseCriteria: [{ course: [a!, c!], criterion: FIXED_STEEP }],
    });
    expect(orphanState.present.project.gradingGroups).toHaveLength(0);
  });

  it('one undo step applies a multi-select set; undo/redo round-trips it', () => {
    const { project, flId, targetId, vids } = world();
    const [a, b, c] = vids as [string, string, string];
    let state = createGroup(createCadHistoryState(project), {
      name: 'G', flId, targetId, courses: [[a!, b!], [b!, c!]],
    });
    const group = groupOf(state.present.project, 'G');
    const undoDepth = state.undoStack.length;
    state = runCadCommand(state, {
      key: 'GROUP_SET_COURSE_CRITERIA',
      groupId: group.id,
      courses: [
        { vertexAId: a!, vertexBId: b! },
        { vertexAId: b!, vertexBId: c! },
      ] as GradingGroupCourse[],
      criterion: FIXED_STEEP,
    });
    // Exactly one history entry for the multi-select apply.
    expect(state.undoStack.length).toBe(undoDepth + 1);
    expect(groupOf(state.present.project, 'G').courseCriteria).toHaveLength(2);
    state = undoCadHistory(state);
    expect(groupOf(state.present.project, 'G').courseCriteria).toBeUndefined();
    state = redoCadHistory(state);
    expect(groupOf(state.present.project, 'G').courseCriteria).toHaveLength(2);
    // Reset drops both in one step.
    state = runCadCommand(state, {
      key: 'GROUP_RESET_COURSE_CRITERIA',
      groupId: group.id,
      courses: [{ vertexAId: a!, vertexBId: b! }] as GradingGroupCourse[],
    });
    expect(groupOf(state.present.project, 'G').courseCriteria).toHaveLength(1);
  });

  it('span-edit drops the orphan override with a history-label warning', () => {
    const { project, flId, targetId, vids } = world();
    const [a, b, c] = vids as [string, string, string];
    let state = createGroup(createCadHistoryState(project), {
      name: 'G', flId, targetId,
      courses: [[a!, b!], [b!, c!]],
      courseCriteria: [{ course: [a!, b!], criterion: FIXED_STEEP }],
    });
    const group = groupOf(state.present.project, 'G');
    state = runCadCommand(state, {
      key: 'GROUP_EDIT_SPAN',
      groupId: group.id,
      sourceCourses: [{ vertexAId: b!, vertexBId: c! }],
    });
    const after = groupOf(state.present.project, 'G');
    expect(after.sourceCourses).toEqual([{ vertexAId: b, vertexBId: c }]);
    expect(after.courseCriteria).toBeUndefined();
    expect(state.undoStack.at(-1)!.transaction.label).toContain('dropped 1 orphan');
  });
});

describe('20E persistence: sanitize + round-trip', () => {
  it('sanitizer drops orphans/duplicates/invalid with diagnostics; legacy absent stays absent', () => {
    const group: CadGradingGroup = {
      id: 'g', name: 'G', sourceFeatureLineId: 'fl',
      sourceCourses: [
        { vertexAId: 'a', vertexBId: 'b' },
        { vertexAId: 'b', vertexBId: 'c' },
      ],
      targetSurfaceId: 'tgt', side: 'right', criterion: FIXED_HALF,
      maxSearchDistance: 50, curveChordTolerance: 0.05, cornerMode: 'miter',
    };
    const raw = [{
      ...group,
      courseCriteria: [
        { sourceCourse: { vertexAId: 'a', vertexBId: 'b' }, criterion: FIXED_STEEP },
        { sourceCourse: { vertexAId: 'b', vertexBId: 'a' }, criterion: FIXED_HALF },
        { sourceCourse: { vertexAId: 'a', vertexBId: 'zzz' }, criterion: FIXED_STEEP },
        { sourceCourse: { vertexAId: 'b', vertexBId: 'c' }, criterion: { kind: 'fixed', gradeRatio: NaN } },
      ],
    }];
    const detailed = sanitizeCadGradingGroupsDetailed(raw);
    expect(detailed.groups).toHaveLength(1);
    expect(detailed.groups[0]!.courseCriteria).toEqual([
      { sourceCourse: { vertexAId: 'a', vertexBId: 'b' }, criterion: FIXED_STEEP },
    ]);
    expect(detailed.dropped).toEqual([
      { groupId: 'g', ref: 'b>a', reason: 'duplicate' },
      { groupId: 'g', ref: 'a>zzz', reason: 'orphan' },
      { groupId: 'g', ref: 'b>c', reason: 'invalid-criterion' },
    ]);
    // Legacy shape (field absent) passes through with no drops and no field.
    const legacy = sanitizeCadGradingGroups([group]);
    expect(legacy).toHaveLength(1);
    expect('courseCriteria' in legacy[0]!).toBe(false);
    expect(sanitizeCadGradingGroupsDetailed([group]).dropped).toEqual([]);
  });

  it('WNCAD round-trips overrides byte-exact with results absent', () => {
    const { project, flId, targetId, vids } = world();
    const [a, b, c] = vids as [string, string, string];
    const state = createGroup(createCadHistoryState(project), {
      name: 'G', flId, targetId,
      courses: [[a!, b!], [b!, c!]],
      courseCriteria: [{ course: [b!, c!], criterion: FIXED_STEEP }],
    });
    const drawing = { ...createBlankCadDrawingDocument({ name: 'x', units: 'm' }), project: state.present.project };
    const parsed = parseCadDrawingFile(serializeCadDrawingFile(drawing));
    expect(parsed.ok).toBe(true);
    if (!parsed.ok) return;
    expect(parsed.drawing.project.gradingGroups).toEqual(state.present.project.gradingGroups);
  });
});

describe('20E resolve + worker passthrough', () => {
  it('resolveGroupInputs carries per-member effective criteria', () => {
    const { project, flId, targetId, vids } = world();
    const [a, b, c] = vids as [string, string, string];
    const state = createGroup(createCadHistoryState(project), {
      name: 'G', flId, targetId,
      courses: [[a!, b!], [b!, c!]],
      courseCriteria: [{ course: [b!, c!], criterion: FIXED_STEEP }],
    });
    const group = groupOf(state.present.project, 'G');
    const inputs = resolveGroupInputs(state.present.project, group.id);
    expect(inputs).not.toBeNull();
    expect(inputs!.memberCriteria).toEqual([FIXED_HALF, FIXED_STEEP]);
    expect(inputs!.revision).toContain('ggrev1:');
  });

  it('toGroupSolveInput carries memberCriteria; absent stays legacy', () => {
    const target = { points: [0, 0, 0], triangles: [0, 0, 0] };
    const withOverrides = toGroupSolveInput({
      groupId: 'g', revision: 'ggrev1:x', memberSources: [], side: 'right',
      criterion: FIXED_HALF, memberCriteria: [FIXED_HALF, FIXED_STEEP],
      maxSearchDistance: 50, curveChordTolerance: 0.05, closed: false, target,
    });
    expect(withOverrides.memberCriteria).toEqual([FIXED_HALF, FIXED_STEEP]);
    const legacy = toGroupSolveInput({
      groupId: 'g', revision: 'ggrev1:x', memberSources: [], side: 'right',
      criterion: FIXED_HALF,
      maxSearchDistance: 50, curveChordTolerance: 0.05, closed: false, target,
    });
    expect(legacy.memberCriteria).toBeUndefined();
  });
});
