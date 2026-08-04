import {
  DEFAULT_ADJUSTED_POINTS_EXPORT_SETTINGS,
  sanitizeAdjustedPointsExportSettings,
} from './adjustedPointsExport';
import { sanitizePlanningMapState } from './planningMapState';
import {
  sanitizeSurveyCadPersistedState,
} from './cad/cadPersistence';
import {
  clonePlanningMapStateForProjectExport,
  stripLocalOnlyProjectSettings,
} from './projectExportSlimming';
import { normalizeListingSortObservationsBy } from '../listingSortObservations';
import {
  createManifestFromFlatProject,
  createProjectManifest,
  createPortableProjectFile,
  createProjectFileId,
  type WebNetPortableProjectFileV5,
} from './projectWorkspace';
import {
  cloneSavedRunSnapshots,
} from './qaWorkflow';
import { sanitizeSavedRunSnapshots } from './projectFileSavedRuns';
import type {
  ParsedProjectPayload,
  ParseProjectFileResult,
  ProjectFileDefaults,
} from './projectFile.types';
import {
  cloneInstruments,
  cloneRecord,
  isRecord,
  mergeKnownKeys,
  normalizeRetiredParseSettings,
  sanitizeCustomPresets,
  sanitizeExportFormat,
  sanitizeIncludeFiles,
  sanitizeInstrumentLibrary,
  sanitizePortableFileContents,
  sanitizePortableProjectFiles,
  sanitizeWorkspaceState,
} from './projectFileSanitizers';

export type { ParsedProjectPayload, ParseProjectFileResult, ProjectFileDefaults };

export const serializeProjectFile = (project: ParsedProjectPayload): string => {
  const nowIso = new Date().toISOString();
  const parseSettings = cloneRecord(project.ui.parseSettings);
  normalizeRetiredParseSettings(parseSettings);
  const settings = stripLocalOnlyProjectSettings(cloneRecord(project.ui.settings));
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
      planningMap: project.ui.planningMap
        ? clonePlanningMapStateForProjectExport(project.ui.planningMap)
        : undefined,
      geoidSourceDataBase64:
        typeof project.ui.geoidSourceDataBase64 === 'string' &&
        project.ui.geoidSourceDataBase64.trim().length > 0
          ? project.ui.geoidSourceDataBase64.trim()
          : null,
      geoidSourceDataLabel:
        typeof project.ui.geoidSourceDataLabel === 'string'
          ? project.ui.geoidSourceDataLabel
          : '',
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

  const settingsCandidate = isRecord(ui.settings)
    ? stripLocalOnlyProjectSettings(cloneRecord(ui.settings))
    : ui.settings;
  const settings = mergeKnownKeys(defaults.settings, settingsCandidate);
  const parseSettings = mergeKnownKeys(defaults.parseSettings, parseSettingsRaw);
  const exportFormat = sanitizeExportFormat(ui.exportFormat, defaults.exportFormat);
  const adjustedPointsExport = sanitizeAdjustedPointsExportSettings(
    ui.adjustedPointsExport,
    defaults.adjustedPointsExport,
  );
  const geoidSourceDataBase64 =
    typeof ui.geoidSourceDataBase64 === 'string' && ui.geoidSourceDataBase64.trim().length > 0
      ? ui.geoidSourceDataBase64.trim()
      : null;
  const planningMap = sanitizePlanningMapState(ui.planningMap);
  const geoidSourceDataLabel =
    typeof ui.geoidSourceDataLabel === 'string' ? ui.geoidSourceDataLabel : '';
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
  const surveyCad = sanitizeSurveyCadPersistedState(project.surveyCad);

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
        planningMap,
        geoidSourceDataBase64,
        geoidSourceDataLabel,
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
        surveyCad,
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
