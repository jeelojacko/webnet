import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ChangeEvent,
  type Dispatch,
  type RefObject,
  type SetStateAction,
} from 'react';
import {
  parseProjectFile,
  serializeProjectFile,
  type ParsedProjectPayload,
} from '../engine/projectFile';
import {
  DEFAULT_ADJUSTED_POINTS_EXPORT_SETTINGS,
  cloneAdjustedPointsExportSettings,
  sanitizeAdjustedPointsExportSettings,
} from '../engine/adjustedPointsExport';
import {
  buildProjectBundleBytes,
  parseProjectBundleBytes,
} from '../engine/projectBundle';
import {
  buildProjectEditorIncludeFiles,
  buildProjectLegacyIncludeFiles,
  buildProjectLegacySolveInput,
  buildProjectRunFiles,
  cloneProjectSessionState,
  createManifestFromFlatProject,
  createProjectManifest,
  createProjectId,
  createManifestEntry,
  getProjectFocusedFile,
  normalizeWorkspaceState,
  type ProjectIndexRow,
  type ProjectManifestWorkspaceState,
  type ProjectRunFile,
  type ProjectSessionState,
  type ProjectStorageStatus,
  type ProjectSourceFileKind,
} from '../engine/projectWorkspace';
import { CANADA_CRS_CATALOG, DEFAULT_CANADA_CRS_ID } from '../engine/crsCatalog';
import {
  buildProjectIndexRow,
  buildSavedSessionForStorage,
  createProjectStorage,
  requestPersistentStorage,
  touchProjectIndexRow,
} from '../engine/projectStorage';
import type {
  ParseSettings,
  PersistedSavedRunSnapshot,
  SettingsState,
  SolveProfile,
} from '../appStateTypes';
import type {
  AdjustedPointsExportSettings,
  CustomLevelLoopTolerancePreset,
  InstrumentLibrary,
  ObservationModeSettings,
  ProjectExportFormat,
  RunMode,
} from '../types';

const PROJECT_IMPORT_FILE_TYPES = [
  {
    description: 'WebNet Project',
    accept: {
      'application/json': ['.wnproj', '.wnproj.json', '.json'],
      'application/zip': ['.zip'],
    },
  },
];

const PROJECT_SOURCE_ACCEPT =
  '.dat,.txt,.sum,.rpt,.xml,.jxl,.jobxml,.htm,.html,.rw5,.cr5,.raw,.dbx,.json';
const ASSOCIATED_PROJECT_SETTINGS_ACCEPT = '.wnproj,.wnproj.json,.json,.snproj';
const PROJECT_AUTOSAVE_DELAY_MS = 60_000;

const readFileAsText = (file: File): Promise<string> =>
  new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onerror = () => reject(reader.error ?? new Error(`Failed to read ${file.name}.`));
    reader.onload = () => resolve(typeof reader.result === 'string' ? reader.result : '');
    reader.readAsText(file);
  });

const readFileAsUint8Array = (file: File): Promise<Uint8Array> =>
  new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onerror = () => reject(reader.error ?? new Error(`Failed to read ${file.name}.`));
    reader.onload = () => {
      if (!(reader.result instanceof ArrayBuffer)) {
        reject(new Error(`Expected binary data for ${file.name}.`));
        return;
      }
      resolve(new Uint8Array(reader.result));
    };
    reader.readAsArrayBuffer(file);
  });

const downloadBlob = (name: string, blob: Blob) => {
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = name;
  anchor.click();
  URL.revokeObjectURL(url);
};

const writeTextDownload = async (name: string, text: string) => {
  const picker = (window as Window & {
    showSaveFilePicker?: (_options: unknown) => Promise<{
      createWritable: () => Promise<{
        write: (_content: string) => Promise<void>;
        close: () => Promise<void>;
      }>;
    }>;
  }).showSaveFilePicker;
  if (picker) {
    try {
      const handle = await picker({
        suggestedName: name,
        types: PROJECT_IMPORT_FILE_TYPES,
      });
      const writable = await handle.createWritable();
      await writable.write(text);
      await writable.close();
      return true;
    } catch (error) {
      if ((error as Error)?.name === 'AbortError') return false;
    }
  }
  downloadBlob(name, new Blob([text], { type: 'application/json' }));
  return true;
};

const writeBinaryDownload = async (name: string, bytes: Uint8Array) => {
  const binaryBuffer = bytes.buffer.slice(
    bytes.byteOffset,
    bytes.byteOffset + bytes.byteLength,
  ) as ArrayBuffer;
  const picker = (window as Window & {
    showSaveFilePicker?: (_options: unknown) => Promise<{
      createWritable: () => Promise<{
        write: (_content: Blob) => Promise<void>;
        close: () => Promise<void>;
      }>;
    }>;
  }).showSaveFilePicker;
  if (picker) {
    try {
      const handle = await picker({
        suggestedName: name,
        types: PROJECT_IMPORT_FILE_TYPES,
      });
      const writable = await handle.createWritable();
      await writable.write(new Blob([binaryBuffer], { type: 'application/zip' }));
      await writable.close();
      return true;
    } catch (error) {
      if ((error as Error)?.name === 'AbortError') return false;
    }
  }
  downloadBlob(name, new Blob([binaryBuffer], { type: 'application/zip' }));
  return true;
};

interface ImportNotice {
  title: string;
  detailLines: string[];
}

export interface PreparedAssociatedProjectSettingsImport {
  sourceName: string;
  payload: ParsedProjectPayload;
  appliedDomains: string[];
  ignoredDomains: string[];
}

interface ApplyPreparedAssociatedProjectSettingsOptions {
  successTitle?: string;
  failureTitle?: string;
  successDetailPrefix?: string[];
  failureDetailPrefix?: string[];
}

export interface ProjectWorkspaceFileView {
  id: string;
  name: string;
  kind: ProjectSourceFileKind;
  order: number;
  tabOrder: number | null;
  isCheckedForRun: boolean;
  isOpenInTab: boolean;
  isFocusedTab: boolean;
  enabled: boolean;
  isActive: boolean;
  isMain: boolean;
}

export interface ProjectRunValidation {
  ok: boolean;
  errors: string[];
  warnings: string[];
}

interface UseProjectFileWorkflowArgs {
  projectFileInputRef: RefObject<HTMLInputElement | null>;
  projectSourceFileInputRef: RefObject<HTMLInputElement | null>;
  input: string;
  projectIncludeFiles: Record<string, string>;
  settings: SettingsState;
  parseSettings: ParseSettings;
  exportFormat: ProjectExportFormat;
  adjustedPointsExportSettings: AdjustedPointsExportSettings;
  savedRunSnapshots: PersistedSavedRunSnapshot[];
  projectInstruments: InstrumentLibrary;
  selectedInstrument: string;
  levelLoopCustomPresets: CustomLevelLoopTolerancePreset[];
  setInput: Dispatch<SetStateAction<string>>;
  setProjectIncludeFiles: Dispatch<SetStateAction<Record<string, string>>>;
  setSettings: Dispatch<SetStateAction<SettingsState>>;
  setParseSettings: Dispatch<SetStateAction<ParseSettings>>;
  setGeoidSourceData: Dispatch<SetStateAction<Uint8Array | null>>;
  setGeoidSourceDataLabel: Dispatch<SetStateAction<string>>;
  setExportFormat: Dispatch<SetStateAction<ProjectExportFormat>>;
  setAdjustedPointsExportSettings: Dispatch<SetStateAction<AdjustedPointsExportSettings>>;
  setProjectInstruments: Dispatch<SetStateAction<InstrumentLibrary>>;
  setSelectedInstrument: Dispatch<SetStateAction<string>>;
  setLevelLoopCustomPresets: Dispatch<SetStateAction<CustomLevelLoopTolerancePreset[]>>;
  setSettingsDraft: Dispatch<SetStateAction<SettingsState>>;
  setParseSettingsDraft: Dispatch<SetStateAction<ParseSettings>>;
  setGeoidSourceDataDraft: Dispatch<SetStateAction<Uint8Array | null>>;
  setGeoidSourceDataLabelDraft: Dispatch<SetStateAction<string>>;
  setProjectInstrumentsDraft: Dispatch<SetStateAction<InstrumentLibrary>>;
  setSelectedInstrumentDraft: Dispatch<SetStateAction<string>>;
  setLevelLoopCustomPresetsDraft: Dispatch<SetStateAction<CustomLevelLoopTolerancePreset[]>>;
  setAdjustedPointsExportSettingsDraft: Dispatch<SetStateAction<AdjustedPointsExportSettings>>;
  setIsAdjustedPointsTransformSelectOpen: Dispatch<SetStateAction<boolean>>;
  setAdjustedPointsTransformSelectedDraft: Dispatch<SetStateAction<string[]>>;
  setImportNotice: Dispatch<SetStateAction<ImportNotice | null>>;
  resetWorkspaceAfterProjectLoad: () => void;
  restoreSavedRunSnapshots: (_snapshots: PersistedSavedRunSnapshot[]) => void;
  normalizeUiTheme: (_value: unknown) => SettingsState['uiTheme'];
  normalizeSolveProfile: (_profile: SolveProfile) => SolveProfile;
  buildObservationModeFromGridFields: (_state: {
    gridBearingMode: ParseSettings['gridBearingMode'];
    gridDistanceMode: ParseSettings['gridDistanceMode'];
    gridAngleMode: ParseSettings['gridAngleMode'];
    gridDirectionMode: ParseSettings['gridDirectionMode'];
  }) => ObservationModeSettings;
  cloneInstrumentLibrary: (_library: InstrumentLibrary) => InstrumentLibrary;
}

const appendUniqueId = (ids: string[], value: string): string[] =>
  ids.includes(value) ? ids : [...ids, value];

const removeFileId = (ids: string[], value: string): string[] => ids.filter((id) => id !== value);

const buildCombinedRunInput = (runFiles: ProjectRunFile[]): string =>
  runFiles.map((file) => file.content).join('\n');

const sortRecentProjectRows = (rows: ProjectIndexRow[]): ProjectIndexRow[] =>
  [...rows].sort(
    (a, b) =>
      b.lastOpenedAt.localeCompare(a.lastOpenedAt) ||
      b.updatedAt.localeCompare(a.updatedAt) ||
      a.name.localeCompare(b.name, undefined, { numeric: true }) ||
      a.id.localeCompare(b.id, undefined, { numeric: true }),
  );

const buildFileNameCopy = (baseName: string, existingNames: Set<string>): string => {
  const dotIndex = baseName.lastIndexOf('.');
  const stem = dotIndex > 0 ? baseName.slice(0, dotIndex) : baseName;
  const ext = dotIndex > 0 ? baseName.slice(dotIndex) : '';
  let candidate = `${stem} copy${ext}`;
  let counter = 2;
  while (existingNames.has(candidate)) {
    candidate = `${stem} copy ${counter}${ext}`;
    counter += 1;
  }
  return candidate;
};

