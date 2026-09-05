import { cloneParsedResultValue } from './adjustTypes';
import { parseInput } from './parse';
import { runClusterDualPassWorkflow } from './adjustmentClusterWorkflow';
import { applyAutoDroppedHeightHolds, buildSolvePreparation, cloneSolvePreparationResult } from './adjustmentPreprocessing';
import { assembleAdjustmentEquations } from './adjustmentEquationAssembly';
import { applyAdjustmentCorrections, solveAdjustmentIteration } from './adjustmentIteration';
import { getObservationSideshotCalcMeta } from './observationMetadata';
import { resolveRunModeCompatibilityOptions } from './adjustmentRunModeCompatibility';
import { loadAndApplySolveWorkflowGeoidModel } from './adjustSolveWorkflowGeoid';
import { runSolveWorkflowLoopDiagnostics } from './adjustSolveWorkflowLoopDiagnostics';
import { applySolveWorkflowObservationOverrides } from './adjustSolveWorkflowOverrides';
import {
  logSolveWorkflowAdjustmentOptions,
  prepareSolveWorkflowActiveObservations,
  runLevelingOnlyBlunderDetectGate,
  runSolveWorkflowDatumGates,
} from './adjustSolveWorkflowPreflight';
import { resetSolveWorkflowRuntimeState } from './adjustSolveWorkflowRuntime';
import { applyParsedSolveWorkflowSettings } from './adjustSolveWorkflowSettings';
import type {
  AdjustmentResult,
  Observation,
  RunMode,
} from '../types';

export type AdjustmentSolveWorkflowContext = Record<string, any>;

export const runAdjustmentSolveWorkflow = (
  ctx: AdjustmentSolveWorkflowContext,
): AdjustmentResult => {
    ctx.solveStartedAt = Date.now();
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
    const gpsLoopCheckEnabled = applyParsedSolveWorkflowSettings(ctx, parsed);
    resetSolveWorkflowRuntimeState(ctx);

    if ((ctx.directionRejectDiagnostics?.length ?? 0) > 0) {
      ctx.log(`Direction rejects captured: ${ctx.directionRejectDiagnostics?.length}`);
    }

    if (ctx.mapMode !== 'off') {
      ctx.log(
        `Map reduction active: mode=${ctx.mapMode}, scale=${ctx.mapScaleFactor.toFixed(8)}`,
      );
    }
    loadAndApplySolveWorkflowGeoidModel(ctx);
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
    logSolveWorkflowAdjustmentOptions(ctx);

    applySolveWorkflowObservationOverrides(ctx);
    const activeObservations = prepareSolveWorkflowActiveObservations(ctx);
    if (runLevelingOnlyBlunderDetectGate(ctx, activeObservations)) {
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
    if (runSolveWorkflowDatumGates(ctx, activeObservations)) {
      finishParseAndSetupTiming();
      return ctx.finishSolve(ctx.buildResult());
    }
    runSolveWorkflowLoopDiagnostics(ctx, activeObservations, gpsLoopCheckEnabled);

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
    const useSparseCorrectionWeights = ctx.sparseCorrectionSolver != null;

    for (let iter = 0; iter < ctx.maxIterations; iter++) {
      ctx.iterations += 1;
      ctx.clearGeometryCache();
      const assemblyStartedAt = Date.now();
      const { A, L, P, rowInfo, sparseRows, structuredWeights } = assembleAdjustmentEquations(
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
          applyTsCorrelationToWeightWriter: useSparseCorrectionWeights
            ? ctx.applyTsCorrelationToWeightWriter.bind(ctx)
            : undefined,
          logObsDebug: ctx.logObsDebug.bind(ctx),
        },
        activeObservations,
        constraints,
        numObsEquations,
        numParams,
        iter + 1,
        useSparseCorrectionWeights
          ? { includeDenseA: false, weightRepresentation: 'sparse', omitDenseP: true }
          : { includeDenseA: false },
      );
      ctx.solveTiming.equationAssemblyMs += Date.now() - assemblyStartedAt;

      const factorizationStartedAt = Date.now();
      try {
        const iterationDependencies = {
          robustMode: ctx.robustMode,
          sparseCorrectionSolver: ctx.sparseCorrectionSolver,
          solveNormalEquations: ctx.solveNormalEquations.bind(ctx),
          estimateCondition: ctx.estimateCondition.bind(ctx),
          recordConditionEstimate: ctx.recordConditionEstimate.bind(ctx),
          captureRobustWeightBase: ctx.captureRobustWeightBase.bind(ctx),
          applyRobustWeightFactors: ctx.applyRobustWeightFactors.bind(ctx),
          captureRobustWeightBaseFromStructured: ctx.captureRobustWeightBaseFromStructured?.bind(ctx),
          applyRobustWeightFactorsToStructured: ctx.applyRobustWeightFactorsToStructured?.bind(ctx),
          computeRobustWeightSummary: ctx.computeRobustWeightSummary.bind(ctx),
          maxRobustWeightDelta: ctx.maxRobustWeightDelta.bind(ctx),
          recordRobustDiagnostics: ctx.recordRobustDiagnostics.bind(ctx),
          weightedQuadratic: ctx.weightedQuadratic.bind(ctx),
        };
        let iterationResult: ReturnType<typeof solveAdjustmentIteration>;
        try {
          iterationResult = solveAdjustmentIteration(
            iterationDependencies,
            A ?? [],
            L,
            P,
            rowInfo,
            iter + 1,
            {
              sparseRows,
              numParams,
              structuredWeights: useSparseCorrectionWeights ? structuredWeights : undefined,
            },
          );
        } catch (sparseError) {
          if (!useSparseCorrectionWeights) throw sparseError;
          const sparseDetail = sparseError instanceof Error ? ` ${sparseError.message}` : '';
          ctx.log(
            `Warning: sparse correction solve failed at iteration ${iter + 1}; retrying with dense weights.${sparseDetail}`,
          );
          const denseAssembly = assembleAdjustmentEquations(
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
          iterationResult = solveAdjustmentIteration(
            { ...iterationDependencies, sparseCorrectionSolver: undefined },
            denseAssembly.A ?? [],
            denseAssembly.L,
            denseAssembly.P,
            denseAssembly.rowInfo,
            iter + 1,
            { sparseRows: denseAssembly.sparseRows, numParams },
          );
        }
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

