/**
 * Phase 18U UI — analysis service/cache/inquiry reconciliation boundary.
 *
 * EVERY 18U UI module imports its derived-analysis machinery from this file
 * and nowhere else. The sibling 18U service slice owns the worker-backed
 * control plane; this module re-exports it and adds the two things the UI
 * still owns:
 *
 *   - `resolveAnalysisSourceStatus` (source resolution + derived currency)
 *   - `createCadAnalysisControlPlane`: prefers the worker-backed
 *     `SurfaceAnalysisService`; when no transport is available (tests,
 *     worker-disabled browsers) it falls back to the shared band engines via
 *     `cadAnalysisFallback.ts`, writing the SAME `CachedAnalysisResult` shape
 *     into the SAME `SurfaceAnalysisCache`. Status derivation, views, reports
 *     and legends are therefore identical on both paths.
 *
 * Calculate is explicit only: a source rebuild or threshold edit never
 * auto-starts work; it cancels in-flight work and lets the `arev1:` revision
 * compare derive NEEDS_RECALC/SOURCE_NOT_CURRENT.
 */

import type { CadSurfaceCache } from '../../engine/cad/cadSurfaceCache';
import type { CadProject, CadSurfaceStatus, VolumeSurfaceStatus } from '../../engine/cad/cadTypes';
import type { CadAnalysisMap, CadAnalysisSource } from '../../engine/cad/cadAnalysisTypes';
import { computeCadSurfaceSourceRevision } from '../../engine/cad/cadSurfaces';
import {
  createSurfaceAnalysisCache,
  type SurfaceAnalysisCache,
} from '../../engine/cad/surfaceAnalysisCache';
import { resolveCurrentAnalysisRevision } from '../../engine/cad/cadAnalysisView.service';
import { queryAnalysisAt as queryEngineAnalysisAt } from '../../engine/cad/cadAnalysisInquiry';
import { SurfaceAnalysisService } from '../../workers/surfaceAnalysisService';
import { computeAnalysisFallback } from './cadAnalysisFallback';

export { createSurfaceAnalysisCache, resolveCurrentAnalysisRevision };
export type { CachedAnalysisResult, SurfaceAnalysisCache } from '../../engine/cad/surfaceAnalysisCache';
export type { AnalysisInquiryResult } from '../../engine/cad/cadAnalysisInquiry';
export { SurfaceAnalysisService };
export type { SurfaceAnalysisTransport } from '../../workers/surfaceAnalysisService';

export interface AnalysisSourceStatus {
  found: boolean;
  status: CadSurfaceStatus | VolumeSurfaceStatus | null;
  /** Display name of the resolved source (falls back to the raw id). */
  name: string;
}

/**
 * Source resolution + its own derived status. A surface is CURRENT only when
 * its mesh for the current CONTENT revision is cached; a volume source is
 * CURRENT when BOTH source TINs are (the volume snapshot's `calculable`
 * rule — the aggregate volume result is not an input to band classification).
 */
export const resolveAnalysisSourceStatus = (
  project: CadProject,
  tinCache: CadSurfaceCache,
  source: CadAnalysisSource,
): AnalysisSourceStatus => {
  if (source.kind === 'surface') {
    const surface = (project.surfaces ?? []).find((entry) => entry.id === source.surfaceId);
    if (!surface) return { found: false, status: null, name: source.surfaceId };
    const current = tinCache.get(surface.id, computeCadSurfaceSourceRevision(project, surface)) != null;
    return { found: true, status: current ? 'CURRENT' : 'UNBUILT', name: surface.name };
  }
  const volume = (project.volumeSurfaces ?? []).find(
    (entry) => entry.id === source.volumeSurfaceId,
  );
  if (!volume || volume.baseSurfaceId === volume.comparisonSurfaceId) {
    return { found: false, status: null, name: volume?.name ?? source.volumeSurfaceId };
  }
  const base = (project.surfaces ?? []).find((entry) => entry.id === volume.baseSurfaceId);
  const comparison = (project.surfaces ?? []).find(
    (entry) => entry.id === volume.comparisonSurfaceId,
  );
  if (!base || !comparison) return { found: false, status: null, name: volume.name };
  const current =
    tinCache.get(base.id, computeCadSurfaceSourceRevision(project, base)) != null &&
    tinCache.get(comparison.id, computeCadSurfaceSourceRevision(project, comparison)) != null;
  return { found: true, status: current ? 'CURRENT' : 'UNBUILT', name: volume.name };
};

