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
import { AGREEMENT_FLOOR } from './gradingGroupSectors';
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

export interface GradingTopologyResult {
  ok: boolean;
  code?: string;
  detail?: string;
  components: number;
  boundaryEdges: number;
  loops: number;
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
): GradingTopologyResult => ({ ok: false, code, detail, components, boundaryEdges, loops });

/** Connected components of the boundary-edge graph (incidence == 1). */
const traceLoops = (boundary: Array<[number, number]>): number => {
  const adj = new Map<number, number[]>();
  const addLink = (a: number, b: number): void => {
    const e = adj.get(a);
    if (e) e.push(b);
    else adj.set(a, [b]);
  };
  for (const [a, b] of boundary) {
    addLink(a, b);
    addLink(b, a);
  }
  let loops = 0;
  const seen = new Set<number>();
  for (const start of adj.keys()) {
    if (seen.has(start)) continue;
    loops += 1;
    const stack = [start];
    while (stack.length > 0) {
      const v = stack.pop()!;
      if (seen.has(v)) continue;
      seen.add(v);
      for (const n of adj.get(v) ?? []) if (!seen.has(n)) stack.push(n);
    }
  }
  return loops;
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
  const empty: GradingTopologyResult = { ok: true, components: 0, boundaryEdges: 0, loops: 0 };
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
    if ((bx - ax) * (cy - ay) - (cx - ax) * (by - ay) === 0) {
      return fail(NON_MANIFOLD, `zero-area face ${f}`, 0, 0, 0);
    }
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
  const loops = traceLoops(boundary);
  const expectedComponents = opts.expectedComponents ?? 1;
  const tied = new Set(opts.tiedSplitStations ?? []);
  const tiedFlat = toFlat(opts.tiedSplitCoords ?? []);
  const tiedCoordCount = Math.floor(tiedFlat.length / 3);
  // Station attribution: a vertex proves a split only when it is a
  // declared station or sits within zeroDelta of tied coordinates.
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
        if (opts.expectedBoundaryLoops !== undefined && loops !== opts.expectedBoundaryLoops) {
          return fail(PINCH, `loop count ${loops} != expected ${opts.expectedBoundaryLoops}`, components, boundary.length, loops);
        }
        return { ok: true, components, boundaryEdges: boundary.length, loops };
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
    return fail(code, `component count ${components} != expected ${expectedComponents}`, components, boundary.length, loops);
  }
  if (opts.expectedBoundaryLoops !== undefined && loops !== opts.expectedBoundaryLoops) {
    return fail(PINCH, `loop count ${loops} != expected ${opts.expectedBoundaryLoops}`, components, boundary.length, loops);
  }
  return { ok: true, components, boundaryEdges: boundary.length, loops };
};
