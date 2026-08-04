import { useCallback, type Dispatch, type SetStateAction } from 'react';
import type {
  ParseSettings,
  PersistedSavedRunSnapshot,
  SettingsState,
  SolveProfile,
} from '../appStateTypes';
import {
  DEFAULT_ADJUSTED_POINTS_EXPORT_SETTINGS,
  cloneAdjustedPointsExportSettings,
  sanitizeAdjustedPointsExportSettings,
} from '../engine/adjustedPointsExport';
import { cloneSurveyCadPersistedState } from '../engine/cad/cadPersistence';
import type { SurveyCadPersistedState } from '../engine/cad/cadTypes';
import { clonePlanningMapState, DEFAULT_PLANNING_MAP_STATE } from '../engine/planningMapState';
import type { ParsedProjectPayload } from '../engine/projectFile';
import {
  buildProjectEditorIncludeFiles,
  buildProjectLegacySolveInput,
  getProjectFocusedFile,
  normalizeWorkspaceState,
  type ProjectSessionState,
} from '../engine/projectWorkspace';
import { normalizeListingSortObservationsBy } from '../listingSortObservations';
import type {
  AdjustedPointsExportSettings,
  CustomLevelLoopTolerancePreset,
  InstrumentLibrary,
  ObservationModeSettings,
  PlanningMapState,
  ProjectExportFormat,
  RunMode,
} from '../types';
import { decodeBase64ToUint8Array } from './useWorkspaceRecovery';

interface UseProjectPayloadLoaderArgs {
  buildObservationModeFromGridFields: (_state: {
    gridBearingMode: ParseSettings['gridBearingMode'];
    gridDistanceMode: ParseSettings['gridDistanceMode'];
    gridAngleMode: ParseSettings['gridAngleMode'];
    gridDirectionMode: ParseSettings['gridDirectionMode'];
  }) => ObservationModeSettings;
  cloneInstrumentLibrary: (_library: InstrumentLibrary) => InstrumentLibrary;
  currentUiTheme: SettingsState['uiTheme'];
  normalizeSolveProfile: (_profile: SolveProfile) => SolveProfile;
  resetWorkspaceAfterProjectLoad: () => void;
  restoreSavedRunSnapshots: (_snapshots: PersistedSavedRunSnapshot[]) => void;
  setAdjustedPointsExportSettings: Dispatch<SetStateAction<AdjustedPointsExportSettings>>;
  setAdjustedPointsExportSettingsDraft: Dispatch<SetStateAction<AdjustedPointsExportSettings>>;
  setAdjustedPointsTransformSelectedDraft: Dispatch<SetStateAction<string[]>>;
  setExportFormat: Dispatch<SetStateAction<ProjectExportFormat>>;
  setGeoidSourceData: Dispatch<SetStateAction<Uint8Array | null>>;
  setGeoidSourceDataDraft: Dispatch<SetStateAction<Uint8Array | null>>;
  setGeoidSourceDataLabel: Dispatch<SetStateAction<string>>;
  setGeoidSourceDataLabelDraft: Dispatch<SetStateAction<string>>;
  setInput: Dispatch<SetStateAction<string>>;
  setIsAdjustedPointsTransformSelectOpen: Dispatch<SetStateAction<boolean>>;
  setLevelLoopCustomPresets: Dispatch<SetStateAction<CustomLevelLoopTolerancePreset[]>>;
  setLevelLoopCustomPresetsDraft: Dispatch<SetStateAction<CustomLevelLoopTolerancePreset[]>>;
  setParseSettings: Dispatch<SetStateAction<ParseSettings>>;
  setParseSettingsDraft: Dispatch<SetStateAction<ParseSettings>>;
  setPlanningMap?: Dispatch<SetStateAction<PlanningMapState>> | undefined;
  setProjectIncludeFiles: Dispatch<SetStateAction<Record<string, string>>>;
  setProjectInstruments: Dispatch<SetStateAction<InstrumentLibrary>>;
  setProjectInstrumentsDraft: Dispatch<SetStateAction<InstrumentLibrary>>;
  setSelectedInstrument: Dispatch<SetStateAction<string>>;
  setSelectedInstrumentDraft: Dispatch<SetStateAction<string>>;
  setSettings: Dispatch<SetStateAction<SettingsState>>;
  setSettingsDraft: Dispatch<SetStateAction<SettingsState>>;
  setSurveyCadState?: Dispatch<SetStateAction<SurveyCadPersistedState | null>> | undefined;
}

