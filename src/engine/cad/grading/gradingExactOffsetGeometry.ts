/**
 * Phase 20L.2 — exact parallel-offset corner geometry (production).
 *
 * Analytic offset-curve intersection in the V-local frame: the offset of a
 * member at distance `d` along its grading side is a parallel line, or a
 * concentric arc of signed radius `Roff = R + sign·d` (centre, traversal,
 * and sweep preserved). The join is where the two offset curves meet — never
 * a point forced through V, never an extension past a member body. Arc×arc
 * stays NO_GO; ambiguity (B0) and off-body (C0) fail closed with bounded
 * `FALLBACK_*` codes. No magic epsilon: every band derives from the shared
 * 20J1 authorities (`AGREEMENT_OPS`, `coordinateAgreementTol`,
 * `seamParameterAgreementTol`); `Roff` sign and `d` stay EXACT.
 */
import { classifyCorner } from './gradingCornerMath';
import { gradingSideNormal, type PlanVector } from './gradingCourseFrame';
import {
  AGREEMENT_OPS,
  coordinateAgreementTol,
  seamParameterAgreementTol,
} from './gradingGroupSectors';
import type { GradingSide } from './gradingTypes';

/** Bounded fallback reasons. No other string may ride the fallback path. */
export type ExactJoinFallbackReason =
  | 'FALLBACK_ARC_PAIR_NO_GO'
  | 'FALLBACK_ROFF_COLLAPSE'
  | 'FALLBACK_ROFF_INVERSION'
  | 'FALLBACK_ROFF_NONFINITE'
  | 'FALLBACK_AMBIGUITY_B0'
  | 'FALLBACK_OFF_BODY_C0'
  | 'FALLBACK_EXTENT_E1'
  | 'FALLBACK_BRANCH_REJECT'
  | 'FALLBACK_NO_INTERSECTION'
  | 'FALLBACK_INVALID_INPUT';

export interface ExactLineMember {
  kind: 'line';
  vx: number;
  vy: number;
  tx: number;
  ty: number;
  /** Along-travel u-range of the finite body, with V at u = 0. */
  spanStart: number;
  spanEnd: number;
}

export interface ExactArcMember {
  kind: 'arc';
  vx: number;
  vy: number;
  cx: number;
  cy: number;
  radius: number;
  /** +1 = CCW travel, -1 = CW travel. */
  dir: 1 | -1;
  /** Arc-length u-range of the finite body, with V at u = 0. */
  spanStart: number;
  spanEnd: number;
}

export type ExactMember = ExactLineMember | ExactArcMember;

export interface ExactOffsetJoinInput {
  incoming: ExactMember;
  outgoing: ExactMember;
  side: GradingSide;
  /** Proven constant plan offset (metres) from the route preflight. */
  d: number;
  maxSearchDistance: number;
}

export type ExactOffsetJoin =
  | {
    ok: true;
    join: { x: number; y: number; distV: number; uIn: number; uOut: number };
    kind: 'line-line' | 'line-circle';
  }
  | { ok: false; reason: ExactJoinFallbackReason; detail: string };

const fail = (reason: ExactJoinFallbackReason, detail: string): ExactOffsetJoin => ({
  ok: false,
  reason,
  detail,
});

const OPS = AGREEMENT_OPS;
const EPS = Number.EPSILON;
/** Dimensionless line-line NONE gate: OPS·EPS on a unit-tangent determinant. */
const DET_NONE_BAND = OPS * EPS;
const finiteAll = (v: number[]): boolean => v.every(Number.isFinite);

/** World magnitude for the agreement bands: max(1,|Vx|,|Vy|). */
const worldScaleOf = (vx: number, vy: number): number =>
  Math.max(1, Math.abs(vx), Math.abs(vy));

/**
 * E1 — the ONE `|J-V|` extent comparison (20L.1 Task C port): the bound adds
 * the existing 20J1 quantity-correct seam-parameter agreement band so an
 * analytic extent sitting at `maxSearchDistance` never flips on a few ULPs.
 * The criterion-derived `d` gate stays an exact production comparison in
 * the policy module and is never relaxed by this rule.
 */
export const extentJVWithin = (
  distV: number,
  maxSearchDistance: number,
  worldScale: number,
): boolean => {
  if (!Number.isFinite(distV) || !Number.isFinite(maxSearchDistance)) return false;
  const tol = seamParameterAgreementTol(distV, maxSearchDistance, maxSearchDistance, worldScale);
  return distV <= maxSearchDistance + tol;
};

