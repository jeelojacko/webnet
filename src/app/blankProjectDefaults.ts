import { cloneAdjustedPointsExportSettings } from '../engine/adjustedPointsExport';
import { clonePlanningMapState, DEFAULT_PLANNING_MAP_STATE } from '../engine/planningMapState';
import type { ProjectFlatWorkspacePayloadOptions } from '../hooks/projectFilePayloadBuilders';
import {
  createInitialAdjustedPointsExportSettings,
  createInitialParseSettings,
  createInitialSettingsState,
} from './AppInitialState';

/**
 * Canonical blank workspace for "Create new project".
 * Explicit overrides (not camp values): Adjustment mode, local/no-CRS,
 * empty instruments, all GPS/geoid/CRS-transform flags off + zeroed.
 */
export const buildBlankProjectWorkspace = (): ProjectFlatWorkspacePayloadOptions => ({
  input: '',
  includeFiles: {},
  settings: createInitialSettingsState(),
  parseSettings: {
    ...createInitialParseSettings(),
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
    geoidModelEnabled: false,
    geoidModelId: '',
    geoidSourceFormat: 'builtin',
    geoidSourcePath: '',
    geoidInterpolation: 'bilinear',
    geoidHeightConversionEnabled: false,
    geoidOutputHeightDatum: 'orthometric',
    gpsLoopCheckEnabled: false,
    gpsAddHiHtEnabled: false,
    gpsAddHiHtHiM: 0,
    gpsAddHiHtHtM: 0,
    verticalDeflectionNorthSec: 0,
    verticalDeflectionEastSec: 0,
    averageGeoidHeight: 0,
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
