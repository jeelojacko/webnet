import { appendAdjustmentStatisticalSummary } from './industryListingAdjustedOutputSections';
import { appendAdjustedCoordinateSections } from './industryListingCoordinateSections';
import { buildIndustryListingContext } from './industryListingBuildContext';
import {
  buildIndustryListingGpsDisplayHelpers,
} from './industryListingGpsDisplay';
import { appendIndustryListingInputSummary } from './industryListingInputSummary';
import { appendIndustryListingTopSections } from './industryListingSections';
import { centerIndustryLine, pathTokenLeaf } from './industryListingFormatters';
import { compareObsByInput } from './industryListingAdjustedWorkflow';
import type {
  IndustryListingParseSettings,
  IndustryListingRunDiagnostics,
  IndustryListingSettings,
} from './industryListingTypes';
import type { AdjustmentResult, Observation } from '../types';

type IndustryListingContext = Extract<
  ReturnType<typeof buildIndustryListingContext>,
  { stationContext: unknown }
>;

type AppendIndustryListingSummaryWorkflowOptions = {
  context: IndustryListingContext;
  lines: string[];
  parseSettings: IndustryListingParseSettings;
  res: AdjustmentResult;
  runDiagnostics: IndustryListingRunDiagnostics;
  settings: IndustryListingSettings;
};

