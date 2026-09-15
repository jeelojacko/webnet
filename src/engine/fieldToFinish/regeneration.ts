/**
 * Phase 13D — field-to-finish explicit regeneration.
 *
 * REGENERATE is always explicit and previewed: added/updated/removed,
 * codes-changed, linework-changed, unmapped, and manual-conflicts.
 * Source identity is stable (import key + station id + record identity —
 * never array index). Manual work is never auto-deleted: GENERATED entities
 * vanish only on confirmed regen (and are reported); MANUAL_OVERRIDE and
 * DETACHED entities are preserved. An explicit coordinate-update helper
 * exists for adjustment reruns (currently not auto-wired — treat rerun
 * propagation as manual until wired); it touches F2F geometry only —
 * adjustment inputs are only read, never altered.
 */
import { runCadCommand, type CadHistoryState } from '../cad/cadUndoRedo';
import { formatDraftCoordinate } from '../cad/cadLabelEngine';
import { replaceCadProjectEntities } from '../cad/cadProjectState';
import type { CadCommand } from '../cad/cadTransactions.types';
import type { AdjustmentResult } from '../../types';
import type { CadEntity, CadProject, CadSurveyPointEntity, CadTextEntity } from '../cad/cadTypes';
import type { ImportedControlStationRecord } from '../importers';
import {
  buildSourceRevision,
  buildStationEntityIndex,
  stampFieldToFinishLink,
  type FieldToFinishSyncStatus,
} from './linkedSync';
import {
  applyFieldToFinishPayload,
  buildFieldToFinishPayload,
  getFieldToFinishState,
  isFieldToFinishEntity,
  isSameFieldToFinishLinework,
  type FieldToFinishCadArgs,
  type FieldToFinishCadPayload,
  type FieldToFinishCadPoint,
  type FieldToFinishProvenance,
  type FieldToFinishWarning,
} from './cadGeneration';

export interface FieldToFinishSourceKey {
  importKey: string;
  stationId: string;
  recordId: string;
}

export const fieldToFinishSourceKey = (key: FieldToFinishSourceKey): string =>
  `${key.importKey}|${key.stationId}|${key.recordId}`;

export const sourceKeyOfPoint = (point: FieldToFinishCadPoint, importKey: string): string =>
  fieldToFinishSourceKey({
    importKey,
    stationId: point.stationId,
    recordId: point.sourceRecordId ?? (point.sourceLine !== undefined ? String(point.sourceLine) : point.stationId),
  });

const keyOfProvenance = (provenance: FieldToFinishProvenance, fallbackImportKey: string): string | undefined => {
  if (!provenance.sourceStationId) return undefined;
  return fieldToFinishSourceKey({
    importKey: provenance.sourceImportId ?? fallbackImportKey,
    stationId: provenance.sourceStationId,
    recordId: provenance.sourceRecordId ?? provenance.sourceStationId,
  });
};

export interface FieldToFinishRegenPreview {
  added: string[];
  updated: string[];
  removed: string[];
  codesChanged: string[];
  lineworkChanged: string[];
  unmapped: string[];
  manualConflicts: string[];
  warnings: FieldToFinishWarning[];
}

export interface FieldToFinishRegenResult extends FieldToFinishRegenPreview {
  project: CadProject;
  removedEntityIds: string[];
}

/** One undoable transaction wrapping a built F2F payload. */
export const runFieldToFinishCommand = (
  state: CadHistoryState,
  payload: FieldToFinishCadPayload,
): CadHistoryState => {
  const command: CadCommand = { key: 'F2F_GENERATE', payload };
  return runCadCommand(state, command);
};

const generatedPointsOf = (project: CadProject): CadSurveyPointEntity[] =>
  project.entities.filter((entity): entity is CadSurveyPointEntity => entity.type === 'survey-point' && isFieldToFinishEntity(entity));

/**
 * Explicit REGENERATE preview. Compares current GENERATED content against a
 * fresh build without mutating anything.
 */
