import {
  buildPreanalysisSyntheticSetTemplates,
  buildSyntheticPreanalysisInput,
  resolveAppliedPreanalysisActionState,
} from './preanalysisPlanning';
import { createRunProfileBuilders } from './runProfileBuilders';
import { normalizeClusterApprovedMerges, solveEngine } from './solveEngine';
import type { ParseSettings, SolveProfile } from '../appStateTypes';
import type {
  AdjustmentResult,
  ClusterApprovedMerge,
  Instrument,
  ObservationOverride,
  ParseOptions,
} from '../types';
import type { RunSessionRequest } from './runSession';

interface CreateDirectSolveCoreArgs {
  defaultIndustryInstrumentCode: string;
  defaultIndustryInstrument: Instrument;
  normalizeSolveProfile: (_profile: SolveProfile) => SolveProfile;
}

type ProfileContext = ReturnType<
  ReturnType<typeof createRunProfileBuilders>['resolveProfileContext']
>;

const buildParseOptions = ({
  effectiveParse,
  profileCtx,
  request,
  syntheticAdditionIds,
  clusterApprovedMerges,
  includeProjectRunFiles,
}: {
  effectiveParse: ParseSettings;
  profileCtx: ProfileContext;
  request: RunSessionRequest;
  syntheticAdditionIds: string[];
  clusterApprovedMerges: ClusterApprovedMerge[];
  includeProjectRunFiles: boolean;
}): Partial<ParseOptions> => ({
  geometryDependentSigmaReference: effectiveParse.geometryDependentSigmaReference,
  runMode: effectiveParse.runMode,
  sourceFile: request.projectRunFiles?.[0]?.name ?? '<project-main>',
  includeFiles: request.projectIncludeFiles,
  projectRunFiles: includeProjectRunFiles
    ? request.projectRunFiles?.map((file) => ({ ...file }))
    : undefined,
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
  clusterApprovedMerges,
  currentInstrument: profileCtx.currentInstrument,
  preferExternalInstruments: true,
});

export const createDirectSolveCore = ({
  defaultIndustryInstrumentCode,
  defaultIndustryInstrument,
  normalizeSolveProfile,
}: CreateDirectSolveCoreArgs) => {
  let cachedPreanalysisTemplates:
    | ReturnType<typeof buildPreanalysisSyntheticSetTemplates>
    | null
    | undefined;

  return (
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
    const effectiveParse = {
      ...profileCtx.effectiveParse,
    };
    const normalizedClusterMerges = effectiveParseClusterMerges(
      effectiveParse,
      approvedClusterMerges,
    );

    if (effectiveParse.runMode === 'preanalysis' && cachedPreanalysisTemplates === undefined) {
      const templateSource = solveEngine({
        input: request.input,
        maxIterations: request.maxIterations,
        convergenceThreshold: request.convergenceLimit,
        instrumentLibrary: profileCtx.effectiveInstrumentLibrary,
        excludeIds: excludeSet,
        overrides: overrideValues,
        geoidSourceData: getGeoidSourceData(request, effectiveParse),
        parseOptions: {
          ...buildParseOptions({
            effectiveParse,
            profileCtx,
            request,
            syntheticAdditionIds: [],
            clusterApprovedMerges: normalizedClusterMerges,
            includeProjectRunFiles: true,
          }),
          autoAdjustEnabled: false,
        },
      });
      cachedPreanalysisTemplates = buildPreanalysisSyntheticSetTemplates(
        request.input,
        templateSource,
        request.planningMap,
        request.activePreanalysisAdditionIds,
      );
    }

    const normalizedSyntheticAdditionIds =
      effectiveParse.runMode === 'preanalysis'
        ? resolveAppliedPreanalysisActionState(
            cachedPreanalysisTemplates ?? [],
            syntheticAdditionIds,
          ).normalizedScenarioIds
        : syntheticAdditionIds;
    const solveInput =
      effectiveParse.runMode === 'preanalysis'
        ? buildSyntheticPreanalysisInput(
            request.input,
            normalizedSyntheticAdditionIds,
            cachedPreanalysisTemplates ?? [],
          )
        : request.input;

    const solved = solveEngine({
      input: solveInput,
      maxIterations: request.maxIterations,
      convergenceThreshold: request.convergenceLimit,
      instrumentLibrary: profileCtx.effectiveInstrumentLibrary,
      excludeIds: excludeSet,
      overrides: overrideValues,
      geoidSourceData: getGeoidSourceData(request, effectiveParse),
      parseOptions: buildParseOptions({
        effectiveParse,
        profileCtx,
        request,
        syntheticAdditionIds: normalizedSyntheticAdditionIds,
        clusterApprovedMerges: normalizedClusterMerges,
        includeProjectRunFiles: solveInput === request.input,
      }),
    });
    solved.preanalysisSyntheticAdditionIds = [...normalizedSyntheticAdditionIds];
    return solved;
  };
};

const effectiveParseClusterMerges = (
  effectiveParse: ParseSettings,
  approvedClusterMerges: ClusterApprovedMerge[],
): ClusterApprovedMerge[] =>
  effectiveParse.clusterDetectionEnabled
    ? normalizeClusterApprovedMerges(approvedClusterMerges)
    : [];

const getGeoidSourceData = (
  request: RunSessionRequest,
  effectiveParse: ParseSettings,
): ArrayBuffer | Uint8Array | undefined =>
  effectiveParse.geoidSourceFormat !== 'builtin'
    ? (request.geoidSourceData ?? undefined)
    : undefined;
