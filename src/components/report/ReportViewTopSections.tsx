import React from 'react';
import type { AdjustmentResult, Observation, ReductionUsageSummary, RunMode } from '../../types';
import type { ReportViewProps } from '../ReportView.types';
import { REPORT_STATIC_TOOLTIPS } from './reportTooltips';
import type { CollapsibleDetailSectionId } from './reportSectionRegistry';
import ReportToolbar from './ReportToolbar';
import PinnedSectionsPanel from './PinnedSectionsPanel';
import {
  AdjustmentSummarySection,
  BlunderDetectSummarySection,
  DataCheckSummarySection,
  PendingRunSettingsDiffBanner,
} from './ReportRunSummarySections';
import { ReportSuspectImpactSection } from './ReportSuspectImpactSection';
import SolveProfileDiagnosticsSection from './SolveProfileDiagnosticsSection';
import {
  LockedPlannedObservationsSection,
  PreanalysisPlanningSummarySection,
  PreanalysisRecommendationsSection,
} from './ReportPreanalysisSections';
import type { SortedObservation } from '../../engine/resultDerivedModels';
import type { PinnedDetailSection } from '../../hooks/useReportViewState';

type ReportViewTopSectionsProps = {
  activePreanalysisScenarioIds: Set<string>;
  allDetailSectionsCollapsed: boolean;
  blunderCycleLines: string[];
  blunderFlaggedCount: number;
  byType: (_type: Observation['type']) => SortedObservation[];
  clearPinnedDetailSections: () => void;
  clusterAppliedMergeCount: number;
  clusterRevertDisabledReason: string;
  dataCheckDiffRows: React.ComponentProps<typeof DataCheckSummarySection>['dataCheckDiffRows'];
  directionSetCount: number;
  excludedIds: Set<number>;
  fixedSigmaLabel: (_obs: Observation) => string;
  flaggedRelativeCueCount: number;
  flaggedStationCueCount: number;
  formatReductionUsage: (_summary?: ReductionUsageSummary) => string;
  isBlunderDetect: boolean;
  isDataCheck: boolean;
  isDetailSectionPinned: (_id: CollapsibleDetailSectionId) => boolean;
  isPreanalysis: boolean;
  isSectionCollapsed: (_id: CollapsibleDetailSectionId) => boolean;
  isSpecialRunMode: boolean;
  jumpToPinnedSection: (_id: CollapsibleDetailSectionId) => void;
  lockedPreanalysisObservationCount: number;
  lockedPreanalysisObservations: React.ComponentProps<
    typeof LockedPlannedObservationsSection
  >['lockedPreanalysisObservations'];
  lostStationIds: string[];
  maxAbsStdRes: number;
  observationStationsLabel: (_obs: Observation) => string;
  observationValueLabel: (_obs: Observation) => string;
  onApplyAllPreanalysisActions: NonNullable<ReportViewProps['onApplyAllPreanalysisActions']>;
  onApplyImpactExclude: ReportViewProps['onApplyImpactExclude'];
  onApplyPreanalysisAction: ReportViewProps['onApplyPreanalysisAction'];
  onClearClusterMerges: ReportViewProps['onClearClusterMerges'];
  onClearExclusions: ReportViewProps['onClearExclusions'];
  onHeaderRef: (_id: CollapsibleDetailSectionId, _node: HTMLDivElement | null) => void;
  onReRun: ReportViewProps['onReRun'];
  onResetOverrides: ReportViewProps['onResetOverrides'];
  pendingRunSettingDiffs: NonNullable<ReportViewProps['pendingRunSettingDiffs']>;
  pinnedDetailSections: PinnedDetailSection[];
  preanalysisImpactDiagnostics: AdjustmentResult['preanalysisImpactDiagnostics'];
  preanalysisLabelTooltip: (_label: string) => string | undefined;
  relativeCovarianceCount: number;
  renderSourceLineLink: (_line: number | null | undefined) => React.ReactNode;
  result: AdjustmentResult;
  runDiagnostics: ReportViewProps['runDiagnostics'];
  runMode: RunMode;
  setAllDetailSectionsCollapsed: (_value: boolean) => void;
  showClusterMergeRevert: boolean;
  stationCovarianceCount: number;
  suspectImpactActionableCount: number;
  suspectImpactDiagnostics: NonNullable<AdjustmentResult['suspectImpactDiagnostics']>;
  suspectImpactExcludedCount: number;
  suspectImpactWorstBaseStdRes: number;
  toggleDetailSection: (_id: CollapsibleDetailSectionId) => void;
  descriptionAppendDelimiter: string;
  descriptionReconcileMode: 'first' | 'append';
  togglePinnedDetailSection: (_id: CollapsibleDetailSectionId, _label: string) => void;
  unitScale: number;
  units: ReportViewProps['units'];
};

