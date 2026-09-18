/**
 * Phase 13E — linked field-to-finish adjustment-rerun sync (Bucket A2).
 *
 * Pure coordinate propagation from an authoritative adjustment result into
 * the linked CAD drawing. Reads adjustment inputs only, never alters them.
 * Structural drift (topology, catalog, feature metadata, manual conflict,
 * missing source) stamps the link and requires explicit regen preview —
 * zero silent regeneration. Auto-sync applies ONLY to links stamped
 * `sourceKind: 'adjustment'`; coordinate-import links are returned
 * untouched (identical project, no status rewrite).
 */
import { formatDraftCoordinate } from '../cad/cadLabelEngine';
import { stampAdjustmentDependency } from '../cad/cadAdjustmentDependency';
import type { ResultDependencyIdentity } from '../resultIntegrity';
import { cloneCadDrawingDocument } from '../cad/cadDrawingFile';
import { replaceCadProjectEntities } from '../cad/cadProjectState';
import type { AdjustmentResult } from '../../types';
import type { CadDrawingDocument, CadEntity, CadProject, CadSurveyPointEntity, CadTextEntity } from '../cad/cadTypes';
import {
  buildSourceRevision,
  buildStationEntityIndex,
  stampFieldToFinishLink,
  type FieldToFinishSyncStatus,
} from './linkedSync';
import {
  getFieldToFinishState,
  hasLinkedManualOverrides,
  isFieldToFinishEntity,
} from './cadGeneration';

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
  /** Authoritative revision for the link; preferred over the legacy input:settings composite. */
  resultFingerprint?: string;
  /** Current catalog content revision (drawingCatalogRevision); mismatch vs link stamps CATALOG_CHANGED. */
  catalogRevision?: string;
  /** Current feature source-record ids; mismatch stamps FEATURE_METADATA_CHANGED. */
  sourceRecordIds?: readonly string[];
  /**
   * Phase 17E: new result identity for stamping synced F2F entities so
   * they evaluate CURRENT. Fail-closed: absent/null = no stamping (prior
   * behavior preserved byte-for-byte).
   */
  resultDependencyIdentity?: ResultDependencyIdentity | null;
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
 * Phase 17E: after a COMPLETE coordinate sync (link status CURRENT),
 * stamp every synced F2F entity (moved points/labels/linework) with the
 * new result identity so it evaluates CURRENT. Any other status
 * (conflict, drift, missing) stamps nothing — the link already reads
 * non-CURRENT so the core yields STALE/CAD_F2F_SYNC_INCOMPLETE.
 * Fail-closed: null/absent identity returns the identical project.
 */
const stampSyncedF2fEntities = (
  project: CadProject,
  status: FieldToFinishSyncStatus,
  identity: ResultDependencyIdentity | null | undefined,
): CadProject => {
  if (status !== 'CURRENT' || !identity) return project;
  let touched = false;
  const entities = project.entities.map((entity) => {
    if (!isFieldToFinishEntity(entity)) return entity;
    // Phase 17E reviewer hardening: DETACHED entities are user-owned —
    // never stamp them CURRENT (ownerOf reads them as F2F_GENERATED,
    // so a stamp would falsely claim adjustment currency).
    if (getFieldToFinishState(entity) === 'DETACHED') return entity;
    touched = true;
    return stampAdjustmentDependency(entity, identity);
  });
  return touched ? replaceCadProjectEntities(project, entities) : project;
};