/** Unit tangent of a member in its A->B travel direction, null when degenerate. */
const memberTangent = (m: ExactMember): PlanVector | null => {
  if (m.kind === 'line') {
    const len = Math.hypot(m.tx, m.ty);
    if (!(len > 0) || !Number.isFinite(len)) return null;
    return { nx: m.tx / len, ny: m.ty / len };
  }
  if (!finiteAll([m.vx, m.vy, m.cx, m.cy, m.radius]) || !(m.radius > 0)) return null;
  const a = Math.atan2(m.vy - m.cy, m.vx - m.cx);
  if (!Number.isFinite(a)) return null;
  return { nx: m.dir * -Math.sin(a), ny: m.dir * Math.cos(a) };
};

/**
 * Roff law: side normal at the member terminal dotted with the outward
 * radial direction at V. Sign only — never a tolerance. Centre, traversal,
 * and sweep are preserved (the offset arc is concentric).
 */
export const exactRadialSign = (m: ExactMember, side: GradingSide): 1 | -1 | null => {
  const t = memberTangent(m);
  if (!t || m.kind !== 'arc') return null;
  const n = gradingSideNormal(t.nx, t.ny, side);
  if (!n) return null;
  const a = Math.atan2(m.vy - m.cy, m.vx - m.cx);
  if (!Number.isFinite(a)) return null;
  const dot = n.nx * Math.cos(a) + n.ny * Math.sin(a);
  if (!Number.isFinite(dot) || dot === 0) return null;
  return dot > 0 ? 1 : -1;
};

/** Exact offset-radius gate: `=== 0` collapse, `< 0` inverted, never epsilon. */
export const gateOffsetRadius = (
  radius: number,
  sign: 1 | -1,
  d: number,
): { ok: true; roff: number } | { ok: false; reason: 'FALLBACK_ROFF_COLLAPSE' | 'FALLBACK_ROFF_INVERSION' | 'FALLBACK_ROFF_NONFINITE' } => {
  const roff = radius + sign * d;
  if (!Number.isFinite(roff)) return { ok: false, reason: 'FALLBACK_ROFF_NONFINITE' };
  if (roff === 0) return { ok: false, reason: 'FALLBACK_ROFF_COLLAPSE' };
  if (roff < 0) return { ok: false, reason: 'FALLBACK_ROFF_INVERSION' };
  return { ok: true, roff };
};

interface SupportLine { kind: 'line'; ox: number; oy: number; tx: number; ty: number }
interface SupportCircle { kind: 'circle'; cx: number; cy: number; roff: number }
type Support = SupportLine | SupportCircle;

/** Offset support of a member terminal at proven distance `d` along `side`. */
const supportOf = (m: ExactMember, side: GradingSide, d: number): Support | null => {
  const t = memberTangent(m);
  if (!t) return null;
  const n = gradingSideNormal(t.nx, t.ny, side);
  if (!n) return null;
  if (m.kind === 'line') {
    return { kind: 'line', ox: m.vx + d * n.nx, oy: m.vy + d * n.ny, tx: t.nx, ty: t.ny };
  }
  const sign = exactRadialSign(m, side);
  if (sign === null) return null;
  const g = gateOffsetRadius(m.radius, sign, d);
  if (!g.ok) return null;
  return { kind: 'circle', cx: m.cx, cy: m.cy, roff: g.roff };
};

interface RawHit { x: number; y: number }
interface Intersect {
  kind: 'line-line' | 'line-circle';
  points: RawHit[];
  /** True when the COUNT is unknowable: contact inside conditioning noise. */
  unresolved: boolean;
}

const lineLine = (a: SupportLine, b: SupportLine): Intersect => {
  const det = a.tx * b.ty - a.ty * b.tx;
  if (det === 0) return { kind: 'line-line', points: [], unresolved: false };
  // Within-noise near-parallel: 0 or 1 intersections indistinguishable —
  // reported unresolved (B0), never a snapped point.
  if (Math.abs(det) <= DET_NONE_BAND) return { kind: 'line-line', points: [], unresolved: true };
  const px = b.ox - a.ox;
  const py = b.oy - a.oy;
  const t = (px * b.ty - py * b.tx) / det;
  return { kind: 'line-line', points: [{ x: a.ox + t * a.tx, y: a.oy + t * a.ty }], unresolved: false };
};

