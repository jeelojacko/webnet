import type { StationId } from './typesBase';

export interface PreanalysisAddedSetPairRef {
  from: StationId;
  to: StationId;
}

export type PlanningMapBasemapMode = 'none' | 'osm';

export interface PlanningMapVertex {
  x: number;
  y: number;
}

export interface PlanningMapPolygon {
  id: string;
  source: 'user' | 'osm';
  kind: 'blocked-area' | 'building' | 'wooded';
  label: string;
  vertices: PlanningMapVertex[];
}

export interface PlanningScenarioFamilyToggles {
  existingSet: boolean;
  bracePoint: boolean;
  syntheticSetup: boolean;
  promotedSetup: boolean;
  crossTie: boolean;
}

export interface PlanningMapState {
  basemapMode: PlanningMapBasemapMode;
  showInputPoints: boolean;
  showObstacleLayer: boolean;
  showBlockedAreas: boolean;
  blockEditMode: boolean;
  blockedPolygons: PlanningMapPolygon[];
  obstaclePolygons: PlanningMapPolygon[];
  scenarioFamilies: PlanningScenarioFamilyToggles;
}

export type PreanalysisRecommendationKind =
  | 'existing-set'
  | 'brace-point'
  | 'synthetic-setup'
  | 'promoted-setup'
  | 'cross-tie'
  | 'bypass-intermediate'
  | 'decommission-intermediate'
  | 'move-synthetic';

export interface PreanalysisScenarioPreviewPoint {
  stationId: StationId;
  x: number;
  y: number;
  h: number;
  role: 'anchor' | 'brace' | 'setup';
  active: boolean;
}

export interface PreanalysisScenarioPreviewSegment {
  fromStationId: StationId;
  toStationId: StationId;
  kind: 'sight-line' | 'cross-tie';
  active: boolean;
}

export interface PreanalysisBracePreviewPoint {
  scenarioId: string;
  stationId: StationId;
  x: number;
  y: number;
  h: number;
  active: boolean;
  templateLabel: string;
}

export interface PreanalysisAddedSetRecommendationRow {
  scenarioId: string;
  scenarioKind: PreanalysisRecommendationKind;
  occupyStationId: StationId;
  setupStationIds: StationId[];
  primaryTargetStationId?: StationId;
  anchorStationId?: StationId;
  anchorPathStationIds?: StationId[];
  anchorPathPairRefs?: PreanalysisAddedSetPairRef[];
  bottleneckPair?: PreanalysisAddedSetPairRef;
  templateLabel: string;
  affectedStations: StationId[];
  affectedPairs: PreanalysisAddedSetPairRef[];
  sourceLines: number[];
  addedObservationCount: number;
  previewPoints?: PreanalysisScenarioPreviewPoint[];
  previewSegments?: PreanalysisScenarioPreviewSegment[];
  deltaWorstStationMajor?: number;
  deltaMedianStationMajor?: number;
  deltaWorstPairSigmaDist?: number;
  deltaPathWorstEdge?: number;
  deltaPathTotalMetric?: number;
  deltaWeakStationCount?: number;
  deltaWeakPairCount?: number;
  score?: number;
  actionMode: 'applyable-addition' | 'applyable-transform' | 'advisory';
  rationale?: string;
  thresholdReached: boolean;
  status: 'ok' | 'failed';
}

export interface PreanalysisThresholdPlanStep {
  rank: number;
  scenarioId: string;
  scenarioKind: PreanalysisRecommendationKind;
  occupyStationId: StationId;
  setupStationIds: StationId[];
  templateLabel: string;
  addedObservationCount: number;
  projectedWorstStationMajor?: number;
  thresholdReached: boolean;
}

export interface PreanalysisThresholdPlan {
  targetThresholdMeters?: number;
  thresholdReached: boolean;
  appliedStepCount: number;
  finalWorstStationMajor?: number;
  remainingFeasibleScenarioCount?: number;
  unmetReason?: string;
  steps: PreanalysisThresholdPlanStep[];
}

export interface PreanalysisImpactDiagnostics {
  enabled: boolean;
  activeSyntheticAdditionCount: number;
  candidateTemplateCount: number;
  remainingFeasibleScenarioCount: number;
  baseWorstStationMajor?: number;
  baseMedianStationMajor?: number;
  baseWorstPairSigmaDist?: number;
  baseWeakStationCount: number;
  baseWeakPairCount: number;
  targetThresholdMeters?: number;
  rows: PreanalysisAddedSetRecommendationRow[];
  bracePreviewPoints: PreanalysisBracePreviewPoint[];
  scenarioPreviewPoints: PreanalysisScenarioPreviewPoint[];
  scenarioPreviewSegments: PreanalysisScenarioPreviewSegment[];
  thresholdPlan: PreanalysisThresholdPlan;
}
