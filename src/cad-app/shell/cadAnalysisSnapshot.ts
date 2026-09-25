import type { CadSurfaceCache } from '../../engine/cad/cadSurfaceCache';
import type { CadSurfaceVolumeCache } from '../../engine/cad/surfaceVolumeCache';
import type { CadProject } from '../../engine/cad/cadTypes';
import type {
  CadAnalysisBand,
  CadAnalysisLegend,
  CadAnalysisMap,
  CadAnalysisSource,
  CadAnalysisStatus,
} from '../../engine/cad/cadAnalysisTypes';
import { DEFAULT_ANALYSIS_BAND_COUNT } from '../../engine/cad/cadAnalysisTypes';
import { generateAnalysisBands } from '../../engine/cad/cadAnalysisMaps';
import { deriveAnalysisStatus } from '../../engine/cad/cadAnalysisStatus';
import { computeDepthBands } from '../../engine/cad/surfaceAnalysis/depthBands';
import { surfaceContentRevision } from '../../engine/cad/cadSurfaceView';
import {
  resolveAnalysisSourceStatus,
  resolveCurrentAnalysisRevision,
  type CachedAnalysisResult,
  type SurfaceAnalysisCache,
} from './cadAnalysisAdapters';

/**
 * Phase 18U UI — analysis snapshot for Toolspace/manager/Properties/report.
 *
 * Dumb-renderer support: rows are derived once per publish (source names,
 * derived status, cached band quantities). Mutations travel as real
 * ANALYSIS_* CadCommands through the existing `runSurveyCommand` undo path.
 * Quantities are shown stale ONLY with an explicit STALE label, and the
 * geometry revision excludes colors/labels/opacity, so appearance edits never
 * invalidate a cached result.
 */

export type CadAnalysisStatusText =
  | 'Current'
  | 'Needs Recalc'
  | 'Building'
  | 'Failed'
  | 'Broken Reference'
  | 'Source Not Current'
  | 'Unbuilt'
  | 'No Data';

export const analysisStatusText = (status: CadAnalysisStatus): CadAnalysisStatusText => {
  switch (status) {
    case 'CURRENT': return 'Current';
    case 'NEEDS_RECALC': return 'Needs Recalc';
    case 'BUILDING': return 'Building';
    case 'FAILED': return 'Failed';
    case 'BROKEN_REFERENCE': return 'Broken Reference';
    case 'SOURCE_NOT_CURRENT': return 'Source Not Current';
    case 'UNBUILT': return 'Unbuilt';
    case 'NO_DATA': return 'No Data';
  }
};

/** Short type label (Surface Analysis section + Volume Depth section). */
export const analysisTypeLabel = (metric: CadAnalysisMap['source']['metric']): string => {
  switch (metric) {
    case 'elevation': return 'Elevation';
    case 'slope-percent': return 'Slope %';
    case 'slope-angle': return 'Slope °';
    case 'signed-depth': return 'Depth';
  }
};

/** Metric unit: elevation/depth in drawing length, slope in % or degrees. */
export const analysisMetricUnit = (
  units: string,
  metric: CadAnalysisMap['source']['metric'],
): string => {
  switch (metric) {
    case 'elevation':
    case 'signed-depth':
      return units === 'ft' ? 'ft' : 'm';
    case 'slope-percent': return '%';
    case 'slope-angle': return '°';
  }
};

export const analysisAreaUnit = (units: string): string => (units === 'ft' ? 'ft²' : 'm²');
export const analysisVolumeUnit = (units: string): string => (units === 'ft' ? 'ft³' : 'm³');

/** Near-zero depth band prefix — classification only, never "zero earthwork". */
export const DEPTH_ZERO_BAND_PREFIX = 'Near Balance';

export const formatAnalysisNumber = (value: number | null): string => {
  if (value == null || !Number.isFinite(value)) return '—';
  const magnitude = Math.abs(value);
  const digits = magnitude >= 1000 ? 1 : magnitude >= 100 ? 2 : 3;
  return value.toFixed(digits);
};

/**
 * Display label for one band: explicit override wins; otherwise `lower – upper`
 * with a "Near Balance" prefix for any signed-depth band straddling zero
 * (classification only — it never implies zero volumes).
 */
export const analysisBandLabel = (
  band: { label?: string; lower: number; upper: number },
  metric: CadAnalysisMap['source']['metric'],
): string => {
  if (band.label != null && band.label.trim() !== '') return band.label;
  const range = `${formatAnalysisNumber(band.lower)} – ${formatAnalysisNumber(band.upper)}`;
  if (metric === 'signed-depth' && band.lower <= 0 && band.upper >= 0) {
    return `${DEPTH_ZERO_BAND_PREFIX} (${range})`;
  }
  return range;
};

