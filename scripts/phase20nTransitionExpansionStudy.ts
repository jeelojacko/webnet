/**
 * Phase 20N — transition expansion decision study (CANDIDATE B section only).
 *
 * Scope: STUDY / EVIDENCE ONLY. Zero `src/` edits. Pure-math probes over
 * SYNTHETIC two-member joints; none is production solver output. Every probe
 * is explicitly STUDY-ONLY and is never a default, admission authority, or
 * proposed production value.
 *
 * Candidate B: a single non-collinear same-family transition — the 20M.1 §9
 * `trp1` predicate with the `source deflection == 0` collinearity gate
 * removed. This section does NOT propose a law. It measures the obstruction
 * (C1) and shows two study-selected plan/frame bridge laws sharing the same
 * endpoints diverge materially while no existing authority selects between
 * them (C2/C3).
 *
 * Imported authorities (read-only, comparison only):
 * - `gradingSideNormal` — production side-normal convention.
 * - `solveAnalyticCorner` — production analytic miter point (zero-width join).
 * - `solveExactOffsetJoin` — production 20L.2 offset join (point / concentric).
 * - `admitGradingTransition` — live `trp1` admission (collinearity gate pin).
 * - `coordinateAgreementTol` — shared agreement band for a comparison note.
 * - `resolveAnalyticCriterionAt` — native scalar resolution (endpoint check).
 *
 * Determinism: fixed spec order, r12 rounding, sorted-key JSON, no timestamps.
 */
import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { gradingSideNormal, type PlanVector } from '../src/engine/cad/grading/gradingCourseFrame';
import { solveAnalyticCorner } from '../src/engine/cad/grading/gradingGroupAnalyticCorners';
import { solveExactOffsetJoin } from '../src/engine/cad/grading/gradingExactOffsetGeometry';
import { admitGradingTransition, evaluateTransitionLinearV1, selectGroupTransition } from '../src/engine/cad/grading/gradingTransitionPolicy';
import { coordinateAgreementTol } from '../src/engine/cad/grading/gradingGroupSectors';
import { resolveAnalyticCriterionAt } from '../src/engine/cad/grading/gradingAnalyticCriterion';
import type { GradingCriterion, GradingSide } from '../src/engine/cad/grading/gradingTypes';
export type CandidateBFamily = 'distance' | 'relative-elevation' | 'elevation';
export type CandidateBProbe = 'nlerp' | 'heading';
export type CandidateBTransform = 'identity' | 'mirror' | 'reversal';

/** Family study input: same-family endpoint scalars + their plan offsets. */
export interface CandidateBFamilySpec {
  family: CandidateBFamily;
  criterionL: GradingCriterion;
  criterionR: GradingCriterion;
  /** Study scalar law vL/vR (Distance d, RelEl Δz, Elevation E). */
  scalarL: number;
  scalarR: number;
  /** Plan offset magnitude |dOff| per side (study, metres). */
  offsetL: number;
  offsetR: number;
  jointZ: number;
  maxSearchDistance: number;
  note: string;
}

export const CANDIDATE_B_FAMILIES: readonly CandidateBFamilySpec[] = [
  {
    family: 'distance',
    criterionL: { kind: 'distance', gradeRatio: 0.5, distance: 5 },
    criterionR: { kind: 'distance', gradeRatio: 0.5, distance: 7 },
    scalarL: 5,
    scalarR: 7,
    offsetL: 5,
    offsetR: 7,
    jointZ: 10,
    maxSearchDistance: 50,
    note: 'Distance d=5 vs 7, g=0.5 both sides',
  },
  {
    family: 'relative-elevation',
    criterionL: { kind: 'relative-elevation', gradeRatio: 0.5, relativeElevation: 2 },
    criterionR: { kind: 'relative-elevation', gradeRatio: 0.5, relativeElevation: 4 },
    scalarL: 2,
    scalarR: 4,
    offsetL: 4,
    offsetR: 8,
    jointZ: 10,
    maxSearchDistance: 50,
    note: 'RelEl Δz=2 vs 4, g=0.5 both sides (dOff=Δz/g)',
  },
  {
    family: 'elevation',
    criterionL: { kind: 'elevation', gradeRatio: 0.5, targetElevation: 12 },
    criterionR: { kind: 'elevation', gradeRatio: 0.5, targetElevation: 14 },
    scalarL: 12,
    scalarR: 14,
    offsetL: 4,
    offsetR: 8,
    jointZ: 10,
    maxSearchDistance: 50,
    note: 'flat Elevation E=12 vs 14, Z=10, g=0.5 (dOff=(E-Z)/g)',
  },
] as const;

export const CANDIDATE_B_ANGLES: readonly number[] = [0, 1, 5, 15, 30, 45, 90, 135, 179];
export const CANDIDATE_B_TRANSFORMS: readonly CandidateBTransform[] = ['identity', 'mirror', 'reversal'];
export const CANDIDATE_B_WIDTH_M = 8;
const SAMPLES = 201;

interface Pt { x: number; y: number }
interface Vec { x: number; y: number }

const D2R = Math.PI / 180;
const r12 = (v: number): number => {
  if (!Number.isFinite(v)) return v;
  const r = Number(v.toPrecision(12));
  return r === 0 ? 0 : r;
};

