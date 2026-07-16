import { RAD_TO_DEG, radToDmsStr } from './angles';
import {
  DEFAULT_QFIX_ANGULAR_SIGMA_SEC,
  DEFAULT_QFIX_LINEAR_SIGMA_M,
} from './defaults';
import {
  buildResultStatisticalSummaryModel,
  buildResultTraceabilityModel,
} from './resultDerivedModels';
import {
  getRelativeCovarianceRows,
  getIndustryReportedIterationCount,
  getRelativePrecisionRows,
  getStationPrecision,
  INDUSTRY_CONFIDENCE_95_SCALE,
  toSurveyEllipseAzimuthDeg,
} from './resultPrecision';
import {
  buildDistanceAzimuthPrecision,
  buildHorizontalErrorEllipse,
} from './precisionPropagation';
import {
  buildIndustryListingStationContext,
  observationStationIds,
} from './industryListingStationContext';
import {
  buildIndustryListingGpsDisplayHelpers,
  formatGpsStdResValue,
} from './industryListingGpsDisplay';
import { buildLevelingOnlyIndustryListingText } from './industryListingLeveling';
import {
  appendAdjustedObservationSections,
  appendErrorPropagationSections,
  appendIndustryListingTopSections,
} from './industryListingSections';
import {
  centerIndustryLine,
  filterListingCoordSystemDiagnostics,
  formatClassicTraverseArcSeconds,
  formatClassicTraverseCombinedFactor,
  formatClassicTraverseConvergenceAngle,
  formatClassicTraverseDirectionSigmaArcSec,
  formatClassicTraverseZenithSigmaArcSec,
  formatDmsHundredths,
  formatQuadrantBearing,
  formatSignedDmsMicros,
  formatSignedDmsMicrosCompact,
  isConcretePathToken,
  isLevelingOnlyObservationSet,
  pathTokenLeaf,
  pathTokenParent,
  pathTokenStem,
  sortIndustryListingObservations,
  usesClassicParityReportLayout,
  usesIndustryParityLevelingLayout,
} from './industryListingFormatters';
import type {
  IndustryListingParseSettings,
  IndustryListingRunDiagnostics,
  IndustryListingSettings,
  IndustryListingSortCoordinatesBy,
  IndustryListingSortObservationsBy,
} from './industryListingTypes';
import type {
  AdjustmentResult,
  GnssVectorFrame,
  GpsObservation,
  Observation,
  ReductionUsageSummary,
  RunMode,
  Station,
  RelativeCovarianceBlock,
} from '../types';
export {
  compareIndustryObservationsByInput,
  compareIndustryObservationsByStations,
  getIndustryObservationResidualSortMagnitude,
  getIndustryObservationStdErrorSortMagnitude,
  sortIndustryListingObservations,
} from './industryListingFormatters';
export type {
  IndustryListingParseSettings,
  IndustryListingRunDiagnostics,
  IndustryListingSettings,
  IndustryListingSortCoordinatesBy,
  IndustryListingSortObservationsBy,
} from './industryListingTypes';

const FT_PER_M = 3.280839895;

const ONE_DIMENSIONAL_CONFIDENCE_95_SCALE = 1.959963984540054;

