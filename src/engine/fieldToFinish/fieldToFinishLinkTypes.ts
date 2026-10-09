/**
 * Phase 13E Bucket A1 — linked field-to-finish source model.
 *
 * Additive only: records WHICH source + catalog revision produced the
 * current F2F linework so later work can detect staleness. No math,
 * no auto-sync wiring, no behavior change to regeneration.ts.
 *
 * sourceRevision is the authoritative adjustment-result fingerprint
 * (`adjustment-result/v1`, see `../adjustmentResultFingerprint.ts`) for
 * links stamped with result context; older links carry the legacy composite
 * `<inputFingerprint>:<settingsFingerprint>` (inputs+settings only — two
 * runs with identical inputs but different solver versions read CURRENT).
 * Legacy links fail closed: they never compare CURRENT against a
 * result-fingerprint snapshot.
 */

export type FieldToFinishSourceKind = 'adjustment' | 'coordinate-import';

export type FieldToFinishSyncStatus =
  | 'CURRENT'
  | 'COORDINATES_CHANGED'
  | 'SOURCE_TOPOLOGY_CHANGED'
  | 'FEATURE_METADATA_CHANGED'
  | 'CATALOG_CHANGED'
  | 'MANUAL_CONFLICT'
  | 'MISSING_SOURCE'
  | 'UNLINKED';

export interface FieldToFinishLink {
  generationRunId: string;
  catalogId: string;
  /**
   * Phase 18E content revision (computeFeatureCatalogRevision output at
   * generation time). Legacy links carry the old catalog.version string —
   * they compare unequal against any derived hash (fail-closed stale),
   * never false CURRENT.
   */
  catalogRevision: string;
  sourceKind: FieldToFinishSourceKind;
  /**
   * Authoritative revision: the adjustment-result fingerprint
   * (`adjustment-result/v1`) for links stamped with result context;
   * legacy `<inputFingerprint>:<settingsFingerprint>` composite otherwise.
   * Empty string = unknown (legacy/auto-stamped without fingerprint context).
   *
   * Legacy-composite links NEVER compare CURRENT against a result-fingerprint
   * snapshot (different shapes always mismatch → COORDINATES_CHANGED,
   * fail-closed). No silent false CURRENT.
   */
  sourceRevision: string;
  /** Provenance retained alongside the authoritative revision (all optional, additive). */
  inputFingerprint?: string;
  settingsFingerprint?: string;
  resultFingerprint?: string;
  sourceRecordIds: string[];
  stationIds: string[];
  generatedEntityIds: string[];
  generatedLabelIds: string[];
  syncPolicy: 'manual';
  status: FieldToFinishSyncStatus;
}
