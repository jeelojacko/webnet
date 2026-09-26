import type { TinPoint, TinSegment, TinTriangle } from './tinTypes';
import type { TinRecoveryResult } from './tinConstraintRecovery';
import { ccwSign } from './tinPredicates';

/**
 * Phase 18 prototype: exact indexed variant of `recoverConstrainedEdges`.
 *
 * Semantics are intentionally identical to the linear implementation in
 * `tinConstraintRecovery.ts`: same exact predicates, same "smallest
 * crossing-edge key" choice, same non-convex/hull Steiner fallback, same
 * bounded iteration cap, same return shape. Only the data structures change:
 *
 * - `edgeTris`      canonical edge key → owning triangle ids (O(1) has-edge,
 *                   replaces the O(T) `findEdge` scan and the O(T) pair
 *                   filter on every flip).
 * - `buckets`       uniform grid over active unique edge bounding boxes.
 *                   Crossing candidates are edges whose bbox overlaps the
 *                   segment bbox — a necessary condition for a proper
 *                   crossing, so there are ZERO false negatives (bbox
 *                   overlap is a superset of proper crossing).
 *                   ponytail: bbox candidates for a long breakline cover
 *                   most of the mesh, capping the win near ~1/bbox-area.
 *                   Upgrade path: segment-traversal (DDA/supercover) bucket
 *                   insertion or a BVH if long breaklines dominate.
 * - flips update only the flipped diagonal and the six local adjacency
 *                   entries; there is no per-iteration global rebuild.
 *
 * The linear version consumed 79% of surface-compose time (findEdge linear
 * scans); this prototype is not wired into production dispatch.
 */

/** Same canonical key/order as `tinConstraintRecovery` and `tinTopology`. */
const edgeKey = (p: number, q: number): string => `${Math.min(p, q)}>${Math.max(p, q)}`;

const parseEdgeKey = (key: string): [number, number] => {
  const at = key.indexOf('>');
  return [Number(key.slice(0, at)), Number(key.slice(at + 1))];
};

/** Strict proper crossing (shared endpoints / touches excluded via exact zeros). */
const properlyCrosses = (pts: TinPoint[], a: number, b: number, p: number, q: number): boolean => {
  const o1 = ccwSign(pts[p], pts[q], pts[a]);
  const o2 = ccwSign(pts[p], pts[q], pts[b]);
  const o3 = ccwSign(pts[a], pts[b], pts[p]);
  const o4 = ccwSign(pts[a], pts[b], pts[q]);
  return o1 * o2 < 0 && o3 * o4 < 0;
};

const makeCcw = (pts: TinPoint[], a: number, b: number, c: number): TinTriangle =>
  ccwSign(pts[a], pts[b], pts[c]) >= 0 ? { a, b, c } : { a, b: c, c: b };

const edgeKeysOf = (tri: TinTriangle): [string, string, string] => [
  edgeKey(tri.a, tri.b),
  edgeKey(tri.b, tri.c),
  edgeKey(tri.c, tri.a),
];

const thirdVertex = (tri: TinTriangle, p: number, q: number): number =>
  [tri.a, tri.b, tri.c].find((v) => v !== p && v !== q) as number;

/**
 * Grid cell size from the point extent and initial edge count. Mean point
 * spacing times a tuned factor: long query segments still span many cells,
 * so a slightly coarser grid cuts cell-visit overhead without materially
 * changing the candidate count.
 */
const GRID_CELL_FACTOR = 4;

const chooseCellSize = (points: TinPoint[], edgeCount: number): number => {
  if (points.length === 0) return 1;
  let minU = Infinity;
  let maxU = -Infinity;
  let minV = Infinity;
  let maxV = -Infinity;
  for (const p of points) {
    if (p.u < minU) minU = p.u;
    if (p.u > maxU) maxU = p.u;
    if (p.v < minV) minV = p.v;
    if (p.v > maxV) maxV = p.v;
  }
  const span = Math.max(maxU - minU, maxV - minV);
  if (!(span > 0)) return 1;
  return Math.max((GRID_CELL_FACTOR * span) / Math.sqrt(Math.max(1, edgeCount)), span * 1e-6);
};

