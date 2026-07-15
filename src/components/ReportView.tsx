import React, { useCallback, useEffect, useMemo, useRef } from 'react';
import type {
  AdjustmentResult,
  ClusterApprovedMerge,
  CoordSystemDiagnosticCode,
  CrsOffReason,
  CrsStatus,
  DatumSufficiencyReport,
  DirectiveNoEffectWarning,
  DirectiveTransition,
  GnssVectorFrame,
  Observation,
  ReductionUsageSummary,
  RunMode,
  SigmaSource,
  Station,
  PrecisionReportingMode,
} from '../types';
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
  formatFixedOrScientific,
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
import { useReportViewState, type ReportViewControls } from '../hooks/useReportViewState';
import { noteUiPerfStage, noteUiTabReady } from '../hooks/useUiPerfMonitor';

const FT_PER_M = 3.280839895;
const EMPTY_SUSPECT_IMPACT_DIAGNOSTICS: NonNullable<AdjustmentResult['suspectImpactDiagnostics']> =
  [];
const EMPTY_SETUP_DIAGNOSTICS: NonNullable<AdjustmentResult['setupDiagnostics']> = [];

interface ReportViewProps {
  result: AdjustmentResult;
  units: 'm' | 'ft';
  precisionReportingMode?: PrecisionReportingMode;
  viewState?: ReportViewControls;
  runDiagnostics: {
    solveProfile:
      | 'webnet'
      | 'industry-parity-current'
      | 'industry-parity-legacy'
      | 'legacy-compat'
      | 'industry-parity';
    runMode?: RunMode;
    parity: boolean;
    directionSetMode: 'reduced' | 'raw';
    mapMode: 'off' | 'on' | 'anglecalc';
    mapScaleFactor: number;
    normalize: boolean;
    faceNormalizationMode: 'on' | 'off' | 'auto';
    angleMode: 'auto' | 'angle' | 'dir';
    verticalReduction: 'none' | 'curvref';
    applyCurvatureRefraction: boolean;
    refractionCoefficient: number;
    tsCorrelationEnabled: boolean;
    tsCorrelationScope: 'setup' | 'set';
    tsCorrelationRho: number;
    robustMode: 'none' | 'huber';
    robustK: number;
    rotationAngleRad: number;
    crsGridScaleEnabled: boolean;
    crsGridScaleFactor: number;
    crsConvergenceEnabled: boolean;
    crsConvergenceAngleRad: number;
    geoidModelEnabled: boolean;
    geoidModelId: string;
    geoidInterpolation: 'bilinear' | 'nearest';
    geoidHeightConversionEnabled: boolean;
    geoidOutputHeightDatum: 'orthometric' | 'ellipsoid';
    geoidModelLoaded: boolean;
    geoidModelMetadata: string;
    geoidSampleUndulationM?: number;
    geoidConvertedStationCount: number;
    geoidSkippedStationCount: number;
    qFixLinearSigmaM: number;
    qFixAngularSigmaSec: number;
    profileDefaultInstrumentFallback: boolean;
    angleCenteringModel: 'geometry-aware-correlated-rays';
    coordSystemMode?: 'local' | 'grid';
    crsId?: string;
    localDatumScheme?: 'average-scale' | 'common-elevation';
    averageScaleFactor?: number;
    scaleOverrideActive?: boolean;
    commonElevation?: number;
    averageGeoidHeight?: number;
    gnssVectorFrameDefault?: GnssVectorFrame;
    gnssFrameConfirmed?: boolean;
    gridBearingMode?: 'measured' | 'grid';
    gridDistanceMode?: 'measured' | 'grid' | 'ellipsoidal';
    gridAngleMode?: 'measured' | 'grid';
    gridDirectionMode?: 'measured' | 'grid';
    parsedUsageSummary?: ReductionUsageSummary;
    usedInSolveUsageSummary?: ReductionUsageSummary;
    directiveTransitions?: DirectiveTransition[];
    directiveNoEffectWarnings?: DirectiveNoEffectWarning[];
    datumSufficiencyReport?: DatumSufficiencyReport;
    coordSystemDiagnostics?: CoordSystemDiagnosticCode[];
    coordSystemWarningMessages?: string[];
    crsStatus?: CrsStatus;
    crsOffReason?: CrsOffReason;
    defaultSigmaCount: number;
    defaultSigmaByType: string;
    stochasticDefaultsSummary: string;
  } | null;
  excludedIds: Set<number>;
  onToggleExclude: (_id: number) => void;
  onApplyImpactExclude: (_id: number) => void;
  onApplyPreanalysisAction: (_id: string) => void;
  onApplyAllPreanalysisActions?: (_ids: string[]) => void;
  onReRun: () => void;
  onClearExclusions: () => void;
  onJumpToSourceLine?: (_sourceLine: number) => void;
  pendingRunSettingDiffs?: string[];
  overrides: Record<number, { obs?: number | { dE: number; dN: number }; stdDev?: number }>;
  onOverride: (
    _id: number,
    _payload: { obs?: number | { dE: number; dN: number }; stdDev?: number },
  ) => void;
  onResetOverrides: () => void;
  clusterReviewDecisions: Record<
    string,
    { status: 'pending' | 'approve' | 'reject'; canonicalId: string }
  >;
  activeClusterApprovedMerges: ClusterApprovedMerge[];
  onClusterDecisionStatus: (_clusterKey: string, _status: 'pending' | 'approve' | 'reject') => void;
  onClusterCanonicalSelection: (_clusterKey: string, _canonicalId: string) => void;
  onApplyClusterMerges: () => void;
  onResetClusterReview: () => void;
  onClearClusterMerges: () => void;
  selectedStationId?: string | null;
  selectedObservationId?: number | null;
  onSelectStation?: (_stationId: string) => void;
  onSelectObservation?: (_observationId: number) => void;
  focusFilterRequestKey?: number;
}

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
  const formatPreanalysisLinearMetric = useCallback(
    (valueMeters?: number) =>
      valueMeters != null ? formatFixedOrScientific(valueMeters * unitScale, 4) : '-',
    [unitScale],
  );
  const formatPreanalysisSetupLabel = useCallback(
    (setupStationIds: string[]) => setupStationIds.join(', '),
    [],
  );
  const formatPreanalysisSetLabel = useCallback((label: string): string => {
    const separatorIndex = label.indexOf('->');
    if (separatorIndex < 0) return label;
    const trimmed = label.slice(separatorIndex + 2).trim();
    return trimmed || label;
  }, []);
  const pendingPreanalysisScenarioIds = useMemo(
    () =>
      (preanalysisImpactDiagnostics?.rows ?? [])
        .filter(
          (row) =>
            row.status === 'ok' &&
            row.actionMode !== 'advisory' &&
            !activePreanalysisScenarioIds.has(row.scenarioId),
        )
        .map((row) => row.scenarioId),
    [activePreanalysisScenarioIds, preanalysisImpactDiagnostics?.rows],
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

      {isPreanalysis && (
        <div className="mb-6 border border-cyan-900/70 rounded overflow-hidden">
          <div
            className="px-3 py-2 text-xs text-cyan-200 uppercase tracking-wider border-b border-cyan-900/60 bg-cyan-950/30"
            title={preanalysisLabelTooltip('Preanalysis Planning Summary')}
          >
            Preanalysis Planning Summary
          </div>
          <div className="grid grid-cols-2 md:grid-cols-6 gap-3 p-3 text-xs text-slate-300 border-b border-cyan-900/30">
            <div>
              <div
                className="text-slate-500"
                title={preanalysisLabelTooltip('Planned Observations')}
              >
                Planned Observations
              </div>
              <div>{result.parseState?.plannedObservationCount ?? 0}</div>
            </div>
            <div>
              <div
                className="text-slate-500"
                title={preanalysisLabelTooltip('Station Covariance Blocks')}
              >
                Station Covariance Blocks
              </div>
              <div>{stationCovariances.length}</div>
            </div>
            <div>
              <div
                className="text-slate-500"
                title={preanalysisLabelTooltip('Connected Pair Blocks')}
              >
                Connected Pair Blocks
              </div>
              <div>{relativeCovariances.length}</div>
            </div>
            <div>
              <div className="text-slate-500" title={preanalysisLabelTooltip('Weak Stations')}>
                Weak Stations
              </div>
              <div>{flaggedStationCues.length}</div>
            </div>
            <div>
              <div className="text-slate-500" title={preanalysisLabelTooltip('Weak Pairs')}>
                Weak Pairs
              </div>
              <div>{flaggedRelativeCues.length}</div>
            </div>
            <div>
              <div className="text-slate-500" title={preanalysisLabelTooltip('Locked Planned')}>
                Locked Planned
              </div>
              <div>{lockedPreanalysisObservations.length}</div>
            </div>
          </div>
          <div className="px-3 py-2 text-xs text-cyan-100/90 bg-cyan-950/20">
            Predicted covariance uses sigma0^2 = 1.0. Residual-based QC, chi-square, suspect
            ranking, and exclusion workflows are disabled in this mode.
          </div>
        </div>
      )}

      {isPreanalysis && lockedPreanalysisObservations.length > 0 && (
        <div className="mb-6 border border-slate-800 rounded overflow-hidden opacity-75">
          {renderCollapsibleSectionHeader({
            sectionId: 'locked-planned-observations',
            label: 'Locked Planned Observations',
            className:
              'px-3 py-2 text-xs uppercase tracking-wider border-b border-slate-800 bg-slate-900/40',
            labelClassName: 'text-slate-400',
            title: preanalysisLabelTooltip('Locked Planned Observations'),
          })}
          {!isSectionCollapsed('locked-planned-observations') && (
            <>
              <div className="px-3 py-2 text-xs text-slate-500 bg-slate-950/30 border-b border-slate-800/60">
                These planned rows use fixed sigma weighting, remain visible for context, and are
                not removable from what-if actions.
              </div>
              <table className="w-full text-left text-xs">
                <thead>
                  <tr className="text-slate-200 border-b border-slate-700/80">
                    <th className="py-2 px-3">#</th>
                    <th className="py-2">Type</th>
                    <th className="py-2">Stations</th>
                    <th className="py-2 text-right">Line</th>
                    <th className="py-2 text-right">Obs</th>
                    <th className="py-2 text-right">Fixed Sigma</th>
                    <th className="py-2 px-3">Note</th>
                  </tr>
                </thead>
                <tbody className="text-slate-500">
                  {lockedPreanalysisObservations.map((obs, idx) => (
                    <tr
                      key={`locked-preanalysis-${obs.id}-${idx}`}
                      className="border-b border-slate-800/40 bg-slate-950/20"
                    >
                      <td className="py-1 px-3">{idx + 1}</td>
                      <td className="py-1 uppercase">{obs.type}</td>
                      <td className="py-1">{observationStationsLabel(obs)}</td>
                      <td className="py-1 text-right font-mono">
                        {renderSourceLineLink(obs.sourceLine)}
                      </td>
                      <td className="py-1 text-right font-mono">{observationValueLabel(obs)}</td>
                      <td className="py-1 text-right font-mono">{fixedSigmaLabel(obs)}</td>
                      <td className="py-1 px-3">
                        Locked planned constraint; excluded from what-if actions.
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </>
          )}
        </div>
      )}

      {isPreanalysis &&
        preanalysisImpactDiagnostics &&
        preanalysisImpactDiagnostics.rows.length > 0 && (
          <div className="mb-6 border border-slate-800 rounded overflow-hidden">
            {renderCollapsibleSectionHeader({
              sectionId: 'planned-observation-what-if-analysis',
              label: 'Preanalysis Added-Set / Brace Recommendations',
              className:
                'px-3 py-2 text-xs uppercase tracking-wider border-b border-slate-800 bg-slate-900/40',
              labelClassName: 'text-slate-400',
              title: preanalysisLabelTooltip('Preanalysis Added-Set Recommendations'),
            })}
            {!isSectionCollapsed('planned-observation-what-if-analysis') && (
              <>
                <div className="flex items-center justify-end gap-2 px-3 py-2 border-b border-slate-800/60 bg-slate-950/20">
                  <button
                    type="button"
                    onClick={() => onApplyAllPreanalysisActions(pendingPreanalysisScenarioIds)}
                    disabled={pendingPreanalysisScenarioIds.length === 0}
                    className={`px-2.5 py-1 rounded border text-[10px] uppercase tracking-wide ${
                      pendingPreanalysisScenarioIds.length === 0
                        ? 'border-slate-700 text-slate-600 cursor-not-allowed'
                        : 'border-cyan-700 text-cyan-200 hover:bg-cyan-950/30'
                    }`}
                  >
                    Apply All Visible
                  </button>
                </div>
                <div className="grid grid-cols-2 md:grid-cols-8 gap-3 p-3 text-xs text-slate-300 border-b border-slate-800/60">
                  <div>
                    <div className="text-slate-500" title={preanalysisLabelTooltip('Applied Added Scenarios')}>
                      Applied Scenarios
                    </div>
                    <div>{preanalysisImpactDiagnostics.activeSyntheticAdditionCount}</div>
                  </div>
                  <div>
                    <div className="text-slate-500" title={preanalysisLabelTooltip('Candidate Added Scenarios')}>
                      Candidate Scenarios
                    </div>
                    <div>{preanalysisImpactDiagnostics.candidateTemplateCount}</div>
                  </div>
                  <div>
                    <div
                      className="text-slate-500"
                      title={preanalysisLabelTooltip('Worst Station Major')}
                    >
                      Worst Station Major
                    </div>
                    <div>
                      {preanalysisImpactDiagnostics.baseWorstStationMajor != null
                        ? `${formatPreanalysisLinearMetric(preanalysisImpactDiagnostics.baseWorstStationMajor)} ${units}`
                        : '-'}
                    </div>
                  </div>
                  <div>
                    <div
                      className="text-slate-500"
                      title={preanalysisLabelTooltip('Worst Pair SigmaDist')}
                    >
                      Worst Pair SigmaDist
                    </div>
                    <div>
                      {preanalysisImpactDiagnostics.baseWorstPairSigmaDist != null
                        ? `${formatPreanalysisLinearMetric(preanalysisImpactDiagnostics.baseWorstPairSigmaDist)} ${units}`
                        : '-'}
                    </div>
                  </div>
                  <div>
                    <div
                      className="text-slate-500"
                      title={preanalysisLabelTooltip('Weak Stations')}
                    >
                      Weak Stations
                    </div>
                    <div>{preanalysisImpactDiagnostics.baseWeakStationCount}</div>
                  </div>
                  <div>
                    <div className="text-slate-500" title={preanalysisLabelTooltip('Weak Pairs')}>
                      Weak Pairs
                    </div>
                    <div>{preanalysisImpactDiagnostics.baseWeakPairCount}</div>
                  </div>
                  <div>
                    <div
                      className="text-slate-500"
                      title={preanalysisLabelTooltip('Preanalysis Accuracy Threshold')}
                    >
                      Target Threshold
                    </div>
                    <div>
                      {preanalysisImpactDiagnostics.targetThresholdMeters != null
                        ? `${formatPreanalysisLinearMetric(preanalysisImpactDiagnostics.targetThresholdMeters)} ${units}`
                        : '-'}
                    </div>
                  </div>
                  <div>
                    <div
                      className="text-slate-500"
                      title={preanalysisLabelTooltip('Threshold Plan Result')}
                    >
                      Threshold Plan
                    </div>
                    <div>
                      {preanalysisImpactDiagnostics.thresholdPlan.thresholdReached
                        ? `Reached in ${preanalysisImpactDiagnostics.thresholdPlan.appliedStepCount}`
                        : preanalysisImpactDiagnostics.thresholdPlan.appliedStepCount > 0
                          ? `Best ${preanalysisImpactDiagnostics.thresholdPlan.appliedStepCount}`
                          : 'Not planned'}
                    </div>
                  </div>
                </div>
                <div className="grid grid-cols-1 md:grid-cols-5 gap-3 p-3 text-xs text-slate-300 border-b border-slate-800/60 bg-slate-950/20">
                  <div>
                    <div className="text-slate-500">Plan Target</div>
                    <div>
                      {preanalysisImpactDiagnostics.thresholdPlan.targetThresholdMeters != null
                        ? `${formatPreanalysisLinearMetric(preanalysisImpactDiagnostics.thresholdPlan.targetThresholdMeters)} ${units}`
                        : '-'}
                    </div>
                  </div>
                  <div>
                    <div className="text-slate-500">Plan Status</div>
                    <div>
                      {preanalysisImpactDiagnostics.thresholdPlan.thresholdReached
                        ? 'Reached'
                        : 'Not Reached'}
                    </div>
                  </div>
                  <div>
                    <div className="text-slate-500">Sets Needed</div>
                    <div>{preanalysisImpactDiagnostics.thresholdPlan.appliedStepCount}</div>
                  </div>
                  <div>
                    <div className="text-slate-500">Projected Worst Major</div>
                    <div>
                      {preanalysisImpactDiagnostics.thresholdPlan.finalWorstStationMajor != null
                        ? `${formatPreanalysisLinearMetric(preanalysisImpactDiagnostics.thresholdPlan.finalWorstStationMajor)} ${units}`
                        : '-'}
                    </div>
                  </div>
                  <div>
                    <div className="text-slate-500">Plan Note</div>
                    <div>{preanalysisImpactDiagnostics.thresholdPlan.unmetReason ?? '-'}</div>
                  </div>
                </div>
                <table className="w-full text-left text-xs">
                  <thead>
                    <tr className="text-slate-200 border-b border-slate-700/80">
                      <th className="py-2 px-3">#</th>
                      <th className="py-2">Setup</th>
                      <th className="py-2">Set</th>
                      <th className="py-2 text-right">Lines</th>
                      <th className="py-2 text-right">Added Obs</th>
                      <th className="py-2 text-right">dWorstMaj ({units})</th>
                      <th className="py-2 text-right">dMedianMaj ({units})</th>
                      <th className="py-2 text-right">dWorstPair ({units})</th>
                      <th className="py-2 text-right">dPathWorst ({units})</th>
                      <th className="py-2 text-right">dPathTotal ({units})</th>
                      <th className="py-2 text-right">dWeakStn</th>
                      <th className="py-2 text-right">dWeakPair</th>
                      <th className="py-2">Path Reason</th>
                      <th className="py-2 text-right">Score</th>
                      <th className="py-2 text-right">Threshold</th>
                      <th className="py-2 text-right px-3">Action</th>
                    </tr>
                  </thead>
                  <tbody className="text-slate-300">
                    {preanalysisImpactDiagnostics.rows.map((row, idx) => {
                      const alreadyApplied = activePreanalysisScenarioIds.has(row.scenarioId);
                      return (
                        <tr
                          key={`preanalysis-impact-${row.scenarioId}-${idx}`}
                          className="border-b border-slate-800/30"
                        >
                          <td className="py-1 px-3 text-slate-500">{idx + 1}</td>
                          <td className="py-1 uppercase text-slate-400">
                            {formatPreanalysisSetupLabel(row.setupStationIds)}
                          </td>
                          <td className="py-1">{formatPreanalysisSetLabel(row.templateLabel)}</td>
                          <td className="py-1 text-right font-mono text-slate-500">
                            {row.sourceLines.length > 0
                              ? renderSourceLineLink(row.sourceLines[0])
                              : '-'}
                          </td>
                          <td className="py-1 text-right font-mono">
                            {row.addedObservationCount}
                          </td>
                          <td className="py-1 text-right font-mono">
                            {formatPreanalysisLinearMetric(row.deltaWorstStationMajor)}
                          </td>
                          <td className="py-1 text-right font-mono">
                            {formatPreanalysisLinearMetric(row.deltaMedianStationMajor)}
                          </td>
                          <td className="py-1 text-right font-mono">
                            {formatPreanalysisLinearMetric(row.deltaWorstPairSigmaDist)}
                          </td>
                          <td className="py-1 text-right font-mono">
                            {formatPreanalysisLinearMetric(row.deltaPathWorstEdge)}
                          </td>
                          <td className="py-1 text-right font-mono">
                            {formatPreanalysisLinearMetric(row.deltaPathTotalMetric)}
                          </td>
                          <td className="py-1 text-right font-mono">
                            {row.deltaWeakStationCount ?? '-'}
                          </td>
                          <td className="py-1 text-right font-mono">
                            {row.deltaWeakPairCount ?? '-'}
                          </td>
                          <td className="py-1 text-[11px] text-slate-400">
                            {row.primaryTargetStationId != null
                              ? `${row.primaryTargetStationId}${
                                  row.bottleneckPair != null
                                    ? ` via ${row.bottleneckPair.from}-${row.bottleneckPair.to}`
                                    : ''
                                }${row.rationale ? `: ${row.rationale}` : ''}`
                              : row.rationale ?? '-'}
                          </td>
                          <td className="py-1 text-right font-mono">
                            {row.score != null ? row.score.toFixed(2) : '-'}
                          </td>
                          <td className="py-1 text-right font-mono">
                            {row.thresholdReached ? 'YES' : 'NO'}
                          </td>
                          <td className="py-1 px-3 text-right">
                            <button
                              onClick={() => onApplyPreanalysisAction(row.scenarioId)}
                              disabled={
                                row.status !== 'ok' ||
                                alreadyApplied ||
                                row.actionMode === 'advisory'
                              }
                              className={`px-2 py-0.5 rounded border text-[10px] ${
                                row.status !== 'ok' ||
                                alreadyApplied ||
                                row.actionMode === 'advisory'
                                  ? 'border-slate-700 text-slate-600 cursor-not-allowed'
                                  : 'border-cyan-700 text-cyan-200 hover:bg-cyan-950/30'
                              }`}
                            >
                              {alreadyApplied
                                ? 'Applied'
                                : row.actionMode !== 'advisory'
                                  ? 'Apply + Re-run'
                                  : 'Manual Action'}
                            </button>
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </>
            )}
          </div>
        )}

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

        <div className="mt-8 rounded border border-slate-800 overflow-hidden">
        {renderCollapsibleSectionHeader({
          sectionId: 'processing-log',
          label: 'Processing Log',
          className:
            'px-3 py-2 text-xs uppercase tracking-wider border-b border-slate-700 bg-slate-900',
          labelClassName: 'text-slate-300 font-bold',
        })}
        {!isSectionCollapsed('processing-log') && (
          <div className="bg-slate-900 p-4 font-mono text-xs text-slate-400">
            {result.logs.map((l, i) => (
              <div key={i}>{l}</div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
};

export default ReportView;

