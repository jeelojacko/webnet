/**
 * Phase 20I — surface×analytic corner feasibility study core (PURE, evidence only).
 *
 * Production stays frozen: mixed surface+analytic groups fail closed in
 * `computeGradingGroupFromSnapshots`. This module answers the feasibility
 * question WITHOUT touching production: given one surface member and one
 * analytic member sharing a joint vertex V, independently resolve the
 * surface TIN tie (existing `solveMiterTie`) and the analytic tie (existing
 * `analyticTerminalLine` × shared seam ray) and classify the outcome.
 *
 * Reuse rule: every geometric/numeric authority is an imported existing
 * helper. New glue is only the seam-ray × terminal-line intersection, the
 * independent-tie comparison, and the outcome classification. No formulas
 * are copied; no tolerance is invented (shared 18I `zeroDelta` only).
 */
import { zeroDelta } from '../src/engine/cad/surfaces/volume/zero';
import { gradingSideNormal, type PlanVector } from '../src/engine/cad/grading/gradingCourseFrame';
import {
  classifyCorner,
  cutFillSideAtCorner,
  gradingPlaneGradient,
  miterExtent,
  miterSeam,
  planeElevationAt,
  selectMiterRay,
  type CornerGradingPlane,
} from '../src/engine/cad/grading/gradingCornerMath';
import { analyticTerminalLine } from '../src/engine/cad/grading/gradingGroupAnalyticCorners';
import { clipPolylineToHalfPlane, solveMiterTie } from '../src/engine/cad/grading/gradingGroupSectors';
import { buildTargetQuery, candidateTriangles } from '../src/engine/cad/grading/gradingTargetIndex';
import {
  clipTriangleToHalfPlane,
  mergeGroupTriangles,
  validateGroupMesh,
  type MergePoint,
  type MergeTriangle,
} from '../src/engine/cad/grading/gradingGroupMerge';
import { solveGradingChord } from '../src/engine/cad/grading/solveAnalyticGradingChord';
import type {
  GradingCriterion,
  GradingSide,
  ResolvedGradingSource,
} from '../src/engine/cad/grading/gradingTypes';
import type { GradingTargetMeshSnapshot } from '../src/engine/cad/grading/gradingComputeTypes';

/** Evidence-only outcome taxonomy (never touches production enums). */
export type SurfaceAnalyticOutcome =
  | 'EXACT_COMMON_TIE'
  | 'TRANSITION_REQUIRED'
  | 'SURFACE_TARGET_GAP'
  | 'SURFACE_NO_ROOT'
  | 'SURFACE_BRANCH_DISCONTINUITY'
  | 'ANALYTIC_LINE_INVALID'
  | 'ANALYTIC_SEAM_PARALLEL'
  | 'ANALYTIC_TIE_BEHIND_VERTEX'
  | 'ROOT_POLICY_CONFLICT'
  | 'SIDE_REJECT'
  | 'MAX_EXTENT_REJECT'
  | 'PLANE_DEGENERATE'
  | 'SEAM_DEGENERATE'
  | 'NON_FINITE_INPUT'
  | 'MESH_PROTOTYPE_FAILED'
  | 'SOURCE_JOINT_MISMATCH';

export interface TiePoint {
  x: number;
  y: number;
  z: number;
}

export interface CornerFanMesh {
  points: number[];
  triangles: number[];
  planArea: number;
  area3d: number;
  valid: boolean;
}

export interface SurfaceAnalyticCornerInput {
  /** Joint vertex (resolved source end == next source start). */
  vx: number;
  vy: number;
  vz: number;
  /** Surface member source (full chord, joint at one end). */
  surfaceMember: ResolvedGradingSource;
  /** True when the surface member is incoming (joint at its end). */
  surfaceIncoming: boolean;
  /** Analytic member source (full chord, joint at one end). */
  analyticMember: ResolvedGradingSource;
  /** True when the analytic member is incoming (joint at its end). */
  analyticIncoming: boolean;
  side: GradingSide;
  surfaceCriterion: GradingCriterion;
  analyticCriterion: GradingCriterion;
  maxSearchDistance: number;
  target: GradingTargetMeshSnapshot;
  /** Build the GAP/OVERLAP prototype mesh on an exact tie. */
  buildMesh?: boolean;
}

