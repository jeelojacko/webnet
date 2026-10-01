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

/** Same plan node up to one coordinate quantum per axis (shared lens). */
export const samePlanNode = (a: { x: number; y: number }, b: { x: number; y: number }): boolean => {
  const scale = Math.max(1, Math.abs(a.x), Math.abs(b.x), Math.abs(a.y), Math.abs(b.y));
  return (
    Math.abs(a.x - b.x) <= coordinateAgreementTol(a.x, b.x, scale) &&
    Math.abs(a.y - b.y) <= coordinateAgreementTol(a.y, b.y, scale)
  );
};

/**
 * Resolve a graph key for an exact world point. The exact snapped key wins
 * (all currently-passing paths resolve here, bitwise untouched); a grid
 * straddle — same geometric point computed via different arithmetic
 * (wall-crossing interpolation vs chord solve) landing in adjacent 1e-12
 * cells — falls back to the nearest node within one cell plus the
 * single-scale ULP quantum (representation error, coordinate-scaled like
 * the 20J1 agreement bounds), deterministically (nearest, then
 * lexicographic). Anything farther stays fail-closed. The walk +
 * agreement gate still validate the node, so a wrongly-near node is
 * rejected downstream rather than built.
 */
const resolveGraphKey = (
  adjacency: ReadonlyMap<string, string[]>,
  x: number,
  y: number,
): string | null => {
  const exact = sectorKey(x, y);
  if (adjacency.has(exact)) return exact;
  let best: string | null = null;
  let bestDist = Infinity;
  for (const key of adjacency.keys()) {
    const sep = key.indexOf('|');
    const nx = Number(key.slice(0, sep));
    const ny = Number(key.slice(sep + 1));
    if (!Number.isFinite(nx) || !Number.isFinite(ny)) continue;
    const scale = Math.max(1, Math.abs(x), Math.abs(nx), Math.abs(y), Math.abs(ny));
    const bound = 1e-12 + coordinateAgreementTol(nx, x, scale);
    if (Math.abs(nx - x) <= bound && Math.abs(ny - y) <= bound) {
      const dist = Math.hypot(nx - x, ny - y);
      if (dist < bestDist || (dist === bestDist && (best === null || key < best))) {
        best = key;
        bestDist = dist;
      }
    }
  }
  return best;
};

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
  ax: number;
  ay: number;
  zAtAnchor: number;
  gx: number;
  gy: number;
}

/**
 * Affine world-XY plane through three target vertices, ANCHORED at the first
 * vertex; null when degenerate. The intercept form `z = a·x + b·y + c` is
 * forbidden here: `c` is ~|-a·x0 - b·y0| (world magnitude) so evaluating the
 * far-from-origin plane subtracts two ~1e6 terms and loses ~eps·|XY| per
 * evaluation. The anchored form keeps every multiply local to the triangle.
 */
const targetPlaneAt = (
  target: GradingTargetMeshSnapshot,
  triIndex: number,
): TargetPlane | null => {
  const vi = [target.triangles[triIndex * 3]!, target.triangles[triIndex * 3 + 1]!, target.triangles[triIndex * 3 + 2]!];
  const p = vi.map((v) => ({ x: target.points[v * 3]!, y: target.points[v * 3 + 1]!, z: target.points[v * 3 + 2]! }));
  const [p0, p1, p2] = p as [typeof p[0], typeof p[0], typeof p[0]];
  const det = (p1.x - p0.x) * (p2.y - p0.y) - (p2.x - p0.x) * (p1.y - p0.y);
  if (Math.abs(det) <= zeroDelta(det, 0)) return null;
  const gx = ((p1.z - p0.z) * (p2.y - p0.y) - (p2.z - p0.z) * (p1.y - p0.y)) / det;
  const gy = ((p1.x - p0.x) * (p2.z - p0.z) - (p2.x - p0.x) * (p1.z - p0.z)) / det;
  return { ax: p0.x, ay: p0.y, zAtAnchor: p0.z, gx, gy };
};

/** Anchored target-plane elevation at world (x, y). */
const targetPlaneZ = (plane: TargetPlane, x: number, y: number): number =>
  plane.zAtAnchor + plane.gx * (x - plane.ax) + plane.gy * (y - plane.ay);

/**
 * Worst |gx|+|gy| over candidate target planes (degenerate skipped) — the
 * target-field share of world-coordinate representation error in daylight
 * agreement. Single authority for the sector + chord daylight gates.
 */
export const maxTargetGradient = (
  target: GradingTargetMeshSnapshot,
  candidates: readonly number[],
): number => {
  let worst = 0;
  for (const triIndex of candidates) {
    const tpl = targetPlaneAt(target, triIndex);
    if (tpl) worst = Math.max(worst, Math.abs(tpl.gx) + Math.abs(tpl.gy));
  }
  return worst;
};

