/**
 * Phase 20B — Grade-to-Surface / Daylight grading definitions and results.
 *
 * FROZEN CONTRACT (2026-09-27): parallel engine slices build against this file.
 * Do not rename exported symbols without updating all consumers.
 *
 * - `CadGrading` is drawing-owned, persists definition ONLY (no derived geometry).
 * - One definition grades ONE physical Feature Line course on ONE side.
 * - Results (`CadGradingResult`) are session-only and never persisted.
 */

export type GradingSide = 'left' | 'right';

export type GradingCriterion =
  | { kind: 'fixed'; gradeRatio: number }
  | { kind: 'cut-fill'; cutGradeRatio: number; fillGradeRatio: number };

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
  targetSurfaceId: string;
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
