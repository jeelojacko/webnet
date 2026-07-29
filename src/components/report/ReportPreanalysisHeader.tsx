import type React from 'react';

import CollapsibleSectionHeader from './CollapsibleSectionHeader';
import type { SectionControls } from './ReportPreanalysisSections.types';
import type { CollapsibleDetailSectionId } from './reportSectionRegistry';

export const PreanalysisHeader: React.FC<
  SectionControls & {
    label: string;
    sectionId: CollapsibleDetailSectionId;
    title?: string;
  }
> = ({
  isDetailSectionPinned,
  isSectionCollapsed,
  label,
  onHeaderRef,
  sectionId,
  title,
  toggleDetailSection,
  togglePinnedDetailSection,
}) => (
  <CollapsibleSectionHeader
    sectionId={sectionId}
    label={label}
    className="px-3 py-2 text-xs uppercase tracking-wider border-b border-slate-800 bg-slate-900/40"
    labelClassName="text-slate-400"
    title={title}
    collapsed={isSectionCollapsed(sectionId)}
    pinned={isDetailSectionPinned(sectionId)}
    onToggleCollapse={toggleDetailSection}
    onTogglePin={togglePinnedDetailSection}
    onHeaderRef={onHeaderRef}
  />
);
