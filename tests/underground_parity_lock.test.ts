import { readFileSync } from 'node:fs';

import { describe, expect, it } from 'vitest';

import type { ParseSettings, SettingsState, SolveProfile } from '../src/appStateTypes';
import { LSAEngine } from '../src/engine/adjust';
import { buildIndustryStyleListingText } from '../src/engine/industryListing';
import { createRunProfileBuilders } from '../src/engine/runProfileBuilders';
import type { ParseOptions } from '../src/types';
import type { Instrument, InstrumentLibrary } from '../src/types';

const UNDERGROUND_INPUT_PATH = 'tests/fixtures/industry_case_underground_input.txt';
const UNDERGROUND_OUTPUT_PATH = 'tests/fixtures/industry_case_underground_output.txt';

const undergroundSettings: SettingsState = {
  maxIterations: 10,
  convergenceLimit: 0.01,
  precisionReportingMode: 'industry-standard',
  units: 'm',
  uiTheme: 'gruvbox-light',
  mapShowLostStations: true,
  map3dEnabled: false,
  listingShowLostStations: true,
  listingShowCoordinates: true,
  listingShowObservationsResiduals: true,
  listingShowErrorPropagation: true,
  listingShowProcessingNotes: true,
  listingShowAzimuthsBearings: true,
  listingSortCoordinatesBy: 'input',
  listingSortObservationsBy: 'residual',
  listingObservationLimit: 9999,
};

const undergroundParseSettings: ParseSettings = {
  solveProfile: 'industry-parity-current',
  coordMode: '2D',
  coordSystemMode: 'local',
  crsId: 'CA_NAD83_CSRS_NB_STEREO_DOUBLE',
  localDatumScheme: 'average-scale',
  averageScaleFactor: 1,
  commonElevation: 0,
  averageGeoidHeight: 0,
  gnssVectorFrameDefault: 'gridNEU',
  gnssFrameConfirmed: false,
  observationMode: {
    bearing: 'grid',
    distance: 'measured',
    angle: 'measured',
    direction: 'measured',
  },
  gridBearingMode: 'grid',
  gridDistanceMode: 'measured',
  gridAngleMode: 'measured',
  gridDirectionMode: 'measured',
  runMode: 'adjustment',
  preanalysisMode: false,
  clusterDetectionEnabled: false,
  autoSideshotEnabled: true,
  autoAdjustEnabled: false,
  autoAdjustMaxCycles: 3,
  autoAdjustMaxRemovalsPerCycle: 1,
  autoAdjustStdResThreshold: 4,
  suspectImpactMode: 'auto',
  order: 'NE',
  angleUnits: 'dms',
  angleStationOrder: 'atfromto',
  angleMode: 'auto',
  deltaMode: 'horiz',
  mapMode: 'off',
  mapScaleFactor: 1,
  normalize: true,
  faceNormalizationMode: 'on',
  applyCurvatureRefraction: false,
  refractionCoefficient: 0.13,
  verticalReduction: 'none',
  levelWeight: undefined,
  levelLoopToleranceBaseMm: 0,
  levelLoopTolerancePerSqrtKmMm: 4,
  crsTransformEnabled: false,
  crsProjectionModel: 'legacy-equirectangular',
  crsLabel: '',
  crsGridScaleEnabled: false,
  crsGridScaleFactor: 1,
  crsConvergenceEnabled: false,
  crsConvergenceAngleRad: 0,
  geoidModelEnabled: false,
  geoidModelId: 'NGS-DEMO',
  geoidSourceFormat: 'builtin',
  geoidSourcePath: '',
  geoidInterpolation: 'bilinear',
  geoidHeightConversionEnabled: false,
  geoidOutputHeightDatum: 'orthometric',
  gpsLoopCheckEnabled: false,
  gpsAddHiHtEnabled: false,
  gpsAddHiHtHiM: 0,
  gpsAddHiHtHtM: 0,
  qFixLinearSigmaM: 1e-7,
  qFixAngularSigmaSec: 1.0001e-3,
  prismEnabled: false,
  prismOffset: 0,
  prismScope: 'global',
  descriptionReconcileMode: 'first',
  descriptionAppendDelimiter: ' | ',
  lonSign: 'west-negative',
  tsCorrelationEnabled: false,
  tsCorrelationRho: 0.25,
  tsCorrelationScope: 'set',
  robustMode: 'none',
  robustK: 1.5,
  parseCompatibilityMode: 'strict',
  parseModeMigrated: true,
};

