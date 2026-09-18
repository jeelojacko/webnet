import { describe, expect, test } from 'vitest';
import { computeContourLevels } from '../src/engine/cad/surfaceContours/contourLevels';
import { extractSurfaceContours } from '../src/engine/cad/surfaceContours/extractContours';
import { SURFACE_CONTOUR_LEVEL_LIMIT } from '../src/engine/cad/surfaceContours/contourTypes';
import type { ComputedLevel } from '../src/engine/cad/surfaceContours/contourTypes';
import type { ContourVertex } from '../src/engine/cad/surfaceContours/plateau';

interface TestPoint extends ContourVertex {
  entityId: string;
}

const pt = (x: number, y: number, z: number, id: string): TestPoint => ({ entityId: id, x, y, z });

const run = (
  points: TestPoint[],
  triangles: Array<[number, number, number]>,
  levels: ComputedLevel[],
) =>
  extractSurfaceContours({
    surfaceId: 's',
    surfaceRevision: 'r1',
    styleRevision: 'st1',
    points,
    triangles,
    levels,
  });

/** Row-major grid mesh, two CCW triangles per cell. */
const buildGrid = (
  nx: number,
  ny: number,
  fn: (_x: number, _y: number) => number,
  dx = 10,
  dy = 10,
): { points: TestPoint[]; triangles: Array<[number, number, number]> } => {
  const points: TestPoint[] = [];
  for (let j = 0; j <= ny; j += 1) {
    for (let i = 0; i <= nx; i += 1) {
      const x = i * dx;
      const y = j * dy;
      points.push(pt(x, y, fn(x, y), `p:${i}:${j}`));
    }
  }
  const at = (i: number, j: number): number => j * (nx + 1) + i;
  const triangles: Array<[number, number, number]> = [];
  for (let j = 0; j < ny; j += 1) {
    for (let i = 0; i < nx; i += 1) {
      const a = at(i, j);
      const b = at(i + 1, j);
      const c = at(i + 1, j + 1);
      const d = at(i, j + 1);
      triangles.push([a, b, c], [a, c, d]);
    }
  }
  return { points, triangles };
};

const levelsOf = (minZ: number, maxZ: number, spec = { minorInterval: 1, majorEvery: 5, baseElevation: 0 }) =>
  computeContourLevels(minZ, maxZ, spec);

describe('contourLevels', () => {
  test('negative elevations with non-zero base resolve exact levels and majors', () => {
    const levels = computeContourLevels(-5, 5, { minorInterval: 2, majorEvery: 2, baseElevation: 0.5 });
    expect(levels.map((l) => l.elevation)).toEqual([-3.5, -1.5, 0.5, 2.5, 4.5]);
    expect(levels.map((l) => l.kind)).toEqual(['major', 'minor', 'major', 'minor', 'major']);
    expect(levels.map((l) => l.levelIndex)).toEqual([-2, -1, 0, 1, 2]);
  });

  test('invalid specs throw before any level work', () => {
    expect(() => levelsOf(0, 10, { minorInterval: 0, majorEvery: 5, baseElevation: 0 })).toThrow(
      'SURFACE_CONTOUR_INVALID_INTERVAL',
    );
    expect(() => levelsOf(0, 10, { minorInterval: NaN, majorEvery: 5, baseElevation: 0 })).toThrow();
    expect(() => levelsOf(0, 10, { minorInterval: 1, majorEvery: 0, baseElevation: 0 })).toThrow(
      'SURFACE_CONTOUR_INVALID_MAJOR_EVERY',
    );
    expect(() => levelsOf(0, 10, { minorInterval: 1, majorEvery: 1.5, baseElevation: 0 })).toThrow();
  });

  test('pathological level count is blocked with SURFACE_CONTOUR_LEVEL_LIMIT', () => {
    let caught: unknown = null;
    try {
      computeContourLevels(0, 100000, { minorInterval: 0.001, majorEvery: 5, baseElevation: 0 });
    } catch (err) {
      caught = err;
    }
    expect(caught).toBeInstanceOf(Error);
    expect((caught as { code?: string }).code).toBe(SURFACE_CONTOUR_LEVEL_LIMIT);
  });
});

