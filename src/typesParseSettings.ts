export type UnitsMode = 'm' | 'ft';
export type CoordMode = '2D' | '3D';
export type OrderMode = 'NE' | 'EN';
export type AngleUnitsMode = 'dms' | 'dd';
export type AngleStationOrder = 'atfromto' | 'fromatto';
export type DeltaMode = 'slope' | 'horiz'; // slope+zenith vs horiz+deltaH
export type MapMode = 'off' | 'on' | 'anglecalc';
export type LonSign = 'west-positive' | 'west-negative';
export type AngleMode = 'auto' | 'angle' | 'dir';
export type VerticalReductionMode = 'none' | 'curvref';
export type TsCorrelationScope = 'setup' | 'set';
export type RobustMode = 'none' | 'huber';
export type SuspectImpactMode = 'auto' | 'on' | 'off';
export type DirectionSetMode = 'reduced' | 'raw';
export type ClusterLinkageMode = 'single' | 'complete';
export type ClusterPassLabel = 'single' | 'pass1' | 'pass2';
export type DescriptionReconcileMode = 'first' | 'append';
export type ParseCompatibilityMode = 'legacy' | 'strict';
export type FaceNormalizationMode = 'on' | 'off' | 'auto';
export type RunMode = 'adjustment' | 'preanalysis' | 'data-check' | 'blunder-detect';
export type CrsProjectionModel = 'legacy-equirectangular' | 'local-enu';
export type CoordSystemMode = 'local' | 'grid';
export type LocalDatumScheme = 'average-scale' | 'common-elevation';
export type GridObservationMode = 'measured' | 'grid';
export type GridDistanceInputMode = 'measured' | 'grid' | 'ellipsoidal';
export type CrsStatus = 'on' | 'off';
export type CrsOffReason =
  | 'noCRSSelected'
  | 'projDbMissing'
  | 'noInverseAvailable'
  | 'inverseFailed'
  | 'unsupportedCrsFamily'
  | 'disabledByProfile'
  | 'crsInitFailed'
  | 'missingGridFiles';
export type ReductionInputSpace = 'measured' | 'grid';
export type ReductionDistanceKind = 'ground' | 'grid' | 'ellipsoidal';
export type BearingKind = 'grid' | 'measured';
export type FactorComputationMethod = 'inverseToGeodetic' | 'directGrid' | 'fallback';
export type CoordInputClass = 'grid' | 'geodetic' | 'local' | 'unknown';
export type GnssVectorFrame = 'gridNEU' | 'enuLocal' | 'ecefDelta' | 'llhBaseline' | 'unknown';
export type EllipsoidHeightSource =
  | 'perStationGeoid+H'
  | 'avgGeoid+H'
  | 'providedEllipsoid'
  | 'assumed0';
export type CoordSystemDiagnosticCode =
  | 'CRS_OUT_OF_AREA'
  | 'CRS_DATUM_FALLBACK'
  | 'GEOID_FALLBACK'
  | 'FACTOR_APPROXIMATION_USED'
  | 'CRS_INPUT_MIX_BLOCKED'
  | 'GNSS_FRAME_UNCONFIRMED'
  | 'DATUM_HARD_FAIL'
  | 'DATUM_SOFT_WARN'
  | 'SCALE_OVERRIDE_USED'
  | 'FACTOR_FALLBACK_PROJ_USED';
export interface ObservationModeSettings {
  bearing: GridObservationMode;
  distance: GridDistanceInputMode;
  angle: GridObservationMode;
  direction: GridObservationMode;
}
export interface ReductionContext {
  inputSpaceDefault: ReductionInputSpace;
  distanceKind: ReductionDistanceKind;
  bearingKind: BearingKind;
  explicitOverrideActive: boolean;
}
export interface DatumSufficiencyReport {
  status: 'hard-fail' | 'soft-warn' | 'ok';
  reasons: string[];
  suggestions: string[];
}
export interface ReductionUsageSummary {
  bearing: { grid: number; measured: number };
  angle: { grid: number; measured: number };
  direction: { grid: number; measured: number };
  distance: { ground: number; grid: number; ellipsoidal: number };
  total: number;
}
export interface DirectiveTransitionState {
  gridBearingMode: GridObservationMode;
  gridDistanceMode: GridDistanceInputMode;
  gridAngleMode: GridObservationMode;
  gridDirectionMode: GridObservationMode;
  averageScaleFactor: number;
  scaleOverrideActive: boolean;
}
export interface DirectiveTransition {
  line: number;
  directive: string;
  stateAfter: DirectiveTransitionState;
  effectiveFromLine: number;
  effectiveToLine?: number;
  obsCountInRange: number;
}
export interface DirectiveNoEffectWarning {
  line: number;
  directive: string;
  reason: 'noSubsequentObservations' | 'noSubsequentObsRecords';
}
export type ParseCompatibilityDiagnosticCode =
  | 'ROLE_AMBIGUITY'
  | 'TOKEN_ROLE_COLLISION'
  | 'OVERLOADED_STATION_FORM'
  | 'SIGMA_POSITION_AMBIGUITY'
  | 'MIXED_LEGACY_SYNTAX'
  | 'STRICT_REJECTED'
  | 'NUMERIC_STATION_TOKEN_REJECTED';
export interface ParseCompatibilityDiagnostic {
  code: ParseCompatibilityDiagnosticCode;
  line: number;
  sourceFile?: string;
  recordType?: string;
  mode: ParseCompatibilityMode;
  severity: 'warning' | 'error';
  message: string;
  rewriteSuggestion?: string;
  fallbackApplied?: boolean;
}