const cellKey = (ix: number, iy: number): string => `${ix},${iy}`;

const cellSpan = (lo: number, hi: number, cell: number): [number, number] => [
  Math.floor(lo / cell),
  Math.floor(hi / cell),
];

/**
 * Incrementally maintained triangulation state. Triangle ids are monotonic;
 * triangles are stored in a Map so flips touch only local entries.
 */
class IndexedRecovery {
  private readonly points: TinPoint[];
  private readonly cell: number;
  private readonly tris = new Map<number, TinTriangle>();
  private readonly edgeTris = new Map<string, number[]>();
  private readonly buckets = new Map<string, Set<string>>();
  private nextId = 0;

  constructor(points: TinPoint[], triangles: TinTriangle[]) {
    this.points = points;
    for (const tri of triangles) this.addTriangle(tri);
    this.cell = chooseCellSize(points, this.edgeTris.size);
    for (const key of this.edgeTris.keys()) {
      const [p, q] = parseEdgeKey(key);
      this.indexAdd(key, p, q);
    }
  }

  run(segments: TinSegment[]): TinRecoveryResult {
    const steiner: TinPoint[] = [];
    const steinerFor: TinSegment[] = [];
    const cap = 4 * (this.tris.size + segments.length) + 8;
    const requestSteiner = (seg: TinSegment): TinRecoveryResult => {
      steiner.push({
        u: (this.points[seg.a].u + this.points[seg.b].u) / 2,
        v: (this.points[seg.a].v + this.points[seg.b].v) / 2,
        z: (this.points[seg.a].z + this.points[seg.b].z) / 2,
      });
      steinerFor.push({ ...seg });
      return { ok: false, triangles: this.compact(), steiner, steinerFor };
    };

    for (const seg of segments) {
      if (seg.a === seg.b) continue;
      let done = this.hasEdge(seg.a, seg.b);
      for (let iter = 0; iter < cap && !done; iter += 1) {
        const key = this.nextCrossing(seg);
        if (key === null) {
          done = this.hasEdge(seg.a, seg.b);
          break;
        }
        if (!this.flip(key)) return requestSteiner(seg);
        done = this.hasEdge(seg.a, seg.b);
      }
      if (!this.hasEdge(seg.a, seg.b)) {
        return { ok: false, triangles: this.compact(), steiner, steinerFor };
      }
    }
    return { ok: true, triangles: this.compact(), steiner, steinerFor };
  }

  private hasEdge(a: number, b: number): boolean {
    return this.edgeTris.has(edgeKey(a, b));
  }

  /** Smallest canonical key among edges properly crossing `seg`, or null. */
  private nextCrossing(seg: TinSegment): string | null {
    const a = this.points[seg.a];
    const b = this.points[seg.b];
    const [ix0, ix1] = cellSpan(Math.min(a.u, b.u), Math.max(a.u, b.u), this.cell);
    const [iy0, iy1] = cellSpan(Math.min(a.v, b.v), Math.max(a.v, b.v), this.cell);
    const seen = new Set<string>();
    for (let ix = ix0; ix <= ix1; ix += 1) {
      for (let iy = iy0; iy <= iy1; iy += 1) {
        const bucket = this.buckets.get(cellKey(ix, iy));
        if (!bucket) continue;
        for (const key of bucket) seen.add(key);
      }
    }
    let best: string | null = null;
    for (const key of seen) {
      const [p, q] = parseEdgeKey(key);
      if (!properlyCrosses(this.points, seg.a, seg.b, p, q)) continue;
      if (best === null || key < best) best = key;
    }
    return best;
  }