/**
 * Forward-error agreement contracts for exact-common-tie comparisons.
 *
 * `zeroDelta` (18I) is the *classification* floor and is never loosened. Tie
 * agreement is a different question: it must cover the forward rounding of
 * two independently evaluated quantities. The old generic
 * `zeroDelta(a,b)·max(1,|x|,|y|)` multiplied two world magnitudes
 * (≈4eps·|XY|² for coordinate comparisons), reaching ≈1e-2 at E2M/N7M and
 * erasing mm-scale mismatches. Each contract below bounds exactly one
 * quantity's evaluation with at most ONE world-magnitude scale, so the
 * classification is invariant under translation while genuine mismatches
 * (≥0.1 mm) still fail closed.
 *
 * `AGREEMENT_OPS` is the accumulated rounding budget of one tie evaluation
 * chain (ray interval clip, plane fits, root solve, final world-space add).
 * 32 covers the measured forward error with margin (20J1 evidence §bounds).
 * Exported for the chord daylight gate, which shares the same budget.
 */
export const AGREEMENT_OPS = 32;

/**
 * Absolute floor for anchored elevation agreement (1 nm). The modeled
 * forward error covers the per-stage rounding it can see, but multi-stage
 * chains (local frame + span roots + barycentric over 10–20 m edges)
 * measure up to ~1e-12 locally. The floor absorbs that residual with
 * 1000× headroom while genuine mismatches (mm-scale and up, curved-target
 * sagitta, wrong-side daylight) still fail by orders of magnitude.
 */
export const AGREEMENT_FLOOR = 1e-9;
/** One world evaluation's last-bit spacing: eps·max(1,|coordinate|). */
const coordinateQuantum = (coordinate: number): number =>
  Number.EPSILON * Math.max(1, Math.abs(coordinate));

/** Anchored plane shape shared by grading and target planes. */
export interface AnchoredPlane {
  gx: number;
  gy: number;
  ax: number;
  ay: number;
}

/**
 * Per-axis |gradient|·|world coordinate| leverage of an anchored plane
 * evaluation at (x, y). Single world magnitude per axis; no x·y product.
 */
export const planeLeverage = (plane: AnchoredPlane, x: number, y: number): number[] => [
  Math.abs(plane.gx) * Math.max(1, Math.abs(x), Math.abs(plane.ax)),
  Math.abs(plane.gy) * Math.max(1, Math.abs(y), Math.abs(plane.ay)),
];

/**
 * Phase 20K.3 — single pure anchored elevation-agreement authority, shared by
 * the engine daylight solve (`solveStraightChord.liftDaylightToWorld`) and the
 * worker settlement gate (`validateDaylightAgainstTarget`). `leverage` is the
 * per-axis |gradient|·|coordinate| of every plane whose evaluation contributes
 * to the compared elevations; `gradientSum` is the sum of |gx|+|gy| over those
 * planes (the world-coordinate representation share). Returns the maximum
 * allowed |zA − zB|. The 1 nm `AGREEMENT_FLOOR` is unchanged and the global
 * `zeroDelta` classification floor is never used as the gate.
 */
export const anchoredElevationAgreementTol = (
  zA: number,
  zB: number,
  leverage: readonly number[],
  gradientSum: number,
  x: number,
  y: number,
): number => {
  const worldScale = Math.max(1, Math.abs(x), Math.abs(y));
  return (
    elevationAgreementTol(zA, zB, leverage) +
    gradientSum * AGREEMENT_OPS * Number.EPSILON * worldScale +
    AGREEMENT_FLOOR
  );
};

/** X/Y world-coordinate agreement: single-scale ULP bound (no |x|·|y| term). */
export const coordinateAgreementTol = (
  a: number,
  b: number,
  coordinateScale: number,
): number =>
  AGREEMENT_OPS * Math.max(
    coordinateQuantum(a),
    coordinateQuantum(b),
    coordinateQuantum(coordinateScale),
  );

/**
 * Seam-parameter agreement. `t` is a distance along a unit ray, so a
 * world-coordinate representation error bounds |Δt| directly by the single
 * coordinate quantum of the ray origin (plus the local ray length). No
 * easting·northing product.
 */
export const seamParameterAgreementTol = (
  tSurface: number,
  tAnalytic: number,
  localExtent: number,
  coordinateScale: number,
): number =>
  AGREEMENT_OPS * Math.max(
    Number.EPSILON * Math.max(1, Math.abs(tSurface), Math.abs(tAnalytic), Math.abs(localExtent)),
    coordinateQuantum(coordinateScale),
  );

/**
 * Elevation agreement from the anchored evaluation error:
 * `scale = max(1,|zA|,|zB|) + Σ leverage`, with each `leverage` term a
 * single-axis |gradient|·|world coordinate|. A bare Z-scale misses the plane
 * fit error; a second world-magnitude factor over-bounds it by orders.
 */
