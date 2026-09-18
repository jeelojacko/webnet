import type { TinEdgeKindCode, TinPoint, TinTriangle } from './tinTypes';
import { triangleArea2 } from './tinPredicates';
import { classifyTinDomain } from './tinTopology';

export interface TinDomainFilterInput {
  points: TinPoint[];
  triangles: TinTriangle[];
  /** Local-frame outer rings (retain inside-every-outer). */
  outers: Array<Array<{ x: number; y: number }>>;
  /** Local-frame void rings (drop inside-any-void). */
  voids: Array<Array<{ x: number; y: number }>>;
  /** Constrained-edge kinds by `min>max` edge key (breakline/outer/void). */
  constrained: ReadonlyMap<string, TinEdgeKindCode>;
  maxEdgeLength?: number;
}

/**
 * Domain filter: constraint-aware flood fill from exterior across
 * unconstrained edges (outer/void edges stop the flood, voids seeded
 * independently), then the optional post-build max-edge drop, then
 * planimetric area = sum of retained triangles. Pure + deterministic.
 *
 * Exactness argument: boundary rings are enforced mesh edges by the time
 * this runs (recovered in tinBuild), so no triangle straddles a boundary
 * and centroid seeding is exact — see
 * docs/evidence/phase18g-surface-domain-classification.md §3.
 */
export const filterTinDomain = (input: TinDomainFilterInput): {
  triangles: TinTriangle[];
  planimetricArea: number;
} => {
  const { points, outers, voids, constrained, maxEdgeLength } = input;
  const retained = classifyTinDomain(points, input.triangles, constrained, {
    outers,
    voids,
  });
  let triangles = input.triangles.filter((_, index) => retained[index]);
  if (maxEdgeLength != null) {
    triangles = triangles.filter((tri) => {
      const lens = [
        Math.hypot(points[tri.a].u - points[tri.b].u, points[tri.a].v - points[tri.b].v),
        Math.hypot(points[tri.b].u - points[tri.c].u, points[tri.b].v - points[tri.c].v),
        Math.hypot(points[tri.c].u - points[tri.a].u, points[tri.c].v - points[tri.a].v),
      ];
      return lens.every((len) => len <= maxEdgeLength);
    });
  }
  let planimetricArea = 0;
  for (const tri of triangles) planimetricArea += Math.abs(triangleArea2(points, tri.a, tri.b, tri.c)) / 2;
  return { triangles, planimetricArea };
};
