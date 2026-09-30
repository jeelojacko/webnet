/**
 * Phase 20K Worker-VARIANTS — hybrid arc-pair variant study (§15-18, §22 partial).
 *
 * Evidence-only: every case routes through `resolveArcPairStudy`, which
 * imports Worker-CORE (`scripts/phase20kHybridArcPairCore.ts`) and delegates
 * the corner to `solveHybridCorner` (arc×arc guard cleared). Labels are
 * `ARC_PAIR_*` only; production stays frozen on the arc-pair block.
 */
import { describe, expect, it } from 'vitest';

import {
  flatTin,
  overlapAnalyticArc,
  overlapSurfaceArc,
  resolveArcPairStudy,
  reverseArcSpec,
  type ArcPairStudyInput,
} from '../scripts/phase20kHybridArcPairVariants';
import { resolveGradingSourceCourse, type GradingCourseLike } from '../src/engine/cad/grading/gradingCourseFrame';
import type { GradingCriterion } from '../src/engine/cad/grading/gradingTypes';

const FIXED = (g: number): GradingCriterion => ({ kind: 'fixed', gradeRatio: g });
const CUTFILL = (c: number, f: number): GradingCriterion =>
  ({ kind: 'cut-fill', cutGradeRatio: c, fillGradeRatio: f });
const DIST = (g: number, d: number): GradingCriterion => ({ kind: 'distance', gradeRatio: g, distance: d });
const ELEV = (g: number, e: number): GradingCriterion => ({ kind: 'elevation', gradeRatio: g, targetElevation: e });
const REL = (g: number, dz: number): GradingCriterion =>
  ({ kind: 'relative-elevation', gradeRatio: g, relativeElevation: dz });

const TOL = 10;
const V = { vx: 0, vy: 0, vz: 100 };

const run = (over: Partial<ArcPairStudyInput> = {}) => resolveArcPairStudy({
  ...V,
  side: 'right',
  surfaceArc: overlapSurfaceArc(),
  surfaceCriterion: FIXED(-0.5),
  analyticArc: overlapAnalyticArc(),
  analyticCriterion: DIST(-0.25, 40),
  target: flatTin(90),
  maxSearchDistance: 100,
  curveChordTolerance: TOL,
  buildMesh: true,
  ...over,
});

type Result = ReturnType<typeof resolveArcPairStudy>;

const arms = (r: Result, n: number): void => {
  expect(r.mesh).not.toBeNull();
  expect(r.audit).not.toBeNull();
  expect(r.audit!.validTin).toBe(true);
  expect(r.audit!.invertedTriangles).toBe(0);
  expect(r.audit!.doubleCoverPairs).toBe(0);
  expect(r.audit!.maxDoubleCoverArea).toBeLessThanOrEqual(1e-9);
  expect(r.audit!.components).toBe(1);
  expect(r.audit!.boundaryLoops).toBe(1);
  expect(r.audit!.tieRetained).toBe(true);
  expect(r.mesh!.triangles.length / 3).toBeGreaterThanOrEqual(n);
};

/** Plan area over a merged mesh (independent of triangle order). */
const planArea = (mesh: { points: number[]; triangles: number[] }): number => {
  let sum = 0;
  for (let f = 0; f + 2 < mesh.triangles.length; f += 3) {
    const a = mesh.triangles[f]!;
    const b = mesh.triangles[f + 1]!;
    const c = mesh.triangles[f + 2]!;
    const ax = mesh.points[a * 3]!;
    const ay = mesh.points[a * 3 + 1]!;
    const bx = mesh.points[b * 3]!;
    const by = mesh.points[b * 3 + 1]!;
    const cx = mesh.points[c * 3]!;
    const cy = mesh.points[c * 3 + 1]!;
    sum += Math.abs((bx - ax) * (cy - ay) - (cx - ax) * (by - ay)) / 2;
  }
  return sum;
};

