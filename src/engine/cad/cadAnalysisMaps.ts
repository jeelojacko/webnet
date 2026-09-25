import {
  DEFAULT_ANALYSIS_BAND_COUNT,
  MAX_ANALYSIS_BANDS,
  type CadAnalysisBand,
  type CadAnalysisLegend,
  type CadAnalysisMap,
  type CadAnalysisSource,
} from './cadAnalysisTypes';
import { validateAnalysisBands as validateSharedAnalysisBands } from './surfaceAnalysis/scalarClip';
import { generateEqualRanges } from './surfaceAnalysis/rangeGenerator';

/**
 * Phase 18U analysis-map CRUD + validation (pure, no I/O, no geometry).
 *
 * Validation is shared: the numeric core (array/type/finite/`lower < upper`/
 * overlap) is delegated to the 18U engine validator
 * `surfaceAnalysis/scalarClip.validateAnalysisBands` — one rule, no drift.
 * This module adds the DISPLAY-layer checks the engine does not need (band
 * cap, duplicate ids, color, label) and maps the shared errors onto stable
 * reason codes for UI/persistence callers.
 */

const isFiniteNumber = (value: unknown): value is number =>
  typeof value === 'number' && Number.isFinite(value);

const isNonEmptyString = (value: unknown): value is string =>
  typeof value === 'string' && value.trim() !== '';

/**
 * Returns null when valid, else a stable reason code.
 * Rules: 1..MAX_ANALYSIS_BANDS, unique non-empty ids, finite edges with
 * `lower < upper`, non-empty colors, and NO overlap. Exact touching
 * (`next.lower === prev.upper`) and gaps are allowed by design.
 *
 * Numeric membership/overlap is the shared engine rule (scalarClip); the
 * shared errors are classified here into the stable codes below.
 */
export const validateAnalysisBands = (bands: readonly CadAnalysisBand[]): string | null => {
  if (!Array.isArray(bands) || bands.length === 0) return 'ANALYSIS_BANDS_EMPTY';
  if (bands.length > MAX_ANALYSIS_BANDS) return 'ANALYSIS_BANDS_TOO_MANY';
  const ids = new Set<string>();
  for (const band of bands) {
    if (ids.has(band?.id)) return 'ANALYSIS_BAND_ID_DUPLICATE';
    ids.add(band?.id);
    if (!isNonEmptyString(band.color)) return 'ANALYSIS_BAND_COLOR';
    if (band.label !== undefined && typeof band.label !== 'string') return 'ANALYSIS_BAND_LABEL';
  }
  const shared = validateSharedAnalysisBands(bands);
  return shared.ok ? null : sharedErrorCode(shared.errors);
};

const sharedErrorCode = (errors: readonly string[]): string => {
  const joined = errors.join('\n');
  if (joined.includes('overlap')) return 'ANALYSIS_BAND_OVERLAP';
  if (joined.includes('finite')) return 'ANALYSIS_BAND_NON_FINITE';
  if (joined.includes('lower must be < upper')) return 'ANALYSIS_BAND_RANGE';
  if (joined.includes('id must be a non-empty string')) return 'ANALYSIS_BAND_ID';
  return 'ANALYSIS_BAND_INVALID';
};

export const isAnalysisSourceValid = (source: CadAnalysisSource | undefined): boolean => {
  if (!source) return false;
  if (source.kind === 'surface') {
    return (
      isNonEmptyString(source.surfaceId) &&
      (source.metric === 'elevation' ||
        source.metric === 'slope-percent' ||
        source.metric === 'slope-angle')
    );
  }
  if (source.kind === 'volume') {
    return isNonEmptyString(source.volumeSurfaceId) && source.metric === 'signed-depth';
  }
  return false;
};

export const cloneCadAnalysisBand = (band: CadAnalysisBand): CadAnalysisBand => ({
  ...band,
  ...(band.label != null ? { label: band.label } : {}),
});

export const cloneCadAnalysisSource = (source: CadAnalysisSource): CadAnalysisSource =>
  source.kind === 'surface'
    ? { kind: 'surface', surfaceId: source.surfaceId, metric: source.metric }
    : { kind: 'volume', volumeSurfaceId: source.volumeSurfaceId, metric: source.metric };

export const cloneCadAnalysisMap = (map: CadAnalysisMap): CadAnalysisMap => ({
  id: map.id,
  name: map.name,
  source: cloneCadAnalysisSource(map.source),
  bands: map.bands.map(cloneCadAnalysisBand),
  ...(map.layerId != null ? { layerId: map.layerId } : {}),
  ...(map.opacity != null ? { opacity: map.opacity } : {}),
  ...(map.showBoundaries != null ? { showBoundaries: map.showBoundaries } : {}),
  ...(map.description != null ? { description: map.description } : {}),
});

export const cloneCadAnalysisMaps = (maps: CadAnalysisMap[] | undefined): CadAnalysisMap[] =>
  (maps ?? []).map(cloneCadAnalysisMap);

/** Load-time backfill: legacy drawings (field absent) open with no maps. */
export const backfillAnalysisMaps = (maps: CadAnalysisMap[] | undefined): CadAnalysisMap[] =>
  cloneCadAnalysisMaps(maps);

