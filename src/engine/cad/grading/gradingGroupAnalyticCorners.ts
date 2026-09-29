/**
 * Phase 20F — analytic (target-free) grading-group corner geometry.
 *
 * A distance/elevation group terminates on its own grading limit, so a
 * corner is the analytic intersection of the two terminal limit lines:
 *   - distance  : offset of each course by its constant D along the grading
 *                 normal, with Z = Zsource + g·D;
 *   - elevation : each course's grading plane ∩ Z = E (constant Z line);
 *   - relative-elevation: distance-line geometry with d = ΔZ/g and
 *                 Z = Zsource + ΔZ (source-shifted limit, constant along
 *                 straight and curved sources).
 *
 * The intersection is accepted only when it lies on both grading-side
 * half-planes and within the miter/search bound, and when the two lines
 * agree in Z within the shared 18I `zeroDelta`. No averaging, no bridging
 * walls, no elevation interpolation, and no boolean repair: a degenerate or
 * inconsistent corner fails closed.
 */
import { zeroDelta } from '../surfaces/volume/zero';
import { miterExtent } from './gradingCornerMath';
import type { PlanVector } from './gradingCourseFrame';
import type { GradingCriterion } from './gradingTypes';

/** One terminal grading-limit line in 3D: origin at the joint + direction. */
export interface AnalyticTerminalLine {
  ox: number;
  oy: number;
  oz: number;
  /** XY direction is unit; Z component carries the along-course grade. */
  dx: number;
  dy: number;
  dz: number;
}

export interface AnalyticCornerParams {
  vx: number;
  vy: number;
  vz: number;
  inT: PlanVector;
  inN: PlanVector;
  inGs: number;
  outT: PlanVector;
  outN: PlanVector;
  outGs: number;
  inCriterion: GradingCriterion;
  outCriterion: GradingCriterion;
  maxSearchDistance: number;
}

export type AnalyticCornerSolution =
  | {
      ok: true;
      /** Coincident limit lines: the joint needs no patch at all. */
      kind: 'coincident';
    }
  | {
      ok: true;
      kind: 'miter';
      tie: { x: number; y: number; z: number };
      /** Unit miter ray at V through the tie. */
      ray: { mx: number; my: number };
      /** |tie - V| (metres), the analytic miter extent. */
      extent: number;
    }
  | { ok: false; detail: string };

const finiteAll = (values: number[]): boolean => values.every((value) => Number.isFinite(value));

/**
 * Terminal limit line of one course at the joint. Distance: parallel offset
 * at constant D. Elevation: the constant-Z line where the course's plane
 * reaches E. Relative-elevation: distance-line geometry with d = ΔZ/g
 * (source shifted by ΔZ). Null for surface criteria or non-finite geometry.
 */
export const analyticTerminalLine = (
  vx: number,
  vy: number,
  vz: number,
  t: PlanVector,
  n: PlanVector,
  gs: number,
  criterion: GradingCriterion,
): AnalyticTerminalLine | null => {
  if (!finiteAll([vx, vy, vz, t.nx, t.ny, n.nx, n.ny, gs])) return null;
  if (criterion.kind === 'distance') {
    const { gradeRatio: g, distance: d } = criterion;
    if (!finiteAll([g, d])) return null;
    return {
      ox: vx + n.nx * d,
      oy: vy + n.ny * d,
      oz: vz + g * d,
      dx: t.nx,
      dy: t.ny,
      dz: gs,
    };
  }
  if (criterion.kind === 'elevation') {
    const { gradeRatio: g, targetElevation: e } = criterion;
    if (!finiteAll([g, e]) || g === 0) return null;
    const d0 = (e - vz) / g;
    if (!Number.isFinite(d0)) return null;
    // Direction stays at constant Z: d(u) = (E − Zsrc(u))/g, so the XY
    // direction picks up the longitudinal grade divided by the cross grade.
    return {
      ox: vx + n.nx * d0,
      oy: vy + n.ny * d0,
      oz: e,
      dx: t.nx - (gs / g) * n.nx,
      dy: t.ny - (gs / g) * n.ny,
      dz: 0,
    };
  }
  if (criterion.kind === 'relative-elevation') {
    const { gradeRatio: g, relativeElevation: dz } = criterion;
    if (!Number.isFinite(g) || !Number.isFinite(dz) || g === 0 || dz === 0) return null;
    const d = dz / g;
    if (!Number.isFinite(d)) return null;
    return {
      ox: vx + n.nx * d,
      oy: vy + n.ny * d,
      oz: vz + dz,
      dx: t.nx,
      dy: t.ny,
      dz: gs,
    };
  }
  return null;
};

