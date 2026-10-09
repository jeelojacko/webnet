/**
 * STRUCT-194.8 — pre-grading derived display scene.
 *
 * Extracted verbatim from `SurveyCadWorkspace` with no behavior change. Holds
 * the six display-scene `useMemo` stages that run BEFORE the grading overlay
 * and the reported-computation entity selection:
 *   - parcel-label toggle filter (`displaySceneWithParcelLabelToggle`),
 *   - profile-view derived layers + their viewport filter,
 *   - sample-line / section-view derived layers + the section stage that also
 *     attaches analysis fills/legends,
 *   - `reportedComputationEntities`.
 *
 * Called once, unconditionally, at the exact former parcel-toggle memo
 * position, so the flattened hook sequence is the original six `useMemo`s
 * followed by the reported-computation `useMemo`. Every dependency array is
 * byte-identical, including the in-place `void surfaceProfileInputs.version` /
 * `void surfaceSectionInputs.version` republish reads that keep the stable
 * caches fresh. No memo is merged or reordered.
 */
import { useMemo } from 'react';
import type { CadCogoComputation } from '../../engine/cad/cadCogoTypes';
import type { CadDisplayScene, CadEntity, CadProject } from '../../engine/cad/cadTypes';
import type { CadProfileCache } from '../../engine/cad/profileCache';
import type { CadSectionCache } from '../../engine/cad/sectionCache';
import type { CadAnalysisSceneLayers } from '../../engine/cad/cadAnalysisDisplayView';
import { withBlockHoverTitles } from '../../cad-app/blocks/cadBlockOverlay';
import { buildProfileViewDisplayLayers } from '../../engine/cad/cadProfileView';
import {
  buildSampleLineDisplayLayers,
  buildSectionViewDisplayLayers,
} from '../../engine/cad/cadSectionView';
import { filterCadDerivedLayersForViewport } from '../../engine/cad/cadViewportAppearance';
import type {
  SurveyCadSurfaceProfileInputs,
  SurveyCadSurfaceSectionInputs,
} from './useSurveyCadProfileSectionLifecycle';

export interface SurveyCadPreGradingDerivedSceneArgs {
  /** Base scene from the workspace (already viewport-filtered). */
  displayScene: CadDisplayScene;
  /** Live parcel-label toggle (drawing-owned). */
  showParcelLabels: boolean;
  /** Live project; new identity per transaction re-derives derived layers. */
  activeProject: CadProject;
  /** Per-drawing profile cache. */
  profileCache: CadProfileCache | null;
  /** Profile snapshot inputs; `version` is the republish signal. */
  surfaceProfileInputs: SurveyCadSurfaceProfileInputs;
  /** Section snapshot inputs; `version` is the republish signal. */
  surfaceSectionInputs: SurveyCadSurfaceSectionInputs;
  /** Per-drawing section cache. */
  sectionCache: CadSectionCache | null;
  /** Analysis fill + legend geometry from the CURRENT cached results. */
  analysisDisplay: CadAnalysisSceneLayers;
  /** Latest reported COGO computation, or null. */
  reportedComputation: CadCogoComputation | null;
}

export interface SurveyCadPreGradingDerivedScene {
  /** Scene after parcel-label toggle + profile/sample/section/analysis stages. */
  displaySceneWithSections: CadDisplayScene;
  /** Entities created by the latest reported computation. */
  reportedComputationEntities: CadEntity[];
}

export const useSurveyCadPreGradingDerivedScene = ({
  displayScene,
  showParcelLabels,
  activeProject,
  profileCache,
  surfaceProfileInputs,
  surfaceSectionInputs,
  sectionCache,
  analysisDisplay,
  reportedComputation,
}: SurveyCadPreGradingDerivedSceneArgs): SurveyCadPreGradingDerivedScene => {
  const displaySceneWithParcelLabelToggle = useMemo(
    () =>
      showParcelLabels
        ? displayScene
        : {
            ...displayScene,
            primitives: displayScene.primitives.filter(
              (primitive) => primitive.kind !== 'text' || !primitive.id.endsWith(':parcel-label'),
            ),
          },
    [displayScene, showParcelLabels],
  );
  // Phase 18J — derived profile-view display layers. OFF/FROZEN hiding
  // is engine-owned: layers attach unfiltered and the viewport filter
  // drops them under the same visible/!frozen contract as surfaces/volumes.
  // activeProject is the dep (new identity per transaction): a ref read
  // alone never resubscribes, so view create/delete left stale [] behind.
  const profileViewLayers = useMemo(() => {
    // surfaceProfileInputs.version is the republish signal: the cache is
    // mutated in place by the service, so a version bump is the only
    // reliable "results changed" trigger for this memo.
    void surfaceProfileInputs.version;
    return buildProfileViewDisplayLayers(activeProject, profileCache);
  }, [activeProject, profileCache, surfaceProfileInputs]);
  const displaySceneWithProfiles = useMemo(
    () =>
      // PERF-186.1: displaySceneWithParcelLabelToggle is already viewport
      // filtered; only the newly attached profile-view layers need the
      // OFF/FROZEN contract applied here.
      filterCadDerivedLayersForViewport(activeProject, displaySceneWithParcelLabelToggle, {
        profileViewLayers,
      }),
    [activeProject, displaySceneWithParcelLabelToggle, profileViewLayers],
  );
  // Phase 18K — derived sample-line plan + section-view display layers.
  // OFF/FROZEN hiding is engine-owned (same visible/!frozen contract as
  // profiles); activeProject is the dep (new identity per transaction).
  const sampleLineLayers = useMemo(() => {
    void surfaceSectionInputs.version;
    return buildSampleLineDisplayLayers(activeProject);
  }, [activeProject, surfaceSectionInputs]);
  const sectionViewLayers = useMemo(() => {
    // Version bump is the only reliable "results changed" trigger: the
    // cache is mutated in place by the service.
    void surfaceSectionInputs.version;
    return buildSectionViewDisplayLayers(activeProject, sectionCache);
  }, [activeProject, sectionCache, surfaceSectionInputs]);
  const displaySceneWithSections = useMemo(() =>
    // PERF-186.1: base is already filtered; only the newly attached sample /
    // section / analysis layers are filtered. withBlockHoverTitles maps the
    // existing primitives in place (hover metadata only) — it adds/removes no
    // primitive, so the already-filtered list is reused without a rescan.
    filterCadDerivedLayersForViewport(activeProject, displaySceneWithProfiles, {
      // Phase 18N — refs render natively (persist slice); tag the
      // expansion primitives with hover titles only.
      primitives: withBlockHoverTitles(activeProject, displaySceneWithProfiles.primitives),
      sampleLineLayers,
      sectionViewLayers,
      // Phase 18U — band fills render UNDER the surface/volume passes and
      // legend rows read the CURRENT cached result at render time.
      analysisLayers: analysisDisplay.layers,
      analysisLegendLayers: analysisDisplay.legendLayers,
    }),
  [activeProject, displaySceneWithProfiles, sampleLineLayers, sectionViewLayers, analysisDisplay],
  );
  const reportedComputationEntities = useMemo(
    () =>
      reportedComputation
        ? activeProject.entities.filter((entity) => reportedComputation.createdEntityIds.includes(entity.id))
        : [],
    [activeProject.entities, reportedComputation],
  );
  return { displaySceneWithSections, reportedComputationEntities };
};
