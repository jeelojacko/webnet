import Delaunator from 'delaunator';
import type { TinPoint, TinTriangle } from './tinTypes';
import { triangleArea2 } from './tinPredicates';

export interface TinBaseInput {
  x: number;
  y: number;
  z: number;
}

export interface TinBaseResult {
  /** Local-frame points (index-aligned with the input order). */
  points: TinPoint[];
  /** Math-CCW, zero-area-free triangles. */
  triangles: TinTriangle[];
  originX: number;
  originY: number;
}

/**
 * Unconstrained Delaunay via delaunator + local-frame conditioning.
 *
 * - Origin subtraction (floor of minX/minY) keeps exact predicates stable at
 *   large state-plane magnitudes; topology is translation-invariant.
 * - delaunator emits CLOCKWISE triangles despite its .d.ts claiming CCW, so
 *   every triangle is normalized to math-CCW here (pinned by test).
 * - Zero-area triangles are rejected (collinear inputs yield none).
 * - Inputs must be exactly XY-deduped (see tinDedupe): delaunator silently
 *   skips duplicate points, which would desync triangle indices.
 */
export const buildTinBase = (input: TinBaseInput[]): TinBaseResult => {
  if (input.length === 0) return { points: [], triangles: [], originX: 0, originY: 0 };
  const originX = Math.floor(Math.min(...input.map((p) => p.x)));
  const originY = Math.floor(Math.min(...input.map((p) => p.y)));
  const points: TinPoint[] = input.map((p) => ({ u: p.x - originX, v: p.y - originY, z: p.z }));
  if (input.length < 3) return { points, triangles: [], originX, originY };

  const delaunay = Delaunator.from(points, (p) => p.u, (p) => p.v);
  const scale = Math.max(1, ...points.flatMap((p) => [Math.abs(p.u), Math.abs(p.v)]));
  const zeroEps = 1e-12 * scale * scale;
  const triangles: TinTriangle[] = [];
  for (let i = 0; i + 2 < delaunay.triangles.length; i += 3) {
    let a = delaunay.triangles[i];
    let b = delaunay.triangles[i + 1];
    let c = delaunay.triangles[i + 2];
    if (a >= points.length || b >= points.length || c >= points.length) continue;
    if (triangleArea2(points, a, b, c) < 0) {
      const tmp = b;
      b = c;
      c = tmp;
    }
    if (Math.abs(triangleArea2(points, a, b, c)) <= zeroEps) continue;
    triangles.push({ a, b, c });
  }
  return { points, triangles, originX, originY };
};