/** Display view of one cached band (session-only; never persisted). */
export interface CadAnalysisBandRow {
  bandId: string;
  lower: number;
  upper: number;
  planArea: number;
  /** Surface 3D area (elevation/slope); 0 for depth maps. */
  area3D: number;
  cutVolume: number;
  fillVolume: number;
  netVolume: number;
  /** Share of the classified area (0..100). */
  percent: number;
  regionCount: number;
}

/**
 * Display view of a cached engine result. Numeric truth stays in the engine
 * result (`CachedAnalysisResult`); this only reshapes it for the manager,
 * range editor, Properties and the CSV report (one place, no duplication).
 */
export interface CadAnalysisResult {
  analysisId: string;
  revision: string;
  metric: CadAnalysisMap['source']['metric'];
  /** Measured metric extremes; null when the metric does not report them. */
  min: number | null;
  max: number | null;
  totalArea: number;
  total3DArea: number;
  classifiedArea: number;
  unclassifiedArea: number;
  bands: CadAnalysisBandRow[];
  noData: boolean;
}

const percentOf = (area: number, classified: number): number =>
  classified > 0 ? (100 * area) / classified : 0;

const analysisResultView = (
  cached: CachedAnalysisResult,
  map: CadAnalysisMap,
): CadAnalysisResult => {
  const ordered = [...map.bands].sort((a, b) => a.lower - b.lower);
  const base = {
    analysisId: cached.analysisId,
    revision: cached.revision,
    metric: cached.metric,
    noData: cached.empty,
  };
  const engine = cached.result;
  if (engine.kind === 'elevation') {
    const totals = engine.result.totals;
    return {
      ...base,
      min: totals.minZ,
      max: totals.maxZ,
      totalArea: totals.surfacePlanArea,
      total3DArea: totals.surface3DArea,
      classifiedArea: totals.classifiedPlanArea,
      unclassifiedArea: totals.unclassifiedPlanArea,
      bands: engine.result.bands.map((band, index) => ({
        bandId: band.bandId,
        lower: ordered[index]?.lower ?? 0,
        upper: ordered[index]?.upper ?? 0,
        planArea: band.planArea,
        area3D: band.surface3DArea,
        cutVolume: 0,
        fillVolume: 0,
        netVolume: 0,
        percent: percentOf(band.planArea, totals.classifiedPlanArea),
        regionCount: band.regionCount,
      })),
    };
  }
  if (engine.kind === 'slope') {
    const totals = engine.result.totals;
    return {
      ...base,
      min: null,
      max: null,
      totalArea: totals.surfacePlanArea,
      total3DArea: totals.surface3DArea,
      classifiedArea: totals.classifiedPlanArea,
      unclassifiedArea: totals.unclassifiedPlanArea,
      bands: engine.result.bands.map((band, index) => ({
        bandId: band.bandId,
        lower: ordered[index]?.lower ?? 0,
        upper: ordered[index]?.upper ?? 0,
        planArea: band.planArea,
        area3D: band.surface3DArea,
        cutVolume: 0,
        fillVolume: 0,
        netVolume: 0,
        percent: band.percentOfPlan,
        regionCount: band.triangleCount,
      })),
    };
  }
  const totals = engine.result.totals;
  return {
    ...base,
    min: totals.minDelta,
    max: totals.maxDelta,
    totalArea: totals.overlapArea,
    total3DArea: 0,
    classifiedArea: totals.classifiedArea,
    unclassifiedArea: totals.unclassifiedArea,
    bands: engine.result.bands.map((band) => ({
      bandId: band.bandId,
      lower: band.lower,
      upper: band.upper,
      planArea: band.planArea,
      area3D: 0,
      cutVolume: band.cutVolume,
      fillVolume: band.fillVolume,
      netVolume: band.netVolume,
      percent: percentOf(band.planArea, totals.classifiedArea),
      regionCount: band.regionCount,
    })),
  };
};

export interface CadAnalysisBandRowView {
  bandId: string;
  label: string;
  color: string;
  lower: number;
  upper: number;
  planArea: number | null;
  area3D: number | null;
  cutVolume: number | null;
  fillVolume: number | null;
  netVolume: number | null;
  percent: number | null;
  /** Measured result for the current revision, when available. */
  measured: boolean;
}

