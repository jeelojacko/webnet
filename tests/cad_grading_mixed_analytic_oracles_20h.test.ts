/**
 * Phase 20H — mixed-analytic grading-group numerical oracles.
 *
 * Round-off-independent expectations for groups whose courses terminate in
 * DIFFERENT analytic families (Distance / Elevation / Relative Elevation)
 * within the SAME termination domain. The analytic corner kernel is the
 * shared authority: each course contributes one terminal limit line and the
 * joint is their exact 3D intersection, never an averaged or bridged value.
 *
 * Sections (mission §16–19):
 *   §16 two-line corner oracle (Distance × Relative) on a 90° joint
 *   §17 open two-course mixed group end-to-end
 *   §18 closed 100x100 pad mixed vs the all-Distance control
 *   §19 incompatible-Z corner fails closed at the Z gate
 *
 * Complements (does not duplicate) `cad_grading_mixed_analytic_groups_20h`,
 * which owns the compatibility/authoring/persistence matrices.
 */
import { createHash } from 'node:crypto';
import { describe, expect, it } from 'vitest';

import {
  analyticTerminalLine,
  solveAnalyticCorner,
} from '../src/engine/cad/grading/gradingGroupAnalyticCorners';
import { computeGradingGroupFromSnapshots } from '../src/engine/cad/grading/gradingGroupCompute';
import type { GradingCriterion, ResolvedGradingSource } from '../src/engine/cad/grading/gradingTypes';

const DIST = (g: number, d: number): GradingCriterion => ({ kind: 'distance', gradeRatio: g, distance: d });
const ELEV = (g: number, e: number): GradingCriterion => ({ kind: 'elevation', gradeRatio: g, targetElevation: e });
const REL = (g: number, dz: number): GradingCriterion => ({ kind: 'relative-elevation', gradeRatio: g, relativeElevation: dz });

const straight = (
  sx: number,
  sy: number,
  ex: number,
  ey: number,
  sz = 100,
  ez = 100,
): ResolvedGradingSource => ({
  startX: sx, startY: sy, endX: ex, endY: ey, startZ: sz, endZ: ez,
  length: Math.hypot(ex - sx, ey - sy), reoriented: false, isArc: false,
});

/** CCW 100x100 flat pad at Z=10; `side: 'right'` grades outward. */
const square = (): ResolvedGradingSource[] => [
  straight(0, 0, 100, 0, 10, 10),
  straight(100, 0, 100, 100, 10, 10),
  straight(100, 100, 0, 100, 10, 10),
  straight(0, 100, 0, 0, 10, 10),
];

const digest = (value: unknown): string =>
  createHash('sha256').update(JSON.stringify(value)).digest('hex');

const tiesOf = (corners: ReadonlyArray<{ tiePointXyz?: number[] }>): string[] =>
  corners.map((corner) => corner.tiePointXyz!.map((v) => Math.round(v * 1e6) / 1e6).join(',')).sort();

// ---------------------------------------------------------------------------
// §16 — two-line corner oracle
// ---------------------------------------------------------------------------
describe('§16 two-line corner (Distance × Relative Elevation)', () => {
  // Joint V=(0,0,100); incoming T=(1,0) N=(0,-1) gs=0 Distance g=-0.5 D=20;
  // outgoing T=(0,1) N=(1,0) gs=0 Relative g=-0.25 Δ=-10 (d=40).
  const joint = {
    vx: 0, vy: 0, vz: 100,
    inT: { nx: 1, ny: 0 }, inN: { nx: 0, ny: -1 }, inGs: 0,
    outT: { nx: 0, ny: 1 }, outN: { nx: 1, ny: 0 }, outGs: 0,
    inCriterion: DIST(-0.5, 20), outCriterion: REL(-0.25, -10),
    maxSearchDistance: 50,
  };

  it('builds the two terminal limit lines with the exact origins/directions', () => {
    expect(analyticTerminalLine(0, 0, 100, joint.inT, joint.inN, 0, joint.inCriterion))
      .toEqual({ ox: 0, oy: -20, oz: 90, dx: 1, dy: 0, dz: 0 });
    expect(analyticTerminalLine(0, 0, 100, joint.outT, joint.outN, 0, joint.outCriterion))
      .toEqual({ ox: 40, oy: 0, oz: 90, dx: 0, dy: 1, dz: 0 });
  });

  it('intersects at tie (40,-20,90) with miter extent sqrt(2000)', () => {
    const solution = solveAnalyticCorner(joint);
    if (!solution.ok || solution.kind !== 'miter') throw new Error('expected a miter tie');
    expect(solution.tie).toEqual({ x: 40, y: -20, z: 90 });
    expect(solution.extent).toBe(Math.sqrt(2000));
    expect(solution.extent).toBe(44.721359549995796);
  });

  it('an absolute Elevation E=90 variant lands on the identical tie', () => {
    const absolute = solveAnalyticCorner({ ...joint, outCriterion: ELEV(-0.25, 90) });
    if (!absolute.ok || absolute.kind !== 'miter') throw new Error('expected a miter tie');
    expect(absolute.tie).toEqual({ x: 40, y: -20, z: 90 });
    expect(absolute.extent).toBe(Math.sqrt(2000));
  });
});

