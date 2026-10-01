/**
 * Phase 20K.1 Wave C2 — shared pure Surface corner solver (no worker/React).
 *
 * Verbatim extraction of the surface-corner block from
 * `gradingGroupCompute.ts`: incoming/outgoing grading planes (active-grade
 * convention), plane-plane miter seam, outward ray in both side half-planes,
 * analytic extent, nearest valid outward root via `solveMiterTie`, second-
 * plane agreement, and sector-path build/trim via the existing sector
 * helpers. GAP fans the wedge from V; OVERLAP trims both runs + triangle
 * soups to the miter line first. `cornerRun` keeps the exact group
 * convention (snapped sector vertices); internal chord-seam callers
 * substitute exact endpoints from the returned `path1`/`path2`/`tie`.
 * Every degenerate/ambiguous configuration fails closed; no stepping,
 * projection, relaxation, or later-root preference — nearest outward wins.
 */
import { zeroDelta } from '../surfaces/volume/zero';
import type { PlanVector } from './gradingCourseFrame';
import { classifySourceDelta } from './gradingCutFill';
import type { GradingTargetMeshSnapshot, TargetQuery } from './gradingComputeTypes';
import {
  gradingPlaneGradient,
  miterExtent,
  miterSeam,
  planeElevationAt,
  selectMiterRay,
  type CornerGradingPlane,
} from './gradingCornerMath';
import {
  AGREEMENT_FLOOR,
  clipPolylineToHalfPlane,
  elevationAgreementTol,
  planeLeverage,
  samePlanNode,
  solveMiterTie,
  solveSectorPath,
  type SectorLine,
  type SectorPoint,
} from './gradingGroupSectors';
import {
  clipTriangleToHalfPlane,
  type MergePoint,
  type MergeTriangle,
} from './gradingGroupMerge';
import type { GradingCriterion, GradingSide, ResolvedGradingSource } from './gradingTypes';
import type { GroupCornerClassification, GroupDiagnosticCode } from './gradingGroupTypes';

/** Corner grading plane through V: gradient gs*T + g*N via the 20B helper. */
export const cornerPlane = (
  vx: number, vy: number, vz: number,
  t: PlanVector, side: GradingSide, gCross: number, gsLong: number,
): CornerGradingPlane | null => {
  const pseudo: ResolvedGradingSource = {
    startX: vx, startY: vy, endX: vx + t.nx, endY: vy + t.ny,
    startZ: vz, endZ: vz + gsLong, length: 1, reoriented: false, isArc: false,
  };
  return gradingPlaneGradient(pseudo, side, gCross, gsLong);
};

/** Cross-grade active at V: fixed ratio, or the single-scalar cut/fill pick. */
export const crossGradeAtV = (
  criterion: GradingCriterion,
  deltaAtV: number,
): number | null => {
  if (criterion.kind === 'fixed') {
    return Number.isFinite(criterion.gradeRatio) ? criterion.gradeRatio : null;
  }
  if (criterion.kind !== 'cut-fill') return null;
  if (!Number.isFinite(criterion.cutGradeRatio) || !Number.isFinite(criterion.fillGradeRatio)) return null;
  const cls = classifySourceDelta(deltaAtV);
  return cls === 'CUT' ? criterion.cutGradeRatio : cls === 'FILL' ? criterion.fillGradeRatio : 0;
};

export interface SurfaceCornerJoint {
  vx: number;
  vy: number;
  vz: number;
  side: GradingSide;
  tIn: PlanVector;
  nIn: PlanVector;
  gsIn: number;
  gIn: number;
  tOut: PlanVector;
  nOut: PlanVector;
  gsOut: number;
  gOut: number;
  classification: GroupCornerClassification;
  target: GradingTargetMeshSnapshot;
  candidates: number[];
  query: TargetQuery;
  maxSearchDistance: number;
  /** Daylight endpoints on each side (exact chord/member solves). */
  q1: MergePoint;
  q2: MergePoint;
  /** Member/chord midpoints (miter keep side for OVERLAP trims). */
  midIn: SectorPoint;
  midOut: SectorPoint;
  inDaylight: MergePoint[];
  outDaylight: MergePoint[];
  inTris: MergeTriangle[];
  outTris: MergeTriangle[];
}

