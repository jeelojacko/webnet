import React, { useCallback, useEffect } from 'react';

import CollapsibleSectionHeader from './CollapsibleSectionHeader';
import { getReportHeaderTooltip } from './reportHeaderTooltips';
import ReportLoadMoreFooter from './ReportLoadMoreFooter';
import { REPORT_TABLE_WINDOW_SIZE, type CollapsibleDetailSectionId } from './reportSectionRegistry';

type UseReportRenderHelpersOptions = {
  isDetailSectionPinned: (_id: CollapsibleDetailSectionId) => boolean;
  isSectionCollapsed: (_id: CollapsibleDetailSectionId) => boolean;
  onJumpToSourceLine?: (_sourceLine: number) => void;
  registerDetailSectionHeader: (
    _id: CollapsibleDetailSectionId,
    _node: HTMLDivElement | null,
  ) => void;
  reportRootRef: React.RefObject<HTMLDivElement | null>;
  showAllRows: (_key: string, _totalCount: number) => void;
  showMoreRows: (_key: string, _step?: number) => void;
  toggleDetailSection: (_id: CollapsibleDetailSectionId) => void;
  togglePinnedDetailSection: (_id: CollapsibleDetailSectionId, _label: string) => void;
};

export const useReportRenderHelpers = ({
  isDetailSectionPinned,
  isSectionCollapsed,
  onJumpToSourceLine,
  registerDetailSectionHeader,
  reportRootRef,
  showAllRows,
  showMoreRows,
  toggleDetailSection,
  togglePinnedDetailSection,
}: UseReportRenderHelpersOptions) => {
  const renderSourceLineLink = useCallback(
    (line: number | null | undefined) => {
      if (line == null) return '-';
      if (!onJumpToSourceLine) return line;
      return (
        <button
          type="button"
          onClick={() => onJumpToSourceLine(line)}
          className="font-mono text-blue-300 underline decoration-dotted underline-offset-2 hover:text-blue-200"
          title={`Jump to line ${line} in the input editor`}
        >
          {line}
        </button>
      );
    },
    [onJumpToSourceLine],
  );

  const renderCollapsibleSectionHeader = useCallback(
    (params: {
      sectionId: CollapsibleDetailSectionId;
      label: string;
      className: string;
      labelClassName: string;
      title?: string;
    }) => {
      const { sectionId, label, className, labelClassName, title } = params;
      return (
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
          onHeaderRef={registerDetailSectionHeader}
        />
      );
    },
    [
      isDetailSectionPinned,
      isSectionCollapsed,
      registerDetailSectionHeader,
      toggleDetailSection,
      togglePinnedDetailSection,
    ],
  );

  const renderLoadMoreFooter = useCallback(
    (key: string, shownCount: number, totalCount: number, step = REPORT_TABLE_WINDOW_SIZE) => (
      <ReportLoadMoreFooter
        rowKey={key}
        shownCount={shownCount}
        totalCount={totalCount}
        onShowMore={showMoreRows}
        onShowAll={showAllRows}
        step={step}
      />
    ),
    [showAllRows, showMoreRows],
  );

  useEffect(() => {
    const root = reportRootRef.current;
    if (!root) return;
    const headers = root.querySelectorAll('th');
    headers.forEach((th) => {
      const label = th.textContent ?? '';
      const tip = getReportHeaderTooltip(label);
      if (tip) th.setAttribute('title', tip);
    });
  });

  return {
    registerDetailSectionHeader,
    renderCollapsibleSectionHeader,
    renderLoadMoreFooter,
    renderSourceLineLink,
  };
};
