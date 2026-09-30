/**
 * Phase 20K — hybrid arc×arc feasibility CORE (STUDY, evidence only).
 *
 * ─────────────────────────────────────────────────────────────────────────
 * COORDINATION (Worker-CORE): this file carries two bounded sections sharing
 * one arc vocabulary. §A (GROUPS contract) is the arc-member + terminal-frame
 * + production-delegating corner API the GROUPS study imports — kept verbatim
 * under its original names. §B (CORE study) is the authoritative Worker-CORE
 * feasibility core: terminal-chord frames through the existing straight-corner
 * authorities with ARC_PAIR_* evidence-only outcomes. Nothing here routes
 * production; `src/` is untouched.
 * ─────────────────────────────────────────────────────────────────────────
 *
 * §6 terminal models. An arc member carries TWO candidate terminal frames at
 * each joint:
 *
 * - `chord`: the direction of the first/last linearized chord — exactly what
 *   production `computeGradingGroupFromSnapshots` feeds `solveHybridCorner`
 *   (`chordDir(chords[0])` / `chordDir(chords[last])`). This is the model the
 *   shipped arc paths already use, and it is tolerance-dependent.
 * - `true-tangent`: the exact tangent to the circle at the joint (perpendicular
 *   to the radius, traversal sign from `sweepCCW`). Tolerance-independent and
 *   the honest physical direction of a genuine arc course.
 *
 * The SOURCE geometry (the arc samples a strip is built from) is identical in
 * both models — only the terminal frame used at a corner changes. Production's
 * `solveHybridCorner` is deliberately frame-driven and DOES accept external
 * frames; the only reason a genuine arc×arc joint fails today is its explicit
 * `inIsArc && outIsArc → GRADING_SURFACE_ANALYTIC_ARC_PAIR_UNSUPPORTED` guard.
 * The study resolves arc-pair corners by supplying frames directly with the
 * arc flags cleared, which is exactly the question under study (does an
 * honest frame make the tie exact?).
 */
import { gradingSideNormal, type PlanVector } from '../src/engine/cad/grading/gradingCourseFrame';
import { linearizeGradingArc, type GradingArcSample } from '../src/engine/cad/grading/gradingCurve';
import type { GradingComputeSource } from '../src/engine/cad/grading/gradingComputeTypes';
import {
  solveHybridCorner,
  type HybridCornerOutcome,
} from '../src/engine/cad/grading/gradingGroupHybridCorners';
import type { GradingSide, ResolvedGradingArc, ResolvedGradingSource } from '../src/engine/cad/grading/gradingTypes';
// §B authorities (existing helpers only; no formula is copied, no tolerance invented).
import { zeroDelta } from '../src/engine/cad/surfaces/volume/zero';
import {
  classifyCorner,
  gradingPlaneGradient,
  miterExtent,
  miterSeam,
  planeElevationAt,
  selectMiterRay,
  type CornerGradingPlane,
} from '../src/engine/cad/grading/gradingCornerMath';
import { analyticTerminalLine } from '../src/engine/cad/grading/gradingGroupAnalyticCorners';
import {
  coordinateAgreementTol,
  elevationAgreementTol,
  planeLeverage,
  seamParameterAgreementTol,
  solveMiterTie,
} from '../src/engine/cad/grading/gradingGroupSectors';
import { buildTargetQuery, candidateTriangles } from '../src/engine/cad/grading/gradingTargetIndex';
import {
  mergeGroupTriangles,
  validateGroupMesh,
} from '../src/engine/cad/grading/gradingGroupMerge';
import { solveGradingChord } from '../src/engine/cad/grading/solveAnalyticGradingChord';
import type { GradingTargetMeshSnapshot } from '../src/engine/cad/grading/gradingComputeTypes';
import type { GradingCriterion } from '../src/engine/cad/grading/gradingTypes';

/* ═══════════════════════ §A — GROUPS contract (verbatim) ═══════════════════════ */

/** Terminal-frame model under study (§6). */
export type ArcTangentModel = 'chord' | 'true-tangent';

export interface ArcSpec {
  centerX: number;
  centerY: number;
  radius: number;
  startAngle: number;
  endAngle: number;
  sweepCCW: boolean;
  startZ: number;
  endZ: number;
}

export interface ArcPoint {
  x: number;
  y: number;
  z: number;
}

export interface ArcMember {
  spec: ArcSpec;
  /** Exact A->B endpoints on the circle. */
  start: ArcPoint;
  end: ArcPoint;
  /** Exact plan arc length R·sweep. */
  length: number;
  /** Production-shaped resolved source (isArc + arc params). */
  source: ResolvedGradingSource;
}

