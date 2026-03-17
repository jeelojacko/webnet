import { useCallback, useEffect, useState } from 'react';
import { useAdjustmentRunner } from './useAdjustmentRunner';
import type { ClusterReviewDecision, ParseSettings, RunSettingsSnapshot, SettingsState } from '../appStateTypes';
import type {
  AdjustmentResult,
  ClusterApprovedMerge,
  ClusterRejectedProposal,
  InstrumentLibrary,
  ObservationOverride,
} from '../types';
import type { RunSessionOutcome, RunSessionRequest } from '../engine/runSession';

type ClusterCandidate = NonNullable<AdjustmentResult['clusterDiagnostics']>['candidates'][number];

type RunReviewContext = {
  candidates: ClusterCandidate[];
  decisions: Record<string, ClusterReviewDecision>;
};

interface UseAdjustmentWorkflowArgs<TRunDiagnostics> {
  input: string;
  lastRunInput: string | null;
  settings: Pick<SettingsState, 'maxIterations' | 'convergenceLimit' | 'units'>;
  parseSettings: ParseSettings;
  projectInstruments: InstrumentLibrary;
  selectedInstrument: string;
  projectIncludeFiles: Record<string, string>;
  geoidSourceData: Uint8Array | null;
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
    excludedIds: number[];
    overrideIds: number[];
    approvedClusterMerges: ClusterApprovedMerge[];
  }) => void;
}

const normalizeClusterApprovedMerges = (
  merges: ClusterApprovedMerge[],
): ClusterApprovedMerge[] => {
  const byAlias = new Map<string, string>();
  merges
    .map((merge) => ({
      aliasId: String(merge.aliasId ?? '').trim(),
      canonicalId: String(merge.canonicalId ?? '').trim(),
    }))
    .filter((merge) => merge.aliasId && merge.canonicalId && merge.aliasId !== merge.canonicalId)
    .sort(
      (a, b) =>
        a.aliasId.localeCompare(b.aliasId, undefined, { numeric: true }) ||
        a.canonicalId.localeCompare(b.canonicalId, undefined, { numeric: true }),
    )
    .forEach((merge) => {
      const prior = byAlias.get(merge.aliasId);
      if (!prior) {
        byAlias.set(merge.aliasId, merge.canonicalId);
        return;
      }
      if (merge.canonicalId.localeCompare(prior, undefined, { numeric: true }) < 0) {
        byAlias.set(merge.aliasId, merge.canonicalId);
      }
    });
  return [...byAlias.entries()]
    .map(([aliasId, canonicalId]) => ({ aliasId, canonicalId }))
    .sort(
      (a, b) =>
        a.canonicalId.localeCompare(b.canonicalId, undefined, { numeric: true }) ||
        a.aliasId.localeCompare(b.aliasId, undefined, { numeric: true }),
    );
};

const buildApprovedClusterMerges = (
  result: AdjustmentResult | null,
  decisions: Record<string, ClusterReviewDecision>,
): ClusterApprovedMerge[] => {
  const candidates = result?.clusterDiagnostics?.candidates ?? [];
  const merges: ClusterApprovedMerge[] = [];
  candidates.forEach((candidate) => {
    const decision = decisions[candidate.key];
    if (!decision || decision.status !== 'approve') return;
    const canonicalId = candidate.stationIds.includes(decision.canonicalId)
      ? decision.canonicalId
      : candidate.representativeId;
    candidate.stationIds.forEach((stationId) => {
      if (stationId === canonicalId) return;
      merges.push({ aliasId: stationId, canonicalId });
    });
  });
  return normalizeClusterApprovedMerges(merges);
};

const buildRejectedClusterProposals = (
  candidates: ClusterCandidate[],
  decisions: Record<string, ClusterReviewDecision>,
): ClusterRejectedProposal[] => {
  const rows: ClusterRejectedProposal[] = [];
  candidates.forEach((candidate) => {
    const decision = decisions[candidate.key];
    if (!decision || decision.status !== 'reject') return;
    const retainedId =
      decision.canonicalId && candidate.stationIds.includes(decision.canonicalId)
        ? decision.canonicalId
        : undefined;
    rows.push({
      key: candidate.key,
      representativeId: candidate.representativeId,
      stationIds: [...candidate.stationIds],
      memberCount: candidate.memberCount,
      retainedId,
      reason: 'Rejected by user review',
    });
  });
  return rows.sort((a, b) => a.key.localeCompare(b.key, undefined, { numeric: true }));
};

