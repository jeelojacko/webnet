import { RAD_TO_DEG, DEG_TO_RAD } from './angles';
import { geoidGridMetadataSummary, interpolateGeoidUndulation, loadGeoidGridModel } from './geoid';
import {
  computeElevationFactor,
  computeGridFactors,
  transformFactoredEcefDeltaCovarianceToLocalEnu,
  inverseENToGeodetic,
  projectGeodeticToEN,
} from './geodesy';
import { getCrsDefinition, isGeodeticInsideAreaOfUse } from './crsCatalog';
import { runClusterDualPassWorkflow } from './adjustmentClusterWorkflow';
import type { GeoidGridModel } from './geoid';
import {
  accumulateNormalEquationsFromSparseRows,
  denseRowsToSparseRows,
  invertSPDFromCholesky,
  choleskyDecomposeWithDamping,
  invertSymmetricLDLTWithInfo,
  multiplySparseRowsByDenseMatrix,
  solveSPDFromCholesky,
  symmetricQuadraticForm,
  zeros,
} from './matrix';
import { parseInput } from './parse';
import {
  getCachedParsedModel,
  getCachedSolvePreparation,
  recordScenarioSolve,
} from './scenarioParsedModelCache';
import {
  applyCoordinateConstraintCorrelationWeights,
  buildCoordinateConstraints,
  coordinateConstraintWeightedSum,
} from './adjustmentConstraints';
import { assembleAdjustmentEquations } from './adjustmentEquationAssembly';
import { applyAdjustmentCorrections, solveAdjustmentIteration } from './adjustmentIteration';
import {
  applyAutoDroppedHeightHolds,
  buildSolvePreparation,
  cloneSolvePreparationResult,
  collectActiveObservationsForSolve,
  isObservationActiveForSolve,
} from './adjustmentPreprocessing';
import type { SolvePreparationResult } from './adjustmentPreprocessing';
import { buildAdjustmentResultPayload, finalizeResultParseState } from './adjustmentResultBuilder';
import {
  buildObservationTypeSummary,
  buildResidualDiagnostics,
  buildStatisticalSummary,
} from './adjustmentStatisticsBuilders';
import { buildChiSquareSummary } from './adjustmentStatisticalMath';
import { buildWeakGeometryDiagnostics } from './adjustmentWeakGeometry';
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
  CoordinateConstraintRowPlacement,
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
  DirectionObservation,
  GpsObservation,
  LevelObservation,
  Observation,
  Station,
  StationId,
  StationMap,
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

const EPS = 1e-10;
const EARTH_RADIUS_M = 6378137;
const WGS84_A = 6378137;
const WGS84_F = 1 / 298.257223563;
const WGS84_E2 = WGS84_F * (2 - WGS84_F);
const GPS_ADDHIHT_SCALE_TOL = 1e-9;
const GPS_LOOP_BASE_TOLERANCE_M = 0.02;
const GPS_LOOP_TOLERANCE_PPM = 50;
const LEVEL_LOOP_DEFAULT_BASE_MM = 0;
const LEVEL_LOOP_DEFAULT_PER_SQRT_KM_MM = 4;
const INDUSTRY_PARITY_ANGULAR_SIGMA_SCALE = 1.0001;

type GpsSolveVector = {
  dE: number;
  dN: number;
  dU?: number;
  scale: number;
};

type GpsCovariance = {
  cEE: number;
  cNN: number;
  cEN: number;
  cUU?: number;
  cEU?: number;
  cNU?: number;
};

type GpsVectorComponents = {
  dE: number;
  dN: number;
  dU?: number;
};

type GpsVectorDerivatives = {
  from: { x?: GpsVectorComponents; y?: GpsVectorComponents; h?: GpsVectorComponents };
  to: { x?: GpsVectorComponents; y?: GpsVectorComponents; h?: GpsVectorComponents };
};

const makePairKey = (a: StationId, b: StationId): string => (a < b ? `${a}|${b}` : `${b}|${a}`);
const makeDirectedPairKey = (from: StationId, to: StationId): string => `${from}|${to}`;

const wrapToPi = (value: number): number => {
  let out = value;
  while (out <= -Math.PI) out += 2 * Math.PI;
  while (out > Math.PI) out -= 2 * Math.PI;
  return out;
};

const wrapTo2Pi = (value: number): number => {
  let out = value % (2 * Math.PI);
  if (out < 0) out += 2 * Math.PI;
  return out;
};

const circularMean = (values: number[]): number | null => {
  if (!values.length) return null;
  let sumSin = 0;
  let sumCos = 0;
  values.forEach((value) => {
    sumSin += Math.sin(value);
    sumCos += Math.cos(value);
  });
  if (Math.abs(sumSin) < 1e-12 && Math.abs(sumCos) < 1e-12) {
    return wrapTo2Pi(values[0] ?? 0);
  }
  return wrapTo2Pi(Math.atan2(sumSin, sumCos));
};

const azimuthFromCoords = (fromX: number, fromY: number, toX: number, toY: number): number =>
  wrapTo2Pi(Math.atan2(toX - fromX, toY - fromY));

const intersectDistanceCircles = (
  ax: number,
  ay: number,
  radiusA: number,
  bx: number,
  by: number,
  radiusB: number,
): { x: number; y: number }[] => {
  const dx = bx - ax;
  const dy = by - ay;
  const distance = Math.hypot(dx, dy);
  if (!Number.isFinite(distance) || distance <= 1e-12) return [];
  if (distance > radiusA + radiusB + 1e-6) return [];
  if (distance < Math.abs(radiusA - radiusB) - 1e-6) return [];
  const a = (radiusA * radiusA - radiusB * radiusB + distance * distance) / (2 * distance);
  const hSq = radiusA * radiusA - a * a;
  if (hSq < -1e-6) return [];
  const h = Math.sqrt(Math.max(0, hSq));
  const midX = ax + (a * dx) / distance;
  const midY = ay + (a * dy) / distance;
  const offsetX = (-dy * h) / distance;
  const offsetY = (dx * h) / distance;
  if (h <= 1e-9) {
    return [{ x: midX, y: midY }];
  }
  return [
    { x: midX + offsetX, y: midY + offsetY },
    { x: midX - offsetX, y: midY - offsetY },
  ];
};

type BootstrapDirectionSet = {
  setId: string;
  occupy: StationId;
  directions: { to: StationId; obs: number }[];
};

type BootstrapPairMetrics = {
  slopeDistance: number;
  horizDistance: number;
  zenith?: number;
};

const cloneParsedResultValue = <T>(value: T): T => {
  if (value == null || typeof value !== 'object') return value;
  if (Array.isArray(value)) {
    return value.map((entry) => cloneParsedResultValue(entry)) as T;
  }
  if (value instanceof Uint8Array) {
    return new Uint8Array(value) as T;
  }
  return Object.fromEntries(
    Object.entries(value as Record<string, unknown>).map(([key, entryValue]) => [
      key,
      cloneParsedResultValue(entryValue),
    ]),
  ) as T;
};

