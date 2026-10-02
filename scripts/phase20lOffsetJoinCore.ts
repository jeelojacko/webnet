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
import type { GradingSide, ResolvedGradingSource } from '../src/engine/cad/grading/gradingTypes';

/**
 * Along-travel span/branch band (nanometre, lengths only). This NEVER touches
 * `Roff` sign: collapse/inversion/nonfinite use EXACT arithmetic (`=== 0`,
 * `< 0`, `!finite`) in `collapsed()` — tolerances govern agreement only.
 */
const SIGN_TOL = 1e-9;

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
  const scale = Math.max(1, Math.hypot(px, py));
  const ill = Math.abs(det) <= 1e-12;
  if (ill) {
    return {
      kind: 'line-line',
      points: [],
      conditioning: { kind: 'line-line-det', value: det, illConditioned: true },
      unresolved: null,
    };
  }
  const t = (px * b.ty - py * b.tx) / det;
  return {
    kind: 'line-line',
    points: [{ x: a.ox + t * a.tx, y: a.oy + t * a.ty, tangent: false }],
    conditioning: { kind: 'line-line-det', value: det, illConditioned: Math.abs(det) * scale < 1e-9 },
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
  const scale = Math.max(1, R * R);
  const discTol = 1e-12 * scale;
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
  const scale = Math.max(1, R1 * R1, R2 * R2);
  const tol = 1e-9 * Math.max(1, R1, R2);
  const base: IntersectionSet = {
    kind: 'circle-circle',
    points: [],
    conditioning: { kind: 'circle-circle-h2', value: 0, illConditioned: true },
    unresolved: null,
  };
  if (dist <= tol) {
    // Coincident centres: same radius means the SAME curve (infinite
    // intersections) — explicit AMBIGUOUS, never NONE. Concentric with
    // clearly different radii provably never meets — NONE.
    const sameRadius = Math.abs(R1 - R2) <= 1e-9 * Math.max(1, R1, R2);
    return { ...base, unresolved: sameRadius ? 'coincident-infinite' : null };
  }
  const aa = (R1 * R1 - R2 * R2 + dist * dist) / (2 * dist);
  const h2 = R1 * R1 - aa * aa;
  const bx = a.cx + (aa * dx) / dist;
  const by = a.cy + (aa * dy) / dist;
  const px = -dy / dist;
  const py = dx / dist;
  const h2Tol = 1e-12 * scale;
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

/** True when an along-travel param lands on the member body it is measured on. */
const inSpanOf = (m: MemberSpec, u: number): boolean => {
  if (!Number.isFinite(u)) return false;
  const lo = Math.min(m.spanStart, m.spanEnd) - SIGN_TOL;
  const hi = Math.max(m.spanStart, m.spanEnd) + SIGN_TOL;
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
): boolean => {
  if (turn === 'TANGENT' || turn === null) return false;
  return turn === 'GAP'
    ? uIn >= -SIGN_TOL && uOut <= SIGN_TOL
    : uIn <= SIGN_TOL && uOut >= -SIGN_TOL;
};

const sameSign = (uIn: number, uOut: number): boolean => uIn * uOut > SIGN_TOL * SIGN_TOL;

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
  const boundWouldRejectJoin =
    extent !== null && joinDistance !== null && extent + SIGN_TOL < joinDistance;
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
  const tIn = memberTangent(incoming);
  const tOut = memberTangent(outgoing);
  const turn = tIn && tOut ? classifyCorner(tIn, tOut, side) : null;

  const sideIn = input.incomingSide ?? side;
  const sideOut = input.outgoingSide ?? side;
  const ocIn = offsetCurveOf(incoming, sideIn, offset);
  const ocOut = offsetCurveOf(outgoing, sideOut, offset);
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
    offsetCurves: { incoming: ocIn, outgoing: ocOut },
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
      ? productionMiterProbe(tIn, tOut, side, maxSearchDistance, null)
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
    const uIn = alongTravel(incoming, p.x, p.y);
    const uOut = alongTravel(outgoing, p.x, p.y);
    const distV = Math.hypot(p.x - incoming.vx, p.y - incoming.vy);
    return {
      ...p,
      uIn,
      uOut,
      distV,
      local: distV <= maxSearchDistance + SIGN_TOL,
      branchConsistent: branchConsistent(turn, uIn, uOut),
      inSpan: inSpanOf(incoming, uIn) && inSpanOf(outgoing, uOut),
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
    ? productionMiterProbe(tIn, tOut, side, maxSearchDistance, probeJoin?.distV ?? null)
    : emptyMiter;

  const base: Partial<OffsetJoinResult> = {
    intersectionKind: iset.kind,
    intersections: iset.points,
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
    if (sameSign(c.uIn, c.uOut)) {
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
