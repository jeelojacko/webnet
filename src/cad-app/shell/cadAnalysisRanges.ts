import {
  ANALYSIS_BAND_PALETTE,
  generateAnalysisBands,
  validateAnalysisBands,
} from '../../engine/cad/cadAnalysisMaps';
import {
  DEFAULT_ANALYSIS_BAND_COUNT,
  MAX_ANALYSIS_BANDS,
  type CadAnalysisBand,
  type CadAnalysisMap,
} from '../../engine/cad/cadAnalysisTypes';
import { analysisAreaUnit, analysisBandLabel, analysisVolumeUnit } from './cadAnalysisSnapshot';
import type { CadAnalysisResult } from './cadAnalysisSnapshot';

/**
 * Phase 18U UI — range-editor draft helpers (pure). The editor keeps one
 * draft row per band with editable Color/Lower/Upper/Label plus read-only
 * measured columns; Apply converts the draft to `CadAnalysisBand[]` and the
 * ANALYSIS_MAP_UPDATE_BANDS command validates it again (one shared rule).
 */

export interface AnalysisRangeDraftRow {
  /** Stable row key (also the band id when applied). */
  id: string;
  color: string;
  lower: string;
  upper: string;
  label: string;
  /** Read-only measured columns (null until the map is CURRENT). */
  planArea: number | null;
  percent: number | null;
  area3D: number | null;
  cutVolume: number | null;
  fillVolume: number | null;
  netVolume: number | null;
}

export const ANALYSIS_RANGE_ERROR_TEXT: Record<string, string> = {
  ANALYSIS_BANDS_EMPTY: 'At least one band is required.',
  ANALYSIS_BANDS_TOO_MANY: `At most ${MAX_ANALYSIS_BANDS} bands are allowed.`,
  ANALYSIS_BAND_ID: 'Band id missing.',
  ANALYSIS_BAND_ID_DUPLICATE: 'Two bands share an id.',
  ANALYSIS_BAND_NON_FINITE: 'Band edges must be finite numbers.',
  ANALYSIS_BAND_RANGE: 'Each band needs lower < upper.',
  ANALYSIS_BAND_COLOR: 'Each band needs a color.',
  ANALYSIS_BAND_LABEL: 'Band labels must be text.',
  ANALYSIS_BAND_OVERLAP: 'Bands must not overlap (touching edges and gaps are allowed).',
  ANALYSIS_BAND_INVALID: 'Band table is invalid.',
  ANALYSIS_BAND_COUNT: 'Band count must be a positive integer.',
};

export const describeAnalysisRangeError = (reason: string): string =>
  ANALYSIS_RANGE_ERROR_TEXT[reason] ?? reason;

let draftSeq = 0;

const nextDraftId = (): string => {
  draftSeq += 1;
  return `band-${draftSeq}`;
};

/** Test seam: reset id sequence so fixtures stay deterministic. */
export const resetAnalysisRangeDraftIds = (): void => {
  draftSeq = 0;
};

export const createAnalysisRangeDraft = (
  bands: readonly CadAnalysisBand[],
  result: CadAnalysisResult | null,
): AnalysisRangeDraftRow[] => {
  const measuredById = new Map((result?.bands ?? []).map((band) => [band.bandId, band]));
  return bands.map((band) => {
    const measured = measuredById.get(band.id) ?? null;
    return {
      id: band.id,
      color: band.color,
      lower: String(band.lower),
      upper: String(band.upper),
      label: band.label ?? '',
      planArea: measured?.planArea ?? null,
      percent: measured?.percent ?? null,
      area3D: measured?.area3D ?? null,
      cutVolume: measured?.cutVolume ?? null,
      fillVolume: measured?.fillVolume ?? null,
      netVolume: measured?.netVolume ?? null,
    };
  });
};

/** Parse one draft row into a band definition; NaN-free but unvalidated. */
export const draftRowToBand = (row: AnalysisRangeDraftRow): CadAnalysisBand => ({
  id: row.id,
  lower: Number.parseFloat(row.lower),
  upper: Number.parseFloat(row.upper),
  color: row.color,
  ...(row.label.trim() !== '' ? { label: row.label.trim() } : {}),
});

/** Reason code (or null) for the current draft, using the shared validator. */
export const validateAnalysisRangeDraft = (rows: readonly AnalysisRangeDraftRow[]): string | null =>
  validateAnalysisBands(rows.map(draftRowToBand));