export interface SurfaceAnalyticCornerResult {
  outcome: SurfaceAnalyticOutcome;
  detail?: string;
  turn: 'GAP' | 'OVERLAP' | 'TANGENT' | null;
  cutFill: 'CUT' | 'FILL' | 'TIED' | null;
  surfaceTie: TiePoint | null;
  analyticTie: TiePoint | null;
  /** Distinct surface-tie roots reported by `solveMiterTie`. */
  rootCount: number;
  /** |tie − V| of the analytic tie (== surface extent when exact). */
  extent: number | null;
  seamParamSurface: number | null;
  seamParamAnalytic: number | null;
  xyGap: number | null;
  zGap: number | null;
  /** Surface daylight endpoint at the joint station. */
  qs: TiePoint | null;
  /** Analytic limit endpoint at the joint station. */
  qa: TiePoint | null;
  mesh: CornerFanMesh | null;
}

const finiteAll = (values: number[]): boolean => values.every((v) => Number.isFinite(v));

const cross2 = (ax: number, ay: number, bx: number, by: number): number => ax * by - ay * bx;

/** Unit tangent of a member in traversal direction; null when degenerate. */
const memberTangent = (m: ResolvedGradingSource): PlanVector | null => {
  if (!finiteAll([m.startX, m.startY, m.endX, m.endY, m.startZ, m.endZ, m.length])) return null;
  const dx = m.endX - m.startX;
  const dy = m.endY - m.startY;
  const len = Math.hypot(dx, dy);
  if (!(len > 0) || !Number.isFinite(len)) return null;
  return { nx: dx / len, ny: dy / len };
};

/** Corner plane through V along tangent t: gradient gs·T + g·N (existing helper). */
const planeThroughV = (
  vx: number, vy: number, vz: number,
  t: PlanVector, side: GradingSide, gCross: number, gsLong: number,
): CornerGradingPlane | null => {
  if (!finiteAll([vx, vy, vz, gCross, gsLong])) return null;
  const pseudo: ResolvedGradingSource = {
    startX: vx, startY: vy, endX: vx + t.nx, endY: vy + t.ny,
    startZ: vz, endZ: vz + gsLong, length: 1, reoriented: false, isArc: false,
  };
  return gradingPlaneGradient(pseudo, side, gCross, gsLong);
};

const sameTol = (a: number, b: number): boolean => Math.abs(a - b) <= zeroDelta(a, b);

/** Shoelace plan area + 3D area over flat XYZ triangles (generic math). */
const meshAreas = (points: number[], triangles: number[]): { planArea: number; area3d: number } => {
  let planArea = 0;
  let area3d = 0;
  const at = (i: number): [number, number, number] => [points[i * 3]!, points[i * 3 + 1]!, points[i * 3 + 2]!];
  for (let f = 0; f + 2 < triangles.length; f += 3) {
    const [ax, ay, az] = at(triangles[f]!);
    const [bx, by, bz] = at(triangles[f + 1]!);
    const [cx, cy, cz] = at(triangles[f + 2]!);
    planArea += Math.abs((bx - ax) * (cy - ay) - (cx - ax) * (by - ay)) / 2;
    const ux = bx - ax;
    const uy = by - ay;
    const uz = bz - az;
    const vx = cx - ax;
    const vy = cy - ay;
    const vz = cz - az;
    area3d += Math.hypot(uy * vz - uz * vy, uz * vx - ux * vz, ux * vy - uy * vx) / 2;
  }
  return { planArea, area3d };
};

interface FrameOf {
  t: PlanVector;
  n: PlanVector;
  gs: number;
}

const frameOf = (m: ResolvedGradingSource, side: GradingSide): FrameOf | null => {
  const t = memberTangent(m);
  if (!t) return null;
  const n = gradingSideNormal(t.nx, t.ny, side);
  if (!n) return null;
  const gs = (m.endZ - m.startZ) / m.length;
  if (!Number.isFinite(gs)) return null;
  return { t, n, gs };
};

/**
 * Resolve one surface×analytic corner: surface TIN tie and analytic tie are
 * derived independently, then compared under the shared `zeroDelta` floor.
 */
