/**
 * Phase 13E Bucket A1 — linked field-to-finish source model.
 *
 * Additive only: records WHICH source + catalog revision produced the
 * current F2F linework so later work can detect staleness. No math,
 * no auto-sync wiring, no behavior change to regeneration.ts.
 *
 * sourceRevision is a documented composite of the existing adjustment
 * `inputFingerprint` + `settingsFingerprint`
 * (`<input>:<settings>`). Limitation: it identities the adjustment
 * INPUTS+SETTINGS, not the result — two runs with identical inputs but
 * different solver versions read CURRENT. A result hash does not exist
 * yet; add one when the solver stamps it.
 */
import type { CadEntity, CadProject } from '../cad/cadTypes';
import type { FieldToFinishCadPayload, FieldToFinishProvenance } from './cadGeneration';
import type { FeatureCodeCatalog } from './featureCatalog';

/** Local F2F-entity check (mirrors isFieldToFinishEntity without the import cycle). */
const isGenerated = (entity: CadEntity): FieldToFinishProvenance | undefined => {
  const metadata = entity.metadata as Record<string, unknown> | undefined;
  const provenance = metadata?.['provenance'] as Record<string, unknown> | undefined;
  if (provenance?.['generatedBy'] !== 'FIELD_TO_FINISH') return undefined;
  return provenance as unknown as FieldToFinishProvenance;
};

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
  /** Catalog revision (catalog.version at generation time). */
  catalogRevision: string;
  sourceKind: FieldToFinishSourceKind;
  /**
   * Documented composite `<inputFingerprint>:<settingsFingerprint>`.
   * Empty string = unknown (legacy/auto-stamped without fingerprint context).
   */
  sourceRevision: string;
  sourceRecordIds: string[];
  stationIds: string[];
  generatedEntityIds: string[];
  generatedLabelIds: string[];
  syncPolicy: 'manual';
  status: FieldToFinishSyncStatus;
}

/** `<inputFingerprint>:<settingsFingerprint>` (empty parts stay empty). */
export const buildSourceRevision = (fingerprints: {
  inputFingerprint?: string;
  settingsFingerprint?: string;
}): string =>
  `${fingerprints.inputFingerprint ?? ''}:${fingerprints.settingsFingerprint ?? ''}`;

export const cloneFieldToFinishLink = (link: FieldToFinishLink): FieldToFinishLink => ({
  ...link,
  sourceRecordIds: [...link.sourceRecordIds],
  stationIds: [...link.stationIds],
  generatedEntityIds: [...link.generatedEntityIds],
  generatedLabelIds: [...link.generatedLabelIds],
});

export const buildFieldToFinishLink = (init: {
  generationRunId: string;
  catalogId: string;
  catalogRevision: string;
  sourceKind?: FieldToFinishSourceKind;
  inputFingerprint?: string;
  settingsFingerprint?: string;
  sourceRevision?: string;
  sourceRecordIds: readonly string[];
  stationIds: readonly string[];
  generatedEntityIds: readonly string[];
  generatedLabelIds: readonly string[];
}): FieldToFinishLink => ({
  generationRunId: init.generationRunId,
  catalogId: init.catalogId,
  catalogRevision: init.catalogRevision,
  sourceKind: init.sourceKind ?? 'coordinate-import',
  sourceRevision: init.sourceRevision ?? buildSourceRevision(init),
  sourceRecordIds: dedupeSorted(init.sourceRecordIds),
  stationIds: dedupeSorted(init.stationIds),
  generatedEntityIds: dedupeSorted(init.generatedEntityIds),
  generatedLabelIds: dedupeSorted(init.generatedLabelIds),
  syncPolicy: 'manual',
  status: 'CURRENT',
});

/** Canonicalize id lists at construction: deduped + sorted, so later set comparisons are exact. */
const dedupeSorted = (ids: readonly string[]): string[] => [...new Set(ids)].sort();

export interface FieldToFinishSyncSnapshot {
  sourceRevision?: string;
  catalogRevision?: string;
  stationIds?: readonly string[];
  sourceRecordIds?: readonly string[];
  manualConflict?: boolean;
  sourceExists?: boolean;
}

/** True set equality: duplicate-bearing arrays such as ['x','x'] vs ['x','y'] compare unequal. */
const sameSet = (a: readonly string[], b: readonly string[]): boolean => {
  const setA = new Set(a);
  const setB = new Set(b);
  if (setA.size !== setB.size) return false;
  for (const id of setA) {
    if (!setB.has(id)) return false;
  }
  return true;
};

/**
 * Staleness classifier. Precedence: UNLINKED > MISSING_SOURCE >
 * MANUAL_CONFLICT > CATALOG_CHANGED > SOURCE_TOPOLOGY_CHANGED >
 * FEATURE_METADATA_CHANGED > COORDINATES_CHANGED > CURRENT.
 */
