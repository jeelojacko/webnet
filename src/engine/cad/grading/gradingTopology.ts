/**
 * Phase 20K.1 Wave B1 — grading mesh topology validator (pure, structural).
 *
 * O(V+F+E + V extra·T tied-station scan): finite verts, valid indices,
 * nondegenerate faces, duplicate faces, edge incidence <= 2,
 * edge-adjacent interior-overlap rejection (shared-edge opposite-side
 * check over 2-incidence edges only, NOT O(F²) all-pairs), edge-connected
 * components via union-find, attributed tied-split extras, boundary-edge
 * loop trace. Wave A2 proved E/F/G fixtures are VERTEX_PINCH
 * (8/8/2 INDEX components) yet Bake accepts — this flags those shapes.
 * validateExplicitTinPayload is untouched; no gate wiring here (Wave B2).
 */
import { zeroDelta } from '../surfaces/volume/zero';
import { AGREEMENT_FLOOR, AGREEMENT_OPS } from './gradingGroupSectors';
export const GRADING_ARC_SEAM_NON_MANIFOLD = 'GRADING_ARC_SEAM_NON_MANIFOLD';
export const GRADING_ARC_SEAM_PINCH = 'GRADING_ARC_SEAM_PINCH';
export const GRADING_GROUP_ARC_SEAM_NON_MANIFOLD = 'GRADING_GROUP_ARC_SEAM_NON_MANIFOLD';
export const GRADING_GROUP_ARC_SEAM_PINCH = 'GRADING_GROUP_ARC_SEAM_PINCH';

export type GradingTopologyPoint = { x: number; y: number; z: number };
export type GradingTopologyPoints = GradingTopologyPoint[] | ArrayLike<number>;

export interface GradingTopologyOpts {
  expectedComponents?: number;
  expectedBoundaryLoops?: number;
  /** Vertex indices where a tied split legitimately separates components. */
  tiedSplitStations?: number[];
  /**
   * Phase 20K.1 reviewer fix: flat XYZ tied-station coordinates. Each
   * edge-component beyond `expectedComponents` must contain a station
   * vertex or a vertex within zeroDelta of one of these coordinates,
   * else the mesh fails closed (replaces the old count-only budget).
   */
  tiedSplitCoords?: GradingTopologyPoints;
  scope?: 'arc' | 'group';
}

export interface BoundaryCycleInfo {
  vertices: number[];
  vertexCount: number;
  signedPlanArea: number;
}

export interface GradingTopologyResult {
  ok: boolean;
  code?: string;
  detail?: string;
  components: number;
  boundaryEdges: number;
  /** @deprecated boundary-graph connected-component count; use boundaryComponents. */
  loops: number;
  /** Connected components of the boundary-edge graph (old `loops` semantics). */
  boundaryComponents: number;
  /** Traversed valid boundary cycles (degree-2 closed walks, geometrically simple). */
  boundaryCycles: number;
  cycles: BoundaryCycleInfo[];
  /** Sum of per-face signed plan areas over the final faces. */
  totalPlanArea: number;
}

const toFlat = (points: GradingTopologyPoints): ArrayLike<number> => {
  if (points.length === 0) return points as ArrayLike<number>;
  const first = (points as { 0?: unknown })[0];
  if (typeof first === 'number') return points as ArrayLike<number>;
  const arr = points as GradingTopologyPoint[];
  const flat = new Array(arr.length * 3);
  for (let i = 0; i < arr.length; i += 1) {
    flat[i * 3] = arr[i]!.x;
    flat[i * 3 + 1] = arr[i]!.y;
    flat[i * 3 + 2] = arr[i]!.z;
  }
  return flat;
};

class UnionFind {
  private readonly parent: number[];
  constructor(size: number) {
    this.parent = Array.from({ length: size }, (_, i) => i);
  }
  find(a: number): number {
    const p = this.parent[a]!;
    if (p !== a) this.parent[a] = this.find(p);
    return this.parent[a]!;
  }
  union(a: number, b: number): void {
    const ra = this.find(a);
    const rb = this.find(b);
    if (ra !== rb) this.parent[ra] = rb;
  }
}

const edgeKey = (a: number, b: number): string => (a < b ? `${a}|${b}` : `${b}|${a}`);

