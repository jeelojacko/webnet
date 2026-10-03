/**
 * Phase 20L.1 Task 7 — EXECUTABLE effective-criterion predicate (STUDY ONLY).
 *
 * Implements the `exactConstantPlanOffset` specification from
 * `docs/evidence/phase20l1-offset-radius-circularity.md` §3 as runnable
 * study code. Zero `src/` changes: this module only *calls* the production
 * authorities (`resolveAnalyticCriterionAt`, `gradingSideNormal`) — it never
 * re-derives them and is wired nowhere in production.
 *
 * The corpus (`phase20l1PolicyCorpus.ts`) resolves every row's `d` through
 * this predicate. `d` therefore comes from a resolved source + effective
 * criterion pair, never from a fixed label.
 */
import { gradingSideNormal } from '../src/engine/cad/grading/gradingCourseFrame';
import { resolveAnalyticCriterionAt } from '../src/engine/cad/grading/gradingAnalyticCriterion';
import { seamParameterAgreementTol } from '../src/engine/cad/grading/gradingGroupSectors';
import type { GradingCriterion, GradingSide } from '../src/engine/cad/grading/gradingTypes';
import { memberTangent, type MemberSpec } from './phase20lOffsetJoinCore';

/** One resolved source member as the predicate sees it (plan + elevation rep). */
export interface StudySource {
  /** False for non-arc curves (ellipse/unknown fail closed). */
  isArc: boolean;
  /** All plan numbers finite. */
  finite: boolean;
  radius: number;
  startZ: number;
  endZ: number;
}

export type ProvenReason = 'DISTANCE' | 'RELATIVE_ELEVATION' | 'ELEVATION_FLAT_SOURCE';

export type NotProvenReason =
  | 'ELEVATION_SLOPED_SOURCE'
  | 'SURFACE_TARGET'
  | 'MIXED_EFFECTIVE'
  | 'INVALID_CRITERION'
  | 'DEGENERATE_SOURCE'
  | 'ELEVATION_MEMBER_MISMATCH'
  | 'RADIUS';

export type EffectiveOutcome =
  | { proven: true; d: number; radiusOffset: number | null; reason: ProvenReason }
  | { proven: false; d: number | null; radiusOffset: null; reason: NotProvenReason };

/**
 * Exact radial sign per the circularity spec: side normal at the member
 * terminal dotted with the outward radial direction at V. Sign only —
 * never a tolerance. Independent path from the corpus `roffClass`
 * side/dir lookup (tests pin agreement of both).
 */
export const radialSignOf = (m: MemberSpec, side: GradingSide): 1 | -1 | null => {
  const t = memberTangent(m);
  if (!t) return null;
  if (m.kind !== 'arc') return null;
  const n = gradingSideNormal(t.nx, t.ny, side);
  if (!n) return null;
  const a = Math.atan2(m.vy - m.cy, m.vx - m.cx);
  if (!Number.isFinite(a)) return null;
  const dot = n.nx * Math.cos(a) + n.ny * Math.sin(a);
  if (!Number.isFinite(dot) || dot === 0) return null;
  return dot > 0 ? 1 : -1;
};

/**
 * World magnitude for the extent/agreement bands: `max(1,|Vx|,|Vy|)`. Same
 * quantity the classifier (`worldScaleOf`) and the audit use; exported so
 * the admission predicate and the audit derive it identically.
 */
export const joinWorldScale = (vx: number, vy: number): number =>
  Math.max(1, Math.abs(vx), Math.abs(vy));

