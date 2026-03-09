import { RAD_TO_DEG, DEG_TO_RAD } from './angles';
import {
  geoidGridMetadataSummary,
  interpolateGeoidUndulation,
  loadGeoidGridModel,
} from './geoid';
import { computeElevationFactor, computeGridFactors, inverseENToGeodetic } from './geodesy';
import { getCrsDefinition, isGeodeticInsideAreaOfUse } from './crsCatalog';
import type { GeoidGridModel } from './geoid';
import {
  invertSPDFromCholesky,
  choleskyDecomposeWithDamping,
  invertSymmetricLDLTWithInfo,
  multiply,
  solveSPDFromCholesky,
  transpose,
  zeros,
} from './matrix';
import { parseInput } from './parse';
import type {
  AdjustmentResult,
  ClusterApprovedMerge,
  ClusterMergeOutcome,
  DatumSufficiencyReport,
  DirectionRejectDiagnostic,
  DistanceObservation,
  DirectionObservation,
  GpsObservation,
  LevelObservation,
  LevelingLoopSegmentSuspectRow,
  Observation,
  Station,
  StationId,
  StationMap,
  InstrumentLibrary,
  Instrument,
  ObservationOverride,
  ParseOptions,
  CoordSystemDiagnosticCode,
  CoordInputClass,
  CrsOffReason,
  CrsStatus,
  FactorComputationMethod,
  GnssVectorFrame,
  ReductionUsageSummary,
} from '../types';

const EPS = 1e-10;
const EARTH_RADIUS_M = 6378137;
const GPS_ADDHIHT_SCALE_TOL = 1e-9;
const GPS_LOOP_BASE_TOLERANCE_M = 0.02;
const GPS_LOOP_TOLERANCE_PPM = 50;
const LEVEL_LOOP_DEFAULT_BASE_MM = 0;
const LEVEL_LOOP_DEFAULT_PER_SQRT_KM_MM = 4;

const gammln = (xx: number): number => {
  const cof = [
    76.180091729471, -86.505320329417, 24.014098240831, -1.23173957245, 1.208650973866e-3,
    -5.395239384953e-6,
  ];
  let x = xx;
  let y = xx;
  let tmp = x + 5.5;
  tmp -= (x + 0.5) * Math.log(tmp);
  let ser = 1.000000000190015;
  for (let j = 0; j < cof.length; j += 1) {
    y += 1;
    ser += cof[j] / y;
  }
  return -tmp + Math.log((2.506628274631 * ser) / x);
};

const gser = (a: number, x: number): number => {
  if (x <= 0) return 0;
  let sum = 1 / a;
  let del = sum;
  let ap = a;
  for (let n = 1; n <= 100; n += 1) {
    ap += 1;
    del *= x / ap;
    sum += del;
    if (Math.abs(del) < Math.abs(sum) * EPS) break;
  }
  return sum * Math.exp(-x + a * Math.log(x) - gammln(a));
};

const gcf = (a: number, x: number): number => {
  let b = x + 1 - a;
  let c = 1 / 1e-30;
  let d = 1 / b;
  let h = d;
  for (let i = 1; i <= 100; i += 1) {
    const an = -i * (i - a);
    b += 2;
    d = an * d + b;
    if (Math.abs(d) < 1e-30) d = 1e-30;
    c = b + an / c;
    if (Math.abs(c) < 1e-30) c = 1e-30;
    d = 1 / d;
    const del = d * c;
    h *= del;
    if (Math.abs(del - 1) < EPS) break;
  }
  return Math.exp(-x + a * Math.log(x) - gammln(a)) * h;
};

const gammp = (a: number, x: number): number => {
  if (x < 0 || a <= 0) return 0;
  if (x < a + 1) {
    return gser(a, x);
  }
  return 1 - gcf(a, x);
};

const chiSquarePValue = (T: number, dof: number): number => {
  if (dof <= 0 || T < 0) return 0;
  const a = dof / 2;
  const x = T / 2;
  const cdf = gammp(a, x);
  return Math.max(0, Math.min(1, 1 - cdf));
};

const chiSquareQuantile = (prob: number, dof: number): number => {
  if (dof <= 0) return 0;
  if (prob <= 0) return 0;
  if (prob >= 1) return Number.POSITIVE_INFINITY;
  const a = dof / 2;
  const cdf = (x: number) => gammp(a, x / 2);

  let lo = 0;
  let hi = Math.max(1, dof + 10 * Math.sqrt(2 * dof));
  while (cdf(hi) < prob) {
    hi *= 2;
    if (hi > 1e9) break;
  }

  for (let i = 0; i < 80; i += 1) {
    const mid = 0.5 * (lo + hi);
    if (cdf(mid) < prob) {
      lo = mid;
    } else {
      hi = mid;
    }
  }
  return 0.5 * (lo + hi);
};

const medianOf = (values: number[]): number | undefined => {
  const sorted = values
    .filter((value) => Number.isFinite(value) && value > 0)
    .sort((a, b) => a - b);
  if (sorted.length === 0) return undefined;
  const mid = Math.floor(sorted.length / 2);
  if (sorted.length % 2 === 1) return sorted[mid];
  return 0.5 * (sorted[mid - 1] + sorted[mid]);
};

const makePairKey = (a: StationId, b: StationId): string => (a < b ? `${a}|${b}` : `${b}|${a}`);

const createReductionUsageSummary = (): ReductionUsageSummary => ({
  bearing: { grid: 0, measured: 0 },
  angle: { grid: 0, measured: 0 },
  direction: { grid: 0, measured: 0 },
  distance: { ground: 0, grid: 0, ellipsoidal: 0 },
  total: 0,
});

const summarizeReductionUsage = (observations: Observation[]): ReductionUsageSummary => {
  const summary = createReductionUsageSummary();
  observations.forEach((obs) => {
    if (obs.type === 'bearing') {
      const mode = obs.gridObsMode === 'measured' ? 'measured' : 'grid';
      summary.bearing[mode] += 1;
      summary.total += 1;
      return;
    }
    if (obs.type === 'angle') {
      const mode = obs.gridObsMode === 'grid' ? 'grid' : 'measured';
      summary.angle[mode] += 1;
      summary.total += 1;
      return;
    }
    if (obs.type === 'direction' || obs.type === 'dir') {
      const mode = obs.gridObsMode === 'grid' ? 'grid' : 'measured';
      summary.direction[mode] += 1;
      summary.total += 1;
      return;
    }
    if (obs.type === 'dist') {
      const kind: 'ground' | 'grid' | 'ellipsoidal' =
        obs.distanceKind ??
        (obs.gridDistanceMode === 'ellipsoidal'
          ? 'ellipsoidal'
          : obs.gridDistanceMode === 'grid'
            ? 'grid'
            : 'ground');
      summary.distance[kind] += 1;
      summary.total += 1;
    }
  });
  return summary;
};

const classifyWeakGeometrySeverity = (
  relativeToMedian: number,
  ellipseRatio?: number,
): 'ok' | 'watch' | 'weak' => {
  if (relativeToMedian >= 2.5 || (ellipseRatio != null && ellipseRatio >= 10)) return 'weak';
  if (relativeToMedian >= 1.6 || (ellipseRatio != null && ellipseRatio >= 5)) return 'watch';
  return 'ok';
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
}

interface CoordinateConstraintEquation {
  stationId: StationId;
  component: 'x' | 'y' | 'h';
  index: number;
  target: number;
  sigma: number;
  correlationKey?: string;
  corrXY?: number;
}

interface CoordinateConstraintRowPlacement {
  row: number;
  constraint: CoordinateConstraintEquation;
}

