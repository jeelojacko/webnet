import { useCallback, useMemo } from 'react';
import type { AdjustmentResult, Observation, Station } from '../../types';
import type { ReportViewProps } from '../ReportView.types';
import {
  getRelativeCovarianceRows,
  getRelativePrecisionRows,
  getStationCovarianceRows,
} from '../../engine/resultPrecision';
import { sortObservationsByStdRes, type SortedObservation } from '../../engine/resultDerivedModels';
import {
  buildStationTypeBadge,
  formatEffectiveDistance as reportFormatEffectiveDistance,
  formatMdb as reportFormatMdb,
  formatPrismAnnotation,
  formatReductionUsage,
  getFixedSigmaLabel,
  getObservationStationsLabel,
  getObservationValueLabel,
  getObservationWeightLabel,
  getPreanalysisLabelTooltip,
} from './reportFormatters';
import { buildReportObservationSelectorModel } from './reportObservationSelectors';
import { buildReportPrecisionSelectorModel } from './reportPrecisionSelectors';
import { buildReportReviewSelectorModel } from './reportReviewSelectors';
import { buildReportSummarySelectorModel } from './reportSummarySelectors';
import { buildReportWindowedRowsModel } from './reportWindowedRows';

const EMPTY_SUSPECT_IMPACT_DIAGNOSTICS: NonNullable<AdjustmentResult['suspectImpactDiagnostics']> =
  [];
const EMPTY_SETUP_DIAGNOSTICS: NonNullable<AdjustmentResult['setupDiagnostics']> = [];

type UseReportViewModelOptions = {
  activeClusterApprovedMerges: ReportViewProps['activeClusterApprovedMerges'];
  clusterReviewDecisions: ReportViewProps['clusterReviewDecisions'];
  excludedIds: Set<number>;
  isBlunderDetect: boolean;
  isDataCheck: boolean;
  isPreanalysis: boolean;
  isRegularAdjustment: boolean;
  isSpecialRunMode: boolean;
  matchesReportQuery: (..._parts: Array<string | number | null | undefined>) => boolean;
  precisionReportingMode: NonNullable<ReportViewProps['precisionReportingMode']>;
  reportExclusionFilter: 'all' | 'included' | 'excluded';
  reportObservationTypeFilter: 'all' | Observation['type'];
  result: AdjustmentResult;
  reviewAdjustedOnly: boolean;
  reviewConflictOnly: boolean;
  reviewImportedGroupFilter: string;
  unitScale: number;
  units: ReportViewProps['units'];
  visibleRowsFor: <T>(_key: string, _rows: T[], _defaultSize?: number) => T[];
};