export const appendIndustryListingSummaryWorkflow = ({
  context,
  lines,
  parseSettings,
  res,
  runDiagnostics,
  settings,
}: AppendIndustryListingSummaryWorkflowOptions) => {
  const { stationContext } = context;
  const {
    classicTraverseLegacyFactorByStation,
    classicTraverseStationOrder,
    displayFactorsForStation,
    enteredInputStationSnapshots,
    fixedStations,
    fixedUsedEnteredStationSnapshots,
    freeStations,
    freeUsedEnteredStationSnapshots,
    partiallyFixedUsedEnteredStationSnapshots,
    stationEntriesForListing,
    stationEntriesInputOrder,
    unusedEnteredStationSnapshots,
    usesLegacyNbDisplayFactors,
  } = stationContext;

  appendIndustryListingTopSections({
    aliasTrace: context.aliasTrace,
    autoAdjustDiagnostics: res.autoAdjustDiagnostics,
    autoSideshotDiagnostics: res.autoSideshotDiagnostics,
    autoSideshotEnabled: context.autoSideshotEnabled,
    averageGeoidHeight: context.averageGeoidHeight,
    averageScaleFactor: context.averageScaleFactor,
    centerIndustryLine,
    clusterDiagnostics: res.clusterDiagnostics,
    commonElevation: context.commonElevation,
    coordMode: context.coordMode,
    coordSystemDiagnostics: context.coordSystemDiagnostics,
    coordSystemMode: context.coordSystemMode,
    coordSystemWarningMessages: context.coordSystemWarningMessages,
    crsAreaOfUseStatus: context.crsAreaOfUseStatus,
    crsConvergenceAngleRad: context.crsConvergenceAngleRad,
    crsConvergenceEnabled: context.crsConvergenceEnabled,
    crsDatumFallbackUsed: context.crsDatumFallbackUsed,
    crsDatumOpId: context.crsDatumOpId,
    crsGridScaleEnabled: context.crsGridScaleEnabled,
    crsGridScaleFactor: context.crsGridScaleFactor,
    crsId: context.crsId,
    crsLabel: context.crsLabel,
    crsOffReason: context.crsOffReason,
    crsOutOfAreaStationCount: context.crsOutOfAreaStationCount,
    crsProjectionModel: context.crsProjectionModel,
    crsStatus: context.crsStatus,
    datumSufficiency: context.datumSufficiency,
    descriptionAppendDelimiter: context.descriptionAppendDelimiter,
    descriptionReconcileMode: context.descriptionReconcileMode,
    descriptionScanSummary: context.descriptionScanSummary,
    directiveNoEffectWarnings: context.directiveNoEffectWarnings,
    directiveTransitions: context.directiveTransitions,
    faceNormalizationMode: context.faceNormalizationMode,
    formatReductionUsage: context.formatReductionUsage,
    geoidConvertedStationCount: context.geoidConvertedStationCount,
    geoidHeightConversionEnabled: context.geoidHeightConversionEnabled,
    geoidInterpolation: context.geoidInterpolation,
    geoidModelEnabled: context.geoidModelEnabled,
    geoidModelId: context.geoidModelId,
    geoidModelLoaded: context.geoidModelLoaded,
    geoidModelMetadata: context.geoidModelMetadata,
    geoidOutputHeightDatum: context.geoidOutputHeightDatum,
    geoidSampleUndulationM: context.geoidSampleUndulationM,
    geoidSkippedStationCount: context.geoidSkippedStationCount,
    gnssFrameConfirmed: context.gnssFrameConfirmed,
    gnssVectorFrameDefault: context.gnssVectorFrameDefault,
    gpsAddHiHtAppliedCount: context.gpsAddHiHtAppliedCount,
    gpsAddHiHtDefaultZeroCount: context.gpsAddHiHtDefaultZeroCount,
    gpsAddHiHtEnabled: context.gpsAddHiHtEnabled,
    gpsAddHiHtHiM: context.gpsAddHiHtHiM,
    gpsAddHiHtHtM: context.gpsAddHiHtHtM,
    gpsAddHiHtMissingHeightCount: context.gpsAddHiHtMissingHeightCount,
    gpsAddHiHtNegativeCount: context.gpsAddHiHtNegativeCount,
    gpsAddHiHtNeutralCount: context.gpsAddHiHtNeutralCount,
    gpsAddHiHtPositiveCount: context.gpsAddHiHtPositiveCount,
    gpsAddHiHtScaleMax: context.gpsAddHiHtScaleMax,
    gpsAddHiHtScaleMin: context.gpsAddHiHtScaleMin,
    gpsAddHiHtVectorCount: context.gpsAddHiHtVectorCount,
    gpsLoopCheckEnabled: context.gpsLoopCheckEnabled,
    gpsLoopDiagnostics: context.gpsLoopDiagnostics,
    gpsObservationRows: context.gpsObservationRows,
    gpsOffsetObservations: context.gpsOffsetObservations,
    gpsVectorFactorSummary: context.gpsVectorFactorSummary,
    gridAngleMode: context.gridAngleMode,
    gridBearingMode: context.gridBearingMode,
    gridDirectionMode: context.gridDirectionMode,
    gridDistanceMode: context.gridDistanceMode,
    hasInlineGpsFactorOverride: context.hasInlineGpsFactorOverride,
    levelLoopToleranceBaseMm: context.levelLoopToleranceBaseMm,
    levelLoopTolerancePerSqrtKmMm: context.levelLoopTolerancePerSqrtKmMm,
    linearUnit: context.linearUnit,
    lines,
    localDatumScheme: context.localDatumScheme,
    lostStationIds: context.lostStationIds,
    mapMode: context.mapMode,
    mapScaleFactor: context.mapScaleFactor,
    normalize: context.normalize,
    now: context.now,
    parseSettings,
    parseState: context.parseState,
    parseStochasticDefaultsRows: context.parseStochasticDefaultsRows,
    parsedUsageSummary: context.parsedUsageSummary,
    pathTokenLeaf,
    prismEnabled: context.prismEnabled,
    prismOffset: context.prismOffset,
    prismScope: context.prismScope,
    projectFolder: context.projectFolder,
    projectInstrumentLibrary: context.projectInstrumentLibrary,
    projectName: context.projectName,
    projectSourceFiles: context.projectSourceFiles,
    pushSettingRow: context.pushSettingRow,
    qFixAngularSigmaSec: context.qFixAngularSigmaSec,
    qFixLinearSigmaM: context.qFixLinearSigmaM,
    rotationAngleRad: context.rotationAngleRad,
    runDiag: context.runDiag,
    runDiagnostics,
    runMode: context.runMode,
    runPurpose: context.runPurpose,
    scaleOverrideActive: context.scaleOverrideActive,
    settings,
    showLostStations: context.showLostStations,
    traceabilityModel: context.traceabilityModel,
    unitScale: context.unitScale,
    usedInSolveUsageSummary: context.usedInSolveUsageSummary,
    usedInstrumentCodes: context.usedInstrumentCodes,
    useClassicPreanalysisListing: context.useClassicPreanalysisListing,
    usesClassicParityLayout: context.usesClassicParityLayout,
    usesCompactGnssParityLayout: context.usesCompactGnssParityLayout,
  });
  lines.push('');
  lines.push(
    context.usesClassicParityLayout || context.usesCompactGnssParityLayout
      ? centerIndustryLine('Summary of Unadjusted Input Observations')
      : 'Summary of Unadjusted Input Observations',
  );
  lines.push(
    context.usesClassicParityLayout || context.usesCompactGnssParityLayout
      ? centerIndustryLine('========================================')
      : '========================================',
  );
  lines.push('');
  const gpsDisplayHelpers = buildIndustryListingGpsDisplayHelpers({
    dof: res.dof,
    gnssVectorFrameDefault: context.gnssVectorFrameDefault,
    gpsObservationRows: context.gpsObservationRows,
    stations: res.stations,
  });
  const inputSummaryCountByType = (type: Observation['type']) =>
    context.observationsForListing.filter((obs) => obs.type === type).length;
  const inputSummaryMeasuredDirectionCount =
    inputSummaryCountByType('direction') + inputSummaryCountByType('dir');
  const inputSummaryBearingCount = inputSummaryCountByType('bearing');
  const inputSummary = appendIndustryListingInputSummary({
    angleUnitToken: (context.parseState?.angleUnits ?? parseSettings.angleUnits).toUpperCase(),
    classicTraverseLegacyFactorByStation,
    compareObsByInput,
    coordSystemMode: context.coordSystemMode,
    enteredInputStationSnapshots,
    fixedStations,
    fixedUsedEnteredStationSnapshots,
    freeStations,
    freeUsedEnteredStationSnapshots,
    gpsInputCovarianceDisplay: gpsDisplayHelpers.gpsInputCovarianceDisplay,
    gpsObservationRows: context.gpsObservationRows,
    hasStationDescriptions: stationEntriesForListing.some(
      ([id]) => context.stationDescription(id).trim().length > 0,
    ),
    hasTraverseStyleAngularFamilies:
      inputSummaryMeasuredDirectionCount > 0 || inputSummaryBearingCount > 0,
    linearUnit: context.linearUnit,
    lines,
    observationsForListing: context.observationsForListing,
    parseSettings,
    parseState: context.parseState,
    partiallyFixedUsedEnteredStationSnapshots,
    pushSettingRow: context.pushSettingRow,
    res,
    stationDescription: context.stationDescription,
    stationEntriesInputOrder,
    unitScale: context.unitScale,
    unusedEnteredStationSnapshots,
    usesClassicParityLayout: context.usesClassicParityLayout,
    usesCompactGnssParityLayout: context.usesCompactGnssParityLayout,
  });
  appendAdjustmentStatisticalSummary({
    centerIndustryLine,
    getListingGpsStatisticalRow: gpsDisplayHelpers.gpsListingStatisticalRow,
    lines,
    observationCount: context.observationCount,
    pushSettingRow: context.pushSettingRow,
    pushTable: context.pushTable,
    res,
    stationCount: stationEntriesInputOrder.length,
    statisticalSummary: context.statisticalSummary,
    unknownCount: context.unknownCount,
    useClassicPreanalysisListing: context.useClassicPreanalysisListing,
    usesClassicParityLayout: context.usesClassicParityLayout,
  });
  const addCenteredHeading = (title: string, underline = '=') => {
    lines.push(title);
    lines.push(underline.repeat(title.length));
  };
  const renderTextTable = (headers: string[], rows: string[][], rightAligned: number[] = []) => {
    context.pushTable(headers, rows, rightAligned);
  };
  appendAdjustedCoordinateSections({
    addCenteredHeading,
    averageGeoidHeight: context.averageGeoidHeight,
    classicTraverseLegacyFactorByStation,
    classicTraverseStationOrder,
    commonElevation: context.commonElevation,
    coordSystemMode: context.coordSystemMode,
    displayFactorsForStation,
    hasStationDescriptions: inputSummary.hasStationDescriptions,
    isGnssOnlyListing: context.isGnssOnlyListing,
    linearUnit: context.linearUnit,
    lines,
    parseSettings,
    parseState: context.parseState,
    renderTextTable,
    res,
    settings,
    stationDescription: context.stationDescription,
    stationEntriesForListing,
    unitScale: context.unitScale,
    useClassicPreanalysisListing: context.useClassicPreanalysisListing,
    usesClassicParityLayout: context.usesClassicParityLayout,
    usesLegacyNbDisplayFactors,
  });

  return {
    addCenteredHeading,
    gpsDisplayHelpers,
    hasStationDescriptions: inputSummary.hasStationDescriptions,
    hasTraverseStyleAngularFamilies: inputSummary.hasTraverseStyleAngularFamilies,
    renderTextTable,
  };
};
