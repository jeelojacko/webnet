import type React from 'react';
import type { CollapsibleDetailSectionId } from './reportSectionRegistry';

export type LoadMoreRenderer = (
  _key: string,
  _shownCount: number,
  _totalCount: number,
) => React.ReactNode;

export type TooltipResolver = (_label: string) => string | undefined;

export type SectionControls = {
  isDetailSectionPinned: (_id: CollapsibleDetailSectionId) => boolean;
  isSectionCollapsed: (_id: CollapsibleDetailSectionId) => boolean;
  onHeaderRef: (_id: CollapsibleDetailSectionId, _node: HTMLDivElement | null) => void;
  toggleDetailSection: (_id: CollapsibleDetailSectionId) => void;
  togglePinnedDetailSection: (_id: CollapsibleDetailSectionId, _label: string) => void;
};
