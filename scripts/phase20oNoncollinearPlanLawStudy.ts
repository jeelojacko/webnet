/**
 * Phase 20O — non-collinear transition plan/frame law study core.
 *
 * Scope: STUDY / EVIDENCE ONLY. Zero `src/` edits. Pure-math candidate laws
 * over SYNTHETIC two-member flat line-line joints; none is production solver
 * output, none is admitted by production (live `trp1` still rejects δ≠0 at
 * NON_COLLINEAR — pinned per row and in the 20O test).
 *
 * Context: Phase 20N proved Candidate B blocked (POLICY_REQUIRED): the
 * legislated TRANSITION_LINEAR_V1 scalar law covers scalars only, so two
 * source tangents at deflection≠0 leave no unique interior plan path, and the
 * nlerp-vs-heading probes diverge materially. Phase 20O asks whether evidence
 * now justifies legislating ONE explicit deterministic finite-width
 * source-plan/frame bridge law. This file defines THREE candidate laws with
 * the SAME legislated scalar v(s) and measures them. It does NOT force GO.
 *
 * Imported authorities (read-only, never copied):
 * - `admitGradingTransition` — live trp1 admission (gate pins only).
 * - `evaluateTransitionLinearV1` — the ONE legislated scalar law v(s).
 * - `gradingSideNormal` — production side-normal convention.
 * - `coordinateAgreementTol` — shared agreement band (comparison only).
 *
 * Determinism: fixed spec order, r12 rounding on stored values, no timestamps.
 */
import { gradingSideNormal, type PlanVector } from '../src/engine/cad/grading/gradingCourseFrame';
import { coordinateAgreementTol } from '../src/engine/cad/grading/gradingGroupSectors';
import {
  admitGradingTransition,
  evaluateTransitionLinearV1,
  TRANSITION_LAW_KIND,
  TRANSITION_LAW_VERSION,
  TRANSITION_POLICY_VERSION,
  type AdmitTransitionInput,
  type TransitionMemberGeometry,
} from '../src/engine/cad/grading/gradingTransitionPolicy';
import type { GradingCriterion, GradingSide } from '../src/engine/cad/grading/gradingTypes';

export type PlanLawKind = 'LAW_HEADING' | 'LAW_NLERP' | 'LAW_HERMITE_EXPLICIT';
export type StudyFamily = 'distance' | 'relative-elevation' | 'elevation';
export type RowKind = 'grid' | 'adversarial';

export const PLAN_LAW_KINDS: readonly PlanLawKind[] = ['LAW_HEADING', 'LAW_NLERP', 'LAW_HERMITE_EXPLICIT'];
/** Grid deflections in degrees (magnitude); both turn signs are crossed. */
export const PLAN_LAW_ANGLES_DEG: readonly number[] = [0.1, 1, 5, 15, 30, 45, 90, 135, 170, 179];
export const PLAN_LAW_SAMPLES = 9;
/**
 * Exact reject boundary shared by all three laws: ||δ| − 180°| below this
 * (degrees) is antiparallel — no unique turn direction exists. Fail closed.
 */
export const ANTIPARALLEL_REJECT_DEG = 1e-9;
/** LAW_HEADING near-180 reject: |(|Δθ| − π)| below this (radians) is ambiguous. */
export const HEADING_NEAR_180_REJECT_RAD = 1e-9;
/** LAW_NLERP singular reject: min over t of |(1−t)nL+t·nR| below this. */
export const NLERP_SINGULAR_MIN_LEN = 1e-9;
/**
 * LAW_HERMITE_EXPLICIT tangent-magnitude rule: m0 = m1 = W/2.
 * STATED but NOT principled: no incident-geometry derivation exists (the
 * magnitudes do not follow from member lengths, grades, or offsets), so this
 * choice is an unresolved policy input and counts against GO. Sensitivity to
 * the choice (m = W/4 vs W/2) is measured per row.
 */
export const HERMITE_MAGNITUDE_RULE = 'm0 = m1 = W/2 (stated, non-principled)';

const D2R = Math.PI / 180;

export interface Pt {
  x: number;
  y: number;
}
export interface Vec {
  x: number;
  y: number;
}

export const r12 = (v: number): number => {
  if (!Number.isFinite(v)) return v;
  const r = Number(v.toPrecision(12));
  return r === 0 ? 0 : r;
};

const add = (a: Pt, b: Vec): Pt => ({ x: a.x + b.x, y: a.y + b.y });
const sub = (a: Pt, b: Pt): Vec => ({ x: a.x - b.x, y: a.y - b.y });
const scale = (a: Vec, k: number): Vec => ({ x: a.x * k, y: a.y * k });
const dot = (a: Vec, b: Vec): number => a.x * b.x + a.y * b.y;
const len = (a: Vec): number => Math.hypot(a.x, a.y);
const dist = (a: Pt, b: Pt): number => Math.hypot(a.x - b.x, a.y - b.y);
const norm = (a: Vec): Vec => {
  const l = len(a);
  return { x: a.x / l, y: a.y / l };
};

