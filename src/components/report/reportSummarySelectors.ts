import type {
  AdjustmentResult,
  GpsObservation,
  RelativeCovarianceBlock,
  StationCovarianceBlock,
} from '../../types';
import type { SortedObservation } from '../../engine/resultDerivedModels';

type TypeSummaryEntry = [
  string,
  NonNullable<AdjustmentResult['typeSummary']>[string],
];

export interface ReportSummarySelectorModel {
  maxAbsStdRes: number;
  suspectImpactActionableCount: number;
  suspectImpactExcludedCount: number;
  suspectImpactWorstBaseStdRes: number;
  setupLocalFailCount: number;
  setupWorstStdRes: number;
  setupObsCount: number;
  typeSummaryEntries: TypeSummaryEntry[];
  typeSummaryObsCount: number;
  topTypeSummaryEntry: TypeSummaryEntry | null;
  topStationCovarianceRow?: StationCovarianceBlock;
  topRelativeCovarianceRow?: RelativeCovarianceBlock;
  topRelativePrecisionRow?: NonNullable<AdjustmentResult['relativePrecision']>[number];
  topGpsOffsetObservation?: GpsObservation;
}

export const buildReportSummarySelectorModel = (input: {
  sortedObs: SortedObservation[];
  suspectImpactDiagnostics: NonNullable<AdjustmentResult['suspectImpactDiagnostics']>;
  excludedIds: Set<number>;
  setupDiagnostics: NonNullable<AdjustmentResult['setupDiagnostics']>;
  typeSummary: NonNullable<AdjustmentResult['typeSummary']>;
  filteredStationCovariances: StationCovarianceBlock[];
  filteredRelativeCovariances: RelativeCovarianceBlock[];
  filteredRelativePrecision: NonNullable<AdjustmentResult['relativePrecision']>;
  gpsOffsetObservations: GpsObservation[];
}): ReportSummarySelectorModel => {
  const maxAbsStdRes = input.sortedObs.reduce(
    (max, obs) => Math.max(max, Math.abs(obs.stdRes ?? 0)),
    0,
  );

  const suspectImpactActionableCount = input.suspectImpactDiagnostics.filter(
    (row) => row.status === 'ok' && !input.excludedIds.has(row.obsId),
  ).length;
  const suspectImpactExcludedCount = input.suspectImpactDiagnostics.filter(
    (row) => row.status !== 'ok' || input.excludedIds.has(row.obsId),
  ).length;
  const suspectImpactWorstBaseStdRes = input.suspectImpactDiagnostics.reduce(
    (max, row) => Math.max(max, Math.abs(row.baseStdRes ?? 0)),
    0,
  );

  const setupLocalFailCount = input.setupDiagnostics.reduce(
    (sum, row) => sum + row.localFailCount,
    0,
  );
  const setupWorstStdRes = input.setupDiagnostics.reduce(
    (max, row) => Math.max(max, Math.abs(row.maxStdRes ?? 0)),
    0,
  );
  const setupObsCount = input.setupDiagnostics.reduce(
    (sum, row) =>
      sum +
      row.directionObsCount +
      row.angleObsCount +
      row.distanceObsCount +
      row.zenithObsCount +
      row.levelingObsCount +
      row.gpsObsCount,
    0,
  );

  const typeSummaryEntries = Object.entries(input.typeSummary);
  const typeSummaryObsCount = typeSummaryEntries.reduce(
    (sum, [, summary]) => sum + summary.count,
    0,
  );
  const topTypeSummaryEntry = typeSummaryEntries.reduce<TypeSummaryEntry | null>((top, entry) => {
    if (!top) return entry;
    return entry[1].count > top[1].count ? entry : top;
  }, null);

  return {
    maxAbsStdRes,
    suspectImpactActionableCount,
    suspectImpactExcludedCount,
    suspectImpactWorstBaseStdRes,
    setupLocalFailCount,
    setupWorstStdRes,
    setupObsCount,
    typeSummaryEntries,
    typeSummaryObsCount,
    topTypeSummaryEntry,
    topStationCovarianceRow: input.filteredStationCovariances[0],
    topRelativeCovarianceRow: input.filteredRelativeCovariances[0],
    topRelativePrecisionRow: input.filteredRelativePrecision[0],
    topGpsOffsetObservation: input.gpsOffsetObservations[0],
  };
};