type EquationRowInfo = { obs: Observation; component?: 'E' | 'N' } | null;
type RobustWeightMatrixBase = {
  diagonal: number[];
  correlatedPairs: { i: number; j: number; base: number }[];
};
type RobustWeightSummary = {
  factors: number[];
  downweightedRows: number;
  minWeight: number;
  maxNorm: number;
  meanWeight: number;
  topRows: NonNullable<AdjustmentResult['robustDiagnostics']>['topDownweightedRows'];
};

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
  private paramIndex: Record<StationId, { x?: number; y?: number; h?: number }> = {};
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
  private preanalysisMode = false;
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
  private azimuthCache = new Map<string, { az: number; dist: number }>();
  private zenithCache = new Map<
    string,
    { z: number; dist: number; horiz: number; dh: number; crCorr: number }
  >();

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
  ): { correction: number[][]; qxx: number[][] } {
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
    const scaledQxx = invertSPDFromCholesky(factorization.factor);
    if (!this.matrixIsFinite(scaledQxx)) {
      throw new Error(
        'Normal matrix remained singular after diagonal damping; damped covariance contains non-finite values.',
      );
    }
    const correction = this.unscaleNormalSolution(scaledCorrection, scaled.scale);
    const qxx =
      factorization.damping > 0
        ? this.recoverUndampedInverse(
            scaled.scaled,
            scaled.scale,
            scaledQxx,
            'Normal-equation covariance recovery',
          )
        : this.unscaleNormalInverse(scaledQxx, scaled.scale);
    if (!this.matrixIsFinite(correction) || !this.matrixIsFinite(qxx)) {
      throw new Error(
        'Normal matrix remained singular or numerically unstable after diagonal damping; correction or covariance contains non-finite values.',
      );
    }
    return {
      correction,
      qxx,
    };
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

  private findPairedVerticalObservation(obs: DistanceObservation): LevelObservation | Observation | undefined {
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

  private plannedGpsRawVector(obs: GpsObservation): { dE: number; dN: number } {
    const from = this.stations[obs.from];
    const to = this.stations[obs.to];
    if (!from || !to) return { dE: 0, dN: 0 };
    const offset = this.gpsRoverOffsetVector(obs);
    const dE = to.x - from.x - offset.dE;
    const dN = to.y - from.y - offset.dN;
    const horizGround = Math.hypot(dE, dN);
    if (horizGround <= 1e-12) return { dE, dN };

    const hi = Number.isFinite(obs.gpsAntennaHiM ?? Number.NaN) ? (obs.gpsAntennaHiM as number) : 0;
    const ht = Number.isFinite(obs.gpsAntennaHtM ?? Number.NaN) ? (obs.gpsAntennaHtM as number) : 0;
    const deltaGround = to.h - offset.dH - from.h;
    const deltaAntenna = deltaGround + (ht - hi);
    const rawHorizSq =
      horizGround * horizGround + deltaGround * deltaGround - deltaAntenna * deltaAntenna;
    if (!Number.isFinite(rawHorizSq) || rawHorizSq <= 1e-12) {
      return { dE, dN };
    }
    const rawHoriz = Math.sqrt(rawHorizSq);
    const scale = rawHoriz / horizGround;
    if (!Number.isFinite(scale) || scale <= 0) return { dE, dN };
    return { dE: dE * scale, dN: dN * scale };
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
        obs.obs = this.getZenith(obs.from, obs.to, obs.hi ?? 0, obs.ht ?? 0).z;
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
    const geom = this.getZenith(fromID, toID, hi, ht);
    return {
      horiz: Math.max(geom.horiz, 0),
      slope: Math.max(geom.dist, 0),
      elev: geom.dh,
    };
  }

  private effectiveStdDev(obs: Observation): number {
    const inst = this.getInstrument(obs);
    let sigma = Number.isFinite(obs.stdDev) ? obs.stdDev : 0;
    if (!inst) return Math.max(sigma, 1e-12);

    const source = obs.sigmaSource ?? 'explicit';
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
      const az = this.getAzimuth(obs.at, obs.to);
      const term = az.dist > 0 ? centerHoriz / az.dist : 0;
      return Math.max(Math.sqrt(sigma * sigma + term * term), 1e-12);
    }
    if (obs.type === 'bearing') {
      if (centerHoriz <= 0) return Math.max(sigma, 1e-12);
      const az = this.getAzimuth(obs.from, obs.to);
      const term = az.dist > 0 ? centerHoriz / az.dist : 0;
      return Math.max(Math.sqrt(sigma * sigma + term * term), 1e-12);
    }
    if (obs.type === 'dir') {
      if (centerHoriz <= 0) return Math.max(sigma, 1e-12);
      const az = this.getAzimuth(obs.from, obs.to);
      const term = az.dist > 0 ? centerHoriz / az.dist : 0;
      return Math.max(Math.sqrt(sigma * sigma + term * term), 1e-12);
    }
    if (obs.type === 'angle') {
      if (centerHoriz <= 0) return Math.max(sigma, 1e-12);
      const azTo = this.getAzimuth(obs.at, obs.to);
      const azFrom = this.getAzimuth(obs.at, obs.from);
      const dTo = Math.max(azTo.dist, 1e-12);
      const dFrom = Math.max(azFrom.dist, 1e-12);
      const angle = Number.isFinite(obs.obs) ? obs.obs : this.wrapToPi(azTo.az - azFrom.az);
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
      if (centerVert <= 0) return Math.max(sigma, 1e-12);
      return Math.max(Math.sqrt(sigma * sigma + centerVert * centerVert), 1e-12);
    }

    return Math.max(sigma, 1e-12);
  }

  private gpsCovariance(obs: Observation): { cEE: number; cNN: number; cEN: number } {
    if (obs.type !== 'gps') {
      const s = Math.max(obs.stdDev || 0, 1e-12);
      return { cEE: s * s, cNN: s * s, cEN: 0 };
    }
    const gps = obs;
    const vector = this.gpsObservedVector(gps);
    const varianceScale = Math.max(vector.scale * vector.scale, 1e-12);
    const sE = Math.max(gps.stdDevE ?? gps.stdDev ?? 0, 1e-12);
    const sN = Math.max(gps.stdDevN ?? gps.stdDev ?? 0, 1e-12);
    const corr = Math.max(-0.999, Math.min(0.999, gps.corrEN ?? 0));
    return {
      cEE: sE * sE * varianceScale,
      cNN: sN * sN * varianceScale,
      cEN: corr * sE * sN * varianceScale,
    };
  }

  private gpsWeight(obs: Observation): { wEE: number; wNN: number; wEN: number } {
    const cov = this.gpsCovariance(obs);
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

  private gpsObservedVector(obs: GpsObservation): { dE: number; dN: number; scale: number } {
    const rawE = Number.isFinite(obs.obs.dE) ? obs.obs.dE : 0;
    const rawN = Number.isFinite(obs.obs.dN) ? obs.obs.dN : 0;
    const frame: GnssVectorFrame =
      obs.gnssVectorFrame ?? this.parseState?.gnssVectorFrameDefault ?? 'gridNEU';
    let frameE = rawE;
    let frameN = rawN;
    const frameDistance = Math.hypot(rawE, rawN);

    if (frame === 'enuLocal' || frame === 'llhBaseline') {
      const convergence = this.stationFactorSnapshot(obs.from).convergenceAngleRad;
      const azLocal = Math.atan2(rawE, rawN);
      const azGrid = azLocal + convergence;
      frameE = frameDistance * Math.sin(azGrid);
      frameN = frameDistance * Math.cos(azGrid);
      if (frameDistance > 200000) {
        this.addCoordSystemWarning(
          `GNSS frame sanity check: ${obs.from}-${obs.to} declared ${frame} with unusually long horizontal span ${frameDistance.toFixed(3)}m.`,
        );
      }
    } else if (frame === 'ecefDelta') {
      this.addCoordSystemWarning(
        `GNSS frame ${frame} currently uses raw dE/dN proxy for ${obs.from}-${obs.to}; verify imported frame metadata.`,
      );
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
      return { dE: offset.dE, dN: offset.dN, scale: 1 };
    }

    const hasAntennaMeta = obs.gpsAntennaHiM != null || obs.gpsAntennaHtM != null;
    if (!hasAntennaMeta) {
      return { dE: frameE + offset.dE, dN: frameN + offset.dN, scale: 1 };
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
      return { dE: frameE + offset.dE, dN: frameN + offset.dN, scale: 1 };
    }
    const horizCorrected = Math.sqrt(horizCorrectedSq);
    if (!Number.isFinite(horizCorrected) || horizCorrected <= 1e-12) {
      return { dE: frameE + offset.dE, dN: frameN + offset.dN, scale: 1 };
    }
    const scale = horizCorrected / horizRaw;
    if (!Number.isFinite(scale) || scale <= 0) {
      return { dE: frameE + offset.dE, dN: frameN + offset.dN, scale: 1 };
    }
    return { dE: frameE * scale + offset.dE, dN: frameN * scale + offset.dN, scale };
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

  private computeGpsLoopDiagnostics(
    gpsObservations: GpsObservation[],
  ): NonNullable<AdjustmentResult['gpsLoopDiagnostics']> {
    type LoopEdge = {
      idx: number;
      obsId: number;
      from: StationId;
      to: StationId;
      dE: number;
      dN: number;
      distance: number;
      sourceLine?: number;
    };
    type ParentInfo = {
      parent?: StationId;
      edgeIdx?: number;
      dirFromParent?: 1 | -1;
      depth: number;
      component: number;
    };
    type AdjacencyRow = {
      edgeIdx: number;
      neighbor: StationId;
      dir: 1 | -1;
    };

    const edges: LoopEdge[] = gpsObservations.map((obs, idx) => {
      const vec = this.gpsObservedVector(obs);
      return {
        idx,
        obsId: obs.id,
        from: obs.from,
        to: obs.to,
        dE: vec.dE,
        dN: vec.dN,
        distance: Math.hypot(vec.dE, vec.dN),
        sourceLine: obs.sourceLine,
      };
    });
    const stations = [...new Set(edges.flatMap((edge) => [edge.from, edge.to]))].sort((a, b) =>
      a.localeCompare(b, undefined, { numeric: true }),
    );
    const adjacency = new Map<StationId, AdjacencyRow[]>();
    edges.forEach((edge) => {
      const fromList = adjacency.get(edge.from) ?? [];
      fromList.push({ edgeIdx: edge.idx, neighbor: edge.to, dir: 1 });
      adjacency.set(edge.from, fromList);
      const toList = adjacency.get(edge.to) ?? [];
      toList.push({ edgeIdx: edge.idx, neighbor: edge.from, dir: -1 });
      adjacency.set(edge.to, toList);
    });
    adjacency.forEach((rows) => {
      rows.sort(
        (a, b) =>
          a.neighbor.localeCompare(b.neighbor, undefined, { numeric: true }) ||
          a.edgeIdx - b.edgeIdx,
      );
    });

    const parentInfo = new Map<StationId, ParentInfo>();
    const treeEdgeIdx = new Set<number>();
    let componentId = 0;

    stations.forEach((start) => {
      if (parentInfo.has(start)) return;
      componentId += 1;
      parentInfo.set(start, { depth: 0, component: componentId });
      const queue: StationId[] = [start];
      for (let q = 0; q < queue.length; q += 1) {
        const current = queue[q];
        const currentInfo = parentInfo.get(current);
        if (!currentInfo) continue;
        (adjacency.get(current) ?? []).forEach((row) => {
          if (!parentInfo.has(row.neighbor)) {
            parentInfo.set(row.neighbor, {
              parent: current,
              edgeIdx: row.edgeIdx,
              dirFromParent: row.dir,
              depth: currentInfo.depth + 1,
              component: componentId,
            });
            treeEdgeIdx.add(row.edgeIdx);
            queue.push(row.neighbor);
          }
        });
      }
    });

    const buildPath = (
      from: StationId,
      to: StationId,
    ): { stations: StationId[]; segments: { edgeIdx: number; dir: number }[] } | null => {
      const fromInfo = parentInfo.get(from);
      const toInfo = parentInfo.get(to);
      if (!fromInfo || !toInfo || fromInfo.component !== toInfo.component) return null;

      let a = from;
      let b = to;
      const upSegments: { edgeIdx: number; dir: number }[] = [];
      const downSegments: { edgeIdx: number; dir: number }[] = [];

      while ((parentInfo.get(a)?.depth ?? 0) > (parentInfo.get(b)?.depth ?? 0)) {
        const info = parentInfo.get(a);
        if (!info || info.parent == null || info.edgeIdx == null || info.dirFromParent == null)
          return null;
        upSegments.push({ edgeIdx: info.edgeIdx, dir: -info.dirFromParent });
        a = info.parent;
      }
      while ((parentInfo.get(b)?.depth ?? 0) > (parentInfo.get(a)?.depth ?? 0)) {
        const info = parentInfo.get(b);
        if (!info || info.parent == null || info.edgeIdx == null || info.dirFromParent == null)
          return null;
        downSegments.push({ edgeIdx: info.edgeIdx, dir: info.dirFromParent });
        b = info.parent;
      }
      while (a !== b) {
        const infoA = parentInfo.get(a);
        const infoB = parentInfo.get(b);
        if (
          !infoA ||
          !infoB ||
          infoA.parent == null ||
          infoB.parent == null ||
          infoA.edgeIdx == null ||
          infoB.edgeIdx == null ||
          infoA.dirFromParent == null ||
          infoB.dirFromParent == null
        ) {
          return null;
        }
        upSegments.push({ edgeIdx: infoA.edgeIdx, dir: -infoA.dirFromParent });
        downSegments.push({ edgeIdx: infoB.edgeIdx, dir: infoB.dirFromParent });
        a = infoA.parent;
        b = infoB.parent;
      }

      const segments = [...upSegments, ...downSegments.reverse()];
      const stationPath: StationId[] = [from];
      let cursor = from;
      segments.forEach((seg) => {
        const edge = edges[seg.edgeIdx];
        if (!edge) return;
        const next = seg.dir >= 0 ? edge.to : edge.from;
        if (cursor === next) {
          const alt = seg.dir >= 0 ? edge.from : edge.to;
          stationPath.push(alt);
          cursor = alt;
          return;
        }
        stationPath.push(next);
        cursor = next;
      });
      if (stationPath[stationPath.length - 1] !== to) stationPath.push(to);
      return { stations: stationPath, segments };
    };

    const nonTreeEdges = edges
      .filter((edge) => !treeEdgeIdx.has(edge.idx))
      .sort((a, b) => {
        const la = a.sourceLine ?? Number.MAX_SAFE_INTEGER;
        const lb = b.sourceLine ?? Number.MAX_SAFE_INTEGER;
        if (la !== lb) return la - lb;
        if (a.obsId !== b.obsId) return a.obsId - b.obsId;
        return a.idx - b.idx;
      });

    const loops = nonTreeEdges
      .map((edge, idx) => {
        const treePath = buildPath(edge.from, edge.to);
        if (!treePath) return null;
        let sumE = 0;
        let sumN = 0;
        const lineSet = new Set<number>();
        treePath.segments.forEach((segment) => {
          const segEdge = edges[segment.edgeIdx];
          if (!segEdge) return;
          sumE += segment.dir * segEdge.dE;
          sumN += segment.dir * segEdge.dN;
          if (segEdge.sourceLine != null) lineSet.add(segEdge.sourceLine);
        });
        const closureE = sumE - edge.dE;
        const closureN = sumN - edge.dN;
        const closureMag = Math.hypot(closureE, closureN);
        const loopDistance =
          treePath.segments.reduce((acc, seg) => {
            const segEdge = edges[seg.edgeIdx];
            if (!segEdge) return acc;
            return acc + segEdge.distance;
          }, 0) + edge.distance;
        const closureRatio = closureMag > EPS ? loopDistance / closureMag : undefined;
        const linearPpm = loopDistance > EPS ? (closureMag / loopDistance) * 1e6 : undefined;
        const toleranceM = GPS_LOOP_BASE_TOLERANCE_M + GPS_LOOP_TOLERANCE_PPM * 1e-6 * loopDistance;
        const pass = closureMag <= toleranceM + EPS;
        const severity =
          toleranceM > EPS ? closureMag / toleranceM : closureMag > EPS ? Infinity : 0;
        if (edge.sourceLine != null) lineSet.add(edge.sourceLine);
        return {
          rank: 0,
          key: `GL-${idx + 1}-${edge.from}`,
          stationPath: [...treePath.stations, edge.from],
          edgeCount: treePath.segments.length + 1,
          sourceLines: [...lineSet].sort((a, b) => a - b),
          closureE,
          closureN,
          closureMag,
          loopDistance,
          closureRatio,
          linearPpm,
          toleranceM,
          severity,
          pass,
        };
      })
      .filter((loop): loop is NonNullable<typeof loop> => loop != null);
    const rankedLoops = loops
      .sort((a, b) => {
        if (b.severity !== a.severity) return b.severity - a.severity;
        if (b.closureMag !== a.closureMag) return b.closureMag - a.closureMag;
        return a.key.localeCompare(b.key, undefined, { numeric: true });
      })
      .map((loop, idx) => ({ ...loop, rank: idx + 1 }));
    const passCount = rankedLoops.filter((loop) => loop.pass).length;
    const warnCount = rankedLoops.length - passCount;

    return {
      enabled: true,
      vectorCount: edges.length,
      loopCount: rankedLoops.length,
      passCount,
      warnCount,
      thresholds: {
        baseToleranceM: GPS_LOOP_BASE_TOLERANCE_M,
        ppmTolerance: GPS_LOOP_TOLERANCE_PPM,
      },
      loops: rankedLoops,
    };
  }

  private computeLevelingLoopDiagnostics(
    levelingObservations: LevelObservation[],
  ): NonNullable<AdjustmentResult['levelingLoopDiagnostics']> {
    type LoopEdge = {
      idx: number;
      obsId: number;
      from: StationId;
      to: StationId;
      dH: number;
      lengthKm: number;
      sourceLine?: number;
    };
    type ParentInfo = {
      parent?: StationId;
      edgeIdx?: number;
      dirFromParent?: 1 | -1;
      depth: number;
      component: number;
    };
    type AdjacencyRow = {
      edgeIdx: number;
      neighbor: StationId;
      dir: 1 | -1;
    };

    const edges: LoopEdge[] = levelingObservations.map((obs, idx) => ({
      idx,
      obsId: obs.id,
      from: obs.from,
      to: obs.to,
      dH: obs.obs,
      lengthKm: obs.lenKm,
      sourceLine: obs.sourceLine,
    }));
    const totalLengthKm = edges.reduce((acc, edge) => acc + edge.lengthKm, 0);
    const stations = [...new Set(edges.flatMap((edge) => [edge.from, edge.to]))].sort((a, b) =>
      a.localeCompare(b, undefined, { numeric: true }),
    );
    const adjacency = new Map<StationId, AdjacencyRow[]>();
    edges.forEach((edge) => {
      const fromList = adjacency.get(edge.from) ?? [];
      fromList.push({ edgeIdx: edge.idx, neighbor: edge.to, dir: 1 });
      adjacency.set(edge.from, fromList);
      const toList = adjacency.get(edge.to) ?? [];
      toList.push({ edgeIdx: edge.idx, neighbor: edge.from, dir: -1 });
      adjacency.set(edge.to, toList);
    });
    adjacency.forEach((rows) => {
      rows.sort(
        (a, b) =>
          a.neighbor.localeCompare(b.neighbor, undefined, { numeric: true }) ||
          a.edgeIdx - b.edgeIdx,
      );
    });

    const parentInfo = new Map<StationId, ParentInfo>();
    const treeEdgeIdx = new Set<number>();
    let componentId = 0;

    stations.forEach((start) => {
      if (parentInfo.has(start)) return;
      componentId += 1;
      parentInfo.set(start, { depth: 0, component: componentId });
      const queue: StationId[] = [start];
      for (let q = 0; q < queue.length; q += 1) {
        const current = queue[q];
        const currentInfo = parentInfo.get(current);
        if (!currentInfo) continue;
        (adjacency.get(current) ?? []).forEach((row) => {
          if (!parentInfo.has(row.neighbor)) {
            parentInfo.set(row.neighbor, {
              parent: current,
              edgeIdx: row.edgeIdx,
              dirFromParent: row.dir,
              depth: currentInfo.depth + 1,
              component: componentId,
            });
            treeEdgeIdx.add(row.edgeIdx);
            queue.push(row.neighbor);
          }
        });
      }
    });

    const buildPath = (
      from: StationId,
      to: StationId,
    ): { stations: StationId[]; segments: { edgeIdx: number; dir: number }[] } | null => {
      const fromInfo = parentInfo.get(from);
      const toInfo = parentInfo.get(to);
      if (!fromInfo || !toInfo || fromInfo.component !== toInfo.component) return null;

      let a = from;
      let b = to;
      const upSegments: { edgeIdx: number; dir: number }[] = [];
      const downSegments: { edgeIdx: number; dir: number }[] = [];

      while ((parentInfo.get(a)?.depth ?? 0) > (parentInfo.get(b)?.depth ?? 0)) {
        const info = parentInfo.get(a);
        if (!info || info.parent == null || info.edgeIdx == null || info.dirFromParent == null)
          return null;
        upSegments.push({ edgeIdx: info.edgeIdx, dir: -info.dirFromParent });
        a = info.parent;
      }
      while ((parentInfo.get(b)?.depth ?? 0) > (parentInfo.get(a)?.depth ?? 0)) {
        const info = parentInfo.get(b);
        if (!info || info.parent == null || info.edgeIdx == null || info.dirFromParent == null)
          return null;
        downSegments.push({ edgeIdx: info.edgeIdx, dir: info.dirFromParent });
        b = info.parent;
      }
      while (a !== b) {
        const infoA = parentInfo.get(a);
        const infoB = parentInfo.get(b);
        if (
          !infoA ||
          !infoB ||
          infoA.parent == null ||
          infoB.parent == null ||
          infoA.edgeIdx == null ||
          infoB.edgeIdx == null ||
          infoA.dirFromParent == null ||
          infoB.dirFromParent == null
        ) {
          return null;
        }
        upSegments.push({ edgeIdx: infoA.edgeIdx, dir: -infoA.dirFromParent });
        downSegments.push({ edgeIdx: infoB.edgeIdx, dir: infoB.dirFromParent });
        a = infoA.parent;
        b = infoB.parent;
      }

      const segments = [...upSegments, ...downSegments.reverse()];
      const stationPath: StationId[] = [from];
      let cursor = from;
      segments.forEach((seg) => {
        const edge = edges[seg.edgeIdx];
        if (!edge) return;
        const next = seg.dir >= 0 ? edge.to : edge.from;
        if (cursor === next) {
          const alt = seg.dir >= 0 ? edge.from : edge.to;
          stationPath.push(alt);
          cursor = alt;
          return;
        }
        stationPath.push(next);
        cursor = next;
      });
      if (stationPath[stationPath.length - 1] !== to) stationPath.push(to);
      return { stations: stationPath, segments };
    };

    const nonTreeEdges = edges
      .filter((edge) => !treeEdgeIdx.has(edge.idx))
      .sort((a, b) => {
        const la = a.sourceLine ?? Number.MAX_SAFE_INTEGER;
        const lb = b.sourceLine ?? Number.MAX_SAFE_INTEGER;
        if (la !== lb) return la - lb;
        if (a.obsId !== b.obsId) return a.obsId - b.obsId;
        return a.idx - b.idx;
      });

    const loops = nonTreeEdges
      .map((edge, idx) => {
        const treePath = buildPath(edge.from, edge.to);
        if (!treePath) return null;
        let closure = 0;
        const lineSet = new Set<number>();
        const segments = treePath.segments
          .map((segment) => {
            const segEdge = edges[segment.edgeIdx];
            if (!segEdge) return null;
            const observedDh = segment.dir * segEdge.dH;
            closure += observedDh;
            if (segEdge.sourceLine != null) lineSet.add(segEdge.sourceLine);
            return {
              from: segment.dir >= 0 ? segEdge.from : segEdge.to,
              to: segment.dir >= 0 ? segEdge.to : segEdge.from,
              observedDh,
              lengthKm: segEdge.lengthKm,
              sourceLine: segEdge.sourceLine,
              closureLeg: false,
            };
          })
          .filter((segment): segment is NonNullable<typeof segment> => segment != null);
        closure -= edge.dH;
        if (edge.sourceLine != null) lineSet.add(edge.sourceLine);
        segments.push({
          from: edge.to,
          to: edge.from,
          observedDh: -edge.dH,
          lengthKm: edge.lengthKm,
          sourceLine: edge.sourceLine,
          closureLeg: true,
        });
        const loopLengthKm =
          treePath.segments.reduce((acc, segment) => {
            const segEdge = edges[segment.edgeIdx];
            if (!segEdge) return acc;
            return acc + segEdge.lengthKm;
          }, 0) + edge.lengthKm;
        const absClosure = Math.abs(closure);
        const toleranceMm =
          this.levelLoopToleranceBaseMm +
          this.levelLoopTolerancePerSqrtKmMm * Math.sqrt(Math.max(loopLengthKm, 0));
        const toleranceM = toleranceMm / 1000;
        const closurePerSqrtKmMm =
          loopLengthKm > EPS
            ? (absClosure * 1000) / Math.sqrt(loopLengthKm)
            : absClosure * 1000;
        const pass = absClosure <= toleranceM + EPS;
        return {
          rank: 0,
          key: `LL-${idx + 1}-${edge.from}`,
          stationPath: [...treePath.stations, edge.from],
          edgeCount: treePath.segments.length + 1,
          sourceLines: [...lineSet].sort((a, b) => a - b),
          closure,
          absClosure,
          loopLengthKm,
          toleranceMm,
          toleranceM,
          closurePerSqrtKmMm,
          severity: toleranceMm > EPS ? absClosure * 1000 / toleranceMm : closurePerSqrtKmMm,
          pass,
          segments,
        };
      })
      .filter((loop): loop is NonNullable<typeof loop> => loop != null);

    const rankedLoops = loops
      .sort((a, b) => {
        if (b.severity !== a.severity) return b.severity - a.severity;
        if (b.absClosure !== a.absClosure) return b.absClosure - a.absClosure;
        return a.key.localeCompare(b.key, undefined, { numeric: true });
      })
      .map((loop, idx) => ({ ...loop, rank: idx + 1 }));

    const passCount = rankedLoops.filter((loop) => loop.pass).length;
    const warnLoops = rankedLoops.filter((loop) => !loop.pass);
    const warnCount = warnLoops.length;
    const warnTotalLengthKm = warnLoops.reduce((acc, loop) => acc + loop.loopLengthKm, 0);
    const suspectSegments = (() => {
      const segmentMap = new Map<
        string,
        Omit<LevelingLoopSegmentSuspectRow, 'rank'>
      >();
      warnLoops.forEach((loop) => {
        loop.segments.forEach((segment) => {
          const key =
            segment.sourceLine != null
              ? `L${segment.sourceLine}`
              : `${segment.from}->${segment.to}-${segment.closureLeg ? 'closure' : 'traverse'}`;
          const existing = segmentMap.get(key);
          if (existing) {
            existing.occurrenceCount += 1;
            existing.warnLoopCount += 1;
            existing.totalLengthKm += segment.lengthKm;
            existing.maxAbsDh = Math.max(existing.maxAbsDh, Math.abs(segment.observedDh));
            existing.suspectScore += loop.severity;
            existing.closureLegCount += segment.closureLeg ? 1 : 0;
            if (loop.severity > existing.worstLoopSeverity) {
              existing.worstLoopSeverity = loop.severity;
              existing.worstLoopKey = loop.key;
            }
            return;
          }
          segmentMap.set(key, {
            key,
            from: segment.from,
            to: segment.to,
            sourceLine: segment.sourceLine,
            occurrenceCount: 1,
            warnLoopCount: 1,
            totalLengthKm: segment.lengthKm,
            maxAbsDh: Math.abs(segment.observedDh),
            suspectScore: loop.severity,
            worstLoopKey: loop.key,
            worstLoopSeverity: loop.severity,
            closureLegCount: segment.closureLeg ? 1 : 0,
          });
        });
      });
      return [...segmentMap.values()]
        .sort((a, b) => {
          if (b.suspectScore !== a.suspectScore) return b.suspectScore - a.suspectScore;
          if (b.warnLoopCount !== a.warnLoopCount) return b.warnLoopCount - a.warnLoopCount;
          if (b.maxAbsDh !== a.maxAbsDh) return b.maxAbsDh - a.maxAbsDh;
          const la = a.sourceLine ?? Number.MAX_SAFE_INTEGER;
          const lb = b.sourceLine ?? Number.MAX_SAFE_INTEGER;
          if (la !== lb) return la - lb;
          return a.key.localeCompare(b.key, undefined, { numeric: true });
        })
        .map((segment, idx) => ({ ...segment, rank: idx + 1 }));
    })();

    return {
      enabled: true,
      observationCount: edges.length,
      loopCount: rankedLoops.length,
      passCount,
      warnCount,
      totalLengthKm,
      warnTotalLengthKm,
      thresholds: {
        baseMm: this.levelLoopToleranceBaseMm,
        perSqrtKmMm: this.levelLoopTolerancePerSqrtKmMm,
      },
      worstLoopKey: rankedLoops[0]?.key,
      worstClosure: rankedLoops[0]?.absClosure,
      worstClosurePerSqrtKmMm: rankedLoops[0]?.closurePerSqrtKmMm,
      loops: rankedLoops,
      suspectSegments,
    };
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
    let sum = 0;
    for (let i = 0; i < v.length; i += 1) {
      const vi = v[i][0];
      if (vi === 0) continue;
      for (let j = 0; j < v.length; j += 1) {
        const pj = P[i][j];
        if (pj === 0) continue;
        sum += vi * pj * v[j][0];
      }
    }
    return sum;
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
      const variance = info.component === 'N' ? cov.cNN : cov.cEE;
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

  private recordRobustDiagnostics(iteration: number, summary: RobustWeightSummary): void {
    if (!this.robustDiagnostics) return;
    this.robustDiagnostics.iterations.push({
      iteration,
      downweightedRows: summary.downweightedRows,
      meanWeight: summary.meanWeight,
      minWeight: summary.minWeight,
      maxNorm: summary.maxNorm,
    });
    this.robustDiagnostics.topDownweightedRows = summary.topRows;
    this.log(
      `Iter ${iteration} robust(${this.robustMode}): downweighted=${summary.downweightedRows}, minW=${summary.minWeight.toFixed(3)}, meanW=${summary.meanWeight.toFixed(3)}, max|v/sigma|=${summary.maxNorm.toFixed(2)}`,
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
  }

  private log(msg: string) {
    this.logs.push(msg);
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
    const active: Observation[] = [];
    this.observations.forEach((obs) => {
      if (this.isObservationActive(obs)) active.push(obs);
    });
    return active;
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
        Number.isFinite(station.latDeg ?? Number.NaN) ||
        Number.isFinite(station.lonDeg ?? Number.NaN) ||
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
      suggestions.push('Tag geodetic records with explicit CRS/datum or re-enter as grid/projected coordinates.');
    }
    if (hasLocal && (hasGrid || hasGeodetic)) {
      reasons.push(
        'Grid mode input class check failed: LOCAL coordinates mixed with GRID/GEODETIC coordinates without localization transform.',
      );
      suggestions.push('Remove local records or define a localization workflow before mixing systems.');
    }
    if (hasGeodetic && (!this.crsId || !this.crsId.trim())) {
      reasons.push('Grid mode input class check failed: GEODETIC coordinates provided but CRS id is missing.');
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
      suggestions.push('Set .GPS FRAME to a known frame (GRIDNEU/ENULOCAL/ECEFDELTA/LLHBASELINE) or confirm unknown frame usage.');
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

    const hasDistanceLike = activeObservations.some((obs) => obs.type === 'dist' || obs.type === 'gps');
    const hasAngularFamilies = activeObservations.some(
      (obs) => obs.type === 'angle' || obs.type === 'bearing' || obs.type === 'dir' || obs.type === 'direction',
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
        suggestions.push('Add at least one distance-like constraint (distance/GNSS) or add fixed/weighted coordinate control that constrains scale.');
      } else if (weightedOrFixedXYCount < 2) {
        status = 'soft-warn';
        reasons.push(
          '2D datum sufficiency warning: weak horizontal datum control (few fixed/weighted coordinate constraints).',
        );
        suggestions.push('Add a second fixed/weighted control point or a fixed azimuth/bearing constraint to strengthen orientation.');
      }
    } else {
      if (weightedOrFixedXYCount === 0) {
        status = 'hard-fail';
        reasons.push('3D datum sufficiency failed: horizontal datum is undefined (no fixed/weighted XY control).');
        suggestions.push('Add fixed or weighted XY control points.');
      } else if (weightedOrFixedXYCount < 2) {
        status = 'soft-warn';
        reasons.push('3D datum sufficiency warning: weak horizontal control (single fixed/weighted XY constraint).');
        suggestions.push('Add another fixed/weighted control point to stabilize orientation/scale.');
      }
      if (weightedOrFixedHCount === 0) {
        status = 'hard-fail';
        reasons.push('3D datum sufficiency failed: vertical datum is undefined (no fixed/weighted height control).');
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
    if (
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
        this.setCrsOff('projDbMissing', 'Projection database is unavailable for CRS inverse operations.');
      } else if (reason === 'missingGridFiles') {
        this.setCrsOff('missingGridFiles', 'Required grid-shift files are missing for CRS datum/vertical operations.');
      } else if (reason === 'unsupportedCrsFamily') {
        this.setCrsOff('unsupportedCrsFamily', `Unsupported CRS family for ${this.crsId || 'unspecified CRS'}.`);
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
    (inv.warnings ?? []).forEach((warning) => this.addCoordSystemDiagnostic('CRS_DATUM_FALLBACK', warning));
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
    const elevationFactor = computeElevationFactor(this.stationEllipsoidHeight(station), EARTH_RADIUS_M);
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
        this.crsGridScaleEnabled && Number.isFinite(this.crsGridScaleFactor) && this.crsGridScaleFactor > 0
          ? this.crsGridScaleFactor
          : 1;
      if (this.localDatumScheme === 'common-elevation') {
        const from = this.stations[obs.from];
        const to = this.stations[obs.to];
        if (!from || !to) return 1;
        const meanElevation = (this.stationEllipsoidHeight(from) + this.stationEllipsoidHeight(to)) / 2;
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
  ): { calcDistance: number; mapScale: number; prismCorrection: number } {
    const mapScale = this.distanceScaleForObservation(obs);
    const prismCorrection = this.prismCorrectionForObservation(obs);
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
    return ((1 - this.refractionCoefficient) * horiz) / (2 * EARTH_RADIUS_M);
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
      const geom = this.getZenith(obs.from, obs.to, obs.hi ?? 0, obs.ht ?? 0).dist;
      return Number.isFinite(geom) && geom > 0 ? geom : undefined;
    }
    return undefined;
  }

  private isObservationActive(obs: Observation): boolean {
    if (this.excludeIds?.has(obs.id)) return false;
    if (obs.type === 'gps' && obs.gpsMode === 'sideshot') return false;
    if (typeof obs.calc === 'object' && (obs.calc as any)?.sideshot) return false;
    if (this.is2D && (obs.type === 'lev' || obs.type === 'zenith')) return false;
    return true;
  }

  private buildCoordinateConstraints(
    paramIndex: Record<StationId, { x?: number; y?: number; h?: number }>,
  ): CoordinateConstraintEquation[] {
    const constraints: CoordinateConstraintEquation[] = [];
    Object.entries(paramIndex).forEach(([stationId, idx]) => {
      const st = this.stations[stationId];
      if (!st) return;
      const hasCorrelatedXY =
        idx.x != null &&
        idx.y != null &&
        st.sx != null &&
        st.sy != null &&
        st.constraintX != null &&
        st.constraintY != null &&
        Number.isFinite(st.sx) &&
        Number.isFinite(st.sy) &&
        st.sx > 0 &&
        st.sy > 0 &&
        Number.isFinite(st.constraintCorrXY ?? Number.NaN) &&
        Math.abs(st.constraintCorrXY ?? 0) > 1e-12;
      const correlationKey = hasCorrelatedXY ? `CTRLXY:${stationId}` : undefined;
      const corrXY = hasCorrelatedXY
        ? Math.max(-0.999, Math.min(0.999, st.constraintCorrXY ?? 0))
        : undefined;
      if (
        idx.x != null &&
        st.sx != null &&
        st.constraintX != null &&
        Number.isFinite(st.sx) &&
        st.sx > 0
      ) {
        constraints.push({
          stationId,
          component: 'x',
          index: idx.x,
          target: st.constraintX,
          sigma: st.sx,
          correlationKey,
          corrXY,
        });
      }
      if (
        idx.y != null &&
        st.sy != null &&
        st.constraintY != null &&
        Number.isFinite(st.sy) &&
        st.sy > 0
      ) {
        constraints.push({
          stationId,
          component: 'y',
          index: idx.y,
          target: st.constraintY,
          sigma: st.sy,
          correlationKey,
          corrXY,
        });
      }
      if (
        !this.is2D &&
        idx.h != null &&
        st.sh != null &&
        st.constraintH != null &&
        Number.isFinite(st.sh) &&
        st.sh > 0
      ) {
        constraints.push({
          stationId,
          component: 'h',
          index: idx.h,
          target: st.constraintH,
          sigma: st.sh,
        });
      }
    });
    return constraints;
  }

  private summarizeConstraints(constraints: CoordinateConstraintEquation[]) {
    const x = constraints.filter((c) => c.component === 'x').length;
    const y = constraints.filter((c) => c.component === 'y').length;
    const h = constraints.filter((c) => c.component === 'h').length;
    const xyCorrelated = new Set(
      constraints
        .map((constraint) => constraint.correlationKey)
        .filter((key): key is string => !!key),
    ).size;
    return { count: constraints.length, x, y, h, xyCorrelated };
  }

  private applyCoordinateConstraintCorrelationWeights(
    P: number[][],
    placements: CoordinateConstraintRowPlacement[],
  ): void {
    const groups = new Map<
      string,
      {
        corrXY: number;
        x?: CoordinateConstraintRowPlacement;
        y?: CoordinateConstraintRowPlacement;
      }
    >();
    placements.forEach((placement) => {
      const key = placement.constraint.correlationKey;
      if (!key) return;
      const corrXY = placement.constraint.corrXY;
      if (!Number.isFinite(corrXY ?? Number.NaN)) return;
      const group = groups.get(key) ?? { corrXY: corrXY as number };
      if (placement.constraint.component === 'x') group.x = placement;
      if (placement.constraint.component === 'y') group.y = placement;
      groups.set(key, group);
    });

    groups.forEach((group) => {
      if (!group.x || !group.y) return;
      const sigmaX = group.x.constraint.sigma;
      const sigmaY = group.y.constraint.sigma;
      const corr = Math.max(-0.999, Math.min(0.999, group.corrXY));
      const denom = 1 - corr * corr;
      if (!Number.isFinite(denom) || denom <= 1e-9) return;
      const rowX = group.x.row;
      const rowY = group.y.row;
      const wXX = 1 / (sigmaX * sigmaX * denom);
      const wYY = 1 / (sigmaY * sigmaY * denom);
      const wXY = -corr / (sigmaX * sigmaY * denom);
      P[rowX][rowX] = wXX;
      P[rowY][rowY] = wYY;
      P[rowX][rowY] = wXY;
      P[rowY][rowX] = wXY;
    });
  }

  private coordinateConstraintWeightedSum(constraints: CoordinateConstraintEquation[]): number {
    let total = 0;
    const grouped = new Map<
      string,
      {
        corrXY: number;
        x?: CoordinateConstraintEquation;
        y?: CoordinateConstraintEquation;
      }
    >();

    constraints.forEach((constraint) => {
      const key = constraint.correlationKey;
      if (!key) {
        const st = this.stations[constraint.stationId];
        if (!st) return;
        const current =
          constraint.component === 'x' ? st.x : constraint.component === 'y' ? st.y : st.h;
        const v = constraint.target - current;
        total += (v * v) / (constraint.sigma * constraint.sigma);
        return;
      }
      const corrXY = constraint.corrXY;
      if (!Number.isFinite(corrXY ?? Number.NaN)) return;
      const group = grouped.get(key) ?? { corrXY: corrXY as number };
      if (constraint.component === 'x') group.x = constraint;
      if (constraint.component === 'y') group.y = constraint;
      grouped.set(key, group);
    });

    grouped.forEach((group) => {
      if (!group.x || !group.y) {
        [group.x, group.y].forEach((constraint) => {
          if (!constraint) return;
          const st = this.stations[constraint.stationId];
          if (!st) return;
          const current = constraint.component === 'x' ? st.x : st.y;
          const v = constraint.target - current;
          total += (v * v) / (constraint.sigma * constraint.sigma);
        });
        return;
      }
      const st = this.stations[group.x.stationId];
      if (!st) return;
      const vX = group.x.target - st.x;
      const vY = group.y.target - st.y;
      const corr = Math.max(-0.999, Math.min(0.999, group.corrXY));
      const denom = 1 - corr * corr;
      if (!Number.isFinite(denom) || denom <= 1e-9) {
        total += (vX * vX) / (group.x.sigma * group.x.sigma);
        total += (vY * vY) / (group.y.sigma * group.y.sigma);
        return;
      }
      total +=
        ((vX * vX) / (group.x.sigma * group.x.sigma) -
          (2 * corr * vX * vY) / (group.x.sigma * group.y.sigma) +
          (vY * vY) / (group.y.sigma * group.y.sigma)) /
        denom;
    });

    return total;
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

  private computeAutoSideshotDiagnostics(): NonNullable<
    AdjustmentResult['autoSideshotDiagnostics']
  > {
    const threshold = 0.1;
    type MPair = { angle?: Observation; dist?: Observation };
    const byLine = new Map<number, MPair>();

    this.observations.forEach((obs) => {
      const sourceLine = obs.sourceLine;
      if (sourceLine == null) return;
      if (obs.type === 'angle' && String((obs as any).setId ?? '') === '') {
        const row = byLine.get(sourceLine) ?? {};
        row.angle = obs;
        byLine.set(sourceLine, row);
      } else if (
        obs.type === 'dist' &&
        obs.subtype === 'ts' &&
        String((obs as any).setId ?? '') === ''
      ) {
        const row = byLine.get(sourceLine) ?? {};
        row.dist = obs;
        byLine.set(sourceLine, row);
      }
    });

    const candidates: NonNullable<AdjustmentResult['autoSideshotDiagnostics']>['candidates'] = [];
    let evaluatedCount = 0;
    let excludedControlCount = 0;

    [...byLine.entries()]
      .sort((a, b) => a[0] - b[0])
      .forEach(([sourceLine, pair]) => {
        const angle = pair.angle;
        const dist = pair.dist;
        if (!angle || !dist || angle.type !== 'angle' || dist.type !== 'dist') return;
        if (angle.at !== dist.from || angle.to !== dist.to) return;
        evaluatedCount += 1;

        const targetStation = this.stations[dist.to];
        if (targetStation?.fixed) {
          excludedControlCount += 1;
          return;
        }

        const angleRedundancy = this.redundancyScalar(angle) ?? 0;
        const distRedundancy = this.redundancyScalar(dist) ?? 0;
        const minRedundancy = Math.min(angleRedundancy, distRedundancy);
        if (minRedundancy >= threshold) return;

        candidates.push({
          sourceLine,
          occupy: angle.at,
          backsight: angle.from,
          target: angle.to,
          angleObsId: angle.id,
          distObsId: dist.id,
          angleRedundancy,
          distRedundancy,
          minRedundancy,
          maxAbsStdRes: Math.max(Math.abs(angle.stdRes ?? 0), Math.abs(dist.stdRes ?? 0)),
        });
      });

    candidates.sort((a, b) => {
      if (a.minRedundancy !== b.minRedundancy) return a.minRedundancy - b.minRedundancy;
      if (b.maxAbsStdRes !== a.maxAbsStdRes) return b.maxAbsStdRes - a.maxAbsStdRes;
      const la = a.sourceLine ?? Number.MAX_SAFE_INTEGER;
      const lb = b.sourceLine ?? Number.MAX_SAFE_INTEGER;
      return la - lb;
    });

    return {
      enabled: true,
      threshold,
      evaluatedCount,
      excludedControlCount,
      candidateCount: candidates.length,
      candidates,
    };
  }

  private normalizeApprovedClusterMerges(merges?: ClusterApprovedMerge[]): ClusterApprovedMerge[] {
    if (!merges || merges.length === 0) return [];
    const seen = new Set<string>();
    const cleaned = merges
      .map((m) => ({
        aliasId: String(m.aliasId ?? '').trim(),
        canonicalId: String(m.canonicalId ?? '').trim(),
      }))
      .filter((m) => m.aliasId && m.canonicalId && m.aliasId !== m.canonicalId);
    cleaned.sort(
      (a, b) =>
        a.canonicalId.localeCompare(b.canonicalId, undefined, { numeric: true }) ||
        a.aliasId.localeCompare(b.aliasId, undefined, { numeric: true }),
    );
    return cleaned.filter((m) => {
      const key = `${m.aliasId}|${m.canonicalId}`;
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    });
  }

  private buildClusterMergeOutcomes(
    pass1Result: AdjustmentResult,
    merges: ClusterApprovedMerge[],
  ): ClusterMergeOutcome[] {
    const is2D = (pass1Result.parseState?.coordMode ?? '3D') === '2D';
    return merges
      .map((merge) => {
        const alias = pass1Result.stations[merge.aliasId];
        const canonical = pass1Result.stations[merge.canonicalId];
        if (!alias || !canonical) {
          return {
            aliasId: merge.aliasId,
            canonicalId: merge.canonicalId,
            missing: true,
          };
        }
        const deltaE = alias.x - canonical.x;
        const deltaN = alias.y - canonical.y;
        const deltaH = is2D ? undefined : alias.h - canonical.h;
        const horizontalDelta = Math.hypot(deltaE, deltaN);
        const spatialDelta =
          deltaH == null
            ? horizontalDelta
            : Math.sqrt(deltaE * deltaE + deltaN * deltaN + deltaH * deltaH);
        return {
          aliasId: merge.aliasId,
          canonicalId: merge.canonicalId,
          aliasE: alias.x,
          aliasN: alias.y,
          aliasH: is2D ? undefined : alias.h,
          canonicalE: canonical.x,
          canonicalN: canonical.y,
          canonicalH: is2D ? undefined : canonical.h,
          deltaE,
          deltaN,
          deltaH,
          horizontalDelta,
          spatialDelta,
        };
      })
      .sort(
        (a, b) =>
          a.canonicalId.localeCompare(b.canonicalId, undefined, { numeric: true }) ||
          a.aliasId.localeCompare(b.aliasId, undefined, { numeric: true }),
      );
  }

  solve(): AdjustmentResult {
    const passLabel = this.parseOptions?.clusterPassLabel ?? 'single';
    const approvedMerges = this.normalizeApprovedClusterMerges(
      this.parseOptions?.clusterApprovedMerges,
    );
    if (approvedMerges.length > 0 && passLabel !== 'pass2') {
      const pass1Options: Partial<ParseOptions> = {
        ...(this.parseOptions ?? {}),
        clusterApprovedMerges: [],
        clusterPassLabel: 'pass1',
        clusterDualPassRan: false,
        clusterApprovedMergeCount: 0,
      };
      const pass1Engine = new LSAEngine({
        input: this.input,
        maxIterations: this.maxIterations,
        instrumentLibrary: this.instrumentLibrary,
        convergenceThreshold: this.convergenceThreshold,
        excludeIds: this.excludeIds,
        overrides: this.overrides,
        parseOptions: pass1Options,
      });
      const pass1Result = pass1Engine.solve();

      const pass2Options: Partial<ParseOptions> = {
        ...(this.parseOptions ?? {}),
        clusterApprovedMerges: approvedMerges,
        clusterPassLabel: 'pass2',
        clusterDualPassRan: true,
        clusterApprovedMergeCount: approvedMerges.length,
      };
      const pass2Engine = new LSAEngine({
        input: this.input,
        maxIterations: this.maxIterations,
        instrumentLibrary: this.instrumentLibrary,
        convergenceThreshold: this.convergenceThreshold,
        excludeIds: this.excludeIds,
        overrides: this.overrides,
        parseOptions: pass2Options,
      });
      const pass2Result = pass2Engine.solve();
      const mergeOutcomes = this.buildClusterMergeOutcomes(pass1Result, approvedMerges);

      pass2Result.parseState = {
        ...(pass2Result.parseState ?? ({} as ParseOptions)),
        clusterPassLabel: 'pass2',
        clusterDualPassRan: true,
        clusterApprovedMergeCount: approvedMerges.length,
      };

      if (pass2Result.clusterDiagnostics) {
        pass2Result.clusterDiagnostics.passMode = 'dual-pass';
        pass2Result.clusterDiagnostics.pass1CandidateCount =
          pass1Result.clusterDiagnostics?.candidateCount ?? 0;
        pass2Result.clusterDiagnostics.approvedMergeCount = approvedMerges.length;
        pass2Result.clusterDiagnostics.appliedMerges = approvedMerges;
        pass2Result.clusterDiagnostics.mergeOutcomes = mergeOutcomes;
      }

      pass2Result.logs = [
        `Cluster dual-pass: pass1 candidates=${pass1Result.clusterDiagnostics?.candidateCount ?? 0}, approved merges=${approvedMerges.length}`,
        ...mergeOutcomes.slice(0, 20).map((row) => {
          if (row.missing) {
            return `  merge ${row.aliasId}->${row.canonicalId}: missing station data in pass1`;
          }
          return `  merge ${row.aliasId}->${row.canonicalId}: dE=${(row.deltaE ?? 0).toFixed(4)}m dN=${(row.deltaN ?? 0).toFixed(4)}m dH=${row.deltaH != null ? `${row.deltaH.toFixed(4)}m` : '-'} d2D=${(row.horizontalDelta ?? 0).toFixed(4)}m d3D=${row.spatialDelta != null ? `${row.spatialDelta.toFixed(4)}m` : '-'}`;
        }),
        ...pass2Result.logs,
      ];
      return pass2Result;
    }

    const parsed = parseInput(this.input, this.instrumentLibrary, this.parseOptions);
    this.stations = parsed.stations;
    this.observations = parsed.observations;
    this.unknowns = parsed.unknowns;
    this.instrumentLibrary = parsed.instrumentLibrary;
    this.logs = [...parsed.logs];
    this.directionRejectDiagnostics = parsed.directionRejectDiagnostics ?? [];
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
    this.preanalysisMode =
      parsed.parseState?.preanalysisMode ?? this.parseOptions?.preanalysisMode ?? false;
    this.robustMode = parsed.parseState?.robustMode ?? this.parseOptions?.robustMode ?? 'none';
    this.robustK = parsed.parseState?.robustK ?? this.parseOptions?.robustK ?? 1.5;
    if (this.preanalysisMode) {
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
    this.parseState = parsed.parseState;
    if (this.parseState) {
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
        this.parseState.gnssVectorFrameDefault ?? this.parseOptions?.gnssVectorFrameDefault ?? 'gridNEU';
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
      this.parseState.crsOffReason =
        this.coordSystemMode === 'grid' ? 'noCRSSelected' : undefined;
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
    this.stationCovariances = undefined;
    this.relativeCovariances = undefined;
    this.weakGeometryDiagnostics = undefined;
    this.conditionWarned = false;
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
        this.log('CRS area-of-use check: unavailable (no CRS bounds metadata or no geodetic stations).');
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
    if (this.parseState) {
      this.parseState.usedInSolveUsageSummary = summarizeReductionUsage(activeObservations);
      this.parseState.parsedUsageSummary =
        this.parseState.parsedUsageSummary ?? summarizeReductionUsage(this.observations);
    }
    const gridInputGate = this.evaluateGridInputGate(activeObservations);
    if (gridInputGate.blocked) {
      this.addCoordSystemDiagnostic('CRS_INPUT_MIX_BLOCKED');
      if (
        gridInputGate.reasons.some((reason) =>
          reason.toUpperCase().includes('UNKNOWN FRAME'),
        )
      ) {
        this.addCoordSystemDiagnostic('GNSS_FRAME_UNCONFIRMED');
      }
      gridInputGate.reasons.forEach((reason) => this.log(`Error: ${reason}`));
      gridInputGate.suggestions.forEach((suggestion) =>
        this.log(`Suggestion: ${suggestion}`),
      );
      this.datumSufficiencyReport = {
        status: 'hard-fail',
        reasons: [...gridInputGate.reasons],
        suggestions: [...gridInputGate.suggestions],
      };
      if (this.parseState) {
        this.parseState.datumSufficiencyReport = this.datumSufficiencyReport;
      }
      return this.buildResult();
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
      return this.buildResult();
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
        (obs): obs is GpsObservation =>
          obs.type === 'gps' && obs.gpsMode !== 'sideshot',
      );
      this.gpsLoopDiagnostics = this.computeGpsLoopDiagnostics(gpsNetworkRows);
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
      this.levelingLoopDiagnostics = this.computeLevelingLoopDiagnostics(levelingRows);
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
      return this.buildResult();
    }

    const gpsSideshotCount = this.observations.filter(
      (obs) => obs.type === 'gps' && obs.gpsMode === 'sideshot',
    ).length;
    if (gpsSideshotCount > 0) {
      this.log(
        `GPS sideshot vectors excluded from adjustment equations: ${gpsSideshotCount} (post-adjust output only).`,
      );
    }
    const hasVertical: Record<StationId, boolean> = {};
    if (!this.is2D) {
      const markVertical = (id?: StationId) => {
        if (!id) return;
        hasVertical[id] = true;
      };
      activeObservations.forEach((obs) => {
        if (obs.type === 'lev' || obs.type === 'zenith') {
          markVertical(obs.from);
          markVertical(obs.to);
          return;
        }
        if (obs.type === 'dist' && obs.mode === 'slope') {
          markVertical(obs.from);
          markVertical(obs.to);
        }
      });
    }

    if (!this.is2D) {
      const autoDropped: StationId[] = [];
      this.unknowns.forEach((id) => {
        const st = this.stations[id];
        if (!st) return;
        if (st.fixedH) return;
        if (hasVertical[id]) return;
        st.fixedH = true;
        const fx = st.fixedX ?? false;
        const fy = st.fixedY ?? false;
        st.fixed = fx && fy && st.fixedH;
        autoDropped.push(id);
      });
      if (autoDropped.length) {
        this.log(
          `Auto-drop H for stations with no vertical observations: ${autoDropped.join(', ')}`,
        );
      }
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

    const directionSetIds = Array.from(
      new Set(
        activeObservations
          .filter((o) => o.type === 'direction')
          .map((o) => (o as any).setId as string),
      ),
    );
    this.directionOrientations = {};
    this.computeDirectionSetPrefit(activeObservations, directionSetIds);

    this.paramIndex = {};
    let stationParamCount = 0;
    this.unknowns.forEach((id) => {
      const st = this.stations[id];
      if (!st) return;
      const idx: { x?: number; y?: number; h?: number } = {};
      if (!st.fixedX) {
        idx.x = stationParamCount;
        stationParamCount += 1;
      }
      if (!st.fixedY) {
        idx.y = stationParamCount;
        stationParamCount += 1;
      }
      if (!this.is2D && !st.fixedH) {
        idx.h = stationParamCount;
        stationParamCount += 1;
      }
      if (idx.x != null || idx.y != null || idx.h != null) {
        this.paramIndex[id] = idx;
      }
    });
    const constraints = this.buildCoordinateConstraints(this.paramIndex);
    this.controlConstraints = this.summarizeConstraints(constraints);
    if (constraints.length) {
      this.log(
        `Weighted control constraints: ${constraints.length} (E=${this.controlConstraints.x}, N=${this.controlConstraints.y}, H=${this.controlConstraints.h}, corrXY=${this.controlConstraints.xyCorrelated ?? 0})`,
      );
    }
    const numParams = stationParamCount + directionSetIds.length; // X, Y (+H) + dir orientations
    const numObsEquations =
      activeObservations.reduce((acc, o) => acc + (o.type === 'gps' ? 2 : 1), 0) +
      constraints.length;

    this.dof = numObsEquations - numParams;
    if (this.dof < 0) {
      this.log('Error: Redundancy < 0. Under-determined.');
      return this.buildResult();
    }

    const dirParamMap: Record<string, number> = {};
    directionSetIds.forEach((id, idx) => {
      dirParamMap[id] = stationParamCount + idx;
    });
    let prevObjectiveBefore: number | null = null;

    for (let iter = 0; iter < this.maxIterations; iter++) {
      this.iterations += 1;
      this.clearGeometryCache();

      const A = zeros(numObsEquations, numParams);
      const L = zeros(numObsEquations, 1);
      const P = zeros(numObsEquations, numObsEquations);
      const rowInfo: EquationRowInfo[] = [];

      let row = 0;

      activeObservations.forEach((obs) => {
        if (obs.type === 'dist') {
          const { from, to } = obs;
          const s1 = this.stations[from];
          const s2 = this.stations[to];
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
          const observed2dDistance = this.getObservedHorizontalDistanceIn2D(obs);
          const observedDistance = observed2dDistance.observedDistance;
          const v = observedDistance - calcDist;

          L[row][0] = v;
          rowInfo.push({ obs });
          if (this.debug) {
            const sigmaUsed = observed2dDistance.sigmaDistance;
            const wRad = v;
            const norm = sigmaUsed ? wRad / sigmaUsed : 0;
            this.logObsDebug(
              iter + 1,
              `DIST#${obs.id}`,
              `from=${from} to=${to} obs=${observedDistance.toFixed(4)}m calc=${calcDist.toFixed(
                4,
              )}m w=${wRad.toFixed(6)}m norm=${norm.toFixed(3)} sigma=${sigmaUsed.toFixed(6)}m mode=${obs.mode}${this.is2D && observed2dDistance.usedZenith ? ' 2D-reduced' : ''} prism=${corrected.prismCorrection.toFixed(4)}m`,
            );
          }
          const denom = calcDistRaw || 1;
          const dD_dE2 = (dx / denom) * corrected.mapScale;
          const dD_dN2 = (dy / denom) * corrected.mapScale;
          const dD_dH2 = !this.is2D && obs.mode === 'slope' ? (dz / denom) * corrected.mapScale : 0;

          const fromIdx = this.paramIndex[from];
          if (fromIdx?.x != null) {
            A[row][fromIdx.x] = -dD_dE2;
          }
          if (fromIdx?.y != null) {
            A[row][fromIdx.y] = -dD_dN2;
          }
          if (!this.is2D && fromIdx?.h != null) {
            A[row][fromIdx.h] = -dD_dH2;
          }
          const toIdx = this.paramIndex[to];
          if (toIdx?.x != null) {
            A[row][toIdx.x] = dD_dE2;
          }
          if (toIdx?.y != null) {
            A[row][toIdx.y] = dD_dN2;
          }
          if (!this.is2D && toIdx?.h != null) {
            A[row][toIdx.h] = dD_dH2;
          }

          const sigma = observed2dDistance.sigmaDistance;
          const w = 1.0 / (sigma * sigma);
          P[row][row] = w;

          row += 1;
        } else if (obs.type === 'angle') {
          const { at, from, to } = obs;
          if (!this.stations[at] || !this.stations[from] || !this.stations[to]) return;
          const azTo = this.getAzimuth(at, to);
          const azFrom = this.getAzimuth(at, from);
          let calcAngle = azTo.az - azFrom.az;
          if (obs.gridObsMode !== 'grid') {
            calcAngle += this.measuredAngleCorrection(at, from, to);
          }
          if (calcAngle < 0) calcAngle += 2 * Math.PI;
          let diff = obs.obs - calcAngle;
          diff = this.wrapToPi(diff);
          L[row][0] = diff;
          rowInfo.push({ obs });
          if (this.debug) {
            const sigmaUsed = this.effectiveStdDev(obs);
            const wRad = diff;
            const wDeg = wRad * RAD_TO_DEG;
            const norm = sigmaUsed ? wRad / sigmaUsed : 0;
            this.logObsDebug(
              iter + 1,
              `ANGLE#${obs.id}`,
              `at=${at} from=${from} to=${to} obs=${(obs.obs * RAD_TO_DEG).toFixed(
                6,
              )}°/${obs.obs.toFixed(6)}rad azTo=${(azTo.az * RAD_TO_DEG).toFixed(6)}° azFrom=${(
                azFrom.az * RAD_TO_DEG
              ).toFixed(6)}° calc=${(calcAngle * RAD_TO_DEG).toFixed(6)}° w=${wDeg.toFixed(
                6,
              )}°/${wRad.toFixed(8)}rad norm=${norm.toFixed(3)} sigma=${sigmaUsed.toFixed(8)}rad`,
            );
          }

          const dAzTo_dE_To = Math.cos(azTo.az) / (azTo.dist || 1);
          const dAzTo_dN_To = -Math.sin(azTo.az) / (azTo.dist || 1);
          const dAzFrom_dE_From = Math.cos(azFrom.az) / (azFrom.dist || 1);
          const dAzFrom_dN_From = -Math.sin(azFrom.az) / (azFrom.dist || 1);

          const toIdx = this.paramIndex[to];
          if (toIdx?.x != null) {
            A[row][toIdx.x] = dAzTo_dE_To;
          }
          if (toIdx?.y != null) {
            A[row][toIdx.y] = dAzTo_dN_To;
          }
          const fromIdx = this.paramIndex[from];
          if (fromIdx?.x != null) {
            A[row][fromIdx.x] = -dAzFrom_dE_From;
          }
          if (fromIdx?.y != null) {
            A[row][fromIdx.y] = -dAzFrom_dN_From;
          }
          const atIdx = this.paramIndex[at];
          if (atIdx?.x != null || atIdx?.y != null) {
            const dAzTo_dE_At = -dAzTo_dE_To;
            const dAzTo_dN_At = -dAzTo_dN_To;
            const dAzFrom_dE_At = -dAzFrom_dE_From;
            const dAzFrom_dN_At = -dAzFrom_dN_From;
            if (atIdx?.x != null) {
              A[row][atIdx.x] = dAzTo_dE_At - dAzFrom_dE_At;
            }
            if (atIdx?.y != null) {
              A[row][atIdx.y] = dAzTo_dN_At - dAzFrom_dN_At;
            }
          }

          const sigma = this.effectiveStdDev(obs);
          const w = 1.0 / (sigma * sigma);
          P[row][row] = w;

          row += 1;
        } else if (obs.type === 'gps') {
          const { from, to } = obs;
          const s1 = this.stations[from];
          const s2 = this.stations[to];
          if (!s1 || !s2) return;

          const corrected = this.gpsObservedVector(obs);
          const calc_dE = s2.x - s1.x;
          const calc_dN = s2.y - s1.y;
          const vE = corrected.dE - calc_dE;
          const vN = corrected.dN - calc_dN;

          L[row][0] = vE;
          rowInfo.push({ obs, component: 'E' });
          const fromIdx = this.paramIndex[from];
          if (fromIdx?.x != null) {
            A[row][fromIdx.x] = -1.0;
          }
          const toIdx = this.paramIndex[to];
          if (toIdx?.x != null) {
            A[row][toIdx.x] = 1.0;
          }
          {
            const w = this.gpsWeight(obs);
            P[row][row] = w.wEE;
            P[row][row + 1] = w.wEN;
            P[row + 1][row] = w.wEN;
            P[row + 1][row + 1] = w.wNN;
          }

          L[row + 1][0] = vN;
          rowInfo.push({ obs, component: 'N' });
          if (fromIdx?.y != null) {
            A[row + 1][fromIdx.y] = -1.0;
          }
          if (toIdx?.y != null) {
            A[row + 1][toIdx.y] = 1.0;
          }

          row += 2;
        } else if (obs.type === 'lev') {
          const { from, to } = obs;
          const s1 = this.stations[from];
          const s2 = this.stations[to];
          if (!s1 || !s2) return;

          const calc_dH = s2.h - s1.h;
          const v = obs.obs - calc_dH;
          L[row][0] = v;
          rowInfo.push({ obs });

          const fromIdx = this.paramIndex[from];
          if (fromIdx?.h != null) {
            A[row][fromIdx.h] = -1.0;
          }
          const toIdx = this.paramIndex[to];
          if (toIdx?.h != null) {
            A[row][toIdx.h] = 1.0;
          }

          const sigma = this.effectiveStdDev(obs);
          const w = 1.0 / (sigma * sigma);
          P[row][row] = w;

          row += 1;
        } else if (obs.type === 'bearing') {
          const { from, to } = obs;
          const az = this.getAzimuth(from, to);
          const calc = this.modeledAzimuth(az.az, from, obs.gridObsMode !== 'grid');
          let v = obs.obs - calc;
          if (v > Math.PI) v -= 2 * Math.PI;
          if (v < -Math.PI) v += 2 * Math.PI;
          L[row][0] = v;
          rowInfo.push({ obs });

          const dAz_dE_To = Math.cos(az.az) / (az.dist || 1);
          const dAz_dN_To = -Math.sin(az.az) / (az.dist || 1);

          const toIdx = this.paramIndex[to];
          if (toIdx?.x != null) {
            A[row][toIdx.x] = dAz_dE_To;
          }
          if (toIdx?.y != null) {
            A[row][toIdx.y] = dAz_dN_To;
          }
          const fromIdx = this.paramIndex[from];
          if (fromIdx?.x != null) {
            A[row][fromIdx.x] = -dAz_dE_To;
          }
          if (fromIdx?.y != null) {
            A[row][fromIdx.y] = -dAz_dN_To;
          }

          const sigma = this.effectiveStdDev(obs);
          const w = 1.0 / (sigma * sigma);
          P[row][row] = w;

          row += 1;
        } else if (obs.type === 'dir') {
          const { from, to } = obs;
          const az = this.getAzimuth(from, to);
          const calc = this.modeledAzimuth(az.az, from, obs.gridObsMode !== 'grid');
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
          if (this.debug) {
            const sigmaUsed = this.effectiveStdDev(obs);
            const wRad = v;
            const wDeg = wRad * RAD_TO_DEG;
            const norm = sigmaUsed ? wRad / sigmaUsed : 0;
            this.logObsDebug(
              iter + 1,
              `DIRAZ#${obs.id}`,
              `from=${from} to=${to} obs=${(obs.obs * RAD_TO_DEG).toFixed(6)}°/${obs.obs.toFixed(
                6,
              )}rad calc=${(calc * RAD_TO_DEG).toFixed(6)}° w=${wDeg.toFixed(
                6,
              )}°/${wRad.toFixed(8)}rad norm=${norm.toFixed(3)} sigma=${sigmaUsed.toFixed(8)}rad`,
            );
          }

          const dAz_dE_To = Math.cos(az.az) / (az.dist || 1);
          const dAz_dN_To = -Math.sin(az.az) / (az.dist || 1);

          const toIdx = this.paramIndex[to];
          if (toIdx?.x != null) {
            A[row][toIdx.x] = dAz_dE_To;
          }
          if (toIdx?.y != null) {
            A[row][toIdx.y] = dAz_dN_To;
          }
          const fromIdx = this.paramIndex[from];
          if (fromIdx?.x != null) {
            A[row][fromIdx.x] = -dAz_dE_To;
          }
          if (fromIdx?.y != null) {
            A[row][fromIdx.y] = -dAz_dN_To;
          }

          const sigma = this.effectiveStdDev(obs);
          const w = 1.0 / (sigma * sigma);
          P[row][row] = w;

          row += 1;
        } else if (obs.type === 'direction') {
          const { at, to, setId } = obs as any;
          if (!this.stations[at] || !this.stations[to]) return;
          const az = this.getAzimuth(at, to);
          const orientation = this.directionOrientations[setId] ?? 0;
          let calc = orientation + this.modeledAzimuth(az.az, at, obs.gridObsMode !== 'grid');
          calc %= 2 * Math.PI;
          if (calc < 0) calc += 2 * Math.PI;
          let v = obs.obs - calc;
          v = this.wrapToPi(v);
          L[row][0] = v;
          rowInfo.push({ obs });
          if (this.debug) {
            const sigmaUsed = this.effectiveStdDev(obs);
            const wRad = v;
            const wDeg = wRad * RAD_TO_DEG;
            const norm = sigmaUsed ? wRad / sigmaUsed : 0;
            this.logObsDebug(
              iter + 1,
              `DIR#${obs.id}`,
              `at=${at} to=${to} set=${setId} obs=${(obs.obs * RAD_TO_DEG).toFixed(
                6,
              )}°/${obs.obs.toFixed(6)}rad az=${(az.az * RAD_TO_DEG).toFixed(
                6,
              )}° orient=${(orientation * RAD_TO_DEG).toFixed(6)}° calc=${(
                calc * RAD_TO_DEG
              ).toFixed(6)}° w=${wDeg.toFixed(6)}°/${wRad.toFixed(
                8,
              )}rad norm=${norm.toFixed(3)} sigma=${sigmaUsed.toFixed(8)}rad`,
            );
          }

          const dAz_dE_To = Math.cos(az.az) / (az.dist || 1);
          const dAz_dN_To = -Math.sin(az.az) / (az.dist || 1);

          const toIdx = this.paramIndex[to];
          if (toIdx?.x != null) {
            A[row][toIdx.x] = dAz_dE_To;
          }
          if (toIdx?.y != null) {
            A[row][toIdx.y] = dAz_dN_To;
          }
          const atIdx = this.paramIndex[at];
          if (atIdx?.x != null) {
            A[row][atIdx.x] = -dAz_dE_To;
          }
          if (atIdx?.y != null) {
            A[row][atIdx.y] = -dAz_dN_To;
          }

          const dirIdx = dirParamMap[setId];
          if (dirIdx != null) {
            A[row][dirIdx] = 1;
          }

          const sigma = this.effectiveStdDev(obs);
          const w = 1.0 / (sigma * sigma);
          P[row][row] = w;

          row += 1;
        } else if (obs.type === 'zenith') {
          const { from, to } = obs;
          if (!this.stations[from] || !this.stations[to]) return;
          const zv = this.getZenith(from, to, obs.hi ?? 0, obs.ht ?? 0);
          const calc = zv.z;
          let v = obs.obs - calc;
          v = this.wrapToPi(v);
          L[row][0] = v;
          rowInfo.push({ obs });
          if (this.debug) {
            const sigmaUsed = this.effectiveStdDev(obs);
            const wRad = v;
            const wDeg = wRad * RAD_TO_DEG;
            const norm = sigmaUsed ? wRad / sigmaUsed : 0;
            this.logObsDebug(
              iter + 1,
              `ZEN#${obs.id}`,
              `from=${from} to=${to} obs=${(obs.obs * RAD_TO_DEG).toFixed(6)}°/${obs.obs.toFixed(
                6,
              )}rad calc=${(calc * RAD_TO_DEG).toFixed(6)}° w=${wDeg.toFixed(
                6,
              )}°/${wRad.toFixed(8)}rad norm=${norm.toFixed(3)} sigma=${sigmaUsed.toFixed(8)}rad cr=${(
                zv.crCorr *
                RAD_TO_DEG *
                3600
              ).toFixed(2)}"`,
            );
          }

          const denom = Math.sqrt(
            Math.max(1 - (zv.dist === 0 ? 0 : (zv.dh / zv.dist) ** 2), 1e-12),
          );
          const common = zv.dist === 0 ? 0 : 1 / (zv.dist * zv.dist * zv.dist * denom);
          const dx = this.stations[to].x - this.stations[from].x;
          const dy = this.stations[to].y - this.stations[from].y;
          const dZ_dEGeom = zv.dh * dx * common;
          const dZ_dNGeom = zv.dh * dy * common;
          const dC_dHoriz = this.curvatureRefractionAngle(1);
          const dHoriz_dE = zv.horiz > 0 ? dx / zv.horiz : 0;
          const dHoriz_dN = zv.horiz > 0 ? dy / zv.horiz : 0;
          const dZ_dE = dZ_dEGeom + dC_dHoriz * dHoriz_dE;
          const dZ_dN = dZ_dNGeom + dC_dHoriz * dHoriz_dN;
          const dZ_dH = -(zv.horiz * zv.horiz) * common;

          const toIdx = this.paramIndex[to];
          if (toIdx?.x != null) {
            A[row][toIdx.x] = dZ_dE;
          }
          if (toIdx?.y != null) {
            A[row][toIdx.y] = dZ_dN;
          }
          if (toIdx?.h != null) {
            A[row][toIdx.h] = dZ_dH;
          }
          const fromIdx = this.paramIndex[from];
          if (fromIdx?.x != null) {
            A[row][fromIdx.x] = -dZ_dE;
          }
          if (fromIdx?.y != null) {
            A[row][fromIdx.y] = -dZ_dN;
          }
          if (fromIdx?.h != null) {
            A[row][fromIdx.h] = -dZ_dH;
          }

          const sigma = this.effectiveStdDev(obs);
          const w = 1.0 / (sigma * sigma);
          P[row][row] = w;

          row += 1;
        }
      });

      const constraintPlacements: CoordinateConstraintRowPlacement[] = [];
      constraints.forEach((constraint) => {
        const st = this.stations[constraint.stationId];
        if (!st) return;
        const current =
          constraint.component === 'x' ? st.x : constraint.component === 'y' ? st.y : st.h;
        const v = constraint.target - current;
        L[row][0] = v;
        A[row][constraint.index] = 1;
        P[row][row] = 1 / (constraint.sigma * constraint.sigma);
        rowInfo.push(null);
        constraintPlacements.push({ row, constraint });
        row += 1;
      });
      this.applyCoordinateConstraintCorrelationWeights(P, constraintPlacements);

      this.applyTsCorrelationToWeightMatrix(P, rowInfo);

      try {
        const AT = transpose(A);
        let X: number[][] = zeros(numParams, 1);
        let solvedP = P;
        if (this.robustMode === 'huber') {
          const baseWeights = this.captureRobustWeightBase(P, rowInfo);
          let factors = new Array(P.length).fill(1);
          let finalSummary: RobustWeightSummary | null = null;
          const maxInnerIterations = 5;
          const weightTolerance = 1e-3;
          for (let inner = 0; inner < maxInnerIterations; inner += 1) {
            this.applyRobustWeightFactors(P, baseWeights, factors);
            solvedP = P;
            const ATP = multiply(AT, solvedP);
            const N = multiply(ATP, A);
            const conditionEstimate = this.estimateCondition(N);
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
            const U = multiply(ATP, L);
            const normalSolution = this.solveNormalEquations(N, U);
            X = normalSolution.correction;
            this.Qxx = normalSolution.qxx;
            const AX = multiply(A, X);
            const residuals = AX.map((rowValue, i) => rowValue[0] - L[i][0]);
            finalSummary = this.computeRobustWeightSummary(residuals, rowInfo);
            if (this.maxRobustWeightDelta(factors, finalSummary.factors) < weightTolerance) {
              break;
            }
            factors = finalSummary.factors.slice();
          }
          if (finalSummary) {
            this.recordRobustDiagnostics(iter + 1, finalSummary);
          }
        } else {
          const ATP = multiply(AT, P);
          const N = multiply(ATP, A);
          const conditionEstimate = this.estimateCondition(N);
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
          const U = multiply(ATP, L);
          const normalSolution = this.solveNormalEquations(N, U);
          X = normalSolution.correction;
          this.Qxx = normalSolution.qxx;
        }

        const AX = multiply(A, X);
        const Vnew = zeros(numObsEquations, 1);
        let maxBefore = 0;
        let maxAfter = 0;
        for (let i = 0; i < numObsEquations; i += 1) {
          const v0 = L[i][0];
          const v1 = v0 - AX[i][0];
          Vnew[i][0] = v1;
          maxBefore = Math.max(maxBefore, Math.abs(v0));
          maxAfter = Math.max(maxAfter, Math.abs(v1));
        }
        const sumBefore = this.weightedQuadratic(solvedP, L);
        const sumAfter = this.weightedQuadratic(solvedP, Vnew);
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

        let maxCorrection = 0;
        Object.entries(this.paramIndex).forEach(([id, idx]) => {
          const st = this.stations[id];
          if (!st) return;
          if (idx.x != null) {
            const dE = X[idx.x][0];
            st.x += dE;
            maxCorrection = Math.max(maxCorrection, Math.abs(dE));
          }
          if (idx.y != null) {
            const dN = X[idx.y][0];
            st.y += dN;
            maxCorrection = Math.max(maxCorrection, Math.abs(dN));
          }
          if (!this.is2D && idx.h != null) {
            const dH = X[idx.h][0];
            st.h += dH;
            maxCorrection = Math.max(maxCorrection, Math.abs(dH));
          }
        });

        directionSetIds.forEach((id) => {
          const idx = dirParamMap[id];
          if (idx == null) return;
          const dOri = X[idx][0];
          const next = (this.directionOrientations[id] ?? 0) + dOri;
          let wrapped = next % (2 * Math.PI);
          if (wrapped < 0) wrapped += 2 * Math.PI;
          this.directionOrientations[id] = wrapped;
          maxCorrection = Math.max(maxCorrection, Math.abs(dOri));
        });

        this.log(`Iter ${iter + 1}: Max Corr = ${maxCorrection.toFixed(4)}`);
        this.log(
          `Iter ${iter + 1}: vTPv before=${sumBefore.toExponential(6)} after=${sumAfter.toExponential(
            6,
          )} delta(within)=${objectiveDeltaWithinIter.toExponential(6)} delta(iter)=${objectiveDeltaBetweenIterations.toExponential(6)} delta(rel)=${objectiveDeltaRelative.toExponential(6)}`,
        );
        if (
          prevObjectiveBefore != null &&
          objectiveDeltaRelative < this.convergenceThreshold
        ) {
          this.log(
            `Converged: relative iteration objective delta ${objectiveDeltaRelative.toExponential(6)} < limit ${this.convergenceThreshold.toExponential(6)}`,
          );
          this.converged = true;
          break;
        }
        prevObjectiveBefore = sumBefore;
      } catch (error) {
        const detail = error instanceof Error ? ` ${error.message}` : '';
        this.log(`Normal equation solve failed (singular or otherwise unstable).${detail}`);
        this.calculateStatistics(this.paramIndex, false, activeObservations);
        return this.buildResult();
      }
    }

    if (!this.converged) this.log('Warning: Max iterations reached.');
    this.calculateStatistics(this.paramIndex, !!this.Qxx, activeObservations);
    return this.buildResult();
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
        occupy: StationId;
        orientation: number;
      }
    >();
    const activeObservations = activeObservationsInput ?? this.collectActiveObservations();
    const constraints = this.buildCoordinateConstraints(paramIndex);
    const tsCorrelationRows = new Map<
      string,
      {
        station: StationId;
        setId?: string;
        rows: Array<{ v: number; sigma: number; groupLabel: string }>;
      }
    >();
    const groupOrder = ['Angles', 'Directions', 'Distances', 'GPS', 'Leveling', 'Zenith'];
    const summarizeGroup = (obs: Observation): string => {
      if (obs.type === 'angle') return 'Angles';
      if (obs.type === 'direction' || obs.type === 'dir' || obs.type === 'bearing')
        return 'Directions';
      if (obs.type === 'dist') return 'Distances';
      if (obs.type === 'gps') return 'GPS';
      if (obs.type === 'lev') return 'Leveling';
      if (obs.type === 'zenith') return 'Zenith';
      return 'Other';
    };
    const diagnosticRedundancyValue = (obs: Observation): number | undefined => {
      if (typeof obs.redundancy === 'number') {
        return Number.isFinite(obs.redundancy) ? obs.redundancy : undefined;
      }
      if (obs.redundancy && typeof obs.redundancy === 'object') {
        const vals = [obs.redundancy.rE, obs.redundancy.rN].filter((v) => Number.isFinite(v));
        if (vals.length > 0) return Math.min(...vals);
      }
      return undefined;
    };
    const weightedByGroup = new Map<string, { count: number; sumSquares: number }>();
    const ensureGroup = (label: string): { count: number; sumSquares: number } => {
      const existing = weightedByGroup.get(label);
      if (existing) return existing;
      const init = { count: 0, sumSquares: 0 };
      weightedByGroup.set(label, init);
      return init;
    };
    const addObservationContribution = (obs: Observation, contribution: number) => {
      const label = summarizeGroup(obs);
      const row = ensureGroup(label);
      row.count += 1;
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
        const s1 = this.stations[obs.from];
        const s2 = this.stations[obs.to];
        if (!s1 || !s2) return;
        const corrected = this.gpsObservedVector(obs);
        const calc_dE = s2.x - s1.x;
        const calc_dN = s2.y - s1.y;
        const vE = corrected.dE - calc_dE;
        const vN = corrected.dN - calc_dN;
        obs.calc = { dE: calc_dE, dN: calc_dN };
        obs.residual = { vE, vN };
        const w = this.gpsWeight(obs);
        const quad = w.wEE * vE * vE + 2 * w.wEN * vE * vN + w.wNN * vN * vN;
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
        stat.occupy = dir.at ?? stat.occupy;
        stat.orientation = orientation;
        directionStats.set(setId, stat);
      } else if (obs.type === 'zenith') {
        obs.effectiveDistance = this.effectiveDistanceForAngularObservation(obs);
        const zv = this.getZenith(obs.from, obs.to, obs.hi ?? 0, obs.ht ?? 0).z;
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

    vtpv += this.coordinateConstraintWeightedSum(constraints);

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
      const alpha = 0.05;
      const lower = chiSquareQuantile(alpha / 2, this.dof);
      const upper = chiSquareQuantile(1 - alpha / 2, this.dof);
      const pUpper = chiSquarePValue(vtpv, this.dof);
      const pLower = 1 - pUpper;
      const pTwo = Math.max(0, Math.min(1, 2 * Math.min(pUpper, pLower)));
      const varianceFactor = vtpv / this.dof;
      this.chiSquare = {
        T: vtpv,
        dof: this.dof,
        p: pTwo,
        pass95: vtpv >= lower && vtpv <= upper,
        alpha,
        lower,
        upper,
        varianceFactor,
        varianceFactorLower: lower / this.dof,
        varianceFactorUpper: upper / this.dof,
      };
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
        activeObservations.reduce((acc, o) => acc + (o.type === 'gps' ? 2 : 1), 0) +
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
            const dD_dE2 = (dx / denom) * corrected.mapScale;
            const dD_dN2 = (dy / denom) * corrected.mapScale;
            const dD_dH2 =
              !this.is2D && obs.mode === 'slope' ? (dz / denom) * corrected.mapScale : 0;

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
            const zv = this.getZenith(obs.from, obs.to, obs.hi ?? 0, obs.ht ?? 0);
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
            const dx = this.stations[obs.to].x - this.stations[obs.from].x;
            const dy = this.stations[obs.to].y - this.stations[obs.from].y;
            const dZ_dEGeom = zv.dh * dx * common;
            const dZ_dNGeom = zv.dh * dy * common;
            const dC_dHoriz = this.curvatureRefractionAngle(1);
            const dHoriz_dE = zv.horiz > 0 ? dx / zv.horiz : 0;
            const dHoriz_dN = zv.horiz > 0 ? dy / zv.horiz : 0;
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
        this.applyCoordinateConstraintCorrelationWeights(P, constraintPlacements);

        this.applyTsCorrelationToWeightMatrix(P, rowInfo, true);
        if (!this.preanalysisMode && this.robustMode === 'huber') {
          const baseWeights = this.captureRobustWeightBase(P, rowInfo);
          const residuals = L.map((row) => -row[0]);
          const summary = this.computeRobustWeightSummary(residuals, rowInfo);
          this.applyRobustWeightFactors(P, baseWeights, summary.factors);
        }

        if (!this.preanalysisMode) {
          try {
            const AT = transpose(A);
            const N = multiply(multiply(AT, P), A);
            const QxxStats = this.invertNormalMatrixForStats(N);
            const B = multiply(A, QxxStats);
            const rowStats = new Map<
              number,
              {
                t: number[];
                r: number[];
                mdb: number[];
                pass: boolean[];
                comps: ('E' | 'N' | undefined)[];
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
                qll = info.component === 'N' ? cov.cNN : cov.cEE;
              }
              let diag = 0;
              for (let j = 0; j < numParams; j += 1) {
                diag += B[i][j] * A[i][j];
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
              };
              entry.t.push(t);
              entry.r.push(r);
              entry.mdb.push(mdb);
              entry.pass.push(pass);
              entry.comps.push(info.component);
              rowStats.set(info.obs.id, entry);
            }

            activeObservations.forEach((obs) => {
              const entry = rowStats.get(obs.id);
              if (!entry) return;
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
      const rows = Array.from(weightedByGroup.entries())
        .map(([label, row]) => ({
          label,
          count: row.count,
          sumSquares: row.sumSquares,
          errorFactor: row.count > 0 ? Math.sqrt(Math.max(row.sumSquares, 0) / row.count) : 0,
        }))
        .sort((a, b) => {
          const ai = groupOrder.indexOf(a.label);
          const bi = groupOrder.indexOf(b.label);
          const ao = ai >= 0 ? ai : Number.MAX_SAFE_INTEGER;
          const bo = bi >= 0 ? bi : Number.MAX_SAFE_INTEGER;
          if (ao !== bo) return ao - bo;
          return a.label.localeCompare(b.label);
        });
      const totalCount = rows.reduce((sum, r) => sum + r.count, 0);
      const totalSumSquares = rows.reduce((sum, r) => sum + r.sumSquares, 0);
      const scaleToGlobalDof =
        this.dof > 0 && totalCount > 0 ? Math.sqrt(totalCount / this.dof) : 1;
      const byGroup = rows.map((row) => ({
        ...row,
        errorFactor: row.errorFactor * scaleToGlobalDof,
      }));
      this.statisticalSummary = {
        byGroup,
        totalCount,
        totalSumSquares,
        totalErrorFactorByCount:
          totalCount > 0 ? Math.sqrt(Math.max(totalSumSquares, 0) / totalCount) : 0,
        totalErrorFactorByDof:
          this.dof > 0 ? Math.sqrt(Math.max(totalSumSquares, 0) / this.dof) : 0,
      };
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
      const stationLabel = (obs: Observation): string => {
        if (obs.type === 'angle') return `${obs.at}-${obs.from}-${obs.to}`;
        if (obs.type === 'direction') return `${obs.at}-${obs.to}`;
        if (
          obs.type === 'dist' ||
          obs.type === 'bearing' ||
          obs.type === 'dir' ||
          obs.type === 'gps' ||
          obs.type === 'lev' ||
          obs.type === 'zenith'
        ) {
          return `${obs.from}-${obs.to}`;
        }
        return '-';
      };

      const withStd = activeObservations.filter((o) => Number.isFinite(o.stdRes));
      const over2 = withStd.filter((o) => Math.abs(o.stdRes ?? 0) > 2).length;
      const over3 = withStd.filter((o) => Math.abs(o.stdRes ?? 0) > 3).length;
      const over4 = withStd.filter((o) => Math.abs(o.stdRes ?? 0) > 4).length;
      const localFailCount = activeObservations.filter(
        (o) => o.localTest != null && !o.localTest.pass,
      ).length;

      const redundancies = activeObservations
        .map((o) => diagnosticRedundancyValue(o))
        .filter((v): v is number => v != null && Number.isFinite(v));
      const meanRedundancy =
        redundancies.length > 0
          ? redundancies.reduce((acc, v) => acc + v, 0) / redundancies.length
          : undefined;
      const minRedundancy = redundancies.length > 0 ? Math.min(...redundancies) : undefined;
      const lowRedundancyCount = redundancies.filter((v) => v < 0.2).length;
      const veryLowRedundancyCount = redundancies.filter((v) => v < 0.1).length;

      const worstObs = withStd
        .map((obs) => ({
          obs,
          stdRes: Math.abs(obs.stdRes ?? 0),
          redundancy: diagnosticRedundancyValue(obs),
          localPass: obs.localTest?.pass,
        }))
        .sort((a, b) => {
          if (b.stdRes !== a.stdRes) return b.stdRes - a.stdRes;
          if ((a.localPass === false ? 1 : 0) !== (b.localPass === false ? 1 : 0)) {
            return (b.localPass === false ? 1 : 0) - (a.localPass === false ? 1 : 0);
          }
          const ar = a.redundancy ?? Number.POSITIVE_INFINITY;
          const br = b.redundancy ?? Number.POSITIVE_INFINITY;
          if (ar !== br) return ar - br;
          return a.obs.id - b.obs.id;
        })[0];

      const byTypeMap = new Map<
        Observation['type'],
        {
          type: Observation['type'];
          count: number;
          withStdResCount: number;
          localFailCount: number;
          over3SigmaCount: number;
          maxStdRes?: number;
          redundancies: number[];
        }
      >();
      activeObservations.forEach((obs) => {
        const row = byTypeMap.get(obs.type) ?? {
          type: obs.type,
          count: 0,
          withStdResCount: 0,
          localFailCount: 0,
          over3SigmaCount: 0,
          maxStdRes: undefined,
          redundancies: [],
        };
        row.count += 1;
        if (Number.isFinite(obs.stdRes)) {
          row.withStdResCount += 1;
          row.maxStdRes = Math.max(row.maxStdRes ?? 0, Math.abs(obs.stdRes ?? 0));
          if (Math.abs(obs.stdRes ?? 0) > 3) row.over3SigmaCount += 1;
        }
        if (obs.localTest != null && !obs.localTest.pass) row.localFailCount += 1;
        const r = diagnosticRedundancyValue(obs);
        if (r != null && Number.isFinite(r)) row.redundancies.push(r);
        byTypeMap.set(obs.type, row);
      });
      const byType = Array.from(byTypeMap.values())
        .map((row) => ({
          type: row.type,
          count: row.count,
          withStdResCount: row.withStdResCount,
          localFailCount: row.localFailCount,
          over3SigmaCount: row.over3SigmaCount,
          maxStdRes: row.maxStdRes,
          meanRedundancy:
            row.redundancies.length > 0
              ? row.redundancies.reduce((acc, v) => acc + v, 0) / row.redundancies.length
              : undefined,
          minRedundancy: row.redundancies.length > 0 ? Math.min(...row.redundancies) : undefined,
        }))
        .sort((a, b) => {
          if (b.localFailCount !== a.localFailCount) return b.localFailCount - a.localFailCount;
          const bMax = b.maxStdRes ?? 0;
          const aMax = a.maxStdRes ?? 0;
          if (bMax !== aMax) return bMax - aMax;
          return String(a.type).localeCompare(String(b.type));
        });

      this.residualDiagnostics = {
        criticalT: this.localTestCritical,
        observationCount: activeObservations.length,
        withStdResCount: withStd.length,
        over2SigmaCount: over2,
        over3SigmaCount: over3,
        over4SigmaCount: over4,
        localFailCount,
        lowRedundancyCount,
        veryLowRedundancyCount,
        meanRedundancy,
        minRedundancy,
        maxStdRes:
          withStd.length > 0 ? Math.max(...withStd.map((o) => Math.abs(o.stdRes ?? 0))) : undefined,
        worst: worstObs
          ? {
              obsId: worstObs.obs.id,
              type: worstObs.obs.type,
              stations: stationLabel(worstObs.obs),
              sourceLine: worstObs.obs.sourceLine,
              stdRes: worstObs.stdRes,
              redundancy: worstObs.redundancy,
              localPass: worstObs.localPass,
            }
          : undefined,
        byType,
      };
      this.log(
        `Residual diagnostics: |t|>2=${over2}, |t|>3=${over3}, localFail=${localFailCount}, lowRedund(<0.2)=${lowRedundancyCount}.`,
      );
    }
    if (this.preanalysisMode) {
      this.log(
        'Preanalysis statistics: using a-priori variance factor 1.0 and skipping residual-based diagnostics.',
      );
    }

    const summary: Record<
      string,
      {
        count: number;
        sumSq: number;
        maxAbs: number;
        maxStdRes: number;
        over3: number;
        over4: number;
        unit: string;
      }
    > = {};
    const addSummary = (type: string, value: number, stdRes: number, unit: string) => {
      const entry =
        summary[type] ??
        ({ count: 0, sumSq: 0, maxAbs: 0, maxStdRes: 0, over3: 0, over4: 0, unit } as const);
      entry.count += 1;
      entry.sumSq += value * value;
      entry.maxAbs = Math.max(entry.maxAbs, Math.abs(value));
      entry.maxStdRes = Math.max(entry.maxStdRes, Math.abs(stdRes));
      if (Math.abs(stdRes) > 3) entry.over3 += 1;
      if (Math.abs(stdRes) > 4) entry.over4 += 1;
      summary[type] = entry as any;
    };
    activeObservations.forEach((obs) => {
      if (obs.residual == null) return;
      const stdRes = obs.stdRes ?? 0;
      if (
        obs.type === 'angle' ||
        obs.type === 'direction' ||
        obs.type === 'dir' ||
        obs.type === 'bearing' ||
        obs.type === 'zenith'
      ) {
        const arcsec = (obs.residual as number) * RAD_TO_DEG * 3600;
        addSummary(obs.type, arcsec, stdRes, 'arcsec');
      } else if (obs.type === 'dist' || obs.type === 'lev') {
        addSummary(obs.type, obs.residual as number, stdRes, 'm');
      } else if (obs.type === 'gps') {
        const v = obs.residual as { vE: number; vN: number };
        const mag = Math.hypot(v.vE, v.vN);
        addSummary(obs.type, mag, stdRes, 'm');
      }
    });
    const typeSummary: AdjustmentResult['typeSummary'] = {};
    Object.entries(summary).forEach(([type, entry]) => {
      const rms = entry.count ? Math.sqrt(entry.sumSq / entry.count) : 0;
      typeSummary[type] = {
        count: entry.count,
        rms,
        maxAbs: entry.maxAbs,
        maxStdRes: entry.maxStdRes,
        over3: entry.over3,
        over4: entry.over4,
        unit: entry.unit,
      };
    });
    this.typeSummary = typeSummary;

    if (hasQxx && this.Qxx) {
      const precisionScaleSq =
        this.dof > 0 && Number.isFinite(this.seuw) && this.seuw > 0 ? this.seuw * this.seuw : 1;
      if (this.dof <= 0) {
        this.log('DOF <= 0: using a-priori variance factor 1.0 for point precision scaling.');
      }
      const cov = (a?: number, b?: number): number => {
        if (a == null || b == null) return 0;
        if (!this.Qxx?.[a] || this.Qxx?.[a][b] == null) return 0;
        return this.Qxx[a][b] * precisionScaleSq;
      };
      const buildEllipse = (
        varE: number,
        varN: number,
        covEN: number,
      ): { ellipse: Station['errorEllipse']; semiMajor: number; semiMinor: number } => {
        const term1 = (varE + varN) / 2;
        const term2 = Math.sqrt(((varE - varN) / 2) ** 2 + covEN * covEN);
        const semiMajor = Math.sqrt(Math.abs(term1 + term2));
        const semiMinor = Math.sqrt(Math.abs(term1 - term2));
        const theta = 0.5 * Math.atan2(2 * covEN, varE - varN);
        return {
          ellipse: {
            semiMajor,
            semiMinor,
            theta: theta * RAD_TO_DEG,
          },
          semiMajor,
          semiMinor,
        };
      };
      const stationCovariances: NonNullable<AdjustmentResult['stationCovariances']> = [];
      this.unknowns.forEach((id) => {
        const idx = paramIndex[id];
        if (!idx) return;
        if (idx.x == null || idx.y == null) return;
        if (!this.Qxx?.[idx.x] || !this.Qxx?.[idx.y]) return;
        const varE = cov(idx.x, idx.x);
        const varN = cov(idx.y, idx.y);
        const covEN = cov(idx.x, idx.y);
        const ellipseSummary = buildEllipse(varE, varN, covEN);
        this.stations[id].errorEllipse = ellipseSummary.ellipse;
        this.stations[id].sE = Math.sqrt(Math.abs(varE));
        this.stations[id].sN = Math.sqrt(Math.abs(varN));
        const stationBlock: NonNullable<AdjustmentResult['stationCovariances']>[number] = {
          stationId: id,
          cEE: varE,
          cEN: covEN,
          cNN: varN,
          sigmaE: Math.sqrt(Math.abs(varE)),
          sigmaN: Math.sqrt(Math.abs(varN)),
          ellipse: ellipseSummary.ellipse,
        };
        if (!this.is2D && idx.h != null) {
          const varH = cov(idx.h, idx.h);
          const covEH = cov(idx.x, idx.h);
          const covNH = cov(idx.y, idx.h);
          this.stations[id].sH = Math.sqrt(Math.abs(varH));
          stationBlock.cEH = covEH;
          stationBlock.cNH = covNH;
          stationBlock.cHH = varH;
          stationBlock.sigmaH = Math.sqrt(Math.abs(varH));
        }
        stationCovariances.push(stationBlock);
      });
      this.stationCovariances = stationCovariances;

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

      const relative: NonNullable<AdjustmentResult['relativePrecision']> = [];
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
          const dist = Math.hypot(dE, dN);

          const varE =
            cov(idxTo?.x, idxTo?.x) + cov(idxFrom?.x, idxFrom?.x) - 2 * cov(idxFrom?.x, idxTo?.x);
          const varN =
            cov(idxTo?.y, idxTo?.y) + cov(idxFrom?.y, idxFrom?.y) - 2 * cov(idxFrom?.y, idxTo?.y);
          const covNE =
            cov(idxTo?.y, idxTo?.x) +
            cov(idxFrom?.y, idxFrom?.x) -
            cov(idxFrom?.y, idxTo?.x) -
            cov(idxTo?.y, idxFrom?.x);
          const ellipseSummary = buildEllipse(varE, varN, covNE);

          let sigmaDist: number | undefined;
          let sigmaAz: number | undefined;
          if (dist > 0) {
            const inv = 1 / (dist * dist);
            const varDist = inv * (dE * dE * varE + dN * dN * varN + 2 * dE * dN * covNE);
            sigmaDist = Math.sqrt(Math.abs(varDist));
            const varAz = (dN * dN * varE + dE * dE * varN - 2 * dE * dN * covNE) * inv * inv;
            sigmaAz = Math.sqrt(Math.abs(varAz));
          }

          relative.push({
            from,
            to,
            sigmaN: Math.sqrt(Math.abs(varN)),
            sigmaE: Math.sqrt(Math.abs(varE)),
            sigmaDist,
            sigmaAz,
            ellipse: ellipseSummary.ellipse,
          });
        }
      }
      this.relativePrecision = relative;

      const relativeCovariances: NonNullable<AdjustmentResult['relativeCovariances']> = [];
      connectedPairTypes.forEach((types, key) => {
        const [from, to] = key.split('|') as [StationId, StationId];
        const fromStation = this.stations[from];
        const toStation = this.stations[to];
        const idxFrom = paramIndex[from];
        const idxTo = paramIndex[to];
        if (!fromStation || !toStation || (!idxFrom && !idxTo)) return;

        const dE = toStation.x - fromStation.x;
        const dN = toStation.y - fromStation.y;
        const dist = Math.hypot(dE, dN);
        const varE =
          cov(idxTo?.x, idxTo?.x) + cov(idxFrom?.x, idxFrom?.x) - 2 * cov(idxFrom?.x, idxTo?.x);
        const varN =
          cov(idxTo?.y, idxTo?.y) + cov(idxFrom?.y, idxFrom?.y) - 2 * cov(idxFrom?.y, idxTo?.y);
        const covEN =
          cov(idxTo?.x, idxTo?.y) -
          cov(idxTo?.x, idxFrom?.y) -
          cov(idxFrom?.x, idxTo?.y) +
          cov(idxFrom?.x, idxFrom?.y);
        const ellipseSummary = buildEllipse(varE, varN, covEN);

        let sigmaDist: number | undefined;
        let sigmaAz: number | undefined;
        if (dist > 0) {
          const inv = 1 / (dist * dist);
          const varDist = inv * (dE * dE * varE + dN * dN * varN + 2 * dE * dN * covEN);
          sigmaDist = Math.sqrt(Math.abs(varDist));
          const varAz = (dN * dN * varE + dE * dE * varN - 2 * dE * dN * covEN) * inv * inv;
          sigmaAz = Math.sqrt(Math.abs(varAz));
        }

        const row: NonNullable<AdjustmentResult['relativeCovariances']>[number] = {
          from,
          to,
          connected: true,
          connectionTypes: Array.from(types).sort(),
          cEE: varE,
          cEN: covEN,
          cNN: varN,
          sigmaE: Math.sqrt(Math.abs(varE)),
          sigmaN: Math.sqrt(Math.abs(varN)),
          sigmaDist,
          sigmaAz,
          ellipse: ellipseSummary.ellipse,
        };

        if (!this.is2D) {
          const varH =
            cov(idxTo?.h, idxTo?.h) + cov(idxFrom?.h, idxFrom?.h) - 2 * cov(idxFrom?.h, idxTo?.h);
          const covEH =
            cov(idxTo?.x, idxTo?.h) -
            cov(idxTo?.x, idxFrom?.h) -
            cov(idxFrom?.x, idxTo?.h) +
            cov(idxFrom?.x, idxFrom?.h);
          const covNH =
            cov(idxTo?.y, idxTo?.h) -
            cov(idxTo?.y, idxFrom?.h) -
            cov(idxFrom?.y, idxTo?.h) +
            cov(idxFrom?.y, idxFrom?.h);
          row.cEH = covEH;
          row.cNH = covNH;
          row.cHH = varH;
          row.sigmaH = Math.sqrt(Math.abs(varH));
        }

        relativeCovariances.push(row);
      });
      relativeCovariances.sort((a, b) => {
        const cmpFrom = a.from.localeCompare(b.from, undefined, { numeric: true });
        if (cmpFrom !== 0) return cmpFrom;
        return a.to.localeCompare(b.to, undefined, { numeric: true });
      });
      this.relativeCovariances = relativeCovariances;

      if (this.preanalysisMode) {
        const stationMedian = medianOf(
          stationCovariances.map(
            (block) => block.ellipse?.semiMajor ?? Math.max(block.sigmaE, block.sigmaN),
          ),
        );
        const relativeMedian = medianOf(
          relativeCovariances.map(
            (block) =>
              block.sigmaDist ?? block.ellipse?.semiMajor ?? Math.max(block.sigmaE, block.sigmaN),
          ),
        );
        const stationCues: NonNullable<AdjustmentResult['weakGeometryDiagnostics']>['stationCues'] =
          stationCovariances.map((block) => {
            const horizontalMetric =
              block.ellipse?.semiMajor ?? Math.max(block.sigmaE, block.sigmaN);
            const relativeToMedian =
              stationMedian && stationMedian > 0 ? horizontalMetric / stationMedian : 1;
            const ellipseRatio =
              block.ellipse != null
                ? block.ellipse.semiMajor / Math.max(block.ellipse.semiMinor, 1e-12)
                : undefined;
            const severity = classifyWeakGeometrySeverity(relativeToMedian, ellipseRatio);
            return {
              stationId: block.stationId,
              severity,
              horizontalMetric,
              verticalMetric: block.sigmaH,
              relativeToMedian,
              ellipseRatio,
              note: `major=${horizontalMetric.toFixed(4)}m, medianRatio=${relativeToMedian.toFixed(2)}x${ellipseRatio != null ? `, shape=${ellipseRatio.toFixed(2)}x` : ''}`,
            };
          });
        const relativeCues: NonNullable<
          AdjustmentResult['weakGeometryDiagnostics']
        >['relativeCues'] = relativeCovariances.map((block) => {
          const distanceMetric =
            block.sigmaDist ?? block.ellipse?.semiMajor ?? Math.max(block.sigmaE, block.sigmaN);
          const relativeToMedian =
            relativeMedian && relativeMedian > 0 ? distanceMetric / relativeMedian : 1;
          const ellipseRatio =
            block.ellipse != null
              ? block.ellipse.semiMajor / Math.max(block.ellipse.semiMinor, 1e-12)
              : undefined;
          const severity = classifyWeakGeometrySeverity(relativeToMedian, ellipseRatio);
          return {
            from: block.from,
            to: block.to,
            severity,
            distanceMetric,
            relativeToMedian,
            ellipseRatio,
            note: `sigmaDist=${distanceMetric.toFixed(4)}m, medianRatio=${relativeToMedian.toFixed(2)}x${ellipseRatio != null ? `, shape=${ellipseRatio.toFixed(2)}x` : ''}`,
          };
        });
        this.weakGeometryDiagnostics = {
          enabled: true,
          stationMedianHorizontal: stationMedian ?? 0,
          relativeMedianDistance: relativeMedian,
          stationCues,
          relativeCues,
        };
        const flaggedStations = stationCues.filter((cue) => cue.severity !== 'ok');
        const flaggedPairs = relativeCues.filter((cue) => cue.severity !== 'ok');
        this.log(
          `Preanalysis covariance blocks: stations=${stationCovariances.length}, connectedPairs=${relativeCovariances.length}`,
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
        return {
          setId,
          occupy: stat.occupy,
          rawCount: stat.rawCount,
          reducedCount: stat.reducedCount,
          face1Count: stat.face1Count,
          face2Count: stat.face2Count,
          pairedTargets: stat.pairedTargets,
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
          `  ${stat.setId} @ ${stat.occupy}: raw=${stat.rawCount}, reduced=${stat.reducedCount}, pairs=${stat.pairedTargets}, F1=${stat.face1Count}, F2=${stat.face2Count}, mean=${(stat.residualMeanArcSec ?? 0).toFixed(2)}", rms=${(stat.residualRmsArcSec ?? 0).toFixed(2)}", max=${(stat.residualMaxArcSec ?? 0).toFixed(2)}", pairDeltaMax=${(stat.maxFacePairDeltaArcSec ?? 0).toFixed(2)}", rawMax=${(stat.maxRawMaxResidualArcSec ?? 0).toFixed(2)}", orient=${(stat.orientationDeg ?? 0).toFixed(4)}°, orientSE=${(stat.orientationSeArcSec ?? 0).toFixed(2)}"`,
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

    {
      const setupMap = new Map<
        StationId,
        {
          station: StationId;
          directionSetIds: Set<string>;
          directionObsCount: number;
          angleObsCount: number;
          distanceObsCount: number;
          bearingObsCount: number;
          zenithObsCount: number;
          levelingObsCount: number;
          gpsObsCount: number;
          traverseDistance: number;
          orientationRmsSum: number;
          orientationSeSum: number;
          orientationCount: number;
          stdResCount: number;
          stdResSumSq: number;
          stdResMaxAbs: number;
          localFailCount: number;
          worstObsType?: string;
          worstObsStations?: string;
          worstObsLine?: number;
        }
      >();
      const obsSetupStation = (obs: Observation): StationId | undefined => {
        if (obs.type === 'direction' || obs.type === 'angle') return obs.at;
        if (
          obs.type === 'dist' ||
          obs.type === 'bearing' ||
          obs.type === 'zenith' ||
          obs.type === 'lev' ||
          obs.type === 'gps' ||
          obs.type === 'dir'
        ) {
          return obs.from;
        }
        return undefined;
      };
      const obsStationsLabel = (obs: Observation): string => {
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
      };
      const ensureSetup = (station: StationId) => {
        const existing = setupMap.get(station);
        if (existing) return existing;
        const created = {
          station,
          directionSetIds: new Set<string>(),
          directionObsCount: 0,
          angleObsCount: 0,
          distanceObsCount: 0,
          bearingObsCount: 0,
          zenithObsCount: 0,
          levelingObsCount: 0,
          gpsObsCount: 0,
          traverseDistance: 0,
          orientationRmsSum: 0,
          orientationSeSum: 0,
          orientationCount: 0,
          stdResCount: 0,
          stdResSumSq: 0,
          stdResMaxAbs: 0,
          localFailCount: 0,
          worstObsType: undefined,
          worstObsStations: undefined,
          worstObsLine: undefined,
        };
        setupMap.set(station, created);
        return created;
      };
      activeObservations.forEach((obs) => {
        const setupId = obsSetupStation(obs);
        if (!setupId) return;
        const setup = ensureSetup(setupId);
        if (obs.type === 'direction') {
          setup.directionObsCount += 1;
          setup.directionSetIds.add(String((obs as any).setId));
        } else if (obs.type === 'angle') {
          setup.angleObsCount += 1;
        } else if (obs.type === 'dir') {
          setup.directionObsCount += 1;
        } else if (obs.type === 'dist') {
          setup.distanceObsCount += 1;
          const setTag = String((obs as any).setId ?? '').toUpperCase();
          if (setTag === 'T' || setTag === 'TE') {
            setup.traverseDistance += Math.abs(obs.obs);
          }
        } else if (obs.type === 'bearing') {
          setup.bearingObsCount += 1;
        } else if (obs.type === 'zenith') {
          setup.zenithObsCount += 1;
        } else if (obs.type === 'lev') {
          setup.levelingObsCount += 1;
        } else if (obs.type === 'gps') {
          setup.gpsObsCount += 1;
        }

        const stdRes = obs.stdRes;
        const absStdRes =
          typeof stdRes === 'number' && Number.isFinite(stdRes) ? Math.abs(stdRes) : undefined;
        if (absStdRes != null) {
          setup.stdResCount += 1;
          setup.stdResSumSq += absStdRes * absStdRes;
          if (absStdRes > setup.stdResMaxAbs) {
            setup.stdResMaxAbs = absStdRes;
            setup.worstObsType = obs.type;
            setup.worstObsStations = obsStationsLabel(obs);
            setup.worstObsLine = obs.sourceLine;
          }
        }

        const localComp = obs.localTestComponents;
        if (localComp) {
          if (!localComp.passE) setup.localFailCount += 1;
          if (!localComp.passN) setup.localFailCount += 1;
        } else if (obs.localTest && !obs.localTest.pass) {
          setup.localFailCount += 1;
        }
      });
      (this.directionSetDiagnostics ?? []).forEach((d) => {
        const setup = ensureSetup(d.occupy);
        if (d.residualRmsArcSec != null) setup.orientationRmsSum += d.residualRmsArcSec;
        if (d.orientationSeArcSec != null) setup.orientationSeSum += d.orientationSeArcSec;
        setup.orientationCount += 1;
      });

      if (setupMap.size > 0) {
        this.setupDiagnostics = Array.from(setupMap.values())
          .map((s) => ({
            station: s.station,
            directionSetCount: s.directionSetIds.size,
            directionObsCount: s.directionObsCount,
            angleObsCount: s.angleObsCount,
            distanceObsCount: s.distanceObsCount,
            bearingObsCount: s.bearingObsCount,
            zenithObsCount: s.zenithObsCount,
            levelingObsCount: s.levelingObsCount,
            gpsObsCount: s.gpsObsCount,
            traverseDistance: s.traverseDistance,
            orientationRmsArcSec:
              s.orientationCount > 0 ? s.orientationRmsSum / s.orientationCount : undefined,
            orientationSeArcSec:
              s.orientationCount > 0 ? s.orientationSeSum / s.orientationCount : undefined,
            stdResCount: s.stdResCount,
            rmsStdRes: s.stdResCount > 0 ? Math.sqrt(s.stdResSumSq / s.stdResCount) : undefined,
            maxStdRes: s.stdResCount > 0 ? s.stdResMaxAbs : undefined,
            localFailCount: s.localFailCount,
            worstObsType: s.worstObsType,
            worstObsStations: s.worstObsStations,
            worstObsLine: s.worstObsLine,
          }))
          .sort((a, b) => a.station.localeCompare(b.station));
        this.logs.push('Setup summary:');
        this.setupDiagnostics.forEach((s) => {
          this.logs.push(
            `  ${s.station}: dirSets=${s.directionSetCount}, dirObs=${s.directionObsCount}, ang=${s.angleObsCount}, dist=${s.distanceObsCount}, zen=${s.zenithObsCount}, lev=${s.levelingObsCount}, gps=${s.gpsObsCount}, travDist=${s.traverseDistance.toFixed(3)}m, orientRMS=${s.orientationRmsArcSec != null ? `${s.orientationRmsArcSec.toFixed(2)}"` : '-'}, orientSE=${s.orientationSeArcSec != null ? `${s.orientationSeArcSec.toFixed(2)}"` : '-'}, rms|t|=${s.rmsStdRes != null ? s.rmsStdRes.toFixed(2) : '-'}, max|t|=${s.maxStdRes != null ? s.maxStdRes.toFixed(2) : '-'}, localFail=${s.localFailCount}`,
          );
        });
      }
    }

    if (closureResiduals.length) {
      this.logs.push(...closureResiduals);
      const netE = closureVectors.reduce((acc, v) => acc + v.dE, 0);
      const netN = closureVectors.reduce((acc, v) => acc + v.dN, 0);
      const thresholds = { ...this.traverseThresholds };
      const netAngularMisclosureArcSec = Array.from(loopAngleArcSec.values()).reduce(
        (acc, v) => acc + v,
        0,
      );
      const netVerticalMisclosure = Array.from(loopVerticalMisclosure.values()).reduce(
        (acc, v) => acc + v,
        0,
      );
      if (closureVectors.length) {
        const mag = Math.hypot(netE, netN);
        const closureRatio = mag > 1e-12 ? totalTraverseDistance / mag : undefined;
        const linearPpm =
          totalTraverseDistance > 1e-12 ? (mag / totalTraverseDistance) * 1_000_000 : undefined;
        const ratioPass = closureRatio != null ? closureRatio >= thresholds.minClosureRatio : false;
        const ppmPass = linearPpm != null ? linearPpm <= thresholds.maxLinearPpm : false;
        const angularPass =
          loopAngleArcSec.size === 0 ||
          Math.abs(netAngularMisclosureArcSec) <= thresholds.maxAngularArcSec;
        const verticalPass =
          loopVerticalMisclosure.size === 0 ||
          Math.abs(netVerticalMisclosure) <= thresholds.maxVerticalMisclosure;

        const setupTraverseDistance = new Map<string, number>();
        (this.setupDiagnostics ?? []).forEach((s) => {
          setupTraverseDistance.set(s.station, s.traverseDistance);
        });
        const loopKeys = new Set<string>([
          ...Object.keys(loopVectors),
          ...Array.from(loopAngleArcSec.keys()),
          ...Array.from(loopVerticalMisclosure.keys()),
        ]);
        const defaultLoopDist = loopKeys.size > 0 ? totalTraverseDistance / loopKeys.size : 0;
        const loops = Array.from(loopKeys)
          .map((key) => {
            const [from = '', to = ''] = key.split('->');
            const vec = loopVectors[key] ?? { dE: 0, dN: 0 };
            const loopMag = Math.hypot(vec.dE, vec.dN);
            const traverseDistance = setupTraverseDistance.get(from) ?? defaultLoopDist;
            const loopRatio = loopMag > 1e-12 ? traverseDistance / loopMag : undefined;
            const loopPpm =
              traverseDistance > 1e-12 ? (loopMag / traverseDistance) * 1_000_000 : undefined;
            const loopAng = loopAngleArcSec.get(key);
            const loopVert = loopVerticalMisclosure.get(key);
            const ratioOk = loopRatio != null ? loopRatio >= thresholds.minClosureRatio : false;
            const ppmOk = loopPpm != null ? loopPpm <= thresholds.maxLinearPpm : false;
            const angOk = loopAng == null || Math.abs(loopAng) <= thresholds.maxAngularArcSec;
            const vertOk =
              loopVert == null || Math.abs(loopVert) <= thresholds.maxVerticalMisclosure;
            let severity = 0;
            if (!ratioOk && loopRatio != null) {
              severity += (thresholds.minClosureRatio / Math.max(loopRatio, 1) - 1) * 70;
            }
            if (!ppmOk && loopPpm != null) {
              severity += (loopPpm / thresholds.maxLinearPpm - 1) * 70;
            }
            if (!angOk && loopAng != null) {
              severity += (Math.abs(loopAng) / thresholds.maxAngularArcSec - 1) * 35;
            }
            if (!vertOk && loopVert != null) {
              severity += (Math.abs(loopVert) / thresholds.maxVerticalMisclosure - 1) * 35;
            }
            severity += Math.min(loopMag * 10, 25);
            const pass = ratioOk && ppmOk && angOk && vertOk;
            return {
              key,
              from,
              to,
              misclosureE: vec.dE,
              misclosureN: vec.dN,
              misclosureMag: loopMag,
              traverseDistance,
              closureRatio: loopRatio,
              linearPpm: loopPpm,
              angularMisclosureArcSec: loopAng,
              verticalMisclosure: loopVert,
              severity,
              pass,
            };
          })
          .sort((a, b) => {
            if (b.severity !== a.severity) return b.severity - a.severity;
            return b.misclosureMag - a.misclosureMag;
          });

        this.traverseDiagnostics = {
          closureCount: closureVectors.length,
          misclosureE: netE,
          misclosureN: netN,
          misclosureMag: mag,
          totalTraverseDistance,
          closureRatio,
          linearPpm,
          angularMisclosureArcSec:
            loopAngleArcSec.size > 0 ? netAngularMisclosureArcSec : undefined,
          verticalMisclosure: loopVerticalMisclosure.size > 0 ? netVerticalMisclosure : undefined,
          thresholds,
          passes: {
            ratio: ratioPass,
            linearPpm: ppmPass,
            angular: angularPass,
            vertical: verticalPass,
            overall: ratioPass && ppmPass && angularPass && verticalPass,
          },
          loops,
        };
        this.logs.push(
          `Traverse misclosure vector: dE=${netE.toFixed(4)} m, dN=${netN.toFixed(4)} m, Mag=${mag.toFixed(4)} m`,
        );
        if (totalTraverseDistance > 0) {
          this.logs.push(`Traverse distance sum: ${totalTraverseDistance.toFixed(4)} m`);
        }
        if (closureRatio != null) {
          this.logs.push(`Traverse closure ratio: 1:${closureRatio.toFixed(0)}`);
        }
        if (linearPpm != null) {
          this.logs.push(`Traverse linear misclosure: ${linearPpm.toFixed(1)} ppm`);
        }
        if (loopAngleArcSec.size > 0) {
          this.logs.push(`Traverse angular misclosure: ${netAngularMisclosureArcSec.toFixed(2)}"`);
        }
        if (loopVerticalMisclosure.size > 0) {
          this.logs.push(`Traverse vertical misclosure: ${netVerticalMisclosure.toFixed(4)} m`);
        }
        if (loops.length > 0) {
          this.logs.push('Traverse closure loop ranking (worst first):');
          loops.slice(0, 8).forEach((l) => {
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
      const thresholds = { ...this.traverseThresholds };
      this.traverseDiagnostics = {
        closureCount: 0,
        misclosureE: 0,
        misclosureN: 0,
        misclosureMag: 0,
        totalTraverseDistance,
        closureRatio: undefined,
        linearPpm: undefined,
        angularMisclosureArcSec:
          loopAngleArcSec.size > 0
            ? Array.from(loopAngleArcSec.values()).reduce((acc, v) => acc + v, 0)
            : undefined,
        verticalMisclosure:
          loopVerticalMisclosure.size > 0
            ? Array.from(loopVerticalMisclosure.values()).reduce((acc, v) => acc + v, 0)
            : undefined,
        thresholds,
        passes: {
          ratio: false,
          linearPpm: false,
          angular:
            loopAngleArcSec.size === 0 ||
            Math.abs(Array.from(loopAngleArcSec.values()).reduce((acc, v) => acc + v, 0)) <=
              thresholds.maxAngularArcSec,
          vertical:
            loopVerticalMisclosure.size === 0 ||
            Math.abs(Array.from(loopVerticalMisclosure.values()).reduce((acc, v) => acc + v, 0)) <=
              thresholds.maxVerticalMisclosure,
          overall: false,
        },
        loops: [],
      };
      this.logs.push('Traverse closure residual not computed (insufficient closure geometry).');
      if (totalTraverseDistance > 0) {
        this.logs.push(`Traverse distance sum: ${totalTraverseDistance.toFixed(4)} m`);
      }
    }
  }

  private stationSeparation(a: Station, b: Station, dimension: '2D' | '3D'): number {
    const dE = b.x - a.x;
    const dN = b.y - a.y;
    if (dimension === '2D') {
      return Math.hypot(dE, dN);
    }
    const dH = b.h - a.h;
    return Math.sqrt(dE * dE + dN * dN + dH * dH);
  }

  private computeClusterDiagnostics(): NonNullable<AdjustmentResult['clusterDiagnostics']> {
    const dimension: '2D' | '3D' = this.is2D ? '2D' : '3D';
    const tolerance = Math.max(
      1e-9,
      dimension === '2D' ? this.clusterTolerance2D : this.clusterTolerance3D,
    );
    const linkageMode = this.clusterLinkageMode ?? 'single';
    const passMode =
      (this.parseOptions?.clusterDualPassRan ?? false) ||
      this.parseOptions?.clusterPassLabel === 'pass2'
        ? 'dual-pass'
        : 'single-pass';

    if (!this.clusterDetectionEnabled) {
      return {
        enabled: false,
        passMode,
        linkageMode,
        dimension,
        tolerance,
        pairCount: 0,
        candidateCount: 0,
        candidates: [],
      };
    }

    const stationIds = Object.keys(this.stations)
      .filter((id) => {
        const s = this.stations[id];
        if (!s) return false;
        if (!Number.isFinite(s.x) || !Number.isFinite(s.y)) return false;
        if (dimension === '3D' && !Number.isFinite(s.h)) return false;
        return true;
      })
      .sort((a, b) => a.localeCompare(b, undefined, { numeric: true }));

    if (stationIds.length < 2) {
      return {
        enabled: true,
        passMode,
        linkageMode,
        dimension,
        tolerance,
        pairCount: 0,
        candidateCount: 0,
        candidates: [],
      };
    }

    const pairDist = new Map<string, number>();
    const pairKey = (a: StationId, b: StationId): string => (a < b ? `${a}|${b}` : `${b}|${a}`);
    const getDist = (a: StationId, b: StationId): number => {
      const key = pairKey(a, b);
      const cached = pairDist.get(key);
      if (cached != null) return cached;
      const sa = this.stations[a];
      const sb = this.stations[b];
      if (!sa || !sb) return Number.POSITIVE_INFINITY;
      const dist = this.stationSeparation(sa, sb, dimension);
      pairDist.set(key, dist);
      return dist;
    };

    type Edge = { from: StationId; to: StationId; separation: number };
    const withinTolEdges: Edge[] = [];
    for (let i = 0; i < stationIds.length; i += 1) {
      for (let j = i + 1; j < stationIds.length; j += 1) {
        const from = stationIds[i];
        const to = stationIds[j];
        const separation = getDist(from, to);
        if (separation <= tolerance) {
          withinTolEdges.push({ from, to, separation });
        }
      }
    }

    let rawClusters: StationId[][] = [];
    if (linkageMode === 'single') {
      const parent = new Map<StationId, StationId>();
      const find = (id: StationId): StationId => {
        const p = parent.get(id) ?? id;
        if (p === id) return p;
        const root = find(p);
        parent.set(id, root);
        return root;
      };
      const union = (a: StationId, b: StationId): void => {
        const ra = find(a);
        const rb = find(b);
        if (ra === rb) return;
        const keep = ra.localeCompare(rb, undefined, { numeric: true }) <= 0 ? ra : rb;
        const drop = keep === ra ? rb : ra;
        parent.set(drop, keep);
      };
      stationIds.forEach((id) => parent.set(id, id));
      withinTolEdges.forEach((e) => union(e.from, e.to));
      const groups = new Map<StationId, StationId[]>();
      stationIds.forEach((id) => {
        const root = find(id);
        const list = groups.get(root) ?? [];
        list.push(id);
        groups.set(root, list);
      });
      rawClusters = Array.from(groups.values()).filter((group) => group.length > 1);
    } else {
      const clusters: StationId[][] = [];
      stationIds.forEach((id) => {
        let placed = false;
        for (const group of clusters) {
          const fits = group.every((member) => getDist(id, member) <= tolerance);
          if (fits) {
            group.push(id);
            placed = true;
            break;
          }
        }
        if (!placed) clusters.push([id]);
      });
      rawClusters = clusters.filter((group) => group.length > 1);
    }

    const unknownSet = new Set(this.unknowns);
    const candidates = rawClusters
      .map((group) =>
        group.slice().sort((a, b) => a.localeCompare(b, undefined, { numeric: true })),
      )
      .sort((a, b) => a[0].localeCompare(b[0], undefined, { numeric: true }))
      .map((stationIdsInCluster, idx) => {
        let sumE = 0;
        let sumN = 0;
        let sumH = 0;
        let hasFixed = false;
        let hasUnknown = false;
        stationIdsInCluster.forEach((id) => {
          const st = this.stations[id];
          if (!st) return;
          sumE += st.x;
          sumN += st.y;
          sumH += st.h;
          hasFixed = hasFixed || st.fixed;
          hasUnknown = hasUnknown || unknownSet.has(id);
        });
        const pairRows: Edge[] = [];
        let maxSeparation = 0;
        let sumSeparation = 0;
        let pairCount = 0;
        for (let i = 0; i < stationIdsInCluster.length; i += 1) {
          for (let j = i + 1; j < stationIdsInCluster.length; j += 1) {
            const from = stationIdsInCluster[i];
            const to = stationIdsInCluster[j];
            const separation = getDist(from, to);
            pairRows.push({ from, to, separation });
            maxSeparation = Math.max(maxSeparation, separation);
            sumSeparation += separation;
            pairCount += 1;
          }
        }
        pairRows.sort(
          (a, b) =>
            a.from.localeCompare(b.from, undefined, { numeric: true }) ||
            a.to.localeCompare(b.to, undefined, { numeric: true }),
        );
        return {
          key: `CL-${idx + 1}-${stationIdsInCluster[0]}`,
          representativeId: stationIdsInCluster[0],
          stationIds: stationIdsInCluster,
          memberCount: stationIdsInCluster.length,
          hasFixed,
          hasUnknown,
          centroidE: sumE / stationIdsInCluster.length,
          centroidN: sumN / stationIdsInCluster.length,
          centroidH: dimension === '3D' ? sumH / stationIdsInCluster.length : undefined,
          maxSeparation,
          meanSeparation: pairCount > 0 ? sumSeparation / pairCount : 0,
          pairs: pairRows,
        };
      });

    return {
      enabled: true,
      passMode,
      linkageMode,
      dimension,
      tolerance,
      pairCount: withinTolEdges.length,
      candidateCount: candidates.length,
      candidates,
    };
  }

  private buildResult(): AdjustmentResult {
    if (!this.sideshots) {
      this.sideshots = this.computeSideshotResults();
    }
    if (this.coordSystemMode === 'grid') {
      Object.keys(this.stations).forEach((id) => {
        this.stationFactorSnapshot(id);
      });
    }
    if (this.parseState) {
      const diagnostics = Array.from(this.coordSystemDiagnostics.values()).sort();
      this.parseState.coordSystemDiagnostics = diagnostics;
      this.parseState.coordSystemWarningMessages = [...this.coordSystemWarningMessages];
      if (this.coordSystemMode === 'grid') {
        this.parseState.crsStatus = this.crsStatus;
        this.parseState.crsOffReason = this.crsStatus === 'off' ? this.crsOffReason : undefined;
      } else {
        this.parseState.crsStatus = undefined;
        this.parseState.crsOffReason = undefined;
      }
      this.parseState.crsDatumOpId = this.crsDatumOpId || undefined;
      this.parseState.crsDatumFallbackUsed =
        this.crsDatumFallbackUsed || diagnostics.includes('CRS_DATUM_FALLBACK');
      this.parseState.crsAreaOfUseStatus = this.crsAreaOfUseStatus;
      this.parseState.crsOutOfAreaStationCount = this.crsOutOfAreaStationCount;
      this.parseState.observationMode = {
        bearing: this.parseState.gridBearingMode ?? 'grid',
        distance: this.parseState.gridDistanceMode ?? 'measured',
        angle: this.parseState.gridAngleMode ?? 'measured',
        direction: this.parseState.gridDirectionMode ?? 'measured',
      };
      this.parseState.reductionContext = {
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
      this.parseState.scaleOverrideActive = this.scaleOverrideActive;
      this.parseState.gnssFrameConfirmed = this.gnssFrameConfirmed;
      this.parseState.datumSufficiencyReport = this.datumSufficiencyReport;
      this.parseState.parsedUsageSummary =
        this.parseState.parsedUsageSummary ?? summarizeReductionUsage(this.observations);
      this.parseState.usedInSolveUsageSummary =
        this.parseState.usedInSolveUsageSummary ?? summarizeReductionUsage(this.collectActiveObservations());
    }
    const autoSideshotEnabled =
      this.parseState?.autoSideshotEnabled ?? this.parseOptions?.autoSideshotEnabled ?? true;
    if (this.preanalysisMode) {
      this.autoSideshotDiagnostics = undefined;
      this.logs.push('Auto-sideshot detection (M-lines): disabled in preanalysis mode');
    } else if (autoSideshotEnabled) {
      if (!this.autoSideshotDiagnostics) {
        this.autoSideshotDiagnostics = this.computeAutoSideshotDiagnostics();
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
    if (!this.clusterDiagnostics) {
      this.clusterDiagnostics = this.computeClusterDiagnostics();
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
    return {
      success: this.converged,
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
    };
  }
}
