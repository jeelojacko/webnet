// WebNet Adjustment (TypeScript)

import React, {
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type Dispatch,
  type SetStateAction,
} from 'react';
import { AlertTriangle, CheckCircle } from 'lucide-react';
import InputPane, { type InputPaneHandle } from './components/InputPane';
import AppToolbar from './components/AppToolbar';
import RunComparisonPanel from './components/RunComparisonPanel';
import WorkspaceReviewActions from './components/WorkspaceReviewActions';
import WorkspaceRecoveryBanner from './components/WorkspaceRecoveryBanner';
import WorkspaceChrome from './components/WorkspaceChrome';
import ReviewQueuePanel from './components/ReviewQueuePanel';
import SurveyCadWorkspace from './components/SurveyCadWorkspace';
import type { MapViewSnapshot } from './components/MapView';

import { DEFAULT_INPUT } from './defaultInput';
import { RAD_TO_DEG, dmsToRad } from './engine/angles';
import { buildRunComparisonText } from './engine/qaWorkflow';
import { confirmActionGuard } from './engine/actionGuards';
import { parseInput } from './engine/parse';
import {
  ADJUSTED_POINTS_ALL_COLUMNS,
  ADJUSTED_POINTS_PRESET_COLUMNS,
  DEFAULT_ADJUSTED_POINTS_EXPORT_SETTINGS,
  cloneAdjustedPointsExportSettings,
  sanitizeAdjustedPointsExportSettings,
} from './engine/adjustedPointsExport';
import {
  DEFAULT_QFIX_ANGULAR_SIGMA_SEC,
  DEFAULT_QFIX_LINEAR_SIGMA_M,
} from './engine/defaults';
import {
  LEVEL_LOOP_TOLERANCE_PRESETS,
  findLevelLoopTolerancePreset,
} from './engine/levelLoopTolerance';
import {
  CRS_CATALOG,
  DEFAULT_CANADA_CRS_ID,
} from './engine/crsCatalog';
import { type ImportedInputNotice } from './engine/importers';
import { useArtifactBuilder } from './hooks/useArtifactBuilder';
import { resolveDraftCrsSelection } from './crsDraftSelection';
import { useAppRunWorkflowShell } from './hooks/useAppRunWorkflowShell';
import { useExportWorkflow } from './hooks/useExportWorkflow';
import { useAppIndustryOutput } from './hooks/useAppIndustryOutput';
import { useAppProjectOptionsModal } from './hooks/useAppProjectOptionsModal';
import { useAppProjectImportWorkspace } from './hooks/useAppProjectImportWorkspace';
import { useAppRunComparisonPanel } from './hooks/useAppRunComparisonPanel';
import { useAppReviewQueue } from './hooks/useAppReviewQueue';
import { useAppRunWorkspaceReview } from './hooks/useAppRunWorkspaceReview';
import { useAppWorkspaceDraft } from './hooks/useAppWorkspaceDraft';
import { useHeavyTabHydration, useSequentialTabPrewarm } from './hooks/useHeavyTabHydration';
import { createStableRuntimeId } from './engine/id';
import { useProjectOptionsState } from './hooks/useProjectOptionsState';
import {
  DEFAULT_LISTING_SORT_OBSERVATIONS_BY,
  normalizeListingSortObservationsBy,
} from './listingSortObservations';
import { useWorkspaceProjectState } from './hooks/useWorkspaceProjectState';
import {
  noteUiPerfStage,
  useUiLongTaskObserver,
} from './hooks/useUiPerfMonitor';
import {
  ACTIVE_PARITY_STARTUP_DEFAULTS,
  IMPORT_FILE_ACCEPT,
  PROJECT_FILE_ACCEPT,
} from './app/appConfig';
import {
  INDUSTRY_DEFAULT_INSTRUMENT,
  INDUSTRY_DEFAULT_INSTRUMENT_CODE,
  DEFAULT_UI_THEME,
  buildObservationModeFromGridFields,
  cloneInstrumentLibrary,
  createDefaultS9Instrument,
  createInstrument,
  getExportFormatLabel,
  getExportFormatTooltip,
  normalizeUiTheme,
  parseInstrumentLibraryFromInput,
  parseProj4Parameters,
  resolveCatalogGroupFromCrsId,
} from './app/appHelpers';
import type {
  CrsCatalogGroupFilter,
  ListingSortCoordinatesBy,
  ListingSortObservationsBy,
  ParseSettings,
  ProjectOptionsTab,
  RunDiagnostics,
  RunSettingsSnapshot,
  SettingsState,
  SolveProfile,
  Units,
  UiTheme,
  WorkspaceTabKey,
} from './appStateTypes';
import type { AdjustmentResult, ParseResult } from './types';
import type {
  Instrument,
  InstrumentLibrary,
  CoordMode,
  AdjustedPointsColumnId,
  AdjustedPointsExportSettings,
  AdjustedPointsPresetId,
  CustomLevelLoopTolerancePreset,
  DirectionSetMode,
  ParseOptions,
  OrderMode,
  DeltaMode,
  MapMode,
  AngleMode,
  VerticalReductionMode,
  ProjectExportFormat,
  TsCorrelationScope,
  RobustMode,
  CrsProjectionModel,
  CoordSystemMode,
  LocalDatumScheme,
  GridObservationMode,
  GridDistanceInputMode,
  ObservationModeSettings,
  GeoidInterpolationMethod,
  GeoidHeightDatum,
  GeoidSourceFormat,
  GnssVectorFrame,
  ParseCompatibilityMode,
  FaceNormalizationMode,
  RunMode,
} from './types';

const loadImportReviewModal = () => import('./components/ImportReviewModal');
const loadReportView = () => import('./components/ReportView');
const loadMapView = () => import('./components/MapView');
const loadProcessingSummaryView = () => import('./components/ProcessingSummaryView');
const loadIndustryOutputView = () => import('./components/IndustryOutputView');
const loadProjectOptionsModal = () => import('./components/ProjectOptionsModal');

const ImportReviewModal = React.lazy(loadImportReviewModal);
const ReportView = React.lazy(loadReportView);
const MapView = React.lazy(loadMapView);
const ProcessingSummaryView = React.lazy(loadProcessingSummaryView);
const IndustryOutputView = React.lazy(loadIndustryOutputView);
const ProjectOptionsModal = React.lazy(loadProjectOptionsModal);

type TabKey = WorkspaceTabKey;

type ResolvedLevelLoopTolerancePreset = {
  id: string;
  label: string;
  description: string;
};

const createCustomLevelLoopTolerancePreset = (
  seed?: Partial<Omit<CustomLevelLoopTolerancePreset, 'id'>>,
): CustomLevelLoopTolerancePreset => ({
  id: createStableRuntimeId('lvl'),
  name: seed?.name?.trim() || 'Custom Preset',
  baseMm: seed?.baseMm ?? 0,
  perSqrtKmMm: seed?.perSqrtKmMm ?? 4,
});

const findCustomLevelLoopTolerancePreset = (
  presets: CustomLevelLoopTolerancePreset[],
  baseMm: number,
  perSqrtKmMm: number,
): CustomLevelLoopTolerancePreset | undefined =>
  presets.find(
    (preset) =>
      Math.abs(preset.baseMm - baseMm) <= 1e-9 &&
      Math.abs(preset.perSqrtKmMm - perSqrtKmMm) <= 1e-9,
  );

const resolveLevelLoopTolerancePreset = (
  presets: CustomLevelLoopTolerancePreset[],
  baseMm: number,
  perSqrtKmMm: number,
): ResolvedLevelLoopTolerancePreset => {
  const builtin = findLevelLoopTolerancePreset(baseMm, perSqrtKmMm);
  if (builtin) {
    return {
      id: builtin.id,
      label: builtin.label,
      description: builtin.description,
    };
  }
  const custom = findCustomLevelLoopTolerancePreset(presets, baseMm, perSqrtKmMm);
  if (custom) {
    return {
      id: custom.id,
      label: custom.name.trim() || 'Custom Preset',
      description: `Saved custom tolerance model (${custom.baseMm.toFixed(1)} + ${custom.perSqrtKmMm.toFixed(1)}*sqrt(km)).`,
    };
  }
  return {
    id: 'custom',
    label: 'Custom',
    description: 'Custom tolerance model: edits to Base or K leave the preset selector on Custom.',
  };
};

type AppProps = {
  initialSettingsModalOpen?: boolean;
  initialOptionsTab?: ProjectOptionsTab;
};

/****************************
 * UI COMPONENTS
 ****************************/
