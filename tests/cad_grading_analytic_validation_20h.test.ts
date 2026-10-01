/**
 * Phase 20H — analytic criterion validation authority + hardening.
 *
 * One shared sign/size authority for Relative Elevation
 * (`resolveRelativeElevationParams`) drives authoring, draft-free resolution,
 * the analytic terminal line, and the chord/group solvers. Plus the distance
 * limit-overflow guard (finite inputs that sum to a non-finite limit fail
 * closed BEFORE any geometry), large-coordinate stability, an arc-adjacent
 * mixed group, and the reversed-storage invariant.
 */
import { describe, expect, it } from 'vitest';

import {
  constantAnalyticOffset,
  resolveAnalyticCriterionAt,
  resolveRelativeElevationParams,
} from '../src/engine/cad/grading/gradingAnalyticCriterion';
import { validateGradingCriterion } from '../src/engine/cad/grading/gradingAuthoring';
import { analyticTerminalLine, solveAnalyticCorner } from '../src/engine/cad/grading/gradingGroupAnalyticCorners';
import { createGroupDefinition } from '../src/engine/cad/grading/gradingGroupAuthoring';
import { resolveGroupMemberCriteria } from '../src/engine/cad/grading/gradingGroupCourseCriteria';
import { sanitizeCadGradingGroupsDetailed } from '../src/engine/cad/grading/gradingGroupPersistence';
import { computeGradingGroupFromSnapshots } from '../src/engine/cad/grading/gradingGroupCompute';
import { validateGradingMeshTopology } from '../src/engine/cad/grading/gradingTopology';
import { solveAnalyticGradingChord } from '../src/engine/cad/grading/solveAnalyticGradingChord';
import { computeGradingFromSnapshots } from '../src/workers/surfaceGradingCompute';
import type { GradingCriterion, ResolvedGradingSource } from '../src/engine/cad/grading/gradingTypes';
import type { GradingGroupCourse } from '../src/engine/cad/grading/gradingGroupTypes';

const DIST = (g: number, d: number): GradingCriterion => ({ kind: 'distance', gradeRatio: g, distance: d });
const ELEV = (g: number, e: number): GradingCriterion => ({ kind: 'elevation', gradeRatio: g, targetElevation: e });
const REL = (g: number, dz: number): GradingCriterion => ({ kind: 'relative-elevation', gradeRatio: g, relativeElevation: dz });

const straight = (sx: number, sy: number, ex: number, ey: number, sz = 10, ez = 10): ResolvedGradingSource => ({
  startX: sx, startY: sy, endX: ex, endY: ey, startZ: sz, endZ: ez,
  length: Math.hypot(ex - sx, ey - sy), reoriented: false, isArc: false,
});

const flat = (z: number) => ({
  startX: 0, startY: 0, endX: 100, endY: 0, startZ: z, endZ: z,
  length: 100, reoriented: false, isArc: false as const,
});

