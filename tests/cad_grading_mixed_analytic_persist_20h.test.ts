/**
 * Phase 20H — mixed-analytic grading-group persistence.
 *
 * Definitions only (no derived results/status bytes). Pins the WNCAD
 * round-trip with mixed per-course analytic overrides, schema v2 stability,
 * UNBUILT reopen semantics, and the load-time same-domain scrub that drops
 * an incompatible override on its own while preserving valid siblings.
 */
import { describe, expect, it } from 'vitest';

import {
  sanitizeCadGradingGroups,
  sanitizeCadGradingGroupsDetailed,
} from '../src/engine/cad/grading/gradingGroupPersistence';
import { resolveGroupMemberCriteria } from '../src/engine/cad/grading/gradingGroupCourseCriteria';
import {
  createBlankCadDrawingDocument,
  parseCadDrawingFile,
  serializeCadDrawingFile,
} from '../src/engine/cad/cadDrawingFile';
import { buildCadGradingGroupSnapshot } from '../src/cad-app/shell/cadGradingGroupSnapshot';
import type { CadFeatureLineEntity, CadProject } from '../src/engine/cad/cadTypes';
import type { CadGradingGroup, GradingGroupCourse } from '../src/engine/cad/grading/gradingGroupTypes';
import type { GradingCriterion } from '../src/engine/cad/grading/gradingTypes';

const DIST = (g: number, d: number): GradingCriterion => ({ kind: 'distance', gradeRatio: g, distance: d });
const ELEV = (g: number, e: number): GradingCriterion => ({ kind: 'elevation', gradeRatio: g, targetElevation: e });
const REL = (g: number, dz: number): GradingCriterion => ({ kind: 'relative-elevation', gradeRatio: g, relativeElevation: dz });
const FIXED: GradingCriterion = { kind: 'fixed', gradeRatio: -0.5 };
const CUTFILL: GradingCriterion = { kind: 'cut-fill', cutGradeRatio: 0.5, fillGradeRatio: -0.5 };

const COURSES: GradingGroupCourse[] = [
  { vertexAId: 'a', vertexBId: 'b' },
  { vertexAId: 'b', vertexBId: 'c' },
  { vertexAId: 'c', vertexBId: 'd' },
  { vertexAId: 'd', vertexBId: 'a' },
];

const groupOf = (
  criterion: GradingCriterion,
  courseCriteria?: CadGradingGroup['courseCriteria'],
): CadGradingGroup => ({
  id: 'gg', name: 'gg', sourceFeatureLineId: 'fl-1', sourceCourses: COURSES,
  side: 'right', criterion, maxSearchDistance: 50, curveChordTolerance: 0.05,
  cornerMode: 'miter', closed: true,
  ...(courseCriteria !== undefined ? { courseCriteria } : {}),
});

const featureLine = (): CadFeatureLineEntity => ({
  id: 'fl-1', type: 'feature-line', layerId: 'general', visible: true, locked: false, name: 'Pad FL',
  vertices: [
    { id: 'a', x: 0, y: 0, z: 10 }, { id: 'b', x: 100, y: 0, z: 10 },
    { id: 'c', x: 100, y: 100, z: 10 }, { id: 'd', x: 0, y: 100, z: 10 },
  ],
  closed: true,
});

const projectWith = (group: CadGradingGroup): CadProject => ({
  ...createBlankCadDrawingDocument({ name: '20h-persist', units: 'm' }).project,
  entities: [featureLine()],
  gradingGroups: [group],
});

// ---------------------------------------------------------------------------
// 1. Sanitization: same-domain scrub with sibling preservation
// ---------------------------------------------------------------------------
describe('(1) sanitization: cross-domain overrides survive (20J hybrid)', () => {
  it('keeps every override of a hybrid group with a live target', () => {
    const raw = {
      ...groupOf(DIST(-0.5, 20), [
        { sourceCourse: COURSES[1]!, criterion: REL(-0.25, -10) },
        { sourceCourse: COURSES[2]!, criterion: FIXED },
      ]),
      targetSurfaceId: 'surf-1',
    };
    const { groups, dropped } = sanitizeCadGradingGroupsDetailed([raw]);
    expect(groups).toHaveLength(1);
    expect(groups[0]!.targetSurfaceId).toBe('surf-1');
    expect(groups[0]!.courseCriteria).toHaveLength(2);
    expect(groups[0]!.courseCriteria![1]!.criterion).toEqual(FIXED);
    expect(dropped).toEqual([]);
  });

  it('drops a surface-effective group with no target id (fail closed)', () => {
    const raw = groupOf(DIST(-0.5, 20), [
      { sourceCourse: COURSES[1]!, criterion: FIXED },
    ]);
    const { groups } = sanitizeCadGradingGroupsDetailed([raw]);
    expect(groups).toHaveLength(0);
  });

  it('works in the reverse direction (surface default keeps analytic siblings)', () => {
    const raw = { ...groupOf(FIXED, [
      { sourceCourse: COURSES[1]!, criterion: CUTFILL },
      { sourceCourse: COURSES[2]!, criterion: DIST(-0.5, 20) },
    ]), targetSurfaceId: 'surf-1' };
    const { groups, dropped } = sanitizeCadGradingGroupsDetailed([raw]);
    expect(groups).toHaveLength(1);
    expect(groups[0]!.courseCriteria).toHaveLength(2);
    expect(groups[0]!.courseCriteria![1]!.criterion).toEqual(DIST(-0.5, 20));
    expect(dropped).toEqual([]);
  });

  it('keeps a homogeneous all-analytic override set untouched and reports no drops', () => {
    const raw = groupOf(DIST(-0.5, 20), [
      { sourceCourse: COURSES[1]!, criterion: REL(-0.25, -10) },
      { sourceCourse: COURSES[2]!, criterion: ELEV(-0.5, 0) },
    ]);
    const { groups, dropped } = sanitizeCadGradingGroupsDetailed([raw]);
    expect(dropped).toEqual([]);
    expect(groups[0]!.courseCriteria).toHaveLength(2);
    expect(resolveGroupMemberCriteria(groups[0]!)).toEqual([
      DIST(-0.5, 20), REL(-0.25, -10), ELEV(-0.5, 0), DIST(-0.5, 20),
    ]);
  });

  it('drops a group whose DEFAULT criterion is malformed (fail closed)', () => {
    expect(sanitizeCadGradingGroups([groupOf(REL(-0.5, 0))])).toHaveLength(0);
    expect(sanitizeCadGradingGroups([groupOf(DIST(-0.5, Number.NaN))])).toHaveLength(0);
  });
});