export interface ArcTerminalFrame {
  t: PlanVector;
  n: PlanVector;
  gs: number;
}

const TAU = Math.PI * 2;
const finiteAll = (values: number[]): boolean => values.every((v) => Number.isFinite(v));

/** Normalize any sweep into (0, TAU]; zero/full-circle fail closed. */
export const arcSweep = (spec: ArcSpec): number | null => {
  if (!finiteAll([spec.centerX, spec.centerY, spec.radius, spec.startAngle, spec.endAngle, spec.startZ, spec.endZ])) {
    return null;
  }
  if (!(spec.radius > 0)) return null;
  let sweep = spec.sweepCCW ? spec.endAngle - spec.startAngle : spec.startAngle - spec.endAngle;
  sweep = ((sweep % TAU) + TAU) % TAU;
  if (!(sweep > 0) || !Number.isFinite(sweep)) return null;
  return sweep;
};

const pointAt = (spec: ArcSpec, angle: number, z: number): ArcPoint => ({
  x: spec.centerX + spec.radius * Math.cos(angle),
  y: spec.centerY + spec.radius * Math.sin(angle),
  z,
});

/** Build a genuine arc member (exact endpoints, length, production source). */
export const makeArcMember = (spec: ArcSpec): ArcMember | null => {
  const sweep = arcSweep(spec);
  if (sweep === null) return null;
  const start = pointAt(spec, spec.startAngle, spec.startZ);
  const end = pointAt(spec, spec.endAngle, spec.endZ);
  const length = spec.radius * sweep;
  const arc: ResolvedGradingArc = {
    centerX: spec.centerX, centerY: spec.centerY, radius: spec.radius,
    startAngle: spec.startAngle, endAngle: spec.endAngle, sweepCCW: spec.sweepCCW,
  };
  const source: ResolvedGradingSource = {
    startX: start.x, startY: start.y, endX: end.x, endY: end.y,
    startZ: start.z, endZ: end.z, length, reoriented: false, isArc: true, arc,
  };
  return { spec, start, end, length, source };
};

/** Rotate an arc spec by `deg` about (cx, cy); endpoints/centre rotate rigidly. */
export const rotateArcSpec = (spec: ArcSpec, deg: number, cx: number, cy: number): ArcSpec => {
  const a = (deg * Math.PI) / 180;
  const c = Math.cos(a);
  const s = Math.sin(a);
  const rot = (x: number, y: number): [number, number] => [
    cx + (x - cx) * c - (y - cy) * s,
    cy + (x - cx) * s + (y - cy) * c,
  ];
  const [ncx, ncy] = rot(spec.centerX, spec.centerY);
  return {
    ...spec,
    centerX: ncx, centerY: ncy,
    startAngle: spec.startAngle + a,
    endAngle: spec.endAngle + a,
  };
};

/**
 * Exact traversal unit tangent at an arc end (true-tangent model). For a
 * CCW sweep the tangent is (-sinθ, cosθ); CW negates it. Null when the arc
 * spec is degenerate.
 */
export const arcTangentAt = (spec: ArcSpec, atEnd: boolean): PlanVector | null => {
  if (arcSweep(spec) === null) return null;
  const angle = atEnd ? spec.endAngle : spec.startAngle;
  if (!Number.isFinite(angle)) return null;
  const dir = spec.sweepCCW ? 1 : -1;
  return { nx: -dir * Math.sin(angle), ny: dir * Math.cos(angle) };
};

/** Plan length of the n-th equal-parameter chord of an arc spec. */
const chordDirOf = (a: ArcPoint, b: ArcPoint): PlanVector | null => {
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  const len = Math.hypot(dx, dy);
  if (!(len > 0) || !Number.isFinite(len)) return null;
  return { nx: dx / len, ny: dy / len };
};

/**
 * Linearized member chords as production-shaped sources (the 20B arc path).
 * Straight members linearize to a single chord. Returns null on failure.
 */