describe('planar slope', () => {
  test('straight parallel contours lying exactly on the plane', () => {
    const { points, triangles } = buildGrid(4, 4, (x, y) => 0.5 * x + 0.25 * y + 3);
    const levels = levelsOf(3, 33);
    const set = run(points, triangles, levels);
    expect(set.stats.levelCount).toBe(levels.length);
    expect(set.minorPaths.length + set.majorPaths.length).toBeGreaterThan(0);
    const all = [...set.minorPaths, ...set.majorPaths];
    for (const path of all) {
      expect(path.closed).toBe(false);
      // Every contour point lies on the source plane at its elevation.
      for (const p of path.points) {
        expect(Math.abs(0.5 * p.x + 0.25 * p.y + 3 - path.elevation)).toBeLessThan(1e-9);
      }
      // Straight: every point on the line through first/last.
      const [f, l] = [path.points[0], path.points[path.points.length - 1]];
      const dx = l.x - f.x;
      const dy = l.y - f.y;
      const norm = Math.hypot(dx, dy);
      for (const p of path.points) {
        const dist = Math.abs((p.x - f.x) * dy - (p.y - f.y) * dx) / norm;
        expect(dist).toBeLessThan(1e-9);
      }
      // No zero-length links, no duplicated consecutive points.
      for (let i = 1; i < path.points.length; i += 1) {
        const a = path.points[i - 1];
        const b = path.points[i];
        expect(Math.hypot(b.x - a.x, b.y - a.y)).toBeGreaterThan(0);
      }
    }
    // Correct spacing: the mean of on-line points stays on the affine line,
    // so projecting level means onto the gradient gives interval / |grad|
    // exactly — immune to boundary clipping (which only slides along-line).
    const gradMag = Math.hypot(0.5, 0.25);
    const byLevel = new Map<number, typeof all>();
    for (const p of all) byLevel.set(p.elevation, [...(byLevel.get(p.elevation) ?? []), p]);
    const sorted = [...byLevel.keys()].sort((a, b) => a - b);
    expect(sorted.length).toBeGreaterThan(2);
    const meanS = (paths: typeof all): number => {
      const pts = paths.flatMap((p) => p.points);
      return (0.5 * pts.reduce((s, p) => s + p.x, 0) + 0.25 * pts.reduce((s, p) => s + p.y, 0)) / pts.length;
    };
    for (let i = 1; i < sorted.length; i += 1) {
      const shift = (meanS(byLevel.get(sorted[i])!) - meanS(byLevel.get(sorted[i - 1])!)) / gradMag;
      expect(Math.abs(shift - (sorted[i] - sorted[i - 1]) / gradMag)).toBeLessThan(1e-9);
    }
  });
});

describe('hill and depression', () => {
  const hill = (x: number, y: number): number => 10 - ((x - 20) ** 2 + (y - 20) ** 2) / 80;
  test('hill gives nested closed loops', () => {
    const { points, triangles } = buildGrid(4, 4, hill);
    const levels = levelsOf(0, 10, { minorInterval: 2, majorEvery: 5, baseElevation: 0 });
    expect(levels.map((l) => l.elevation)).toEqual([0, 2, 4, 6, 8, 10]);
    const set = run(points, triangles, levels);
    // Low loops (r > half-width 20) are clipped open by the domain edge;
    // only interior loops (6, 8) are closed. Level 10 touches just the peak.
    const all = [...set.minorPaths, ...set.majorPaths].filter((p) => p.elevation >= 6);
    expect(all.length).toBeGreaterThanOrEqual(2);
    for (const p of all) expect(p.closed).toBe(true);
    const at10 = [...set.minorPaths, ...set.majorPaths].filter((p) => p.elevation === 10);
    expect(at10).toHaveLength(0);
    // Nested: bounding boxes shrink monotonically with elevation.
    const area = (p: { points: { x: number; y: number }[] }): number => {
      const xs = p.points.map((q) => q.x);
      const ys = p.points.map((q) => q.y);
      return (Math.max(...xs) - Math.min(...xs)) * (Math.max(...ys) - Math.min(...ys));
    };
    const byElev = [...new Set(all.map((p) => p.elevation))].sort((a, b) => a - b);
    for (let i = 1; i < byElev.length; i += 1) {
      const lo = Math.max(...all.filter((p) => p.elevation === byElev[i - 1]).map(area));
      const hi = Math.min(...all.filter((p) => p.elevation === byElev[i]).map(area));
      expect(hi).toBeLessThanOrEqual(lo);
    }
  });

  test('depression gives closed loops', () => {
    const { points, triangles } = buildGrid(4, 4, (x, _y) => -hill(x, _y));
    const levels = levelsOf(-10, 0, { minorInterval: 2, majorEvery: 5, baseElevation: 0 });
    const set = run(points, triangles, levels);
    const all = [...set.minorPaths, ...set.majorPaths].filter((p) => p.elevation <= -6);
    expect(all.length).toBeGreaterThanOrEqual(2);
    for (const p of all) expect(p.closed).toBe(true);
  });
});

