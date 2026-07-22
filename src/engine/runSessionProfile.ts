import {
  DEFAULT_QFIX_ANGULAR_SIGMA_SEC,
  DEFAULT_QFIX_LINEAR_SIGMA_M,
  DEFAULT_S9_INSTRUMENT_CENTERING_HORIZ_M,
} from './defaults';
import type {
  RunSessionParseSettings,
  RunSessionRequest,
  SolveProfile,
} from './runSessionTypes';
import type {
  ClusterApprovedMerge,
  FaceNormalizationMode,
  Instrument,
  InstrumentLibrary,
  ParseCompatibilityMode,
  ParseOptions,
  RobustMode,
  RunMode,
} from '../types';

const INDUSTRY_DEFAULT_INSTRUMENT_CODE = 'S9';

const createInstrument = (code: string, desc = ''): Instrument => ({
  code,
  desc,
  edm_const: 0,
  edm_ppm: 0,
  hzPrecision_sec: 0,
  dirPrecision_sec: 0,
  azBearingPrecision_sec: 0,
  vaPrecision_sec: 0,
  instCentr_m: 0,
  tgtCentr_m: 0,
  vertCentr_m: 0,
  elevDiff_const_m: 0,
  elevDiff_ppm: 0,
  gpsStd_xy: 0,
  levStd_mmPerKm: 0,
});

const INDUSTRY_DEFAULT_INSTRUMENT: Instrument = {
  ...createInstrument('S9', 'industry standard S9 0.5"'),
  edm_const: 0.001,
  edm_ppm: 1,
  hzPrecision_sec: 0.5,
  dirPrecision_sec: 0.5,
  azBearingPrecision_sec: 0.5,
  vaPrecision_sec: 0.5,
  instCentr_m: DEFAULT_S9_INSTRUMENT_CENTERING_HORIZ_M,
  tgtCentr_m: 0,
};

const normalizeSolveProfile = (_profile: SolveProfile): SolveProfile => 'industry-parity';

export const resolveProfileContext = (
  base: RunSessionParseSettings,
  projectInstruments: InstrumentLibrary,
  selectedInstrument: string,
) => {
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
  const normalizedBase: RunSessionParseSettings = {
    ...base,
    solveProfile,
    runMode: requestedRunMode,
    preanalysisMode: requestedRunMode === 'preanalysis',
    suspectImpactMode: base.suspectImpactMode ?? 'auto',
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
        geometryDependentSigmaReference: normalizedBase.geometryDependentSigmaReference ?? 'current',
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
  const directionSetMode: ParseOptions['directionSetMode'] = parity ? 'raw' : 'reduced';
  const allowClusterFaceReliability = solveProfile === 'legacy-compat';
  const effectiveInstrumentLibrary = parity
    ? {
        ...projectInstruments,
        ...(projectInstruments[INDUSTRY_DEFAULT_INSTRUMENT_CODE]
          ? {}
          : { [INDUSTRY_DEFAULT_INSTRUMENT_CODE]: INDUSTRY_DEFAULT_INSTRUMENT }),
      }
    : projectInstruments;
  const currentInstrument = parity
    ? selectedInstrument && effectiveInstrumentLibrary[selectedInstrument]
      ? selectedInstrument
      : INDUSTRY_DEFAULT_INSTRUMENT_CODE
    : selectedInstrument || undefined;
  return {
    effectiveParse,
    directionSetMode,
    allowClusterFaceReliability,
    effectiveInstrumentLibrary,
    currentInstrument,
  };
};

export type RunSessionProfileContext = ReturnType<typeof resolveProfileContext>;

export const buildParseOptions = (
  request: RunSessionRequest,
  effectiveParse: RunSessionParseSettings,
  directionSetMode: ParseOptions['directionSetMode'],
  allowClusterFaceReliability: boolean,
  approvedClusterMerges: ClusterApprovedMerge[],
  currentInstrument?: string,
  options?: {
    sourceInputOverride?: string;
  },
): Partial<ParseOptions> => ({
  geometryDependentSigmaReference: effectiveParse.geometryDependentSigmaReference,
  runMode: effectiveParse.runMode,
  sourceFile: request.projectRunFiles?.[0]?.name ?? '<project-main>',
  includeFiles: request.projectIncludeFiles,
  projectRunFiles:
    options?.sourceInputOverride != null
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
  preanalysisSyntheticAdditionIds: effectiveParse.preanalysisSyntheticAdditionIds ?? [],
  order: effectiveParse.order,
  angleUnits: effectiveParse.angleUnits,
  angleStationOrder: effectiveParse.angleStationOrder,
  angleMode: effectiveParse.angleMode,
  deltaMode: effectiveParse.deltaMode,
  mapMode: effectiveParse.mapMode,
  mapScaleFactor: effectiveParse.mapScaleFactor,
  faceNormalizationMode: effectiveParse.faceNormalizationMode,
  normalize: effectiveParse.faceNormalizationMode !== 'off',
  directionFaceReliabilityFromCluster: allowClusterFaceReliability,
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
  qFixLinearSigmaM: effectiveParse.qFixLinearSigmaM ?? DEFAULT_QFIX_LINEAR_SIGMA_M,
  qFixAngularSigmaSec: effectiveParse.qFixAngularSigmaSec ?? DEFAULT_QFIX_ANGULAR_SIGMA_SEC,
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
  directionSetMode,
  clusterDetectionEnabled: effectiveParse.clusterDetectionEnabled,
  clusterApprovedMerges: approvedClusterMerges,
  currentInstrument,
  preferExternalInstruments: true,
});
