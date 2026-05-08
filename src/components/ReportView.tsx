import React, { useCallback, useEffect, useMemo, useRef } from 'react';
import { AlertTriangle, CheckCircle } from 'lucide-react';
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
  GpsObservation,
  Observation,
  ReductionUsageSummary,
  RunMode,
  SigmaSource,
  Station,
  PrecisionReportingMode,
} from '../types';
import { RAD_TO_DEG, radToDmsStr } from '../engine/angles';
import { isLockedPreanalysisObservation } from '../engine/preanalysis';
import {
  getRelativeCovarianceRows,
  getRelativePrecisionRows,
  getStationCovarianceRows,
  stationWithPrecision,
  toSurveyEllipseAzimuthDeg,
} from '../engine/resultPrecision';
import {
  buildDataCheckDiffRows,
  buildObservationSearchText,
  buildResultTraceabilityModel,
  groupSortedObservationsByType,
  sortObservationsByStdRes,
  type SortedObservation,
} from '../engine/resultDerivedModels';
import { confirmActionGuard } from '../engine/actionGuards';
import AdjustedCoordinatesSection from './report/AdjustedCoordinatesSection';
import CollapsibleSectionHeader from './report/CollapsibleSectionHeader';
import DirectionDiagnosticsSections from './report/DirectionDiagnosticsSections';
import ObservationTableSection from './report/ObservationTableSection';
import PinnedSectionsPanel from './report/PinnedSectionsPanel';
import ReportFilterPanel from './report/ReportFilterPanel';
import LoopDiagnosticsSections from './report/LoopDiagnosticsSections';
import { getReportHeaderTooltip } from './report/reportHeaderTooltips';
import ReportLoadMoreFooter from './report/ReportLoadMoreFooter';
import ReportDiagnosticsSections from './report/ReportDiagnosticsSections';
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
import { useReportViewState, type ReportViewControls } from '../hooks/useReportViewState';
import { noteUiPerfStage, noteUiTabReady } from '../hooks/useUiPerfMonitor';

