/**
 * Phase 20C Wave-1B — pure corner geometry for mitered grading groups.
 *
 * Implements mission §§5-6 exactly: grading-plane gradients, the plane-plane
 * miter seam, the fail-closed ray-selection half-plane test, the analytic
 * miter extent, the signed-turn corner classification, and the corner
 * cut/fill relation. No solver, worker, target, or UI coupling: this module
 * touches only the 20B frame/numeric primitives and the shared 18I zero
 * policy. Every degenerate/ambiguous configuration fails closed to null.
 */
import { zeroDelta } from '../surfaces/volume/zero';
import { gradingSideNormal, type PlanVector } from './gradingCourseFrame';
import { gradeElevation } from './gradingStraightSolve';
import type { GradingSide, ResolvedGradingSource } from './gradingTypes';

/** World-XY plane gradient (dZ/dx, dZ/dy). */
export interface WorldGradient {
  gx: number;
  gy: number;
}

/** Planar grading surface anchored at the resolved source start vertex V. */
export interface CornerGradingPlane extends WorldGradient {
  /** Plane elevation at the anchor vertex V (the resolved source start). */
  zAtV: number;
  /** Anchor XY (resolved source start). */
  ax: number;
  ay: number;
}

export type CornerTurn = 'GAP' | 'OVERLAP' | 'TANGENT';
export type CornerCutFill = 'CUT' | 'FILL' | 'TIED';

export type MiterSeamResult = { mx: number; my: number } | { coincident: true } | null;
export type MiterRayResult =
  | { mx: number; my: number }
  | { ambiguous: true }
  | { inverted: true }
  | null;

const isZeroScalar = (value: number): boolean => Math.abs(value) <= zeroDelta(value, 0);

const finiteAll = (values: number[]): boolean => values.every((value) => Number.isFinite(value));

const atLeastZero = (value: number): boolean => value >= -zeroDelta(value, 0);

/** Defensive unit tangent: null on non-finite or zero-length input. */
const unitTangent = (
  startX: number,
  startY: number,
  endX: number,
  endY: number,
): PlanVector | null => {
  if (!finiteAll([startX, startY, endX, endY])) return null;
  const dx = endX - startX;
  const dy = endY - startY;
  const len = Math.hypot(dx, dy);
  if (!(len > 0) || !Number.isFinite(len)) return null;
  return { nx: dx / len, ny: dy / len };
};

/**
 * World grading-plane gradient of a resolved course: `∇P = gs·T + g·N`,
 * anchored through the course start. `zAtV` is the plane elevation at that
 * anchor vertex V; evaluate anywhere else with `planeElevationAt`.
 */
export const gradingPlaneGradient = (
  src: ResolvedGradingSource,
  side: GradingSide,
  gCross: number,
  gsLong: number,
): CornerGradingPlane | null => {
  if (!finiteAll([gCross, gsLong, src.startZ, src.endZ])) return null;
  const t = unitTangent(src.startX, src.startY, src.endX, src.endY);
  if (!t) return null;
  const n = gradingSideNormal(t.nx, t.ny, side);
  if (!n) return null;
  return {
    gx: gsLong * t.nx + gCross * n.nx,
    gy: gsLong * t.ny + gCross * n.ny,
    zAtV: gradeElevation(src.startZ, gsLong, 0, gCross, 0),
    ax: src.startX,
    ay: src.startY,
  };
};

/** Plane elevation at an arbitrary world XY; null on non-finite input. */
export const planeElevationAt = (
  plane: WorldGradient & { zAtV: number; ax: number; ay: number },
  x: number,
  y: number,
): number | null => {
  if (!finiteAll([plane.gx, plane.gy, plane.zAtV, plane.ax, plane.ay, x, y])) return null;
  return plane.zAtV + plane.gx * (x - plane.ax) + plane.gy * (y - plane.ay);
};

/**
 * Plane-plane equality locus direction: `M ⊥ (∇P1 − ∇P2)`, unit. Returns
 * `{coincident:true}` when the gradients are zeroDelta-equal (no independent
 * seam), and null when non-finite.
 */
