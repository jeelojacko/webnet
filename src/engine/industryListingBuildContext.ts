import { DEFAULT_QFIX_ANGULAR_SIGMA_SEC, DEFAULT_QFIX_LINEAR_SIGMA_M } from './defaults';
import { buildResultStatisticalSummaryModel, buildResultTraceabilityModel } from './resultDerivedModels';
import { buildIndustryListingStationContext, observationStationIds } from './industryListingStationContext';
import { buildLevelingOnlyIndustryListingText } from './industryListingLeveling';
import {
  filterListingCoordSystemDiagnostics,
  isLevelingOnlyObservationSet,
  usesClassicParityReportLayout,
  usesIndustryParityLevelingLayout,
} from './industryListingFormatters';
import {
  buildIndustryListingRenderHelpers,
  formatGpsVectorFactorSummary,
  formatReductionUsage,
  parseStochasticDefaultsRows,
  resolveIndustryListingProjectSourceContext,
} from './industryListingContextHelpers';
import type {
  IndustryListingParseSettings,
  IndustryListingRunDiagnostics,
  IndustryListingSettings,
} from './industryListingTypes';
import type { AdjustmentResult, GpsObservation, Observation, RunMode } from '../types';

const FT_PER_M = 3.280839895;

type BuildIndustryListingContextOptions = {
  lines: string[];
  parseSettings: IndustryListingParseSettings;
  res: AdjustmentResult;
  runDiagnostics: IndustryListingRunDiagnostics;
  settings: IndustryListingSettings;
};