/** Probe 1 (STUDY-ONLY): normalized linear interpolation of the frame. */
export const candidateBFrameNlerp = (nA: PlanVector, nB: PlanVector, t: number): PlanVector => {
  const x = (1 - t) * nA.nx + t * nB.nx;
  const y = (1 - t) * nA.ny + t * nB.ny;
  const len = Math.hypot(x, y);
  return { nx: x / len, ny: y / len };
};

/** Probe 2 (STUDY-ONLY): linear interpolation of the frame heading angle. */
export const candidateBFrameHeading = (nA: PlanVector, nB: PlanVector, t: number): PlanVector => {
  const a = Math.atan2(nA.ny, nA.nx);
  const b = Math.atan2(nB.ny, nB.nx);
  let d = b - a;
  while (d > Math.PI) d -= 2 * Math.PI;
  while (d <= -Math.PI) d += 2 * Math.PI;
  const ang = a + t * d;
  return { nx: Math.cos(ang), ny: Math.sin(ang) };
};

/** Synthetic two-member interval at a joint V. */
export interface CandidateBSegment {
  V: Pt;
  tL: Vec;
  tR: Vec;
  aN: PlanVector;
  bN: PlanVector;
  aOff: number;
  bOff: number;
  width: number;
  angleDeg: number;
}

/** Build the synthetic joint: left arrives along tL, right departs along tR. */
export const candidateBSegment = (
  spec: CandidateBFamilySpec,
  angleDeg: number,
  transform: CandidateBTransform,
  width: number = CANDIDATE_B_WIDTH_M,
): CandidateBSegment => {
  const delta = angleDeg * D2R;
  let tL: Vec = { x: 1, y: 0 };
  let tR: Vec = { x: Math.cos(delta), y: Math.sin(delta) };
  const side: GradingSide = 'left';
  let nL = gradingSideNormal(tL.x, tL.y, side)!;
  let nR = gradingSideNormal(tR.x, tR.y, side)!;
  let aOff = spec.offsetL;
  let bOff = spec.offsetR;
  if (transform === 'mirror') {
    tR = { x: tR.x, y: -tR.y };
    nL = { nx: nL.nx, ny: -nL.ny };
    nR = { nx: nR.nx, ny: -nR.ny };
  } else if (transform === 'reversal') {
    const rtL = { x: -tR.x, y: -tR.y };
    const rtR = { x: -tL.x, y: -tL.y };
    const rnL = nR;
    const rnR = nL;
    tL = rtL;
    tR = rtR;
    nL = rnL;
    nR = rnR;
    const ro = aOff;
    aOff = bOff;
    bOff = ro;
  }
  return { V: { x: 0, y: 0 }, tL, tR, aN: nL, bN: nR, aOff, bOff, width, angleDeg };
};

const sourcePoint = (seg: CandidateBSegment, s: number): Pt =>
  s <= 0
    ? { x: seg.V.x + seg.tL.x * s, y: seg.V.y + seg.tL.y * s }
    : { x: seg.V.x + seg.tR.x * s, y: seg.V.y + seg.tR.y * s };

/** Plan daylight path for one study bridge law over [-W/2,+W/2]. */
export const candidateBPlanCurve = (
  seg: CandidateBSegment,
  probe: CandidateBProbe,
  samples: number = SAMPLES,
): Pt[] => {
  const frame = probe === 'nlerp' ? candidateBFrameNlerp : candidateBFrameHeading;
  const out: Pt[] = [];
  for (let i = 0; i < samples; i += 1) {
    const t = i / (samples - 1);
    const n = frame(seg.aN, seg.bN, t);
    const off = seg.aOff + (seg.bOff - seg.aOff) * t;
    const s = -seg.width / 2 + t * seg.width;
    const src = sourcePoint(seg, s);
    out.push({ x: src.x + n.nx * off, y: src.y + n.ny * off });
  }
  return out;
};

const shoelace = (pts: readonly Pt[]): number => {
  let s = 0;
  for (let i = 0; i < pts.length; i += 1) {
    const a = pts[i]!;
    const b = pts[(i + 1) % pts.length]!;
    s += a.x * b.y - b.x * a.y;
  }
  return Math.abs(s) / 2;
};

const curvatureMax = (pts: readonly Pt[]): number => {
  let m = 0;
  for (let i = 1; i < pts.length - 1; i += 1) {
    const a = pts[i - 1]!;
    const b = pts[i]!;
    const c = pts[i + 1]!;
    const a1 = Math.atan2(b.y - a.y, b.x - a.x);
    const a2 = Math.atan2(c.y - b.y, c.x - b.x);
    let d = a2 - a1;
    while (d > Math.PI) d -= 2 * Math.PI;
    while (d <= -Math.PI) d += 2 * Math.PI;
    const ds = Math.hypot(c.x - b.x, c.y - b.y);
    if (ds > 0) m = Math.max(m, Math.abs(d) / ds);
  }
  return m;
};

const orient = (a: Pt, b: Pt, c: Pt): number => (b.x - a.x) * (c.y - a.y) - (b.y - a.y) * (c.x - a.x);

/** Proper crossing test for two open segments (shared endpoints excluded). */
const properCross = (a: Pt, b: Pt, c: Pt, d: Pt): boolean => {
  const o1 = orient(a, b, c);
  const o2 = orient(a, b, d);
  const o3 = orient(c, d, a);
  const o4 = orient(c, d, b);
  return o1 * o2 < 0 && o3 * o4 < 0;
};

