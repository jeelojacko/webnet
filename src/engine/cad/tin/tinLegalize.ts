import type { TinPoint, TinTriangle } from './tinTypes';
import { ccwSign, inCircle } from './tinPredicates';

/**
 * Lawson legalization pass: flip non-constrained interior edges that violate
 * the empty-circle property (exact incircle predicate). Constrained breakline
 * edges are never flipped. Deterministic: sorted edge-key scan, bounded
 * passes. Keeps every triangle math-CCW.
 */
export const legalizeTin = (
  points: TinPoint[],
  triangles: TinTriangle[],
  constrained: Set<string>,
): TinTriangle[] => {
  const keyOf = (p: number, q: number): string => `${Math.min(p, q)}>${Math.max(p, q)}`;
  let mesh = triangles.map((tri) => ({ ...tri }));
  const cap = 4 * mesh.length + 8;

  for (let pass = 0; pass < cap; pass += 1) {
    const byEdge = new Map<string, TinTriangle[]>();
    for (const tri of mesh) {
      for (const [p, q] of [[tri.a, tri.b], [tri.b, tri.c], [tri.c, tri.a]] as const) {
        const key = keyOf(p, q);
        const list = byEdge.get(key) ?? [];
        list.push(tri);
        byEdge.set(key, list);
      }
    }
    let flipped = false;
    for (const key of [...byEdge.keys()].sort()) {
      if (constrained.has(key)) continue;
      const pair = byEdge.get(key) as TinTriangle[];
      if (pair.length !== 2) continue;
      const [t1, t2] = pair;
      const [u, v] = key.split('>').map(Number);
      const r = [t1.a, t1.b, t1.c].find((x) => x !== u && x !== v) as number;
      const s = [t2.a, t2.b, t2.c].find((x) => x !== u && x !== v) as number;
      if (r === s) continue;
      // Order (u,v,r) CCW before the incircle test (predicate sign convention).
      const ccwU = ccwSign(points[u], points[v], points[r]) >= 0 ? u : v;
      const ccwV = ccwU === u ? v : u;
      if (!inCircle(points[ccwU], points[ccwV], points[r], points[s])) continue;
      const signs = [
        ccwSign(points[r], points[u], points[s]),
        ccwSign(points[u], points[s], points[v]),
        ccwSign(points[s], points[v], points[r]),
        ccwSign(points[v], points[r], points[u]),
      ];
      if (!(signs.every((x) => x > 0) || signs.every((x) => x < 0))) continue;
      mesh = mesh.filter((tri) => tri !== t1 && tri !== t2);
      const n1 = ccwSign(points[r], points[u], points[s]) >= 0
        ? { a: r, b: u, c: s }
        : { a: r, b: s, c: u };
      const n2 = ccwSign(points[r], points[s], points[v]) >= 0
        ? { a: r, b: s, c: v }
        : { a: r, b: v, c: s };
      mesh.push(n1, n2);
      flipped = true;
      break;
    }
    if (!flipped) break;
  }
  return mesh;
};
