/**
 * Phase 20M.2 WAVE J — transition robustness (measurement pins, no tuning).
 *
 * Admitted collinear same-family transitions must survive rigid
 * translations (1e6/1e8), mirror, traversal reversal, short members, the
 * exact width boundary, finite scalar extremes, and repeat solves —
 * every inadmissible input fails closed with a bounded code.
 * Deviations below are MEASURED (see run output), never widened post hoc.
 */
import { describe, expect, it } from 'vitest';
import {
  computeGradingGroupFromSnapshots,
  type GradingGroupComputeOutcome,
  type GroupSolveInput,
} from '../src/engine/cad/grading/gradingGroupCompute';
import type { CadGradingTransition } from '../src/engine/cad/grading/gradingGroupTypes';
import type { GradingCriterion, ResolvedGradingSource } from '../src/engine/cad/grading/gradingTypes';

const DIST = (g: number, d: number): GradingCriterion => ({ kind: 'distance', gradeRatio: g, distance: d });

const seg = (sx: number, sy: number, ex: number, ey: number, sz = 10, ez = 10): ResolvedGradingSource => ({
  startX: sx, startY: sy, endX: ex, endY: ey, startZ: sz, endZ: ez,
  length: Math.hypot(ex - sx, ey - sy), reoriented: false, isArc: false,
});

const trp = (o: Partial<CadGradingTransition> = {}): CadGradingTransition => ({
  policyVersion: 'trp1', jointId: 'joint:0', memberIds: ['A>B', 'B>C'],
  width: 8, lawKind: 'TRANSITION_LINEAR_V1', lawVersion: 'v1',
  criterionFamily: 'distance', side: 'left', ...o,
});

const solve = (
  members: ResolvedGradingSource[],
  transition?: CadGradingTransition,
  extra: Partial<GroupSolveInput> = {},
): GradingGroupComputeOutcome => computeGradingGroupFromSnapshots({
  groupId: 'g', revision: 'ggrev1:t', members, side: 'left',
  criterion: DIST(0.5, 5), memberCriteria: [DIST(0.5, 5), DIST(0.5, 7)],
  maxSearchDistance: 50, curveChordTolerance: 0.01, closed: false,
  ...(transition !== undefined ? { transition, transitionMemberKeys: ['A>B', 'B>C'] } : {}),
  ...extra,
});

const ok = (o: GradingGroupComputeOutcome) => {
  expect(o.ok).toBe(true);
  if (!o.ok) throw new Error(`expected ok, got ${JSON.stringify(o).slice(0, 160)}`);
  return o.result;
};

const failCode = (o: GradingGroupComputeOutcome): string => {
  expect(o.ok).toBe(false);
  return (o as { ok: false; code: string }).code;
};

const maxAbs = (a: number[], b: number[]): number => {
  expect(a.length).toBe(b.length);
  let m = 0;
  for (let i = 0; i < a.length; i++) m = Math.max(m, Math.abs(a[i]! - b[i]!));
  return m;
};

/** Every triangle strictly positive plan area + finite vertices. */
const assertOriented = (points: number[], triangles: number[]): void => {
  expect(triangles.length).toBeGreaterThan(0);
  for (let i = 0; i < triangles.length; i += 3) {
    const [a, b, c] = [triangles[i]! * 3, triangles[i + 1]! * 3, triangles[i + 2]! * 3];
    const area2 = (points[b]! - points[a]!) * (points[c + 1]! - points[a + 1]!) -
      (points[c]! - points[a]!) * (points[b + 1]! - points[a + 1]!);
    expect(area2).toBeGreaterThan(0);
  }
  for (const v of points) expect(Number.isFinite(v)).toBe(true);
};

const BASE_MEMBERS = [seg(-20, 0, 0, 0), seg(0, 0, 20, 0)];
const BASE_DAYLIGHT = [-20, 5, 12.5, -4, 5, 12.5, 0, 6, 13, 4, 7, 13.5, 20, 7, 13.5];