const getImportedProjectSourceName = (fileName: string): string => {
  const trimmed = fileName.trim();
  if (!trimmed) return 'file';
  if (/\.dat$/i.test(trimmed)) {
    const stem = trimmed.replace(/\.dat$/i, '').trim();
    return stem || 'file';
  }
  return trimmed;
};

const buildImportedReviewFileName = (sourceName: string): string => {
  const trimmed = sourceName.trim();
  if (!trimmed) return 'imported.dat';
  if (/\.[^.]+$/.test(trimmed)) return trimmed.replace(/\.[^.]+$/, '.dat');
  return `${trimmed}.dat`;
};

const parseSnprojSections = (rawText: string): Map<string, Map<string, string>> => {
  const sections = new Map<string, Map<string, string>>();
  let currentSection = '';
  rawText.split(/\r?\n/).forEach((rawLine) => {
    const line = rawLine.trim();
    if (!line || line.startsWith('#')) return;
    const sectionMatch = line.match(/^\[(.+)\]$/);
    if (sectionMatch) {
      currentSection = sectionMatch[1]!.trim().toUpperCase();
      if (!sections.has(currentSection)) sections.set(currentSection, new Map());
      return;
    }
    const pairMatch = line.match(/^([A-Za-z0-9_./-]+)\s*(?:=|\s)\s*(.+)$/);
    if (!pairMatch || !currentSection) return;
    sections.get(currentSection)?.set(pairMatch[1]!.trim().toUpperCase(), pairMatch[2]!.trim());
  });
  return sections;
};

const parseSnprojNumber = (value: string | undefined): number | undefined => {
  if (!value) return undefined;
  const numeric = Number.parseFloat(value);
  return Number.isFinite(numeric) ? numeric : undefined;
};

const parseSnprojBoolean = (value: string | undefined): boolean | undefined => {
  if (!value) return undefined;
  const trimmed = value.trim().toUpperCase();
  if (trimmed === '1' || trimmed === 'Y' || trimmed === 'YES' || trimmed === 'TRUE') return true;
  if (trimmed === '0' || trimmed === 'N' || trimmed === 'NO' || trimmed === 'FALSE') return false;
  return undefined;
};

const normalizeCrsLookupToken = (value: string): string =>
  value.toUpperCase().replace(/[^A-Z0-9]/g, '');

const resolveSnprojCrsId = (rawName: string | undefined): string | undefined => {
  const token = rawName?.trim();
  if (!token) return undefined;
  const normalized = normalizeCrsLookupToken(token);
  const utmMatch = normalized.match(/UTM(?:83)?CSRS?(\d{1,2})N/);
  if (utmMatch) return `CA_NAD83_CSRS_UTM_${utmMatch[1]!.padStart(2, '0')}N`;
  const mtmMatch = normalized.match(/MTM(\d{1,2})/);
  if (mtmMatch) return `CA_NAD83_CSRS_MTM_${mtmMatch[1]!.padStart(2, '0')}`;
  const matched = CANADA_CRS_CATALOG.find((row) => {
    const idToken = normalizeCrsLookupToken(row.id);
    const labelToken = normalizeCrsLookupToken(row.label);
    return normalized === idToken || normalized === labelToken || normalized.includes(idToken);
  });
  return matched?.id;
};

const buildSnprojAssociatedSettingsPayload = ({
  rawText,
  sourceName,
  settings,
  parseSettings,
  exportFormat: _exportFormat,
  adjustedPointsExportSettings,
  projectInstruments,
  selectedInstrument,
  levelLoopCustomPresets,
}: {
  rawText: string;
  sourceName: string;
  settings: SettingsState;
  parseSettings: ParseSettings;
  exportFormat: ProjectExportFormat;
  adjustedPointsExportSettings: AdjustedPointsExportSettings;
  projectInstruments: InstrumentLibrary;
  selectedInstrument: string;
  levelLoopCustomPresets: CustomLevelLoopTolerancePreset[];
}): PreparedAssociatedProjectSettingsImport => {
  const sections = parseSnprojSections(rawText);
  const adjustment = sections.get('ADJUSTMENT') ?? new Map<string, string>();
  const listing = sections.get('LISTING') ?? new Map<string, string>();
  const instrument = sections.get('INSTRUMENT') ?? new Map<string, string>();

  const nextSettings: SettingsState = {
    ...settings,
    convergenceLimit:
      parseSnprojNumber(adjustment.get('CONVERGE_LIMIT')) ?? settings.convergenceLimit,
    maxIterations:
      parseSnprojNumber(adjustment.get('MAXIMUM_ITERATIONS')) ?? settings.maxIterations,
    listingShowCoordinates:
      parseSnprojBoolean(listing.get('LIST_COORDINATES')) ?? settings.listingShowCoordinates,
    listingShowObservationsResiduals:
      parseSnprojBoolean(listing.get('LIST_ADJ_OBS_RESIDUALS')) ??
      settings.listingShowObservationsResiduals,
    listingShowErrorPropagation:
      parseSnprojBoolean(listing.get('LIST_STANDARD_DEVIATIONS')) ??
      settings.listingShowErrorPropagation,
    listingShowAzimuthsBearings:
      parseSnprojBoolean(listing.get('LIST_BEARING')) ?? settings.listingShowAzimuthsBearings,
  };

  const nextParseSettings: ParseSettings = {
    ...parseSettings,
    coordMode:
      adjustment.get('ADJUSTMENT_TYPE')?.trim().toUpperCase() === '2D'
        ? '2D'
        : adjustment.get('ADJUSTMENT_TYPE')?.trim().toUpperCase() === '3D'
          ? '3D'
          : parseSettings.coordMode,
    coordSystemMode:
      resolveSnprojCrsId(adjustment.get('COORDINATE_SYSTEM_NAME')) != null ||
      adjustment.get('LOCAL_OR_GRID_ADJUSTMENT')?.trim() === '1'
        ? 'grid'
        : adjustment.get('LOCAL_OR_GRID_ADJUSTMENT')?.trim() === '0'
          ? 'local'
          : parseSettings.coordSystemMode,
    crsId:
      resolveSnprojCrsId(adjustment.get('COORDINATE_SYSTEM_NAME')) ??
      parseSettings.crsId ??
      DEFAULT_CANADA_CRS_ID,
    order:
      adjustment.get('COORDINATE_ORDER')?.trim().toUpperCase() === 'NE'
        ? 'NE'
        : adjustment.get('COORDINATE_ORDER')?.trim().toUpperCase() === 'EN'
          ? 'EN'
          : parseSettings.order,
    deltaMode:
      adjustment.get('3D_INPUT_MODE')?.trim().toUpperCase().includes('SLOPE')
        ? 'slope'
        : adjustment.get('3D_INPUT_MODE')?.trim()
              .toUpperCase()
              .includes('HORIZONTAL')
          ? 'horiz'
          : parseSettings.deltaMode,
    applyCurvatureRefraction:
      parseSnprojNumber(adjustment.get('INDEX_OF_REFRACTION')) != null
        ? true
        : parseSettings.applyCurvatureRefraction,
    refractionCoefficient:
      parseSnprojNumber(adjustment.get('INDEX_OF_REFRACTION')) ??
      parseSettings.refractionCoefficient,
    verticalReduction:
      adjustment.get('ADJUSTMENT_TYPE')?.trim().toUpperCase() === '3D' &&
      adjustment.get('3D_INPUT_MODE')?.trim().toUpperCase().includes('ZENITH') &&
      parseSnprojNumber(adjustment.get('INDEX_OF_REFRACTION')) != null
        ? 'curvref'
        : parseSettings.verticalReduction,
    qFixLinearSigmaM:
      parseSnprojNumber(adjustment.get('FIXED_LINEAR_STD_ERR')) ??
      parseSettings.qFixLinearSigmaM,
    qFixAngularSigmaSec:
      parseSnprojNumber(adjustment.get('FIXED_ANGULAR_STD_ERR')) ??
      parseSettings.qFixAngularSigmaSec,
    averageGeoidHeight:
      parseSnprojNumber(adjustment.get('GEOID_HEIGHT')) ?? parseSettings.averageGeoidHeight,
    verticalDeflectionNorthSec:
      parseSnprojNumber(adjustment.get('VERT_DEFL_NORTH')) ??
      parseSettings.verticalDeflectionNorthSec,
    verticalDeflectionEastSec:
      parseSnprojNumber(adjustment.get('VERT_DEFL_EAST')) ??
      parseSettings.verticalDeflectionEastSec,
  };

  const importedInstrumentCode = 'IMPORTED';
  const importedInstrument = {
    ...(projectInstruments[selectedInstrument] ?? projectInstruments[importedInstrumentCode] ?? {
      code: importedInstrumentCode,
      desc: 'Imported project instrument',
      edm_const: 0,
      edm_ppm: 0,
      hzPrecision_sec: 0,
      dirPrecision_sec: 0,
      azBearingPrecision_sec: 0,
      vaPrecision_sec: 0,
      instCentr_m: 0,
      tgtCentr_m: 0,
      vertCentr_m: 0,
      elevDiff_const_m: 0,
      elevDiff_ppm: 0,
      gpsStd_xy: 0,
      levStd_mmPerKm: 0,
    }),
    code: importedInstrumentCode,
    desc: `Imported project instrument (${sourceName})`,
    edm_const: parseSnprojNumber(instrument.get('DISTANCE_STD_ERR')) ??
      (projectInstruments[selectedInstrument]?.edm_const ?? 0),
    edm_ppm:
      parseSnprojNumber(instrument.get('EDM_PPM')) ??
      (projectInstruments[selectedInstrument]?.edm_ppm ?? 0),
    hzPrecision_sec:
      parseSnprojNumber(instrument.get('ANGLE_STD_ERR')) ??
      (projectInstruments[selectedInstrument]?.hzPrecision_sec ?? 0),
    dirPrecision_sec:
      parseSnprojNumber(instrument.get('DIRECTION_STD_ERR')) ??
      (projectInstruments[selectedInstrument]?.dirPrecision_sec ?? 0),
    azBearingPrecision_sec:
      parseSnprojNumber(instrument.get('AZIMUTH_STD_ERR')) ??
      (projectInstruments[selectedInstrument]?.azBearingPrecision_sec ?? 0),
    vaPrecision_sec:
      parseSnprojNumber(instrument.get('ZENITH_STD_ERR')) ??
      (projectInstruments[selectedInstrument]?.vaPrecision_sec ?? 0),
    instCentr_m:
      parseSnprojNumber(instrument.get('INSTRUMENT_CENTERING_ERROR')) ??
      (projectInstruments[selectedInstrument]?.instCentr_m ?? 0),
    tgtCentr_m:
      parseSnprojNumber(instrument.get('TARGET_CENTERING_ERROR')) ??
      (projectInstruments[selectedInstrument]?.tgtCentr_m ?? 0),
    vertCentr_m:
      parseSnprojNumber(instrument.get('VERTICAL_CENTERING_ERROR')) ??
      (projectInstruments[selectedInstrument]?.vertCentr_m ?? 0),
    elevDiff_const_m:
      parseSnprojNumber(instrument.get('DELTA_ELEV_STD_ERR')) ??
      (projectInstruments[selectedInstrument]?.elevDiff_const_m ?? 0),
    elevDiff_ppm:
      parseSnprojNumber(instrument.get('DELTA_ELEV_PPM')) ??
      (projectInstruments[selectedInstrument]?.elevDiff_ppm ?? 0),
    levStd_mmPerKm:
      parseSnprojNumber(instrument.get('LEVEL_STD_ERR')) ??
      (projectInstruments[selectedInstrument]?.levStd_mmPerKm ?? 0),
  };

  return {
    sourceName,
    payload: {
      schemaVersion: 5,
      input: '',
      includeFiles: {},
      savedRuns: [],
      ui: {
        settings: nextSettings as unknown as Record<string, unknown>,
        parseSettings: nextParseSettings as unknown as Record<string, unknown>,
        exportFormat: 'industry-style',
        adjustedPointsExport: cloneAdjustedPointsExportSettings(adjustedPointsExportSettings),
      },
      project: {
        projectInstruments: {
          ...projectInstruments,
          [importedInstrumentCode]: importedInstrument,
        },
        selectedInstrument: importedInstrumentCode,
        levelLoopCustomPresets: levelLoopCustomPresets.map((preset) => ({ ...preset })),
      },
    },
    appliedDomains: [
      'project settings',
      'parse settings',
      'industry listing options',
      'instrument defaults',
    ],
    ignoredDomains: ['data file list', 'plot settings', 'unsupported industry-only options'],
  };
};

