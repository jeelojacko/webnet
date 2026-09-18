import { orient2d } from 'robust-predicates';
import type {
  TinAdjacency,
  TinEdgeKindCode,
  TinEdgeKinds,
  TinPoint,
  TinTriangle,
} from './tinTypes';
import {
  TIN_EDGE_BREAKLINE,
  TIN_EDGE_FREE,
  TIN_EDGE_OUTER,
  TIN_EDGE_VOID,
} from './tinTypes';
import { pointInRing } from './tinPredicates';

export const tinEdgeKey = (p: number, q: number): string => `${Math.min(p, q)}>${Math.max(p, q)}`;

/** Edge opposite vertex k of (a,b,c): 0→(b,c), 1→(c,a), 2→(a,b). */
const oppositeEdge = (tri: TinTriangle, k: number): [number, number] => {
  const v = [tri.a, tri.b, tri.c];
  return [v[(k + 1) % 3], v[(k + 2) % 3]];
};

export interface TinMeshTopology {
  adjacency: TinAdjacency[];
  edgeKinds: TinEdgeKinds[];
}

/**
 * Materialize triangle adjacency + constrained-edge flags over a triangle
 * list. Deterministic: edge-keyed map, no traversal-order dependence.
 */
export const buildTinTopology = (
  triangles: TinTriangle[],
  constrained: ReadonlyMap<string, TinEdgeKindCode>,
): TinMeshTopology => {
  const byEdge = new Map<string, Array<{ tri: number; k: number }>>();
  triangles.forEach((tri, index) => {
    for (let k = 0; k < 3; k += 1) {
      const [p, q] = oppositeEdge(tri, k);
      const key = tinEdgeKey(p, q);
      const list = byEdge.get(key) ?? [];
      list.push({ tri: index, k });
      byEdge.set(key, list);
    }
  });
  const adjacency: TinAdjacency[] = triangles.map(() => [-1, -1, -1]);
  const edgeKinds: TinEdgeKinds[] = triangles.map(() => [TIN_EDGE_FREE, TIN_EDGE_FREE, TIN_EDGE_FREE]);
  for (const [key, list] of byEdge) {
    const kind = constrained.get(key) ?? TIN_EDGE_FREE;
    for (const { tri, k } of list) {
      edgeKinds[tri][k] = kind;
      if (list.length === 2) {
        const other = list[0].tri === tri ? list[1].tri : list[0].tri;
        adjacency[tri][k] = other;
      }
    }
  }
  return { adjacency, edgeKinds };
};

export interface TinDomainSeed {
  outers: Array<Array<{ x: number; y: number }>>;
  voids: Array<Array<{ x: number; y: number }>>;
}

const WALL = (kind: TinEdgeKindCode): boolean => kind === TIN_EDGE_OUTER || kind === TIN_EDGE_VOID;

/**
 * Exact domain classification by constraint-aware flood fill (see
 * docs/evidence/phase18g-surface-domain-classification.md §3 for the proof).
 * Seeds are centroid-based — exact because enforced boundary constraints make
 * straddling triangles impossible. Returns the retained mask; a triangle is
 * retained iff reached by neither the exterior flood nor any void flood.
 */
export const classifyTinDomain = (
  points: TinPoint[],
  triangles: TinTriangle[],
  constrained: ReadonlyMap<string, TinEdgeKindCode>,
  seeds: TinDomainSeed,
): boolean[] => {
  const { adjacency } = buildTinTopology(triangles, constrained);
  const outReached = new Array<boolean>(triangles.length).fill(false);
  const voidReached = new Array<boolean>(triangles.length).fill(false);
  const outSeeds: number[] = [];
  const voidSeeds: number[] = [];
  triangles.forEach((tri, index) => {
    const cx = (points[tri.a].u + points[tri.b].u + points[tri.c].u) / 3;
    const cy = (points[tri.a].v + points[tri.b].v + points[tri.c].v) / 3;
    if (seeds.outers.length > 0 && !seeds.outers.every((ring) => pointInRing(cx, cy, ring))) {
      outSeeds.push(index);
    } else if (seeds.voids.some((ring) => pointInRing(cx, cy, ring))) {
      voidSeeds.push(index);
    }
  });
  const flood = (starts: number[], reached: boolean[]): void => {
    const stack = [...starts];
    for (const s of starts) reached[s] = true;
    while (stack.length > 0) {
      const t = stack.pop() as number;
      for (let k = 0; k < 3; k += 1) {
        const n = adjacency[t][k];
        if (n < 0 || reached[n]) continue;
        // Walls stop the flood; free + breakline edges are crossed.
        const [p, q] = oppositeEdge(triangles[t], k);
        if (WALL(constrained.get(tinEdgeKey(p, q)) ?? TIN_EDGE_FREE)) continue;
        reached[n] = true;
        stack.push(n);
      }
    }
  };
  flood(outSeeds, outReached);
  flood(voidSeeds, voidReached);
  return triangles.map((_, index) => !outReached[index] && !voidReached[index]);
};

