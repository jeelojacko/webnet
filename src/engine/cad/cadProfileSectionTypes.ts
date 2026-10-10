/**
 * STRUCT-241.9 CAD surface-profile / sample-line / section type leaf.
 *
 * Type-only module. It owns the ten profile/section contracts extracted
 * verbatim from `cadTypes.ts`:
 *
 * - `CadSurfaceProfile` — Phase 18J surface profile definition.
 * - `CadProfileStyle` — Phase 18J profile display styling.
 * - `CadProfileView` — Phase 18J profile view presentation object.
 * - `SurfaceProfileStatus` — Phase 18J derived profile status union.
 * - `CadSectionSurfaceSource` — Phase 18K sample-line surface source.
 * - `CadSampleLine` — Phase 18K straight sample line (RAW chainage identity).
 * - `CadSampleLineGroup` — Phase 18K sample-line group.
 * - `CadSectionStyle` — Phase 18K section display styling.
 * - `CadSectionView` — Phase 18K section view presentation object.
 * - `CadSectionStatus` — Phase 18K derived section status union.
 *
 * Bodies, comments, property order, discriminants, unions, optionality,
 * semicolons, and whitespace are copied verbatim from `cadTypes.ts`; the only
 * change is that `CadEntityId` and `CadLayerId` now come from their
 * import-free leaf `./cadCorePrimitiveTypes` instead of the `cadTypes` hub.
 * The `cadTypes` hub re-exports these declarations to preserve its existing
 * public surface.
 *
 * Contract: type-only imports only, and only from
 * `./cadCorePrimitiveTypes` (`CadEntityId`, `CadLayerId`). It must never
 * import `cadTypes`, the volume leaf, any barrel, an engine runtime module,
 * or `cadTransactions`, and it declares no runtime exports.
 */

import type { CadEntityId, CadLayerId } from './cadCorePrimitiveTypes';

/**
 * Phase 18J: surface profile definition. Holds ONLY the alignment + surface
 * refs plus display binding; samples, revisions, and statuses are always
 * derived and never serialized.
 */
export interface CadSurfaceProfile {
  id: string;
  name: string;
  alignmentEntityId: CadEntityId;
  surfaceId: string;
  styleId?: string;
  description?: string;
}

/** Phase 18J: profile display styling ONLY (never affects geometry/revision). */
export interface CadProfileStyle {
  id: string;
  name: string;
  color: string;
  lineweight: number;
  /** 0 (opaque) .. 1 (fully transparent). Default 0. */
  opacity: number;
  showVertices?: boolean;
}

/**
 * Phase 18J: profile view presentation object (insertion XY, scales, datum,
 * grid intervals) — NOT thousands of CadEntity primitives. Derived display
 * geometry is session-only and never persisted.
 */
export interface CadProfileView {
  id: string;
  name: string;
  alignmentEntityId: CadEntityId;
  profileIds: string[];
  insertionX: number;
  insertionY: number;
  width?: number;
  height?: number;
  horizontalScale: number;
  verticalExaggeration: number;
  datumElevation?: number;
  datumMode: 'auto' | 'explicit';
  datumStep?: number;
  majorStationInterval?: number;
  minorStationInterval?: number;
  elevationGridInterval?: number;
  styleId?: string;
}

/** Phase 18J: derived profile status (never persisted; never a trusted flag). */
export type SurfaceProfileStatus =
  | 'UNBUILT'
  | 'CURRENT'
  | 'NEEDS_REBUILD'
  | 'BUILDING'
  | 'FAILED'
  | 'BROKEN_REFERENCE'
  | 'SOURCE_NOT_CURRENT'
  | 'NO_OVERLAP';

// ---------------------------------------------------------------------------
// Phase 18K sample lines / cross sections
// ---------------------------------------------------------------------------

/** One surface a sample-line group extracts from (+ optional display style). */
export interface CadSectionSurfaceSource {
  surfaceId: string;
  sectionStyleId?: string;
}

/**
 * Phase 18K: one straight sample line across an alignment. Stored by RAW
 * chainage (geometry truth) plus widths and skew — display station text is
 * presentation only and NEVER the identity. Skew is degrees clockwise from
 * the alignment-perpendicular (0 = square to the alignment).
 */
export interface CadSampleLine {
  id: string;
  /** Operator override; absent = derived station label. */
  manualName?: string;
  rawStation: number;
  leftWidth: number;
  rightWidth: number;
  skewDeg: number;
}

/**
 * Phase 18K: a drawing-owned sample-line group bound to exactly ONE
 * alignment. Holds source surfaces + ordered sample lines only — no TIN
 * data, no extracted sections, no revisions, no statuses.
 */
export interface CadSampleLineGroup {
  id: string;
  name: string;
  alignmentEntityId: CadEntityId;
  surfaceSources: CadSectionSurfaceSource[];
  sampleLines: CadSampleLine[];
  layerId?: CadLayerId;
  /** Optional pairwise cut/fill area comparison (base vs comparison surface). */
  areaComparison?: { baseSurfaceId: string; comparisonSurfaceId: string };
}

/** Phase 18K: section display styling ONLY (never affects geometry/revision). */
export interface CadSectionStyle {
  id: string;
  name: string;
  color: string;
  lineweight: number;
  /** 0 (opaque) .. 1 (fully transparent). Default 0. */
  opacity: number;
  showVertices?: boolean;
}

/**
 * Phase 18K: section view presentation object (one sample line per view).
 * Unlike CadProfileView this carries an explicit layerId so OFF/FROZEN/LOCK
 * apply per view without a rebuild. Derived display geometry never persists.
 */
export interface CadSectionView {
  id: string;
  name: string;
  sampleLineGroupId: string;
  sampleLineId: string;
  sourceSurfaceIds: string[];
  insertionX: number;
  insertionY: number;
  horizontalScale: number;
  verticalExaggeration: number;
  datumMode: 'auto' | 'explicit';
  datumElevation?: number;
  offsetGridInterval?: number;
  elevationGridInterval?: number;
  showCutFill?: boolean;
  styleId?: string;
  layerId?: CadLayerId;
}

/** Phase 18K: derived section status per sample-line x source (never persisted). */
export type CadSectionStatus =
  | 'UNBUILT'
  | 'CURRENT'
  | 'NEEDS_REBUILD'
  | 'BUILDING'
  | 'FAILED'
  | 'BROKEN_REFERENCE'
  | 'SOURCE_NOT_CURRENT'
  | 'OUT_OF_RANGE'
  | 'NO_COVERAGE';