// ---------------------------------------------------------------------------
// 2. WNCAD round-trip
// ---------------------------------------------------------------------------
describe('(2) WNCAD round-trip', () => {
  const mixed = (): CadGradingGroup => groupOf(DIST(-0.5, 20), [
    { sourceCourse: COURSES[1]!, criterion: REL(-0.25, -10) },
    { sourceCourse: COURSES[2]!, criterion: ELEV(-0.5, 0) },
  ]);

  it('preserves every mixed override and never persists result/status bytes', () => {
    const drawing = createBlankCadDrawingDocument({ name: '20h-save', units: 'm' });
    const text = serializeCadDrawingFile({ ...drawing, project: projectWith(mixed()) });
    expect(text).toContain('relativeElevation');
    expect(text).toContain('targetElevation');
    expect(text).not.toMatch(/"accuracy"|"status"|gradingGroupResult/);
    const parsed = parseCadDrawingFile(text);
    expect(parsed.ok).toBe(true);
    if (!parsed.ok) return;
    const reopened = parsed.drawing.project.gradingGroups ?? [];
    expect(reopened).toHaveLength(1);
    expect(resolveGroupMemberCriteria(reopened[0]!)).toEqual([
      DIST(-0.5, 20), REL(-0.25, -10), ELEV(-0.5, 0), DIST(-0.5, 20),
    ]);
    expect(JSON.stringify(reopened[0])).not.toMatch(/accuracy|revision|status|result/);
  });

  it('round-trips once more byte-identically (idempotent re-save)', () => {
    const drawing = createBlankCadDrawingDocument({ name: '20h-save', units: 'm' });
    const first = serializeCadDrawingFile({ ...drawing, project: projectWith(mixed()) });
    const parsed = parseCadDrawingFile(first);
    if (!parsed.ok) throw new Error('parse failed');
    const second = serializeCadDrawingFile(parsed.drawing);
    expect(second).toBe(first);
  });

  it('keeps schema version v2 (additive optional field, no bump)', () => {
    const drawing = createBlankCadDrawingDocument({ name: '20h-save', units: 'm' });
    const parsed = parseCadDrawingFile(serializeCadDrawingFile({ ...drawing, project: projectWith(mixed()) }));
    expect(parsed.ok).toBe(true);
    if (!parsed.ok) return;
    expect(parsed.drawing.schemaVersion).toBe(drawing.schemaVersion);
    expect(parsed.drawing.schemaVersion).toBe(2);
  });
});

// ---------------------------------------------------------------------------
// 3. UNBUILT reopen
// ---------------------------------------------------------------------------
describe('(3) UNBUILT reopen', () => {
  it('a reopened mixed-analytic group is calculable but UNBUILT with no result', () => {
    const drawing = createBlankCadDrawingDocument({ name: '20h-reopen', units: 'm' });
    const group = groupOf(DIST(-0.5, 20), [
      { sourceCourse: COURSES[1]!, criterion: REL(-0.25, -10) },
    ]);
    const parsed = parseCadDrawingFile(serializeCadDrawingFile({ ...drawing, project: projectWith(group) }));
    if (!parsed.ok) throw new Error('parse failed');
    const row = buildCadGradingGroupSnapshot(parsed.drawing.project, null, null, null).groups[0]!;
    expect(row.status).toBe('UNBUILT');
    expect(row.calculable).toBe(true);
    expect(row.exportable).toBe(false);
    expect(row.analytic).toBe(true);
    expect(row.currentResult).toBeNull();
    expect(row.overrideCount).toBe(1);
  });
});
