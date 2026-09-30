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
 * Single relative-elevation param authority: g finite + machine-nonzero,
 * Δ finite + machine-nonzero, derived d = Δ/g finite + strictly positive.
 * Shared by authoring validation, draft parsing, and resolution so the
 * sign rule lives in exactly one place.
 */
export const resolveRelativeElevationParams = (
  gradeRatio: number,
  relativeElevation: number,
): { ok: true; d: number } | { ok: false } => {
  if (!Number.isFinite(gradeRatio) || isMachineZero(gradeRatio)) return { ok: false };
  if (!Number.isFinite(relativeElevation) || isMachineZero(relativeElevation)) return { ok: false };
  const d = relativeElevation / gradeRatio;
  if (!Number.isFinite(d) || !(d > 0)) return { ok: false };
  return { ok: true, d };
};

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
    const params = resolveRelativeElevationParams(criterion.gradeRatio, criterion.relativeElevation);
    if (!params.ok) return null;
    return params.d;
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
  const limitElevation = sourceZ + g * d;
  if (!Number.isFinite(limitElevation)) return bad('GRADING_BAD_CRITERION');
  return { ok: true, value: { kind: 'distance', gradeRatio: g, horizontalDistance: d, limitElevation } };
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
  const params = resolveRelativeElevationParams(g, dz);
  if (!params.ok) {
    // Preserve the legacy split: non-finite/nonzero params are a bad
    // criterion; a finite-but-non-positive d is a wrong-direction request.
    if (!Number.isFinite(g) || isMachineZero(g) || !Number.isFinite(dz) || isMachineZero(dz)) {
      return bad('GRADING_BAD_CRITERION');
    }
    const d = dz / g;
    if (!Number.isFinite(d)) return bad('GRADING_BAD_CRITERION');
    return bad('GRADING_RELATIVE_ELEVATION_WRONG_DIRECTION');
  }
  const d = params.d;
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
