import {
  DEFAULT_ADJUSTED_POINTS_EXPORT_SETTINGS,
  sanitizeAdjustedPointsExportSettings,
} from '../../src/engine/adjustedPointsExport';
import { parseProjectFile, serializeProjectFile } from '../../src/engine/projectFile';
import type { RunSettingsSnapshot } from '../../src/appStateTypes';
import type { AdjustmentResult, InstrumentLibrary } from '../../src/types';
import type { SurveyCadPersistedState } from '../../src/engine/cad/cadTypes';

export {
  DEFAULT_ADJUSTED_POINTS_EXPORT_SETTINGS,
  parseProjectFile,
  sanitizeAdjustedPointsExportSettings,
  serializeProjectFile,
};
export type { RunSettingsSnapshot };
export const savedRunResult = {
  success: true,
  converged: true,
  iterations: 2,
  seuw: 1.05,
  dof: 8,
  stations: {
    A: { x: 0, y: 0, h: 0, fixed: true },
  },
  observations: [],
  logs: [],
} as unknown as AdjustmentResult;

export const defaults = {
  settings: {
    maxIterations: 10,
    convergenceLimit: 0.01,
    precisionReportingMode: 'industry-standard',
    units: 'm',
    listingShowLostStations: true,
    listingSortObservationsBy: 'stdResidual',
  },
  parseSettings: {
    solveProfile: 'industry-parity',
    coordMode: '3D',
    coordSystemMode: 'local',
    crsId: 'LOCAL',
    localDatumScheme: 'average-scale',
    averageScaleFactor: 1,
    commonElevation: 0,
    averageGeoidHeight: 0,
    gridBearingMode: 'measured',
    gridDistanceMode: 'measured',
    gridAngleMode: 'measured',
    gridDirectionMode: 'measured',
    geoidModelEnabled: false,
    geoidModelId: 'NGS-DEMO',
    geoidSourceFormat: 'builtin',
    geoidSourcePath: '',
    geoidInterpolation: 'bilinear',
    geoidHeightConversionEnabled: false,
    geoidOutputHeightDatum: 'orthometric',
    order: 'EN',
    angleUnits: 'dms',
    parseCompatibilityMode: 'strict',
    parseModeMigrated: true,
  },
  exportFormat: 'webnet' as const,
  adjustedPointsExport: DEFAULT_ADJUSTED_POINTS_EXPORT_SETTINGS,
  projectInstruments: {
    S9: {
      code: 'S9',
      desc: 'industry standard S9',
      edm_const: 0.001,
      edm_ppm: 1,
      hzPrecision_sec: 0.5,
      dirPrecision_sec: 0.5,
      azBearingPrecision_sec: 0.5,
      vaPrecision_sec: 0.5,
      instCentr_m: 0.0007,
      tgtCentr_m: 0,
      vertCentr_m: 0,
      elevDiff_const_m: 0,
      elevDiff_ppm: 0,
      gpsStd_xy: 0,
      levStd_mmPerKm: 0,
    },
  } as InstrumentLibrary,
  selectedInstrument: 'S9',
  levelLoopCustomPresets: [{ id: 'c1', name: 'Custom 1', baseMm: 2, perSqrtKmMm: 5 }],
};

export const surveyCadState: SurveyCadPersistedState = {
  version: 1,
  sourceSignature: 'base-project-signature',
  project: {
    version: 2,
    id: 'cad-project-1',
    name: 'Survey CAD Project',
    metadata: {
      source: 'parsed-input',
      runMode: 'adjustment',
      units: 'm',
      stationCount: 1,
      observationCount: 0,
      adjustedStationCount: 0,
    },
    layers: [
      {
        id: 'parcels',
        name: 'Parcels',
        color: '#f59e0b',
        visible: true,
        locked: false,
        role: 'planning',
      },
    ],
    styleLibrary: {
      lineTypes: [{ id: 'continuous', name: 'Continuous', dashPattern: [] }],
      textStyles: [{ id: 'label', name: 'Label', fontFamily: 'monospace', fontSize: 12 }],
      pointSymbols: [{ id: 'point', name: 'Point', radius: 2 }],
      styles: [{ id: 'parcel-style', name: 'Parcel', color: '#f59e0b', strokeWidth: 1.5 }],
    },
    entities: [
      {
        id: 'parcel-1',
        type: 'parcel',
        layerId: 'parcels',
        styleId: 'parcel-style',
        visible: true,
        locked: false,
        vertices: [
          { x: 0, y: 0 },
          { x: 100, y: 0 },
          { x: 100, y: 40 },
        ],
        vertexLabels: ['A', 'B', 'C'],
        parcelName: 'Lot 1',
        areaSquareMeters: 2000,
        perimeterMeters: 240,
      },
    ],
    cogoComputations: [],
    bounds: { minX: 0, minY: 0, maxX: 100, maxY: 40 },
  },
};