const s9Instrument: Instrument = {
  code: 'S9',
  desc: 'industry standard S9 0.5"',
  edm_const: 0.001,
  edm_ppm: 1,
  hzPrecision_sec: 0.5,
  dirPrecision_sec: 0.5,
  azBearingPrecision_sec: 0.5,
  vaPrecision_sec: 0,
  instCentr_m: 0.0005,
  tgtCentr_m: 0,
  vertCentr_m: 0,
  elevDiff_const_m: 0,
  elevDiff_ppm: 0,
  gpsStd_xy: 0,
  levStd_mmPerKm: 0,
};

const projectInstruments: InstrumentLibrary = {
  S9: s9Instrument,
};

const normalizeSolveProfile = (
  profile: SolveProfile,
): Exclude<SolveProfile, 'industry-parity'> =>
  profile === 'industry-parity' ? 'industry-parity-current' : profile;

const buildEngineParseOptions = (
  effectiveParse: ParseSettings,
  currentInstrument: string | undefined,
  directionSetMode: 'reduced' | 'raw',
): Partial<ParseOptions> => ({
  geometryDependentSigmaReference: effectiveParse.geometryDependentSigmaReference,
  runMode: effectiveParse.runMode,
  sourceFile: '<project-main>',
  units: undergroundSettings.units,
  coordMode: effectiveParse.coordMode,
  coordSystemMode: effectiveParse.coordSystemMode,
  crsId: effectiveParse.crsId,
  localDatumScheme: effectiveParse.localDatumScheme,
  averageScaleFactor: effectiveParse.averageScaleFactor,
  commonElevation: effectiveParse.commonElevation,
  averageGeoidHeight: effectiveParse.averageGeoidHeight,
  gnssVectorFrameDefault: effectiveParse.gnssVectorFrameDefault,
  gnssFrameConfirmed: effectiveParse.gnssFrameConfirmed,
  observationMode: {
    bearing: effectiveParse.gridBearingMode,
    distance: effectiveParse.gridDistanceMode,
    angle: effectiveParse.gridAngleMode,
    direction: effectiveParse.gridDirectionMode,
  },
  gridBearingMode: effectiveParse.gridBearingMode,
  gridDistanceMode: effectiveParse.gridDistanceMode,
  gridAngleMode: effectiveParse.gridAngleMode,
  gridDirectionMode: effectiveParse.gridDirectionMode,
  preanalysisMode: effectiveParse.runMode === 'preanalysis',
  order: effectiveParse.order,
  angleUnits: effectiveParse.angleUnits,
  angleStationOrder: effectiveParse.angleStationOrder,
  angleMode: effectiveParse.angleMode,
  deltaMode: effectiveParse.deltaMode,
  mapMode: effectiveParse.mapMode,
  mapScaleFactor: effectiveParse.mapScaleFactor,
  faceNormalizationMode: effectiveParse.faceNormalizationMode,
  normalize: effectiveParse.faceNormalizationMode !== 'off',
  applyCurvatureRefraction: effectiveParse.applyCurvatureRefraction,
  refractionCoefficient: effectiveParse.refractionCoefficient,
  verticalReduction: effectiveParse.verticalReduction,
  levelWeight: effectiveParse.levelWeight,
  levelLoopToleranceBaseMm: effectiveParse.levelLoopToleranceBaseMm,
  levelLoopTolerancePerSqrtKmMm: effectiveParse.levelLoopTolerancePerSqrtKmMm,
  crsTransformEnabled: effectiveParse.crsTransformEnabled,
  crsProjectionModel: effectiveParse.crsProjectionModel,
  crsLabel: effectiveParse.crsLabel,
  crsGridScaleEnabled: effectiveParse.crsGridScaleEnabled,
  crsGridScaleFactor: effectiveParse.crsGridScaleFactor,
  crsConvergenceEnabled: effectiveParse.crsConvergenceEnabled,
  crsConvergenceAngleRad: effectiveParse.crsConvergenceAngleRad,
  geoidModelEnabled: effectiveParse.geoidModelEnabled,
  geoidModelId: effectiveParse.geoidModelId,
  geoidSourceFormat: effectiveParse.geoidSourceFormat,
  geoidSourcePath: effectiveParse.geoidSourcePath,
  geoidInterpolation: effectiveParse.geoidInterpolation,
  geoidHeightConversionEnabled: effectiveParse.geoidHeightConversionEnabled,
  geoidOutputHeightDatum: effectiveParse.geoidOutputHeightDatum,
  gpsLoopCheckEnabled: effectiveParse.gpsLoopCheckEnabled,
  gpsAddHiHtEnabled: effectiveParse.gpsAddHiHtEnabled,
  gpsAddHiHtHiM: effectiveParse.gpsAddHiHtHiM,
  gpsAddHiHtHtM: effectiveParse.gpsAddHiHtHtM,
  qFixLinearSigmaM: effectiveParse.qFixLinearSigmaM,
  qFixAngularSigmaSec: effectiveParse.qFixAngularSigmaSec,
  prismEnabled: effectiveParse.prismEnabled,
  prismOffset: effectiveParse.prismOffset,
  prismScope: effectiveParse.prismScope,
  descriptionReconcileMode: effectiveParse.descriptionReconcileMode,
  descriptionAppendDelimiter: effectiveParse.descriptionAppendDelimiter,
  lonSign: effectiveParse.lonSign,
  tsCorrelationEnabled: effectiveParse.tsCorrelationEnabled,
  tsCorrelationRho: effectiveParse.tsCorrelationRho,
  tsCorrelationScope: effectiveParse.tsCorrelationScope,
  robustMode: effectiveParse.robustMode,
  robustK: effectiveParse.robustK,
  parseCompatibilityMode: effectiveParse.parseCompatibilityMode,
  parseModeMigrated: effectiveParse.parseModeMigrated,
  autoAdjustEnabled: effectiveParse.autoAdjustEnabled,
  autoAdjustMaxCycles: effectiveParse.autoAdjustMaxCycles,
  autoAdjustMaxRemovalsPerCycle: effectiveParse.autoAdjustMaxRemovalsPerCycle,
  autoAdjustStdResThreshold: effectiveParse.autoAdjustStdResThreshold,
  autoSideshotEnabled: effectiveParse.autoSideshotEnabled,
  directionSetMode,
  clusterDetectionEnabled: effectiveParse.clusterDetectionEnabled,
  currentInstrument,
  preferExternalInstruments: true,
});