const App: React.FC<AppProps> = ({
  initialSettingsModalOpen = false,
  initialOptionsTab = 'adjustment',
}) => {
  const {
    input,
    setInput,
    importNotice,
    setImportNotice,
    projectIncludeFiles,
    setProjectIncludeFiles,
    result,
    setResult,
    runDiagnostics,
    setRunDiagnostics,
    runElapsedMs,
    setRunElapsedMs,
    exportFormat,
    setExportFormat,
    lastRunInput,
    setLastRunInput,
    lastRunSettingsSnapshot,
    setLastRunSettingsSnapshot,
    pendingEditorJumpLine,
    setPendingEditorJumpLine,
    activeTab,
    setActiveTab,
    planningMap,
    setPlanningMap,
    surveyCadState,
    setSurveyCadState,
    clearWorkspaceArtifacts,
  } = useWorkspaceProjectState<ImportedInputNotice, RunDiagnostics, RunSettingsSnapshot, TabKey>({
    initialInput: ACTIVE_PARITY_STARTUP_DEFAULTS?.input ?? DEFAULT_INPUT,
    initialExportFormat: 'points',
    initialActiveTab: 'report',
  });
  useUiLongTaskObserver();

  useLayoutEffect(() => {
    if (!result) return;
    noteUiPerfStage('resultCommitComplete');
  }, [result]);

  const [settings, setSettings] = useState<SettingsState>(() => {
    const seed: SettingsState = {
      maxIterations: 10,
      convergenceLimit: 0.001,
      precisionReportingMode: 'industry-standard',
      units: 'm',
      uiTheme: DEFAULT_UI_THEME,
      mapShowLostStations: true,
      map3dEnabled: false,
      showRunComparisonPanel: false,
      showReviewQueuePanel: false,
      listingShowLostStations: true,
      listingShowCoordinates: true,
      listingShowObservationsResiduals: true,
      listingShowErrorPropagation: true,
      listingShowProcessingNotes: true,
      listingShowAzimuthsBearings: true,
      listingSortCoordinatesBy: 'name',
      listingSortObservationsBy: DEFAULT_LISTING_SORT_OBSERVATIONS_BY,
      listingObservationLimit: 60,
      ...ACTIVE_PARITY_STARTUP_DEFAULTS?.settingsPatch,
    };
    return {
      ...seed,
      listingSortObservationsBy: normalizeListingSortObservationsBy(seed.listingSortObservationsBy, {
        legacyResidualMeansStdResidual: true,
      }),
    };
  });
  const [parseSettings, setParseSettings] = useState<ParseSettings>(() => ({
    solveProfile: 'industry-parity',
    coordMode: '3D',
    coordSystemMode: 'local',
    crsId: DEFAULT_CANADA_CRS_ID,
    localDatumScheme: 'average-scale',
    averageScaleFactor: 1,
    commonElevation: 0,
    averageGeoidHeight: 0,
    gnssVectorFrameDefault: 'gridNEU',
    gnssFrameConfirmed: false,
    verticalDeflectionNorthSec: 0,
    verticalDeflectionEastSec: 0,
    observationMode: {
      bearing: 'grid',
      distance: 'measured',
      angle: 'measured',
      direction: 'measured',
    },
    gridBearingMode: 'grid',
    gridDistanceMode: 'measured',
    gridAngleMode: 'measured',
    gridDirectionMode: 'measured',
    runMode: 'adjustment',
    preanalysisMode: false,
    preanalysisAccuracyThresholdMeters: 0.001,
    preanalysisMaxAddedSets: 5,
    clusterDetectionEnabled: false,
    autoSideshotEnabled: true,
    autoAdjustEnabled: false,
    autoAdjustMaxCycles: 3,
    autoAdjustMaxRemovalsPerCycle: 1,
    autoAdjustStdResThreshold: 4,
    suspectImpactMode: 'auto',
    order: 'EN',
    angleUnits: 'dms',
    angleStationOrder: 'atfromto',
    angleMode: 'auto',
    deltaMode: 'slope',
    mapMode: 'off',
    mapScaleFactor: 1,
    normalize: true,
    faceNormalizationMode: 'on',
    applyCurvatureRefraction: false,
    refractionCoefficient: 0.13,
    verticalReduction: 'none',
    levelWeight: undefined,
    levelLoopToleranceBaseMm: 0,
    levelLoopTolerancePerSqrtKmMm: 4,
    crsTransformEnabled: false,
    crsProjectionModel: 'legacy-equirectangular',
    crsLabel: '',
    crsGridScaleEnabled: false,
    crsGridScaleFactor: 1,
    crsConvergenceEnabled: false,
    crsConvergenceAngleRad: 0,
    geoidModelEnabled: false,
    geoidModelId: 'NGS-DEMO',
    geoidSourceFormat: 'builtin',
    geoidSourcePath: '',
    geoidInterpolation: 'bilinear',
    geoidHeightConversionEnabled: false,
    geoidOutputHeightDatum: 'orthometric',
    gpsLoopCheckEnabled: false,
    gpsAddHiHtEnabled: false,
    gpsAddHiHtHiM: 0,
    gpsAddHiHtHtM: 0,
    qFixLinearSigmaM: DEFAULT_QFIX_LINEAR_SIGMA_M,
    qFixAngularSigmaSec: DEFAULT_QFIX_ANGULAR_SIGMA_SEC,
    prismEnabled: false,
    prismOffset: 0,
    prismScope: 'global',
    positionalToleranceEnabled: false,
    positionalToleranceConstantMm: 0,
    positionalTolerancePpm: 0,
    positionalToleranceConfidencePercent: 95,
    descriptionReconcileMode: 'first',
    descriptionAppendDelimiter: ' | ',
    lonSign: 'west-negative',
    tsCorrelationEnabled: false,
    tsCorrelationRho: 0.25,
    tsCorrelationScope: 'set',
    robustMode: 'none',
    robustK: 1.5,
    parseCompatibilityMode: 'strict',
    parseModeMigrated: true,
    ...ACTIVE_PARITY_STARTUP_DEFAULTS?.parseSettingsPatch,
  }));
  const [geoidSourceData, setGeoidSourceData] = useState<Uint8Array | null>(null);
  const [geoidSourceDataLabel, setGeoidSourceDataLabel] = useState('');
  const [projectInstruments, setProjectInstruments] = useState<InstrumentLibrary>(() => ({
    S9: createDefaultS9Instrument(),
    ...(ACTIVE_PARITY_STARTUP_DEFAULTS?.projectInstruments ?? {}),
    ...parseInstrumentLibraryFromInput(ACTIVE_PARITY_STARTUP_DEFAULTS?.input ?? DEFAULT_INPUT),
  }));
  const [adjustedPointsExportSettings, setAdjustedPointsExportSettings] =
    useState<AdjustedPointsExportSettings>(() =>
      cloneAdjustedPointsExportSettings({
        ...DEFAULT_ADJUSTED_POINTS_EXPORT_SETTINGS,
        includeLostStations: true,
      }),
    );
  const [levelLoopCustomPresets, setLevelLoopCustomPresets] = useState<
    CustomLevelLoopTolerancePreset[]
  >([]);
  const [selectedInstrument, setSelectedInstrument] = useState(
    ACTIVE_PARITY_STARTUP_DEFAULTS?.selectedInstrument ?? 'S9',
  );
  const [splitPercent, setSplitPercent] = useState(35); // left pane width (%)
  const [isSidebarOpen, setIsSidebarOpen] = useState(true);
  const [mapDeclutterPreset, setMapDeclutterPreset] = useState<'standard' | 'dense-review'>(
    'standard',
  );
  const [mapViewSnapshot, setMapViewSnapshot] = useState<MapViewSnapshot | null>(null);
  const [planningMapPreview, setPlanningMapPreview] = useState<ParseResult | null>(null);
  const isSurveyCadWorkspaceActive = activeTab === 'survey-cad';
  useEffect(() => {
    setMapViewSnapshot(null);
  }, [result]);

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
    parseTransformAngleInput: (raw) => {
      const trimmed = raw.trim();
      if (!trimmed) return null;
      const dmsPattern = /^[+-]?\d{1,3}-\d{1,2}-\d{1,2}(?:\.\d+)?$/;
      if (dmsPattern.test(trimmed)) {
        const body = trimmed.replace(/^[+-]/, '');
        const parts = body.split('-');
        if (parts.length !== 3) return null;
        const degrees = Number.parseInt(parts[0], 10);
        const minutes = Number.parseInt(parts[1], 10);
        const seconds = Number.parseFloat(parts[2]);
        if (
          !Number.isFinite(degrees) ||
          !Number.isFinite(minutes) ||
          !Number.isFinite(seconds) ||
          minutes < 0 ||
          minutes >= 60 ||
          seconds < 0 ||
          seconds >= 60
        ) {
          return null;
        }
        const rad = dmsToRad(trimmed);
        if (!Number.isFinite(rad)) return null;
        return rad * RAD_TO_DEG;
      }
      const decimalPattern = /^[+-]?(?:\d+\.?\d*|\.\d+)$/;
      if (!decimalPattern.test(trimmed)) return null;
      const parsed = Number.parseFloat(trimmed);
      return Number.isFinite(parsed) ? parsed : null;
    },
  });
  const {
    isSettingsModalOpen,
    activeOptionsTab,
    setActiveOptionsTab,
    settingsDraft,
    setSettingsDraft,
    parseSettingsDraft,
    setParseSettingsDraft,
    setGeoidSourceDataDraft,
    setGeoidSourceDataLabelDraft,
    crsCatalogGroupFilter,
    setCrsCatalogGroupFilter,
    crsSearchQuery,
    setCrsSearchQuery,
    setShowCrsProjectionParams,
    projectInstrumentsDraft,
    setProjectInstrumentsDraft,
    setLevelLoopCustomPresetsDraft,
    adjustedPointsExportSettingsDraft,
    setAdjustedPointsExportSettingsDraft,
    isAdjustedPointsTransformSelectOpen,
    setIsAdjustedPointsTransformSelectOpen,
    adjustedPointsTransformSelectedDraft,
    setAdjustedPointsTransformSelectedDraft,
    setAdjustedPointsRotationAngleInput,
    setAdjustedPointsTranslationAzimuthInput,
    setAdjustedPointsRotationAngleError,
    setAdjustedPointsTranslationAzimuthError,
    selectedInstrumentDraft,
    setSelectedInstrumentDraft,
    openProjectOptions,
  } = projectOptionsState;
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const importReviewSettingsFileInputRef = useRef<HTMLInputElement | null>(null);
  const projectFileInputRef = useRef<HTMLInputElement | null>(null);
  const projectSourceFileInputRef = useRef<HTMLInputElement | null>(null);
  const geoidSourceFileInputRef = useRef<HTMLInputElement | null>(null);
  const inputPaneRef = useRef<InputPaneHandle | null>(null);
  const adjustedPointsDragRef = useRef<AdjustedPointsColumnId | null>(null);
  const layoutRef = useRef<HTMLDivElement | null>(null);
  const settingsModalContentRef = useRef<HTMLDivElement | null>(null);
  const isResizingRef = useRef(false);
  const {
    parsedInputInstruments,
    currentRunSettingsSnapshot,
    pendingRunSettingDiffs,
    savedRunSnapshots,
    currentRunSnapshot,
    currentSavedRunSnapshot,
    comparisonSelection,
    setComparisonSelection,
    baselineRunSnapshot,
    runComparisonSummary,
    clearRunComparisonState,
    restoreSavedRunSnapshots,
    removeSavedRunSnapshot,
    renameSavedRunSnapshot,
    updateSavedRunSnapshotNotes,
    restoreSavedRunSnapshot,
    saveCurrentRunSnapshot,
    recordRunSnapshot,
    comparisonCandidates,
    storageStatus,
    recentProjects,
    projectSession,
    activeProjectFileViews,
    currentProjectFile,
    projectSourceAccept,
    associatedProjectSettingsAccept,
    effectiveRunInput,
    projectRunValidation,
    effectiveRunIncludeFiles,
    triggerProjectFileSelect,
    triggerProjectSourceFileSelect,
    handleSaveProject,
    handleProjectFileChange,
    handleProjectSourceFileChange,
    createLocalProjectFromCurrentWorkspace,
    openProjectById,
    deleteLocalProject,
    exportPortableProject,
    exportProjectBundle,
    createBlankProjectFile,
    duplicateProjectFile,
    openFileTab,
    closeFileTab,
    switchActiveProjectFile,
    renameProjectFile,
    toggleProjectFileEnabled,
    setProjectFileEnabled,
    reorderProjectFiles,
    moveProjectFile,
    deleteProjectFile,
    removeProjectFile,
    activeProjectRunFiles,
    setEditorInput,
    importReviewState,
    pendingAnglePromptFile,
    triggerFileSelect,
    triggerImportReviewSettingsFileSelect,
    handleFileChange,
    handleImportReviewSettingsFileChange,
    handleImportAnglePromptSetAngleMode,
    handleImportAnglePromptSetFaceMode,
    handleImportAnglePromptSetImportStyle,
    handleImportAnglePromptAccept,
    handleImportAnglePromptCancel,
    handleImportReviewToggleExclude,
    handleImportReviewToggleFixed,
    handleImportReviewSetBulkExcludeMta,
    handleImportReviewSetBulkExcludeRaw,
    handleImportReviewConvertSlopeZenithToHd2D,
    handleImportReviewSetGroupExcluded,
    handleImportConflictResolutionChange,
    handleImportConflictRenameValueChange,
    handleImportReviewCommentChange,
    handleImportReviewGroupLabelChange,
    handleImportReviewRowTextChange,
    handleImportReviewRowTypeChange,
    handleImportReviewPresetChange,
    handleImportReviewComparisonModeChange,
    handleImportReviewDuplicateRow,
    handleImportReviewInsertCommentBelow,
    handleImportReviewCreateSetupGroup,
    handleImportReviewCreateEmptySetupGroup,
    handleImportReviewMoveRow,
    handleImportReviewReorderRow,
    handleImportReviewRemoveRow,
    handleImportReviewRemoveGroup,
    handleCancelImportReview,
    handleImportReviewCompareFile,
    handleImportReviewClearComparison,
    handleApplyImportReview,
    handleApplyImportReviewAsNewFile,
    importReviewDisplayedRows,
    importReviewMoveTargetGroups,
    importReviewSnapshot,
    restoreImportReviewWorkflow,
    resetImportReviewWorkflow,
    adjustedPointsDraftStationIds,
    adjustedPointsTransformDraftValidationMessage,
  } = useAppProjectImportWorkspace({
    input,
    importNotice,
    projectIncludeFiles,
    settings,
    parseSettings,
    geoidSourceData,
    geoidSourceDataLabel,
    exportFormat,
    adjustedPointsExportSettings,
    adjustedPointsExportSettingsDraft,
    planningMap,
    surveyCadState,
    projectInstruments,
    selectedInstrument,
    levelLoopCustomPresets,
    lastRunSettingsSnapshot,
    result,
    resetRunStateAfterImportedInput,
    setInput,
    setProjectIncludeFiles,
    setSettings,
    setParseSettings,
    setGeoidSourceData,
    setGeoidSourceDataLabel,
    setExportFormat,
    setAdjustedPointsExportSettings,
    setPlanningMap,
    setSurveyCadState,
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
    normalizeUiTheme,
    normalizeSolveProfile,
    buildObservationModeFromGridFields,
    coordMode: parseSettings.coordMode,
    faceNormalizationMode: parseSettings.faceNormalizationMode,
    fileInputRef,
    importReviewSettingsFileInputRef,
    projectFileInputRef,
    projectSourceFileInputRef,
  });
  const surveyCadParseOptions = useMemo(
    () => ({
      ...parseSettings,
      units: settings.units,
      sourceFile: activeProjectRunFiles[0]?.name ?? '<survey-cad>',
      includeFiles: effectiveRunIncludeFiles,
      projectRunFiles: activeProjectRunFiles,
      currentInstrument: selectedInstrument,
    }),
    [
      activeProjectRunFiles,
      effectiveRunIncludeFiles,
      parseSettings,
      selectedInstrument,
      settings.units,
    ],
  );
  useEffect(() => {
    setPlanningMapPreview(null);
  }, [
    activeProjectRunFiles,
    effectiveRunIncludeFiles,
    effectiveRunInput,
    parseSettings,
    projectInstruments,
    selectedInstrument,
  ]);
  const selectedDraftCrs = useMemo(
    () =>
      CRS_CATALOG.find((row) => row.id === parseSettingsDraft.crsId) ??
      CRS_CATALOG.find((row) => row.id === DEFAULT_CANADA_CRS_ID) ??
      CRS_CATALOG[0],
    [parseSettingsDraft.crsId],
  );
  const crsCatalogGroupCounts = useMemo(() => {
    const counts: Record<CrsCatalogGroupFilter, number> = {
      all: CRS_CATALOG.length,
      global: 0,
      'canada-utm': 0,
      'canada-mtm': 0,
      'canada-provincial': 0,
      'us-spcs': 0,
    };
    CRS_CATALOG.forEach((row) => {
      counts[row.catalogGroup] += 1;
    });
    return counts;
  }, []);
  const filteredDraftCrsCatalog = useMemo(() => {
    const byGroup =
      crsCatalogGroupFilter === 'all'
        ? CRS_CATALOG
        : CRS_CATALOG.filter((row) => row.catalogGroup === crsCatalogGroupFilter);
    const preferredSpcsLinearUnit = settingsDraft.units === 'ft' ? 'us-ft' : 'm';
    return byGroup.filter(
      (row) => row.catalogGroup !== 'us-spcs' || row.linearUnit === preferredSpcsLinearUnit,
    );
  }, [crsCatalogGroupFilter, settingsDraft.units]);
  const searchedDraftCrsCatalog = useMemo(() => {
    const token = crsSearchQuery.trim().toUpperCase();
    if (!token) return filteredDraftCrsCatalog;
    return filteredDraftCrsCatalog.filter((row) => {
      const id = row.id.toUpperCase();
      const label = row.label.toUpperCase();
      const epsg = (row.epsgCode ?? '').toUpperCase();
      return id.includes(token) || label.includes(token) || epsg.includes(token);
    });
  }, [crsSearchQuery, filteredDraftCrsCatalog]);
  const visibleDraftCrsCatalog = useMemo(() => {
    if (searchedDraftCrsCatalog.length > 0) return searchedDraftCrsCatalog;
    if (selectedDraftCrs) return [selectedDraftCrs];
    return [];
  }, [searchedDraftCrsCatalog, selectedDraftCrs]);
  const selectedCrsProj4Params = useMemo(
    () => selectedDraftCrs?.projParams ?? parseProj4Parameters(selectedDraftCrs?.proj4 ?? ''),
    [selectedDraftCrs],
  );
  useEffect(() => {
    const resolution = resolveDraftCrsSelection({
      crsId: parseSettingsDraft.crsId,
      crsCatalogGroupFilter,
      filteredDraftCrsCatalog,
    });
    if (!resolution) return;
    if (resolution.nextCatalogGroupFilter) {
      setCrsCatalogGroupFilter(resolution.nextCatalogGroupFilter);
      return;
    }
    if (resolution.nextCrsId) {
      setParseSettingsDraft((prev) => ({
        ...prev,
        crsId: resolution.nextCrsId ?? prev.crsId,
      }));
    }
  }, [
    crsCatalogGroupFilter,
    filteredDraftCrsCatalog,
    parseSettingsDraft.crsId,
    setCrsCatalogGroupFilter,
    setParseSettingsDraft,
  ]);

  useEffect(() => {
    setProjectInstruments((prev) => {
      const next = { ...prev };
      let changed = false;
      Object.entries(parsedInputInstruments).forEach(([code, inst]) => {
        if (!next[code]) {
          next[code] = inst;
          changed = true;
        }
      });
      return changed ? next : prev;
    });
  }, [parsedInputInstruments]);

  useEffect(() => {
    const codes = Object.keys(projectInstruments);
    if (!selectedInstrument && codes.length > 0) {
      setSelectedInstrument(codes[0]);
    } else if (selectedInstrument && !projectInstruments[selectedInstrument]) {
      setSelectedInstrument(codes[0] || '');
    }
  }, [projectInstruments, selectedInstrument]);

  useEffect(() => {
    if (pendingEditorJumpLine == null || !isSidebarOpen) return;
    const lineNumber = pendingEditorJumpLine;
    const frame = window.requestAnimationFrame(() => {
      inputPaneRef.current?.jumpToLine(lineNumber);
      setPendingEditorJumpLine((current) => (current === lineNumber ? null : current));
    });
    return () => window.cancelAnimationFrame(frame);
  }, [isSidebarOpen, pendingEditorJumpLine, setPendingEditorJumpLine]);

  useEffect(() => {
    if (!isSettingsModalOpen) return;
    const root = settingsModalContentRef.current;
    if (!root) return;

    root.querySelectorAll('label').forEach((label) => {
      if (label.getAttribute('title')) return;
      const control = label.querySelector<HTMLElement>(
        'input[title], select[title], textarea[title], button[title]',
      );
      const tip = control?.getAttribute('title');
      if (tip) label.setAttribute('title', tip);
    });
  }, [
    isSettingsModalOpen,
    activeOptionsTab,
    settingsDraft,
    parseSettingsDraft,
    projectInstrumentsDraft,
    selectedInstrumentDraft,
  ]);

  // handle dragging of vertical divider
  useEffect(() => {
    const handleMouseMove = (e: MouseEvent) => {
      if (!isResizingRef.current || !layoutRef.current || !isSidebarOpen) return;

      const bounds = layoutRef.current.getBoundingClientRect();
      const offsetX = e.clientX - bounds.left;
      let pct = (offsetX / bounds.width) * 100;

      const min = 20;
      const max = 80;
      if (pct < min) pct = min;
      if (pct > max) pct = max;

      setSplitPercent(pct);
    };

    const handleMouseUp = () => {
      isResizingRef.current = false;
    };

    window.addEventListener('mousemove', handleMouseMove);
    window.addEventListener('mouseup', handleMouseUp);

    return () => {
      window.removeEventListener('mousemove', handleMouseMove);
      window.removeEventListener('mouseup', handleMouseUp);
    };
  }, [isSidebarOpen]);

  const handleDividerMouseDown = (e: React.MouseEvent<HTMLDivElement>) => {
    e.preventDefault();
    isResizingRef.current = true;
  };

  function normalizeSolveProfile(_profile: SolveProfile): SolveProfile {
    return 'industry-parity';
  }
  const activateReportTab = useCallback(() => {
    setActiveTab('report');
  }, [setActiveTab]);

  const {
    buildRunDiagnosticsWithProjectMetadata,
    exportRunDiagnostics,
    pipelineState,
    cancelAdjustment,
    excludedIds,
    overrides,
    clusterReviewDecisions,
    activeClusterApprovedMerges,
    applyImpactExclusion,
    applyPreanalysisPlanningAction,
    applyAllPreanalysisPlanningActions,
    toggleExclude,
    clearExclusions,
    handleOverride,
    resetOverrides,
    handleClusterDecisionStatus,
    handleClusterCanonicalSelection,
    applyClusterReviewMerges,
    resetClusterReview,
    clearClusterApprovedMerges,
    resetAdjustmentWorkflowState,
    restoreAdjustmentWorkflowState,
    handleValidatedRun,
  } = useAppRunWorkflowShell({
    projectInstruments,
    selectedInstrument,
    defaultIndustryInstrumentCode: INDUSTRY_DEFAULT_INSTRUMENT_CODE,
    defaultIndustryInstrument: INDUSTRY_DEFAULT_INSTRUMENT,
    normalizeSolveProfile,
    projectSession,
    activeProjectRunFiles,
    result,
    runDiagnostics,
    settings,
    parseSettings,
    effectiveRunInput,
    lastRunInput,
    effectiveRunIncludeFiles,
    geoidSourceData,
    planningMap,
    currentRunSettingsSnapshot,
    setResult,
    setRunDiagnostics,
    setRunElapsedMs,
    setLastRunInput,
    setLastRunSettingsSnapshot,
    activateReportTab,
    recordRunSnapshot,
    projectRunValidation,
    setImportNotice,
  });
  const heavyTabPreloaders = useMemo(
    () => [loadProcessingSummaryView, loadIndustryOutputView, loadMapView],
    [],
  );
  useSequentialTabPrewarm(result, heavyTabPreloaders);
  const { canRenderTab } = useHeavyTabHydration(result, activeTab);
  const handleLoadPlanningInputPoints = useCallback(() => {
    try {
      const parsed = parseInput(effectiveRunInput, projectInstruments, {
        ...parseSettings,
        sourceFile: activeProjectRunFiles[0]?.name ?? '<planning-map>',
        includeFiles: effectiveRunIncludeFiles,
        projectRunFiles: activeProjectRunFiles,
        currentInstrument: selectedInstrument,
      });
      setPlanningMapPreview(parsed);
      setImportNotice(null);
      setActiveTab('map');
    } catch (error) {
      setPlanningMapPreview(null);
      setImportNotice({
        title: 'Load points failed',
        detailLines: [error instanceof Error ? error.message : 'Unable to parse current input.'],
      });
    }
  }, [
    activeProjectRunFiles,
    effectiveRunIncludeFiles,
    effectiveRunInput,
    parseSettings,
    projectInstruments,
    selectedInstrument,
    setActiveTab,
    setImportNotice,
  ]);
  const mapResult = useMemo<AdjustmentResult>(() => {
    if (result) return result;
    if (!planningMapPreview) {
      return {
        success: false,
        converged: false,
        iterations: 0,
        dof: 0,
        seuw: 1,
        chiSquare: null,
        stations: {},
        observations: [],
        unknowns: [],
        normalMatrix: [],
        residuals: [],
        logs: [],
        parseState: { ...parseSettings },
        preanalysisMode: parseSettings.preanalysisMode === true,
      } as unknown as AdjustmentResult;
    }
    return {
      success: false,
      converged: false,
      iterations: 0,
      dof: 0,
      seuw: 1,
      chiSquare: null,
      stations: planningMapPreview.stations,
      observations: planningMapPreview.observations,
      unknowns: planningMapPreview.unknowns,
      normalMatrix: [],
      residuals: [],
      logs: planningMapPreview.logs,
      parseState: planningMapPreview.parseState,
      preanalysisMode: planningMapPreview.parseState.preanalysisMode === true,
    } as unknown as AdjustmentResult;
  }, [parseSettings, planningMapPreview, result]);
  const { industryOutputText, handleIndustryListingSortChange } = useAppIndustryOutput({
    activeTab,
    result,
    settings,
    parseSettings,
    runDiagnostics,
    setSettings,
    setSettingsDraft,
    buildRunDiagnostics: buildRunDiagnosticsWithProjectMetadata,
  });

  const currentComparisonText = useMemo(
    () => (runComparisonSummary ? buildRunComparisonText(runComparisonSummary) : ''),
    [runComparisonSummary],
  );
  const processingSummaryDiagnostics = useMemo(
    () =>
      runDiagnostics
        ? {
            solveProfile: runDiagnostics.solveProfile,
            directionSetMode: runDiagnostics.directionSetMode,
            profileDefaultInstrumentFallback: runDiagnostics.profileDefaultInstrumentFallback,
            rotationAngleRad: runDiagnostics.rotationAngleRad,
            coordSystemMode: runDiagnostics.coordSystemMode,
            crsId: runDiagnostics.crsId,
            localDatumScheme: runDiagnostics.localDatumScheme,
            averageScaleFactor: runDiagnostics.averageScaleFactor,
            scaleOverrideActive: runDiagnostics.scaleOverrideActive,
            commonElevation: runDiagnostics.commonElevation,
            averageGeoidHeight: runDiagnostics.averageGeoidHeight,
            gnssVectorFrameDefault: runDiagnostics.gnssVectorFrameDefault,
            gnssFrameConfirmed: runDiagnostics.gnssFrameConfirmed,
            gridBearingMode: runDiagnostics.gridBearingMode,
            gridDistanceMode: runDiagnostics.gridDistanceMode,
            gridAngleMode: runDiagnostics.gridAngleMode,
            gridDirectionMode: runDiagnostics.gridDirectionMode,
            datumSufficiencyReport: runDiagnostics.datumSufficiencyReport,
            parsedUsageSummary: runDiagnostics.parsedUsageSummary,
            usedInSolveUsageSummary: runDiagnostics.usedInSolveUsageSummary,
            directiveTransitions: runDiagnostics.directiveTransitions,
            directiveNoEffectWarnings: runDiagnostics.directiveNoEffectWarnings,
            coordSystemDiagnostics: runDiagnostics.coordSystemDiagnostics,
            coordSystemWarningMessages: runDiagnostics.coordSystemWarningMessages,
            crsStatus: runDiagnostics.crsStatus,
            crsOffReason: runDiagnostics.crsOffReason,
            crsDatumOpId: runDiagnostics.crsDatumOpId,
            crsDatumFallbackUsed: runDiagnostics.crsDatumFallbackUsed,
            crsAreaOfUseStatus: runDiagnostics.crsAreaOfUseStatus,
            crsOutOfAreaStationCount: runDiagnostics.crsOutOfAreaStationCount,
            crsGridScaleEnabled: runDiagnostics.crsGridScaleEnabled,
            crsGridScaleFactor: runDiagnostics.crsGridScaleFactor,
            crsConvergenceEnabled: runDiagnostics.crsConvergenceEnabled,
            crsConvergenceAngleRad: runDiagnostics.crsConvergenceAngleRad,
            geoidModelEnabled: runDiagnostics.geoidModelEnabled,
            geoidModelId: runDiagnostics.geoidModelId,
            geoidInterpolation: runDiagnostics.geoidInterpolation,
            geoidHeightConversionEnabled: runDiagnostics.geoidHeightConversionEnabled,
            geoidOutputHeightDatum: runDiagnostics.geoidOutputHeightDatum,
            geoidModelLoaded: runDiagnostics.geoidModelLoaded,
            geoidModelMetadata: runDiagnostics.geoidModelMetadata,
            geoidSampleUndulationM: runDiagnostics.geoidSampleUndulationM,
            geoidConvertedStationCount: runDiagnostics.geoidConvertedStationCount,
            geoidSkippedStationCount: runDiagnostics.geoidSkippedStationCount,
            gpsAddHiHtEnabled: runDiagnostics.gpsAddHiHtEnabled,
            gpsAddHiHtHiM: runDiagnostics.gpsAddHiHtHiM,
            gpsAddHiHtHtM: runDiagnostics.gpsAddHiHtHtM,
            gpsAddHiHtVectorCount: runDiagnostics.gpsAddHiHtVectorCount,
            gpsAddHiHtAppliedCount: runDiagnostics.gpsAddHiHtAppliedCount,
            gpsAddHiHtPositiveCount: runDiagnostics.gpsAddHiHtPositiveCount,
            gpsAddHiHtNegativeCount: runDiagnostics.gpsAddHiHtNegativeCount,
            gpsAddHiHtNeutralCount: runDiagnostics.gpsAddHiHtNeutralCount,
            gpsAddHiHtDefaultZeroCount: runDiagnostics.gpsAddHiHtDefaultZeroCount,
            gpsAddHiHtMissingHeightCount: runDiagnostics.gpsAddHiHtMissingHeightCount,
            gpsAddHiHtScaleMin: runDiagnostics.gpsAddHiHtScaleMin,
            gpsAddHiHtScaleMax: runDiagnostics.gpsAddHiHtScaleMax,
          }
        : null,
    [runDiagnostics],
  );
  const { buildArtifacts } = useArtifactBuilder();
  const handleInputChange = (value: string) => {
    setEditorInput(value);
    if (importNotice) setImportNotice(null);
  };
  const appRunWorkspaceReview = useAppRunWorkspaceReview({
    result,
    excludedIds,
    projectRunValidationOk: projectRunValidation.ok,
    pendingRunSettingDiffs,
    pipelineState,
    lastRunInput,
    effectiveRunInput,
    activeTab,
    comparisonSelection,
    activeProjectRunFiles,
    effectiveRunIncludeFiles,
    runComparisonSummary,
    restoreSavedRunSnapshot,
    restoreAdjustmentWorkflowState,
    setResult,
    setRunDiagnostics,
    setRunElapsedMs,
    setPendingEditorJumpLine,
    setLastRunInput,
    setLastRunSettingsSnapshot,
    setImportNotice,
    setActiveTab,
  });
  const {
    qaDerivedResult,
    workspaceReviewState,
    persistedWorkspaceReviewSnapshot,
    buildSavedRunReopenState,
    handleRestoreSavedRun,
    runPhaseLabel,
    handleWorkspaceTabChange,
    handleReportStationSelection,
    handleReportObservationSelection,
    handleMapStationSelection,
    handleMapObservationSelection,
  } = appRunWorkspaceReview;
  const {
    selection,
    restoreSnapshot: restoreWorkspaceReviewSnapshot,
    resetState: resetWorkspaceReviewState,
    selectedObservation,
    selectedStation,
    selectObservation,
    selectStation,
    clearSelection,
    pinnedObservations,
    togglePinnedObservation,
    selectNextSuspect,
    selectPreviousSuspect,
    hasSuspects,
  } = workspaceReviewState;
  const { handleExportResults } = useExportWorkflow({
    result,
    exportFormat,
    units: settings.units,
    settings,
    parseSettings,
    runDiagnostics: exportRunDiagnostics,
    adjustedPointsExportSettings,
    levelLoopCustomPresets,
    currentComparisonText,
    setImportNotice,
    buildArtifacts,
  });
  const {
    resetRunStateAfterImportedInput: resetRunStateAfterImportedInputInternal,
    pendingRecovery,
    hasStoredDraft,
    recoverDraft,
    discardRecoveredDraft,
    clearCurrentDraft,
  } = useAppWorkspaceDraft({
    input,
    projectIncludeFiles,
    settings,
    parseSettings,
    exportFormat,
    adjustedPointsExportSettings,
    projectInstruments,
    selectedInstrument,
    levelLoopCustomPresets,
    geoidSourceData,
    geoidSourceDataLabel,
    surveyCadState,
    activeTab,
    splitPercent,
    isSidebarOpen,
    mapDeclutterPreset,
    planningMap,
    persistedWorkspaceReviewSnapshot,
    stationMovementThreshold: comparisonSelection.stationMovementThreshold,
    residualDeltaThreshold: comparisonSelection.residualDeltaThreshold,
    savedRunSnapshots,
    importReviewSnapshot,
    recoveryDisabled: Boolean(projectSession),
    clearWorkspaceArtifacts,
    resetAdjustmentWorkflowState,
    clearRunComparisonState,
    resetWorkspaceReviewState,
    resetImportReviewWorkflow,
    restoreSavedRunSnapshots,
    restoreWorkspaceReviewSnapshot,
    restoreImportReviewWorkflow: (snapshot) => restoreImportReviewWorkflow(snapshot ?? null),
    setInput,
    setProjectIncludeFiles,
    setSettings,
    setSettingsDraft,
    setParseSettings,
    setParseSettingsDraft,
    setGeoidSourceData,
    setGeoidSourceDataDraft,
    setGeoidSourceDataLabel,
    setGeoidSourceDataLabelDraft,
    setExportFormat,
    setAdjustedPointsExportSettings,
    setAdjustedPointsExportSettingsDraft,
    setProjectInstruments,
    setProjectInstrumentsDraft,
    setSelectedInstrument,
    setSelectedInstrumentDraft,
    setLevelLoopCustomPresets,
    setLevelLoopCustomPresetsDraft,
    setIsAdjustedPointsTransformSelectOpen,
    setAdjustedPointsTransformSelectedDraft,
    setAdjustedPointsRotationAngleInput,
    setAdjustedPointsTranslationAzimuthInput,
    setAdjustedPointsRotationAngleError,
    setAdjustedPointsTranslationAzimuthError,
    setCrsCatalogGroupFilter,
    setCrsSearchQuery,
    setShowCrsProjectionParams,
    setActiveTab,
    setSplitPercent,
    setIsSidebarOpen,
    setMapDeclutterPreset,
    setPlanningMap,
    setSurveyCadState,
    setComparisonSelection,
    setImportNotice,
  });
  function resetRunStateAfterImportedInput() {
    resetRunStateAfterImportedInputInternal();
  }
  const {
    filteredReviewQueueItems,
    reviewQueueImportedGroupOptions,
    reviewQueueSeverityFilter,
    setReviewQueueSeverityFilter,
    reviewQueueSourceFilter,
    setReviewQueueSourceFilter,
    reviewQueueUnresolvedOnly,
    setReviewQueueUnresolvedOnly,
    reviewQueueImportedGroupFilter,
    setReviewQueueImportedGroupFilter,
    selectedReviewQueueItemId,
    handleJumpToSourceLine,
    handleFocusReportFilter,
    reportFilterFocusRequestKey,
    handleSelectReviewQueueItem,
    handleNextUnresolvedQueueItem,
    clearReviewQueueFilters,
  } = useAppReviewQueue({
    result,
    excludedIds,
    clusterReviewDecisions,
    runComparisonSummary,
    importReviewState,
    selectObservation,
    selectStation,
    setActiveTab,
    setIsSidebarOpen,
    setPendingEditorJumpLine,
  });
  const {
    applyAdjustedPointsTransformSelection,
    closeAdjustedPointsTransformSelectModal,
    handleAdjustedPointsTransformToggleSelected,
    projectOptionsModalContext,
    handleOpenProjectWorkspacePanel,
  } = useAppProjectOptionsModal({
    projectOptionsState,
    openProjectOptions,
    setActiveOptionsTab,
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
    storageStatus,
    recentProjects,
    projectSession,
    activeProjectFileViews,
    currentProjectFile,
    handleSaveProject,
    triggerProjectFileSelect,
    triggerProjectSourceFileSelect,
    createLocalProjectFromCurrentWorkspace,
    openProjectById,
    deleteLocalProject,
    exportPortableProject,
    exportProjectBundle,
    createBlankProjectFile,
    switchActiveProjectFile,
    renameProjectFile,
    toggleProjectFileEnabled,
    moveProjectFile,
    removeProjectFile,
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
  });
  const {
    showRunComparisonPanel,
    handleResetToLastRun,
    handleClearCurrentDraft,
    handleSaveCurrentSnapshot,
    handleCompareWithSavedRun,
    handleRenameSavedRun,
    handleUpdateSavedRunNotes,
    handleDeleteSavedRun,
    handleSelectBaseline,
    handleTogglePinBaseline,
    handleStationThresholdChange,
    handleResidualThresholdChange,
    handleCompareSelectStation,
    handleCompareSelectObservation,
  } = useAppRunComparisonPanel({
    lastRunInput,
    handleEditorInputChange: setEditorInput,
    clearWorkspaceArtifacts,
    resetImportReviewWorkflow,
    resetAdjustmentWorkflowState,
    clearRunComparisonState,
    resetWorkspaceReviewState,
    clearCurrentDraft,
    setImportNotice,
    currentRunSnapshot,
    savedRunSnapshots,
    saveCurrentRunSnapshot,
    buildSavedRunReopenState,
    setComparisonSelection,
    renameSavedRunSnapshot,
    updateSavedRunSnapshotNotes,
    removeSavedRunSnapshot,
    baselineRunSnapshot,
    selectStation,
    selectObservation,
    setActiveTab,
  });

  return (
    <div className="fixed inset-0 flex flex-col bg-slate-900 text-slate-100 font-sans overflow-hidden">
      <input
        ref={fileInputRef}
        type="file"
        accept={IMPORT_FILE_ACCEPT}
        className="hidden"
        multiple
        onChange={handleFileChange}
      />
      <input
        ref={projectFileInputRef}
        type="file"
        accept={`${PROJECT_FILE_ACCEPT},.zip`}
        className="hidden"
        onChange={handleProjectFileChange}
      />
      <input
        ref={projectSourceFileInputRef}
        type="file"
        accept={projectSourceAccept}
        className="hidden"
        multiple
        onChange={handleProjectSourceFileChange}
      />
      <input
        ref={importReviewSettingsFileInputRef}
        type="file"
        accept={associatedProjectSettingsAccept}
        className="hidden"
        onChange={handleImportReviewSettingsFileChange}
      />
      <AppToolbar
        isSidebarOpen={isSidebarOpen}
        showSidebarToggle={!isSurveyCadWorkspaceActive}
        isSurveyCadActive={isSurveyCadWorkspaceActive}
        onToggleSidebar={() => setIsSidebarOpen(!isSidebarOpen)}
        onOpenProjectOptions={openProjectOptions}
        onOpenSurveyCad={() => setActiveTab(isSurveyCadWorkspaceActive ? 'report' : 'survey-cad')}
        onOpenImportFile={() => triggerFileSelect()}
        onOpenProjectFile={handleOpenProjectWorkspacePanel}
        onSaveProject={handleSaveProject}
        exportFormat={exportFormat}
        onExportFormatChange={setExportFormat}
        exportTooltip={getExportFormatTooltip(exportFormat)}
        exportLabel={getExportFormatLabel(exportFormat)}
        onExportResults={handleExportResults}
        canExport={!!result}
        hasStoredDraft={hasStoredDraft}
        onClearCurrentDraft={handleClearCurrentDraft}
        selectedObservationId={selectedObservation?.id ?? null}
        isSelectedObservationPinned={
          selectedObservation != null &&
          pinnedObservations.some((entry) => entry.id === selectedObservation.id)
        }
        onTogglePinSelectedObservation={() => {
          if (selectedObservation) togglePinnedObservation(selectedObservation.id);
        }}
        pipelineState={pipelineState}
        runPhaseLabel={runPhaseLabel}
        pendingRunSettingDiffs={pendingRunSettingDiffs}
        onCancelRun={cancelAdjustment}
        onRun={handleValidatedRun}
        onResetToLastRun={handleResetToLastRun}
      />
      {pendingRecovery && (
        <WorkspaceRecoveryBanner
          savedAt={new Date(pendingRecovery.savedAt).toLocaleString()}
          onRecover={recoverDraft}
          onDiscard={discardRecoveredDraft}
        />
      )}

      <React.Suspense
        fallback={
          isSettingsModalOpen ? (
            <div className="fixed inset-0 z-50 bg-slate-950/70 flex items-start justify-center p-4 md:p-10">
              <div className="w-full max-w-5xl bg-slate-600 border border-slate-400 shadow-2xl text-slate-100">
                <div className="flex items-center justify-between border-b border-slate-400 bg-slate-700 px-4 py-2">
                  <div className="text-sm font-semibold tracking-wide">Project Options</div>
                </div>
                <div className="bg-slate-500 p-4 text-xs text-slate-200">
                  Loading project options...
                </div>
              </div>
            </div>
          ) : null
        }
      >
        <ProjectOptionsModal context={projectOptionsModalContext} />
      </React.Suspense>

      {isSettingsModalOpen && isAdjustedPointsTransformSelectOpen && (
        <div
          className="fixed inset-0 z-[60] flex items-center justify-center bg-slate-950/85 px-4 py-6"
          onClick={closeAdjustedPointsTransformSelectModal}
        >
          <div
            className="w-full max-w-md border border-slate-500 bg-slate-900 shadow-2xl"
            onClick={(event) => event.stopPropagation()}
          >
            <div className="border-b border-slate-700 bg-slate-800 px-5 py-4">
              <div className="text-[11px] uppercase tracking-[0.24em] text-cyan-300">
                Transform Scope
              </div>
              <div className="mt-1 text-lg font-semibold text-white">Select Points</div>
              <div className="mt-1 text-xs text-slate-400">
                Select points to transform. Reference point is auto-included in transform scope.
              </div>
            </div>
            <div className="max-h-[50vh] space-y-2 overflow-auto px-5 py-4">
              {adjustedPointsDraftStationIds.length === 0 ? (
                <div className="rounded border border-slate-600 bg-slate-800/70 px-3 py-2 text-xs text-slate-300">
                  No stations available. Run adjustment to populate the export set.
                </div>
              ) : (
                adjustedPointsDraftStationIds.map((stationId) => {
                  const checked = adjustedPointsTransformSelectedDraft.includes(stationId);
                  return (
                    <label
                      key={`adj-transform-select-${stationId}`}
                      className={`flex items-center gap-2 rounded border px-3 py-2 text-xs ${
                        checked
                          ? 'border-cyan-500/70 bg-cyan-900/25 text-cyan-100'
                          : 'border-slate-600 bg-slate-800/60 text-slate-200'
                      }`}
                    >
                      <input
                        type="checkbox"
                        checked={checked}
                        onChange={(event) =>
                          handleAdjustedPointsTransformToggleSelected(
                            stationId,
                            event.target.checked,
                          )
                        }
                      />
                      <span>{stationId}</span>
                    </label>
                  );
                })
              )}
            </div>
            <div className="flex items-center justify-end border-t border-slate-700 bg-slate-800 px-5 py-4">
              <button
                type="button"
                onClick={closeAdjustedPointsTransformSelectModal}
                className="border border-slate-500 bg-slate-700 px-4 py-2 text-xs uppercase tracking-wide text-slate-200 hover:bg-slate-600"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={applyAdjustedPointsTransformSelection}
                className="ml-2 border border-cyan-500 bg-cyan-900/40 px-4 py-2 text-xs uppercase tracking-wide text-cyan-100 hover:bg-cyan-800/60"
              >
                OK
              </button>
            </div>
          </div>
        </div>
      )}

      <div ref={layoutRef} className="flex-1 flex overflow-hidden w-full">
        {!isSurveyCadWorkspaceActive && isSidebarOpen && (
          <>
            <div style={{ width: `${splitPercent}%` }}>
              <InputPane
                ref={inputPaneRef}
                input={input}
                onChange={handleInputChange}
                projectName={projectSession?.manifest.name ?? null}
                activeFileName={currentProjectFile?.name ?? null}
                projectFiles={activeProjectFileViews}
                projectRunValidation={projectRunValidation}
                onOpenProjectFiles={() => {
                  if (projectSession) {
                    handleOpenProjectWorkspacePanel();
                    return;
                  }
                  void createLocalProjectFromCurrentWorkspace();
                }}
                onAddProjectSourceFile={() => {
                  void triggerProjectSourceFileSelect();
                }}
                onOpenFileTab={openFileTab}
                onCloseFileTab={closeFileTab}
                onFocusProjectFile={switchActiveProjectFile}
                onCreateBlankProjectFile={() => {
                  void createBlankProjectFile();
                }}
                onDuplicateProjectFile={duplicateProjectFile}
                onRenameProjectFile={renameProjectFile}
                onDeleteProjectFile={deleteProjectFile}
                onSetProjectFileEnabled={setProjectFileEnabled}
                onReorderProjectFiles={reorderProjectFiles}
                importNotice={importNotice}
                onClearImportNotice={() => setImportNotice(null)}
              />
            </div>
            <div
              onMouseDown={handleDividerMouseDown}
              className="w-[4px] flex-none cursor-col-resize bg-slate-800 hover:bg-slate-600 transition-colors"
            />
          </>
        )}

        <div className="flex flex-col bg-slate-950 flex-1 min-w-0 overflow-hidden">
          {isSurveyCadWorkspaceActive ? (
            <SurveyCadWorkspace
              input={effectiveRunInput}
              instrumentLibrary={projectInstruments}
              parseOptions={surveyCadParseOptions}
              units={settings.units}
              result={result}
              persistedState={surveyCadState}
              onPersistedStateChange={setSurveyCadState}
            />
          ) : (
            <>
          {settings.showRunComparisonPanel && showRunComparisonPanel && (
            <RunComparisonPanel
              currentSnapshot={currentRunSnapshot}
              baselineSnapshot={baselineRunSnapshot}
              comparisonCandidates={comparisonCandidates}
              savedRunSnapshots={savedRunSnapshots}
              currentSavedRunId={currentSavedRunSnapshot?.id ?? null}
              isCurrentSnapshotSaved={currentSavedRunSnapshot != null}
              comparisonSelection={comparisonSelection}
              comparisonSummary={runComparisonSummary}
              onSaveCurrentSnapshot={handleSaveCurrentSnapshot}
              onRestoreSavedRun={handleRestoreSavedRun}
              onCompareWithSavedRun={handleCompareWithSavedRun}
              onRenameSavedRun={handleRenameSavedRun}
              onUpdateSavedRunNotes={handleUpdateSavedRunNotes}
              onDeleteSavedRun={handleDeleteSavedRun}
              onSelectBaseline={handleSelectBaseline}
              onTogglePinBaseline={handleTogglePinBaseline}
              onStationThresholdChange={handleStationThresholdChange}
              onResidualThresholdChange={handleResidualThresholdChange}
              onSelectStation={handleCompareSelectStation}
              onSelectObservation={handleCompareSelectObservation}
              reviewActionsContent={
                <WorkspaceReviewActions
                  canNavigateSuspects={hasSuspects}
                  canJumpToInput={selection.sourceLine != null}
                  canPinSelectedObservation={selectedObservation != null}
                  isSelectedObservationPinned={
                    selectedObservation != null &&
                    pinnedObservations.some((entry) => entry.id === selectedObservation.id)
                  }
                  onSelectPreviousSuspect={() => {
                    selectPreviousSuspect();
                    setActiveTab('report');
                  }}
                  onSelectNextSuspect={() => {
                    selectNextSuspect();
                    setActiveTab('report');
                  }}
                  onJumpToInput={() => {
                    if (selection.sourceLine != null) handleJumpToSourceLine(selection.sourceLine);
                  }}
                  onTogglePinSelectedObservation={() => {
                    if (selectedObservation) togglePinnedObservation(selectedObservation.id);
                  }}
                  onFocusReportFilter={handleFocusReportFilter}
                />
              }
            />
          )}
          {settings.showReviewQueuePanel && (
            <ReviewQueuePanel
              items={filteredReviewQueueItems}
              selectedItemId={selectedReviewQueueItemId}
              severityFilter={reviewQueueSeverityFilter}
              sourceFilter={reviewQueueSourceFilter}
              unresolvedOnly={reviewQueueUnresolvedOnly}
              importedGroupFilter={reviewQueueImportedGroupFilter}
              importedGroupOptions={reviewQueueImportedGroupOptions}
              onSeverityFilterChange={setReviewQueueSeverityFilter}
              onSourceFilterChange={setReviewQueueSourceFilter}
              onUnresolvedOnlyChange={setReviewQueueUnresolvedOnly}
              onImportedGroupFilterChange={setReviewQueueImportedGroupFilter}
              onSelectItem={handleSelectReviewQueueItem}
              onNextUnresolved={handleNextUnresolvedQueueItem}
              onClearFilters={clearReviewQueueFilters}
            />
          )}
          {(selectedObservation || selectedStation || pinnedObservations.length > 0) && (
            <div className="border-b border-slate-800 bg-slate-950/90 px-4 py-2 text-xs text-slate-300">
              <div className="flex flex-wrap items-center gap-2">
                {selectedObservation && (
                  <span className="rounded border border-cyan-800 bg-cyan-950/30 px-2 py-1">
                    Selected obs: {selectedObservation.type.toUpperCase()}{' '}
                    {selectedObservation.stationsLabel}
                    {selectedObservation.sourceLine != null
                      ? ` @${selectedObservation.sourceLine}`
                      : ''}
                  </span>
                )}
                {selectedStation && (
                  <span className="rounded border border-amber-800 bg-amber-950/30 px-2 py-1">
                    Selected station: {selectedStation.id}
                  </span>
                )}
                {pinnedObservations.map((entry) => (
                  <button
                    key={entry.id}
                    type="button"
                    data-qa-pinned-observation={entry.id}
                    onClick={() => {
                      selectObservation(entry.id, 'report');
                      setActiveTab('report');
                    }}
                    className="rounded border border-slate-700 bg-slate-900/70 px-2 py-1 text-[11px] hover:border-cyan-400"
                  >
                    Pinned #{entry.id} {entry.type.toUpperCase()}
                  </button>
                ))}
                {(selectedObservation || selectedStation) && (
                  <button
                    type="button"
                    onClick={clearSelection}
                    className="rounded border border-slate-700 bg-slate-900/70 px-2 py-1 text-[11px] hover:border-slate-500"
                  >
                    Clear selection
                  </button>
                )}
              </div>
            </div>
          )}
          <WorkspaceChrome
            activeTab={activeTab}
            onActiveTabChange={handleWorkspaceTabChange}
            isSidebarOpen={isSidebarOpen}
            onShowInput={() => setIsSidebarOpen(true)}
            hasResult={Boolean(result)}
            hasMapContent={true}
            renderReportContent={() => (
              <React.Suspense
                fallback={
                  <div className="flex h-full items-center justify-center text-sm text-slate-400">
                    Loading tab...
                  </div>
                }
              >
                <ReportView
                  result={result!}
                  units={settings.units}
                  precisionReportingMode="industry-standard"
                  viewState={workspaceReviewState}
                  runDiagnostics={runDiagnostics}
                  excludedIds={excludedIds}
                  onToggleExclude={toggleExclude}
                  onApplyImpactExclude={applyImpactExclusion}
                  onApplyPreanalysisAction={applyPreanalysisPlanningAction}
                  onApplyAllPreanalysisActions={applyAllPreanalysisPlanningActions}
                  onReRun={handleValidatedRun}
                  onClearExclusions={clearExclusions}
                  onJumpToSourceLine={handleJumpToSourceLine}
                  pendingRunSettingDiffs={pendingRunSettingDiffs}
                  overrides={overrides}
                  onOverride={handleOverride}
                  onResetOverrides={resetOverrides}
                  clusterReviewDecisions={clusterReviewDecisions}
                  activeClusterApprovedMerges={activeClusterApprovedMerges}
                  onClusterDecisionStatus={handleClusterDecisionStatus}
                  onClusterCanonicalSelection={handleClusterCanonicalSelection}
                  onApplyClusterMerges={applyClusterReviewMerges}
                  onResetClusterReview={resetClusterReview}
                  onClearClusterMerges={clearClusterApprovedMerges}
                  focusFilterRequestKey={reportFilterFocusRequestKey}
                  selectedStationId={selection.stationId}
                  selectedObservationId={selection.observationId}
                  onSelectStation={handleReportStationSelection}
                  onSelectObservation={handleReportObservationSelection}
                />
              </React.Suspense>
            )}
            renderProcessingSummaryContent={() =>
              canRenderTab('processing-summary') ? (
                <React.Suspense
                  fallback={
                    <div className="flex h-full items-center justify-center text-sm text-slate-400">
                      Loading tab...
                    </div>
                  }
                >
                  <ProcessingSummaryView
                    result={result!}
                    units={settings.units}
                    runElapsedMs={runElapsedMs}
                    runDiagnostics={processingSummaryDiagnostics}
                  />
                </React.Suspense>
              ) : (
                <div className="flex h-full items-center justify-center text-sm text-slate-400">
                  Preparing summary...
                </div>
              )
            }
            renderIndustryOutputContent={() =>
              canRenderTab('industry-output') ? (
                <React.Suspense
                  fallback={
                    <div className="flex h-full items-center justify-center text-sm text-slate-400">
                      Loading tab...
                    </div>
                  }
                >
                  <IndustryOutputView
                    text={industryOutputText}
                    listingSortObservationsBy={settings.listingSortObservationsBy}
                    onChangeListingSortObservationsBy={handleIndustryListingSortChange}
                    onJumpToSourceLine={handleJumpToSourceLine}
                  />
                </React.Suspense>
              ) : (
                <div className="flex h-full items-center justify-center text-sm text-slate-400">
                  Preparing industry output...
                </div>
              )
            }
            renderMapContent={() =>
              result == null || canRenderTab('map') ? (
                <React.Suspense
                  fallback={
                    <div className="flex h-full items-center justify-center text-sm text-slate-400">
                      Loading tab...
                    </div>
                  }
                >
                  <MapView
                    result={mapResult}
                    units={settings.units}
                    planningMap={planningMap}
                    onPlanningMapChange={setPlanningMap}
                    inputPointsLoaded={planningMapPreview != null}
                    onLoadInputPoints={handleLoadPlanningInputPoints}
                    showLostStations={settings.mapShowLostStations}
                    mode={result != null && settings.map3dEnabled ? '3d' : '2d'}
                    adjustedPointsExportSettings={adjustedPointsExportSettings}
                    derivedResult={result != null ? qaDerivedResult : null}
                    selectedStationId={selection.stationId}
                    selectedObservationId={selection.observationId}
                    onSelectStation={handleMapStationSelection}
                    onSelectObservation={handleMapObservationSelection}
                    snapshot={mapViewSnapshot}
                    onSnapshotChange={setMapViewSnapshot}
                  />
                </React.Suspense>
              ) : (
                <div className="flex h-full items-center justify-center text-sm text-slate-400">
                  Preparing map...
                </div>
              )
            }
          />
            </>
          )}
        </div>
      </div>

      {pendingAnglePromptFile && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/85 px-4 py-6">
          <div className="w-full max-w-md border border-slate-500 bg-slate-900 shadow-2xl">
            <div className="border-b border-slate-700 bg-slate-800 px-5 py-4">
              <div className="text-[11px] uppercase tracking-[0.24em] text-cyan-300">
                Import Settings
              </div>
              <div className="mt-1 text-lg font-semibold text-white">
                Choose JXL Import Handling
              </div>
              <div className="mt-1 text-xs text-slate-400">{pendingAnglePromptFile.file.name}</div>
            </div>
            <div className="space-y-3 px-5 py-4 text-sm text-slate-200">
              <div>
                <div className="text-[11px] uppercase tracking-[0.22em] text-cyan-300">
                  Import Style
                </div>
                <div className="mt-2 space-y-3">
                  <div>
                    <button
                      type="button"
                      onClick={() => handleImportAnglePromptSetImportStyle('generic')}
                      className={`w-full border px-3 py-3 text-left text-xs uppercase tracking-wide ${
                        pendingAnglePromptFile.importStyle === 'generic'
                          ? 'border-cyan-500 bg-cyan-900/40 text-cyan-100'
                          : 'border-slate-600 bg-slate-950 text-slate-100 hover:border-cyan-400'
                      }`}
                    >
                      Generic
                    </button>
                    <div className="mt-1 text-xs text-slate-400">
                      Keep current WebNet-style grouped import flow and serializer behavior.
                    </div>
                  </div>
                  <div>
                    <button
                      type="button"
                      onClick={() => handleImportAnglePromptSetImportStyle('industry-style')}
                      className={`w-full border px-3 py-3 text-left text-xs uppercase tracking-wide ${
                        pendingAnglePromptFile.importStyle === 'industry-style'
                          ? 'border-cyan-500 bg-cyan-900/40 text-cyan-100'
                          : 'border-slate-600 bg-slate-950 text-slate-100 hover:border-cyan-400'
                      }`}
                    >
                      Industry Style
                    </button>
                    <div className="mt-1 text-xs text-slate-400">
                      Preserve raw JobXML fieldbook HZ, zenith, corrected slope distance, and
                      round-based `DB/DM/DE` blocks.
                    </div>
                  </div>
                </div>
                {pendingAnglePromptFile.importStyle === 'industry-style' && (
                  <div className="mt-2 text-xs text-amber-300">
                    Industry Style is fixed mode: raw fieldbook order, raw circles, and no
                    face-split prompt options.
                  </div>
                )}
              </div>
              <div>
                <button
                  type="button"
                  onClick={() => handleImportAnglePromptSetAngleMode('raw')}
                  disabled={pendingAnglePromptFile.importStyle === 'industry-style'}
                  className={`w-full border px-3 py-3 text-left text-xs uppercase tracking-wide ${
                    pendingAnglePromptFile.importStyle === 'industry-style'
                      ? 'cursor-not-allowed border-slate-800 bg-slate-950 text-slate-500'
                      : pendingAnglePromptFile.angleMode === 'raw'
                      ? 'border-cyan-500 bg-cyan-900/40 text-cyan-100'
                      : 'border-slate-600 bg-slate-950 text-slate-100 hover:border-cyan-400'
                  }`}
                >
                  Raw Angles
                </button>
                <div className="mt-1 text-xs text-slate-400">
                  Keep imported angle values as-is from the source file.
                </div>
              </div>
              <div>
                <button
                  type="button"
                  onClick={() => handleImportAnglePromptSetAngleMode('reduced')}
                  disabled={pendingAnglePromptFile.importStyle === 'industry-style'}
                  className={`w-full border px-3 py-3 text-left text-xs uppercase tracking-wide ${
                    pendingAnglePromptFile.importStyle === 'industry-style'
                      ? 'cursor-not-allowed border-slate-800 bg-slate-950 text-slate-500'
                      : pendingAnglePromptFile.angleMode === 'reduced'
                      ? 'border-cyan-500 bg-cyan-900/40 text-cyan-100'
                      : 'border-slate-600 bg-slate-950 text-slate-100 hover:border-cyan-400'
                  }`}
                >
                  Reduced Angles (BS = 0)
                </button>
                <div className="mt-1 text-xs text-slate-400">
                  Use reduced-angle workflow with backsight-zero direction-set shaping.
                </div>
              </div>
              <div className="border-t border-slate-700 pt-3">
                <div className="text-[11px] uppercase tracking-[0.22em] text-cyan-300">
                  Face Treatment
                </div>
                <div className="mt-2 space-y-3">
                  <div>
                    <button
                      type="button"
                      onClick={() => handleImportAnglePromptSetFaceMode('on')}
                      disabled={pendingAnglePromptFile.importStyle === 'industry-style'}
                      className={`w-full border px-3 py-3 text-left text-xs uppercase tracking-wide ${
                        pendingAnglePromptFile.importStyle === 'industry-style'
                          ? 'cursor-not-allowed border-slate-800 bg-slate-950 text-slate-500'
                          : pendingAnglePromptFile.faceMode === 'on'
                          ? 'border-cyan-500 bg-cyan-900/40 text-cyan-100'
                          : 'border-slate-600 bg-slate-950 text-slate-100 hover:border-cyan-400'
                      }`}
                    >
                      Normalized Behavior
                    </button>
                    <div className="mt-1 text-xs text-slate-400">
                      Keep one logical direction set and normalize reliable face-II shots to face-I.
                    </div>
                  </div>
                  <div>
                    <button
                      type="button"
                      onClick={() => handleImportAnglePromptSetFaceMode('off')}
                      disabled={pendingAnglePromptFile.importStyle === 'industry-style'}
                      className={`w-full border px-3 py-3 text-left text-xs uppercase tracking-wide ${
                        pendingAnglePromptFile.importStyle === 'industry-style'
                          ? 'cursor-not-allowed border-slate-800 bg-slate-950 text-slate-500'
                          : pendingAnglePromptFile.faceMode === 'off'
                          ? 'border-cyan-500 bg-cyan-900/40 text-cyan-100'
                          : 'border-slate-600 bg-slate-950 text-slate-100 hover:border-cyan-400'
                      }`}
                    >
                      Split Behavior
                    </button>
                    <div className="mt-1 text-xs text-slate-400">
                      Split reliable face-I and face-II shots into separate direction-set blocks.
                    </div>
                  </div>
                </div>
              </div>
            </div>
            <div className="flex items-center justify-end border-t border-slate-700 bg-slate-800 px-5 py-4">
              <button
                type="button"
                onClick={handleImportAnglePromptCancel}
                className="border border-slate-500 bg-slate-700 px-4 py-2 text-xs uppercase tracking-wide text-slate-200 hover:bg-slate-600"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={handleImportAnglePromptAccept}
                className="ml-2 border border-cyan-500 bg-cyan-900/40 px-4 py-2 text-xs uppercase tracking-wide text-cyan-100 hover:bg-cyan-800/60"
              >
                Accept
              </button>
            </div>
          </div>
        </div>
      )}

      {importReviewState && (
        <React.Suspense fallback={null}>
          <ImportReviewModal
            sourceName={importReviewState.sourceName}
            title={importReviewState.notice.title}
            detailLines={importReviewState.notice.detailLines}
            reviewModel={importReviewState.reviewModel}
            comparisonSummary={importReviewState.comparisonSummary ?? null}
            comparisonMode={importReviewState.comparisonMode}
            displayedRows={importReviewDisplayedRows}
            excludedItemIds={importReviewState.excludedItemIds}
            fixedItemIds={importReviewState.fixedItemIds}
            groupLabels={importReviewState.groupLabels}
            groupComments={importReviewState.groupComments}
            rowTypeOverrides={importReviewState.rowTypeOverrides}
            preset={importReviewState.preset}
            conflicts={importReviewState.conflicts}
            conflictResolutions={importReviewState.conflictResolutions}
            conflictRenameValues={importReviewState.conflictRenameValues}
            resolutionValidationMessage={importReviewState.resolutionValidationMessage}
            moveTargetGroups={importReviewMoveTargetGroups}
            onCompareFile={handleImportReviewCompareFile}
            onClearComparison={handleImportReviewClearComparison}
            onComparisonModeChange={handleImportReviewComparisonModeChange}
            onPresetChange={handleImportReviewPresetChange}
            onSetBulkExcludeMta={handleImportReviewSetBulkExcludeMta}
            onSetBulkExcludeRaw={handleImportReviewSetBulkExcludeRaw}
            onConvertSlopeZenithToHd2D={handleImportReviewConvertSlopeZenithToHd2D}
            onSetGroupExcluded={handleImportReviewSetGroupExcluded}
            onConflictResolutionChange={handleImportConflictResolutionChange}
            onConflictRenameValueChange={handleImportConflictRenameValueChange}
            onToggleExclude={handleImportReviewToggleExclude}
            onToggleFixed={handleImportReviewToggleFixed}
            onCreateEmptySetupGroup={handleImportReviewCreateEmptySetupGroup}
            onGroupLabelChange={handleImportReviewGroupLabelChange}
            onCommentChange={handleImportReviewCommentChange}
            onRowTextChange={handleImportReviewRowTextChange}
            onRowTypeChange={handleImportReviewRowTypeChange}
            onDuplicateRow={handleImportReviewDuplicateRow}
            onInsertCommentBelow={handleImportReviewInsertCommentBelow}
            onCreateSetupGroup={handleImportReviewCreateSetupGroup}
            onMoveRow={handleImportReviewMoveRow}
            onReorderRow={handleImportReviewReorderRow}
            onRemoveGroup={handleImportReviewRemoveGroup}
            onRemoveRow={handleImportReviewRemoveRow}
            onCancel={handleCancelImportReview}
            onImportAsNewFile={() => {
              const selectedCount =
                importReviewState.reviewModel.items.length - importReviewState.excludedItemIds.size;
              const confirmed = confirmActionGuard({
                action: 'import-new-file',
                scope: `${selectedCount} selected row(s) from ${importReviewState.sourceName}`,
                detail:
                  'This keeps current editor text and appends reviewed rows as a new project source file.',
              });
              if (!confirmed) return;
              void handleApplyImportReviewAsNewFile();
            }}
            onImportAssociatedProjectSettings={triggerImportReviewSettingsFileSelect}
            pendingAssociatedSettingsSourceName={
              importReviewState.stagedAssociatedSettings?.sourceName ?? null
            }
            pendingAssociatedSettingsSummary={
              importReviewState.stagedAssociatedSettings
                ? [
                    importReviewState.stagedAssociatedSettings.appliedDomains.length > 0
                      ? `Applied: ${importReviewState.stagedAssociatedSettings.appliedDomains.join(', ')}.`
                      : null,
                    importReviewState.stagedAssociatedSettings.ignoredDomains.length > 0
                      ? `Ignored: ${importReviewState.stagedAssociatedSettings.ignoredDomains.join(', ')}.`
                      : null,
                  ]
                    .filter(Boolean)
                    .join(' ')
                : null
            }
            onImport={() => {
              const selectedCount =
                importReviewState.reviewModel.items.length - importReviewState.excludedItemIds.size;
              const confirmed = confirmActionGuard({
                action: 'import-apply',
                scope: `${selectedCount} selected row(s) from ${importReviewState.sourceName}`,
                detail:
                  'This replaces current editor/import target text with the reviewed import output.',
              });
              if (!confirmed) return;
              handleApplyImportReview();
            }}
          />
        </React.Suspense>
      )}
    </div>
  );
};

export default App;