// ---------------------------------------------------------------------------
// §17 — open two-course mixed group
// ---------------------------------------------------------------------------
describe('§17 open two-course mixed group', () => {
  const members = (): ResolvedGradingSource[] => [
    straight(-100, 0, 0, 0),
    straight(0, 0, 0, 100),
  ];

  const compute = () => computeGradingGroupFromSnapshots({
    groupId: '§17', revision: 'ggrev1:20h',
    members: members(), side: 'right',
    criterion: DIST(-0.5, 20),
    memberCriteria: [DIST(-0.5, 20), REL(-0.25, -10)],
    maxSearchDistance: 50, curveChordTolerance: 0.05, closed: false,
  });

  it('solves CURRENT with the §16 tie and honest projection/length stats', () => {
    const out = compute();
    if (!out.ok) throw new Error(`${out.code} ${out.detail ?? ''}`);
    const r = out.result;
    expect(r.corners).toHaveLength(1);
    expect(r.corners[0]!.tiePointXyz).toEqual([40, -20, 90]);
    expect(r.corners[0]!.miterExtent).toBe(Math.sqrt(2000));
    expect(r.minProjectionDistance).toBe(20);
    expect(r.maxProjectionDistance).toBe(40);
    expect(r.cutSourceLength).toBe(0);
    expect(r.fillSourceLength).toBe(0);
    expect(r.tiedSourceLength).toBe(0);
    expect(r.candidateTriangleCount).toBe(0);
    expect(r.intersectionSegmentCount).toBe(0);
    expect(r.multipleSolutionCount).toBe(0);
    expect(r.gradingMesh.points.length).toBeGreaterThan(0);
    expect(r.gradingMesh.triangles.length).toBeGreaterThan(0);
    expect(r.diagnostics).toEqual([]);
  });

  it('is deterministic (identical digest across repeats)', () => {
    expect(digest(compute())).toBe(digest(compute()));
  });
});

