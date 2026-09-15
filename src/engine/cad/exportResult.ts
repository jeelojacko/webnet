// Unified export result contract (Phase 13E §§20,21,30).
//
// Every exporter speaks one shape: the payload plus warnings, errors, and
// per-entity disposition lists. No silent drops — every skipped entity lands
// in omittedEntityIds with a warning, every approximated one in
// approximatedEntityIds with a warning. Contract: exported XOR omitted;
// approximated is a subset flag of exported (approximated ⇒ exported +
// warning). Serializers that cannot attribute
// entities (pure scene→bytes paths) leave the id lists empty and say so.

export type ExportWarningCode =
  | 'BROKEN_REFERENCE'
  | 'UNKNOWN_TOKEN'
  | 'MISSING_STYLE'
  | 'SKIPPED_ENTITY'
  | 'GLYPH_SUBSTITUTION'
  | 'UNSUPPORTED_SHEET_OBJECT'
  | 'SKIPPED_PAPER_ITEM'
  | 'POINT_SYMBOL_APPROXIMATED';

export interface ExportWarning {
  code: ExportWarningCode;
  message: string;
  /** Source entity when the warning is attributable; absent otherwise. */
  entityId?: string;
}

export interface ExportError {
  message: string;
}

export interface ExportResult<T> {
  output: T;
  warnings: ExportWarning[];
  errors: ExportError[];
  exportedEntityIds: string[];
  omittedEntityIds: string[];
  approximatedEntityIds: string[];
}

export const emptyExportResult = <T>(output: T): ExportResult<T> => ({
  output,
  warnings: [],
  errors: [],
  exportedEntityIds: [],
  omittedEntityIds: [],
  approximatedEntityIds: [],
});

const unique = (ids: string[]): string[] => [...new Set(ids)].sort();

/**
 * Sort id lists deterministically and enforce the documented invariant:
 * exported XOR omitted, approximated ⊆ exported. Fail-closed normalize
 * policy (deterministic, no silent drops):
 * - an id in both exported and omitted is treated as OMITTED (never claim
 *   an export that was also recorded as skipped) and dropped from
 *   approximated, with a SKIPPED_ENTITY warning;
 * - an approximated id present in neither exported nor omitted is treated
 *   as OMITTED (never claim an approximation that was not exported) and
 *   moved to omitted, with a SKIPPED_ENTITY warning.
 * Both repairs warn entity-attributed so no disposition change is silent.
 */
export const finalizeExportResult = <T>(result: ExportResult<T>): ExportResult<T> => {
  const exported = new Set(result.exportedEntityIds);
  const omitted = new Set(result.omittedEntityIds);
  const approximated = new Set(result.approximatedEntityIds);
  const warnings = [...result.warnings];
  exported.forEach((id) => {
    if (omitted.has(id)) {
      exported.delete(id);
      approximated.delete(id);
      warnings.push({
        code: 'SKIPPED_ENTITY',
        message: `entity ${id} recorded as both exported and omitted; treated as omitted`,
        entityId: id,
      });
    }
  });
  approximated.forEach((id) => {
    if (!exported.has(id) && !omitted.has(id)) {
      approximated.delete(id);
      omitted.add(id);
      warnings.push({
        code: 'SKIPPED_ENTITY',
        message: `entity ${id} marked approximated but not exported; treated as omitted`,
        entityId: id,
      });
    } else if (omitted.has(id)) {
      approximated.delete(id);
      warnings.push({
        code: 'SKIPPED_ENTITY',
        message: `entity ${id} marked approximated but omitted; approximation dropped`,
        entityId: id,
      });
    }
  });
  return {
    ...result,
    warnings,
    exportedEntityIds: unique([...exported]),
    omittedEntityIds: unique([...omitted]),
    approximatedEntityIds: unique([...approximated]),
  };
};
