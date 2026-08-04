import type { ParseSettings, SettingsState, SolveProfile } from '../../src/appStateTypes';
import type {
  CustomLevelLoopTolerancePreset,
  Instrument,
  InstrumentLibrary,
} from '../../src/types';
export const baseSettings: SettingsState = {
  maxIterations: 10,
  convergenceLimit: 0.01,
  units: 'm',
  uiTheme: 'gruvbox-dark',
  mapShowLostStations: true,
  map3dEnabled: false,
  showRunComparisonPanel: false,
  showReviewQueuePanel: false,
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

export const baseParseSettings: ParseSettings = {
  solveProfile: 'industry-parity',
  coordMode: '3D',
  coordSystemMode: 'local',
  crsId: 'LOCAL',
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
  autoAdjustEnabled: true,
  autoAdjustMaxCycles: 3,
  autoAdjustMaxRemovalsPerCycle: 1,
  autoAdjustStdResThreshold: 3,
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
  levelLoopToleranceBaseMm: 4,
  levelLoopTolerancePerSqrtKmMm: 2,
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
  directionSetMode: 'reduced',
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

export const cloneInstrumentLibrary = (library: InstrumentLibrary): InstrumentLibrary => {
  const next: InstrumentLibrary = {};
  Object.entries(library).forEach(([code, instrument]) => {
    next[code] = { ...instrument };
  });
  return next;
};

export const createInstrument = (code: string, desc = ''): Instrument => ({
  code,
  desc,
  edm_const: 0,
  edm_ppm: 0,
  hzPrecision_sec: 0,
  dirPrecision_sec: 0,
  azBearingPrecision_sec: 0,
  vaPrecision_sec: 0,
  instCentr_m: 0,
  tgtCentr_m: 0,
  vertCentr_m: 0,
  elevDiff_const_m: 0,
  elevDiff_ppm: 0,
  gpsStd_xy: 0,
  levStd_mmPerKm: 0,
});

export const normalizeUiTheme = (value: unknown): SettingsState['uiTheme'] => {
  if (value === 'gruvbox-light') return 'gruvbox-light';
  if (value === 'catppuccin-mocha') return 'catppuccin-mocha';
  if (value === 'catppuccin-latte') return 'catppuccin-latte';
  return 'gruvbox-dark';
};

export const normalizeSolveProfile = (_profile: SolveProfile): SolveProfile => 'industry-parity';

export const createCustomLevelLoopTolerancePreset = (
  seed?: Partial<Omit<CustomLevelLoopTolerancePreset, 'id'>>,
): CustomLevelLoopTolerancePreset => ({
  id: 'custom-seed',
  name: seed?.name?.trim() || 'Custom Preset',
  baseMm: seed?.baseMm ?? 0,
  perSqrtKmMm: seed?.perSqrtKmMm ?? 4,
});

export const resolveLevelLoopTolerancePreset = (
  _presets: CustomLevelLoopTolerancePreset[],
  _baseMm: number,
  _perSqrtKmMm: number,
) => ({
  id: 'custom',
  label: 'Custom',
  description: 'Custom tolerance model.',
});
