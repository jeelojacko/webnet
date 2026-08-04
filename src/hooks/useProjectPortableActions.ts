import { useCallback, type ChangeEvent, type Dispatch, type SetStateAction } from 'react';
import type {
  ParseSettings,
  PersistedSavedRunSnapshot,
  SettingsState,
} from '../appStateTypes';
import {
  assertBrowserFileSize,
  MAX_PORTABLE_PROJECT_TEXT_BYTES,
  MAX_PROJECT_BUNDLE_BYTES,
  readBrowserFileAsText,
  readBrowserFileAsUint8Array,
  saveBrowserBinaryFile,
  saveBrowserTextFile,
} from '../engine/browserFileIo';
import {
  buildProjectBundleBytes,
  parseProjectBundleBytes,
} from '../engine/projectBundle';
import { buildSurveyCadSidecarText } from '../engine/projectExportSlimming';
import {
  parseProjectFile,
  serializeProjectFile,
  type ParsedProjectPayload,
} from '../engine/projectFile';
import { buildProjectIndexRow, requestPersistentStorage } from '../engine/projectStorage';
import type {
  ProjectSessionState,
  ProjectStorageStatus,
} from '../engine/projectWorkspace';
import type {
  AdjustedPointsExportSettings,
  CustomLevelLoopTolerancePreset,
  InstrumentLibrary,
  ProjectExportFormat,
} from '../types';
import {
  buildParsedPayloadFromSession,
  createFlatProjectManifestSeed,
  createManifestSeedFromPortablePayload,
  type ProjectFlatWorkspacePayloadOptions,
} from './projectFilePayloadBuilders';

const PROJECT_IMPORT_FILE_TYPES = [
  {
    description: 'WebNet Project',
    accept: {
      'application/json': ['.wnproj', '.wnproj.json', '.json'],
      'application/zip': ['.zip'],
    },
  },
];

type ImportNotice = {
  title: string;
  detailLines: string[];
};

interface UseProjectPortableActionsArgs {
  adjustedPointsExportSettings: AdjustedPointsExportSettings;
  applyLoadedProjectPayload: (
    _parsed: ParsedProjectPayload,
    _nextSession: ProjectSessionState | null,
    _savedRuns: PersistedSavedRunSnapshot[],
  ) => void;
  buildPortablePayload: () => ParsedProjectPayload;
  canUseNamedProjectStorage: boolean;
  cloneInstrumentLibrary: (_library: InstrumentLibrary) => InstrumentLibrary;
  exportFormat: ProjectExportFormat;
  levelLoopCustomPresets: CustomLevelLoopTolerancePreset[];
  parseSettings: ParseSettings;
  projectFlatWorkspacePayload: ProjectFlatWorkspacePayloadOptions;
  projectInstruments: InstrumentLibrary;
  projectSession: ProjectSessionState | null;
  refreshStorageContext: () => Promise<void>;
  selectedInstrument: string;
  setImportNotice: Dispatch<SetStateAction<ImportNotice | null>>;
  setProjectSession: Dispatch<SetStateAction<ProjectSessionState | null>>;
  settings: SettingsState;
  storage: ReturnType<typeof import('../engine/projectStorage').createProjectStorage>;
  storageStatus: ProjectStorageStatus | null;
}

