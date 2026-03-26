import type {
  AdjustmentResult,
  InstrumentLibrary,
  ObservationOverride,
  ParseOptions,
} from '../types';

export interface SolveProgressEvent {
  phase: 'start' | 'iteration' | 'complete';
  iteration: number;
  maxIterations: number;
  elapsedMs: number;
  converged: boolean;
}

export interface ScenarioRunRequest {
  input: string;
  maxIterations: number;
  convergenceThreshold?: number;
  instrumentLibrary?: InstrumentLibrary;
  excludeIds?: Set<number>;
  overrides?: Record<number, ObservationOverride>;
  parseOptions?: Partial<ParseOptions>;
  geoidSourceData?: ArrayBuffer | Uint8Array;
  progressCallback?: (_event: SolveProgressEvent) => void;
}

export interface ScenarioRunServiceStats {
  cachedScenarioCount: number;
  cachedPlanningCount: number;
  parseCacheHits: number;
  parseCacheMisses: number;
  planningCacheHits: number;
  planningCacheMisses: number;
  solveCount: number;
}

export interface ScenarioComparisonRequest<TLabel = string> {
  label: TLabel;
  request: ScenarioRunRequest;
}

export interface ScenarioComparisonResult<TLabel = string> {
  label: TLabel;
  request: ScenarioRunRequest;
  result: AdjustmentResult;
}
