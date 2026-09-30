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
  type GradingTerminationDomain,
  type GradingTerminationKind,
} from '../../engine/cad/grading/gradingTypes';
import { constantAnalyticOffset, resolveRelativeElevationParams } from '../../engine/cad/grading/gradingAnalyticCriterion';

/** Short Method label (Surface / Distance / Elevation / Relative Elevation). */
export const gradingMethodLabel = (method: GradingTerminationKind): string => {
  switch (method) {
    case 'surface':
      return 'Surface';
    case 'distance':
      return 'Distance';
    case 'elevation':
      return 'Elevation';
    case 'relative-elevation':
      return 'Relative Elevation';
  }
};
import {
  formatSignedGradePercent,
  parseHorizontalVerticalRatio,
  resolveSignedGradeRatio,
  type GradingInputMode,
  type GradingSlopeDirection,
} from './cadGradingShell';

/**
 * Phase 20H — domain locking for group composers. A group terminates in ONE
 * engine domain: `surface` (fixed/cut-fill) or `analytic` (distance,
 * elevation, relative-elevation). Analytic kinds mix freely within a group,
 * so the composer offers the whole domain rather than a single exact kind
 * (the legacy per-kind lock is replaced). Surface keeps its fixed/cut-fill
 * selector, so it collapses to the single `surface` method.
 */
export const allowedMethodsForGroupDomain = (
  domain: GradingTerminationDomain,
): readonly GradingTerminationKind[] =>
  domain === 'surface'
    ? ['surface']
    : ['distance', 'elevation', 'relative-elevation'];

/** Never leave a stale draft method outside the offered set (fail to first). */
export const clampToAllowedMethods = (
  draft: GradingCriterionDraft,
  methods: readonly GradingTerminationKind[],
): GradingCriterionDraft => {
  if (methods.length === 0 || methods.includes(draft.method)) return draft;
  return { ...draft, method: methods[0]! };
};

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
  /** Relative-elevation method: signed vertical offset from the source profile text. */
  relativeElevation: string;
}

export const defaultGradingCriterionDraft = (
  method: GradingTerminationKind = 'surface',
): GradingCriterionDraft => ({
  method,
  surfaceMode: 'fixed',
  inputMode: 'percent',
  magnitude: '2',
  direction: 'down',
  cutMagnitude: '2:1',
  fillMagnitude: '3:1',
  distance: '20',
  targetElevation: '0',
  relativeElevation: '0',
});

const directionOf = (ratio: number): GradingSlopeDirection =>
  ratio < 0 ? 'down' : ratio > 0 ? 'up' : 'level';

const ratioToMagnitudeText = (ratio: number): string => String(Math.abs(ratio) * 100);
/** Ratio → explicit `nH:1V` run text (re-parsed back to the same semantic ratio). */
const ratioToRunText = (ratio: number): string =>
  ratio === 0 ? '0' : `${String(1 / Math.abs(ratio))}H:1V`;

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
  if (criterion.kind === 'elevation') {
    return {
      ...base,
      method: 'elevation',
      magnitude: ratioToMagnitudeText(criterion.gradeRatio),
      direction: directionOf(criterion.gradeRatio),
      targetElevation: String(criterion.targetElevation),
    };
  }
  return {
    ...base,
    method: 'relative-elevation',
    magnitude: ratioToMagnitudeText(criterion.gradeRatio),
    direction: directionOf(criterion.gradeRatio),
    relativeElevation: String(criterion.relativeElevation),
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
  if (draft.method === 'relative-elevation') {
    const gradeRatio = signedGradeOf(draft);
    const relativeElevation = Number(draft.relativeElevation);
    // Same machine-nonzero grade gate as Elevation; Δ must be a finite nonzero
    // offset and the derived d = Δ/g must be finite and strictly positive
    // (opposite-sign grade/Δ is a wrong-direction request, never clamped).
    if (
      gradeRatio == null || gradeRatio === 0 ||
      !Number.isFinite(relativeElevation) || relativeElevation === 0
    ) return null;
    const criterion: GradingCriterion = { kind: 'relative-elevation', gradeRatio, relativeElevation };
    const offset = constantAnalyticOffset(criterion);
    if (offset == null || !(offset > 0)) return null;
    return criterion;
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
  if (criterion.kind === 'relative-elevation') {
    const offset = constantAnalyticOffset(criterion);
    if (offset == null) return null;
    return `Grade ${formatSignedGradePercent(criterion.gradeRatio)} → relative elev ${criterion.relativeElevation.toFixed(3)} ${lengthUnit} · offset ${offset.toFixed(3)} ${lengthUnit}`;
  }
  if (criterion.kind === 'cut-fill') {
    return `Cut ${formatSignedGradePercent(criterion.cutGradeRatio)} / Fill ${formatSignedGradePercent(criterion.fillGradeRatio)}`;
  }
  return `Fixed ${formatSignedGradePercent(criterion.gradeRatio)}`;
};

/**
 * Inline diagnosis for a draft that parses to null for a *displayable* reason.
 * Only one case carries actionable text: a relative-elevation draft whose
 * grade and Δ point in opposite directions (derived offset `Δ/g <= 0`).
 * Every other invalid draft returns null and the caller keeps the generic
 * `Criterion: invalid` summary.
 */
export const gradingDraftDiagnosis = (draft: GradingCriterionDraft): string | null => {
  if (draft.method !== 'relative-elevation') return null;
  const gradeRatio = signedGradeOf(draft);
  const relativeElevation = Number(draft.relativeElevation);
  if (
    gradeRatio == null || gradeRatio === 0 ||
    !Number.isFinite(relativeElevation) || relativeElevation === 0
  ) return null;
  // Shared engine authority: a failing finite/nonzero pair can only be a
  // non-positive derived offset, i.e. grade and Δ pointing opposite ways.
  if (resolveRelativeElevationParams(gradeRatio, relativeElevation).ok) return null;
  return 'Criterion: invalid — grade and relative elevation point in opposite directions';
};