export const linearizeArcMember = (
  member: ArcMember,
  tolerance: number,
): GradingComputeSource[] | null => {
  if (!Number.isFinite(tolerance) || !(tolerance > 0)) return null;
  const linearized = linearizeGradingArc(
    member.spec.centerX, member.spec.centerY, member.spec.radius,
    member.spec.startAngle, member.spec.endAngle, member.spec.sweepCCW,
    member.spec.startZ, member.spec.endZ, tolerance,
  );
  if (!linearized) return null;
  const chords: GradingComputeSource[] = [];
  for (let k = 0; k + 1 < linearized.points.length; k += 1) {
    const p0 = linearized.points[k]!;
    const p1 = linearized.points[k + 1]!;
    const chordLen = Math.hypot(p1.x - p0.x, p1.y - p0.y);
    if (!(chordLen > 0) || !Number.isFinite(chordLen)) return null;
    chords.push({
      startX: p0.x, startY: p0.y, endX: p1.x, endY: p1.y,
      startZ: p0.z, endZ: p1.z, length: chordLen,
      reoriented: false, isArc: false,
    });
  }
  return chords.length > 0 ? chords : null;
};

/**
 * Terminal frame at one member end under the requested model. `tolerance`
 * is only consulted by the chord model (mirrors production's terminal-chord
 * direction). `gs` is the longitudinal grade (identical for both models —
 * Z is linear in arc length).
 */
export const arcTerminalFrame = (
  member: ArcMember,
  atEnd: boolean,
  model: ArcTangentModel,
  side: GradingSide,
  tolerance: number,
): ArcTerminalFrame | null => {
  let t: PlanVector | null = null;
  if (model === 'true-tangent') {
    t = arcTangentAt(member.spec, atEnd);
  } else {
    const chords = linearizeArcMember(member, tolerance);
    if (!chords) return null;
    const chord = atEnd ? chords[chords.length - 1]! : chords[0]!;
    t = chordDirOf(
      { x: chord.startX, y: chord.startY, z: chord.startZ },
      { x: chord.endX, y: chord.endY, z: chord.endZ },
    );
  }
  if (!t) return null;
  const n = gradingSideNormal(t.nx, t.ny, side);
  if (!n) return null;
  const gs = (member.spec.endZ - member.spec.startZ) / member.length;
  if (!Number.isFinite(gs)) return null;
  return { t, n, gs };
};

export interface ArcPairCornerInput {
  vx: number; vy: number; vz: number;
  inMember: ArcMember;
  outMember: ArcMember;
  inModel: ArcTangentModel;
  outModel: ArcTangentModel;
  side: GradingSide;
  tolerance: number;
  inCriterion: import('../src/engine/cad/grading/gradingTypes').GradingCriterion;
  outCriterion: import('../src/engine/cad/grading/gradingTypes').GradingCriterion;
  query: import('../src/engine/cad/grading/gradingComputeTypes').TargetQuery;
  target: import('../src/engine/cad/grading/gradingComputeTypes').GradingTargetMeshSnapshot;
  candidates: number[];
  maxSearchDistance: number;
  qs: { x: number; y: number; z: number };
  qa: { x: number; y: number; z: number };
  inStrip: import('../src/engine/cad/grading/gradingGroupMerge').MergeTriangle[];
  outStrip: import('../src/engine/cad/grading/gradingGroupMerge').MergeTriangle[];
  inDaylight: ArcPoint[];
  outDaylight: ArcPoint[];
  midIn: { x: number; y: number };
  midOut: { x: number; y: number };
}

/**
 * Resolve one genuine arc×arc hybrid joint. Computes each member's terminal
 * frame under its model and delegates the acceptance/mesh contract to the
 * production `solveHybridCorner` with the arc-pair guard cleared (the guard
 * is the subject under study, not a numeric authority). The production helper
 * still owns every gate: seam ray, nearest surface root, seam-param / XY / Z
 * agreement, side half-planes, miter extent, and the GAP/OVERLAP mesh build.
 */
export const resolveArcPairCorner = (input: ArcPairCornerInput): HybridCornerOutcome => {
  const inFrame = arcTerminalFrame(input.inMember, true, input.inModel, input.side, input.tolerance);
  const outFrame = arcTerminalFrame(input.outMember, false, input.outModel, input.side, input.tolerance);
  if (!inFrame || !outFrame) {
    return { ok: false, code: 'CORNER_NO_SOLUTION', detail: 'GRADING_SURFACE_ANALYTIC_LINE' };
  }
  return solveHybridCorner({
    vx: input.vx, vy: input.vy, vz: input.vz,
    inT: inFrame.t, inN: inFrame.n, inGs: inFrame.gs,
    outT: outFrame.t, outN: outFrame.n, outGs: outFrame.gs,
    side: input.side,
    inCriterion: input.inCriterion, outCriterion: input.outCriterion,
    query: input.query, target: input.target, candidates: input.candidates,
    maxSearchDistance: input.maxSearchDistance,
    qs: input.qs, qa: input.qa,
    inIsArc: false, outIsArc: false,
    inStrip: input.inStrip, outStrip: input.outStrip,
    inDaylight: input.inDaylight, outDaylight: input.outDaylight,
    midIn: input.midIn, midOut: input.midOut,
  });
};

