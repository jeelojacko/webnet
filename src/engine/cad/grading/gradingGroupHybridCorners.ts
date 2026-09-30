/**
 * Phase 20J Wave B — hybrid surface↔analytic group corners (pure, no worker/React).
 *
 * One joint joins a surface-terminated member (fixed/cut-fill TIN tie) with
 * an analytic member (distance/elevation/relative-elevation limit). Both
 * ties are resolved independently against the SAME seam ray and accepted
 * only as one exact common tie — the 20I study core promoted into
 * production, minus its evidence-only fallbacks:
 *
 * - surface tie: nearest outward `solveMiterTie` root (root policy kept);
 * - analytic tie: existing `analyticTerminalLine` × the same seam ray;
 * - accept only on X/Y/Z + seam-param agreement under the coordinate-aware
 *   tie bound (`tieAgreementTol`: `zeroDelta` scaled by |XY|, itself untouched),
 *   target agreement (surface authority) + terminal-line/plane agreement
 *   (analytic authority), both side half-planes, and the miter extent;
 * - GAP fans V→Qs→tie + V→tie→Qa on the two exact planes (no wall/bridge);
 *   OVERLAP clips both strips to the V→tie seam and retains the tie once.
 *
 * Owns no target index, formula, sign convention, or tolerance: every
 * geometric/numeric authority is an imported existing helper. Consumes only
 * successful member endpoints (Qs/Qa); a member failure fails the group
 * before this helper runs, never falls back here.
 */
import { zeroDelta } from '../surfaces/volume/zero';
import type { PlanVector } from './gradingCourseFrame';
import type { GradingTargetMeshSnapshot, TargetQuery } from './gradingComputeTypes';
import {
  analyticTerminalLine,
} from './gradingGroupAnalyticCorners';
import {
  classifyCorner,
  cutFillSideAtCorner,
  gradingPlaneGradient,
  miterExtent,
  miterSeam,
  planeElevationAt,
  selectMiterRay,
} from './gradingCornerMath';
import {
  clipPolylineToHalfPlane,
  tieAgreementTol,
  solveMiterTie,
} from './gradingGroupSectors';
import {
  clipTriangleToHalfPlane,
  mergeGroupTriangles,
  validateGroupMesh,
  type MergePoint,
  type MergeTriangle,
} from './gradingGroupMerge';
import {
  gradingTerminationDomain,
  type GradingCriterion,
  type GradingSide,
  type ResolvedGradingSource,
} from './gradingTypes';
import type { GroupDiagnosticCode } from './gradingGroupTypes';

export interface HybridCornerPoint {
  x: number;
  y: number;
  z: number;
}

export interface HybridCornerInput {
  vx: number;
  vy: number;
  vz: number;
  inT: PlanVector;
  inN: PlanVector;
  inGs: number;
  outT: PlanVector;
  outN: PlanVector;
  outGs: number;
  side: GradingSide;
  inCriterion: GradingCriterion;
  outCriterion: GradingCriterion;
  query: TargetQuery;
  target: GradingTargetMeshSnapshot;
  candidates: number[];
  maxSearchDistance: number;
  /** Solved surface-strip daylight endpoint at the joint (no fallback). */
  qs: HybridCornerPoint;
  /** Solved analytic-limit endpoint at the joint (no fallback). */
  qa: HybridCornerPoint;
  inIsArc: boolean;
  outIsArc: boolean;
  inStrip: MergeTriangle[];
  outStrip: MergeTriangle[];
  inDaylight: HybridCornerPoint[];
  outDaylight: HybridCornerPoint[];
  midIn: { x: number; y: number };
  midOut: { x: number; y: number };
}

export type HybridCornerOutcome =
  | {
    ok: true;
    classification: 'GAP' | 'OVERLAP';
    tie: HybridCornerPoint;
    ray: { mx: number; my: number };
    extent: number;
    rootCount: number;
    cornerRun: MergePoint[];
    patchTris: MergeTriangle[];
    inTris: MergeTriangle[];
    outTris: MergeTriangle[];
    inDaylight: HybridCornerPoint[];
    outDaylight: HybridCornerPoint[];
  }
  | { ok: false; code: GroupDiagnosticCode; detail: string };

const finiteAll = (values: number[]): boolean => values.every((value) => Number.isFinite(value));

/** Corner plane through V along tangent t (mirror of the compute twin). */
const planeThroughV = (
  vx: number, vy: number, vz: number,
  t: PlanVector, side: GradingSide, gCross: number, gsLong: number,
) => {
  const pseudo: ResolvedGradingSource = {
    startX: vx, startY: vy, endX: vx + t.nx, endY: vy + t.ny,
    startZ: vz, endZ: vz + gsLong, length: 1, reoriented: false, isArc: false,
  };
  return gradingPlaneGradient(pseudo, side, gCross, gsLong);
};