export const previewFieldToFinishRegen = (
  project: CadProject,
  args: FieldToFinishCadArgs,
  importKey: string,
): FieldToFinishRegenPreview => {
  const built = buildFieldToFinishPayload(project, args);
  const nextByStation = new Map(args.points.map((point) => [point.stationId, point]));
  const nextKeys = new Set(args.points.map((point) => sourceKeyOfPoint(point, importKey)));
  const currentByKey = new Map<string, CadEntity>();
  for (const entity of project.entities) {
    if (!isFieldToFinishEntity(entity)) continue;
    const provenance = (entity.metadata as Record<string, unknown>)?.['provenance'] as FieldToFinishProvenance;
    const key = keyOfProvenance(provenance, importKey);
    if (key) currentByKey.set(key, entity);
  }
  const preview: FieldToFinishRegenPreview = {
    added: [], updated: [], removed: [], codesChanged: [], lineworkChanged: [], unmapped: [], manualConflicts: [], warnings: built.warnings,
  };
  for (const point of args.points) {
    const key = sourceKeyOfPoint(point, importKey);
    const current = currentByKey.get(key);
    if (!current) {
      preview.added.push(point.stationId);
      continue;
    }
    if (getFieldToFinishState(current) !== 'GENERATED') {
      preview.manualConflicts.push(point.stationId);
      continue;
    }
    if (current.type === 'survey-point') {
      const moved = Math.abs(current.x - point.x) > 1e-9 || Math.abs(current.y - point.y) > 1e-9;
      const currentCodes = JSON.stringify((current.metadata as Record<string, unknown>)?.['featureCodes'] ?? []);
      const nextCodes = JSON.stringify([...new Set(point.codes.map((c) => c.code.trim().toUpperCase()))].sort());
      if (moved) preview.updated.push(point.stationId);
      if (currentCodes !== nextCodes) preview.codesChanged.push(point.stationId);
      if (nextByStation.get(point.stationId)?.description !== current.description) {
        if (!preview.updated.includes(point.stationId)) preview.updated.push(point.stationId);
      }
    }
  }
  for (const [key, entity] of currentByKey) {
    if (!nextKeys.has(key) && entity.type === 'survey-point') {
      const state = getFieldToFinishState(entity);
      if (state === 'GENERATED') preview.removed.push((entity as CadSurveyPointEntity).stationId);
      else preview.manualConflicts.push((entity as CadSurveyPointEntity).stationId);
    }
  }
  // Linework: per-chain diff (code+instance+sourceOrder identity). The
  // valid set is every linework entity in the fresh payload — including
  // unchanged chains re-upserted in place — so only chains whose source
  // coding actually vanished read as removed. Same-id geometry changes
  // compare equal only when content matches (runId stamp ignored).
  const currentLinework = new Map(
    project.entities
      .filter((entity) => (entity.type === 'line' || entity.type === 'polyline') && isFieldToFinishEntity(entity))
      .map((entity) => [entity.id, entity] as const),
  );
  const nextLinework = new Map(
    built.payload.upsertEntities
      .filter((entity) => entity.type === 'line' || entity.type === 'polyline')
      .map((entity) => [entity.id, entity] as const),
  );
  for (const [id, next] of nextLinework) {
    const current = currentLinework.get(id);
    if (!current || !isSameFieldToFinishLinework(current, next)) preview.lineworkChanged.push(id);
  }
  for (const id of currentLinework.keys()) {
    if (!nextLinework.has(id) && !preview.lineworkChanged.includes(id)) preview.lineworkChanged.push(id);
  }
  preview.unmapped.push(...built.stats.unmapped > 0
    ? args.points.filter((p) => p.codes.length === 0).map((p) => p.stationId)
    : []);
  for (const list of [preview.added, preview.updated, preview.removed, preview.codesChanged, preview.lineworkChanged, preview.unmapped, preview.manualConflicts]) {
    list.sort();
  }
  return preview;
};

/**
 * Apply a confirmed regen. Generated entities whose source vanished are
 * removed ONLY when confirmed=true (and reported); manual entities
 * (MANUAL_OVERRIDE/DETACHED, or non-F2F) are never auto-deleted.
 */
