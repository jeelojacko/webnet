import type { CadSurfaceBuildResult, CadSurfaceGrid, CadSurfaceSourcePoint } from './cadSurfaces';

/** Uniform-grid query index over build triangles (engine-local, opaque). */
export const buildSurfaceGrid = (
  points: CadSurfaceSourcePoint[],
  triangles: Array<[number, number, number]>,
): CadSurfaceGrid => {
  if (triangles.length === 0 || points.length === 0) {
    return { minX: 0, minY: 0, cellSize: 1, cells: new Map() };
  }
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  for (const p of points) {
    minX = Math.min(minX, p.x);
    minY = Math.min(minY, p.y);
    maxX = Math.max(maxX, p.x);
    maxY = Math.max(maxY, p.y);
  }
  const span = Math.max(maxX - minX, maxY - minY, 1e-9);
  const cellSize = Math.max(span / Math.sqrt(triangles.length), span / 64, 1e-9);
  const cells = new Map<string, number[]>();
  triangles.forEach((tri, index) => {
    const xs = [points[tri[0]].x, points[tri[1]].x, points[tri[2]].x];
    const ys = [points[tri[0]].y, points[tri[1]].y, points[tri[2]].y];
    const x0 = Math.floor((Math.min(...xs) - minX) / cellSize);
    const x1 = Math.floor((Math.max(...xs) - minX) / cellSize);
    const y0 = Math.floor((Math.min(...ys) - minY) / cellSize);
    const y1 = Math.floor((Math.max(...ys) - minY) / cellSize);
    for (let ix = x0; ix <= x1; ix += 1) {
      for (let iy = y0; iy <= y1; iy += 1) {
        const key = `${ix},${iy}`;
        const list = cells.get(key) ?? [];
        list.push(index);
        cells.set(key, list);
      }
    }
  });
  return { minX, minY, cellSize, cells };
};

const barycentric = (
  px: number, py: number,
  ax: number, ay: number, bx: number, by: number, cx: number, cy: number,
): [number, number, number] | null => {
  const denom = (by - cy) * (ax - cx) + (cx - bx) * (ay - cy);
  if (denom === 0) return null;
  const l1 = ((by - cy) * (px - cx) + (cx - bx) * (py - cy)) / denom;
  const l2 = ((cy - ay) * (px - cx) + (ax - cx) * (py - cy)) / denom;
  return [l1, l2, 1 - l1 - l2];
};

interface SurfaceTriangleHit {
  index: number;
  weights: [number, number, number];
}

/** Locate the containing triangle by grid cell, with a crack-adjacent scan. */
const locateSurfaceTriangle = (
  build: CadSurfaceBuildResult,
  x: number,
  y: number,
): SurfaceTriangleHit | null => {
  if (build.outcome !== 'ok' || build.triangles.length === 0) return null;
  const tryTriangle = (index: number): SurfaceTriangleHit | null => {
    const tri = build.triangles[index]!;
    const a = build.points[tri[0]]!;
    const b = build.points[tri[1]]!;
    const c = build.points[tri[2]]!;
    const weights = barycentric(x, y, a.x, a.y, b.x, b.y, c.x, c.y);
    if (!weights) return null;
    const tol = 1e-9;
    if (weights.some((w) => w < -tol || w > 1 + tol)) return null;
    return { index, weights };
  };
  const { minX, minY, cellSize, cells } = build.grid;
  const key = `${Math.floor((x - minX) / cellSize)},${Math.floor((y - minY) / cellSize)}`;
  for (const index of cells.get(key) ?? []) {
    const hit = tryTriangle(index);
    if (hit != null) return hit;
  }
  // Cell miss (crack-adjacent query): fall back to a full scan.
  if (!cells.has(key)) {
    for (let index = 0; index < build.triangles.length; index += 1) {
      const hit = tryTriangle(index);
      if (hit != null) return hit;
    }
  }
  return null;
};

/** Containing-triangle barycentric interpolation; null outside the mesh/voids. */
export const getSurfaceElevationAt = (
  build: CadSurfaceBuildResult,
  x: number,
  y: number,
): number | null => {
  const hit = locateSurfaceTriangle(build, x, y);
  if (!hit) return null;
  const tri = build.triangles[hit.index]!;
  const a = build.points[tri[0]]!;
  const b = build.points[tri[1]]!;
  const c = build.points[tri[2]]!;
  const [l1, l2, l3] = hit.weights;
  return l1 * a.z + l2 * b.z + l3 * c.z;
};

/** Anchored target triangle plane at a query point (20K.3 agreement leverage). */
export interface SurfacePlaneAtPoint {
  z: number;
  gx: number;
  gy: number;
  ax: number;
  ay: number;
}

/**
 * Anchored plane of the containing target triangle at (x, y), or null off the
 * mesh. Anchored at the first triangle vertex so a far-from-origin evaluation
 * never subtracts two world-magnitude intercept terms.
 */
export const getSurfacePlaneAt = (
  build: CadSurfaceBuildResult,
  x: number,
  y: number,
): SurfacePlaneAtPoint | null => {
  const hit = locateSurfaceTriangle(build, x, y);
  if (!hit) return null;
  const tri = build.triangles[hit.index]!;
  const a = build.points[tri[0]]!;
  const b = build.points[tri[1]]!;
  const c = build.points[tri[2]]!;
  const det = (b.x - a.x) * (c.y - a.y) - (c.x - a.x) * (b.y - a.y);
  if (det === 0) return null;
  const gx = ((b.z - a.z) * (c.y - a.y) - (c.z - a.z) * (b.y - a.y)) / det;
  const gy = ((b.x - a.x) * (c.z - a.z) - (c.x - a.x) * (b.z - a.z)) / det;
  return {
    z: a.z + gx * (x - a.x) + gy * (y - a.y),
    gx,
    gy,
    ax: a.x,
    ay: a.y,
  };
};