export interface CadAnalysisLegendRow {
  legendId: string;
  analysisId: string;
  analysisName: string;
  status: CadAnalysisStatus;
  statusText: CadAnalysisStatusText;
  /** True when the referenced map holds a result that is not current. */
  stale: boolean;
  title: string;
  insertionX: number;
  insertionY: number;
  textStyleId: string | null;
  textStyleName: string;
  swatchWidth: number;
  rowHeight: number;
  /** Presentation flags (absent in the definition = shown). */
  showRange: boolean;
  showArea: boolean;
  showPercent: boolean;
  showVolume: boolean;
  rows: CadAnalysisBandRowView[];
}

export interface CadAnalysisRow {
  id: string;
  name: string;
  sourceKind: 'surface' | 'volume';
  sourceId: string;
  sourceName: string;
  metric: CadAnalysisMap['source']['metric'];
  typeLabel: string;
  metricUnit: string;
  layerId: string;
  layerName: string;
  layerLocked: boolean;
  status: CadAnalysisStatus;
  statusText: CadAnalysisStatusText;
  stale: boolean;
  revision: string;
  bandCount: number;
  /** Declared range from the band table (always available). */
  rangeMin: number;
  rangeMax: number;
  /** Measured extremes from the current result; null until CURRENT. */
  measuredMin: number | null;
  measuredMax: number | null;
  classifiedArea: number | null;
  totalArea: number | null;
  /** Current-revision result; null unless CURRENT/NO_DATA. */
  result: CadAnalysisResult | null;
  /** Newest retained stale result (shown ONLY with an explicit STALE label). */
  staleResult: CadAnalysisResult | null;
  bands: CadAnalysisBandRowView[];
  legendIds: string[];
  /** True when the source resolves and is CURRENT (Calculate enabled). */
  calculable: boolean;
  /** True when the Analysis Summary report may be exported (CURRENT only). */
  exportable: boolean;
}

export interface CadAnalysisSnapshot {
  /** Raw definitions (band tables, opacity, boundaries) for editors. */
  maps: CadAnalysisMap[];
  analyses: CadAnalysisRow[];
  legends: CadAnalysisLegendRow[];
  selectedAnalysisId: string | null;
  selectedLegendId: string | null;
  textStyles: Array<{ id: string; name: string }>;
}

const bandViews = (
  map: CadAnalysisMap,
  result: CadAnalysisResult | null,
): CadAnalysisBandRowView[] => {
  const measuredById = new Map((result?.bands ?? []).map((band) => [band.bandId, band]));
  return [...map.bands]
    .sort((a, b) => a.lower - b.lower)
    .map((band) => {
      const measured = measuredById.get(band.id) ?? null;
      return {
        bandId: band.id,
        label: analysisBandLabel(
          { ...(band.label != null ? { label: band.label } : {}), lower: band.lower, upper: band.upper },
          map.source.metric,
        ),
        color: band.color,
        lower: band.lower,
        upper: band.upper,
        planArea: measured?.planArea ?? null,
        area3D: measured?.area3D ?? null,
        cutVolume: measured?.cutVolume ?? null,
        fillVolume: measured?.fillVolume ?? null,
        netVolume: measured?.netVolume ?? null,
        percent: measured?.percent ?? null,
        measured: measured != null,
      };
    });
};

/**
 * Rows + legend rows derived once per publish. Cache misses are legal: an
 * UNBUILT/NEEDS_RECALC map keeps its definition bands with no measured
 * values, and a retained stale result is displayed ONLY with the STALE flag.
 */
