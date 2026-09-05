import {
  buildPreanalysisPlanningDiagnostics,
  buildPreanalysisSyntheticSetTemplates,
  buildSyntheticPreanalysisInput,
  resolveAppliedPreanalysisActionState,
} from './preanalysisPlanning';
import { buildParseOptions, resolveProfileContext } from './runSessionProfile';
import {
  buildSuspectImpactDiagnostics,
  collectSuspectImpactCandidates,
  rankedSuspects,
  resolveSuspectImpactSkipReason,
} from './runSessionSuspectImpact';
import type {
  RunSessionParseSettings,
  RunSessionProgressUpdate,
  RunSessionRequest,
  SolveInvocationMeta,
} from './runSessionTypes';
import { normalizeClusterApprovedMerges, solveEngine } from './solveEngine';
import type { SolveProgressEvent } from './scenarioRunModels';
import type { AdjustmentRuntime } from './adjustmentRuntime';
import type {
  AdjustmentResult,
  ClusterApprovedMerge,
  ObservationOverride,
} from '../types';

interface SessionSolveRunnerOptions {
  request: RunSessionRequest;
  startedAt: number;
  activePreanalysisAdditionIds: string[];
  effectiveOverrides: Record<number, ObservationOverride>;
  effectiveClusterMerges: ClusterApprovedMerge[];
  onProgress?: (_event: RunSessionProgressUpdate) => void;
  recordStageDuration: (_stageId: SolveInvocationMeta['stageId'], _durationMs: number) => void;
  /** Phase 7B internal runtime seam; undefined preserves exact legacy behavior. */
  runtime?: AdjustmentRuntime;
}

export interface SessionSolveRunner {
  solveCore: (
    _excludeSet: Set<number>,
    _parseOverride?: Partial<RunSessionParseSettings>,
    _overrideValues?: Record<number, ObservationOverride>,
    _approvedClusterMerges?: ClusterApprovedMerge[],
    _meta?: SolveInvocationMeta,
    _syntheticAdditionIds?: string[],
  ) => AdjustmentResult;
  solveWithImpacts: (
    _excludeSet: Set<number>,
    _overrideValues?: Record<number, ObservationOverride>,
    _approvedClusterMerges?: ClusterApprovedMerge[],
  ) => AdjustmentResult;
  getActivePreanalysisAdditionIds: () => string[];
  getSolveInvocationCount: () => number;
}