describe('20M.2 transition robustness', () => {
  it('rigid translations 1e6/1e8 leave the admitted mesh bit-identical up to the shift', () => {
    for (const t of [1e6, 1e8]) {
      const r = ok(solve([seg(-20 + t, 0, t, 0), seg(t, 0, 20 + t, 0)], trp()));
      const expected = BASE_DAYLIGHT.map((v, i) => (i % 3 === 0 ? v + t : v));
      expect(maxAbs(r.daylightPoints, expected)).toBe(0);
      expect(r.gradingMesh.triangles).toHaveLength(8 * 3);
      assertOriented(r.gradingMesh.points, r.gradingMesh.triangles);
    }
  });

  it('mirror across the transverse axis negates plan offsets exactly (chirality flips side)', () => {
    const r = ok(solve([seg(20, 0, 0, 0), seg(0, 0, -20, 0)], trp()));
    const expected = BASE_DAYLIGHT.map((v, i) => (i % 3 === 2 ? v : -v));
    expect(maxAbs(r.daylightPoints, expected)).toBe(0);
    assertOriented(r.gradingMesh.points, r.gradingMesh.triangles);
  });

  it('traversal reversal admits and lands on the mirrored roadside (pre-existing side-relative semantics)', () => {
    const r = ok(solve([seg(20, 0, 0, 0), seg(0, 0, -20, 0)], trp(), {
      criterion: DIST(0.5, 7), memberCriteria: [DIST(0.5, 7), DIST(0.5, 5)],
    }));
    expect(r.daylightPoints).toEqual([20, -7, 13.5, 4, -7, 13.5, 0, -6, 13, -4, -5, 12.5, -20, -5, 12.5]);
    assertOriented(r.gradingMesh.points, r.gradingMesh.triangles);
  });

  it('short members admit with an oriented mesh (width within 2x-min)', () => {
    const r = ok(solve([seg(-5, 0, 0, 0), seg(0, 0, 5, 0)], trp()));
    expect(r.gradingMesh.triangles).toHaveLength(8 * 3);
    assertOriented(r.gradingMesh.points, r.gradingMesh.triangles);
  });

  it('exact width boundary: 2x-min admits, anything above rejects (no epsilon)', () => {
    expect(ok(solve(BASE_MEMBERS, trp({ width: 40 }))).daylightPoints)
      .toEqual([-20, 5, 12.5, 0, 6, 13, 20, 7, 13.5]);
    expect(failCode(solve(BASE_MEMBERS, trp({ width: 40.000001 })))).toBe('TRANSITION_REJECTED');
    expect(ok(solve(BASE_MEMBERS, trp({ width: 39.999999 }))).daylightPoints.length).toBeGreaterThan(0);
    // Asymmetric members: max is 2xmin, not the mean or total.
    const asym = [seg(-10, 0, 0, 0), seg(0, 0, 30, 0)];
    expect(ok(solve(asym, trp({ width: 20 }))).daylightPoints.length).toBeGreaterThan(0);
    expect(failCode(solve(asym, trp({ width: 20.5 })))).toBe('TRANSITION_REJECTED');
  });

  it('finite scalar extremes within the accepted domain stay finite; non-finite fails closed', () => {
    for (const d of [1e-6, 20, 40]) {
      const r = ok(solve(BASE_MEMBERS, trp(), {
        criterion: DIST(0.5, d), memberCriteria: [DIST(0.5, d), DIST(0.5, 2 * d)],
        maxSearchDistance: 200,
      }));
      expect(r.daylightPoints.every(Number.isFinite)).toBe(true);
      assertOriented(r.gradingMesh.points, r.gradingMesh.triangles);
    }
    // Beyond maxSearch the native member solve fails first — still bounded, never bridged.
    expect(failCode(solve(BASE_MEMBERS, trp(), {
      criterion: DIST(0.5, 1e6), memberCriteria: [DIST(0.5, 1e6), DIST(0.5, 2e6)],
    }))).toBe('MEMBER_NO_SOLUTION');
    for (const bad of [Number.NaN, Number.POSITIVE_INFINITY]) {
      expect(failCode(solve(BASE_MEMBERS, trp(), {
        criterion: DIST(0.5, 5), memberCriteria: [DIST(0.5, 5), DIST(0.5, bad)],
      }))).toBe('MEMBER_NO_SOLUTION');
    }
  });

  it('repeat solves are bit-identical (determinism)', () => {
    const outs = [0, 1, 2].map(() => JSON.stringify(ok(solve(BASE_MEMBERS, trp()))));
    expect(outs[0]).toBe(outs[1]);
    expect(outs[1]).toBe(outs[2]);
  });
});