export const buildCadAnalysisSnapshot = (
  project: CadProject,
  tinCache: CadSurfaceCache,
  volumeCache: CadSurfaceVolumeCache,
  cache: SurfaceAnalysisCache,
  selectedAnalysisId: string | null,
  selectedLegendId: string | null,
): CadAnalysisSnapshot => {
  void volumeCache;
  const units = project.metadata.units;
  const layers = new Map(project.layers.map((layer) => [layer.id, layer]));
  const textStyles = (project.styleLibrary.textStyles ?? []).map((style) => ({
    id: style.id,
    name: style.name,
  }));
  const legends = project.analysisLegends ?? [];
  const analyses: CadAnalysisRow[] = (project.analysisMaps ?? []).map((map) => {
    const sourceStatus = resolveAnalysisSourceStatus(project, tinCache, map.source);
    const revision = resolveCurrentAnalysisRevision(project, map);
    const fresh = cache.get(map.id, revision) ?? null;
    const retained = cache.retained(map.id);
    const latest = retained.length > 0 ? retained[retained.length - 1]! : null;
    const status = deriveAnalysisStatus(
      map,
      { found: sourceStatus.found, status: sourceStatus.status },
      fresh != null || latest != null,
      fresh?.revision ?? latest?.revision ?? null,
      revision,
      { noData: fresh?.empty === true },
    );
    const layerId = map.layerId ?? 'general';
    const layer = layers.get(layerId);
    const ordered = [...map.bands].sort((a, b) => a.lower - b.lower);
    const result = fresh ? analysisResultView(fresh, map) : null;
    const staleResult = fresh == null && latest ? analysisResultView(latest, map) : null;
    return {
      id: map.id,
      name: map.name,
      sourceKind: map.source.kind,
      sourceId: map.source.kind === 'surface' ? map.source.surfaceId : map.source.volumeSurfaceId,
      sourceName: sourceStatus.name,
      metric: map.source.metric,
      typeLabel: analysisTypeLabel(map.source.metric),
      metricUnit: analysisMetricUnit(units, map.source.metric),
      layerId,
      layerName: layer?.name ?? layerId,
      layerLocked: layer?.locked === true,
      status,
      statusText: analysisStatusText(status),
      stale: fresh == null && latest != null,
      revision,
      bandCount: map.bands.length,
      rangeMin: ordered[0]?.lower ?? 0,
      rangeMax: ordered[ordered.length - 1]?.upper ?? 0,
      measuredMin: result?.min ?? null,
      measuredMax: result?.max ?? null,
      classifiedArea: result?.classifiedArea ?? null,
      totalArea: result?.totalArea ?? null,
      result,
      staleResult,
      bands: bandViews(map, result ?? staleResult),
      legendIds: legends.filter((legend) => legend.analysisId === map.id).map((legend) => legend.id),
      calculable: sourceStatus.found && sourceStatus.status === 'CURRENT' && layer?.locked !== true,
      exportable: status === 'CURRENT' && result != null,
    };
  });
  const analysisById = new Map(analyses.map((row) => [row.id, row]));
  const legendRows: CadAnalysisLegendRow[] = legends.map((legend: CadAnalysisLegend) => {
    const analysis = analysisById.get(legend.analysisId) ?? null;
    const shown = analysis?.result ?? analysis?.staleResult ?? null;
    const status = analysis?.status ?? 'BROKEN_REFERENCE';
    return {
      legendId: legend.id,
      analysisId: legend.analysisId,
      analysisName: analysis?.name ?? legend.analysisId,
      status,
      statusText: analysisStatusText(status),
      stale: analysis?.stale === true,
      title: legend.title ?? analysis?.name ?? 'Analysis',
      insertionX: legend.insertionX,
      insertionY: legend.insertionY,
      textStyleId: legend.textStyleId ?? null,
      textStyleName:
        textStyles.find((style) => style.id === legend.textStyleId)?.name ?? 'Current text style',
      swatchWidth: legend.swatchWidth ?? 8,
      rowHeight: legend.rowHeight ?? 5,
      showRange: legend.showRange !== false,
      showArea: legend.showArea !== false,
      showPercent: legend.showPercent !== false,
      showVolume: legend.showVolume !== false,
      rows: (analysis?.bands ?? []).map((band) => {
        const measured = shown?.bands.find((entry) => entry.bandId === band.bandId) ?? null;
        return { ...band, percent: measured?.percent ?? band.percent };
      }),
    };
  });
  return {
    maps: [...(project.analysisMaps ?? [])],
    analyses,
    legends: legendRows,
    selectedAnalysisId:
      selectedAnalysisId != null && analysisById.has(selectedAnalysisId) ? selectedAnalysisId : null,
    selectedLegendId:
      selectedLegendId != null && legendRows.some((row) => row.legendId === selectedLegendId)
        ? selectedLegendId
        : null,
    textStyles,
  };
};

