/**
 * Phase 17C — import source identity, fingerprinting, and conflict helpers.
 *
 * Identity is never filename alone: { sourceId, importerId,
 * originalFilename, contentFingerprint }. Same content hashes the same
 * regardless of time (FNV-1a over newline-normalized text). Replace is
 * atomic: the revision validates fully before the original is touched.
 */
import type { ImportedControlStationRecord } from './importers';
import type { ImportWarningCode, ImportWarningSeverity } from './importReviewTypes';

export const WARNING_SEVERITY: Record<ImportWarningCode, ImportWarningSeverity> = {
  UNIT_UNKNOWN: 'BLOCKING',
  UNIT_USER_CONFIRMATION_REQUIRED: 'BLOCKING',
  SOURCE_ALREADY_IMPORTED: 'BLOCKING',
  SOURCE_REVISION_DETECTED: 'WARNING',
  STATION_DEFINITION_CONFLICT: 'BLOCKING',
  HEIGHT_MISSING: 'WARNING',
  DELETED_RECORD_SKIPPED: 'INFO',
  PROVENANCE_PARTIAL: 'WARNING',
  ADJUSTED_POINTS_OUTPUT_ONLY: 'BLOCKING',
};

/** FNV-1a (32-bit) over newline-normalized text. Deterministic across runs. */
export const contentFingerprint = (text: string): string => {
  const normalized = text.replace(/\r\n?/g, '\n');
  let hash = 2166136261 >>> 0;
  for (let index = 0; index < normalized.length; index += 1) {
    hash ^= normalized.charCodeAt(index);
    hash = Math.imul(hash, 16777619) >>> 0;
  }
  return `fnv1a:${hash.toString(16).padStart(8, '0')}`;
};

export interface ManagedSourceKey {
  /** Persistent file/entry id. Stable across renames of the display name. */
  sourceId: string;
  importerId: string;
  originalFilename: string;
  contentFingerprint: string;
}

export interface ManagedSourceEntry {
  key: ManagedSourceKey;
  /** Raw source text retained so unit changes recompute without drift. */
  rawText: string;
}

export type ReimportClassification =
  | 'new'
  | 'exact-duplicate'
  | 'revision-same-id'
  | 'same-filename-new-source';

export const classifyReimport = (
  sources: readonly ManagedSourceEntry[],
  incoming: ManagedSourceKey,
): ReimportClassification => {
  const byId = sources.find((entry) => entry.key.sourceId === incoming.sourceId);
  if (byId) {
    return byId.key.contentFingerprint === incoming.contentFingerprint
      ? 'exact-duplicate'
      : 'revision-same-id';
  }
  const byFile = sources.find(
    (entry) =>
      entry.key.originalFilename === incoming.originalFilename &&
      entry.key.importerId === incoming.importerId,
  );
  if (!byFile) return 'new';
  return byFile.key.contentFingerprint === incoming.contentFingerprint
    ? 'exact-duplicate'
    : 'same-filename-new-source';
};

export const reimportWarningCode = (
  classification: ReimportClassification,
): ImportWarningCode | null => {
  switch (classification) {
    case 'exact-duplicate':
      return 'SOURCE_ALREADY_IMPORTED';
    case 'revision-same-id':
    case 'same-filename-new-source':
      return 'SOURCE_REVISION_DETECTED';
    default:
      return null;
  }
};

/**
 * Atomic replace: validate `newRawText` with `parse` first; on failure the
 * original entry is untouched (malformed revisions never delete first).
 * Returns the updated list, or `{ ok: false, error }` with input unchanged.
 */