export type { GradingArcSample };

/* ═══════════════════════ §B — CORE study (authoritative) ═══════════════════════ *
 *
 * Production stays frozen: arc×arc hybrid joints fail closed in
 * `solveHybridCorner` (`CORNER_NO_SOLUTION` /
 * `GRADING_SURFACE_ANALYTIC_ARC_PAIR_UNSUPPORTED`). This section answers the
 * feasibility question WITHOUT touching production: both arcs linearize at
 * one shared chord tolerance (§A `linearizeArcMember`, i.e. the existing
 * `linearizeGradingArc`), the two terminal chords at the joint V form
 * ordinary straight frames, and the corner resolves through the existing
 * straight-corner authorities (`solveMiterTie` + `analyticTerminalLine` × the
 * shared seam ray, 20J.1 agreement contracts).
 *
 * Source arc model (y-up, radians CCW from +X):
 * - P(th) = C + R·(cos th, sin th), traversal th0 → th1 (CCW here).
 * - Ttrue(th) = (-sin th, cos th) (unit, CCW traversal; §A `arcTangentAt`).
 * - Nright = (Ty, -Tx) (§A `gradingSideNormal` convention); Nleft = (-Ty, Tx).
 *   On a CCW arc Nright is radial-outward.
 * - gstrue = (endZ - startZ) / arcLength (0 here: both arcs run flat z=100).
 * Chord model at tolerance tol: n = `featureLineArcSubdivisions` segments of
 * angular step h = sweep/n; chord k joins P(th_k) → P(th_k+1) with
 * Tchord = normalize(P1 - P0), Nchord = side normal, gschord = ΔZ / |chord|.
 * h/2 rule: a chord's direction equals the true tangent at its midpoint, so
 * each terminal chord misses the joint tangent by exactly h/2 radians (half
 * the angular step).
 */

/** Evidence-only outcome taxonomy (never touches production enums). */
export type ArcPairOutcome =
  | 'ARC_PAIR_COMMON_TIE'
  | 'ARC_PAIR_CHORD_DEGENERATE'
  | 'ARC_PAIR_TRANSITION_REQUIRED'
  | 'ARC_PAIR_SURFACE_NO_ROOT'
  | 'ARC_PAIR_SIDE_REJECT'
  | 'ARC_PAIR_EXTENT_REJECT'
  | 'ARC_PAIR_SEAM_PARALLEL'
  | 'ARC_PAIR_NON_FINITE';

export interface ArcPairInput {
  vx: number;
  vy: number;
  vz: number;
  /** Incoming surface arc (joint at its end). */
  surfaceArc: ArcSpec;
  /** Outgoing analytic arc (joint at its start). */
  analyticArc: ArcSpec;
  side: GradingSide;
  surfaceCriterion: GradingCriterion;
  analyticCriterion: GradingCriterion;
  maxSearchDistance: number;
  target: GradingTargetMeshSnapshot;
  /** Shared chord tolerance for BOTH linearizations. */
  chordTolerance: number;
  buildMesh?: boolean;
}

export interface ArcFrame {
  t: PlanVector;
  n: PlanVector;
  gs: number;
  subdivisions: number;
  sagitta: number;
  /** Angular miss of the terminal chord vs the true joint tangent (h/2). */
  tangentError: number;
}

export interface ArcPairTie {
  x: number;
  y: number;
  z: number;
}

export interface ArcPairResult {
  outcome: ArcPairOutcome;
  detail?: string;
  turn: 'GAP' | 'OVERLAP' | 'TANGENT' | null;
  surfaceFrame: ArcFrame | null;
  analyticFrame: ArcFrame | null;
  /** cross(Ts, Ta): the chord-frame determinant (≈c²−s² at n=2). */
  frameDet: number | null;
  /** cross(seam ray, terminal-line dir): the tie-solve determinant. */
  solveDet: number | null;
  /** 1/|solveDet|: conditioning of the tie intersection. */
  condition: number | null;
  tie: ArcPairTie | null;
  extent: number | null;
  qs: ArcPairTie | null;
  qa: ArcPairTie | null;
  planArea: number | null;
  area3d: number | null;
  meshValid: boolean | null;
}

