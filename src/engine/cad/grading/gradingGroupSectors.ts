/**
 * Phase 20C Wave-2A — corner half-sector solves (pure, no worker/React).
 *
 * World-XY half-plane clip, closed-form 1D miter-tie roots along the miter
 * ray (affine per target triangle, never stepping), and the sector daylight
 * graph: clipped target triangles -> zeroDelta zero locus -> snapped
 * deterministic graph -> exactly one Q-to-tie path. All zero classification
 * uses the shared 18I `zeroDelta`; the daylight agreement gate matches the
 * 20B `validateGradingResultAgainstTarget` strictness (never loosened).
 */
import { zeroDelta } from '../surfaces/volume/zero';
import { extractZeroSegments } from './gradingZeroLocus';
import type { GradingTargetMeshSnapshot, TargetQuery } from './gradingComputeTypes';
import type { CornerGradingPlane } from './gradingCornerMath';

/** World-XY point. */
export interface SectorPoint {
  x: number;
  y: number;
}

/** Directed line through V with unit direction (mx, my). */
export interface SectorLine {
  vx: number;
  vy: number;
  mx: number;
  my: number;
}

const snap12 = (value: number): number => Math.round(value * 1e12) / 1e12;

const sectorKey = (x: number, y: number): string => `${snap12(x)}|${snap12(y)}`;

/** Signed distance of P from the directed line (left side positive). */
export const lineSide = (line: SectorLine, x: number, y: number): number =>
  line.mx * (y - line.vy) - line.my * (x - line.vx);

/**
 * Exact linear Sutherland-Hodgman clip of a world-XY polygon to the closed
 * half-plane on the same side of `line` as `keep` (zeroDelta-inclusive).
 */
export const clipPolygonToHalfPlane = (
  polygon: SectorPoint[],
  line: SectorLine,
  keep: SectorPoint,
): SectorPoint[] => {
  const keepSide = lineSide(line, keep.x, keep.y);
  const wantPositive = keepSide >= 0;
  const inside = (p: SectorPoint): boolean => {
    const s = lineSide(line, p.x, p.y);
    const eps = zeroDelta(s, 0);
    return wantPositive ? s >= -eps : s <= eps;
  };
  const cross = (a: SectorPoint, b: SectorPoint): SectorPoint => {
    const sa = lineSide(line, a.x, a.y);
    const sb = lineSide(line, b.x, b.y);
    const denom = sa - sb;
    const t = denom === 0 ? 0 : sa / denom;
    return { x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t };
  };
  const out: SectorPoint[] = [];
  const same = (a: SectorPoint, b: SectorPoint): boolean =>
    Math.abs(a.x - b.x) <= zeroDelta(a.x, b.x) && Math.abs(a.y - b.y) <= zeroDelta(a.y, b.y);
  for (let i = 0; i < polygon.length; i += 1) {
    const a = polygon[i]!;
    const b = polygon[(i + 1) % polygon.length]!;
    const aIn = inside(a);
    const bIn = inside(b);
    // Collapse zeroDelta-duplicate vertices (a bound crossing computed at an
    // existing endpoint would otherwise poison the zero-locus coincident
    // filter and drop the tie segment).
    if (aIn && (!out.length || !same(out[out.length - 1]!, a))) out.push(a);
    if (aIn !== bIn) {
      const c = cross(a, b);
      if (!out.length || !same(out[out.length - 1]!, c)) out.push(c);
    }
  }
  if (out.length > 1 && same(out[0]!, out[out.length - 1]!)) out.pop();
  return out;
};

/** Clip a world-XY polygon to every half-plane bound (in order). */
export const clipPolygonToBounds = (
  polygon: SectorPoint[],
  bounds: Array<{ line: SectorLine; keep: SectorPoint }>,
): SectorPoint[] => {
  let current = polygon;
  for (const bound of bounds) {
    current = clipPolygonToHalfPlane(current, bound.line, bound.keep);
    if (current.length < 3) return [];
  }
  return current;
};

interface TargetPlane {
  a: number;
  b: number;
  c: number;
}

