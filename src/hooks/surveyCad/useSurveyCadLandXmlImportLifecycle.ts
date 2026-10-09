/**
 * STRUCT-194.3 — LandXML import control plane (stage / select / commit) plus
 * the three follow-up effects (schedule / materialization diagnostics /
 * drawing-switch cleanup).
 *
 * Extracted verbatim from `SurveyCadWorkspace` with no behavior change:
 *   - Stage: `readBrowserFileAsText` -> live-drawing-id recheck (a drawing
 *     switch during the async read must not bind a preview to the wrong
 *     drawing) -> `buildLandXmlImportPreview` + `readLandXmlDocumentVersion`
 *     + `createLandXmlImportReviewSelection`; malformed input clears the
 *     staged preview and surfaces the exact error text. Cancel clears without
 *     mutating entities.
 *   - Selection: functional `setStaged` (null stays null; otherwise a new
 *     object with the replaced selection).
 *   - Commit: `commitAndScheduleLandXmlImport` with a live drawing-id getter,
 *     the workspace `runLandXmlImport` seam and the pending-schedule setter;
 *     `importedSurfaceIdsRef` receives ids only when the commit landed; the
 *     staged preview is always released afterwards (memory hygiene). A
 *     rejected/duplicate commit mutates and schedules nothing. No worker is
 *     dispatched from the review modal.
 *
 * The three follow-up effects keep their exact dependency arrays and firing
 * order (`schedule` -> `diagnostics` -> `cleanup`) at the former handler
 * position, so staging -> commit -> one-render-later scheduling is unchanged.
 */
import { useEffect, type ChangeEvent, type Dispatch, type RefObject, type SetStateAction } from 'react';
import { readBrowserFileAsText } from '../../engine/browserFileIo';
import { buildLandXmlImportPreview, type LandXmlImportPreview } from '../../engine/landxmlImport';
import { createLandXmlImportReviewSelection } from '../../components/landXmlImportReview/landXmlImportReview.selection';
import { readLandXmlDocumentVersion } from '../../components/landXmlImportReview/landXmlImportReview.format';
import type {
  LandXmlImportCommitPayload,
  LandXmlImportReviewSelection,
  LandXmlImportStagedState,
} from '../../components/landXmlImportReview/landXmlImportReview.types';
import type { LandXmlCommitReport, LandXmlCommitSelection } from '../../engine/cad/cadLandxmlCommit';
import type { CadSurface } from '../../engine/cad/cadTypes';
import { commitAndScheduleLandXmlImport } from './surveyCadLandxmlImportBuild';

export type SurveyCadLandXmlImportRunner = (
  _preview: LandXmlImportPreview,
  _fileName: string,
  _selection: LandXmlCommitSelection,
) => LandXmlCommitReport | null;

/** Build-service surface accepted by the follow-up effects. */
export interface SurveyCadLandXmlBuildService {
  scheduleSurfaces: (_surfaceIds: readonly string[]) => void;
  sessionDiagnostics: () => ReadonlyMap<string, { error: string }>;
  buildingSurfaceIds: () => ReadonlySet<string>;
}

export interface SurveyCadLandXmlImportLifecycleArgs {
  /** Imported surfaces awaiting the deferred schedule/settlement pass. */
  pendingImportedSurfaceIds: readonly string[];
  setStagedLandXmlImport: Dispatch<SetStateAction<LandXmlImportStagedState | null>>;
  setPendingImportedSurfaceIds: Dispatch<SetStateAction<readonly string[]>>;
  importedSurfaceIdsRef: RefObject<Set<string>>;
  /** Live build-owned drawing id (re-read after the async file read). */
  getLiveDrawingId: () => string;
  /** Drawing id captured on this render (race check + cleanup epoch). */
  activeDrawingId: string;
  surfaceBuildService: SurveyCadLandXmlBuildService;
  surfaceBuildVersion: number;
  /** Current project surfaces (materialization-failure name lookup + dep). */
  surfaces: readonly CadSurface[] | undefined;
  runLandXmlImport: SurveyCadLandXmlImportRunner;
  setFileStatusText: (_text: string) => void;
}

export interface SurveyCadLandXmlImportLifecycle {
  handleLandXmlImportChange: (_event: ChangeEvent<HTMLInputElement>) => Promise<void>;
  handleLandXmlSelectionChange: (_selection: LandXmlImportReviewSelection) => void;
  handleLandXmlImportSelected: (_payload: LandXmlImportCommitPayload) => void;
}

