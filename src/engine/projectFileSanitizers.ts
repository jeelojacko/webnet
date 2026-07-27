import type {
  ClusterApprovedMerge,
  CustomLevelLoopTolerancePreset,
  Instrument,
  InstrumentLibrary,
  ObservationOverride,
  ProjectExportFormat,
} from '../types';
import {
  buildProjectFileStoragePath,
  createProjectFileId,
  normalizeProjectFileKind,
  normalizeWorkspaceState,
  type ProjectManifestFileEntry,
  type ProjectManifestWorkspaceState,
} from './projectWorkspace';

export const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value != null && !Array.isArray(value);

export const cloneRecord = (value: Record<string, unknown>): Record<string, unknown> => ({
  ...value,
});

export const normalizeRetiredParseSettings = (parseSettings: Record<string, unknown>): void => {
  parseSettings.solveProfile = 'industry-parity';
  parseSettings.parseCompatibilityMode = 'strict';
  parseSettings.parseModeMigrated = true;
  parseSettings.crsTransformEnabled = false;
  parseSettings.crsProjectionModel = 'legacy-equirectangular';
  parseSettings.crsLabel = '';
};

export const cloneInstruments = (library: InstrumentLibrary): InstrumentLibrary => {
  const next: InstrumentLibrary = {};
  Object.entries(library).forEach(([code, inst]) => {
    next[code] = { ...inst };
  });
  return next;
};

export const mergeKnownKeys = (
  fallback: Record<string, unknown>,
  candidate: unknown,
): Record<string, unknown> => {
  if (!isRecord(candidate)) return cloneRecord(fallback);
  const next: Record<string, unknown> = {};
  Object.entries(fallback).forEach(([key, defaultValue]) => {
    const value = candidate[key];
    if (value == null) {
      next[key] = defaultValue;
      return;
    }
    if (typeof defaultValue === 'boolean' && typeof value === 'boolean') {
      next[key] = value;
      return;
    }
    if (typeof defaultValue === 'number' && typeof value === 'number' && Number.isFinite(value)) {
      next[key] = value;
      return;
    }
    if (typeof defaultValue === 'string' && typeof value === 'string') {
      next[key] = value;
      return;
    }
    if (Array.isArray(defaultValue) && Array.isArray(value)) {
      next[key] = [...value];
      return;
    }
    next[key] = defaultValue;
  });
  return next;
};

export const sanitizeInstrumentLibrary = (
  candidate: unknown,
  fallback: InstrumentLibrary,
): InstrumentLibrary => {
  if (!isRecord(candidate)) return cloneInstruments(fallback);
  const sanitized: InstrumentLibrary = {};
  Object.entries(candidate).forEach(([code, raw]) => {
    if (!isRecord(raw)) return;
    const instrument: Instrument = {
      code: typeof raw.code === 'string' && raw.code.trim() ? raw.code.trim() : code,
      desc: typeof raw.desc === 'string' ? raw.desc : '',
      edm_const: typeof raw.edm_const === 'number' ? raw.edm_const : 0,
      edm_ppm: typeof raw.edm_ppm === 'number' ? raw.edm_ppm : 0,
      hzPrecision_sec: typeof raw.hzPrecision_sec === 'number' ? raw.hzPrecision_sec : 0,
      dirPrecision_sec: typeof raw.dirPrecision_sec === 'number' ? raw.dirPrecision_sec : 0,
      azBearingPrecision_sec:
        typeof raw.azBearingPrecision_sec === 'number' ? raw.azBearingPrecision_sec : 0,
      vaPrecision_sec: typeof raw.vaPrecision_sec === 'number' ? raw.vaPrecision_sec : 0,
      instCentr_m: typeof raw.instCentr_m === 'number' ? raw.instCentr_m : 0,
      tgtCentr_m: typeof raw.tgtCentr_m === 'number' ? raw.tgtCentr_m : 0,
      vertCentr_m: typeof raw.vertCentr_m === 'number' ? raw.vertCentr_m : 0,
      elevDiff_const_m: typeof raw.elevDiff_const_m === 'number' ? raw.elevDiff_const_m : 0,
      elevDiff_ppm: typeof raw.elevDiff_ppm === 'number' ? raw.elevDiff_ppm : 0,
      gpsStd_xy: typeof raw.gpsStd_xy === 'number' ? raw.gpsStd_xy : 0,
      levStd_mmPerKm: typeof raw.levStd_mmPerKm === 'number' ? raw.levStd_mmPerKm : 0,
    };
    sanitized[code] = instrument;
  });
  if (Object.keys(sanitized).length === 0) return cloneInstruments(fallback);
  return sanitized;
};