export const resolveSurfaceAnalyticCorner = (
  input: SurfaceAnalyticCornerInput,
): SurfaceAnalyticCornerResult => {
  const blank: SurfaceAnalyticCornerResult = {
    outcome: 'NON_FINITE_INPUT', turn: null, cutFill: null,
    surfaceTie: null, analyticTie: null, rootCount: 0, extent: null,
    seamParamSurface: null, seamParamAnalytic: null, xyGap: null, zGap: null,
    qs: null, qa: null, mesh: null,
  };
  const done = (outcome: SurfaceAnalyticOutcome, detail?: string): SurfaceAnalyticCornerResult =>
    detail === undefined ? { ...blank, outcome } : { ...blank, outcome, detail };
  const { vx, vy, vz, side, maxSearchDistance, target } = input;
  if (!finiteAll([vx, vy, vz, maxSearchDistance]) || !(maxSearchDistance > 0)) {
    return done('NON_FINITE_INPUT', 'bad-vertex-or-search');
  }
  if (!target || !Array.isArray(target.points) || !Array.isArray(target.triangles)) {
    return done('NON_FINITE_INPUT', 'bad-target-shape');
  }
  if (!target.points.every((v) => Number.isFinite(v))) return done('NON_FINITE_INPUT', 'non-finite-target');
  const sFrame = frameOf(input.surfaceMember, side);
  const aFrame = frameOf(input.analyticMember, side);
  if (!sFrame || !aFrame) return done('PLANE_DEGENERATE', 'degenerate-member');
  // Joint continuity: V must be the surface/analytic member ends as ordered.
  const sJoint = input.surfaceIncoming
    ? { x: input.surfaceMember.endX, y: input.surfaceMember.endY }
    : { x: input.surfaceMember.startX, y: input.surfaceMember.startY };
  const aJoint = input.analyticIncoming
    ? { x: input.analyticMember.endX, y: input.analyticMember.endY }
    : { x: input.analyticMember.startX, y: input.analyticMember.startY };
  if (!sameTol(sJoint.x, vx) || !sameTol(sJoint.y, vy) || !sameTol(aJoint.x, vx) || !sameTol(aJoint.y, vy)) {
    return done('PLANE_DEGENERATE', 'joint-mismatch');
  }
  // Joint-Z continuity (production mirror): production requires exact XYZ
  // equality of the shared vertex (`exactXyz`, gradingGroupCompute.ts:99-100;
  // gate :281-285). Study members are exact-typed literals, so mirror with
  // `===` (not `zeroDelta`): both members' joint Z must equal each other
  // and `vz`, checked BEFORE either plane is built. Otherwise both planes
  // are constructed through the supplied `vz` and a discontinuous source
  // joint still reports EXACT_COMMON_TIE on fabricated geometry.
  const sJointZ = input.surfaceIncoming ? input.surfaceMember.endZ : input.surfaceMember.startZ;
  const aJointZ = input.analyticIncoming ? input.analyticMember.endZ : input.analyticMember.startZ;
  if (!(sJointZ === vz && aJointZ === vz && sJointZ === aJointZ)) {
    return done('SOURCE_JOINT_MISMATCH', 'joint-z-mismatch');
  }
  const inFrame = input.surfaceIncoming ? sFrame : aFrame;
  const outFrame = input.surfaceIncoming ? aFrame : sFrame;
  const turn = classifyCorner(inFrame.t, outFrame.t, side);
  if (!turn) return done('SEAM_DEGENERATE', 'degenerate-turn');
  blank.turn = turn;
  // Surface cross grade at V: fixed ratio, or the cut/fill pick from the
  // existing target-minus-source sign convention at the corner vertex.
  const query = buildTargetQuery(target);
  if (!query) return done('SURFACE_TARGET_GAP', 'bad-target-mesh');
  const ztV = query.elevationAt(vx, vy);
  if (ztV === null) return { ...blank, outcome: 'SURFACE_TARGET_GAP', detail: 'gap-at-V' };
  const relation = cutFillSideAtCorner(ztV, vz);
  if (!relation) return done('NON_FINITE_INPUT', 'bad-corner-elevations');
  blank.cutFill = relation;
  let gSurface: number | null = null;
  const sc = input.surfaceCriterion;
  if (sc.kind === 'fixed') {
    gSurface = Number.isFinite(sc.gradeRatio) ? sc.gradeRatio : null;
  } else if (sc.kind === 'cut-fill') {
    if (!Number.isFinite(sc.cutGradeRatio) || !Number.isFinite(sc.fillGradeRatio)) gSurface = null;
    else gSurface = relation === 'CUT' ? sc.cutGradeRatio : relation === 'FILL' ? sc.fillGradeRatio : 0;
  } else {
    return done('ANALYTIC_LINE_INVALID', 'surface-slot-holds-analytic');
  }
  if (gSurface === null || !Number.isFinite(gSurface)) return done('NON_FINITE_INPUT', 'non-finite-grade');
  const ac = input.analyticCriterion;
  const gAnalytic = ac.kind === 'fixed' || ac.kind === 'cut-fill'
    ? NaN
    : ac.gradeRatio;
  if (!Number.isFinite(gAnalytic)) return done('NON_FINITE_INPUT', 'non-finite-analytic-grade');
  const planeS = planeThroughV(vx, vy, vz, sFrame.t, side, gSurface, sFrame.gs);
  const planeA = planeThroughV(vx, vy, vz, aFrame.t, side, gAnalytic, aFrame.gs);
  if (!planeS || !planeA) return done('PLANE_DEGENERATE', 'degenerate-plane');
  const seam = miterSeam(planeS, planeA);
  if (!seam) return done('SEAM_DEGENERATE', 'non-finite-seam');
  if ('coincident' in seam) return done('PLANE_DEGENERATE', 'coincident-planes');
  const ray = selectMiterRay(seam, sFrame.n, aFrame.n);
  if (!ray) return done('SEAM_DEGENERATE', 'non-finite-ray');
  if ('inverted' in ray || 'ambiguous' in ray) {
    return { ...blank, outcome: 'SIDE_REJECT', detail: 'inverted' in ray ? 'inverted-ray' : 'ambiguous-ray' };
  }
  const tMax = miterExtent(ray, sFrame.n, aFrame.n, maxSearchDistance);
  if (tMax === null) return { ...blank, outcome: 'SIDE_REJECT', detail: 'no-extent' };
  // Surface tie: nearest valid outward root (existing policy, never a later root).
  const candidates = candidateTriangles(target, [
    { x: vx - maxSearchDistance, y: vy - maxSearchDistance },
    { x: vx + maxSearchDistance, y: vy - maxSearchDistance },
    { x: vx + maxSearchDistance, y: vy + maxSearchDistance },
    { x: vx - maxSearchDistance, y: vy + maxSearchDistance },
  ]);
  if (!candidates) return done('SURFACE_TARGET_GAP', 'bad-candidates');
  const sTie = solveMiterTie(target, candidates, query, planeS, vx, vy, ray.mx, ray.my, tMax);
  if (!sTie.ok) {
    const outcome = sTie.code === 'CORNER_TARGET_GAP'
      ? 'SURFACE_TARGET_GAP'
      : sTie.code === 'CORNER_BRANCH_DISCONTINUITY' ? 'SURFACE_BRANCH_DISCONTINUITY' : 'SURFACE_NO_ROOT';
    return { ...blank, outcome, rootCount: 0 };
  }
  blank.rootCount = sTie.rootCount;
  blank.seamParamSurface = sTie.t;
  const surfaceTie: TiePoint = { x: sTie.x, y: sTie.y, z: sTie.z };
  blank.surfaceTie = surfaceTie;
  // Analytic tie: existing terminal line × selected shared seam ray. The
  // line is pure limit geometry (unbounded: it exists wherever the
  // criterion resolves); the search bound applies at the extent gate below.
  const line = analyticTerminalLine(vx, vy, vz, aFrame.t, aFrame.n, aFrame.gs, ac, Number.MAX_VALUE);
  if (!line) return { ...blank, outcome: 'ANALYTIC_LINE_INVALID' };
  const det = cross2(ray.mx, ray.my, line.dx, line.dy);
  if (Math.abs(det) <= zeroDelta(det, 0)) return { ...blank, outcome: 'ANALYTIC_SEAM_PARALLEL' };
  const rx = line.ox - vx;
  const ry = line.oy - vy;
  const tA = cross2(rx, ry, line.dx, line.dy) / det;
  const uA = cross2(rx, ry, ray.mx, ray.my) / det;
  if (!finiteAll([tA, uA])) return done('NON_FINITE_INPUT', 'non-finite-intersection');
  if (tA < -zeroDelta(tA, 0)) return { ...blank, outcome: 'ANALYTIC_TIE_BEHIND_VERTEX', detail: `t=${tA}` };
  const analyticTie: TiePoint = {
    x: vx + ray.mx * tA,
    y: vy + ray.my * tA,
    z: line.oz + uA * line.dz,
  };
  if (!finiteAll([analyticTie.x, analyticTie.y, analyticTie.z])) {
    return done('NON_FINITE_INPUT', 'non-finite-analytic-tie');
  }
  blank.analyticTie = analyticTie;
  blank.seamParamAnalytic = tA;
  blank.extent = Math.hypot(analyticTie.x - vx, analyticTie.y - vy);
  // Gates on the analytic tie: side half-planes, miter bound, line/plane agreement.
  const sideS = (analyticTie.x - vx) * sFrame.n.nx + (analyticTie.y - vy) * sFrame.n.ny;
  const sideA = (analyticTie.x - vx) * aFrame.n.nx + (analyticTie.y - vy) * aFrame.n.ny;
  if (sideS < -zeroDelta(sideS, 0) || sideA < -zeroDelta(sideA, 0)) {
    return { ...blank, outcome: 'SIDE_REJECT', detail: 'analytic-side' };
  }
  if (blank.extent > tMax + zeroDelta(blank.extent, tMax)) {
    return { ...blank, outcome: 'MAX_EXTENT_REJECT', detail: `extent=${blank.extent}` };
  }
  const planeZatA = planeElevationAt(planeA, analyticTie.x, analyticTie.y);
  if (planeZatA === null || !sameTol(planeZatA, analyticTie.z)) {
    return { ...blank, outcome: 'ANALYTIC_LINE_INVALID', detail: 'line-plane-disagree' };
  }
  // Exact acceptance: ties agree in XY/Z and seam param; both planes agree
  // with their authority (target for surface, terminal line for analytic).
  const xyOk = sameTol(surfaceTie.x, analyticTie.x) && sameTol(surfaceTie.y, analyticTie.y);
  const zOk = sameTol(surfaceTie.z, analyticTie.z);
  const paramOk = sameTol(sTie.t, tA);
  blank.xyGap = Math.hypot(surfaceTie.x - analyticTie.x, surfaceTie.y - analyticTie.y);
  blank.zGap = Math.abs(surfaceTie.z - analyticTie.z);
  const ztCommon = query.elevationAt(analyticTie.x, analyticTie.y);
  const targetOk = ztCommon !== null && sameTol(ztCommon, surfaceTie.z);
  if (xyOk && zOk && paramOk && targetOk) {
    const full: SurfaceAnalyticCornerResult = { ...blank, outcome: 'EXACT_COMMON_TIE' };
    const ctx: JointContext = {
      sFrame, aFrame, planeS,
      line: { ox: line.ox, oy: line.oy, oz: line.oz },
      candidates, query,
    };
    full.qs = jointQs(input, ctx);
    full.qa = jointQa(ctx);
    if (input.buildMesh) full.mesh = buildPrototypeMesh(input, full, query, ctx);
    if (input.buildMesh && !full.mesh?.valid) full.outcome = 'MESH_PROTOTYPE_FAILED';
    return full;
  }
  // Both ties exist but disagree: analytic matching a LATER surface root is
  // a root-policy conflict (surface keeps the nearest root); else a gap.
  const planeZatAnalytic = planeElevationAt(planeS, analyticTie.x, analyticTie.y);
  const ztAnalytic = query.elevationAt(analyticTie.x, analyticTie.y);
  if (
    planeZatAnalytic !== null && ztAnalytic !== null &&
    sameTol(planeZatAnalytic, ztAnalytic) && sameTol(planeZatAnalytic, analyticTie.z)
  ) {
    return { ...blank, outcome: 'ROOT_POLICY_CONFLICT', detail: 'analytic-matches-later-root' };
  }
  return { ...blank, outcome: 'TRANSITION_REQUIRED', detail: 'tie-disagree' };
};

