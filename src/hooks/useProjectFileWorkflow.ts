import {
  DEFAULT_ADJUSTED_POINTS_EXPORT_SETTINGS,
} from '../engine/adjustedPointsExport';
import { DEFAULT_PLANNING_MAP_STATE } from '../engine/planningMapState';
import {
  buildProjectEditorIncludeFiles,
} from '../engine/projectWorkspace';
import type { PreparedAssociatedProjectSettingsImport } from './projectFileAssociatedSettings';
import {
  type ProjectFlatWorkspacePayloadOptions,
} from './projectFilePayloadBuilders';
import type { UseProjectFileWorkflowArgs } from './useProjectFileWorkflow.types';
import { useProjectPayloadLoader } from './useProjectPayloadLoader';
import {
  useProjectWorkflowDerivedState,
  type ProjectRunValidation,
  type ProjectWorkspaceFileView,
} from './useProjectWorkflowDerivedState';
import { useProjectSourceFileImports } from './useProjectSourceFileImports';
import { useProjectFileTabActions } from './useProjectFileTabActions';
import { useProjectFileCrudActions } from './useProjectFileCrudActions';
import { useAssociatedProjectSettingsWorkflow } from './useAssociatedProjectSettingsWorkflow';
import { useProjectStorageActions } from './useProjectStorageActions';
import { useProjectPortableActions } from './useProjectPortableActions';
import { useProjectSessionPersistence } from './useProjectSessionPersistence';

export { applyPersistedProjectSession } from './projectFileSessionHelpers';
export type { PreparedAssociatedProjectSettingsImport } from './projectFileAssociatedSettings';

const PROJECT_SOURCE_ACCEPT =
  '.dat,.txt,.sum,.rpt,.xml,.jxl,.jobxml,.htm,.html,.rw5,.cr5,.raw,.dbx,.json';
const ASSOCIATED_PROJECT_SETTINGS_ACCEPT = '.wnproj,.wnproj.json,.json,.snproj';

export type { ProjectRunValidation, ProjectWorkspaceFileView } from './useProjectWorkflowDerivedState';