/** Sorted-by-lower gaps (plan value ranges with no band coverage). */
export const analysisRangeGaps = (
  rows: readonly AnalysisRangeDraftRow[],
): Array<{ lower: number; upper: number }> => {
  const parsed = rows
    .map((row) => ({ lower: Number.parseFloat(row.lower), upper: Number.parseFloat(row.upper) }))
    .filter((entry) => Number.isFinite(entry.lower) && Number.isFinite(entry.upper))
    .sort((a, b) => a.lower - b.lower);
  const gaps: Array<{ lower: number; upper: number }> = [];
  for (let i = 1; i < parsed.length; i += 1) {
    const previous = parsed[i - 1]!;
    const current = parsed[i]!;
    if (current.lower > previous.upper) {
      gaps.push({ lower: previous.upper, upper: current.lower });
    }
  }
  return gaps;
};

export const describeAnalysisRangeGaps = (
  rows: readonly AnalysisRangeDraftRow[],
): string | null => {
  const gaps = analysisRangeGaps(rows);
  if (gaps.length === 0) return null;
  const text = gaps
    .map((gap) => `${gap.lower} – ${gap.upper}`)
    .join(', ');
  return `UNCLASSIFIED gap${gaps.length > 1 ? 's' : ''}: ${text}`;
};

/** Equal-width regeneration (default count 5, capped at MAX_ANALYSIS_BANDS). */
export const generateAnalysisRangeDraft = (
  count: number,
  min: number,
  max: number,
  seed = 0,
): { rows: AnalysisRangeDraftRow[] } | { error: string } => {
  const requested = Number.isFinite(count) && count > 0
    ? Math.min(MAX_ANALYSIS_BANDS, Math.floor(count))
    : DEFAULT_ANALYSIS_BAND_COUNT;
  const generated = generateAnalysisBands(requested, min, max, seed);
  if ('error' in generated) return { error: generated.error };
  return {
    rows: generated.bands.map((band) => ({
      id: nextDraftId(),
      color: band.color,
      lower: String(band.lower),
      upper: String(band.upper),
      label: '',
      planArea: null,
      percent: null,
      area3D: null,
      cutVolume: null,
      fillVolume: null,
      netVolume: null,
    })),
  };
};

/** Append one band continuing the current table (one palette step wide). */
export const appendAnalysisRangeDraft = (
  rows: readonly AnalysisRangeDraftRow[],
): AnalysisRangeDraftRow[] => {
  const parsed = rows
    .map((row) => ({ lower: Number.parseFloat(row.lower), upper: Number.parseFloat(row.upper) }))
    .filter((entry) => Number.isFinite(entry.lower) && Number.isFinite(entry.upper));
  const last = parsed.sort((a, b) => b.upper - a.upper)[0];
  const width = last ? Math.max(last.upper - last.lower, 1e-6) : 1;
  const lower = last ? last.upper : 0;
  const upper = lower + width;
  return [
    ...rows,
    {
      id: nextDraftId(),
      color: ANALYSIS_BAND_PALETTE[rows.length % ANALYSIS_BAND_PALETTE.length]!,
      lower: String(lower),
      upper: String(upper),
      label: '',
      planArea: null,
      percent: null,
      area3D: null,
      cutVolume: null,
      fillVolume: null,
      netVolume: null,
    },
  ];
};

export const removeAnalysisRangeDraft = (
  rows: readonly AnalysisRangeDraftRow[],
  id: string,
): AnalysisRangeDraftRow[] => rows.filter((row) => row.id !== id);

export const updateAnalysisRangeDraftRow = (
  rows: readonly AnalysisRangeDraftRow[],
  id: string,
  patch: Partial<Pick<AnalysisRangeDraftRow, 'color' | 'lower' | 'upper' | 'label'>>,
): AnalysisRangeDraftRow[] =>
  rows.map((row) => (row.id === id ? { ...row, ...patch } : row));

/** Read-only measured text for one draft row (units explicit). */
export const analysisDraftMeasuredText = (
  row: AnalysisRangeDraftRow,
  map: CadAnalysisMap,
  units: string,
  result: CadAnalysisResult | null,
): { area: string; extra: string } => {
  if (!result) return { area: '—', extra: '—' };
  const areaUnit = analysisAreaUnit(units);
  const area = row.planArea == null ? '—' : `${row.planArea.toFixed(3)} ${areaUnit}`;
  if (map.source.metric === 'signed-depth') {
    const net = row.netVolume == null ? '—' : `${row.netVolume.toFixed(3)} ${analysisVolumeUnit(units)}`;
    return { area, extra: `net ${net}` };
  }
  const cell = row.area3D == null ? '—' : `${row.area3D.toFixed(3)} ${areaUnit}`;
  return { area, extra: `3D ${cell}` };
};

/** Label shown for one draft row (Near Balance for zero-straddling depth bands). */
export const analysisDraftLabel = (
  row: AnalysisRangeDraftRow,
  map: CadAnalysisMap,
): string =>
  analysisBandLabel(
    {
      ...(row.label.trim() !== '' ? { label: row.label.trim() } : {}),
      lower: Number.parseFloat(row.lower),
      upper: Number.parseFloat(row.upper),
    },
    map.source.metric,
  );