export const createSessionSolveRunner = ({
  request,
  startedAt,
  activePreanalysisAdditionIds: initialActivePreanalysisAdditionIds,
  effectiveOverrides,
  effectiveClusterMerges,
  onProgress,
  recordStageDuration,
  runtime,
}: SessionSolveRunnerOptions): SessionSolveRunner => {
  let activePreanalysisAdditionIds = [...initialActivePreanalysisAdditionIds];
  let solveInvocationCount = 0;
  let cachedPreanalysisTemplates:
    | ReturnType<typeof buildPreanalysisSyntheticSetTemplates>
    | null
    | undefined;

  const emitProgress = (
    meta: SolveInvocationMeta,
    solveIndex: number,
    iteration?: number,
    maxIterations?: number,
    phase: RunSessionProgressUpdate['phase'] = 'solving',
  ): void => {
    onProgress?.({
      phase,
      elapsedMs: Date.now() - startedAt,
      stageId: meta.stageId,
      stageLabel: meta.stageLabel,
      solveIndex,
      solveTotalHint: Math.max(meta.solveTotalHint, solveIndex),
      iteration,
      maxIterations,
    });
  };

  const resolvePreanalysisTemplates = (
    profileContext: ReturnType<typeof resolveProfileContext>,
    excludeSet: Set<number>,
    overrideValues: Record<number, ObservationOverride>,
    normalizedMerges: ClusterApprovedMerge[],
  ) => {
    if (profileContext.effectiveParse.runMode !== 'preanalysis') return [];
    if (cachedPreanalysisTemplates !== undefined) return cachedPreanalysisTemplates ?? [];
    const templateSource = solveEngine({
      input: request.input,
      maxIterations: request.maxIterations,
      convergenceThreshold: request.convergenceLimit,
      instrumentLibrary: profileContext.effectiveInstrumentLibrary,
      excludeIds: excludeSet,
      overrides: overrideValues,
      geoidSourceData:
        profileContext.effectiveParse.geoidSourceFormat !== 'builtin'
          ? (request.geoidSourceData ?? undefined)
          : undefined,
      parseOptions: {
        ...buildParseOptions(
          request,
          profileContext.effectiveParse,
          profileContext.directionSetMode,
          profileContext.allowClusterFaceReliability,
          normalizedMerges,
          profileContext.currentInstrument,
        ),
        preanalysisSyntheticAdditionIds: [],
      },
      runtime,
    });
    cachedPreanalysisTemplates = buildPreanalysisSyntheticSetTemplates(
      request.input,
      templateSource,
      request.planningMap,
      activePreanalysisAdditionIds,
    );
    return cachedPreanalysisTemplates;
  };

  const solveCore = (
    excludeSet: Set<number>,
    parseOverride?: Partial<RunSessionParseSettings>,
    overrideValues: Record<number, ObservationOverride> = effectiveOverrides,
    approvedClusterMerges: ClusterApprovedMerge[] = effectiveClusterMerges,
    meta: SolveInvocationMeta = {
      stageId: 'main-solve',
      stageLabel: 'Main solve',
      solveTotalHint: 1,
    },
    syntheticAdditionIds: string[] = activePreanalysisAdditionIds,
  ): AdjustmentResult => {
    const mergedParse = { ...request.parseSettings, ...parseOverride, autoAdjustEnabled: false };
    const profileContext = resolveProfileContext(
      mergedParse,
      request.projectInstruments,
      request.selectedInstrument,
    );
    const normalizedMerges = profileContext.effectiveParse.clusterDetectionEnabled
      ? normalizeClusterApprovedMerges(approvedClusterMerges)
      : [];
    const preanalysisTemplates = resolvePreanalysisTemplates(
      profileContext,
      excludeSet,
      overrideValues,
      normalizedMerges,
    );
    const normalizedSyntheticAdditionIds =
      profileContext.effectiveParse.runMode === 'preanalysis'
        ? resolveAppliedPreanalysisActionState(preanalysisTemplates, syntheticAdditionIds)
            .normalizedScenarioIds
        : syntheticAdditionIds;
    const solveInput =
      profileContext.effectiveParse.runMode === 'preanalysis'
        ? buildSyntheticPreanalysisInput(
            request.input,
            normalizedSyntheticAdditionIds,
            preanalysisTemplates,
          )
        : request.input;

    const solveIndex = solveInvocationCount + 1;
    const stageStartedAt = Date.now();
    emitProgress(meta, solveIndex, undefined, request.maxIterations);
    const result = solveEngine({
      input: solveInput,
      maxIterations: request.maxIterations,
      convergenceThreshold: request.convergenceLimit,
      instrumentLibrary: profileContext.effectiveInstrumentLibrary,
      excludeIds: excludeSet,
      overrides: overrideValues,
      geoidSourceData:
        profileContext.effectiveParse.geoidSourceFormat !== 'builtin'
          ? (request.geoidSourceData ?? undefined)
          : undefined,
      parseOptions: buildParseOptions(
        request,
        {
          ...profileContext.effectiveParse,
          preanalysisSyntheticAdditionIds: normalizedSyntheticAdditionIds,
        },
        profileContext.directionSetMode,
        profileContext.allowClusterFaceReliability,
        normalizedMerges,
        profileContext.currentInstrument,
        solveInput !== request.input ? { sourceInputOverride: solveInput } : undefined,
      ),
      runtime,
      progressCallback: (event: SolveProgressEvent) => {
        if (event.phase === 'complete') return;
        emitProgress(
          meta,
          solveIndex,
          event.iteration > 0 ? event.iteration : undefined,
          event.maxIterations,
        );
      },
    });
    result.preanalysisSyntheticAdditionIds = [...normalizedSyntheticAdditionIds];
    solveInvocationCount += 1;
    recordStageDuration(meta.stageId, Date.now() - stageStartedAt);
    return result;
  };

  const solveWithImpacts = (
    excludeSet: Set<number>,
    overrideValues: Record<number, ObservationOverride> = effectiveOverrides,
    approvedClusterMerges: ClusterApprovedMerge[] = effectiveClusterMerges,
  ): AdjustmentResult => {
    const mainSolveStartedAt = Date.now();
    const solved = solveCore(excludeSet, undefined, overrideValues, approvedClusterMerges, {
      stageId: 'main-solve',
      stageLabel: 'Main solve',
      solveTotalHint: 1,
    });
    const mainSolveElapsedMs = Date.now() - mainSolveStartedAt;
    const profileContext = resolveProfileContext(
      request.parseSettings,
      request.projectInstruments,
      request.selectedInstrument,
    );
    if (profileContext.effectiveParse.runMode === 'preanalysis') {
      activePreanalysisAdditionIds = [
        ...(solved.preanalysisSyntheticAdditionIds ?? activePreanalysisAdditionIds),
      ];
      solved.suspectImpactDiagnostics = undefined;
      const preanalysisTemplates = resolvePreanalysisTemplates(
        profileContext,
        excludeSet,
        overrideValues,
        profileContext.effectiveParse.clusterDetectionEnabled
          ? normalizeClusterApprovedMerges(approvedClusterMerges)
          : [],
      );
      solved.preanalysisImpactDiagnostics = buildPreanalysisPlanningDiagnostics({
        base: solved,
        input: request.input,
        planningMap: request.planningMap,
        activeTemplateIds: activePreanalysisAdditionIds,
        targetThresholdMeters: profileContext.effectiveParse.preanalysisAccuracyThresholdMeters,
        maxAddedSets: profileContext.effectiveParse.preanalysisMaxAddedSets,
        solveScenario: (nextTemplateIds) =>
          solveCore(
            excludeSet,
            undefined,
            overrideValues,
            approvedClusterMerges,
            {
              stageId: 'preanalysis-impact',
              stageLabel: `Preanalysis impact ${Math.max(1, nextTemplateIds.length)}`,
              solveTotalHint: 1 + Math.max(1, preanalysisTemplates.length),
            },
            nextTemplateIds,
          ),
      });
      solved.robustComparison = { enabled: false, classicalTop: [], robustTop: [], overlapCount: 0 };
      return solved;
    }
    if (profileContext.effectiveParse.runMode !== 'adjustment') {
      solved.suspectImpactDiagnostics = undefined;
      solved.preanalysisImpactDiagnostics = undefined;
      solved.robustComparison = { enabled: false, classicalTop: [], robustTop: [], overlapCount: 0 };
      return solved;
    }
    const suspectImpactCandidates = collectSuspectImpactCandidates(solved);
    const suspectImpactSkipReason = resolveSuspectImpactSkipReason({
      mode: profileContext.effectiveParse.suspectImpactMode,
      mainSolveElapsedMs,
      candidateCount: suspectImpactCandidates.length,
    });
    if (suspectImpactSkipReason) {
      solved.suspectImpactDiagnostics = undefined;
      solved.logs.unshift(
        `Suspect impact analysis skipped: ${suspectImpactSkipReason} Candidates=${suspectImpactCandidates.length}.`,
      );
    } else {
      solved.suspectImpactDiagnostics = buildSuspectImpactDiagnostics(
        solved,
        suspectImpactCandidates,
        excludeSet,
        overrideValues,
        approvedClusterMerges,
        solveCore,
      );
    }
    solved.preanalysisImpactDiagnostics = undefined;
    const suspectImpactCount = solved.suspectImpactDiagnostics?.length ?? 0;
    if (profileContext.effectiveParse.robustMode !== 'none') {
      const classical = solveCore(
        excludeSet,
        { robustMode: 'none' },
        overrideValues,
        approvedClusterMerges,
        {
          stageId: 'robust-compare',
          stageLabel: 'Robust comparison',
          solveTotalHint: 1 + suspectImpactCount + 1,
        },
      );
      const classicalTop = rankedSuspects(classical, 10);
      const robustTop = rankedSuspects(solved, 10);
      const robustIds = new Set(robustTop.map((row) => row.obsId));
      solved.robustComparison = {
        enabled: true,
        classicalTop,
        robustTop,
        overlapCount: classicalTop.reduce(
          (count, row) => count + (robustIds.has(row.obsId) ? 1 : 0),
          0,
        ),
      };
    } else {
      solved.robustComparison = { enabled: false, classicalTop: [], robustTop: [], overlapCount: 0 };
    }
    return solved;
  };

  return {
    solveCore,
    solveWithImpacts,
    getActivePreanalysisAdditionIds: () => [...activePreanalysisAdditionIds],
    getSolveInvocationCount: () => solveInvocationCount,
  };
};
