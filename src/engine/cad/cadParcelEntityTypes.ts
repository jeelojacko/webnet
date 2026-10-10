/**
 * STRUCT-241.6 CAD parcel entity type leaf.
 *
 * Type-only module. It owns the six parcel contracts extracted verbatim from
 * `cadTypes.ts`:
 *
 * - `CadParcelCourseGeometry` — Phase 19C mixed line/arc parcel course
 *   geometry (endpoint-owned bulge).
 * - `CadParcelPlanRole` — Phase 19D plan role display metadata union.
 * - `CadParcelPlanInfo` — Phase 19D plan designation display metadata.
 * - `CadParcelSharedBoundaryEnd` — Phase 19D shared-boundary end ref.
 * - `CadParcelSharedBoundary` — Phase 19D shared-boundary relationship.
 * - `CadParcelEntity` — the parcel entity contract.
 *
 * Bodies, comments, property order, discriminants, unions, optionality, and
 * whitespace are copied verbatim from `cadTypes.ts`; the only change is that
 * `CadBaseEntity` and `CadDisplayPoint` now come from their leaves instead of
 * the `cadTypes` hub.
 *
 * Contract: type-only imports only, and only from
 * `./cadEntityFoundationTypes` (`CadBaseEntity`) and `./cadDisplayTypes`
 * (`CadDisplayPoint`). It must never import `cadTypes`, primitive entities,
 * any barrel, an engine runtime module, or `cadTransactions`, must not
 * cross-import the linear leaf, and declares no runtime exports.
 */

import type { CadBaseEntity } from './cadEntityFoundationTypes';
import type { CadDisplayPoint } from './cadDisplayTypes';

/**
 * Phase 19C mixed line/arc parcel course geometry (endpoint-owned bulge).
 * Signed CAD-standard bulge b = tan(sweepRad/4): sign carries left/right
 * (positive = CCW = center-left), magnitude carries minor/major
 * (|b| > 1 = major arc). Translation/rotation/uniform-scale leave it
 * unchanged; reflection flips the sign; no stale center/radius (derived
 * per course from endpoints + bulge by cadParcelArcGeometry).
 */
export type CadParcelCourseGeometry = { kind: 'line' } | { kind: 'arc'; bulge: number };

/**
 * Phase 19D plan role: user-assigned DISPLAY metadata only ("Plan Role").
 * NEVER infer legal meaning from this field. No owner/PID/deed/tenement
 * fields live on the parcel entity.
 */
export type CadParcelPlanRole =
  | 'lot'
  | 'remainder'
  | 'road'
  | 'right-of-way'
  | 'easement'
  | 'other';

/** Phase 19D plan designation: display metadata only, never legal meaning. */
export interface CadParcelPlanInfo {
  designation?: string;
  role?: CadParcelPlanRole;
  description?: string;
}

/** Phase 19D shared-boundary end: a ref to one parcel course (never geometry). */
export interface CadParcelSharedBoundaryEnd {
  parcelId: string;
  courseId: string;
}

/**
 * Phase 19D shared-boundary relationship: two parcel-course refs, nothing
 * derived (lengths/geometry resolve at read time, never persisted).
 */
export interface CadParcelSharedBoundary {
  id: string;
  first: CadParcelSharedBoundaryEnd;
  second: CadParcelSharedBoundaryEnd;
}

export interface CadParcelEntity extends CadBaseEntity {
  type: 'parcel';
  vertices: CadDisplayPoint[];
  vertexLabels: string[];
  parcelName: string;
  /**
   * Phase 19A stable course identity: courseIds[index] names the course
   * starting at vertices[index] (ring order, closing leg included).
   * Contract: when present, courseIds.length === vertices.length.
   * Absent/short on legacy drawings: load paths backfill deterministically.
   */
  courseIds?: string[];
  /**
   * Phase 19C mixed line/arc courses. Contract: when present,
   * courseGeometry.length === vertices.length (entry [index] describes the
   * course starting at vertices[index]). Absent = all-line legacy parcel
   * (byte-compatible, no migration write; load backfill untouched).
   */
  courseGeometry?: CadParcelCourseGeometry[];
  areaSquareMeters?: number;
  perimeterMeters?: number;
  closureDeltaX?: number;
  closureDeltaY?: number;
  closureDistanceMeters?: number;
  /** Phase 19D plan designation (display metadata only). Trailing key. */
  planInfo?: CadParcelPlanInfo;
}
