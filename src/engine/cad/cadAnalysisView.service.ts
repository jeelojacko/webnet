import { computeCadSurfaceSourceRevision } from './cadSurfaces';
import type { CadSurfaceCache as CadTinCache } from './cadSurfaceCache';
import { computeAnalysisGeometryRevision } from './cadAnalysisRevision';
import type { CadAnalysisMap } from './cadAnalysisTypes';
import type { SurfaceAnalysisCache } from './surfaceAnalysisCache';
import { computeVolumeSurfaceRevision } from './cadVolumeSurfaces';
import { metricValueOfRatio } from './surfaceAnalysis/slopeBands';
import { classifyAnalysisValue } from './surfaceAnalysis/scalarClip';
import { planeGradient, slopeRatioOf } from './surfaceAnalysis';
import type { CadProject } from './cadTypes';

/**
 * Phase 18U UI — analysis display adapter (UI-owned, pure). REFERENCE-ONLY
 * (`.service` suffix): the sibling display slice owns the wired scene module
 * (`cadAnalysisDisplayView`); QA unifies this builder with that module.
 *
 * One aggregated SVG path per band (never per-triangle nodes), built from
 * cached DERIVED regions (never CAD entities, never re-triangulation).
 * CURRENT revisions only: a stale/superseded result never renders — the
 * manager shows retained quantities with a STALE label instead
 * (retained-stale policy). Opacity is map-owned (fill-only);
 * `showBoundaries` adds region-outline paths (band boundaries + outer
 * extent), never triangle edges. Layer OFF/FROZEN hides the whole layer
 * downstream via the existing viewport filter, without recompute.
 *
 * Z-ORDER CONTRACT: analysis fills render UNDER TIN edges, contours,
 * points and labels. The preview canvas renders `analysisLayers` before
 * `surfaceLayers`; fills carry `pointerEvents="none"` so they never
 * intercept surface picking.
 */

/** One band's aggregated fill path (drawing units). */
export interface CadAnalysisBandDisplayPath {
  bandId: string;
  color: string;
  /** Multi-ring path data (`M…L…Z` per region; empty when no regions). */
  d: string;
  planArea: number;
  regionCount: number;
}

export interface CadAnalysisDisplayLayer {
  analysisId: string;
  analysisName: string;
  layerId: string;
  /** Always false: only CURRENT results produce layers. */
  stale: false;
  /** Fill opacity 0..1 (map-owned; default 0.45). */
  opacity: number;
  bands: CadAnalysisBandDisplayPath[];
  /** Region outlines when `showBoundaries` (else empty). */
  boundariesD: string;
  bounds: { minX: number; minY: number; maxX: number; maxY: number } | null;
}

export const DEFAULT_ANALYSIS_FILL_OPACITY = 0.45;

/**
 * Current `arev1:` geometry revision for a map from live project state.
 * Shared by the service (request identity) and the view (CURRENT gating)
 * so the two can never disagree on what "current" means.
 */
export const resolveCurrentAnalysisRevision = (
  project: CadProject,
  def: CadAnalysisMap,
): string => {
  const source = def.source;
  if (source.kind === 'surface') {
    const surface = (project.surfaces ?? []).find((entry) => entry.id === source.surfaceId);
    return computeAnalysisGeometryRevision(def, {
      surfaceRevision: surface ? computeCadSurfaceSourceRevision(project, surface) : null,
    });
  }
  const volume = (project.volumeSurfaces ?? []).find(
    (entry) => entry.id === source.volumeSurfaceId,
  );
  if (!volume) return computeAnalysisGeometryRevision(def, { volumeRevision: null });
  const base = (project.surfaces ?? []).find((entry) => entry.id === volume.baseSurfaceId);
  const comparison = (project.surfaces ?? []).find(
    (entry) => entry.id === volume.comparisonSurfaceId,
  );
  return computeAnalysisGeometryRevision(def, {
    volumeRevision:
      base && comparison
        ? computeVolumeSurfaceRevision({
            baseId: base.id,
            baseRev: computeCadSurfaceSourceRevision(project, base),
            cmpId: comparison.id,
            cmpRev: computeCadSurfaceSourceRevision(project, comparison),
          })
        : null,
  });
};

const ringPathXY = (ring: ReadonlyArray<{ x: number; y: number }>): string => {
  if (ring.length < 3) return '';
  let d = `M${ring[0]!.x} ${ring[0]!.y}`;
  for (let index = 1; index < ring.length; index += 1) d += `L${ring[index]!.x} ${ring[index]!.y}`;
  return `${d}Z`;
};

const ringPathFlat = (ring: ReadonlyArray<number>): string => {
  if (ring.length < 6) return '';
  let d = `M${ring[0]} ${ring[1]}`;
  for (let index = 2; index + 1 < ring.length; index += 2) d += `L${ring[index]} ${ring[index + 1]}`;
  return `${d}Z`;
};

interface RingBag {
  rings: string[];
  planArea: number;
  regionCount: number;
}

const trackBounds = (
  bounds: { minX: number; minY: number; maxX: number; maxY: number } | null,
  x: number,
  y: number,
): { minX: number; minY: number; maxX: number; maxY: number } => ({
  minX: bounds == null ? x : Math.min(bounds.minX, x),
  minY: bounds == null ? y : Math.min(bounds.minY, y),
  maxX: bounds == null ? x : Math.max(bounds.maxX, x),
  maxY: bounds == null ? y : Math.max(bounds.maxY, y),
});

/**
 * Every CURRENT analysis with a cached result, in deterministic (drawing)
 * order. Slope metrics have no clipped regions (whole-face
 * classification), so their band paths aggregate source triangles
 * directly; elevation/depth paths aggregate cached display regions.
 */
