/**
 * Phase 20C Wave-1A — shared frame clip for the grading kernel.
 *
 * Sutherland–Hodgman clip of a (u,d) polygon to the axis rect. Moved
 * verbatim from `src/workers/surfaceGradingCompute.ts` (zero numerical
 * change); exported here because corner sectors reuse the same clip.
 */

/** A point in the source-relative local frame: station u, outward distance d. */
export interface FramePoint {
  u: number;
  d: number;
}

/** Sutherland–Hodgman clip of a (u,d) polygon to the axis rect. */
export const clipRect = (
  polygon: Array<{ u: number; d: number }>,
  uMin: number,
  uMax: number,
  dMax: number,
): Array<{ u: number; d: number }> => {
  const clipEdge = (
    poly: Array<{ u: number; d: number }>,
    inside: (_p: { u: number; d: number }) => boolean,
    cross: (_a: { u: number; d: number }, _b: { u: number; d: number }) => { u: number; d: number },
  ): Array<{ u: number; d: number }> => {
    const out: Array<{ u: number; d: number }> = [];
    for (let i = 0; i < poly.length; i += 1) {
      const a = poly[i]!;
      const b = poly[(i + 1) % poly.length]!;
      const aIn = inside(a);
      const bIn = inside(b);
      if (aIn) out.push(a);
      if (aIn !== bIn) out.push(cross(a, b));
    }
    return out;
  };
  const lerp = (a: number, b: number, t: number): number => a + (b - a) * t;
  const tFor = (a: number, b: number, edge: number): number => (edge - a) / (b - a);
  let poly = polygon;
  poly = clipEdge(poly, (p) => p.u >= uMin, (a, b) => {
    const t = tFor(a.u, b.u, uMin);
    return { u: uMin, d: lerp(a.d, b.d, t) };
  });
  if (poly.length === 0) return poly;
  poly = clipEdge(poly, (p) => p.u <= uMax, (a, b) => {
    const t = tFor(a.u, b.u, uMax);
    return { u: uMax, d: lerp(a.d, b.d, t) };
  });
  if (poly.length === 0) return poly;
  poly = clipEdge(poly, (p) => p.d >= 0, (a, b) => {
    const t = tFor(a.d, b.d, 0);
    return { u: lerp(a.u, b.u, t), d: 0 };
  });
  if (poly.length === 0) return poly;
  poly = clipEdge(poly, (p) => p.d <= dMax, (a, b) => {
    const t = tFor(a.d, b.d, dMax);
    return { u: lerp(a.u, b.u, t), d: dMax };
  });
  return poly;
};
