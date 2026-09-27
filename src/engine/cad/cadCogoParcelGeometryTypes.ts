import type { CadEntityId, CadParcelCourseGeometry } from './cadTypes';
import type { CadWorldPoint } from './cadGeometry';

export interface CadParcelClosureSummary {
  areaSquareMeters: number;
  perimeterMeters: number;
  closureDeltaX: number;
  closureDeltaY: number;
  closureDistanceMeters: number;
  centroid: CadWorldPoint;
}

export interface CadParcelCourseSummary {
  fromLabel: string;
  toLabel: string;
  azimuthDeg: number;
  azimuthText: string;
  /** Line bearing, or the chord bearing for an arc course. */
  bearing: string;
  /** Line distance, or the chord length for an arc course. */
  distanceMeters: number;
  /** Present only for arc courses (Phase 19C); absent = straight course. */
  kind?: 'line' | 'arc';
  direction?: 'left' | 'right';
  radiusMeters?: number;
  deltaDeg?: number;
  arcLengthMeters?: number;
  chordBearing?: string;
  chordLengthMeters?: number;
}

export interface CadAreaUnitSummary {
  hectares: number;
  acres: number;
  squareFeet: number;
}

export interface CadParcelCurveDetail {
  courseId: string;
  kind: 'line' | 'arc';
  fromLabel: string;
  toLabel: string;
  /** Arc-only: derived curve metrics (formatted at consumption, never raw dumps). */
  radius?: number;
  deltaDeg?: number;
  arcLength?: number;
  chordLength?: number;
  chordBearing?: string;
  direction?: 'left' | 'right';
}

export interface CadParcelReportSummary extends CadParcelClosureSummary {
  parcelName: string;
  courseCount: number;
  courses: CadParcelCourseSummary[];
  /**
   * Phase 19C inquiry (additive, optional so straight-report consumers
   * stay byte-compatible): line/arc counts + per-course curve details.
   * Absent on reports built without the course resolver.
   */
  lineCount?: number;
  arcCount?: number;
  curveDetails?: CadParcelCurveDetail[];
}

export interface CadParcelSourceDraft {
  vertices: CadWorldPoint[];
  vertexLabels: string[];
  sourceEntityIds: CadEntityId[];
  /** Mixed line/arc courses (present only for ≥1-arc chains). */
  courseGeometry?: CadParcelCourseGeometry[];
}
