import type {
  AliasTraceEntry,
  DescriptionReconcileMode,
  DescriptionScanSummary,
  DescriptionTraceEntry,
  Observation,
  StationMap,
} from '../types';

export type SortedObservation = Observation & { originalIndex: number };

export interface DataCheckDiffRow {
  obs: Observation;
  stations: string;
  diffMagnitude: number;
  diffLabel: string;
}

export interface ObservationMapLink {
  key: string;
  observationId: number;
  type: Observation['type'];
  fromId: string;
  toId: string;
  sourceLine: number | null;
  pairKey: string;
}

export interface VisibleStationRow {
  id: string;
  station: StationMap[string];
  severity: 'watch' | 'weak' | null;
}

export interface DescriptionReferenceRow {
  key: string;
  description: string;
  lines: number[];
}

export interface ResultTraceabilityModel {
  aliasTrace: AliasTraceEntry[];
  descriptionTrace: DescriptionTraceEntry[];
  descriptionScanSummary: DescriptionScanSummary[];
  descriptionConflicts: DescriptionScanSummary[];
  descriptionRefsByStation: Map<string, DescriptionReferenceRow[]>;
  lostStationIds: string[];
  descriptionReconcileMode: DescriptionReconcileMode;
  descriptionAppendDelimiter: string;
  descriptionRepeatedStationCount: number;
  descriptionConflictCount: number;
  reconciledDescriptions: Record<string, string>;
}

export interface ResultStatisticalSummaryRow {
  label: string;
  count: number;
  sumSquares: number;
  errorFactor: number;
}

export interface ResultStatisticalSummaryModel {
  rows: ResultStatisticalSummaryRow[];
  totalCount: number;
  totalSumSquares: number;
}

export type StatisticalSummaryProfile = 'ui' | 'listing';
