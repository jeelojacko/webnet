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
import { replaceCadProjectEntities } from '../cad/cadProjectState';
import type { CadCommand } from '../cad/cadTransactions.types';
import type { CadEntity, CadProject, CadSurveyPointEntity } from '../cad/cadTypes';
import type { ImportedControlStationRecord } from '../importers';
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
 * MANUAL_OVERRIDE points are skipped + reported. Read-only w.r.t.
 * adjustment inputs.
 */
export const updateFieldToFinishCoordinates = (
  project: CadProject,
  coordinates: ReadonlyMap<string, FieldToFinishCoordinate>,
): { project: CadProject; updated: string[]; skippedManual: string[] } => {
  const updated: string[] = [];
  const skippedManual: string[] = [];
  const next = project.entities.map((entity) => {
    if (entity.type === 'survey-point' && isFieldToFinishEntity(entity)) {
      const coords = coordinates.get(entity.stationId);
      if (!coords) return entity;
      if (getFieldToFinishState(entity) !== 'GENERATED') {
        skippedManual.push(entity.stationId);
        return entity;
      }
      updated.push(entity.stationId);
      return { ...entity, x: coords.x, y: coords.y, z: coords.z ?? entity.z };
    }
    return entity;
  });
  const moved = new Map(updated.map((stationId) => [stationId, coordinates.get(stationId) as FieldToFinishCoordinate]));
  const synced = next.map((entity) => {
    if ((entity.type === 'line' || entity.type === 'polyline') && isFieldToFinishEntity(entity)) {
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
    if (entity.type === 'text' && isFieldToFinishEntity(entity) && entity.anchorEntityId) {
      const station = entity.anchorEntityId.replace(/^pt:/, '');
      const coords = moved.get(station);
      if (!coords) return entity;
      return { ...entity, x: coords.x, y: coords.y };
    }
    return entity;
  });
  updated.sort();
  skippedManual.sort();
  return { project: replaceCadProjectEntities(project, synced), updated, skippedManual };
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
