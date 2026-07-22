import type { InstrumentLibrary } from './typesBase';

export type GeoidInterpolationMethod = 'bilinear' | 'nearest';
export type GeoidHeightDatum = 'orthometric' | 'ellipsoid';
export type GeoidSourceFormat = 'builtin' | 'gtx' | 'byn';
export type GpsVectorMode = 'network' | 'sideshot';
export type GpsWeightingMode = 'standard' | 'covariance';
export type ProjectExportFormat =
  | 'points'
  | 'points-csv'
  | 'observations-csv'
  | 'geojson'
  | 'webnet'
  | 'industry-style'
  | 'landxml'
  | 'bundle-qa-standard'
  | 'bundle-qa-standard-with-landxml';
export type AdjustedPointsColumnId = 'P' | 'N' | 'E' | 'Z' | 'D' | 'LAT' | 'LON' | 'EL';
export type AdjustedPointsDelimiter = 'comma' | 'space' | 'tab';
export type AdjustedPointsOutputFormat = 'csv' | 'text';
export type AdjustedPointsPresetId = 'PNEZD' | 'PENZD' | 'PNEZ' | 'PENZ' | 'NEZ' | 'PEN' | 'custom';
export type AdjustedPointsTransformScope = 'all' | 'selected';
export type AdjustedPointsRotationScope = AdjustedPointsTransformScope;
export type AdjustedPointsTranslationMethod = 'direction-distance' | 'anchor-coordinate';

export interface AdjustedPointsRotationTransformSettings {
  enabled: boolean;
  angleDeg: number;
}

export interface AdjustedPointsTranslationTransformSettings {
  enabled: boolean;
  method: AdjustedPointsTranslationMethod;
  azimuthDeg: number;
  distance: number;
  targetE: number;
  targetN: number;
}

export interface AdjustedPointsScaleTransformSettings {
  enabled: boolean;
  factor: number;
}

export interface AdjustedPointsTransformSettings {
  referenceStationId: string;
  scope: AdjustedPointsTransformScope;
  selectedStationIds: string[];
  rotation: AdjustedPointsRotationTransformSettings;
  translation: AdjustedPointsTranslationTransformSettings;
  scale: AdjustedPointsScaleTransformSettings;
}

export interface AdjustedPointsExportSettings {
  format: AdjustedPointsOutputFormat;
  delimiter: AdjustedPointsDelimiter;
  columns: AdjustedPointsColumnId[];
  presetId: AdjustedPointsPresetId;
  includeLostStations: boolean;
  transform: AdjustedPointsTransformSettings;
}

export interface CustomLevelLoopTolerancePreset {
  id: string;
  name: string;
  baseMm: number;
  perSqrtKmMm: number;
}

export interface WebNetProjectFileV1 {
  kind: 'webnet-project';
  schemaVersion: 1;
  savedAt: string;
  input: string;
  ui: {
    settings: Record<string, unknown>;
    parseSettings: Record<string, unknown>;
    exportFormat: ProjectExportFormat;
    adjustedPointsExport: AdjustedPointsExportSettings;
  };
  project: {
    projectInstruments: InstrumentLibrary;
    selectedInstrument: string;
    levelLoopCustomPresets: CustomLevelLoopTolerancePreset[];
  };
}

export interface WebNetProjectFileV2 {
  kind: 'webnet-project';
  schemaVersion: 2;
  savedAt: string;
  input: string;
  ui: {
    settings: Record<string, unknown>;
    parseSettings: Record<string, unknown>;
    exportFormat: ProjectExportFormat;
    adjustedPointsExport: AdjustedPointsExportSettings;
    migration?: {
      parseModeMigrated?: boolean;
      migratedAt?: string;
      listingSortModeVersion?: number;
    };
  };
  project: {
    projectInstruments: InstrumentLibrary;
    selectedInstrument: string;
    levelLoopCustomPresets: CustomLevelLoopTolerancePreset[];
  };
}

export interface WebNetProjectFileV3 {
  kind: 'webnet-project';
  schemaVersion: 3;
  savedAt: string;
  mainInput: string;
  includeFiles: Record<string, string>;
  savedRuns?: unknown[];
  ui: {
    settings: Record<string, unknown>;
    parseSettings: Record<string, unknown>;
    exportFormat: ProjectExportFormat;
    adjustedPointsExport: AdjustedPointsExportSettings;
    migration?: {
      parseModeMigrated?: boolean;
      migratedAt?: string;
      listingSortModeVersion?: number;
    };
  };
  project: {
    projectInstruments: InstrumentLibrary;
    selectedInstrument: string;
    levelLoopCustomPresets: CustomLevelLoopTolerancePreset[];
  };
}