const cross2 = (ax: number, ay: number, bx: number, by: number): number => ax * by - ay * bx;

/** Parallel coincident check: same XY line (within zeroDelta) and same Z. */
const linesCoincide = (l1: AnalyticTerminalLine, l2: AnalyticTerminalLine): boolean => {
  const crossOrigin = cross2(l2.ox - l1.ox, l2.oy - l1.oy, l1.dx, l1.dy);
  if (Math.abs(crossOrigin) > zeroDelta(crossOrigin, 0)) return false;
  const s = l1.dx * l1.dx + l1.dy * l1.dy;
  if (!(s > 0)) return false;
  const u = ((l2.ox - l1.ox) * l1.dx + (l2.oy - l1.oy) * l1.dy) / s;
  const z1 = l1.oz + u * l1.dz;
  return Math.abs(z1 - l2.oz) <= zeroDelta(z1, l2.oz);
};

/**
 * Resolve one analytic corner. `coincident` = no patch (collinear same
 * offset); `miter` = the verified intersection; failure = fail closed.
 */
export const solveAnalyticCorner = (params: AnalyticCornerParams): AnalyticCornerSolution => {
  const { vx, vy, vz, inT, inN, inGs, outT, outN, outGs, maxSearchDistance } = params;
  const l1 = analyticTerminalLine(vx, vy, vz, inT, inN, inGs, params.inCriterion);
  const l2 = analyticTerminalLine(vx, vy, vz, outT, outN, outGs, params.outCriterion);
  if (!l1 || !l2) return { ok: false, detail: 'GRADING_ANALYTIC_CORNER_LINE' };
  const det = cross2(l1.dx, l1.dy, l2.dx, l2.dy);
  if (Math.abs(det) <= zeroDelta(det, 0)) {
    return linesCoincide(l1, l2)
      ? { ok: true, kind: 'coincident' }
      : { ok: false, detail: 'GRADING_ANALYTIC_CORNER_PARALLEL' };
  }
  const rx = l2.ox - l1.ox;
  const ry = l2.oy - l1.oy;
  const u = cross2(rx, ry, l2.dx, l2.dy) / det;
  const w = cross2(rx, ry, l1.dx, l1.dy) / det;
  const px = l1.ox + u * l1.dx;
  const py = l1.oy + u * l1.dy;
  const z1 = l1.oz + u * l1.dz;
  const z2 = l2.oz + w * l2.dz;
  if (!finiteAll([px, py, z1, z2]) || Math.abs(z1 - z2) > zeroDelta(z1, z2)) {
    return { ok: false, detail: 'GRADING_ANALYTIC_CORNER_Z' };
  }
  // Side: the tie must lie on BOTH grading-side half-planes.
  const sideIn = (px - vx) * inN.nx + (py - vy) * inN.ny;
  const sideOut = (px - vx) * outN.nx + (py - vy) * outN.ny;
  if (sideIn < -zeroDelta(sideIn, 0) || sideOut < -zeroDelta(sideOut, 0)) {
    return { ok: false, detail: 'GRADING_ANALYTIC_CORNER_SIDE' };
  }
  const dx = px - vx;
  const dy = py - vy;
  const extent = Math.hypot(dx, dy);
  if (!(extent > 0) || !Number.isFinite(extent)) {
    return { ok: false, detail: 'GRADING_ANALYTIC_CORNER_DEGENERATE' };
  }
  const ray = { mx: dx / extent, my: dy / extent };
  const tMax = miterExtent(ray, inN, outN, maxSearchDistance);
  if (tMax === null || extent > tMax + zeroDelta(extent, tMax)) {
    return { ok: false, detail: 'GRADING_ANALYTIC_CORNER_MAX' };
  }
  return { ok: true, kind: 'miter', tie: { x: px, y: py, z: z1 }, ray, extent };
};