const normalizeSessionWorkspace = (
  current: ProjectSessionState,
): ProjectManifestWorkspaceState => normalizeWorkspaceState(current.manifest.files, current.manifest.workspace);

const resolveNextFocusedFileId = (
  openFileIds: string[],
  removedFileId: string,
  preferredFileIds: string[],
): string | undefined => {
  const remaining = openFileIds.filter((fileId) => fileId !== removedFileId);
  return preferredFileIds.find((fileId) => remaining.includes(fileId)) ?? remaining[0];
};

export const applyPersistedProjectSession = ({
  current,
  saved,
  requestedManifestUpdatedAt,
  completedAt,
}: {
  current: ProjectSessionState | null;
  saved: ProjectSessionState;
  requestedManifestUpdatedAt: string;
  completedAt: string;
}): ProjectSessionState | null => {
  if (!current || current.indexRow.id !== saved.indexRow.id) return current;
  const staleSaveCompleted =
    current.manifest.updatedAt !== requestedManifestUpdatedAt ||
    current.manifestDirty ||
    current.dirtyFileIds.length > 0;
  if (staleSaveCompleted) {
    return {
      ...current,
      indexRow: saved.indexRow,
      autosaveState: 'idle',
      lastAutosavedAt: completedAt,
      lastAutosaveError: null,
    };
  }
  return {
    ...saved,
    dirtyFileIds: [],
    manifestDirty: false,
    autosaveState: 'idle',
    lastAutosavedAt: completedAt,
    lastAutosaveError: null,
  };
};