describe('ridge triangulation topology', () => {
  // Same 6 points; only the quad diagonals differ.
  const points = [
    pt(0, 0, 0, 'a'),
    pt(10, 0, 8, 'b'),
    pt(20, 0, 0, 'c'),
    pt(0, 10, 0, 'd'),
    pt(10, 10, 8, 'e'),
    pt(20, 10, 0, 'f'),
  ];
  const diagA: Array<[number, number, number]> = [
    [0, 1, 4],
    [0, 4, 3],
    [1, 2, 5],
    [1, 5, 4],
  ];
  const diagB: Array<[number, number, number]> = [
    [0, 1, 3],
    [1, 4, 3],
    [1, 2, 4],
    [2, 5, 4],
  ];
  test('same points with different ridge diagonals give different contours', () => {
    const levels = levelsOf(0, 8, { minorInterval: 2, majorEvery: 5, baseElevation: 0 });
    const setA = run(points, diagA, levels);
    const setB = run(points, diagB, levels);
    expect(setA.stats.segmentCount).toBeGreaterThan(0);
    expect(setB.stats.segmentCount).toBeGreaterThan(0);
    expect(JSON.stringify(setB)).not.toBe(JSON.stringify(setA));
  });
});

describe('domain subsets: concave boundary and void', () => {
  test('concave retained subset emits nothing inside the excluded cell', () => {
    const { points, triangles } = buildGrid(3, 3, (x, y) => x + y);
    // Drop the top-right cell (x,y in [20,30]^2): concave L-shaped domain.
    // Triangle index -> cell index is Math.floor(t / 2); cell 8 is top-right.
    const kept = triangles.filter((_, t) => Math.floor(t / 2) !== 8);
    const set = run(points, kept, levelsOf(0, 60));
    const all = [...set.minorPaths, ...set.majorPaths];
    expect(all.length).toBeGreaterThan(0);
    for (const p of all) {
      for (const q of p.points) {
        expect(q.x <= 20 || q.y <= 20).toBe(true);
      }
    }
  });

  test('void is never bridged', () => {
    const { points, triangles } = buildGrid(4, 4, (x, _y) => x);
    // Drop the central cell (cells index row-major: cell (2,1) is index 1*4+2 = 6).
    const kept = triangles.filter((_, cell) => Math.floor(cell / 2) !== 6);
    const set = run(points, kept, levelsOf(0, 40));
    const all = [...set.minorPaths, ...set.majorPaths];
    expect(all.length).toBeGreaterThan(0);
    for (const p of all) {
      for (let i = 1; i < p.points.length; i += 1) {
        const mx = (p.points[i - 1].x + p.points[i].x) / 2;
        const my = (p.points[i - 1].y + p.points[i].y) / 2;
        const inside = mx > 20 && mx < 30 && my > 10 && my < 20;
        expect(inside).toBe(false);
      }
    }
  });
});

