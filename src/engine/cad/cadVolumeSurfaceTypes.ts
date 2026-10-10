/**
 * STRUCT-241.9: extracted Phase 18I TIN-to-TIN volume leaf types.
 * The cadTypes.ts hub re-exports these for legacy import paths.
 */

import type { CadLayerId } from './cadCorePrimitiveTypes';

/**
 * Phase 18I: TIN-to-TIN volume relationship. Holds ONLY the base and
 * comparison surface refs plus display binding; overlap polygons, cut/fill
 * cache, and worker status are always derived and never serialized.
 */
export interface CadVolumeSurface {
  id: string;
  name: string;
  baseSurfaceId: string;
  comparisonSurfaceId: string;
  /** Display/lock layer; absent = ByLayer-default (visible, unlocked). */
  layerId?: CadLayerId;
  styleId?: string;
  description?: string;
}

/** Phase 18I: volume display styling ONLY (never affects geometry/revision). */
export interface CadVolumeSurfaceStyle {
  id: string;
  name: string;
  showCut: boolean;
  showFill: boolean;
  /** Optional display-only zero-boundary lines (never affects quantities). */
  showZeroBoundary?: boolean;
  cutColor: string;
  fillColor: string;
  /** Display opacity factor (0 fully transparent .. 1 fully opaque). */
  opacity: number;
}

/** Phase 18I: derived volume status (never persisted; never a trusted flag). */
export type VolumeSurfaceStatus =
  | 'UNBUILT'
  | 'CURRENT'
  | 'NEEDS_RECALC'
  | 'BUILDING'
  | 'FAILED'
  | 'BROKEN_REFERENCE'
  | 'SOURCE_NOT_CURRENT'
  | 'NO_OVERLAP';

/** Phase 18I: display-only derived overlap polygon (session-only). */
export interface CadVolumeDisplayRegion {
  kind: 'cut' | 'fill';
  /** Convex polygon ring in world XY (planimetric), deterministic winding. */
  vertices: Array<{ x: number; y: number }>;
}

/** Phase 18I: derived quantity/display payload (session-only, NEVER persisted). */
export interface CadVolumeStats {
  baseTriangleCount?: number;
  comparisonTriangleCount?: number;
  candidatePairCount?: number;
  overlapPairCount?: number;
  overlapPolygonCount?: number;
  cutPolygonCount?: number;
  fillPolygonCount?: number;
  computeMs?: number;
}

export interface CadVolumeResult {
  baseSurfaceId: string;
  comparisonSurfaceId: string;
  /** `vrev1:` revision the result was computed for. */
  revision: string;
  overlapArea: number;
  cutArea: number;
  fillArea: number;
  /** Positive magnitudes (m³ or ft³). */
  cutVolume: number;
  fillVolume: number;
  /** fill − cut (signed earthwork). */
  netVolume: number;
  averageCutDepth: number;
  averageFillDepth: number;
  maxCutDepth: number;
  maxFillDepth: number;
  minDelta: number;
  maxDelta: number;
  baseArea: number;
  comparisonArea: number;
  /** Derived cut/fill polygons; omitted when display was not requested. */
  displayRegions?: CadVolumeDisplayRegion[];
  stats: CadVolumeStats;
}
