/**
 * Phase 20K.2 Worker C — CUT/FILL direct-fan target-membership policy.
 *
 * The Surface chord seam admits a direct CUT/FILL transition fan ONLY when
 * the bridge is proven to lie on the target (`directFanOnTarget`): a genuine
 * cut/fill criterion, V agreeing with the target elevation under the shared
 * anchored contract, and the whole qIn→V→qOut fan covered by one target
 * plane (segment walk). Ridges, valleys, voids, steps/branches, off-target V,
 * and non-cut/fill criteria fail closed with
 * `GRADING_SURFACE_SEAM_TRANSITION_REQUIRED`. The mismatch ladder 1e-12..1e-3
 * shows the 1 nm `AGREEMENT_FLOOR` is the representation-noise bound (≤ floor
 * accepted, ≥ 1e-8 rejected) with the global `zeroDelta` untouched.
 */
import { describe, expect, it } from 'vitest';

import { zeroDelta } from '../src/engine/cad/surfaces/volume/zero';
import { directFanOnTarget } from '../src/engine/cad/grading/gradingChordSeam';
import { AGREEMENT_FLOOR } from '../src/engine/cad/grading/gradingGroupSectors';
import { buildTargetQuery } from '../src/engine/cad/grading/gradingTargetIndex';
import { roundedSquareMembers } from '../scripts/phase20kHybridArcPairGroups';
import { computeGradingFromSnapshots } from '../src/workers/surfaceGradingCompute';
import type {
  GradingTargetMeshSnapshot,
  TargetQuery,
} from '../src/engine/cad/grading/gradingComputeTypes';
import type { GradingCriterion } from '../src/engine/cad/grading/gradingTypes';

const CUT_FILL: GradingCriterion = { kind: 'cut-fill', cutGradeRatio: 0.5, fillGradeRatio: -2 };
const FIXED: GradingCriterion = { kind: 'fixed', gradeRatio: -0.5 };

const range = (a: number, b: number, s: number): number[] => {
  const out: number[] = [];
  for (let v = a; v <= b + 1e-9; v += s) out.push(v);
  return out;
};

const grid = (
  fn: (_x: number, _y: number) => number,
  xs: number[],
  ys: number[],
  anti = false,
): GradingTargetMeshSnapshot => {
  const points: number[] = [];
  for (const y of ys) for (const x of xs) points.push(x, y, fn(x, y));
  const triangles: number[] = [];
  const idx = (ix: number, iy: number): number => iy * xs.length + ix;
  for (let ix = 0; ix + 1 < xs.length; ix += 1) {
    for (let iy = 0; iy + 1 < ys.length; iy += 1) {
      const a = idx(ix, iy);
      const b = idx(ix + 1, iy);
      const c = idx(ix + 1, iy + 1);
      const d = idx(ix, iy + 1);
      if (!anti) triangles.push(a, b, c, a, c, d);
      else triangles.push(a, b, d, b, c, d);
    }
  }
  return { points, triangles };
};

const query = (tin: GradingTargetMeshSnapshot): TargetQuery => {
  const built = buildTargetQuery(tin);
  if (!built) throw new Error('target query failed');
  return built;
};

const V = { x: 0, y: 0, z: 0 };
const Q_IN = { x: 10, y: 0, z: 0 };
const Q_OUT = { x: 0, y: -10, z: 0 };
const FLAT = grid(() => 0, range(-50, 50, 10), range(-50, 50, 10));

