import React from 'react';
import type { AdjustmentResult } from '../../types';
import type { ReportViewProps } from '../ReportView.types';
import type { CollapsibleDetailSectionId } from './reportSectionRegistry';
import DirectionDiagnosticsSections from './DirectionDiagnosticsSections';
import { GpsRoverOffsetsPanel, SetupDiagnosticsPanel } from './ReportDiagnosticPanels';
import ReportDiagnosticsSections from './ReportDiagnosticsSections';
import ReportReviewWorkflowSections from './ReportReviewWorkflowSections';
import LoopDiagnosticsSections from './LoopDiagnosticsSections';
import {
  PostAdjustedSideshotSections,
} from './ReportObservationWorkflowSections';

type SourceLineRenderer = (_line: number | null | undefined) => React.ReactNode;
type HeaderRenderer = React.ComponentProps<
  typeof ReportDiagnosticsSections
>['renderCollapsibleSectionHeader'];
type LoadMoreRenderer = React.ComponentProps<typeof LoopDiagnosticsSections>['renderLoadMoreFooter'];

type ReportViewDiagnosticsBandProps = {
  activeClusterProps: React.ComponentProps<typeof ReportReviewWorkflowSections>['activeClusterProps'];
  aliasTrace: React.ComponentProps<typeof ReportReviewWorkflowSections>['aliasTrace'];
  autoAdjustDiagnostics: AdjustmentResult['autoAdjustDiagnostics'];
  autoSideshotDiagnostics: AdjustmentResult['autoSideshotDiagnostics'];
  descriptionAppendDelimiter: string;
  descriptionConflicts: React.ComponentProps<
    typeof ReportReviewWorkflowSections
  >['descriptionConflicts'];
  descriptionReconcileMode: 'first' | 'append';
  descriptionRefsByStation: React.ComponentProps<
    typeof ReportReviewWorkflowSections
  >['descriptionRefsByStation'];
  descriptionScanSummary: React.ComponentProps<
    typeof ReportReviewWorkflowSections
  >['descriptionScanSummary'];
  directionRejects: React.ComponentProps<typeof DirectionDiagnosticsSections>['directionRejects'];
  directionTreatmentDiagnostics: React.ComponentProps<
    typeof DirectionDiagnosticsSections
  >['directionTreatmentDiagnostics'];
  gpsCoordinateSideshots: React.ComponentProps<
    typeof PostAdjustedSideshotSections
  >['gpsCoordinateSideshots'];
  gpsLoopDiagnostics: AdjustmentResult['gpsLoopDiagnostics'];
  gpsLoopSuspects: React.ComponentProps<typeof LoopDiagnosticsSections>['gpsLoopSuspects'];
  gpsOffsetObservations: React.ComponentProps<typeof GpsRoverOffsetsPanel>['gpsOffsetObservations'];
  gpsSideshots: React.ComponentProps<typeof PostAdjustedSideshotSections>['gpsSideshots'];
  gpsVectorSideshots: React.ComponentProps<typeof PostAdjustedSideshotSections>['gpsVectorSideshots'];
  highlightedLevelingSegmentLines: React.ComponentProps<
    typeof LoopDiagnosticsSections
  >['highlightedLevelingSegmentLines'];
  isDataCheck: boolean;
  isDetailSectionPinned: (_id: CollapsibleDetailSectionId) => boolean;
  isPreanalysis: boolean;
  isSectionCollapsed: (_id: CollapsibleDetailSectionId) => boolean;
  isSpecialRunMode: boolean;
  levelingLoopDiagnostics: AdjustmentResult['levelingLoopDiagnostics'];
  levelingLoopSuspects: React.ComponentProps<typeof LoopDiagnosticsSections>['levelingLoopSuspects'];
  levelingSegmentSuspects: React.ComponentProps<
    typeof LoopDiagnosticsSections
  >['levelingSegmentSuspects'];
  onHeaderRef: (_id: CollapsibleDetailSectionId, _node: HTMLDivElement | null) => void;
  parseState: AdjustmentResult['parseState'];
  renderCollapsibleSectionHeader: HeaderRenderer;
  renderLoadMoreFooter: LoadMoreRenderer;
  renderSourceLineLink: SourceLineRenderer;
  result: AdjustmentResult;
  setupDiagnostics: NonNullable<AdjustmentResult['setupDiagnostics']>;
  setupLocalFailCount: number;
  setupObsCount: number;
  setupWorstStdRes: number;
  showAutoSideshotDiagnosticsSection: boolean;
  showLevelingLoopDiagnosticsSection: boolean;
  showTsCorrelationDiagnosticsSection: boolean;
  toggleDetailSection: (_id: CollapsibleDetailSectionId) => void;
  togglePinnedDetailSection: (_id: CollapsibleDetailSectionId, _label: string) => void;
  topDirectionRepeatabilitySuspects: React.ComponentProps<
    typeof DirectionDiagnosticsSections
  >['topDirectionRepeatabilitySuspects'];
  topDirectionTargetSuspects: React.ComponentProps<
    typeof DirectionDiagnosticsSections
  >['topDirectionTargetSuspects'];
  topGpsOffsetObservation: React.ComponentProps<typeof GpsRoverOffsetsPanel>['topGpsOffsetObservation'];
  traverseLoops: React.ComponentProps<typeof LoopDiagnosticsSections>['traverseLoops'];
  traverseLoopSuspects: React.ComponentProps<typeof LoopDiagnosticsSections>['traverseLoopSuspects'];
  tsSideshots: React.ComponentProps<typeof PostAdjustedSideshotSections>['tsSideshots'];
  unitScale: number;
  units: ReportViewProps['units'];
  visibleDirectionRejects: React.ComponentProps<
    typeof DirectionDiagnosticsSections
  >['visibleDirectionRejects'];
  visibleGpsLoopSuspects: React.ComponentProps<typeof LoopDiagnosticsSections>['visibleGpsLoopSuspects'];
  visibleLevelingLoopSuspects: React.ComponentProps<
    typeof LoopDiagnosticsSections
  >['visibleLevelingLoopSuspects'];
  visibleTraverseLoopSuspects: React.ComponentProps<
    typeof LoopDiagnosticsSections
  >['visibleTraverseLoopSuspects'];
};

