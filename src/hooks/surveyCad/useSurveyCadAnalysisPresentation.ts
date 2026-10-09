/**
 * STRUCT-194.9 — analysis / civil-export presentation memos.
 *
 * Extracted verbatim from `SurveyCadWorkspace` with no behavior change. The
 * four `useMemo`s keep their exact order and dependency arrays:
 *   1. `analysisSnapshot` — CURRENT/STALE/NEEDS_RECALC rows + legends.
 *   2. `analysisExportInput` — Export Center input from the CURRENT cache.
 *   3. `exportCivilSources` — the LandXML TIN/profile/section source bundle.
 *   4. `analysisDisplay` — analysis band fills + legend geometry.
 *
 * `analysisVersion` and `surfaceMeshSessions` are read as `void` epochs (not
 * value reads) because the analysis cache is mutated in place by the control
 * plane; the version bump / a mesh source rebuild are the only reliable
 * "results changed" triggers. The raw cache objects stay identity-stable, so
 * an appearance-only edit (color/opacity) repaints from cache without an
 * `arev1:` revision change and without re-deriving the export snapshot.
 *
 * Called once, unconditionally, at the exact former analysis-memo position
 * (after the compose lifecycle, before the F2F catalog), so the flattened
 * primitive sequence is the original four `useMemo`s. No memo wraps the
 * arguments, no service is constructed, and no workspace-object dependency is
 * introduced; downstream `useSurveyCadPreGradingDerivedScene(analysisDisplay)`
 * and the shell snapshot keep their reference identity.
 */
import { useMemo } from 'react';
import type { UnitsMode } from '../../types';
import type { CadProject } from '../../engine/cad/cadTypes';
import type { CadSurfaceCache } from '../../engine/cad/cadSurfaceCache';
import type { CadSurfaceVolumeCache } from '../../engine/cad/surfaceVolumeCache';
import type { CadProfileCache } from '../../engine/cad/profileCache';
import type { CadSectionCache } from '../../engine/cad/sectionCache';
import type { CadAnalysisControlPlane } from '../../cad-app/shell/cadAnalysisAdapters';
import {
  analysisAreaUnit,
  analysisVolumeUnit,
  buildCadAnalysisSnapshot,
  type CadAnalysisSnapshot,
} from '../../cad-app/shell/cadAnalysisSnapshot';
import { buildAnalysisExportInput } from '../../cad-app/shell/cadAnalysisExportInput';
import type { CadAnalysisExportInput } from '../../engine/cad/cadAnalysisExportScene';
import {
  buildAnalysisSceneLayers,
  type CadAnalysisSceneLayers,
} from '../../engine/cad/cadAnalysisDisplayView';

export interface SurveyCadAnalysisPresentationArgs {
  /** Live project (history-present) driving analysis/export derivation. */
  activeProject: CadProject;
  /** Per-drawing TIN cache. */
  surfaceCache: CadSurfaceCache;
  /** Per-drawing analysis volume result cache. */
  volumeCache: CadSurfaceVolumeCache;
  /** Per-drawing profile cache (civil export source). */
  profileCache: CadProfileCache;
  /** Per-drawing section cache (civil export source). */
  sectionCache: CadSectionCache;
  /** Analysis control plane (worker-backed; only source of a CURRENT result). */
  analysisPlane: CadAnalysisControlPlane;
  /** Monotonic analysis version epoch (in-place cache mutation trigger). */
  analysisVersion: number;
  /** Session mesh-revision index (source-rebuild trigger). */
  surfaceMeshSessions: Record<string, string[]>;
  selectedAnalysisId: string | null;
  selectedAnalysisLegendId: string | null;
  /** Drawing units mode; converted at the display boundary. */
  units: UnitsMode;
}

export interface SurveyCadAnalysisPresentation {
  analysisSnapshot: CadAnalysisSnapshot;
  analysisExportInput: CadAnalysisExportInput | undefined;
  exportCivilSources: {
    surfaceCache: CadSurfaceCache;
    profileCache: CadProfileCache;
    sectionCache: CadSectionCache;
  };
  analysisDisplay: CadAnalysisSceneLayers;
}

export const useSurveyCadAnalysisPresentation = ({
  activeProject,
  surfaceCache,
  volumeCache,
  profileCache,
  sectionCache,
  analysisPlane,
  analysisVersion,
  surfaceMeshSessions,
  selectedAnalysisId,
  selectedAnalysisLegendId,
  units,
}: SurveyCadAnalysisPresentationArgs): SurveyCadAnalysisPresentation => {
  // Phase 18U — analysis rows + legend rows (derived once per publish).
  // surfaceMeshSessions is a dep (not just an effect trigger): a source
  // rebuild mutates the mesh cache in place, so without it the rows would
  // keep reporting SOURCE_NOT_CURRENT instead of re-deriving NEEDS_RECALC.
  const analysisSnapshot = useMemo(() => {
    void analysisVersion;
    void surfaceMeshSessions;
    return buildCadAnalysisSnapshot(
      activeProject,
      surfaceCache,
      volumeCache,
      analysisPlane.cache,
      selectedAnalysisId,
      selectedAnalysisLegendId,
    );
  }, [
    activeProject,
    surfaceCache,
    volumeCache,
    analysisPlane,
    analysisVersion,
    surfaceMeshSessions,
    selectedAnalysisId,
    selectedAnalysisLegendId,
  ]);
  // Phase 18U — Export Center input from the CURRENT cached results (fills +
  // legends through the canonical export scene; absent = legacy scene).
  const analysisExportInput = useMemo(() => {
    void analysisVersion;
    void surfaceMeshSessions;
    return buildAnalysisExportInput(
      activeProject,
      analysisSnapshot,
      surfaceCache,
      analysisPlane.cache,
      units,
    );
  }, [activeProject, analysisSnapshot, surfaceCache, analysisPlane, analysisVersion, surfaceMeshSessions, units]);
  // Phase 18L/18X — runtime caches for LandXML TIN surface / profile / section
  // export (session-only; never persisted).
  const exportCivilSources = useMemo(
    () => ({ surfaceCache, profileCache, sectionCache }),
    [surfaceCache, profileCache, sectionCache],
  );
  // Phase 18U — band fills + legend geometry from the CURRENT cached results.
  // Colors/opacity come from the live definition, so a recolor or opacity edit
  // repaints from cache (the `arev1:` revision excludes appearance).
  const analysisDisplay = useMemo(() => {
    // The analysis cache is mutated in place by the control plane, so the
    // version bump is the only reliable "results changed" trigger.
    void analysisVersion;
    void surfaceMeshSessions;
    return buildAnalysisSceneLayers(activeProject, surfaceCache, analysisPlane.cache, {
      area: analysisAreaUnit(units),
      volume: analysisVolumeUnit(units),
    });
  }, [activeProject, surfaceCache, analysisPlane, analysisVersion, surfaceMeshSessions, units]);

  return { analysisSnapshot, analysisExportInput, exportCivilSources, analysisDisplay };
};
