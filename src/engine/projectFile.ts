import type {
  AdjustedPointsExportSettings,
  CustomLevelLoopTolerancePreset,
  Instrument,
  InstrumentLibrary,
  ProjectExportFormat,
  ParseCompatibilityMode,
  WebNetProjectFileV3,
} from '../types';
import {
  DEFAULT_ADJUSTED_POINTS_EXPORT_SETTINGS,
  sanitizeAdjustedPointsExportSettings,
} from './adjustedPointsExport';

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
  schemaVersion?: 1 | 2 | 3;
  input: string;
  includeFiles: Record<string, string>;
  ui: {
    settings: Record<string, unknown>;
    parseSettings: Record<string, unknown>;
    exportFormat: ProjectExportFormat;
    adjustedPointsExport: AdjustedPointsExportSettings;
    migration?: {
      parseModeMigrated: boolean;
      migratedAt?: string;
    };
  };
  project: {
    projectInstruments: InstrumentLibrary;
    selectedInstrument: string;
    levelLoopCustomPresets: CustomLevelLoopTolerancePreset[];
  };
}

export type ParseProjectFileResult =
  | { ok: true; project: ParsedProjectPayload }
  | { ok: false; errors: string[] };

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value != null && !Array.isArray(value);

const cloneRecord = (value: Record<string, unknown>): Record<string, unknown> => ({ ...value });

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
  if (value === 'webnet' || value === 'industry-style' || value === 'landxml') return value;
  return fallback;
};

const sanitizeParseCompatibilityMode = (value: unknown): ParseCompatibilityMode | undefined => {
  if (value === 'legacy' || value === 'strict') return value;
  return undefined;
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

export const serializeProjectFile = (project: ParsedProjectPayload): string => {
  const nowIso = new Date().toISOString();
  const parseSettings = cloneRecord(project.ui.parseSettings);
  const modeFromSettings = sanitizeParseCompatibilityMode(parseSettings.parseCompatibilityMode);
  const migratedFromSettings =
    typeof parseSettings.parseModeMigrated === 'boolean'
      ? parseSettings.parseModeMigrated
      : undefined;
  const parseModeMigrated = migratedFromSettings ?? modeFromSettings === 'strict';
  const parseCompatibilityMode: ParseCompatibilityMode =
    modeFromSettings ?? (parseModeMigrated ? 'strict' : 'legacy');
  parseSettings.parseCompatibilityMode = parseCompatibilityMode;
  parseSettings.parseModeMigrated = parseModeMigrated;
  const payload: WebNetProjectFileV3 = {
    kind: 'webnet-project',
    schemaVersion: 3,
    savedAt: nowIso,
    mainInput: project.input,
    includeFiles: sanitizeIncludeFiles(project.includeFiles),
    ui: {
      settings: cloneRecord(project.ui.settings),
      parseSettings,
      exportFormat: project.ui.exportFormat,
      adjustedPointsExport: sanitizeAdjustedPointsExportSettings(
        project.ui.adjustedPointsExport,
        DEFAULT_ADJUSTED_POINTS_EXPORT_SETTINGS,
      ),
      migration: {
        parseModeMigrated,
        migratedAt: parseModeMigrated ? nowIso : undefined,
      },
    },
    project: {
      projectInstruments: cloneInstruments(project.project.projectInstruments),
      selectedInstrument: project.project.selectedInstrument,
      levelLoopCustomPresets: project.project.levelLoopCustomPresets.map((preset) => ({
        ...preset,
      })),
    },
  };
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
  const schemaVersion: 1 | 2 | 3 = schemaVersionRaw === 3 ? 3 : schemaVersionRaw === 2 ? 2 : 1;
  if (schemaVersionRaw !== 1 && schemaVersionRaw !== 2 && schemaVersionRaw !== 3) {
    errors.push('Project file schemaVersion is unsupported (expected 1, 2, or 3).');
  }
  if (errors.length > 0) return { ok: false, errors };

  const input =
    schemaVersion === 3
      ? typeof parsed.mainInput === 'string'
        ? parsed.mainInput
        : ''
      : typeof parsed.input === 'string'
        ? parsed.input
        : '';
  const includeFiles = schemaVersion === 3 ? sanitizeIncludeFiles(parsed.includeFiles) : {};
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
  const migrationFlagFromUi =
    typeof uiMigration.parseModeMigrated === 'boolean' ? uiMigration.parseModeMigrated : undefined;
  const modeFromRaw = sanitizeParseCompatibilityMode(parseSettingsRaw.parseCompatibilityMode);
  const migratedFromRaw =
    typeof parseSettingsRaw.parseModeMigrated === 'boolean'
      ? parseSettingsRaw.parseModeMigrated
      : undefined;

  if (schemaVersion === 1) {
    parseSettings.parseCompatibilityMode = 'legacy';
    parseSettings.parseModeMigrated = false;
  } else {
    const parseModeMigrated = migratedFromRaw ?? migrationFlagFromUi ?? false;
    parseSettings.parseModeMigrated = parseModeMigrated;
    parseSettings.parseCompatibilityMode = modeFromRaw ?? (parseModeMigrated ? 'strict' : 'legacy');
  }

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
      schemaVersion,
      input,
      includeFiles,
      ui: {
        settings,
        parseSettings,
        exportFormat,
        adjustedPointsExport,
        migration: {
          parseModeMigrated: Boolean(parseSettings.parseModeMigrated),
          migratedAt,
        },
      },
      project: {
        projectInstruments,
        selectedInstrument,
        levelLoopCustomPresets,
      },
    },
  };
};
