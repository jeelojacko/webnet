/**
 * Phase 20L.2 — exact-offset route preflight (production, R0 whole-route only).
 *
 * Constant plan-offset/member law gate: a route admits EXACT_OFFSET candidacy
 * only when every member resolves through the production analytic authority
 * to the SAME finite `d > 0` with `d <= maxSearchDistance` exactly, every
 * member is exactly flat, joints are exactly continuous, and the group is an
 * open chain containing at least one circular arc. Anything else fails closed
 * with a bounded `FALLBACK_*` reason code. Never imports study oracles.
 *
 * This module decides candidacy only — it builds no geometry and wires no
 * dispatcher. Arc-pair, ambiguity, span, and extent gates live in
 * `gradingExactOffsetGeometry.ts`.
 */
import { gradingSideNormal } from './gradingCourseFrame';
import { resolveAnalyticCriterionAt } from './gradingAnalyticCriterion';
import type { GradingCriterion, GradingSide } from './gradingTypes';

/** Bounded fallback reasons. No other string may ride the fallback path. */
export type ExactOffsetFallbackReason =
  | 'FALLBACK_CLOSED_WITH_ARC'
  | 'FALLBACK_NOT_CURVED'
  | 'FALLBACK_SURFACE_TARGET'
  | 'FALLBACK_SLOPED_SOURCE'
  | 'FALLBACK_SOURCE_JOINT_STEP'
  | 'FALLBACK_D_MISMATCH'
  | 'FALLBACK_INVALID_CRITERION'
  | 'FALLBACK_ROFF_COLLAPSE'
  | 'FALLBACK_ROFF_INVERSION'
  | 'FALLBACK_ROFF_NONFINITE'
  | 'FALLBACK_DEGENERATE_SOURCE';

/** One route member as the preflight sees it (plan law + elevation rep). */
export interface ExactOffsetPolicyMember {
  criterion: GradingCriterion;
  /** True for circular-arc members (ellipse/unknown fail closed). */
  isArc: boolean;
  /** Circle radius; meaningful only when `isArc`. */
  radius: number;
  startZ: number;
  endZ: number;
  /**
   * Arc terminal geometry at the route joint, for the radial-sign path
   * (required when `isArc`): unit travel tangent (tx, ty), joint V, centre C.
   */
  tx: number;
  ty: number;
  vx: number;
  vy: number;
  cx: number;
  cy: number;
}

export interface ExactOffsetRouteInput {
  members: ExactOffsetPolicyMember[];
  /** True when the group is topologically closed. */
  closed: boolean;
  side: GradingSide;
  maxSearchDistance: number;
}

export type ExactOffsetPreflight =
  | { admitted: true; d: number }
  | { admitted: false; reason: ExactOffsetFallbackReason; detail: string };

const fail = (reason: ExactOffsetFallbackReason, detail: string): ExactOffsetPreflight => ({
  admitted: false,
  reason,
  detail,
});

/**
 * Exact radial sign: side normal at the member terminal dotted with the
 * outward radial direction at V. Sign only — never a tolerance. Null when
 * the terminal geometry is degenerate.
 */
export const exactRadialSign = (
  m: ExactOffsetPolicyMember,
  side: GradingSide,
): 1 | -1 | null => {
  if (!Number.isFinite(m.tx) || !Number.isFinite(m.ty)) return null;
  if (!Number.isFinite(m.vx) || !Number.isFinite(m.vy)) return null;
  if (!Number.isFinite(m.cx) || !Number.isFinite(m.cy)) return null;
  const n = gradingSideNormal(m.tx, m.ty, side);
  if (!n) return null;
  const a = Math.atan2(m.vy - m.cy, m.vx - m.cx);
  if (!Number.isFinite(a)) return null;
  const dot = n.nx * Math.cos(a) + n.ny * Math.sin(a);
  if (!Number.isFinite(dot) || dot === 0) return null;
  return dot > 0 ? 1 : -1;
};

/**
 * R0 whole-route preflight: EXACT_OFFSET candidacy iff every gate below
 * passes with one shared proven `d`. Order is scope-first (closed/curved),
 * then per-member law, then cross-member agreement, then the Roff gate.
 */