interface EngineOptions {
  input: string;
  maxIterations?: number;
  instrumentLibrary?: InstrumentLibrary;
  convergenceThreshold?: number;
  excludeIds?: Set<number>;
  overrides?: Record<number, ObservationOverride>;
  options?: Partial<ParseOptions>;
  parseOptions?: Partial<ParseOptions>;
  geoidSourceData?: ArrayBuffer | Uint8Array;
  parsedResult?: ParseResult;
  solvePreparation?: SolvePreparationResult;
  progressCallback?: (_event: SolveProgressEvent) => void;
}
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
  private solveTiming = {
    parseAndSetupMs: 0,
    equationAssemblyMs: 0,
    matrixFactorizationMs: 0,
    precisionAndDiagnosticsMs: 0,
    precisionPropagationMs: 0,
    resultPackagingMs: 0,
  };
  private solveTimingLogged = false;

  private matrixIsFinite(m: number[][]): boolean {
    return m.every((row) => row.every((value) => Number.isFinite(value)));
  }

  private scaleNormalMatrix(N: number[][]): { scaled: number[][]; scale: number[] } {
    const scale = N.map((row, i) => {
      const diag = Math.abs(row[i] ?? 0);
      return diag > 1e-30 && Number.isFinite(diag) ? 1 / Math.sqrt(diag) : 1;
    });
    const scaled = N.map((row, i) => row.map((value, j) => value * scale[i] * scale[j]));
    return { scaled, scale };
  }

  private scaleNormalRhs(U: number[][], scale: number[]): number[][] {
    return U.map((row, i) => row.map((value) => value * scale[i]));
  }

  private unscaleNormalSolution(solution: number[][], scale: number[]): number[][] {
    return solution.map((row, i) => row.map((value) => value * scale[i]));
  }

  private unscaleNormalInverse(inverse: number[][], scale: number[]): number[][] {
    return inverse.map((row, i) => row.map((value, j) => value * scale[i] * scale[j]));
  }

  private recoverUndampedInverse(
    scaledN: number[][],
    scale: number[],
    fallbackInverse: number[][],
    context: string,
  ): number[][] {
    try {
      const recovery = invertSymmetricLDLTWithInfo(scaledN);
      const pivotSuffix =
        recovery.twoByTwoPivotCount > 0 ? ` (2x2 pivot blocks=${recovery.twoByTwoPivotCount})` : '';
      this.log(
        `Warning: ${context} used pivoted symmetric LDLT recovery on the scaled undamped normal matrix to avoid damping bias in covariance output${pivotSuffix}.`,
      );
      return this.unscaleNormalInverse(recovery.inverse, scale);
    } catch (error) {
      const detail = error instanceof Error ? ` ${error.message}` : '';
      this.log(
        `Warning: ${context} could not recover the undamped covariance after regularization; using damped covariance instead.${detail}`,
      );
      return this.unscaleNormalInverse(fallbackInverse, scale);
    }
  }

  private solveNormalEquations(
    N: number[][],
    U: number[][],
    options?: { recoverCovariance?: boolean },
  ): { correction: number[][]; qxx?: number[][] } {
    const scaled = this.scaleNormalMatrix(N);
    const scaledU = this.scaleNormalRhs(U, scaled.scale);
    const factorization = choleskyDecomposeWithDamping(scaled.scaled);
    if (factorization.damping > 0) {
      this.log(
        `Warning: normal-equation factorization required diagonal damping (lambda=${factorization.damping.toExponential(
          3,
        )}, attempts=${factorization.attempts}).`,
      );
    }
    const scaledCorrection = solveSPDFromCholesky(factorization.factor, scaledU);
    if (!this.matrixIsFinite(scaledCorrection)) {
      throw new Error(
        'Normal matrix remained singular after diagonal damping; scaled correction contains non-finite values.',
      );
    }
    const correction = this.unscaleNormalSolution(scaledCorrection, scaled.scale);
    if (!this.matrixIsFinite(correction)) {
      throw new Error(
        'Normal matrix remained singular or numerically unstable after diagonal damping; correction contains non-finite values.',
      );
    }
    if (!options?.recoverCovariance) {
      return { correction };
    }
    const scaledQxx = invertSPDFromCholesky(factorization.factor);
    if (!this.matrixIsFinite(scaledQxx)) {
      throw new Error(
        'Normal matrix remained singular after diagonal damping; damped covariance contains non-finite values.',
      );
    }
    const qxx =
      factorization.damping > 0
        ? this.recoverUndampedInverse(
            scaled.scaled,
            scaled.scale,
            scaledQxx,
            'Normal-equation covariance recovery',
          )
        : this.unscaleNormalInverse(scaledQxx, scaled.scale);
    if (!this.matrixIsFinite(qxx)) {
      throw new Error(
        'Normal matrix remained singular or numerically unstable after diagonal damping; covariance contains non-finite values.',
      );
    }
    return {
      correction,
      qxx,
    };
  }

  private recoverFinalNormalCovariance(
    activeObservations: Observation[],
    constraints: CoordinateConstraintEquation[],
    numObsEquations: number,
    numParams: number,
    dirParamMap: Record<string, number>,
  ): number[][] | null {
    if (numParams <= 0 || numObsEquations <= 0) return null;
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
      activeObservations,
      constraints,
      numObsEquations,
      numParams,
      undefined,
      { includeDenseA: false },
    );
    const { normal } = accumulateNormalEquationsFromSparseRows(
      sparseRows,
      zeros(numObsEquations, 1),
      P,
      numParams,
    );
    return this.invertNormalMatrixForStats(normal);
  }

  private invertNormalMatrixForStats(N: number[][]): number[][] {
    const scaled = this.scaleNormalMatrix(N);
    const factorization = choleskyDecomposeWithDamping(scaled.scaled);
    if (factorization.damping > 0) {
      this.log(
        `Warning: covariance factorization required diagonal damping (lambda=${factorization.damping.toExponential(
          3,
        )}, attempts=${factorization.attempts}).`,
      );
    }
    const scaledQxx = invertSPDFromCholesky(factorization.factor);
    const qxx =
      factorization.damping > 0
        ? this.recoverUndampedInverse(
            scaled.scaled,
            scaled.scale,
            scaledQxx,
            'Standardized-residual covariance recovery',
          )
        : this.unscaleNormalInverse(scaledQxx, scaled.scale);
    if (!this.matrixIsFinite(qxx)) {
      throw new Error('Non-finite covariance values encountered after regularization.');
    }
    return qxx;
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
    const dE = Number.isFinite(obs.gpsOffsetDeltaE ?? Number.NaN)
      ? (obs.gpsOffsetDeltaE as number)
      : 0;
    const dN = Number.isFinite(obs.gpsOffsetDeltaN ?? Number.NaN)
      ? (obs.gpsOffsetDeltaN as number)
      : 0;
    const dH = Number.isFinite(obs.gpsOffsetDeltaH ?? Number.NaN)
      ? (obs.gpsOffsetDeltaH as number)
      : 0;
    const horizDistance = Math.hypot(dE, dN);
    return {
      dE,
      dN,
      dH,
      horizDistance,
      applied: horizDistance > 1e-12 || Math.abs(dH) > 1e-12,
    };
  }

  private plannedGpsRawVector(obs: GpsObservation): { dE: number; dN: number; dU?: number } {
    const from = this.stations[obs.from];
    const to = this.stations[obs.to];
    if (!from || !to) return { dE: 0, dN: 0, dU: 0 };
    const offset = this.gpsRoverOffsetVector(obs);
    const dE = to.x - from.x - offset.dE;
    const dN = to.y - from.y - offset.dN;
    const dU = !this.is2D ? to.h - from.h - offset.dH : undefined;
    const horizGround = Math.hypot(dE, dN);
    if (horizGround <= 1e-12) return { dE, dN, dU };

    const hi = Number.isFinite(obs.gpsAntennaHiM ?? Number.NaN) ? (obs.gpsAntennaHiM as number) : 0;
    const ht = Number.isFinite(obs.gpsAntennaHtM ?? Number.NaN) ? (obs.gpsAntennaHtM as number) : 0;
    const deltaGround = to.h - offset.dH - from.h;
    const deltaAntenna = deltaGround + (ht - hi);
    const rawHorizSq =
      horizGround * horizGround + deltaGround * deltaGround - deltaAntenna * deltaAntenna;
    if (!Number.isFinite(rawHorizSq) || rawHorizSq <= 1e-12) {
      return { dE, dN, dU };
    }
    const rawHoriz = Math.sqrt(rawHorizSq);
    const scale = rawHoriz / horizGround;
    if (!Number.isFinite(scale) || scale <= 0) return { dE, dN, dU };
    return { dE: dE * scale, dN: dN * scale, dU };
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
        obs.obs = this.modeledAzimuth(
          this.getAzimuth(obs.at, obs.to).az,
          obs.at,
          obs.gridObsMode !== 'grid',
        );
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
    if (this.geometryDependentSigmaReference !== 'initial') {
      this.initialSigmaGeometryStations = {};
      this.initialSigmaAzimuthCache.clear();
      this.initialSigmaZenithCache.clear();
      return;
    }
    this.initialSigmaGeometryStations = Object.fromEntries(
      Object.entries(this.stations).map(([id, station]) => [
        id,
        {
          ...station,
          x: station.x,
          y: station.y,
          h: station.h,
        },
      ]),
    );
    this.initialSigmaAzimuthCache.clear();
    this.initialSigmaZenithCache.clear();
  }

  private getSigmaGeometryAzimuth(
    fromID: StationId,
    toID: StationId,
  ): { az: number; dist: number } {
    if (this.geometryDependentSigmaReference !== 'initial') {
      return this.getAzimuth(fromID, toID);
    }
    const cacheKey = `${fromID}|${toID}`;
    const cached = this.initialSigmaAzimuthCache.get(cacheKey);
    if (cached) return cached;
    const s1 = this.initialSigmaGeometryStations[fromID];
    const s2 = this.initialSigmaGeometryStations[toID];
    if (!s1 || !s2) return { az: 0, dist: 0 };
    const dx = s2.x - s1.x;
    const dy = s2.y - s1.y;
    let az = Math.atan2(dx, dy);
    if (az < 0) az += 2 * Math.PI;
    const result = { az, dist: Math.sqrt(dx * dx + dy * dy) };
    this.initialSigmaAzimuthCache.set(cacheKey, result);
    return result;
  }

  private getSigmaGeometryZenith(
    fromID: StationId,
    toID: StationId,
    hi = 0,
    ht = 0,
  ): { z: number; dist: number; horiz: number; dh: number; crCorr: number } {
    if (this.geometryDependentSigmaReference !== 'initial') {
      return this.getZenith(fromID, toID, hi, ht);
    }
    const cacheKey = `${fromID}|${toID}|${hi}|${ht}`;
    const cached = this.initialSigmaZenithCache.get(cacheKey);
    if (cached) return cached;
    const s1 = this.initialSigmaGeometryStations[fromID];
    const s2 = this.initialSigmaGeometryStations[toID];
    if (!s1 || !s2) return { z: 0, dist: 0, horiz: 0, dh: 0, crCorr: 0 };
    const dx = s2.x - s1.x;
    const dy = s2.y - s1.y;
    const dh = s2.h + ht - (s1.h + hi);
    const horiz = Math.sqrt(dx * dx + dy * dy);
    const dist = Math.sqrt(horiz * horiz + dh * dh);
    const zGeom = dist === 0 ? 0 : Math.acos(dh / dist);
    const crCorr = this.curvatureRefractionAngle(horiz);
    const z = Math.min(Math.PI, Math.max(0, zGeom + crCorr));
    const result = { z, dist, horiz, dh, crCorr };
    this.initialSigmaZenithCache.set(cacheKey, result);
    return result;
  }

  private shouldApplyIndustryParityAngularSigmaCalibration(
    obs: Observation,
    source: SigmaSource,
  ): boolean {
    if (this.geometryDependentSigmaReference !== 'initial') return false;
    if (source === 'explicit' || source === 'fixed' || source === 'float') return false;
    return (
      obs.type === 'angle' ||
      obs.type === 'direction' ||
      obs.type === 'bearing' ||
      obs.type === 'dir'
    );
  }

  private effectiveStdDev(obs: Observation): number {
    const inst = this.getInstrument(obs);
    let sigma = Number.isFinite(obs.stdDev) ? obs.stdDev : 0;
    if (!inst) return Math.max(sigma, 1e-12);

    const source = obs.sigmaSource ?? 'explicit';
    if (this.shouldApplyIndustryParityAngularSigmaCalibration(obs, source)) {
      sigma *= INDUSTRY_PARITY_ANGULAR_SIGMA_SCALE;
    }
    if (source === 'fixed' || source === 'float') return Math.max(sigma, 1e-12);
    if (!this.applyCentering) return Math.max(sigma, 1e-12);
    if (source === 'explicit' && !this.addCenteringToExplicit) return Math.max(sigma, 1e-12);

    const instCenter = inst.instCentr_m || 0;
    const tgtCenter = inst.tgtCentr_m || 0;
    const centerHorizSq = instCenter * instCenter + tgtCenter * tgtCenter;
    const centerHoriz = Math.sqrt(centerHorizSq);
    const centerVert = Math.abs(inst.vertCentr_m || 0);
    const centerVertSq = centerVert * centerVert;

    if (obs.type === 'dist') {
      if (this.is2D || obs.mode !== 'slope') {
        if (centerHoriz <= 0) return Math.max(sigma, 1e-12);
        return Math.max(Math.sqrt(sigma * sigma + centerHorizSq), 1e-12);
      }
      if (centerHorizSq <= 0 && centerVertSq <= 0) return Math.max(sigma, 1e-12);
      const geom = this.centeringLineGeometry(obs.from, obs.to, obs.hi ?? 0, obs.ht ?? 0);
      const slope = Math.max(geom.slope, 1e-12);
      const horizRatioSq = (geom.horiz / slope) ** 2;
      const elevRatioSq = (geom.elev / slope) ** 2;
      const centeringVariance = horizRatioSq * centerHorizSq + 2 * elevRatioSq * centerVertSq;
      return Math.max(Math.sqrt(sigma * sigma + centeringVariance), 1e-12);
    }
    if (obs.type === 'direction') {
      if (centerHoriz <= 0) return Math.max(sigma, 1e-12);
      const az = this.getSigmaGeometryAzimuth(obs.at, obs.to);
      const term = az.dist > 0 ? centerHoriz / az.dist : 0;
      return Math.max(Math.sqrt(sigma * sigma + term * term), 1e-12);
    }
    if (obs.type === 'bearing') {
      if (centerHoriz <= 0) return Math.max(sigma, 1e-12);
      const az = this.getSigmaGeometryAzimuth(obs.from, obs.to);
      const term = az.dist > 0 ? centerHoriz / az.dist : 0;
      return Math.max(Math.sqrt(sigma * sigma + term * term), 1e-12);
    }
    if (obs.type === 'dir') {
      if (centerHoriz <= 0) return Math.max(sigma, 1e-12);
      const az = this.getSigmaGeometryAzimuth(obs.from, obs.to);
      const term = az.dist > 0 ? centerHoriz / az.dist : 0;
      return Math.max(Math.sqrt(sigma * sigma + term * term), 1e-12);
    }
    if (obs.type === 'angle') {
      if (centerHoriz <= 0) return Math.max(sigma, 1e-12);
      const azTo = this.getSigmaGeometryAzimuth(obs.at, obs.to);
      const azFrom = this.getSigmaGeometryAzimuth(obs.at, obs.from);
      const dTo = Math.max(azTo.dist, 1e-12);
      const dFrom = Math.max(azFrom.dist, 1e-12);
      const geometryAngle = this.wrapToPi(azTo.az - azFrom.az);
      const angle =
        this.geometryDependentSigmaReference === 'initial'
          ? geometryAngle
          : Number.isFinite(obs.obs)
            ? obs.obs
            : geometryAngle;
      const cross = Math.cos(angle);
      const termSq =
        (centerHoriz * centerHoriz) / (dTo * dTo) +
        (centerHoriz * centerHoriz) / (dFrom * dFrom) -
        (2 * centerHoriz * centerHoriz * cross) / (dTo * dFrom);
      const term = Math.sqrt(Math.max(termSq, 0));
      return Math.max(Math.sqrt(sigma * sigma + term * term), 1e-12);
    }
    if (obs.type === 'zenith') {
      if (centerHorizSq <= 0 && centerVertSq <= 0) return Math.max(sigma, 1e-12);
      const geom = this.centeringLineGeometry(obs.from, obs.to, obs.hi ?? 0, obs.ht ?? 0);
      const slope = Math.max(geom.slope, 1e-12);
      const horizRatioSq = (geom.horiz / slope) ** 2;
      const elevRatioSq = (geom.elev / slope) ** 2;
      // Convert the geometry-weighted linear centering projection into angular variance (radians^2).
      const linearVariance = elevRatioSq * centerHorizSq + 2 * horizRatioSq * centerVertSq;
      const term = Math.sqrt(Math.max(linearVariance, 0)) / slope;
      return Math.max(Math.sqrt(sigma * sigma + term * term), 1e-12);
    }
    if (obs.type === 'lev') {
      return Math.max(sigma, 1e-12);
    }

    return Math.max(sigma, 1e-12);
  }

  private gpsComponentCount(obs: GpsObservation): number {
    return !this.is2D && Number.isFinite(obs.obs.dU ?? Number.NaN) ? 3 : 2;
  }

  private gpsUsesLocalSolveFrame(frame: GnssVectorFrame): boolean {
    return frame === 'enuLocal' || frame === 'llhBaseline' || frame === 'ecefDelta';
  }

  private geodeticToEcef(
    latDeg: number,
    lonDeg: number,
    heightM = 0,
  ): { x: number; y: number; z: number } {
    const lat = latDeg * DEG_TO_RAD;
    const lon = lonDeg * DEG_TO_RAD;
    const sinLat = Math.sin(lat);
    const cosLat = Math.cos(lat);
    const sinLon = Math.sin(lon);
    const cosLon = Math.cos(lon);
    const n = WGS84_A / Math.sqrt(1 - WGS84_E2 * sinLat * sinLat);
    return {
      x: (n + heightM) * cosLat * cosLon,
      y: (n + heightM) * cosLat * sinLon,
      z: (n * (1 - WGS84_E2) + heightM) * sinLat,
    };
  }

  private ecefDeltaToLocalEnu(
    dX: number,
    dY: number,
    dZ: number,
    latDeg: number,
    lonDeg: number,
  ): Required<Pick<GpsVectorComponents, 'dE' | 'dN' | 'dU'>> {
    const lat = latDeg * DEG_TO_RAD;
    const lon = lonDeg * DEG_TO_RAD;
    const sinLat = Math.sin(lat);
    const cosLat = Math.cos(lat);
    const sinLon = Math.sin(lon);
    const cosLon = Math.cos(lon);
    return {
      dE: -sinLon * dX + cosLon * dY,
      dN: -sinLat * cosLon * dX - sinLat * sinLon * dY + cosLat * dZ,
      dU: cosLat * cosLon * dX + cosLat * sinLon * dY + sinLat * dZ,
    };
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
    const northSec = this.parseState?.verticalDeflectionNorthSec ?? 0;
    const eastSec = this.parseState?.verticalDeflectionEastSec ?? 0;
    const xi = (northSec / 3600) * DEG_TO_RAD;
    const eta = (eastSec / 3600) * DEG_TO_RAD;
    if ((!Number.isFinite(xi) || Math.abs(xi) <= 1e-16) && (!Number.isFinite(eta) || Math.abs(eta) <= 1e-16)) {
      return vector;
    }
    return {
      dE: vector.dE - eta * vector.dU,
      dN: vector.dN - xi * vector.dU,
      dU: vector.dU + eta * vector.dE + xi * vector.dN,
    };
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

  private multiplyMatrix3(a: number[][], b: number[][]): number[][] {
    return a.map((row) =>
      b[0].map(
        (_value, col) => row[0] * b[0][col] + row[1] * b[1][col] + row[2] * b[2][col],
      ),
    );
  }

  private transposeMatrix3(matrix: number[][]): number[][] {
    return [
      [matrix[0][0], matrix[1][0], matrix[2][0]],
      [matrix[0][1], matrix[1][1], matrix[2][1]],
      [matrix[0][2], matrix[1][2], matrix[2][2]],
    ];
  }

  private transformSymmetricCovariance3(transform: number[][], covariance: number[][]): number[][] {
    return this.multiplyMatrix3(
      this.multiplyMatrix3(transform, covariance),
      this.transposeMatrix3(transform),
    );
  }

  private invertMatrix3(matrix: number[][]): number[][] | null {
    const det =
      matrix[0][0] * (matrix[1][1] * matrix[2][2] - matrix[1][2] * matrix[2][1]) -
      matrix[0][1] * (matrix[1][0] * matrix[2][2] - matrix[1][2] * matrix[2][0]) +
      matrix[0][2] * (matrix[1][0] * matrix[2][1] - matrix[1][1] * matrix[2][0]);
    if (!Number.isFinite(det) || Math.abs(det) <= 1e-24) return null;
    return [
      [
        (matrix[1][1] * matrix[2][2] - matrix[1][2] * matrix[2][1]) / det,
        (matrix[0][2] * matrix[2][1] - matrix[0][1] * matrix[2][2]) / det,
        (matrix[0][1] * matrix[1][2] - matrix[0][2] * matrix[1][1]) / det,
      ],
      [
        (matrix[1][2] * matrix[2][0] - matrix[1][0] * matrix[2][2]) / det,
        (matrix[0][0] * matrix[2][2] - matrix[0][2] * matrix[2][0]) / det,
        (matrix[0][2] * matrix[1][0] - matrix[0][0] * matrix[1][2]) / det,
      ],
      [
        (matrix[1][0] * matrix[2][1] - matrix[1][1] * matrix[2][0]) / det,
        (matrix[0][1] * matrix[2][0] - matrix[0][0] * matrix[2][1]) / det,
        (matrix[0][0] * matrix[1][1] - matrix[0][1] * matrix[1][0]) / det,
      ],
    ];
  }

  private gpsDisplayResidualTransform(
    obs: GpsObservation,
    _fromStation?: Station,
  ): number[][] | null {
    const frame: GnssVectorFrame =
      obs.gnssVectorFrame ?? this.parseState?.gnssVectorFrameDefault ?? 'gridNEU';
    const northSec = this.parseState?.verticalDeflectionNorthSec ?? 0;
    const eastSec = this.parseState?.verticalDeflectionEastSec ?? 0;
    const xi = (northSec / 3600) * DEG_TO_RAD;
    const eta = (eastSec / 3600) * DEG_TO_RAD;
    const needsDeflectionUndo = this.gpsUsesLocalSolveFrame(frame) && (Math.abs(xi) > 1e-16 || Math.abs(eta) > 1e-16);
    const deflectionInverse = needsDeflectionUndo
      ? this.invertMatrix3([
          [1, 0, -eta],
          [0, 1, -xi],
          [eta, xi, 1],
        ])
      : null;
    return this.gpsUsesLocalSolveFrame(frame) ? deflectionInverse : null;
  }

  private transformGpsCovarianceToSolveFrame(obs: GpsObservation): GpsCovariance | null {
    const frame: GnssVectorFrame =
      obs.gnssVectorFrame ?? this.parseState?.gnssVectorFrameDefault ?? 'gridNEU';
    const componentCount = this.gpsComponentCount(obs);
    if (componentCount < 3 || !obs.gpsCovariance3d) return null;
    const { cXX, cYY, cZZ, cXY, cXZ, cYZ } = obs.gpsCovariance3d;
    let cEE = cXX;
    let cNN = cYY;
    let cUU = cZZ;
    let cEN = cXY;
    let cEU = cXZ;
    let cNU = cYZ;

    if (frame === 'ecefDelta') {
      const geo = this.stationGeodetic(obs.from) ?? this.stationGeodetic(obs.to);
      if (!geo) return null;
      const transformed = transformFactoredEcefDeltaCovarianceToLocalEnu(
        obs.gpsCovariance3d,
        geo.latDeg,
        geo.lonDeg,
        obs.gpsVectorHorizontalFactor,
        obs.gpsVectorVerticalFactor,
      );
      cEE = transformed.cEE;
      cEN = transformed.cEN;
      cEU = transformed.cEU;
      cNN = transformed.cNN;
      cNU = transformed.cNU;
      cUU = transformed.cUU;
    }

    const northSec = this.parseState?.verticalDeflectionNorthSec ?? 0;
    const eastSec = this.parseState?.verticalDeflectionEastSec ?? 0;
    const xi = (northSec / 3600) * DEG_TO_RAD;
    const eta = (eastSec / 3600) * DEG_TO_RAD;
    if (Math.abs(xi) > 1e-16 || Math.abs(eta) > 1e-16) {
      const d = [
        [1, 0, -eta],
        [0, 1, -xi],
        [eta, xi, 1],
      ];
      const q = [
        [cEE, cEN, cEU],
        [cEN, cNN, cNU],
        [cEU, cNU, cUU],
      ];
      const transformed = this.transformSymmetricCovariance3(d, q);
      cEE = transformed[0][0];
      cEN = transformed[0][1];
      cEU = transformed[0][2];
      cNN = transformed[1][1];
      cNU = transformed[1][2];
      cUU = transformed[2][2];
    }

    return { cEE, cNN, cEN, cUU, cEU, cNU };
  }

  private captureObservationWeightingStdDevs(observations: Observation[]): void {
    observations.forEach((obs) => {
      if (obs.type === 'gps') {
        const cov = this.gpsCovariance(obs);
        obs.weightingStdDev = undefined;
        obs.weightingStdDevE = Math.sqrt(Math.max(cov.cEE, 0));
        obs.weightingStdDevN = Math.sqrt(Math.max(cov.cNN, 0));
        return;
      }
      if (obs.type === 'dist') {
        obs.weightingStdDev = this.getObservedHorizontalDistanceIn2D(obs).sigmaDistance;
        obs.weightingStdDevE = undefined;
        obs.weightingStdDevN = undefined;
        return;
      }
      obs.weightingStdDev = this.effectiveStdDev(obs);
      obs.weightingStdDevE = undefined;
      obs.weightingStdDevN = undefined;
    });
  }

  private gpsCovariance(obs: Observation): GpsCovariance {
    if (obs.type !== 'gps') {
      const s = Math.max(obs.stdDev || 0, 1e-12);
      return { cEE: s * s, cNN: s * s, cEN: 0, cUU: s * s, cEU: 0, cNU: 0 };
    }
    const gps = obs;
    const transformed = this.transformGpsCovarianceToSolveFrame(gps);
    if (transformed) return transformed;
    const vector = this.gpsObservedVector(gps);
    const varianceScale = Math.max(vector.scale * vector.scale, 1e-12);
    const sE = Math.max(gps.stdDevE ?? gps.stdDev ?? 0, 1e-12);
    const sN = Math.max(gps.stdDevN ?? gps.stdDev ?? 0, 1e-12);
    const sU = Math.max(gps.stdDevU ?? gps.stdDev ?? 0, 1e-12);
    const corrEN = Math.max(-0.999, Math.min(0.999, gps.corrEN ?? 0));
    const corrEU = Math.max(-0.999, Math.min(0.999, gps.corrEU ?? 0));
    const corrNU = Math.max(-0.999, Math.min(0.999, gps.corrNU ?? 0));
    return {
      cEE: sE * sE * varianceScale,
      cNN: sN * sN * varianceScale,
      cEN: corrEN * sE * sN * varianceScale,
      cUU: sU * sU * varianceScale,
      cEU: corrEU * sE * sU * varianceScale,
      cNU: corrNU * sN * sU * varianceScale,
    };
  }

  private gpsWeight(obs: Observation): {
    wEE: number;
    wNN: number;
    wEN: number;
    wUU?: number;
    wEU?: number;
    wNU?: number;
  } {
    const cov = this.gpsCovariance(obs);
    const hasVertical =
      !this.is2D &&
      Number.isFinite(cov.cUU ?? Number.NaN) &&
      Number.isFinite(cov.cEU ?? Number.NaN) &&
      Number.isFinite(cov.cNU ?? Number.NaN);
    if (hasVertical) {
      const matrix = [
        [cov.cEE, cov.cEN, cov.cEU ?? 0],
        [cov.cEN, cov.cNN, cov.cNU ?? 0],
        [cov.cEU ?? 0, cov.cNU ?? 0, cov.cUU ?? 0],
      ];
      const det =
        matrix[0][0] * (matrix[1][1] * matrix[2][2] - matrix[1][2] * matrix[2][1]) -
        matrix[0][1] * (matrix[1][0] * matrix[2][2] - matrix[1][2] * matrix[2][0]) +
        matrix[0][2] * (matrix[1][0] * matrix[2][1] - matrix[1][1] * matrix[2][0]);
      if (Number.isFinite(det) && Math.abs(det) > 1e-24) {
        const inv = [
          [
            (matrix[1][1] * matrix[2][2] - matrix[1][2] * matrix[2][1]) / det,
            (matrix[0][2] * matrix[2][1] - matrix[0][1] * matrix[2][2]) / det,
            (matrix[0][1] * matrix[1][2] - matrix[0][2] * matrix[1][1]) / det,
          ],
          [
            (matrix[1][2] * matrix[2][0] - matrix[1][0] * matrix[2][2]) / det,
            (matrix[0][0] * matrix[2][2] - matrix[0][2] * matrix[2][0]) / det,
            (matrix[0][2] * matrix[1][0] - matrix[0][0] * matrix[1][2]) / det,
          ],
          [
            (matrix[1][0] * matrix[2][1] - matrix[1][1] * matrix[2][0]) / det,
            (matrix[0][1] * matrix[2][0] - matrix[0][0] * matrix[2][1]) / det,
            (matrix[0][0] * matrix[1][1] - matrix[0][1] * matrix[1][0]) / det,
          ],
        ];
        return {
          wEE: inv[0][0],
          wNN: inv[1][1],
          wEN: inv[0][1],
          wUU: inv[2][2],
          wEU: inv[0][2],
          wNU: inv[1][2],
        };
      }
    }
    const det = cov.cEE * cov.cNN - cov.cEN * cov.cEN;
    if (!Number.isFinite(det) || det <= 1e-24) {
      return {
        wEE: 1 / Math.max(cov.cEE, 1e-24),
        wNN: 1 / Math.max(cov.cNN, 1e-24),
        wEN: 0,
      };
    }
    return {
      wEE: cov.cNN / det,
      wNN: cov.cEE / det,
      wEN: -cov.cEN / det,
    };
  }

  private gpsObservedVector(obs: GpsObservation): GpsSolveVector {
    const includeVertical = !this.is2D && Number.isFinite(obs.obs.dU ?? Number.NaN);
    const rawE = Number.isFinite(obs.obs.dE) ? obs.obs.dE : 0;
    const rawN = Number.isFinite(obs.obs.dN) ? obs.obs.dN : 0;
    const rawU = includeVertical ? (obs.obs.dU as number) : 0;
    const frame: GnssVectorFrame =
      obs.gnssVectorFrame ?? this.parseState?.gnssVectorFrameDefault ?? 'gridNEU';
    let frameE = rawE;
    let frameN = rawN;
    let frameU = rawU;
    const frameDistance = Math.hypot(rawE, rawN);

    if (frame === 'enuLocal' || frame === 'llhBaseline') {
      const deflected = this.applyGpsVerticalDeflection({ dE: rawE, dN: rawN, dU: rawU });
      frameE = deflected.dE;
      frameN = deflected.dN;
      frameU = deflected.dU;
      if (frameDistance > 200000) {
        this.addCoordSystemWarning(
          `GNSS frame sanity check: ${obs.from}-${obs.to} declared ${frame} with unusually long horizontal span ${frameDistance.toFixed(3)}m.`,
        );
      }
    } else if (frame === 'ecefDelta') {
      const geo = this.stationGeodetic(obs.from) ?? this.stationGeodetic(obs.to);
      if (geo) {
        const { dE: enuE, dN: enuN, dU: enuU } = this.ecefDeltaToLocalEnu(
          rawE,
          rawN,
          rawU,
          geo.latDeg,
          geo.lonDeg,
        );
        const deflected = this.applyGpsVerticalDeflection({ dE: enuE, dN: enuN, dU: enuU });
        frameE = deflected.dE;
        frameN = deflected.dN;
        frameU = deflected.dU;
      } else {
        this.addCoordSystemWarning(
          `GNSS frame ${frame} could not resolve geodetic orientation for ${obs.from}-${obs.to}; using raw component proxy.`,
        );
      }
      if (frameDistance < 0.001 || frameDistance > 1_000_000) {
        this.addCoordSystemWarning(
          `GNSS frame sanity check: ${obs.from}-${obs.to} ${frame} vector magnitude ${frameDistance.toFixed(6)}m looks inconsistent.`,
        );
      }
    } else if (frame === 'unknown') {
      this.addCoordSystemDiagnostic(
        'GNSS_FRAME_UNCONFIRMED',
        `GNSS frame UNKNOWN for ${obs.from}-${obs.to}; solve requires explicit frame confirmation.`,
      );
    }

    const offset = this.gpsRoverOffsetVector(obs);
    const horizRaw = Math.hypot(frameE, frameN);
    if (horizRaw <= 1e-12) {
      return {
        dE: offset.dE,
        dN: offset.dN,
        dU: includeVertical ? frameU + offset.dH : undefined,
        scale: 1,
      };
    }

    const hasAntennaMeta = obs.gpsAntennaHiM != null || obs.gpsAntennaHtM != null;
    if (!hasAntennaMeta) {
      return {
        dE: frameE + offset.dE,
        dN: frameN + offset.dN,
        dU: includeVertical ? frameU + offset.dH : undefined,
        scale: 1,
      };
    }

    const hi = Number.isFinite(obs.gpsAntennaHiM ?? Number.NaN) ? (obs.gpsAntennaHiM as number) : 0;
    const ht = Number.isFinite(obs.gpsAntennaHtM ?? Number.NaN) ? (obs.gpsAntennaHtM as number) : 0;
    const fromH = Number.isFinite(this.stations[obs.from]?.h ?? Number.NaN)
      ? (this.stations[obs.from]?.h as number)
      : 0;
    const toH = Number.isFinite(this.stations[obs.to]?.h ?? Number.NaN)
      ? (this.stations[obs.to]?.h as number)
      : 0;

    const deltaGround = toH - offset.dH - fromH;
    const deltaAntenna = deltaGround + (ht - hi);
    const slope = Math.hypot(horizRaw, deltaAntenna);
    const horizCorrectedSq = slope * slope - deltaGround * deltaGround;
    if (!Number.isFinite(horizCorrectedSq) || horizCorrectedSq <= 0) {
      return {
        dE: frameE + offset.dE,
        dN: frameN + offset.dN,
        dU: includeVertical ? frameU + offset.dH : undefined,
        scale: 1,
      };
    }
    const horizCorrected = Math.sqrt(horizCorrectedSq);
    if (!Number.isFinite(horizCorrected) || horizCorrected <= 1e-12) {
      return {
        dE: frameE + offset.dE,
        dN: frameN + offset.dN,
        dU: includeVertical ? frameU + offset.dH : undefined,
        scale: 1,
      };
    }
    const scale = horizCorrected / horizRaw;
    if (!Number.isFinite(scale) || scale <= 0) {
      return {
        dE: frameE + offset.dE,
        dN: frameN + offset.dN,
        dU: includeVertical ? frameU + offset.dH : undefined,
        scale: 1,
      };
    }
    return {
      dE: frameE * scale + offset.dE,
      dN: frameN * scale + offset.dN,
      dU: includeVertical ? frameU + offset.dH : undefined,
      scale,
    };
  }

  private gpsModeledVectorFromStationValues(
    obs: GpsObservation,
    fromValues: { x: number; y: number; h: number },
    toValues: { x: number; y: number; h: number },
  ): GpsVectorComponents {
    const includeVertical = !this.is2D && Number.isFinite(obs.obs.dU ?? Number.NaN);
    const frame: GnssVectorFrame =
      obs.gnssVectorFrame ?? this.parseState?.gnssVectorFrameDefault ?? 'gridNEU';

    if (!this.gpsUsesLocalSolveFrame(frame)) {
      return {
        dE: toValues.x - fromValues.x,
        dN: toValues.y - fromValues.y,
        dU: includeVertical ? toValues.h - fromValues.h : undefined,
      };
    }

    if (this.coordSystemMode !== 'grid') {
      return {
        dE: toValues.x - fromValues.x,
        dN: toValues.y - fromValues.y,
        dU: includeVertical ? toValues.h - fromValues.h : undefined,
      };
    }

    const fromGeo = this.stationGeodeticFromCoordinates(obs.from, fromValues.x, fromValues.y);
    const toGeo = this.stationGeodeticFromCoordinates(obs.to, toValues.x, toValues.y);
    if (!fromGeo || !toGeo) {
      return {
        dE: toValues.x - fromValues.x,
        dN: toValues.y - fromValues.y,
        dU: includeVertical ? toValues.h - fromValues.h : undefined,
      };
    }

    const fromStation = this.stations[obs.from];
    const toStation = this.stations[obs.to];
    if (!fromStation || !toStation) {
      return {
        dE: toValues.x - fromValues.x,
        dN: toValues.y - fromValues.y,
        dU: includeVertical ? toValues.h - fromValues.h : undefined,
      };
    }

    const fromEllipsoidHeight = this.stationEllipsoidHeightFromValues(
      fromStation,
      fromValues.h,
      fromGeo.latDeg,
      fromGeo.lonDeg,
    );
    const toEllipsoidHeight = this.stationEllipsoidHeightFromValues(
      toStation,
      toValues.h,
      toGeo.latDeg,
      toGeo.lonDeg,
    );
    const fromEcef = this.geodeticToEcef(fromGeo.latDeg, fromGeo.lonDeg, fromEllipsoidHeight);
    const toEcef = this.geodeticToEcef(toGeo.latDeg, toGeo.lonDeg, toEllipsoidHeight);
    const local = this.ecefDeltaToLocalEnu(
      toEcef.x - fromEcef.x,
      toEcef.y - fromEcef.y,
      toEcef.z - fromEcef.z,
      fromGeo.latDeg,
      fromGeo.lonDeg,
    );
    const deflected = this.applyGpsVerticalDeflection(local);
    return {
      dE: deflected.dE,
      dN: deflected.dN,
      dU: includeVertical ? deflected.dU : undefined,
    };
  }

  private gpsModeledVector(obs: GpsObservation): GpsSolveVector {
    const fromStation = this.stations[obs.from];
    const toStation = this.stations[obs.to];
    if (!fromStation || !toStation) return { dE: 0, dN: 0, dU: 0, scale: 1 };
    const modeled = this.gpsModeledVectorFromStationValues(
      obs,
      { x: fromStation.x, y: fromStation.y, h: fromStation.h },
      { x: toStation.x, y: toStation.y, h: toStation.h },
    );
    return { ...modeled, scale: 1 };
  }

  private gpsModeledVectorDerivatives(obs: GpsObservation): GpsVectorDerivatives {
    const fromStation = this.stations[obs.from];
    const toStation = this.stations[obs.to];
    const empty: GpsVectorDerivatives = { from: {}, to: {} };
    if (!fromStation || !toStation) return empty;

    const delta = 1e-4;
    const differentiate = (
      endpoint: 'from' | 'to',
      component: 'x' | 'y' | 'h',
    ): GpsVectorComponents | undefined => {
      if (component === 'h' && this.is2D) return undefined;
      const fromBase = { x: fromStation.x, y: fromStation.y, h: fromStation.h };
      const toBase = { x: toStation.x, y: toStation.y, h: toStation.h };
      const fromPlus = { ...fromBase };
      const fromMinus = { ...fromBase };
      const toPlus = { ...toBase };
      const toMinus = { ...toBase };
      if (endpoint === 'from') {
        fromPlus[component] += delta;
        fromMinus[component] -= delta;
      } else {
        toPlus[component] += delta;
        toMinus[component] -= delta;
      }
      const plus = this.gpsModeledVectorFromStationValues(obs, fromPlus, toPlus);
      const minus = this.gpsModeledVectorFromStationValues(obs, fromMinus, toMinus);
      return {
        dE: (plus.dE - minus.dE) / (2 * delta),
        dN: (plus.dN - minus.dN) / (2 * delta),
        dU:
          !this.is2D &&
          Number.isFinite(plus.dU ?? Number.NaN) &&
          Number.isFinite(minus.dU ?? Number.NaN)
            ? ((plus.dU as number) - (minus.dU as number)) / (2 * delta)
            : undefined,
      };
    };

    empty.from.x = differentiate('from', 'x');
    empty.from.y = differentiate('from', 'y');
    empty.to.x = differentiate('to', 'x');
    empty.to.y = differentiate('to', 'y');
    if (!this.is2D) {
      empty.from.h = differentiate('from', 'h');
      empty.to.h = differentiate('to', 'h');
    }
    return empty;
  }

  private updateGpsAddHiHtDiagnostics(): void {
    if (!this.parseState) return;

    const enabled = this.parseState.gpsAddHiHtEnabled ?? false;
    let vectorCount = 0;
    let appliedCount = 0;
    let positiveCount = 0;
    let negativeCount = 0;
    let neutralCount = 0;
    let defaultZeroCount = 0;
    let missingHeightCount = 0;
    let scaleMin = Number.POSITIVE_INFINITY;
    let scaleMax = 0;

    this.observations.forEach((obs) => {
      if (obs.type !== 'gps') return;
      vectorCount += 1;
      const hasHi = Number.isFinite(obs.gpsAntennaHiM ?? Number.NaN);
      const hasHt = Number.isFinite(obs.gpsAntennaHtM ?? Number.NaN);
      if (!hasHi || !hasHt) {
        missingHeightCount += 1;
      }
      const hi = hasHi ? (obs.gpsAntennaHiM as number) : 0;
      const ht = hasHt ? (obs.gpsAntennaHtM as number) : 0;
      if (Math.abs(hi) <= 1e-12 && Math.abs(ht) <= 1e-12) {
        defaultZeroCount += 1;
      }
      const scale = this.gpsObservedVector(obs).scale;
      scaleMin = Math.min(scaleMin, scale);
      scaleMax = Math.max(scaleMax, scale);
      const delta = scale - 1;
      if (Math.abs(delta) <= GPS_ADDHIHT_SCALE_TOL) {
        neutralCount += 1;
      } else {
        appliedCount += 1;
        if (delta > 0) {
          positiveCount += 1;
        } else {
          negativeCount += 1;
        }
      }
    });

    this.parseState.gpsAddHiHtVectorCount = vectorCount;
    this.parseState.gpsAddHiHtAppliedCount = appliedCount;
    this.parseState.gpsAddHiHtPositiveCount = positiveCount;
    this.parseState.gpsAddHiHtNegativeCount = negativeCount;
    this.parseState.gpsAddHiHtNeutralCount = neutralCount;
    this.parseState.gpsAddHiHtDefaultZeroCount = defaultZeroCount;
    this.parseState.gpsAddHiHtMissingHeightCount = missingHeightCount;
    this.parseState.gpsAddHiHtScaleMin = vectorCount > 0 ? scaleMin : 1;
    this.parseState.gpsAddHiHtScaleMax = vectorCount > 0 ? scaleMax : 1;

    if (enabled) {
      this.log(
        `GPS AddHiHt preprocessing: vectors=${vectorCount}, adjusted=${appliedCount} (+${positiveCount}/-${negativeCount}/neutral=${neutralCount}), defaultZero=${defaultZeroCount}, missingHeight=${missingHeightCount}, scale[min=${(this.parseState.gpsAddHiHtScaleMin ?? 1).toFixed(8)}, max=${(this.parseState.gpsAddHiHtScaleMax ?? 1).toFixed(8)}]`,
      );
    }
  }

  private isTsCorrelationObservation(obs: Observation): boolean {
    return (
      obs.type === 'angle' ||
      obs.type === 'direction' ||
      obs.type === 'bearing' ||
      obs.type === 'dir'
    );
  }

  private tsCorrelationGroup(
    obs: Observation,
  ): { key: string; station: StationId; setId?: string } | null {
    if (!this.tsCorrelationEnabled || !this.isTsCorrelationObservation(obs)) return null;
    const station = obs.type === 'angle' || obs.type === 'direction' ? obs.at : obs.from;
    const setId = (obs as any).setId != null ? String((obs as any).setId) : undefined;
    const key = this.tsCorrelationScope === 'setup' ? station : `${station}|${setId ?? obs.type}`;
    return { key, station, setId };
  }

  private applyTsCorrelationToWeightMatrix(
    P: number[][],
    rowInfo: EquationRowInfo[],
    captureDiagnostics = false,
  ): void {
    if (!this.tsCorrelationEnabled) {
      if (captureDiagnostics) {
        this.tsCorrelationDiagnostics = {
          enabled: false,
          rho: 0,
          scope: this.tsCorrelationScope ?? 'set',
          groupCount: 0,
          equationCount: 0,
          pairCount: 0,
          maxGroupSize: 0,
          groups: [],
        };
      }
      return;
    }

    const rhoBase = Math.min(0.95, Math.max(0, this.tsCorrelationRho || 0));
    if (rhoBase <= 0) {
      if (captureDiagnostics) {
        this.tsCorrelationDiagnostics = {
          enabled: true,
          rho: rhoBase,
          scope: this.tsCorrelationScope ?? 'set',
          groupCount: 0,
          equationCount: 0,
          pairCount: 0,
          maxGroupSize: 0,
          groups: [],
        };
      }
      return;
    }

    const groups = new Map<
      string,
      { station: StationId; setId?: string; rows: Array<{ index: number; sigma: number }> }
    >();
    rowInfo.forEach((info, index) => {
      if (!info || info.component) return;
      const group = this.tsCorrelationGroup(info.obs);
      if (!group) return;
      const sigma = this.effectiveStdDev(info.obs);
      if (!Number.isFinite(sigma) || sigma <= 0) return;
      const entry = groups.get(group.key) ?? {
        station: group.station,
        setId: group.setId,
        rows: [],
      };
      entry.rows.push({ index, sigma });
      groups.set(group.key, entry);
    });

    let equationCount = 0;
    let pairCountTotal = 0;
    let maxGroupSize = 0;
    let offDiagAbsSumTotal = 0;
    const diagRows: NonNullable<AdjustmentResult['tsCorrelationDiagnostics']>['groups'] = [];

    groups.forEach((entry, key) => {
      const n = entry.rows.length;
      equationCount += n;
      maxGroupSize = Math.max(maxGroupSize, n);
      if (n < 2) {
        if (captureDiagnostics) {
          diagRows.push({
            key,
            station: entry.station,
            setId: entry.setId,
            rows: n,
            pairCount: 0,
          });
        }
        return;
      }

      const rho = Math.min(0.999999, Math.max(0, rhoBase));
      const denom = (1 - rho) * (1 - rho + n * rho);
      if (!Number.isFinite(denom) || denom <= 1e-24) return;
      const a = 1 / (1 - rho);
      const b = rho / denom;
      let pairCount = 0;
      let offDiagAbsSum = 0;

      entry.rows.forEach((row) => {
        P[row.index][row.index] = (a - b) / (row.sigma * row.sigma);
      });
      for (let i = 0; i < n; i += 1) {
        const ri = entry.rows[i];
        for (let j = i + 1; j < n; j += 1) {
          const rj = entry.rows[j];
          const w = -b / (ri.sigma * rj.sigma);
          P[ri.index][rj.index] = w;
          P[rj.index][ri.index] = w;
          pairCount += 1;
          offDiagAbsSum += Math.abs(w);
        }
      }

      pairCountTotal += pairCount;
      offDiagAbsSumTotal += offDiagAbsSum;
      if (captureDiagnostics) {
        diagRows.push({
          key,
          station: entry.station,
          setId: entry.setId,
          rows: n,
          pairCount,
          meanAbsOffDiagWeight: pairCount > 0 ? offDiagAbsSum / pairCount : undefined,
        });
      }
    });

    if (captureDiagnostics) {
      this.tsCorrelationDiagnostics = {
        enabled: true,
        rho: rhoBase,
        scope: this.tsCorrelationScope ?? 'set',
        groupCount: groups.size,
        equationCount,
        pairCount: pairCountTotal,
        maxGroupSize,
        meanAbsOffDiagWeight: pairCountTotal > 0 ? offDiagAbsSumTotal / pairCountTotal : undefined,
        groups: diagRows.sort((a, b) => {
          if (b.rows !== a.rows) return b.rows - a.rows;
          if (b.pairCount !== a.pairCount) return b.pairCount - a.pairCount;
          return a.key.localeCompare(b.key);
        }),
      };
    }
  }

  private weightedQuadratic(P: number[][], v: number[][]): number {
    return symmetricQuadraticForm(P, v);
  }

  private observationStations(obs: Observation): string {
    if (obs.type === 'angle') return `${obs.at}-${obs.from}-${obs.to}`;
    if (obs.type === 'direction') return `${obs.at}-${obs.to}`;
    if (
      obs.type === 'dist' ||
      obs.type === 'bearing' ||
      obs.type === 'zenith' ||
      obs.type === 'lev' ||
      obs.type === 'gps' ||
      obs.type === 'dir'
    ) {
      return `${obs.from}-${obs.to}`;
    }
    return '-';
  }

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
    if (!this.tsCorrelationEnabled) return [];
    const groups = new Map<string, number[]>();
    rowInfo.forEach((info, index) => {
      if (!info || info.component) return;
      const group = this.tsCorrelationGroup(info.obs);
      if (!group) return;
      const sigma = this.rowSigma(info);
      if (!Number.isFinite(sigma) || sigma <= 0) return;
      const rows = groups.get(group.key) ?? [];
      rows.push(index);
      groups.set(group.key, rows);
    });
    return [...groups.values()].filter((rows) => rows.length > 1);
  }

  private captureRobustWeightBase(
    P: number[][],
    rowInfo: EquationRowInfo[],
  ): RobustWeightMatrixBase {
    const diagonal = P.map((row, i) => row[i] ?? 0);
    const correlatedPairs: RobustWeightMatrixBase['correlatedPairs'] = [];
    this.robustCorrelationRowGroups(rowInfo).forEach((rows) => {
      for (let a = 0; a < rows.length; a += 1) {
        const i = rows[a];
        for (let b = a + 1; b < rows.length; b += 1) {
          const j = rows[b];
          const base = P[i][j] ?? 0;
          if (Math.abs(base) <= 0) continue;
          correlatedPairs.push({ i, j, base });
        }
      }
    });
    return { diagonal, correlatedPairs };
  }

  private applyRobustWeightFactors(
    P: number[][],
    base: RobustWeightMatrixBase,
    factors: number[],
  ): void {
    for (let i = 0; i < P.length; i += 1) {
      P[i][i] = (base.diagonal[i] ?? 0) * (factors[i] ?? 1);
    }
    base.correlatedPairs.forEach(({ i, j, base: pairBase }) => {
      const scale = Math.sqrt((factors[i] ?? 1) * (factors[j] ?? 1));
      const scaled = pairBase * scale;
      P[i][j] = scaled;
      P[j][i] = scaled;
    });
  }

  private computeRobustWeightSummary(
    residuals: number[],
    rowInfo: EquationRowInfo[],
  ): RobustWeightSummary {
    const k = Math.max(0.5, Math.min(10, this.robustK || 1.5));
    const factors = new Array(rowInfo.length).fill(1);

    let downweightedRows = 0;
    let minWeight = 1;
    let maxNorm = 0;
    let meanWeightSum = 0;
    let meanWeightCount = 0;
    const candidates: NonNullable<AdjustmentResult['robustDiagnostics']>['topDownweightedRows'] =
      [];

    for (let i = 0; i < rowInfo.length; i += 1) {
      const info = rowInfo[i];
      if (!info) continue;
      const sigma = this.rowSigma(info);
      const norm = Math.abs(residuals[i] ?? 0) / Math.max(sigma, 1e-24);
      maxNorm = Math.max(maxNorm, norm);
      let w = 1;
      if (norm > k) w = k / norm;
      w = Math.max(0.001, Math.min(1, w));
      factors[i] = w;
      meanWeightSum += w;
      meanWeightCount += 1;
      if (w < 0.999999) {
        downweightedRows += 1;
        minWeight = Math.min(minWeight, w);
        candidates.push({
          obsId: info.obs.id,
          type: info.obs.type,
          stations: this.observationStations(info.obs),
          sourceLine: info.obs.sourceLine,
          weight: w,
          norm,
        });
      }
    }

    return {
      factors,
      downweightedRows,
      minWeight: downweightedRows > 0 ? minWeight : 1,
      maxNorm,
      meanWeight: meanWeightCount > 0 ? meanWeightSum / meanWeightCount : 1,
      topRows: candidates
        .sort((a, b) => {
          if (a.weight !== b.weight) return a.weight - b.weight;
          return b.norm - a.norm;
        })
        .slice(0, 15),
    };
  }

  private recordRobustDiagnostics(
    iteration: number,
    summary: RobustWeightSummary,
    maxWeightDelta: number,
  ): void {
    if (!this.robustDiagnostics) return;
    this.robustDiagnostics.iterations.push({
      iteration,
      downweightedRows: summary.downweightedRows,
      meanWeight: summary.meanWeight,
      minWeight: summary.minWeight,
      maxNorm: summary.maxNorm,
      maxWeightDelta,
    });
    this.robustDiagnostics.topDownweightedRows = summary.topRows;
    this.log(
      `Iter ${iteration} robust(${this.robustMode}): downweighted=${summary.downweightedRows}, minW=${summary.minWeight.toFixed(3)}, meanW=${summary.meanWeight.toFixed(3)}, max|v/sigma|=${summary.maxNorm.toFixed(2)}, maxDeltaW=${maxWeightDelta.toFixed(4)}`,
    );
  }

  private maxRobustWeightDelta(a: number[], b: number[]): number {
    const count = Math.max(a.length, b.length);
    let maxDelta = 0;
    for (let i = 0; i < count; i += 1) {
      maxDelta = Math.max(maxDelta, Math.abs((a[i] ?? 1) - (b[i] ?? 1)));
    }
    return maxDelta;
  }

  private computeDirectionSetPrefit(
    activeObservations: Observation[],
    directionSetIds: string[],
  ): void {
    const groups = new Map<
      string,
      { count: number; sumSin: number; sumCos: number; occupy: StationId }
    >();
    const diffsBySet = new Map<string, number[]>();

    activeObservations.forEach((obs) => {
      if (obs.type !== 'direction') return;
      const dir = obs as any;
      if (!this.stations[dir.at] || !this.stations[dir.to]) return;
      const az = this.modeledAzimuth(
        this.getAzimuth(dir.at, dir.to).az,
        dir.at,
        dir.gridObsMode !== 'grid',
      );
      const diff = ((dir.obs - az + Math.PI) % (2 * Math.PI)) - Math.PI;
      const entry = groups.get(dir.setId) ?? {
        count: 0,
        sumSin: 0,
        sumCos: 0,
        occupy: dir.at,
      };
      entry.count += 1;
      entry.sumSin += Math.sin(diff);
      entry.sumCos += Math.cos(diff);
      entry.occupy = dir.at ?? entry.occupy;
      groups.set(dir.setId, entry);
      const arr = diffsBySet.get(dir.setId) ?? [];
      arr.push(diff);
      diffsBySet.set(dir.setId, arr);
    });

    if (!groups.size) return;

    this.logs.push('Direction set prefit (initial coords, arcsec residuals):');
    const sorted = [...groups.entries()].sort((a, b) => a[0].localeCompare(b[0]));
    sorted.forEach(([setId, entry]) => {
      const orient = Math.atan2(entry.sumSin, entry.sumCos);
      this.directionOrientations[setId] = orient;
      const diffs = diffsBySet.get(setId) ?? [];
      let sum = 0;
      let sumSq = 0;
      let maxAbs = 0;
      diffs.forEach((d) => {
        const v = ((d - orient + Math.PI) % (2 * Math.PI)) - Math.PI;
        const arcsec = v * RAD_TO_DEG * 3600;
        sum += arcsec;
        sumSq += arcsec * arcsec;
        maxAbs = Math.max(maxAbs, Math.abs(arcsec));
      });
      const mean = diffs.length ? sum / diffs.length : 0;
      const rms = diffs.length ? Math.sqrt(sumSq / diffs.length) : 0;
      const orientDeg = (orient * RAD_TO_DEG + 360) % 360;
      this.logs.push(
        `  ${setId} @ ${entry.occupy}: n=${diffs.length}, mean=${mean.toFixed(
          2,
        )}", rms=${rms.toFixed(2)}", max=${maxAbs.toFixed(2)}", orient=${orientDeg.toFixed(4)}°`,
      );
    });

    // Ensure all direction sets have an initialization
    directionSetIds.forEach((id) => {
      if (this.directionOrientations[id] == null) this.directionOrientations[id] = 0;
    });
  }

  private logNetworkDiagnostics(activeObservations: Observation[]) {
    const stationObsCount = new Map<StationId, number>();
    const otherObsCount = new Map<StationId, number>();
    const directionAt = new Set<StationId>();
    const directionTargets = new Map<StationId, Set<StationId>>();
    const directionSetCounts = new Map<string, number>();

    const mark = (id: StationId) => {
      stationObsCount.set(id, (stationObsCount.get(id) ?? 0) + 1);
    };
    const markOther = (id: StationId) => {
      otherObsCount.set(id, (otherObsCount.get(id) ?? 0) + 1);
    };

    activeObservations.forEach((obs) => {
      if (obs.type === 'direction') {
        const dir = obs as any;
        mark(dir.at);
        mark(dir.to);
        directionAt.add(dir.at);
        const set = directionTargets.get(dir.to) ?? new Set<StationId>();
        set.add(dir.at);
        directionTargets.set(dir.to, set);
        directionSetCounts.set(dir.setId, (directionSetCounts.get(dir.setId) ?? 0) + 1);
        return;
      }

      if (obs.type === 'angle') {
        mark(obs.at);
        mark(obs.from);
        mark(obs.to);
        markOther(obs.at);
        markOther(obs.from);
        markOther(obs.to);
        return;
      }
      if (
        obs.type === 'dist' ||
        obs.type === 'bearing' ||
        obs.type === 'lev' ||
        obs.type === 'zenith'
      ) {
        mark(obs.from);
        mark(obs.to);
        markOther(obs.from);
        markOther(obs.to);
        return;
      }
      if (obs.type === 'dir') {
        mark(obs.from);
        mark(obs.to);
        markOther(obs.from);
        markOther(obs.to);
        return;
      }
      if (obs.type === 'gps') {
        mark(obs.from);
        mark(obs.to);
        markOther(obs.from);
        markOther(obs.to);
      }
    });

    this.unknowns.forEach((id) => {
      if (!stationObsCount.has(id)) {
        this.log(
          `Warning: unknown station ${id} has no observations and will cause a singular network.`,
        );
        return;
      }

      const hasOther = (otherObsCount.get(id) ?? 0) > 0;
      if (!directionAt.has(id) && !hasOther) {
        const atCount = directionTargets.get(id)?.size ?? 0;
        if (atCount < 2) {
          this.log(
            `Warning: station ${id} is only targeted by directions from ${atCount} station(s). ` +
              `At least two occupies or distance/GNSS observations are required to solve it.`,
          );
        }
      }
    });

    directionSetCounts.forEach((count, setId) => {
      if (count < 2) {
        this.log(
          `Warning: direction set ${setId} has only ${count} observation(s); orientation may be weak.`,
        );
      }
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
    this.progressCallback({
      phase,
      iteration: this.iterations,
      maxIterations: this.maxIterations,
      elapsedMs: Math.max(0, Date.now() - this.solveStartedAt),
      converged: this.converged,
    });
  }

  private resetSolveTiming(): void {
    this.solveTiming = {
      parseAndSetupMs: 0,
      equationAssemblyMs: 0,
      matrixFactorizationMs: 0,
      precisionAndDiagnosticsMs: 0,
      precisionPropagationMs: 0,
      resultPackagingMs: 0,
    };
    this.solveTimingLogged = false;
  }

  private buildSolveTimingProfile(): NonNullable<AdjustmentResult['solveTimingProfile']> {
    const totalMs = Math.max(0, Date.now() - this.solveStartedAt);
    const reportDiagnosticsMs = Math.max(
      0,
      this.solveTiming.precisionAndDiagnosticsMs - this.solveTiming.precisionPropagationMs,
    );
    const classifiedMs =
      this.solveTiming.parseAndSetupMs +
      this.solveTiming.equationAssemblyMs +
      this.solveTiming.matrixFactorizationMs +
      this.solveTiming.precisionAndDiagnosticsMs +
      this.solveTiming.resultPackagingMs;
    return {
      totalMs,
      parseAndSetupMs: this.solveTiming.parseAndSetupMs,
      equationAssemblyMs: this.solveTiming.equationAssemblyMs,
      matrixFactorizationMs: this.solveTiming.matrixFactorizationMs,
      precisionAndDiagnosticsMs: this.solveTiming.precisionAndDiagnosticsMs,
      precisionPropagationMs: this.solveTiming.precisionPropagationMs,
      reportDiagnosticsMs,
      resultPackagingMs: this.solveTiming.resultPackagingMs,
      otherMs: Math.max(0, totalMs - classifiedMs),
    };
  }

  private logSolveTimingProfile(
    profile: NonNullable<AdjustmentResult['solveTimingProfile']>,
  ): void {
    if (this.solveTimingLogged) return;
    this.solveTimingLogged = true;
    this.logs.push(
      `Solve timing (ms): total=${profile.totalMs.toFixed(1)}, setup=${profile.parseAndSetupMs.toFixed(1)}, assembly=${profile.equationAssemblyMs.toFixed(1)}, factor=${profile.matrixFactorizationMs.toFixed(1)}, precision+diag=${profile.precisionAndDiagnosticsMs.toFixed(1)}, precision=${profile.precisionPropagationMs.toFixed(1)}, report=${profile.reportDiagnosticsMs.toFixed(1)}, packaging=${profile.resultPackagingMs.toFixed(1)}, other=${profile.otherMs.toFixed(1)}`,
    );
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

  private resolveRunModeCompatibilityOptions(
    requestedRunMode: RunMode,
    options: Partial<ParseOptions>,
  ): { effectiveOptions: Partial<ParseOptions>; diagnostics: RunModeCompatibilityDiagnostic[] } {
    const effectiveOptions: Partial<ParseOptions> = { ...(options ?? {}) };
    const diagnostics: RunModeCompatibilityDiagnostic[] = [];
    const warn = (code: string, message: string, action?: string): void => {
      diagnostics.push({ code, severity: 'warning', message, action });
    };

    const hasClusterMerges = (effectiveOptions.clusterApprovedMerges?.length ?? 0) > 0;
    const robustRequested = (effectiveOptions.robustMode ?? 'none') !== 'none';
    const autoAdjustRequested = effectiveOptions.autoAdjustEnabled === true;
    const autoSideshotRequested = effectiveOptions.autoSideshotEnabled !== false;
    const clusterRequested = effectiveOptions.clusterDetectionEnabled !== false;

    if (requestedRunMode === 'adjustment') {
      if (effectiveOptions.preanalysisMode === true) {
        warn(
          'ADJUSTMENT_IGNORES_PREANALYSIS_FLAG',
          'preanalysisMode=true is ignored when runMode=adjustment.',
          'Using preanalysisMode=false for this run.',
        );
      }
      effectiveOptions.preanalysisMode = false;
    }

    if (requestedRunMode === 'preanalysis') {
      effectiveOptions.preanalysisMode = true;
      if (autoAdjustRequested) {
        warn(
          'PREANALYSIS_DISALLOWS_AUTOADJUST',
          'Auto-adjust is not available in preanalysis mode.',
          'Disabling auto-adjust for this run.',
        );
        effectiveOptions.autoAdjustEnabled = false;
      }
      if (robustRequested) {
        warn(
          'PREANALYSIS_DISALLOWS_ROBUST',
          'Robust reweighting is not available in preanalysis mode.',
          'Using robustMode=none for this run.',
        );
        effectiveOptions.robustMode = 'none';
      }
      if (autoSideshotRequested) {
        warn(
          'PREANALYSIS_SKIPS_AUTOSIDESHOT',
          'Auto-sideshot detection is skipped in preanalysis mode.',
          'Disabling auto-sideshot diagnostics for this run.',
        );
        effectiveOptions.autoSideshotEnabled = false;
      }
      if (clusterRequested) {
        warn(
          'PREANALYSIS_SKIPS_CLUSTER',
          'Cluster detection is skipped in preanalysis mode.',
          'Disabling cluster detection for this run.',
        );
        effectiveOptions.clusterDetectionEnabled = false;
      }
      if (hasClusterMerges) {
        warn(
          'PREANALYSIS_DISALLOWS_CLUSTER_MERGES',
          'Approved cluster merges are not applied in preanalysis mode.',
          'Ignoring approved cluster merges for this run.',
        );
        effectiveOptions.clusterApprovedMerges = [];
        effectiveOptions.clusterApprovedMergeCount = 0;
        effectiveOptions.clusterDualPassRan = false;
      }
    }

    if (requestedRunMode === 'data-check') {
      effectiveOptions.preanalysisMode = false;
      if (autoAdjustRequested) {
        warn(
          'DATACHECK_DISALLOWS_AUTOADJUST',
          'Auto-adjust is not available in Data Check Only mode.',
          'Disabling auto-adjust for this run.',
        );
        effectiveOptions.autoAdjustEnabled = false;
      }
      if (robustRequested) {
        warn(
          'DATACHECK_DISALLOWS_ROBUST',
          'Robust reweighting is not available in Data Check Only mode.',
          'Using robustMode=none for this run.',
        );
        effectiveOptions.robustMode = 'none';
      }
      if (autoSideshotRequested) {
        warn(
          'DATACHECK_SKIPS_AUTOSIDESHOT',
          'Auto-sideshot detection is skipped in Data Check Only mode.',
          'Disabling auto-sideshot diagnostics for this run.',
        );
        effectiveOptions.autoSideshotEnabled = false;
      }
      if (clusterRequested) {
        warn(
          'DATACHECK_SKIPS_CLUSTER',
          'Cluster detection is skipped in Data Check Only mode.',
          'Disabling cluster detection for this run.',
        );
        effectiveOptions.clusterDetectionEnabled = false;
      }
      if (hasClusterMerges) {
        warn(
          'DATACHECK_DISALLOWS_CLUSTER_MERGES',
          'Approved cluster merges are not applied in Data Check Only mode.',
          'Ignoring approved cluster merges for this run.',
        );
        effectiveOptions.clusterApprovedMerges = [];
        effectiveOptions.clusterApprovedMergeCount = 0;
        effectiveOptions.clusterDualPassRan = false;
      }
    }

    if (requestedRunMode === 'blunder-detect') {
      effectiveOptions.preanalysisMode = false;
      if (autoAdjustRequested) {
        warn(
          'BLUNDER_DISALLOWS_AUTOADJUST',
          'Auto-adjust is not available in Blunder Detect mode.',
          'Disabling auto-adjust for this run.',
        );
        effectiveOptions.autoAdjustEnabled = false;
      }
      if (robustRequested) {
        warn(
          'BLUNDER_DISALLOWS_ROBUST',
          'Robust reweighting is not available in Blunder Detect mode.',
          'Using robustMode=none for this run.',
        );
        effectiveOptions.robustMode = 'none';
      }
      if (autoSideshotRequested) {
        warn(
          'BLUNDER_SKIPS_AUTOSIDESHOT',
          'Auto-sideshot detection is skipped in Blunder Detect mode.',
          'Disabling auto-sideshot diagnostics for this run.',
        );
        effectiveOptions.autoSideshotEnabled = false;
      }
      if (clusterRequested) {
        warn(
          'BLUNDER_SKIPS_CLUSTER',
          'Cluster detection is skipped in Blunder Detect mode.',
          'Disabling cluster detection for this run.',
        );
        effectiveOptions.clusterDetectionEnabled = false;
      }
      if (hasClusterMerges) {
        warn(
          'BLUNDER_DISALLOWS_CLUSTER_MERGES',
          'Approved cluster merges are not applied in Blunder Detect mode.',
          'Ignoring approved cluster merges for this run.',
        );
        effectiveOptions.clusterApprovedMerges = [];
        effectiveOptions.clusterApprovedMergeCount = 0;
        effectiveOptions.clusterDualPassRan = false;
      }
      if (effectiveOptions.clusterPassLabel && effectiveOptions.clusterPassLabel !== 'single') {
        warn(
          'BLUNDER_RESETS_CLUSTER_PASS_LABEL',
          `Cluster pass label ${effectiveOptions.clusterPassLabel} is not used in Blunder Detect mode.`,
          'Using clusterPassLabel=single for this run.',
        );
      }
      effectiveOptions.clusterPassLabel = 'single';
    }

    effectiveOptions.runMode = requestedRunMode;
    if (requestedRunMode !== 'preanalysis') {
      effectiveOptions.preanalysisMode = false;
    }
    return { effectiveOptions, diagnostics };
  }

  private runModeCompatibilityDiagnosticLines(
    diagnostics: RunModeCompatibilityDiagnostic[],
  ): string[] {
    return diagnostics.map((diag) => {
      const head =
        diag.severity === 'error'
          ? `Error: Run-mode compatibility [${diag.code}] ${diag.message}`
          : `Warning: Run-mode compatibility [${diag.code}] ${diag.message}`;
      return diag.action ? `${head} Action: ${diag.action}` : head;
    });
  }

  private emitRunModeCompatibilityDiagnostics(diagnostics: RunModeCompatibilityDiagnostic[]): void {
    this.runModeCompatibilityDiagnosticLines(diagnostics).forEach((line) => this.log(line));
  }

  private addCoordSystemDiagnostic(code: CoordSystemDiagnosticCode, warning?: string): void {
    this.coordSystemDiagnostics.add(code);
    if (!warning) return;
    const normalized = warning.trim();
    if (!normalized) return;
    if (this.coordWarningSeen.has(normalized)) return;
    this.coordWarningSeen.add(normalized);
    this.coordSystemWarningMessages.push(normalized);
    this.log(`Warning: ${normalized}`);
  }

  private addCoordSystemWarning(warning: string): void {
    const normalized = warning.trim();
    if (!normalized) return;
    if (this.coordWarningSeen.has(normalized)) return;
    this.coordWarningSeen.add(normalized);
    this.coordSystemWarningMessages.push(normalized);
    this.log(`Warning: ${normalized}`);
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
    const station = this.stations[stationId];
    if (!station) return false;
    if (!Number.isFinite(station.x) || !Number.isFinite(station.y)) return false;
    if (station.coordInputClass && station.coordInputClass !== 'unknown') return true;
    return station.bootstrapApprox === true;
  }

  private buildBootstrapPairMetrics(
    activeObservations: Observation[],
  ): Map<string, BootstrapPairMetrics> {
    const zenithStats = new Map<string, { sum: number; count: number }>();
    activeObservations.forEach((observation) => {
      if (observation.type !== 'zenith') return;
      const key = makeDirectedPairKey(observation.from, observation.to);
      const entry = zenithStats.get(key) ?? { sum: 0, count: 0 };
      entry.sum += observation.obs;
      entry.count += 1;
      zenithStats.set(key, entry);
    });

    const metrics = new Map<string, { slopeSum: number; horizSum: number; count: number }>();
    activeObservations.forEach((observation) => {
      if (observation.type !== 'dist') return;
      const key = makeDirectedPairKey(observation.from, observation.to);
      const zenithEntry = zenithStats.get(key);
      const zenith =
        zenithEntry && zenithEntry.count > 0 ? zenithEntry.sum / zenithEntry.count : undefined;
      const slopeDistance = observation.obs;
      const horizDistance =
        observation.mode === 'slope' && Number.isFinite(zenith ?? Number.NaN)
          ? Math.abs(slopeDistance * Math.sin(zenith as number))
          : Math.abs(slopeDistance);
      const entry = metrics.get(key) ?? { slopeSum: 0, horizSum: 0, count: 0 };
      entry.slopeSum += slopeDistance;
      entry.horizSum += horizDistance;
      entry.count += 1;
      metrics.set(key, entry);
    });

    return new Map(
      [...metrics.entries()].map(([key, entry]) => {
        const zenithEntry = zenithStats.get(key);
        return [
          key,
          {
            slopeDistance: entry.slopeSum / entry.count,
            horizDistance: entry.horizSum / entry.count,
            zenith:
              zenithEntry && zenithEntry.count > 0 ? zenithEntry.sum / zenithEntry.count : undefined,
          } satisfies BootstrapPairMetrics,
        ];
      }),
    );
  }

  private applyBootstrapApproxStation(
    stationId: StationId,
    seed: { x: number; y: number; h?: number },
  ): boolean {
    const station = this.stations[stationId];
    if (!station) return false;
    const isInputControl = !!station.coordInputClass && station.coordInputClass !== 'unknown';
    if (isInputControl) return false;
    const nextX = Number.isFinite(seed.x) ? seed.x : station.x;
    const nextY = Number.isFinite(seed.y) ? seed.y : station.y;
    const nextH = Number.isFinite(seed.h ?? Number.NaN) ? (seed.h as number) : station.h;
    const changed =
      !station.bootstrapApprox ||
      Math.hypot((station.x ?? 0) - nextX, (station.y ?? 0) - nextY) > 1e-6 ||
      Math.abs((station.h ?? 0) - nextH) > 1e-6;
    if (!changed) return false;
    station.x = nextX;
    station.y = nextY;
    station.h = nextH;
    station.bootstrapApprox = true;
    if (this.coordSystemMode === 'grid') {
      this.stationGeodetic(stationId);
      this.stationFactorSnapshot(stationId);
    }
    return true;
  }

  private estimateBootstrapSetOrientation(
    set: BootstrapDirectionSet,
    pairMetrics: Map<string, BootstrapPairMetrics>,
  ): number | null {
    const occupy = this.stations[set.occupy];
    if (!occupy || !this.stationHasBootstrapableApprox(set.occupy)) return null;
    const orientations = set.directions
      .filter((direction) => {
        const target = this.stations[direction.to];
        const pair = pairMetrics.get(makeDirectedPairKey(set.occupy, direction.to));
        return (
          target &&
          this.stationHasBootstrapableApprox(direction.to) &&
          Number.isFinite(pair?.horizDistance ?? Number.NaN) &&
          (pair?.horizDistance ?? 0) > 1e-6
        );
      })
      .map((direction) => {
        const target = this.stations[direction.to] as Station;
        const azimuth = azimuthFromCoords(occupy.x, occupy.y, target.x, target.y);
        return wrapTo2Pi(azimuth - direction.obs);
      });
    return circularMean(orientations);
  }

  private tryBootstrapDirectionSetOccupy(
    set: BootstrapDirectionSet,
    pairMetrics: Map<string, BootstrapPairMetrics>,
  ): { x: number; y: number; h?: number; orientation: number } | null {
    const knownTargets = set.directions
      .map((direction) => {
        const target = this.stations[direction.to];
        const metrics = pairMetrics.get(makeDirectedPairKey(set.occupy, direction.to));
        if (!target || !metrics || !this.stationHasBootstrapableApprox(direction.to)) return null;
        if (!Number.isFinite(metrics.horizDistance) || metrics.horizDistance <= 1e-6) return null;
        return { direction, target, metrics };
      })
      .filter((entry): entry is NonNullable<typeof entry> => entry != null);
    if (knownTargets.length < 2) return null;

    let best:
      | { x: number; y: number; h?: number; orientation: number; mismatch: number }
      | undefined;

    for (let i = 0; i < knownTargets.length - 1; i += 1) {
      for (let j = i + 1; j < knownTargets.length; j += 1) {
        const first = knownTargets[i];
        const second = knownTargets[j];
        const intersections = intersectDistanceCircles(
          first.target.x,
          first.target.y,
          first.metrics.horizDistance,
          second.target.x,
          second.target.y,
          second.metrics.horizDistance,
        );
        intersections.forEach((candidate) => {
          const orientationValues = knownTargets.map((entry) => {
            const azimuth = azimuthFromCoords(candidate.x, candidate.y, entry.target.x, entry.target.y);
            return wrapTo2Pi(azimuth - entry.direction.obs);
          });
          const orientation = circularMean(orientationValues);
          if (orientation == null) return;
          const mismatch = knownTargets.reduce((total, entry) => {
            const azimuth = azimuthFromCoords(candidate.x, candidate.y, entry.target.x, entry.target.y);
            const predicted = wrapTo2Pi(orientation + entry.direction.obs);
            return total + Math.abs(wrapToPi(azimuth - predicted));
          }, 0);
          const heightCandidates = knownTargets
            .map((entry) =>
              Number.isFinite(entry.metrics.zenith ?? Number.NaN)
                ? entry.target.h - entry.metrics.slopeDistance * Math.cos(entry.metrics.zenith as number)
                : undefined,
            )
            .filter((value): value is number => Number.isFinite(value));
          const height =
            heightCandidates.length > 0
              ? heightCandidates.reduce((sum, value) => sum + value, 0) / heightCandidates.length
              : undefined;
          if (!best || mismatch < best.mismatch) {
            best = { x: candidate.x, y: candidate.y, h: height, orientation, mismatch };
          }
        });
      }
    }

    if (!best) return null;
    return { x: best.x, y: best.y, h: best.h, orientation: best.orientation };
  }

  private bootstrapApproximateTraverseCoords(activeObservations: Observation[]): void {
    const directionSets = new Map<string, BootstrapDirectionSet>();
    activeObservations.forEach((observation) => {
      if (observation.type !== 'direction' || !observation.setId) return;
      const entry = directionSets.get(observation.setId) ?? {
        setId: observation.setId,
        occupy: observation.at,
        directions: [],
      };
      entry.directions.push({ to: observation.to, obs: observation.obs });
      directionSets.set(observation.setId, entry);
    });
    if (directionSets.size === 0) return;

    const pairMetrics = this.buildBootstrapPairMetrics(activeObservations);
    if (pairMetrics.size === 0) return;

    let seededCount = 0;
    let passCount = 0;
    for (let pass = 0; pass < 8; pass += 1) {
      let progress = false;
      passCount = pass + 1;

      directionSets.forEach((set) => {
        if (this.stationHasBootstrapableApprox(set.occupy)) return;
        const occupySeed = this.tryBootstrapDirectionSetOccupy(set, pairMetrics);
        if (!occupySeed) return;
        if (this.applyBootstrapApproxStation(set.occupy, occupySeed)) {
          seededCount += 1;
          progress = true;
        }
      });

      directionSets.forEach((set) => {
        if (!this.stationHasBootstrapableApprox(set.occupy)) return;
        const occupy = this.stations[set.occupy];
        if (!occupy) return;
        const orientation = this.estimateBootstrapSetOrientation(set, pairMetrics);
        if (orientation == null) return;
        set.directions.forEach((direction) => {
          if (this.stationHasBootstrapableApprox(direction.to)) return;
          const metrics = pairMetrics.get(makeDirectedPairKey(set.occupy, direction.to));
          if (!metrics || !Number.isFinite(metrics.horizDistance) || metrics.horizDistance <= 1e-6) {
            return;
          }
          const azimuth = wrapTo2Pi(orientation + direction.obs);
          const seedX = occupy.x + metrics.horizDistance * Math.sin(azimuth);
          const seedY = occupy.y + metrics.horizDistance * Math.cos(azimuth);
          const seedH =
            Number.isFinite(metrics.zenith ?? Number.NaN)
              ? occupy.h + metrics.slopeDistance * Math.cos(metrics.zenith as number)
              : occupy.h;
          if (this.applyBootstrapApproxStation(direction.to, { x: seedX, y: seedY, h: seedH })) {
            seededCount += 1;
            progress = true;
          }
        });
      });

      if (!progress) break;
    }

    if (seededCount > 0) {
      this.log(
        `Approximate traverse bootstrap: seeded ${seededCount} station(s) over ${passCount} pass(es).`,
      );
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
    const classes = new Set<CoordInputClass>();
    Object.values(this.stations).forEach((station) => {
      const hasControlLikeInput =
        (station.fixedX ?? false) ||
        (station.fixedY ?? false) ||
        Number.isFinite(station.sx ?? Number.NaN) ||
        Number.isFinite(station.sy ?? Number.NaN) ||
        station.coordInputClass === 'geodetic' ||
        (station.coordInputClass != null && station.coordInputClass !== 'unknown');
      if (!hasControlLikeInput) return;
      classes.add(station.coordInputClass ?? 'unknown');
    });
    const hasGrid = classes.has('grid');
    const hasGeodetic = classes.has('geodetic');
    const hasLocal = classes.has('local');
    const hasUnknown = classes.has('unknown');
    const reasons: string[] = [];
    const suggestions: string[] = [];

    if (hasUnknown) {
      reasons.push(
        'Grid mode input class check failed: one or more stations are UNKNOWN class (including geodetic records missing CRS/datum tagging).',
      );
      suggestions.push(
        'Tag geodetic records with explicit CRS/datum or re-enter as grid/projected coordinates.',
      );
    }
    if (hasLocal && (hasGrid || hasGeodetic)) {
      reasons.push(
        'Grid mode input class check failed: LOCAL coordinates mixed with GRID/GEODETIC coordinates without localization transform.',
      );
      suggestions.push(
        'Remove local records or define a localization workflow before mixing systems.',
      );
    }
    if (hasGeodetic && (!this.crsId || !this.crsId.trim())) {
      reasons.push(
        'Grid mode input class check failed: GEODETIC coordinates provided but CRS id is missing.',
      );
      suggestions.push('Set project CRS id before running a grid solve.');
    }

    const unknownGnssRows = activeObservations.filter(
      (obs) =>
        obs.type === 'gps' &&
        (obs.gnssVectorFrame ?? this.parseState?.gnssVectorFrameDefault ?? 'gridNEU') ===
          'unknown' &&
        !((obs.gnssFrameConfirmed ?? false) || this.gnssFrameConfirmed),
    );
    if (unknownGnssRows.length > 0) {
      reasons.push(
        `Grid mode GNSS frame check failed: ${unknownGnssRows.length} vector(s) are UNKNOWN frame and not confirmed.`,
      );
      suggestions.push(
        'Set .GPS FRAME to a known frame (GRIDNEU/ENULOCAL/ECEFDELTA/LLHBASELINE) or confirm unknown frame usage.',
      );
    }

    return {
      blocked: reasons.length > 0,
      reasons,
      suggestions,
    };
  }

  private evaluateDatumSufficiency(activeObservations: Observation[]): DatumSufficiencyReport {
    const reasons: string[] = [];
    const suggestions: string[] = [];
    let status: DatumSufficiencyReport['status'] = 'ok';

    const hasDistanceLike = activeObservations.some(
      (obs) => obs.type === 'dist' || obs.type === 'gps',
    );
    const hasAngularFamilies = activeObservations.some(
      (obs) =>
        obs.type === 'angle' ||
        obs.type === 'bearing' ||
        obs.type === 'dir' ||
        obs.type === 'direction',
    );
    const weightedOrFixedXYCount = Object.values(this.stations).filter((station) => {
      const fixedXY = (station.fixedX ?? false) && (station.fixedY ?? false);
      const weightedXY =
        Number.isFinite(station.sx ?? Number.NaN) && Number.isFinite(station.sy ?? Number.NaN);
      return fixedXY || weightedXY;
    }).length;
    const weightedOrFixedHCount = Object.values(this.stations).filter((station) => {
      const fixedH = station.fixedH ?? false;
      const weightedH = Number.isFinite(station.sh ?? Number.NaN);
      return fixedH || weightedH;
    }).length;

    if (this.is2D) {
      const scaleDefined =
        hasDistanceLike ||
        weightedOrFixedXYCount >= 2 ||
        (weightedOrFixedXYCount >= 1 && !hasAngularFamilies);
      if (!scaleDefined) {
        status = 'hard-fail';
        reasons.push(
          '2D datum sufficiency failed: scale is undefined (no distance-like constraints and control does not constrain scale).',
        );
        suggestions.push(
          'Add at least one distance-like constraint (distance/GNSS) or add fixed/weighted coordinate control that constrains scale.',
        );
      } else if (weightedOrFixedXYCount < 2) {
        status = 'soft-warn';
        reasons.push(
          '2D datum sufficiency warning: weak horizontal datum control (few fixed/weighted coordinate constraints).',
        );
        suggestions.push(
          'Add a second fixed/weighted control point or a fixed azimuth/bearing constraint to strengthen orientation.',
        );
      }
    } else {
      if (weightedOrFixedXYCount === 0) {
        status = 'hard-fail';
        reasons.push(
          '3D datum sufficiency failed: horizontal datum is undefined (no fixed/weighted XY control).',
        );
        suggestions.push('Add fixed or weighted XY control points.');
      } else if (weightedOrFixedXYCount < 2) {
        status = 'soft-warn';
        reasons.push(
          '3D datum sufficiency warning: weak horizontal control (single fixed/weighted XY constraint).',
        );
        suggestions.push(
          'Add another fixed/weighted control point to stabilize orientation/scale.',
        );
      }
      if (weightedOrFixedHCount === 0) {
        status = 'hard-fail';
        reasons.push(
          '3D datum sufficiency failed: vertical datum is undefined (no fixed/weighted height control).',
        );
        suggestions.push('Add fixed/weighted height control or leveling/GNSS height constraints.');
      }
    }

    return { status, reasons, suggestions };
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
    const interpolation = this.geoidInterpolation ?? 'bilinear';
    const targetDatum = this.geoidOutputHeightDatum === 'ellipsoid' ? 'ellipsoid' : 'orthometric';
    let convertedCount = 0;
    let skippedCount = 0;
    let alreadyTargetCount = 0;
    let missingGeodeticCount = 0;
    let outsideCoverageCount = 0;

    Object.values(this.stations).forEach((station) => {
      if (!Number.isFinite(station.h)) return;
      const sourceDatum = station.heightType ?? 'orthometric';
      if (sourceDatum === targetDatum) {
        alreadyTargetCount += 1;
        return;
      }
      if (
        !Number.isFinite(station.latDeg ?? Number.NaN) ||
        !Number.isFinite(station.lonDeg ?? Number.NaN)
      ) {
        skippedCount += 1;
        missingGeodeticCount += 1;
        return;
      }

      const undulation = interpolateGeoidUndulation(
        model,
        station.latDeg as number,
        station.lonDeg as number,
        interpolation,
      );
      if (undulation == null || !Number.isFinite(undulation)) {
        skippedCount += 1;
        outsideCoverageCount += 1;
        return;
      }

      const delta = targetDatum === 'orthometric' ? -undulation : undulation;
      station.h += delta;
      if (Number.isFinite(station.constraintH ?? Number.NaN)) {
        station.constraintH = (station.constraintH ?? 0) + delta;
      }
      station.heightType = targetDatum;
      convertedCount += 1;
    });

    if (this.parseState) {
      this.parseState.geoidHeightConversionEnabled = true;
      this.parseState.geoidOutputHeightDatum = targetDatum;
      this.parseState.geoidConvertedStationCount = convertedCount;
      this.parseState.geoidSkippedStationCount = skippedCount;
    }
    this.log(
      `Geoid height conversion: ON (target=${targetDatum.toUpperCase()}, converted=${convertedCount}, skipped=${skippedCount}, already=${alreadyTargetCount})`,
    );
    if (missingGeodeticCount > 0) {
      this.log(
        `Geoid height conversion skipped ${missingGeodeticCount} station(s): missing geodetic lat/lon.`,
      );
    }
    if (outsideCoverageCount > 0) {
      this.log(
        `Geoid height conversion skipped ${outsideCoverageCount} station(s): outside geoid/grid coverage.`,
      );
    }
  }

  private applyAverageGeoidHeightConversions(): void {
    const undulation = this.averageGeoidHeight;
    if (!Number.isFinite(undulation) || Math.abs(undulation) <= 0) {
      this.log(
        'Warning: geoid height conversion requested but fallback average geoid height is zero/invalid; conversion skipped.',
      );
      return;
    }
    this.addCoordSystemDiagnostic(
      'GEOID_FALLBACK',
      `Geoid model unavailable; fallback average geoid height used (${undulation.toFixed(4)}m).`,
    );
    const targetDatum = this.geoidOutputHeightDatum === 'ellipsoid' ? 'ellipsoid' : 'orthometric';
    let convertedCount = 0;
    Object.values(this.stations).forEach((station) => {
      const currentType = station.heightType === 'ellipsoid' ? 'ellipsoid' : 'orthometric';
      if (currentType === targetDatum) return;
      const delta = targetDatum === 'orthometric' ? -undulation : undulation;
      station.h += delta;
      if (Number.isFinite(station.constraintH ?? Number.NaN)) {
        station.constraintH = (station.constraintH ?? 0) + delta;
      }
      station.heightType = targetDatum;
      convertedCount += 1;
    });
    if (this.parseState) {
      this.parseState.geoidHeightConversionEnabled = true;
      this.parseState.geoidOutputHeightDatum = targetDatum;
      this.parseState.geoidConvertedStationCount = convertedCount;
      this.parseState.geoidSkippedStationCount = 0;
    }
    this.log(
      `Geoid height conversion fallback: ON (target=${targetDatum.toUpperCase()}, avgN=${undulation.toFixed(4)}m, converted=${convertedCount})`,
    );
  }

  private resolveStationEllipsoidHeight(station: Station): {
    ellipsoidHeightUsed: number;
    source: 'perStationGeoid+H' | 'avgGeoid+H' | 'providedEllipsoid' | 'assumed0';
  } {
    if (station.heightType === 'ellipsoid') {
      station.ellipsoidHeightUsed = station.h;
      station.ellipsoidHeightSource = 'providedEllipsoid';
      return { ellipsoidHeightUsed: station.h, source: 'providedEllipsoid' };
    }

    if (
      this.activeGeoidModel &&
      Number.isFinite(station.latDeg ?? Number.NaN) &&
      Number.isFinite(station.lonDeg ?? Number.NaN)
    ) {
      const undulation = interpolateGeoidUndulation(
        this.activeGeoidModel,
        station.latDeg as number,
        station.lonDeg as number,
        this.geoidInterpolation ?? 'bilinear',
      );
      if (Number.isFinite(undulation ?? Number.NaN)) {
        const ellipsoidHeightUsed = station.h + (undulation as number);
        station.ellipsoidHeightUsed = ellipsoidHeightUsed;
        station.ellipsoidHeightSource = 'perStationGeoid+H';
        return { ellipsoidHeightUsed, source: 'perStationGeoid+H' };
      }
    }

    if (Number.isFinite(this.averageGeoidHeight) && Math.abs(this.averageGeoidHeight) > 0) {
      const ellipsoidHeightUsed = station.h + this.averageGeoidHeight;
      station.ellipsoidHeightUsed = ellipsoidHeightUsed;
      station.ellipsoidHeightSource = 'avgGeoid+H';
      this.addCoordSystemDiagnostic(
        'GEOID_FALLBACK',
        `Station geoid fallback to average N (${this.averageGeoidHeight.toFixed(4)}m) applied while resolving ellipsoid heights.`,
      );
      return { ellipsoidHeightUsed, source: 'avgGeoid+H' };
    }

    station.ellipsoidHeightUsed = station.h;
    station.ellipsoidHeightSource = 'assumed0';
    this.addCoordSystemDiagnostic(
      'GEOID_FALLBACK',
      'Average geoid height fallback is zero/invalid while ellipsoid height is required; orthometric heights used as-is.',
    );
    return { ellipsoidHeightUsed: station.h, source: 'assumed0' };
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
    if (this.coordSystemMode !== 'grid') return 0;
    const mode = this.stations[at];
    if (!mode) return 0;
    const convFrom = this.stationFactorSnapshot(from).convergenceAngleRad;
    const convTo = this.stationFactorSnapshot(to).convergenceAngleRad;
    return convTo - convFrom;
  }

  private rawDistanceCombinedFactor(obs: Observation & { type: 'dist' }): number {
    const fromF = this.stationFactorSnapshot(obs.from);
    const toF = this.stationFactorSnapshot(obs.to);
    const averageCombined = (fromF.combinedFactor + toF.combinedFactor) / 2;
    if (this.coordSystemMode !== 'grid') return averageCombined;

    const fromGeo = this.stationGeodetic(obs.from);
    const toGeo = this.stationGeodetic(obs.to);
    const fromStation = this.stations[obs.from];
    const toStation = this.stations[obs.to];
    if (!fromGeo || !toGeo || !fromStation || !toStation) return averageCombined;

    const midpointFactors = computeGridFactors(
      (fromGeo.latDeg + toGeo.latDeg) / 2,
      (fromGeo.lonDeg + toGeo.lonDeg) / 2,
      this.crsId,
    );
    if (!midpointFactors) return averageCombined;

    const meanEllipsoidHeight =
      (this.stationEllipsoidHeight(fromStation) + this.stationEllipsoidHeight(toStation)) / 2;
    return midpointFactors.gridScaleFactor * computeElevationFactor(meanEllipsoidHeight);
  }

  private rawDirectionSetCorrection(obs: Observation & { type: 'direction' }): number {
    if (this.coordSystemMode !== 'grid') return 0;
    const fromStation = this.stations[obs.at];
    const toStation = this.stations[obs.to];
    const fromGeo = this.stationGeodetic(obs.at);
    const toGeo = this.stationGeodetic(obs.to);
    if (!fromStation || !toStation || !fromGeo || !toGeo) return 0;
    const lat1 = fromGeo.latDeg * DEG_TO_RAD;
    const lon1 = fromGeo.lonDeg * DEG_TO_RAD;
    const lat2 = toGeo.latDeg * DEG_TO_RAD;
    const lon2 = toGeo.lonDeg * DEG_TO_RAD;
    const dLon = lon2 - lon1;
    const y = Math.sin(dLon) * Math.cos(lat2);
    const x =
      Math.cos(lat1) * Math.sin(lat2) - Math.sin(lat1) * Math.cos(lat2) * Math.cos(dLon);
    const bearing = Math.atan2(y, x);
    const hav =
      Math.sin((lat2 - lat1) / 2) ** 2 +
      Math.cos(lat1) * Math.cos(lat2) * Math.sin(dLon / 2) ** 2;
    const centralAngle = 2 * Math.asin(Math.min(1, Math.sqrt(Math.max(hav, 0))));
    if (!Number.isFinite(centralAngle) || centralAngle <= 0) return 0;
    const step = Math.min(centralAngle * 1e-2, 1e-6);
    if (!Number.isFinite(step) || step <= 0) return 0;
    const nearLat = Math.asin(
      Math.sin(lat1) * Math.cos(step) + Math.cos(lat1) * Math.sin(step) * Math.cos(bearing),
    );
    const nearLon =
      lon1 +
      Math.atan2(
        Math.sin(bearing) * Math.sin(step) * Math.cos(lat1),
        Math.cos(step) - Math.sin(lat1) * Math.sin(nearLat),
      );
    const nearProjected = projectGeodeticToEN({
      latDeg: nearLat * RAD_TO_DEG,
      lonDeg: nearLon * RAD_TO_DEG,
      originLatDeg: this.parseState?.originLatDeg ?? fromGeo.latDeg,
      originLonDeg: this.parseState?.originLonDeg ?? fromGeo.lonDeg,
      model: this.parseState?.crsProjectionModel ?? 'legacy-equirectangular',
      coordSystemMode: this.coordSystemMode,
      crsId: this.crsId,
    });
    const tangentAz = Math.atan2(
      nearProjected.east - fromStation.x,
      nearProjected.north - fromStation.y,
    );
    const chordAz = Math.atan2(toStation.x - fromStation.x, toStation.y - fromStation.y);
    return this.wrapToPi(chordAz - tangentAz);
  }

  private captureRawTraverseDistanceFactorSnapshots(activeObservations: Observation[]): void {
    if (!this.parseState) return;

    const rawDistanceCombinedFactorByObsId: Record<number, number> = {};
    activeObservations.forEach((obs) => {
      if (obs.type !== 'dist') return;
      rawDistanceCombinedFactorByObsId[obs.id] = this.rawDistanceCombinedFactor(obs);
    });
    this.parseState.rawDistanceCombinedFactorByObsId = rawDistanceCombinedFactorByObsId;
  }

  private captureRawTraverseDirectionCorrections(activeObservations: Observation[]): void {
    if (!this.parseState) return;
    const directionGroups = new Map<string, Observation[]>();
    activeObservations
      .filter((obs): obs is Observation & { type: 'direction' } => obs.type === 'direction')
      .sort((a, b) => {
        const aLine = a.sourceLine ?? Number.MAX_SAFE_INTEGER;
        const bLine = b.sourceLine ?? Number.MAX_SAFE_INTEGER;
        if (aLine !== bLine) return aLine - bLine;
        return a.id - b.id;
      })
      .forEach((obs) => {
        const group = directionGroups.get(obs.setId) ?? [];
        group.push(obs);
        directionGroups.set(obs.setId, group);
      });

    const rawDirectionSetCorrectionByObsId: Record<number, number> = {};
    directionGroups.forEach((group) => {
      group.forEach((obs) => {
        rawDirectionSetCorrectionByObsId[obs.id] = this.rawDirectionSetCorrection(
          obs as Observation & { type: 'direction' },
        );
      });
    });
    this.parseState.rawDirectionSetCorrectionByObsId = rawDirectionSetCorrectionByObsId;
  }

  private modeledAzimuth(rawAz: number, atStationId?: StationId, applyConvergence = true): number {
    let az = rawAz;
    if (applyConvergence && atStationId) {
      az += this.stationFactorSnapshot(atStationId).convergenceAngleRad;
    } else if (
      applyConvergence &&
      this.crsConvergenceEnabled &&
      Number.isFinite(this.crsConvergenceAngleRad) &&
      Math.abs(this.crsConvergenceAngleRad) > 0
    ) {
      az += this.crsConvergenceAngleRad;
    }
    az %= 2 * Math.PI;
    if (az < 0) az += 2 * Math.PI;
    return az;
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
    if (obs.type !== 'dist') return 1;
    if (this.mapMode === 'off') return 1;
    if (this.is2D) return this.mapScaleFactor;
    return obs.mode === 'horiz' ? this.mapScaleFactor : 1;
  }

  private crsDistanceScaleForObservation(obs: Observation): number {
    if (obs.type !== 'dist') return 1;
    if (this.coordSystemMode === 'local') {
      const legacyGridScale =
        this.crsGridScaleEnabled &&
        Number.isFinite(this.crsGridScaleFactor) &&
        this.crsGridScaleFactor > 0
          ? this.crsGridScaleFactor
          : 1;
      if (this.localDatumScheme === 'common-elevation') {
        const from = this.stations[obs.from];
        const to = this.stations[obs.to];
        if (!from || !to) return 1;
        const meanElevation =
          (this.stationEllipsoidHeight(from) + this.stationEllipsoidHeight(to)) / 2;
        const factor = (EARTH_RADIUS_M + this.commonElevation) / (EARTH_RADIUS_M + meanElevation);
        const localFactor = Number.isFinite(factor) && factor > 0 ? factor : 1;
        return localFactor * legacyGridScale;
      }
      return this.averageScaleFactor * legacyGridScale;
    }

    const fromF = this.stationFactorSnapshot(obs.from);
    const toF = this.stationFactorSnapshot(obs.to);
    const avgGridScale = (fromF.gridScaleFactor + toF.gridScaleFactor) / 2;
    const avgCombined = (fromF.combinedFactor + toF.combinedFactor) / 2;
    const distMode = obs.gridDistanceMode ?? 'measured';
    const distanceKind =
      obs.distanceKind ??
      (distMode === 'ellipsoidal' ? 'ellipsoidal' : distMode === 'grid' ? 'grid' : 'ground');
    if (distanceKind === 'grid') return 1;
    if (distanceKind === 'ellipsoidal') return avgGridScale;
    if (this.scaleOverrideActive) {
      this.addCoordSystemDiagnostic(
        'SCALE_OVERRIDE_USED',
        `.SCALE override active in GRID mode: measured distances use k=${this.averageScaleFactor.toFixed(8)} (combined factor replaced).`,
      );
      return this.averageScaleFactor;
    }
    return avgCombined;
  }

  private distanceScaleForObservation(obs: Observation): number {
    return this.mapDistanceScaleForObservation(obs) * this.crsDistanceScaleForObservation(obs);
  }

  private prismCorrectionForObservation(obs: Observation): number {
    if (obs.type !== 'dist' && obs.type !== 'zenith') return 0;

    const obsOffset = Number.isFinite(obs.prismCorrectionM ?? NaN)
      ? (obs.prismCorrectionM ?? 0)
      : undefined;
    if (obsOffset != null) {
      if (obs.prismScope === 'set') {
        const setId = typeof obs.setId === 'string' ? obs.setId.trim() : '';
        if (!setId) return 0;
      }
      return obsOffset;
    }

    if (
      !this.prismEnabled ||
      !Number.isFinite(this.prismOffset) ||
      Math.abs(this.prismOffset) <= 0
    ) {
      return 0;
    }
    if ((this.prismScope ?? 'global') === 'set') {
      const setId = typeof obs.setId === 'string' ? obs.setId.trim() : '';
      if (!setId) return 0;
    }
    return this.prismOffset;
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
    const mapScale = this.distanceScaleForObservation(obs);
    const prismCorrection = this.prismCorrectionForObservation(obs);
    if (
      this.coordSystemMode === 'grid' &&
      !this.is2D &&
      obs.mode === 'slope' &&
      Number.isFinite(mapScale) &&
      mapScale > 0
    ) {
      const geom = this.centeringLineGeometry(obs.from, obs.to, obs.hi ?? 0, obs.ht ?? 0);
      const groundHoriz = geom.horiz / mapScale;
      const calcDistance = Math.sqrt(groundHoriz * groundHoriz + geom.elev * geom.elev) + prismCorrection;
      const denom = Math.max(calcDistance - prismCorrection, 1e-12);
      return {
        calcDistance,
        mapScale,
        prismCorrection,
        horizontalDerivativeFactor: 1 / (mapScale * mapScale * denom),
        verticalDerivativeFactor: 1 / denom,
        useReducedSlopeDerivatives: true,
      };
    }
    return {
      calcDistance: (calcDistRaw + prismCorrection) * mapScale,
      mapScale,
      prismCorrection,
    };
  }

  private curvatureRefractionAngle(horiz: number): number {
    if (!this.applyCurvatureRefraction) return 0;
    if (this.verticalReduction !== 'curvref') return 0;
    if (!Number.isFinite(horiz) || horiz <= 0) return 0;
    return ((1 - 2 * this.refractionCoefficient) * horiz) / (2 * EARTH_RADIUS_M);
  }

  private zenithScaleForObservation(obs: Observation & { type: 'zenith' }): number {
    if (this.coordSystemMode === 'local') {
      const legacyGridScale =
        this.crsGridScaleEnabled &&
        Number.isFinite(this.crsGridScaleFactor) &&
        this.crsGridScaleFactor > 0
          ? this.crsGridScaleFactor
          : 1;
      if (this.localDatumScheme === 'common-elevation') {
        const from = this.stations[obs.from];
        const to = this.stations[obs.to];
        if (!from || !to) return 1;
        const meanElevation =
          (this.stationEllipsoidHeight(from) + this.stationEllipsoidHeight(to)) / 2;
        const factor = (EARTH_RADIUS_M + this.commonElevation) / (EARTH_RADIUS_M + meanElevation);
        const localFactor = Number.isFinite(factor) && factor > 0 ? factor : 1;
        return localFactor * legacyGridScale;
      }
      return this.averageScaleFactor * legacyGridScale;
    }
    const fromF = this.stationFactorSnapshot(obs.from);
    const toF = this.stationFactorSnapshot(obs.to);
    if (this.scaleOverrideActive) {
      return this.averageScaleFactor;
    }
    return (fromF.combinedFactor + toF.combinedFactor) / 2;
  }

  private getZenith(
    fromID: StationId,
    toID: StationId,
    hi = 0,
    ht = 0,
  ): { z: number; dist: number; horiz: number; dh: number; crCorr: number } {
    const cacheKey = `${fromID}|${toID}|${hi}|${ht}`;
    const cached = this.zenithCache.get(cacheKey);
    if (cached) return cached;
    const s1 = this.stations[fromID];
    const s2 = this.stations[toID];
    if (!s1 || !s2) return { z: 0, dist: 0, horiz: 0, dh: 0, crCorr: 0 };
    const dx = s2.x - s1.x;
    const dy = s2.y - s1.y;
    const dh = s2.h + ht - (s1.h + hi);
    const horiz = Math.sqrt(dx * dx + dy * dy);
    const dist = Math.sqrt(horiz * horiz + dh * dh);
    const zGeom = dist === 0 ? 0 : Math.acos(dh / dist);
    const crCorr = this.curvatureRefractionAngle(horiz);
    const z = Math.min(Math.PI, Math.max(0, zGeom + crCorr));
    const result = { z, dist, horiz, dh, crCorr };
    this.zenithCache.set(cacheKey, result);
    return result;
  }

  private getModeledZenith(
    obs: Observation & { type: 'zenith' },
  ): { z: number; dist: number; horiz: number; dh: number; crCorr: number; horizontalScale: number } {
    const raw = this.getZenith(obs.from, obs.to, obs.hi ?? 0, obs.ht ?? 0);
    const horizontalScale =
      this.coordSystemMode === 'grid' && !this.is2D ? this.zenithScaleForObservation(obs) : 1;
    if (!Number.isFinite(horizontalScale) || horizontalScale <= 0 || Math.abs(horizontalScale - 1) <= 1e-12) {
      return { ...raw, horizontalScale: 1 };
    }
    const horiz = raw.horiz / horizontalScale;
    const dist = Math.sqrt(horiz * horiz + raw.dh * raw.dh);
    const zGeom = dist === 0 ? 0 : Math.acos(raw.dh / dist);
    const crCorr = this.curvatureRefractionAngle(horiz);
    const z = Math.min(Math.PI, Math.max(0, zGeom + crCorr));
    return { z, dist, horiz, dh: raw.dh, crCorr, horizontalScale };
  }

  private effectiveDistanceForAngularObservation(obs: Observation): number | undefined {
    if (obs.type === 'angle') {
      const rayFrom = this.getAzimuth(obs.at, obs.from).dist;
      const rayTo = this.getAzimuth(obs.at, obs.to).dist;
      if (!Number.isFinite(rayFrom) || !Number.isFinite(rayTo) || rayFrom <= 0 || rayTo <= 0) {
        return undefined;
      }
      // Harmonic-mean baseline gives a stable single-length proxy for turned-angle sensitivity.
      const denom = 1 / rayFrom + 1 / rayTo;
      return denom > 0 ? 2 / denom : undefined;
    }
    if (obs.type === 'direction') {
      const dist = this.getAzimuth(obs.at, obs.to).dist;
      return Number.isFinite(dist) && dist > 0 ? dist : undefined;
    }
    if (obs.type === 'bearing' || obs.type === 'dir') {
      const dist = this.getAzimuth(obs.from, obs.to).dist;
      return Number.isFinite(dist) && dist > 0 ? dist : undefined;
    }
    if (obs.type === 'zenith') {
      const geom = this.getModeledZenith(obs).dist;
      return Number.isFinite(geom) && geom > 0 ? geom : undefined;
    }
    return undefined;
  }

  private isObservationActive(obs: Observation): boolean {
    return isObservationActiveForSolve(obs, this.excludeIds, this.is2D);
  }

  private computeSideshotResults(): AdjustmentResult['sideshots'] {
    const isSideshot = (obs: Observation): boolean =>
      typeof obs.calc === 'object' && (obs.calc as any)?.sideshot === true;
    const isGpsSideshot = (obs: Observation): obs is Observation & { type: 'gps' } =>
      obs.type === 'gps' && obs.gpsMode === 'sideshot';
    const verticalByKey = new Map<string, Observation>();
    this.observations.forEach((obs) => {
      if (!isSideshot(obs)) return;
      if ((obs.type !== 'lev' && obs.type !== 'zenith') || !('from' in obs) || !('to' in obs))
        return;
      const key = `${obs.from}|${obs.to}|${obs.sourceLine ?? -1}`;
      verticalByKey.set(key, obs);
    });

    const rows: NonNullable<AdjustmentResult['sideshots']> = [];
    this.observations.forEach((obs) => {
      if (!isSideshot(obs) || obs.type !== 'dist') return;
      const from = obs.from;
      const to = obs.to;
      const sourceLine = obs.sourceLine;
      const key = `${from}|${to}|${sourceLine ?? -1}`;
      const vertical = verticalByKey.get(key);
      const fromSt = this.stations[from];
      const toSt = this.stations[to];
      const calcMeta =
        typeof obs.calc === 'object' && (obs.calc as any)?.sideshot ? (obs.calc as any) : undefined;
      if (!fromSt) return;

      const mode = obs.mode ?? 'slope';
      const distSigma = this.effectiveStdDev(obs);
      let horizDistance = obs.obs;
      let sigmaHoriz = distSigma;
      let deltaH: number | undefined;
      let sigmaDh = 0;

      if (mode === 'slope') {
        const zen = vertical && vertical.type === 'zenith' ? vertical : undefined;
        if (zen) {
          const z = zen.obs;
          const sigmaZ = this.effectiveStdDev(zen);
          horizDistance = obs.obs * Math.sin(z);
          deltaH = obs.obs * Math.cos(z);
          sigmaHoriz = Math.sqrt(
            (Math.sin(z) * distSigma) ** 2 + (obs.obs * Math.cos(z) * sigmaZ) ** 2,
          );
          sigmaDh = Math.sqrt(
            (Math.cos(z) * distSigma) ** 2 + (obs.obs * Math.sin(z) * sigmaZ) ** 2,
          );
        }
      } else {
        horizDistance = obs.obs;
        sigmaHoriz = distSigma;
        const lev = vertical && vertical.type === 'lev' ? vertical : undefined;
        if (lev) {
          deltaH = lev.obs;
          sigmaDh = this.effectiveStdDev(lev);
        }
      }

      let horizScale = 1;
      if (this.mapMode !== 'off') {
        horizScale *= this.mapScaleFactor;
      }
      if (this.crsGridScaleEnabled) {
        horizScale *= this.crsGridScaleFactor;
      }
      if (horizScale !== 1) {
        horizDistance *= horizScale;
        sigmaHoriz *= Math.abs(horizScale);
      }

      const explicitAz = calcMeta?.azimuthObs;
      const explicitSigmaAz = calcMeta?.azimuthStdDev;
      const setupHz = calcMeta?.hzObs;
      const setupSigmaHz = calcMeta?.hzStdDev;
      const backsightId = calcMeta?.backsightId as StationId | undefined;
      const hasExplicitAz = Number.isFinite(explicitAz);
      const hasSetupHz = Number.isFinite(setupHz);
      const backsightSt = backsightId ? this.stations[backsightId] : undefined;
      const hasTargetAz = !!toSt;
      let setupAzimuth: number | undefined;
      if (hasSetupHz && backsightId && backsightSt) {
        const bs = this.getAzimuth(from, backsightId).az;
        setupAzimuth = this.modeledAzimuth(bs + (setupHz as number), from);
      }
      const hasAzimuth = hasExplicitAz || setupAzimuth != null || hasTargetAz;
      const azimuth = hasExplicitAz
        ? (explicitAz as number)
        : setupAzimuth != null
          ? setupAzimuth
          : hasTargetAz
            ? this.modeledAzimuth(this.getAzimuth(from, to).az, from)
            : undefined;
      let sigmaAz = hasExplicitAz ? (explicitSigmaAz ?? 0) : 0;
      if (!hasExplicitAz && setupAzimuth != null && backsightId && backsightSt) {
        const azBs = this.getAzimuth(from, backsightId);
        const d = Math.max(azBs.dist, 1e-12);
        const dAz_dE_To = Math.cos(azBs.az) / d;
        const dAz_dN_To = -Math.sin(azBs.az) / d;
        const dAz_dE_From = -dAz_dE_To;
        const dAz_dN_From = -dAz_dN_To;
        const sETo = backsightSt.sE ?? 0;
        const sNTo = backsightSt.sN ?? 0;
        const sEFrom = fromSt.sE ?? 0;
        const sNFrom = fromSt.sN ?? 0;
        const sigmaAzBs = Math.sqrt(
          (dAz_dE_To * sETo) ** 2 +
            (dAz_dN_To * sNTo) ** 2 +
            (dAz_dE_From * sEFrom) ** 2 +
            (dAz_dN_From * sNFrom) ** 2,
        );
        sigmaAz = Math.sqrt((setupSigmaHz ?? 0) ** 2 + sigmaAzBs ** 2);
      } else if (!hasExplicitAz && setupAzimuth == null && hasTargetAz && azimuth != null) {
        const az = this.getAzimuth(from, to);
        const d = Math.max(az.dist, 1e-12);
        const dAz_dE_To = Math.cos(az.az) / d;
        const dAz_dN_To = -Math.sin(az.az) / d;
        const dAz_dE_From = -dAz_dE_To;
        const dAz_dN_From = -dAz_dN_To;
        const sETo = toSt?.sE ?? 0;
        const sNTo = toSt?.sN ?? 0;
        const sEFrom = fromSt.sE ?? 0;
        const sNFrom = fromSt.sN ?? 0;
        sigmaAz = Math.sqrt(
          (dAz_dE_To * sETo) ** 2 +
            (dAz_dN_To * sNTo) ** 2 +
            (dAz_dE_From * sEFrom) ** 2 +
            (dAz_dN_From * sNFrom) ** 2,
        );
      }
      const easting =
        hasAzimuth && azimuth != null ? fromSt.x + horizDistance * Math.sin(azimuth) : undefined;
      const northing =
        hasAzimuth && azimuth != null ? fromSt.y + horizDistance * Math.cos(azimuth) : undefined;
      const height = deltaH != null ? fromSt.h + deltaH : undefined;

      const sigmaFromE = fromSt.sE ?? 0;
      const sigmaFromN = fromSt.sN ?? 0;
      const sigmaFromH = fromSt.sH ?? 0;
      const sigmaE =
        hasAzimuth && azimuth != null
          ? Math.sqrt(
              sigmaFromE * sigmaFromE +
                (Math.sin(azimuth) * sigmaHoriz) ** 2 +
                (horizDistance * Math.cos(azimuth) * sigmaAz) ** 2,
            )
          : undefined;
      const sigmaN =
        hasAzimuth && azimuth != null
          ? Math.sqrt(
              sigmaFromN * sigmaFromN +
                (Math.cos(azimuth) * sigmaHoriz) ** 2 +
                (horizDistance * Math.sin(azimuth) * sigmaAz) ** 2,
            )
          : undefined;
      const sigmaH =
        deltaH != null ? Math.sqrt(sigmaFromH * sigmaFromH + sigmaDh * sigmaDh) : undefined;

      const notes: string[] = [];
      if (hasSetupHz && !backsightSt) {
        notes.push('setup horizontal angle provided but backsight is unavailable');
      }
      if (!hasAzimuth)
        notes.push('target station has no approximate coordinates; azimuth unavailable');
      if (mode === 'slope' && (!vertical || vertical.type !== 'zenith')) {
        notes.push('no zenith with slope distance; used slope as horizontal proxy');
      }

      rows.push({
        id: `${from}->${to}@${sourceLine ?? rows.length + 1}`,
        sourceLine,
        from,
        to,
        mode,
        sourceType: 'SS',
        hasAzimuth,
        azimuth,
        azimuthSource: hasExplicitAz
          ? 'explicit'
          : setupAzimuth != null
            ? 'setup'
            : hasTargetAz
              ? 'target'
              : undefined,
        sigmaAz: hasAzimuth ? sigmaAz : undefined,
        distance: obs.obs,
        horizDistance,
        deltaH,
        easting,
        northing,
        height,
        sigmaE,
        sigmaN,
        sigmaH,
        note: notes.length ? notes.join('; ') : undefined,
      });
    });

    this.observations.forEach((obs) => {
      if (!isGpsSideshot(obs)) return;
      const from = obs.from;
      const to = obs.to;
      const sourceLine = obs.sourceLine;
      const fromSt = this.stations[from];
      const corrected = this.gpsObservedVector(obs);
      const dE = corrected.dE;
      const dN = corrected.dN;
      const horizDistance = Math.sqrt(dE * dE + dN * dN);
      const hasAzimuth = horizDistance > 0;
      let azimuth: number | undefined;
      if (hasAzimuth) {
        azimuth = Math.atan2(dE, dN);
        if (azimuth < 0) azimuth += 2 * Math.PI;
      }
      const easting = fromSt ? fromSt.x + dE : undefined;
      const northing = fromSt ? fromSt.y + dN : undefined;
      const cov = this.gpsCovariance(obs);
      const sigmaE =
        fromSt && Number.isFinite(cov.cEE) ? Math.sqrt((fromSt.sE ?? 0) ** 2 + cov.cEE) : undefined;
      const sigmaN =
        fromSt && Number.isFinite(cov.cNN) ? Math.sqrt((fromSt.sN ?? 0) ** 2 + cov.cNN) : undefined;
      const notes: string[] = [];
      if (!fromSt) notes.push('occupy station not solved; sideshot coordinate unavailable');
      const offset = this.gpsRoverOffsetVector(obs);
      if (offset.applied) {
        notes.push(
          `rover offset dE=${offset.dE.toFixed(4)}m dN=${offset.dN.toFixed(4)}m dH=${offset.dH.toFixed(4)}m`,
        );
      }

      rows.push({
        id: `${from}->${to}@${sourceLine ?? rows.length + 1}:GPS`,
        sourceLine,
        from,
        to,
        mode: 'gps',
        sourceType: 'G',
        hasAzimuth,
        azimuth,
        azimuthSource: hasAzimuth ? 'vector' : undefined,
        distance: horizDistance,
        horizDistance,
        easting,
        northing,
        sigmaE,
        sigmaN,
        note: notes.length ? notes.join('; ') : undefined,
      });
    });

    (this.parseState?.gpsTopoShots ?? []).forEach((shot, idx) => {
      const sourceLine = shot.sourceLine;
      const relationFrom = shot.fromId?.trim() ? shot.fromId : undefined;
      const from = relationFrom ?? shot.pointId;
      const to = shot.pointId;
      const fromSt = relationFrom ? this.stations[relationFrom] : undefined;
      const baseSigmaE = shot.sigmaE;
      const baseSigmaN = shot.sigmaN;
      const baseSigmaH = shot.sigmaH;
      let hasAzimuth = false;
      let azimuth: number | undefined;
      let horizDistance = 0;
      let distance = 0;
      let deltaH: number | undefined;
      const notes: string[] = [];
      if (fromSt) {
        const dE = shot.east - fromSt.x;
        const dN = shot.north - fromSt.y;
        horizDistance = Math.hypot(dE, dN);
        distance = horizDistance;
        if (horizDistance > 1e-12) {
          let az = Math.atan2(dE, dN);
          if (az < 0) az += 2 * Math.PI;
          azimuth = this.modeledAzimuth(az, relationFrom);
          hasAzimuth = true;
        }
        if (shot.height != null) deltaH = shot.height - fromSt.h;
      } else if (relationFrom) {
        notes.push(`FROM=${relationFrom} not solved; relation unavailable`);
      } else {
        notes.push('standalone coordinate shot');
      }

      const sigmaE =
        baseSigmaE != null
          ? Math.sqrt((fromSt?.sE ?? 0) ** 2 + baseSigmaE ** 2)
          : fromSt
            ? fromSt.sE
            : undefined;
      const sigmaN =
        baseSigmaN != null
          ? Math.sqrt((fromSt?.sN ?? 0) ** 2 + baseSigmaN ** 2)
          : fromSt
            ? fromSt.sN
            : undefined;
      const sigmaH =
        shot.height != null
          ? baseSigmaH != null
            ? Math.sqrt((fromSt?.sH ?? 0) ** 2 + baseSigmaH ** 2)
            : fromSt
              ? fromSt.sH
              : undefined
          : undefined;

      rows.push({
        id: `${from}->${to}@${sourceLine ?? rows.length + idx + 1}:GS`,
        sourceLine,
        from,
        to,
        mode: 'gps',
        sourceType: 'GS',
        relationFrom,
        hasAzimuth,
        azimuth,
        azimuthSource: hasAzimuth ? 'coordinate' : undefined,
        distance,
        horizDistance,
        deltaH,
        easting: shot.east,
        northing: shot.north,
        height: shot.height,
        sigmaE,
        sigmaN,
        sigmaH,
        note: notes.length ? notes.join('; ') : undefined,
      });
    });

    return rows.sort((a, b) => {
      const la = a.sourceLine ?? Number.MAX_SAFE_INTEGER;
      const lb = b.sourceLine ?? Number.MAX_SAFE_INTEGER;
      if (la !== lb) return la - lb;
      return a.id.localeCompare(b.id);
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

  private runDataCheckOnly(activeObservations: Observation[]): AdjustmentResult {
    this.runMode = 'data-check';
    this.iterations = 0;
    this.dof = 0;
    this.seuw = 0;
    this.converged = true;
    this.log(
      'Data Check Only mode: reporting approximate-geometry differences from observations (no least-squares adjustment).',
    );

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
        const calc = this.getAzimuth(obs.at, obs.to).az;
        const residual = ((obs.obs - calc + Math.PI) % (2 * Math.PI)) - Math.PI;
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
    const runModeCompatibilityLines = this.runModeCompatibilityDiagnosticLines(runModeDiagnostics);
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

  solve(): AdjustmentResult {
    this.solveStartedAt = Date.now();
    this.resetSolveTiming();
    this.emitSolveProgress('start');
    const requestedRunMode: RunMode =
      this.parseOptions?.runMode ??
      (this.parseOptions?.preanalysisMode ? 'preanalysis' : 'adjustment');
    const runModeCompatibility = this.resolveRunModeCompatibilityOptions(
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
        (o) =>
          (o.type === 'lev' || o.type === 'zenith') &&
          !(typeof o.calc === 'object' && (o.calc as any)?.sideshot),
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
      (o) => (o as any).setId && String((o as any).setId).toUpperCase() === 'TE',
    );
    const coordClosureVectors: { from: StationId; to: StationId; dE: number; dN: number }[] = [];
    let totalTraverseDistance = 0;
    const directionStats = new Map<
      string,
      {
        count: number;
        rawCount: number;
        reducedCount: number;
        face1Count: number;
        face2Count: number;
        pairedTargets: number;
        sum: number;
        sumSq: number;
        maxAbs: number;
        pairDeltaCount: number;
        pairDeltaSum: number;
        pairDeltaMax: number;
        rawMaxResidualCount: number;
        rawMaxResidualSum: number;
        rawMaxResidualMax: number;
        targetIds: Set<StationId>;
        occupy: StationId;
        orientation: number;
      }
    >();
    const activeObservations = activeObservationsInput ?? this.collectActiveObservations();
    const constraints = buildCoordinateConstraints(this.stations, paramIndex, this.is2D);
    const tsCorrelationRows = new Map<
      string,
      {
        station: StationId;
        setId?: string;
        rows: Array<{ v: number; sigma: number; groupLabel: string }>;
      }
    >();
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
        const setTag = String((obs as any).setId ?? '').toUpperCase();
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
        const dir = obs as any;
        const az = this.modeledAzimuth(
          this.getAzimuth(dir.at, dir.to).az,
          dir.at,
          dir.gridObsMode !== 'grid',
        );
        const orientation = this.directionOrientations[dir.setId] ?? 0;
        let calc = orientation + az;
        calc %= 2 * Math.PI;
        if (calc < 0) calc += 2 * Math.PI;
        let v = dir.obs - calc;
        if (v > Math.PI) v -= 2 * Math.PI;
        if (v < -Math.PI) v += 2 * Math.PI;
        dir.calc = calc;
        dir.residual = v;
        const sigma = this.effectiveStdDev(dir);
        dir.stdRes = Math.abs(v) / sigma;
        const q = (v * v) / (sigma * sigma);
        vtpv += q;
        addObservationContribution(dir, q);
        collectTsCorrelationRow(dir, v, sigma);

        const setId = String(dir.setId ?? 'unknown');
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
          occupy: dir.at,
          orientation,
        };
        const arcsec = v * RAD_TO_DEG * 3600;
        const rawCount = typeof dir.rawCount === 'number' && dir.rawCount > 0 ? dir.rawCount : 1;
        const face1Count =
          typeof dir.rawFace1Count === 'number'
            ? dir.rawFace1Count
            : dir.obs >= Math.PI
              ? 0
              : rawCount;
        const face2Count =
          typeof dir.rawFace2Count === 'number'
            ? dir.rawFace2Count
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
          typeof dir.facePairDelta === 'number'
            ? Math.abs(dir.facePairDelta) * RAD_TO_DEG * 3600
            : undefined;
        if (pairDeltaArcSec != null && Number.isFinite(pairDeltaArcSec)) {
          stat.pairDeltaCount += 1;
          stat.pairDeltaSum += pairDeltaArcSec;
          stat.pairDeltaMax = Math.max(stat.pairDeltaMax, pairDeltaArcSec);
        }
        const rawMaxResidualArcSec =
          typeof dir.rawMaxResidual === 'number'
            ? Math.abs(dir.rawMaxResidual) * RAD_TO_DEG * 3600
            : undefined;
        if (rawMaxResidualArcSec != null && Number.isFinite(rawMaxResidualArcSec)) {
          stat.rawMaxResidualCount += 1;
          stat.rawMaxResidualSum += rawMaxResidualArcSec;
          stat.rawMaxResidualMax = Math.max(stat.rawMaxResidualMax, rawMaxResidualArcSec);
        }
        if (typeof dir.to === 'string' && dir.to.trim().length > 0) {
          stat.targetIds.add(dir.to);
        }
        stat.occupy = dir.at ?? stat.occupy;
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

    if (this.tsCorrelationEnabled && this.tsCorrelationRho > 0) {
      const rho = Math.min(0.95, Math.max(0, this.tsCorrelationRho));
      let equationCount = 0;
      let pairCountTotal = 0;
      let maxGroupSize = 0;
      let offDiagAbsSumTotal = 0;
      const groups: NonNullable<AdjustmentResult['tsCorrelationDiagnostics']>['groups'] = [];
      tsCorrelationRows.forEach((entry, key) => {
        const n = entry.rows.length;
        equationCount += n;
        maxGroupSize = Math.max(maxGroupSize, n);
        if (n < 2) {
          groups.push({
            key,
            station: entry.station,
            setId: entry.setId,
            rows: n,
            pairCount: 0,
          });
          return;
        }
        const denom = (1 - rho) * (1 - rho + n * rho);
        if (!Number.isFinite(denom) || denom <= 1e-24) return;
        const a = 1 / (1 - rho);
        const b = rho / denom;
        let pairCount = 0;
        let offDiagAbsSum = 0;

        entry.rows.forEach((row) => {
          const baseDiag = 1 / (row.sigma * row.sigma);
          const corrDiag = (a - b) / (row.sigma * row.sigma);
          const delta = (corrDiag - baseDiag) * row.v * row.v;
          vtpv += delta;
          addGroupContribution(row.groupLabel, delta);
        });
        for (let i = 0; i < n; i += 1) {
          const ri = entry.rows[i];
          for (let j = i + 1; j < n; j += 1) {
            const rj = entry.rows[j];
            const w = -b / (ri.sigma * rj.sigma);
            const contribution = 2 * w * ri.v * rj.v;
            vtpv += contribution;
            if (ri.groupLabel === rj.groupLabel) {
              addGroupContribution(ri.groupLabel, contribution);
            } else {
              addGroupContribution(ri.groupLabel, contribution * 0.5);
              addGroupContribution(rj.groupLabel, contribution * 0.5);
            }
            pairCount += 1;
            offDiagAbsSum += Math.abs(w);
          }
        }

        pairCountTotal += pairCount;
        offDiagAbsSumTotal += offDiagAbsSum;
        groups.push({
          key,
          station: entry.station,
          setId: entry.setId,
          rows: n,
          pairCount,
          meanAbsOffDiagWeight: pairCount > 0 ? offDiagAbsSum / pairCount : undefined,
        });
      });
      this.tsCorrelationDiagnostics = {
        enabled: true,
        rho,
        scope: this.tsCorrelationScope ?? 'set',
        groupCount: tsCorrelationRows.size,
        equationCount,
        pairCount: pairCountTotal,
        maxGroupSize,
        meanAbsOffDiagWeight: pairCountTotal > 0 ? offDiagAbsSumTotal / pairCountTotal : undefined,
        groups: groups.sort((a, b) => {
          if (b.rows !== a.rows) return b.rows - a.rows;
          if (b.pairCount !== a.pairCount) return b.pairCount - a.pairCount;
          return a.key.localeCompare(b.key);
        }),
      };
      this.log(
        `TS correlation diagnostics: groups=${this.tsCorrelationDiagnostics.groupCount}, eq=${this.tsCorrelationDiagnostics.equationCount}, pairs=${this.tsCorrelationDiagnostics.pairCount}, maxGroup=${this.tsCorrelationDiagnostics.maxGroupSize}, mean|offdiagW|=${this.tsCorrelationDiagnostics.meanAbsOffDiagWeight != null ? this.tsCorrelationDiagnostics.meanAbsOffDiagWeight.toExponential(3) : '-'}`,
      );
    } else {
      this.tsCorrelationDiagnostics = {
        enabled: false,
        rho: 0,
        scope: this.tsCorrelationScope ?? 'set',
        groupCount: 0,
        equationCount: 0,
        pairCount: 0,
        maxGroupSize: 0,
        groups: [],
      };
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
            .map((o) => (o as any).setId as string),
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
        const A = zeros(numObsEquations, numParams);
        const P = zeros(numObsEquations, numObsEquations);
        const L = zeros(numObsEquations, 1);
        const rowInfo: EquationRowInfo[] = [];
        let row = 0;

        activeObservations.forEach((obs) => {
          if (obs.type === 'dist') {
            const s1 = this.stations[obs.from];
            const s2 = this.stations[obs.to];
            if (!s1 || !s2) return;
            const dx = s2.x - s1.x;
            const dy = s2.y - s1.y;
            const dz = s2.h + (obs.ht ?? 0) - (s1.h + (obs.hi ?? 0));
            const horiz = Math.sqrt(dx * dx + dy * dy);
            const calcDistRaw = this.is2D
              ? horiz
              : obs.mode === 'slope'
                ? Math.sqrt(horiz * horiz + dz * dz)
                : horiz;
            const corrected = this.correctedDistanceModel(obs, calcDistRaw);
            const calcDist = corrected.calcDistance;
            const v = obs.obs - calcDist;
            L[row][0] = v;
            rowInfo.push({ obs });

            const denom = calcDistRaw || 1;
            const dD_dE2 = corrected.useReducedSlopeDerivatives
              ? dx * (corrected.horizontalDerivativeFactor ?? 0)
              : (dx / denom) * corrected.mapScale;
            const dD_dN2 = corrected.useReducedSlopeDerivatives
              ? dy * (corrected.horizontalDerivativeFactor ?? 0)
              : (dy / denom) * corrected.mapScale;
            const dD_dH2 =
              !this.is2D && obs.mode === 'slope'
                ? corrected.useReducedSlopeDerivatives
                  ? dz * (corrected.verticalDerivativeFactor ?? 0)
                  : (dz / denom) * corrected.mapScale
                : 0;

            const fromIdx = this.paramIndex[obs.from];
            if (fromIdx?.x != null) A[row][fromIdx.x] = -dD_dE2;
            if (fromIdx?.y != null) A[row][fromIdx.y] = -dD_dN2;
            if (!this.is2D && fromIdx?.h != null) A[row][fromIdx.h] = -dD_dH2;
            const toIdx = this.paramIndex[obs.to];
            if (toIdx?.x != null) A[row][toIdx.x] = dD_dE2;
            if (toIdx?.y != null) A[row][toIdx.y] = dD_dN2;
            if (!this.is2D && toIdx?.h != null) A[row][toIdx.h] = dD_dH2;

            const sigma = this.effectiveStdDev(obs);
            P[row][row] = 1.0 / (sigma * sigma);
            row += 1;
            return;
          }

          if (obs.type === 'angle') {
            const azTo = this.getAzimuth(obs.at, obs.to);
            const azFrom = this.getAzimuth(obs.at, obs.from);
            let calcAngle = azTo.az - azFrom.az;
            if (obs.gridObsMode !== 'grid') {
              calcAngle += this.measuredAngleCorrection(obs.at, obs.from, obs.to);
            }
            if (calcAngle < 0) calcAngle += 2 * Math.PI;
            let diff = obs.obs - calcAngle;
            diff = this.wrapToPi(diff);
            L[row][0] = diff;
            rowInfo.push({ obs });

            const dAzTo_dE_To = Math.cos(azTo.az) / (azTo.dist || 1);
            const dAzTo_dN_To = -Math.sin(azTo.az) / (azTo.dist || 1);
            const dAzFrom_dE_From = Math.cos(azFrom.az) / (azFrom.dist || 1);
            const dAzFrom_dN_From = -Math.sin(azFrom.az) / (azFrom.dist || 1);

            const toIdx = this.paramIndex[obs.to];
            if (toIdx?.x != null) A[row][toIdx.x] = dAzTo_dE_To;
            if (toIdx?.y != null) A[row][toIdx.y] = dAzTo_dN_To;
            const fromIdx = this.paramIndex[obs.from];
            if (fromIdx?.x != null) A[row][fromIdx.x] = -dAzFrom_dE_From;
            if (fromIdx?.y != null) A[row][fromIdx.y] = -dAzFrom_dN_From;
            const atIdx = this.paramIndex[obs.at];
            if (atIdx?.x != null || atIdx?.y != null) {
              const dAzTo_dE_At = -dAzTo_dE_To;
              const dAzTo_dN_At = -dAzTo_dN_To;
              const dAzFrom_dE_At = -dAzFrom_dE_From;
              const dAzFrom_dN_At = -dAzFrom_dN_From;
              if (atIdx?.x != null) A[row][atIdx.x] = dAzTo_dE_At - dAzFrom_dE_At;
              if (atIdx?.y != null) A[row][atIdx.y] = dAzTo_dN_At - dAzFrom_dN_At;
            }

            const sigma = this.effectiveStdDev(obs);
            P[row][row] = 1.0 / (sigma * sigma);
            row += 1;
            return;
          }

          if (obs.type === 'gps') {
            const s1 = this.stations[obs.from];
            const s2 = this.stations[obs.to];
            if (!s1 || !s2) return;
            const corrected = this.gpsObservedVector(obs);
            const calc_dE = s2.x - s1.x;
            const calc_dN = s2.y - s1.y;
            const calc_dU = !this.is2D ? s2.h - s1.h : undefined;
            const vE = corrected.dE - calc_dE;
            const vN = corrected.dN - calc_dN;
            L[row][0] = vE;
            rowInfo.push({ obs, component: 'E' });
            const fromIdx = this.paramIndex[obs.from];
            const toIdx = this.paramIndex[obs.to];
            if (fromIdx?.x != null) A[row][fromIdx.x] = -1.0;
            if (toIdx?.x != null) A[row][toIdx.x] = 1.0;
            const w = this.gpsWeight(obs);
            P[row][row] = w.wEE;
            P[row][row + 1] = w.wEN;
            P[row + 1][row] = w.wEN;
            P[row + 1][row + 1] = w.wNN;

            L[row + 1][0] = vN;
            rowInfo.push({ obs, component: 'N' });
            if (fromIdx?.y != null) A[row + 1][fromIdx.y] = -1.0;
            if (toIdx?.y != null) A[row + 1][toIdx.y] = 1.0;

            if (
              !this.is2D &&
              Number.isFinite(corrected.dU ?? Number.NaN) &&
              Number.isFinite(calc_dU ?? Number.NaN)
            ) {
              L[row + 2][0] = (corrected.dU as number) - (calc_dU as number);
              rowInfo.push({ obs, component: 'U' });
              if (fromIdx?.h != null) A[row + 2][fromIdx.h] = -1.0;
              if (toIdx?.h != null) A[row + 2][toIdx.h] = 1.0;
              P[row][row + 2] = w.wEU ?? 0;
              P[row + 2][row] = w.wEU ?? 0;
              P[row + 1][row + 2] = w.wNU ?? 0;
              P[row + 2][row + 1] = w.wNU ?? 0;
              P[row + 2][row + 2] = w.wUU ?? 0;
              row += 3;
              return;
            }

            row += 2;
            return;
          }

          if (obs.type === 'lev') {
            const s1 = this.stations[obs.from];
            const s2 = this.stations[obs.to];
            if (!s1 || !s2) return;
            const calc_dH = s2.h - s1.h;
            const v = obs.obs - calc_dH;
            L[row][0] = v;
            rowInfo.push({ obs });
            const fromIdx = this.paramIndex[obs.from];
            const toIdx = this.paramIndex[obs.to];
            if (fromIdx?.h != null) A[row][fromIdx.h] = -1.0;
            if (toIdx?.h != null) A[row][toIdx.h] = 1.0;
            const sigma = this.effectiveStdDev(obs);
            P[row][row] = 1.0 / (sigma * sigma);
            row += 1;
            return;
          }

          if (obs.type === 'bearing') {
            const az = this.getAzimuth(obs.from, obs.to);
            const calc = this.modeledAzimuth(az.az, obs.from, obs.gridObsMode !== 'grid');
            let v = obs.obs - calc;
            if (v > Math.PI) v -= 2 * Math.PI;
            if (v < -Math.PI) v += 2 * Math.PI;
            L[row][0] = v;
            rowInfo.push({ obs });

            const dAz_dE_To = Math.cos(az.az) / (az.dist || 1);
            const dAz_dN_To = -Math.sin(az.az) / (az.dist || 1);
            const toIdx = this.paramIndex[obs.to];
            const fromIdx = this.paramIndex[obs.from];
            if (toIdx?.x != null) A[row][toIdx.x] = dAz_dE_To;
            if (toIdx?.y != null) A[row][toIdx.y] = dAz_dN_To;
            if (fromIdx?.x != null) A[row][fromIdx.x] = -dAz_dE_To;
            if (fromIdx?.y != null) A[row][fromIdx.y] = -dAz_dN_To;

            const sigma = this.effectiveStdDev(obs);
            P[row][row] = 1.0 / (sigma * sigma);
            row += 1;
            return;
          }

          if (obs.type === 'dir') {
            const az = this.getAzimuth(obs.from, obs.to);
            const calc = this.modeledAzimuth(az.az, obs.from, obs.gridObsMode !== 'grid');
            let v0 = obs.obs - calc;
            if (v0 > Math.PI) v0 -= 2 * Math.PI;
            if (v0 < -Math.PI) v0 += 2 * Math.PI;
            let v = v0;
            if (obs.flip180) {
              let v1 = obs.obs + Math.PI - calc;
              if (v1 > Math.PI) v1 -= 2 * Math.PI;
              if (v1 < -Math.PI) v1 += 2 * Math.PI;
              if (Math.abs(v1) < Math.abs(v0)) v = v1;
            }
            L[row][0] = v;
            rowInfo.push({ obs });

            const dAz_dE_To = Math.cos(az.az) / (az.dist || 1);
            const dAz_dN_To = -Math.sin(az.az) / (az.dist || 1);
            const toIdx = this.paramIndex[obs.to];
            const fromIdx = this.paramIndex[obs.from];
            if (toIdx?.x != null) A[row][toIdx.x] = dAz_dE_To;
            if (toIdx?.y != null) A[row][toIdx.y] = dAz_dN_To;
            if (fromIdx?.x != null) A[row][fromIdx.x] = -dAz_dE_To;
            if (fromIdx?.y != null) A[row][fromIdx.y] = -dAz_dN_To;

            const sigma = this.effectiveStdDev(obs);
            P[row][row] = 1.0 / (sigma * sigma);
            row += 1;
            return;
          }

          if (obs.type === 'direction') {
            const dir = obs as any;
            const az = this.getAzimuth(dir.at, dir.to);
            const orientation = this.directionOrientations[dir.setId] ?? 0;
            let calc = orientation + this.modeledAzimuth(az.az, dir.at, dir.gridObsMode !== 'grid');
            calc %= 2 * Math.PI;
            if (calc < 0) calc += 2 * Math.PI;
            let v = dir.obs - calc;
            if (v > Math.PI) v -= 2 * Math.PI;
            if (v < -Math.PI) v += 2 * Math.PI;
            L[row][0] = v;
            rowInfo.push({ obs });

            const dAz_dE_To = Math.cos(az.az) / (az.dist || 1);
            const dAz_dN_To = -Math.sin(az.az) / (az.dist || 1);
            const toIdx = this.paramIndex[dir.to];
            const atIdx = this.paramIndex[dir.at];
            if (toIdx?.x != null) A[row][toIdx.x] = dAz_dE_To;
            if (toIdx?.y != null) A[row][toIdx.y] = dAz_dN_To;
            if (atIdx?.x != null) A[row][atIdx.x] = -dAz_dE_To;
            if (atIdx?.y != null) A[row][atIdx.y] = -dAz_dN_To;

            const dirIdx = dirParamMap[dir.setId];
            if (dirIdx != null) A[row][dirIdx] = 1;

            const sigma = this.effectiveStdDev(dir);
            P[row][row] = 1.0 / (sigma * sigma);
            row += 1;
            return;
          }

          if (obs.type === 'zenith') {
            const zv = this.getModeledZenith(obs);
            const calc = zv.z;
            let v = obs.obs - calc;
            if (v > Math.PI) v -= 2 * Math.PI;
            if (v < -Math.PI) v += 2 * Math.PI;
            L[row][0] = v;
            rowInfo.push({ obs });

            const denom = Math.sqrt(
              Math.max(1 - (zv.dist === 0 ? 0 : (zv.dh / zv.dist) ** 2), 1e-12),
            );
            const common = zv.dist === 0 ? 0 : 1 / (zv.dist * zv.dist * zv.dist * denom);
            const horizontalScale = zv.horizontalScale ?? 1;
            const dx = this.stations[obs.to].x - this.stations[obs.from].x;
            const dy = this.stations[obs.to].y - this.stations[obs.from].y;
            const dZ_dEGeom = zv.dh * dx * common / (horizontalScale * horizontalScale);
            const dZ_dNGeom = zv.dh * dy * common / (horizontalScale * horizontalScale);
            const dC_dHoriz = this.curvatureRefractionAngle(1);
            const dHoriz_dE =
              zv.horiz > 0 ? dx / (zv.horiz * horizontalScale * horizontalScale) : 0;
            const dHoriz_dN =
              zv.horiz > 0 ? dy / (zv.horiz * horizontalScale * horizontalScale) : 0;
            const dZ_dE = dZ_dEGeom + dC_dHoriz * dHoriz_dE;
            const dZ_dN = dZ_dNGeom + dC_dHoriz * dHoriz_dN;
            const dZ_dH = -(zv.horiz * zv.horiz) * common;

            const toIdx = this.paramIndex[obs.to];
            const fromIdx = this.paramIndex[obs.from];
            if (toIdx?.x != null) A[row][toIdx.x] = dZ_dE;
            if (toIdx?.y != null) A[row][toIdx.y] = dZ_dN;
            if (toIdx?.h != null) A[row][toIdx.h] = dZ_dH;
            if (fromIdx?.x != null) A[row][fromIdx.x] = -dZ_dE;
            if (fromIdx?.y != null) A[row][fromIdx.y] = -dZ_dN;
            if (fromIdx?.h != null) A[row][fromIdx.h] = -dZ_dH;

            const sigma = this.effectiveStdDev(obs);
            P[row][row] = 1.0 / (sigma * sigma);
            row += 1;
          }
        });

        const constraintPlacements: CoordinateConstraintRowPlacement[] = [];
        constraints.forEach((constraint) => {
          const st = this.stations[constraint.stationId];
          if (!st) return;
          const current =
            constraint.component === 'x' ? st.x : constraint.component === 'y' ? st.y : st.h;
          L[row][0] = constraint.target - current;
          A[row][constraint.index] = 1;
          P[row][row] = 1.0 / (constraint.sigma * constraint.sigma);
          rowInfo.push(null);
          constraintPlacements.push({ row, constraint });
          row += 1;
        });
        applyCoordinateConstraintCorrelationWeights(P, constraintPlacements);

        this.applyTsCorrelationToWeightMatrix(P, rowInfo, true);
        if (!this.preanalysisMode && this.robustMode === 'huber') {
          const baseWeights = this.captureRobustWeightBase(P, rowInfo);
          const residuals = L.map((row) => -row[0]);
          const summary = this.computeRobustWeightSummary(residuals, rowInfo);
          this.applyRobustWeightFactors(P, baseWeights, summary.factors);
        }

        if (!this.preanalysisMode) {
          try {
            const sparseRows = denseRowsToSparseRows(A);
            const { normal: N } = accumulateNormalEquationsFromSparseRows(
              sparseRows,
              zeros(A.length, 1),
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
                  return this.transformSymmetricCovariance3(displayTransform, covariance);
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

    if (directionStats.size > 0) {
      const summaries = Array.from(directionStats.entries()).sort((a, b) =>
        a[0].localeCompare(b[0]),
      );
      this.directionSetDiagnostics = summaries.map(([setId, stat]) => {
        const mean = stat.sum / Math.max(stat.count, 1);
        const rms = Math.sqrt(stat.sumSq / Math.max(stat.count, 1));
        const orientDeg = (((stat.orientation * RAD_TO_DEG) % 360) + 360) % 360;
        const orientationSeArcSec = stat.count > 0 ? rms / Math.sqrt(stat.count) : undefined;
        const targetCount = stat.targetIds.size;
        const readingCount = stat.rawCount;
        const underconstrainedOrientation = stat.count < 2 || targetCount < 2;
        return {
          setId,
          occupy: stat.occupy,
          readingCount,
          targetCount,
          rawCount: stat.rawCount,
          reducedCount: stat.reducedCount,
          face1Count: stat.face1Count,
          face2Count: stat.face2Count,
          pairedTargets: stat.pairedTargets,
          underconstrainedOrientation,
          orientationDeg: orientDeg,
          residualMeanArcSec: mean,
          residualRmsArcSec: rms,
          residualMaxArcSec: stat.maxAbs,
          orientationSeArcSec,
          meanFacePairDeltaArcSec:
            stat.pairDeltaCount > 0 ? stat.pairDeltaSum / stat.pairDeltaCount : undefined,
          maxFacePairDeltaArcSec: stat.pairDeltaCount > 0 ? stat.pairDeltaMax : undefined,
          meanRawMaxResidualArcSec:
            stat.rawMaxResidualCount > 0
              ? stat.rawMaxResidualSum / stat.rawMaxResidualCount
              : undefined,
          maxRawMaxResidualArcSec:
            stat.rawMaxResidualCount > 0 ? stat.rawMaxResidualMax : undefined,
        };
      });

      this.logs.push('Direction set summary (arcsec residuals):');
      this.directionSetDiagnostics.forEach((stat) => {
        this.logs.push(
          `  ${stat.setId} @ ${stat.occupy}: readings=${stat.readingCount}, targets=${stat.targetCount}, under=${stat.underconstrainedOrientation ? 'YES' : 'NO'}, raw=${stat.rawCount}, reduced=${stat.reducedCount}, pairs=${stat.pairedTargets}, F1=${stat.face1Count}, F2=${stat.face2Count}, mean=${(stat.residualMeanArcSec ?? 0).toFixed(2)}", rms=${(stat.residualRmsArcSec ?? 0).toFixed(2)}", max=${(stat.residualMaxArcSec ?? 0).toFixed(2)}", pairDeltaMax=${(stat.maxFacePairDeltaArcSec ?? 0).toFixed(2)}", rawMax=${(stat.maxRawMaxResidualArcSec ?? 0).toFixed(2)}", orient=${(stat.orientationDeg ?? 0).toFixed(4)}°, orientSE=${(stat.orientationSeArcSec ?? 0).toFixed(2)}"`,
        );
      });
    }

    {
      const directionTargets = activeObservations
        .filter((obs): obs is DirectionObservation => obs.type === 'direction')
        .map((dir) => {
          const rawCount = typeof dir.rawCount === 'number' && dir.rawCount > 0 ? dir.rawCount : 1;
          const face1Count =
            typeof dir.rawFace1Count === 'number'
              ? dir.rawFace1Count
              : dir.obs >= Math.PI
                ? 0
                : rawCount;
          const face2Count =
            typeof dir.rawFace2Count === 'number'
              ? dir.rawFace2Count
              : Math.max(0, rawCount - face1Count);
          const faceBalanced = rawCount <= 1 ? true : Math.abs(face1Count - face2Count) <= 1;
          const rawSpreadArcSec =
            typeof dir.rawSpread === 'number'
              ? Math.abs(dir.rawSpread) * RAD_TO_DEG * 3600
              : undefined;
          const rawMaxResidualArcSec =
            typeof dir.rawMaxResidual === 'number'
              ? Math.abs(dir.rawMaxResidual) * RAD_TO_DEG * 3600
              : undefined;
          const facePairDeltaArcSec =
            typeof dir.facePairDelta === 'number'
              ? Math.abs(dir.facePairDelta) * RAD_TO_DEG * 3600
              : undefined;
          const face1SpreadArcSec =
            typeof dir.face1Spread === 'number'
              ? Math.abs(dir.face1Spread) * RAD_TO_DEG * 3600
              : undefined;
          const face2SpreadArcSec =
            typeof dir.face2Spread === 'number'
              ? Math.abs(dir.face2Spread) * RAD_TO_DEG * 3600
              : undefined;
          const reducedSigmaArcSec =
            typeof dir.reducedSigma === 'number'
              ? Math.abs(dir.reducedSigma) * RAD_TO_DEG * 3600
              : Math.abs(dir.stdDev) * RAD_TO_DEG * 3600;
          const residualArcSec =
            typeof dir.residual === 'number' ? dir.residual * RAD_TO_DEG * 3600 : undefined;
          const stdResAbs = Number.isFinite(dir.stdRes) ? Math.abs(dir.stdRes ?? 0) : undefined;
          const localPass = dir.localTest?.pass;
          const mdbArcSec = dir.mdb != null ? dir.mdb * RAD_TO_DEG * 3600 : undefined;

          let suspectScore = 0;
          if (localPass === false) suspectScore += 100;
          suspectScore += (stdResAbs ?? 0) * 10;
          suspectScore += Math.min((rawSpreadArcSec ?? 0) / 2, 50);
          suspectScore += Math.min((rawMaxResidualArcSec ?? 0) / 2, 50);
          suspectScore += Math.min((facePairDeltaArcSec ?? 0) / 2, 40);
          suspectScore += Math.min(
            Math.max(face1SpreadArcSec ?? 0, face2SpreadArcSec ?? 0) / 2,
            35,
          );
          if (!faceBalanced) suspectScore += 8;
          if (rawCount < 2) suspectScore += 4;

          return {
            setId: String(dir.setId ?? ''),
            occupy: dir.at,
            target: dir.to,
            sourceLine: dir.sourceLine,
            rawCount,
            face1Count,
            face2Count,
            faceBalanced,
            rawSpreadArcSec,
            rawMaxResidualArcSec,
            facePairDeltaArcSec,
            face1SpreadArcSec,
            face2SpreadArcSec,
            reducedSigmaArcSec,
            residualArcSec,
            stdRes: stdResAbs,
            localPass,
            mdbArcSec,
            suspectScore,
          };
        })
        .sort((a, b) => {
          if (b.suspectScore !== a.suspectScore) return b.suspectScore - a.suspectScore;
          const bStd = b.stdRes ?? 0;
          const aStd = a.stdRes ?? 0;
          if (bStd !== aStd) return bStd - aStd;
          const bSpread = b.rawSpreadArcSec ?? 0;
          const aSpread = a.rawSpreadArcSec ?? 0;
          if (bSpread !== aSpread) return bSpread - aSpread;
          const bRawMax = b.rawMaxResidualArcSec ?? 0;
          const aRawMax = a.rawMaxResidualArcSec ?? 0;
          if (bRawMax !== aRawMax) return bRawMax - aRawMax;
          const setCmp = a.setId.localeCompare(b.setId);
          if (setCmp !== 0) return setCmp;
          return a.target.localeCompare(b.target);
        });

      if (directionTargets.length > 0) {
        this.directionTargetDiagnostics = directionTargets;
        this.logs.push('Direction target repeatability (top suspects):');
        directionTargets.slice(0, 8).forEach((d) => {
          this.logs.push(
            `  ${d.setId} ${d.occupy}->${d.target}: raw=${d.rawCount}, F1=${d.face1Count}, F2=${d.face2Count}, spread=${d.rawSpreadArcSec != null ? `${d.rawSpreadArcSec.toFixed(2)}"` : '-'}, stdRes=${d.stdRes != null ? d.stdRes.toFixed(2) : '-'}, local=${d.localPass == null ? '-' : d.localPass ? 'PASS' : 'FAIL'}, score=${d.suspectScore.toFixed(1)}`,
          );
        });

        const repeatMap = new Map<
          string,
          {
            occupy: StationId;
            target: StationId;
            setCount: number;
            localFailCount: number;
            faceUnbalancedSets: number;
            resCount: number;
            resSum: number;
            resSumSq: number;
            resMin: number;
            resMax: number;
            resMaxAbs: number;
            stdCount: number;
            stdSumSq: number;
            maxStdRes: number;
            spreadCount: number;
            spreadSum: number;
            maxSpread: number;
            worstSetId?: string;
            worstLine?: number;
            worstMetric: number;
          }
        >();
        directionTargets.forEach((d) => {
          const key = `${d.occupy}>>${d.target}`;
          const existing = repeatMap.get(key);
          const entry = existing ?? {
            occupy: d.occupy,
            target: d.target,
            setCount: 0,
            localFailCount: 0,
            faceUnbalancedSets: 0,
            resCount: 0,
            resSum: 0,
            resSumSq: 0,
            resMin: Number.POSITIVE_INFINITY,
            resMax: Number.NEGATIVE_INFINITY,
            resMaxAbs: 0,
            stdCount: 0,
            stdSumSq: 0,
            maxStdRes: 0,
            spreadCount: 0,
            spreadSum: 0,
            maxSpread: 0,
            worstSetId: undefined,
            worstLine: undefined,
            worstMetric: Number.NEGATIVE_INFINITY,
          };
          entry.setCount += 1;
          if (d.localPass === false) entry.localFailCount += 1;
          if (!d.faceBalanced) entry.faceUnbalancedSets += 1;
          if (d.residualArcSec != null && Number.isFinite(d.residualArcSec)) {
            const absRes = Math.abs(d.residualArcSec);
            entry.resCount += 1;
            entry.resSum += d.residualArcSec;
            entry.resSumSq += d.residualArcSec * d.residualArcSec;
            entry.resMin = Math.min(entry.resMin, d.residualArcSec);
            entry.resMax = Math.max(entry.resMax, d.residualArcSec);
            entry.resMaxAbs = Math.max(entry.resMaxAbs, absRes);
          }
          if (d.stdRes != null && Number.isFinite(d.stdRes)) {
            entry.stdCount += 1;
            entry.stdSumSq += d.stdRes * d.stdRes;
            entry.maxStdRes = Math.max(entry.maxStdRes, d.stdRes);
          }
          if (d.rawSpreadArcSec != null && Number.isFinite(d.rawSpreadArcSec)) {
            entry.spreadCount += 1;
            entry.spreadSum += d.rawSpreadArcSec;
            entry.maxSpread = Math.max(entry.maxSpread, d.rawSpreadArcSec);
          }
          const worstMetric = (d.stdRes ?? 0) * 100 + (d.rawSpreadArcSec ?? 0);
          if (worstMetric > entry.worstMetric) {
            entry.worstMetric = worstMetric;
            entry.worstSetId = d.setId;
            entry.worstLine = d.sourceLine;
          }
          repeatMap.set(key, entry);
        });

        const repeatRows = Array.from(repeatMap.values())
          .map((entry) => {
            const residualMeanArcSec =
              entry.resCount > 0 ? entry.resSum / entry.resCount : undefined;
            const residualRmsArcSec =
              entry.resCount > 0 ? Math.sqrt(entry.resSumSq / entry.resCount) : undefined;
            const residualRangeArcSec =
              entry.resCount > 0 ? Math.abs(entry.resMax - entry.resMin) : undefined;
            const stdResRms =
              entry.stdCount > 0 ? Math.sqrt(entry.stdSumSq / entry.stdCount) : undefined;
            const meanRawSpreadArcSec =
              entry.spreadCount > 0 ? entry.spreadSum / entry.spreadCount : undefined;
            const maxRawSpreadArcSec = entry.spreadCount > 0 ? entry.maxSpread : undefined;

            let suspectScore = 0;
            suspectScore += entry.localFailCount * 80;
            suspectScore += entry.maxStdRes * 12;
            suspectScore += Math.min((maxRawSpreadArcSec ?? 0) / 2, 45);
            suspectScore += entry.faceUnbalancedSets * 8;
            if (entry.setCount > 1 && residualRangeArcSec != null) {
              suspectScore += Math.min(residualRangeArcSec / 2, 35);
            }
            if (entry.setCount <= 1) suspectScore -= 5;

            return {
              occupy: entry.occupy,
              target: entry.target,
              setCount: entry.setCount,
              localFailCount: entry.localFailCount,
              faceUnbalancedSets: entry.faceUnbalancedSets,
              residualMeanArcSec,
              residualRmsArcSec,
              residualRangeArcSec,
              residualMaxArcSec: entry.resCount > 0 ? entry.resMaxAbs : undefined,
              stdResRms,
              maxStdRes: entry.stdCount > 0 ? entry.maxStdRes : undefined,
              meanRawSpreadArcSec,
              maxRawSpreadArcSec,
              worstSetId: entry.worstSetId,
              worstLine: entry.worstLine,
              suspectScore,
            };
          })
          .sort((a, b) => {
            if (b.suspectScore !== a.suspectScore) return b.suspectScore - a.suspectScore;
            const bLocal = b.localFailCount;
            const aLocal = a.localFailCount;
            if (bLocal !== aLocal) return bLocal - aLocal;
            const bStd = b.maxStdRes ?? 0;
            const aStd = a.maxStdRes ?? 0;
            if (bStd !== aStd) return bStd - aStd;
            const bSpread = b.maxRawSpreadArcSec ?? 0;
            const aSpread = a.maxRawSpreadArcSec ?? 0;
            if (bSpread !== aSpread) return bSpread - aSpread;
            const stnCmp = a.occupy.localeCompare(b.occupy);
            if (stnCmp !== 0) return stnCmp;
            return a.target.localeCompare(b.target);
          });

        if (repeatRows.length > 0) {
          this.directionRepeatabilityDiagnostics = repeatRows;
          this.logs.push('Direction repeatability by occupy-target (top suspects):');
          repeatRows.slice(0, 8).forEach((d) => {
            this.logs.push(
              `  ${d.occupy}->${d.target}: sets=${d.setCount}, range=${d.residualRangeArcSec != null ? `${d.residualRangeArcSec.toFixed(2)}"` : '-'}, max|t|=${d.maxStdRes != null ? d.maxStdRes.toFixed(2) : '-'}, spreadMax=${d.maxRawSpreadArcSec != null ? `${d.maxRawSpreadArcSec.toFixed(2)}"` : '-'}, localFail=${d.localFailCount}, score=${d.suspectScore.toFixed(1)}`,
            );
          });
        }
      }
    }

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
