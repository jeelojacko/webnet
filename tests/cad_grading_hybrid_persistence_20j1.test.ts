/**
 * Phase 20J1 — hybrid persistence sanitizer regression matrix.
 *
 * Pins the 20J1 fix: the load sanitizer validates the base shape WITHOUT
 * the target gate, scrubs raw `courseCriteria` against the validated
 * courses, then runs ONE authoring construction with the scrubbed
 * effective set — so a fully-overridden stored default is invisible to
 * the target rule (surface-default + all-analytic overrides + no target
 * survives save/reopen instead of silently dropping).
 */
import { describe, expect, it } from 'vitest';

import {
  createBlankCadDrawingDocument,
  parseCadDrawingFile,
  serializeCadDrawingFile,
} from '../src/engine/cad/cadDrawingFile';
import { createGroupDefinition } from '../src/engine/cad/grading/gradingGroupAuthoring';
import { computeGradingGroupFromSnapshots } from '../src/engine/cad/grading/gradingGroupCompute';
import {
  effectiveCriteriaForCourses,
  resolveGroupMemberCriteria,
} from '../src/engine/cad/grading/gradingGroupCourseCriteria';
import { sanitizeCadGradingGroupsDetailed } from '../src/engine/cad/grading/gradingGroupPersistence';
import { resolveGroupInputs } from '../src/engine/cad/grading/gradingGroupResolve';
import { buildGroupRevision } from '../src/engine/cad/grading/gradingGroupRevision';
import { deriveGroupStatus } from '../src/engine/cad/grading/gradingGroupStatus';
import {
  groupTerminationMode,
  groupTerminationRequiresTarget,
} from '../src/engine/cad/grading/gradingGroupTermination';
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

const M = (sx: number, sy: number, ex: number, ey: number): ResolvedGradingSource => ({
  startX: sx, startY: sy, endX: ex, endY: ey, startZ: 10, endZ: 10,
  length: Math.hypot(ex - sx, ey - sy), reoriented: false, isArc: false,
});
const SQUARE = [M(0, 0, 100, 0), M(100, 0, 100, 100), M(100, 100, 0, 100), M(0, 100, 0, 0)];

