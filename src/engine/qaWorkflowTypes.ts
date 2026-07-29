import type {
  AdjustmentResult,
  ClusterApprovedMerge,
  Observation,
  ObservationOverride,
} from '../types';

export interface DerivedObservationRef {
  id: number;
  type: Observation['type'];
  stationsLabel: string;
  stationIds: string[];
  sourceLine: number | null;
  pairKey: string | null;
  searchText: string;
  absStdRes: number;
}

export interface DerivedStationRef {
  id: string;
  sourceLines: number[];
  observationIds: number[];
  searchText: string;
}

export interface DerivedMapLink {
  key: string;
  observationId: number;
  type: Observation['type'];
  fromId: string;
  toId: string;
  sourceLine: number | null;
  pairKey: string;
}

export interface DerivedQaResult {
  observations: DerivedObservationRef[];
  observationById: Map<number, DerivedObservationRef>;
  stations: DerivedStationRef[];
  stationById: Map<string, DerivedStationRef>;
  mapLinks: DerivedMapLink[];
  suspectObservationIds: number[];
}

export interface RunSnapshot<TSettingsSnapshot = unknown, TRunDiagnostics = unknown> {
  id: string;
  createdAt: string;
  label: string;
  inputFingerprint: string;
  settingsFingerprint: string;
  summary: RunSnapshotSummary;
  result: AdjustmentResult;
  runDiagnostics: TRunDiagnostics | null;
  settingsSnapshot: TSettingsSnapshot;
  excludedIds: number[];
  activePreanalysisAdditionIds?: string[];
  overrideIds: number[];
  overrides: Record<number, ObservationOverride>;
  approvedClusterMerges: ClusterApprovedMerge[];
  reopenState: SavedRunWorkspaceState | null;
}

export interface RunSnapshotSummary {
  converged: boolean;
  iterations: number;
  seuw: number;
  dof: number;
  stationCount: number;
  observationCount: number;
  suspectObservationCount: number;
  maxAbsStdRes: number;
}

export interface SavedRunSnapshot<TSettingsSnapshot = unknown, TRunDiagnostics = unknown>
  extends RunSnapshot<TSettingsSnapshot, TRunDiagnostics> {
  sourceRunId: string;
  savedAt: string;
  notes: string;
}

export interface SavedRunReviewState {
  reportView: {
    ellipseMode: '1sigma' | '95';
    reportFilterQuery: string;
    reportObservationTypeFilter: string;
    reportExclusionFilter: 'all' | 'included' | 'excluded';
    tableRowLimits: Record<string, number>;
    pinnedDetailSections: Array<{ id: string; label: string }>;
    collapsedDetailSections: Record<string, boolean>;
  };
  selection: {
    stationId: string | null;
    observationId: number | null;
    sourceLine: number | null;
    origin: 'report' | 'map' | 'suspect' | 'compare' | 'queue' | null;
  };
  pinnedObservationIds: number[];
}

export interface SavedRunWorkspaceState {
  activeTab: 'report' | 'processing-summary' | 'industry-output' | 'map' | 'survey-cad';
  review: SavedRunReviewState;
  comparisonSelection: ComparisonSelection;
}

export interface ComparisonSelection {
  baselineRunId: string | null;
  pinnedBaselineRunId: string | null;
  stationMovementThreshold: number;
  residualDeltaThreshold: number;
}

export interface RunComparisonSummary {
  baselineLabel: string;
  currentLabel: string;
  summaryRows: Array<{ label: string; baseline: string; current: string; delta: string }>;
  movedStations: Array<{
    stationId: string;
    deltaHorizontal: number;
    deltaHeight: number | null;
    currentSourceLine: number | null;
  }>;
  residualChanges: Array<{
    observationId: number;
    stationsLabel: string;
    type: Observation['type'];
    sourceLine: number | null;
    baselineAbsStdRes: number;
    currentAbsStdRes: number;
    deltaAbsStdRes: number;
  }>;
  exclusionChanges: {
    added: number[];
    removed: number[];
  };
  preanalysisAdditionChanges: {
    added: string[];
    removed: string[];
  };
  overrideChanges: {
    added: number[];
    removed: number[];
  };
  clusterMergeDelta: number;
  settingsDiffs: string[];
}