describe('phase20k arc-pair OVERLAP oracle', () => {
  it('one-chord (tol 25) is chord-degenerate: tangent terminal chords, no tie, no mesh', () => {
    const r = run({ curveChordTolerance: 25 });
    expect(r.inChords).toBe(1);
    expect(r.outChords).toBe(1);
    expect(r.turn).toBe('TANGENT');
    expect(r.outcome).toBe('ARC_PAIR_CHORD_DEGENERATE');
    expect(r.detail).toBe('parallel-terminal-chords');
    expect(r.tie).toBeNull();
    expect(r.mesh).toBeNull();
    expect(r.digest).toBe('');
    // Identical single chords — endpoint comparison alone cannot separate them.
    expect(r.inChord!.t).toEqual(r.outChord!.t);
    expect(r.inChord!.n).toEqual(r.outChord!.n);
  });

  it('two-chord (tol 10) resolves the exact OVERLAP tie with a clean corner mesh', () => {
    const r = run();
    expect(r.inChords).toBe(2);
    expect(r.outChords).toBe(2);
    expect(r.turn).toBe('OVERLAP');
    expect(r.outcome).toBe('ARC_PAIR_EXACT_COMMON_TIE');
    expect(r.exact).toBe(true);
    expect(r.cutFill).toBe('FILL');
    expect(r.tie!.x).toBeCloseTo(-41.43859659213113, 9);
    expect(r.tie!.y).toBeCloseTo(-4.483415291679644, 9);
    expect(r.tie!.z).toBeCloseTo(90, 12);
    expect(r.extent).toBeCloseTo(41.68043066239897, 9);
    arms(r, 8);
    const runHits = r.cornerRun!.filter((p) => p.x === r.tie!.x && p.y === r.tie!.y && p.z === r.tie!.z).length;
    expect(runHits).toBe(1);
    expect(r.cornerRun![1]).toEqual(r.tie);
  });

  it('ladder subdivisions grow monotonically; every tol <= 10 stays a finite exact OVERLAP', () => {
    const expected: Array<[number, number, number]> = [
      [25, 1, 1], [10, 2, 2], [1, 5, 5], [0.1, 14, 16], [0.01, 44, 50],
    ];
    for (const [tol, inN, outN] of expected) {
      const r = run({ curveChordTolerance: tol });
      expect(r.inChords, `in @${tol}`).toBe(inN);
      expect(r.outChords, `out @${tol}`).toBe(outN);
      if (tol === 25) {
        expect(r.outcome).toBe('ARC_PAIR_CHORD_DEGENERATE');
      } else {
        expect(r.outcome).toBe('ARC_PAIR_EXACT_COMMON_TIE');
        expect(r.turn).toBe('OVERLAP');
        expect(Number.isFinite(r.extent!)).toBe(true);
      }
    }
  });

  it('converges to the true-tangent reference tie (-40,-20,90) with extent √2000', () => {
    const trueRef = run({ trueTangents: true, buildMesh: false });
    expect(trueRef.tie!.x).toBeCloseTo(-40, 9);
    expect(trueRef.tie!.y).toBeCloseTo(-20, 9);
    expect(trueRef.tie!.z).toBeCloseTo(90, 12);
    expect(trueRef.extent).toBeCloseTo(Math.sqrt(2000), 9);
    expect(trueRef.inChord!.t.nx).toBeCloseTo(1, 12);
    expect(trueRef.inChord!.t.ny).toBeCloseTo(0, 12);
    expect(trueRef.outChord!.t.nx).toBeCloseTo(0, 12);
    expect(trueRef.outChord!.t.ny).toBeCloseTo(-1, 12);
    const chord = run({ buildMesh: false });
    expect(trueRef.extent! - chord.extent!).toBeGreaterThan(2.9);
  });

  it('is deterministic across runs and across the audited mesh', () => {
    const a = run();
    const b = run();
    expect(b.digest).toBe(a.digest);
    expect(JSON.stringify(b.audit)).toBe(JSON.stringify(a.audit));
    expect(b.mesh!.points).toEqual(a.mesh!.points);
    expect(b.mesh!.triangles).toEqual(a.mesh!.triangles);
  });
});

