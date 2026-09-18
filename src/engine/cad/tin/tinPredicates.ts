import { orient2d, incircle } from 'robust-predicates';
import type { TinPoint } from './tinTypes';

/**
 * Phase 18F exact-geometry predicates over local-frame points.
 *
 * Measured gotchas (pinned by tests/cad_surface_tin.test.ts):
 * - robust-predicates orient2d returns POSITIVE for math-clockwise triples
 *   (opposite of the Shewchuk/README convention). `ccwSign` negates it so
 *   positive means math-counter-clockwise.
 * - incircle keeps the standard convention: for a math-CCW triangle,
 *   positive means strictly inside, negative outside, zero on-circle.
 */
export const ccwSign = (a: TinPoint, b: TinPoint, c: TinPoint): number =>
  -orient2d(a.u, a.v, b.u, b.v, c.u, c.v);

/** Strictly inside (on-circle excluded → deterministic cocircular handling). */
export const inCircle = (a: TinPoint, b: TinPoint, c: TinPoint, p: TinPoint): boolean =>
  incircle(a.u, a.v, b.u, b.v, c.u, c.v, p.u, p.v) > 0;

export const triangleArea2 = (pts: TinPoint[], a: number, b: number, c: number): number =>
  (pts[b].u - pts[a].u) * (pts[c].v - pts[a].v) -
  (pts[b].v - pts[a].v) * (pts[c].u - pts[a].u);

/**
 * Ray-cast point-in-ring over plain XY rings (single owner — previously
 * duplicated in tinDomainFilter.ts and cadSurfaceRevision.ts; byte-identical
 * logic). Points on an edge or vertex count as inside (deterministic).
 */
export const pointInRing = (x: number, y: number, ring: Array<{ x: number; y: number }>): boolean => {
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
