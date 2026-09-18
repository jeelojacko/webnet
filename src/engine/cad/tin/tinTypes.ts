/**
 * Phase 18F TIN shared types (engine only).
 *
 * Index convention: triangles reference point arrays positionally and are
 * stored math-counter-clockwise (see tinBase normalization — delaunator
 * emits clockwise despite its .d.ts claim).
 */

export interface TinPoint {
  /** Local-frame XY (conditioned; see tinBase). */
  u: number;
  v: number;
  z: number;
}

export interface TinTriangle {
  a: number;
  b: number;
  c: number;
}

export interface TinSegment {
  a: number;
  b: number;
}

export const tinTriangleToTuple = (tri: TinTriangle): [number, number, number] => [tri.a, tri.b, tri.c];
