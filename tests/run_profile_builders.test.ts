import { describe, expect, it } from 'vitest';

import {
  DEFAULT_QFIX_ANGULAR_SIGMA_SEC,
  DEFAULT_QFIX_LINEAR_SIGMA_M,
} from '../src/engine/defaults';
import { createRunProfileBuilders } from '../src/engine/runProfileBuilders';
import type { ParseSettings, SolveProfile } from '../src/appStateTypes';
import type {
  AdjustmentResult,
  Instrument,
  InstrumentLibrary,
  Observation,
} from '../src/types';

const baseParseSettings: ParseSettings = {
  solveProfile: 'industry-parity-current',
  coordMode: '3D',
  coordSystemMode: 'local',
  crsId: 'LOCAL',
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
  qFixLinearSigmaM: DEFAULT_QFIX_LINEAR_SIGMA_M,
  qFixAngularSigmaSec: DEFAULT_QFIX_ANGULAR_SIGMA_SEC,
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

const normalizeSolveProfile = (
  profile: SolveProfile,
): Exclude<SolveProfile, 'industry-parity'> =>
  profile === 'industry-parity' ? 'industry-parity-current' : profile;

describe('createRunProfileBuilders', () => {
  it('applies parity defaults and fallback instrument selection in profile context', () => {
    const projectInstruments: InstrumentLibrary = {
      T1: {
        ...s9Instrument,
        code: 'T1',
        desc: 'Test Instrument',
      },
    };
    const { resolveProfileContext } = createRunProfileBuilders({
      projectInstruments,
      selectedInstrument: 'UNKNOWN',
      defaultIndustryInstrumentCode: 'S9',
      defaultIndustryInstrument: s9Instrument,
      normalizeSolveProfile,
    });

    const context = resolveProfileContext({
      ...baseParseSettings,
      runMode: 'preanalysis',
      preanalysisMode: true,
      robustMode: 'huber',
      autoAdjustEnabled: true,
    });

    expect(context.parity).toBe(true);
    expect(context.directionSetMode).toBe('raw');
    expect(context.currentInstrument).toBe('S9');
    expect(context.effectiveInstrumentLibrary.S9?.code).toBe('S9');
    expect(context.effectiveParse.robustMode).toBe('none');
    expect(context.effectiveParse.autoAdjustEnabled).toBe(false);
    expect(context.effectiveParse.runMode).toBe('preanalysis');
  });

  it('builds run diagnostics from parse-state overrides and default-sigma usage', () => {
    const projectInstruments: InstrumentLibrary = {
      T1: {
        ...s9Instrument,
        code: 'T1',
        desc: 'Test Instrument',
      },
    };
    const { buildRunDiagnostics } = createRunProfileBuilders({
      projectInstruments,
      selectedInstrument: 'T1',
      defaultIndustryInstrumentCode: 'S9',
      defaultIndustryInstrument: s9Instrument,
      normalizeSolveProfile,
    });

    const solved = {
      parseState: {
        ...baseParseSettings,
        runMode: 'data-check',
        coordSystemMode: 'grid',
        crsId: 'EPSG:26920',
        qFixLinearSigmaM: 2e-7,
        qFixAngularSigmaSec: 0.002,
        parsedUsageSummary: 'parsed summary',
        usedInSolveUsageSummary: 'solve summary',
        currentInstrument: 'T1',
      },
      observations: [
        { type: 'dist', sigmaSource: 'default' } as Observation,
        { type: 'angle', sigmaSource: 'explicit' } as Observation,
      ],
    } as unknown as AdjustmentResult;

    const diagnostics = buildRunDiagnostics(baseParseSettings, solved);

    expect(diagnostics.runMode).toBe('data-check');
    expect(diagnostics.coordSystemMode).toBe('grid');
    expect(diagnostics.crsId).toBe('EPSG:26920');
    expect(diagnostics.defaultSigmaCount).toBe(1);
    expect(diagnostics.defaultSigmaByType).toBe('dist=1');
    expect(diagnostics.qFixLinearSigmaM).toBe(2e-7);
    expect(diagnostics.qFixAngularSigmaSec).toBe(0.002);
    expect(diagnostics.profileDefaultInstrumentFallback).toBe(true);
    expect(diagnostics.parsedUsageSummary).toBe('parsed summary');
    expect(diagnostics.usedInSolveUsageSummary).toBe('solve summary');
    expect(diagnostics.stochasticDefaultsSummary).toContain('inst=T1');
  });
});
