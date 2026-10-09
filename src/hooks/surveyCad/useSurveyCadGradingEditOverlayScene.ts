/**
 * STRUCT-194.8 — grading + surface-edit overlay scene.
 *
 * Extracted verbatim from `SurveyCadWorkspace` with no behavior change. Runs
 * AFTER the four surface edit-session hooks and their key handler, at the exact
 * former `surfaceEditOverlayPrimitives` position. Holds:
 *   - the CURRENT grading fill/daylight layers (`gradingDisplayLayers`),
 *   - the CURRENT group grading layers + failed-corner markers
 *     (`groupGradingDisplayLayers`),
 *   - the grading viewport filter stage (`displaySceneWithGrading`),
 *   - the post-filter edit/point/bulkSelection/bulkEdit preview append
 *     (`displaySceneWithSurfaceEdits`), which preserves the base scene
 *     reference whenever there are zero preview primitives.
 *
 * The four preview arrays are concatenated in the original
 * edit -> point -> bulkSelection -> bulkEdit order. All three memos keep their
 * exact dependency arrays. Never merged with the pre-grading derived scene
 * (a different ordinal location with intervening hooks).
 */
import { useMemo } from 'react';
import type { CadDisplayPrimitive, CadDisplayScene, CadProject } from '../../engine/cad/cadTypes';
import type { CadWorkspaceSnapshot } from '../../cad-app/shell/cadShellTypes';
import type { SurfaceGradingService } from '../../workers/surfaceGradingService';
import { buildGradingSceneLayers } from '../../cad-app/shell/cadGradingDisplay';
import { buildGroupGradingSceneLayers } from '../../cad-app/shell/cadGradingGroupDisplay';
import { filterCadDerivedLayersForViewport } from '../../engine/cad/cadViewportAppearance';

export interface SurveyCadGradingEditOverlaySceneArgs {
  /** Live project (grading layer viewport filter). */
  activeProject: CadProject;
  /** Scene after the pre-grading (parcel/profile/sample/section/analysis) stages. */
  displaySceneWithSections: CadDisplayScene;
  /** Published shell snapshot; grading sections drive the layer builders. */
  shellSnapshot: CadWorkspaceSnapshot | null;
  /** Grading service; group diagnostics tag failed corner/course markers. */
  gradingService: SurfaceGradingService;
  /** 18S staged current/proposed/affected edge previews. */
  surfaceEditPreviewPrimitives: readonly CadDisplayPrimitive[];
  /** 18T staged point/elevation previews. */
  surfacePointEditPreviewPrimitives: readonly CadDisplayPrimitive[];
  /** 18V window/polygon selection previews. */
  surfaceBulkSelectionPreviewPrimitives: readonly CadDisplayPrimitive[];
  /** 18V bulk-edit (value/move) previews. */
  surfaceBulkEditPreviewPrimitives: readonly CadDisplayPrimitive[];
}

export const useSurveyCadGradingEditOverlayScene = ({
  activeProject,
  displaySceneWithSections,
  shellSnapshot,
  gradingService,
  surfaceEditPreviewPrimitives,
  surfacePointEditPreviewPrimitives,
  surfaceBulkSelectionPreviewPrimitives,
  surfaceBulkEditPreviewPrimitives,
}: SurveyCadGradingEditOverlaySceneArgs): CadDisplayScene => {
  // Phase 20B — CURRENT grading fills + daylight from the shell snapshot
  // (same freshness as the manager). OFF/FROZEN layers drop here under the
  // same visible/!frozen contract as surfaces/volumes; stale/failed rows
  // contribute no layer, so superseded geometry never renders as current.
  const gradingDisplayLayers = useMemo(
    () => buildGradingSceneLayers(shellSnapshot?.grading),
    [shellSnapshot],
  );
  // Phase 20C — CURRENT group fills + daylight + seam, ghost side arrows
  // for the selected uncalculated group, failed corner/course markers.
  // OFF/FROZEN layers drop under the same contract; stale rows contribute
  // no layer, so superseded geometry never renders as current.
  const groupGradingDisplayLayers = useMemo(() => {
    const failedErrors = new Map<string, string>();
    for (const [groupId, diagnostic] of gradingService.groupGradingDiagnostics()) {
      failedErrors.set(groupId, diagnostic.error);
    }
    return buildGroupGradingSceneLayers(shellSnapshot?.gradingGroups, { failedErrors });
  }, [shellSnapshot, gradingService]);
  const displaySceneWithGrading = useMemo(
    // PERF-186.1: base is already filtered; only the newly attached grading
    // layers need the OFF/FROZEN contract applied.
    () => filterCadDerivedLayersForViewport(activeProject, displaySceneWithSections, {
      gradingLayers: gradingDisplayLayers,
      groupGradingLayers: groupGradingDisplayLayers,
    }),
    [activeProject, displaySceneWithSections, gradingDisplayLayers, groupGradingDisplayLayers],
  );
  // Phase 18S/18V overlay: staged current/proposed/affected edges and the
  // selection/bulk previews appended post-filter so they render even when
  // the style hides triangles.
  const surfaceEditOverlayPrimitives = [
    ...surfaceEditPreviewPrimitives,
    ...surfacePointEditPreviewPrimitives,
    ...surfaceBulkSelectionPreviewPrimitives,
    ...surfaceBulkEditPreviewPrimitives,
  ];
  return surfaceEditOverlayPrimitives.length === 0
    ? displaySceneWithGrading
    : {
      ...displaySceneWithGrading,
      primitives: [...displaySceneWithGrading.primitives, ...surfaceEditOverlayPrimitives],
    };
};
