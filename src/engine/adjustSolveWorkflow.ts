import { RAD_TO_DEG, DEG_TO_RAD } from './angles';
import {
  EPS,
  GPS_LOOP_BASE_TOLERANCE_M,
  GPS_LOOP_TOLERANCE_PPM,
  LEVEL_LOOP_DEFAULT_BASE_MM,
  LEVEL_LOOP_DEFAULT_PER_SQRT_KM_MM,
} from './adjustConstants';
import { cloneParsedResultValue } from './adjustTypes';
import { geoidGridMetadataSummary, interpolateGeoidUndulation, loadGeoidGridModel } from './geoid';
import type { GeoidGridModel } from './geoid';
import { parseInput } from './parse';
import { runClusterDualPassWorkflow } from './adjustmentClusterWorkflow';
import { applyAutoDroppedHeightHolds, buildSolvePreparation, cloneSolvePreparationResult } from './adjustmentPreprocessing';
import { assembleAdjustmentEquations } from './adjustmentEquationAssembly';
import { applyAdjustmentCorrections, solveAdjustmentIteration } from './adjustmentIteration';
import { getObservationSideshotCalcMeta } from './observationMetadata';
import { buildGpsLoopDiagnostics, buildLevelingLoopDiagnostics } from './adjustmentLoopDiagnostics';
import { resolveRunModeCompatibilityOptions } from './adjustmentRunModeCompatibility';
import { summarizeReductionUsage } from './reductionUsageSummary';
import type {
  AdjustmentResult,
  GpsObservation,
  LevelObservation,
  Observation,
  RunMode,
  RunModeCompatibilityDiagnostic,
} from '../types';

export type AdjustmentSolveWorkflowContext = Record<string, any>;