/**
 * Load-time cache clear. Band results are session-only and never serialized,
 * so nothing derived can survive an open; the helper exists so every load path
 * applies the same explicit rule and future derived fields have one home.
 */
export const clearAnalysisCacheOnLoad = (map: CadAnalysisMap): CadAnalysisMap =>
  cloneCadAnalysisMap(map);

const isMapNameTaken = (maps: CadAnalysisMap[], name: string, exceptId?: string): boolean =>
  maps.some(
    (map) => map.id !== exceptId && map.name.trim().toLowerCase() === name.trim().toLowerCase(),
  );

const validateMapDefinition = (
  maps: CadAnalysisMap[],
  candidate: CadAnalysisMap,
  exceptId?: string,
): string | null => {
  if (!isNonEmptyString(candidate.id)) return 'ANALYSIS_MAP_ID';
  if (!isNonEmptyString(candidate.name)) return 'ANALYSIS_MAP_NAME';
  if (isMapNameTaken(maps, candidate.name, exceptId)) return 'ANALYSIS_MAP_NAME_TAKEN';
  if (!isAnalysisSourceValid(candidate.source)) return 'ANALYSIS_SOURCE_INVALID';
  const bandReason = validateAnalysisBands(candidate.bands);
  if (bandReason) return bandReason;
  if (candidate.opacity !== undefined) {
    if (!isFiniteNumber(candidate.opacity) || candidate.opacity < 0 || candidate.opacity > 1) {
      return 'ANALYSIS_MAP_OPACITY';
    }
  }
  return null;
};

export const createAnalysisMap = (
  maps: CadAnalysisMap[],
  definition: CadAnalysisMap,
): CadAnalysisMap[] | { error: string } => {
  const candidate = cloneCadAnalysisMap({ ...definition, name: definition.name.trim() });
  if (maps.some((map) => map.id === candidate.id)) return { error: 'ANALYSIS_MAP_ID_TAKEN' };
  const reason = validateMapDefinition(maps, candidate);
  if (reason) return { error: reason };
  return [...maps, candidate];
};

/** Geometry-affecting edit: bands and/or source (metric). */
export interface CadAnalysisBandsPatch {
  bands?: CadAnalysisBand[];
  source?: CadAnalysisSource;
}

export const updateAnalysisBands = (
  maps: CadAnalysisMap[],
  mapId: string,
  patch: CadAnalysisBandsPatch,
): CadAnalysisMap[] | { error: string } => {
  const current = maps.find((map) => map.id === mapId);
  if (!current) return { error: 'ANALYSIS_MAP_NOT_FOUND' };
  const next: CadAnalysisMap = {
    ...current,
    ...(patch.source !== undefined ? { source: cloneCadAnalysisSource(patch.source) } : {}),
    ...(patch.bands !== undefined ? { bands: patch.bands.map(cloneCadAnalysisBand) } : {}),
  };
  const reason = validateMapDefinition(maps, next, mapId);
  if (reason) return { error: reason };
  return maps.map((map) => (map.id === mapId ? next : map));
};

/** Appearance-only edit: must never change the geometry revision. */
export interface CadAnalysisAppearancePatch {
  name?: string;
  description?: string;
  layerId?: string | null;
  opacity?: number;
  showBoundaries?: boolean;
  /** bandId -> color (18U band recoloring). */
  bandColors?: Record<string, string>;
  /** bandId -> label; null/'' clears the override. */
  bandLabels?: Record<string, string | null>;
}

export const updateAnalysisAppearance = (
  maps: CadAnalysisMap[],
  mapId: string,
  patch: CadAnalysisAppearancePatch,
): CadAnalysisMap[] | { error: string } => {
  const current = maps.find((map) => map.id === mapId);
  if (!current) return { error: 'ANALYSIS_MAP_NOT_FOUND' };
  if (patch.name !== undefined && !isNonEmptyString(patch.name)) return { error: 'ANALYSIS_MAP_NAME' };
  if (patch.name !== undefined && isMapNameTaken(maps, patch.name, mapId)) {
    return { error: 'ANALYSIS_MAP_NAME_TAKEN' };
  }
  if (
    patch.opacity !== undefined &&
    (!isFiniteNumber(patch.opacity) || patch.opacity < 0 || patch.opacity > 1)
  ) {
    return { error: 'ANALYSIS_MAP_OPACITY' };
  }
  for (const color of Object.values(patch.bandColors ?? {})) {
    if (!isNonEmptyString(color)) return { error: 'ANALYSIS_BAND_COLOR' };
  }
  const next: CadAnalysisMap = { ...current };
  if (patch.name !== undefined) next.name = patch.name.trim();
  if (patch.description !== undefined) next.description = patch.description;
  if (patch.opacity !== undefined) next.opacity = patch.opacity;
  if (patch.showBoundaries !== undefined) next.showBoundaries = patch.showBoundaries;
  if (patch.layerId !== undefined) {
    if (patch.layerId == null) delete next.layerId;
    else next.layerId = patch.layerId;
  }
  if (patch.bandColors || patch.bandLabels) {
    next.bands = current.bands.map((band) => {
      const color = patch.bandColors?.[band.id];
      const label = patch.bandLabels?.[band.id];
      if (color === undefined && label === undefined) return cloneCadAnalysisBand(band);
      const updated: CadAnalysisBand = { ...band };
      if (color !== undefined) updated.color = color;
      if (label !== undefined) {
        if (label == null || label.trim() === '') delete updated.label;
        else updated.label = label;
      }
      return updated;
    });
  }
  return maps.map((map) => (map.id === mapId ? next : map));
};

