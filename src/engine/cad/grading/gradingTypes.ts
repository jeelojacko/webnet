/**
 * Phase 20B — Grade-to-Surface / Daylight grading definitions and results.
 *
 * FROZEN CONTRACT (2026-09-27): parallel engine slices build against this file.
 * Do not rename exported symbols without updating all consumers.
 *
 * - `CadGrading` is drawing-owned, persists definition ONLY (no derived geometry).
 * - One definition grades ONE physical Feature Line course on ONE side.
 * - Results (`CadGradingResult`) are session-only and never persisted.
 *
 * Phase 20F (additive): `distance` and `elevation` criteria terminate
 * without a target surface (analytic solve, no TIN query). Fixed/cut-fill
 * semantics and bytes are unchanged.
 *
 * Phase 20G (additive): `relative-elevation` terminates without a target
 * surface on a signed vertical offset from the source profile
 * (`limitZ(u) = sourceZ(u) + relativeElevation`). The derived horizontal
 * distance is `relativeElevation / gradeRatio`; the criterion stores the
 * persisted vertical intent, never a converted distance.
 */

export type GradingSide = 'left' | 'right';

export type GradingCriterion =
  | { kind: 'fixed'; gradeRatio: number }
  | { kind: 'cut-fill'; cutGradeRatio: number; fillGradeRatio: number }
  | { kind: 'distance'; gradeRatio: number; distance: number }
  | { kind: 'elevation'; gradeRatio: number; targetElevation: number }
  | { kind: 'relative-elevation'; gradeRatio: number; relativeElevation: number };

/** Where a criterion terminates: on the target surface or analytically. */
export type GradingTerminationKind =
  | 'surface'
  | 'distance'
  | 'elevation'
  | 'relative-elevation';

/** Termination of one criterion (surface = legacy grade-to-surface solve). */
export const gradingTerminationKind = (
  criterion: GradingCriterion,
): GradingTerminationKind =>
  criterion.kind === 'fixed' || criterion.kind === 'cut-fill'
    ? 'surface'
    : criterion.kind;

/** True when the criterion needs a target surface (legacy fixed/cut-fill). */
export const gradingCriterionRequiresSurface = (
  criterion: GradingCriterion,
): boolean => gradingTerminationKind(criterion) === 'surface';

/** True for distance/elevation: solved analytically, no target query. */
export const isTargetFreeCriterion = (
  criterion: GradingCriterion,
): boolean => !gradingCriterionRequiresSurface(criterion);

/** Boundary polyline label: target tie vs analytic grading limit. */
export const gradingBoundaryLabel = (
  criterion: GradingCriterion,
): 'Daylight' | 'Grading Limit' =>
  isTargetFreeCriterion(criterion) ? 'Grading Limit' : 'Daylight';

/** Short form of {@link gradingBoundaryLabel} for compact UI slots. */
export const gradingBoundaryShortLabel = (
  criterion: GradingCriterion,
): 'Daylight' | 'Limit' =>
  isTargetFreeCriterion(criterion) ? 'Limit' : 'Daylight';

export interface GradingSourceCourse {
  /** Stable Feature Line vertex id identifying physical course endpoint A. */
  vertexAId: string;
  /** Stable Feature Line vertex id identifying physical course endpoint B. */
  vertexBId: string;
}

/** Persisted A->B direction defines grading direction; left/right are relative to it. */
export interface CadGrading {
  id: string;
  name: string;
  sourceFeatureLineId: string;
  sourceCourse: GradingSourceCourse;
  /**
   * Target surface id — required in effect for surface-terminated criteria
   * (fixed/cut-fill) and omitted for analytic distance/elevation. A retained
   * id on an analytic definition is dormant: resolve/status ignore it.
   */
  targetSurfaceId?: string;
  side: GradingSide;
  criterion: GradingCriterion;
  /** Engineering search limit (horizontal model distance, > 0). NOT a tolerance. */
  maxSearchDistance: number;
  /** Authoritative sagitta approximation bound for curved sources. */
  curveChordTolerance: number;
  layerId?: string;
  styleId?: string;
}

export type GradingAccuracy = 'EXACT' | 'CURVE_APPROXIMATED';

export type GradingStatus =
  | 'BUILDING'
  | 'BROKEN_REFERENCE'
  | 'SOURCE_NOT_CURRENT'
  | 'UNBUILT'
  | 'FAILED'
  | 'NEEDS_RECALC'
  | 'CURRENT';

export type GradingDiagnosticCode =
  | 'NO_SOLUTION'
  | 'TARGET_GAP'
  | 'MAX_DISTANCE_REACHED'
  | 'COINCIDENT_TARGET'
  | 'BRANCH_DISCONTINUITY'
  | 'ALREADY_TIED';

export interface GradingDiagnostic {
  code: GradingDiagnosticCode;
  /** Source-station span [start, end] this diagnostic applies to, when known. */
  stationSpan?: [number, number];
  detail?: string;
}

export type GradingRegionClassification = 'CUT' | 'FILL' | 'FIXED';

export interface GradingResultRegion {
  classification: GradingRegionClassification;
  /** Source-station span covered by this region. */
  stationSpan: [number, number];
}

export interface GradingMesh {
  /** Flat XYZ triplets. */
  points: number[];
  /** Flat CCW triangle index triplets into points. */
  triangles: number[];
}

export interface CadGradingResult {
  gradingId: string;
  /** Content revision this result was calculated at. */
  revision: string;
  accuracy: GradingAccuracy;
  regions: GradingResultRegion[];
  /** Derived daylight polyline vertices as flat XYZ triplets (source-station order). */
  daylightPoints: number[];
  gradingMesh: GradingMesh;
  sourceLength: number;
  gradingPlanArea: number;
  grading3dArea: number;
  minProjectionDistance: number;
  maxProjectionDistance: number;
  meanProjectionDistance: number;
  cutSourceLength: number;
  fillSourceLength: number;
  tiedSourceLength: number;
  candidateTriangleCount: number;
  intersectionSegmentCount: number;
  multipleSolutionCount: number;
  diagnostics: GradingDiagnostic[];
}

/** Circular-arc parameters for a resolved source, oriented A->B (radians). */
export interface ResolvedGradingArc {
  centerX: number;
  centerY: number;
  radius: number;
  /** Arc start angle (radians, CCW from +X, y-up). */
  startAngle: number;
  /** Arc end angle (radians, CCW from +X, y-up). */
  endAngle: number;
  /** True when the A->B sweep runs counter-clockwise. */
  sweepCCW: boolean;
}

/** Straight source course geometry resolved into persisted A->B direction. */
export interface ResolvedGradingSource {
  /** Plan start XY in A->B direction. */
  startX: number;
  startY: number;
  /** Plan end XY in A->B direction. */
  endX: number;
  endY: number;
  startZ: number;
  endZ: number;
  /** Plan length (> 0). */
  length: number;
  /** True when the current Feature Line course runs B->A and was reoriented. */
  reoriented: boolean;
  /** True when the source course is a circular arc (approximation required). */
  isArc: boolean;
  /**
   * Arc circle parameters (present when the resolving course carried them).
   * Absent on legacy/straight sources: the worker then solves the single
   * straight chord exactly as before.
   */
  arc?: ResolvedGradingArc;
}

export function isCutFillCriterion(
  criterion: GradingCriterion,
): criterion is Extract<GradingCriterion, { kind: 'cut-fill' }> {
  return criterion.kind === 'cut-fill';
}
