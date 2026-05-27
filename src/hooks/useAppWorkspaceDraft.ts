import { useMemo, type Dispatch, type SetStateAction } from 'react';
import {
  cloneAdjustedPointsExportSettings,
} from '../engine/adjustedPointsExport';
import { cloneSavedRunSnapshots } from '../engine/qaWorkflow';
import { cloneInstrumentLibrary, resolveCatalogGroupFromCrsId } from '../app/appHelpers';
import type {
  CrsCatalogGroupFilter,
  ParseSettings,
  PersistedSavedRunSnapshot,
  SettingsState,
  WorkspaceDraftSnapshot,
  WorkspaceReviewState,
  WorkspaceTabKey,
} from '../appStateTypes';
import type {
  AdjustedPointsExportSettings,
  CustomLevelLoopTolerancePreset,
  InstrumentLibrary,
  ProjectExportFormat,
} from '../types';
import {
  createDefaultWorkspaceReviewState,
} from './useWorkspaceReviewState';
import { clonePlanningMapState, sanitizePlanningMapState } from '../engine/planningMapState';
import {
  decodeBase64ToUint8Array,
  encodeUint8ArrayToBase64,
  useWorkspaceRecovery,
} from './useWorkspaceRecovery';
import { normalizeListingSortObservationsBy } from '../listingSortObservations';
import type { SurveyCadPersistedState } from '../engine/cad/cadTypes';
import { cloneSurveyCadPersistedState } from '../engine/cad/cadPersistence';

interface UseAppWorkspaceDraftArgs {
  input: string;
  projectIncludeFiles: Record<string, string>;
  settings: SettingsState;
  parseSettings: ParseSettings;
  exportFormat: ProjectExportFormat;
  adjustedPointsExportSettings: AdjustedPointsExportSettings;
  projectInstruments: InstrumentLibrary;
  selectedInstrument: string;
  levelLoopCustomPresets: CustomLevelLoopTolerancePreset[];
  geoidSourceData: Uint8Array | null;
  geoidSourceDataLabel: string;
  surveyCadState: SurveyCadPersistedState | null;
  activeTab: WorkspaceTabKey;
  splitPercent: number;
  isSidebarOpen: boolean;
  mapDeclutterPreset: 'standard' | 'dense-review';
  planningMap: NonNullable<WorkspaceDraftSnapshot['view']['planningMap']>;
  persistedWorkspaceReviewSnapshot: WorkspaceReviewState;
  stationMovementThreshold: number;
  residualDeltaThreshold: number;
  savedRunSnapshots: PersistedSavedRunSnapshot[];
  importReviewSnapshot: WorkspaceDraftSnapshot['importReview'];
  recoveryDisabled: boolean;
  clearWorkspaceArtifacts: () => void;
  resetAdjustmentWorkflowState: () => void;
  clearRunComparisonState: () => void;
  resetWorkspaceReviewState: () => void;
  resetImportReviewWorkflow: () => void;
  restoreSavedRunSnapshots: (_snapshots: WorkspaceDraftSnapshot['savedRunSnapshots']) => void;
  restoreWorkspaceReviewSnapshot: (_snapshot: WorkspaceReviewState) => void;
  restoreImportReviewWorkflow: (
    _snapshot: WorkspaceDraftSnapshot['importReview'] | undefined,
  ) => void;
  setInput: Dispatch<SetStateAction<string>>;
  setProjectIncludeFiles: Dispatch<SetStateAction<Record<string, string>>>;
  setSettings: Dispatch<SetStateAction<SettingsState>>;
  setSettingsDraft: Dispatch<SetStateAction<SettingsState>>;
  setParseSettings: Dispatch<SetStateAction<ParseSettings>>;
  setParseSettingsDraft: Dispatch<SetStateAction<ParseSettings>>;
  setGeoidSourceData: Dispatch<SetStateAction<Uint8Array | null>>;
  setGeoidSourceDataDraft: Dispatch<SetStateAction<Uint8Array | null>>;
  setGeoidSourceDataLabel: Dispatch<SetStateAction<string>>;
  setGeoidSourceDataLabelDraft: Dispatch<SetStateAction<string>>;
  setExportFormat: Dispatch<SetStateAction<ProjectExportFormat>>;
  setAdjustedPointsExportSettings: Dispatch<SetStateAction<AdjustedPointsExportSettings>>;
  setAdjustedPointsExportSettingsDraft: Dispatch<SetStateAction<AdjustedPointsExportSettings>>;
  setProjectInstruments: Dispatch<SetStateAction<InstrumentLibrary>>;
  setProjectInstrumentsDraft: Dispatch<SetStateAction<InstrumentLibrary>>;
  setSelectedInstrument: Dispatch<SetStateAction<string>>;
  setSelectedInstrumentDraft: Dispatch<SetStateAction<string>>;
  setLevelLoopCustomPresets: Dispatch<SetStateAction<CustomLevelLoopTolerancePreset[]>>;
  setLevelLoopCustomPresetsDraft: Dispatch<SetStateAction<CustomLevelLoopTolerancePreset[]>>;
  setIsAdjustedPointsTransformSelectOpen: Dispatch<SetStateAction<boolean>>;
  setAdjustedPointsTransformSelectedDraft: Dispatch<SetStateAction<string[]>>;
  setAdjustedPointsRotationAngleInput: Dispatch<SetStateAction<string>>;
  setAdjustedPointsTranslationAzimuthInput: Dispatch<SetStateAction<string>>;
  setAdjustedPointsRotationAngleError: Dispatch<SetStateAction<string | null>>;
  setAdjustedPointsTranslationAzimuthError: Dispatch<SetStateAction<string | null>>;
  setCrsCatalogGroupFilter: Dispatch<SetStateAction<CrsCatalogGroupFilter>>;
  setCrsSearchQuery: Dispatch<SetStateAction<string>>;
  setShowCrsProjectionParams: Dispatch<SetStateAction<boolean>>;
  setActiveTab: Dispatch<SetStateAction<WorkspaceTabKey>>;
  setSplitPercent: Dispatch<SetStateAction<number>>;
  setIsSidebarOpen: Dispatch<SetStateAction<boolean>>;
  setMapDeclutterPreset: Dispatch<SetStateAction<'standard' | 'dense-review'>>;
  setPlanningMap: Dispatch<
    SetStateAction<NonNullable<WorkspaceDraftSnapshot['view']['planningMap']>>
  >;
  setSurveyCadState: Dispatch<SetStateAction<SurveyCadPersistedState | null>>;
  setComparisonSelection: Dispatch<
    SetStateAction<{
      baselineRunId: string | null;
      pinnedBaselineRunId: string | null;
      stationMovementThreshold: number;
      residualDeltaThreshold: number;
    }>
  >;
  setImportNotice: Dispatch<
    SetStateAction<{ title: string; detailLines: string[] } | null>
  >;
}

