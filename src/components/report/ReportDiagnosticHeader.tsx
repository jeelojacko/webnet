import React from 'react';

import CollapsibleSectionHeader from './CollapsibleSectionHeader';
import type { SectionControls } from './ReportDiagnosticPanels.types';
import type { CollapsibleDetailSectionId } from './reportSectionRegistry';

export const DiagnosticHeader: React.FC<
  SectionControls & {
    className?: string;
    label: string;
    labelClassName?: string;
    sectionId: CollapsibleDetailSectionId;
  }
> = ({
  className = 'px-3 py-2 text-xs uppercase tracking-wider border-b border-slate-700 bg-slate-800/75',
  isDetailSectionPinned,
  isSectionCollapsed,
  label,
  labelClassName = 'text-slate-100',
  onHeaderRef,
  sectionId,
  toggleDetailSection,
  togglePinnedDetailSection,
}) => (
  <CollapsibleSectionHeader
    sectionId={sectionId}
    label={label}
    className={className}
    labelClassName={labelClassName}
    collapsed={isSectionCollapsed(sectionId)}
    pinned={isDetailSectionPinned(sectionId)}
    onToggleCollapse={toggleDetailSection}
    onTogglePin={togglePinnedDetailSection}
    onHeaderRef={onHeaderRef}
  />
);
