/**
 * Phase 18U UI — Analysis Summary CSV (export-only, CURRENT-gated).
 *
 * Format/escape/filename rules mirror `cadVolumeSnapshot`: a metadata block
 * with explicit units followed by the band table. Elevation/slope rows carry
 * Analysis/Band/Lower/Upper/Plan Area/3D Area/Percent; depth rows carry
 * Band/Lower Δ/Upper Δ/Plan Area/Cut Volume/Fill Volume/Net Volume. A
 * stale/needs-recalc map THROWS, so no stale band quantity can be exported.
 */

import {
  analysisAreaUnit,
  analysisMetricUnit,
  analysisVolumeUnit,
  formatAnalysisNumber,
  type CadAnalysisRow,
} from './cadAnalysisSnapshot';

const escapeAnalysisCsv = (value: string): string =>
  /[",\r\n]/.test(value) ? `"${value.replace(/"/g, '""')}"` : value;

export const buildAnalysisSummaryFilename = (analysisName: string): string => {
  const slug =
    analysisName
      .trim()
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-+|-+$/g, '') || 'analysis';
  return `analysis-summary-${slug}.csv`;
};

/**
 * Analysis Summary CSV: a metadata block (explicit units) followed by the
 * band table. Elevation/slope rows carry Analysis/Band/Lower/Upper/Plan
 * Area/3D Area/Percent; depth rows carry Band/Lower Δ/Upper Δ/Plan Area/
 * Cut Volume/Fill Volume/Net Volume. Gated on CURRENT exactly like the
 * Volume Report: a stale/needs-recalc map throws so no stale quantity can be
 * exported silently.
 */
export const buildAnalysisSummaryCsv = (row: CadAnalysisRow, units: string): string => {
  if (!row.exportable || !row.result) {
    throw new Error(
      `Analysis Summary export blocked: “${row.name}” is ${row.statusText}, not Current.`,
    );
  }
  const metricUnit = analysisMetricUnit(units, row.metric);
  const areaUnit = analysisAreaUnit(units);
  const volumeUnit = analysisVolumeUnit(units);
  const depth = row.metric === 'signed-depth';
  const bandHeader = depth
    ? [`Band`, `Lower Δ (${metricUnit})`, `Upper Δ (${metricUnit})`, `Plan Area (${areaUnit})`,
       `Cut Volume (${volumeUnit})`, `Fill Volume (${volumeUnit})`, `Net Volume (${volumeUnit})`]
    : [`Analysis`, `Band`, `Lower (${metricUnit})`, `Upper (${metricUnit})`,
       `Plan Area (${areaUnit})`, `3D Area (${areaUnit})`, `Percent`];
  const bandRows = row.bands.map((band) =>
    depth
      ? [band.label, formatAnalysisNumber(band.lower), formatAnalysisNumber(band.upper),
         formatAnalysisNumber(band.planArea), formatAnalysisNumber(band.cutVolume),
         formatAnalysisNumber(band.fillVolume), formatAnalysisNumber(band.netVolume)]
      : [row.name, band.label, formatAnalysisNumber(band.lower), formatAnalysisNumber(band.upper),
         formatAnalysisNumber(band.planArea), formatAnalysisNumber(band.area3D),
         formatAnalysisNumber(band.percent)],
  );
  const lines: string[][] = [
    ['section', 'label', 'value', 'unit'],
    ['meta', 'title', `Analysis Summary — ${row.name}`, ''],
    ['meta', 'type', row.typeLabel, ''],
    ['meta', 'source', `${row.sourceKind} ${row.sourceName}`, ''],
    ['meta', 'status', row.statusText, ''],
    ['meta', 'revision', row.revision, ''],
    ['meta', 'bands', String(row.bandCount), ''],
    ['meta', 'measured-min', formatAnalysisNumber(row.measuredMin ?? row.rangeMin), metricUnit],
    ['meta', 'measured-max', formatAnalysisNumber(row.measuredMax ?? row.rangeMax), metricUnit],
    ['meta', 'classified-area', formatAnalysisNumber(row.classifiedArea ?? 0), areaUnit],
    bandHeader,
    ...bandRows,
  ];
  return lines.map((line) => line.map((cell) => escapeAnalysisCsv(String(cell))).join(',')).join('\n');
};