export interface SurfaceCornerSolution {
  /** True when the planes coincide (no wedge, no tie). */
  coincident: boolean;
  tie: { x: number; y: number; z: number };
  ray: { mx: number; my: number };
  extent: number;
  /** Group-convention corner run (snapped sector vertices). */
  cornerRun: MergePoint[];
  /** Raw sector paths (snapped); seam callers substitute exact endpoints. */
  path1: Array<{ x: number; y: number; z: number }>;
  path2: Array<{ x: number; y: number; z: number }>;
  /** GAP wedge fan (group strips); seam callers tile via repeated-V pairs. */
  patchTris: MergeTriangle[];
  inDaylight: MergePoint[];
  outDaylight: MergePoint[];
  inTris: MergeTriangle[];
  outTris: MergeTriangle[];
  /** 1 (tie) + sector segment counts, for intersection accounting. */
  segmentCount: number;
  rootCount: number;
}

export type SurfaceCornerOutcome =
  | { ok: true; value: SurfaceCornerSolution }
  | { ok: false; code: GroupDiagnosticCode; detail: string };

const sameXyz = (a: MergePoint, b: MergePoint): boolean =>
  Math.abs(a.x - b.x) <= zeroDelta(a.x, b.x) &&
  Math.abs(a.y - b.y) <= zeroDelta(a.y, b.y) &&
  Math.abs(a.z - b.z) <= zeroDelta(a.z, b.z);

