import { useCallback, type Dispatch, type SetStateAction } from 'react';
import type {
  ParseSettings,
  SettingsState,
} from '../appStateTypes';
import {
  cloneAdjustedPointsExportSettings,
} from '../engine/adjustedPointsExport';
import {
  assertBrowserFileSize,
  MAX_ASSOCIATED_SETTINGS_TEXT_BYTES,
  readBrowserFileAsText,
} from '../engine/browserFileIo';
import { parseProjectFile, type ParsedProjectPayload } from '../engine/projectFile';
import { touchProjectIndexRow } from '../engine/projectStorage';
import type { ProjectSessionState } from '../engine/projectWorkspace';
import type {
  AdjustedPointsExportSettings,
  CustomLevelLoopTolerancePreset,
  InstrumentLibrary,
  ProjectExportFormat,
} from '../types';
import {
  buildSnprojAssociatedSettingsPayload,
  type PreparedAssociatedProjectSettingsImport,
} from './projectFileAssociatedSettings';

type ImportNotice = {
  title: string;
  detailLines: string[];
};

interface ApplyPreparedAssociatedProjectSettingsOptions {
  successTitle?: string;
  failureTitle?: string;
  successDetailPrefix?: string[];
  failureDetailPrefix?: string[];
}

interface NormalizedProjectPayload {
  normalizedLoadedSettings: SettingsState;
  normalizedLoadedParseSettings: ParseSettings;
  loadedAdjustedPointsSettings: AdjustedPointsExportSettings;
  geoidSourceData: Uint8Array | null;
  geoidSourceDataLabel: string;
  exportFormat: ProjectExportFormat;
  projectInstruments: InstrumentLibrary;
  selectedInstrument: string;
  levelLoopCustomPresets: CustomLevelLoopTolerancePreset[];
}

interface UseAssociatedProjectSettingsWorkflowArgs {
  adjustedPointsExportSettings: AdjustedPointsExportSettings;
  cloneInstrumentLibrary: (_library: InstrumentLibrary) => InstrumentLibrary;
  exportFormat: ProjectExportFormat;
  geoidSourceData?: Uint8Array | null;
  geoidSourceDataLabel?: string;
  levelLoopCustomPresets: CustomLevelLoopTolerancePreset[];
  normalizeImportedProjectPayload: (_parsed: ParsedProjectPayload) => NormalizedProjectPayload;
  parseSettings: ParseSettings;
  projectInstruments: InstrumentLibrary;
  projectSession: ProjectSessionState | null;
  resetWorkspaceAfterProjectLoad: () => void;
  selectedInstrument: string;
  setAdjustedPointsExportSettings: Dispatch<SetStateAction<AdjustedPointsExportSettings>>;
  setAdjustedPointsExportSettingsDraft: Dispatch<SetStateAction<AdjustedPointsExportSettings>>;
  setAdjustedPointsTransformSelectedDraft: Dispatch<SetStateAction<string[]>>;
  setExportFormat: Dispatch<SetStateAction<ProjectExportFormat>>;
  setGeoidSourceData: Dispatch<SetStateAction<Uint8Array | null>>;
  setGeoidSourceDataDraft: Dispatch<SetStateAction<Uint8Array | null>>;
  setGeoidSourceDataLabel: Dispatch<SetStateAction<string>>;
  setGeoidSourceDataLabelDraft: Dispatch<SetStateAction<string>>;
  setImportNotice: Dispatch<SetStateAction<ImportNotice | null>>;
  setIsAdjustedPointsTransformSelectOpen: Dispatch<SetStateAction<boolean>>;
  setLevelLoopCustomPresets: Dispatch<SetStateAction<CustomLevelLoopTolerancePreset[]>>;
  setLevelLoopCustomPresetsDraft: Dispatch<SetStateAction<CustomLevelLoopTolerancePreset[]>>;
  setParseSettings: Dispatch<SetStateAction<ParseSettings>>;
  setParseSettingsDraft: Dispatch<SetStateAction<ParseSettings>>;
  setProjectInstruments: Dispatch<SetStateAction<InstrumentLibrary>>;
  setProjectInstrumentsDraft: Dispatch<SetStateAction<InstrumentLibrary>>;
  setSelectedInstrument: Dispatch<SetStateAction<string>>;
  setSelectedInstrumentDraft: Dispatch<SetStateAction<string>>;
  setSettings: Dispatch<SetStateAction<SettingsState>>;
  setSettingsDraft: Dispatch<SetStateAction<SettingsState>>;
  settings: SettingsState;
  updateProjectSession: (
    _updater: (_current: ProjectSessionState) => ProjectSessionState,
    _options?: { syncEditor?: boolean },
  ) => void;
}

export const useAssociatedProjectSettingsWorkflow = ({
  adjustedPointsExportSettings,
  cloneInstrumentLibrary,
  exportFormat,
  geoidSourceData,
  geoidSourceDataLabel,
  levelLoopCustomPresets,
  normalizeImportedProjectPayload,
  parseSettings,
  projectInstruments,
  projectSession,
  resetWorkspaceAfterProjectLoad,
  selectedInstrument,
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
  settings,
  updateProjectSession,
}: UseAssociatedProjectSettingsWorkflowArgs) => {
  const prepareAssociatedProjectSettingsImport = useCallback(
    async (file: File): Promise<PreparedAssociatedProjectSettingsImport | null> => {
      try {
        assertBrowserFileSize(
          file,
          MAX_ASSOCIATED_SETTINGS_TEXT_BYTES,
          `${file.name} associated settings file`,
        );
        const rawText = await readBrowserFileAsText(file);
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
        const nextGeoidData =
          prepared.payload.ui.geoidSourceDataBase64 != null ? normalized.geoidSourceData : geoidSourceData;
        const nextGeoidLabel =
          prepared.payload.ui.geoidSourceDataLabel != null
            ? normalized.geoidSourceDataLabel
            : geoidSourceDataLabel;
        setSettings(normalized.normalizedLoadedSettings);
        setParseSettings(normalized.normalizedLoadedParseSettings);
        setGeoidSourceData(nextGeoidData ?? null);
        setGeoidSourceDataLabel(nextGeoidLabel ?? '');
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
        setGeoidSourceDataDraft(nextGeoidData ?? null);
        setGeoidSourceDataLabelDraft(nextGeoidLabel ?? '');
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
              if (prepared.payload.ui.geoidSourceDataBase64 != null) {
                current.manifest.ui.geoidSourceDataBase64 = prepared.payload.ui.geoidSourceDataBase64;
              }
              if (prepared.payload.ui.geoidSourceDataLabel != null) {
                current.manifest.ui.geoidSourceDataLabel = prepared.payload.ui.geoidSourceDataLabel;
              }
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
      geoidSourceData,
      geoidSourceDataLabel,
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

  return {
    applyPreparedAssociatedProjectSettings,
    importAssociatedProjectSettingsFile,
    prepareAssociatedProjectSettingsImport,
  };
};