/**
 * Linked F2F adjustment-rerun sync (Bucket A2). Pure: reads the authoritative
 * result (stations win, sideshots fill gaps via resolveFieldToFinishCoordinates),
 * never alters adjustment inputs.
 *
 * - No link → UNLINKED, identical project. Failed run → identical project.
 * - Non-adjustment link (sourceKind 'coordinate-import') → identical project
 *   at the current link status: rerun auto-sync never mutates drawings whose
 *   station ids merely coincide with an adjustment result. No silent relinking.
 * - Missing linked station → MISSING_SOURCE + affected entities surfaced;
 *   never binds a similarly-named station (exact id match only).
 * - Added station / catalog / feature-metadata drift → stale stamp, no
 *   auto-regen (caller previews via previewFieldToFinishRegen).
 * - Coordinate-only deltas → GENERATED dependents move in place (stable ids,
 *   order, provenance); MANUAL_OVERRIDE blocks + flags MANUAL_CONFLICT;
 *   DETACHED stays silent; bit-identical reruns return entity-identical docs.
 * - Delta comparison reads linked F2F points only: a same-station non-F2F
 *   point neither suppresses nor triggers generated-point deltas.
 * - Scope is exactly what F2F generates (points, line/polyline, anchored
 *   labels). Parcels, tables, plan text, layers/styles, codes, and sheets are
 *   never touched; geometry-dependent plan content refreshes via explicit regen.
 *
 * The subscriber commits the returned project as one atomic persisted-drawing
 * update (top-level state cannot push CAD history entries — history is
 * workspace-local — so this is NOT a single undoable CAD transaction; the
 * workspace adopts it as the new history baseline, consistent with
 * replaceCadProject). Run history stays append-only: CAD undo never alters
 * recorded results, and re-running the adjustment re-derives the same sync.
 */