export const buildIndustryListingContext = ({
  lines,
  parseSettings,
  res,
  runDiagnostics,
  settings,
}: BuildIndustryListingContextOptions) => {
  const now = new Date();
  const linearUnit = settings.units === 'ft' ? 'FeetUS' : 'Meters';
  const unitScale = settings.units === 'ft' ? FT_PER_M : 1;
  const runDiag = runDiagnostics;
  const showLostStations = settings.listingShowLostStations ?? true;
  const statisticalSummary = buildResultStatisticalSummaryModel(res, 'listing');
  const observationCount =
    statisticalSummary.totalCount > 0 ? statisticalSummary.totalCount : res.observations.length;
  const unknownCount = Math.max(0, observationCount - res.dof);
  const parseState = res.parseState;
  const autoSideshotEnabled = parseState?.autoSideshotEnabled ?? true;
  const prismEnabled = parseState?.prismEnabled ?? false;
  const prismOffset = parseState?.prismOffset ?? 0;
  const prismScope = parseState?.prismScope ?? 'global';
  const mapMode = parseState?.mapMode ?? 'off';
  const mapScaleFactor = parseState?.mapScaleFactor ?? 1;
  const normalize = parseState?.normalize ?? true;
  const faceNormalizationMode = parseState?.faceNormalizationMode ?? 'on';
  const rotationAngleRad = parseState?.rotationAngleRad ?? runDiag.rotationAngleRad ?? 0;
  const qFixLinearSigmaM =
    parseState?.qFixLinearSigmaM ?? runDiag.qFixLinearSigmaM ?? DEFAULT_QFIX_LINEAR_SIGMA_M;
  const qFixAngularSigmaSec =
    parseState?.qFixAngularSigmaSec ??
    runDiag.qFixAngularSigmaSec ??
    DEFAULT_QFIX_ANGULAR_SIGMA_SEC;
  const coordSystemMode = parseState?.coordSystemMode ?? runDiag.coordSystemMode ?? 'local';
  const crsId = parseState?.crsId ?? runDiag.crsId ?? 'CA_NAD83_CSRS_UTM_20N';
  const localDatumScheme =
    parseState?.localDatumScheme ?? runDiag.localDatumScheme ?? 'average-scale';
  const averageScaleFactor = parseState?.averageScaleFactor ?? runDiag.averageScaleFactor ?? 1;
  const scaleOverrideActive =
    parseState?.scaleOverrideActive ?? runDiag.scaleOverrideActive ?? false;
  const commonElevation = parseState?.commonElevation ?? runDiag.commonElevation ?? 0;
  const averageGeoidHeight = parseState?.averageGeoidHeight ?? runDiag.averageGeoidHeight ?? 0;
  const gridBearingMode = parseState?.gridBearingMode ?? runDiag.gridBearingMode ?? 'grid';
  const gridDistanceMode = parseState?.gridDistanceMode ?? runDiag.gridDistanceMode ?? 'measured';
  const gridAngleMode = parseState?.gridAngleMode ?? runDiag.gridAngleMode ?? 'measured';
  const gridDirectionMode =
    parseState?.gridDirectionMode ?? runDiag.gridDirectionMode ?? 'measured';
  const parsedUsageSummary = parseState?.parsedUsageSummary ?? runDiag.parsedUsageSummary;
  const usedInSolveUsageSummary =
    parseState?.usedInSolveUsageSummary ?? runDiag.usedInSolveUsageSummary;
  const directiveTransitions =
    parseState?.directiveTransitions ?? runDiag.directiveTransitions ?? [];
  const directiveNoEffectWarnings =
    parseState?.directiveNoEffectWarnings ?? runDiag.directiveNoEffectWarnings ?? [];
  const coordSystemDiagnostics = filterListingCoordSystemDiagnostics(
    coordSystemMode,
    parseState?.coordSystemDiagnostics ?? runDiag.coordSystemDiagnostics ?? [],
  );
  const coordSystemWarningMessages =
    coordSystemDiagnostics.length > 0
      ? (parseState?.coordSystemWarningMessages ?? runDiag.coordSystemWarningMessages ?? [])
      : [];
  const datumSufficiency = parseState?.datumSufficiencyReport ?? runDiag.datumSufficiencyReport;
  const gnssVectorFrameDefault =
    parseState?.gnssVectorFrameDefault ?? runDiag.gnssVectorFrameDefault ?? 'gridNEU';
  const gnssFrameConfirmed = parseState?.gnssFrameConfirmed ?? runDiag.gnssFrameConfirmed ?? false;
  const crsDatumOpId = parseState?.crsDatumOpId ?? runDiag.crsDatumOpId;
  const crsDatumFallbackUsed =
    parseState?.crsDatumFallbackUsed ?? runDiag.crsDatumFallbackUsed ?? false;
  const crsAreaOfUseStatus =
    parseState?.crsAreaOfUseStatus ?? runDiag.crsAreaOfUseStatus ?? 'unknown';
  const crsOutOfAreaStationCount =
    parseState?.crsOutOfAreaStationCount ?? runDiag.crsOutOfAreaStationCount ?? 0;
  const crsTransformEnabled =
    parseState?.crsTransformEnabled ?? runDiag.crsTransformEnabled ?? false;
  const crsProjectionModel =
    parseState?.crsProjectionModel ?? runDiag.crsProjectionModel ?? 'legacy-equirectangular';
  const crsLabel = parseState?.crsLabel ?? runDiag.crsLabel ?? '';
  const crsGridScaleEnabled =
    parseState?.crsGridScaleEnabled ?? runDiag.crsGridScaleEnabled ?? false;
  const crsGridScaleFactor = parseState?.crsGridScaleFactor ?? runDiag.crsGridScaleFactor ?? 1;
  const crsConvergenceEnabled =
    parseState?.crsConvergenceEnabled ?? runDiag.crsConvergenceEnabled ?? false;
  const crsConvergenceAngleRad =
    parseState?.crsConvergenceAngleRad ?? runDiag.crsConvergenceAngleRad ?? 0;
  const crsStatus =
    parseState?.crsStatus ?? runDiag.crsStatus ?? (crsTransformEnabled ? 'on' : 'off');
  const crsOffReason = parseState?.crsOffReason ?? runDiag.crsOffReason;
  const geoidModelEnabled = parseState?.geoidModelEnabled ?? runDiag.geoidModelEnabled ?? false;
  const geoidModelId = parseState?.geoidModelId ?? runDiag.geoidModelId ?? 'NGS-DEMO';
  const geoidInterpolation =
    parseState?.geoidInterpolation ?? runDiag.geoidInterpolation ?? 'bilinear';
  const geoidHeightConversionEnabled =
    parseState?.geoidHeightConversionEnabled ?? runDiag.geoidHeightConversionEnabled ?? false;
  const geoidOutputHeightDatum =
    parseState?.geoidOutputHeightDatum ?? runDiag.geoidOutputHeightDatum ?? 'orthometric';
  const geoidModelLoaded = parseState?.geoidModelLoaded ?? runDiag.geoidModelLoaded ?? false;
  const geoidModelMetadata = parseState?.geoidModelMetadata ?? runDiag.geoidModelMetadata ?? '';
  const geoidSampleUndulationM =
    parseState?.geoidSampleUndulationM ?? runDiag.geoidSampleUndulationM;
  const geoidConvertedStationCount =
    parseState?.geoidConvertedStationCount ?? runDiag.geoidConvertedStationCount ?? 0;
  const geoidSkippedStationCount =
    parseState?.geoidSkippedStationCount ?? runDiag.geoidSkippedStationCount ?? 0;
  const gpsAddHiHtEnabled = parseState?.gpsAddHiHtEnabled ?? runDiag.gpsAddHiHtEnabled ?? false;
  const gpsAddHiHtHiM = parseState?.gpsAddHiHtHiM ?? runDiag.gpsAddHiHtHiM ?? 0;
  const gpsAddHiHtHtM = parseState?.gpsAddHiHtHtM ?? runDiag.gpsAddHiHtHtM ?? 0;
  const gpsAddHiHtVectorCount =
    parseState?.gpsAddHiHtVectorCount ?? runDiag.gpsAddHiHtVectorCount ?? 0;
  const gpsAddHiHtAppliedCount =
    parseState?.gpsAddHiHtAppliedCount ?? runDiag.gpsAddHiHtAppliedCount ?? 0;
  const gpsAddHiHtPositiveCount =
    parseState?.gpsAddHiHtPositiveCount ?? runDiag.gpsAddHiHtPositiveCount ?? 0;
  const gpsAddHiHtNegativeCount =
    parseState?.gpsAddHiHtNegativeCount ?? runDiag.gpsAddHiHtNegativeCount ?? 0;
  const gpsAddHiHtNeutralCount =
    parseState?.gpsAddHiHtNeutralCount ?? runDiag.gpsAddHiHtNeutralCount ?? 0;
  const gpsAddHiHtDefaultZeroCount =
    parseState?.gpsAddHiHtDefaultZeroCount ?? runDiag.gpsAddHiHtDefaultZeroCount ?? 0;
  const gpsAddHiHtMissingHeightCount =
    parseState?.gpsAddHiHtMissingHeightCount ?? runDiag.gpsAddHiHtMissingHeightCount ?? 0;
  const gpsAddHiHtScaleMin = parseState?.gpsAddHiHtScaleMin ?? runDiag.gpsAddHiHtScaleMin ?? 1;
  const gpsAddHiHtScaleMax = parseState?.gpsAddHiHtScaleMax ?? runDiag.gpsAddHiHtScaleMax ?? 1;
  const gpsLoopCheckEnabled = parseState?.gpsLoopCheckEnabled ?? false;
  const levelLoopToleranceBaseMm =
    parseState?.levelLoopToleranceBaseMm ?? runDiag.levelLoopToleranceBaseMm ?? 0;
  const levelLoopTolerancePerSqrtKmMm =
    parseState?.levelLoopTolerancePerSqrtKmMm ?? runDiag.levelLoopTolerancePerSqrtKmMm ?? 4;
  const gpsLoopDiagnostics = res.gpsLoopDiagnostics;
  const levelingLoopDiagnostics = res.levelingLoopDiagnostics;
  const isPreanalysis = res.preanalysisMode === true;
  const runMode: RunMode =
    parseState?.runMode ?? runDiag.runMode ?? (isPreanalysis ? 'preanalysis' : 'adjustment');
  const runPurpose =
    runMode === 'preanalysis'
      ? 'Preanalysis / Predicted Precision'
      : runMode === 'data-check'
        ? 'Data Check Only / Approximate Geometry'
        : runMode === 'blunder-detect'
          ? 'Blunder Detect / Iterative Deweight Diagnostics'
          : 'Adjustment / Postfit QA';
  const descriptionReconcileMode =
    parseState?.descriptionReconcileMode ?? parseSettings.descriptionReconcileMode ?? 'first';
  const descriptionAppendDelimiter =
    parseState?.descriptionAppendDelimiter ?? parseSettings.descriptionAppendDelimiter ?? ' | ';
  const reconciledDescriptions = parseState?.reconciledDescriptions ?? {};
  const stationDescription = (stationId: string): string => reconciledDescriptions[stationId] ?? '';
  const traceabilityModel = buildResultTraceabilityModel(parseState);
  const lostStationIds = traceabilityModel.lostStationIds;
  const isHiddenLostStation = (stationId: string): boolean => {
    if (showLostStations) return false;
    const station = res.stations[stationId];
    return station?.lost === true;
  };
  const observationReferencesHiddenLostStation = (obs: Observation): boolean =>
    observationStationIds(obs).some((stationId) => isHiddenLostStation(stationId));
  const observationsForListing = res.observations.filter(
    (obs) => !observationReferencesHiddenLostStation(obs),
  );
  const sideshotsForListing = (res.sideshots ?? []).filter(
    (row) => !isHiddenLostStation(row.from) && !isHiddenLostStation(row.to),
  );
  const tsSideshotsForListing = sideshotsForListing.filter((row) => row.mode !== 'gps');
  const gpsSideshotsForListing = sideshotsForListing.filter((row) => row.mode === 'gps');
  const gpsVectorSideshotsForListing = gpsSideshotsForListing.filter(
    (row) => row.sourceType !== 'GS',
  );
  const gpsCoordinateSideshotsForListing = gpsSideshotsForListing.filter(
    (row) => row.sourceType === 'GS',
  );
  const gpsOffsetObservations = observationsForListing.filter(
    (obs): obs is GpsObservation => obs.type === 'gps' && obs.gpsOffsetDistanceM != null,
  );
  if (
    usesIndustryParityLevelingLayout(runDiagnostics.solveProfile) &&
    isLevelingOnlyObservationSet(observationsForListing) &&
    tsSideshotsForListing.length === 0 &&
    gpsSideshotsForListing.length === 0
  ) {
    return {
      levelingOnlyText: buildLevelingOnlyIndustryListingText(
        res,
        settings,
        parseSettings,
        runDiagnostics,
      ),
    };
  }
  const coordMode = parseState?.coordMode ?? parseSettings.coordMode;
  const projectInstrumentLibrary = runDiag.projectInstrumentLibrary;
  const gpsObservationRows = observationsForListing.filter(
    (obs): obs is GpsObservation => obs.type === 'gps',
  );
  const usedInstrumentCodes = new Set(
    observationsForListing
      .map((obs) => obs.instCode?.trim())
      .filter((code): code is string => Boolean(code)),
  );
  const isGnssOnlyListing =
    gpsObservationRows.length > 0 &&
    observationsForListing.length > 0 &&
    observationsForListing.every((obs) => obs.type === 'gps');
  const usesClassicParityLayout = usesClassicParityReportLayout(
    runDiagnostics.solveProfile,
    coordMode,
    projectInstrumentLibrary,
    isGnssOnlyListing,
  );
  const useClassicPreanalysisListing = usesClassicParityLayout && isPreanalysis;
  const usesCompactGnssParityLayout =
    runDiagnostics.solveProfile !== 'webnet' && isGnssOnlyListing && !usesClassicParityLayout;
  const hasInlineGpsFactorOverride = observationsForListing.some((obs) => {
    if (obs.type !== 'gps') return false;
    const horizontalFactor = obs.gpsVectorHorizontalFactor ?? 1;
    const verticalFactor = obs.gpsVectorVerticalFactor ?? 1;
    return Math.abs(horizontalFactor - 1) > 1e-12 || Math.abs(verticalFactor - 1) > 1e-12;
  });
  const { projectFolder, projectName, projectSourceFiles } =
    resolveIndustryListingProjectSourceContext({
      observationSourceFiles: observationsForListing.map((obs) => obs.sourceFile),
      projectFolder: runDiag.projectFolder,
      projectName: runDiag.projectName,
      projectSourceFiles: runDiag.projectSourceFiles,
      sourceFile: parseState?.sourceFile,
    });
  const gpsVectorFactorHorizontal = parseState?.gpsVectorFactorHorizontal ?? 1;
  const gpsVectorFactorVertical = parseState?.gpsVectorFactorVertical ?? 1;
  const gpsVectorFactorSummary = formatGpsVectorFactorSummary(
    hasInlineGpsFactorOverride,
    gpsVectorFactorHorizontal,
    gpsVectorFactorVertical,
  );
  const stationContext = buildIndustryListingStationContext({
    coordSystemMode,
    crsId,
    isPreanalysis,
    observationsForListing,
    res,
    settings,
    showLostStations,
    sideshotsForListing,
    usesClassicParityLayout,
  });
  const aliasTrace = traceabilityModel.aliasTrace;
  const descriptionScanSummary = traceabilityModel.descriptionScanSummary;
  const {
    aliasRefsForLine,
    pushSettingRow,
    pushTable,
  } = buildIndustryListingRenderHelpers(lines, aliasTrace);
  return {
    aliasRefsForLine,
    aliasTrace,
    autoSideshotEnabled,
    averageGeoidHeight,
    averageScaleFactor,
    commonElevation,
    coordMode,
    coordSystemDiagnostics,
    coordSystemMode,
    coordSystemWarningMessages,
    crsAreaOfUseStatus,
    crsConvergenceAngleRad,
    crsConvergenceEnabled,
    crsDatumFallbackUsed,
    crsDatumOpId,
    crsGridScaleEnabled,
    crsGridScaleFactor,
    crsId,
    crsLabel,
    crsOffReason,
    crsOutOfAreaStationCount,
    crsProjectionModel,
    crsStatus,
    datumSufficiency,
    descriptionAppendDelimiter,
    descriptionReconcileMode,
    descriptionScanSummary,
    directiveNoEffectWarnings,
    directiveTransitions,
    faceNormalizationMode,
    formatReductionUsage,
    geoidConvertedStationCount,
    geoidHeightConversionEnabled,
    geoidInterpolation,
    geoidModelEnabled,
    geoidModelId,
    geoidModelLoaded,
    geoidModelMetadata,
    geoidOutputHeightDatum,
    geoidSampleUndulationM,
    geoidSkippedStationCount,
    gnssFrameConfirmed,
    gnssVectorFrameDefault,
    gpsAddHiHtAppliedCount,
    gpsAddHiHtDefaultZeroCount,
    gpsAddHiHtEnabled,
    gpsAddHiHtHiM,
    gpsAddHiHtHtM,
    gpsAddHiHtMissingHeightCount,
    gpsAddHiHtNegativeCount,
    gpsAddHiHtNeutralCount,
    gpsAddHiHtPositiveCount,
    gpsAddHiHtScaleMax,
    gpsAddHiHtScaleMin,
    gpsAddHiHtVectorCount,
    gpsCoordinateSideshotsForListing,
    gpsLoopCheckEnabled,
    gpsLoopDiagnostics,
    gpsObservationRows,
    gpsOffsetObservations,
    gpsVectorFactorSummary,
    gpsVectorSideshotsForListing,
    gridAngleMode,
    gridBearingMode,
    gridDirectionMode,
    gridDistanceMode,
    hasInlineGpsFactorOverride,
    isGnssOnlyListing,
    isPreanalysis,
    levelingLoopDiagnostics,
    levelLoopToleranceBaseMm,
    levelLoopTolerancePerSqrtKmMm,
    linearUnit,
    localDatumScheme,
    lostStationIds,
    mapMode,
    mapScaleFactor,
    normalize,
    now,
    observationCount,
    observationsForListing,
    parseState,
    parseStochasticDefaultsRows,
    parsedUsageSummary,
    prismEnabled,
    prismOffset,
    prismScope,
    projectFolder,
    projectInstrumentLibrary,
    projectName,
    projectSourceFiles,
    pushSettingRow,
    pushTable,
    qFixAngularSigmaSec,
    qFixLinearSigmaM,
    rotationAngleRad,
    runDiag,
    runMode,
    runPurpose,
    scaleOverrideActive,
    showLostStations,
    statisticalSummary,
    stationDescription,
    stationContext,
    traceabilityModel,
    tsSideshotsForListing,
    unitScale,
    unknownCount,
    usedInSolveUsageSummary,
    usedInstrumentCodes,
    useClassicPreanalysisListing,
    usesClassicParityLayout,
    usesCompactGnssParityLayout,
  };
};
