import React, { type Dispatch, type RefObject, type SetStateAction } from 'react';
import { type InputPaneHandle } from '../InputPane';
import RunComparisonPanel from '../RunComparisonPanel';
import ReviewQueuePanel from '../ReviewQueuePanel';
import SurveyCadWorkspace from '../SurveyCadWorkspace';
import AppInputSidebar from './AppInputSidebar';
import AppWorkspaceTabs from './AppWorkspaceTabs';
import {
  AppWorkspaceReviewActions,
  AppWorkspaceSelectionBar,
} from './AppWorkspaceReviewControls';
import { MapView, ProcessingSummaryView, ReportView } from '../../app/AppLazyViews';
import type { useAppReviewQueue } from '../../hooks/useAppReviewQueue';
import type { useAppRunComparisonPanel } from '../../hooks/useAppRunComparisonPanel';
import type { useAppRunWorkspaceReview } from '../../hooks/useAppRunWorkspaceReview';
import type { useAppProjectImportWorkspace } from '../../hooks/useAppProjectImportWorkspace';
import type { useProjectFileWorkflow } from '../../hooks/useProjectFileWorkflow';
import type {
  ListingSortObservationsBy,
  RunDiagnostics,
  WorkspaceTabKey,
} from '../../appStateTypes';
import type { ImportedInputNotice } from '../../engine/importers';
import type {
  AdjustedPointsExportSettings,
  ClusterApprovedMerge,
  InstrumentLibrary,
  ObservationOverride,
  ParseOptions,
} from '../../types';
import type { AdjustmentResult } from '../../types';
import type { MapViewSnapshot } from '../MapView';

type WorkspaceReview = ReturnType<typeof useAppRunWorkspaceReview>;
type WorkspaceReviewState = WorkspaceReview['workspaceReviewState'];
type RunComparison = ReturnType<typeof useAppRunComparisonPanel>;
type ReviewQueue = ReturnType<typeof useAppReviewQueue>;
type ProjectWorkflowResult = ReturnType<typeof useProjectFileWorkflow>;
type ImportWorkspace = ReturnType<typeof useAppProjectImportWorkspace>;
type ProjectSession = ImportWorkspace['projectSession'];
type SurveyCadState = React.ComponentProps<typeof SurveyCadWorkspace>['persistedState'];