export const computeSyncStatus = (
  link: FieldToFinishLink | undefined,
  current: FieldToFinishSyncSnapshot = {},
): FieldToFinishSyncStatus => {
  if (!link) return 'UNLINKED';
  if (current.sourceExists === false) return 'MISSING_SOURCE';
  if (current.manualConflict === true) return 'MANUAL_CONFLICT';
  if (current.catalogRevision !== undefined && current.catalogRevision !== link.catalogRevision) {
    return 'CATALOG_CHANGED';
  }
  if (current.stationIds !== undefined && !sameSet(current.stationIds, link.stationIds)) {
    return 'SOURCE_TOPOLOGY_CHANGED';
  }
  if (current.sourceRecordIds !== undefined && !sameSet(current.sourceRecordIds, link.sourceRecordIds)) {
    return 'FEATURE_METADATA_CHANGED';
  }
  if (
    current.sourceRevision !== undefined
    && link.sourceRevision !== ''
    && current.sourceRevision !== link.sourceRevision
  ) {
    return 'COORDINATES_CHANGED';
  }
  return 'CURRENT';
};

/**
 * Classify a workspace catalog edit against the linked generation: a
 * version change is CATALOG_CHANGED; definition/alias edits with the
 * version untouched are FEATURE_METADATA_CHANGED (they alter feature
 * matching without bumping the revision). Identical content → null.
 * Pure: the caller decides whether/how to stamp.
 */
export const classifyCatalogChange = (
  prev: FeatureCodeCatalog,
  next: FeatureCodeCatalog,
): 'CATALOG_CHANGED' | 'FEATURE_METADATA_CHANGED' | null => {
  if (prev === next) return null;
  if (prev.version !== next.version) return 'CATALOG_CHANGED';
  if (JSON.stringify(prev.definitions) !== JSON.stringify(next.definitions)) return 'FEATURE_METADATA_CHANGED';
  if (JSON.stringify(prev.aliases) !== JSON.stringify(next.aliases)) return 'FEATURE_METADATA_CHANGED';
  return null;
};

/**
 * Stamp catalog-driven staleness onto a linked project without touching
 * entities (no regeneration). Only stamps over CURRENT/COORDINATES_CHANGED:
 * higher-precedence states (MANUAL_CONFLICT and above) are preserved, so a
 * catalog edit never clears a conflict or missing-source flag. Identity-
 * preserving when there is no link or nothing changes.
 */
export const stampCatalogStaleStatus = (
  project: CadProject,
  status: 'CATALOG_CHANGED' | 'FEATURE_METADATA_CHANGED',
): CadProject => {
  const link = project.metadata.fieldToFinishLink;
  if (!link || (link.status !== 'CURRENT' && link.status !== 'COORDINATES_CHANGED')) return project;
  return stampFieldToFinishLink(project, { status });
};

/** Convenience: read the stamped link and classify against a snapshot. */
export const getFieldToFinishSyncStatus = (
  project: CadProject,
  current: FieldToFinishSyncSnapshot = {},
): FieldToFinishSyncStatus =>
  computeSyncStatus(project.metadata.fieldToFinishLink, current);

export interface StationEntityIndexEntry {
  pointEntityId?: string;
  labelEntityId?: string;
  lineworkEntityIds: string[];
}
export type StationEntityIndex = Record<string, StationEntityIndexEntry>;

/**
 * Station -> generated-entity index for later auto-sync work. Reads the
 * existing provenance conventions only: `pt:<station>` points,
 * `label:<station>` labels (+ anchorEntityId back-refs), `f2f-lw-*`
 * linework via metadata sourcePointIds. Non-F2F entities are ignored.
 */
export const buildStationEntityIndex = (project: CadProject): StationEntityIndex => {
  const index: StationEntityIndex = {};
  const entryOf = (station: string): StationEntityIndexEntry =>
    (index[station] ??= { lineworkEntityIds: [] });
  for (const entity of project.entities) {
    if (!isGenerated(entity)) continue;
    if (entity.type === 'survey-point') {
      entryOf(entity.stationId).pointEntityId = entity.id;
      continue;
    }
    if (entity.type === 'text') {
      const station = stationOfLabel(entity.id, entity.anchorEntityId);
      if (station) {
        const entry = entryOf(station);
        if (entry.labelEntityId === undefined) entry.labelEntityId = entity.id;
      }
      continue;
    }
    if (entity.type === 'line' || entity.type === 'polyline') {
      for (const station of sourcePointsOf(entity)) entryOf(station).lineworkEntityIds.push(entity.id);
    }
  }
  for (const entry of Object.values(index)) entry.lineworkEntityIds.sort();
  return index;
};

