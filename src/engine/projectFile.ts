import type {
  AdjustedPointsExportSettings,
  AdjustmentResult,
  ClusterApprovedMerge,
  CustomLevelLoopTolerancePreset,
  Instrument,
  InstrumentLibrary,
  ObservationOverride,
  ProjectExportFormat,
} from '../types';
import type { PersistedSavedRunSnapshot } from '../appStateTypes';
import {
  DEFAULT_ADJUSTED_POINTS_EXPORT_SETTINGS,
  sanitizeAdjustedPointsExportSettings,
} from './adjustedPointsExport';
import { normalizeListingSortObservationsBy } from '../listingSortObservations';
import {
  buildProjectFileStoragePath,
  createManifestFromFlatProject,
  createProjectManifest,
  createPortableProjectFile,
  createProjectFileId,
  normalizeProjectFileKind,
  normalizeWorkspaceState,
  type ProjectManifestFileEntry,
  type ProjectManifestWorkspaceState,
  type WebNetPortableProjectFileV5,
} from './projectWorkspace';
import {
  buildRunSnapshotSummary,
  buildValueFingerprint,
  cloneSavedRunSnapshots,
} from './qaWorkflow';

export interface ProjectFileDefaults {
  settings: Record<string, unknown>;
  parseSettings: Record<string, unknown>;
  exportFormat: ProjectExportFormat;
  adjustedPointsExport: AdjustedPointsExportSettings;
  projectInstruments: InstrumentLibrary;
  selectedInstrument: string;
  levelLoopCustomPresets: CustomLevelLoopTolerancePreset[];
}

export interface ParsedProjectPayload {
  schemaVersion?: 5;
  input: string;
  includeFiles: Record<string, string>;
  workspaceFileContents?: Record<string, string>;
  savedRuns: PersistedSavedRunSnapshot[];
  ui: {
    settings: Record<string, unknown>;
    parseSettings: Record<string, unknown>;
    exportFormat: ProjectExportFormat;
    adjustedPointsExport: AdjustedPointsExportSettings;
    migration?: {
      parseModeMigrated: boolean;
      migratedAt?: string;
      listingSortModeVersion?: number;
    };
  };
  project: {
    projectInstruments: InstrumentLibrary;
    selectedInstrument: string;
    levelLoopCustomPresets: CustomLevelLoopTolerancePreset[];
  };
  workspace?: {
    projectId: string;
    name: string;
    createdAt: string;
    updatedAt: string;
    files: ProjectManifestFileEntry[];
    openFileIds: string[];
    focusedFileId?: string;
    mainFileId?: string;
  };
}

export type ParseProjectFileResult =
  | { ok: true; project: ParsedProjectPayload }
  | { ok: false; errors: string[] };

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value != null && !Array.isArray(value);

const cloneRecord = (value: Record<string, unknown>): Record<string, unknown> => ({ ...value });

const normalizeRetiredParseSettings = (parseSettings: Record<string, unknown>): void => {
  parseSettings.solveProfile = 'industry-parity';
  parseSettings.parseCompatibilityMode = 'strict';
  parseSettings.parseModeMigrated = true;
  parseSettings.crsTransformEnabled = false;
  parseSettings.crsProjectionModel = 'legacy-equirectangular';
  parseSettings.crsLabel = '';
};

const cloneInstruments = (library: InstrumentLibrary): InstrumentLibrary => {
  const next: InstrumentLibrary = {};
  Object.entries(library).forEach(([code, inst]) => {
    next[code] = { ...inst };
  });
  return next;
};