export interface TinMeshValidationInput {
  points: Array<{ x: number; y: number }>;
  triangles: Array<[number, number, number]>;
  adjacency: TinAdjacency[];
  edgeKinds: TinEdgeKinds[];
  segments: Array<{ a: number; b: number; kind: 'breakline' | 'outer' | 'void' }>;
}

const codeOf = (kind: 'breakline' | 'outer' | 'void'): TinEdgeKindCode =>
  kind === 'outer' ? TIN_EDGE_OUTER : kind === 'void' ? TIN_EDGE_VOID : TIN_EDGE_BREAKLINE;

/** Math-CCW signed double area over world XY (negated library convention). */
const area2 = (
  points: Array<{ x: number; y: number }>,
  a: number, b: number, c: number,
): number =>
  -orient2d(points[a].x, points[a].y, points[b].x, points[b].y, points[c].x, points[c].y);

/**
 * Pure structural validator for derived meshes (dev/test): index validity,
 * CCW + positive area, adjacency symmetry + shared-edge consistency,
 * duplicate triangles, constrained-edge presence + flag agreement, and no
 * triangle edge crossing a constrained segment it does not coincide with.
 */
export const validateTinMesh = (input: TinMeshValidationInput): { ok: boolean; errors: string[] } => {
  const errors: string[] = [];
  const { points, triangles, adjacency, edgeKinds, segments } = input;
  if (adjacency.length !== triangles.length) errors.push(`adjacency length ${adjacency.length} != ${triangles.length}`);
  if (edgeKinds.length !== triangles.length) errors.push(`edgeKinds length ${edgeKinds.length} != ${triangles.length}`);

  const edgeOf = (t: number, k: number): [number, number] => {
    const tri = triangles[t];
    return [tri[(k + 1) % 3], tri[(k + 2) % 3]];
  };
  const seen = new Set<string>();
  triangles.forEach((tri, t) => {
    for (const v of tri) {
      if (!Number.isInteger(v) || v < 0 || v >= points.length) {
        errors.push(`tri ${t}: index ${v} out of range`);
      }
    }
    if (new Set(tri).size !== 3) errors.push(`tri ${t}: degenerate indices`);
    if (new Set(tri).size === 3 && area2(points, tri[0], tri[1], tri[2]) <= 0) {
      errors.push(`tri ${t}: not CCW / non-positive area`);
    }
    const key = [...tri].sort((a, b) => a - b).join('>');
    if (seen.has(key)) errors.push(`tri ${t}: duplicate of another triangle`);
    seen.add(key);
  });

  adjacency.forEach((neighbors, t) => {
    neighbors.forEach((n, k) => {
      if (n === -1) return;
      if (!Number.isInteger(n) || n < 0 || n >= triangles.length) {
        errors.push(`tri ${t} edge ${k}: neighbor ${n} out of range`);
        return;
      }
      if (n === t) {
        errors.push(`tri ${t} edge ${k}: self-neighbor`);
        return;
      }
      const [p, q] = edgeOf(t, k);
      const back = adjacency[n].some((m, kk) => {
        if (m !== t) return false;
        const [rp, rq] = edgeOf(n, kk);
        return (rp === p && rq === q) || (rp === q && rq === p);
      });
      if (!back) errors.push(`tri ${t} edge ${k}: asymmetric adjacency with ${n}`);
    });
  });

  // Expected flags: a mesh edge takes the max kind over every constrained
  // segment it lies on (both endpoints exactly on the segment — this covers
  // split recovery, where a long ring edge is enforced as unit pieces).
  // Coverage: each constrained segment must be interval-covered by such edges.
  const orientP = (a: number, b: number, c: number): number => area2(points, a, b, c);
  const onSeg = (x: number, y: number, z: number): boolean =>
    orientP(x, y, z) === 0 &&
    Math.min(points[x].x, points[y].x) <= points[z].x &&
    points[z].x <= Math.max(points[x].x, points[y].x) &&
    Math.min(points[x].y, points[y].y) <= points[z].y &&
    points[z].y <= Math.max(points[x].y, points[y].y);
  const meshEdges = new Map<string, [number, number]>();
  triangles.forEach((tri) => {
    for (let k = 0; k < 3; k += 1) {
      const [p, q] = [tri[(k + 1) % 3], tri[(k + 2) % 3]];
      meshEdges.set(tinEdgeKey(p, q), [p, q]);
    }
  });
  const expected = new Map<string, TinEdgeKindCode>();
  for (const [key, [p, q]] of meshEdges) {
    let want: TinEdgeKindCode = TIN_EDGE_FREE;
    for (const seg of segments) {
      if (onSeg(seg.a, seg.b, p) && onSeg(seg.a, seg.b, q)) {
        const code = codeOf(seg.kind);
        if (code > want) want = code;
      }
    }
    expected.set(key, want);
  }
  triangles.forEach((_, t) => {
    for (let k = 0; k < 3; k += 1) {
      const [p, q] = edgeOf(t, k);
      const want = expected.get(tinEdgeKey(p, q)) ?? TIN_EDGE_FREE;
      if (edgeKinds[t]?.[k] !== want) {
        errors.push(`tri ${t} edge ${k}: flag ${edgeKinds[t]?.[k]} != expected ${want}`);
      }
    }
  });
  for (const seg of segments) {
    const ax = points[seg.a].x;
    const ay = points[seg.a].y;
    const dx = points[seg.b].x - ax;
    const dy = points[seg.b].y - ay;
    const len2 = dx * dx + dy * dy;
    const spans: Array<[number, number]> = [];
    for (const [, [p, q]] of meshEdges) {
      if (!(onSeg(seg.a, seg.b, p) && onSeg(seg.a, seg.b, q))) continue;
      const tp = ((points[p].x - ax) * dx + (points[p].y - ay) * dy) / len2;
      const tq = ((points[q].x - ax) * dx + (points[q].y - ay) * dy) / len2;
      spans.push([Math.min(tp, tq), Math.max(tp, tq)]);
    }
    spans.sort((s1, s2) => s1[0] - s2[0]);
    let reach = 0;
    for (const [t0, t1] of spans) {
      if (t0 <= reach) reach = Math.max(reach, t1);
      else break;
    }
    if (reach < 1) errors.push(`constrained ${seg.kind} edge ${seg.a}>${seg.b} not covered by mesh edges`);
  }

  // No illegal boundary crossing: a mesh edge that does not lie on a
  // constrained segment must not properly cross one. Incidence at a
  // constraint vertex (boundary fans, breakline junctions, split pieces)
  // is legal — only strict crossings are illegal. (Coincident split pieces
  // are skipped — coverage above owns them.)
  const segEnds: Array<[number, number]> = segments.map((s) => [s.a, s.b]);
  const checked = new Set<string>();
  triangles.forEach((tri) => {
    for (let k = 0; k < 3; k += 1) {
      const [p, q] = [tri[(k + 1) % 3], tri[(k + 2) % 3]];
      const key = tinEdgeKey(p, q);
      if (!checked.has(key)) {
        checked.add(key);
        for (const [a, b] of segEnds) {
          if (onSeg(a, b, p) && onSeg(a, b, q)) continue;
          const o1 = orientP(a, b, p);
          const o2 = orientP(a, b, q);
          const o3 = orientP(p, q, a);
          const o4 = orientP(p, q, b);
          if (o1 * o2 < 0 && o3 * o4 < 0) {
            errors.push(`mesh edge ${key} properly crosses constrained ${a}>${b}`);
            break;
          }
        }
      }
    }
  });
  return { ok: errors.length === 0, errors };
};
