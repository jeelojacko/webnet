import { useCallback, type ChangeEvent, type Dispatch, type RefObject, type SetStateAction } from 'react';
import { parseProjectFile, serializeProjectFile } from '../engine/projectFile';
import {
  DEFAULT_ADJUSTED_POINTS_EXPORT_SETTINGS,
  cloneAdjustedPointsExportSettings,
  sanitizeAdjustedPointsExportSettings,
} from '../engine/adjustedPointsExport';
import type {
  ParseSettings,
  PersistedSavedRunSnapshot,
  SettingsState,
  SolveProfile,
} from '../appStateTypes';
import type {
  AdjustedPointsExportSettings,
  CustomLevelLoopTolerancePreset,
  FaceNormalizationMode,
  InstrumentLibrary,
  ObservationModeSettings,
  ParseCompatibilityMode,
  ProjectExportFormat,
  RunMode,
} from '../types';

const PROJECT_FILE_TYPES = [
  {
    description: 'WebNet Project',
    accept: { 'application/json': ['.wnproj', '.wnproj.json', '.json'] },
  },
];

const downloadProjectFile = (name: string, text: string) => {
  const blob = new Blob([text], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = name;
  anchor.click();
  URL.revokeObjectURL(url);
};

interface ImportNotice {
  title: string;
  detailLines: string[];
}

interface UseProjectFileWorkflowArgs {
  projectFileInputRef: RefObject<HTMLInputElement | null>;
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
  normalizeSolveProfile: (_profile: SolveProfile) => Exclude<SolveProfile, 'industry-parity'>;
  buildObservationModeFromGridFields: (_state: {
    gridBearingMode: ParseSettings['gridBearingMode'];
    gridDistanceMode: ParseSettings['gridDistanceMode'];
    gridAngleMode: ParseSettings['gridAngleMode'];
    gridDirectionMode: ParseSettings['gridDirectionMode'];
  }) => ObservationModeSettings;
  cloneInstrumentLibrary: (_library: InstrumentLibrary) => InstrumentLibrary;
}

export const useProjectFileWorkflow = ({
  projectFileInputRef,
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
  const triggerProjectFileSelect = useCallback(() => {
    projectFileInputRef.current?.click();
  }, [projectFileInputRef]);

  const handleSaveProject = useCallback(async () => {
    const projectText = serializeProjectFile({
      input,
      includeFiles: projectIncludeFiles,
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
    });
    const suggestedName = `webnet-project-${new Date().toISOString().slice(0, 10)}.wnproj.json`;
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
          suggestedName,
          types: PROJECT_FILE_TYPES,
        });
        const writable = await handle.createWritable();
        await writable.write(projectText);
        await writable.close();
        setImportNotice({
          title: 'Project saved',
          detailLines: ['Project file written successfully.'],
        });
        return;
      } catch (err) {
        if ((err as Error)?.name === 'AbortError') return;
      }
    }
    downloadProjectFile(suggestedName, projectText);
    setImportNotice({
      title: 'Project saved',
      detailLines: [`Downloaded ${suggestedName}.`],
    });
  }, [
    adjustedPointsExportSettings,
    exportFormat,
    input,
    levelLoopCustomPresets,
    parseSettings,
    projectIncludeFiles,
    projectInstruments,
    savedRunSnapshots,
    selectedInstrument,
    setImportNotice,
    settings,
  ]);

  const handleProjectFileChange = useCallback(
    (e: ChangeEvent<HTMLInputElement>) => {
      const file = e.target.files?.[0];
      if (!file) return;
      const reader = new FileReader();
      reader.onload = () => {
        const rawText = typeof reader.result === 'string' ? reader.result : '';
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

        const loadedSettings = parsed.project.ui.settings as unknown as SettingsState;
        const normalizedLoadedSettings: SettingsState = {
          ...loadedSettings,
          uiTheme: normalizeUiTheme(loadedSettings?.uiTheme),
        };
        const loadedParseSettings = parsed.project.ui.parseSettings as unknown as ParseSettings;
        const projectSchemaVersion = parsed.project.schemaVersion;
        const profileForMode = normalizeSolveProfile(
          (loadedParseSettings.solveProfile ?? 'webnet') as SolveProfile,
        );
        const migrationFlag = parsed.project.ui.migration?.parseModeMigrated === true;
        const defaultCompatibilityMode: ParseCompatibilityMode =
          projectSchemaVersion === 1
            ? 'legacy'
            : (loadedParseSettings.parseCompatibilityMode ??
              (migrationFlag
                ? 'strict'
                : profileForMode === 'industry-parity-current' ||
                    profileForMode === 'industry-parity-legacy'
                  ? 'strict'
                  : 'legacy'));
        const defaultFaceNormalizationMode: FaceNormalizationMode =
          loadedParseSettings.faceNormalizationMode ??
          (profileForMode === 'industry-parity-current'
            ? 'on'
            : profileForMode === 'industry-parity-legacy'
              ? 'off'
              : profileForMode === 'legacy-compat'
                ? 'auto'
                : loadedParseSettings.normalize
                  ? 'on'
                  : 'off');
        const defaultMigratedFlag =
          projectSchemaVersion === 1
            ? false
            : (loadedParseSettings.parseModeMigrated ?? migrationFlag);
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
          parseCompatibilityMode:
            loadedParseSettings.parseCompatibilityMode ?? defaultCompatibilityMode,
          faceNormalizationMode: defaultFaceNormalizationMode,
          normalize: defaultFaceNormalizationMode !== 'off',
          parseModeMigrated: defaultMigratedFlag,
          geoidSourceFormat: loadedParseSettings.geoidSourceFormat ?? 'builtin',
          geoidSourcePath: loadedParseSettings.geoidSourcePath ?? '',
          verticalDeflectionNorthSec: loadedParseSettings.verticalDeflectionNorthSec ?? 0,
          verticalDeflectionEastSec: loadedParseSettings.verticalDeflectionEastSec ?? 0,
        };
        const loadedAdjustedPointsSettings = sanitizeAdjustedPointsExportSettings(
          parsed.project.ui.adjustedPointsExport,
          {
            ...DEFAULT_ADJUSTED_POINTS_EXPORT_SETTINGS,
            includeLostStations: normalizedLoadedSettings.listingShowLostStations,
          },
        );
        setInput(parsed.project.input);
        setProjectIncludeFiles({ ...(parsed.project.includeFiles ?? {}) });
        setSettings(normalizedLoadedSettings);
        setParseSettings(normalizedLoadedParseSettings);
        setGeoidSourceData(null);
        setGeoidSourceDataLabel('');
        setExportFormat(parsed.project.ui.exportFormat);
        setAdjustedPointsExportSettings(
          cloneAdjustedPointsExportSettings(loadedAdjustedPointsSettings),
        );
        restoreSavedRunSnapshots(parsed.project.savedRuns);
        setProjectInstruments(cloneInstrumentLibrary(parsed.project.project.projectInstruments));
        setSelectedInstrument(parsed.project.project.selectedInstrument);
        setLevelLoopCustomPresets(
          parsed.project.project.levelLoopCustomPresets.map((preset) => ({ ...preset })),
        );

        setSettingsDraft(normalizedLoadedSettings);
        setParseSettingsDraft(normalizedLoadedParseSettings);
        setGeoidSourceDataDraft(null);
        setGeoidSourceDataLabelDraft('');
        setProjectInstrumentsDraft(cloneInstrumentLibrary(parsed.project.project.projectInstruments));
        setSelectedInstrumentDraft(parsed.project.project.selectedInstrument);
        setLevelLoopCustomPresetsDraft(
          parsed.project.project.levelLoopCustomPresets.map((preset) => ({ ...preset })),
        );
        setAdjustedPointsExportSettingsDraft(
          cloneAdjustedPointsExportSettings(loadedAdjustedPointsSettings),
        );
        setIsAdjustedPointsTransformSelectOpen(false);
        setAdjustedPointsTransformSelectedDraft([]);

        resetWorkspaceAfterProjectLoad();
        setImportNotice({
          title: 'Project loaded',
          detailLines: [`Loaded ${file.name}.`, 'Run Adjust to regenerate reports and outputs.'],
        });
      };
      reader.readAsText(file);
      e.target.value = '';
    },
    [
      adjustedPointsExportSettings,
      buildObservationModeFromGridFields,
      cloneInstrumentLibrary,
      exportFormat,
      levelLoopCustomPresets,
      normalizeSolveProfile,
      normalizeUiTheme,
      parseSettings,
      projectInstruments,
      resetWorkspaceAfterProjectLoad,
      restoreSavedRunSnapshots,
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
      settings,
    ],
  );

  return {
    triggerProjectFileSelect,
    handleSaveProject,
    handleProjectFileChange,
  };
};
