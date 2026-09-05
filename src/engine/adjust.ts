import { type EngineOptions } from './adjustTypes';
import {
  getCachedParsedModel,
  getCachedSolvePreparation,
  recordScenarioSolve,
} from './scenarioParsedModelCache';
import {
  augmentCovarianceObservations as augmentCovarianceObservationsHelper,
  invertNormalMatrixForStats as invertNormalMatrixForStatsHelper,
  solveNormalEquations as solveNormalEquationsHelper,
} from './adjustNormalEquationHelpers';
import {
  calculateAdjustmentStatistics,
  type AdjustmentStatisticsContext,
} from './adjustStatistics';
import { buildStatisticsContextForEngine } from './adjustStatisticsContext';
import {
  applyDataCheckProvisionalApproximation as applyDataCheckProvisionalApproximationHelper,
  runDataCheckOnly as runDataCheckOnlyHelper,
} from './adjustDataCheckWorkflow';
import {
  buildDataCheckContextForEngine,
  syncDataCheckContextForEngine,
} from './adjustDataCheckContext';
import {
  runAdjustmentSolveWorkflow,
  type AdjustmentSolveWorkflowContext,
} from './adjustSolveWorkflow';
import {
  buildAdjustmentResultFromContext,
  type AdjustmentResultWorkflowContext,
} from './adjustResultWorkflow';
import {
  runAutoAdjustWorkflow as runAutoAdjustWorkflowHelper,
  runBlunderDetectWorkflow as runBlunderDetectWorkflowHelper,
} from './adjustRunModeWorkflows';
import { recoverFinalNormalCovariance as recoverFinalNormalCovarianceHelper } from './adjustCovarianceRecovery';
import { LSAEngineObservationMethods } from './adjustEngineObservationMethods';
import { buildSideshotResults } from './adjustmentSideshots';
import type { CoordinateConstraintEquation } from './adjustmentSolveTypes';
import type { ScenarioRunRequest } from './scenarioRunModels';
import type {
  AdjustmentResult,
  Observation,
  StationId,
  ObservationOverride,
  ParseOptions,
  RunModeCompatibilityDiagnostic,
} from '../types';

export class LSAEngine extends LSAEngineObservationMethods {
  private normalEquationSolver?: EngineOptions['normalEquationSolver'];

  private solveNormalEquations(
    N: number[][],
    U: number[][],
    options?: { recoverCovariance?: boolean },
  ): { correction: number[][]; qxx?: number[][] } {
    if (this.normalEquationSolver && !options?.recoverCovariance) {
      const result = this.normalEquationSolver.solveCorrection(N, U);
      if (result.damping > 0) {
        this.log(
          `Warning: normal-equation factorization required diagonal damping (lambda=${result.damping.toExponential(3)}, attempts=${result.dampingAttempts}).`,
        );
      }
      return { correction: result.correction };
    }
    return solveNormalEquationsHelper(N, U, {
      log: this.log.bind(this),
      recoverCovariance: options?.recoverCovariance,
    });
  }

  private recoverFinalNormalCovariance(
    activeObservations: Observation[],
    constraints: CoordinateConstraintEquation[],
    numObsEquations: number,
    numParams: number,
    dirParamMap: Record<string, number>,
  ): number[][] | null {
    return recoverFinalNormalCovarianceHelper({
      activeObservations,
      augmentCovarianceObservations: (observations) =>
        this.augmentCovarianceObservations(observations),
      clearGeometryCache: () => this.clearGeometryCache(),
      constraints,
      correctedDistanceModel: this.correctedDistanceModel.bind(this),
      curvatureRefractionAngle: this.curvatureRefractionAngle.bind(this),
      debug: false,
      directionOrientations: this.directionOrientations,
      dirParamMap,
      effectiveStdDev: this.effectiveStdDev.bind(this),
      getAzimuth: this.getAzimuth.bind(this),
      getModeledZenith: this.getModeledZenith.bind(this),
      getObservedHorizontalDistanceIn2D: this.getObservedHorizontalDistanceIn2D.bind(this),
      gpsModeledVector: this.gpsModeledVector.bind(this),
      gpsModeledVectorDerivatives: this.gpsModeledVectorDerivatives.bind(this),
      gpsObservedVector: this.gpsObservedVector.bind(this),
      gpsWeight: this.gpsWeight.bind(this),
      invertNormalMatrixForStats: this.invertNormalMatrixForStats.bind(this),
      is2D: this.is2D,
      measuredAngleCorrection: this.measuredAngleCorrection.bind(this),
      modeledAzimuth: this.modeledAzimuth.bind(this),
      numObsEquations,
      numParams,
      paramIndex: this.paramIndex,
      projectWeakFloatZenithLeafStationsForDisplay: (options) =>
        this.projectWeakFloatZenithLeafStationsForDisplay(options),
      applyTsCorrelationToWeightMatrix: this.applyTsCorrelationToWeightMatrix.bind(this),
      stations: this.stations,
      wrapToPi: this.wrapToPi.bind(this),
    });
  }

