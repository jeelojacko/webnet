/**
 * STRUCT-194.8 — analysis + volume session-result retirement.
 *
 * Extracted verbatim from `SurveyCadWorkspace` with no behavior change, at the
 * exact former `knownAnalysisIdsRef` position. Retirement drops session
 * results for deleted definitions (results never persist; the control planes
 * invalidate retired revisions so late worker arrivals never re-apply). Exact
 * call order and deps:
 *   1. `knownAnalysisIdsRef` + effect over `analysisMaps` (maps gone ->
 *      `analysisPlane.handleAnalysisDeleted`) and selected-map clear;
 *   2. effect over `analysisLegends` (selected-legend clear only; legends
 *      referencing a deleted map stay as BROKEN_REFERENCE);
 *   3. `knownVolumeIdsRef` + effect over `volumeSurfaces` (volumes gone ->
 *      `volumeService.handleVolumeDeleted`) and selected-volume clear.
 *
 * Each ref persists across drawing switches and is only written by its own
 * effect, so the id set is exactly the previously observed live set. No extra
 * dependency is introduced and no callback runs at render time.
 */
import { useEffect, useRef, type Dispatch, type SetStateAction } from 'react';
import type { CadProject } from '../../engine/cad/cadTypes';
import type { CadAnalysisControlPlane } from '../../cad-app/shell/cadAnalysisAdapters';
import type { SurfaceVolumeService } from '../../workers/surfaceVolumeService';

export interface SurveyCadAnalysisVolumeRetirementArgs {
  analysisMaps: CadProject['analysisMaps'];
  analysisPlane: CadAnalysisControlPlane;
  selectedAnalysisId: string | null;
  setSelectedAnalysisId: Dispatch<SetStateAction<string | null>>;
  analysisLegends: CadProject['analysisLegends'];
  selectedAnalysisLegendId: string | null;
  setSelectedAnalysisLegendId: Dispatch<SetStateAction<string | null>>;
  volumeSurfaces: CadProject['volumeSurfaces'];
  volumeService: SurfaceVolumeService;
  selectedVolumeId: string | null;
  setSelectedVolumeId: Dispatch<SetStateAction<string | null>>;
}

export const useSurveyCadAnalysisVolumeRetirement = ({
  analysisMaps,
  analysisPlane,
  selectedAnalysisId,
  setSelectedAnalysisId,
  analysisLegends,
  selectedAnalysisLegendId,
  setSelectedAnalysisLegendId,
  volumeSurfaces,
  volumeService,
  selectedVolumeId,
  setSelectedVolumeId,
}: SurveyCadAnalysisVolumeRetirementArgs): void => {
  // Phase 18U — drop session results for deleted maps (results never
  // persist; the control plane invalidates the cache). Legends referencing a
  // deleted map derive BROKEN_REFERENCE, so they are legal to keep.
  const knownAnalysisIdsRef = useRef<Set<string>>(new Set());
  useEffect(() => {
    const live = new Set((analysisMaps ?? []).map((entry) => entry.id));
    for (const id of knownAnalysisIdsRef.current) {
      if (!live.has(id)) analysisPlane.handleAnalysisDeleted(id);
    }
    knownAnalysisIdsRef.current = live;
    if (selectedAnalysisId != null && !live.has(selectedAnalysisId)) setSelectedAnalysisId(null);
  }, [analysisMaps, analysisPlane, selectedAnalysisId]);
  useEffect(() => {
    const live = new Set((analysisLegends ?? []).map((entry) => entry.id));
    if (selectedAnalysisLegendId != null && !live.has(selectedAnalysisLegendId)) {
      setSelectedAnalysisLegendId(null);
    }
  }, [analysisLegends, selectedAnalysisLegendId]);

  // Phase 18I — drop session results for deleted volumes (results never
  // persist; the service cancels in-flight work first so late arrivals
  // never re-apply). Converges: unknown ids are simply absent.
  const knownVolumeIdsRef = useRef<Set<string>>(new Set());
  useEffect(() => {
    const live = new Set((volumeSurfaces ?? []).map((entry) => entry.id));
    for (const id of knownVolumeIdsRef.current) {
      if (!live.has(id)) volumeService.handleVolumeDeleted(id);
    }
    knownVolumeIdsRef.current = live;
    if (selectedVolumeId != null && !live.has(selectedVolumeId)) setSelectedVolumeId(null);
  }, [volumeSurfaces, volumeService, selectedVolumeId]);
};