export const preflightExactOffsetRoute = (
  input: ExactOffsetRouteInput,
): ExactOffsetPreflight => {
  const { members, closed, side, maxSearchDistance } = input;
  if (!Array.isArray(members) || members.length === 0) {
    return fail('FALLBACK_DEGENERATE_SOURCE', 'empty-route');
  }
  if (!Number.isFinite(maxSearchDistance) || !(maxSearchDistance > 0)) {
    return fail('FALLBACK_INVALID_CRITERION', 'bad-search-distance');
  }
  // Scope: line-only groups are never curved-exact; closed-with-arc routes
  // chord fallback as product policy (SCOPE RULE CURVED_CLOSED_SUPPORT).
  if (!members.some((m) => m.isArc)) {
    return fail('FALLBACK_NOT_CURVED', 'line-only-group');
  }
  if (closed) {
    return fail('FALLBACK_CLOSED_WITH_ARC', 'closed-group-with-arc');
  }
  // Per-member law: exact flatness, target-free criterion, production `d`.
  const ds: number[] = [];
  for (let i = 0; i < members.length; i += 1) {
    const m = members[i]!;
    if (!Number.isFinite(m.startZ) || !Number.isFinite(m.endZ)) {
      return fail('FALLBACK_DEGENERATE_SOURCE', `member-${i}-nonfinite-z`);
    }
    // Exact comparison only: any slope makes d(s) non-constant (class C).
    if (m.startZ !== m.endZ) {
      return fail('FALLBACK_SLOPED_SOURCE', `member-${i}-sloped`);
    }
    if (m.criterion.kind === 'fixed' || m.criterion.kind === 'cut-fill') {
      return fail('FALLBACK_SURFACE_TARGET', `member-${i}-surface`);
    }
    if (m.isArc && (!(m.radius > 0) || !Number.isFinite(m.radius))) {
      return fail('FALLBACK_DEGENERATE_SOURCE', `member-${i}-bad-radius`);
    }
    const r = resolveAnalyticCriterionAt(m.criterion, m.startZ, maxSearchDistance);
    if (!r.ok) {
      return fail('FALLBACK_INVALID_CRITERION', `member-${i}-${r.code}`);
    }
    const d = r.value.horizontalDistance;
    // Exact production comparison: never relaxed, never re-derived.
    if (!Number.isFinite(d) || !(d > 0) || d > maxSearchDistance) {
      return fail('FALLBACK_INVALID_CRITERION', `member-${i}-bad-distance`);
    }
    ds.push(d);
  }
  // Cross-member agreement: SAME EXACT `d` (`===`) — elevation on differing
  // member flats resolves per-member distances that disagree (never first-
  // member-only). Source-joint continuity mirrors production exactXyz.
  if (!ds.every((d) => d === ds[0])) {
    return fail('FALLBACK_D_MISMATCH', 'member-distances-disagree');
  }
  for (let i = 1; i < members.length; i += 1) {
    if (members[i - 1]!.endZ !== members[i]!.startZ) {
      return fail('FALLBACK_SOURCE_JOINT_STEP', `joint-${i - 1}-${i}-step`);
    }
  }
  // Exact offset-radius gate on every arc member: `=== 0` collapse,
  // `< 0` inverted, non-finite rejected — never epsilon.
  const d = ds[0]!;
  for (let i = 0; i < members.length; i += 1) {
    const m = members[i]!;
    if (!m.isArc) continue;
    const sign = exactRadialSign(m, side);
    if (sign === null) {
      return fail('FALLBACK_DEGENERATE_SOURCE', `member-${i}-radial-sign`);
    }
    const roff = m.radius + sign * d;
    if (!Number.isFinite(roff)) {
      return fail('FALLBACK_ROFF_NONFINITE', `member-${i}-nonfinite-roff`);
    }
    if (roff === 0) return fail('FALLBACK_ROFF_COLLAPSE', `member-${i}-roff-zero`);
    if (roff < 0) return fail('FALLBACK_ROFF_INVERSION', `member-${i}-roff-negative`);
  }
  return { admitted: true, d };
};