const selfIntersects = (pts: readonly Pt[]): boolean => {
  for (let i = 0; i + 1 < pts.length; i += 1) {
    for (let j = i + 2; j + 1 < pts.length; j += 1) {
      if (properCross(pts[i]!, pts[i + 1]!, pts[j]!, pts[j + 1]!)) return true;
    }
  }
  return false;
};

export interface CandidateBPlanMetrics {
  maxPlanSepM: number;
  minSepM: number;
  areaM2: number;
  maxCurvatureNlerp: number;
  maxCurvatureHeading: number;
  maxCurvatureDiff: number;
  /** Sharpest plan turn radius per law (1/max curvature) — the plan path's
   *  "min-width" in metres; 'Infinity' when the path stays straight. */
  minRadiusNlerp: number | string;
  minRadiusHeading: number | string;
  selfIntersect: boolean;
}

/** C2 measurement: divergence of the two study bridge laws over the interval. */
export const candidateBPlanMetrics = (seg: CandidateBSegment): CandidateBPlanMetrics => {
  const c1 = candidateBPlanCurve(seg, 'nlerp');
  const c2 = candidateBPlanCurve(seg, 'heading');
  let maxSep = 0;
  let minSep = Number.POSITIVE_INFINITY;
  for (let i = 0; i < c1.length; i += 1) {
    const sep = Math.hypot(c1[i]!.x - c2[i]!.x, c1[i]!.y - c2[i]!.y);
    maxSep = Math.max(maxSep, sep);
    minSep = Math.min(minSep, sep);
  }
  const poly = [...c1, ...[...c2].reverse()];
  const k1 = curvatureMax(c1);
  const k2 = curvatureMax(c2);
  const radius = (k: number): number | string => (k > 0 ? r12(1 / k) : 'Infinity');
  const r12opt = (v: number | string): number | string => (typeof v === 'string' ? v : r12(v));
  return {
    maxPlanSepM: r12(maxSep),
    minSepM: r12(minSep),
    areaM2: r12(shoelace(poly)),
    maxCurvatureNlerp: r12(k1),
    maxCurvatureHeading: r12(k2),
    maxCurvatureDiff: r12(Math.abs(k1 - k2)),
    minRadiusNlerp: r12opt(radius(k1)),
    minRadiusHeading: r12opt(radius(k2)),
    selfIntersect: selfIntersects(c1) || selfIntersects(c2),
  };
};

export interface CandidateBFacts extends CandidateBPlanMetrics {
  admissionCode: string;
  kinkDeg: number;
  foldover: boolean;
  c0Gap: number;
  cutPointErrorM: number;
  jointDaylightGapM: number;
}

/** Live `trp1` admission result (full object) — pins the `NON_COLLINEAR` gate per row. */
export const candidateBAdmitFull = (spec: CandidateBFamilySpec, seg: CandidateBSegment) => admitGradingTransition({
    policyVersion: 'trp1',
    lawKind: 'TRANSITION_LINEAR_V1',
    lawVersion: 'v1',
    criterionFamily: spec.family,
    jointId: 'joint:0',
    memberIds: ['L', 'R'],
    width: seg.width,
    side: 'left',
    groupSide: 'left',
    isOpen: true,
    transitionCount: 1,
    jointZ: spec.jointZ,
    members: [
      {
        memberId: 'L',
        criterion: spec.criterionL,
        length: 20,
        dirX: seg.tL.x,
        dirY: seg.tL.y,
        startZ: spec.jointZ,
        endZ: spec.jointZ,
        isArc: false,
        maxSearchDistance: spec.maxSearchDistance,
      },
      {
        memberId: 'R',
        criterion: spec.criterionR,
        length: 20,
        dirX: seg.tR.x,
        dirY: seg.tR.y,
        startZ: spec.jointZ,
        endZ: spec.jointZ,
        isArc: false,
        maxSearchDistance: spec.maxSearchDistance,
      },
    ],
  });

/** Live `trp1` admission code — pins the `NON_COLLINEAR` gate per row. */
export const candidateBAdmissionCode = (spec: CandidateBFamilySpec, seg: CandidateBSegment): string => {
  const res = candidateBAdmitFull(spec, seg);
  return res.ok ? 'ADMITTED' : res.code;
};