export const buildIndustryStyleListingText = (
  res: AdjustmentResult,
  settings: IndustryListingSettings,
  parseSettings: IndustryListingParseSettings,
  runDiagnostics: IndustryListingRunDiagnostics,
): string => {
  const lines: string[] = [];
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
    return buildLevelingOnlyIndustryListingText(res, settings, parseSettings, runDiagnostics);
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
  const parsedProjectSourceFiles = Array.from(
    new Set(
      [
        parseState?.sourceFile,
        ...observationsForListing.map((obs) => obs.sourceFile),
      ].filter((token): token is string => isConcretePathToken(token)),
    ),
  );
  const projectSourceFiles =
    runDiag.projectSourceFiles && runDiag.projectSourceFiles.length > 0
      ? Array.from(
          new Set(
            runDiag.projectSourceFiles.filter((token): token is string => isConcretePathToken(token)),
          ),
        )
      : parsedProjectSourceFiles;
  const projectName =
    runDiag.projectName?.trim() ||
    (projectSourceFiles.length > 0 ? pathTokenStem(projectSourceFiles[0]) : '');
  const projectFolder =
    runDiag.projectFolder?.trim() ||
    (projectSourceFiles.length > 0 ? pathTokenParent(projectSourceFiles[0]) : '');
  const gpsVectorFactorHorizontal = parseState?.gpsVectorFactorHorizontal ?? 1;
  const gpsVectorFactorVertical = parseState?.gpsVectorFactorVertical ?? 1;
  const gpsVectorFactorSummary =
    hasInlineGpsFactorOverride ||
    (Math.abs(gpsVectorFactorHorizontal - 1) <= 1e-12 &&
      Math.abs(gpsVectorFactorVertical - 1) <= 1e-12)
      ? 'None'
      : Math.abs(gpsVectorFactorHorizontal - gpsVectorFactorVertical) <= 1e-12
        ? gpsVectorFactorHorizontal.toFixed(4)
        : `H=${gpsVectorFactorHorizontal.toFixed(4)} V=${gpsVectorFactorVertical.toFixed(4)}`;
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
  } = buildIndustryListingStationContext({
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
  const formatReductionUsage = (summary?: ReductionUsageSummary): string => {
    if (!summary) return 'unavailable';
    return [
      `bearing[g=${summary.bearing.grid},m=${summary.bearing.measured}]`,
      `angle[g=${summary.angle.grid},m=${summary.angle.measured}]`,
      `direction[g=${summary.direction.grid},m=${summary.direction.measured}]`,
      `distance[ground=${summary.distance.ground},grid=${summary.distance.grid},ellip=${summary.distance.ellipsoidal}]`,
      `total=${summary.total}`,
    ].join('; ');
  };
  const aliasTrace = traceabilityModel.aliasTrace;
  const descriptionScanSummary = traceabilityModel.descriptionScanSummary;
  const descriptionRefsByStation = traceabilityModel.descriptionRefsByStation;
  const aliasObsRefsByLine = new Map<number, string[]>();
  aliasTrace.forEach((entry) => {
    if (entry.context !== 'observation') return;
    if (entry.sourceLine == null) return;
    const ref = `${entry.sourceId}->${entry.canonicalId}`;
    const list = aliasObsRefsByLine.get(entry.sourceLine) ?? [];
    if (!list.includes(ref)) list.push(ref);
    aliasObsRefsByLine.set(entry.sourceLine, list);
  });
  const aliasRefsForLine = (line?: number): string =>
    line != null && aliasObsRefsByLine.has(line)
      ? ` [alias ${aliasObsRefsByLine.get(line)?.join(', ')}]`
      : '';
  const settingLabelWidth = 37;
  const pushSettingRow = (label: string, value: string): void => {
    lines.push(`${label.padEnd(settingLabelWidth)} : ${value}`);
  };
  const pushTable = (
    headers: string[],
    rows: string[][],
    rightAligned: number[] = [],
    indent = '',
  ): void => {
    if (rows.length === 0) return;
    const right = new Set(rightAligned);
    const widths = headers.map((h, col) =>
      Math.max(
        h.length,
        ...rows.map((row) => {
          const v = row[col] ?? '';
          return v.length;
        }),
      ),
    );
    const formatCell = (value: string, width: number, alignRight: boolean) =>
      alignRight ? value.padStart(width) : value.padEnd(width);
    lines.push(
      `${indent}${headers.map((h, col) => formatCell(h, widths[col], right.has(col))).join('  ')}`,
    );
    rows.forEach((row) => {
      lines.push(
        `${indent}${headers.map((_, col) => formatCell(row[col] ?? '', widths[col], right.has(col))).join('  ')}`,
      );
    });
  };
  const parseStochasticDefaultsRows = (
    summary: string,
  ): Array<{ label: string; value: string }> => {
    const clean = summary.trim();
    if (!clean) return [];
    const keyMatches = Array.from(clean.matchAll(/(?:^|\s)([A-Za-z][A-Za-z0-9]*)=/g));
    if (keyMatches.length === 0) return [{ label: 'Defaults Summary', value: clean }];
    const keyToLabel: Record<string, string> = {
      inst: 'Instrument',
      dist: 'Distance (const+ppm)',
      hz: 'Horizontal Angle Precision',
      va: 'Vertical Angle Precision',
      centering: 'Centering (inst/tgt)',
      edm: 'EDM Mode',
      centerInflation: 'Centering Inflation',
    };
    const rows: Array<{ label: string; value: string }> = [];
    keyMatches.forEach((match, idx) => {
      const key = match[1];
      const start = (match.index ?? 0) + match[0].length;
      const end =
        idx + 1 < keyMatches.length ? (keyMatches[idx + 1].index ?? clean.length) : clean.length;
      const value = clean.slice(start, end).trim();
      if (!value) return;
      rows.push({ label: keyToLabel[key] ?? `Setting ${key}`, value });
    });
    return rows.length > 0 ? rows : [{ label: 'Defaults Summary', value: clean }];
  };

  appendIndustryListingTopSections({
    lines,
    now,
    runDiagnostics,
    runDiag,
    settings,
    parseSettings,
    parseState,
    projectName,
    projectFolder,
    projectSourceFiles,
    linearUnit,
    unitScale,
    runMode,
    runPurpose,
    coordMode,
    crsId,
    crsLabel,
    averageGeoidHeight,
    gpsObservationRows,
    gpsVectorFactorSummary,
    mapMode,
    mapScaleFactor,
    normalize,
    faceNormalizationMode,
    prismEnabled,
    prismOffset,
    prismScope,
    rotationAngleRad,
    coordSystemMode,
    localDatumScheme,
    averageScaleFactor,
    commonElevation,
    gridBearingMode,
    gridDistanceMode,
    gridAngleMode,
    gridDirectionMode,
    scaleOverrideActive,
    gnssVectorFrameDefault,
    gnssFrameConfirmed,
    parsedUsageSummary,
    usedInSolveUsageSummary,
    directiveTransitions,
    directiveNoEffectWarnings,
    datumSufficiency,
    crsStatus,
    crsOffReason,
    crsProjectionModel,
    crsGridScaleEnabled,
    crsGridScaleFactor,
    crsConvergenceEnabled,
    crsConvergenceAngleRad,
    crsDatumOpId,
    crsDatumFallbackUsed,
    crsAreaOfUseStatus,
    crsOutOfAreaStationCount,
    coordSystemDiagnostics,
    coordSystemWarningMessages,
    geoidModelEnabled,
    geoidModelId,
    geoidInterpolation,
    geoidModelLoaded,
    geoidModelMetadata,
    geoidSampleUndulationM,
    geoidHeightConversionEnabled,
    geoidOutputHeightDatum,
    geoidConvertedStationCount,
    geoidSkippedStationCount,
    gpsAddHiHtEnabled,
    gpsAddHiHtHiM,
    gpsAddHiHtHtM,
    gpsAddHiHtVectorCount,
    gpsAddHiHtAppliedCount,
    gpsAddHiHtPositiveCount,
    gpsAddHiHtNegativeCount,
    gpsAddHiHtNeutralCount,
    gpsAddHiHtDefaultZeroCount,
    gpsAddHiHtMissingHeightCount,
    gpsAddHiHtScaleMin,
    gpsAddHiHtScaleMax,
    gpsLoopCheckEnabled,
    gpsLoopDiagnostics,
    levelLoopToleranceBaseMm,
    levelLoopTolerancePerSqrtKmMm,
    gpsOffsetObservations,
    lostStationIds,
    qFixLinearSigmaM,
    qFixAngularSigmaSec,
    descriptionReconcileMode,
    descriptionAppendDelimiter,
    descriptionScanSummary,
    traceabilityModel,
    showLostStations,
    autoSideshotEnabled,
    aliasTrace,
    clusterDiagnostics: res.clusterDiagnostics,
    autoAdjustDiagnostics: res.autoAdjustDiagnostics,
    autoSideshotDiagnostics: res.autoSideshotDiagnostics,
    projectInstrumentLibrary,
    usedInstrumentCodes,
    hasInlineGpsFactorOverride,
    useClassicPreanalysisListing,
    usesClassicParityLayout,
    usesCompactGnssParityLayout,
    centerIndustryLine,
    pathTokenLeaf,
    pushSettingRow,
    parseStochasticDefaultsRows,
    formatReductionUsage,
  });
  lines.push('');
  lines.push(
    usesClassicParityLayout || usesCompactGnssParityLayout
      ? centerIndustryLine('Summary of Unadjusted Input Observations')
      : 'Summary of Unadjusted Input Observations',
  );
  lines.push(
    usesClassicParityLayout || usesCompactGnssParityLayout
      ? centerIndustryLine('========================================')
      : '========================================',
  );
  lines.push('');
  const countByType = (type: Observation['type']) =>
    observationsForListing.filter((o) => o.type === type).length;
  const compareObsByInput = (a: Observation, b: Observation) => {
    const aLine = a.sourceLine ?? Number.MAX_SAFE_INTEGER;
    const bLine = b.sourceLine ?? Number.MAX_SAFE_INTEGER;
    if (aLine !== bLine) return aLine - bLine;
    return (a.id ?? 0) - (b.id ?? 0);
  };
  const measuredDirectionCount = countByType('direction') + countByType('dir');
  const bearingCount = countByType('bearing');
  const hasStationDescriptions = stationEntriesForListing.some(
    ([id]) => stationDescription(id).trim().length > 0,
  );
  const hasTraverseStyleAngularFamilies = measuredDirectionCount > 0 || bearingCount > 0;
  const angleUnitToken = (parseState?.angleUnits ?? parseSettings.angleUnits).toUpperCase();
  const {
    gpsCovarianceDisplay,
    gpsDisplayVector,
    gpsHorizontalCovarianceForRelationship,
    gpsInputCovarianceDisplay,
    gpsListingStatisticalRow,
  } = buildIndustryListingGpsDisplayHelpers({
    dof: res.dof,
    gnssVectorFrameDefault,
    gpsObservationRows,
    stations: res.stations,
  });
  const renderAdjustedGnssVectorSection = () => {
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
        const displayVector = gpsDisplayVector(obs);
        const residual =
          displayVector?.residual ??
          ((obs.residual as { vE?: number; vN?: number; vU?: number } | undefined) ?? undefined);
        const calc =
          displayVector?.calc ??
          ((obs.calc as { dE?: number; dN?: number; dU?: number } | undefined) ?? undefined);
        const displayCov = gpsCovarianceDisplay(obs);
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
  if (usesCompactGnssParityLayout) {
    lines.push(
      centerIndustryLine(
        `Number of Entered Stations (${linearUnit}) = ${enteredInputStationSnapshots.length}`,
      ),
    );
    lines.push('');
    const formatClassicStationSummaryRow = (station: {
      stationId: string;
      x: number;
      y: number;
      h: number;
    }) => {
      const formatCoord = (value: number) =>
        (Math.round((value + Number.EPSILON) * 10000) / 10000).toFixed(4);
      const north = formatCoord(station.y * unitScale).padStart(12);
      const east = formatCoord(station.x * unitScale).padStart(18);
      const height = formatCoord(station.h * unitScale).padStart(12);
      const description = stationDescription(station.stationId);
      return `${station.stationId.padEnd(20)}${north}${east}${height}${description ? `   ${description}` : ''}`.trimEnd();
    };
    lines.push('Fixed Stations              N                 E          Elev   Description');
    fixedUsedEnteredStationSnapshots.forEach((station) =>
      lines.push(formatClassicStationSummaryRow(station)),
    );
    lines.push('');
    lines.push('Free Stations               N                 E          Elev   Description');
    freeUsedEnteredStationSnapshots.forEach((station) =>
      lines.push(formatClassicStationSummaryRow(station)),
    );
    lines.push('');
    lines.push(
      centerIndustryLine(
        `Number of GPS Vector Observations (${linearUnit}) = ${gpsObservationRows.length}`,
      ),
    );
    lines.push('');
    lines.push('From                           DeltaX        StdErrX       CorrelXY      HI');
    lines.push('To                             DeltaY        StdErrY       CorrelXZ      HT');
    lines.push('                               DeltaZ        StdErrZ       CorrelYZ');
    gpsObservationRows.sort(compareObsByInput).forEach((obs) => {
      const display = gpsInputCovarianceDisplay(obs);
      const hi = ((obs.gpsAntennaHiM ?? 0) * unitScale).toFixed(3);
      const ht = ((obs.gpsAntennaHtM ?? 0) * unitScale).toFixed(3);
      lines.push('');
      lines.push(`(${(obs.gpsVectorLabel ?? `${obs.from}-${obs.to}`).trim()})`);
      lines.push(
        `${obs.from.padEnd(20)}${(obs.obs.dE * unitScale).toFixed(4).padStart(12)}${(display.sigmaX * unitScale).toFixed(4).padStart(15)}${display.corrXY.toFixed(4).padStart(15)}${hi.padStart(8)}`,
      );
      lines.push(
        `${obs.to.padEnd(20)}${(obs.obs.dN * unitScale).toFixed(4).padStart(12)}${(display.sigmaY * unitScale).toFixed(4).padStart(15)}${display.corrXZ.toFixed(4).padStart(15)}${ht.padStart(8)}`,
      );
      lines.push(
        `${''.padEnd(20)}${((obs.obs.dU ?? 0) * unitScale).toFixed(4).padStart(12)}${(display.sigmaZ * unitScale).toFixed(4).padStart(15)}${display.corrYZ.toFixed(4).padStart(15)}`,
      );
    });
  } else if (usesClassicParityLayout) {
    lines.push(
      centerIndustryLine(
        `Number of Entered Stations (${linearUnit}) = ${enteredInputStationSnapshots.length}`,
      ),
    );
    lines.push('');
    const classicOrder = parseState?.order ?? parseSettings.order;
    const formatClassicStationSummaryRow = (station: {
      stationId: string;
      x: number;
      y: number;
      h: number;
    }) => {
      const formatCoord = (value: number) =>
        (Math.round((value + Number.EPSILON) * 10000) / 10000).toFixed(4);
      const first = formatCoord((classicOrder === 'NE' ? station.y : station.x) * unitScale);
      const second = formatCoord((classicOrder === 'NE' ? station.x : station.y) * unitScale);
      const height = formatCoord(station.h * unitScale);
      const description = stationDescription(station.stationId);
      return `${station.stationId.padEnd(22)}${first}${second.padStart(17)}${height.padStart(12)}${description ? `   ${description}` : ''}`.trimEnd();
    };
    const formatClassicStationConstraintStdErrRow = (stationId: string) => {
      const station = res.stations[stationId];
      if (!station) return '';
      const firstSigma =
        classicOrder === 'NE'
          ? station.sy != null
            ? (station.sy * unitScale).toFixed(4)
            : station.constraintModeY === 'fixed'
              ? 'FIXED'
              : '-'
          : station.sx != null
            ? (station.sx * unitScale).toFixed(4)
            : station.constraintModeX === 'fixed'
              ? 'FIXED'
              : '-';
      const secondSigma =
        classicOrder === 'NE'
          ? station.sx != null
            ? (station.sx * unitScale).toFixed(4)
            : station.constraintModeX === 'fixed'
              ? 'FIXED'
              : '-'
          : station.sy != null
            ? (station.sy * unitScale).toFixed(4)
            : station.constraintModeY === 'fixed'
              ? 'FIXED'
              : '-';
      const heightSigma =
        station.sh != null
          ? (station.sh * unitScale).toFixed(4)
          : station.constraintModeH === 'fixed'
            ? 'FIXED'
            : '-';
      return `${''.padEnd(22)}${firstSigma.padStart(11)}${secondSigma.padStart(17)}${heightSigma.padStart(12)}`;
    };
    const firstCoordLabel = classicOrder === 'NE' ? 'N' : 'E';
    const secondCoordLabel = classicOrder === 'NE' ? 'E' : 'N';
    lines.push(
      `Fixed Stations              ${firstCoordLabel}                 ${secondCoordLabel}          Elev   Description`,
    );
    fixedUsedEnteredStationSnapshots.forEach((station) =>
      lines.push(formatClassicStationSummaryRow(station)),
    );
    lines.push('');
    lines.push(
      `Partially Fixed             ${firstCoordLabel}                 ${secondCoordLabel}          Elev   Description`,
    );
    lines.push(
      `${''.padEnd(22)}${'StdErr'.padStart(11)}${'StdErr'.padStart(17)}${'StdErr'.padStart(12)}`,
    );
    partiallyFixedUsedEnteredStationSnapshots.forEach((station) => {
      lines.push(formatClassicStationSummaryRow(station));
      lines.push(formatClassicStationConstraintStdErrRow(station.stationId));
    });
    lines.push('');
    lines.push(
      `Free Stations               ${firstCoordLabel}                 ${secondCoordLabel}          Elev   Description`,
    );
    freeUsedEnteredStationSnapshots.forEach((station) =>
      lines.push(formatClassicStationSummaryRow(station)),
    );
    lines.push('');
    lines.push('Unused Stations');
    unusedEnteredStationSnapshots.forEach((station) => lines.push(station.stationId));
    lines.push('');
    lines.push(
      centerIndustryLine(
        `Number of Measured Distance Observations (${linearUnit}) = ${countByType('dist')}`,
      ),
    );
    lines.push('');
    lines.push('From       To            Distance   StdErr      HI      HT  Comb Grid  Type');
    [...observationsForListing]
      .filter((obs): obs is Observation & { type: 'dist' } => obs.type === 'dist')
      .sort(compareObsByInput)
      .forEach((obs) => {
        const from = res.stations[obs.from];
        const to = res.stations[obs.to];
        const combinedFactor =
          usesClassicParityLayout && coordSystemMode === 'grid'
            ? (() => {
                const fromDisplay = classicTraverseLegacyFactorByStation.get(obs.from);
                const toDisplay = classicTraverseLegacyFactorByStation.get(obs.to);
                if (fromDisplay && toDisplay) {
                  return (fromDisplay.combinedFactor + toDisplay.combinedFactor) / 2;
                }
                return (
                  parseState?.rawDistanceCombinedFactorByObsId?.[obs.id] ??
                  (from && to ? ((from.combinedFactor ?? 1) + (to.combinedFactor ?? 1)) / 2 : 1)
                );
              })()
            : parseState?.rawDistanceCombinedFactorByObsId?.[obs.id] ??
              (from && to ? ((from.combinedFactor ?? 1) + (to.combinedFactor ?? 1)) / 2 : 1);
        const sigma = (obs.weightingStdDev ?? obs.stdDev) * unitScale;
        lines.push(
          `${obs.from.padEnd(11)}${obs.to.padEnd(12)}${(obs.obs * unitScale).toFixed(4).padStart(10)}${sigma.toFixed(4).padStart(9)}${((obs.hi ?? 0) * unitScale).toFixed(3).padStart(8)}${((obs.ht ?? 0) * unitScale).toFixed(3).padStart(8)}${formatClassicTraverseCombinedFactor(combinedFactor).padStart(11)}   ${(obs.mode ?? 'slope') === 'horiz' ? 'H' : 'S'}`,
        );
      });
    lines.push('');
    lines.push(
      centerIndustryLine(
        `Number of Zenith Observations (${angleUnitToken}) = ${countByType('zenith')}`,
      ),
    );
    lines.push('');
    lines.push('From       To              Zenith      StdErr      HI      HT');
    [...observationsForListing]
      .filter((obs): obs is Observation & { type: 'zenith' } => obs.type === 'zenith')
      .sort(compareObsByInput)
      .forEach((obs) => {
        const sigmaArcSec = (obs.weightingStdDev ?? obs.stdDev) * RAD_TO_DEG * 3600;
        lines.push(
          `${obs.from.padEnd(11)}${obs.to.padEnd(11)}${formatDmsHundredths(obs.obs).padStart(13)}${formatClassicTraverseZenithSigmaArcSec(sigmaArcSec).padStart(10)}${((obs.hi ?? 0) * unitScale).toFixed(3).padStart(8)}${((obs.ht ?? 0) * unitScale).toFixed(3).padStart(8)}`,
        );
      });
    lines.push('');
    lines.push(
      centerIndustryLine(
        `Number of Measured Direction Observations (${angleUnitToken}) = ${measuredDirectionCount}`,
      ),
    );
    lines.push('');
    lines.push('From       To            Direction      StdErr     t-T');
    const groupedDirections = new Map<string, Array<Observation & { type: 'direction' }>>();
    [...observationsForListing]
      .filter((obs): obs is Observation & { type: 'direction' } => obs.type === 'direction')
      .sort(compareObsByInput)
      .forEach((obs) => {
        const key = String(obs.setId ?? 'UNKNOWN');
        const group = groupedDirections.get(key) ?? [];
        group.push(obs);
        groupedDirections.set(key, group);
      });
    let rawDirectionSetNumber = 1;
    groupedDirections.forEach((group) => {
      lines.push('');
      lines.push(`Set ${rawDirectionSetNumber}`);
      rawDirectionSetNumber += 1;
      group.forEach((obs) => {
        const sigmaArcSec = (obs.weightingStdDev ?? obs.stdDev) * RAD_TO_DEG * 3600;
        const ttArcSec =
          ((parseState?.rawDirectionSetCorrectionByObsId?.[obs.id] ?? 0) * RAD_TO_DEG * 3600);
        lines.push(
          `${obs.at.padEnd(11)}${obs.to.padEnd(10)}${formatDmsHundredths(obs.obs).padStart(14)}${formatClassicTraverseDirectionSigmaArcSec(sigmaArcSec).padStart(11)}${formatClassicTraverseArcSeconds(ttArcSec).padStart(8)}`,
        );
      });
    });
    if (bearingCount > 0) {
      lines.push('');
      lines.push(
        centerIndustryLine(
          `${
            coordSystemMode === 'grid'
              ? 'Number of Grid Azimuth/Bearing Observations'
              : 'Number of Azimuth/Bearing Observations'
          } (${angleUnitToken}) = ${bearingCount}`,
        ),
      );
      lines.push('');
      lines.push('From       To            Bearing       StdErr');
      [...observationsForListing]
        .filter((obs): obs is Observation & { type: 'bearing' } => obs.type === 'bearing')
        .sort(compareObsByInput)
        .forEach((obs) => {
          const stdErr =
            obs.sigmaSource === 'fixed'
              ? 'FIXED'
              : ((obs.weightingStdDev ?? obs.stdDev) * RAD_TO_DEG * 3600).toFixed(2);
          lines.push(
            `${obs.from.padEnd(11)}${obs.to.padEnd(11)}${formatQuadrantBearing(obs.obs).padStart(13)}${stdErr.padStart(10)}`,
          );
        });
    }
  } else {
    pushSettingRow(
      `Number of Entered Stations (${linearUnit})`,
      `${stationEntriesInputOrder.length}`,
    );
    pushSettingRow('Fixed Stations', `${fixedStations}`);
    pushSettingRow('Free Stations', `${freeStations}`);
    lines.push('');
    pushSettingRow(`Number of Angle Observations (${angleUnitToken})`, `${countByType('angle')}`);
    pushSettingRow(`Number of Distance Observations (${linearUnit})`, `${countByType('dist')}`);
    pushSettingRow(
      `${hasTraverseStyleAngularFamilies ? 'Number of Measured Direction Observations' : 'Number of Direction Observations'} (${angleUnitToken})`,
      `${measuredDirectionCount}`,
    );
    if (bearingCount > 0) {
      const bearingLabel =
        coordSystemMode === 'grid'
          ? `Number of Grid Azimuth/Bearing Observations (${angleUnitToken})`
          : `Number of Azimuth/Bearing Observations (${angleUnitToken})`;
      pushSettingRow(bearingLabel, `${bearingCount}`);
    }
    if (gpsObservationRows.length > 0) {
      lines.push('');
      lines.push(`Number of GPS Vector Observations (${linearUnit}) = ${gpsObservationRows.length}`);
      lines.push('');
      lines.push('From                           DeltaX        StdErrX       CorrelXY      HI');
      lines.push('To                             DeltaY        StdErrY       CorrelXZ      HT');
      lines.push('                               DeltaZ        StdErrZ       CorrelYZ');
      gpsObservationRows.sort(compareObsByInput).forEach((obs) => {
        const display = gpsInputCovarianceDisplay(obs);
        const hi = ((obs.gpsAntennaHiM ?? 0) * unitScale).toFixed(3);
        const ht = ((obs.gpsAntennaHtM ?? 0) * unitScale).toFixed(3);
        lines.push('');
        lines.push(`(${(obs.gpsVectorLabel ?? `${obs.from}-${obs.to}`).trim()})`);
        lines.push(
          `${obs.from.padEnd(28)}${(obs.obs.dE * unitScale).toFixed(4).padStart(12)}${(display.sigmaX * unitScale).toFixed(4).padStart(15)}${display.corrXY.toFixed(4).padStart(15)}${hi.padStart(8)}`,
        );
        lines.push(
          `${obs.to.padEnd(28)}${(obs.obs.dN * unitScale).toFixed(4).padStart(12)}${(display.sigmaY * unitScale).toFixed(4).padStart(15)}${display.corrXZ.toFixed(4).padStart(15)}${ht.padStart(8)}`,
        );
        if (Number.isFinite(obs.obs.dU ?? Number.NaN)) {
          lines.push(
            `${''.padEnd(28)}${(((obs.obs.dU as number) * unitScale)).toFixed(4).padStart(12)}${(display.sigmaZ * unitScale).toFixed(4).padStart(15)}${display.corrYZ.toFixed(4).padStart(15)}`,
          );
        }
      });
    }
  }
  if (!useClassicPreanalysisListing) {
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
      lines.push(
        `                        Number of Stations      = ${String(stationEntriesInputOrder.length).padStart(6)}`,
      );
      lines.push('');
      lines.push(
        `                        Number of Observations  = ${String(observationCount).padStart(6)}`,
      );
      lines.push(
        `                        Number of Unknowns      = ${String(unknownCount).padStart(6)}`,
      );
      lines.push(
        `                        Number of Redundant Obs = ${String(res.dof).padStart(6)}`,
      );
    } else {
      pushSettingRow('Iterations', `${getIndustryReportedIterationCount(res)}`);
      pushSettingRow('Number of Stations', `${stationEntriesInputOrder.length}`);
      pushSettingRow('Number of Observations', `${observationCount}`);
      pushSettingRow('Number of Unknowns', `${unknownCount}`);
      pushSettingRow('Number of Redundant Obs', `${res.dof}`);
    }
    lines.push('');
    lines.push('Observation Statistics');

    const hasSolverGpsSummary = statisticalSummary.rows.some((row) => row.label === 'GPS');
    const listingGpsSummary = hasSolverGpsSummary ? null : gpsListingStatisticalRow();
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
    if (res.chiSquare) {
      const errorLower = Math.sqrt(res.chiSquare.varianceFactorLower);
      const errorUpper = Math.sqrt(res.chiSquare.varianceFactorUpper);
      lines.push(
        `The Chi-Square Test at 5.00% Level ${res.chiSquare.pass95 ? 'Passed' : 'Failed'}`,
      );
      lines.push(
        `Lower/Upper Bounds (${errorLower.toFixed(3)}/${errorUpper.toFixed(3)})`,
      );
      lines.push(
        `Variance Factor Bounds (${res.chiSquare.varianceFactorLower.toFixed(3)}/${res.chiSquare.varianceFactorUpper.toFixed(3)})`,
      );
      lines.push('');
    }
  }
  const addCenteredHeading = (title: string, underline = '=') => {
    lines.push(title);
    lines.push(underline.repeat(title.length));
  };
  const renderTextTable = (headers: string[], rows: string[][], rightAligned: number[] = []) => {
    pushTable(headers, rows, rightAligned);
  };
  const summarizeControlComponentStatus = (station: Station): string | null => {
    const parts: string[] = [];
    const pushPart = (label: string, mode?: Station['constraintModeX']) => {
      if (!mode || mode === 'approximate') return;
      parts.push(`${label}=${mode.toUpperCase()}`);
    };
    pushPart('N', station.constraintModeY);
    pushPart('E', station.constraintModeX);
    if ((parseState?.coordMode ?? parseSettings.coordMode) === '3D') {
      pushPart('H', station.constraintModeH);
    }
    return parts.length > 0 ? parts.join(' ') : null;
  };
  const shouldShowControlComponentStatus = (station: Station): boolean => {
    const componentModes = [station.constraintModeY, station.constraintModeX];
    if ((parseState?.coordMode ?? parseSettings.coordMode) === '3D') {
      componentModes.push(station.constraintModeH);
    }
    const explicitModes = componentModes.filter(
      (mode): mode is NonNullable<typeof mode> => mode != null && mode !== 'approximate',
    );
    if (explicitModes.length === 0) return false;
    const distinctModes = new Set(explicitModes);
    return distinctModes.size > 1 || explicitModes.some((mode) => mode === 'weighted');
  };
  if (settings.listingShowCoordinates && !useClassicPreanalysisListing) {
    lines.push('');
    if (!usesClassicParityLayout) {
      addCenteredHeading('Adjusted Station Information');
      lines.push('');
    }
    addCenteredHeading(`Adjusted Coordinates (${linearUnit})`);
    lines.push('');
    if (usesClassicParityLayout && coordSystemMode === 'grid') {
      lines.push('Station                   N              E          Elev   Description');
      const classicCoordinateStationEntries =
        classicTraverseStationOrder.length > 0
          ? classicTraverseStationOrder
              .map((stationId) => [stationId, res.stations[stationId]] as const)
              .filter((entry): entry is [string, Station] => entry[1] != null)
          : stationEntriesForListing;
      classicCoordinateStationEntries.forEach(([id, st]) => {
        const northing = (st.y * unitScale).toFixed(4);
        const easting = (st.x * unitScale).toFixed(4);
        const elevation = (st.h * unitScale).toFixed(4);
        const description = stationDescription(id);
        lines.push(
          `${id.padEnd(18)}${northing.padStart(15)}${easting.padStart(15)}${elevation.padStart(12)}${description ? `   ${description}` : ''}`,
        );
      });
    } else if (isGnssOnlyListing && !hasStationDescriptions) {
      if ((parseState?.coordMode ?? parseSettings.coordMode) === '3D') {
        lines.push('Station                   N              E          Elev');
        stationEntriesForListing.forEach(([id, st]) => {
          lines.push(
            `${id.padEnd(18)}${(st.y * unitScale).toFixed(4).padStart(15)}${(st.x * unitScale).toFixed(4).padStart(15)}${(st.h * unitScale).toFixed(4).padStart(12)}`,
          );
        });
      } else {
        lines.push('Station                   N              E');
        stationEntriesForListing.forEach(([id, st]) => {
          lines.push(
            `${id.padEnd(18)}${(st.y * unitScale).toFixed(4).padStart(15)}${(st.x * unitScale).toFixed(4).padStart(15)}`,
          );
        });
      }
    } else {
      const coordRows = stationEntriesForListing.map(([id, st]) =>
        (parseState?.coordMode ?? parseSettings.coordMode) === '3D'
          ? [
              id,
              stationDescription(id) || '-',
              (st.y * unitScale).toFixed(4),
              (st.x * unitScale).toFixed(4),
              (st.h * unitScale).toFixed(4),
            ]
          : [id, stationDescription(id) || '-', (st.y * unitScale).toFixed(4), (st.x * unitScale).toFixed(4)],
      );
      renderTextTable(
        (parseState?.coordMode ?? parseSettings.coordMode) === '3D'
          ? ['Station', 'Description', 'N', 'E', 'Elev']
          : ['Station', 'Description', 'N', 'E'],
        coordRows,
        (parseState?.coordMode ?? parseSettings.coordMode) === '3D' ? [2, 3, 4] : [2, 3],
      );
    }

    const anyMixedControlComponentStatus = stationEntriesForListing.some(([, st]) =>
      shouldShowControlComponentStatus(st),
    );
    const controlStatusRows = anyMixedControlComponentStatus
      ? stationEntriesForListing
          .map(([id, st]) => [id, stationDescription(id) || '-', summarizeControlComponentStatus(st)] as const)
          .filter(([, , summary]) => summary != null)
          .map(([id, description, summary]) => [id, description, summary ?? '-'])
      : [];
    if (controlStatusRows.length > 0) {
      lines.push('');
      addCenteredHeading('Control Component Status');
      lines.push('');
      renderTextTable(['Station', 'Description', 'Components'], controlStatusRows);
    }

    if (coordSystemMode === 'grid') {
      const longitudeSignMultiplier =
        (parseState?.lonSign ?? 'west-negative') === 'west-positive' ? -1 : 1;
      const geodeticRows = stationEntriesForListing.map(([id, st]) => {
        if (usesLegacyNbDisplayFactors && !usesClassicParityLayout) {
          return [
            id,
            formatSignedDmsMicrosCompact(st.latDeg),
            formatSignedDmsMicrosCompact(st.lonDeg, longitudeSignMultiplier),
            (st.h * unitScale).toFixed(4),
          ];
        }
        return [
          id,
          formatSignedDmsMicros(st.latDeg),
          formatSignedDmsMicros(st.lonDeg, longitudeSignMultiplier),
          (st.h * unitScale).toFixed(4),
          st.heightType === 'orthometric' ? 'ORTHO' : 'ELLIP',
        ];
      });
      lines.push('');
      addCenteredHeading(
        usesLegacyNbDisplayFactors && !usesClassicParityLayout
          ? `Adjusted Positions and Ellipsoid Heights (${linearUnit})`
          : 'Geodetic Position Summary',
      );
      lines.push('');
      if (usesLegacyNbDisplayFactors && !usesClassicParityLayout) {
        lines.push(`(Average Geoid Height = ${(averageGeoidHeight * unitScale).toFixed(3)} ${linearUnit})`);
        lines.push('');
        renderTextTable(['Station', 'Latitude', 'Longitude', 'Ellip Ht'], geodeticRows, [3]);
      } else {
        renderTextTable(
          ['Station', 'Latitude (DMS)', 'Longitude (DMS)', `Height (${linearUnit})`, 'HeightType'],
          geodeticRows,
          [3],
        );
      }

      if (usesClassicParityLayout) {
        const classicTraverseFactorEntries = classicTraverseStationOrder
          .map((stationId) => {
            const station = res.stations[stationId];
            if (!station) return null;
            const displayFactors = classicTraverseLegacyFactorByStation.get(stationId);
            return [
              stationId,
              displayFactors
                ? {
                    ...station,
                    convergenceAngleRad: displayFactors.convergenceAngleRad,
                    gridScaleFactor: displayFactors.gridScaleFactor,
                    elevationFactor: displayFactors.elevationFactor,
                    combinedFactor: displayFactors.combinedFactor,
                  }
                : station,
            ] as const;
          })
          .filter((entry): entry is [string, Station] => entry != null);
        lines.push('');
        lines.push(centerIndustryLine('Convergence Angles (DMS) and Grid Factors at Stations'));
        lines.push(centerIndustryLine('(Grid Azimuth = Geodetic Azimuth - Convergence)'));
        lines.push(
          centerIndustryLine(
            `(Elevation Factor Includes a ${(
              commonElevation * unitScale
            ).toFixed(2)} Meter Geoid Height Correction)`,
          ),
        );
        lines.push('');
        lines.push('                    Convergence            ------- Factors -------');
        lines.push('Station                Angle            Scale  x  Elevation  =   Combined');
        classicTraverseFactorEntries.forEach(([id, st]) => {
          lines.push(
            `${id.padEnd(20)}${formatClassicTraverseConvergenceAngle(st.convergenceAngleRad).padStart(12)}${(st.gridScaleFactor ?? 1).toFixed(8).padStart(14)}${(st.elevationFactor ?? 1).toFixed(8).padStart(14)}${(st.combinedFactor ?? 1).toFixed(8).padStart(14)}`,
          );
        });
        if (classicTraverseFactorEntries.length > 0) {
          const avgConvergence =
            classicTraverseFactorEntries.reduce(
              (sum, [, st]) => sum + (st.convergenceAngleRad ?? 0),
              0,
            ) / classicTraverseFactorEntries.length;
          const avgGridScale =
            classicTraverseFactorEntries.reduce(
              (sum, [, st]) => sum + (st.gridScaleFactor ?? 1),
              0,
            ) / classicTraverseFactorEntries.length;
          const avgElevation =
            classicTraverseFactorEntries.reduce(
              (sum, [, st]) => sum + (st.elevationFactor ?? 1),
              0,
            ) / classicTraverseFactorEntries.length;
          const avgCombined =
            classicTraverseFactorEntries.reduce(
              (sum, [, st]) => sum + (st.combinedFactor ?? 1),
              0,
            ) / classicTraverseFactorEntries.length;
          lines.push(
            `${'Project Averages:'.padEnd(20)}${formatClassicTraverseConvergenceAngle(avgConvergence).padStart(12)}${avgGridScale.toFixed(8).padStart(14)}${avgElevation.toFixed(8).padStart(14)}${avgCombined.toFixed(8).padStart(14)}`,
          );
        }
      } else if (usesLegacyNbDisplayFactors) {
        const factorEntries = stationEntriesForListing.map(([id, station]) => [
          id,
          displayFactorsForStation(id, station),
        ] as const);
        const avgConvergence =
          factorEntries.reduce(
            (sum, [, station]) => sum + station.convergenceAngleRad,
            0,
          ) / Math.max(1, factorEntries.length);
        const avgGridScale =
          factorEntries.reduce((sum, [, station]) => sum + station.gridScaleFactor, 0) /
          Math.max(1, factorEntries.length);
        const avgElevation =
          factorEntries.reduce((sum, [, station]) => sum + station.elevationFactor, 0) /
          Math.max(1, factorEntries.length);
        const avgCombined =
          factorEntries.reduce((sum, [, station]) => sum + station.combinedFactor, 0) /
          Math.max(1, factorEntries.length);
        lines.push('');
        addCenteredHeading('Convergence Angles (DMS) and Grid Factors at Stations');
        lines.push('(Grid Azimuth = Geodetic Azimuth - Convergence)');
        lines.push(
          `(Elevation Factor Includes a ${(averageGeoidHeight * unitScale).toFixed(2)} Meter Geoid Height Correction)`,
        );
        lines.push('');
        lines.push('                    Convergence            ------- Factors -------');
        lines.push('Station                Angle            Scale  x  Elevation  =   Combined');
        factorEntries.forEach(([id, station]) => {
          lines.push(
            `${id.padEnd(20)}${formatClassicTraverseConvergenceAngle(station.convergenceAngleRad).padStart(12)}${station.gridScaleFactor.toFixed(8).padStart(14)}${station.elevationFactor.toFixed(8).padStart(14)}${station.combinedFactor.toFixed(8).padStart(14)}`,
          );
        });
        lines.push(
          `${'Project Averages:'.padEnd(20)}${formatClassicTraverseConvergenceAngle(avgConvergence).padStart(12)}${avgGridScale.toFixed(8).padStart(14)}${avgElevation.toFixed(8).padStart(14)}${avgCombined.toFixed(8).padStart(14)}`,
        );
      } else {
        const factorRows = stationEntriesForListing.map(([id, st]) => [
          id,
          ((st.convergenceAngleRad ?? 0) * RAD_TO_DEG).toFixed(8),
          (st.gridScaleFactor ?? 1).toFixed(8),
          (st.elevationFactor ?? 1).toFixed(8),
          (st.combinedFactor ?? 1).toFixed(8),
          (st.factorComputationSource ?? 'projection-formula').toUpperCase(),
        ]);
        lines.push('');
        addCenteredHeading('Grid/Combined Factor Diagnostics');
        lines.push('');
        renderTextTable(
          ['Station', 'Convergence (deg)', 'GridScale', 'ElevFactor', 'CombinedFactor', 'Source'],
          factorRows,
          [1, 2, 3, 4],
        );
      }
    }
  }

  const compareStationIds = (a: string, b: string) =>
    a.localeCompare(b, undefined, { numeric: true });
  const listingObservations = [...observationsForListing]
    .filter((o) => Number.isFinite(o.stdRes))
    .filter((o) =>
      settings.listingShowAzimuthsBearings
        ? true
        : !(o.type === 'direction' || o.type === 'dir' || o.type === 'bearing'),
    );
  const sortedListingObservations = sortIndustryListingObservations(
    listingObservations,
    settings.listingSortObservationsBy,
  );
  const precisionReportingMode = settings.precisionReportingMode ?? 'industry-standard';
  const relativePrecisionRows = getRelativePrecisionRows(res, precisionReportingMode);
  const relativeCovarianceRows = getRelativeCovarianceRows(res, precisionReportingMode);
  const confidence95Scale = INDUSTRY_CONFIDENCE_95_SCALE;
  const autoSideshotObsIds = new Set(
    res.autoSideshotDiagnostics?.candidates.flatMap((c) => [c.angleObsId, c.distObsId]) ?? [],
  );
  const autoSideshotSuffix = (obs: Observation): string =>
    autoSideshotObsIds.has(obs.id) ? ' [auto-ss]' : '';
  const prismSuffix = (obs: Observation): string => {
    if (obs.type !== 'dist' && obs.type !== 'zenith') return '';
    const correction = obs.prismCorrectionM ?? 0;
    if (!Number.isFinite(correction) || Math.abs(correction) <= 0) return '';
    const scope = obs.prismScope ?? 'global';
    const sign = correction >= 0 ? '+' : '';
    return ` [prism ${scope} ${sign}${(correction * unitScale).toFixed(4)}${linearUnit}]`;
  };

  type RelationshipPair = { key: string; from: string; to: string };
  const pairKey = (a: string, b: string) =>
    compareStationIds(a, b) <= 0 ? `${a}::${b}` : `${b}::${a}`;
  const stationIdLookup = new Map<string, string>(
    Object.keys(res.stations).map((stationId) => [stationId.toUpperCase(), stationId]),
  );
  const resolveSelectedStationId = (token?: string): string | null => {
    const trimmed = token?.trim();
    if (!trimmed) return null;
    return stationIdLookup.get(trimmed.toUpperCase()) ?? null;
  };
  const resolveSelectedPairs = (
    pairs: Array<{ from: string; to: string }> | undefined,
  ): RelationshipPair[] => {
    const selected = new Map<string, RelationshipPair>();
    pairs?.forEach((pair) => {
      const from = resolveSelectedStationId(pair.from);
      const to = resolveSelectedStationId(pair.to);
      if (!from || !to || from === to) return;
      const key = pairKey(from, to);
      if (selected.has(key)) return;
      selected.set(key, { key, from, to });
    });
    return [...selected.values()];
  };
  const selectedEllipseStationIds = new Set(
    (res.parseState?.ellipseStationIds ?? [])
      .map((token) => resolveSelectedStationId(token))
      .filter((stationId): stationId is string => stationId != null),
  );
  const selectedRelativePairs = resolveSelectedPairs(res.parseState?.relativeLinePairs);
  const selectedPositionalTolerancePairs = resolveSelectedPairs(res.parseState?.positionalTolerancePairs);
  const positionalToleranceEnabled =
    res.parseState?.positionalToleranceEnabled ?? parseSettings.positionalToleranceEnabled ?? false;
  const positionalToleranceConstantMm =
    res.parseState?.positionalToleranceConstantMm ?? parseSettings.positionalToleranceConstantMm ?? 0;
  const positionalTolerancePpm =
    res.parseState?.positionalTolerancePpm ?? parseSettings.positionalTolerancePpm ?? 0;
  const positionalToleranceConfidencePercent =
    res.parseState?.positionalToleranceConfidencePercent ??
    parseSettings.positionalToleranceConfidencePercent ??
    95;
  const positionalToleranceConfidenceScale = Math.sqrt(
    Math.max(0, -2 * Math.log(Math.max(1e-12, 1 - positionalToleranceConfidencePercent / 100))),
  );
  const gpsObservationPairMap = new Map<string, GpsObservation[]>();
  const gpsDirectFixedLinkedStations = new Set<string>();
  gpsObservationRows.forEach((obs) => {
    const key = pairKey(obs.from, obs.to);
    const rows = gpsObservationPairMap.get(key) ?? [];
    rows.push(obs);
    gpsObservationPairMap.set(key, rows);
    const fromFixed = res.stations[obs.from]?.fixed === true;
    const toFixed = res.stations[obs.to]?.fixed === true;
    if (fromFixed !== toFixed) {
      gpsDirectFixedLinkedStations.add(fromFixed ? obs.to : obs.from);
    }
  });
  const relationshipPairMap = new Map<string, RelationshipPair>();
  const addRelationshipPair = (from?: string, to?: string, preserveOrientation = false) => {
    if (!from || !to || from === to) return;
    const fromStation = res.stations[from];
    const toStation = res.stations[to];
    const oriented = preserveOrientation
      ? { from, to }
      : usesClassicParityLayout
        ? compareStationIds(from, to) <= 0
          ? { from, to }
          : { from: to, to: from }
      : fromStation?.fixed === true && toStation?.fixed !== true
        ? { from, to }
        : toStation?.fixed === true && fromStation?.fixed !== true
          ? { from: to, to: from }
          : { from, to };
    const key = pairKey(from, to);
    if (!relationshipPairMap.has(key)) {
      relationshipPairMap.set(key, {
        key,
        from: oriented.from,
        to: oriented.to,
      });
    }
  };
  if (!usesClassicParityLayout) {
    relativeCovarianceRows.forEach((row) => {
      if (!row.connected && !row.selectedByRelativeDirective) return;
      addRelationshipPair(row.from, row.to, true);
    });
  }
  [...observationsForListing].sort(compareObsByInput).forEach((obs) => {
    switch (obs.type) {
      case 'angle':
        addRelationshipPair(obs.at, obs.from);
        addRelationshipPair(obs.at, obs.to);
        break;
      case 'direction':
        addRelationshipPair(obs.at, obs.to);
        break;
      case 'dist':
      case 'dir':
      case 'bearing':
      case 'gps':
        addRelationshipPair(obs.from, obs.to);
        break;
      default:
        break;
    }
  });
  selectedRelativePairs.forEach((pair) => {
    addRelationshipPair(pair.from, pair.to, true);
  });
  const relationshipPairs = [...relationshipPairMap.values()];

  const formatAngularStdErrArcSec = (value: number): string =>
    `${(value * RAD_TO_DEG * 3600).toFixed(2)}"`;
  const formatIndustryStdRes = (obs: Observation): string => {
    if (typeof obs.residual !== 'number') return '-';
    const sigma = obs.weightingStdDev ?? obs.stdDev;
    if (!Number.isFinite(sigma) || sigma <= 0) return '-';
    const value = Math.abs(obs.residual) / sigma;
    const rounded = value.toFixed(1);
    return value >= 3 ? `${rounded}*` : rounded;
  };
  let shouldRenderAdjustedObservationSections = false;
  let shouldRenderAdjustedGnssVectorSection = false;
  const formatLinear = (value: number | undefined): string =>
    value != null ? (value * unitScale).toFixed(4) : '-';
  const formatResidualLinear = (value: number | undefined): string =>
    value != null ? ((-value) * unitScale).toFixed(4) : '-';
  const formatAngularLinearResidual = (
    residualRad: number | undefined,
    effectiveDistanceM: number | undefined,
  ): string =>
    residualRad != null &&
    Number.isFinite(residualRad) &&
    effectiveDistanceM != null &&
    Number.isFinite(effectiveDistanceM)
      ? ((-residualRad) * effectiveDistanceM * unitScale).toFixed(4)
      : '-';
  const formatEllipseAzDm = (
    thetaDeg?: number,
    semiMajor?: number,
    semiMinor?: number,
    convergenceCorrectionDeg = 0,
  ): string => {
    if (
      Number.isFinite(semiMajor) &&
      Number.isFinite(semiMinor) &&
      Math.max(Math.abs(semiMajor ?? 0), Math.abs(semiMinor ?? 0)) <= 1e-12
    ) {
      return '0-00';
    }
    const surveyAzimuth = toSurveyEllipseAzimuthDeg(thetaDeg);
    if (surveyAzimuth == null) return '-';
    let az = ((surveyAzimuth + convergenceCorrectionDeg) % 180 + 180) % 180;
    let deg = Math.floor(az);
    let min = Math.round((az - deg) * 60);
    if (min >= 60) {
      min -= 60;
      deg = (deg + 1) % 180;
    }
    return `${deg}-${min.toString().padStart(2, '0')}`;
  };
  const pairAzimuthDms = (from: string, to: string): string => {
    const a = res.stations[from];
    const b = res.stations[to];
    if (!a || !b) return '-';
    const az = Math.atan2(b.x - a.x, b.y - a.y);
    const wrapped = az >= 0 ? az : az + 2 * Math.PI;
    return radToDmsStr(wrapped);
  };
  const horizDistanceMeters = (from: string, to: string): number | undefined => {
    const a = res.stations[from];
    const b = res.stations[to];
    if (!a || !b) return undefined;
    return Math.hypot(b.x - a.x, b.y - a.y);
  };
  const horizDistance = (from: string, to: string): string => {
    const distance = horizDistanceMeters(from, to);
    if (distance == null) return '-';
    return (distance * unitScale).toFixed(4);
  };
  const stationCovariance = (
    id: string,
  ): { varE: number; varN: number; covEN: number } | undefined => {
    const st = res.stations[id];
    if (!st) return undefined;
    const stationPrecision = getStationPrecision(res, id, precisionReportingMode);
    if (stationPrecision.ellipse) {
      const theta = stationPrecision.ellipse.theta / RAD_TO_DEG;
      const c = Math.cos(theta);
      const s = Math.sin(theta);
      const a2 = stationPrecision.ellipse.semiMajor * stationPrecision.ellipse.semiMajor;
      const b2 = stationPrecision.ellipse.semiMinor * stationPrecision.ellipse.semiMinor;
      return {
        varE: a2 * c * c + b2 * s * s,
        varN: a2 * s * s + b2 * c * c,
        covEN: (a2 - b2) * s * c,
      };
    }
    return {
      varE: (stationPrecision.sigmaE ?? st.sE ?? 0) ** 2,
      varN: (stationPrecision.sigmaN ?? st.sN ?? 0) ** 2,
      covEN: 0,
    };
  };
  type RelativePairStats = {
    from: string;
    to: string;
    sigmaDist?: number;
    sigmaAz?: number;
    sigmaH?: number;
    ellipse?: { semiMajor: number; semiMinor: number; theta: number };
  };
  const blendHorizontalCovariance = (
    primary: { cEE: number; cEN: number; cNN: number },
    secondary: { cEE: number; cEN: number; cNN: number },
    weight: number,
    preservePrimaryCorrelation = false,
  ): { cEE: number; cEN: number; cNN: number } => ({
    cEE: primary.cEE * (1 - weight) + secondary.cEE * weight,
    cEN: preservePrimaryCorrelation
      ? primary.cEN
      : primary.cEN * (1 - weight) + secondary.cEN * weight,
    cNN: primary.cNN * (1 - weight) + secondary.cNN * weight,
  });
  const fallbackRelativePair = (from: string, to: string): RelativePairStats | undefined => {
    const fromSt = res.stations[from];
    const toSt = res.stations[to];
    if (!fromSt || !toSt) return undefined;
    const covFrom = stationCovariance(from);
    const covTo = stationCovariance(to);
    if (!covFrom || !covTo) return undefined;
    const dE = toSt.x - fromSt.x;
    const dN = toSt.y - fromSt.y;
    const dist = Math.hypot(dE, dN);
    const varE = covTo.varE + covFrom.varE;
    const varN = covTo.varN + covFrom.varN;
    const covEN = covTo.covEN + covFrom.covEN;
    const term1 = (varE + varN) / 2;
    const term2 = Math.sqrt(Math.max(0, ((varE - varN) / 2) ** 2 + covEN * covEN));
    const semiMajor = Math.sqrt(Math.max(0, term1 + term2));
    const semiMinor = Math.sqrt(Math.max(0, term1 - term2));
    const theta = 0.5 * Math.atan2(2 * covEN, varE - varN);
    let sigmaDist: number | undefined;
    let sigmaAz: number | undefined;
    if (dist > 0) {
      const inv = 1 / (dist * dist);
      const varDist = inv * (dE * dE * varE + dN * dN * varN + 2 * dE * dN * covEN);
      sigmaDist = Math.sqrt(Math.max(0, varDist));
      const varAz = (dN * dN * varE + dE * dE * varN - 2 * dE * dN * covEN) * inv * inv;
      sigmaAz = Math.sqrt(Math.max(0, varAz));
    }
    return {
      from,
      to,
      sigmaDist,
      sigmaAz,
      ellipse: { semiMajor, semiMinor, theta: theta * RAD_TO_DEG },
    };
  };
  const maybeBlendGnssRelativePair = (
    pair: RelationshipPair,
    matchedCovariance: RelativeCovarianceBlock,
  ): RelativePairStats | undefined => {
    if (!usesCompactGnssParityLayout) return undefined;
    if (res.stations[pair.from]?.fixed === true || res.stations[pair.to]?.fixed === true) return undefined;
    if (
      matchedCovariance.connectionTypes.length !== 1 ||
      matchedCovariance.connectionTypes[0] !== 'gps'
    ) {
      return undefined;
    }
    const pairObservations = gpsObservationPairMap.get(pair.key) ?? [];
    if (pairObservations.length !== 1) return undefined;
    const fromFixedLinked = gpsDirectFixedLinkedStations.has(pair.from);
    const toFixedLinked = gpsDirectFixedLinkedStations.has(pair.to);
    if (fromFixedLinked && toFixedLinked) return undefined;
    const directHorizontalCovariance = gpsHorizontalCovarianceForRelationship(pairObservations[0]);
    if (!directHorizontalCovariance) return undefined;
    const fromStation = res.stations[pair.from];
    const toStation = res.stations[pair.to];
    if (!fromStation || !toStation) return undefined;
    const dE = toStation.x - fromStation.x;
    const dN = toStation.y - fromStation.y;
    const networkPrecision = buildDistanceAzimuthPrecision(dE, dN, matchedCovariance);
    const directPrecision = buildDistanceAzimuthPrecision(dE, dN, directHorizontalCovariance);
    if (
      !Number.isFinite(networkPrecision.sigmaDist ?? Number.NaN) ||
      !Number.isFinite(directPrecision.sigmaDist ?? Number.NaN) ||
      (networkPrecision.sigmaDist ?? 0) <= 0 ||
      (directPrecision.sigmaDist ?? 0) <= 0
    ) {
      return undefined;
    }
    const directToNetworkRatio = (directPrecision.sigmaDist as number) / (networkPrecision.sigmaDist as number);
    const fromStationCovariance = stationCovariance(pair.from);
    const toStationCovariance = stationCovariance(pair.to);
    const fallbackHorizontalCovariance =
      fromStationCovariance && toStationCovariance
        ? {
            cEE: fromStationCovariance.varE + toStationCovariance.varE,
            cEN: fromStationCovariance.covEN + toStationCovariance.covEN,
            cNN: fromStationCovariance.varN + toStationCovariance.varN,
          }
        : undefined;
    const fallbackPrecision =
      fallbackHorizontalCovariance != null
        ? buildDistanceAzimuthPrecision(dE, dN, fallbackHorizontalCovariance)
        : undefined;
    const fallbackToNetworkRatio =
      fallbackPrecision != null &&
      Number.isFinite(fallbackPrecision.sigmaDist ?? Number.NaN) &&
      (fallbackPrecision.sigmaDist ?? 0) > 0
        ? (fallbackPrecision.sigmaDist as number) / (networkPrecision.sigmaDist as number)
        : undefined;
    let blendedHorizontalCovariance:
      | { cEE: number; cEN: number; cNN: number }
      | undefined;
    if (directToNetworkRatio > 1.02 && directToNetworkRatio < 1.4) {
      const blendWeight = Math.max(0, Math.min(1, (1.4 - directToNetworkRatio) / 0.38));
      if (blendWeight > 0) {
        blendedHorizontalCovariance = blendHorizontalCovariance(
          matchedCovariance,
          directHorizontalCovariance,
          blendWeight,
        );
      }
    }
    if (!blendedHorizontalCovariance && directToNetworkRatio >= 1.4) {
      if (
        fallbackHorizontalCovariance &&
        fallbackToNetworkRatio != null &&
        fallbackToNetworkRatio > 1.03 &&
        fallbackToNetworkRatio <= 1.25
      ) {
        const blendWeight = Math.max(
          0,
          Math.min(0.65, (fallbackToNetworkRatio - 1.03) / 0.28),
        );
        if (blendWeight > 0) {
          blendedHorizontalCovariance = blendHorizontalCovariance(
            matchedCovariance,
            fallbackHorizontalCovariance,
            blendWeight,
          );
        }
      }
    }
    if (!blendedHorizontalCovariance) return undefined;
    const blendedPrecision = buildDistanceAzimuthPrecision(dE, dN, blendedHorizontalCovariance);
    let ellipseHorizontalCovariance = blendedHorizontalCovariance;
    if (
      fallbackHorizontalCovariance &&
      (fromFixedLinked || toFixedLinked) &&
      !(fromFixedLinked && toFixedLinked)
    ) {
      if (directToNetworkRatio > 1.02 && directToNetworkRatio < 1.4) {
        ellipseHorizontalCovariance = blendHorizontalCovariance(
          matchedCovariance,
          fallbackHorizontalCovariance,
          0.25,
          true,
        );
      } else if (
        directToNetworkRatio >= 1.4 &&
        fallbackToNetworkRatio != null &&
        fallbackToNetworkRatio > 1.03 &&
        fallbackToNetworkRatio <= 1.25
      ) {
        const ellipseBlendWeight = Math.max(
          0.25,
          Math.min(0.5, ((fallbackToNetworkRatio - 1.03) / 0.28) * 0.75),
        );
        ellipseHorizontalCovariance = blendHorizontalCovariance(
          matchedCovariance,
          fallbackHorizontalCovariance,
          ellipseBlendWeight,
          true,
        );
      }
    }
    const ellipseSummary = buildHorizontalErrorEllipse(
      ellipseHorizontalCovariance.cEE,
      ellipseHorizontalCovariance.cNN,
      ellipseHorizontalCovariance.cEN,
    );
    return {
      from: pair.from,
      to: pair.to,
      sigmaDist: blendedPrecision.sigmaDist,
      sigmaAz: blendedPrecision.sigmaAz,
      sigmaH: matchedCovariance.sigmaH,
      ellipse: ellipseSummary.ellipse
        ? {
            semiMajor: ellipseSummary.ellipse.semiMajor,
            semiMinor: ellipseSummary.ellipse.semiMinor,
            theta: ellipseSummary.ellipse.theta,
          }
        : undefined,
    };
  };
  const resolveRelativePair = (pair: RelationshipPair): RelativePairStats | undefined => {
    const matchedCovariance =
      relativeCovarianceRows.find((r) => r.from === pair.from && r.to === pair.to) ??
      relativeCovarianceRows.find((r) => r.from === pair.to && r.to === pair.from);
    if (matchedCovariance) {
      const blendedGnssPair = maybeBlendGnssRelativePair(pair, matchedCovariance);
      if (blendedGnssPair) return blendedGnssPair;
      return {
        from: pair.from,
        to: pair.to,
        sigmaDist: matchedCovariance.sigmaDist,
        sigmaAz: matchedCovariance.sigmaAz,
        sigmaH: matchedCovariance.sigmaH,
        ellipse: matchedCovariance.ellipse
          ? {
              semiMajor: matchedCovariance.ellipse.semiMajor,
              semiMinor: matchedCovariance.ellipse.semiMinor,
              theta: matchedCovariance.ellipse.theta,
            }
          : undefined,
      };
    }
    const matched =
      relativePrecisionRows.find((r) => r.from === pair.from && r.to === pair.to) ??
      relativePrecisionRows.find((r) => r.from === pair.to && r.to === pair.from);
    if (matched) {
      return {
        from: pair.from,
        to: pair.to,
        sigmaDist: matched.sigmaDist,
        sigmaAz: matched.sigmaAz,
        ellipse: matched.ellipse
          ? {
              semiMajor: matched.ellipse.semiMajor,
              semiMinor: matched.ellipse.semiMinor,
              theta: matched.ellipse.theta,
            }
          : undefined,
      };
    }
    return fallbackRelativePair(pair.from, pair.to);
  };
  const relationshipRows = relationshipPairs
    .map((pair) => {
      const rel = resolveRelativePair(pair);
      const from = rel?.from ?? pair.from;
      const to = rel?.to ?? pair.to;
      const distanceMeters = horizDistanceMeters(from, to);
      const distance = horizDistance(from, to);
      const sigmaAz95 =
        rel?.sigmaAz != null
          ? (rel.sigmaAz * RAD_TO_DEG * 3600 * confidence95Scale).toFixed(2)
          : '-';
      const sigmaDist95 =
        rel?.sigmaDist != null
          ? (rel.sigmaDist * unitScale * confidence95Scale).toFixed(4)
          : '-';
      const ppm95 =
        rel?.sigmaDist != null && distanceMeters != null
          ? (
              (rel.sigmaDist * confidence95Scale * 1_000_000) /
              Math.max(1e-12, Math.abs(distanceMeters))
            ).toFixed(4)
          : '-';
      return {
        from,
        to,
        azimuth: pairAzimuthDms(from, to),
        distance,
        sigmaAz95,
        sigmaDist95,
        ppm95,
        sigmaDist: rel?.sigmaDist,
        sigmaH: rel?.sigmaH,
        ellipse: rel?.ellipse,
      };
    })
    .filter((row) => row.distance !== '-');
  const positionalToleranceRows = positionalToleranceEnabled
    ? selectedPositionalTolerancePairs
        .map((pair) => {
          const rel = resolveRelativePair(pair);
          const distanceMeters = horizDistanceMeters(pair.from, pair.to);
          if (!rel?.ellipse || distanceMeters == null || !Number.isFinite(distanceMeters)) return null;
          const toleranceMeters =
            positionalToleranceConstantMm / 1000 + (Math.abs(distanceMeters) * positionalTolerancePpm) / 1_000_000;
          const checkMeters = rel.ellipse.semiMajor * positionalToleranceConfidenceScale;
          return {
            from: pair.from,
            to: pair.to,
            distanceMeters,
            toleranceMeters,
            checkMeters,
            passes: checkMeters <= toleranceMeters + 1e-12,
          };
        })
        .filter(
          (
            row,
          ): row is {
            from: string;
            to: string;
            distanceMeters: number;
            toleranceMeters: number;
            checkMeters: number;
            passes: boolean;
          } => row != null,
        )
    : [];
  const pairDisplayCombinedFactor = (from: string, to: string): number => {
    const fromStation = res.stations[from];
    const toStation = res.stations[to];
    if (!fromStation || !toStation) return 1;
    const fromFactors = displayFactorsForStation(from, fromStation);
    const toFactors = displayFactorsForStation(to, toStation);
    return (fromFactors.combinedFactor + toFactors.combinedFactor) / 2;
  };
  if (usesClassicParityLayout) {
    relationshipRows.sort(
      (a, b) => compareStationIds(a.from, b.from) || compareStationIds(a.to, b.to),
    );
  }
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

  const renderAdjustedSection = (
    title: string,
    rows: string[][],
    headers: string[],
    rightAligned: number[],
    preface?: string[],
  ) => {
    if (rows.length === 0) return;
    lines.push('');
    addCenteredHeading(title);
    if (preface && preface.length > 0) {
      preface.forEach((p) => lines.push(p));
    }
    lines.push('');
    renderTextTable(headers, rows, rightAligned);
  };

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

  if (!isPreanalysis && runMode === 'blunder-detect') {
    lines.push('');
    addCenteredHeading('Blunder Detect Mode');
    lines.push(
      'Warning: iterative deweighting diagnostics; not a replacement for full adjustment QA.',
    );
    const cycleLines = res.logs.filter((line) => line.startsWith('Blunder cycle ')).slice(0, 20);
    if (cycleLines.length > 0) {
      lines.push('');
      cycleLines.forEach((line) => lines.push(`  ${line}`));
    }
  }

  shouldRenderAdjustedObservationSections =
    !isPreanalysis &&
    settings.listingShowObservationsResiduals &&
    sortedListingObservations.length > 0;
  shouldRenderAdjustedGnssVectorSection =
    !isPreanalysis &&
    gpsObservationRows.length > 0 &&
    (settings.listingShowObservationsResiduals || usesCompactGnssParityLayout);

  appendAdjustedObservationSections({
    lines,
    res,
    settings,
    parseSettings,
    parseState,
    sortedListingObservations,
    gpsObservationRows,
    relationshipRows,
    isPreanalysis,
    linearUnit,
    unitScale,
    coordSystemMode,
    confidence95Scale,
    usesClassicParityLayout,
    usesCompactGnssParityLayout,
    hasTraverseStyleAngularFamilies,
    renderAdjustedGnssVectorSection,
    addCenteredHeading,
    renderAdjustedSection,
    formatLinear: (value: number | undefined) => formatLinear(value),
    formatResidualLinear,
    formatAngularLinearResidual,
    formatAngularStdErrArcSec: (value: number | undefined) =>
      value != null ? formatAngularStdErrArcSec(value) : '-',
    formatIndustryStdRes,
    sortSelectedMode: <T extends Observation>(rows: T[]): T[] =>
      sortIndustryListingObservations(
        rows as Observation[],
        settings.listingSortObservationsBy,
      ) as T[],
    pairDisplayCombinedFactor,
    aliasRefsForLine,
    autoSideshotSuffix,
    prismSuffix,
  });
  if (shouldRenderAdjustedObservationSections || shouldRenderAdjustedGnssVectorSection) {
    if (coordSystemMode === 'grid' && !usesClassicParityLayout) {
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
          const scaleUsed =
            mode === 'grid' ? 1 : mode === 'ellipsoidal' ? avgGridScale : avgCombined;
          const groundEq =
            Number.isFinite(gridDist) && scaleUsed > 0 ? gridDist / scaleUsed : Number.NaN;
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
    }
  }
  const renderSideshotListingSection = (title: string, rows: typeof sideshotsForListing) => {
    if (rows.length === 0) return;
    lines.push('');
    addCenteredHeading(title);
    lines.push('');
    const tableRows = rows.map((row) => [
      row.from,
      row.to,
      row.sourceLine != null ? `1:${row.sourceLine}` : '-',
      row.mode,
      row.azimuth != null ? radToDmsStr(row.azimuth) : '-',
      row.azimuthSource ?? '-',
      (row.horizDistance * unitScale).toFixed(4),
      row.deltaH != null ? (row.deltaH * unitScale).toFixed(4) : '-',
      row.northing != null ? (row.northing * unitScale).toFixed(4) : '-',
      row.easting != null ? (row.easting * unitScale).toFixed(4) : '-',
      row.height != null ? (row.height * unitScale).toFixed(4) : '-',
      row.sigmaN != null ? (row.sigmaN * unitScale).toFixed(4) : '-',
      row.sigmaE != null ? (row.sigmaE * unitScale).toFixed(4) : '-',
      row.sigmaH != null ? (row.sigmaH * unitScale).toFixed(4) : '-',
      row.note ?? '-',
    ]);
    renderTextTable(
      [
        'From',
        'To',
        'File:Line',
        'Mode',
        'Az',
        'AzSrc',
        `HD (${linearUnit})`,
        `dH (${linearUnit})`,
        `Northing (${linearUnit})`,
        `Easting (${linearUnit})`,
        `Height (${linearUnit})`,
        `σN (${linearUnit})`,
        `σE (${linearUnit})`,
        `σH (${linearUnit})`,
        'Note',
      ],
      tableRows,
      [6, 7, 8, 9, 10, 11, 12, 13],
    );
  };
  const resolvedTsSideshotsForListing = tsSideshotsForListing.filter(
    (row) => row.northing != null && row.easting != null,
  );
  const unresolvedTsSideshotsForListing = tsSideshotsForListing.filter(
    (row) => row.northing == null || row.easting == null,
  );
  if (resolvedTsSideshotsForListing.length > 0) {
    lines.push('');
    addCenteredHeading('Sideshot Coordinates Computed After Adjustment');
    lines.push('');
    const sideshotCoordinateRows = resolvedTsSideshotsForListing.map((row) => {
      const description = stationDescription(row.to);
      if (coordMode === '3D') {
        return [
          row.to,
          (row.northing! * unitScale).toFixed(4),
          (row.easting! * unitScale).toFixed(4),
          row.height != null ? (row.height * unitScale).toFixed(4) : '-',
          description,
        ];
      }
      return [row.to, (row.northing! * unitScale).toFixed(4), (row.easting! * unitScale).toFixed(4), description];
    });
    renderTextTable(
      coordMode === '3D'
        ? ['Station', 'N', 'E', 'Elev', 'Description']
        : ['Station', 'N', 'E', 'Description'],
      sideshotCoordinateRows,
      coordMode === '3D' ? [1, 2, 3] : [1, 2],
    );
  }
  renderSideshotListingSection('Post-Adjusted Sideshots (TS)', unresolvedTsSideshotsForListing);
  renderSideshotListingSection('Post-Adjusted GPS Sideshot Vectors', gpsVectorSideshotsForListing);
  renderSideshotListingSection(
    'Post-Adjusted GNSS Topo Coordinates (GS)',
    gpsCoordinateSideshotsForListing,
  );
  if (gpsOffsetObservations.length > 0) {
    lines.push('');
    addCenteredHeading('GPS Rover Offset Observations');
    lines.push('');
    const gpsOffsetRows = gpsOffsetObservations.map((obs) => [
      obs.from,
      obs.to,
      obs.sourceLine != null ? `1:${obs.sourceLine}` : '-',
      obs.gpsOffsetSourceLine != null ? `1:${obs.gpsOffsetSourceLine}` : '-',
      obs.gpsOffsetAzimuthRad != null ? radToDmsStr(obs.gpsOffsetAzimuthRad) : '-',
      obs.gpsOffsetDistanceM != null ? (obs.gpsOffsetDistanceM * unitScale).toFixed(4) : '-',
      obs.gpsOffsetZenithRad != null ? radToDmsStr(obs.gpsOffsetZenithRad) : '-',
      obs.gpsOffsetDeltaE != null ? (obs.gpsOffsetDeltaE * unitScale).toFixed(4) : '-',
      obs.gpsOffsetDeltaN != null ? (obs.gpsOffsetDeltaN * unitScale).toFixed(4) : '-',
      obs.gpsOffsetDeltaH != null ? (obs.gpsOffsetDeltaH * unitScale).toFixed(4) : '-',
    ]);
    renderTextTable(
      [
        'From',
        'To',
        'G Line',
        'G4 Line',
        'Az',
        `Slope (${linearUnit})`,
        'Zenith',
        `dE (${linearUnit})`,
        `dN (${linearUnit})`,
        `dH (${linearUnit})`,
      ],
      gpsOffsetRows,
      [5, 7, 8, 9],
    );
  }
  if (gpsLoopDiagnostics?.enabled) {
    lines.push('');
    addCenteredHeading('GPS Loop Diagnostics');
    lines.push('');
    lines.push(
      `vectors=${gpsLoopDiagnostics.vectorCount}, loops=${gpsLoopDiagnostics.loopCount}, pass=${gpsLoopDiagnostics.passCount}, warn=${gpsLoopDiagnostics.warnCount}, tolerance=${(gpsLoopDiagnostics.thresholds.baseToleranceM * unitScale).toFixed(4)}${linearUnit}+${gpsLoopDiagnostics.thresholds.ppmTolerance}ppm*dist`,
    );
    lines.push('');
    const gpsLoopRows = gpsLoopDiagnostics.loops.map((loop) => [
      String(loop.rank),
      loop.key,
      loop.pass ? 'PASS' : 'WARN',
      (loop.closureMag * unitScale).toFixed(4),
      (loop.toleranceM * unitScale).toFixed(4),
      loop.linearPpm != null ? loop.linearPpm.toFixed(1) : '-',
      loop.closureRatio != null ? `1:${loop.closureRatio.toFixed(0)}` : '-',
      loop.severity.toFixed(2),
      loop.sourceLines.length > 0 ? loop.sourceLines.join(',') : '-',
      loop.stationPath.join('->'),
    ]);
    renderTextTable(
      [
        '#',
        'Loop',
        'Status',
        `Closure (${linearUnit})`,
        `Tol (${linearUnit})`,
        'Linear (ppm)',
        'Ratio',
        'Severity',
        'Lines',
        'Path',
      ],
      gpsLoopRows,
      [3, 4, 5, 7],
    );
  }
  if (levelingLoopDiagnostics?.enabled) {
    lines.push('');
    addCenteredHeading('Differential Leveling Loop Diagnostics');
    lines.push('');
    lines.push(
      `observations=${levelingLoopDiagnostics.observationCount}, loops=${levelingLoopDiagnostics.loopCount}, pass=${levelingLoopDiagnostics.passCount}, warn=${levelingLoopDiagnostics.warnCount}, totalLength=${levelingLoopDiagnostics.totalLengthKm.toFixed(3)}km, warnLength=${levelingLoopDiagnostics.warnTotalLengthKm.toFixed(3)}km, tolerance=${levelingLoopDiagnostics.thresholds.baseMm.toFixed(2)}mm+${levelingLoopDiagnostics.thresholds.perSqrtKmMm.toFixed(2)}mm*sqrt(km), worst|dH|=${levelingLoopDiagnostics.worstClosure != null ? (levelingLoopDiagnostics.worstClosure * unitScale).toFixed(4) : '-'}${linearUnit}`,
    );
    lines.push('');
    const levelingLoopRows = levelingLoopDiagnostics.loops.map((loop) => [
      String(loop.rank),
      loop.key,
      loop.pass ? 'PASS' : 'WARN',
      (loop.closure * unitScale).toFixed(4),
      (loop.absClosure * unitScale).toFixed(4),
      loop.loopLengthKm.toFixed(3),
      loop.toleranceMm.toFixed(2),
      loop.closurePerSqrtKmMm.toFixed(2),
      loop.sourceLines.length > 0 ? loop.sourceLines.join(',') : '-',
      loop.stationPath.join('->'),
    ]);
    renderTextTable(
      [
        '#',
        'Loop',
        'Status',
        `dH (${linearUnit})`,
        `|dH| (${linearUnit})`,
        'Len (km)',
        'Tol (mm)',
        'mm/sqrt(km)',
        'Lines',
        'Path',
      ],
      levelingLoopRows,
      [3, 4, 5, 6, 7],
    );
    lines.push('');
    const levelingSegmentRows = levelingLoopDiagnostics.loops.flatMap((loop) =>
      loop.segments.map((segment, index) => [
        loop.key,
        String(index + 1),
        segment.from,
        segment.to,
        (segment.observedDh * unitScale).toFixed(4),
        segment.lengthKm.toFixed(3),
        segment.sourceLine != null ? String(segment.sourceLine) : '-',
        segment.closureLeg ? 'Closure' : 'Traverse',
      ]),
    );
    renderTextTable(
      ['Loop', 'Seg', 'From', 'To', `dH (${linearUnit})`, 'Len (km)', 'Line', 'Role'],
      levelingSegmentRows,
      [1, 4, 5, 6],
    );
    if (levelingLoopDiagnostics.suspectSegments.length > 0) {
      lines.push('');
      const levelingSuspectRows = levelingLoopDiagnostics.suspectSegments.map((segment) => [
        String(segment.rank),
        `${segment.from}->${segment.to}`,
        segment.sourceLine != null ? String(segment.sourceLine) : '-',
        String(segment.warnLoopCount),
        segment.suspectScore.toFixed(2),
        (segment.maxAbsDh * unitScale).toFixed(4),
        segment.worstLoopKey ?? '-',
      ]);
      renderTextTable(
        ['#', 'Segment', 'Line', 'WarnLoops', 'Score', `Max |dH| (${linearUnit})`, 'Worst Loop'],
        levelingSuspectRows,
        [2, 3, 4, 5],
      );
    }
  }

  appendErrorPropagationSections({
    lines,
    res,
    settings,
    parseSettings,
    parseState,
    stationEntriesForListing,
    classicTraverseStationOrder,
    relationshipRows,
    selectedEllipseStationIds,
    gpsDirectFixedLinkedStations,
    positionalToleranceRows,
    usesClassicParityLayout,
    usesCompactGnssParityLayout,
    isGnssOnlyListing,
    hasStationDescriptions,
    isPreanalysis,
    useClassicPreanalysisListing,
    coordMode,
    linearUnit,
    unitScale,
    coordSystemMode,
    precisionReportingMode,
    confidence95Scale,
    positionalToleranceEnabled,
    positionalToleranceConfidencePercent,
    positionalToleranceConstantMm,
    positionalTolerancePpm,
    addCenteredHeading,
    renderTextTable,
    stationDescription,
    formatEllipseAzDm,
    displayFactorsForStation: (stationId, station) => displayFactorsForStation(stationId, station),
  });
  if (res.autoAdjustDiagnostics?.enabled) {
    const ad = res.autoAdjustDiagnostics;
    lines.push('');
    lines.push('                             Auto-Adjust Diagnostics');
    lines.push('                             =======================');
    lines.push('');
    lines.push(
      `Threshold: |t|>=${ad.threshold.toFixed(2)}   MaxCycles: ${ad.maxCycles}   MaxRemovals/Cycle: ${ad.maxRemovalsPerCycle}   MinRedund: ${ad.minRedundancy.toFixed(2)}   Stop: ${ad.stopReason}   Removed: ${ad.removed.length}`,
    );
    lines.push('Cycle      SEUW      Max|t|   Removals');
    ad.cycles.forEach((cycle) => {
      lines.push(
        `${String(cycle.cycle).padStart(5)} ${cycle.seuw.toFixed(4).padStart(10)} ${cycle.maxAbsStdRes.toFixed(2).padStart(9)} ${String(cycle.removals.length).padStart(10)}`,
      );
    });
    if (ad.removed.length > 0) {
      lines.push('');
      lines.push('Removed Observations');
      lines.push('ObsID    Type        Stations                 Line    |t|     Redund   Reason');
      ad.removed.forEach((row) => {
        lines.push(
          `${String(row.obsId).padStart(5)}    ${row.type.toUpperCase().padEnd(10)}  ${row.stations.padEnd(22)}  ${String(row.sourceLine ?? '-').padStart(4)}  ${row.stdRes.toFixed(2).padStart(6)}  ${(row.redundancy != null ? row.redundancy.toFixed(3) : '-').padStart(7)}  ${row.reason}`,
        );
      });
    }
  }
  if (res.autoSideshotDiagnostics?.enabled && res.autoSideshotDiagnostics.candidateCount > 0) {
    const sd = res.autoSideshotDiagnostics;
    lines.push('');
    lines.push('                         Auto Sideshot Candidates (M Records)');
    lines.push('                         =====================================');
    lines.push('');
    lines.push(
      `Evaluated: ${sd.evaluatedCount}   Candidates: ${sd.candidateCount}   Excluded Control Targets: ${sd.excludedControlCount}   Threshold: minRedund < ${sd.threshold.toFixed(2)}`,
    );
    if (sd.candidates.length > 0) {
      lines.push(
        'Line    Occupy       Backsight    Target      AngleObs  DistObs  AngleRed  DistRed   MinRed   Max|t|',
      );
      sd.candidates.forEach((row) => {
        lines.push(
          `${String(row.sourceLine ?? '-').padStart(4)}    ${row.occupy.padEnd(10)} ${row.backsight.padEnd(12)} ${row.target.padEnd(10)} ${String(row.angleObsId).padStart(8)} ${String(row.distObsId).padStart(8)} ${row.angleRedundancy.toFixed(3).padStart(8)} ${row.distRedundancy.toFixed(3).padStart(8)} ${row.minRedundancy.toFixed(6)} ${row.maxAbsStdRes.toFixed(2).padStart(8)}`,
        );
      });
    } else {
      lines.push('(none)');
    }
  }
  if (res.clusterDiagnostics?.enabled) {
    const outcomes = res.clusterDiagnostics.mergeOutcomes ?? [];
    const rejected = res.clusterDiagnostics.rejectedProposals ?? [];
    lines.push('');
    lines.push('                          Cluster Detection Candidates');
    lines.push('                          ============================');
    lines.push('');
    lines.push(
      `Pass: ${res.clusterDiagnostics.passMode.toUpperCase()}   Mode: ${res.clusterDiagnostics.linkageMode.toUpperCase()}   Dim: ${res.clusterDiagnostics.dimension}   Tol: ${(res.clusterDiagnostics.tolerance * unitScale).toFixed(4)} ${linearUnit}   PairHits: ${res.clusterDiagnostics.pairCount}   Candidates: ${res.clusterDiagnostics.candidateCount}   ApprovedMerges: ${res.clusterDiagnostics.approvedMergeCount ?? 0}   MergeOutcomes: ${outcomes.length}   Rejected: ${rejected.length}`,
    );
    if (res.clusterDiagnostics.candidates.length > 0) {
      lines.push(
        'Key               Rep          Members   MaxSep        MeanSep       Flags           Station IDs',
      );
      res.clusterDiagnostics.candidates.forEach((c) => {
        const flags = `${c.hasFixed ? 'fixed' : 'free'}${c.hasUnknown ? '+unknown' : ''}`;
        lines.push(
          `${c.key.padEnd(17)} ${c.representativeId.padEnd(12)} ${String(c.memberCount).padStart(7)} ${(
            c.maxSeparation * unitScale
          )
            .toFixed(4)
            .padStart(12)} ${(c.meanSeparation * unitScale)
            .toFixed(4)
            .padStart(12)} ${flags.padEnd(15)} ${c.stationIds.join(', ')}`,
        );
      });
    }
    if (outcomes.length > 0) {
      lines.push('');
      lines.push('                     Cluster Merge Outcomes (Delta From Retained Point)');
      lines.push('                     ====================================================');
      lines.push('');
      lines.push(
        'Alias             Canonical         dE           dN           dH           d2D          d3D          Status',
      );
      outcomes.forEach((row) => {
        lines.push(
          `${row.aliasId.padEnd(17)} ${row.canonicalId.padEnd(17)} ${(row.deltaE != null ? (row.deltaE * unitScale).toFixed(4) : '-').padStart(12)} ${(row.deltaN != null ? (row.deltaN * unitScale).toFixed(4) : '-').padStart(12)} ${(row.deltaH != null ? (row.deltaH * unitScale).toFixed(4) : '-').padStart(12)} ${(row.horizontalDelta != null ? (row.horizontalDelta * unitScale).toFixed(4) : '-').padStart(12)} ${(row.spatialDelta != null ? (row.spatialDelta * unitScale).toFixed(4) : '-').padStart(12)} ${row.missing ? 'MISSING PASS1 DATA' : 'OK'}`,
        );
      });
    }
    if (rejected.length > 0) {
      lines.push('');
      lines.push('                               Rejected Cluster Proposals');
      lines.push('                               ==========================');
      lines.push('');
      lines.push(
        'Key               Rep          Members   Retained       Station IDs                      Reason',
      );
      rejected.forEach((row) => {
        lines.push(
          `${row.key.padEnd(17)} ${row.representativeId.padEnd(12)} ${String(row.memberCount).padStart(7)} ${(row.retainedId ?? '-').padEnd(14)} ${row.stationIds.join(', ').padEnd(30)} ${row.reason}`,
        );
      });
    }
  }
  if (descriptionScanSummary.length > 0) {
    lines.push('');
    lines.push('                     Description Reconciliation Summary');
    lines.push('                     ==================================');
    lines.push('');
    lines.push(
      `Mode: ${descriptionReconcileMode.toUpperCase()}${descriptionReconcileMode === 'append' ? ` (delimiter="${descriptionAppendDelimiter}")` : ''}   Stations: ${descriptionScanSummary.length}   Repeated: ${traceabilityModel.descriptionRepeatedStationCount}   Conflicts: ${traceabilityModel.descriptionConflictCount}`,
    );
    lines.push('Station      Records  Unique  Conflict  Description@Lines');
    descriptionScanSummary
      .slice()
      .sort((a, b) => a.stationId.localeCompare(b.stationId, undefined, { numeric: true }))
      .forEach((row) => {
        const details = (descriptionRefsByStation.get(row.stationId) ?? [])
          .map((detail) => {
            const linesRef = detail.lines
              .slice()
              .sort((a, b) => a - b)
              .join(',');
            return `${detail.description}[${linesRef}]`;
          })
          .join('; ');
        lines.push(
          `${row.stationId.padEnd(11)}${String(row.recordCount).padStart(8)}${String(row.uniqueCount).padStart(8)}  ${(row.conflict ? 'YES' : 'no ').padEnd(8)}  ${details || '-'}`,
        );
      });
  }
  if (aliasTrace.length > 0) {
    lines.push('');
    lines.push('                          Alias Canonicalization Trace');
    lines.push('                          ============================');
    lines.push('');
    lines.push(
      'Context    Detail              Line  Source Alias         Canonical ID         Reference',
    );
    aliasTrace.forEach((entry) => {
      lines.push(
        `${entry.context.padEnd(10)}${(entry.detail ?? '-').padEnd(20)}${String(entry.sourceLine ?? '-').padStart(6)}  ${entry.sourceId.padEnd(20)}${entry.canonicalId.padEnd(20)}${entry.reference ?? '-'}`,
      );
    });
  }
  return lines.join('\n');
};

