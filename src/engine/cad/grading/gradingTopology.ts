/**
 * Phase 20K.1 Wave B1 — grading mesh topology validator (pure, structural).
 *
 * O(V+F+E): finite verts, valid indices, nondegenerate faces, duplicate
 * faces, edge incidence <= 2, edge-connected components via union-find,
 * boundary-edge loop trace. Wave A2 proved E/F/G fixtures are VERTEX_PINCH
 * (8/8/2 INDEX components) yet Bake accepts — this flags those shapes.
 * validateExplicitTinPayload is untouched; no gate wiring here (Wave B2).
 */
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
   * Phase 20K.1 Wave C2: extra component budget without vertex positions
   * (standalone arc strips report pair-run counts; the merged mesh has
   * already lost source/daylight roles). Additive with tiedSplitStations.
   */
  tiedSplitBudget?: number;
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
  const empty: GradingTopologyResult = { ok: true, components: 0, boundaryEdges: 0, loops: 0 };
  if (faceCount === 0) return empty;
  if (flat.length % 3 !== 0 || vertexCount < 3) {
    return fail(NON_MANIFOLD, 'non-finite-or-short vertex buffer', 0, 0, 0);
  }
  if (triangles.length % 3 !== 0) return fail(NON_MANIFOLD, 'ragged index buffer', 0, 0, 0);
  for (let i = 0; i < flat.length; i += 1) {
    if (typeof flat[i] !== 'number' || !Number.isFinite(flat[i])) {
      return fail(NON_MANIFOLD, `non-finite vertex @${i}`, 0, 0, 0);
    }
  }
  for (let i = 0; i < triangles.length; i += 1) {
    const v = triangles[i]!;
    if (!Number.isInteger(v) || v < 0 || v >= vertexCount) {
      return fail(NON_MANIFOLD, `bad index ${v} @${i}`, 0, 0, 0);
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
  const splitBudget = tied.size + Math.max(0, Math.floor(opts.tiedSplitBudget ?? 0));
  if (components !== expectedComponents) {
    const allowed = expectedComponents + splitBudget;
    if (components <= allowed && splitBudget > 0) {
      if (opts.expectedBoundaryLoops !== undefined && loops !== opts.expectedBoundaryLoops) {
        return fail(PINCH, `loop count ${loops} != expected ${opts.expectedBoundaryLoops}`, components, boundary.length, loops);
      }
      return { ok: true, components, boundaryEdges: boundary.length, loops };
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
