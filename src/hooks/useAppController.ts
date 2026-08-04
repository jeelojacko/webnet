import { useCallback, useLayoutEffect, useMemo } from 'react';
import { DEFAULT_INPUT } from '../defaultInput';
import { LEVEL_LOOP_TOLERANCE_PRESETS } from '../engine/levelLoopTolerance';
import { type ImportedInputNotice } from '../engine/importers';
import { useAppRunWorkflowShell } from './useAppRunWorkflowShell';
import { useAppControllerProjectWorkspace } from './useAppControllerProjectWorkspace';
import { useAppCrsDraftCatalog } from './useAppCrsDraftCatalog';
import { useAppControllerEffects } from './useAppControllerEffects';
import { useAppControllerState } from './useAppControllerState';
import { useAppControllerUiWorkflows } from './useAppControllerUiWorkflows';
import { useWorkspaceProjectState } from './useWorkspaceProjectState';
import {
  noteUiPerfStage,
  useUiLongTaskObserver,
} from './useUiPerfMonitor';
import { ACTIVE_PARITY_STARTUP_DEFAULTS } from '../app/appConfig';
import {
  INDUSTRY_DEFAULT_INSTRUMENT,
  INDUSTRY_DEFAULT_INSTRUMENT_CODE,
} from '../app/appHelpers';
import type { ListingSortCoordinatesBy, ListingSortObservationsBy, ParseSettings, ProjectOptionsTab, RunDiagnostics, RunSettingsSnapshot, SolveProfile, WorkspaceTabKey } from '../appStateTypes';
import type { AdjustmentResult, ParseResult } from '../types';
import type { Instrument, CoordMode, AdjustedPointsPresetId, DirectionSetMode, ParseOptions, OrderMode, DeltaMode, MapMode, AngleMode, VerticalReductionMode, ProjectExportFormat, TsCorrelationScope, RobustMode, CrsProjectionModel, CoordSystemMode, LocalDatumScheme, GridObservationMode, GridDistanceInputMode, ObservationModeSettings, GeoidInterpolationMethod, GeoidHeightDatum, GeoidSourceFormat, GnssVectorFrame, ParseCompatibilityMode, FaceNormalizationMode, RunMode } from '../types';

type TabKey = WorkspaceTabKey;

export type AppControllerProps = {
  initialSettingsModalOpen?: boolean;
  initialOptionsTab?: ProjectOptionsTab;
};

