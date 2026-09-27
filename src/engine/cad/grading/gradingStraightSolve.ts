/**
 * Phase 20B — exact straight source-course daylight solve.
 *
 * Pure numeric core in the source-relative local frame (u = station along the
 * persisted A→B direction, d = outward normal distance). No imports from
 * sibling grading modules: callers map target triangles into this frame and
 * pass numbers only. Every zero classification uses the shared Phase 18I
 * `zeroDelta` policy — no other epsilon.
 */
import { zeroDelta } from '../surfaces/volume/zero';

/** A point in the source-relative local frame: station u, outward distance d, elevation z. */
export interface GradingLocalPoint {
  u: number;
  d: number;
  z: number;
}

/** Affine grading/target plane z = p + q·u + r·d in the local frame. */
export interface TargetPlaneCoeffs {
  p: number;
  q: number;
  r: number;
}

export type PlaneRelation = 'intersecting' | 'parallel' | 'coincident';

const isZeroScalar = (value: number): boolean =>
  Math.abs(value) <= zeroDelta(value, 0);

/**
 * Grading-surface elevation at local (u, d):
 *   Zg(u, d) = Z0 + gs·u + g·d
 * `z0` is the source start elevation, `gs` the source longitudinal grade and
 * `g` the signed outward cross-slope.
 */
export const gradeElevation = (
  z0: number,
  gs: number,
  u: number,
  g: number,
  d: number,
): number => z0 + gs * u + g * d;

/** Plane z = p + q·u + r·d through three local points; null when degenerate in plan. */
export const targetPlaneCoeffs = (
  t0: GradingLocalPoint,
  t1: GradingLocalPoint,
  t2: GradingLocalPoint,
): TargetPlaneCoeffs | null => {
  const du1 = t1.u - t0.u;
  const dd1 = t1.d - t0.d;
  const du2 = t2.u - t0.u;
  const dd2 = t2.d - t0.d;
  const det = du1 * dd2 - du2 * dd1;
  if (isZeroScalar(det)) return null;
  const dz1 = t1.z - t0.z;
  const dz2 = t2.z - t0.z;
  const q = (dz1 * dd2 - dz2 * dd1) / det;
  const r = (du1 * dz2 - du2 * dz1) / det;
  return { p: t0.z - q * t0.u - r * t0.d, q, r };
};

/**
 * Closed-form daylight distance along the outward normal:
 *   d = (Ztarget(P) − Zsource(P)) / (g − gradTarget·N)
 *
 * `deltaAtSource` is target-minus-grading delta at d = 0; `gMinusGradDotN` is
 * the cross-slope difference. Fail-closed `null` when the split is
 * zeroDelta-parallel, when the tie is behind the source (d < 0), or when the
 * tie lies beyond the engineering search limit. `d == 0` and
 * `d == maxSearchDistance` are valid ties.
 */
export const solveDaylightDistance = (
  deltaAtSource: number,
  gMinusGradDotN: number,
  maxSearchDistance: number,
): number | null => {
  if (isZeroScalar(gMinusGradDotN)) return null;
  const raw = deltaAtSource / gMinusGradDotN;
  const d = isZeroScalar(raw) ? 0 : raw;
  if (d < 0) return null;
  if (d > maxSearchDistance) {
    return d - maxSearchDistance <= zeroDelta(d, maxSearchDistance)
      ? maxSearchDistance
      : null;
  }
  return d;
};

/** Relation of the two planes along the outward normal (zeroDelta-exact). */
export const classifyPlaneRelation = (
  deltaAtSource: number,
  gMinusGradDotN: number,
): PlaneRelation => {
  if (!isZeroScalar(gMinusGradDotN)) return 'intersecting';
  return isZeroScalar(deltaAtSource) ? 'coincident' : 'parallel';
};
