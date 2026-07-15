import React from 'react';

import type { AdjustmentResult } from '../../types';
import {
  AutoAdjustDiagnosticsPanel,
  AutoSideshotCandidatesPanel,
} from './ReportDiagnosticPanels';
import { ReportClusterDetectionSection } from './ReportClusterDetectionSection';
import {
  AliasTraceabilitySection,
  DescriptionReconciliationSection,
} from './ReportTraceabilitySections';
import type { CollapsibleDetailSectionId } from './reportSectionRegistry';

type SourceLineRenderer = (_line: number | null | undefined) => React.ReactNode;

type SectionControls = {
  isDetailSectionPinned: (_id: CollapsibleDetailSectionId) => boolean;
  isSectionCollapsed: (_id: CollapsibleDetailSectionId) => boolean;
  onHeaderRef: (_id: CollapsibleDetailSectionId, _node: HTMLDivElement | null) => void;
  toggleDetailSection: (_id: CollapsibleDetailSectionId) => void;
  togglePinnedDetailSection: (_id: CollapsibleDetailSectionId, _label: string) => void;
};

type AliasProps = React.ComponentProps<typeof AliasTraceabilitySection>;
type DescriptionProps = React.ComponentProps<typeof DescriptionReconciliationSection>;
type ClusterProps = React.ComponentProps<typeof ReportClusterDetectionSection>;
type AutoAdjustProps = React.ComponentProps<typeof AutoAdjustDiagnosticsPanel>;
type AutoSideshotProps = React.ComponentProps<typeof AutoSideshotCandidatesPanel>;

type ReportReviewWorkflowSectionsProps = SectionControls & {
  activeClusterProps: Pick<
    ClusterProps,
    | 'clusterAppliedMerges'
    | 'clusterCandidates'
    | 'clusterDiagnostics'
    | 'clusterMergeOutcomes'
    | 'clusterRejectedProposals'
    | 'clusterReviewDecisions'
    | 'clusterReviewStats'
    | 'onApplyClusterMerges'
    | 'onClearClusterMerges'
    | 'onClusterCanonicalSelection'
    | 'onClusterDecisionStatus'
    | 'onResetClusterReview'
  >;
  aliasTrace: AliasProps['aliasTrace'];
  autoAdjustDiagnostics: AutoAdjustProps['autoAdjustDiagnostics'];
  autoSideshotDiagnostics: AutoSideshotProps['autoSideshotDiagnostics'];
  descriptionAppendDelimiter: DescriptionProps['descriptionAppendDelimiter'];
  descriptionConflicts: DescriptionProps['descriptionConflicts'];
  descriptionReconcileMode: DescriptionProps['descriptionReconcileMode'];
  descriptionRefsByStation: DescriptionProps['descriptionRefsByStation'];
  descriptionScanSummary: DescriptionProps['descriptionScanSummary'];
  isSpecialRunMode: boolean;
  parseState: AdjustmentResult['parseState'];
  renderSourceLineLink: SourceLineRenderer;
  showAutoSideshotDiagnosticsSection: boolean;
  unitScale: number;
  units: 'm' | 'ft';
};

const ReportReviewWorkflowSections: React.FC<ReportReviewWorkflowSectionsProps> = ({
  activeClusterProps,
  aliasTrace,
  autoAdjustDiagnostics,
  autoSideshotDiagnostics,
  descriptionAppendDelimiter,
  descriptionConflicts,
  descriptionReconcileMode,
  descriptionRefsByStation,
  descriptionScanSummary,
  isDetailSectionPinned,
  isSectionCollapsed,
  isSpecialRunMode,
  onHeaderRef,
  parseState,
  renderSourceLineLink,
  showAutoSideshotDiagnosticsSection,
  toggleDetailSection,
  togglePinnedDetailSection,
  unitScale,
  units,
}) => (
  <>
    <AliasTraceabilitySection
      aliasTrace={aliasTrace}
      isDetailSectionPinned={isDetailSectionPinned}
      isSectionCollapsed={isSectionCollapsed}
      onHeaderRef={onHeaderRef}
      parseState={parseState}
      renderSourceLineLink={renderSourceLineLink}
      toggleDetailSection={toggleDetailSection}
      togglePinnedDetailSection={togglePinnedDetailSection}
    />

    <DescriptionReconciliationSection
      descriptionAppendDelimiter={descriptionAppendDelimiter}
      descriptionConflicts={descriptionConflicts}
      descriptionReconcileMode={descriptionReconcileMode}
      descriptionRefsByStation={descriptionRefsByStation}
      descriptionScanSummary={descriptionScanSummary}
      isDetailSectionPinned={isDetailSectionPinned}
      isSectionCollapsed={isSectionCollapsed}
      onHeaderRef={onHeaderRef}
      parseState={parseState}
      toggleDetailSection={toggleDetailSection}
      togglePinnedDetailSection={togglePinnedDetailSection}
    />

    <ReportClusterDetectionSection
      {...activeClusterProps}
      isDetailSectionPinned={isDetailSectionPinned}
      isSectionCollapsed={isSectionCollapsed}
      onHeaderRef={onHeaderRef}
      toggleDetailSection={toggleDetailSection}
      togglePinnedDetailSection={togglePinnedDetailSection}
      unitScale={unitScale}
      units={units}
    />

    <AutoAdjustDiagnosticsPanel
      autoAdjustDiagnostics={autoAdjustDiagnostics}
      isDetailSectionPinned={isDetailSectionPinned}
      isSectionCollapsed={isSectionCollapsed}
      isSpecialRunMode={isSpecialRunMode}
      onHeaderRef={onHeaderRef}
      renderSourceLineLink={renderSourceLineLink}
      toggleDetailSection={toggleDetailSection}
      togglePinnedDetailSection={togglePinnedDetailSection}
    />

    <AutoSideshotCandidatesPanel
      autoSideshotDiagnostics={autoSideshotDiagnostics}
      isDetailSectionPinned={isDetailSectionPinned}
      isSectionCollapsed={isSectionCollapsed}
      onHeaderRef={onHeaderRef}
      renderSourceLineLink={renderSourceLineLink}
      showAutoSideshotDiagnosticsSection={showAutoSideshotDiagnosticsSection}
      toggleDetailSection={toggleDetailSection}
      togglePinnedDetailSection={togglePinnedDetailSection}
    />
  </>
);

export default ReportReviewWorkflowSections;