/** Direct source meshes for point inquiry (whichever the map needs). */
export const analysisInquiryMeshes = (
  project: CadProject,
  tinCache: CadSurfaceCache,
  map: CadAnalysisMap,
): {
  surface?: ReturnType<CadSurfaceCache['get']> | null;
  base?: ReturnType<CadSurfaceCache['get']> | null;
  comparison?: ReturnType<CadSurfaceCache['get']> | null;
} => {
  const source = map.source;
  const meshOf = (surfaceId: string): ReturnType<CadSurfaceCache['get']> | null => {
    const surface = (project.surfaces ?? []).find((entry) => entry.id === surfaceId);
    if (!surface) return null;
    return tinCache.get(surfaceId, computeCadSurfaceSourceRevision(project, surface)) ?? null;
  };
  if (source.kind === 'surface') return { surface: meshOf(source.surfaceId) };
  const volume = (project.volumeSurfaces ?? []).find(
    (entry) => entry.id === source.volumeSurfaceId,
  );
  if (!volume) return {};
  return { base: meshOf(volume.baseSurfaceId), comparison: meshOf(volume.comparisonSurfaceId) };
};

/**
 * Exact metric + band at a plan point (engine inquiry over direct source
 * geometry — never display polygons). Null outside the source domain.
 */
export const queryAnalysisAt = (
  project: CadProject,
  tinCache: CadSurfaceCache,
  map: CadAnalysisMap,
  x: number,
  y: number,
) => queryEngineAnalysisAt(map, analysisInquiryMeshes(project, tinCache, map), x, y);

export interface CadAnalysisControlPlaneOptions {
  drawingId: string;
  /** Live project reader (ref-based; never a stale closure). */
  getProject: () => CadProject;
  /** Live drawing-id reader (guards late results across drawing switches). */
  getDrawingId: () => string;
  tinCache: CadSurfaceCache;
  /** Worker transport factory; null/absent = sync fallback path. */
  createTransport?: () => import('../../workers/surfaceAnalysisService').SurfaceAnalysisTransport | null;
  notify: (_message: string) => void;
  onStateChange: () => void;
}

/**
 * UI-facing analysis control plane. `requestCalculate` is the ONLY way a
 * result is produced. `notifySourceRebuilt` retires in-flight work for
 * affected maps without starting anything.
 */
export interface CadAnalysisControlPlane {
  readonly cache: SurfaceAnalysisCache;
  readonly service: SurfaceAnalysisService;
  requestCalculate: (_analysisId: string) => string;
  handleAnalysisDeleted: (_analysisId: string) => void;
  notifySourceRebuilt: (_surfaceId: string) => void;
  cancelAll: () => void;
  dispose: () => void;
}

export const createCadAnalysisControlPlane = (
  options: CadAnalysisControlPlaneOptions,
): CadAnalysisControlPlane => {
  const cache = createSurfaceAnalysisCache(options.drawingId);
  const service = new SurfaceAnalysisService({
    drawingId: options.drawingId,
    getProject: options.getProject,
    getDrawingId: options.getDrawingId,
    tinCache: options.tinCache,
    analysisCache: cache,
    createTransport: options.createTransport ?? (() => null),
    notify: options.notify,
    onStateChange: options.onStateChange,
  });
  const report = (message: string): string => {
    options.notify(message);
    return message;
  };
  return {
    cache,
    service,
    requestCalculate: (analysisId) => {
      const project = options.getProject();
      const map = (project.analysisMaps ?? []).find((entry) => entry.id === analysisId);
      if (!map) return report(`Analysis map ${analysisId} no longer exists.`);
      const source = resolveAnalysisSourceStatus(project, options.tinCache, map.source);
      if (!source.found) {
        return report(`Analysis “${map.name}” blocked: source “${source.name}” is missing.`);
      }
      if (source.status !== 'CURRENT') {
        return report(
          `Analysis “${map.name}” blocked: source “${source.name}” is not current — rebuild it first.`,
        );
      }
      const revision = resolveCurrentAnalysisRevision(project, map);
      if (cache.get(analysisId, revision)) {
        return report(`Analysis “${map.name}” is already current.`);
      }
      // Worker path when a transport exists; otherwise the shared engines run
      // synchronously into the same cache shape.
      const workerMessage = options.createTransport != null ? service.requestAnalysis(analysisId) : null;
      if (workerMessage != null && !workerMessage.startsWith('Analysis blocked')) {
        return report(workerMessage);
      }
      const outcome = computeAnalysisFallback(project, options.tinCache, map);
      if (!outcome.ok) {
        return report(`Analysis “${map.name}” failed: ${outcome.reason}.`);
      }
      cache.set(outcome.result);
      options.onStateChange();
      const state = outcome.result.empty ? 'no data (empty domain)' : 'current';
      const bandCount = outcome.result.result.result.bands.length;
      return report(`Analysis “${map.name}” calculated — ${bandCount} band(s), ${state}.`);
    },
    handleAnalysisDeleted: (analysisId) => service.handleAnalysisDeleted(analysisId),
    notifySourceRebuilt: (surfaceId) => service.notifyMeshBuilt(surfaceId),
    cancelAll: () => {
      cache.clear();
      options.onStateChange();
    },
    dispose: () => service.dispose(),
  };
};
