/**
 * Phase 20L Worker-JOINS — honest adjacent-member OFFSET-JOIN geometry
 * (STUDY, evidence only, no production route, zero `src/` changes).
 *
 * Production's only corner-join authority is the miter seam of
 * `gradingCornerMath.ts` (`miterExtent` bounds the seam-ray parameter,
 * fail-closed null). There is no offset/radius join authority anywhere in
 * `src/`: production never asks where the two members' parallel offsets
 * actually meet. This module computes exactly that, analytically, for line
 * and circular-arc members:
 *
 *   offset-curve(member, d, side) = member translated by d along its grading
 *   side normal — a parallel line, or a concentric arc of signed radius
 *   `R + d·(N·r̂)`. The join is where the two offset curves intersect.
 *
 * It NEVER forces the offset through the source joint V (the `miterExtent`
 * seam does not either; production's tie comes from the target plane). It
 * reports every intersection, the signed along-travel parameters relative to
 * V, locality, branch consistency, conditioning, and a production-miter
 * comparison, and it fails closed to an explicit evidence-only label — it
 * never picks a join on its own. Labels are `OFFSET_JOIN_*` evidence strings,
 * never production enums.
 *
 * The offset is a *geometric* reference construction. Whether production
 * should ever use it (and with which sign convention, extent bound, and
 * disambiguation policy) is the question this study answers; it does not
 * answer it by shipping code.
 */
import {
  classifyCorner,
  gradingPlaneGradient,
  miterExtent,
  miterSeam,
  selectMiterRay,
} from '../src/engine/cad/grading/gradingCornerMath';
import { gradingSideNormal, type PlanVector } from '../src/engine/cad/grading/gradingCourseFrame';
import { AGREEMENT_OPS, coordinateAgreementTol, seamParameterAgreementTol } from '../src/engine/cad/grading/gradingGroupSectors';
import type { GradingSide, ResolvedGradingSource } from '../src/engine/cad/grading/gradingTypes';

/**
 * Numerical-authority bands (Phase 20L fix round). Every tolerance below is
 * derived from the shared 20J1 authorities in `gradingGroupSectors.ts`
 * (imported, never copied): `AGREEMENT_OPS` (32-operation rounding budget),
 * `coordinateAgreementTol` (per-axis ULP agreement), and
 * `seamParameterAgreementTol` (distance-along-ray agreement). No magic
 * epsilon decides a physical class: `Roff` sign and `collapsed()` stay EXACT
 * (`=== 0`, `< 0`, `!finite`); tolerances govern agreement only.
 *
 * Local frame: the classifier translates world → V=(0,0) by exact
 * subtraction (Sterbenz-exact for nearby operands) before intersecting, and
 * reports back `x_world = x' + V`. Along-travel `u` and `distV` are already
 * V-relative, so they are frame-invariant by construction. The canonical V
 * is the incoming terminal's joint; a ULP-split outgoing V is kept as its
 * own small local residual, never averaged or welded. No rotation is applied
 * inside the classifier (trig rounding flips near-boundary cases; rotation
 * belongs at the fixture level). `productionMiterProbe` is already anchored
 * and unchanged.
 */
const OPS = AGREEMENT_OPS;
const EPS = Number.EPSILON;
/** Dimensionless line-line NONE gate: OPS·EPS on a unit-tangent determinant. */
const DET_NONE_BAND = OPS * EPS;

/** World magnitude for the seam-parameter authority: max(1,|Vx|,|Vy|). */
const worldScaleOf = (vx: number, vy: number): number => Math.max(1, Math.abs(vx), Math.abs(vy));

/**
 * Band (1): along-travel span/branch agreement. `seamParameterAgreementTol`
 * directly: OPS·max(EPS·max(1,|u|,|span|,|t|), quantum(worldScale)). No
 * absolute floor — at 1e8 the coordinate quantum (~2.2e-8, ×32 ≈ 7e-7)
 * dominates the old 1e-9; at the origin the EPS term (~7e-15·scale) governs.
 */
