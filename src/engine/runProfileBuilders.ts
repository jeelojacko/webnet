import {
  DEFAULT_QFIX_ANGULAR_SIGMA_SEC,
  DEFAULT_QFIX_LINEAR_SIGMA_M,
} from './defaults';
import { DEFAULT_CANADA_CRS_ID } from './crsCatalog';
import type {
  ParseSettings,
  RunDiagnostics,
  SolveProfile,
} from '../appStateTypes';
import type {
  AdjustmentResult,
  DirectionSetMode,
  FaceNormalizationMode,
  Instrument,
  InstrumentLibrary,
  Observation,
  ParseCompatibilityMode,
  ParseOptions,
  RobustMode,
  RunMode,
} from '../types';

export interface ProfileContext {
  parity: boolean;
  effectiveParse: ParseSettings;
  directionSetMode: DirectionSetMode;
  allowClusterFaceReliability: boolean;
  effectiveInstrumentLibrary: InstrumentLibrary;
  currentInstrument?: string;
}

interface CreateRunProfileBuildersArgs {
  projectInstruments: InstrumentLibrary;
  selectedInstrument: string;
  defaultIndustryInstrumentCode: string;
  defaultIndustryInstrument: Instrument;
  normalizeSolveProfile: (_profile: SolveProfile) => SolveProfile;
}