/** C1 + C2 facts for one synthetic joint. */
export const candidateBFacts = (
  spec: CandidateBFamilySpec,
  angleDeg: number,
  transform: CandidateBTransform,
  width: number = CANDIDATE_B_WIDTH_M,
): CandidateBFacts => {
  const seg = candidateBSegment(spec, angleDeg, transform, width);
  const tL = seg.tL;
  const tR = seg.tR;
  const dot = Math.max(-1, Math.min(1, tL.x * tR.x + tL.y * tR.y));
  const kinkDeg = Math.acos(dot) / D2R;
  const foldover = tR.x * tL.x + tR.y * tL.y < 0;
  // Native daylight endpoints at the joint under each side's own frame.
  const qL = { x: seg.aN.nx * seg.aOff, y: seg.aN.ny * seg.aOff };
  const qR = { x: seg.bN.nx * seg.bOff, y: seg.bN.ny * seg.bOff };
  const jointDaylightGapM = Math.hypot(qL.x - qR.x, qL.y - qR.y);
  // Production uses the left frame for BOTH cut points; the right cut lands
  // on the left tangent, off the right member line by W·sin(δ/2). Derived
  // study model of the single-frame construction (§1.4), not measured
  // production output — production REJECTS δ≠0 at NON_COLLINEAR.
  const cutPointErrorM = width * Math.abs(Math.sin((angleDeg * D2R) / 2));
  // Scalar C0 measured through production `evaluateTransitionLinearV1`: the
  // scalar law is angle-independent, so the collinear admission of the same
  // family/width supplies live (vL,vR,sL,sR) and the law is evaluated at
  // both interval ends. Non-collinear rows cannot supply their own
  // admission (NON_COLLINEAR rejects); the law under test is the same one.
  const c0Probe = candidateBAdmitFull(spec, candidateBSegment(spec, 0, 'identity', width));
  let c0Gap = Number.NaN;
  if (c0Probe.ok) {
    const atL = evaluateTransitionLinearV1(c0Probe.vL, c0Probe.vR, c0Probe.sL, c0Probe.sR, c0Probe.sL);
    const atR = evaluateTransitionLinearV1(c0Probe.vL, c0Probe.vR, c0Probe.sL, c0Probe.sR, c0Probe.sR);
    c0Gap = Math.max(Math.abs(atL - c0Probe.vL), Math.abs(atR - c0Probe.vR));
  }
  return {
    admissionCode: candidateBAdmissionCode(spec, seg),
    kinkDeg: r12(kinkDeg),
    foldover,
    c0Gap,
    cutPointErrorM: r12(cutPointErrorM),
    jointDaylightGapM: r12(jointDaylightGapM),
    ...candidateBPlanMetrics(seg),
  };
};

export interface CandidateBRow {
  fixtureId: string;
  synthetic: true;
  studyOnly: true;
  candidate: 'B';
  family: CandidateBFamily;
  transitionCount: 1;
  widthM: number;
  gap: 'N/A';
  angleDeg: number;
  transform: CandidateBTransform;
  expectedClassification: string;
  measuredFacts: CandidateBFacts & { mirrorStable: boolean; reversalStable: boolean };
  futurePredicateEligibility: string;
}

const factsEqual = (a: CandidateBFacts, b: CandidateBFacts): boolean =>
  Math.abs(a.maxPlanSepM - b.maxPlanSepM) < 1e-9 &&
  Math.abs(a.areaM2 - b.areaM2) < 1e-9 &&
  Math.abs(a.kinkDeg - b.kinkDeg) < 1e-9 &&
  a.foldover === b.foldover &&
  a.selfIntersect === b.selfIntersect;

const classify = (angleDeg: number): string =>
  angleDeg === 0 ? 'COLLINEAR_CONTROL_EXISTING_TRP1' : 'POLICY_REQUIRED_NONCOLLINEAR_PLAN_LAW';

const eligibility = (angleDeg: number): string =>
  angleDeg === 0
    ? 'existing trp1 (candidate A) already admits the collinear control; candidate B not required'
    : 'not eligible: no plan/frame law authority selects a bridge; requires a new persisted plan law + admission predicate (policy decision)';

export const candidateBBuildCorpus = (): CandidateBRow[] => {
  const rows: CandidateBRow[] = [];
  for (const spec of CANDIDATE_B_FAMILIES) {
    for (const angleDeg of CANDIDATE_B_ANGLES) {
      const facts: Record<CandidateBTransform, CandidateBFacts> = {
        identity: candidateBFacts(spec, angleDeg, 'identity'),
        mirror: candidateBFacts(spec, angleDeg, 'mirror'),
        reversal: candidateBFacts(spec, angleDeg, 'reversal'),
      };
      for (const transform of CANDIDATE_B_TRANSFORMS) {
        const f = facts[transform];
        rows.push({
          fixtureId: `candidateB-${spec.family}-a${angleDeg}-${transform}`,
          synthetic: true,
          studyOnly: true,
          candidate: 'B',
          family: spec.family,
          transitionCount: 1,
          widthM: CANDIDATE_B_WIDTH_M,
          gap: 'N/A',
          angleDeg,
          transform,
          expectedClassification: classify(angleDeg),
          measuredFacts: {
            ...f,
            // Genuine comparison: every row vs the identity row of the same
            // family/angle (identity rows are trivially self-equal; the 54
            // mirror/reversal rows are the informative ones). The old form
            // compared each transformed row against its own transform
            // (factsEqual(f, facts.mirror) on the mirror row) — always true.
            mirrorStable: factsEqual(f, facts.identity),
            reversalStable: factsEqual(f, facts.identity),
          },
          futurePredicateEligibility: eligibility(angleDeg),
        });
      }
    }
  }
  return rows;
};

export const candidateBCorpusSha256 = (rows: readonly CandidateBRow[]): string =>
  createHash('sha256').update(JSON.stringify(rows)).digest('hex');

/**
 * C3 audit: can any existing authority select the plan path? It cannot — the
 * production miter and the 20L.2 exact-offset join both yield a SINGLE POINT
 * that is width-independent, never a finite-width interior law. Machine-check
 * below is line-line only; the arc-bearing 20L.2 remark (concentric-circle
 * point join, still width-independent) is a documentary conclusion from the
 * 20L.2 sources, not a machine-checked row in this study.
 */