export const replaceSourceAtomic = <T>(
  sources: readonly ManagedSourceEntry[],
  targetSourceId: string,
  newRawText: string,
  parse: (_rawText: string) => T,
): { ok: true; sources: ManagedSourceEntry[]; parsed: T } | { ok: false; error: string } => {
  const targetIndex = sources.findIndex((entry) => entry.key.sourceId === targetSourceId);
  if (targetIndex < 0) return { ok: false, error: `Unknown source ${targetSourceId}` };
  let parsed: T;
  try {
    parsed = parse(newRawText);
  } catch (error) {
    return { ok: false, error: error instanceof Error ? error.message : String(error) };
  }
  if (parsed == null) return { ok: false, error: 'Revision failed validation; original retained.' };
  const target = sources[targetIndex]!;
  const next = [...sources];
  next[targetIndex] = {
    ...target,
    rawText: newRawText,
    key: { ...target.key, contentFingerprint: contentFingerprint(newRawText) },
  };
  return { ok: true, sources: next, parsed };
};

/** Remove only the listed source's records; other sources are untouched. */
export const isRecordFromSource = (
  record: { importSourceKey?: string },
  sourceId: string,
): boolean => record.importSourceKey === sourceId;

const STATION_COORD_TOLERANCE_M = 1e-4;

const coordsMatch = (
  left: number | undefined,
  right: number | undefined,
): boolean => {
  if (left == null || right == null) return true;
  return Math.abs(left - right) <= STATION_COORD_TOLERANCE_M;
};

export interface StationDefinitionConflict {
  stationId: string;
  severity: ImportWarningSeverity;
  reason: string;
}

/**
 * Same ID + same coords/status merges safely (returns []). Differing coords
 * for the same ID is a BLOCKING STATION_DEFINITION_CONFLICT — never silent
 * last-wins for fixed definitions. Repeated identical observations are NOT
 * conflicts; only control-station definitions are compared here.
 */
export const detectStationDefinitionConflicts = (
  stations: readonly ImportedControlStationRecord[],
): StationDefinitionConflict[] => {
  const seen = new Map<string, ImportedControlStationRecord>();
  const conflicts: StationDefinitionConflict[] = [];
  stations.forEach((station) => {
    const key = station.stationId.trim().toUpperCase();
    const prior = seen.get(key);
    if (!prior) {
      seen.set(key, station);
      return;
    }
    const same =
      coordsMatch(prior.eastM, station.eastM) &&
      coordsMatch(prior.northM, station.northM) &&
      coordsMatch(prior.heightM, station.heightM);
    if (!same) {
      conflicts.push({
        stationId: station.stationId,
        severity: 'BLOCKING',
        reason:
          `Station ${station.stationId} is defined with differing coordinates ` +
          `by multiple sources; resolve explicitly before commit.`,
      });
    }
  });
  return conflicts;
};

/** Adjusted-points CSV exports (P,N,E,Z,D header family) are output-only. */
export const isAdjustedPointsCsvHeader = (firstLine: string): boolean => {
  const cells = firstLine.split(/[,;\t]/).map((cell) => cell.trim().toUpperCase());
  if (cells.length < 2) return false;
  const set = new Set(cells);
  if (!set.has('P')) return false;
  const axes = ['N', 'E'].filter((axis) => set.has(axis)).length;
  return axes >= 1 && [...set].every((cell) => ['P', 'N', 'E', 'Z', 'D'].includes(cell));
};

/** Fail closed on adjusted-points output instead of silently misparsing it. */
export const guardAgainstAdjustedPointsCsv = (
  input: string,
  sourceName?: string,
): { ok: true } | { ok: false; code: 'ADJUSTED_POINTS_OUTPUT_ONLY'; message: string } => {
  if (!/\.csv$/i.test(sourceName ?? '')) return { ok: true };
  const firstLine = input
    .split('\n')
    .map((line) => line.replace(/\r$/, ''))
    .find((line) => line.trim() !== '' && !line.trim().startsWith('#'));
  if (!firstLine || !isAdjustedPointsCsvHeader(firstLine)) return { ok: true };
  return {
    ok: false,
    code: 'ADJUSTED_POINTS_OUTPUT_ONLY',
    message:
      'Adjusted-points CSV exports are output-only and cannot be re-imported as control. ' +
      'Re-run the adjustment or import the original observed source instead.',
  };
};