const spanAgreementTol = (u: number, ref: number, span: number, worldScale: number): number =>
  seamParameterAgreementTol(u, ref, span, worldScale);

/**
 * A member terminal at the shared joint V. `tx/ty` is the unit tangent in the
 * member's own A->B travel direction (toward V for an incoming member, away
 * for an outgoing one). `spanStart/spanEnd` is the u-range the member body
 * occupies, with V at u = 0 (incoming occupies u <= 0, outgoing u >= 0).
 */
export interface LineMember {
  kind: 'line';
  vx: number;
  vy: number;
  tx: number;
  ty: number;
  spanStart: number;
  spanEnd: number;
}

export interface ArcMember {
  kind: 'arc';
  vx: number;
  vy: number;
  cx: number;
  cy: number;
  radius: number;
  /** +1 = CCW travel, -1 = CW travel. */
  dir: 1 | -1;
  spanStart: number;
  spanEnd: number;
}

export type MemberSpec = LineMember | ArcMember;

export type OffsetJoinClass =
  | 'OFFSET_JOIN_UNIQUE'
  | 'OFFSET_JOIN_NONE'
  | 'OFFSET_JOIN_AMBIGUOUS'
  | 'OFFSET_JOIN_WRONG_SIDE'
  | 'OFFSET_JOIN_NONLOCAL'
  | 'OFFSET_JOIN_COLLAPSE'
  | 'OFFSET_JOIN_INVERSION'
  | 'OFFSET_JOIN_SELF_INTERSECTION';

/** The geometric intersection kind the classifier actually evaluated. */
export type JoinIntersectionKind = 'line-line' | 'line-circle' | 'circle-circle' | 'degenerate';

export interface OffsetCurveLine {
  kind: 'line';
  ox: number;
  oy: number;
  tx: number;
  ty: number;
}

export interface OffsetCurveCircle {
  kind: 'circle';
  cx: number;
  cy: number;
  /** Signed: negative means the offset has passed the centre (inversion). */
  radius: number;
}

export type OffsetCurve = OffsetCurveLine | OffsetCurveCircle;

export interface RawIntersection {
  x: number;
  y: number;
  /**
   * Always false: within-noise contact is reported unresolved (AMBIGUOUS),
   * never snapped to a fabricated tangent point. Kept so evidence rows stay
   * comparable if an exact-contact proof ever exists.
   */
  tangent: boolean;
}

export interface JoinCandidate extends RawIntersection {
  uIn: number;
  uOut: number;
  /** |J - V| in metres. */
  distV: number;
  local: boolean;
  branchConsistent: boolean;
  /** Both along-travel params land on the member bodies (span band below). */
  inSpan: boolean;
}

/** Whatever numeric determinant/discriminant drives the intersection. */
export interface JoinConditioning {
  kind: 'line-line-det' | 'line-circle-disc' | 'circle-circle-h2' | 'none';
  value: number;
  /** |value| is small relative to the intersection scale. */
  illConditioned: boolean;
}

export interface ProductionMiterProbe {
  /** `miterExtent` result for the production straight-corner frame at V. */
  extent: number | null;
  /** Seam ray was the zero/ambiguous/inverted fail-closed case. */
  failClosed: 'coincident' | 'ambiguous' | 'inverted' | null;
  /** |J - V| of the offset join, for direct comparison. */
  joinDistance: number | null;
  /** extent !== null && extent + tol < joinDistance (bound would reject). */
  boundWouldRejectJoin: boolean;
}

export interface OffsetJoinResult {
  classification: OffsetJoinClass;
  detail: string;
  turn: 'GAP' | 'OVERLAP' | 'TANGENT' | null;
  side: GradingSide;
  offset: number;
  offsetCurves: { incoming: OffsetCurve | null; outgoing: OffsetCurve | null };
  /** Signed offset radii for arc terminals (null for lines). */
  offsetRadii: { incoming: number | null; outgoing: number | null };
  intersectionKind: JoinIntersectionKind;
  intersections: RawIntersection[];
  candidates: JoinCandidate[];
  /** True when policy is needed before any join could be used: >1 local+consistent or >1 geometric. */
  policyRequired: boolean;
  extent: number | null;
  conditioning: JoinConditioning;
  miter: ProductionMiterProbe;
}

