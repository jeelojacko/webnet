/**
 * Phase 20K.3 Wave E1 — hardened direct-fan target coverage proof.
 *
 * The cross-grade CUT/FILL transition joint tiles a wedge (qIn → V → qOut)
 * directly across the target. Phase 20K.2's facet walk proved the fan sits
 * on ONE approximated target plane by clipping every overlapping target
 * facet to the fan and summing clipped areas. Summing is overcoverage-blind:
 * overlapping coplanar target sheets (duplicate triangles) can double-count
 * area and compensate for a genuine void elsewhere on the fan, so the fan
 * "covers" while part of it hangs off the target.
 *
 * This module keeps the same exact Sutherland–Hodgman clip + anchored
 * elevation agreement and adds:
 *  - an exact union-coverage proof: every pair of clipped facets must be
 *    plan-disjoint beyond the agreement floor, so the summed area IS the
 *    union area (no double-count);
 *  - a two-sided area bound (undercoverage = void/island, overcoverage =
 *    duplicate sheets), both within the existing shared agreement floor.
 *
 * It is deliberately NOT a general boolean engine: the only intersection
 * computed is convex-polygon vs convex-polygon (both are clipped facets),
 * and nothing is merged, resampled, or re-triangulated.
 */
import { orient2d } from 'robust-predicates';
import { clipTrianglePair } from '../surfaces/volume/overlap';
import type { TargetQuery } from './gradingComputeTypes';
import { AGREEMENT_FLOOR, elevationAgreementTol, planeLeverage } from './gradingGroupSectors';

/** Shoelace plan area of a flat [x,y,...] polygon. */
const shoelaceArea = (flat: readonly number[]): number => {
  const n = flat.length / 2;
  let sum = 0;
  for (let i = 0; i < n; i += 1) {
    const j = (i + 1) % n;
    sum += flat[i * 2]! * flat[j * 2 + 1]! - flat[j * 2]! * flat[i * 2 + 1]!;
  }
  return Math.abs(sum) / 2;
};

/** Standard shoelace double-area (signed), used for orientation. */
const signedArea2 = (flat: readonly number[]): number => {
  let sum = 0;
  for (let i = 0; i < flat.length; i += 2) {
    const j = (i + 2) % flat.length;
    sum += flat[i]! * flat[j + 1]! - flat[j]! * flat[i + 1]!;
  }
  return sum;
};

const reversePairs = (flat: readonly number[]): number[] => {
  const out: number[] = [];
  for (let i = flat.length - 2; i >= 0; i -= 2) out.push(flat[i]!, flat[i + 1]!);
  return out;
};

const toCcw = (flat: readonly number[]): number[] =>
  signedArea2(flat) < 0 ? reversePairs(flat) : [...flat];

/** robust-predicates orient2d is positive for math-clockwise triples. */
const insideEdge = (
  ax: number, ay: number, bx: number, by: number, px: number, py: number,
): boolean => orient2d(ax, ay, bx, by, px, py) <= 0;

const segCross = (
  sx: number, sy: number, ex: number, ey: number,
  ax: number, ay: number, bx: number, by: number,
): { x: number; y: number } => {
  const dx = bx - ax;
  const dy = by - ay;
  const denom = (ex - sx) * dy - (ey - sy) * dx;
  const t = ((ax - sx) * dy - (ay - sy) * dx) / denom;
  return { x: sx + t * (ex - sx), y: sy + t * (ey - sy) };
};

/**
 * Plan area of the intersection of two convex polygons (flat [x,y,...]).
 * Sutherland–Hodgman clip with robust orientation; disjoint/contact-only
 * pairs return 0.
 */
const convexIntersectionArea = (polyA: readonly number[], polyB: readonly number[]): number => {
  let subject = toCcw(polyA);
  const clip = toCcw(polyB);
  if (subject.length < 6 || clip.length < 6) return 0;
  for (let i = 0; i < clip.length; i += 2) {
    if (subject.length === 0) return 0;
    const ax = clip[i]!;
    const ay = clip[i + 1]!;
    const j = (i + 2) % clip.length;
    const bx = clip[j]!;
    const by = clip[j + 1]!;
    const out: number[] = [];
    let sx = subject[subject.length - 2]!;
    let sy = subject[subject.length - 1]!;
    let sIn = insideEdge(ax, ay, bx, by, sx, sy);
    for (let k = 0; k < subject.length; k += 2) {
      const ex = subject[k]!;
      const ey = subject[k + 1]!;
      const eIn = insideEdge(ax, ay, bx, by, ex, ey);
      if (eIn) {
        if (!sIn) {
          const c = segCross(sx, sy, ex, ey, ax, ay, bx, by);
          out.push(c.x, c.y);
        }
        out.push(ex, ey);
      } else if (sIn) {
        const c = segCross(sx, sy, ex, ey, ax, ay, bx, by);
        out.push(c.x, c.y);
      }
      sx = ex;
      sy = ey;
      sIn = eIn;
    }
    subject = out;
  }
  const area = Math.abs(signedArea2(subject)) / 2;
  return Number.isFinite(area) ? area : 0;
};

