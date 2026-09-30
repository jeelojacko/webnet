/**
 * Phase 20G — Relative Elevation grading-group contract.
 *
 * Covers the distinct `'relative-elevation'` termination family, the
 * single-family gate, sparse same-family per-course overrides (no
 * materialization, exact-equality reset), the analytic corner formulation
 * (constant derived offset, no averaging/bridging), load-time sanitization,
 * the `ggrev1:` criterion/override hash, and bake provenance.
 * Numerical oracles live in `cad_grading_relative_elevation_oracles_20g`.
 */
import { describe, expect, it } from 'vitest';

import { createGroupDefinition, editGroupCriteria, setCourseCriteriaOverrides } from '../src/engine/cad/grading/gradingGroupAuthoring';
import {
  canonicalCourseCriteria,
  criteriaEqual,
  resolveGroupMemberCriteria,
} from '../src/engine/cad/grading/gradingGroupCourseCriteria';
import {
  groupTerminationFamily,
  validateGroupTermination,
  validateGroupTerminationCriteria,
} from '../src/engine/cad/grading/gradingGroupTermination';
import { sanitizeCadGradingGroups } from '../src/engine/cad/grading/gradingGroupPersistence';
import { computeGradingGroupFromSnapshots } from '../src/engine/cad/grading/gradingGroupCompute';
import { analyticTerminalLine, solveAnalyticCorner } from '../src/engine/cad/grading/gradingGroupAnalyticCorners';
import { normalizeTinProvenance, tinProvenanceRevisionPart } from '../src/engine/cad/cadImportedTin';
import { makeDesignPatchProvenance } from '../src/engine/cad/grading/designPatchBuild';
import type { CadGradingGroup, GradingGroupCourse } from '../src/engine/cad/grading/gradingGroupTypes';
import type { GradingCriterion, ResolvedGradingSource } from '../src/engine/cad/grading/gradingTypes';

const REL = (gradeRatio: number, relativeElevation: number): GradingCriterion => ({
  kind: 'relative-elevation',
  gradeRatio,
  relativeElevation,
});
const DIST = { kind: 'distance', gradeRatio: -0.5, distance: 20 } as const;
const ELEV = { kind: 'elevation', gradeRatio: -0.5, targetElevation: 90 } as const;
const FIXED = { kind: 'fixed', gradeRatio: -0.5 } as const;

const straight = (sx: number, sy: number, ex: number, ey: number, sz = 10, ez = 10): ResolvedGradingSource => ({
  startX: sx, startY: sy, endX: ex, endY: ey, startZ: sz, endZ: ez,
  length: Math.hypot(ex - sx, ey - sy), reoriented: false, isArc: false,
});

const square = (): ResolvedGradingSource[] => [
  straight(0, 0, 100, 0),
  straight(100, 0, 100, 100),
  straight(100, 100, 0, 100),
  straight(0, 100, 0, 0),
];

const COURSES: GradingGroupCourse[] = [
  { vertexAId: 'a', vertexBId: 'b' },
  { vertexAId: 'b', vertexBId: 'c' },
  { vertexAId: 'c', vertexBId: 'd' },
  { vertexAId: 'd', vertexBId: 'a' },
];

const groupInput = (criterion: GradingCriterion) => ({
  id: 'gg', name: 'gg', sourceFeatureLineId: 'fl', sourceCourses: COURSES,
  side: 'right' as const, criterion, maxSearchDistance: 50, curveChordTolerance: 0.05,
  cornerMode: 'miter' as const, closed: true,
});

const groupOf = (criterion: GradingCriterion, courseCriteria?: CadGradingGroup['courseCriteria']): CadGradingGroup => ({
  ...groupInput(criterion), ...(courseCriteria !== undefined ? { courseCriteria } : {}),
});