export const applyFieldToFinishRegen = (
  project: CadProject,
  args: FieldToFinishCadArgs,
  importKey: string,
  options: { confirmed: boolean },
): FieldToFinishRegenResult => {
  const preview = previewFieldToFinishRegen(project, args, importKey);
  const built = buildFieldToFinishPayload(project, args);
  const nextKeys = new Set(args.points.map((point) => sourceKeyOfPoint(point, importKey)));
  const validLineworkIds = new Set(
    built.payload.upsertEntities
      .filter((entity) => entity.type === 'line' || entity.type === 'polyline')
      .map((entity) => entity.id),
  );
  const removeEntityIds: string[] = [];
  if (options.confirmed) {
    for (const entity of project.entities) {
      if (!isFieldToFinishEntity(entity)) continue;
      if (getFieldToFinishState(entity) !== 'GENERATED') continue;
      const provenance = (entity.metadata as Record<string, unknown>)?.['provenance'] as FieldToFinishProvenance | undefined;
      if (entity.type === 'survey-point') {
        const key = provenance ? keyOfProvenance(provenance, importKey) : undefined;
        if (key && !nextKeys.has(key)) removeEntityIds.push(entity.id);
        continue;
      }
      if (entity.type === 'line' || entity.type === 'polyline' || entity.type === 'text') {
        // Generated linework/labels are rebuilt deterministically: drop
        // stale ones so regen converges (only GENERATED state reaches here).
        const anchorGone = entity.type === 'text' && entity.anchorEntityId
          ? removeEntityIds.includes(entity.anchorEntityId) || preview.removed.some((station) => entity.anchorEntityId === `pt:${station}`)
          : false;
        const staleLinework = (entity.type === 'line' || entity.type === 'polyline')
          && !validLineworkIds.has(entity.id);
        if (anchorGone || staleLinework) removeEntityIds.push(entity.id);
      }
    }
  }
  removeEntityIds.sort();
  const withPayload: CadProject = applyFieldToFinishPayload(
    project,
    { ...built.payload, removeEntityIds },
  );
  return { ...preview, project: withPayload, removedEntityIds: removeEntityIds };
};


/** Mark a generated entity as a manual override (preserved by regen). */
export const markFieldToFinishManualOverride = (project: CadProject, entityId: string): CadProject =>
  replaceCadProjectEntities(
    project,
    project.entities.map((entity) => {
      if (entity.id !== entityId || !isFieldToFinishEntity(entity)) return entity;
      const metadata = { ...entity.metadata } as Record<string, unknown>;
      metadata['provenance'] = { ...(metadata['provenance'] as object), state: 'MANUAL_OVERRIDE' };
      return { ...entity, metadata };
    }),
  );

/** Detach a generated entity from its source (kept, never regen-touched). */
export const detachFieldToFinishEntity = (project: CadProject, entityId: string): CadProject =>
  replaceCadProjectEntities(
    project,
    project.entities.map((entity) => {
      if (entity.id !== entityId || !isFieldToFinishEntity(entity)) return entity;
      const metadata = { ...entity.metadata } as Record<string, unknown>;
      metadata['provenance'] = { ...(metadata['provenance'] as object), state: 'DETACHED' };
      return { ...entity, metadata };
    }),
  );

export interface FieldToFinishCoordinate {
  x: number;
  y: number;
  z?: number;
}

/**
 * Adjustment-rerun coordinate update: moves GENERATED F2F points (and their
 * generated linework vertices + anchored labels) to new coordinates.
 * MANUAL_OVERRIDE/DETACHED points are skipped + reported (never overwritten).
 * GENERATED labels translate by the station delta so dragged/deconflicted
 * offsets survive; only the derived `EL <n>` token refreshes when height
 * changes. Non-F2F entities (parcels, tables, plan text, sheets) are never
 * touched — they are not F2F-generated. Read-only w.r.t. adjustment inputs.
 */
