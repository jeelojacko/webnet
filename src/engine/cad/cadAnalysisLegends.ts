import { applyPoint, type CadTransform2D } from './cadTransform2D';
import type { CadAnalysisLegend, CadAnalysisStatus } from './cadAnalysisTypes';

/**
 * Phase 18U analysis legend CRUD + derived broken-reference rule.
 *
 * A legend is presentation only: it references an analysis map for its rows
 * and stores no derived values. Moving it is an appearance edit — never a
 * geometry edit, never a recalculation trigger.
 */

const isFiniteNumber = (value: unknown): value is number =>
  typeof value === 'number' && Number.isFinite(value);

const isNonEmptyString = (value: unknown): value is string =>
  typeof value === 'string' && value.trim() !== '';

export const cloneCadAnalysisLegend = (legend: CadAnalysisLegend): CadAnalysisLegend => ({
  id: legend.id,
  analysisId: legend.analysisId,
  insertionX: legend.insertionX,
  insertionY: legend.insertionY,
  ...(legend.title != null ? { title: legend.title } : {}),
  ...(legend.textStyleId != null ? { textStyleId: legend.textStyleId } : {}),
  ...(legend.swatchWidth != null ? { swatchWidth: legend.swatchWidth } : {}),
  ...(legend.rowHeight != null ? { rowHeight: legend.rowHeight } : {}),
  ...(legend.showRange != null ? { showRange: legend.showRange } : {}),
  ...(legend.showArea != null ? { showArea: legend.showArea } : {}),
  ...(legend.showPercent != null ? { showPercent: legend.showPercent } : {}),
  ...(legend.showVolume != null ? { showVolume: legend.showVolume } : {}),
});

export const cloneCadAnalysisLegends = (
  legends: CadAnalysisLegend[] | undefined,
): CadAnalysisLegend[] => (legends ?? []).map(cloneCadAnalysisLegend);

/** Load-time backfill: legacy drawings (field absent) open with no legends. */
export const backfillAnalysisLegends = (
  legends: CadAnalysisLegend[] | undefined,
): CadAnalysisLegend[] => cloneCadAnalysisLegends(legends);

const validateLegend = (legend: CadAnalysisLegend): string | null => {
  if (!isNonEmptyString(legend.id)) return 'ANALYSIS_LEGEND_ID';
  if (!isNonEmptyString(legend.analysisId)) return 'ANALYSIS_LEGEND_ANALYSIS_ID';
  if (!isFiniteNumber(legend.insertionX) || !isFiniteNumber(legend.insertionY)) {
    return 'ANALYSIS_LEGEND_INSERTION';
  }
  for (const key of ['swatchWidth', 'rowHeight'] as const) {
    const value = legend[key];
    if (value !== undefined && (!isFiniteNumber(value) || value <= 0)) {
      return 'ANALYSIS_LEGEND_SIZE';
    }
  }
  for (const key of ['title', 'textStyleId'] as const) {
    const value = legend[key];
    if (value !== undefined && typeof value !== 'string') return 'ANALYSIS_LEGEND_TEXT';
  }
  return null;
};

export const createAnalysisLegend = (
  legends: CadAnalysisLegend[],
  legend: CadAnalysisLegend,
): CadAnalysisLegend[] | { error: string } => {
  if (legends.some((entry) => entry.id === legend.id)) return { error: 'ANALYSIS_LEGEND_ID_TAKEN' };
  const reason = validateLegend(legend);
  if (reason) return { error: reason };
  return [...legends, cloneCadAnalysisLegend(legend)];
};

export const moveAnalysisLegend = (
  legends: CadAnalysisLegend[],
  legendId: string,
  x: number,
  y: number,
): CadAnalysisLegend[] | { error: string } => {
  const current = legends.find((legend) => legend.id === legendId);
  if (!current) return { error: 'ANALYSIS_LEGEND_NOT_FOUND' };
  if (!isFiniteNumber(x) || !isFiniteNumber(y)) return { error: 'ANALYSIS_LEGEND_INSERTION' };
  return legends.map((legend) =>
    legend.id === legendId ? { ...legend, insertionX: x, insertionY: y } : legend,
  );
};

export interface CadAnalysisLegendPatch {
  analysisId?: string;
  title?: string | null;
  textStyleId?: string | null;
  swatchWidth?: number;
  rowHeight?: number;
  showRange?: boolean;
  showArea?: boolean;
  showPercent?: boolean;
  showVolume?: boolean;
}

export const updateAnalysisLegend = (
  legends: CadAnalysisLegend[],
  legendId: string,
  patch: CadAnalysisLegendPatch,
): CadAnalysisLegend[] | { error: string } => {
  const current = legends.find((legend) => legend.id === legendId);
  if (!current) return { error: 'ANALYSIS_LEGEND_NOT_FOUND' };
  const next: CadAnalysisLegend = { ...current };
  if (patch.analysisId !== undefined) {
    if (!isNonEmptyString(patch.analysisId)) return { error: 'ANALYSIS_LEGEND_ANALYSIS_ID' };
    next.analysisId = patch.analysisId;
  }
  for (const key of ['title', 'textStyleId'] as const) {
    const value = patch[key];
    if (value === undefined) continue;
    if (value == null || value === '') delete next[key];
    else next[key] = value;
  }
  for (const key of ['swatchWidth', 'rowHeight'] as const) {
    const value = patch[key];
    if (value === undefined) continue;
    if (!isFiniteNumber(value) || value <= 0) return { error: 'ANALYSIS_LEGEND_SIZE' };
    next[key] = value;
  }
  for (const key of ['showRange', 'showArea', 'showPercent', 'showVolume'] as const) {
    const value = patch[key];
    if (value !== undefined) next[key] = value;
  }
  const reason = validateLegend(next);
  if (reason) return { error: reason };
  return legends.map((legend) => (legend.id === legendId ? next : legend));
};

export const deleteAnalysisLegend = (
  legends: CadAnalysisLegend[],
  legendId: string,
): CadAnalysisLegend[] | { error: string } => {
  if (!legends.some((legend) => legend.id === legendId)) {
    return { error: 'ANALYSIS_LEGEND_NOT_FOUND' };
  }
  return legends.filter((legend) => legend.id !== legendId);
};

/**
 * Legends never invent currency: they report the referenced map's status, or
 * BROKEN_REFERENCE when the reference is empty/unresolved (analysisStatus null).
 */
export const deriveAnalysisLegendStatus = (
  legend: Pick<CadAnalysisLegend, 'analysisId'>,
  analysisStatus: CadAnalysisStatus | null,
): CadAnalysisStatus => {
  if (!isNonEmptyString(legend.analysisId) || analysisStatus == null) return 'BROKEN_REFERENCE';
  return analysisStatus;
};

/**
 * PROJECTTRANSFORM insertion helper: XY-only, orientation-preserving
 * similarity. Thresholds and analysis results are never carried through a
 * frame change (they live on the map, not the legend).
 */
export const transformAnalysisLegendInsertion = (
  legend: CadAnalysisLegend,
  transform: CadTransform2D,
): CadAnalysisLegend => {
  const at = applyPoint(transform, { x: legend.insertionX, y: legend.insertionY });
  return { ...cloneCadAnalysisLegend(legend), insertionX: at.x, insertionY: at.y };
};
