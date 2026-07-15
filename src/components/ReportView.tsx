import React, { useCallback, useEffect, useMemo, useRef } from 'react';
import type { AdjustmentResult, Observation, RunMode, Station } from '../types';
import type { ReportViewProps } from './ReportView.types';
import {
  getRelativeCovarianceRows,
  getRelativePrecisionRows,
  getStationCovarianceRows,
} from '../engine/resultPrecision';
import {
  RelativeCovariancesSection,
  StationCovariancesSection,
  WeakGeometryCuesSection,
} from './report/ReportPrecisionSections';
import { ObservationResidualsSummarySections } from './report/ReportResidualSummarySections';
import {
  LockedPlannedObservationsSection,
  PreanalysisPlanningSummarySection,
  PreanalysisRecommendationsSection,
} from './report/ReportPreanalysisSections';
import ReportClosingSections from './report/ReportClosingSections';
import { sortObservationsByStdRes, type SortedObservation } from '../engine/resultDerivedModels';
import DirectionDiagnosticsSections from './report/DirectionDiagnosticsSections';
import PinnedSectionsPanel from './report/PinnedSectionsPanel';
import LoopDiagnosticsSections from './report/LoopDiagnosticsSections';
import ReportDiagnosticsSections from './report/ReportDiagnosticsSections';
import { GpsRoverOffsetsPanel, SetupDiagnosticsPanel } from './report/ReportDiagnosticPanels';
import {
  AdjustmentSummarySection,
  BlunderDetectSummarySection,
  DataCheckSummarySection,
  PendingRunSettingsDiffBanner,
} from './report/ReportRunSummarySections';
import { ReportSuspectImpactSection } from './report/ReportSuspectImpactSection';
import ReportReviewWorkflowSections from './report/ReportReviewWorkflowSections';
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
} from './report/reportFormatters';
import ReportToolbar from './report/ReportToolbar';
import { REPORT_STATIC_TOOLTIPS } from './report/reportTooltips';
import { REPORT_DIAGNOSTIC_WINDOW_SIZE, type CollapsibleDetailSectionId } from './report/reportSectionRegistry';
import SolveProfileDiagnosticsSection from './report/SolveProfileDiagnosticsSection';
import {
  ObservationTypeTables,
  PostAdjustedSideshotSections,
  ReportFilterAndCoordinatesSections,
} from './report/ReportObservationWorkflowSections';
import { useReportRenderHelpers } from './report/useReportRenderHelpers';
import { buildReportObservationSelectorModel } from './report/reportObservationSelectors';
import { buildReportPrecisionSelectorModel } from './report/reportPrecisionSelectors';
import { buildReportReviewSelectorModel } from './report/reportReviewSelectors';
import { buildReportSummarySelectorModel } from './report/reportSummarySelectors';
import { buildReportWindowedRowsModel } from './report/reportWindowedRows';
import { useReportViewState } from '../hooks/useReportViewState';
import { noteUiPerfStage, noteUiTabReady } from '../hooks/useUiPerfMonitor';

const FT_PER_M = 3.280839895;
const EMPTY_SUSPECT_IMPACT_DIAGNOSTICS: NonNullable<AdjustmentResult['suspectImpactDiagnostics']> =
  [];
const EMPTY_SETUP_DIAGNOSTICS: NonNullable<AdjustmentResult['setupDiagnostics']> = [];