const finiteAll = (values: number[]): boolean => values.every((v) => Number.isFinite(v));

const wrapAngle = (a: number): number => {
  let x = a;
  while (x > Math.PI) x -= 2 * Math.PI;
  while (x <= -Math.PI) x += 2 * Math.PI;
  return x;
};

/** Unit tangent of a member terminal in its A->B travel direction. */
export const memberTangent = (m: MemberSpec): PlanVector | null => {
  if (m.kind === 'line') {
    const len = Math.hypot(m.tx, m.ty);
    if (!(len > 0) || !Number.isFinite(len)) return null;
    return { nx: m.tx / len, ny: m.ty / len };
  }
  if (!finiteAll([m.vx, m.vy, m.cx, m.cy, m.radius])) return null;
  if (!(m.radius > 0)) return null;
  const a = Math.atan2(m.vy - m.cy, m.vx - m.cx);
  // CCW tangent = d/dphi (cos,sin) = (-sin,cos); CW negates.
  return { nx: m.dir * -Math.sin(a), ny: m.dir * Math.cos(a) };
};

/** Offset curve of a member terminal at signed distance `d` along its side. */
export const offsetCurveOf = (
  m: MemberSpec,
  side: GradingSide,
  d: number,
): OffsetCurve | null => {
  const t = memberTangent(m);
  if (!t) return null;
  const n = gradingSideNormal(t.nx, t.ny, side);
  if (!n) return null;
  if (m.kind === 'line') {
    return { kind: 'line', ox: m.vx + d * n.nx, oy: m.vy + d * n.ny, tx: t.nx, ty: t.ny };
  }
  const rx = Math.cos(Math.atan2(m.vy - m.cy, m.vx - m.cx));
  const ry = Math.sin(Math.atan2(m.vy - m.cy, m.vx - m.cx));
  const delta = d * (n.nx * rx + n.ny * ry);
  return { kind: 'circle', cx: m.cx, cy: m.cy, radius: m.radius + delta };
};

interface IntersectionSet {
  kind: JoinIntersectionKind;
  points: RawIntersection[];
  conditioning: JoinConditioning;
  /**
   * Set when the intersection COUNT itself is unknowable: coincident curves
   * (infinite intersections) or contact inside conditioning noise (0, 1, or 2
   * intersections indistinguishable). Never resolved by snapping to tangent.
   */
  unresolved: null | 'coincident-infinite' | 'ill-conditioned-contact';
}

const lineLine = (a: OffsetCurveLine, b: OffsetCurveLine): IntersectionSet => {
  const det = a.tx * b.ty - a.ty * b.tx;
  const px = b.ox - a.ox;
  const py = b.oy - a.oy;
  // Band (2): exact parallel (det === 0) is a true NONE — distinct parallel
  // offsets never meet. Within-noise near-parallel (|det| <= OPS·EPS,
  // dimensionless on unit tangents) is UNRESOLVABLE (0 or 1 intersections
  // indistinguishable), reported AMBIGUOUS like the curve-contact bands —
  // never a snapped point. POLICY: line-line shares the curve-contact
  // fail-closed rule; the band is diagnostic POLICY_REQUIRED, not a join.
  if (det === 0) {
    return {
      kind: 'line-line',
      points: [],
      conditioning: { kind: 'line-line-det', value: det, illConditioned: true },
      unresolved: null,
    };
  }
  if (Math.abs(det) <= DET_NONE_BAND) {
    return {
      kind: 'line-line',
      points: [],
      conditioning: { kind: 'line-line-det', value: det, illConditioned: true },
      unresolved: 'ill-conditioned-contact',
    };
  }
  const t = (px * b.ty - py * b.tx) / det;
  // Band (3): conditioning is INFORMATIONAL ONLY — dimensional
  // OPS·EPS·local_scale against |det|·scale (a length). It never gates the
  // classification; the gate is band (2) above.
  const scale = Math.max(1, Math.hypot(px, py), Math.abs(t));
  const ill = Math.abs(det) * Math.max(1, Math.hypot(px, py)) <= OPS * EPS * scale;
  return {
    kind: 'line-line',
    points: [{ x: a.ox + t * a.tx, y: a.oy + t * a.ty, tangent: false }],
    conditioning: { kind: 'line-line-det', value: det, illConditioned: ill },
    unresolved: null,
  };
};