export const elevationAgreementTol = (
  zA: number,
  zB: number,
  leverage: readonly number[],
): number => {
  let scale = Math.max(1, Math.abs(zA), Math.abs(zB));
  for (const term of leverage) scale += Math.abs(term);
  return AGREEMENT_OPS * Number.EPSILON * scale;
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
  const roots: Array<{ t: number; plane: TargetPlane }> = [];
  for (const triIndex of candidates) {
    const interval = rayTriangleInterval(target, triIndex, vx, vy, mx, my);
    if (!interval) continue;
    const lo = Math.max(interval[0], 0);
    const hi = Math.min(interval[1], tMax);
    if (hi < lo - zeroDelta(hi, lo)) continue;
    const tpl = targetPlaneAt(target, triIndex);
    if (!tpl) continue;
    // Affine in t: (plane - target) == 0, both anchored at local vertices.
    const xLo = vx + mx * lo;
    const yLo = vy + my * lo;
    const xHi = vx + mx * hi;
    const yHi = vy + my * hi;
    const p0 = planeZ(plane, xLo, yLo) - targetPlaneZ(tpl, xLo, yLo);
    const p1 = planeZ(plane, xHi, yHi) - targetPlaneZ(tpl, xHi, yHi);
    if (Math.abs(p1 - p0) <= zeroDelta(p1, p0)) {
      if (Math.abs(p0) <= zeroDelta(p0, 0)) roots.push({ t: lo, plane: tpl });
      continue;
    }
    if ((p0 > 0) === (p1 > 0)) {
      if (Math.abs(p0) <= zeroDelta(p0, 0)) roots.push({ t: lo, plane: tpl });
      continue;
    }
    roots.push({ t: lo + (hi - lo) * (p0 / (p0 - p1)), plane: tpl });
  }
  roots.sort((a, b) => a.t - b.t);
  const distinct: Array<{ t: number; plane: TargetPlane }> = [];
  for (const root of roots) {
    const prev = distinct[distinct.length - 1];
    if (prev === undefined || Math.abs(root.t - prev.t) > zeroDelta(root.t, prev.t)) distinct.push(root);
  }
  if (distinct.length === 0) {
    // No root: distinguish target void from genuinely unsolved.
    const probes = [0, tMax / 2, tMax].map((t) => query.elevationAt(vx + mx * t, vy + my * t));
    if (probes.some((z) => z === null)) return { ok: false, code: 'CORNER_TARGET_GAP' };
    return { ok: false, code: 'CORNER_NO_SOLUTION' };
  }
  const t = distinct[0]!.t;
  const x = vx + mx * t;
  const y = vy + my * t;
  const zt = query.elevationAt(x, y);
  if (zt === null) return { ok: false, code: 'CORNER_TARGET_GAP' };
  const zg = planeZ(plane, x, y);
  // Quantity-specific elevation agreement (anchor elevation + per-axis
  // gradient leverage), never the generic world-magnitude double scale.
  const targetPlane = distinct[0]!.plane;
  if (Math.abs(zt - zg) > elevationAgreementTol(zt, zg, [
    ...planeLeverage(plane, x, y),
    ...planeLeverage(targetPlane, x, y),
  ])) {
    return { ok: false, code: 'CORNER_BRANCH_DISCONTINUITY' };
  }
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
  // Zero-length sector (daylight already at the tie, e.g. fully-tied
  // joints): same plan node up to one coordinate quantum. Wider than the
  // classification floor by necessity — chord-solve endpoints recompute V
  // through a different arithmetic path (~1e-14 off), and the locus graph
  // of a point-touch holds no walkable segments.
  if (samePlanNode(from, tie)) {
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
      vertex.delta = targetPlaneZ(tpl, vertex.u, vertex.d) - planeZ(plane, vertex.u, vertex.d);
    }
    const locus = extractZeroSegments(withDelta, true);
    for (const s of locus.segments) link(s.u0, s.d0, s.u1, s.d1);
  }
  if (segmentCount === 0) {
    const probe = query.elevationAt((from.x + tie.x) / 2, (from.y + tie.y) / 2);
    if (probe === null) return { ok: false, code: 'CORNER_TARGET_GAP' };
    return { ok: false, code: 'CORNER_NO_SOLUTION' };
  }
  const startKey = resolveGraphKey(adjacency, from.x, from.y);
  const tieKey = resolveGraphKey(adjacency, tie.x, tie.y);
  if (startKey === null || tieKey === null) {
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
  // Every corner daylight vertex passes the agreement gate. Snapped graph
  // nodes sit up to half a 1e-12 conditioning cell off the true locus, so
  // the gate combines the anchored elevation agreement (20J1 single-scale
  // evaluation error) with the grid's plane-evaluation bound: |grad| per
  // axis over the half cell, on the grading plane and (worst over
  // candidates) the target field. Genuinely off-locus vertices
  // (wrong-triangle paths, branches) deviate by orders more and still fail.
  const targetGrad = maxTargetGradient(target, candidates);
  const gridTol = (Math.abs(plane.gx) + Math.abs(plane.gy) + targetGrad) * 0.5e-12;
  for (const vertex of path) {
    const zt = query.elevationAt(vertex.x, vertex.y);
    if (zt === null) return { ok: false, code: 'CORNER_TARGET_GAP' };
    const agree =
      elevationAgreementTol(zt, vertex.z, planeLeverage(plane, vertex.x, vertex.y)) +
      gridTol +
      AGREEMENT_FLOOR;
    if (Math.abs(zt - vertex.z) > agree) {
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
