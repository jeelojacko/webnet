import { RAD_TO_DEG } from './angles';
import { getIndustryReportedIterationCount } from './resultPrecision';
import { formatGpsStdResValue } from './industryListingGpsDisplay';
import type {
  ResultStatisticalSummaryModel,
  ResultStatisticalSummaryRow,
} from './resultDerivedModels';
import type { AdjustmentResult, GpsObservation, Observation, Station } from '../types';

type HeadingAppender = (_title: string, _underline?: string) => void;
type SettingRowAppender = (_label: string, _value: string) => void;
type TablePusher = (_headers: string[], _rows: string[][], _rightAligned?: number[]) => void;
type RenderAdjustedSection = (
  _title: string,
  _rows: string[][],
  _headers: string[],
  _rightAligned: number[],
  _preface?: string[],
) => void;

type GpsDisplayVector = {
  calc?: { dE?: number; dN?: number; dU?: number };
  residual?: { vE?: number; vN?: number; vU?: number };
};

type GpsCovarianceDisplay = {
  sigmaX: number;
  sigmaY: number;
  sigmaZ: number;
};

type AppendAdjustmentStatisticalSummaryOptions = {
  centerIndustryLine: (_text: string) => string;
  getListingGpsStatisticalRow: () => ResultStatisticalSummaryRow | null;
  lines: string[];
  observationCount: number;
  pushSettingRow: SettingRowAppender;
  pushTable: TablePusher;
  res: AdjustmentResult;
  stationCount: number;
  statisticalSummary: ResultStatisticalSummaryModel;
  unknownCount: number;
  useClassicPreanalysisListing: boolean;
  usesClassicParityLayout: boolean;
};

type CreateAdjustedGnssVectorSectionRendererOptions = {
  addCenteredHeading: HeadingAppender;
  compareObsByInput: (_a: Observation, _b: Observation) => number;
  formatLinear: (_value: number | undefined) => string;
  formatResidualLinear: (_value: number | undefined) => string;
  getGpsCovarianceDisplay: (_obs: GpsObservation) => GpsCovarianceDisplay;
  getGpsDisplayVector: (_obs: GpsObservation) => GpsDisplayVector | undefined;
  gpsObservationRows: GpsObservation[];
  linearUnit: string;
  lines: string[];
  listingObservations: Observation[];
  shouldRenderAdjustedGnssVectorSection: boolean;
  unitScale: number;
};

type AppendDataCheckAndBlunderDiagnosticsOptions = {
  addCenteredHeading: HeadingAppender;
  aliasRefsForLine: (_sourceLine?: number) => string;
  autoSideshotSuffix: (_obs: Observation) => string;
  isPreanalysis: boolean;
  linearUnit: string;
  lines: string[];
  observationsForListing: Observation[];
  renderTextTable: TablePusher;
  res: AdjustmentResult;
  runMode: string;
  unitScale: number;
};

type AppendGridDistanceDiagnosticsOptions = {
  aliasRefsForLine: (_sourceLine?: number) => string;
  coordSystemMode: string;
  gridDistanceMode: string;
  linearUnit: string;
  renderAdjustedSection: RenderAdjustedSection;
  res: { stations: Record<string, Station> };
  shouldRenderAdjustedGnssVectorSection: boolean;
  shouldRenderAdjustedObservationSections: boolean;
  sortedListingObservations: Observation[];
  unitScale: number;
  usesClassicParityLayout: boolean;
};

