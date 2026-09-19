import type { LandXmlImportPreview, LandXmlImportUnits } from '../../engine/landxmlImport';
import type { LandXmlCommitSelection } from '../../engine/cad/cadLandxmlCommit';

/**
 * Phase 18M — LandXML production import review (UI-only staging).
 *
 * Worker-3 handoff seam. The workspace stages ONE preview per drawing and
 * holds the user's selection here. Worker 3 consumes `LandXmlImportStagedState`
 * + `LandXmlImportCommitPayload` and routes the commit through the existing
 * history seam (`commitLandXmlImport`) plus `SurfaceBuildService`; this module
 * never mutates the drawing.
 */

/** Engine dispositions as they appear on alignment/surface preview rows. */
export type LandXmlImportDisposition = 'IMPORTABLE' | 'WARNING' | 'UNSUPPORTED' | 'BLOCKED';

/** UI selection: points are category-level, alignments/TIN surfaces per object. */
export interface LandXmlImportReviewSelection {
  readonly includePoints: boolean;
  readonly alignmentNames: readonly string[];
  readonly surfaceNames: readonly string[];
}

/** Staged preview bound to the drawing it was parsed against. */
export interface LandXmlImportStagedState {
  readonly drawingId: string;
  readonly fileName: string;
  /** Raw document version (UI display only; the engine validates 1.2). */
  readonly version: string;
  readonly preview: LandXmlImportPreview;
  readonly selection: LandXmlImportReviewSelection;
}

/** Exact payload worker 3 commits + schedules builds from. */
export interface LandXmlImportCommitPayload {
  readonly drawingId: string;
  readonly fileName: string;
  readonly version: string;
  readonly preview: LandXmlImportPreview;
  readonly selection: LandXmlImportReviewSelection;
  /** Mapped onto the engine `commitLandXmlImport(state, cache, preview, fileName, selection)` contract. */
  readonly commitSelection: LandXmlCommitSelection;
}

export type { LandXmlImportUnits, LandXmlCommitSelection };
