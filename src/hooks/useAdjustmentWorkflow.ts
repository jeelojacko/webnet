import { useCallback, useEffect, useState } from 'react';
import { useAdjustmentRunner } from './useAdjustmentRunner';
import type { ClusterReviewDecision, ParseSettings, RunSettingsSnapshot, SettingsState } from '../appStateTypes';
import type {
  AdjustmentResult,
  ClusterApprovedMerge,
  InstrumentLibrary,
  ObservationOverride,
  PlanningMapState,
} from '../types';
import type { ProjectRunFile } from '../engine/projectWorkspace';
import type { RunSessionOutcome, RunSessionRequest } from '../engine/runSession';
import { DEFAULT_PLANNING_MAP_STATE } from '../engine/planningMapState';
import { useAdjustmentOutcomeApplication } from './useAdjustmentOutcomeApplication';
import { buildRunRequestAndContext } from './useAdjustmentRunRequest';
import {
  buildApprovedClusterMerges,
  buildClusterReviewDecisionsFromState,
  buildPendingClusterReviewDecisions,
  type RunReviewContext,
} from './useAdjustmentWorkflowClusters';

interface UseAdjustmentWorkflowArgs<TRunDiagnostics> {
  input: string;
  lastRunInput: string | null;
  settings: Pick<SettingsState, 'maxIterations' | 'convergenceLimit' | 'units'>;
  parseSettings: ParseSettings;
  projectInstruments: InstrumentLibrary;
  selectedInstrument: string;
  projectIncludeFiles: Record<string, string>;
  projectRunFiles?: ProjectRunFile[];
  geoidSourceData: Uint8Array | null;
  planningMap?: PlanningMapState;
  currentRunSettingsSnapshot: RunSettingsSnapshot;
  result: AdjustmentResult | null;
  buildRunDiagnostics: (_parseSettings: ParseSettings, _solved: AdjustmentResult) => TRunDiagnostics;
  directRunner: (_request: RunSessionRequest) => RunSessionOutcome;
  setResult: (_value: AdjustmentResult | null) => void;
  setRunDiagnostics: (_value: TRunDiagnostics | null) => void;
  setRunElapsedMs: (_value: number | null) => void;
  setLastRunInput: (_value: string | null) => void;
  setLastRunSettingsSnapshot: (_value: RunSettingsSnapshot | null) => void;
  activateReportTab: () => void;
  recordRunSnapshot: (_snapshot: {
    result: AdjustmentResult;
    runDiagnostics: TRunDiagnostics;
    settingsSnapshot: RunSettingsSnapshot;
    inputFingerprint: string;
    excludedIds: number[];
    activePreanalysisAdditionIds: string[];
    overrideIds: number[];
    overrides: Record<number, ObservationOverride>;
    approvedClusterMerges: ClusterApprovedMerge[];
  }) => void;
}