export const updateFieldToFinishCoordinates = (
  project: CadProject,
  coordinates: ReadonlyMap<string, FieldToFinishCoordinate>,
): { project: CadProject; updated: string[]; skippedManual: string[]; manualConflicts: string[] } => {
  const updated: string[] = [];
  const skippedManual: string[] = [];
  const manualConflicts: string[] = [];
  const prior = new Map<string, FieldToFinishCoordinate>();
  for (const entity of project.entities) {
    if (entity.type === 'survey-point' && isFieldToFinishEntity(entity) && coordinates.has(entity.stationId)) {
      prior.set(entity.stationId, { x: entity.x, y: entity.y, ...(entity.z !== undefined ? { z: entity.z } : {}) });
    }
  }
  const next = project.entities.map((entity) => {
    if (entity.type === 'survey-point' && isFieldToFinishEntity(entity)) {
      const coords = coordinates.get(entity.stationId);
      if (!coords) return entity;
      if (getFieldToFinishState(entity) !== 'GENERATED') {
        skippedManual.push(entity.stationId);
        return entity;
      }
      if (coords.x === entity.x && coords.y === entity.y && (coords.z ?? entity.z) === entity.z) return entity;
      updated.push(entity.stationId);
      return { ...entity, x: coords.x, y: coords.y, z: coords.z ?? entity.z };
    }
    return entity;
  });
  const moved = new Map(updated.map((stationId) => [stationId, coordinates.get(stationId) as FieldToFinishCoordinate]));
  const synced = next.map((entity) => {
    if ((entity.type === 'line' || entity.type === 'polyline') && isFieldToFinishEntity(entity)) {
      if (getFieldToFinishState(entity) !== 'GENERATED') {
        if (stationsOfLinework(entity).some((station) => moved.has(station))) manualConflicts.push(entity.id);
        return entity;
      }
      if (entity.type === 'line') {
        const from = moved.get(entity.fromStationId);
        const to = moved.get(entity.toStationId);
        if (!from && !to) return entity;
        return {
          ...entity,
          fromX: from?.x ?? entity.fromX,
          fromY: from?.y ?? entity.fromY,
          toX: to?.x ?? entity.toX,
          toY: to?.y ?? entity.toY,
        };
      }
      let changed = false;
      const vertices = entity.vertices.map((vertex, index) => {
        const coords = moved.get(entity.vertexLabels[index] ?? '');
        if (!coords) return vertex;
        changed = true;
        return { x: coords.x, y: coords.y };
      });
      return changed ? { ...entity, vertices } : entity;
    }
    if (entity.type === 'text' && isFieldToFinishEntity(entity)) {
      const station = stationOfAnchoredLabel(entity);
      const coords = station ? moved.get(station) : undefined;
      if (!coords || !station) return entity;
      if (getFieldToFinishState(entity) !== 'GENERATED') {
        manualConflicts.push(entity.id);
        return entity;
      }
      // Translate by the station delta: dragged labels, deconfliction
      // stacking, and sheet placement offsets survive; numeric text updates.
      const before = prior.get(station) ?? { x: entity.x, y: entity.y };
      const text = refreshElevationToken(entity.text, before.z, coords.z);
      return { ...entity, x: entity.x + (coords.x - before.x), y: entity.y + (coords.y - before.y), text };
    }
    return entity;
  });
  updated.sort();
  skippedManual.sort();
  manualConflicts.sort();
  return { project: replaceCadProjectEntities(project, synced), updated, skippedManual, manualConflicts };
};

/** Stations referenced by F2F linework (provenance first, endpoint fallback). */
const stationsOfLinework = (entity: CadEntity): string[] => {
  const metadata = (entity.metadata ?? {}) as Record<string, unknown>;
  const ids = metadata['sourcePointIds'];
  if (Array.isArray(ids)) return ids.filter((id): id is string => typeof id === 'string');
  if (entity.type === 'line') return [entity.fromStationId, entity.toStationId];
  if (entity.type === 'polyline') return [...entity.vertexLabels];
  return [];
};

const stationOfAnchoredLabel = (entity: CadTextEntity): string | undefined => {
  if (entity.anchorEntityId?.startsWith('pt:')) return entity.anchorEntityId.slice('pt:'.length);
  if (entity.id.startsWith('label:')) return entity.id.slice('label:'.length);
  return undefined;
};