export const appendAdjustmentStatisticalSummary = ({
  centerIndustryLine,
  getListingGpsStatisticalRow,
  lines,
  observationCount,
  pushSettingRow,
  pushTable,
  res,
  stationCount,
  statisticalSummary,
  unknownCount,
  useClassicPreanalysisListing,
  usesClassicParityLayout,
}: AppendAdjustmentStatisticalSummaryOptions) => {
  if (useClassicPreanalysisListing) return;
  lines.push('');
  lines.push(
    usesClassicParityLayout
      ? centerIndustryLine('Adjustment Statistical Summary')
      : 'Adjustment Statistical Summary',
  );
  lines.push(
    usesClassicParityLayout
      ? centerIndustryLine('==============================')
      : '==============================',
  );
  lines.push('');
  if (usesClassicParityLayout) {
    lines.push(
      `                        Iterations              = ${String(getIndustryReportedIterationCount(res)).padStart(6)}`,
    );
    lines.push('');
    lines.push(`                        Number of Stations      = ${String(stationCount).padStart(6)}`);
    lines.push('');
    lines.push(
      `                        Number of Observations  = ${String(observationCount).padStart(6)}`,
    );
    lines.push(`                        Number of Unknowns      = ${String(unknownCount).padStart(6)}`);
    lines.push(`                        Number of Redundant Obs = ${String(res.dof).padStart(6)}`);
  } else {
    pushSettingRow('Iterations', `${getIndustryReportedIterationCount(res)}`);
    pushSettingRow('Number of Stations', `${stationCount}`);
    pushSettingRow('Number of Observations', `${observationCount}`);
    pushSettingRow('Number of Unknowns', `${unknownCount}`);
    pushSettingRow('Number of Redundant Obs', `${res.dof}`);
  }
  lines.push('');
  lines.push('Observation Statistics');

  const hasSolverGpsSummary = statisticalSummary.rows.some((row) => row.label === 'GPS');
  const listingGpsSummary = hasSolverGpsSummary ? null : getListingGpsStatisticalRow();
  const statRows = listingGpsSummary
    ? [...statisticalSummary.rows, listingGpsSummary]
    : statisticalSummary.rows;
  const totalCount = statRows.reduce((sum, row) => sum + row.count, 0);
  const totalSumSquares = statRows.reduce((sum, row) => sum + row.sumSquares, 0);
  const displayStatLabel = (label: string) => (label === 'GPS' ? 'GPS Deltas' : label);
  const statTableRows = statRows.map((row) => [
    displayStatLabel(row.label),
    row.count.toString(),
    row.sumSquares.toFixed(3),
    row.errorFactor.toFixed(3),
  ]);
  statTableRows.push([
    'Total',
    totalCount.toString(),
    totalSumSquares.toFixed(3),
    (res.dof > 0 ? Math.sqrt(totalSumSquares / res.dof) : res.seuw).toFixed(3),
  ]);
  pushTable(
    ['Observation', 'Count', 'Sum Squares of StdRes', 'Error Factor'],
    statTableRows,
    [1, 2, 3],
  );
  lines.push('');
  if (!res.chiSquare) return;
  const errorLower = Math.sqrt(res.chiSquare.varianceFactorLower);
  const errorUpper = Math.sqrt(res.chiSquare.varianceFactorUpper);
  lines.push(`The Chi-Square Test at 5.00% Level ${res.chiSquare.pass95 ? 'Passed' : 'Failed'}`);
  lines.push(`Lower/Upper Bounds (${errorLower.toFixed(3)}/${errorUpper.toFixed(3)})`);
  lines.push(
    `Variance Factor Bounds (${res.chiSquare.varianceFactorLower.toFixed(3)}/${res.chiSquare.varianceFactorUpper.toFixed(3)})`,
  );
  lines.push('');
};

