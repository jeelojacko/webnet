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

/**
 * Constrained-edge kind codes (derived-mesh flags only — never persisted to
 * the drawing). Priority on overlap: outer > void > breakline (a boundary
 * edge always wins, so flood walls are exactly kinds OUTER/VOID).
 */
export type TinEdgeKindCode = 0 | 1 | 2 | 3;
export const TIN_EDGE_FREE = 0 as TinEdgeKindCode;
export const TIN_EDGE_BREAKLINE = 1 as TinEdgeKindCode;
export const TIN_EDGE_OUTER = 2 as TinEdgeKindCode;
export const TIN_EDGE_VOID = 3 as TinEdgeKindCode;

/** Neighbor triangle opposite vertex 0/1/2; -1 = exterior (hull edge). */
export type TinAdjacency = [number, number, number];
/** Edge-kind triple for the edge opposite vertex 0/1/2. */
export type TinEdgeKinds = [TinEdgeKindCode, TinEdgeKindCode, TinEdgeKindCode];

export const tinTriangleToTuple = (tri: TinTriangle): [number, number, number] => [tri.a, tri.b, tri.c];