export const useProjectFileWorkflow = ({
  projectFileInputRef,
  projectSourceFileInputRef,
  input,
  projectIncludeFiles,
  settings,
  parseSettings,
  exportFormat,
  adjustedPointsExportSettings,
  savedRunSnapshots,
  projectInstruments,
  selectedInstrument,
  levelLoopCustomPresets,
  setInput,
  setProjectIncludeFiles,
  setSettings,
  setParseSettings,
  setGeoidSourceData,
  setGeoidSourceDataLabel,
  setExportFormat,
  setAdjustedPointsExportSettings,
  setProjectInstruments,
  setSelectedInstrument,
  setLevelLoopCustomPresets,
  setSettingsDraft,
  setParseSettingsDraft,
  setGeoidSourceDataDraft,
  setGeoidSourceDataLabelDraft,
  setProjectInstrumentsDraft,
  setSelectedInstrumentDraft,
  setLevelLoopCustomPresetsDraft,
  setAdjustedPointsExportSettingsDraft,
  setIsAdjustedPointsTransformSelectOpen,
  setAdjustedPointsTransformSelectedDraft,
  setImportNotice,
  resetWorkspaceAfterProjectLoad,
  restoreSavedRunSnapshots,
  normalizeUiTheme,
  normalizeSolveProfile,
  buildObservationModeFromGridFields,
  cloneInstrumentLibrary,
}: UseProjectFileWorkflowArgs) => {
  const storage = useMemo(() => createProjectStorage(), []);
  const autosaveTimerRef = useRef<number | null>(null);
  const [projectSession, setProjectSession] = useState<ProjectSessionState | null>(null);
  const [recentProjects, setRecentProjects] = useState<ProjectIndexRow[]>([]);
  const [storageStatus, setStorageStatus] = useState<ProjectStorageStatus | null>(null);
  const canUseNamedProjectStorage = Boolean(storageStatus?.hasIndexedDb);

  const upsertRecentProjectRow = useCallback((row: ProjectIndexRow) => {
    setRecentProjects((current) =>
      sortRecentProjectRows([
        row,
        ...current.filter((entry) => entry.id !== row.id),
      ]),
    );
  }, []);

  const removeRecentProjectRow = useCallback((projectId: string) => {
    setRecentProjects((current) => current.filter((entry) => entry.id !== projectId));
  }, []);

  const refreshStorageContext = useCallback(async () => {
    const status = await storage.getStatus();
    setStorageStatus(status);
    try {
      const projects = await storage.listProjects();
      setRecentProjects(projects);
    } catch {
      setRecentProjects([]);
    }
  }, [storage]);

  useEffect(() => {
    void refreshStorageContext();
  }, [refreshStorageContext]);

  const normalizeImportedProjectPayload = useCallback(
    (parsed: ParsedProjectPayload) => {
      const loadedSettings = parsed.ui.settings as unknown as SettingsState;
      const normalizedLoadedSettings: SettingsState = {
        ...loadedSettings,
        precisionReportingMode: 'industry-standard',
        uiTheme: normalizeUiTheme(loadedSettings?.uiTheme),
      };
      const loadedParseSettings = parsed.ui.parseSettings as unknown as ParseSettings;
      const profileForMode = normalizeSolveProfile(
        (loadedParseSettings.solveProfile ?? 'industry-parity') as SolveProfile,
      );
      const normalizedRunMode: RunMode =
        loadedParseSettings.preanalysisMode === true
          ? 'preanalysis'
          : (loadedParseSettings.runMode ?? 'adjustment');
      const normalizedLoadedParseSettings: ParseSettings = {
        ...loadedParseSettings,
        solveProfile: profileForMode,
        runMode: normalizedRunMode,
        preanalysisMode: normalizedRunMode === 'preanalysis',
        suspectImpactMode: loadedParseSettings.suspectImpactMode ?? 'auto',
        ...(loadedParseSettings.observationMode
          ? {
              gridBearingMode: loadedParseSettings.observationMode.bearing,
              gridDistanceMode: loadedParseSettings.observationMode.distance,
              gridAngleMode: loadedParseSettings.observationMode.angle,
              gridDirectionMode: loadedParseSettings.observationMode.direction,
            }
          : {}),
        observationMode:
          loadedParseSettings.observationMode ??
          buildObservationModeFromGridFields(loadedParseSettings),
        parseCompatibilityMode: 'strict',
        faceNormalizationMode: 'on',
        normalize: true,
        parseModeMigrated: true,
        crsTransformEnabled: false,
        crsProjectionModel: 'legacy-equirectangular',
        crsLabel: '',
        geoidSourceFormat: loadedParseSettings.geoidSourceFormat ?? 'builtin',
        geoidSourcePath: loadedParseSettings.geoidSourcePath ?? '',
        verticalDeflectionNorthSec: loadedParseSettings.verticalDeflectionNorthSec ?? 0,
        verticalDeflectionEastSec: loadedParseSettings.verticalDeflectionEastSec ?? 0,
      };
      const loadedAdjustedPointsSettings = sanitizeAdjustedPointsExportSettings(
        parsed.ui.adjustedPointsExport,
        {
          ...DEFAULT_ADJUSTED_POINTS_EXPORT_SETTINGS,
          includeLostStations: normalizedLoadedSettings.listingShowLostStations,
        },
      );
      return {
        normalizedLoadedSettings,
        normalizedLoadedParseSettings,
        loadedAdjustedPointsSettings,
        exportFormat: parsed.ui.exportFormat,
        projectInstruments: cloneInstrumentLibrary(parsed.project.projectInstruments),
        selectedInstrument: parsed.project.selectedInstrument,
        levelLoopCustomPresets: parsed.project.levelLoopCustomPresets.map((preset) => ({
          ...preset,
        })),
      };
    },
    [
      buildObservationModeFromGridFields,
      cloneInstrumentLibrary,
      normalizeSolveProfile,
      normalizeUiTheme,
    ],
  );

  const applyLoadedProjectPayload = useCallback(
    (
      parsed: ParsedProjectPayload,
      nextSession: ProjectSessionState | null,
      savedRuns: PersistedSavedRunSnapshot[],
    ) => {
      const normalized = normalizeImportedProjectPayload(parsed);
      const nextInput =
        nextSession != null
          ? nextSession.sourceTexts[
              getProjectFocusedFile(nextSession.manifest)?.id ??
                normalizeWorkspaceState(
                  nextSession.manifest.files,
                  nextSession.manifest.workspace,
                ).mainFileId ??
                ''
            ] ?? buildProjectLegacySolveInput(nextSession.manifest, nextSession.sourceTexts)
          : parsed.input;

      setInput(nextInput);
      setProjectIncludeFiles(
        nextSession != null
          ? buildProjectEditorIncludeFiles(
              nextSession.manifest,
              nextSession.sourceTexts,
              getProjectFocusedFile(nextSession.manifest)?.id,
            )
          : { ...(parsed.includeFiles ?? {}) },
      );
      setSettings(normalized.normalizedLoadedSettings);
      setParseSettings(normalized.normalizedLoadedParseSettings);
      setGeoidSourceData(null);
      setGeoidSourceDataLabel('');
      setExportFormat(normalized.exportFormat);
      setAdjustedPointsExportSettings(cloneAdjustedPointsExportSettings(normalized.loadedAdjustedPointsSettings));
      restoreSavedRunSnapshots(savedRuns);
      setProjectInstruments(normalized.projectInstruments);
      setSelectedInstrument(normalized.selectedInstrument);
      setLevelLoopCustomPresets(normalized.levelLoopCustomPresets);

      setSettingsDraft(normalized.normalizedLoadedSettings);
      setParseSettingsDraft(normalized.normalizedLoadedParseSettings);
      setGeoidSourceDataDraft(null);
      setGeoidSourceDataLabelDraft('');
      setProjectInstrumentsDraft(cloneInstrumentLibrary(normalized.projectInstruments));
      setSelectedInstrumentDraft(normalized.selectedInstrument);
      setLevelLoopCustomPresetsDraft(
        normalized.levelLoopCustomPresets.map((preset) => ({ ...preset })),
      );
      setAdjustedPointsExportSettingsDraft(cloneAdjustedPointsExportSettings(normalized.loadedAdjustedPointsSettings));
      setIsAdjustedPointsTransformSelectOpen(false);
      setAdjustedPointsTransformSelectedDraft([]);

      resetWorkspaceAfterProjectLoad();
    },
    [
      cloneInstrumentLibrary,
      normalizeImportedProjectPayload,
      resetWorkspaceAfterProjectLoad,
      restoreSavedRunSnapshots,
      setAdjustedPointsExportSettings,
      setAdjustedPointsExportSettingsDraft,
      setAdjustedPointsTransformSelectedDraft,
      setExportFormat,
      setGeoidSourceData,
      setGeoidSourceDataDraft,
      setGeoidSourceDataLabel,
      setGeoidSourceDataLabelDraft,
      setInput,
      setIsAdjustedPointsTransformSelectOpen,
      setLevelLoopCustomPresets,
      setLevelLoopCustomPresetsDraft,
      setParseSettings,
      setParseSettingsDraft,
      setProjectIncludeFiles,
      setProjectInstruments,
      setProjectInstrumentsDraft,
      setSelectedInstrument,
      setSelectedInstrumentDraft,
      setSettings,
      setSettingsDraft,
    ],
  );

  const buildPortablePayload = useCallback(
    (): ParsedProjectPayload => ({
      schemaVersion: 5,
      input: projectSession
        ? projectSession.sourceTexts[getProjectFocusedFile(projectSession.manifest)?.id ?? ''] ?? ''
        : input,
      includeFiles: projectSession
        ? buildProjectEditorIncludeFiles(
            projectSession.manifest,
            projectSession.sourceTexts,
            getProjectFocusedFile(projectSession.manifest)?.id,
          )
        : projectIncludeFiles,
      workspaceFileContents: projectSession ? { ...projectSession.sourceTexts } : undefined,
      savedRuns: savedRunSnapshots,
      ui: {
        settings: settings as unknown as Record<string, unknown>,
        parseSettings: parseSettings as unknown as Record<string, unknown>,
        exportFormat,
        adjustedPointsExport: adjustedPointsExportSettings,
      },
      project: {
        projectInstruments,
        selectedInstrument,
        levelLoopCustomPresets,
      },
      workspace: projectSession
        ? {
            projectId: projectSession.manifest.projectId,
            name: projectSession.manifest.name,
            createdAt: projectSession.manifest.createdAt,
            updatedAt: projectSession.manifest.updatedAt,
            files: projectSession.manifest.files.map((file) => ({ ...file })),
            openFileIds: normalizeWorkspaceState(
              projectSession.manifest.files,
              projectSession.manifest.workspace,
            ).openFileIds,
            focusedFileId: normalizeWorkspaceState(
              projectSession.manifest.files,
              projectSession.manifest.workspace,
            ).focusedFileId,
            mainFileId: normalizeWorkspaceState(
              projectSession.manifest.files,
              projectSession.manifest.workspace,
            ).mainFileId,
          }
        : undefined,
    }),
    [
      adjustedPointsExportSettings,
      exportFormat,
      input,
      levelLoopCustomPresets,
      parseSettings,
      projectIncludeFiles,
      projectInstruments,
      projectSession,
      savedRunSnapshots,
      selectedInstrument,
      settings,
    ],
  );

  const effectiveProjectRunFiles = useMemo(
    () =>
      projectSession
        ? buildProjectRunFiles(projectSession.manifest, projectSession.sourceTexts)
        : [],
    [projectSession],
  );

  const effectiveRunInput = useMemo(
    () =>
      projectSession ? buildCombinedRunInput(effectiveProjectRunFiles) : input,
    [effectiveProjectRunFiles, input, projectSession],
  );

  const effectiveSolveInput = useMemo(
    () =>
      projectSession
        ? buildProjectLegacySolveInput(projectSession.manifest, projectSession.sourceTexts)
        : input,
    [input, projectSession],
  );

  const effectiveSolveIncludeFiles = useMemo(
    () =>
      projectSession
        ? buildProjectLegacyIncludeFiles(projectSession.manifest, projectSession.sourceTexts)
        : projectIncludeFiles,
    [projectIncludeFiles, projectSession],
  );

  const effectiveRunIncludeFiles = useMemo(
    () =>
      projectSession
        ? buildProjectEditorIncludeFiles(projectSession.manifest, projectSession.sourceTexts)
        : projectIncludeFiles,
    [projectIncludeFiles, projectSession],
  );

  const activeProjectFileViews = useMemo<ProjectWorkspaceFileView[]>(
    () => {
      if (!projectSession) return [];
      const workspace = normalizeWorkspaceState(
        projectSession.manifest.files,
        projectSession.manifest.workspace,
      );
      return projectSession.manifest.files
        .map((file) => ({
          tabOrder:
            workspace.openFileIds.indexOf(file.id) >= 0
              ? workspace.openFileIds.indexOf(file.id)
              : null,
          id: file.id,
          name: file.name,
          kind: file.kind,
          order: file.order,
          isCheckedForRun: file.enabled,
          isOpenInTab: workspace.openFileIds.includes(file.id),
          isFocusedTab: file.id === workspace.focusedFileId,
          enabled: file.enabled,
          isActive: file.id === workspace.focusedFileId,
          isMain: file.id === workspace.mainFileId,
        }))
        .sort(
          (a, b) =>
            a.order - b.order ||
            a.name.localeCompare(b.name, undefined, { numeric: true }) ||
            a.id.localeCompare(b.id, undefined, { numeric: true }),
        );
    },
    [projectSession],
  );

  const updateProjectSession = useCallback(
    (
      updater: (_current: ProjectSessionState) => ProjectSessionState,
      options?: { syncEditor?: boolean },
    ) => {
      setProjectSession((current) => {
        if (!current) return current;
        const next = updater(cloneProjectSessionState(current));
        if (options?.syncEditor !== false) {
          const focusedFile = getProjectFocusedFile(next.manifest);
          if (focusedFile) {
            setInput(next.sourceTexts[focusedFile.id] ?? '');
            setProjectIncludeFiles(
              buildProjectEditorIncludeFiles(next.manifest, next.sourceTexts, focusedFile.id),
            );
          }
        }
        return next;
      });
    },
    [setInput, setProjectIncludeFiles],
  );

  const handleEditorInputChange = useCallback(
    (value: string) => {
      setInput(value);
      if (!projectSession) return;
      const focusedFile = getProjectFocusedFile(projectSession.manifest);
      if (!focusedFile) return;
      updateProjectSession(
        (current) => {
          const currentText = current.sourceTexts[focusedFile.id] ?? '';
          if (currentText === value) return current;
          const nowIso = new Date().toISOString();
          current.sourceTexts = {
            ...current.sourceTexts,
            [focusedFile.id]: value,
          };
          current.manifest.files = current.manifest.files.map((file) =>
            file.id === focusedFile.id
              ? { ...file, size: value.length, updatedAt: nowIso, modifiedAt: nowIso }
              : file,
          );
          current.manifest.updatedAt = nowIso;
          current.indexRow = touchProjectIndexRow(current.indexRow, nowIso);
          current.dirtyFileIds = appendUniqueId(current.dirtyFileIds, focusedFile.id);
          current.manifestDirty = true;
          current.autosaveState = 'idle';
          current.lastAutosaveError = null;
          return current;
        },
        { syncEditor: false },
      );
    },
    [projectSession, setInput, updateProjectSession],
  );

  const persistProjectNow = useCallback(
    async (session: ProjectSessionState) => {
      const saved = await storage.saveProject(buildSavedSessionForStorage(session));
      const completedAt = new Date().toISOString();
      setProjectSession((current) => {
        return applyPersistedProjectSession({
          current,
          saved,
          requestedManifestUpdatedAt: session.manifest.updatedAt,
          completedAt,
        });
      });
      upsertRecentProjectRow(saved.indexRow);
    },
    [storage, upsertRecentProjectRow],
  );

  useEffect(() => {
    if (!projectSession) return;
    if (!projectSession.manifestDirty && projectSession.dirtyFileIds.length === 0) return;
    if (autosaveTimerRef.current != null) {
      window.clearTimeout(autosaveTimerRef.current);
    }
    autosaveTimerRef.current = window.setTimeout(() => {
      void (async () => {
        try {
          setProjectSession((current) =>
            current ? { ...current, autosaveState: 'saving', lastAutosaveError: null } : current,
          );
          await persistProjectNow(projectSession);
        } catch (error) {
          setProjectSession((current) =>
            current
              ? {
                  ...current,
                  autosaveState: 'error',
                  lastAutosaveError: error instanceof Error ? error.message : String(error),
                }
              : current,
          );
        }
      })();
    }, PROJECT_AUTOSAVE_DELAY_MS);
    return () => {
      if (autosaveTimerRef.current != null) {
        window.clearTimeout(autosaveTimerRef.current);
        autosaveTimerRef.current = null;
      }
    };
  }, [persistProjectNow, projectSession]);

  const serializedProjectShape = useMemo(
    () =>
      JSON.stringify({
        settings,
        parseSettings,
        exportFormat,
        adjustedPointsExportSettings,
        projectInstruments,
        selectedInstrument,
        levelLoopCustomPresets,
      }),
    [
      adjustedPointsExportSettings,
      exportFormat,
      levelLoopCustomPresets,
      parseSettings,
      projectInstruments,
      selectedInstrument,
      settings,
    ],
  );

  useEffect(() => {
    if (!projectSession) return;
    const currentShape = JSON.stringify({
      settings: projectSession.manifest.ui.settings,
      parseSettings: projectSession.manifest.ui.parseSettings,
      exportFormat: projectSession.manifest.ui.exportFormat,
      adjustedPointsExportSettings: projectSession.manifest.ui.adjustedPointsExport,
      projectInstruments: projectSession.manifest.project.projectInstruments,
      selectedInstrument: projectSession.manifest.project.selectedInstrument,
      levelLoopCustomPresets: projectSession.manifest.project.levelLoopCustomPresets,
    });
    if (currentShape === serializedProjectShape) return;
    updateProjectSession(
      (current) => {
        const nowIso = new Date().toISOString();
        current.manifest.ui = {
          ...current.manifest.ui,
          settings: settings as unknown as Record<string, unknown>,
          parseSettings: parseSettings as unknown as Record<string, unknown>,
          exportFormat,
          adjustedPointsExport: cloneAdjustedPointsExportSettings(adjustedPointsExportSettings),
          migration: {
            parseModeMigrated: true,
            migratedAt: nowIso,
          },
        };
        current.manifest.project = {
          projectInstruments: cloneInstrumentLibrary(projectInstruments),
          selectedInstrument,
          levelLoopCustomPresets: levelLoopCustomPresets.map((preset) => ({ ...preset })),
        };
        current.manifest.updatedAt = nowIso;
        current.indexRow = touchProjectIndexRow(current.indexRow, nowIso);
        current.manifestDirty = true;
        current.lastAutosaveError = null;
        return current;
      },
      { syncEditor: false },
    );
  }, [
    adjustedPointsExportSettings,
    cloneInstrumentLibrary,
    exportFormat,
    levelLoopCustomPresets,
    parseSettings,
    projectInstruments,
    projectSession,
    selectedInstrument,
    serializedProjectShape,
    settings,
    updateProjectSession,
  ]);

  const buildParsedPayloadFromSession = useCallback(
    (session: ProjectSessionState): ParsedProjectPayload => {
      const workspace = normalizeWorkspaceState(session.manifest.files, session.manifest.workspace);
      const focusedFile = getProjectFocusedFile(session.manifest);
      return {
        schemaVersion: 5,
        input: focusedFile ? session.sourceTexts[focusedFile.id] ?? '' : '',
        includeFiles: buildProjectEditorIncludeFiles(
          session.manifest,
          session.sourceTexts,
          focusedFile?.id,
        ),
        savedRuns: [],
        ui: {
          settings: session.manifest.ui.settings,
          parseSettings: session.manifest.ui.parseSettings,
          exportFormat: session.manifest.ui.exportFormat,
          adjustedPointsExport: session.manifest.ui.adjustedPointsExport,
          migration: session.manifest.ui.migration,
        },
        project: session.manifest.project,
        workspace: {
          projectId: session.manifest.projectId,
          name: session.manifest.name,
          createdAt: session.manifest.createdAt,
          updatedAt: session.manifest.updatedAt,
          files: session.manifest.files.map((file) => ({ ...file })),
          openFileIds: [...workspace.openFileIds],
          focusedFileId: workspace.focusedFileId,
          mainFileId: workspace.mainFileId,
        },
      };
    },
    [],
  );

  const createLocalProjectFromCurrentWorkspace = useCallback(async (): Promise<ProjectSessionState | null> => {
    if (!canUseNamedProjectStorage) {
      setImportNotice({
        title: 'Local project storage unavailable',
        detailLines: [
          'Named browser projects require IndexedDB support in this browser.',
          'Use portable project export/import for this session instead.',
        ],
      });
      return null;
    }
    const suggestedName = `WebNet Project ${new Date().toISOString().slice(0, 10)}`;
    const name = window.prompt('Project name', suggestedName)?.trim();
    if (!name) return null;
    const createdAt = new Date().toISOString();
    const seed = createManifestFromFlatProject({
      projectId: createProjectId(),
      name,
      createdAt,
      updatedAt: createdAt,
      input,
      includeFiles: projectIncludeFiles,
      ui: {
        settings: settings as unknown as Record<string, unknown>,
        parseSettings: parseSettings as unknown as Record<string, unknown>,
        exportFormat,
        adjustedPointsExport: cloneAdjustedPointsExportSettings(adjustedPointsExportSettings),
        migration: {
          parseModeMigrated: true,
          migratedAt: createdAt,
        },
      },
      project: {
        projectInstruments: cloneInstrumentLibrary(projectInstruments),
        selectedInstrument,
        levelLoopCustomPresets: levelLoopCustomPresets.map((preset) => ({ ...preset })),
      },
    });
    const preferredBackend = storageStatus?.preferredBackend ?? 'indexeddb';
    const session = await storage.createProject({
      indexRow: buildProjectIndexRow({
        id: seed.manifest.projectId,
        name,
        backend: preferredBackend,
        createdAt,
        updatedAt: createdAt,
      }),
      manifest: seed.manifest,
      sourceTexts: seed.sourceTexts,
    });
    setProjectSession({
      ...session,
      dirtyFileIds: [],
      manifestDirty: false,
      autosaveState: 'idle',
      lastAutosavedAt: createdAt,
      lastAutosaveError: null,
    });
    await requestPersistentStorage();
    await refreshStorageContext();
    setImportNotice({
      title: 'Local project created',
      detailLines: [
        `Created ${name}.`,
        'Named projects now autosave sources and settings to browser project storage.',
      ],
    });
    return {
      ...session,
      dirtyFileIds: [],
      manifestDirty: false,
      autosaveState: 'idle',
      lastAutosavedAt: createdAt,
      lastAutosaveError: null,
    };
  }, [
    adjustedPointsExportSettings,
    canUseNamedProjectStorage,
    cloneInstrumentLibrary,
    exportFormat,
    input,
    levelLoopCustomPresets,
    parseSettings,
    projectIncludeFiles,
    projectInstruments,
    refreshStorageContext,
    selectedInstrument,
    setImportNotice,
    settings,
    storage,
    storageStatus?.preferredBackend,
  ]);

  const handleSaveProject = useCallback(async () => {
    if (!projectSession) {
      await createLocalProjectFromCurrentWorkspace();
      return;
    }
    await persistProjectNow(projectSession);
    setImportNotice({
      title: 'Local project saved',
      detailLines: [`Saved ${projectSession.manifest.name}.`],
    });
  }, [createLocalProjectFromCurrentWorkspace, persistProjectNow, projectSession, setImportNotice]);

  const openProjectById = useCallback(
    async (projectId: string) => {
      const session = await storage.openProject(projectId);
      if (!session) {
        setImportNotice({
          title: 'Project open failed',
          detailLines: ['The selected local project could not be opened.'],
        });
        return;
      }
      const parsedPayload = buildParsedPayloadFromSession(session);
      applyLoadedProjectPayload(parsedPayload, session, []);
      setProjectSession(session);
      upsertRecentProjectRow(session.indexRow);
      await requestPersistentStorage();
      setImportNotice({
        title: 'Local project opened',
        detailLines: [
          `Opened ${session.manifest.name}.`,
          'Named project autosave is active; rerun adjustment to rebuild report and map state.',
        ],
      });
    },
    [
      applyLoadedProjectPayload,
      buildParsedPayloadFromSession,
      setImportNotice,
      storage,
      upsertRecentProjectRow,
    ],
  );

  const deleteLocalProject = useCallback(
    async (projectId: string) => {
      const existing = recentProjects.find((entry) => entry.id === projectId);
      const accepted = window.confirm(
        `Delete local project "${existing?.name ?? projectId}" from browser project storage?`,
      );
      if (!accepted) return;
      await storage.deleteProject(projectId);
      if (projectSession?.indexRow.id === projectId) {
        setProjectSession(null);
      }
      removeRecentProjectRow(projectId);
      setImportNotice({
        title: 'Local project deleted',
        detailLines: [`Deleted ${existing?.name ?? projectId}.`],
      });
    },
    [projectSession?.indexRow.id, recentProjects, removeRecentProjectRow, setImportNotice, storage],
  );

  const triggerProjectFileSelect = useCallback(() => {
    projectFileInputRef.current?.click();
  }, [projectFileInputRef]);

  const triggerProjectSourceFileSelect = useCallback(() => {
    if (!projectSession) {
      setImportNotice({
        title: 'No local project',
        detailLines: ['Create or open a local project before adding source files.'],
      });
      return;
    }
    projectSourceFileInputRef.current?.click();
  }, [projectSession, projectSourceFileInputRef, setImportNotice]);

  const exportPortableProject = useCallback(async () => {
    const suggestedName = projectSession
      ? `${projectSession.manifest.name.replace(/\s+/g, '-').toLowerCase()}.wnproj.json`
      : `webnet-project-${new Date().toISOString().slice(0, 10)}.wnproj.json`;
    const saved = await writeTextDownload(
      suggestedName,
      serializeProjectFile(buildPortablePayload()),
    );
    if (!saved) return;
    setImportNotice({
      title: 'Portable project exported',
      detailLines: [`Wrote ${suggestedName}.`],
    });
  }, [buildPortablePayload, projectSession, setImportNotice]);

  const exportProjectBundle = useCallback(async () => {
    const seed =
      projectSession != null
        ? {
            manifest: projectSession.manifest,
            sourceTexts: projectSession.sourceTexts,
          }
        : createManifestFromFlatProject({
            name: `WebNet Project ${new Date().toISOString().slice(0, 10)}`,
            input,
            includeFiles: projectIncludeFiles,
            ui: {
              settings: settings as unknown as Record<string, unknown>,
              parseSettings: parseSettings as unknown as Record<string, unknown>,
              exportFormat,
              adjustedPointsExport: cloneAdjustedPointsExportSettings(
                adjustedPointsExportSettings,
              ),
              migration: {
                parseModeMigrated: true,
                migratedAt: new Date().toISOString(),
              },
            },
            project: {
              projectInstruments: cloneInstrumentLibrary(projectInstruments),
              selectedInstrument,
              levelLoopCustomPresets: levelLoopCustomPresets.map((preset) => ({ ...preset })),
            },
          });
    const bundleBytes = buildProjectBundleBytes(seed);
    const suggestedName = `${(projectSession?.manifest.name ?? 'webnet-project')
      .replace(/\s+/g, '-')
      .toLowerCase()}.zip`;
    const saved = await writeBinaryDownload(suggestedName, bundleBytes);
    if (!saved) return;
    setImportNotice({
      title: 'Project bundle exported',
      detailLines: [`Wrote ${suggestedName}.`],
    });
  }, [
    adjustedPointsExportSettings,
    cloneInstrumentLibrary,
    exportFormat,
    input,
    levelLoopCustomPresets,
    parseSettings,
    projectIncludeFiles,
    projectInstruments,
    projectSession,
    selectedInstrument,
    setImportNotice,
    settings,
  ]);

  const importPortablePayloadAsLocalProject = useCallback(
    async (parsed: ParsedProjectPayload) => {
      if (!canUseNamedProjectStorage) {
        applyLoadedProjectPayload(parsed, null, parsed.savedRuns);
        setProjectSession(null);
        setImportNotice({
          title: 'Portable project loaded',
          detailLines: [
            'Loaded the portable project into the current workspace.',
            'Named browser project storage is unavailable in this environment.',
          ],
        });
        return;
      }
      const createdAt = parsed.workspace?.createdAt ?? new Date().toISOString();
      const updatedAt = new Date().toISOString();
      const manifestSeed =
        parsed.workspace?.files && parsed.workspace.files.length > 0
          ? {
              manifest: createProjectManifest({
                projectId: parsed.workspace.projectId,
                name: parsed.workspace.name,
                createdAt,
                updatedAt,
                files: parsed.workspace.files,
                ui: {
                  settings: parsed.ui.settings,
                  parseSettings: parsed.ui.parseSettings,
                  exportFormat: parsed.ui.exportFormat,
                  adjustedPointsExport: parsed.ui.adjustedPointsExport,
                  migration: parsed.ui.migration,
                },
                project: parsed.project,
                workspace: {
                  openFileIds: parsed.workspace.openFileIds,
                  focusedFileId: parsed.workspace.focusedFileId,
                  mainFileId: parsed.workspace.mainFileId,
                },
              }),
              sourceTexts: Object.fromEntries(
                parsed.workspace.files.map((file) => [
                  file.id,
                  file.id === parsed.workspace?.focusedFileId
                    ? parsed.input
                    : parsed.workspaceFileContents?.[file.id] ??
                      parsed.includeFiles[file.name] ??
                      '',
                ]),
              ),
            }
          : createManifestFromFlatProject({
              projectId: parsed.workspace?.projectId,
              name:
                parsed.workspace?.name ??
                `Imported Project ${new Date().toISOString().slice(0, 10)}`,
              createdAt,
              updatedAt,
              input: parsed.input,
              includeFiles: parsed.includeFiles,
              ui: {
                settings: parsed.ui.settings,
                parseSettings: parsed.ui.parseSettings,
                exportFormat: parsed.ui.exportFormat,
                adjustedPointsExport: parsed.ui.adjustedPointsExport,
                migration: parsed.ui.migration,
              },
              project: parsed.project,
              preferredFocusedFileId: parsed.workspace?.focusedFileId,
            });
      const backend = storageStatus?.preferredBackend ?? 'indexeddb';
      const session = await storage.createProject({
        indexRow: buildProjectIndexRow({
          id: manifestSeed.manifest.projectId,
          name: manifestSeed.manifest.name,
          backend,
          createdAt,
          updatedAt,
        }),
        manifest: manifestSeed.manifest,
        sourceTexts: manifestSeed.sourceTexts,
      });
      applyLoadedProjectPayload(parsed, session, parsed.savedRuns);
      setProjectSession(session);
      await requestPersistentStorage();
      await refreshStorageContext();
      setImportNotice({
        title: 'Portable project imported',
        detailLines: [
          `Imported ${manifestSeed.manifest.name} into local browser project storage.`,
          'Saved runs were restored into the current session but are not part of named-project autosave yet.',
        ],
      });
    },
    [
      applyLoadedProjectPayload,
      canUseNamedProjectStorage,
      refreshStorageContext,
      setImportNotice,
      storage,
      storageStatus?.preferredBackend,
    ],
  );

  const importProjectBundleAsLocalProject = useCallback(
    async (bytes: Uint8Array) => {
      const parsedBundle = parseProjectBundleBytes(bytes);
      const updatedAt = new Date().toISOString();
      const manifest = {
        ...parsedBundle.manifest,
        updatedAt,
      };
      if (!canUseNamedProjectStorage) {
        const parsedPayload = buildParsedPayloadFromSession({
          indexRow: buildProjectIndexRow({
            id: manifest.projectId,
            name: manifest.name,
            backend: storageStatus?.preferredBackend ?? 'indexeddb',
            createdAt: manifest.createdAt,
            updatedAt,
          }),
          manifest,
          sourceTexts: parsedBundle.sourceTexts,
          dirtyFileIds: [],
          manifestDirty: false,
          autosaveState: 'idle',
          lastAutosavedAt: null,
          lastAutosaveError: null,
        });
        applyLoadedProjectPayload(parsedPayload, null, []);
        setProjectSession(null);
        setImportNotice({
          title: 'Project bundle loaded',
          detailLines: [
            `Loaded ${manifest.name} into the current workspace.`,
            'Named browser project storage is unavailable in this environment.',
          ],
        });
        return;
      }
      const backend = storageStatus?.preferredBackend ?? 'indexeddb';
      const session = await storage.createProject({
        indexRow: buildProjectIndexRow({
          id: manifest.projectId,
          name: manifest.name,
          backend,
          createdAt: manifest.createdAt,
          updatedAt,
        }),
        manifest,
        sourceTexts: parsedBundle.sourceTexts,
      });
      const parsedPayload = buildParsedPayloadFromSession(session);
      applyLoadedProjectPayload(parsedPayload, session, []);
      setProjectSession(session);
      await requestPersistentStorage();
      await refreshStorageContext();
      setImportNotice({
        title: 'Project bundle imported',
        detailLines: [`Imported ${manifest.name} into local browser project storage.`],
      });
    },
    [
      applyLoadedProjectPayload,
      buildParsedPayloadFromSession,
      canUseNamedProjectStorage,
      refreshStorageContext,
      setImportNotice,
      storage,
      storageStatus?.preferredBackend,
    ],
  );

  const handleProjectFileChange = useCallback(
    async (e: ChangeEvent<HTMLInputElement>) => {
      const file = e.target.files?.[0];
      if (!file) return;
      e.target.value = '';
      try {
        if (file.name.toLowerCase().endsWith('.zip')) {
          const bytes = await readFileAsUint8Array(file);
          await importProjectBundleAsLocalProject(bytes);
          return;
        }
        const rawText = await readFileAsText(file);
        const parsed = parseProjectFile(rawText, {
          settings: settings as unknown as Record<string, unknown>,
          parseSettings: parseSettings as unknown as Record<string, unknown>,
          exportFormat,
          adjustedPointsExport: adjustedPointsExportSettings,
          projectInstruments,
          selectedInstrument,
          levelLoopCustomPresets,
        });
        if (!parsed.ok) {
          setImportNotice({
            title: 'Project load failed',
            detailLines: parsed.errors,
          });
          return;
        }
        await importPortablePayloadAsLocalProject(parsed.project);
      } catch (error) {
        setImportNotice({
          title: 'Project load failed',
          detailLines: [error instanceof Error ? error.message : String(error)],
        });
      }
    },
    [
      adjustedPointsExportSettings,
      exportFormat,
      importPortablePayloadAsLocalProject,
      importProjectBundleAsLocalProject,
      levelLoopCustomPresets,
      parseSettings,
      projectInstruments,
      selectedInstrument,
      setImportNotice,
      settings,
    ],
  );

  const importProjectSourceFiles = useCallback(
    async (files: File[]): Promise<boolean> => {
      if (!projectSession || files.length === 0) return false;
      try {
        const loadedFiles = await Promise.all(
          files.map(async (file) => ({
            file,
            text: await readFileAsText(file),
          })),
        );
        updateProjectSession((current) => {
          const nowIso = new Date().toISOString();
          const workspace = normalizeSessionWorkspace(current);
          const existingNames = new Set(current.manifest.files.map((entry) => entry.name));
          const appendedEntries = loadedFiles.map(({ file, text }, index) => {
            const requestedName = getImportedProjectSourceName(file.name);
            const nextName = existingNames.has(requestedName)
              ? buildFileNameCopy(requestedName, existingNames)
              : requestedName;
            existingNames.add(nextName);
            return createManifestEntry({
              name: nextName,
              kind: 'dat',
              order: current.manifest.files.length + index,
              text,
              createdAt: nowIso,
              updatedAt: nowIso,
              modifiedAt: nowIso,
            });
          });
          current.manifest.files = [...current.manifest.files, ...appendedEntries];
          current.manifest.workspace = normalizeWorkspaceState(current.manifest.files, {
            ...workspace,
            openFileIds: appendedEntries.reduce(
              (ids, entry) => appendUniqueId(ids, entry.id),
              workspace.openFileIds,
            ),
            focusedFileId: appendedEntries[appendedEntries.length - 1]?.id ?? workspace.focusedFileId,
          });
          current.manifest.updatedAt = nowIso;
          current.indexRow = touchProjectIndexRow(current.indexRow, nowIso);
          current.sourceTexts = appendedEntries.reduce<Record<string, string>>(
            (sourceTexts, entry, index) => {
              sourceTexts[entry.id] = loadedFiles[index]?.text ?? '';
              return sourceTexts;
            },
            { ...current.sourceTexts },
          );
          current.dirtyFileIds = appendedEntries.reduce(
            (ids, entry) => appendUniqueId(ids, entry.id),
            current.dirtyFileIds,
          );
          current.manifestDirty = true;
          current.autosaveState = 'idle';
          current.lastAutosaveError = null;
          return current;
        });
        setImportNotice({
          title: 'Project source file added',
          detailLines:
            loadedFiles.length === 1
              ? [`Added ${getImportedProjectSourceName(loadedFiles[0]?.file.name ?? 'file')}.`]
              : [`Added ${loadedFiles.length} source files to the current project.`],
        });
        return true;
      } catch (error) {
        setImportNotice({
          title: 'Project source file failed',
          detailLines: [error instanceof Error ? error.message : String(error)],
        });
        return false;
      }
    },
    [projectSession, setImportNotice, updateProjectSession],
  );

  const importGeneratedProjectSourceFile = useCallback(
    async ({ sourceName, text }: { sourceName: string; text: string }): Promise<boolean> => {
      if (!text.trim()) {
        setImportNotice({
          title: 'Project source file failed',
          detailLines: ['Imported review output was empty after reconciliation.'],
        });
        return false;
      }
      let ensuredSession = projectSession;
      if (!ensuredSession) {
        ensuredSession = await createLocalProjectFromCurrentWorkspace();
        if (!ensuredSession) return false;
      }
      const requestedName = buildImportedReviewFileName(sourceName);
      let finalName = requestedName;
      let nextInputText = text;
      let nextIncludeFiles: Record<string, string> = {};
      setProjectSession((current) => {
        const base = cloneProjectSessionState(current ?? ensuredSession!);
        const nowIso = new Date().toISOString();
        const workspace = normalizeSessionWorkspace(base);
        const existingNames = new Set(base.manifest.files.map((entry) => entry.name));
        finalName = existingNames.has(requestedName)
          ? buildFileNameCopy(requestedName, existingNames)
          : requestedName;
        const entry = createManifestEntry({
          name: finalName,
          kind: 'dat',
          order: base.manifest.files.length,
          enabled: true,
          text,
          createdAt: nowIso,
          updatedAt: nowIso,
          modifiedAt: nowIso,
        });
        base.manifest.files = [...base.manifest.files, entry];
        base.manifest.workspace = normalizeWorkspaceState(base.manifest.files, {
          ...workspace,
          openFileIds: appendUniqueId(workspace.openFileIds, entry.id),
          focusedFileId: entry.id,
        });
        base.manifest.updatedAt = nowIso;
        base.indexRow = touchProjectIndexRow(base.indexRow, nowIso);
        base.sourceTexts = {
          ...base.sourceTexts,
          [entry.id]: text,
        };
        base.dirtyFileIds = appendUniqueId(base.dirtyFileIds, entry.id);
        base.manifestDirty = true;
        base.autosaveState = 'idle';
        base.lastAutosaveError = null;
        nextInputText = base.sourceTexts[entry.id] ?? text;
        nextIncludeFiles = buildProjectEditorIncludeFiles(base.manifest, base.sourceTexts, entry.id);
        return base;
      });
      setInput(nextInputText);
      setProjectIncludeFiles(nextIncludeFiles);
      setImportNotice({
        title: 'Project source file added',
        detailLines: [`Added ${finalName}.`],
      });
      return true;
    },
    [
      createLocalProjectFromCurrentWorkspace,
      projectSession,
      setInput,
      setImportNotice,
      setProjectIncludeFiles,
    ],
  );

  const prepareAssociatedProjectSettingsImport = useCallback(
    async (file: File): Promise<PreparedAssociatedProjectSettingsImport | null> => {
      try {
        const rawText = await readFileAsText(file);
        const lowerName = file.name.toLowerCase();
        if (lowerName.endsWith('.snproj')) {
          return buildSnprojAssociatedSettingsPayload({
            rawText,
            sourceName: file.name,
            settings,
            parseSettings,
            exportFormat,
            adjustedPointsExportSettings,
            projectInstruments,
            selectedInstrument,
            levelLoopCustomPresets,
          });
        }
        const parsed = parseProjectFile(rawText, {
          settings: settings as unknown as Record<string, unknown>,
          parseSettings: parseSettings as unknown as Record<string, unknown>,
          exportFormat,
          adjustedPointsExport: adjustedPointsExportSettings,
          projectInstruments,
          selectedInstrument,
          levelLoopCustomPresets,
        });
        if (!parsed.ok) {
          setImportNotice({
            title: 'Associated settings import failed',
            detailLines: parsed.errors,
          });
          return null;
        }
        return {
          sourceName: file.name,
          payload: parsed.project,
          appliedDomains: [
            'project settings',
            'parse settings',
            'adjusted-points export',
            'instrument library',
          ],
          ignoredDomains: [],
        };
      } catch (error) {
        setImportNotice({
          title: 'Associated settings import failed',
          detailLines: [error instanceof Error ? error.message : String(error)],
        });
        return null;
      }
    },
    [
      adjustedPointsExportSettings,
      exportFormat,
      levelLoopCustomPresets,
      parseSettings,
      projectInstruments,
      selectedInstrument,
      setImportNotice,
      settings,
    ],
  );

  const applyPreparedAssociatedProjectSettings = useCallback(
    async (
      prepared: PreparedAssociatedProjectSettingsImport,
      options: ApplyPreparedAssociatedProjectSettingsOptions = {},
    ): Promise<boolean> => {
      try {
        const normalized = normalizeImportedProjectPayload(prepared.payload);
        setSettings(normalized.normalizedLoadedSettings);
        setParseSettings(normalized.normalizedLoadedParseSettings);
        setGeoidSourceData(null);
        setGeoidSourceDataLabel('');
        setExportFormat(normalized.exportFormat);
        setAdjustedPointsExportSettings(
          cloneAdjustedPointsExportSettings(normalized.loadedAdjustedPointsSettings),
        );
        setProjectInstruments(cloneInstrumentLibrary(normalized.projectInstruments));
        setSelectedInstrument(normalized.selectedInstrument);
        setLevelLoopCustomPresets(
          normalized.levelLoopCustomPresets.map((preset) => ({ ...preset })),
        );

        setSettingsDraft(normalized.normalizedLoadedSettings);
        setParseSettingsDraft(normalized.normalizedLoadedParseSettings);
        setGeoidSourceDataDraft(null);
        setGeoidSourceDataLabelDraft('');
        setProjectInstrumentsDraft(cloneInstrumentLibrary(normalized.projectInstruments));
        setSelectedInstrumentDraft(normalized.selectedInstrument);
        setLevelLoopCustomPresetsDraft(
          normalized.levelLoopCustomPresets.map((preset) => ({ ...preset })),
        );
        setAdjustedPointsExportSettingsDraft(
          cloneAdjustedPointsExportSettings(normalized.loadedAdjustedPointsSettings),
        );
        setIsAdjustedPointsTransformSelectOpen(false);
        setAdjustedPointsTransformSelectedDraft([]);

        if (projectSession) {
          updateProjectSession(
            (current) => {
              const nowIso = new Date().toISOString();
              current.manifest.ui.settings =
                normalized.normalizedLoadedSettings as unknown as Record<string, unknown>;
              current.manifest.ui.parseSettings =
                normalized.normalizedLoadedParseSettings as unknown as Record<string, unknown>;
              current.manifest.ui.exportFormat = normalized.exportFormat;
              current.manifest.ui.adjustedPointsExport = cloneAdjustedPointsExportSettings(
                normalized.loadedAdjustedPointsSettings,
              );
              current.manifest.project.projectInstruments = cloneInstrumentLibrary(
                normalized.projectInstruments,
              );
              current.manifest.project.selectedInstrument = normalized.selectedInstrument;
              current.manifest.project.levelLoopCustomPresets =
                normalized.levelLoopCustomPresets.map((preset) => ({ ...preset }));
              current.manifest.updatedAt = nowIso;
              current.indexRow = touchProjectIndexRow(current.indexRow, nowIso);
              current.manifestDirty = true;
              current.autosaveState = 'idle';
              current.lastAutosaveError = null;
              return current;
            },
            { syncEditor: false },
          );
        }

        resetWorkspaceAfterProjectLoad();
        const detailLines = [
          ...(options.successDetailPrefix ?? []),
          `Applied settings from ${prepared.sourceName}.`,
          `Applied: ${prepared.appliedDomains.join(', ') || 'recognized project settings'}.`,
        ];
        if (prepared.ignoredDomains.length > 0) {
          detailLines.push(`Ignored: ${prepared.ignoredDomains.join(', ')}.`);
        }
        setImportNotice({
          title: options.successTitle ?? 'Associated settings imported',
          detailLines,
        });
        return true;
      } catch (error) {
        setImportNotice({
          title: options.failureTitle ?? 'Associated settings import failed',
          detailLines: [
            ...(options.failureDetailPrefix ?? []),
            error instanceof Error ? error.message : String(error),
          ],
        });
        return false;
      }
    },
    [
      cloneInstrumentLibrary,
      normalizeImportedProjectPayload,
      projectSession,
      resetWorkspaceAfterProjectLoad,
      setAdjustedPointsExportSettings,
      setAdjustedPointsExportSettingsDraft,
      setAdjustedPointsTransformSelectedDraft,
      setExportFormat,
      setGeoidSourceData,
      setGeoidSourceDataDraft,
      setGeoidSourceDataLabel,
      setGeoidSourceDataLabelDraft,
      setImportNotice,
      setIsAdjustedPointsTransformSelectOpen,
      setLevelLoopCustomPresets,
      setLevelLoopCustomPresetsDraft,
      setParseSettings,
      setParseSettingsDraft,
      setProjectInstruments,
      setProjectInstrumentsDraft,
      setSelectedInstrument,
      setSelectedInstrumentDraft,
      setSettings,
      setSettingsDraft,
      updateProjectSession,
    ],
  );

  const importAssociatedProjectSettingsFile = useCallback(
    async (file: File): Promise<boolean> => {
      const prepared = await prepareAssociatedProjectSettingsImport(file);
      if (!prepared) return false;
      return applyPreparedAssociatedProjectSettings(prepared);
    },
    [
      applyPreparedAssociatedProjectSettings,
      prepareAssociatedProjectSettingsImport,
    ],
  );

  const handleProjectSourceFileChange = useCallback(
    async (e: ChangeEvent<HTMLInputElement>) => {
      const files = Array.from(e.target.files ?? []);
      if (files.length === 0) return;
      e.target.value = '';
      await importProjectSourceFiles(files);
    },
    [importProjectSourceFiles],
  );

  const openFileTab = useCallback(
    (fileId: string) => {
      updateProjectSession((current) => {
        if (!current.manifest.files.some((file) => file.id === fileId)) return current;
        const nowIso = new Date().toISOString();
        const workspace = normalizeSessionWorkspace(current);
        current.manifest.workspace = {
          ...workspace,
          openFileIds: appendUniqueId(workspace.openFileIds, fileId),
          focusedFileId: fileId,
        };
        current.manifest.updatedAt = nowIso;
        current.indexRow = touchProjectIndexRow(current.indexRow, nowIso);
        current.manifestDirty = true;
        return current;
      });
    },
    [updateProjectSession],
  );

  const focusFileTab = useCallback(
    (fileId: string) => {
      openFileTab(fileId);
    },
    [openFileTab],
  );

  const closeFileTab = useCallback(
    (fileId: string) => {
      updateProjectSession((current) => {
        const workspace = normalizeSessionWorkspace(current);
        if (!workspace.openFileIds.includes(fileId)) return current;
        const removedIndex = workspace.openFileIds.indexOf(fileId);
        const preferredNeighbors = [
          workspace.openFileIds[removedIndex + 1],
          workspace.openFileIds[removedIndex - 1],
        ].filter((value): value is string => Boolean(value));
        const nextFocusedFileId =
          workspace.focusedFileId === fileId
            ? resolveNextFocusedFileId(workspace.openFileIds, fileId, preferredNeighbors)
            : workspace.focusedFileId;
        const nowIso = new Date().toISOString();
        current.manifest.workspace = {
          ...workspace,
          openFileIds: removeFileId(workspace.openFileIds, fileId),
          focusedFileId: nextFocusedFileId,
        };
        current.manifest.updatedAt = nowIso;
        current.indexRow = touchProjectIndexRow(current.indexRow, nowIso);
        current.manifestDirty = true;
        return current;
      });
    },
    [updateProjectSession],
  );

  const createBlankProjectFile = useCallback(
    (options?: { name?: string; kind?: ProjectSourceFileKind }) => {
      if (!projectSession) {
        setImportNotice({
          title: 'No local project',
          detailLines: ['Create or open a local project before adding source files.'],
        });
        return '';
      }
      const suggestedName =
        options?.name ?? `section-${projectSession.manifest.files.length + 1}.dat`;
      const name =
        options?.name ?? window.prompt('New source file name', suggestedName)?.trim() ?? '';
      if (!name) return '';
      let createdFileId = '';
      try {
        updateProjectSession((current) => {
          if (current.manifest.files.some((file) => file.name === name)) {
            throw new Error(`A project source file named "${name}" already exists.`);
          }
          const nowIso = new Date().toISOString();
          const entry = createManifestEntry({
            name,
            kind: options?.kind ?? 'dat',
            order: current.manifest.files.length,
            enabled: false,
            text: '',
            createdAt: nowIso,
            updatedAt: nowIso,
            modifiedAt: nowIso,
          });
          createdFileId = entry.id;
          const workspace = normalizeSessionWorkspace(current);
          current.manifest.files = [...current.manifest.files, entry];
          current.manifest.workspace = normalizeWorkspaceState(
            current.manifest.files,
            {
              ...workspace,
              openFileIds: appendUniqueId(workspace.openFileIds, entry.id),
              focusedFileId: entry.id,
            },
          );
          current.manifest.updatedAt = nowIso;
          current.indexRow = touchProjectIndexRow(current.indexRow, nowIso);
          current.sourceTexts = { ...current.sourceTexts, [entry.id]: '' };
          current.dirtyFileIds = appendUniqueId(current.dirtyFileIds, entry.id);
          current.manifestDirty = true;
          return current;
        });
        setImportNotice({
          title: 'Blank source file created',
          detailLines: [`Created ${name}.`],
        });
      } catch (error) {
        setImportNotice({
          title: 'Blank source file failed',
          detailLines: [error instanceof Error ? error.message : String(error)],
        });
      }
      return createdFileId;
    },
    [projectSession, setImportNotice, updateProjectSession],
  );

  const duplicateProjectFile = useCallback(
    (fileId: string) => {
      if (!projectSession) return '';
      const target = projectSession.manifest.files.find((file) => file.id === fileId);
      if (!target) return '';
      let duplicatedFileId = '';
      updateProjectSession((current) => {
        const targetFile = current.manifest.files.find((file) => file.id === fileId);
        if (!targetFile) return current;
        const nowIso = new Date().toISOString();
        const nextName = buildFileNameCopy(
          targetFile.name,
          new Set(current.manifest.files.map((file) => file.name)),
        );
        const entry = createManifestEntry({
          name: nextName,
          kind: targetFile.kind,
          order: current.manifest.files.length,
          enabled: false,
          text: current.sourceTexts[targetFile.id] ?? '',
          createdAt: nowIso,
          updatedAt: nowIso,
          modifiedAt: nowIso,
        });
        duplicatedFileId = entry.id;
        const workspace = normalizeSessionWorkspace(current);
        current.manifest.files = [...current.manifest.files, entry];
        current.manifest.workspace = normalizeWorkspaceState(current.manifest.files, {
          ...workspace,
          openFileIds: appendUniqueId(workspace.openFileIds, entry.id),
          focusedFileId: entry.id,
        });
        current.sourceTexts = {
          ...current.sourceTexts,
          [entry.id]: current.sourceTexts[targetFile.id] ?? '',
        };
        current.manifest.updatedAt = nowIso;
        current.indexRow = touchProjectIndexRow(current.indexRow, nowIso);
        current.dirtyFileIds = appendUniqueId(current.dirtyFileIds, entry.id);
        current.manifestDirty = true;
        return current;
      });
      return duplicatedFileId;
    },
    [projectSession, updateProjectSession],
  );

  const renameProjectFile = useCallback(
    (fileId: string, requestedName?: string) => {
      if (!projectSession) return;
      const target = projectSession.manifest.files.find((file) => file.id === fileId);
      if (!target) return;
      const nextName =
        requestedName ?? window.prompt('Rename source file', target.name)?.trim() ?? '';
      if (!nextName || nextName === target.name) return;
      try {
        updateProjectSession((current) => {
          if (current.manifest.files.some((file) => file.id !== fileId && file.name === nextName)) {
            throw new Error(`A project source file named "${nextName}" already exists.`);
          }
          const nowIso = new Date().toISOString();
          current.manifest.files = current.manifest.files.map((file) =>
            file.id === fileId
              ? {
                  ...file,
                  name: nextName,
                  path: file.path,
                  updatedAt: nowIso,
                  modifiedAt: nowIso,
                }
              : file,
          );
          current.manifest.updatedAt = nowIso;
          current.indexRow = touchProjectIndexRow(current.indexRow, nowIso);
          current.manifestDirty = true;
          return current;
        }, { syncEditor: false });
      } catch (error) {
        setImportNotice({
          title: 'Rename failed',
          detailLines: [error instanceof Error ? error.message : String(error)],
        });
      }
    },
    [projectSession, setImportNotice, updateProjectSession],
  );

  const setProjectFileEnabled = useCallback(
    (fileId: string, enabled: boolean) => {
      updateProjectSession((current) => {
        if (!current.manifest.files.some((file) => file.id === fileId)) return current;
        const nowIso = new Date().toISOString();
        current.manifest.files = current.manifest.files.map((file) =>
          file.id === fileId ? { ...file, enabled, updatedAt: nowIso, modifiedAt: nowIso } : file,
        );
        current.manifest.updatedAt = nowIso;
        current.indexRow = touchProjectIndexRow(current.indexRow, nowIso);
        current.manifestDirty = true;
        current.autosaveState = 'idle';
        current.lastAutosaveError = null;
        return current;
      }, { syncEditor: false });
    },
    [updateProjectSession],
  );

  const reorderProjectFiles = useCallback(
    (fileIdsInOrder: string[]) => {
      updateProjectSession((current) => {
        const sorted = [...current.manifest.files].sort((a, b) => a.order - b.order);
        const byId = new Map(sorted.map((file) => [file.id, file]));
        const requested = fileIdsInOrder
          .map((fileId) => byId.get(fileId))
          .filter((file): file is NonNullable<typeof file> => file != null);
        if (requested.length === 0) return current;
        const remaining = sorted.filter((file) => !fileIdsInOrder.includes(file.id));
        const nextFiles = [...requested, ...remaining];
        const nowIso = new Date().toISOString();
        current.manifest.files = nextFiles.map((file, order) => ({
          ...file,
          order,
          updatedAt: fileIdsInOrder.includes(file.id) ? nowIso : file.updatedAt,
          modifiedAt: fileIdsInOrder.includes(file.id) ? nowIso : file.modifiedAt,
        }));
        current.manifest.updatedAt = nowIso;
        current.indexRow = touchProjectIndexRow(current.indexRow, nowIso);
        current.manifestDirty = true;
        current.autosaveState = 'idle';
        current.lastAutosaveError = null;
        return current;
      }, { syncEditor: false });
    },
    [updateProjectSession],
  );

  const moveProjectFile = useCallback(
    (fileId: string, direction: 'up' | 'down') => {
      if (!projectSession) return;
      const sorted = [...projectSession.manifest.files].sort((a, b) => a.order - b.order);
      const index = sorted.findIndex((file) => file.id === fileId);
      if (index < 0) return;
      const targetIndex = direction === 'up' ? index - 1 : index + 1;
      if (targetIndex < 0 || targetIndex >= sorted.length) return;
      const nextIds = sorted.map((file) => file.id);
      const [moved] = nextIds.splice(index, 1);
      nextIds.splice(targetIndex, 0, moved);
      reorderProjectFiles(nextIds);
    },
    [projectSession, reorderProjectFiles],
  );

  const deleteProjectFile = useCallback(
    (fileId: string) => {
      if (!projectSession) return;
      const target = projectSession.manifest.files.find((file) => file.id === fileId);
      if (!target) return;
      const accepted = window.confirm(
        `Delete source file "${target.name}" from the current local project?`,
      );
      if (!accepted) return;
      updateProjectSession((current) => {
        const nowIso = new Date().toISOString();
        const sorted = [...current.manifest.files].sort((a, b) => a.order - b.order);
        const removedIndex = sorted.findIndex((file) => file.id === fileId);
        if (removedIndex < 0) return current;
        const preferredNeighbors = [
          sorted[removedIndex + 1]?.id,
          sorted[removedIndex - 1]?.id,
        ].filter((value): value is string => Boolean(value));
        const nextFiles = sorted.filter((file) => file.id !== fileId).map((file, order) => ({
          ...file,
          order,
        }));
        const workspace = normalizeWorkspaceState(nextFiles, current.manifest.workspace);
        const nextFocusedFileId =
          workspace.focusedFileId === fileId
            ? resolveNextFocusedFileId(workspace.openFileIds, fileId, preferredNeighbors)
            : workspace.focusedFileId;
        current.manifest.files = nextFiles;
        current.manifest.workspace = normalizeWorkspaceState(nextFiles, {
          ...workspace,
          openFileIds: removeFileId(workspace.openFileIds, fileId),
          focusedFileId: nextFocusedFileId,
        });
        const nextSourceTexts = { ...current.sourceTexts };
        delete nextSourceTexts[fileId];
        current.sourceTexts = nextSourceTexts;
        current.manifest.updatedAt = nowIso;
        current.indexRow = touchProjectIndexRow(current.indexRow, nowIso);
        current.manifestDirty = true;
        current.dirtyFileIds = current.dirtyFileIds.filter((id) => id !== fileId);
        return current;
      });
    },
    [projectSession, updateProjectSession],
  );

  const removeProjectFile = deleteProjectFile;

  const openProjectWorkspace = useCallback(async () => {
    if (recentProjects.length > 0) {
      await openProjectById(recentProjects[0].id);
      return;
    }
    triggerProjectFileSelect();
  }, [openProjectById, recentProjects, triggerProjectFileSelect]);

  const currentProjectFile = projectSession
    ? getProjectFocusedFile(projectSession.manifest)
    : null;

  const projectRunValidation = useMemo<ProjectRunValidation>(
    () =>
      projectSession
        ? effectiveProjectRunFiles.length > 0
          ? { ok: true, errors: [], warnings: [] }
          : {
              ok: false,
              errors: ['Select at least one checked project file before running the adjustment.'],
              warnings: [],
            }
        : { ok: true, errors: [], warnings: [] },
    [effectiveProjectRunFiles.length, projectSession],
  );

  const getOrderedRunFiles = useCallback(() => effectiveProjectRunFiles, [effectiveProjectRunFiles]);

  const validateRunSet = useCallback(() => projectRunValidation, [projectRunValidation]);

  return {
    storageStatus,
    recentProjects,
    projectSession,
    activeProjectFileViews,
    currentProjectFile,
    projectSourceAccept: PROJECT_SOURCE_ACCEPT,
    associatedProjectSettingsAccept: ASSOCIATED_PROJECT_SETTINGS_ACCEPT,
    effectiveRunInput,
    effectiveProjectRunFiles,
    projectRunValidation,
    getOrderedRunFiles,
    validateRunSet,
    effectiveSolveInput,
    effectiveSolveIncludeFiles,
    effectiveRunIncludeFiles,
    currentEditorIncludeFiles:
      projectSession && currentProjectFile
        ? buildProjectEditorIncludeFiles(
            projectSession.manifest,
            projectSession.sourceTexts,
            currentProjectFile.id,
          )
        : projectIncludeFiles,
    triggerProjectFileSelect,
    triggerProjectSourceFileSelect,
    importProjectSourceFiles,
    importGeneratedProjectSourceFile,
    prepareAssociatedProjectSettingsImport,
    applyPreparedAssociatedProjectSettings,
    importAssociatedProjectSettingsFile,
    openProjectWorkspace,
    handleSaveProject,
    handleEditorInputChange,
    handleProjectFileChange,
    handleProjectSourceFileChange,
    createLocalProjectFromCurrentWorkspace,
    openProjectById,
    deleteLocalProject,
    exportPortableProject,
    exportProjectBundle,
    openFileTab,
    closeFileTab,
    focusFileTab,
    createBlankProjectFile,
    duplicateProjectFile,
    switchActiveProjectFile: focusFileTab,
    renameProjectFile,
    toggleProjectFileEnabled: (fileId: string) => {
      const target = projectSession?.manifest.files.find((file) => file.id === fileId);
      if (!target) return;
      setProjectFileEnabled(fileId, !target.enabled);
    },
    setProjectFileEnabled,
    reorderProjectFiles,
    moveProjectFile,
    deleteProjectFile,
    removeProjectFile,
  };
};
