/**
 * STRUCT-195.7 CAD COGO persisted record type leaf.
 *
 * Zero-value, type-only module. It holds the persisted COGO record DTOs
 * (`CadCogoComputation` and everything it transitively references) so that
 * `cadTypes.ts` can depend on `CadCogoComputation` WITHOUT pulling the full
 * `cadTypes` surface (and its transitive type cycle) back in.
 *
 * Contract: this file exports ONLY type aliases / interfaces. Its only
 * imports are the primitive `CadEntityId` alias and the display-only
 * `CadDisplayPoint`; it must never import from `cadTypes`.
 */

import type { CadEntityId } from './cadCorePrimitiveTypes';
import type { CadDisplayPoint } from './cadDisplayTypes';

export type CadCogoToolKey =
  | 'INVERSE'
  | 'MULTI_INVERSE'
  | 'AREA'
  | 'PARCEL_CHECK'
  | 'PARCEL_GAP'
  | 'PARCEL_OVERLAP'
  | 'PARCEL_SPLIT'
  | 'PARCEL_SPLIT_BEARING'
  | 'PARCEL_SPLIT_AREA'
  | 'PARCEL_SPLIT_SLIDE'
  | 'PARCEL_SPLIT_SWING'
  | 'PARCEL_LAYOUT_AUTO'
  | 'COGO_POINT'
  | 'INTERSECT_POINT'
  | 'CURVE_CALCULATOR'
  | 'ARC_CREATE'
  | 'TANGENT_CURVE'
  | 'TRAVERSE'
  | 'PARCEL_CREATE'
  | 'OFFSET'
  | 'ALIGNMENT'
  | (string & {});

export interface CadCogoReportRow {
  label: string;
  value: string;
  unit?: string;
}

export interface CadCogoReportTable {
  title: string;
  columns: string[];
  rows: string[][];
}

export interface CadCogoReport {
  title: string;
  summary: string;
  rows: CadCogoReportRow[];
  tables?: CadCogoReportTable[];
}

export interface CadCogoWarning {
  code: string;
  message: string;
  severity: 'info' | 'warning' | 'error';
}

export interface CadCogoAlternative {
  id: string;
  label: string;
  point?: CadDisplayPoint;
  report?: CadCogoReport;
}

export interface CadCogoProvenance {
  id: string;
  toolKey: CadCogoToolKey;
  inputs: Record<string, unknown>;
  parameters?: Record<string, unknown>;
  sourceEntityIds?: CadEntityId[];
  sourcePointIds?: string[];
  resultSummary: string;
  createdAtIso?: string;
}

export interface CadCogoComputation {
  id: string;
  toolKey: CadCogoToolKey;
  createdAtIso?: string;
  provenance: CadCogoProvenance;
  report: CadCogoReport;
  warnings: CadCogoWarning[];
  alternatives?: CadCogoAlternative[];
  createdEntityIds: CadEntityId[];
  updatedEntityIds: CadEntityId[];
  removedEntityIds: CadEntityId[];
}
