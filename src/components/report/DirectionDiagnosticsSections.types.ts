import type React from 'react';
import type {
  AdjustmentResult,
  DirectionRejectDiagnostic,
  DirectionSetTreatmentDiagnostic,
} from '../../types';
import type { CollapsibleDetailSectionId } from './reportSectionRegistry';

export interface HeaderParams {
  sectionId: CollapsibleDetailSectionId;
  label: string;
  className: string;
  labelClassName: string;
  title?: string;
}

export type DirectionSetDiagnostic = NonNullable<AdjustmentResult['directionSetDiagnostics']>[number];
export type DirectionTargetDiagnostic = NonNullable<
  AdjustmentResult['directionTargetDiagnostics']
>[number];
export type DirectionRepeatabilityDiagnostic = NonNullable<
  AdjustmentResult['directionRepeatabilityDiagnostics']
>[number];

export interface DirectionDiagnosticsSectionsProps {
  result: AdjustmentResult;
  isPreanalysis: boolean;
  isDataCheck: boolean;
  directionTreatmentDiagnostics: DirectionSetTreatmentDiagnostic[];
  directionRejects: DirectionRejectDiagnostic[];
  visibleDirectionRejects: DirectionRejectDiagnostic[];
  topDirectionTargetSuspects: DirectionTargetDiagnostic[];
  topDirectionRepeatabilitySuspects: DirectionRepeatabilityDiagnostic[];
  renderCollapsibleSectionHeader: (_params: HeaderParams) => React.ReactNode;
  isSectionCollapsed: (_sectionId: CollapsibleDetailSectionId) => boolean;
  renderLoadMoreFooter: (
    _key: string,
    _shownCount: number,
    _totalCount: number,
    _step?: number,
  ) => React.ReactNode;
  renderSourceLineLink: (_line: number | null | undefined) => React.ReactNode;
  showFaceTreatmentSection?: boolean;
}