export const useAppWorkspaceDraft = ({
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
  stationMovementThreshold,
  residualDeltaThreshold,
  savedRunSnapshots,
  importReviewSnapshot,
  recoveryDisabled,
  clearWorkspaceArtifacts,
  resetAdjustmentWorkflowState,
  clearRunComparisonState,
  resetWorkspaceReviewState,
  resetImportReviewWorkflow,
  restoreSavedRunSnapshots,
  restoreWorkspaceReviewSnapshot,
  restoreImportReviewWorkflow,
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
}: UseAppWorkspaceDraftArgs) => {
  const workspaceDraftSnapshot = useMemo<WorkspaceDraftSnapshot>(
    () => ({
      listingSortModeVersion: 2,
      input,
      projectIncludeFiles,
      settings: { ...settings },
      parseSettings: { ...parseSettings },
      exportFormat,
      adjustedPointsExportSettings: cloneAdjustedPointsExportSettings(adjustedPointsExportSettings),
      projectInstruments: cloneInstrumentLibrary(projectInstruments),
      selectedInstrument,
      levelLoopCustomPresets: levelLoopCustomPresets.map((preset) => ({ ...preset })),
      geoidSourceDataBase64: encodeUint8ArrayToBase64(geoidSourceData),
      geoidSourceDataLabel,
      surveyCadState: surveyCadState ? cloneSurveyCadPersistedState(surveyCadState) : undefined,
      view: {
        activeTab,
        splitPercent,
        isSidebarOpen,
        mapDeclutterPreset,
        planningMap: clonePlanningMapState(planningMap),
        review: persistedWorkspaceReviewSnapshot,
      },
      comparisonView: {
        stationMovementThreshold,
        residualDeltaThreshold,
      },
      savedRunSnapshots: cloneSavedRunSnapshots(savedRunSnapshots),
      importReview: importReviewSnapshot,
    }),
    [
      activeTab,
      adjustedPointsExportSettings,
      exportFormat,
      geoidSourceData,
      geoidSourceDataLabel,
      importReviewSnapshot,
      input,
      isSidebarOpen,
      levelLoopCustomPresets,
      mapDeclutterPreset,
      planningMap,
      parseSettings,
      persistedWorkspaceReviewSnapshot,
      projectIncludeFiles,
      projectInstruments,
      residualDeltaThreshold,
      savedRunSnapshots,
      selectedInstrument,
      settings,
      splitPercent,
      stationMovementThreshold,
      surveyCadState,
    ],
  );

  const resetRunStateAfterImportedInput = () => {
    clearWorkspaceArtifacts();
    resetAdjustmentWorkflowState();
    clearRunComparisonState();
    resetWorkspaceReviewState();
    resetImportReviewWorkflow();
  };

  const applyWorkspaceDraftSnapshot = (snapshot: WorkspaceDraftSnapshot) => {
    const recoveredGeoidBytes = decodeBase64ToUint8Array(snapshot.geoidSourceDataBase64);
    const clonedAdjustedPointsExport = cloneAdjustedPointsExportSettings(
      snapshot.adjustedPointsExportSettings,
    );
    const clonedProjectInstruments = cloneInstrumentLibrary(snapshot.projectInstruments);
    const clonedLevelLoopPresets = snapshot.levelLoopCustomPresets.map((preset) => ({
      ...preset,
    }));
    const defaultReviewState = createDefaultWorkspaceReviewState();
    const legacySelection = snapshot.view.selection ?? defaultReviewState.selection;
    const legacyPinnedObservationIds =
      snapshot.view.pinnedObservationIds ?? defaultReviewState.pinnedObservationIds;
    clearWorkspaceArtifacts();
    resetAdjustmentWorkflowState();
    clearRunComparisonState();
    resetWorkspaceReviewState();
    resetImportReviewWorkflow();
    restoreSavedRunSnapshots(snapshot.savedRunSnapshots ?? []);
    setInput(snapshot.input);
    setProjectIncludeFiles({ ...snapshot.projectIncludeFiles });
    const legacySortMode =
      typeof snapshot.listingSortModeVersion !== 'number' || snapshot.listingSortModeVersion < 2;
    const normalizedSnapshotSettings: SettingsState = {
      ...snapshot.settings,
      showRunComparisonPanel: snapshot.settings.showRunComparisonPanel === true,
      showReviewQueuePanel: snapshot.settings.showReviewQueuePanel === true,
      listingSortObservationsBy: normalizeListingSortObservationsBy(
        snapshot.settings.listingSortObservationsBy,
        { legacyResidualMeansStdResidual: legacySortMode },
      ),
    };
    setSettings(normalizedSnapshotSettings);
    setSettingsDraft(normalizedSnapshotSettings);
    setParseSettings({ ...snapshot.parseSettings });
    setParseSettingsDraft({ ...snapshot.parseSettings });
    setGeoidSourceData(recoveredGeoidBytes);
    setGeoidSourceDataDraft(recoveredGeoidBytes);
    setGeoidSourceDataLabel(snapshot.geoidSourceDataLabel);
    setGeoidSourceDataLabelDraft(snapshot.geoidSourceDataLabel);
    setSurveyCadState(
      snapshot.surveyCadState ? cloneSurveyCadPersistedState(snapshot.surveyCadState) : null,
    );
    setExportFormat(snapshot.exportFormat);
    setAdjustedPointsExportSettings(clonedAdjustedPointsExport);
    setAdjustedPointsExportSettingsDraft(
      cloneAdjustedPointsExportSettings(clonedAdjustedPointsExport),
    );
    setProjectInstruments(clonedProjectInstruments);
    setProjectInstrumentsDraft(cloneInstrumentLibrary(clonedProjectInstruments));
    setSelectedInstrument(snapshot.selectedInstrument);
    setSelectedInstrumentDraft(snapshot.selectedInstrument);
    setLevelLoopCustomPresets(clonedLevelLoopPresets);
    setLevelLoopCustomPresetsDraft(clonedLevelLoopPresets.map((preset) => ({ ...preset })));
    setIsAdjustedPointsTransformSelectOpen(false);
    setAdjustedPointsTransformSelectedDraft(
      clonedAdjustedPointsExport.transform.selectedStationIds.slice(),
    );
    setAdjustedPointsRotationAngleInput('');
    setAdjustedPointsTranslationAzimuthInput('');
    setAdjustedPointsRotationAngleError(null);
    setAdjustedPointsTranslationAzimuthError(null);
    setCrsCatalogGroupFilter(resolveCatalogGroupFromCrsId(snapshot.parseSettings.crsId));
    setCrsSearchQuery('');
    setShowCrsProjectionParams(false);
    setActiveTab(snapshot.view.activeTab);
    setSplitPercent(Math.max(20, Math.min(80, snapshot.view.splitPercent)));
    setIsSidebarOpen(snapshot.view.isSidebarOpen);
    setMapDeclutterPreset(snapshot.view.mapDeclutterPreset ?? 'standard');
    setPlanningMap(sanitizePlanningMapState(snapshot.view.planningMap));
    restoreWorkspaceReviewSnapshot(
      snapshot.view.review ?? {
        ...defaultReviewState,
        selection: legacySelection,
        pinnedObservationIds: legacyPinnedObservationIds,
      },
    );
    restoreImportReviewWorkflow(snapshot.importReview ?? null);
    setComparisonSelection((prev) => ({
      ...prev,
      baselineRunId: null,
      pinnedBaselineRunId: null,
      stationMovementThreshold: snapshot.comparisonView.stationMovementThreshold,
      residualDeltaThreshold: snapshot.comparisonView.residualDeltaThreshold,
    }));
    setImportNotice({
      title: 'Draft recovered',
      detailLines: [
        'Recovered browser-local workspace draft.',
        'Adjustment results were not restored; rerun adjustment to rebuild report and map state.',
      ],
    });
  };

  const recovery = useWorkspaceRecovery({
    snapshot: workspaceDraftSnapshot,
    onRecover: applyWorkspaceDraftSnapshot,
    disabled: recoveryDisabled,
  });

  return {
    workspaceDraftSnapshot,
    resetRunStateAfterImportedInput,
    ...recovery,
  };
};
