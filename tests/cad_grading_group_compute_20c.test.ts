/**
 * Phase 20C Wave-2A — group compute engine analytic oracles.
 *
 * Every geometric expectation is closed-form on synthetic flat (or
 * integer-noded single/ramp-plane) TINs built in-test; no sampling or
 * tolerance fitting. R1/R2 honesty: gates keep the strict 20B zeroDelta
 * floor — fractional-node corners fail closed and are reported, never
 * loosened. Oracle (e) is engineered so every sector node lands on integer
 * grid coordinates (kink at a grid vertex), which is why it passes honestly.
 */
import { describe, expect, it } from 'vitest';
import { computeGradingGroupFromSnapshots } from '../src/engine/cad/grading/gradingGroupCompute';
import { buildTargetQuery } from '../src/engine/cad/grading/gradingTargetIndex';
import { solveStraightChord } from '../src/engine/cad/grading/solveStraightChord';
import type { GradingTargetMeshSnapshot } from '../src/engine/cad/grading/gradingComputeTypes';
import type {
  CadGradingGroupResult,
  GroupDiagnosticCode,
} from '../src/engine/cad/grading/gradingGroupTypes';
import type { ResolvedGradingSource } from '../src/engine/cad/grading/gradingTypes';

const straight = (
  sx: number, sy: number, ex: number, ey: number, sz = 10, ez = 10,
): ResolvedGradingSource => ({
  startX: sx, startY: sy, endX: ex, endY: ey, startZ: sz, endZ: ez,
  length: Math.hypot(ex - sx, ey - sy), reoriented: false, isArc: false,
});

