/**
 * Phase 20F — analytic (distance/elevation) grading-group oracles.
 *
 * Closed-form expectations on a flat square source: the limit is a plain
 * offset, corners are mitred intersections of the two terminal limit lines,
 * and every inconsistent corner fails closed (no averaging, no walls).
 */
import { describe, expect, it } from 'vitest';
import {
  computeGradingGroupFromSnapshots,
} from '../src/engine/cad/grading/gradingGroupCompute';
import {
  createGroupDefinition,
  setCourseCriteriaOverrides,
} from '../src/engine/cad/grading/gradingGroupAuthoring';
import { buildGroupRevision } from '../src/engine/cad/grading/gradingGroupRevision';
import { resolveGroupInputs } from '../src/engine/cad/grading/gradingGroupResolve';
import { resolveDesignPatch } from '../src/engine/cad/cadTransactionsDesignPatchCommands';
import { createBlankCadDrawingDocument } from '../src/engine/cad/cadDrawingFile';
import type { CadFeatureLineEntity, CadProject } from '../src/engine/cad/cadTypes';
import type { ResolvedGradingSource } from '../src/engine/cad/grading/gradingTypes';

const straight = (
  sx: number, sy: number, ex: number, ey: number, sz = 10, ez = 10,
): ResolvedGradingSource => ({
  startX: sx, startY: sy, endX: ex, endY: ey, startZ: sz, endZ: ez,
  length: Math.hypot(ex - sx, ey - sy), reoriented: false, isArc: false,
});

/** CCW 100x100 square; side `right` grades outward. */
const square = (): ResolvedGradingSource[] => [
  straight(0, 0, 100, 0),
  straight(100, 0, 100, 100),
  straight(100, 100, 0, 100),
  straight(0, 100, 0, 0),
];

const extent = (r: { daylightPoints: number[] }, axis: 0 | 1): [number, number] => {
  const values = r.daylightPoints.filter((_, i) => i % 3 === axis);
  return [Math.min(...values), Math.max(...values)];
};

describe('(a) distance group — analytic outward pad', () => {
  const solve = (distance: number) =>
    computeGradingGroupFromSnapshots({
      groupId: 'd', revision: 'ggrev1:test', members: square(), side: 'right',
      criterion: { kind: 'distance', gradeRatio: 0, distance },
      maxSearchDistance: 50, curveChordTolerance: 0.05, closed: true,
    });

  it('offsets 20m at constant Z with mitred corners', () => {
    const out = solve(20);
    expect(out.ok).toBe(true);
    if (!out.ok) return;
    const r = out.result;
    expect(r.gradingPlanArea).toBeCloseTo(9600, 6);
    expect(extent(r, 0)).toEqual([-20, 120]);
    expect(extent(r, 1)).toEqual([-20, 120]);
    const zs = r.gradingMesh.points.filter((_, i) => i % 3 === 2);
    expect(Math.min(...zs)).toBeCloseTo(10, 9);
    expect(Math.max(...zs)).toBeCloseTo(10, 9);
    expect(r.corners.map((c) => c.classification)).toEqual(['GAP', 'GAP', 'GAP', 'GAP']);
    expect(r.corners[0]!.miterExtent).toBeCloseTo(20 * Math.SQRT2, 9);
  });

  it('fails closed when the offset exceeds maxSearchDistance', () => {
    const out = solve(80);
    expect(out.ok).toBe(false);
    if (!out.ok) expect(out.code).toBe('MEMBER_NO_SOLUTION');
  });

  it('mitres inward (OVERLAP) corners without double-covering', () => {
    const out = computeGradingGroupFromSnapshots({
      groupId: 'di', revision: 'ggrev1:test', members: square(), side: 'left',
      criterion: { kind: 'distance', gradeRatio: 0, distance: 20 },
      maxSearchDistance: 50, curveChordTolerance: 0.05, closed: true,
    });
    expect(out.ok).toBe(true);
    if (!out.ok) return;
    const r = out.result;
    expect(r.corners.map((c) => c.classification)).toEqual(['OVERLAP', 'OVERLAP', 'OVERLAP', 'OVERLAP']);
    expect(extent(r, 0)).toEqual([20, 80]);
    expect(r.gradingPlanArea).toBeCloseTo(6400, 6);
  });
});

