import React, { useCallback, useEffect, useMemo, useRef } from 'react';
import type {
  AdjustmentResult,
  Observation,
  RunMode,
  Station,
} from '../types';
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
import ReportProcessingLogSection from './report/ReportProcessingLogSection';
import {
  sortObservationsByStdRes,
  type SortedObservation,
} from '../engine/resultDerivedModels';
import AdjustedCoordinatesSection from './report/AdjustedCoordinatesSection';
import CollapsibleSectionHeader from './report/CollapsibleSectionHeader';
import DirectionDiagnosticsSections, {
  DirectionFaceTreatmentDiagnosticsSection,
} from './report/DirectionDiagnosticsSections';
import ObservationTableSection from './report/ObservationTableSection';
import PinnedSectionsPanel from './report/PinnedSectionsPanel';
import ReportFilterPanel from './report/ReportFilterPanel';
import LoopDiagnosticsSections from './report/LoopDiagnosticsSections';
import { getReportHeaderTooltip } from './report/reportHeaderTooltips';
import ReportLoadMoreFooter from './report/ReportLoadMoreFooter';
import ReportDiagnosticsSections from './report/ReportDiagnosticsSections';
import {
  AutoAdjustDiagnosticsPanel,
  AutoSideshotCandidatesPanel,
  GpsRoverOffsetsPanel,
  SetupDiagnosticsPanel,
} from './report/ReportDiagnosticPanels';
import {
  AdjustmentSummarySection,
  BlunderDetectSummarySection,
  DataCheckSummarySection,
  PendingRunSettingsDiffBanner,
} from './report/ReportRunSummarySections';
import { ReportSuspectImpactSection } from './report/ReportSuspectImpactSection';
import { ReportClusterDetectionSection } from './report/ReportClusterDetectionSection';
import {
  AliasTraceabilitySection,
  DescriptionReconciliationSection,
} from './report/ReportTraceabilitySections';
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
import {
  REPORT_DIAGNOSTIC_WINDOW_SIZE,
  REPORT_TABLE_WINDOW_SIZE,
  type CollapsibleDetailSectionId,
} from './report/reportSectionRegistry';
import SideshotSection from './report/SideshotSection';
import SolveProfileDiagnosticsSection from './report/SolveProfileDiagnosticsSection';
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
  const renderSideshotSection = (
    title: string,
    rows: NonNullable<AdjustmentResult['sideshots']>,
    sectionId?: CollapsibleDetailSectionId,
  ) => {
    if (rows.length === 0) return null;
    const collapsed = sectionId ? isSectionCollapsed(sectionId) : false;
    return (
      <SideshotSection
        title={title}
        rows={rows}
        units={units}
        unitScale={unitScale}
        sectionId={sectionId}
        collapsed={collapsed}
        pinned={sectionId ? isDetailSectionPinned(sectionId) : false}
        onToggleCollapse={toggleDetailSection}
        onTogglePin={togglePinnedDetailSection}
        onHeaderRef={(activeSectionId, node) => {
          detailSectionHeaderRefs.current[activeSectionId] = node;
        }}
        renderSourceLineLink={renderSourceLineLink}
      />
    );
  };

  useEffect(() => {
    const root = reportRootRef.current;
    if (!root) return;
    const headers = root.querySelectorAll('th');
    headers.forEach((th) => {
      const label = th.textContent ?? '';
      const tip = getReportHeaderTooltip(label);
      if (tip) th.setAttribute('title', tip);
    });
  });

  const renderCollapsibleSectionHeader = (params: {
    sectionId: CollapsibleDetailSectionId;
    label: string;
    className: string;
    labelClassName: string;
    title?: string;
  }) => {
    const { sectionId, label, className, labelClassName, title } = params;
    return (
      <CollapsibleSectionHeader
        sectionId={sectionId}
        label={label}
        className={className}
        labelClassName={labelClassName}
        title={title}
        collapsed={isSectionCollapsed(sectionId)}
        pinned={isDetailSectionPinned(sectionId)}
        onToggleCollapse={toggleDetailSection}
        onTogglePin={togglePinnedDetailSection}
        onHeaderRef={(id, node) => {
          detailSectionHeaderRefs.current[id] = node;
        }}
      />
    );
  };

  const renderLoadMoreFooter = (
    key: string,
    shownCount: number,
    totalCount: number,
    step = REPORT_TABLE_WINDOW_SIZE,
  ) => {
    return (
      <ReportLoadMoreFooter
        rowKey={key}
        shownCount={shownCount}
        totalCount={totalCount}
        onShowMore={showMoreRows}
        onShowAll={showAllRows}
        step={step}
      />
    );
  };

  const renderSourceLineLink = (line: number | null | undefined) => {
    if (line == null) return '-';
    if (!onJumpToSourceLine) return line;
    return (
      <button
        type="button"
        onClick={() => onJumpToSourceLine(line)}
        className="font-mono text-blue-300 underline decoration-dotted underline-offset-2 hover:text-blue-200"
        title={`Jump to line ${line} in the input editor`}
      >
        {line}
      </button>
    );
  };

  const renderTable = (
    obsList: Observation[],
    title: string,
    sectionId?: CollapsibleDetailSectionId,
  ) => {
    return (
      <ObservationTableSection
        obsList={obsList}
        title={title}
        sectionId={sectionId}
        units={units}
        unitScale={unitScale}
        excludedIds={excludedIds}
        autoSideshotObsIds={autoSideshotObsIds}
        selectedObservationId={selectedObservationId}
        onSelectObservation={onSelectObservation}
        onToggleExclude={onToggleExclude}
        rowSelectionClass={rowSelectionClass}
        visibleRowsFor={visibleRowsFor}
        showMoreRows={showMoreRows}
        showAllRows={showAllRows}
        renderSourceLineLink={renderSourceLineLink}
        isSectionCollapsed={isSectionCollapsed}
        isDetailSectionPinned={isDetailSectionPinned}
        toggleDetailSection={toggleDetailSection}
        togglePinnedDetailSection={togglePinnedDetailSection}
        onHeaderRef={(id, node) => {
          detailSectionHeaderRefs.current[id] = node;
        }}
        formatMdb={formatMdb}
        formatEffectiveDistance={formatEffectiveDistance}
        prismAnnotation={prismAnnotation}
        observationWeightLabel={observationWeightLabel}
      />
    );
  };

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
        onHeaderRef={(id, node) => {
          detailSectionHeaderRefs.current[id] = node;
        }}
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
          onHeaderRef={(id, node) => {
            detailSectionHeaderRefs.current[id] = node;
          }}
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
        onHeaderRef={(id, node) => {
          detailSectionHeaderRefs.current[id] = node;
        }}
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
        onHeaderRef={(id, node) => {
          detailSectionHeaderRefs.current[id] = node;
        }}
        preanalysisImpactDiagnostics={preanalysisImpactDiagnostics}
        preanalysisLabelTooltip={preanalysisLabelTooltip}
        renderSourceLineLink={renderSourceLineLink}
        toggleDetailSection={toggleDetailSection}
        togglePinnedDetailSection={togglePinnedDetailSection}
        unitScale={unitScale}
        units={units}
      />

      <AliasTraceabilitySection
        aliasTrace={aliasTrace}
        isDetailSectionPinned={isDetailSectionPinned}
        isSectionCollapsed={isSectionCollapsed}
        onHeaderRef={(id, node) => {
          detailSectionHeaderRefs.current[id] = node;
        }}
        parseState={result.parseState}
        renderSourceLineLink={renderSourceLineLink}
        toggleDetailSection={toggleDetailSection}
        togglePinnedDetailSection={togglePinnedDetailSection}
      />

      <DescriptionReconciliationSection
        descriptionAppendDelimiter={descriptionAppendDelimiter}
        descriptionConflicts={descriptionConflicts}
        descriptionReconcileMode={descriptionReconcileMode}
        descriptionRefsByStation={descriptionRefsByStation}
        descriptionScanSummary={descriptionScanSummary}
        isDetailSectionPinned={isDetailSectionPinned}
        isSectionCollapsed={isSectionCollapsed}
        onHeaderRef={(id, node) => {
          detailSectionHeaderRefs.current[id] = node;
        }}
        parseState={result.parseState}
        toggleDetailSection={toggleDetailSection}
        togglePinnedDetailSection={togglePinnedDetailSection}
      />

      <ReportClusterDetectionSection
        clusterAppliedMerges={clusterAppliedMerges}
        clusterCandidates={clusterCandidates}
        clusterDiagnostics={clusterDiagnostics}
        clusterMergeOutcomes={clusterMergeOutcomes}
        clusterRejectedProposals={clusterRejectedProposals}
        clusterReviewDecisions={clusterReviewDecisions}
        clusterReviewStats={clusterReviewStats}
        isDetailSectionPinned={isDetailSectionPinned}
        isSectionCollapsed={isSectionCollapsed}
        onApplyClusterMerges={onApplyClusterMerges}
        onClearClusterMerges={onClearClusterMerges}
        onClusterCanonicalSelection={onClusterCanonicalSelection}
        onClusterDecisionStatus={onClusterDecisionStatus}
        onHeaderRef={(id, node) => {
          detailSectionHeaderRefs.current[id] = node;
        }}
        onResetClusterReview={onResetClusterReview}
        toggleDetailSection={toggleDetailSection}
        togglePinnedDetailSection={togglePinnedDetailSection}
        unitScale={unitScale}
        units={units}
      />

      <AutoAdjustDiagnosticsPanel
        autoAdjustDiagnostics={autoAdjustDiagnostics}
        isDetailSectionPinned={isDetailSectionPinned}
        isSectionCollapsed={isSectionCollapsed}
        isSpecialRunMode={isSpecialRunMode}
        onHeaderRef={(id, node) => {
          detailSectionHeaderRefs.current[id] = node;
        }}
        renderSourceLineLink={renderSourceLineLink}
        toggleDetailSection={toggleDetailSection}
        togglePinnedDetailSection={togglePinnedDetailSection}
      />

      <AutoSideshotCandidatesPanel
        autoSideshotDiagnostics={autoSideshotDiagnostics}
        isDetailSectionPinned={isDetailSectionPinned}
        isSectionCollapsed={isSectionCollapsed}
        onHeaderRef={(id, node) => {
          detailSectionHeaderRefs.current[id] = node;
        }}
        renderSourceLineLink={renderSourceLineLink}
        showAutoSideshotDiagnosticsSection={showAutoSideshotDiagnosticsSection}
        toggleDetailSection={toggleDetailSection}
        togglePinnedDetailSection={togglePinnedDetailSection}
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
        onHeaderRef={(id, node) => {
          detailSectionHeaderRefs.current[id] = node;
        }}
        setupDiagnostics={setupDiagnostics}
        setupLocalFailCount={setupLocalFailCount}
        setupObsCount={setupObsCount}
        setupWorstStdRes={setupWorstStdRes}
        toggleDetailSection={toggleDetailSection}
        togglePinnedDetailSection={togglePinnedDetailSection}
        unitScale={unitScale}
        units={units}
      />

      {!isDataCheck && (tsSideshots.length > 0 || gpsSideshots.length > 0) && (
        <>
          {renderSideshotSection(
            'Post-Adjusted Sideshots (TS)',
            tsSideshots,
            'post-adjusted-sideshots-ts',
          )}
          {renderSideshotSection(
            'Post-Adjusted GPS Sideshot Vectors',
            gpsVectorSideshots,
            'post-adjusted-gps-sideshot-vectors',
          )}
          {renderSideshotSection(
            'Post-Adjusted GNSS Topo Coordinates (GS)',
            gpsCoordinateSideshots,
            'post-adjusted-gnss-topo-coordinates',
          )}
        </>
      )}

      <GpsRoverOffsetsPanel
        gpsOffsetObservations={gpsOffsetObservations}
        isDataCheck={isDataCheck}
        isDetailSectionPinned={isDetailSectionPinned}
        isSectionCollapsed={isSectionCollapsed}
        onHeaderRef={(id, node) => {
          detailSectionHeaderRefs.current[id] = node;
        }}
        renderSourceLineLink={renderSourceLineLink}
        topGpsOffsetObservation={topGpsOffsetObservation}
        toggleDetailSection={toggleDetailSection}
        togglePinnedDetailSection={togglePinnedDetailSection}
        unitScale={unitScale}
        units={units}
      />

      {!isDataCheck && <ReportFilterPanel
        isPreanalysis={isPreanalysis}
        sectionId="report-filters"
        collapsed={isSectionCollapsed('report-filters')}
        onToggleCollapse={toggleDetailSection}
        reportFilterQuery={reportFilterQuery}
        onReportFilterQueryChange={setReportFilterQuery}
        reportObservationTypeFilter={reportObservationTypeFilter}
        onReportObservationTypeFilterChange={setReportObservationTypeFilter}
        reportExclusionFilter={reportExclusionFilter}
        onReportExclusionFilterChange={setReportExclusionFilter}
        reviewConflictOnly={reviewConflictOnly}
        onReviewConflictOnlyChange={setReviewConflictOnly}
        reviewAdjustedOnly={reviewAdjustedOnly}
        onReviewAdjustedOnlyChange={setReviewAdjustedOnly}
        reviewImportedGroupFilter={reviewImportedGroupFilter}
        onReviewImportedGroupFilterChange={setReviewImportedGroupFilter}
        importedGroupOptions={importedGroupOptions}
        onClearFilters={clearFilters}
        filteredObservationCount={filteredSortedObs.length}
        totalObservationCount={sortedObs.length}
        deferredReportFilterQuery={deferredReportFilterQuery}
        normalizedReportFilterQuery={normalizedReportFilterQuery}
        focusRequestKey={focusFilterRequestKey}
      />}

      {!isDataCheck && <AdjustedCoordinatesSection
        isPreanalysis={isPreanalysis}
        units={units}
        ellipseMode={ellipseMode}
        onEllipseModeChange={setEllipseMode}
        ellipseUnit={ellipseUnit}
        ellipseConfidenceScale={ellipseConfidenceScale}
        ellipseScale={ellipseScale}
        filteredStationRows={filteredStationRows}
        selectedStationId={selectedStationId}
        onSelectStation={onSelectStation}
        stationDescription={stationDescription}
        stationTypeBadge={stationTypeBadge}
        rowSelectionClass={rowSelectionClass}
        unitScale={unitScale}
        visibleRowsFor={visibleRowsFor}
        renderLoadMoreFooter={renderLoadMoreFooter}
      />}

      <StationCovariancesSection
        covarianceScale={covarianceScale}
        filteredStationCovariances={filteredStationCovariances}
        isDetailSectionPinned={isDetailSectionPinned}
        isPreanalysis={isPreanalysis}
        isSectionCollapsed={isSectionCollapsed}
        onHeaderRef={(id, node) => {
          detailSectionHeaderRefs.current[id] = node;
        }}
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
        onHeaderRef={(id, node) => {
          detailSectionHeaderRefs.current[id] = node;
        }}
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
        onHeaderRef={(id, node) => {
          detailSectionHeaderRefs.current[id] = node;
        }}
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
        onHeaderRef={(id, node) => {
          detailSectionHeaderRefs.current[id] = node;
        }}
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
        {renderTable(byType('angle'), 'Angles (TS)', 'angles-ts')}
        {renderTable(byType('direction'), 'Directions (DB/DN)', 'directions-db-dn')}
        {renderTable(byType('dist'), 'Distances (TS)', 'distances-ts')}
        {renderTable(byType('bearing'), 'Bearings/Azimuths', 'bearings-azimuths')}
        {renderTable(byType('dir'), 'Directions (Azimuth)', 'directions-azimuth')}
        {renderTable(byType('zenith'), 'Zenith/Vertical Angles', 'zenith-vertical-angles')}
        {renderTable(byType('gps'), 'GPS Vectors', 'gps-vectors')}
        {renderTable(byType('lev'), 'Leveling dH', 'leveling-dh')}
      </ObservationResidualsSummarySections>

        {isRegularAdjustment && (
          <DirectionFaceTreatmentDiagnosticsSection
            directionTreatmentDiagnostics={directionTreatmentDiagnostics}
            isPreanalysis={isPreanalysis}
            isDataCheck={isDataCheck}
            renderCollapsibleSectionHeader={renderCollapsibleSectionHeader}
            isSectionCollapsed={isSectionCollapsed}
            renderSourceLineLink={renderSourceLineLink}
          />
        )}

        <ReportProcessingLogSection
          isDetailSectionPinned={isDetailSectionPinned}
          isSectionCollapsed={isSectionCollapsed}
          logs={result.logs}
          onHeaderRef={(id, node) => {
            detailSectionHeaderRefs.current[id] = node;
          }}
          toggleDetailSection={toggleDetailSection}
          togglePinnedDetailSection={togglePinnedDetailSection}
        />
    </div>
  );
};

export default ReportView;

