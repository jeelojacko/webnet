import type React from 'react';

import type { Observation } from '../../types';
import type { CollapsibleDetailSectionId } from './reportSectionRegistry';

export type SourceLineRenderer = (_line: number | null | undefined) => React.ReactNode;
export type ObservationFormatter = (_obs: Observation) => React.ReactNode;
export type TooltipResolver = (_label: string) => string | undefined;

export type SectionControls = {
  isDetailSectionPinned: (_id: CollapsibleDetailSectionId) => boolean;
  isSectionCollapsed: (_id: CollapsibleDetailSectionId) => boolean;
  onHeaderRef: (_id: CollapsibleDetailSectionId, _node: HTMLDivElement | null) => void;
  toggleDetailSection: (_id: CollapsibleDetailSectionId) => void;
  togglePinnedDetailSection: (_id: CollapsibleDetailSectionId, _label: string) => void;
};
