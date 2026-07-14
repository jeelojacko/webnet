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
  cloneParsedResultValue,
  type BootstrapDirectionSet,
  type BootstrapPairMetrics,
  type EngineOptions,
  type GpsCovariance,
  type GpsSolveVector,
  type GpsVectorComponents,
  type GpsVectorDerivatives,
} from './adjustTypes';
import { geoidGridMetadataSummary, interpolateGeoidUndulation, loadGeoidGridModel } from './geoid';
import {
  computeElevationFactor,
  computeGridFactors,
  inverseENToGeodetic,
} from './geodesy';
import { getCrsDefinition, isGeodeticInsideAreaOfUse } from './crsCatalog';
import { runClusterDualPassWorkflow } from './adjustmentClusterWorkflow';
import { formatAutoAdjustLogLines, runAutoAdjustCycles, type AutoAdjustConfig } from './autoAdjust';
import type { GeoidGridModel } from './geoid';
import {
  accumulateNormalEquationsFromSparseRows,
  multiplySparseRowsByDenseMatrix,
  zeros,
} from './matrix';
import { parseInput } from './parse';
import {
  getCachedParsedModel,
  getCachedSolvePreparation,
  recordScenarioSolve,
} from './scenarioParsedModelCache';
import { buildCoordinateConstraints, coordinateConstraintWeightedSum } from './adjustmentConstraints';
import { assembleAdjustmentEquations } from './adjustmentEquationAssembly';
import { applyAdjustmentCorrections, solveAdjustmentIteration } from './adjustmentIteration';
import {
  makePairKey,
} from './adjustMath';
import {
  transformSymmetricCovariance3,
} from './adjustGpsMath';
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
  applyAutoDroppedHeightHolds,
  buildSolvePreparation,
  cloneSolvePreparationResult,
  collectActiveObservationsForSolve,
  isObservationActiveForSolve,
} from './adjustmentPreprocessing';
import type { SolvePreparationResult } from './adjustmentPreprocessing';
import {
  getObservationSetId,
  getObservationSideshotCalcMeta,
} from './observationMetadata';
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
import { buildAdjustmentResultPayload, finalizeResultParseState } from './adjustmentResultBuilder';
import {
  buildObservationTypeSummary,
  buildResidualDiagnostics,
  buildStatisticalSummary,
} from './adjustmentStatisticsBuilders';
import { buildChiSquareSummary } from './adjustmentStatisticalMath';
import { buildWeakGeometryDiagnostics } from './adjustmentWeakGeometry';
import {
  projectWeakFloatZenithLeafStationsForDisplay as projectWeakFloatZenithLeafStations,
} from './adjustmentWeakFloatZenithProjection';
import {
  buildDirectionDiagnostics,
  type DirectionSetStat,
} from './adjustmentDirectionDiagnostics';
import {
  buildTsCorrelationDiagnostics,
  type TsCorrelationResidualGroups,
} from './adjustmentTsCorrelationDiagnostics';
import {
  resolveRunModeCompatibilityOptions,
  runModeCompatibilityDiagnosticLines,
} from './adjustmentRunModeCompatibility';
import { buildSideshotResults } from './adjustmentSideshots';
import { buildGpsLoopDiagnostics, buildLevelingLoopDiagnostics } from './adjustmentLoopDiagnostics';
import {
  buildAutoSideshotDiagnostics,
  buildClusterDiagnostics,
} from './adjustmentReviewDiagnostics';
import {
  buildSetupDiagnostics,
  buildTraverseDiagnostics,
} from './adjustmentSetupTraverseDiagnostics';
import type { CoordinateConstraintEquation } from './adjustmentSolveTypes';
import {
  buildDistanceAzimuthPrecision,
  buildHorizontalErrorEllipse,
  buildRelativeCovarianceFromEndpoints,
  sqrtPrecisionComponent,
} from './precisionPropagation';
import {
  scaleRelativeCovarianceRows,
  scaleStationCovarianceRows,
} from './resultPrecision';
import { summarizeReductionUsage } from './reductionUsageSummary';
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

  private applyDataCheckProvisionalApproximation(): {
    attempted: boolean;
    updatedStationCount: number;
    iterations: number;
    converged: boolean;
    directionCalcByObsId: Map<number, number>;
  } {
    if (this.unknowns.length === 0) {
      return {
        attempted: false,
        updatedStationCount: 0,
        iterations: 0,
        converged: false,
        directionCalcByObsId: new Map<number, number>(),
      };
    }

    const provisionalIterations = Math.max(2, Math.min(this.maxIterations, 4));
    this.log(
      `Data Check provisional approximation: running bounded coordinate fit (maxIterations=${provisionalIterations}) to refine approximate geometry before inverse comparisons.`,
    );

    const provisionalParseOptions = {
      ...(this.parseOptions ?? {}),
      runMode: 'adjustment',
      preanalysisMode: false,
      robustMode: 'none',
      autoAdjustEnabled: false,
      autoSideshotEnabled: false,
      clusterDetectionEnabled: false,
    } as ParseOptions;

    const provisionalResult = new LSAEngine({
      input: this.input,
      maxIterations: provisionalIterations,
      convergenceThreshold: this.convergenceThreshold,
      instrumentLibrary: this.instrumentLibrary,
      excludeIds: this.excludeIds,
      overrides: this.overrides,
      parseOptions: provisionalParseOptions,
      geoidSourceData: this.geoidSourceData,
    }).solve();
    const directionCalcByObsId = new Map<number, number>();
    provisionalResult.observations.forEach((obs) => {
      if (
        obs.type !== 'direction' ||
        !Number.isFinite(obs.calc ?? Number.NaN) ||
        !Number.isFinite(obs.residual ?? Number.NaN) ||
        Math.abs(obs.residual ?? 0) > DATA_CHECK_PROVISIONAL_DIRECTION_TRUST_MAX_RAD
      ) {
        return;
      }
      directionCalcByObsId.set(obs.id, obs.calc as number);
    });

    let updatedStationCount = 0;
    Object.entries(this.stations).forEach(([stationId, station]) => {
      const provisionalStation = provisionalResult.stations[stationId];
      if (!provisionalStation) return;
      const nextX = provisionalStation.x;
      const nextY = provisionalStation.y;
      const nextH = provisionalStation.h;
      if (
        !Number.isFinite(nextX) ||
        !Number.isFinite(nextY) ||
        (!this.is2D && !Number.isFinite(nextH))
      ) {
        return;
      }
      const changed =
        Math.abs(station.x - nextX) > 1e-9 ||
        Math.abs(station.y - nextY) > 1e-9 ||
        Math.abs((station.h ?? 0) - (nextH ?? 0)) > 1e-9 ||
        station.bootstrapApprox === true;
      if (!changed) return;
      station.x = nextX;
      station.y = nextY;
      station.h = nextH;
      station.bootstrapApprox = false;
      if (this.coordSystemMode === 'grid') {
        this.stationGeodetic(stationId as StationId);
        this.stationFactorSnapshot(stationId as StationId);
      }
      updatedStationCount += 1;
    });

    this.log(
      `Data Check provisional approximation: updated ${updatedStationCount} station(s); provisionalIterations=${provisionalResult.iterations}, converged=${provisionalResult.converged ? 'YES' : 'NO'}.`,
    );

    return {
      attempted: true,
      updatedStationCount,
      iterations: provisionalResult.iterations,
      converged: provisionalResult.converged,
      directionCalcByObsId,
    };
  }

  private runDataCheckOnly(activeObservations: Observation[]): AdjustmentResult {
    this.runMode = 'data-check';
    this.iterations = 0;
    this.dof = 0;
    this.seuw = 0;
    this.converged = true;
    this.log(
      'Data Check Only mode: reporting approximate-geometry differences from observations (no least-squares adjustment).',
    );

    const provisionalApproximation = this.applyDataCheckProvisionalApproximation();

    const dataCheckDirectionOrientations = new Map<string, number>();
    const directionOrientationSums = new Map<string, { sumSin: number; sumCos: number }>();
    activeObservations.forEach((obs) => {
      if (obs.type !== 'direction' || typeof obs.setId !== 'string' || obs.setId.trim() === '') return;
      if (!this.stations[obs.at] || !this.stations[obs.to]) return;
      const az = this.modeledAzimuth(
        this.getAzimuth(obs.at, obs.to).az,
        obs.at,
        obs.gridObsMode !== 'grid',
      );
      const diff = this.wrapToPi(obs.obs - az);
      const entry = directionOrientationSums.get(obs.setId) ?? { sumSin: 0, sumCos: 0 };
      entry.sumSin += Math.sin(diff);
      entry.sumCos += Math.cos(diff);
      directionOrientationSums.set(obs.setId, entry);
    });
    directionOrientationSums.forEach((entry, setId) => {
      dataCheckDirectionOrientations.set(setId, Math.atan2(entry.sumSin, entry.sumCos));
    });

    const ranked: Array<{ obsId: number; type: Observation['type']; diff: number }> = [];
    activeObservations.forEach((obs) => {
      if (obs.type === 'dist') {
        const s1 = this.stations[obs.from];
        const s2 = this.stations[obs.to];
        if (!s1 || !s2) return;
        const geom = this.centeringLineGeometry(obs.from, obs.to, obs.hi ?? 0, obs.ht ?? 0);
        const rawCalc = this.is2D ? geom.horiz : obs.mode === 'slope' ? geom.slope : geom.horiz;
        const corrected = this.correctedDistanceModel(obs, rawCalc);
        const observed = this.getObservedHorizontalDistanceIn2D(obs);
        const residual = observed.observedDistance - corrected.calcDistance;
        obs.calc = corrected.calcDistance;
        obs.residual = residual;
        obs.stdRes = observed.sigmaDistance > 0 ? residual / observed.sigmaDistance : 0;
        ranked.push({ obsId: obs.id, type: obs.type, diff: Math.abs(residual) });
        return;
      }
      if (obs.type === 'angle') {
        const azFrom = this.getAzimuth(obs.at, obs.from);
        const azTo = this.getAzimuth(obs.at, obs.to);
        let calc = azTo.az - azFrom.az;
        if (calc < 0) calc += 2 * Math.PI;
        const residual = ((obs.obs - calc + Math.PI) % (2 * Math.PI)) - Math.PI;
        obs.calc = calc;
        obs.residual = residual;
        obs.stdRes = obs.stdDev > 0 ? residual / obs.stdDev : 0;
        ranked.push({ obsId: obs.id, type: obs.type, diff: Math.abs(residual) });
        return;
      }
      if (obs.type === 'bearing' || obs.type === 'dir') {
        const from = obs.type === 'bearing' ? obs.from : obs.from;
        const to = obs.type === 'bearing' ? obs.to : obs.to;
        const calc = this.getAzimuth(from, to).az;
        const residual = ((obs.obs - calc + Math.PI) % (2 * Math.PI)) - Math.PI;
        obs.calc = calc;
        obs.residual = residual;
        obs.stdRes = obs.stdDev > 0 ? residual / obs.stdDev : 0;
        ranked.push({ obsId: obs.id, type: obs.type, diff: Math.abs(residual) });
        return;
      }
      if (obs.type === 'direction') {
        const provisionalCalc = provisionalApproximation.directionCalcByObsId.get(obs.id);
        if (Number.isFinite(provisionalCalc ?? Number.NaN)) {
          const calc = provisionalCalc as number;
          const residual = this.wrapToPi(obs.obs - calc);
          obs.calc = calc;
          obs.residual = residual;
          obs.stdRes = obs.stdDev > 0 ? residual / obs.stdDev : 0;
          ranked.push({ obsId: obs.id, type: obs.type, diff: Math.abs(residual) });
          return;
        }
        const occupyStation = this.stations[obs.at];
        const targetStation = this.stations[obs.to];
        const weakApprox =
          occupyStation?.bootstrapApprox === true || targetStation?.bootstrapApprox === true;
        const internalResidualCandidates = [
          obs.rawMaxResidual,
          obs.rawSpread,
          obs.facePairDelta,
        ].filter((value): value is number => Number.isFinite(value));
        if (
          internalResidualCandidates.length > 0 &&
          (weakApprox || provisionalApproximation.attempted)
        ) {
          const residual = internalResidualCandidates.reduce(
            (max, value) => (Math.abs(value) > Math.abs(max) ? value : max),
            0,
          );
          obs.calc = obs.obs;
          obs.residual = residual;
          obs.stdRes = undefined;
          ranked.push({ obsId: obs.id, type: obs.type, diff: Math.abs(residual) });
          return;
        }
        const az = this.modeledAzimuth(
          this.getAzimuth(obs.at, obs.to).az,
          obs.at,
          obs.gridObsMode !== 'grid',
        );
        const orientation =
          typeof obs.setId === 'string' && obs.setId.trim() !== ''
            ? (dataCheckDirectionOrientations.get(obs.setId) ?? 0)
            : 0;
        let calc = az + orientation;
        calc %= 2 * Math.PI;
        if (calc < 0) calc += 2 * Math.PI;
        const residual = this.wrapToPi(obs.obs - calc);
        obs.calc = calc;
        obs.residual = residual;
        obs.stdRes = obs.stdDev > 0 ? residual / obs.stdDev : 0;
        ranked.push({ obsId: obs.id, type: obs.type, diff: Math.abs(residual) });
        return;
      }
      if (obs.type === 'lev') {
        const s1 = this.stations[obs.from];
        const s2 = this.stations[obs.to];
        if (!s1 || !s2) return;
        const calc = s2.h - s1.h;
        const residual = obs.obs - calc;
        obs.calc = calc;
        obs.residual = residual;
        obs.stdRes = obs.stdDev > 0 ? residual / obs.stdDev : 0;
        ranked.push({ obsId: obs.id, type: obs.type, diff: Math.abs(residual) });
        return;
      }
      if (obs.type === 'zenith') {
        const geom = this.getModeledZenith(obs);
        const calc = geom.z;
        const residual = ((obs.obs - calc + Math.PI) % (2 * Math.PI)) - Math.PI;
        obs.calc = calc;
        obs.residual = residual;
        obs.stdRes = obs.stdDev > 0 ? residual / obs.stdDev : 0;
        ranked.push({ obsId: obs.id, type: obs.type, diff: Math.abs(residual) });
        return;
      }
      if (obs.type === 'gps') {
        const corrected = this.gpsObservedVector(obs);
        const calc = this.gpsModeledVector(obs);
        const residual = {
          vE: corrected.dE - calc.dE,
          vN: corrected.dN - calc.dN,
          vU:
            !this.is2D &&
            Number.isFinite(corrected.dU ?? Number.NaN) &&
            Number.isFinite(calc.dU ?? Number.NaN)
              ? (corrected.dU as number) - (calc.dU as number)
              : undefined,
        };
        obs.calc = calc;
        obs.residual = residual;
        const cov = this.gpsCovariance(obs);
        const sigmaE = Math.sqrt(Math.max(cov.cEE, 1e-12));
        const sigmaN = Math.sqrt(Math.max(cov.cNN, 1e-12));
        const sigmaU = Math.sqrt(Math.max(cov.cUU ?? 1e-12, 1e-12));
        obs.stdRes = Math.sqrt(
          (residual.vE / sigmaE) ** 2 +
            (residual.vN / sigmaN) ** 2 +
            ((residual.vU ?? 0) / sigmaU) ** 2,
        );
        ranked.push({
          obsId: obs.id,
          type: obs.type,
          diff: Math.sqrt(
            residual.vE * residual.vE +
              residual.vN * residual.vN +
              (residual.vU ?? 0) * (residual.vU ?? 0),
          ),
        });
      }
    });

    ranked
      .sort((a, b) => b.diff - a.diff)
      .slice(0, 25)
      .forEach((row, idx) => {
        this.log(
          `  Difference #${idx + 1}: obs ${row.obsId} [${row.type}] |diff|=${row.diff.toExponential(6)}`,
        );
      });
    this.log('Data Check Only complete.');
    return this.buildResult();
  }

  private runBlunderDetectWorkflow(
    runModeDiagnostics: RunModeCompatibilityDiagnostic[],
  ): AdjustmentResult {
    const baseOptions: Partial<ParseOptions> = {
      ...(this.parseOptions ?? {}),
      runMode: 'adjustment',
      preanalysisMode: false,
      robustMode: 'none',
      autoAdjustEnabled: false,
      clusterPassLabel: this.parseOptions?.clusterPassLabel ?? 'single',
    };
    let workingOverrides = { ...(this.overrides ?? {}) };
    const cycleLogs: string[] = [];
    const maxCycles = 3;
    const threshold = 3;
    let finalResult: AdjustmentResult | null = null;

    for (let cycle = 1; cycle <= maxCycles; cycle += 1) {
      const solved = this.solveNestedScenario(baseOptions, workingOverrides);
      finalResult = solved;
      const ranked = [...solved.observations]
        .filter((obs) => Number.isFinite(obs.stdRes))
        .sort((a, b) => Math.abs(b.stdRes ?? 0) - Math.abs(a.stdRes ?? 0));
      const top = ranked[0];
      if (!top || Math.abs(top.stdRes ?? 0) < threshold) {
        cycleLogs.push(
          `Blunder cycle ${cycle}: stop (max |t| ${Math.abs(top?.stdRes ?? 0).toFixed(3)} < ${threshold.toFixed(3)}).`,
        );
        break;
      }
      workingOverrides[top.id] = {
        ...(workingOverrides[top.id] ?? {}),
        stdDev: Math.max((top.stdDev ?? 1) * 4, 1e-9),
      };
      cycleLogs.push(
        `Blunder cycle ${cycle}: deweight obs ${top.id} (${top.type}, line=${top.sourceLine ?? '-'}) |t|=${Math.abs(top.stdRes ?? 0).toFixed(3)} newSigma=${workingOverrides[top.id].stdDev?.toExponential(6)}.`,
      );
    }

    if (!finalResult) {
      this.converged = false;
      this.runMode = 'blunder-detect';
      this.runModeCompatibilityDiagnostics = [...runModeDiagnostics];
      if (this.parseState) {
        this.parseState.runMode = 'blunder-detect';
        this.parseState.runModeCompatibilityDiagnostics = [...runModeDiagnostics];
      }
      this.emitRunModeCompatibilityDiagnostics(runModeDiagnostics);
      this.log('Error: blunder-detect workflow could not produce a solve result.');
      return this.buildResult();
    }
    const mergedParseState = finalResult.parseState
      ? ({
          ...finalResult.parseState,
          runMode: 'blunder-detect' as const,
          runModeCompatibilityDiagnostics: [...runModeDiagnostics],
        } as ParseOptions)
      : undefined;
    const runModeCompatibilityLines = runModeCompatibilityDiagnosticLines(runModeDiagnostics);
    return {
      ...finalResult,
      parseState: mergedParseState,
      logs: [
        ...runModeCompatibilityLines,
        'Blunder Detect mode: iterative deweighting diagnostics (not a replacement for full adjustment QA).',
        ...cycleLogs,
        ...finalResult.logs,
      ],
    };
  }

  private runAutoAdjustWorkflow(): AdjustmentResult {
    const requestedConfig: AutoAdjustConfig = {
      enabled: this.parseOptions?.autoAdjustEnabled === true,
      maxCycles: this.parseOptions?.autoAdjustMaxCycles ?? 3,
      maxRemovalsPerCycle: this.parseOptions?.autoAdjustMaxRemovalsPerCycle ?? 1,
      stdResThreshold: this.parseOptions?.autoAdjustStdResThreshold ?? 4,
      minRedundancy: 0.05,
    };
    const baseOptions: Partial<ParseOptions> = {
      ...(this.parseOptions ?? {}),
      autoAdjustEnabled: false,
    };
    const initialExcludedIds = new Set(this.excludeIds ?? []);
    const summary = runAutoAdjustCycles(initialExcludedIds, requestedConfig, (trialExclusions) =>
      this.solveNestedScenario(baseOptions, this.overrides, trialExclusions),
    );
    const finalResult = this.solveNestedScenario(
      baseOptions,
      this.overrides,
      summary.finalExcludedIds,
    );
    const mergedParseState = finalResult.parseState
      ? ({
          ...finalResult.parseState,
          autoAdjustEnabled: requestedConfig.enabled,
          autoAdjustMaxCycles: summary.config.maxCycles,
          autoAdjustMaxRemovalsPerCycle: summary.config.maxRemovalsPerCycle,
          autoAdjustStdResThreshold: summary.config.stdResThreshold,
        } as ParseOptions)
      : undefined;
    const autoAdjustDiagnostics = {
      enabled: true,
      threshold: summary.config.stdResThreshold,
      maxCycles: summary.config.maxCycles,
      maxRemovalsPerCycle: summary.config.maxRemovalsPerCycle,
      minRedundancy: summary.config.minRedundancy ?? 0.05,
      stopReason: summary.stopReason,
      cycles: summary.cycles.map((cycle) => ({
        cycle: cycle.cycle,
        seuw: cycle.seuw,
        maxAbsStdRes: cycle.maxAbsStdRes,
        removals: [...cycle.removals],
      })),
      removed: summary.cycles.flatMap((cycle) => cycle.removals),
    };
    return {
      ...finalResult,
      parseState: mergedParseState,
      autoAdjustDiagnostics,
      logs: [...formatAutoAdjustLogLines(summary), ...finalResult.logs],
    };
  }

  solve(): AdjustmentResult {
    this.solveStartedAt = Date.now();
    this.resetSolveTiming();
    this.emitSolveProgress('start');
    const requestedRunMode: RunMode =
      this.parseOptions?.runMode ??
      (this.parseOptions?.preanalysisMode ? 'preanalysis' : 'adjustment');
    const runModeCompatibility = resolveRunModeCompatibilityOptions(
      requestedRunMode,
      this.parseOptions ?? {},
    );
    this.parseOptions = runModeCompatibility.effectiveOptions;
    this.runModeCompatibilityDiagnostics = [...runModeCompatibility.diagnostics];
    const clusterWorkflowResult = runClusterDualPassWorkflow({
      requestedRunMode,
      parseOptions: this.parseOptions,
      solveScenario: (parseOptions, overrides) => this.solveNestedScenario(parseOptions, overrides),
      overrides: this.overrides,
    });
    if (clusterWorkflowResult) {
      return clusterWorkflowResult;
    }

    let parseAndSetupStartedAt = Date.now();
    const finishParseAndSetupTiming = () => {
      if (parseAndSetupStartedAt <= 0) return;
      this.solveTiming.parseAndSetupMs += Date.now() - parseAndSetupStartedAt;
      parseAndSetupStartedAt = 0;
    };
    const parsed = this.parsedResult
      ? cloneParsedResultValue(this.parsedResult)
      : parseInput(this.input, this.instrumentLibrary, this.parseOptions);
    this.stations = parsed.stations;
    this.observations = parsed.observations;
    this.unknowns = parsed.unknowns;
    this.instrumentLibrary = parsed.instrumentLibrary;
    this.logs = [...parsed.logs];
    this.directionRejectDiagnostics = parsed.directionRejectDiagnostics ?? [];
    const parseRunMode =
      parsed.parseState?.runMode ??
      this.parseOptions?.runMode ??
      (parsed.parseState?.preanalysisMode ? 'preanalysis' : 'adjustment');
    this.runMode = parseRunMode;
    const includeErrors = parsed.parseState?.includeErrors ?? [];
    if (includeErrors.length > 0) {
      this.converged = false;
      this.iterations = 0;
      this.dof = 0;
      this.seuw = 0;
      this.parseState = parsed.parseState;
      if (this.parseState) {
        this.parseState.runModeCompatibilityDiagnostics = [...this.runModeCompatibilityDiagnostics];
      }
      this.emitRunModeCompatibilityDiagnostics(this.runModeCompatibilityDiagnostics);
      this.logs.push(
        `Run failed: include preprocessing reported ${includeErrors.length} error(s).`,
      );
      includeErrors.forEach((error) => {
        this.logs.push(
          `  include-error ${error.code} at ${error.sourceFile}:${error.line}${error.includePath ? ` (${error.includePath})` : ''}: ${error.message}`,
        );
      });
      finishParseAndSetupTiming();
      return this.buildResult();
    }
    this.coordMode = parsed.parseState?.coordMode ?? this.parseOptions?.coordMode ?? '3D';
    this.addCenteringToExplicit = parsed.parseState?.addCenteringToExplicit ?? false;
    this.applyCentering = parsed.parseState?.applyCentering ?? true;
    this.debug = parsed.parseState?.debug ?? false;
    this.mapMode = parsed.parseState?.mapMode ?? this.parseOptions?.mapMode ?? 'off';
    this.mapScaleFactor =
      parsed.parseState?.mapScaleFactor ?? this.parseOptions?.mapScaleFactor ?? 1;
    this.coordSystemMode =
      parsed.parseState?.coordSystemMode ?? this.parseOptions?.coordSystemMode ?? 'local';
    this.crsId = parsed.parseState?.crsId ?? this.parseOptions?.crsId ?? 'CA_NAD83_CSRS_UTM_20N';
    this.localDatumScheme =
      parsed.parseState?.localDatumScheme ?? this.parseOptions?.localDatumScheme ?? 'average-scale';
    this.averageScaleFactor =
      parsed.parseState?.averageScaleFactor ?? this.parseOptions?.averageScaleFactor ?? 1;
    if (!Number.isFinite(this.averageScaleFactor) || this.averageScaleFactor <= 0) {
      this.averageScaleFactor = 1;
    }
    this.scaleOverrideActive =
      parsed.parseState?.scaleOverrideActive ?? this.parseOptions?.scaleOverrideActive ?? false;
    this.commonElevation =
      parsed.parseState?.commonElevation ?? this.parseOptions?.commonElevation ?? 0;
    if (!Number.isFinite(this.commonElevation)) this.commonElevation = 0;
    this.averageGeoidHeight =
      parsed.parseState?.averageGeoidHeight ?? this.parseOptions?.averageGeoidHeight ?? 0;
    if (!Number.isFinite(this.averageGeoidHeight)) this.averageGeoidHeight = 0;
    this.crsGridScaleEnabled =
      parsed.parseState?.crsGridScaleEnabled ?? this.parseOptions?.crsGridScaleEnabled ?? false;
    this.crsGridScaleFactor =
      parsed.parseState?.crsGridScaleFactor ?? this.parseOptions?.crsGridScaleFactor ?? 1;
    if (!Number.isFinite(this.crsGridScaleFactor) || this.crsGridScaleFactor <= 0) {
      this.crsGridScaleFactor = 1;
    }
    this.crsConvergenceEnabled =
      parsed.parseState?.crsConvergenceEnabled ?? this.parseOptions?.crsConvergenceEnabled ?? false;
    this.crsConvergenceAngleRad =
      parsed.parseState?.crsConvergenceAngleRad ?? this.parseOptions?.crsConvergenceAngleRad ?? 0;
    if (!Number.isFinite(this.crsConvergenceAngleRad)) {
      this.crsConvergenceAngleRad = 0;
    }
    this.geoidModelEnabled =
      parsed.parseState?.geoidModelEnabled ?? this.parseOptions?.geoidModelEnabled ?? false;
    this.geoidModelId = (parsed.parseState?.geoidModelId ??
      this.parseOptions?.geoidModelId ??
      'NGS-DEMO') as string;
    this.geoidSourceFormat =
      parsed.parseState?.geoidSourceFormat ?? this.parseOptions?.geoidSourceFormat ?? 'builtin';
    if (
      this.geoidSourceFormat !== 'builtin' &&
      this.geoidSourceFormat !== 'gtx' &&
      this.geoidSourceFormat !== 'byn'
    ) {
      this.geoidSourceFormat = 'builtin';
    }
    this.geoidSourcePath = String(
      parsed.parseState?.geoidSourcePath ?? this.parseOptions?.geoidSourcePath ?? '',
    ).trim();
    this.geoidInterpolation =
      parsed.parseState?.geoidInterpolation ?? this.parseOptions?.geoidInterpolation ?? 'bilinear';
    this.geoidHeightConversionEnabled =
      parsed.parseState?.geoidHeightConversionEnabled ??
      this.parseOptions?.geoidHeightConversionEnabled ??
      false;
    this.geoidOutputHeightDatum =
      parsed.parseState?.geoidOutputHeightDatum ??
      this.parseOptions?.geoidOutputHeightDatum ??
      'orthometric';
    if (this.geoidOutputHeightDatum !== 'ellipsoid') {
      this.geoidOutputHeightDatum = 'orthometric';
    }
    this.applyCurvatureRefraction =
      parsed.parseState?.applyCurvatureRefraction ??
      this.parseOptions?.applyCurvatureRefraction ??
      false;
    this.refractionCoefficient =
      parsed.parseState?.refractionCoefficient ?? this.parseOptions?.refractionCoefficient ?? 0.13;
    this.verticalReduction =
      parsed.parseState?.verticalReduction ?? this.parseOptions?.verticalReduction ?? 'none';
    this.tsCorrelationEnabled =
      parsed.parseState?.tsCorrelationEnabled ?? this.parseOptions?.tsCorrelationEnabled ?? false;
    this.tsCorrelationRho =
      parsed.parseState?.tsCorrelationRho ?? this.parseOptions?.tsCorrelationRho ?? 0.25;
    this.tsCorrelationScope =
      parsed.parseState?.tsCorrelationScope ?? this.parseOptions?.tsCorrelationScope ?? 'set';
    const resolvedPreanalysisMode =
      parsed.parseState?.preanalysisMode ?? this.parseOptions?.preanalysisMode ?? false;
    this.preanalysisMode =
      this.runMode === 'preanalysis'
        ? true
        : this.runMode === 'data-check' || this.runMode === 'blunder-detect'
          ? false
          : resolvedPreanalysisMode;
    this.robustMode = parsed.parseState?.robustMode ?? this.parseOptions?.robustMode ?? 'none';
    this.robustK = parsed.parseState?.robustK ?? this.parseOptions?.robustK ?? 1.5;
    if (this.preanalysisMode || this.runMode === 'data-check') {
      this.robustMode = 'none';
    }
    this.prismEnabled = parsed.parseState?.prismEnabled ?? this.parseOptions?.prismEnabled ?? false;
    this.prismOffset = parsed.parseState?.prismOffset ?? this.parseOptions?.prismOffset ?? 0;
    this.prismScope = parsed.parseState?.prismScope ?? this.parseOptions?.prismScope ?? 'global';
    this.clusterDetectionEnabled =
      parsed.parseState?.clusterDetectionEnabled ??
      this.parseOptions?.clusterDetectionEnabled ??
      true;
    this.clusterLinkageMode =
      parsed.parseState?.clusterLinkageMode ?? this.parseOptions?.clusterLinkageMode ?? 'single';
    this.clusterTolerance2D =
      parsed.parseState?.clusterTolerance2D ?? this.parseOptions?.clusterTolerance2D ?? 0.03;
    this.clusterTolerance3D =
      parsed.parseState?.clusterTolerance3D ?? this.parseOptions?.clusterTolerance3D ?? 0.05;
    this.levelLoopToleranceBaseMm =
      parsed.parseState?.levelLoopToleranceBaseMm ??
      this.parseOptions?.levelLoopToleranceBaseMm ??
      LEVEL_LOOP_DEFAULT_BASE_MM;
    this.levelLoopTolerancePerSqrtKmMm =
      parsed.parseState?.levelLoopTolerancePerSqrtKmMm ??
      this.parseOptions?.levelLoopTolerancePerSqrtKmMm ??
      LEVEL_LOOP_DEFAULT_PER_SQRT_KM_MM;
    const gpsLoopCheckEnabled =
      parsed.parseState?.gpsLoopCheckEnabled ?? this.parseOptions?.gpsLoopCheckEnabled ?? false;
    this.gnssFrameConfirmed =
      parsed.parseState?.gnssFrameConfirmed ?? this.parseOptions?.gnssFrameConfirmed ?? false;
    this.geometryDependentSigmaReference =
      parsed.parseState?.geometryDependentSigmaReference ??
      this.parseOptions?.geometryDependentSigmaReference ??
      'current';
    this.parseState = parsed.parseState;
    if (this.parseState) {
      this.parseState.geometryDependentSigmaReference = this.geometryDependentSigmaReference;
      this.parseState.runMode = this.runMode;
      this.parseState.preanalysisMode = this.preanalysisMode;
      this.parseState.runModeCompatibilityDiagnostics = [...this.runModeCompatibilityDiagnostics];
      this.parseState.coordSystemMode = this.coordSystemMode;
      this.parseState.crsId = this.crsId;
      this.parseState.localDatumScheme = this.localDatumScheme;
      this.parseState.averageScaleFactor = this.averageScaleFactor;
      this.parseState.scaleOverrideActive = this.scaleOverrideActive;
      this.parseState.commonElevation = this.commonElevation;
      this.parseState.averageGeoidHeight = this.averageGeoidHeight;
      this.parseState.geoidSourceFormat = this.geoidSourceFormat;
      this.parseState.geoidSourcePath = this.geoidSourcePath;
      this.parseState.geoidSourceResolvedFormat = this.geoidSourceFormat;
      this.parseState.geoidSourceFallbackUsed = false;
      this.parseState.reductionContext = this.parseState.reductionContext ?? {
        inputSpaceDefault:
          (this.parseState.gridDistanceMode ?? 'measured') === 'measured' ? 'measured' : 'grid',
        distanceKind:
          (this.parseState.gridDistanceMode ?? 'measured') === 'ellipsoidal'
            ? 'ellipsoidal'
            : (this.parseState.gridDistanceMode ?? 'measured') === 'grid'
              ? 'grid'
              : 'ground',
        bearingKind: this.parseState.gridBearingMode ?? 'grid',
        explicitOverrideActive: this.scaleOverrideActive,
      };
      this.parseState.observationMode = {
        bearing: this.parseState.gridBearingMode ?? 'grid',
        distance: this.parseState.gridDistanceMode ?? 'measured',
        angle: this.parseState.gridAngleMode ?? 'measured',
        direction: this.parseState.gridDirectionMode ?? 'measured',
      };
      this.parseState.gnssFrameConfirmed = this.gnssFrameConfirmed;
      this.parseState.gnssVectorFrameDefault =
        this.parseState.gnssVectorFrameDefault ??
        this.parseOptions?.gnssVectorFrameDefault ??
        'gridNEU';
      this.parseState.gpsLoopCheckEnabled = gpsLoopCheckEnabled;
      this.parseState.levelLoopToleranceBaseMm = this.levelLoopToleranceBaseMm;
      this.parseState.levelLoopTolerancePerSqrtKmMm = this.levelLoopTolerancePerSqrtKmMm;
      this.parseState.geoidHeightConversionEnabled = this.geoidHeightConversionEnabled;
      this.parseState.geoidOutputHeightDatum = this.geoidOutputHeightDatum;
      this.parseState.geoidModelLoaded = false;
      this.parseState.geoidModelMetadata = '';
      this.parseState.geoidSampleUndulationM = undefined;
      this.parseState.geoidConvertedStationCount = 0;
      this.parseState.geoidSkippedStationCount = 0;
      this.parseState.coordSystemDiagnostics = [];
      this.parseState.coordSystemWarningMessages = [];
      this.parseState.crsStatus = this.coordSystemMode === 'grid' ? 'off' : undefined;
      this.parseState.crsOffReason = this.coordSystemMode === 'grid' ? 'noCRSSelected' : undefined;
      this.parseState.crsDatumOpId = '';
      this.parseState.crsDatumFallbackUsed = false;
      this.parseState.crsAreaOfUseStatus = 'unknown';
      this.parseState.crsOutOfAreaStationCount = 0;
      this.parseState.usedInSolveUsageSummary = undefined;
    }
    this.is2D = this.coordMode === '2D';
    this.condition = undefined;
    this.controlConstraints = undefined;
    this.sideshots = undefined;
    this.autoSideshotDiagnostics = undefined;
    this.tsCorrelationDiagnostics = undefined;
    this.robustDiagnostics = undefined;
    this.residualDiagnostics = undefined;
    this.clusterDiagnostics = undefined;
    this.gpsLoopDiagnostics = undefined;
    this.levelingLoopDiagnostics = undefined;
    this.chiSquare = undefined;
    this.statisticalSummary = undefined;
    this.typeSummary = undefined;
    this.relativePrecision = undefined;
    this.stationCovariances = undefined;
    this.relativeCovariances = undefined;
    this.precisionModels = undefined;
    this.weakGeometryDiagnostics = undefined;
    this.conditionWarned = false;
    this.initialSigmaGeometryStations = {};
    this.initialSigmaAzimuthCache.clear();
    this.initialSigmaZenithCache.clear();
    this.clearCoordSystemDiagnostics();
    this.clearGeometryCache();
    if (this.coordSystemMode !== 'grid') {
      this.setCrsOff('disabledByProfile');
    } else if (!this.crsId || !this.crsId.trim()) {
      this.setCrsOff('noCRSSelected', 'Grid coordinate mode is active but CRS id is missing.');
    } else {
      this.setCrsOff('noInverseAvailable');
    }

    if ((this.directionRejectDiagnostics?.length ?? 0) > 0) {
      this.log(`Direction rejects captured: ${this.directionRejectDiagnostics?.length}`);
    }

    if (this.mapMode !== 'off') {
      this.log(
        `Map reduction active: mode=${this.mapMode}, scale=${this.mapScaleFactor.toFixed(8)}`,
      );
    }
    this.log(
      `Coordinate system mode: ${this.coordSystemMode.toUpperCase()}${this.coordSystemMode === 'grid' ? ` (CRS=${this.crsId})` : ` (datum=${this.localDatumScheme}, scale=${this.averageScaleFactor.toFixed(8)}, commonElev=${this.commonElevation.toFixed(4)}m)`}`,
    );
    if (this.crsGridScaleEnabled) {
      this.log(`CRS grid-ground scale active: factor=${this.crsGridScaleFactor.toFixed(8)}`);
    }
    if (this.crsConvergenceEnabled) {
      this.log(
        `CRS convergence active: angle=${(this.crsConvergenceAngleRad * RAD_TO_DEG).toFixed(6)} deg`,
      );
    }
    let geoidModel: GeoidGridModel | null = null;
    this.activeGeoidModel = null;
    if (this.geoidModelEnabled) {
      const loaded = loadGeoidGridModel({
        modelId: this.geoidModelId,
        sourceFormat: this.geoidSourceFormat ?? 'builtin',
        sourcePath: this.geoidSourcePath,
        sourceData: this.geoidSourceData,
      });
      if (loaded.model) {
        geoidModel = loaded.model;
        this.activeGeoidModel = geoidModel;
        const metadata = geoidGridMetadataSummary(loaded.model);
        if (this.parseState) {
          this.parseState.geoidModelLoaded = true;
          this.parseState.geoidModelMetadata = metadata;
          this.parseState.geoidModelId = loaded.model.id;
          this.parseState.geoidInterpolation = this.geoidInterpolation ?? 'bilinear';
          this.parseState.geoidSourceResolvedFormat = loaded.resolvedFormat;
          this.parseState.geoidSourceFallbackUsed = loaded.fallbackUsed;
        }
        if (loaded.warning) this.log(`Warning: ${loaded.warning}`);
        this.log(
          `Geoid/grid model loaded: ${metadata} (interp=${(this.geoidInterpolation ?? 'bilinear').toUpperCase()}, format=${loaded.resolvedFormat.toUpperCase()}, fallback=${loaded.fallbackUsed ? 'YES' : 'NO'}, cache=${loaded.fromCache ? 'HIT' : 'MISS'})`,
        );
        const originLat = this.parseState?.originLatDeg;
        const originLon = this.parseState?.originLonDeg;
        if (originLat != null && originLon != null) {
          const undulation = interpolateGeoidUndulation(
            loaded.model,
            originLat,
            originLon,
            this.geoidInterpolation ?? 'bilinear',
          );
          if (undulation != null && Number.isFinite(undulation)) {
            if (this.parseState) this.parseState.geoidSampleUndulationM = undulation;
            this.log(
              `Geoid sample at geodetic origin: N=${undulation.toFixed(4)} m (lat=${originLat.toFixed(
                6,
              )}, lon=${originLon.toFixed(6)})`,
            );
          } else {
            this.log(
              `Geoid sample unavailable: origin (${originLat.toFixed(6)}, ${originLon.toFixed(
                6,
              )}) is outside model coverage.`,
            );
          }
        }
      } else {
        this.activeGeoidModel = null;
        if (this.parseState) {
          this.parseState.geoidModelLoaded = false;
          this.parseState.geoidModelMetadata = loaded.warning ?? '';
          this.parseState.geoidSourceResolvedFormat = loaded.resolvedFormat;
          this.parseState.geoidSourceFallbackUsed = loaded.fallbackUsed;
        }
        this.log(`Warning: ${loaded.warning ?? 'failed to load geoid/grid model.'}`);
      }
    }
    if (this.geoidHeightConversionEnabled) {
      if (!this.geoidModelEnabled) {
        this.applyAverageGeoidHeightConversions();
      } else if (!geoidModel) {
        this.applyAverageGeoidHeightConversions();
      } else {
        this.applyGeoidHeightConversions(geoidModel);
      }
    }
    if (this.coordSystemMode === 'grid') {
      this.evaluateCrsAreaOfUseCoverage();
      if (this.crsDatumOpId) {
        this.log(`CRS datum operation: ${this.crsDatumOpId}`);
      }
      if (this.crsAreaOfUseStatus === 'inside') {
        this.log('CRS area-of-use check: all evaluated stations are inside area bounds.');
      } else if (this.crsAreaOfUseStatus === 'outside') {
        this.log(
          `CRS area-of-use check: ${this.crsOutOfAreaStationCount} station(s) outside configured area bounds (warning-only).`,
        );
      } else {
        this.log(
          'CRS area-of-use check: unavailable (no CRS bounds metadata or no geodetic stations).',
        );
      }
    }
    if (this.applyCurvatureRefraction && this.verticalReduction === 'curvref') {
      this.log(
        `Vertical reduction active: curvature/refraction (k=${this.refractionCoefficient.toFixed(
          3,
        )})`,
      );
    }
    if (this.tsCorrelationEnabled && this.tsCorrelationRho > 0) {
      this.log(
        `TS angular correlation active: scope=${this.tsCorrelationScope}, rho=${this.tsCorrelationRho.toFixed(3)}`,
      );
    }
    if (this.preanalysisMode) {
      this.log(
        'Preanalysis mode active: residual-based QC, chi-square, and robust reweighting are disabled.',
      );
    } else if (this.robustMode === 'huber') {
      this.robustDiagnostics = {
        enabled: true,
        mode: 'huber',
        k: Math.max(0.5, Math.min(10, this.robustK || 1.5)),
        iterations: [],
        topDownweightedRows: [],
      };
      this.log(
        `Robust reweighting active: mode=${this.robustMode}, k=${this.robustDiagnostics.k.toFixed(2)}`,
      );
    }
    let distCount = 0;
    let zenithCount = 0;
    this.observations.forEach((obs) => {
      const correction = this.prismCorrectionForObservation(obs);
      if (Math.abs(correction) <= 0) return;
      if (obs.type === 'dist') distCount += 1;
      if (obs.type === 'zenith') zenithCount += 1;
    });
    if (distCount > 0 || zenithCount > 0) {
      this.log(
        `Prism correction active: distRows=${distCount}, zenithRows=${zenithCount}, currentState=${this.prismEnabled ? `ON(${this.prismOffset.toFixed(4)}m,${this.prismScope})` : 'OFF'}`,
      );
    } else if (
      this.prismEnabled &&
      Number.isFinite(this.prismOffset) &&
      Math.abs(this.prismOffset) > 0
    ) {
      this.log(
        `Prism correction configured but no eligible rows: offset=${this.prismOffset.toFixed(4)}m, scope=${this.prismScope}`,
      );
    }

    // Apply overrides before any unit normalization
    if (this.overrides) {
      this.observations.forEach((obs) => {
        const over = this.overrides?.[obs.id];
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

    if (this.preanalysisMode) {
      this.populatePreanalysisObservations();
    }

    this.updateGpsAddHiHtDiagnostics();
    const activeObservations = this.collectActiveObservations();
    this.bootstrapApproximateTraverseCoords(activeObservations);
    this.captureRawTraverseDistanceFactorSnapshots(activeObservations);
    if (this.parseState) {
      this.parseState.usedInSolveUsageSummary = summarizeReductionUsage(activeObservations);
      this.parseState.parsedUsageSummary =
        this.parseState.parsedUsageSummary ?? summarizeReductionUsage(this.observations);
    }
    if (
      this.runMode === 'blunder-detect' &&
      activeObservations.length > 0 &&
      activeObservations.every((obs) => obs.type === 'lev')
    ) {
      const levelingOnlyError: RunModeCompatibilityDiagnostic = {
        code: 'BLUNDER_LEVELING_ONLY',
        severity: 'error',
        message: 'Blunder Detect mode is not supported for leveling-only datasets.',
        action: 'Use adjustment or data-check mode for this dataset.',
      };
      this.runModeCompatibilityDiagnostics = [
        ...this.runModeCompatibilityDiagnostics,
        levelingOnlyError,
      ];
      if (this.parseState) {
        this.parseState.runModeCompatibilityDiagnostics = [...this.runModeCompatibilityDiagnostics];
      }
      this.emitRunModeCompatibilityDiagnostics(this.runModeCompatibilityDiagnostics);
      this.converged = false;
      return this.finishSolve(this.buildResult());
    }
    if (this.runMode === 'blunder-detect') {
      return this.finishSolve(this.runBlunderDetectWorkflow(this.runModeCompatibilityDiagnostics));
    }

    this.emitRunModeCompatibilityDiagnostics(this.runModeCompatibilityDiagnostics);
    if (this.runMode === 'data-check') {
      finishParseAndSetupTiming();
      return this.finishSolve(this.runDataCheckOnly(activeObservations));
    }
    if (this.runMode === 'adjustment' && (this.parseOptions?.autoAdjustEnabled ?? false)) {
      finishParseAndSetupTiming();
      return this.finishSolve(this.runAutoAdjustWorkflow());
    }
    const gridInputGate = this.evaluateGridInputGate(activeObservations);
    if (gridInputGate.blocked) {
      this.addCoordSystemDiagnostic('CRS_INPUT_MIX_BLOCKED');
      if (gridInputGate.reasons.some((reason) => reason.toUpperCase().includes('UNKNOWN FRAME'))) {
        this.addCoordSystemDiagnostic('GNSS_FRAME_UNCONFIRMED');
      }
      gridInputGate.reasons.forEach((reason) => this.log(`Error: ${reason}`));
      gridInputGate.suggestions.forEach((suggestion) => this.log(`Suggestion: ${suggestion}`));
      this.datumSufficiencyReport = {
        status: 'hard-fail',
        reasons: [...gridInputGate.reasons],
        suggestions: [...gridInputGate.suggestions],
      };
      if (this.parseState) {
        this.parseState.datumSufficiencyReport = this.datumSufficiencyReport;
      }
      finishParseAndSetupTiming();
      return this.finishSolve(this.buildResult());
    }
    this.datumSufficiencyReport = this.evaluateDatumSufficiency(activeObservations);
    if (this.datumSufficiencyReport.status === 'hard-fail') {
      this.addCoordSystemDiagnostic('DATUM_HARD_FAIL');
      this.datumSufficiencyReport.reasons.forEach((reason) => this.log(`Error: ${reason}`));
      this.datumSufficiencyReport.suggestions.forEach((suggestion) =>
        this.log(`Suggestion: ${suggestion}`),
      );
      if (this.parseState) {
        this.parseState.datumSufficiencyReport = this.datumSufficiencyReport;
      }
      finishParseAndSetupTiming();
      return this.finishSolve(this.buildResult());
    }
    if (this.datumSufficiencyReport.status === 'soft-warn') {
      this.addCoordSystemDiagnostic('DATUM_SOFT_WARN');
      this.datumSufficiencyReport.reasons.forEach((reason) => this.log(`Warning: ${reason}`));
      this.datumSufficiencyReport.suggestions.forEach((suggestion) =>
        this.log(`Suggestion: ${suggestion}`),
      );
    }
    if (this.parseState) {
      this.parseState.datumSufficiencyReport = this.datumSufficiencyReport;
    }
    if (gpsLoopCheckEnabled) {
      const gpsNetworkRows = activeObservations.filter(
        (obs): obs is GpsObservation => obs.type === 'gps' && obs.gpsMode !== 'sideshot',
      );
      this.gpsLoopDiagnostics = buildGpsLoopDiagnostics({
        gpsObservations: gpsNetworkRows,
        observedVector: (obs) => this.gpsObservedVector(obs),
        baseToleranceM: GPS_LOOP_BASE_TOLERANCE_M,
        ppmTolerance: GPS_LOOP_TOLERANCE_PPM,
        eps: EPS,
      });
      this.log(
        `GPS loop check: vectors=${this.gpsLoopDiagnostics.vectorCount}, loops=${this.gpsLoopDiagnostics.loopCount}, pass=${this.gpsLoopDiagnostics.passCount}, warn=${this.gpsLoopDiagnostics.warnCount}, tolerance=${this.gpsLoopDiagnostics.thresholds.baseToleranceM.toFixed(3)}m+${this.gpsLoopDiagnostics.thresholds.ppmTolerance}ppm*dist`,
      );
      this.gpsLoopDiagnostics.loops.slice(0, 10).forEach((loop) => {
        this.log(
          `  #${loop.rank} ${loop.key}: path=${loop.stationPath.join('->')} closure(dE=${loop.closureE.toFixed(4)}m,dN=${loop.closureN.toFixed(4)}m,|d|=${loop.closureMag.toFixed(4)}m) tol=${loop.toleranceM.toFixed(4)}m ppm=${loop.linearPpm != null ? loop.linearPpm.toFixed(1) : '-'} sev=${loop.severity.toFixed(2)} status=${loop.pass ? 'PASS' : 'WARN'} lines=${loop.sourceLines.length > 0 ? loop.sourceLines.join(',') : '-'}`,
        );
      });
    }
    const levelingRows = activeObservations.filter(
      (obs): obs is LevelObservation => obs.type === 'lev',
    );
    if (levelingRows.length > 0) {
      this.levelingLoopDiagnostics = buildLevelingLoopDiagnostics({
        levelingObservations: levelingRows,
        baseMm: this.levelLoopToleranceBaseMm,
        perSqrtKmMm: this.levelLoopTolerancePerSqrtKmMm,
        eps: EPS,
      });
      this.log(
        `Leveling loop check: observations=${this.levelingLoopDiagnostics.observationCount}, loops=${this.levelingLoopDiagnostics.loopCount}, totalLength=${this.levelingLoopDiagnostics.totalLengthKm.toFixed(3)}km, tolerance=${this.levelingLoopDiagnostics.thresholds.baseMm.toFixed(3)}mm+${this.levelingLoopDiagnostics.thresholds.perSqrtKmMm.toFixed(3)}mm*sqrt(km)`,
      );
      this.levelingLoopDiagnostics.loops.slice(0, 10).forEach((loop) => {
        this.log(
          `  #${loop.rank} ${loop.key}: path=${loop.stationPath.join('->')} closure=${loop.closure.toFixed(4)}m |closure|=${loop.absClosure.toFixed(4)}m len=${loop.loopLengthKm.toFixed(3)}km tol=${loop.toleranceMm.toFixed(2)}mm mm/sqrt(km)=${loop.closurePerSqrtKmMm.toFixed(2)} status=${loop.pass ? 'PASS' : 'WARN'} lines=${loop.sourceLines.length > 0 ? loop.sourceLines.join(',') : '-'}`,
        );
      });
      this.levelingLoopDiagnostics.suspectSegments.slice(0, 5).forEach((segment) => {
        this.log(
          `  suspect #${segment.rank} ${segment.from}->${segment.to}: line=${segment.sourceLine ?? '-'} warnLoops=${segment.warnLoopCount} score=${segment.suspectScore.toFixed(2)} worst=${segment.worstLoopKey ?? '-'}`,
        );
      });
    }

    if (this.unknowns.length === 0) {
      this.log('No unknown stations to solve.');
      const sideshots = this.computeSideshotResults();
      this.sideshots = sideshots;
      const sideshotCount = sideshots?.length ?? 0;
      if (sideshotCount > 0) {
        this.log(`Sideshots (post-adjust): ${sideshotCount}`);
      }
      finishParseAndSetupTiming();
      return this.finishSolve(this.buildResult());
    }

    const gpsSideshotCount = this.observations.filter(
      (obs) => obs.type === 'gps' && obs.gpsMode === 'sideshot',
    ).length;
    if (gpsSideshotCount > 0) {
      this.log(
        `GPS sideshot vectors excluded from adjustment equations: ${gpsSideshotCount} (post-adjust output only).`,
      );
    }
    if (this.is2D) {
      const skippedVertical = this.observations.filter(
        (o) => (o.type === 'lev' || o.type === 'zenith') && !getObservationSideshotCalcMeta(o),
      ).length;
      if (skippedVertical > 0) {
        this.log(`2D mode: skipped ${skippedVertical} vertical observations (lev/zenith).`);
      }
    }
    this.logNetworkDiagnostics(activeObservations);
    const cachedSolvePreparation = this.solvePreparation;
    const solvePreparation = cachedSolvePreparation
      ? (() => {
          applyAutoDroppedHeightHolds(this.stations, cachedSolvePreparation.autoDroppedHeights);
          return cloneSolvePreparationResult(cachedSolvePreparation);
        })()
      : buildSolvePreparation(this.stations, this.unknowns, activeObservations, this.is2D);
    if (solvePreparation.autoDroppedHeights.length > 0) {
      this.log(
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
    this.directionOrientations = {};
    this.computeDirectionSetPrefit(activeObservations, directionSetIds);
    this.paramIndex = paramIndex;
    this.controlConstraints = controlConstraints;
    this.captureInitialSigmaGeometrySnapshot();
    if (constraints.length) {
      this.log(
        `Weighted control constraints: ${constraints.length} (E=${this.controlConstraints.x}, N=${this.controlConstraints.y}, H=${this.controlConstraints.h}, corrXY=${this.controlConstraints.xyCorrelated ?? 0})`,
      );
    }
    this.dof = numObsEquations - numParams;
    if (this.dof < 0) {
      this.log('Error: Redundancy < 0. Under-determined.');
      finishParseAndSetupTiming();
      return this.finishSolve(this.buildResult());
    }
    finishParseAndSetupTiming();
    let prevObjectiveBefore: number | null = null;

    for (let iter = 0; iter < this.maxIterations; iter++) {
      this.iterations += 1;
      this.clearGeometryCache();
      const assemblyStartedAt = Date.now();
      const { A, L, P, rowInfo, sparseRows } = assembleAdjustmentEquations(
        {
          stations: this.stations,
          paramIndex: this.paramIndex,
          is2D: this.is2D,
          debug: this.debug,
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
          logObsDebug: this.logObsDebug.bind(this),
        },
        activeObservations,
        constraints,
        numObsEquations,
        numParams,
        iter + 1,
        { includeDenseA: false },
      );
      this.solveTiming.equationAssemblyMs += Date.now() - assemblyStartedAt;

      const factorizationStartedAt = Date.now();
      try {
        const iterationResult = solveAdjustmentIteration(
          {
            robustMode: this.robustMode,
            solveNormalEquations: this.solveNormalEquations.bind(this),
            estimateCondition: this.estimateCondition.bind(this),
            recordConditionEstimate: this.recordConditionEstimate.bind(this),
            captureRobustWeightBase: this.captureRobustWeightBase.bind(this),
            applyRobustWeightFactors: this.applyRobustWeightFactors.bind(this),
            computeRobustWeightSummary: this.computeRobustWeightSummary.bind(this),
            maxRobustWeightDelta: this.maxRobustWeightDelta.bind(this),
            recordRobustDiagnostics: this.recordRobustDiagnostics.bind(this),
            weightedQuadratic: this.weightedQuadratic.bind(this),
          },
          A ?? [],
          L,
          P,
          rowInfo,
          iter + 1,
          { sparseRows, numParams },
        );
        this.solveTiming.matrixFactorizationMs += Date.now() - factorizationStartedAt;
        this.Qxx = iterationResult.qxx ?? null;
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

        if (this.debug) {
          const ratio = sumBefore > 0 ? sumAfter / sumBefore : 0;
          const msg =
            `Iter ${iter + 1} step check: ` +
            `weightedV0=${sumBefore.toExponential(3)} ` +
            `weightedV1=${sumAfter.toExponential(3)} ` +
            `ratio=${ratio.toFixed(3)} ` +
            `max|w|=${maxBefore.toExponential(3)} ` +
            `max|wnew|=${maxAfter.toExponential(3)}`;
          this.logs.push(msg);
          if (ratio > 1.05) {
            this.logs.push(
              `Warning: Iter ${iter + 1} predicted residuals increased. ` +
                `Check sign convention and angle/zenith units (radians vs degrees).`,
            );
          }
        }

        if (this.preanalysisMode) {
          this.converged = true;
          this.log(`Iter ${iter + 1}: Max Corr = 0.0000`);
          this.log(
            `Iter ${iter + 1}: preanalysis geometry held at approximate coordinates; covariance assembled from the current planning geometry.`,
          );
          this.log(
            'Converged: preanalysis uses the approximate-geometry covariance build without iterative coordinate updates.',
          );
          this.emitSolveProgress('iteration');
          break;
        }

        const maxCorrection = applyAdjustmentCorrections(
          this.stations,
          this.paramIndex,
          this.is2D,
          this.directionOrientations,
          dirParamMap,
          correction,
        );

        this.log(`Iter ${iter + 1}: Max Corr = ${maxCorrection.toFixed(4)}`);
        this.log(
          `Iter ${iter + 1}: vTPv before=${sumBefore.toExponential(6)} after=${sumAfter.toExponential(
            6,
          )} delta(within)=${objectiveDeltaWithinIter.toExponential(6)} delta(iter)=${objectiveDeltaBetweenIterations.toExponential(6)} delta(rel)=${objectiveDeltaRelative.toExponential(6)}`,
        );
        if (prevObjectiveBefore != null && objectiveDeltaRelative < this.convergenceThreshold) {
          this.log(
            `Converged: relative iteration objective delta ${objectiveDeltaRelative.toExponential(6)} < limit ${this.convergenceThreshold.toExponential(6)}`,
          );
          this.converged = true;
          this.emitSolveProgress('iteration');
          break;
        }
        prevObjectiveBefore = sumBefore;
        this.emitSolveProgress('iteration');
      } catch (error) {
        this.solveTiming.matrixFactorizationMs += Date.now() - factorizationStartedAt;
        const detail = error instanceof Error ? ` ${error.message}` : '';
        this.log(`Normal equation solve failed (singular or otherwise unstable).${detail}`);
        const diagnosticsStartedAt = Date.now();
        this.calculateStatistics(this.paramIndex, false, activeObservations);
        this.solveTiming.precisionAndDiagnosticsMs += Date.now() - diagnosticsStartedAt;
        return this.finishSolve(this.buildResult());
      }
    }

    if (!this.converged) this.log('Warning: Max iterations reached.');
    const covarianceStartedAt = Date.now();
    this.Qxx = this.recoverFinalNormalCovariance(
      activeObservations,
      constraints,
      numObsEquations,
      numParams,
      dirParamMap,
    );
    this.solveTiming.matrixFactorizationMs += Date.now() - covarianceStartedAt;
    const diagnosticsStartedAt = Date.now();
    this.calculateStatistics(this.paramIndex, !!this.Qxx, activeObservations);
    this.solveTiming.precisionAndDiagnosticsMs += Date.now() - diagnosticsStartedAt;
    return this.finishSolve(this.buildResult());
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

  private calculateStatistics(
    paramIndex: Record<StationId, { x?: number; y?: number; h?: number }>,
    hasQxx: boolean,
    activeObservationsInput?: Observation[],
  ) {
    this.clearGeometryCache();
    let vtpv = 0;
    const closureResiduals: string[] = [];
    const closureVectors: { from: StationId; to: StationId; dE: number; dN: number }[] = [];
    const loopVectors: Record<string, { dE: number; dN: number }> = {};
    const loopAngleArcSec = new Map<string, number>();
    const loopVerticalMisclosure = new Map<string, number>();
    const hasClosureObs = this.observations.some(
      (o) => String(getObservationSetId(o) ?? '').toUpperCase() === 'TE',
    );
    const coordClosureVectors: { from: StationId; to: StationId; dE: number; dN: number }[] = [];
    let totalTraverseDistance = 0;
    const directionStats = new Map<string, DirectionSetStat>();
    const activeObservations = activeObservationsInput ?? this.collectActiveObservations();
    const constraints = buildCoordinateConstraints(this.stations, paramIndex, this.is2D);
    const tsCorrelationRows: TsCorrelationResidualGroups = new Map();
    const groupOrder = ['Angles', 'Directions', 'Distances', 'Az/Bearings', 'GPS', 'Level Data', 'Zenith'];
    const summarizeGroup = (obs: Observation): string => {
      if (obs.type === 'angle') return 'Angles';
      if (obs.type === 'direction' || obs.type === 'dir') return 'Directions';
      if (obs.type === 'bearing') return 'Az/Bearings';
      if (obs.type === 'dist') return 'Distances';
      if (obs.type === 'gps') return 'GPS';
      if (obs.type === 'lev') return 'Level Data';
      if (obs.type === 'zenith') return 'Zenith';
      return 'Other';
    };
    const weightedByGroup = new Map<string, { count: number; sumSquares: number }>();
    const ensureGroup = (label: string): { count: number; sumSquares: number } => {
      const existing = weightedByGroup.get(label);
      if (existing) return existing;
      const init = { count: 0, sumSquares: 0 };
      weightedByGroup.set(label, init);
      return init;
    };
    const observationEquationCount = (obs: Observation): number => {
      if (obs.type !== 'gps') return 1;
      return this.gpsComponentCount(obs);
    };
    const addObservationContribution = (obs: Observation, contribution: number) => {
      const label = summarizeGroup(obs);
      const row = ensureGroup(label);
      row.count += observationEquationCount(obs);
      row.sumSquares += contribution;
    };
    const addGroupContribution = (label: string, contribution: number) => {
      const row = ensureGroup(label);
      row.sumSquares += contribution;
    };
    const collectTsCorrelationRow = (obs: Observation, v: number, sigma: number) => {
      const group = this.tsCorrelationGroup(obs);
      if (!group) return;
      if (!Number.isFinite(v) || !Number.isFinite(sigma) || sigma <= 0) return;
      const entry = tsCorrelationRows.get(group.key) ?? {
        station: group.station,
        setId: group.setId,
        rows: [],
      };
      entry.rows.push({ v, sigma, groupLabel: summarizeGroup(obs) });
      tsCorrelationRows.set(group.key, entry);
    };

    activeObservations.forEach((obs) => {
      obs.effectiveDistance = undefined;
      if (obs.type === 'dist') {
        const s1 = this.stations[obs.from];
        const s2 = this.stations[obs.to];
        if (!s1 || !s2) return;
        const dx = s2.x - s1.x;
        const dy = s2.y - s1.y;
        const dz = s2.h + (obs.ht ?? 0) - (s1.h + (obs.hi ?? 0));
        const horiz = Math.sqrt(dx * dx + dy * dy);
        const calcRaw = this.is2D
          ? horiz
          : obs.mode === 'slope'
            ? Math.sqrt(horiz * horiz + dz * dz)
            : horiz;
        const calc = this.correctedDistanceModel(obs, calcRaw).calcDistance;
        const v = obs.obs - calc;
        obs.calc = calc;
        obs.residual = v;
        const sigma = this.effectiveStdDev(obs);
        obs.stdRes = Math.abs(v) / sigma;
        const q = (v * v) / (sigma * sigma);
        vtpv += q;
        addObservationContribution(obs, q);
        const setTag = String(getObservationSetId(obs) ?? '').toUpperCase();
        if (setTag === 'T' || setTag === 'TE') {
          totalTraverseDistance += Math.abs(obs.obs);
        }
      } else if (obs.type === 'angle') {
        obs.effectiveDistance = this.effectiveDistanceForAngularObservation(obs);
        const azTo = this.getAzimuth(obs.at, obs.to).az;
        const azFrom = this.getAzimuth(obs.at, obs.from).az;
        let calcAngle = azTo - azFrom;
        if (obs.gridObsMode !== 'grid') {
          calcAngle += this.measuredAngleCorrection(obs.at, obs.from, obs.to);
        }
        if (calcAngle < 0) calcAngle += 2 * Math.PI;
        let v = obs.obs - calcAngle;
        if (v > Math.PI) v -= 2 * Math.PI;
        if (v < -Math.PI) v += 2 * Math.PI;
        obs.calc = calcAngle;
        obs.residual = v;
        const sigma = this.effectiveStdDev(obs);
        obs.stdRes = Math.abs(v) / sigma;
        const q = (v * v) / (sigma * sigma);
        vtpv += q;
        addObservationContribution(obs, q);
        collectTsCorrelationRow(obs, v, sigma);
      } else if (obs.type === 'gps') {
        const corrected = this.gpsObservedVector(obs);
        const calc = this.gpsModeledVector(obs);
        const vE = corrected.dE - calc.dE;
        const vN = corrected.dN - calc.dN;
        const vU =
          !this.is2D &&
          Number.isFinite(corrected.dU ?? Number.NaN) &&
          Number.isFinite(calc.dU ?? Number.NaN)
            ? (corrected.dU as number) - (calc.dU as number)
            : undefined;
        obs.calc = calc;
        obs.residual = { vE, vN, vU };
        const w = this.gpsWeight(obs);
        const quad =
          w.wEE * vE * vE +
          2 * w.wEN * vE * vN +
          w.wNN * vN * vN +
          ((vU != null && w.wUU != null ? w.wUU * vU * vU : 0) +
            (vU != null && w.wEU != null ? 2 * w.wEU * vE * vU : 0) +
            (vU != null && w.wNU != null ? 2 * w.wNU * vN * vU : 0));
        obs.stdRes = Math.sqrt(Math.max(quad, 0));
        vtpv += quad;
        addObservationContribution(obs, quad);
      } else if (obs.type === 'lev') {
        const s1 = this.stations[obs.from];
        const s2 = this.stations[obs.to];
        if (!s1 || !s2) return;
        const calc_dH = s2.h - s1.h;
        const v = obs.obs - calc_dH;
        obs.calc = calc_dH;
        obs.residual = v;
        const sigma = this.effectiveStdDev(obs);
        obs.stdRes = Math.abs(v) / sigma;
        const q = (v * v) / (sigma * sigma);
        vtpv += q;
        addObservationContribution(obs, q);
      } else if (obs.type === 'bearing') {
        obs.effectiveDistance = this.effectiveDistanceForAngularObservation(obs);
        const calcAz = this.modeledAzimuth(
          this.getAzimuth(obs.from, obs.to).az,
          obs.from,
          obs.gridObsMode !== 'grid',
        );
        let v = obs.obs - calcAz;
        if (v > Math.PI) v -= 2 * Math.PI;
        if (v < -Math.PI) v += 2 * Math.PI;
        obs.calc = calcAz;
        obs.residual = v;
        const sigma = this.effectiveStdDev(obs);
        obs.stdRes = Math.abs(v) / sigma;
        const q = (v * v) / (sigma * sigma);
        vtpv += q;
        addObservationContribution(obs, q);
        collectTsCorrelationRow(obs, v, sigma);
      } else if (obs.type === 'dir') {
        obs.effectiveDistance = this.effectiveDistanceForAngularObservation(obs);
        const calcAz = this.modeledAzimuth(
          this.getAzimuth(obs.from, obs.to).az,
          obs.from,
          obs.gridObsMode !== 'grid',
        );
        let v0 = obs.obs - calcAz;
        if (v0 > Math.PI) v0 -= 2 * Math.PI;
        if (v0 < -Math.PI) v0 += 2 * Math.PI;
        let v = v0;
        if (obs.flip180) {
          let v1 = obs.obs + Math.PI - calcAz;
          if (v1 > Math.PI) v1 -= 2 * Math.PI;
          if (v1 < -Math.PI) v1 += 2 * Math.PI;
          if (Math.abs(v1) < Math.abs(v0)) v = v1;
        }
        obs.calc = calcAz;
        obs.residual = v;
        const sigma = this.effectiveStdDev(obs);
        obs.stdRes = Math.abs(v) / sigma;
        const q = (v * v) / (sigma * sigma);
        vtpv += q;
        addObservationContribution(obs, q);
        collectTsCorrelationRow(obs, v, sigma);
      } else if (obs.type === 'direction') {
        obs.effectiveDistance = this.effectiveDistanceForAngularObservation(obs);
        const az = this.modeledAzimuth(
          this.getAzimuth(obs.at, obs.to).az,
          obs.at,
          obs.gridObsMode !== 'grid',
        );
        const setId = getObservationSetId(obs) ?? 'unknown';
        const orientation = this.directionOrientations[setId] ?? 0;
        let calc = orientation + az;
        calc %= 2 * Math.PI;
        if (calc < 0) calc += 2 * Math.PI;
        let v = obs.obs - calc;
        if (v > Math.PI) v -= 2 * Math.PI;
        if (v < -Math.PI) v += 2 * Math.PI;
        obs.calc = calc;
        obs.residual = v;
        const sigma = this.effectiveStdDev(obs);
        obs.stdRes = Math.abs(v) / sigma;
        const q = (v * v) / (sigma * sigma);
        vtpv += q;
        addObservationContribution(obs, q);
        collectTsCorrelationRow(obs, v, sigma);

        const stat = directionStats.get(setId) ?? {
          count: 0,
          rawCount: 0,
          reducedCount: 0,
          face1Count: 0,
          face2Count: 0,
          pairedTargets: 0,
          sum: 0,
          sumSq: 0,
          maxAbs: 0,
          pairDeltaCount: 0,
          pairDeltaSum: 0,
          pairDeltaMax: 0,
          rawMaxResidualCount: 0,
          rawMaxResidualSum: 0,
          rawMaxResidualMax: 0,
          targetIds: new Set<StationId>(),
          occupy: obs.at,
          orientation,
        };
        const arcsec = v * RAD_TO_DEG * 3600;
        const rawCount = typeof obs.rawCount === 'number' && obs.rawCount > 0 ? obs.rawCount : 1;
        const face1Count =
          typeof obs.rawFace1Count === 'number'
            ? obs.rawFace1Count
            : obs.obs >= Math.PI
              ? 0
              : rawCount;
        const face2Count =
          typeof obs.rawFace2Count === 'number'
            ? obs.rawFace2Count
            : Math.max(0, rawCount - face1Count);
        stat.count += 1;
        stat.rawCount += rawCount;
        stat.reducedCount += 1;
        stat.face1Count += face1Count;
        stat.face2Count += face2Count;
        if (face1Count > 0 && face2Count > 0) stat.pairedTargets += 1;
        stat.sum += arcsec;
        stat.sumSq += arcsec * arcsec;
        stat.maxAbs = Math.max(stat.maxAbs, Math.abs(arcsec));
        const pairDeltaArcSec =
          typeof obs.facePairDelta === 'number'
            ? Math.abs(obs.facePairDelta) * RAD_TO_DEG * 3600
            : undefined;
        if (pairDeltaArcSec != null && Number.isFinite(pairDeltaArcSec)) {
          stat.pairDeltaCount += 1;
          stat.pairDeltaSum += pairDeltaArcSec;
          stat.pairDeltaMax = Math.max(stat.pairDeltaMax, pairDeltaArcSec);
        }
        const rawMaxResidualArcSec =
          typeof obs.rawMaxResidual === 'number'
            ? Math.abs(obs.rawMaxResidual) * RAD_TO_DEG * 3600
            : undefined;
        if (rawMaxResidualArcSec != null && Number.isFinite(rawMaxResidualArcSec)) {
          stat.rawMaxResidualCount += 1;
          stat.rawMaxResidualSum += rawMaxResidualArcSec;
          stat.rawMaxResidualMax = Math.max(stat.rawMaxResidualMax, rawMaxResidualArcSec);
        }
        if (typeof obs.to === 'string' && obs.to.trim().length > 0) {
          stat.targetIds.add(obs.to);
        }
        stat.occupy = obs.at ?? stat.occupy;
        stat.orientation = orientation;
        directionStats.set(setId, stat);
      } else if (obs.type === 'zenith') {
        obs.effectiveDistance = this.effectiveDistanceForAngularObservation(obs);
        const zv = this.getModeledZenith(obs).z;
        let v = obs.obs - zv;
        if (v > Math.PI) v -= 2 * Math.PI;
        if (v < -Math.PI) v += 2 * Math.PI;
        obs.calc = zv;
        obs.residual = v;
        const sigma = this.effectiveStdDev(obs);
        obs.stdRes = Math.abs(v) / sigma;
        const q = (v * v) / (sigma * sigma);
        vtpv += q;
        addObservationContribution(obs, q);
      }

      if (obs.setId === 'TE' && typeof obs.residual === 'number') {
        if (obs.type === 'dist') {
          const key = `${obs.from}->${obs.to}`;
          const az = this.getAzimuth(obs.from, obs.to).az;
          const dE = obs.residual * Math.sin(az);
          const dN = obs.residual * Math.cos(az);
          closureVectors.push({ from: obs.from, to: obs.to, dE, dN });
          loopVectors[key] = loopVectors[key] || { dE: 0, dN: 0 };
          loopVectors[key].dE += dE;
          loopVectors[key].dN += dN;
          closureResiduals.push(
            `Traverse closure residual ${obs.from}-${obs.to}: ${obs.residual.toFixed(4)} m`,
          );
          const s1 = this.stations[obs.from];
          const s2 = this.stations[obs.to];
          if (s1 && s2) {
            coordClosureVectors.push({
              from: obs.from,
              to: obs.to,
              dE: s2.x - s1.x,
              dN: s2.y - s1.y,
            });
          }
        } else if (obs.type === 'angle') {
          const key = `${obs.from}->${obs.to}`;
          const angleArcSec = obs.residual * RAD_TO_DEG * 3600;
          loopAngleArcSec.set(key, (loopAngleArcSec.get(key) ?? 0) + angleArcSec);
          closureResiduals.push(
            `Traverse closure residual (angle) ${obs.from}-${obs.to}: ${(obs.residual * RAD_TO_DEG * 3600).toFixed(2)}"`,
          );
        } else if (obs.type === 'lev') {
          const key = `${obs.from}->${obs.to}`;
          loopVerticalMisclosure.set(key, (loopVerticalMisclosure.get(key) ?? 0) + obs.residual);
          closureResiduals.push(
            `Traverse closure residual (dH) ${obs.from}-${obs.to}: ${obs.residual.toFixed(4)} m`,
          );
        }
      }
    });

    vtpv += coordinateConstraintWeightedSum(this.stations, constraints);

    const tsCorrelationDiagnostics = buildTsCorrelationDiagnostics({
      enabled: this.tsCorrelationEnabled && this.tsCorrelationRho > 0,
      rho: this.tsCorrelationRho,
      scope: this.tsCorrelationScope ?? 'set',
      rows: tsCorrelationRows,
    });
    vtpv += tsCorrelationDiagnostics.vtpvDelta;
    tsCorrelationDiagnostics.groupContributions.forEach(({ label, contribution }) => {
      addGroupContribution(label, contribution);
    });
    this.tsCorrelationDiagnostics = tsCorrelationDiagnostics.diagnostics;
    if (tsCorrelationDiagnostics.logLine) {
      this.log(tsCorrelationDiagnostics.logLine);
    }
    this.seuw = this.preanalysisMode ? 1 : this.dof > 0 ? Math.sqrt(vtpv / this.dof) : 0;

    this.chiSquare = undefined;
    this.statisticalSummary = undefined;
    this.typeSummary = undefined;
    this.directionSetDiagnostics = undefined;
    this.directionTargetDiagnostics = undefined;
    this.directionRepeatabilityDiagnostics = undefined;
    this.setupDiagnostics = undefined;
    this.residualDiagnostics = undefined;
    this.traverseDiagnostics = undefined;
    this.autoSideshotDiagnostics = undefined;

    if (!this.preanalysisMode && this.dof > 0) {
      this.chiSquare = buildChiSquareSummary(vtpv, this.dof, 0.05);
    }

    if (hasQxx) {
      const stationParamCount =
        Object.values(paramIndex).reduce((max, idx) => {
          const vals = [idx.x ?? -1, idx.y ?? -1, idx.h ?? -1];
          return Math.max(max, ...vals);
        }, -1) + 1;
      const directionSetIds = Array.from(
        new Set(
          activeObservations
            .filter((o) => o.type === 'direction')
            .map((o) => getObservationSetId(o))
            .filter((setId): setId is string => typeof setId === 'string'),
        ),
      );
      const dirParamMap: Record<string, number> = {};
      directionSetIds.forEach((id, idx) => {
        dirParamMap[id] = stationParamCount + idx;
      });
      const numParams = stationParamCount + directionSetIds.length;
      const numObsEquations =
        activeObservations.reduce(
          (acc, o) =>
            acc +
            (o.type === 'gps' && !this.is2D && Number.isFinite(o.obs.dU ?? Number.NaN)
              ? 3
              : o.type === 'gps'
                ? 2
                : 1),
          0,
        ) +
        constraints.length;

      if (numParams > 0 && numObsEquations > 0) {
        const { L, P, rowInfo, sparseRows } = assembleAdjustmentEquations(
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
            applyTsCorrelationToWeightMatrix: (weightMatrix, weightRowInfo) =>
              this.applyTsCorrelationToWeightMatrix(weightMatrix, weightRowInfo, true),
          },
          activeObservations,
          constraints,
          numObsEquations,
          numParams,
          undefined,
          { includeDenseA: false },
        );

        if (!this.preanalysisMode && this.robustMode === 'huber') {
          const baseWeights = this.captureRobustWeightBase(P, rowInfo);
          const residuals = L.map((row) => -row[0]);
          const summary = this.computeRobustWeightSummary(residuals, rowInfo);
          this.applyRobustWeightFactors(P, baseWeights, summary.factors);
        }

        if (!this.preanalysisMode) {
          try {
            const { normal: N } = accumulateNormalEquationsFromSparseRows(
              sparseRows,
              zeros(numObsEquations, 1),
              P,
              numParams,
            );
            const QxxStats = this.invertNormalMatrixForStats(N);
            const B = multiplySparseRowsByDenseMatrix(sparseRows, QxxStats);
            const rowStats = new Map<
              number,
              {
                t: number[];
                r: number[];
                mdb: number[];
                pass: boolean[];
                comps: ('E' | 'N' | 'U' | undefined)[];
                rows: number[];
              }
            >();
            const s0 = this.seuw || 1;
            for (let i = 0; i < numObsEquations; i += 1) {
              const info = rowInfo[i];
              if (!info) continue;
              const sigma = this.effectiveStdDev(info.obs);
              let qll = sigma > 0 ? sigma * sigma : 0;
              if (info.obs.type === 'gps') {
                const cov = this.gpsCovariance(info.obs);
                qll =
                  info.component === 'N'
                    ? cov.cNN
                    : info.component === 'U'
                      ? (cov.cUU ?? cov.cNN)
                      : cov.cEE;
              }
              let diag = 0;
              const sparseRow = sparseRows[i] ?? [];
              for (let j = 0; j < sparseRow.length; j += 1) {
                const entry = sparseRow[j];
                diag += B[i][entry.index] * entry.value;
              }
              const qvv = Math.max(qll - diag, 1e-20);
              const t = L[i][0] / (s0 * Math.sqrt(qvv));
              const r = qll > 0 ? qvv / qll : 0;
              const pass = Math.abs(t) <= this.localTestCritical;
              const sigmaQll = Math.sqrt(Math.max(qll, 0));
              const mdb =
                r > 1e-12
                  ? (this.localTestCritical * s0 * sigmaQll) / Math.sqrt(r)
                  : Number.POSITIVE_INFINITY;
              const entry = rowStats.get(info.obs.id) ?? {
                t: [],
                r: [],
                mdb: [],
                pass: [],
                comps: [],
                rows: [],
              };
              entry.t.push(t);
              entry.r.push(r);
              entry.mdb.push(mdb);
              entry.pass.push(pass);
              entry.comps.push(info.component);
              entry.rows.push(i);
              rowStats.set(info.obs.id, entry);
            }

            activeObservations.forEach((obs) => {
              const entry = rowStats.get(obs.id);
              if (!entry) return;
              if (obs.type === 'gps') {
                const gpsObs = obs as GpsObservation;
                const componentOrder = entry.comps.filter(
                  (component): component is 'E' | 'N' | 'U' => component != null,
                );
                const componentIndex = new Map(componentOrder.map((component, index) => [component, index]));
                const cov = this.gpsCovariance(gpsObs);
                const solveQll = componentOrder.map((rowComponent) =>
                  componentOrder.map((colComponent) => {
                    if (rowComponent === 'E' && colComponent === 'E') return cov.cEE;
                    if (rowComponent === 'N' && colComponent === 'N') return cov.cNN;
                    if (rowComponent === 'U' && colComponent === 'U') return cov.cUU ?? cov.cNN;
                    if (
                      (rowComponent === 'E' && colComponent === 'N') ||
                      (rowComponent === 'N' && colComponent === 'E')
                    ) {
                      return cov.cEN;
                    }
                    if (
                      (rowComponent === 'E' && colComponent === 'U') ||
                      (rowComponent === 'U' && colComponent === 'E')
                    ) {
                      return cov.cEU ?? 0;
                    }
                    return cov.cNU ?? 0;
                  }),
                );
                const solveQvv = solveQll.map((solveRow, rowIndex) =>
                  solveRow.map((qllValue, colIndex) => {
                    let aqxxat = 0;
                    const sparseColRow = sparseRows[entry.rows[colIndex]] ?? [];
                    for (let paramEntryIndex = 0; paramEntryIndex < sparseColRow.length; paramEntryIndex += 1) {
                      const paramEntry = sparseColRow[paramEntryIndex];
                      aqxxat +=
                        B[entry.rows[rowIndex]][paramEntry.index] * paramEntry.value;
                    }
                    return Math.max(qllValue - aqxxat, 0);
                  }),
                );
                const solveResidualVector = componentOrder.map((component) =>
                  component === 'N'
                    ? (gpsObs.residual?.vN ?? 0)
                    : component === 'U'
                      ? (gpsObs.residual?.vU ?? 0)
                      : (gpsObs.residual?.vE ?? 0),
                );
                const displayTransform = this.gpsDisplayResidualTransform(
                  gpsObs,
                  this.stations[gpsObs.from],
                );
                const toDisplayVector = (values: number[]) => {
                  if (!displayTransform || values.length !== 3) return values;
                  return displayTransform.map(
                    (transformRow) =>
                      transformRow[0] * values[0] + transformRow[1] * values[1] + transformRow[2] * values[2],
                  );
                };
                const toDisplayCovariance = (covariance: number[][]) => {
                  if (!displayTransform || covariance.length !== 3) return covariance;
                  return transformSymmetricCovariance3(displayTransform, covariance);
                };
                const displayResidualVector = toDisplayVector(solveResidualVector);
                const displayQvv = toDisplayCovariance(solveQvv);
                const residualStdErr = (component: 'E' | 'N' | 'U'): number | undefined => {
                  const index = componentIndex.get(component);
                  if (index == null) return undefined;
                  return this.seuw * Math.sqrt(Math.max(displayQvv[index]?.[index] ?? 0, 0));
                };
                const componentStdRes = (component: 'E' | 'N' | 'U'): number | undefined => {
                  const index = componentIndex.get(component);
                  if (index == null) return undefined;
                  const sigma = residualStdErr(component);
                  if (!Number.isFinite(sigma) || (sigma ?? 0) <= 0) return undefined;
                  return Math.abs(displayResidualVector[index] ?? 0) / (sigma as number);
                };
                gpsObs.componentResidualStdErr = {
                  sE: residualStdErr('E'),
                  sN: residualStdErr('N'),
                  sU: residualStdErr('U'),
                };
                gpsObs.componentStdRes = {
                  tE: componentStdRes('E'),
                  tN: componentStdRes('N'),
                  tU: componentStdRes('U'),
                };
              }
              if (entry.t.length === 2 && entry.comps.includes('E') && entry.comps.includes('N')) {
                const idxE = entry.comps.indexOf('E');
                const idxN = entry.comps.indexOf('N');
                const tE = entry.t[idxE];
                const tN = entry.t[idxN];
                const rE = entry.r[idxE];
                const rN = entry.r[idxN];
                const mE = entry.mdb[idxE];
                const mN = entry.mdb[idxN];
                const passE = entry.pass[idxE];
                const passN = entry.pass[idxN];
                obs.stdResComponents = { tE, tN };
                obs.stdRes = Math.max(Math.abs(tE), Math.abs(tN));
                obs.redundancy = { rE, rN };
                obs.localTest = { critical: this.localTestCritical, pass: passE && passN };
                obs.localTestComponents = { passE, passN };
                obs.mdbComponents = { mE, mN };
              } else if (obs.type === 'gps' && entry.t.length > 2) {
                obs.stdRes = Math.max(...entry.t.map((value) => Math.abs(value)));
                obs.redundancy = Math.min(...entry.r);
                obs.localTest = {
                  critical: this.localTestCritical,
                  pass: entry.pass.every(Boolean),
                };
                obs.mdb = Math.min(...entry.mdb.filter((value) => Number.isFinite(value)));
              } else {
                obs.stdRes = Math.abs(entry.t[0]);
                obs.redundancy = entry.r[0];
                obs.localTest = { critical: this.localTestCritical, pass: entry.pass[0] };
                obs.mdb = entry.mdb[0];
              }
            });
          } catch (error) {
            const detail = error instanceof Error ? ` ${error.message}` : '';
            this.log(
              `Warning: standardized residuals not computed (normal matrix factorization failed).${detail}`,
            );
          }
        }
      }
    }

    if (!this.preanalysisMode) {
      this.statisticalSummary = buildStatisticalSummary(weightedByGroup, groupOrder, this.dof);
    }

    if (!this.preanalysisMode) {
      // Flag very large standardized residuals
      const flagged = this.observations.filter((o) => Math.abs(o.stdRes || 0) > this.maxStdRes);
      if (flagged.length) {
        this.log(
          `Warning: ${flagged.length} obs exceed ${this.maxStdRes} sigma (consider excluding/reweighting).`,
        );
      }
      const localFailed = this.observations.filter(
        (o) => this.isObservationActive(o) && o.localTest != null && !o.localTest.pass,
      );
      if (localFailed.length) {
        this.log(
          `Local test: ${localFailed.length} observation(s) exceed critical |t|>${this.localTestCritical.toFixed(
            2,
          )}.`,
        );
      }
    }

    if (!this.preanalysisMode) {
      const residualDiagnostics = buildResidualDiagnostics(
        activeObservations,
        this.localTestCritical,
      );
      this.residualDiagnostics = residualDiagnostics;
      this.log(
        `Residual diagnostics: |t|>2=${residualDiagnostics.over2SigmaCount}, |t|>3=${residualDiagnostics.over3SigmaCount}, localFail=${residualDiagnostics.localFailCount}, lowRedund(<0.2)=${residualDiagnostics.lowRedundancyCount}.`,
      );
    }
    if (this.preanalysisMode) {
      this.log(
        'Preanalysis statistics: using a-priori variance factor 1.0 and skipping residual-based diagnostics.',
      );
    }

    this.typeSummary = buildObservationTypeSummary(activeObservations);
    this.captureObservationWeightingStdDevs(activeObservations);

    if (hasQxx && this.Qxx) {
      const precisionPropagationStartedAt = Date.now();
      const posteriorScaleSq =
        this.dof > 0 && Number.isFinite(this.seuw) && this.seuw > 0 ? this.seuw * this.seuw : 1;
      if (this.dof <= 0) {
        this.log('DOF <= 0: using a-priori variance factor 1.0 for point precision scaling.');
      }
      const connectedPairTypes = new Map<string, Set<string>>();
      const addConnectedPair = (a: StationId, b: StationId, label: string): void => {
        if (!a || !b || a === b) return;
        const key = makePairKey(a, b);
        const types = connectedPairTypes.get(key) ?? new Set<string>();
        types.add(label);
        connectedPairTypes.set(key, types);
      };
      activeObservations.forEach((obs) => {
        if (obs.type === 'angle') {
          addConnectedPair(obs.at, obs.from, 'angle');
          addConnectedPair(obs.at, obs.to, 'angle');
          return;
        }
        if (obs.type === 'direction') {
          addConnectedPair(obs.at, obs.to, 'direction');
          return;
        }
        if ('from' in obs && 'to' in obs) {
          addConnectedPair(obs.from, obs.to, obs.type);
        }
      });

      const buildCovariance = (scaleSq: number) => (a?: number | null, b?: number | null): number => {
        if (a == null || b == null) return 0;
        if (!this.Qxx?.[a] || this.Qxx?.[a][b] == null) return 0;
        return this.Qxx[a][b] * scaleSq;
      };
      const sortRelativeCovariances = (
        rows: NonNullable<AdjustmentResult['relativeCovariances']>,
      ) => {
        rows.sort((a, b) => {
          const cmpFrom = a.from.localeCompare(b.from, undefined, { numeric: true });
          if (cmpFrom !== 0) return cmpFrom;
          return a.to.localeCompare(b.to, undefined, { numeric: true });
        });
        return rows;
      };
      const requestedRelativePairs = new Map<
        string,
        {
          from: StationId;
          to: StationId;
          rel: boolean;
          ptol: boolean;
        }
      >();
      const requestedPairKey = (from: StationId, to: StationId): string => {
        const canonical = makePairKey(from, to);
        const [first, second] = canonical.split('|') as [StationId, StationId];
        return `${first}::${second}`;
      };
      const registerRequestedPairs = (
        pairs: Array<{ from: StationId; to: StationId }> | undefined,
        kind: 'rel' | 'ptol',
      ) => {
        pairs?.forEach((pair) => {
          if (!pair?.from || !pair?.to || pair.from === pair.to) return;
          const key = requestedPairKey(pair.from, pair.to);
          const existing = requestedRelativePairs.get(key);
          if (existing) {
            existing.rel ||= kind === 'rel';
            existing.ptol ||= kind === 'ptol';
            return;
          }
          requestedRelativePairs.set(key, {
            from: pair.from,
            to: pair.to,
            rel: kind === 'rel',
            ptol: kind === 'ptol',
          });
        });
      };
      registerRequestedPairs(this.parseState?.relativeLinePairs, 'rel');
      registerRequestedPairs(this.parseState?.positionalTolerancePairs, 'ptol');
      const buildPrecisionModel = (scaleSq: number): NonNullable<AdjustmentResult['precisionModels']>[keyof NonNullable<AdjustmentResult['precisionModels']>] => {
        const cov = buildCovariance(scaleSq);
        const stationCovariances: NonNullable<AdjustmentResult['stationCovariances']> = [];
        this.unknowns.forEach((id) => {
          const idx = paramIndex[id];
          if (!idx) return;
          const hasHorizontal = idx.x != null && idx.y != null;
          const varE = hasHorizontal ? cov(idx.x, idx.x) : 0;
          const varN = hasHorizontal ? cov(idx.y, idx.y) : 0;
          const covEN = hasHorizontal ? cov(idx.x, idx.y) : 0;
          const ellipseSummary = hasHorizontal
            ? buildHorizontalErrorEllipse(varE, varN, covEN)
            : { ellipse: undefined };
          const stationBlock: NonNullable<AdjustmentResult['stationCovariances']>[number] = {
            stationId: id,
            cEE: varE,
            cEN: covEN,
            cNN: varN,
            sigmaE: sqrtPrecisionComponent(varE, Math.abs(varE)),
            sigmaN: sqrtPrecisionComponent(varN, Math.abs(varN)),
            ellipse: ellipseSummary.ellipse,
          };
          if (!this.is2D && idx.h != null) {
            const varH = cov(idx.h, idx.h);
            stationBlock.cEH = idx.x != null ? cov(idx.x, idx.h) : 0;
            stationBlock.cNH = idx.y != null ? cov(idx.y, idx.h) : 0;
            stationBlock.cHH = varH;
            stationBlock.sigmaH = sqrtPrecisionComponent(varH, Math.abs(varH));
          }
          stationCovariances.push(stationBlock);
        });

        const buildRelativeCovarianceRow = (
          from: StationId,
          to: StationId,
          relativeCovariance: ReturnType<typeof buildRelativeCovarianceFromEndpoints>,
          connected: boolean,
          connectionTypes: string[],
          selectedByRelativeDirective: boolean,
          selectedByPositionalToleranceDirective: boolean,
        ): NonNullable<AdjustmentResult['relativeCovariances']>[number] => {
          const fromStation = this.stations[from];
          const toStation = this.stations[to];
          const dE = (toStation?.x ?? 0) - (fromStation?.x ?? 0);
          const dN = (toStation?.y ?? 0) - (fromStation?.y ?? 0);
          const ellipseSummary = buildHorizontalErrorEllipse(
            relativeCovariance.cEE,
            relativeCovariance.cNN,
            relativeCovariance.cEN,
          );
          const { sigmaDist, sigmaAz } = buildDistanceAzimuthPrecision(dE, dN, relativeCovariance);

          const row: NonNullable<AdjustmentResult['relativeCovariances']>[number] = {
            from,
            to,
            connected,
            connectionTypes,
            selectedByRelativeDirective,
            selectedByPositionalToleranceDirective,
            cEE: relativeCovariance.cEE,
            cEN: relativeCovariance.cEN,
            cNN: relativeCovariance.cNN,
            sigmaE: sqrtPrecisionComponent(relativeCovariance.cEE, Math.abs(relativeCovariance.cEE)),
            sigmaN: sqrtPrecisionComponent(relativeCovariance.cNN, Math.abs(relativeCovariance.cNN)),
            sigmaDist,
            sigmaAz,
            ellipse: ellipseSummary.ellipse,
          };

          if (!this.is2D) {
            row.cEH = relativeCovariance.cEH;
            row.cNH = relativeCovariance.cNH;
            row.cHH = relativeCovariance.cHH;
            row.sigmaH = sqrtPrecisionComponent(
              relativeCovariance.cHH ?? 0,
              Math.abs(relativeCovariance.cHH ?? 0),
            );
          }

          return row;
        };

        const relativePrecision: NonNullable<AdjustmentResult['relativePrecision']> = [];
        for (let i = 0; i < this.unknowns.length; i += 1) {
          for (let j = i + 1; j < this.unknowns.length; j += 1) {
            const from = this.unknowns[i];
            const to = this.unknowns[j];
            const fromStation = this.stations[from];
            const toStation = this.stations[to];
            const idxFrom = paramIndex[from];
            const idxTo = paramIndex[to];
            if (!fromStation || !toStation || (!idxFrom && !idxTo)) continue;

            const dE = toStation.x - fromStation.x;
            const dN = toStation.y - fromStation.y;
            const horizontalCovariance = buildRelativeCovarianceFromEndpoints(cov, idxFrom, idxTo);
            const ellipseSummary = buildHorizontalErrorEllipse(
              horizontalCovariance.cEE,
              horizontalCovariance.cNN,
              horizontalCovariance.cEN,
            );
            const { sigmaDist, sigmaAz } = buildDistanceAzimuthPrecision(dE, dN, horizontalCovariance);

            relativePrecision.push({
              from,
              to,
              sigmaN: sqrtPrecisionComponent(horizontalCovariance.cNN, Math.abs(horizontalCovariance.cNN)),
              sigmaE: sqrtPrecisionComponent(horizontalCovariance.cEE, Math.abs(horizontalCovariance.cEE)),
              sigmaDist,
              sigmaAz,
              ellipse: ellipseSummary.ellipse,
            });
          }
        }

        const relativeCovariances: NonNullable<AdjustmentResult['relativeCovariances']> = [];
        connectedPairTypes.forEach((types, key) => {
          const [from, to] = key.split('|') as [StationId, StationId];
          const idxFrom = paramIndex[from];
          const idxTo = paramIndex[to];
          if ((!this.stations[from] || !this.stations[to]) || (!idxFrom && !idxTo)) return;

          const requested = requestedRelativePairs.get(requestedPairKey(from, to));
          const relativeCovariance = buildRelativeCovarianceFromEndpoints(cov, idxFrom, idxTo, !this.is2D);
          relativeCovariances.push(
            buildRelativeCovarianceRow(
              from,
              to,
              relativeCovariance,
              true,
              Array.from(types).sort(),
              requested?.rel ?? false,
              requested?.ptol ?? false,
            ),
          );
        });

        requestedRelativePairs.forEach((requested, key) => {
          if (connectedPairTypes.has(key.replace('::', '|'))) return;
          const fromStation = this.stations[requested.from];
          const toStation = this.stations[requested.to];
          const idxFrom = paramIndex[requested.from];
          const idxTo = paramIndex[requested.to];
          if (!fromStation || !toStation || (!idxFrom && !idxTo)) return;
          const relativeCovariance = buildRelativeCovarianceFromEndpoints(
            cov,
            idxFrom,
            idxTo,
            !this.is2D,
          );
          relativeCovariances.push(
            buildRelativeCovarianceRow(
              requested.from,
              requested.to,
              relativeCovariance,
              false,
              [],
              requested.rel,
              requested.ptol,
            ),
          );
        });

        return {
          stationCovariances,
          relativePrecision,
          relativeCovariances: sortRelativeCovariances(relativeCovariances),
        };
      };

      const industryStandardModel = buildPrecisionModel(1);
      const posteriorScaledModel = {
        stationCovariances: scaleStationCovarianceRows(
          industryStandardModel.stationCovariances,
          posteriorScaleSq,
        ),
        relativeCovariances: scaleRelativeCovarianceRows(
          industryStandardModel.relativeCovariances,
          posteriorScaleSq,
        ),
      };
      this.precisionModels = {
        'industry-standard': industryStandardModel,
        'posterior-scaled': posteriorScaledModel,
      };
      this.stationCovariances = industryStandardModel.stationCovariances;
      this.relativePrecision = industryStandardModel.relativePrecision;
      this.relativeCovariances = industryStandardModel.relativeCovariances;
      this.unknowns.forEach((id) => {
        const station = this.stations[id];
        if (!station) return;
        station.errorEllipse = undefined;
        station.sN = undefined;
        station.sE = undefined;
        station.sH = undefined;
      });
      industryStandardModel.stationCovariances?.forEach((row) => {
        const station = this.stations[row.stationId];
        if (!station) return;
        station.errorEllipse = row.ellipse;
        station.sE = row.sigmaE;
        station.sN = row.sigmaN;
        station.sH = row.sigmaH;
      });

      if (this.preanalysisMode) {
        this.weakGeometryDiagnostics = buildWeakGeometryDiagnostics(
          industryStandardModel.stationCovariances ?? [],
          industryStandardModel.relativeCovariances ?? [],
        );
        const flaggedStations = this.weakGeometryDiagnostics.stationCues.filter(
          (cue) => cue.severity !== 'ok',
        );
        const flaggedPairs = this.weakGeometryDiagnostics.relativeCues.filter(
          (cue) => cue.severity !== 'ok',
        );
        this.log(
          `Preanalysis covariance blocks: stations=${industryStandardModel.stationCovariances?.length ?? 0}, connectedPairs=${industryStandardModel.relativeCovariances?.length ?? 0}`,
        );
        this.log(
          `Preanalysis weak geometry cues: stations=${flaggedStations.length}, connectedPairs=${flaggedPairs.length}`,
        );
        flaggedStations.slice(0, 5).forEach((cue) => {
          this.log(`  station ${cue.stationId}: ${cue.severity.toUpperCase()} ${cue.note}`);
        });
        flaggedPairs.slice(0, 5).forEach((cue) => {
          this.log(`  pair ${cue.from}-${cue.to}: ${cue.severity.toUpperCase()} ${cue.note}`);
        });
      }
      this.solveTiming.precisionPropagationMs += Date.now() - precisionPropagationStartedAt;
    }

    const sideshots = this.computeSideshotResults();
    this.sideshots = sideshots;
    const sideshotCount = sideshots?.length ?? 0;
    if (sideshotCount > 0) {
      this.log(`Sideshots (post-adjust): ${sideshotCount}`);
    }

    const directionDiagnostics = buildDirectionDiagnostics(activeObservations, directionStats);
    this.directionSetDiagnostics = directionDiagnostics.directionSetDiagnostics;
    this.directionTargetDiagnostics = directionDiagnostics.directionTargetDiagnostics;
    this.directionRepeatabilityDiagnostics = directionDiagnostics.directionRepeatabilityDiagnostics;
    this.logs.push(...directionDiagnostics.logs);
    this.setupDiagnostics = buildSetupDiagnostics({
      activeObservations,
      directionSetDiagnostics: this.directionSetDiagnostics,
    });
    if (this.setupDiagnostics) {
      this.logs.push('Setup summary:');
      this.setupDiagnostics.forEach((s) => {
        this.logs.push(
          `  ${s.station}: dirSets=${s.directionSetCount}, dirObs=${s.directionObsCount}, ang=${s.angleObsCount}, dist=${s.distanceObsCount}, zen=${s.zenithObsCount}, lev=${s.levelingObsCount}, gps=${s.gpsObsCount}, travDist=${s.traverseDistance.toFixed(3)}m, orientRMS=${s.orientationRmsArcSec != null ? `${s.orientationRmsArcSec.toFixed(2)}"` : '-'}, orientSE=${s.orientationSeArcSec != null ? `${s.orientationSeArcSec.toFixed(2)}"` : '-'}, rms|t|=${s.rmsStdRes != null ? s.rmsStdRes.toFixed(2) : '-'}, max|t|=${s.maxStdRes != null ? s.maxStdRes.toFixed(2) : '-'}, localFail=${s.localFailCount}`,
        );
      });
    }

    if (closureResiduals.length) {
      this.logs.push(...closureResiduals);
      this.traverseDiagnostics = buildTraverseDiagnostics({
        closureVectors,
        loopVectors,
        loopAngleArcSec,
        loopVerticalMisclosure,
        totalTraverseDistance,
        thresholds: { ...this.traverseThresholds },
        setupDiagnostics: this.setupDiagnostics,
        hasClosureObs,
      });
      if (this.traverseDiagnostics && this.traverseDiagnostics.closureCount > 0) {
        const traverseDiagnostics = this.traverseDiagnostics;
        this.logs.push(
          `Traverse misclosure vector: dE=${traverseDiagnostics.misclosureE.toFixed(4)} m, dN=${traverseDiagnostics.misclosureN.toFixed(4)} m, Mag=${traverseDiagnostics.misclosureMag.toFixed(4)} m`,
        );
        if (totalTraverseDistance > 0) {
          this.logs.push(`Traverse distance sum: ${totalTraverseDistance.toFixed(4)} m`);
        }
        if (traverseDiagnostics.closureRatio != null) {
          this.logs.push(
            `Traverse closure ratio: 1:${traverseDiagnostics.closureRatio.toFixed(0)}`,
          );
        }
        if (traverseDiagnostics.linearPpm != null) {
          this.logs.push(
            `Traverse linear misclosure: ${traverseDiagnostics.linearPpm.toFixed(1)} ppm`,
          );
        }
        if (traverseDiagnostics.angularMisclosureArcSec != null) {
          this.logs.push(
            `Traverse angular misclosure: ${traverseDiagnostics.angularMisclosureArcSec.toFixed(2)}"`,
          );
        }
        if (traverseDiagnostics.verticalMisclosure != null) {
          this.logs.push(
            `Traverse vertical misclosure: ${traverseDiagnostics.verticalMisclosure.toFixed(4)} m`,
          );
        }
        const traverseLoops = traverseDiagnostics.loops ?? [];
        if (traverseLoops.length > 0) {
          this.logs.push('Traverse closure loop ranking (worst first):');
          traverseLoops.slice(0, 8).forEach((l) => {
            this.logs.push(
              `  ${l.key}: ratio=${l.closureRatio != null ? `1:${l.closureRatio.toFixed(0)}` : '-'}, ppm=${l.linearPpm != null ? l.linearPpm.toFixed(1) : '-'}, ang=${l.angularMisclosureArcSec != null ? `${l.angularMisclosureArcSec.toFixed(2)}"` : '-'}, dH=${l.verticalMisclosure != null ? `${l.verticalMisclosure.toFixed(4)}m` : '-'}, sev=${l.severity.toFixed(1)} ${l.pass ? 'PASS' : 'WARN'}`,
            );
          });
        }
      }
      Object.entries(loopVectors).forEach(([k, v]) => {
        const mag = Math.hypot(v.dE, v.dN);
        this.logs.push(
          `Closure loop ${k}: dE=${v.dE.toFixed(4)} m, dN=${v.dN.toFixed(4)} m, Mag=${mag.toFixed(4)} m`,
        );
      });
      if (coordClosureVectors.length) {
        coordClosureVectors.forEach((v) => {
          const mag = Math.hypot(v.dE, v.dN);
          this.logs.push(
            `Closure geometry ${v.from}-${v.to}: dE=${v.dE.toFixed(4)} m, dN=${v.dN.toFixed(4)} m, Mag=${mag.toFixed(4)} m`,
          );
        });
      }
    } else if (hasClosureObs) {
      this.traverseDiagnostics = buildTraverseDiagnostics({
        closureVectors,
        loopVectors,
        loopAngleArcSec,
        loopVerticalMisclosure,
        totalTraverseDistance,
        thresholds: { ...this.traverseThresholds },
        setupDiagnostics: this.setupDiagnostics,
        hasClosureObs,
      });
      this.logs.push('Traverse closure residual not computed (insufficient closure geometry).');
      if (totalTraverseDistance > 0) {
        this.logs.push(`Traverse distance sum: ${totalTraverseDistance.toFixed(4)} m`);
      }
    }
  }

  private buildResult(): AdjustmentResult {
    const resultPackagingStartedAt = Date.now();
    this.projectWeakFloatZenithLeafStationsForDisplay();
    if (!this.sideshots) {
      this.sideshots = this.computeSideshotResults();
    }
    if (this.coordSystemMode === 'grid') {
      Object.keys(this.stations).forEach((id) => {
        this.stationFactorSnapshot(id);
      });
    }
    this.captureRawTraverseDirectionCorrections(this.collectActiveObservations());
    this.parseState = finalizeResultParseState({
      parseState: this.parseState,
      coordSystemMode: this.coordSystemMode,
      coordSystemDiagnostics: this.coordSystemDiagnostics.values(),
      coordSystemWarningMessages: this.coordSystemWarningMessages,
      crsStatus: this.crsStatus,
      crsOffReason: this.crsOffReason,
      crsDatumOpId: this.crsDatumOpId,
      crsDatumFallbackUsed: this.crsDatumFallbackUsed,
      crsAreaOfUseStatus: this.crsAreaOfUseStatus,
      crsOutOfAreaStationCount: this.crsOutOfAreaStationCount,
      scaleOverrideActive: this.scaleOverrideActive,
      gnssFrameConfirmed: this.gnssFrameConfirmed,
      datumSufficiencyReport: this.datumSufficiencyReport,
      parsedUsageSummary: summarizeReductionUsage(this.observations),
      usedInSolveUsageSummary: summarizeReductionUsage(this.collectActiveObservations()),
    });
    const includeErrorCount = this.parseState?.includeErrors?.length ?? 0;
    const runMode = this.runMode;
    const autoSideshotEnabled =
      this.parseState?.autoSideshotEnabled ?? this.parseOptions?.autoSideshotEnabled ?? true;
    if (runMode === 'data-check') {
      this.autoSideshotDiagnostics = undefined;
      this.clusterDiagnostics = undefined;
      this.logs.push('Data Check Only: auto-sideshot and cluster diagnostics are skipped.');
    } else if (this.preanalysisMode) {
      this.autoSideshotDiagnostics = undefined;
      this.logs.push('Auto-sideshot detection (M-lines): disabled in preanalysis mode');
    } else if (autoSideshotEnabled) {
      if (!this.autoSideshotDiagnostics) {
        this.autoSideshotDiagnostics = buildAutoSideshotDiagnostics({
          observations: this.observations,
          stations: this.stations,
          redundancyScalar: (obs) => this.redundancyScalar(obs),
          threshold: 0.1,
        });
        this.logs.push(
          `Auto-sideshot detection (M-lines): evaluated=${this.autoSideshotDiagnostics.evaluatedCount}, candidates=${this.autoSideshotDiagnostics.candidateCount}, excluded-control=${this.autoSideshotDiagnostics.excludedControlCount}, threshold=${this.autoSideshotDiagnostics.threshold.toFixed(2)}`,
        );
        this.autoSideshotDiagnostics.candidates.slice(0, 10).forEach((c) => {
          this.logs.push(
            `  line ${c.sourceLine ?? '-'} ${c.occupy}->${c.target} (bs=${c.backsight}) minRed=${c.minRedundancy.toFixed(3)} max|t|=${c.maxAbsStdRes.toFixed(2)}`,
          );
        });
      }
    } else {
      this.autoSideshotDiagnostics = undefined;
      this.logs.push('Auto-sideshot detection (M-lines): disabled');
    }
    if (runMode !== 'data-check' && !this.clusterDiagnostics) {
      const dimension: '2D' | '3D' = this.is2D ? '2D' : '3D';
      this.clusterDiagnostics = buildClusterDiagnostics({
        stations: this.stations,
        unknowns: this.unknowns,
        enabled: this.clusterDetectionEnabled,
        linkageMode: this.clusterLinkageMode ?? 'single',
        dimension,
        tolerance: Math.max(
          1e-9,
          dimension === '2D' ? this.clusterTolerance2D : this.clusterTolerance3D,
        ),
        passMode:
          (this.parseOptions?.clusterDualPassRan ?? false) ||
          this.parseOptions?.clusterPassLabel === 'pass2'
            ? 'dual-pass'
            : 'single-pass',
      });
      if (this.clusterDiagnostics.enabled) {
        this.logs.push(
          `Cluster detection: pass=${this.clusterDiagnostics.passMode}, mode=${this.clusterDiagnostics.linkageMode}, dim=${this.clusterDiagnostics.dimension}, tol=${this.clusterDiagnostics.tolerance.toFixed(4)}m, pairHits=${this.clusterDiagnostics.pairCount}, candidates=${this.clusterDiagnostics.candidateCount}`,
        );
        if ((this.clusterDiagnostics.approvedMergeCount ?? 0) > 0) {
          this.logs.push(
            `  Approved merges applied: ${this.clusterDiagnostics.approvedMergeCount} (pass1 candidates=${this.clusterDiagnostics.pass1CandidateCount ?? 0})`,
          );
        }
        this.clusterDiagnostics.candidates.slice(0, 10).forEach((c) => {
          this.logs.push(
            `  ${c.key}: rep=${c.representativeId}, members=${c.stationIds.join(',')}, maxSep=${c.maxSeparation.toFixed(4)}m, meanSep=${c.meanSeparation.toFixed(4)}m`,
          );
        });
      }
    }
    const success = includeErrorCount === 0 && (runMode === 'data-check' ? true : this.converged);
    const result = buildAdjustmentResultPayload({
      success,
      converged: this.converged,
      iterations: this.iterations,
      stations: this.stations,
      observations: this.observations,
      logs: this.logs,
      seuw: this.seuw,
      dof: this.dof,
      preanalysisMode: this.preanalysisMode,
      parseState: this.parseState,
      condition: this.condition,
      controlConstraints: this.controlConstraints,
      stationCovariances: this.stationCovariances,
      relativeCovariances: this.relativeCovariances,
      precisionModels: this.precisionModels,
      weakGeometryDiagnostics: this.weakGeometryDiagnostics,
      chiSquare: this.chiSquare,
      statisticalSummary: this.statisticalSummary,
      typeSummary: this.typeSummary,
      relativePrecision: this.relativePrecision,
      directionSetDiagnostics: this.directionSetDiagnostics,
      directionTargetDiagnostics: this.directionTargetDiagnostics,
      directionRepeatabilityDiagnostics: this.directionRepeatabilityDiagnostics,
      setupDiagnostics: this.setupDiagnostics,
      tsCorrelationDiagnostics: this.tsCorrelationDiagnostics,
      robustDiagnostics: this.robustDiagnostics,
      residualDiagnostics: this.residualDiagnostics,
      traverseDiagnostics: this.traverseDiagnostics,
      sideshots: this.sideshots,
      gpsLoopDiagnostics: this.gpsLoopDiagnostics,
      levelingLoopDiagnostics: this.levelingLoopDiagnostics,
      autoSideshotDiagnostics: this.autoSideshotDiagnostics,
      clusterDiagnostics: this.clusterDiagnostics,
      directionRejectDiagnostics: this.directionRejectDiagnostics,
    });
    this.solveTiming.resultPackagingMs += Date.now() - resultPackagingStartedAt;
    const solveTimingProfile = this.buildSolveTimingProfile();
    result.solveTimingProfile = solveTimingProfile;
    this.logSolveTimingProfile(solveTimingProfile);
    return result;
  }
}
