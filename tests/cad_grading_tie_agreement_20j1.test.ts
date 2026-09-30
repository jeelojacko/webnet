/**
 * Phase 20J1 — tie-tolerance audit contracts.
 *
 * Locks the quantity-specific agreement contracts that replaced the generic
 * `zeroDelta(a,b)·max(1,|x|,|y|)` double scale: X/Y coordinate, seam-param,
 * and anchored-elevation bounds, plus the anchored target-plane root form.
 * Covers local + projected classification invariance, rotated/alternate/
 * jittered twins, mismatch ladders with a hard 0.1 mm fail-closed floor,
 * root policy, and legacy Surface / hybrid oracle non-regression.
 */
import { createHash } from 'node:crypto';
import { describe, expect, it } from 'vitest';

import { computeGradingGroupFromSnapshots } from '../src/engine/cad/grading/gradingGroupCompute';
import {
  coordinateAgreementTol,
  elevationAgreementTol,
  seamParameterAgreementTol,
  solveMiterTie,
} from '../src/engine/cad/grading/gradingGroupSectors';
import type { CornerGradingPlane } from '../src/engine/cad/grading/gradingCornerMath';
import { buildTargetQuery } from '../src/engine/cad/grading/gradingTargetIndex';
import { zeroDelta } from '../src/engine/cad/surfaces/volume/zero';
import type { GradingTargetMeshSnapshot } from '../src/engine/cad/grading/gradingComputeTypes';
import type { CadGradingGroupResult } from '../src/engine/cad/grading/gradingGroupTypes';
import type { GradingCriterion, ResolvedGradingSource } from '../src/engine/cad/grading/gradingTypes';

const FIXED = (g: number): GradingCriterion => ({ kind: 'fixed', gradeRatio: g });
const CUTFILL = (c: number, f: number): GradingCriterion =>
  ({ kind: 'cut-fill', cutGradeRatio: c, fillGradeRatio: f });
const DIST = (g: number, d: number): GradingCriterion => ({ kind: 'distance', gradeRatio: g, distance: d });
const ELEV = (g: number, e: number): GradingCriterion => ({ kind: 'elevation', gradeRatio: g, targetElevation: e });
const REL = (g: number, dz: number): GradingCriterion =>
  ({ kind: 'relative-elevation', gradeRatio: g, relativeElevation: dz });

const M = (sx: number, sy: number, sz: number, ex: number, ey: number, ez: number): ResolvedGradingSource => ({
  startX: sx, startY: sy, endX: ex, endY: ey, startZ: sz, endZ: ez,
  length: Math.hypot(ex - sx, ey - sy), reoriented: false, isArc: false,
});

/** Spun-quad flat TIN (10° production-like spin), same builder as the 20I/20J oracles. */
const flatTin = (z: number, half = 200, deg = 10): GradingTargetMeshSnapshot => {
  const a = (deg * Math.PI) / 180;
  const c = Math.cos(a);
  const s = Math.sin(a);
  const pts: Array<[number, number]> = [[-half, -half], [half, -half], [half, half], [-half, half]];
  return {
    points: pts.flatMap(([x, y]) => [x * c - y * s, x * s + y * c, z]),
    triangles: [0, 1, 2, 0, 2, 3],
  };
};

const SIN = M(-60, 0, 100, 0, 0, 100);
const AOUT = M(0, 0, 100, 0, 60, 100);
const AIN = M(0, -60, 100, 0, 0, 100);
const SOUT = M(0, 0, 100, -60, 0, 100);

interface PrimaryOpts {
  surfaceCriterion?: GradingCriterion;
  analyticCriterion?: GradingCriterion;
  target?: GradingTargetMeshSnapshot;
  reverse?: boolean;
  maxSearchDistance?: number;
  dx?: number;
  dy?: number;
}

