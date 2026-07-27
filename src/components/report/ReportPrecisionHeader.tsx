import React from 'react';

import CollapsibleSectionHeader from './CollapsibleSectionHeader';
import type { SectionControls } from './ReportPrecisionSections.types';
import type { CollapsibleDetailSectionId } from './reportSectionRegistry';

const PrecisionHeader: React.FC<
  SectionControls & {
    className?: string;
    label: string;
    labelClassName?: string;
    sectionId: CollapsibleDetailSectionId;
    title?: string;
  }
> = ({
  className = 'px-3 py-2 text-xs uppercase tracking-wider border-b border-slate-800',
  isDetailSectionPinned,
  isSectionCollapsed,
  label,
  labelClassName = 'text-slate-400',
  onHeaderRef,
  sectionId,
  title,
  toggleDetailSection,
  togglePinnedDetailSection,
}) => (
  <CollapsibleSectionHeader
    sectionId={sectionId}
    label={label}
    className={className}
    labelClassName={labelClassName}
    title={title}
    collapsed={isSectionCollapsed(sectionId)}
    pinned={isDetailSectionPinned(sectionId)}
    onToggleCollapse={toggleDetailSection}
    onTogglePin={togglePinnedDetailSection}
    onHeaderRef={onHeaderRef}
  />
);

export default PrecisionHeader;