// ---------------------------------------------------------------------------
// 1. Distinct family + single-family gate
// ---------------------------------------------------------------------------
describe('(1) termination family', () => {
  it('is its own family, not Distance or Elevation', () => {
    expect(groupTerminationFamily(REL(-0.5, -10))).toBe('relative-elevation');
    expect(groupTerminationFamily(DIST)).toBe('distance');
    expect(groupTerminationFamily(ELEV)).toBe('elevation');
    expect(groupTerminationFamily(FIXED)).toBe('surface');
  });

  it('accepts homogeneous Relative Elevation groups (uniform and sparse)', () => {
    expect(validateGroupTermination(groupOf(REL(-0.5, -10)))).toBeNull();
    expect(
      validateGroupTerminationCriteria(REL(-0.5, -10), [REL(-0.5, -12), REL(0.25, 5)]),
    ).toBeNull();
  });

  it('accepts analytic mixes and surface+analytic hybrids (20J)', () => {
    // Phase 20H: distance/elevation/relative-elevation mix freely in one group.
    expect(validateGroupTerminationCriteria(REL(-0.5, -10), [DIST, ELEV])).toBeNull();
    expect(validateGroupTerminationCriteria(REL(-0.5, -10), [REL(-0.5, -12)])).toBeNull();
    // Phase 20J: surface + analytic is a legal hybrid (exact-common-tie).
    expect(validateGroupTerminationCriteria(REL(-0.5, -10), [FIXED])).toBeNull();
  });

  it('accepts an analytic override; a surface override needs a live target (20J hybrid)', () => {
    const created = createGroupDefinition(groupInput(REL(-0.5, -10)));
    if (!created.ok) throw new Error(created.error);
    // Phase 20H: an analytic sibling (Distance/Elevation) is allowed.
    const sibling = setCourseCriteriaOverrides(created.value, [COURSES[1]!], DIST);
    if (!sibling.ok) throw new Error(sibling.error);
    expect(sibling.value.courseCriteria).toHaveLength(1);
    // Phase 20J: a surface override is a hybrid step — fail closed with no
    // live target, land with an explicit one.
    const untargeted = setCourseCriteriaOverrides(created.value, [COURSES[1]!], FIXED);
    expect(untargeted.ok).toBe(false);
    const targeted = setCourseCriteriaOverrides(
      { ...created.value, targetSurfaceId: 'surf-1' },
      [COURSES[1]!],
      FIXED,
    );
    if (!targeted.ok) throw new Error(targeted.error);
    expect(targeted.value.courseCriteria).toHaveLength(1);
    expect(targeted.value.targetSurfaceId).toBe('surf-1');

    const loaded = sanitizeCadGradingGroups([
      { ...groupInput(REL(-0.5, -10)), targetSurfaceId: 'surf-1', courseCriteria: [{ sourceCourse: COURSES[1]!, criterion: FIXED }] },
    ]);
    expect(loaded).toHaveLength(1);
    expect(loaded[0]!.criterion).toEqual(REL(-0.5, -10));
    expect(loaded[0]!.courseCriteria ?? []).toHaveLength(1);
    expect(loaded[0]!.targetSurfaceId).toBe('surf-1');
  });

  it('authoring rejects a malformed Relative Elevation default', () => {
    expect(createGroupDefinition(groupInput(REL(0, -10))).ok).toBe(false);
    expect(createGroupDefinition(groupInput(REL(-0.5, 0))).ok).toBe(false);
    expect(createGroupDefinition(groupInput(REL(-0.5, -10))).ok).toBe(true);
  });

  it('editing the default to Relative Elevation drops a dormant target id', () => {
    const surfaceGroup = createGroupDefinition({ ...groupInput(FIXED), targetSurfaceId: 'surf-1' });
    if (!surfaceGroup.ok) throw new Error(surfaceGroup.error);
    expect(surfaceGroup.value.targetSurfaceId).toBe('surf-1');
    const edited = editGroupCriteria(surfaceGroup.value, REL(-0.5, -10));
    if (!edited.ok) throw new Error(edited.error);
    expect(edited.value.criterion).toEqual(REL(-0.5, -10));
    expect(edited.value.targetSurfaceId).toBeUndefined();
  });
});

