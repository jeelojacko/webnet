import type {
  Dispatch,
  RefObject,
  SetStateAction,
} from 'react';
import type {
  ParseSettings,
  PersistedSavedRunSnapshot,
  SettingsState,
  SolveProfile,
} from '../appStateTypes';
import type { CadDrawingDocument } from '../engine/cad/cadTypes';
import type {
  AdjustedPointsExportSettings,
  CustomLevelLoopTolerancePreset,
  InstrumentLibrary,
  ObservationModeSettings,
  PlanningMapState,
  ProjectExportFormat,
} from '../types';

export interface ImportNotice {
  title: string;
  detailLines: string[];
}

export interface UseProjectFileWorkflowArgs {
  projectFileInputRef: RefObject<HTMLInputElement | null>;
  projectSourceFileInputRef: RefObject<HTMLInputElement | null>;
  input: string;
  projectIncludeFiles: Record<string, string>;
  settings: SettingsState;
  parseSettings: ParseSettings;
  geoidSourceData?: Uint8Array | null;
  geoidSourceDataLabel?: string;
  exportFormat: ProjectExportFormat;
  adjustedPointsExportSettings: AdjustedPointsExportSettings;
  planningMap?: PlanningMapState;
  surveyCadState?: CadDrawingDocument | null;
  savedRunSnapshots: PersistedSavedRunSnapshot[];
  projectInstruments: InstrumentLibrary;
  selectedInstrument: string;
  levelLoopCustomPresets: CustomLevelLoopTolerancePreset[];
  setInput: Dispatch<SetStateAction<string>>;
  setProjectIncludeFiles: Dispatch<SetStateAction<Record<string, string>>>;
  setSettings: Dispatch<SetStateAction<SettingsState>>;
  setParseSettings: Dispatch<SetStateAction<ParseSettings>>;
  setGeoidSourceData: Dispatch<SetStateAction<Uint8Array | null>>;
  setGeoidSourceDataLabel: Dispatch<SetStateAction<string>>;
  setExportFormat: Dispatch<SetStateAction<ProjectExportFormat>>;
  setAdjustedPointsExportSettings: Dispatch<SetStateAction<AdjustedPointsExportSettings>>;
  setPlanningMap?: Dispatch<SetStateAction<PlanningMapState>>;
  setSurveyCadState?: Dispatch<SetStateAction<CadDrawingDocument | null>>;
  setProjectInstruments: Dispatch<SetStateAction<InstrumentLibrary>>;
  setSelectedInstrument: Dispatch<SetStateAction<string>>;
  setLevelLoopCustomPresets: Dispatch<SetStateAction<CustomLevelLoopTolerancePreset[]>>;
  setSettingsDraft: Dispatch<SetStateAction<SettingsState>>;
  setParseSettingsDraft: Dispatch<SetStateAction<ParseSettings>>;
  setGeoidSourceDataDraft: Dispatch<SetStateAction<Uint8Array | null>>;
  setGeoidSourceDataLabelDraft: Dispatch<SetStateAction<string>>;
  setProjectInstrumentsDraft: Dispatch<SetStateAction<InstrumentLibrary>>;
  setSelectedInstrumentDraft: Dispatch<SetStateAction<string>>;
  setLevelLoopCustomPresetsDraft: Dispatch<SetStateAction<CustomLevelLoopTolerancePreset[]>>;
  setAdjustedPointsExportSettingsDraft: Dispatch<SetStateAction<AdjustedPointsExportSettings>>;
  setIsAdjustedPointsTransformSelectOpen: Dispatch<SetStateAction<boolean>>;
  setAdjustedPointsTransformSelectedDraft: Dispatch<SetStateAction<string[]>>;
  setImportNotice: Dispatch<SetStateAction<ImportNotice | null>>;
  resetWorkspaceAfterProjectLoad: () => void;
  restoreSavedRunSnapshots: (_snapshots: PersistedSavedRunSnapshot[]) => void;
  normalizeUiTheme: (_value: unknown) => SettingsState['uiTheme'];
  normalizeSolveProfile: (_profile: SolveProfile) => SolveProfile;
  buildObservationModeFromGridFields: (_state: {
    gridBearingMode: ParseSettings['gridBearingMode'];
    gridDistanceMode: ParseSettings['gridDistanceMode'];
    gridAngleMode: ParseSettings['gridAngleMode'];
    gridDirectionMode: ParseSettings['gridDirectionMode'];
  }) => ObservationModeSettings;
  cloneInstrumentLibrary: (_library: InstrumentLibrary) => InstrumentLibrary;
}