const lineCircle = (l: SupportLine, c: SupportCircle): Intersect => {
  const fx = l.ox - c.cx;
  const fy = l.oy - c.cy;
  const b = l.tx * fx + l.ty * fy;
  const cc = fx * fx + fy * fy - c.roff * c.roff;
  const disc = b * b - cc;
  // Local-frame noise band: OPS·EPS·max(1,R²,|f|²) — no world magnitude
  // leaks in because fx/fy are V-relative.
  const tol = OPS * EPS * Math.max(1, c.roff * c.roff, fx * fx + fy * fy);
  if (disc < -tol) return { kind: 'line-circle', points: [], unresolved: false };
  // Within-noise contact is UNRESOLVABLE (0, 1, or 2 true intersections) —
  // never a fabricated tangent point.
  if (Math.abs(disc) <= tol) return { kind: 'line-circle', points: [], unresolved: true };
  const s = Math.sqrt(disc);
  return {
    kind: 'line-circle',
    points: [
      { x: l.ox + (-b - s) * l.tx, y: l.oy + (-b - s) * l.ty },
      { x: l.ox + (-b + s) * l.tx, y: l.oy + (-b + s) * l.ty },
    ],
    unresolved: false,
  };
};

/** Signed along-travel parameter of a point relative to V on a member. */
const alongTravel = (m: ExactMember, x: number, y: number): number => {
  if (m.kind === 'line') {
    const t = memberTangent(m);
    if (!t) return NaN;
    return (x - m.vx) * t.nx + (y - m.vy) * t.ny;
  }
  const angle = Math.atan2(y - m.cy, x - m.cx);
  const radius = Math.hypot(x - m.cx, y - m.cy);
  const vAngle = Math.atan2(m.vy - m.cy, m.vx - m.cx);
  let wrapped = angle - vAngle;
  while (wrapped > Math.PI) wrapped -= 2 * Math.PI;
  while (wrapped <= -Math.PI) wrapped += 2 * Math.PI;
  return radius * wrapped * m.dir;
};

/** True when an along-travel param lands on the finite member body. */
const inSpanOf = (m: ExactMember, u: number, worldScale: number): boolean => {
  if (!Number.isFinite(u)) return false;
  const span = Math.max(Math.abs(m.spanStart), Math.abs(m.spanEnd));
  const loTol = seamParameterAgreementTol(Math.min(m.spanStart, m.spanEnd), u, span, worldScale);
  const hiTol = seamParameterAgreementTol(Math.max(m.spanStart, m.spanEnd), u, span, worldScale);
  return u >= Math.min(m.spanStart, m.spanEnd) - loTol && u <= Math.max(m.spanStart, m.spanEnd) + hiTol;
};

/**
 * Branch pattern of a correct offset join: with u measured along each
 * member's travel relative to V, a GAP corner joins with incoming extended
 * past V and outgoing before its start (uIn >= 0, uOut <= 0), OVERLAP with
 * the opposite signs. Same-sign params mean a folded band.
 */
const branchConsistent = (
  turn: 'GAP' | 'OVERLAP' | 'TANGENT' | null,
  uIn: number,
  uOut: number,
  worldScale: number,
): boolean => {
  if (turn === 'TANGENT' || turn === null) return false;
  const tol = seamParameterAgreementTol(uIn, uOut, Math.max(Math.abs(uIn), Math.abs(uOut)), worldScale);
  // ponytail: single agreement band for both legs; split per-leg bands when a near-zero leg needs it.
  return turn === 'GAP' ? uIn >= -tol && uOut <= tol : uIn <= tol && uOut >= -tol;
};

/**
 * Admit at most one UNIQUE on-body branch: the proven-d offset join J.
 * Every rejection is a named fallback — the solver never picks a join.
 */