describe('20K.2 A4 direct CUT/FILL fan — proven target membership', () => {
  it('accepts a flat planar bridge (qIn/V/qOut coplanar)', () => {
    expect(directFanOnTarget(CUT_FILL, query(FLAT), V, Q_IN, Q_OUT)).toBe(true);
  });

  it('accepts a sloped planar bridge', () => {
    const sloped = grid((x, y) => 0.1 * x + 0.05 * y, range(-50, 50, 10), range(-50, 50, 10));
    expect(directFanOnTarget(CUT_FILL, query(sloped), V, { x: 10, y: 0, z: 1 }, { x: 0, y: -10, z: -0.5 })).toBe(true);
  });

  it('accepts alternate triangulation of the same plane', () => {
    const fn = (x: number): number => 0.125 * x;
    const main = grid(fn, range(-40, 40, 8), range(-40, 40, 8));
    const anti = grid(fn, range(-40, 40, 8), range(-40, 40, 8), true);
    expect(directFanOnTarget(CUT_FILL, query(main), V, { x: 10, y: 0, z: 1.25 }, { x: 0, y: -10, z: 0 })).toBe(true);
    expect(directFanOnTarget(CUT_FILL, query(anti), V, { x: 10, y: 0, z: 1.25 }, { x: 0, y: -10, z: 0 })).toBe(true);
  });

  it('accepts a coplanar multi-triangle target', () => {
    const fine = grid((x) => 0.1 * x, range(-40, 40, 4), range(-40, 40, 4));
    expect(directFanOnTarget(CUT_FILL, query(fine), V, { x: 10, y: 0, z: 1 }, { x: 0, y: -10, z: 0 })).toBe(true);
  });

  it('accepts the tied-station collapse (qIn == qOut == V)', () => {
    expect(directFanOnTarget(CUT_FILL, query(FLAT), V, { ...V }, { ...V })).toBe(true);
  });

  it('rejects a non-cut/fill criterion', () => {
    expect(directFanOnTarget(FIXED, query(FLAT), V, Q_IN, Q_OUT)).toBe(false);
  });

  it('rejects a station V that does not agree with the target elevation', () => {
    expect(directFanOnTarget(CUT_FILL, query(FLAT), { x: 0, y: 0, z: 10 }, Q_IN, Q_OUT)).toBe(false);
  });

  it('rejects a ridge or valley between qIn and qOut', () => {
    const ridge = grid((x) => (x > 2 && x < 8 ? 5 * (1 - Math.abs((x - 5) / 3)) : 0), range(-20, 20, 1), range(-20, 20, 4));
    const valley = grid((x) => (x > 2 && x < 8 ? -5 * (1 - Math.abs((x - 5) / 3)) : 0), range(-20, 20, 1), range(-20, 20, 4));
    // V is on the target; the bridge qIn→qOut crosses the bump.
    expect(directFanOnTarget(CUT_FILL, query(ridge), V, Q_IN, Q_OUT)).toBe(false);
    expect(directFanOnTarget(CUT_FILL, query(valley), V, Q_IN, Q_OUT)).toBe(false);
  });

  it('rejects a narrow ridge between the old fixed samples (true facet walk)', () => {
    // Reviewer case: a single raised column at x=7.5 sits exactly between the
    // old 12 samples (x=8,6,4,2 along the fan), so the resampled walk passed.
    // elevationAt(7.5,-0.5) is genuinely 1, so the facet walk must reject.
    const ridge = grid(
      (x) => (Math.abs(x - 7.5) < 1e-9 ? 1 : 0),
      range(-20, 20, 0.5),
      range(-20, 20, 4),
    );
    expect(query(ridge).elevationAt(7.5, -0.5)).toBe(1);
    expect(directFanOnTarget(CUT_FILL, query(ridge), V, Q_IN, Q_OUT)).toBe(false);
  });

  it('rejects a void or off-target bridge', () => {
    const empty: GradingTargetMeshSnapshot = { points: [], triangles: [] };
    expect(directFanOnTarget(CUT_FILL, query(empty), V, Q_IN, Q_OUT)).toBe(false);
    const tiny = grid(() => 0, range(-1, 1, 1), range(-1, 1, 1));
    expect(directFanOnTarget(CUT_FILL, query(tiny), V, Q_IN, Q_OUT)).toBe(false);
  });

  it('rejects a stepped/branched (multi-root) target across the fan', () => {
    const step = grid((x) => (x > 2 ? 1 : 0), range(-20, 20, 1), range(-20, 20, 4));
    // V on the low step, qIn on the high step, qOut low: the straight bridge
    // cuts the step, so the segment walk rejects it.
    expect(directFanOnTarget(CUT_FILL, query(step), V, { x: 10, y: 0, z: 1 }, Q_OUT)).toBe(false);
  });

  it('is translation invariant and deterministic', () => {
    const shifted = grid(() => 0, range(999_950, 1_000_050, 10), range(999_950, 1_000_050, 10));
    const sv = { x: 1_000_000, y: 1_000_000, z: 0 };
    const sin = { x: 1_000_010, y: 1_000_000, z: 0 };
    const sout = { x: 1_000_000, y: 999_990, z: 0 };
    expect(directFanOnTarget(CUT_FILL, query(shifted), sv, sin, sout)).toBe(true);
    expect(directFanOnTarget(CUT_FILL, query(shifted), sv, sin, sout)).toBe(true);
  });
});

describe('20K.2 agreement floor ladder (1e-12 .. 1e-3)', () => {
  it('accepts representation noise at/below the 1 nm floor, rejects design mismatch', () => {
    expect(AGREEMENT_FLOOR).toBe(1e-9);
    const pass: number[] = [];
    const fail: number[] = [];
    for (const dz of [0, 1e-12, 1e-9, 1e-8, 1e-6, 1e-3]) {
      const tin = grid(() => dz, range(-50, 50, 10), range(-50, 50, 10));
      const accepted = directFanOnTarget(CUT_FILL, query(tin), { x: 0, y: 0, z: 0 }, { x: 10, y: 0, z: dz }, { x: 0, y: -10, z: dz });
      (accepted ? pass : fail).push(dz);
    }
    expect(pass).toEqual([0, 1e-12, 1e-9]);
    expect(fail).toEqual([1e-8, 1e-6, 1e-3]);
  });

  it('never changes the global zeroDelta classification floor', () => {
    const before = zeroDelta(100, 100);
    directFanOnTarget(CUT_FILL, query(FLAT), V, Q_IN, Q_OUT);
    expect(zeroDelta(100, 100)).toBe(before);
  });
});

describe('20K.2 curved Surface CUT/FILL fan integration', () => {
  it('resolves the CUT/FILL tilted-cross arc through the direct fan (CURRENT)', () => {
    const src = roundedSquareMembers(10)[0]!.source;
    const cross = grid((x) => 10 + 0.1 * (x - 50), range(-100, 200, 10), range(-60, 60, 10));
    const out = computeGradingFromSnapshots({
      gradingId: '20k2', revision: 'r', source: src, side: 'right',
      criterion: CUT_FILL, maxSearchDistance: 100, curveChordTolerance: 0.1, target: cross,
    });
    expect(out.ok).toBe(true);
    if (!out.ok) return;
    const kinds = new Set(out.result.regions.map((r) => r.classification));
    expect(kinds.has('CUT')).toBe(true);
    expect(kinds.has('FILL')).toBe(true);
    expect(out.result.gradingMesh.points.length / 3).toBe(181);
    expect(out.result.gradingMesh.triangles.length / 3).toBe(177);
  });
});
