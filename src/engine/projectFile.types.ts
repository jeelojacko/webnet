import type {
  AdjustedPointsExportSettings,
  CustomLevelLoopTolerancePreset,
  InstrumentLibrary,
  ProjectExportFormat,
} from '../types';
import type { PersistedSavedRunSnapshot } from '../appStateTypes';
import type { ProjectManifestFileEntry } from './projectWorkspace';

export interface ProjectFileDefaults {
  settings: Record<string, unknown>;
  parseSettings: Record<string, unknown>;
  exportFormat: ProjectExportFormat;
  adjustedPointsExport: AdjustedPointsExportSettings;
  projectInstruments: InstrumentLibrary;
  selectedInstrument: string;
  levelLoopCustomPresets: CustomLevelLoopTolerancePreset[];
}

export interface ParsedProjectPayload {
  schemaVersion?: 5;
  input: string;
  includeFiles: Record<string, string>;
  workspaceFileContents?: Record<string, string>;
  savedRuns: PersistedSavedRunSnapshot[];
  ui: {
    settings: Record<string, unknown>;
    parseSettings: Record<string, unknown>;
    exportFormat: ProjectExportFormat;
    adjustedPointsExport: AdjustedPointsExportSettings;
    planningMap?: import('../types').PlanningMapState;
    geoidSourceDataBase64?: string | null;
    geoidSourceDataLabel?: string;
    migration?: {
      parseModeMigrated: boolean;
      migratedAt?: string;
      listingSortModeVersion?: number;
    };
  };
  project: {
    projectInstruments: InstrumentLibrary;
    selectedInstrument: string;
    levelLoopCustomPresets: CustomLevelLoopTolerancePreset[];
    surveyCad?: import('./cad/cadTypes').SurveyCadPersistedState;
  };
  workspace?: {
    projectId: string;
    name: string;
    createdAt: string;
    updatedAt: string;
    files: ProjectManifestFileEntry[];
    openFileIds: string[];
    focusedFileId?: string;
    mainFileId?: string;
  };
}

export type ParseProjectFileResult =
  | { ok: true; project: ParsedProjectPayload }
  | { ok: false; errors: string[] };
