import type React from 'react';
import type { AdjustmentResult } from '../../types';
import type { CollapsibleDetailSectionId } from './reportSectionRegistry';

export interface HeaderParams {
  sectionId: CollapsibleDetailSectionId;
  label: string;
  className: string;
  labelClassName: string;
  title?: string;
}

export interface ReportDiagnosticsSectionsProps {
  result: AdjustmentResult;
  isPreanalysis: boolean;
  isDataCheck: boolean;
  isSpecialRunMode: boolean;
  showTsCorrelationDiagnosticsSection: boolean;
  renderCollapsibleSectionHeader: (_params: HeaderParams) => React.ReactNode;
  isSectionCollapsed: (_sectionId: CollapsibleDetailSectionId) => boolean;
  renderSourceLineLink: (_line: number | null | undefined) => React.ReactNode;
}
