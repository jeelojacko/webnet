import type { TinPoint, TinTriangle } from './tinTypes';
import { triangleArea2 } from './tinPredicates';

export interface TinDomainFilterInput {
  points: TinPoint[];
  triangles: TinTriangle[];
  /** Local-frame outer rings (keep centroid-inside-every-outer). */
  outers: Array<Array<{ x: number; y: number }>>;
  /** Local-frame void rings (drop centroid-inside-any-void). */
  voids: Array<Array<{ x: number; y: number }>>;
  maxEdgeLength?: number;
}

const pointInRing = (x: number, y: number, ring: Array<{ x: number; y: number }>): boolean => {
  let inside = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i, i += 1) {
    const xi = ring[i].x;
    const yi = ring[i].y;
    const xj = ring[j].x;
    const yj = ring[j].y;
    if (yi === yj && y === yi && x >= Math.min(xi, xj) && x <= Math.max(xi, xj)) return true;
    if (yi !== yj && ((yi > y) !== (yj > y))) {
      const xCross = xi + ((xj - xi) * (y - yi)) / (yj - yi);
      if (xCross === x) return true;
      if (x < xCross) inside = !inside;
    }
  }
  return inside;
};

/**
 * Domain filter: outer/void clip on triangle centroids, optional post-build
 * max-edge drop, planimetric area. Pure + deterministic.
 */
export const filterTinDomain = (input: TinDomainFilterInput): {
  triangles: TinTriangle[];
  planimetricArea: number;
} => {
  const { points, outers, voids, maxEdgeLength } = input;
  let triangles = input.triangles.filter((tri) => {
    const cx = (points[tri.a].u + points[tri.b].u + points[tri.c].u) / 3;
    const cy = (points[tri.a].v + points[tri.b].v + points[tri.c].v) / 3;
    if (!outers.every((ring) => pointInRing(cx, cy, ring))) return false;
    if (voids.some((ring) => pointInRing(cx, cy, ring))) return false;
    return true;
  });
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