/** Plan-barycentric elevation of a target triangle at (x, y); null if degenerate. */
const triangleZAt = (
  a: readonly [number, number, number],
  b: readonly [number, number, number],
  c: readonly [number, number, number],
  x: number,
  y: number,
): number | null => {
  const v0x = c[0] - a[0];
  const v0y = c[1] - a[1];
  const v1x = b[0] - a[0];
  const v1y = b[1] - a[1];
  const v2x = x - a[0];
  const v2y = y - a[1];
  const d00 = v0x * v0x + v0y * v0y;
  const d01 = v0x * v1x + v0y * v1y;
  const d11 = v1x * v1x + v1y * v1y;
  const d20 = v2x * v0x + v2y * v0y;
  const d21 = v2x * v1x + v2y * v1y;
  const denom = d00 * d11 - d01 * d01;
  if (denom === 0) return null;
  const vb = (d11 * d20 - d01 * d21) / denom;
  const wb = (d00 * d21 - d01 * d20) / denom;
  const ub = 1 - vb - wb;
  return ub * a[2] + vb * c[2] + wb * b[2];
};

interface ClippedFacet {
  local: readonly number[];
  originX: number;
  originY: number;
  area: number;
}

const toGlobal = (facet: ClippedFacet): number[] => {
  const out: number[] = [];
  for (let i = 0; i < facet.local.length; i += 2) {
    out.push(facet.local[i]! + facet.originX, facet.local[i + 1]! + facet.originY);
  }
  return out;
};

/**
 * True facet walk: the fan triangle (V,qIn,qOut) must be covered exactly
 * once by target facets that all agree with the fan plane under the shared
 * anchored elevation bounds. Overlapping facets (double-count), uncovered
 * area (void), an off-plane facet (ridge/valley/branch), or a plan-degenerate
 * conditioning triangle all fail closed. No resampling, no tolerance
 * relaxation, no boolean engine.
 */
export const fanCoveredByFacets = (
  query: TargetQuery,
  plane: { gx: number; gy: number; ax: number; ay: number },
  fanPlan: readonly number[],
  elevation: (_x: number, _y: number) => number,
): boolean => {
  const points = query.targetPoints;
  const triangles = query.targetTriangles;
  const fanArea = shoelaceArea(fanPlan);
  if (!(fanArea > 0)) return false;
  const minX = Math.min(fanPlan[0]!, fanPlan[2]!, fanPlan[4]!);
  const maxX = Math.max(fanPlan[0]!, fanPlan[2]!, fanPlan[4]!);
  const minY = Math.min(fanPlan[1]!, fanPlan[3]!, fanPlan[5]!);
  const maxY = Math.max(fanPlan[1]!, fanPlan[3]!, fanPlan[5]!);
  const perimeter =
    Math.hypot(fanPlan[2]! - fanPlan[0]!, fanPlan[3]! - fanPlan[1]!) +
    Math.hypot(fanPlan[4]! - fanPlan[2]!, fanPlan[5]! - fanPlan[3]!) +
    Math.hypot(fanPlan[0]! - fanPlan[4]!, fanPlan[1]! - fanPlan[5]!);
  const areaTol = AGREEMENT_FLOOR * (perimeter + 1);
  const facets: ClippedFacet[] = [];
  let covered = 0;
  for (let t = 0; t + 2 < triangles.length; t += 3) {
    const a3: [number, number, number] = [points[triangles[t]! * 3]!, points[triangles[t]! * 3 + 1]!, points[triangles[t]! * 3 + 2]!];
    const b3: [number, number, number] = [points[triangles[t + 1]! * 3]!, points[triangles[t + 1]! * 3 + 1]!, points[triangles[t + 1]! * 3 + 2]!];
    const c3: [number, number, number] = [points[triangles[t + 2]! * 3]!, points[triangles[t + 2]! * 3 + 1]!, points[triangles[t + 2]! * 3 + 2]!];
    if (
      Math.max(a3[0], b3[0], c3[0]) < minX || Math.min(a3[0], b3[0], c3[0]) > maxX ||
      Math.max(a3[1], b3[1], c3[1]) < minY || Math.min(a3[1], b3[1], c3[1]) > maxY
    ) continue;
    const clip = clipTrianglePair(fanPlan, [a3[0], a3[1], b3[0], b3[1], c3[0], c3[1]]);
    if (!clip) continue;
    for (let i = 0; i < clip.local.length; i += 2) {
      const x = clip.local[i]! + clip.originX;
      const y = clip.local[i + 1]! + clip.originY;
      const zf = triangleZAt(a3, b3, c3, x, y);
      if (zf === null) return false;
      const zp = elevation(x, y);
      const tol = elevationAgreementTol(zf, zp, planeLeverage(plane, x, y)) + AGREEMENT_FLOOR;
      if (Math.abs(zf - zp) > tol) return false;
    }
    const area = shoelaceArea(clip.local);
    facets.push({ local: clip.local, originX: clip.originX, originY: clip.originY, area });
    covered += area;
  }
  // Two-sided coverage bound: under = void/island, over = duplicate sheets.
  if (fanArea - covered > areaTol) return false;
  if (covered - fanArea > areaTol) return false;
  // Exact union proof: no two clipped facets may double-count area, so the
  // summed coverage above IS the union coverage (no void compensation).
  for (let i = 0; i < facets.length; i += 1) {
    for (let j = i + 1; j < facets.length; j += 1) {
      if (facets[i]!.area + facets[j]!.area <= areaTol) continue;
      if (convexIntersectionArea(toGlobal(facets[i]!), toGlobal(facets[j]!)) > areaTol) return false;
    }
  }
  return true;
};
