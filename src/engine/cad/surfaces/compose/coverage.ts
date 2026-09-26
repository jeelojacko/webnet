/**
 * Phase 18Y — retained-triangle coverage queries over a source mesh.
 *
 * A "mesh view" wraps one CURRENT final mesh (all input triangles are
 * retained by construction) with a uniform-grid bbox index so point
 * location is sub-linear. Coverage = containment in an actual retained
 * triangle; Z comes from that triangle's own plane (local-frame
 * barycentric interpolation, 1e-9 weight tolerance per the
 * getSurfaceElevationAt precedent). Boundary counts as inside.
 */

export interface ComposeMeshPoint {
  x: number;
  y: number;
  z: number;
}

export type ComposeMeshTriangle = readonly [number, number, number];

export interface LocatedPoint {
  /** Owning retained triangle index (lowest on shared edges — deterministic). */
  tri: number;
  z: number;
}

export interface ComposeMeshView {
  points: ReadonlyArray<ComposeMeshPoint>;
  triangles: ReadonlyArray<ComposeMeshTriangle>;
  minX: number;
  minY: number;
  cellSize: number;
  cells: Map<string, number[]>;
  vertexIndex: Map<string, number>;
}

const keyOf = (x: number, y: number): string => `${x},${y}`;

/** Uniform-grid bbox index over source triangles (bboxIndex heuristic). */
export const createMeshView = (
  points: ReadonlyArray<ComposeMeshPoint>,
  triangles: ReadonlyArray<ComposeMeshTriangle>,
): ComposeMeshView => {
  const vertexIndex = new Map<string, number>();
  points.forEach((p, i) => {
    if (!vertexIndex.has(keyOf(p.x, p.y))) vertexIndex.set(keyOf(p.x, p.y), i);
  });
  if (triangles.length === 0 || points.length === 0) {
    return { points, triangles, minX: 0, minY: 0, cellSize: 1, cells: new Map(), vertexIndex };
  }
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  for (const p of points) {
    if (p.x < minX) minX = p.x;
    if (p.y < minY) minY = p.y;
    if (p.x > maxX) maxX = p.x;
    if (p.y > maxY) maxY = p.y;
  }
  const span = Math.max(maxX - minX, maxY - minY, 1e-9);
  const cellSize = Math.max(span / Math.sqrt(triangles.length), span / 64, 1e-9);
  const cells = new Map<string, number[]>();
  triangles.forEach((tri, index) => {
    const xs = [points[tri[0]]!.x, points[tri[1]]!.x, points[tri[2]]!.x];
    const ys = [points[tri[0]]!.y, points[tri[1]]!.y, points[tri[2]]!.y];
    const x0 = Math.floor((Math.min(xs[0]!, xs[1]!, xs[2]!) - minX) / cellSize);
    const x1 = Math.floor((Math.max(xs[0]!, xs[1]!, xs[2]!) - minX) / cellSize);
    const y0 = Math.floor((Math.min(ys[0]!, ys[1]!, ys[2]!) - minY) / cellSize);
    const y1 = Math.floor((Math.max(ys[0]!, ys[1]!, ys[2]!) - minY) / cellSize);
    for (let ix = x0; ix <= x1; ix += 1) {
      for (let iy = y0; iy <= y1; iy += 1) {
        const key = `${ix},${iy}`;
        const list = cells.get(key);
        if (list) list.push(index);
        else cells.set(key, [index]);
      }
    }
  });
  return { points, triangles, minX, minY, cellSize, cells, vertexIndex };
};

const WEIGHT_TOL = 1e-9;