export const createAdjustedGnssVectorSectionRenderer = ({
  addCenteredHeading,
  compareObsByInput,
  formatLinear,
  formatResidualLinear,
  getGpsCovarianceDisplay,
  getGpsDisplayVector,
  gpsObservationRows,
  linearUnit,
  lines,
  listingObservations,
  shouldRenderAdjustedGnssVectorSection,
  unitScale,
}: CreateAdjustedGnssVectorSectionRendererOptions): (() => void) => () => {
  if (!shouldRenderAdjustedGnssVectorSection) return;
  lines.push('');
  addCenteredHeading(`Adjusted GPS Vector Observations (${linearUnit})`);
  lines.push('');
  lines.push('From              Component          Adj Value      Residual   StdErr StdRes File:Line');
  lines.push('To');
  gpsObservationRows
    .filter((obs) => listingObservations.some((candidate) => candidate.id === obs.id))
    .sort(compareObsByInput)
    .forEach((obs) => {
      const displayVector = getGpsDisplayVector(obs);
      const residual =
        displayVector?.residual ??
        ((obs.residual as { vE?: number; vN?: number; vU?: number } | undefined) ?? undefined);
      const calc =
        displayVector?.calc ??
        ((obs.calc as { dE?: number; dN?: number; dU?: number } | undefined) ?? undefined);
      const displayCov = getGpsCovarianceDisplay(obs);
      const sigmaN = displayCov.sigmaY;
      const sigmaE = displayCov.sigmaX;
      const sigmaU = displayCov.sigmaZ;
      lines.push('');
      lines.push(`(${(obs.gpsVectorLabel ?? `${obs.from}-${obs.to}`).trim()})`);
      lines.push(
        `${obs.from.padEnd(18)}${'Delta-N'.padEnd(18)}${formatLinear(calc?.dN).padStart(12)}${formatResidualLinear(residual?.vN).padStart(13)}${formatLinear(sigmaN).padStart(9)}${formatGpsStdResValue(
          sigmaN > 0 && Number.isFinite(residual?.vN ?? Number.NaN)
            ? Math.abs((residual?.vN as number) / sigmaN)
            : undefined,
        ).padStart(7)} ${(obs.sourceLine != null ? `1:${obs.sourceLine}` : '-').padStart(8)}`,
      );
      lines.push(
        `${obs.to.padEnd(18)}${'Delta-E'.padEnd(18)}${formatLinear(calc?.dE).padStart(12)}${formatResidualLinear(residual?.vE).padStart(13)}${formatLinear(sigmaE).padStart(9)}${formatGpsStdResValue(
          sigmaE > 0 && Number.isFinite(residual?.vE ?? Number.NaN)
            ? Math.abs((residual?.vE as number) / sigmaE)
            : undefined,
        ).padStart(7)}`,
      );
      if (Number.isFinite(calc?.dU ?? Number.NaN)) {
        lines.push(
          `${''.padEnd(18)}${'Delta-U'.padEnd(18)}${formatLinear(calc?.dU).padStart(12)}${formatResidualLinear(residual?.vU).padStart(13)}${formatLinear(sigmaU).padStart(9)}${formatGpsStdResValue(
            sigmaU > 0 && Number.isFinite(residual?.vU ?? Number.NaN)
              ? Math.abs((residual?.vU as number) / sigmaU)
              : undefined,
          ).padStart(7)}`,
        );
      }
      const length = Math.sqrt(
        (calc?.dE ?? 0) * (calc?.dE ?? 0) +
          (calc?.dN ?? 0) * (calc?.dN ?? 0) +
          ((calc?.dU ?? 0) * (calc?.dU ?? 0)),
      );
      lines.push(
        `${''.padEnd(18)}${'Length'.padEnd(18)}${(length * unitScale).toFixed(4).padStart(12)}`,
      );
    });
};

export const appendDataCheckAndBlunderDiagnostics = ({
  addCenteredHeading,
  aliasRefsForLine,
  autoSideshotSuffix,
  isPreanalysis,
  linearUnit,
  lines,
  observationsForListing,
  renderTextTable,
  res,
  runMode,
  unitScale,
}: AppendDataCheckAndBlunderDiagnosticsOptions) => {
  const dataCheckDifferenceRows = observationsForListing
    .map((obs) => {
      const stations =
        obs.type === 'angle'
          ? `${obs.at}-${obs.from}-${obs.to}`
          : 'from' in obs && 'to' in obs
            ? `${obs.from}-${obs.to}`
            : '-';
      if (
        obs.type === 'dist' ||
        obs.type === 'lev' ||
        obs.type === 'angle' ||
        obs.type === 'direction' ||
        obs.type === 'bearing' ||
        obs.type === 'dir' ||
        obs.type === 'zenith'
      ) {
        const residual = typeof obs.residual === 'number' ? obs.residual : Number.NaN;
        if (!Number.isFinite(residual)) return null;
        const angular =
          obs.type === 'angle' ||
          obs.type === 'direction' ||
          obs.type === 'bearing' ||
          obs.type === 'dir' ||
          obs.type === 'zenith';
        const diffMag = angular
          ? Math.abs(residual * RAD_TO_DEG * 3600)
          : Math.abs(residual) * unitScale;
        const diffLabel = angular ? `${diffMag.toFixed(2)}"` : diffMag.toFixed(4);
        return {
          obs,
          stations,
          diffMag,
          diffLabel,
          diffUnit: angular ? 'arcsec' : linearUnit,
        };
      }
      if (obs.type === 'gps' && obs.residual && typeof obs.residual === 'object') {
        const residual = obs.residual as { vE?: number; vN?: number; vU?: number };
        const vE = Number.isFinite(residual.vE as number) ? (residual.vE as number) : Number.NaN;
        const vN = Number.isFinite(residual.vN as number) ? (residual.vN as number) : Number.NaN;
        const vU = Number.isFinite(residual.vU as number) ? (residual.vU as number) : 0;
        if (!Number.isFinite(vE) || !Number.isFinite(vN)) return null;
        const diffMag = Math.hypot(vE, vN, vU) * unitScale;
        return {
          obs,
          stations,
          diffMag,
          diffLabel: diffMag.toFixed(4),
          diffUnit: linearUnit,
        };
      }
      return null;
    })
    .filter((row): row is NonNullable<typeof row> => row != null)
    .sort((a, b) => b.diffMag - a.diffMag)
    .slice(0, 25);

  if (!isPreanalysis && runMode === 'data-check' && dataCheckDifferenceRows.length > 0) {
    lines.push('');
    addCenteredHeading('Data Check Only - Differences from Observations');
    lines.push('');
    renderTextTable(
      ['Obs', 'Type', 'Stations', 'Difference', 'Unit', 'StdRes', 'File:Line'],
      dataCheckDifferenceRows.map((row) => [
        String(row.obs.id),
        row.obs.type.toUpperCase(),
        `${row.stations}${aliasRefsForLine(row.obs.sourceLine)}${autoSideshotSuffix(row.obs)}`,
        row.diffLabel,
        row.diffUnit,
        Number.isFinite(row.obs.stdRes ?? Number.NaN)
          ? Math.abs(row.obs.stdRes ?? 0).toFixed(2)
          : '-',
        row.obs.sourceLine != null ? `1:${row.obs.sourceLine}` : '-',
      ]),
      [0, 3, 5],
    );
  }

  if (isPreanalysis || runMode !== 'blunder-detect') return;
  lines.push('');
  addCenteredHeading('Blunder Detect Mode');
  lines.push('Warning: iterative deweighting diagnostics; not a replacement for full adjustment QA.');
  const cycleLines = res.logs.filter((line) => line.startsWith('Blunder cycle ')).slice(0, 20);
  if (cycleLines.length === 0) return;
  lines.push('');
  cycleLines.forEach((line) => lines.push(`  ${line}`));
};

