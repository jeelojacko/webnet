import { useCallback, useEffect, useState, type Dispatch, type SetStateAction } from 'react';
import type {
  AdjustedPointsExportSettings,
  CustomLevelLoopTolerancePreset,
  InstrumentLibrary,
} from '../types';
import type {
  CrsCatalogGroupFilter,
  ParseSettings,
  ProjectOptionsTab,
  SettingsState,
} from '../appStateTypes';

interface UseProjectOptionsStateArgs {
  initialSettingsModalOpen: boolean;
  initialOptionsTab: ProjectOptionsTab;
  settings: SettingsState;
  setSettings: Dispatch<SetStateAction<SettingsState>>;
  parseSettings: ParseSettings;
  setParseSettings: Dispatch<SetStateAction<ParseSettings>>;
  geoidSourceData: Uint8Array | null;
  setGeoidSourceData: Dispatch<SetStateAction<Uint8Array | null>>;
  geoidSourceDataLabel: string;
  setGeoidSourceDataLabel: Dispatch<SetStateAction<string>>;
  projectInstruments: InstrumentLibrary;
  setProjectInstruments: Dispatch<SetStateAction<InstrumentLibrary>>;
  levelLoopCustomPresets: CustomLevelLoopTolerancePreset[];
  setLevelLoopCustomPresets: Dispatch<SetStateAction<CustomLevelLoopTolerancePreset[]>>;
  adjustedPointsExportSettings: AdjustedPointsExportSettings;
  setAdjustedPointsExportSettings: Dispatch<SetStateAction<AdjustedPointsExportSettings>>;
  selectedInstrument: string;
  setSelectedInstrument: Dispatch<SetStateAction<string>>;
  cloneInstrumentLibrary: (_library: InstrumentLibrary) => InstrumentLibrary;
  cloneAdjustedPointsExportSettings: (
    _settings: AdjustedPointsExportSettings,
  ) => AdjustedPointsExportSettings;
  sanitizeAdjustedPointsExportSettings: (
    _settings: AdjustedPointsExportSettings,
  ) => AdjustedPointsExportSettings;
  normalizeUiTheme: (_value: unknown) => SettingsState['uiTheme'];
  resolveCatalogGroupFromCrsId: (_crsId?: string) => CrsCatalogGroupFilter;
  parseTransformAngleInput: (_raw: string) => number | null;
}

