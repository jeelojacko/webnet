/**
 * Phase 20B — pure grading definition builders.
 *
 * Fail-closed validation only: non-empty ids/names, finite grade ratios,
 * cut > 0 / fill < 0 (run:rise sign convention — cut slopes rise away from
 * the source, fill slopes fall), positive search distance and chord
 * tolerance, distinct course endpoints. Both-Sides creates the Left+Right
 * pair atomically (both or error). No project mutation, no history.
 */
import type { CadGrading, GradingCriterion, GradingSide } from './gradingTypes';

export type GradingAuthoringError = string;

export type GradingAuthoringResult<T> =
  | { ok: true; value: T }
  | { ok: false; error: GradingAuthoringError };

export interface CreateGradingInput {
  id: string;
  name: string;
  sourceFeatureLineId: string;
  vertexAId: string;
  vertexBId: string;
  targetSurfaceId: string;
  side: GradingSide;
  criterion: GradingCriterion;
  maxSearchDistance: number;
  curveChordTolerance: number;
  layerId?: string;
  styleId?: string;
}

export interface BothSidesGradingInput extends Omit<CreateGradingInput, 'id' | 'side'> {
  leftId: string;
  rightId: string;
}

const nonEmpty = (value: unknown): value is string =>
  typeof value === 'string' && value.length > 0;

const fail = <T>(error: string): GradingAuthoringResult<T> => ({ ok: false, error });

/** Shared criterion rule: fixed finite; cut>0 and fill<0. */
export const validateGradingCriterion = (criterion: GradingCriterion): string | null => {
  if (criterion.kind === 'fixed') {
    return Number.isFinite(criterion.gradeRatio) ? null : 'gradeRatio must be finite';
  }
  if (!Number.isFinite(criterion.cutGradeRatio) || !Number.isFinite(criterion.fillGradeRatio)) {
    return 'cut/fill grade ratios must be finite';
  }
  if (!(criterion.cutGradeRatio > 0)) return 'cutGradeRatio must be > 0';
  if (!(criterion.fillGradeRatio < 0)) return 'fillGradeRatio must be < 0';
  return null;
};

/** Shared scalar rules for search distance + chord tolerance. */
const validateScalars = (input: Pick<CreateGradingInput, 'maxSearchDistance' | 'curveChordTolerance'>): string | null => {
  if (!Number.isFinite(input.maxSearchDistance) || !(input.maxSearchDistance > 0)) {
    return 'maxSearchDistance must be > 0';
  }
  if (!Number.isFinite(input.curveChordTolerance) || !(input.curveChordTolerance > 0)) {
    return 'curveChordTolerance must be > 0';
  }
  return null;
};

/** Shared identity rules: ids, name, target, distinct endpoints, side. */
const validateIdentity = (
  input: Pick<
    CreateGradingInput,
    'sourceFeatureLineId' | 'vertexAId' | 'vertexBId' | 'targetSurfaceId' | 'side'
  >,
): string | null => {
  if (!nonEmpty(input.sourceFeatureLineId)) return 'sourceFeatureLineId must be non-empty';
  if (!nonEmpty(input.vertexAId) || !nonEmpty(input.vertexBId)) {
    return 'course vertex ids must be non-empty';
  }
  if (input.vertexAId === input.vertexBId) return 'course vertex ids must differ';
  if (!nonEmpty(input.targetSurfaceId)) return 'targetSurfaceId must be non-empty';
  if (input.side !== 'left' && input.side !== 'right') return 'side must be left or right';
  return null;
};

const toGrading = (input: CreateGradingInput): CadGrading => ({
  id: input.id,
  name: input.name,
  sourceFeatureLineId: input.sourceFeatureLineId,
  sourceCourse: { vertexAId: input.vertexAId, vertexBId: input.vertexBId },
  targetSurfaceId: input.targetSurfaceId,
  side: input.side,
  criterion: input.criterion,
  maxSearchDistance: input.maxSearchDistance,
  curveChordTolerance: input.curveChordTolerance,
  ...(input.layerId !== undefined ? { layerId: input.layerId } : {}),
  ...(input.styleId !== undefined ? { styleId: input.styleId } : {}),
});

/** Create one grading definition (pure, no project mutation). */
export const createGradingDefinition = (
  input: CreateGradingInput,
): GradingAuthoringResult<CadGrading> => {
  if (!nonEmpty(input.id)) return fail('id must be non-empty');
  if (!nonEmpty(input.name)) return fail('name must be non-empty');
  const identity = validateIdentity(input);
  if (identity) return fail(identity);
  const criterionError = validateGradingCriterion(input.criterion);
  if (criterionError) return fail(criterionError);
  const scalars = validateScalars(input);
  if (scalars) return fail(scalars);
  return { ok: true, value: toGrading(input) };
};

/** Replace the criterion on an existing definition (returns a copy). */
export const editGradingCriteria = (
  current: CadGrading,
  criterion: GradingCriterion,
): GradingAuthoringResult<CadGrading> => {
  const error = validateGradingCriterion(criterion);
  if (error) return fail(error);
  return { ok: true, value: { ...current, criterion } };
};

/** Point an existing definition at a different target surface (copy). */
export const reassignGradingTarget = (
  current: CadGrading,
  targetSurfaceId: string,
): GradingAuthoringResult<CadGrading> => {
  if (!nonEmpty(targetSurfaceId)) return fail('targetSurfaceId must be non-empty');
  return { ok: true, value: { ...current, targetSurfaceId } };
};

/**
 * Create the Left+Right pair atomically: shared validation runs once, so
 * the caller gets either both definitions or a single error (never one).
 */
export const createBothSidesGrading = (
  input: BothSidesGradingInput,
): GradingAuthoringResult<{ left: CadGrading; right: CadGrading }> => {
  if (!nonEmpty(input.leftId)) return fail('leftId must be non-empty');
  if (!nonEmpty(input.rightId)) return fail('rightId must be non-empty');
  if (input.leftId === input.rightId) return fail('left/right ids must differ');
  if (!nonEmpty(input.name)) return fail('name must be non-empty');
  const identity = validateIdentity({ ...input, side: 'left' });
  if (identity) return fail(identity);
  const criterionError = validateGradingCriterion(input.criterion);
  if (criterionError) return fail(criterionError);
  const scalars = validateScalars(input);
  if (scalars) return fail(scalars);
  const left = createGradingDefinition({ ...input, id: input.leftId, side: 'left' });
  const right = createGradingDefinition({ ...input, id: input.rightId, side: 'right' });
  if (!left.ok) return left;
  if (!right.ok) return right;
  return { ok: true, value: { left: left.value, right: right.value } };
};
