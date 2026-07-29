import type { ParseSettings, RunSettingsSnapshot, SettingsState } from '../appStateTypes';
import type {
  ClusterApprovedMerge,
  InstrumentLibrary,
  ObservationOverride,
  PlanningMapState,
} from '../types';
import type { ProjectRunFile } from '../engine/projectWorkspace';
import type { RunSessionRequest } from '../engine/runSession';
import { buildValueFingerprint } from '../engine/qaWorkflow';
import type { ApplyRunOutcomeContext } from './useAdjustmentOutcomeApplication';
import type { RunReviewContext } from './useAdjustmentWorkflowClusters';

interface BuildRunRequestArgs {
  input: string;
  lastRunInput: string | null;
  settings: Pick<SettingsState, 'maxIterations' | 'convergenceLimit' | 'units'>;
  parseSettings: ParseSettings;
  projectInstruments: InstrumentLibrary;
  selectedInstrument: string;
  projectIncludeFiles: Record<string, string>;
  projectRunFiles?: ProjectRunFile[];
  geoidSourceData: Uint8Array | null;
  planningMap: PlanningMapState;
  excludeSet: Set<number>;
  preanalysisAdditionSet: Set<string>;
  overrides: Record<number, ObservationOverride>;
  approvedClusterMerges: ClusterApprovedMerge[];
  currentRunSettingsSnapshot: RunSettingsSnapshot;
  reviewContext?: RunReviewContext;
}

export const buildRunRequestAndContext = ({
  input,
  lastRunInput,
  settings,
  parseSettings,
  projectInstruments,
  selectedInstrument,
  projectIncludeFiles,
  projectRunFiles,
  geoidSourceData,
  planningMap,
  excludeSet,
  preanalysisAdditionSet,
  overrides,
  approvedClusterMerges,
  currentRunSettingsSnapshot,
  reviewContext,
}: BuildRunRequestArgs): {
  request: RunSessionRequest;
  context: ApplyRunOutcomeContext;
} => {
  const overrideIds = Object.keys(overrides)
    .map((value) => Number.parseInt(value, 10))
    .filter((value) => Number.isFinite(value));
  return {
    request: {
      input,
      lastRunInput,
      maxIterations: settings.maxIterations,
      convergenceLimit: settings.convergenceLimit,
      units: settings.units,
      parseSettings: {
        ...parseSettings,
        preanalysisMaxAddedSets: parseSettings.preanalysisMaxAddedSets ?? 5,
      },
      projectInstruments: Object.fromEntries(
        Object.entries(projectInstruments).map(([code, instrument]) => [code, { ...instrument }]),
      ),
      selectedInstrument,
      projectIncludeFiles: { ...projectIncludeFiles },
      projectRunFiles: projectRunFiles?.map((file) => ({ ...file })),
      geoidSourceData,
      planningMap: JSON.parse(JSON.stringify(planningMap)) as PlanningMapState,
      excludedIds: [...excludeSet],
      activePreanalysisAdditionIds: [...preanalysisAdditionSet].sort((a, b) =>
        a.localeCompare(b, undefined, { numeric: true }),
      ),
      overrides: { ...overrides },
      approvedClusterMerges,
    },
    context: {
      inputSnapshot: input,
      parseSettingsSnapshot: { ...parseSettings },
      settingsSnapshot: currentRunSettingsSnapshot,
      inputFingerprint: buildValueFingerprint({
        input,
        runFiles: projectRunFiles,
        includeFiles: projectIncludeFiles,
      }),
      overrideIds,
      reviewContext,
    },
  };
};