export interface LinkOfPayloadSource {
  /** Which source produced this generation: adjustment-backed generations stamp 'adjustment' so rerun auto-sync applies; coordinate imports keep the default. */
  sourceKind?: FieldToFinishSourceKind;
  /** Fingerprints for the composite sourceRevision; when absent the prior link revision is preserved. */
  inputFingerprint?: string;
  settingsFingerprint?: string;
}

/**
 * Derive the F2F source link stamped on every F2F_GENERATE apply.
 * Reads the payload's GENERATED provenance stamps (run id, catalog
 * id/version, source record ids) so the link survives both the direct
 * builder and the undoable command path. `sourceRecordIds` come from
 * authoritative source point records (survey-point entities) only —
 * generated derivatives such as auto labels (`<record>:label`) are
 * excluded, so a raw source-record snapshot compares CURRENT instead of
 * spuriously reading FEATURE_METADATA_CHANGED. The fingerprint composite
 * is preserved from the prior link when the caller has no fingerprint
 * context (explicit links via buildFieldToFinishLink carry the real
 * revision). Empty payloads (no F2F entities) return undefined so the
 * existing link is left untouched.
 */
export const linkOfPayload = (
  payload: FieldToFinishCadPayload,
  priorSourceRevision?: string,
): FieldToFinishLink | undefined => {
  const generated = payload.upsertEntities.filter((entity) => isGenerated(entity) !== undefined);
  if (generated.length === 0) return undefined;
  const provenances = generated
    .map((entity) => isGenerated(entity))
    .filter((provenance): provenance is FieldToFinishProvenance => provenance !== undefined);
  const first = provenances[0] as FieldToFinishProvenance;
  const stationIds = [...new Set(
    provenances.map((provenance) => provenance.sourceStationId).filter((id): id is string => !!id),
  )];
  // Authoritative source point records only: labels stamp `<record>:label`
  // derivatives and linework carries no record id at all.
  const sourceRecordIds = [...new Set(
    generated
      .filter((entity) => entity.type === 'survey-point')
      .map((entity) => isGenerated(entity)?.sourceRecordId)
      .filter((id): id is string => !!id),
  )];
  const source = payload.source ?? {};
  const hasFingerprints = source.inputFingerprint !== undefined || source.settingsFingerprint !== undefined;
  return buildFieldToFinishLink({
    generationRunId: first.generationRunId ?? 'unknown',
    catalogId: first.catalogId ?? 'unknown',
    catalogRevision: first.catalogVersion ?? '',
    ...(source.sourceKind !== undefined ? { sourceKind: source.sourceKind } : {}),
    sourceRecordIds,
    stationIds,
    generatedEntityIds: payload.upsertEntities.map((entity) => entity.id),
    generatedLabelIds: payload.upsertEntities
      .filter((entity) => entity.type === 'text')
      .map((entity) => entity.id),
    ...(hasFingerprints
      ? {
        sourceRevision: buildSourceRevision({
          inputFingerprint: source.inputFingerprint,
          settingsFingerprint: source.settingsFingerprint,
        }),
      }
      : priorSourceRevision !== undefined
        ? { sourceRevision: priorSourceRevision }
        : {}),
  });
};

const stationOfLabel = (id: string, anchor: string | undefined): string | undefined => {
  if (id.startsWith('label:')) return id.slice('label:'.length);
  if (anchor?.startsWith('pt:')) return anchor.slice('pt:'.length);
  return undefined;
};

/**
 * Pure link stamp: records a new sync status and/or source revision on the
 * stamped link without touching entities. Returns the input project when
 * there is no link or nothing changes (identity preserved for no-ops).
 */
export const stampFieldToFinishLink = (
  project: CadProject,
  patch: { status?: FieldToFinishSyncStatus; sourceRevision?: string },
): CadProject => {
  const link = project.metadata.fieldToFinishLink;
  if (!link) return project;
  if (patch.status !== undefined && patch.status === link.status
    && (patch.sourceRevision === undefined || patch.sourceRevision === link.sourceRevision)) {
    return project;
  }
  return {
    ...project,
    metadata: {
      ...project.metadata,
      fieldToFinishLink: {
        ...cloneFieldToFinishLink(link),
        ...(patch.status !== undefined ? { status: patch.status } : {}),
        ...(patch.sourceRevision !== undefined ? { sourceRevision: patch.sourceRevision } : {}),
      },
    },
  };
};

const sourcePointsOf = (entity: CadEntity): string[] => {
  const metadata = (entity.metadata ?? {}) as Record<string, unknown>;
  const ids = metadata['sourcePointIds'];
  if (Array.isArray(ids)) return ids.filter((id): id is string => typeof id === 'string');
  if (entity.type === 'line') return [entity.fromStationId, entity.toStationId];
  if (entity.type === 'polyline') return [...entity.vertexLabels];
  return [];
};