const FT_PER_M = 3.280839895;

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
  onApplyPreanalysisAction: (_id: number) => void;
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
  const maxAbsStdRes = sortedObs.reduce(
    (max, obs) => Math.max(max, Math.abs(obs.stdRes ?? 0)),
    0,
  );
  const directionSetCount = useMemo(
    () =>
      new Set(
        result.observations
          .filter(
            (obs): obs is SortedObservation & { type: 'direction'; setId: string } =>
              obs.type === 'direction' && typeof obs.setId === 'string' && obs.setId.trim() !== '',
          )
          .map((obs) => obs.setId),
      ).size,
    [result.observations],
  );
  const filteredSortedObs = useMemo(
    () =>
      sortedObs.filter((obs) => {
        if (reportObservationTypeFilter !== 'all' && obs.type !== reportObservationTypeFilter)
          return false;
        if (reportExclusionFilter === 'included' && excludedIds.has(obs.id)) return false;
        if (reportExclusionFilter === 'excluded' && !excludedIds.has(obs.id)) return false;
        if (
          reviewImportedGroupFilter !== 'all' &&
          (reviewImportedGroupFilter === '__none__'
            ? Boolean(obs.sourceFile)
            : (obs.sourceFile ?? '') !== reviewImportedGroupFilter)
        ) {
          return false;
        }
        if (reviewAdjustedOnly && (obs.calc == null || obs.residual == null)) return false;
        if (reviewConflictOnly) {
          const absStdRes = Math.abs(obs.stdRes ?? 0);
          const localFailed = obs.localTest?.pass === false;
          if (absStdRes < 2 && !localFailed) return false;
        }
        return matchesReportQuery(obs.type, obs.sourceLine, buildObservationSearchText(obs));
      }),
    [
      excludedIds,
      matchesReportQuery,
      reportExclusionFilter,
      reportObservationTypeFilter,
      reviewAdjustedOnly,
      reviewConflictOnly,
      reviewImportedGroupFilter,
      sortedObs,
    ],
  );
  const importedGroupOptions = useMemo(
    () =>
      [...new Set(sortedObs.map((obs) => obs.sourceFile).filter((value): value is string => Boolean(value)))]
        .sort((left, right) => left.localeCompare(right, undefined, { numeric: true })),
    [sortedObs],
  );
  const observationsByType = useMemo(
    () => groupSortedObservationsByType(filteredSortedObs),
    [filteredSortedObs],
  );
  const byType = (type: Observation['type']): SortedObservation[] =>
    observationsByType.get(type) ?? [];

  const dataCheckDiffRows = useMemo(() => {
    if (!isDataCheck) return [];
    return buildDataCheckDiffRows(result.observations, {
      unitScale,
      linearUnitLabel: units,
      linearUnitSpacer: ' ',
      limit: 25,
    });
  }, [isDataCheck, result.observations, unitScale, units]);
  const blunderCycleLines = useMemo(
    () =>
      isBlunderDetect
        ? result.logs.filter((line) => line.startsWith('Blunder cycle ')).slice(0, 15)
        : [],
    [isBlunderDetect, result.logs],
  );
  const blunderFlaggedCount = useMemo(
    () => result.observations.filter((obs) => Math.abs(obs.stdRes ?? 0) >= 3).length,
    [result.observations],
  );
  const topDirectionTargetSuspects = useMemo(
    () =>
      [...(result.directionTargetDiagnostics ?? [])]
        .filter(
          (d) => d.localPass === false || (d.stdRes ?? 0) >= 2 || (d.rawSpreadArcSec ?? 0) >= 5,
        )
        .slice(0, 20),
    [result.directionTargetDiagnostics],
  );
  const topDirectionRepeatabilitySuspects = useMemo(
    () =>
      [...(result.directionRepeatabilityDiagnostics ?? [])]
        .filter(
          (d) =>
            d.localFailCount > 0 || (d.maxStdRes ?? 0) >= 2 || (d.maxRawSpreadArcSec ?? 0) >= 5,
        )
        .slice(0, 20),
    [result.directionRepeatabilityDiagnostics],
  );
  const traverseLoops = result.traverseDiagnostics?.loops ?? [];
  const traverseLoopSuspects = traverseLoops
    .filter(
      (l) =>
        !l.pass ||
        (l.linearPpm ?? 0) > (result.traverseDiagnostics?.thresholds?.maxLinearPpm ?? 0) * 0.8,
    )
    .slice(0, 20);
  const gpsLoopDiagnostics = result.gpsLoopDiagnostics;
  const gpsLoopSuspects = useMemo(
    () => (gpsLoopDiagnostics?.loops ?? []).filter((loop) => !loop.pass).slice(0, 20),
    [gpsLoopDiagnostics],
  );
  const levelingLoopDiagnostics = result.levelingLoopDiagnostics;
  const levelingLoopSuspects = useMemo(
    () => (levelingLoopDiagnostics?.loops ?? []).filter((loop) => !loop.pass).slice(0, 20),
    [levelingLoopDiagnostics],
  );
  const levelingSegmentSuspects = useMemo(
    () => (levelingLoopDiagnostics?.suspectSegments ?? []).slice(0, 10),
    [levelingLoopDiagnostics],
  );
  const highlightedLevelingSegmentLines = useMemo(
    () =>
      new Set(
        levelingSegmentSuspects
          .map((segment) => segment.sourceLine)
          .filter((line): line is number => line != null),
      ),
    [levelingSegmentSuspects],
  );
  const directionRejects = useMemo(
    () =>
      [...(result.directionRejectDiagnostics ?? [])].sort((a, b) => {
        const la = a.sourceLine ?? Number.MAX_SAFE_INTEGER;
        const lb = b.sourceLine ?? Number.MAX_SAFE_INTEGER;
        if (la !== lb) return la - lb;
        const sa = a.setId ?? '';
        const sb = b.setId ?? '';
        return sa.localeCompare(sb);
      }),
    [result.directionRejectDiagnostics],
  );
  const directionTreatmentDiagnostics = useMemo(
    () =>
      [...(result.parseState?.directionSetTreatmentDiagnostics ?? [])].sort((a, b) => {
        const la = a.sourceLine ?? Number.MAX_SAFE_INTEGER;
        const lb = b.sourceLine ?? Number.MAX_SAFE_INTEGER;
        if (la !== lb) return la - lb;
        if (a.setId !== b.setId) return a.setId.localeCompare(b.setId);
        return a.occupy.localeCompare(b.occupy);
      }),
    [result.parseState?.directionSetTreatmentDiagnostics],
  );
  const visibleTraverseLoopSuspects = visibleRowsFor(
    'traverse-loop-suspects',
    traverseLoopSuspects,
    REPORT_DIAGNOSTIC_WINDOW_SIZE,
  );
  const visibleGpsLoopSuspects = visibleRowsFor(
    'gps-loop-suspects',
    gpsLoopSuspects,
    REPORT_DIAGNOSTIC_WINDOW_SIZE,
  );
  const visibleLevelingLoopSuspects = visibleRowsFor(
    'leveling-loop-suspects',
    levelingLoopSuspects,
    REPORT_DIAGNOSTIC_WINDOW_SIZE,
  );
  const visibleDirectionRejects = visibleRowsFor(
    'direction-reject-diagnostics',
    directionRejects,
    REPORT_DIAGNOSTIC_WINDOW_SIZE,
  );
  const traceabilityModel = useMemo(
    () => buildResultTraceabilityModel(result.parseState),
    [result.parseState],
  );
  const {
    aliasTrace,
    descriptionScanSummary,
    descriptionConflicts,
    descriptionRefsByStation,
    lostStationIds,
    descriptionReconcileMode,
    descriptionAppendDelimiter,
    reconciledDescriptions,
  } = traceabilityModel;
  const clusterDiagnostics = result.clusterDiagnostics;
  const clusterCandidates = useMemo(
    () => clusterDiagnostics?.candidates ?? [],
    [clusterDiagnostics],
  );
  const clusterAppliedMerges =
    clusterDiagnostics?.appliedMerges && clusterDiagnostics.appliedMerges.length > 0
      ? clusterDiagnostics.appliedMerges
      : activeClusterApprovedMerges;
  const clusterMergeOutcomes = clusterDiagnostics?.mergeOutcomes ?? [];
  const clusterRejectedProposals = clusterDiagnostics?.rejectedProposals ?? [];
  const autoAdjustDiagnostics = result.autoAdjustDiagnostics;
  const autoSideshotDiagnostics = result.autoSideshotDiagnostics;
  const autoSideshotObsIds = useMemo(
    () =>
      new Set(
        autoSideshotDiagnostics?.candidates.flatMap((c) => [c.angleObsId, c.distObsId]) ?? [],
      ),
    [autoSideshotDiagnostics],
  );
  const tsSideshots = useMemo(
    () => (result.sideshots ?? []).filter((s) => s.mode !== 'gps'),
    [result.sideshots],
  );
  const gpsSideshots = useMemo(
    () => (result.sideshots ?? []).filter((s) => s.mode === 'gps'),
    [result.sideshots],
  );
  const gpsVectorSideshots = useMemo(
    () => gpsSideshots.filter((s) => s.sourceType !== 'GS'),
    [gpsSideshots],
  );
  const gpsCoordinateSideshots = useMemo(
    () => gpsSideshots.filter((s) => s.sourceType === 'GS'),
    [gpsSideshots],
  );
  const gpsOffsetObservations = useMemo(
    () =>
      result.observations.filter(
        (obs): obs is GpsObservation => obs.type === 'gps' && obs.gpsOffsetDistanceM != null,
      ),
    [result.observations],
  );
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
  const filteredStationRows = useMemo(
    () =>
      Object.entries(result.stations)
        .map(([stationId, station]) => [
          stationId,
          stationWithPrecision(
            station,
            {
              sigmaN: stationCovariances.find((row) => row.stationId === stationId)?.sigmaN ?? station.sN,
              sigmaE: stationCovariances.find((row) => row.stationId === stationId)?.sigmaE ?? station.sE,
              sigmaH: stationCovariances.find((row) => row.stationId === stationId)?.sigmaH ?? station.sH,
              ellipse: stationCovariances.find((row) => row.stationId === stationId)?.ellipse ?? station.errorEllipse,
            },
          ),
        ] as [string, Station])
        .filter(([stationId, station]) =>
          matchesReportQuery(
            stationId,
            reconciledDescriptions[stationId],
            station.fixed ? 'fixed' : 'adjusted',
            station.x,
            station.y,
            station.h,
          ),
        ),
    [matchesReportQuery, reconciledDescriptions, result.stations, stationCovariances],
  );
  const filteredStationCovariances = useMemo(
    () =>
      stationCovariances.filter((block) =>
        matchesReportQuery(
          block.stationId,
          reconciledDescriptions[block.stationId],
          block.cEE,
          block.cEN,
          block.cNN,
          block.cHH,
        ),
      ),
    [matchesReportQuery, reconciledDescriptions, stationCovariances],
  );
  const filteredRelativeCovariances = useMemo(
    () =>
      relativeCovariances.filter((rel) =>
        matchesReportQuery(rel.from, rel.to, rel.connectionTypes.join(' '), rel.sigmaDist, rel.sigmaAz),
      ),
    [matchesReportQuery, relativeCovariances],
  );
  const filteredRelativePrecision = useMemo(
    () => relativePrecisionRows.filter((rel) => matchesReportQuery(rel.from, rel.to, rel.sigmaDist, rel.sigmaAz)),
    [matchesReportQuery, relativePrecisionRows],
  );
  const weakGeometryDiagnostics = result.weakGeometryDiagnostics;
  const preanalysisImpactDiagnostics = result.preanalysisImpactDiagnostics;
  const lockedPreanalysisObservations = useMemo(
    () => (isPreanalysis ? result.observations.filter(isLockedPreanalysisObservation) : []),
    [isPreanalysis, result.observations],
  );
  const flaggedStationCues = useMemo(
    () => (weakGeometryDiagnostics?.stationCues ?? []).filter((cue) => cue.severity !== 'ok'),
    [weakGeometryDiagnostics],
  );
  const flaggedRelativeCues = useMemo(
    () => (weakGeometryDiagnostics?.relativeCues ?? []).filter((cue) => cue.severity !== 'ok'),
    [weakGeometryDiagnostics],
  );
  const clusterReviewStats = useMemo(
    () =>
      clusterCandidates.reduce(
        (acc, candidate) => {
          const decision = clusterReviewDecisions[candidate.key];
          const status = decision?.status ?? 'pending';
          const canonicalId =
            decision && candidate.stationIds.includes(decision.canonicalId)
              ? decision.canonicalId
              : candidate.representativeId;
          if (status === 'approve') {
            acc.approved += 1;
            acc.plannedMerges += candidate.stationIds.filter((id) => id !== canonicalId).length;
          } else if (status === 'reject') {
            acc.rejected += 1;
          } else {
            acc.pending += 1;
          }
          return acc;
        },
        { approved: 0, rejected: 0, pending: 0, plannedMerges: 0 },
      ),
    [clusterCandidates, clusterReviewDecisions],
  );
  const prismAnnotation = useCallback(
    (obs: Observation) => formatPrismAnnotation(obs, unitScale, units),
    [unitScale, units],
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
    <div ref={reportRootRef} className="p-6 font-mono text-sm w-full flex flex-col">
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

      {pendingRunSettingDiffs.length > 0 && (
        <div
          className="mb-4 rounded border border-amber-800/60 bg-amber-950/20 px-4 py-3 text-xs text-amber-100"
          style={{ order: -215 }}
        >
          <div className="font-semibold uppercase tracking-wide text-amber-200">
            Pending rerun settings diff
          </div>
          <div className="mt-2 flex flex-wrap gap-2">
            {pendingRunSettingDiffs.slice(0, 6).map((diff) => (
              <span
                key={diff}
                className="rounded border border-amber-700/60 bg-amber-900/20 px-2 py-1"
              >
                {diff}
              </span>
            ))}
            {pendingRunSettingDiffs.length > 6 ? (
              <span className="rounded border border-amber-700/60 bg-amber-900/20 px-2 py-1">
                +{pendingRunSettingDiffs.length - 6} more
              </span>
            ) : null}
          </div>
        </div>
      )}

      <PinnedSectionsPanel
        pinnedDetailSections={pinnedDetailSections}
        onClearPins={clearPinnedDetailSections}
        onJumpToPinnedSection={jumpToPinnedSection}
      />

      {!isPreanalysis &&
        !isSpecialRunMode &&
        result.suspectImpactDiagnostics &&
        result.suspectImpactDiagnostics.length > 0 && (
          <div
            className="mb-8 border border-slate-800 rounded overflow-hidden"
            style={{ order: -140 }}
          >
            {renderCollapsibleSectionHeader({
              sectionId: 'suspect-impact-analysis',
              label: 'Suspect Impact Analysis (what-if exclusion)',
              className:
                'px-4 py-2 border-b border-slate-800 bg-slate-900/60 text-xs uppercase tracking-wider',
              labelClassName: 'text-slate-100',
            })}
            {!isSectionCollapsed('suspect-impact-analysis') && (
              <table className="w-full text-left text-xs">
              <thead>
                <tr className="text-slate-200 border-b border-slate-700/80">
                  <th className="py-2 px-3">#</th>
                  <th className="py-2">Type</th>
                  <th className="py-2">Stations</th>
                  <th className="py-2 text-right">Line</th>
                  <th className="py-2 text-right">Base |t|</th>
                  <th className="py-2 text-right">dSEUW</th>
                  <th className="py-2 text-right">dMax|t|</th>
                  <th className="py-2 text-right">Chi</th>
                  <th className="py-2 text-right">Max Shift ({units})</th>
                  <th className="py-2 text-right">Score</th>
                  <th className="py-2 text-right px-3">Action</th>
                </tr>
              </thead>
              <tbody className="text-slate-300">
                {result.suspectImpactDiagnostics.map((d, idx) => {
                  const alreadyExcluded = excludedIds.has(d.obsId);
                  return (
                    <tr key={`impact-${d.obsId}-${idx}`} className="border-b border-slate-800/30">
                      <td className="py-1 px-3 text-slate-500">{idx + 1}</td>
                      <td className="py-1 uppercase text-slate-400">{d.type}</td>
                      <td className="py-1">{d.stations}</td>
                      <td className="py-1 text-right font-mono text-slate-500">
                        {renderSourceLineLink(d.sourceLine)}
                      </td>
                      <td className="py-1 text-right font-mono">
                        {d.baseStdRes != null ? d.baseStdRes.toFixed(2) : '-'}
                      </td>
                      <td className="py-1 text-right font-mono">
                        {d.deltaSeuw != null ? d.deltaSeuw.toFixed(4) : '-'}
                      </td>
                      <td className="py-1 text-right font-mono">
                        {d.deltaMaxStdRes != null ? d.deltaMaxStdRes.toFixed(2) : '-'}
                      </td>
                      <td className="py-1 text-right font-mono">{d.chiDelta}</td>
                      <td className="py-1 text-right font-mono">
                        {d.maxCoordShift != null ? (d.maxCoordShift * unitScale).toFixed(4) : '-'}
                      </td>
                      <td className="py-1 text-right font-mono">
                        {d.score != null ? d.score.toFixed(1) : '-'}
                      </td>
                      <td className="py-1 px-3 text-right">
                        <button
                          onClick={() => {
                            const confirmed = confirmActionGuard({
                              action: 'exclude-rerun',
                              scope: `${d.type.toUpperCase()} ${d.stations} (line ${d.sourceLine ?? '-'})`,
                              detail:
                                'This marks the observation excluded and immediately reruns the adjustment.',
                            });
                            if (!confirmed) return;
                            onApplyImpactExclude(d.obsId);
                          }}
                          disabled={alreadyExcluded || d.status !== 'ok'}
                          className={`px-2 py-0.5 rounded border text-[10px] ${
                            alreadyExcluded || d.status !== 'ok'
                              ? 'border-slate-700 text-slate-600 cursor-not-allowed'
                              : 'border-blue-600 text-blue-300 hover:bg-blue-900/30'
                          }`}
                        >
                          {alreadyExcluded
                            ? 'Excluded'
                            : d.status !== 'ok'
                              ? 'N/A'
                              : 'Exclude + Re-run'}
                        </button>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
              </table>
            )}
          </div>
        )}

      {!isSpecialRunMode && (
        <div className="mb-8 border-b border-slate-800 pb-6" style={{ order: -210 }}>
        <h2
          className="text-xl font-bold text-slate-100 mb-4"
          title={REPORT_STATIC_TOOLTIPS['Adjustment Summary']}
        >
          Adjustment Summary
        </h2>
        <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
          <div className="bg-slate-900 p-4 rounded border border-slate-800">
            <span
              className="block text-slate-500 text-xs mb-1"
              title={REPORT_STATIC_TOOLTIPS.STATUS}
            >
              STATUS
            </span>
            <div
              className={`flex items-center space-x-2 ${result.success ? 'text-green-400' : 'text-yellow-500'}`}
            >
              {result.success ? <CheckCircle size={18} /> : <AlertTriangle size={18} />}
              <span className="font-bold">
                {result.success ? 'CONVERGED' : 'NOT CONVERGED / WARNING'}
              </span>
            </div>
          </div>
          <div className="bg-slate-900 p-4 rounded border border-slate-800">
            <span
              className="block text-slate-500 text-xs mb-1"
              title={
                isPreanalysis
                  ? 'Preanalysis uses the a-priori variance factor sigma0^2 = 1.0 and reports predicted precision only.'
                  : 'SEUW = sqrt(vTPv / DOF). Values near 1 usually indicate realistic stochastic modeling.'
              }
            >
              {isPreanalysis ? 'A-PRIORI SIGMA0' : 'STD ERROR UNIT WEIGHT (SEUW)'}
            </span>
            <span
              className={`font-bold text-lg ${result.seuw > 1.5 ? 'text-yellow-400' : 'text-blue-400'}`}
            >
              {result.seuw.toFixed(4)}
            </span>
            <span className="text-slate-600 text-xs ml-2">
              {isPreanalysis ? '(predicted precision)' : `(DOF: ${result.dof})`}
            </span>
            {result.controlConstraints && (
              <div className="text-[10px] text-slate-500 mt-1">
                constraints: {result.controlConstraints.count} (E:{result.controlConstraints.x} N:
                {result.controlConstraints.y} H:{result.controlConstraints.h} corrXY:
                {result.controlConstraints.xyCorrelated ?? 0})
              </div>
            )}
          </div>
          <div className="bg-slate-900 p-4 rounded border border-slate-800 hidden md:block">
            <span
              className="block text-slate-500 text-xs mb-1"
              title={
                isPreanalysis
                  ? 'Residual-based quality-control statistics are disabled in preanalysis mode.'
                  : 'Global model test against expected variance at 95% confidence. PASS means SEUW is statistically consistent with stated precisions.'
              }
            >
              {isPreanalysis ? 'RESIDUAL QC' : 'CHI-SQUARE (95%)'}
            </span>
            {!isPreanalysis && result.chiSquare ? (
              <>
                <div
                  className={`font-bold text-lg ${result.chiSquare.pass95 ? 'text-green-400' : 'text-red-400'}`}
                >
                  {result.chiSquare.pass95 ? 'PASS' : 'FAIL'}
                </div>
                <div className="text-xs text-slate-500">
                  T={result.chiSquare.T.toFixed(2)} p={result.chiSquare.p.toFixed(3)}
                </div>
                <div className="text-[10px] text-slate-500">
                  [{result.chiSquare.lower.toFixed(2)}, {result.chiSquare.upper.toFixed(2)}]
                </div>
                <div className="text-[10px] text-slate-500">
                  vf={result.chiSquare.varianceFactor.toFixed(3)} (
                  {result.chiSquare.varianceFactorLower.toFixed(3)}..
                  {result.chiSquare.varianceFactorUpper.toFixed(3)})
                </div>
                <div className="text-[10px] text-slate-500">
                  ef=(
                  {Math.sqrt(result.chiSquare.varianceFactorLower).toFixed(3)}..
                  {Math.sqrt(result.chiSquare.varianceFactorUpper).toFixed(3)})
                </div>
                {result.condition && (
                  <div
                    className={`text-[10px] ${result.condition.flagged ? 'text-red-400' : 'text-slate-500'}`}
                  >
                    cond={result.condition.estimate.toExponential(2)} /{' '}
                    {result.condition.threshold.toExponential(2)}
                  </div>
                )}
              </>
            ) : (
              <div className="text-xs text-slate-500">
                {isPreanalysis ? 'Disabled for planning runs' : '-'}
              </div>
            )}
          </div>
          <div className="bg-slate-900 p-4 rounded border border-slate-800 hidden md:block">
            <span
              className="block text-slate-500 text-xs mb-1"
              title={REPORT_STATIC_TOOLTIPS['OBSERVATION BREAKDOWN']}
            >
              OBSERVATION BREAKDOWN
            </span>
            <div className="text-xs text-slate-300 space-y-0.5">
              <div>Distances: {byType('dist').length}</div>
              <div>Angles: {byType('angle').length}</div>
              <div>Directions: {byType('direction').length}</div>
              <div>GPS: {byType('gps').length}</div>
              <div>Leveling: {byType('lev').length}</div>
              <div>Bearings: {byType('bearing').length}</div>
              <div>Dirs: {byType('dir').length}</div>
              <div>Zenith: {byType('zenith').length}</div>
              {isPreanalysis && (
                <div>Planned: {result.parseState?.plannedObservationCount ?? 0}</div>
              )}
            </div>
          </div>
        </div>
        </div>
      )}

      {isDataCheck && (
        <div className="mb-6 border border-sky-700/40 rounded bg-sky-950/20" style={{ order: -210 }}>
          <div className="px-3 py-2 text-xs text-sky-200 uppercase tracking-wider border-b border-sky-800/40">
            Data Check Only: Differences from Observations
          </div>
          <div className="px-3 py-2 text-xs text-slate-300">
            Approximate-geometry check only. No least-squares adjustment statistics are produced in
            this mode.
          </div>
          <div className="grid grid-cols-2 md:grid-cols-4 gap-3 px-3 pb-3 text-xs text-slate-300">
            <div className="rounded border border-sky-900/40 bg-slate-950/20 px-3 py-2">
              <div className="text-slate-500">Status</div>
              <div className={result.success ? 'text-sky-200 font-semibold' : 'text-amber-300 font-semibold'}>
                {result.success ? 'CHECK COMPLETED' : 'CHECK WARNING'}
              </div>
            </div>
            <div className="rounded border border-sky-900/40 bg-slate-950/20 px-3 py-2">
              <div className="text-slate-500">Observations Checked</div>
              <div>{result.observations.length}</div>
            </div>
            <div className="rounded border border-sky-900/40 bg-slate-950/20 px-3 py-2">
              <div className="text-slate-500">Direction Sets</div>
              <div>{directionSetCount}</div>
            </div>
            <div className="rounded border border-sky-900/40 bg-slate-950/20 px-3 py-2">
              <div className="text-slate-500">Max |t|</div>
              <div>{maxAbsStdRes.toFixed(2)}</div>
            </div>
          </div>
          <div className="overflow-auto px-3 pb-3">
            <table className="w-full text-xs">
              <thead className="text-slate-400 uppercase border-b border-slate-800">
                <tr>
                  <th className="py-2 text-left">#</th>
                  <th className="py-2 text-left">Type</th>
                  <th className="py-2 text-left">Stations</th>
                  <th className="py-2 text-right">Difference</th>
                  <th className="py-2 text-right">|t|</th>
                  <th className="py-2 text-right">Line</th>
                </tr>
              </thead>
              <tbody>
                {dataCheckDiffRows.map((row, idx) => (
                  <tr
                    key={`data-check-diff-${row.obs.id}-${idx}`}
                    className="border-b border-slate-900/70"
                  >
                    <td className="py-1">{idx + 1}</td>
                    <td className="py-1 uppercase text-slate-400">{row.obs.type}</td>
                    <td className="py-1">{row.stations}</td>
                    <td className="py-1 text-right font-mono">{row.diffLabel}</td>
                    <td className="py-1 text-right font-mono">
                      {row.obs.stdRes != null && Number.isFinite(row.obs.stdRes)
                        ? Math.abs(row.obs.stdRes).toFixed(2)
                        : '-'}
                    </td>
                    <td className="py-1 text-right font-mono text-slate-500">
                      {renderSourceLineLink(row.obs.sourceLine)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {isBlunderDetect && (
        <div
          className="mb-6 border border-amber-700/40 rounded bg-amber-950/20"
          style={{ order: -210 }}
        >
          <div className="px-3 py-2 text-xs text-amber-200 uppercase tracking-wider border-b border-amber-800/40">
            Blunder Detect Mode
          </div>
          <div className="px-3 py-2 text-xs text-slate-300">
            Iterative deweighting diagnostics run. This is screening support and not a replacement
            for full adjustment QA.
          </div>
          <div className="grid grid-cols-2 md:grid-cols-4 gap-3 px-3 pb-3 text-xs text-slate-300">
            <div className="rounded border border-amber-900/40 bg-slate-950/20 px-3 py-2">
              <div className="text-slate-500">Status</div>
              <div className={result.success ? 'text-amber-200 font-semibold' : 'text-red-300 font-semibold'}>
                {result.success ? 'DIAGNOSTIC SOLVE COMPLETED' : 'DIAGNOSTIC WARNING'}
              </div>
            </div>
            <div className="rounded border border-amber-900/40 bg-slate-950/20 px-3 py-2">
              <div className="text-slate-500">Deweight Cycles</div>
              <div>{blunderCycleLines.length}</div>
            </div>
            <div className="rounded border border-amber-900/40 bg-slate-950/20 px-3 py-2">
              <div className="text-slate-500">Remaining |t| &gt;= 3</div>
              <div>{blunderFlaggedCount}</div>
            </div>
            <div className="rounded border border-amber-900/40 bg-slate-950/20 px-3 py-2">
              <div className="text-slate-500">Max |t|</div>
              <div>{maxAbsStdRes.toFixed(2)}</div>
            </div>
          </div>
          {blunderCycleLines.length > 0 && (
            <div className="px-3 pb-3">
              <div className="text-[11px] uppercase tracking-wide text-slate-400 mb-1">
                Cycle Trace
              </div>
              <div className="space-y-1 text-xs text-slate-300">
                {blunderCycleLines.map((line, idx) => (
                  <div key={`blunder-cycle-${idx}`} className="font-mono">
                    {line}
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>
      )}

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
          <div
            className="px-3 py-2 text-xs text-slate-400 uppercase tracking-wider border-b border-slate-800 bg-slate-900/40"
            title={preanalysisLabelTooltip('Locked Planned Observations')}
          >
            Locked Planned Observations
          </div>
          <div className="px-3 py-2 text-xs text-slate-500 bg-slate-950/30 border-b border-slate-800/60">
            These planned rows use fixed sigma weighting, remain visible for context, and are not
            removable from what-if actions.
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
                  <td className="py-1 text-right font-mono">{renderSourceLineLink(obs.sourceLine)}</td>
                  <td className="py-1 text-right font-mono">{observationValueLabel(obs)}</td>
                  <td className="py-1 text-right font-mono">{fixedSigmaLabel(obs)}</td>
                  <td className="py-1 px-3">
                    Locked planned constraint; excluded from what-if actions.
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {isPreanalysis &&
        preanalysisImpactDiagnostics &&
        preanalysisImpactDiagnostics.rows.length > 0 && (
          <div className="mb-6 border border-slate-800 rounded overflow-hidden">
            <div
              className="px-3 py-2 text-xs text-slate-400 uppercase tracking-wider border-b border-slate-800 bg-slate-900/40"
              title={preanalysisLabelTooltip('Planned Observation What-If Analysis')}
            >
              Planned Observation What-If Analysis
            </div>
            <div className="grid grid-cols-2 md:grid-cols-6 gap-3 p-3 text-xs text-slate-300 border-b border-slate-800/60">
              <div>
                <div
                  className="text-slate-500"
                  title={preanalysisLabelTooltip('Removable Planned')}
                >
                  Active Removable
                </div>
                <div>{preanalysisImpactDiagnostics.activePlannedCount}</div>
              </div>
              <div>
                <div
                  className="text-slate-500"
                  title={preanalysisLabelTooltip('Excluded Removable')}
                >
                  Excluded Removable
                </div>
                <div>{preanalysisImpactDiagnostics.excludedPlannedCount}</div>
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
                    ? `${(preanalysisImpactDiagnostics.baseWorstStationMajor * unitScale).toFixed(4)} ${units}`
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
                    ? `${(preanalysisImpactDiagnostics.baseWorstPairSigmaDist * unitScale).toFixed(4)} ${units}`
                    : '-'}
                </div>
              </div>
              <div>
                <div className="text-slate-500" title={preanalysisLabelTooltip('Weak Stations')}>
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
            </div>
            <table className="w-full text-left text-xs">
              <thead>
                <tr className="text-slate-200 border-b border-slate-700/80">
                  <th className="py-2 px-3">#</th>
                  <th className="py-2">Action</th>
                  <th className="py-2">Type</th>
                  <th className="py-2">Stations</th>
                  <th className="py-2 text-right">Line</th>
                  <th className="py-2 text-right">dWorstMaj ({units})</th>
                  <th className="py-2 text-right">dMedianMaj ({units})</th>
                  <th className="py-2 text-right">dWorstPair ({units})</th>
                  <th className="py-2 text-right">dWeakStn</th>
                  <th className="py-2 text-right">dWeakPair</th>
                  <th className="py-2 text-right">Score</th>
                  <th className="py-2 text-right px-3">Apply</th>
                </tr>
              </thead>
              <tbody className="text-slate-300">
                {preanalysisImpactDiagnostics.rows.map((row, idx) => {
                  const alreadyExcluded = excludedIds.has(row.obsId);
                  return (
                    <tr
                      key={`preanalysis-impact-${row.obsId}-${idx}`}
                      className="border-b border-slate-800/30"
                    >
                      <td className="py-1 px-3 text-slate-500">{idx + 1}</td>
                      <td className="py-1 uppercase text-slate-400">
                        {row.action === 'remove' ? 'REMOVE' : 'ADD BACK'}
                      </td>
                      <td className="py-1 uppercase text-slate-400">{row.type}</td>
                      <td className="py-1">{row.stations}</td>
                      <td className="py-1 text-right font-mono text-slate-500">
                        {renderSourceLineLink(row.sourceLine)}
                      </td>
                      <td className="py-1 text-right font-mono">
                        {row.deltaWorstStationMajor != null
                          ? (row.deltaWorstStationMajor * unitScale).toFixed(4)
                          : '-'}
                      </td>
                      <td className="py-1 text-right font-mono">
                        {row.deltaMedianStationMajor != null
                          ? (row.deltaMedianStationMajor * unitScale).toFixed(4)
                          : '-'}
                      </td>
                      <td className="py-1 text-right font-mono">
                        {row.deltaWorstPairSigmaDist != null
                          ? (row.deltaWorstPairSigmaDist * unitScale).toFixed(4)
                          : '-'}
                      </td>
                      <td className="py-1 text-right font-mono">
                        {row.deltaWeakStationCount ?? '-'}
                      </td>
                      <td className="py-1 text-right font-mono">{row.deltaWeakPairCount ?? '-'}</td>
                      <td className="py-1 text-right font-mono">
                        {row.score != null ? row.score.toFixed(2) : '-'}
                      </td>
                      <td className="py-1 px-3 text-right">
                        <button
                          onClick={() => onApplyPreanalysisAction(row.obsId)}
                          disabled={row.status !== 'ok'}
                          className={`px-2 py-0.5 rounded border text-[10px] ${
                            row.status !== 'ok'
                              ? 'border-slate-700 text-slate-600 cursor-not-allowed'
                              : 'border-cyan-700 text-cyan-200 hover:bg-cyan-950/30'
                          }`}
                        >
                          {row.action === 'remove'
                            ? alreadyExcluded
                              ? 'Removed'
                              : 'Remove + Re-run'
                            : alreadyExcluded
                              ? 'Add Back + Re-run'
                              : 'Added'}
                        </button>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}

      {aliasTrace.length > 0 && (
        <div className="mb-6 border border-slate-800 rounded overflow-hidden">
          <div className="px-3 py-2 text-xs text-slate-400 uppercase tracking-wider border-b border-slate-800 bg-slate-900/40">
            Alias Traceability
          </div>
          <div className="grid grid-cols-3 md:grid-cols-5 gap-3 p-3 text-xs text-slate-300 border-b border-slate-800/60">
            <div>
              <div className="text-slate-500">Explicit Maps</div>
              <div>{result.parseState?.aliasExplicitCount ?? 0}</div>
            </div>
            <div>
              <div className="text-slate-500">Pattern Rules</div>
              <div>{result.parseState?.aliasRuleCount ?? 0}</div>
            </div>
            <div>
              <div className="text-slate-500">Remap References</div>
              <div>{aliasTrace.length}</div>
            </div>
            <div className="col-span-2">
              <div className="text-slate-500">Rule Summary</div>
              <div className="truncate">
                {(result.parseState?.aliasRuleSummaries ?? [])
                  .map((r) => `${r.rule} @${r.sourceLine}`)
                  .join('; ') || '-'}
              </div>
            </div>
          </div>
          <div className="overflow-x-auto w-full">
            <table className="w-full text-left border-collapse text-xs">
              <thead>
                <tr className="text-slate-200 border-b border-slate-700">
                  <th className="py-2 px-3 font-semibold">Context</th>
                  <th className="py-2 px-3 font-semibold">Detail</th>
                  <th className="py-2 px-3 font-semibold text-right">Line</th>
                  <th className="py-2 px-3 font-semibold">Source Alias</th>
                  <th className="py-2 px-3 font-semibold">Canonical ID</th>
                  <th className="py-2 px-3 font-semibold">Reference</th>
                </tr>
              </thead>
              <tbody className="text-slate-300">
                {aliasTrace.slice(0, 200).map((entry, idx) => (
                  <tr
                    key={`alias-trace-${entry.context}-${entry.sourceLine ?? 'na'}-${entry.sourceId}-${entry.canonicalId}-${idx}`}
                    className="border-b border-slate-800/50"
                  >
                    <td className="py-1 px-3 uppercase">{entry.context}</td>
                    <td className="py-1 px-3">{entry.detail ?? '-'}</td>
                    <td className="py-1 px-3 text-right text-slate-500">
                      {renderSourceLineLink(entry.sourceLine)}
                    </td>
                    <td className="py-1 px-3 font-mono">{entry.sourceId}</td>
                    <td className="py-1 px-3 font-mono">{entry.canonicalId}</td>
                    <td className="py-1 px-3">{entry.reference ?? '-'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          {aliasTrace.length > 200 && (
            <div className="px-3 py-2 text-[11px] text-slate-500 border-t border-slate-800">
              Showing first 200 rows of {aliasTrace.length}. Full trace available in export output.
            </div>
          )}
        </div>
      )}

      {descriptionScanSummary.length > 0 && (
        <div className="mb-6 border border-slate-800 rounded overflow-hidden">
          <div className="px-3 py-2 text-xs text-slate-400 uppercase tracking-wider border-b border-slate-800 bg-slate-900/40">
            Description Reconciliation Summary
          </div>
          <div className="grid grid-cols-2 md:grid-cols-4 gap-3 p-3 text-xs text-slate-300 border-b border-slate-800/60">
            <div>
              <div className="text-slate-500">Mode</div>
              <div>
                {descriptionReconcileMode.toUpperCase()}
                {descriptionReconcileMode === 'append' ? ` ("${descriptionAppendDelimiter}")` : ''}
              </div>
            </div>
            <div>
              <div className="text-slate-500">Stations</div>
              <div>{descriptionScanSummary.length}</div>
            </div>
            <div>
              <div className="text-slate-500">Repeated IDs</div>
              <div>{result.parseState?.descriptionRepeatedStationCount ?? 0}</div>
            </div>
            <div>
              <div className="text-slate-500">Conflicts</div>
              <div className={descriptionConflicts.length > 0 ? 'text-amber-300' : ''}>
                {descriptionConflicts.length}
              </div>
            </div>
          </div>
          <div className="overflow-x-auto w-full">
            <table className="w-full text-left border-collapse text-xs">
              <thead>
                <tr className="text-slate-200 border-b border-slate-700">
                  <th className="py-2 px-3 font-semibold">Station</th>
                  <th className="py-2 px-3 font-semibold text-right">Records</th>
                  <th className="py-2 px-3 font-semibold text-right">Unique</th>
                  <th className="py-2 px-3 font-semibold text-center">Conflict</th>
                  <th className="py-2 px-3 font-semibold">Descriptions (line refs)</th>
                </tr>
              </thead>
              <tbody className="text-slate-300">
                {descriptionScanSummary.map((row) => {
                  const details = (descriptionRefsByStation.get(row.stationId) ?? [])
                    .map((detail) => {
                      const lines = detail.lines
                        .slice()
                        .sort((a, b) => a - b)
                        .join(', ');
                      return `${detail.description} [${lines}]`;
                    })
                    .join(' ; ');
                  return (
                    <tr
                      key={`desc-summary-${row.stationId}`}
                      className="border-b border-slate-800/50"
                    >
                      <td className="py-1 px-3 font-mono">{row.stationId}</td>
                      <td className="py-1 px-3 text-right">{row.recordCount}</td>
                      <td className="py-1 px-3 text-right">{row.uniqueCount}</td>
                      <td className="py-1 px-3 text-center">
                        {row.conflict ? (
                          <span className="text-amber-300 font-semibold">YES</span>
                        ) : (
                          <span className="text-slate-500">no</span>
                        )}
                      </td>
                      <td className="py-1 px-3 text-slate-400">{details || '-'}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {clusterDiagnostics?.enabled && (
        <div
          className="mb-6 border border-slate-800 rounded overflow-hidden"
          style={{ order: -208 }}
        >
          <div className="px-3 py-2 text-xs text-slate-400 uppercase tracking-wider border-b border-slate-800 bg-slate-900/40">
            Cluster Detection Candidates
          </div>
          <div className="grid grid-cols-2 md:grid-cols-12 gap-3 p-3 text-xs text-slate-300 border-b border-slate-800/60">
            <div>
              <div className="text-slate-500">Pass</div>
              <div>{clusterDiagnostics.passMode.toUpperCase()}</div>
            </div>
            <div>
              <div className="text-slate-500">Mode</div>
              <div>{clusterDiagnostics.linkageMode.toUpperCase()}</div>
            </div>
            <div>
              <div className="text-slate-500">Dimension</div>
              <div>{clusterDiagnostics.dimension}</div>
            </div>
            <div>
              <div className="text-slate-500">Tolerance</div>
              <div>
                {(clusterDiagnostics.tolerance * unitScale).toFixed(4)} {units}
              </div>
            </div>
            <div>
              <div className="text-slate-500">Pair Hits</div>
              <div>{clusterDiagnostics.pairCount}</div>
            </div>
            <div>
              <div className="text-slate-500">Candidates</div>
              <div>{clusterDiagnostics.candidateCount}</div>
            </div>
            <div>
              <div className="text-slate-500">Approved Merges</div>
              <div>{clusterDiagnostics.approvedMergeCount ?? 0}</div>
            </div>
            <div>
              <div className="text-slate-500">Coverage</div>
              <div>{clusterCandidates.length > 0 ? 'Needs Review' : 'No Clusters'}</div>
            </div>
            <div>
              <div className="text-slate-500">Pending</div>
              <div>{clusterReviewStats.pending}</div>
            </div>
            <div>
              <div className="text-slate-500">Approved</div>
              <div>{clusterReviewStats.approved}</div>
            </div>
            <div>
              <div className="text-slate-500">Rejected</div>
              <div>{clusterReviewStats.rejected}</div>
            </div>
            <div>
              <div className="text-slate-500">Planned Merges</div>
              <div>{clusterReviewStats.plannedMerges}</div>
            </div>
            <div>
              <div className="text-slate-500">Merge Outcomes</div>
              <div>{clusterMergeOutcomes.length}</div>
            </div>
            <div>
              <div className="text-slate-500">Rejected Proposals</div>
              <div>{clusterRejectedProposals.length}</div>
            </div>
          </div>
          {clusterCandidates.length > 0 ? (
            <div className="overflow-x-auto w-full">
              <div className="flex items-center gap-2 px-3 py-2 border-b border-slate-800 text-xs bg-slate-900/20">
                <button
                  onClick={() => {
                    const confirmed = confirmActionGuard({
                      action: 'cluster-apply',
                      scope: `${clusterReviewStats.plannedMerges} approved merge(s)`,
                      detail:
                        'This rewrites aliases to canonical IDs for approved candidates and reruns the adjustment.',
                    });
                    if (!confirmed) return;
                    onApplyClusterMerges();
                  }}
                  disabled={clusterReviewStats.plannedMerges === 0}
                  className={`px-3 py-1 rounded border ${
                    clusterReviewStats.plannedMerges === 0
                      ? 'border-slate-700 text-slate-600 cursor-not-allowed'
                      : 'border-blue-600 text-blue-300 hover:bg-blue-900/30'
                  }`}
                >
                  Apply Approved Merges + Re-run
                </button>
                <button
                  onClick={onResetClusterReview}
                  className="px-3 py-1 rounded border border-slate-700 text-slate-300 hover:bg-slate-800/60"
                >
                  Reset Review
                </button>
                {clusterAppliedMerges.length > 0 && (
                  <button
                    onClick={() => {
                      const confirmed = confirmActionGuard({
                        action: 'cluster-revert',
                        scope: `${clusterAppliedMerges.length} applied merge(s)`,
                        detail:
                          'This clears applied merge decisions and reruns without cluster merge aliases.',
                      });
                      if (!confirmed) return;
                      onClearClusterMerges();
                    }}
                    className="px-3 py-1 rounded border border-amber-600 text-amber-300 hover:bg-amber-900/30"
                  >
                    Clear Applied Merges + Re-run
                  </button>
                )}
              </div>
              <table className="w-full text-left border-collapse text-xs">
                <thead>
                  <tr className="text-slate-200 border-b border-slate-700">
                    <th className="py-2 px-3 font-semibold">Key</th>
                    <th className="py-2 px-3 font-semibold">Representative</th>
                    <th className="py-2 px-3 font-semibold">Action</th>
                    <th className="py-2 px-3 font-semibold">Retain</th>
                    <th className="py-2 px-3 font-semibold text-right">Members</th>
                    <th className="py-2 px-3 font-semibold text-right">Max Sep ({units})</th>
                    <th className="py-2 px-3 font-semibold text-right">Mean Sep ({units})</th>
                    <th className="py-2 px-3 font-semibold">Flags</th>
                    <th className="py-2 px-3 font-semibold">Station IDs</th>
                    <th className="py-2 px-3 font-semibold text-right">Planned Merges</th>
                  </tr>
                </thead>
                <tbody className="text-slate-300">
                  {clusterCandidates.map((c) => {
                    const decision = clusterReviewDecisions[c.key];
                    const action = decision?.status ?? 'pending';
                    const retainId =
                      decision && c.stationIds.includes(decision.canonicalId)
                        ? decision.canonicalId
                        : c.representativeId;
                    const plannedMerges =
                      action === 'approve'
                        ? c.stationIds.filter((id) => id !== retainId).length
                        : 0;
                    return (
                      <tr key={c.key} className="border-b border-slate-800/50">
                        <td className="py-1 px-3 font-mono">{c.key}</td>
                        <td className="py-1 px-3 font-mono">{c.representativeId}</td>
                        <td className="py-1 px-3">
                          <select
                            value={action}
                            onChange={(e) =>
                              onClusterDecisionStatus(
                                c.key,
                                e.target.value as 'pending' | 'approve' | 'reject',
                              )
                            }
                            className="bg-slate-900 border border-slate-700 rounded px-2 py-0.5 text-xs"
                          >
                            <option value="pending">Pending</option>
                            <option value="approve">Approve</option>
                            <option value="reject">Reject</option>
                          </select>
                        </td>
                        <td className="py-1 px-3">
                          <select
                            value={retainId}
                            onChange={(e) => onClusterCanonicalSelection(c.key, e.target.value)}
                            disabled={action === 'reject'}
                            className="bg-slate-900 border border-slate-700 rounded px-2 py-0.5 text-xs disabled:opacity-50 disabled:cursor-not-allowed"
                          >
                            {c.stationIds.map((stationId) => (
                              <option key={`${c.key}-retain-${stationId}`} value={stationId}>
                                {stationId}
                              </option>
                            ))}
                          </select>
                        </td>
                        <td className="py-1 px-3 text-right">{c.memberCount}</td>
                        <td className="py-1 px-3 text-right">
                          {(c.maxSeparation * unitScale).toFixed(4)}
                        </td>
                        <td className="py-1 px-3 text-right">
                          {(c.meanSeparation * unitScale).toFixed(4)}
                        </td>
                        <td className="py-1 px-3">
                          {c.hasFixed ? 'fixed' : 'free'}
                          {c.hasUnknown ? ' + unknown' : ''}
                        </td>
                        <td className="py-1 px-3 font-mono">{c.stationIds.join(', ')}</td>
                        <td className="py-1 px-3 text-right font-mono">{plannedMerges}</td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          ) : (
            <div className="p-3 text-xs text-slate-500">
              No stations fell inside the current cluster tolerance.
            </div>
          )}
          {clusterAppliedMerges.length > 0 && (
            <div className="border-t border-slate-800">
              <div className="px-3 py-2 text-[11px] uppercase tracking-wider text-slate-500 bg-slate-900/20">
                Applied Cluster Merges
              </div>
              <div className="overflow-x-auto w-full">
                <table className="w-full text-left border-collapse text-xs">
                  <thead>
                    <tr className="text-slate-200 border-b border-slate-700">
                      <th className="py-2 px-3 font-semibold">Alias</th>
                      <th className="py-2 px-3 font-semibold">Canonical</th>
                    </tr>
                  </thead>
                  <tbody className="text-slate-300">
                    {clusterAppliedMerges.map((merge, idx) => (
                      <tr
                        key={`cluster-merge-${merge.aliasId}-${merge.canonicalId}-${idx}`}
                        className="border-b border-slate-800/50"
                      >
                        <td className="py-1 px-3 font-mono">{merge.aliasId}</td>
                        <td className="py-1 px-3 font-mono">{merge.canonicalId}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          )}
          {clusterMergeOutcomes.length > 0 && (
            <div className="border-t border-slate-800">
              <div className="px-3 py-2 text-[11px] uppercase tracking-wider text-slate-500 bg-slate-900/20">
                Cluster Merge Outcomes (Delta From Retained Point)
              </div>
              <div className="overflow-x-auto w-full">
                <table className="w-full text-left border-collapse text-xs">
                  <thead>
                    <tr className="text-slate-200 border-b border-slate-700">
                      <th className="py-2 px-3 font-semibold">Alias</th>
                      <th className="py-2 px-3 font-semibold">Canonical</th>
                      <th className="py-2 px-3 font-semibold text-right">dE ({units})</th>
                      <th className="py-2 px-3 font-semibold text-right">dN ({units})</th>
                      <th className="py-2 px-3 font-semibold text-right">dH ({units})</th>
                      <th className="py-2 px-3 font-semibold text-right">d2D ({units})</th>
                      <th className="py-2 px-3 font-semibold text-right">d3D ({units})</th>
                      <th className="py-2 px-3 font-semibold">Status</th>
                    </tr>
                  </thead>
                  <tbody className="text-slate-300">
                    {clusterMergeOutcomes.map((row, idx) => (
                      <tr
                        key={`cluster-merge-outcome-${row.aliasId}-${row.canonicalId}-${idx}`}
                        className="border-b border-slate-800/50"
                      >
                        <td className="py-1 px-3 font-mono">{row.aliasId}</td>
                        <td className="py-1 px-3 font-mono">{row.canonicalId}</td>
                        <td className="py-1 px-3 text-right font-mono">
                          {row.deltaE != null ? (row.deltaE * unitScale).toFixed(4) : '-'}
                        </td>
                        <td className="py-1 px-3 text-right font-mono">
                          {row.deltaN != null ? (row.deltaN * unitScale).toFixed(4) : '-'}
                        </td>
                        <td className="py-1 px-3 text-right font-mono">
                          {row.deltaH != null ? (row.deltaH * unitScale).toFixed(4) : '-'}
                        </td>
                        <td className="py-1 px-3 text-right font-mono">
                          {row.horizontalDelta != null
                            ? (row.horizontalDelta * unitScale).toFixed(4)
                            : '-'}
                        </td>
                        <td className="py-1 px-3 text-right font-mono">
                          {row.spatialDelta != null
                            ? (row.spatialDelta * unitScale).toFixed(4)
                            : '-'}
                        </td>
                        <td className="py-1 px-3">{row.missing ? 'Missing pass1 data' : 'OK'}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          )}
          {clusterRejectedProposals.length > 0 && (
            <div className="border-t border-slate-800">
              <div className="px-3 py-2 text-[11px] uppercase tracking-wider text-slate-500 bg-slate-900/20">
                Rejected Cluster Proposals
              </div>
              <div className="overflow-x-auto w-full">
                <table className="w-full text-left border-collapse text-xs">
                  <thead>
                    <tr className="text-slate-200 border-b border-slate-700">
                      <th className="py-2 px-3 font-semibold">Key</th>
                      <th className="py-2 px-3 font-semibold">Representative</th>
                      <th className="py-2 px-3 font-semibold text-right">Members</th>
                      <th className="py-2 px-3 font-semibold">Retained</th>
                      <th className="py-2 px-3 font-semibold">Station IDs</th>
                      <th className="py-2 px-3 font-semibold">Reason</th>
                    </tr>
                  </thead>
                  <tbody className="text-slate-300">
                    {clusterRejectedProposals.map((row, idx) => (
                      <tr
                        key={`cluster-reject-${row.key}-${idx}`}
                        className="border-b border-slate-800/50"
                      >
                        <td className="py-1 px-3 font-mono">{row.key}</td>
                        <td className="py-1 px-3 font-mono">{row.representativeId}</td>
                        <td className="py-1 px-3 text-right">{row.memberCount}</td>
                        <td className="py-1 px-3 font-mono">{row.retainedId ?? '-'}</td>
                        <td className="py-1 px-3 font-mono">{row.stationIds.join(', ')}</td>
                        <td className="py-1 px-3">{row.reason}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          )}
        </div>
      )}

      {!isSpecialRunMode && autoAdjustDiagnostics?.enabled && (
        <div
          className="mb-6 border border-slate-800 rounded overflow-hidden"
          style={{ order: -207 }}
        >
          {renderCollapsibleSectionHeader({
            sectionId: 'auto-adjust-diagnostics',
            label: 'Auto-Adjust Diagnostics',
            className:
              'px-3 py-2 text-xs uppercase tracking-wider border-b border-slate-700 bg-slate-800/75',
            labelClassName: 'text-slate-100',
          })}
          {!isSectionCollapsed('auto-adjust-diagnostics') && (
            <>
              <div className="grid grid-cols-2 md:grid-cols-6 gap-3 p-3 text-xs text-slate-300 border-b border-slate-800/60">
            <div>
              <div className="text-slate-500">Threshold</div>
              <div>|t| &gt;= {autoAdjustDiagnostics.threshold.toFixed(2)}</div>
            </div>
            <div>
              <div className="text-slate-500">Max Cycles</div>
              <div>{autoAdjustDiagnostics.maxCycles}</div>
            </div>
            <div>
              <div className="text-slate-500">Max Removals/Cycle</div>
              <div>{autoAdjustDiagnostics.maxRemovalsPerCycle}</div>
            </div>
            <div>
              <div className="text-slate-500">Min Redundancy</div>
              <div>{autoAdjustDiagnostics.minRedundancy.toFixed(2)}</div>
            </div>
            <div>
              <div className="text-slate-500">Stop Reason</div>
              <div>{autoAdjustDiagnostics.stopReason}</div>
            </div>
            <div>
              <div className="text-slate-500">Total Removed</div>
              <div>{autoAdjustDiagnostics.removed.length}</div>
            </div>
              </div>
              <div className="overflow-x-auto w-full border-b border-slate-800">
            <table className="w-full text-left border-collapse text-xs">
              <thead>
                <tr className="text-slate-200 border-b border-slate-700">
                  <th className="py-2 px-3 font-semibold text-right">Cycle</th>
                  <th className="py-2 px-3 font-semibold text-right">SEUW</th>
                  <th className="py-2 px-3 font-semibold text-right">Max |t|</th>
                  <th className="py-2 px-3 font-semibold text-right">Removals</th>
                </tr>
              </thead>
              <tbody className="text-slate-300">
                {autoAdjustDiagnostics.cycles.map((cycle) => (
                  <tr key={`auto-cycle-${cycle.cycle}`} className="border-b border-slate-800/50">
                    <td className="py-1 px-3 text-right">{cycle.cycle}</td>
                    <td className="py-1 px-3 text-right font-mono">{cycle.seuw.toFixed(4)}</td>
                    <td className="py-1 px-3 text-right font-mono">
                      {cycle.maxAbsStdRes.toFixed(2)}
                    </td>
                    <td className="py-1 px-3 text-right">{cycle.removals.length}</td>
                  </tr>
                ))}
              </tbody>
            </table>
              </div>
              {autoAdjustDiagnostics.removed.length > 0 && (
                <div className="overflow-x-auto w-full">
              <table className="w-full text-left border-collapse text-xs">
                <thead>
                  <tr className="text-slate-200 border-b border-slate-700">
                    <th className="py-2 px-3 font-semibold text-right">Obs ID</th>
                    <th className="py-2 px-3 font-semibold">Type</th>
                    <th className="py-2 px-3 font-semibold">Stations</th>
                    <th className="py-2 px-3 font-semibold text-right">Line</th>
                    <th className="py-2 px-3 font-semibold text-right">|t|</th>
                    <th className="py-2 px-3 font-semibold text-right">Redund</th>
                    <th className="py-2 px-3 font-semibold">Reason</th>
                  </tr>
                </thead>
                <tbody className="text-slate-300">
                  {autoAdjustDiagnostics.removed.map((row, idx) => (
                    <tr
                      key={`auto-removed-${row.obsId}-${row.sourceLine ?? 'na'}-${idx}`}
                      className="border-b border-slate-800/50"
                    >
                      <td className="py-1 px-3 text-right font-mono">{row.obsId}</td>
                      <td className="py-1 px-3 uppercase">{row.type}</td>
                      <td className="py-1 px-3 font-mono">{row.stations}</td>
                      <td className="py-1 px-3 text-right">{renderSourceLineLink(row.sourceLine)}</td>
                      <td className="py-1 px-3 text-right font-mono">{row.stdRes.toFixed(2)}</td>
                      <td className="py-1 px-3 text-right font-mono">
                        {row.redundancy != null ? row.redundancy.toFixed(3) : '-'}
                      </td>
                      <td className="py-1 px-3">{row.reason}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
                </div>
              )}
            </>
          )}
        </div>
      )}

      {showAutoSideshotDiagnosticsSection && (
        <div className="mb-6 border border-slate-800 rounded overflow-hidden">
          {renderCollapsibleSectionHeader({
            sectionId: 'auto-sideshot-candidates',
            label: 'Auto Sideshot Candidates (M Records)',
            className:
              'px-3 py-2 text-xs uppercase tracking-wider border-b border-slate-700 bg-slate-800/75',
            labelClassName: 'text-slate-100',
          })}
          {!isSectionCollapsed('auto-sideshot-candidates') && (
            <>
              <div className="grid grid-cols-2 md:grid-cols-4 gap-3 p-3 text-xs text-slate-300 border-b border-slate-800/60">
            <div>
              <div className="text-slate-500">Evaluated M Pairs</div>
              <div>{autoSideshotDiagnostics.evaluatedCount}</div>
            </div>
            <div>
              <div className="text-slate-500">Candidates</div>
              <div>{autoSideshotDiagnostics.candidateCount}</div>
            </div>
            <div>
              <div className="text-slate-500">Excluded Control Targets</div>
              <div>{autoSideshotDiagnostics.excludedControlCount}</div>
            </div>
            <div>
              <div className="text-slate-500">Min Redundancy Threshold</div>
              <div>{autoSideshotDiagnostics.threshold.toFixed(2)}</div>
            </div>
              </div>
              <div className="overflow-x-auto w-full">
            <table className="w-full text-left border-collapse text-xs">
              <thead>
                <tr className="text-slate-200 border-b border-slate-700">
                  <th className="py-2 px-3 font-semibold text-right">Line</th>
                  <th className="py-2 px-3 font-semibold">Occupy</th>
                  <th className="py-2 px-3 font-semibold">Backsight</th>
                  <th className="py-2 px-3 font-semibold">Target</th>
                  <th className="py-2 px-3 font-semibold text-right">Angle Obs</th>
                  <th className="py-2 px-3 font-semibold text-right">Dist Obs</th>
                  <th className="py-2 px-3 font-semibold text-right">Angle Red</th>
                  <th className="py-2 px-3 font-semibold text-right">Dist Red</th>
                  <th className="py-2 px-3 font-semibold text-right">Min Red</th>
                  <th className="py-2 px-3 font-semibold text-right">Max |t|</th>
                </tr>
              </thead>
              <tbody className="text-slate-300">
                {autoSideshotDiagnostics.candidates.map((row, idx) => (
                  <tr
                    key={`auto-sideshot-${row.sourceLine ?? 'na'}-${row.target}-${idx}`}
                    className="border-b border-slate-800/50"
                  >
                    <td className="py-1 px-3 text-right font-mono">
                      {renderSourceLineLink(row.sourceLine)}
                    </td>
                    <td className="py-1 px-3 font-mono">{row.occupy}</td>
                    <td className="py-1 px-3 font-mono">{row.backsight}</td>
                    <td className="py-1 px-3 font-mono">{row.target}</td>
                    <td className="py-1 px-3 text-right font-mono">{row.angleObsId}</td>
                    <td className="py-1 px-3 text-right font-mono">{row.distObsId}</td>
                    <td className="py-1 px-3 text-right font-mono">
                      {row.angleRedundancy.toFixed(3)}
                    </td>
                    <td className="py-1 px-3 text-right font-mono">
                      {row.distRedundancy.toFixed(3)}
                    </td>
                    <td className="py-1 px-3 text-right font-mono">
                      {row.minRedundancy.toFixed(3)}
                    </td>
                    <td className="py-1 px-3 text-right font-mono">
                      {row.maxAbsStdRes.toFixed(2)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
              </div>
            </>
          )}
        </div>
      )}

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
      />

      {!isPreanalysis &&
        !isDataCheck &&
        result.setupDiagnostics &&
        result.setupDiagnostics.length > 0 && (
        <div
          className="mb-8 border border-slate-800 rounded overflow-hidden"
          style={{ order: -160 }}
        >
          {renderCollapsibleSectionHeader({
            sectionId: 'setup-diagnostics',
            label: 'Setup Diagnostics',
            className:
              'px-3 py-2 text-xs uppercase tracking-wider border-b border-slate-700 bg-slate-800/75',
            labelClassName: 'text-slate-100',
          })}
          {!isSectionCollapsed('setup-diagnostics') && (
            <div className="overflow-x-auto w-full">
            <table className="w-full text-left border-collapse text-xs">
              <thead>
                <tr className="text-slate-200 border-b border-slate-700">
                  <th className="py-2 px-3 font-semibold">Setup</th>
                  <th className="py-2 px-3 font-semibold text-right">Dir Sets</th>
                  <th className="py-2 px-3 font-semibold text-right">Dir Obs</th>
                  <th className="py-2 px-3 font-semibold text-right">Angles</th>
                  <th className="py-2 px-3 font-semibold text-right">Dist</th>
                  <th className="py-2 px-3 font-semibold text-right">Zen</th>
                  <th className="py-2 px-3 font-semibold text-right">Lev</th>
                  <th className="py-2 px-3 font-semibold text-right">GPS</th>
                  <th className="py-2 px-3 font-semibold text-right">Trav Dist ({units})</th>
                  <th className="py-2 px-3 font-semibold text-right">Orient RMS (")</th>
                  <th className="py-2 px-3 font-semibold text-right">Orient SE (")</th>
                  <th className="py-2 px-3 font-semibold text-right">RMS |t|</th>
                  <th className="py-2 px-3 font-semibold text-right">Max |t|</th>
                  <th className="py-2 px-3 font-semibold text-right">Local Fail</th>
                  <th className="py-2 px-3 font-semibold">Worst Obs</th>
                  <th className="py-2 px-3 font-semibold text-right">Line</th>
                </tr>
              </thead>
              <tbody className="text-slate-300">
                {result.setupDiagnostics.map((s) => (
                  <tr key={s.station} className="border-b border-slate-800/50">
                    <td className="py-1 px-3">{s.station}</td>
                    <td className="py-1 px-3 text-right">{s.directionSetCount}</td>
                    <td className="py-1 px-3 text-right">{s.directionObsCount}</td>
                    <td className="py-1 px-3 text-right">{s.angleObsCount}</td>
                    <td className="py-1 px-3 text-right">{s.distanceObsCount}</td>
                    <td className="py-1 px-3 text-right">{s.zenithObsCount}</td>
                    <td className="py-1 px-3 text-right">{s.levelingObsCount}</td>
                    <td className="py-1 px-3 text-right">{s.gpsObsCount}</td>
                    <td className="py-1 px-3 text-right">
                      {(s.traverseDistance * unitScale).toFixed(3)}
                    </td>
                    <td className="py-1 px-3 text-right">
                      {s.orientationRmsArcSec != null ? s.orientationRmsArcSec.toFixed(2) : '-'}
                    </td>
                    <td className="py-1 px-3 text-right">
                      {s.orientationSeArcSec != null ? s.orientationSeArcSec.toFixed(2) : '-'}
                    </td>
                    <td className="py-1 px-3 text-right">
                      {s.rmsStdRes != null ? s.rmsStdRes.toFixed(2) : '-'}
                    </td>
                    <td className="py-1 px-3 text-right">
                      {s.maxStdRes != null ? s.maxStdRes.toFixed(2) : '-'}
                    </td>
                    <td className="py-1 px-3 text-right">{s.localFailCount}</td>
                    <td className="py-1 px-3 text-slate-400">
                      {s.worstObsType != null
                        ? `${s.worstObsType.toUpperCase()} ${s.worstObsStations ?? ''}`.trim()
                        : '-'}
                    </td>
                    <td className="py-1 px-3 text-right text-slate-500">{s.worstObsLine ?? '-'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
            </div>
          )}
        </div>
      )}

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

      {!isDataCheck && gpsOffsetObservations.length > 0 && (
        <div className="mb-8 border border-slate-800 rounded overflow-hidden">
          {renderCollapsibleSectionHeader({
            sectionId: 'gps-rover-offsets',
            label: 'GPS Rover Offsets',
            className:
              'px-3 py-2 text-xs uppercase tracking-wider border-b border-slate-700 bg-slate-800/75',
            labelClassName: 'text-slate-100',
          })}
          {!isSectionCollapsed('gps-rover-offsets') && <div className="overflow-x-auto w-full">
            <table className="w-full text-left border-collapse text-xs">
              <thead>
                <tr className="text-slate-200 border-b border-slate-700">
                  <th className="py-2 px-3 font-semibold">From</th>
                  <th className="py-2 px-3 font-semibold">To</th>
                  <th className="py-2 px-3 font-semibold text-right">G Line</th>
                  <th className="py-2 px-3 font-semibold text-right">G4 Line</th>
                  <th className="py-2 px-3 font-semibold text-right">Az</th>
                  <th className="py-2 px-3 font-semibold text-right">Slope ({units})</th>
                  <th className="py-2 px-3 font-semibold text-right">Zenith</th>
                  <th className="py-2 px-3 font-semibold text-right">dE ({units})</th>
                  <th className="py-2 px-3 font-semibold text-right">dN ({units})</th>
                  <th className="py-2 px-3 font-semibold text-right">dH ({units})</th>
                </tr>
              </thead>
              <tbody className="text-slate-300">
                {gpsOffsetObservations.map((obs) => (
                  <tr
                    key={`gps-offset-${obs.id}-${obs.gpsOffsetSourceLine ?? obs.sourceLine ?? obs.id}`}
                    className="border-b border-slate-800/30"
                  >
                    <td className="py-1 px-3">{obs.from}</td>
                    <td className="py-1 px-3">{obs.to}</td>
                    <td className="py-1 px-3 text-right">{renderSourceLineLink(obs.sourceLine)}</td>
                    <td className="py-1 px-3 text-right">{obs.gpsOffsetSourceLine ?? '-'}</td>
                    <td className="py-1 px-3 text-right">
                      {obs.gpsOffsetAzimuthRad != null ? radToDmsStr(obs.gpsOffsetAzimuthRad) : '-'}
                    </td>
                    <td className="py-1 px-3 text-right">
                      {obs.gpsOffsetDistanceM != null
                        ? (obs.gpsOffsetDistanceM * unitScale).toFixed(4)
                        : '-'}
                    </td>
                    <td className="py-1 px-3 text-right">
                      {obs.gpsOffsetZenithRad != null ? radToDmsStr(obs.gpsOffsetZenithRad) : '-'}
                    </td>
                    <td className="py-1 px-3 text-right">
                      {obs.gpsOffsetDeltaE != null
                        ? (obs.gpsOffsetDeltaE * unitScale).toFixed(4)
                        : '-'}
                    </td>
                    <td className="py-1 px-3 text-right">
                      {obs.gpsOffsetDeltaN != null
                        ? (obs.gpsOffsetDeltaN * unitScale).toFixed(4)
                        : '-'}
                    </td>
                    <td className="py-1 px-3 text-right">
                      {obs.gpsOffsetDeltaH != null
                        ? (obs.gpsOffsetDeltaH * unitScale).toFixed(4)
                        : '-'}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>}
        </div>
        )}

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

      {isPreanalysis && filteredStationCovariances.length > 0 && (
        <div className="mb-4 border border-slate-800 rounded">
          <div
            className="px-3 py-2 text-xs text-slate-400 uppercase tracking-wider border-b border-slate-800"
            title={preanalysisLabelTooltip('Station Covariance Blocks Section')}
          >
            Station Covariance Blocks ({units}^2)
          </div>
          <div className="overflow-x-auto w-full">
            <table className="w-full text-left border-collapse text-xs">
              <thead>
                <tr className="text-slate-200 border-b border-slate-700">
                  <th className="py-2 px-3 font-semibold">Station</th>
                  <th className="py-2 px-3 font-semibold text-right">CEE</th>
                  <th className="py-2 px-3 font-semibold text-right">CEN</th>
                  <th className="py-2 px-3 font-semibold text-right">CNN</th>
                  {!result.parseState?.coordMode || result.parseState.coordMode === '3D' ? (
                    <th className="py-2 px-3 font-semibold text-right">CHH</th>
                  ) : null}
                </tr>
              </thead>
              <tbody className="text-slate-300">
                {visibleRowsFor('station-covariances', filteredStationCovariances).map((block) => (
                  <tr
                    key={`station-cov-${block.stationId}`}
                    className="border-b border-slate-800/50"
                  >
                    <td className="py-1 px-3">{block.stationId}</td>
                    <td className="py-1 px-3 text-right">
                      {(block.cEE * covarianceScale).toExponential(4)}
                    </td>
                    <td className="py-1 px-3 text-right">
                      {(block.cEN * covarianceScale).toExponential(4)}
                    </td>
                    <td className="py-1 px-3 text-right">
                      {(block.cNN * covarianceScale).toExponential(4)}
                    </td>
                    {!result.parseState?.coordMode || result.parseState.coordMode === '3D' ? (
                      <td className="py-1 px-3 text-right">
                        {block.cHH != null ? (block.cHH * covarianceScale).toExponential(4) : '-'}
                      </td>
                    ) : null}
                  </tr>
                ))}
              </tbody>
            </table>
            {renderLoadMoreFooter(
              'station-covariances',
              visibleRowsFor('station-covariances', filteredStationCovariances).length,
              filteredStationCovariances.length,
            )}
          </div>
        </div>
      )}

      {isPreanalysis && filteredRelativeCovariances.length > 0 && (
        <div className="mb-4 border border-slate-800 rounded">
          <div
            className="px-3 py-2 text-xs text-slate-400 uppercase tracking-wider border-b border-slate-800"
            title={preanalysisLabelTooltip('Predicted Relative Precision (Connected Pairs)')}
          >
            Predicted Relative Precision (Connected Pairs)
          </div>
          <div className="overflow-x-auto w-full">
            <table className="w-full text-left border-collapse text-xs">
              <thead>
                <tr className="text-slate-200 border-b border-slate-700">
                  <th className="py-2 px-3 font-semibold">From</th>
                  <th className="py-2 px-3 font-semibold">To</th>
                  <th className="py-2 px-3 font-semibold">Types</th>
                  <th className="py-2 px-3 font-semibold text-right">σN</th>
                  <th className="py-2 px-3 font-semibold text-right">σE</th>
                  <th className="py-2 px-3 font-semibold text-right">σDist</th>
                  <th className="py-2 px-3 font-semibold text-right">σAz (")</th>
                  <th className="py-2 px-3 font-semibold text-right">CEE</th>
                  <th className="py-2 px-3 font-semibold text-right">CEN</th>
                  <th className="py-2 px-3 font-semibold text-right">CNN</th>
                </tr>
              </thead>
              <tbody className="text-slate-300">
                {visibleRowsFor('relative-covariances', filteredRelativeCovariances).map(
                  (rel, idx) => (
                  <tr
                    key={`preanalysis-rel-${rel.from}-${rel.to}-${idx}`}
                    className="border-b border-slate-800/50"
                  >
                    <td className="py-1 px-3">{rel.from}</td>
                    <td className="py-1 px-3">{rel.to}</td>
                    <td className="py-1 px-3 text-slate-400">{rel.connectionTypes.join(', ')}</td>
                    <td className="py-1 px-3 text-right">{(rel.sigmaN * unitScale).toFixed(4)}</td>
                    <td className="py-1 px-3 text-right">{(rel.sigmaE * unitScale).toFixed(4)}</td>
                    <td className="py-1 px-3 text-right">
                      {rel.sigmaDist != null ? (rel.sigmaDist * unitScale).toFixed(4) : '-'}
                    </td>
                    <td className="py-1 px-3 text-right">
                      {rel.sigmaAz != null ? (rel.sigmaAz * RAD_TO_DEG * 3600).toFixed(2) : '-'}
                    </td>
                    <td className="py-1 px-3 text-right">
                      {(rel.cEE * covarianceScale).toExponential(4)}
                    </td>
                    <td className="py-1 px-3 text-right">
                      {(rel.cEN * covarianceScale).toExponential(4)}
                    </td>
                    <td className="py-1 px-3 text-right">
                      {(rel.cNN * covarianceScale).toExponential(4)}
                    </td>
                  </tr>
                  ),
                )}
              </tbody>
            </table>
            {renderLoadMoreFooter(
              'relative-covariances',
              visibleRowsFor('relative-covariances', filteredRelativeCovariances).length,
              filteredRelativeCovariances.length,
            )}
          </div>
        </div>
      )}

      {isPreanalysis && weakGeometryDiagnostics && (
        <div className="mb-8 border border-amber-900/60 rounded overflow-hidden">
          <div
            className="px-3 py-2 text-xs text-amber-200 uppercase tracking-wider border-b border-amber-900/40 bg-amber-950/30"
            title={preanalysisLabelTooltip('Weak Geometry Cues')}
          >
            Weak Geometry Cues
          </div>
          <div className="grid grid-cols-2 md:grid-cols-4 gap-3 p-3 text-xs text-slate-300 border-b border-amber-900/30">
            <div>
              <div
                className="text-slate-500"
                title={preanalysisLabelTooltip('Median Station Major')}
              >
                Median Station Major
              </div>
              <div>
                {(weakGeometryDiagnostics.stationMedianHorizontal * unitScale).toFixed(4)} {units}
              </div>
            </div>
            <div>
              <div
                className="text-slate-500"
                title={preanalysisLabelTooltip('Median Pair SigmaDist')}
              >
                Median Pair SigmaDist
              </div>
              <div>
                {weakGeometryDiagnostics.relativeMedianDistance != null
                  ? `${(weakGeometryDiagnostics.relativeMedianDistance * unitScale).toFixed(4)} ${units}`
                  : '-'}
              </div>
            </div>
            <div>
              <div className="text-slate-500" title={preanalysisLabelTooltip('Station Flags')}>
                Station Flags
              </div>
              <div>{flaggedStationCues.length}</div>
            </div>
            <div>
              <div className="text-slate-500" title={preanalysisLabelTooltip('Pair Flags')}>
                Pair Flags
              </div>
              <div>{flaggedRelativeCues.length}</div>
            </div>
          </div>
          <div className="overflow-x-auto w-full">
            <table className="w-full text-left border-collapse text-xs">
              <thead>
                <tr className="text-slate-200 border-b border-slate-700">
                  <th className="py-2 px-3 font-semibold">Scope</th>
                  <th className="py-2 px-3 font-semibold">ID</th>
                  <th className="py-2 px-3 font-semibold">Severity</th>
                  <th className="py-2 px-3 font-semibold text-right">Metric</th>
                  <th className="py-2 px-3 font-semibold text-right">Median Ratio</th>
                  <th className="py-2 px-3 font-semibold text-right">Shape Ratio</th>
                  <th className="py-2 px-3 font-semibold">Note</th>
                </tr>
              </thead>
              <tbody className="text-slate-300">
                {[...flaggedStationCues, ...flaggedRelativeCues].map((cue, idx) => {
                  const isStationCue = 'stationId' in cue;
                  const severityClass =
                    cue.severity === 'weak'
                      ? 'text-red-300'
                      : cue.severity === 'watch'
                        ? 'text-amber-300'
                        : 'text-slate-300';
                  const metric =
                    'horizontalMetric' in cue ? cue.horizontalMetric : cue.distanceMetric;
                  const id = isStationCue ? cue.stationId : `${cue.from}-${cue.to}`;
                  return (
                    <tr key={`weak-geometry-${id}-${idx}`} className="border-b border-slate-800/50">
                      <td className="py-1 px-3 uppercase text-slate-500">
                        {isStationCue ? 'station' : 'pair'}
                      </td>
                      <td className="py-1 px-3">{id}</td>
                      <td className={`py-1 px-3 uppercase font-semibold ${severityClass}`}>
                        {cue.severity}
                      </td>
                      <td className="py-1 px-3 text-right">
                        {metric != null ? `${(metric * unitScale).toFixed(4)} ${units}` : '-'}
                      </td>
                      <td className="py-1 px-3 text-right">
                        {cue.relativeToMedian != null ? `${cue.relativeToMedian.toFixed(2)}x` : '-'}
                      </td>
                      <td className="py-1 px-3 text-right">
                        {cue.ellipseRatio != null ? `${cue.ellipseRatio.toFixed(2)}x` : '-'}
                      </td>
                      <td className="py-1 px-3 text-slate-400">{cue.note}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {!isPreanalysis && !isDataCheck && (
        <div className="mb-8" style={{ order: -180 }}>
          <h3 className="text-blue-400 font-bold mb-3 text-base uppercase tracking-wider">
            Observations & Residuals
          </h3>
          <div className="bg-slate-800/50 rounded p-2 mb-2 text-xs text-slate-400 flex items-center justify-between">
            <span>Sorted by |StdRes|</span>
            <span>
              MDB: arcsec (angular) / {units} (linear). Toggle rows to exclude and press Re-run
            </span>
          </div>
          {allDetailSectionsCollapsed && (
            <div className="mb-3 rounded border border-slate-800 bg-slate-900/40 px-3 py-2 text-xs text-slate-400">
              Detail sections are collapsed. Click any section header to expand it, or use
              “Expand detail sections”.
            </div>
          )}
          {result.typeSummary && Object.keys(result.typeSummary).length > 0 && (
            <div className="mb-4 border border-slate-800 rounded">
              {renderCollapsibleSectionHeader({
                sectionId: 'per-type-summary',
                label: 'Per-Type Summary',
                className: 'px-3 py-2 text-xs uppercase tracking-wider border-b border-slate-700 bg-slate-800/75',
                labelClassName: 'text-slate-100',
              })}
              {!isSectionCollapsed('per-type-summary') && (
                <div className="overflow-x-auto w-full">
                <table className="w-full text-left border-collapse text-xs">
                  <thead>
                    <tr className="text-slate-200 border-b border-slate-700">
                      <th className="py-2 px-3 font-semibold">Type</th>
                      <th className="py-2 px-3 font-semibold text-right">Count</th>
                      <th className="py-2 px-3 font-semibold text-right">RMS</th>
                      <th className="py-2 px-3 font-semibold text-right">Max |Res|</th>
                      <th className="py-2 px-3 font-semibold text-right">Max |StdRes|</th>
                      <th className="py-2 px-3 font-semibold text-right">&gt;3σ</th>
                      <th className="py-2 px-3 font-semibold text-right">&gt;4σ</th>
                      <th className="py-2 px-3 font-semibold text-right">Unit</th>
                    </tr>
                  </thead>
                  <tbody className="text-slate-300">
                    {Object.entries(result.typeSummary).map(([type, summary]) => (
                      <tr key={type} className="border-b border-slate-800/50">
                        <td className="py-1 px-3 uppercase text-slate-400">{type}</td>
                        <td className="py-1 px-3 text-right">{summary.count}</td>
                        <td className="py-1 px-3 text-right">{summary.rms.toFixed(4)}</td>
                        <td className="py-1 px-3 text-right">{summary.maxAbs.toFixed(4)}</td>
                        <td className="py-1 px-3 text-right">{summary.maxStdRes.toFixed(3)}</td>
                        <td className="py-1 px-3 text-right">{summary.over3}</td>
                        <td className="py-1 px-3 text-right">{summary.over4}</td>
                        <td className="py-1 px-3 text-right">{summary.unit}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
                </div>
              )}
            </div>
          )}
          {filteredRelativePrecision.length > 0 && (
            <div className="mb-4 border border-slate-800 rounded">
              {renderCollapsibleSectionHeader({
                sectionId: 'relative-precision-unknowns',
                label: 'Relative Precision (Unknowns)',
                className: 'px-3 py-2 text-xs uppercase tracking-wider border-b border-slate-700 bg-slate-800/75',
                labelClassName: 'text-slate-100',
              })}
              {!isSectionCollapsed('relative-precision-unknowns') && (
                <div className="overflow-x-auto w-full">
                <table className="w-full text-left border-collapse text-xs">
                  <thead>
                    <tr className="text-slate-200 border-b border-slate-700">
                      <th className="py-2 px-3 font-semibold">From</th>
                      <th className="py-2 px-3 font-semibold">To</th>
                      <th className="py-2 px-3 font-semibold text-right">σN</th>
                      <th className="py-2 px-3 font-semibold text-right">σE</th>
                      <th className="py-2 px-3 font-semibold text-right">σDist</th>
                      <th className="py-2 px-3 font-semibold text-right">σAz (")</th>
                      <th className="py-2 px-3 font-semibold text-right">
                        Ellipse ({ellipseUnit})
                      </th>
                      <th className="py-2 px-3 font-semibold text-right">Az (deg)</th>
                    </tr>
                  </thead>
                  <tbody className="text-slate-300">
                    {visibleRowsFor('relative-precision', filteredRelativePrecision).map(
                      (rel, idx) => (
                      <tr
                        key={`${rel.from}-${rel.to}-${idx}`}
                        className="border-b border-slate-800/50"
                      >
                        <td className="py-1 px-3">{rel.from}</td>
                        <td className="py-1 px-3">{rel.to}</td>
                        <td className="py-1 px-3 text-right">
                          {(rel.sigmaN * unitScale).toFixed(4)}
                        </td>
                        <td className="py-1 px-3 text-right">
                          {(rel.sigmaE * unitScale).toFixed(4)}
                        </td>
                        <td className="py-1 px-3 text-right">
                          {rel.sigmaDist != null ? (rel.sigmaDist * unitScale).toFixed(4) : '-'}
                        </td>
                        <td className="py-1 px-3 text-right">
                          {rel.sigmaAz != null ? (rel.sigmaAz * RAD_TO_DEG * 3600).toFixed(2) : '-'}
                        </td>
                        <td className="py-1 px-3 text-right">
                          {rel.ellipse
                            ? `${(
                                rel.ellipse.semiMajor *
                                ellipseConfidenceScale *
                                ellipseScale *
                                (units === 'ft' ? 0.0328084 : 1)
                              ).toFixed(1)} / ${(
                                rel.ellipse.semiMinor *
                                ellipseConfidenceScale *
                                ellipseScale *
                                (units === 'ft' ? 0.0328084 : 1)
                              ).toFixed(1)}`
                            : '-'}
                        </td>
                        <td className="py-1 px-3 text-right">
                          {rel.ellipse
                            ? (toSurveyEllipseAzimuthDeg(rel.ellipse.theta) ?? 0).toFixed(2)
                            : '-'}
                        </td>
                      </tr>
                      ),
                    )}
                  </tbody>
                </table>
                {renderLoadMoreFooter(
                  'relative-precision',
                  visibleRowsFor('relative-precision', filteredRelativePrecision).length,
                  filteredRelativePrecision.length,
                )}
                </div>
              )}
            </div>
          )}
          {renderTable(byType('angle'), 'Angles (TS)', 'angles-ts')}
          {renderTable(byType('direction'), 'Directions (DB/DN)', 'directions-db-dn')}
          {renderTable(byType('dist'), 'Distances (TS)', 'distances-ts')}
          {renderTable(byType('bearing'), 'Bearings/Azimuths', 'bearings-azimuths')}
          {renderTable(byType('dir'), 'Directions (Azimuth)', 'directions-azimuth')}
          {renderTable(byType('zenith'), 'Zenith/Vertical Angles', 'zenith-vertical-angles')}
          {renderTable(byType('gps'), 'GPS Vectors', 'gps-vectors')}
          {renderTable(byType('lev'), 'Leveling dH', 'leveling-dh')}
        </div>
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

