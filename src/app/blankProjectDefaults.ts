import { cloneAdjustedPointsExportSettings } from '../engine/adjustedPointsExport';
import { clonePlanningMapState, DEFAULT_PLANNING_MAP_STATE } from '../engine/planningMapState';
import type { ProjectFlatWorkspacePayloadOptions } from '../hooks/projectFilePayloadBuilders';
import {
  createBaseParseSettings,
  createBaseSettingsState,
  createInitialAdjustedPointsExportSettings,
} from './baseProjectDefaults';

/**
 * Canonical blank workspace for "Create new project".
 * Built from BASE factories plus the old (baseline main 0b08ccda)
 * campDesignPreanalysis startup patch values below — never from the
 * Combined-seeded initial factories. Explicit blank overrides follow.
 */
export const buildBlankProjectWorkspace = (): ProjectFlatWorkspacePayloadOptions => ({
  input: '',
  includeFiles: {},
  settings: {
    ...createBaseSettingsState(),
    // Old Pre-analysis startup benign defaults (baseline main 0b08ccda).
    convergenceLimit: 0.01,
    maxIterations: 10,
  },
  parseSettings: {
    ...createBaseParseSettings(),
    // Old Pre-analysis startup benign defaults (baseline main 0b08ccda).
    coordMode: '3D',
    order: 'EN',
    deltaMode: 'slope',
    angleStationOrder: 'atfromto',
    lonSign: 'west-positive',
    applyCurvatureRefraction: true,
    verticalReduction: 'curvref',
    refractionCoefficient: 0.07,
    qFixLinearSigmaM: 1e-7,
    qFixAngularSigmaSec: 0.0010001,
    // Explicit blank overrides: Adjustment, local/no-CRS, neutral GPS/geoid.
    runMode: 'adjustment',
    preanalysisMode: false,
    coordSystemMode: 'local',
    crsId: '',
    crsTransformEnabled: false,
    crsProjectionModel: 'legacy-equirectangular',
    crsLabel: '',
    crsGridScaleEnabled: false,
    crsGridScaleFactor: 1,
    crsConvergenceEnabled: false,
    crsConvergenceAngleRad: 0,
    gnssVectorFrameDefault: 'gridNEU',
    gnssFrameConfirmed: false,
    verticalDeflectionNorthSec: 0,
    verticalDeflectionEastSec: 0,
    geoidModelEnabled: false,
    geoidModelId: '',
    geoidSourceFormat: 'builtin',
    geoidSourcePath: '',
    geoidInterpolation: 'bilinear',
    geoidHeightConversionEnabled: false,
    geoidOutputHeightDatum: 'orthometric',
    averageGeoidHeight: 0,
    gpsLoopCheckEnabled: false,
    gpsAddHiHtEnabled: false,
    gpsAddHiHtHiM: 0,
    gpsAddHiHtHtM: 0,
  },
  geoidSourceData: null,
  geoidSourceDataLabel: '',
  exportFormat: 'points',
  adjustedPointsExportSettings: cloneAdjustedPointsExportSettings(
    createInitialAdjustedPointsExportSettings(),
  ),
  planningMap: clonePlanningMapState(DEFAULT_PLANNING_MAP_STATE),
  projectInstruments: {},
  selectedInstrument: '',
  levelLoopCustomPresets: [],
  surveyCadState: null,
});