const lineCircle = (l: OffsetCurveLine, c: OffsetCurveCircle): IntersectionSet => {
  const fx = l.ox - c.cx;
  const fy = l.oy - c.cy;
  const R = Math.abs(c.radius);
  const b = l.tx * fx + l.ty * fy;
  const cc = fx * fx + fy * fy - R * R;
  const disc = b * b - cc;
  // Band (4): OPS·EPS·max(1,R²,|f|²) evaluated in the LOCAL frame (V=(0,0),
  // so fx/fy are small and |f|² cannot smuggle a world-magnitude square).
  const f2 = fx * fx + fy * fy;
  const discTol = OPS * EPS * Math.max(1, R * R, f2);
  const base: IntersectionSet = {
    kind: 'line-circle',
    points: [],
    conditioning: { kind: 'line-circle-disc', value: disc, illConditioned: Math.abs(disc) <= discTol },
    unresolved: null,
  };
  if (disc < -discTol) return base;
  const at = (t: number): RawIntersection => ({ x: l.ox + t * l.tx, y: l.oy + t * l.ty, tangent: false });
  // Within-noise contact is UNRESOLVABLE (0, 1, or 2 true intersections) —
  // report it, never fabricate a tangent point.
  if (Math.abs(disc) <= discTol) return { ...base, unresolved: 'ill-conditioned-contact' };
  const s = Math.sqrt(disc);
  return { ...base, points: [at(-b - s), at(-b + s)] };
};

const circleCircle = (a: OffsetCurveCircle, b: OffsetCurveCircle): IntersectionSet => {
  const dx = b.cx - a.cx;
  const dy = b.cy - a.cy;
  const dist = Math.hypot(dx, dy);
  const R1 = Math.abs(a.radius);
  const R2 = Math.abs(b.radius);
  // Band (5): centre coincidence per axis under the shared
  // `coordinateAgreementTol` (local ULP — centres are V-relative, so the
  // scale is small and no world magnitude leaks in). Both axes must agree.
  const localScale = Math.max(1, Math.abs(a.cx), Math.abs(b.cx), Math.abs(a.cy), Math.abs(b.cy));
  const tolX = coordinateAgreementTol(a.cx, b.cx, localScale);
  const tolY = coordinateAgreementTol(a.cy, b.cy, localScale);
  const base: IntersectionSet = {
    kind: 'circle-circle',
    points: [],
    conditioning: { kind: 'circle-circle-h2', value: 0, illConditioned: true },
    unresolved: null,
  };
  if (Math.abs(dx) <= tolX && Math.abs(dy) <= tolY) {
    // Coincident centres: same radius means the SAME curve (infinite
    // intersections) — explicit AMBIGUOUS, never NONE. Concentric with
    // clearly different radii provably never meets — NONE.
    // Band (6): OPS·EPS·max(1,R1,R2) on the radii — same shape as band (4).
    const sameRadius = Math.abs(R1 - R2) <= OPS * EPS * Math.max(1, R1, R2);
    return { ...base, unresolved: sameRadius ? 'coincident-infinite' : null };
  }
  const aa = (R1 * R1 - R2 * R2 + dist * dist) / (2 * dist);
  const h2 = R1 * R1 - aa * aa;
  const bx = a.cx + (aa * dx) / dist;
  const by = a.cy + (aa * dy) / dist;
  const px = -dy / dist;
  const py = dx / dist;
  // Band (7): OPS·EPS·max(1,R1²,R2²,aa²,dist²), local frame. aa² and dist²
  // join the old R-only scale so a large centre separation or a far
  // radical-line offset widens the noise band honestly.
  const h2Tol = OPS * EPS * Math.max(1, R1 * R1, R2 * R2, aa * aa, dist * dist);
  const withCond: IntersectionSet = {
    ...base,
    conditioning: { kind: 'circle-circle-h2', value: h2, illConditioned: Math.abs(h2) <= h2Tol },
  };
  if (h2 < -h2Tol) return withCond;
  // Within-noise circle contact: same policy as line-circle — unresolved,
  // never a fabricated tangent.
  if (Math.abs(h2) <= h2Tol) return { ...withCond, unresolved: 'ill-conditioned-contact' };
  const h = Math.sqrt(h2);
  return {
    ...withCond,
    points: [
      { x: bx + h * px, y: by + h * py, tangent: false },
      { x: bx - h * px, y: by - h * py, tangent: false },
    ],
  };
};

