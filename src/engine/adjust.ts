import { RAD_TO_DEG, DEG_TO_RAD } from './angles';
import {
  DATA_CHECK_PROVISIONAL_DIRECTION_TRUST_MAX_RAD,
  EARTH_RADIUS_M,
  EPS,
  GPS_ADDHIHT_SCALE_TOL,
  GPS_LOOP_BASE_TOLERANCE_M,
  GPS_LOOP_TOLERANCE_PPM,
  LEVEL_LOOP_DEFAULT_BASE_MM,
  LEVEL_LOOP_DEFAULT_PER_SQRT_KM_MM,
} from './adjustConstants';
import {
  type BootstrapDirectionSet,
  type BootstrapPairMetrics,
  type EngineOptions,
  type GpsCovariance,
  type GpsSolveVector,
  type GpsVectorComponents,
  type GpsVectorDerivatives,
} from './adjustTypes';
import { interpolateGeoidUndulation } from './geoid';
import {
  computeElevationFactor,
  computeGridFactors,
  inverseENToGeodetic,
} from './geodesy';
import { getCrsDefinition, isGeodeticInsideAreaOfUse } from './crsCatalog';
import type { GeoidGridModel } from './geoid';
import {
  accumulateNormalEquationsFromSparseRows,
  zeros,
} from './matrix';
import {
  getCachedParsedModel,
  getCachedSolvePreparation,
  recordScenarioSolve,
} from './scenarioParsedModelCache';
import { assembleAdjustmentEquations } from './adjustmentEquationAssembly';
import {
  applyGpsVerticalDeflection as applyGpsVerticalDeflectionHelper,
  buildGpsDisplayResidualTransform,
  gpsRoverOffsetVector as gpsRoverOffsetVectorHelper,
  gpsUsesLocalSolveFrame as gpsUsesLocalSolveFrameHelper,
  plannedGpsRawVector as plannedGpsRawVectorHelper,
  transformGpsCovarianceToSolveFrame as transformGpsCovarianceToSolveFrameHelper,
} from './adjustGpsVectorHelpers';
import {
  captureInitialSigmaGeometrySnapshot as captureInitialSigmaGeometrySnapshotHelper,
  effectiveStdDev as effectiveStdDevHelper,
  getSigmaGeometryAzimuth as getSigmaGeometryAzimuthHelper,
  getSigmaGeometryZenith as getSigmaGeometryZenithHelper,
  shouldApplyIndustryParityAngularSigmaCalibration as shouldApplyIndustryParityAngularSigmaCalibrationHelper,
} from './adjustObservationWeighting';
import {
  augmentCovarianceObservations as augmentCovarianceObservationsHelper,
  invertNormalMatrixForStats as invertNormalMatrixForStatsHelper,
  solveNormalEquations as solveNormalEquationsHelper,
} from './adjustNormalEquationHelpers';
import {
  applyRobustWeightFactors as applyRobustWeightFactorsHelper,
  captureRobustWeightBase as captureRobustWeightBaseHelper,
  computeRobustWeightSummary as computeRobustWeightSummaryHelper,
  maxRobustWeightDelta as maxRobustWeightDeltaHelper,
  recordRobustDiagnostics as recordRobustDiagnosticsHelper,
  observationStations as observationStationsHelper,
  robustCorrelationRowGroups as robustCorrelationRowGroupsHelper,
  weightedQuadratic as weightedQuadraticHelper,
} from './adjustRobustWeights';
import {
  computeDirectionSetPrefit as computeDirectionSetPrefitHelper,
  logNetworkDiagnostics as logNetworkDiagnosticsHelper,
} from './adjustNetworkDiagnostics';
import {
  applyAverageGeoidHeightConversions as applyAverageGeoidHeightConversionsHelper,
  applyGeoidHeightConversions as applyGeoidHeightConversionsHelper,
  resolveStationEllipsoidHeight as resolveStationEllipsoidHeightHelper,
} from './adjustGeoidHeightHelpers';
import {
  evaluateDatumSufficiency as evaluateDatumSufficiencyHelper,
  evaluateGridInputGate as evaluateGridInputGateHelper,
} from './adjustDatumChecks';
import {
  applyBootstrapApproxStation as applyBootstrapApproxStationHelper,
  bootstrapApproximateTraverseCoords as bootstrapApproximateTraverseCoordsHelper,
  buildBootstrapPairMetrics as buildBootstrapPairMetricsHelper,
  estimateBootstrapSetOrientation as estimateBootstrapSetOrientationHelper,
  stationHasBootstrapableApprox as stationHasBootstrapableApproxHelper,
  tryBootstrapDirectionSetOccupy as tryBootstrapDirectionSetOccupyHelper,
} from './adjustBootstrapHelpers';
import {
  captureObservationWeightingStdDevs as captureObservationWeightingStdDevsHelper,
  gpsCovariance as gpsCovarianceHelper,
  gpsModeledVector as gpsModeledVectorHelper,
  gpsModeledVectorDerivatives as gpsModeledVectorDerivativesHelper,
  gpsModeledVectorFromStationValues as gpsModeledVectorFromStationValuesHelper,
  gpsObservedVector as gpsObservedVectorHelper,
  gpsWeight as gpsWeightHelper,
  updateGpsAddHiHtDiagnostics as updateGpsAddHiHtDiagnosticsHelper,
} from './adjustGpsObservationModel';
import {
  captureRawTraverseDirectionCorrections as captureRawTraverseDirectionCorrectionsHelper,
  captureRawTraverseDistanceFactorSnapshots as captureRawTraverseDistanceFactorSnapshotsHelper,
  correctedDistanceModel as correctedDistanceModelHelper,
  crsDistanceScaleForObservation as crsDistanceScaleForObservationHelper,
  curvatureRefractionAngle as curvatureRefractionAngleHelper,
  effectiveDistanceForAngularObservation as effectiveDistanceForAngularObservationHelper,
  getModeledZenith as getModeledZenithHelper,
  getZenith as getZenithHelper,
  mapDistanceScaleForObservation as mapDistanceScaleForObservationHelper,
  measuredAngleCorrection as measuredAngleCorrectionHelper,
  modeledAzimuth as modeledAzimuthHelper,
  prismCorrectionForObservation as prismCorrectionForObservationHelper,
  rawDirectionSetCorrection as rawDirectionSetCorrectionHelper,
  rawDistanceCombinedFactor as rawDistanceCombinedFactorHelper,
  zenithScaleForObservation as zenithScaleForObservationHelper,
} from './adjustReductionHelpers';
import {
  collectActiveObservationsForSolve,
  isObservationActiveForSolve,
} from './adjustmentPreprocessing';
import type { SolvePreparationResult } from './adjustmentPreprocessing';
import {
  applyTsCorrelationToWeightMatrix as applyTsCorrelationToWeightMatrixHelper,
  tsCorrelationGroup as tsCorrelationGroupHelper,
} from './adjustTsCorrelationWeights';
import {
  buildSolveProgressEvent,
  buildSolveTimingProfile as buildSolveTimingProfileHelper,
  createEmptySolveTiming,
  formatSolveTimingLogLine,
} from './adjustSolveTiming';
import { addUniqueCoordSystemWarning } from './adjustCoordSystemDiagnostics';
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
import {
  projectWeakFloatZenithLeafStationsForDisplay as projectWeakFloatZenithLeafStations,
} from './adjustmentWeakFloatZenithProjection';
import { runModeCompatibilityDiagnosticLines } from './adjustmentRunModeCompatibility';
import { buildSideshotResults } from './adjustmentSideshots';
import type { CoordinateConstraintEquation } from './adjustmentSolveTypes';
import type {
  EquationRowInfo,
  RobustWeightMatrixBase,
  RobustWeightSummary,
  SolveParameterIndex,
} from './adjustmentSolveTypes';
import type { ScenarioRunRequest, SolveProgressEvent } from './scenarioRunModels';
import type {
  AdjustmentResult,
  DatumSufficiencyReport,
  DirectionRejectDiagnostic,
  DistanceObservation,
  GpsObservation,
  LevelObservation,
  Observation,
  Station,
  StationId,
  StationMap,
  ZenithObservation,
  InstrumentLibrary,
  Instrument,
  ObservationOverride,
  ParseOptions,
  ParseResult,
  CoordSystemDiagnosticCode,
  CoordInputClass,
  CrsOffReason,
  CrsStatus,
  FactorComputationMethod,
  GnssVectorFrame,
  RunMode,
  RunModeCompatibilityDiagnostic,
  SigmaSource,
} from '../types';

