/**
 * STRUCT-241.10: extracted Phase 18F/18H surface model and display-style leaf
 * types. The cadTypes.ts hub re-exports these for legacy import paths.
 */

import type { CadSurfaceDefinition } from './cadSurfaceDefinitionTypes';
import type { CadLayerId } from './cadCorePrimitiveTypes';

export type CadSurfaceStatus =
  | 'UNBUILT'
  | 'CURRENT'
  | 'NEEDS_REBUILD'
  | 'BUILDING'
  | 'FAILED'
  | 'BROKEN_REFERENCE'
  | 'INSUFFICIENT_DATA';

export type CadSurfacePurpose =
  | 'existing-ground'
  | 'design'
  | 'design-patch'
  | 'reference'
  | 'other';

export interface CadSurface {
  id: string;
  name: string;
  definition: CadSurfaceDefinition;
  /**
   * Phase 20D workflow role (Existing Ground vs Design vs patch vs reference).
   * Operator-authored metadata ONLY — never inferred, never geometry: excluded
   * from the geometry revision by construction (revision hashes the definition).
   * Absent = legacy neutral surface.
   */
  purpose?: CadSurfacePurpose;
  styleId?: string;
  /** Geometry-only revision of the last successful build; absent = never built. */
  cachedRevision?: string | null;
  /** Display/lock layer; absent = ByLayer-default (visible, unlocked). */
  layerId?: CadLayerId;
  /** Last worker/transport failure; derived status stays authoritative. */
  buildDiagnostic?: string;
}

/** Phase 18H: per-kind contour line appearance (display only, never geometry). */
export interface CadContourAppearance {
  color?: string;
  lineweight?: number;
  /** 0 (opaque) .. 1 (fully transparent). Default 0. */
  opacity?: number;
}

/** Phase 18F: surface display styling ONLY (never affects geometry/revision). */
export interface CadSurfaceStyle {
  id: string;
  name: string;
  color?: string;
  /** 0 (opaque) .. 1 (fully transparent). Default 0. */
  opacity?: number;
  showTriangles?: boolean;
  showContours?: boolean;
  /** Display-only extras for the seed styles (never affect geometry). */
  showPoints?: boolean;
  showBoundary?: boolean;
  description?: string;
  /**
   * Phase 18H contour display intent. Major model is major-every-N minor
   * levels (NOT an explicit major interval): a level with index k is major
   * when k is a multiple of majorContourEvery (mirrors computeContourLevels).
   * Absent on legacy styles = no contour display (display-time default).
   */
  minorContourInterval?: number;
  majorContourEvery?: number;
  contourBaseElevation?: number;
  minorContour?: CadContourAppearance;
  majorContour?: CadContourAppearance;
  showContourLabels?: boolean;
  /** Default true: label major contours only. */
  labelMajorOnly?: boolean;
  /** Along-path label spacing in drawing units. */
  contourLabelSpacing?: number;
  /** Decimals for label text (elevation in drawing units, no suffix). */
  contourLabelPrecision?: number;
}