export type AppWorkspaceLayoutProps = {
  layoutRef: RefObject<HTMLDivElement | null>;
  isSurveyCadWorkspaceActive: boolean;
  isSidebarOpen: boolean;
  splitPercent: number;
  inputPaneRef: RefObject<InputPaneHandle | null>;
  input: string;
  handleInputChange: (_value: string) => void;
  projectSession: ProjectSession;
  currentProjectFile: { name: string } | null;
  activeProjectFileViews: ProjectWorkflowResult['activeProjectFileViews'];
  projectRunValidation: ProjectWorkflowResult['projectRunValidation'];
  handleOpenProjectWorkspacePanel: () => void;
  createLocalProjectFromCurrentWorkspace: () => Promise<unknown> | void;
  triggerProjectSourceFileSelect: () => Promise<unknown> | void;
  openFileTab: ProjectWorkflowResult['openFileTab'];
  closeFileTab: ProjectWorkflowResult['closeFileTab'];
  switchActiveProjectFile: ProjectWorkflowResult['switchActiveProjectFile'];
  createBlankProjectFile: ProjectWorkflowResult['createBlankProjectFile'];
  duplicateProjectFile: ProjectWorkflowResult['duplicateProjectFile'];
  renameProjectFile: ProjectWorkflowResult['renameProjectFile'];
  deleteProjectFile: ProjectWorkflowResult['deleteProjectFile'];
  setProjectFileEnabled: ProjectWorkflowResult['setProjectFileEnabled'];
  reorderProjectFiles: ProjectWorkflowResult['reorderProjectFiles'];
  importNotice: ImportedInputNotice | null;
  setImportNotice: Dispatch<SetStateAction<ImportedInputNotice | null>>;
  handleDividerMouseDown: (_e: React.MouseEvent<HTMLDivElement>) => void;
  effectiveRunInput: string;
  projectInstruments: InstrumentLibrary;
  surveyCadParseOptions: ParseOptions;
  units: React.ComponentProps<typeof ReportView>['units'];
  result: AdjustmentResult | null;
  surveyCadState: SurveyCadState;
  setSurveyCadState: React.ComponentProps<typeof SurveyCadWorkspace>['onPersistedStateChange'];
  settingsShowRunComparisonPanel: boolean;
  showRunComparisonPanel: RunComparison['showRunComparisonPanel'];
  runComparisonPanelProps: Omit<
    React.ComponentProps<typeof RunComparisonPanel>,
    'reviewActionsContent'
  >;
  hasSuspects: WorkspaceReviewState['hasSuspects'];
  selection: WorkspaceReviewState['selection'];
  selectedObservation: WorkspaceReviewState['selectedObservation'];
  selectedStation: WorkspaceReviewState['selectedStation'];
  pinnedObservations: WorkspaceReviewState['pinnedObservations'];
  selectPreviousSuspect: WorkspaceReviewState['selectPreviousSuspect'];
  selectNextSuspect: WorkspaceReviewState['selectNextSuspect'];
  togglePinnedObservation: WorkspaceReviewState['togglePinnedObservation'];
  selectObservation: WorkspaceReviewState['selectObservation'];
  clearSelection: WorkspaceReviewState['clearSelection'];
  handleJumpToSourceLine: ReviewQueue['handleJumpToSourceLine'];
  handleFocusReportFilter: ReviewQueue['handleFocusReportFilter'];
  setActiveTab: (_tab: WorkspaceTabKey) => void;
  settingsShowReviewQueuePanel: boolean;
  reviewQueueProps: React.ComponentProps<typeof ReviewQueuePanel>;
  activeTab: WorkspaceTabKey;
  handleWorkspaceTabChange: WorkspaceReview['handleWorkspaceTabChange'];
  setIsSidebarOpen: (_isOpen: boolean) => void;
  workspaceReviewState: WorkspaceReviewState;
  runDiagnostics: RunDiagnostics | null;
  excludedIds: Set<number>;
  toggleExclude: (_id: number) => void;
  applyImpactExclusion: (_id: number) => void;
  applyPreanalysisPlanningAction: React.ComponentProps<typeof ReportView>['onApplyPreanalysisAction'];
  applyAllPreanalysisPlanningActions: React.ComponentProps<typeof ReportView>['onApplyAllPreanalysisActions'];
  handleValidatedRun: () => void;
  clearExclusions: React.ComponentProps<typeof ReportView>['onClearExclusions'];
  pendingRunSettingDiffs: string[];
  overrides: Record<number, ObservationOverride>;
  handleOverride: (_id: number, _override: ObservationOverride) => void;
  resetOverrides: () => void;
  clusterReviewDecisions: React.ComponentProps<typeof ReportView>['clusterReviewDecisions'];
  activeClusterApprovedMerges: ClusterApprovedMerge[];
  handleClusterDecisionStatus: React.ComponentProps<typeof ReportView>['onClusterDecisionStatus'];
  handleClusterCanonicalSelection: React.ComponentProps<typeof ReportView>['onClusterCanonicalSelection'];
  applyClusterReviewMerges: () => void;
  resetClusterReview: () => void;
  clearClusterApprovedMerges: React.ComponentProps<typeof ReportView>['onClearClusterMerges'];
  reportFilterFocusRequestKey: number;
  handleReportStationSelection: WorkspaceReview['handleReportStationSelection'];
  handleReportObservationSelection: WorkspaceReview['handleReportObservationSelection'];
  canRenderTab: (_tab: WorkspaceTabKey) => boolean;
  runElapsedMs: number | null;
  processingSummaryDiagnostics: React.ComponentProps<typeof ProcessingSummaryView>['runDiagnostics'];
  industryOutputText: string;
  listingSortObservationsBy: ListingSortObservationsBy;
  handleIndustryListingSortChange: (_value: ListingSortObservationsBy) => void;
  mapResult: AdjustmentResult;
  planningMap: React.ComponentProps<typeof MapView>['planningMap'];
  setPlanningMap: React.ComponentProps<typeof MapView>['onPlanningMapChange'];
  planningMapPreview: unknown;
  handleLoadPlanningInputPoints: () => void;
  mapShowLostStations: boolean;
  map3dEnabled: boolean;
  adjustedPointsExportSettings: AdjustedPointsExportSettings;
  qaDerivedResult: React.ComponentProps<typeof MapView>['derivedResult'];
  handleMapStationSelection: WorkspaceReview['handleMapStationSelection'];
  handleMapObservationSelection: WorkspaceReview['handleMapObservationSelection'];
  mapViewSnapshot: MapViewSnapshot | null;
  setMapViewSnapshot: (_snapshot: MapViewSnapshot | null) => void;
};

