import type {
  ImportedDataset,
  ImportedInputNotice,
  ImportedObservationRecord,
  ImportedTraceEntry,
} from './importers';
import type { CoordMode, FaceNormalizationMode } from '../types';

export type ImportReviewItemKind = 'control' | 'observation' | 'comment';
export type ImportReviewGroupKind = 'control' | 'setup' | 'resection' | 'gps';
export type ImportReviewOutputPreset =
  | 'clean-webnet'
  | 'field-grouped'
  | 'ts-direction-set'
  | 'industry-style';
export type ImportReviewRowTypeOverride =
  | 'auto'
  | 'measurement'
  | 'distance'
  | 'distance-vertical'
  | 'angle'
  | 'vertical'
  | 'bearing'
  | 'direction-angle'
  | 'direction-measurement';

export interface ImportReviewItem {
  id: string;
  kind: ImportReviewItemKind;
  index: number;
  groupKey: string;
  sourceKey?: string;
  sourceName?: string;
  sourceType: string;
  sourceLine?: number;
  sourceCode?: string;
  sourceMethod?: string;
  sourceClassification?: string;
  sourceObservationKind?: ImportedObservationRecord['kind'];
  setupId?: string;
  backsightId?: string;
  targetId?: string;
  stationId?: string;
  synthetic?: boolean;
  defaultText?: string;
}

export interface ImportReviewGroup {
  key: string;
  kind: ImportReviewGroupKind;
  label: string;
  defaultComment: string;
  sourceKey?: string;
  sourceName?: string;
  synthetic?: boolean;
  manualOrder?: boolean;
  setupId?: string;
  backsightId?: string;
  itemIds: string[];
}

export interface ImportReviewModel {
  groups: ImportReviewGroup[];
  items: ImportReviewItem[];
  warnings: ImportedTraceEntry[];
  errors: ImportedTraceEntry[];
}

export interface ImportReviewComparisonTotals {
  controlStations: number;
  observations: number;
  comparedObservations: number;
  warnings: number;
  errors: number;
}

export type ImportReviewComparisonMode = 'non-mta-only' | 'all-raw';

export interface ImportReviewComparisonSourceSummary {
  key: string;
  sourceName: string;
  notice: ImportedInputNotice;
  importerId: string;
  formatLabel: string;
  isPrimary: boolean;
  totals: ImportReviewComparisonTotals;
}

export interface ImportReviewComparisonRow {
  key: string;
  setupLabel: string;
  targetLabel: string;
  family: string;
  countsBySource: number[];
  minCount: number;
  maxCount: number;
  spread: number;
  sourcePresenceCount: number;
}

export interface ImportReviewComparisonSummary {
  mode: ImportReviewComparisonMode;
  sources: ImportReviewComparisonSourceSummary[];
  rows: ImportReviewComparisonRow[];
}

export interface ImportReviewWorkspaceSource {
  key: string;
  sourceName: string;
  notice: ImportedInputNotice;
  dataset: ImportedDataset;
  isPrimary: boolean;
}

export interface BuildImportReviewTextOptions {
  includedItemIds: Set<string>;
  groupComments?: Record<string, string>;
  itemCommentLines?: Record<string, string[]>;
  rowOverrides?: Record<string, string>;
  rowTypeOverrides?: Record<string, ImportReviewRowTypeOverride>;
  fixedItemIds?: Set<string>;
  preset?: ImportReviewOutputPreset;
  faceNormalizationMode?: FaceNormalizationMode;
  syntheticDirectionBacksightMode?: 'auto' | 'always' | 'never';
  emitDirectionFaceHints?: boolean;
  emitSourceHeaders?: boolean;
  coordMode?: CoordMode;
  force2D?: boolean;
}