describe('(b) elevation group — constant-Z analytic pad', () => {
  it('ties at Z = 0 with d = (E − Zsrc)/g', () => {
    const out = computeGradingGroupFromSnapshots({
      groupId: 'e', revision: 'ggrev1:test', members: square(), side: 'right',
      criterion: { kind: 'elevation', gradeRatio: -0.5, targetElevation: 0 },
      maxSearchDistance: 50, curveChordTolerance: 0.05, closed: true,
    });
    expect(out.ok).toBe(true);
    if (!out.ok) return;
    const r = out.result;
    expect(extent(r, 0)).toEqual([-20, 120]);
    const dz = r.daylightPoints.filter((_, i) => i % 3 === 2);
    expect(Math.min(...dz)).toBeCloseTo(0, 9);
    expect(Math.max(...dz)).toBeCloseTo(0, 9);
    expect(r.gradingPlanArea).toBeCloseTo(9600, 6);
  });

  it('fails closed when adjacent courses target different elevations', () => {
    const out = computeGradingGroupFromSnapshots({
      groupId: 'e2', revision: 'ggrev1:test',
      members: [straight(0, 0, 100, 0), straight(100, 0, 100, 100)],
      side: 'right',
      criterion: { kind: 'elevation', gradeRatio: -0.5, targetElevation: 0 },
      memberCriteria: [
        { kind: 'elevation', gradeRatio: -0.5, targetElevation: 0 },
        { kind: 'elevation', gradeRatio: -0.5, targetElevation: 5 },
      ],
      maxSearchDistance: 50, curveChordTolerance: 0.05, closed: false,
    });
    expect(out.ok).toBe(false);
    if (!out.ok) expect(out.detail).toBe('GRADING_ANALYTIC_CORNER_Z');
  });

  it('fails closed on parallel limit lines with different offsets', () => {
    const out = computeGradingGroupFromSnapshots({
      groupId: 'e3', revision: 'ggrev1:test',
      members: [straight(0, 0, 100, 0), straight(100, 0, 200, 0)],
      side: 'right',
      criterion: { kind: 'distance', gradeRatio: 0, distance: 20 },
      memberCriteria: [
        { kind: 'distance', gradeRatio: 0, distance: 20 },
        { kind: 'distance', gradeRatio: 0, distance: 30 },
      ],
      maxSearchDistance: 50, curveChordTolerance: 0.05, closed: false,
    });
    expect(out.ok).toBe(false);
    if (!out.ok) expect(out.detail).toBe('GRADING_ANALYTIC_CORNER_PARALLEL');
  });
});

describe('(c) authoring — one termination family per group', () => {
  const input = {
    id: 'g', name: 'G', sourceFeatureLineId: 'fl',
    sourceCourses: [{ vertexAId: 'a', vertexBId: 'b' }],
    side: 'right' as const,
    maxSearchDistance: 50, curveChordTolerance: 0.05, cornerMode: 'miter' as const,
  };

  it('accepts a distance group without a target surface', () => {
    const built = createGroupDefinition({ ...input, criterion: { kind: 'distance', gradeRatio: 0.5, distance: 20 } });
    expect(built.ok).toBe(true);
    if (built.ok) expect(built.value.targetSurfaceId).toBeUndefined();
  });

  it('accepts an elevation group without a target surface', () => {
    const built = createGroupDefinition({ ...input, criterion: { kind: 'elevation', gradeRatio: -0.5, targetElevation: 0 } });
    expect(built.ok).toBe(true);
  });

  it('rejects a surface default mixed with a distance override', () => {
    const built = createGroupDefinition({
      ...input,
      targetSurfaceId: 'tgt',
      criterion: { kind: 'fixed', gradeRatio: -0.5 },
      courseCriteria: [{ sourceCourse: { vertexAId: 'a', vertexBId: 'b' }, criterion: { kind: 'distance', gradeRatio: 0, distance: 20 } }],
    });
    expect(built.ok).toBe(false);
    if (!built.ok) expect(built.error).toContain('termination');
  });

  it('rejects setting a distance override on a surface group', () => {
    const base = createGroupDefinition({ ...input, targetSurfaceId: 'tgt', criterion: { kind: 'fixed', gradeRatio: -0.5 } });
    expect(base.ok).toBe(true);
    if (!base.ok) return;
    const edited = setCourseCriteriaOverrides(base.value, [{ vertexAId: 'a', vertexBId: 'b' }], { kind: 'distance', gradeRatio: 0, distance: 20 });
    expect(edited.ok).toBe(false);
  });

  it('requires a target for surface criteria', () => {
    const built = createGroupDefinition({ ...input, criterion: { kind: 'fixed', gradeRatio: -0.5 } });
    expect(built.ok).toBe(false);
    if (!built.ok) expect(built.error).toContain('targetSurfaceId');
  });
});

