/**
 * Phase 18U UI — standalone (transport-less) analysis compute fallback.
 *
 * The sibling 18U service slice owns the worker path
 * (`src/workers/surfaceAnalysisService.ts` + `surfaceAnalysisCache.ts`). When
 * no worker transport is available (SSR/test/worker-disabled browser), the
 * control plane in `cadAnalysisAdapters.ts` calls THIS module: the same shared
 * band engines run synchronously over the session meshes and the result is
 * stored in the SAME `CachedAnalysisResult` shape the worker returns, so the
 * cache, status derivation, views and reports are identical either way.
 *
 * Source meshes are read only for their CURRENT content revision (fail-closed:
 * a stale/superseded mesh never produces a fresh result).
 */

import {
  analyzeElevationBands,
  type ElevationMesh,
} from '../../engine/cad/surfaceAnalysis/elevationBands';
import { analyzeSlopeBands } from '../../engine/cad/surfaceAnalysis/slopeBands';
import { computeDepthBands } from '../../engine/cad/surfaceAnalysis/depthBands';
import { validateAnalysisBands } from '../../engine/cad/surfaceAnalysis/scalarClip';
import type { CachedSurfaceMesh, CadSurfaceCache } from '../../engine/cad/cadSurfaceCache';
import { computeCadSurfaceSourceRevision } from '../../engine/cad/cadSurfaces';
import type {
  CachedAnalysisEngineResult,
  CachedAnalysisResult,
} from '../../engine/cad/surfaceAnalysisCache';
import { isAnalysisEngineResultEmpty } from '../../engine/cad/surfaceAnalysisCache';
import { resolveCurrentAnalysisRevision } from '../../engine/cad/cadAnalysisView.service';
import type { CadAnalysisMap } from '../../engine/cad/cadAnalysisTypes';
import type { CadProject } from '../../engine/cad/cadTypes';

export type FallbackAnalysisOutcome =
  | { ok: true; result: CachedAnalysisResult }
  | { ok: false; reason: 'SOURCE_NOT_CURRENT' | 'SOURCE_MISSING' | 'INVALID_BANDS' };

const toElevationMesh = (mesh: CachedSurfaceMesh): ElevationMesh => {
  const xs = new Float64Array(mesh.points.length);
  const ys = new Float64Array(mesh.points.length);
  const zs = new Float64Array(mesh.points.length);
  mesh.points.forEach((point, index) => {
    xs[index] = point.x;
    ys[index] = point.y;
    zs[index] = point.z;
  });
  const tris: number[] = [];
  for (const triangle of mesh.triangles) tris.push(triangle[0], triangle[1], triangle[2]);
  return { xs, ys, zs, tris };
};

const toVolumeMesh = (mesh: CachedSurfaceMesh): { points: number[]; triangles: number[] } => {
  const points: number[] = [];
  for (const point of mesh.points) points.push(point.x, point.y, point.z);
  const triangles: number[] = [];
  for (const triangle of mesh.triangles) triangles.push(triangle[0], triangle[1], triangle[2]);
  return { points, triangles };
};

const meshOf = (
  project: CadProject,
  tinCache: CadSurfaceCache,
  surfaceId: string,
): CachedSurfaceMesh | null => {
  const surface = (project.surfaces ?? []).find((entry) => entry.id === surfaceId);
  if (!surface) return null;
  return tinCache.get(surfaceId, computeCadSurfaceSourceRevision(project, surface)) ?? null;
};

const wrap = (
  map: CadAnalysisMap,
  revision: string,
  result: CachedAnalysisEngineResult,
): CachedAnalysisResult => ({
  analysisId: map.id,
  revision,
  metric: map.source.metric,
  empty: isAnalysisEngineResultEmpty(result),
  result,
});

/** Band definitions in ascending order (the shared validator's canonical order). */
const orderedBands = (map: CadAnalysisMap): Array<{ id: string; lower: number; upper: number }> | null => {
  const validation = validateAnalysisBands(map.bands);
  return validation.ok ? validation.bands : null;
};

export const computeAnalysisFallback = (
  project: CadProject,
  tinCache: CadSurfaceCache,
  map: CadAnalysisMap,
): FallbackAnalysisOutcome => {
  const bands = orderedBands(map);
  if (!bands) return { ok: false, reason: 'INVALID_BANDS' };
  const revision = resolveCurrentAnalysisRevision(project, map);
  const source = map.source;
  if (source.kind === 'surface') {
    const mesh = meshOf(project, tinCache, source.surfaceId);
    if (!mesh) {
      const exists = (project.surfaces ?? []).some((entry) => entry.id === source.surfaceId);
      return { ok: false, reason: exists ? 'SOURCE_NOT_CURRENT' : 'SOURCE_MISSING' };
    }
    if (source.metric === 'elevation') {
      const analysis = analyzeElevationBands(toElevationMesh(mesh), bands, { includeDisplay: true });
      return { ok: true, result: wrap(map, revision, { kind: 'elevation', result: analysis }) };
    }
    const analysis = analyzeSlopeBands(toElevationMesh(mesh), bands, source.metric);
    return { ok: true, result: wrap(map, revision, { kind: 'slope', result: analysis }) };
  }
  const volume = (project.volumeSurfaces ?? []).find(
    (entry) => entry.id === source.volumeSurfaceId,
  );
  if (!volume || volume.baseSurfaceId === volume.comparisonSurfaceId) {
    return { ok: false, reason: 'SOURCE_MISSING' };
  }
  const base = meshOf(project, tinCache, volume.baseSurfaceId);
  const comparison = meshOf(project, tinCache, volume.comparisonSurfaceId);
  if (!base || !comparison) return { ok: false, reason: 'SOURCE_NOT_CURRENT' };
  const depth = computeDepthBands(toVolumeMesh(base), toVolumeMesh(comparison), bands, {
    includeDisplay: true,
  });
  return { ok: true, result: wrap(map, revision, { kind: 'depth', result: depth }) };
};