const solvePrimary = (opts: PrimaryOpts = {}): ReturnType<typeof computeGradingGroupFromSnapshots> => {
  const dx = opts.dx ?? 0;
  const dy = opts.dy ?? 0;
  const shift = (m: ResolvedGradingSource): ResolvedGradingSource => ({
    ...m, startX: m.startX + dx, endX: m.endX + dx, startY: m.startY + dy, endY: m.endY + dy,
  });
  const shiftedTarget = (t: GradingTargetMeshSnapshot): GradingTargetMeshSnapshot => ({
    points: t.points.map((v, i) => (i % 3 === 2 ? v : v + (i % 3 === 0 ? dx : dy))),
    triangles: [...t.triangles],
  });
  const members = (opts.reverse ? [AIN, SOUT] : [SIN, AOUT]).map(shift);
  const target = shiftedTarget(opts.target ?? flatTin(90));
  return computeGradingGroupFromSnapshots({
    groupId: 'h20j1', revision: 'r', members,
    side: 'right',
    criterion: opts.surfaceCriterion ?? FIXED(-0.5),
    memberCriteria: [
      opts.reverse ? (opts.analyticCriterion ?? REL(-0.25, -10)) : (opts.surfaceCriterion ?? FIXED(-0.5)),
      opts.reverse ? (opts.surfaceCriterion ?? FIXED(-0.5)) : (opts.analyticCriterion ?? REL(-0.25, -10)),
    ],
    maxSearchDistance: opts.maxSearchDistance ?? 100,
    curveChordTolerance: 0.01, closed: false,
    target,
  });
};

const expectOk = (out: ReturnType<typeof computeGradingGroupFromSnapshots>): CadGradingGroupResult => {
  if (!out.ok) throw new Error(`expected ok, got ${out.code} corner=${out.cornerIndex} ${out.detail}`);
  return out.result;
};

const expectFail = (
  out: ReturnType<typeof computeGradingGroupFromSnapshots>,
): { code: string; cornerIndex?: number; detail?: string } => {
  if (out.ok) throw new Error('expected failure, got ok');
  return out;
};

const digest = (r: CadGradingGroupResult): string =>
  createHash('sha256')
    .update([...r.gradingMesh.points, ...r.gradingMesh.triangles, ...r.daylightPoints].join(','))
    .digest('hex')
    .slice(0, 16);

/** Closed 100x100 square with a flat grid cover (production-like target). */
const SQM = [
  M(0, 0, 10, 100, 0, 10), M(100, 0, 10, 100, 100, 10),
  M(100, 100, 10, 0, 100, 10), M(0, 100, 10, 0, 0, 10),
];
const SQHYB: GradingCriterion[] = [FIXED(-0.5), DIST(-0.5, 20), ELEV(-0.5, 0), REL(-0.5, -10)];

const flatCover = (members: ResolvedGradingSource[], z: number, margin = 60): GradingTargetMeshSnapshot => {
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  for (const m of members) {
    minX = Math.min(minX, m.startX, m.endX);
    minY = Math.min(minY, m.startY, m.endY);
    maxX = Math.max(maxX, m.startX, m.endX);
    maxY = Math.max(maxY, m.startY, m.endY);
  }
  const span = Math.max(maxX - minX, maxY - minY, 1);
  const step = Math.max(20, span / 100);
  const xs: number[] = [];
  for (let x = minX - margin; x <= maxX + margin + 1e-9; x += step) xs.push(x);
  if (xs[xs.length - 1]! < maxX + margin) xs.push(maxX + margin);
  const ys: number[] = [];
  for (let y = minY - margin; y <= maxY + margin + 1e-9; y += step) ys.push(y);
  if (ys[ys.length - 1]! < maxY + margin) ys.push(maxY + margin);
  const points: number[] = [];
  const idx = (ix: number, iy: number): number => iy * xs.length + ix;
  for (const y of ys) for (const x of xs) points.push(x, y, z);
  const triangles: number[] = [];
  for (let ix = 0; ix + 1 < xs.length; ix += 1) {
    for (let iy = 0; iy + 1 < ys.length; iy += 1) {
      const a = idx(ix, iy);
      const b = idx(ix + 1, iy);
      const c = idx(ix + 1, iy + 1);
      const d = idx(ix, iy + 1);
      triangles.push(a, b, c, a, c, d);
    }
  }
  return { points, triangles };
};