/** Shortest-turn wrap to (−π, π]. */
export const wrapPi = (d: number): number => {
  let w = d;
  while (w > Math.PI) w -= 2 * Math.PI;
  while (w <= -Math.PI) w += 2 * Math.PI;
  return w;
};

const tolOf = (a: Pt, b: Pt): number =>
  coordinateAgreementTol(a.x, b.x, Math.max(1, Math.abs(a.x), Math.abs(b.x), Math.abs(a.y), Math.abs(b.y)));

/** Study family input: same-family endpoint scalars + plan offset magnitudes. */
export interface StudyFamilySpec {
  family: StudyFamily;
  criterionL: GradingCriterion;
  criterionR: GradingCriterion;
  scalarL: number;
  scalarR: number;
  offsetL: number;
  offsetR: number;
  jointZ: number;
  maxSearchDistance: number;
  note: string;
}

export const STUDY_FAMILIES: readonly StudyFamilySpec[] = [
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
    note: 'flat Elevation E=12 vs 14, Z=10, g=0.5 (dOff=(E−Z)/g)',
  },
];

/** Synthetic flat line-line joint: left arrives along tL, right departs along tR. */
export interface StudyJoint {
  V: Pt;
  tL: Vec;
  tR: Vec;
  nL: PlanVector;
  nR: PlanVector;
  offL: number;
  offR: number;
  vL: number;
  vR: number;
  W: number;
  side: GradingSide;
  deltaDeg: number;
  PcL: Pt;
  PcR: Pt;
  QcL: Pt;
  QcR: Pt;
}

export const studyJoint = (
  spec: StudyFamilySpec,
  deltaDeg: number,
  side: GradingSide,
  W: number,
  origin: Pt = { x: 0, y: 0 },
): StudyJoint => {
  const tL: Vec = { x: 1, y: 0 };
  const tR: Vec = { x: Math.cos(deltaDeg * D2R), y: Math.sin(deltaDeg * D2R) };
  const nL = gradingSideNormal(tL.x, tL.y, side)!;
  const nR = gradingSideNormal(tR.x, tR.y, side)!;
  const PcL = { x: origin.x - tL.x * (W / 2), y: origin.y - tL.y * (W / 2) };
  const PcR = { x: origin.x + tR.x * (W / 2), y: origin.y + tR.y * (W / 2) };
  const QcL = { x: PcL.x + nL.nx * spec.offsetL, y: PcL.y + nL.ny * spec.offsetL };
  const QcR = { x: PcR.x + nR.nx * spec.offsetR, y: PcR.y + nR.ny * spec.offsetR };
  return {
    V: { ...origin },
    tL,
    tR,
    nL,
    nR,
    offL: spec.offsetL,
    offR: spec.offsetR,
    vL: spec.scalarL,
    vR: spec.scalarR,
    W,
    side,
    deltaDeg,
    PcL,
    PcR,
    QcL,
    QcR,
  };
};

/** Piecewise source anchor: V + tL·s for s≤0, V + tR·s for s≥0. */
const anchorAt = (j: StudyJoint, s: number): Pt =>
  s <= 0 ? add(j.V, scale(j.tL, s)) : add(j.V, scale(j.tR, s));

/** LAW_HEADING frame: θ(t) = θL + t·wrapPi(θR−θL), shortest-turn policy. */
export const headingFrame = (nL: PlanVector, nR: PlanVector, t: number): PlanVector | null => {
  const a = Math.atan2(nL.ny, nL.nx);
  const d = wrapPi(Math.atan2(nR.ny, nR.nx) - a);
  if (Math.abs(Math.abs(d) - Math.PI) < HEADING_NEAR_180_REJECT_RAD) return null;
  const ang = a + t * d;
  return { nx: Math.cos(ang), ny: Math.sin(ang) };
};

/** LAW_NLERP frame: normalize((1−t)nL + t·nR); null when singular. */
export const nlerpFrame = (nL: PlanVector, nR: PlanVector, t: number): PlanVector | null => {
  const x = (1 - t) * nL.nx + t * nR.nx;
  const y = (1 - t) * nL.ny + t * nR.ny;
  const l = Math.hypot(x, y);
  if (!(l >= NLERP_SINGULAR_MIN_LEN)) return null;
  return { nx: x / l, ny: y / l };
};

/** Closed-form minimum blend length (unit endpoint normals). */
export const nlerpMinLen = (nL: PlanVector, nR: PlanVector): number => {
  const bx = nR.nx - nL.nx;
  const by = nR.ny - nL.ny;
  const denom = bx * bx + by * by;
  if (!(denom > 0)) return 1;
  const tStar = -(nL.nx * bx + nL.ny * by) / denom;
  const t = Math.min(1, Math.max(0, tStar));
  return Math.hypot(nL.nx + t * bx, nL.ny + t * by);
};