  private augmentCovarianceObservations(activeObservations: Observation[]): Observation[] {
    return augmentCovarianceObservationsHelper(activeObservations, {
      is2D: this.is2D,
      log: this.log.bind(this),
    });
  }

  private invertNormalMatrixForStats(N: number[][]): number[][] {
    return invertNormalMatrixForStatsHelper(N, this.log.bind(this));
  }

  constructor({
    input,
    maxIterations = 10,
    instrumentLibrary = {},
    convergenceThreshold = 0.01,
    excludeIds,
    overrides,
    options,
    parseOptions,
    geoidSourceData,
    parsedResult,
    solvePreparation,
    progressCallback,
    normalEquationSolver,
  }: EngineOptions) {
    super();
    this.normalEquationSolver = normalEquationSolver;
    this.input = input;
    this.maxIterations = maxIterations;
    this.instrumentLibrary = { ...instrumentLibrary };
    this.convergenceThreshold =
      Number.isFinite(convergenceThreshold) && convergenceThreshold > 0
        ? convergenceThreshold
        : 0.01;
    this.excludeIds = excludeIds;
    this.overrides = overrides;
    this.parseOptions = parseOptions ?? options;
    this.geoidSourceData =
      geoidSourceData instanceof Uint8Array
        ? geoidSourceData
        : geoidSourceData instanceof ArrayBuffer
          ? new Uint8Array(geoidSourceData)
          : undefined;
    this.parsedResult = parsedResult;
    this.solvePreparation = solvePreparation;
    this.progressCallback = progressCallback;
  }

  private solveNestedScenario(
    parseOptions: Partial<ParseOptions>,
    overrides: Record<number, ObservationOverride> | undefined,
    excludeIds = this.excludeIds,
  ): AdjustmentResult {
    const request: ScenarioRunRequest = {
      input: this.input,
      maxIterations: this.maxIterations,
      convergenceThreshold: this.convergenceThreshold,
      instrumentLibrary: this.instrumentLibrary,
      excludeIds,
      overrides,
      parseOptions,
      geoidSourceData: this.geoidSourceData,
    };
    recordScenarioSolve();
    const parsedResult = getCachedParsedModel(request);
    return new LSAEngine({
      input: request.input,
      maxIterations: request.maxIterations,
      instrumentLibrary: request.instrumentLibrary,
      convergenceThreshold: request.convergenceThreshold,
      excludeIds: request.excludeIds,
      overrides: request.overrides,
      parseOptions: request.parseOptions,
      geoidSourceData: request.geoidSourceData,
      parsedResult,
      solvePreparation: getCachedSolvePreparation(request, parsedResult),
      progressCallback: request.progressCallback,
      normalEquationSolver: this.normalEquationSolver,
    }).solve();
  }

  private computeSideshotResults(): AdjustmentResult['sideshots'] {
    return buildSideshotResults({
      observations: this.observations,
      stations: this.stations,
      parseState: this.parseState,
      coordSystemMode: this.coordSystemMode,
      scaleOverrideActive: this.scaleOverrideActive,
      averageScaleFactor: this.averageScaleFactor,
      crsGridScaleEnabled: this.crsGridScaleEnabled,
      crsGridScaleFactor: this.crsGridScaleFactor,
      effectiveStdDev: this.effectiveStdDev.bind(this),
      prismCorrectionForObservation: this.prismCorrectionForObservation.bind(this),
      curvatureRefractionAngle: this.curvatureRefractionAngle.bind(this),
      mapDistanceScaleForObservation: this.mapDistanceScaleForObservation.bind(this),
      stationFactorSnapshot: this.stationFactorSnapshot.bind(this),
      getAzimuth: this.getAzimuth.bind(this),
      gpsObservedVector: this.gpsObservedVector.bind(this),
      gpsCovariance: this.gpsCovariance.bind(this),
      gpsRoverOffsetVector: this.gpsRoverOffsetVector.bind(this),
      modeledAzimuth: this.modeledAzimuth.bind(this),
    });
  }

  private redundancyScalar(obs: Observation): number | undefined {
    const normalize = (value: number | undefined): number | undefined => {
      if (!Number.isFinite(value)) return undefined;
      if (value! < -1e-9 || value! > 1 + 1e-9) return undefined;
      return Math.max(0, Math.min(1, value!));
    };

    if (typeof obs.redundancy === 'number') {
      return normalize(obs.redundancy);
    }
    if (obs.redundancy && typeof obs.redundancy === 'object') {
      const rE = normalize(obs.redundancy.rE);
      const rN = normalize(obs.redundancy.rN);
      if (rE != null && rN != null) return Math.min(rE, rN);
    }
    return undefined;
  }

