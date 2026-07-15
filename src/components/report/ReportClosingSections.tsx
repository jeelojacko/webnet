import React from 'react';

import type { AdjustmentResult, DirectionSetTreatmentDiagnostic } from '../../types';
import { DirectionFaceTreatmentDiagnosticsSection } from './DirectionDiagnosticsSections';
import ReportProcessingLogSection from './ReportProcessingLogSection';
import type { CollapsibleDetailSectionId } from './reportSectionRegistry';

type SourceLineRenderer = (_line: number | null | undefined) => React.ReactNode;
type HeaderRenderer = (_params: {
  sectionId: CollapsibleDetailSectionId;
  label: string;
  className: string;
  labelClassName: string;
  title?: string;
}) => React.ReactNode;

type ReportClosingSectionsProps = {
  directionTreatmentDiagnostics: DirectionSetTreatmentDiagnostic[];
  isDataCheck: boolean;
  isDetailSectionPinned: (_id: CollapsibleDetailSectionId) => boolean;
  isPreanalysis: boolean;
  isRegularAdjustment: boolean;
  isSectionCollapsed: (_id: CollapsibleDetailSectionId) => boolean;
  logs: AdjustmentResult['logs'];
  onHeaderRef: (_id: CollapsibleDetailSectionId, _node: HTMLDivElement | null) => void;
  renderCollapsibleSectionHeader: HeaderRenderer;
  renderSourceLineLink: SourceLineRenderer;
  toggleDetailSection: (_id: CollapsibleDetailSectionId) => void;
  togglePinnedDetailSection: (_id: CollapsibleDetailSectionId, _label: string) => void;
};

const ReportClosingSections: React.FC<ReportClosingSectionsProps> = ({
  directionTreatmentDiagnostics,
  isDataCheck,
  isDetailSectionPinned,
  isPreanalysis,
  isRegularAdjustment,
  isSectionCollapsed,
  logs,
  onHeaderRef,
  renderCollapsibleSectionHeader,
  renderSourceLineLink,
  toggleDetailSection,
  togglePinnedDetailSection,
}) => (
  <>
    {isRegularAdjustment && (
      <DirectionFaceTreatmentDiagnosticsSection
        directionTreatmentDiagnostics={directionTreatmentDiagnostics}
        isPreanalysis={isPreanalysis}
        isDataCheck={isDataCheck}
        renderCollapsibleSectionHeader={renderCollapsibleSectionHeader}
        isSectionCollapsed={isSectionCollapsed}
        renderSourceLineLink={renderSourceLineLink}
      />
    )}

    <ReportProcessingLogSection
      isDetailSectionPinned={isDetailSectionPinned}
      isSectionCollapsed={isSectionCollapsed}
      logs={logs}
      onHeaderRef={onHeaderRef}
      toggleDetailSection={toggleDetailSection}
      togglePinnedDetailSection={togglePinnedDetailSection}
    />
  </>
);

export default ReportClosingSections;