export interface LawStations {
  kind: PlanLawKind;
  ok: boolean;
  rejectCode: string | null;
  rejectDetail: string | null;
  /** Interior plan/daylight path p(s) at the fixed station count. */
  p: Pt[];
  /** Unit tangents t(s) (finite-difference for heading/nlerp, analytic for Hermite). */
  tan: Vec[];
  /** Candidate frame normals n(s). */
  nrm: PlanVector[];
  /** Legislated scalars via production evaluateTransitionLinearV1. */
  v: number[];
  endPosResidL: number;
  endPosResidR: number;
  endTanResidDegL: number;
  endTanResidDegR: number;
  /** Mid-interval kink: angle between segments p[mid-1]->p[mid] and p[mid]->p[mid+1] (deg). The source anchor corners at the middle station for δ≠0, so frame laws kink here by ~δ while a smooth connector stays small. NaN when rejected. */
  midKinkDeg: number;
  c0: boolean;
  maxCurvature: number;
  minRadius: number | string;
  selfIntersect: boolean;
  foldover: boolean;
  normalFlip: boolean;
  overlap: boolean;
}

const rejected = (kind: PlanLawKind, code: string, detail: string): LawStations => ({
  kind,
  ok: false,
  rejectCode: code,
  rejectDetail: detail,
  p: [],
  tan: [],
  nrm: [],
  v: [],
  endPosResidL: NaN,
  endPosResidR: NaN,
  endTanResidDegL: NaN,
  endTanResidDegR: NaN,
  midKinkDeg: NaN,
  c0: false,
  maxCurvature: NaN,
  minRadius: 'rejected',
  selfIntersect: false,
  foldover: false,
  normalFlip: false,
  overlap: false,
});