const rotateSource = (m: ResolvedGradingSource, deg: number, cx = 50, cy = 50): ResolvedGradingSource => {
  const a = (deg * Math.PI) / 180;
  const c = Math.cos(a);
  const s = Math.sin(a);
  const r = (x: number, y: number): [number, number] => [cx + (x - cx) * c - (y - cy) * s, cy + (x - cx) * s + (y - cy) * c];
  const [sx, sy] = r(m.startX, m.startY);
  const [ex, ey] = r(m.endX, m.endY);
  return { ...m, startX: sx, startY: sy, endX: ex, endY: ey, length: Math.hypot(ex - sx, ey - sy) };
};

const solveSquareHybrid = (
  members: ResolvedGradingSource[],
  criteria: GradingCriterion[] = SQHYB,
  closed = true,
): ReturnType<typeof computeGradingGroupFromSnapshots> =>
  computeGradingGroupFromSnapshots({
    groupId: 'g20j1sq', revision: 'r', members, side: 'right',
    criterion: criteria[0]!, memberCriteria: criteria,
    maxSearchDistance: 100, curveChordTolerance: 0.01, closed, target: flatCover(members, 0),
  });

const OFFSETS: ReadonlyArray<readonly [number, number]> = [
  [0, 0], [500000, 5000000], [2000000, 7000000], [20000000, 70000000], [100000000, 300000000],
];

// ---------------------------------------------------------------------------
// 1. Contracts
// ---------------------------------------------------------------------------
describe('20j1 agreement contracts', () => {
  it('X/Y is single-scale: bounded by 0.1mm at projected, not |x|·|y|', () => {
    const local = coordinateAgreementTol(1, 2, 2);
    const projected = coordinateAgreementTol(2_000_040, 6_999_980, 6_999_980);
    expect(projected).toBeLessThan(1e-4);
    expect(projected).toBeGreaterThan(local);
    // The removed generic form multiplied two world magnitudes:
    const oldGeneric = zeroDelta(2_000_040, 2_000_040) * Math.max(1, 2_000_040, 6_999_980);
    expect(oldGeneric).toBeGreaterThan(1e-4);
  });

  it('seam-t stays local (no easting·northing term), only the coordinate quantum grows', () => {
    const local = seamParameterAgreementTol(28.284271247461902, 28.284271247461902, 28.28, 1);
    const projected = seamParameterAgreementTol(28.284271247461902, 28.284271247461902, 28.28, 7_000_000);
    expect(local).toBeLessThan(1e-12);
    expect(projected).toBeLessThan(1e-4);
    expect(projected / local).toBeLessThan(1e8);
  });

  it('elevation carries single-axis gradient leverage, not a world product', () => {
    const localTerms = [0.5 * 145, 0.25 * 24];
    const projectedTerms = [0.5 * 2_000_040, 0.25 * 6_999_980];
    const local = elevationAgreementTol(0, 0, localTerms);
    const projected = elevationAgreementTol(0, 0, projectedTerms);
    expect(local).toBeLessThan(projected);
    expect(projected).toBeLessThan(1e-4);
  });
});

