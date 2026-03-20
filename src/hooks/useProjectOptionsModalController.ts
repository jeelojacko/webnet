import type React from 'react';
import type { Dispatch, MutableRefObject, RefObject, SetStateAction } from 'react';
import { LEVEL_LOOP_TOLERANCE_PRESETS } from '../engine/levelLoopTolerance';
import {
  ADJUSTED_POINTS_PRESET_COLUMNS,
  inferAdjustedPointsPresetId,
} from '../engine/adjustedPointsExport';
import { useProjectOptionsState } from './useProjectOptionsState';
import type {
  CrsCatalogGroupFilter,
  ParseSettings,
  RunDiagnostics,
  SettingsState,
  SolveProfile,
  UiTheme,
} from '../appStateTypes';
import type {
  AdjustedPointsColumnId,
  AdjustedPointsExportSettings,
  AdjustedPointsPresetId,
  CustomLevelLoopTolerancePreset,
  GeoidSourceFormat,
  Instrument,
  ObservationModeSettings,
  ParseCompatibilityMode,
  ProjectExportFormat,
  RunMode,
} from '../types';

type ProjectOptionsStateValue = ReturnType<typeof useProjectOptionsState>;

type UseProjectOptionsModalControllerArgs = {
  projectOptionsState: ProjectOptionsStateValue;
  adjustedPointsDraftStationIds: string[];
  adjustedPointsTransformDraftValidationMessage: string | null;
  crsCatalogGroupCounts: Record<string, number>;
  filteredDraftCrsCatalog: unknown[];
  searchedDraftCrsCatalog: unknown[];
  visibleDraftCrsCatalog: unknown[];
  selectedDraftCrs?: unknown;
  selectedCrsProj4Params: Array<{ key: string; value: string }>;
  exportFormat: ProjectExportFormat;
  setExportFormat: Dispatch<SetStateAction<ProjectExportFormat>>;
  handleSaveProject: () => void;
  triggerProjectFileSelect: () => void;
  geoidSourceFileInputRef: RefObject<HTMLInputElement | null>;
  settingsModalContentRef: RefObject<HTMLDivElement | null>;
  adjustedPointsDragRef: MutableRefObject<AdjustedPointsColumnId | null>;
  runDiagnostics: RunDiagnostics | null;
  normalizeSolveProfile: (
    _profile: SolveProfile,
  ) => Exclude<SolveProfile, 'industry-parity'>;
  normalizeUiTheme: (_value: unknown) => UiTheme;
  buildObservationModeFromGridFields: (_state: {
    gridBearingMode: ParseSettings['gridBearingMode'];
    gridDistanceMode: ParseSettings['gridDistanceMode'];
    gridAngleMode: ParseSettings['gridAngleMode'];
    gridDirectionMode: ParseSettings['gridDirectionMode'];
  }) => ObservationModeSettings;
  createInstrument: (_code: string, _desc?: string) => Instrument;
  createCustomLevelLoopTolerancePreset: (
    _seed?: Partial<Omit<CustomLevelLoopTolerancePreset, 'id'>>,
  ) => CustomLevelLoopTolerancePreset;
  resolveLevelLoopTolerancePreset: (
    _presets: CustomLevelLoopTolerancePreset[],
    _baseMm: number,
    _perSqrtKmMm: number,
  ) => {
    id: string;
    label: string;
    description: string;
  };
  staticContext: Record<string, unknown>;
};