const orient = (a: Pt, b: Pt, c: Pt): number => (b.x - a.x) * (c.y - a.y) - (b.y - a.y) * (c.x - a.x);
const properCross = (a: Pt, b: Pt, c: Pt, d: Pt): boolean => {
  const o1 = orient(a, b, c);
  const o2 = orient(a, b, d);
  const o3 = orient(c, d, a);
  const o4 = orient(c, d, b);
  return o1 * o2 < 0 && o3 * o4 < 0;
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

const angBetweenDeg = (a: Vec, b: Vec): number => {
  const la = len(a);
  const lb = len(b);
  if (!(la > 0 && lb > 0)) return NaN;
  const c = Math.min(1, Math.max(-1, dot(a, b) / (la * lb)));
  return Math.acos(c) / D2R;
};

const finishLawStations = (kind: PlanLawKind, j: StudyJoint, p: Pt[], nrm: PlanVector[], tan: Vec[]): LawStations => {
  const v = p.map((_, i) => {
    const t = i / (p.length - 1);
    const s = -j.W / 2 + t * j.W;
    return evaluateTransitionLinearV1(j.vL, j.vR, -j.W / 2, j.W / 2, s);
  });
  const endPosResidL = dist(p[0]!, j.QcL);
  const endPosResidR = dist(p[p.length - 1]!, j.QcR);
  const tol = Math.max(tolOf(p[0]!, j.QcL), tolOf(p[p.length - 1]!, j.QcR));
  const endTanResidDegL = angBetweenDeg(tan[0]!, j.tL);
  const endTanResidDegR = angBetweenDeg(tan[tan.length - 1]!, j.tR);
  let selfIntersect = false;
  for (let i = 0; i + 1 < p.length && !selfIntersect; i += 1)
    for (let k = i + 2; k + 1 < p.length && !selfIntersect; k += 1)
      if (properCross(p[i]!, p[i + 1]!, p[k]!, p[k + 1]!)) selfIntersect = true;
  let foldover = false;
  for (let i = 0; i + 1 < tan.length; i += 1)
    if (dot(tan[i]!, tan[i + 1]!) < 0) foldover = true;
  let normalFlip = false;
  // Interior stations only: the endpoint frames oppose each other past 90° by
  // input geometry, so endpoint firing carries no signal. Past-90° interior
  // firing is necessary for ANY C0 frame blend (some interior frame must sit
  // >90° from an endpoint), not a law defect; the discriminating domain is
  // δ≤90°, where firing means a law inverts daylight unnecessarily.
  for (let i = 1; i + 1 < nrm.length && !normalFlip; i += 1) {
    const n = nrm[i]!;
    if (n.nx * j.nL.nx + n.ny * j.nL.ny < 0 || n.nx * j.nR.nx + n.ny * j.nR.ny < 0) normalFlip = true;
  }
  let overlap = false;
  for (let i = 0; i < p.length && !overlap; i += 1)
    for (let k = i + 2; k < p.length && !overlap; k += 1)
      if (dist(p[i]!, p[k]!) <= tol) overlap = true;
  const mid = Math.floor(p.length / 2);
  const midKinkDeg = angBetweenDeg(sub(p[mid]!, p[mid - 1]!), sub(p[mid + 1]!, p[mid]!));
  const maxCurvature = curvatureMax(p);
  return {
    kind,
    ok: true,
    rejectCode: null,
    rejectDetail: null,
    p,
    tan,
    nrm,
    v,
    endPosResidL,
    endPosResidR,
    endTanResidDegL,
    endTanResidDegR,
    midKinkDeg,
    c0: endPosResidL <= tol && endPosResidR <= tol,
    maxCurvature,
    minRadius: maxCurvature > 0 ? 1 / maxCurvature : 'Infinity',
    selfIntersect,
    foldover,
    normalFlip,
    overlap,
  } as LawStations;
};

/** Shared anchored-daylight evaluation for LAW_HEADING / LAW_NLERP. */
const anchoredLawStations = (
  kind: PlanLawKind,
  j: StudyJoint,
  frame: (_nL: PlanVector, _nR: PlanVector, _t: number) => PlanVector | null,
  frameName: string,
): LawStations => {
  if (Math.abs(Math.abs(j.deltaDeg) - 180) < ANTIPARALLEL_REJECT_DEG)
    return rejected(kind, 'ANTIPARALLEL', `|δ|=180° exact: no unique turn direction (${frameName})`);
  if (kind === 'LAW_NLERP' && nlerpMinLen(j.nL, j.nR) < NLERP_SINGULAR_MIN_LEN)
    return rejected(kind, 'SINGULAR_FRAME', 'min blend |(1−t)nL+t·nR| < 1e-9 (near-180 antiparallel)');
  const p: Pt[] = [];
  const nrm: PlanVector[] = [];
  for (let i = 0; i < PLAN_LAW_SAMPLES; i += 1) {
    const t = i / (PLAN_LAW_SAMPLES - 1);
    const n = frame(j.nL, j.nR, t);
    if (n === null)
      return rejected(
        kind,
        kind === 'LAW_HEADING' ? 'AMBIGUOUS_TURN' : 'SINGULAR_FRAME',
        kind === 'LAW_HEADING'
          ? 'shortest-turn wrap ambiguous: |(|Δθ|−π)| < 1e-9 rad (near-180)'
          : 'blend singular at station t (near-180 antiparallel)',
      );
    const s = -j.W / 2 + t * j.W;
    const off = j.offL + (j.offR - j.offL) * t;
    const a = anchorAt(j, s);
    p.push({ x: a.x + n.nx * off, y: a.y + n.ny * off });
    nrm.push(n);
  }
  const tan: Vec[] = p.map((pt, i) => {
    const q = p[Math.min(p.length - 1, i + 1)]!;
    const r = p[Math.max(0, i - 1)]!;
    return norm(sub(q, r));
  });
  return finishLawStations(kind, j, p, nrm, tan);
};

export const evalHeadingLaw = (j: StudyJoint): LawStations => anchoredLawStations('LAW_HEADING', j, headingFrame, 'heading');
export const evalNlerpLaw = (j: StudyJoint): LawStations => anchoredLawStations('LAW_NLERP', j, nlerpFrame, 'nlerp');

/**
 * LAW_HERMITE_EXPLICIT: cubic Hermite p(t) on endpoint daylight cut points
 * QcL→QcR with endpoint tangents = member tangents scaled by m0=m1=W/2.
 * Frame n(s) follows the path tangent under the production side convention.
 */
export const evalHermiteLaw = (j: StudyJoint, magnitudeScale = 1): LawStations => {
  const kind: PlanLawKind = 'LAW_HERMITE_EXPLICIT';
  if (!Number.isFinite(j.W) || !(j.W > 0)) return rejected(kind, 'WIDTH_INVALID', 'W must be finite > 0');
  if (Math.abs(Math.abs(j.deltaDeg) - 180) < ANTIPARALLEL_REJECT_DEG)
    return rejected(kind, 'ANTIPARALLEL', '|δ|=180° exact: endpoint tangents opposite, no unique connector');
  const m = (j.W / 2) * magnitudeScale;
  const T0 = scale(j.tL, m);
  const T1 = scale(j.tR, m);
  const p: Pt[] = [];
  const tan: Vec[] = [];
  const nrm: PlanVector[] = [];
  for (let i = 0; i < PLAN_LAW_SAMPLES; i += 1) {
    const t = i / (PLAN_LAW_SAMPLES - 1);
    const h00 = 2 * t ** 3 - 3 * t ** 2 + 1;
    const h10 = t ** 3 - 2 * t ** 2 + t;
    const h01 = -2 * t ** 3 + 3 * t ** 2;
    const h11 = t ** 3 - t ** 2;
    p.push({
      x: h00 * j.QcL.x + h10 * T0.x + h01 * j.QcR.x + h11 * T1.x,
      y: h00 * j.QcL.y + h10 * T0.y + h01 * j.QcR.y + h11 * T1.y,
    });
    const d00 = 6 * t ** 2 - 6 * t;
    const d10 = 3 * t ** 2 - 4 * t + 1;
    const d01 = -6 * t ** 2 + 6 * t;
    const d11 = 3 * t ** 2 - 2 * t;
    const d = {
      x: d00 * j.QcL.x + d10 * T0.x + d01 * j.QcR.x + d11 * T1.x,
      y: d00 * j.QcL.y + d10 * T0.y + d01 * j.QcR.y + d11 * T1.y,
    };
    if (!(len(d) > 0)) return rejected(kind, 'CUSP', `vanishing derivative at station t=${t}`);
    tan.push(norm(d));
    const n = gradingSideNormal(d.x, d.y, j.side);
    if (n === null) return rejected(kind, 'CUSP', `degenerate tangent at station t=${t}`);
    nrm.push(n);
  }
  return finishLawStations(kind, j, p, nrm, tan);
};

export const evalLaw = (kind: PlanLawKind, j: StudyJoint): LawStations =>
  kind === 'LAW_HEADING' ? evalHeadingLaw(j) : kind === 'LAW_NLERP' ? evalNlerpLaw(j) : evalHermiteLaw(j);

const maxSep = (a: LawStations, b: LawStations): number | null => {
  if (!a.ok || !b.ok) return null;
  let m = 0;
  for (let i = 0; i < a.p.length; i += 1) m = Math.max(m, dist(a.p[i]!, b.p[i]!));
  return m;
};

/** Mirror across the x-axis (y → −y): sign flips, layout mirrors. */
export const mirrorJoint = (j: StudyJoint): StudyJoint => {
  const my = (pt: Pt): Pt => ({ x: pt.x, y: -pt.y });
  const mv = (v: Vec): Vec => ({ x: v.x, y: -v.y });
  const mn = (n: PlanVector): PlanVector => ({ nx: n.nx, ny: -n.ny });
  return {
    ...j,
    V: my(j.V),
    tL: mv(j.tL),
    tR: mv(j.tR),
    nL: mn(j.nL),
    nR: mn(j.nR),
    deltaDeg: -j.deltaDeg,
    PcL: my(j.PcL),
    PcR: my(j.PcR),
    QcL: my(j.QcL),
    QcR: my(j.QcR),
  };
};

/**
 * True traversal reversal: walk the route backwards. Left/right swap with
 * negated tangents on the SAME physical strip (normals carried, not negated),
 * scalars/offsets swapped, side kept. The signed deflection negates (the
 * physical turn reverses, exactly like mirrorJoint).
 */
export const reverseJoint = (j: StudyJoint): StudyJoint => ({
  ...j,
  tL: scale(j.tR, -1),
  tR: scale(j.tL, -1),
  nL: { ...j.nR },
  nR: { ...j.nL },
  offL: j.offR,
  offR: j.offL,
  vL: j.vR,
  vR: j.vL,
  deltaDeg: -j.deltaDeg,
  PcL: { ...j.PcR },
  PcR: { ...j.PcL },
  QcL: { ...j.QcR },
  QcR: { ...j.QcL },
});

const mirrorPts = (pts: readonly Pt[]): Pt[] => pts.map((p) => ({ x: p.x, y: -p.y }));
const reversedPts = (pts: readonly Pt[]): Pt[] => [...pts].reverse();

export interface StabilityMeasures {
  /** max over laws of max-station |mirror(law(mirror(j))) − mirror(law(j))|. */
  mirror: number;
  /** max over laws after rigid shift minus shift, for 1e6 and 1e8. */
  translate1e6: number;
  translate1e8: number;
  /** max over laws of max-station |law(reverse(j)) − reverse(law(j))| (positions). */
  reversal: number;
}

/** Raw (unrounded) stability: mirror / translation / reversal identity per row. */
export const stabilityOf = (j: StudyJoint): StabilityMeasures => {
  const laws = PLAN_LAW_KINDS.map((k) => evalLaw(k, j));
  const mj = mirrorJoint(j);
  const mlaws = PLAN_LAW_KINDS.map((k) => evalLaw(k, mj));
  let mirror = 0;
  laws.forEach((L, i) => {
    const M = mlaws[i]!;
    if (L.ok && M.ok)
      mirrorPts(L.p).forEach((p, s) => {
        mirror = Math.max(mirror, dist(p, M.p[s]!));
      });
  });
  const translated = (dx: number, dy: number): number => {
    const shifted: StudyJoint = {
      ...j,
      V: { x: j.V.x + dx, y: j.V.y + dy },
      PcL: { x: j.PcL.x + dx, y: j.PcL.y + dy },
      PcR: { x: j.PcR.x + dx, y: j.PcR.y + dy },
      QcL: { x: j.QcL.x + dx, y: j.QcL.y + dy },
      QcR: { x: j.QcR.x + dx, y: j.QcR.y + dy },
    };
    let m = 0;
    PLAN_LAW_KINDS.forEach((k, i) => {
      const L = laws[i]!;
      const S = evalLaw(k, shifted);
      if (L.ok && S.ok)
        L.p.forEach((p, s) => {
          m = Math.max(m, Math.hypot(S.p[s]!.x - dx - p.x, S.p[s]!.y - dy - p.y));
        });
    });
    return m;
  };
  const rj = reverseJoint(j);
  const rlaws = PLAN_LAW_KINDS.map((k) => evalLaw(k, rj));
  let reversal = 0;
  laws.forEach((L, i) => {
    const R = rlaws[i]!;
    if (L.ok && R.ok)
      reversedPts(L.p).forEach((p, s) => {
        reversal = Math.max(reversal, dist(p, R.p[s]!));
      });
  });
  return { mirror, translate1e6: translated(1e6, 1e6), translate1e8: translated(1e8, 1e8), reversal };
};

export interface WidthConfig {
  cls: string;
  LL: number;
  LR: number;
  W: number;
}

export const WIDTH_CONFIGS: readonly WidthConfig[] = [
  { cls: 'comfortable-equal', LL: 20, LR: 20, W: 8 },
  { cls: 'near-bound-equal', LL: 20, LR: 20, W: 2 * 20 - 0.001 },
  { cls: 'over-bound-equal', LL: 20, LR: 20, W: 2 * 20 + 0.001 },
  { cls: 'comfortable-unequal', LL: 20, LR: 10, W: 8 },
  { cls: 'near-bound-unequal', LL: 20, LR: 10, W: 2 * 10 - 0.001 },
  { cls: 'over-bound-unequal', LL: 20, LR: 10, W: 2 * 10 + 0.001 },
];

export interface PlanLawRow {
  id: string;
  kind: RowKind;
  angleDeg: number;
  sign: number;
  family: StudyFamily;
  side: GradingSide;
  LL: number;
  LR: number;
  W: number;
  widthClass: string;
  widthFeasible: boolean;
  route: 'study-law' | 'trp1' | 'reject';
  cutL: Pt;
  cutR: Pt;
  cutDaylightL: Pt;
  cutDaylightR: Pt;
  laws: Record<PlanLawKind, LawStations> | null;
  divergence: {
    headingNlerp: number | null;
    headingHermite: number | null;
    nlerpHermite: number | null;
    hermiteMagnitudeSensitivity: number | null;
  } | null;
  stability: StabilityMeasures | null;
  liveAdmit: string;
  reject: string | null;
  note: string;
}

const roundPt = (p: Pt): Pt => ({ x: r12(p.x), y: r12(p.y) });
const roundVec = (v: Vec): Vec => ({ x: r12(v.x), y: r12(v.y) });

const roundLaw = (L: LawStations): LawStations => ({
  ...L,
  p: L.p.map(roundPt),
  tan: L.tan.map(roundVec),
  nrm: L.nrm.map((n) => ({ nx: r12(n.nx), ny: r12(n.ny) })),
  v: L.v.map(r12),
  endPosResidL: r12(L.endPosResidL),
  endPosResidR: r12(L.endPosResidR),
  endTanResidDegL: r12(L.endTanResidDegL),
  endTanResidDegR: r12(L.endTanResidDegR),
  midKinkDeg: r12(L.midKinkDeg),
  maxCurvature: r12(L.maxCurvature),
  minRadius: typeof L.minRadius === 'string' ? L.minRadius : r12(L.minRadius),
});

const widthFeasible = (LL: number, LR: number, W: number): boolean =>
  Number.isFinite(W) && W > 0 && W <= 2 * Math.min(LL, LR);

const liveAdmitCode = (spec: StudyFamilySpec, deltaDeg: number, side: GradingSide, W: number): string => {
  const members: [TransitionMemberGeometry, TransitionMemberGeometry] = [
    {
      memberId: 'L',
      criterion: spec.criterionL,
      length: 20,
      dirX: 1,
      dirY: 0,
      startZ: spec.jointZ,
      endZ: spec.jointZ,
      isArc: false,
      maxSearchDistance: spec.maxSearchDistance,
    },
    {
      memberId: 'R',
      criterion: spec.criterionR,
      length: 20,
      dirX: Math.cos(deltaDeg * D2R),
      dirY: Math.sin(deltaDeg * D2R),
      startZ: spec.jointZ,
      endZ: spec.jointZ,
      isArc: false,
      maxSearchDistance: spec.maxSearchDistance,
    },
  ];
  const input: AdmitTransitionInput = {
    policyVersion: TRANSITION_POLICY_VERSION,
    lawKind: TRANSITION_LAW_KIND,
    lawVersion: TRANSITION_LAW_VERSION,
    criterionFamily: spec.family,
    jointId: 'joint:1',
    memberIds: ['L', 'R'],
    width: W,
    side,
    groupSide: side,
    isOpen: true,
    transitionCount: 1,
    jointZ: spec.jointZ,
    members,
  };
  const r = admitGradingTransition(input);
  return r.ok ? 'ADMITTED' : r.code;
};

const gridRow = (
  spec: StudyFamilySpec,
  angleDeg: number,
  sign: 1 | -1,
  side: GradingSide,
  wc: WidthConfig,
): PlanLawRow => {
  const delta = sign * angleDeg;
  const j = studyJoint(spec, delta, side, wc.W);
  const feas = widthFeasible(wc.LL, wc.LR, wc.W);
  const id =
    `o20-d${angleDeg}deg-s${sign > 0 ? 'p' : 'm'}-${spec.family}-${side}-${wc.cls}`;
  const laws: Record<PlanLawKind, LawStations> = {
    LAW_HEADING: roundLaw(evalHeadingLaw(j)),
    LAW_NLERP: roundLaw(evalNlerpLaw(j)),
    LAW_HERMITE_EXPLICIT: roundLaw(evalHermiteLaw(j)),
  };
  const hermiteAlt = evalHermiteLaw(j, 0.5);
  const magSens =
    laws.LAW_HERMITE_EXPLICIT.ok && hermiteAlt.ok ? maxSep(laws.LAW_HERMITE_EXPLICIT, hermiteAlt) : null;
  const st = stabilityOf(j);
  return {
    id,
    kind: 'grid',
    angleDeg,
    sign,
    family: spec.family,
    side,
    LL: wc.LL,
    LR: wc.LR,
    W: wc.W,
    widthClass: wc.cls,
    widthFeasible: feas,
    route: 'study-law',
    cutL: roundPt(j.PcL),
    cutR: roundPt(j.PcR),
    cutDaylightL: roundPt(j.QcL),
    cutDaylightR: roundPt(j.QcR),
    laws,
    divergence: {
      headingNlerp: maxSep(laws.LAW_HEADING, laws.LAW_NLERP) === null ? null : r12(maxSep(laws.LAW_HEADING, laws.LAW_NLERP)!),
      headingHermite:
        maxSep(laws.LAW_HEADING, laws.LAW_HERMITE_EXPLICIT) === null
          ? null
          : r12(maxSep(laws.LAW_HEADING, laws.LAW_HERMITE_EXPLICIT)!),
      nlerpHermite:
        maxSep(laws.LAW_NLERP, laws.LAW_HERMITE_EXPLICIT) === null
          ? null
          : r12(maxSep(laws.LAW_NLERP, laws.LAW_HERMITE_EXPLICIT)!),
      hermiteMagnitudeSensitivity: magSens === null ? null : r12(magSens),
    },
    stability: { mirror: r12(st.mirror), translate1e6: r12(st.translate1e6), translate1e8: r12(st.translate1e8), reversal: r12(st.reversal) },
    liveAdmit: liveAdmitCode(spec, delta, side, wc.W),
    reject: feas ? null : 'WIDTH_INFEASIBLE',
    note: feas
      ? `study-law comparison row; production gate=${liveAdmitCode(spec, delta, side, wc.W)}`
      : 'W exceeds 2*min(LL,LR): no law is admittable (trp1 WIDTH_INFEASIBLE); curves shown for math only',
  };
};

export const buildGridCorpus = (): PlanLawRow[] => {
  const rows: PlanLawRow[] = [];
  for (const spec of STUDY_FAMILIES)
    for (const angleDeg of PLAN_LAW_ANGLES_DEG)
      for (const sign of [1, -1] as const)
        for (const side of ['left', 'right'] as const)
          for (const wc of WIDTH_CONFIGS) rows.push(gridRow(spec, angleDeg, sign, side, wc));
  return rows;
};

const advRow = (
  id: string,
  init: Partial<PlanLawRow> & Pick<PlanLawRow, 'angleDeg' | 'family' | 'side'>,
): PlanLawRow => ({
  kind: 'adversarial',
  sign: 0,
  LL: 20,
  LR: 20,
  W: 8,
  widthClass: 'n/a',
  widthFeasible: false,
  route: 'reject',
  cutL: { x: 0, y: 0 },
  cutR: { x: 0, y: 0 },
  cutDaylightL: { x: 0, y: 0 },
  cutDaylightR: { x: 0, y: 0 },
  laws: null,
  divergence: null,
  stability: null,
  liveAdmit: 'n/a',
  reject: 'REJECT',
  note: '',
  ...init,
  id,
});

export const buildAdversarialRows = (): PlanLawRow[] => {
  const rows: PlanLawRow[] = [];
  const dist = STUDY_FAMILIES[0]!;
  for (const spec of STUDY_FAMILIES) {
    const code = liveAdmitCode(spec, 0, 'left', 8);
    rows.push(
      advRow(`o20-adv-angle0-${spec.family}`, {
        angleDeg: 0,
        family: spec.family,
        side: 'left',
        widthFeasible: true,
        route: 'trp1',
        liveAdmit: code,
        reject: null,
        note: `angle=0 is exactly collinear: routes to trp1, NOT to any new law (live=${code})`,
      }),
    );
  }
  {
    const j = studyJoint(dist, 180, 'left', 8);
    const laws: Record<PlanLawKind, LawStations> = {
      LAW_HEADING: roundLaw(evalHeadingLaw(j)),
      LAW_NLERP: roundLaw(evalNlerpLaw(j)),
      LAW_HERMITE_EXPLICIT: roundLaw(evalHermiteLaw(j)),
    };
    rows.push(
      advRow('o20-adv-antiparallel-180', {
        angleDeg: 180,
        family: dist.family,
        side: 'left',
        widthFeasible: true,
        laws,
        liveAdmit: liveAdmitCode(dist, 180, 'left', 8),
        note: 'all three laws reject ANTIPARALLEL at exactly 180° (no unique turn direction)',
      }),
    );
  }
  const badW: Array<[string, number, string]> = [
    ['zero', 0, 'WIDTH_INVALID'],
    ['negative', -4, 'WIDTH_INVALID'],
    ['nan', NaN, 'WIDTH_INVALID'],
    ['inf', Number.POSITIVE_INFINITY, 'WIDTH_INVALID'],
    ['beyond-member', 41, 'WIDTH_INFEASIBLE'],
  ];
  for (const [name, W, code] of badW) {
    const feas = widthFeasible(20, 20, W);
    rows.push(
      advRow(`o20-adv-width-${name}`, {
        angleDeg: 30,
        family: dist.family,
        side: 'left',
        W,
        widthClass: name,
        widthFeasible: feas,
        liveAdmit: liveAdmitCode(dist, 0, 'left', W),
        reject: code,
        note: `W=${String(W)} rejected ${code} before any law applies`,
      }),
    );
  }
  const mutateInput = (
    label: string,
    family: StudyFamily,
    mutate: (_input: AdmitTransitionInput) => void,
  ): void => {
    const members: [TransitionMemberGeometry, TransitionMemberGeometry] = [
      {
        memberId: 'L',
        criterion: dist.criterionL,
        length: 20,
        dirX: 1,
        dirY: 0,
        startZ: 10,
        endZ: 10,
        isArc: false,
        maxSearchDistance: 50,
      },
      {
        memberId: 'R',
        criterion: dist.criterionR,
        length: 20,
        dirX: 1,
        dirY: 0,
        startZ: 10,
        endZ: 10,
        isArc: false,
        maxSearchDistance: 50,
      },
    ];
    const input: AdmitTransitionInput = {
      policyVersion: TRANSITION_POLICY_VERSION,
      lawKind: TRANSITION_LAW_KIND,
      lawVersion: TRANSITION_LAW_VERSION,
      criterionFamily: 'distance',
      jointId: 'joint:1',
      memberIds: ['L', 'R'],
      width: 8,
      side: 'left',
      groupSide: 'left',
      isOpen: true,
      transitionCount: 1,
      jointZ: 10,
      members,
    };
    mutate(input);
    const r = admitGradingTransition(input);
    rows.push(
      advRow(`o20-adv-${label}`, {
        angleDeg: 0,
        family,
        side: 'left',
        widthFeasible: true,
        liveAdmit: r.ok ? 'ADMITTED' : r.code,
        note: `live trp1 rejects ${label}: ${r.ok ? 'ADMITTED (unexpected)' : `${r.code} ${r.detail}`}`,
      }),
    );
  };
  mutateInput('family-mismatch', 'distance', (input) => {
    input.members[1]!.criterion = { kind: 'relative-elevation', gradeRatio: 0.5, relativeElevation: 2 };
  });
  mutateInput('grade-mismatch', 'distance', (input) => {
    input.members[1]!.criterion = { kind: 'distance', gradeRatio: 0.25, distance: 7 };
  });
  mutateInput('side-mismatch', 'distance', (input) => {
    input.side = 'right';
  });
  mutateInput('sloped-source', 'distance', (input) => {
    input.members[0]!.startZ = 10;
    input.members[0]!.endZ = 11;
  });
  mutateInput('joint-z-step', 'distance', (input) => {
    input.members[1]!.startZ = 11;
    input.members[1]!.endZ = 11;
  });
  mutateInput('arc-member', 'distance', (input) => {
    input.members[0]!.isArc = true;
  });
  mutateInput('closed-group', 'distance', (input) => {
    input.isOpen = false;
  });
  return rows;
};

export const buildFullCorpus = (): PlanLawRow[] => [...buildGridCorpus(), ...buildAdversarialRows()];

export const corpusPath = (): string =>
  new URL('../docs/evidence/phase20o/corpus.json', import.meta.url).pathname;