const ReportViewTopSections: React.FC<ReportViewTopSectionsProps> = ({
  activePreanalysisScenarioIds,
  allDetailSectionsCollapsed,
  blunderCycleLines,
  blunderFlaggedCount,
  byType,
  clearPinnedDetailSections,
  clusterAppliedMergeCount,
  clusterRevertDisabledReason,
  dataCheckDiffRows,
  directionSetCount,
  excludedIds,
  fixedSigmaLabel,
  flaggedRelativeCueCount,
  flaggedStationCueCount,
  formatReductionUsage,
  isBlunderDetect,
  isDataCheck,
  isDetailSectionPinned,
  isPreanalysis,
  isSectionCollapsed,
  isSpecialRunMode,
  jumpToPinnedSection,
  lockedPreanalysisObservationCount,
  lockedPreanalysisObservations,
  lostStationIds,
  maxAbsStdRes,
  observationStationsLabel,
  observationValueLabel,
  onApplyAllPreanalysisActions,
  onApplyImpactExclude,
  onApplyPreanalysisAction,
  onClearClusterMerges,
  onClearExclusions,
  onHeaderRef,
  onReRun,
  onResetOverrides,
  pendingRunSettingDiffs,
  pinnedDetailSections,
  preanalysisImpactDiagnostics,
  preanalysisLabelTooltip,
  relativeCovarianceCount,
  renderSourceLineLink,
  result,
  runDiagnostics,
  runMode,
  setAllDetailSectionsCollapsed,
  showClusterMergeRevert,
  stationCovarianceCount,
  suspectImpactActionableCount,
  suspectImpactDiagnostics,
  suspectImpactExcludedCount,
  suspectImpactWorstBaseStdRes,
  toggleDetailSection,
  descriptionAppendDelimiter,
  descriptionReconcileMode,
  togglePinnedDetailSection,
  unitScale,
  units,
}) => {
  return (
    <>
      <ReportToolbar
        onReRun={onReRun}
        onToggleCollapseAll={() => setAllDetailSectionsCollapsed(!allDetailSectionsCollapsed)}
        allDetailSectionsCollapsed={allDetailSectionsCollapsed}
        onClearExclusions={onClearExclusions}
        onResetOverrides={onResetOverrides}
        showClusterMergeRevert={showClusterMergeRevert}
        clusterAppliedMergeCount={clusterAppliedMergeCount}
        clusterRevertDisabledReason={clusterRevertDisabledReason}
        onClearClusterMerges={onClearClusterMerges}
        unitScale={unitScale}
        units={units}
      />

      <PendingRunSettingsDiffBanner pendingRunSettingDiffs={pendingRunSettingDiffs} />

      <PinnedSectionsPanel
        pinnedDetailSections={pinnedDetailSections}
        onClearPins={clearPinnedDetailSections}
        onJumpToPinnedSection={jumpToPinnedSection}
      />

      <ReportSuspectImpactSection
        excludedIds={excludedIds}
        isDetailSectionPinned={isDetailSectionPinned}
        isPreanalysis={isPreanalysis}
        isSectionCollapsed={isSectionCollapsed}
        isSpecialRunMode={isSpecialRunMode}
        onApplyImpactExclude={onApplyImpactExclude}
        onHeaderRef={onHeaderRef}
        renderSourceLineLink={renderSourceLineLink}
        suspectImpactActionableCount={suspectImpactActionableCount}
        suspectImpactDiagnostics={suspectImpactDiagnostics}
        suspectImpactExcludedCount={suspectImpactExcludedCount}
        suspectImpactWorstBaseStdRes={suspectImpactWorstBaseStdRes}
        toggleDetailSection={toggleDetailSection}
        togglePinnedDetailSection={togglePinnedDetailSection}
        unitScale={unitScale}
        units={units}
      />

      <AdjustmentSummarySection
        byType={byType}
        isPreanalysis={isPreanalysis}
        isSpecialRunMode={isSpecialRunMode}
        result={result}
      />

      <DataCheckSummarySection
        dataCheckDiffRows={dataCheckDiffRows}
        directionSetCount={directionSetCount}
        isDataCheck={isDataCheck}
        maxAbsStdRes={maxAbsStdRes}
        renderSourceLineLink={renderSourceLineLink}
        result={result}
      />

      <BlunderDetectSummarySection
        blunderCycleLines={blunderCycleLines}
        blunderFlaggedCount={blunderFlaggedCount}
        isBlunderDetect={isBlunderDetect}
        maxAbsStdRes={maxAbsStdRes}
        result={result}
      />

      {runDiagnostics ? (
        <SolveProfileDiagnosticsSection
          runDiagnostics={runDiagnostics}
          runMode={runMode}
          units={units}
          unitScale={unitScale}
          lostStationIds={lostStationIds}
          descriptionReconcileMode={descriptionReconcileMode}
          descriptionAppendDelimiter={descriptionAppendDelimiter}
          reportStaticTooltips={REPORT_STATIC_TOOLTIPS}
          sectionId="solve-profile-diagnostics"
          collapsed={isSectionCollapsed('solve-profile-diagnostics')}
          pinned={isDetailSectionPinned('solve-profile-diagnostics')}
          onToggleCollapse={toggleDetailSection}
          onTogglePin={togglePinnedDetailSection}
          onHeaderRef={onHeaderRef}
          formatReductionUsage={formatReductionUsage}
        />
      ) : null}

      <PreanalysisPlanningSummarySection
        flaggedRelativeCueCount={flaggedRelativeCueCount}
        flaggedStationCueCount={flaggedStationCueCount}
        isPreanalysis={isPreanalysis}
        lockedPreanalysisObservationCount={lockedPreanalysisObservationCount}
        parseState={result.parseState}
        preanalysisLabelTooltip={preanalysisLabelTooltip}
        relativeCovarianceCount={relativeCovarianceCount}
        stationCovarianceCount={stationCovarianceCount}
      />

      <LockedPlannedObservationsSection
        fixedSigmaLabel={fixedSigmaLabel}
        isDetailSectionPinned={isDetailSectionPinned}
        isPreanalysis={isPreanalysis}
        isSectionCollapsed={isSectionCollapsed}
        lockedPreanalysisObservations={lockedPreanalysisObservations}
        observationStationsLabel={observationStationsLabel}
        observationValueLabel={observationValueLabel}
        onHeaderRef={onHeaderRef}
        preanalysisLabelTooltip={preanalysisLabelTooltip}
        renderSourceLineLink={renderSourceLineLink}
        toggleDetailSection={toggleDetailSection}
        togglePinnedDetailSection={togglePinnedDetailSection}
      />

      <PreanalysisRecommendationsSection
        activePreanalysisScenarioIds={activePreanalysisScenarioIds}
        isDetailSectionPinned={isDetailSectionPinned}
        isPreanalysis={isPreanalysis}
        isSectionCollapsed={isSectionCollapsed}
        onApplyAllPreanalysisActions={onApplyAllPreanalysisActions}
        onApplyPreanalysisAction={onApplyPreanalysisAction}
        onHeaderRef={onHeaderRef}
        preanalysisImpactDiagnostics={preanalysisImpactDiagnostics}
        preanalysisLabelTooltip={preanalysisLabelTooltip}
        renderSourceLineLink={renderSourceLineLink}
        toggleDetailSection={toggleDetailSection}
        togglePinnedDetailSection={togglePinnedDetailSection}
        unitScale={unitScale}
        units={units}
      />
    </>
  );
};

export default ReportViewTopSections;