export const useAdjustmentWorkflow = <TRunDiagnostics>({
  input,
  lastRunInput,
  settings,
  parseSettings,
  projectInstruments,
  selectedInstrument,
  projectIncludeFiles,
  geoidSourceData,
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
      const next: Record<string, ClusterReviewDecision> = {};
      candidates.forEach((candidate) => {
        const prior = prev[candidate.key];
        const canonicalId =
          prior && candidate.stationIds.includes(prior.canonicalId)
            ? prior.canonicalId
            : candidate.representativeId;
        next[candidate.key] = {
          status: prior?.status ?? 'pending',
          canonicalId,
        };
      });
      return next;
    });
  }, [result?.clusterDiagnostics]);

  const applyRunOutcome = useCallback(
    (
      outcome: RunSessionOutcome,
      context: {
        inputSnapshot: string;
        parseSettingsSnapshot: ParseSettings;
        settingsSnapshot: RunSettingsSnapshot;
        overrideIds: number[];
        reviewContext?: RunReviewContext;
      },
    ) => {
      const solved = outcome.result;
      if (solved.clusterDiagnostics?.enabled) {
        const contextCandidates =
          context.reviewContext?.candidates ?? result?.clusterDiagnostics?.candidates ?? [];
        const contextDecisions = context.reviewContext?.decisions ?? clusterReviewDecisions;
        const rejected = buildRejectedClusterProposals(contextCandidates, contextDecisions);
        solved.clusterDiagnostics.rejectedProposals = rejected;
        if (rejected.length > 0) {
          solved.logs.unshift(`Cluster review: rejected proposals=${rejected.length}`);
        }
      }
      const runProfile = buildRunDiagnostics(context.parseSettingsSnapshot, solved);
      if ('parity' in (runProfile as object) && (runProfile as { parity?: boolean }).parity) {
        solved.logs.unshift(
          'Solve profile: Industry Standard parity (raw directions, classical weighting, industry default instrument fallback).',
        );
      }
      const runMode = (runProfile as { runMode?: string }).runMode;
      const plannedObservationCount =
        (runProfile as { plannedObservationCount?: number }).plannedObservationCount ?? 0;
      const preanalysisMode =
        (runProfile as { preanalysisMode?: boolean }).preanalysisMode ?? false;
      if (preanalysisMode) {
        solved.logs.unshift(
          `Run mode: preanalysis (planned observations=${plannedObservationCount}, residual-based QC disabled).`,
        );
      } else if (runMode && runMode !== 'adjustment') {
        solved.logs.unshift(`Run mode: ${runMode}.`);
      }
      if (
        outcome.inputChangedSinceLastRun &&
        (outcome.droppedExclusions > 0 ||
          outcome.droppedOverrides > 0 ||
          outcome.droppedClusterMerges > 0)
      ) {
        solved.logs.unshift(
          `Input changed since previous run: cleared ${outcome.droppedExclusions} exclusion(s), ${outcome.droppedOverrides} override(s), and ${outcome.droppedClusterMerges} approved cluster merge(s).`,
        );
        setOverrides({});
        setClusterReviewDecisions({});
      }
      setLastRunInput(context.inputSnapshot);
      setLastRunSettingsSnapshot(context.settingsSnapshot);
      setExcludedIds(new Set(outcome.effectiveExcludedIds));
      setActiveClusterApprovedMerges(outcome.effectiveClusterApprovedMerges);
      setRunDiagnostics(runProfile);
      setRunElapsedMs(outcome.elapsedMs);
      setResult(solved);
      activateReportTab();
      recordRunSnapshot({
        result: solved,
        runDiagnostics: runProfile,
        settingsSnapshot: context.settingsSnapshot,
        excludedIds: outcome.effectiveExcludedIds,
        overrideIds: context.overrideIds,
        approvedClusterMerges: outcome.effectiveClusterApprovedMerges,
      });
    },
    [
      activateReportTab,
      buildRunDiagnostics,
      clusterReviewDecisions,
      recordRunSnapshot,
      result?.clusterDiagnostics?.candidates,
      setLastRunInput,
      setLastRunSettingsSnapshot,
      setResult,
      setRunDiagnostics,
      setRunElapsedMs,
    ],
  );

  const runWithExclusions = useCallback(
    (
      excludeSet: Set<number>,
      approvedClusterMerges: ClusterApprovedMerge[] = activeClusterApprovedMerges,
      reviewContext?: RunReviewContext,
    ) => {
      const overrideIds = Object.keys(overrides)
        .map((value) => Number.parseInt(value, 10))
        .filter((value) => Number.isFinite(value));
      const request: RunSessionRequest = {
        input,
        lastRunInput,
        maxIterations: settings.maxIterations,
        convergenceLimit: settings.convergenceLimit,
        units: settings.units,
        parseSettings: { ...parseSettings },
        projectInstruments: Object.fromEntries(
          Object.entries(projectInstruments).map(([code, instrument]) => [code, { ...instrument }]),
        ),
        selectedInstrument,
        projectIncludeFiles: { ...projectIncludeFiles },
        geoidSourceData,
        excludedIds: [...excludeSet],
        overrides: { ...overrides },
        approvedClusterMerges,
      };
      const context = {
        inputSnapshot: input,
        parseSettingsSnapshot: { ...parseSettings },
        settingsSnapshot: currentRunSettingsSnapshot,
        overrideIds,
        reviewContext,
      };
      void runAdjustment(request)
        .then((outcome) => applyRunOutcome(outcome, context))
        .catch((error) => {
          if (error instanceof Error && error.message === 'Run cancelled') return;
          console.error(error);
        });
    },
    [
      activeClusterApprovedMerges,
      applyRunOutcome,
      currentRunSettingsSnapshot,
      geoidSourceData,
      input,
      lastRunInput,
      overrides,
      parseSettings,
      projectIncludeFiles,
      projectInstruments,
      runAdjustment,
      selectedInstrument,
      settings.convergenceLimit,
      settings.maxIterations,
      settings.units,
    ],
  );

  const handleRun = useCallback(() => {
    runWithExclusions(new Set(excludedIds), activeClusterApprovedMerges, {
      candidates: result?.clusterDiagnostics?.candidates ?? [],
      decisions: clusterReviewDecisions,
    });
  }, [
    activeClusterApprovedMerges,
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
      runWithExclusions(next, activeClusterApprovedMerges, {
        candidates: result?.clusterDiagnostics?.candidates ?? [],
        decisions: clusterReviewDecisions,
      });
    },
    [
      activeClusterApprovedMerges,
      clusterReviewDecisions,
      excludedIds,
      result?.clusterDiagnostics?.candidates,
      runWithExclusions,
    ],
  );

  const applyPreanalysisPlanningAction = useCallback(
    (id: number) => {
      const next = new Set(excludedIds);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      setExcludedIds(next);
      runWithExclusions(next, activeClusterApprovedMerges, {
        candidates: result?.clusterDiagnostics?.candidates ?? [],
        decisions: clusterReviewDecisions,
      });
    },
    [
      activeClusterApprovedMerges,
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
    runWithExclusions(new Set(excludedIds), approved, {
      candidates,
      decisions: clusterReviewDecisions,
    });
  }, [clusterReviewDecisions, excludedIds, result, runWithExclusions]);

  const resetClusterReview = useCallback(() => {
    const candidates = result?.clusterDiagnostics?.candidates ?? [];
    const next: Record<string, ClusterReviewDecision> = {};
    candidates.forEach((candidate) => {
      next[candidate.key] = {
        status: 'pending',
        canonicalId: candidate.representativeId,
      };
    });
    setClusterReviewDecisions(next);
  }, [result?.clusterDiagnostics?.candidates]);

  const clearClusterApprovedMerges = useCallback(() => {
    setActiveClusterApprovedMerges([]);
    runWithExclusions(new Set(excludedIds), [], {
      candidates: result?.clusterDiagnostics?.candidates ?? [],
      decisions: clusterReviewDecisions,
    });
  }, [
    clusterReviewDecisions,
    excludedIds,
    result?.clusterDiagnostics?.candidates,
    runWithExclusions,
  ]);

  const resetAdjustmentWorkflowState = useCallback(() => {
    setExcludedIds(new Set());
    setOverrides({});
    setClusterReviewDecisions({});
    setActiveClusterApprovedMerges([]);
  }, []);

  return {
    pipelineState,
    cancelAdjustment,
    excludedIds,
    overrides,
    clusterReviewDecisions,
    activeClusterApprovedMerges,
    handleRun,
    runWithExclusions,
    applyImpactExclusion,
    applyPreanalysisPlanningAction,
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
  };
};
