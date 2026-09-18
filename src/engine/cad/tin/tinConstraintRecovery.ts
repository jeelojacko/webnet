import type { TinPoint, TinSegment, TinTriangle } from './tinTypes';
import { ccwSign } from './tinPredicates';

export interface TinRecoveryResult {
  ok: boolean;
  triangles: TinTriangle[];
  /** Steiner midpoints requested (non-convex quads); caller appends + restarts. */
  steiner: TinPoint[];
  /** The segment being recovered when each Steiner point was requested. */
  steinerFor: TinSegment[];
}

interface EdgeEntry {
  key: string;
  p: number;
  q: number;
}

const edgeKey = (p: number, q: number): string => `${Math.min(p, q)}>${Math.max(p, q)}`;

const findEdge = (triangles: TinTriangle[], a: number, b: number): boolean =>
  triangles.some((tri) =>
    [tri.a, tri.b, tri.c].some((v, i, arr) => {
      const w = arr[(i + 1) % 3];
      return (v === a && w === b) || (v === b && w === a);
    }),
  );

const triEdges = (tri: TinTriangle): Array<[number, number]> => [
  [tri.a, tri.b],
  [tri.b, tri.c],
  [tri.c, tri.a],
];

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

/**
 * Sloan-style constrained-edge recovery (own implementation from the
 * literature, not copied from any codebase): each missing breakline segment
 * is recovered by flipping mesh edges that properly cross it. A crossed edge
 * whose quad is strictly convex flips to the other diagonal; a non-convex
 * quad cannot flip, so a Steiner midpoint is requested instead (the caller
 * appends it and restarts — this fallback is mandatory, not optional).
 *
 * Deterministic: segments in input order, smallest crossing-edge key first,
 * bounded iterations, exact predicates throughout.
 */
export const recoverConstrainedEdges = (
  points: TinPoint[],
  triangles: TinTriangle[],
  segments: TinSegment[],
): TinRecoveryResult => {
  let mesh = triangles.map((tri) => ({ ...tri }));
  const steiner: TinPoint[] = [];
  const steinerFor: TinSegment[] = [];
  const requestSteiner = (seg: TinSegment): TinRecoveryResult => {
    steiner.push({
      u: (points[seg.a].u + points[seg.b].u) / 2,
      v: (points[seg.a].v + points[seg.b].v) / 2,
      z: (points[seg.a].z + points[seg.b].z) / 2,
    });
    steinerFor.push({ ...seg });
    return { ok: false, triangles: mesh, steiner, steinerFor };
  };
  const cap = 4 * (mesh.length + segments.length) + 8;

  for (const seg of segments) {
    if (seg.a === seg.b) continue;
    let done = findEdge(mesh, seg.a, seg.b);
    for (let iter = 0; iter < cap && !done; iter += 1) {
      const crossing = new Map<string, EdgeEntry>();
      for (const tri of mesh) {
        for (const [p, q] of triEdges(tri)) {
          if (p === seg.a || p === seg.b || q === seg.a || q === seg.b) continue;
          if (properlyCrosses(points, seg.a, seg.b, p, q)) {
            const key = edgeKey(p, q);
            if (!crossing.has(key)) crossing.set(key, { key, p, q });
          }
        }
      }
      const keys = [...crossing.keys()].sort();
      if (keys.length === 0) {
        done = findEdge(mesh, seg.a, seg.b);
        break;
      }
      const edge = crossing.get(keys[0]) as EdgeEntry;
      const pair = mesh.filter((tri) => {
        const set = new Set([tri.a, tri.b, tri.c]);
        return set.has(edge.p) && set.has(edge.q);
      });
      if (pair.length !== 2) {
        // Hull edge or degenerate adjacency: cannot flip → Steiner.
        return requestSteiner(seg);
      }
      const r = [pair[0].a, pair[0].b, pair[0].c].find((v) => v !== edge.p && v !== edge.q) as number;
      const s = [pair[1].a, pair[1].b, pair[1].c].find((v) => v !== edge.p && v !== edge.q) as number;
      // Quad cycle r -> p -> s -> q; strictly convex = uniform orientation signs.
      const signs = [
        ccwSign(points[r], points[edge.p], points[s]),
        ccwSign(points[edge.p], points[s], points[edge.q]),
        ccwSign(points[s], points[edge.q], points[r]),
        ccwSign(points[edge.q], points[r], points[edge.p]),
      ];
      const convex = signs.every((v) => v > 0) || signs.every((v) => v < 0);
      if (!convex) {
        return requestSteiner(seg);
      }
      mesh = mesh.filter((tri) => tri !== pair[0] && tri !== pair[1]);
      mesh.push(makeCcw(points, r, edge.p, s), makeCcw(points, r, s, edge.q));
      done = findEdge(mesh, seg.a, seg.b);
    }
    if (!findEdge(mesh, seg.a, seg.b)) return { ok: false, triangles: mesh, steiner, steinerFor };
  }
  return { ok: true, triangles: mesh, steiner, steinerFor };
};
