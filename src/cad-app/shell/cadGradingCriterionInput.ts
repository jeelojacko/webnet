/**
 * Phase 20F — shared grading criterion form model (shell-only, pure).
 *
 * One draft → criterion parser used by BOTH the Create form and the inline
 * Edit Criteria editor (no triplicate parsing). Termination method lives in
 * the criterion union (see `engine/cad/grading/gradingTypes`): Surface =
 * fixed/cut-fill, Distance = signed grade + horizontal distance,
 * Elevation = signed grade + target elevation.
 */
import {
  gradingTerminationKind,
  type GradingCriterion,
  type GradingTerminationKind,
} from '../../engine/cad/grading/gradingTypes';

/** Short Method label (Surface / Distance / Elevation). */
export const gradingMethodLabel = (method: GradingTerminationKind): string =>
  method === 'distance' ? 'Distance' : method === 'elevation' ? 'Elevation' : 'Surface';
import {
  formatSignedGradePercent,
  parseHorizontalVerticalRatio,
  resolveSignedGradeRatio,
  type GradingInputMode,
  type GradingSlopeDirection,
} from './cadGradingShell';

export interface GradingCriterionDraft {
  method: GradingTerminationKind;
  /** Surface method only: fixed vs cut/fill. */
  surfaceMode: 'fixed' | 'cut-fill';
  inputMode: GradingInputMode;
  /** Signed-grade magnitude text (percent or nH:1V run). */
  magnitude: string;
  direction: GradingSlopeDirection;
  cutMagnitude: string;
  fillMagnitude: string;
  /** Distance method: horizontal target distance text. */
  distance: string;
  /** Elevation method: absolute target elevation text. */
  targetElevation: string;
}

export const defaultGradingCriterionDraft = (
  method: GradingTerminationKind = 'surface',
): GradingCriterionDraft => ({
  method,
  surfaceMode: 'fixed',
  inputMode: 'percent',
  magnitude: '2',
  direction: 'down',
  cutMagnitude: '2',
  fillMagnitude: '3',
  distance: '20',
  targetElevation: '0',
});

const directionOf = (ratio: number): GradingSlopeDirection =>
  ratio < 0 ? 'down' : ratio > 0 ? 'up' : 'level';

const ratioToMagnitudeText = (ratio: number): string => String(Math.abs(ratio) * 100);
const ratioToRunText = (ratio: number): string => (ratio === 0 ? '0' : String(1 / Math.abs(ratio)));

/** Existing criterion → editable draft (Edit Criteria / re-open). */
export const gradingCriterionDraftFromCriterion = (
  criterion: GradingCriterion,
): GradingCriterionDraft => {
  const base = defaultGradingCriterionDraft(gradingTerminationKind(criterion));
  if (criterion.kind === 'fixed') {
    return {
      ...base,
      surfaceMode: 'fixed',
      magnitude: ratioToMagnitudeText(criterion.gradeRatio),
      direction: directionOf(criterion.gradeRatio),
    };
  }
  if (criterion.kind === 'cut-fill') {
    return {
      ...base,
      surfaceMode: 'cut-fill',
      cutMagnitude: ratioToRunText(criterion.cutGradeRatio),
      fillMagnitude: ratioToRunText(criterion.fillGradeRatio),
    };
  }
  if (criterion.kind === 'distance') {
    return {
      ...base,
      method: 'distance',
      magnitude: ratioToMagnitudeText(criterion.gradeRatio),
      direction: directionOf(criterion.gradeRatio),
      distance: String(criterion.distance),
    };
  }
  return {
    ...base,
    method: 'elevation',
    magnitude: ratioToMagnitudeText(criterion.gradeRatio),
    direction: directionOf(criterion.gradeRatio),
    targetElevation: String(criterion.targetElevation),
  };
};

const signedGradeOf = (draft: GradingCriterionDraft): number | null =>
  resolveSignedGradeRatio(draft.inputMode, Number(draft.magnitude), draft.direction);

/** Fail-closed parse: null when any field is missing/non-finite/invalid. */
export const parseGradingCriterionDraft = (
  draft: GradingCriterionDraft,
): GradingCriterion | null => {
  if (draft.method === 'distance') {
    const gradeRatio = signedGradeOf(draft);
    const distance = Number(draft.distance);
    if (gradeRatio == null || !Number.isFinite(distance) || !(distance > 0)) return null;
    return { kind: 'distance', gradeRatio, distance };
  }
  if (draft.method === 'elevation') {
    const gradeRatio = signedGradeOf(draft);
    const targetElevation = Number(draft.targetElevation);
    // Mirror engine validateGradingCriterion: zero grade is rejected (any nonzero
    // float64 has |g| >= Number.MIN_VALUE, so === 0 is the exact machine-zero gate).
    if (gradeRatio == null || gradeRatio === 0 || !Number.isFinite(targetElevation)) return null;
    return { kind: 'elevation', gradeRatio, targetElevation };
  }
  if (draft.surfaceMode === 'cut-fill') {
    const cut = resolveSignedGradeRatio('h-v', parseHorizontalVerticalRatio(draft.cutMagnitude) ?? NaN, 'up');
    const fill = resolveSignedGradeRatio('h-v', parseHorizontalVerticalRatio(draft.fillMagnitude) ?? NaN, 'down');
    if (cut == null || fill == null || !(cut > 0) || !(fill < 0)) return null;
    return { kind: 'cut-fill', cutGradeRatio: cut, fillGradeRatio: fill };
  }
  const gradeRatio = signedGradeOf(draft);
  return gradeRatio == null ? null : { kind: 'fixed', gradeRatio };
};

/** One-line human summary of the current draft; null when invalid. */
export const summarizeGradingCriterionDraft = (
  draft: GradingCriterionDraft,
  lengthUnit: string,
): string | null => {
  const criterion = parseGradingCriterionDraft(draft);
  if (criterion == null) return null;
  if (criterion.kind === 'distance') {
    return `Grade ${formatSignedGradePercent(criterion.gradeRatio)} → ${criterion.distance.toFixed(3)} ${lengthUnit}`;
  }
  if (criterion.kind === 'elevation') {
    return `Grade ${formatSignedGradePercent(criterion.gradeRatio)} → elev ${criterion.targetElevation.toFixed(3)} ${lengthUnit}`;
  }
  if (criterion.kind === 'cut-fill') {
    return `Cut ${formatSignedGradePercent(criterion.cutGradeRatio)} / Fill ${formatSignedGradePercent(criterion.fillGradeRatio)}`;
  }
  return `Fixed ${formatSignedGradePercent(criterion.gradeRatio)}`;
};