  private buildDataCheckContext() {
    return buildDataCheckContextForEngine(this);
  }

  private syncDataCheckContext(ctx: ReturnType<LSAEngine['buildDataCheckContext']>): void {
    syncDataCheckContextForEngine(this, ctx);
  }

  private applyDataCheckProvisionalApproximation(): {
    attempted: boolean;
    updatedStationCount: number;
    iterations: number;
    converged: boolean;
    directionCalcByObsId: Map<number, number>;
  } {
    const ctx = this.buildDataCheckContext();
    const result = applyDataCheckProvisionalApproximationHelper(ctx);
    this.syncDataCheckContext(ctx);
    return result;
  }

  private runDataCheckOnly(activeObservations: Observation[]): AdjustmentResult {
    const ctx = this.buildDataCheckContext();
    const result = runDataCheckOnlyHelper(ctx, activeObservations);
    this.syncDataCheckContext(ctx);
    return result;
  }

  private runBlunderDetectWorkflow(
    runModeDiagnostics: RunModeCompatibilityDiagnostic[],
  ): AdjustmentResult {
    return runBlunderDetectWorkflowHelper(this as never, runModeDiagnostics);
  }

  private runAutoAdjustWorkflow(): AdjustmentResult {
    return runAutoAdjustWorkflowHelper(this as never);
  }

  solve(): AdjustmentResult {
    return runAdjustmentSolveWorkflow(this as unknown as AdjustmentSolveWorkflowContext);
  }

  private estimateCondition(N: number[][]): number {
    // crude condition estimate via row/col norm product to avoid expensive SVD
    const n = N.length;
    if (!n) return 0;
    let rowMax = 0;
    let colMax = 0;
    for (let i = 0; i < n; i++) {
      let rsum = 0;
      let csum = 0;
      for (let j = 0; j < n; j++) {
        rsum += Math.abs(N[i][j]);
        csum += Math.abs(N[j][i]);
      }
      rowMax = Math.max(rowMax, rsum);
      colMax = Math.max(colMax, csum);
    }
    return rowMax * colMax;
  }

  private recordConditionEstimate(conditionEstimate: number): void {
    this.condition = {
      estimate: conditionEstimate,
      threshold: this.maxCondition,
      flagged: conditionEstimate > this.maxCondition,
    };
    if (conditionEstimate > this.maxCondition && !this.conditionWarned) {
      this.log(
        `Warning: normal matrix appears ill-conditioned (estimate=${conditionEstimate.toExponential(
          3,
        )}, threshold=${this.maxCondition.toExponential(3)}).`,
      );
      this.conditionWarned = true;
    }
  }

  private buildStatisticsContext(): AdjustmentStatisticsContext {
    return buildStatisticsContextForEngine(this);
  }

  private calculateStatistics(
    paramIndex: Record<StationId, { x?: number; y?: number; h?: number }>,
    hasQxx: boolean,
    activeObservationsInput?: Observation[],
  ) {
    const statsContext = this.buildStatisticsContext();
    calculateAdjustmentStatistics(statsContext, paramIndex, hasQxx, activeObservationsInput);
    this.seuw = statsContext.seuw;
    this.chiSquare = statsContext.chiSquare;
    this.statisticalSummary = statsContext.statisticalSummary;
    this.typeSummary = statsContext.typeSummary;
    this.directionSetDiagnostics = statsContext.directionSetDiagnostics;
    this.directionTargetDiagnostics = statsContext.directionTargetDiagnostics;
    this.directionRepeatabilityDiagnostics = statsContext.directionRepeatabilityDiagnostics;
    this.setupDiagnostics = statsContext.setupDiagnostics;
    this.residualDiagnostics = statsContext.residualDiagnostics;
    this.traverseDiagnostics = statsContext.traverseDiagnostics;
    this.autoSideshotDiagnostics = statsContext.autoSideshotDiagnostics;
    this.tsCorrelationDiagnostics = statsContext.tsCorrelationDiagnostics;
    this.precisionModels = statsContext.precisionModels;
    this.stationCovariances = statsContext.stationCovariances;
    this.relativePrecision = statsContext.relativePrecision;
    this.relativeCovariances = statsContext.relativeCovariances;
    this.weakGeometryDiagnostics = statsContext.weakGeometryDiagnostics;
    this.sideshots = statsContext.sideshots;
  }

  private buildResult(): AdjustmentResult {
    return buildAdjustmentResultFromContext(this as unknown as AdjustmentResultWorkflowContext);
  }
}