const intersectCurves = (a: OffsetCurve, b: OffsetCurve): IntersectionSet => {
  if (a.kind === 'line' && b.kind === 'line') return lineLine(a, b);
  if (a.kind === 'line' && b.kind === 'circle') return lineCircle(a, b);
  if (a.kind === 'circle' && b.kind === 'line') {
    const r = lineCircle(b, a);
    return { ...r, points: r.points };
  }
  if (a.kind === 'circle' && b.kind === 'circle') return circleCircle(a, b);
  return { kind: 'degenerate', points: [], conditioning: { kind: 'none', value: 0, illConditioned: true }, unresolved: null };
};

/** Signed along-travel parameter of a point relative to V on a member. */
const alongTravel = (m: MemberSpec, x: number, y: number): number => {
  if (m.kind === 'line') {
    const t = memberTangent(m);
    if (!t) return NaN;
    return (x - m.vx) * t.nx + (y - m.vy) * t.ny;
  }
  const angle = Math.atan2(y - m.cy, x - m.cx);
  const r = Math.hypot(x - m.cx, y - m.cy);
  const vAngle = Math.atan2(m.vy - m.cy, m.vx - m.cx);
  return r * wrapAngle(angle - vAngle) * m.dir;
};

/** True when an along-travel param lands on the member body it is measured on. Band (1): derived span tol, never an absolute floor. */
const inSpanOf = (m: MemberSpec, u: number, worldScale: number): boolean => {
  if (!Number.isFinite(u)) return false;
  const span = Math.max(Math.abs(m.spanStart), Math.abs(m.spanEnd));
  const loTol = spanAgreementTol(Math.min(m.spanStart, m.spanEnd), u, span, worldScale);
  const hiTol = spanAgreementTol(Math.max(m.spanStart, m.spanEnd), u, span, worldScale);
  const lo = Math.min(m.spanStart, m.spanEnd) - loTol;
  const hi = Math.max(m.spanStart, m.spanEnd) + hiTol;
  return u >= lo && u <= hi;
};

/**
 * Branch pattern of a correct offset join. With `uIn`/`uOut` measured along
 * each member's own travel direction relative to V, a simple corner joins on
 * the OUTSIDE (GAP) when the incoming offset is extended past V and the
 * outgoing offset before its start (uIn >= 0, uOut <= 0), and on the INSIDE
 * (OVERLAP) with the opposite signs. Same-sign params mean the two offset
 * curves run off on the same side: a folded/self-crossing offset band.
 */
const branchConsistent = (
  turn: 'GAP' | 'OVERLAP' | 'TANGENT' | null,
  uIn: number,
  uOut: number,
  worldScale: number,
): boolean => {
  if (turn === 'TANGENT' || turn === null) return false;
  const tol = spanAgreementTol(uIn, uOut, Math.max(Math.abs(uIn), Math.abs(uOut)), worldScale);
  return turn === 'GAP'
    ? uIn >= -tol && uOut <= tol
    : uIn <= tol && uOut >= -tol;
};

const sameSign = (uIn: number, uOut: number, worldScale: number): boolean => {
  const tol = spanAgreementTol(uIn, uOut, Math.max(Math.abs(uIn), Math.abs(uOut)), worldScale);
  return uIn * uOut > tol * tol;
};

