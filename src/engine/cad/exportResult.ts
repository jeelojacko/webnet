// Unified export result contract (Phase 13E §§20,21,30).
//
// Every exporter speaks one shape: the payload plus warnings, errors, and
// per-entity disposition lists. No silent drops — every skipped entity lands
// in omittedEntityIds with a warning, every approximated one in
// approximatedEntityIds with a warning. Serializers that cannot attribute
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

/** Sort id lists deterministically before handing a result to callers. */
export const finalizeExportResult = <T>(result: ExportResult<T>): ExportResult<T> => ({
  ...result,
  exportedEntityIds: unique(result.exportedEntityIds),
  omittedEntityIds: unique(result.omittedEntityIds),
  approximatedEntityIds: unique(result.approximatedEntityIds),
});
