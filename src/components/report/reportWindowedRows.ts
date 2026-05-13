import type { AdjustmentResult, RelativeCovarianceBlock, StationCovarianceBlock } from '../../types';
import type { SortedObservation } from '../../engine/resultDerivedModels';
import { REPORT_DIAGNOSTIC_WINDOW_SIZE } from './reportSectionRegistry';

type VisibleRowsFor = <T>(
  _key: string,
  _rows: T[],
  _step?: number,
) => T[];

export interface ReportWindowedRowsModel {
  visibleTraverseLoopSuspects: NonNullable<NonNullable<AdjustmentResult['traverseDiagnostics']>['loops']>;
  visibleGpsLoopSuspects: NonNullable<NonNullable<AdjustmentResult['gpsLoopDiagnostics']>['loops']>;
  visibleLevelingLoopSuspects: NonNullable<NonNullable<AdjustmentResult['levelingLoopDiagnostics']>['loops']>;
  visibleDirectionRejects: NonNullable<AdjustmentResult['directionRejectDiagnostics']>;
  visibleStationCovariances: StationCovarianceBlock[];
  visibleRelativeCovariances: RelativeCovarianceBlock[];
  visibleRelativePrecision: NonNullable<AdjustmentResult['relativePrecision']>;
}

export const buildReportWindowedRowsModel = (input: {
  visibleRowsFor: VisibleRowsFor;
  traverseLoopSuspects: NonNullable<NonNullable<AdjustmentResult['traverseDiagnostics']>['loops']>;
  gpsLoopSuspects: NonNullable<NonNullable<AdjustmentResult['gpsLoopDiagnostics']>['loops']>;
  levelingLoopSuspects: NonNullable<NonNullable<AdjustmentResult['levelingLoopDiagnostics']>['loops']>;
  directionRejects: NonNullable<AdjustmentResult['directionRejectDiagnostics']>;
  filteredStationCovariances: StationCovarianceBlock[];
  filteredRelativeCovariances: RelativeCovarianceBlock[];
  filteredRelativePrecision: NonNullable<AdjustmentResult['relativePrecision']>;
}): ReportWindowedRowsModel => ({
  visibleTraverseLoopSuspects: input.visibleRowsFor(
    'traverse-loop-suspects',
    input.traverseLoopSuspects,
    REPORT_DIAGNOSTIC_WINDOW_SIZE,
  ),
  visibleGpsLoopSuspects: input.visibleRowsFor(
    'gps-loop-suspects',
    input.gpsLoopSuspects,
    REPORT_DIAGNOSTIC_WINDOW_SIZE,
  ),
  visibleLevelingLoopSuspects: input.visibleRowsFor(
    'leveling-loop-suspects',
    input.levelingLoopSuspects,
    REPORT_DIAGNOSTIC_WINDOW_SIZE,
  ),
  visibleDirectionRejects: input.visibleRowsFor(
    'direction-reject-diagnostics',
    input.directionRejects,
    REPORT_DIAGNOSTIC_WINDOW_SIZE,
  ),
  visibleStationCovariances: input.visibleRowsFor(
    'station-covariances',
    input.filteredStationCovariances,
  ),
  visibleRelativeCovariances: input.visibleRowsFor(
    'relative-covariances',
    input.filteredRelativeCovariances,
  ),
  visibleRelativePrecision: input.visibleRowsFor(
    'relative-precision',
    input.filteredRelativePrecision,
  ),
});