describe('phase20k method variants on level sources', () => {
  it('Distance / Elevation / Relative resolve to identical tie, extent, patch, mesh and digest', () => {
    const a = run({ analyticCriterion: DIST(-0.25, 40) });
    const b = run({ analyticCriterion: ELEV(-0.25, 90) });
    const c = run({ analyticCriterion: REL(-0.25, -10) });
    for (const r of [a, b, c]) {
      expect(r.outcome).toBe('ARC_PAIR_EXACT_COMMON_TIE');
      expect(r.tie!.z).toBeCloseTo(90, 12);
    }
    expect(b.tie).toEqual(a.tie);
    expect(c.tie).toEqual(a.tie);
    expect(b.extent).toEqual(a.extent);
    expect(c.extent).toEqual(a.extent);
    expect(b.qa).toEqual(a.qa);
    expect(c.qa).toEqual(a.qa);
    expect(b.mesh!.triangles).toEqual(a.mesh!.triangles);
    expect(c.mesh!.triangles).toEqual(a.mesh!.triangles);
    expect(b.digest).toBe(a.digest);
    expect(c.digest).toBe(a.digest);
    expect(JSON.stringify(b.audit)).toBe(JSON.stringify(a.audit));
  });
});

describe('phase20k CUT/FILL active grade selection', () => {
  it('FILL: target below the joint selects fillGradeRatio and ties at Z=90', () => {
    const r = run({ surfaceCriterion: CUTFILL(0.5, -0.5), target: flatTin(90) });
    expect(r.cutFill).toBe('FILL');
    expect(r.outcome).toBe('ARC_PAIR_EXACT_COMMON_TIE');
    expect(r.tie!.z).toBeCloseTo(90, 12);
    expect(r.turn).toBe('OVERLAP');
    arms(r, 8);
  });

  it('CUT: target above the joint selects cutGradeRatio and ties at Z=110', () => {
    const r = run({ surfaceCriterion: CUTFILL(0.5, -0.5), analyticCriterion: REL(0.25, 10), target: flatTin(110) });
    expect(r.cutFill).toBe('CUT');
    expect(r.outcome).toBe('ARC_PAIR_EXACT_COMMON_TIE');
    expect(r.tie!.z).toBeCloseTo(110, 12);
    expect(r.turn).toBe('OVERLAP');
    arms(r, 8);
  });

  it('tied-at-V (target == joint Z) fails closed with no tie and no mesh', () => {
    const r = run({ surfaceCriterion: CUTFILL(0.5, -0.5), target: flatTin(100) });
    expect(r.cutFill).toBe('TIED');
    expect(r.outcome).toBe('ARC_PAIR_NO_TIE');
    expect(r.tie).toBeNull();
    expect(r.mesh).toBeNull();
    expect(r.detail).toBeTruthy();
  });
});