const mergeKnownKeys = (
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

const sanitizeInstrumentLibrary = (
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

const sanitizeCustomPresets = (
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

const sanitizeExportFormat = (
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

const sanitizeIncludeFiles = (value: unknown): Record<string, string> => {
  if (!isRecord(value)) return {};
  const next: Record<string, string> = {};
  Object.entries(value).forEach(([key, raw]) => {
    if (!key.trim() || typeof raw !== 'string') return;
    next[key] = raw;
  });
  return next;
};

const sanitizePortableProjectFiles = (
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
      typeof entry.order === 'number' && Number.isFinite(entry.order) ? Math.floor(entry.order) : index;
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
        typeof entry.size === 'number' && Number.isFinite(entry.size) ? Math.max(0, entry.size) : text.length,
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

const sanitizePortableFileContents = (value: unknown): Record<string, string> => {
  if (!isRecord(value)) return {};
  const next: Record<string, string> = {};
  Object.entries(value).forEach(([key, raw]) => {
    if (!key.trim() || typeof raw !== 'string') return;
    next[key] = raw;
  });
  return next;
};

const sanitizeWorkspaceState = (
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

const sanitizeNumberArray = (value: unknown): number[] => {
  if (!Array.isArray(value)) return [];
  return value.filter((entry): entry is number => typeof entry === 'number' && Number.isFinite(entry));
};

const sanitizeClusterApprovedMerges = (value: unknown): ClusterApprovedMerge[] => {
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

const sanitizeObservationOverrides = (value: unknown): Record<number, ObservationOverride> => {
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

const sanitizeSavedRunWorkspaceState = (
  value: unknown,
): PersistedSavedRunSnapshot['reopenState'] => {
  if (!isRecord(value) || !isRecord(value.review) || !isRecord(value.review.reportView)) {
    return null;
  }
  const review = value.review;
  const reportView = isRecord(review.reportView) ? review.reportView : {};
  const selection = isRecord(review.selection) ? review.selection : {};
  const comparisonSelection = isRecord(value.comparisonSelection) ? value.comparisonSelection : {};
  const tableRowLimits: Record<string, number> = {};
  if (isRecord(reportView.tableRowLimits)) {
    Object.entries(reportView.tableRowLimits).forEach(([key, rawLimit]) => {
      if (!key.trim() || typeof rawLimit !== 'number' || !Number.isFinite(rawLimit)) return;
      tableRowLimits[key] = Math.max(0, Math.floor(rawLimit));
    });
  }
  const pinnedDetailSections = Array.isArray(reportView.pinnedDetailSections)
    ? reportView.pinnedDetailSections
        .map((entry: unknown) => {
          if (!isRecord(entry)) return null;
          const id = typeof entry.id === 'string' ? entry.id.trim() : '';
          const label = typeof entry.label === 'string' ? entry.label : '';
          if (!id) return null;
          return { id, label };
        })
        .filter((entry: { id: string; label: string } | null): entry is { id: string; label: string } => entry != null)
    : [];
  const collapsedDetailSections: Record<string, boolean> = {};
  if (isRecord(reportView.collapsedDetailSections)) {
    Object.entries(reportView.collapsedDetailSections).forEach(([key, rawCollapsed]) => {
      if (!key.trim() || typeof rawCollapsed !== 'boolean') return;
      collapsedDetailSections[key] = rawCollapsed;
    });
  }
  const pinnedObservationIds = Array.isArray(review.pinnedObservationIds)
    ? review.pinnedObservationIds.filter(
        (entry): entry is number => typeof entry === 'number' && Number.isFinite(entry),
      )
    : [];
  return {
    activeTab:
      value.activeTab === 'processing-summary' ||
      value.activeTab === 'industry-output' ||
      value.activeTab === 'map'
        ? value.activeTab
        : 'report',
    review: {
      reportView: {
        ellipseMode: reportView.ellipseMode === '95' ? '95' : '1sigma',
        reportFilterQuery:
          typeof reportView.reportFilterQuery === 'string' ? reportView.reportFilterQuery : '',
        reportObservationTypeFilter:
          typeof reportView.reportObservationTypeFilter === 'string'
            ? reportView.reportObservationTypeFilter
            : 'all',
        reportExclusionFilter:
          reportView.reportExclusionFilter === 'included' ||
          reportView.reportExclusionFilter === 'excluded'
            ? reportView.reportExclusionFilter
            : 'all',
        tableRowLimits,
        pinnedDetailSections,
        collapsedDetailSections,
      },
      selection: {
        stationId: typeof selection.stationId === 'string' ? selection.stationId : null,
        observationId:
          typeof selection.observationId === 'number' && Number.isFinite(selection.observationId)
            ? selection.observationId
            : null,
        sourceLine:
          typeof selection.sourceLine === 'number' && Number.isFinite(selection.sourceLine)
            ? selection.sourceLine
            : null,
        origin:
          selection.origin === 'report' ||
          selection.origin === 'map' ||
          selection.origin === 'suspect' ||
          selection.origin === 'compare'
            ? selection.origin
            : null,
      },
      pinnedObservationIds,
    },
    comparisonSelection: {
      baselineRunId:
        typeof comparisonSelection.baselineRunId === 'string'
          ? comparisonSelection.baselineRunId
          : null,
      pinnedBaselineRunId:
        typeof comparisonSelection.pinnedBaselineRunId === 'string'
          ? comparisonSelection.pinnedBaselineRunId
          : null,
      stationMovementThreshold:
        typeof comparisonSelection.stationMovementThreshold === 'number' &&
        Number.isFinite(comparisonSelection.stationMovementThreshold)
          ? comparisonSelection.stationMovementThreshold
          : 0.001,
      residualDeltaThreshold:
        typeof comparisonSelection.residualDeltaThreshold === 'number' &&
        Number.isFinite(comparisonSelection.residualDeltaThreshold)
          ? comparisonSelection.residualDeltaThreshold
          : 0.25,
    },
  };
};

const sanitizeSavedRunSnapshots = (value: unknown): PersistedSavedRunSnapshot[] => {
  if (!Array.isArray(value)) return [];
  const rows: PersistedSavedRunSnapshot[] = [];
  value.forEach((entry, index) => {
    if (!isRecord(entry) || !isRecord(entry.result)) return;
    const result = entry.result as unknown as AdjustmentResult;
    const summaryFallback = buildRunSnapshotSummary(result);
    const id =
      typeof entry.id === 'string' && entry.id.trim() ? entry.id.trim() : `saved-run-${index + 1}`;
    const sourceRunId =
      typeof entry.sourceRunId === 'string' && entry.sourceRunId.trim()
        ? entry.sourceRunId.trim()
        : id;
    const createdAt =
      typeof entry.createdAt === 'string' && entry.createdAt.trim()
        ? entry.createdAt.trim()
        : new Date(0).toISOString();
    const savedAt =
      typeof entry.savedAt === 'string' && entry.savedAt.trim() ? entry.savedAt.trim() : createdAt;
    const label =
      typeof entry.label === 'string' && entry.label.trim()
        ? entry.label.trim()
        : `Saved Run ${String(index + 1).padStart(2, '0')}`;
    const notes = typeof entry.notes === 'string' ? entry.notes : '';
    const settingsSnapshot = isRecord(entry.settingsSnapshot)
      ? ({
          ...(entry.settingsSnapshot as PersistedSavedRunSnapshot['settingsSnapshot']),
          precisionReportingMode: 'industry-standard',
          solveProfile: 'industry-parity',
          parseCompatibilityMode: 'strict',
          parseModeMigrated: true,
        } as PersistedSavedRunSnapshot['settingsSnapshot'])
      : ({} as PersistedSavedRunSnapshot['settingsSnapshot']);
    const summarySource = isRecord(entry.summary) ? entry.summary : {};
    rows.push({
      id,
      sourceRunId,
      createdAt,
      savedAt,
      label,
      notes,
      inputFingerprint:
        typeof entry.inputFingerprint === 'string' && entry.inputFingerprint.trim()
          ? entry.inputFingerprint.trim()
          : `legacy:${index + 1}`,
      settingsFingerprint:
        typeof entry.settingsFingerprint === 'string' && entry.settingsFingerprint.trim()
          ? entry.settingsFingerprint.trim()
          : buildValueFingerprint(settingsSnapshot),
      summary: {
        converged:
          typeof summarySource.converged === 'boolean'
            ? summarySource.converged
            : summaryFallback.converged,
        iterations:
          typeof summarySource.iterations === 'number' && Number.isFinite(summarySource.iterations)
            ? summarySource.iterations
            : summaryFallback.iterations,
        seuw:
          typeof summarySource.seuw === 'number' && Number.isFinite(summarySource.seuw)
            ? summarySource.seuw
            : summaryFallback.seuw,
        dof:
          typeof summarySource.dof === 'number' && Number.isFinite(summarySource.dof)
            ? summarySource.dof
            : summaryFallback.dof,
        stationCount:
          typeof summarySource.stationCount === 'number' &&
          Number.isFinite(summarySource.stationCount)
            ? summarySource.stationCount
            : summaryFallback.stationCount,
        observationCount:
          typeof summarySource.observationCount === 'number' &&
          Number.isFinite(summarySource.observationCount)
            ? summarySource.observationCount
            : summaryFallback.observationCount,
        suspectObservationCount:
          typeof summarySource.suspectObservationCount === 'number' &&
          Number.isFinite(summarySource.suspectObservationCount)
            ? summarySource.suspectObservationCount
            : summaryFallback.suspectObservationCount,
        maxAbsStdRes:
          typeof summarySource.maxAbsStdRes === 'number' &&
          Number.isFinite(summarySource.maxAbsStdRes)
            ? summarySource.maxAbsStdRes
            : summaryFallback.maxAbsStdRes,
      },
      result,
      runDiagnostics: (entry.runDiagnostics ?? null) as PersistedSavedRunSnapshot['runDiagnostics'],
      settingsSnapshot,
      excludedIds: sanitizeNumberArray(entry.excludedIds).sort((a, b) => a - b),
      overrideIds: sanitizeNumberArray(entry.overrideIds).sort((a, b) => a - b),
      overrides: sanitizeObservationOverrides(entry.overrides),
      approvedClusterMerges: sanitizeClusterApprovedMerges(entry.approvedClusterMerges),
      reopenState: sanitizeSavedRunWorkspaceState(entry.reopenState),
    });
  });
  return cloneSavedRunSnapshots(rows);
};

export const serializeProjectFile = (project: ParsedProjectPayload): string => {
  const nowIso = new Date().toISOString();
  const parseSettings = cloneRecord(project.ui.parseSettings);
  normalizeRetiredParseSettings(parseSettings);
  const settings = cloneRecord(project.ui.settings);
  settings.precisionReportingMode = 'industry-standard';
  settings.listingSortObservationsBy = normalizeListingSortObservationsBy(
    settings.listingSortObservationsBy,
  );
  const manifestSeed = createManifestFromFlatProject({
    projectId: project.workspace?.projectId,
    name: project.workspace?.name ?? `WebNet Project ${nowIso.slice(0, 10)}`,
    createdAt: project.workspace?.createdAt ?? nowIso,
    updatedAt: nowIso,
    input: project.input,
    includeFiles: sanitizeIncludeFiles(project.includeFiles),
    ui: {
      settings,
      parseSettings,
      exportFormat: project.ui.exportFormat,
      adjustedPointsExport: sanitizeAdjustedPointsExportSettings(
        project.ui.adjustedPointsExport,
        DEFAULT_ADJUSTED_POINTS_EXPORT_SETTINGS,
      ),
      migration: {
        parseModeMigrated: true,
        migratedAt: nowIso,
        listingSortModeVersion: 2,
      },
    },
    project: {
      projectInstruments: cloneInstruments(project.project.projectInstruments),
      selectedInstrument: project.project.selectedInstrument,
      levelLoopCustomPresets: project.project.levelLoopCustomPresets.map((preset) => ({
        ...preset,
      })),
    },
    preferredFocusedFileId: project.workspace?.focusedFileId,
  });
  const manifest =
    project.workspace?.files && project.workspace.files.length > 0
      ? createProjectManifest({
          projectId: project.workspace.projectId,
          name: project.workspace.name,
          createdAt: project.workspace.createdAt,
          updatedAt: nowIso,
          files: project.workspace.files,
          ui: manifestSeed.manifest.ui,
          project: manifestSeed.manifest.project,
          workspace: sanitizeWorkspaceState(project.workspace, project.workspace.files, project.workspace.mainFileId, project.workspace.focusedFileId),
        })
      : manifestSeed.manifest;
  const focusedFileId = manifest.workspace?.focusedFileId;
  const portableSourceTexts =
    project.workspace?.files && project.workspace.files.length > 0
      ? Object.fromEntries(
          project.workspace.files.map((file) => [
            file.id,
            file.id === focusedFileId
              ? project.input
              : project.workspaceFileContents?.[file.id] ??
                project.includeFiles[file.name] ??
                manifestSeed.sourceTexts[file.id] ??
                '',
          ]),
        )
      : manifestSeed.sourceTexts;
  const payload: WebNetPortableProjectFileV5 = createPortableProjectFile({
    manifest,
    sourceTexts: portableSourceTexts,
    savedRuns:
      project.savedRuns.length > 0 ? cloneSavedRunSnapshots(project.savedRuns) : undefined,
  });
  return JSON.stringify(payload, null, 2);
};

export const parseProjectFile = (
  jsonText: string,
  defaults: ProjectFileDefaults,
): ParseProjectFileResult => {
  const errors: string[] = [];
  let parsed: unknown;
  try {
    parsed = JSON.parse(jsonText);
  } catch {
    return { ok: false, errors: ['Project file is not valid JSON.'] };
  }
  if (!isRecord(parsed)) {
    return { ok: false, errors: ['Project file root must be an object.'] };
  }
  if (parsed.kind !== 'webnet-project') {
    errors.push('Project file kind is invalid (expected "webnet-project").');
  }
  const schemaVersionRaw = parsed.schemaVersion;
  const rawSchemaVersion: 1 | 2 | 3 | 4 | 5 =
    schemaVersionRaw === 5
      ? 5
      : schemaVersionRaw === 4
        ? 4
        : schemaVersionRaw === 3
          ? 3
          : schemaVersionRaw === 2
            ? 2
            : 1;
  if (
    schemaVersionRaw !== 1 &&
    schemaVersionRaw !== 2 &&
    schemaVersionRaw !== 3 &&
    schemaVersionRaw !== 4 &&
    schemaVersionRaw !== 5
  ) {
    errors.push('Project file schemaVersion is unsupported (expected 1, 2, 3, 4, or 5).');
  }
  if (errors.length > 0) return { ok: false, errors };

  const fileContents = rawSchemaVersion >= 4 ? sanitizePortableFileContents(parsed.fileContents) : {};
  const workspaceFiles =
    rawSchemaVersion >= 4 ? sanitizePortableProjectFiles(parsed.files, fileContents) : [];
  const workspaceState =
    rawSchemaVersion >= 4
      ? sanitizeWorkspaceState(
          parsed.workspace,
          workspaceFiles,
          typeof parsed.mainFileId === 'string' ? parsed.mainFileId : undefined,
          isRecord(parsed.workspace) && typeof parsed.workspace.activeFileId === 'string'
            ? parsed.workspace.activeFileId
            : undefined,
        )
      : undefined;
  const focusedWorkspaceFile =
    rawSchemaVersion >= 4
      ? workspaceFiles.find((file) => file.id === workspaceState?.focusedFileId) ??
        workspaceFiles.find((file) => file.id === workspaceState?.mainFileId) ??
        workspaceFiles[0]
      : null;
  const input =
    rawSchemaVersion >= 4
      ? focusedWorkspaceFile
        ? fileContents[focusedWorkspaceFile.id] ?? ''
        : typeof parsed.mainInput === 'string'
          ? parsed.mainInput
          : ''
      : rawSchemaVersion === 3
        ? typeof parsed.mainInput === 'string'
          ? parsed.mainInput
          : ''
        : typeof parsed.input === 'string'
          ? parsed.input
          : '';
  const includeFiles =
    rawSchemaVersion >= 4
      ? Object.fromEntries(
          workspaceFiles
            .filter((file) => !focusedWorkspaceFile || file.id !== focusedWorkspaceFile.id)
            .map((file) => [file.name, fileContents[file.id] ?? '']),
        )
      : rawSchemaVersion === 3
        ? sanitizeIncludeFiles(parsed.includeFiles)
        : {};
  const savedRuns =
    rawSchemaVersion >= 3 ? sanitizeSavedRunSnapshots(parsed.savedRuns) : [];
  const ui = isRecord(parsed.ui) ? parsed.ui : {};
  const project = isRecord(parsed.project) ? parsed.project : {};
  const parseSettingsRaw = isRecord(ui.parseSettings) ? ui.parseSettings : {};

  const settings = mergeKnownKeys(defaults.settings, ui.settings);
  const parseSettings = mergeKnownKeys(defaults.parseSettings, parseSettingsRaw);
  const exportFormat = sanitizeExportFormat(ui.exportFormat, defaults.exportFormat);
  const adjustedPointsExport = sanitizeAdjustedPointsExportSettings(
    ui.adjustedPointsExport,
    defaults.adjustedPointsExport,
  );
  const uiMigration = isRecord(ui.migration) ? ui.migration : {};
  const migratedAt =
    typeof uiMigration.migratedAt === 'string' && uiMigration.migratedAt.trim().length > 0
      ? uiMigration.migratedAt.trim()
      : undefined;
  const listingSortModeVersion =
    typeof uiMigration.listingSortModeVersion === 'number' &&
    Number.isFinite(uiMigration.listingSortModeVersion)
      ? Math.max(1, Math.floor(uiMigration.listingSortModeVersion))
      : 1;
  normalizeRetiredParseSettings(parseSettings);
  settings.precisionReportingMode = 'industry-standard';
  settings.listingSortObservationsBy = normalizeListingSortObservationsBy(
    settings.listingSortObservationsBy,
    { legacyResidualMeansStdResidual: listingSortModeVersion < 2 },
  );

  const projectInstruments = sanitizeInstrumentLibrary(
    project.projectInstruments,
    defaults.projectInstruments,
  );
  const selectedInstrumentRaw =
    typeof project.selectedInstrument === 'string' ? project.selectedInstrument.trim() : '';
  const selectedInstrument =
    selectedInstrumentRaw && projectInstruments[selectedInstrumentRaw]
      ? selectedInstrumentRaw
      : projectInstruments[defaults.selectedInstrument]
        ? defaults.selectedInstrument
        : (Object.keys(projectInstruments)[0] ?? defaults.selectedInstrument);
  const levelLoopCustomPresets = sanitizeCustomPresets(
    project.levelLoopCustomPresets,
    defaults.levelLoopCustomPresets,
  );

  return {
    ok: true,
    project: {
      schemaVersion: 5,
      input,
      includeFiles,
      workspaceFileContents:
        rawSchemaVersion >= 4
          ? Object.fromEntries(workspaceFiles.map((file) => [file.id, fileContents[file.id] ?? '']))
          : undefined,
      savedRuns,
      ui: {
        settings,
        parseSettings,
        exportFormat,
        adjustedPointsExport,
        migration: {
          parseModeMigrated: true,
          migratedAt,
          listingSortModeVersion,
        },
      },
      project: {
        projectInstruments,
        selectedInstrument,
        levelLoopCustomPresets,
      },
      workspace:
        rawSchemaVersion >= 4
          ? {
              projectId:
                typeof parsed.projectId === 'string' && parsed.projectId.trim().length > 0
                  ? parsed.projectId.trim()
                  : createProjectFileId(),
              name:
                typeof parsed.name === 'string' && parsed.name.trim().length > 0
                  ? parsed.name.trim()
                  : 'Imported Project',
              createdAt:
                typeof parsed.createdAt === 'string' && parsed.createdAt.trim().length > 0
                  ? parsed.createdAt.trim()
                  : new Date(0).toISOString(),
              updatedAt:
                typeof parsed.updatedAt === 'string' && parsed.updatedAt.trim().length > 0
                  ? parsed.updatedAt.trim()
                  : new Date(0).toISOString(),
              files: workspaceFiles,
              openFileIds: workspaceState?.openFileIds ?? [],
              focusedFileId: workspaceState?.focusedFileId,
              mainFileId: workspaceState?.mainFileId,
            }
          : undefined,
    },
  };
};