/** Local-frame barycentric Z (translation-invariant at large coordinates). */
const triangleZAt = (
  view: ComposeMeshView,
  tri: number,
  x: number,
  y: number,
): number | null => {
  const t = view.triangles[tri]!;
  const a = view.points[t[0]]!;
  const b = view.points[t[1]]!;
  const c = view.points[t[2]]!;
  const ox = Math.min(a.x, b.x, c.x);
  const oy = Math.min(a.y, b.y, c.y);
  const ax = a.x - ox;
  const ay = a.y - oy;
  const bx = b.x - ox;
  const by = b.y - oy;
  const cx = c.x - ox;
  const cy = c.y - oy;
  const px = x - ox;
  const py = y - oy;
  const denom = (by - cy) * (ax - cx) + (cx - bx) * (ay - cy);
  if (denom === 0) return null;
  const l1 = ((by - cy) * (px - cx) + (cx - bx) * (py - cy)) / denom;
  const l2 = ((cy - ay) * (px - cx) + (ax - cx) * (py - cy)) / denom;
  const l3 = 1 - l1 - l2;
  if (l1 < -WEIGHT_TOL || l2 < -WEIGHT_TOL || l3 < -WEIGHT_TOL) return null;
  if (l1 > 1 + WEIGHT_TOL || l2 > 1 + WEIGHT_TOL || l3 > 1 + WEIGHT_TOL) return null;
  return l1 * a.z + l2 * b.z + l3 * c.z;
};

/**
 * Locate (x, y) in the retained domain. Exact source-vertex hits return the
 * stored Z verbatim (no barycentric rounding); otherwise the lowest-index
 * containing triangle wins. Null = outside the mesh / over a void.
 */
export const locateInMesh = (view: ComposeMeshView, x: number, y: number): LocatedPoint | null => {
  const exact = view.vertexIndex.get(keyOf(x, y));
  if (exact !== undefined) return { tri: -1, z: view.points[exact]!.z };
  const key = `${Math.floor((x - view.minX) / view.cellSize)},${Math.floor((y - view.minY) / view.cellSize)}`;
  const cell = view.cells.get(key);
  const scan = (indices: ReadonlyArray<number>): LocatedPoint | null => {
    let best: LocatedPoint | null = null;
    for (const index of indices) {
      const z = triangleZAt(view, index, x, y);
      if (z == null) continue;
      if (best == null || index < best.tri) best = { tri: index, z };
    }
    return best;
  };
  if (cell) return scan(cell);
  // Crack-adjacent query outside every indexed cell: full scan (rare).
  return scan(view.triangles.map((_, index) => index));
};

/**
 * Cell-local locate for the compose hot path: exact source-vertex hit,
 * then the query cell plus its 3x3 neighbours — never the whole-view
 * fallback scan. Equivalent to locateInMesh: any triangle containing
 * (x, y) within the weight tolerance has its bbox within ~1e-9 of the
 * query, hence inside the 3x3 neighbourhood (cell size >> 1e-9); anything
 * farther away cannot contain it. The lowest-index win is
 * order-independent, so results match the full scan exactly.
 */
export const locateInMeshFast = (view: ComposeMeshView, x: number, y: number): LocatedPoint | null => {
  const exact = view.vertexIndex.get(keyOf(x, y));
  if (exact !== undefined) return { tri: -1, z: view.points[exact]!.z };
  const cx = Math.floor((x - view.minX) / view.cellSize);
  const cy = Math.floor((y - view.minY) / view.cellSize);
  let best: LocatedPoint | null = null;
  for (let ix = cx - 1; ix <= cx + 1; ix += 1) {
    for (let iy = cy - 1; iy <= cy + 1; iy += 1) {
      const list = view.cells.get(`${ix},${iy}`);
      if (!list) continue;
      for (const index of list) {
        const z = triangleZAt(view, index, x, y);
        if (z == null) continue;
        if (best == null || index < best.tri) best = { tri: index, z };
      }
    }
  }
  return best;
};

/** Planimetric (XY) area of the retained domain. */
export const meshPlanimetricArea = (view: ComposeMeshView): number => {
  let area = 0;
  for (const t of view.triangles) {
    const a = view.points[t[0]]!;
    const b = view.points[t[1]]!;
    const c = view.points[t[2]]!;
    area += Math.abs((b.x - a.x) * (c.y - a.y) - (c.x - a.x) * (b.y - a.y)) / 2;
  }
  return area;
};