  /** Flip the strictly-convex quad across `key`; false requests a Steiner point. */
  private flip(key: string): boolean {
    const owners = this.edgeTris.get(key);
    if (!owners || owners.length !== 2) return false;
    const id1 = owners[0];
    const id2 = owners[1];
    const t1 = this.tris.get(id1);
    const t2 = this.tris.get(id2);
    if (!t1 || !t2) return false;
    const [p, q] = parseEdgeKey(key);
    const r = thirdVertex(t1, p, q);
    const s = thirdVertex(t2, p, q);
    // Quad cycle r -> p -> s -> q; strictly convex = uniform orientation signs.
    const signs = [
      ccwSign(this.points[r], this.points[p], this.points[s]),
      ccwSign(this.points[p], this.points[s], this.points[q]),
      ccwSign(this.points[s], this.points[q], this.points[r]),
      ccwSign(this.points[q], this.points[r], this.points[p]),
    ];
    if (!(signs.every((v) => v > 0) || signs.every((v) => v < 0))) return false;
    this.removeTriangle(id1);
    this.removeTriangle(id2);
    this.addTriangle(makeCcw(this.points, r, p, s));
    this.addTriangle(makeCcw(this.points, r, s, q));
    this.indexRemove(key, p, q);
    this.indexAdd(edgeKey(r, s), r, s);
    return true;
  }

  private addTriangle(tri: TinTriangle): void {
    const id = this.nextId;
    this.nextId += 1;
    this.tris.set(id, tri);
    for (const key of edgeKeysOf(tri)) {
      const list = this.edgeTris.get(key) ?? [];
      list.push(id);
      this.edgeTris.set(key, list);
    }
  }

  private removeTriangle(id: number): void {
    const tri = this.tris.get(id);
    if (!tri) return;
    for (const key of edgeKeysOf(tri)) {
      const list = this.edgeTris.get(key);
      if (!list) continue;
      const at = list.indexOf(id);
      if (at >= 0) list.splice(at, 1);
      if (list.length === 0) this.edgeTris.delete(key);
    }
    this.tris.delete(id);
  }

  private indexAdd(key: string, p: number, q: number): void {
    const pu = this.points[p];
    const qu = this.points[q];
    const [ix0, ix1] = cellSpan(Math.min(pu.u, qu.u), Math.max(pu.u, qu.u), this.cell);
    const [iy0, iy1] = cellSpan(Math.min(pu.v, qu.v), Math.max(pu.v, qu.v), this.cell);
    for (let ix = ix0; ix <= ix1; ix += 1) {
      for (let iy = iy0; iy <= iy1; iy += 1) {
        const ck = cellKey(ix, iy);
        const bucket = this.buckets.get(ck) ?? new Set<string>();
        bucket.add(key);
        this.buckets.set(ck, bucket);
      }
    }
  }

  private indexRemove(key: string, p: number, q: number): void {
    const pu = this.points[p];
    const qu = this.points[q];
    const [ix0, ix1] = cellSpan(Math.min(pu.u, qu.u), Math.max(pu.u, qu.u), this.cell);
    const [iy0, iy1] = cellSpan(Math.min(pu.v, qu.v), Math.max(pu.v, qu.v), this.cell);
    for (let ix = ix0; ix <= ix1; ix += 1) {
      for (let iy = iy0; iy <= iy1; iy += 1) {
        const ck = cellKey(ix, iy);
        const bucket = this.buckets.get(ck);
        if (!bucket) continue;
        bucket.delete(key);
        if (bucket.size === 0) this.buckets.delete(ck);
      }
    }
  }

  /** Deterministic compaction: ascending (a,b,c). */
  private compact(): TinTriangle[] {
    return [...this.tris.values()].sort(
      (t1, t2) => t1.a - t2.a || t1.b - t2.b || t1.c - t2.c,
    );
  }
}

/**
 * Indexed constrained-edge recovery. Identical contract to
 * `recoverConstrainedEdges` (see `TinRecoveryResult`).
 */
export const recoverConstrainedEdgesIndexed = (
  points: TinPoint[],
  triangles: TinTriangle[],
  segments: TinSegment[],
): TinRecoveryResult => new IndexedRecovery(points, triangles).run(segments);