export const buildAnalysisDisplayLayers = (
  project: CadProject,
  tinCache: CadTinCache | null,
  analysisCache: SurfaceAnalysisCache | null,
): CadAnalysisDisplayLayer[] => {
  if (!tinCache || !analysisCache) return [];
  const layers: CadAnalysisDisplayLayer[] = [];
  for (const def of project.analysisMaps ?? []) {
    const layer = buildAnalysisDisplayLayer(project, def, tinCache, analysisCache);
    if (layer) layers.push(layer);
  }
  return layers;
};

const buildAnalysisDisplayLayer = (
  project: CadProject,
  def: CadAnalysisMap,
  tinCache: CadTinCache,
  analysisCache: SurfaceAnalysisCache,
): CadAnalysisDisplayLayer | null => {
  const revision = resolveCurrentAnalysisRevision(project, def);
  const cached = analysisCache.get(def.id, revision);
  // No result, or a result for a superseded revision: never render.
  if (!cached || cached.revision !== revision) return null;
  const bags = new Map<string, RingBag>();
  for (const band of def.bands) bags.set(band.id, { rings: [], planArea: 0, regionCount: 0 });
  let bounds: CadAnalysisDisplayLayer['bounds'] = null;
  if (cached.result.kind === 'elevation') {
    for (const band of cached.result.result.bands) {
      const bag = bags.get(band.bandId);
      if (!bag) continue;
      bag.planArea = band.planArea;
      bag.regionCount = band.regionCount;
      for (const region of band.regions ?? []) {
        const d = ringPathXY(region.ring);
        if (!d) continue;
        bag.rings.push(d);
        for (const point of region.ring) bounds = trackBounds(bounds, point.x, point.y);
      }
    }
  } else if (cached.result.kind === 'depth') {
    for (const band of cached.result.result.bands) {
      const bag = bags.get(band.bandId);
      if (!bag) continue;
      bag.planArea = band.planArea;
      bag.regionCount = band.regionCount;
      for (const region of band.regions ?? []) {
        const d = ringPathFlat(region.ring);
        if (!d) continue;
        bag.rings.push(d);
        for (let index = 0; index + 1 < region.ring.length; index += 2) {
          bounds = trackBounds(bounds, region.ring[index]!, region.ring[index + 1]!);
        }
      }
    }
  } else {
    aggregateSlopeTriangles(project, def, cached.result.result.bands.map((band) => ({
      id: band.bandId,
    })), tinCache, bags, (next) => {
      bounds = next(bounds);
    });
  }
  const bands: CadAnalysisBandDisplayPath[] = def.bands.map((band) => {
    const bag = bags.get(band.id) ?? { rings: [], planArea: 0, regionCount: 0 };
    return {
      bandId: band.id,
      color: band.color,
      d: bag.rings.join(''),
      planArea: bag.planArea,
      regionCount: bag.regionCount,
    };
  });
  return {
    analysisId: def.id,
    analysisName: def.name,
    layerId: def.layerId ?? 'analysis',
    stale: false,
    opacity: def.opacity ?? DEFAULT_ANALYSIS_FILL_OPACITY,
    bands,
    boundariesD: def.showBoundaries === true ? bands.map((band) => band.d).join('') : '',
    bounds,
  };
};

interface SlopeBandStub {
  id: string;
}

/**
 * Slope display: whole faces classify via the shared metric + classifier,
 * so band paths aggregate triangle rings directly (no clipped regions
 * exist for this metric). Counts feed regionCount for parity with the
 * region-based metrics.
 */
const aggregateSlopeTriangles = (
  project: CadProject,
  def: CadAnalysisMap,
  ordered: readonly SlopeBandStub[],
  tinCache: CadTinCache,
  bags: Map<string, RingBag>,
  onBounds: (
    _update: (
      _bounds: CadAnalysisDisplayLayer['bounds'],
    ) => CadAnalysisDisplayLayer['bounds'],
  ) => void,
): void => {
  const source = def.source;
  if (source.kind !== 'surface') return;
  const surface = (project.surfaces ?? []).find((entry) => entry.id === source.surfaceId);
  if (!surface) return;
  const mesh = tinCache.get(surface.id, computeCadSurfaceSourceRevision(project, surface));
  if (!mesh) return;
  const metric = source.metric === 'slope-angle' ? 'slope-angle' : 'slope-percent';
  const bands = ordered.map((entry) => {
    const band = def.bands.find((candidate) => candidate.id === entry.id);
    return { id: entry.id, lower: band?.lower ?? 0, upper: band?.upper ?? 0 };
  });
  for (const tri of mesh.triangles) {
    const a = mesh.points[tri[0]];
    const b = mesh.points[tri[1]];
    const c = mesh.points[tri[2]];
    if (!a || !b || !c) continue;
    const gradient = planeGradient(
      { entityId: '', x: a.x, y: a.y, z: a.z },
      { entityId: '', x: b.x, y: b.y, z: b.z },
      { entityId: '', x: c.x, y: c.y, z: c.z },
    );
    if (!gradient) continue;
    const bandId = classifyAnalysisValue(metricValueOfRatio(slopeRatioOf(gradient), metric), bands);
    if (bandId == null) continue;
    const bag = bags.get(bandId);
    if (!bag) continue;
    const d = ringPathXY([a, b, c]);
    if (!d) continue;
    bag.rings.push(d);
    bag.regionCount += 1;
    onBounds((bounds) => {
      let next = bounds;
      next = trackBounds(next, a.x, a.y);
      next = trackBounds(next, b.x, b.y);
      next = trackBounds(next, c.x, c.y);
      return next;
    });
  }
};