export const useSurveyCadLandXmlImportLifecycle = ({
  pendingImportedSurfaceIds,
  setStagedLandXmlImport,
  setPendingImportedSurfaceIds,
  importedSurfaceIdsRef,
  getLiveDrawingId,
  activeDrawingId,
  surfaceBuildService,
  surfaceBuildVersion,
  surfaces,
  runLandXmlImport,
  setFileStatusText,
}: SurveyCadLandXmlImportLifecycleArgs): SurveyCadLandXmlImportLifecycle => {
  // Phase 18M — LandXML production import: read text, build a preview, stage
  // the review. Cancel = no change; malformed = visible error, no change.
  const handleLandXmlImportChange = async (event: ChangeEvent<HTMLInputElement>): Promise<void> => {
    const file = event.target.files?.[0];
    event.target.value = '';
    if (!file) return;
    try {
      const rawText = await readBrowserFileAsText(file);
      // Re-read the live drawing id: a drawing switch during the async read
      // must not bind a staged preview to the wrong drawing.
      const drawingId = getLiveDrawingId();
      if (drawingId !== activeDrawingId) {
        setFileStatusText('LandXML import cancelled — the active drawing changed while reading the file.');
        return;
      }
      const preview = buildLandXmlImportPreview(rawText, { fileName: file.name });
      setStagedLandXmlImport({
        drawingId,
        fileName: file.name,
        version: readLandXmlDocumentVersion(rawText),
        preview,
        selection: createLandXmlImportReviewSelection(preview),
      });
      setFileStatusText(`LandXML import review: ${file.name}.`);
    } catch (error) {
      setStagedLandXmlImport(null);
      setFileStatusText(
        `LandXML import failed: ${error instanceof Error ? error.message : String(error)}`,
      );
    }
  };

  const handleLandXmlSelectionChange = (selection: LandXmlImportReviewSelection): void => {
    setStagedLandXmlImport((current) => (current == null ? null : { ...current, selection }));
  };

  // Phase 18M — LandXML production import: commit through ONE deferred
  // history transaction, then schedule imported TIN builds through the
  // shared SurfaceBuildService serial queue (never a worker per surface).
  const handleLandXmlImportSelected = (payload: LandXmlImportCommitPayload): void => {
    const outcome = commitAndScheduleLandXmlImport(
      {
        getDrawingId: () => activeDrawingId,
        runDeferredCommit: (stagedPayload) =>
          runLandXmlImport(
            stagedPayload.preview,
            stagedPayload.fileName,
            stagedPayload.commitSelection,
          ),
        scheduleSurfaces: (surfaceIds) => setPendingImportedSurfaceIds(surfaceIds),
        notify: (message) => setFileStatusText(message),
      },
      payload,
    );
    if (outcome.committed) {
      for (const surfaceId of outcome.scheduledSurfaceIds) {
        importedSurfaceIdsRef.current.add(surfaceId);
      }
    }
    // Memory hygiene: raw XML/preview-derived refs never outlive the commit.
    setStagedLandXmlImport(null);
  };

  // Schedule only after the committed project is visible to the service.
  useEffect(() => {
    if (pendingImportedSurfaceIds.length === 0) return;
    surfaceBuildService.scheduleSurfaces(pendingImportedSurfaceIds);
    setPendingImportedSurfaceIds([]);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pendingImportedSurfaceIds, surfaceBuildService]);

  // Imported surfaces that fail materialization get the explicit
  // "Imported, but surface materialization failed" notice once; the
  // authoritative definition stays (FAILED + diagnostic + Rebuild).
  useEffect(() => {
    const watched = importedSurfaceIdsRef.current;
    if (watched.size === 0) return;
    const diagnostics = surfaceBuildService.sessionDiagnostics();
    const building = surfaceBuildService.buildingSurfaceIds();
    for (const surfaceId of [...watched]) {
      const diagnostic = diagnostics.get(surfaceId);
      if (diagnostic) {
        watched.delete(surfaceId);
        const surface = surfaces?.find((entry) => entry.id === surfaceId);
        setFileStatusText(
          `Imported, but surface materialization failed: “${surface?.name ?? 'surface'}” — ${diagnostic.error}. Rebuild from the Surface Manager.`,
        );
      } else if (!building.has(surfaceId)) {
        watched.delete(surfaceId);
      }
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [surfaceBuildVersion, surfaceBuildService, surfaces]);

  // Staged preview is bound to one drawing: switching drawings releases it
  // (cancel/close likewise; nothing is ever mutated by staging).
  useEffect(() => {
    setStagedLandXmlImport(null);
    importedSurfaceIdsRef.current.clear();
    setPendingImportedSurfaceIds([]);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeDrawingId]);

  return {
    handleLandXmlImportChange,
    handleLandXmlSelectionChange,
    handleLandXmlImportSelected,
  };
};
