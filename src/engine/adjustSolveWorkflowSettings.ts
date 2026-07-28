import {
  LEVEL_LOOP_DEFAULT_BASE_MM,
  LEVEL_LOOP_DEFAULT_PER_SQRT_KM_MM,
} from './adjustConstants';
import type { RunMode } from '../types';

export type AdjustmentSolveWorkflowContext = Record<string, any>;

export const applyParsedSolveWorkflowSettings = (
  ctx: AdjustmentSolveWorkflowContext,
  parsed: any,
): boolean => {
  ctx.coordMode = parsed.parseState?.coordMode ?? ctx.parseOptions?.coordMode ?? '3D';
  ctx.addCenteringToExplicit = parsed.parseState?.addCenteringToExplicit ?? false;
  ctx.applyCentering = parsed.parseState?.applyCentering ?? true;
  ctx.debug = parsed.parseState?.debug ?? false;
  ctx.mapMode = parsed.parseState?.mapMode ?? ctx.parseOptions?.mapMode ?? 'off';
  ctx.mapScaleFactor = parsed.parseState?.mapScaleFactor ?? ctx.parseOptions?.mapScaleFactor ?? 1;
  ctx.coordSystemMode =
    parsed.parseState?.coordSystemMode ?? ctx.parseOptions?.coordSystemMode ?? 'local';
  ctx.crsId = parsed.parseState?.crsId ?? ctx.parseOptions?.crsId ?? 'CA_NAD83_CSRS_UTM_20N';
  ctx.localDatumScheme =
    parsed.parseState?.localDatumScheme ?? ctx.parseOptions?.localDatumScheme ?? 'average-scale';
  ctx.averageScaleFactor =
    parsed.parseState?.averageScaleFactor ?? ctx.parseOptions?.averageScaleFactor ?? 1;
  if (!Number.isFinite(ctx.averageScaleFactor) || ctx.averageScaleFactor <= 0) {
    ctx.averageScaleFactor = 1;
  }
  ctx.scaleOverrideActive =
    parsed.parseState?.scaleOverrideActive ?? ctx.parseOptions?.scaleOverrideActive ?? false;
  ctx.commonElevation = parsed.parseState?.commonElevation ?? ctx.parseOptions?.commonElevation ?? 0;
  if (!Number.isFinite(ctx.commonElevation)) ctx.commonElevation = 0;
  ctx.averageGeoidHeight =
    parsed.parseState?.averageGeoidHeight ?? ctx.parseOptions?.averageGeoidHeight ?? 0;
  if (!Number.isFinite(ctx.averageGeoidHeight)) ctx.averageGeoidHeight = 0;
  ctx.crsGridScaleEnabled =
    parsed.parseState?.crsGridScaleEnabled ?? ctx.parseOptions?.crsGridScaleEnabled ?? false;
  ctx.crsGridScaleFactor =
    parsed.parseState?.crsGridScaleFactor ?? ctx.parseOptions?.crsGridScaleFactor ?? 1;
  if (!Number.isFinite(ctx.crsGridScaleFactor) || ctx.crsGridScaleFactor <= 0) {
    ctx.crsGridScaleFactor = 1;
  }
  ctx.crsConvergenceEnabled =
    parsed.parseState?.crsConvergenceEnabled ?? ctx.parseOptions?.crsConvergenceEnabled ?? false;
  ctx.crsConvergenceAngleRad =
    parsed.parseState?.crsConvergenceAngleRad ?? ctx.parseOptions?.crsConvergenceAngleRad ?? 0;
  if (!Number.isFinite(ctx.crsConvergenceAngleRad)) {
    ctx.crsConvergenceAngleRad = 0;
  }
  ctx.geoidModelEnabled =
    parsed.parseState?.geoidModelEnabled ?? ctx.parseOptions?.geoidModelEnabled ?? false;
  ctx.geoidModelId = (parsed.parseState?.geoidModelId ??
    ctx.parseOptions?.geoidModelId ??
    'NGS-DEMO') as string;
  ctx.geoidSourceFormat =
    parsed.parseState?.geoidSourceFormat ?? ctx.parseOptions?.geoidSourceFormat ?? 'builtin';
  if (
    ctx.geoidSourceFormat !== 'builtin' &&
    ctx.geoidSourceFormat !== 'gtx' &&
    ctx.geoidSourceFormat !== 'byn'
  ) {
    ctx.geoidSourceFormat = 'builtin';
  }
  ctx.geoidSourcePath = String(
    parsed.parseState?.geoidSourcePath ?? ctx.parseOptions?.geoidSourcePath ?? '',
  ).trim();
  ctx.geoidInterpolation =
    parsed.parseState?.geoidInterpolation ?? ctx.parseOptions?.geoidInterpolation ?? 'bilinear';
  ctx.geoidHeightConversionEnabled =
    parsed.parseState?.geoidHeightConversionEnabled ??
    ctx.parseOptions?.geoidHeightConversionEnabled ??
    false;
  ctx.geoidOutputHeightDatum =
    parsed.parseState?.geoidOutputHeightDatum ??
    ctx.parseOptions?.geoidOutputHeightDatum ??
    'orthometric';
  if (ctx.geoidOutputHeightDatum !== 'ellipsoid') {
    ctx.geoidOutputHeightDatum = 'orthometric';
  }
  ctx.applyCurvatureRefraction =
    parsed.parseState?.applyCurvatureRefraction ??
    ctx.parseOptions?.applyCurvatureRefraction ??
    false;
  ctx.refractionCoefficient =
    parsed.parseState?.refractionCoefficient ?? ctx.parseOptions?.refractionCoefficient ?? 0.13;
  ctx.verticalReduction =
    parsed.parseState?.verticalReduction ?? ctx.parseOptions?.verticalReduction ?? 'none';
  ctx.tsCorrelationEnabled =
    parsed.parseState?.tsCorrelationEnabled ?? ctx.parseOptions?.tsCorrelationEnabled ?? false;
  ctx.tsCorrelationRho =
    parsed.parseState?.tsCorrelationRho ?? ctx.parseOptions?.tsCorrelationRho ?? 0.25;
  ctx.tsCorrelationScope =
    parsed.parseState?.tsCorrelationScope ?? ctx.parseOptions?.tsCorrelationScope ?? 'set';
  const resolvedPreanalysisMode =
    parsed.parseState?.preanalysisMode ?? ctx.parseOptions?.preanalysisMode ?? false;
  ctx.preanalysisMode =
    ctx.runMode === 'preanalysis'
      ? true
      : ctx.runMode === 'data-check' || ctx.runMode === 'blunder-detect'
        ? false
        : resolvedPreanalysisMode;
  ctx.robustMode = parsed.parseState?.robustMode ?? ctx.parseOptions?.robustMode ?? 'none';
  ctx.robustK = parsed.parseState?.robustK ?? ctx.parseOptions?.robustK ?? 1.5;
  if (ctx.preanalysisMode || ctx.runMode === 'data-check') {
    ctx.robustMode = 'none';
  }
  ctx.prismEnabled = parsed.parseState?.prismEnabled ?? ctx.parseOptions?.prismEnabled ?? false;
  ctx.prismOffset = parsed.parseState?.prismOffset ?? ctx.parseOptions?.prismOffset ?? 0;
  ctx.prismScope = parsed.parseState?.prismScope ?? ctx.parseOptions?.prismScope ?? 'global';
  ctx.clusterDetectionEnabled =
    parsed.parseState?.clusterDetectionEnabled ??
    ctx.parseOptions?.clusterDetectionEnabled ??
    true;
  ctx.clusterLinkageMode =
    parsed.parseState?.clusterLinkageMode ?? ctx.parseOptions?.clusterLinkageMode ?? 'single';
  ctx.clusterTolerance2D =
    parsed.parseState?.clusterTolerance2D ?? ctx.parseOptions?.clusterTolerance2D ?? 0.03;
  ctx.clusterTolerance3D =
    parsed.parseState?.clusterTolerance3D ?? ctx.parseOptions?.clusterTolerance3D ?? 0.05;
  ctx.levelLoopToleranceBaseMm =
    parsed.parseState?.levelLoopToleranceBaseMm ??
    ctx.parseOptions?.levelLoopToleranceBaseMm ??
    LEVEL_LOOP_DEFAULT_BASE_MM;
  ctx.levelLoopTolerancePerSqrtKmMm =
    parsed.parseState?.levelLoopTolerancePerSqrtKmMm ??
    ctx.parseOptions?.levelLoopTolerancePerSqrtKmMm ??
    LEVEL_LOOP_DEFAULT_PER_SQRT_KM_MM;
  const gpsLoopCheckEnabled =
    parsed.parseState?.gpsLoopCheckEnabled ?? ctx.parseOptions?.gpsLoopCheckEnabled ?? false;
  ctx.gnssFrameConfirmed =
    parsed.parseState?.gnssFrameConfirmed ?? ctx.parseOptions?.gnssFrameConfirmed ?? false;
  ctx.geometryDependentSigmaReference =
    parsed.parseState?.geometryDependentSigmaReference ??
    ctx.parseOptions?.geometryDependentSigmaReference ??
    'current';
  ctx.parseState = parsed.parseState;
  if (ctx.parseState) {
    applyParsedParseStateWorkflowSettings(ctx, gpsLoopCheckEnabled);
  }
  return gpsLoopCheckEnabled;
};