// ---------------------------------------------------------------------------
// §18 — closed mixed pad vs all-Distance control
// ---------------------------------------------------------------------------
describe('§18 closed mixed pad equals the all-Distance control', () => {
  const computeMixed = () => computeGradingGroupFromSnapshots({
    groupId: '§18', revision: 'ggrev1:20h',
    members: square(), side: 'right',
    criterion: DIST(-0.5, 20),
    // default Distance + one Elevation E=0 + one Relative Δ=-10
    memberCriteria: [DIST(-0.5, 20), ELEV(-0.5, 0), REL(-0.5, -10), DIST(-0.5, 20)],
    maxSearchDistance: 50, curveChordTolerance: 0.05, closed: true,
  });
  const computeControl = () => computeGradingGroupFromSnapshots({
    groupId: '§18', revision: 'ggrev1:20h',
    members: square(), side: 'right',
    criterion: DIST(-0.5, 20),
    memberCriteria: [DIST(-0.5, 20), DIST(-0.5, 20), DIST(-0.5, 20), DIST(-0.5, 20)],
    maxSearchDistance: 50, curveChordTolerance: 0.05, closed: true,
  });

  it('every course derives d=20 with limit Z=0 (source 10000, outer 19600)', () => {
    const out = computeMixed();
    if (!out.ok) throw new Error(`${out.code} ${out.detail ?? ''}`);
    const r = out.result;
    const zs = r.daylightPoints.filter((_, i) => i % 3 === 2);
    expect(Math.min(...zs)).toBeCloseTo(0, 9);
    expect(Math.max(...zs)).toBeCloseTo(0, 9);
    expect(r.minProjectionDistance).toBeCloseTo(20, 9);
    expect(r.maxProjectionDistance).toBeCloseTo(20, 9);
    expect(r.gradingMesh.points.length).toBeGreaterThan(0);
    expect(r.gradingMesh.triangles.length).toBeGreaterThan(0);
  });

  it('outer bounds -20..120 and four GAP corners at 20√2', () => {
    const out = computeMixed();
    if (!out.ok) throw new Error(`${out.code} ${out.detail ?? ''}`);
    const r = out.result;
    const xs = r.daylightPoints.filter((_, i) => i % 3 === 0);
    const ys = r.daylightPoints.filter((_, i) => i % 3 === 1);
    expect(Math.min(...xs)).toBeCloseTo(-20, 9);
    expect(Math.max(...xs)).toBeCloseTo(120, 9);
    expect(Math.min(...ys)).toBeCloseTo(-20, 9);
    expect(Math.max(...ys)).toBeCloseTo(120, 9);
    expect(r.corners).toHaveLength(4);
    for (const corner of r.corners) {
      expect(corner.classification).toBe('GAP');
      expect(corner.miterExtent).toBeCloseTo(20 * Math.SQRT2, 9);
    }
    expect(new Set(tiesOf(r.corners))).toEqual(
      new Set(['120,-20,0', '120,120,0', '-20,120,0', '-20,-20,0']),
    );
  });

  it('is fully equivalent to the all-Distance control (bytes, stats, diagnostics)', () => {
    const mixed = computeMixed();
    const control = computeControl();
    if (!mixed.ok || !control.ok) throw new Error('control or mixed solve failed');
    const a = mixed.result;
    const b = control.result;
    expect(a.gradingMesh.points).toEqual(b.gradingMesh.points);
    expect(a.gradingMesh.triangles).toEqual(b.gradingMesh.triangles);
    expect(a.daylightPoints).toEqual(b.daylightPoints);
    expect(tiesOf(a.corners)).toEqual(tiesOf(b.corners));
    expect(a.corners.map((c) => c.miterExtent)).toEqual(b.corners.map((c) => c.miterExtent));
    expect(a.gradingPlanArea).toBe(b.gradingPlanArea);
    expect(a.grading3dArea).toBe(b.grading3dArea);
    expect(a.minProjectionDistance).toBe(b.minProjectionDistance);
    expect(a.maxProjectionDistance).toBe(b.maxProjectionDistance);
    expect(a.meanProjectionDistance).toBe(b.meanProjectionDistance);
    expect(a.diagnostics).toEqual(b.diagnostics);
    expect(a.accuracy).toBe(b.accuracy);
    expect(digest(a)).toBe(digest(b));
  });
});

// ---------------------------------------------------------------------------
// §19 — incompatible-Z mixed corner fails closed
// ---------------------------------------------------------------------------
describe('§19 incompatible-Z mixed corner', () => {
  it('Δ=-12 (d=48, out Z=88) vs in Z=90 → CORNER_NO_SOLUTION / GRADING_ANALYTIC_CORNER_Z', () => {
    const out = computeGradingGroupFromSnapshots({
      groupId: '§19', revision: 'ggrev1:20h',
      members: [straight(-100, 0, 0, 0), straight(0, 0, 0, 100)],
      side: 'right', criterion: DIST(-0.5, 20),
      memberCriteria: [DIST(-0.5, 20), REL(-0.25, -12)],
      maxSearchDistance: 50, curveChordTolerance: 0.05, closed: false,
    });
    expect(out.ok).toBe(false);
    if (out.ok) throw new Error('expected CORNER_NO_SOLUTION');
    expect(out.code).toBe('CORNER_NO_SOLUTION');
    expect(out.detail).toBe('GRADING_ANALYTIC_CORNER_Z');
  });
});