const fail = (
  code: string,
  detail: string,
  components: number,
  boundaryEdges: number,
  loops: number,
  extra?: { boundaryCycles?: number; cycles?: BoundaryCycleInfo[]; totalPlanArea?: number },
): GradingTopologyResult => ({
  ok: false, code, detail, components, boundaryEdges, loops,
  boundaryComponents: loops,
  boundaryCycles: extra?.boundaryCycles ?? 0,
  cycles: extra?.cycles ?? [],
  totalPlanArea: extra?.totalPlanArea ?? 0,
});

export interface BoundaryCycleTrace {
  components: number;
  cycles: number[][];
  violations: string[];
}

/**
 * Phase 20K.2 — real boundary-cycle trace over incidence-1 edges.
 * Counts connected components AND traverses each component edge-by-edge
 * (each edge exactly once, return to start, >=3 distinct vertices, no
 * repeated non-closing vertex). Every component vertex must have degree 2;
 * anything else (open end degree-1, branch degree-3+, pinch degree-4) is a
 * violation, not a cycle. Pure graph level, no coordinates.
 */
export const traceBoundaryCycles = (
  boundary: ReadonlyArray<readonly [number, number]>,
): BoundaryCycleTrace => {
  const adj = new Map<number, Array<{ to: number; edge: number }>>();
  boundary.forEach(([a, b], edge) => {
    const la = adj.get(a);
    if (la) la.push({ to: b, edge });
    else adj.set(a, [{ to: b, edge }]);
    const lb = adj.get(b);
    if (lb) lb.push({ to: a, edge });
    else adj.set(b, [{ to: a, edge }]);
  });
  let components = 0;
  const seen = new Set<number>();
  for (const start of adj.keys()) {
    if (seen.has(start)) continue;
    components += 1;
    const stack = [start];
    while (stack.length > 0) {
      const v = stack.pop()!;
      if (seen.has(v)) continue;
      seen.add(v);
      for (const n of adj.get(v) ?? []) if (!seen.has(n.to)) stack.push(n.to);
    }
  }
  const violations: string[] = [];
  for (const [v, links] of adj) {
    if (links.length !== 2) violations.push(`boundary vertex ${v} has degree ${links.length}`);
  }
  if (violations.length > 0) return { components, cycles: [], violations };
  const used = new Array<boolean>(boundary.length).fill(false);
  const cycles: number[][] = [];
  for (let e = 0; e < boundary.length; e += 1) {
    if (used[e]) continue;
    const [s, t] = boundary[e]!;
    used[e] = true;
    const cycle = [s];
    let cur = t;
    let guard = 0;
    while (cur !== s && guard <= boundary.length) {
      cycle.push(cur);
      const next = adj.get(cur)!.find((l) => !used[l.edge]);
      if (!next) break;
      used[next.edge] = true;
      cur = next.to;
      guard += 1;
    }
    if (cur !== s) {
      violations.push(`boundary walk from edge ${e} does not close`);
      continue;
    }
    if (new Set(cycle).size !== cycle.length) {
      violations.push(`boundary cycle reuses vertex (figure-eight at edge ${e})`);
    } else if (cycle.length < 3) {
      violations.push(`boundary cycle has ${cycle.length} distinct vertices (edge ${e})`);
    } else {
      cycles.push(cycle);
    }
  }
  if (used.some((u) => !u)) violations.push('boundary walk leaves edges unused');
  return { components, cycles, violations };
};

const orientTol = (
  ax: number, ay: number, bx: number, by: number, cx: number, cy: number,
): number => {
  const v = (bx - ax) * (cy - ay) - (cx - ax) * (by - ay);
  if (Math.abs(v) <= zeroDelta(v, 0)) return 0;
  return v > 0 ? 1 : -1;
};

/** Bbox containment with zeroDelta slop (matches the 20K.1 audit onSegment). */
const onSegTol = (
  ax: number, ay: number, bx: number, by: number, px: number, py: number,
): boolean =>
  px >= Math.min(ax, bx) - zeroDelta(px, Math.min(ax, bx)) &&
  px <= Math.max(ax, bx) + zeroDelta(px, Math.max(ax, bx)) &&
  py >= Math.min(ay, by) - zeroDelta(py, Math.min(ay, by)) &&
  py <= Math.max(ay, by) + zeroDelta(py, Math.max(ay, by));

