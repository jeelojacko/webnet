import {
  extractAutoAdjustDirectiveFromInput,
  formatAutoAdjustLogLines,
  runAutoAdjustCycles,
  type AutoAdjustConfig,
} from './autoAdjust';
import { isPreanalysisWhatIfCandidate } from './preanalysis';
import { createRunProfileBuilders } from './runProfileBuilders';
import { normalizeClusterApprovedMerges, solveEngine } from './solveEngine';
import type {
  ParseSettings,
  SolveProfile,
} from '../appStateTypes';
import type {
  AdjustmentResult,
  ClusterApprovedMerge,
  Instrument,
  Observation,
  ObservationOverride,
  RunMode,
} from '../types';
import type { RunSessionOutcome, RunSessionRequest } from './runSession';

const IMPACT_MAX_CANDIDATES = 8;
const PREANALYSIS_IMPACT_MAX_CANDIDATES = 24;
const AUTO_ADJUST_MIN_REDUNDANCY = 0.05;

const observationStationsLabel = (obs: Observation): string => {
  if ('at' in obs && 'from' in obs && 'to' in obs) return `${obs.at}-${obs.from}-${obs.to}`;
  if ('at' in obs && 'to' in obs) return `${obs.at}-${obs.to}`;
  if ('from' in obs && 'to' in obs) return `${obs.from}-${obs.to}`;
  return '-';
};

const hasLocalFailure = (obs: Observation): boolean => {
  if (obs.localTestComponents) return !obs.localTestComponents.passE || !obs.localTestComponents.passN;
  if (obs.localTest) return !obs.localTest.pass;
  return false;
};

const maxAbsStdRes = (res: AdjustmentResult): number =>
  res.observations.reduce((maxVal, obs) => {
    if (!Number.isFinite(obs.stdRes)) return maxVal;
    return Math.max(maxVal, Math.abs(obs.stdRes ?? 0));
  }, 0);

const rankedSuspects = (
  res: AdjustmentResult,
  limit = 10,
): NonNullable<AdjustmentResult['robustComparison']>['robustTop'] => {
  const rows = [...res.observations]
    .filter((obs) => Number.isFinite(obs.stdRes))
    .map((obs) => ({
      obsId: obs.id,
      type: obs.type,
      stations: observationStationsLabel(obs),
      sourceLine: obs.sourceLine,
      stdRes: obs.stdRes != null ? Math.abs(obs.stdRes) : undefined,
      localFail: hasLocalFailure(obs),
    }))
    .sort((a, b) => {
      const aFail = a.localFail ? 1 : 0;
      const bFail = b.localFail ? 1 : 0;
      if (bFail !== aFail) return bFail - aFail;
      return (b.stdRes ?? 0) - (a.stdRes ?? 0);
    });
  return rows.slice(0, limit).map((row, index) => ({ ...row, rank: index + 1 }));
};

const medianOf = (values: number[]): number | undefined => {
  if (values.length === 0) return undefined;
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  if (sorted.length % 2 === 0) return (sorted[mid - 1] + sorted[mid]) / 2;
  return sorted[mid];
};

const preanalysisStationMajors = (res: AdjustmentResult): number[] =>
  (res.stationCovariances ?? []).map(
    (row) => row.ellipse?.semiMajor ?? Math.max(row.sigmaE, row.sigmaN),
  );

const preanalysisRelativeMetrics = (res: AdjustmentResult): number[] =>
  (res.relativeCovariances ?? []).map(
    (row) => row.sigmaDist ?? row.ellipse?.semiMajor ?? Math.max(row.sigmaE, row.sigmaN),
  );

const preanalysisWeakStationCount = (res: AdjustmentResult): number =>
  (res.weakGeometryDiagnostics?.stationCues ?? []).filter((cue) => cue.severity !== 'ok').length;

const preanalysisWeakPairCount = (res: AdjustmentResult): number =>
  (res.weakGeometryDiagnostics?.relativeCues ?? []).filter((cue) => cue.severity !== 'ok').length;

