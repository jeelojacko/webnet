/**
 * Phase 20F — grading definition scaling under the project coordinate
 * transform (engine only, pure).
 *
 * The project transform is an orientation-preserving SIMILARITY with uniform
 * horizontal scale |k| and UNCHANGED Z (18R is XY-only). Every horizontal
 * length in a grading definition therefore scales exactly by |k|:
 *   - `maxSearchDistance`      (horizontal engineering search limit)
 *   - `curveChordTolerance`    (sagitta bound, a horizontal length)
 *   - `criterion.distance`     (Grade-to-Distance offset, horizontal)
 * Dimensionless/vertical quantities are invariant: `gradeRatio`,
 * `cutGradeRatio`/`fillGradeRatio`, `targetElevation`, `relativeElevation`,
 * `side`, and every Z. In particular `distance` scales (horizontal) while
 * `relativeElevation` is vertical and never scales.
 *
 * Sparse overrides stay sparse ("no materialized defaults"): an absent
 * `courseCriteria` stays absent, and existing override records are mapped
 * one-for-one (an override equal to the default stays equal after both scale).
 * `targetSurfaceId` is never minted, cleared, or rebound here — a dormant
 * retained id stays dormant.
 *
 * Scope: ONLY the project-level coordinate transform
 * (`applyCadProjectCoordinateTransform`, reached by PROJECTTRANSFORM incl.
 * GRID_GROUND) scales definitions. The selection-scoped GRIDGROUND command
 * moves a chosen entity cohort through `applyCadSelectionTransform`; a subset
 * move is not a frame change, so grading definitions are left untouched there
 * (the existing 20C pass-through contract is preserved).
 */
import type { GradingCriterion } from './grading/gradingTypes';
import type { CadGrading } from './grading/gradingTypes';
import type { CadGradingGroup, CadGradingTransition } from './grading/gradingGroupTypes';

/** Scale only horizontal criterion lengths; grade/ratio/elevation untouched. */
export const scaleGradingCriterion = (
  criterion: GradingCriterion,
  scale: number,
): GradingCriterion => {
  if (criterion.kind === 'distance') {
    return { ...criterion, distance: criterion.distance * scale };
  }
  if (criterion.kind === 'relative-elevation') {
    return { ...criterion };
  }
  if (criterion.kind === 'fixed') {
    return { ...criterion };
  }
  if (criterion.kind === 'cut-fill') {
    return { ...criterion };
  }
  if (criterion.kind === 'elevation') {
    return { ...criterion };
  }
  return { ...(criterion as GradingCriterion) };
};

/** Scale a single grading definition by the uniform horizontal factor. */
export const scaleCadGrading = (grading: CadGrading, scale: number): CadGrading => ({
  ...grading,
  sourceCourse: { ...grading.sourceCourse },
  criterion: scaleGradingCriterion(grading.criterion, scale),
  maxSearchDistance: grading.maxSearchDistance * scale,
  curveChordTolerance: grading.curveChordTolerance * scale,
});

/**
 * Phase 20M.2 Wave B: scale one retained transition intent. Width is a
 * horizontal source-line length (scales like `distance`); distance-family
 * endpoint evidence scalars are horizontal too. The recorded revision is a
 * stale output under new geometry and is dropped (any non-transform edit
 * keeps its stamp, so the staleness gate holds).
 */
const scaleTransition = (entry: CadGradingTransition, scale: number): CadGradingTransition => ({
  ...entry,
  memberIds: [...entry.memberIds],
  width: entry.width * scale,
  ...(entry.endpoints !== undefined
    ? {
        endpoints: {
          refs: [...entry.endpoints.refs],
          values:
            entry.criterionFamily === 'distance'
              ? entry.endpoints.values.map((value) => value * scale)
              : [...entry.endpoints.values],
        },
      }
    : {}),
  ...(entry.provenance !== undefined
    ? {
        provenance: {
          jointId: entry.provenance.jointId,
          memberIds: [...entry.provenance.memberIds],
          width: entry.width * scale,
          lawKind: entry.provenance.lawKind,
          lawVersion: entry.provenance.lawVersion,
          criterionFamily: entry.provenance.criterionFamily,
          side: entry.provenance.side,
        },
      }
    : {}),
});

/** Scale a grading group: default criterion, search/tolerance, sparse overrides. */
export const scaleCadGradingGroup = (group: CadGradingGroup, scale: number): CadGradingGroup => ({
  ...group,
  sourceCourses: group.sourceCourses.map((course) => ({ ...course })),
  criterion: scaleGradingCriterion(group.criterion, scale),
  ...(group.courseCriteria !== undefined
    ? {
        courseCriteria: group.courseCriteria.map((entry) => ({
          sourceCourse: { ...entry.sourceCourse },
          criterion: scaleGradingCriterion(entry.criterion, scale),
        })),
      }
    : {}),
  // Phase 20M.2 Wave B: transitions ride along (never dropped to absence).
  ...(group.transitions !== undefined
    ? { transitions: group.transitions.map((entry) => scaleTransition(entry, scale)) }
    : {}),
  maxSearchDistance: group.maxSearchDistance * scale,
  curveChordTolerance: group.curveChordTolerance * scale,
});