export type DeleteAnalysisMapResult =
  | { ok: true; analysisMaps: CadAnalysisMap[]; analysisLegends: CadAnalysisLegend[] }
  | { ok: false; reason: 'ANALYSIS_MAP_NOT_FOUND' }
  | { ok: false; reason: 'BLOCKED_BY_LEGEND'; legendIds: string[] };

/**
 * Reference-guarded delete: blocked while a legend references the map unless
 * `deleteLegendsToo` is set (then those legends are removed atomically).
 */
export const deleteAnalysisMap = (
  maps: CadAnalysisMap[],
  mapId: string,
  legends: readonly CadAnalysisLegend[],
  options: { deleteLegendsToo?: boolean } = {},
): DeleteAnalysisMapResult => {
  if (!maps.some((map) => map.id === mapId)) return { ok: false, reason: 'ANALYSIS_MAP_NOT_FOUND' };
  const referencing = legends.filter((legend) => legend.analysisId === mapId);
  if (referencing.length > 0 && options.deleteLegendsToo !== true) {
    return {
      ok: false,
      reason: 'BLOCKED_BY_LEGEND',
      legendIds: referencing.map((legend) => legend.id),
    };
  }
  return {
    ok: true,
    analysisMaps: maps.filter((map) => map.id !== mapId),
    analysisLegends: legends.filter((legend) => legend.analysisId !== mapId),
  };
};

export const duplicateAnalysisMap = (
  maps: CadAnalysisMap[],
  mapId: string,
  newId: string,
  name: string,
): CadAnalysisMap[] | { error: string } => {
  const source = maps.find((map) => map.id === mapId);
  if (!source) return { error: 'ANALYSIS_MAP_NOT_FOUND' };
  return createAnalysisMap(maps, { ...cloneCadAnalysisMap(source), id: newId, name });
};

export const renameAnalysisMap = (
  maps: CadAnalysisMap[],
  mapId: string,
  name: string,
): CadAnalysisMap[] | { error: string } =>
  updateAnalysisAppearance(maps, mapId, { name });

/** Display-only seed palette (NOT an industry standard; distinguishable hues). */
export const ANALYSIS_BAND_PALETTE: readonly string[] = [
  '#2f6fd0',
  '#3fa66a',
  '#d0a22f',
  '#c85a3f',
  '#8a5fd0',
  '#3fb3c8',
  '#7f8c3f',
  '#c83f8a',
  '#5a6b7d',
  '#d07f2f',
];

export interface GeneratedAnalysisBands {
  bands: CadAnalysisBand[];
  /** The shared band edges in ascending order (band i spans edges i..i+1). */
  thresholds: number[];
}

/**
 * Even banding between `min` and `max` with seed palette colors. Range math is
 * delegated to the shared 18U engine generator `generateEqualRanges` (band i
 * upper === band i+1 lower exactly), so the validator's touching-is-legal rule
 * holds without tolerance games. Colors are display-only and cycle when
 * numBands > palette length.
 */
export const generateAnalysisBands = (
  numBands: number,
  min: number,
  max: number,
  paletteSeed = 0,
): GeneratedAnalysisBands | { error: string } => {
  if (!Number.isInteger(numBands) || numBands < 1) return { error: 'ANALYSIS_BAND_COUNT' };
  if (numBands > MAX_ANALYSIS_BANDS) return { error: 'ANALYSIS_BANDS_TOO_MANY' };
  if (!isFiniteNumber(min) || !isFiniteNumber(max) || min >= max) {
    return { error: 'ANALYSIS_BAND_RANGE' };
  }
  const ranges = generateEqualRanges(min, max, numBands);
  const offset = Math.abs(Math.trunc(paletteSeed)) % ANALYSIS_BAND_PALETTE.length;
  const bands: CadAnalysisBand[] = ranges.map((range, index) => ({
    id: range.id,
    lower: range.lower,
    upper: range.upper,
    color: ANALYSIS_BAND_PALETTE[(offset + index) % ANALYSIS_BAND_PALETTE.length]!,
  }));
  const thresholds = [ranges[0]!.lower, ...ranges.map((range) => range.upper)];
  return { bands, thresholds };
};

/** Convenience wrapper using the documented default band count. */
export const generateDefaultAnalysisBands = (
  min: number,
  max: number,
  paletteSeed = 0,
): GeneratedAnalysisBands | { error: string } =>
  generateAnalysisBands(DEFAULT_ANALYSIS_BAND_COUNT, min, max, paletteSeed);