export class LSAEngine {
  input: string;
  stations: StationMap = {};
  observations: Observation[] = [];
  unknowns: StationId[] = [];
  iterations = 0;
  maxIterations: number;
  convergenceThreshold: number;
  dof = 0;
  seuw = 0;
  logs: string[] = [];
  converged = false;
  instrumentLibrary: InstrumentLibrary;
  private Qxx: number[][] | null = null;
  private excludeIds?: Set<number>;
  private overrides?: Record<number, ObservationOverride>;
  private parsedResult?: ParseResult;
  private solvePreparation?: SolvePreparationResult;
  private maxCondition = 1e12;
  private maxStdRes = 10;
  private localTestCritical = 3.29;
  private traverseThresholds = {
    minClosureRatio: 5000,
    maxLinearPpm: 200,
    maxAngularArcSec: 30,
    maxVerticalMisclosure: 0.03,
  };
  private parseOptions?: Partial<ParseOptions>;
  private coordMode: ParseOptions['coordMode'] = '3D';
  private is2D = false;
  private directionOrientations: Record<string, number> = {};
  private paramIndex: SolveParameterIndex = {};
  private addCenteringToExplicit = false;
  private applyCentering = true;
  private debug = false;
  private mapMode: ParseOptions['mapMode'] = 'off';
  private mapScaleFactor = 1;
  private coordSystemMode: ParseOptions['coordSystemMode'] = 'local';
  private crsId = 'CA_NAD83_CSRS_UTM_20N';
  private localDatumScheme: ParseOptions['localDatumScheme'] = 'average-scale';
  private averageScaleFactor = 1;
  private scaleOverrideActive = false;
  private commonElevation = 0;
  private averageGeoidHeight = 0;
  private crsGridScaleEnabled = false;
  private crsGridScaleFactor = 1;
  private crsConvergenceEnabled = false;
  private crsConvergenceAngleRad = 0;
  private geoidModelEnabled = false;
  private geoidModelId = 'NGS-DEMO';
  private geoidSourceFormat: ParseOptions['geoidSourceFormat'] = 'builtin';
  private geoidSourcePath = '';
  private geoidSourceData?: Uint8Array;
  private geoidInterpolation: ParseOptions['geoidInterpolation'] = 'bilinear';
  private geoidHeightConversionEnabled = false;
  private geoidOutputHeightDatum: ParseOptions['geoidOutputHeightDatum'] = 'orthometric';
  private activeGeoidModel: GeoidGridModel | null = null;
  private applyCurvatureRefraction = false;
  private refractionCoefficient = 0.13;
  private verticalReduction: ParseOptions['verticalReduction'] = 'none';
  private tsCorrelationEnabled = false;
  private tsCorrelationRho = 0.25;
  private tsCorrelationScope: ParseOptions['tsCorrelationScope'] = 'set';
  private robustMode: ParseOptions['robustMode'] = 'none';
  private robustK = 1.5;
  private runMode: RunMode = 'adjustment';
  private preanalysisMode = false;
  private runModeCompatibilityDiagnostics: RunModeCompatibilityDiagnostic[] = [];
  private prismEnabled = false;
  private prismOffset = 0;
  private prismScope: ParseOptions['prismScope'] = 'global';
  private clusterDetectionEnabled = true;
  private clusterLinkageMode: ParseOptions['clusterLinkageMode'] = 'single';
  private clusterTolerance2D = 0.03;
  private clusterTolerance3D = 0.05;
  private levelLoopToleranceBaseMm = LEVEL_LOOP_DEFAULT_BASE_MM;
  private levelLoopTolerancePerSqrtKmMm = LEVEL_LOOP_DEFAULT_PER_SQRT_KM_MM;
  private chiSquare?: AdjustmentResult['chiSquare'];
  private statisticalSummary?: AdjustmentResult['statisticalSummary'];
  private typeSummary?: Record<
    string,
    {
      count: number;
      rms: number;
      maxAbs: number;
      maxStdRes: number;
      over3: number;
      over4: number;
      unit: string;
    }
  >;
  private relativePrecision?: AdjustmentResult['relativePrecision'];
  private stationCovariances?: AdjustmentResult['stationCovariances'];
  private relativeCovariances?: AdjustmentResult['relativeCovariances'];
  private precisionModels?: AdjustmentResult['precisionModels'];
  private weakGeometryDiagnostics?: AdjustmentResult['weakGeometryDiagnostics'];
  private directionSetDiagnostics?: AdjustmentResult['directionSetDiagnostics'];
  private directionTargetDiagnostics?: AdjustmentResult['directionTargetDiagnostics'];
  private directionRepeatabilityDiagnostics?: AdjustmentResult['directionRepeatabilityDiagnostics'];
  private directionRejectDiagnostics?: DirectionRejectDiagnostic[];
  private setupDiagnostics?: AdjustmentResult['setupDiagnostics'];
  private tsCorrelationDiagnostics?: AdjustmentResult['tsCorrelationDiagnostics'];
  private robustDiagnostics?: AdjustmentResult['robustDiagnostics'];
  private residualDiagnostics?: AdjustmentResult['residualDiagnostics'];
  private traverseDiagnostics?: AdjustmentResult['traverseDiagnostics'];
  private sideshots?: AdjustmentResult['sideshots'];
  private gpsLoopDiagnostics?: AdjustmentResult['gpsLoopDiagnostics'];
  private levelingLoopDiagnostics?: AdjustmentResult['levelingLoopDiagnostics'];
  private autoSideshotDiagnostics?: AdjustmentResult['autoSideshotDiagnostics'];
  private clusterDiagnostics?: AdjustmentResult['clusterDiagnostics'];
  private condition?: AdjustmentResult['condition'];
  private controlConstraints?: AdjustmentResult['controlConstraints'];
  private parseState?: ParseOptions;
  private conditionWarned = false;
  private stationFactorCache = new Map<
    string,
    {
      convergenceAngleRad: number;
      gridScaleFactor: number;
      elevationFactor: number;
      combinedFactor: number;
      source: 'projection-formula' | 'numerical-fallback';
      factorComputationMethod: FactorComputationMethod;
    }
  >();
  private coordSystemDiagnostics = new Set<CoordSystemDiagnosticCode>();
  private coordSystemWarningMessages: string[] = [];
  private coordWarningSeen = new Set<string>();
  private crsStatus: CrsStatus = 'off';
  private crsOffReason?: CrsOffReason = 'disabledByProfile';
  private gnssFrameConfirmed = false;
  private datumSufficiencyReport?: DatumSufficiencyReport;
  private crsDatumOpId = '';
  private crsDatumFallbackUsed = false;
  private crsAreaOfUseStatus: 'inside' | 'outside' | 'unknown' = 'unknown';
  private crsOutOfAreaStationCount = 0;
  private geometryDependentSigmaReference: 'current' | 'initial' = 'current';
  private initialSigmaGeometryStations: StationMap = {};
  private initialSigmaAzimuthCache = new Map<string, { az: number; dist: number }>();
  private initialSigmaZenithCache = new Map<
    string,
    { z: number; dist: number; horiz: number; dh: number; crCorr: number }
  >();
  private azimuthCache = new Map<string, { az: number; dist: number }>();
  private zenithCache = new Map<
    string,
    { z: number; dist: number; horiz: number; dh: number; crCorr: number }
  >();
  private progressCallback?: (_event: SolveProgressEvent) => void;
  private solveStartedAt = 0;
  private solveTiming = createEmptySolveTiming();
  private solveTimingLogged = false;