export const solveSurfaceCorner = (joint: SurfaceCornerJoint): SurfaceCornerOutcome => {
  const {
    vx, vy, vz, side, tIn, nIn, gsIn, gIn, tOut, nOut, gsOut, gOut,
    classification, target, candidates, query, maxSearchDistance,
    q1, q2, midIn, midOut,
  } = joint;
  let { inDaylight, outDaylight, inTris, outTris } = joint;
  const plane1 = cornerPlane(vx, vy, vz, tIn, side, gIn, gsIn);
  const plane2 = cornerPlane(vx, vy, vz, tOut, side, gOut, gsOut);
  if (!plane1 || !plane2) return { ok: false, code: 'CORNER_INVERTED', detail: 'GRADING_CORNER_PLANE' };
  const seam = miterSeam(plane1, plane2);
  if (!seam) return { ok: false, code: 'CORNER_INVERTED', detail: 'GRADING_CORNER_SEAM' };
  if ('coincident' in seam) {
    // Same-plane merge: no wedge even when the criteria differ on paper.
    // Internal tied seams stitch through the shared endpoint; group
    // TANGENT joints keep their exact no-op corner (non-TANGENT groups
    // fail closed at their own gate, never here).
    if (!sameXyz(q1, q2)) return { ok: false, code: 'CORNER_COINCIDENT_PLANES', detail: 'GRADING_CORNER_SEAM' };
    const run = [{ ...q1 }];
    return {
      ok: true,
      value: {
        coincident: true,
        tie: { ...q1 }, ray: { mx: nIn.nx, my: nIn.ny }, extent: 0,
        cornerRun: run, path1: run, path2: [],
        patchTris: [], inDaylight, outDaylight, inTris, outTris,
        segmentCount: 0, rootCount: 1,
      },
    };
  }
  if (classification === 'TANGENT') {
    // Collinear courses on different planes have no miter wedge. Internal
    // seams stitch through agreement; groups fail closed at their gate.
    if (!sameXyz(q1, q2)) return { ok: false, code: 'CORNER_COINCIDENT_PLANES', detail: 'GRADING_CORNER_SEAM' };
    const run = [{ ...q1 }];
    return {
      ok: true,
      value: {
        coincident: false,
        tie: { ...q1 }, ray: { mx: nIn.nx, my: nIn.ny }, extent: 0,
        cornerRun: run, path1: run, path2: [],
        patchTris: [], inDaylight, outDaylight, inTris, outTris,
        segmentCount: 0, rootCount: 1,
      },
    };
  }
  const ray = selectMiterRay(seam, nIn, nOut);
  if (!ray || 'inverted' in ray) return { ok: false, code: 'CORNER_INVERTED', detail: 'GRADING_CORNER_RAY' };
  if ('ambiguous' in ray) return { ok: false, code: 'CORNER_AMBIGUOUS', detail: 'GRADING_CORNER_RAY' };
  const tMax = miterExtent(ray, nIn, nOut, maxSearchDistance);
  if (tMax === null) return { ok: false, code: 'CORNER_MAX_DISTANCE', detail: 'GRADING_CORNER_EXTENT' };
  const tie = solveMiterTie(target, candidates, query, plane1, vx, vy, ray.mx, ray.my, tMax);
  if (!tie.ok) return { ok: false, code: tie.code, detail: 'GRADING_CORNER_TIE' };
  const tieZ2 = planeElevationAt(plane2, tie.x, tie.y);
  // Second-plane agreement under the anchored elevation contract (20J1):
  // the tie sits on the miter seam by construction, so any residual is
  // evaluation error (single world-scale per axis), never model error.
  if (
    tieZ2 === null ||
    Math.abs(tieZ2 - tie.z) >
      elevationAgreementTol(tieZ2, tie.z, [
        ...planeLeverage(plane1, tie.x, tie.y),
        ...planeLeverage(plane2, tie.x, tie.y),
      ]) +
        AGREEMENT_FLOOR
  ) {
    return { ok: false, code: 'CORNER_NO_SOLUTION', detail: 'GRADING_CORNER_SEAM_DISAGREE' };
  }
  // Sector bounds: strip half-planes + corner-normal wall + miter half-plane.
  // GAP sectors are the corner wedges (wall keeps the tie side); OVERLAP
  // sectors stay member-side (wall keeps the member mid) and start at the
  // trimmed seam crossing, so the locus graph holds exactly one path.
  const miterLine: SectorLine = { vx, vy, mx: ray.mx, my: ray.my };
  const sectorBounds = (
    t: PlanVector, n: PlanVector, wallKeep: SectorPoint, keepN: SectorPoint,
  ): Array<{ line: SectorLine; keep: SectorPoint }> => [
    { line: { vx, vy, mx: t.nx, my: t.ny }, keep: keepN },
    {
      line: { vx: vx + n.nx * maxSearchDistance, vy: vy + n.ny * maxSearchDistance, mx: t.nx, my: t.ny },
      keep: { x: vx, y: vy },
    },
    { line: { vx, vy, mx: n.nx, my: n.ny }, keep: wallKeep },
    { line: miterLine, keep: keepN },
  ];
  const keepN1: SectorPoint = { x: vx + nIn.nx, y: vy + nIn.ny };
  const keepN2: SectorPoint = { x: vx + nOut.nx, y: vy + nOut.ny };
  const tiePoint = { x: tie.x, y: tie.y, z: tie.z };
  if (classification === 'OVERLAP') {
    // OVERLAP: trim both member meshes + daylight to the miter seam first;
    // sector paths then run from the trimmed seam crossings to the tie.
    const trimWith = (tris: MergeTriangle[], keep: SectorPoint): MergeTriangle[] => {
      const out: MergeTriangle[] = [];
      for (const t of tris) out.push(...clipTriangleToHalfPlane(t, miterLine, keep));
      return out;
    };
    inTris = trimWith(inTris, midIn);
    outTris = trimWith(outTris, midOut);
    inDaylight = clipPolylineToHalfPlane(inDaylight, miterLine, midIn);
    outDaylight = clipPolylineToHalfPlane(outDaylight, miterLine, midOut);
    if (inDaylight.length === 0 || outDaylight.length === 0) {
      return { ok: false, code: 'CORNER_NO_SOLUTION', detail: 'GRADING_CORNER_TRIM' };
    }
  }
  const from1 = classification === 'GAP' ? q1 : inDaylight[inDaylight.length - 1]!;
  const from2 = classification === 'GAP' ? q2 : outDaylight[0]!;
  const wall1: SectorPoint = classification === 'GAP' ? tiePoint : midIn;
  const wall2: SectorPoint = classification === 'GAP' ? tiePoint : midOut;
  const path1 = solveSectorPath(
    target, candidates, query, plane1,
    sectorBounds(tIn, nIn, wall1, keepN1),
    from1, tie,
  );
  if (!path1.ok) return { ok: false, code: path1.code, detail: 'GRADING_CORNER_SECTOR' };
  const path2 = solveSectorPath(
    target, candidates, query, plane2,
    sectorBounds(tOut, nOut, wall2, keepN2),
    from2, tie,
  );
  if (!path2.ok) return { ok: false, code: path2.code, detail: 'GRADING_CORNER_SECTOR' };
  const segmentCount = 1 + path1.segmentCount + path2.segmentCount;
  const patchTris: MergeTriangle[] = [];
  // Exact shared endpoints: the merged mesh dedups vertices by bitwise
  // value, so the corner run + patch ring reuse the authoritative tip/tie
  // values (chord/member solves, miter root) instead of their snapped
  // grid twins. Snapped-vs-exact differ only off-grid (arc joints); on-grid
  // geometry this substitution is the identity, byte for byte.
  // Wedge-coincident nodes (zero-width OVERLAP wedges: trimmed tips + tie
  // within one quantum) canonicalize to the tie, so adjacent strips and
  // the fan share indices instead of T-junctioning on quantum twins.
  const canon = (p: MergePoint): MergePoint =>
    samePlanNode(p, tie) ? { x: tie.x, y: tie.y, z: tie.z } : { ...p };
  const tip1 = canon(from1);
  const tip2 = canon(from2);
  const knot = { x: tie.x, y: tie.y, z: tie.z };
  inDaylight[inDaylight.length - 1] = canon(inDaylight[inDaylight.length - 1]!);
  outDaylight[0] = canon(outDaylight[0]!);
  let cornerRun: MergePoint[];
  if (classification === 'GAP') {
    // Two planar patch polygons fanned deterministically from V.
    const ring: MergePoint[] = [tip1];
    for (let k = 1; k + 1 < path1.path.length; k += 1) ring.push({ ...path1.path[k]! });
    ring.push(knot);
    for (let k = path2.path.length - 2; k >= 1; k -= 1) ring.push({ ...path2.path[k]! });
    ring.push(tip2);
    const v: MergePoint = { x: vx, y: vy, z: vz };
    for (let k = 0; k + 1 < ring.length; k += 1) {
      const tri: MergeTriangle = { a: v, b: ring[k]!, c: ring[k + 1]! };
      const area2 = (tri.b.x - tri.a.x) * (tri.c.y - tri.a.y) - (tri.c.x - tri.a.x) * (tri.b.y - tri.a.y);
      if (Math.abs(area2) <= zeroDelta(area2, 0)) continue;
      patchTris.push(tri);
    }
    cornerRun = [...ring];
  } else {
    // OVERLAP: meshes and daylight already trimmed; the corner run joins
    // the two seam-crossing sector paths through the tie.
    cornerRun = [tip1];
    for (let k = 1; k + 1 < path1.path.length; k += 1) cornerRun.push({ ...path1.path[k]! });
    cornerRun.push(knot);
    for (let k = path2.path.length - 2; k >= 1; k -= 1) cornerRun.push({ ...path2.path[k]! });
    cornerRun.push(tip2);
  }
  // Collapse snap-duplicate consecutive nodes (zero-length sector paths
  // when a tip already sits on the tie): same plan node up to one
  // coordinate quantum; first wins for strip continuity.
  const collapsed: MergePoint[] = [];
  for (const p of cornerRun) {
    const prev = collapsed[collapsed.length - 1];
    if (prev !== undefined && samePlanNode(prev, p)) continue;
    collapsed.push(p);
  }
  cornerRun = collapsed;
  return {
    ok: true,
    value: {
      coincident: false,
      tie: { ...tie }, ray: { ...ray }, extent: tMax,
      cornerRun,
      path1: path1.path.map((p) => ({ ...p })),
      path2: path2.path.map((p) => ({ ...p })),
      patchTris, inDaylight, outDaylight, inTris, outTris,
      segmentCount, rootCount: tie.rootCount,
    },
  };
};