const featureLine = (): CadFeatureLineEntity => ({
  id: 'fl-1', type: 'feature-line', layerId: 'general', visible: true, locked: false, name: 'FL',
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

const projectWith = (groups: CadGradingGroup[]): CadProject => ({
  ...createBlankCadDrawingDocument({ name: '20j1', units: 'm' }).project,
  entities: [featureLine()],
  surfaces: [flatTarget('tgt-1'), flatTarget('tgt-2')],
  gradingGroups: groups,
});

const rawGroup = (overrides: Partial<CadGradingGroup>): Record<string, unknown> => ({
  id: 'gg', name: 'gg', sourceFeatureLineId: 'fl-1',
  sourceCourses: COURSES.map((c) => ({ ...c })),
  side: 'right', criterion: FIXED(-0.5),
  maxSearchDistance: 50, curveChordTolerance: 0.05, cornerMode: 'miter', closed: true,
  ...overrides,
});

const sanitizeOne = (raw: Record<string, unknown>) =>
  sanitizeCadGradingGroupsDetailed([raw]);

const modeOf = (group: CadGradingGroup) =>
  groupTerminationMode(group.criterion, resolveGroupMemberCriteria(group));

// ---------------------------------------------------------------------------
// §8 persistence matrix A–I
// ---------------------------------------------------------------------------
describe('20j1 §8 persistence matrix', () => {
  it('A: surface-default + all-Distance overrides + no target survives', () => {
    const { groups, dropped } = sanitizeOne(rawGroup({
      courseCriteria: COURSES.map((c) => ({ sourceCourse: { ...c }, criterion: DIST(-0.5, 20) })),
    }));
    expect(dropped).toEqual([]);
    expect(groups).toHaveLength(1);
    expect(groups[0]!.targetSurfaceId).toBeUndefined();
    expect(modeOf(groups[0]!)).toBe('analytic');
  });

  it('B: mixed-analytic full override (analytic default) + no target survives', () => {
    const { groups } = sanitizeOne(rawGroup({
      criterion: DIST(-0.5, 20),
      courseCriteria: [
        { sourceCourse: { ...COURSES[0]! }, criterion: ELEV(-0.5, 0) },
        { sourceCourse: { ...COURSES[1]! }, criterion: REL(-0.5, -10) },
        { sourceCourse: { ...COURSES[2]! }, criterion: DIST(-0.25, 30) },
        { sourceCourse: { ...COURSES[3]! }, criterion: ELEV(-0.5, 5) },
      ],
    }));
    expect(groups).toHaveLength(1);
    expect(groups[0]!.targetSurfaceId).toBeUndefined();
    expect(modeOf(groups[0]!)).toBe('analytic');
  });

  it('C: partial override is hybrid — kept with target, dropped without', () => {
    const partial = {
      courseCriteria: [
        { sourceCourse: { ...COURSES[0]! }, criterion: DIST(-0.5, 20) },
        { sourceCourse: { ...COURSES[1]! }, criterion: ELEV(-0.5, 0) },
      ],
    };
    const kept = sanitizeOne(rawGroup({ ...partial, targetSurfaceId: 'tgt-1' }));
    expect(kept.groups).toHaveLength(1);
    expect(kept.groups[0]!.targetSurfaceId).toBe('tgt-1');
    expect(modeOf(kept.groups[0]!)).toBe('hybrid');
    expect(sanitizeOne(rawGroup(partial)).groups).toHaveLength(0);
  });

  it('D: analytic-default + all-Surface overrides — kept with target, dropped without', () => {
    const allSurface = {
      criterion: DIST(-0.5, 20),
      courseCriteria: COURSES.map((c) => ({ sourceCourse: { ...c }, criterion: FIXED(-0.5) })),
    };
    const kept = sanitizeOne(rawGroup({ ...allSurface, targetSurfaceId: 'tgt-1' }));
    expect(kept.groups).toHaveLength(1);
    expect(kept.groups[0]!.targetSurfaceId).toBe('tgt-1');
    expect(modeOf(kept.groups[0]!)).toBe('surface');
    expect(sanitizeOne(rawGroup(allSurface)).groups).toHaveLength(0);
  });

  it('E: analytic-default + one Surface override stays hybrid with its target', () => {
    const { groups } = sanitizeOne(rawGroup({
      criterion: DIST(-0.5, 20),
      courseCriteria: [{ sourceCourse: { ...COURSES[0]! }, criterion: FIXED(-0.5) }],
      targetSurfaceId: 'tgt-1',
    }));
    expect(groups).toHaveLength(1);
    expect(groups[0]!.targetSurfaceId).toBe('tgt-1');
    expect(modeOf(groups[0]!)).toBe('hybrid');
  });

  it('F: dormant target on an all-analytic group strips; revision tgt:none; re-save stable', () => {
    const { groups } = sanitizeOne(rawGroup({
      criterion: DIST(-0.5, 20),
      courseCriteria: [{ sourceCourse: { ...COURSES[1]! }, criterion: ELEV(-0.5, 0) }],
      targetSurfaceId: 'tgt-1',
    }));
    expect(groups).toHaveLength(1);
    expect(groups[0]!.targetSurfaceId).toBeUndefined();
    const courses = COURSES.map((c) => ({
      vertexAId: c.vertexAId, vertexBId: c.vertexBId, resolvedSource: M(0, 0, 100, 0),
    }));
    const revInput = {
      sourceFeatureLineId: 'fl-1', courses,
      side: 'right' as const, criterion: DIST(-0.5, 20),
      courseCriteria: [{ sourceCourse: { ...COURSES[1]! }, criterion: ELEV(-0.5, 0) }],
      maxSearchDistance: 50, curveChordTolerance: 0.05, cornerMode: 'miter' as const, closed: true,
    };
    expect(buildGroupRevision(revInput)).toBe(buildGroupRevision({
      ...revInput, targetSurfaceId: 'tgt-1', targetRevision: 'srev1:aaa',
    }));
    const drawing = createBlankCadDrawingDocument({ name: '20j1-dormant', units: 'm' });
    const first = serializeCadDrawingFile({ ...drawing, project: projectWith(groups as CadGradingGroup[]) });
    const parsed = parseCadDrawingFile(first);
    if (!parsed.ok) throw new Error('parse failed');
    expect(serializeCadDrawingFile(parsed.drawing)).toBe(first);
  });

  it('G: invalid override reveals the surface default — dropped without target (reason), kept with', () => {
    const raw = {
      courseCriteria: [
        { sourceCourse: { ...COURSES[0]! }, criterion: DIST(-0.5, 20) },
        { sourceCourse: { ...COURSES[1]! }, criterion: DIST(-0.5, Number.NaN) },
      ],
    };
    const untargeted = sanitizeOne(rawGroup(raw));
    expect(untargeted.groups).toHaveLength(0);
    expect(untargeted.dropped.map((d) => d.reason)).toEqual(['invalid-criterion']);
    const targeted = sanitizeOne(rawGroup({ ...raw, targetSurfaceId: 'tgt-1' }));
    expect(targeted.groups).toHaveLength(1);
    expect(targeted.groups[0]!.targetSurfaceId).toBe('tgt-1');
    expect(modeOf(targeted.groups[0]!)).toBe('hybrid');
    expect(targeted.groups[0]!.courseCriteria).toHaveLength(1);
  });

  it('H: orphan/duplicate/invalid siblings drop with reports; the valid override survives', () => {
    const { groups, dropped } = sanitizeOne(rawGroup({
      criterion: DIST(-0.5, 20),
      courseCriteria: [
        { sourceCourse: { ...COURSES[0]! }, criterion: ELEV(-0.5, 0) },
        { sourceCourse: { vertexAId: 'x', vertexBId: 'y' }, criterion: ELEV(-0.5, 0) },
        { sourceCourse: { ...COURSES[0]! }, criterion: REL(-0.5, -10) },
        { sourceCourse: { ...COURSES[1]! }, criterion: DIST(-0.5, Number.NaN) },
      ],
    }));
    expect(groups).toHaveLength(1);
    expect(groups[0]!.courseCriteria).toHaveLength(1);
    expect(dropped.map((d) => d.reason).sort()).toEqual(['duplicate', 'invalid-criterion', 'orphan']);
  });

  it('I: hybrid serialize/parse/reserialize is byte-identical, schema v2, canonical key order', () => {
    const created = createGroupDefinition({
      id: 'gg', name: 'gg', sourceFeatureLineId: 'fl-1', sourceCourses: COURSES,
      targetSurfaceId: 'tgt-1', side: 'right', criterion: FIXED(-0.5),
      courseCriteria: [
        { sourceCourse: COURSES[1]!, criterion: DIST(-0.5, 20) },
        { sourceCourse: COURSES[2]!, criterion: ELEV(-0.5, 0) },
        { sourceCourse: COURSES[3]!, criterion: REL(-0.5, -10) },
      ],
      maxSearchDistance: 50, curveChordTolerance: 0.05, cornerMode: 'miter', closed: true,
    });
    if (!created.ok) throw new Error(created.error);
    const drawing = createBlankCadDrawingDocument({ name: '20j1-bytes', units: 'm' });
    const first = serializeCadDrawingFile({ ...drawing, project: projectWith([created.value]) });
    const parsed = parseCadDrawingFile(first);
    if (!parsed.ok) throw new Error('parse failed');
    expect(parsed.drawing.schemaVersion).toBe(2);
    expect(serializeCadDrawingFile(parsed.drawing)).toBe(first);
    expect(first.indexOf('"gradings"') < first.indexOf('"gradingGroups"')).toBe(true);
    const groupText = first.slice(first.indexOf('"gradingGroups"'));
    const order = ['"sourceCourses"', '"targetSurfaceId"', '"courseCriteria"', '"maxSearchDistance"'];
    const positions = order.map((key) => groupText.indexOf(key));
    expect(positions.every((pos) => pos > -1)).toBe(true);
    expect([...positions].sort((a, b) => a - b)).toEqual(positions);
  });
});

// ---------------------------------------------------------------------------
// §9 revision / resolve pins
// ---------------------------------------------------------------------------
describe('20j1 §9 revision pins', () => {
  const revCourses = () => COURSES.map((c) => ({
    vertexAId: c.vertexAId, vertexBId: c.vertexBId, resolvedSource: M(0, 0, 100, 0),
  }));
  const base = () => ({
    sourceFeatureLineId: 'fl-1', courses: revCourses(),
    targetSurfaceId: 'tgt-1', targetRevision: 'srev1:aaa',
    side: 'right' as const, criterion: FIXED(-0.5),
    maxSearchDistance: 50, curveChordTolerance: 0.05, cornerMode: 'miter' as const, closed: true,
  });

  it('storage reorder leaves the revision unchanged', () => {
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
  });

  it('an effective override moves the revision; empty overrides equal absent', () => {
    const rev0 = buildGroupRevision(base());
    expect(buildGroupRevision({
      ...base(),
      courseCriteria: [{ sourceCourse: COURSES[1]!, criterion: DIST(-0.5, 20) }],
    })).not.toBe(rev0);
    expect(buildGroupRevision({ ...base(), courseCriteria: [] })).toBe(rev0);
  });

  it('homogeneous pins: surface revision rides the target, analytic hashes tgt:none', () => {
    const rev0 = buildGroupRevision(base());
    expect(buildGroupRevision({ ...base(), targetSurfaceId: 'tgt-2' })).not.toBe(rev0);
    expect(buildGroupRevision({ ...base(), targetRevision: 'srev1:bbb' })).not.toBe(rev0);
    const analytic = { ...base(), criterion: DIST(-0.5, 20) };
    expect(buildGroupRevision({ ...analytic, targetSurfaceId: undefined, targetRevision: undefined }))
      .toBe(buildGroupRevision(analytic));
  });

  it('resolve revision is stable across a save/reopen round-trip', () => {
    const created = createGroupDefinition({
      id: 'gg', name: 'gg', sourceFeatureLineId: 'fl-1', sourceCourses: COURSES,
      side: 'right', criterion: FIXED(-0.5),
      courseCriteria: COURSES.map((c) => ({ sourceCourse: { ...c }, criterion: DIST(-0.5, 20) })),
      maxSearchDistance: 50, curveChordTolerance: 0.05, cornerMode: 'miter', closed: true,
    });
    if (!created.ok) throw new Error(created.error);
    const before = resolveGroupInputs(projectWith([created.value]), 'gg')!.revision;
    const drawing = createBlankCadDrawingDocument({ name: '20j1-rev', units: 'm' });
    const parsed = parseCadDrawingFile(serializeCadDrawingFile({ ...drawing, project: projectWith([created.value]) }));
    if (!parsed.ok) throw new Error('parse failed');
    const reopened = parsed.drawing.project.gradingGroups![0]!;
    expect(resolveGroupInputs(parsed.drawing.project, reopened.id)!.revision).toBe(before);
  });
});

// ---------------------------------------------------------------------------
// §10 full WNCAD round-trip: analytic-overridden group, no target
// ---------------------------------------------------------------------------
describe('20j1 §10 full round-trip', () => {
  it('create → serialize (no target) → parse → analytic → UNBUILT → resolve → calculate → CURRENT → reserialize identical', () => {
    const created = createGroupDefinition({
      id: 'gg', name: 'gg', sourceFeatureLineId: 'fl-1', sourceCourses: COURSES,
      side: 'right', criterion: FIXED(-0.5),
      courseCriteria: [
        { sourceCourse: COURSES[0]!, criterion: DIST(-0.5, 20) },
        { sourceCourse: COURSES[1]!, criterion: ELEV(-0.5, 0) },
        { sourceCourse: COURSES[2]!, criterion: REL(-0.5, -10) },
        { sourceCourse: COURSES[3]!, criterion: DIST(-0.5, 20) },
      ],
      maxSearchDistance: 50, curveChordTolerance: 0.05, cornerMode: 'miter', closed: true,
    });
    if (!created.ok) throw new Error(created.error);
    const drawing = createBlankCadDrawingDocument({ name: '20j1-full', units: 'm' });
    const first = serializeCadDrawingFile({ ...drawing, project: projectWith([created.value]) });
    expect(first).not.toContain('targetSurfaceId');

    const parsed = parseCadDrawingFile(first);
    if (!parsed.ok) throw new Error('parse failed');
    const reopened = parsed.drawing.project.gradingGroups ?? [];
    expect(reopened).toHaveLength(1);
    const group = reopened[0]!;
    const members = resolveGroupMemberCriteria(group);
    expect(groupTerminationMode(group.criterion, members)).toBe('analytic');
    expect(groupTerminationRequiresTarget(group.criterion, members)).toBe(false);
    expect(deriveGroupStatus({
      brokenRef: false, building: false, hasResult: false, sourceCurrent: true, needsRecalc: false,
    })).toBe('UNBUILT');

    const inputs = resolveGroupInputs(parsed.drawing.project, group.id);
    expect(inputs).not.toBeNull();
    expect(inputs!.target).toBeUndefined();
    const effective = effectiveCriteriaForCourses(group.criterion, group.sourceCourses, group.courseCriteria);
    const computed = computeGradingGroupFromSnapshots({
      groupId: group.id, revision: inputs!.revision, members: SQUARE,
      side: 'right', criterion: group.criterion, memberCriteria: effective,
      maxSearchDistance: 50, curveChordTolerance: 0.05, closed: true,
    });
    expect(computed.ok).toBe(true);
    if (!computed.ok) return;
    expect(deriveGroupStatus({
      brokenRef: false, building: false, hasResult: true, sourceCurrent: true, needsRecalc: false,
    })).toBe('CURRENT');
    expect(serializeCadDrawingFile(parsed.drawing)).toBe(first);
  });
});
