/**
 * Phase 17E — pure CAD adjustment-dependency core.
 *
 * Answers "is this CAD entity still backed by the current adjustment
 * result?" without touching UI, DOM, or stores. All functions are pure;
 * entity ordering is preserved (single linear pass in the summary).
 *
 * The adjustment fingerprint is `ResultDependencyIdentity` from
 * `../resultIntegrity` — never a second local fingerprint.
 */
import { cadBuildParcelClosureSummary } from './cadCogoParcelGeometrySummaries';
import type { CadEntity, CadProject } from './cadTypes';
import type { ResultDependencyIdentity } from '../resultIntegrity';

export type CadDependencyStatus =
  | 'CURRENT'
  | 'STALE'
  | 'UNKNOWN_LEGACY'
  | 'MANUAL'
  | 'SOURCE_MISSING';

export type CadDependencyReasonCode =
  | 'CAD_CURRENT'
  | 'CAD_NO_DEPENDENCY'
  | 'CAD_SOURCE_RESULT_STALE'
  | 'CAD_SOURCE_RESULT_REPLACED'
  | 'CAD_SOURCE_STATION_MISSING'
  | 'CAD_LEGACY_DEPENDENCY_UNKNOWN'
  | 'CAD_PARCEL_METRICS_STALE'
  | 'CAD_F2F_SYNC_INCOMPLETE'
  | 'CAD_DERIVED_LABEL_STALE'
  | 'CAD_OWNER_CONFLICT';

export interface CadAdjustmentDependency {
  inputFingerprint: string;
  mathFingerprint: string;
  exclusionFingerprint: string;
}

export type CadEntityOwner =
  | 'MANUAL'
  | 'ADJUSTMENT_IMPORT'
  | 'F2F_GENERATED'
  | 'F2F_MANUAL_OVERRIDE'
  | 'COGO'
  | 'PARCEL_DERIVED'
  | 'SHEET_DERIVED';

export interface CadDependencyEvaluation {
  status: CadDependencyStatus;
  reason: CadDependencyReasonCode;
}

export interface CadDependencyEvalOptions {
  stationIds?: Set<string>;
  f2fLinkStatus?: string;
  /**
   * Phase 17E: link source of the drawing's F2F generation. When
   * 'coordinate-import', F2F_GENERATED entities read MANUAL (exportable) —
   * coordinate-import lineage tracking is out of scope, so no
   * adjustment-dependency verdict applies. Absent = current behavior.
   */
  f2fLinkSourceKind?: string;
}

export interface DrawingDependencySummary {
  status: 'CURRENT' | 'STALE' | 'NEEDS_REVIEW' | 'MANUAL_ONLY';
  currentCount: number;
  staleCount: number;
  unknownCount: number;
  brokenCount: number;
  manualCount: number;
  reasons: CadDependencyReasonCode[];
}

type Metadata = Record<string, unknown>;

const metadataOf = (entity: CadEntity): Metadata =>
  (entity.metadata ?? {}) as Metadata;

const isNonEmptyString = (value: unknown): value is string =>
  typeof value === 'string' && value.length > 0;

/** Derive the owner from existing metadata signals only; never invent one. */
export const ownerOfCadEntity = (entity: CadEntity): CadEntityOwner => {
  const metadata = metadataOf(entity);
  const provenance = metadata['provenance'];
  if (typeof provenance === 'object' && provenance !== null) {
    const record = provenance as Record<string, unknown>;
    if (record['generatedBy'] === 'FIELD_TO_FINISH') {
      return record['state'] === 'MANUAL_OVERRIDE' ? 'F2F_MANUAL_OVERRIDE' : 'F2F_GENERATED';
    }
  }
  if (metadata['manual'] === true) return 'MANUAL';
  // Phase 17E: parsed-input spike geometry is user-input-derived, never
  // adjustment-derived — but the marker applies only to UNSTAMPED entities:
  // a well-formed stamp always wins, so hand-edited metadata cannot demote
  // a stamped adjustment entity to MANUAL and bypass the deliverable gate.
  if (metadata['spikeSource'] === 'parsed-input' && dependencyOf(entity) === null) return 'MANUAL';
  if (metadata['importedFrom'] === 'adjusted-points') return 'ADJUSTMENT_IMPORT';
  if (typeof metadata['cogo'] === 'object' && metadata['cogo'] !== null) return 'COGO';
  if (entity.type === 'parcel') {
    return entity.vertexLabels.length > 0 ? 'PARCEL_DERIVED' : 'MANUAL';
  }
  if (entity.type === 'text') {
    const hasAnchor =
      isNonEmptyString(entity.anchorEntityId) ||
      isNonEmptyString(metadata['sourceEntityId']) ||
      isNonEmptyString(metadata['autoValue']);
    return hasAnchor && isNonEmptyString(metadata['stationId']) ? 'SHEET_DERIVED' : 'MANUAL';
  }
  if (entity.type === 'survey-point') {
    return entity.source === 'adjustment-result' ? 'ADJUSTMENT_IMPORT' : 'MANUAL';
  }
  if (entity.type === 'error-ellipse') return 'ADJUSTMENT_IMPORT';
  if (entity.type === 'line') {
    return Array.isArray(entity.sourceObservationIds) && entity.sourceObservationIds.length > 0
      ? 'ADJUSTMENT_IMPORT'
      : 'MANUAL';
  }
  return 'MANUAL';
};

