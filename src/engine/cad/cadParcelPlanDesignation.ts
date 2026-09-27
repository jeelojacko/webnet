// Phase 19D Wave 1 — plan designation + bulk numbering (pure helpers).
//
// Plan Role is user-assigned DISPLAY metadata only ("Plan Role"); NEVER infer
// legal meaning. No owner/PID/deed/tenement fields live here. Geometry,
// courseIds, and parcelName are never touched by this module.

import type {
  CadParcelEntity,
  CadParcelPlanInfo,
  CadParcelPlanRole,
} from './cadTypes';

export type ParcelNumberingOrder = 'selection' | 'name' | 'spatial';

export interface ParcelNumberingOptions {
  prefix?: string;
  start?: number;
  separator?: string;
  suffix?: string;
  order?: ParcelNumberingOrder;
  /** Zero-pad the sequence number to this width; 0/absent = no padding. */
  pad?: number;
}

export interface ParcelNumberingPreview {
  parcelId: string;
  current?: string;
  proposed: string;
}

export interface PlanInfoPatch {
  designation?: string;
  role?: CadParcelPlanRole;
  description?: string;
}

/**
 * Pure plan-info update. `undefined` patch fields = leave; a blank
 * designation/description clears that field. Drops the trailing `planInfo`
 * key entirely when nothing remains. Never touches geometry or identity.
 */
export const setParcelPlanInfo = (
  parcel: CadParcelEntity,
  patch: PlanInfoPatch,
): CadParcelEntity => {
  const next: CadParcelPlanInfo = { ...(parcel.planInfo ?? {}) };
  if (patch.designation !== undefined) {
    const trimmed = patch.designation.trim();
    if (trimmed) next.designation = trimmed;
    else delete next.designation;
  }
  if (patch.role !== undefined) next.role = patch.role;
  if (patch.description !== undefined) {
    const trimmed = patch.description.trim();
    if (trimmed) next.description = trimmed;
    else delete next.description;
  }
  const clone: CadParcelEntity = { ...parcel };
  if (next.designation == null && next.role == null && next.description == null) {
    delete clone.planInfo;
  } else {
    clone.planInfo = next;
  }
  return clone;
};

const centroid = (parcel: CadParcelEntity): { x: number; y: number } => {
  const count = Math.max(1, parcel.vertices.length);
  let x = 0;
  let y = 0;
  for (const vertex of parcel.vertices) {
    x += vertex.x;
    y += vertex.y;
  }
  return { x: x / count, y: y / count };
};

const formatNumber = (value: number, pad: number): string =>
  pad > 0 ? String(value).padStart(pad, '0') : String(value);

/**
 * Deterministic bulk-numbering preview: current → proposed designation per
 * parcel. `selection` keeps input order; `name` sorts by parcelName;
 * `spatial` sorts west→east then north→south by centroid. Same input always
 * yields the same preview (no id minting, no randomness).
 */
export const previewParcelNumbering = (
  parcels: readonly CadParcelEntity[],
  options: ParcelNumberingOptions = {},
): ParcelNumberingPreview[] => {
  const prefix = options.prefix ?? 'Lot';
  const start = options.start ?? 1;
  const separator = options.separator ?? ' ';
  const suffix = options.suffix ?? '';
  const order = options.order ?? 'selection';
  const pad = options.pad ?? 0;
  const ordered = [...parcels];
  if (order === 'name') {
    ordered.sort((a, b) => a.parcelName.localeCompare(b.parcelName));
  } else if (order === 'spatial') {
    ordered.sort((a, b) => {
      const ca = centroid(a);
      const cb = centroid(b);
      return ca.x - cb.x || cb.y - ca.y;
    });
  }
  return ordered.map((parcel, index) => ({
    parcelId: parcel.id,
    ...(parcel.planInfo?.designation != null ? { current: parcel.planInfo.designation } : {}),
    proposed: `${prefix}${separator}${formatNumber(start + index, pad)}${suffix}`,
  }));
};

export interface PlanDuplicateCheck {
  warnings: string[];
  blocked: string[];
}

/**
 * Exact-match duplicate check over a post-state designation set. ANY exact
 * duplicate warns; role='lot' duplicates BLOCK unless `allowLotDuplicates`
 * (explicit confirm) is set. Comparison is exact (case-sensitive, trimmed).
 */
export const checkPlanDesignationDuplicates = (
  entries: ReadonlyArray<{ parcelId: string; designation?: string; role?: CadParcelPlanRole }>,
  options: { allowLotDuplicates?: boolean } = {},
): PlanDuplicateCheck => {
  const seen = new Map<string, { parcelId: string; role?: CadParcelPlanRole }>();
  const warnings: string[] = [];
  const blocked: string[] = [];
  for (const entry of entries) {
    const designation = entry.designation?.trim();
    if (!designation) continue;
    const prior = seen.get(designation);
    if (!prior) {
      seen.set(designation, { parcelId: entry.parcelId, role: entry.role });
      continue;
    }
    warnings.push(
      `PARCEL_DUPLICATE_DESIGNATION: '${designation}' on ${prior.parcelId} and ${entry.parcelId}.`,
    );
    if (
      (prior.role === 'lot' || entry.role === 'lot') &&
      options.allowLotDuplicates !== true
    ) {
      blocked.push(
        `PARCEL_LOT_DUPLICATE_BLOCKED: '${designation}' on ${prior.parcelId} and ${entry.parcelId}.`,
      );
    }
  }
  return { warnings, blocked };
};

/**
 * COPY policy (mutation-matrix row 7): a copy carries role/description but
 * NEVER the designation. Returns undefined when nothing carries over, so the
 * caller can shadow the spread without leaving a stale key.
 */
export const planInfoForParcelCopy = (
  source?: CadParcelPlanInfo,
): CadParcelPlanInfo | undefined => {
  if (!source) return undefined;
  const next: CadParcelPlanInfo = {};
  if (source.role != null) next.role = source.role;
  if (source.description != null) next.description = source.description;
  return next.role == null && next.description == null ? undefined : next;
};