export const useAdjustmentWorkflow = <TRunDiagnostics>({
  input,
  lastRunInput,
  settings,
  parseSettings,
  projectInstruments,
  selectedInstrument,
  projectIncludeFiles,
  projectRunFiles,
  geoidSourceData,
  planningMap = DEFAULT_PLANNING_MAP_STATE,
  currentRunSettingsSnapshot,
  result,
  buildRunDiagnostics,
  directRunner,
  setResult,
  setRunDiagnostics,
  setRunElapsedMs,
  setLastRunInput,
  setLastRunSettingsSnapshot,
  activateReportTab,
  recordRunSnapshot,
}: UseAdjustmentWorkflowArgs<TRunDiagnostics>) => {
  const [excludedIds, setExcludedIds] = useState<Set<number>>(new Set());
  const [activePreanalysisAdditionIds, setActivePreanalysisAdditionIds] = useState<Set<string>>(
    new Set(),
  );
  const [overrides, setOverrides] = useState<Record<number, ObservationOverride>>({});
  const [clusterReviewDecisions, setClusterReviewDecisions] = useState<
    Record<string, ClusterReviewDecision>
  >({});
  const [activeClusterApprovedMerges, setActiveClusterApprovedMerges] = useState<
    ClusterApprovedMerge[]
  >([]);
  const { pipelineState, run: runAdjustment, cancel: cancelAdjustment } =
    useAdjustmentRunner(directRunner);

  useEffect(() => {
    const candidates = result?.clusterDiagnostics?.candidates ?? [];
    setClusterReviewDecisions((prev) => {
      return buildPendingClusterReviewDecisions(candidates, prev);
    });
  }, [result?.clusterDiagnostics]);

  const applyRunOutcome = useAdjustmentOutcomeApplication({
    result,
    clusterReviewDecisions,
    overrides,
    buildRunDiagnostics,
    setExcludedIds,
    setActivePreanalysisAdditionIds,
    setOverrides,
    setClusterReviewDecisions,
    setActiveClusterApprovedMerges,
    setResult,
    setRunDiagnostics,
    setRunElapsedMs,
    setLastRunInput,
    setLastRunSettingsSnapshot,
    activateReportTab,
    recordRunSnapshot,
  });

  const runWithExclusions = useCallback(
    (
      excludeSet: Set<number>,
      preanalysisAdditionSet: Set<string> = activePreanalysisAdditionIds,
      approvedClusterMerges: ClusterApprovedMerge[] = activeClusterApprovedMerges,
      reviewContext?: RunReviewContext,
    ) => {
      const { request, context } = buildRunRequestAndContext({
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
      });
      void runAdjustment(request)
        .then((outcome) => applyRunOutcome(outcome, context))
        .catch((error) => {
          if (error instanceof Error && error.message === 'Run cancelled') return;
          console.error(error);
        });
    },
    [
      activeClusterApprovedMerges,
      activePreanalysisAdditionIds,
      applyRunOutcome,
      currentRunSettingsSnapshot,
      geoidSourceData,
      input,
      lastRunInput,
      overrides,
      parseSettings,
      planningMap,
      projectIncludeFiles,
      projectInstruments,
      projectRunFiles,
      runAdjustment,
      selectedInstrument,
      settings,
    ],
  );

  const handleRun = useCallback(() => {
    runWithExclusions(new Set(excludedIds), new Set(activePreanalysisAdditionIds), activeClusterApprovedMerges, {
      candidates: result?.clusterDiagnostics?.candidates ?? [],
      decisions: clusterReviewDecisions,
    });
  }, [
    activeClusterApprovedMerges,
    activePreanalysisAdditionIds,
    clusterReviewDecisions,
    excludedIds,
    result?.clusterDiagnostics?.candidates,
    runWithExclusions,
  ]);

  const applyImpactExclusion = useCallback(
    (id: number) => {
      const next = new Set(excludedIds);
      next.add(id);
      setExcludedIds(next);
      runWithExclusions(next, new Set(activePreanalysisAdditionIds), activeClusterApprovedMerges, {
        candidates: result?.clusterDiagnostics?.candidates ?? [],
        decisions: clusterReviewDecisions,
      });
    },
    [
      activeClusterApprovedMerges,
      activePreanalysisAdditionIds,
      clusterReviewDecisions,
      excludedIds,
      result?.clusterDiagnostics?.candidates,
      runWithExclusions,
    ],
  );

  const applyPreanalysisPlanningAction = useCallback(
    (id: string) => {
      const next = new Set(activePreanalysisAdditionIds);
      next.add(id);
      setActivePreanalysisAdditionIds(next);
      runWithExclusions(new Set(excludedIds), next, activeClusterApprovedMerges, {
        candidates: result?.clusterDiagnostics?.candidates ?? [],
        decisions: clusterReviewDecisions,
      });
    },
    [
      activeClusterApprovedMerges,
      activePreanalysisAdditionIds,
      clusterReviewDecisions,
      excludedIds,
      result?.clusterDiagnostics?.candidates,
      runWithExclusions,
    ],
  );

  const applyAllPreanalysisPlanningActions = useCallback(
    (ids: string[]) => {
      if (ids.length === 0) return;
      const next = new Set(activePreanalysisAdditionIds);
      ids.forEach((id) => {
        if (id) next.add(id);
      });
      setActivePreanalysisAdditionIds(next);
      runWithExclusions(new Set(excludedIds), next, activeClusterApprovedMerges, {
        candidates: result?.clusterDiagnostics?.candidates ?? [],
        decisions: clusterReviewDecisions,
      });
    },
    [
      activeClusterApprovedMerges,
      activePreanalysisAdditionIds,
      clusterReviewDecisions,
      excludedIds,
      result?.clusterDiagnostics?.candidates,
      runWithExclusions,
    ],
  );

  const toggleExclude = useCallback((id: number) => {
    setExcludedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }, []);

  const clearExclusions = useCallback(() => {
    setExcludedIds(new Set());
  }, []);

  const handleOverride = useCallback((id: number, payload: ObservationOverride) => {
    setOverrides((prev) => ({ ...prev, [id]: { ...prev[id], ...payload } }));
  }, []);

  const resetOverrides = useCallback(() => {
    setOverrides({});
  }, []);

  const handleClusterDecisionStatus = useCallback(
    (clusterKey: string, status: ClusterReviewDecision['status']) => {
      const candidate = result?.clusterDiagnostics?.candidates.find((entry) => entry.key === clusterKey);
      if (!candidate) return;
      setClusterReviewDecisions((prev) => {
        const prior = prev[clusterKey];
        const canonicalId =
          prior && candidate.stationIds.includes(prior.canonicalId)
            ? prior.canonicalId
            : candidate.representativeId;
        return {
          ...prev,
          [clusterKey]: {
            status,
            canonicalId,
          },
        };
      });
    },
    [result?.clusterDiagnostics?.candidates],
  );

  const handleClusterCanonicalSelection = useCallback(
    (clusterKey: string, canonicalId: string) => {
      const candidate = result?.clusterDiagnostics?.candidates.find((entry) => entry.key === clusterKey);
      if (!candidate || !candidate.stationIds.includes(canonicalId)) return;
      setClusterReviewDecisions((prev) => {
        const prior = prev[clusterKey];
        return {
          ...prev,
          [clusterKey]: {
            status: prior?.status ?? 'pending',
            canonicalId,
          },
        };
      });
    },
    [result?.clusterDiagnostics?.candidates],
  );

  const applyClusterReviewMerges = useCallback(() => {
    const candidates = result?.clusterDiagnostics?.candidates ?? [];
    const approved = buildApprovedClusterMerges(result, clusterReviewDecisions);
    setActiveClusterApprovedMerges(approved);
    runWithExclusions(new Set(excludedIds), new Set(activePreanalysisAdditionIds), approved, {
      candidates,
      decisions: clusterReviewDecisions,
    });
  }, [activePreanalysisAdditionIds, clusterReviewDecisions, excludedIds, result, runWithExclusions]);

  const resetClusterReview = useCallback(() => {
    const candidates = result?.clusterDiagnostics?.candidates ?? [];
    setClusterReviewDecisions(buildPendingClusterReviewDecisions(candidates));
  }, [result?.clusterDiagnostics?.candidates]);

  const clearClusterApprovedMerges = useCallback(() => {
    setActiveClusterApprovedMerges([]);
    runWithExclusions(new Set(excludedIds), new Set(activePreanalysisAdditionIds), [], {
      candidates: result?.clusterDiagnostics?.candidates ?? [],
      decisions: clusterReviewDecisions,
    });
  }, [
    activePreanalysisAdditionIds,
    clusterReviewDecisions,
    excludedIds,
    result?.clusterDiagnostics?.candidates,
    runWithExclusions,
  ]);

  const resetAdjustmentWorkflowState = useCallback(() => {
    setExcludedIds(new Set());
    setActivePreanalysisAdditionIds(new Set());
    setOverrides({});
    setClusterReviewDecisions({});
    setActiveClusterApprovedMerges([]);
  }, []);

  const restoreAdjustmentWorkflowState = useCallback(
    ({
      result: snapshotResult,
      excludedIds: nextExcludedIds,
      activePreanalysisAdditionIds: nextPreanalysisAdditionIds,
      overrides: nextOverrides,
      approvedClusterMerges,
    }: {
      result: AdjustmentResult;
      excludedIds: number[];
      activePreanalysisAdditionIds: string[];
      overrides: Record<number, ObservationOverride>;
      approvedClusterMerges: ClusterApprovedMerge[];
    }) => {
      setExcludedIds(new Set(nextExcludedIds));
      setActivePreanalysisAdditionIds(new Set(nextPreanalysisAdditionIds));
      setOverrides({ ...nextOverrides });
      setActiveClusterApprovedMerges(approvedClusterMerges.map((merge) => ({ ...merge })));
      setClusterReviewDecisions(
        buildClusterReviewDecisionsFromState(snapshotResult, approvedClusterMerges),
      );
    },
    [],
  );

  return {
    pipelineState,
    cancelAdjustment,
    excludedIds,
    activePreanalysisAdditionIds,
    overrides,
    clusterReviewDecisions,
    activeClusterApprovedMerges,
    handleRun,
    runWithExclusions,
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
  };
};
