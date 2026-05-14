import {
  extractAutoAdjustDirectiveFromInput,
  formatAutoAdjustLogLines,
  runAutoAdjustCycles,
  type AutoAdjustConfig,
} from './autoAdjust';
import {
  buildPreanalysisPlanningDiagnostics,
  buildPreanalysisSyntheticSetTemplates,
  buildSyntheticPreanalysisInput,
} from './preanalysisPlanning';
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

const IMPACT_MAX_CANDIDATES = 3;
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
    normalizeSolveProfile: (_profile: SolveProfile) => SolveProfile;
}

export const createDirectRunPipeline = ({
  defaultIndustryInstrumentCode,
  defaultIndustryInstrument,
  normalizeSolveProfile,
}: CreateDirectRunPipelineArgs) => {
  let cachedPreanalysisTemplates:
    | ReturnType<typeof buildPreanalysisSyntheticSetTemplates>
    | null
    | undefined;

  const solveCore = (
    request: RunSessionRequest,
    excludeSet: Set<number>,
    parseOverride?: Partial<ParseSettings>,
    overrideValues: Record<number, ObservationOverride> = request.overrides,
    approvedClusterMerges: ClusterApprovedMerge[] = request.approvedClusterMerges,
    syntheticAdditionIds: string[] = request.activePreanalysisAdditionIds,
  ): AdjustmentResult => {
    const mergedParse = { ...request.parseSettings, ...parseOverride, autoAdjustEnabled: false };
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
    if (effectiveParse.runMode === 'preanalysis' && cachedPreanalysisTemplates === undefined) {
      const templateSource = solveEngine({
        input: request.input,
        maxIterations: request.maxIterations,
        convergenceThreshold: request.convergenceLimit,
        instrumentLibrary: profileCtx.effectiveInstrumentLibrary,
        excludeIds: excludeSet,
        overrides: overrideValues,
        geoidSourceData:
          effectiveParse.geoidSourceFormat !== 'builtin'
            ? (request.geoidSourceData ?? undefined)
            : undefined,
        parseOptions: {
          geometryDependentSigmaReference: effectiveParse.geometryDependentSigmaReference,
          runMode: effectiveParse.runMode,
          sourceFile: request.projectRunFiles?.[0]?.name ?? '<project-main>',
          includeFiles: request.projectIncludeFiles,
          projectRunFiles: request.projectRunFiles?.map((file) => ({ ...file })),
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
          verticalDeflectionNorthSec: effectiveParse.verticalDeflectionNorthSec,
          verticalDeflectionEastSec: effectiveParse.verticalDeflectionEastSec,
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
          preanalysisAccuracyThresholdMeters: effectiveParse.preanalysisAccuracyThresholdMeters,
          preanalysisMaxAddedSets: effectiveParse.preanalysisMaxAddedSets,
          preanalysisSyntheticAdditionIds: [],
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
          positionalToleranceEnabled: effectiveParse.positionalToleranceEnabled,
          positionalToleranceConstantMm: effectiveParse.positionalToleranceConstantMm,
          positionalTolerancePpm: effectiveParse.positionalTolerancePpm,
          positionalToleranceConfidencePercent: effectiveParse.positionalToleranceConfidencePercent,
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
          autoAdjustEnabled: false,
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
      cachedPreanalysisTemplates = buildPreanalysisSyntheticSetTemplates(
        request.input,
        templateSource,
        request.planningMap,
      );
    }
    const solveInput =
      effectiveParse.runMode === 'preanalysis'
        ? buildSyntheticPreanalysisInput(
            request.input,
            syntheticAdditionIds,
            cachedPreanalysisTemplates ?? [],
          )
        : request.input;
    return solveEngine({
      input: solveInput,
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
        sourceFile: request.projectRunFiles?.[0]?.name ?? '<project-main>',
        includeFiles: request.projectIncludeFiles,
        projectRunFiles:
          solveInput !== request.input
            ? undefined
            : request.projectRunFiles?.map((file) => ({ ...file })),
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
        verticalDeflectionNorthSec: effectiveParse.verticalDeflectionNorthSec,
        verticalDeflectionEastSec: effectiveParse.verticalDeflectionEastSec,
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
        preanalysisAccuracyThresholdMeters: effectiveParse.preanalysisAccuracyThresholdMeters,
        preanalysisMaxAddedSets: effectiveParse.preanalysisMaxAddedSets,
        preanalysisSyntheticAdditionIds: syntheticAdditionIds,
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
        positionalToleranceEnabled: effectiveParse.positionalToleranceEnabled,
        positionalToleranceConstantMm: effectiveParse.positionalToleranceConstantMm,
        positionalTolerancePpm: effectiveParse.positionalTolerancePpm,
        positionalToleranceConfidencePercent: effectiveParse.positionalToleranceConfidencePercent,
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
      solved.preanalysisImpactDiagnostics = buildPreanalysisPlanningDiagnostics({
        base: solved,
        input: request.input,
        planningMap: request.planningMap,
        activeTemplateIds: request.activePreanalysisAdditionIds,
        targetThresholdMeters: profileCtx.effectiveParse.preanalysisAccuracyThresholdMeters,
        maxAddedSets: profileCtx.effectiveParse.preanalysisMaxAddedSets ?? 5,
        solveScenario: (nextTemplateIds) =>
          solveCore(
            request,
            excludeSet,
            undefined,
            overrideValues,
            approvedClusterMerges,
            nextTemplateIds,
          ),
      });
      solved.preanalysisSyntheticAdditionIds = [...request.activePreanalysisAdditionIds];
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
    let activePreanalysisAdditionIds = [...request.activePreanalysisAdditionIds];
    let effectiveOverrides = request.overrides;
    let effectiveClusterMerges = normalizeClusterApprovedMerges(request.approvedClusterMerges);
    let autoAdjustSummary: ReturnType<typeof runAutoAdjustCycles> | null = null;
    if (!request.parseSettings.clusterDetectionEnabled) {
      effectiveClusterMerges = [];
    }
    const inputChangedSinceLastRun =
      request.lastRunInput != null && request.input !== request.lastRunInput;
    const droppedExclusions = inputChangedSinceLastRun ? effectiveExclusions.size : 0;
    const droppedPreanalysisAdditions = inputChangedSinceLastRun
      ? activePreanalysisAdditionIds.length
      : 0;
    const droppedOverrides = inputChangedSinceLastRun ? Object.keys(effectiveOverrides).length : 0;
    const droppedClusterMerges = inputChangedSinceLastRun ? effectiveClusterMerges.length : 0;

    if (
      inputChangedSinceLastRun &&
      (droppedExclusions > 0 ||
        droppedPreanalysisAdditions > 0 ||
        droppedOverrides > 0 ||
        droppedClusterMerges > 0)
    ) {
      effectiveExclusions = new Set();
      activePreanalysisAdditionIds = [];
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
      { ...request, activePreanalysisAdditionIds },
      effectiveExclusions,
      effectiveOverrides,
      effectiveClusterMerges,
    );
    if (autoAdjustSummary?.enabled) {
      if (solved.parseState) {
        solved.parseState.autoAdjustEnabled = autoAdjustConfig.enabled;
        solved.parseState.autoAdjustMaxCycles = autoAdjustSummary.config.maxCycles;
        solved.parseState.autoAdjustMaxRemovalsPerCycle =
          autoAdjustSummary.config.maxRemovalsPerCycle;
        solved.parseState.autoAdjustStdResThreshold = autoAdjustSummary.config.stdResThreshold;
      }
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
      activePreanalysisAdditionIds: [...activePreanalysisAdditionIds],
      effectiveClusterApprovedMerges: effectiveClusterMerges,
      droppedExclusions,
      droppedPreanalysisAdditions,
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