/** Affine world-XY plane through three target vertices; null when degenerate. */
const targetPlaneAt = (
  target: GradingTargetMeshSnapshot,
  triIndex: number,
): TargetPlane | null => {
  const vi = [target.triangles[triIndex * 3]!, target.triangles[triIndex * 3 + 1]!, target.triangles[triIndex * 3 + 2]!];
  const p = vi.map((v) => ({ x: target.points[v * 3]!, y: target.points[v * 3 + 1]!, z: target.points[v * 3 + 2]! }));
  const [p0, p1, p2] = p as [typeof p[0], typeof p[0], typeof p[0]];
  const det = (p1.x - p0.x) * (p2.y - p0.y) - (p2.x - p0.x) * (p1.y - p0.y);
  if (Math.abs(det) <= zeroDelta(det, 0)) return null;
  const a = ((p1.z - p0.z) * (p2.y - p0.y) - (p2.z - p0.z) * (p1.y - p0.y)) / det;
  const b = ((p1.x - p0.x) * (p2.z - p0.z) - (p2.x - p0.x) * (p1.z - p0.z)) / det;
  return { a, b, c: p0.z - a * p0.x - b * p0.y };
};

/** Plan-only ray/triangle crossing interval as [tEnter, tExit], or null. */
const rayTriangleInterval = (
  target: GradingTargetMeshSnapshot,
  triIndex: number,
  ox: number,
  oy: number,
  mx: number,
  my: number,
): [number, number] | null => {
  let tEnter = -Infinity;
  let tExit = Infinity;
  for (let e = 0; e < 3; e += 1) {
    const va = target.triangles[triIndex * 3 + e]!;
    const vb = target.triangles[triIndex * 3 + ((e + 1) % 3)]!;
    const ax = target.points[va * 3]!;
    const ay = target.points[va * 3 + 1]!;
    const bx = target.points[vb * 3]!;
    const by = target.points[vb * 3 + 1]!;
    // Inward normal (left side) of the CCW edge.
    const ex = bx - ax;
    const ey = by - ay;
    const nx = -ey;
    const ny = ex;
    const num = nx * (ax - ox) + ny * (ay - oy);
    const denom = nx * mx + ny * my;
    if (Math.abs(denom) <= zeroDelta(denom, 0)) {
      // Parallel edge: the ray runs alongside the edge half-plane. Reject
      // only when strictly outside (num > +eps, i.e. origin beyond the
      // inward normal); grazing/inside (num <= +eps) stays eligible.
      if (num > zeroDelta(num, 0)) return null;
      continue;
    }
    const t = num / denom;
    if (denom > 0) tEnter = Math.max(tEnter, t);
    else tExit = Math.min(tExit, t);
    if (tEnter > tExit + zeroDelta(tEnter, tExit)) return null;
  }
  return [tEnter, tExit];
};

export type MiterTieResult =
  | { ok: true; t: number; x: number; y: number; z: number; rootCount: number }
  | { ok: false; code: 'CORNER_TARGET_GAP' | 'CORNER_BRANCH_DISCONTINUITY' | 'CORNER_NO_SOLUTION' };

const planeZ = (plane: CornerGradingPlane, x: number, y: number): number =>
  plane.zAtV + plane.gx * (x - plane.ax) + plane.gy * (y - plane.ay);

/**
 * Closed-form 1D miter tie: per candidate triangle crossed by the ray
 * segment [0, tMax], solve affine grading-plane == affine target-plane for
 * t. Nearest valid outward root wins; the count of distinct roots is
 * reported. Void-blocked rays and agreement failures fail closed (the 20B
 * agreement floor is never loosened for fractional corner nodes).
 */
