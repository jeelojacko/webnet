import {
  LEVEL_LOOP_DEFAULT_BASE_MM,
  LEVEL_LOOP_DEFAULT_PER_SQRT_KM_MM,
} from './adjustConstants';
import { createEmptySolveTiming } from './adjustSolveTiming';
import type { SolveParameterIndex } from './adjustmentSolveTypes';
import type { SolvePreparationResult } from './adjustmentPreprocessing';
import type { GeoidGridModel } from './geoid';
import type { SolveProgressEvent } from './scenarioRunModels';
import type { StationFactorSnapshot } from './adjustStationCoordinateHelpers';
import type {
  AdjustmentResult,
  CoordInputClass,
  CoordSystemDiagnosticCode,
  CrsOffReason,
  CrsStatus,
  DatumSufficiencyReport,
  DirectionRejectDiagnostic,
  InstrumentLibrary,
  Observation,
  ObservationOverride,
  ParseOptions,
  ParseResult,
  RunMode,
  RunModeCompatibilityDiagnostic,
  StationId,
  StationMap,
} from '../types';

export abstract class LSAEngineState {
  input!: string;
  stations: StationMap = {};
  observations: Observation[] = [];
  unknowns: StationId[] = [];
  iterations = 0;
  maxIterations!: number;
  convergenceThreshold!: number;
  dof = 0;
  seuw = 0;
  logs: string[] = [];
  converged = false;
  instrumentLibrary!: InstrumentLibrary;
  protected Qxx: number[][] | null = null;
  protected excludeIds?: Set<number>;
  protected overrides?: Record<number, ObservationOverride>;
  protected parsedResult?: ParseResult;
  protected solvePreparation?: SolvePreparationResult;
  protected maxCondition = 1e12;
  protected maxStdRes = 10;
  protected localTestCritical = 3.29;
  protected traverseThresholds = {
    minClosureRatio: 5000,
    maxLinearPpm: 200,
    maxAngularArcSec: 30,
    maxVerticalMisclosure: 0.03,
  };
  protected parseOptions?: Partial<ParseOptions>;
  protected coordMode: ParseOptions['coordMode'] = '3D';
  protected is2D = false;
  protected directionOrientations: Record<string, number> = {};
  protected paramIndex: SolveParameterIndex = {};
  protected addCenteringToExplicit = false;
  protected applyCentering = true;
  protected debug = false;
  protected mapMode: ParseOptions['mapMode'] = 'off';
  protected mapScaleFactor = 1;
  protected coordSystemMode: ParseOptions['coordSystemMode'] = 'local';
  protected crsId = 'CA_NAD83_CSRS_UTM_20N';
  protected localDatumScheme: ParseOptions['localDatumScheme'] = 'average-scale';
  protected averageScaleFactor = 1;
  protected scaleOverrideActive = false;
  protected commonElevation = 0;
  protected averageGeoidHeight = 0;
  protected crsGridScaleEnabled = false;
  protected crsGridScaleFactor = 1;
  protected crsConvergenceEnabled = false;
  protected crsConvergenceAngleRad = 0;
  protected geoidModelEnabled = false;
  protected geoidModelId = 'NGS-DEMO';
  protected geoidSourceFormat: ParseOptions['geoidSourceFormat'] = 'builtin';
  protected geoidSourcePath = '';
  protected geoidSourceData?: Uint8Array;
  protected geoidInterpolation: ParseOptions['geoidInterpolation'] = 'bilinear';
  protected geoidHeightConversionEnabled = false;
  protected geoidOutputHeightDatum: ParseOptions['geoidOutputHeightDatum'] = 'orthometric';
  protected activeGeoidModel: GeoidGridModel | null = null;
  protected applyCurvatureRefraction = false;
  protected refractionCoefficient = 0.13;
  protected verticalReduction: ParseOptions['verticalReduction'] = 'none';
  protected tsCorrelationEnabled = false;
  protected tsCorrelationRho = 0.25;
  protected tsCorrelationScope: ParseOptions['tsCorrelationScope'] = 'set';
  protected robustMode: ParseOptions['robustMode'] = 'none';
  protected robustK = 1.5;
  protected runMode: RunMode = 'adjustment';
  protected preanalysisMode = false;
  protected runModeCompatibilityDiagnostics: RunModeCompatibilityDiagnostic[] = [];
  protected prismEnabled = false;
  protected prismOffset = 0;
  protected prismScope: ParseOptions['prismScope'] = 'global';
  protected clusterDetectionEnabled = true;
  protected clusterLinkageMode: ParseOptions['clusterLinkageMode'] = 'single';
  protected clusterTolerance2D = 0.03;
  protected clusterTolerance3D = 0.05;
  protected levelLoopToleranceBaseMm = LEVEL_LOOP_DEFAULT_BASE_MM;
  protected levelLoopTolerancePerSqrtKmMm = LEVEL_LOOP_DEFAULT_PER_SQRT_KM_MM;
  protected chiSquare?: AdjustmentResult['chiSquare'];
  protected statisticalSummary?: AdjustmentResult['statisticalSummary'];
  protected typeSummary?: Record<
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
  protected relativePrecision?: AdjustmentResult['relativePrecision'];
  protected stationCovariances?: AdjustmentResult['stationCovariances'];
  protected relativeCovariances?: AdjustmentResult['relativeCovariances'];
  protected precisionModels?: AdjustmentResult['precisionModels'];
  protected weakGeometryDiagnostics?: AdjustmentResult['weakGeometryDiagnostics'];
  protected directionSetDiagnostics?: AdjustmentResult['directionSetDiagnostics'];
  protected directionTargetDiagnostics?: AdjustmentResult['directionTargetDiagnostics'];
  protected directionRepeatabilityDiagnostics?: AdjustmentResult['directionRepeatabilityDiagnostics'];
  protected directionRejectDiagnostics?: DirectionRejectDiagnostic[];
  protected setupDiagnostics?: AdjustmentResult['setupDiagnostics'];
  protected tsCorrelationDiagnostics?: AdjustmentResult['tsCorrelationDiagnostics'];
  protected robustDiagnostics?: AdjustmentResult['robustDiagnostics'];
  protected residualDiagnostics?: AdjustmentResult['residualDiagnostics'];
  protected traverseDiagnostics?: AdjustmentResult['traverseDiagnostics'];
  protected sideshots?: AdjustmentResult['sideshots'];
  protected gpsLoopDiagnostics?: AdjustmentResult['gpsLoopDiagnostics'];
  protected levelingLoopDiagnostics?: AdjustmentResult['levelingLoopDiagnostics'];
  protected autoSideshotDiagnostics?: AdjustmentResult['autoSideshotDiagnostics'];
  protected clusterDiagnostics?: AdjustmentResult['clusterDiagnostics'];
  protected condition?: AdjustmentResult['condition'];
  protected controlConstraints?: AdjustmentResult['controlConstraints'];
  protected parseState?: ParseOptions;
  protected conditionWarned = false;
  protected stationFactorCache = new Map<string, StationFactorSnapshot>();
  protected coordSystemDiagnostics = new Set<CoordSystemDiagnosticCode>();
  protected coordSystemWarningMessages: string[] = [];
  protected coordWarningSeen = new Set<string>();
  protected crsStatus: CrsStatus = 'off';
  protected crsOffReason?: CrsOffReason = 'disabledByProfile';
  protected gnssFrameConfirmed = false;
  protected datumSufficiencyReport?: DatumSufficiencyReport;
  protected crsDatumOpId = '';
  protected crsDatumFallbackUsed = false;
  protected crsAreaOfUseStatus: 'inside' | 'outside' | 'unknown' = 'unknown';
  protected crsOutOfAreaStationCount = 0;
  protected geometryDependentSigmaReference: 'current' | 'initial' = 'current';
  protected initialSigmaGeometryStations: StationMap = {};
  protected initialSigmaAzimuthCache = new Map<string, { az: number; dist: number }>();
  protected initialSigmaZenithCache = new Map<
    string,
    { z: number; dist: number; horiz: number; dh: number; crCorr: number }
  >();
  protected azimuthCache = new Map<string, { az: number; dist: number }>();
  protected zenithCache = new Map<
    string,
    { z: number; dist: number; horiz: number; dh: number; crCorr: number }
  >();
  protected progressCallback?: (_event: SolveProgressEvent) => void;
  protected solveStartedAt = 0;
  protected solveTiming = createEmptySolveTiming();
  protected solveTimingLogged = false;
  protected coordInputClasses?: Map<StationId, CoordInputClass>;
}
