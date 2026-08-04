import { useRef, useState } from 'react';
import { type InputPaneHandle } from '../components/InputPane';
import type { MapViewSnapshot } from '../components/MapView';
import {
  DEFAULT_ADJUSTED_POINTS_EXPORT_SETTINGS,
  cloneAdjustedPointsExportSettings,
  sanitizeAdjustedPointsExportSettings,
} from '../engine/adjustedPointsExport';
import { ACTIVE_PARITY_STARTUP_DEFAULTS } from '../app/appConfig';
import {
  buildObservationModeFromGridFields,
  cloneInstrumentLibrary,
  normalizeUiTheme,
  resolveCatalogGroupFromCrsId,
} from '../app/appHelpers';
import {
  createInitialAdjustedPointsExportSettings,
  createInitialParseSettings,
  createInitialProjectInstruments,
  createInitialSettingsState,
} from '../app/AppInitialState';
import { parseTransformAngleInput } from '../app/appAngleParsing';
import { useAppLayoutState } from './useAppLayoutState';
import { useProjectOptionsState } from './useProjectOptionsState';
import type {
  ParseSettings,
  ProjectOptionsTab,
  SettingsState,
} from '../appStateTypes';
import type { ParseResult } from '../types';
import type {
  AdjustedPointsColumnId,
  AdjustedPointsExportSettings,
  CustomLevelLoopTolerancePreset,
  InstrumentLibrary,
} from '../types';

type AppControllerStateOptions = {
  initialSettingsModalOpen: boolean;
  initialOptionsTab: ProjectOptionsTab;
};

export const useAppControllerState = ({
  initialSettingsModalOpen,
  initialOptionsTab,
}: AppControllerStateOptions) => {
  const [settings, setSettings] = useState<SettingsState>(createInitialSettingsState);
  const [parseSettings, setParseSettings] = useState<ParseSettings>(createInitialParseSettings);
  const [geoidSourceData, setGeoidSourceData] = useState<Uint8Array | null>(null);
  const [geoidSourceDataLabel, setGeoidSourceDataLabel] = useState('');
  const [projectInstruments, setProjectInstruments] =
    useState<InstrumentLibrary>(createInitialProjectInstruments);
  const [adjustedPointsExportSettings, setAdjustedPointsExportSettings] =
    useState<AdjustedPointsExportSettings>(createInitialAdjustedPointsExportSettings);
  const [levelLoopCustomPresets, setLevelLoopCustomPresets] = useState<
    CustomLevelLoopTolerancePreset[]
  >([]);
  const [selectedInstrument, setSelectedInstrument] = useState(
    ACTIVE_PARITY_STARTUP_DEFAULTS?.selectedInstrument ?? 'S9',
  );
  const {
    splitPercent,
    setSplitPercent,
    isSidebarOpen,
    setIsSidebarOpen,
    layoutRef,
    handleDividerMouseDown,
  } = useAppLayoutState();
  const [mapDeclutterPreset, setMapDeclutterPreset] = useState<'standard' | 'dense-review'>(
    'standard',
  );
  const [mapViewSnapshot, setMapViewSnapshot] = useState<MapViewSnapshot | null>(null);
  const [planningMapPreview, setPlanningMapPreview] = useState<ParseResult | null>(null);

  const projectOptionsState = useProjectOptionsState({
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
    sanitizeAdjustedPointsExportSettings: (draft) =>
      sanitizeAdjustedPointsExportSettings(draft, DEFAULT_ADJUSTED_POINTS_EXPORT_SETTINGS),
    normalizeUiTheme,
    resolveCatalogGroupFromCrsId,
    parseTransformAngleInput,
  });

  return {
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
    adjustedPointsExportSettings,
    setAdjustedPointsExportSettings,
    levelLoopCustomPresets,
    setLevelLoopCustomPresets,
    selectedInstrument,
    setSelectedInstrument,
    splitPercent,
    setSplitPercent,
    isSidebarOpen,
    setIsSidebarOpen,
    layoutRef,
    handleDividerMouseDown,
    mapDeclutterPreset,
    setMapDeclutterPreset,
    mapViewSnapshot,
    setMapViewSnapshot,
    planningMapPreview,
    setPlanningMapPreview,
    projectOptionsState,
    fileInputRef: useRef<HTMLInputElement | null>(null),
    importReviewSettingsFileInputRef: useRef<HTMLInputElement | null>(null),
    projectFileInputRef: useRef<HTMLInputElement | null>(null),
    projectSourceFileInputRef: useRef<HTMLInputElement | null>(null),
    geoidSourceFileInputRef: useRef<HTMLInputElement | null>(null),
    inputPaneRef: useRef<InputPaneHandle | null>(null),
    adjustedPointsDragRef: useRef<AdjustedPointsColumnId | null>(null),
    settingsModalContentRef: useRef<HTMLDivElement | null>(null),
    buildObservationModeFromGridFields,
    normalizeUiTheme,
  };
};