describe('exact hits', () => {
  test('exact vertex hit yields a clean through-segment', () => {
    const points = [pt(0, 0, 0, 'a'), pt(10, 0, 5, 'b'), pt(0, 10, 10, 'c')];
    const set = run(points, [[0, 1, 2]], levelsOf(0, 10));
    const at5 = [...set.minorPaths, ...set.majorPaths].filter((p) => p.elevation === 5);
    expect(at5).toHaveLength(1);
    expect(at5[0].closed).toBe(false);
    expect(at5[0].points).toHaveLength(2);
    expect(at5[0].points).toContainEqual({ x: 10, y: 0 });
    expect(at5[0].points).toContainEqual({ x: 0, y: 5 });
  });

  test('extremum touch (same side) emits nothing', () => {
    // Peak vertex exactly on the level, other two strictly below.
    const points = [pt(0, 0, 5, 'a'), pt(10, 0, 0, 'b'), pt(0, 10, 0, 'c')];
    const set = run(points, [[0, 1, 2]], levelsOf(0, 5));
    const at5 = [...set.minorPaths, ...set.majorPaths].filter((p) => p.elevation === 5);
    expect(at5).toHaveLength(0);
  });

  test('exact shared edge is emitted exactly once', () => {
    const points = [
      pt(0, 0, 5, 'a'),
      pt(10, 0, 5, 'b'),
      pt(5, 10, 0, 'c'),
      pt(5, -10, 0, 'd'),
    ];
    const set = run(
      points,
      [
        [0, 1, 2],
        [0, 3, 1],
      ],
      levelsOf(0, 5).filter((l) => l.elevation === 5),
    );
    const at5 = [...set.minorPaths, ...set.majorPaths].filter((p) => p.elevation === 5);
    expect(at5).toHaveLength(1);
    expect(at5[0].points).toHaveLength(2);
    expect(set.stats.segmentCount).toBe(1);
  });
});

describe('plateaus', () => {
  // Plateau square at z=5 with an apron falling to z=0.
  const points = [
    pt(0, 0, 5, 'A'),
    pt(10, 0, 5, 'B'),
    pt(10, 10, 5, 'C'),
    pt(0, 10, 5, 'D'),
    pt(-10, -10, 0, 'E'),
    pt(20, -10, 0, 'F'),
    pt(20, 20, 0, 'G'),
    pt(-10, 20, 0, 'H'),
  ];
  const tris: Array<[number, number, number]> = [
    [0, 1, 2],
    [0, 2, 3],
    [4, 5, 1],
    [4, 1, 0],
    [5, 6, 2],
    [5, 2, 1],
    [6, 7, 3],
    [6, 3, 2],
    [7, 4, 0],
    [7, 0, 3],
  ];
  test('single flat triangle emits its perimeter only', () => {
    const set = run(points.slice(0, 3), [[0, 1, 2]], levelsOf(0, 5));
    const at5 = [...set.minorPaths, ...set.majorPaths].filter((p) => p.elevation === 5);
    expect(at5).toHaveLength(1);
    expect(at5[0].closed).toBe(true);
    expect(at5[0].points).toHaveLength(3);
  });

  test('multi-triangle plateau emits one outer perimeter, no internal edges', () => {
    const set = run(points, tris, levelsOf(0, 5));
    const at5 = [...set.minorPaths, ...set.majorPaths].filter((p) => p.elevation === 5);
    expect(at5).toHaveLength(1);
    expect(at5[0].closed).toBe(true);
    expect(at5[0].points).toHaveLength(4);
    const xs = at5[0].points.map((p) => p.x).sort((a, b) => a - b);
    const ys = at5[0].points.map((p) => p.y).sort((a, b) => a - b);
    expect(xs).toEqual([0, 0, 10, 10]);
    expect(ys).toEqual([0, 0, 10, 10]);
  });
});