/**
 * Build the production straight-corner frame at V (chord tangent, exactly
 * what production feeds `solveHybridCorner` for arcs) and run the real
 * `miterExtent` bound. This is a comparison probe, not a routing path.
 */
const productionMiterProbe = (
  inT: PlanVector,
  outT: PlanVector,
  side: GradingSide,
  maxSearchDistance: number,
  joinDistance: number | null,
  worldScale = 1,
): ProductionMiterProbe => {
  const asSource = (t: PlanVector): ResolvedGradingSource => ({
    startX: 0, startY: 0, endX: t.nx, endY: t.ny,
    startZ: 0, endZ: 0, length: 1, reoriented: false, isArc: false,
  });
  const srcIn = asSource(inT);
  const srcOut = asSource(outT);
  const n1 = gradingSideNormal(inT.nx, inT.ny, side);
  const n2 = gradingSideNormal(outT.nx, outT.ny, side);
  if (!n1 || !n2) return { extent: null, failClosed: 'inverted', joinDistance, boundWouldRejectJoin: false };
  const g1 = gradingPlaneGradient(srcIn, side, 1, 0);
  const g2 = gradingPlaneGradient(srcOut, side, 1, 0);
  if (!g1 || !g2) return { extent: null, failClosed: 'inverted', joinDistance, boundWouldRejectJoin: false };
  const seam = miterSeam(g1, g2);
  if (seam === null || 'coincident' in seam) {
    return { extent: null, failClosed: 'coincident', joinDistance, boundWouldRejectJoin: false };
  }
  const ray = selectMiterRay(seam, n1, n2);
  if (ray === null || 'ambiguous' in ray || 'inverted' in ray) {
    return {
      extent: null,
      failClosed: ray && 'ambiguous' in ray ? 'ambiguous' : ray && 'inverted' in ray ? 'inverted' : 'coincident',
      joinDistance,
      boundWouldRejectJoin: false,
    };
  }
  const extent = miterExtent(ray, n1, n2, maxSearchDistance);
  // Band (1) applied to the comparison only: derived seam-parameter tol.
  const cmpTol =
    extent !== null && joinDistance !== null
      ? seamParameterAgreementTol(extent, joinDistance, maxSearchDistance, worldScale)
      : 0;
  const boundWouldRejectJoin =
    extent !== null && joinDistance !== null && extent + cmpTol < joinDistance;
  return { extent, failClosed: null, joinDistance, boundWouldRejectJoin };
};

export interface OffsetJoinInput {
  incoming: MemberSpec;
  outgoing: MemberSpec;
  side: GradingSide;
  /**
   * STUDY-ONLY stress overrides for orientation-conflict terminals (a legacy
   * or corrupted course whose stored side disagrees with the chain side).
   * Production has a single chain side; these exist so the WRONG_SIDE and
   * SELF_INTERSECTION rejections are testable, not so they can be used.
   */
  incomingSide?: GradingSide;
  outgoingSide?: GradingSide;
  /** Non-negative offset distance (metres) along the grading side. */
  offset: number;
  maxSearchDistance: number;
  /** Optional: use the production `miterExtent` comparison probe. */
  probeMiter?: boolean;
}

