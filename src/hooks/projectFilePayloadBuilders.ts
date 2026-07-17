import { encodeUint8ArrayToBase64 } from './useWorkspaceRecovery';
import { cloneAdjustedPointsExportSettings } from '../engine/adjustedPointsExport';
import { cloneSurveyCadPersistedState } from '../engine/cad/cadPersistence';
import type { SurveyCadPersistedState } from '../engine/cad/cadTypes';
import { clonePlanningMapState } from '../engine/planningMapState';
import type { ParsedProjectPayload } from '../engine/projectFile';
import {
  buildProjectEditorIncludeFiles,
  createManifestFromFlatProject,
  createProjectManifest,
  getProjectFocusedFile,
  normalizeWorkspaceState,
  type ProjectSessionState,
} from '../engine/projectWorkspace';
import type { ParseSettings, PersistedSavedRunSnapshot, SettingsState } from '../appStateTypes';
import type {
  AdjustedPointsExportSettings,
  CustomLevelLoopTolerancePreset,
  InstrumentLibrary,
  PlanningMapState,
  ProjectExportFormat,
} from '../types';

export type ProjectFlatWorkspacePayloadOptions = {
  input: string;
  includeFiles: Record<string, string>;
  settings: SettingsState;
  parseSettings: ParseSettings;
  geoidSourceData: Uint8Array | null;
  geoidSourceDataLabel: string;
  exportFormat: ProjectExportFormat;
  adjustedPointsExportSettings: AdjustedPointsExportSettings;
  planningMap: PlanningMapState;
  projectInstruments: InstrumentLibrary;
  selectedInstrument: string;
  levelLoopCustomPresets: CustomLevelLoopTolerancePreset[];
  surveyCadState: SurveyCadPersistedState | null;
};

export const buildPortablePayloadFromState = ({
  projectSession,
  savedRunSnapshots,
  workspace,
}: {
  projectSession: ProjectSessionState | null;
  savedRunSnapshots: PersistedSavedRunSnapshot[];
  workspace: ProjectFlatWorkspacePayloadOptions;
}): ParsedProjectPayload => {
  const focusedFile = projectSession ? getProjectFocusedFile(projectSession.manifest) : null;
  const normalizedWorkspace = projectSession
    ? normalizeWorkspaceState(projectSession.manifest.files, projectSession.manifest.workspace)
    : null;
  return {
    schemaVersion: 5,
    input: projectSession
      ? projectSession.sourceTexts[focusedFile?.id ?? ''] ?? ''
      : workspace.input,
    includeFiles: projectSession
      ? buildProjectEditorIncludeFiles(
          projectSession.manifest,
          projectSession.sourceTexts,
          focusedFile?.id,
        )
      : workspace.includeFiles,
    workspaceFileContents: projectSession ? { ...projectSession.sourceTexts } : undefined,
    savedRuns: savedRunSnapshots,
    ui: buildProjectUiPayload(workspace, undefined),
    project: buildProjectDomainPayload(workspace),
    workspace:
      projectSession && normalizedWorkspace
        ? {
            projectId: projectSession.manifest.projectId,
            name: projectSession.manifest.name,
            createdAt: projectSession.manifest.createdAt,
            updatedAt: projectSession.manifest.updatedAt,
            files: projectSession.manifest.files.map((file) => ({ ...file })),
            openFileIds: normalizedWorkspace.openFileIds,
            focusedFileId: normalizedWorkspace.focusedFileId,
            mainFileId: normalizedWorkspace.mainFileId,
          }
        : undefined,
  };
};

export const buildParsedPayloadFromSession = (
  session: ProjectSessionState,
): ParsedProjectPayload => {
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
      geoidSourceDataBase64: session.manifest.ui.geoidSourceDataBase64 ?? null,
      geoidSourceDataLabel: session.manifest.ui.geoidSourceDataLabel ?? '',
      exportFormat: session.manifest.ui.exportFormat,
      adjustedPointsExport: session.manifest.ui.adjustedPointsExport,
      planningMap: session.manifest.ui.planningMap,
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
};

export const createFlatProjectManifestSeed = ({
  projectId,
  name,
  createdAt,
  updatedAt,
  workspace,
  cloneInstrumentLibrary,
}: {
  projectId?: string;
  name: string;
  createdAt?: string;
  updatedAt: string;
  workspace: ProjectFlatWorkspacePayloadOptions;
  cloneInstrumentLibrary: (_library: InstrumentLibrary) => InstrumentLibrary;
}) =>
  createManifestFromFlatProject({
    projectId,
    name,
    createdAt,
    updatedAt,
    input: workspace.input,
    includeFiles: workspace.includeFiles,
    ui: buildProjectUiPayload(workspace, {
      parseModeMigrated: true,
      migratedAt: updatedAt,
      listingSortModeVersion: 2,
    }),
    project: {
      ...buildProjectDomainPayload(workspace),
      projectInstruments: cloneInstrumentLibrary(workspace.projectInstruments),
    },
  });

export const createManifestSeedFromPortablePayload = ({
  parsed,
  createdAt,
  updatedAt,
}: {
  parsed: ParsedProjectPayload;
  createdAt: string;
  updatedAt: string;
}) =>
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
            planningMap: parsed.ui.planningMap,
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
          geoidSourceDataBase64: parsed.ui.geoidSourceDataBase64 ?? null,
          geoidSourceDataLabel: parsed.ui.geoidSourceDataLabel ?? '',
          exportFormat: parsed.ui.exportFormat,
          adjustedPointsExport: parsed.ui.adjustedPointsExport,
          planningMap: parsed.ui.planningMap,
          migration: parsed.ui.migration,
        },
        project: parsed.project,
        preferredFocusedFileId: parsed.workspace?.focusedFileId,
      });

const buildProjectUiPayload = (
  workspace: ProjectFlatWorkspacePayloadOptions,
  migration:
    | {
        parseModeMigrated: boolean;
        migratedAt?: string;
        listingSortModeVersion?: number;
      }
    | undefined,
) => ({
  settings: workspace.settings as unknown as Record<string, unknown>,
  parseSettings: workspace.parseSettings as unknown as Record<string, unknown>,
  geoidSourceDataBase64: encodeUint8ArrayToBase64(workspace.geoidSourceData),
  geoidSourceDataLabel: workspace.geoidSourceDataLabel,
  exportFormat: workspace.exportFormat,
  adjustedPointsExport: cloneAdjustedPointsExportSettings(
    workspace.adjustedPointsExportSettings,
  ),
  planningMap: clonePlanningMapState(workspace.planningMap),
  migration,
});

const buildProjectDomainPayload = (workspace: ProjectFlatWorkspacePayloadOptions) => ({
  projectInstruments: workspace.projectInstruments,
  selectedInstrument: workspace.selectedInstrument,
  levelLoopCustomPresets: workspace.levelLoopCustomPresets.map((preset) => ({ ...preset })),
  surveyCad: workspace.surveyCadState
    ? cloneSurveyCadPersistedState(workspace.surveyCadState)
    : undefined,
});
