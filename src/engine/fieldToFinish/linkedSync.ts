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
  sourceRecordIds: [...init.sourceRecordIds].sort(),
  stationIds: [...init.stationIds].sort(),
  generatedEntityIds: [...init.generatedEntityIds].sort(),
  generatedLabelIds: [...init.generatedLabelIds].sort(),
  syncPolicy: 'manual',
  status: 'CURRENT',
});

export interface FieldToFinishSyncSnapshot {
  sourceRevision?: string;
  catalogRevision?: string;
  stationIds?: readonly string[];
  sourceRecordIds?: readonly string[];
  manualConflict?: boolean;
  sourceExists?: boolean;
}

const sameSet = (a: readonly string[], b: readonly string[]): boolean =>
  a.length === b.length && new Set([...a, ...b]).size === a.length;

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

/**
 * Derive the F2F source link stamped on every F2F_GENERATE apply.
 * Reads the payload's GENERATED provenance stamps (run id, catalog
 * id/version, source record ids) so the link survives both the direct
 * builder and the undoable command path. The fingerprint composite is
 * preserved from the prior link when the caller has no fingerprint
 * context (explicit links via buildFieldToFinishLink carry the real
 * revision). Empty payloads (no F2F entities) return undefined so the
 * existing link is left untouched.
 */
export const linkOfPayload = (
  payload: FieldToFinishCadPayload,
  priorSourceRevision?: string,
): FieldToFinishLink | undefined => {
  const provenances = payload.upsertEntities
    .map((entity) => isGenerated(entity))
    .filter((provenance): provenance is FieldToFinishProvenance => provenance !== undefined);
  if (provenances.length === 0) return undefined;
  const first = provenances[0] as FieldToFinishProvenance;
  const stationIds = [...new Set(
    provenances.map((provenance) => provenance.sourceStationId).filter((id): id is string => !!id),
  )];
  const sourceRecordIds = [...new Set(
    provenances.map((provenance) => provenance.sourceRecordId).filter((id): id is string => !!id),
  )];
  return buildFieldToFinishLink({
    generationRunId: first.generationRunId ?? 'unknown',
    catalogId: first.catalogId ?? 'unknown',
    catalogRevision: first.catalogVersion ?? '',
    sourceRecordIds,
    stationIds,
    generatedEntityIds: payload.upsertEntities.map((entity) => entity.id),
    generatedLabelIds: payload.upsertEntities
      .filter((entity) => entity.type === 'text')
      .map((entity) => entity.id),
    ...(priorSourceRevision !== undefined ? { sourceRevision: priorSourceRevision } : {}),
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