const gridTarget = (
  fn: (_x: number, _y: number) => number, xs: number[], ys: number[],
): GradingTargetMeshSnapshot => {
  const points: number[] = [];
  const idx = (ix: number, iy: number): number => iy * xs.length + ix;
  for (const y of ys) for (const x of xs) points.push(x, y, fn(x, y));
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

const range = (a: number, b: number, s: number): number[] => {
  const out: number[] = [];
  for (let v = a; v <= b + 1e-9; v += s) out.push(v);
  return out;
};

const flatTarget = (
  z: number, minX: number, minY: number, maxX: number, maxY: number, step = 20,
): GradingTargetMeshSnapshot =>
  gridTarget(() => z, range(minX, maxX, step), range(minY, maxY, step));

const expectOk = (
  out: ReturnType<typeof computeGradingGroupFromSnapshots>,
): CadGradingGroupResult => {
  if (!out.ok) throw new Error(`expected ok, got ${out.code} corner=${out.cornerIndex} ${out.detail}`);
  return out.result;
};

const expectFail = (
  out: ReturnType<typeof computeGradingGroupFromSnapshots>,
): { code: GroupDiagnosticCode; cornerIndex?: number } => {
  if (out.ok) throw new Error('expected failure, got ok');
  return out;
};

const digest = (r: CadGradingGroupResult): string =>
  [...r.gradingMesh.points, ...r.gradingMesh.triangles, ...r.daylightPoints].join(',');

describe('(a) square pad — closed 100x100, outside, -50%', () => {
  const members = [
    straight(0, 0, 100, 0),
    straight(100, 0, 100, 100),
    straight(100, 100, 0, 100),
    straight(0, 100, 0, 0),
  ];
  const solve = (): ReturnType<typeof computeGradingGroupFromSnapshots> =>
    computeGradingGroupFromSnapshots({
      groupId: 'pad', revision: 'ggrev1:test', members,
      side: 'right', criterion: { kind: 'fixed', gradeRatio: -0.5 },
      maxSearchDistance: 50, curveChordTolerance: 0.05, closed: true,
      target: flatTarget(0, -60, -60, 160, 160),
    });

  it('grades 20m offset, 140x140 daylight, plan area 9600', () => {
    const r = expectOk(solve());
    expect(r.memberCount).toBe(4);
    expect(r.cornerCount).toBe(4);
    expect(r.gradingPlanArea).toBeCloseTo(9600, 6);
    expect(r.grading3dArea).toBeCloseTo(9600 * Math.sqrt(1.25), 6);
    const xs = r.daylightPoints.filter((_, i) => i % 3 === 0);
    const ys = r.daylightPoints.filter((_, i) => i % 3 === 1);
    expect(Math.min(...xs)).toBeCloseTo(-20, 9);
    expect(Math.max(...xs)).toBeCloseTo(120, 9);
    expect(Math.min(...ys)).toBeCloseTo(-20, 9);
    expect(Math.max(...ys)).toBeCloseTo(120, 9);
  });

  it('resolves 4 GAP corners with 20√2 miter ties', () => {
    const r = expectOk(solve());
    expect(r.corners.map((c) => c.classification)).toEqual(['GAP', 'GAP', 'GAP', 'GAP']);
    const vxs = [100, 100, 0, 0];
    const vys = [0, 100, 100, 0];
    for (const c of r.corners) {
      expect(c.tiePointXyz).toBeDefined();
      const [tx, ty, tz] = c.tiePointXyz!;
      const dist = Math.hypot(tx - vxs[c.cornerIndex]!, ty - vys[c.cornerIndex]!);
      expect(dist).toBeCloseTo(20 * Math.SQRT2, 9);
      expect(tz).toBeCloseTo(0, 9);
      // Analytic search bound retained on the corner (audit §31 tMax).
      expect(c.miterExtent).toBeCloseTo(50 * Math.SQRT2, 9);
    }
  });
});

describe('(b) concave L — overlap trims to one manifold mesh', () => {
  it('clips doubled cover without doubled triangles', () => {
    const r = expectOk(computeGradingGroupFromSnapshots({
      groupId: 'ell', revision: 'ggrev1:test',
      members: [straight(0, 0, 100, 0), straight(100, 0, 100, 50)],
      side: 'left', criterion: { kind: 'fixed', gradeRatio: -0.5 },
      maxSearchDistance: 50, curveChordTolerance: 0.05, closed: false,
      target: flatTarget(0, -60, -60, 160, 160),
    }));
    expect(r.corners.map((c) => c.classification)).toEqual(['OVERLAP']);
    // Strips 2000 + 1000 minus the 20x20 doubly-covered square.
    expect(r.gradingPlanArea).toBeCloseTo(2600, 6);
    const faces = new Set<string>();
    for (let i = 0; i + 2 < r.gradingMesh.triangles.length; i += 3) {
      faces.add([r.gradingMesh.triangles[i], r.gradingMesh.triangles[i + 1], r.gradingMesh.triangles[i + 2]].join('|'));
    }
    expect(faces.size).toBe(r.gradingMesh.triangles.length / 3);
  });
});

describe('(c) collinear two-course — tangent merge, no patch', () => {
  it('merges continuously with unbroken daylight', () => {
    const r = expectOk(computeGradingGroupFromSnapshots({
      groupId: 'tan', revision: 'ggrev1:test',
      members: [straight(0, 0, 50, 0), straight(50, 0, 100, 0)],
      side: 'left', criterion: { kind: 'fixed', gradeRatio: -0.5 },
      maxSearchDistance: 50, curveChordTolerance: 0.05, closed: false,
      target: flatTarget(0, -60, -60, 160, 160),
    }));
    expect(r.corners).toHaveLength(1);
    expect(r.corners[0]!.classification).toBe('TANGENT');
    expect(r.corners[0]!.tiePointXyz).toBeUndefined();
    expect(r.gradingPlanArea).toBeCloseTo(2000, 9);
    const pts: Array<[number, number, number]> = [];
    for (let i = 0; i + 2 < r.daylightPoints.length; i += 3) {
      pts.push([r.daylightPoints[i]!, r.daylightPoints[i + 1]!, r.daylightPoints[i + 2]!]);
    }
    expect(pts[0]![0]).toBeCloseTo(0, 9);
    expect(pts[pts.length - 1]![0]).toBeCloseTo(100, 9);
    for (const p of pts) expect(p[1]).toBeCloseTo(20, 9);
    for (let i = 0; i + 1 < pts.length; i += 1) {
      expect(Math.hypot(pts[i + 1]![0] - pts[i]![0], pts[i + 1]![1] - pts[i]![1])).toBeLessThan(60);
    }
  });
});

describe('(d) sloped-target corner analytic tie', () => {
  // T = 0.25x + 0.25y - 2 with gs = 0.25 on both members keeps every locus
  // node on integer grid coordinates (d1 = 48, d2 = 16); the tie recomputes
  // below from the independent closed-form 1D root along the miter ray.
  it('ties where the miter ray meets the sloped target', () => {
    const r = expectOk(computeGradingGroupFromSnapshots({
      groupId: 'slope', revision: 'ggrev1:test',
      members: [straight(0, 0, 10, 0, 10, 12.5), straight(10, 0, 10, 10, 12.5, 15)],
      side: 'right', criterion: { kind: 'fixed', gradeRatio: -0.5 },
      maxSearchDistance: 50, curveChordTolerance: 0.05, closed: false,
      target: gridTarget((x, y) => 0.25 * x + 0.25 * y - 2, range(-10, 50, 10), range(-60, 20, 10)),
    }));
    expect(r.corners.map((c) => c.classification)).toEqual(['GAP']);
    const tie = r.corners[0]!.tiePointXyz!;
    // Independent closed form: ray (0.25,-0.75)/|..| from V=(10,0,12.5),
    // plane1 grad (0.25,0.5); (∇T - grad1)·R̂ · t = Zv - Tv.
    const n = Math.sqrt(0.25 * 0.25 + 0.75 * 0.75);
    const rx = 0.25 / n;
    const ry = -0.75 / n;
    const tStar = (12.5 - 0.5) / ((0 - 0) * rx + (0.25 - 0.5) * ry);
    expect(tie[0]).toBeCloseTo(10 + rx * tStar, 9);
    expect(tie[1]).toBeCloseTo(0 + ry * tStar, 9);
    expect(tie[0]).toBeCloseTo(26, 9);
    expect(tie[1]).toBeCloseTo(-48, 9);
    expect(tie[2]).toBeCloseTo(0.25 * tie[0] + 0.25 * tie[1] - 2, 9);
    // Strips 480 + 160 plus the 768 wedge patch.
    expect(r.gradingPlanArea).toBeCloseTo(1408, 6);
  });
});

describe('(e) multi-plane target corner kinks at the plane break', () => {
  // Flat Z=0 for x<110, ramp (x-110)/3 beyond (continuous at the break).
  // Member loci stay on integer lines (x=120 flat would miss — the ramp
  // pulls member2 to x=116); the sector-1 path kinks at grid vertex K.
  const target = (): GradingTargetMeshSnapshot =>
    gridTarget(
      (x, _y) => (x < 110 ? 0 : (x - 110) / 3),
      range(-60, 160, 10),
      range(-60, 160, 10),
    );
  it('bends the corner path at the break instead of running Q1→QM straight', () => {
    const r = expectOk(computeGradingGroupFromSnapshots({
      groupId: 'kink', revision: 'ggrev1:test',
      members: [straight(0, 0, 100, 0), straight(100, 0, 100, 100)],
      side: 'right', criterion: { kind: 'fixed', gradeRatio: -0.5 },
      maxSearchDistance: 50, curveChordTolerance: 0.05, closed: false,
      target: target(),
    }));
    expect(r.corners.map((c) => c.classification)).toEqual(['GAP']);
    const flat = r.corners[0]!.daylightPoints!;
    const pts: Array<[number, number]> = [];
    for (let i = 0; i + 2 < flat.length; i += 3) pts.push([flat[i]!, flat[i + 1]!]);
    // Kink grid vertex (110,-20) is on the corner daylight path.
    expect(pts.some(([x, y]) => Math.abs(x - 110) < 1e-9 && Math.abs(y + 20) < 1e-9)).toBe(true);
    // ...and the path deviates from the straight Q1→tie chord (no false
    // Q1→QM triangles: the middle vertex stands off the chord).
    const a = pts[0]!;
    const b = pts[pts.length - 1]!;
    const off = pts
      .slice(1, -1)
      .map(([x, y]) => Math.abs((b[0] - a[0]) * (a[1] - y) - (a[0] - x) * (b[1] - a[1])) / Math.hypot(b[0] - a[0], b[1] - a[1]));
    expect(Math.max(...off)).toBeGreaterThan(1);
  });
});

describe('(f) void in corner sector', () => {
  it('fails closed with CORNER_TARGET_GAP', () => {
    const full = flatTarget(0, -60, -60, 160, 160);
    // Punch a void over the corner-0 wedge (tie (120,-20) sits inside).
    const triangles: number[] = [];
    for (let i = 0; i + 2 < full.triangles.length; i += 3) {
      const cx = (full.points[full.triangles[i]! * 3]! + full.points[full.triangles[i + 1]! * 3]! + full.points[full.triangles[i + 2]! * 3]!) / 3;
      const cy = (full.points[full.triangles[i]! * 3 + 1]! + full.points[full.triangles[i + 1]! * 3 + 1]! + full.points[full.triangles[i + 2]! * 3 + 1]!) / 3;
      if (cx >= 105 && cx <= 135 && cy >= -35 && cy <= -5) continue;
      triangles.push(full.triangles[i]!, full.triangles[i + 1]!, full.triangles[i + 2]!);
    }
    const out = computeGradingGroupFromSnapshots({
      groupId: 'void', revision: 'ggrev1:test',
      members: [straight(0, 0, 100, 0), straight(100, 0, 100, 100)],
      side: 'right', criterion: { kind: 'fixed', gradeRatio: -0.5 },
      maxSearchDistance: 50, curveChordTolerance: 0.05, closed: false,
      target: { points: full.points, triangles },
    });
    const failed = expectFail(out);
    expect(failed.code).toBe('CORNER_TARGET_GAP');
    expect(failed.cornerIndex).toBe(0);
  });
});

describe('(g) member-equivalence far from corners', () => {
  it('reproduces standalone chord daylight outside corner neighborhoods', () => {
    const target = flatTarget(0, -60, -60, 160, 160);
    const members = [straight(0, 0, 100, 0), straight(100, 0, 100, 100)];
    const r = expectOk(computeGradingGroupFromSnapshots({
      groupId: 'equiv', revision: 'ggrev1:test', members,
      side: 'right', criterion: { kind: 'fixed', gradeRatio: -0.5 },
      maxSearchDistance: 50, curveChordTolerance: 0.05, closed: false,
      target,
    }));
    const query = buildTargetQuery(target)!;
    const solo = solveStraightChord({
      source: { ...members[0]! }, side: 'right',
      criterion: { kind: 'fixed', gradeRatio: -0.5 },
      maxSearchDistance: 50, target, query, stationBase: 0, stationScale: 1,
    });
    if (!solo.ok) throw new Error(`standalone failed: ${solo.code}`);
    const mid = solo.solve.daylightPts.filter((_, i) => i === 1 || i === 4 || i === 7);
    void mid;
    for (const p of solo.solve.daylightPts) {
      if (p.x > 30 && p.x < 70) {
        const hit = r.daylightPoints.some(
          (_, i) =>
            i % 3 === 0 &&
            Math.abs(r.daylightPoints[i]! - p.x) < 1e-12 &&
            Math.abs(r.daylightPoints[i + 1]! - p.y) < 1e-12 &&
            Math.abs(r.daylightPoints[i + 2]! - p.z) < 1e-12,
        );
        expect(hit).toBe(true);
      }
    }
  });
});

describe('(h) daylight topology', () => {
  const crossings = (flat: number[]): number => {
    const pts: Array<[number, number]> = [];
    for (let i = 0; i + 2 < flat.length; i += 3) pts.push([flat[i]!, flat[i + 1]!]);
    const orient = (a: [number, number], b: [number, number], c: [number, number]): number =>
      (b[0] - a[0]) * (c[1] - a[1]) - (b[1] - a[1]) * (c[0] - a[0]);
    let count = 0;
    for (let i = 0; i < pts.length; i += 1) {
      for (let j = i + 1; j < pts.length; j += 1) {
        if (j === i + 1 || (i === 0 && j === pts.length - 1)) continue;
        const a = pts[i]!;
        const b = pts[(i + 1) % pts.length]!;
        const c = pts[j]!;
        const d = pts[(j + 1) % pts.length]!;
        if (orient(a, b, c) * orient(a, b, d) < 0 && orient(c, d, a) * orient(c, d, b) < 0) count += 1;
      }
    }
    return count;
  };

  it('closes the square pad with a simple ring', () => {
    const r = expectOk(computeGradingGroupFromSnapshots({
      groupId: 'ring', revision: 'ggrev1:test',
      members: [straight(0, 0, 100, 0), straight(100, 0, 100, 100), straight(100, 100, 0, 100), straight(0, 100, 0, 0)],
      side: 'right', criterion: { kind: 'fixed', gradeRatio: -0.5 },
      maxSearchDistance: 50, curveChordTolerance: 0.05, closed: true,
      target: flatTarget(0, -60, -60, 160, 160),
    }));
    expect(crossings(r.daylightPoints)).toBe(0);
  });

  it('fails a self-intersecting side closed instead of baking a bow-tie', () => {
    const out = computeGradingGroupFromSnapshots({
      groupId: 'bowtie', revision: 'ggrev1:test',
      members: [
        straight(0, 0, 100, 0), straight(100, 0, 100, 100), straight(100, 100, 55, 100),
        straight(55, 100, 55, 20), straight(55, 20, 45, 20), straight(45, 20, 45, 100),
        straight(45, 100, 0, 100), straight(0, 100, 0, 0),
      ],
      side: 'left', criterion: { kind: 'fixed', gradeRatio: -0.5 },
      maxSearchDistance: 50, curveChordTolerance: 0.05, closed: true,
      target: flatTarget(0, -120, -120, 160, 160, 10),
    });
    const failed = expectFail(out);
    expect(failed.code).toBe('GROUP_SELF_INTERSECTION');
  });
});

describe('determinism — canonical order, stable digest', () => {
  it('rebuilds member-identical input to the same digest', () => {
    const target = flatTarget(0, -60, -60, 160, 160);
    const build = (): ReturnType<typeof computeGradingGroupFromSnapshots> =>
      computeGradingGroupFromSnapshots({
        groupId: 'pad', revision: 'ggrev1:test',
        members: [
          straight(0, 0, 100, 0), straight(100, 0, 100, 100),
          straight(100, 100, 0, 100), straight(0, 100, 0, 0),
        ],
        side: 'right', criterion: { kind: 'fixed', gradeRatio: -0.5 },
        maxSearchDistance: 50, curveChordTolerance: 0.05, closed: true,
        target: { points: [...target.points], triangles: [...target.triangles] },
      });
    expect(digest(expectOk(build()))).toBe(digest(expectOk(build())));
  });
});

describe('zero-width — already-tied member carries no area', () => {
  it('stays continuous with an empty mesh', () => {
    const r = expectOk(computeGradingGroupFromSnapshots({
      groupId: 'tied', revision: 'ggrev1:test',
      members: [straight(0, 0, 100, 0, 0, 0)],
      side: 'right', criterion: { kind: 'fixed', gradeRatio: -0.5 },
      maxSearchDistance: 50, curveChordTolerance: 0.05, closed: false,
      target: flatTarget(0, -60, -60, 160, 160),
    }));
    expect(r.gradingPlanArea).toBe(0);
    expect(r.gradingMesh.triangles).toHaveLength(0);
    expect(r.daylightPoints.length).toBeGreaterThan(0);
  });
});
