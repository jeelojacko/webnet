import React from 'react';
import AppToolbar from '../AppToolbar';
import WorkspaceRecoveryBanner from '../WorkspaceRecoveryBanner';
import AdjustedPointsTransformSelectModal from './AdjustedPointsTransformSelectModal';
import AppImportReviewModal from './AppImportReviewModal';
import AppWorkspaceLayout from './AppWorkspaceLayout';
import ImportAnglePromptModal from './ImportAnglePromptModal';
import { ProjectOptionsModal } from '../../app/AppLazyViews';
import { IMPORT_FILE_ACCEPT, PROJECT_FILE_ACCEPT } from '../../app/appConfig';
import { getExportFormatLabel, getExportFormatTooltip } from '../../app/appHelpers';
import type { useAppController } from '../../hooks/useAppController';

type AppShellProps = {
  controller: ReturnType<typeof useAppController>;
};

const AppShell = ({ controller }: AppShellProps) => {
  const {
    fileInputRef, projectFileInputRef, projectSourceFileInputRef, importReviewSettingsFileInputRef, handleFileChange,
    handleProjectFileChange, handleProjectSourceFileChange, handleImportReviewSettingsFileChange, projectSourceAccept, associatedProjectSettingsAccept,
    isSidebarOpen, isSurveyCadWorkspaceActive, setIsSidebarOpen, openProjectOptions, setActiveTab,
    triggerFileSelect, handleOpenProjectWorkspacePanel, handleSaveProject, exportFormat, setExportFormat,
    handleExportResults, result, hasStoredDraft, handleClearCurrentDraft, selectedObservation,
    pinnedObservations, togglePinnedObservation, pipelineState, runPhaseLabel, pendingRunSettingDiffs,
    cancelAdjustment, handleValidatedRun, handleResetToLastRun, pendingRecovery, recoverDraft,
    discardRecoveredDraft, isSettingsModalOpen, projectOptionsModalContext, isAdjustedPointsTransformSelectOpen, adjustedPointsDraftStationIds,
    adjustedPointsTransformSelectedDraft, handleAdjustedPointsTransformToggleSelected, applyAdjustedPointsTransformSelection, closeAdjustedPointsTransformSelectModal, layoutRef,
    splitPercent, inputPaneRef, input, handleInputChange, projectSession,
    currentProjectFile, activeProjectFileViews, projectRunValidation, createLocalProjectFromCurrentWorkspace, triggerProjectSourceFileSelect,
    openFileTab, closeFileTab, switchActiveProjectFile, createBlankProjectFile, duplicateProjectFile,
    renameProjectFile, deleteProjectFile, setProjectFileEnabled, reorderProjectFiles, importNotice,
    setImportNotice, handleDividerMouseDown, effectiveRunInput, projectInstruments, surveyCadParseOptions,
    settings, surveyCadState, setSurveyCadState, showRunComparisonPanel, currentRunSnapshot,
    baselineRunSnapshot, comparisonCandidates, savedRunSnapshots, currentSavedRunSnapshot, comparisonSelection,
    runComparisonSummary, handleSaveCurrentSnapshot, handleRestoreSavedRun, handleCompareWithSavedRun, handleRenameSavedRun,
    handleUpdateSavedRunNotes, handleDeleteSavedRun, handleSelectBaseline, handleTogglePinBaseline, handleStationThresholdChange,
    handleResidualThresholdChange, handleCompareSelectStation, handleCompareSelectObservation, hasSuspects, selection,
    selectedStation, selectPreviousSuspect, selectNextSuspect, selectObservation, clearSelection,
    handleJumpToSourceLine, handleFocusReportFilter, filteredReviewQueueItems, selectedReviewQueueItemId, reviewQueueSeverityFilter,
    reviewQueueSourceFilter, reviewQueueUnresolvedOnly, reviewQueueImportedGroupFilter, reviewQueueImportedGroupOptions, setReviewQueueSeverityFilter,
    setReviewQueueSourceFilter, setReviewQueueUnresolvedOnly, setReviewQueueImportedGroupFilter, handleSelectReviewQueueItem, handleNextUnresolvedQueueItem,
    clearReviewQueueFilters, activeTab, handleWorkspaceTabChange, workspaceReviewState, runDiagnostics,
    excludedIds, toggleExclude, applyImpactExclusion, applyPreanalysisPlanningAction, applyAllPreanalysisPlanningActions,
    clearExclusions, overrides, handleOverride, resetOverrides, clusterReviewDecisions,
    activeClusterApprovedMerges, handleClusterDecisionStatus, handleClusterCanonicalSelection, applyClusterReviewMerges, resetClusterReview,
    clearClusterApprovedMerges, reportFilterFocusRequestKey, handleReportStationSelection, handleReportObservationSelection, canRenderTab,
    runElapsedMs, processingSummaryDiagnostics, industryOutputText, handleIndustryListingSortChange, mapResult,
    planningMap, setPlanningMap, planningMapPreview, handleLoadPlanningInputPoints, adjustedPointsExportSettings,
    qaDerivedResult, handleMapStationSelection, handleMapObservationSelection, mapViewSnapshot, setMapViewSnapshot,
    pendingAnglePromptFile, handleImportAnglePromptSetImportStyle, handleImportAnglePromptSetAngleMode, handleImportAnglePromptSetFaceMode, handleImportAnglePromptCancel,
    handleImportAnglePromptAccept, importReviewState, importReviewDisplayedRows, importReviewMoveTargetGroups, handleImportReviewCompareFile,
    handleImportReviewClearComparison, handleImportReviewComparisonModeChange, handleImportReviewPresetChange, handleImportReviewSetBulkExcludeMta, handleImportReviewSetBulkExcludeRaw,
    handleImportReviewConvertSlopeZenithToHd2D, handleImportReviewSetGroupExcluded, handleImportConflictResolutionChange, handleImportConflictRenameValueChange, handleImportReviewToggleExclude,
    handleImportReviewToggleFixed, handleImportReviewCreateEmptySetupGroup, handleImportReviewGroupLabelChange, handleImportReviewCommentChange, handleImportReviewRowTextChange,
    handleImportReviewRowTypeChange, handleImportReviewDuplicateRow, handleImportReviewInsertCommentBelow, handleImportReviewCreateSetupGroup, handleImportReviewMoveRow,
    handleImportReviewReorderRow, handleImportReviewRemoveGroup, handleImportReviewRemoveRow, handleCancelImportReview, handleApplyImportReviewAsNewFile,
    triggerImportReviewSettingsFileSelect, handleApplyImportReview,
  } = controller;

    return (
    <div className="fixed inset-0 flex flex-col bg-slate-900 text-slate-100 font-sans overflow-hidden">
      <input
        ref={fileInputRef}
        type="file"
        accept={IMPORT_FILE_ACCEPT}
        className="hidden"
        multiple
        onChange={handleFileChange}
      />
      <input
        ref={projectFileInputRef}
        type="file"
        accept={`${PROJECT_FILE_ACCEPT},.zip`}
        className="hidden"
        onChange={handleProjectFileChange}
      />
      <input
        ref={projectSourceFileInputRef}
        type="file"
        accept={projectSourceAccept}
        className="hidden"
        multiple
        onChange={handleProjectSourceFileChange}
      />
      <input
        ref={importReviewSettingsFileInputRef}
        type="file"
        accept={associatedProjectSettingsAccept}
        className="hidden"
        onChange={handleImportReviewSettingsFileChange}
      />
      <AppToolbar
        isSidebarOpen={isSidebarOpen}
        showSidebarToggle={!isSurveyCadWorkspaceActive}
        isSurveyCadActive={isSurveyCadWorkspaceActive}
        onToggleSidebar={() => setIsSidebarOpen(!isSidebarOpen)}
        onOpenProjectOptions={openProjectOptions}
        onOpenSurveyCad={() => setActiveTab(isSurveyCadWorkspaceActive ? 'report' : 'survey-cad')}
        onOpenStudy={() => {
          window.location.href = '/study';
        }}
        onOpenImportFile={() => triggerFileSelect()}
        onOpenProjectFile={handleOpenProjectWorkspacePanel}
        onSaveProject={handleSaveProject}
        exportFormat={exportFormat}
        onExportFormatChange={setExportFormat}
        exportTooltip={getExportFormatTooltip(exportFormat)}
        exportLabel={getExportFormatLabel(exportFormat)}
        onExportResults={handleExportResults}
        canExport={!!result}
        hasStoredDraft={hasStoredDraft}
        onClearCurrentDraft={handleClearCurrentDraft}
        selectedObservationId={selectedObservation?.id ?? null}
        isSelectedObservationPinned={
          selectedObservation != null &&
          pinnedObservations.some((entry) => entry.id === selectedObservation.id)
        }
        onTogglePinSelectedObservation={() => {
          if (selectedObservation) togglePinnedObservation(selectedObservation.id);
        }}
        pipelineState={pipelineState}
        runPhaseLabel={runPhaseLabel}
        pendingRunSettingDiffs={pendingRunSettingDiffs}
        onCancelRun={cancelAdjustment}
        onRun={handleValidatedRun}
        onResetToLastRun={handleResetToLastRun}
      />
      {pendingRecovery && (
        <WorkspaceRecoveryBanner
          savedAt={new Date(pendingRecovery.savedAt).toLocaleString()}
          onRecover={recoverDraft}
          onDiscard={discardRecoveredDraft}
        />
      )}

      <React.Suspense
        fallback={
          isSettingsModalOpen ? (
            <div className="fixed inset-0 z-50 bg-slate-950/70 flex items-start justify-center p-4 md:p-10">
              <div className="w-full max-w-5xl bg-slate-600 border border-slate-400 shadow-2xl text-slate-100">
                <div className="flex items-center justify-between border-b border-slate-400 bg-slate-700 px-4 py-2">
                  <div className="text-sm font-semibold tracking-wide">Project Options</div>
                </div>
                <div className="bg-slate-500 p-4 text-xs text-slate-200">
                  Loading project options...
                </div>
              </div>
            </div>
          ) : null
        }
      >
        <ProjectOptionsModal context={projectOptionsModalContext} />
      </React.Suspense>

      {isSettingsModalOpen && isAdjustedPointsTransformSelectOpen && (
        <AdjustedPointsTransformSelectModal
          stationIds={adjustedPointsDraftStationIds}
          selectedStationIds={adjustedPointsTransformSelectedDraft}
          onToggleStation={handleAdjustedPointsTransformToggleSelected}
          onApply={applyAdjustedPointsTransformSelection}
          onClose={closeAdjustedPointsTransformSelectModal}
        />
      )}

      <AppWorkspaceLayout
        layoutRef={layoutRef}
        isSurveyCadWorkspaceActive={isSurveyCadWorkspaceActive}
        isSidebarOpen={isSidebarOpen}
        splitPercent={splitPercent}
        inputPaneRef={inputPaneRef}
        input={input}
        handleInputChange={handleInputChange}
        projectSession={projectSession}
        currentProjectFile={currentProjectFile}
        activeProjectFileViews={activeProjectFileViews}
        projectRunValidation={projectRunValidation}
        handleOpenProjectWorkspacePanel={handleOpenProjectWorkspacePanel}
        createLocalProjectFromCurrentWorkspace={createLocalProjectFromCurrentWorkspace}
        triggerProjectSourceFileSelect={triggerProjectSourceFileSelect}
        openFileTab={openFileTab}
        closeFileTab={closeFileTab}
        switchActiveProjectFile={switchActiveProjectFile}
        createBlankProjectFile={createBlankProjectFile}
        duplicateProjectFile={duplicateProjectFile}
        renameProjectFile={renameProjectFile}
        deleteProjectFile={deleteProjectFile}
        setProjectFileEnabled={setProjectFileEnabled}
        reorderProjectFiles={reorderProjectFiles}
        importNotice={importNotice}
        setImportNotice={setImportNotice}
        handleDividerMouseDown={handleDividerMouseDown}
        effectiveRunInput={effectiveRunInput}
        projectInstruments={projectInstruments}
        surveyCadParseOptions={surveyCadParseOptions}
        units={settings.units}
        result={result}
        surveyCadState={surveyCadState}
        setSurveyCadState={setSurveyCadState}
        settingsShowRunComparisonPanel={settings.showRunComparisonPanel}
        showRunComparisonPanel={showRunComparisonPanel}
        runComparisonPanelProps={{
          currentSnapshot: currentRunSnapshot,
          baselineSnapshot: baselineRunSnapshot,
          comparisonCandidates,
          savedRunSnapshots,
          currentSavedRunId: currentSavedRunSnapshot?.id ?? null,
          isCurrentSnapshotSaved: currentSavedRunSnapshot != null,
          comparisonSelection,
          comparisonSummary: runComparisonSummary,
          onSaveCurrentSnapshot: handleSaveCurrentSnapshot,
          onRestoreSavedRun: handleRestoreSavedRun,
          onCompareWithSavedRun: handleCompareWithSavedRun,
          onRenameSavedRun: handleRenameSavedRun,
          onUpdateSavedRunNotes: handleUpdateSavedRunNotes,
          onDeleteSavedRun: handleDeleteSavedRun,
          onSelectBaseline: handleSelectBaseline,
          onTogglePinBaseline: handleTogglePinBaseline,
          onStationThresholdChange: handleStationThresholdChange,
          onResidualThresholdChange: handleResidualThresholdChange,
          onSelectStation: handleCompareSelectStation,
          onSelectObservation: handleCompareSelectObservation,
        }}
        hasSuspects={hasSuspects}
        selection={selection}
        selectedObservation={selectedObservation}
        selectedStation={selectedStation}
        pinnedObservations={pinnedObservations}
        selectPreviousSuspect={selectPreviousSuspect}
        selectNextSuspect={selectNextSuspect}
        togglePinnedObservation={togglePinnedObservation}
        selectObservation={selectObservation}
        clearSelection={clearSelection}
        handleJumpToSourceLine={handleJumpToSourceLine}
        handleFocusReportFilter={handleFocusReportFilter}
        setActiveTab={setActiveTab}
        settingsShowReviewQueuePanel={settings.showReviewQueuePanel}
        reviewQueueProps={{
          items: filteredReviewQueueItems,
          selectedItemId: selectedReviewQueueItemId,
          severityFilter: reviewQueueSeverityFilter,
          sourceFilter: reviewQueueSourceFilter,
          unresolvedOnly: reviewQueueUnresolvedOnly,
          importedGroupFilter: reviewQueueImportedGroupFilter,
          importedGroupOptions: reviewQueueImportedGroupOptions,
          onSeverityFilterChange: setReviewQueueSeverityFilter,
          onSourceFilterChange: setReviewQueueSourceFilter,
          onUnresolvedOnlyChange: setReviewQueueUnresolvedOnly,
          onImportedGroupFilterChange: setReviewQueueImportedGroupFilter,
          onSelectItem: handleSelectReviewQueueItem,
          onNextUnresolved: handleNextUnresolvedQueueItem,
          onClearFilters: clearReviewQueueFilters,
        }}
        activeTab={activeTab}
        handleWorkspaceTabChange={handleWorkspaceTabChange}
        setIsSidebarOpen={setIsSidebarOpen}
        workspaceReviewState={workspaceReviewState}
        runDiagnostics={runDiagnostics}
        excludedIds={excludedIds}
        toggleExclude={toggleExclude}
        applyImpactExclusion={applyImpactExclusion}
        applyPreanalysisPlanningAction={applyPreanalysisPlanningAction}
        applyAllPreanalysisPlanningActions={applyAllPreanalysisPlanningActions}
        handleValidatedRun={handleValidatedRun}
        clearExclusions={clearExclusions}
        pendingRunSettingDiffs={pendingRunSettingDiffs}
        overrides={overrides}
        handleOverride={handleOverride}
        resetOverrides={resetOverrides}
        clusterReviewDecisions={clusterReviewDecisions}
        activeClusterApprovedMerges={activeClusterApprovedMerges}
        handleClusterDecisionStatus={handleClusterDecisionStatus}
        handleClusterCanonicalSelection={handleClusterCanonicalSelection}
        applyClusterReviewMerges={applyClusterReviewMerges}
        resetClusterReview={resetClusterReview}
        clearClusterApprovedMerges={clearClusterApprovedMerges}
        reportFilterFocusRequestKey={reportFilterFocusRequestKey}
        handleReportStationSelection={handleReportStationSelection}
        handleReportObservationSelection={handleReportObservationSelection}
        canRenderTab={canRenderTab}
        runElapsedMs={runElapsedMs}
        processingSummaryDiagnostics={processingSummaryDiagnostics}
        industryOutputText={industryOutputText}
        listingSortObservationsBy={settings.listingSortObservationsBy}
        handleIndustryListingSortChange={handleIndustryListingSortChange}
        mapResult={mapResult}
        planningMap={planningMap}
        setPlanningMap={setPlanningMap}
        planningMapPreview={planningMapPreview}
        handleLoadPlanningInputPoints={handleLoadPlanningInputPoints}
        mapShowLostStations={settings.mapShowLostStations}
        map3dEnabled={settings.map3dEnabled}
        adjustedPointsExportSettings={adjustedPointsExportSettings}
        qaDerivedResult={qaDerivedResult}
        handleMapStationSelection={handleMapStationSelection}
        handleMapObservationSelection={handleMapObservationSelection}
        mapViewSnapshot={mapViewSnapshot}
        setMapViewSnapshot={setMapViewSnapshot}
      />

      {pendingAnglePromptFile && (
        <ImportAnglePromptModal
          pendingFile={pendingAnglePromptFile}
          onSetImportStyle={handleImportAnglePromptSetImportStyle}
          onSetAngleMode={handleImportAnglePromptSetAngleMode}
          onSetFaceMode={handleImportAnglePromptSetFaceMode}
          onCancel={handleImportAnglePromptCancel}
          onAccept={handleImportAnglePromptAccept}
        />
      )}

      <AppImportReviewModal
        importReviewState={importReviewState}
        displayedRows={importReviewDisplayedRows}
        moveTargetGroups={importReviewMoveTargetGroups}
        onCompareFile={handleImportReviewCompareFile}
        onClearComparison={handleImportReviewClearComparison}
        onComparisonModeChange={handleImportReviewComparisonModeChange}
        onPresetChange={handleImportReviewPresetChange}
        onSetBulkExcludeMta={handleImportReviewSetBulkExcludeMta}
        onSetBulkExcludeRaw={handleImportReviewSetBulkExcludeRaw}
        onConvertSlopeZenithToHd2D={handleImportReviewConvertSlopeZenithToHd2D}
        onSetGroupExcluded={handleImportReviewSetGroupExcluded}
        onConflictResolutionChange={handleImportConflictResolutionChange}
        onConflictRenameValueChange={handleImportConflictRenameValueChange}
        onToggleExclude={handleImportReviewToggleExclude}
        onToggleFixed={handleImportReviewToggleFixed}
        onCreateEmptySetupGroup={handleImportReviewCreateEmptySetupGroup}
        onGroupLabelChange={handleImportReviewGroupLabelChange}
        onCommentChange={handleImportReviewCommentChange}
        onRowTextChange={handleImportReviewRowTextChange}
        onRowTypeChange={handleImportReviewRowTypeChange}
        onDuplicateRow={handleImportReviewDuplicateRow}
        onInsertCommentBelow={handleImportReviewInsertCommentBelow}
        onCreateSetupGroup={handleImportReviewCreateSetupGroup}
        onMoveRow={handleImportReviewMoveRow}
        onReorderRow={handleImportReviewReorderRow}
        onRemoveGroup={handleImportReviewRemoveGroup}
        onRemoveRow={handleImportReviewRemoveRow}
        onCancel={handleCancelImportReview}
        onApplyImportReviewAsNewFile={handleApplyImportReviewAsNewFile}
        onImportAssociatedProjectSettings={triggerImportReviewSettingsFileSelect}
        onApplyImportReview={handleApplyImportReview}
      />
    </div>
  );
};

export default AppShell;