// ---------------------------------------------------------------------------
// 1. Single sign/size authority
// ---------------------------------------------------------------------------
describe('(1) resolveRelativeElevationParams single authority', () => {
  it('accepts a finite, machine-nonzero, positively-derived pair', () => {
    expect(resolveRelativeElevationParams(-0.5, -10)).toEqual({ ok: true, d: 20 });
    expect(resolveRelativeElevationParams(0.5, 10)).toEqual({ ok: true, d: 20 });
    expect(resolveRelativeElevationParams(-0.25, -10)).toEqual({ ok: true, d: 40 });
  });

  it('rejects zero/opposite-sign/non-finite parameters', () => {
    expect(resolveRelativeElevationParams(0, -10).ok).toBe(false);
    expect(resolveRelativeElevationParams(-0.5, 0).ok).toBe(false);
    expect(resolveRelativeElevationParams(Number.NaN, -10).ok).toBe(false);
    expect(resolveRelativeElevationParams(-0.5, Number.POSITIVE_INFINITY).ok).toBe(false);
    // Opposite signs derive d <= 0.
    expect(resolveRelativeElevationParams(0.5, -10).ok).toBe(false);
    expect(resolveRelativeElevationParams(-0.5, 10).ok).toBe(false);
  });

  it('drives constantAnalyticOffset identically (no second derivation)', () => {
    expect(constantAnalyticOffset(REL(-0.5, -10))).toBe(20);
    expect(constantAnalyticOffset(REL(0.5, -10))).toBeNull();
    expect(constantAnalyticOffset(REL(-0.5, 0))).toBeNull();
    expect(constantAnalyticOffset(ELEV(-0.5, 90))).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// 2. Wrong-sign authority (authoring → resolver → kernel)
// ---------------------------------------------------------------------------
describe('(2) wrong-sign authority', () => {
  it('authoring rejects an opposite-sign Relative Elevation with one message', () => {
    expect(validateGradingCriterion(REL(0.5, -10))).toContain('opposite direction');
    expect(validateGradingCriterion(REL(-0.5, 10))).toContain('opposite direction');
    expect(validateGradingCriterion(REL(-0.5, -10))).toBeNull();
  });

  it('the resolver reports GRADING_RELATIVE_ELEVATION_WRONG_DIRECTION', () => {
    for (const criterion of [REL(0.5, -10), REL(-0.5, 10)]) {
      const out = resolveAnalyticCriterionAt(criterion, 100, 1000);
      expect(out.ok).toBe(false);
      if (out.ok) throw new Error('expected NO_SOLUTION');
      expect(out.code).toBe('NO_SOLUTION');
      expect(out.detail).toBe('GRADING_RELATIVE_ELEVATION_WRONG_DIRECTION');
    }
  });

  it('the chord kernel and worker fail closed as defense in depth', () => {
    const chord = solveAnalyticGradingChord({
      source: flat(100), side: 'right', criterion: REL(0.5, -10), maxSearchDistance: 1000,
    });
    expect(chord.ok).toBe(false);
    const worker = computeGradingFromSnapshots({
      gradingId: 'ws', revision: 'grev1:20h', source: flat(100), side: 'right',
      criterion: REL(0.5, -10), maxSearchDistance: 1000, curveChordTolerance: 0.01,
    });
    expect(worker.ok).toBe(false);
  });

  it('a wrong-sign override is rejected by authoring and stripped by sanitization', () => {
    const courses: GradingGroupCourse[] = [
      { vertexAId: 'a', vertexBId: 'b' },
      { vertexAId: 'b', vertexBId: 'c' },
    ];
    const created = createGroupDefinition({
      id: 'gg', name: 'gg', sourceFeatureLineId: 'fl', sourceCourses: courses,
      side: 'right', criterion: DIST(-0.5, 20),
      courseCriteria: [{ sourceCourse: courses[1]!, criterion: REL(0.5, -10) }],
      maxSearchDistance: 50, curveChordTolerance: 0.05, cornerMode: 'miter',
    });
    expect(created.ok).toBe(false);

    const { groups, dropped } = sanitizeCadGradingGroupsDetailed([{
      id: 'gg', name: 'gg', sourceFeatureLineId: 'fl', sourceCourses: courses,
      side: 'right', criterion: DIST(-0.5, 20),
      courseCriteria: [{ sourceCourse: courses[1]!, criterion: REL(0.5, -10) }],
      maxSearchDistance: 50, curveChordTolerance: 0.05, cornerMode: 'miter',
    }]);
    expect(groups).toHaveLength(1);
    expect(groups[0]!.courseCriteria ?? []).toHaveLength(0);
    expect(dropped.map((entry) => entry.reason)).toEqual(['invalid-criterion']);
  });
});

// ---------------------------------------------------------------------------
// 3. Distance limit overflow (§21.F)
// ---------------------------------------------------------------------------
describe('(3) distance limit overflow', () => {
  it('rejects a non-finite limit sum from finite inputs', () => {
    const out = resolveAnalyticCriterionAt(DIST(1e308, 1e308), 1e308, Number.MAX_VALUE);
    expect(out.ok).toBe(false);
    if (out.ok) throw new Error('expected NO_SOLUTION');
    expect(out.detail).toBe('GRADING_BAD_CRITERION');
  });

  it('fails the analytic terminal line closed instead of returning Infinity', () => {
    expect(analyticTerminalLine(
      0, 0, 1e308, { nx: 1, ny: 0 }, { nx: 0, ny: -1 }, 0, DIST(1e308, 1e308),
    )).toBeNull();
  });

  it('fails before geometry in the chord kernel and worker', () => {
    const chord = solveAnalyticGradingChord({
      source: flat(1e308), side: 'right', criterion: DIST(1e308, 1e308), maxSearchDistance: Number.MAX_VALUE,
    });
    expect(chord.ok).toBe(false);
    const worker = computeGradingFromSnapshots({
      gradingId: 'ov', revision: 'grev1:20h', source: flat(1e308), side: 'right',
      criterion: DIST(1e308, 1e308), maxSearchDistance: Number.MAX_VALUE, curveChordTolerance: 0.01,
    });
    expect(worker.ok).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// 4. Large coordinates + arc-adjacent mixed group
// ---------------------------------------------------------------------------
describe('(4) large coordinates + arc-adjacent mixed group', () => {
  it('a mixed corner at E≈2e6 / N≈7e6 matches the local origin to <1e-6 m', () => {
    const dx = 2_000_000;
    const dy = 7_000_000;
    const params = {
      inT: { nx: 1, ny: 0 }, inN: { nx: 0, ny: -1 }, inGs: 0,
      outT: { nx: 0, ny: 1 }, outN: { nx: 1, ny: 0 }, outGs: 0,
      inCriterion: DIST(-0.5, 20), outCriterion: REL(-0.25, -10),
      maxSearchDistance: 50,
    };
    const local = solveAnalyticCorner({ ...params, vx: 0, vy: 0, vz: 100 });
    const shifted = solveAnalyticCorner({ ...params, vx: dx, vy: dy, vz: 100 });
    if (!local.ok || local.kind !== 'miter' || !shifted.ok || shifted.kind !== 'miter') {
      throw new Error('expected two miter ties');
    }
    expect(Math.abs(shifted.tie.x - dx - local.tie.x)).toBeLessThan(1e-6);
    expect(Math.abs(shifted.tie.y - dy - local.tie.y)).toBeLessThan(1e-6);
    expect(Math.abs(shifted.tie.z - local.tie.z)).toBeLessThan(1e-6);
    expect(shifted.extent).toBeCloseTo(local.extent, 9);
  });

  it('an arc-adjacent mixed group solves stably and deterministically', () => {
    const radius = 100;
    const sweep = Math.PI / 2;
    const arc: ResolvedGradingSource = {
      startX: radius, startY: 0, endX: 0, endY: radius, startZ: 10, endZ: 10,
      length: radius * sweep, reoriented: false, isArc: true,
      arc: { centerX: 0, centerY: 0, radius, startAngle: 0, endAngle: sweep, sweepCCW: true },
    };
    const members: ResolvedGradingSource[] = [arc, straight(0, radius, -100, radius)];
    const run = () => computeGradingGroupFromSnapshots({
      groupId: 'arc', revision: 'ggrev1:20h', members, side: 'right',
      criterion: DIST(-0.5, 20),
      memberCriteria: [ELEV(-0.5, 0), REL(-0.5, -10)],
      maxSearchDistance: 50, curveChordTolerance: 0.05, closed: false,
    });
    // 20K.1 Wave C1: analytic internal chord seams assemble (exact V,
    // analytic ties) and the joint vertex canonicalizes to the shared
    // member end, so the mixed ELEV/REL pair tiles ONE valid strip:
    // 1 component, 1 boundary loop, deterministic across runs.
    for (const out of [run(), run()]) {
      expect(out.ok).toBe(true);
      if (!out.ok) continue;
      const topo = validateGradingMeshTopology(
        out.result.gradingMesh.points, out.result.gradingMesh.triangles, { scope: 'group' });
      expect(topo).toMatchObject({ ok: true, components: 1, loops: 1 });
      expect(out.result.corners).toHaveLength(1);
      expect(out.result.corners[0]!.classification).toBe('GAP');
      expect(out.result.corners[0]!.tiePointXyz).toEqual([0.3141851064733838, 120, 0]);
      expect(out.result.gradingPlanArea).toBe(5449.051763958467);
    }
  });
});

// ---------------------------------------------------------------------------
// 5. Reversed-storage invariant
// ---------------------------------------------------------------------------
describe('(5) reversed-storage invariant', () => {
  it('matches an override stored in either vertex order (span reversal rides along)', () => {
    const created = createGroupDefinition({
      id: 'gg', name: 'gg', sourceFeatureLineId: 'fl',
      sourceCourses: [
        { vertexAId: 'a', vertexBId: 'b' },
        { vertexAId: 'b', vertexBId: 'c' },
      ],
      side: 'right', criterion: DIST(-0.5, 20),
      courseCriteria: [{ sourceCourse: { vertexAId: 'c', vertexBId: 'b' }, criterion: REL(-0.25, -10) }],
      maxSearchDistance: 50, curveChordTolerance: 0.05, cornerMode: 'miter',
    });
    if (!created.ok) throw new Error(created.error);
    expect(resolveGroupMemberCriteria(created.value)).toEqual([DIST(-0.5, 20), REL(-0.25, -10)]);
  });
});
