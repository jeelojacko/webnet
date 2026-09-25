/**
 * Phase 18U UI — wired analysis display module (scene-facing).
 *
 * The `.service` builders (`cadAnalysisView.service.ts`,
 * `cadAnalysisLegendView.service.ts`) are the reference implementations of the
 * per-band fill paths and legend row geometry. This module is the WIRED entry
 * point the preview scene consumes: it unifies both builders into one call and
 * exposes the layer types the canvas + viewport filter use.
 *
 * Display contract (unchanged from the reference builders): one aggregated
 * path per band from cached CURRENT result regions, map-owned opacity,
 * `showBoundaries` outlines, legends as a VIEW over map + cached result, and
 * fills render UNDER surface/contour passes with `pointerEvents: none`.
 * A stale/superseded result never renders.
 */

import type { CadSurfaceCache } from './cadSurfaceCache';
import type { CadProject } from './cadTypes';
import type { SurfaceAnalysisCache } from './surfaceAnalysisCache';
import { resolveCurrentAnalysisRevision } from './cadAnalysisView.service';
import { buildAnalysisDisplayLayers } from './cadAnalysisView.service';
import {
  buildAnalysisLegendGeometry,
  type AnalysisLegendGeometry,
  type AnalysisLegendUnits,
} from './cadAnalysisLegendView.service';

export {
  buildAnalysisDisplayLayers,
  resolveCurrentAnalysisRevision,
  DEFAULT_ANALYSIS_FILL_OPACITY,
} from './cadAnalysisView.service';
export type {
  CadAnalysisBandDisplayPath,
  CadAnalysisDisplayLayer,
} from './cadAnalysisView.service';
export type {
  AnalysisLegendGeometry,
  AnalysisLegendRowGeometry,
  AnalysisLegendUnits,
} from './cadAnalysisLegendView.service';

import type { CadAnalysisDisplayLayer } from './cadAnalysisView.service';

export interface CadAnalysisSceneLayers {
  layers: CadAnalysisDisplayLayer[];
  legendLayers: AnalysisLegendGeometry[];
}

/**
 * Every CURRENT analysis fill + every legend (geometry only; a legend whose
 * map has no CURRENT result renders its title + ranges, never stale
 * quantities). Caller-supplied unit labels keep drawing-unit conversion at the
 * display boundary.
 */
export const buildAnalysisSceneLayers = (
  project: CadProject,
  tinCache: CadSurfaceCache | null,
  analysisCache: SurfaceAnalysisCache | null,
  units: AnalysisLegendUnits,
): CadAnalysisSceneLayers => {
  const layers = buildAnalysisDisplayLayers(project, tinCache, analysisCache);
  if (!analysisCache) return { layers, legendLayers: [] };
  const legendLayers: AnalysisLegendGeometry[] = [];
  for (const legend of project.analysisLegends ?? []) {
    const def = (project.analysisMaps ?? []).find((entry) => entry.id === legend.analysisId);
    if (!def) continue;
    const revision = resolveCurrentAnalysisRevision(project, def);
    const cached = analysisCache.get(def.id, revision) ?? null;
    legendLayers.push(buildAnalysisLegendGeometry(project, legend, def, cached, units));
  }
  return { layers, legendLayers };
};
