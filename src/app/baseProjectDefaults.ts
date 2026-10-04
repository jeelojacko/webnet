import {
  DEFAULT_ADJUSTED_POINTS_EXPORT_SETTINGS,
  cloneAdjustedPointsExportSettings,
} from '../engine/adjustedPointsExport';
import {
  DEFAULT_PREANALYSIS_ACCURACY_THRESHOLD_METERS,
  DEFAULT_PREANALYSIS_MAX_ADDED_SETS,
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
  DEFAULT_UI_THEME,
} from './appHelpers';
import type { ParseSettings, SettingsState } from '../appStateTypes';
import type { AdjustedPointsExportSettings } from '../types';

/**
 * Pure application factory defaults. This module MUST NOT import the startup
 * seed config: the blank-project factory builds from these base values only,
 * so no example/startup patch may leak in through the module graph.
 * Startup seeding lives in AppInitialState.ts (base + patch).
 */
export const createBaseSettingsState = (): SettingsState => {
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
  };
  return {
    ...seed,
    listingSortObservationsBy: normalizeListingSortObservationsBy(seed.listingSortObservationsBy, {
      legacyResidualMeansStdResidual: true,
    }),
  };
};

export const createBaseParseSettings = (): ParseSettings => ({
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
  preanalysisAccuracyThresholdMeters: DEFAULT_PREANALYSIS_ACCURACY_THRESHOLD_METERS,
  preanalysisMaxAddedSets: DEFAULT_PREANALYSIS_MAX_ADDED_SETS,
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
});

export const createInitialAdjustedPointsExportSettings =
  (): AdjustedPointsExportSettings =>
    cloneAdjustedPointsExportSettings({
      ...DEFAULT_ADJUSTED_POINTS_EXPORT_SETTINGS,
      includeLostStations: true,
    });