// ---------------------------------------------------------------------------
// 2. Primary hybrid oracle + projection invariance
// ---------------------------------------------------------------------------
describe('20j1 primary hybrid oracle (pins preserved)', () => {
  it('exact tie (40,-20,90), √2000 extent, plan 4400, 3D gap 859.5241580617239', () => {
    const r = expectOk(solvePrimary());
    const corner = r.corners[0]!;
    expect(corner.classification).toBe('GAP');
    expect(corner.tiePointXyz).toEqual([40, -20, 90]);
    expect(corner.miterExtent).toBeCloseTo(Math.sqrt(2000), 12);
    expect(r.gradingPlanArea).toBeCloseTo(4400, 9);
    expect(r.gradingPlanArea - 3600).toBeCloseTo(800, 9);
    const strips3d = 60 * Math.hypot(20, 10) + 60 * Math.hypot(40, 10);
    expect(r.grading3dArea - strips3d).toBeCloseTo(859.5241580617239, 9);
  });

  it.each([
    ['distance', DIST(-0.25, 40)],
    ['elevation', ELEV(-0.25, 90)],
    ['relative', REL(-0.25, -10)],
  ])('%s terminates at the same tie', (_name, criterion) => {
    const r = expectOk(solvePrimary({ analyticCriterion: criterion }));
    expect(r.corners[0]!.tiePointXyz).toEqual([40, -20, 90]);
  });

  it.each(OFFSETS)('projected offset %d/%d: axis tie translates exactly (≤1e-6)', (dx, dy) => {
    const r = expectOk(solvePrimary({ dx, dy }));
    const tie = r.corners[0]!.tiePointXyz!;
    expect(Math.abs(tie[0] - (40 + dx))).toBeLessThanOrEqual(1e-6);
    expect(Math.abs(tie[1] - (-20 + dy))).toBeLessThanOrEqual(1e-6);
    expect(Math.abs(tie[2] - 90)).toBeLessThanOrEqual(1e-6);
  });

  it('deterministic: repeated runs give byte-identical digests', () => {
    for (const [dx, dy] of OFFSETS) {
      const a = expectOk(solvePrimary({ dx, dy }));
      const b = expectOk(solvePrimary({ dx, dy }));
      expect(digest(b)).toBe(digest(a));
    }
  });
});

// ---------------------------------------------------------------------------
// 3. Rotated / alternate / jittered twins (local + projected)
// ---------------------------------------------------------------------------
describe('20j1 rotated + alternate + jittered twins', () => {
  for (const [dx, dy] of OFFSETS.filter((_, i) => i % 2 === 0)) {
    for (const deg of [10, 30]) {
      it(`closed hybrid square rotated ${deg}° at ${dx}/${dy} solves 4 corners`, () => {
        const members = SQM.map((m) => rotateSource(m, deg));
        const out = solveSquareHybrid(members.map((m) => ({
          ...m, startX: m.startX + dx, endX: m.endX + dx, startY: m.startY + dy, endY: m.endY + dy,
        })));
        const r = expectOk(out);
        expect(r.corners).toHaveLength(4);
      });
    }
  }

  it('jittered triangulation passes (no exact-vertex grazing dependence)', () => {
    const j = 0.013;
    const jittered: GradingTargetMeshSnapshot = {
      points: [
        -50 + j, -50 - j, 90, 50 - j, -50 + j, 90, 50 + j, 50 - j, 90, -50 - j, 50 + j, 90,
        0 + j, -50 + j, 90, 0 - j, 50 - j, 90,
      ],
      triangles: [0, 1, 4, 1, 2, 4, 2, 3, 4, 3, 0, 4, 0, 4, 5, 4, 2, 5, 2, 3, 5, 3, 0, 5],
    };
    const out = tie(jittered, plane(0, 0, 100, 0, 0.5), 0, 0, 0, -1, 100);
    if (!out.ok) throw new Error(`jittered tie failed: ${out.code}`);
    expect(out.y).toBeCloseTo(-20, 6);
    expect(out.z).toBeCloseTo(90, 6);
  });
});

// ---------------------------------------------------------------------------
// 4. Mismatch ladders — hard 0.1mm/1mm/10mm fail-closed
// ---------------------------------------------------------------------------
const ULP90 = Number.EPSILON * 90;

