import type React from 'react';
import type { Dispatch, MutableRefObject, RefObject, SetStateAction } from 'react';
import type { LEVEL_LOOP_TOLERANCE_PRESETS } from '../engine/levelLoopTolerance';
import type { ADJUSTED_POINTS_PRESET_COLUMNS } from '../engine/adjustedPointsExport';
import type { useProjectOptionsState } from './useProjectOptionsState';
import type {
  CrsCatalogGroupFilter,
  ParseSettings,
  ProjectOptionsTab,
  RunDiagnostics,
  SettingsState,
  SolveProfile,
  UiTheme,
} from '../appStateTypes';
import type {
  AdjustedPointsColumnId,
  AdjustedPointsExportSettings,
  AdjustedPointsPresetId,
  CustomLevelLoopTolerancePreset,
  GeoidSourceFormat,
  Instrument,
  ObservationModeSettings,
  ParseCompatibilityMode,
  ProjectExportFormat,
  RunMode,
} from '../types';
import type { CrsDefinition, CrsProjectionParam } from '../engine/crsCatalog';
import type { ProjectIndexRow, ProjectStorageStatus } from '../engine/projectWorkspace';
import type { ProjectWorkspaceFileView } from './useProjectFileWorkflow';

type SettingsCardProps = {
  title: string;
  tooltip: string;
  children: React.ReactNode;
  className?: string;
  disabled?: boolean;
};

type SettingsRowProps = {
  label: string;
  tooltip?: string;
  children: React.ReactNode;
  className?: string;
};

type SettingsToggleProps = {
  checked: boolean;
  disabled?: boolean;
  title: string;
  onChange: (_checked: boolean) => void;
};

type ProjectOptionTabOption = { id: ProjectOptionsTab; label: string };
type BuiltinGeoidModelOption = { id: string; label: string };
type CrsCatalogGroupOption = { id: string; label: string };

export type ProjectOptionsModalStaticContext = {
  ADJUSTED_POINTS_ALL_COLUMNS: AdjustedPointsColumnId[];
  ADJUSTED_POINTS_PRESET_COLUMNS: Partial<Record<AdjustedPointsPresetId, AdjustedPointsColumnId[]>>;
  BUILTIN_GEOID_MODEL_OPTIONS: BuiltinGeoidModelOption[];
  CRS_CATALOG_GROUP_OPTIONS: CrsCatalogGroupOption[];
  DEFAULT_QFIX_ANGULAR_SIGMA_SEC: number;
  DEFAULT_QFIX_LINEAR_SIGMA_M: number;
  FT_PER_M: number;
  Info: React.ComponentType<Record<string, unknown>>;
  LEVEL_LOOP_TOLERANCE_PRESETS: typeof LEVEL_LOOP_TOLERANCE_PRESETS;
  M_PER_FT: number;
  PROJECT_OPTION_SECTION_TOOLTIPS: Record<string, string>;
  PROJECT_OPTION_TABS: ProjectOptionTabOption[];
  PROJECT_OPTION_TAB_TOOLTIPS: Record<string, string>;
  RAD_TO_DEG: number;
  SETTINGS_TOOLTIPS: Record<string, string>;
  SettingsCard: React.ComponentType<SettingsCardProps>;
  SettingsRow: React.ComponentType<SettingsRowProps>;
  SettingsToggle: React.ComponentType<SettingsToggleProps>;
  getExportFormatExtension: (_format: ProjectExportFormat) => string;
  getExportFormatLabel: (_format: ProjectExportFormat) => string;
  getExportFormatTooltip: (_format: ProjectExportFormat) => string;
  normalizeUiTheme: (_value: unknown) => UiTheme;
  optionInputClass: string;
  optionLabelClass: string;
};

export type ProjectOptionsModalStaticContextInput =
  Partial<ProjectOptionsModalStaticContext> & Pick<ProjectOptionsModalStaticContext, 'FT_PER_M'>;