export const sanitizeCustomPresets = (
  candidate: unknown,
  fallback: CustomLevelLoopTolerancePreset[],
): CustomLevelLoopTolerancePreset[] => {
  if (!Array.isArray(candidate)) return fallback.map((preset) => ({ ...preset }));
  const rows: CustomLevelLoopTolerancePreset[] = [];
  candidate.forEach((entry, index) => {
    if (!isRecord(entry)) return;
    const id =
      typeof entry.id === 'string' && entry.id.trim() ? entry.id : `loaded-preset-${index + 1}`;
    const name =
      typeof entry.name === 'string' && entry.name.trim() ? entry.name : `Custom ${index + 1}`;
    const baseMm =
      typeof entry.baseMm === 'number' && Number.isFinite(entry.baseMm)
        ? Math.max(0, entry.baseMm)
        : 0;
    const perSqrtKmMm =
      typeof entry.perSqrtKmMm === 'number' && Number.isFinite(entry.perSqrtKmMm)
        ? Math.max(0, entry.perSqrtKmMm)
        : 0;
    rows.push({ id, name, baseMm, perSqrtKmMm });
  });
  return rows;
};

export const sanitizeExportFormat = (
  value: unknown,
  fallback: ProjectExportFormat,
): ProjectExportFormat => {
  if (
    value === 'points' ||
    value === 'points-csv' ||
    value === 'observations-csv' ||
    value === 'geojson' ||
    value === 'webnet' ||
    value === 'industry-style' ||
    value === 'landxml' ||
    value === 'bundle-qa-standard' ||
    value === 'bundle-qa-standard-with-landxml'
  ) {
    return value;
  }
  return fallback;
};

export const sanitizeIncludeFiles = (value: unknown): Record<string, string> => {
  if (!isRecord(value)) return {};
  const next: Record<string, string> = {};
  Object.entries(value).forEach(([key, raw]) => {
    if (!key.trim() || typeof raw !== 'string') return;
    next[key] = raw;
  });
  return next;
};

export const sanitizePortableProjectFiles = (
  candidate: unknown,
  fileContents: Record<string, string>,
): ProjectManifestFileEntry[] => {
  if (!Array.isArray(candidate)) return [];
  const rows: ProjectManifestFileEntry[] = [];
  candidate.forEach((entry, index) => {
    if (!isRecord(entry)) return;
    const id =
      typeof entry.id === 'string' && entry.id.trim().length > 0
        ? entry.id.trim()
        : createProjectFileId();
    const name =
      typeof entry.name === 'string' && entry.name.trim().length > 0
        ? entry.name.trim()
        : `file-${index + 1}.dat`;
    const kind = normalizeProjectFileKind(entry.kind, index === 0 ? 'dat' : 'other');
    const order =
      typeof entry.order === 'number' && Number.isFinite(entry.order)
        ? Math.floor(entry.order)
        : index;
    const text = fileContents[id] ?? '';
    rows.push({
      id,
      name,
      kind,
      path:
        typeof entry.path === 'string' && entry.path.trim().length > 0
          ? entry.path.trim()
          : buildProjectFileStoragePath(id, name),
      enabled: typeof entry.enabled === 'boolean' ? entry.enabled : true,
      order,
      createdAt:
        typeof entry.createdAt === 'string' && entry.createdAt.trim().length > 0
          ? entry.createdAt.trim()
          : undefined,
      updatedAt:
        typeof entry.updatedAt === 'string' && entry.updatedAt.trim().length > 0
          ? entry.updatedAt.trim()
          : undefined,
      size:
        typeof entry.size === 'number' && Number.isFinite(entry.size)
          ? Math.max(0, entry.size)
          : text.length,
      modifiedAt:
        typeof entry.modifiedAt === 'string' && entry.modifiedAt.trim().length > 0
          ? entry.modifiedAt.trim()
          : undefined,
    });
  });
  return rows.sort(
    (a, b) =>
      a.order - b.order ||
      a.name.localeCompare(b.name, undefined, { numeric: true }) ||
      a.id.localeCompare(b.id, undefined, { numeric: true }),
  );
};