export const solveExactOffsetJoin = (input: ExactOffsetJoinInput): ExactOffsetJoin => {
  const { incoming, outgoing, side, d, maxSearchDistance } = input;
  if (!Number.isFinite(d) || !(d > 0) || !Number.isFinite(maxSearchDistance) || !(maxSearchDistance > 0)) {
    return fail('FALLBACK_INVALID_INPUT', 'bad-offset-or-search');
  }
  // Roff pre-gate on every arc member (exact sign, exact zero/negative).
  for (const m of [incoming, outgoing]) {
    if (m.kind !== 'arc') continue;
    const sign = exactRadialSign(m, side);
    if (sign === null) return fail('FALLBACK_INVALID_INPUT', 'degenerate-arc-terminal');
    const g = gateOffsetRadius(m.radius, sign, d);
    if (!g.ok) return fail(g.reason, `offset-radius-${g.reason}`);
  }
  // Arc×arc stays NO_GO — never weakened.
  if (incoming.kind === 'arc' && outgoing.kind === 'arc') {
    return fail('FALLBACK_ARC_PAIR_NO_GO', 'arc-pair-no-go');
  }
  const tIn = memberTangent(incoming);
  const tOut = memberTangent(outgoing);
  if (!tIn || !tOut) return fail('FALLBACK_INVALID_INPUT', 'degenerate-member');
  const turn = classifyCorner(tIn, tOut, side);
  // Local frame: canonical V is the incoming joint (exact Sterbenz
  // subtraction for nearby operands). No rotation inside the solver.
  const V0x = incoming.vx;
  const V0y = incoming.vy;
  const worldScale = worldScaleOf(V0x, V0y);
  const local = (m: ExactMember): ExactMember =>
    m.kind === 'line'
      ? { ...m, vx: m.vx - V0x, vy: m.vy - V0y }
      : { ...m, vx: m.vx - V0x, vy: m.vy - V0y, cx: m.cx - V0x, cy: m.cy - V0y };
  const localIn = local(incoming);
  const localOut = local(outgoing);
  const sIn = supportOf(localIn, side, d);
  const sOut = supportOf(localOut, side, d);
  if (!sIn || !sOut) return fail('FALLBACK_INVALID_INPUT', 'degenerate-support');
  const hit: Intersect =
    sIn.kind === 'line' && sOut.kind === 'line'
      ? lineLine(sIn, sOut)
      : sIn.kind === 'line'
        ? lineCircle(sIn, sOut as SupportCircle)
        : lineCircle(sOut as SupportLine, sIn as SupportCircle);
  // The two terminals must share one joint V up to the shared per-axis
  // coordinate agreement (a ULP-split V survives as its own small local
  // residual — the incoming V stays canonical, never averaged or welded).
  const vScale = worldScaleOf(V0x, V0y);
  if (
    Math.abs(outgoing.vx - V0x) > coordinateAgreementTol(outgoing.vx, V0x, vScale) ||
    Math.abs(outgoing.vy - V0y) > coordinateAgreementTol(outgoing.vy, V0y, vScale)
  ) {
    return fail('FALLBACK_INVALID_INPUT', 'joint-discontinuity');
  }
  if (hit.unresolved) return fail('FALLBACK_AMBIGUITY_B0', 'contact-within-noise-unresolved');
  if (hit.points.length === 0) return fail('FALLBACK_NO_INTERSECTION', 'supports-do-not-meet');
  const cands = hit.points.map((p) => {
    const uIn = alongTravel(localIn, p.x, p.y);
    const uOut = alongTravel(localOut, p.x, p.y);
    const distV = Math.hypot(p.x - localIn.vx, p.y - localIn.vy);
    return {
      x: p.x + V0x,
      y: p.y + V0y,
      uIn,
      uOut,
      distV,
      local: extentJVWithin(distV, maxSearchDistance, worldScale),
      consistent: branchConsistent(turn, uIn, uOut, worldScale),
      onBody: inSpanOf(localIn, uIn, worldScale) && inSpanOf(localOut, uOut, worldScale),
    };
  });
  // B0 fail-closed before any span gate: ≥2 local intersections are never
  // auto-picked, even when both sit off the finite bodies.
  const localCands = cands.filter((c) => c.local);
  if (localCands.length >= 2) {
    return fail('FALLBACK_AMBIGUITY_B0', `${localCands.length}-local-joins`);
  }
  const joined = cands.filter((c) => c.local && c.consistent && c.onBody);
  if (joined.length === 1) {
    const j = joined[0]!;
    return {
      ok: true,
      join: { x: j.x, y: j.y, distV: j.distV, uIn: j.uIn, uOut: j.uOut },
      kind: hit.kind,
    };
  }
  // C0 no-extension: a consistent join past the member body is not built.
  if (cands.some((c) => c.local && c.consistent)) {
    return fail('FALLBACK_OFF_BODY_C0', 'join-outside-member-span');
  }
  if (cands.some((c) => c.local)) return fail('FALLBACK_BRANCH_REJECT', 'local-join-opposite-branch');
  return fail('FALLBACK_EXTENT_E1', 'all-intersections-beyond-search');
};