export const runAdjustmentSolveWorkflow = (
  ctx: AdjustmentSolveWorkflowContext,
): AdjustmentResult => {    ctx.solveStartedAt = Date.now();
    ctx.resetSolveTiming();
    ctx.emitSolveProgress('start');
    const requestedRunMode: RunMode =
      ctx.parseOptions?.runMode ??
      (ctx.parseOptions?.preanalysisMode ? 'preanalysis' : 'adjustment');
    const runModeCompatibility = resolveRunModeCompatibilityOptions(
      requestedRunMode,
      ctx.parseOptions ?? {},
    );
    ctx.parseOptions = runModeCompatibility.effectiveOptions;
    ctx.runModeCompatibilityDiagnostics = [...runModeCompatibility.diagnostics];
    const clusterWorkflowResult = runClusterDualPassWorkflow({
      requestedRunMode,
      parseOptions: ctx.parseOptions,
      solveScenario: (parseOptions, overrides) => ctx.solveNestedScenario(parseOptions, overrides),
      overrides: ctx.overrides,
    });
    if (clusterWorkflowResult) {
      return clusterWorkflowResult;
    }

    let parseAndSetupStartedAt = Date.now();
    const finishParseAndSetupTiming = () => {
      if (parseAndSetupStartedAt <= 0) return;
      ctx.solveTiming.parseAndSetupMs += Date.now() - parseAndSetupStartedAt;
      parseAndSetupStartedAt = 0;
    };
    const parsed = ctx.parsedResult
      ? cloneParsedResultValue(ctx.parsedResult)
      : parseInput(ctx.input, ctx.instrumentLibrary, ctx.parseOptions);
    ctx.stations = parsed.stations;
    ctx.observations = parsed.observations;
    ctx.unknowns = parsed.unknowns;
    ctx.instrumentLibrary = parsed.instrumentLibrary;
    ctx.logs = [...parsed.logs];
    ctx.directionRejectDiagnostics = parsed.directionRejectDiagnostics ?? [];
    const parseRunMode =
      parsed.parseState?.runMode ??
      ctx.parseOptions?.runMode ??
      (parsed.parseState?.preanalysisMode ? 'preanalysis' : 'adjustment');
    ctx.runMode = parseRunMode;
    const includeErrors = parsed.parseState?.includeErrors ?? [];
    if (includeErrors.length > 0) {
      ctx.converged = false;
      ctx.iterations = 0;
      ctx.dof = 0;
      ctx.seuw = 0;
      ctx.parseState = parsed.parseState;
      if (ctx.parseState) {
        ctx.parseState.runModeCompatibilityDiagnostics = [...ctx.runModeCompatibilityDiagnostics];
      }
      ctx.emitRunModeCompatibilityDiagnostics(ctx.runModeCompatibilityDiagnostics);
      ctx.logs.push(
        `Run failed: include preprocessing reported ${includeErrors.length} error(s).`,
      );
      includeErrors.forEach((error: any) => {
        ctx.logs.push(
          `  include-error ${error.code} at ${error.sourceFile}:${error.line}${error.includePath ? ` (${error.includePath})` : ''}: ${error.message}`,
        );
      });
      finishParseAndSetupTiming();
      return ctx.buildResult();
    }
    ctx.coordMode = parsed.parseState?.coordMode ?? ctx.parseOptions?.coordMode ?? '3D';
    ctx.addCenteringToExplicit = parsed.parseState?.addCenteringToExplicit ?? false;
    ctx.applyCentering = parsed.parseState?.applyCentering ?? true;
    ctx.debug = parsed.parseState?.debug ?? false;
    ctx.mapMode = parsed.parseState?.mapMode ?? ctx.parseOptions?.mapMode ?? 'off';
    ctx.mapScaleFactor =
      parsed.parseState?.mapScaleFactor ?? ctx.parseOptions?.mapScaleFactor ?? 1;
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
    ctx.commonElevation =
      parsed.parseState?.commonElevation ?? ctx.parseOptions?.commonElevation ?? 0;
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
      ctx.parseState.geometryDependentSigmaReference = ctx.geometryDependentSigmaReference;
      ctx.parseState.runMode = ctx.runMode;
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
        ctx.parseState.gnssVectorFrameDefault ??
        ctx.parseOptions?.gnssVectorFrameDefault ??
        'gridNEU';
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
    }
    ctx.is2D = ctx.coordMode === '2D';
    ctx.condition = undefined;
    ctx.controlConstraints = undefined;
    ctx.sideshots = undefined;
    ctx.autoSideshotDiagnostics = undefined;
    ctx.tsCorrelationDiagnostics = undefined;
    ctx.robustDiagnostics = undefined;
    ctx.residualDiagnostics = undefined;
    ctx.clusterDiagnostics = undefined;
    ctx.gpsLoopDiagnostics = undefined;
    ctx.levelingLoopDiagnostics = undefined;
    ctx.chiSquare = undefined;
    ctx.statisticalSummary = undefined;
    ctx.typeSummary = undefined;
    ctx.relativePrecision = undefined;
    ctx.stationCovariances = undefined;
    ctx.relativeCovariances = undefined;
    ctx.precisionModels = undefined;
    ctx.weakGeometryDiagnostics = undefined;
    ctx.conditionWarned = false;
    ctx.initialSigmaGeometryStations = {};
    ctx.initialSigmaAzimuthCache.clear();
    ctx.initialSigmaZenithCache.clear();
    ctx.clearCoordSystemDiagnostics();
    ctx.clearGeometryCache();
    if (ctx.coordSystemMode !== 'grid') {
      ctx.setCrsOff('disabledByProfile');
    } else if (!ctx.crsId || !ctx.crsId.trim()) {
      ctx.setCrsOff('noCRSSelected', 'Grid coordinate mode is active but CRS id is missing.');
    } else {
      ctx.setCrsOff('noInverseAvailable');
    }

    if ((ctx.directionRejectDiagnostics?.length ?? 0) > 0) {
      ctx.log(`Direction rejects captured: ${ctx.directionRejectDiagnostics?.length}`);
    }

    if (ctx.mapMode !== 'off') {
      ctx.log(
        `Map reduction active: mode=${ctx.mapMode}, scale=${ctx.mapScaleFactor.toFixed(8)}`,
      );
    }
    ctx.log(
      `Coordinate system mode: ${ctx.coordSystemMode.toUpperCase()}${ctx.coordSystemMode === 'grid' ? ` (CRS=${ctx.crsId})` : ` (datum=${ctx.localDatumScheme}, scale=${ctx.averageScaleFactor.toFixed(8)}, commonElev=${ctx.commonElevation.toFixed(4)}m)`}`,
    );
    if (ctx.crsGridScaleEnabled) {
      ctx.log(`CRS grid-ground scale active: factor=${ctx.crsGridScaleFactor.toFixed(8)}`);
    }
    if (ctx.crsConvergenceEnabled) {
      ctx.log(
        `CRS convergence active: angle=${(ctx.crsConvergenceAngleRad * RAD_TO_DEG).toFixed(6)} deg`,
      );
    }
    let geoidModel: GeoidGridModel | null = null;
    ctx.activeGeoidModel = null;
    if (ctx.geoidModelEnabled) {
      const loaded = loadGeoidGridModel({
        modelId: ctx.geoidModelId,
        sourceFormat: ctx.geoidSourceFormat ?? 'builtin',
        sourcePath: ctx.geoidSourcePath,
        sourceData: ctx.geoidSourceData,
      });
      if (loaded.model) {
        geoidModel = loaded.model;
        ctx.activeGeoidModel = geoidModel;
        const metadata = geoidGridMetadataSummary(loaded.model);
        if (ctx.parseState) {
          ctx.parseState.geoidModelLoaded = true;
          ctx.parseState.geoidModelMetadata = metadata;
          ctx.parseState.geoidModelId = loaded.model.id;
          ctx.parseState.geoidInterpolation = ctx.geoidInterpolation ?? 'bilinear';
          ctx.parseState.geoidSourceResolvedFormat = loaded.resolvedFormat;
          ctx.parseState.geoidSourceFallbackUsed = loaded.fallbackUsed;
        }
        if (loaded.warning) ctx.log(`Warning: ${loaded.warning}`);
        ctx.log(
          `Geoid/grid model loaded: ${metadata} (interp=${(ctx.geoidInterpolation ?? 'bilinear').toUpperCase()}, format=${loaded.resolvedFormat.toUpperCase()}, fallback=${loaded.fallbackUsed ? 'YES' : 'NO'}, cache=${loaded.fromCache ? 'HIT' : 'MISS'})`,
        );
        const originLat = ctx.parseState?.originLatDeg;
        const originLon = ctx.parseState?.originLonDeg;
        if (originLat != null && originLon != null) {
          const undulation = interpolateGeoidUndulation(
            loaded.model,
            originLat,
            originLon,
            ctx.geoidInterpolation ?? 'bilinear',
          );
          if (undulation != null && Number.isFinite(undulation)) {
            if (ctx.parseState) ctx.parseState.geoidSampleUndulationM = undulation;
            ctx.log(
              `Geoid sample at geodetic origin: N=${undulation.toFixed(4)} m (lat=${originLat.toFixed(
                6,
              )}, lon=${originLon.toFixed(6)})`,
            );
          } else {
            ctx.log(
              `Geoid sample unavailable: origin (${originLat.toFixed(6)}, ${originLon.toFixed(
                6,
              )}) is outside model coverage.`,
            );
          }
        }
      } else {
        ctx.activeGeoidModel = null;
        if (ctx.parseState) {
          ctx.parseState.geoidModelLoaded = false;
          ctx.parseState.geoidModelMetadata = loaded.warning ?? '';
          ctx.parseState.geoidSourceResolvedFormat = loaded.resolvedFormat;
          ctx.parseState.geoidSourceFallbackUsed = loaded.fallbackUsed;
        }
        ctx.log(`Warning: ${loaded.warning ?? 'failed to load geoid/grid model.'}`);
      }
    }
    if (ctx.geoidHeightConversionEnabled) {
      if (!ctx.geoidModelEnabled) {
        ctx.applyAverageGeoidHeightConversions();
      } else if (!geoidModel) {
        ctx.applyAverageGeoidHeightConversions();
      } else {
        ctx.applyGeoidHeightConversions(geoidModel);
      }
    }
    if (ctx.coordSystemMode === 'grid') {
      ctx.evaluateCrsAreaOfUseCoverage();
      if (ctx.crsDatumOpId) {
        ctx.log(`CRS datum operation: ${ctx.crsDatumOpId}`);
      }
      if (ctx.crsAreaOfUseStatus === 'inside') {
        ctx.log('CRS area-of-use check: all evaluated stations are inside area bounds.');
      } else if (ctx.crsAreaOfUseStatus === 'outside') {
        ctx.log(
          `CRS area-of-use check: ${ctx.crsOutOfAreaStationCount} station(s) outside configured area bounds (warning-only).`,
        );
      } else {
        ctx.log(
          'CRS area-of-use check: unavailable (no CRS bounds metadata or no geodetic stations).',
        );
      }
    }
    if (ctx.applyCurvatureRefraction && ctx.verticalReduction === 'curvref') {
      ctx.log(
        `Vertical reduction active: curvature/refraction (k=${ctx.refractionCoefficient.toFixed(
          3,
        )})`,
      );
    }
    if (ctx.tsCorrelationEnabled && ctx.tsCorrelationRho > 0) {
      ctx.log(
        `TS angular correlation active: scope=${ctx.tsCorrelationScope}, rho=${ctx.tsCorrelationRho.toFixed(3)}`,
      );
    }
    if (ctx.preanalysisMode) {
      ctx.log(
        'Preanalysis mode active: residual-based QC, chi-square, and robust reweighting are disabled.',
      );
    } else if (ctx.robustMode === 'huber') {
      ctx.robustDiagnostics = {
        enabled: true,
        mode: 'huber',
        k: Math.max(0.5, Math.min(10, ctx.robustK || 1.5)),
        iterations: [],
        topDownweightedRows: [],
      };
      ctx.log(
        `Robust reweighting active: mode=${ctx.robustMode}, k=${ctx.robustDiagnostics.k.toFixed(2)}`,
      );
    }
    let distCount = 0;
    let zenithCount = 0;
    ctx.observations.forEach((obs: Observation) => {
      const correction = ctx.prismCorrectionForObservation(obs);
      if (Math.abs(correction) <= 0) return;
      if (obs.type === 'dist') distCount += 1;
      if (obs.type === 'zenith') zenithCount += 1;
    });
    if (distCount > 0 || zenithCount > 0) {
      ctx.log(
        `Prism correction active: distRows=${distCount}, zenithRows=${zenithCount}, currentState=${ctx.prismEnabled ? `ON(${ctx.prismOffset.toFixed(4)}m,${ctx.prismScope})` : 'OFF'}`,
      );
    } else if (
      ctx.prismEnabled &&
      Number.isFinite(ctx.prismOffset) &&
      Math.abs(ctx.prismOffset) > 0
    ) {
      ctx.log(
        `Prism correction configured but no eligible rows: offset=${ctx.prismOffset.toFixed(4)}m, scope=${ctx.prismScope}`,
      );
    }

    // Apply overrides before any unit normalization
    if (ctx.overrides) {
      ctx.observations.forEach((obs: Observation) => {
        const over = ctx.overrides?.[obs.id];
        if (!over) return;
        if (over.stdDev != null) {
          obs.stdDev = over.stdDev;
          if (obs.type === 'gps') {
            obs.stdDevE = over.stdDev;
            obs.stdDevN = over.stdDev;
            obs.corrEN = 0;
          }
        }
        if (over.obs != null) {
          if (
            (obs.type === 'angle' ||
              obs.type === 'direction' ||
              obs.type === 'bearing' ||
              obs.type === 'dir' ||
              obs.type === 'zenith') &&
            typeof over.obs === 'number'
          ) {
            obs.obs = (over.obs as number) * DEG_TO_RAD;
          } else if ((obs.type === 'dist' || obs.type === 'lev') && typeof over.obs === 'number') {
            obs.obs = over.obs as number;
          } else if (obs.type === 'gps' && typeof over.obs === 'object') {
            const val = over.obs as { dE: number; dN: number };
            obs.obs = { dE: val.dE, dN: val.dN };
          }
        }
      });
    }

    if (ctx.preanalysisMode) {
      ctx.populatePreanalysisObservations();
    }

    ctx.updateGpsAddHiHtDiagnostics();
    const activeObservations = ctx.collectActiveObservations() as Observation[];
    ctx.bootstrapApproximateTraverseCoords(activeObservations);
    ctx.captureRawTraverseDistanceFactorSnapshots(activeObservations);
    if (ctx.parseState) {
      ctx.parseState.usedInSolveUsageSummary = summarizeReductionUsage(activeObservations);
      ctx.parseState.parsedUsageSummary =
        ctx.parseState.parsedUsageSummary ?? summarizeReductionUsage(ctx.observations);
    }
    if (
      ctx.runMode === 'blunder-detect' &&
      activeObservations.length > 0 &&
      activeObservations.every((obs: Observation) => obs.type === 'lev')
    ) {
      const levelingOnlyError: RunModeCompatibilityDiagnostic = {
        code: 'BLUNDER_LEVELING_ONLY',
        severity: 'error',
        message: 'Blunder Detect mode is not supported for leveling-only datasets.',
        action: 'Use adjustment or data-check mode for this dataset.',
      };
      ctx.runModeCompatibilityDiagnostics = [
        ...ctx.runModeCompatibilityDiagnostics,
        levelingOnlyError,
      ];
      if (ctx.parseState) {
        ctx.parseState.runModeCompatibilityDiagnostics = [...ctx.runModeCompatibilityDiagnostics];
      }
      ctx.emitRunModeCompatibilityDiagnostics(ctx.runModeCompatibilityDiagnostics);
      ctx.converged = false;
      return ctx.finishSolve(ctx.buildResult());
    }
    if (ctx.runMode === 'blunder-detect') {
      return ctx.finishSolve(ctx.runBlunderDetectWorkflow(ctx.runModeCompatibilityDiagnostics));
    }

    ctx.emitRunModeCompatibilityDiagnostics(ctx.runModeCompatibilityDiagnostics);
    if (ctx.runMode === 'data-check') {
      finishParseAndSetupTiming();
      return ctx.finishSolve(ctx.runDataCheckOnly(activeObservations));
    }
    if (ctx.runMode === 'adjustment' && (ctx.parseOptions?.autoAdjustEnabled ?? false)) {
      finishParseAndSetupTiming();
      return ctx.finishSolve(ctx.runAutoAdjustWorkflow());
    }
    const gridInputGate = ctx.evaluateGridInputGate(activeObservations);
    if (gridInputGate.blocked) {
      ctx.addCoordSystemDiagnostic('CRS_INPUT_MIX_BLOCKED');
      if (gridInputGate.reasons.some((reason: string) => reason.toUpperCase().includes('UNKNOWN FRAME'))) {
        ctx.addCoordSystemDiagnostic('GNSS_FRAME_UNCONFIRMED');
      }
      gridInputGate.reasons.forEach((reason: string) => ctx.log(`Error: ${reason}`));
      gridInputGate.suggestions.forEach((suggestion: string) => ctx.log(`Suggestion: ${suggestion}`));
      ctx.datumSufficiencyReport = {
        status: 'hard-fail',
        reasons: [...gridInputGate.reasons],
        suggestions: [...gridInputGate.suggestions],
      };
      if (ctx.parseState) {
        ctx.parseState.datumSufficiencyReport = ctx.datumSufficiencyReport;
      }
      finishParseAndSetupTiming();
      return ctx.finishSolve(ctx.buildResult());
    }
    ctx.datumSufficiencyReport = ctx.evaluateDatumSufficiency(activeObservations);
    if (ctx.datumSufficiencyReport.status === 'hard-fail') {
      ctx.addCoordSystemDiagnostic('DATUM_HARD_FAIL');
      ctx.datumSufficiencyReport.reasons.forEach((reason: string) => ctx.log(`Error: ${reason}`));
      ctx.datumSufficiencyReport.suggestions.forEach((suggestion: string) =>
        ctx.log(`Suggestion: ${suggestion}`),
      );
      if (ctx.parseState) {
        ctx.parseState.datumSufficiencyReport = ctx.datumSufficiencyReport;
      }
      finishParseAndSetupTiming();
      return ctx.finishSolve(ctx.buildResult());
    }
    if (ctx.datumSufficiencyReport.status === 'soft-warn') {
      ctx.addCoordSystemDiagnostic('DATUM_SOFT_WARN');
      ctx.datumSufficiencyReport.reasons.forEach((reason: string) => ctx.log(`Warning: ${reason}`));
      ctx.datumSufficiencyReport.suggestions.forEach((suggestion: string) =>
        ctx.log(`Suggestion: ${suggestion}`),
      );
    }
    if (ctx.parseState) {
      ctx.parseState.datumSufficiencyReport = ctx.datumSufficiencyReport;
    }
    if (gpsLoopCheckEnabled) {
      const gpsNetworkRows = activeObservations.filter(
        (obs: Observation): obs is GpsObservation => obs.type === 'gps' && obs.gpsMode !== 'sideshot',
      );
      ctx.gpsLoopDiagnostics = buildGpsLoopDiagnostics({
        gpsObservations: gpsNetworkRows,
        observedVector: (obs: GpsObservation) => ctx.gpsObservedVector(obs),
        baseToleranceM: GPS_LOOP_BASE_TOLERANCE_M,
        ppmTolerance: GPS_LOOP_TOLERANCE_PPM,
        eps: EPS,
      });
      ctx.log(
        `GPS loop check: vectors=${ctx.gpsLoopDiagnostics.vectorCount}, loops=${ctx.gpsLoopDiagnostics.loopCount}, pass=${ctx.gpsLoopDiagnostics.passCount}, warn=${ctx.gpsLoopDiagnostics.warnCount}, tolerance=${ctx.gpsLoopDiagnostics.thresholds.baseToleranceM.toFixed(3)}m+${ctx.gpsLoopDiagnostics.thresholds.ppmTolerance}ppm*dist`,
      );
      ctx.gpsLoopDiagnostics.loops.slice(0, 10).forEach((loop: any) => {
        ctx.log(
          `  #${loop.rank} ${loop.key}: path=${loop.stationPath.join('->')} closure(dE=${loop.closureE.toFixed(4)}m,dN=${loop.closureN.toFixed(4)}m,|d|=${loop.closureMag.toFixed(4)}m) tol=${loop.toleranceM.toFixed(4)}m ppm=${loop.linearPpm != null ? loop.linearPpm.toFixed(1) : '-'} sev=${loop.severity.toFixed(2)} status=${loop.pass ? 'PASS' : 'WARN'} lines=${loop.sourceLines.length > 0 ? loop.sourceLines.join(',') : '-'}`,
        );
      });
    }
    const levelingRows = activeObservations.filter(
      (obs: Observation): obs is LevelObservation => obs.type === 'lev',
    );
    if (levelingRows.length > 0) {
      ctx.levelingLoopDiagnostics = buildLevelingLoopDiagnostics({
        levelingObservations: levelingRows,
        baseMm: ctx.levelLoopToleranceBaseMm,
        perSqrtKmMm: ctx.levelLoopTolerancePerSqrtKmMm,
        eps: EPS,
      });
      ctx.log(
        `Leveling loop check: observations=${ctx.levelingLoopDiagnostics.observationCount}, loops=${ctx.levelingLoopDiagnostics.loopCount}, totalLength=${ctx.levelingLoopDiagnostics.totalLengthKm.toFixed(3)}km, tolerance=${ctx.levelingLoopDiagnostics.thresholds.baseMm.toFixed(3)}mm+${ctx.levelingLoopDiagnostics.thresholds.perSqrtKmMm.toFixed(3)}mm*sqrt(km)`,
      );
      ctx.levelingLoopDiagnostics.loops.slice(0, 10).forEach((loop: any) => {
        ctx.log(
          `  #${loop.rank} ${loop.key}: path=${loop.stationPath.join('->')} closure=${loop.closure.toFixed(4)}m |closure|=${loop.absClosure.toFixed(4)}m len=${loop.loopLengthKm.toFixed(3)}km tol=${loop.toleranceMm.toFixed(2)}mm mm/sqrt(km)=${loop.closurePerSqrtKmMm.toFixed(2)} status=${loop.pass ? 'PASS' : 'WARN'} lines=${loop.sourceLines.length > 0 ? loop.sourceLines.join(',') : '-'}`,
        );
      });
      ctx.levelingLoopDiagnostics.suspectSegments.slice(0, 5).forEach((segment: any) => {
        ctx.log(
          `  suspect #${segment.rank} ${segment.from}->${segment.to}: line=${segment.sourceLine ?? '-'} warnLoops=${segment.warnLoopCount} score=${segment.suspectScore.toFixed(2)} worst=${segment.worstLoopKey ?? '-'}`,
        );
      });
    }

    if (ctx.unknowns.length === 0) {
      ctx.log('No unknown stations to solve.');
      const sideshots = ctx.computeSideshotResults();
      ctx.sideshots = sideshots;
      const sideshotCount = sideshots?.length ?? 0;
      if (sideshotCount > 0) {
        ctx.log(`Sideshots (post-adjust): ${sideshotCount}`);
      }
      finishParseAndSetupTiming();
      return ctx.finishSolve(ctx.buildResult());
    }

    const gpsSideshotCount = ctx.observations.filter(
      (obs: Observation) => obs.type === 'gps' && obs.gpsMode === 'sideshot',
    ).length;
    if (gpsSideshotCount > 0) {
      ctx.log(
        `GPS sideshot vectors excluded from adjustment equations: ${gpsSideshotCount} (post-adjust output only).`,
      );
    }
    if (ctx.is2D) {
      const skippedVertical = ctx.observations.filter(
        (o: Observation) => (o.type === 'lev' || o.type === 'zenith') && !getObservationSideshotCalcMeta(o),
      ).length;
      if (skippedVertical > 0) {
        ctx.log(`2D mode: skipped ${skippedVertical} vertical observations (lev/zenith).`);
      }
    }
    ctx.logNetworkDiagnostics(activeObservations);
    const cachedSolvePreparation = ctx.solvePreparation;
    const solvePreparation = cachedSolvePreparation
      ? (() => {
          applyAutoDroppedHeightHolds(ctx.stations, cachedSolvePreparation.autoDroppedHeights);
          return cloneSolvePreparationResult(cachedSolvePreparation);
        })()
      : buildSolvePreparation(ctx.stations, ctx.unknowns, activeObservations, ctx.is2D);
    if (solvePreparation.autoDroppedHeights.length > 0) {
      ctx.log(
        `Auto-drop H for stations with no vertical observations: ${solvePreparation.autoDroppedHeights.join(', ')}`,
      );
    }
    const {
      directionSetIds,
      paramIndex,
      constraints,
      controlConstraints,
      numParams,
      numObsEquations,
      dirParamMap,
    } = solvePreparation;
    ctx.directionOrientations = {};
    ctx.computeDirectionSetPrefit(activeObservations, directionSetIds);
    ctx.paramIndex = paramIndex;
    ctx.controlConstraints = controlConstraints;
    ctx.captureInitialSigmaGeometrySnapshot();
    if (constraints.length) {
      ctx.log(
        `Weighted control constraints: ${constraints.length} (E=${ctx.controlConstraints.x}, N=${ctx.controlConstraints.y}, H=${ctx.controlConstraints.h}, corrXY=${ctx.controlConstraints.xyCorrelated ?? 0})`,
      );
    }
    ctx.dof = numObsEquations - numParams;
    if (ctx.dof < 0) {
      ctx.log('Error: Redundancy < 0. Under-determined.');
      finishParseAndSetupTiming();
      return ctx.finishSolve(ctx.buildResult());
    }
    finishParseAndSetupTiming();
    let prevObjectiveBefore: number | null = null;

    for (let iter = 0; iter < ctx.maxIterations; iter++) {
      ctx.iterations += 1;
      ctx.clearGeometryCache();
      const assemblyStartedAt = Date.now();
      const { A, L, P, rowInfo, sparseRows } = assembleAdjustmentEquations(
        {
          stations: ctx.stations,
          paramIndex: ctx.paramIndex,
          is2D: ctx.is2D,
          debug: ctx.debug,
          directionOrientations: ctx.directionOrientations,
          dirParamMap,
          effectiveStdDev: ctx.effectiveStdDev.bind(ctx),
          correctedDistanceModel: ctx.correctedDistanceModel.bind(ctx),
          getObservedHorizontalDistanceIn2D: ctx.getObservedHorizontalDistanceIn2D.bind(ctx),
          getAzimuth: ctx.getAzimuth.bind(ctx),
          measuredAngleCorrection: ctx.measuredAngleCorrection.bind(ctx),
          modeledAzimuth: ctx.modeledAzimuth.bind(ctx),
          wrapToPi: ctx.wrapToPi.bind(ctx),
          gpsObservedVector: ctx.gpsObservedVector.bind(ctx),
          gpsModeledVector: ctx.gpsModeledVector.bind(ctx),
          gpsModeledVectorDerivatives: ctx.gpsModeledVectorDerivatives.bind(ctx),
          gpsWeight: ctx.gpsWeight.bind(ctx),
          getModeledZenith: ctx.getModeledZenith.bind(ctx),
          curvatureRefractionAngle: ctx.curvatureRefractionAngle.bind(ctx),
          applyTsCorrelationToWeightMatrix: ctx.applyTsCorrelationToWeightMatrix.bind(ctx),
          logObsDebug: ctx.logObsDebug.bind(ctx),
        },
        activeObservations,
        constraints,
        numObsEquations,
        numParams,
        iter + 1,
        { includeDenseA: false },
      );
      ctx.solveTiming.equationAssemblyMs += Date.now() - assemblyStartedAt;

      const factorizationStartedAt = Date.now();
      try {
        const iterationResult = solveAdjustmentIteration(
          {
            robustMode: ctx.robustMode,
            solveNormalEquations: ctx.solveNormalEquations.bind(ctx),
            estimateCondition: ctx.estimateCondition.bind(ctx),
            recordConditionEstimate: ctx.recordConditionEstimate.bind(ctx),
            captureRobustWeightBase: ctx.captureRobustWeightBase.bind(ctx),
            applyRobustWeightFactors: ctx.applyRobustWeightFactors.bind(ctx),
            computeRobustWeightSummary: ctx.computeRobustWeightSummary.bind(ctx),
            maxRobustWeightDelta: ctx.maxRobustWeightDelta.bind(ctx),
            recordRobustDiagnostics: ctx.recordRobustDiagnostics.bind(ctx),
            weightedQuadratic: ctx.weightedQuadratic.bind(ctx),
          },
          A ?? [],
          L,
          P,
          rowInfo,
          iter + 1,
          { sparseRows, numParams },
        );
        ctx.solveTiming.matrixFactorizationMs += Date.now() - factorizationStartedAt;
        ctx.Qxx = iterationResult.qxx ?? null;
        const { correction, sumBefore, sumAfter, maxBefore, maxAfter } = iterationResult;
        const objectiveDeltaWithinIter = Math.abs(sumBefore - sumAfter);
        const objectiveDeltaBetweenIterations =
          prevObjectiveBefore == null
            ? Number.POSITIVE_INFINITY
            : Math.abs(sumBefore - prevObjectiveBefore);
        const objectiveDeltaRelative =
          prevObjectiveBefore == null
            ? Number.POSITIVE_INFINITY
            : objectiveDeltaBetweenIterations / Math.max(Math.abs(prevObjectiveBefore), 1);

        if (ctx.debug) {
          const ratio = sumBefore > 0 ? sumAfter / sumBefore : 0;
          const msg =
            `Iter ${iter + 1} step check: ` +
            `weightedV0=${sumBefore.toExponential(3)} ` +
            `weightedV1=${sumAfter.toExponential(3)} ` +
            `ratio=${ratio.toFixed(3)} ` +
            `max|w|=${maxBefore.toExponential(3)} ` +
            `max|wnew|=${maxAfter.toExponential(3)}`;
          ctx.logs.push(msg);
          if (ratio > 1.05) {
            ctx.logs.push(
              `Warning: Iter ${iter + 1} predicted residuals increased. ` +
                `Check sign convention and angle/zenith units (radians vs degrees).`,
            );
          }
        }

        if (ctx.preanalysisMode) {
          ctx.converged = true;
          ctx.log(`Iter ${iter + 1}: Max Corr = 0.0000`);
          ctx.log(
            `Iter ${iter + 1}: preanalysis geometry held at approximate coordinates; covariance assembled from the current planning geometry.`,
          );
          ctx.log(
            'Converged: preanalysis uses the approximate-geometry covariance build without iterative coordinate updates.',
          );
          ctx.emitSolveProgress('iteration');
          break;
        }

        const maxCorrection = applyAdjustmentCorrections(
          ctx.stations,
          ctx.paramIndex,
          ctx.is2D,
          ctx.directionOrientations,
          dirParamMap,
          correction,
        );

        ctx.log(`Iter ${iter + 1}: Max Corr = ${maxCorrection.toFixed(4)}`);
        ctx.log(
          `Iter ${iter + 1}: vTPv before=${sumBefore.toExponential(6)} after=${sumAfter.toExponential(
            6,
          )} delta(within)=${objectiveDeltaWithinIter.toExponential(6)} delta(iter)=${objectiveDeltaBetweenIterations.toExponential(6)} delta(rel)=${objectiveDeltaRelative.toExponential(6)}`,
        );
        if (prevObjectiveBefore != null && objectiveDeltaRelative < ctx.convergenceThreshold) {
          ctx.log(
            `Converged: relative iteration objective delta ${objectiveDeltaRelative.toExponential(6)} < limit ${ctx.convergenceThreshold.toExponential(6)}`,
          );
          ctx.converged = true;
          ctx.emitSolveProgress('iteration');
          break;
        }
        prevObjectiveBefore = sumBefore;
        ctx.emitSolveProgress('iteration');
      } catch (error) {
        ctx.solveTiming.matrixFactorizationMs += Date.now() - factorizationStartedAt;
        const detail = error instanceof Error ? ` ${error.message}` : '';
        ctx.log(`Normal equation solve failed (singular or otherwise unstable).${detail}`);
        const diagnosticsStartedAt = Date.now();
        ctx.calculateStatistics(ctx.paramIndex, false, activeObservations);
        ctx.solveTiming.precisionAndDiagnosticsMs += Date.now() - diagnosticsStartedAt;
        return ctx.finishSolve(ctx.buildResult());
      }
    }

    if (!ctx.converged) ctx.log('Warning: Max iterations reached.');
    const covarianceStartedAt = Date.now();
    ctx.Qxx = ctx.recoverFinalNormalCovariance(
      activeObservations,
      constraints,
      numObsEquations,
      numParams,
      dirParamMap,
    );
    ctx.solveTiming.matrixFactorizationMs += Date.now() - covarianceStartedAt;
    const diagnosticsStartedAt = Date.now();
    ctx.calculateStatistics(ctx.paramIndex, !!ctx.Qxx, activeObservations);
    ctx.solveTiming.precisionAndDiagnosticsMs += Date.now() - diagnosticsStartedAt;
    return ctx.finishSolve(ctx.buildResult());
};

