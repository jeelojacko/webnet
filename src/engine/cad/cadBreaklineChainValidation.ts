import { ccwSign } from './tin/tinPredicates';
import type { TinPoint } from './tin/tinTypes';

/**
 * Phase 18W breakline chain validation (pure, engine-owned).
 *
 * Ref-level checks need no project context; the geometric self-intersection
 * check runs on resolved XY coordinates. The only predicate used is
 * `ccwSign` (robust-predicates, same convention as `breaklinesCross` in
 * cadSurfaces.ts and the ring checks in tinBoundaries.ts) — no new
 * predicates, no epsilon snap. Segment-pair semantics mirror
 * `illegalContact` in tinBoundaries.ts: a proper crossing, or an endpoint
 * touch without an exact shared vertex, is illegal; shared vertices pass
 * unless a non-shared endpoint spikes back onto the neighbor segment.
 */

/** Any repeated ref in one chain (no closure inference — fail closed). */
export const BREAKLINE_CHAIN_DUPLICATE_REF = 'SURFACE_BREAKLINE_DUPLICATE_REF';
/** Proper crossing of non-adjacent segments without a shared endpoint. */
export const BREAKLINE_CHAIN_SELF_INTERSECT = 'SURFACE_BREAKLINE_SELF_INTERSECT';

/**
 * Ref-list validation: >= 2 non-empty refs, zero repeats (adjacent or
 * otherwise). Null = ok, otherwise a stable reason-code string.
 */
export const validateBreaklineChainRefs = (pointEntityIds: readonly string[]): string | null => {
  if (pointEntityIds.length < 2) return 'SURFACE_BREAKLINE_INVALID';
  const seen = new Set<string>();
  for (const ref of pointEntityIds) {
    if (typeof ref !== 'string' || ref.length === 0) return 'SURFACE_BREAKLINE_INVALID';
    if (seen.has(ref)) return BREAKLINE_CHAIN_DUPLICATE_REF;
    seen.add(ref);
  }
  return null;
};

export interface BreaklineXyPoint {
  x: number;
  y: number;
}

const asTin = (p: BreaklineXyPoint): TinPoint => ({ u: p.x, v: p.y, z: 0 });

const orient = (a: BreaklineXyPoint, b: BreaklineXyPoint, c: BreaklineXyPoint): number =>
  ccwSign(asTin(a), asTin(b), asTin(c));

const onSegInterior = (
  a: BreaklineXyPoint,
  b: BreaklineXyPoint,
  p: BreaklineXyPoint,
): boolean =>
  orient(a, b, p) === 0 &&
  Math.min(a.x, b.x) <= p.x && p.x <= Math.max(a.x, b.x) &&
  Math.min(a.y, b.y) <= p.y && p.y <= Math.max(a.y, b.y) &&
  !((p.x === a.x && p.y === a.y) || (p.x === b.x && p.y === b.y));

const properlyCrosses = (
  a: BreaklineXyPoint,
  b: BreaklineXyPoint,
  c: BreaklineXyPoint,
  d: BreaklineXyPoint,
): boolean => {
  const o1 = orient(c, d, a);
  const o2 = orient(c, d, b);
  const o3 = orient(a, b, c);
  const o4 = orient(a, b, d);
  return o1 * o2 < 0 && o3 * o4 < 0;
};

/**
 * Self-intersection over resolved chain coordinates: any proper crossing or
 * interior endpoint touch between segments that share no exact endpoint.
 * Zero-length segments (distinct refs, identical XY) are skipped exactly as
 * ring checks skip them; the duplicate-XY conflict itself stays the
 * engine's decision during collection.
 */
export const breaklineChainSelfIntersects = (points: readonly BreaklineXyPoint[]): boolean => {
  const segs: Array<{ a: BreaklineXyPoint; b: BreaklineXyPoint }> = [];
  for (let i = 0; i + 1 < points.length; i += 1) {
    const a = points[i]!;
    const b = points[i + 1]!;
    if (a.x !== b.x || a.y !== b.y) segs.push({ a, b });
  }
  const sharesVertex = (
    s1: { a: BreaklineXyPoint; b: BreaklineXyPoint },
    s2: { a: BreaklineXyPoint; b: BreaklineXyPoint },
  ): boolean =>
    (s1.a.x === s2.a.x && s1.a.y === s2.a.y) ||
    (s1.a.x === s2.b.x && s1.a.y === s2.b.y) ||
    (s1.b.x === s2.a.x && s1.b.y === s2.a.y) ||
    (s1.b.x === s2.b.x && s1.b.y === s2.b.y);
  for (let i = 0; i < segs.length; i += 1) {
    for (let j = i + 1; j < segs.length; j += 1) {
      const s1 = segs[i]!;
      const s2 = segs[j]!;
      if (properlyCrosses(s1.a, s1.b, s2.a, s2.b)) return true;
      if (sharesVertex(s1, s2)) {
        const others1 = s1.a.x === s2.a.x && s1.a.y === s2.a.y
          ? [s1.b]
          : s1.b.x === s2.a.x && s1.b.y === s2.a.y
            ? [s1.a]
            : [s1.a, s1.b];
        const others2 = s2.a.x === s1.a.x && s2.a.y === s1.a.y
          ? [s2.b]
          : s2.b.x === s1.a.x && s2.b.y === s1.a.y
            ? [s2.a]
            : [s2.a, s2.b];
        if (
          others1.some((p) => onSegInterior(s2.a, s2.b, p)) ||
          others2.some((p) => onSegInterior(s1.a, s1.b, p))
        ) {
          return true;
        }
        continue;
      }
      if (
        onSegInterior(s1.a, s1.b, s2.a) || onSegInterior(s1.a, s1.b, s2.b) ||
        onSegInterior(s2.a, s2.b, s1.a) || onSegInterior(s2.a, s2.b, s1.b)
      ) {
        return true;
      }
    }
  }
  return false;
};