/** Strict shape guard: exactly 3 non-empty fingerprint strings, else null. */
export const dependencyOf = (entity: CadEntity): CadAdjustmentDependency | null => {
  const metadata = metadataOf(entity);
  const raw = metadata['adjustmentDependency'];
  if (typeof raw !== 'object' || raw === null) return null;
  const record = raw as Record<string, unknown>;
  const input = record['inputFingerprint'];
  const math = record['mathFingerprint'];
  const exclusion = record['exclusionFingerprint'];
  if (!isNonEmptyString(input) || !isNonEmptyString(math) || !isNonEmptyString(exclusion)) return null;
  return { inputFingerprint: input, mathFingerprint: math, exclusionFingerprint: exclusion };
};

/** Shallow-copy stamp; preserves F2F provenance and all other metadata. */
export const stampAdjustmentDependency = (
  entity: CadEntity,
  identity: ResultDependencyIdentity,
): CadEntity => ({
  ...entity,
  metadata: {
    ...(metadataOf(entity)),
    adjustmentDependency: {
      inputFingerprint: identity.inputFingerprint,
      mathFingerprint: identity.mathFingerprint,
      exclusionFingerprint: identity.exclusionFingerprint,
    } satisfies CadAdjustmentDependency,
  },
});

export const identitiesEqual = (
  a: CadAdjustmentDependency | ResultDependencyIdentity,
  b: CadAdjustmentDependency | ResultDependencyIdentity,
): boolean =>
  a.inputFingerprint === b.inputFingerprint &&
  a.mathFingerprint === b.mathFingerprint &&
  a.exclusionFingerprint === b.exclusionFingerprint;

/** Station ids backing an entity: typed fields plus the metadata linkage. */
const stationBackingOf = (entity: CadEntity): string[] => {
  const found: string[] = [];
  if (entity.type === 'survey-point' || entity.type === 'error-ellipse') found.push(entity.stationId);
  if (entity.type === 'line') found.push(entity.fromStationId, entity.toStationId);
  const metadata = metadataOf(entity);
  if (isNonEmptyString(metadata['stationId'])) found.push(metadata['stationId']);
  return found;
};

const isFiniteNumber = (value: unknown): value is number =>
  typeof value === 'number' && Number.isFinite(value);

/** 1e-9 relative agreement; falls back to absolute near zero. */
const agreesRelative = (stored: number, live: number): boolean =>
  Math.abs(stored - live) <= 1e-9 * Math.max(1, Math.abs(stored), Math.abs(live));

/** Stored parcel metrics disagree with a live closure recompute. */
const parcelMetricsStale = (entity: CadEntity): boolean => {
  if (entity.type !== 'parcel') return false;
  const stored: Array<[unknown, number | null]> = [
    [entity.areaSquareMeters, null],
    [entity.perimeterMeters, null],
    [entity.closureDistanceMeters, null],
  ];
  const defined = stored
    .map(([value]) => value)
    .filter(isFiniteNumber);
  if (defined.length === 0) return false;
  const live = cadBuildParcelClosureSummary(entity.vertices);
  if (!live) return true;
  const pairs: Array<[unknown, number]> = [
    [entity.areaSquareMeters, live.areaSquareMeters],
    [entity.perimeterMeters, live.perimeterMeters],
    [entity.closureDistanceMeters, live.closureDistanceMeters],
  ];
  return pairs.some(([value, expected]) => isFiniteNumber(value) && !agreesRelative(value, expected));
};

const isBrokenLabel = (entity: CadEntity): boolean => {
  if (entity.type !== 'text') return false;
  const metadata = metadataOf(entity);
  return metadata['valueState'] === 'BROKEN_REFERENCE' || metadata['state'] === 'BROKEN_REFERENCE';
};

