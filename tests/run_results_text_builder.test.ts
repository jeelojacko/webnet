import { afterEach, describe, expect, it, vi } from 'vitest';

import { DEFAULT_INPUT } from '../src/defaultInput';
import { createRunResultsTextBuilder } from '../src/engine/runResultsTextBuilder';
import { createRunProfileBuilders } from '../src/engine/runProfileBuilders';
import { solveEngine } from '../src/engine/solveEngine';
import type { ParseSettings, SettingsState, SolveProfile } from '../src/appStateTypes';
import type { Instrument, InstrumentLibrary } from '../src/types';

const baseSettings: SettingsState = {
  maxIterations: 10,
  convergenceLimit: 0.01,
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
  listingSortCoordinatesBy: 'name',
  listingSortObservationsBy: 'stdResidual',
  listingObservationLimit: 60,
};

const baseParseSettings: ParseSettings = {
  solveProfile: 'industry-parity',
  coordMode: '3D',
  coordSystemMode: 'local',
  crsId: 'EPSG:26920',
  localDatumScheme: 'average-scale',
  averageScaleFactor: 1,
  commonElevation: 0,
  averageGeoidHeight: 0,
  gnssVectorFrameDefault: 'gridNEU',
  gnssFrameConfirmed: false,
  verticalDeflectionNorthSec: 0,
  verticalDeflectionEastSec: 0,
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
  order: 'EN',
  angleUnits: 'dms',
  angleStationOrder: 'atfromto',
  angleMode: 'auto',
  deltaMode: 'slope',
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
  vaPrecision_sec: 0.5,
  instCentr_m: 0.0005,
  tgtCentr_m: 0,
  vertCentr_m: 0,
  elevDiff_const_m: 0,
  elevDiff_ppm: 0,
  gpsStd_xy: 0,
  levStd_mmPerKm: 0,
};

const normalizeSolveProfile = (_profile: SolveProfile): SolveProfile => 'industry-parity';

afterEach(() => {
  vi.useRealTimers();
});

