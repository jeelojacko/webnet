import React from 'react';

import type { AdjustmentResult } from '../../types';
import CollapsibleSectionHeader from './CollapsibleSectionHeader';
import type { CollapsibleDetailSectionId } from './reportSectionRegistry';

type ProcessingLogSectionProps = {
  isDetailSectionPinned: (_id: CollapsibleDetailSectionId) => boolean;
  isSectionCollapsed: (_id: CollapsibleDetailSectionId) => boolean;
  logs: AdjustmentResult['logs'];
  onHeaderRef: (_id: CollapsibleDetailSectionId, _node: HTMLDivElement | null) => void;
  toggleDetailSection: (_id: CollapsibleDetailSectionId) => void;
  togglePinnedDetailSection: (_id: CollapsibleDetailSectionId, _label: string) => void;
};

const ReportProcessingLogSection: React.FC<ProcessingLogSectionProps> = ({
  isDetailSectionPinned,
  isSectionCollapsed,
  logs,
  onHeaderRef,
  toggleDetailSection,
  togglePinnedDetailSection,
}) => (
  <div className="mt-8 rounded border border-slate-800 overflow-hidden">
    <CollapsibleSectionHeader
      sectionId="processing-log"
      label="Processing Log"
      className="px-3 py-2 text-xs uppercase tracking-wider border-b border-slate-700 bg-slate-900"
      labelClassName="text-slate-300 font-bold"
      collapsed={isSectionCollapsed('processing-log')}
      pinned={isDetailSectionPinned('processing-log')}
      onToggleCollapse={toggleDetailSection}
      onTogglePin={togglePinnedDetailSection}
      onHeaderRef={onHeaderRef}
    />
    {!isSectionCollapsed('processing-log') && (
      <div className="bg-slate-900 p-4 font-mono text-xs text-slate-400">
        {logs.map((logLine, index) => (
          <div key={index}>{logLine}</div>
        ))}
      </div>
    )}
  </div>
);

export default ReportProcessingLogSection;