export const classifyOffsetJoin = (input: OffsetJoinInput): OffsetJoinResult => {
  const { incoming, outgoing, side, offset, maxSearchDistance } = input;
  // Local frame: canonical V is the incoming joint (exact Sterbenz
  // subtraction for nearby operands; a ULP-split outgoing V survives as its
  // own small local residual — never averaged or welded). Tangents, turn,
  // side-normal convention, m.dir, wrapAngle and collapsed() are untouched.
  const V0x = incoming.vx;
  const V0y = incoming.vy;
  const worldScale = worldScaleOf(V0x, V0y);
  const toLocal = (m: MemberSpec): MemberSpec =>
    m.kind === 'line'
      ? { ...m, vx: m.vx - V0x, vy: m.vy - V0y }
      : { ...m, vx: m.vx - V0x, vy: m.vy - V0y, cx: m.cx - V0x, cy: m.cy - V0y };
  const localIn = toLocal(incoming);
  const localOut = toLocal(outgoing);
  const toWorldCurve = (oc: OffsetCurve): OffsetCurve =>
    oc.kind === 'line'
      ? { ...oc, ox: oc.ox + V0x, oy: oc.oy + V0y }
      : { ...oc, cx: oc.cx + V0x, cy: oc.cy + V0y };
  const toWorldPt = (p: RawIntersection): RawIntersection => ({ ...p, x: p.x + V0x, y: p.y + V0y });
  const tIn = memberTangent(incoming);
  const tOut = memberTangent(outgoing);
  const turn = tIn && tOut ? classifyCorner(tIn, tOut, side) : null;

  const sideIn = input.incomingSide ?? side;
  const sideOut = input.outgoingSide ?? side;
  const ocIn = offsetCurveOf(localIn, sideIn, offset);
  const ocOut = offsetCurveOf(localOut, sideOut, offset);
  const emptyMiter: ProductionMiterProbe = {
    extent: null, failClosed: null, joinDistance: null, boundWouldRejectJoin: false,
  };
  const finish = (
    classification: OffsetJoinClass,
    detail: string,
    over: Partial<OffsetJoinResult> = {},
  ): OffsetJoinResult => ({
    classification,
    detail,
    turn,
    side,
    offset,
    offsetCurves: { incoming: ocIn ? toWorldCurve(ocIn) : null, outgoing: ocOut ? toWorldCurve(ocOut) : null },
    offsetRadii: {
      incoming: ocIn && ocIn.kind === 'circle' ? ocIn.radius : null,
      outgoing: ocOut && ocOut.kind === 'circle' ? ocOut.radius : null,
    },
    intersectionKind: 'degenerate',
    intersections: [],
    candidates: [],
    policyRequired: false,
    extent: null,
    conditioning: { kind: 'none', value: 0, illConditioned: true },
    miter: input.probeMiter && tIn && tOut
      ? productionMiterProbe(tIn, tOut, side, maxSearchDistance, null, worldScale)
      : emptyMiter,
    ...over,
  });

  if (!finiteAll([offset, maxSearchDistance]) || !(offset >= 0) || !(maxSearchDistance > 0)) {
    return finish('OFFSET_JOIN_NONE', 'invalid-offset-or-search');
  }
  if (!tIn || !tOut || !ocIn || !ocOut) return finish('OFFSET_JOIN_NONE', 'degenerate-member');

  const collapsed = (oc: OffsetCurve): 'collapse' | 'inversion' | 'nonfinite' | null => {
    if (oc.kind !== 'circle') return null;
    // EXACT sign: tolerances govern agreement only, never physical radius sign.
    if (!Number.isFinite(oc.radius)) return 'nonfinite';
    if (oc.radius === 0) return 'collapse';
    return oc.radius < 0 ? 'inversion' : null;
  };
  const cIn = collapsed(ocIn);
  const cOut = collapsed(ocOut);
  if (cIn === 'nonfinite' || cOut === 'nonfinite') {
    return finish('OFFSET_JOIN_NONE', 'nonfinite-offset-radius');
  }
  if (cIn || cOut) {
    const kind = cIn === 'inversion' || cOut === 'inversion' ? 'OFFSET_JOIN_INVERSION' : 'OFFSET_JOIN_COLLAPSE';
    return finish(kind, `offset-radius-${cIn ?? cOut}`);
  }

  const iset = intersectCurves(ocIn, ocOut);
  const candidates: JoinCandidate[] = iset.points.map((p) => {
    // Classified locally (u/distV are V-relative by construction); the
    // reported point is translated back: x_world = x' + V.
    const uIn = alongTravel(localIn, p.x, p.y);
    const uOut = alongTravel(localOut, p.x, p.y);
    const distV = Math.hypot(p.x - localIn.vx, p.y - localIn.vy);
    const localTol = seamParameterAgreementTol(distV, maxSearchDistance, maxSearchDistance, worldScale);
    return {
      x: p.x + V0x,
      y: p.y + V0y,
      tangent: p.tangent,
      uIn,
      uOut,
      distV,
      local: distV <= maxSearchDistance + localTol,
      branchConsistent: branchConsistent(turn, uIn, uOut, worldScale),
      inSpan: inSpanOf(localIn, uIn, worldScale) && inSpanOf(localOut, uOut, worldScale),
    };
  });
  // A join is usable only on the member bodies: a geometric intersection past
  // the end of a member is not that member's join.
  const joined = candidates.filter((c) => c.local && c.branchConsistent && c.inSpan);
  const localCands = candidates.filter((c) => c.local);
  // The probe compares against the GEOMETRIC join (first branch-consistent
  // intersection), not the span-gated usable join: production's bound either
  // rejects the geometry or it does not — member-span policy is a separate
  // gate and must not move the comparison point.
  const probeJoin = candidates.find((c) => c.branchConsistent) ?? candidates[0] ?? null;
  const miter = input.probeMiter && tIn && tOut
    ? productionMiterProbe(tIn, tOut, side, maxSearchDistance, probeJoin?.distV ?? null, worldScale)
    : emptyMiter;

  const base: Partial<OffsetJoinResult> = {
    intersectionKind: iset.kind,
    intersections: iset.points.map(toWorldPt),
    candidates,
    conditioning: iset.conditioning,
    miter,
  };

  if (iset.unresolved === 'coincident-infinite') {
    return finish('OFFSET_JOIN_AMBIGUOUS', 'coincident-offset-circles-infinite-intersections', {
      ...base,
      policyRequired: true,
    });
  }
  if (iset.unresolved === 'ill-conditioned-contact') {
    return finish('OFFSET_JOIN_AMBIGUOUS', 'near-contact-within-noise-unresolved', {
      ...base,
      policyRequired: true,
    });
  }
  if (iset.points.length === 0) {
    return finish('OFFSET_JOIN_NONE', 'offset-curves-do-not-intersect', base);
  }
  if (turn === 'TANGENT') {
    // G1 corner: the offsets touch but there is no corner seam — exactly the
    // production `miterSeam` coincident fail-closed case, not a join.
    return finish('OFFSET_JOIN_NONE', 'tangent-turn-no-seam', { ...base, policyRequired: true });
  }
  if (localCands.length >= 2) {
    // Every local intersection is surfaced; no branch is ever auto-picked.
    return finish('OFFSET_JOIN_AMBIGUOUS', `${localCands.length}-local-joins`, {
      ...base,
      policyRequired: true,
      extent: Math.min(...localCands.map((c) => c.distV)),
    });
  }
  if (joined.length === 1) {
    const j = joined[0]!;
    return finish('OFFSET_JOIN_UNIQUE', iset.points.length > 1 ? 'unique-local-of-many' : 'single-local', {
      ...base,
      // A second geometric intersection that is non-local still had to be
      // discarded — that choice is a policy, not a fact.
      policyRequired: iset.points.length > 1,
      extent: j.distV,
    });
  }
  const localConsistent = candidates.filter((c) => c.local && c.branchConsistent);
  if (joined.length === 0 && localConsistent.length > 0) {
    // The only consistent intersection(s) lie past the end of a member body.
    return finish('OFFSET_JOIN_NONLOCAL', 'join-outside-member-span', {
      ...base,
      policyRequired: iset.points.length > 1,
    });
  }
  if (localCands.length === 1) {
    const c = localCands[0]!;
    if (sameSign(c.uIn, c.uOut, worldScale)) {
      return finish('OFFSET_JOIN_SELF_INTERSECTION', 'local-join-folds-same-side', {
        ...base,
        policyRequired: iset.points.length > 1,
      });
    }
    return finish('OFFSET_JOIN_WRONG_SIDE', 'local-join-opposite-branch', {
      ...base,
      policyRequired: iset.points.length > 1,
    });
  }
  return finish('OFFSET_JOIN_NONLOCAL', 'all-intersections-beyond-search', {
    ...base,
    policyRequired: iset.points.length > 1,
    extent: Math.min(...candidates.map((c) => c.distV)),
  });
};
