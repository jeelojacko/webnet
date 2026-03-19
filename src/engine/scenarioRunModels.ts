import type {
  AdjustmentResult,
  InstrumentLibrary,
  ObservationOverride,
  ParseOptions,
} from '../types';

export interface ScenarioRunRequest {
  input: string;
  maxIterations: number;
  convergenceThreshold?: number;
  instrumentLibrary?: InstrumentLibrary;
  excludeIds?: Set<number>;
  overrides?: Record<number, ObservationOverride>;
  parseOptions?: Partial<ParseOptions>;
  geoidSourceData?: ArrayBuffer | Uint8Array;
}

export interface ScenarioRunServiceStats {
  cachedScenarioCount: number;
  parseCacheHits: number;
  parseCacheMisses: number;
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
