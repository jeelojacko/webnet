import { useCallback } from 'react';
import { ACTIVE_PARITY_STARTUP_DEFAULTS } from '../app/appConfig';
import type {
  ParseSettings,
  RunDiagnostics,
  RunSettingsSnapshot,
  SettingsState,
  SolveProfile,
} from '../appStateTypes';
import { runAdjustmentSession } from '../engine/runSession';
import { createRunProfileBuilders } from '../engine/runProfileBuilders';
import type { ProjectRunFile, ProjectSessionState } from '../engine/projectWorkspace';
import type {
  AdjustmentResult,
  InstrumentLibrary,
  ObservationOverride,
  PlanningMapState,
} from '../types';
import { useAdjustmentWorkflow } from './useAdjustmentWorkflow';

interface UseAppRunWorkflowShellArgs {
  projectInstruments: InstrumentLibrary;
  selectedInstrument: string;
  defaultIndustryInstrumentCode: string;
  defaultIndustryInstrument: import('../types').Instrument;
  normalizeSolveProfile: (_profile: SolveProfile) => SolveProfile;
  projectSession: ProjectSessionState | null;
  activeProjectRunFiles: ProjectRunFile[];
  result: AdjustmentResult | null;
  runDiagnostics: RunDiagnostics | null;
  settings: Pick<SettingsState, 'maxIterations' | 'convergenceLimit' | 'units'>;
  parseSettings: ParseSettings;
  effectiveRunInput: string;
  lastRunInput: string | null;
  effectiveRunIncludeFiles: Record<string, string>;
  geoidSourceData: Uint8Array | null;
  planningMap: PlanningMapState;
  currentRunSettingsSnapshot: RunSettingsSnapshot;
  setResult: (_value: AdjustmentResult | null) => void;
  setRunDiagnostics: (_value: RunDiagnostics | null) => void;
  setRunElapsedMs: (_value: number | null) => void;
  setLastRunInput: (_value: string | null) => void;
  setLastRunSettingsSnapshot: (_value: RunSettingsSnapshot | null) => void;
  activateReportTab: () => void;
  recordRunSnapshot: (_snapshot: {
    result: AdjustmentResult;
    runDiagnostics: RunDiagnostics;
    settingsSnapshot: RunSettingsSnapshot;
    inputFingerprint: string;
    excludedIds: number[];
    activePreanalysisAdditionIds: string[];
    overrideIds: number[];
    overrides: Record<number, ObservationOverride>;
    approvedClusterMerges: import('../types').ClusterApprovedMerge[];
  }) => void;
  projectRunValidation: { ok: boolean; errors: string[] };
  setImportNotice: (_value: { title: string; detailLines: string[] } | null) => void;
}

export const useAppRunWorkflowShell = ({
  projectInstruments,
  selectedInstrument,
  defaultIndustryInstrumentCode,
  defaultIndustryInstrument,
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
}: UseAppRunWorkflowShellArgs) => {
  const { buildRunDiagnostics } = createRunProfileBuilders({
    projectInstruments,
    selectedInstrument,
    defaultIndustryInstrumentCode,
    defaultIndustryInstrument,
    normalizeSolveProfile,
  });

  const buildRunDiagnosticsWithProjectMetadata = useCallback(
    (base: ParseSettings, solved?: AdjustmentResult): RunDiagnostics => {
      const next = buildRunDiagnostics(base, solved);
      const projectName = projectSession?.manifest.name ?? ACTIVE_PARITY_STARTUP_DEFAULTS?.projectName;
      const projectSourceFiles =
        activeProjectRunFiles.length > 0 ? activeProjectRunFiles.map((file) => file.name) : next.projectSourceFiles;
      const projectFolder =
        activeProjectRunFiles.length > 0
          ? activeProjectRunFiles[0]?.name.replace(/[\\/][^\\/]+$/, '')
          : next.projectFolder;
      if (!projectName && (!projectSourceFiles || projectSourceFiles.length === 0) && !projectFolder) {
        return next;
      }
      return {
        ...next,
        projectName: projectName ?? next.projectName,
        projectFolder: projectFolder ?? next.projectFolder,
        projectSourceFiles: projectSourceFiles ?? next.projectSourceFiles,
      };
    },
    [activeProjectRunFiles, buildRunDiagnostics, projectSession],
  );

  const adjustmentWorkflow = useAdjustmentWorkflow<RunDiagnostics>({
    input: effectiveRunInput,
    lastRunInput,
    settings,
    parseSettings,
    projectInstruments,
    selectedInstrument,
    projectIncludeFiles: effectiveRunIncludeFiles,
    projectRunFiles: activeProjectRunFiles,
    geoidSourceData,
    planningMap,
    currentRunSettingsSnapshot,
    result,
    buildRunDiagnostics: buildRunDiagnosticsWithProjectMetadata,
    directRunner: runAdjustmentSession,
    setResult,
    setRunDiagnostics,
    setRunElapsedMs,
    setLastRunInput,
    setLastRunSettingsSnapshot,
    activateReportTab,
    recordRunSnapshot,
  });

  const handleValidatedRun = useCallback(() => {
    if (!projectRunValidation.ok) {
      setImportNotice({
        title: 'Run blocked',
        detailLines: projectRunValidation.errors,
      });
      return;
    }
    adjustmentWorkflow.handleRun();
  }, [adjustmentWorkflow, projectRunValidation, setImportNotice]);

  const exportRunDiagnostics = result
    ? (runDiagnostics ?? buildRunDiagnosticsWithProjectMetadata(parseSettings, result))
    : null;

  return {
    ...adjustmentWorkflow,
    buildRunDiagnosticsWithProjectMetadata,
    exportRunDiagnostics,
    handleValidatedRun,
  };
};