export interface ArcPairLadderRow {
  tolerance: number;
  subdivisionsSurface: number;
  subdivisionsAnalytic: number;
  sagittaSurface: number;
  sagittaAnalytic: number;
  tangentErrorSurface: number;
  tangentErrorAnalytic: number;
  frameDet: number | null;
  solveDet: number | null;
  condition: number | null;
  outcome: ArcPairOutcome;
  extent: number | null;
}

const cross2 = (ax: number, ay: number, bx: number, by: number): number => ax * by - ay * bx;

/**
 * Terminal-chord frame at the joint: the last chord (incoming) or the first
 * chord (outgoing) of the §A linearization, framed by the existing side
 * normal. Endpoints come from §A, never from local trig.
 */
const studyTerminalFrame = (
  arc: ArcSpec, incoming: boolean, side: GradingSide, tolerance: number,
): { member: GradingComputeSource; frame: ArcFrame } | null => {
  const sweep = arcSweep(arc);
  const member = makeArcMember(arc);
  const chords = member ? linearizeArcMember(member, tolerance) : null;
  if (sweep === null || !chords) return null;
  const chord = incoming ? chords[chords.length - 1]! : chords[0]!;
  const dx = chord.endX - chord.startX;
  const dy = chord.endY - chord.startY;
  const len = Math.hypot(dx, dy);
  if (!(len > 0) || !Number.isFinite(len)) return null;
  const t: PlanVector = { nx: dx / len, ny: dy / len };
  const n = gradingSideNormal(t.nx, t.ny, side);
  if (!n) return null;
  const gs = (chord.endZ - chord.startZ) / len;
  if (!Number.isFinite(gs)) return null;
  const nSeg = chords.length;
  return {
    member: chord,
    frame: {
      t, n, gs,
      subdivisions: nSeg,
      sagitta: arc.radius * (1 - Math.cos(sweep / (2 * nSeg))),
      tangentError: sweep / (2 * nSeg),
    },
  };
};

/** Corner plane through V along tangent t (the 20I/compute twin). */
const studyPlaneThroughV = (
  vx: number, vy: number, vz: number,
  t: PlanVector, side: GradingSide, gCross: number, gsLong: number,
): CornerGradingPlane | null => {
  const pseudo: ResolvedGradingSource = {
    startX: vx, startY: vy, endX: vx + t.nx, endY: vy + t.ny,
    startZ: vz, endZ: vz + gsLong, length: 1, reoriented: false, isArc: false,
  };
  return gradingPlaneGradient(pseudo, side, gCross, gsLong);
};

