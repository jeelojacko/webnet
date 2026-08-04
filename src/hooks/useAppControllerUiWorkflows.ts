import { useMemo } from 'react';
import { buildRunComparisonText } from '../engine/qaWorkflow';
import { LEVEL_LOOP_TOLERANCE_PRESETS } from '../engine/levelLoopTolerance';
import {
  buildObservationModeFromGridFields,
  createInstrument,
  normalizeUiTheme,
} from '../app/appHelpers';
import {
  createCustomLevelLoopTolerancePreset,
  resolveLevelLoopTolerancePreset,
} from '../app/appLevelLoopPresets';
import {
  loadIndustryOutputView,
  loadMapView,
  loadProcessingSummaryView,
} from '../app/AppLazyLoaders';
import { useArtifactBuilder } from './useArtifactBuilder';
import { useExportWorkflow } from './useExportWorkflow';
import { useAppIndustryOutput } from './useAppIndustryOutput';
import { useAppProjectOptionsModal } from './useAppProjectOptionsModal';
import { useAppRunComparisonPanel } from './useAppRunComparisonPanel';
import { useAppReviewQueue } from './useAppReviewQueue';
import { useAppRunWorkspaceReview } from './useAppRunWorkspaceReview';
import { useAppWorkspaceDraft } from './useAppWorkspaceDraft';
import { useAppPlanningMap } from './useAppPlanningMap';
import { useProcessingSummaryDiagnostics } from './useProcessingSummaryDiagnostics';
import { useHeavyTabHydration, useSequentialTabPrewarm } from './useHeavyTabHydration';
import type { useAppControllerProjectWorkspace } from './useAppControllerProjectWorkspace';
import type { useAppControllerState } from './useAppControllerState';
import type { useAppCrsDraftCatalog } from './useAppCrsDraftCatalog';
import type { useAppRunWorkflowShell } from './useAppRunWorkflowShell';
import type { useWorkspaceProjectState } from './useWorkspaceProjectState';
import type { ImportedInputNotice } from '../engine/importers';
import type { RunDiagnostics, RunSettingsSnapshot, SolveProfile, WorkspaceTabKey } from '../appStateTypes';

type ControllerState = ReturnType<typeof useAppControllerState>;
type ProjectOptionsState = ControllerState['projectOptionsState'];
type CrsDraftCatalogState = ReturnType<typeof useAppCrsDraftCatalog>;
type WorkspaceState = ReturnType<
  typeof useWorkspaceProjectState<
    ImportedInputNotice,
    RunDiagnostics,
    RunSettingsSnapshot,
    WorkspaceTabKey
  >
>;
type ProjectWorkspaceState = ReturnType<typeof useAppControllerProjectWorkspace>;
type RunWorkflowState = ReturnType<typeof useAppRunWorkflowShell>;
type UiWorkflowContext = ControllerState &
  ProjectOptionsState &
  CrsDraftCatalogState &
  WorkspaceState &
  ProjectWorkspaceState &
  RunWorkflowState & {
    normalizeSolveProfile: (_profile: SolveProfile) => SolveProfile;
  };