/** Suggested band range for a NEW map on one source (default 5 equal bands). */
export const analysisSourceRange = (
  project: CadProject,
  tinCache: CadSurfaceCache,
  source: CadAnalysisMap['source'],
): { min: number; max: number } | null => {
  if (source.kind === 'surface') {
    const surface = (project.surfaces ?? []).find((entry) => entry.id === source.surfaceId);
    if (!surface) return null;
    const mesh = tinCache.get(surface.id, surfaceContentRevision(project, surface));
    if (!mesh) return null;
    if (source.metric === 'elevation') {
      const { minZ, maxZ } = mesh.stats;
      return minZ == null || maxZ == null ? null : { min: minZ, max: maxZ };
    }
    const ratioToMetric = (ratio: number | null): number | null =>
      ratio == null
        ? null
        : source.metric === 'slope-percent'
          ? 100 * ratio
          : (Math.atan(ratio) * 180) / Math.PI;
    const min = ratioToMetric(mesh.stats.minFaceSlopeRatio);
    const max = ratioToMetric(mesh.stats.maxFaceSlopeRatio);
    return min == null || max == null ? null : { min, max };
  }
  const volume = (project.volumeSurfaces ?? []).find(
    (entry) => entry.id === source.volumeSurfaceId,
  );
  if (!volume || volume.baseSurfaceId === volume.comparisonSurfaceId) return null;
  const baseSurface = (project.surfaces ?? []).find((entry) => entry.id === volume.baseSurfaceId);
  const cmpSurface = (project.surfaces ?? []).find((entry) => entry.id === volume.comparisonSurfaceId);
  if (!baseSurface || !cmpSurface) return null;
  const base = tinCache.get(baseSurface.id, surfaceContentRevision(project, baseSurface));
  const comparison = tinCache.get(cmpSurface.id, surfaceContentRevision(project, cmpSurface));
  if (!base || !comparison) return null;
  const toVolumeMesh = (mesh: typeof base): { points: number[]; triangles: number[] } => ({
    points: mesh.points.flatMap((point) => [point.x, point.y, point.z]),
    triangles: mesh.triangles.flat(),
  });
  const depth = computeDepthBands(toVolumeMesh(base), toVolumeMesh(comparison), [
    { id: 'range-probe', lower: -1e12, upper: 1e12 },
  ]);
  return { min: depth.totals.minDelta, max: depth.totals.maxDelta };
};

/**
 * Expand a degenerate range (flat surface / zero height spread) so equal
 * banding is possible. Never fabricates measured data: it only widens the
 * DISPLAY range around the measured value.
 */
export const ensureAnalysisBandRange = (range: {
  min: number;
  max: number;
}): { min: number; max: number } => {
  if (Number.isFinite(range.min) && Number.isFinite(range.max) && range.min < range.max) {
    return { min: range.min, max: range.max };
  }
  const anchor = Number.isFinite(range.min) ? range.min : 0;
  const pad = Math.max(0.5, Math.abs(anchor) * 1e-6);
  return { min: anchor - pad, max: anchor + pad };
};

// ---------------------------------------------------------------------------
// New-map preparation (workspace-owned: needs the live project + mesh cache)
// ---------------------------------------------------------------------------

export interface NewAnalysisPlan {
  source: CadAnalysisSource;
  bands: CadAnalysisBand[];
  name: string;
}

const uniqueAnalysisName = (project: CadProject, base: string): string => {
  const taken = new Set((project.analysisMaps ?? []).map((map) => map.name));
  if (!taken.has(base)) return base;
  let index = 2;
  while (taken.has(`${base} (${index})`)) index += 1;
  return `${base} (${index})`;
};

/**
 * Build the definition for a NEW map from the current selection: resolves the
 * source, reads its measured range, and generates `DEFAULT_ANALYSIS_BAND_COUNT`
 * equal bands. Fail-closed when the source is missing/stale (no fake range).
 */
export const prepareNewAnalysis = (
  project: CadProject,
  tinCache: CadSurfaceCache,
  kind: 'elevation' | 'slope-percent' | 'signed-depth',
  surfaceId: string | null,
  volumeId: string | null,
): NewAnalysisPlan | { error: string } => {
  const source: CadAnalysisSource | null =
    kind === 'signed-depth'
      ? volumeId == null
        ? null
        : { kind: 'volume', volumeSurfaceId: volumeId, metric: 'signed-depth' }
      : surfaceId == null
        ? null
        : { kind: 'surface', surfaceId, metric: kind };
  if (!source) {
    return {
      error: kind === 'signed-depth' ? 'select a volume surface first' : 'select a surface first',
    };
  }
  const range = analysisSourceRange(project, tinCache, source);
  if (!range) return { error: 'the selected source is not current — build it first' };
  const banded = ensureAnalysisBandRange(range);
  const generated = generateAnalysisBands(DEFAULT_ANALYSIS_BAND_COUNT, banded.min, banded.max);
  if ('error' in generated) return { error: generated.error };
  return {
    source,
    bands: generated.bands,
    name: uniqueAnalysisName(project, `New ${analysisTypeLabel(source.metric)} Analysis`),
  };
};
