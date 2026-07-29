import type {
  AdjustedPointsExportSettings,
  CustomLevelLoopTolerancePreset,
  InstrumentLibrary,
  PlanningMapState,
  ProjectExportFormat,
} from '../types';
import type { PersistedSavedRunSnapshot } from '../appStateTypes';
import type { SurveyCadPersistedState } from './cad/cadTypes';

export type ProjectStorageBackend = 'opfs' | 'indexeddb';
export type ProjectSourceFileKind = 'dat' | 'control' | 'notes' | 'report' | 'other';

export interface ProjectIndexRow {
  id: string;
  name: string;
  backend: ProjectStorageBackend;
  rootKey: string;
  schemaVersion: number;
  createdAt: string;
  updatedAt: string;
  lastOpenedAt: string;
  starred?: boolean;
}

export interface ProjectStorageStatus {
  hasOpfs: boolean;
  hasIndexedDb: boolean;
  canPersist: boolean;
  persisted: boolean | null;
  preferredBackend: ProjectStorageBackend;
}

export interface ProjectManifestFileEntry {
  id: string;
  name: string;
  kind: ProjectSourceFileKind;
  path: string;
  enabled: boolean;
  order: number;
  size?: number;
  createdAt?: string;
  updatedAt?: string;
  modifiedAt?: string;
}

export interface ProjectManifestWorkspaceState {
  openFileIds: string[];
  focusedFileId?: string;
  mainFileId?: string;
  fileListCollapsed?: boolean;
}

export interface ProjectManifestUiPayload {
  settings: Record<string, unknown>;
  parseSettings: Record<string, unknown>;
  exportFormat: ProjectExportFormat;
  adjustedPointsExport: AdjustedPointsExportSettings;
  planningMap?: PlanningMapState;
  geoidSourceDataBase64?: string | null;
  geoidSourceDataLabel?: string;
  migration?: {
    parseModeMigrated: boolean;
    migratedAt?: string;
    listingSortModeVersion?: number;
  };
}

export interface ProjectManifestProjectPayload {
  projectInstruments: InstrumentLibrary;
  selectedInstrument: string;
  levelLoopCustomPresets: CustomLevelLoopTolerancePreset[];
  surveyCad?: SurveyCadPersistedState;
}

interface ProjectManifestV5Base {
  kind: 'webnet-project';
  schemaVersion: 5;
  projectId: string;
  name: string;
  createdAt: string;
  updatedAt: string;
  files: ProjectManifestFileEntry[];
  ui: ProjectManifestUiPayload;
  project: ProjectManifestProjectPayload;
  workspace?: ProjectManifestWorkspaceState;
}

export interface WebNetProjectManifestV5 extends ProjectManifestV5Base {
  storageLayout: 'manifest';
}

export interface WebNetPortableProjectFileV5 extends ProjectManifestV5Base {
  storageLayout: 'portable';
  fileContents: Record<string, string>;
  savedRuns?: PersistedSavedRunSnapshot[];
}

export interface ProjectSessionState {
  indexRow: ProjectIndexRow;
  manifest: WebNetProjectManifestV5;
  sourceTexts: Record<string, string>;
  dirtyFileIds: string[];
  manifestDirty: boolean;
  autosaveState: 'idle' | 'saving' | 'error';
  lastAutosavedAt?: string | null;
  lastAutosaveError?: string | null;
}

export interface ProjectRunFile {
  fileId: string;
  name: string;
  order: number;
  content: string;
}
