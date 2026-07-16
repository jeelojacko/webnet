import { RAD_TO_DEG } from './angles';
import {
  DEFAULT_QFIX_ANGULAR_SIGMA_SEC,
  DEFAULT_QFIX_LINEAR_SIGMA_M,
} from './defaults';
import {
  buildResultStatisticalSummaryModel,
  buildResultTraceabilityModel,
} from './resultDerivedModels';
import {
  INDUSTRY_CONFIDENCE_95_SCALE,
} from './resultPrecision';
import {
  buildIndustryListingStationContext,
  observationStationIds,
} from './industryListingStationContext';
import {
  buildIndustryListingGpsDisplayHelpers,
} from './industryListingGpsDisplay';
import {
  appendAdjustmentStatisticalSummary,
  appendDataCheckAndBlunderDiagnostics,
  appendGridDistanceDiagnostics,
  createAdjustedGnssVectorSectionRenderer,
} from './industryListingAdjustedOutputSections';
import { appendAdjustedCoordinateSections } from './industryListingCoordinateSections';
import { appendIndustryListingDiagnosticsSections } from './industryListingDiagnosticsSections';
import { buildIndustryListingRelationshipPrecisionModel } from './industryListingRelationshipPrecision';
import { appendPostAdjustmentListingSections } from './industryListingPostAdjustmentSections';
import { appendIndustryListingInputSummary } from './industryListingInputSummary';
import { buildLevelingOnlyIndustryListingText } from './industryListingLeveling';
import {
  appendAdjustedObservationSections,
  appendErrorPropagationSections,
  appendIndustryListingTopSections,
} from './industryListingSections';
import {
  centerIndustryLine,
  filterListingCoordSystemDiagnostics,
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
  const compareObsByInput = (a: Observation, b: Observation) => {
    const aLine = a.sourceLine ?? Number.MAX_SAFE_INTEGER;
    const bLine = b.sourceLine ?? Number.MAX_SAFE_INTEGER;
    if (aLine !== bLine) return aLine - bLine;
    return (a.id ?? 0) - (b.id ?? 0);
  };
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
  const inputSummaryCountByType = (type: Observation['type']) =>
    observationsForListing.filter((obs) => obs.type === type).length;
  const inputSummaryMeasuredDirectionCount =
    inputSummaryCountByType('direction') + inputSummaryCountByType('dir');
  const inputSummaryBearingCount = inputSummaryCountByType('bearing');
  const {
    hasStationDescriptions,
    hasTraverseStyleAngularFamilies,
  } = appendIndustryListingInputSummary({
    angleUnitToken: (parseState?.angleUnits ?? parseSettings.angleUnits).toUpperCase(),
    classicTraverseLegacyFactorByStation,
    compareObsByInput,
    coordSystemMode,
    enteredInputStationSnapshots,
    fixedStations,
    fixedUsedEnteredStationSnapshots,
    freeStations,
    freeUsedEnteredStationSnapshots,
    gpsInputCovarianceDisplay,
    gpsObservationRows,
    hasStationDescriptions: stationEntriesForListing.some(
      ([id]) => stationDescription(id).trim().length > 0,
    ),
    hasTraverseStyleAngularFamilies:
      inputSummaryMeasuredDirectionCount > 0 || inputSummaryBearingCount > 0,
    linearUnit,
    lines,
    observationsForListing,
    parseSettings,
    parseState,
    partiallyFixedUsedEnteredStationSnapshots,
    pushSettingRow,
    res,
    stationDescription,
    stationEntriesInputOrder,
    unitScale,
    unusedEnteredStationSnapshots,
    usesClassicParityLayout,
    usesCompactGnssParityLayout,
  });
  appendAdjustmentStatisticalSummary({
    centerIndustryLine,
    getListingGpsStatisticalRow: gpsListingStatisticalRow,
    lines,
    observationCount,
    pushSettingRow,
    pushTable,
    res,
    stationCount: stationEntriesInputOrder.length,
    statisticalSummary,
    unknownCount,
    useClassicPreanalysisListing,
    usesClassicParityLayout,
  });
  const addCenteredHeading = (title: string, underline = '=') => {
    lines.push(title);
    lines.push(underline.repeat(title.length));
  };
  const renderTextTable = (headers: string[], rows: string[][], rightAligned: number[] = []) => {
    pushTable(headers, rows, rightAligned);
  };
  appendAdjustedCoordinateSections({
    addCenteredHeading,
    averageGeoidHeight,
    classicTraverseLegacyFactorByStation,
    classicTraverseStationOrder,
    commonElevation,
    coordSystemMode,
    displayFactorsForStation,
    hasStationDescriptions,
    isGnssOnlyListing,
    linearUnit,
    lines,
    parseSettings,
    parseState,
    renderTextTable,
    res,
    settings,
    stationDescription,
    stationEntriesForListing,
    unitScale,
    useClassicPreanalysisListing,
    usesClassicParityLayout,
    usesLegacyNbDisplayFactors,
  });
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
  const {
    formatEllipseAzDm,
    gpsDirectFixedLinkedStations,
    pairDisplayCombinedFactor,
    positionalToleranceConfidencePercent,
    positionalToleranceConstantMm,
    positionalToleranceEnabled,
    positionalTolerancePpm,
    positionalToleranceRows,
    relationshipRows,
    selectedEllipseStationIds,
  } = buildIndustryListingRelationshipPrecisionModel({
    compareObsByInput,
    compareStationIds,
    confidence95Scale,
    displayFactorsForStation,
    gpsHorizontalCovarianceForRelationship,
    gpsObservationRows,
    observationsForListing,
    parseSettings,
    precisionReportingMode,
    res,
    unitScale,
    usesClassicParityLayout,
    usesCompactGnssParityLayout,
  });
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

  appendDataCheckAndBlunderDiagnostics({
    addCenteredHeading,
    aliasRefsForLine,
    autoSideshotSuffix,
    isPreanalysis,
    linearUnit,
    lines,
    observationsForListing,
    renderTextTable,
    res,
    runMode,
    unitScale,
  });

  const shouldRenderAdjustedObservationSections =
    !isPreanalysis &&
    settings.listingShowObservationsResiduals &&
    sortedListingObservations.length > 0;
  const shouldRenderAdjustedGnssVectorSection =
    !isPreanalysis &&
    gpsObservationRows.length > 0 &&
    (settings.listingShowObservationsResiduals || usesCompactGnssParityLayout);
  const renderAdjustedGnssVectorSection = createAdjustedGnssVectorSectionRenderer({
    addCenteredHeading,
    compareObsByInput,
    formatLinear,
    formatResidualLinear,
    getGpsCovarianceDisplay: gpsCovarianceDisplay,
    getGpsDisplayVector: gpsDisplayVector,
    gpsObservationRows,
    linearUnit,
    lines,
    listingObservations,
    shouldRenderAdjustedGnssVectorSection,
    unitScale,
  });

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
  appendGridDistanceDiagnostics({
    aliasRefsForLine,
    coordSystemMode,
    gridDistanceMode,
    linearUnit,
    renderAdjustedSection,
    res,
    shouldRenderAdjustedGnssVectorSection,
    shouldRenderAdjustedObservationSections,
    sortedListingObservations,
    unitScale,
    usesClassicParityLayout,
  });
  appendPostAdjustmentListingSections({
    addCenteredHeading,
    coordMode,
    gpsCoordinateSideshotsForListing,
    gpsLoopDiagnostics,
    gpsOffsetObservations,
    gpsVectorSideshotsForListing,
    levelingLoopDiagnostics,
    linearUnit,
    lines,
    renderTextTable,
    stationDescription,
    tsSideshotsForListing,
    unitScale,
  });

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
  appendIndustryListingDiagnosticsSections({
    autoAdjustDiagnostics: res.autoAdjustDiagnostics,
    autoSideshotDiagnostics: res.autoSideshotDiagnostics,
    clusterDiagnostics: res.clusterDiagnostics,
    descriptionAppendDelimiter,
    descriptionReconcileMode,
    linearUnit,
    lines,
    traceabilityModel,
    unitScale,
  });
  return lines.join('\n');
};

