import type { ProfileExtractionMesh } from './profileExtraction';

/**
 * Phase 18J TIN point-location for profiles (engine only, pure).
 *
 * Grid-indexed candidate triangles (sorted — triangle order never affects
 * output) + barycentric plane values. Shared with extraction and inquiry
 * from here; never re-implemented per caller.
 */

export interface LocatedPoint {
  elevation: number;
  triangleIndex: number;
}

/** Plane elevation of triangle `tri` at (x,y); null when outside. */
export const planeElevationAt = (
  mesh: ProfileExtractionMesh,
  tri: number,
  x: number,
  y: number,
): number | null => {
  const t = mesh.triangles[tri];
  if (!t) return null;
  const a = mesh.points[t[0]];
  const b = mesh.points[t[1]];
  const c = mesh.points[t[2]];
  if (!a || !b || !c) return null;
  const denom = (b.y - c.y) * (a.x - c.x) + (c.x - b.x) * (a.y - c.y);
  if (denom === 0) return null;
  const l1 = ((b.y - c.y) * (x - c.x) + (c.x - b.x) * (y - c.y)) / denom;
  const l2 = ((c.y - a.y) * (x - c.x) + (a.x - c.x) * (y - c.y)) / denom;
  const l3 = 1 - l1 - l2;
  const tol = 1e-9;
  if (l1 < -tol || l2 < -tol || l3 < -tol) return null;
  const z = l1 * a.z + l2 * b.z + l3 * c.z;
  return Number.isFinite(z) ? z : null;
};

/** Candidate triangle indices (sorted — triangle order never affects output). */
export const candidateTriangles = (
  mesh: ProfileExtractionMesh,
  minX: number, minY: number, maxX: number, maxY: number,
): number[] => {
  const { grid } = mesh;
  if (grid.cells.size === 0) {
    return mesh.triangles.map((_, index) => index);
  }
  const x0 = Math.floor((minX - grid.minX) / grid.cellSize);
  const x1 = Math.floor((maxX - grid.minX) / grid.cellSize);
  const y0 = Math.floor((minY - grid.minY) / grid.cellSize);
  const y1 = Math.floor((maxY - grid.minY) / grid.cellSize);
  const found = new Set<number>();
  for (let ix = x0; ix <= x1; ix += 1) {
    for (let iy = y0; iy <= y1; iy += 1) {
      for (const index of grid.cells.get(`${ix},${iy}`) ?? []) found.add(index);
    }
  }
  if (found.size === 0) return mesh.triangles.map((_, index) => index);
  return [...found].sort((a, b) => a - b);
};

/**
 * All containing triangles' plane values (permutation-invariant set).
 * Mean when planes agree; null when no triangle contains the point
 * (outside outer boundary or inside a void).
 */
export const locateProfileElevation = (
  mesh: ProfileExtractionMesh,
  x: number,
  y: number,
): LocatedPoint | null => {
  const box = 1e-9;
  const candidates = candidateTriangles(mesh, x - box, y - box, x + box, y + box);
  let sum = 0;
  let count = 0;
  let first = -1;
  for (const tri of candidates) {
    const z = planeElevationAt(mesh, tri, x, y);
    if (z == null) continue;
    if (first < 0) first = tri;
    sum += z;
    count += 1;
  }
  if (count === 0 || first < 0) return null;
  return { elevation: sum / count, triangleIndex: first };
};
