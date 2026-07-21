import React from 'react';
import WorkspaceChrome from '../WorkspaceChrome';
import {
  IndustryOutputView,
  MapView,
  ProcessingSummaryView,
  ReportView,
} from '../../app/AppLazyViews';
import type { AppWorkspaceLayoutProps } from './AppWorkspaceLayout';

type AppWorkspaceTabsProps = Pick<
  AppWorkspaceLayoutProps,
  | 'activeTab'
  | 'handleWorkspaceTabChange'
  | 'isSidebarOpen'
  | 'setIsSidebarOpen'
  | 'result'
  | 'units'
  | 'workspaceReviewState'
  | 'runDiagnostics'
  | 'excludedIds'
  | 'toggleExclude'
  | 'applyImpactExclusion'
  | 'applyPreanalysisPlanningAction'
  | 'applyAllPreanalysisPlanningActions'
  | 'handleValidatedRun'
  | 'clearExclusions'
  | 'handleJumpToSourceLine'
  | 'pendingRunSettingDiffs'
  | 'overrides'
  | 'handleOverride'
  | 'resetOverrides'
  | 'clusterReviewDecisions'
  | 'activeClusterApprovedMerges'
  | 'handleClusterDecisionStatus'
  | 'handleClusterCanonicalSelection'
  | 'applyClusterReviewMerges'
  | 'resetClusterReview'
  | 'clearClusterApprovedMerges'
  | 'reportFilterFocusRequestKey'
  | 'selection'
  | 'handleReportStationSelection'
  | 'handleReportObservationSelection'
  | 'canRenderTab'
  | 'runElapsedMs'
  | 'processingSummaryDiagnostics'
  | 'industryOutputText'
  | 'listingSortObservationsBy'
  | 'handleIndustryListingSortChange'
  | 'mapResult'
  | 'planningMap'
  | 'setPlanningMap'
  | 'planningMapPreview'
  | 'handleLoadPlanningInputPoints'
  | 'mapShowLostStations'
  | 'map3dEnabled'
  | 'adjustedPointsExportSettings'
  | 'qaDerivedResult'
  | 'handleMapStationSelection'
  | 'handleMapObservationSelection'
  | 'mapViewSnapshot'
  | 'setMapViewSnapshot'
>;

const LoadingTab = () => (
  <div className="flex h-full items-center justify-center text-sm text-slate-400">
    Loading tab...
  </div>
);

const PreparingTab = ({ label }: { label: string }) => (
  <div className="flex h-full items-center justify-center text-sm text-slate-400">{label}</div>
);

const AppWorkspaceTabs = ({
  activeTab,
  handleWorkspaceTabChange,
  isSidebarOpen,
  setIsSidebarOpen,
  result,
  units,
  workspaceReviewState,
  runDiagnostics,
  excludedIds,
  toggleExclude,
  applyImpactExclusion,
  applyPreanalysisPlanningAction,
  applyAllPreanalysisPlanningActions,
  handleValidatedRun,
  clearExclusions,
  handleJumpToSourceLine,
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
  selection,
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
}: AppWorkspaceTabsProps) => (
  <WorkspaceChrome
    activeTab={activeTab}
    onActiveTabChange={handleWorkspaceTabChange}
    isSidebarOpen={isSidebarOpen}
    onShowInput={() => setIsSidebarOpen(true)}
    hasResult={Boolean(result)}
    hasMapContent={true}
    renderReportContent={() => (
      <React.Suspense fallback={<LoadingTab />}>
        <ReportView
          result={result!}
          units={units}
          precisionReportingMode="industry-standard"
          viewState={workspaceReviewState}
          runDiagnostics={runDiagnostics}
          excludedIds={excludedIds}
          onToggleExclude={toggleExclude}
          onApplyImpactExclude={applyImpactExclusion}
          onApplyPreanalysisAction={applyPreanalysisPlanningAction}
          onApplyAllPreanalysisActions={applyAllPreanalysisPlanningActions}
          onReRun={handleValidatedRun}
          onClearExclusions={clearExclusions}
          onJumpToSourceLine={handleJumpToSourceLine}
          pendingRunSettingDiffs={pendingRunSettingDiffs}
          overrides={overrides}
          onOverride={handleOverride}
          onResetOverrides={resetOverrides}
          clusterReviewDecisions={clusterReviewDecisions}
          activeClusterApprovedMerges={activeClusterApprovedMerges}
          onClusterDecisionStatus={handleClusterDecisionStatus}
          onClusterCanonicalSelection={handleClusterCanonicalSelection}
          onApplyClusterMerges={applyClusterReviewMerges}
          onResetClusterReview={resetClusterReview}
          onClearClusterMerges={clearClusterApprovedMerges}
          focusFilterRequestKey={reportFilterFocusRequestKey}
          selectedStationId={selection.stationId}
          selectedObservationId={selection.observationId}
          onSelectStation={handleReportStationSelection}
          onSelectObservation={handleReportObservationSelection}
        />
      </React.Suspense>
    )}
    renderProcessingSummaryContent={() =>
      canRenderTab('processing-summary') ? (
        <React.Suspense fallback={<LoadingTab />}>
          <ProcessingSummaryView
            result={result!}
            units={units}
            runElapsedMs={runElapsedMs}
            runDiagnostics={processingSummaryDiagnostics}
          />
        </React.Suspense>
      ) : (
        <PreparingTab label="Preparing summary..." />
      )
    }
    renderIndustryOutputContent={() =>
      canRenderTab('industry-output') ? (
        <React.Suspense fallback={<LoadingTab />}>
          <IndustryOutputView
            text={industryOutputText}
            listingSortObservationsBy={listingSortObservationsBy}
            onChangeListingSortObservationsBy={handleIndustryListingSortChange}
            onJumpToSourceLine={handleJumpToSourceLine}
          />
        </React.Suspense>
      ) : (
        <PreparingTab label="Preparing industry output..." />
      )
    }
    renderMapContent={() =>
      result == null || canRenderTab('map') ? (
        <React.Suspense fallback={<LoadingTab />}>
          <MapView
            result={mapResult}
            units={units}
            planningMap={planningMap}
            onPlanningMapChange={setPlanningMap}
            inputPointsLoaded={planningMapPreview != null}
            onLoadInputPoints={handleLoadPlanningInputPoints}
            showLostStations={mapShowLostStations}
            mode={result != null && map3dEnabled ? '3d' : '2d'}
            adjustedPointsExportSettings={adjustedPointsExportSettings}
            derivedResult={result != null ? qaDerivedResult : null}
            selectedStationId={selection.stationId}
            selectedObservationId={selection.observationId}
            onSelectStation={handleMapStationSelection}
            onSelectObservation={handleMapObservationSelection}
            snapshot={mapViewSnapshot}
            onSnapshotChange={setMapViewSnapshot}
          />
        </React.Suspense>
      ) : (
        <PreparingTab label="Preparing map..." />
      )
    }
  />
);

export default AppWorkspaceTabs;