interface JointContext {
  sFrame: FrameOf;
  aFrame: FrameOf;
  planeS: CornerGradingPlane;
  line: { ox: number; oy: number; oz: number };
  candidates: number[];
  query: { elevationAt: (_x: number, _y: number) => number | null };
}

/**
 * Surface daylight at the joint station: the existing chord solve first
 * (identical to the strip endpoint on flat ground); falls back to the
 * existing `solveMiterTie` along the member side normal where the strict
 * 20B chord agreement gate refuses sloped targets.
 */
const jointQs = (input: SurfaceAnalyticCornerInput, ctx: JointContext): TiePoint | null => {
  const chord = solveGradingChord({
    source: { ...input.surfaceMember }, side: input.side, criterion: input.surfaceCriterion,
    maxSearchDistance: input.maxSearchDistance, target: input.target, query: ctx.query as never,
  });
  if (chord.ok && chord.solve.daylightPts.length > 0) {
    const p = input.surfaceIncoming
      ? chord.solve.daylightPts[chord.solve.daylightPts.length - 1]!
      : chord.solve.daylightPts[0]!;
    return { x: p.x, y: p.y, z: p.z };
  }
  const { vx, vy } = input;
  const tie = solveMiterTie(
    input.target, ctx.candidates, ctx.query as never, ctx.planeS,
    vx, vy, ctx.sFrame.n.nx, ctx.sFrame.n.ny, input.maxSearchDistance,
  );
  if (!tie.ok) return null;
  return { x: tie.x, y: tie.y, z: tie.z };
};