const applyParsedParseStateWorkflowSettings = (
  ctx: AdjustmentSolveWorkflowContext,
  gpsLoopCheckEnabled: boolean,
): void => {
  ctx.parseState.geometryDependentSigmaReference = ctx.geometryDependentSigmaReference;
  ctx.parseState.runMode = ctx.runMode as RunMode;
  ctx.parseState.preanalysisMode = ctx.preanalysisMode;
  ctx.parseState.runModeCompatibilityDiagnostics = [...ctx.runModeCompatibilityDiagnostics];
  ctx.parseState.coordSystemMode = ctx.coordSystemMode;
  ctx.parseState.crsId = ctx.crsId;
  ctx.parseState.localDatumScheme = ctx.localDatumScheme;
  ctx.parseState.averageScaleFactor = ctx.averageScaleFactor;
  ctx.parseState.scaleOverrideActive = ctx.scaleOverrideActive;
  ctx.parseState.commonElevation = ctx.commonElevation;
  ctx.parseState.averageGeoidHeight = ctx.averageGeoidHeight;
  ctx.parseState.geoidSourceFormat = ctx.geoidSourceFormat;
  ctx.parseState.geoidSourcePath = ctx.geoidSourcePath;
  ctx.parseState.geoidSourceResolvedFormat = ctx.geoidSourceFormat;
  ctx.parseState.geoidSourceFallbackUsed = false;
  ctx.parseState.reductionContext = ctx.parseState.reductionContext ?? {
    inputSpaceDefault:
      (ctx.parseState.gridDistanceMode ?? 'measured') === 'measured' ? 'measured' : 'grid',
    distanceKind:
      (ctx.parseState.gridDistanceMode ?? 'measured') === 'ellipsoidal'
        ? 'ellipsoidal'
        : (ctx.parseState.gridDistanceMode ?? 'measured') === 'grid'
          ? 'grid'
          : 'ground',
    bearingKind: ctx.parseState.gridBearingMode ?? 'grid',
    explicitOverrideActive: ctx.scaleOverrideActive,
  };
  ctx.parseState.observationMode = {
    bearing: ctx.parseState.gridBearingMode ?? 'grid',
    distance: ctx.parseState.gridDistanceMode ?? 'measured',
    angle: ctx.parseState.gridAngleMode ?? 'measured',
    direction: ctx.parseState.gridDirectionMode ?? 'measured',
  };
  ctx.parseState.gnssFrameConfirmed = ctx.gnssFrameConfirmed;
  ctx.parseState.gnssVectorFrameDefault =
    ctx.parseState.gnssVectorFrameDefault ?? ctx.parseOptions?.gnssVectorFrameDefault ?? 'gridNEU';
  ctx.parseState.gpsLoopCheckEnabled = gpsLoopCheckEnabled;
  ctx.parseState.levelLoopToleranceBaseMm = ctx.levelLoopToleranceBaseMm;
  ctx.parseState.levelLoopTolerancePerSqrtKmMm = ctx.levelLoopTolerancePerSqrtKmMm;
  ctx.parseState.geoidHeightConversionEnabled = ctx.geoidHeightConversionEnabled;
  ctx.parseState.geoidOutputHeightDatum = ctx.geoidOutputHeightDatum;
  ctx.parseState.geoidModelLoaded = false;
  ctx.parseState.geoidModelMetadata = '';
  ctx.parseState.geoidSampleUndulationM = undefined;
  ctx.parseState.geoidConvertedStationCount = 0;
  ctx.parseState.geoidSkippedStationCount = 0;
  ctx.parseState.coordSystemDiagnostics = [];
  ctx.parseState.coordSystemWarningMessages = [];
  ctx.parseState.crsStatus = ctx.coordSystemMode === 'grid' ? 'off' : undefined;
  ctx.parseState.crsOffReason = ctx.coordSystemMode === 'grid' ? 'noCRSSelected' : undefined;
  ctx.parseState.crsDatumOpId = '';
  ctx.parseState.crsDatumFallbackUsed = false;
  ctx.parseState.crsAreaOfUseStatus = 'unknown';
  ctx.parseState.crsOutOfAreaStationCount = 0;
  ctx.parseState.usedInSolveUsageSummary = undefined;
};