/** Shoelace plan area + 3D area over flat XYZ triangles (generic math). */
const studyMeshAreas = (points: number[], triangles: number[]): { planArea: number; area3d: number } => {
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

/**
 * Resolve one arc×arc hybrid joint through terminal-chord frames and the
 * existing straight-corner authorities. Acceptance uses the 20J.1
 * quantity-specific agreement contracts (never `zeroDelta` for X/Y/Z/t).
 */
export const resolveHybridArcPair = (input: ArcPairInput): ArcPairResult => {
  const blank: ArcPairResult = {
    outcome: 'ARC_PAIR_NON_FINITE', turn: null,
    surfaceFrame: null, analyticFrame: null, frameDet: null, solveDet: null,
    condition: null, tie: null, extent: null, qs: null, qa: null,
    planArea: null, area3d: null, meshValid: null,
  };
  const done = (outcome: ArcPairOutcome, detail?: string): ArcPairResult =>
    detail === undefined ? { ...blank, outcome } : { ...blank, outcome, detail };
  const { vx, vy, vz, side, maxSearchDistance, target, chordTolerance } = input;
  if (!finiteAll([vx, vy, vz, maxSearchDistance, chordTolerance])) return done('ARC_PAIR_NON_FINITE');
  if (!(maxSearchDistance > 0) || !(chordTolerance > 0)) return done('ARC_PAIR_NON_FINITE');
  const sTerm = studyTerminalFrame(input.surfaceArc, true, side, chordTolerance);
  const aTerm = studyTerminalFrame(input.analyticArc, false, side, chordTolerance);
  if (!sTerm || !aTerm) return done('ARC_PAIR_NON_FINITE', 'terminal-frame');
  const sFrame = sTerm.frame;
  const aFrame = aTerm.frame;
  const frameDet = cross2(sFrame.t.nx, sFrame.t.ny, aFrame.t.nx, aFrame.t.ny);
  const base = { ...blank, surfaceFrame: sFrame, analyticFrame: aFrame, frameDet };
  const fail = (outcome: ArcPairOutcome, detail?: string): ArcPairResult =>
    detail === undefined ? { ...base, outcome } : { ...base, outcome, detail };
  // One-chord band: antiparallel terminal chords (Na = −Ns) admit no seam
  // ray — parallel-inconsistent, the frozen production gate by another name.
  if (Math.abs(frameDet) <= zeroDelta(frameDet, 0)
    && sFrame.t.nx * aFrame.t.nx + sFrame.t.ny * aFrame.t.ny < 0) {
    return fail('ARC_PAIR_CHORD_DEGENERATE', 'antiparallel-terminal-chords');
  }
  const turn = classifyCorner(sFrame.t, aFrame.t, side);
  if (turn !== 'GAP') return fail('ARC_PAIR_TRANSITION_REQUIRED', 'non-gap-turn');
  base.turn = turn;
  if (input.surfaceCriterion.kind !== 'fixed' && input.surfaceCriterion.kind !== 'cut-fill') {
    return { ...base, outcome: 'ARC_PAIR_NON_FINITE', detail: 'surface-slot-holds-analytic' };
  }
  if (input.analyticCriterion.kind === 'fixed' || input.analyticCriterion.kind === 'cut-fill') {
    return { ...base, outcome: 'ARC_PAIR_NON_FINITE', detail: 'analytic-slot-holds-surface' };
  }
  const query = buildTargetQuery(target);
  if (!query) return { ...base, outcome: 'ARC_PAIR_SURFACE_NO_ROOT', detail: 'bad-target' };
  const ztV = query.elevationAt(vx, vy);
  if (ztV === null) return { ...base, outcome: 'ARC_PAIR_SURFACE_NO_ROOT', detail: 'gap-at-V' };
  const gSurface = input.surfaceCriterion.kind === 'fixed'
    ? input.surfaceCriterion.gradeRatio
    : ztV > vz ? input.surfaceCriterion.cutGradeRatio : input.surfaceCriterion.fillGradeRatio;
  if (!Number.isFinite(gSurface)) return { ...base, outcome: 'ARC_PAIR_NON_FINITE', detail: 'grade' };
  const gAnalytic = input.analyticCriterion.gradeRatio;
  if (!Number.isFinite(gAnalytic)) return { ...base, outcome: 'ARC_PAIR_NON_FINITE', detail: 'grade' };
  const planeS = studyPlaneThroughV(vx, vy, vz, sFrame.t, side, gSurface, sFrame.gs);
  const planeA = studyPlaneThroughV(vx, vy, vz, aFrame.t, side, gAnalytic, aFrame.gs);
  if (!planeS || !planeA) return { ...base, outcome: 'ARC_PAIR_NON_FINITE', detail: 'plane' };
  const seam = miterSeam(planeS, planeA);
  if (!seam || 'coincident' in seam) {
    return { ...base, outcome: 'ARC_PAIR_TRANSITION_REQUIRED', detail: 'coincident-planes' };
  }
  const ray = selectMiterRay(seam, sFrame.n, aFrame.n);
  if (!ray || 'ambiguous' in ray || 'inverted' in ray) {
    return { ...base, outcome: 'ARC_PAIR_SIDE_REJECT', detail: 'ray' };
  }
  const tMax = miterExtent(ray, sFrame.n, aFrame.n, maxSearchDistance);
  if (tMax === null) return { ...base, outcome: 'ARC_PAIR_EXTENT_REJECT', detail: 'no-extent' };
  const candidates = candidateTriangles(target, [
    { x: vx - maxSearchDistance, y: vy - maxSearchDistance },
    { x: vx + maxSearchDistance, y: vy - maxSearchDistance },
    { x: vx + maxSearchDistance, y: vy + maxSearchDistance },
    { x: vx - maxSearchDistance, y: vy + maxSearchDistance },
  ]);
  if (!candidates) return { ...base, outcome: 'ARC_PAIR_SURFACE_NO_ROOT', detail: 'candidates' };
  const sTie = solveMiterTie(target, candidates, query, planeS, vx, vy, ray.mx, ray.my, tMax);
  if (!sTie.ok) return { ...base, outcome: 'ARC_PAIR_SURFACE_NO_ROOT', detail: sTie.code };
  const line = analyticTerminalLine(
    vx, vy, vz, aFrame.t, aFrame.n, aFrame.gs, input.analyticCriterion, maxSearchDistance,
  );
  if (!line) return { ...base, outcome: 'ARC_PAIR_NON_FINITE', detail: 'terminal-line' };
  const solveDet = cross2(ray.mx, ray.my, line.dx, line.dy);
  if (Math.abs(solveDet) <= zeroDelta(solveDet, 0)) {
    return { ...base, outcome: 'ARC_PAIR_SEAM_PARALLEL', frameDet, solveDet };
  }
  const condition = 1 / Math.abs(solveDet);
  const rx = line.ox - vx;
  const ry = line.oy - vy;
  const tA = cross2(rx, ry, line.dx, line.dy) / solveDet;
  const uA = cross2(rx, ry, ray.mx, ray.my) / solveDet;
  if (!finiteAll([tA, uA])) return { ...base, outcome: 'ARC_PAIR_NON_FINITE', detail: 'tie' };
  if (tA < -zeroDelta(tA, 0)) return { ...base, outcome: 'ARC_PAIR_TRANSITION_REQUIRED', detail: 'tie-behind-V' };
  const tie: ArcPairTie = { x: vx + ray.mx * tA, y: vy + ray.my * tA, z: line.oz + uA * line.dz };
  if (!finiteAll([tie.x, tie.y, tie.z])) return { ...base, outcome: 'ARC_PAIR_NON_FINITE', detail: 'tie' };
  const extent = Math.hypot(tie.x - vx, tie.y - vy);
  const sideS = (tie.x - vx) * sFrame.n.nx + (tie.y - vy) * sFrame.n.ny;
  const sideA = (tie.x - vx) * aFrame.n.nx + (tie.y - vy) * aFrame.n.ny;
  if (sideS < -zeroDelta(sideS, 0) || sideA < -zeroDelta(sideA, 0)) {
    return { ...base, outcome: 'ARC_PAIR_SIDE_REJECT', frameDet, solveDet, condition };
  }
  if (extent > tMax + zeroDelta(extent, tMax)) {
    return { ...base, outcome: 'ARC_PAIR_EXTENT_REJECT', frameDet, solveDet, condition };
  }
  // Joint endpoints: Qs from the real surface-chord solve at the joint end,
  // Qa is the terminal-line origin by construction.
  const chord = solveGradingChord({
    source: { ...sTerm.member }, side, criterion: input.surfaceCriterion,
    maxSearchDistance, target, query: query as never,
  });
  const qs: ArcPairTie | null = chord.ok && chord.solve.daylightPts.length > 0
    ? (() => {
      const p = chord.solve.daylightPts[chord.solve.daylightPts.length - 1]!;
      return { x: p.x, y: p.y, z: p.z };
    })()
    : null;
  const qa: ArcPairTie = { x: line.ox, y: line.oy, z: line.oz };
  if (!qs) return { ...base, outcome: 'ARC_PAIR_SURFACE_NO_ROOT', detail: 'joint-endpoint' };
  // 20J.1 agreement acceptance: X/Y/Z + seam param + target authority.
  const jointScale = Math.max(Math.abs(vx), Math.abs(vy));
  const xTol = coordinateAgreementTol(sTie.x, tie.x, jointScale);
  const yTol = coordinateAgreementTol(sTie.y, tie.y, jointScale);
  const zTol = elevationAgreementTol(sTie.z, tie.z, [
    ...planeLeverage(planeS, sTie.x, sTie.y),
    ...planeLeverage(planeA, tie.x, tie.y),
    line.oz, uA * line.dz,
  ]);
  const tTol = seamParameterAgreementTol(sTie.t, tA, extent, jointScale);
  const agreed = Math.abs(sTie.x - tie.x) <= xTol && Math.abs(sTie.y - tie.y) <= yTol
    && Math.abs(sTie.z - tie.z) <= zTol && Math.abs(sTie.t - tA) <= tTol;
  const ztCommon = query.elevationAt(tie.x, tie.y);
  const targetOk = ztCommon !== null
    && Math.abs(ztCommon - sTie.z)
      <= elevationAgreementTol(ztCommon, sTie.z, planeLeverage(planeS, sTie.x, sTie.y));
  const solved = {
    ...base, frameDet, solveDet, condition, tie, extent, qs, qa,
  };
  if (!agreed || !targetOk) {
    return { ...solved, outcome: 'ARC_PAIR_TRANSITION_REQUIRED', detail: 'tie-disagree' };
  }
  if (!input.buildMesh) return { ...solved, outcome: 'ARC_PAIR_COMMON_TIE' };
  const v = { x: vx, y: vy, z: vz };
  const merged = mergeGroupTriangles([
    { a: v, b: qs, c: tie },
    { a: v, b: tie, c: qa },
  ]);
  if (validateGroupMesh(merged) !== null) {
    return { ...solved, outcome: 'ARC_PAIR_TRANSITION_REQUIRED', detail: 'mesh-invalid' };
  }
  const { planArea, area3d } = studyMeshAreas(merged.points, merged.triangles);
  // Winding/topology/plane-membership validation on the REAL fan: two
  // triangles sharing exactly the V→tie edge, CCW-positive signed areas,
  // endpoints on their authority planes under the agreement contracts.
  const pts = (i: number): [number, number, number] => [merged.points[i * 3]!, merged.points[i * 3 + 1]!, merged.points[i * 3 + 2]!];
  const key = (i: number): string => pts(i).join(',');
  const edges = new Map<string, number>();
  for (let f = 0; f + 2 < merged.triangles.length; f += 3) {
    const tri = [merged.triangles[f]!, merged.triangles[f + 1]!, merged.triangles[f + 2]!];
    const [ax, ay] = pts(tri[0]!);
    const [bx, by] = pts(tri[1]!);
    const [cx, cy] = pts(tri[2]!);
    if (!(((bx - ax) * (cy - ay) - (cx - ax) * (by - ay)) > 0)) {
      return { ...solved, outcome: 'ARC_PAIR_TRANSITION_REQUIRED', detail: 'fan-winding' };
    }
    for (let e = 0; e < 3; e += 1) {
      const k = [key(tri[e]!), key(tri[(e + 1) % 3]!)].sort().join('|');
      edges.set(k, (edges.get(k) ?? 0) + 1);
    }
  }
  const shared = [...edges.values()].filter((c) => c === 2).length;
  if (merged.triangles.length / 3 !== 2 || shared !== 1) {
    return { ...solved, outcome: 'ARC_PAIR_TRANSITION_REQUIRED', detail: 'fan-topology' };
  }
  const onPlane = (
    plane: CornerGradingPlane, p: ArcPairTie, extra: readonly number[],
  ): boolean => {
    const z = planeElevationAt(plane, p.x, p.y);
    return z !== null
      && Math.abs(z - p.z) <= elevationAgreementTol(z, p.z, [...planeLeverage(plane, p.x, p.y), ...extra]);
  };
  if (!onPlane(planeS, qs, []) || !onPlane(planeS, tie, planeLeverage(planeA, tie.x, tie.y))
    || !onPlane(planeA, qa, [line.oz]) || !onPlane(planeA, tie, [line.oz, uA * line.dz])) {
    return { ...solved, outcome: 'ARC_PAIR_TRANSITION_REQUIRED', detail: 'fan-plane' };
  }
  return { ...solved, outcome: 'ARC_PAIR_COMMON_TIE', planArea, area3d, meshValid: true };
};

/** Per-tolerance ladder row (§7): subdivisions, sagitta, frames, h/2, solve, outcome. */
export const studyArcPairLadder = (
  base: Omit<ArcPairInput, 'chordTolerance'>,
  tolerances: number[],
): ArcPairLadderRow[] => tolerances.map((tolerance) => {
  const got = resolveHybridArcPair({ ...base, chordTolerance: tolerance });
  return {
    tolerance,
    subdivisionsSurface: got.surfaceFrame?.subdivisions ?? -1,
    subdivisionsAnalytic: got.analyticFrame?.subdivisions ?? -1,
    sagittaSurface: got.surfaceFrame?.sagitta ?? NaN,
    sagittaAnalytic: got.analyticFrame?.sagitta ?? NaN,
    tangentErrorSurface: got.surfaceFrame?.tangentError ?? NaN,
    tangentErrorAnalytic: got.analyticFrame?.tangentError ?? NaN,
    frameDet: got.frameDet,
    solveDet: got.solveDet,
    condition: got.condition,
    outcome: got.outcome,
    extent: got.extent,
  };
});

/** Primary §10 fixtures: incoming surface arc + outgoing analytic arc at V=(0,0,100). */
export const PRIMARY_SURFACE_ARC: ArcSpec = {
  centerX: 0, centerY: 60, radius: 60,
  startAngle: Math.PI, endAngle: (3 * Math.PI) / 2, sweepCCW: true,
  startZ: 100, endZ: 100,
};

export const PRIMARY_ANALYTIC_ARC: ArcSpec = {
  centerX: -80, centerY: 0, radius: 80,
  startAngle: 0, endAngle: Math.PI / 2, sweepCCW: true,
  startZ: 100, endZ: 100,
};