/**
 * Study probe for the production ray/edge-parallel quirk: `solveMiterTie`
 * along an arbitrary ray. Returns the raw outcome so evidence rows can
 * document where the shared interval code fails closed (axis-parallel ray
 * on axis-aligned triangulations returns no interval even when the ray
 * runs inside the target).
 */
export const studyRayTie = (
  target: GradingTargetMeshSnapshot,
  plane: CornerGradingPlane,
  ox: number, oy: number, mx: number, my: number, tMax: number,
): { ok: boolean; tie?: TiePoint; code?: string } => {
  const query = buildTargetQuery(target);
  if (!query) return { ok: false, code: 'bad-target' };
  const candidates = candidateTriangles(target, [
    { x: ox - tMax, y: oy - tMax }, { x: ox + tMax, y: oy - tMax },
    { x: ox + tMax, y: oy + tMax }, { x: ox - tMax, y: oy + tMax },
  ]);
  if (!candidates) return { ok: false, code: 'bad-candidates' };
  const tie = solveMiterTie(target, candidates, query, plane, ox, oy, mx, my, tMax);
  if (!tie.ok) return { ok: false, code: tie.code };
  return { ok: true, tie: { x: tie.x, y: tie.y, z: tie.z } };
};

/** Analytic limit at the joint station: the existing terminal-line origin. */
const jointQa = (ctx: JointContext): TiePoint | null =>
  finiteAll([ctx.line.ox, ctx.line.oy, ctx.line.oz])
    ? { x: ctx.line.ox, y: ctx.line.oy, z: ctx.line.oz }
    : null;