export interface CandidateBAuthorityAudit {
  miterTie: Pt | null;
  exactOffsetJoin: Pt | null;
  exactOffsetKind: string;
  miterMatchesExactOffset: boolean;
  joinIsWidthIndependent: boolean;
  selectsPlanPath: boolean;
  verdict: string;
}

export const candidateBAuditPlanLawAuthorities = (): CandidateBAuthorityAudit => {
  const side: GradingSide = 'left';
  const delta = 45 * D2R;
  const d = 5;
  const corner = solveAnalyticCorner({
    vx: 0,
    vy: 0,
    vz: 10,
    inT: { nx: 1, ny: 0 },
    inN: gradingSideNormal(1, 0, side)!,
    inGs: 0,
    outT: { nx: Math.cos(delta), ny: Math.sin(delta) },
    outN: gradingSideNormal(Math.cos(delta), Math.sin(delta), side)!,
    outGs: 0,
    inCriterion: { kind: 'distance', gradeRatio: 0.5, distance: d },
    outCriterion: { kind: 'distance', gradeRatio: 0.5, distance: d },
    maxSearchDistance: 50,
  });
  const join = solveExactOffsetJoin({
    incoming: { kind: 'line', vx: 0, vy: 0, tx: 1, ty: 0, spanStart: -100, spanEnd: 0 },
    outgoing: {
      kind: 'line',
      vx: 0,
      vy: 0,
      tx: Math.cos(delta),
      ty: Math.sin(delta),
      spanStart: 0,
      spanEnd: 100,
    },
    side,
    d,
    maxSearchDistance: 50,
  });
  const miterTie = corner.ok && corner.kind === 'miter' ? { x: r12(corner.tie.x), y: r12(corner.tie.y) } : null;
  const exactOffsetJoin = join.ok ? { x: r12(join.join.x), y: r12(join.join.y) } : null;
  const matched =
    miterTie !== null &&
    exactOffsetJoin !== null &&
    Math.abs(miterTie.x - exactOffsetJoin.x) < 1e-9 &&
    Math.abs(miterTie.y - exactOffsetJoin.y) < 1e-9;
  return {
    miterTie,
    exactOffsetJoin,
    exactOffsetKind: join.ok ? join.kind : 'REJECTED',
    miterMatchesExactOffset: matched,
    // Neither call accepts a width: both are point joins, so the result is
    // independent of any transition interval by construction.
    joinIsWidthIndependent: true,
    selectsPlanPath: false,
    verdict:
      'miter and 20L.2 offset join each select ONE point (width-independent); neither legislates a finite-width interior plan/frame law — no existing authority selects the bridge',
  };
};

/** Authority inventory for C3 (roles that bound/validate, never select). */
export interface CandidateBAuthorityEntry {
  authority: string;
  role: string;
  selectsPlanPath: boolean;
  note: string;
}

export const CANDIDATE_B_AUTHORITY_INVENTORY: readonly CandidateBAuthorityEntry[] = [
  {
    authority: 'miter (solveAnalyticCorner / miterSeam)',
    role: 'intersection of the two terminal offset lines',
    selectsPlanPath: false,
    note: 'single zero-width tie point; no interior law, no width',
  },
  {
    authority: '20L.2 exact offset (solveExactOffsetJoin)',
    role: 'constant-d offset support intersection',
    selectsPlanPath: false,
    note: 'line-line => same miter point; arc-bearing => concentric circle point; never a finite-width bridge',
  },
  {
    authority: 'source geometry',
    role: 'endpoints and per-member tangents',
    selectsPlanPath: false,
    note: 'for δ≠0 there are two distinct tangents; no single frame exists',
  },
  {
    authority: 'maxSearchDistance',
    role: 'upper extent bound (miterExtent t ≤ maxSearch/(M·Ni))',
    selectsPlanPath: false,
    note: 'bounds the extent, does not choose a path or width',
  },
  {
    authority: 'transition width W (trp1)',
    role: 'explicit persisted user interval',
    selectsPlanPath: false,
    note: 'user-supplied; not derived by any authority',
  },
  {
    authority: 'gtop2 certificate / deriveTransitionExpectation',
    role: 'validates a produced mesh against a declared expectation',
    selectsPlanPath: false,
    note: 'never admits and never legislates geometry',
  },
  {
    authority: 'worker agreement tols',
    role: 'coordinate/elevation agreement bands',
    selectsPlanPath: false,
    note: 'compare a produced result against a chosen law; do not select the law',
  },
  {
    authority: 'trp1 admission',
    role: 'policy predicate',
    selectsPlanPath: false,
    note: 'rejects δ≠0 at the exact NON_COLLINEAR gate (cross===0 && dot>0)',
  },
];

/** Section headline: live admission rejects every non-collinear angle. */
export const candidateBAdmissionAuthorityRejectsNonCollinear = (): boolean =>
  CANDIDATE_B_FAMILIES.every((spec) =>
    CANDIDATE_B_ANGLES.every((angleDeg) => {
      const seg = candidateBSegment(spec, angleDeg, 'identity');
      const code = candidateBAdmissionCode(spec, seg);
      return angleDeg === 0 ? code === 'ADMITTED' : code === 'NON_COLLINEAR';
    }),
  );

