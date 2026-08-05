import { useCallback, useMemo } from 'react';
import type { ParseSettings, PersistedSavedRunSnapshot, SettingsState } from '../appStateTypes';
import type { CadDrawingDocument } from '../engine/cad/cadTypes';
import type { ParsedProjectPayload } from '../engine/projectFile';
import {
  buildProjectEditorIncludeFiles,
  buildProjectLegacyIncludeFiles,
  buildProjectLegacySolveInput,
  buildProjectRunFiles,
  getProjectFocusedFile,
  normalizeWorkspaceState,
  type ProjectRunFile,
  type ProjectSessionState,
  type ProjectSourceFileKind,
} from '../engine/projectWorkspace';
import type {
  AdjustedPointsExportSettings,
  CustomLevelLoopTolerancePreset,
  InstrumentLibrary,
  PlanningMapState,
  ProjectExportFormat,
} from '../types';
import {
  buildPortablePayloadFromState,
  type ProjectFlatWorkspacePayloadOptions,
} from './projectFilePayloadBuilders';

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

const buildCombinedRunInput = (runFiles: ProjectRunFile[]): string =>
  runFiles.map((file) => file.content).join('\n');

interface UseProjectWorkflowDerivedStateArgs {
  adjustedPointsExportSettings: AdjustedPointsExportSettings;
  exportFormat: ProjectExportFormat;
  geoidSourceData: Uint8Array | null;
  geoidSourceDataLabel: string;
  input: string;
  levelLoopCustomPresets: CustomLevelLoopTolerancePreset[];
  parseSettings: ParseSettings;
  planningMap: PlanningMapState;
  projectIncludeFiles: Record<string, string>;
  projectInstruments: InstrumentLibrary;
  projectSession: ProjectSessionState | null;
  savedRunSnapshots: PersistedSavedRunSnapshot[];
  selectedInstrument: string;
  settings: SettingsState;
  surveyCadState: CadDrawingDocument | null;
}

export const useProjectWorkflowDerivedState = ({
  adjustedPointsExportSettings,
  exportFormat,
  geoidSourceData,
  geoidSourceDataLabel,
  input,
  levelLoopCustomPresets,
  parseSettings,
  planningMap,
  projectIncludeFiles,
  projectInstruments,
  projectSession,
  savedRunSnapshots,
  selectedInstrument,
  settings,
  surveyCadState,
}: UseProjectWorkflowDerivedStateArgs) => {
  const projectFlatWorkspacePayload = useMemo<ProjectFlatWorkspacePayloadOptions>(
    () => ({
      input,
      includeFiles: projectIncludeFiles,
      settings,
      parseSettings,
      geoidSourceData,
      geoidSourceDataLabel,
      exportFormat,
      adjustedPointsExportSettings,
      planningMap,
      projectInstruments,
      selectedInstrument,
      levelLoopCustomPresets,
      surveyCadState,
    }),
    [
      adjustedPointsExportSettings,
      exportFormat,
      geoidSourceData,
      geoidSourceDataLabel,
      input,
      levelLoopCustomPresets,
      parseSettings,
      planningMap,
      projectIncludeFiles,
      projectInstruments,
      selectedInstrument,
      settings,
      surveyCadState,
    ],
  );

  const buildPortablePayload = useCallback(
    (): ParsedProjectPayload =>
      buildPortablePayloadFromState({
        projectSession,
        savedRunSnapshots,
        workspace: projectFlatWorkspacePayload,
      }),
    [projectFlatWorkspacePayload, projectSession, savedRunSnapshots],
  );

  const effectiveProjectRunFiles = useMemo(
    () =>
      projectSession
        ? buildProjectRunFiles(projectSession.manifest, projectSession.sourceTexts)
        : [],
    [projectSession],
  );

  const effectiveRunInput = useMemo(
    () => (projectSession ? buildCombinedRunInput(effectiveProjectRunFiles) : input),
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

  const activeProjectFileViews = useMemo<ProjectWorkspaceFileView[]>(() => {
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
  }, [projectSession]);

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
    activeProjectFileViews,
    buildPortablePayload,
    currentProjectFile,
    effectiveProjectRunFiles,
    effectiveRunIncludeFiles,
    effectiveRunInput,
    effectiveSolveIncludeFiles,
    effectiveSolveInput,
    getOrderedRunFiles,
    projectFlatWorkspacePayload,
    projectRunValidation,
    validateRunSet,
  };
};
