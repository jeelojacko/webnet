/**
 * Phase 18A — Adjustment → CAD source bridge.
 *
 * Explicit serialized handoff between the Adjustment application (/) and the
 * standalone CAD application (/cad). The bridge is storage + schema only:
 * versioned browser-local snapshots keyed by deterministic source id, plus a
 * per-project latest-source registry. The URL carries only the small
 * descriptor (`/cad?source=<id>`); full station payloads live in storage, and
 * CAD never receives a live AdjustmentResult.
 *
 * This module is intentionally engine-free (type-only imports) so the
 * Adjustment bundle can publish without eagerly pulling CAD UI/engine code.
 */
import type { AppliedRunIdentity } from '../engine/resultIntegrity';
import type { CadDrawingDocument } from '../engine/cad/cadTypes';
import type { StationMap } from '../typesObservations';
import type { UnitsMode } from '../typesParseSettings';

/** Current bridge schema version. Bump on any incompatible field change. */
export const CAD_SOURCE_SCHEMA_VERSION = 1;

export const CAD_SOURCE_SNAPSHOTS_KEY = 'webnet.cad-source-snapshots.v1';
export const CAD_SOURCE_REGISTRY_KEY = 'webnet.cad-source-registry.v1';
export const CAD_MIGRATION_CANDIDATE_KEY = 'webnet.cad-migration-candidate.v1';

/**
 * Minimal adjustment payload CAD actually consumes: adjusted stations
 * (coordinates + error ellipses for the CAD import path) with the 17B
 * applied-run identity for 17E dependency stamping. No observations, no
 * run settings, no QC state.
 */
export interface AdjustmentSourceSnapshot {
  schemaVersion: typeof CAD_SOURCE_SCHEMA_VERSION;
  /** Deterministic: `cad-src:<projectId>:<resultFingerprint>`. */
  sourceId: string;
  projectId: string;
  projectName: string | null;
  runMode: string;
  /** Reused 17B identity — never a second local fingerprint scheme. */
  appliedRunIdentity: AppliedRunIdentity;
  resultFingerprint: string;
  generatedAt: string;
  coordinateContext: {
    units: UnitsMode;
    crsId: string | null;
    crsLabel: string | null;
  };
  stations: StationMap;
  stationCount: number;
}

export interface CadSourceRegistryEntry {
  latestSourceId: string;
  projectId: string;
  projectName: string | null;
  generatedAt: string;
  resultFingerprint: string;
  stationCount: number;
  /** Latest published identity — CAD compares imports against this. */
  appliedRunIdentity: AppliedRunIdentity;
}

export type CadSourceRegistry = Record<string, CadSourceRegistryEntry>;

export const buildCadSourceId = (projectId: string, resultFingerprint: string): string =>
  `cad-src:${projectId}:${resultFingerprint}`;

export const buildAdjustmentSourceSnapshot = (params: {
  projectId: string;
  projectName: string | null;
  runMode: string;
  appliedRunIdentity: AppliedRunIdentity;
  resultFingerprint: string;
  generatedAt: string;
  units: UnitsMode;
  crsId: string | null;
  crsLabel: string | null;
  stations: StationMap;
}): AdjustmentSourceSnapshot => {
  const stationIds = Object.keys(params.stations).sort();
  const stations: StationMap = {};
  for (const stationId of stationIds) {
    const station = params.stations[stationId];
    if (station) stations[stationId] = { ...station };
  }
  return {
    schemaVersion: CAD_SOURCE_SCHEMA_VERSION,
    sourceId: buildCadSourceId(params.projectId, params.resultFingerprint),
    projectId: params.projectId,
    projectName: params.projectName,
    runMode: params.runMode,
    appliedRunIdentity: { ...params.appliedRunIdentity },
    resultFingerprint: params.resultFingerprint,
    generatedAt: params.generatedAt,
    coordinateContext: {
      units: params.units,
      crsId: params.crsId,
      crsLabel: params.crsLabel,
    },
    stations,
    stationCount: stationIds.length,
  };
};

const readStorageRecord = (key: string): Record<string, unknown> => {
  try {
    const raw = window.localStorage.getItem(key);
    if (!raw) return {};
    const parsed: unknown = JSON.parse(raw);
    if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
      return parsed as Record<string, unknown>;
    }
  } catch {
    // Corrupt or unavailable storage reads as empty (fail-closed downstream).
  }
  return {};
};