export type ProjectOptionsStateValue = ReturnType<typeof useProjectOptionsState>;

export type UseProjectOptionsModalControllerArgs = {
  projectOptionsState: ProjectOptionsStateValue;
  adjustedPointsDraftStationIds: string[];
  adjustedPointsTransformDraftValidationMessage: string | null;
  crsCatalogGroupCounts: Record<string, number>;
  filteredDraftCrsCatalog: CrsDefinition[];
  searchedDraftCrsCatalog: CrsDefinition[];
  visibleDraftCrsCatalog: CrsDefinition[];
  selectedDraftCrs?: CrsDefinition;
  selectedCrsProj4Params: CrsProjectionParam[];
  exportFormat: ProjectExportFormat;
  setExportFormat: Dispatch<SetStateAction<ProjectExportFormat>>;
  storageStatus?: ProjectStorageStatus | null;
  recentProjects?: ProjectIndexRow[];
  projectSession?: {
    manifest: {
      name: string;
    };
    indexRow: {
      backend: string;
      updatedAt: string;
    };
    autosaveState: string;
    lastAutosavedAt?: string | null;
  } | null;
  activeProjectFileViews?: ProjectWorkspaceFileView[];
  currentProjectFile?: {
    id: string;
    name: string;
  } | null;
  handleSaveProject: () => void;
  triggerProjectFileSelect: () => void;
  triggerProjectSourceFileSelect?: () => void;
  createLocalProjectFromCurrentWorkspace?: () => void;
  openProjectById?: (_projectId: string) => void;
  openPermanentExampleProject?: (_projectUrl: string) => void;
  deleteLocalProject?: (_projectId: string) => void;
  exportPortableProject?: () => void;
  exportProjectBundle?: () => void;
  createBlankProjectFile?: () => void;
  switchActiveProjectFile?: (_fileId: string) => void;
  renameProjectFile?: (_fileId: string) => void;
  toggleProjectFileEnabled?: (_fileId: string) => void;
  moveProjectFile?: (_fileId: string, _direction: 'up' | 'down') => void;
  removeProjectFile?: (_fileId: string) => void;
  geoidSourceFileInputRef: RefObject<HTMLInputElement | null>;
  settingsModalContentRef: RefObject<HTMLDivElement | null>;
  adjustedPointsDragRef: MutableRefObject<AdjustedPointsColumnId | null>;
  runDiagnostics: RunDiagnostics | null;
  normalizeSolveProfile: (_profile: SolveProfile) => SolveProfile;
  normalizeUiTheme: (_value: unknown) => UiTheme;
  buildObservationModeFromGridFields: (_state: {
    gridBearingMode: ParseSettings['gridBearingMode'];
    gridDistanceMode: ParseSettings['gridDistanceMode'];
    gridAngleMode: ParseSettings['gridAngleMode'];
    gridDirectionMode: ParseSettings['gridDirectionMode'];
  }) => ObservationModeSettings;
  createInstrument: (_code: string, _desc?: string) => Instrument;
  createCustomLevelLoopTolerancePreset: (
    _seed?: Partial<Omit<CustomLevelLoopTolerancePreset, 'id'>>,
  ) => CustomLevelLoopTolerancePreset;
  resolveLevelLoopTolerancePreset: (
    _presets: CustomLevelLoopTolerancePreset[],
    _baseMm: number,
    _perSqrtKmMm: number,
  ) => {
    id: string;
    label: string;
    description: string;
  };
  staticContext: ProjectOptionsModalStaticContextInput;
};

export type {
  AdjustedPointsColumnId,
  AdjustedPointsExportSettings,
  AdjustedPointsPresetId,
  CrsCatalogGroupFilter,
  CustomLevelLoopTolerancePreset,
  GeoidSourceFormat,
  Instrument,
  ObservationModeSettings,
  ParseCompatibilityMode,
  ParseSettings,
  SettingsState,
  SolveProfile,
};
