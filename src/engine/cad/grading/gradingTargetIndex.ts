/**
 * Phase 20C Wave-1A — grading target index.
 *
 * Flat-snapshot target query + swept-strip candidate discovery, moved
 * verbatim from `src/workers/surfaceGradingCompute.ts` (zero numerical
 * change). One target index per worker request; corners reuse it.
 */
import { buildSurfaceGrid, getSurfaceElevationAt } from '../cadSurfaceInterpolation';
import type { CadSurfaceBuildResult } from '../cadSurfaces';
import type { GradingTargetMeshSnapshot, TargetQuery } from './gradingComputeTypes';

export const buildTargetQuery = (target: GradingTargetMeshSnapshot): TargetQuery | null => {
  if (target.points.length % 3 !== 0 || target.triangles.length % 3 !== 0) return null;
  const count = target.points.length / 3;
  const points: Array<{ x: number; y: number; z: number }> = [];
  for (let i = 0; i < count; i += 1) {
    const x = target.points[i * 3]!;
    const y = target.points[i * 3 + 1]!;
    const z = target.points[i * 3 + 2]!;
    if (!Number.isFinite(x) || !Number.isFinite(y) || !Number.isFinite(z)) return null;
    points.push({ x, y, z });
  }
  const triangles: Array<[number, number, number]> = [];
  for (let i = 0; i + 2 < target.triangles.length; i += 3) {
    const a = target.triangles[i]!;
    const b = target.triangles[i + 1]!;
    const c = target.triangles[i + 2]!;
    if (!Number.isInteger(a) || !Number.isInteger(b) || !Number.isInteger(c)) return null;
    if (a < 0 || b < 0 || c < 0 || a >= count || b >= count || c >= count) return null;
    if (a === b || b === c || c === a) return null;
    triangles.push([a, b, c]);
  }
  const sourcePoints = points.map((p, index) => ({ entityId: `grading-target:${index}`, ...p }));
  const grid = buildSurfaceGrid(sourcePoints, triangles);
  const build = { outcome: 'ok', points, triangles, grid } as CadSurfaceBuildResult;
  let queryCount = 0;
  return {
    elevationAt: (x, y) => {
      queryCount += 1;
      return getSurfaceElevationAt(build, x, y);
    },
    // The raw buffers the interpolator reads: facet-level walks use them to
    // test the actual triangles instead of resampling elevationAt.
    targetPoints: target.points,
    targetTriangles: target.triangles,
    get queryCount() {
      return queryCount;
    },
  };
};

interface SnapshotArrays {
  points: Array<{ x: number; y: number; z: number }>;
  triangles: Array<[number, number, number]>;
}

const snapshotArrays = (target: GradingTargetMeshSnapshot): SnapshotArrays => {
  const count = target.points.length / 3;
  const points: Array<{ x: number; y: number; z: number }> = [];
  for (let i = 0; i < count; i += 1) {
    points.push({ x: target.points[i * 3]!, y: target.points[i * 3 + 1]!, z: target.points[i * 3 + 2]! });
  }
  const triangles: Array<[number, number, number]> = [];
  for (let i = 0; i + 2 < target.triangles.length; i += 3) {
    triangles.push([target.triangles[i]!, target.triangles[i + 1]!, target.triangles[i + 2]!]);
  }
  return { points, triangles };
};

/** Grid-cell candidate triangle indices over the strip bbox. */
const gridCellCandidates = (
  grid: ReturnType<typeof buildSurfaceGrid>,
  minX: number,
  minY: number,
  maxX: number,
  maxY: number,
): Set<number> => {
  const { minX: gx, minY: gy, cellSize, cells } = grid;
  const x0 = Math.floor((minX - gx) / cellSize);
  const x1 = Math.floor((maxX - gx) / cellSize);
  const y0 = Math.floor((minY - gy) / cellSize);
  const y1 = Math.floor((maxY - gy) / cellSize);
  const found = new Set<number>();
  for (let ix = x0; ix <= x1; ix += 1) {
    for (let iy = y0; iy <= y1; iy += 1) {
      const list = cells.get(`${ix},${iy}`);
      if (list) for (const index of list) found.add(index);
    }
  }
  return found;
};

/** Cell miss (strip outside indexed span): fall back to bbox overlap scan. */
const bboxOverlapCandidates = (
  points: SnapshotArrays['points'],
  triangles: SnapshotArrays['triangles'],
  minX: number,
  minY: number,
  maxX: number,
  maxY: number,
): Set<number> => {
  const found = new Set<number>();
  for (let i = 0; i < triangles.length; i += 1) {
    const tri = triangles[i]!;
    const xs = [points[tri[0]]!.x, points[tri[1]]!.x, points[tri[2]]!.x];
    const ys = [points[tri[0]]!.y, points[tri[1]]!.y, points[tri[2]]!.y];
    if (Math.max(...xs) >= minX && Math.min(...xs) <= maxX && Math.max(...ys) >= minY && Math.min(...ys) <= maxY) {
      found.add(i);
    }
  }
  return found;
};

/** Candidate target triangles via grid bbox over the swept strip (sorted, deterministic). */
export const candidateTriangles = (
  target: GradingTargetMeshSnapshot,
  corners: Array<{ x: number; y: number }>,
): number[] | null => {
  const { points, triangles } = snapshotArrays(target);
  const sourcePoints = points.map((p, index) => ({ entityId: `grading-target:${index}`, ...p }));
  const grid = buildSurfaceGrid(sourcePoints, triangles);
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  for (const c of corners) {
    minX = Math.min(minX, c.x);
    minY = Math.min(minY, c.y);
    maxX = Math.max(maxX, c.x);
    maxY = Math.max(maxY, c.y);
  }
  let found = gridCellCandidates(grid, minX, minY, maxX, maxY);
  if (found.size === 0) {
    found = bboxOverlapCandidates(points, triangles, minX, minY, maxX, maxY);
  }
  return [...found].sort((a, b) => a - b);
};
