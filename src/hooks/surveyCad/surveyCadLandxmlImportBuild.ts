import type { LandXmlCommitReport } from '../../engine/cad/cadLandxmlCommit';
import type { LandXmlImportCommitPayload } from '../../components/landXmlImportReview/landXmlImportReview.types';

/**
 * Phase 18M — LandXML production import build glue (workspace-owned).
 *
 * Consumes one staged commit payload (worker 2's review seam), routes the
 * atomic commit through the deferred history commit (worker 1: one
 * LANDXML_IMPORT transaction, NO synchronous mesh build), then schedules
 * every committed imported-TIN surface through the shared
 * `SurfaceBuildService` serial queue. Pure sequencing over existing seams:
 * no history mechanics, no worker ownership logic here.
 *
 * Ownership: the staged payload is bound to the drawing it was parsed
 * against; a payload whose drawing no longer matches the live drawing is
 * rejected (never commits into the wrong drawing).
 *
 * Failure is asynchronous (surface materialization happens on the worker),
 * so this only reports the commit + the scheduling decision. Late worker
 * results are guarded by the service's own drawing/revision ownership.
 */

export interface LandXmlImportBuildDeps {
  /** Live drawing id (re-read at commit time, never captured at stage time). */
  getDrawingId: () => string;
  /**
   * Run the deferred commit through the workspace history seam. Returns
   * null when no history/cache seam is available (import unavailable).
   */
  runDeferredCommit: (_payload: LandXmlImportCommitPayload) => LandXmlCommitReport | null;
  /** Enqueue imported surfaces on the shared serial build queue. */
  scheduleSurfaces: (_surfaceIds: readonly string[]) => void;
  notify: (_message: string) => void;
}

export interface LandXmlImportBuildOutcome {
  readonly committed: boolean;
  readonly report: LandXmlCommitReport | null;
  readonly notice: string;
  readonly scheduledSurfaceIds: readonly string[];
}

const sumDuplicates = (report: LandXmlCommitReport): number => report.duplicatesSkipped;

const plural = (count: number, noun: string): string => `${count} ${noun}${count === 1 ? '' : 's'}`;

/**
 * Concise post-import notice. Display names only — never raw entity/surface
 * ids (deterministic, user-facing wording).
 */
export const formatLandXmlImportNotice = (report: LandXmlCommitReport): string => {
  if (!report.committed) {
    if (report.error != null && /nothing importable|nothing new/i.test(report.error)) {
      return 'Nothing new to import.';
    }
    return report.error != null ? report.error : 'Nothing new to import.';
  }
  const parts: string[] = [];
  if (report.pointsAdded > 0) parts.push(plural(report.pointsAdded, 'point'));
  if (report.alignmentsAdded > 0) parts.push(plural(report.alignmentsAdded, 'alignment'));
  if (report.surfacesAdded > 0) parts.push(plural(report.surfacesAdded, 'surface'));
  const duplicates = sumDuplicates(report);
  const summary = parts.length > 0 ? `Imported ${parts.join(', ')}.` : 'Imported.';
  const duplicateNote = duplicates > 0 ? ` ${plural(duplicates, 'duplicate')} skipped.` : '';
  const buildNote =
    report.importedSurfaceIds.length > 0
      ? ` ${plural(report.importedSurfaceIds.length, 'surface')} building…`
      : '';
  return `${summary}${duplicateNote}${buildNote}`.trim();
};

export const commitAndScheduleLandXmlImport = (
  deps: LandXmlImportBuildDeps,
  payload: LandXmlImportCommitPayload,
): LandXmlImportBuildOutcome => {
  if (payload.drawingId !== deps.getDrawingId()) {
    const notice = 'Import staged for a different drawing — reopen the file.';
    deps.notify(notice);
    return { committed: false, report: null, notice, scheduledSurfaceIds: [] };
  }
  const report = deps.runDeferredCommit(payload);
  if (!report) {
    const notice = 'Import unavailable.';
    deps.notify(notice);
    return { committed: false, report: null, notice, scheduledSurfaceIds: [] };
  }
  const notice = formatLandXmlImportNotice(report);
  if (!report.committed) {
    deps.notify(notice);
    return { committed: false, report, notice, scheduledSurfaceIds: [] };
  }
  if (report.importedSurfaceIds.length > 0) {
    deps.scheduleSurfaces(report.importedSurfaceIds);
  }
  deps.notify(notice);
  return {
    committed: true,
    report,
    notice,
    scheduledSurfaceIds: report.importedSurfaceIds,
  };
};