/** Shared agreement band used only as a comparison floor in the document. */
export const candidateBAgreementBandM = (a: number, b: number): number =>
  coordinateAgreementTol(a, b, Math.max(1, Math.abs(a), Math.abs(b)));

/** Endpoint re-resolution check (natives must still resolve at joint Z). */
export const candidateBEndpointsResolve = (spec: CandidateBFamilySpec): boolean =>
  resolveAnalyticCriterionAt(spec.criterionL, spec.jointZ, spec.maxSearchDistance).ok &&
  resolveAnalyticCriterionAt(spec.criterionR, spec.jointZ, spec.maxSearchDistance).ok;

const corpusPath = (): string =>
  join(dirname(new URL(import.meta.url).pathname), '..', 'docs', 'evidence', 'phase20n', 'corpus.json');

/** Append CANDIDATE B rows, preserving any rows from parallel sections. */
export const candidateBWriteCorpus = (rows: readonly CandidateBRow[]): { total: number; appended: number } => {
  const file = corpusPath();
  let existing: CandidateBRow[] = [];
  if (existsSync(file)) {
    const parsed: unknown = JSON.parse(readFileSync(file, 'utf8'));
    if (Array.isArray(parsed)) existing = parsed as CandidateBRow[];
  }
  const kept = existing.filter(
    (row) => !(row && typeof row === 'object' && String((row as { fixtureId?: unknown }).fixtureId ?? '').startsWith('candidateB-')),
  );
  const merged = [...kept, ...rows];
  mkdirSync(dirname(file), { recursive: true });
  writeFileSync(file, `${JSON.stringify(merged, null, 2)}\n`);
  return { total: merged.length, appended: rows.length };
};

if (process.argv[1]?.endsWith('phase20nTransitionExpansionStudy.ts')) {
  const rows = candidateBBuildCorpus();
  const audit = candidateBAuditPlanLawAuthorities();
  if (process.env.PHASE20N_STDOUT === '1') {
    console.log(JSON.stringify(rows, null, 2));
  } else {
    const written = candidateBWriteCorpus(rows);
    console.log(`phase20n candidate B corpus: ${rows.length} rows appended (${written.total} total)`);
  }
  console.log(`sha256(B rows)=${candidateBCorpusSha256(rows)}`);
  console.log(
    `authority gate NON_COLLINEAR pin: ${candidateBAdmissionAuthorityRejectsNonCollinear() ? 'OK' : 'FAIL'}`,
  );
  console.log(
    `C3 miter/gate match=${audit.miterMatchesExactOffset} kind=${audit.exactOffsetKind} selectsPlanPath=${audit.selectsPlanPath}`,
  );
  console.log(`C3 verdict: ${audit.verdict}`);
}

/* ── CANDIDATE A: multiple strictly-separated collinear same-family transitions ──
 *
 * STUDY / EVIDENCE ONLY. Zero `src/` edits. Per-joint admission reuses the
 * live `trp1` authority (`admitGradingTransition`, one call per joint with
 * `transitionCount: 1`); the interior scalar reuses `evaluateTransitionLinearV1`;
 * the production cardinality gate is pinned via `selectGroupTransition`.
 * The only study-side rule is the strict-separation layout predicate
 * `Wi/2 + Wi+1/2 < gap` over joint-local intervals on one source line.
 * Touching (`==`) is NOT authorized: a shared boundary station would need a
 * single-owner tie-break that does not exist today.
 *
 * Family endpoint scalars (study-chosen; midpoint pinned to recorded expectMid):
 * distance 5/7 (mid 6), relative-elevation 1.5/2 (mid 1.75), elevation 0.5/1
 * (mid 0.75). Members: length 20, collinear dirs (1,0)/(2,0), flat joints
 * (Z=10; Z=0 for flat elevation whose targets sit below 10).
 */

export type CandidateAFamily = 'distance' | 'relative-elevation' | 'elevation';
export type CandidateATransform = 'none' | 'reversal';

export interface CandidateALayoutSpec {
  family: CandidateAFamily;
  widths: number[];
  gaps: number[];
  transform: CandidateATransform;
  expected: string;
  expectMid?: number;
  futurePredicateEligible: boolean;
}

/** Frozen 11-row study table (input side; `measured` is computed below). */
export const CANDIDATE_A_LAYOUTS: readonly CandidateALayoutSpec[] = [
  { family: 'distance', widths: [8, 6], gaps: [20], transform: 'none', expected: 'admit-each + strict-separation + C0', expectMid: 6, futurePredicateEligible: true },
  { family: 'distance', widths: [8, 6, 4], gaps: [20, 20], transform: 'none', expected: 'admit-each + strict-separation + C0', expectMid: 6, futurePredicateEligible: true },
  { family: 'relative-elevation', widths: [8, 6], gaps: [20], transform: 'none', expected: 'admit-each + strict-separation + C0', expectMid: 1.75, futurePredicateEligible: true },
  { family: 'relative-elevation', widths: [8, 6, 4], gaps: [20, 20], transform: 'none', expected: 'admit-each + strict-separation + C0', expectMid: 1.75, futurePredicateEligible: true },
  { family: 'elevation', widths: [8, 6], gaps: [20], transform: 'none', expected: 'admit-each + strict-separation + C0', expectMid: 0.75, futurePredicateEligible: true },
  { family: 'elevation', widths: [8, 6, 4], gaps: [20, 20], transform: 'none', expected: 'admit-each + strict-separation + C0', expectMid: 0.75, futurePredicateEligible: true },
  { family: 'distance', widths: [8, 6], gaps: [7], transform: 'none', expected: 'touching-not-authorized', futurePredicateEligible: false },
  { family: 'distance', widths: [8, 6], gaps: [5], transform: 'none', expected: 'overlap-rejected', futurePredicateEligible: false },
  { family: 'distance', widths: [8, 6], gaps: [-3], transform: 'none', expected: 'malformed-rejected', futurePredicateEligible: false },
  { family: 'distance', widths: [44, 6], gaps: [20], transform: 'none', expected: 'width-infeasible-per-joint', futurePredicateEligible: false },
  { family: 'distance', widths: [8, 6], gaps: [20], transform: 'reversal', expected: 'law-symmetric-under-reversal', futurePredicateEligible: true },
];