export const useAppController = ({
  initialSettingsModalOpen = false,
  initialOptionsTab = 'adjustment',
}: AppControllerProps) => {
  const workspaceState = useWorkspaceProjectState<ImportedInputNotice, RunDiagnostics, RunSettingsSnapshot, TabKey>({
    initialInput: ACTIVE_PARITY_STARTUP_DEFAULTS?.input ?? DEFAULT_INPUT,
    initialExportFormat: 'points',
    initialActiveTab: 'report',
  });
  const {
    input,
    importNotice,
    setImportNotice,
    result,
    setResult,
    runDiagnostics,
    setRunDiagnostics,
    runElapsedMs,
    setRunElapsedMs,
    exportFormat,
    setExportFormat,
    lastRunInput,
    setLastRunInput,
    setLastRunSettingsSnapshot,
    pendingEditorJumpLine,
    setPendingEditorJumpLine,
    activeTab,
    setActiveTab,
    planningMap,
    setPlanningMap,
    surveyCadState,
    setSurveyCadState,
  } = workspaceState;
  useUiLongTaskObserver();

  useLayoutEffect(() => {
    if (!result) return;
    noteUiPerfStage('resultCommitComplete');
  }, [result]);

  const controllerState = useAppControllerState({
    initialSettingsModalOpen,
    initialOptionsTab,
  });
  const {
    settings,
    parseSettings,
    geoidSourceData,
    projectInstruments,
    setProjectInstruments,
    adjustedPointsExportSettings,
    selectedInstrument,
    setSelectedInstrument,
    splitPercent,
    isSidebarOpen,
    setIsSidebarOpen,
    layoutRef,
    handleDividerMouseDown,
    mapViewSnapshot,
    setMapViewSnapshot,
    planningMapPreview,
    projectOptionsState,
    fileInputRef,
    importReviewSettingsFileInputRef,
    projectFileInputRef,
    projectSourceFileInputRef,
    inputPaneRef,
    settingsModalContentRef,
  } = controllerState;
  const projectWorkspaceState = useAppControllerProjectWorkspace({
    controllerState,
    workspaceState,
    normalizeSolveProfile,
    resetRunStateAfterImportedInput,
  });
  const isSurveyCadWorkspaceActive = activeTab === 'survey-cad';
  const {
    isSettingsModalOpen,
    activeOptionsTab,
    settingsDraft,
    parseSettingsDraft,
    setParseSettingsDraft,
    crsCatalogGroupFilter,
    setCrsCatalogGroupFilter,
    crsSearchQuery,
    projectInstrumentsDraft,
    isAdjustedPointsTransformSelectOpen,
    adjustedPointsTransformSelectedDraft,
    selectedInstrumentDraft,
    openProjectOptions,
  } = projectOptionsState;
  const {
    parsedInputInstruments,
    currentRunSettingsSnapshot,
    pendingRunSettingDiffs,
    savedRunSnapshots,
    currentRunSnapshot,
    currentSavedRunSnapshot,
    comparisonSelection,
    baselineRunSnapshot,
    runComparisonSummary,
    recordRunSnapshot,
    comparisonCandidates,
    projectSession,
    activeProjectFileViews,
    currentProjectFile,
    projectSourceAccept,
    associatedProjectSettingsAccept,
    effectiveRunInput,
    projectRunValidation,
    effectiveRunIncludeFiles,
    triggerProjectSourceFileSelect,
    handleSaveProject,
    handleProjectFileChange,
    handleProjectSourceFileChange,
    createLocalProjectFromCurrentWorkspace,
    createBlankProjectFile,
    duplicateProjectFile,
    openFileTab,
    closeFileTab,
    switchActiveProjectFile,
    renameProjectFile,
    setProjectFileEnabled,
    reorderProjectFiles,
    deleteProjectFile,
    activeProjectRunFiles,
    setEditorInput,
    importReviewState,
    pendingAnglePromptFile,
    triggerFileSelect,
    triggerImportReviewSettingsFileSelect,
    handleFileChange,
    handleImportReviewSettingsFileChange,
    handleImportAnglePromptSetAngleMode,
    handleImportAnglePromptSetFaceMode,
    handleImportAnglePromptSetImportStyle,
    handleImportAnglePromptAccept,
    handleImportAnglePromptCancel,
    handleImportReviewToggleExclude,
    handleImportReviewToggleFixed,
    handleImportReviewSetBulkExcludeMta,
    handleImportReviewSetBulkExcludeRaw,
    handleImportReviewConvertSlopeZenithToHd2D,
    handleImportReviewSetGroupExcluded,
    handleImportConflictResolutionChange,
    handleImportConflictRenameValueChange,
    handleImportReviewCommentChange,
    handleImportReviewGroupLabelChange,
    handleImportReviewRowTextChange,
    handleImportReviewRowTypeChange,
    handleImportReviewPresetChange,
    handleImportReviewComparisonModeChange,
    handleImportReviewDuplicateRow,
    handleImportReviewInsertCommentBelow,
    handleImportReviewCreateSetupGroup,
    handleImportReviewCreateEmptySetupGroup,
    handleImportReviewMoveRow,
    handleImportReviewReorderRow,
    handleImportReviewRemoveRow,
    handleImportReviewRemoveGroup,
    handleCancelImportReview,
    handleImportReviewCompareFile,
    handleImportReviewClearComparison,
    handleApplyImportReview,
    handleApplyImportReviewAsNewFile,
    importReviewDisplayedRows,
    importReviewMoveTargetGroups,
    adjustedPointsDraftStationIds,
  } = projectWorkspaceState;
  const surveyCadParseOptions = useMemo(
    () => ({
      ...parseSettings,
      units: settings.units,
      sourceFile: activeProjectRunFiles[0]?.name ?? '<survey-cad>',
      includeFiles: effectiveRunIncludeFiles,
      projectRunFiles: activeProjectRunFiles,
      currentInstrument: selectedInstrument,
    }),
    [
      activeProjectRunFiles,
      effectiveRunIncludeFiles,
      parseSettings,
      selectedInstrument,
      settings.units,
    ],
  );
  const crsDraftCatalogState = useAppCrsDraftCatalog({
    parseSettingsDraft,
    setParseSettingsDraft,
    settingsDraft,
    crsCatalogGroupFilter,
    setCrsCatalogGroupFilter,
    crsSearchQuery,
  });

  useAppControllerEffects({
    result,
    setMapViewSnapshot,
    parsedInputInstruments,
    setProjectInstruments,
    projectInstruments,
    selectedInstrument,
    setSelectedInstrument,
    pendingEditorJumpLine,
    isSidebarOpen,
    inputPaneRef,
    setPendingEditorJumpLine,
    isSettingsModalOpen,
    activeOptionsTab,
    settingsDraft,
    parseSettingsDraft,
    projectInstrumentsDraft,
    selectedInstrumentDraft,
    settingsModalContentRef,
  });

  function normalizeSolveProfile(_profile: SolveProfile): SolveProfile {
    return 'industry-parity';
  }
  const activateReportTab = useCallback(() => {
    setActiveTab('report');
  }, [setActiveTab]);

  const runWorkflowState = useAppRunWorkflowShell({
    projectInstruments,
    selectedInstrument,
    defaultIndustryInstrumentCode: INDUSTRY_DEFAULT_INSTRUMENT_CODE,
    defaultIndustryInstrument: INDUSTRY_DEFAULT_INSTRUMENT,
    normalizeSolveProfile,
    projectSession,
    activeProjectRunFiles,
    result,
    runDiagnostics,
    settings,
    parseSettings,
    effectiveRunInput,
    lastRunInput,
    effectiveRunIncludeFiles,
    geoidSourceData,
    planningMap,
    currentRunSettingsSnapshot,
    setResult,
    setRunDiagnostics,
    setRunElapsedMs,
    setLastRunInput,
    setLastRunSettingsSnapshot,
    activateReportTab,
    recordRunSnapshot,
    projectRunValidation,
    setImportNotice,
  });
  const {
    pipelineState,
    cancelAdjustment,
    excludedIds,
    overrides,
    clusterReviewDecisions,
    activeClusterApprovedMerges,
    applyImpactExclusion,
    applyPreanalysisPlanningAction,
    applyAllPreanalysisPlanningActions,
    toggleExclude,
    clearExclusions,
    handleOverride,
    resetOverrides,
    handleClusterDecisionStatus,
    handleClusterCanonicalSelection,
    applyClusterReviewMerges,
    resetClusterReview,
    clearClusterApprovedMerges,
    handleValidatedRun,
  } = runWorkflowState;
  const handleInputChange = (value: string) => {
    setEditorInput(value);
    if (importNotice) setImportNotice(null);
  };
  const uiWorkflows = useAppControllerUiWorkflows({
    ...controllerState,
    ...workspaceState,
    ...projectOptionsState,
    ...crsDraftCatalogState,
    ...projectWorkspaceState,
    ...runWorkflowState,
    normalizeSolveProfile,
  });
  const { applyAdjustedPointsTransformSelection, canRenderTab, clearReviewQueueFilters, clearSelection, closeAdjustedPointsTransformSelectModal, discardRecoveredDraft, filteredReviewQueueItems, handleAdjustedPointsTransformToggleSelected, handleClearCurrentDraft, handleCompareSelectObservation, handleCompareSelectStation, handleCompareWithSavedRun, handleDeleteSavedRun, handleExportResults, handleFocusReportFilter, handleIndustryListingSortChange, handleJumpToSourceLine, handleLoadPlanningInputPoints, handleMapObservationSelection, handleMapStationSelection, handleNextUnresolvedQueueItem, handleOpenProjectWorkspacePanel, handleRenameSavedRun, handleReportObservationSelection, handleReportStationSelection, handleResetToLastRun, handleResidualThresholdChange, handleRestoreSavedRun, handleSaveCurrentSnapshot, handleSelectBaseline, handleSelectReviewQueueItem, handleStationThresholdChange, handleTogglePinBaseline, handleUpdateSavedRunNotes, handleWorkspaceTabChange, hasStoredDraft, hasSuspects, industryOutputText, mapResult, pendingRecovery, pinnedObservations, processingSummaryDiagnostics, projectOptionsModalContext, qaDerivedResult, recoverDraft, reportFilterFocusRequestKey, resetRunStateAfterImportedInputInternal, reviewQueueImportedGroupFilter, reviewQueueImportedGroupOptions, reviewQueueSeverityFilter, reviewQueueSourceFilter, reviewQueueUnresolvedOnly, runPhaseLabel, selectNextSuspect, selectObservation, selectPreviousSuspect, selectedObservation, selectedReviewQueueItemId, selectedStation, selection, setReviewQueueImportedGroupFilter, setReviewQueueSeverityFilter, setReviewQueueSourceFilter, setReviewQueueUnresolvedOnly, showRunComparisonPanel, togglePinnedObservation, workspaceReviewState } = uiWorkflows;
  function resetRunStateAfterImportedInput() {
    resetRunStateAfterImportedInputInternal();
  }

  return { fileInputRef, projectFileInputRef, projectSourceFileInputRef, importReviewSettingsFileInputRef, handleFileChange, handleProjectFileChange, handleProjectSourceFileChange, handleImportReviewSettingsFileChange, projectSourceAccept, associatedProjectSettingsAccept, isSidebarOpen, isSurveyCadWorkspaceActive, setIsSidebarOpen, openProjectOptions, setActiveTab, triggerFileSelect, handleOpenProjectWorkspacePanel, handleSaveProject, exportFormat, setExportFormat, handleExportResults, result, hasStoredDraft, handleClearCurrentDraft, selectedObservation, pinnedObservations, togglePinnedObservation, pipelineState, runPhaseLabel, pendingRunSettingDiffs, cancelAdjustment, handleValidatedRun, handleResetToLastRun, pendingRecovery, recoverDraft, discardRecoveredDraft, isSettingsModalOpen, projectOptionsModalContext, isAdjustedPointsTransformSelectOpen, adjustedPointsDraftStationIds, adjustedPointsTransformSelectedDraft, handleAdjustedPointsTransformToggleSelected, applyAdjustedPointsTransformSelection, closeAdjustedPointsTransformSelectModal, layoutRef, splitPercent, inputPaneRef, input, handleInputChange, projectSession, currentProjectFile, activeProjectFileViews, projectRunValidation, createLocalProjectFromCurrentWorkspace, triggerProjectSourceFileSelect, openFileTab, closeFileTab, switchActiveProjectFile, createBlankProjectFile, duplicateProjectFile, renameProjectFile, deleteProjectFile, setProjectFileEnabled, reorderProjectFiles, importNotice, setImportNotice, handleDividerMouseDown, effectiveRunInput, projectInstruments, surveyCadParseOptions, settings, surveyCadState, setSurveyCadState, showRunComparisonPanel, currentRunSnapshot, baselineRunSnapshot, comparisonCandidates, savedRunSnapshots, currentSavedRunSnapshot, comparisonSelection, runComparisonSummary, handleSaveCurrentSnapshot, handleRestoreSavedRun, handleCompareWithSavedRun, handleRenameSavedRun, handleUpdateSavedRunNotes, handleDeleteSavedRun, handleSelectBaseline, handleTogglePinBaseline, handleStationThresholdChange, handleResidualThresholdChange, handleCompareSelectStation, handleCompareSelectObservation, hasSuspects, selection, selectedStation, selectPreviousSuspect, selectNextSuspect, selectObservation, clearSelection, handleJumpToSourceLine, handleFocusReportFilter, filteredReviewQueueItems, selectedReviewQueueItemId, reviewQueueSeverityFilter, reviewQueueSourceFilter, reviewQueueUnresolvedOnly, reviewQueueImportedGroupFilter, reviewQueueImportedGroupOptions, setReviewQueueSeverityFilter, setReviewQueueSourceFilter, setReviewQueueUnresolvedOnly, setReviewQueueImportedGroupFilter, handleSelectReviewQueueItem, handleNextUnresolvedQueueItem, clearReviewQueueFilters, activeTab, handleWorkspaceTabChange, workspaceReviewState, runDiagnostics, excludedIds, toggleExclude, applyImpactExclusion, applyPreanalysisPlanningAction, applyAllPreanalysisPlanningActions, clearExclusions, overrides, handleOverride, resetOverrides, clusterReviewDecisions, activeClusterApprovedMerges, handleClusterDecisionStatus, handleClusterCanonicalSelection, applyClusterReviewMerges, resetClusterReview, clearClusterApprovedMerges, reportFilterFocusRequestKey, handleReportStationSelection, handleReportObservationSelection, canRenderTab, runElapsedMs, processingSummaryDiagnostics, industryOutputText, handleIndustryListingSortChange, mapResult, planningMap, setPlanningMap, planningMapPreview, handleLoadPlanningInputPoints, adjustedPointsExportSettings, qaDerivedResult, handleMapStationSelection, handleMapObservationSelection, mapViewSnapshot, setMapViewSnapshot, pendingAnglePromptFile, handleImportAnglePromptSetImportStyle, handleImportAnglePromptSetAngleMode, handleImportAnglePromptSetFaceMode, handleImportAnglePromptCancel, handleImportAnglePromptAccept, importReviewState, importReviewDisplayedRows, importReviewMoveTargetGroups, handleImportReviewCompareFile, handleImportReviewClearComparison, handleImportReviewComparisonModeChange, handleImportReviewPresetChange, handleImportReviewSetBulkExcludeMta, handleImportReviewSetBulkExcludeRaw, handleImportReviewConvertSlopeZenithToHd2D, handleImportReviewSetGroupExcluded, handleImportConflictResolutionChange, handleImportConflictRenameValueChange, handleImportReviewToggleExclude, handleImportReviewToggleFixed, handleImportReviewCreateEmptySetupGroup, handleImportReviewGroupLabelChange, handleImportReviewCommentChange, handleImportReviewRowTextChange, handleImportReviewRowTypeChange, handleImportReviewDuplicateRow, handleImportReviewInsertCommentBelow, handleImportReviewCreateSetupGroup, handleImportReviewMoveRow, handleImportReviewReorderRow, handleImportReviewRemoveGroup, handleImportReviewRemoveRow, handleCancelImportReview, handleApplyImportReviewAsNewFile, triggerImportReviewSettingsFileSelect, handleApplyImportReview };
};