export const solveMiterTie = (
  target: GradingTargetMeshSnapshot,
  candidates: number[],
  query: TargetQuery,
  plane: CornerGradingPlane,
  vx: number,
  vy: number,
  mx: number,
  my: number,
  tMax: number,
): MiterTieResult => {
  const roots: number[] = [];
  for (const triIndex of candidates) {
    const interval = rayTriangleInterval(target, triIndex, vx, vy, mx, my);
    if (!interval) continue;
    const lo = Math.max(interval[0], 0);
    const hi = Math.min(interval[1], tMax);
    if (hi < lo - zeroDelta(hi, lo)) continue;
    const tpl = targetPlaneAt(target, triIndex);
    if (!tpl) continue;
    // Affine in t: (plane - target) == 0.
    const p0 = planeZ(plane, vx + mx * lo, vy + my * lo) - (tpl.a * (vx + mx * lo) + tpl.b * (vy + my * lo) + tpl.c);
    const p1 = planeZ(plane, vx + mx * hi, vy + my * hi) - (tpl.a * (vx + mx * hi) + tpl.b * (vy + my * hi) + tpl.c);
    if (Math.abs(p1 - p0) <= zeroDelta(p1, p0)) {
      if (Math.abs(p0) <= zeroDelta(p0, 0)) roots.push(lo);
      continue;
    }
    if ((p0 > 0) === (p1 > 0)) {
      if (Math.abs(p0) <= zeroDelta(p0, 0)) roots.push(lo);
      continue;
    }
    roots.push(lo + (hi - lo) * (p0 / (p0 - p1)));
  }
  roots.sort((a, b) => a - b);
  const distinct: number[] = [];
  for (const t of roots) {
    const prev = distinct[distinct.length - 1];
    if (prev === undefined || Math.abs(t - prev) > zeroDelta(t, prev)) distinct.push(t);
  }
  if (distinct.length === 0) {
    // No root: distinguish target void from genuinely unsolved.
    const probes = [0, tMax / 2, tMax].map((t) => query.elevationAt(vx + mx * t, vy + my * t));
    if (probes.some((z) => z === null)) return { ok: false, code: 'CORNER_TARGET_GAP' };
    return { ok: false, code: 'CORNER_NO_SOLUTION' };
  }
  const t = distinct[0]!;
  const x = vx + mx * t;
  const y = vy + my * t;
  const zt = query.elevationAt(x, y);
  if (zt === null) return { ok: false, code: 'CORNER_TARGET_GAP' };
  const zg = planeZ(plane, x, y);
  if (Math.abs(zt - zg) > zeroDelta(zt, zg)) return { ok: false, code: 'CORNER_BRANCH_DISCONTINUITY' };
  return { ok: true, t, x, y, z: zg, rootCount: distinct.length };
};

export type SectorPathResult =
  | { ok: true; path: Array<{ x: number; y: number; z: number }>; segmentCount: number }
  | { ok: false; code: 'CORNER_NO_SOLUTION' | 'CORNER_AMBIGUOUS' | 'CORNER_TARGET_GAP' };

/**
 * Sector daylight path: clip every candidate triangle to the sector bounds,
 * extract the target-minus-grading zero locus per clipped polygon, snap to
 * the 20B 1e-12 conditioning grid, and walk the deterministic local graph
 * from the member daylight endpoint Q to the miter tie. Exactly one
 * continuous path is valid; branches and dead ends fail closed.
 */
