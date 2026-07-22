import type { StationId } from './typesBase';
import type { Station, Observation } from './typesObservations';
import type { CoordInputClass } from './typesParseSettings';

export interface ParseIncludeRequest {
  includePath: string;
  parentSourceFile?: string;
  line: number;
  stack: string[];
}

export interface ParseIncludeResponse {
  sourceFile: string;
  content: string;
}

export type ParseIncludeResolver = (_request: ParseIncludeRequest) => ParseIncludeResponse | null;

export interface ParseIncludeError {
  code: 'missing-include-path' | 'include-not-found' | 'include-cycle' | 'include-depth-exceeded';
  sourceFile: string;
  line: number;
  includePath?: string;
  message: string;
  stack?: string[];
}

export interface RunModeCompatibilityDiagnostic {
  code: string;
  severity: 'warning' | 'error';
  message: string;
  action?: string;
}

export interface ClusterApprovedMerge {
  aliasId: StationId;
  canonicalId: StationId;
}

export interface ClusterMergeOutcome {
  aliasId: StationId;
  canonicalId: StationId;
  aliasE?: number;
  aliasN?: number;
  aliasH?: number;
  canonicalE?: number;
  canonicalN?: number;
  canonicalH?: number;
  deltaE?: number;
  deltaN?: number;
  deltaH?: number;
  horizontalDelta?: number;
  spatialDelta?: number;
  missing?: boolean;
}

export interface ClusterRejectedProposal {
  key: string;
  representativeId: StationId;
  stationIds: StationId[];
  memberCount: number;
  retainedId?: StationId;
  reason: string;
}

export interface AutoAdjustRemoval {
  obsId: number;
  type: Observation['type'];
  stations: string;
  sourceLine?: number;
  stdRes: number;
  redundancy?: number;
  reason: 'local-test' | 'std-res';
}

export interface AutoAdjustCycleDiagnostics {
  cycle: number;
  seuw: number;
  maxAbsStdRes: number;
  removals: AutoAdjustRemoval[];
}

export interface AutoAdjustDiagnostics {
  enabled: boolean;
  threshold: number;
  maxCycles: number;
  maxRemovalsPerCycle: number;
  minRedundancy: number;
  stopReason: 'disabled' | 'no-candidates' | 'max-cycles';
  cycles: AutoAdjustCycleDiagnostics[];
  removed: AutoAdjustRemoval[];
}

export interface AutoSideshotCandidate {
  sourceLine?: number;
  occupy: StationId;
  backsight: StationId;
  target: StationId;
  angleObsId: number;
  distObsId: number;
  angleRedundancy: number;
  distRedundancy: number;
  minRedundancy: number;
  maxAbsStdRes: number;
}

export interface AutoSideshotDiagnostics {
  enabled: boolean;
  threshold: number;
  evaluatedCount: number;
  excludedControlCount: number;
  candidateCount: number;
  candidates: AutoSideshotCandidate[];
}

export interface LevelLoopSegment {
  from: StationId;
  to: StationId;
  observedDh: number;
  lengthKm: number;
  sourceLine?: number;
  closureLeg?: boolean;
}

export interface LevelingLoopSegmentSuspectRow {
  rank: number;
  key: string;
  from: StationId;
  to: StationId;
  sourceLine?: number;
  occurrenceCount: number;
  warnLoopCount: number;
  totalLengthKm: number;
  maxAbsDh: number;
  suspectScore: number;
  worstLoopKey?: string;
  worstLoopSeverity: number;
  closureLegCount: number;
}

export interface LevelingLoopDiagnosticRow {
  rank: number;
  key: string;
  stationPath: StationId[];
  edgeCount: number;
  sourceLines: number[];
  closure: number;
  absClosure: number;
  loopLengthKm: number;
  toleranceMm: number;
  toleranceM: number;
  closurePerSqrtKmMm: number;
  severity: number;
  pass: boolean;
  segments: LevelLoopSegment[];
}

export interface LevelingLoopDiagnostics {
  enabled: boolean;
  observationCount: number;
  loopCount: number;
  passCount: number;
  warnCount: number;
  totalLengthKm: number;
  warnTotalLengthKm: number;
  thresholds: {
    baseMm: number;
    perSqrtKmMm: number;
  };
  worstLoopKey?: string;
  worstClosure?: number;
  worstClosurePerSqrtKmMm?: number;
  loops: LevelingLoopDiagnosticRow[];
  suspectSegments: LevelingLoopSegmentSuspectRow[];
}

export interface AliasExplicitMapping {
  sourceId: StationId;
  canonicalId: StationId;
  sourceLine?: number;
}

export interface AliasRuleSummary {
  rule: string;
  sourceLine: number;
}

export interface AliasTraceEntry {
  sourceId: StationId;
  canonicalId: StationId;
  sourceLine?: number;
  context: 'station' | 'observation' | 'sideshot-backsight' | 'direction-reject';
  detail?: string;
  reference?: string;
}

export interface DescriptionTraceEntry {
  stationId: StationId;
  sourceLine: number;
  recordType: 'C' | 'P' | 'PH' | 'CH' | 'EH' | 'E';
  description: string;
}

export interface DescriptionScanSummary {
  stationId: StationId;
  recordCount: number;
  uniqueCount: number;
  conflict: boolean;
  descriptions: string[];
  sourceLines: number[];
}

export interface GpsTopoCoordinateShot {
  pointId: StationId;
  east: number;
  north: number;
  height?: number;
  sigmaE?: number;
  sigmaN?: number;
  sigmaH?: number;
  fromId?: StationId;
  sourceLine: number;
}

export interface InputStationSnapshot {
  stationId: StationId;
  x: number;
  y: number;
  h: number;
  coordInputClass?: CoordInputClass;
  constraintModeX?: Station['constraintModeX'];
  constraintModeY?: Station['constraintModeY'];
  constraintModeH?: Station['constraintModeH'];
}
