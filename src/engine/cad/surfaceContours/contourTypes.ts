/**
 * Phase 18H pure-engine contour types.
 *
 * Contour geometry only — labels are a UI-worker concern and stay out.
 * Elevations/intervals are in drawing units; no conversion happens here.
 */

export const SURFACE_CONTOUR_LEVEL_LIMIT = 'SURFACE_CONTOUR_LEVEL_LIMIT' as const;

export type ContourKind = 'minor' | 'major';

/** Level spacing contract (drawing units). */
export interface ContourLevelSpec {
  minorInterval: number;
  majorEvery: number;
  baseElevation: number;
}

/** One resolved contour elevation. levelIndex k satisfies level = base + k * interval. */
export interface ComputedLevel {
  elevation: number;
  levelIndex: number;
  kind: ContourKind;
}

export interface ContourPoint {
  x: number;
  y: number;
}

/** A stitched polyline at one elevation. Closed loops omit the duplicated closure point. */
export interface CadSurfaceContourPath {
  elevation: number;
  kind: ContourKind;
  closed: boolean;
  points: ContourPoint[];
}

export interface CadSurfaceContourStats {
  levelCount: number;
  minorLevelCount: number;
  majorLevelCount: number;
  minorPathCount: number;
  majorPathCount: number;
  totalLength: number;
  segmentCount: number;
}

export interface CadSurfaceContourSet {
  surfaceId: string;
  surfaceRevision: string;
  styleRevision: string;
  minorPaths: CadSurfaceContourPath[];
  majorPaths: CadSurfaceContourPath[];
  minLevel: number | null;
  maxLevel: number | null;
  stats: CadSurfaceContourStats;
}

/** Thrown by computeContourLevels when the level count exceeds maxLevels. */
export class ContourLevelLimitError extends Error {
  readonly code = SURFACE_CONTOUR_LEVEL_LIMIT;
  readonly levelCount: number;
  readonly maxLevels: number;
  constructor(levelCount: number, maxLevels: number) {
    super(
      `Contour level count ${levelCount} exceeds limit ${maxLevels} (${SURFACE_CONTOUR_LEVEL_LIMIT})`,
    );
    this.name = 'ContourLevelLimitError';
    this.levelCount = levelCount;
    this.maxLevels = maxLevels;
  }
}