export const solveSectorPath = (
  target: GradingTargetMeshSnapshot,
  candidates: number[],
  query: TargetQuery,
  plane: CornerGradingPlane,
  bounds: Array<{ line: SectorLine; keep: SectorPoint }>,
  from: { x: number; y: number; z: number },
  tie: { x: number; y: number; z: number },
): SectorPathResult => {
  if (
    Math.abs(from.x - tie.x) <= zeroDelta(from.x, tie.x) &&
    Math.abs(from.y - tie.y) <= zeroDelta(from.y, tie.y)
  ) {
    return { ok: true, path: [{ ...from }], segmentCount: 0 };
  }
  const adjacency = new Map<string, string[]>();
  const coordByKey = new Map<string, { x: number; y: number }>();
  let segmentCount = 0;
  const link = (ax: number, ay: number, bx: number, by: number): void => {
    const ka = sectorKey(ax, ay);
    const kb = sectorKey(bx, by);
    if (ka === kb) return;
    if (!coordByKey.has(ka)) coordByKey.set(ka, { x: snap12(ax), y: snap12(ay) });
    if (!coordByKey.has(kb)) coordByKey.set(kb, { x: snap12(bx), y: snap12(by) });
    const la = adjacency.get(ka) ?? [];
    if (!la.includes(kb)) la.push(kb);
    adjacency.set(ka, la);
    const lb = adjacency.get(kb) ?? [];
    if (!lb.includes(ka)) lb.push(ka);
    adjacency.set(kb, lb);
    segmentCount += 1;
  };
  for (const triIndex of candidates) {
    const raw: SectorPoint[] = [0, 1, 2].map((k) => {
      const v = target.triangles[triIndex * 3 + k]!;
      return { x: target.points[v * 3]!, y: target.points[v * 3 + 1]! };
    });
    const clipped = clipPolygonToBounds(raw, bounds);
    if (clipped.length < 3) continue;
    const withDelta = clipped.map((p) => ({ u: p.x, d: p.y, delta: 0 }));
    // Delta needs the target Z at the clipped XY: barycentric on the source
    // triangle keeps the affine field exact after clipping.
    const tpl = targetPlaneAt(target, triIndex);
    if (!tpl) continue;
    for (const vertex of withDelta) {
      vertex.delta = tpl.a * vertex.u + tpl.b * vertex.d + tpl.c - planeZ(plane, vertex.u, vertex.d);
    }
    const locus = extractZeroSegments(withDelta, true);
    for (const s of locus.segments) link(s.u0, s.d0, s.u1, s.d1);
  }
  if (segmentCount === 0) {
    const probe = query.elevationAt((from.x + tie.x) / 2, (from.y + tie.y) / 2);
    if (probe === null) return { ok: false, code: 'CORNER_TARGET_GAP' };
    return { ok: false, code: 'CORNER_NO_SOLUTION' };
  }
  const startKey = sectorKey(from.x, from.y);
  const tieKey = sectorKey(tie.x, tie.y);
  if (!adjacency.has(startKey) || !adjacency.has(tieKey)) {
    return { ok: false, code: 'CORNER_NO_SOLUTION' };
  }
  // Deterministic walk: sorted neighbors, dead ends and branches fail closed.
  const pathKeys = [startKey];
  const used = new Set<string>();
  let current = startKey;
  for (;;) {
    if (current === tieKey) break;
    const neighbors = [...(adjacency.get(current) ?? [])].sort();
    const fresh = neighbors.filter((n) => !used.has(`${current}|${n}`) && !used.has(`${n}|${current}`));
    // Never step back onto the walked prefix (except tie arrival).
    const forward = fresh.filter((n) => !pathKeys.includes(n) || n === tieKey);
    if (forward.length === 0) return { ok: false, code: 'CORNER_NO_SOLUTION' };
    if (forward.length > 1) return { ok: false, code: 'CORNER_AMBIGUOUS' };
    const next = forward[0]!;
    used.add(`${current}|${next}`);
    pathKeys.push(next);
    current = next;
    if (pathKeys.length > segmentCount + 2) return { ok: false, code: 'CORNER_AMBIGUOUS' };
  }
  const path = pathKeys.map((key) => {
    const c = coordByKey.get(key)!;
    return { x: c.x, y: c.y, z: planeZ(plane, c.x, c.y) };
  });
  // Every corner daylight vertex passes the 20B agreement gate (strict).
  for (const vertex of path) {
    const zt = query.elevationAt(vertex.x, vertex.y);
    if (zt === null) return { ok: false, code: 'CORNER_TARGET_GAP' };
    // Strict 20B-strength agreement: fractional snapped nodes that drift off
    // the locus fail closed here (audit R1); epsilons are never loosened.
    if (Math.abs(zt - vertex.z) > zeroDelta(zt, vertex.z)) {
      return { ok: false, code: 'CORNER_NO_SOLUTION' };
    }
  }
  return { ok: true, path, segmentCount };
};

/**
 * Clip a daylight polyline to a keep half-plane; returns the kept portion
 * (linear crossing inserted). Empty when fully clipped away.
 */
export const clipPolylineToHalfPlane = (
  polyline: Array<{ x: number; y: number; z: number }>,
  line: SectorLine,
  keep: SectorPoint,
): Array<{ x: number; y: number; z: number }> => {
  const keepSide = lineSide(line, keep.x, keep.y);
  const wantPositive = keepSide >= 0;
  const inside = (p: { x: number; y: number }): boolean => {
    const s = lineSide(line, p.x, p.y);
    return wantPositive ? s >= -zeroDelta(s, 0) : s <= zeroDelta(s, 0);
  };
  const out: Array<{ x: number; y: number; z: number }> = [];
  for (let i = 0; i < polyline.length; i += 1) {
    const p = polyline[i]!;
    const pIn = inside(p);
    if (i > 0) {
      const a = polyline[i - 1]!;
      if (inside(a) !== pIn) {
        const sa = lineSide(line, a.x, a.y);
        const sb = lineSide(line, p.x, p.y);
        const t = sa === sb ? 0 : sa / (sa - sb);
        out.push({ x: a.x + (p.x - a.x) * t, y: a.y + (p.y - a.y) * t, z: a.z + (p.z - a.z) * t });
      }
    }
    if (pIn) out.push(p);
  }
  return out;
};