const writeStorageRecord = (key: string, record: Record<string, unknown>): boolean => {
  try {
    window.localStorage.setItem(key, JSON.stringify(record));
    return true;
  } catch {
    return false;
  }
};

const isSnapshot = (value: unknown): value is AdjustmentSourceSnapshot => {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  const record = value as Record<string, unknown>;
  return (
    record.schemaVersion === CAD_SOURCE_SCHEMA_VERSION &&
    typeof record.sourceId === 'string' &&
    typeof record.projectId === 'string' &&
    typeof record.resultFingerprint === 'string' &&
    record.stations != null &&
    typeof record.stations === 'object'
  );
};

/** Publish a snapshot and update the per-project latest-source registry. */
export const publishAdjustmentSource = (snapshot: AdjustmentSourceSnapshot): boolean => {
  if (!isSnapshot(snapshot)) return false;
  const snapshots = readStorageRecord(CAD_SOURCE_SNAPSHOTS_KEY);
  snapshots[snapshot.sourceId] = snapshot;
  const stored = writeStorageRecord(CAD_SOURCE_SNAPSHOTS_KEY, snapshots);
  const registry = readStorageRecord(CAD_SOURCE_REGISTRY_KEY);
  registry[snapshot.projectId] = {
    latestSourceId: snapshot.sourceId,
    projectId: snapshot.projectId,
    projectName: snapshot.projectName,
    generatedAt: snapshot.generatedAt,
    resultFingerprint: snapshot.resultFingerprint,
    stationCount: snapshot.stationCount,
    appliedRunIdentity: snapshot.appliedRunIdentity,
  } satisfies CadSourceRegistryEntry;
  const registryStored = writeStorageRecord(CAD_SOURCE_REGISTRY_KEY, registry);
  return stored && registryStored;
};

/** Invalid token or missing entry reads as null — CAD loads with a warning, never crashes. */
export const readAdjustmentSource = (sourceId: string | null | undefined): AdjustmentSourceSnapshot | null => {
  if (!sourceId) return null;
  const snapshot: unknown = readStorageRecord(CAD_SOURCE_SNAPSHOTS_KEY)[sourceId];
  return isSnapshot(snapshot) ? snapshot : null;
};

export const readLatestSourceForProject = (projectId: string | null | undefined): CadSourceRegistryEntry | null => {
  if (!projectId) return null;
  const entry: unknown = readStorageRecord(CAD_SOURCE_REGISTRY_KEY)[projectId];
  if (!entry || typeof entry !== 'object' || Array.isArray(entry)) return null;
  const record = entry as Record<string, unknown>;
  if (typeof record.latestSourceId !== 'string' || record.appliedRunIdentity == null) return null;
  return entry as CadSourceRegistryEntry;
};

/** Fail-closed units/context gate: never silently transform or change drawing settings. */
export const checkSnapshotImportCompatibility = (
  snapshot: AdjustmentSourceSnapshot,
  drawingUnits: UnitsMode,
): { ok: true } | { ok: false; message: string } => {
  if (snapshot.coordinateContext.units !== drawingUnits) {
    return {
      ok: false,
      message:
        `Import blocked: source units (${snapshot.coordinateContext.units}) do not match ` +
        `drawing units (${drawingUnits}). Change the drawing units first — no automatic conversion is applied.`,
    };
  }
  return { ok: true };
};

/** Legacy drawing staged by Adjustment as a migration candidate (never auto-current). */
export const stageLegacyMigrationCandidate = (drawing: CadDrawingDocument): boolean => {
  try {
    window.localStorage.setItem(CAD_MIGRATION_CANDIDATE_KEY, JSON.stringify(drawing));
    return true;
  } catch {
    return false;
  }
};

export const readLegacyMigrationCandidate = (): CadDrawingDocument | null => {
  try {
    const raw = window.localStorage.getItem(CAD_MIGRATION_CANDIDATE_KEY);
    if (!raw) return null;
    const parsed: unknown = JSON.parse(raw);
    if (parsed && typeof parsed === 'object' && (parsed as { kind?: unknown }).kind === 'webnet-cad-drawing') {
      return parsed as CadDrawingDocument;
    }
  } catch {
    // Corrupt candidate reads as absent.
  }
  return null;
};

export const clearLegacyMigrationCandidate = (): void => {
  try {
    window.localStorage.removeItem(CAD_MIGRATION_CANDIDATE_KEY);
  } catch {
    // Best-effort only.
  }
};