/**
 * Resolve one hybrid joint to its exact common tie. Fail-closed with a
 * named GRADING_SURFACE_ANALYTIC_* detail on every degraded path.
 */
export const solveHybridCorner = (input: HybridCornerInput): HybridCornerOutcome => {
  const bad = (code: GroupDiagnosticCode, detail: string): HybridCornerOutcome => ({ ok: false, code, detail });
  const { vx, vy, vz, side, maxSearchDistance } = input;
  if (!finiteAll([vx, vy, vz, maxSearchDistance]) || !(maxSearchDistance > 0)) {
    return bad('CORNER_NO_SOLUTION', 'GRADING_SURFACE_ANALYTIC_LINE');
  }
  for (const p of [input.qs, input.qa]) {
    if (!finiteAll([p.x, p.y, p.z])) return bad('CORNER_NO_SOLUTION', 'GRADING_SURFACE_ANALYTIC_LINE');
  }
  // Arc×arc hybrid joints have no honest chord-linearized common tie.
  if (input.inIsArc && input.outIsArc) {
    return bad('CORNER_NO_SOLUTION', 'GRADING_SURFACE_ANALYTIC_ARC_PAIR_UNSUPPORTED');
  }
  const turn = classifyCorner(input.inT, input.outT, side);
  if (turn !== 'GAP' && turn !== 'OVERLAP') {
    return bad('CORNER_NO_SOLUTION', 'GRADING_SURFACE_ANALYTIC_TRANSITION_REQUIRED');
  }
  // Defense in depth: exactly one side is surface-terminated (compute
  // dispatches here only for mixed joints, but malformed states fail closed).
  const inDom = gradingTerminationDomain(input.inCriterion);
  const outDom = gradingTerminationDomain(input.outCriterion);
  if (inDom === outDom) return bad('CORNER_NO_SOLUTION', 'GRADING_SURFACE_ANALYTIC_LINE');
  const surfaceIncoming = inDom === 'surface';
  const sT = surfaceIncoming ? input.inT : input.outT;
  const sN = surfaceIncoming ? input.inN : input.outN;
  const sGs = surfaceIncoming ? input.inGs : input.outGs;
  const aT = surfaceIncoming ? input.outT : input.inT;
  const aN = surfaceIncoming ? input.outN : input.inN;
  const aGs = surfaceIncoming ? input.outGs : input.inGs;
  const surfaceCriterion = surfaceIncoming ? input.inCriterion : input.outCriterion;
  const analyticCriterion = surfaceIncoming ? input.outCriterion : input.inCriterion;
  // Active cross grade at V: fixed ratio, or the cut/fill pick from the
  // target-minus-source sign convention at the corner vertex.
  const ztV = input.query.elevationAt(vx, vy);
  if (ztV === null) return bad('CORNER_TARGET_GAP', 'GRADING_SURFACE_ANALYTIC_TARGET_GAP');
  const relation = cutFillSideAtCorner(ztV, vz);
  if (!relation) return bad('CORNER_TARGET_GAP', 'GRADING_SURFACE_ANALYTIC_TARGET_GAP');
  let gSurface: number | null = null;
  if (surfaceCriterion.kind === 'fixed') {
    gSurface = Number.isFinite(surfaceCriterion.gradeRatio) ? surfaceCriterion.gradeRatio : null;
  } else if (surfaceCriterion.kind === 'cut-fill') {
    if (!Number.isFinite(surfaceCriterion.cutGradeRatio) || !Number.isFinite(surfaceCriterion.fillGradeRatio)) {
      gSurface = null;
    } else {
      gSurface = relation === 'CUT' ? surfaceCriterion.cutGradeRatio
        : relation === 'FILL' ? surfaceCriterion.fillGradeRatio : 0;
    }
  }
  if (gSurface === null || !Number.isFinite(gSurface)) {
    return bad('CORNER_NO_SOLUTION', 'GRADING_SURFACE_ANALYTIC_LINE');
  }
  if (analyticCriterion.kind === 'fixed' || analyticCriterion.kind === 'cut-fill') {
    return bad('CORNER_NO_SOLUTION', 'GRADING_SURFACE_ANALYTIC_LINE');
  }
  const planeS = planeThroughV(vx, vy, vz, sT, side, gSurface, sGs);
  const planeA = planeThroughV(vx, vy, vz, aT, side, analyticCriterion.gradeRatio, aGs);
  if (!planeS || !planeA) return bad('CORNER_NO_SOLUTION', 'GRADING_SURFACE_ANALYTIC_LINE');
  const seam = miterSeam(planeS, planeA);
  if (!seam || 'coincident' in seam) {
    return bad('CORNER_NO_SOLUTION', 'GRADING_SURFACE_ANALYTIC_TRANSITION_REQUIRED');
  }
  const ray = selectMiterRay(seam, sN, aN);
  if (!ray || 'ambiguous' in ray || 'inverted' in ray) {
    return bad('CORNER_NO_SOLUTION', 'GRADING_SURFACE_ANALYTIC_SIDE');
  }
  const tMax = miterExtent(ray, sN, aN, maxSearchDistance);
  if (tMax === null) return bad('CORNER_MAX_DISTANCE', 'GRADING_SURFACE_ANALYTIC_MAX');
  // Surface tie: nearest valid outward root (existing policy, never later).
  const sTie = solveMiterTie(input.target, input.candidates, input.query, planeS, vx, vy, ray.mx, ray.my, tMax);
  if (!sTie.ok) {
    if (sTie.code === 'CORNER_TARGET_GAP') {
      return bad('CORNER_TARGET_GAP', 'GRADING_SURFACE_ANALYTIC_TARGET_GAP');
    }
    return bad('CORNER_NO_SOLUTION', 'GRADING_SURFACE_ANALYTIC_TRANSITION_REQUIRED');
  }
  // Analytic tie: existing terminal line × the SAME seam ray (no projection).
  // (No early tie-at-V gate: a nearest root at V with the analytic tie on a
  // later root is the ROOT_POLICY conflict; plain tied-at-V joints fail at
  // the agreement gates below with TRANSITION_REQUIRED.)
  const line = analyticTerminalLine(vx, vy, vz, aT, aN, aGs, analyticCriterion, maxSearchDistance);
  if (!line) return bad('CORNER_NO_SOLUTION', 'GRADING_SURFACE_ANALYTIC_LINE');
  const det = ray.mx * line.dy - ray.my * line.dx;
  if (Math.abs(det) <= zeroDelta(det, 0)) {
    return bad('CORNER_NO_SOLUTION', 'GRADING_SURFACE_ANALYTIC_LINE');
  }
  const rx = line.ox - vx;
  const ry = line.oy - vy;
  const tA = (rx * line.dy - ry * line.dx) / det;
  const uA = (rx * ray.my - ry * ray.mx) / det;
  if (!finiteAll([tA, uA])) return bad('CORNER_NO_SOLUTION', 'GRADING_SURFACE_ANALYTIC_LINE');
  if (tA < -zeroDelta(tA, 0)) return bad('CORNER_NO_SOLUTION', 'GRADING_SURFACE_ANALYTIC_LINE');
  const aTie: HybridCornerPoint = {
    x: vx + ray.mx * tA,
    y: vy + ray.my * tA,
    z: line.oz + uA * line.dz,
  };
  if (!finiteAll([aTie.x, aTie.y, aTie.z])) {
    return bad('CORNER_NO_SOLUTION', 'GRADING_SURFACE_ANALYTIC_LINE');
  }
  const sideS = (aTie.x - vx) * sN.nx + (aTie.y - vy) * sN.ny;
  const sideA = (aTie.x - vx) * aN.nx + (aTie.y - vy) * aN.ny;
  if (sideS < -zeroDelta(sideS, 0) || sideA < -zeroDelta(sideA, 0)) {
    return bad('CORNER_NO_SOLUTION', 'GRADING_SURFACE_ANALYTIC_SIDE');
  }
  const extent = Math.hypot(aTie.x - vx, aTie.y - vy);
  if (!(extent > 0) || !Number.isFinite(extent)) {
    return bad('CORNER_NO_SOLUTION', 'GRADING_SURFACE_ANALYTIC_TRANSITION_REQUIRED');
  }
  if (extent > tMax + zeroDelta(extent, tMax)) {
    return bad('CORNER_MAX_DISTANCE', 'GRADING_SURFACE_ANALYTIC_MAX');
  }
  const planeZatA = planeElevationAt(planeA, aTie.x, aTie.y);
  if (planeZatA === null || Math.abs(planeZatA - aTie.z) > tieAgreementTol(planeZatA, aTie.z, aTie.x, aTie.y)) {
    return bad('CORNER_NO_SOLUTION', 'GRADING_SURFACE_ANALYTIC_LINE');
  }
  // Exact acceptance: X/Y/Z + seam param under the coordinate-aware tie
  // bound (tie quantities evaluated at world XY carry ~eps*|XY| noise that
  // zeroDelta alone under-bounds far from the origin). Target agreement
  // is surface-authoritative.
  const sTiePt: HybridCornerPoint = { x: sTie.x, y: sTie.y, z: sTie.z };
  const xTol = tieAgreementTol(sTiePt.x, aTie.x, aTie.x, aTie.y);
  const yTol = tieAgreementTol(sTiePt.y, aTie.y, aTie.x, aTie.y);
  const zTol = tieAgreementTol(sTiePt.z, aTie.z, aTie.x, aTie.y);
  const tTol = tieAgreementTol(sTie.t, tA, aTie.x, aTie.y);
  const agreed = Math.abs(sTiePt.x - aTie.x) <= xTol && Math.abs(sTiePt.y - aTie.y) <= yTol
    && Math.abs(sTiePt.z - aTie.z) <= zTol && Math.abs(sTie.t - tA) <= tTol;
  const ztCommon = input.query.elevationAt(aTie.x, aTie.y);
  const targetOk = ztCommon !== null && Math.abs(ztCommon - sTiePt.z) <= zTol;
  if (agreed && targetOk) {
    const tie = aTie;
    const miterLine = { vx, vy, mx: ray.mx, my: ray.my };
    if (turn === 'GAP') {
      // Fan the corner wedge on the two exact planes (never a wall/bridge).
      const v: MergePoint = { x: vx, y: vy, z: vz };
      const s: MergePoint = { x: input.qs.x, y: input.qs.y, z: input.qs.z };
      const t: MergePoint = { x: tie.x, y: tie.y, z: tie.z };
      const a: MergePoint = { x: input.qa.x, y: input.qa.y, z: input.qa.z };
      const patchTris: MergeTriangle[] = [{ a: v, b: s, c: t }, { a: v, b: t, c: a }]
        .filter((tri) => {
          const area2 = (tri.b.x - tri.a.x) * (tri.c.y - tri.a.y) - (tri.c.x - tri.a.x) * (tri.b.y - tri.a.y);
          return Math.abs(area2) > zeroDelta(area2, 0);
        });
      const cornerMesh = mergeGroupTriangles(patchTris);
      if (validateGroupMesh(cornerMesh) !== null) {
        return bad('CORNER_NO_SOLUTION', 'GRADING_SURFACE_ANALYTIC_MESH');
      }
      // Corner run always travels incoming → tie → outgoing (surface-first
      // storage would spike the ring on analytic-incoming joints).
      const cornerRun: MergePoint[] = surfaceIncoming ? [s, t, a] : [a, t, s];
      return {
        ok: true, classification: 'GAP', tie, ray, extent, rootCount: sTie.rootCount,
        cornerRun, patchTris,
        inTris: input.inStrip, outTris: input.outStrip,
        inDaylight: input.inDaylight, outDaylight: input.outDaylight,
      };
    }
    // OVERLAP: clip both strips to the seam, keep member-side, tie once.
    const trimTris = (tris: MergeTriangle[], keep: { x: number; y: number }): MergeTriangle[] => {
      const out: MergeTriangle[] = [];
      for (const tri of tris) out.push(...clipTriangleToHalfPlane(tri, miterLine, keep));
      return out;
    };
    const inTris = trimTris(input.inStrip, input.midIn);
    const outTris = trimTris(input.outStrip, input.midOut);
    const inDaylight = clipPolylineToHalfPlane(input.inDaylight, miterLine, input.midIn);
    const outDaylight = clipPolylineToHalfPlane(input.outDaylight, miterLine, input.midOut);
    if (inDaylight.length === 0 || outDaylight.length === 0) {
      return bad('CORNER_NO_SOLUTION', 'GRADING_SURFACE_ANALYTIC_SIDE');
    }
    const cornerRun: MergePoint[] = [
      { ...inDaylight[inDaylight.length - 1]! },
      { x: tie.x, y: tie.y, z: tie.z },
      { ...outDaylight[0]! },
    ];
    return {
      ok: true, classification: 'OVERLAP', tie, ray, extent, rootCount: sTie.rootCount,
      cornerRun, patchTris: [], inTris, outTris, inDaylight, outDaylight,
    };
  }
  // Both ties exist but disagree: the analytic tie landing on the surface
  // plane AND the target at the analytic Z is a root-policy conflict
  // (surface keeps the nearest root); anything else needs a transition.
  const planeZatAnalytic = planeElevationAt(planeS, aTie.x, aTie.y);
  const ztAnalytic = input.query.elevationAt(aTie.x, aTie.y);
  const rpTol = planeZatAnalytic === null || ztAnalytic === null
    ? zTol
    : Math.max(zTol, tieAgreementTol(planeZatAnalytic, aTie.z, aTie.x, aTie.y));
  if (
    planeZatAnalytic !== null && ztAnalytic !== null
    && Math.abs(planeZatAnalytic - ztAnalytic) <= rpTol && Math.abs(planeZatAnalytic - aTie.z) <= rpTol
  ) {
    return bad('CORNER_NO_SOLUTION', 'GRADING_SURFACE_ANALYTIC_ROOT_POLICY');
  }
  return bad('CORNER_NO_SOLUTION', 'GRADING_SURFACE_ANALYTIC_TRANSITION_REQUIRED');
};
