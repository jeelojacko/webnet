import { useCallback, useMemo, type Dispatch, type RefObject, type SetStateAction } from 'react';
import { getAdjustedPointsExportStationIds, validateAdjustedPointsTransform } from '../engine/adjustedPointsExport';
import { ACTIVE_PARITY_STARTUP_DEFAULTS } from '../app/appConfig';
import {
  buildPendingRunSettingDiffs,
  cloneInstrumentLibrary,
  createRunSettingsSnapshot,
  parseInstrumentLibraryFromInput,
} from '../app/appHelpers';
import type {
  CrsCatalogGroupFilter,
  ParseSettings,
  RunDiagnostics,
  RunSettingsSnapshot,
  SettingsState,
  WorkspaceDraftSnapshot,
} from '../appStateTypes';
import type {
  AdjustedPointsColumnId,
  AdjustedPointsExportSettings,
  CustomLevelLoopTolerancePreset,
  InstrumentLibrary,
  ProjectExportFormat,
} from '../types';
import type { InputPaneHandle } from '../components/InputPane';
import type { ProjectRunFile } from '../engine/projectWorkspace';
import { useImportReviewWorkflow } from './useImportReviewWorkflow';
import { useProjectFileWorkflow } from './useProjectFileWorkflow';
import { useRunComparisonState } from './useRunComparisonState';

interface UseAppProjectImportWorkspaceArgs {
  input: string;
  importNotice: { title: string; detailLines: string[] } | null;
  projectIncludeFiles: Record<string, string>;
  settings: SettingsState;
  parseSettings: ParseSettings;
  geoidSourceData: Uint8Array | null;
  geoidSourceDataLabel: string;
  exportFormat: ProjectExportFormat;
  adjustedPointsExportSettings: AdjustedPointsExportSettings;
  adjustedPointsExportSettingsDraft: AdjustedPointsExportSettings;
  projectInstruments: InstrumentLibrary;
  selectedInstrument: string;
  levelLoopCustomPresets: CustomLevelLoopTolerancePreset[];
  lastRunSettingsSnapshot: RunSettingsSnapshot | null;
  result: import('../types').AdjustmentResult | null;
  resetRunStateAfterImportedInput: () => void;
  setInput: Dispatch<SetStateAction<string>>;
  setProjectIncludeFiles: Dispatch<SetStateAction<Record<string, string>>>;
  setSettings: Dispatch<SetStateAction<SettingsState>>;
  setParseSettings: Dispatch<SetStateAction<ParseSettings>>;
  setGeoidSourceData: Dispatch<SetStateAction<Uint8Array | null>>;
  setGeoidSourceDataLabel: Dispatch<SetStateAction<string>>;
  setExportFormat: Dispatch<SetStateAction<ProjectExportFormat>>;
  setAdjustedPointsExportSettings: Dispatch<SetStateAction<AdjustedPointsExportSettings>>;
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
  setImportNotice: Dispatch<SetStateAction<{ title: string; detailLines: string[] } | null>>;
  normalizeUiTheme: (_value: unknown) => import('../appStateTypes').UiTheme;
  normalizeSolveProfile: (_profile: import('../appStateTypes').SolveProfile) => import('../appStateTypes').SolveProfile;
  buildObservationModeFromGridFields: typeof import('../app/appHelpers').buildObservationModeFromGridFields;
  coordMode: ParseSettings['coordMode'];
  faceNormalizationMode: import('../types').FaceNormalizationMode;
  fileInputRef: RefObject<HTMLInputElement | null>;
  importReviewSettingsFileInputRef: RefObject<HTMLInputElement | null>;
  projectFileInputRef: RefObject<HTMLInputElement | null>;
  projectSourceFileInputRef: RefObject<HTMLInputElement | null>;
}