const candidateACriteria = (family: CandidateAFamily): [GradingCriterion, GradingCriterion] => {
  if (family === 'distance')
    return [
      { kind: 'distance', gradeRatio: 0.5, distance: 5 },
      { kind: 'distance', gradeRatio: 0.5, distance: 7 },
    ];
  if (family === 'relative-elevation')
    return [
      { kind: 'relative-elevation', gradeRatio: 0.5, relativeElevation: 1.5 },
      { kind: 'relative-elevation', gradeRatio: 0.5, relativeElevation: 2 },
    ];
  return [
    { kind: 'elevation', gradeRatio: 0.5, targetElevation: 0.5 },
    { kind: 'elevation', gradeRatio: 0.5, targetElevation: 1 },
  ];
};

const candidateAMaxSearch = (family: CandidateAFamily): number => (family === 'elevation' ? 100 : 50);

/** Flat-elevation targets sit below Z=10, so that family joints sit at Z=0. */
const candidateAJointZ = (family: CandidateAFamily): number => (family === 'elevation' ? 0 : 10);

/** Strict-separation layout predicate: every gap finite, count-matched, strict. */
export const candidateALayoutOk = (widths: readonly number[], gaps: readonly number[]): boolean => {
  if (gaps.length !== widths.length - 1) return false;
  return gaps.every((gap, i) => {
    const w = widths[i]!;
    const wn = widths[i + 1]!;
    if (!Number.isFinite(w) || !Number.isFinite(wn) || !Number.isFinite(gap)) return false;
    if (!(w > 0) || !(wn > 0) || !(gap > 0)) return false;
    return w / 2 + wn / 2 < gap;
  });
};

/** One live `trp1` admission call for a single collinear joint (count pinned to 1). */
export const candidateAAdmitJoint = (family: CandidateAFamily, width: number, jointId: string) => {
  const [criterionL, criterionR] = candidateACriteria(family);
  const maxSearchDistance = candidateAMaxSearch(family);
  return admitGradingTransition({
    policyVersion: 'trp1',
    lawKind: 'TRANSITION_LINEAR_V1',
    lawVersion: 'v1',
    criterionFamily: family,
    jointId,
    memberIds: ['L', 'R'],
    width,
    side: 'left',
    groupSide: 'left',
    isOpen: true,
    transitionCount: 1,
    jointZ: candidateAJointZ(family),
    members: [
      { memberId: 'L', criterion: criterionL, length: 20, dirX: 1, dirY: 0, startZ: candidateAJointZ(family), endZ: candidateAJointZ(family), isArc: false, maxSearchDistance },
      { memberId: 'R', criterion: criterionR, length: 20, dirX: 2, dirY: 0, startZ: candidateAJointZ(family), endZ: candidateAJointZ(family), isArc: false, maxSearchDistance },
    ],
  });
};

/** Production midpoint scalar of one joint's legislated law (s = 0 centre). */
export const candidateAMidScalar = (family: CandidateAFamily, width: number): number => {
  const admitted = candidateAAdmitJoint(family, width, 'joint:0');
  if (!admitted.ok) throw new Error(`candidate-A study joint must admit (got ${admitted.code})`);
  return evaluateTransitionLinearV1(admitted.vL, admitted.vR, admitted.sL, admitted.sR, 0);
};

/** Merged-strip expectation: N strictly-separated collinear transitions on one
 *  source line form ONE merged positive-width component/cycle/region. Natives
 *  survive between intervals and C0 shared boundaries merge, so production
 *  pins 1/1/1 (gradingGroupCompute tiling, gradingTopologyExpectation 1-region
 *  open-strip, certificate maximal non-tied runs). gtop2 validates as today;
 *  only the expectation derivation is EXTENDed (N→1 merged strip, not N).
 *  The parameter is retained so call sites still declare their joint count. */
export const candidateAExpectationRegions = (_transitionCount: number): number => 1;

/** Endpoint==native check through production law: eval at sL/sR equals vL/vR. */
export const candidateAEndpointGap = (family: CandidateAFamily, width: number): number => {
  const admitted = candidateAAdmitJoint(family, width, 'joint:0');
  if (!admitted.ok) throw new Error(`endpoint study joint must admit (got ${admitted.code})`);
  const atL = evaluateTransitionLinearV1(admitted.vL, admitted.vR, admitted.sL, admitted.sR, admitted.sL);
  const atR = evaluateTransitionLinearV1(admitted.vL, admitted.vR, admitted.sL, admitted.sR, admitted.sR);
  return Math.max(Math.abs(atL - admitted.vL), Math.abs(atR - admitted.vR));
};