export const useReportViewModel = ({
  activeClusterApprovedMerges,
  clusterReviewDecisions,
  excludedIds,
  isBlunderDetect,
  isDataCheck,
  isPreanalysis,
  isRegularAdjustment,
  isSpecialRunMode,
  matchesReportQuery,
  precisionReportingMode,
  reportExclusionFilter,
  reportObservationTypeFilter,
  result,
  reviewAdjustedOnly,
  reviewConflictOnly,
  reviewImportedGroupFilter,
  unitScale,
  units,
  visibleRowsFor,
}: UseReportViewModelOptions) => {
  const sortedObs = useMemo<SortedObservation[]>(
    () => sortObservationsByStdRes(result.observations),
    [result.observations],
  );
  const suspectImpactDiagnostics =
    result.suspectImpactDiagnostics ?? EMPTY_SUSPECT_IMPACT_DIAGNOSTICS;
  const setupDiagnostics = result.setupDiagnostics ?? EMPTY_SETUP_DIAGNOSTICS;
  const observationSelector = useMemo(
    () =>
      buildReportObservationSelectorModel({
        result,
        sortedObs,
        excludedIds,
        reportObservationTypeFilter,
        reportExclusionFilter,
        reviewConflictOnly,
        reviewAdjustedOnly,
        reviewImportedGroupFilter,
        matchesReportQuery,
        isDataCheck,
        isBlunderDetect,
        unitScale,
        units,
      }),
    [
      excludedIds,
      isBlunderDetect,
      isDataCheck,
      matchesReportQuery,
      reportExclusionFilter,
      reportObservationTypeFilter,
      result,
      reviewAdjustedOnly,
      reviewConflictOnly,
      reviewImportedGroupFilter,
      sortedObs,
      unitScale,
      units,
    ],
  );
  const byType = (type: Observation['type']): SortedObservation[] =>
    observationSelector.observationsByType.get(type) ?? [];
  const traverseLoops = result.traverseDiagnostics?.loops ?? [];
  const gpsLoopDiagnostics = result.gpsLoopDiagnostics;
  const levelingLoopDiagnostics = result.levelingLoopDiagnostics;
  const reviewSelector = useMemo(
    () =>
      buildReportReviewSelectorModel({
        parseState: result.parseState,
        clusterDiagnostics: result.clusterDiagnostics,
        activeClusterApprovedMerges,
        clusterReviewDecisions,
        autoSideshotDiagnostics: result.autoSideshotDiagnostics,
        sideshots: result.sideshots,
        observations: result.observations,
      }),
    [
      activeClusterApprovedMerges,
      clusterReviewDecisions,
      result.autoSideshotDiagnostics,
      result.clusterDiagnostics,
      result.observations,
      result.parseState,
      result.sideshots,
    ],
  );
  const stationDescription = (stationId: string): string =>
    reviewSelector.reconciledDescriptions[stationId] ?? '-';
  const stationCovariances = useMemo(
    () => getStationCovarianceRows(result, precisionReportingMode),
    [precisionReportingMode, result],
  );
  const relativeCovariances = useMemo(
    () => getRelativeCovarianceRows(result, precisionReportingMode),
    [precisionReportingMode, result],
  );
  const relativePrecisionRows = useMemo(
    () => getRelativePrecisionRows(result, precisionReportingMode),
    [precisionReportingMode, result],
  );
  const activePreanalysisScenarioIds = useMemo(
    () => new Set(result.preanalysisSyntheticAdditionIds ?? []),
    [result.preanalysisSyntheticAdditionIds],
  );
  const precisionSelector = useMemo(
    () =>
      buildReportPrecisionSelectorModel({
        result,
        reconciledDescriptions: reviewSelector.reconciledDescriptions,
        matchesReportQuery,
        stationCovariances,
        relativeCovariances,
        relativePrecisionRows,
        isPreanalysis,
      }),
    [
      isPreanalysis,
      matchesReportQuery,
      relativeCovariances,
      relativePrecisionRows,
      result,
      reviewSelector.reconciledDescriptions,
      stationCovariances,
    ],
  );
  const prismAnnotation = useCallback(
    (obs: Observation) => formatPrismAnnotation(obs, unitScale, units),
    [unitScale, units],
  );
  const summarySelector = useMemo(
    () =>
      buildReportSummarySelectorModel({
        sortedObs,
        suspectImpactDiagnostics,
        excludedIds,
        setupDiagnostics,
        typeSummary: result.typeSummary ?? {},
        filteredStationCovariances: precisionSelector.filteredStationCovariances,
        filteredRelativeCovariances: precisionSelector.filteredRelativeCovariances,
        filteredRelativePrecision: precisionSelector.filteredRelativePrecision,
        gpsOffsetObservations: reviewSelector.gpsOffsetObservations,
      }),
    [
      excludedIds,
      precisionSelector.filteredRelativeCovariances,
      precisionSelector.filteredRelativePrecision,
      precisionSelector.filteredStationCovariances,
      result.typeSummary,
      reviewSelector.gpsOffsetObservations,
      setupDiagnostics,
      sortedObs,
      suspectImpactDiagnostics,
    ],
  );
  const windowedRows = useMemo(
    () =>
      buildReportWindowedRowsModel({
        visibleRowsFor,
        traverseLoopSuspects: observationSelector.traverseLoopSuspects,
        gpsLoopSuspects: observationSelector.gpsLoopSuspects,
        levelingLoopSuspects: observationSelector.levelingLoopSuspects,
        directionRejects: observationSelector.directionRejects,
        filteredStationCovariances: precisionSelector.filteredStationCovariances,
        filteredRelativeCovariances: precisionSelector.filteredRelativeCovariances,
        filteredRelativePrecision: precisionSelector.filteredRelativePrecision,
      }),
    [
      observationSelector.directionRejects,
      observationSelector.gpsLoopSuspects,
      observationSelector.levelingLoopSuspects,
      observationSelector.traverseLoopSuspects,
      precisionSelector.filteredRelativeCovariances,
      precisionSelector.filteredRelativePrecision,
      precisionSelector.filteredStationCovariances,
      visibleRowsFor,
    ],
  );
  const formatMdb = useCallback(
    (value: number, angular: boolean) => reportFormatMdb(value, angular, unitScale),
    [unitScale],
  );
  const formatEffectiveDistance = useCallback(
    (value?: number) => reportFormatEffectiveDistance(value, unitScale),
    [unitScale],
  );
  const stationTypeBadge = useCallback(
    (station: Station) => buildStationTypeBadge(station, result.parseState?.coordMode),
    [result.parseState?.coordMode],
  );
  const observationValueLabel = useCallback(
    (obs: Observation) => getObservationValueLabel(obs, unitScale),
    [unitScale],
  );
  const fixedSigmaLabel = useCallback(
    (obs: Observation) => getFixedSigmaLabel(obs, unitScale, units),
    [unitScale, units],
  );

  return {
    ...observationSelector,
    ...reviewSelector,
    ...precisionSelector,
    ...summarySelector,
    ...windowedRows,
    activePreanalysisScenarioIds,
    autoAdjustDiagnostics: result.autoAdjustDiagnostics,
    autoSideshotDiagnostics: result.autoSideshotDiagnostics,
    byType,
    clusterDiagnostics: result.clusterDiagnostics,
    clusterRevertDisabledReason:
      result.clusterDiagnostics?.enabled === true
        ? 'No applied cluster merges to revert in this run.'
        : 'Cluster detection is disabled for this run profile.',
    formatEffectiveDistance,
    formatMdb,
    formatReductionUsage,
    fixedSigmaLabel,
    gpsLoopDiagnostics,
    isRegularAdjustment,
    isSpecialRunMode,
    levelingLoopDiagnostics,
    observationStationsLabel: getObservationStationsLabel,
    observationValueLabel,
    observationWeightLabel: getObservationWeightLabel,
    preanalysisImpactDiagnostics: result.preanalysisImpactDiagnostics,
    preanalysisLabelTooltip: getPreanalysisLabelTooltip,
    prismAnnotation,
    relativeCovariances,
    setupDiagnostics,
    showAutoSideshotDiagnosticsSection:
      !isSpecialRunMode &&
      result.autoSideshotDiagnostics?.enabled === true &&
      (result.autoSideshotDiagnostics?.candidates.length ?? 0) > 0,
    showClusterMergeRevert: true,
    showLevelingLoopDiagnosticsSection:
      !isPreanalysis &&
      !isDataCheck &&
      (levelingLoopDiagnostics?.enabled ?? false) &&
      (levelingLoopDiagnostics?.loops.length ?? 0) > 0,
    showTsCorrelationDiagnosticsSection:
      result.tsCorrelationDiagnostics?.enabled === true &&
      (result.tsCorrelationDiagnostics?.equationCount ?? 0) > 0,
    sortedObs,
    stationCovariances,
    stationDescription,
    stationTypeBadge,
    suspectImpactDiagnostics,
    traverseLoops,
    weakGeometryDiagnostics: result.weakGeometryDiagnostics,
  };
};
