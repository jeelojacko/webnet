import type { CadAnalysisLegend, CadAnalysisMap } from './cadAnalysisTypes';
import type { CachedAnalysisResult } from './surfaceAnalysisCache';
import type { CadProject, CadTextStyle } from './cadTypes';

/**
 * Phase 18U UI — analysis legend geometry (UI-owned, pure). CANONICAL
 * (`.service` suffix): this is the wired builder — the scene module
 * (`cadAnalysisDisplayView`) consumes it directly for legend layers.
 *
 * A legend is a VIEW over an analysis map + its cached CURRENT result:
 * frame, title, swatch rows. Nothing derived is stored. Text metrics come
 * from the referenced Text Style (18O `heightMode` model/paper mapping —
 * no invented font system); quantity units are passed in by the caller
 * (drawing units at the display boundary — never hard-coded m²/m³ here).
 */

/** Caller-supplied unit labels (drawing units resolved at the boundary). */
export interface AnalysisLegendUnits {
  area: string;
  volume: string;
}

export interface AnalysisLegendRowGeometry {
  bandId: string;
  color: string;
  rangeText: string;
  quantityText: string;
  /** Row origin in drawing units (insertion-relative layout). */
  x: number;
  y: number;
}

export interface AnalysisLegendGeometry {
  legendId: string;
  title: string;
  titleHeight: number;
  rowHeight: number;
  swatchWidth: number;
  frame: { x: number; y: number; width: number; height: number };
  rows: AnalysisLegendRowGeometry[];
  /** True when no CURRENT result exists (legend shows ranges only). */
  rangesOnly: boolean;
}

/**
 * Resolve cap height in drawing units from the 18O Text Style model:
 * `model` → modelHeight, `paper` → paperHeightMm (sheet callers scale to
 * model space before calling), legacy/absent → fontSize. Never invents a
 * font system — unknown styles fall back to the stored size.
 */
export const resolveLegendTextHeight = (style: CadTextStyle | undefined): number => {
  if (!style) return 2.5;
  if (style.heightMode === 'model' && style.modelHeight != null && style.modelHeight > 0) {
    return style.modelHeight;
  }
  if (style.heightMode === 'paper' && style.paperHeightMm != null && style.paperHeightMm > 0) {
    return style.paperHeightMm;
  }
  return style.fontSize > 0 ? style.fontSize : 2.5;
};

const formatRange = (lower: number, upper: number): string => `${lower} – ${upper}`;

const quantityTextFor = (
  legend: CadAnalysisLegend,
  band: { planArea: number; percentOfPlan: number; netVolume: number },
  units: AnalysisLegendUnits,
): string => {
  const parts: string[] = [];
  if (legend.showArea !== false) parts.push(`${band.planArea.toFixed(2)} ${units.area}`);
  if (legend.showPercent === true) parts.push(`${band.percentOfPlan.toFixed(1)}%`);
  if (legend.showVolume === true) parts.push(`${band.netVolume.toFixed(2)} ${units.volume}`);
  return parts.join(' · ');
};

interface BandQuantity {
  bandId: string;
  planArea: number;
  percentOfPlan: number;
  netVolume: number;
}

const quantitiesOf = (result: CachedAnalysisResult | null): Map<string, BandQuantity> => {
  const quantities = new Map<string, BandQuantity>();
  if (!result) return quantities;
  if (result.result.kind === 'elevation') {
    const total = result.result.result.totals.classifiedPlanArea;
    for (const band of result.result.result.bands) {
      quantities.set(band.bandId, {
        bandId: band.bandId,
        planArea: band.planArea,
        percentOfPlan: total > 0 ? (100 * band.planArea) / total : 0,
        netVolume: 0,
      });
    }
    return quantities;
  }
  if (result.result.kind === 'slope') {
    for (const band of result.result.result.bands) {
      quantities.set(band.bandId, {
        bandId: band.bandId,
        planArea: band.planArea,
        percentOfPlan: band.percentOfPlan,
        netVolume: 0,
      });
    }
    return quantities;
  }
  const total = result.result.result.totals.classifiedArea;
  for (const band of result.result.result.bands) {
    quantities.set(band.bandId, {
      bandId: band.bandId,
      planArea: band.planArea,
      percentOfPlan: total > 0 ? (100 * band.planArea) / total : 0,
      netVolume: band.netVolume,
    });
  }
  return quantities;
};

/**
 * Derived legend frame + rows for a map/result pair. Ranges always derive
 * from the definition; quantities attach only from a CURRENT cached result
 * (the caller gates revision — stale never renders quantities as current).
 */
export const buildAnalysisLegendGeometry = (
  project: CadProject,
  legend: CadAnalysisLegend,
  def: CadAnalysisMap,
  result: CachedAnalysisResult | null,
  units: AnalysisLegendUnits,
): AnalysisLegendGeometry => {
  const style = legend.textStyleId
    ? project.styleLibrary.textStyles.find((entry) => entry.id === legend.textStyleId)
    : project.styleLibrary.textStyles[0];
  const titleHeight = resolveLegendTextHeight(style);
  const rowHeight = legend.rowHeight != null && legend.rowHeight > 0 ? legend.rowHeight : titleHeight * 1.6;
  const swatchWidth = legend.swatchWidth != null && legend.swatchWidth > 0
    ? legend.swatchWidth
    : titleHeight * 2;
  const quantities = quantitiesOf(result);
  const rows: AnalysisLegendRowGeometry[] = def.bands.map((band, index) => {
    const quantity = quantities.get(band.id);
    return {
      bandId: band.id,
      color: band.color,
      rangeText: legend.showRange === false ? '' : (band.label ?? formatRange(band.lower, band.upper)),
      quantityText: quantity ? quantityTextFor(legend, quantity, units) : '',
      x: legend.insertionX,
      y: legend.insertionY - titleHeight * 1.8 - index * rowHeight,
    };
  });
  const width = swatchWidth * 6;
  const height = titleHeight * 1.8 + rows.length * rowHeight + titleHeight * 0.6;
  return {
    legendId: legend.id,
    title: legend.title ?? def.name,
    titleHeight,
    rowHeight,
    swatchWidth,
    frame: { x: legend.insertionX, y: legend.insertionY - height, width, height },
    rows,
    rangesOnly: result == null,
  };
};