const ReportView: React.FC<ReportViewProps> = ({
  result,
  units,
  viewState,
  runDiagnostics,
  excludedIds,
  onToggleExclude,
  onApplyImpactExclude,
  onApplyPreanalysisAction,
  onApplyAllPreanalysisActions = () => undefined,
  onReRun,
  onClearExclusions,
  overrides: _overrides,
  onOverride: _onOverride,
  onResetOverrides,
  clusterReviewDecisions,
  activeClusterApprovedMerges,
  onClusterDecisionStatus,
  onClusterCanonicalSelection,
  onApplyClusterMerges,
  onResetClusterReview,
  onClearClusterMerges,
  onJumpToSourceLine,
  pendingRunSettingDiffs = [],
  selectedStationId = null,
  selectedObservationId = null,
  onSelectStation,
  onSelectObservation,
  focusFilterRequestKey = 0,
  precisionReportingMode = 'industry-standard',
}) => {
  const reportRootRef = useRef<HTMLDivElement | null>(null);
  const detailSectionHeaderRefs = useRef<
    Partial<Record<CollapsibleDetailSectionId, HTMLDivElement | null>>
  >({});
  const unitScale = units === 'ft' ? FT_PER_M : 1;
  const ellipseUnit = units === 'm' ? 'cm' : 'in';
  const ellipseScale = units === 'm' ? 100 : 12;
  const covarianceScale = unitScale * unitScale;
  const isPreanalysis = result.preanalysisMode === true;
  const runMode: RunMode =
    result.parseState?.runMode ??
    runDiagnostics?.runMode ??
    (isPreanalysis ? 'preanalysis' : 'adjustment');
  const isDataCheck = runMode === 'data-check';
  const isBlunderDetect = runMode === 'blunder-detect';
  const isRegularAdjustment = runMode === 'adjustment';
  const isSpecialRunMode = isDataCheck || isBlunderDetect;
  const localViewState = useReportViewState({
    result,
    excludedIds,
  });
  useEffect(() => {
    noteUiPerfStage('reportReady');
    noteUiTabReady('report');
  }, [result]);
  const {
    ellipseMode,
    setEllipseMode,
    ellipseConfidenceScale,
    reportFilterQuery,
    setReportFilterQuery,
    reportObservationTypeFilter,
    setReportObservationTypeFilter,
    reportExclusionFilter,
    setReportExclusionFilter,
    reviewConflictOnly,
    setReviewConflictOnly,
    reviewAdjustedOnly,
    setReviewAdjustedOnly,
    reviewImportedGroupFilter,
    setReviewImportedGroupFilter,
    clearFilters,
    deferredReportFilterQuery,
    normalizedReportFilterQuery,
    pinnedDetailSections,
    clearPinnedDetailSections,
    isDetailSectionPinned,
    togglePinnedDetailSection,
    isSectionCollapsed,
    toggleDetailSection,
    allDetailSectionsCollapsed,
    setAllDetailSectionsCollapsed,
    visibleRowsFor,
    showMoreRows,
    showAllRows,
  } = viewState ?? localViewState;
  const rowSelectionClass = useCallback(
    (selected: boolean) =>
      selected
        ? 'bg-cyan-950/30 ring-1 ring-inset ring-cyan-500/60'
        : 'hover:bg-slate-900/50 transition-colors',
    [],
  );
  const normalizeSearchText = useCallback(
    (...parts: Array<string | number | null | undefined>): string =>
      parts
        .filter((part) => part != null && `${part}`.trim() !== '')
        .join(' ')
        .toLowerCase(),
    [],
  );
  const matchesReportQuery = useCallback(
    (...parts: Array<string | number | null | undefined>): boolean =>
      normalizedReportFilterQuery === '' ||
      normalizeSearchText(...parts).includes(normalizedReportFilterQuery),
    [normalizeSearchText, normalizedReportFilterQuery],
  );
  const jumpToPinnedSection = (id: CollapsibleDetailSectionId) => {
    const target = detailSectionHeaderRefs.current[id];
    if (!target) return;
    if (isSectionCollapsed(id)) {
      toggleDetailSection(id);
    }
    target.scrollIntoView({ block: 'start', behavior: 'smooth' });
  };

  const sortedObs = useMemo<SortedObservation[]>(
    () => sortObservationsByStdRes(result.observations),
    [result.observations],
  );
  const suspectImpactDiagnostics =
    result.suspectImpactDiagnostics ?? EMPTY_SUSPECT_IMPACT_DIAGNOSTICS;
  const setupDiagnostics = result.setupDiagnostics ?? EMPTY_SETUP_DIAGNOSTICS;
  const {
    directionSetCount,
    filteredSortedObs,
    importedGroupOptions,
    observationsByType,
    dataCheckDiffRows,
    blunderCycleLines,
    blunderFlaggedCount,
    topDirectionTargetSuspects,
    topDirectionRepeatabilitySuspects,
    traverseLoopSuspects,
    gpsLoopSuspects,
    levelingLoopSuspects,
    levelingSegmentSuspects,
    highlightedLevelingSegmentLines,
    directionRejects,
    directionTreatmentDiagnostics,
  } = useMemo(
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
    observationsByType.get(type) ?? [];
  const traverseLoops = result.traverseDiagnostics?.loops ?? [];
  const gpsLoopDiagnostics = result.gpsLoopDiagnostics;
  const levelingLoopDiagnostics = result.levelingLoopDiagnostics;
  const {
    aliasTrace,
    descriptionScanSummary,
    descriptionConflicts,
    descriptionRefsByStation,
    lostStationIds,
    descriptionReconcileMode,
    descriptionAppendDelimiter,
    reconciledDescriptions,
    clusterCandidates,
    clusterAppliedMerges,
    clusterMergeOutcomes,
    clusterRejectedProposals,
    clusterReviewStats,
    autoSideshotObsIds,
    tsSideshots,
    gpsSideshots,
    gpsVectorSideshots,
    gpsCoordinateSideshots,
    gpsOffsetObservations,
  } = useMemo(
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
  const clusterDiagnostics = result.clusterDiagnostics;
  const autoAdjustDiagnostics = result.autoAdjustDiagnostics;
  const autoSideshotDiagnostics = result.autoSideshotDiagnostics;
  const stationDescription = (stationId: string): string =>
    reconciledDescriptions[stationId] ?? '-';
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
  const weakGeometryDiagnostics = result.weakGeometryDiagnostics;
  const preanalysisImpactDiagnostics = result.preanalysisImpactDiagnostics;
  const activePreanalysisScenarioIds = useMemo(
    () => new Set(result.preanalysisSyntheticAdditionIds ?? []),
    [result.preanalysisSyntheticAdditionIds],
  );
  const {
    filteredStationRows,
    filteredStationCovariances,
    filteredRelativeCovariances,
    filteredRelativePrecision,
    lockedPreanalysisObservations,
    flaggedStationCues,
    flaggedRelativeCues,
  } = useMemo(
    () =>
      buildReportPrecisionSelectorModel({
        result,
        reconciledDescriptions,
        matchesReportQuery,
        stationCovariances,
        relativeCovariances,
        relativePrecisionRows,
        isPreanalysis,
      }),
    [
      isPreanalysis,
      matchesReportQuery,
      reconciledDescriptions,
      relativeCovariances,
      relativePrecisionRows,
      result,
      stationCovariances,
    ],
  );
  const prismAnnotation = useCallback(
    (obs: Observation) => formatPrismAnnotation(obs, unitScale, units),
    [unitScale, units],
  );
  const {
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
    topStationCovarianceRow,
    topRelativeCovarianceRow,
    topRelativePrecisionRow,
    topGpsOffsetObservation,
  } = useMemo(
    () =>
      buildReportSummarySelectorModel({
        sortedObs,
        suspectImpactDiagnostics,
        excludedIds,
        setupDiagnostics,
        typeSummary: result.typeSummary ?? {},
        filteredStationCovariances,
        filteredRelativeCovariances,
        filteredRelativePrecision,
        gpsOffsetObservations,
      }),
    [
      excludedIds,
      filteredRelativeCovariances,
      filteredRelativePrecision,
      filteredStationCovariances,
      gpsOffsetObservations,
      result.typeSummary,
      setupDiagnostics,
      sortedObs,
      suspectImpactDiagnostics,
    ],
  );
  const {
    visibleTraverseLoopSuspects,
    visibleGpsLoopSuspects,
    visibleLevelingLoopSuspects,
    visibleDirectionRejects,
    visibleStationCovariances,
    visibleRelativeCovariances,
    visibleRelativePrecision,
  } = useMemo(
    () =>
      buildReportWindowedRowsModel({
        visibleRowsFor,
        traverseLoopSuspects,
        gpsLoopSuspects,
        levelingLoopSuspects,
        directionRejects,
        filteredStationCovariances,
        filteredRelativeCovariances,
        filteredRelativePrecision,
      }),
    [
      directionRejects,
      filteredRelativeCovariances,
      filteredRelativePrecision,
      filteredStationCovariances,
      gpsLoopSuspects,
      levelingLoopSuspects,
      traverseLoopSuspects,
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
  const preanalysisLabelTooltip = getPreanalysisLabelTooltip;
  const observationStationsLabel = getObservationStationsLabel;
  const observationValueLabel = useCallback(
    (obs: Observation) => getObservationValueLabel(obs, unitScale),
    [unitScale],
  );
  const fixedSigmaLabel = useCallback(
    (obs: Observation) => getFixedSigmaLabel(obs, unitScale, units),
    [unitScale, units],
  );
  const observationWeightLabel = getObservationWeightLabel;
  const registerDetailSectionHeader = useCallback(
    (id: CollapsibleDetailSectionId, node: HTMLDivElement | null) => {
      detailSectionHeaderRefs.current[id] = node;
    },
    [],
  );
  const {
    renderCollapsibleSectionHeader,
    renderLoadMoreFooter,
    renderSourceLineLink,
  } = useReportRenderHelpers({
    isDetailSectionPinned,
    isSectionCollapsed,
    onJumpToSourceLine,
    registerDetailSectionHeader,
    reportRootRef,
    showAllRows,
    showMoreRows,
    toggleDetailSection,
    togglePinnedDetailSection,
  });

  const showClusterMergeRevert = true;
  const clusterRevertDisabledReason =
    clusterDiagnostics?.enabled === true
      ? 'No applied cluster merges to revert in this run.'
      : 'Cluster detection is disabled for this run profile.';
  const showTsCorrelationDiagnosticsSection =
    result.tsCorrelationDiagnostics?.enabled === true &&
    (result.tsCorrelationDiagnostics?.equationCount ?? 0) > 0;
  const showAutoSideshotDiagnosticsSection =
    !isSpecialRunMode &&
    autoSideshotDiagnostics?.enabled === true &&
    (autoSideshotDiagnostics?.candidates.length ?? 0) > 0;
  const showLevelingLoopDiagnosticsSection =
    !isPreanalysis &&
    !isDataCheck &&
    (levelingLoopDiagnostics?.enabled ?? false) &&
    (levelingLoopDiagnostics?.loops.length ?? 0) > 0;
  return (
    <div ref={reportRootRef} className="report-view p-6 font-mono text-sm w-full flex flex-col">
      <ReportToolbar
        onReRun={onReRun}
        onToggleCollapseAll={() => setAllDetailSectionsCollapsed(!allDetailSectionsCollapsed)}
        allDetailSectionsCollapsed={allDetailSectionsCollapsed}
        onClearExclusions={onClearExclusions}
        onResetOverrides={onResetOverrides}
        showClusterMergeRevert={showClusterMergeRevert}
        clusterAppliedMergeCount={clusterAppliedMerges.length}
        clusterRevertDisabledReason={clusterRevertDisabledReason}
        onClearClusterMerges={onClearClusterMerges}
        unitScale={unitScale}
        units={units}
      />

      <PendingRunSettingsDiffBanner pendingRunSettingDiffs={pendingRunSettingDiffs} />

      <PinnedSectionsPanel
        pinnedDetailSections={pinnedDetailSections}
        onClearPins={clearPinnedDetailSections}
        onJumpToPinnedSection={jumpToPinnedSection}
      />

      <ReportSuspectImpactSection
        excludedIds={excludedIds}
        isDetailSectionPinned={isDetailSectionPinned}
        isPreanalysis={isPreanalysis}
        isSectionCollapsed={isSectionCollapsed}
        isSpecialRunMode={isSpecialRunMode}
        onApplyImpactExclude={onApplyImpactExclude}
        onHeaderRef={registerDetailSectionHeader}
        renderSourceLineLink={renderSourceLineLink}
        suspectImpactActionableCount={suspectImpactActionableCount}
        suspectImpactDiagnostics={suspectImpactDiagnostics}
        suspectImpactExcludedCount={suspectImpactExcludedCount}
        suspectImpactWorstBaseStdRes={suspectImpactWorstBaseStdRes}
        toggleDetailSection={toggleDetailSection}
        togglePinnedDetailSection={togglePinnedDetailSection}
        unitScale={unitScale}
        units={units}
      />

      <AdjustmentSummarySection
        byType={byType}
        isPreanalysis={isPreanalysis}
        isSpecialRunMode={isSpecialRunMode}
        result={result}
      />

      <DataCheckSummarySection
        dataCheckDiffRows={dataCheckDiffRows}
        directionSetCount={directionSetCount}
        isDataCheck={isDataCheck}
        maxAbsStdRes={maxAbsStdRes}
        renderSourceLineLink={renderSourceLineLink}
        result={result}
      />

      <BlunderDetectSummarySection
        blunderCycleLines={blunderCycleLines}
        blunderFlaggedCount={blunderFlaggedCount}
        isBlunderDetect={isBlunderDetect}
        maxAbsStdRes={maxAbsStdRes}
        result={result}
      />

      {runDiagnostics ? (
        <SolveProfileDiagnosticsSection
          runDiagnostics={runDiagnostics}
          runMode={runMode}
          units={units}
          unitScale={unitScale}
          lostStationIds={lostStationIds}
          descriptionReconcileMode={descriptionReconcileMode}
          descriptionAppendDelimiter={descriptionAppendDelimiter}
          reportStaticTooltips={REPORT_STATIC_TOOLTIPS}
          sectionId="solve-profile-diagnostics"
          collapsed={isSectionCollapsed('solve-profile-diagnostics')}
          pinned={isDetailSectionPinned('solve-profile-diagnostics')}
          onToggleCollapse={toggleDetailSection}
          onTogglePin={togglePinnedDetailSection}
          onHeaderRef={registerDetailSectionHeader}
          formatReductionUsage={formatReductionUsage}
        />
      ) : null}

      <PreanalysisPlanningSummarySection
        flaggedRelativeCueCount={flaggedRelativeCues.length}
        flaggedStationCueCount={flaggedStationCues.length}
        isPreanalysis={isPreanalysis}
        lockedPreanalysisObservationCount={lockedPreanalysisObservations.length}
        parseState={result.parseState}
        preanalysisLabelTooltip={preanalysisLabelTooltip}
        relativeCovarianceCount={relativeCovariances.length}
        stationCovarianceCount={stationCovariances.length}
      />

      <LockedPlannedObservationsSection
        fixedSigmaLabel={fixedSigmaLabel}
        isDetailSectionPinned={isDetailSectionPinned}
        isPreanalysis={isPreanalysis}
        isSectionCollapsed={isSectionCollapsed}
        lockedPreanalysisObservations={lockedPreanalysisObservations}
        observationStationsLabel={observationStationsLabel}
        observationValueLabel={observationValueLabel}
        onHeaderRef={registerDetailSectionHeader}
        preanalysisLabelTooltip={preanalysisLabelTooltip}
        renderSourceLineLink={renderSourceLineLink}
        toggleDetailSection={toggleDetailSection}
        togglePinnedDetailSection={togglePinnedDetailSection}
      />

      <PreanalysisRecommendationsSection
        activePreanalysisScenarioIds={activePreanalysisScenarioIds}
        isDetailSectionPinned={isDetailSectionPinned}
        isPreanalysis={isPreanalysis}
        isSectionCollapsed={isSectionCollapsed}
        onApplyAllPreanalysisActions={onApplyAllPreanalysisActions}
        onApplyPreanalysisAction={onApplyPreanalysisAction}
        onHeaderRef={registerDetailSectionHeader}
        preanalysisImpactDiagnostics={preanalysisImpactDiagnostics}
        preanalysisLabelTooltip={preanalysisLabelTooltip}
        renderSourceLineLink={renderSourceLineLink}
        toggleDetailSection={toggleDetailSection}
        togglePinnedDetailSection={togglePinnedDetailSection}
        unitScale={unitScale}
        units={units}
      />

      <ReportReviewWorkflowSections
        activeClusterProps={{
          clusterAppliedMerges,
          clusterCandidates,
          clusterDiagnostics,
          clusterMergeOutcomes,
          clusterRejectedProposals,
          clusterReviewDecisions,
          clusterReviewStats,
          onApplyClusterMerges,
          onClearClusterMerges,
          onClusterCanonicalSelection,
          onClusterDecisionStatus,
          onResetClusterReview,
        }}
        aliasTrace={aliasTrace}
        autoAdjustDiagnostics={autoAdjustDiagnostics}
        autoSideshotDiagnostics={autoSideshotDiagnostics}
        descriptionAppendDelimiter={descriptionAppendDelimiter}
        descriptionConflicts={descriptionConflicts}
        descriptionReconcileMode={descriptionReconcileMode}
        descriptionRefsByStation={descriptionRefsByStation}
        descriptionScanSummary={descriptionScanSummary}
        isDetailSectionPinned={isDetailSectionPinned}
        isSectionCollapsed={isSectionCollapsed}
        isSpecialRunMode={isSpecialRunMode}
        onHeaderRef={registerDetailSectionHeader}
        parseState={result.parseState}
        renderSourceLineLink={renderSourceLineLink}
        showAutoSideshotDiagnosticsSection={showAutoSideshotDiagnosticsSection}
        toggleDetailSection={toggleDetailSection}
        togglePinnedDetailSection={togglePinnedDetailSection}
        unitScale={unitScale}
        units={units}
      />

      <ReportDiagnosticsSections
        result={result}
        isPreanalysis={isPreanalysis}
        isDataCheck={isDataCheck}
        isSpecialRunMode={isSpecialRunMode}
        showTsCorrelationDiagnosticsSection={showTsCorrelationDiagnosticsSection}
        renderCollapsibleSectionHeader={renderCollapsibleSectionHeader}
        isSectionCollapsed={isSectionCollapsed}
        renderSourceLineLink={renderSourceLineLink}
      />

      <LoopDiagnosticsSections
        result={result}
        units={units}
        unitScale={unitScale}
        isPreanalysis={isPreanalysis}
        isDataCheck={isDataCheck}
        showLevelingLoopDiagnosticsSection={showLevelingLoopDiagnosticsSection}
        traverseLoops={traverseLoops}
        traverseLoopSuspects={traverseLoopSuspects}
        visibleTraverseLoopSuspects={visibleTraverseLoopSuspects}
        gpsLoopSuspects={gpsLoopSuspects}
        visibleGpsLoopSuspects={visibleGpsLoopSuspects}
        levelingLoopSuspects={levelingLoopSuspects}
        visibleLevelingLoopSuspects={visibleLevelingLoopSuspects}
        levelingSegmentSuspects={levelingSegmentSuspects}
        highlightedLevelingSegmentLines={highlightedLevelingSegmentLines}
        gpsLoopDiagnostics={gpsLoopDiagnostics}
        levelingLoopDiagnostics={levelingLoopDiagnostics}
        renderCollapsibleSectionHeader={renderCollapsibleSectionHeader}
        isSectionCollapsed={isSectionCollapsed}
        renderLoadMoreFooter={renderLoadMoreFooter}
        renderSourceLineLink={renderSourceLineLink}
      />

        <DirectionDiagnosticsSections
          result={result}
          isPreanalysis={isPreanalysis}
          isDataCheck={isDataCheck}
        directionTreatmentDiagnostics={directionTreatmentDiagnostics}
        directionRejects={directionRejects}
        visibleDirectionRejects={visibleDirectionRejects}
        topDirectionTargetSuspects={topDirectionTargetSuspects}
        topDirectionRepeatabilitySuspects={topDirectionRepeatabilitySuspects}
          renderCollapsibleSectionHeader={renderCollapsibleSectionHeader}
          isSectionCollapsed={isSectionCollapsed}
          renderLoadMoreFooter={renderLoadMoreFooter}
          renderSourceLineLink={renderSourceLineLink}
          showFaceTreatmentSection={false}
        />

      <SetupDiagnosticsPanel
        isDataCheck={isDataCheck}
        isDetailSectionPinned={isDetailSectionPinned}
        isPreanalysis={isPreanalysis}
        isSectionCollapsed={isSectionCollapsed}
        onHeaderRef={registerDetailSectionHeader}
        setupDiagnostics={setupDiagnostics}
        setupLocalFailCount={setupLocalFailCount}
        setupObsCount={setupObsCount}
        setupWorstStdRes={setupWorstStdRes}
        toggleDetailSection={toggleDetailSection}
        togglePinnedDetailSection={togglePinnedDetailSection}
        unitScale={unitScale}
        units={units}
      />

      <PostAdjustedSideshotSections
        gpsCoordinateSideshots={gpsCoordinateSideshots}
        gpsSideshots={gpsSideshots}
        gpsVectorSideshots={gpsVectorSideshots}
        isDataCheck={isDataCheck}
        isDetailSectionPinned={isDetailSectionPinned}
        isSectionCollapsed={isSectionCollapsed}
        onHeaderRef={registerDetailSectionHeader}
        renderSourceLineLink={renderSourceLineLink}
        toggleDetailSection={toggleDetailSection}
        togglePinnedDetailSection={togglePinnedDetailSection}
        tsSideshots={tsSideshots}
        unitScale={unitScale}
        units={units}
      />

      <GpsRoverOffsetsPanel
        gpsOffsetObservations={gpsOffsetObservations}
        isDataCheck={isDataCheck}
        isDetailSectionPinned={isDetailSectionPinned}
        isSectionCollapsed={isSectionCollapsed}
        onHeaderRef={registerDetailSectionHeader}
        renderSourceLineLink={renderSourceLineLink}
        topGpsOffsetObservation={topGpsOffsetObservation}
        toggleDetailSection={toggleDetailSection}
        togglePinnedDetailSection={togglePinnedDetailSection}
        unitScale={unitScale}
        units={units}
      />

      <ReportFilterAndCoordinatesSections
        clearFilters={clearFilters}
        deferredReportFilterQuery={deferredReportFilterQuery}
        ellipseConfidenceScale={ellipseConfidenceScale}
        ellipseMode={ellipseMode}
        ellipseScale={ellipseScale}
        ellipseUnit={ellipseUnit}
        filteredObservationCount={filteredSortedObs.length}
        filteredStationRows={filteredStationRows}
        focusFilterRequestKey={focusFilterRequestKey}
        importedGroupOptions={importedGroupOptions}
        isDataCheck={isDataCheck}
        isPreanalysis={isPreanalysis}
        isSectionCollapsed={isSectionCollapsed}
        normalizedReportFilterQuery={normalizedReportFilterQuery}
        onEllipseModeChange={setEllipseMode}
        onReportExclusionFilterChange={setReportExclusionFilter}
        onReportFilterQueryChange={setReportFilterQuery}
        onReportObservationTypeFilterChange={setReportObservationTypeFilter}
        onReviewAdjustedOnlyChange={setReviewAdjustedOnly}
        onReviewConflictOnlyChange={setReviewConflictOnly}
        onReviewImportedGroupFilterChange={setReviewImportedGroupFilter}
        onSelectStation={onSelectStation}
        renderLoadMoreFooter={renderLoadMoreFooter}
        reportExclusionFilter={reportExclusionFilter}
        reportFilterQuery={reportFilterQuery}
        reportObservationTypeFilter={reportObservationTypeFilter}
        reviewAdjustedOnly={reviewAdjustedOnly}
        reviewConflictOnly={reviewConflictOnly}
        reviewImportedGroupFilter={reviewImportedGroupFilter}
        rowSelectionClass={rowSelectionClass}
        selectedStationId={selectedStationId}
        sortedObservationCount={sortedObs.length}
        stationDescription={stationDescription}
        stationTypeBadge={stationTypeBadge}
        toggleDetailSection={toggleDetailSection}
        unitScale={unitScale}
        units={units}
        visibleRowsFor={visibleRowsFor}
      />

      <StationCovariancesSection
        covarianceScale={covarianceScale}
        filteredStationCovariances={filteredStationCovariances}
        isDetailSectionPinned={isDetailSectionPinned}
        isPreanalysis={isPreanalysis}
        isSectionCollapsed={isSectionCollapsed}
        onHeaderRef={registerDetailSectionHeader}
        parseState={result.parseState}
        preanalysisLabelTooltip={preanalysisLabelTooltip}
        renderLoadMoreFooter={renderLoadMoreFooter}
        toggleDetailSection={toggleDetailSection}
        togglePinnedDetailSection={togglePinnedDetailSection}
        topStationCovarianceRow={topStationCovarianceRow}
        units={units}
        visibleStationCovariances={visibleStationCovariances}
      />

      <RelativeCovariancesSection
        covarianceScale={covarianceScale}
        filteredRelativeCovariances={filteredRelativeCovariances}
        isDetailSectionPinned={isDetailSectionPinned}
        isPreanalysis={isPreanalysis}
        isSectionCollapsed={isSectionCollapsed}
        onHeaderRef={registerDetailSectionHeader}
        preanalysisLabelTooltip={preanalysisLabelTooltip}
        renderLoadMoreFooter={renderLoadMoreFooter}
        toggleDetailSection={toggleDetailSection}
        togglePinnedDetailSection={togglePinnedDetailSection}
        topRelativeCovarianceRow={topRelativeCovarianceRow}
        unitScale={unitScale}
        visibleRelativeCovariances={visibleRelativeCovariances}
      />

      <WeakGeometryCuesSection
        flaggedRelativeCues={flaggedRelativeCues}
        flaggedStationCues={flaggedStationCues}
        isDetailSectionPinned={isDetailSectionPinned}
        isPreanalysis={isPreanalysis}
        isSectionCollapsed={isSectionCollapsed}
        onHeaderRef={registerDetailSectionHeader}
        preanalysisLabelTooltip={preanalysisLabelTooltip}
        toggleDetailSection={toggleDetailSection}
        togglePinnedDetailSection={togglePinnedDetailSection}
        unitScale={unitScale}
        units={units}
        weakGeometryDiagnostics={weakGeometryDiagnostics}
      />

      <ObservationResidualsSummarySections
        allDetailSectionsCollapsed={allDetailSectionsCollapsed}
        ellipseConfidenceScale={ellipseConfidenceScale}
        ellipseScale={ellipseScale}
        ellipseUnit={ellipseUnit}
        filteredRelativePrecision={filteredRelativePrecision}
        isDataCheck={isDataCheck}
        isDetailSectionPinned={isDetailSectionPinned}
        isPreanalysis={isPreanalysis}
        isSectionCollapsed={isSectionCollapsed}
        onHeaderRef={registerDetailSectionHeader}
        renderLoadMoreFooter={renderLoadMoreFooter}
        toggleDetailSection={toggleDetailSection}
        togglePinnedDetailSection={togglePinnedDetailSection}
        topRelativePrecisionRow={topRelativePrecisionRow}
        topTypeSummaryEntry={topTypeSummaryEntry}
        typeSummaryEntries={typeSummaryEntries}
        typeSummaryObsCount={typeSummaryObsCount}
        unitScale={unitScale}
        units={units}
        visibleRelativePrecision={visibleRelativePrecision}
      >
        <ObservationTypeTables
          autoSideshotObsIds={autoSideshotObsIds}
          byType={byType}
          excludedIds={excludedIds}
          formatEffectiveDistance={formatEffectiveDistance}
          formatMdb={formatMdb}
          isDetailSectionPinned={isDetailSectionPinned}
          isSectionCollapsed={isSectionCollapsed}
          observationWeightLabel={observationWeightLabel}
          onHeaderRef={registerDetailSectionHeader}
          onSelectObservation={onSelectObservation}
          onToggleExclude={onToggleExclude}
          prismAnnotation={prismAnnotation}
          renderSourceLineLink={renderSourceLineLink}
          rowSelectionClass={rowSelectionClass}
          selectedObservationId={selectedObservationId}
          showAllRows={showAllRows}
          showMoreRows={showMoreRows}
          toggleDetailSection={toggleDetailSection}
          togglePinnedDetailSection={togglePinnedDetailSection}
          unitScale={unitScale}
          units={units}
          visibleRowsFor={visibleRowsFor}
        />
      </ObservationResidualsSummarySections>

        <ReportClosingSections
          directionTreatmentDiagnostics={directionTreatmentDiagnostics}
          isDataCheck={isDataCheck}
          isDetailSectionPinned={isDetailSectionPinned}
          isPreanalysis={isPreanalysis}
          isRegularAdjustment={isRegularAdjustment}
          isSectionCollapsed={isSectionCollapsed}
          logs={result.logs}
          onHeaderRef={registerDetailSectionHeader}
          renderCollapsibleSectionHeader={renderCollapsibleSectionHeader}
          renderSourceLineLink={renderSourceLineLink}
          toggleDetailSection={toggleDetailSection}
          togglePinnedDetailSection={togglePinnedDetailSection}
        />
    </div>
  );
};

export default ReportView;