export const sanitizePortableFileContents = (value: unknown): Record<string, string> => {
  if (!isRecord(value)) return {};
  const next: Record<string, string> = {};
  Object.entries(value).forEach(([key, raw]) => {
    if (!key.trim() || typeof raw !== 'string') return;
    next[key] = raw;
  });
  return next;
};

export const sanitizeWorkspaceState = (
  candidate: unknown,
  files: ProjectManifestFileEntry[],
  legacyMainFileId?: string,
  legacyFocusedFileId?: string,
): ProjectManifestWorkspaceState => {
  const rawWorkspace = isRecord(candidate) ? candidate : {};
  const openFileIds = Array.isArray(rawWorkspace.openFileIds)
    ? rawWorkspace.openFileIds.filter((entry): entry is string => typeof entry === 'string')
    : [];
  const focusedFileId =
    typeof rawWorkspace.focusedFileId === 'string'
      ? rawWorkspace.focusedFileId
      : legacyFocusedFileId;
  const mainFileId =
    typeof rawWorkspace.mainFileId === 'string' ? rawWorkspace.mainFileId : legacyMainFileId;
  return normalizeWorkspaceState(files, {
    openFileIds,
    focusedFileId,
    mainFileId,
    fileListCollapsed: rawWorkspace.fileListCollapsed === true,
  });
};

export const sanitizeNumberArray = (value: unknown): number[] => {
  if (!Array.isArray(value)) return [];
  return value.filter(
    (entry): entry is number => typeof entry === 'number' && Number.isFinite(entry),
  );
};

export const sanitizeClusterApprovedMerges = (value: unknown): ClusterApprovedMerge[] => {
  if (!Array.isArray(value)) return [];
  return value
    .map((entry) => {
      if (!isRecord(entry)) return null;
      const aliasId = typeof entry.aliasId === 'string' ? entry.aliasId.trim() : '';
      const canonicalId = typeof entry.canonicalId === 'string' ? entry.canonicalId.trim() : '';
      if (!aliasId || !canonicalId || aliasId === canonicalId) return null;
      return { aliasId, canonicalId };
    })
    .filter((entry): entry is ClusterApprovedMerge => entry != null)
    .sort(
      (a, b) =>
        a.canonicalId.localeCompare(b.canonicalId, undefined, { numeric: true }) ||
        a.aliasId.localeCompare(b.aliasId, undefined, { numeric: true }),
    );
};

export const sanitizeObservationOverrides = (
  value: unknown,
): Record<number, ObservationOverride> => {
  if (!isRecord(value)) return {};
  const next: Record<number, ObservationOverride> = {};
  Object.entries(value).forEach(([rawObservationId, rawOverride]) => {
    const observationId = Number.parseInt(rawObservationId, 10);
    if (!Number.isFinite(observationId) || !isRecord(rawOverride)) return;
    const nextOverride: ObservationOverride = {};
    if (typeof rawOverride.stdDev === 'number' && Number.isFinite(rawOverride.stdDev)) {
      nextOverride.stdDev = rawOverride.stdDev;
    }
    if (typeof rawOverride.obs === 'number' && Number.isFinite(rawOverride.obs)) {
      nextOverride.obs = rawOverride.obs;
    } else if (isRecord(rawOverride.obs)) {
      const dE =
        typeof rawOverride.obs.dE === 'number' && Number.isFinite(rawOverride.obs.dE)
          ? rawOverride.obs.dE
          : null;
      const dN =
        typeof rawOverride.obs.dN === 'number' && Number.isFinite(rawOverride.obs.dN)
          ? rawOverride.obs.dN
          : null;
      if (dE != null && dN != null) {
        nextOverride.obs = { dE, dN };
      }
    }
    if (nextOverride.obs != null || nextOverride.stdDev != null) {
      next[observationId] = nextOverride;
    }
  });
  return next;
};