/**
 * E1 — the ONE `|J-V|` extent comparison, shared by the admission predicate
 * and the independent corner-candidacy audit. A join whose analytic extent
 * sits at `maxSearchDistance` must not flip on a few ULPs of evaluation, so
 * the bound adds the existing 20J1 quantity-correct seam-parameter agreement
 * band (`AGREEMENT_OPS * max(EPS*scale, coordinateQuantum(worldScale))`) —
 * the very band the classifier's own `local` field already applies. No magic
 * epsilon: the band is derived from the shared agreement authority, never
 * tuned. The criterion-derived `d <= maxSearchDistance` gate stays an exact
 * production comparison and is never relaxed by this rule.
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

/** Exact offset-radius gate: `=== 0` collapse, `< 0` inverted, never epsilon. */
export const gateRadiusOffset = (
  radius: number,
  radialSign: 1 | -1,
  d: number,
): { ok: true; radiusOffset: number } | { ok: false } => {
  const roff = radius + radialSign * d;
  if (!Number.isFinite(roff)) return { ok: false };
  if (roff === 0) return { ok: false };
  if (roff < 0) return { ok: false };
  return { ok: true, radiusOffset: roff };
};

const fail = (reason: NotProvenReason, d: number | null = null): EffectiveOutcome => ({
  proven: false, d, radiusOffset: null, reason,
});

/**
 * Resolve one (effective criterion, resolved source) pair to a proven
 * constant plan distance or a named rejection. `sourceZ` for analytic
 * resolution is the member's start elevation; elevation-family constancy
 * additionally requires `startZ === endZ` exactly (no epsilon).
 */
export const resolveEffectiveConstantOffset = (
  criterion: GradingCriterion,
  source: StudySource,
  radialSign: 1 | -1 | null,
  maxSearchDistance: number,
): EffectiveOutcome => {
  if (!source.isArc && source.finite) {
    // Line members carry no radius law; the corner-level caller treats them
    // as Roff N/A (see resolveCornerEffective below), so a bare source-level
    // call with no arc is degenerate.
    return fail('DEGENERATE_SOURCE');
  }
  if (
    !source.finite ||
    !(source.radius > 0) ||
    !Number.isFinite(source.radius) ||
    !Number.isFinite(source.startZ) ||
    !Number.isFinite(source.endZ)
  ) {
    return fail('DEGENERATE_SOURCE');
  }
  if (criterion.kind === 'fixed' || criterion.kind === 'cut-fill') {
    // TIN root / branch-switching: not provable from the source rep.
    // (Production agrees: resolveAnalyticCriterionAt fails these closed.)
    return fail('SURFACE_TARGET');
  }
  if (criterion.kind === 'elevation' && source.startZ !== source.endZ) {
    // Exact comparison only: any slope makes d(s) linear (class C).
    return fail('ELEVATION_SLOPED_SOURCE');
  }
  const r = resolveAnalyticCriterionAt(criterion, source.startZ, maxSearchDistance);
  if (!r.ok) return fail('INVALID_CRITERION');
  const d = r.value.horizontalDistance;
  if (!Number.isFinite(d) || !(d > 0) || d > maxSearchDistance) return fail('INVALID_CRITERION');
  if (radialSign === null) return fail('DEGENERATE_SOURCE');
  const g = gateRadiusOffset(source.radius, radialSign, d);
  if (!g.ok) return fail('RADIUS', d);
  const reason: ProvenReason =
    criterion.kind === 'distance'
      ? 'DISTANCE'
      : criterion.kind === 'relative-elevation'
        ? 'RELATIVE_ELEVATION'
        : 'ELEVATION_FLAT_SOURCE';
  return { proven: true, d, radiusOffset: g.radiusOffset, reason };
};

export interface CornerMember {
  member: MemberSpec;
  /** Study-assigned source elevations for this corner (plan fixtures carry no Z). */
  startZ: number;
  endZ: number;
}

export type CornerEffective =
  | { proven: true; d: number; reason: ProvenReason }
  | { proven: false; d: null; reason: NotProvenReason };

/**
 * Corner-level effective gate: one effective criterion shared by both
 * members (mixed-effective groups must pre-resolve to a single `d` via
 * resolveMixedEffective below). EACH member's distance is resolved at its
 * own source elevation and the two must be the SAME EXACT `d` (`===`);
 * any mismatch (e.g. elevation on differing member flats) is NOT_PROVEN.
 * Line members are Roff N/A; every arc member must pass the exact Roff
 * gate under the criterion-derived `d`.
 */