/** Refresh only the derived `EL <n>` token; every other token (notes, codes) is kept byte-identical. */
const refreshElevationToken = (text: string, beforeZ: number | undefined, afterZ: number | undefined): string => {
  if (afterZ === undefined || !Number.isFinite(afterZ) || afterZ === beforeZ) return text;
  if (!/EL\s+-?\d/.test(text)) return text;
  return text.replace(/EL\s+-?\d+(?:\.\d+)?/, `EL ${formatDraftCoordinate(afterZ)}`);
};

export interface AdjustmentRerunSyncInput {
  /** Null or success:false = failed run: zero F2F mutation. */
  result: AdjustmentResult | null;
  inputFingerprint?: string;
  settingsFingerprint?: string;
  /** Current catalog version; mismatch vs link stamps CATALOG_CHANGED. */
  catalogRevision?: string;
  /** Current feature source-record ids; mismatch stamps FEATURE_METADATA_CHANGED. */
  sourceRecordIds?: readonly string[];
}

export interface AdjustmentRerunSyncOutcome {
  project: CadProject;
  status: FieldToFinishSyncStatus;
  /** True only when generated entities moved (link stamps alone set false). */
  changed: boolean;
  updated: string[];
  skippedManual: string[];
  /** Non-GENERATED derivations referencing moved stations (preserved, stale). */
  manualConflicts: string[];
  /** Linked stations with no authoritative coordinates. */
  missingStations: string[];
  /** Dependent entity ids for updated/skipped/missing stations (via station index). */
  affectedEntityIds: string[];
}

const emptySyncOutcome = (project: CadProject, status: FieldToFinishSyncStatus): AdjustmentRerunSyncOutcome => ({
  project,
  status,
  changed: false,
  updated: [],
  skippedManual: [],
  manualConflicts: [],
  missingStations: [],
  affectedEntityIds: [],
});

/**
 * Linked F2F adjustment-rerun sync (Bucket A2). Pure: reads the authoritative
 * result (stations win, sideshots fill gaps via resolveFieldToFinishCoordinates),
 * never alters adjustment inputs.
 *
 * - No link → UNLINKED, identical project. Failed run → identical project.
 * - Missing linked station → MISSING_SOURCE + affected entities surfaced;
 *   never binds a similarly-named station (exact id match only).
 * - Added station / catalog / feature-metadata drift → stale stamp, no
 *   auto-regen (caller previews via previewFieldToFinishRegen).
 * - Coordinate-only deltas → GENERATED dependents move in place (stable ids,
 *   order, provenance); MANUAL_OVERRIDE blocks + flags MANUAL_CONFLICT;
 *   DETACHED stays silent; bit-identical reruns return entity-identical docs.
 * - Scope is exactly what F2F generates (points, line/polyline, anchored
 *   labels). Parcels, tables, plan text, layers/styles, codes, and sheets are
 *   never touched; geometry-dependent plan content refreshes via explicit regen.
 *
 * Undo/redo: the returned project is one coherent authoritative update — the
 * subscriber commits it as a SINGLE CAD history entry, so one undo restores
 * pre-rerun geometry + link stamp atomically. Run history is append-only:
 * CAD undo never alters recorded results, and re-running the adjustment
 * re-derives the same sync.
 */
