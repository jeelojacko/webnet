import { DEFAULT_INPUT } from '../defaultInput';
import {
  DEFAULT_ADJUSTED_POINTS_EXPORT_SETTINGS,
  cloneAdjustedPointsExportSettings,
} from '../engine/adjustedPointsExport';
import {
  DEFAULT_QFIX_ANGULAR_SIGMA_SEC,
  DEFAULT_QFIX_LINEAR_SIGMA_M,
} from '../engine/defaults';
import {
  DEFAULT_CANADA_CRS_ID,
} from '../engine/crsCatalog';
import {
  DEFAULT_LISTING_SORT_OBSERVATIONS_BY,
  normalizeListingSortObservationsBy,
} from '../listingSortObservations';
import {
  ACTIVE_PARITY_STARTUP_DEFAULTS,
} from './appConfig';
import {
  DEFAULT_UI_THEME,
  createDefaultS9Instrument,
  parseInstrumentLibraryFromInput,
} from './appHelpers';
import type { ParseSettings, SettingsState } from '../appStateTypes';
import type { AdjustedPointsExportSettings, InstrumentLibrary } from '../types';

export const createInitialSettingsState = (): SettingsState => {
  const seed: SettingsState = {
    maxIterations: 10,
    convergenceLimit: 0.001,
    precisionReportingMode: 'industry-standard',
    units: 'm',
    uiTheme: DEFAULT_UI_THEME,
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
    listingSortObservationsBy: DEFAULT_LISTING_SORT_OBSERVATIONS_BY,
    listingObservationLimit: 60,
    ...ACTIVE_PARITY_STARTUP_DEFAULTS?.settingsPatch,
  };
  return {
    ...seed,
    listingSortObservationsBy: normalizeListingSortObservationsBy(seed.listingSortObservationsBy, {
      legacyResidualMeansStdResidual: true,
    }),
  };
};

export const createInitialParseSettings = (): ParseSettings => ({
  solveProfile: 'industry-parity',
  coordMode: '3D',
  coordSystemMode: 'local',
  crsId: DEFAULT_CANADA_CRS_ID,
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
  preanalysisAccuracyThresholdMeters: 0.001,
  preanalysisMaxAddedSets: 5,
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
  positionalToleranceEnabled: false,
  positionalToleranceConstantMm: 0,
  positionalTolerancePpm: 0,
  positionalToleranceConfidencePercent: 95,
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
  ...ACTIVE_PARITY_STARTUP_DEFAULTS?.parseSettingsPatch,
});

export const createInitialProjectInstruments = (): InstrumentLibrary => ({
  S9: createDefaultS9Instrument(),
  ...(ACTIVE_PARITY_STARTUP_DEFAULTS?.projectInstruments ?? {}),
  ...parseInstrumentLibraryFromInput(ACTIVE_PARITY_STARTUP_DEFAULTS?.input ?? DEFAULT_INPUT),
});

export const createInitialAdjustedPointsExportSettings =
  (): AdjustedPointsExportSettings =>
    cloneAdjustedPointsExportSettings({
      ...DEFAULT_ADJUSTED_POINTS_EXPORT_SETTINGS,
      includeLostStations: true,
    });