export const resolveCornerEffective = (
  criterion: GradingCriterion,
  members: [CornerMember, CornerMember],
  side: GradingSide,
  maxSearchDistance: number,
): CornerEffective => {
  if (criterion.kind === 'fixed' || criterion.kind === 'cut-fill') return { proven: false, d: null, reason: 'SURFACE_TARGET' };
  const sloped = members.some((m) => m.startZ !== m.endZ);
  if (criterion.kind === 'elevation' && sloped) return { proven: false, d: null, reason: 'ELEVATION_SLOPED_SOURCE' };
  const z0 = members[0]!.startZ;
  const z1 = members[1]!.startZ;
  if (!members.every((m) => Number.isFinite(m.startZ) && Number.isFinite(m.endZ))) {
    return { proven: false, d: null, reason: 'DEGENERATE_SOURCE' };
  }
  const resolveAt = (z: number): number | null => {
    const r = resolveAnalyticCriterionAt(criterion, z, maxSearchDistance);
    if (!r.ok) return null;
    const di = r.value.horizontalDistance;
    if (!Number.isFinite(di) || !(di > 0) || di > maxSearchDistance) return null;
    return di;
  };
  const d0 = resolveAt(z0);
  const d1 = resolveAt(z1);
  if (d0 === null || d1 === null) return { proven: false, d: null, reason: 'INVALID_CRITERION' };
  // Only the elevation family varies by member (distance/rel-el d has no
  // source term, so d0===d1 there by construction); the label names the
  // only family that can trigger it.
  if (d0 !== d1) return { proven: false, d: null, reason: 'ELEVATION_MEMBER_MISMATCH' };
  const d = d0;
  for (const m of members) {
    if (m.member.kind !== 'arc') continue;
    if (!(m.member.radius > 0) || !Number.isFinite(m.member.radius)) {
      return { proven: false, d: null, reason: 'DEGENERATE_SOURCE' };
    }
    const sign = radialSignOf(m.member, side);
    if (sign === null) return { proven: false, d: null, reason: 'DEGENERATE_SOURCE' };
    if (!gateRadiusOffset(m.member.radius, sign, d).ok) {
      return { proven: false, d: null, reason: 'RADIUS' };
    }
  }
  const reason: ProvenReason =
    criterion.kind === 'distance'
      ? 'DISTANCE'
      : criterion.kind === 'relative-elevation'
        ? 'RELATIVE_ELEVATION'
        : 'ELEVATION_FLAT_SOURCE';
  return { proven: true, d, reason };
};

/**
 * Mixed-effective gate (class C/D): every effective member must be proven
 * and resolve to the same `d`. Any surface member or differing `d` fails.
 */
export const resolveMixedEffective = (
  legs: { criterion: GradingCriterion; source: StudySource; radialSign: 1 | -1 | null }[],
  maxSearchDistance: number,
): EffectiveOutcome => {
  if (legs.length === 0) return fail('INVALID_CRITERION');
  const ds: number[] = [];
  for (const leg of legs) {
    const o = resolveEffectiveConstantOffset(leg.criterion, leg.source, leg.radialSign, maxSearchDistance);
    if (!o.proven) {
      return o.reason === 'SURFACE_TARGET' || o.reason === 'ELEVATION_SLOPED_SOURCE'
        ? fail(o.reason)
        : fail('MIXED_EFFECTIVE');
    }
    ds.push(o.d);
  }
  if (!ds.every((d) => d === ds[0])) return fail('MIXED_EFFECTIVE');
  const first = legs[0]!;
  const o = resolveEffectiveConstantOffset(first.criterion, first.source, first.radialSign, maxSearchDistance);
  if (!o.proven) return fail('MIXED_EFFECTIVE');
  return o;
};