describe('createRunResultsTextBuilder', () => {
  it('builds the WebNet report text from a solved run without changing key sections', () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-03-17T12:34:56Z'));

    const projectInstruments: InstrumentLibrary = {
      S9: s9Instrument,
    };
    const { resolveProfileContext, buildRunDiagnostics } = createRunProfileBuilders({
      projectInstruments,
      selectedInstrument: 'S9',
      defaultIndustryInstrumentCode: 'S9',
      defaultIndustryInstrument: s9Instrument,
      normalizeSolveProfile,
    });
    const profileContext = resolveProfileContext(baseParseSettings);
    const result = solveEngine({
      input: DEFAULT_INPUT,
      maxIterations: baseSettings.maxIterations,
      convergenceThreshold: baseSettings.convergenceLimit,
      instrumentLibrary: profileContext.effectiveInstrumentLibrary,
      parseOptions: {
        runMode: profileContext.effectiveParse.runMode,
        units: baseSettings.units,
        coordMode: profileContext.effectiveParse.coordMode,
        coordSystemMode: profileContext.effectiveParse.coordSystemMode,
        crsId: profileContext.effectiveParse.crsId,
        localDatumScheme: profileContext.effectiveParse.localDatumScheme,
        averageScaleFactor: profileContext.effectiveParse.averageScaleFactor,
        commonElevation: profileContext.effectiveParse.commonElevation,
        averageGeoidHeight: profileContext.effectiveParse.averageGeoidHeight,
        gnssVectorFrameDefault: profileContext.effectiveParse.gnssVectorFrameDefault,
        gnssFrameConfirmed: profileContext.effectiveParse.gnssFrameConfirmed,
        observationMode: profileContext.effectiveParse.observationMode,
        gridBearingMode: profileContext.effectiveParse.gridBearingMode,
        gridDistanceMode: profileContext.effectiveParse.gridDistanceMode,
        gridAngleMode: profileContext.effectiveParse.gridAngleMode,
        gridDirectionMode: profileContext.effectiveParse.gridDirectionMode,
        preanalysisMode: profileContext.effectiveParse.runMode === 'preanalysis',
        order: profileContext.effectiveParse.order,
        angleUnits: profileContext.effectiveParse.angleUnits,
        angleStationOrder: profileContext.effectiveParse.angleStationOrder,
        angleMode: profileContext.effectiveParse.angleMode,
        deltaMode: profileContext.effectiveParse.deltaMode,
        mapMode: profileContext.effectiveParse.mapMode,
        mapScaleFactor: profileContext.effectiveParse.mapScaleFactor,
        faceNormalizationMode: profileContext.effectiveParse.faceNormalizationMode,
        normalize: profileContext.effectiveParse.faceNormalizationMode !== 'off',
        applyCurvatureRefraction: profileContext.effectiveParse.applyCurvatureRefraction,
        refractionCoefficient: profileContext.effectiveParse.refractionCoefficient,
        verticalReduction: profileContext.effectiveParse.verticalReduction,
        levelWeight: profileContext.effectiveParse.levelWeight,
        clusterDetectionEnabled: profileContext.effectiveParse.clusterDetectionEnabled,
        autoSideshotEnabled: profileContext.effectiveParse.autoSideshotEnabled,
        autoAdjustEnabled: profileContext.effectiveParse.autoAdjustEnabled,
        autoAdjustMaxCycles: profileContext.effectiveParse.autoAdjustMaxCycles,
        autoAdjustMaxRemovalsPerCycle:
          profileContext.effectiveParse.autoAdjustMaxRemovalsPerCycle,
        autoAdjustStdResThreshold: profileContext.effectiveParse.autoAdjustStdResThreshold,
        suspectImpactMode: profileContext.effectiveParse.suspectImpactMode,
        levelLoopToleranceBaseMm: profileContext.effectiveParse.levelLoopToleranceBaseMm,
        levelLoopTolerancePerSqrtKmMm:
          profileContext.effectiveParse.levelLoopTolerancePerSqrtKmMm,
        crsTransformEnabled: profileContext.effectiveParse.crsTransformEnabled,
        crsProjectionModel: profileContext.effectiveParse.crsProjectionModel,
        crsLabel: profileContext.effectiveParse.crsLabel,
        crsGridScaleEnabled: profileContext.effectiveParse.crsGridScaleEnabled,
        crsGridScaleFactor: profileContext.effectiveParse.crsGridScaleFactor,
        crsConvergenceEnabled: profileContext.effectiveParse.crsConvergenceEnabled,
        crsConvergenceAngleRad: profileContext.effectiveParse.crsConvergenceAngleRad,
        geoidModelEnabled: profileContext.effectiveParse.geoidModelEnabled,
        geoidModelId: profileContext.effectiveParse.geoidModelId,
        geoidSourceFormat: profileContext.effectiveParse.geoidSourceFormat,
        geoidSourcePath: profileContext.effectiveParse.geoidSourcePath,
        geoidInterpolation: profileContext.effectiveParse.geoidInterpolation,
        geoidHeightConversionEnabled: profileContext.effectiveParse.geoidHeightConversionEnabled,
        geoidOutputHeightDatum: profileContext.effectiveParse.geoidOutputHeightDatum,
        gpsLoopCheckEnabled: profileContext.effectiveParse.gpsLoopCheckEnabled,
        gpsAddHiHtEnabled: profileContext.effectiveParse.gpsAddHiHtEnabled,
        gpsAddHiHtHiM: profileContext.effectiveParse.gpsAddHiHtHiM,
        gpsAddHiHtHtM: profileContext.effectiveParse.gpsAddHiHtHtM,
        qFixLinearSigmaM: profileContext.effectiveParse.qFixLinearSigmaM,
        qFixAngularSigmaSec: profileContext.effectiveParse.qFixAngularSigmaSec,
        prismEnabled: profileContext.effectiveParse.prismEnabled,
        prismOffset: profileContext.effectiveParse.prismOffset,
        prismScope: profileContext.effectiveParse.prismScope,
        descriptionReconcileMode: profileContext.effectiveParse.descriptionReconcileMode,
        descriptionAppendDelimiter: profileContext.effectiveParse.descriptionAppendDelimiter,
        lonSign: profileContext.effectiveParse.lonSign,
        tsCorrelationEnabled: profileContext.effectiveParse.tsCorrelationEnabled,
        tsCorrelationRho: profileContext.effectiveParse.tsCorrelationRho,
        tsCorrelationScope: profileContext.effectiveParse.tsCorrelationScope,
        robustMode: profileContext.effectiveParse.robustMode,
        robustK: profileContext.effectiveParse.robustK,
        parseCompatibilityMode: profileContext.effectiveParse.parseCompatibilityMode,
        parseModeMigrated: profileContext.effectiveParse.parseModeMigrated,
        currentInstrument: profileContext.currentInstrument,
      },
    });

    const { buildResultsText } = createRunResultsTextBuilder({
      settings: baseSettings,
      parseSettings: baseParseSettings,
      runDiagnostics: null,
      levelLoopCustomPresets: [],
      buildRunDiagnostics,
    });

    const report = buildResultsText(result);

    expect(report).toContain('# WebNet Adjustment Results');
    expect(report).toContain('--- Solve Profile Diagnostics ---');
    expect(report).toContain('--- Adjusted Coordinates ---');
    expect(report).toContain('--- Observations & Residuals ---');
    expect(report).toContain('--- Processing Log ---');
    expect(report).toContain('QFIX constants: linear=1.000000e-7 m, angular=1.000100e-3"');
    expect(report).toContain('Solve timing (ms): total=');
    expect(report).not.toContain('CRS transforms:');

    const normalizedPrefix = report
      .replace(/^# Generated: .*$/m, '# Generated: <normalized>')
      .split('\n')
      .slice(0, 8);

    expect(normalizedPrefix[0]).toBe('# WebNet Adjustment Results');
    expect(normalizedPrefix[1]).toBe('# Generated: <normalized>');
    expect(normalizedPrefix[2]).toBe('# Linear units: m');
    expect(normalizedPrefix[3]).toContain('profile=industry-parity');
    expect(normalizedPrefix[3]).toContain('dirSets=raw');
    expect(normalizedPrefix[4]).toContain('profileFallback=ON');
    expect(normalizedPrefix[6]).toBe('--- Solve Profile Diagnostics ---');
  });
});