describe('phase20k nonzero longitudinal grade', () => {
  const graded = (over: Partial<ArcPairStudyInput> = {}): Result => resolveArcPairStudy({
    ...V,
    side: 'right',
    surfaceArc: overlapSurfaceArc(96, 100),
    surfaceCriterion: FIXED(-0.5),
    analyticArc: overlapAnalyticArc(100, 104),
    analyticCriterion: ELEV(-0.25, 90),
    target: flatTin(90),
    maxSearchDistance: 100,
    curveChordTolerance: 10,
    buildMesh: false,
    ...over,
  });

  it('reports per-terminal-chord grade distinct from the true arc-length grade', () => {
    const r = graded();
    expect(r.inChordGrade).toBeCloseTo(0.04355209882921256, 12);
    expect(r.outChordGrade).toBeCloseTo(0.032664074121909414, 12);
    // Chord frame mirrors production grade (terminal chord ΔZ/chord length);
    // true-tangent keeps the arc-length grade.
    expect(r.inChord!.gs).toBe(r.inChordGrade);
    expect(r.outChord!.gs).toBe(r.outChordGrade);
    expect(r.inTrue!.gs).toBeCloseTo(0.04244131815783876, 12);
    expect(r.outTrue!.gs).toBeCloseTo(0.03183098861837907, 12);
    expect(Math.abs(r.inChordGrade! - r.inTrue!.gs)).toBeGreaterThan(1e-3);
    expect(Math.abs(r.outChordGrade! - r.outTrue!.gs)).toBeGreaterThan(5e-4);
  });

  it('finite-chord tie and the independent true-tangent reference agree in Z via line/plane', () => {
    const r = graded();
    expect(r.outcome).toBe('ARC_PAIR_EXACT_COMMON_TIE');
    expect(r.exact).toBe(true);
    expect(r.tie!.z).toBeCloseTo(90, 12);
    expect(r.tie!.x).toBeCloseTo(-40.72979021543077, 9);
    expect(r.tie!.y).toBeCloseTo(-1.2752889004603134, 9);
    expect(r.extent).toBeCloseTo(40.749750585404044, 9);
    const trueRef = graded({ trueTangents: true });
    expect(trueRef.tie!.x).toBeCloseTo(-42.09157052974354, 9);
    expect(trueRef.tie!.y).toBeCloseTo(-16.42715652676808, 9);
    expect(trueRef.tie!.z).toBeCloseTo(90, 12);
    expect(trueRef.extent).toBeCloseTo(45.183534403755026, 9);
    // Endpoints alone are not enough: the true-tangent reference moves the
    // joint far from the chord tie while both keep Z=90.
    expect(Math.hypot(trueRef.tie!.x - r.tie!.x, trueRef.tie!.y - r.tie!.y)).toBeGreaterThan(10);
  });

  it('a Z-disagreeing joint fails closed: XY proximity cannot satisfy the agreement gate', () => {
    const good = graded();
    const shifted = graded({ target: flatTin(90.002) });
    expect(good.outcome).toBe('ARC_PAIR_EXACT_COMMON_TIE');
    expect(good.exact).toBe(true);
    expect(shifted.outcome).toBe('ARC_PAIR_FINITE_TRANSITION');
    expect(shifted.tie).toBeNull();
    // The target shift moves the finite-chord XY by only a few millimetres
    // while Z disagrees by 2 mm — the line/plane Z gate is what rejects it.
    const probe = resolveArcPairStudy({
      ...V, side: 'right',
      surfaceArc: overlapSurfaceArc(96, 100), surfaceCriterion: FIXED(-0.5),
      analyticArc: overlapAnalyticArc(100, 104), analyticCriterion: ELEV(-0.25, 90),
      target: flatTin(90), maxSearchDistance: 100, curveChordTolerance: 10, buildMesh: false,
    });
    expect(probe.tie!.z).toBeCloseTo(90, 12);
  });
});