/**
 * GAP/OVERLAP prototype mesh from REAL member strips + actual joint
 * endpoints: GAP fans V→Qs→tie + V→tie→Qa; OVERLAP clips both strips to the
 * V→tie seam line. Merged under the normal validator, never relaxed.
 */
const buildPrototypeMesh = (
  input: SurfaceAnalyticCornerInput,
  resolved: SurfaceAnalyticCornerResult,
  query: { elevationAt: (_x: number, _y: number) => number | null },
  ctx: JointContext,
): CornerFanMesh | null => {
  const tie = resolved.analyticTie;
  if (!tie || resolved.turn === 'TANGENT') return null;
  const { vx, vy, vz } = input;
  const qs = resolved.qs ?? jointQs(input, ctx);
  const qa = resolved.qa ?? jointQa(ctx);
  if (!qs || !qa) return null;
  const v: MergePoint = { x: vx, y: vy, z: vz };
  const t: MergePoint = { x: tie.x, y: tie.y, z: tie.z };
  const s: MergePoint = { x: qs.x, y: qs.y, z: qs.z };
  const a: MergePoint = { x: qa.x, y: qa.y, z: qa.z };
  let tris: MergeTriangle[];
  if (resolved.turn === 'GAP') {
    tris = [{ a: v, b: s, c: t }, { a: v, b: t, c: a }];
  } else {
    // OVERLAP: real strips clipped to the V→tie seam, kept member-side.
    const span = Math.hypot(tie.x - vx, tie.y - vy);
    if (!(span > 0)) return null;
    const seamLine = { vx, vy, mx: (tie.x - vx) / span, my: (tie.y - vy) / span };
    const stripOf = (wantSurface: boolean): MergeTriangle[] | null => {
      const member = wantSurface ? input.surfaceMember : input.analyticMember;
      const criterion = wantSurface ? input.surfaceCriterion : input.analyticCriterion;
      const out = solveGradingChord({
        source: { ...member }, side: input.side, criterion,
        maxSearchDistance: input.maxSearchDistance, target: input.target, query: query as never,
      });
      if (!out.ok) return null;
      const src = out.solve.sourcePts;
      const dst = out.solve.daylightPts;
      const strip: MergeTriangle[] = [];
      for (let i = 0; i + 1 < src.length; i += 1) {
        const p = src[i]!;
        const q = src[i + 1]!;
        const r = dst[i + 1]!;
        const u = dst[i]!;
        strip.push({ a: p, b: q, c: r }, { a: p, b: r, c: u });
      }
      const mid = {
        x: (member.startX + member.endX) / 2,
        y: (member.startY + member.endY) / 2,
      };
      const clipped: MergeTriangle[] = [];
      for (const tri of strip) clipped.push(...clipTriangleToHalfPlane(tri, seamLine, mid));
      // Daylight polylines clip to the same seam (fail closed when fully cut).
      const kept = clipPolylineToHalfPlane(out.solve.daylightPts, seamLine, mid);
      if (kept.length === 0) return null;
      return clipped;
    };
    const inStrip = stripOf(true);
    const outStrip = stripOf(false);
    if (!inStrip || !outStrip) return null;
    tris = [...inStrip, ...outStrip];
  }
  const merged = mergeGroupTriangles(tris);
  const error = validateGroupMesh(merged);
  const { planArea, area3d } = meshAreas(merged.points, merged.triangles);
  return { points: merged.points, triangles: merged.triangles, planArea, area3d, valid: error === null };
};

