import type {
  AdjustmentResult,
  InstrumentLibrary,
  ObservationOverride,
  ParseOptions,
} from '../types';
import type { AdjustmentRuntime } from './adjustmentRuntime';

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
  /**
   * Phase 7B internal runtime seam: non-serializable engine dependencies
   * (sparse solvers, diagnostics, precision policy). Undefined preserves
   * exact legacy behavior; never persisted or sent over the worker protocol.
   */
  runtime?: AdjustmentRuntime;
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