export const miterSeam = (grad1: WorldGradient, grad2: WorldGradient): MiterSeamResult => {
  if (!finiteAll([grad1.gx, grad1.gy, grad2.gx, grad2.gy])) return null;
  const dx = grad1.gx - grad2.gx;
  const dy = grad1.gy - grad2.gy;
  if (isZeroScalar(dx) && isZeroScalar(dy)) return { coincident: true };
  const mx = -dy;
  const my = dx;
  const len = Math.hypot(mx, my);
  if (!(len > 0) || !Number.isFinite(len)) return null;
  return { mx: mx / len, my: my / len };
};

/**
 * Pick the miter ray lying in BOTH grading-side half-planes
 * (`R·N1 >= 0 && R·N2 >= 0`). ±M both valid ⇒ ambiguous, neither ⇒ inverted.
 */
export const selectMiterRay = (
  m: { mx: number; my: number },
  n1: PlanVector,
  n2: PlanVector,
): MiterRayResult => {
  if (!finiteAll([m.mx, m.my, n1.nx, n1.ny, n2.nx, n2.ny])) return null;
  const inBoth = (sx: number, sy: number): boolean =>
    atLeastZero(sx * n1.nx + sy * n1.ny) && atLeastZero(sx * n2.nx + sy * n2.ny);
  const forward = inBoth(m.mx, m.my);
  const backward = inBoth(-m.mx, -m.my);
  if (forward && backward) return { ambiguous: true };
  if (forward) return { mx: m.mx, my: m.my };
  if (backward) return { mx: -m.mx, my: -m.my };
  return { inverted: true };
};

/**
 * Analytic miter extent: `t ≤ maxSearch / (M·Ni)` for each course whose
 * normal is not parallel to the ray; the tightest bound wins. A ray parallel
 * to a course imposes no distance bound. Non-positive/absent bounds and
 * inverted rays fail closed.
 */
export const miterExtent = (
  m: { mx: number; my: number },
  n1: PlanVector,
  n2: PlanVector,
  maxSearchDistance: number,
): number | null => {
  if (!finiteAll([m.mx, m.my, n1.nx, n1.ny, n2.nx, n2.ny, maxSearchDistance])) return null;
  if (!(maxSearchDistance > 0)) return null;
  let tMax = Number.POSITIVE_INFINITY;
  for (const n of [n1, n2]) {
    const d = m.mx * n.nx + m.my * n.ny;
    if (isZeroScalar(d)) continue;
    if (d < 0) return null;
    tMax = Math.min(tMax, maxSearchDistance / d);
  }
  return Number.isFinite(tMax) ? tMax : null;
};

/**
 * Signed-turn joint classification (mission §5): with side sign s = +1 left /
 * -1 right, `s·cross > 0` ⇒ OVERLAP, `< 0` ⇒ GAP, zeroDelta-zero ⇒ TANGENT.
 */
export const classifyCorner = (
  t1: PlanVector,
  t2: PlanVector,
  side: GradingSide,
): CornerTurn | null => {
  if (!finiteAll([t1.nx, t1.ny, t2.nx, t2.ny])) return null;
  const a = unitTangent(0, 0, t1.nx, t1.ny);
  const b = unitTangent(0, 0, t2.nx, t2.ny);
  if (!a || !b) return null;
  const cross = a.nx * b.ny - a.ny * b.nx;
  if (isZeroScalar(cross)) return 'TANGENT';
  const s = side === 'left' ? 1 : -1;
  return s * cross > 0 ? 'OVERLAP' : 'GAP';
};

/**
 * Corner cut/fill relation from target-minus-source at the corner vertex:
 * positive ⇒ CUT, negative ⇒ FILL, within zeroDelta ⇒ TIED.
 */
export const cutFillSideAtCorner = (
  targetZatV: number,
  sourceZatV: number,
): CornerCutFill | null => {
  if (!finiteAll([targetZatV, sourceZatV])) return null;
  const delta = targetZatV - sourceZatV;
  if (Math.abs(delta) <= zeroDelta(targetZatV, sourceZatV)) return 'TIED';
  return delta > 0 ? 'CUT' : 'FILL';
};