// ---------------------------------------------------------------------------
// 2. Sparse overrides
// ---------------------------------------------------------------------------
describe('(2) sparse overrides', () => {
  it('keeps a differing same-family override and drops an exact-equal one', () => {
    expect(canonicalCourseCriteria(groupOf(REL(-0.5, -10), [
      { sourceCourse: COURSES[1]!, criterion: REL(-0.5, -12) },
    ]))).toHaveLength(1);
    expect(canonicalCourseCriteria(groupOf(REL(-0.5, -10), [
      { sourceCourse: COURSES[1]!, criterion: REL(-0.5, -10) },
    ]))).toEqual([]);
  });

  it('never materializes defaults and resolves absent overrides to the default', () => {
    const bare = groupOf(REL(-0.5, -10));
    expect(canonicalCourseCriteria(bare)).toEqual([]);
    expect(bare).not.toHaveProperty('courseCriteria');
    expect(resolveGroupMemberCriteria(bare)).toEqual([REL(-0.5, -10), REL(-0.5, -10), REL(-0.5, -10), REL(-0.5, -10)]);
  });

  it('structural equality is exact for the new family', () => {
    expect(criteriaEqual(REL(-0.5, -10), REL(-0.5, -10))).toBe(true);
    expect(criteriaEqual(REL(-0.5, -10), REL(-0.5, -10.000000001))).toBe(false);
    expect(criteriaEqual(REL(-0.5, -10), REL(-0.25, -10))).toBe(false);
    expect(criteriaEqual(REL(-0.5, -10), DIST)).toBe(false);
  });

  it('reset removes the override record through the authoring seam', () => {
    const created = createGroupDefinition(groupInput(REL(-0.5, -10)));
    if (!created.ok) throw new Error(created.error);
    const withOverride = setCourseCriteriaOverrides(created.value, [COURSES[1]!], REL(-0.5, -12));
    if (!withOverride.ok) throw new Error(withOverride.error);
    expect(withOverride.value.courseCriteria).toHaveLength(1);
    const reset = setCourseCriteriaOverrides(withOverride.value, [COURSES[1]!], REL(-0.5, -10));
    if (!reset.ok) throw new Error(reset.error);
    expect(reset.value.courseCriteria ?? []).toHaveLength(0);
  });
});

// ---------------------------------------------------------------------------
// 3. Analytic corner formulation
// ---------------------------------------------------------------------------
describe('(3) analytic corners', () => {
  const tangent = { nx: 1, ny: 0 };
  const normal = { nx: 0, ny: -1 };

  it('terminal line is the Distance line with the derived d = Δ/g', () => {
    const line = analyticTerminalLine(0, 0, 10, tangent, normal, 0, REL(-0.5, -10));
    expect(line).toEqual({ ox: 0, oy: -20, oz: 0, dx: 1, dy: 0, dz: 0 });
    // Same derived offset as an equivalent Distance criterion.
    expect(analyticTerminalLine(0, 0, 10, tangent, normal, 0, { kind: 'distance', gradeRatio: -0.5, distance: 20 }))
      .toEqual(line);
  });

  it('carries the source longitudinal grade into the limit line direction', () => {
    const line = analyticTerminalLine(0, 0, 10, tangent, normal, -0.02, REL(-0.5, -10));
    expect(line!.dz).toBe(-0.02);
    expect(line!.oz).toBe(0);
  });

  it('square corner miters to 20√2 without averaging', () => {
    const out = computeGradingGroupFromSnapshots({
      groupId: 'gg', revision: 'r', members: square(), side: 'right',
      criterion: REL(-0.5, -10), maxSearchDistance: 50, curveChordTolerance: 0.05, closed: true,
    });
    if (!out.ok) throw new Error(`${out.code} ${out.detail ?? ''}`);
    expect(out.result.corners).toHaveLength(4);
    for (const corner of out.result.corners) {
      expect(corner.classification).toBe('GAP');
      expect(corner.miterExtent).toBeCloseTo(20 * Math.SQRT2, 9);
    }
    expect(out.result.gradingPlanArea).toBeCloseTo(9600, 6);
  });

  it('mismatched adjacent relative elevations fail closed at the Z gate', () => {
    const out = computeGradingGroupFromSnapshots({
      groupId: 'gg', revision: 'r', members: square(), side: 'right',
      criterion: REL(-0.5, -10),
      memberCriteria: [REL(-0.5, -10), REL(-0.5, -12), REL(-0.5, -10), REL(-0.5, -10)],
      maxSearchDistance: 50, curveChordTolerance: 0.05, closed: true,
    });
    expect(out.ok).toBe(false);
    if (out.ok) throw new Error('expected CORNER_NO_SOLUTION');
    expect(out.code).toBe('CORNER_NO_SOLUTION');
    expect(out.detail).toBe('GRADING_ANALYTIC_CORNER_Z');
  });

  it('never averages two relative elevations into a compromise corner', () => {
    const solution = solveAnalyticCorner({
      vx: 0, vy: 0, vz: 10,
      inT: tangent, inN: normal, inGs: 0,
      outT: { nx: 0, ny: 1 }, outN: { nx: -1, ny: 0 }, outGs: 0,
      inCriterion: REL(-0.5, -10), outCriterion: REL(-0.5, -12),
      maxSearchDistance: 50,
    });
    // The two limit lines disagree in Z at the joint, so nothing is returned.
    expect(solution.ok).toBe(false);
    if (solution.ok) throw new Error('expected fail-closed corner');
    expect(solution.detail).toBe('GRADING_ANALYTIC_CORNER_Z');
  });
});

