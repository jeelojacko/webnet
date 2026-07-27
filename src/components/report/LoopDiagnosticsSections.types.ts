import type React from 'react';
import type {
  AdjustmentResult,
  LevelingLoopDiagnosticRow,
  LevelingLoopSegmentSuspectRow,
} from '../../types';
import type { CollapsibleDetailSectionId } from './reportSectionRegistry';

export interface HeaderParams {
  sectionId: CollapsibleDetailSectionId;
  label: string;
  className: string;
  labelClassName: string;
  title?: string;
}

export type TraverseLoop = NonNullable<
  NonNullable<AdjustmentResult['traverseDiagnostics']>['loops']
>[number];
export type GpsLoop = NonNullable<NonNullable<AdjustmentResult['gpsLoopDiagnostics']>['loops']>[number];
export type LevelingLoop = LevelingLoopDiagnosticRow;
export type LevelingSegmentSuspect = LevelingLoopSegmentSuspectRow;

export interface LoopDiagnosticsSectionsProps {
  result: AdjustmentResult;
  units: 'm' | 'ft';
  unitScale: number;
  isPreanalysis: boolean;
  isDataCheck: boolean;
  showLevelingLoopDiagnosticsSection: boolean;
  traverseLoops: TraverseLoop[];
  traverseLoopSuspects: TraverseLoop[];
  visibleTraverseLoopSuspects: TraverseLoop[];
  gpsLoopSuspects: GpsLoop[];
  visibleGpsLoopSuspects: GpsLoop[];
  levelingLoopSuspects: LevelingLoop[];
  visibleLevelingLoopSuspects: LevelingLoop[];
  levelingSegmentSuspects: LevelingSegmentSuspect[];
  highlightedLevelingSegmentLines: Set<number>;
  gpsLoopDiagnostics: AdjustmentResult['gpsLoopDiagnostics'];
  levelingLoopDiagnostics: AdjustmentResult['levelingLoopDiagnostics'];
  renderCollapsibleSectionHeader: (_params: HeaderParams) => React.ReactNode;
  isSectionCollapsed: (_sectionId: CollapsibleDetailSectionId) => boolean;
  renderLoadMoreFooter: (
    _key: string,
    _shownCount: number,
    _totalCount: number,
    _step?: number,
  ) => React.ReactNode;
  renderSourceLineLink: (_line: number | null | undefined) => React.ReactNode;
}
