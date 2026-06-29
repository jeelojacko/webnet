import type { CadDisplayPoint, CadEntity, CadEntityId } from './cadTypes';

export type CadCogoToolKey =
  | 'INVERSE'
  | 'MULTI_INVERSE'
  | 'AREA'
  | 'PARCEL_CHECK'
  | 'PARCEL_OVERLAP'
  | 'PARCEL_SPLIT'
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

export interface CadCogoReport {
  title: string;
  summary: string;
  rows: CadCogoReportRow[];
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

export interface CadCogoResult {
  createdEntities: CadEntity[];
  updatedEntities?: CadEntity[];
  removedEntityIds?: CadEntityId[];
  report: CadCogoReport;
  warnings: CadCogoWarning[];
  alternatives?: CadCogoAlternative[];
  provenance: CadCogoProvenance;
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

export const buildCadCogoEntityMetadata = (
  existing: Record<string, unknown> | undefined,
  provenance: CadCogoProvenance,
): Record<string, unknown> => ({
  ...(existing ?? {}),
  cogo: {
    toolKey: provenance.toolKey,
    provenanceId: provenance.id,
    inputs: provenance.inputs,
    parameters: provenance.parameters ?? {},
    sourceEntityIds: provenance.sourceEntityIds ?? [],
    sourcePointIds: provenance.sourcePointIds ?? [],
    resultSummary: provenance.resultSummary,
    createdAtIso: provenance.createdAtIso,
  },
});

export const buildCadCogoComputation = (
  result: CadCogoResult,
): CadCogoComputation => ({
  id: result.provenance.id,
  toolKey: result.provenance.toolKey,
  createdAtIso: result.provenance.createdAtIso,
  provenance: result.provenance,
  report: result.report,
  warnings: result.warnings,
  alternatives: result.alternatives,
  createdEntityIds: result.createdEntities.map((entity) => entity.id),
  updatedEntityIds: result.updatedEntities?.map((entity) => entity.id) ?? [],
  removedEntityIds: result.removedEntityIds ?? [],
});