describe('20j1 mismatch ladders', () => {
  it.each([
    ['1ulp', ULP90],
    ['1e-9', 1e-9],
    ['1e-8', 1e-8],
    ['1e-7', 1e-7],
    ['1e-6', 1e-6],
    ['1e-5', 1e-5],
    ['1e-4 (0.1mm)', 1e-4],
    ['1e-3 (1mm)', 1e-3],
    ['1e-2 (10mm)', 1e-2],
  ])('target elevation +%s', (_label, delta) => {
    const out = solvePrimary({ target: flatTin(90 + delta) });
    if (delta <= ULP90) expect(out.ok).toBe(true);
    else expect(out.ok).toBe(false);
  });

  it.each([1e-9, 1e-6, 1e-4, 1e-3, 1e-2])('analytic Distance +%s m', (delta) => {
    expect(solvePrimary({ analyticCriterion: DIST(-0.25, 40 + delta) }).ok).toBe(false);
  });

  it.each([1e-9, 1e-6, 1e-4, 1e-3, 1e-2])('analytic RelElev +%s m', (delta) => {
    expect(solvePrimary({ analyticCriterion: REL(-0.25, -10 + delta) }).ok).toBe(false);
  });

  it.each([1e-9, 1e-6, 1e-4, 1e-3, 1e-2])('source grade +%s breaks the common tie', (delta) => {
    expect(solvePrimary({
      surfaceCriterion: FIXED(-0.5),
      analyticCriterion: DIST(-0.25 + delta, 40),
    }).ok).toBe(false);
  });

  it('hard 0.1mm floor holds at projected coordinates (axis + rotated)', () => {
    for (const [dx, dy] of OFFSETS) {
      // 0.1 mm mismatch must fail closed...
      const bad = solvePrimary({ target: flatTin(90.0001), dx, dy });
      expect(bad.ok).toBe(false);
      // ...while the exact tie still solves and translates.
      const good = expectOk(solvePrimary({ dx, dy }));
      expect(Math.abs(good.corners[0]!.tiePointXyz![2] - 90)).toBeLessThanOrEqual(1e-6);
    }
  });

  it('no root switching / wall / bridge / average / snap on failure', () => {
    const failed = expectFail(solvePrimary({ target: flatTin(92) }));
    expect(failed.detail).toBe('GRADING_SURFACE_ANALYTIC_TRANSITION_REQUIRED');
    // Exact failure carries no mesh geometry (no fallback bridge).
    expect(failed).not.toHaveProperty('result');
  });

  it('exact success keeps the common tie (no averaging/snapping)', () => {
    const r = expectOk(solvePrimary());
    expect(r.corners[0]!.tiePointXyz).toEqual([40, -20, 90]);
    expect(r.corners[0]!.daylightPoints).toEqual([0, -20, 90, 40, -20, 90, 40, 0, 90]);
  });

  it('shallow-grade elevation limit stays fail-closed or exact (no bridge)', () => {
    const out = solvePrimary({ surfaceCriterion: FIXED(-1e-6), target: flatTin(100) });
    if (out.ok) {
      expect(out.result.corners[0]!.tiePointXyz![2]).toBeCloseTo(100, 6);
    } else {
      expect(out.detail).toMatch(/GRADING_SURFACE_ANALYTIC_/);
    }
  });
});

// ---------------------------------------------------------------------------
// 5. Roots + root policy
// ---------------------------------------------------------------------------
const plane = (ax: number, ay: number, zAtV: number, gx: number, gy: number): CornerGradingPlane =>
  ({ ax, ay, zAtV, gx, gy });

const allCandidates = (snap: GradingTargetMeshSnapshot): number[] =>
  Array.from({ length: snap.triangles.length / 3 }, (_, i) => i);

const tie = (
  snap: GradingTargetMeshSnapshot,
  p: CornerGradingPlane,
  ox: number, oy: number, dx: number, dy: number, tMax: number,
): ReturnType<typeof solveMiterTie> => {
  const q = buildTargetQuery(snap);
  if (!q) throw new Error('bad target');
  return solveMiterTie(snap, allCandidates(snap), q, p, ox, oy, dx, dy, tMax);
};