/**
/** Plan distance from point to segment (projection clamped). */
const pointSegDist = (
  px: number, py: number,
  s: { ax: number; ay: number; bx: number; by: number },
): number => {
  const dx = s.bx - s.ax;
  const dy = s.by - s.ay;
  const len2 = dx * dx + dy * dy;
  if (len2 === 0) return Math.hypot(px - s.ax, py - s.ay);
  const t = Math.max(0, Math.min(1, ((px - s.ax) * dx + (py - s.ay) * dy) / len2));
  return Math.hypot(px - (s.ax + dx * t), py - (s.ay + dy * t));
};

/** Two-sided arithmetic-duplicate tolerance between plan points. */
const touchTol = (px: number, py: number, qx: number, qy: number): number =>
  dupTol(px, qx) + dupTol(py, qy);

/**
 * Two-sided arithmetic-duplicate budget between coordinates (see collapse).
 * The pure ULP term under-measures a seam station recomputed as `start +
 * t·length` at local-origin coordinates (the 20J hybrid seam measured
 * ~5e-13 vs the ~4.5e-13 ULP sum), so the shared representation floor
 * (AGREEMENT_FLOOR, the same 1 nm contract the corrected DesignPatch
 * simplicity authority uses) is included. Boundary-only: no mesh vertex is
 * moved, and 1 nm stays six orders below any genuine linearization station.
 */
const dupTol = (u: number, v: number): number =>
  AGREEMENT_FLOOR + 2 * AGREEMENT_OPS * Number.EPSILON * Math.max(1, Math.abs(u), Math.abs(v));

/**
 * Drop arithmetic-duplicate boundary micro-edges: consecutive vertices that
 * are the same geometric point computed through different paths (chord
 * rotation+translation vs corner solve, ~R·eps). Each side carries the full
 * AGREEMENT_OPS forward-error budget, so the two-sided comparison doubles
 * it; at |100| that is ~1.4e-12, still nine orders below mm-scale features.
 * Rounding noise, not boundary features. Non-consecutive contacts still
 * flag downstream; never below 3 vertices.
 */
const collapseMicroEdges = (cycle: number[], flat: ArrayLike<number>): number[] => {
  let current = cycle;
  // Uncapped passes: each pass drops exactly one vertex, so this terminates
  // in at most cycle.length passes. A fixed cap starves on seam-noisy
  // boundaries (the all-Surface square carries ~28 ulp micro-edges).
  for (let guard = cycle.length; guard >= 0; guard -= 1) {
    if (current.length <= 3) return current;
    let drop = -1;
    for (let i = 0; i < current.length; i += 1) {
      const v = current[i]!;
      const w = current[(i + 1) % current.length]!;
      const len = Math.hypot(flat[v * 3]! - flat[w * 3]!, flat[v * 3 + 1]! - flat[w * 3 + 1]!);
      const tol = dupTol(flat[v * 3]!, flat[w * 3]!) + dupTol(flat[v * 3 + 1]!, flat[w * 3 + 1]!);
      if (len <= tol) {
        drop = (i + 1) % current.length;
        break;
      }
    }
    if (drop < 0) return current;
    current = current.filter((_, i) => i !== drop);
  }
  return current;
};

/**
 * Geometric validity over authoritative boundary cycles, bounded O(B^2) in
 * the boundary size only (never O(F^2) over faces). Rejects non-adjacent
 * segment crossings, repeated non-closing vertices, collinear overlap,
 * figure-eights, and inter-cycle crossings/touches. The pair test is the
 * boundary-local form of the 20K.1 corrected `segmentsCross` relation
 * (scripts/phase20kHybridArcPairAudit.ts, 9/9 audit cases): strict sign
 * change OR a zero-orient endpoint lying on the other segment. Micro-edge
 * adjacency is resolved before this scan by `collapseMicroEdges`.
 */