export const applyAdjustmentRerunToLinkedF2f = (
  project: CadProject,
  input: AdjustmentRerunSyncInput,
): AdjustmentRerunSyncOutcome => {
  const link = project.metadata.fieldToFinishLink;
  if (!link) return emptySyncOutcome(project, 'UNLINKED');
  const result = input.result;
  if (!result || !result.success) return emptySyncOutcome(project, link.status);
  const authoritative = authoritativeCoordinatesOf(result);
  const revision = input.inputFingerprint !== undefined || input.settingsFingerprint !== undefined
    ? buildSourceRevision({ inputFingerprint: input.inputFingerprint, settingsFingerprint: input.settingsFingerprint })
    : undefined;
  const index = buildStationEntityIndex(project);
  const affectedOf = (stations: readonly string[]): string[] => {
    const ids = new Set<string>();
    for (const station of stations) {
      const entry = index[station];
      if (!entry) continue;
      if (entry.pointEntityId) ids.add(entry.pointEntityId);
      if (entry.labelEntityId) ids.add(entry.labelEntityId);
      for (const id of entry.lineworkEntityIds) ids.add(id);
    }
    return [...ids].sort();
  };
  const missingStations = link.stationIds.filter((id) => !authoritative.has(id)).sort();
  if (missingStations.length > 0) {
    return {
      ...emptySyncOutcome(
        stampFieldToFinishLink(project, { status: 'MISSING_SOURCE' }),
        'MISSING_SOURCE',
      ),
      missingStations,
      affectedEntityIds: affectedOf(missingStations),
    };
  }
  if (input.catalogRevision !== undefined && input.catalogRevision !== link.catalogRevision) {
    return emptySyncOutcome(stampFieldToFinishLink(project, { status: 'CATALOG_CHANGED' }), 'CATALOG_CHANGED');
  }
  // Set lookup: the includes() scan here used to make topology detection
  // O(stations^2).
  const linkedStations = new Set(link.stationIds);
  if (Object.keys(result.stations).some((id) => !linkedStations.has(id))) {
    return emptySyncOutcome(
      stampFieldToFinishLink(project, { status: 'SOURCE_TOPOLOGY_CHANGED' }),
      'SOURCE_TOPOLOGY_CHANGED',
    );
  }
  if (input.sourceRecordIds !== undefined && !sameIdSet(input.sourceRecordIds, link.sourceRecordIds)) {
    return emptySyncOutcome(
      stampFieldToFinishLink(project, { status: 'FEATURE_METADATA_CHANGED' }),
      'FEATURE_METADATA_CHANGED',
    );
  }
  // Station -> point lookup built once: the per-station find() here used to
  // make delta detection O(stations x entities). First-match wins, as before.
  const pointByStation = new Map<string, CadSurveyPointEntity>();
  for (const entity of project.entities) {
    if (entity.type === 'survey-point' && !pointByStation.has(entity.stationId)) {
      pointByStation.set(entity.stationId, entity);
    }
  }
  const deltas = new Map<string, FieldToFinishCoordinate>();
  for (const stationId of link.stationIds) {
    const coords = authoritative.get(stationId);
    if (!coords) continue;
    const point = pointByStation.get(stationId);
    if (!point) continue;
    if (coords.x !== point.x || coords.y !== point.y || (coords.z ?? point.z) !== point.z) {
      deltas.set(stationId, coords);
    }
  }
  if (deltas.size === 0) {
    // Bit-identical rerun: entities untouched (same values, same order, same
    // provenance); only the run revision advances on the stamped link.
    const stamped = revision !== undefined && link.status === 'CURRENT'
      ? stampFieldToFinishLink(project, { status: 'CURRENT', sourceRevision: revision })
      : revision !== undefined
        ? stampFieldToFinishLink(project, { sourceRevision: revision })
        : project;
    return emptySyncOutcome(stamped, stamped.metadata.fieldToFinishLink?.status ?? 'CURRENT');
  }
  const applied = updateFieldToFinishCoordinates(project, deltas);
  const conflictStations = applied.skippedManual.filter((stationId) => {
    const point = applied.project.entities.find(
      (entity): entity is CadSurveyPointEntity => entity.type === 'survey-point' && entity.stationId === stationId,
    );
    return point !== undefined && getFieldToFinishState(point) === 'MANUAL_OVERRIDE';
  });
  const status: FieldToFinishSyncStatus =
    conflictStations.length > 0 || applied.manualConflicts.length > 0 ? 'MANUAL_CONFLICT' : 'CURRENT';
  const stamped = stampFieldToFinishLink(applied.project, {
    status,
    ...(revision !== undefined ? { sourceRevision: revision } : {}),
  });
  return {
    project: stamped,
    status,
    changed: applied.updated.length > 0,
    updated: applied.updated,
    skippedManual: applied.skippedManual,
    manualConflicts: applied.manualConflicts,
    missingStations: [],
    affectedEntityIds: affectedOf([...applied.updated, ...applied.skippedManual]),
  };
};