export const useProjectFileWorkflow = ({
  projectFileInputRef,
  projectSourceFileInputRef,
  input,
  projectIncludeFiles,
  settings,
  parseSettings,
  geoidSourceData = null,
  geoidSourceDataLabel = '',
  exportFormat,
  adjustedPointsExportSettings,
  planningMap = DEFAULT_PLANNING_MAP_STATE,
  surveyCadState = null,
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
  resetWorkspaceAfterProjectLoad,
  restoreSavedRunSnapshots,
  normalizeUiTheme,
  normalizeSolveProfile,
  buildObservationModeFromGridFields,
  cloneInstrumentLibrary,
}: UseProjectFileWorkflowArgs) => {
  const {
    canUseNamedProjectStorage,
    handleEditorInputChange,
    persistProjectNow,
    projectSession,
    recentProjects,
    refreshStorageContext,
    removeRecentProjectRow,
    setProjectSession,
    storage,
    storageStatus,
    updateProjectSession,
    upsertRecentProjectRow,
  } = useProjectSessionPersistence({
    adjustedPointsExportSettings,
    cloneInstrumentLibrary,
    exportFormat,
    geoidSourceData,
    geoidSourceDataLabel,
    levelLoopCustomPresets,
    parseSettings,
    planningMap,
    projectInstruments,
    selectedInstrument,
    setInput,
    setProjectIncludeFiles,
    settings,
    surveyCadState,
  });

  const { applyLoadedProjectPayload, normalizeImportedProjectPayload } = useProjectPayloadLoader({
    buildObservationModeFromGridFields,
    cloneInstrumentLibrary,
    normalizeSolveProfile,
    normalizeUiTheme,
    resetWorkspaceAfterProjectLoad,
    restoreSavedRunSnapshots,
    setAdjustedPointsExportSettings,
    setAdjustedPointsExportSettingsDraft,
    setAdjustedPointsTransformSelectedDraft,
    setExportFormat,
    setGeoidSourceData,
    setGeoidSourceDataDraft,
    setGeoidSourceDataLabel,
    setGeoidSourceDataLabelDraft,
    setInput,
    setIsAdjustedPointsTransformSelectOpen,
    setLevelLoopCustomPresets,
    setLevelLoopCustomPresetsDraft,
    setParseSettings,
    setParseSettingsDraft,
    setPlanningMap,
    setProjectIncludeFiles,
    setProjectInstruments,
    setProjectInstrumentsDraft,
    setSelectedInstrument,
    setSelectedInstrumentDraft,
    setSettings,
    setSettingsDraft,
    setSurveyCadState,
  });

  const {
    activeProjectFileViews,
    buildPortablePayload,
    currentProjectFile,
    effectiveProjectRunFiles,
    effectiveRunIncludeFiles,
    effectiveRunInput,
    effectiveSolveIncludeFiles,
    effectiveSolveInput,
    getOrderedRunFiles,
    projectFlatWorkspacePayload,
    projectRunValidation,
    validateRunSet,
  } = useProjectWorkflowDerivedState({
    adjustedPointsExportSettings,
    exportFormat,
    geoidSourceData,
    geoidSourceDataLabel,
    input,
    levelLoopCustomPresets,
    parseSettings,
    planningMap,
    projectIncludeFiles,
    projectInstruments,
    projectSession,
    savedRunSnapshots,
    selectedInstrument,
    settings,
    surveyCadState,
  });

  const {
    createLocalProjectFromCurrentWorkspace,
    deleteLocalProject,
    handleSaveProject,
    openProjectById,
    openProjectWorkspace,
    triggerProjectFileSelect,
    triggerProjectSourceFileSelect,
  } = useProjectStorageActions({
    applyLoadedProjectPayload,
    canUseNamedProjectStorage,
    cloneInstrumentLibrary,
    persistProjectNow,
    projectFileInputRef,
    projectFlatWorkspacePayload,
    projectSession,
    projectSourceFileInputRef,
    recentProjects,
    refreshStorageContext,
    removeRecentProjectRow,
    setImportNotice,
    setProjectSession,
    storage,
    storageStatus,
    upsertRecentProjectRow,
  });

  const {
    exportPortableProject,
    exportProjectBundle,
    handleProjectFileChange,
  } = useProjectPortableActions({
    adjustedPointsExportSettings,
    applyLoadedProjectPayload,
    buildPortablePayload,
    canUseNamedProjectStorage,
    cloneInstrumentLibrary,
    exportFormat,
    levelLoopCustomPresets,
    parseSettings,
    projectFlatWorkspacePayload,
    projectInstruments,
    projectSession,
    refreshStorageContext,
    selectedInstrument,
    setImportNotice,
    setProjectSession,
    settings,
    storage,
    storageStatus,
  });

  const {
    handleProjectSourceFileChange,
    importGeneratedProjectSourceFile,
    importProjectSourceFiles,
  } = useProjectSourceFileImports({
    createLocalProjectFromCurrentWorkspace,
    projectSession,
    setImportNotice,
    setInput,
    setProjectIncludeFiles,
    setProjectSession,
    updateProjectSession,
  });

  const {
    applyPreparedAssociatedProjectSettings,
    importAssociatedProjectSettingsFile,
    prepareAssociatedProjectSettingsImport,
  } = useAssociatedProjectSettingsWorkflow({
    adjustedPointsExportSettings,
    cloneInstrumentLibrary,
    exportFormat,
    geoidSourceData,
    geoidSourceDataLabel,
    levelLoopCustomPresets,
    normalizeImportedProjectPayload,
    parseSettings,
    projectInstruments,
    projectSession,
    resetWorkspaceAfterProjectLoad,
    selectedInstrument,
    setAdjustedPointsExportSettings,
    setAdjustedPointsExportSettingsDraft,
    setAdjustedPointsTransformSelectedDraft,
    setExportFormat,
    setGeoidSourceData,
    setGeoidSourceDataDraft,
    setGeoidSourceDataLabel,
    setGeoidSourceDataLabelDraft,
    setImportNotice,
    setIsAdjustedPointsTransformSelectOpen,
    setLevelLoopCustomPresets,
    setLevelLoopCustomPresetsDraft,
    setParseSettings,
    setParseSettingsDraft,
    setProjectInstruments,
    setProjectInstrumentsDraft,
    setSelectedInstrument,
    setSelectedInstrumentDraft,
    setSettings,
    setSettingsDraft,
    settings,
    updateProjectSession,
  });

  const {
    closeFileTab,
    focusFileTab,
    moveProjectFile,
    openFileTab,
    reorderProjectFiles,
  } = useProjectFileTabActions({
    projectSession,
    updateProjectSession,
  });

  const {
    createBlankProjectFile,
    deleteProjectFile,
    duplicateProjectFile,
    removeProjectFile,
    renameProjectFile,
    setProjectFileEnabled,
  } = useProjectFileCrudActions({
    projectSession,
    setImportNotice,
    updateProjectSession,
  });

  return {
    storageStatus,
    recentProjects,
    projectSession,
    activeProjectFileViews,
    currentProjectFile,
    projectSourceAccept: PROJECT_SOURCE_ACCEPT,
    associatedProjectSettingsAccept: ASSOCIATED_PROJECT_SETTINGS_ACCEPT,
    effectiveRunInput,
    effectiveProjectRunFiles,
    projectRunValidation,
    getOrderedRunFiles,
    validateRunSet,
    effectiveSolveInput,
    effectiveSolveIncludeFiles,
    effectiveRunIncludeFiles,
    currentEditorIncludeFiles:
      projectSession && currentProjectFile
        ? buildProjectEditorIncludeFiles(
            projectSession.manifest,
            projectSession.sourceTexts,
            currentProjectFile.id,
          )
        : projectIncludeFiles,
    triggerProjectFileSelect,
    triggerProjectSourceFileSelect,
    importProjectSourceFiles,
    importGeneratedProjectSourceFile,
    prepareAssociatedProjectSettingsImport,
    applyPreparedAssociatedProjectSettings,
    importAssociatedProjectSettingsFile,
    openProjectWorkspace,
    handleSaveProject,
    handleEditorInputChange,
    handleProjectFileChange,
    handleProjectSourceFileChange,
    createLocalProjectFromCurrentWorkspace,
    openProjectById,
    deleteLocalProject,
    exportPortableProject,
    exportProjectBundle,
    openFileTab,
    closeFileTab,
    focusFileTab,
    createBlankProjectFile,
    duplicateProjectFile,
    switchActiveProjectFile: focusFileTab,
    renameProjectFile,
    toggleProjectFileEnabled: (fileId: string) => {
      const target = projectSession?.manifest.files.find((file) => file.id === fileId);
      if (!target) return;
      setProjectFileEnabled(fileId, !target.enabled);
    },
    setProjectFileEnabled,
    reorderProjectFiles,
    moveProjectFile,
    deleteProjectFile,
    removeProjectFile,
  };
};