const checkBoundaryGeometry = (
  cycles: number[][],
  flat: ArrayLike<number>,
  isTiedVertex: (_v: number) => boolean,
): string | null => {
  // Benign tied-seam touch (CUT/FILL regions meeting at a measure-zero tied
  // station): a tied endpoint of either segment within duplicate tolerance
  // of the other segment, with no untied endpoint lying on the other segment
  // away from the touch (that would be overlap, not a touch). Same-cycle
  // touches never qualify: a simple cycle touching itself is a pinch.
  const tiedTouch = (s: Seg, t: Seg): boolean => {
    const ends: Array<{ v: number; o: Seg }> = [
      { v: s.ai, o: t }, { v: s.bi, o: t }, { v: t.ai, o: s }, { v: t.bi, o: s },
    ];
    const touchPts: number[] = [];
    for (const { v, o } of ends) {
      if (!isTiedVertex(v)) continue;
      const px = flat[v * 3]!;
      const py = flat[v * 3 + 1]!;
      if (pointSegDist(px, py, o) <= touchTol(px, py, o.ax, o.ay)) touchPts.push(v);
    }
    if (touchPts.length === 0) return false;
    for (const { v, o } of ends) {
      if (isTiedVertex(v)) continue;
      const px = flat[v * 3]!;
      const py = flat[v * 3 + 1]!;
      if (!onSegTol(o.ax, o.ay, o.bx, o.by, px, py)) continue;
      if (touchPts.every((c) => Math.hypot(px - flat[c * 3]!, py - flat[c * 3 + 1]!) > touchTol(px, py, flat[c * 3]!, flat[c * 3 + 1]!))) {
        return false;
      }
    }
    return true;
  };
  const pt = (v: number): [number, number] => [flat[v * 3]!, flat[v * 3 + 1]!];
  const idx = new Map<number, number>();
  for (let ci = 0; ci < cycles.length; ci += 1) {
    for (const v of cycles[ci]!) {
      const owner = idx.get(v);
      if (owner !== undefined && owner !== ci) return `vertex ${v} shared by boundary cycles ${owner}/${ci}`;
      idx.set(v, ci);
    }
  }
  for (const [v, ci] of idx) {
    const count = cycles[ci]!.filter((w) => w === v).length;
    if (count > 1) return `vertex ${v} repeats in boundary cycle ${ci}`;
  }
  interface Seg { ci: number; i: number; ai: number; bi: number; ax: number; ay: number; bx: number; by: number }
  const segs: Seg[] = [];
  for (let ci = 0; ci < cycles.length; ci += 1) {
    const c = cycles[ci]!;
    for (let i = 0; i < c.length; i += 1) {
      const [ax, ay] = pt(c[i]!);
      const [bx, by] = pt(c[(i + 1) % c.length]!);
      if (ax === bx && ay === by) return `boundary cycle ${ci} edge ${i} has zero plan length`;
      segs.push({ ci, i, ai: c[i]!, bi: c[(i + 1) % c.length]!, ax, ay, bx, by });
    }
  }
  for (let i = 0; i < segs.length; i += 1) {
    for (let j = i + 1; j < segs.length; j += 1) {
      const s = segs[i]!;
      const t = segs[j]!;
      if (s.ci === t.ci) {
        const n = cycles[s.ci]!.length;
        if (t.i === s.i + 1 || (s.i === 0 && t.i === n - 1)) continue;
      }
      const o1 = orientTol(s.ax, s.ay, s.bx, s.by, t.ax, t.ay);
      const o2 = orientTol(s.ax, s.ay, s.bx, s.by, t.bx, t.by);
      const o3 = orientTol(t.ax, t.ay, t.bx, t.by, s.ax, s.ay);
      const o4 = orientTol(t.ax, t.ay, t.bx, t.by, s.bx, s.by);
      // Strict sign change only: a zero orient is collinearity, never a
      // proper crossing. (The looser `o1 !== o2` form false-positives on
      // exactly-collinear chord chains: consecutive linearization vertices
      // on one straight chord read as crossings.) Zeros go to touch below.
      const transverse = ((o1 === 1 && o2 === -1) || (o1 === -1 && o2 === 1)) &&
        ((o3 === 1 && o4 === -1) || (o3 === -1 && o4 === 1));
      const cross = transverse ||
        (o1 === 0 && onSegTol(s.ax, s.ay, s.bx, s.by, t.ax, t.ay)) ||
        (o2 === 0 && onSegTol(s.ax, s.ay, s.bx, s.by, t.bx, t.by)) ||
        (o3 === 0 && onSegTol(t.ax, t.ay, t.bx, t.by, s.ax, s.ay)) ||
        (o4 === 0 && onSegTol(t.ax, t.ay, t.bx, t.by, s.bx, s.by));
      if (!cross) continue;
      // Genuine interior crossings always fail; cross-cycle endpoint touches
      // at tied stations are the legitimate CUT/FILL tied seam (measure-zero).
      if (!transverse && s.ci !== t.ci && tiedTouch(s, t)) continue;
      return s.ci === t.ci
        ? `boundary cycle ${s.ci} self-crosses at edges ${s.i}/${t.i}`
        : `boundary cycles ${s.ci}/${t.ci} cross at edges ${s.i}/${t.i}`;
    }
  }
  return null;
};