const maxUnknownCoordinateShift = (base: AdjustmentResult, alt: AdjustmentResult): number => {
  let maxShift = 0;
  Object.entries(base.stations).forEach(([id, station]) => {
    if (station.fixed) return;
    const altStation = alt.stations[id];
    if (!altStation) return;
    const dx = altStation.x - station.x;
    const dy = altStation.y - station.y;
    const dh = altStation.h - station.h;
    maxShift = Math.max(maxShift, Math.sqrt(dx * dx + dy * dy + dh * dh));
  });
  return maxShift;
};

interface CreateDirectRunPipelineArgs {
  defaultIndustryInstrumentCode: string;
  defaultIndustryInstrument: Instrument;
  normalizeSolveProfile: (_profile: SolveProfile) => Exclude<SolveProfile, 'industry-parity'>;
}

export const createDirectRunPipeline = ({
  defaultIndustryInstrumentCode,
  defaultIndustryInstrument,
  normalizeSolveProfile,
}: CreateDirectRunPipelineArgs) => {
  const solveCore = (
    request: RunSessionRequest,
    excludeSet: Set<number>,
    parseOverride?: Partial<ParseSettings>,
    overrideValues: Record<number, ObservationOverride> = request.overrides,
    approvedClusterMerges: ClusterApprovedMerge[] = request.approvedClusterMerges,
  ): AdjustmentResult => {
    const mergedParse = { ...request.parseSettings, ...parseOverride };
    const { resolveProfileContext } = createRunProfileBuilders({
      projectInstruments: request.projectInstruments,
      selectedInstrument: request.selectedInstrument,
      defaultIndustryInstrumentCode,
      defaultIndustryInstrument,
      normalizeSolveProfile,
    });
    const profileCtx = resolveProfileContext(mergedParse as ParseSettings);
    const effectiveParse = profileCtx.effectiveParse;
    const normalizedClusterMerges = effectiveParse.clusterDetectionEnabled
      ? normalizeClusterApprovedMerges(approvedClusterMerges)
      : [];
    return solveEngine({
      input: request.input,
      maxIterations: request.maxIterations,
      convergenceThreshold: request.convergenceLimit,
      instrumentLibrary: profileCtx.effectiveInstrumentLibrary,
      excludeIds: excludeSet,
      overrides: overrideValues,
      geoidSourceData:
        effectiveParse.geoidSourceFormat !== 'builtin' ? (request.geoidSourceData ?? undefined) : undefined,
      parseOptions: {
        geometryDependentSigmaReference: effectiveParse.geometryDependentSigmaReference,
        runMode: effectiveParse.runMode,
        sourceFile: '<project-main>',
        includeFiles: request.projectIncludeFiles,
        units: request.units,
        coordMode: effectiveParse.coordMode,
        coordSystemMode: effectiveParse.coordSystemMode,
        crsId: effectiveParse.crsId,
        localDatumScheme: effectiveParse.localDatumScheme,
        averageScaleFactor: effectiveParse.averageScaleFactor,
        commonElevation: effectiveParse.commonElevation,
        averageGeoidHeight: effectiveParse.averageGeoidHeight,
        gnssVectorFrameDefault: effectiveParse.gnssVectorFrameDefault,
        gnssFrameConfirmed: effectiveParse.gnssFrameConfirmed,
        observationMode: {
          bearing: effectiveParse.gridBearingMode,
          distance: effectiveParse.gridDistanceMode,
          angle: effectiveParse.gridAngleMode,
          direction: effectiveParse.gridDirectionMode,
        },
        gridBearingMode: effectiveParse.gridBearingMode,
        gridDistanceMode: effectiveParse.gridDistanceMode,
        gridAngleMode: effectiveParse.gridAngleMode,
        gridDirectionMode: effectiveParse.gridDirectionMode,
        preanalysisMode: effectiveParse.runMode === 'preanalysis',
        order: effectiveParse.order,
        angleUnits: effectiveParse.angleUnits,
        angleStationOrder: effectiveParse.angleStationOrder,
        angleMode: effectiveParse.angleMode,
        deltaMode: effectiveParse.deltaMode,
        mapMode: effectiveParse.mapMode,
        mapScaleFactor: effectiveParse.mapScaleFactor,
        faceNormalizationMode: effectiveParse.faceNormalizationMode,
        normalize: effectiveParse.faceNormalizationMode !== 'off',
        directionFaceReliabilityFromCluster: profileCtx.allowClusterFaceReliability,
        applyCurvatureRefraction: effectiveParse.applyCurvatureRefraction,
        refractionCoefficient: effectiveParse.refractionCoefficient,
        verticalReduction: effectiveParse.verticalReduction,
        levelWeight: effectiveParse.levelWeight,
        levelLoopToleranceBaseMm: effectiveParse.levelLoopToleranceBaseMm,
        levelLoopTolerancePerSqrtKmMm: effectiveParse.levelLoopTolerancePerSqrtKmMm,
        crsTransformEnabled: effectiveParse.crsTransformEnabled,
        crsProjectionModel: effectiveParse.crsProjectionModel,
        crsLabel: effectiveParse.crsLabel,
        crsGridScaleEnabled: effectiveParse.crsGridScaleEnabled,
        crsGridScaleFactor: effectiveParse.crsGridScaleFactor,
        crsConvergenceEnabled: effectiveParse.crsConvergenceEnabled,
        crsConvergenceAngleRad: effectiveParse.crsConvergenceAngleRad,
        geoidModelEnabled: effectiveParse.geoidModelEnabled,
        geoidModelId: effectiveParse.geoidModelId,
        geoidSourceFormat: effectiveParse.geoidSourceFormat,
        geoidSourcePath: effectiveParse.geoidSourcePath,
        geoidInterpolation: effectiveParse.geoidInterpolation,
        geoidHeightConversionEnabled: effectiveParse.geoidHeightConversionEnabled,
        geoidOutputHeightDatum: effectiveParse.geoidOutputHeightDatum,
        gpsLoopCheckEnabled: effectiveParse.gpsLoopCheckEnabled,
        gpsAddHiHtEnabled: effectiveParse.gpsAddHiHtEnabled,
        gpsAddHiHtHiM: effectiveParse.gpsAddHiHtHiM,
        gpsAddHiHtHtM: effectiveParse.gpsAddHiHtHtM,
        qFixLinearSigmaM: effectiveParse.qFixLinearSigmaM,
        qFixAngularSigmaSec: effectiveParse.qFixAngularSigmaSec,
        descriptionReconcileMode: effectiveParse.descriptionReconcileMode,
        descriptionAppendDelimiter: effectiveParse.descriptionAppendDelimiter,
        lonSign: effectiveParse.lonSign,
        tsCorrelationEnabled: effectiveParse.tsCorrelationEnabled,
        tsCorrelationRho: effectiveParse.tsCorrelationRho,
        tsCorrelationScope: effectiveParse.tsCorrelationScope,
        robustMode: effectiveParse.robustMode,
        robustK: effectiveParse.robustK,
        parseCompatibilityMode: effectiveParse.parseCompatibilityMode,
        parseModeMigrated: effectiveParse.parseModeMigrated,
        autoAdjustEnabled: effectiveParse.autoAdjustEnabled,
        autoAdjustMaxCycles: effectiveParse.autoAdjustMaxCycles,
        autoAdjustMaxRemovalsPerCycle: effectiveParse.autoAdjustMaxRemovalsPerCycle,
        autoAdjustStdResThreshold: effectiveParse.autoAdjustStdResThreshold,
        autoSideshotEnabled: effectiveParse.autoSideshotEnabled,
        directionSetMode: profileCtx.directionSetMode,
        clusterDetectionEnabled: effectiveParse.clusterDetectionEnabled,
        clusterApprovedMerges: normalizedClusterMerges,
        currentInstrument: profileCtx.currentInstrument,
        preferExternalInstruments: true,
      },
    });
  };

  const buildSuspectImpactDiagnostics = (
    request: RunSessionRequest,
    base: AdjustmentResult,
    baseExclusions: Set<number>,
    overrideValues: Record<number, ObservationOverride>,
    approvedClusterMerges: ClusterApprovedMerge[],
  ): NonNullable<AdjustmentResult['suspectImpactDiagnostics']> => {
    const baseChiPass = base.chiSquare?.pass95;
    const baseMaxStd = maxAbsStdRes(base);
    const candidates = [...base.observations]
      .filter((obs) => Number.isFinite(obs.stdRes))
      .filter((obs) => hasLocalFailure(obs) || Math.abs(obs.stdRes ?? 0) >= 2)
      .sort((a, b) => {
        const aFail = hasLocalFailure(a) ? 1 : 0;
        const bFail = hasLocalFailure(b) ? 1 : 0;
        if (bFail !== aFail) return bFail - aFail;
        return Math.abs(b.stdRes ?? 0) - Math.abs(a.stdRes ?? 0);
      })
      .slice(0, IMPACT_MAX_CANDIDATES);

    const rows = candidates.map((obs) => {
      const baseLocalFail = hasLocalFailure(obs);
      const obsEntry: NonNullable<AdjustmentResult['suspectImpactDiagnostics']>[number] = {
        obsId: obs.id,
        type: obs.type,
        stations: observationStationsLabel(obs),
        sourceLine: obs.sourceLine,
        baseStdRes: obs.stdRes != null ? Math.abs(obs.stdRes) : undefined,
        baseLocalFail,
        chiDelta: '-',
        status: 'failed',
      };

      try {
        const nextExclusions = new Set(baseExclusions);
        nextExclusions.add(obs.id);
        const alt = solveCore(request, nextExclusions, undefined, overrideValues, approvedClusterMerges);
        const altMaxStd = maxAbsStdRes(alt);
        const altChiPass = alt.chiSquare?.pass95;
        let chiDelta: NonNullable<AdjustmentResult['suspectImpactDiagnostics']>[number]['chiDelta'] = '-';
        if (baseChiPass != null && altChiPass != null) {
          if (!baseChiPass && altChiPass) chiDelta = 'improved';
          else if (baseChiPass && !altChiPass) chiDelta = 'degraded';
          else chiDelta = 'unchanged';
        }

        const deltaSeuw = alt.seuw - base.seuw;
        const deltaMaxStdRes = altMaxStd - baseMaxStd;
        const maxCoordShift = maxUnknownCoordinateShift(base, alt);

        let score = 0;
        score += -deltaSeuw * 40;
        score += -deltaMaxStdRes * 20;
        if (chiDelta === 'improved') score += 20;
        if (chiDelta === 'degraded') score -= 20;
        score -= maxCoordShift * 15;

        return {
          ...obsEntry,
          deltaSeuw,
          deltaMaxStdRes,
          baseChiPass,
          altChiPass,
          chiDelta,
          maxCoordShift,
          score: Number.isFinite(score) ? score : undefined,
          status: 'ok' as const,
        };
      } catch {
        return obsEntry;
      }
    });
    rows.sort((a, b) => {
      if (a.status !== b.status) return a.status === 'ok' ? -1 : 1;
      const bScore = b.score ?? Number.NEGATIVE_INFINITY;
      const aScore = a.score ?? Number.NEGATIVE_INFINITY;
      if (bScore !== aScore) return bScore - aScore;
      const bStd = b.baseStdRes ?? 0;
      const aStd = a.baseStdRes ?? 0;
      return bStd - aStd;
    });
    return rows;
  };

  const buildPreanalysisImpactDiagnostics = (
    request: RunSessionRequest,
    base: AdjustmentResult,
    baseExclusions: Set<number>,
    overrideValues: Record<number, ObservationOverride>,
    approvedClusterMerges: ClusterApprovedMerge[],
  ): NonNullable<AdjustmentResult['preanalysisImpactDiagnostics']> => {
    const allPlannedRows = [...base.observations].filter(isPreanalysisWhatIfCandidate);
    const plannedRows = allPlannedRows
      .sort((a, b) => {
        const aActive = baseExclusions.has(a.id) ? 0 : 1;
        const bActive = baseExclusions.has(b.id) ? 0 : 1;
        if (bActive !== aActive) return bActive - aActive;
        return (
          (a.sourceLine ?? Number.MAX_SAFE_INTEGER) - (b.sourceLine ?? Number.MAX_SAFE_INTEGER)
        );
      })
      .slice(0, PREANALYSIS_IMPACT_MAX_CANDIDATES);

    const baseStationMajors = preanalysisStationMajors(base);
    const baseRelativeMetrics = preanalysisRelativeMetrics(base);
    const baseWorstStationMajor =
      baseStationMajors.length > 0 ? Math.max(...baseStationMajors) : undefined;
    const baseMedianStationMajor = medianOf(baseStationMajors);
    const baseWorstPairSigmaDist =
      baseRelativeMetrics.length > 0 ? Math.max(...baseRelativeMetrics) : undefined;
    const baseWeakStations = preanalysisWeakStationCount(base);
    const baseWeakPairs = preanalysisWeakPairCount(base);

    const rows: NonNullable<AdjustmentResult['preanalysisImpactDiagnostics']>['rows'] =
      plannedRows.map((obs) => {
        const plannedActive = !baseExclusions.has(obs.id);
        const action: 'add' | 'remove' = plannedActive ? 'remove' : 'add';
        const row: NonNullable<AdjustmentResult['preanalysisImpactDiagnostics']>['rows'][number] = {
          obsId: obs.id,
          type: obs.type,
          stations: observationStationsLabel(obs),
          sourceLine: obs.sourceLine,
          plannedActive,
          action,
          status: 'failed',
        };
        try {
          const altExclusions = new Set(baseExclusions);
          if (plannedActive) altExclusions.add(obs.id);
          else altExclusions.delete(obs.id);
          const alt = solveCore(request, altExclusions, undefined, overrideValues, approvedClusterMerges);
          const altStationMajors = preanalysisStationMajors(alt);
          const altRelativeMetrics = preanalysisRelativeMetrics(alt);
          const altWorstStationMajor =
            altStationMajors.length > 0 ? Math.max(...altStationMajors) : undefined;
          const altMedianStationMajor = medianOf(altStationMajors);
          const altWorstPairSigmaDist =
            altRelativeMetrics.length > 0 ? Math.max(...altRelativeMetrics) : undefined;
          const altWeakStations = preanalysisWeakStationCount(alt);
          const altWeakPairs = preanalysisWeakPairCount(alt);

          const deltaWorstStationMajor =
            altWorstStationMajor != null && baseWorstStationMajor != null
              ? altWorstStationMajor - baseWorstStationMajor
              : undefined;
          const deltaMedianStationMajor =
            altMedianStationMajor != null && baseMedianStationMajor != null
              ? altMedianStationMajor - baseMedianStationMajor
              : undefined;
          const deltaWorstPairSigmaDist =
            altWorstPairSigmaDist != null && baseWorstPairSigmaDist != null
              ? altWorstPairSigmaDist - baseWorstPairSigmaDist
              : undefined;
          const deltaWeakStationCount = altWeakStations - baseWeakStations;
          const deltaWeakPairCount = altWeakPairs - baseWeakPairs;
          const direction = action === 'remove' ? 1 : -1;
          const score =
            direction * (deltaWorstStationMajor ?? 0) * 40 +
            direction * (deltaMedianStationMajor ?? 0) * 20 +
            direction * (deltaWorstPairSigmaDist ?? 0) * 25 +
            direction * deltaWeakStationCount * 5 +
            direction * deltaWeakPairCount * 4;

          return {
            ...row,
            deltaWorstStationMajor,
            deltaMedianStationMajor,
            deltaWorstPairSigmaDist,
            deltaWeakStationCount,
            deltaWeakPairCount,
            score: Number.isFinite(score) ? score : undefined,
            status: 'ok',
          };
        } catch {
          return row;
        }
      });

    rows.sort((a, b) => {
      if (a.status !== b.status) return a.status === 'ok' ? -1 : 1;
      if (a.action !== b.action) return a.action === 'remove' ? -1 : 1;
      const bScore = b.score ?? Number.NEGATIVE_INFINITY;
      const aScore = a.score ?? Number.NEGATIVE_INFINITY;
      if (bScore !== aScore) return bScore - aScore;
      return (a.sourceLine ?? Number.MAX_SAFE_INTEGER) - (b.sourceLine ?? Number.MAX_SAFE_INTEGER);
    });

    return {
      enabled: true,
      activePlannedCount: allPlannedRows.filter((obs) => !baseExclusions.has(obs.id)).length,
      excludedPlannedCount: allPlannedRows.filter((obs) => baseExclusions.has(obs.id)).length,
      baseWorstStationMajor,
      baseMedianStationMajor,
      baseWorstPairSigmaDist,
      baseWeakStationCount: baseWeakStations,
      baseWeakPairCount: baseWeakPairs,
      rows,
    };
  };

  const solveWithImpacts = (
    request: RunSessionRequest,
    excludeSet: Set<number>,
    overrideValues: Record<number, ObservationOverride> = request.overrides,
    approvedClusterMerges: ClusterApprovedMerge[] = request.approvedClusterMerges,
  ): AdjustmentResult => {
    const solved = solveCore(request, excludeSet, undefined, overrideValues, approvedClusterMerges);
    const { resolveProfileContext } = createRunProfileBuilders({
      projectInstruments: request.projectInstruments,
      selectedInstrument: request.selectedInstrument,
      defaultIndustryInstrumentCode,
      defaultIndustryInstrument,
      normalizeSolveProfile,
    });
    const profileCtx = resolveProfileContext(request.parseSettings as ParseSettings);
    if (profileCtx.effectiveParse.runMode === 'preanalysis') {
      solved.suspectImpactDiagnostics = undefined;
      solved.preanalysisImpactDiagnostics = buildPreanalysisImpactDiagnostics(
        request,
        solved,
        excludeSet,
        overrideValues,
        approvedClusterMerges,
      );
      solved.robustComparison = {
        enabled: false,
        classicalTop: [],
        robustTop: [],
        overlapCount: 0,
      };
      return solved;
    }
    if (profileCtx.effectiveParse.runMode !== 'adjustment') {
      solved.suspectImpactDiagnostics = undefined;
      solved.preanalysisImpactDiagnostics = undefined;
      solved.robustComparison = {
        enabled: false,
        classicalTop: [],
        robustTop: [],
        overlapCount: 0,
      };
      return solved;
    }
    solved.suspectImpactDiagnostics = buildSuspectImpactDiagnostics(
      request,
      solved,
      excludeSet,
      overrideValues,
      approvedClusterMerges,
    );
    solved.preanalysisImpactDiagnostics = undefined;
    if (profileCtx.effectiveParse.robustMode !== 'none') {
      const classical = solveCore(
        request,
        excludeSet,
        { robustMode: 'none' },
        overrideValues,
        approvedClusterMerges,
      );
      const classicalTop = rankedSuspects(classical, 10);
      const robustTop = rankedSuspects(solved, 10);
      const robustIds = new Set(robustTop.map((row) => row.obsId));
      const overlapCount = classicalTop.reduce(
        (acc, row) => acc + (robustIds.has(row.obsId) ? 1 : 0),
        0,
      );
      solved.robustComparison = {
        enabled: true,
        classicalTop,
        robustTop,
        overlapCount,
      };
    } else {
      solved.robustComparison = {
        enabled: false,
        classicalTop: [],
        robustTop: [],
        overlapCount: 0,
      };
    }
    return solved;
  };

  return function runWithExclusionsDirect(request: RunSessionRequest): RunSessionOutcome {
    const startMs = Date.now();
    let effectiveExclusions = new Set(request.excludedIds);
    let effectiveOverrides = request.overrides;
    let effectiveClusterMerges = normalizeClusterApprovedMerges(request.approvedClusterMerges);
    let autoAdjustSummary: ReturnType<typeof runAutoAdjustCycles> | null = null;
    if (!request.parseSettings.clusterDetectionEnabled) {
      effectiveClusterMerges = [];
    }
    const inputChangedSinceLastRun =
      request.lastRunInput != null && request.input !== request.lastRunInput;
    const droppedExclusions = inputChangedSinceLastRun ? effectiveExclusions.size : 0;
    const droppedOverrides = inputChangedSinceLastRun ? Object.keys(effectiveOverrides).length : 0;
    const droppedClusterMerges = inputChangedSinceLastRun ? effectiveClusterMerges.length : 0;

    if (
      inputChangedSinceLastRun &&
      (droppedExclusions > 0 || droppedOverrides > 0 || droppedClusterMerges > 0)
    ) {
      effectiveExclusions = new Set();
      effectiveOverrides = {};
      effectiveClusterMerges = [];
    }

    const inlineAutoAdjust = extractAutoAdjustDirectiveFromInput(request.input);
    const uiRunMode: RunMode =
      request.parseSettings.runMode ??
      (request.parseSettings.preanalysisMode ? 'preanalysis' : 'adjustment');
    const autoAdjustConfig: AutoAdjustConfig = {
      enabled:
        uiRunMode === 'adjustment'
          ? (inlineAutoAdjust?.enabled ?? request.parseSettings.autoAdjustEnabled)
          : false,
      maxCycles: inlineAutoAdjust?.maxCycles ?? request.parseSettings.autoAdjustMaxCycles,
      maxRemovalsPerCycle:
        inlineAutoAdjust?.maxRemovalsPerCycle ??
        request.parseSettings.autoAdjustMaxRemovalsPerCycle,
      stdResThreshold:
        inlineAutoAdjust?.stdResThreshold ?? request.parseSettings.autoAdjustStdResThreshold,
      minRedundancy: AUTO_ADJUST_MIN_REDUNDANCY,
    };
    if (autoAdjustConfig.enabled) {
      autoAdjustSummary = runAutoAdjustCycles(effectiveExclusions, autoAdjustConfig, (trialExclusions) =>
        solveCore(request, trialExclusions, undefined, effectiveOverrides, effectiveClusterMerges),
      );
      effectiveExclusions = autoAdjustSummary.finalExcludedIds;
    }

    const solved = solveWithImpacts(
      request,
      effectiveExclusions,
      effectiveOverrides,
      effectiveClusterMerges,
    );
    if (autoAdjustSummary?.enabled) {
      solved.autoAdjustDiagnostics = {
        enabled: true,
        threshold: autoAdjustSummary.config.stdResThreshold,
        maxCycles: autoAdjustSummary.config.maxCycles,
        maxRemovalsPerCycle: autoAdjustSummary.config.maxRemovalsPerCycle,
        minRedundancy: autoAdjustSummary.config.minRedundancy ?? AUTO_ADJUST_MIN_REDUNDANCY,
        stopReason: autoAdjustSummary.stopReason,
        cycles: autoAdjustSummary.cycles.map((cycle) => ({
          cycle: cycle.cycle,
          seuw: cycle.seuw,
          maxAbsStdRes: cycle.maxAbsStdRes,
          removals: [...cycle.removals],
        })),
        removed: autoAdjustSummary.cycles.flatMap((cycle) => cycle.removals),
      };
      const autoLines = formatAutoAdjustLogLines(autoAdjustSummary);
      for (let i = autoLines.length - 1; i >= 0; i -= 1) {
        solved.logs.unshift(autoLines[i]);
      }
    }

    const elapsedMs = Date.now() - startMs;

    return {
      result: solved,
      effectiveExcludedIds: [...effectiveExclusions],
      effectiveClusterApprovedMerges: effectiveClusterMerges,
      droppedExclusions,
      droppedOverrides,
      droppedClusterMerges,
      inputChangedSinceLastRun,
      elapsedMs,
      profile: {
        totalElapsedMs: elapsedMs,
        solveInvocationCount: 1,
        stages: [{ id: 'main-solve', label: 'Direct pipeline', durationMs: elapsedMs, solveCount: 1 }],
      },
    };
  };
};
