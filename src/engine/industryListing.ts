import { RAD_TO_DEG, radToDmsStr } from './angles';
import {
  DEFAULT_QFIX_ANGULAR_SIGMA_SEC,
  DEFAULT_QFIX_LINEAR_SIGMA_M,
} from './defaults';
import { getLevelLoopTolerancePresetLabel } from './levelLoopTolerance';
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
import type {
  AdjustmentResult,
  CoordSystemDiagnosticCode,
  CrsOffReason,
  CrsStatus,
  DatumSufficiencyReport,
  DirectiveNoEffectWarning,
  DirectiveTransition,
  GnssVectorFrame,
  GpsObservation,
  LevelObservation,
  Observation,
  ReductionUsageSummary,
  RunMode,
  SigmaSource,
  Station,
  PrecisionReportingMode,
} from '../types';

const FT_PER_M = 3.280839895;

export type IndustryListingSortCoordinatesBy = 'input' | 'name';
export type IndustryListingSortObservationsBy = 'input' | 'name' | 'residual';

export interface IndustryListingSettings {
  maxIterations: number;
  convergenceLimit?: number;
  precisionReportingMode?: PrecisionReportingMode;
  units: 'm' | 'ft';
  listingShowCoordinates: boolean;
  listingShowObservationsResiduals: boolean;
  listingShowErrorPropagation: boolean;
  listingShowProcessingNotes: boolean;
  listingShowAzimuthsBearings: boolean;
  listingShowLostStations?: boolean;
  listingSortCoordinatesBy: IndustryListingSortCoordinatesBy;
  listingSortObservationsBy: IndustryListingSortObservationsBy;
  listingObservationLimit: number;
}

export interface IndustryListingParseSettings {
  coordMode: '2D' | '3D';
  order: 'NE' | 'EN';
  angleUnits: 'dms' | 'dd';
  angleStationOrder: 'atfromto' | 'fromatto';
  deltaMode: 'slope' | 'horiz';
  refractionCoefficient: number;
  descriptionReconcileMode?: 'first' | 'append';
  descriptionAppendDelimiter?: string;
}

export interface IndustryListingRunDiagnostics {
  solveProfile:
    | 'webnet'
    | 'industry-parity-current'
    | 'industry-parity-legacy'
    | 'legacy-compat'
    | 'industry-parity';
  runMode?: RunMode;
  angleCenteringModel: 'geometry-aware-correlated-rays';
  defaultSigmaCount: number;
  defaultSigmaByType: string;
  stochasticDefaultsSummary: string;
  rotationAngleRad: number;
  coordSystemMode?: 'local' | 'grid';
  crsId?: string;
  localDatumScheme?: 'average-scale' | 'common-elevation';
  averageScaleFactor?: number;
  scaleOverrideActive?: boolean;
  commonElevation?: number;
  averageGeoidHeight?: number;
  gnssVectorFrameDefault?: GnssVectorFrame;
  gnssFrameConfirmed?: boolean;
  datumSufficiencyReport?: DatumSufficiencyReport;
  parsedUsageSummary?: ReductionUsageSummary;
  usedInSolveUsageSummary?: ReductionUsageSummary;
  directiveTransitions?: DirectiveTransition[];
  directiveNoEffectWarnings?: DirectiveNoEffectWarning[];
  gridBearingMode?: 'measured' | 'grid';
  gridDistanceMode?: 'measured' | 'grid' | 'ellipsoidal';
  gridAngleMode?: 'measured' | 'grid';
  gridDirectionMode?: 'measured' | 'grid';
  coordSystemDiagnostics?: CoordSystemDiagnosticCode[];
  coordSystemWarningMessages?: string[];
  crsStatus?: CrsStatus;
  crsOffReason?: CrsOffReason;
  crsDatumOpId?: string;
  crsDatumFallbackUsed?: boolean;
  crsAreaOfUseStatus?: 'inside' | 'outside' | 'unknown';
  crsOutOfAreaStationCount?: number;
  levelLoopToleranceBaseMm?: number;
  levelLoopTolerancePerSqrtKmMm?: number;
  qFixLinearSigmaM?: number;
  qFixAngularSigmaSec?: number;
  crsTransformEnabled?: boolean;
  crsProjectionModel?: 'legacy-equirectangular' | 'local-enu';
  crsLabel?: string;
  crsGridScaleEnabled?: boolean;
  crsGridScaleFactor?: number;
  crsConvergenceEnabled?: boolean;
  crsConvergenceAngleRad?: number;
  geoidModelEnabled?: boolean;
  geoidModelId?: string;
  geoidInterpolation?: 'bilinear' | 'nearest';
  geoidHeightConversionEnabled?: boolean;
  geoidOutputHeightDatum?: 'orthometric' | 'ellipsoid';
  geoidModelLoaded?: boolean;
  geoidModelMetadata?: string;
  geoidSampleUndulationM?: number;
  geoidConvertedStationCount?: number;
  geoidSkippedStationCount?: number;
  gpsAddHiHtEnabled?: boolean;
  gpsAddHiHtHiM?: number;
  gpsAddHiHtHtM?: number;
  gpsAddHiHtVectorCount?: number;
  gpsAddHiHtAppliedCount?: number;
  gpsAddHiHtPositiveCount?: number;
  gpsAddHiHtNegativeCount?: number;
  gpsAddHiHtNeutralCount?: number;
  gpsAddHiHtDefaultZeroCount?: number;
  gpsAddHiHtMissingHeightCount?: number;
  gpsAddHiHtScaleMin?: number;
  gpsAddHiHtScaleMax?: number;
  currentInstrumentCode?: string;
  currentInstrumentDesc?: string;
  currentInstrumentLevStdMmPerKm?: number;
}

const LEVELING_ONLY_VERTICAL_95_SCALE = 1.959963984540054;

const centerIndustryLine = (text: string, width = 80): string => {
  const leftPad = Math.max(0, Math.floor((width - text.length) / 2));
  return `${' '.repeat(leftPad)}${text}`;
};

const formatLevelingOnlyFileLine = (
  parseState: AdjustmentResult['parseState'],
  sourceLine?: number,
): string => {
  if (sourceLine == null) return '';
  const displayLine = parseState?.displayLineBySourceLine?.[sourceLine] ?? sourceLine;
  return `1:${displayLine}`;
};

const isLevelingOnlyObservationSet = (observations: Observation[]): boolean =>
  observations.length > 0 && observations.every((obs) => obs.type === 'lev');