export const useProjectPortableActions = ({
  adjustedPointsExportSettings,
  applyLoadedProjectPayload,
  buildPortablePayload,
  canUseNamedProjectStorage,
  cloneInstrumentLibrary,
  exportFormat,
  levelLoopCustomPresets,
  parseSettings,
  projectFlatWorkspacePayload,
  projectInstruments,
  projectSession,
  refreshStorageContext,
  selectedInstrument,
  setImportNotice,
  setProjectSession,
  settings,
  storage,
  storageStatus,
}: UseProjectPortableActionsArgs) => {
  const exportPortableProject = useCallback(async () => {
    const payload = buildPortablePayload();
    const suggestedName = projectSession
      ? `${projectSession.manifest.name.replace(/\s+/g, '-').toLowerCase()}.wnproj.json`
      : `webnet-project-${new Date().toISOString().slice(0, 10)}.wnproj.json`;
    const saved = await saveBrowserTextFile(
      suggestedName,
      serializeProjectFile(payload),
      PROJECT_IMPORT_FILE_TYPES,
    );
    if (!saved) return;
    const surveyCad = projectFlatWorkspacePayload.surveyCadState ?? payload.project.surveyCad;
    if (surveyCad) {
      const sidecarName = suggestedName.replace(/\.wnproj(?:\.json)?$/i, '.survey-cad.json');
      await saveBrowserTextFile(
        sidecarName,
        buildSurveyCadSidecarText(surveyCad),
        PROJECT_IMPORT_FILE_TYPES,
      );
    }
    setImportNotice({
      title: 'Portable project exported',
      detailLines: surveyCad
        ? [`Wrote ${suggestedName}.`, 'Wrote Survey CAD state to a separate sidecar file.']
        : [`Wrote ${suggestedName}.`],
    });
  }, [buildPortablePayload, projectFlatWorkspacePayload.surveyCadState, projectSession, setImportNotice]);

  const exportProjectBundle = useCallback(async () => {
    const seed =
      projectSession != null
        ? {
            manifest: projectSession.manifest,
            sourceTexts: projectSession.sourceTexts,
          }
        : createFlatProjectManifestSeed({
            name: `WebNet Project ${new Date().toISOString().slice(0, 10)}`,
            updatedAt: new Date().toISOString(),
            workspace: projectFlatWorkspacePayload,
            cloneInstrumentLibrary,
          });
    const bundleBytes = buildProjectBundleBytes(seed);
    const suggestedName = `${(projectSession?.manifest.name ?? 'webnet-project')
      .replace(/\s+/g, '-')
      .toLowerCase()}.zip`;
    const saved = await saveBrowserBinaryFile(suggestedName, bundleBytes, PROJECT_IMPORT_FILE_TYPES);
    if (!saved) return;
    setImportNotice({
      title: 'Project bundle exported',
      detailLines: [`Wrote ${suggestedName}.`],
    });
  }, [
    cloneInstrumentLibrary,
    projectFlatWorkspacePayload,
    projectSession,
    setImportNotice,
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
      const manifestSeed = createManifestSeedFromPortablePayload({
        parsed,
        createdAt,
        updatedAt,
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
      setProjectSession,
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
      canUseNamedProjectStorage,
      refreshStorageContext,
      setImportNotice,
      setProjectSession,
      storage,
      storageStatus?.preferredBackend,
    ],
  );

  const openPermanentExampleProject = useCallback(
    async (projectUrl: string) => {
      try {
        const response = await fetch(projectUrl);
        if (!response.ok) {
          throw new Error(`Example project request failed (${response.status}).`);
        }
        const rawText = await response.text();
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
            title: 'Example project load failed',
            detailLines: parsed.errors,
          });
          return;
        }
        await importPortablePayloadAsLocalProject(parsed.project);
      } catch (error) {
        setImportNotice({
          title: 'Example project load failed',
          detailLines: [error instanceof Error ? error.message : String(error)],
        });
      }
    },
    [
      adjustedPointsExportSettings,
      exportFormat,
      importPortablePayloadAsLocalProject,
      levelLoopCustomPresets,
      parseSettings,
      projectInstruments,
      selectedInstrument,
      setImportNotice,
      settings,
    ],
  );

  const handleProjectFileChange = useCallback(
    async (e: ChangeEvent<HTMLInputElement>) => {
      const file = e.target.files?.[0];
      if (!file) return;
      e.target.value = '';
      try {
        if (file.name.toLowerCase().endsWith('.zip')) {
          assertBrowserFileSize(file, MAX_PROJECT_BUNDLE_BYTES, `${file.name} project bundle`);
          const bytes = await readBrowserFileAsUint8Array(file);
          await importProjectBundleAsLocalProject(bytes);
          return;
        }
        assertBrowserFileSize(file, MAX_PORTABLE_PROJECT_TEXT_BYTES, `${file.name} project file`);
        const rawText = await readBrowserFileAsText(file);
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

  return {
    exportPortableProject,
    exportProjectBundle,
    handleProjectFileChange,
    openPermanentExampleProject,
    importPortablePayloadAsLocalProject,
    importProjectBundleAsLocalProject,
  };
};