export const validateGradingMeshTopology = (
  points: GradingTopologyPoints,
  triangles: ArrayLike<number>,
  opts: GradingTopologyOpts = {},
): GradingTopologyResult => {
  const group = opts.scope === 'group';
  const NON_MANIFOLD = group ? GRADING_GROUP_ARC_SEAM_NON_MANIFOLD : GRADING_ARC_SEAM_NON_MANIFOLD;
  const PINCH = group ? GRADING_GROUP_ARC_SEAM_PINCH : GRADING_ARC_SEAM_PINCH;
  const flat = toFlat(points);
  const vertexCount = Math.floor(flat.length / 3);
  const faceCount = Math.floor(triangles.length / 3);
  // Ragged/finite guards run BEFORE the empty-mesh early return, so a
  // non-empty ragged buffer can never read as a valid empty mesh.
  if (triangles.length % 3 !== 0) return fail(NON_MANIFOLD, 'ragged index buffer', 0, 0, 0);
  for (let i = 0; i < triangles.length; i += 1) {
    const pre = triangles[i]!;
    if (typeof pre !== 'number' || !Number.isInteger(pre) || pre < 0) {
      return fail(NON_MANIFOLD, `bad index ${pre} @${i}`, 0, 0, 0);
    }
  }
  const empty: GradingTopologyResult = { ok: true, components: 0, boundaryEdges: 0, loops: 0, boundaryComponents: 0, boundaryCycles: 0, cycles: [], totalPlanArea: 0 }; 
  if (faceCount === 0) return empty;
  if (flat.length % 3 !== 0 || vertexCount < 3) {
    return fail(NON_MANIFOLD, 'non-finite-or-short vertex buffer', 0, 0, 0);
  }
  for (let i = 0; i < flat.length; i += 1) {
    if (typeof flat[i] !== 'number' || !Number.isFinite(flat[i])) {
      return fail(NON_MANIFOLD, `non-finite vertex @${i}`, 0, 0, 0);
    }
  }
  for (let i = 0; i < triangles.length; i += 1) {
    if (triangles[i]! >= vertexCount) {
      return fail(NON_MANIFOLD, `bad index ${triangles[i]} @${i}`, 0, 0, 0);
    }
  }
  const seenFaces = new Set<string>();
  let totalPlanArea = 0;
  for (let f = 0; f < faceCount; f += 1) {
    const a = triangles[f * 3]!;
    const b = triangles[f * 3 + 1]!;
    const c = triangles[f * 3 + 2]!;
    if (a === b || b === c || c === a) return fail(NON_MANIFOLD, `degenerate face ${f}`, 0, 0, 0);
    const ax = flat[a * 3]!;
    const ay = flat[a * 3 + 1]!;
    const bx = flat[b * 3]!;
    const by = flat[b * 3 + 1]!;
    const cx = flat[c * 3]!;
    const cy = flat[c * 3 + 1]!;
    const doubleArea = (bx - ax) * (cy - ay) - (cx - ax) * (by - ay);
    if (doubleArea === 0) {
      return fail(NON_MANIFOLD, `zero-area face ${f}`, 0, 0, 0);
    }
    if (doubleArea < 0) {
      return fail(NON_MANIFOLD, `negative-area face ${f}`, 0, 0, 0);
    }
    totalPlanArea += doubleArea / 2;
    const canon = [a, b, c].sort((x, y) => x - y).join('|');
    if (seenFaces.has(canon)) return fail(NON_MANIFOLD, `duplicate face ${f}`, 0, 0, 0);
    seenFaces.add(canon);
  }
  const incidence = new Map<string, number[]>();
  for (let f = 0; f < faceCount; f += 1) {
    const tri = [triangles[f * 3]!, triangles[f * 3 + 1]!, triangles[f * 3 + 2]!];
    for (let e = 0; e < 3; e += 1) {
      const key = edgeKey(tri[e]!, tri[(e + 1) % 3]!);
      const entry = incidence.get(key);
      if (entry) {
        entry.push(f);
        if (entry.length > 2) return fail(NON_MANIFOLD, `edge ${key} shared by >2 faces`, 0, 0, 0);
      } else incidence.set(key, [f]);
    }
  }
  // Interior-overlap rejection, O(E): for edge-adjacent face pairs the
  // two opposite vertices must lie on opposite plan sides of the shared
  // edge (same-side pairs double-cover plan area). Only edge-adjacent
  // pairs are checked, NOT O(F²) all-pairs. zeroDelta floor reused, and a
  // vertex within AGREEMENT_FLOOR (existing 1nm multi-stage residual
  // bound, no new tolerance) of the edge line counts as on-line: its side
  // is rounding noise, not a verifiable fold. Macroscopic same-side pairs
  // (reviewer [0,1,2],[0,1,3]) still fail closed.
  // ponytail: sub-nm folds pass as on-line; tighten only with a measured smaller residual bound.
  const orientPlan = (ax: number, ay: number, bx: number, by: number, cx: number, cy: number): number => {
    const v = (bx - ax) * (cy - ay) - (cx - ax) * (by - ay);
    if (Math.abs(v) <= zeroDelta(v, 0)) return 0;
    return v > 0 ? 1 : -1;
  };
  for (const [key, members] of incidence) {
    if (members.length !== 2) continue;
    const [ea, eb] = key.split('|').map(Number) as [number, number];
    const opposite = (f: number): number => {
      for (let k = 0; k < 3; k += 1) {
        const v = triangles[f * 3 + k]!;
        if (v !== ea && v !== eb) return v;
      }
      return -1;
    };
    const o1 = opposite(members[0]!);
    const o2 = opposite(members[1]!);
    const s1 = orientPlan(flat[ea * 3]!, flat[ea * 3 + 1]!, flat[eb * 3]!, flat[eb * 3 + 1]!, flat[o1 * 3]!, flat[o1 * 3 + 1]!);
    const s2 = orientPlan(flat[ea * 3]!, flat[ea * 3 + 1]!, flat[eb * 3]!, flat[eb * 3 + 1]!, flat[o2 * 3]!, flat[o2 * 3 + 1]!);
    const raw = (o: number): number =>
      (flat[eb * 3]! - flat[ea * 3]!) * (flat[o * 3 + 1]! - flat[ea * 3 + 1]!) -
      (flat[o * 3]! - flat[ea * 3]!) * (flat[eb * 3 + 1]! - flat[ea * 3 + 1]!);
    const r1 = raw(o1);
    const r2 = raw(o2);
    const edgeLen = Math.hypot(flat[eb * 3]! - flat[ea * 3]!, flat[eb * 3 + 1]! - flat[ea * 3 + 1]!);
    if (edgeLen > 0 && Math.abs(r1) / edgeLen > AGREEMENT_FLOOR && Math.abs(r2) / edgeLen > AGREEMENT_FLOOR) {
      if (s1 !== 0 && s1 === s2) return fail(PINCH, `overlapping-connected-faces edge ${key}`, 0, 0, 0);
    }
  }
  const faces = new UnionFind(faceCount);
  const boundary: Array<[number, number]> = [];
  for (const [key, members] of incidence) {
    if (members.length === 2) faces.union(members[0]!, members[1]!);
    else {
      const [a, b] = key.split('|').map(Number) as [number, number];
      boundary.push([a, b]);
    }
  }
  const roots = new Set<number>();
  for (let f = 0; f < faceCount; f += 1) roots.add(faces.find(f));
  const components = roots.size;
  // Station attribution (needed by boundary geometry for the tied-seam
  // touch rule as well as the component budget): a vertex proves a split
  // only when it is a declared station or sits within zeroDelta of tied
  // coordinates.
  const tied = new Set(opts.tiedSplitStations ?? []);
  const tiedFlat = toFlat(opts.tiedSplitCoords ?? []);
  const tiedCoordCount = Math.floor(tiedFlat.length / 3);
  const nearTied = (v: number): boolean => {
    if (tied.has(v)) return true;
    const vx = flat[v * 3]!;
    const vy = flat[v * 3 + 1]!;
    const vz = flat[v * 3 + 2]!;
    for (let i = 0; i < tiedCoordCount; i += 1) {
      if (
        Math.abs(vx - tiedFlat[i * 3]!) <= zeroDelta(vx, tiedFlat[i * 3]!) &&
        Math.abs(vy - tiedFlat[i * 3 + 1]!) <= zeroDelta(vy, tiedFlat[i * 3 + 1]!) &&
        Math.abs(vz - tiedFlat[i * 3 + 2]!) <= zeroDelta(vz, tiedFlat[i * 3 + 2]!)
      ) return true;
    }
    return false;
  };
  // Phase 20K.2: real cycle analysis replaces connected-component counting.
  // `loops` (deprecated) keeps the old component-count semantics; validity
  // and expectedBoundaryLoops now use the traversed boundaryCycles.
  const trace = traceBoundaryCycles(boundary);
  const boundaryComponents = trace.components;
  if (trace.violations.length > 0) {
    return fail(PINCH, `boundary not simple cycles: ${trace.violations[0]}`, components, boundary.length, boundaryComponents);
  }
  const shoelace = (cycle: number[]): number => {
    let sum = 0;
    for (let i = 0; i < cycle.length; i += 1) {
      const p = cycle[i]!;
      const q = cycle[(i + 1) % cycle.length]!;
      sum += flat[p * 3]! * flat[q * 3 + 1]! - flat[q * 3]! * flat[p * 3 + 1]!;
    }
    return sum / 2;
  };
  const traced = trace.cycles.map((c) => collapseMicroEdges(c, flat));
  const cycles: BoundaryCycleInfo[] = traced.map((vertices) => ({
    vertices,
    vertexCount: vertices.length,
    signedPlanArea: shoelace(vertices),
  }));
  const boundaryCycles = cycles.length;
  const cycleExtra = { boundaryCycles, cycles, totalPlanArea };
  const defect = checkBoundaryGeometry(traced, flat, nearTied);
  if (defect !== null) {
    return fail(PINCH, defect, components, boundary.length, boundaryComponents, cycleExtra);
  }
  const expectedComponents = opts.expectedComponents ?? 1;
  if (components !== expectedComponents) {
    // Deterministic extras: components ordered by smallest face index;
    // the first `expected` are expected, every extra needs a tied vertex.
    if (components > expectedComponents && (tied.size > 0 || tiedCoordCount > 0)) {
      const compMin = new Map<number, number>();
      const compVerts = new Map<number, number[]>();
      for (let f = 0; f < faceCount; f += 1) {
        const root = faces.find(f);
        const m = compMin.get(root);
        if (m === undefined || f < m) compMin.set(root, f);
        for (let k = 0; k < 3; k += 1) {
          const v = triangles[f * 3 + k]!;
          const list = compVerts.get(root);
          if (list) list.push(v);
          else compVerts.set(root, [v]);
        }
      }
      const ordered = [...roots].sort((p, q) => compMin.get(p)! - compMin.get(q)!);
      let attributed = true;
      for (const root of ordered.slice(expectedComponents)) {
        if (!(compVerts.get(root) ?? []).some(nearTied)) {
          attributed = false;
          break;
        }
      }
      if (attributed) {
        if (opts.expectedBoundaryLoops !== undefined && boundaryCycles !== opts.expectedBoundaryLoops) {
          return fail(PINCH, `cycle count ${boundaryCycles} != expected ${opts.expectedBoundaryLoops}`, components, boundary.length, boundaryComponents, cycleExtra);
        }
        return { ok: true, components, boundaryEdges: boundary.length, loops: boundaryComponents, boundaryComponents, boundaryCycles, cycles, totalPlanArea };
      }
    }
    // Vertex-shared but edge-disjoint components = pinch; fully disjoint = non-manifold.
    const owners = new Map<number, number>();
    let pinch = false;
    for (let f = 0; f < faceCount && !pinch; f += 1) {
      const root = faces.find(f);
      for (let k = 0; k < 3; k += 1) {
        const v = triangles[f * 3 + k]!;
        const owner = owners.get(v);
        if (owner === undefined) owners.set(v, root);
        else if (owner !== root) pinch = true;
      }
    }
    const code = pinch ? PINCH : NON_MANIFOLD;
    return fail(code, `component count ${components} != expected ${expectedComponents}`, components, boundary.length, boundaryComponents, cycleExtra);
  }
  if (opts.expectedBoundaryLoops !== undefined && boundaryCycles !== opts.expectedBoundaryLoops) {
    return fail(PINCH, `cycle count ${boundaryCycles} != expected ${opts.expectedBoundaryLoops}`, components, boundary.length, boundaryComponents, cycleExtra);
  }
  return { ok: true, components, boundaryEdges: boundary.length, loops: boundaryComponents, boundaryComponents, boundaryCycles, cycles, totalPlanArea };
};