export const useProjectPayloadLoader = ({
  buildObservationModeFromGridFields,
  cloneInstrumentLibrary,
  currentUiTheme,
  normalizeSolveProfile,
  resetWorkspaceAfterProjectLoad,
  restoreSavedRunSnapshots,
  setAdjustedPointsExportSettings,
  setAdjustedPointsExportSettingsDraft,
  setAdjustedPointsTransformSelectedDraft,
  setExportFormat,
  setGeoidSourceData,
  setGeoidSourceDataDraft,
  setGeoidSourceDataLabel,
  setGeoidSourceDataLabelDraft,
  setInput,
  setIsAdjustedPointsTransformSelectOpen,
  setLevelLoopCustomPresets,
  setLevelLoopCustomPresetsDraft,
  setParseSettings,
  setParseSettingsDraft,
  setPlanningMap,
  setProjectIncludeFiles,
  setProjectInstruments,
  setProjectInstrumentsDraft,
  setSelectedInstrument,
  setSelectedInstrumentDraft,
  setSettings,
  setSettingsDraft,
  setSurveyCadState,
}: UseProjectPayloadLoaderArgs) => {
  const normalizeImportedProjectPayload = useCallback(
    (parsed: ParsedProjectPayload) => {
      const loadedSettings = parsed.ui.settings as unknown as SettingsState;
      const listingSortModeVersion =
        typeof parsed.ui.migration?.listingSortModeVersion === 'number'
          ? parsed.ui.migration.listingSortModeVersion
          : 1;
      const normalizedLoadedSettings: SettingsState = {
        ...loadedSettings,
        precisionReportingMode: 'industry-standard',
        uiTheme: currentUiTheme,
        showRunComparisonPanel: loadedSettings?.showRunComparisonPanel === true,
        showReviewQueuePanel: loadedSettings?.showReviewQueuePanel === true,
        listingSortObservationsBy: normalizeListingSortObservationsBy(
          loadedSettings?.listingSortObservationsBy,
          { legacyResidualMeansStdResidual: listingSortModeVersion < 2 },
        ),
      };
      const loadedParseSettings = parsed.ui.parseSettings as unknown as ParseSettings;
      const profileForMode = normalizeSolveProfile(
        (loadedParseSettings.solveProfile ?? 'industry-parity') as SolveProfile,
      );
      const normalizedRunMode: RunMode =
        loadedParseSettings.preanalysisMode === true
          ? 'preanalysis'
          : (loadedParseSettings.runMode ?? 'adjustment');
      const normalizedObservationMode = buildObservationModeFromGridFields({
        gridBearingMode:
          loadedParseSettings.gridBearingMode ?? loadedParseSettings.observationMode?.bearing,
        gridDistanceMode:
          loadedParseSettings.gridDistanceMode ?? loadedParseSettings.observationMode?.distance,
        gridAngleMode:
          loadedParseSettings.gridAngleMode ?? loadedParseSettings.observationMode?.angle,
        gridDirectionMode:
          loadedParseSettings.gridDirectionMode ?? loadedParseSettings.observationMode?.direction,
      });
      const normalizedLoadedParseSettings: ParseSettings = {
        ...loadedParseSettings,
        solveProfile: profileForMode,
        runMode: normalizedRunMode,
        preanalysisMode: normalizedRunMode === 'preanalysis',
        suspectImpactMode: loadedParseSettings.suspectImpactMode ?? 'auto',
        gridBearingMode: normalizedObservationMode.bearing,
        gridDistanceMode: normalizedObservationMode.distance,
        gridAngleMode: normalizedObservationMode.angle,
        gridDirectionMode: normalizedObservationMode.direction,
        observationMode: normalizedObservationMode,
        parseCompatibilityMode: 'strict',
        faceNormalizationMode: 'on',
        normalize: true,
        parseModeMigrated: true,
        crsTransformEnabled: false,
        crsProjectionModel: 'legacy-equirectangular',
        crsLabel: '',
        geoidSourceFormat: loadedParseSettings.geoidSourceFormat ?? 'builtin',
        geoidSourcePath: loadedParseSettings.geoidSourcePath ?? '',
        verticalDeflectionNorthSec: loadedParseSettings.verticalDeflectionNorthSec ?? 0,
        verticalDeflectionEastSec: loadedParseSettings.verticalDeflectionEastSec ?? 0,
        preanalysisAccuracyThresholdMeters:
          loadedParseSettings.preanalysisAccuracyThresholdMeters ?? 0.001,
        preanalysisMaxAddedSets: loadedParseSettings.preanalysisMaxAddedSets ?? 5,
      };
      const loadedAdjustedPointsSettings = sanitizeAdjustedPointsExportSettings(
        parsed.ui.adjustedPointsExport,
        {
          ...DEFAULT_ADJUSTED_POINTS_EXPORT_SETTINGS,
          includeLostStations: normalizedLoadedSettings.listingShowLostStations,
        },
      );
      return {
        normalizedLoadedSettings,
        normalizedLoadedParseSettings,
        loadedAdjustedPointsSettings,
        planningMap: clonePlanningMapState(parsed.ui.planningMap ?? DEFAULT_PLANNING_MAP_STATE),
        surveyCadState: parsed.project.surveyCad
          ? cloneSurveyCadPersistedState(parsed.project.surveyCad)
          : null,
        geoidSourceData: decodeBase64ToUint8Array(parsed.ui.geoidSourceDataBase64),
        geoidSourceDataLabel: parsed.ui.geoidSourceDataLabel ?? '',
        exportFormat: parsed.ui.exportFormat,
        projectInstruments: cloneInstrumentLibrary(parsed.project.projectInstruments),
        selectedInstrument: parsed.project.selectedInstrument,
        levelLoopCustomPresets: parsed.project.levelLoopCustomPresets.map((preset) => ({
          ...preset,
        })),
      };
    },
    [
      buildObservationModeFromGridFields,
      cloneInstrumentLibrary,
      currentUiTheme,
      normalizeSolveProfile,
    ],
  );

  const applyLoadedProjectPayload = useCallback(
    (
      parsed: ParsedProjectPayload,
      nextSession: ProjectSessionState | null,
      savedRuns: PersistedSavedRunSnapshot[],
    ) => {
      const normalized = normalizeImportedProjectPayload(parsed);
      const nextInput =
        nextSession != null
          ? nextSession.sourceTexts[
              getProjectFocusedFile(nextSession.manifest)?.id ??
                normalizeWorkspaceState(
                  nextSession.manifest.files,
                  nextSession.manifest.workspace,
                ).mainFileId ??
                ''
            ] ?? buildProjectLegacySolveInput(nextSession.manifest, nextSession.sourceTexts)
          : parsed.input;
      setInput(nextInput);
      setProjectIncludeFiles(
        nextSession != null
          ? buildProjectEditorIncludeFiles(
              nextSession.manifest,
              nextSession.sourceTexts,
              getProjectFocusedFile(nextSession.manifest)?.id,
            )
          : { ...(parsed.includeFiles ?? {}) },
      );
      setSettings(normalized.normalizedLoadedSettings);
      setParseSettings(normalized.normalizedLoadedParseSettings);
      setGeoidSourceData(normalized.geoidSourceData);
      setGeoidSourceDataLabel(normalized.geoidSourceDataLabel);
      setExportFormat(normalized.exportFormat);
      setAdjustedPointsExportSettings(
        cloneAdjustedPointsExportSettings(normalized.loadedAdjustedPointsSettings),
      );
      setPlanningMap?.(clonePlanningMapState(normalized.planningMap));
      setSurveyCadState?.(
        normalized.surveyCadState ? cloneSurveyCadPersistedState(normalized.surveyCadState) : null,
      );
      restoreSavedRunSnapshots(savedRuns);
      setProjectInstruments(normalized.projectInstruments);
      setSelectedInstrument(normalized.selectedInstrument);
      setLevelLoopCustomPresets(normalized.levelLoopCustomPresets);

      setSettingsDraft(normalized.normalizedLoadedSettings);
      setParseSettingsDraft(normalized.normalizedLoadedParseSettings);
      setGeoidSourceDataDraft(normalized.geoidSourceData);
      setGeoidSourceDataLabelDraft(normalized.geoidSourceDataLabel);
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
      resetWorkspaceAfterProjectLoad();
    },
    [
      cloneInstrumentLibrary,
      normalizeImportedProjectPayload,
      resetWorkspaceAfterProjectLoad,
      restoreSavedRunSnapshots,
      setAdjustedPointsExportSettings,
      setAdjustedPointsExportSettingsDraft,
      setAdjustedPointsTransformSelectedDraft,
      setExportFormat,
      setGeoidSourceData,
      setGeoidSourceDataDraft,
      setGeoidSourceDataLabel,
      setGeoidSourceDataLabelDraft,
      setInput,
      setIsAdjustedPointsTransformSelectOpen,
      setLevelLoopCustomPresets,
      setLevelLoopCustomPresetsDraft,
      setParseSettings,
      setParseSettingsDraft,
      setPlanningMap,
      setProjectIncludeFiles,
      setProjectInstruments,
      setProjectInstrumentsDraft,
      setSelectedInstrument,
      setSelectedInstrumentDraft,
      setSettings,
      setSettingsDraft,
      setSurveyCadState,
    ],
  );

  return {
    applyLoadedProjectPayload,
    normalizeImportedProjectPayload,
  };
};