const usesIndustryParityLevelingLayout = (
  solveProfile: IndustryListingRunDiagnostics['solveProfile'],
): boolean => solveProfile !== 'webnet';

const buildLevelingOnlyIndustryListingText = (
  res: AdjustmentResult,
  settings: IndustryListingSettings,
  parseSettings: IndustryListingParseSettings,
  runDiagnostics: IndustryListingRunDiagnostics,
): string => {
  const lines: string[] = [];
  const parseState = res.parseState;
  const linearUnit = settings.units === 'ft' ? 'FeetUS' : 'Meters';
  const coordOrder =
    (parseState?.order ?? parseSettings.order) === 'NE' ? 'North-East' : 'East-North';
  const traceabilityModel = buildResultTraceabilityModel(parseState);
  const levObservations = res.observations.filter(
    (obs): obs is LevelObservation => obs.type === 'lev',
  );
  const statisticalSummary = buildResultStatisticalSummaryModel(res, 'listing');
  const levelStats = statisticalSummary.rows.find((row) => row.label === 'Level Data');
  const stationEntries = Object.entries(res.stations);
  const enteredHeightControls = stationEntries.filter(([, station]) =>
    station.fixedH ||
    station.constraintModeH === 'fixed' ||
    station.constraintModeH === 'weighted',
  );
  const stationOrder: string[] = [];
  const pushStation = (stationId: string) => {
    if (!stationId || stationOrder.includes(stationId) || !res.stations[stationId]) return;
    stationOrder.push(stationId);
  };
  enteredHeightControls.forEach(([stationId]) => pushStation(stationId));
  levObservations.forEach((obs) => {
    pushStation(obs.from);
    pushStation(obs.to);
  });
  const defaultLevelStdMmPerKm =
    runDiagnostics.currentInstrumentLevStdMmPerKm && runDiagnostics.currentInstrumentLevStdMmPerKm > 0
      ? runDiagnostics.currentInstrumentLevStdMmPerKm
      : (() => {
          const defaultObs = levObservations.find(
            (obs) => obs.sigmaSource === 'default' && (obs.weightingStdDev ?? obs.stdDev) > 0 && obs.lenKm > 0,
          );
          if (!defaultObs) return 0;
          return (((defaultObs.weightingStdDev ?? defaultObs.stdDev) * 1000) / Math.sqrt(defaultObs.lenKm));
        })();
  const levelStdMetersPerKm = defaultLevelStdMmPerKm / 1000;
  const formatSettingRow = (label: string, value: string) =>
    lines.push(`      ${label.padEnd(35)} : ${value}`);
  const formatCountRow = (label: string, value: number) =>
    lines.push(`                        ${label.padEnd(23)} = ${String(value).padStart(6)}`);

  lines.push('INDUSTRY-STANDARD-STYLE Listing (WebNet Emulation)');
  lines.push(`Run Date: ${new Date().toLocaleString()}`);
  lines.push('');
  lines.push(centerIndustryLine('Summary of Files Used and Option Settings'));
  lines.push(centerIndustryLine('========================================='));
  lines.push('');
  lines.push(centerIndustryLine('Project Option Settings'));
  lines.push('');
  formatSettingRow('STAR*NET Run Mode', 'Adjust with Error Propagation');
  formatSettingRow('Type of Adjustment', 'Lev');
  formatSettingRow('Project Units', linearUnit === 'Meters' ? 'Meters' : linearUnit);
  formatSettingRow('Input/Output Coordinate Order', coordOrder);
  formatSettingRow('Create Coordinate File', 'Yes');
  lines.push('');
  lines.push(centerIndustryLine('Instrument Standard Error Settings'));
  lines.push('');
  lines.push('      Project Default Instrument');
  lines.push(
    `        Differential Levels               :    ${levelStdMetersPerKm.toFixed(6)} Meters / Km`,
  );
  lines.push('');
  lines.push(centerIndustryLine('Summary of Inconsistent Descriptions'));
  lines.push(centerIndustryLine('===================================='));
  lines.push('');
  lines.push('');
  lines.push(
    centerIndustryLine(`Number of Occurrences = ${traceabilityModel.descriptionConflictCount}`),
  );
  lines.push('');
  lines.push('Network Stations');
  lines.push('Point ID         Description                     File:Line                     ');
  lines.push('');
  lines.push('Sideshots');
  lines.push('Point ID         Description                     File:Line                     ');
  lines.push('');
  lines.push(centerIndustryLine('Summary of Unadjusted Input Observations'));
  lines.push(centerIndustryLine('========================================'));
  lines.push('');
  lines.push(
    centerIndustryLine(
      `Number of Entered Stations (${linearUnit === 'Meters' ? 'Meters' : linearUnit}) = ${enteredHeightControls.length}`,
    ),
  );
  lines.push('');
  lines.push('Fixed Stations         Elev   Description');
  enteredHeightControls.forEach(([stationId, station]) => {
    lines.push(`${stationId.padEnd(20)}${station.h.toFixed(4).padStart(8)}`);
  });
  lines.push('');
  lines.push(
    centerIndustryLine(
      `Number of Differential Level Observations (${linearUnit === 'Meters' ? 'Meters' : linearUnit}) = ${levObservations.length}`,
    ),
  );
  lines.push('');
  lines.push('From            To                  Elev Diff    StdErr  Length');
  levObservations.forEach((obs) => {
    const stdErr = (obs.weightingStdDev ?? obs.stdDev).toFixed(4);
    const length =
      obs.sigmaSource === 'explicit' || !(obs.lenKm > 0) ? 'n/a' : String(Math.round(obs.lenKm * 1000));
    const prefix = `${obs.from.padEnd(16)}${obs.to.padEnd(21)}${obs.obs.toFixed(4).padStart(8)}${stdErr.padStart(10)}${length.padStart(8)}`;
    lines.push(
      prefix,
    );
  });
  lines.push('');
  lines.push(centerIndustryLine('Adjustment Statistical Summary'));
  lines.push(centerIndustryLine('=============================='));
  lines.push('');
  formatCountRow('Number of Stations', stationOrder.length);
  lines.push('');
  formatCountRow('Number of Observations', levObservations.length);
  formatCountRow('Number of Unknowns', Math.max(0, levObservations.length - res.dof));
  formatCountRow('Number of Redundant Obs', res.dof);
  lines.push('');
  lines.push('            Observation   Count   Sum Squares         Error');
  lines.push('                                    of StdRes        Factor');
  lines.push(
    `             ${'Level Data'.padEnd(10)}${String(levelStats?.count ?? levObservations.length).padStart(8)}${(levelStats?.sumSquares ?? statisticalSummary.totalSumSquares).toFixed(3).padStart(14)}${(levelStats?.errorFactor ?? res.seuw).toFixed(3).padStart(14)}`,
  );
  lines.push('');
  lines.push(
    `                  Total${String(statisticalSummary.totalCount).padStart(8)}${statisticalSummary.totalSumSquares.toFixed(3).padStart(14)}${res.seuw.toFixed(3).padStart(14)}`,
  );
  lines.push('');
  if (res.chiSquare) {
    lines.push(
      `                  The Chi-Square Test at 5.00% Level ${res.chiSquare.pass95 ? 'Passed' : 'Failed'}`,
    );
    lines.push(
      `                       Lower/Upper Bounds (${Math.sqrt(res.chiSquare.varianceFactorLower).toFixed(3)}/${Math.sqrt(res.chiSquare.varianceFactorUpper).toFixed(3)})`,
    );
  }
  lines.push('');
  lines.push(centerIndustryLine('Adjusted Elevations and Error Propagation (Meters)'));
  lines.push(centerIndustryLine('=================================================='));
  lines.push('');
  lines.push('Station                  Elev        StdDev         95%     Description');
  stationOrder.forEach((stationId) => {
    const station = res.stations[stationId];
    const precision = getStationPrecision(
      res,
      stationId,
      settings.precisionReportingMode ?? 'industry-standard',
    );
    const sigmaH = precision.sigmaH ?? station.sH ?? 0;
    const ci95 = sigmaH * LEVELING_ONLY_VERTICAL_95_SCALE;
    lines.push(
      `${stationId.padEnd(22)}${station.h.toFixed(4).padStart(8)}${sigmaH.toFixed(6).padStart(14)}${ci95.toFixed(6).padStart(14)}`,
    );
  });
  lines.push('');
  lines.push(centerIndustryLine('Adjusted Observations and Residuals'));
  lines.push(centerIndustryLine('==================================='));
  lines.push('');
  lines.push(centerIndustryLine('Adjusted Differential Level Observations (Meters)'));
  lines.push('');
  lines.push('From            To                   Elev Diff      Residual   StdErr StdRes File:Line');
  levObservations.forEach((obs) => {
    const adjusted = (typeof obs.calc === 'number' ? obs.calc : obs.obs).toFixed(4);
    const residualValue = typeof obs.residual === 'number' ? -obs.residual : 0;
    const residual = residualValue.toFixed(4);
    const stdErr = (obs.weightingStdDev ?? obs.stdDev).toFixed(4);
    const stdResValue = Math.abs(residualValue) / Math.max(obs.weightingStdDev ?? obs.stdDev, 1e-24);
    const stdRes = stdResValue.toFixed(1);
    const prefix =
      `${obs.from.padEnd(16)}${obs.to.padEnd(22)}${adjusted.padStart(8)}${residual.padStart(14)}` +
      `${stdErr.padStart(9)}${stdRes.padStart(6)}`;
    lines.push(
      `${prefix.padEnd(80)}${formatLevelingOnlyFileLine(parseState, obs.sourceLine).padEnd(6)}`,
    );
  });
  lines.push('');
  lines.push('');
  lines.push('                           Elapsed Time = 00:00:00');
  lines.push('');
  lines.push('');
  return lines.join('\n');
};

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
  const stationEntriesInputOrder = Object.entries(res.stations).filter(
    ([, st]) => showLostStations || !st.lost,
  );
  const stationEntriesForListing =
    settings.listingSortCoordinatesBy === 'name'
      ? [...stationEntriesInputOrder].sort((a, b) =>
          a[0].localeCompare(b[0], undefined, { numeric: true }),
        )
      : stationEntriesInputOrder;
  const fixedStations = stationEntriesInputOrder.filter(([, st]) => st.fixed).length;
  const freeStations = stationEntriesInputOrder.length - fixedStations;
  const observationCount = res.observations.length;
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
  const coordSystemDiagnostics =
    parseState?.coordSystemDiagnostics ?? runDiag.coordSystemDiagnostics ?? [];
  const coordSystemWarningMessages =
    parseState?.coordSystemWarningMessages ?? runDiag.coordSystemWarningMessages ?? [];
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
  const observationStationIds = (obs: Observation): string[] => {
    if (obs.type === 'angle') return [obs.at, obs.from, obs.to];
    if (obs.type === 'direction') return [obs.at, obs.to];
    if ('from' in obs && 'to' in obs) return [obs.from, obs.to];
    return [];
  };
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

  lines.push('INDUSTRY-STANDARD-STYLE Listing (WebNet Emulation)');
  lines.push(`Run Date: ${now.toLocaleString()}`);
  lines.push('');
  lines.push('Summary of Files Used and Option Settings');
  lines.push('=========================================');
  lines.push('');
  lines.push('Project Option Settings');
  lines.push('');
  pushSettingRow(
    'Industry Standard Run Mode',
    runDiag.solveProfile === 'webnet' ? 'WebNet Default Profile' : 'Parity Profile (Classical)',
  );
  pushSettingRow('Run Mode', runMode.toUpperCase());
  pushSettingRow('Run Purpose', runPurpose);
  pushSettingRow('Type of Adjustment', parseState?.coordMode ?? parseSettings.coordMode);
  pushSettingRow(
    'Project Units',
    `${linearUnit}; ${(parseState?.angleUnits ?? parseSettings.angleUnits).toUpperCase()}`,
  );
  pushSettingRow(
    'Input/Output Coordinate Order',
    (parseState?.order ?? parseSettings.order) === 'NE' ? 'North-East' : 'East-North',
  );
  pushSettingRow(
    'Angle Data Station Order',
    (parseState?.angleStationOrder ?? parseSettings.angleStationOrder) === 'atfromto'
      ? 'At-From-To'
      : 'From-At-To',
  );
  pushSettingRow(
    'Distance/Vertical Data Type',
    (parseState?.deltaMode ?? parseSettings.deltaMode) === 'horiz'
      ? 'Hor Dist/DE'
      : 'Slope Dist/Zenith',
  );
  pushSettingRow('Map Mode / Scale', `${mapMode.toUpperCase()} / ${mapScaleFactor.toFixed(8)}`);
  pushSettingRow(
    'Normalize',
    `${faceNormalizationMode.toUpperCase()} (${normalize ? 'ON' : 'OFF'})`,
  );
  const convergenceLimit =
    typeof settings.convergenceLimit === 'number' &&
    Number.isFinite(settings.convergenceLimit) &&
    settings.convergenceLimit > 0
      ? settings.convergenceLimit
      : 0.01;
  pushSettingRow(
    'Convergence Limit; Max Iterations',
    `${convergenceLimit.toFixed(6)}; ${settings.maxIterations}`,
  );
  pushSettingRow(
    'Default Coefficient of Refraction',
    (parseState?.refractionCoefficient ?? parseSettings.refractionCoefficient).toFixed(6),
  );
  pushSettingRow(
    'Prism Correction',
    prismEnabled ? `ON (${prismOffset.toFixed(4)} m, scope=${prismScope})` : 'OFF',
  );
  pushSettingRow(
    'Plan Rotation',
    Math.abs(rotationAngleRad) > 1e-12
      ? `ON (${(rotationAngleRad * RAD_TO_DEG).toFixed(6)} deg)`
      : 'OFF',
  );
  pushSettingRow('Coordinate System Mode', `${coordSystemMode.toUpperCase()} (CRS=${crsId})`);
  if (coordSystemMode === 'local') {
    pushSettingRow(
      'Local Datum Scheme',
      `${localDatumScheme.toUpperCase()} (scale=${averageScaleFactor.toFixed(8)}, commonElev=${(commonElevation * unitScale).toFixed(4)} ${linearUnit})`,
    );
  } else {
    pushSettingRow(
      'Directive Context (End of File)',
      `bearing=${gridBearingMode.toUpperCase()}, distance=${gridDistanceMode.toUpperCase()}, angle=${gridAngleMode.toUpperCase()}, direction=${gridDirectionMode.toUpperCase()}`,
    );
    pushSettingRow(
      '.SCALE Override Active',
      scaleOverrideActive ? `YES (k=${averageScaleFactor.toFixed(8)})` : 'NO',
    );
    pushSettingRow(
      'GNSS Frame Default',
      `${gnssVectorFrameDefault} (confirmed=${gnssFrameConfirmed ? 'YES' : 'NO'})`,
    );
    pushSettingRow('Applied Reduction Modes (Parsed)', formatReductionUsage(parsedUsageSummary));
    pushSettingRow('Applied Reduction Modes (Used)', formatReductionUsage(usedInSolveUsageSummary));
    if (directiveTransitions.length > 0) {
      pushSettingRow('Directive Transition Count', String(directiveTransitions.length));
      directiveTransitions.slice(0, 20).forEach((transition) => {
        pushSettingRow(
          'Directive Range',
          `${transition.directive} line ${transition.effectiveFromLine}${transition.effectiveToLine != null ? `-${transition.effectiveToLine}` : '-EOF'} (obs=${transition.obsCountInRange})`,
        );
      });
      if (directiveTransitions.length > 20) {
        pushSettingRow('Directive Range Overflow', `+${directiveTransitions.length - 20} more`);
      }
    }
    directiveNoEffectWarnings.forEach((warning) => {
      pushSettingRow(
        'Directive No-Effect',
        `${warning.directive} line ${warning.line} (${warning.reason})`,
      );
    });
  }
  if (datumSufficiency) {
    pushSettingRow(
      'Datum Sufficiency',
      `${datumSufficiency.status.toUpperCase()}${datumSufficiency.reasons.length > 0 ? ` (${datumSufficiency.reasons.length} reason${datumSufficiency.reasons.length === 1 ? '' : 's'})` : ''}`,
    );
    datumSufficiency.reasons.forEach((reason) => {
      pushSettingRow('Datum Reason', reason);
    });
    datumSufficiency.suggestions.forEach((suggestion) => {
      pushSettingRow('Datum Suggestion', suggestion);
    });
  }
  pushSettingRow('Average Geoid Height', `${(averageGeoidHeight * unitScale).toFixed(4)} ${linearUnit}`);
  pushSettingRow(
    'CRS / Projection',
    crsStatus === 'on'
      ? `ON (${crsProjectionModel}, label="${crsLabel || 'unnamed'}")`
      : `OFF${crsOffReason ? ` (${crsOffReason})` : ''}`,
  );
  pushSettingRow(
    'CRS Grid-Ground Scale',
    crsGridScaleEnabled ? `ON (${crsGridScaleFactor.toFixed(8)})` : 'OFF',
  );
  pushSettingRow(
    'CRS Convergence',
    crsConvergenceEnabled ? `ON (${(crsConvergenceAngleRad * RAD_TO_DEG).toFixed(6)} deg)` : 'OFF',
  );
  if (coordSystemMode === 'grid') {
    pushSettingRow(
      'CRS Datum Operation',
      `${crsDatumOpId ?? '-'}${crsDatumFallbackUsed ? ' (fallback)' : ''}`,
    );
    pushSettingRow(
      'CRS Area-of-Use Status',
      `${crsAreaOfUseStatus.toUpperCase()}${crsAreaOfUseStatus === 'outside' ? ` (outside=${crsOutOfAreaStationCount})` : ''}`,
    );
  }
  if (coordSystemDiagnostics.length > 0) {
    pushSettingRow('CRS Diagnostics', coordSystemDiagnostics.join(', '));
  }
  if (coordSystemWarningMessages.length > 0) {
    pushSettingRow('CRS Warning Count', String(coordSystemWarningMessages.length));
  }
  pushSettingRow(
    'Geoid/Grid Model',
    geoidModelEnabled
      ? `ON (${geoidModelId}, ${geoidInterpolation.toUpperCase()}, loaded=${geoidModelLoaded ? 'YES' : 'NO'})`
      : 'OFF',
  );
  if (geoidModelEnabled) {
    pushSettingRow(
      'Geoid Metadata',
      `${geoidModelMetadata || 'unavailable'}${geoidSampleUndulationM != null ? `; sampleN=${geoidSampleUndulationM.toFixed(4)} m` : ''}`,
    );
  }
  pushSettingRow(
    'Geoid Height Conversion',
    geoidHeightConversionEnabled
      ? `ON (${geoidOutputHeightDatum.toUpperCase()}, converted=${geoidConvertedStationCount}, skipped=${geoidSkippedStationCount})`
      : 'OFF',
  );
  pushSettingRow(
    'GPS AddHiHt Defaults',
    gpsAddHiHtEnabled
      ? `ON (HI=${(gpsAddHiHtHiM * unitScale).toFixed(4)} ${linearUnit}, HT=${(gpsAddHiHtHtM * unitScale).toFixed(4)} ${linearUnit})`
      : 'OFF',
  );
  if (gpsAddHiHtEnabled) {
    pushSettingRow(
      'GPS AddHiHt Preprocess',
      `vectors=${gpsAddHiHtVectorCount}, adjusted=${gpsAddHiHtAppliedCount} (+${gpsAddHiHtPositiveCount}/-${gpsAddHiHtNegativeCount}/neutral=${gpsAddHiHtNeutralCount}), defaultZero=${gpsAddHiHtDefaultZeroCount}, missingHeight=${gpsAddHiHtMissingHeightCount}, scale=[${gpsAddHiHtScaleMin.toFixed(8)}, ${gpsAddHiHtScaleMax.toFixed(8)}]`,
    );
  }
  pushSettingRow(
    'GPS Loop Check',
    `${gpsLoopCheckEnabled ? 'ON' : 'OFF'}${gpsLoopDiagnostics?.enabled ? ` (vectors=${gpsLoopDiagnostics.vectorCount}, loops=${gpsLoopDiagnostics.loopCount}, pass=${gpsLoopDiagnostics.passCount}, warn=${gpsLoopDiagnostics.warnCount})` : ''}`,
  );
  pushSettingRow(
    'Level Loop Tolerance',
    `${getLevelLoopTolerancePresetLabel(levelLoopToleranceBaseMm, levelLoopTolerancePerSqrtKmMm)} (base=${levelLoopToleranceBaseMm.toFixed(2)} mm, k=${levelLoopTolerancePerSqrtKmMm.toFixed(2)} mm/sqrt(km))`,
  );
  pushSettingRow(
    'GPS Rover Offsets',
    gpsOffsetObservations.length > 0 ? `${gpsOffsetObservations.length} applied` : 'none',
  );
  pushSettingRow(
    'Lost Stations',
    lostStationIds.length > 0 ? `${lostStationIds.length} (${lostStationIds.join(', ')})` : 'none',
  );
  pushSettingRow(
    'QFIX (Linear/Angular)',
    `${(qFixLinearSigmaM * unitScale).toExponential(6)} ${linearUnit}; ${qFixAngularSigmaSec.toExponential(6)}"`,
  );
  pushSettingRow(
    'Description Reconciliation',
    `${descriptionReconcileMode.toUpperCase()}${descriptionReconcileMode === 'append' ? ` (delimiter="${descriptionAppendDelimiter}")` : ''}`,
  );
  if (descriptionScanSummary.length > 0) {
    pushSettingRow(
      'Description Scan',
      `repeated=${traceabilityModel.descriptionRepeatedStationCount}, conflicts=${traceabilityModel.descriptionConflictCount}, stations=${descriptionScanSummary.length}`,
    );
  }
  pushSettingRow('Show Lost Stations in Output', showLostStations ? 'ON' : 'OFF');
  if (res.clusterDiagnostics?.enabled) {
    pushSettingRow(
      'Cluster Detection Mode',
      `${res.clusterDiagnostics.passMode.toUpperCase()} / ${res.clusterDiagnostics.linkageMode.toUpperCase()} (${res.clusterDiagnostics.dimension}, tol=${(res.clusterDiagnostics.tolerance * unitScale).toFixed(4)} ${linearUnit}, merges=${res.clusterDiagnostics.approvedMergeCount ?? 0}, outcomes=${res.clusterDiagnostics.mergeOutcomes?.length ?? 0}, rejected=${res.clusterDiagnostics.rejectedProposals?.length ?? 0})`,
    );
  }
  if (res.autoAdjustDiagnostics?.enabled) {
    pushSettingRow(
      'Auto-Adjust',
      `ON (|t|>=${res.autoAdjustDiagnostics.threshold.toFixed(2)}, cycles=${res.autoAdjustDiagnostics.maxCycles}, maxRm/cycle=${res.autoAdjustDiagnostics.maxRemovalsPerCycle}, minRedund=${res.autoAdjustDiagnostics.minRedundancy.toFixed(2)}, stop=${res.autoAdjustDiagnostics.stopReason}, removed=${res.autoAdjustDiagnostics.removed.length})`,
    );
  }
  if (autoSideshotEnabled && res.autoSideshotDiagnostics?.enabled) {
    pushSettingRow(
      'Auto Sideshot (M-lines)',
      `ON (evaluated=${res.autoSideshotDiagnostics.evaluatedCount}, candidates=${res.autoSideshotDiagnostics.candidateCount}, excluded-control=${res.autoSideshotDiagnostics.excludedControlCount}, minRedund<${res.autoSideshotDiagnostics.threshold.toFixed(2)})`,
    );
  } else {
    pushSettingRow('Auto Sideshot (M-lines)', 'OFF');
  }
  if ((parseState?.aliasExplicitCount ?? 0) > 0 || (parseState?.aliasRuleCount ?? 0) > 0) {
    pushSettingRow(
      'Alias Canonicalization',
      `explicit=${parseState?.aliasExplicitCount ?? 0}, rules=${parseState?.aliasRuleCount ?? 0}, references=${aliasTrace.length}`,
    );
  }
  lines.push('');
  lines.push('Instrument Standard Error Settings');
  lines.push('');
  lines.push('Active Project Instrument Defaults');
  const stochasticRows = parseStochasticDefaultsRows(runDiag.stochasticDefaultsSummary);
  if (stochasticRows.length === 0) {
    pushSettingRow('Defaults Summary', '-');
  } else {
    stochasticRows.forEach((row) => {
      pushSettingRow(row.label, row.value);
    });
  }
  pushSettingRow('Centering Model', runDiag.angleCenteringModel);
  pushSettingRow(
    'Default Sigma Usage',
    `${runDiag.defaultSigmaCount} default-sigma obs${runDiag.defaultSigmaByType ? ` (${runDiag.defaultSigmaByType})` : ''}`,
  );
  if ((parseState?.aliasExplicitMappings?.length ?? 0) > 0) {
    lines.push('Explicit Alias Mappings');
    parseState?.aliasExplicitMappings?.forEach((m) => {
      lines.push(
        `${m.sourceId} -> ${m.canonicalId}${m.sourceLine != null ? ` (line ${m.sourceLine})` : ''}`,
      );
    });
  }
  if ((parseState?.aliasRuleSummaries?.length ?? 0) > 0) {
    lines.push('Alias Rules');
    parseState?.aliasRuleSummaries?.forEach((r) => {
      lines.push(`${r.rule} (line ${r.sourceLine})`);
    });
  }
  lines.push('');
  lines.push('Summary of Unadjusted Input Observations');
  lines.push('========================================');
  lines.push('');
  pushSettingRow(
    `Number of Entered Stations (${linearUnit})`,
    `${stationEntriesInputOrder.length}`,
  );
  pushSettingRow('Fixed Stations', `${fixedStations}`);
  pushSettingRow('Free Stations', `${freeStations}`);

  const countByType = (type: Observation['type']) =>
    observationsForListing.filter((o) => o.type === type).length;
  lines.push('');
  const angleUnitToken = (parseState?.angleUnits ?? parseSettings.angleUnits).toUpperCase();
  pushSettingRow(`Number of Angle Observations (${angleUnitToken})`, `${countByType('angle')}`);
  pushSettingRow(`Number of Distance Observations (${linearUnit})`, `${countByType('dist')}`);
  pushSettingRow(
    `Number of Direction Observations (${angleUnitToken})`,
    `${countByType('direction') + countByType('dir') + countByType('bearing')}`,
  );
  lines.push('');
  lines.push('Adjustment Statistical Summary');
  lines.push('==============================');
  lines.push('');
  pushSettingRow('Iterations', `${getIndustryReportedIterationCount(res)}`);
  pushSettingRow('Number of Stations', `${stationEntriesInputOrder.length}`);
  pushSettingRow('Number of Observations', `${observationCount}`);
  pushSettingRow('Number of Unknowns', `${unknownCount}`);
  pushSettingRow('Number of Redundant Obs', `${res.dof}`);
  lines.push('');
  lines.push('Observation Statistics');

  const statisticalSummary = buildResultStatisticalSummaryModel(res, 'listing');
  const statRows = statisticalSummary.rows;
  const totalCount = statisticalSummary.totalCount;
  const totalSumSquares = statisticalSummary.totalSumSquares;
  const statTableRows = statRows.map((row) => [
    row.label,
    row.count.toString(),
    row.sumSquares.toFixed(3),
    row.errorFactor.toFixed(3),
  ]);
  statTableRows.push([
    'Total',
    totalCount.toString(),
    totalSumSquares.toFixed(3),
    res.seuw.toFixed(3),
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
  const sigmaSourceLabel = (source?: SigmaSource): string => {
    switch (source ?? 'explicit') {
      case 'default':
        return 'DEFAULT';
      case 'fixed':
        return 'FIXED';
      case 'float':
        return 'FLOAT';
      default:
        return 'EXPLICIT';
    }
  };
  const summarizeObservationWeight = (obs: Observation): string => {
    if (obs.type === 'gps') {
      const east = sigmaSourceLabel(obs.sigmaSourceE ?? obs.sigmaSource);
      const north = sigmaSourceLabel(obs.sigmaSourceN ?? obs.sigmaSource);
      return east === north ? east : `E=${east} N=${north}`;
    }
    return sigmaSourceLabel(obs.sigmaSource);
  };

  if (settings.listingShowCoordinates) {
    lines.push('');
    addCenteredHeading(`Adjusted Coordinates (${linearUnit})`);
    lines.push('');
    const coordRows = stationEntriesForListing.map(([id, st]) => [
      id,
      stationDescription(id) || '-',
      (st.y * unitScale).toFixed(4),
      (st.x * unitScale).toFixed(4),
    ]);
    renderTextTable(['Station', 'Description', 'N', 'E'], coordRows, [2, 3]);

    const controlStatusRows = stationEntriesForListing
      .map(([id, st]) => [id, stationDescription(id) || '-', summarizeControlComponentStatus(st)] as const)
      .filter(([, , summary]) => summary != null)
      .map(([id, description, summary]) => [id, description, summary ?? '-']);
    if (controlStatusRows.length > 0) {
      lines.push('');
      addCenteredHeading('Control Component Status');
      lines.push('');
      renderTextTable(['Station', 'Description', 'Components'], controlStatusRows);
    }

    if (coordSystemMode === 'grid') {
      const geodeticRows = stationEntriesForListing.map(([id, st]) => [
        id,
        Number.isFinite(st.latDeg ?? Number.NaN) ? (st.latDeg as number).toFixed(9) : '-',
        Number.isFinite(st.lonDeg ?? Number.NaN) ? (st.lonDeg as number).toFixed(9) : '-',
        (st.h * unitScale).toFixed(4),
        st.heightType === 'orthometric' ? 'ORTHO' : 'ELLIP',
      ]);
      lines.push('');
      addCenteredHeading('Geodetic Position Summary');
      lines.push('');
      renderTextTable(
        ['Station', 'Lat (deg)', 'Lon (deg)', `Height (${linearUnit})`, 'HeightType'],
        geodeticRows,
        [3],
      );

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

  const compareObsByInput = (a: Observation, b: Observation) => {
    const aLine = a.sourceLine ?? Number.MAX_SAFE_INTEGER;
    const bLine = b.sourceLine ?? Number.MAX_SAFE_INTEGER;
    if (aLine !== bLine) return aLine - bLine;
    return (a.id ?? 0) - (b.id ?? 0);
  };
  const compareStationIds = (a: string, b: string) =>
    a.localeCompare(b, undefined, { numeric: true });
  const compareObsByStations = (a: Observation, b: Observation) => {
    const stationKey = (obs: Observation) =>
      obs.type === 'angle'
        ? `${obs.at}-${obs.from}-${obs.to}`
        : obs.type === 'direction'
          ? `${obs.at}-${obs.to}`
          : `${obs.from}-${obs.to}`;
    const cmp = stationKey(a).localeCompare(stationKey(b), undefined, { numeric: true });
    if (cmp !== 0) return cmp;
    return compareObsByInput(a, b);
  };
  const compareObsByStdRes = (a: Observation, b: Observation) => {
    const stdResDelta = Math.abs(b.stdRes ?? 0) - Math.abs(a.stdRes ?? 0);
    if (Math.abs(stdResDelta) > 1e-12) return stdResDelta;
    const stationDelta = compareObsByStations(a, b);
    if (stationDelta !== 0) return stationDelta;
    return compareObsByInput(a, b);
  };
  const listingObservations = [...observationsForListing]
    .filter((o) => Number.isFinite(o.stdRes))
    .filter((o) =>
      settings.listingShowAzimuthsBearings
        ? true
        : !(o.type === 'direction' || o.type === 'dir' || o.type === 'bearing'),
    )
    .sort((a, b) => {
      if (settings.listingSortObservationsBy === 'input') return compareObsByInput(a, b);
      if (settings.listingSortObservationsBy === 'name') return compareObsByStations(a, b);
      return compareObsByStdRes(a, b);
    });
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
  const relationshipPairMap = new Map<string, RelationshipPair>();
  const addRelationshipPair = (from?: string, to?: string, preserveOrientation = false) => {
    if (!from || !to || from === to) return;
    const fromStation = res.stations[from];
    const toStation = res.stations[to];
    const oriented = preserveOrientation
      ? { from, to }
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
  relativeCovarianceRows.forEach((row) => {
    addRelationshipPair(row.from, row.to, true);
  });
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
  const relationshipPairs = [...relationshipPairMap.values()];

  const formatAngularResidualArcSec = (value: number | undefined): string =>
    value != null ? `${(-value * RAD_TO_DEG * 3600).toFixed(2)}"` : '-';
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
  const formatEffectiveDistance = (value: number | undefined): string =>
    value != null && Number.isFinite(value) && value > 0 ? (value * unitScale).toFixed(4) : '-';
  const formatEllipseAzDm = (
    thetaDeg?: number,
    semiMajor?: number,
    semiMinor?: number,
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
    let az = surveyAzimuth;
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
    ellipse?: { semiMajor: number; semiMinor: number; theta: number };
  };
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
  const resolveRelativePair = (pair: RelationshipPair): RelativePairStats | undefined => {
    const matchedCovariance =
      relativeCovarianceRows.find((r) => r.from === pair.from && r.to === pair.to) ??
      relativeCovarianceRows.find((r) => r.from === pair.to && r.to === pair.from);
    if (matchedCovariance) {
      return {
        from: pair.from,
        to: pair.to,
        sigmaDist: matchedCovariance.sigmaDist,
        sigmaAz: matchedCovariance.sigmaAz,
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
        ellipse: rel?.ellipse,
      };
    })
    .filter((row) => row.distance !== '-');
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
        const residual = obs.residual as { vE?: number; vN?: number };
        const vE = Number.isFinite(residual.vE as number) ? (residual.vE as number) : Number.NaN;
        const vN = Number.isFinite(residual.vN as number) ? (residual.vN as number) : Number.NaN;
        if (!Number.isFinite(vE) || !Number.isFinite(vN)) return null;
        const diffMag = Math.hypot(vE, vN) * unitScale;
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

  if (
    !isPreanalysis &&
    settings.listingShowObservationsResiduals &&
    listingObservations.length > 0
  ) {
    const angleRows = listingObservations
      .filter((obs) => obs.type === 'angle')
      .map((obs) => [
        `${obs.at}-${obs.from}-${obs.to}${aliasRefsForLine(obs.sourceLine)}${autoSideshotSuffix(obs)}`,
        radToDmsStr((obs.calc as number | undefined) ?? obs.obs),
        formatAngularResidualArcSec(obs.residual as number | undefined),
        formatEffectiveDistance(obs.effectiveDistance),
        formatAngularStdErrArcSec(obs.weightingStdDev ?? obs.stdDev),
        formatIndustryStdRes(obs),
        obs.sourceLine != null ? `1:${obs.sourceLine}` : '-',
      ]);
    renderAdjustedSection(
      `Adjusted Angle Observations (${(parseState?.angleUnits ?? parseSettings.angleUnits).toUpperCase()})`,
      angleRows,
      [
        'Stations',
        'Angle',
        'Residual',
        'Distance',
        'StdErr',
        'StdRes',
        'File:Line',
      ],
      [5],
    );

    const distanceRows = listingObservations
      .filter((obs) => obs.type === 'dist')
      .map((obs) => [
        `${obs.from}-${obs.to}${aliasRefsForLine(obs.sourceLine)}${autoSideshotSuffix(obs)}${prismSuffix(obs)}`,
        formatLinear((obs.calc as number | undefined) ?? obs.obs),
        formatResidualLinear(obs.residual as number | undefined),
        formatLinear(obs.weightingStdDev ?? obs.stdDev),
        formatIndustryStdRes(obs),
        obs.sourceLine != null ? `1:${obs.sourceLine}` : '-',
      ]);
    renderAdjustedSection(
      `Adjusted Distance Observations (${linearUnit})`,
      distanceRows,
      ['Stations', 'Distance', 'Residual', 'StdErr', 'StdRes', 'File:Line'],
      [1, 2, 3, 4],
    );

    const directionRows = listingObservations
      .filter((obs) => obs.type === 'direction')
      .map((obs) => [
        `${obs.at}-${obs.to}${aliasRefsForLine(obs.sourceLine)}${autoSideshotSuffix(obs)}`,
        radToDmsStr((obs.calc as number | undefined) ?? obs.obs),
        formatAngularResidualArcSec(obs.residual as number | undefined),
        formatEffectiveDistance(obs.effectiveDistance),
        formatAngularStdErrArcSec(obs.weightingStdDev ?? obs.stdDev),
        formatIndustryStdRes(obs),
        obs.sourceLine != null ? `1:${obs.sourceLine}` : '-',
      ]);
    renderAdjustedSection(
      `Adjusted Direction Observations (${(parseState?.angleUnits ?? parseSettings.angleUnits).toUpperCase()})`,
      directionRows,
      [
        'Stations',
        'Direction',
        'Residual',
        'Distance',
        'StdErr',
        'StdRes',
        'File:Line',
      ],
      [5],
    );

    if (relationshipRows.length > 0) {
      lines.push('');
      const azTitle = `Adjusted Azimuths (${(parseState?.angleUnits ?? parseSettings.angleUnits).toUpperCase()}) and Horizontal Distances (${linearUnit})`;
      addCenteredHeading(azTitle);
      lines.push('                 (Relative Confidence of Azimuth is in Seconds)');
      lines.push('');
      lines.push('From       To               Azimuth    Distance       95% RelConfidence');
      lines.push('                                                    Azi    Dist       PPM');
      relationshipRows.forEach((row) => {
        lines.push(
          `${row.from.padEnd(10)} ${row.to.padEnd(10)} ${row.azimuth.padStart(14)} ${row.distance.padStart(10)} ${row.sigmaAz95.padStart(7)} ${row.sigmaDist95.padStart(8)} ${row.ppm95.padStart(10)}`,
        );
      });
    }

    if (coordSystemMode === 'grid') {
      const gridDistanceRows = listingObservations
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

    const weightingRows = listingObservations.map((obs) => [
      obs.type.toUpperCase(),
      obs.type === 'angle'
        ? `${obs.at}-${obs.from}-${obs.to}${aliasRefsForLine(obs.sourceLine)}${autoSideshotSuffix(obs)}`
        : obs.type === 'direction'
          ? `${obs.at}-${obs.to}${aliasRefsForLine(obs.sourceLine)}${autoSideshotSuffix(obs)}`
          : 'from' in obs && 'to' in obs
            ? `${obs.from}-${obs.to}${aliasRefsForLine(obs.sourceLine)}${autoSideshotSuffix(obs)}${prismSuffix(obs)}`
            : '-',
      summarizeObservationWeight(obs),
      obs.sourceLine != null ? `1:${obs.sourceLine}` : '-',
    ]);
    renderAdjustedSection(
      'Observation Weighting Traceability',
      weightingRows,
      ['Type', 'Stations', 'Weight', 'File:Line'],
      [],
      [
        'Weight shows whether each observation used explicit, default, fixed, or float sigma handling.',
      ],
    );
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
  renderSideshotListingSection('Post-Adjusted Sideshots (TS)', tsSideshotsForListing);
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

  if (settings.listingShowErrorPropagation) {
    lines.push('');
    addCenteredHeading('Error Propagation');

    lines.push('');
    lines.push(
      `${isPreanalysis ? 'Predicted Station Coordinate Standard Deviations' : 'Station Coordinate Standard Deviations'} (${linearUnit})`,
    );
    lines.push('');
    const stdRows = stationEntriesForListing.map(([id]) => {
      const precision = getStationPrecision(res, id, precisionReportingMode);
      return [
        id,
        stationDescription(id) || '-',
        ((precision.sigmaN ?? 0) * unitScale).toFixed(6),
        ((precision.sigmaE ?? 0) * unitScale).toFixed(6),
      ];
    });
    renderTextTable(['Station', 'Description', 'N', 'E'], stdRows, [2, 3]);

    lines.push('');
    lines.push(
      `${isPreanalysis ? 'Predicted Station Coordinate Error Ellipses' : 'Station Coordinate Error Ellipses'} (${linearUnit})`,
    );
    lines.push('                            Confidence Region = 95%');
    lines.push('');
    const stationEllipseRows = stationEntriesForListing
      .map(([id]) => {
        const precision = getStationPrecision(res, id, precisionReportingMode);
        if (!precision.ellipse) return null;
        return [
          id,
          ((precision.ellipse.semiMajor ?? 0) * confidence95Scale * unitScale).toFixed(6),
          ((precision.ellipse.semiMinor ?? 0) * confidence95Scale * unitScale).toFixed(6),
          formatEllipseAzDm(
            precision.ellipse.theta,
            precision.ellipse.semiMajor,
            precision.ellipse.semiMinor,
          ),
        ];
      })
      .filter((row): row is string[] => row != null);
    if (stationEllipseRows.length > 0) {
      lines.push('Station                 Semi-Major    Semi-Minor   Azimuth of');
      lines.push('                            Axis          Axis     Major Axis');
      stationEllipseRows.forEach((row) => {
        lines.push(
          `${row[0].padEnd(22)} ${row[1].padStart(12)} ${row[2].padStart(12)} ${row[3].padStart(10)}`,
        );
      });
    } else {
      lines.push('(none)');
    }

    lines.push('');
    lines.push(
      `${isPreanalysis ? 'Predicted Relative Error Ellipses' : 'Relative Error Ellipses'} (${linearUnit})`,
    );
    lines.push('                            Confidence Region = 95%');
    lines.push('');
    const relativeEllipseRows = relationshipRows
      .filter((row) => row.ellipse != null)
      .map((row) => [
        row.from,
        row.to,
        ((row.ellipse?.semiMajor ?? 0) * confidence95Scale * unitScale).toFixed(6),
        ((row.ellipse?.semiMinor ?? 0) * confidence95Scale * unitScale).toFixed(6),
        formatEllipseAzDm(row.ellipse?.theta, row.ellipse?.semiMajor, row.ellipse?.semiMinor),
      ]);
    if (relativeEllipseRows.length > 0) {
      lines.push('Stations                Semi-Major    Semi-Minor   Azimuth of');
      lines.push('From       To               Axis          Axis     Major Axis');
      relativeEllipseRows.forEach((row) => {
        lines.push(
          `${row[0].padEnd(10)} ${row[1].padEnd(10)} ${row[2].padStart(12)} ${row[3].padStart(12)} ${row[4].padStart(10)}`,
        );
      });
    } else {
      lines.push('(none)');
    }

    if (isPreanalysis && res.weakGeometryDiagnostics) {
      const flaggedStations = res.weakGeometryDiagnostics.stationCues.filter(
        (cue) => cue.severity !== 'ok',
      );
      const flaggedPairs = res.weakGeometryDiagnostics.relativeCues.filter(
        (cue) => cue.severity !== 'ok',
      );
      lines.push('');
      lines.push('Weak Geometry Cues');
      lines.push('');
      lines.push(
        `stationMedian=${(res.weakGeometryDiagnostics.stationMedianHorizontal * unitScale).toFixed(6)} ${linearUnit}; pairMedian=${
          res.weakGeometryDiagnostics.relativeMedianDistance != null
            ? `${(res.weakGeometryDiagnostics.relativeMedianDistance * unitScale).toFixed(6)} ${linearUnit}`
            : '-'
        }`,
      );
      if (flaggedStations.length === 0 && flaggedPairs.length === 0) {
        lines.push('(none)');
      } else {
        flaggedStations.forEach((cue) => {
          lines.push(
            `  Station ${cue.stationId}: ${cue.severity.toUpperCase()} metric=${(
              cue.horizontalMetric * unitScale
            ).toFixed(6)} ${linearUnit} ratio=${
              cue.relativeToMedian != null ? `${cue.relativeToMedian.toFixed(2)}x` : '-'
            } shape=${cue.ellipseRatio != null ? `${cue.ellipseRatio.toFixed(2)}x` : '-'} ${cue.note}`,
          );
        });
        flaggedPairs.forEach((cue) => {
          lines.push(
            `  Pair ${cue.from}-${cue.to}: ${cue.severity.toUpperCase()} metric=${
              cue.distanceMetric != null
                ? `${(cue.distanceMetric * unitScale).toFixed(6)} ${linearUnit}`
                : '-'
            } ratio=${cue.relativeToMedian != null ? `${cue.relativeToMedian.toFixed(2)}x` : '-'} shape=${
              cue.ellipseRatio != null ? `${cue.ellipseRatio.toFixed(2)}x` : '-'
            } ${cue.note}`,
          );
        });
      }
    }
  }
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