const ReportViewDiagnosticsBand: React.FC<ReportViewDiagnosticsBandProps> = ({
  activeClusterProps,
  aliasTrace,
  autoAdjustDiagnostics,
  autoSideshotDiagnostics,
  descriptionAppendDelimiter,
  descriptionConflicts,
  descriptionReconcileMode,
  descriptionRefsByStation,
  descriptionScanSummary,
  directionRejects,
  directionTreatmentDiagnostics,
  gpsCoordinateSideshots,
  gpsLoopDiagnostics,
  gpsLoopSuspects,
  gpsOffsetObservations,
  gpsSideshots,
  gpsVectorSideshots,
  highlightedLevelingSegmentLines,
  isDataCheck,
  isDetailSectionPinned,
  isPreanalysis,
  isSectionCollapsed,
  isSpecialRunMode,
  levelingLoopDiagnostics,
  levelingLoopSuspects,
  levelingSegmentSuspects,
  onHeaderRef,
  parseState,
  renderCollapsibleSectionHeader,
  renderLoadMoreFooter,
  renderSourceLineLink,
  result,
  setupDiagnostics,
  setupLocalFailCount,
  setupObsCount,
  setupWorstStdRes,
  showAutoSideshotDiagnosticsSection,
  showLevelingLoopDiagnosticsSection,
  showTsCorrelationDiagnosticsSection,
  toggleDetailSection,
  togglePinnedDetailSection,
  topDirectionRepeatabilitySuspects,
  topDirectionTargetSuspects,
  topGpsOffsetObservation,
  traverseLoops,
  traverseLoopSuspects,
  tsSideshots,
  unitScale,
  units,
  visibleDirectionRejects,
  visibleGpsLoopSuspects,
  visibleLevelingLoopSuspects,
  visibleTraverseLoopSuspects,
}) => (
  <>
    <ReportReviewWorkflowSections
      activeClusterProps={activeClusterProps}
      aliasTrace={aliasTrace}
      autoAdjustDiagnostics={autoAdjustDiagnostics}
      autoSideshotDiagnostics={autoSideshotDiagnostics}
      descriptionAppendDelimiter={descriptionAppendDelimiter}
      descriptionConflicts={descriptionConflicts}
      descriptionReconcileMode={descriptionReconcileMode}
      descriptionRefsByStation={descriptionRefsByStation}
      descriptionScanSummary={descriptionScanSummary}
      isDetailSectionPinned={isDetailSectionPinned}
      isSectionCollapsed={isSectionCollapsed}
      isSpecialRunMode={isSpecialRunMode}
      onHeaderRef={onHeaderRef}
      parseState={parseState}
      renderSourceLineLink={renderSourceLineLink}
      showAutoSideshotDiagnosticsSection={showAutoSideshotDiagnosticsSection}
      toggleDetailSection={toggleDetailSection}
      togglePinnedDetailSection={togglePinnedDetailSection}
      unitScale={unitScale}
      units={units}
    />

    <ReportDiagnosticsSections
      result={result}
      isPreanalysis={isPreanalysis}
      isDataCheck={isDataCheck}
      isSpecialRunMode={isSpecialRunMode}
      showTsCorrelationDiagnosticsSection={showTsCorrelationDiagnosticsSection}
      renderCollapsibleSectionHeader={renderCollapsibleSectionHeader}
      isSectionCollapsed={isSectionCollapsed}
      renderSourceLineLink={renderSourceLineLink}
    />

    <LoopDiagnosticsSections
      result={result}
      units={units}
      unitScale={unitScale}
      isPreanalysis={isPreanalysis}
      isDataCheck={isDataCheck}
      showLevelingLoopDiagnosticsSection={showLevelingLoopDiagnosticsSection}
      traverseLoops={traverseLoops}
      traverseLoopSuspects={traverseLoopSuspects}
      visibleTraverseLoopSuspects={visibleTraverseLoopSuspects}
      gpsLoopSuspects={gpsLoopSuspects}
      visibleGpsLoopSuspects={visibleGpsLoopSuspects}
      levelingLoopSuspects={levelingLoopSuspects}
      visibleLevelingLoopSuspects={visibleLevelingLoopSuspects}
      levelingSegmentSuspects={levelingSegmentSuspects}
      highlightedLevelingSegmentLines={highlightedLevelingSegmentLines}
      gpsLoopDiagnostics={gpsLoopDiagnostics}
      levelingLoopDiagnostics={levelingLoopDiagnostics}
      renderCollapsibleSectionHeader={renderCollapsibleSectionHeader}
      isSectionCollapsed={isSectionCollapsed}
      renderLoadMoreFooter={renderLoadMoreFooter}
      renderSourceLineLink={renderSourceLineLink}
    />

    <DirectionDiagnosticsSections
      result={result}
      isPreanalysis={isPreanalysis}
      isDataCheck={isDataCheck}
      directionTreatmentDiagnostics={directionTreatmentDiagnostics}
      directionRejects={directionRejects}
      visibleDirectionRejects={visibleDirectionRejects}
      topDirectionTargetSuspects={topDirectionTargetSuspects}
      topDirectionRepeatabilitySuspects={topDirectionRepeatabilitySuspects}
      renderCollapsibleSectionHeader={renderCollapsibleSectionHeader}
      isSectionCollapsed={isSectionCollapsed}
      renderLoadMoreFooter={renderLoadMoreFooter}
      renderSourceLineLink={renderSourceLineLink}
      showFaceTreatmentSection={false}
    />

    <SetupDiagnosticsPanel
      isDataCheck={isDataCheck}
      isDetailSectionPinned={isDetailSectionPinned}
      isPreanalysis={isPreanalysis}
      isSectionCollapsed={isSectionCollapsed}
      onHeaderRef={onHeaderRef}
      setupDiagnostics={setupDiagnostics}
      setupLocalFailCount={setupLocalFailCount}
      setupObsCount={setupObsCount}
      setupWorstStdRes={setupWorstStdRes}
      toggleDetailSection={toggleDetailSection}
      togglePinnedDetailSection={togglePinnedDetailSection}
      unitScale={unitScale}
      units={units}
    />

    <PostAdjustedSideshotSections
      gpsCoordinateSideshots={gpsCoordinateSideshots}
      gpsSideshots={gpsSideshots}
      gpsVectorSideshots={gpsVectorSideshots}
      isDataCheck={isDataCheck}
      isDetailSectionPinned={isDetailSectionPinned}
      isSectionCollapsed={isSectionCollapsed}
      onHeaderRef={onHeaderRef}
      renderSourceLineLink={renderSourceLineLink}
      toggleDetailSection={toggleDetailSection}
      togglePinnedDetailSection={togglePinnedDetailSection}
      tsSideshots={tsSideshots}
      unitScale={unitScale}
      units={units}
    />

    <GpsRoverOffsetsPanel
      gpsOffsetObservations={gpsOffsetObservations}
      isDataCheck={isDataCheck}
      isDetailSectionPinned={isDetailSectionPinned}
      isSectionCollapsed={isSectionCollapsed}
      onHeaderRef={onHeaderRef}
      renderSourceLineLink={renderSourceLineLink}
      topGpsOffsetObservation={topGpsOffsetObservation}
      toggleDetailSection={toggleDetailSection}
      togglePinnedDetailSection={togglePinnedDetailSection}
      unitScale={unitScale}
      units={units}
    />
  </>
);

export default ReportViewDiagnosticsBand;