// ---------------------------------------------------------------------------
// 4. Load sanitization + bake provenance
// ---------------------------------------------------------------------------
describe('(4) sanitization and provenance', () => {
  it('loads a valid Relative Elevation group verbatim with no target id', () => {
    const loaded = sanitizeCadGradingGroups([groupInput(REL(-0.5, -10))]);
    expect(loaded).toHaveLength(1);
    expect(loaded[0]!.criterion).toEqual(REL(-0.5, -10));
    expect('targetSurfaceId' in loaded[0]!).toBe(false);
  });

  it('drops a malformed Relative Elevation group default fail-closed', () => {
    expect(sanitizeCadGradingGroups([groupInput(REL(-0.5, 0))])).toHaveLength(0);
    expect(sanitizeCadGradingGroups([groupInput(REL(-0.5, Number.NaN))])).toHaveLength(0);
  });

  it('group bake provenance carries the family and Δ and no target id', () => {
    const provenance = {
      kind: 'webnet-grading-group-bake' as const,
      groupId: 'gg', groupName: 'gg', groupRevision: 'ggrev1:x',
      sourceFeatureLineId: 'fl', sourceCourseRefs: ['a>b'],
      targetKind: 'relative-elevation' as const, relativeElevation: -10,
      side: 'right' as const, accuracy: 'EXACT' as const, cornerMode: 'miter' as const,
    };
    const normalized = normalizeTinProvenance(provenance);
    if (normalized == null || !('targetKind' in normalized)) throw new Error('not normalized');
    expect(normalized.targetKind).toBe('relative-elevation');
    expect(normalized.relativeElevation).toBe(-10);
    expect(normalized).not.toHaveProperty('targetSurfaceId');
    expect(tinProvenanceRevisionPart(normalized!)).toContain('relative-elevation:-10');
  });

  it('design-patch provenance records the family and Δ with no surface leg', () => {
    const provenance = makeDesignPatchProvenance({
      groupId: 'gg', groupName: 'gg', groupRevision: 'ggrev1:x', sourceFeatureLineId: 'fl',
      sourceCourseRefs: ['a>b'], criterion: REL(-0.5, -10), accuracy: 'EXACT',
      interiorPolicy: 'flat-source',
    });
    expect(provenance).toMatchObject({ targetKind: 'relative-elevation', relativeElevation: -10 });
    expect(provenance).not.toHaveProperty('targetSurfaceId');
    expect(provenance).not.toHaveProperty('criterionDistance');
    expect(provenance).not.toHaveProperty('targetElevation');
  });
});