describe('underground parity lock', () => {
  it('keeps the underground reference listing exactly stable from project option settings to the file end', () => {
    const input = readFileSync(UNDERGROUND_INPUT_PATH, 'utf-8');
    const { resolveProfileContext, buildRunDiagnostics } = createRunProfileBuilders({
      projectInstruments,
      selectedInstrument: 'S9',
      defaultIndustryInstrumentCode: 'S9',
      defaultIndustryInstrument: s9Instrument,
      normalizeSolveProfile,
    });
    const profileContext = resolveProfileContext(undergroundParseSettings);
    const result = new LSAEngine({
      input,
      maxIterations: undergroundSettings.maxIterations,
      convergenceThreshold: undergroundSettings.convergenceLimit,
      instrumentLibrary: profileContext.effectiveInstrumentLibrary,
      parseOptions: buildEngineParseOptions(
        profileContext.effectiveParse,
        profileContext.currentInstrument,
        profileContext.directionSetMode,
      ),
    }).solve();

    expect(result.success).toBe(true);

    const runDiagnostics = buildRunDiagnostics(undergroundParseSettings, result);

    const listing = buildIndustryStyleListingText(
      result,
      undergroundSettings,
      {
        coordMode: undergroundParseSettings.coordMode,
        order: undergroundParseSettings.order,
        angleUnits: undergroundParseSettings.angleUnits,
        angleStationOrder: undergroundParseSettings.angleStationOrder,
        deltaMode: undergroundParseSettings.deltaMode,
        refractionCoefficient: undergroundParseSettings.refractionCoefficient,
      },
      runDiagnostics,
    );

    const referenceOutput = readFileSync(UNDERGROUND_OUTPUT_PATH, 'utf-8');
    const startMarker = 'Project Option Settings';
    const normalizeLineEndings = (text: string) => text.replace(/\r\n/g, '\n').replace(/\r/g, '\n');
    const normalizedReferenceOutput = normalizeLineEndings(referenceOutput);
    const normalizedListing = normalizeLineEndings(listing);

    expect(normalizedReferenceOutput.slice(normalizedReferenceOutput.indexOf(startMarker))).toBe(
      normalizedListing.slice(normalizedListing.indexOf(startMarker)),
    );
  });
});
