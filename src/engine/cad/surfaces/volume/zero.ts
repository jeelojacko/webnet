/**
 * Phase 18I numerical-zero policy for per-vertex delta Z.
 *
 * zeroDelta = 4·ε·max(1, |baseZ|, |cmpZ|).
 *
 * Justification: each plane evaluation is z = p + q·x + r·y (two
 * multiplications plus additions after a Cramer-rule fit), so rounding of an
 * exactly-identical plane pair can reach a few ulps of |Z|. The
 * identical-plane oracle (different triangulations of the same plane) must
 * yield ~0 cut/fill, which 1–2ε margins do not robustly guarantee once local-
 * frame conditioning and fan interpolation are included; 4ε covers the
 * worst case with margin. It cannot erase real earthwork: at |Z| ≈ 100 m the
 * threshold is ≈ 9e-14 m, orders of magnitude below millimetre survey noise.
 * Vertices within ±zeroDelta snap to exactly 0, so zero-measure regions
 * contribute to overlap area only (never to cut/fill areas or volumes).
 */
export const zeroDelta = (baseZ: number, comparisonZ: number): number =>
  4 * Number.EPSILON * Math.max(1, Math.abs(baseZ), Math.abs(comparisonZ));
