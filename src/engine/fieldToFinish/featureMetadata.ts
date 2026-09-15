/**
 * Vendor-neutral field-to-finish feature metadata.
 *
 * Code-vs-description stays distinct: `rawCodeText`/`codes[]` carry the
 * field coding, `description` carries the human note. Importers preserve the
 * raw text; matching resolves canonical codes downstream.
 */

export enum FieldLineworkControl {
  BEGIN = 'BEGIN',
  CONTINUE = 'CONTINUE',
  END = 'END',
  CLOSE = 'CLOSE',
  BREAK = 'BREAK',
}

export type FeatureCodeRole = 'point' | 'linework' | 'both';

export interface ParsedFeatureCode {
  /** Canonical code text (post canonicalization). */
  code: string;
  /** Raw token as observed in the field code string. */
  rawCode: string;
  role: FeatureCodeRole;
  /** Multi-code instance tag, e.g. `1` in `EP1`. Undefined when absent. */
  instance?: string;
  controls: FieldLineworkControl[];
}

export interface ImportedFeatureMetadata {
  /** Full raw field code string, preserved verbatim for traceability. */
  rawCodeText?: string;
  codes: ParsedFeatureCode[];
  description?: string;
  attributes?: Record<string, string>;
  /** Authoritative field observation order (sequence number, not point id). */
  sourceOrder?: number;
}
