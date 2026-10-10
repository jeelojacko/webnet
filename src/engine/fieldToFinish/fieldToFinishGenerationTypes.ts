/**
 * STRUCT-195.4 — cycle-free PURE TYPE leaf for the field-to-finish
 * generation payload/provenance model.
 *
 * Extracted verbatim from `cadGeneration.ts` (and the `LinkOfPayloadSource`
 * source-context shape from `linkedSync.ts`) so the CAD transaction hub and
 * `linkedSync` can depend on the F2F payload shape without importing the
 * generator runtime — that type back-edge is what formed the
 * `linkedSync ⇄ cadGeneration` cycle. This leaf imports TYPE ONLY from
 * `cadTypes`, `resultIntegrity`, and `fieldToFinishLinkTypes`; it has ZERO
 * runtime value imports and no dependency back on cadGeneration, linkedSync,
 * or cadTransactions.
 *
 * `generatedBy` is the exact literal `'FIELD_TO_FINISH'` (not
 * `typeof FIELD_TO_FINISH_GENERATOR`) precisely so this leaf needs no import
 * of the generator. The runtime generator const stays in `cadGeneration.ts`;
 * its `as const` value is the same literal, so the two types are identical.
 */
import type { CadEntity, CadLayer, CadStyle } from '../cad/cadTypes';
import type { ResultDependencyIdentity } from '../resultIntegrity';
import type { FieldToFinishSourceKind } from './fieldToFinishLinkTypes';

export type FieldToFinishEntityState = 'GENERATED' | 'MANUAL_OVERRIDE' | 'DETACHED';

export interface FieldToFinishProvenance {
  /** Literal, deliberately not `typeof FIELD_TO_FINISH_GENERATOR`: importing the generator here would restore the type cycle. */
  generatedBy: 'FIELD_TO_FINISH';
  sourceImportId?: string;
  sourceFileHash?: string;
  sourceRecordId?: string;
  sourceStationId?: string;
  featureDefinitionId?: string;
  catalogId?: string;
  /** Legacy display string (catalog.version at generation time). */
  catalogVersion?: string;
  /** Phase 18E content revision (computeFeatureCatalogRevision at generation time). */
  catalogRevision?: string;
  generationRunId?: string;
  state: FieldToFinishEntityState;
}

export interface LinkOfPayloadSource {
  /** Which source produced this generation: adjustment-backed generations stamp 'adjustment' so rerun auto-sync applies; coordinate imports keep the default. */
  sourceKind?: FieldToFinishSourceKind;
  /**
   * Fingerprint context: resultFingerprint is authoritative for the
   * sourceRevision (new runs); input/settings are retained as provenance.
   * When absent the prior link revision is preserved.
   */
  inputFingerprint?: string;
  settingsFingerprint?: string;
  resultFingerprint?: string;
}

/** Serializable payload applied by the F2F_GENERATE command (one transaction). */
export interface FieldToFinishCadPayload {
  layersToAdd: CadLayer[];
  stylesToAdd: CadStyle[];
  upsertEntities: CadEntity[];
  removeEntityIds: string[];
  label: string;
  /**
   * Link source context stamped by linkOfPayload. Only set when the caller
   * provides it; absent = coordinate import (the historical default).
   * Adjustment-backed generations set sourceKind 'adjustment' plus run
   * fingerprints so rerun auto-sync applies to the resulting link.
   */
  source?: LinkOfPayloadSource;
  /**
   * Phase 17E: commit-time result identity, carried through the undoable
   * command so generated entities stamp CURRENT on apply. Set only for
   * adjustment-backed generations; absent = unstamped (fail-closed).
   */
  resultDependencyIdentity?: ResultDependencyIdentity | null;
}