  private solveNormalEquations(
    N: number[][],
    U: number[][],
    options?: { recoverCovariance?: boolean },
  ): { correction: number[][]; qxx?: number[][] } {
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
    if (numParams <= 0 || numObsEquations <= 0) return null;
    const stationSnapshot = Object.fromEntries(
      Object.entries(this.stations).map(([stationId, station]) => [stationId, { ...station }]),
    ) as StationMap;
    this.projectWeakFloatZenithLeafStationsForDisplay({ log: false });
    const covarianceObservations = this.augmentCovarianceObservations(activeObservations);
    const covarianceObsEquationCount = numObsEquations + (covarianceObservations.length - activeObservations.length);
    try {
      this.clearGeometryCache();
      const { P, sparseRows } = assembleAdjustmentEquations(
        {
          stations: this.stations,
          paramIndex: this.paramIndex,
          is2D: this.is2D,
          debug: false,
          directionOrientations: this.directionOrientations,
          dirParamMap,
          effectiveStdDev: this.effectiveStdDev.bind(this),
          correctedDistanceModel: this.correctedDistanceModel.bind(this),
          getObservedHorizontalDistanceIn2D: this.getObservedHorizontalDistanceIn2D.bind(this),
          getAzimuth: this.getAzimuth.bind(this),
          measuredAngleCorrection: this.measuredAngleCorrection.bind(this),
          modeledAzimuth: this.modeledAzimuth.bind(this),
          wrapToPi: this.wrapToPi.bind(this),
          gpsObservedVector: this.gpsObservedVector.bind(this),
          gpsModeledVector: this.gpsModeledVector.bind(this),
          gpsModeledVectorDerivatives: this.gpsModeledVectorDerivatives.bind(this),
          gpsWeight: this.gpsWeight.bind(this),
          getModeledZenith: this.getModeledZenith.bind(this),
          curvatureRefractionAngle: this.curvatureRefractionAngle.bind(this),
          applyTsCorrelationToWeightMatrix: this.applyTsCorrelationToWeightMatrix.bind(this),
        },
        covarianceObservations,
        constraints,
        covarianceObsEquationCount,
        numParams,
        undefined,
        { includeDenseA: false },
      );
      const { normal } = accumulateNormalEquationsFromSparseRows(
        sparseRows,
        zeros(covarianceObsEquationCount, 1),
        P,
        numParams,
      );
      return this.invertNormalMatrixForStats(normal);
    } finally {
      Object.keys(stationSnapshot).forEach((stationId) => {
        this.stations[stationId] = { ...stationSnapshot[stationId] };
      });
      this.clearGeometryCache();
    }
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

  private getInstrument(obs: Observation): Instrument | undefined {
    if (!obs.instCode) return undefined;
    return this.instrumentLibrary[obs.instCode];
  }

  private findPairedVerticalObservation(
    obs: DistanceObservation,
  ): LevelObservation | Observation | undefined {
    return this.observations.find(
      (candidate) =>
        candidate.sourceLine === obs.sourceLine &&
        candidate.type === 'zenith' &&
        'from' in candidate &&
        'to' in candidate &&
        candidate.from === obs.from &&
        candidate.to === obs.to,
    );
  }

  private getObservedHorizontalDistanceIn2D(obs: DistanceObservation): {
    observedDistance: number;
    sigmaDistance: number;
    usedZenith: boolean;
  } {
    const sigmaDistance = this.effectiveStdDev(obs);
    if (!this.is2D || obs.mode !== 'slope') {
      return {
        observedDistance: obs.obs,
        sigmaDistance,
        usedZenith: false,
      };
    }
    const pairedVertical = this.findPairedVerticalObservation(obs);
    if (!pairedVertical || pairedVertical.type !== 'zenith') {
      return {
        observedDistance: obs.obs,
        sigmaDistance,
        usedZenith: false,
      };
    }
    const z = pairedVertical.obs;
    const sigmaZ = this.effectiveStdDev(pairedVertical);
    return {
      observedDistance: obs.obs * Math.sin(z),
      sigmaDistance: Math.sqrt(
        (Math.sin(z) * sigmaDistance) ** 2 + (obs.obs * Math.cos(z) * sigmaZ) ** 2,
      ),
      usedZenith: true,
    };
  }

  private defaultDistanceSigmaMeters(obs: Observation & { type: 'dist' }): number {
    const inst = this.getInstrument(obs);
    if (!inst) return 0;
    const geom = this.centeringLineGeometry(obs.from, obs.to, obs.hi ?? 0, obs.ht ?? 0);
    const modeledDistance = this.is2D ? geom.horiz : obs.mode === 'slope' ? geom.slope : geom.horiz;
    const ppmTerm = inst.edm_ppm * 1e-6 * modeledDistance;
    const edmMode = this.parseState?.edmMode ?? this.parseOptions?.edmMode ?? 'additive';
    if (edmMode === 'propagated') {
      return Math.sqrt(inst.edm_const * inst.edm_const + ppmTerm * ppmTerm);
    }
    return Math.abs(inst.edm_const) + Math.abs(ppmTerm);
  }

  private gpsRoverOffsetVector(obs: GpsObservation): {
    dE: number;
    dN: number;
    dH: number;
    horizDistance: number;
    applied: boolean;
  } {
    return gpsRoverOffsetVectorHelper(obs);
  }

  private plannedGpsRawVector(obs: GpsObservation): { dE: number; dN: number; dU?: number } {
    return plannedGpsRawVectorHelper({
      is2D: this.is2D,
      obs,
      stations: this.stations,
    });
  }

  private populatePreanalysisObservations(): void {
    let plannedCount = 0;
    this.observations.forEach((obs) => {
      if (!obs.planned) return;
      plannedCount += 1;
      if (obs.type === 'dist') {
        const geom = this.centeringLineGeometry(obs.from, obs.to, obs.hi ?? 0, obs.ht ?? 0);
        const rawDistance = this.is2D ? geom.horiz : obs.mode === 'slope' ? geom.slope : geom.horiz;
        obs.obs = this.correctedDistanceModel(obs, rawDistance).calcDistance;
        if (obs.sigmaSource === 'default') {
          obs.stdDev = this.defaultDistanceSigmaMeters(obs);
        }
        return;
      }
      if (obs.type === 'angle') {
        const azTo = this.getAzimuth(obs.at, obs.to).az;
        const azFrom = this.getAzimuth(obs.at, obs.from).az;
        let modeled = azTo - azFrom;
        if (modeled < 0) modeled += 2 * Math.PI;
        obs.obs = modeled;
        return;
      }
      if (obs.type === 'direction') {
        obs.obs = this.getAzimuth(obs.at, obs.to).az;
        return;
      }
      if (obs.type === 'bearing' || obs.type === 'dir') {
        obs.obs = this.modeledAzimuth(
          this.getAzimuth(obs.from, obs.to).az,
          obs.from,
          obs.gridObsMode !== 'grid',
        );
        return;
      }
      if (obs.type === 'zenith') {
        obs.obs = this.getModeledZenith(obs).z;
        return;
      }
      if (obs.type === 'lev') {
        const from = this.stations[obs.from];
        const to = this.stations[obs.to];
        if (!from || !to) return;
        obs.obs = to.h - from.h;
        return;
      }
      if (obs.type === 'gps') {
        obs.obs = this.plannedGpsRawVector(obs);
      }
    });
    if (this.parseState) {
      this.parseState.preanalysisMode = true;
      this.parseState.plannedObservationCount = plannedCount;
      this.parseState.robustMode = 'none';
      this.parseState.autoAdjustEnabled = false;
    }
    this.log(
      `Preanalysis mode: resolved ${plannedCount} planned observation(s) from approximate geometry; residual-based QC disabled.`,
    );
  }

  private centeringLineGeometry(
    fromID: StationId,
    toID: StationId,
    hi = 0,
    ht = 0,
  ): { horiz: number; slope: number; elev: number } {
    // Distance/zenith modeling must track the live station geometry.
    // The parity profile's "initial" geometry reference is only intended for
    // angular centering/sigma behavior, not for the core distance model.
    const geom = this.getZenith(fromID, toID, hi, ht);
    return {
      horiz: Math.max(geom.horiz, 0),
      slope: Math.max(geom.dist, 0),
      elev: geom.dh,
    };
  }

  private captureInitialSigmaGeometrySnapshot(): void {
    this.initialSigmaGeometryStations = captureInitialSigmaGeometrySnapshotHelper({
      azimuthCache: this.initialSigmaAzimuthCache,
      geometryDependentSigmaReference: this.geometryDependentSigmaReference,
      stations: this.stations,
      zenithCache: this.initialSigmaZenithCache,
    });
  }

  private getSigmaGeometryAzimuth(
    fromID: StationId,
    toID: StationId,
  ): { az: number; dist: number } {
    return getSigmaGeometryAzimuthHelper({
      cache: this.initialSigmaAzimuthCache,
      currentGeometryAzimuth: (fromId, toId) => this.getAzimuth(fromId, toId),
      fromID,
      geometryDependentSigmaReference: this.geometryDependentSigmaReference,
      initialSigmaGeometryStations: this.initialSigmaGeometryStations,
      toID,
    });
  }

  private getSigmaGeometryZenith(
    fromID: StationId,
    toID: StationId,
    hi = 0,
    ht = 0,
  ): { z: number; dist: number; horiz: number; dh: number; crCorr: number } {
    return getSigmaGeometryZenithHelper({
      cache: this.initialSigmaZenithCache,
      currentGeometryZenith: (fromId, toId, fromHi, toHt) =>
        this.getZenith(fromId, toId, fromHi, toHt),
      curvatureRefractionAngle: (horiz) => this.curvatureRefractionAngle(horiz),
      fromID,
      geometryDependentSigmaReference: this.geometryDependentSigmaReference,
      hi,
      ht,
      initialSigmaGeometryStations: this.initialSigmaGeometryStations,
      toID,
    });
  }

  private shouldApplyIndustryParityAngularSigmaCalibration(
    obs: Observation,
    source: SigmaSource,
  ): boolean {
    return shouldApplyIndustryParityAngularSigmaCalibrationHelper(
      obs,
      source,
      this.geometryDependentSigmaReference,
    );
  }

  private effectiveStdDev(obs: Observation): number {
    return effectiveStdDevHelper({
      addCenteringToExplicit: this.addCenteringToExplicit,
      applyCentering: this.applyCentering,
      centeringLineGeometry: (fromId, toId, hi, ht) =>
        this.centeringLineGeometry(fromId, toId, hi, ht),
      geometryDependentSigmaReference: this.geometryDependentSigmaReference,
      getSigmaGeometryAzimuth: (fromId, toId) => this.getSigmaGeometryAzimuth(fromId, toId),
      instrument: this.getInstrument(obs),
      is2D: this.is2D,
      obs,
      wrapToPi: (value) => this.wrapToPi(value),
    });
  }

  private gpsComponentCount(obs: GpsObservation): number {
    return !this.is2D && Number.isFinite(obs.obs.dU ?? Number.NaN) ? 3 : 2;
  }

  private gpsUsesLocalSolveFrame(frame: GnssVectorFrame): boolean {
    return gpsUsesLocalSolveFrameHelper(frame);
  }

  private stationGeodeticFromCoordinates(
    stationId: StationId,
    x: number,
    y: number,
  ): { latDeg: number; lonDeg: number } | null {
    const station = this.stations[stationId];
    if (!station) return null;
    const hasExplicitGeodeticInput = station.coordInputClass === 'geodetic';
    if (
      hasExplicitGeodeticInput &&
      Number.isFinite(station.latDeg ?? Number.NaN) &&
      Number.isFinite(station.lonDeg ?? Number.NaN)
    ) {
      return { latDeg: station.latDeg as number, lonDeg: station.lonDeg as number };
    }
    if (this.coordSystemMode !== 'grid') return null;
    const inv = inverseENToGeodetic({
      east: x,
      north: y,
      originLatDeg: this.parseState?.originLatDeg,
      originLonDeg: this.parseState?.originLonDeg,
      model: this.parseState?.crsProjectionModel ?? 'legacy-equirectangular',
      coordSystemMode: this.coordSystemMode,
      crsId: this.crsId,
    });
    return 'failureReason' in inv ? null : { latDeg: inv.latDeg, lonDeg: inv.lonDeg };
  }

  private stationEllipsoidHeightFromValues(
    station: Station,
    h: number,
    latDeg?: number,
    lonDeg?: number,
  ): number {
    if (station.heightType === 'ellipsoid') return h;
    if (this.activeGeoidModel && Number.isFinite(latDeg) && Number.isFinite(lonDeg)) {
      const undulation = interpolateGeoidUndulation(
        this.activeGeoidModel,
        latDeg as number,
        lonDeg as number,
        this.geoidInterpolation ?? 'bilinear',
      );
      if (Number.isFinite(undulation ?? Number.NaN)) {
        return h + (undulation as number);
      }
    }
    if (Number.isFinite(this.averageGeoidHeight) && Math.abs(this.averageGeoidHeight) > 0) {
      return h + this.averageGeoidHeight;
    }
    return h;
  }

  private applyGpsVerticalDeflection(
    vector: Required<Pick<GpsSolveVector, 'dE' | 'dN' | 'dU'>>,
  ): Required<Pick<GpsSolveVector, 'dE' | 'dN' | 'dU'>> {
    return applyGpsVerticalDeflectionHelper(
      vector,
      this.parseState?.verticalDeflectionNorthSec ?? 0,
      this.parseState?.verticalDeflectionEastSec ?? 0,
    );
  }

  private rotateGpsHorizontalToGrid(
    dE: number,
    dN: number,
    stationId: StationId,
  ): { dE: number; dN: number } {
    if (this.coordSystemMode !== 'grid') return { dE, dN };
    const convergence = this.stationFactorSnapshot(stationId).convergenceAngleRad;
    if (!Number.isFinite(convergence) || Math.abs(convergence) <= 1e-16) return { dE, dN };
    const cosGamma = Math.cos(convergence);
    const sinGamma = Math.sin(convergence);
    return {
      dE: dE * cosGamma + dN * sinGamma,
      dN: dN * cosGamma - dE * sinGamma,
    };
  }

  private gpsDisplayResidualTransform(
    obs: GpsObservation,
    _fromStation?: Station,
  ): number[][] | null {
    const frame: GnssVectorFrame =
      obs.gnssVectorFrame ?? this.parseState?.gnssVectorFrameDefault ?? 'gridNEU';
    return buildGpsDisplayResidualTransform({
      frame,
      northSec: this.parseState?.verticalDeflectionNorthSec ?? 0,
      eastSec: this.parseState?.verticalDeflectionEastSec ?? 0,
    });
  }

  private transformGpsCovarianceToSolveFrame(obs: GpsObservation): GpsCovariance | null {
    const frame: GnssVectorFrame =
      obs.gnssVectorFrame ?? this.parseState?.gnssVectorFrameDefault ?? 'gridNEU';
    return transformGpsCovarianceToSolveFrameHelper({
      componentCount: this.gpsComponentCount(obs),
      frame,
      obs,
      stationGeodetic: (stationId) => this.stationGeodetic(stationId),
      northSec: this.parseState?.verticalDeflectionNorthSec ?? 0,
      eastSec: this.parseState?.verticalDeflectionEastSec ?? 0,
    });
  }

  private captureObservationWeightingStdDevs(observations: Observation[]): void {
    captureObservationWeightingStdDevsHelper(observations, {
      effectiveStdDev: (obs) => this.effectiveStdDev(obs),
      getObservedHorizontalDistanceIn2D: (obs) => this.getObservedHorizontalDistanceIn2D(obs),
      gpsCovariance: (obs) => this.gpsCovariance(obs),
    });
  }

  private gpsCovariance(obs: Observation): GpsCovariance {
    return gpsCovarianceHelper(obs, {
      gpsObservedVector: (gps) => this.gpsObservedVector(gps),
      transformGpsCovarianceToSolveFrame: (gps) => this.transformGpsCovarianceToSolveFrame(gps),
    });
  }

  private gpsWeight(obs: Observation): {
    wEE: number;
    wNN: number;
    wEN: number;
    wUU?: number;
    wEU?: number;
    wNU?: number;
  } {
    return gpsWeightHelper(obs, {
      gpsCovariance: (observation) => this.gpsCovariance(observation),
      is2D: this.is2D,
    });
  }

  private gpsObservedVector(obs: GpsObservation): GpsSolveVector {
    return gpsObservedVectorHelper(obs, {
      addCoordSystemDiagnostic: this.addCoordSystemDiagnostic.bind(this),
      addCoordSystemWarning: this.addCoordSystemWarning.bind(this),
      applyGpsVerticalDeflection: (vector) => this.applyGpsVerticalDeflection(vector),
      gpsRoverOffsetVector: (gps) => this.gpsRoverOffsetVector(gps),
      is2D: this.is2D,
      parseState: this.parseState,
      stationGeodetic: (stationId) => this.stationGeodetic(stationId),
      stations: this.stations,
    });
  }

  private gpsModeledVectorFromStationValues(
    obs: GpsObservation,
    fromValues: { x: number; y: number; h: number },
    toValues: { x: number; y: number; h: number },
  ): GpsVectorComponents {
    return gpsModeledVectorFromStationValuesHelper(obs, fromValues, toValues, {
      applyGpsVerticalDeflection: (vector) => this.applyGpsVerticalDeflection(vector),
      coordSystemMode: this.coordSystemMode,
      gpsUsesLocalSolveFrame: (frame) => this.gpsUsesLocalSolveFrame(frame),
      is2D: this.is2D,
      parseState: this.parseState,
      stationEllipsoidHeightFromValues: (station, h, latDeg, lonDeg) =>
        this.stationEllipsoidHeightFromValues(station, h, latDeg, lonDeg),
      stationGeodeticFromCoordinates: (stationId, x, y) =>
        this.stationGeodeticFromCoordinates(stationId, x, y),
      stations: this.stations,
    });
  }

  private gpsModeledVector(obs: GpsObservation): GpsSolveVector {
    return gpsModeledVectorHelper(obs, {
      gpsModeledVectorFromStationValues: (gps, fromValues, toValues) =>
        this.gpsModeledVectorFromStationValues(gps, fromValues, toValues),
      stations: this.stations,
    });
  }

  private gpsModeledVectorDerivatives(obs: GpsObservation): GpsVectorDerivatives {
    return gpsModeledVectorDerivativesHelper(obs, {
      gpsModeledVectorFromStationValues: (gps, fromValues, toValues) =>
        this.gpsModeledVectorFromStationValues(gps, fromValues, toValues),
      is2D: this.is2D,
      stations: this.stations,
    });
  }

  private updateGpsAddHiHtDiagnostics(): void {
    updateGpsAddHiHtDiagnosticsHelper({
      gpsObservedVector: (gps) => this.gpsObservedVector(gps),
      log: this.log.bind(this),
      observations: this.observations,
      parseState: this.parseState,
    });
  }

  private tsCorrelationGroup(obs: Observation): { key: string; station: StationId; setId?: string } | null {
    return tsCorrelationGroupHelper({
      enabled: this.tsCorrelationEnabled,
      obs,
      scope: this.tsCorrelationScope,
    });
  }

  private applyTsCorrelationToWeightMatrix(
    P: number[][],
    rowInfo: EquationRowInfo[],
    captureDiagnostics = false,
  ): void {
    const diagnostics = applyTsCorrelationToWeightMatrixHelper({
      captureDiagnostics,
      effectiveStdDev: (obs) => this.effectiveStdDev(obs),
      enabled: this.tsCorrelationEnabled,
      matrix: P,
      rho: this.tsCorrelationRho,
      rowInfo,
      scope: this.tsCorrelationScope,
      tsCorrelationGroup: (obs) => this.tsCorrelationGroup(obs),
    });
    if (captureDiagnostics) this.tsCorrelationDiagnostics = diagnostics;
  }

  private weightedQuadratic(P: number[][], v: number[][]): number { return weightedQuadraticHelper(P, v); }

  private observationStations(obs: Observation): string { return observationStationsHelper(obs); }

  private rowSigma(info: NonNullable<EquationRowInfo>): number {
    if (info.obs.type === 'gps') {
      const cov = this.gpsCovariance(info.obs);
      const variance =
        info.component === 'N'
          ? cov.cNN
          : info.component === 'U'
            ? (cov.cUU ?? cov.cNN)
            : cov.cEE;
      return Math.sqrt(Math.max(variance, 1e-24));
    }
    return Math.max(this.effectiveStdDev(info.obs), 1e-12);
  }

  private robustCorrelationRowGroups(rowInfo: EquationRowInfo[]): number[][] {
    return robustCorrelationRowGroupsHelper(rowInfo, {
      rowSigma: (info) => this.rowSigma(info),
      tsCorrelationEnabled: this.tsCorrelationEnabled,
      tsCorrelationGroup: (obs) => this.tsCorrelationGroup(obs),
    });
  }

  private captureRobustWeightBase(P: number[][], rowInfo: EquationRowInfo[]): RobustWeightMatrixBase {
    return captureRobustWeightBaseHelper(P, rowInfo, {
      robustCorrelationRowGroups: (info) => this.robustCorrelationRowGroups(info),
    });
  }

  private applyRobustWeightFactors(
    P: number[][],
    base: RobustWeightMatrixBase,
    factors: number[],
  ): void {
    applyRobustWeightFactorsHelper(P, base, factors);
  }

  private computeRobustWeightSummary(
    residuals: number[],
    rowInfo: EquationRowInfo[],
  ): RobustWeightSummary {
    return computeRobustWeightSummaryHelper(residuals, rowInfo, {
      robustK: this.robustK,
      rowSigma: (info) => this.rowSigma(info),
    });
  }

  private recordRobustDiagnostics(
    iteration: number,
    summary: RobustWeightSummary,
    maxWeightDelta: number,
  ): void {
    recordRobustDiagnosticsHelper({
      iteration,
      log: (message) => this.log(message),
      maxWeightDelta,
      robustDiagnostics: this.robustDiagnostics,
      robustMode: this.robustMode,
      summary,
    });
  }

  private maxRobustWeightDelta(a: number[], b: number[]): number {
    return maxRobustWeightDeltaHelper(a, b);
  }

  private computeDirectionSetPrefit(
    activeObservations: Observation[],
    directionSetIds: string[],
  ): void {
    computeDirectionSetPrefitHelper({
      activeObservations,
      directionOrientations: this.directionOrientations,
      directionSetIds,
      getAzimuth: (fromId, toId) => this.getAzimuth(fromId, toId),
      logs: this.logs,
      modeledAzimuth: (rawAz, atStationId, applyConvergence) =>
        this.modeledAzimuth(rawAz, atStationId, applyConvergence),
      stations: this.stations,
    });
  }

  private logNetworkDiagnostics(activeObservations: Observation[]) {
    logNetworkDiagnosticsHelper({
      activeObservations,
      log: this.log.bind(this),
      unknowns: this.unknowns,
    });
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
  }: EngineOptions) {
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

  private log(msg: string) {
    this.logs.push(msg);
  }

  private emitSolveProgress(phase: SolveProgressEvent['phase']): void {
    if (!this.progressCallback) return;
    this.progressCallback(
      buildSolveProgressEvent({
        converged: this.converged,
        iterations: this.iterations,
        maxIterations: this.maxIterations,
        phase,
        solveStartedAt: this.solveStartedAt,
      }),
    );
  }

  private resetSolveTiming(): void {
    this.solveTiming = createEmptySolveTiming();
    this.solveTimingLogged = false;
  }

  private buildSolveTimingProfile(): NonNullable<AdjustmentResult['solveTimingProfile']> {
    return buildSolveTimingProfileHelper({
      solveStartedAt: this.solveStartedAt,
      solveTiming: this.solveTiming,
    });
  }

  private logSolveTimingProfile(
    profile: NonNullable<AdjustmentResult['solveTimingProfile']>,
  ): void {
    if (this.solveTimingLogged) return;
    this.solveTimingLogged = true;
    this.logs.push(formatSolveTimingLogLine(profile));
  }

  private finishSolve(result: AdjustmentResult): AdjustmentResult {
    this.emitSolveProgress('complete');
    return result;
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
    }).solve();
  }

  private emitRunModeCompatibilityDiagnostics(diagnostics: RunModeCompatibilityDiagnostic[]): void {
    runModeCompatibilityDiagnosticLines(diagnostics).forEach((line) => this.log(line));
  }

  private addCoordSystemDiagnostic(code: CoordSystemDiagnosticCode, warning?: string): void {
    this.coordSystemDiagnostics.add(code);
    if (!warning) return;
    this.addCoordSystemWarning(warning);
  }

  private addCoordSystemWarning(warning: string): void {
    addUniqueCoordSystemWarning({
      coordSystemWarningMessages: this.coordSystemWarningMessages,
      coordWarningSeen: this.coordWarningSeen,
      log: (message) => this.log(message),
      warning,
    });
  }

  private setCrsOff(reason: CrsOffReason, warning?: string): void {
    this.crsStatus = 'off';
    this.crsOffReason = reason;
    if (warning) this.addCoordSystemWarning(warning);
  }

  private setCrsOn(): void {
    this.crsStatus = 'on';
    this.crsOffReason = undefined;
  }

  private clearCoordSystemDiagnostics(): void {
    this.coordSystemDiagnostics.clear();
    this.coordSystemWarningMessages = [];
    this.coordWarningSeen.clear();
    this.crsDatumOpId = '';
    this.crsDatumFallbackUsed = false;
    this.crsAreaOfUseStatus = 'unknown';
    this.crsOutOfAreaStationCount = 0;
    this.crsStatus = 'off';
    this.crsOffReason = this.coordSystemMode === 'grid' ? 'noCRSSelected' : 'disabledByProfile';
  }

  private clearGeometryCache() {
    this.azimuthCache.clear();
    this.zenithCache.clear();
    this.stationFactorCache.clear();
  }

  private collectActiveObservations(): Observation[] {
    return collectActiveObservationsForSolve(this.observations, this.excludeIds, this.is2D);
  }

  private stationHasBootstrapableApprox(stationId: StationId): boolean {
    return stationHasBootstrapableApproxHelper(this.stations, stationId);
  }

  private buildBootstrapPairMetrics(
    activeObservations: Observation[],
  ): Map<string, BootstrapPairMetrics> {
    return buildBootstrapPairMetricsHelper(activeObservations);
  }

  private applyBootstrapApproxStation(
    stationId: StationId,
    seed: { x: number; y: number; h?: number },
  ): boolean {
    return applyBootstrapApproxStationHelper({
      coordSystemMode: this.coordSystemMode,
      seed,
      stationFactorSnapshot: (id) => this.stationFactorSnapshot(id),
      stationGeodetic: (id) => this.stationGeodetic(id),
      stationId,
      stations: this.stations,
    });
  }

  private estimateBootstrapSetOrientation(
    set: BootstrapDirectionSet,
    pairMetrics: Map<string, BootstrapPairMetrics>,
  ): number | null {
    return estimateBootstrapSetOrientationHelper({ pairMetrics, set, stations: this.stations });
  }

  private tryBootstrapDirectionSetOccupy(
    set: BootstrapDirectionSet,
    pairMetrics: Map<string, BootstrapPairMetrics>,
  ): { x: number; y: number; h?: number; orientation: number } | null {
    return tryBootstrapDirectionSetOccupyHelper({ pairMetrics, set, stations: this.stations });
  }

  private bootstrapApproximateTraverseCoords(activeObservations: Observation[]): void {
    bootstrapApproximateTraverseCoordsHelper({
      activeObservations,
      applyBootstrapApproxStationFn: (stationId, seed) =>
        this.applyBootstrapApproxStation(stationId, seed),
      log: this.log.bind(this),
      stations: this.stations,
    });
  }

  private projectWeakFloatZenithLeafStationsForDisplay(options?: { log?: boolean }): void {
    const activeObservations = this.collectActiveObservations();
    const projected = projectWeakFloatZenithLeafStations({
      is2D: this.is2D,
      activeObservations,
      stations: this.stations,
      coordSystemMode: this.coordSystemMode,
      stationGeodetic: this.stationGeodetic.bind(this),
      stationFactorSnapshot: this.stationFactorSnapshot.bind(this),
    });
    if (projected.length > 0) {
      this.clearGeometryCache();
      if (options?.log ?? true) {
        this.logs.push(
          `Float-zenith leaf projection applied for display coordinates: ${projected.join(', ')}`,
        );
      }
    }
  }

  private evaluateGridInputGate(activeObservations: Observation[]): {
    blocked: boolean;
    reasons: string[];
    suggestions: string[];
  } {
    if (this.coordSystemMode !== 'grid') {
      return { blocked: false, reasons: [], suggestions: [] };
    }
    return evaluateGridInputGateHelper({
      activeObservations,
      crsId: this.crsId,
      gnssFrameConfirmed: this.gnssFrameConfirmed,
      parseState: this.parseState,
      stations: this.stations,
    });
  }

  private evaluateDatumSufficiency(activeObservations: Observation[]): DatumSufficiencyReport {
    return evaluateDatumSufficiencyHelper({
      activeObservations,
      is2D: this.is2D,
      stations: this.stations,
    });
  }

  private getAzimuth(fromID: StationId, toID: StationId): { az: number; dist: number } {
    const cacheKey = `${fromID}|${toID}`;
    const cached = this.azimuthCache.get(cacheKey);
    if (cached) return cached;
    const s1 = this.stations[fromID];
    const s2 = this.stations[toID];
    if (!s1 || !s2) return { az: 0, dist: 0 };
    const dx = s2.x - s1.x;
    const dy = s2.y - s1.y;
    let az = Math.atan2(dx, dy);
    if (az < 0) az += 2 * Math.PI;
    const result = { az, dist: Math.sqrt(dx * dx + dy * dy) };
    this.azimuthCache.set(cacheKey, result);
    return result;
  }

  private applyGeoidHeightConversions(model: GeoidGridModel): void {
    applyGeoidHeightConversionsHelper({
      geoidInterpolation: this.geoidInterpolation,
      geoidOutputHeightDatum: this.geoidOutputHeightDatum,
      log: this.log.bind(this),
      model,
      parseState: this.parseState,
      stations: this.stations,
    });
  }

  private applyAverageGeoidHeightConversions(): void {
    applyAverageGeoidHeightConversionsHelper({
      addCoordSystemDiagnostic: this.addCoordSystemDiagnostic.bind(this),
      averageGeoidHeight: this.averageGeoidHeight,
      geoidOutputHeightDatum: this.geoidOutputHeightDatum,
      log: this.log.bind(this),
      parseState: this.parseState,
      stations: this.stations,
    });
  }

  private resolveStationEllipsoidHeight(station: Station): {
    ellipsoidHeightUsed: number;
    source: 'perStationGeoid+H' | 'avgGeoid+H' | 'providedEllipsoid' | 'assumed0';
  } {
    return resolveStationEllipsoidHeightHelper({
      activeGeoidModel: this.activeGeoidModel,
      addCoordSystemDiagnostic: this.addCoordSystemDiagnostic.bind(this),
      averageGeoidHeight: this.averageGeoidHeight,
      geoidInterpolation: this.geoidInterpolation,
      station,
    });
  }

  private stationEllipsoidHeight(station: Station): number {
    return this.resolveStationEllipsoidHeight(station).ellipsoidHeightUsed;
  }

  private stationGeodetic(stationId: StationId): { latDeg: number; lonDeg: number } | null {
    const station = this.stations[stationId];
    if (!station) return null;
    const hasExplicitGeodeticInput = station.coordInputClass === 'geodetic';
    if (
      hasExplicitGeodeticInput &&
      Number.isFinite(station.latDeg ?? Number.NaN) &&
      Number.isFinite(station.lonDeg ?? Number.NaN)
    ) {
      if (this.coordSystemMode === 'grid') this.setCrsOn();
      return { latDeg: station.latDeg as number, lonDeg: station.lonDeg as number };
    }
    if (this.coordSystemMode !== 'grid') return null;
    const inv = inverseENToGeodetic({
      east: station.x,
      north: station.y,
      originLatDeg: this.parseState?.originLatDeg,
      originLonDeg: this.parseState?.originLonDeg,
      model: this.parseState?.crsProjectionModel ?? 'legacy-equirectangular',
      coordSystemMode: this.coordSystemMode,
      crsId: this.crsId,
    });
    if ('failureReason' in inv) {
      const reason = inv.failureReason;
      if (reason === 'noCRSSelected') {
        this.setCrsOff('noCRSSelected', 'Grid coordinate mode is active but CRS id is missing.');
      } else if (reason === 'noInverseAvailable') {
        this.setCrsOff(
          'noInverseAvailable',
          `CRS inverse unavailable for ${this.crsId || 'unspecified CRS'} while resolving station geodetics.`,
        );
      } else if (reason === 'crsInitFailed') {
        this.setCrsOff(
          'crsInitFailed',
          `CRS initialization failed for ${this.crsId || 'unspecified CRS'} while resolving station geodetics.`,
        );
      } else if (reason === 'inverseFailed') {
        this.setCrsOff(
          'inverseFailed',
          `CRS inverse failed for station ${stationId} in ${this.crsId || 'unspecified CRS'}.`,
        );
      } else if (reason === 'projDbMissing') {
        this.setCrsOff(
          'projDbMissing',
          'Projection database is unavailable for CRS inverse operations.',
        );
      } else if (reason === 'missingGridFiles') {
        this.setCrsOff(
          'missingGridFiles',
          'Required grid-shift files are missing for CRS datum/vertical operations.',
        );
      } else if (reason === 'unsupportedCrsFamily') {
        this.setCrsOff(
          'unsupportedCrsFamily',
          `Unsupported CRS family for ${this.crsId || 'unspecified CRS'}.`,
        );
      } else {
        this.setCrsOff('disabledByProfile');
      }
      return null;
    }
    this.setCrsOn();
    if (inv.datumOpId && !this.crsDatumOpId) {
      this.crsDatumOpId = inv.datumOpId;
    }
    (inv.diagnostics ?? []).forEach((code) => {
      this.addCoordSystemDiagnostic(code);
      if (code === 'CRS_DATUM_FALLBACK') this.crsDatumFallbackUsed = true;
    });
    (inv.warnings ?? []).forEach((warning) =>
      this.addCoordSystemDiagnostic('CRS_DATUM_FALLBACK', warning),
    );
    station.latDeg = inv.latDeg;
    station.lonDeg = inv.lonDeg;
    return inv;
  }

  private stationFactorSnapshot(stationId: StationId): {
    convergenceAngleRad: number;
    gridScaleFactor: number;
    elevationFactor: number;
    combinedFactor: number;
    source: 'projection-formula' | 'numerical-fallback';
    factorComputationMethod: FactorComputationMethod;
  } {
    const station = this.stations[stationId];
    if (!station) {
      return {
        convergenceAngleRad: 0,
        gridScaleFactor: 1,
        elevationFactor: 1,
        combinedFactor: 1,
        source: 'projection-formula',
        factorComputationMethod: 'fallback',
      };
    }
    const cacheKey = [
      stationId,
      this.coordSystemMode ?? 'local',
      this.crsId,
      Number.isFinite(station.x) ? station.x.toFixed(6) : 'nan',
      Number.isFinite(station.y) ? station.y.toFixed(6) : 'nan',
      Number.isFinite(station.h) ? station.h.toFixed(6) : 'nan',
      Number.isFinite(station.latDeg ?? Number.NaN) ? (station.latDeg as number).toFixed(9) : '-',
      Number.isFinite(station.lonDeg ?? Number.NaN) ? (station.lonDeg as number).toFixed(9) : '-',
      this.crsGridScaleEnabled ? this.crsGridScaleFactor.toFixed(10) : 'off',
      this.crsConvergenceEnabled ? this.crsConvergenceAngleRad.toFixed(12) : 'off',
      this.averageGeoidHeight.toFixed(6),
    ].join('|');
    const cached = this.stationFactorCache.get(cacheKey);
    if (cached) return cached;
    let convergenceAngleRad = 0;
    let gridScaleFactor = 1;
    let source: 'projection-formula' | 'numerical-fallback' = 'projection-formula';
    let factorComputationMethod: FactorComputationMethod = 'fallback';
    if (this.coordSystemMode === 'grid') {
      const geo = this.stationGeodetic(stationId);
      if (geo) {
        const factors = computeGridFactors(geo.latDeg, geo.lonDeg, this.crsId);
        if (factors) {
          convergenceAngleRad = factors.convergenceAngleRad;
          gridScaleFactor = factors.gridScaleFactor;
          source = factors.source;
          factorComputationMethod =
            factors.source === 'numerical-fallback' ? 'fallback' : 'inverseToGeodetic';
          if (factors.datumOpId && !this.crsDatumOpId) {
            this.crsDatumOpId = factors.datumOpId;
          }
          (factors.diagnostics ?? []).forEach((code) => {
            this.addCoordSystemDiagnostic(code);
            if (code === 'CRS_DATUM_FALLBACK') this.crsDatumFallbackUsed = true;
          });
          (factors.warnings ?? []).forEach((warning) =>
            this.addCoordSystemDiagnostic(
              factors.source === 'numerical-fallback'
                ? 'FACTOR_APPROXIMATION_USED'
                : 'CRS_DATUM_FALLBACK',
              warning,
            ),
          );
        }
      }
    }
    if (this.crsGridScaleEnabled) {
      gridScaleFactor *= this.crsGridScaleFactor;
    }
    if (
      this.crsConvergenceEnabled &&
      Number.isFinite(this.crsConvergenceAngleRad) &&
      Math.abs(this.crsConvergenceAngleRad) > 0
    ) {
      convergenceAngleRad += this.crsConvergenceAngleRad;
    }
    const elevationFactor = computeElevationFactor(
      this.stationEllipsoidHeight(station),
      EARTH_RADIUS_M,
    );
    const combinedFactor = gridScaleFactor * elevationFactor;
    station.convergenceAngleRad = convergenceAngleRad;
    station.gridScaleFactor = gridScaleFactor;
    station.elevationFactor = elevationFactor;
    station.combinedFactor = combinedFactor;
    station.factorComputationSource = source;
    station.factorComputationMethod = factorComputationMethod;
    const snapshot = {
      convergenceAngleRad,
      gridScaleFactor,
      elevationFactor,
      combinedFactor,
      source,
      factorComputationMethod,
    };
    this.stationFactorCache.set(cacheKey, snapshot);
    return snapshot;
  }

  private evaluateCrsAreaOfUseCoverage(): void {
    if (this.coordSystemMode !== 'grid') {
      this.crsAreaOfUseStatus = 'unknown';
      this.crsOutOfAreaStationCount = 0;
      return;
    }
    const def = getCrsDefinition(this.crsId);
    if (!def?.areaOfUseBounds) {
      this.crsAreaOfUseStatus = 'unknown';
      this.crsOutOfAreaStationCount = 0;
      return;
    }
    let evaluated = 0;
    const outside: StationId[] = [];
    Object.keys(this.stations).forEach((stationId) => {
      const geo = this.stationGeodetic(stationId);
      if (!geo) return;
      const inside = isGeodeticInsideAreaOfUse(def, geo.latDeg, geo.lonDeg);
      if (inside == null) return;
      evaluated += 1;
      if (!inside) outside.push(stationId);
    });
    if (evaluated === 0) {
      this.crsAreaOfUseStatus = 'unknown';
      this.crsOutOfAreaStationCount = 0;
      return;
    }
    if (outside.length === 0) {
      this.crsAreaOfUseStatus = 'inside';
      this.crsOutOfAreaStationCount = 0;
      return;
    }
    this.crsAreaOfUseStatus = 'outside';
    this.crsOutOfAreaStationCount = outside.length;
    const sample = outside.slice(0, 8).join(', ');
    const suffix = outside.length > 8 ? ` (+${outside.length - 8} more)` : '';
    this.addCoordSystemDiagnostic(
      'CRS_OUT_OF_AREA',
      `Selected CRS ${def.id} area-of-use (${def.areaOfUse}) may not cover all stations: ${sample}${suffix}.`,
    );
  }

  private measuredAngleCorrection(at: StationId, from: StationId, to: StationId): number {
    if (!this.stations[at]) return 0;
    return measuredAngleCorrectionHelper({
      coordSystemMode: this.coordSystemMode,
      from,
      stationFactorSnapshot: (stationId) => this.stationFactorSnapshot(stationId),
      to,
    });
  }

  private rawDistanceCombinedFactor(obs: Observation & { type: 'dist' }): number {
    return rawDistanceCombinedFactorHelper({
      coordSystemMode: this.coordSystemMode,
      crsId: this.crsId,
      obs,
      stationEllipsoidHeight: (station) => this.stationEllipsoidHeight(station),
      stationFactorSnapshot: (stationId) => this.stationFactorSnapshot(stationId),
      stationGeodetic: (stationId) => this.stationGeodetic(stationId),
      stations: this.stations,
    });
  }

  private rawDirectionSetCorrection(obs: Observation & { type: 'direction' }): number {
    return rawDirectionSetCorrectionHelper({
      coordSystemMode: this.coordSystemMode,
      crsId: this.crsId,
      obs,
      parseState: this.parseState,
      stationGeodetic: (stationId) => this.stationGeodetic(stationId),
      stations: this.stations,
      wrapToPi: (value) => this.wrapToPi(value),
    });
  }

  private captureRawTraverseDistanceFactorSnapshots(activeObservations: Observation[]): void {
    captureRawTraverseDistanceFactorSnapshotsHelper(
      activeObservations,
      this.parseState,
      (obs) => this.rawDistanceCombinedFactor(obs),
    );
  }

  private captureRawTraverseDirectionCorrections(activeObservations: Observation[]): void {
    captureRawTraverseDirectionCorrectionsHelper(
      activeObservations,
      this.parseState,
      (obs) => this.rawDirectionSetCorrection(obs),
    );
  }

  private modeledAzimuth(rawAz: number, atStationId?: StationId, applyConvergence = true): number {
    return modeledAzimuthHelper({
      applyConvergence,
      atStationId,
      crsConvergenceAngleRad: this.crsConvergenceAngleRad,
      crsConvergenceEnabled: this.crsConvergenceEnabled,
      rawAz,
      stationFactorSnapshot: (stationId) => this.stationFactorSnapshot(stationId),
    });
  }

  private wrapToPi(val: number): number {
    let v = val;
    if (v > Math.PI) v -= 2 * Math.PI;
    if (v < -Math.PI) v += 2 * Math.PI;
    return v;
  }

  private logObsDebug(iteration: number, label: string, details: string) {
    if (!this.debug) return;
    this.logs.push(`Iter ${iteration} ${label}: ${details}`);
  }

  private mapDistanceScaleForObservation(obs: Observation): number {
    return mapDistanceScaleForObservationHelper({
      is2D: this.is2D,
      mapMode: this.mapMode,
      mapScaleFactor: this.mapScaleFactor,
      obs,
    });
  }

  private crsDistanceScaleForObservation(obs: Observation): number {
    return crsDistanceScaleForObservationHelper({
      addCoordSystemDiagnostic: this.addCoordSystemDiagnostic.bind(this),
      averageScaleFactor: this.averageScaleFactor,
      commonElevation: this.commonElevation,
      coordSystemMode: this.coordSystemMode,
      crsGridScaleEnabled: this.crsGridScaleEnabled,
      crsGridScaleFactor: this.crsGridScaleFactor,
      localDatumScheme: this.localDatumScheme,
      obs,
      scaleOverrideActive: this.scaleOverrideActive,
      stationEllipsoidHeight: (station) => this.stationEllipsoidHeight(station),
      stationFactorSnapshot: (stationId) => this.stationFactorSnapshot(stationId),
      stations: this.stations,
    });
  }

  private distanceScaleForObservation(obs: Observation): number {
    return this.mapDistanceScaleForObservation(obs) * this.crsDistanceScaleForObservation(obs);
  }

  private prismCorrectionForObservation(obs: Observation): number {
    return prismCorrectionForObservationHelper({
      obs,
      prismEnabled: this.prismEnabled,
      prismOffset: this.prismOffset,
      prismScope: this.prismScope,
    });
  }

  private correctedDistanceModel(
    obs: Observation & { type: 'dist' },
    calcDistRaw: number,
  ): {
    calcDistance: number;
    mapScale: number;
    prismCorrection: number;
    horizontalDerivativeFactor?: number;
    verticalDerivativeFactor?: number;
    useReducedSlopeDerivatives?: boolean;
  } {
    return correctedDistanceModelHelper({
      calcDistRaw,
      centeringLineGeometry: (fromId, toId, hi, ht) =>
        this.centeringLineGeometry(fromId, toId, hi, ht),
      coordSystemMode: this.coordSystemMode,
      distanceScaleForObservation: (distanceObs) => this.distanceScaleForObservation(distanceObs),
      is2D: this.is2D,
      obs,
      prismCorrectionForObservation: (prismObs) => this.prismCorrectionForObservation(prismObs),
    });
  }

  private curvatureRefractionAngle(horiz: number): number {
    return curvatureRefractionAngleHelper({
      applyCurvatureRefraction: this.applyCurvatureRefraction,
      horiz,
      refractionCoefficient: this.refractionCoefficient,
      verticalReduction: this.verticalReduction,
    });
  }

  private zenithScaleForObservation(obs: Observation & { type: 'zenith' }): number {
    return zenithScaleForObservationHelper({
      averageScaleFactor: this.averageScaleFactor,
      commonElevation: this.commonElevation,
      coordSystemMode: this.coordSystemMode,
      crsGridScaleEnabled: this.crsGridScaleEnabled,
      crsGridScaleFactor: this.crsGridScaleFactor,
      localDatumScheme: this.localDatumScheme,
      obs,
      scaleOverrideActive: this.scaleOverrideActive,
      stationEllipsoidHeight: (station) => this.stationEllipsoidHeight(station),
      stationFactorSnapshot: (stationId) => this.stationFactorSnapshot(stationId),
      stations: this.stations,
    });
  }

  private getZenith(
    fromID: StationId,
    toID: StationId,
    hi = 0,
    ht = 0,
  ): { z: number; dist: number; horiz: number; dh: number; crCorr: number } {
    return getZenithHelper({
      curvatureRefractionAngle: (horiz) => this.curvatureRefractionAngle(horiz),
      fromID,
      hi,
      ht,
      stations: this.stations,
      toID,
      zenithCache: this.zenithCache,
    });
  }

  private getModeledZenith(
    obs: Observation & { type: 'zenith' },
  ): { z: number; dist: number; horiz: number; dh: number; crCorr: number; horizontalScale: number } {
    return getModeledZenithHelper({
      coordSystemMode: this.coordSystemMode,
      curvatureRefractionAngle: (horiz) => this.curvatureRefractionAngle(horiz),
      getZenith: (fromId, toId, hi, ht) => this.getZenith(fromId, toId, hi, ht),
      is2D: this.is2D,
      obs,
      zenithScaleForObservation: (zenithObs) => this.zenithScaleForObservation(zenithObs),
    });
  }

  private effectiveDistanceForAngularObservation(obs: Observation): number | undefined {
    return effectiveDistanceForAngularObservationHelper({
      getAzimuth: (fromId, toId) => this.getAzimuth(fromId, toId),
      getModeledZenith: (zenithObs) => this.getModeledZenith(zenithObs),
      obs,
    });
  }

  private isObservationActive(obs: Observation): boolean {
    return isObservationActiveForSolve(obs, this.excludeIds, this.is2D);
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