describe('20j1 roots + policy', () => {
  const axis = {
    points: [-50, -50, 90, 50, -50, 90, 50, 50, 90, -50, 50, 90],
    triangles: [0, 1, 2, 0, 2, 3],
  };
  it('one root: nearest outward root returned', () => {
    const out = tie(axis, plane(0, 0, 100, 0, 0.5), 0, 0, 0, -1, 100);
    if (!out.ok) throw new Error('expected root');
    expect(out.rootCount).toBe(1);
    expect(out.z).toBeCloseTo(90, 9);
  });
  it('multi-root stepped target reports both roots, keeps the nearest', () => {
    const snap: GradingTargetMeshSnapshot = {
      points: [0, -5, 95, 10, -5, 95, 10, 5, 95, 0, 5, 95, 10, -5, 85, 20, -5, 85, 20, 5, 85, 10, 5, 85],
      triangles: [0, 1, 2, 0, 2, 3, 4, 5, 6, 4, 6, 7],
    };
    const out = tie(snap, plane(0, 0, 100, -1, 0), 0, 0, 1, 0, 30);
    if (!out.ok) throw new Error('expected root');
    expect(out.rootCount).toBe(2);
    expect(out.x).toBeCloseTo(5, 9);
  });
  it('no root fails closed (CORNER_NO_SOLUTION)', () => {
    const out = tie(axis, plane(0, 0, 100, 0, 0), 0, 0, 0, -1, 40);
    expect(out).toEqual({ ok: false, code: 'CORNER_NO_SOLUTION' });
  });
  it('void target fails closed (CORNER_TARGET_GAP)', () => {
    const small: GradingTargetMeshSnapshot = {
      points: [0, 0, 90, 10, 0, 90, 10, 10, 90, 0, 10, 90],
      triangles: [0, 1, 2, 0, 2, 3],
    };
    const out = tie(small, plane(5, 5, 100, -0.5, 0), 5, 5, 1, 0, 1000);
    expect(out).toEqual({ ok: false, code: 'CORNER_TARGET_GAP' });
  });
  it('later-root analytic match is ROOT_POLICY (nearest kept, never re-picked)', () => {
    const patchTin: GradingTargetMeshSnapshot = {
      points: [
        -70, -30, 90, 10, -30, 90, 10, 10, 90,
        -70, -30, 90, 10, 10, 90, -70, 10, 90,
        11, -5.5, 97.25, 13, -8, 96, 15, -5.5, 97.25,
        16, -12, 94, 24, -12, 94, 20, -7, 96.5,
        38, -23, 88.5, 46, -19, 90.5, 36, -19, 90.5,
      ],
      triangles: [0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14],
    };
    const failed = expectFail(solvePrimary({ target: patchTin }));
    expect(failed.detail).toBe('GRADING_SURFACE_ANALYTIC_ROOT_POLICY');
  });
});