export const useAppProjectImportWorkspace = ({
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
  coordMode,
  faceNormalizationMode,
  fileInputRef,
  importReviewSettingsFileInputRef,
  projectFileInputRef,
  projectSourceFileInputRef,
}: UseAppProjectImportWorkspaceArgs) => {
  const parsedInputInstruments = useMemo(() => parseInstrumentLibraryFromInput(input), [input]);
  const currentRunSettingsSnapshot = useMemo(
    () => createRunSettingsSnapshot(settings, parseSettings, selectedInstrument),
    [parseSettings, selectedInstrument, settings],
  );
  const pendingRunSettingDiffs = useMemo(
    () => buildPendingRunSettingDiffs(currentRunSettingsSnapshot, lastRunSettingsSnapshot),
    [currentRunSettingsSnapshot, lastRunSettingsSnapshot],
  );
  const runComparison = useRunComparisonState<RunSettingsSnapshot, RunDiagnostics>({
    buildSettingDiffs: buildPendingRunSettingDiffs,
  });
  const {
    savedRunSnapshots,
    restoreSavedRunSnapshots,
  } = runComparison;

  const projectWorkflow = useProjectFileWorkflow({
    projectFileInputRef,
    projectSourceFileInputRef,
    input,
    projectIncludeFiles,
    settings,
    parseSettings,
    geoidSourceData,
    geoidSourceDataLabel,
    exportFormat,
    adjustedPointsExportSettings,
    savedRunSnapshots,
    projectInstruments,
    selectedInstrument,
    levelLoopCustomPresets,
    setInput,
    setProjectIncludeFiles,
    setSettings,
    setParseSettings,
    setGeoidSourceData,
    setGeoidSourceDataLabel,
    setExportFormat,
    setAdjustedPointsExportSettings,
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
    resetWorkspaceAfterProjectLoad: resetRunStateAfterImportedInput,
    restoreSavedRunSnapshots,
    normalizeUiTheme,
    normalizeSolveProfile,
    buildObservationModeFromGridFields,
    cloneInstrumentLibrary,
  });

  const startupProjectRunFiles = useMemo<ProjectRunFile[]>(
    () =>
      projectWorkflow.projectSession == null
        ? (ACTIVE_PARITY_STARTUP_DEFAULTS?.projectRunFiles ?? []).map((file, index) => ({
            fileId: file.fileId,
            name: file.name,
            order: file.order ?? index,
            content: input,
          }))
        : [],
    [input, projectWorkflow.projectSession],
  );
  const activeProjectRunFiles = useMemo<ProjectRunFile[]>(
    () =>
      projectWorkflow.effectiveProjectRunFiles.length > 0
        ? projectWorkflow.effectiveProjectRunFiles
        : startupProjectRunFiles,
    [projectWorkflow.effectiveProjectRunFiles, startupProjectRunFiles],
  );

  const setEditorInput: Dispatch<SetStateAction<string>> = useCallback(
    (value) => {
      const nextValue = typeof value === 'function' ? value(input) : value;
      projectWorkflow.handleEditorInputChange(nextValue);
      if (importNotice) setImportNotice(null);
    },
    [importNotice, input, projectWorkflow, setImportNotice],
  );

  const importWorkflow = useImportReviewWorkflow({
    coordMode,
    currentInput: input,
    currentIncludeFiles: projectWorkflow.currentEditorIncludeFiles,
    faceNormalizationMode,
    fileInputRef,
    settingsFileInputRef: importReviewSettingsFileInputRef,
    importProjectSourceFiles: projectWorkflow.importProjectSourceFiles,
    importGeneratedProjectSourceFile: projectWorkflow.importGeneratedProjectSourceFile,
    prepareAssociatedProjectSettingsImport: projectWorkflow.prepareAssociatedProjectSettingsImport,
    applyPreparedAssociatedProjectSettings: projectWorkflow.applyPreparedAssociatedProjectSettings,
    parseSettings,
    projectInstruments,
    setInput: setEditorInput,
    setProjectIncludeFiles,
    setImportNotice,
    resetWorkspaceForImportedInput: resetRunStateAfterImportedInput,
  });

  const restoreImportReviewWorkflow = useCallback(
    (snapshot: WorkspaceDraftSnapshot['importReview'] | undefined) =>
      importWorkflow.restoreImportReviewWorkflow(snapshot ?? null),
    [importWorkflow],
  );
  const { restoreImportReviewWorkflow: _restoreImportReviewWorkflowBase, ...importWorkflowState } =
    importWorkflow;

  const adjustedPointsDraftStationIds = useMemo(() => {
    if (!result) return [] as string[];
    return getAdjustedPointsExportStationIds(
      result,
      adjustedPointsExportSettingsDraft.includeLostStations,
    );
  }, [result, adjustedPointsExportSettingsDraft.includeLostStations]);
  const adjustedPointsTransformDraftValidationMessage = useMemo(() => {
    const transform = adjustedPointsExportSettingsDraft.transform;
    const anyEnabled =
      transform.rotation.enabled || transform.translation.enabled || transform.scale.enabled;
    if (!anyEnabled) return null;
    if (!result) return 'Run adjustment before exporting transformed coordinates.';
    const validation = validateAdjustedPointsTransform({
      result,
      settings: adjustedPointsExportSettingsDraft,
    });
    if (validation.valid) return null;
    return validation.message;
  }, [result, adjustedPointsExportSettingsDraft]);

  return {
    parsedInputInstruments,
    currentRunSettingsSnapshot,
    pendingRunSettingDiffs,
    activeProjectRunFiles,
    restoreImportReviewWorkflow,
    adjustedPointsDraftStationIds,
    adjustedPointsTransformDraftValidationMessage,
    setEditorInput,
    ...runComparison,
    ...projectWorkflow,
    ...importWorkflowState,
  };
};
