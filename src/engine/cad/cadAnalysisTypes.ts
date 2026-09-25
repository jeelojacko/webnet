/**
 * Phase 18U surface-analysis display model (types + bounds only).
 *
 * An Analysis Map is a DRAWING-OWNED, first-class definition: band ranges over
 * one source metric (surface elevation/slope, or volume signed depth) with
 * display appearance. It is deliberately NOT baked into CadSurfaceStyle /
 * CadVolumeSurfaceStyle: a surface may carry several analysis maps, maps are
 * independently listed/renamed/deleted, and analysis appearance must never
 * touch surface or volume geometry revisions.
 *
 * Persistence: definitions only. Band areas/percentages/volumes and derived
 * fills are session-only and never serialized (18I/18J/18K precedent).
 *
 * Deliberately free of `cadTypes` imports: `cadTypes` imports these types, so
 * a back-import would create a type cycle. `layerId`/`textStyleId` are string
 * ids (`CadLayerId`/`CadTextStyleId` are `string` aliases) — no loss of safety.
 */

/** Hard cap on bands per map (fail-closed; raised by a later phase if needed). */
export const MAX_ANALYSIS_BANDS = 64;

/** Default band count for a newly generated analysis map. */
export const DEFAULT_ANALYSIS_BAND_COUNT = 5;

/** Metric available per source kind. */
export type CadAnalysisMetric =
  | 'elevation'
  | 'slope-percent'
  | 'slope-angle'
  | 'signed-depth';

/** Surface source: elevation / slope over a retained TIN. */
export interface CadAnalysisSurfaceSource {
  kind: 'surface';
  surfaceId: string;
  metric: 'elevation' | 'slope-percent' | 'slope-angle';
}

/**
 * Volume source: signed depth (comparison − base) over the 18I overlap.
 * Reuses the 18I per-vertex delta convention: Δz > 0 is FILL, Δz < 0 is CUT.
 */
export interface CadAnalysisVolumeSource {
  kind: 'volume';
  volumeSurfaceId: string;
  metric: 'signed-depth';
}

export type CadAnalysisSource = CadAnalysisSurfaceSource | CadAnalysisVolumeSource;

/**
 * One display band. `lower < upper` is required; bands may touch exactly and
 * may have gaps between them (a gap simply draws nothing). Colors/labels are
 * appearance only and never participate in the geometry revision.
 */
export interface CadAnalysisBand {
  id: string;
  lower: number;
  upper: number;
  color: string;
  /** Optional per-band override of the default `lower – upper` swatch text. */
  label?: string;
}

/**
 * Analysis map definition. `bands` order is cosmetic except that the revision
 * hashes the ordered threshold set derived from it (see
 * `computeAnalysisGeometryRevision`).
 */
export interface CadAnalysisMap {
  id: string;
  name: string;
  source: CadAnalysisSource;
  bands: CadAnalysisBand[];
  /** Display/lock layer; absent = ByLayer-default (visible, unlocked). */
  layerId?: string;
  /** Fill opacity 0 (fully transparent) .. 1 (fully opaque); fill-only. */
  opacity?: number;
  /** Draw band boundary lines (display only; never affects band membership). */
  showBoundaries?: boolean;
  description?: string;
}

/**
 * Legend presentation object: references one analysis map for its rows.
 * Nothing derived (areas, percentages, volumes) is stored — the legend is a
 * view, and a legend referencing a missing map derives BROKEN_REFERENCE.
 */
export interface CadAnalysisLegend {
  id: string;
  analysisId: string;
  insertionX: number;
  insertionY: number;
  title?: string;
  /** 18O text style for title/rows; absent = current drawing text style. */
  textStyleId?: string;
  swatchWidth?: number;
  rowHeight?: number;
  showRange?: boolean;
  showArea?: boolean;
  showPercent?: boolean;
  showVolume?: boolean;
}

/**
 * Derived analysis status (never persisted). `NO_DATA` = the source is
 * current but the successful result measured a zero-measure/void-only domain;
 * `BROKEN_REFERENCE` = source id does not resolve; `SOURCE_NOT_CURRENT` =
 * source exists but its own status is anything other than CURRENT.
 */
export type CadAnalysisStatus =
  | 'UNBUILT'
  | 'CURRENT'
  | 'NEEDS_RECALC'
  | 'BUILDING'
  | 'FAILED'
  | 'BROKEN_REFERENCE'
  | 'SOURCE_NOT_CURRENT'
  | 'NO_DATA';