export const createRunProfileBuilders = ({
  projectInstruments,
  selectedInstrument,
  defaultIndustryInstrumentCode,
  defaultIndustryInstrument,
  normalizeSolveProfile,
}: CreateRunProfileBuildersArgs) => {
  const resolveProfileContext = (base: ParseSettings): ProfileContext => {
    const solveProfile = normalizeSolveProfile(base.solveProfile);
    const parity = solveProfile !== 'webnet';
    const requestedRunMode: RunMode =
      base.runMode ?? (base.preanalysisMode ? 'preanalysis' : 'adjustment');
    const defaultParseCompatibilityMode: ParseCompatibilityMode =
      solveProfile === 'legacy-compat' ? 'legacy' : parity ? 'strict' : 'legacy';
    const defaultFaceNormalizationMode: FaceNormalizationMode =
      solveProfile === 'industry-parity-current'
        ? 'on'
        : solveProfile === 'industry-parity-legacy'
          ? 'off'
          : solveProfile === 'legacy-compat'
            ? 'auto'
            : (base.faceNormalizationMode ?? (base.normalize ? 'on' : 'off'));
    const normalizedBase: ParseSettings = {
      ...base,
      solveProfile,
      runMode: requestedRunMode,
      preanalysisMode: requestedRunMode === 'preanalysis',
      parseCompatibilityMode: base.parseCompatibilityMode ?? defaultParseCompatibilityMode,
      faceNormalizationMode: base.faceNormalizationMode ?? defaultFaceNormalizationMode,
    };
    normalizedBase.normalize = normalizedBase.faceNormalizationMode !== 'off';
    const parityParse = parity
      ? {
          ...normalizedBase,
          geometryDependentSigmaReference: 'initial' as const,
          robustMode: 'none' as RobustMode,
          tsCorrelationEnabled: false,
          tsCorrelationRho: 0,
        }
      : {
          ...normalizedBase,
          geometryDependentSigmaReference:
            normalizedBase.geometryDependentSigmaReference ?? 'current',
        };
    const effectiveParse =
      requestedRunMode === 'preanalysis'
        ? {
            ...parityParse,
            robustMode: 'none' as RobustMode,
            autoAdjustEnabled: false,
            preanalysisMode: true,
          }
        : {
            ...parityParse,
            preanalysisMode: false,
          };
    const directionSetMode: DirectionSetMode = parity ? 'raw' : 'reduced';
    const allowClusterFaceReliability = solveProfile === 'legacy-compat';
    const effectiveInstrumentLibrary = parity
      ? {
          ...projectInstruments,
          ...(projectInstruments[defaultIndustryInstrumentCode]
            ? {}
            : { [defaultIndustryInstrumentCode]: defaultIndustryInstrument }),
        }
      : projectInstruments;
    const currentInstrument = parity
      ? selectedInstrument && effectiveInstrumentLibrary[selectedInstrument]
        ? selectedInstrument
        : defaultIndustryInstrumentCode
      : selectedInstrument || undefined;
    return {
      parity,
      effectiveParse,
      directionSetMode,
      allowClusterFaceReliability,
      effectiveInstrumentLibrary,
      currentInstrument,
    };
  };

  const buildRunDiagnostics = (base: ParseSettings, solved?: AdjustmentResult): RunDiagnostics => {
    const profileCtx = resolveProfileContext(base);
    const parseState = (solved?.parseState ?? profileCtx.effectiveParse) as ParseOptions;
    const parse = {
      runMode:
        parseState.runMode ??
        profileCtx.effectiveParse.runMode ??
        (profileCtx.effectiveParse.preanalysisMode ? 'preanalysis' : 'adjustment'),
      coordSystemMode:
        parseState.coordSystemMode ?? profileCtx.effectiveParse.coordSystemMode ?? 'local',
      crsId: parseState.crsId ?? profileCtx.effectiveParse.crsId ?? DEFAULT_CANADA_CRS_ID,
      localDatumScheme:
        parseState.localDatumScheme ??
        profileCtx.effectiveParse.localDatumScheme ??
        'average-scale',
      averageScaleFactor:
        parseState.averageScaleFactor ?? profileCtx.effectiveParse.averageScaleFactor ?? 1,
      scaleOverrideActive: parseState.scaleOverrideActive ?? false,
      commonElevation: parseState.commonElevation ?? profileCtx.effectiveParse.commonElevation ?? 0,
      averageGeoidHeight:
        parseState.averageGeoidHeight ?? profileCtx.effectiveParse.averageGeoidHeight ?? 0,
      gnssVectorFrameDefault:
        parseState.gnssVectorFrameDefault ??
        profileCtx.effectiveParse.gnssVectorFrameDefault ??
        'gridNEU',
      gnssFrameConfirmed:
        parseState.gnssFrameConfirmed ?? profileCtx.effectiveParse.gnssFrameConfirmed ?? false,
      verticalDeflectionNorthSec:
        parseState.verticalDeflectionNorthSec ??
        profileCtx.effectiveParse.verticalDeflectionNorthSec ??
        0,
      verticalDeflectionEastSec:
        parseState.verticalDeflectionEastSec ??
        profileCtx.effectiveParse.verticalDeflectionEastSec ??
        0,
      observationMode: parseState.observationMode ??
        profileCtx.effectiveParse.observationMode ?? {
          bearing:
            parseState.gridBearingMode ?? profileCtx.effectiveParse.gridBearingMode ?? 'grid',
          distance:
            parseState.gridDistanceMode ?? profileCtx.effectiveParse.gridDistanceMode ?? 'measured',
          angle: parseState.gridAngleMode ?? profileCtx.effectiveParse.gridAngleMode ?? 'measured',
          direction:
            parseState.gridDirectionMode ??
            profileCtx.effectiveParse.gridDirectionMode ??
            'measured',
        },
      gridBearingMode:
        parseState.gridBearingMode ?? profileCtx.effectiveParse.gridBearingMode ?? 'grid',
      gridDistanceMode:
        parseState.gridDistanceMode ?? profileCtx.effectiveParse.gridDistanceMode ?? 'measured',
      gridAngleMode:
        parseState.gridAngleMode ?? profileCtx.effectiveParse.gridAngleMode ?? 'measured',
      gridDirectionMode:
        parseState.gridDirectionMode ?? profileCtx.effectiveParse.gridDirectionMode ?? 'measured',
      mapMode: parseState.mapMode ?? profileCtx.effectiveParse.mapMode,
      mapScaleFactor: parseState.mapScaleFactor ?? profileCtx.effectiveParse.mapScaleFactor ?? 1,
      faceNormalizationMode:
        parseState.faceNormalizationMode ??
        profileCtx.effectiveParse.faceNormalizationMode ??
        ((parseState.normalize ?? profileCtx.effectiveParse.normalize) ? 'on' : 'off'),
      normalize:
        (parseState.faceNormalizationMode ??
          profileCtx.effectiveParse.faceNormalizationMode ??
          ((parseState.normalize ?? profileCtx.effectiveParse.normalize) ? 'on' : 'off')) !== 'off',
      angleMode: parseState.angleMode ?? profileCtx.effectiveParse.angleMode,
      verticalReduction:
        parseState.verticalReduction ?? profileCtx.effectiveParse.verticalReduction,
      applyCurvatureRefraction:
        parseState.applyCurvatureRefraction ?? profileCtx.effectiveParse.applyCurvatureRefraction,
      refractionCoefficient:
        parseState.refractionCoefficient ?? profileCtx.effectiveParse.refractionCoefficient,
      tsCorrelationEnabled:
        parseState.tsCorrelationEnabled ?? profileCtx.effectiveParse.tsCorrelationEnabled,
      tsCorrelationScope:
        parseState.tsCorrelationScope ?? profileCtx.effectiveParse.tsCorrelationScope,
      tsCorrelationRho: parseState.tsCorrelationRho ?? profileCtx.effectiveParse.tsCorrelationRho,
      robustMode: parseState.robustMode ?? profileCtx.effectiveParse.robustMode,
      robustK: parseState.robustK ?? profileCtx.effectiveParse.robustK,
      parseCompatibilityMode:
        parseState.parseCompatibilityMode ??
        profileCtx.effectiveParse.parseCompatibilityMode ??
        (profileCtx.parity ? 'strict' : 'legacy'),
      parseModeMigrated:
        parseState.parseModeMigrated ?? profileCtx.effectiveParse.parseModeMigrated ?? false,
      parseCompatibilityDiagnostics: parseState.parseCompatibilityDiagnostics ?? [],
      ambiguousCount: parseState.ambiguousCount ?? 0,
      legacyFallbackCount: parseState.legacyFallbackCount ?? 0,
      strictRejectCount: parseState.strictRejectCount ?? 0,
      rewriteSuggestionCount: parseState.rewriteSuggestionCount ?? 0,
      qFixLinearSigmaM: parseState.qFixLinearSigmaM ?? profileCtx.effectiveParse.qFixLinearSigmaM,
      qFixAngularSigmaSec:
        parseState.qFixAngularSigmaSec ?? profileCtx.effectiveParse.qFixAngularSigmaSec,
      prismEnabled: parseState.prismEnabled ?? profileCtx.effectiveParse.prismEnabled ?? false,
      prismOffset: parseState.prismOffset ?? profileCtx.effectiveParse.prismOffset ?? 0,
      prismScope: parseState.prismScope ?? profileCtx.effectiveParse.prismScope ?? 'global',
      rotationAngleRad: parseState.rotationAngleRad ?? 0,
      crsTransformEnabled:
        parseState.crsTransformEnabled ?? profileCtx.effectiveParse.crsTransformEnabled ?? false,
      crsProjectionModel:
        parseState.crsProjectionModel ??
        profileCtx.effectiveParse.crsProjectionModel ??
        'legacy-equirectangular',
      crsLabel: parseState.crsLabel ?? profileCtx.effectiveParse.crsLabel ?? '',
      crsGridScaleEnabled:
        parseState.crsGridScaleEnabled ?? profileCtx.effectiveParse.crsGridScaleEnabled ?? false,
      crsGridScaleFactor:
        parseState.crsGridScaleFactor ?? profileCtx.effectiveParse.crsGridScaleFactor ?? 1,
      crsConvergenceEnabled:
        parseState.crsConvergenceEnabled ??
        profileCtx.effectiveParse.crsConvergenceEnabled ??
        false,
      crsConvergenceAngleRad:
        parseState.crsConvergenceAngleRad ?? profileCtx.effectiveParse.crsConvergenceAngleRad ?? 0,
      geoidModelEnabled:
        parseState.geoidModelEnabled ?? profileCtx.effectiveParse.geoidModelEnabled ?? false,
      geoidModelId: parseState.geoidModelId ?? profileCtx.effectiveParse.geoidModelId ?? 'NGS-DEMO',
      geoidSourceFormat:
        parseState.geoidSourceFormat ?? profileCtx.effectiveParse.geoidSourceFormat ?? 'builtin',
      geoidSourcePath:
        parseState.geoidSourcePath ?? profileCtx.effectiveParse.geoidSourcePath ?? '',
      geoidSourceResolvedFormat:
        parseState.geoidSourceResolvedFormat ??
        parseState.geoidSourceFormat ??
        profileCtx.effectiveParse.geoidSourceFormat ??
        'builtin',
      geoidSourceFallbackUsed: parseState.geoidSourceFallbackUsed ?? false,
      geoidInterpolation:
        parseState.geoidInterpolation ?? profileCtx.effectiveParse.geoidInterpolation ?? 'bilinear',
      geoidHeightConversionEnabled:
        parseState.geoidHeightConversionEnabled ??
        profileCtx.effectiveParse.geoidHeightConversionEnabled ??
        false,
      geoidOutputHeightDatum:
        parseState.geoidOutputHeightDatum ??
        profileCtx.effectiveParse.geoidOutputHeightDatum ??
        'orthometric',
      gpsLoopCheckEnabled:
        parseState.gpsLoopCheckEnabled ?? profileCtx.effectiveParse.gpsLoopCheckEnabled ?? false,
      levelLoopToleranceBaseMm:
        parseState.levelLoopToleranceBaseMm ??
        profileCtx.effectiveParse.levelLoopToleranceBaseMm ??
        0,
      levelLoopTolerancePerSqrtKmMm:
        parseState.levelLoopTolerancePerSqrtKmMm ??
        profileCtx.effectiveParse.levelLoopTolerancePerSqrtKmMm ??
        4,
      gpsAddHiHtEnabled:
        parseState.gpsAddHiHtEnabled ?? profileCtx.effectiveParse.gpsAddHiHtEnabled ?? false,
      gpsAddHiHtHiM: parseState.gpsAddHiHtHiM ?? profileCtx.effectiveParse.gpsAddHiHtHiM ?? 0,
      gpsAddHiHtHtM: parseState.gpsAddHiHtHtM ?? profileCtx.effectiveParse.gpsAddHiHtHtM ?? 0,
      gpsAddHiHtVectorCount: parseState.gpsAddHiHtVectorCount ?? 0,
      gpsAddHiHtAppliedCount: parseState.gpsAddHiHtAppliedCount ?? 0,
      gpsAddHiHtPositiveCount: parseState.gpsAddHiHtPositiveCount ?? 0,
      gpsAddHiHtNegativeCount: parseState.gpsAddHiHtNegativeCount ?? 0,
      gpsAddHiHtNeutralCount: parseState.gpsAddHiHtNeutralCount ?? 0,
      gpsAddHiHtDefaultZeroCount: parseState.gpsAddHiHtDefaultZeroCount ?? 0,
      gpsAddHiHtMissingHeightCount: parseState.gpsAddHiHtMissingHeightCount ?? 0,
      gpsAddHiHtScaleMin: parseState.gpsAddHiHtScaleMin ?? 1,
      gpsAddHiHtScaleMax: parseState.gpsAddHiHtScaleMax ?? 1,
      geoidModelLoaded: parseState.geoidModelLoaded ?? false,
      geoidModelMetadata: parseState.geoidModelMetadata ?? '',
      geoidSampleUndulationM: parseState.geoidSampleUndulationM,
      geoidConvertedStationCount: parseState.geoidConvertedStationCount ?? 0,
      geoidSkippedStationCount: parseState.geoidSkippedStationCount ?? 0,
      coordSystemDiagnostics: parseState.coordSystemDiagnostics ?? [],
      coordSystemWarningMessages: parseState.coordSystemWarningMessages ?? [],
      crsStatus: parseState.crsStatus ?? (parseState.crsTransformEnabled ? 'on' : 'off'),
      crsOffReason: parseState.crsOffReason,
      datumSufficiencyReport: parseState.datumSufficiencyReport,
      parsedUsageSummary: parseState.parsedUsageSummary,
      usedInSolveUsageSummary: parseState.usedInSolveUsageSummary,
      directiveTransitions: parseState.directiveTransitions ?? [],
      directiveNoEffectWarnings: parseState.directiveNoEffectWarnings ?? [],
      crsDatumOpId: parseState.crsDatumOpId,
      crsDatumFallbackUsed: parseState.crsDatumFallbackUsed ?? false,
      crsAreaOfUseStatus: parseState.crsAreaOfUseStatus ?? 'unknown',
      crsOutOfAreaStationCount: parseState.crsOutOfAreaStationCount ?? 0,
      edmMode: parseState.edmMode ?? 'additive',
      applyCentering: parseState.applyCentering ?? true,
      addCenteringToExplicit: parseState.addCenteringToExplicit ?? false,
      currentInstrument: parseState.currentInstrument ?? profileCtx.currentInstrument ?? '',
    };
    const defaultObs = (solved?.observations ?? []).filter((o) => o.sigmaSource === 'default');
    const byType = new Map<Observation['type'], number>();
    defaultObs.forEach((obs) => {
      byType.set(obs.type, (byType.get(obs.type) ?? 0) + 1);
    });
    const typeOrder: Observation['type'][] = [
      'dist',
      'angle',
      'direction',
      'dir',
      'bearing',
      'zenith',
      'lev',
      'gps',
    ];
    const defaultSigmaByType = typeOrder
      .filter((type) => (byType.get(type) ?? 0) > 0)
      .map((type) => `${type}=${byType.get(type)}`)
      .join(', ');
    const activeDefaultInst = profileCtx.currentInstrument
      ? profileCtx.effectiveInstrumentLibrary[profileCtx.currentInstrument]
      : undefined;
    const stochasticDefaultsSummary = activeDefaultInst
      ? `inst=${activeDefaultInst.code} dist=${activeDefaultInst.edm_const.toFixed(4)}m+${activeDefaultInst.edm_ppm.toFixed(3)}ppm hz=${activeDefaultInst.hzPrecision_sec.toFixed(3)}" va=${activeDefaultInst.vaPrecision_sec.toFixed(3)}" centering=${activeDefaultInst.instCentr_m.toFixed(5)}/${activeDefaultInst.tgtCentr_m.toFixed(5)}m edm=${parse.edmMode} centerInflation=${parse.applyCentering ? `ON(explicit=${parse.addCenteringToExplicit ? 'ON' : 'OFF'})` : 'OFF'}`
      : `inst=none dist=0+0ppm hz=0" va=0" centering=0/0m edm=${parse.edmMode} centerInflation=${parse.applyCentering ? `ON(explicit=${parse.addCenteringToExplicit ? 'ON' : 'OFF'})` : 'OFF'}`;
    return {
      solveProfile: normalizeSolveProfile(base.solveProfile),
      parity: profileCtx.parity,
      runMode: parse.runMode,
      preanalysisMode: parse.runMode === 'preanalysis',
      plannedObservationCount: parseState.plannedObservationCount ?? 0,
      autoSideshotEnabled: parseState.autoSideshotEnabled ?? base.autoSideshotEnabled,
      autoAdjustEnabled: parseState.autoAdjustEnabled ?? base.autoAdjustEnabled,
      autoAdjustMaxCycles: parseState.autoAdjustMaxCycles ?? base.autoAdjustMaxCycles,
      autoAdjustMaxRemovalsPerCycle:
        parseState.autoAdjustMaxRemovalsPerCycle ?? base.autoAdjustMaxRemovalsPerCycle,
      autoAdjustStdResThreshold:
        parseState.autoAdjustStdResThreshold ?? base.autoAdjustStdResThreshold,
      suspectImpactMode: parseState.suspectImpactMode ?? base.suspectImpactMode,
      directionSetMode: profileCtx.directionSetMode,
      mapMode: parse.mapMode,
      mapScaleFactor: parse.mapScaleFactor ?? 1,
      normalize: parse.normalize,
      faceNormalizationMode: parse.faceNormalizationMode,
      angleMode: parse.angleMode,
      verticalReduction: parse.verticalReduction,
      applyCurvatureRefraction: parse.applyCurvatureRefraction,
      refractionCoefficient: parse.refractionCoefficient,
      tsCorrelationEnabled: parse.tsCorrelationEnabled,
      tsCorrelationScope: parse.tsCorrelationScope,
      tsCorrelationRho: parse.tsCorrelationRho,
      robustMode: parse.robustMode,
      robustK: parse.robustK,
      parseCompatibilityMode: parse.parseCompatibilityMode,
      parseModeMigrated: parse.parseModeMigrated,
      parseCompatibilityDiagnostics: parse.parseCompatibilityDiagnostics,
      ambiguousCount: parse.ambiguousCount,
      legacyFallbackCount: parse.legacyFallbackCount,
      strictRejectCount: parse.strictRejectCount,
      rewriteSuggestionCount: parse.rewriteSuggestionCount,
      qFixLinearSigmaM: parse.qFixLinearSigmaM ?? DEFAULT_QFIX_LINEAR_SIGMA_M,
      qFixAngularSigmaSec: parse.qFixAngularSigmaSec ?? DEFAULT_QFIX_ANGULAR_SIGMA_SEC,
      coordSystemMode: parse.coordSystemMode,
      crsId: parse.crsId,
      localDatumScheme: parse.localDatumScheme,
      averageScaleFactor: parse.averageScaleFactor,
      scaleOverrideActive: parse.scaleOverrideActive ?? false,
      commonElevation: parse.commonElevation,
      averageGeoidHeight: parse.averageGeoidHeight,
      gnssVectorFrameDefault: parse.gnssVectorFrameDefault ?? 'gridNEU',
      gnssFrameConfirmed: parse.gnssFrameConfirmed ?? false,
      verticalDeflectionNorthSec: parse.verticalDeflectionNorthSec ?? 0,
      verticalDeflectionEastSec: parse.verticalDeflectionEastSec ?? 0,
      observationMode: parse.observationMode,
      gridBearingMode: parse.gridBearingMode,
      gridDistanceMode: parse.gridDistanceMode,
      gridAngleMode: parse.gridAngleMode,
      gridDirectionMode: parse.gridDirectionMode,
      datumSufficiencyReport: parse.datumSufficiencyReport,
      coordSystemDiagnostics: parse.coordSystemDiagnostics ?? [],
      coordSystemWarningMessages: parse.coordSystemWarningMessages ?? [],
      crsStatus: parse.crsStatus ?? (parse.crsTransformEnabled ? 'on' : 'off'),
      crsOffReason: parse.crsOffReason,
      crsDatumOpId: parse.crsDatumOpId,
      crsDatumFallbackUsed: parse.crsDatumFallbackUsed ?? false,
      crsAreaOfUseStatus: parse.crsAreaOfUseStatus ?? 'unknown',
      crsOutOfAreaStationCount: parse.crsOutOfAreaStationCount ?? 0,
      parsedUsageSummary: parse.parsedUsageSummary,
      usedInSolveUsageSummary: parse.usedInSolveUsageSummary,
      directiveTransitions: parse.directiveTransitions ?? [],
      directiveNoEffectWarnings: parse.directiveNoEffectWarnings ?? [],
      crsTransformEnabled: parse.crsTransformEnabled,
      crsProjectionModel: parse.crsProjectionModel,
      crsLabel: parse.crsLabel,
      crsGridScaleEnabled: parse.crsGridScaleEnabled,
      crsGridScaleFactor: parse.crsGridScaleFactor,
      crsConvergenceEnabled: parse.crsConvergenceEnabled,
      crsConvergenceAngleRad: parse.crsConvergenceAngleRad,
      geoidModelEnabled: parse.geoidModelEnabled,
      geoidModelId: parse.geoidModelId,
      geoidSourceFormat: parse.geoidSourceFormat,
      geoidSourcePath: parse.geoidSourcePath,
      geoidSourceResolvedFormat: parse.geoidSourceResolvedFormat,
      geoidSourceFallbackUsed: parse.geoidSourceFallbackUsed,
      geoidInterpolation: parse.geoidInterpolation,
      geoidHeightConversionEnabled: parse.geoidHeightConversionEnabled,
      geoidOutputHeightDatum: parse.geoidOutputHeightDatum,
      gpsLoopCheckEnabled: parse.gpsLoopCheckEnabled,
      levelLoopToleranceBaseMm: parse.levelLoopToleranceBaseMm,
      levelLoopTolerancePerSqrtKmMm: parse.levelLoopTolerancePerSqrtKmMm,
      gpsAddHiHtEnabled: parse.gpsAddHiHtEnabled,
      gpsAddHiHtHiM: parse.gpsAddHiHtHiM,
      gpsAddHiHtHtM: parse.gpsAddHiHtHtM,
      gpsAddHiHtVectorCount: parse.gpsAddHiHtVectorCount,
      gpsAddHiHtAppliedCount: parse.gpsAddHiHtAppliedCount,
      gpsAddHiHtPositiveCount: parse.gpsAddHiHtPositiveCount,
      gpsAddHiHtNegativeCount: parse.gpsAddHiHtNegativeCount,
      gpsAddHiHtNeutralCount: parse.gpsAddHiHtNeutralCount,
      gpsAddHiHtDefaultZeroCount: parse.gpsAddHiHtDefaultZeroCount,
      gpsAddHiHtMissingHeightCount: parse.gpsAddHiHtMissingHeightCount,
      gpsAddHiHtScaleMin: parse.gpsAddHiHtScaleMin,
      gpsAddHiHtScaleMax: parse.gpsAddHiHtScaleMax,
      geoidModelLoaded: parse.geoidModelLoaded,
      geoidModelMetadata: parse.geoidModelMetadata,
      geoidSampleUndulationM: parse.geoidSampleUndulationM,
      geoidConvertedStationCount: parse.geoidConvertedStationCount,
      geoidSkippedStationCount: parse.geoidSkippedStationCount,
      prismEnabled: parse.prismEnabled,
      prismOffset: parse.prismOffset,
      prismScope: parse.prismScope,
      rotationAngleRad: parse.rotationAngleRad,
      profileDefaultInstrumentFallback: profileCtx.parity,
      currentInstrumentCode: activeDefaultInst?.code ?? '',
      currentInstrumentDesc: activeDefaultInst?.desc ?? '',
      currentInstrumentLevStdMmPerKm: activeDefaultInst?.levStd_mmPerKm ?? 0,
      projectInstrumentLibrary: projectInstruments,
      angleCenteringModel: 'geometry-aware-correlated-rays',
      defaultSigmaCount: defaultObs.length,
      defaultSigmaByType,
      stochasticDefaultsSummary,
    };
  };

  return {
    resolveProfileContext,
    buildRunDiagnostics,
  };
};