export const appendGridDistanceDiagnostics = ({
  aliasRefsForLine,
  coordSystemMode,
  gridDistanceMode,
  linearUnit,
  renderAdjustedSection,
  res,
  shouldRenderAdjustedGnssVectorSection,
  shouldRenderAdjustedObservationSections,
  sortedListingObservations,
  unitScale,
  usesClassicParityLayout,
}: AppendGridDistanceDiagnosticsOptions) => {
  if (!shouldRenderAdjustedObservationSections && !shouldRenderAdjustedGnssVectorSection) return;
  if (coordSystemMode !== 'grid' || usesClassicParityLayout) return;
  const gridDistanceRows = sortedListingObservations
    .filter((obs): obs is Observation & { type: 'dist' } => obs.type === 'dist')
    .map((obs) => {
      const from = res.stations[obs.from];
      const to = res.stations[obs.to];
      const gridDist = from && to ? Math.hypot(to.x - from.x, to.y - from.y) : Number.NaN;
      const avgGridScale =
        from && to ? ((from.gridScaleFactor ?? 1) + (to.gridScaleFactor ?? 1)) / 2 : 1;
      const avgCombined =
        from && to ? ((from.combinedFactor ?? 1) + (to.combinedFactor ?? 1)) / 2 : 1;
      const mode = obs.gridDistanceMode ?? gridDistanceMode;
      const scaleUsed = mode === 'grid' ? 1 : mode === 'ellipsoidal' ? avgGridScale : avgCombined;
      const groundEq = Number.isFinite(gridDist) && scaleUsed > 0 ? gridDist / scaleUsed : Number.NaN;
      return [
        `${obs.from}-${obs.to}${aliasRefsForLine(obs.sourceLine)}`,
        mode.toUpperCase(),
        (obs.obs * unitScale).toFixed(4),
        Number.isFinite(gridDist) ? (gridDist * unitScale).toFixed(4) : '-',
        Number.isFinite(groundEq) ? (groundEq * unitScale).toFixed(4) : '-',
        scaleUsed.toFixed(8),
        obs.sourceLine != null ? `1:${obs.sourceLine}` : '-',
      ];
    });
  renderAdjustedSection(
    `Grid vs Ground Distance Diagnostics (${linearUnit})`,
    gridDistanceRows,
    ['Stations', 'Mode', 'Input', 'GridDist', 'GroundEq', 'ScaleUsed', 'File:Line'],
    [2, 3, 4, 5],
  );
};