export const useAppControllerUiWorkflows = (context: UiWorkflowContext) => {
  const { activeTab, activeProjectFileViews, activeProjectRunFiles, adjustedPointsDraftStationIds, adjustedPointsDragRef, adjustedPointsExportSettings, adjustedPointsTransformDraftValidationMessage, baselineRunSnapshot, buildRunDiagnosticsWithProjectMetadata, clearRunComparisonState, clearWorkspaceArtifacts, clusterReviewDecisions, comparisonSelection, currentProjectFile, currentRunSnapshot, deleteLocalProject, effectiveRunIncludeFiles, effectiveRunInput, excludedIds, exportFormat, exportPortableProject, exportProjectBundle, exportRunDiagnostics, geoidSourceData, geoidSourceDataLabel, geoidSourceFileInputRef, handleSaveProject, importReviewSnapshot, importReviewState, input, isSidebarOpen, lastRunInput, levelLoopCustomPresets, mapDeclutterPreset, normalizeSolveProfile, openPermanentExampleProject, openProjectById, parseSettings, pendingRunSettingDiffs, pipelineState, planningMap, planningMapPreview, projectIncludeFiles, projectInstruments, projectOptionsState, projectRunValidation, projectSession, recentProjects, removeSavedRunSnapshot, renameSavedRunSnapshot, resetAdjustmentWorkflowState, resetImportReviewWorkflow, restoreAdjustmentWorkflowState, restoreImportReviewWorkflow, restoreSavedRunSnapshot, restoreSavedRunSnapshots, result, runComparisonSummary, runDiagnostics, saveCurrentRunSnapshot, savedRunSnapshots, selectedCrsProj4Params, selectedDraftCrs, selectedInstrument, setActiveOptionsTab, setActiveTab, setAdjustedPointsExportSettings, setAdjustedPointsExportSettingsDraft, setAdjustedPointsRotationAngleError, setAdjustedPointsRotationAngleInput, setAdjustedPointsTransformSelectedDraft, setAdjustedPointsTranslationAzimuthError, setAdjustedPointsTranslationAzimuthInput, setCrsCatalogGroupFilter, setCrsSearchQuery, setExportFormat, setGeoidSourceData, setGeoidSourceDataDraft, setGeoidSourceDataLabel, setGeoidSourceDataLabelDraft, setImportNotice, setInput, setIsAdjustedPointsTransformSelectOpen, setIsSidebarOpen, setLevelLoopCustomPresets, setLevelLoopCustomPresetsDraft, setMapDeclutterPreset, setParseSettings, setParseSettingsDraft, setPendingEditorJumpLine, setPlanningMap, setPlanningMapPreview, setProjectIncludeFiles, setProjectInstruments, setProjectInstrumentsDraft, setResult, setRunDiagnostics, setRunElapsedMs, setSelectedInstrument, setSelectedInstrumentDraft, setSettings, setSettingsDraft, setShowCrsProjectionParams, setSplitPercent, setSurveyCadState, settings, settingsModalContentRef, splitPercent, storageStatus, surveyCadState, updateSavedRunSnapshotNotes, visibleDraftCrsCatalog, filteredDraftCrsCatalog, searchedDraftCrsCatalog, crsCatalogGroupCounts, setComparisonSelection, setEditorInput, triggerProjectFileSelect, triggerProjectSourceFileSelect, createLocalProjectFromCurrentWorkspace, createBlankProjectFile, switchActiveProjectFile, renameProjectFile, toggleProjectFileEnabled, moveProjectFile, removeProjectFile } = context;

  const heavyTabPreloaders = useMemo(
    () => [loadProcessingSummaryView, loadIndustryOutputView, loadMapView],
    [],
  );
  useSequentialTabPrewarm(result, heavyTabPreloaders);
  const { canRenderTab } = useHeavyTabHydration(result, activeTab);
  const { handleLoadPlanningInputPoints, mapResult } = useAppPlanningMap({
    result,
    planningMapPreview,
    setPlanningMapPreview,
    effectiveRunInput,
    activeProjectRunFiles,
    effectiveRunIncludeFiles,
    parseSettings,
    projectInstruments,
    selectedInstrument,
    setImportNotice,
    setActiveTab,
  });
  const { industryOutputText, handleIndustryListingSortChange } = useAppIndustryOutput({
    activeTab,
    result,
    settings,
    parseSettings,
    runDiagnostics,
    setSettings,
    setSettingsDraft,
    buildRunDiagnostics: buildRunDiagnosticsWithProjectMetadata,
  });

  const currentComparisonText = useMemo(
    () => (runComparisonSummary ? buildRunComparisonText(runComparisonSummary) : ''),
    [runComparisonSummary],
  );
  const processingSummaryDiagnostics = useProcessingSummaryDiagnostics(runDiagnostics);
  const { buildArtifacts } = useArtifactBuilder();
  const appRunWorkspaceReview = useAppRunWorkspaceReview({
    result,
    excludedIds,
    projectRunValidationOk: projectRunValidation.ok,
    pendingRunSettingDiffs,
    pipelineState,
    lastRunInput,
    effectiveRunInput,
    activeTab,
    comparisonSelection,
    activeProjectRunFiles,
    effectiveRunIncludeFiles,
    runComparisonSummary,
    restoreSavedRunSnapshot,
    restoreAdjustmentWorkflowState,
    setResult,
    setRunDiagnostics,
    setRunElapsedMs,
    setPendingEditorJumpLine,
    setLastRunInput: context.setLastRunInput,
    setLastRunSettingsSnapshot: context.setLastRunSettingsSnapshot,
    setImportNotice,
    setActiveTab,
  });
  const {
    qaDerivedResult,
    workspaceReviewState,
    persistedWorkspaceReviewSnapshot: nextPersistedWorkspaceReviewSnapshot,
    buildSavedRunReopenState,
    handleRestoreSavedRun,
    runPhaseLabel,
    handleWorkspaceTabChange,
    handleReportStationSelection,
    handleReportObservationSelection,
    handleMapStationSelection,
    handleMapObservationSelection,
  } = appRunWorkspaceReview;
  const {
    selection,
    restoreSnapshot: restoreWorkspaceReviewSnapshot,
    resetState: resetWorkspaceReviewState,
    selectedObservation,
    selectedStation,
    selectObservation,
    selectStation,
    clearSelection,
    pinnedObservations,
    togglePinnedObservation,
    selectNextSuspect,
    selectPreviousSuspect,
    hasSuspects,
  } = workspaceReviewState;
  const { handleExportResults } = useExportWorkflow({
    result,
    exportFormat,
    units: settings.units,
    settings,
    parseSettings,
    runDiagnostics: exportRunDiagnostics,
    adjustedPointsExportSettings,
    levelLoopCustomPresets,
    currentComparisonText,
    setImportNotice,
    buildArtifacts,
  });
  const {
    resetRunStateAfterImportedInput: resetRunStateAfterImportedInputInternal,
    pendingRecovery,
    hasStoredDraft,
    recoverDraft,
    discardRecoveredDraft,
    clearCurrentDraft,
  } = useAppWorkspaceDraft({
    input,
    projectIncludeFiles,
    settings,
    parseSettings,
    exportFormat,
    adjustedPointsExportSettings,
    projectInstruments,
    selectedInstrument,
    levelLoopCustomPresets,
    geoidSourceData,
    geoidSourceDataLabel,
    surveyCadState,
    activeTab,
    splitPercent,
    isSidebarOpen,
    mapDeclutterPreset,
    planningMap,
    persistedWorkspaceReviewSnapshot: nextPersistedWorkspaceReviewSnapshot,
    stationMovementThreshold: comparisonSelection.stationMovementThreshold,
    residualDeltaThreshold: comparisonSelection.residualDeltaThreshold,
    savedRunSnapshots,
    importReviewSnapshot,
    recoveryDisabled: Boolean(projectSession),
    clearWorkspaceArtifacts,
    resetAdjustmentWorkflowState,
    clearRunComparisonState,
    resetWorkspaceReviewState,
    resetImportReviewWorkflow,
    restoreSavedRunSnapshots,
    restoreWorkspaceReviewSnapshot,
    restoreImportReviewWorkflow: (snapshot) => restoreImportReviewWorkflow(snapshot ?? null),
    setInput,
    setProjectIncludeFiles,
    setSettings,
    setSettingsDraft,
    setParseSettings,
    setParseSettingsDraft,
    setGeoidSourceData,
    setGeoidSourceDataDraft,
    setGeoidSourceDataLabel,
    setGeoidSourceDataLabelDraft,
    setExportFormat,
    setAdjustedPointsExportSettings,
    setAdjustedPointsExportSettingsDraft,
    setProjectInstruments,
    setProjectInstrumentsDraft,
    setSelectedInstrument,
    setSelectedInstrumentDraft,
    setLevelLoopCustomPresets,
    setLevelLoopCustomPresetsDraft,
    setIsAdjustedPointsTransformSelectOpen,
    setAdjustedPointsTransformSelectedDraft,
    setAdjustedPointsRotationAngleInput,
    setAdjustedPointsTranslationAzimuthInput,
    setAdjustedPointsRotationAngleError,
    setAdjustedPointsTranslationAzimuthError,
    setCrsCatalogGroupFilter,
    setCrsSearchQuery,
    setShowCrsProjectionParams,
    setActiveTab,
    setSplitPercent,
    setIsSidebarOpen,
    setMapDeclutterPreset,
    setPlanningMap,
    setSurveyCadState,
    setComparisonSelection,
    setImportNotice,
  });
  const {
    filteredReviewQueueItems,
    reviewQueueImportedGroupOptions,
    reviewQueueSeverityFilter,
    setReviewQueueSeverityFilter,
    reviewQueueSourceFilter,
    setReviewQueueSourceFilter,
    reviewQueueUnresolvedOnly,
    setReviewQueueUnresolvedOnly,
    reviewQueueImportedGroupFilter,
    setReviewQueueImportedGroupFilter,
    selectedReviewQueueItemId,
    handleJumpToSourceLine,
    handleFocusReportFilter,
    reportFilterFocusRequestKey,
    handleSelectReviewQueueItem,
    handleNextUnresolvedQueueItem,
    clearReviewQueueFilters,
  } = useAppReviewQueue({
    result,
    excludedIds,
    clusterReviewDecisions,
    runComparisonSummary,
    importReviewState,
    selectObservation,
    selectStation,
    setActiveTab,
    setIsSidebarOpen,
    setPendingEditorJumpLine,
  });
  const {
    applyAdjustedPointsTransformSelection,
    closeAdjustedPointsTransformSelectModal,
    handleAdjustedPointsTransformToggleSelected,
    projectOptionsModalContext,
    handleOpenProjectWorkspacePanel,
  } = useAppProjectOptionsModal({
    projectOptionsState,
    openProjectOptions: context.openProjectOptions,
    setActiveOptionsTab,
    adjustedPointsDraftStationIds,
    adjustedPointsTransformDraftValidationMessage,
    crsCatalogGroupCounts,
    filteredDraftCrsCatalog,
    searchedDraftCrsCatalog,
    visibleDraftCrsCatalog,
    selectedDraftCrs,
    selectedCrsProj4Params,
    exportFormat,
    setExportFormat,
    storageStatus,
    recentProjects,
    projectSession,
    activeProjectFileViews,
    currentProjectFile,
    handleSaveProject,
    triggerProjectFileSelect,
    triggerProjectSourceFileSelect,
    createLocalProjectFromCurrentWorkspace,
    openProjectById,
    openPermanentExampleProject,
    deleteLocalProject,
    exportPortableProject,
    exportProjectBundle,
    createBlankProjectFile,
    switchActiveProjectFile,
    renameProjectFile,
    toggleProjectFileEnabled,
    moveProjectFile,
    removeProjectFile,
    geoidSourceFileInputRef,
    settingsModalContentRef,
    adjustedPointsDragRef,
    runDiagnostics,
    normalizeSolveProfile,
    normalizeUiTheme,
    buildObservationModeFromGridFields,
    createInstrument,
    createCustomLevelLoopTolerancePreset,
    resolveLevelLoopTolerancePreset,
  });
  const {
    showRunComparisonPanel,
    handleResetToLastRun,
    handleClearCurrentDraft,
    handleSaveCurrentSnapshot,
    handleCompareWithSavedRun,
    handleRenameSavedRun,
    handleUpdateSavedRunNotes,
    handleDeleteSavedRun,
    handleSelectBaseline,
    handleTogglePinBaseline,
    handleStationThresholdChange,
    handleResidualThresholdChange,
    handleCompareSelectStation,
    handleCompareSelectObservation,
  } = useAppRunComparisonPanel({
    lastRunInput,
    handleEditorInputChange: setEditorInput,
    clearWorkspaceArtifacts,
    resetImportReviewWorkflow,
    resetAdjustmentWorkflowState,
    clearRunComparisonState,
    resetWorkspaceReviewState,
    clearCurrentDraft,
    setImportNotice,
    currentRunSnapshot,
    savedRunSnapshots,
    saveCurrentRunSnapshot,
    buildSavedRunReopenState,
    setComparisonSelection,
    renameSavedRunSnapshot,
    updateSavedRunSnapshotNotes,
    removeSavedRunSnapshot,
    baselineRunSnapshot,
    selectStation,
    selectObservation,
    setActiveTab,
  });

  return { applyAdjustedPointsTransformSelection, canRenderTab, clearReviewQueueFilters, clearSelection, closeAdjustedPointsTransformSelectModal, discardRecoveredDraft, filteredReviewQueueItems, handleAdjustedPointsTransformToggleSelected, handleClearCurrentDraft, handleCompareSelectObservation, handleCompareSelectStation, handleCompareWithSavedRun, handleDeleteSavedRun, handleExportResults, handleFocusReportFilter, handleIndustryListingSortChange, handleJumpToSourceLine, handleLoadPlanningInputPoints, handleMapObservationSelection, handleMapStationSelection, handleNextUnresolvedQueueItem, handleOpenProjectWorkspacePanel, handleRenameSavedRun, handleReportObservationSelection, handleReportStationSelection, handleResetToLastRun, handleResidualThresholdChange, handleRestoreSavedRun, handleSaveCurrentSnapshot, handleSelectBaseline, handleSelectReviewQueueItem, handleStationThresholdChange, handleTogglePinBaseline, handleUpdateSavedRunNotes, handleWorkspaceTabChange, hasStoredDraft, hasSuspects, industryOutputText, mapResult, pendingRecovery, pinnedObservations, processingSummaryDiagnostics, projectOptionsModalContext, qaDerivedResult, recoverDraft, reportFilterFocusRequestKey, resetRunStateAfterImportedInputInternal, reviewQueueImportedGroupFilter, reviewQueueImportedGroupOptions, reviewQueueSeverityFilter, reviewQueueSourceFilter, reviewQueueUnresolvedOnly, runPhaseLabel, selectNextSuspect, selectObservation, selectPreviousSuspect, selectedObservation, selectedReviewQueueItemId, selectedStation, selection, setReviewQueueImportedGroupFilter, setReviewQueueSeverityFilter, setReviewQueueSourceFilter, setReviewQueueUnresolvedOnly, showRunComparisonPanel, togglePinnedObservation, workspaceReviewState };
};