export const useProjectOptionsState = ({
  initialSettingsModalOpen,
  initialOptionsTab,
  settings,
  setSettings,
  parseSettings,
  setParseSettings,
  geoidSourceData,
  setGeoidSourceData,
  geoidSourceDataLabel,
  setGeoidSourceDataLabel,
  projectInstruments,
  setProjectInstruments,
  levelLoopCustomPresets,
  setLevelLoopCustomPresets,
  adjustedPointsExportSettings,
  setAdjustedPointsExportSettings,
  selectedInstrument,
  setSelectedInstrument,
  cloneInstrumentLibrary,
  cloneAdjustedPointsExportSettings,
  sanitizeAdjustedPointsExportSettings,
  normalizeUiTheme,
  resolveCatalogGroupFromCrsId,
  parseTransformAngleInput,
}: UseProjectOptionsStateArgs) => {
  const [isSettingsModalOpen, setIsSettingsModalOpen] = useState(initialSettingsModalOpen);
  const [activeOptionsTab, setActiveOptionsTab] = useState<ProjectOptionsTab>(initialOptionsTab);
  const [settingsDraft, setSettingsDraft] = useState<SettingsState>(settings);
  const [parseSettingsDraft, setParseSettingsDraft] = useState<ParseSettings>(parseSettings);
  const [geoidSourceDataDraft, setGeoidSourceDataDraft] = useState<Uint8Array | null>(null);
  const [geoidSourceDataLabelDraft, setGeoidSourceDataLabelDraft] = useState('');
  const [crsCatalogGroupFilter, setCrsCatalogGroupFilter] = useState<CrsCatalogGroupFilter>(
    resolveCatalogGroupFromCrsId(parseSettings.crsId),
  );
  const [crsSearchQuery, setCrsSearchQuery] = useState('');
  const [showCrsProjectionParams, setShowCrsProjectionParams] = useState(false);
  const [projectInstrumentsDraft, setProjectInstrumentsDraft] =
    useState<InstrumentLibrary>(projectInstruments);
  const [levelLoopCustomPresetsDraft, setLevelLoopCustomPresetsDraft] =
    useState<CustomLevelLoopTolerancePreset[]>(levelLoopCustomPresets);
  const [adjustedPointsExportSettingsDraft, setAdjustedPointsExportSettingsDraft] =
    useState<AdjustedPointsExportSettings>(() =>
      cloneAdjustedPointsExportSettings(adjustedPointsExportSettings),
    );
  const [isAdjustedPointsTransformSelectOpen, setIsAdjustedPointsTransformSelectOpen] =
    useState(false);
  const [adjustedPointsTransformSelectedDraft, setAdjustedPointsTransformSelectedDraft] =
    useState<string[]>([]);
  const [adjustedPointsRotationAngleInput, setAdjustedPointsRotationAngleInput] = useState('0');
  const [adjustedPointsTranslationAzimuthInput, setAdjustedPointsTranslationAzimuthInput] =
    useState('0');
  const [adjustedPointsRotationAngleError, setAdjustedPointsRotationAngleError] = useState<
    string | null
  >(null);
  const [adjustedPointsTranslationAzimuthError, setAdjustedPointsTranslationAzimuthError] =
    useState<string | null>(null);
  const [selectedInstrumentDraft, setSelectedInstrumentDraft] = useState(selectedInstrument);

  const resetTransformDraftUi = useCallback(() => {
    setIsAdjustedPointsTransformSelectOpen(false);
    setAdjustedPointsTransformSelectedDraft([]);
    setAdjustedPointsRotationAngleError(null);
    setAdjustedPointsTranslationAzimuthError(null);
  }, []);

  const closeProjectOptions = useCallback(() => {
    resetTransformDraftUi();
    setIsSettingsModalOpen(false);
  }, [resetTransformDraftUi]);

  const openProjectOptions = useCallback(() => {
    setSettingsDraft(settings);
    setParseSettingsDraft(parseSettings);
    setGeoidSourceDataDraft(geoidSourceData);
    setGeoidSourceDataLabelDraft(geoidSourceDataLabel);
    setCrsCatalogGroupFilter(resolveCatalogGroupFromCrsId(parseSettings.crsId));
    setCrsSearchQuery('');
    setShowCrsProjectionParams(false);
    setProjectInstrumentsDraft(cloneInstrumentLibrary(projectInstruments));
    setLevelLoopCustomPresetsDraft(levelLoopCustomPresets.map((preset) => ({ ...preset })));
    setAdjustedPointsExportSettingsDraft(
      cloneAdjustedPointsExportSettings(adjustedPointsExportSettings),
    );
    setAdjustedPointsRotationAngleInput(
      String(adjustedPointsExportSettings.transform.rotation.angleDeg ?? 0),
    );
    setAdjustedPointsTranslationAzimuthInput(
      String(adjustedPointsExportSettings.transform.translation.azimuthDeg ?? 0),
    );
    resetTransformDraftUi();
    setSelectedInstrumentDraft(selectedInstrument);
    setActiveOptionsTab('adjustment');
    setIsSettingsModalOpen(true);
  }, [
    adjustedPointsExportSettings,
    cloneAdjustedPointsExportSettings,
    cloneInstrumentLibrary,
    geoidSourceData,
    geoidSourceDataLabel,
    levelLoopCustomPresets,
    parseSettings,
    projectInstruments,
    resetTransformDraftUi,
    resolveCatalogGroupFromCrsId,
    selectedInstrument,
    settings,
  ]);

  const applyProjectOptions = useCallback(() => {
    const normalizedDraft = cloneAdjustedPointsExportSettings(adjustedPointsExportSettingsDraft);
    let rotationAngleError: string | null = null;
    let translationAzimuthError: string | null = null;

    if (normalizedDraft.transform.rotation.enabled) {
      const parsedRotation = parseTransformAngleInput(adjustedPointsRotationAngleInput);
      if (parsedRotation == null) {
        rotationAngleError = 'Error: angle not in correct format.';
      } else if (parsedRotation > 360) {
        rotationAngleError = 'Error: direction cannot be above 360.';
      } else {
        normalizedDraft.transform.rotation.angleDeg = parsedRotation;
      }
    }

    if (
      normalizedDraft.transform.translation.enabled &&
      normalizedDraft.transform.translation.method === 'direction-distance'
    ) {
      const parsedAzimuth = parseTransformAngleInput(adjustedPointsTranslationAzimuthInput);
      if (parsedAzimuth == null) {
        translationAzimuthError = 'Error: azimuth not in correct format.';
      } else if (parsedAzimuth < 0 || parsedAzimuth > 360) {
        translationAzimuthError = 'Error: direction must be between 0 and 360.';
      } else {
        normalizedDraft.transform.translation.azimuthDeg = parsedAzimuth;
      }
    }

    setAdjustedPointsRotationAngleError(rotationAngleError);
    setAdjustedPointsTranslationAzimuthError(translationAzimuthError);
    if (rotationAngleError || translationAzimuthError) {
      return false;
    }

    const sanitizedAdjustedPointsSettings =
      sanitizeAdjustedPointsExportSettings(normalizedDraft);
    const sanitizedSettings: SettingsState = {
      ...settingsDraft,
      uiTheme: normalizeUiTheme(settingsDraft.uiTheme),
    };

    setSettings(sanitizedSettings);
    setSettingsDraft(sanitizedSettings);
    setParseSettings(parseSettingsDraft);
    setGeoidSourceData(geoidSourceDataDraft);
    setGeoidSourceDataLabel(geoidSourceDataLabelDraft);
    setProjectInstruments(cloneInstrumentLibrary(projectInstrumentsDraft));
    setLevelLoopCustomPresets(levelLoopCustomPresetsDraft.map((preset) => ({ ...preset })));
    setAdjustedPointsExportSettings(
      cloneAdjustedPointsExportSettings(sanitizedAdjustedPointsSettings),
    );
    setAdjustedPointsExportSettingsDraft(
      cloneAdjustedPointsExportSettings(sanitizedAdjustedPointsSettings),
    );
    setAdjustedPointsRotationAngleInput(
      String(sanitizedAdjustedPointsSettings.transform.rotation.angleDeg ?? 0),
    );
    setAdjustedPointsTranslationAzimuthInput(
      String(sanitizedAdjustedPointsSettings.transform.translation.azimuthDeg ?? 0),
    );
    setAdjustedPointsRotationAngleError(null);
    setAdjustedPointsTranslationAzimuthError(null);
    setSelectedInstrument(selectedInstrumentDraft);
    setShowCrsProjectionParams(false);
    setIsAdjustedPointsTransformSelectOpen(false);
    setAdjustedPointsTransformSelectedDraft([]);
    setIsSettingsModalOpen(false);
    return true;
  }, [
    adjustedPointsExportSettingsDraft,
    adjustedPointsRotationAngleInput,
    adjustedPointsTranslationAzimuthInput,
    cloneAdjustedPointsExportSettings,
    cloneInstrumentLibrary,
    geoidSourceDataDraft,
    geoidSourceDataLabelDraft,
    levelLoopCustomPresetsDraft,
    normalizeUiTheme,
    parseSettingsDraft,
    parseTransformAngleInput,
    projectInstrumentsDraft,
    sanitizeAdjustedPointsExportSettings,
    selectedInstrumentDraft,
    setAdjustedPointsExportSettings,
    setGeoidSourceData,
    setGeoidSourceDataLabel,
    setLevelLoopCustomPresets,
    setParseSettings,
    setProjectInstruments,
    setSelectedInstrument,
    setSettings,
    settingsDraft,
  ]);

  useEffect(() => {
    const activeTheme = normalizeUiTheme(
      isSettingsModalOpen ? settingsDraft.uiTheme : settings.uiTheme,
    );
    document.documentElement.setAttribute('data-theme', activeTheme);
  }, [isSettingsModalOpen, normalizeUiTheme, settings.uiTheme, settingsDraft.uiTheme]);

  useEffect(() => {
    if (!isSettingsModalOpen) return;
    const codes = Object.keys(projectInstrumentsDraft);
    if (!selectedInstrumentDraft && codes.length > 0) {
      setSelectedInstrumentDraft(codes[0]);
    } else if (selectedInstrumentDraft && !projectInstrumentsDraft[selectedInstrumentDraft]) {
      setSelectedInstrumentDraft(codes[0] || '');
    }
  }, [isSettingsModalOpen, projectInstrumentsDraft, selectedInstrumentDraft]);

  useEffect(() => {
    if (!isSettingsModalOpen) return;
    const handleKey = (event: KeyboardEvent) => {
      if (event.key !== 'Escape') return;
      if (isAdjustedPointsTransformSelectOpen) {
        setIsAdjustedPointsTransformSelectOpen(false);
        setAdjustedPointsTransformSelectedDraft([]);
        return;
      }
      resetTransformDraftUi();
      setIsSettingsModalOpen(false);
    };
    document.addEventListener('keydown', handleKey);
    return () => {
      document.removeEventListener('keydown', handleKey);
    };
  }, [isAdjustedPointsTransformSelectOpen, isSettingsModalOpen, resetTransformDraftUi]);

  return {
    isSettingsModalOpen,
    setIsSettingsModalOpen,
    activeOptionsTab,
    setActiveOptionsTab,
    settingsDraft,
    setSettingsDraft,
    parseSettingsDraft,
    setParseSettingsDraft,
    geoidSourceDataDraft,
    setGeoidSourceDataDraft,
    geoidSourceDataLabelDraft,
    setGeoidSourceDataLabelDraft,
    crsCatalogGroupFilter,
    setCrsCatalogGroupFilter,
    crsSearchQuery,
    setCrsSearchQuery,
    showCrsProjectionParams,
    setShowCrsProjectionParams,
    projectInstrumentsDraft,
    setProjectInstrumentsDraft,
    levelLoopCustomPresetsDraft,
    setLevelLoopCustomPresetsDraft,
    adjustedPointsExportSettingsDraft,
    setAdjustedPointsExportSettingsDraft,
    isAdjustedPointsTransformSelectOpen,
    setIsAdjustedPointsTransformSelectOpen,
    adjustedPointsTransformSelectedDraft,
    setAdjustedPointsTransformSelectedDraft,
    adjustedPointsRotationAngleInput,
    setAdjustedPointsRotationAngleInput,
    adjustedPointsTranslationAzimuthInput,
    setAdjustedPointsTranslationAzimuthInput,
    adjustedPointsRotationAngleError,
    setAdjustedPointsRotationAngleError,
    adjustedPointsTranslationAzimuthError,
    setAdjustedPointsTranslationAzimuthError,
    selectedInstrumentDraft,
    setSelectedInstrumentDraft,
    closeProjectOptions,
    openProjectOptions,
    applyProjectOptions,
  };
};
