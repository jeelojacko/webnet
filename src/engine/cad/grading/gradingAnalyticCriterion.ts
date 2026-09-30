/**
 * Phase 20G — shared analytic criterion resolution (target-free families).
 *
 * ONE closed-form authority for "what is the grading limit at this source
 * elevation?" so `solveAnalyticGradingChord`, the group corner solver, and
 * the summary helpers never re-derive the formulas independently.
 *
 * For a source station with elevation `Zsrc`:
 *   distance           d = D                       limitZ = Zsrc + g·D
 *   elevation          d = (E − Zsrc)/g            limitZ = E
 *   relative-elevation d = Δ/g                     limitZ = Zsrc + Δ
 *
 * Machine-zero is exact (`|g| < Number.MIN_VALUE`, never a survey
 * tolerance), matching `gradingAuthoring`. `d` is never clamped to
 * `maxSearchDistance`: an over-search criterion fails closed instead.
 */
import type { GradingCriterion } from './gradingTypes';

/** Machine-zero: exact zero only (never a survey tolerance). */
const isMachineZero = (value: number): boolean =>
  Math.abs(value) < Number.MIN_VALUE;

export type AnalyticCriterionKind = 'distance' | 'elevation' | 'relative-elevation';

export interface AnalyticCriterionResolution {
  kind: AnalyticCriterionKind;
  /** Signed grade ratio carried by the criterion. */
  gradeRatio: number;
  /** Derived horizontal (plan) grading distance at this source elevation. */
  horizontalDistance: number;
  /** Grading-limit elevation at this source elevation. */
  limitElevation: number;
}

export type AnalyticCriterionOutcome =
  | { ok: true; value: AnalyticCriterionResolution }
  | { ok: false; code: 'NO_SOLUTION' | 'MAX_DISTANCE_REACHED'; detail: string };

/**
 * Derived horizontal offset of a criterion when it is a constant-offset
 * family (distance stores it, relative-elevation derives Δ/g). Null for
 * criteria whose offset is not constant (elevation) or non-analytic.
 * Shared so UI labels never own a second interpretation.
 */
export const constantAnalyticOffset = (
  criterion: GradingCriterion,
): number | null => {
  if (criterion.kind === 'distance') return criterion.distance;
  if (criterion.kind === 'relative-elevation') {
    const g = criterion.gradeRatio;
    const dz = criterion.relativeElevation;
    if (!Number.isFinite(g) || isMachineZero(g) || !Number.isFinite(dz)) return null;
    const d = dz / g;
    return Number.isFinite(d) ? d : null;
  }
  return null;
};

const bad = (detail: string): AnalyticCriterionOutcome => ({
  ok: false,
  code: 'NO_SOLUTION',
  detail,
});

const beyond = (detail: string): AnalyticCriterionOutcome => ({
  ok: false,
  code: 'MAX_DISTANCE_REACHED',
  detail,
});

const resolveDistance = (
  criterion: Extract<GradingCriterion, { kind: 'distance' }>,
  sourceZ: number,
  maxSearchDistance: number,
): AnalyticCriterionOutcome => {
  const g = criterion.gradeRatio;
  const d = criterion.distance;
  if (!Number.isFinite(g)) return bad('GRADING_BAD_CRITERION');
  if (!Number.isFinite(d) || !(d > 0)) return bad('GRADING_BAD_CRITERION');
  if (d > maxSearchDistance) return beyond('GRADING_DISTANCE_BEYOND_SEARCH');
  return { ok: true, value: { kind: 'distance', gradeRatio: g, horizontalDistance: d, limitElevation: sourceZ + g * d } };
};

const resolveElevation = (
  criterion: Extract<GradingCriterion, { kind: 'elevation' }>,
  sourceZ: number,
  maxSearchDistance: number,
): AnalyticCriterionOutcome => {
  const g = criterion.gradeRatio;
  const e = criterion.targetElevation;
  if (!Number.isFinite(g) || isMachineZero(g) || !Number.isFinite(e)) {
    return bad('GRADING_BAD_CRITERION');
  }
  const d = (e - sourceZ) / g;
  if (!(d >= 0)) return bad('GRADING_ELEVATION_WRONG_DIRECTION');
  if (d > maxSearchDistance) return beyond('GRADING_ELEVATION_BEYOND_SEARCH');
  return { ok: true, value: { kind: 'elevation', gradeRatio: g, horizontalDistance: d, limitElevation: e } };
};

const resolveRelativeElevation = (
  criterion: Extract<GradingCriterion, { kind: 'relative-elevation' }>,
  sourceZ: number,
  maxSearchDistance: number,
): AnalyticCriterionOutcome => {
  const g = criterion.gradeRatio;
  const dz = criterion.relativeElevation;
  // Δ is a signed vertical offset and must be machine-nonzero; the same
  // finite/nonzero grade gate as absolute Elevation applies.
  if (!Number.isFinite(g) || isMachineZero(g) || !Number.isFinite(dz) || isMachineZero(dz)) {
    return bad('GRADING_BAD_CRITERION');
  }
  const d = dz / g;
  if (!Number.isFinite(d)) return bad('GRADING_BAD_CRITERION');
  // Strictly positive: opposite-sign grade/Δ is a wrong-direction request.
  if (!(d > 0)) return bad('GRADING_RELATIVE_ELEVATION_WRONG_DIRECTION');
  if (d > maxSearchDistance) return beyond('GRADING_RELATIVE_ELEVATION_BEYOND_SEARCH');
  const limitElevation = sourceZ + dz;
  if (!Number.isFinite(limitElevation)) return bad('GRADING_BAD_CRITERION');
  return {
    ok: true,
    value: {
      kind: 'relative-elevation',
      gradeRatio: g,
      horizontalDistance: d,
      limitElevation,
    },
  };
};

/**
 * Resolve one target-free criterion at a source elevation. Surface criteria
 * fail closed (they need the TIN solve, not this helper).
 */
export const resolveAnalyticCriterionAt = (
  criterion: GradingCriterion,
  sourceZ: number,
  maxSearchDistance: number,
): AnalyticCriterionOutcome => {
  if (!Number.isFinite(sourceZ)) return bad('GRADING_BAD_SOURCE');
  if (!Number.isFinite(maxSearchDistance) || !(maxSearchDistance > 0)) {
    return bad('GRADING_BAD_SEARCH_DISTANCE');
  }
  if (criterion.kind === 'distance') {
    return resolveDistance(criterion, sourceZ, maxSearchDistance);
  }
  if (criterion.kind === 'elevation') {
    return resolveElevation(criterion, sourceZ, maxSearchDistance);
  }
  if (criterion.kind === 'relative-elevation') {
    return resolveRelativeElevation(criterion, sourceZ, maxSearchDistance);
  }
  return bad('GRADING_BAD_CRITERION');
};