/** Reversal endpoint check: swapped law meets vR at sL and vL at sR. */
export const candidateAReversalEndpoints = (family: CandidateAFamily, width: number): boolean => {
  const admitted = candidateAAdmitJoint(family, width, 'joint:0');
  if (!admitted.ok) throw new Error('reversal study joint must admit');
  const atL = evaluateTransitionLinearV1(admitted.vR, admitted.vL, admitted.sL, admitted.sR, admitted.sL);
  const atR = evaluateTransitionLinearV1(admitted.vR, admitted.vL, admitted.sL, admitted.sR, admitted.sR);
  return atL === admitted.vR && atR === admitted.vL;
};

export interface CandidateAInterval { index: number; lo: number; hi: number }

/** Joint-local intervals placed on one source line: joint i+1 sits gap[i] past joint i. */
export const candidateAIntervals = (widths: readonly number[], gaps: readonly number[]): CandidateAInterval[] => {
  const out: CandidateAInterval[] = [];
  let pos = 0;
  for (let i = 0; i < widths.length; i += 1) {
    if (i > 0) pos += gaps[i - 1]!;
    out.push({ index: i, lo: pos - widths[i]! / 2, hi: pos + widths[i]! / 2 });
  }
  return out;
};

export type CandidateAStationOwner = { kind: 'transition'; index: number } | { kind: 'boundary' } | { kind: 'native' };

/** Deterministic per-station owner: strictly inside interval i, exactly on a bound, else native. */
export const candidateAClassifyStation = (s: number, intervals: readonly CandidateAInterval[]): CandidateAStationOwner => {
  for (const iv of intervals) {
    if (s > iv.lo && s < iv.hi) return { kind: 'transition', index: iv.index };
    if (s === iv.lo || s === iv.hi) return { kind: 'boundary' };
  }
  return { kind: 'native' };
};

export interface CandidateARow {
  synthetic: true;
  study: 'candidate-A';
  family: CandidateAFamily;
  transitionCount: number;
  widths: number[];
  gaps: number[];
  angleDeg: 0;
  transform: CandidateATransform;
  expected: string;
  measured: Record<string, number | string | boolean>;
  futurePredicateEligible: boolean;
}

/** Production cardinality pin: >1 intents REJECT today (fail-closed default). */
const candidateACardinalityToday = (n: number): string => {
  const sel = selectGroupTransition(new Array(n).fill({ jointId: 'joint:0' }));
  if (sel.kind !== 'rejected' || sel.code !== 'TRANSITION_REJECTED') throw new Error('production must still reject multi-transition groups');
  return 'rejected';
};

/** Full Candidate A corpus: measured values computed via production authorities. */
export const candidateABuildCorpus = (): CandidateARow[] =>
  CANDIDATE_A_LAYOUTS.map((spec) => {
    const layoutOk = candidateALayoutOk(spec.widths, spec.gaps);
    const codes = spec.widths.map((w, i) => {
      const r = candidateAAdmitJoint(spec.family, w, `joint:${i}`);
      return r.ok ? 'ok' : r.code;
    });
    const allAdmitted = codes.every((c) => c === 'ok');
    const cardinalityToday = candidateACardinalityToday(spec.widths.length);
    const base = {
      synthetic: true as const,
      study: 'candidate-A' as const,
      family: spec.family,
      transitionCount: spec.widths.length,
      widths: [...spec.widths],
      gaps: [...spec.gaps],
      angleDeg: 0 as const,
      transform: spec.transform,
      expected: spec.expected,
      futurePredicateEligible: spec.futurePredicateEligible,
    };
    let measured: Record<string, number | string | boolean>;
    if (spec.transform === 'reversal') {
      const fwd = candidateAMidScalar(spec.family, spec.widths[0]!);
      const admitted = candidateAAdmitJoint(spec.family, spec.widths[0]!, 'joint:0');
      if (!admitted.ok) throw new Error('reversal study joint must admit');
      const rev = evaluateTransitionLinearV1(admitted.vR, admitted.vL, admitted.sL, admitted.sR, 0);
      measured = { layoutOk, reversalConsistent: fwd === rev, reversalEndpointsOk: candidateAReversalEndpoints(spec.family, spec.widths[0]!), endpointGap: candidateAEndpointGap(spec.family, spec.widths[0]!), cardinalityToday };
    } else if (spec.expectMid !== undefined) {
      measured = { layoutOk, allAdmitted, midScalar: candidateAMidScalar(spec.family, spec.widths[0]!), expectMid: spec.expectMid, endpointGap: candidateAEndpointGap(spec.family, spec.widths[0]!), regions: candidateAExpectationRegions(spec.widths.length), cardinalityToday };
    } else {
      measured = { layoutOk, allAdmitted, admitCodes: codes.join(','), cardinalityToday };
    }
    return { ...base, measured };
  });

export const candidateACorpusSha256 = (rows: readonly CandidateARow[]): string =>
  createHash('sha256').update(JSON.stringify(rows)).digest('hex');
