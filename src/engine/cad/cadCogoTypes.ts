import type { CadEntity, CadEntityId } from './cadTypes';
import type {
  CadCogoAlternative,
  CadCogoComputation,
  CadCogoProvenance,
  CadCogoReport,
  CadCogoWarning,
} from './cadCogoRecordTypes';

export type {
  CadCogoAlternative,
  CadCogoComputation,
  CadCogoProvenance,
  CadCogoReport,
  CadCogoReportRow,
  CadCogoReportTable,
  CadCogoToolKey,
  CadCogoWarning,
} from './cadCogoRecordTypes';

export interface CadCogoResult {
  createdEntities: CadEntity[];
  updatedEntities?: CadEntity[];
  removedEntityIds?: CadEntityId[];
  report: CadCogoReport;
  warnings: CadCogoWarning[];
  alternatives?: CadCogoAlternative[];
  provenance: CadCogoProvenance;
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