describe('saddle split', () => {
  test('degree-4 saddle splits into four open paths (documented, deterministic)', () => {
    const points = [
      pt(0, 0, 10, 'a'),
      pt(10, 0, 0, 'b'),
      pt(10, 10, 10, 'c'),
      pt(0, 10, 0, 'd'),
      pt(5, 5, 5, 'o'),
    ];
    const tris: Array<[number, number, number]> = [
      [0, 1, 4],
      [1, 2, 4],
      [2, 3, 4],
      [3, 0, 4],
    ];
    const levels = levelsOf(0, 10).filter((l) => l.elevation === 5);
    const set = run(points, tris, levels);
    const all = [...set.minorPaths, ...set.majorPaths];
    // Four through-vertex segments meet at the saddle vertex and must NOT be
    // guessed into pairs: each becomes its own open 2-point path.
    expect(all).toHaveLength(4);
    for (const p of all) {
      expect(p.closed).toBe(false);
      expect(p.points).toHaveLength(2);
      expect(p.points).toContainEqual({ x: 5, y: 5 });
    }
    // Deterministic: shuffle-safe (checked below) and repeat-equal.
    expect(run(points, tris, levels)).toEqual(set);
  });
});

describe('determinism', () => {
  const hill = (x: number, y: number): number => 10 - ((x - 20) ** 2 + (y - 20) ** 2) / 80;
  test('shuffled triangle input is canonical-equal', () => {
    const { points, triangles } = buildGrid(4, 4, hill);
    const levels = levelsOf(0, 10);
    const a = run(points, triangles, levels);
    const b = run(points, [...triangles].reverse(), levels);
    expect(b).toEqual(a);
  });

  test('translated-by-millions input is connectivity-equal', () => {
    const { points, triangles } = buildGrid(4, 4, hill);
    const levels = levelsOf(0, 10);
    const a = run(points, triangles, levels);
    const DX = 1_000_000;
    const DY = 2_000_000;
    const moved = points.map((p, i) => ({ ...p, entityId: `m:${i}`, x: p.x + DX, y: p.y + DY }));
    const b = run(moved, triangles, levels);
    // Bit-identity is impossible (xlo + t*dx rounds differently at 1e6),
    // so connectivity-equal means: same path topology within fp tolerance.
    const pathsA = [...a.minorPaths, ...a.majorPaths];
    const pathsB = [...b.minorPaths, ...b.majorPaths];
    expect(pathsB).toHaveLength(pathsA.length);
    const TOL = 1e-6;
    const near = (p: { x: number; y: number }, q: { x: number; y: number }): boolean =>
      Math.abs(p.x + DX - q.x) < TOL && Math.abs(p.y + DY - q.y) < TOL;
    const used = new Array<boolean>(pathsA.length).fill(false);
    for (const pb of pathsB) {
      const match = pathsA.findIndex(
        (pa, i) =>
          !used[i] &&
          pa.elevation === pb.elevation &&
          pa.closed === pb.closed &&
          pa.points.length === pb.points.length &&
          pa.points.every((q, j) => near(q, pb.points[j])),
      );
      expect(match).toBeGreaterThanOrEqual(0);
      used[match] = true;
    }
  });

  test('stats are internally consistent', () => {
    const { points, triangles } = buildGrid(4, 4, hill);
    const levels = levelsOf(0, 10);
    const set = run(points, triangles, levels);
    expect(set.stats.levelCount).toBe(levels.length);
    expect(set.stats.minorLevelCount + set.stats.majorLevelCount).toBe(levels.length);
    expect(set.stats.minorPathCount).toBe(set.minorPaths.length);
    expect(set.stats.majorPathCount).toBe(set.majorPaths.length);
    let segs = 0;
    let len = 0;
    for (const p of [...set.minorPaths, ...set.majorPaths]) {
      segs += p.closed ? p.points.length : p.points.length - 1;
      for (let i = 1; i < p.points.length; i += 1) {
        len += Math.hypot(p.points[i].x - p.points[i - 1].x, p.points[i].y - p.points[i - 1].y);
      }
      if (p.closed && p.points.length > 1) {
        const f = p.points[0];
        const l = p.points[p.points.length - 1];
        len += Math.hypot(f.x - l.x, f.y - l.y);
      }
    }
    expect(set.stats.segmentCount).toBe(segs);
    expect(Math.abs(set.stats.totalLength - len)).toBeLessThan(1e-9);
    expect(set.minLevel).toBe(0);
    expect(set.maxLevel).toBe(10);
  });
});