describe('phase20k member-order and stored-course reversal', () => {
  const forward = (): Result => resolveArcPairStudy({
    ...V,
    side: 'right',
    surfaceArc: overlapSurfaceArc(),
    surfaceCriterion: FIXED(-0.5),
    analyticArc: overlapAnalyticArc(),
    analyticCriterion: DIST(-0.25, 40),
    target: flatTin(90),
    maxSearchDistance: 100,
    curveChordTolerance: 10,
    buildMesh: true,
  });

  // Same physical chain traversed B->V->A with the physical side preserved
  // (right in A->B becomes left in B->A).
  const reversed = (): Result => resolveArcPairStudy({
    ...V,
    side: 'left',
    surfaceArc: reverseArcSpec(overlapAnalyticArc()),
    surfaceCriterion: DIST(-0.25, 40),
    analyticArc: reverseArcSpec(overlapSurfaceArc()),
    analyticCriterion: FIXED(-0.5),
    target: flatTin(90),
    maxSearchDistance: 100,
    curveChordTolerance: 10,
    buildMesh: true,
  });

  it('preserves the physical tie, extent, classification and covered region', () => {
    const f = forward();
    const r = reversed();
    expect(r.outcome).toBe(f.outcome);
    expect(r.turn).toBe('OVERLAP');
    expect(r.turn).toBe(f.turn);
    expect(r.exact).toBe(f.exact);
    expect(r.tie).toEqual(f.tie);
    expect(r.extent).toEqual(f.extent);
    expect(r.cornerRun![1]).toEqual(f.cornerRun![1]);
    // The per-node chord-normal band tiling is traversal-direction dependent
    // by a fraction of the chord tolerance; the covered region matches.
    const fa = planArea(f.mesh!);
    const ra = planArea(r.mesh!);
    expect(Math.abs(ra - fa) / fa).toBeLessThan(0.02);
    arms(r, 8);
    arms(f, 8);
  });

  it('swaps angle/sweep and negates tangents while the side normal is stable', () => {
    const f = forward();
    const r = reversed();
    expect(r.inChord!.t.nx).toBeCloseTo(-f.outChord!.t.nx, 12);
    expect(r.inChord!.t.ny).toBeCloseTo(-f.outChord!.t.ny, 12);
    expect(r.outChord!.t.nx).toBeCloseTo(-f.inChord!.t.nx, 12);
    expect(r.outChord!.t.ny).toBeCloseTo(-f.inChord!.t.ny, 12);
    expect(r.inChord!.n.nx).toBeCloseTo(f.outChord!.n.nx, 12);
    expect(r.inChord!.n.ny).toBeCloseTo(f.outChord!.n.ny, 12);
    expect(r.outChord!.n.nx).toBeCloseTo(f.inChord!.n.nx, 12);
    expect(r.outChord!.n.ny).toBeCloseTo(f.inChord!.n.ny, 12);
    const a = reverseArcSpec(overlapAnalyticArc());
    const ana = overlapAnalyticArc();
    expect(a.startAngle).toBeCloseTo(ana.endAngle, 12);
    expect(a.endAngle).toBeCloseTo(ana.startAngle, 12);
    expect(a.sweepCCW).toBe(!ana.sweepCCW);
  });

  it('stored B->A course reorients to the same physical A->B source', () => {
    const member = overlapAnalyticArc();
    const toDeg = (rad: number): number => (rad * 180) / Math.PI;
    const sweepDeg = ((member.sweepCCW ? member.endAngle - member.startAngle : member.startAngle - member.endAngle) * 180) / Math.PI;
    const forwardCourse: GradingCourseLike = {
      fromVertexId: 'V', toVertexId: 'B',
      startX: member.centerX + member.radius * Math.cos(member.startAngle),
      startY: member.centerY + member.radius * Math.sin(member.startAngle),
      endX: member.centerX + member.radius * Math.cos(member.endAngle),
      endY: member.centerY + member.radius * Math.sin(member.endAngle),
      startZ: member.startZ, endZ: member.endZ,
      planLength: member.radius * (Math.PI / 2), isArc: true,
      arc: {
        centerX: member.centerX, centerY: member.centerY, radius: member.radius,
        startAngleDeg: toDeg(member.startAngle), signedSweepDeg: sweepDeg,
      },
    };
    const backwardCourse: GradingCourseLike = {
      ...forwardCourse,
      fromVertexId: 'B', toVertexId: 'V',
      startX: forwardCourse.endX, startY: forwardCourse.endY,
      endX: forwardCourse.startX, endY: forwardCourse.startY,
      startZ: member.endZ, endZ: member.startZ,
      arc: { ...forwardCourse.arc!, startAngleDeg: toDeg(member.endAngle), signedSweepDeg: -sweepDeg },
    };
    const fwd = resolveGradingSourceCourse([forwardCourse], 'V', 'B');
    const back = resolveGradingSourceCourse([backwardCourse], 'V', 'B');
    expect(fwd).not.toBeNull();
    expect(back).not.toBeNull();
    expect(back!.reoriented).toBe(true);
    expect(back!.startX).toBeCloseTo(fwd!.startX, 9);
    expect(back!.endX).toBeCloseTo(fwd!.endX, 9);
    expect(back!.arc!.startAngle).toBeCloseTo(fwd!.arc!.startAngle, 9);
    expect(back!.arc!.endAngle).toBeCloseTo(fwd!.arc!.endAngle, 9);
    expect(back!.length).toBeCloseTo(fwd!.length, 9);
  });

  it('reports the Worker-CORE terminal-frame models used by the proof', () => {
    const r = run({ buildMesh: false });
    expect(r.inChord!.t.nx).toBeCloseTo(0.9238795325112867, 12);
    expect(r.inChord!.t.ny).toBeCloseTo(-0.38268343236508995, 12);
    expect(r.outChord!.t.nx).toBeCloseTo(0.3826834323650898, 12);
    expect(r.outChord!.t.ny).toBeCloseTo(-0.9238795325112867, 12);
    expect(r.outTrue!.t.ny).toBeCloseTo(-1, 12);
    expect(r.inTrue!.t.nx).toBeCloseTo(1, 12);
  });
});