const sameIdSet = (a: readonly string[], b: readonly string[]): boolean =>
  a.length === b.length && new Set([...a, ...b]).size === a.length;

/** Authoritative coordinates: adjusted stations win, sideshots fill gaps. */
const authoritativeCoordinatesOf = (result: AdjustmentResult): Map<string, FieldToFinishCoordinate> => {
  const sources = new Map<string, FieldToFinishCoordinateSources>();
  for (const [id, station] of Object.entries(result.stations)) {
    sources.set(id, { adjusted: { x: station.x, y: station.y, z: station.h } });
  }
  for (const sideshot of result.sideshots ?? []) {
    if (!sideshot || !Number.isFinite(sideshot.easting) || !Number.isFinite(sideshot.northing)) continue;
    const prior = sources.get(sideshot.to);
    if (prior?.adjusted) continue;
    sources.set(sideshot.to, {
      ...prior,
      sideshot: {
        x: sideshot.easting as number,
        y: sideshot.northing as number,
        ...(sideshot.height !== undefined ? { z: sideshot.height } : {}),
      },
    });
  }
  const coords = new Map<string, FieldToFinishCoordinate>();
  for (const [id, source] of sources) {
    const resolved = resolveFieldToFinishCoordinates(source);
    if (resolved) coords.set(id, resolved.coords);
  }
  return coords;
};

export type FieldToFinishCoordinateOrigin = 'adjusted' | 'sideshot' | 'coordinate-only';

export interface FieldToFinishCoordinateSources {
  adjusted?: FieldToFinishCoordinate;
  sideshot?: FieldToFinishCoordinate;
  coordinateOnly?: FieldToFinishCoordinate;
}

/**
 * Sideshot + coordinate-only + adjusted-point resolution. Adjusted coords
 * win when present; inputs are read, never altered.
 */
export const resolveFieldToFinishCoordinates = (
  sources: FieldToFinishCoordinateSources,
): { coords: FieldToFinishCoordinate; origin: FieldToFinishCoordinateOrigin } | undefined => {
  if (sources.adjusted) return { coords: { ...sources.adjusted }, origin: 'adjusted' };
  if (sources.sideshot) return { coords: { ...sources.sideshot }, origin: 'sideshot' };
  if (sources.coordinateOnly) return { coords: { ...sources.coordinateOnly }, origin: 'coordinate-only' };
  return undefined;
};

/** Coordinate-only path: control-station records -> CAD points (meters in). */
export const controlStationsToFieldToFinishPoints = (
  records: readonly ImportedControlStationRecord[],
  importKey: string,
): FieldToFinishCadPoint[] =>
  records.map((record, index) => ({
    stationId: record.stationId,
    x: record.eastM ?? 0,
    y: record.northM ?? 0,
    ...(record.heightM !== undefined ? { z: record.heightM } : {}),
    sourceOrder: record.feature?.sourceOrder ?? record.sourceLine ?? index + 1,
    ...(record.sourceLine !== undefined ? { sourceLine: record.sourceLine } : {}),
    rawCodeText: record.feature?.rawCodeText,
    codes: (record.feature?.codes ?? []).map((code) => ({ code: code.code, rawCode: code.rawCode })),
    description: record.description ?? record.feature?.description,
    sourceImportId: record.importSourceKey ?? importKey,
  }));

/** Adjusted-point path: adjusted stations win; falls back per station. */
export const adjustedStationsToFieldToFinishPoints = (
  base: FieldToFinishCadPoint[],
  adjusted: ReadonlyMap<string, FieldToFinishCoordinate>,
): FieldToFinishCadPoint[] =>
  base.map((point) => {
    const coords = adjusted.get(point.stationId);
    if (!coords) return point;
    return { ...point, x: coords.x, y: coords.y, z: coords.z ?? point.z };
  });

export const generatedPointCount = (project: CadProject): number =>
  generatedPointsOf(project).length;