// ---------------------------------------------------------------------------
// 6. Legacy Surface non-regression
// ---------------------------------------------------------------------------
describe('20j1 legacy Surface non-regression', () => {
  const square = (): GradingTargetMeshSnapshot => ({
    points: [-50, -50, 90, 50, -50, 90, 50, 50, 90, -50, 50, 90],
    triangles: [0, 1, 2, 0, 2, 3],
  });

  it('axis Fixed tie (0,-20,90) and due-east tie (20,0,90) unchanged', () => {
    const south = tie(square(), plane(0, 0, 100, 0, 0.5), 0, 0, 0, -1, 100);
    const east = tie(square(), plane(0, 0, 100, -0.5, 0), 0, 0, 1, 0, 100);
    if (!south.ok || !east.ok) throw new Error('expected ties');
    expect([south.x, south.y, south.z]).toEqual([0, -20, 90]);
    expect([east.x, east.y, east.z]).toEqual([20, 0, 90]);
  });

  it('edge-grazing and vertex-crossing rays keep their ties', () => {
    const box: GradingTargetMeshSnapshot = {
      points: [0, 0, 90, 10, 0, 90, 10, 10, 90, 0, 10, 90],
      triangles: [0, 1, 2, 0, 2, 3],
    };
    const edge = tie(box, plane(0, -50, 95, 0, -0.1), 0, -50, 0, 1, 200);
    if (!edge.ok) throw new Error(`edge graze failed: ${edge.code}`);
    expect(edge.x).toBeCloseTo(0, 9);
    const d = Math.SQRT1_2;
    const vertex = tie(box, plane(-10, -10, 100, -0.5 * d, -0.5 * d), -10, -10, d, d, 100);
    if (!vertex.ok) throw new Error(`vertex ray failed: ${vertex.code}`);
    expect(vertex.x).toBeCloseTo(4.14213562, 6);
  });

  it('alternate diagonal + rotated target match the axis tie', () => {
    const alt: GradingTargetMeshSnapshot = {
      points: [-50, -50, 90, 50, -50, 90, 50, 50, 90, -50, 50, 90],
      triangles: [0, 1, 3, 1, 2, 3],
    };
    const rot = flatTin(90, 50, 10);
    const ref = tie(square(), plane(0, 0, 100, 0, 0.5), 0, 0, 0, -1, 100);
    for (const snap of [alt, rot]) {
      const out = tie(snap, plane(0, 0, 100, 0, 0.5), 0, 0, 0, -1, 100);
      if (!out.ok || !ref.ok) throw new Error('expected ties');
      expect(out.x).toBeCloseTo(ref.x, 6);
      expect(out.y).toBeCloseTo(ref.y, 6);
      expect(out.z).toBeCloseTo(ref.z, 6);
    }
  });

  it('large-coordinate surface tie is preserved', () => {
    const big: GradingTargetMeshSnapshot = {
      points: [-50 + 1e6, -50 + 1e6, 90, 50 + 1e6, -50 + 1e6, 90, 50 + 1e6, 50 + 1e6, 90, -50 + 1e6, 50 + 1e6, 90],
      triangles: [0, 1, 2, 0, 2, 3],
    };
    const out = tie(big, plane(1e6, 1e6, 100, 0, 0.5), 1e6, 1e6, 0, -1, 100);
    if (!out.ok) throw new Error(`large-coord surface tie failed: ${out.code}`);
    expect(out.x).toBeCloseTo(1e6, 3);
    expect(out.y).toBeCloseTo(1e6 - 20, 3);
    expect(out.z).toBeCloseTo(90, 6);
  });

  it('surface-only closed square digest + Cut/Fill digest are stable across repeats', () => {
    const target = flatCover(SQM, 8);
    const fixed = expectOk(computeGradingGroupFromSnapshots({
      groupId: 'legacy', revision: 'r', members: SQM, side: 'right', criterion: FIXED(-0.5),
      memberCriteria: SQM.map(() => FIXED(-0.5)), maxSearchDistance: 100,
      curveChordTolerance: 0.01, closed: true, target,
    }));
    const cutfill = expectOk(computeGradingGroupFromSnapshots({
      groupId: 'legacy', revision: 'r', members: SQM, side: 'right', criterion: CUTFILL(0.5, -0.5),
      memberCriteria: SQM.map(() => CUTFILL(0.5, -0.5)), maxSearchDistance: 100,
      curveChordTolerance: 0.01, closed: true, target,
    }));
    expect(digest(fixed)).toBe('cf7db4bbe9ba2995');
    expect(fixed.corners).toHaveLength(4);
    // Repeats are byte-identical (deterministic ordering).
    const again = expectOk(computeGradingGroupFromSnapshots({
      groupId: 'legacy', revision: 'r', members: SQM, side: 'right', criterion: CUTFILL(0.5, -0.5),
      memberCriteria: SQM.map(() => CUTFILL(0.5, -0.5)), maxSearchDistance: 100,
      curveChordTolerance: 0.01, closed: true, target,
    }));
    expect(digest(again)).toBe(digest(cutfill));
  });

  it('hybrid closed-square digest equals the surface/analytic controls (digest equivalence)', () => {
    const hyb = expectOk(solveSquareHybrid(SQM));
    const surf = expectOk(solveSquareHybrid(SQM, SQM.map(() => FIXED(-0.5))));
    const ana = expectOk(solveSquareHybrid(SQM, SQM.map(() => DIST(-0.5, 20))));
    expect(digest(surf)).toBe(digest(hyb));
    expect(digest(ana)).toBe(digest(hyb));
    expect(digest(expectOk(solveSquareHybrid(SQM)))).toBe(digest(hyb));
  });
});