describe('(d) group revision — analytic target is dormant', () => {
  const base = {
    sourceFeatureLineId: 'fl',
    courses: [{
      vertexAId: 'a', vertexBId: 'b',
      resolvedSource: straight(0, 0, 10, 0),
    }],
    side: 'right' as const,
    criterion: { kind: 'distance' as const, gradeRatio: 0, distance: 20 },
    maxSearchDistance: 50, curveChordTolerance: 0.05,
    cornerMode: 'miter' as const, closed: false,
  };

  it('hashes identically with and without a dormant target id', () => {
    const bare = buildGroupRevision(base);
    const dormant = buildGroupRevision({ ...base, targetSurfaceId: 'legacy', targetRevision: 'srev1:x' });
    expect(dormant).toBe(bare);
  });

  it('still hashes the target for surface families', () => {
    const surface = { ...base, criterion: { kind: 'fixed' as const, gradeRatio: -0.5 } };
    const a = buildGroupRevision({ ...surface, targetSurfaceId: 't1', targetRevision: 'srev1:a' });
    const b = buildGroupRevision({ ...surface, targetSurfaceId: 't2', targetRevision: 'srev1:a' });
    expect(a).not.toBe(b);
  });
});

describe('(e) design patch — closed analytic group needs no target', () => {
  it('patches a flat distance group from the captured source ring', () => {
    const drawing = createBlankCadDrawingDocument({ name: '20F pad', units: 'm' });
    const flId = 'fl-20f';
    const fl: CadFeatureLineEntity = {
      id: flId, type: 'feature-line', layerId: 'general', visible: true, locked: false,
      name: 'FL', closed: true,
      vertices: [
        { id: 'a', x: 0, y: 0, z: 10 },
        { id: 'b', x: 100, y: 0, z: 10 },
        { id: 'c', x: 100, y: 100, z: 10 },
        { id: 'd', x: 0, y: 100, z: 10 },
      ],
    };
    const built = createGroupDefinition({
      id: 'g-20f', name: 'Pad', sourceFeatureLineId: flId,
      sourceCourses: [
        { vertexAId: 'a', vertexBId: 'b' }, { vertexAId: 'b', vertexBId: 'c' },
        { vertexAId: 'c', vertexBId: 'd' }, { vertexAId: 'd', vertexBId: 'a' },
      ],
      side: 'right', criterion: { kind: 'distance', gradeRatio: 0, distance: 20 },
      maxSearchDistance: 50, curveChordTolerance: 0.05, cornerMode: 'miter', closed: true,
    });
    expect(built.ok).toBe(true);
    if (!built.ok) return;
    const project: CadProject = {
      ...drawing.project,
      entities: [fl],
      gradingGroups: [built.value],
    };
    const inputs = resolveGroupInputs(project, built.value.id);
    expect(inputs).not.toBeNull();
    if (!inputs) return;
    expect(inputs.target).toBeUndefined();
    const computed = computeGradingGroupFromSnapshots({
      groupId: built.value.id, revision: inputs.revision,
      members: inputs.memberSources, side: inputs.group.side,
      criterion: inputs.group.criterion, maxSearchDistance: inputs.group.maxSearchDistance,
      curveChordTolerance: inputs.group.curveChordTolerance, closed: true,
    });
    expect(computed.ok).toBe(true);
    if (!computed.ok) return;
    const patch = resolveDesignPatch(project, built.value.id, computed.result, inputs.revision, true);
    expect(patch.ok).toBe(true);
    if (!patch.ok) return;
    expect(patch.value.provenance.targetKind).toBe('distance');
    expect(patch.value.provenance.criterionDistance).toBe(20);
    expect(patch.value.provenance.targetSurfaceId).toBeUndefined();
    expect(patch.value.padZ).toBe(10);
  });
});