const AppWorkspaceLayout = ({
  layoutRef,
  isSurveyCadWorkspaceActive,
  isSidebarOpen,
  splitPercent,
  inputPaneRef,
  input,
  handleInputChange,
  projectSession,
  currentProjectFile,
  activeProjectFileViews,
  projectRunValidation,
  handleOpenProjectWorkspacePanel,
  createLocalProjectFromCurrentWorkspace,
  triggerProjectSourceFileSelect,
  openFileTab,
  closeFileTab,
  switchActiveProjectFile,
  createBlankProjectFile,
  duplicateProjectFile,
  renameProjectFile,
  deleteProjectFile,
  setProjectFileEnabled,
  reorderProjectFiles,
  importNotice,
  setImportNotice,
  handleDividerMouseDown,
  effectiveRunInput,
  projectInstruments,
  surveyCadParseOptions,
  units,
  result,
  surveyCadState,
  setSurveyCadState,
  settingsShowRunComparisonPanel,
  showRunComparisonPanel,
  runComparisonPanelProps,
  hasSuspects,
  selection,
  selectedObservation,
  selectedStation,
  pinnedObservations,
  selectPreviousSuspect,
  selectNextSuspect,
  togglePinnedObservation,
  selectObservation,
  clearSelection,
  handleJumpToSourceLine,
  handleFocusReportFilter,
  setActiveTab,
  settingsShowReviewQueuePanel,
  reviewQueueProps,
  activeTab,
  handleWorkspaceTabChange,
  setIsSidebarOpen,
  workspaceReviewState,
  runDiagnostics,
  excludedIds,
  toggleExclude,
  applyImpactExclusion,
  applyPreanalysisPlanningAction,
  applyAllPreanalysisPlanningActions,
  handleValidatedRun,
  clearExclusions,
  pendingRunSettingDiffs,
  overrides,
  handleOverride,
  resetOverrides,
  clusterReviewDecisions,
  activeClusterApprovedMerges,
  handleClusterDecisionStatus,
  handleClusterCanonicalSelection,
  applyClusterReviewMerges,
  resetClusterReview,
  clearClusterApprovedMerges,
  reportFilterFocusRequestKey,
  handleReportStationSelection,
  handleReportObservationSelection,
  canRenderTab,
  runElapsedMs,
  processingSummaryDiagnostics,
  industryOutputText,
  listingSortObservationsBy,
  handleIndustryListingSortChange,
  mapResult,
  planningMap,
  setPlanningMap,
  planningMapPreview,
  handleLoadPlanningInputPoints,
  mapShowLostStations,
  map3dEnabled,
  adjustedPointsExportSettings,
  qaDerivedResult,
  handleMapStationSelection,
  handleMapObservationSelection,
  mapViewSnapshot,
  setMapViewSnapshot,
}: AppWorkspaceLayoutProps) => (
  <div ref={layoutRef} className="flex-1 flex overflow-hidden w-full">
    {!isSurveyCadWorkspaceActive && isSidebarOpen && (
      <AppInputSidebar
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
        />
    )}

    <div className="flex flex-col bg-slate-950 flex-1 min-w-0 overflow-hidden">
      {isSurveyCadWorkspaceActive ? (
        <SurveyCadWorkspace
          input={effectiveRunInput}
          instrumentLibrary={projectInstruments}
          parseOptions={surveyCadParseOptions}
          units={units}
          result={result}
          persistedState={surveyCadState}
          onPersistedStateChange={setSurveyCadState}
        />
      ) : (
        <>
          {settingsShowRunComparisonPanel && showRunComparisonPanel && (
            <RunComparisonPanel
              {...runComparisonPanelProps}
              reviewActionsContent={
                <AppWorkspaceReviewActions
                  hasSuspects={hasSuspects}
                  selectedObservation={selectedObservation}
                  pinnedObservations={pinnedObservations}
                  sourceLine={selection.sourceLine}
                  selectPreviousSuspect={selectPreviousSuspect}
                  selectNextSuspect={selectNextSuspect}
                  togglePinnedObservation={togglePinnedObservation}
                  handleJumpToSourceLine={handleJumpToSourceLine}
                  handleFocusReportFilter={handleFocusReportFilter}
                  setActiveTab={setActiveTab}
                />
              }
            />
          )}
          {settingsShowReviewQueuePanel && <ReviewQueuePanel {...reviewQueueProps} />}
          <AppWorkspaceSelectionBar
            selectedObservation={selectedObservation}
            selectedStation={selectedStation}
            pinnedObservations={pinnedObservations}
            selectObservation={selectObservation}
            clearSelection={clearSelection}
            setActiveTab={setActiveTab}
          />
          <AppWorkspaceTabs
            activeTab={activeTab}
            handleWorkspaceTabChange={handleWorkspaceTabChange}
            isSidebarOpen={isSidebarOpen}
            setIsSidebarOpen={setIsSidebarOpen}
            result={result}
            units={units}
            workspaceReviewState={workspaceReviewState}
            runDiagnostics={runDiagnostics}
            excludedIds={excludedIds}
            toggleExclude={toggleExclude}
            applyImpactExclusion={applyImpactExclusion}
            applyPreanalysisPlanningAction={applyPreanalysisPlanningAction}
            applyAllPreanalysisPlanningActions={applyAllPreanalysisPlanningActions}
            handleValidatedRun={handleValidatedRun}
            clearExclusions={clearExclusions}
            handleJumpToSourceLine={handleJumpToSourceLine}
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
            selection={selection}
            handleReportStationSelection={handleReportStationSelection}
            handleReportObservationSelection={handleReportObservationSelection}
            canRenderTab={canRenderTab}
            runElapsedMs={runElapsedMs}
            processingSummaryDiagnostics={processingSummaryDiagnostics}
            industryOutputText={industryOutputText}
            listingSortObservationsBy={listingSortObservationsBy}
            handleIndustryListingSortChange={handleIndustryListingSortChange}
            mapResult={mapResult}
            planningMap={planningMap}
            setPlanningMap={setPlanningMap}
            planningMapPreview={planningMapPreview}
            handleLoadPlanningInputPoints={handleLoadPlanningInputPoints}
            mapShowLostStations={mapShowLostStations}
            map3dEnabled={map3dEnabled}
            adjustedPointsExportSettings={adjustedPointsExportSettings}
            qaDerivedResult={qaDerivedResult}
            handleMapStationSelection={handleMapStationSelection}
            handleMapObservationSelection={handleMapObservationSelection}
            mapViewSnapshot={mapViewSnapshot}
            setMapViewSnapshot={setMapViewSnapshot}
          />
        </>
      )}
    </div>
  </div>
);

export default AppWorkspaceLayout;