/** Analytic×analytic tie via two existing terminal lines (square corners). */
export interface AnalyticPairTie {
  ok: boolean;
  tie?: TiePoint;
  extent?: number;
  detail?: string;
}

export const intersectAnalyticPair = (
  vx: number, vy: number, vz: number,
  inT: PlanVector, inN: PlanVector, inGs: number, inCriterion: GradingCriterion,
  outT: PlanVector, outN: PlanVector, outGs: number, outCriterion: GradingCriterion,
  maxSearchDistance: number,
): AnalyticPairTie => {
  const l1 = analyticTerminalLine(vx, vy, vz, inT, inN, inGs, inCriterion, maxSearchDistance);
  const l2 = analyticTerminalLine(vx, vy, vz, outT, outN, outGs, outCriterion, maxSearchDistance);
  if (!l1 || !l2) return { ok: false, detail: 'line-invalid' };
  const det = cross2(l1.dx, l1.dy, l2.dx, l2.dy);
  if (Math.abs(det) <= zeroDelta(det, 0)) return { ok: false, detail: 'parallel' };
  const rx = l2.ox - l1.ox;
  const ry = l2.oy - l1.oy;
  const u = cross2(rx, ry, l2.dx, l2.dy) / det;
  const w = cross2(rx, ry, l1.dx, l1.dy) / det;
  const tie: TiePoint = { x: l1.ox + u * l1.dx, y: l1.oy + u * l1.dy, z: l1.oz + u * l1.dz };
  if (!finiteAll([tie.x, tie.y, tie.z])) return { ok: false, detail: 'non-finite' };
  const z2 = l2.oz + w * l2.dz;
  if (!sameTol(tie.z, z2)) return { ok: false, detail: 'z-disagree' };
  return { ok: true, tie, extent: Math.hypot(tie.x - vx, tie.y - vy) };
};
