/**
 * Phase 20C Wave-1B — grading-group definitions + results.
 *
 * A group grades an ordered CONTIGUOUS chain (or closed cycle) of Feature
 * Line courses against ONE target surface, on ONE side, with ONE shared
 * criterion/search/tolerance/corner mode. The definition persists only:
 * no member results, seams, daylight, mesh, triangle ids, status, or cached
 * results, and no per-child `CadGrading` definitions (mission §12).
 *
 * Reuses the frozen 20B value types (`GradingCriterion`, `GradingSide`,
 * `GradingAccuracy`, `GradingRegionClassification`, `GradingMesh`) so the
 * group path cannot drift from the single-course numeric contract.
 */
import type {
  GradingAccuracy,
  GradingCriterion,
  GradingMesh,
  GradingRegionClassification,
  GradingSide,
} from './gradingTypes';

/** Sole 20C corner mode; persisted so a future radial mode is additive. */
export type GradingCornerMode = 'miter';

/** One ordered course of a group, persisted in authoritative A->B direction. */
export interface GradingGroupCourse {
  vertexAId: string;
  vertexBId: string;
}

/**
 * Phase 20E Wave-1A — per-course criterion override (sparse, additive).
 *
 * `sourceCourse` references one persisted traversal course by its A->B
 * vertex ids (either storage order matches at resolve); `criterion`
 * replaces the group default for that course only. Absent entry = group
 * default. Reset-to-default removes the record (never stores a copy of
 * the default). No blends, no index keys, no station identity.
 */
export interface GradingGroupCourseCriterionOverride {
  sourceCourse: GradingGroupCourse;
  criterion: GradingCriterion;
}

/** Group-level definition (drawing-owned, definition only). */
export interface CadGradingGroup {
  id: string;
  name: string;
  sourceFeatureLineId: string;
  /** Ordered traversal: course[i].B == course[i+1].A (and last.B == first.A when closed). */
  sourceCourses: GradingGroupCourse[];
  targetSurfaceId: string;
  /** Relative to the persisted traversal direction. */
  side: GradingSide;
  criterion: GradingCriterion;
  /**
   * Phase 20E sparse per-course overrides (absent/empty = every course
   * uses `criterion`; legacy groups stay byte-identical).
   */
  courseCriteria?: GradingGroupCourseCriterionOverride[];
  maxSearchDistance: number;
  curveChordTolerance: number;
  cornerMode: GradingCornerMode;
  closed?: boolean;
  layerId?: string;
  styleId?: string;
}

export type GroupStatus =
  | 'BUILDING'
  | 'BROKEN_REFERENCE'
  | 'SOURCE_NOT_CURRENT'
  | 'UNBUILT'
  | 'FAILED'
  | 'NEEDS_RECALC'
  | 'CURRENT';

export type GroupDiagnosticCode =
  | 'MEMBER_NO_SOLUTION'
  | 'MEMBER_TARGET_GAP'
  | 'CORNER_NO_SOLUTION'
  | 'CORNER_AMBIGUOUS'
  | 'CORNER_INVERTED'
  | 'CORNER_COINCIDENT_PLANES'
  | 'CORNER_BRANCH_DISCONTINUITY'
  | 'CORNER_TARGET_GAP'
  | 'CORNER_MAX_DISTANCE'
  | 'GROUP_SELF_INTERSECTION'
  | 'GROUP_NON_MANIFOLD'
  | 'CURVE_CORNER_APPROXIMATED';

export interface GroupDiagnostic {
  code: GroupDiagnosticCode;
  /** Zero-based member index this diagnostic applies to, when known. */
  memberIndex?: number;
  /** Zero-based joint index this diagnostic applies to, when known. */
  cornerIndex?: number;
  /** Source-station span [start, end] within the member, when known. */
  stationSpan?: [number, number];
  detail?: string;
}

/** Per-member region classification in the group traversal order. */
export interface GroupMemberRegion {
  memberIndex: number;
  classification: GradingRegionClassification;
  /** Source-station span within that member. */
  stationSpan: [number, number];
}

/** Joint classification from the signed-turn rule (mission §5). */
export type GroupCornerClassification = 'GAP' | 'OVERLAP' | 'TANGENT';

/** Grading-side cut/fill relation at a corner vertex (mission §6). */
export type CornerCutFillSide = 'CUT' | 'FILL' | 'TIED';

/**
 * Per-corner derived result. Session-only; never persisted. Failed corners
 * keep their diagnostics and omit the resolved geometry fields (fail closed).
 */
export interface GroupCornerResult {
  /** Zero-based joint index: joint i sits between course i and i+1. */
  cornerIndex: number;
  /** Shared Feature Line vertex id at the joint. */
  vertexId: string;
  classification: GroupCornerClassification;
  /** Unit miter ray in world XY, absent on TANGENT/coincident/failed corners. */
  miterRay?: { mx: number; my: number };
  /** Analytic miter extent along the ray (metres), absent when unresolved. */
  miterExtent?: number;
  /** Target tie point on the miter ray as a flat XYZ triplet, when solved. */
  tiePointXyz?: [number, number, number];
  /** Derived corner daylight vertices (flat XYZ triplets) in path order. */
  daylightPoints?: number[];
  diagnostics: GroupDiagnosticCode[];
}

/** Group-level derived result (session-only, never persisted). */
export interface CadGradingGroupResult {
  groupId: string;
  /** Content revision this result was calculated at (`ggrev1:`). */
  revision: string;
  accuracy: GradingAccuracy;
  memberCount: number;
  cornerCount: number;
  memberRegions: GroupMemberRegion[];
  corners: GroupCornerResult[];
  /** Merged daylight boundary as flat XYZ triplets. */
  daylightPoints: number[];
  /**
   * Phase 20E: exact source discretization the solver consumed (stitched
   * member sourcePts in traversal order, closed). Session-only observation;
   * never persisted, never feeds numerics.
   */
  sourceBoundaryPoints?: number[];
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
  diagnostics: GroupDiagnostic[];
}