export const evaluateCadEntityDependency = (
  entity: CadEntity,
  current: ResultDependencyIdentity | null,
  opts?: CadDependencyEvalOptions,
): CadDependencyEvaluation => {
  const owner = ownerOfCadEntity(entity);
  if (owner === 'MANUAL' || owner === 'F2F_MANUAL_OVERRIDE' || owner === 'COGO') {
    return { status: 'MANUAL', reason: 'CAD_NO_DEPENDENCY' };
  }
  // Coordinate-import F2F carries no adjustment lineage: exportable, never stale.
  if (owner === 'F2F_GENERATED' && opts?.f2fLinkSourceKind === 'coordinate-import') {
    return { status: 'MANUAL', reason: 'CAD_NO_DEPENDENCY' };
  }
  const stamp = dependencyOf(entity);
  if (!stamp) return { status: 'UNKNOWN_LEGACY', reason: 'CAD_LEGACY_DEPENDENCY_UNKNOWN' };
  if (current === null) return { status: 'STALE', reason: 'CAD_SOURCE_RESULT_STALE' };
  if (opts?.stationIds) {
    const missing = stationBackingOf(entity).some((id) => !opts.stationIds!.has(id));
    if (missing) return { status: 'SOURCE_MISSING', reason: 'CAD_SOURCE_STATION_MISSING' };
  }
  if (!identitiesEqual(stamp, current)) {
    return { status: 'STALE', reason: 'CAD_SOURCE_RESULT_REPLACED' };
  }
  if (owner === 'F2F_GENERATED' && opts?.f2fLinkStatus !== undefined && opts.f2fLinkStatus !== 'CURRENT') {
    return { status: 'STALE', reason: 'CAD_F2F_SYNC_INCOMPLETE' };
  }
  if (parcelMetricsStale(entity)) return { status: 'STALE', reason: 'CAD_PARCEL_METRICS_STALE' };
  if (isBrokenLabel(entity)) return { status: 'STALE', reason: 'CAD_DERIVED_LABEL_STALE' };
  return { status: 'CURRENT', reason: 'CAD_CURRENT' };
};

/** Single linear pass; no per-entity indexes (callers pass stationIds in). */
export const summarizeDrawingDependency = (
  project: CadProject,
  current: ResultDependencyIdentity | null,
  opts?: CadDependencyEvalOptions,
): DrawingDependencySummary => {
  let currentCount = 0;
  let staleCount = 0;
  let unknownCount = 0;
  let brokenCount = 0;
  let manualCount = 0;
  let seenStaleOrMissing = false;
  let seenUnknown = false;
  const reasonSet = new Set<CadDependencyReasonCode>();
  for (const entity of project.entities) {
    const verdict = evaluateCadEntityDependency(entity, current, opts);
    if (verdict.reason !== 'CAD_CURRENT' && verdict.reason !== 'CAD_NO_DEPENDENCY') {
      reasonSet.add(verdict.reason);
    }
    switch (verdict.status) {
      case 'CURRENT': currentCount += 1; break;
      case 'MANUAL': manualCount += 1; break;
      case 'UNKNOWN_LEGACY': unknownCount += 1; seenUnknown = true; break;
      case 'STALE':
        if (verdict.reason === 'CAD_DERIVED_LABEL_STALE') brokenCount += 1;
        else staleCount += 1;
        seenStaleOrMissing = true;
        break;
      case 'SOURCE_MISSING': staleCount += 1; seenStaleOrMissing = true; break;
    }
  }
  const total = project.entities.length;
  const status: DrawingDependencySummary['status'] =
    seenStaleOrMissing ? 'STALE' : seenUnknown ? 'NEEDS_REVIEW' : manualCount === total ? 'MANUAL_ONLY' : 'CURRENT';
  return {
    status, currentCount, staleCount, unknownCount, brokenCount, manualCount,
    reasons: [...reasonSet].sort(),
  };
};

const BLOCK_MESSAGE_BY_REASON: Record<CadDependencyReasonCode, string> = {
  CAD_CURRENT: 'CAD dependencies are current.',
  CAD_NO_DEPENDENCY: 'Manual-only drawing; nothing to sync.',
  CAD_SOURCE_RESULT_STALE: 'Refresh adjusted points from the current result before delivery.',
  CAD_SOURCE_RESULT_REPLACED: 'Refresh adjusted points from the current result before delivery.',
  CAD_SOURCE_STATION_MISSING: 'Refresh adjusted points from the current result before delivery; linked stations are missing.',
  CAD_LEGACY_DEPENDENCY_UNKNOWN: 'Review unstamped legacy entities and re-import or stamp them before delivery.',
  CAD_PARCEL_METRICS_STALE: 'Review parcel geometry against current coordinates before delivery.',
  CAD_F2F_SYNC_INCOMPLETE: 'Sync linked field-to-finish data before delivery.',
  CAD_DERIVED_LABEL_STALE: 'Refresh derived annotations before delivery.',
  CAD_OWNER_CONFLICT: 'Resolve conflicting entity ownership before delivery.',
};

export const decideCadDeliverableVerdict = (
  summary: DrawingDependencySummary,
): { allowed: boolean; reason: CadDependencyReasonCode | null; blockMessage: string | null } => {
  if (summary.status === 'MANUAL_ONLY' || summary.status === 'CURRENT') {
    return { allowed: true, reason: null, blockMessage: null };
  }
  const reason = summary.reasons[0] ?? 'CAD_OWNER_CONFLICT';
  return { allowed: false, reason, blockMessage: BLOCK_MESSAGE_BY_REASON[reason] };
};
