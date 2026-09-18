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