export const useProjectOptionsModalController = ({
  projectOptionsState,
  adjustedPointsDraftStationIds,
  adjustedPointsTransformDraftValidationMessage,
  crsCatalogGroupCounts,
  filteredDraftCrsCatalog,
  searchedDraftCrsCatalog,
  visibleDraftCrsCatalog,
  selectedDraftCrs,
  selectedCrsProj4Params,
  exportFormat,
  setExportFormat,
  handleSaveProject,
  triggerProjectFileSelect,
  geoidSourceFileInputRef,
  settingsModalContentRef,
  adjustedPointsDragRef,
  runDiagnostics,
  normalizeSolveProfile,
  normalizeUiTheme,
  buildObservationModeFromGridFields,
  createInstrument,
  createCustomLevelLoopTolerancePreset,
  resolveLevelLoopTolerancePreset,
  staticContext,
}: UseProjectOptionsModalControllerArgs) => {
  const {
    isSettingsModalOpen,
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
    applyProjectOptions,
  } = projectOptionsState;

  const convergenceDefaultForProfile = (profile: SolveProfile): number => {
    const normalized = normalizeSolveProfile(profile);
    return normalized === 'industry-parity-current' || normalized === 'industry-parity-legacy'
      ? 0.001
      : 0.01;
  };

  const handleDraftUnitChange = (e: React.ChangeEvent<HTMLSelectElement>) => {
    setSettingsDraft((prev) => ({ ...prev, units: e.target.value as SettingsState['units'] }));
  };

  const handleDraftIterChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const val = parseInt(e.target.value, 10) || 1;
    setSettingsDraft((prev) => ({ ...prev, maxIterations: val }));
  };

  const handleDraftConvergenceLimitChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const parsed = Number.parseFloat(e.target.value);
    const val =
      Number.isFinite(parsed) && parsed > 0
        ? parsed
        : convergenceDefaultForProfile(parseSettingsDraft.solveProfile);
    setSettingsDraft((prev) => ({ ...prev, convergenceLimit: val }));
  };

  const handleDraftParseSetting = <K extends keyof ParseSettings>(
    key: K,
    value: ParseSettings[K],
  ) => {
    if (key === 'geoidSourceFormat' && value === 'builtin') {
      setGeoidSourceDataDraft(null);
      setGeoidSourceDataLabelDraft('');
    }
    setParseSettingsDraft((prev) => {
      const next = { ...prev, [key]: value };
      if (key === 'solveProfile') {
        const previousProfile = normalizeSolveProfile(prev.solveProfile);
        const profile = normalizeSolveProfile(value as SolveProfile);
        next.solveProfile = profile;
        if (profile === 'industry-parity-current') {
          next.parseCompatibilityMode = 'strict';
          next.faceNormalizationMode = 'on';
        } else if (profile === 'industry-parity-legacy') {
          next.parseCompatibilityMode = 'strict';
          next.faceNormalizationMode = 'off';
        } else if (profile === 'legacy-compat') {
          next.parseCompatibilityMode = 'legacy';
          next.faceNormalizationMode = 'auto';
        }
        next.normalize = next.faceNormalizationMode !== 'off';
        setSettingsDraft((prevSettings) => {
          const previousDefault = convergenceDefaultForProfile(previousProfile);
          if (Math.abs(prevSettings.convergenceLimit - previousDefault) > 1e-12) {
            return prevSettings;
          }
          return {
            ...prevSettings,
            convergenceLimit: convergenceDefaultForProfile(profile),
          };
        });
        return next;
      }
      if (key === 'runMode') {
        const runMode = value as RunMode;
        next.runMode = runMode;
        next.preanalysisMode = runMode === 'preanalysis';
        if (runMode !== 'adjustment') {
          next.autoAdjustEnabled = false;
        }
        return next;
      }
      if (key === 'preanalysisMode') {
        const preanalysisMode = value as boolean;
        next.preanalysisMode = preanalysisMode;
        next.runMode = preanalysisMode ? 'preanalysis' : 'adjustment';
        if (preanalysisMode) {
          next.autoAdjustEnabled = false;
        }
        return next;
      }
      if (key === 'observationMode') {
        const mode = value as ObservationModeSettings | undefined;
        if (mode) {
          next.gridBearingMode = mode.bearing;
          next.gridDistanceMode = mode.distance;
          next.gridAngleMode = mode.angle;
          next.gridDirectionMode = mode.direction;
          next.observationMode = mode;
        }
        return next;
      }
      if (key === 'faceNormalizationMode') {
        next.faceNormalizationMode = value as ParseSettings['faceNormalizationMode'];
        next.normalize = next.faceNormalizationMode !== 'off';
        return next;
      }
      if (key === 'normalize') {
        next.normalize = value as boolean;
        next.faceNormalizationMode = next.normalize ? 'on' : 'off';
        return next;
      }
      if (
        key === 'gridBearingMode' ||
        key === 'gridDistanceMode' ||
        key === 'gridAngleMode' ||
        key === 'gridDirectionMode'
      ) {
        next.observationMode = buildObservationModeFromGridFields(next);
      }
      if (key === 'geoidSourceFormat' && value === 'builtin') {
        next.geoidSourcePath = '';
      }
      return next;
    });
  };

  const migrateDraftParseModeToStrict = () => {
    setParseSettingsDraft((prev) => ({
      ...prev,
      parseCompatibilityMode: 'strict' as ParseCompatibilityMode,
      parseModeMigrated: true,
    }));
  };

  const clearDraftGeoidSourceData = () => {
    setGeoidSourceDataDraft(null);
    setGeoidSourceDataLabelDraft('');
  };

  const handleGeoidSourceFilePick = () => {
    geoidSourceFileInputRef.current?.click();
  };

  const handleGeoidSourceFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = () => {
      if (!(reader.result instanceof ArrayBuffer)) return;
      const bytes = new Uint8Array(reader.result);
      const lowerName = file.name.toLowerCase();
      const inferredFormat: GeoidSourceFormat = lowerName.endsWith('.gtx')
        ? 'gtx'
        : lowerName.endsWith('.byn')
          ? 'byn'
          : parseSettingsDraft.geoidSourceFormat === 'builtin'
            ? 'gtx'
            : parseSettingsDraft.geoidSourceFormat;
      setGeoidSourceDataDraft(bytes);
      setGeoidSourceDataLabelDraft(`${file.name} (${bytes.byteLength.toLocaleString()} bytes)`);
      setParseSettingsDraft((prev) => ({
        ...prev,
        geoidSourceFormat: inferredFormat,
        geoidSourcePath: file.name,
      }));
    };
    reader.readAsArrayBuffer(file);
    e.target.value = '';
  };

  const handleDraftAdjustedPointsSetting = <K extends keyof AdjustedPointsExportSettings>(
    key: K,
    value: AdjustedPointsExportSettings[K],
  ) => {
    setAdjustedPointsExportSettingsDraft((prev) => ({ ...prev, [key]: value }));
  };

  const handleDraftAdjustedPointsTransformSetting = <
    K extends keyof AdjustedPointsExportSettings['transform'],
  >(
    key: K,
    value: AdjustedPointsExportSettings['transform'][K],
  ) => {
    setAdjustedPointsExportSettingsDraft((prev) => ({
      ...prev,
      transform: {
        ...prev.transform,
        [key]: value,
      },
    }));
  };

  const handleDraftAdjustedPointsRotationSetting = <
    K extends keyof AdjustedPointsExportSettings['transform']['rotation'],
  >(
    key: K,
    value: AdjustedPointsExportSettings['transform']['rotation'][K],
  ) => {
    setAdjustedPointsExportSettingsDraft((prev) => ({
      ...prev,
      transform: {
        ...prev.transform,
        rotation: {
          ...prev.transform.rotation,
          [key]: value,
        },
      },
    }));
  };

  const handleDraftAdjustedPointsTranslationSetting = <
    K extends keyof AdjustedPointsExportSettings['transform']['translation'],
  >(
    key: K,
    value: AdjustedPointsExportSettings['transform']['translation'][K],
  ) => {
    setAdjustedPointsExportSettingsDraft((prev) => ({
      ...prev,
      transform: {
        ...prev.transform,
        translation: {
          ...prev.transform.translation,
          [key]: value,
        },
      },
    }));
  };

  const handleDraftAdjustedPointsScaleSetting = <
    K extends keyof AdjustedPointsExportSettings['transform']['scale'],
  >(
    key: K,
    value: AdjustedPointsExportSettings['transform']['scale'][K],
  ) => {
    setAdjustedPointsExportSettingsDraft((prev) => ({
      ...prev,
      transform: {
        ...prev.transform,
        scale: {
          ...prev.transform.scale,
          [key]: value,
        },
      },
    }));
  };

  const handleDraftAdjustedPointsRotationAngleInput = (raw: string) => {
    setAdjustedPointsRotationAngleInput(raw);
    if (adjustedPointsRotationAngleError) {
      setAdjustedPointsRotationAngleError(null);
    }
  };

  const handleDraftAdjustedPointsTranslationAzimuthInput = (raw: string) => {
    setAdjustedPointsTranslationAzimuthInput(raw);
    if (adjustedPointsTranslationAzimuthError) {
      setAdjustedPointsTranslationAzimuthError(null);
    }
  };

  const openAdjustedPointsTransformSelectModal = () => {
    setAdjustedPointsTransformSelectedDraft([
      ...adjustedPointsExportSettingsDraft.transform.selectedStationIds,
    ]);
    projectOptionsState.setIsAdjustedPointsTransformSelectOpen(true);
  };

  const closeAdjustedPointsTransformSelectModal = () => {
    projectOptionsState.setIsAdjustedPointsTransformSelectOpen(false);
    setAdjustedPointsTransformSelectedDraft([]);
  };

  const handleAdjustedPointsTransformToggleSelected = (stationId: string, enabled: boolean) => {
    setAdjustedPointsTransformSelectedDraft((prev) => {
      const exists = prev.includes(stationId);
      if (enabled && exists) return prev;
      if (!enabled && !exists) return prev;
      if (enabled) return [...prev, stationId];
      return prev.filter((entry) => entry !== stationId);
    });
  };

  const applyAdjustedPointsTransformSelection = () => {
    const stationSet = new Set(adjustedPointsDraftStationIds);
    const nextSelected = [...new Set(adjustedPointsTransformSelectedDraft)].filter((id) =>
      stationSet.has(id),
    );
    handleDraftAdjustedPointsTransformSetting('selectedStationIds', nextSelected);
    closeAdjustedPointsTransformSelectModal();
  };

  const handleAdjustedPointsPresetChange = (presetId: AdjustedPointsPresetId) => {
    if (presetId === 'custom') {
      setAdjustedPointsExportSettingsDraft((prev) => ({ ...prev, presetId: 'custom' }));
      return;
    }
    const columns = ADJUSTED_POINTS_PRESET_COLUMNS[presetId];
    setAdjustedPointsExportSettingsDraft((prev) => ({
      ...prev,
      columns: [...columns],
      presetId,
    }));
  };

  const handleAdjustedPointsToggleColumn = (
    columnId: AdjustedPointsColumnId,
    enabled: boolean,
  ) => {
    setAdjustedPointsExportSettingsDraft((prev) => {
      const currentlyEnabled = prev.columns.includes(columnId);
      if (enabled === currentlyEnabled) return prev;
      if (enabled) {
        if (prev.columns.length >= 6) return prev;
        const nextColumns = [...prev.columns, columnId];
        return {
          ...prev,
          columns: nextColumns,
          presetId: inferAdjustedPointsPresetId(nextColumns),
        };
      }
      if (prev.columns.length <= 1) return prev;
      const nextColumns = prev.columns.filter((entry) => entry !== columnId);
      return {
        ...prev,
        columns: nextColumns,
        presetId: inferAdjustedPointsPresetId(nextColumns),
      };
    });
  };

  const handleAdjustedPointsMoveColumn = (
    columnId: AdjustedPointsColumnId,
    direction: 'left' | 'right',
  ) => {
    setAdjustedPointsExportSettingsDraft((prev) => {
      const index = prev.columns.indexOf(columnId);
      if (index < 0) return prev;
      const targetIndex = direction === 'left' ? index - 1 : index + 1;
      if (targetIndex < 0 || targetIndex >= prev.columns.length) return prev;
      const nextColumns = [...prev.columns];
      const [moved] = nextColumns.splice(index, 1);
      nextColumns.splice(targetIndex, 0, moved);
      return {
        ...prev,
        columns: nextColumns,
        presetId: inferAdjustedPointsPresetId(nextColumns),
      };
    });
  };

  const handleAdjustedPointsDragStart = (columnId: AdjustedPointsColumnId) => {
    adjustedPointsDragRef.current = columnId;
  };

  const handleAdjustedPointsDrop = (targetColumnId: AdjustedPointsColumnId) => {
    const sourceColumn = adjustedPointsDragRef.current;
    adjustedPointsDragRef.current = null;
    if (!sourceColumn || sourceColumn === targetColumnId) return;
    setAdjustedPointsExportSettingsDraft((prev) => {
      const sourceIndex = prev.columns.indexOf(sourceColumn);
      const targetIndex = prev.columns.indexOf(targetColumnId);
      if (sourceIndex < 0 || targetIndex < 0) return prev;
      const nextColumns = [...prev.columns];
      const [moved] = nextColumns.splice(sourceIndex, 1);
      nextColumns.splice(targetIndex, 0, moved);
      return {
        ...prev,
        columns: nextColumns,
        presetId: inferAdjustedPointsPresetId(nextColumns),
      };
    });
  };

  const handleLevelLoopPresetChange = (presetId: string) => {
    if (presetId === 'custom') return;
    const preset = LEVEL_LOOP_TOLERANCE_PRESETS.find((row) => row.id === presetId);
    if (preset) {
      setParseSettingsDraft((prev) => ({
        ...prev,
        levelLoopToleranceBaseMm: preset.baseMm,
        levelLoopTolerancePerSqrtKmMm: preset.perSqrtKmMm,
      }));
      return;
    }
    const customPreset = levelLoopCustomPresetsDraft.find((row) => row.id === presetId);
    if (!customPreset) return;
    setParseSettingsDraft((prev) => ({
      ...prev,
      levelLoopToleranceBaseMm: customPreset.baseMm,
      levelLoopTolerancePerSqrtKmMm: customPreset.perSqrtKmMm,
    }));
  };

  const handleLevelLoopCustomPresetFieldChange = (
    id: string,
    key: keyof Omit<CustomLevelLoopTolerancePreset, 'id'>,
    value: string,
  ) => {
    setLevelLoopCustomPresetsDraft((prev) =>
      prev.map((preset) => {
        if (preset.id !== id) return preset;
        if (key === 'name') {
          return { ...preset, name: value };
        }
        const parsed = Number.parseFloat(value);
        return {
          ...preset,
          [key]: Number.isFinite(parsed) ? Math.max(0, parsed) : 0,
        };
      }),
    );
  };

  const addLevelLoopCustomPreset = () => {
    setLevelLoopCustomPresetsDraft((prev) => [
      ...prev,
      createCustomLevelLoopTolerancePreset({
        name: `Custom ${prev.length + 1}`,
        baseMm: parseSettingsDraft.levelLoopToleranceBaseMm,
        perSqrtKmMm: parseSettingsDraft.levelLoopTolerancePerSqrtKmMm,
      }),
    ]);
  };

  const removeLevelLoopCustomPreset = (id: string) => {
    setLevelLoopCustomPresetsDraft((prev) => prev.filter((preset) => preset.id !== id));
  };

  const handleDraftSetting = <K extends keyof SettingsState>(key: K, value: SettingsState[K]) => {
    setSettingsDraft((prev) => ({ ...prev, [key]: value }));
  };

  const handleInstrumentFieldChange = (
    code: string,
    key: keyof Instrument,
    value: number | string,
  ) => {
    setProjectInstrumentsDraft((prev) => {
      const current = prev[code] ?? createInstrument(code, code);
      return {
        ...prev,
        [code]: {
          ...current,
          [key]: value,
        },
      };
    });
  };

  const handleInstrumentLinearFieldChange = (
    code: string,
    key: keyof Instrument,
    value: string,
    units: SettingsState['units'],
  ) => {
    const parsed = Number.parseFloat(value);
    const displayValue = Number.isFinite(parsed) ? parsed : 0;
    const metricValue =
      units === 'ft'
        ? displayValue / ((staticContext.FT_PER_M as number | undefined) ?? 3.280839895)
        : displayValue;
    handleInstrumentFieldChange(code, key, metricValue);
  };

  const handleInstrumentNumericFieldChange = (
    code: string,
    key: keyof Instrument,
    value: string,
  ) => {
    const parsed = Number.parseFloat(value);
    handleInstrumentFieldChange(code, key, Number.isFinite(parsed) ? parsed : 0);
  };

  const addNewInstrument = () => {
    const name = window.prompt('Instrument name');
    if (!name) return;
    const code = name.trim();
    if (!code) return;
    setProjectInstrumentsDraft((prev) => {
      if (prev[code]) return prev;
      return { ...prev, [code]: createInstrument(code, code) };
    });
    setSelectedInstrumentDraft(code);
  };

  const duplicateSelectedInstrument = () => {
    const sourceInstrument = selectedInstrumentDraft
      ? projectInstrumentsDraft[selectedInstrumentDraft]
      : undefined;
    if (!sourceInstrument) return;
    const suggested = `${sourceInstrument.code}_COPY`;
    const name = window.prompt('Name for duplicated instrument', suggested);
    if (!name) return;
    const code = name.trim();
    if (!code) return;
    if (projectInstrumentsDraft[code]) {
      window.alert(`Instrument "${code}" already exists.`);
      return;
    }
    setProjectInstrumentsDraft((prev) => ({
      ...prev,
      [code]: {
        ...sourceInstrument,
        code,
      },
    }));
    setSelectedInstrumentDraft(code);
  };

  const parityProfileActive = normalizeSolveProfile(parseSettingsDraft.solveProfile) !== 'webnet';
  const selectedInstrumentMeta = selectedInstrumentDraft
    ? projectInstrumentsDraft[selectedInstrumentDraft]
    : undefined;
  const activeLevelLoopPreset = resolveLevelLoopTolerancePreset(
    levelLoopCustomPresetsDraft,
    parseSettingsDraft.levelLoopToleranceBaseMm,
    parseSettingsDraft.levelLoopTolerancePerSqrtKmMm,
  );
  const activeLevelLoopPresetId = activeLevelLoopPreset.id;
  const instrumentLinearUnit = settingsDraft.units === 'ft' ? 'FeetUS' : 'Meters';
  const displayLinear = (meters: number): number =>
    settingsDraft.units === 'ft'
      ? meters * ((staticContext.FT_PER_M as number | undefined) ?? 3.280839895)
      : meters;
  const adjustedPointsTransformSelectedInSetCount = adjustedPointsExportSettingsDraft.transform.selectedStationIds.filter(
    (id) => adjustedPointsDraftStationIds.includes(id),
  ).length;

  const projectOptionsModalContext = {
    ...staticContext,
    activeLevelLoopPreset,
    activeLevelLoopPresetId,
    activeOptionsTab,
    addLevelLoopCustomPreset,
    addNewInstrument,
    adjustedPointsDraftStationIds,
    adjustedPointsExportSettingsDraft,
    adjustedPointsRotationAngleError,
    adjustedPointsRotationAngleInput,
    adjustedPointsTransformDraftValidationMessage,
    adjustedPointsTransformSelectedInSetCount,
    adjustedPointsTranslationAzimuthError,
    adjustedPointsTranslationAzimuthInput,
    applyAdjustedPointsTransformSelection,
    applyProjectOptions,
    clearDraftGeoidSourceData,
    closeProjectOptions,
    crsCatalogGroupCounts,
    crsCatalogGroupFilter,
    crsSearchQuery,
    displayLinear,
    duplicateSelectedInstrument,
    exportFormat,
    filteredDraftCrsCatalog,
    geoidSourceDataDraft,
    geoidSourceDataLabelDraft,
    geoidSourceFileInputRef,
    handleAdjustedPointsDragStart,
    handleAdjustedPointsDrop,
    handleAdjustedPointsMoveColumn,
    handleAdjustedPointsPresetChange,
    handleAdjustedPointsToggleColumn,
    handleAdjustedPointsTransformToggleSelected,
    handleDraftAdjustedPointsRotationAngleInput,
    handleDraftAdjustedPointsRotationSetting,
    handleDraftAdjustedPointsScaleSetting,
    handleDraftAdjustedPointsSetting,
    handleDraftAdjustedPointsTransformSetting,
    handleDraftAdjustedPointsTranslationAzimuthInput,
    handleDraftAdjustedPointsTranslationSetting,
    handleDraftConvergenceLimitChange,
    handleDraftIterChange,
    handleDraftParseSetting,
    handleDraftSetting,
    handleDraftUnitChange,
    handleGeoidSourceFileChange,
    handleGeoidSourceFilePick,
    handleInstrumentFieldChange,
    handleInstrumentLinearFieldChange,
    handleInstrumentNumericFieldChange,
    handleLevelLoopCustomPresetFieldChange,
    handleLevelLoopPresetChange,
    handleSaveProject,
    instrumentLinearUnit,
    isSettingsModalOpen,
    levelLoopCustomPresetsDraft,
    migrateDraftParseModeToStrict,
    normalizeSolveProfile,
    normalizeUiTheme,
    openAdjustedPointsTransformSelectModal,
    parityProfileActive,
    parseSettingsDraft,
    projectInstrumentsDraft,
    removeLevelLoopCustomPreset,
    runDiagnostics,
    searchedDraftCrsCatalog,
    selectedCrsProj4Params,
    selectedDraftCrs,
    selectedInstrumentDraft,
    selectedInstrumentMeta,
    setActiveOptionsTab,
    setCrsCatalogGroupFilter,
    setCrsSearchQuery,
    setExportFormat,
    setSelectedInstrumentDraft,
    setShowCrsProjectionParams,
    settingsDraft,
    settingsModalContentRef,
    showCrsProjectionParams,
    triggerProjectFileSelect,
    visibleDraftCrsCatalog,
  };

  return {
    applyAdjustedPointsTransformSelection,
    closeAdjustedPointsTransformSelectModal,
    handleAdjustedPointsTransformToggleSelected,
    projectOptionsModalContext,
  };
};
