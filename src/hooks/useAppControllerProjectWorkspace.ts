import { useAppProjectImportWorkspace } from './useAppProjectImportWorkspace';
import { buildObservationModeFromGridFields, normalizeUiTheme } from '../app/appHelpers';
import type { ImportedInputNotice } from '../engine/importers';
import type { RunDiagnostics, RunSettingsSnapshot, SolveProfile, WorkspaceTabKey } from '../appStateTypes';
import type { useAppControllerState } from './useAppControllerState';
import type { useWorkspaceProjectState } from './useWorkspaceProjectState';

type ControllerState = ReturnType<typeof useAppControllerState>;
type WorkspaceState = ReturnType<
  typeof useWorkspaceProjectState<
    ImportedInputNotice,
    RunDiagnostics,
    RunSettingsSnapshot,
    WorkspaceTabKey
  >
>;

export const useAppControllerProjectWorkspace = ({
  controllerState,
  workspaceState,
  normalizeSolveProfile,
  resetRunStateAfterImportedInput,
}: {
  controllerState: ControllerState;
  workspaceState: WorkspaceState;
  normalizeSolveProfile: (_profile: SolveProfile) => SolveProfile;
  resetRunStateAfterImportedInput: () => void;
}) => {
  const {
    input,
    importNotice,
    projectIncludeFiles,
    result,
    exportFormat,
    lastRunSettingsSnapshot,
    planningMap,
    surveyCadState,
    setInput,
    setProjectIncludeFiles,
    setExportFormat,
    setPlanningMap,
    setSurveyCadState,
    setImportNotice,
  } = workspaceState;
  const {
    settings,
    setSettings,
    parseSettings,
    setParseSettings,
    geoidSourceData,
    setGeoidSourceData,
    geoidSourceDataLabel,
    setGeoidSourceDataLabel,
    adjustedPointsExportSettings,
    setAdjustedPointsExportSettings,
    projectInstruments,
    setProjectInstruments,
    selectedInstrument,
    setSelectedInstrument,
    levelLoopCustomPresets,
    setLevelLoopCustomPresets,
    fileInputRef,
    importReviewSettingsFileInputRef,
    projectFileInputRef,
    projectSourceFileInputRef,
    projectOptionsState,
  } = controllerState;
  const {
    adjustedPointsExportSettingsDraft,
    setSettingsDraft,
    setParseSettingsDraft,
    setGeoidSourceDataDraft,
    setGeoidSourceDataLabelDraft,
    setProjectInstrumentsDraft,
    setSelectedInstrumentDraft,
    setLevelLoopCustomPresetsDraft,
    setAdjustedPointsExportSettingsDraft,
    setIsAdjustedPointsTransformSelectOpen,
    setAdjustedPointsTransformSelectedDraft,
  } = projectOptionsState;

  return useAppProjectImportWorkspace({
    input,
    importNotice,
    projectIncludeFiles,
    settings,
    parseSettings,
    geoidSourceData,
    geoidSourceDataLabel,
    exportFormat,
    adjustedPointsExportSettings,
    adjustedPointsExportSettingsDraft,
    planningMap,
    surveyCadState,
    projectInstruments,
    selectedInstrument,
    levelLoopCustomPresets,
    lastRunSettingsSnapshot,
    result,
    resetRunStateAfterImportedInput,
    setInput,
    setProjectIncludeFiles,
    setSettings,
    setParseSettings,
    setGeoidSourceData,
    setGeoidSourceDataLabel,
    setExportFormat,
    setAdjustedPointsExportSettings,
    setPlanningMap,
    setSurveyCadState,
    setProjectInstruments,
    setSelectedInstrument,
    setLevelLoopCustomPresets,
    setSettingsDraft,
    setParseSettingsDraft,
    setGeoidSourceDataDraft,
    setGeoidSourceDataLabelDraft,
    setProjectInstrumentsDraft,
    setSelectedInstrumentDraft,
    setLevelLoopCustomPresetsDraft,
    setAdjustedPointsExportSettingsDraft,
    setIsAdjustedPointsTransformSelectOpen,
    setAdjustedPointsTransformSelectedDraft,
    setImportNotice,
    normalizeUiTheme,
    normalizeSolveProfile,
    buildObservationModeFromGridFields,
    coordMode: parseSettings.coordMode,
    faceNormalizationMode: parseSettings.faceNormalizationMode,
    fileInputRef,
    importReviewSettingsFileInputRef,
    projectFileInputRef,
    projectSourceFileInputRef,
  });
};