export const applyAdjustmentRerunToLinkedF2f = (
  project: CadProject,
  input: AdjustmentRerunSyncInput,
): AdjustmentRerunSyncOutcome => {
  const link = project.metadata.fieldToFinishLink;
  if (!link) return emptySyncOutcome(project, 'UNLINKED');
  const result = input.result;
  if (!result || !result.success) return emptySyncOutcome(project, link.status);
  if (link.sourceKind !== 'adjustment') return emptySyncOutcome(project, link.status);
  const authoritative = authoritativeCoordinatesOf(result);
  const revision = input.resultFingerprint !== undefined
      || input.inputFingerprint !== undefined
      || input.settingsFingerprint !== undefined
    ? buildSourceRevision({
      inputFingerprint: input.inputFingerprint,
      settingsFingerprint: input.settingsFingerprint,
      resultFingerprint: input.resultFingerprint,
    })
    : undefined;
  const provenancePatch = {
    ...(revision !== undefined ? { sourceRevision: revision } : {}),
    ...(input.inputFingerprint !== undefined ? { inputFingerprint: input.inputFingerprint } : {}),
    ...(input.settingsFingerprint !== undefined ? { settingsFingerprint: input.settingsFingerprint } : {}),
    ...(input.resultFingerprint !== undefined ? { resultFingerprint: input.resultFingerprint } : {}),
  };
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
  // Station -> linked-F2F-point lookup built once: the per-station find()
  // here used to make delta detection O(stations x entities). Only
  // field-to-finish points participate — a same-station non-F2F point
  // neither suppresses nor spuriously triggers deltas. First-match wins.
  const pointByStation = new Map<string, CadSurveyPointEntity>();
  for (const entity of project.entities) {
    if (entity.type === 'survey-point' && isFieldToFinishEntity(entity) && !pointByStation.has(entity.stationId)) {
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
    // Manual overrides still surface: a MANUAL_OVERRIDE entity diverges from
    // what F2F would generate even when coordinates match, so the link must
    // not read CURRENT. DETACHED stays silent (never counted).
    // Legacy fail-closed: a legacy link (no stamped resultFingerprint)
    // carries the input:settings composite, which is a different shape from
    // a result fingerprint — a zero coordinate delta against live geometry
    // proves nothing about the solved result, so a rerun that supplies a
    // resultFingerprint stamps COORDINATES_CHANGED instead of silently
    // preserving CURRENT. Higher-precedence existing/manual states
    // (MANUAL_CONFLICT and structural staleness) are preserved.
    const manualConflict = hasLinkedManualOverrides(project.entities, link.stationIds);
    let status: FieldToFinishSyncStatus = manualConflict ? 'MANUAL_CONFLICT' : link.status;
    const legacyResultUpgrade = input.resultFingerprint !== undefined && link.resultFingerprint === undefined;
    if (!manualConflict && legacyResultUpgrade && (status === 'CURRENT' || status === 'COORDINATES_CHANGED')) {
      status = 'COORDINATES_CHANGED';
    }
    const stamped = revision !== undefined || manualConflict
      ? stampFieldToFinishLink(project, { status, ...provenancePatch })
      : project;
    // Phase 17E: bit-identical reruns still stamp synced F2F entities with
    // the new result identity (metadata only, geometry untouched) so they
    // evaluate CURRENT; absent identity leaves entities byte-identical.
    const final = stampSyncedF2fEntities(stamped, status, input.resultDependencyIdentity);
    return emptySyncOutcome(final, final.metadata.fieldToFinishLink?.status ?? 'CURRENT');
  }
  const applied = updateFieldToFinishCoordinates(project, deltas);
  const conflictStations = applied.skippedManual.filter((stationId) => {
    // F2F points only: a same-station non-F2F point must not mask a manual conflict.
    const point = applied.project.entities.find(
      (entity): entity is CadSurveyPointEntity =>
        entity.type === 'survey-point' && isFieldToFinishEntity(entity) && entity.stationId === stationId,
    );
    return point !== undefined && getFieldToFinishState(point) === 'MANUAL_OVERRIDE';
  });
  // Never clear structural staleness the run did not resolve: a link that
  // arrived CATALOG/FEATURE-METADATA/TOPOLOGY-changed stays that way (regen
  // is the only resolution path); only CURRENT/COORDINATES_CHANGED resolve
  // to CURRENT here. MANUAL_CONFLICT outranks everything below MISSING_SOURCE.
  const status: FieldToFinishSyncStatus =
    conflictStations.length > 0 || applied.manualConflicts.length > 0
      ? 'MANUAL_CONFLICT'
      : link.status === 'CURRENT' || link.status === 'COORDINATES_CHANGED'
        ? 'CURRENT'
        : link.status;
  const stamped = stampFieldToFinishLink(applied.project, { status, ...provenancePatch });
  const final = stampSyncedF2fEntities(stamped, status, input.resultDependencyIdentity);
  return {
    project: final,
    status,
    changed: applied.updated.length > 0,
    updated: applied.updated,
    skippedManual: applied.skippedManual,
    manualConflicts: applied.manualConflicts,
    missingStations: [],
    affectedEntityIds: affectedOf([...applied.updated, ...applied.skippedManual]),
  };
};

/** True set equality: duplicate-bearing arrays such as ['x','x'] vs ['x','y'] compare unequal. */
const sameIdSet = (a: readonly string[], b: readonly string[]): boolean => {
  const setA = new Set(a);
  const setB = new Set(b);
  if (setA.size !== setB.size) return false;
  for (const id of setA) {
    if (!setB.has(id)) return false;
  }
  return true;
};

/**
 * Authoritative coordinates: adjusted stations win, sideshots fill gaps.
 * Shared by rerun sync and the explicit adjustment-linked commit so both
 * agree on coverage (a linked station missing here trips MISSING_SOURCE).
 */
export const authoritativeCoordinatesOf = (result: AdjustmentResult): Map<string, FieldToFinishCoordinate> => {
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

/**
 * Production subscriber core: applies one successful adjustment run to the
 * active CAD drawing document. Returns the input document unchanged (same
 * reference) when there is no drawing, no link, or the sync is a no-op —
 * otherwise one atomic persisted-drawing update. The info param is
 * structurally identical to the hook `SuccessfulAdjustmentRunInfo`, kept
 * inline so engine code stays independent of hook types.
 */
export const applySuccessfulAdjustmentRunToDrawing = (
  current: CadDrawingDocument | null,
  info: { result: AdjustmentResult; inputFingerprint: string; settingsFingerprint: string; resultFingerprint?: string; resultDependencyIdentity?: ResultDependencyIdentity | null },
): CadDrawingDocument | null => {
  if (!current || !current.project.metadata.fieldToFinishLink) return current;
  const outcome = applyAdjustmentRerunToLinkedF2f(current.project, {
    result: info.result,
    inputFingerprint: info.inputFingerprint,
    settingsFingerprint: info.settingsFingerprint,
    ...(info.resultFingerprint !== undefined ? { resultFingerprint: info.resultFingerprint } : {}),
    ...(info.resultDependencyIdentity ? { resultDependencyIdentity: info.resultDependencyIdentity } : {}),
  });
  if (outcome.project === current.project) return current;
  return cloneCadDrawingDocument({
    ...current,
    updatedAt: new Date().toISOString(),
    project: outcome.project,
  });
};
