import React, { useCallback, useEffect, useRef } from 'react';
import type { Observation, RunMode } from '../types';
import type { ReportViewProps } from './ReportView.types';
import { REPORT_DIAGNOSTIC_WINDOW_SIZE, type CollapsibleDetailSectionId } from './report/reportSectionRegistry';
import ReportViewTopSections from './report/ReportViewTopSections';
import ReportViewDiagnosticsBand from './report/ReportViewDiagnosticsBand';
import ReportViewPrecisionResidualsBand from './report/ReportViewPrecisionResidualsBand';
import { useReportRenderHelpers } from './report/useReportRenderHelpers';
import { useReportViewModel } from './report/useReportViewModel';
import { useReportViewState } from '../hooks/useReportViewState';
import { noteUiPerfStage, noteUiTabReady } from '../hooks/useUiPerfMonitor';

const FT_PER_M = 3.280839895;

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

  const reportModel = useReportViewModel({
    activeClusterApprovedMerges, clusterReviewDecisions, excludedIds, isBlunderDetect,
    isDataCheck, isPreanalysis, isRegularAdjustment, isSpecialRunMode, matchesReportQuery,
    precisionReportingMode, reportExclusionFilter, reportObservationTypeFilter, result,
    reviewAdjustedOnly, reviewConflictOnly, reviewImportedGroupFilter, unitScale, units, visibleRowsFor,
  });  const {
    activePreanalysisScenarioIds, aliasTrace, autoAdjustDiagnostics, autoSideshotDiagnostics, autoSideshotObsIds, blunderCycleLines,
    blunderFlaggedCount, byType, clusterAppliedMerges, clusterCandidates, clusterDiagnostics, clusterMergeOutcomes, clusterRejectedProposals,
    clusterRevertDisabledReason, clusterReviewStats, dataCheckDiffRows, descriptionAppendDelimiter, descriptionConflicts,
    descriptionReconcileMode, descriptionRefsByStation, descriptionScanSummary, directionRejects, directionSetCount, directionTreatmentDiagnostics,
    filteredRelativeCovariances, filteredRelativePrecision, filteredSortedObs, filteredStationCovariances, filteredStationRows, fixedSigmaLabel,
    flaggedRelativeCues, flaggedStationCues, formatEffectiveDistance, formatMdb, formatReductionUsage, gpsCoordinateSideshots, gpsLoopDiagnostics,
    gpsLoopSuspects, gpsOffsetObservations, gpsSideshots, gpsVectorSideshots, highlightedLevelingSegmentLines, importedGroupOptions,
    levelingLoopDiagnostics, levelingLoopSuspects, levelingSegmentSuspects, lockedPreanalysisObservations, lostStationIds, maxAbsStdRes,
    observationStationsLabel, observationValueLabel, observationWeightLabel, preanalysisImpactDiagnostics, preanalysisLabelTooltip, prismAnnotation,
    relativeCovariances, setupDiagnostics, setupLocalFailCount, setupObsCount, setupWorstStdRes, showAutoSideshotDiagnosticsSection,
    showClusterMergeRevert, showLevelingLoopDiagnosticsSection, showTsCorrelationDiagnosticsSection, sortedObs, stationCovariances,
    stationDescription, stationTypeBadge, suspectImpactActionableCount, suspectImpactDiagnostics, suspectImpactExcludedCount,
    suspectImpactWorstBaseStdRes, topDirectionRepeatabilitySuspects, topDirectionTargetSuspects, topGpsOffsetObservation,
    topRelativeCovarianceRow, topRelativePrecisionRow, topStationCovarianceRow, topTypeSummaryEntry, traverseLoops, traverseLoopSuspects,
    tsSideshots, typeSummaryEntries, typeSummaryObsCount, visibleDirectionRejects, visibleGpsLoopSuspects, visibleLevelingLoopSuspects,
    visibleRelativeCovariances, visibleRelativePrecision, visibleStationCovariances, visibleTraverseLoopSuspects, weakGeometryDiagnostics,
  } = reportModel;
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
  return (
    <div ref={reportRootRef} className="report-view p-6 font-mono text-sm w-full flex flex-col">
      <ReportViewTopSections
        activePreanalysisScenarioIds={activePreanalysisScenarioIds}
        allDetailSectionsCollapsed={allDetailSectionsCollapsed}
        blunderCycleLines={blunderCycleLines}
        blunderFlaggedCount={blunderFlaggedCount}
        byType={byType}
        clearPinnedDetailSections={clearPinnedDetailSections}
        clusterAppliedMergeCount={clusterAppliedMerges.length}
        clusterRevertDisabledReason={clusterRevertDisabledReason}
        dataCheckDiffRows={dataCheckDiffRows}
        descriptionAppendDelimiter={descriptionAppendDelimiter}
        descriptionReconcileMode={descriptionReconcileMode}
        directionSetCount={directionSetCount}
        excludedIds={excludedIds}
        fixedSigmaLabel={fixedSigmaLabel}
        flaggedRelativeCueCount={flaggedRelativeCues.length}
        flaggedStationCueCount={flaggedStationCues.length}
        formatReductionUsage={formatReductionUsage}
        isBlunderDetect={isBlunderDetect}
        isDataCheck={isDataCheck}
        isDetailSectionPinned={isDetailSectionPinned}
        isPreanalysis={isPreanalysis}
        isSectionCollapsed={isSectionCollapsed}
        isSpecialRunMode={isSpecialRunMode}
        jumpToPinnedSection={jumpToPinnedSection}
        lockedPreanalysisObservationCount={lockedPreanalysisObservations.length}
        lockedPreanalysisObservations={lockedPreanalysisObservations}
        lostStationIds={lostStationIds}
        maxAbsStdRes={maxAbsStdRes}
        observationStationsLabel={observationStationsLabel}
        observationValueLabel={observationValueLabel}
        onApplyAllPreanalysisActions={onApplyAllPreanalysisActions}
        onApplyImpactExclude={onApplyImpactExclude}
        onApplyPreanalysisAction={onApplyPreanalysisAction}
        onClearClusterMerges={onClearClusterMerges}
        onClearExclusions={onClearExclusions}
        onHeaderRef={registerDetailSectionHeader}
        onReRun={onReRun}
        onResetOverrides={onResetOverrides}
        pendingRunSettingDiffs={pendingRunSettingDiffs}
        pinnedDetailSections={pinnedDetailSections}
        preanalysisImpactDiagnostics={preanalysisImpactDiagnostics}
        preanalysisLabelTooltip={preanalysisLabelTooltip}
        relativeCovarianceCount={relativeCovariances.length}
        renderSourceLineLink={renderSourceLineLink}
        result={result}
        runDiagnostics={runDiagnostics}
        runMode={runMode}
        setAllDetailSectionsCollapsed={setAllDetailSectionsCollapsed}
        showClusterMergeRevert={showClusterMergeRevert}
        stationCovarianceCount={stationCovariances.length}
        suspectImpactActionableCount={suspectImpactActionableCount}
        suspectImpactDiagnostics={suspectImpactDiagnostics}
        suspectImpactExcludedCount={suspectImpactExcludedCount}
        suspectImpactWorstBaseStdRes={suspectImpactWorstBaseStdRes}
        toggleDetailSection={toggleDetailSection}
        togglePinnedDetailSection={togglePinnedDetailSection}
        unitScale={unitScale}
        units={units}
      />

      <ReportViewDiagnosticsBand
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
        directionRejects={directionRejects}
        directionTreatmentDiagnostics={directionTreatmentDiagnostics}
        gpsCoordinateSideshots={gpsCoordinateSideshots}
        gpsLoopDiagnostics={gpsLoopDiagnostics}
        gpsLoopSuspects={gpsLoopSuspects}
        gpsOffsetObservations={gpsOffsetObservations}
        gpsSideshots={gpsSideshots}
        gpsVectorSideshots={gpsVectorSideshots}
        highlightedLevelingSegmentLines={highlightedLevelingSegmentLines}
        isDataCheck={isDataCheck}
        isDetailSectionPinned={isDetailSectionPinned}
        isPreanalysis={isPreanalysis}
        isSectionCollapsed={isSectionCollapsed}
        isSpecialRunMode={isSpecialRunMode}
        levelingLoopDiagnostics={levelingLoopDiagnostics}
        levelingLoopSuspects={levelingLoopSuspects}
        levelingSegmentSuspects={levelingSegmentSuspects}
        onHeaderRef={registerDetailSectionHeader}
        parseState={result.parseState}
        renderCollapsibleSectionHeader={renderCollapsibleSectionHeader}
        renderLoadMoreFooter={renderLoadMoreFooter}
        renderSourceLineLink={renderSourceLineLink}
        result={result}
        setupDiagnostics={setupDiagnostics}
        setupLocalFailCount={setupLocalFailCount}
        setupObsCount={setupObsCount}
        setupWorstStdRes={setupWorstStdRes}
        showAutoSideshotDiagnosticsSection={showAutoSideshotDiagnosticsSection}
        showLevelingLoopDiagnosticsSection={showLevelingLoopDiagnosticsSection}
        showTsCorrelationDiagnosticsSection={showTsCorrelationDiagnosticsSection}
        toggleDetailSection={toggleDetailSection}
        togglePinnedDetailSection={togglePinnedDetailSection}
        topDirectionRepeatabilitySuspects={topDirectionRepeatabilitySuspects}
        topDirectionTargetSuspects={topDirectionTargetSuspects}
        topGpsOffsetObservation={topGpsOffsetObservation}
        traverseLoops={traverseLoops}
        traverseLoopSuspects={traverseLoopSuspects}
        tsSideshots={tsSideshots}
        unitScale={unitScale}
        units={units}
        visibleDirectionRejects={visibleDirectionRejects}
        visibleGpsLoopSuspects={visibleGpsLoopSuspects}
        visibleLevelingLoopSuspects={visibleLevelingLoopSuspects}
        visibleTraverseLoopSuspects={visibleTraverseLoopSuspects}
      />

      <ReportViewPrecisionResidualsBand
        allDetailSectionsCollapsed={allDetailSectionsCollapsed}
        autoSideshotObsIds={autoSideshotObsIds}
        byType={byType}
        clearFilters={clearFilters}
        covarianceScale={covarianceScale}
        deferredReportFilterQuery={deferredReportFilterQuery}
        directionTreatmentDiagnostics={directionTreatmentDiagnostics}
        ellipseConfidenceScale={ellipseConfidenceScale}
        ellipseMode={ellipseMode}
        ellipseScale={ellipseScale}
        ellipseUnit={ellipseUnit}
        excludedIds={excludedIds}
        filteredObservationCount={filteredSortedObs.length}
        filteredRelativeCovariances={filteredRelativeCovariances}
        filteredRelativePrecision={filteredRelativePrecision}
        filteredStationCovariances={filteredStationCovariances}
        filteredStationRows={filteredStationRows}
        flaggedRelativeCues={flaggedRelativeCues}
        flaggedStationCues={flaggedStationCues}
        focusFilterRequestKey={focusFilterRequestKey}
        formatEffectiveDistance={formatEffectiveDistance}
        formatMdb={formatMdb}
        importedGroupOptions={importedGroupOptions}
        isDataCheck={isDataCheck}
        isDetailSectionPinned={isDetailSectionPinned}
        isPreanalysis={isPreanalysis}
        isRegularAdjustment={isRegularAdjustment}
        isSectionCollapsed={isSectionCollapsed}
        logs={result.logs}
        normalizedReportFilterQuery={normalizedReportFilterQuery}
        observationWeightLabel={observationWeightLabel}
        onEllipseModeChange={setEllipseMode}
        onHeaderRef={registerDetailSectionHeader}
        onReportExclusionFilterChange={setReportExclusionFilter}
        onReportFilterQueryChange={setReportFilterQuery}
        onReportObservationTypeFilterChange={setReportObservationTypeFilter}
        onReviewAdjustedOnlyChange={setReviewAdjustedOnly}
        onReviewConflictOnlyChange={setReviewConflictOnly}
        onReviewImportedGroupFilterChange={setReviewImportedGroupFilter}
        onSelectObservation={onSelectObservation}
        onSelectStation={onSelectStation}
        onToggleExclude={onToggleExclude}
        parseState={result.parseState}
        preanalysisLabelTooltip={preanalysisLabelTooltip}
        prismAnnotation={prismAnnotation}
        renderCollapsibleSectionHeader={renderCollapsibleSectionHeader}
        renderLoadMoreFooter={renderLoadMoreFooter}
        renderSourceLineLink={renderSourceLineLink}
        reportExclusionFilter={reportExclusionFilter}
        reportFilterQuery={reportFilterQuery}
        reportObservationTypeFilter={reportObservationTypeFilter}
        reviewAdjustedOnly={reviewAdjustedOnly}
        reviewConflictOnly={reviewConflictOnly}
        reviewImportedGroupFilter={reviewImportedGroupFilter}
        rowSelectionClass={rowSelectionClass}
        selectedObservationId={selectedObservationId}
        selectedStationId={selectedStationId}
        showAllRows={showAllRows}
        showMoreRows={showMoreRows}
        sortedObservationCount={sortedObs.length}
        stationDescription={stationDescription}
        stationTypeBadge={stationTypeBadge}
        toggleDetailSection={toggleDetailSection}
        togglePinnedDetailSection={togglePinnedDetailSection}
        topRelativeCovarianceRow={topRelativeCovarianceRow}
        topRelativePrecisionRow={topRelativePrecisionRow}
        topStationCovarianceRow={topStationCovarianceRow}
        topTypeSummaryEntry={topTypeSummaryEntry}
        typeSummaryEntries={typeSummaryEntries}
        typeSummaryObsCount={typeSummaryObsCount}
        unitScale={unitScale}
        units={units}
        visibleRelativeCovariances={visibleRelativeCovariances}
        visibleRelativePrecision={visibleRelativePrecision}
        visibleRowsFor={visibleRowsFor}
        visibleStationCovariances={visibleStationCovariances}
        weakGeometryDiagnostics={weakGeometryDiagnostics}
      />
    </div>
  );
};

export default ReportView;

