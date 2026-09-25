/**
 * Phase 18U QA — session-cache → export-input adapter (UI-owned, pure).
 *
 * The export scene (`cadAnalysisExportScene.ts`) consumes caller-composed
 * `CadAnalysisExportInput`, but the Export Center panel never composed it —
 * production SVG/PDF/DXF exports silently dropped every analysis fill and
 * legend. This adapter closes that seam: CURRENT maps contribute their
 * cached engine regions (elevation/depth reuse display regions, slope
 * reclassifies whole faces through the shared export-region helpers);
 * anything not CURRENT rides along with its real status so the export
 * emits the standard CURRENT-only withheld warning instead of a silent drop.
 * Legends contribute definition rows + CURRENT measured quantities.
 */

import { computeCadSurfaceSourceRevision } from '../../engine/cad/cadSurfaces';
import type { CadProject } from '../../engine/cad/cadTypes';
import type { CadSurfaceCache } from '../../engine/cad/cadSurfaceCache';
import type {
  AnalysisExportBandRegions,
  CadAnalysisExportInput,
  CadAnalysisExportLayer,
  CadAnalysisExportLegend,
  CadAnalysisLegendRowValues,
} from '../../engine/cad/cadAnalysisExportScene';
import {
  analysisRegionsFromDepth,
  analysisRegionsFromElevation,
  analysisRegionsFromSlope,
} from '../../engine/cad/cadAnalysisExportRegions';
import type {
  CachedAnalysisResult,
  SurfaceAnalysisCache,
} from '../../engine/cad/surfaceAnalysisCache';
import type { SlopeMesh } from '../../engine/cad/surfaceAnalysis/slopeBands';
import {
  analysisAreaUnit,
  analysisVolumeUnit,
  formatAnalysisNumber,
  type CadAnalysisSnapshot,
} from './cadAnalysisSnapshot';

const slopeMeshOf = (
  project: CadProject,
  tinCache: CadSurfaceCache,
  surfaceId: string,
): SlopeMesh | null => {
  const surface = (project.surfaces ?? []).find((entry) => entry.id === surfaceId);
  if (!surface) return null;
  const mesh = tinCache.get(surface.id, computeCadSurfaceSourceRevision(project, surface));
  if (!mesh) return null;
  const xs = mesh.points.map((point) => point.x);
  const ys = mesh.points.map((point) => point.y);
  const zs = mesh.points.map((point) => point.z);
  const tris = mesh.triangles.flat();
  return { xs, ys, zs, tris };
};

const regionsOf = (
  project: CadProject,
  tinCache: CadSurfaceCache,
  mapId: string,
  cached: CachedAnalysisResult,
): AnalysisExportBandRegions[] => {
  const engine = cached.result;
  if (engine.kind === 'elevation') return analysisRegionsFromElevation(engine.result);
  if (engine.kind === 'depth') return analysisRegionsFromDepth(engine.result);
  const map = (project.analysisMaps ?? []).find((entry) => entry.id === mapId);
  if (!map || map.source.kind !== 'surface') return [];
  const mesh = slopeMeshOf(project, tinCache, map.source.surfaceId);
  if (!mesh) return [];
  const metric = map.source.metric === 'slope-angle' ? 'slope-angle' : 'slope-percent';
  return analysisRegionsFromSlope(
    mesh,
    map.bands.map((band) => ({ id: band.id, lower: band.lower, upper: band.upper })),
    metric,
  );
};

const layerOf = (
  project: CadProject,
  tinCache: CadSurfaceCache,
  cache: SurfaceAnalysisCache,
  row: CadAnalysisSnapshot['analyses'][number],
): CadAnalysisExportLayer | null => {
  const map = (project.analysisMaps ?? []).find((entry) => entry.id === row.id);
  if (!map) return null;
  if (row.status !== 'CURRENT') return { map, status: row.status, regions: [] };
  const cached = cache.get(row.id, row.revision);
  if (!cached || cached.revision !== row.revision) {
    return { map, status: 'NEEDS_RECALC', regions: [] };
  }
  return { map, status: 'CURRENT', regions: regionsOf(project, tinCache, row.id, cached) };
};

const rowValuesOf = (
  band: { bandId: string; label: string; planArea: number | null; percent: number | null; netVolume: number | null },
  depth: boolean,
  areaUnit: string,
  volumeUnit: string,
): CadAnalysisLegendRowValues => ({
  bandId: band.bandId,
  rangeText: band.label,
  ...(band.planArea != null ? { areaText: `${formatAnalysisNumber(band.planArea)} ${areaUnit}` } : {}),
  ...(band.percent != null ? { percentText: `${formatAnalysisNumber(band.percent)}%` } : {}),
  ...(depth && band.netVolume != null
    ? { volumeText: `${formatAnalysisNumber(band.netVolume)} ${volumeUnit}` }
    : {}),
});

const legendOf = (
  project: CadProject,
  snapshot: CadAnalysisSnapshot,
  row: CadAnalysisSnapshot['legends'][number],
  areaUnit: string,
  volumeUnit: string,
): CadAnalysisExportLegend | null => {
  const legend = (project.analysisLegends ?? []).find((entry) => entry.id === row.legendId);
  if (!legend) return null;
  const map = (project.analysisMaps ?? []).find((entry) => entry.id === row.analysisId) ?? null;
  const analysis = snapshot.analyses.find((entry) => entry.id === row.analysisId) ?? null;
  const depth = analysis?.metric === 'signed-depth';
  return {
    legend,
    map,
    status: analysis?.status ?? 'BROKEN_REFERENCE',
    rows: row.rows.map((band) => rowValuesOf(band, depth, areaUnit, volumeUnit)),
  };
};

/**
 * Session-cache export input for the Export Center. Undefined when the
 * project defines no maps and no legends (legacy scene unchanged).
 * CURRENT-only geometry: non-current layers carry empty regions and keep
 * their real status so every format warns instead of dropping silently.
 */
export const buildAnalysisExportInput = (
  project: CadProject,
  snapshot: CadAnalysisSnapshot,
  tinCache: CadSurfaceCache,
  cache: SurfaceAnalysisCache,
  units: string,
): CadAnalysisExportInput | undefined => {
  if ((project.analysisMaps ?? []).length === 0 && (project.analysisLegends ?? []).length === 0) {
    return undefined;
  }
  const areaUnit = analysisAreaUnit(units);
  const volumeUnit = analysisVolumeUnit(units);
  const layers = snapshot.analyses
    .map((row) => layerOf(project, tinCache, cache, row))
    .filter((layer): layer is CadAnalysisExportLayer => layer != null);
  const legends = snapshot.legends
    .map((row) => legendOf(project, snapshot, row, areaUnit, volumeUnit))
    .filter((legend): legend is CadAnalysisExportLegend => legend != null);
  return { layers, legends };
};
